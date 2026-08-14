use crate::Error;
use bun_ast::{E, ExprData};
use bun_core::strings;
use bun_core::{Output, zstr};
use bun_paths::PathBuffer;
use bun_semver::query::token::Wildcard;
use bun_semver::{self as Semver, SlicedString};
use bun_sys::{self, Fd, File, O};

use crate::install::{self as Install, PackageManager};
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
        let mut lockfile_path_buf = PathBuffer::uninit();
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
            if log.warnings > 0 && !log.has_errors() {
                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                log.reset();
            }
            Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
            bun_core::pretty_error!(" ");
            bun_core::pretty_errorln!("<d>migrated lockfile from <r><green>package-lock.json<r>");
            Output::flush();
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
            if log.warnings > 0 && !log.has_errors() {
                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                log.reset();
            }
            Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
            bun_core::pretty_error!(" ");
            bun_core::pretty_errorln!("<d>migrated lockfile from <r><green>yarn.lock<r>");
            Output::flush();
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
            Err(e) => {
                match e {
                    MigratePnpmLockfileError::PnpmLockfileTooOld => {
                        bun_core::pretty_errorln!(
                            "<red><b>warning<r><d>:<r> pnpm-lock.yaml version is too old (\\< v7)\n\nPlease upgrade using 'pnpm install --lockfile-only' first, then try again.",
                        );
                    }
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
                        if log.has_errors() {
                            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        }
                        bun_core::warn!(
                            "pnpm-lock.yaml migration failed due to missing workspace name.",
                        );
                    }
                    MigratePnpmLockfileError::YamlParseError => {
                        if log.has_errors() {
                            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        }
                        bun_core::warn!("Failed to parse pnpm-lock.yaml.");
                    }
                    _ => {
                        if log.has_errors() {
                            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        }
                    }
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
            if log.warnings > 0 && !log.has_errors() {
                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                log.reset();
            }
            Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
            bun_core::pretty_error!(" ");
            bun_core::pretty_errorln!("<d>migrated lockfile from <r><green>pnpm-lock.yaml<r>");
            Output::flush();
        }

        return migrate_result;
    }

    LoadResult::NotFound
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
            if n.value() == 1.0 {
                bun_core::warn!(
                    "package-lock.json uses lockfileVersion 1, which bun cannot migrate. Run 'npm install --package-lock-only --lockfile-version=3' to upgrade it."
                );
            } else {
                bun_core::warn!(
                    "package-lock.json uses lockfileVersion {}, which this version of bun cannot migrate.",
                    n.value() as i64
                );
            }
            return Err(crate::Error::NPMLockfileVersionMismatch);
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
                let sliced_version = SlicedString::init(version_string, version_string);
                let result = Semver::Version::parse(sliced_version);
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
