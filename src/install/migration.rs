use crate::Error;
use bun_ast::{E, ExprData};
use bun_core::strings;
use bun_core::{Output, zstr};
use bun_semver as Semver;
use bun_semver::query::token::Wildcard;
use bun_sys::{self, Fd, File, O};

use crate::install::{self as Install, PackageManager, Subcommand};
use crate::lockfile::{
    Format as LockfileFormat, LoadResult, LoadResultErr, LoadResultOk, LoadStep, Lockfile, Migrated,
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

pub fn detect_and_load_other_lockfile<'a>(
    this: &'a mut Lockfile,
    dir: Fd,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
) -> LoadResult<'a> {
    // check for package-lock.json, yarn.lock, etc...
    // if it exists, do an in-memory migration

    'npm: {
        let timer = std::time::Instant::now();
        let Ok(lockfile) = File::openat(dir, b"package-lock.json", O::RDONLY, 0) else {
            break 'npm;
        };
        // file closes on Drop
        let mut lockfile_path_buf = bun_paths::path_buffer_pool::get();
        let Ok(lockfile_path) = bun_sys::get_fd_path(lockfile.handle(), &mut lockfile_path_buf)
        else {
            break 'npm;
        };
        let lockfile_path: &[u8] = &*lockfile_path;
        let Ok(data) = lockfile.read_to_end() else {
            break 'npm;
        };
        let migrate_result =
            match migrate_npm_lockfile(this, manager, log, &data, lockfile_path, dir) {
                Ok(r) => r,
                Err(e) => {
                    return LoadResult::Err(LoadResultErr {
                        step: LoadStep::Migrating,
                        value: e,
                        lockfile_path: zstr!("package-lock.json"),
                        format: LockfileFormat::Text,
                    });
                }
            };

        if matches!(migrate_result, LoadResult::Ok { .. }) {
            report_migrated(manager, log, &timer, "package-lock.json");
        }

        return migrate_result;
    }

    'yarn: {
        let timer = std::time::Instant::now();
        let Ok(data) = File::read_from(dir, b"yarn.lock") else {
            break 'yarn;
        };
        let migrate_result = match yarn::migrate_yarn_lockfile(this, manager, log, &data, dir) {
            Ok(r) => r,
            Err(e) => {
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::Migrating,
                    value: e,
                    lockfile_path: zstr!("yarn.lock"),
                    format: LockfileFormat::Text,
                });
            }
        };

        if matches!(migrate_result, LoadResult::Ok { .. }) {
            report_migrated(manager, log, &timer, "yarn.lock");
        }

        return migrate_result;
    }

    'pnpm: {
        let timer = std::time::Instant::now();
        let Ok(data) = File::read_from(dir, b"pnpm-lock.yaml") else {
            break 'pnpm;
        };
        let migrate_result = match pnpm::migrate_pnpm_lockfile(this, manager, log, &data, dir) {
            Ok(r) => r,
            Err(MigratePnpmLockfileError::PnpmLockfileTooOld) => {
                report_unsupported_lockfile_version(
                    manager,
                    "pnpm-lock.yaml",
                    &bstr::BStr::new(pnpm_lockfile_version(&data)),
                    "pnpm install --lockfile-only",
                );
                log.reset();
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::Migrating,
                    value: Error::UnexpectedLockfileVersion,
                    lockfile_path: zstr!("pnpm-lock.yaml"),
                    format: LockfileFormat::Text,
                });
            }
            Err(e) => {
                if !manager.options.log_level.is_silent() {
                    if log.has_errors() {
                        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                    }
                    match e {
                        MigratePnpmLockfileError::NonExistentWorkspaceDependency => {
                            bun_core::warn!(
                                "Workspace link dependencies to non-existent folders aren't supported yet in pnpm-lock.yaml migration. Please follow along at <magenta>https://github.com/oven-sh/bun/issues/23026<r>",
                            );
                        }
                        MigratePnpmLockfileError::RelativeLinkDependency => {
                            bun_core::warn!(
                                "Relative link dependencies aren't supported yet. Please follow along at <magenta>https://github.com/oven-sh/bun/issues/23026<r>",
                            );
                        }
                        MigratePnpmLockfileError::WorkspaceNameMissing => {
                            bun_core::warn!(
                                "pnpm-lock.yaml migration failed due to missing workspace name.",
                            );
                        }
                        MigratePnpmLockfileError::YamlParseError => {
                            bun_core::warn!("Failed to parse pnpm-lock.yaml.");
                        }
                        _ => {}
                    }
                    Output::flush();
                }
                log.reset();
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::Migrating,
                    value: e.into(),
                    lockfile_path: zstr!("pnpm-lock.yaml"),
                    format: LockfileFormat::Text,
                });
            }
        };

        if matches!(migrate_result, LoadResult::Ok { .. }) {
            report_migrated(manager, log, &timer, "pnpm-lock.yaml");
        }

        return migrate_result;
    }

    LoadResult::NotFound
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
) {
    if manager.options.log_level.is_silent() {
        return;
    }
    Output::flush();
    if falls_back_to_package_json(manager) {
        bun_core::warn!(
            "{} is lockfileVersion {}, which bun cannot migrate; resolving from package.json instead",
            lockfile_name,
            version,
        );
    } else {
        bun_core::pretty_errorln!(
            "<r><red>error<r><d>:<r> {} is lockfileVersion {}, which bun cannot migrate",
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
    lockfile_name: &str,
) {
    if manager.options.log_level.is_silent() {
        log.reset();
        return;
    }
    if log.warnings > 0 && !log.has_errors() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        log.reset();
    }
    Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
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
                "package-lock.json",
                &(n.value() as i64),
                "npm install --package-lock-only --lockfile-version=3",
            );
            return Err(crate::Error::UnexpectedLockfileVersion);
        }
        Some(_) | None => return Err(crate::Error::InvalidNPMLockfile),
    }

    bun_core::analytics::Features::lockfile_migration_from_package_lock_inc();

    let root_package: &E::ObjectJSON;
    let packages_obj: &E::ObjectJSON = 'brk: {
        let Some(obj) = root_obj.get(b"packages") else {
            return Err(crate::Error::InvalidNPMLockfile);
        };
        let Some(eobj) = obj.as_object() else {
            return Err(crate::Error::InvalidNPMLockfile);
        };
        let props = eobj.properties();
        if props.is_empty() {
            return Err(crate::Error::InvalidNPMLockfile);
        }
        let prop1 = &props[0];
        // first key must be the "", self reference
        if !prop1.key.slice().is_empty() {
            return Err(crate::Error::InvalidNPMLockfile);
        }
        let Some(rp) = prop1.value.as_object() else {
            return Err(crate::Error::InvalidNPMLockfile);
        };
        root_package = rp;
        break 'brk eobj;
    };
    let packages_properties: &[E::PropertyJSON] = packages_obj.properties();

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
        this.workspace_paths.reserve(wksp.count());
        this.workspace_versions.reserve(wksp.count());

        for (k, v) in wksp.keys().iter().zip(wksp.values()) {
            let name_hash = string_hash(&v.name);

            #[cfg(debug_assertions)]
            {
                debug_assert!(strings::index_of_char(k, b'\\').is_none());
            }

            let mut sb = this.string_buf();
            let appended = sb.append(k)?;
            this.workspace_paths.insert(name_hash, appended);

            if let Some(version_string) = &v.version {
                let appended = this.string_buf().append(&version_string[..])?;
                let result =
                    Semver::Version::parse(appended.sliced(this.buffers.string_bytes.as_slice()));
                if result.valid && result.wildcard == Wildcard::None {
                    this.workspace_versions
                        .insert(name_hash, result.version.min());
                }
            }
        }
    }

    npm_lock::migrate_packages(
        this,
        manager,
        log,
        packages_properties,
        workspace_map.as_ref(),
    )?;
    clear_non_registry_platform_constraints(this);
    npm_lock::apply_root_overrides(this, manager, log, dir, workspace_map.as_ref(), abs_path)?;

    this.tag_workspace_links(manager.options.link_workspace_packages);
    this.resolve(log)?;

    #[cfg(debug_assertions)]
    {
        this.verify_data()?;
    }

    this.meta_hash = this.generate_meta_hash(false, this.packages.len())?;

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile: this,
        migrated: Migrated::Npm,
        serializer_result: Default::default(),
        format: LockfileFormat::Binary,
    }))
}

/// A fresh resolve only records `os`/`cpu` for the root and npm registry
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
fn string_hash(s: &[u8]) -> u64 {
    Semver::semver_string::Builder::string_hash(s)
}
