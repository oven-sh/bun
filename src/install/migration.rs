use bun_ast::{E, Expr, ExprData};
use bun_collections::VecExt;
use bun_collections::{StringArrayHashMap, StringHashMap};
use bun_core::strings;
use bun_core::{Error, Global, Output, err, zstr};
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
use crate::lockfile_real::package::workspace_map::WorkspaceMap;
use crate::lockfile_real::package::{PackageColumns as _, PackageField};
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
                if e == err!("NPMLockfileVersionMismatch") {
                    Output::pretty_errorln(
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
            Output::pretty_error(" ");
            Output::pretty_errorln("<d>migrated lockfile from <r><green>package-lock.json<r>");
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
            Output::pretty_error(" ");
            Output::pretty_errorln("<d>migrated lockfile from <r><green>yarn.lock<r>");
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
                        Output::pretty_errorln(
                            "<red><b>warning<r><d>:<r> pnpm-lock.yaml version is too old (\\< v7)\n\nPlease upgrade using 'pnpm install --lockfile-only' first, then try again.",
                        );
                    }
                    MigratePnpmLockfileError::NonExistentWorkspaceDependency => {
                        Output::warn(
                            "Workspace link dependencies to non-existent folders aren't supported yet in pnpm-lock.yaml migration. Please follow along at <magenta>https://github.com/oven-sh/bun/issues/23026<r>",
                        );
                    }
                    MigratePnpmLockfileError::RelativeLinkDependency => {
                        Output::warn(
                            "Relative link dependencies aren't supported yet. Please follow along at <magenta>https://github.com/oven-sh/bun/issues/23026<r>",
                        );
                    }
                    MigratePnpmLockfileError::WorkspaceNameMissing => {
                        if log.has_errors() {
                            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        }
                        Output::warn(
                            "pnpm-lock.yaml migration failed due to missing workspace name.",
                        );
                    }
                    MigratePnpmLockfileError::YamlParseError => {
                        if log.has_errors() {
                            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        }
                        Output::warn("Failed to parse pnpm-lock.yaml.");
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
            Output::pretty_error(" ");
            Output::pretty_errorln("<d>migrated lockfile from <r><green>pnpm-lock.yaml<r>");
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

const UNSET_PACKAGE_ID: PackageID = Install::INVALID_PACKAGE_ID - 1;

use bun_install_types::DependencyGroup;
// Order preserved: deps→dev→peer→optional.
const DEPENDENCY_KEYS: [DependencyGroup; 4] = [
    DependencyGroup::DEPENDENCIES,
    DependencyGroup::DEV,
    DependencyGroup::PEER,
    DependencyGroup::OPTIONAL,
];

pub fn migrate_npm_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
    abs_path: &[u8],
) -> Result<LoadResult<'a>, Error> {
    // TODO(port): narrow error set
    debug!("begin lockfile migration");

    this.init_empty();
    Install::initialize_store();

    let arena = bun_alloc::Arena::new();
    let json_src = bun_ast::Source::init_path_string(abs_path, data);
    let json = bun_parsers::json::parse_utf8(&json_src, log, &arena)
        .map_err(|_| err!("InvalidNPMLockfile"))?;

    if !matches!(json.data, ExprData::EObject(_)) {
        return Err(err!("InvalidNPMLockfile"));
    }
    if let Some(version) = json.get(b"lockfileVersion") {
        if !(matches!(version.data, ExprData::ENumber(n) if n.value >= 2.0 && n.value <= 3.0)) {
            return Err(err!("NPMLockfileVersionMismatch"));
        }
    } else {
        return Err(err!("InvalidNPMLockfile"));
    }

    bun_core::analytics::Features::lockfile_migration_from_package_lock_inc();

    // Count pass

    // `StoreRef<T>` is `Copy` + safe-`Deref` (arena-backed), so copy the
    // handles out of the block instead of forging `&'static` via `as_ptr()`.
    let root_package: bun_ast::StoreRef<E::Object>;
    let packages_obj: bun_ast::StoreRef<E::Object> = 'brk: {
        let Some(obj) = json.get(b"packages") else {
            return Err(err!("InvalidNPMLockfile"));
        };
        let ExprData::EObject(eobj) = &obj.data else {
            return Err(err!("InvalidNPMLockfile"));
        };
        if eobj.properties.len_u32() == 0 {
            return Err(err!("InvalidNPMLockfile"));
        }
        let prop1 = eobj.properties.at(0);
        if let Some(k) = &prop1.key {
            let ExprData::EString(s) = &k.data else {
                return Err(err!("InvalidNPMLockfile"));
            };
            // first key must be the "", self reference
            if !s.data.is_empty() {
                return Err(err!("InvalidNPMLockfile"));
            }
            let ExprData::EObject(rp) = &prop1
                .value
                .as_ref()
                .expect("infallible: prop has value")
                .data
            else {
                return Err(err!("InvalidNPMLockfile"));
            };
            root_package = *rp;
        } else {
            return Err(err!("InvalidNPMLockfile"));
        }
        break 'brk *eobj;
    };
    let packages_properties = packages_obj.properties.slice();

    let mut num_deps: u32 = 0;

    let workspace_map: Option<WorkspaceMap> = 'workspace_map: {
        // `StoreRef::get` shadows `E::Object::get`; chain through it.
        if let Some(wksp) = root_package.get().get(b"workspaces") {
            let mut workspaces = WorkspaceMap::init();

            let json_array = match &wksp.data {
                ExprData::EArray(arr) => *arr,
                ExprData::EObject(obj) => {
                    // PORT NOTE: `StoreRef::get` shadows `E::Object::get`; deref-coerce.
                    let obj: &E::Object = obj;
                    if let Some(packages) = obj.get(b"packages") {
                        match &packages.data {
                            ExprData::EArray(arr) => *arr,
                            _ => return Err(err!("InvalidNPMLockfile")),
                        }
                    } else {
                        return Err(err!("InvalidNPMLockfile"));
                    }
                }
                _ => return Err(err!("InvalidNPMLockfile")),
            };

            // due to package paths and resolved properties for links and workspaces always having
            // forward slashes, we depend on `processWorkspaceNamesArray` to always return workspace
            // paths with forward slashes on windows
            let workspace_packages_count = workspaces.process_names_array(
                &mut manager.workspace_package_json_cache,
                log,
                // `StoreRef<E::Array>` is Copy + safe-Deref (arena-backed).
                &*json_array,
                &json_src,
                wksp.loc,
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
        let pkg_path = entry
            .key
            .as_ref()
            .expect("infallible: prop has key")
            .as_string(&arena)
            .unwrap();
        let ExprData::EObject(pkg) = &entry
            .value
            .as_ref()
            .expect("infallible: prop has value")
            .data
        else {
            return Err(err!("InvalidNPMLockfile"));
        };
        // PORT NOTE: `StoreRef::get` shadows `E::Object::get`; deref-coerce.
        let pkg: &E::Object = pkg;

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
        if let Some(x) = pkg.get(b"inBundle") {
            if matches!(x.data, ExprData::EBoolean(b) if b.value) {
                id_map.put_assume_capacity(
                    pkg_path,
                    IdMapValue {
                        old_json_index: i as u32,
                        new_package_id: PACKAGE_ID_IS_BUNDLED,
                    },
                );
                continue;
            }
        }
        if let Some(x) = pkg.get(b"extraneous") {
            if matches!(x.data, ExprData::EBoolean(b) if b.value) {
                continue;
            }
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
                let ExprData::EObject(deps_obj) = &deps.data else {
                    return Err(err!("InvalidNPMLockfile"));
                };
                num_deps = num_deps.saturating_add(deps_obj.properties.len_u32() as u32);
            }
        }

        if let Some(bin) = pkg.get(b"bin") {
            let ExprData::EObject(bin_obj) = &bin.data else {
                return Err(err!("InvalidNPMLockfile"));
            };
            match bin_obj.properties.len_u32() {
                0 => return Err(err!("InvalidNPMLockfile")),
                1 => {}
                n => {
                    num_extern_strings += (n * 2) as u32;
                }
            }
        }

        if pkg.get(b"resolved").is_none() {
            let version_prop = pkg.get(b"version");
            let pkg_name = package_name_from_path(pkg_path);
            if version_prop.is_some() && !pkg_name.is_empty() {
                // construct registry url
                let href: &[u8] = manager.scope_for_package_name(pkg_name).url.href();
                let mut count: usize = 0;
                count += href.len() + pkg_name.len() + b"/-/".len();
                if pkg_name[0] == b'@' {
                    // scoped
                    let Some(slash_index) = strings::index_of_char(pkg_name, b'/') else {
                        return Err(err!("InvalidNPMLockfile"));
                    };
                    let slash_index = slash_index as usize;
                    if slash_index >= pkg_name.len() - 1 {
                        return Err(err!("InvalidNPMLockfile"));
                    }
                    count += pkg_name[slash_index + 1..].len();
                } else {
                    count += pkg_name.len();
                }
                let Some(version_str) = version_prop.unwrap().as_string(&arena) else {
                    return Err(err!("InvalidNPMLockfile"));
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
        return Err(err!("InvalidNPMLockfile")); // lol
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
    // PORT NOTE: reshaped for borrowck — `string_buf()` borrows `this` mutably,
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
            // PERF(port): was assume_capacity

            if let Some(version_string) = &v.version {
                let sliced_version = SlicedString::init(version_string, version_string);
                let result = Semver::Version::parse(sliced_version);
                if result.valid && result.wildcard == Wildcard::None {
                    this.workspace_versions
                        .insert(name_hash, result.version.min());
                    // PERF(port): was assume_capacity
                }
            }
        }
    }

    // Package Building Phase
    // This initializes every package and sets the resolution to uninitialized
    for entry in packages_properties.iter() {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        let ExprData::EObject(pkg) = &entry
            .value
            .as_ref()
            .expect("infallible: prop has value")
            .data
        else {
            unreachable!("npm lockfile: non-object Expr from JSON parser")
        };
        // PORT NOTE: `StoreRef::get` shadows `E::Object::get`; deref-coerce.
        let pkg: &E::Object = pkg;

        let pkg_path = entry
            .key
            .as_ref()
            .expect("infallible: prop has key")
            .as_string(&arena)
            .unwrap();

        if let Some(link) = pkg.get(b"link") {
            if let Some(wksp) = &workspace_map {
                if !matches!(link.data, ExprData::EBoolean(_)) {
                    continue;
                }
                if let ExprData::EBoolean(b) = link.data {
                    if b.value {
                        if let Some(resolved) = pkg.get(b"resolved") {
                            if !matches!(resolved.data, ExprData::EString(_)) {
                                continue;
                            }
                            let resolved_str = resolved.as_string(&arena).unwrap();
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

        if pkg
            .get(b"inBundle")
            .or_else(|| pkg.get(b"extraneous"))
            .map(|x| matches!(x.data, ExprData::EBoolean(b) if b.value))
            .unwrap_or(false)
        {
            continue;
        }

        let workspace_entry = workspace_map.as_ref().and_then(|map| map.get(pkg_path));
        let is_workspace = workspace_entry.is_some();

        let pkg_name: &[u8] = if let Some(e) = workspace_entry {
            &e.name
        } else if let Some(set_name) = pkg.get(b"name") {
            set_name.as_string(&arena).expect("unreachable")
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
                let ExprData::EObject(bin_obj) = &bin.data else {
                    unreachable!("npm lockfile: non-object Expr from JSON parser")
                };
                debug_assert!(bin_obj.properties.len_u32() > 0);

                // in npm lockfile, the bin is always an object, even if it is only a single one
                // we need to detect if it's a single entry and lower it to a file.
                if bin_obj.properties.len_u32() == 1 {
                    let prop = bin_obj.properties.at(0);
                    let key = prop
                        .key
                        .as_ref()
                        .expect("infallible: prop has key")
                        .as_string(&arena)
                        .ok_or(err!("InvalidNPMLockfile"))?;
                    let script_value = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_string(&arena)
                        .ok_or(err!("InvalidNPMLockfile"))?;

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
                let len = u32::try_from(bin_obj.properties.len_u32() * 2).expect("int cast");

                for bin_entry in bin_obj.properties.slice() {
                    let key = bin_entry
                        .key
                        .as_ref()
                        .expect("infallible: prop has key")
                        .as_string(&arena)
                        .ok_or(err!("InvalidNPMLockfile"))?;
                    let script_value = bin_entry
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_string(&arena)
                        .ok_or(err!("InvalidNPMLockfile"))?;
                    let ek = sb.append_external(key)?;
                    let ev = sb.append_external(script_value)?;
                    this.buffers.extern_strings.push(ek);
                    this.buffers.extern_strings.push(ev);
                    // PERF(port): was assume_capacity
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
                    let ExprData::EArray(arr) = &cpu_array.data else {
                        return Err(err!("InvalidNPMLockfile"));
                    };
                    if arr.items.len_u32() == 0 {
                        break 'arch arch.combine();
                    }
                    for item in arr.items.slice() {
                        let ExprData::EString(s) = &item.data else {
                            return Err(err!("InvalidNPMLockfile"));
                        };
                        arch.apply(&s.data);
                    }
                    break 'arch arch.combine();
                }
            } else {
                Npm::Architecture::ALL
            },

            os: if let Some(cpu_array) = pkg.get(b"os") {
                'arch: {
                    let mut os = Npm::OperatingSystem::NONE.negatable();
                    let ExprData::EArray(arr) = &cpu_array.data else {
                        return Err(err!("InvalidNPMLockfile"));
                    };
                    if arr.items.len_u32() == 0 {
                        break 'arch Npm::OperatingSystem::ALL;
                    }
                    for item in arr.items.slice() {
                        let ExprData::EString(s) = &item.data else {
                            return Err(err!("InvalidNPMLockfile"));
                        };
                        os.apply(&s.data);
                    }
                    break 'arch os.combine();
                }
            } else {
                Npm::OperatingSystem::ALL
            },

            man_dir: SemverString::default(),

            has_install_script: if let Some(h) = pkg.get(b"hasInstallScript") {
                let ExprData::EBoolean(b) = h.data else {
                    return Err(err!("InvalidNPMLockfile"));
                };
                if b.value {
                    lockfile::HasInstallScript::True
                } else {
                    lockfile::HasInstallScript::False
                }
            } else {
                lockfile::HasInstallScript::False
            },

            integrity: if let Some(integrity) = pkg.get(b"integrity") {
                Integrity::parse(
                    integrity
                        .as_string(&arena)
                        .ok_or(err!("InvalidNPMLockfile"))?,
                )
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

    // ignoring length check because we pre-allocated it. the length may shrink later
    // so it's faster if we ignore the underlying length buffer and just assign it at the very end.
    // PORT NOTE: reshaped for borrowck — track cursor indices into reserved capacity instead of
    // shrinking slices via pointer arithmetic.
    let dependencies_base: *mut Dependency = this.buffers.dependencies.as_mut_ptr();
    let resolutions_base: *mut PackageID = this.buffers.resolutions.as_mut_ptr();
    let mut deps_cursor: usize = 0;
    let mut res_cursor: usize = 0;
    // TODO(port/phase-b): Stacked-Borrows audit — these raw ptrs into
    // `buffers.{dependencies,resolutions}` and the `packages` columns below are
    // held across `&mut self` calls to `string_buf()` / `get_or_put_id()`. The
    // fields actually touched are disjoint (string_bytes/string_pool resp.
    // package_index + read of resolutions), so this is sound under Tree
    // Borrows and matches the Zig spec, but SB retags through `Unique<T>`.
    // Fix by split-borrowing the disjoint fields (see the `bin` path above) or
    // by setting Vec lengths up-front and indexing safely.

    // pre-initialize the dependencies and resolutions to `unset_package_id`
    #[cfg(debug_assertions)]
    {
        // SAFETY: capacity reserved above for num_deps
        unsafe {
            for i in 0..(num_deps as usize) {
                core::ptr::write(dependencies_base.add(i), Dependency::default());
                core::ptr::write(resolutions_base.add(i), UNSET_PACKAGE_ID);
            }
        }
    }

    // PORT NOTE: MultiArrayList column access — re-borrow the (disjoint) `resolution`,
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
        return Err(err!("InvalidNPMLockfile"));
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
        let ExprData::EObject(pkg) = &entry
            .value
            .as_ref()
            .expect("infallible: prop has value")
            .data
        else {
            unreachable!("npm lockfile: non-object Expr from JSON parser")
        };
        // PORT NOTE: `StoreRef::get` shadows `E::Object::get`; deref-coerce.
        let pkg: &E::Object = pkg;

        if pkg.get(b"link").is_some()
            || pkg
                .get(b"inBundle")
                .or_else(|| pkg.get(b"extraneous"))
                .map(|x| matches!(x.data, ExprData::EBoolean(b) if b.value))
                .unwrap_or(false)
        {
            continue;
        }

        let pkg_path = entry
            .key
            .as_ref()
            .expect("infallible: prop has key")
            .as_string(&arena)
            .unwrap();

        let dependencies_start = deps_cursor;
        let resolutions_start = res_cursor;

        // PORT NOTE: Zig used `defer` here to write dependencies_list/resolution_list and
        // increment package_idx at every loop exit. Reshaped for borrowck — inlined as
        // `finalize_pkg!` at the one early-continue and at natural end-of-loop.
        macro_rules! finalize_pkg {
            () => {{
                // package_idx < pkg_count; columns re-borrowed disjointly per statement.
                if dependencies_start == deps_cursor {
                    this.packages.items_dependencies_mut()[package_idx as usize] =
                        ExternalSlice::default();
                    this.packages.items_resolutions_mut()[package_idx as usize] =
                        ExternalSlice::default();
                } else {
                    let len: u32 = (res_cursor - resolutions_start) as u32;
                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(len > 0);
                        debug_assert!(len == (deps_cursor - dependencies_start) as u32);
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
                if let ExprData::EBoolean(b) = expr.data {
                    if b.value {
                        finalize_pkg!();
                        continue 'pkg_loop;
                    }
                    break 'deps None;
                }
                let ExprData::EArray(arr) = &expr.data else {
                    return Err(err!("InvalidNPMLockfile"));
                };
                let mut map = StringArrayHashMap::<()>::with_capacity(arr.items.len_u32() as usize);
                for item in arr.items.slice() {
                    let s = item.as_string(&arena).ok_or(err!("InvalidNPMLockfile"))?;
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
                        .ok_or(err!("InvalidNPMLockfile"))?;
                    let name_hash = string_hash(&value.name);
                    let mut sb = this.string_buf();
                    let wksp_name = sb.append(&value.name)?;
                    let wksp_path = sb.append(key)?;
                    // SAFETY: deps_cursor < num_deps; capacity reserved above
                    unsafe {
                        core::ptr::write(
                            dependencies_base.add(deps_cursor),
                            Dependency {
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
                            },
                        );
                        core::ptr::write(resolutions_base.add(res_cursor), entry1.new_package_id);
                    }
                    deps_cursor += 1;
                    res_cursor += 1;
                }
            }
        }

        for dep_key in DEPENDENCY_KEYS {
            if let Some(deps) = pkg.get(dep_key.prop) {
                // fetch the peerDependenciesMeta if it exists
                // this is only done for peerDependencies, obviously
                let peer_dep_meta: Option<Expr> = if dep_key.behavior == Behavior::PEER {
                    if let Some(expr) = pkg.get(b"peerDependenciesMeta") {
                        if !matches!(expr.data, ExprData::EObject(_)) {
                            return Err(err!("InvalidNPMLockfile"));
                        }
                        Some(expr)
                    } else {
                        None
                    }
                } else {
                    None
                };

                let ExprData::EObject(deps_obj) = &deps.data else {
                    return Err(err!("InvalidNPMLockfile"));
                };

                'dep_loop: for prop in deps_obj.properties.slice() {
                    let name_bytes = prop
                        .key
                        .as_ref()
                        .expect("infallible: prop has key")
                        .as_string(&arena)
                        .unwrap();
                    if let Some(bd) = &bundled_dependencies {
                        if bd.contains_key(name_bytes) {
                            continue 'dep_loop;
                        }
                    }

                    let version_bytes = prop
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_string(&arena)
                        .ok_or(err!("InvalidNPMLockfile"))?;
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
                        return Err(err!("InvalidNPMLockfile"));
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
                        return Err(err!("PathTooLong"));
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
                                let ExprData::EObject(ref_pkg) = &packages_properties
                                    [found.old_json_index as usize]
                                    .value
                                    .as_ref()
                                    .unwrap()
                                    .data
                                else {
                                    unreachable!()
                                };
                                let ref_pkg: &E::Object = ref_pkg;
                                // the `else` here is technically possible to hit
                                let resolved_v = ref_pkg
                                    .get(b"resolved")
                                    .ok_or(err!("LockfileWorkspaceMissingResolved"))?;
                                let resolved = resolved_v
                                    .as_string(&arena)
                                    .ok_or(err!("InvalidNPMLockfile"))?;
                                found = id_map
                                    .get(resolved)
                                    .copied()
                                    .ok_or(err!("InvalidNPMLockfile"))?;
                            } else if found.new_package_id == PACKAGE_ID_IS_BUNDLED {
                                debug!(
                                    "skipping bundled dependency {}",
                                    bstr::BStr::new(name_bytes)
                                );
                                continue 'dep_loop;
                            }

                            let id = found.new_package_id;

                            let behavior = dep_key.behavior;

                            // PORT NOTE: capture tag and git/github owner before moving
                            // `version` into the buffer (Zig copies the struct by value; Rust
                            // moves it). The owner is needed when `version.tag` is git/github
                            // but the package's `resolved` URL infers as something else, in
                            // which case Zig reads `res_version.value.{git,github}.owner` from
                            // the original parsed dependency version.
                            let version_tag = version.tag;
                            let version_git_owner = match version_tag {
                                DepTag::Git => version.git().owner,
                                DepTag::Github => version.github().owner,
                                _ => SemverString::default(),
                            };

                            // SAFETY: cursor < num_deps; capacity reserved
                            unsafe {
                                core::ptr::write(
                                    dependencies_base.add(deps_cursor),
                                    Dependency {
                                        name: dep_name,
                                        name_hash,
                                        version,
                                        behavior,
                                    },
                                );
                                core::ptr::write(resolutions_base.add(res_cursor), id);
                            }
                            deps_cursor += 1;
                            res_cursor += 1;

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
                                    let ExprData::EObject(dep_pkg) = &packages_properties
                                        [found.old_json_index as usize]
                                        .value
                                        .as_ref()
                                        .unwrap()
                                        .data
                                    else {
                                        unreachable!()
                                    };
                                    let dep_pkg: &E::Object = dep_pkg;
                                    let dep_resolved: &[u8] = 'dep_resolved: {
                                        if let Some(resolved) = dep_pkg.get(b"resolved") {
                                            let dep_resolved = resolved
                                                .as_string(&arena)
                                                .ok_or(err!("InvalidNPMLockfile"))?;
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
                                                    ).ok_or(err!("InvalidNPMLockfile"))?;
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
                                                    .as_ref()
                                                    .unwrap()
                                                    .as_string(&arena)
                                                    .unwrap(),
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
                                        DepTag::Catalog => return Err(err!("InvalidNPMLockfile")),

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
                                                .ok_or(err!("InvalidNPMLockfile"))?
                                                .as_string(&arena)
                                                .ok_or(err!("InvalidNPMLockfile"))?;

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
                                                    .ok_or(err!("InvalidNPMLockfile"))?;

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
                                                    .ok_or(err!("InvalidNPMLockfile"))?;

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
                                if let Some(o) = &peer_dep_meta {
                                    if let Some(meta) = o.get(name_bytes) {
                                        let ExprData::EObject(meta_obj) = &meta.data else {
                                            return Err(err!("InvalidNPMLockfile"));
                                        };
                                        let meta_obj: &E::Object = meta_obj;
                                        if let Some(optional) = meta_obj.get(b"optional") {
                                            let ExprData::EBoolean(b) = optional.data else {
                                                return Err(err!("InvalidNPMLockfile"));
                                            };
                                            if b.value {
                                                let behavior = Behavior::OPTIONAL | Behavior::PEER;
                                                // SAFETY: cursor < num_deps; capacity reserved
                                                unsafe {
                                                    core::ptr::write(
                                                        dependencies_base.add(deps_cursor),
                                                        Dependency {
                                                            name: dep_name,
                                                            name_hash,
                                                            version,
                                                            behavior,
                                                        },
                                                    );
                                                    core::ptr::write(
                                                        resolutions_base.add(res_cursor),
                                                        Install::INVALID_PACKAGE_ID,
                                                    );
                                                }
                                                deps_cursor += 1;
                                                res_cursor += 1;
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

    // SAFETY: res_cursor elements written above into reserved capacity
    unsafe {
        this.buffers.resolutions.set_len(res_cursor);
        this.buffers.dependencies.set_len(res_cursor);
    }

    // In allow_assert, we prefill this buffer with uninitialized values that we can detect later
    // It is our fault if we hit an error here, making it safe to disable in release.
    #[cfg(debug_assertions)]
    {
        debug_assert!(this.buffers.dependencies.len() == deps_cursor);
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
            Output::warn(format_args!(
                "Could not resolve package '{}' in lockfile during migration",
                bstr::BStr::new(this.packages.items_name()[i].slice(&this.buffers.string_bytes)),
            ));
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
        return Err(err!("NotAllPackagesGotResolved"));
    }

    this.resolve(log)?;

    // if (Environment.isDebug) {
    //     const dump_file = try std.fs.cwd().createFileZ("after-clean.json", .{});
    //     defer dump_file.close();
    //     try std.json.stringify(this, .{ .whitespace = .indent_2 }, dump_file.writer());
    // }

    #[cfg(debug_assertions)]
    {
        this.verify_data()?;
    }

    this.meta_hash = this.generate_meta_hash(false, this.packages.len())?;

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile: this,
        // TODO(port): lifetime — LoadResult holds &mut Lockfile in Zig; verify Rust ownership
        migrated: Migrated::Npm,
        loaded_from_binary_lockfile: false,
        serializer_result: Default::default(),
        format: LockfileFormat::Binary,
    }))
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
        } else {
            strings::last_index_of(pkg_path, b"/").unwrap_or(0)
        };

    &pkg_path[pkg_name_start..]
}

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    Semver::semver_string::Builder::string_hash(s)
}

// ported from: src/install/migration.zig
