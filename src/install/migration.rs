use crate::Error;
use bun_ast::{E, ExprData};
use bun_collections::{StringArrayHashMap, StringHashMap};
use bun_core::strings;
use bun_core::{Global, Output, zstr};
use bun_paths::{self, MAX_PATH_BYTES, PathBuffer};
use bun_semver::query::token::Wildcard;
use bun_semver::{self as Semver, SlicedString, String as SemverString};
use bun_sys::{self, Fd, File, O};

use crate::bin::{self, Bin};
use crate::dependency::{
    self, Behavior, Dependency, DependencyExt as _, Tag as DepTag, TagExt as _, Value as DepValue,
    Version as DepVersion,
};
use crate::external_slice::ExternalSlice;
use crate::install::{self as Install, ExternalStringList, PackageID, PackageManager};
use crate::integrity::Integrity;
use crate::lockfile::{
    self, Format as LockfileFormat, LoadResult, LoadResultErr, LoadResultOk, LoadStep, Lockfile,
    Migrated, PackageListEntry,
};
use crate::lockfile_real::package::PackageColumns as _;
use crate::lockfile_real::package::workspace_map::{NamesArray, WorkspaceMap};
use crate::npm::{self as Npm};
use crate::pnpm;
use crate::pnpm::MigratePnpmLockfileError;
use crate::repository::Repository;
use crate::resolution::{self, Resolution, TaggedValue as ResTagged};
use crate::versioned_url::VersionedURLType;
use crate::yarn;

bun_output::declare_scope!(migrate, visible);

macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(migrate, $($args)*) };
}

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
        let migrate_result = match migrate_npm_lockfile(this, manager, log, &data, lockfile_path) {
            Ok(r) => r,
            Err(e) => {
                if e == crate::Error::NPMLockfileVersionMismatch {
                    bun_core::pretty_errorln!(
                        "<red><b>error<r><d>:<r> Please upgrade package-lock.json to lockfileVersion 2 or 3\n\nRun 'npm i --lockfile-version 3 --frozen-lockfile' to upgrade your lockfile without changing dependencies.",
                    );
                    Global::exit(1);
                }
                return LoadResult::Err(LoadResultErr {
                    step: LoadStep::Migrating,
                    value: e,
                    lockfile_path: zstr!("package-lock.json"),
                    format: LockfileFormat::Text,
                });
            }
        };

        if matches!(migrate_result, LoadResult::Ok { .. }) {
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
                    MigratePnpmLockfileError::PnpmLockfileNotObject
                    | MigratePnpmLockfileError::PnpmLockfileMissingVersion
                    | MigratePnpmLockfileError::PnpmLockfileVersionInvalid
                    | MigratePnpmLockfileError::PnpmLockfileMissingImporters
                    | MigratePnpmLockfileError::PnpmLockfileMissingRootPackage
                    | MigratePnpmLockfileError::PnpmLockfileInvalidSnapshot
                    | MigratePnpmLockfileError::PnpmLockfileInvalidDependency
                    | MigratePnpmLockfileError::PnpmLockfileMissingDependencyVersion
                    | MigratePnpmLockfileError::PnpmLockfileInvalidOverride
                    | MigratePnpmLockfileError::PnpmLockfileInvalidPatchedDependency
                    | MigratePnpmLockfileError::PnpmLockfileMissingCatalogEntry
                    | MigratePnpmLockfileError::PnpmLockfileUnresolvableDependency => {
                        // These errors are continuable - log the error but don't exit
                        // The install will continue with a fresh install instead of migration
                        if log.has_errors() {
                            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        }
                    }
                    _ => {}
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
            Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
            bun_core::pretty_error!(" ");
            bun_core::pretty_errorln!("<d>migrated lockfile from <r><green>pnpm-lock.yaml<r>");
            Output::flush();
        }

        return migrate_result;
    }

    LoadResult::NotFound
}

type ResolvedURLsMap = StringHashMap<Box<[u8]>>;

type IdMap = StringHashMap<IdMapValue>;

#[derive(Copy, Clone)]
struct IdMapValue {
    /// index into the old package-lock.json package entries.
    old_json_index: u32,
    /// this is the new package id for the bun lockfile
    ///
    /// - if this new_package_id is set to `package_id_is_link`, it means it's a link
    /// and to get the actual package id, you need to lookup `.resolved` in the hashmap.
    /// - if it is `package_id_is_bundled`, it means it's a bundled dependency that was not
    /// marked by npm, which can happen to some transitive dependencies.
    new_package_id: u32,
}

const PACKAGE_ID_IS_LINK: u32 = u32::MAX;
const PACKAGE_ID_IS_BUNDLED: u32 = u32::MAX - 1;

#[cfg(debug_assertions)]
const UNSET_PACKAGE_ID: PackageID = Install::INVALID_PACKAGE_ID - 1;

use bun_install_types::DependencyGroup;
// Order preserved: deps→dev→peer→optional.
const DEPENDENCY_KEYS: [DependencyGroup; 4] = [
    DependencyGroup::DEPENDENCIES,
    DependencyGroup::DEV,
    DependencyGroup::PEER,
    DependencyGroup::OPTIONAL,
];

fn migrate_npm_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
    abs_path: &[u8],
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
        Some(E::JsonValue::Number(n)) if n.value() >= 2.0 && n.value() <= 3.0 => {}
        Some(_) => return Err(crate::Error::NPMLockfileVersionMismatch),
        None => return Err(crate::Error::InvalidNPMLockfile),
    }

    bun_core::analytics::Features::lockfile_migration_from_package_lock_inc();

    // Count pass

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

    let mut num_deps: u32 = 0;

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
            )?;
            debug!("found {} workspace packages", workspace_packages_count);
            num_deps += workspace_packages_count;
            break 'workspace_map Some(workspaces);
        }
        break 'workspace_map None;
    };

    // constructed "resolved" urls
    let mut resolved_urls = ResolvedURLsMap::default();
    // Drop frees keys/values automatically

    // Counting Phase
    // This "IdMap" is used to make object key lookups faster for the `packages` object
    // it also lets us resolve linked and bundled packages.
    let mut id_map = IdMap::default();
    id_map.reserve(packages_properties.len());
    let mut num_extern_strings: u32 = 0;
    let mut package_idx: u32 = 0;
    for (i, entry) in packages_properties.iter().enumerate() {
        let pkg_path = entry.key.slice();
        let Some(pkg) = entry.value.as_object() else {
            return Err(crate::Error::InvalidNPMLockfile);
        };

        if pkg.get(b"link").is_some() {
            id_map.put_assume_capacity(
                pkg_path,
                IdMapValue {
                    old_json_index: i as u32,
                    new_package_id: PACKAGE_ID_IS_LINK,
                },
            );
            continue;
        }
        // Counterpart of `is_skipped_pkg`: same per-flag truthiness, but
        // bundled packages still get an id_map entry so dependency linking
        // can recognize them.
        if pkg_flag_is_true(pkg, b"inBundle") {
            id_map.put_assume_capacity(
                pkg_path,
                IdMapValue {
                    old_json_index: i as u32,
                    new_package_id: PACKAGE_ID_IS_BUNDLED,
                },
            );
            continue;
        }
        if pkg_flag_is_true(pkg, b"extraneous") {
            continue;
        }

        id_map.put_assume_capacity(
            pkg_path,
            IdMapValue {
                old_json_index: i as u32,
                new_package_id: package_idx,
            },
        );
        package_idx += 1;

        for dep_key in DEPENDENCY_KEYS {
            if let Some(deps) = pkg.get(dep_key.prop) {
                let Some(deps_obj) = deps.as_object() else {
                    return Err(crate::Error::InvalidNPMLockfile);
                };
                num_deps = num_deps.saturating_add(deps_obj.properties().len() as u32);
            }
        }

        if let Some(bin) = pkg.get(b"bin") {
            let Some(bin_obj) = bin.as_object() else {
                return Err(crate::Error::InvalidNPMLockfile);
            };
            match bin_obj.properties().len() as u32 {
                0 => return Err(crate::Error::InvalidNPMLockfile),
                1 => {}
                n => {
                    num_extern_strings += n * 2;
                }
            }
        }

        if pkg.get(b"resolved").is_none() {
            let version_prop = pkg.get(b"version");
            // Match the building phase: prefer the entry's explicit "name". npm
            // writes it whenever it differs from the name its folder path implies,
            // e.g. a package named `admin` living at `@admin` or `packages/@admin`.
            let pkg_name: &[u8] = if let Some(set_name) = pkg.get(b"name") {
                set_name.as_str().ok_or(crate::Error::InvalidNPMLockfile)?
            } else {
                package_name_from_path(pkg_path)
            };
            if let Some(version_prop) = version_prop
                && !pkg_name.is_empty()
            {
                // construct registry url
                let href: &[u8] = manager.scope_for_package_name(pkg_name).url.href();
                let mut count: usize = 0;
                count += href.len() + pkg_name.len() + b"/-/".len();
                if pkg_name[0] == b'@' {
                    // scoped
                    let Some(slash_index) = strings::index_of_char(pkg_name, b'/') else {
                        return Err(crate::Error::InvalidNPMLockfile);
                    };
                    let slash_index = slash_index as usize;
                    if slash_index >= pkg_name.len() - 1 {
                        return Err(crate::Error::InvalidNPMLockfile);
                    }
                    count += pkg_name[slash_index + 1..].len();
                } else {
                    count += pkg_name.len();
                }
                let Some(version_str) = version_prop.as_str() else {
                    return Err(crate::Error::InvalidNPMLockfile);
                };
                count += b"-.tgz".len() + version_str.len();

                let mut resolved_url = vec![0u8; count].into_boxed_slice();
                let mut remain = &mut resolved_url[..];
                remain[..href.len()].copy_from_slice(href);
                remain = &mut remain[href.len()..];
                remain[..pkg_name.len()].copy_from_slice(pkg_name);
                remain = &mut remain[pkg_name.len()..];
                remain[..3].copy_from_slice(b"/-/");
                remain = &mut remain[3..];
                if pkg_name[0] == b'@' {
                    let slash_index = strings::index_of_char(pkg_name, b'/').unwrap() as usize;
                    let suffix = &pkg_name[slash_index + 1..];
                    remain[..suffix.len()].copy_from_slice(suffix);
                    remain = &mut remain[suffix.len()..];
                } else {
                    remain[..pkg_name.len()].copy_from_slice(pkg_name);
                    remain = &mut remain[pkg_name.len()..];
                }
                remain[0] = b'-';
                remain = &mut remain[1..];
                remain[..version_str.len()].copy_from_slice(version_str);
                remain = &mut remain[version_str.len()..];
                remain[..4].copy_from_slice(b".tgz");

                resolved_urls.put(pkg_path, resolved_url)?;
            }
        }
    }
    if num_deps == u32::MAX {
        return Err(crate::Error::InvalidNPMLockfile); // lol
    }

    debug!("counted {} dependencies", num_deps);
    debug!("counted {} extern strings", num_extern_strings);
    debug!("counted {} packages", package_idx);

    this.buffers.dependencies.reserve(num_deps as usize);
    this.buffers.resolutions.reserve(num_deps as usize);
    this.buffers
        .extern_strings
        .reserve(num_extern_strings as usize);
    this.packages.ensure_total_capacity(package_idx as usize)?;
    // The package index is overallocated, but we know the upper bound
    this.package_index.reserve(package_idx as usize);

    // dependency on `resolved`, a dependencies version tag might change, requiring
    // new strings to be allocated.
    // Reshaped for borrowck — `string_buf()` borrows `this` mutably,
    // so we re-acquire it locally where needed instead of holding it across
    // other `this.*` mutations.

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

    // Package Building Phase
    // This initializes every package and sets the resolution to uninitialized
    for entry in packages_properties.iter() {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        let Some(pkg) = entry.value.as_object() else {
            unreachable!("npm lockfile: non-object Expr from JSON parser")
        };

        let pkg_path = entry.key.slice();

        if let Some(link) = pkg.get(b"link") {
            if let Some(wksp) = &workspace_map {
                if !matches!(link, E::JsonValue::Boolean(_)) {
                    continue;
                }
                if let E::JsonValue::Boolean(b) = link {
                    if *b {
                        if let Some(resolved) = pkg.get(b"resolved") {
                            let Some(resolved_str) = resolved.as_str() else {
                                continue;
                            };
                            if let Some(wksp_entry) = wksp.get(resolved_str) {
                                let pkg_name = package_name_from_path(pkg_path);
                                if !strings::eql_long(&wksp_entry.name, pkg_name, true) {
                                    let pkg_name_hash = string_hash(pkg_name);
                                    if !this.workspace_paths.contains(&pkg_name_hash) {
                                        // Package resolve path is an entry in the workspace map, but
                                        // the package name is different. This package doesn't exist
                                        // in node_modules, but we still allow packages to resolve to it's
                                        // resolution.
                                        let mut sb = this.string_buf();
                                        let appended = sb.append(resolved_str)?;
                                        this.workspace_paths.insert(pkg_name_hash, appended);

                                        if let Some(version_string) = &wksp_entry.version {
                                            let sliced_version =
                                                SlicedString::init(version_string, version_string);
                                            let result = Semver::Version::parse(sliced_version);
                                            if result.valid && result.wildcard == Wildcard::None {
                                                this.workspace_versions
                                                    .insert(pkg_name_hash, result.version.min());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            continue;
        }

        if is_skipped_pkg(pkg) {
            continue;
        }

        let workspace_entry = workspace_map.as_ref().and_then(|map| map.get(pkg_path));
        let is_workspace = workspace_entry.is_some();

        let pkg_name: &[u8] = if let Some(e) = workspace_entry {
            &e.name
        } else if let Some(set_name) = pkg.get(b"name").and_then(|v| v.as_str()) {
            set_name
        } else {
            package_name_from_path(pkg_path)
        };

        let name_hash = string_hash(pkg_name);

        let package_id: PackageID = u32::try_from(this.packages.len()).expect("int cast");
        #[cfg(debug_assertions)]
        {
            // If this is false, then it means we wrote wrong resolved ids
            // During counting phase we assign all the packages an id.
            debug_assert!(package_id == id_map.get(pkg_path).unwrap().new_package_id);
        }

        // Construct the string buf with explicit disjoint field borrows so the
        // borrow checker permits concurrent access to `this.buffers.extern_strings`
        // (used in the multi-entry `bin` map branch below).
        let mut sb = bun_semver::semver_string::Buf {
            bytes: &mut this.buffers.string_bytes,
            pool: &mut this.string_pool,
        };
        let appended_name = sb.append_with_hash(pkg_name, name_hash)?;
        let resolution_value = if is_workspace {
            Resolution::init(ResTagged::Workspace(sb.append(pkg_path)?))
        } else {
            Resolution::default()
        };

        let bin_value = if let Some(bin) = pkg.get(b"bin") {
            'bin: {
                // we already check these conditions during counting
                let Some(bin_obj) = bin.as_object() else {
                    unreachable!("npm lockfile: non-object Expr from JSON parser")
                };
                let bin_props = bin_obj.properties();
                debug_assert!(!bin_props.is_empty());

                // in npm lockfile, the bin is always an object, even if it is only a single one
                // we need to detect if it's a single entry and lower it to a file.
                if bin_props.len() == 1 {
                    let prop = &bin_props[0];
                    let key = prop.key.slice();
                    let script_value = prop
                        .value
                        .as_str()
                        .ok_or(crate::Error::InvalidNPMLockfile)?;

                    if strings::eql(key, pkg_name) {
                        break 'bin Bin {
                            tag: bin::Tag::File,
                            _padding_tag: [0; 3],
                            value: bin::Value::init_file(sb.append(script_value)?),
                        };
                    }

                    break 'bin Bin {
                        tag: bin::Tag::NamedFile,
                        _padding_tag: [0; 3],
                        value: bin::Value::init_named_file([
                            sb.append(key)?,
                            sb.append(script_value)?,
                        ]),
                    };
                }

                let off = this.buffers.extern_strings.len() as u32;
                let len = bin_props.len() as u32 * 2;

                for bin_entry in bin_props {
                    let key = bin_entry.key.slice();
                    let script_value = bin_entry
                        .value
                        .as_str()
                        .ok_or(crate::Error::InvalidNPMLockfile)?;
                    let ek = sb.append_external(key)?;
                    let ev = sb.append_external(script_value)?;
                    this.buffers.extern_strings.push(ek);
                    this.buffers.extern_strings.push(ev);
                }

                #[cfg(debug_assertions)]
                {
                    debug_assert!(this.buffers.extern_strings.len() == (off + len) as usize);
                    debug_assert!(
                        this.buffers.extern_strings.len() <= this.buffers.extern_strings.capacity()
                    );
                }

                break 'bin Bin {
                    tag: bin::Tag::Map,
                    _padding_tag: [0; 3],
                    value: bin::Value::init_map(ExternalStringList::new(off, len)),
                };
            }
        } else {
            Bin::init()
        };

        let meta_value = lockfile::Meta {
            id: package_id,

            origin: if package_id == 0 {
                lockfile::Origin::Local
            } else {
                lockfile::Origin::Npm
            },

            arch: if let Some(cpu_array) = pkg.get(b"cpu") {
                'arch: {
                    let mut arch = Npm::Architecture::NONE.negatable();
                    let Some(arr) = cpu_array.as_array() else {
                        return Err(crate::Error::InvalidNPMLockfile);
                    };
                    let items = arr.items();
                    if items.is_empty() {
                        break 'arch arch.combine();
                    }
                    for item in items {
                        let Some(s) = item.as_str() else {
                            return Err(crate::Error::InvalidNPMLockfile);
                        };
                        arch.apply(s);
                    }
                    break 'arch arch.combine();
                }
            } else {
                Npm::Architecture::ALL
            },

            os: if let Some(cpu_array) = pkg.get(b"os") {
                'arch: {
                    let mut os = Npm::OperatingSystem::NONE.negatable();
                    let Some(arr) = cpu_array.as_array() else {
                        return Err(crate::Error::InvalidNPMLockfile);
                    };
                    let items = arr.items();
                    if items.is_empty() {
                        break 'arch Npm::OperatingSystem::ALL;
                    }
                    for item in items {
                        let Some(s) = item.as_str() else {
                            return Err(crate::Error::InvalidNPMLockfile);
                        };
                        os.apply(s);
                    }
                    break 'arch os.combine();
                }
            } else {
                Npm::OperatingSystem::ALL
            },

            man_dir: SemverString::default(),

            has_install_script: if let Some(h) = pkg.get(b"hasInstallScript") {
                let E::JsonValue::Boolean(b) = h else {
                    return Err(crate::Error::InvalidNPMLockfile);
                };
                if *b {
                    lockfile::HasInstallScript::True
                } else {
                    lockfile::HasInstallScript::False
                }
            } else {
                lockfile::HasInstallScript::False
            },

            integrity: if let Some(integrity) = pkg.get(b"integrity") {
                Integrity::parse(integrity.as_str().ok_or(crate::Error::InvalidNPMLockfile)?)
            } else {
                Integrity::default()
            },

            ..lockfile::Meta::default()
        };

        // Instead of calling this.appendPackage, manually append
        // the other function has some checks that will fail since we have not set resolution+dependencies yet.
        this.packages.append_assume_capacity(PackageListEntry {
            name: appended_name,
            name_hash,

            // For non workspace packages these are set to .uninitialized, then in the third phase
            // they are resolved. This is because the resolution uses the dependant's version
            // specifier as a "hint" to resolve the dependency.
            resolution: resolution_value,

            // we fill this data in later
            dependencies: ExternalSlice::default(),
            resolutions: ExternalSlice::default(),

            meta: meta_value,
            bin: bin_value,
            scripts: Default::default(),
        });

        if is_workspace {
            debug_assert!(package_id != 0); // root package should not be in it's own workspace

            // we defer doing getOrPutID for non-workspace packages because it depends on the resolution being set.
            this.get_or_put_id(package_id, name_hash)?;
        }
    }

    #[cfg(debug_assertions)]
    {
        debug_assert!(this.packages.len() == package_idx as usize);
    }

    // Both buffers are filled by pushing into the pre-reserved Vecs: capacity
    // for `num_deps` was reserved above so pushes never reallocate, and no raw
    // pointers are held across `&mut self` calls.

    // MultiArrayList column access — re-borrow the (disjoint) `resolution`,
    // `meta`, `dependencies` and `resolutions` columns of `this.packages` at each use
    // site via the generated `items_*` / `items_*_mut` accessors. Capacity is fixed
    // (no further append until end of fn), so the slices stay valid; re-acquiring per
    // statement keeps the borrows disjoint from the `&mut self` calls below.
    let pkg_count = this.packages.len();

    #[cfg(debug_assertions)]
    {
        for r in &this.packages.items_resolution()[..pkg_count] {
            debug_assert!(
                r.tag == resolution::Tag::Uninitialized || r.tag == resolution::Tag::Workspace
            );
        }
    }

    // Root resolution isn't hit through dependency tracing.
    if pkg_count == 0 {
        return Err(crate::Error::InvalidNPMLockfile);
    }
    this.packages.items_resolution_mut()[0] = Resolution::init(ResTagged::Root);
    this.packages.items_meta_mut()[0].origin = lockfile::Origin::Local;
    let root_name_hash = this.packages.items_name_hash()[0];
    this.get_or_put_id(0, root_name_hash)?;

    // made it longer than max path just in case something stupid happens
    let mut name_checking_buf = [0u8; MAX_PATH_BYTES * 2];

    // Dependency Linking Phase
    package_idx = 0;
    let mut is_first = true;
    'pkg_loop: for entry in packages_properties.iter() {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        let Some(pkg) = entry.value.as_object() else {
            unreachable!("npm lockfile: non-object Expr from JSON parser")
        };

        if pkg.get(b"link").is_some() || is_skipped_pkg(pkg) {
            continue;
        }

        let pkg_path = entry.key.slice();

        let dependencies_start = this.buffers.dependencies.len();
        let resolutions_start = this.buffers.resolutions.len();

        // `finalize_pkg!` writes dependencies_list/resolution_list and
        // increments package_idx; invoked at the one early-continue and at
        // natural end-of-loop.
        macro_rules! finalize_pkg {
            () => {{
                // package_idx < pkg_count; columns re-borrowed disjointly per statement.
                if dependencies_start == this.buffers.dependencies.len() {
                    this.packages.items_dependencies_mut()[package_idx as usize] =
                        ExternalSlice::default();
                    this.packages.items_resolutions_mut()[package_idx as usize] =
                        ExternalSlice::default();
                } else {
                    let len: u32 = (this.buffers.resolutions.len() - resolutions_start) as u32;
                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(len > 0);
                        debug_assert!(
                            len == (this.buffers.dependencies.len() - dependencies_start) as u32
                        );
                    }
                    this.packages.items_dependencies_mut()[package_idx as usize] =
                        ExternalSlice::new(dependencies_start as u32, len);
                    this.packages.items_resolutions_mut()[package_idx as usize] =
                        ExternalSlice::new(resolutions_start as u32, len);
                }
                package_idx += 1;
            }};
        }

        // a feature no one has heard about: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bundledependencies
        let bundled_dependencies: Option<StringArrayHashMap<()>> = if let Some(expr) = pkg
            .get(b"bundleDependencies")
            .or_else(|| pkg.get(b"bundledDependencies"))
        {
            'deps: {
                if let E::JsonValue::Boolean(b) = expr {
                    if *b {
                        finalize_pkg!();
                        continue 'pkg_loop;
                    }
                    break 'deps None;
                }
                let Some(arr) = expr.as_array() else {
                    return Err(crate::Error::InvalidNPMLockfile);
                };
                let items = arr.items();
                let mut map = StringArrayHashMap::<()>::with_capacity(items.len());
                for item in items {
                    let s = item.as_str().ok_or(crate::Error::InvalidNPMLockfile)?;
                    map.put_assume_capacity(s, ());
                }
                break 'deps Some(map);
            }
        } else {
            None
        };

        if is_first {
            is_first = false;
            if let Some(wksp) = &workspace_map {
                debug_assert_eq!(wksp.keys().len(), wksp.values().len());
                for (key, value) in wksp.keys().iter().zip(wksp.values()) {
                    let entry1 = id_map
                        .get(key.as_ref())
                        .copied()
                        .ok_or(crate::Error::InvalidNPMLockfile)?;
                    let name_hash = string_hash(&value.name);
                    let mut sb = this.string_buf();
                    let wksp_name = sb.append(&value.name)?;
                    let wksp_path = sb.append(key)?;
                    this.buffers.dependencies.push(Dependency {
                        name: wksp_name,
                        name_hash,
                        version: DepVersion {
                            tag: DepTag::Workspace,
                            literal: wksp_path,
                            value: DepValue {
                                workspace: wksp_path,
                            },
                        },
                        behavior: Behavior::WORKSPACE,
                    });
                    this.buffers.resolutions.push(entry1.new_package_id);
                }
            }
        }

        for dep_key in DEPENDENCY_KEYS {
            if let Some(deps) = pkg.get(dep_key.prop) {
                // fetch the peerDependenciesMeta if it exists
                // this is only done for peerDependencies, obviously
                let peer_dep_meta: Option<&E::ObjectJSON> = if dep_key.behavior == Behavior::PEER {
                    if let Some(expr) = pkg.get(b"peerDependenciesMeta") {
                        let Some(meta_obj) = expr.as_object() else {
                            return Err(crate::Error::InvalidNPMLockfile);
                        };
                        Some(meta_obj)
                    } else {
                        None
                    }
                } else {
                    None
                };

                let Some(deps_obj) = deps.as_object() else {
                    return Err(crate::Error::InvalidNPMLockfile);
                };

                'dep_loop: for prop in deps_obj.properties() {
                    let name_bytes = prop.key.slice();
                    if let Some(bd) = &bundled_dependencies {
                        if bd.contains_key(name_bytes) {
                            continue 'dep_loop;
                        }
                    }

                    let version_bytes = prop
                        .value
                        .as_str()
                        .ok_or(crate::Error::InvalidNPMLockfile)?;
                    let name_hash = string_hash(name_bytes);
                    let mut sb = this.string_buf();
                    let dep_name = sb.append_with_hash(name_bytes, name_hash)?;

                    let dep_version = sb.append(version_bytes)?;
                    let sliced = dep_version.sliced(sb.bytes.as_slice());

                    debug!(
                        "parsing {}, {}\n",
                        bstr::BStr::new(name_bytes),
                        bstr::BStr::new(version_bytes)
                    );
                    let Some(version) = Dependency::parse(
                        dep_name,
                        Some(name_hash),
                        sliced.slice,
                        &sliced,
                        Some(&mut *log),
                        Some(&mut *manager),
                    ) else {
                        return Err(crate::Error::InvalidNPMLockfile);
                    };
                    debug!("-> {}\n", <&'static str>::from(version.tag));

                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(version.tag != DepTag::Uninitialized);
                    }

                    let str_node_modules: &[u8] = if pkg_path.is_empty() {
                        b"node_modules/"
                    } else {
                        b"/node_modules/"
                    };
                    let suffix_len = str_node_modules.len() + name_bytes.len();

                    let mut buf_len: u32 =
                        u32::try_from(pkg_path.len() + suffix_len).expect("int cast");
                    if buf_len as usize > name_checking_buf.len() {
                        return Err(crate::Error::PathTooLong);
                    }

                    name_checking_buf[..pkg_path.len()].copy_from_slice(pkg_path);
                    name_checking_buf[pkg_path.len()..pkg_path.len() + str_node_modules.len()]
                        .copy_from_slice(str_node_modules);
                    name_checking_buf
                        [pkg_path.len() + str_node_modules.len()..pkg_path.len() + suffix_len]
                        .copy_from_slice(name_bytes);

                    loop {
                        debug!(
                            "checking {}",
                            bstr::BStr::new(&name_checking_buf[..buf_len as usize])
                        );
                        if let Some(found_) =
                            id_map.get(&name_checking_buf[..buf_len as usize]).copied()
                        {
                            let mut found = found_;
                            if found.new_package_id == PACKAGE_ID_IS_LINK {
                                // it is a workspace package, resolve from the "link": true entry to the real entry.
                                let Some(ref_pkg) = packages_properties
                                    [found.old_json_index as usize]
                                    .value
                                    .as_object()
                                else {
                                    unreachable!()
                                };
                                // the `else` here is technically possible to hit
                                let resolved_v = ref_pkg
                                    .get(b"resolved")
                                    .ok_or(crate::Error::LockfileWorkspaceMissingResolved)?;
                                let resolved = resolved_v
                                    .as_str()
                                    .ok_or(crate::Error::InvalidNPMLockfile)?;
                                found = id_map
                                    .get(resolved)
                                    .copied()
                                    .ok_or(crate::Error::InvalidNPMLockfile)?;
                            } else if found.new_package_id == PACKAGE_ID_IS_BUNDLED {
                                debug!(
                                    "skipping bundled dependency {}",
                                    bstr::BStr::new(name_bytes)
                                );
                                continue 'dep_loop;
                            }

                            let id = found.new_package_id;

                            let behavior = dep_key.behavior;

                            // Capture tag and git/github owner before moving
                            // `version` into the buffer. The owner is needed when
                            // `version.tag` is git/github but the package's `resolved`
                            // URL infers as something else.
                            let version_tag = version.tag;
                            let version_git_owner = match version_tag {
                                DepTag::Git => version.git().owner,
                                DepTag::Github => version.github().owner,
                                _ => SemverString::default(),
                            };

                            this.buffers.dependencies.push(Dependency {
                                name: dep_name,
                                name_hash,
                                version,
                                behavior,
                            });
                            this.buffers.resolutions.push(id);

                            // If the package resolution is not set, resolve the target package
                            // using the information we have from the dependency declaration.
                            // SAFETY: id < pkg_count (assigned during counting phase)
                            if this.packages.items_resolution()[id as usize].tag
                                == resolution::Tag::Uninitialized
                            {
                                debug!("resolving '{}'", bstr::BStr::new(name_bytes));

                                let mut res_version_tag = version_tag;
                                let mut res_version_git_owner = version_git_owner;

                                let res = 'resolved: {
                                    let Some(dep_pkg) = packages_properties
                                        [found.old_json_index as usize]
                                        .value
                                        .as_object()
                                    else {
                                        unreachable!()
                                    };
                                    let dep_resolved: &[u8] = 'dep_resolved: {
                                        if let Some(resolved) = dep_pkg.get(b"resolved") {
                                            let dep_resolved = resolved
                                                .as_str()
                                                .ok_or(crate::Error::InvalidNPMLockfile)?;
                                            match DepTag::infer(dep_resolved) {
                                                tag @ (DepTag::Git | DepTag::Github) => {
                                                    let mut sb = this.string_buf();
                                                    let dep_resolved_str =
                                                        sb.append(dep_resolved)?;
                                                    let dep_resolved_sliced = dep_resolved_str
                                                        .sliced(sb.bytes.as_slice());
                                                    let parsed = dependency::parse_with_tag(
                                                        dep_name,
                                                        Some(name_hash),
                                                        dep_resolved_sliced.slice,
                                                        tag,
                                                        &dep_resolved_sliced,
                                                        Some(&mut *log),
                                                        Some(&mut *manager as &mut dyn dependency::NpmAliasRegistry),
                                                    ).ok_or(crate::Error::InvalidNPMLockfile)?;
                                                    res_version_tag = parsed.tag;
                                                    res_version_git_owner =
                                                        if parsed.tag == DepTag::Git {
                                                            parsed.git().owner
                                                        } else {
                                                            parsed.github().owner
                                                        };

                                                    break 'dep_resolved dep_resolved;
                                                }
                                                // TODO(dylan-conway): might need to handle more cases
                                                _ => break 'dep_resolved dep_resolved,
                                            }
                                        }

                                        if version_tag == DepTag::Npm {
                                            if let Some(resolved_url) = resolved_urls
                                                .get(&name_checking_buf[..buf_len as usize])
                                            {
                                                break 'dep_resolved &resolved_url[..];
                                            }
                                        }

                                        let mut sb = this.string_buf();
                                        break 'resolved Resolution::init(ResTagged::Folder(
                                            sb.append(
                                                packages_properties[found.old_json_index as usize]
                                                    .key
                                                    .slice(),
                                            )?,
                                        ));
                                    };

                                    let mut sb = this.string_buf();
                                    break 'resolved match res_version_tag {
                                        DepTag::Uninitialized => panic!(
                                            "Version string {} resolved to `.uninitialized`",
                                            bstr::BStr::new(version_bytes)
                                        ),

                                        // npm does not support catalogs
                                        DepTag::Catalog => {
                                            return Err(crate::Error::InvalidNPMLockfile);
                                        }

                                        DepTag::Npm | DepTag::DistTag => {
                                            // It is theoretically possible to hit this in a case where the resolved dependency is NOT
                                            // an npm dependency, but that case is so convoluted that it is not worth handling.
                                            //
                                            // Deleting 'package-lock.json' would completely break the installation of the project.
                                            //
                                            // We assume that the given URL is to *some* npm registry, or the resolution is to a workspace package.
                                            // If it is a workspace package, then this branch will not be hit as the resolution was already set earlier.
                                            let dep_actual_version = dep_pkg
                                                .get(b"version")
                                                .ok_or(crate::Error::InvalidNPMLockfile)?
                                                .as_str()
                                                .ok_or(crate::Error::InvalidNPMLockfile)?;

                                            let dep_actual_version_str =
                                                sb.append(dep_actual_version)?;
                                            // Append the URL before slicing the version so the
                                            // backing buffer is stable while the slice is live.
                                            let url = sb.append(dep_resolved)?;
                                            let dep_actual_version_sliced =
                                                dep_actual_version_str.sliced(sb.bytes.as_slice());

                                            Resolution::init(ResTagged::Npm(VersionedURLType {
                                                url,
                                                version: Semver::Version::parse(
                                                    dep_actual_version_sliced,
                                                )
                                                .version
                                                .min(),
                                            }))
                                        }
                                        DepTag::Tarball => {
                                            if dep_resolved.starts_with(b"file:") {
                                                Resolution::init(ResTagged::LocalTarball(
                                                    sb.append(&dep_resolved[5..])?,
                                                ))
                                            } else {
                                                Resolution::init(ResTagged::RemoteTarball(
                                                    sb.append(dep_resolved)?,
                                                ))
                                            }
                                        }
                                        DepTag::Folder => Resolution::init(ResTagged::Folder(
                                            sb.append(dep_resolved)?,
                                        )),
                                        // not sure if this is possible to hit
                                        DepTag::Symlink => Resolution::init(ResTagged::Folder(
                                            sb.append(dep_resolved)?,
                                        )),
                                        DepTag::Workspace => {
                                            let appended = sb.append(dep_resolved)?;
                                            let mut input = appended.sliced(sb.bytes.as_slice());
                                            if input.slice.starts_with(b"workspace:") {
                                                input =
                                                    input.sub(&input.slice[b"workspace:".len()..]);
                                            }
                                            Resolution::init(ResTagged::Workspace(input.value()))
                                        }
                                        DepTag::Git => {
                                            let stripped = if dep_resolved.starts_with(b"git+") {
                                                sb.append(&dep_resolved[4..])?
                                            } else {
                                                sb.append(dep_resolved)?
                                            };
                                            let str = stripped.sliced(sb.bytes.as_slice());

                                            let hash_index =
                                                strings::last_index_of_char(str.slice, b'#')
                                                    .ok_or(crate::Error::InvalidNPMLockfile)?;

                                            if !crate::repository::is_safe_resolved_tag(
                                                &str.slice[hash_index + 1..],
                                            ) {
                                                return Err(crate::Error::InvalidNPMLockfile);
                                            }

                                            let commit =
                                                str.sub(&str.slice[hash_index + 1..]).value();
                                            Resolution::init(ResTagged::Git(Repository {
                                                owner: res_version_git_owner,
                                                repo: str.sub(&str.slice[..hash_index]).value(),
                                                committish: commit,
                                                resolved: commit,
                                                package_name: dep_name,
                                            }))
                                        }
                                        DepTag::Github => {
                                            let stripped = if dep_resolved.starts_with(b"git+") {
                                                sb.append(&dep_resolved[4..])?
                                            } else {
                                                sb.append(dep_resolved)?
                                            };
                                            let str = stripped.sliced(sb.bytes.as_slice());

                                            let hash_index =
                                                strings::last_index_of_char(str.slice, b'#')
                                                    .ok_or(crate::Error::InvalidNPMLockfile)?;

                                            if !crate::repository::is_safe_resolved_tag(
                                                &str.slice[hash_index + 1..],
                                            ) {
                                                return Err(crate::Error::InvalidNPMLockfile);
                                            }

                                            let commit =
                                                str.sub(&str.slice[hash_index + 1..]).value();
                                            Resolution::init(ResTagged::Git(Repository {
                                                owner: res_version_git_owner,
                                                repo: str.sub(&str.slice[..hash_index]).value(),
                                                committish: commit,
                                                resolved: commit,
                                                package_name: dep_name,
                                            }))
                                        }
                                    };
                                };
                                debug!(
                                    "-> {}",
                                    res.fmt_for_debug(this.buffers.string_bytes.as_slice())
                                );

                                if res.tag == resolution::Tag::Npm {
                                    let buf = this.buffers.string_bytes.as_slice();
                                    let url = res.npm().url.slice(buf);
                                    let configured_registry = manager
                                        .scope_for_package_name(
                                            this.packages.items_name()[id as usize].slice(buf),
                                        )
                                        .url
                                        .href();
                                    if !lockfile::bun_lock::url_is_under_registry(
                                        url,
                                        configured_registry,
                                    ) && !lockfile::bun_lock::url_is_under_registry(
                                        url,
                                        Npm::Registry::DEFAULT_URL.as_bytes(),
                                    ) && !this.packages.items_meta()[id as usize]
                                        .integrity
                                        .tag
                                        .is_supported()
                                    {
                                        return Err(crate::Error::InvalidNPMLockfile);
                                    }
                                }

                                // id < pkg_count; columns re-borrowed disjointly.
                                this.packages.items_resolution_mut()[id as usize] = res;
                                this.packages.items_meta_mut()[id as usize].origin = match res.tag {
                                    // This works?
                                    resolution::Tag::Root => lockfile::Origin::Local,
                                    _ => lockfile::Origin::Npm,
                                };

                                let nh = this.packages.items_name_hash()[id as usize];
                                this.get_or_put_id(id, nh)?;
                            }

                            continue 'dep_loop;
                        }

                        // step down each `node_modules/` of the source
                        let prefix_len = (buf_len as usize)
                            .saturating_sub(b"node_modules/".len() + name_bytes.len());
                        if let Some(idx) = strings::last_index_of(
                            &name_checking_buf[..prefix_len],
                            b"node_modules/",
                        ) {
                            debug!("found 'node_modules/' at {}", idx);
                            buf_len =
                                u32::try_from(idx + b"node_modules/".len() + name_bytes.len())
                                    .expect("int cast");
                            name_checking_buf[idx + b"node_modules/".len()
                                ..idx + b"node_modules/".len() + name_bytes.len()]
                                .copy_from_slice(name_bytes);
                        } else if !name_checking_buf[..buf_len as usize]
                            .starts_with(b"node_modules/")
                        {
                            // this is hit if you are at something like `packages/etc`, from `packages/etc/node_modules/xyz`
                            // we need to hit the root `node_modules/{name}`
                            buf_len = u32::try_from(b"node_modules/".len() + name_bytes.len())
                                .expect("int cast");
                            name_checking_buf[..b"node_modules/".len()]
                                .copy_from_slice(b"node_modules/");
                            name_checking_buf
                                [buf_len as usize - name_bytes.len()..buf_len as usize]
                                .copy_from_slice(name_bytes);
                        } else {
                            // optional peer dependencies can be ... optional
                            if dep_key.behavior == Behavior::PEER {
                                if let Some(o) = peer_dep_meta {
                                    if let Some(meta) = o.get(name_bytes) {
                                        let Some(meta_obj) = meta.as_object() else {
                                            return Err(crate::Error::InvalidNPMLockfile);
                                        };
                                        if let Some(optional) = meta_obj.get(b"optional") {
                                            let E::JsonValue::Boolean(b) = optional else {
                                                return Err(crate::Error::InvalidNPMLockfile);
                                            };
                                            if *b {
                                                let behavior = Behavior::OPTIONAL | Behavior::PEER;
                                                this.buffers.dependencies.push(Dependency {
                                                    name: dep_name,
                                                    name_hash,
                                                    version,
                                                    behavior,
                                                });
                                                this.buffers
                                                    .resolutions
                                                    .push(Install::INVALID_PACKAGE_ID);
                                                continue 'dep_loop;
                                            }
                                        }
                                    }
                                }
                            }

                            // it is technically possible to get a package-lock.json without a dependency.
                            // it's very unlikely, but possible. when NPM sees this, it essentially doesnt install the package, and treats it like it doesn't exist.
                            // in test/cli/install/migrate-fixture, you can observe this for `iconv-lite`
                            debug!(
                                "could not find package '{}' in '{}'",
                                bstr::BStr::new(name_bytes),
                                bstr::BStr::new(pkg_path)
                            );
                            continue 'dep_loop;
                        }
                    }
                }
            }
        }

        finalize_pkg!();
    }

    clear_non_registry_platform_constraints(this);

    // It is our fault if we hit an error here, making it safe to disable in release.
    #[cfg(debug_assertions)]
    {
        debug_assert!(this.buffers.dependencies.len() == this.buffers.resolutions.len());
        debug_assert!(this.buffers.dependencies.len() <= num_deps as usize);
        let mut crash = false;
        for (i, r) in this.buffers.dependencies.iter().enumerate() {
            // 'if behavior is uninitialized'
            if Behavior::eq(r.behavior, Behavior::default()) {
                debug!("dependency index '{}' was not set", i);
                crash = true;
            }
        }
        for (i, r) in this.buffers.resolutions.iter().enumerate() {
            if *r == UNSET_PACKAGE_ID {
                debug!("resolution index '{}' was not set", i);
                crash = true;
            }
        }
        if crash {
            panic!("Assertion failure, see above");
        }
    }

    // A package not having a resolution, however, is not our fault.
    // This can be triggered by a bad lockfile with extra packages. NPM should trim packages out automatically.
    let mut is_missing_resolutions = false;
    for i in 0..pkg_count {
        let r = &this.packages.items_resolution()[i];
        if r.tag == resolution::Tag::Uninitialized {
            bun_core::warn!(
                "Could not resolve package '{}' in lockfile during migration",
                bstr::BStr::new(this.packages.items_name()[i].slice(&this.buffers.string_bytes)),
            );
            is_missing_resolutions = true;
        } else {
            #[cfg(debug_assertions)]
            {
                // Assertion from appendPackage. If we do this too early it will always fail as we dont have the resolution written
                // but after we write all the data, there is no excuse for this to fail.
                //
                // If this is hit, it means getOrPutID was not called on this package id. Look for where 'resolution[i]' is set
                debug_assert!(
                    this.get_package_id(this.packages.items_name_hash()[i], None, r)
                        .is_some()
                );
            }
        }
    }
    if is_missing_resolutions {
        return Err(crate::Error::NotAllPackagesGotResolved);
    }

    this.resolve(log)?;

    #[cfg(debug_assertions)]
    {
        this.verify_data()?;
    }

    this.meta_hash = this.generate_meta_hash(false, this.packages.len())?;

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile: this,
        migrated: Migrated::Npm,
        loaded_from_binary_lockfile: false,
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

/// Skip predicate shared by the package counting, building, and linking
/// passes — all three must agree, otherwise the later passes append more
/// packages than the counting pass reserved.
fn is_skipped_pkg(pkg: &E::ObjectJSON) -> bool {
    pkg_flag_is_true(pkg, b"inBundle") || pkg_flag_is_true(pkg, b"extraneous")
}

fn package_name_from_path(pkg_path: &[u8]) -> &[u8] {
    if pkg_path.is_empty() {
        return b"";
    }

    let pkg_name_start: usize =
        if let Some(last_index) = strings::last_index_of(pkg_path, b"/node_modules/") {
            last_index + b"/node_modules/".len()
        } else if pkg_path.starts_with(b"node_modules/") {
            b"node_modules/".len()
        } else if let Some(last_index) = strings::last_index_of(pkg_path, b"/") {
            // Link targets outside `node_modules/` (e.g. `vendor/a`) use the
            // path's basename; keep the scope (`vendor/@scope/a`) like npm's
            // `name-from-folder`, which omits `name` when it matches this.
            let parent = &pkg_path[..last_index];
            match strings::last_index_of(parent, b"/") {
                Some(i) if parent[i + 1..].starts_with(b"@") => i + b"/".len(),
                None if parent.starts_with(b"@") => 0,
                _ => last_index + b"/".len(),
            }
        } else {
            0
        };

    &pkg_path[pkg_name_start..]
}

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    Semver::semver_string::Builder::string_hash(s)
}
