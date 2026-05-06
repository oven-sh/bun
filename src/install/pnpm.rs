use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::ArrayHashMap;
use bun_js_parser::{self as js_ast, Expr, E};

// Zig `bun.StringArrayHashMap(V)` → `bun_collections::ArrayHashMap<K,V>` per PORTING.md.
// TODO(port): confirm key type — Zig stores borrowed `[]const u8` keys; using owned Box<[u8]>
// here since allocator params were dropped and lifetimes are not threaded in Phase A.
type StringArrayHashMap<V> = ArrayHashMap<Box<[u8]>, V>;
use bun_logger as logger;
use bun_semver::{self as semver, ExternalString, String};
use bun_str::strings;
use bun_sys::{self as sys, Fd};

use crate::bin::Bin;
use crate::dependency::{self, Dependency};
use crate::integrity::Integrity;
use crate::lockfile::{self, LoadResult, Lockfile};
use crate::npm::{self, Negatable};
use crate::resolution::Resolution;
use crate::{DependencyID, ExtractTarball, PackageID, PackageManager, INVALID_PACKAGE_ID};

/// returns (peers_index, patch_hash_index)
/// https://github.com/pnpm/pnpm/blob/102d5a01ddabda1184b88119adccfbe956d30579/packages/dependency-path/src/index.ts#L9-L31
fn index_of_dep_path_suffix(path: &[u8]) -> (Option<usize>, Option<usize>) {
    if path.len() < 2 {
        return (None, None);
    }

    if path[path.len() - 1] != b')' {
        return (None, None);
    }

    let mut open: i64 = 1;
    let mut i = path.len() - 1;
    while i > 0 {
        i -= 1;

        if path[i] == b'(' {
            open -= 1;
        } else if path[i] == b')' {
            open += 1;
        } else if open == 0 {
            if strings::starts_with(&path[i + 1..], b"(patch_hash=") {
                let peers_idx = strings::index_of_char(&path[i + 2..], b'(')
                    .map(|idx| (idx as usize) + i + 2);

                return (peers_idx, Some(i + 1));
            }
            return (Some(i + 1), None);
        }
    }
    (None, None)
}

/// name@version(hash) -> name@version
/// version(hash) -> version
/// https://github.com/pnpm/pnpm/blob/102d5a01ddabda1184b88119adccfbe956d30579/packages/dependency-path/src/index.ts#L52-L61
fn remove_suffix(path: &[u8]) -> &[u8] {
    let (peers_idx, patch_hash_idx) = index_of_dep_path_suffix(path);

    if let Some(idx) = patch_hash_idx.or(peers_idx) {
        return &path[0..idx];
    }

    path
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum MigratePnpmLockfileError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("PnpmLockfileTooOld")]
    PnpmLockfileTooOld,
    #[error("PnpmLockfileVersionInvalid")]
    PnpmLockfileVersionInvalid,
    #[error("InvalidPnpmLockfile")]
    InvalidPnpmLockfile,
    #[error("YamlParseError")]
    YamlParseError,
    #[error("NonExistentWorkspaceDependency")]
    NonExistentWorkspaceDependency,
    #[error("RelativeLinkDependency")]
    RelativeLinkDependency,
    #[error("WorkspaceNameMissing")]
    WorkspaceNameMissing,
    #[error("DependencyLoop")]
    DependencyLoop,
    #[error("PnpmLockfileNotObject")]
    PnpmLockfileNotObject,
    #[error("PnpmLockfileMissingVersion")]
    PnpmLockfileMissingVersion,
    #[error("PnpmLockfileMissingImporters")]
    PnpmLockfileMissingImporters,
    #[error("PnpmLockfileInvalidImporter")]
    PnpmLockfileInvalidImporter,
    #[error("PnpmLockfileMissingRootPackage")]
    PnpmLockfileMissingRootPackage,
    #[error("PnpmLockfileInvalidSnapshot")]
    PnpmLockfileInvalidSnapshot,
    #[error("PnpmLockfileInvalidPackage")]
    PnpmLockfileInvalidPackage,
    #[error("PnpmLockfileMissingDependencyVersion")]
    PnpmLockfileMissingDependencyVersion,
    #[error("PnpmLockfileInvalidDependency")]
    PnpmLockfileInvalidDependency,
    #[error("PnpmLockfileInvalidOverride")]
    PnpmLockfileInvalidOverride,
    #[error("PnpmLockfileInvalidPatchedDependency")]
    PnpmLockfileInvalidPatchedDependency,
    #[error("PnpmLockfileMissingCatalogEntry")]
    PnpmLockfileMissingCatalogEntry,
    #[error("PnpmLockfileUnresolvableDependency")]
    PnpmLockfileUnresolvableDependency,
}

impl From<AllocError> for MigratePnpmLockfileError {
    fn from(_: AllocError) -> Self {
        Self::OutOfMemory
    }
}

impl From<MigratePnpmLockfileError> for bun_core::Error {
    fn from(e: MigratePnpmLockfileError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

pub fn migrate_pnpm_lockfile(
    lockfile: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut logger::Log,
    data: &[u8],
    dir: Fd,
) -> Result<LoadResult, MigratePnpmLockfileError> {
    let mut buf: Vec<u8> = Vec::new();
    let _ = &buf; // TODO(port): `buf` appears unused in the Zig source

    lockfile.init_empty();
    crate::initialize_store();
    bun_analytics::Features::pnpm_migration_inc(1);
    // TODO(port): analytics counter increment — verify API shape in Phase B

    // PERF(port): was arena bulk-free for YAML parsing
    let yaml_arena = bun_alloc::Arena::new();

    let yaml_source = logger::Source::init_path_string(b"pnpm-lock.yaml", data);
    let _root = match bun_interchange::yaml::YAML::parse(&yaml_source, log, &yaml_arena) {
        Ok(r) => r,
        Err(_) => return Err(MigratePnpmLockfileError::YamlParseError),
    };

    let root = _root.deep_clone()?;

    if !root.data.is_e_object() {
        log.add_error_fmt(
            None,
            logger::Loc::EMPTY,
            format_args!(
                "pnpm-lock.yaml root must be an object, got {}",
                <&'static str>::from(&root.data)
            ),
        )?;
        return Err(MigratePnpmLockfileError::PnpmLockfileNotObject);
    }

    let Some(lockfile_version_expr) = root.get(b"lockfileVersion") else {
        log.add_error(
            None,
            logger::Loc::EMPTY,
            b"pnpm-lock.yaml missing 'lockfileVersion' field",
        )?;
        return Err(MigratePnpmLockfileError::PnpmLockfileMissingVersion);
    };

    let lockfile_version_num: f64 = 'lockfile_version: {
        'err: {
            match &lockfile_version_expr.data {
                js_ast::ExprData::ENumber(num) => {
                    if num.value < 0.0 {
                        break 'err;
                    }

                    break 'lockfile_version num.value;
                }
                js_ast::ExprData::EString(version_str) => {
                    let str = version_str.slice();

                    let end = strings::index_of_char(str, b'.')
                        .map(|i| i as usize)
                        .unwrap_or(str.len());
                    // TODO(port): parse_float on &[u8] — version strings are ASCII
                    match core::str::from_utf8(&str[0..end])
                        .ok()
                        .and_then(|s| s.parse::<f64>().ok())
                    {
                        Some(v) => break 'lockfile_version v,
                        None => break 'err,
                    }
                }
                _ => {}
            }
        }

        log.add_error_fmt(
            None,
            logger::Loc::EMPTY,
            format_args!(
                "pnpm-lock.yaml 'lockfileVersion' must be a number or string, got {}",
                <&'static str>::from(&lockfile_version_expr.data)
            ),
        )?;
        return Err(MigratePnpmLockfileError::PnpmLockfileVersionInvalid);
    };

    if lockfile_version_num < 7.0 {
        return Err(MigratePnpmLockfileError::PnpmLockfileTooOld);
    }

    let mut found_patches: StringArrayHashMap<Box<[u8]>> = StringArrayHashMap::new();

    // PORT NOTE: reshaped for borrowck — Zig used a labeled block returning a tuple;
    // Rust keeps the same control flow inside a labeled block.
    let (pkg_map, importer_dep_res_versions, workspace_pkgs_off, workspace_pkgs_end) = 'build: {
        let mut string_buf = lockfile.string_buf();

        if let Some(catalogs_expr) = root.get_object(b"catalogs") {
            lockfile::CatalogMap::from_pnpm_lockfile(
                lockfile,
                log,
                catalogs_expr.data.as_e_object(),
                &mut string_buf,
            )?;
        }

        if let Some(overrides_expr) = root.get_object(b"overrides") {
            for prop in overrides_expr.data.as_e_object().properties.slice() {
                let key = prop.key.as_ref().unwrap();
                let value = prop.value.as_ref().unwrap();

                let Some(name_str) = key.as_string() else {
                    return Err(invalid_pnpm_lockfile());
                };
                let name_hash = String::Builder::string_hash(name_str);
                let name = string_buf.append_with_hash(name_str, name_hash)?;

                if !value.is_string() {
                    // TODO:
                    return Err(invalid_pnpm_lockfile());
                }

                let version_str = value.as_string().unwrap();
                let version_hash = String::Builder::string_hash(version_str);
                let version = string_buf.append_with_hash(version_str, version_hash)?;
                let version_sliced = version.sliced(string_buf.bytes.as_slice());

                let dep = Dependency {
                    name,
                    name_hash,
                    version: match Dependency::parse(
                        name,
                        name_hash,
                        version_sliced.slice,
                        &version_sliced,
                        log,
                        Some(manager),
                    ) {
                        Some(v) => v,
                        None => return Err(invalid_pnpm_lockfile()),
                    },
                    ..Default::default()
                };

                lockfile.overrides.map.put(name_hash, dep)?;
            }
        }

        struct Patch {
            path: String,
            dep_name: Box<[u8]>,
        }
        let mut patches: StringArrayHashMap<Patch> = StringArrayHashMap::new();
        let mut patch_join_buf: Vec<u8> = Vec::new();

        if let Some(patched_dependencies_expr) = root.get_object(b"patchedDependencies") {
            for prop in patched_dependencies_expr
                .data
                .as_e_object()
                .properties
                .slice()
            {
                let dep_name_expr = prop.key.as_ref().unwrap();
                let value = prop.value.as_ref().unwrap();

                let Some(dep_name_str) = dep_name_expr.as_string() else {
                    return Err(invalid_pnpm_lockfile());
                };

                let Some((path_str, _)) = value.get_string(b"path")? else {
                    return Err(invalid_pnpm_lockfile());
                };

                let Some((hash_str, _)) = value.get_string(b"hash")? else {
                    return Err(invalid_pnpm_lockfile());
                };

                let entry = patches.get_or_put(hash_str)?;
                if entry.found_existing {
                    return Err(invalid_pnpm_lockfile());
                }
                *entry.value_ptr = Patch {
                    path: string_buf.append(path_str)?,
                    dep_name: Box::<[u8]>::from(dep_name_str),
                };
            }
        }

        let Some(importers_obj) = root.get_object(b"importers") else {
            log.add_error(
                None,
                logger::Loc::EMPTY,
                b"pnpm-lock.yaml missing 'importers' field",
            )?;
            return Err(MigratePnpmLockfileError::PnpmLockfileMissingImporters);
        };

        let mut has_root_pkg_expr: Option<Expr> = None;

        for prop in importers_obj.data.as_e_object().properties.slice() {
            let Some(importer_path) = prop.key.as_ref().unwrap().as_string() else {
                return Err(invalid_pnpm_lockfile());
            };
            let value = prop.value.as_ref().unwrap();

            if importer_path == b"." {
                if has_root_pkg_expr.is_some() {
                    return Err(invalid_pnpm_lockfile());
                }
                has_root_pkg_expr = Some(value.clone());
                continue;
            }

            let mut pkg_json_path = bun_paths::AutoAbsPath::init_top_level_dir();

            pkg_json_path.append(importer_path);
            pkg_json_path.append(b"package.json");

            let importer_pkg_json = match manager
                .workspace_package_json_cache
                .get_with_path(log, pkg_json_path.slice(), Default::default())
                .unwrap_result()
            {
                Ok(j) => j,
                Err(_) => return Err(invalid_pnpm_lockfile()),
            };

            let workspace_root = &importer_pkg_json.root;

            let Some((name, _)) = workspace_root.get_string(b"name")? else {
                // we require workspace names.
                return Err(MigratePnpmLockfileError::WorkspaceNameMissing);
            };

            let name_hash = String::Builder::string_hash(name);

            lockfile
                .workspace_paths
                .put(name_hash, string_buf.append(importer_path)?)?;

            if let Some(version_expr) = value.get(b"version") {
                let Some(version_raw) = version_expr.as_string() else {
                    return Err(invalid_pnpm_lockfile());
                };
                let version_str = string_buf.append(version_raw)?;

                let parsed = semver::Version::parse(version_str.sliced(string_buf.bytes.as_slice()));
                if !parsed.valid {
                    return Err(invalid_pnpm_lockfile());
                }

                lockfile
                    .workspace_versions
                    .put(name_hash, parsed.version.min())?;
            }
        }

        let Some(root_pkg_expr) = has_root_pkg_expr else {
            log.add_error(
                None,
                logger::Loc::EMPTY,
                b"pnpm-lock.yaml missing root package entry (importers['.'])",
            )?;
            return Err(MigratePnpmLockfileError::PnpmLockfileMissingRootPackage);
        };

        let mut importer_dep_res_versions: StringArrayHashMap<StringArrayHashMap<Box<[u8]>>> =
            StringArrayHashMap::new();

        {
            let mut pkg_json_path = bun_paths::AutoAbsPath::init_top_level_dir();

            pkg_json_path.append(b"package.json");

            let pkg_json = match manager
                .workspace_package_json_cache
                .get_with_path(log, pkg_json_path.slice(), Default::default())
                .unwrap_result()
            {
                Ok(j) => j,
                Err(_) => return Err(invalid_pnpm_lockfile()),
            };

            let mut root_pkg = lockfile::Package::default();

            if let Some((name, _)) = pkg_json.root.get_string(b"name")? {
                let name_hash = String::Builder::string_hash(name);
                root_pkg.name = string_buf.append_with_hash(name, name_hash)?;
                root_pkg.name_hash = name_hash;
            }

            let importer_versions = importer_dep_res_versions.get_or_put(b".")?;
            *importer_versions.value_ptr = StringArrayHashMap::new();

            let (off, len) = parse_append_importer_dependencies(
                lockfile,
                manager,
                &root_pkg_expr,
                &mut string_buf,
                log,
                true,
                &importers_obj,
                importer_versions.value_ptr,
            )?;

            root_pkg.dependencies = lockfile::DependencySlice { off, len };
            root_pkg.resolutions = lockfile::DependencySlice { off, len };

            root_pkg.meta.id = 0;
            root_pkg.resolution = Resolution::init_root();
            // TODO(port): Resolution::init(.{ .root = {} }) — verify constructor name
            lockfile.packages.append(root_pkg)?;
            lockfile.get_or_put_id(0, root_pkg.name_hash)?;
        }

        let mut pkg_map: StringArrayHashMap<PackageID> = StringArrayHashMap::new();

        pkg_map.put_no_clobber(bun_fs::FileSystem::instance().top_level_dir(), 0)?;

        let workspace_pkgs_off = lockfile.packages.len();

        'workspaces: for workspace_path in lockfile.workspace_paths.values() {
            for prop in importers_obj.data.as_e_object().properties.slice() {
                let key = prop.key.as_ref().unwrap();
                let value = prop.value.as_ref().unwrap();

                let path = key.as_string().unwrap();
                if !strings::eql_long(path, workspace_path.slice(string_buf.bytes.as_slice()), true)
                {
                    continue;
                }

                let mut pkg = lockfile::Package::default();

                pkg.resolution = Resolution {
                    tag: Resolution::Tag::Workspace,
                    value: Resolution::Value {
                        workspace: string_buf.append(path)?,
                    },
                };

                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();

                path_buf.append(path);
                let abs_path: Box<[u8]> = Box::from(path_buf.slice());
                path_buf.append(b"package.json");

                let workspace_pkg_json = match manager
                    .workspace_package_json_cache
                    .get_with_path(log, path_buf.slice(), Default::default())
                    .unwrap_result()
                {
                    Ok(j) => j,
                    Err(_) => return Err(invalid_pnpm_lockfile()),
                };

                let workspace_root = &workspace_pkg_json.root;

                let name = workspace_root.get(b"name").unwrap().as_string().unwrap();
                let name_hash = String::Builder::string_hash(name);

                pkg.name = string_buf.append_with_hash(name, name_hash)?;
                pkg.name_hash = name_hash;

                let importer_versions = importer_dep_res_versions.get_or_put(path)?;
                if importer_versions.found_existing {
                    return Err(invalid_pnpm_lockfile());
                }
                *importer_versions.value_ptr = StringArrayHashMap::new();

                let (off, len) = parse_append_importer_dependencies(
                    lockfile,
                    manager,
                    value,
                    &mut string_buf,
                    log,
                    false,
                    &importers_obj,
                    importer_versions.value_ptr,
                )?;

                pkg.dependencies = lockfile::DependencySlice { off, len };
                pkg.resolutions = lockfile::DependencySlice { off, len };

                if let Some(bin_expr) = workspace_root.get(b"bin") {
                    pkg.bin = Bin::parse_append(
                        bin_expr,
                        &mut string_buf,
                        &mut lockfile.buffers.extern_strings,
                    )?;
                } else if let Some(directories_expr) = workspace_root.get(b"directories") {
                    if let Some(bin_expr) = directories_expr.get(b"bin") {
                        pkg.bin = Bin::parse_append_from_directories(bin_expr, &mut string_buf)?;
                    }
                }

                let pkg_id = lockfile.append_package_dedupe(&mut pkg, string_buf.bytes.as_slice())?;

                let entry = pkg_map.get_or_put(&abs_path)?;
                if entry.found_existing {
                    return Err(invalid_pnpm_lockfile());
                }

                *entry.value_ptr = pkg_id;

                continue 'workspaces;
            }
        }

        let workspace_pkgs_end = lockfile.packages.len();

        // add packages for symlink dependencies. pnpm-lock does not add an entry
        // for these dependencies in packages/snapshots
        for _pkg_id in 0..workspace_pkgs_end {
            let pkg_id: PackageID = u32::try_from(_pkg_id).unwrap();

            let workspace_path: &[u8] = if pkg_id == 0 {
                b"."
            } else {
                let workspace_res = &lockfile.packages.items_resolution()[pkg_id as usize];
                workspace_res
                    .value
                    .workspace
                    .slice(string_buf.bytes.as_slice())
            };

            let Some(importer_versions) = importer_dep_res_versions.get(workspace_path) else {
                return Err(invalid_pnpm_lockfile());
            };

            let deps = lockfile.packages.items_dependencies()[pkg_id as usize];
            'next_dep: for _dep_id in deps.begin()..deps.end() {
                let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();

                let dep = &lockfile.buffers.dependencies[dep_id as usize];

                if dep.behavior.is_workspace() {
                    continue;
                }

                match dep.version.tag {
                    dependency::Version::Tag::Folder | dependency::Version::Tag::Workspace => {
                        let Some(version_str) =
                            importer_versions.get(dep.name.slice(string_buf.bytes.as_slice()))
                        else {
                            return Err(invalid_pnpm_lockfile());
                        };
                        let version_without_suffix = remove_suffix(version_str);

                        if let Some(link_path) =
                            strings::without_prefix_if_possible(version_without_suffix, b"link:")
                        {
                            // create a link package for the workspace dependency only if it doesn't already exist
                            if dep.version.tag == dependency::Version::Tag::Workspace {
                                let mut link_path_buf =
                                    bun_paths::AutoAbsPath::init_top_level_dir();
                                link_path_buf.append(workspace_path);
                                link_path_buf.join(&[link_path]);

                                for existing_workspace_path in lockfile.workspace_paths.values() {
                                    let mut workspace_path_buf =
                                        bun_paths::AutoAbsPath::init_top_level_dir();
                                    workspace_path_buf.append(
                                        existing_workspace_path
                                            .slice(string_buf.bytes.as_slice()),
                                    );

                                    if strings::eql_long(
                                        workspace_path_buf.slice(),
                                        link_path_buf.slice(),
                                        true,
                                    ) {
                                        continue 'next_dep;
                                    }
                                }

                                return Err(
                                    MigratePnpmLockfileError::NonExistentWorkspaceDependency,
                                );
                            }

                            let mut pkg = lockfile::Package {
                                name: dep.name,
                                name_hash: dep.name_hash,
                                resolution: Resolution::init_symlink(
                                    string_buf.append(link_path)?,
                                ),
                                ..Default::default()
                            };
                            // TODO(port): Resolution::init(.{ .symlink = ... }) — verify constructor

                            let mut abs_link_path = bun_paths::AutoAbsPath::init_top_level_dir();

                            abs_link_path.join(&[workspace_path, link_path]);

                            let pkg_entry = pkg_map.get_or_put(abs_link_path.slice())?;
                            if pkg_entry.found_existing {
                                // they point to the same package
                                continue;
                            }

                            *pkg_entry.value_ptr = lockfile
                                .append_package_dedupe(&mut pkg, string_buf.bytes.as_slice())?;
                        }
                    }
                    dependency::Version::Tag::Symlink => {
                        if !strings::is_npm_package_name(
                            dep.version
                                .value
                                .symlink
                                .slice(string_buf.bytes.as_slice()),
                        ) {
                            log.add_warning_fmt(
                                None,
                                logger::Loc::EMPTY,
                                format_args!(
                                    "relative link dependency not supported: {}@{}\n",
                                    bstr::BStr::new(
                                        dep.name.slice(string_buf.bytes.as_slice())
                                    ),
                                    bstr::BStr::new(
                                        dep.version.literal.slice(string_buf.bytes.as_slice())
                                    ),
                                ),
                            )?;
                            return Err(MigratePnpmLockfileError::RelativeLinkDependency);
                        }
                    }
                    _ => {}
                }
            }
        }

        struct SnapshotEntry {
            obj: Expr,
        }
        let mut snapshots: StringArrayHashMap<SnapshotEntry> = StringArrayHashMap::new();

        if let Some(packages_obj) = root.get_object(b"packages") {
            let Some(snapshots_obj) = root.get_object(b"snapshots") else {
                log.add_error(
                    None,
                    logger::Loc::EMPTY,
                    b"pnpm-lock.yaml has 'packages' but missing 'snapshots' field",
                )?;
                return Err(MigratePnpmLockfileError::PnpmLockfileInvalidSnapshot);
            };

            for snapshot_prop in snapshots_obj.data.as_e_object().properties.slice() {
                let key = snapshot_prop.key.as_ref().unwrap();
                let value = snapshot_prop.value.as_ref().unwrap();

                let Some(key_str) = key.as_string() else {
                    return Err(invalid_pnpm_lockfile());
                };

                if !value.is_object() {
                    return Err(invalid_pnpm_lockfile());
                }

                let (peer_hash_idx, patch_hash_idx) = index_of_dep_path_suffix(key_str);

                let key_str_without_suffix = if let Some(idx) = patch_hash_idx.or(peer_hash_idx) {
                    &key_str[0..idx]
                } else {
                    key_str
                };

                'try_patch: {
                    let Some(idx) = patch_hash_idx else {
                        break 'try_patch;
                    };
                    let patch_hash_str = &key_str[idx + b"(patch_hash=".len()..];
                    let Some(end_idx) = strings::index_of_char(patch_hash_str, b')') else {
                        return Err(invalid_pnpm_lockfile());
                    };
                    let Some(patch) =
                        patches.fetch_swap_remove(&patch_hash_str[0..end_idx as usize])
                    else {
                        break 'try_patch;
                    };

                    let Ok((_, res_str)) =
                        Dependency::split_name_and_version(key_str_without_suffix)
                    else {
                        return Err(invalid_pnpm_lockfile());
                    };

                    found_patches.put(patch.value.dep_name.clone(), Box::from(res_str))?;

                    patch_join_buf.clear();
                    write!(
                        &mut patch_join_buf,
                        "{}@{}",
                        bstr::BStr::new(&patch.value.dep_name),
                        bstr::BStr::new(res_str)
                    )
                    .map_err(|_| AllocError)?;

                    let patch_hash = String::Builder::string_hash(&patch_join_buf);
                    lockfile.patched_dependencies.put(
                        patch_hash,
                        lockfile::PatchedDependency {
                            path: patch.value.path,
                            ..Default::default()
                        },
                    )?;
                }

                let entry = snapshots.get_or_put(key_str_without_suffix)?;
                if entry.found_existing {
                    continue;
                }

                *entry.value_ptr = SnapshotEntry { obj: value.clone() };
            }

            for packages_prop in packages_obj.data.as_e_object().properties.slice() {
                let key = packages_prop.key.as_ref().unwrap();
                let package_obj = packages_prop.value.as_ref().unwrap();

                let Some(key_str) = key.as_string() else {
                    return Err(invalid_pnpm_lockfile());
                };

                if !package_obj.is_object() {
                    return Err(invalid_pnpm_lockfile());
                }

                let Some(snapshot) = snapshots.get(key_str) else {
                    log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml package '{}' missing corresponding snapshot entry",
                            bstr::BStr::new(key_str)
                        ),
                    )?;
                    return Err(MigratePnpmLockfileError::PnpmLockfileInvalidSnapshot);
                };

                let Ok((name_str, res_str)) = Dependency::split_name_and_version(key_str) else {
                    return Err(invalid_pnpm_lockfile());
                };

                let name_hash = String::Builder::string_hash(name_str);
                let name = string_buf.append_with_hash(name_str, name_hash)?;

                let mut res = Resolution::from_pnpm_lockfile(res_str, &mut string_buf)?;

                if res.tag == Resolution::Tag::Npm {
                    let scope = manager.scope_for_package_name(name_str);
                    let url = ExtractTarball::build_url(
                        scope.url.href,
                        strings::StringOrTinyString::init(
                            name.slice(string_buf.bytes.as_slice()),
                        ),
                        res.value.npm.version,
                        string_buf.bytes.as_slice(),
                    )?;
                    res.value.npm.url = string_buf.append(&url)?;
                }

                let mut pkg = lockfile::Package {
                    name,
                    name_hash,
                    ..Default::default()
                };

                if let Some(res_expr) = package_obj.get(b"resolution") {
                    if !res_expr.is_object() {
                        return Err(invalid_pnpm_lockfile());
                    }

                    if let Some(integrity_expr) = res_expr.get(b"integrity") {
                        let Some(integrity_str) = integrity_expr.as_string() else {
                            return Err(invalid_pnpm_lockfile());
                        };

                        pkg.meta.integrity = Integrity::parse(integrity_str);
                    }
                }

                if let Some(os_expr) = package_obj.get(b"os") {
                    pkg.meta.os = Negatable::<npm::OperatingSystem>::from_json(os_expr)?;
                }
                if let Some(cpu_expr) = package_obj.get(b"cpu") {
                    pkg.meta.arch = Negatable::<npm::Architecture>::from_json(cpu_expr)?;
                }
                // TODO: libc
                // if let Some(libc_expr) = package_obj.get(b"libc") {
                //     pkg.meta.libc = Negatable::<npm::Libc>::from_json(libc_expr)?;
                // }

                let (off, len) = parse_append_package_dependencies(
                    lockfile,
                    package_obj,
                    &snapshot.obj,
                    &mut string_buf,
                    log,
                )?;

                pkg.dependencies = lockfile::DependencySlice { off, len };
                pkg.resolutions = lockfile::DependencySlice { off, len };
                pkg.resolution = res.copy();

                let pkg_id = lockfile.append_package_dedupe(&mut pkg, string_buf.bytes.as_slice())?;

                let entry = pkg_map.get_or_put(key_str)?;
                if entry.found_existing {
                    return Err(invalid_pnpm_lockfile());
                }

                *entry.value_ptr = pkg_id;
            }
        }

        break 'build (
            pkg_map,
            importer_dep_res_versions,
            workspace_pkgs_off,
            workspace_pkgs_end,
        );
    };

    let string_buf = lockfile.buffers.string_bytes.as_slice();

    let mut res_buf: Vec<u8> = Vec::new();

    lockfile
        .buffers
        .resolutions
        .reserve_exact(
            lockfile
                .buffers
                .dependencies
                .len()
                .saturating_sub(lockfile.buffers.resolutions.len()),
        );
    lockfile
        .buffers
        .resolutions
        .resize(lockfile.buffers.dependencies.len(), INVALID_PACKAGE_ID);
    // PORT NOTE: Zig did ensureTotalCapacityPrecise + expandToCapacity + @memset; resize covers all three.

    let pkgs = lockfile.packages.slice();
    let pkg_deps = pkgs.items_dependencies();
    let _pkg_names = pkgs.items_name();
    let pkg_resolutions = pkgs.items_resolution();

    {
        let Some(importer_versions) = importer_dep_res_versions.get(b".") else {
            return Err(invalid_pnpm_lockfile());
        };

        // resolve root dependencies first
        for _dep_id in pkg_deps[0].begin()..pkg_deps[0].end() {
            let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();
            let dep = &lockfile.buffers.dependencies[dep_id as usize];

            // implicit workspace dependencies
            if dep.behavior.is_workspace() {
                let workspace_path = dep.version.value.workspace.slice(string_buf);
                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                path_buf.join(&[workspace_path]);
                if let Some(workspace_pkg_id) = pkg_map.get(path_buf.slice()) {
                    lockfile.buffers.resolutions[dep_id as usize] = *workspace_pkg_id;
                    continue;
                }
            }

            let dep_name = dep.name.slice(string_buf);
            let Some(mut version_maybe_alias) = importer_versions.get(dep_name).map(|v| &**v)
            else {
                log.add_error_fmt(
                    None,
                    logger::Loc::EMPTY,
                    format_args!(
                        "pnpm-lock.yaml cannot resolve root dependency '{}' - missing version in importer",
                        bstr::BStr::new(dep_name)
                    ),
                )?;
                return Err(MigratePnpmLockfileError::PnpmLockfileUnresolvableDependency);
            };
            if strings::has_prefix(version_maybe_alias, b"npm:") {
                version_maybe_alias = &version_maybe_alias[b"npm:".len()..];
            }
            let (version, has_alias) = Dependency::split_version_and_maybe_name(version_maybe_alias);
            let version_without_suffix = remove_suffix(version);

            if let Some(maybe_symlink_or_folder_or_workspace_path) =
                strings::without_prefix_if_possible(version_without_suffix, b"link:")
            {
                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                path_buf.join(&[maybe_symlink_or_folder_or_workspace_path]);
                if let Some(pkg_id) = pkg_map.get(path_buf.slice()) {
                    lockfile.buffers.resolutions[dep_id as usize] = *pkg_id;
                    continue;
                }
            }

            res_buf.clear();
            write!(
                &mut res_buf,
                "{}@{}",
                bstr::BStr::new(has_alias.unwrap_or(dep_name)),
                bstr::BStr::new(version_without_suffix)
            )
            .map_err(|_| AllocError)?;

            let Some(pkg_id) = pkg_map.get(&res_buf) else {
                return Err(invalid_pnpm_lockfile());
            };

            lockfile.buffers.resolutions[dep_id as usize] = *pkg_id;
        }
    }

    for _pkg_id in workspace_pkgs_off..workspace_pkgs_end {
        let pkg_id: PackageID = u32::try_from(_pkg_id).unwrap();

        let workspace_res = &pkg_resolutions[pkg_id as usize];
        let workspace_path = workspace_res.value.workspace.slice(string_buf);

        let Some(importer_versions) = importer_dep_res_versions.get(workspace_path) else {
            return Err(invalid_pnpm_lockfile());
        };

        let deps = pkg_deps[pkg_id as usize];
        for _dep_id in deps.begin()..deps.end() {
            let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();
            let dep = &lockfile.buffers.dependencies[dep_id as usize];
            let dep_name = dep.name.slice(string_buf);
            let Some(mut version_maybe_alias) = importer_versions.get(dep_name).map(|v| &**v)
            else {
                log.add_error_fmt(
                    None,
                    logger::Loc::EMPTY,
                    format_args!(
                        "pnpm-lock.yaml cannot resolve workspace dependency '{}' in '{}' - missing version",
                        bstr::BStr::new(dep_name),
                        bstr::BStr::new(workspace_path)
                    ),
                )?;
                return Err(MigratePnpmLockfileError::PnpmLockfileUnresolvableDependency);
            };
            if strings::has_prefix(version_maybe_alias, b"npm:") {
                version_maybe_alias = &version_maybe_alias[b"npm:".len()..];
            }
            let (version, has_alias) = Dependency::split_version_and_maybe_name(version_maybe_alias);
            let version_without_suffix = remove_suffix(version);

            if let Some(maybe_symlink_or_folder_or_workspace_path) =
                strings::without_prefix_if_possible(version_without_suffix, b"link:")
            {
                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                path_buf.join(&[workspace_path, maybe_symlink_or_folder_or_workspace_path]);
                if let Some(link_pkg_id) = pkg_map.get(path_buf.slice()) {
                    lockfile.buffers.resolutions[dep_id as usize] = *link_pkg_id;
                    continue;
                }
            }

            res_buf.clear();
            write!(
                &mut res_buf,
                "{}@{}",
                bstr::BStr::new(has_alias.unwrap_or(dep_name)),
                bstr::BStr::new(version_without_suffix)
            )
            .map_err(|_| AllocError)?;

            let Some(res_pkg_id) = pkg_map.get(&res_buf) else {
                return Err(invalid_pnpm_lockfile());
            };

            lockfile.buffers.resolutions[dep_id as usize] = *res_pkg_id;
        }
    }

    for _pkg_id in workspace_pkgs_end..lockfile.packages.len() {
        let pkg_id: PackageID = u32::try_from(_pkg_id).unwrap();

        let deps = pkg_deps[pkg_id as usize];
        for _dep_id in deps.begin()..deps.end() {
            let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();
            let dep = &lockfile.buffers.dependencies[dep_id as usize];
            let mut version_maybe_alias = dep.version.literal.slice(string_buf);
            if strings::has_prefix(version_maybe_alias, b"npm:") {
                version_maybe_alias = &version_maybe_alias[b"npm:".len()..];
            }
            let (version, has_alias) = Dependency::split_version_and_maybe_name(version_maybe_alias);
            let version_without_suffix = remove_suffix(version);

            match dep.version.tag {
                dependency::Version::Tag::Folder
                | dependency::Version::Tag::Symlink
                | dependency::Version::Tag::Workspace => {
                    let maybe_symlink_or_folder_or_workspace_path =
                        strings::without_prefix(version_without_suffix, b"link:");
                    let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                    path_buf.join(&[maybe_symlink_or_folder_or_workspace_path]);
                    if let Some(link_pkg_id) = pkg_map.get(path_buf.slice()) {
                        lockfile.buffers.resolutions[dep_id as usize] = *link_pkg_id;
                        continue;
                    }
                }
                _ => {}
            }

            res_buf.clear();
            write!(
                &mut res_buf,
                "{}@{}",
                bstr::BStr::new(has_alias.unwrap_or(dep.name.slice(string_buf))),
                bstr::BStr::new(version_without_suffix)
            )
            .map_err(|_| AllocError)?;

            let Some(res_pkg_id) = pkg_map.get(&res_buf) else {
                return Err(invalid_pnpm_lockfile());
            };

            lockfile.buffers.resolutions[dep_id as usize] = *res_pkg_id;
        }
    }

    lockfile.resolve(log)?;

    lockfile.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration(manager, false)?;

    update_package_json_after_migration(manager, log, dir, &found_patches)?;

    Ok(LoadResult::Ok {
        lockfile, // TODO(port): LoadResult.ok stores *Lockfile in Zig — verify ownership in Phase B
        loaded_from_binary_lockfile: false,
        migrated: lockfile::Migrated::Pnpm,
        serializer_result: Default::default(),
        format: lockfile::Format::Text,
    })
}

fn invalid_pnpm_lockfile() -> MigratePnpmLockfileError {
    MigratePnpmLockfileError::InvalidPnpmLockfile
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ParseAppendDependenciesError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("InvalidPnpmLockfile")]
    InvalidPnpmLockfile,
    #[error("PnpmLockfileInvalidDependency")]
    PnpmLockfileInvalidDependency,
    #[error("PnpmLockfileMissingDependencyVersion")]
    PnpmLockfileMissingDependencyVersion,
    #[error("PnpmLockfileMissingCatalogEntry")]
    PnpmLockfileMissingCatalogEntry,
}

impl From<AllocError> for ParseAppendDependenciesError {
    fn from(_: AllocError) -> Self {
        Self::OutOfMemory
    }
}

impl From<ParseAppendDependenciesError> for bun_core::Error {
    fn from(e: ParseAppendDependenciesError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

impl From<ParseAppendDependenciesError> for MigratePnpmLockfileError {
    fn from(e: ParseAppendDependenciesError) -> Self {
        match e {
            ParseAppendDependenciesError::OutOfMemory => Self::OutOfMemory,
            ParseAppendDependenciesError::InvalidPnpmLockfile => Self::InvalidPnpmLockfile,
            ParseAppendDependenciesError::PnpmLockfileInvalidDependency => {
                Self::PnpmLockfileInvalidDependency
            }
            ParseAppendDependenciesError::PnpmLockfileMissingDependencyVersion => {
                Self::PnpmLockfileMissingDependencyVersion
            }
            ParseAppendDependenciesError::PnpmLockfileMissingCatalogEntry => {
                Self::PnpmLockfileMissingCatalogEntry
            }
        }
    }
}

fn parse_append_package_dependencies(
    lockfile: &mut Lockfile,
    package_obj: &Expr,
    snapshot_obj: &Expr,
    string_buf: &mut String::Buf,
    log: &mut logger::Log,
) -> Result<(u32, u32), ParseAppendDependenciesError> {
    let mut version_buf: Vec<u8> = Vec::new();

    let off = lockfile.buffers.dependencies.len();

    const SNAPSHOT_DEPENDENCY_GROUPS: [(&[u8], dependency::Behavior); 2] = [
        (b"devDependencies", dependency::Behavior::DEV),
        (b"optionalDependencies", dependency::Behavior::OPTIONAL),
    ];
    // TODO(port): Dependency.Behavior is a packed struct in Zig with bool fields;
    // assuming associated consts DEV/OPTIONAL/PROD/PEER/WORKSPACE on the Rust port.

    for (group_name, group_behavior) in SNAPSHOT_DEPENDENCY_GROUPS {
        if let Some(deps) = snapshot_obj.get(group_name) {
            if !deps.is_object() {
                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
            }

            for prop in deps.data.as_e_object().properties.slice() {
                let key = prop.key.as_ref().unwrap();
                let value = prop.value.as_ref().unwrap();

                let Some(name_str) = key.as_string() else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let name_hash = String::Builder::string_hash(name_str);
                let name = string_buf.append_external_with_hash(name_str, name_hash)?;

                let Some(version_str) = value.as_string() else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let version_without_suffix = remove_suffix(version_str);

                let version = string_buf.append(version_without_suffix)?;
                let version_sliced = version.sliced(string_buf.bytes.as_slice());

                let behavior: dependency::Behavior = group_behavior;

                let dep = Dependency {
                    name: name.value,
                    name_hash,
                    behavior,
                    version: match Dependency::parse(
                        name.value,
                        name.hash,
                        version_sliced.slice,
                        &version_sliced,
                        log,
                        None,
                    ) {
                        Some(v) => v,
                        None => return Err(ParseAppendDependenciesError::InvalidPnpmLockfile),
                    },
                };

                lockfile.buffers.dependencies.push(dep);
            }
        }
    }

    if let Some(deps) = snapshot_obj.get(b"dependencies") {
        if !deps.is_object() {
            return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
        }

        // for each dependency first look it up in peerDependencies in package_obj
        'next_prod_dep: for prop in deps.data.as_e_object().properties.slice() {
            let key = prop.key.as_ref().unwrap();
            let value = prop.value.as_ref().unwrap();

            let Some(name_str) = key.as_string() else {
                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
            };

            let name_hash = String::Builder::string_hash(name_str);
            let name = string_buf.append_external_with_hash(name_str, name_hash)?;

            let Some(version_str) = value.as_string() else {
                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
            };

            let version_without_suffix = remove_suffix(version_str);

            // pnpm-lock.yaml does not prefix aliases with npm: in snapshots
            let (_, has_alias) = Dependency::split_version_and_maybe_name(version_without_suffix);

            let mut alias: Option<ExternalString> = None;
            let version_sliced = 'version: {
                if let Some(alias_str) = has_alias {
                    alias = Some(string_buf.append_external(alias_str)?);
                    version_buf.clear();
                    write!(
                        &mut version_buf,
                        "npm:{}",
                        bstr::BStr::new(version_without_suffix)
                    )
                    .map_err(|_| AllocError)?;
                    let version = string_buf.append(&version_buf)?;
                    let version_sliced = version.sliced(string_buf.bytes.as_slice());
                    break 'version version_sliced;
                }

                let version = string_buf.append(version_without_suffix)?;
                let version_sliced = version.sliced(string_buf.bytes.as_slice());
                break 'version version_sliced;
            };

            if let Some(peers) = package_obj.get(b"peerDependencies") {
                if !peers.is_object() {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                }

                for peer_prop in peers.data.as_e_object().properties.slice() {
                    let Some(peer_name_str) = peer_prop.key.as_ref().unwrap().as_string() else {
                        return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                    };

                    // let Some(peer_version_str) = peer_prop.value.as_ref().unwrap().as_string() else {
                    //     return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                    // };
                    //
                    // let peer_version_without_suffix = remove_suffix(peer_version_str);
                    //
                    // let peer_version = string_buf.append(peer_version_without_suffix)?;
                    // let peer_version_sliced = peer_version.sliced(string_buf.bytes.as_slice());

                    let mut behavior = dependency::Behavior::PEER;

                    if strings::eql_long(name_str, peer_name_str, true) {
                        if let Some(peers_meta) = package_obj.get(b"peerDependenciesMeta") {
                            if !peers_meta.is_object() {
                                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                            }

                            for peer_meta_prop in peers_meta.data.as_e_object().properties.slice() {
                                let Some(peer_meta_name_str) =
                                    peer_meta_prop.key.as_ref().unwrap().as_string()
                                else {
                                    return Err(
                                        ParseAppendDependenciesError::InvalidPnpmLockfile,
                                    );
                                };

                                if strings::eql_long(name_str, peer_meta_name_str, true) {
                                    let meta_obj = peer_meta_prop.value.as_ref().unwrap();
                                    if !meta_obj.is_object() {
                                        return Err(
                                            ParseAppendDependenciesError::InvalidPnpmLockfile,
                                        );
                                    }

                                    behavior.set_optional(
                                        meta_obj.get_boolean(b"optional").unwrap_or(false),
                                    );
                                    break;
                                }
                            }
                        }
                        let dep = Dependency {
                            name: name.value,
                            name_hash: name.hash,
                            behavior,
                            version: match Dependency::parse(
                                alias.map(|a| a.value).unwrap_or(name.value),
                                alias.map(|a| a.hash).unwrap_or(name.hash),
                                version_sliced.slice,
                                &version_sliced,
                                log,
                                None,
                            ) {
                                Some(v) => v,
                                None => {
                                    return Err(
                                        ParseAppendDependenciesError::InvalidPnpmLockfile,
                                    )
                                }
                            },
                        };

                        lockfile.buffers.dependencies.push(dep);
                        continue 'next_prod_dep;
                    }
                }
            }

            let dep = Dependency {
                name: name.value,
                name_hash: name.hash,
                behavior: dependency::Behavior::PROD,
                version: match Dependency::parse(
                    alias.map(|a| a.value).unwrap_or(name.value),
                    alias.map(|a| a.hash).unwrap_or(name.hash),
                    version_sliced.slice,
                    &version_sliced,
                    log,
                    None,
                ) {
                    Some(v) => v,
                    None => return Err(ParseAppendDependenciesError::InvalidPnpmLockfile),
                },
            };

            lockfile.buffers.dependencies.push(dep);
        }
    }

    let end = lockfile.buffers.dependencies.len();

    {
        let bytes = string_buf.bytes.as_slice();
        lockfile.buffers.dependencies[off..].sort_by(|a, b| {
            if Dependency::is_less_than(bytes, a, b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
        // TODO(port): std.sort.pdq — verify Dependency::is_less_than provides a strict weak order
    }

    Ok((
        u32::try_from(off).unwrap(),
        u32::try_from(end - off).unwrap(),
    ))
}

fn parse_append_importer_dependencies(
    lockfile: &mut Lockfile,
    manager: &mut PackageManager,
    pkg_expr: &Expr,
    string_buf: &mut String::Buf,
    log: &mut logger::Log,
    is_root: bool,
    importers_obj: &Expr,
    importer_versions: &mut StringArrayHashMap<Box<[u8]>>,
) -> Result<(u32, u32), ParseAppendDependenciesError> {
    const IMPORTER_DEPENDENCY_GROUPS: [(&[u8], dependency::Behavior); 3] = [
        (b"dependencies", dependency::Behavior::PROD),
        (b"devDependencies", dependency::Behavior::DEV),
        (b"optionalDependencies", dependency::Behavior::OPTIONAL),
    ];

    let off = lockfile.buffers.dependencies.len();

    for (group_name, group_behavior) in IMPORTER_DEPENDENCY_GROUPS {
        if let Some(deps) = pkg_expr.get(group_name) {
            if !deps.is_object() {
                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
            }

            for prop in deps.data.as_e_object().properties.slice() {
                let key = prop.key.as_ref().unwrap();
                let value = prop.value.as_ref().unwrap();

                let Some(name_str) = key.as_string() else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let name_hash = String::Builder::string_hash(name_str);
                let name = string_buf.append_external_with_hash(name_str, name_hash)?;

                let Some(specifier_expr) = value.get(b"specifier") else {
                    log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml dependency '{}' missing 'specifier' field",
                            bstr::BStr::new(name_str)
                        ),
                    )?;
                    return Err(ParseAppendDependenciesError::PnpmLockfileInvalidDependency);
                };

                let Some(version_expr) = value.get(b"version") else {
                    log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml dependency '{}' missing 'version' field",
                            bstr::BStr::new(name_str)
                        ),
                    )?;
                    return Err(
                        ParseAppendDependenciesError::PnpmLockfileMissingDependencyVersion,
                    );
                };

                let Some(version_str) = version_expr.as_string_cloned()? else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let entry = importer_versions.get_or_put(name_str)?;
                if entry.found_existing {
                    continue;
                }
                *entry.value_ptr = Box::from(remove_suffix(&version_str));

                let Some(specifier_str) = specifier_expr.as_string() else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                if strings::has_prefix(specifier_str, b"catalog:") {
                    let catalog_group_name_str = &specifier_str[b"catalog:".len()..];
                    let catalog_group_name = string_buf.append(catalog_group_name_str)?;
                    let Some(mut dep) = lockfile.catalogs.get(lockfile, catalog_group_name, name.value)
                    else {
                        // catalog is missing an entry in the "catalogs" object in the lockfile
                        log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "pnpm-lock.yaml catalog '{}' missing entry for dependency '{}'",
                                bstr::BStr::new(catalog_group_name_str),
                                bstr::BStr::new(name_str)
                            ),
                        )?;
                        return Err(ParseAppendDependenciesError::PnpmLockfileMissingCatalogEntry);
                    };

                    dep.behavior = group_behavior;

                    lockfile.buffers.dependencies.push(dep);
                    continue;
                }

                let specifier = string_buf.append(specifier_str)?;
                let specifier_sliced = specifier.sliced(string_buf.bytes.as_slice());

                let behavior: dependency::Behavior = group_behavior;

                // TODO: find peerDependencies from package.json
                if group_behavior.prod() {
                    // PERF(port): was comptime branch — profile in Phase B
                    //
                }

                let dep = Dependency {
                    name: name.value,
                    name_hash: name.hash,
                    behavior,
                    version: match Dependency::parse(
                        name.value,
                        name.hash,
                        specifier_sliced.slice,
                        &specifier_sliced,
                        log,
                        None,
                    ) {
                        Some(v) => v,
                        None => return Err(ParseAppendDependenciesError::InvalidPnpmLockfile),
                    },
                };

                lockfile.buffers.dependencies.push(dep);
            }
        }
    }

    if is_root {
        'workspaces: for workspace_path in lockfile.workspace_paths.values() {
            for prop in importers_obj.data.as_e_object().properties.slice() {
                let key = prop.key.as_ref().unwrap();
                let path = key.as_string().unwrap();
                if !strings::eql_long(path, workspace_path.slice(string_buf.bytes.as_slice()), true)
                {
                    continue;
                }

                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();

                path_buf.append(path);
                path_buf.append(b"package.json");

                let workspace_pkg_json = match manager
                    .workspace_package_json_cache
                    .get_with_path(log, path_buf.slice(), Default::default())
                    .unwrap_result()
                {
                    Ok(j) => j,
                    Err(_) => return Err(ParseAppendDependenciesError::InvalidPnpmLockfile),
                };

                let Some((name, _)) = workspace_pkg_json.root.get_string(b"name")? else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let name_hash = String::Builder::string_hash(name);
                let dep = Dependency {
                    name: string_buf.append_with_hash(name, name_hash)?,
                    name_hash,
                    behavior: dependency::Behavior::WORKSPACE,
                    version: dependency::Version {
                        tag: dependency::Version::Tag::Workspace,
                        value: dependency::Version::Value {
                            workspace: string_buf.append(path)?,
                        },
                        ..Default::default()
                    },
                };

                lockfile.buffers.dependencies.push(dep);
                continue 'workspaces;
            }
        }
    }

    let end = lockfile.buffers.dependencies.len();

    {
        let bytes = string_buf.bytes.as_slice();
        lockfile.buffers.dependencies[off..].sort_by(|a, b| {
            if Dependency::is_less_than(bytes, a, b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
        // TODO(port): std.sort.pdq — verify comparator semantics
    }

    Ok((
        u32::try_from(off).unwrap(),
        u32::try_from(end - off).unwrap(),
    ))
}

/// Updates package.json with workspace and catalog information after migration
fn update_package_json_after_migration(
    manager: &mut PackageManager,
    log: &mut logger::Log,
    dir: Fd,
    patches: &StringArrayHashMap<Box<[u8]>>,
) -> Result<(), AllocError> {
    let mut pkg_json_path = bun_paths::AbsPath::init_top_level_dir();
    // TODO(port): bun.AbsPath(.{}) — verify generic params on Rust port

    pkg_json_path.append(b"package.json");

    let root_pkg_json = match manager
        .workspace_package_json_cache
        .get_with_path(
            log,
            pkg_json_path.slice(),
            crate::WorkspacePackageJsonOptions {
                guess_indentation: true,
                ..Default::default()
            },
        )
        .unwrap_result()
    {
        Ok(j) => j,
        Err(_) => return Ok(()),
    };

    let mut json = root_pkg_json.root.clone();
    if !json.data.is_e_object() {
        return Ok(());
    }

    let mut needs_update = false;
    let mut moved_overrides = false;
    let mut moved_patched_deps = false;

    if let Some(pnpm_prop) = json.as_property(b"pnpm") {
        if pnpm_prop.expr.data.is_e_object() {
            let pnpm_obj = pnpm_prop.expr.data.as_e_object_mut();

            if let Some(overrides_field) = pnpm_obj.get(b"overrides") {
                if overrides_field.data.is_e_object() {
                    if let Some(existing_prop) = json.as_property(b"overrides") {
                        if existing_prop.expr.data.is_e_object() {
                            let existing_overrides = existing_prop.expr.data.as_e_object_mut();
                            for prop in overrides_field.data.as_e_object().properties.slice() {
                                let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                                    continue;
                                };
                                existing_overrides.put(key, prop.value.clone().unwrap())?;
                            }
                        }
                    } else {
                        json.data
                            .as_e_object_mut()
                            .put(b"overrides", overrides_field)?;
                    }
                    moved_overrides = true;
                    needs_update = true;
                }
            }

            if let Some(patched_field) = pnpm_obj.get(b"patchedDependencies") {
                if patched_field.data.is_e_object() {
                    if let Some(existing_prop) = json.as_property(b"patchedDependencies") {
                        if existing_prop.expr.data.is_e_object() {
                            let existing_patches = existing_prop.expr.data.as_e_object_mut();
                            for prop in patched_field.data.as_e_object().properties.slice() {
                                let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                                    continue;
                                };
                                existing_patches.put(key, prop.value.clone().unwrap())?;
                            }
                        }
                    } else {
                        json.data
                            .as_e_object_mut()
                            .put(b"patchedDependencies", patched_field)?;
                    }
                    moved_patched_deps = true;
                    needs_update = true;
                }
            }

            if moved_overrides || moved_patched_deps {
                let mut remaining_count: usize = 0;
                for prop in pnpm_obj.properties.slice() {
                    let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                        remaining_count += 1;
                        continue;
                    };
                    if moved_overrides && key == b"overrides" {
                        continue;
                    }
                    if moved_patched_deps && key == b"patchedDependencies" {
                        continue;
                    }
                    remaining_count += 1;
                }

                if remaining_count == 0 {
                    let mut new_root_count: usize = 0;
                    for prop in json.data.as_e_object().properties.slice() {
                        let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                            new_root_count += 1;
                            continue;
                        };
                        if key != b"pnpm" {
                            new_root_count += 1;
                        }
                    }

                    let mut new_root_props =
                        js_ast::G::Property::List::init_capacity(new_root_count)?;
                    for prop in json.data.as_e_object().properties.slice() {
                        let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                            new_root_props.push(prop.clone());
                            // PERF(port): was assume_capacity
                            continue;
                        };
                        if key != b"pnpm" {
                            new_root_props.push(prop.clone());
                            // PERF(port): was assume_capacity
                        }
                    }

                    json.data.as_e_object_mut().properties = new_root_props;
                } else {
                    let mut new_pnpm_props =
                        js_ast::G::Property::List::init_capacity(remaining_count)?;
                    for prop in pnpm_obj.properties.slice() {
                        let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                            new_pnpm_props.push(prop.clone());
                            // PERF(port): was assume_capacity
                            continue;
                        };
                        if moved_overrides && key == b"overrides" {
                            continue;
                        }
                        if moved_patched_deps && key == b"patchedDependencies" {
                            continue;
                        }
                        new_pnpm_props.push(prop.clone());
                        // PERF(port): was assume_capacity
                    }

                    pnpm_obj.properties = new_pnpm_props;
                }
                needs_update = true;
            }
        }
    }

    let mut workspace_paths: Option<Vec<Box<[u8]>>> = None;
    let mut catalog_obj: Option<Expr> = None;
    let mut catalogs_obj: Option<Expr> = None;
    let mut workspace_overrides_obj: Option<Expr> = None;
    let mut workspace_patched_deps_obj: Option<Expr> = None;

    match sys::File::read_from(Fd::cwd(), b"pnpm-workspace.yaml") {
        sys::Result::Ok(contents) => 'read_pnpm_workspace_yaml: {
            let yaml_source = logger::Source::init_path_string(b"pnpm-workspace.yaml", &contents);
            // TODO(port): YAML::parse needs an arena in interchange crate
            let arena = bun_alloc::Arena::new();
            let Ok(root) = bun_interchange::yaml::YAML::parse(&yaml_source, log, &arena) else {
                break 'read_pnpm_workspace_yaml;
            };

            if let Some(packages_expr) = root.get(b"packages") {
                if let Some(mut packages) = packages_expr.as_array() {
                    let mut paths: Vec<Box<[u8]>> = Vec::new();
                    while let Some(package_path) = packages.next() {
                        if let Some(package_path_str) = package_path.as_string() {
                            paths.push(Box::from(package_path_str));
                        }
                    }

                    workspace_paths = Some(paths);
                }
            }

            if let Some(catalog_expr) = root.get_object(b"catalog") {
                catalog_obj = Some(catalog_expr);
            }

            if let Some(catalogs_expr) = root.get_object(b"catalogs") {
                catalogs_obj = Some(catalogs_expr);
            }

            if let Some(overrides_expr) = root.get_object(b"overrides") {
                workspace_overrides_obj = Some(overrides_expr);
            }

            if let Some(patched_deps_expr) = root.get_object(b"patchedDependencies") {
                workspace_patched_deps_obj = Some(patched_deps_expr);
            }
        }
        sys::Result::Err(_) => {}
    }

    let has_workspace_data =
        workspace_paths.is_some() || catalog_obj.is_some() || catalogs_obj.is_some();

    if has_workspace_data {
        let use_array_format =
            workspace_paths.is_some() && catalog_obj.is_none() && catalogs_obj.is_none();

        let existing_workspaces = json.data.as_e_object().get(b"workspaces");
        let is_object_workspaces = existing_workspaces
            .as_ref()
            .map(|e| e.data.is_e_object())
            .unwrap_or(false);

        if use_array_format {
            let paths = workspace_paths.as_ref().unwrap();
            let mut items = js_ast::ExprNodeList::init_capacity(paths.len())?;
            for path in paths {
                items.push(Expr::init(
                    E::String {
                        data: path.clone(),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                ));
                // PERF(port): was assume_capacity
            }
            let array = Expr::init(E::Array { items, ..Default::default() }, logger::Loc::EMPTY);
            json.data.as_e_object_mut().put(b"workspaces", array)?;
            needs_update = true;
        } else if is_object_workspaces {
            let ws_obj = existing_workspaces.unwrap().data.as_e_object_mut();
            // TODO(port): borrowck — existing_workspaces borrow vs json mut borrow

            if let Some(paths) = &workspace_paths {
                if !paths.is_empty() {
                    let mut items = js_ast::ExprNodeList::init_capacity(paths.len())?;
                    for path in paths {
                        items.push(Expr::init(
                            E::String {
                                data: path.clone(),
                                ..Default::default()
                            },
                            logger::Loc::EMPTY,
                        ));
                        // PERF(port): was assume_capacity
                    }
                    let array =
                        Expr::init(E::Array { items, ..Default::default() }, logger::Loc::EMPTY);
                    ws_obj.put(b"packages", array)?;

                    needs_update = true;
                }
            }

            if let Some(catalog) = catalog_obj.clone() {
                ws_obj.put(b"catalog", catalog)?;
                needs_update = true;
            }

            if let Some(catalogs) = catalogs_obj.clone() {
                ws_obj.put(b"catalogs", catalogs)?;
                needs_update = true;
            }
        } else if !use_array_format {
            let mut ws_props = js_ast::G::Property::List::empty();

            if let Some(paths) = &workspace_paths {
                if !paths.is_empty() {
                    let mut items = js_ast::ExprNodeList::init_capacity(paths.len())?;
                    for path in paths {
                        items.push(Expr::init(
                            E::String {
                                data: path.clone(),
                                ..Default::default()
                            },
                            logger::Loc::EMPTY,
                        ));
                        // PERF(port): was assume_capacity
                    }
                    let value =
                        Expr::init(E::Array { items, ..Default::default() }, logger::Loc::EMPTY);
                    let key = Expr::init(
                        E::String {
                            data: Box::from(b"packages" as &[u8]),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    );

                    ws_props.append(js_ast::G::Property {
                        key: Some(key),
                        value: Some(value),
                        ..Default::default()
                    })?;
                }
            }

            if let Some(catalog) = catalog_obj.clone() {
                let key = Expr::init(
                    E::String {
                        data: Box::from(b"catalog" as &[u8]),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                );
                ws_props.append(js_ast::G::Property {
                    key: Some(key),
                    value: Some(catalog),
                    ..Default::default()
                })?;
            }

            if let Some(catalogs) = catalogs_obj.clone() {
                let key = Expr::init(
                    E::String {
                        data: Box::from(b"catalogs" as &[u8]),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                );
                ws_props.append(js_ast::G::Property {
                    key: Some(key),
                    value: Some(catalogs),
                    ..Default::default()
                })?;
            }

            if ws_props.len() > 0 {
                let workspace_obj = Expr::init(
                    E::Object {
                        properties: ws_props,
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                );
                json.data.as_e_object_mut().put(b"workspaces", workspace_obj)?;
                needs_update = true;
            }
        }
    }

    // Handle overrides from pnpm-workspace.yaml
    if let Some(ws_overrides) = &workspace_overrides_obj {
        if ws_overrides.data.is_e_object() {
            if let Some(existing_prop) = json.as_property(b"overrides") {
                if existing_prop.expr.data.is_e_object() {
                    let existing_overrides = existing_prop.expr.data.as_e_object_mut();
                    for prop in ws_overrides.data.as_e_object().properties.slice() {
                        let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                            continue;
                        };
                        existing_overrides.put(key, prop.value.clone().unwrap())?;
                    }
                }
            } else {
                json.data
                    .as_e_object_mut()
                    .put(b"overrides", ws_overrides.clone())?;
            }
            needs_update = true;
        }
    }

    // Handle patchedDependencies from pnpm-workspace.yaml
    if let Some(ws_patched) = &mut workspace_patched_deps_obj {
        let mut join_buf: Vec<u8> = Vec::new();

        if ws_patched.data.is_e_object() {
            let props_len = ws_patched.data.as_e_object().properties.len();
            for prop_i in 0..props_len {
                // convert keys to expected "name@version" instead of only "name"
                let prop = &mut ws_patched.data.as_e_object_mut().properties.ptr_mut()[prop_i];
                // TODO(port): direct .ptr indexing — verify list API in Phase B
                let Some(key_str) = prop.key.as_ref().unwrap().as_string() else {
                    continue;
                };
                let Some(res_str) = patches.get(key_str) else {
                    continue;
                };
                join_buf.clear();
                write!(
                    &mut join_buf,
                    "{}@{}",
                    bstr::BStr::new(key_str),
                    bstr::BStr::new(res_str)
                )
                .map_err(|_| AllocError)?;
                prop.key = Some(Expr::init(
                    E::String {
                        data: Box::<[u8]>::from(join_buf.as_slice()),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                ));
            }
            if let Some(existing_prop) = json.as_property(b"patchedDependencies") {
                if existing_prop.expr.data.is_e_object() {
                    let existing_patches = existing_prop.expr.data.as_e_object_mut();
                    for prop in ws_patched.data.as_e_object().properties.slice() {
                        let Some(key) = prop.key.as_ref().unwrap().as_string() else {
                            continue;
                        };
                        existing_patches.put(key, prop.value.clone().unwrap())?;
                    }
                }
            } else {
                json.data
                    .as_e_object_mut()
                    .put(b"patchedDependencies", ws_patched.clone())?;
            }
            needs_update = true;
        }
    }

    if needs_update {
        let mut buffer_writer = bun_js_printer::BufferWriter::init();
        buffer_writer.append_newline = !root_pkg_json.source.contents.is_empty()
            && root_pkg_json.source.contents[root_pkg_json.source.contents.len() - 1] == b'\n';
        let mut package_json_writer = bun_js_printer::BufferPrinter::init(buffer_writer);

        if bun_js_printer::print_json(
            &mut package_json_writer,
            json,
            &root_pkg_json.source,
            bun_js_printer::PrintJsonOptions {
                indent: root_pkg_json.indentation,
                mangled_props: None,
                ..Default::default()
            },
        )
        .is_err()
        {
            return Ok(());
        }

        if package_json_writer.flush().is_err() {
            return Err(AllocError);
        }

        root_pkg_json.source.contents =
            Box::<[u8]>::from(package_json_writer.ctx.written_without_trailing_zero());

        // Write the updated package.json
        let write_file = match sys::File::openat(
            dir,
            b"package.json",
            sys::O::WRONLY | sys::O::TRUNC,
            0,
        )
        .unwrap_result()
        {
            Ok(f) => f,
            Err(_) => return Ok(()),
        };
        // file closes on Drop
        let _ = write_file.write(&root_pkg_json.source.contents).unwrap_result();
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/pnpm.zig (1585 lines)
//   confidence: medium
//   todos:      14
//   notes:      Heavy borrowck reshaping needed around Expr/E.Object mut borrows; Dependency.Behavior assumed bitflags consts; AutoAbsPath/Resolution constructors guessed; allocator params dropped per non-AST rules. StringArrayHashMap aliased to ArrayHashMap<Box<[u8]>,V>.
// ──────────────────────────────────────────────────────────────────────────
