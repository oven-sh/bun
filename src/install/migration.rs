use bun_collections::{StringHashMap, ArrayHashMap};
use bun_core::{err, Error, Global, Output};
use bun_logger as logger;
use bun_paths::{self, MAX_PATH_BYTES, PathBuffer};
use bun_semver::{self as Semver, String as SemverString};
use bun_str::strings;
use bun_sys::{self, Fd, File, O};
use bun_js_parser::ast::E;

use crate::dependency::Dependency;
use crate::install::{self as Install, PackageID, PackageManager, ExternalStringList};
use crate::npm::{self as Npm};
use crate::bin::Bin;
use crate::integrity::Integrity;
use crate::resolution::Resolution;
use crate::lockfile::{self, Lockfile, LoadResult};
use crate::yarn;
use crate::pnpm;

bun_output::declare_scope!(migrate, visible);

macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(migrate, $($args)*) };
}

pub fn detect_and_load_other_lockfile(
    this: &mut Lockfile,
    dir: Fd,
    manager: &mut PackageManager,
    log: &mut logger::Log,
) -> LoadResult {
    // check for package-lock.json, yarn.lock, etc...
    // if it exists, do an in-memory migration

    'npm: {
        let timer = std::time::Instant::now();
        let Ok(lockfile) = File::openat(dir, b"package-lock.json", O::RDONLY, 0) else {
            break 'npm;
        };
        // file closes on Drop
        let mut lockfile_path_buf = PathBuffer::uninit();
        let Ok(lockfile_path) = bun_sys::get_fd_path_z(lockfile.handle(), &mut lockfile_path_buf) else {
            break 'npm;
        };
        let Ok(data) = lockfile.read_to_end() else {
            break 'npm;
        };
        let migrate_result = match migrate_npm_lockfile(this, manager, log, &data, lockfile_path.as_bytes()) {
            Ok(r) => r,
            Err(e) => {
                if e == err!("NPMLockfileVersionMismatch") {
                    Output::pretty_errorln(
                        "<red><b>error<r><d>:<r> Please upgrade package-lock.json to lockfileVersion 2 or 3\n\nRun 'npm i --lockfile-version 3 --frozen-lockfile' to upgrade your lockfile without changing dependencies.",
                        format_args!(""),
                    );
                    Global::exit(1);
                }
                return LoadResult::Err {
                    step: lockfile::LoadStep::Migrating,
                    value: e,
                    lockfile_path: b"package-lock.json",
                    format: lockfile::Format::Text,
                };
            }
        };

        if matches!(migrate_result, LoadResult::Ok { .. }) {
            Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
            Output::pretty_error(" ", format_args!(""));
            Output::pretty_errorln("<d>migrated lockfile from <r><green>package-lock.json<r>", format_args!(""));
            Output::flush();
        }

        return migrate_result;
    }

    'yarn: {
        let timer = std::time::Instant::now();
        let Ok(lockfile) = File::openat(dir, b"yarn.lock", O::RDONLY, 0) else {
            break 'yarn;
        };
        let Ok(data) = lockfile.read_to_end() else {
            break 'yarn;
        };
        let migrate_result = match yarn::migrate_yarn_lockfile(this, manager, log, &data, dir) {
            Ok(r) => r,
            Err(e) => {
                return LoadResult::Err {
                    step: lockfile::LoadStep::Migrating,
                    value: e,
                    lockfile_path: b"yarn.lock",
                    format: lockfile::Format::Text,
                };
            }
        };

        if matches!(migrate_result, LoadResult::Ok { .. }) {
            Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
            Output::pretty_error(" ", format_args!(""));
            Output::pretty_errorln("<d>migrated lockfile from <r><green>yarn.lock<r>", format_args!(""));
            Output::flush();
        }

        return migrate_result;
    }

    'pnpm: {
        let timer = std::time::Instant::now();
        let Ok(lockfile) = File::openat(dir, b"pnpm-lock.yaml", O::RDONLY, 0) else {
            break 'pnpm;
        };
        let Ok(data) = lockfile.read_to_end() else {
            break 'pnpm;
        };
        let migrate_result = match pnpm::migrate_pnpm_lockfile(this, manager, log, &data, dir) {
            Ok(r) => r,
            Err(e) => {
                match e {
                    e if e == err!("PnpmLockfileTooOld") => {
                        Output::pretty_errorln(
                            "<red><b>warning<r><d>:<r> pnpm-lock.yaml version is too old (< v7)\n\nPlease upgrade using 'pnpm install --lockfile-only' first, then try again.",
                            format_args!(""),
                        );
                    }
                    e if e == err!("NonExistentWorkspaceDependency") => {
                        Output::warn("Workspace link dependencies to non-existent folders aren't supported yet in pnpm-lock.yaml migration. Please follow along at <magenta>https://github.com/oven-sh/bun/issues/23026<r>", format_args!(""));
                    }
                    e if e == err!("RelativeLinkDependency") => {
                        Output::warn("Relative link dependencies aren't supported yet. Please follow along at <magenta>https://github.com/oven-sh/bun/issues/23026<r>", format_args!(""));
                    }
                    e if e == err!("WorkspaceNameMissing") => {
                        if log.has_errors() {
                            let _ = log.print(Output::error_writer());
                        }
                        Output::warn("pnpm-lock.yaml migration failed due to missing workspace name.", format_args!(""));
                    }
                    e if e == err!("YamlParseError") => {
                        if log.has_errors() {
                            let _ = log.print(Output::error_writer());
                        }
                        Output::warn("Failed to parse pnpm-lock.yaml.", format_args!(""));
                    }
                    e if e == err!("PnpmLockfileNotObject")
                        || e == err!("PnpmLockfileMissingVersion")
                        || e == err!("PnpmLockfileVersionInvalid")
                        || e == err!("PnpmLockfileMissingImporters")
                        || e == err!("PnpmLockfileMissingRootPackage")
                        || e == err!("PnpmLockfileInvalidSnapshot")
                        || e == err!("PnpmLockfileInvalidDependency")
                        || e == err!("PnpmLockfileMissingDependencyVersion")
                        || e == err!("PnpmLockfileInvalidOverride")
                        || e == err!("PnpmLockfileInvalidPatchedDependency")
                        || e == err!("PnpmLockfileMissingCatalogEntry")
                        || e == err!("PnpmLockfileUnresolvableDependency") =>
                    {
                        // These errors are continuable - log the error but don't exit
                        // The install will continue with a fresh install instead of migration
                        if log.has_errors() {
                            let _ = log.print(Output::error_writer());
                        }
                    }
                    _ => {}
                }
                log.reset();
                return LoadResult::Err {
                    step: lockfile::LoadStep::Migrating,
                    value: e,
                    lockfile_path: b"pnpm-lock.yaml",
                    format: lockfile::Format::Text,
                };
            }
        };

        if matches!(migrate_result, LoadResult::Ok { .. }) {
            Output::print_elapsed(timer.elapsed().as_nanos() as f64 / 1_000_000.0);
            Output::pretty_error(" ", format_args!(""));
            Output::pretty_errorln("<d>migrated lockfile from <r><green>pnpm-lock.yaml<r>", format_args!(""));
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

#[derive(Copy, Clone, PartialEq, Eq)]
enum DepKey {
    Dependencies,
    DevDependencies,
    PeerDependencies,
    OptionalDependencies,
}

impl DepKey {
    const fn tag_name(self) -> &'static [u8] {
        match self {
            DepKey::Dependencies => b"dependencies",
            DepKey::DevDependencies => b"devDependencies",
            DepKey::PeerDependencies => b"peerDependencies",
            DepKey::OptionalDependencies => b"optionalDependencies",
        }
    }
}

const DEPENDENCY_KEYS: [DepKey; 4] = [
    DepKey::Dependencies,
    DepKey::DevDependencies,
    DepKey::PeerDependencies,
    DepKey::OptionalDependencies,
];

pub fn migrate_npm_lockfile(
    this: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut logger::Log,
    data: &[u8],
    abs_path: &[u8],
) -> Result<LoadResult, Error> {
    // TODO(port): narrow error set
    debug!("begin lockfile migration");

    this.init_empty();
    Install::initialize_store();

    let json_src = logger::Source::init_path_string(abs_path, data);
    let json = bun_interchange::json::parse_utf8(&json_src, log)
        .map_err(|_| err!("InvalidNPMLockfile"))?;

    if !matches!(json.data, E::Data::Object(_)) {
        return Err(err!("InvalidNPMLockfile"));
    }
    if let Some(version) = json.get(b"lockfileVersion") {
        if !(matches!(version.data, E::Data::Number(n) if n.value >= 2.0 && n.value <= 3.0)) {
            return Err(err!("NPMLockfileVersionMismatch"));
        }
    } else {
        return Err(err!("InvalidNPMLockfile"));
    }

    bun_core::analytics::Features::lockfile_migration_from_package_lock_inc();

    // Count pass

    let root_package: &E::Object;
    let packages_properties = 'brk: {
        let Some(obj) = json.get(b"packages") else { return Err(err!("InvalidNPMLockfile")); };
        let E::Data::Object(eobj) = &obj.data else { return Err(err!("InvalidNPMLockfile")); };
        if eobj.properties.len() == 0 {
            return Err(err!("InvalidNPMLockfile"));
        }
        let prop1 = eobj.properties.at(0);
        if let Some(k) = &prop1.key {
            let E::Data::String(s) = &k.data else { return Err(err!("InvalidNPMLockfile")); };
            // first key must be the "", self reference
            if !s.data.is_empty() {
                return Err(err!("InvalidNPMLockfile"));
            }
            let E::Data::Object(rp) = &prop1.value.as_ref().unwrap().data else {
                return Err(err!("InvalidNPMLockfile"));
            };
            root_package = rp;
        } else {
            return Err(err!("InvalidNPMLockfile"));
        }
        break 'brk eobj.properties.clone();
        // TODO(port): properties is a BabyList; verify clone vs borrow semantics
    };

    let mut num_deps: u32 = 0;

    let workspace_map: Option<lockfile::package::WorkspaceMap> = 'workspace_map: {
        if let Some(wksp) = root_package.get(b"workspaces") {
            let mut workspaces = lockfile::package::WorkspaceMap::init();

            let json_array = match &wksp.data {
                E::Data::Array(arr) => arr,
                E::Data::Object(obj) => {
                    if let Some(packages) = obj.get(b"packages") {
                        match &packages.data {
                            E::Data::Array(arr) => arr,
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
                json_array,
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
    id_map.reserve(packages_properties.len() as usize);
    let mut num_extern_strings: u32 = 0;
    let mut package_idx: u32 = 0;
    for (i, entry) in packages_properties.slice().iter().enumerate() {
        let pkg_path = entry.key.as_ref().unwrap().as_string().unwrap();
        let E::Data::Object(pkg) = &entry.value.as_ref().unwrap().data else {
            return Err(err!("InvalidNPMLockfile"));
        };

        if pkg.get(b"link").is_some() {
            id_map.insert(
                pkg_path,
                IdMapValue {
                    old_json_index: i as u32,
                    new_package_id: PACKAGE_ID_IS_LINK,
                },
            );
            // PERF(port): was assume_capacity
            continue;
        }
        if let Some(x) = pkg.get(b"inBundle") {
            if matches!(x.data, E::Data::Boolean(b) if b.value) {
                id_map.insert(
                    pkg_path,
                    IdMapValue {
                        old_json_index: i as u32,
                        new_package_id: PACKAGE_ID_IS_BUNDLED,
                    },
                );
                // PERF(port): was assume_capacity
                continue;
            }
        }
        if let Some(x) = pkg.get(b"extraneous") {
            if matches!(x.data, E::Data::Boolean(b) if b.value) {
                continue;
            }
        }

        id_map.insert(
            pkg_path,
            IdMapValue {
                old_json_index: i as u32,
                new_package_id: package_idx,
            },
        );
        // PERF(port): was assume_capacity
        package_idx += 1;

        for dep_key in DEPENDENCY_KEYS {
            if let Some(deps) = pkg.get(dep_key.tag_name()) {
                let E::Data::Object(deps_obj) = &deps.data else {
                    return Err(err!("InvalidNPMLockfile"));
                };
                num_deps = num_deps.saturating_add(deps_obj.properties.len() as u32);
            }
        }

        if let Some(bin) = pkg.get(b"bin") {
            let E::Data::Object(bin_obj) = &bin.data else {
                return Err(err!("InvalidNPMLockfile"));
            };
            match bin_obj.properties.len() {
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
                let registry = manager.scope_for_package_name(pkg_name);
                let mut count: usize = 0;
                count += registry.url.href.len() + pkg_name.len() + b"/-/".len();
                if pkg_name[0] == b'@' {
                    // scoped
                    let Some(slash_index) = strings::index_of_char(pkg_name, b'/') else {
                        return Err(err!("InvalidNPMLockfile"));
                    };
                    if slash_index >= pkg_name.len() - 1 {
                        return Err(err!("InvalidNPMLockfile"));
                    }
                    count += pkg_name[slash_index + 1..].len();
                } else {
                    count += pkg_name.len();
                }
                let Some(version_str) = version_prop.unwrap().as_string() else {
                    return Err(err!("InvalidNPMLockfile"));
                };
                count += b"-.tgz".len() + version_str.len();

                let mut resolved_url = vec![0u8; count].into_boxed_slice();
                let mut remain = &mut resolved_url[..];
                remain[..registry.url.href.len()].copy_from_slice(registry.url.href.as_bytes());
                remain = &mut remain[registry.url.href.len()..];
                remain[..pkg_name.len()].copy_from_slice(pkg_name);
                remain = &mut remain[pkg_name.len()..];
                remain[..3].copy_from_slice(b"/-/");
                remain = &mut remain[3..];
                if pkg_name[0] == b'@' {
                    let slash_index = strings::index_of_char(pkg_name, b'/').unwrap();
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

                resolved_urls.insert(pkg_path, resolved_url);
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
    this.buffers.extern_strings.reserve(num_extern_strings as usize);
    this.packages.reserve(package_idx as usize);
    // The package index is overallocated, but we know the upper bound
    this.package_index.reserve(package_idx as usize);

    // dependency on `resolved`, a dependencies version tag might change, requiring
    // new strings to be allocated.
    let mut string_buf = this.string_buf();

    if let Some(wksp) = &workspace_map {
        this.workspace_paths.reserve(wksp.map.len());
        this.workspace_versions.reserve(wksp.map.len());

        debug_assert_eq!(wksp.map.keys().len(), wksp.map.values().len());
        for (k, v) in wksp.map.keys().iter().zip(wksp.map.values()) {
            let name_hash = string_hash(v.name);

            #[cfg(debug_assertions)]
            {
                debug_assert!(!strings::index_of_char(k, b'\\').is_some());
            }

            this.workspace_paths.insert(name_hash, string_buf.append(k)?);
            // PERF(port): was assume_capacity

            if let Some(version_string) = &v.version {
                let sliced_version = Semver::SlicedString::init(version_string, version_string);
                let result = Semver::Version::parse(sliced_version);
                if result.valid && result.wildcard == Semver::Wildcard::None {
                    this.workspace_versions.insert(name_hash, result.version.min());
                    // PERF(port): was assume_capacity
                }
            }
        }
    }

    // Package Building Phase
    // This initializes every package and sets the resolution to uninitialized
    for entry in packages_properties.slice() {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        let E::Data::Object(pkg) = &entry.value.as_ref().unwrap().data else { unreachable!() };

        let pkg_path = entry.key.as_ref().unwrap().as_string().unwrap();

        if let Some(link) = pkg.get(b"link") {
            if let Some(wksp) = &workspace_map {
                if !matches!(link.data, E::Data::Boolean(_)) {
                    continue;
                }
                if let E::Data::Boolean(b) = link.data {
                    if b.value {
                        if let Some(resolved) = pkg.get(b"resolved") {
                            if !matches!(resolved.data, E::Data::String(_)) {
                                continue;
                            }
                            let resolved_str = resolved.as_string().unwrap();
                            if let Some(wksp_entry) = wksp.map.get(resolved_str) {
                                let pkg_name = package_name_from_path(pkg_path);
                                if !strings::eql_long(wksp_entry.name, pkg_name, true) {
                                    let pkg_name_hash = string_hash(pkg_name);
                                    let path_entry = this.workspace_paths.get_or_put(pkg_name_hash);
                                    if !path_entry.found_existing {
                                        // Package resolve path is an entry in the workspace map, but
                                        // the package name is different. This package doesn't exist
                                        // in node_modules, but we still allow packages to resolve to it's
                                        // resolution.
                                        *path_entry.value_ptr = string_buf.append(resolved_str)?;

                                        if let Some(version_string) = &wksp_entry.version {
                                            let sliced_version = Semver::SlicedString::init(version_string, version_string);
                                            let result = Semver::Version::parse(sliced_version);
                                            if result.valid && result.wildcard == Semver::Wildcard::None {
                                                this.workspace_versions.insert(pkg_name_hash, result.version.min());
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

        if pkg.get(b"inBundle").or_else(|| pkg.get(b"extraneous"))
            .map(|x| matches!(x.data, E::Data::Boolean(b) if b.value))
            .unwrap_or(false)
        {
            continue;
        }

        let workspace_entry = workspace_map.as_ref().and_then(|map| map.map.get(pkg_path));
        let is_workspace = workspace_entry.is_some();

        let pkg_name: &[u8] = if is_workspace {
            workspace_entry.unwrap().name
        } else if let Some(set_name) = pkg.get(b"name") {
            set_name.as_string().expect("unreachable")
        } else {
            package_name_from_path(pkg_path)
        };

        let name_hash = string_hash(pkg_name);

        let package_id: PackageID = u32::try_from(this.packages.len()).unwrap();
        #[cfg(debug_assertions)]
        {
            // If this is false, then it means we wrote wrong resolved ids
            // During counting phase we assign all the packages an id.
            debug_assert!(package_id == id_map.get(pkg_path).unwrap().new_package_id);
        }

        // Instead of calling this.appendPackage, manually append
        // the other function has some checks that will fail since we have not set resolution+dependencies yet.
        this.packages.push(lockfile::Package {
            // PERF(port): was assume_capacity
            name: string_buf.append_with_hash(pkg_name, name_hash)?,
            name_hash,

            // For non workspace packages these are set to .uninitialized, then in the third phase
            // they are resolved. This is because the resolution uses the dependant's version
            // specifier as a "hint" to resolve the dependency.
            resolution: if is_workspace {
                Resolution::init_workspace(string_buf.append(pkg_path)?)
            } else {
                Resolution::default()
            },

            // we fill this data in later
            // SAFETY: written in the dependency-linking pass below before any read
            dependencies: unsafe { core::mem::zeroed() },
            resolutions: unsafe { core::mem::zeroed() },
            // TODO(port): verify zeroed is valid for DependencyList/ResolutionList

            meta: lockfile::Meta {
                id: package_id,

                origin: if package_id == 0 { lockfile::Origin::Local } else { lockfile::Origin::Npm },

                arch: if let Some(cpu_array) = pkg.get(b"cpu") {
                    'arch: {
                        let mut arch = Npm::Architecture::NONE.negatable();
                        let E::Data::Array(arr) = &cpu_array.data else {
                            return Err(err!("InvalidNPMLockfile"));
                        };
                        if arr.items.len() == 0 {
                            break 'arch arch.combine();
                        }
                        for item in arr.items.slice() {
                            let E::Data::String(s) = &item.data else {
                                return Err(err!("InvalidNPMLockfile"));
                            };
                            arch.apply(s.data);
                        }
                        break 'arch arch.combine();
                    }
                } else {
                    Npm::Architecture::ALL
                },

                os: if let Some(cpu_array) = pkg.get(b"os") {
                    'arch: {
                        let mut os = Npm::OperatingSystem::NONE.negatable();
                        let E::Data::Array(arr) = &cpu_array.data else {
                            return Err(err!("InvalidNPMLockfile"));
                        };
                        if arr.items.len() == 0 {
                            break 'arch Npm::OperatingSystem::ALL;
                        }
                        for item in arr.items.slice() {
                            let E::Data::String(s) = &item.data else {
                                return Err(err!("InvalidNPMLockfile"));
                            };
                            os.apply(s.data);
                        }
                        break 'arch os.combine();
                    }
                } else {
                    Npm::OperatingSystem::ALL
                },

                man_dir: SemverString::default(),

                has_install_script: if let Some(h) = pkg.get(b"hasInstallScript") {
                    let E::Data::Boolean(b) = h.data else {
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
                        integrity.as_string().ok_or(err!("InvalidNPMLockfile"))?,
                    )
                } else {
                    Integrity::default()
                },
            },
            bin: if let Some(bin) = pkg.get(b"bin") {
                'bin: {
                    // we already check these conditions during counting
                    let E::Data::Object(bin_obj) = &bin.data else { unreachable!() };
                    debug_assert!(bin_obj.properties.len() > 0);

                    // in npm lockfile, the bin is always an object, even if it is only a single one
                    // we need to detect if it's a single entry and lower it to a file.
                    if bin_obj.properties.len() == 1 {
                        let prop = bin_obj.properties.at(0);
                        let key = prop.key.as_ref().unwrap().as_string().ok_or(err!("InvalidNPMLockfile"))?;
                        let script_value = prop.value.as_ref().unwrap().as_string().ok_or(err!("InvalidNPMLockfile"))?;

                        if strings::eql(key, pkg_name) {
                            break 'bin Bin {
                                tag: Bin::Tag::File,
                                value: Bin::Value::init_file(string_buf.append(script_value)?),
                            };
                        }

                        break 'bin Bin {
                            tag: Bin::Tag::NamedFile,
                            value: Bin::Value::init_named_file([
                                string_buf.append(key)?,
                                string_buf.append(script_value)?,
                            ]),
                        };
                    }

                    let view = ExternalStringList {
                        off: this.buffers.extern_strings.len() as u32,
                        len: u32::try_from(bin_obj.properties.len() * 2).unwrap(),
                    };

                    for bin_entry in bin_obj.properties.slice() {
                        let key = bin_entry.key.as_ref().unwrap().as_string().ok_or(err!("InvalidNPMLockfile"))?;
                        let script_value = bin_entry.value.as_ref().unwrap().as_string().ok_or(err!("InvalidNPMLockfile"))?;
                        this.buffers.extern_strings.push(string_buf.append_external(key)?);
                        this.buffers.extern_strings.push(string_buf.append_external(script_value)?);
                        // PERF(port): was assume_capacity
                    }

                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(this.buffers.extern_strings.len() == (view.off + view.len) as usize);
                        debug_assert!(this.buffers.extern_strings.len() <= this.buffers.extern_strings.capacity());
                    }

                    break 'bin Bin {
                        tag: Bin::Tag::Map,
                        value: Bin::Value::init_map(view),
                    };
                }
            } else {
                Bin::init()
            },

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
    // TODO(port): verify aliasing — `string_buf`/`this` are borrowed concurrently with raw ptrs into buffers

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

    let resolutions = this.packages.items_mut::<Resolution>();
    let metas = this.packages.items_mut::<lockfile::Meta>();
    let dependencies_list = this.packages.items_mut::<lockfile::DependencyList>();
    let resolution_list = this.packages.items_mut::<lockfile::ResolutionList>();
    // TODO(port): MultiArrayList simultaneous mutable column access — Phase B may need split_mut helper

    #[cfg(debug_assertions)]
    {
        for r in resolutions.iter() {
            debug_assert!(r.tag == Resolution::Tag::Uninitialized || r.tag == Resolution::Tag::Workspace);
        }
    }

    // Root resolution isn't hit through dependency tracing.
    resolutions[0] = Resolution::init_root();
    metas[0].origin = lockfile::Origin::Local;
    this.get_or_put_id(0, this.packages.items::<lockfile::NameHash>()[0])?;

    // made it longer than max path just in case something stupid happens
    let mut name_checking_buf = [0u8; MAX_PATH_BYTES * 2];

    // Dependency Linking Phase
    package_idx = 0;
    let mut is_first = true;
    for entry in packages_properties.slice() {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        let E::Data::Object(pkg) = &entry.value.as_ref().unwrap().data else { unreachable!() };

        if pkg.get(b"link").is_some()
            || pkg.get(b"inBundle").or_else(|| pkg.get(b"extraneous"))
                .map(|x| matches!(x.data, E::Data::Boolean(b) if b.value))
                .unwrap_or(false)
        {
            continue;
        }

        let pkg_path = entry.key.as_ref().unwrap().as_string().unwrap();

        let dependencies_start = deps_cursor;
        let resolutions_start = res_cursor;

        // PORT NOTE: Zig used `defer` here to write dependencies_list/resolution_list and
        // increment package_idx at every loop exit. Reshaped for borrowck — inlined as
        // `finalize_pkg!` at the one early-continue and at natural end-of-loop.
        macro_rules! finalize_pkg {
            () => {{
                if dependencies_start == deps_cursor {
                    dependencies_list[package_idx as usize] = Default::default();
                    resolution_list[package_idx as usize] = Default::default();
                } else {
                    let len: u32 = (res_cursor - resolutions_start) as u32;
                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(len > 0);
                        debug_assert!(len == (deps_cursor - dependencies_start) as u32);
                    }
                    dependencies_list[package_idx as usize] = lockfile::DependencyList {
                        off: dependencies_start as u32,
                        len,
                    };
                    resolution_list[package_idx as usize] = lockfile::ResolutionList {
                        off: resolutions_start as u32,
                        len,
                    };
                }
                package_idx += 1;
            }};
        }

        // a feature no one has heard about: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bundledependencies
        let bundled_dependencies: Option<ArrayHashMap<&[u8], ()>> =
            if let Some(expr) = pkg.get(b"bundleDependencies").or_else(|| pkg.get(b"bundledDependencies")) {
                'deps: {
                    if let E::Data::Boolean(b) = expr.data {
                        if b.value {
                            finalize_pkg!();
                            // TODO(port): errdefer-style — Zig `continue` here ran the outer defer; verify no other side effects skipped
                            continue;
                        }
                        break 'deps None;
                    }
                    let E::Data::Array(arr) = &expr.data else {
                        return Err(err!("InvalidNPMLockfile"));
                    };
                    let mut map = ArrayHashMap::<&[u8], ()>::default();
                    map.reserve(arr.items.len() as usize);
                    for item in arr.items.slice() {
                        map.insert(
                            item.as_string().ok_or(err!("InvalidNPMLockfile"))?,
                            (),
                        );
                        // PERF(port): was assume_capacity
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
                    let entry1 = id_map.get(key).copied().ok_or(err!("InvalidNPMLockfile"))?;
                    let name_hash = string_hash(value.name);
                    let wksp_name = string_buf.append(value.name)?;
                    let wksp_path = string_buf.append(key)?;
                    // SAFETY: deps_cursor < num_deps; capacity reserved above
                    unsafe {
                        core::ptr::write(dependencies_base.add(deps_cursor), Dependency {
                            name: wksp_name,
                            name_hash,
                            version: Dependency::Version {
                                tag: Dependency::VersionTag::Workspace,
                                literal: wksp_path,
                                value: Dependency::VersionValue::Workspace(wksp_path),
                            },
                            behavior: Dependency::Behavior { workspace: true, ..Default::default() },
                        });
                        core::ptr::write(resolutions_base.add(res_cursor), entry1.new_package_id);
                    }
                    deps_cursor += 1;
                    res_cursor += 1;
                }
            }
        }

        for dep_key in DEPENDENCY_KEYS {
            if let Some(deps) = pkg.get(dep_key.tag_name()) {
                // fetch the peerDependenciesMeta if it exists
                // this is only done for peerDependencies, obviously
                let peer_dep_meta: Option<&E::Object> = if dep_key == DepKey::PeerDependencies {
                    if let Some(expr) = pkg.get(b"peerDependenciesMeta") {
                        let E::Data::Object(o) = &expr.data else {
                            return Err(err!("InvalidNPMLockfile"));
                        };
                        Some(o)
                    } else {
                        None
                    }
                } else {
                    None
                };

                let E::Data::Object(deps_obj) = &deps.data else {
                    return Err(err!("InvalidNPMLockfile"));
                };
                let properties = &deps_obj.properties;

                'dep_loop: for prop in properties.slice() {
                    let name_bytes = prop.key.as_ref().unwrap().as_string().unwrap();
                    if let Some(bd) = &bundled_dependencies {
                        if bd.get_index(name_bytes).is_some() {
                            continue 'dep_loop;
                        }
                    }

                    let version_bytes = prop.value.as_ref().unwrap().as_string().ok_or(err!("InvalidNPMLockfile"))?;
                    let name_hash = string_hash(name_bytes);
                    let dep_name = string_buf.append_with_hash(name_bytes, name_hash)?;

                    let dep_version = string_buf.append(version_bytes)?;
                    let sliced = dep_version.sliced(string_buf.bytes());

                    debug!("parsing {}, {}\n", bstr::BStr::new(name_bytes), bstr::BStr::new(version_bytes));
                    let Some(version) = Dependency::parse(
                        dep_name,
                        name_hash,
                        sliced.slice,
                        &sliced,
                        log,
                        manager,
                    ) else {
                        return Err(err!("InvalidNPMLockfile"));
                    };
                    debug!("-> {}, {:?}\n", <&'static str>::from(version.tag), version.value);

                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(version.tag != Dependency::VersionTag::Uninitialized);
                    }

                    let str_node_modules: &[u8] = if pkg_path.is_empty() { b"node_modules/" } else { b"/node_modules/" };
                    let suffix_len = str_node_modules.len() + name_bytes.len();

                    let mut buf_len: u32 = u32::try_from(pkg_path.len() + suffix_len).unwrap();
                    if buf_len as usize > name_checking_buf.len() {
                        return Err(err!("PathTooLong"));
                    }

                    name_checking_buf[..pkg_path.len()].copy_from_slice(pkg_path);
                    name_checking_buf[pkg_path.len()..pkg_path.len() + str_node_modules.len()].copy_from_slice(str_node_modules);
                    name_checking_buf[pkg_path.len() + str_node_modules.len()..pkg_path.len() + suffix_len].copy_from_slice(name_bytes);

                    loop {
                        debug!("checking {}", bstr::BStr::new(&name_checking_buf[..buf_len as usize]));
                        if let Some(found_) = id_map.get(&name_checking_buf[..buf_len as usize]).copied() {
                            let mut found = found_;
                            if found.new_package_id == PACKAGE_ID_IS_LINK {
                                // it is a workspace package, resolve from the "link": true entry to the real entry.
                                let E::Data::Object(ref_pkg) = &packages_properties.at(found.old_json_index as usize).value.as_ref().unwrap().data else { unreachable!() };
                                // the `else` here is technically possible to hit
                                let resolved_v = ref_pkg.get(b"resolved").ok_or(err!("LockfileWorkspaceMissingResolved"))?;
                                let resolved = resolved_v.as_string().ok_or(err!("InvalidNPMLockfile"))?;
                                found = id_map.get(resolved).copied().ok_or(err!("InvalidNPMLockfile"))?;
                            } else if found.new_package_id == PACKAGE_ID_IS_BUNDLED {
                                debug!("skipping bundled dependency {}", bstr::BStr::new(name_bytes));
                                continue 'dep_loop;
                            }

                            let id = found.new_package_id;

                            // SAFETY: cursor < num_deps; capacity reserved
                            unsafe {
                                core::ptr::write(dependencies_base.add(deps_cursor), Dependency {
                                    name: dep_name,
                                    name_hash,
                                    version: version.clone(),
                                    behavior: Dependency::Behavior {
                                        prod: dep_key == DepKey::Dependencies,
                                        optional: dep_key == DepKey::OptionalDependencies,
                                        dev: dep_key == DepKey::DevDependencies,
                                        peer: dep_key == DepKey::PeerDependencies,
                                        workspace: false,
                                        ..Default::default()
                                    },
                                });
                                core::ptr::write(resolutions_base.add(res_cursor), id);
                            }
                            deps_cursor += 1;
                            res_cursor += 1;

                            // If the package resolution is not set, resolve the target package
                            // using the information we have from the dependency declaration.
                            if resolutions[id as usize].tag == Resolution::Tag::Uninitialized {
                                debug!("resolving '{}'", bstr::BStr::new(name_bytes));

                                let mut res_version = version.clone();

                                let res = 'resolved: {
                                    let E::Data::Object(dep_pkg) = &packages_properties.at(found.old_json_index as usize).value.as_ref().unwrap().data else { unreachable!() };
                                    let dep_resolved: &[u8] = 'dep_resolved: {
                                        if let Some(resolved) = dep_pkg.get(b"resolved") {
                                            let dep_resolved = resolved.as_string().ok_or(err!("InvalidNPMLockfile"))?;
                                            match Dependency::VersionTag::infer(dep_resolved) {
                                                tag @ (Dependency::VersionTag::Git | Dependency::VersionTag::Github) => {
                                                    let dep_resolved_str = string_buf.append(dep_resolved)?;
                                                    let dep_resolved_sliced = dep_resolved_str.sliced(string_buf.bytes());
                                                    res_version = Dependency::parse_with_tag(
                                                        dep_name,
                                                        name_hash,
                                                        dep_resolved_sliced.slice,
                                                        tag,
                                                        &dep_resolved_sliced,
                                                        log,
                                                        manager,
                                                    ).ok_or(err!("InvalidNPMLockfile"))?;

                                                    break 'dep_resolved dep_resolved;
                                                }
                                                // TODO(dylan-conway): might need to handle more cases
                                                _ => break 'dep_resolved dep_resolved,
                                            }
                                        }

                                        if version.tag == Dependency::VersionTag::Npm {
                                            if let Some(resolved_url) = resolved_urls.get(&name_checking_buf[..buf_len as usize]) {
                                                break 'dep_resolved &resolved_url[..];
                                            }
                                        }

                                        break 'resolved Resolution::init_folder(
                                            string_buf.append(packages_properties.at(found.old_json_index as usize).key.as_ref().unwrap().as_string().unwrap())?,
                                        );
                                    };

                                    break 'resolved match res_version.tag {
                                        Dependency::VersionTag::Uninitialized => panic!("Version string {} resolved to `.uninitialized`", bstr::BStr::new(version_bytes)),

                                        // npm does not support catalogs
                                        Dependency::VersionTag::Catalog => return Err(err!("InvalidNPMLockfile")),

                                        Dependency::VersionTag::Npm | Dependency::VersionTag::DistTag => {
                                            // It is theoretically possible to hit this in a case where the resolved dependency is NOT
                                            // an npm dependency, but that case is so convoluted that it is not worth handling.
                                            //
                                            // Deleting 'package-lock.json' would completely break the installation of the project.
                                            //
                                            // We assume that the given URL is to *some* npm registry, or the resolution is to a workspace package.
                                            // If it is a workspace package, then this branch will not be hit as the resolution was already set earlier.
                                            let dep_actual_version = dep_pkg.get(b"version")
                                                .ok_or(err!("InvalidNPMLockfile"))?
                                                .as_string()
                                                .ok_or(err!("InvalidNPMLockfile"))?;

                                            let dep_actual_version_str = string_buf.append(dep_actual_version)?;
                                            let dep_actual_version_sliced = dep_actual_version_str.sliced(string_buf.bytes());

                                            Resolution::init_npm(
                                                string_buf.append(dep_resolved)?,
                                                Semver::Version::parse(dep_actual_version_sliced).version.min(),
                                            )
                                        }
                                        Dependency::VersionTag::Tarball => {
                                            if dep_resolved.starts_with(b"file:") {
                                                Resolution::init_local_tarball(string_buf.append(&dep_resolved[5..])?)
                                            } else {
                                                Resolution::init_remote_tarball(string_buf.append(dep_resolved)?)
                                            }
                                        }
                                        Dependency::VersionTag::Folder => Resolution::init_folder(string_buf.append(dep_resolved)?),
                                        // not sure if this is possible to hit
                                        Dependency::VersionTag::Symlink => Resolution::init_folder(string_buf.append(dep_resolved)?),
                                        Dependency::VersionTag::Workspace => {
                                            let mut input = string_buf.append(dep_resolved)?.sliced(string_buf.bytes());
                                            if input.slice.starts_with(b"workspace:") {
                                                input = input.sub(&input.slice[b"workspace:".len()..]);
                                            }
                                            Resolution::init_workspace(input.value())
                                        }
                                        Dependency::VersionTag::Git => {
                                            let str = (if dep_resolved.starts_with(b"git+") {
                                                string_buf.append(&dep_resolved[4..])?
                                            } else {
                                                string_buf.append(dep_resolved)?
                                            }).sliced(string_buf.bytes());

                                            let hash_index = strings::last_index_of_char(str.slice, b'#').ok_or(err!("InvalidNPMLockfile"))?;

                                            let commit = str.sub(&str.slice[hash_index + 1..]).value();
                                            Resolution::init_git(crate::repository::Repository {
                                                owner: res_version.value.git().owner,
                                                repo: str.sub(&str.slice[..hash_index]).value(),
                                                committish: commit,
                                                resolved: commit,
                                                package_name: dep_name,
                                            })
                                        }
                                        Dependency::VersionTag::Github => {
                                            let str = (if dep_resolved.starts_with(b"git+") {
                                                string_buf.append(&dep_resolved[4..])?
                                            } else {
                                                string_buf.append(dep_resolved)?
                                            }).sliced(string_buf.bytes());

                                            let hash_index = strings::last_index_of_char(str.slice, b'#').ok_or(err!("InvalidNPMLockfile"))?;

                                            let commit = str.sub(&str.slice[hash_index + 1..]).value();
                                            Resolution::init_git(crate::repository::Repository {
                                                owner: res_version.value.github().owner,
                                                repo: str.sub(&str.slice[..hash_index]).value(),
                                                committish: commit,
                                                resolved: commit,
                                                package_name: dep_name,
                                            })
                                        }
                                    };
                                };
                                debug!("-> {}", res.fmt_for_debug(string_buf.bytes()));

                                resolutions[id as usize] = res;
                                metas[id as usize].origin = match res.tag {
                                    // This works?
                                    Resolution::Tag::Root => lockfile::Origin::Local,
                                    _ => lockfile::Origin::Npm,
                                };

                                this.get_or_put_id(id, this.packages.items::<lockfile::NameHash>()[id as usize])?;
                            }

                            continue 'dep_loop;
                        }

                        // step down each `node_modules/` of the source
                        let prefix_len = (buf_len as usize).saturating_sub(b"node_modules/".len() + name_bytes.len());
                        if let Some(idx) = strings::last_index_of(&name_checking_buf[..prefix_len], b"node_modules/") {
                            debug!("found 'node_modules/' at {}", idx);
                            buf_len = u32::try_from(idx + b"node_modules/".len() + name_bytes.len()).unwrap();
                            name_checking_buf[idx + b"node_modules/".len()..idx + b"node_modules/".len() + name_bytes.len()].copy_from_slice(name_bytes);
                        } else if !name_checking_buf[..buf_len as usize].starts_with(b"node_modules/") {
                            // this is hit if you are at something like `packages/etc`, from `packages/etc/node_modules/xyz`
                            // we need to hit the root `node_modules/{name}`
                            buf_len = u32::try_from(b"node_modules/".len() + name_bytes.len()).unwrap();
                            name_checking_buf[..b"node_modules/".len()].copy_from_slice(b"node_modules/");
                            name_checking_buf[buf_len as usize - name_bytes.len()..buf_len as usize].copy_from_slice(name_bytes);
                        } else {
                            // optional peer dependencies can be ... optional
                            if dep_key == DepKey::PeerDependencies {
                                if let Some(o) = peer_dep_meta {
                                    if let Some(meta) = o.get(name_bytes) {
                                        let E::Data::Object(meta_obj) = &meta.data else {
                                            return Err(err!("InvalidNPMLockfile"));
                                        };
                                        if let Some(optional) = meta_obj.get(b"optional") {
                                            let E::Data::Boolean(b) = optional.data else {
                                                return Err(err!("InvalidNPMLockfile"));
                                            };
                                            if b.value {
                                                // SAFETY: cursor < num_deps; capacity reserved
                                                unsafe {
                                                    core::ptr::write(dependencies_base.add(deps_cursor), Dependency {
                                                        name: dep_name,
                                                        name_hash,
                                                        version: version.clone(),
                                                        behavior: Dependency::Behavior {
                                                            prod: dep_key == DepKey::Dependencies,
                                                            optional: true,
                                                            dev: dep_key == DepKey::DevDependencies,
                                                            peer: dep_key == DepKey::PeerDependencies,
                                                            workspace: false,
                                                            ..Default::default()
                                                        },
                                                    });
                                                    core::ptr::write(resolutions_base.add(res_cursor), Install::INVALID_PACKAGE_ID);
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
                            debug!("could not find package '{}' in '{}'", bstr::BStr::new(name_bytes), bstr::BStr::new(pkg_path));
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
            if r.behavior.eq(&Dependency::Behavior::default()) {
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
    for (i, r) in resolutions.iter().enumerate() {
        if r.tag == Resolution::Tag::Uninitialized {
            Output::warn(
                "Could not resolve package '{}' in lockfile during migration",
                format_args!("{}", bstr::BStr::new(this.packages.items::<SemverString>()[i].slice(&this.buffers.string_bytes))),
            );
            is_missing_resolutions = true;
        } else {
            #[cfg(debug_assertions)]
            {
                // Assertion from appendPackage. If we do this too early it will always fail as we dont have the resolution written
                // but after we write all the data, there is no excuse for this to fail.
                //
                // If this is hit, it means getOrPutID was not called on this package id. Look for where 'resolution[i]' is set
                debug_assert!(this.get_package_id(this.packages.items::<lockfile::NameHash>()[i], None, r).is_some());
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

    Ok(LoadResult::Ok {
        lockfile: this,
        // TODO(port): lifetime — LoadResult holds &mut Lockfile in Zig; verify Rust ownership
        migrated: lockfile::Migrated::Npm,
        loaded_from_binary_lockfile: false,
        serializer_result: Default::default(),
        format: lockfile::Format::Binary,
    })
}

fn package_name_from_path(pkg_path: &[u8]) -> &[u8] {
    if pkg_path.is_empty() {
        return b"";
    }

    let pkg_name_start: usize = if let Some(last_index) = strings::last_index_of(pkg_path, b"/node_modules/") {
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
    SemverString::Builder::string_hash(s)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/migration.zig (1137 lines)
//   confidence: medium
//   todos:      7
//   notes:      defer-at-loop-exit reshaped to finalize_pkg! macro + index cursors; MultiArrayList multi-column &mut and string_buf/this aliasing need Phase-B borrowck work; AST E::Data matching assumed enum-with-payloads; Resolution::init_* assumed as variant constructors
// ──────────────────────────────────────────────────────────────────────────
