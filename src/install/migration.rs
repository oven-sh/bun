use crate::Error;
use bun_alloc::AllocError;
use bun_ast::{E, Expr, ExprData};
use bun_collections::index_sort;
use bun_core::strings;
use bun_core::{Output, ZStr, zstr};
use bun_semver as Semver;
use bun_semver::query::token::Wildcard;
use bun_sys::{self, Fd, File, O};

use crate::bin::Bin;
use crate::dependency::{self, Behavior, Dependency};
use crate::external_slice::ExternalSlice;
use crate::install::{self as Install, PackageManager, Subcommand};
use crate::lockfile::{
    Format as LockfileFormat, LoadResult, LoadResultErr, LoadResultOk, LoadStep, Lockfile,
    Migrated, Package,
};
use crate::lockfile_real::package::PackageColumns as _;
use crate::lockfile_real::package::workspace_map::{MissingWorkspace, NamesArray, WorkspaceMap};
use crate::npm::{self as Npm};
use crate::pnpm;
use crate::pnpm::MigratePnpmLockfileError;
use crate::resolution;
use crate::yarn;

bun_output::declare_scope!(migrate, visible);

macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(migrate, $($args)*) };
}

mod npm_lock;

/// Creates a new `Buf` for each append, because holding one longer would lock out every other
/// `lockfile.*` access.
macro_rules! sbuf {
    ($lockfile:expr) => {
        bun_semver::string::Buf {
            bytes: &mut $lockfile.buffers.string_bytes,
            pool: &mut $lockfile.string_pool,
        }
    };
}
macro_rules! string_bytes {
    ($lockfile:expr) => {
        $lockfile.buffers.string_bytes.as_slice()
    };
}
pub(crate) use {sbuf, string_bytes};

/// YAML and package.json strings are backed by the Store. The `'static` is the field's own
/// lifetime.
pub(crate) fn as_str(expr: &Expr) -> Option<&'static [u8]> {
    match &expr.data {
        ExprData::EString(s) if s.is_utf8() => Some(s.data.slice()),
        _ => None,
    }
}

pub(crate) fn get_str(expr: &Expr, key: &[u8]) -> Option<&'static [u8]> {
    expr.get(key).and_then(|e| as_str(&e))
}

/// Returns the entries of a mapping, or nothing for any other value.
pub(crate) fn props(expr: &Expr) -> impl Iterator<Item = (&Expr, &Expr)> {
    let properties = match &expr.data {
        ExprData::EObject(object) => object.properties.as_slice(),
        _ => &[],
    };
    properties
        .iter()
        .filter_map(|p| Some((p.key.as_ref()?, p.value.as_ref()?)))
}

pub(crate) fn record_workspace(
    this: &mut Lockfile,
    name: &[u8],
    path: &[u8],
    version: Option<&[u8]>,
) -> Result<(), AllocError> {
    let name_hash = string_hash(name);
    let path = sbuf!(this).append(path)?;
    this.workspace_paths.put(name_hash, path)?;
    if let Some(version) = version {
        let version = sbuf!(this).append(version)?;
        let parsed = Semver::Version::parse(version.sliced(string_bytes!(this)));
        if parsed.valid && parsed.wildcard == Wildcard::None {
            this.workspace_versions
                .put(name_hash, parsed.version.min())?;
        }
    }
    Ok(())
}

/// The root's edge to a workspace.
pub(crate) fn push_workspace_dependency(
    this: &mut Lockfile,
    name: &[u8],
    path: &[u8],
) -> Result<(), AllocError> {
    let name_hash = string_hash(name);
    let dep = Dependency {
        name: sbuf!(this).append_with_hash(name, name_hash)?,
        name_hash,
        behavior: Behavior::WORKSPACE,
        version: dependency::Version {
            tag: dependency::VersionTag::Workspace,
            value: dependency::Value {
                workspace: sbuf!(this).append(path)?,
            },
            ..Default::default()
        },
    };
    this.buffers.dependencies.push(dep);
    Ok(())
}

/// Sorts the dependency rows appended since `off` and gives them to `pkg`.
pub(crate) fn take_appended_dependencies(this: &mut Lockfile, pkg: &mut Package, off: usize) {
    let buffers = &mut this.buffers;
    let bytes = buffers.string_bytes.as_slice();
    let mut appended = buffers.dependencies.split_off(off);
    index_sort::sort_vec_by(&mut appended, |a, b| Dependency::cmp(bytes, a, b));
    let (off, len) = (off as u32, appended.len() as u32);
    buffers.dependencies.append(&mut appended);
    pkg.dependencies = ExternalSlice::new(off, len);
    pkg.resolutions = ExternalSlice::new(off, len);
}

pub(crate) fn parse_manifest_bin(
    this: &mut Lockfile,
    pkg: &mut Package,
    manifest: &Expr,
) -> Result<(), AllocError> {
    if let Some(bin) = manifest.get(b"bin") {
        pkg.bin = Bin::parse_append(&bin, &mut sbuf!(this), &mut this.buffers.extern_strings)?;
    } else if let Some(bin) = manifest.get(b"directories").and_then(|d| d.get(b"bin")) {
        pkg.bin = Bin::parse_append_from_directories(&bin, &mut sbuf!(this))?;
    }
    Ok(())
}

pub fn detect_and_load_other_lockfile<'a>(
    this: &'a mut Lockfile,
    dir: Fd,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
) -> LoadResult<'a> {
    // check for npm-shrinkwrap.json, package-lock.json, yarn.lock, etc...
    // if it exists, do an in-memory migration
    let timer = std::time::Instant::now();

    // npm itself prefers npm-shrinkwrap.json over package-lock.json. The two have the same format.
    let mut found = Vec::new();
    for (name, name_z) in [
        ("npm-shrinkwrap.json", zstr!("npm-shrinkwrap.json")),
        ("package-lock.json", zstr!("package-lock.json")),
        ("yarn.lock", zstr!("yarn.lock")),
        ("pnpm-lock.yaml", zstr!("pnpm-lock.yaml")),
    ] {
        let Ok(file) = File::openat(dir, name_z, O::RDONLY, 0) else {
            continue;
        };
        let Ok(data) = file.read_to_end() else {
            continue;
        };
        found.push((name, name_z, file, data));
    }

    for (i, &(name, name_z, ref file, ref data)) in found.iter().enumerate() {
        // The name of the lockfile to try if this one cannot be migrated.
        let next = found.get(i + 1).map(|next| next.0);
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let migrate_result = match name {
            "yarn.lock" => yarn::migrate_yarn_lockfile(&mut *this, manager, log, data),
            "pnpm-lock.yaml" => migrate_pnpm_lockfile(&mut *this, manager, log, data),
            _ => {
                let Ok(path) = bun_sys::get_fd_path(file.handle(), &mut path_buf) else {
                    continue;
                };
                migrate_npm_lockfile(&mut *this, manager, log, data, path, dir, name, next)
            }
        };
        let err = match finish_migration(migrate_result, manager, log, &timer, name_z) {
            Ok((migrated, format)) => {
                return LoadResult::Ok(LoadResultOk {
                    lockfile: this,
                    migrated,
                    serializer_result: Default::default(),
                    format,
                });
            }
            Err(err) => err,
        };
        // The install can continue without this lockfile, and errors left in `log` would fail it.
        print_errors_and_reset(manager, log);
        let Some(next) = next else {
            return LoadResult::Err(err);
        };
        if !manager.options.log_level.is_silent() && !reported_unsupported_lockfile_version(&err) {
            bun_core::warn!(
                "cannot migrate {} ({}), trying {}",
                name,
                err.value.name(),
                next,
            );
        }
    }

    LoadResult::NotFound
}

fn migrate_pnpm_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
) -> Result<LoadResult<'a>, Error> {
    match pnpm::migrate_pnpm_lockfile(this, manager, log, data) {
        Ok(r) => Ok(r),
        Err(MigratePnpmLockfileError::PnpmLockfileTooOld) => {
            report_unsupported_lockfile_version(
                manager,
                "pnpm-lock.yaml",
                &bstr::BStr::new(pnpm_lockfile_version(data)),
                "pnpm install --lockfile-only",
                None,
            );
            log.reset();
            Err(Error::UnexpectedLockfileVersion)
        }
        Err(e) => {
            print_errors_and_reset(manager, log);
            match e {
                _ if manager.options.log_level.is_silent() => {}
                MigratePnpmLockfileError::NonExistentWorkspaceDependency => bun_core::warn!(
                    "Workspace link dependencies to non-existent folders aren't supported yet in pnpm-lock.yaml migration. Please follow along at <magenta>https://github.com/oven-sh/bun/issues/23026<r>",
                ),
                MigratePnpmLockfileError::YamlParseError => {
                    bun_core::warn!("Failed to parse pnpm-lock.yaml.")
                }
                _ => {}
            }
            Err(e.into())
        }
    }
}

fn migrating_error(err: Error, lockfile_name: &'static ZStr) -> LoadResultErr {
    LoadResultErr {
        step: LoadStep::Migrating,
        value: err,
        lockfile_path: lockfile_name,
        format: LockfileFormat::Text,
    }
}

/// On success, returns the `migrated` and `format` fields for the caller's `LoadResultOk`.
fn finish_migration(
    migrate_result: Result<LoadResult<'_>, Error>,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    timer: &std::time::Instant,
    lockfile_name: &'static ZStr,
) -> Result<(Migrated, LockfileFormat), LoadResultErr> {
    let ok = match migrate_result {
        Ok(LoadResult::Ok(ok)) => ok,
        Ok(LoadResult::Err(err)) => return Err(err),
        Ok(LoadResult::NotFound) => unreachable!("a migration fills the lockfile or fails"),
        Err(err) => return Err(migrating_error(err, lockfile_name)),
    };
    // Other lockfiles have no `trustedDependencies`, and `bun pm migrate` saves this one as-is.
    if let Err(err) = ok
        .lockfile
        .read_trusted_dependencies_from_manifests(&mut manager.workspace_package_json_cache, log)
    {
        return Err(migrating_error(err, lockfile_name));
    }
    // The root's `patchedDependencies` aren't recorded either. Its package.json was read just
    // above.
    if let Some(path) = crate::lockfile_real::join_top_level_dir(&[b"package.json"])
        && let crate::GetJsonResult::Entry(root) = manager
            .workspace_package_json_cache
            .get_with_path(log, path.slice(), Default::default())
    {
        bun_core::handle_oom(crate::lockfile_real::package::append_patched_dependencies(
            ok.lockfile,
            root.root,
            &bun_alloc::Arena::new(),
        ));
    }
    report_migrated(manager, log, timer, lockfile_name);
    Ok((ok.migrated, ok.format))
}

fn print_errors_and_reset(manager: &PackageManager, log: &mut bun_ast::Log) {
    if !manager.options.log_level.is_silent() && log.has_errors() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        Output::flush();
    }
    log.reset();
}

/// `overrides` / `resolutions` of the root package.json, parsed the way an install does.
pub(crate) fn parse_root_overrides(
    this: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    json: bun_ast::Expr,
    workspace_names: &WorkspaceMap,
) -> Result<(), Error> {
    if json.as_property(b"overrides").is_none() && json.as_property(b"resolutions").is_none() {
        return Ok(());
    }
    let root_package = *this.packages.get(0);
    let (mut builder, lf) = this.string_builder_split();
    lf.overrides
        .parse_count(manager, log, source, workspace_names, json, &mut builder);
    builder.allocate()?;
    lf.overrides.parse_append(
        manager,
        lf.dependencies.as_slice(),
        &root_package,
        log,
        source,
        workspace_names,
        json,
        &mut builder,
    )?;
    builder.clamp();
    Ok(())
}

/// True when the migrator already printed the version warn/error + upgrade note, so lockfile-load reporters must stay quiet.
pub fn reported_unsupported_lockfile_version(err: &LoadResultErr) -> bool {
    err.step == LoadStep::Migrating && matches!(err.value, Error::UnexpectedLockfileVersion)
}

fn falls_back_to_package_json(manager: &PackageManager) -> bool {
    matches!(
        manager.subcommand,
        Subcommand::Install
            | Subcommand::Update
            | Subcommand::Add
            | Subcommand::Remove
            | Subcommand::Link
            | Subcommand::Unlink
    ) && !manager.options.enable.fail_early()
}

fn report_unsupported_lockfile_version(
    manager: &PackageManager,
    lockfile_name: &str,
    version: &dyn core::fmt::Display,
    upgrade_command: &str,
    // The name of the lockfile that is tried next, if there is one.
    next: Option<&str>,
) {
    if manager.options.log_level.is_silent() {
        return;
    }
    Output::flush();
    if let Some(next) = next {
        bun_core::warn!(
            "cannot migrate {}: unsupported lockfileVersion {}, trying {}",
            lockfile_name,
            version,
            next,
        );
        Output::flush();
        return;
    }
    if falls_back_to_package_json(manager) {
        bun_core::warn!(
            "cannot migrate {}: unsupported lockfileVersion {}, resolving from package.json",
            lockfile_name,
            version,
        );
    } else {
        bun_core::pretty_errorln!(
            "<r><red>error<r><d>:<r> cannot migrate {}: unsupported lockfileVersion {}",
            lockfile_name,
            version,
        );
    }
    bun_core::note!("{}", upgrade_command);
    Output::flush();
}

fn pnpm_lockfile_version(data: &[u8]) -> &[u8] {
    for line in strings::split(data, b"\n") {
        let Some(rest) = strings::without_prefix_if_possible_comptime(line, b"lockfileVersion:")
        else {
            continue;
        };
        let mut version = rest.trim_ascii();
        for quote in *b"'\"" {
            version = version.strip_prefix(&[quote]).unwrap_or(version);
            version = version.strip_suffix(&[quote]).unwrap_or(version);
        }
        return version;
    }
    b"< 7"
}

fn report_migrated(
    manager: &PackageManager,
    log: &mut bun_ast::Log,
    timer: &std::time::Instant,
    lockfile_name: &ZStr,
) {
    if manager.options.log_level.is_silent() {
        log.reset();
        return;
    }
    if log.warnings > 0 && !log.has_errors() {
        Output::flush();
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        log.reset();
    }
    Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
    let lockfile_name = bstr::BStr::new(lockfile_name.as_bytes());
    bun_core::pretty_errorln!(" <d>migrated lockfile from <r><green>{}<r>", lockfile_name);
    Output::flush();
}

fn migrate_npm_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
    abs_path: &[u8],
    dir: Fd,
    lockfile_name: &'static str,
    next: Option<&str>,
) -> Result<LoadResult<'a>, Error> {
    debug!("begin lockfile migration");

    this.init_empty();
    Install::initialize_store();

    let json_src = bun_ast::Source::init_path_string(abs_path, data);
    let parsed_json = bun_parsers::json::ParsedJson::parse_json(&json_src, log)
        .map_err(|_| crate::Error::InvalidNPMLockfile)?;
    let json = &parsed_json.root;

    let ExprData::EObjectJSON(root_obj) = &json.data else {
        return Err(crate::Error::InvalidNPMLockfile);
    };
    let root_obj: &E::ObjectJSON = root_obj.get();
    match root_obj.get(b"lockfileVersion") {
        Some(E::JsonValue::Number(n)) if (2.0..=4.0).contains(&n.value()) => {}
        Some(E::JsonValue::Number(n)) => {
            report_unsupported_lockfile_version(
                manager,
                lockfile_name,
                &(n.value() as i64),
                "npm install --package-lock-only --lockfile-version=3",
                next,
            );
            return Err(crate::Error::UnexpectedLockfileVersion);
        }
        Some(_) | None => return Err(crate::Error::InvalidNPMLockfile),
    }

    bun_core::analytics::Features::lockfile_migration_from_package_lock_inc();

    let packages_properties: &[E::PropertyJSON] = root_obj
        .get(b"packages")
        .and_then(|packages| packages.as_object())
        .map_or(&[], |packages| packages.properties());
    // first key must be the "", self reference
    let Some(root_package) = packages_properties
        .first()
        .filter(|prop| prop.key.slice().is_empty())
        .and_then(|prop| prop.value.as_object())
    else {
        return Err(crate::Error::InvalidNPMLockfile);
    };

    let workspace_map: Option<WorkspaceMap> = 'workspace_map: {
        let wksp_row = root_package
            .properties()
            .iter()
            .find(|p| p.key.slice() == b"workspaces");
        if let Some(wksp_row) = wksp_row {
            let mut workspaces = WorkspaceMap::init();

            let wksp_loc =
                bun_parsers::json::property_value_loc(&json_src.contents, wksp_row.key_loc)
                    .unwrap_or(wksp_row.key_loc);
            let (json_array_value, json_array_loc) = match &wksp_row.value {
                E::JsonValue::Array(_) => (wksp_row.value, wksp_loc),
                E::JsonValue::Object(obj) => {
                    let obj: &E::ObjectJSON = obj.get();
                    let packages_row = obj
                        .properties()
                        .iter()
                        .find(|p| p.key.slice() == b"packages");
                    if let Some(packages_row) = packages_row {
                        if !matches!(packages_row.value, E::JsonValue::Array(_)) {
                            return Err(crate::Error::InvalidNPMLockfile);
                        }
                        let loc = bun_parsers::json::property_value_loc(
                            &json_src.contents,
                            packages_row.key_loc,
                        )
                        .unwrap_or(packages_row.key_loc);
                        (packages_row.value, loc)
                    } else {
                        return Err(crate::Error::InvalidNPMLockfile);
                    }
                }
                _ => return Err(crate::Error::InvalidNPMLockfile),
            };

            let E::JsonValue::Array(json_array) = json_array_value else {
                return Err(crate::Error::InvalidNPMLockfile);
            };

            // due to package paths and resolved properties for links and workspaces always having
            // forward slashes, we depend on `processWorkspaceNamesArray` to always return workspace
            // paths with forward slashes on windows
            let workspace_packages_count = workspaces.process_names_array(
                &mut manager.workspace_package_json_cache,
                log,
                NamesArray::Immutable(json_array.get(), json_array_loc),
                &json_src,
                wksp_loc,
                None,
                MissingWorkspace::Skip,
            )?;
            debug!("found {} workspace packages", workspace_packages_count);
            break 'workspace_map Some(workspaces);
        }
        break 'workspace_map None;
    };

    if let Some(wksp) = &workspace_map {
        for (path, workspace) in wksp.keys().iter().zip(wksp.values()) {
            record_workspace(this, &workspace.name, path, workspace.version.as_deref())?;
        }
    }

    npm_lock::migrate_packages(
        this,
        manager,
        log,
        &json_src,
        packages_properties,
        workspace_map.as_ref(),
        lockfile_name,
    )?;
    clear_non_registry_platform_constraints(this);
    npm_lock::apply_root_overrides(this, manager, log, dir, workspace_map.as_ref(), abs_path)?;

    this.tag_workspace_links(manager.options.link_workspace_packages);
    this.resolve(log)?;

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile: this,
        migrated: Migrated::Npm,
        serializer_result: Default::default(),
        format: LockfileFormat::Binary,
    }))
}

/// Warns about the dependencies that the install is going to resolve to a version that the migrated
/// lockfile doesn't specify: the ones in `dropped`, and the ones that aren't bound to anything.
pub(crate) fn warn_unlocked_dependencies(
    lockfile: &Lockfile,
    manager: &PackageManager,
    lockfile_name: &str,
    dropped: &[Dependency],
) {
    if !manager.options.log_level.is_verbose() {
        return;
    }
    let buf = lockfile.buffers.string_bytes.as_slice();
    let unlocked = {
        let unbound = (lockfile.buffers.dependencies.iter())
            .zip(lockfile.buffers.resolutions.iter())
            .filter(|(_, resolution)| **resolution == crate::INVALID_PACKAGE_ID)
            .map(|(dep, _)| dep);
        // Peers and optional dependencies are not always locked, and a workspace is no entry.
        dropped.iter().chain(unbound).filter(|dep| {
            !dep.behavior.is_peer()
                && !dep.behavior.is_optional()
                && !dep.behavior.is_workspace()
                && dep.version.tag != dependency::Tag::Workspace
                && lockfile.workspace_paths.get(&dep.name_hash).is_none()
        })
    };
    for dep in unlocked {
        bun_core::warn!(
            "{} missing \"{}@{}\", resolving it",
            lockfile_name,
            bun_core::fmt::for_terminal(bstr::BStr::new(dep.name.slice(buf))),
            bun_core::fmt::for_terminal(bstr::BStr::new(dep.version.literal.slice(buf))),
        );
    }
}

/// A fresh resolve only records `os`/`cpu`/`libc` for the root and npm registry
/// packages (`Package::from_npm`); folder, tarball, git, and workspace packages
/// install unconditionally, so a migrated lockfile must not constrain them.
pub(crate) fn clear_non_registry_platform_constraints(lockfile: &mut Lockfile) {
    for i in 0..lockfile.packages.len() {
        match lockfile.packages.items_resolution()[i].tag {
            resolution::Tag::Root | resolution::Tag::Npm => {}
            _ => {
                let meta = &mut lockfile.packages.items_meta_mut()[i];
                meta.arch = Npm::Architecture::ALL;
                meta.os = Npm::OperatingSystem::ALL;
                meta.libc = Npm::Libc::NONE;
            }
        }
    }
}

fn pkg_flag_is_true(pkg: &E::ObjectJSON, key: &[u8]) -> bool {
    matches!(pkg.get(key), Some(E::JsonValue::Boolean(true)))
}

/// npm's `name-from-folder`: the basename, keeping an `@scope` parent component.
fn package_name_from_path(pkg_path: &[u8]) -> &[u8] {
    let Some(slash) = strings::last_index_of_char(pkg_path, b'/') else {
        return pkg_path;
    };
    let parent = &pkg_path[..slash];
    let parent_start = strings::last_index_of_char(parent, b'/').map_or(0, |i| i + 1);
    if parent[parent_start..].starts_with(b"@") {
        &pkg_path[parent_start..]
    } else {
        &pkg_path[slash + 1..]
    }
}

#[inline]
pub(crate) fn string_hash(s: &[u8]) -> u64 {
    Semver::semver_string::Builder::string_hash(s)
}
