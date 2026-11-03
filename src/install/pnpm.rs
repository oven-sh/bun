use bstr::BStr;
use bun_alloc::AllocError;
use bun_ast::{self, self as js_ast, E, Expr, ExprData};
use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::fmt::{escape_control_chars, for_terminal};
use bun_core::strings;
use bun_semver as semver;
use bun_semver::{ExternalString, String};
use bun_sys::{self as sys, Fd};

use crate::dependency::{self, Behavior, Dependency, DependencyExt as _, VersionTag};
use crate::integrity::Integrity;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{self, LoadResult, LoadResultOk, Lockfile, join_top_level_dir};
use crate::migration::{
    as_str, get_str, parse_manifest_bin, props, push_workspace_dependency, record_workspace, sbuf,
    string_bytes, string_hash, take_appended_dependencies,
};
use crate::npm::{self};
use crate::package_manager_real::add_remove_with_filter::WorkspaceTarget;
use crate::package_manager_real::package_json_write_back;
use crate::package_manager_real::update_package_json_and_install::save_entry;
use crate::repository::Repository;
use crate::resolution::{self, Resolution, TaggedValue};
use crate::yarn_berry::scalar_text;
use crate::{DependencyID, INVALID_PACKAGE_ID, PackageID, PackageManager};

use MigratePnpmLockfileError::InvalidPnpmLockfile;

macro_rules! bail {
    ($log:expr, $($message:tt)*) => {
        return Err(invalid($log, format_args!($($message)*)))
    };
}

#[cold]
#[inline(never)]
fn invalid(log: &mut bun_ast::Log, args: core::fmt::Arguments<'_>) -> MigratePnpmLockfileError {
    log.add_error_fmt(None, bun_ast::Loc::EMPTY, args);
    InvalidPnpmLockfile
}

/// returns (peers_index, patch_hash_index)
/// https://github.com/pnpm/pnpm/blob/102d5a01ddabda1184b88119adccfbe956d30579/packages/dependency-path/src/index.ts#L9-L31
fn index_of_dep_path_suffix(path: &[u8]) -> (Option<usize>, Option<usize>) {
    if path.len() < 2 || path[path.len() - 1] != b')' {
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
            if path[i + 1..].starts_with(b"(patch_hash=") {
                let peers_idx =
                    strings::index_of_char_usize(&path[i + 2..], b'(').map(|idx| idx + i + 2);

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
    patch_hash_idx
        .or(peers_idx)
        .map_or(path, |idx| &path[..idx])
}

/// pnpm dependency-path refToRelative
fn pnpm_reference_is_dep_path(reference: &[u8]) -> bool {
    if reference.first() == Some(&b'@') {
        return true;
    }
    let Some(at) = strings::index_of_char_usize(reference, b'@') else {
        return false;
    };
    strings::index_of_any(reference, b":(").is_none_or(|i| i > at)
}

fn write_pnpm_dep_path(out: &mut Vec<u8>, dep_name: &[u8], reference: &[u8]) {
    out.clear();
    if !pnpm_reference_is_dep_path(reference) {
        out.extend_from_slice(dep_name);
        out.push(b'@');
    }
    out.extend_from_slice(reference);
}

/// Binds a peer edge the way bun.lock's reader does, so the migrated tree matches the reloaded one.
fn resolve_peer_like_bun_lock(lockfile: &Lockfile, dep: &Dependency) -> Option<PackageID> {
    if !dep.behavior.is_peer() {
        return None;
    }
    lockfile::bun_lock::resolve_peer_dep_version_based(
        dep,
        &lockfile.catalogs,
        &lockfile.package_index,
        &lockfile.overrides,
        lockfile.packages.items_resolution(),
        string_bytes!(lockfile),
        |_| true,
    )
}

fn missing_package_entry(
    log: &mut bun_ast::Log,
    dep_path: &[u8],
    dep_name: &[u8],
    parent: core::fmt::Arguments<'_>,
) -> MigratePnpmLockfileError {
    invalid(
        log,
        format_args!(
            "pnpm-lock.yaml has no package entry '{}' for dependency '{}' of {}",
            for_terminal(BStr::new(dep_path)),
            escape_control_chars(dep_name),
            parent
        ),
    )
}

type StringMap = StringArrayHashMap<Box<[u8]>>;
/// Maps each pnpm `patchedDependencies` key (`d`, `d@^1.0.0`, `d@1.0.0`) to Bun's
/// `patchedDependencies` keys, one for every package that the pnpm key patches.
type FoundPatches = StringArrayHashMap<Vec<Box<[u8]>>>;

fn collect_strings(obj: &Expr, out: &mut StringMap) -> Result<(), AllocError> {
    for (key, value) in props(obj) {
        if let (Some(key), Some(value)) = (as_str(key), as_str(value)) {
            out.put(key, Box::from(value))?;
        }
    }
    Ok(())
}

/// `collect_strings` of the mapping `field` of pnpm-workspace.yaml.
fn collect_workspace_yaml_strings(
    log: &mut bun_ast::Log,
    field: &[u8],
    out: &mut StringMap,
) -> Result<(), AllocError> {
    let Ok(contents) = sys::File::read_from(Fd::cwd(), b"pnpm-workspace.yaml") else {
        return Ok(());
    };
    let contents: &'static [u8] = js_ast::data_store_dupe_str(&contents);
    let source = bun_ast::Source::init_path_string(b"pnpm-workspace.yaml", contents);
    let arena = bun_alloc::Arena::new();
    match bun_parsers::yaml::YAML::parse(
        &source,
        log,
        &arena,
        bun_parsers::yaml::CyclicAliases::Reject,
    ) {
        Ok(root) => collect_strings(&root.get(field).unwrap_or_default(), out),
        Err(_) => Ok(()),
    }
}

fn root_package_json<'a>(
    manager: &'a mut PackageManager,
    log: &mut bun_ast::Log,
) -> Option<&'a mut crate::WorkspacePackageJsonCacheEntry> {
    let mut pkg_json_path = bun_paths::AutoAbsPath::init_top_level_dir();
    let _ = pkg_json_path.append(b"package.json"); // OOM/capacity error is non-actionable here
    let options = crate::GetJsonOptions {
        guess_indentation: true,
        ..Default::default()
    };
    let cache = &mut manager.workspace_package_json_cache;
    cache
        .get_with_path(log, pkg_json_path.slice(), options)
        .unwrap()
        .ok()
}

/// Current pnpm records only the patch hash in the lockfile; the patch file path lives in the config.
fn read_config_patch_paths(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
) -> Result<StringMap, AllocError> {
    let mut paths = StringMap::new();
    if let Some(patched) = root_package_json(manager, log)
        .and_then(|pkg_json| pkg_json.root.get(b"pnpm"))
        .and_then(|pnpm| pnpm.get(b"patchedDependencies"))
    {
        collect_strings(&patched, &mut paths)?;
    }
    collect_workspace_yaml_strings(log, b"patchedDependencies", &mut paths)?;
    Ok(paths)
}

/// pnpm 11's built-in named registries; `namedRegistries` in pnpm-workspace.yaml overrides them.
const BUILTIN_NAMED_REGISTRIES: [(&[u8], &[u8]); 2] = [
    (b"gh", b"https://npm.pkg.github.com/"),
    (b"npmjs", b"https://registry.npmjs.org/"),
];

fn read_named_registries(log: &mut bun_ast::Log) -> Result<StringMap, AllocError> {
    let mut declared = StringMap::new();
    collect_workspace_yaml_strings(log, b"namedRegistries", &mut declared)?;
    let mut registries = StringMap::new();
    for (name, url) in declared.iter() {
        // Stored without its credentials, because this URL is recorded in bun.lock as the base of
        // tarball URLs.
        registries.put(name, crate::bun_schema::api::NpmRegistry::from_url(url).url)?;
    }
    for (name, url) in BUILTIN_NAMED_REGISTRIES {
        if !registries.contains(name) {
            registries.put(name, Box::from(url))?;
        }
    }
    Ok(registries)
}

/// `work:1.0.0` -> `1.0.0` for pnpm's registry-qualified dep paths (pnpm11/deps/path parseRegistryQualifiedVersion).
fn split_registry_qualified_version(res_str: &[u8]) -> Option<(&[u8], &[u8])> {
    let (registry, version) = strings::split_once_char(res_str, b':')?;
    if registry.is_empty()
        || !registry[0].is_ascii_alphabetic()
        || !registry
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-'))
        || !version.first().is_some_and(u8::is_ascii_digit)
        || matches!(
            registry,
            b"file" | b"link" | b"npm" | b"runtime" | b"workspace" | b"catalog" | b"git"
        )
    {
        return None;
    }
    Some((registry, version))
}

fn resolution_from_package_entry(
    res_str: &[u8],
    resolution_expr: Option<&Expr>,
    string_buf: &mut semver::string::Buf<'_>,
) -> Result<Resolution, MigratePnpmLockfileError> {
    let tarball = resolution_expr.and_then(|obj| get_str(obj, b"tarball"));

    if let Some(obj) = resolution_expr {
        let ty = get_str(obj, b"type").unwrap_or_default();

        // `path:` is pnpm's `repo#commit&path:sub/dir` on git and git-hosted tarball resolutions.
        if get_str(obj, b"path").is_some() {
            return Err(MigratePnpmLockfileError::PnpmLockfileGitSubdirectory);
        }

        if ty == b"git"
            && let Some(repo) = get_str(obj, b"repo")
        {
            let commit = string_buf.append(get_str(obj, b"commit").unwrap_or_default())?;
            return Ok(Resolution::init(TaggedValue::Git(Repository {
                repo: string_buf.append(strings::without_prefix(repo, b"git+"))?,
                committish: commit,
                // `resolved` is the commit that gets checked out, and it names the cache folder.
                resolved: commit,
                ..Default::default()
            })));
        }

        if ty == b"directory"
            && let Some(dir) = get_str(obj, b"directory")
        {
            return Ok(Resolution::init(TaggedValue::Folder(
                string_buf.append(dir)?,
            )));
        }

        if let Some(path) = tarball.and_then(|url| url.strip_prefix(b"file:")) {
            return Ok(Resolution::init(TaggedValue::LocalTarball(
                string_buf.append(path)?,
            )));
        }
    }

    // Registry packages: the caller decides whether a recorded `tarball:` is trusted.
    if res_str.first().is_some_and(u8::is_ascii_digit) {
        return Ok(Resolution::from_pnpm_lockfile(res_str, string_buf)?);
    }

    if let Some(url) = tarball {
        if url.starts_with(b"https://codeload.github.com/") {
            return Ok(Resolution::from_pnpm_lockfile(url, string_buf)?);
        }
        return Ok(Resolution::init(TaggedValue::RemoteTarball(
            string_buf.append(url)?,
        )));
    }

    if let Some(path) = res_str.strip_prefix(b"file:")
        && Dependency::is_tarball(path)
    {
        return Ok(Resolution::init(TaggedValue::LocalTarball(
            string_buf.append(path)?,
        )));
    }

    Ok(Resolution::from_pnpm_lockfile(res_str, string_buf)?)
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum MigratePnpmLockfileError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("PnpmLockfileTooOld")]
    PnpmLockfileTooOld,
    #[error("InvalidPnpmLockfile")]
    InvalidPnpmLockfile,
    #[error("YamlParseError")]
    YamlParseError,
    #[error("NonExistentWorkspaceDependency")]
    NonExistentWorkspaceDependency,
    #[error("PnpmLockfileGitSubdirectory")]
    PnpmLockfileGitSubdirectory,
}

bun_core::oom_from_alloc!(MigratePnpmLockfileError);

impl From<crate::Error> for MigratePnpmLockfileError {
    fn from(e: crate::Error) -> Self {
        match e {
            crate::Error::Alloc(bun_alloc::AllocError) => Self::OutOfMemory,
            _ => Self::InvalidPnpmLockfile,
        }
    }
}

impl From<crate::lockfile_real::tree::SubtreeError> for MigratePnpmLockfileError {
    fn from(e: crate::lockfile_real::tree::SubtreeError) -> Self {
        use crate::lockfile_real::tree::SubtreeError as E;
        match e {
            E::OutOfMemory => Self::OutOfMemory,
        }
    }
}

impl From<resolution::FromPnpmLockfileError> for MigratePnpmLockfileError {
    fn from(e: resolution::FromPnpmLockfileError) -> Self {
        match e {
            resolution::FromPnpmLockfileError::OutOfMemory => Self::OutOfMemory,
            resolution::FromPnpmLockfileError::InvalidPnpmLockfile => Self::InvalidPnpmLockfile,
        }
    }
}

impl From<crate::lockfile_real::catalog_map::FromPnpmLockfileError> for MigratePnpmLockfileError {
    fn from(e: crate::lockfile_real::catalog_map::FromPnpmLockfileError) -> Self {
        use crate::lockfile_real::catalog_map::FromPnpmLockfileError as E;
        match e {
            E::OutOfMemory => Self::OutOfMemory,
            E::InvalidPnpmLockfile => Self::InvalidPnpmLockfile,
        }
    }
}

pub(crate) fn e_object_mut(expr: &mut Expr) -> &mut E::Object {
    match &mut expr.data {
        ExprData::EObject(o) => &mut **o,
        _ => unreachable!("e_object_mut called on non-object"),
    }
}

/// The package.json of the importer at `path`, relative to the project.
fn importer_package_json(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    path: &[u8],
) -> Result<Expr, MigratePnpmLockfileError> {
    let json_path = join_top_level_dir(&[path, b"package.json"]).ok_or(InvalidPnpmLockfile)?;
    let cache = &mut manager.workspace_package_json_cache;
    match cache.get_with_path(log, json_path.slice(), Default::default()) {
        crate::GetJsonResult::Entry(entry) => Ok(entry.root),
        _ => Err(InvalidPnpmLockfile),
    }
}

pub(crate) fn migrate_pnpm_lockfile(
    lockfile: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
) -> Result<LoadResult, MigratePnpmLockfileError> {
    lockfile.init_empty();
    crate::initialize_store();
    bun_core::analytics::Features::pnpm_migration_inc(1);

    // The nodes are allocated in `yaml_arena`, because later package.json reads reset the
    // thread-local `Store`.
    let yaml_source = bun_ast::Source::init_path_string(b"pnpm-lock.yaml", data);
    let yaml_arena = bun_alloc::Arena::new();
    let mut yaml_allocator = bun_ast::ASTMemoryAllocator::borrowing(&yaml_arena);
    let parsed = {
        let _scope = yaml_allocator.enter();
        bun_parsers::yaml::YAML::parse(
            &yaml_source,
            log,
            &yaml_arena,
            bun_parsers::yaml::CyclicAliases::Reject,
        )
    };
    let Ok(mut root) = parsed else {
        return Err(MigratePnpmLockfileError::YamlParseError);
    };

    // pnpm 11 writes `---<env lockfile>---<lockfile>`; the last document is the lockfile.
    if let Some(mut documents) = root.as_array() {
        while let Some(document) = documents.next() {
            root = document;
        }
    }

    if !root.is_object() {
        bail!(
            log,
            "pnpm-lock.yaml root must be an object, got {}",
            root.data.tag_name()
        );
    }

    let Some(lockfile_version_expr) = root.get(b"lockfileVersion") else {
        bail!(log, "pnpm-lock.yaml missing 'lockfileVersion' field");
    };
    let lockfile_version_num: Option<f64> = match &lockfile_version_expr.data {
        ExprData::ENumber(num) if num.value() < 0.0 => None,
        ExprData::ENumber(num) => Some(num.value()),
        ExprData::EString(version_str) => {
            let str = version_str.data.slice();
            let major = strings::split_once_char(str, b'.').map_or(str, |(major, _)| major);
            bun_core::fmt::parse_f64(major)
        }
        _ => None,
    };
    let Some(lockfile_version_num) = lockfile_version_num else {
        bail!(
            log,
            "pnpm-lock.yaml 'lockfileVersion' must be a number or string, got {}",
            lockfile_version_expr.data.tag_name()
        );
    };

    if lockfile_version_num < 7.0 {
        return Err(MigratePnpmLockfileError::PnpmLockfileTooOld);
    }

    let silent = manager.options.log_level.is_silent();

    if lockfile_version_num >= 10.0 && !silent {
        bun_core::warn!(
            "pnpm-lock.yaml is lockfileVersion {}; migrating it as 9.0",
            lockfile_version_num
        );
    }

    let exclude_links = root
        .get(b"settings")
        .and_then(|settings| settings.get(b"excludeLinksFromLockfile"))
        .and_then(|e| e.as_bool())
        == Some(true);

    let mut found_patches = FoundPatches::new();
    let mut snapshot_dep_paths = SnapshotDepPaths::new();
    let mut packages_with_unbound_peers: bun_collections::HashMap<PackageID, ()> =
        bun_collections::HashMap::new();
    let mut named_registries: Option<StringMap> = None;
    let mut warned_registries: StringArrayHashMap<()> = StringArrayHashMap::new();

    if let Some(mut catalogs_expr) = root.get_object(b"catalogs") {
        crate::lockfile_real::CatalogMap::from_pnpm_lockfile(
            &mut lockfile.catalogs,
            log,
            e_object_mut(&mut catalogs_expr),
            &mut sbuf!(lockfile),
        )?;
    }

    for (key, value) in props(&root.get(b"overrides").unwrap_or_default()) {
        let name_str = as_str(key).ok_or(InvalidPnpmLockfile)?;
        let Some(version_str) = as_str(value) else {
            bail!(
                log,
                "pnpm-lock.yaml override '{}' must be a string",
                escape_control_chars(name_str)
            );
        };

        // OverrideMap warns about unsupported rules when it parses the migrated package.json.
        if version_str == b"-" {
            continue;
        }
        let Ok(sel) = crate::lockfile_real::override_selector::parse_selector(name_str) else {
            continue;
        };

        let ok = crate::lockfile_real::OverrideMap::put_lockfile_rule(
            &mut lockfile.overrides,
            sel.parent,
            sel.target,
            version_str,
            &mut sbuf!(lockfile),
            log,
        )?;
        if !ok {
            bail!(
                log,
                "pnpm-lock.yaml override '{}' has an invalid value '{}'",
                escape_control_chars(name_str),
                for_terminal(BStr::new(version_str))
            );
        }
    }

    struct Patch {
        path: String,
        config_key: Box<[u8]>,
    }
    // patch hash -> every configured patchedDependencies key using that patch file
    let mut patches: StringArrayHashMap<Vec<Patch>> = StringArrayHashMap::new();
    let mut config_patch_paths: Option<StringMap> = None;

    for (key, value) in props(&root.get(b"patchedDependencies").unwrap_or_default()) {
        let key_str = as_str(key).ok_or(InvalidPnpmLockfile)?;

        let (hash_str, path_str, config_key) = if let Some(hash_str) = as_str(value) {
            if config_patch_paths.is_none() {
                config_patch_paths = Some(read_config_patch_paths(manager, log)?);
            }
            let config = config_patch_paths.as_ref().expect("set above");
            let found = config.get(key_str).map(|path| (path, key_str)).or_else(|| {
                let bare = Dependency::split_name_and_maybe_version(key_str).0;
                config.get(bare).map(|path| (path, bare))
            });
            let Some((path, config_key)) = found else {
                if !silent {
                    bun_core::warn!(
                        "skipping patch \"{}\" from pnpm-lock.yaml: not in patchedDependencies of package.json or pnpm-workspace.yaml",
                        for_terminal(BStr::new(key_str))
                    );
                }
                continue;
            };
            (hash_str, &**path, config_key)
        } else {
            let path_str = get_str(value, b"path").ok_or(InvalidPnpmLockfile)?;
            let hash_str = get_str(value, b"hash").ok_or(InvalidPnpmLockfile)?;
            (hash_str, path_str, key_str)
        };

        let path = sbuf!(lockfile).append(path_str)?;
        patches.get_or_put(hash_str)?.value_ptr.push(Patch {
            path,
            config_key: Box::from(config_key),
        });
    }

    let Some(importers_obj) = root.get_object(b"importers") else {
        bail!(log, "pnpm-lock.yaml missing 'importers' field");
    };

    let mut has_root_pkg_expr: Option<Expr> = None;

    for (key, value) in props(&importers_obj) {
        let importer_path = as_str(key).ok_or(InvalidPnpmLockfile)?;

        if importer_path == b"." {
            if has_root_pkg_expr.is_some() {
                return Err(InvalidPnpmLockfile);
            }
            has_root_pkg_expr = Some(*value);
            continue;
        }

        let pkg_json_path = join_top_level_dir(&[importer_path, b"package.json"]);
        let importer_pkg_json = match match &pkg_json_path {
            Some(path) => manager.workspace_package_json_cache.get_with_path(
                log,
                path.slice(),
                Default::default(),
            ),
            None => crate::GetJsonResult::ReadErr(crate::Error::Sys(
                bun_errno::SystemErrno::ENAMETOOLONG,
            )),
        } {
            crate::GetJsonResult::Entry(j) => j,
            crate::GetJsonResult::ReadErr(_) => {
                bail!(
                    log,
                    "pnpm-lock.yaml lists importer '{}' but '{}/package.json' does not exist",
                    escape_control_chars(importer_path),
                    escape_control_chars(importer_path)
                );
            }
            crate::GetJsonResult::ParseErr(_) => return Err(InvalidPnpmLockfile),
        };
        let workspace_root = &importer_pkg_json.root;

        // Nameless importers are skipped like `WorkspaceMap::process_workspace_name` skips them.
        if let Some(name) = get_str(workspace_root, b"name").filter(|name| !name.is_empty()) {
            let version = get_str(workspace_root, b"version");
            record_workspace(lockfile, name, importer_path, version)?;
        }
    }

    let Some(root_pkg_expr) = has_root_pkg_expr else {
        bail!(
            log,
            "pnpm-lock.yaml missing root package entry (importers['.'])"
        );
    };

    let mut importer_dep_res_versions: StringArrayHashMap<StringMap> = StringArrayHashMap::new();

    {
        let root_manifest = importer_package_json(manager, log, b".")?;
        let mut root_pkg = lockfile::Package::default();

        if let Some(name) = get_str(&root_manifest, b"name") {
            root_pkg.name_hash = string_hash(name);
            root_pkg.name = sbuf!(lockfile).append_with_hash(name, root_pkg.name_hash)?;
        }

        let importer_versions = importer_dep_res_versions.get_or_put(b".")?;
        *importer_versions.value_ptr = StringArrayHashMap::new();

        parse_append_importer_dependencies(
            lockfile,
            manager,
            &mut root_pkg,
            &root_pkg_expr,
            &root_manifest,
            b".",
            exclude_links,
            log,
            importer_versions.value_ptr,
        )?;

        root_pkg.meta.id = 0;
        root_pkg.resolution = Resolution::init_root();
        let root_name_hash = root_pkg.name_hash;
        lockfile.packages.append(root_pkg)?;
        lockfile.get_or_put_id(0, root_name_hash)?;
    }

    let mut pkg_map: StringArrayHashMap<PackageID> = StringArrayHashMap::new();

    pkg_map.put(crate::bun_fs::FileSystem::get().top_level_dir(), 0)?;

    for workspace_path in lockfile.workspace_paths.values().to_vec() {
        // Every workspace path is the key of an importer with a named package.json.
        let found = props(&importers_obj)
            .filter_map(|(key, value)| Some((as_str(key)?, value)))
            .find(|(path, _)| *path == workspace_path.slice(string_bytes!(lockfile)));
        let Some((path, value)) = found else {
            continue;
        };

        let abs_path = join_top_level_dir(&[path]).ok_or(InvalidPnpmLockfile)?;
        let workspace_root = importer_package_json(manager, log, path)?;
        let name = get_str(&workspace_root, b"name").unwrap();
        let name_hash = string_hash(name);
        let mut pkg = lockfile::Package {
            resolution: Resolution::init(TaggedValue::Workspace(sbuf!(lockfile).append(path)?)),
            name: sbuf!(lockfile).append_with_hash(name, name_hash)?,
            name_hash,
            ..Default::default()
        };

        let importer_versions = importer_dep_res_versions.get_or_put(path)?;
        if importer_versions.found_existing {
            return Err(InvalidPnpmLockfile);
        }
        *importer_versions.value_ptr = StringArrayHashMap::new();

        parse_append_importer_dependencies(
            lockfile,
            manager,
            &mut pkg,
            value,
            &workspace_root,
            path,
            exclude_links,
            log,
            importer_versions.value_ptr,
        )?;
        parse_manifest_bin(lockfile, &mut pkg, &workspace_root)?;

        let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;

        let entry = pkg_map.get_or_put(abs_path.slice())?;
        if entry.found_existing {
            return Err(InvalidPnpmLockfile);
        }
        *entry.value_ptr = pkg_id;
    }

    let workspace_pkgs_end = lockfile.packages.len();

    // add packages for symlink dependencies. pnpm-lock has no packages/snapshots entry for them
    for pkg_id in 0..workspace_pkgs_end {
        let workspace_path = importer_path(lockfile, pkg_id);
        let workspace_path: &[u8] = &workspace_path;

        let importer_versions = importer_dep_res_versions
            .get(workspace_path)
            .ok_or(InvalidPnpmLockfile)?;

        let deps = lockfile.packages.items_dependencies()[pkg_id];
        'next_dep: for dep_id in deps.begin()..deps.end() {
            let dep = lockfile.buffers.dependencies[dep_id as usize].clone();

            if dep.behavior.is_workspace()
                || !matches!(
                    dep.version.tag,
                    VersionTag::Folder | VersionTag::Workspace | VersionTag::Symlink
                )
                || (dep.version.tag == VersionTag::Symlink
                    && !dependency::is_link_path(
                        dep.version.symlink().slice(string_bytes!(lockfile)),
                    ))
            {
                continue;
            }
            let Some(version_str) = importer_versions.get(dep.name.slice(string_bytes!(lockfile)))
            else {
                if dep.behavior.is_peer() {
                    continue;
                }
                return Err(InvalidPnpmLockfile);
            };
            let Some(link_path) = remove_suffix(version_str).strip_prefix(b"link:") else {
                continue;
            };

            // create a link package for the workspace dependency only if it doesn't already exist
            if dep.version.tag == VersionTag::Workspace {
                // A link that does not fit a path buffer names no workspace.
                let link_path_buf = join_top_level_dir(&[workspace_path, link_path])
                    .ok_or(MigratePnpmLockfileError::NonExistentWorkspaceDependency)?;

                for existing_workspace_path in lockfile.workspace_paths.values() {
                    if join_top_level_dir(&[existing_workspace_path.slice(string_bytes!(lockfile))])
                        .is_some_and(|existing| existing.slice() == link_path_buf.slice())
                    {
                        continue 'next_dep;
                    }
                }

                return Err(MigratePnpmLockfileError::NonExistentWorkspaceDependency);
            }

            // pnpm's value is relative to the importer, the stored one to the project.
            let mut folder_buf = bun_paths::path_buffer_pool::get();
            let (Some(abs_link_path), Some(folder)) = (
                join_top_level_dir(&[workspace_path, link_path]),
                lockfile::package::folder_relative_to_top_level_dir(
                    workspace_path,
                    link_path,
                    &mut folder_buf[..],
                ),
            ) else {
                bail!(
                    log,
                    "pnpm-lock.yaml dependency '{}' of importer '{}': link path too long",
                    escape_control_chars(dep.name.slice(string_bytes!(lockfile))),
                    escape_control_chars(workspace_path)
                );
            };

            let pkg_entry = pkg_map.get_or_put(abs_link_path.slice())?;
            if pkg_entry.found_existing {
                // they point to the same package
                continue;
            }

            let mut pkg = lockfile::Package {
                name: dep.name,
                name_hash: dep.name_hash,
                resolution: Resolution::init_symlink(
                    sbuf!(lockfile).append(&dependency::link_path_for_lockfile(folder))?,
                ),
                ..Default::default()
            };
            *pkg_entry.value_ptr = lockfile.append_package_dedupe(&mut pkg)?;
        }
    }

    let packages_obj = root.get_object(b"packages");
    let snapshots_obj = root.get_object(b"snapshots");

    if packages_obj.is_some() && snapshots_obj.is_none() {
        bail!(
            log,
            "pnpm-lock.yaml has 'packages' but missing 'snapshots' field"
        );
    }

    let mut packages_by_key: StringArrayHashMap<Expr> = StringArrayHashMap::new();

    for (key, package_obj) in props(&packages_obj.unwrap_or_default()) {
        let key_str = as_str(key).ok_or(InvalidPnpmLockfile)?;
        if !package_obj.is_object() {
            return Err(InvalidPnpmLockfile);
        }

        // Pruned lockfiles (`turbo prune`) can leave peer-suffixed keys in `packages:`.
        let entry = packages_by_key.get_or_put(remove_suffix(key_str))?;
        if !entry.found_existing {
            *entry.value_ptr = *package_obj;
        }
    }

    for (key, snapshot_obj) in props(&snapshots_obj.unwrap_or_default()) {
        let key_str = as_str(key).ok_or(InvalidPnpmLockfile)?;
        if !snapshot_obj.is_object() {
            return Err(InvalidPnpmLockfile);
        }

        let (peer_hash_idx, patch_hash_idx) = index_of_dep_path_suffix(key_str);

        let patch_hash = match patch_hash_idx {
            Some(idx) => {
                let patch_hash_str = &key_str[idx + b"(patch_hash=".len()..];
                let (hash, _) =
                    strings::split_once_char(patch_hash_str, b')').ok_or(InvalidPnpmLockfile)?;
                Some(hash)
            }
            None => None,
        };

        let key_str = match patch_hash_idx.or(peer_hash_idx) {
            Some(idx) => &key_str[0..idx],
            None => key_str,
        };

        if let Some(&existing_id) = pkg_map.get(key_str) {
            if packages_with_unbound_peers.contains(&existing_id)
                && bind_peers_from_variant(
                    lockfile,
                    existing_id,
                    snapshot_obj,
                    &mut snapshot_dep_paths,
                )?
            {
                packages_with_unbound_peers.remove(&existing_id);
            }
            continue;
        }

        let Ok((name_str, res_str)) = dependency::split_name_and_version(key_str) else {
            return Err(InvalidPnpmLockfile);
        };

        if res_str.starts_with(b"runtime:") {
            continue;
        }

        let package_obj: Expr = match packages_by_key.get(key_str) {
            Some(obj) => *obj,
            // Like pnpm, only a `file:` directory is rebuilt when its `packages:` entry was pruned.
            None if res_str
                .strip_prefix(b"file:")
                .is_some_and(|dir| !Dependency::is_tarball(dir)) =>
            {
                Expr::EMPTY
            }
            None => continue,
        };

        let (res_str, registry_name) = match split_registry_qualified_version(res_str) {
            Some((registry, version)) => (version, Some(registry)),
            None => (res_str, None),
        };

        let resolution_expr: Option<Expr> = package_obj.get(b"resolution");
        if resolution_expr.is_some_and(|r| !r.is_object()) {
            return Err(InvalidPnpmLockfile);
        }

        let mut res = match resolution_from_package_entry(
            res_str,
            resolution_expr.as_ref(),
            &mut sbuf!(lockfile),
        ) {
            Ok(res) => res,
            Err(InvalidPnpmLockfile) => {
                bail!(
                    log,
                    "pnpm-lock.yaml package '{}' has an unsupported resolution",
                    for_terminal(BStr::new(key_str))
                );
            }
            Err(MigratePnpmLockfileError::PnpmLockfileGitSubdirectory) => {
                bail!(
                    log,
                    "pnpm-lock.yaml package '{}' is a git sub-directory dependency (resolution.path), which bun does not support",
                    for_terminal(BStr::new(key_str))
                );
            }
            Err(err) => return Err(err),
        };

        // pnpm records injected workspace packages as `name@file:<workspace dir>`.
        if res.tag == resolution::Tag::Folder {
            let Some(folder_path) =
                join_top_level_dir(&[res.folder().slice(string_bytes!(lockfile))])
            else {
                bail!(
                    log,
                    "pnpm-lock.yaml package '{}': directory path too long",
                    escape_control_chars(name_str)
                );
            };
            if let Some(workspace_pkg_id) = pkg_map
                .get(folder_path.slice())
                .copied()
                .filter(|id| (*id as usize) < workspace_pkgs_end)
            {
                pkg_map.put(key_str, workspace_pkg_id)?;
                continue;
            }
        }

        let name_hash = string_hash(name_str);
        let name = sbuf!(lockfile).append_with_hash(name_str, name_hash)?;

        if let Some(patch) = patch_hash
            .and_then(|hash| patches.get(hash))
            .and_then(|patch_list| {
                patch_list.iter().find(|patch| {
                    Dependency::split_name_and_maybe_version(&patch.config_key).0 == name_str
                })
            })
        {
            let resolved = res
                .fmt(string_bytes!(lockfile), bun_core::fmt::PathSep::Posix)
                .to_string();
            let key = [name_str, b"@", resolved.as_bytes()].concat();
            lockfile.patched_dependencies.put(
                string_hash(&key),
                crate::lockfile_real::PatchedDep::with_path(patch.path),
            )?;
            let found = found_patches.get_or_put(&patch.config_key)?;
            found.value_ptr.push(key.into_boxed_slice());
        }

        if res.tag == resolution::Tag::Npm {
            let scope_registry: &[u8] = manager.scope_for_package_name(name_str).url.href();
            let registry: &[u8] = match registry_name {
                None => scope_registry,
                Some(registry_name) => {
                    if named_registries.is_none() {
                        named_registries = Some(read_named_registries(log)?);
                    }
                    let named = named_registries.as_ref().expect("set above");
                    let url = named.get(registry_name).map(|url| &**url);
                    let is_scope_registry = url.is_some_and(|url| {
                        lockfile::bun_lock::url_is_under_registry(url, scope_registry)
                            && lockfile::bun_lock::url_is_under_registry(scope_registry, url)
                    });
                    if !is_scope_registry
                        && !warned_registries.get_or_put(registry_name)?.found_existing
                        && !silent
                    {
                        match url {
                            Some(url) => bun_core::warn!(
                                "fetching pnpm registry \"{}\" packages from {}; add it to bunfig.toml or .npmrc if it needs authentication",
                                escape_control_chars(registry_name),
                                for_terminal(BStr::new(url))
                            ),
                            None => bun_core::warn!(
                                "skipping pnpm registry \"{}\" from pnpm-lock.yaml: not in namedRegistries of pnpm-workspace.yaml (resolving its packages from the configured registry)",
                                escape_control_chars(registry_name)
                            ),
                        }
                    }
                    url.filter(|_| !is_scope_registry).unwrap_or(scope_registry)
                }
            };
            // Registries like GitHub Packages serve tarballs off the canonical `/-/` path.
            let recorded = resolution_expr
                .as_ref()
                .and_then(|r| get_str(r, b"tarball"))
                .filter(|url| lockfile::bun_lock::url_is_under_registry(url, registry));
            res.npm_mut().url = match recorded {
                Some(url) => sbuf!(lockfile).append(url)?,
                None => {
                    let url = crate::extract_tarball::build_url(
                        registry,
                        &strings::StringOrTinyString::init(name.slice(string_bytes!(lockfile))),
                        res.npm().version,
                        string_bytes!(lockfile),
                    )?;
                    sbuf!(lockfile).append(url)?
                }
            };
        }

        let mut pkg = lockfile::Package {
            name,
            name_hash,
            ..Default::default()
        };

        if let Some(integrity_expr) = resolution_expr.as_ref().and_then(|r| r.get(b"integrity")) {
            let integrity_str = as_str(&integrity_expr).ok_or(InvalidPnpmLockfile)?;
            pkg.meta.integrity = Integrity::parse(integrity_str);
        }

        if let Some(os_expr) = package_obj.get(b"os") {
            pkg.meta.os = npm::negatable_from_json::<npm::OperatingSystem>(&os_expr)?;
        }
        if let Some(cpu_expr) = package_obj.get(b"cpu") {
            pkg.meta.arch = npm::negatable_from_json::<npm::Architecture>(&cpu_expr)?;
        }
        if let Some(libc_expr) = package_obj.get(b"libc") {
            pkg.meta.libc = npm::negatable_from_json::<npm::Libc>(&libc_expr)?;
        }

        let has_unbound_peers = parse_append_package_dependencies(
            lockfile,
            &mut pkg,
            &package_obj,
            snapshot_obj,
            log,
            &mut snapshot_dep_paths,
        )?;
        pkg.resolution = res.copy();

        let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;
        if has_unbound_peers {
            packages_with_unbound_peers.put(pkg_id, ())?;
        }

        pkg_map.put(key_str, pkg_id)?;
    }

    let mut res_buf: Vec<u8> = Vec::new();

    let dep_len = lockfile.buffers.dependencies.len();
    lockfile
        .buffers
        .resolutions
        .resize(dep_len, INVALID_PACKAGE_ID);

    // the root's dependencies first, then the workspaces'
    for pkg_id in 0..workspace_pkgs_end {
        let workspace_path = importer_path(lockfile, pkg_id);
        let workspace_path: &[u8] = &workspace_path;
        let importer_versions = importer_dep_res_versions
            .get(workspace_path)
            .ok_or(InvalidPnpmLockfile)?;

        let deps = lockfile.packages.items_dependencies()[pkg_id];
        let mut unlocked_peers: Vec<usize> = Vec::new();
        for dep_id in deps.begin()..deps.end() {
            let dep = lockfile.buffers.dependencies[dep_id as usize].clone();
            let string_buf = string_bytes!(lockfile);

            // implicit workspace dependencies
            if dep.behavior.is_workspace() {
                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                // bounded input
                let _ = path_buf.join(&[dep.version.workspace().slice(string_buf)]);
                if let Some(workspace_pkg_id) = pkg_map.get(path_buf.slice()) {
                    lockfile.buffers.resolutions[dep_id as usize] = *workspace_pkg_id;
                    continue;
                }
            }

            let dep_name = dep.name.slice(string_buf);
            if let Some(peer_pkg_id) = resolve_peer_like_bun_lock(lockfile, &dep) {
                lockfile.buffers.resolutions[dep_id as usize] = peer_pkg_id;
                continue;
            }
            let Some(version_maybe_alias) = importer_versions.get(dep_name) else {
                if dep.behavior.is_peer() {
                    // `--frozen-lockfile` must not resolve anything that pnpm-lock.yaml left out.
                    if !dep.behavior.is_optional_peer()
                        && !manager.options.enable.frozen_lockfile()
                        && lockfile.packages_named(dep.name_hash).is_empty()
                    {
                        unlocked_peers.push(dep_id as usize);
                    }
                    continue;
                }
                if pkg_id == 0 {
                    bail!(
                        log,
                        "pnpm-lock.yaml cannot resolve root dependency '{}' - missing version in importer",
                        escape_control_chars(dep_name)
                    );
                }
                bail!(
                    log,
                    "pnpm-lock.yaml cannot resolve workspace dependency '{}' in '{}' - missing version",
                    escape_control_chars(dep_name),
                    escape_control_chars(workspace_path)
                );
            };
            let reference = remove_suffix(strings::without_prefix(version_maybe_alias, b"npm:"));

            if let Some(link_pkg_id) = reference
                .strip_prefix(b"link:")
                .and_then(|link_path| join_top_level_dir(&[workspace_path, link_path]))
                .and_then(|path| pkg_map.get(path.slice()))
            {
                lockfile.buffers.resolutions[dep_id as usize] = *link_pkg_id;
                continue;
            }

            write_pnpm_dep_path(&mut res_buf, dep_name, reference);

            let Some(res_pkg_id) = pkg_map.get(&res_buf) else {
                return Err(missing_package_entry(
                    log,
                    &res_buf,
                    dep_name,
                    format_args!("importer '{}'", escape_control_chars(workspace_path)),
                ));
            };

            lockfile.buffers.resolutions[dep_id as usize] = *res_pkg_id;
        }

        // Drop these peers from the lockfile so that `bun install` resolves them, the same way it
        // resolves dependencies that were added to package.json after pnpm-lock.yaml was written.
        for &row in unlocked_peers.iter().rev() {
            lockfile.buffers.dependencies[row..deps.end() as usize].rotate_left(1);
            lockfile.buffers.resolutions[row..deps.end() as usize].rotate_left(1);
        }
        let len = deps.len - unlocked_peers.len() as u32;
        lockfile.packages.items_dependencies_mut()[pkg_id].len = len;
        lockfile.packages.items_resolutions_mut()[pkg_id].len = len;
    }

    for pkg_id in workspace_pkgs_end..lockfile.packages.len() {
        let deps = lockfile.packages.items_dependencies()[pkg_id];
        for dep_id in deps.begin()..deps.end() {
            let dep = lockfile.buffers.dependencies[dep_id as usize].clone();
            let string_buf = string_bytes!(lockfile);
            let dep_name = dep.name.slice(string_buf);
            if let Some(peer_pkg_id) = resolve_peer_like_bun_lock(lockfile, &dep) {
                lockfile.buffers.resolutions[dep_id as usize] = peer_pkg_id;
                continue;
            }
            let literal = dep.version.literal.slice(string_buf);
            let reference = remove_suffix(strings::without_prefix(literal, b"npm:"));

            if let Some(snapshot_reference) = snapshot_dep_paths.get(&dep_id) {
                write_pnpm_dep_path(&mut res_buf, dep_name, snapshot_reference);
            } else if dep.behavior.is_peer() {
                continue;
            } else {
                if matches!(
                    dep.version.tag,
                    VersionTag::Folder | VersionTag::Symlink | VersionTag::Workspace
                ) && let Some(link_pkg_id) =
                    join_top_level_dir(&[strings::without_prefix(reference, b"link:")])
                        .and_then(|path| pkg_map.get(path.slice()))
                {
                    lockfile.buffers.resolutions[dep_id as usize] = *link_pkg_id;
                    continue;
                }

                write_pnpm_dep_path(&mut res_buf, dep_name, reference);
            }

            let Some(res_pkg_id) = pkg_map.get(&res_buf) else {
                let pkg_name = lockfile.packages.items_name()[pkg_id].slice(string_buf);
                return Err(missing_package_entry(
                    log,
                    &res_buf,
                    dep_name,
                    format_args!("package '{}'", escape_control_chars(pkg_name)),
                ));
            };

            lockfile.buffers.resolutions[dep_id as usize] = *res_pkg_id;
        }
    }

    // pnpm records `os`/`cpu` for every `packages:` entry whose manifest
    // declares them, including `file:` folders, tarballs, and git packages.
    crate::migration::clear_non_registry_platform_constraints(lockfile);
    declare_folder_dependencies_relative_to_their_package(lockfile)?;

    lockfile.tag_workspace_links(manager.options.link_workspace_packages);
    lockfile.resolve(log)?;

    update_package_json_after_migration(Some(&mut *lockfile), manager, log, &found_patches)?;

    // Parse the `packageExtensions` that were just copied into package.json. Warnings are dropped
    // here because the install that follows reports them.
    if let Some(root) = root_package_json(manager, log) {
        let extensions = &mut lockfile.package_extensions;
        extensions.parse(&mut bun_ast::Log::init(), &root.source, &root.root);
    }
    lockfile.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration(
        manager, false, // update_os_cpu
        false, // fill_integrity
        None,
    )?;

    Ok(LoadResult::Ok(LoadResultOk {
        migrated: lockfile::Migrated::Pnpm,
        serializer_result: Default::default(),
        format: lockfile::Format::Text,
    }))
}

/// Returns `.` for the root, or else the workspace's path. Owned, because the callers change
/// `lockfile`.
fn importer_path(lockfile: &Lockfile, pkg_id: usize) -> Vec<u8> {
    if pkg_id == 0 {
        return b".".to_vec();
    }
    lockfile.packages.items_resolution()[pkg_id]
        .workspace()
        .slice(string_bytes!(lockfile))
        .to_vec()
}

/// dep -> pnpm reference whose dep-path cannot be rebuilt from the dep's literal (non-registry aliases and peer edges)
type SnapshotDepPaths = bun_collections::HashMap<DependencyID, Box<[u8]>>;

fn append_snapshot_dependency_version(
    lockfile: &mut Lockfile,
    reference: &[u8],
    references_by_name: &mut StringMap,
    dep_name: &[u8],
) -> Result<(String, Option<ExternalString>), AllocError> {
    if pnpm_reference_is_dep_path(reference) {
        if let Ok((alias_str, version_str)) = dependency::split_name_and_version(reference) {
            let registry_qualified = split_registry_qualified_version(version_str);
            if registry_qualified.is_none() && !version_str.first().is_some_and(u8::is_ascii_digit)
            {
                references_by_name.put(dep_name, Box::from(reference))?;
                return Ok((sbuf!(lockfile).append(version_str)?, None));
            }
            let alias = sbuf!(lockfile).append_external(alias_str)?;
            let version_str = match registry_qualified {
                Some((_, version)) => {
                    references_by_name.put(dep_name, Box::from(reference))?;
                    version
                }
                None => version_str,
            };
            let version = [b"npm:", alias_str, b"@", version_str].concat();
            return Ok((sbuf!(lockfile).append(&version)?, Some(alias)));
        }
    } else if let Some((_, version_str)) = split_registry_qualified_version(reference) {
        references_by_name.put(dep_name, Box::from(reference))?;
        return Ok((sbuf!(lockfile).append(version_str)?, None));
    }
    Ok((sbuf!(lockfile).append(reference)?, None))
}

struct PeerDecl {
    range: &'static [u8],
    optional: bool,
    seen: bool,
}

impl PeerDecl {
    fn new(range: &'static [u8], optional: bool) -> Self {
        Self {
            range,
            optional,
            seen: false,
        }
    }

    fn behavior(&self) -> Behavior {
        let mut behavior = Behavior::PEER;
        behavior.set_optional(self.optional);
        behavior
    }
}

/// With `strict` (for a `packages:` entry), anything malformed is an error. In a package.json it's
/// skipped.
fn declared_peers(
    obj: &Expr,
    strict: bool,
) -> Result<StringArrayHashMap<PeerDecl>, MigratePnpmLockfileError> {
    let mut peers: StringArrayHashMap<PeerDecl> = StringArrayHashMap::new();
    let declared = obj.get(b"peerDependencies");
    let meta = obj.get(b"peerDependenciesMeta");
    if strict && [declared, meta].iter().flatten().any(|e| !e.is_object()) {
        return Err(InvalidPnpmLockfile);
    }

    for (key, value) in props(&declared.unwrap_or_default()) {
        let (Some(name_str), Some(range)) = (as_str(key), as_str(value)) else {
            if strict {
                return Err(InvalidPnpmLockfile);
            }
            continue;
        };
        peers.put(name_str, PeerDecl::new(range, false))?;
    }

    for (key, value) in props(&meta.unwrap_or_default()) {
        let Some(name_str) = as_str(key) else {
            if strict {
                return Err(InvalidPnpmLockfile);
            }
            continue;
        };
        if value.get(b"optional").and_then(|e| e.as_bool()) != Some(true) {
            continue;
        }
        match peers.get_mut(name_str) {
            Some(decl) => decl.optional = true,
            None => peers.put(name_str, PeerDecl::new(b"*", true))?,
        }
    }

    Ok(peers)
}

/// pnpm records a folder package's `file:` dependencies relative to the lockfile instead.
fn declare_folder_dependencies_relative_to_their_package(
    lockfile: &mut Lockfile,
) -> Result<(), AllocError> {
    let mut literal: Vec<u8> = Vec::new();
    for pkg_id in 0..lockfile.packages.len() {
        let pkg_resolution = lockfile.packages.items_resolution()[pkg_id];
        if pkg_resolution.tag != resolution::Tag::Folder {
            continue;
        }
        let pkg_dir = *pkg_resolution.folder();
        let rows = lockfile.packages.items_dependencies()[pkg_id];

        for dep_id in rows.begin() as usize..rows.end() as usize {
            let dep = &lockfile.buffers.dependencies[dep_id];
            if dep.version.tag != VersionTag::Folder {
                continue;
            }
            let folder = *dep.version.folder();

            literal.clear();
            literal.extend_from_slice(b"file:");
            let relative = bun_paths::resolve_path::relative(
                pkg_dir.slice(string_bytes!(lockfile)),
                folder.slice(string_bytes!(lockfile)),
            );
            literal.extend_from_slice(if relative.is_empty() { b"." } else { relative });
            #[cfg(windows)]
            bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(
                &mut literal[b"file:".len()..],
            );

            let appended = sbuf!(lockfile).append(&literal)?;
            lockfile.buffers.dependencies[dep_id].version.literal = appended;
        }
    }
    Ok(())
}

/// Appends the dependency `name@spec`. Returns false if `spec` doesn't parse.
fn append_dependency(
    lockfile: &mut Lockfile,
    log: Option<&mut bun_ast::Log>,
    name_str: &[u8],
    spec: &[u8],
    behavior: Behavior,
) -> Result<bool, AllocError> {
    let name = sbuf!(lockfile).append_external_with_hash(name_str, string_hash(name_str))?;
    let spec = sbuf!(lockfile).append(spec)?;
    let sliced = spec.sliced(string_bytes!(lockfile));
    let Some(version) = Dependency::parse(name.value, name.hash, sliced.slice, &sliced, log, None)
    else {
        return Ok(false);
    };
    lockfile.buffers.dependencies.push(Dependency {
        name: name.value,
        name_hash: name.hash,
        behavior,
        version,
    });
    Ok(true)
}

/// Returns whether a declared peer has no resolution in this snapshot.
fn parse_append_package_dependencies(
    lockfile: &mut Lockfile,
    pkg: &mut lockfile::Package,
    package_obj: &Expr,
    snapshot_obj: &Expr,
    log: &mut bun_ast::Log,
    snapshot_dep_paths: &mut SnapshotDepPaths,
) -> Result<bool, MigratePnpmLockfileError> {
    let mut references_by_name = StringMap::new();
    let mut peers = declared_peers(package_obj, true)?;

    let off = lockfile.buffers.dependencies.len();

    // pnpm records resolved required peers under `dependencies` and resolved optional peers under `optionalDependencies`.
    for (group_name, group_behavior) in DEPENDENCY_GROUPS {
        let Some(deps) = snapshot_obj.get(group_name) else {
            continue;
        };
        if !deps.is_object() {
            return Err(InvalidPnpmLockfile);
        }

        for (key, value) in props(&deps) {
            let name_str = as_str(key).ok_or(InvalidPnpmLockfile)?;
            let name =
                sbuf!(lockfile).append_external_with_hash(name_str, string_hash(name_str))?;
            let reference = remove_suffix(as_str(value).ok_or(InvalidPnpmLockfile)?);

            let mut behavior = group_behavior;
            if let Some(decl) = peers.get_mut(name_str).filter(|decl| !decl.seen) {
                decl.seen = true;
                if !reference.starts_with(b"link:") {
                    behavior = decl.behavior();
                    references_by_name.put(name_str, Box::from(reference))?;
                    if append_dependency(lockfile, None, name_str, decl.range, behavior)? {
                        continue;
                    }
                }
            }

            let (version, alias) = append_snapshot_dependency_version(
                lockfile,
                reference,
                &mut references_by_name,
                name_str,
            )?;
            let version_sliced = version.sliced(string_bytes!(lockfile));
            let alias = alias.unwrap_or(name);

            let version = Dependency::parse(
                alias.value,
                alias.hash,
                version_sliced.slice,
                &version_sliced,
                Some(&mut *log),
                None,
            )
            .ok_or(InvalidPnpmLockfile)?;
            lockfile.buffers.dependencies.push(Dependency {
                name: name.value,
                name_hash: name.hash,
                behavior,
                version,
            });
        }
    }

    let mut has_unbound_peers = false;
    for (peer_name, decl) in peers.iter().filter(|(_, decl)| !decl.seen) {
        has_unbound_peers |=
            append_dependency(lockfile, None, peer_name, decl.range, decl.behavior())?;
    }

    take_appended_dependencies(lockfile, pkg, off);

    if references_by_name.count() > 0 {
        let bytes = lockfile.buffers.string_bytes.as_slice();
        for (i, dep) in lockfile.buffers.dependencies[off..].iter().enumerate() {
            if let Some(reference) = references_by_name.get(dep.name.slice(bytes)) {
                let dep_id = u32::try_from(off + i).expect("int cast");
                snapshot_dep_paths.put(dep_id, reference.clone())?;
            }
        }
    }

    Ok(has_unbound_peers)
}

// pnpm sorts the peer-unmet variant (no suffix) first; later variants carry the resolutions it lacks.
fn bind_peers_from_variant(
    lockfile: &Lockfile,
    pkg_id: PackageID,
    snapshot_obj: &Expr,
    snapshot_dep_paths: &mut SnapshotDepPaths,
) -> Result<bool, AllocError> {
    let deps = lockfile.packages.items_dependencies()[pkg_id as usize];
    let groups = [
        snapshot_obj.get(b"dependencies"),
        snapshot_obj.get(b"optionalDependencies"),
    ];
    let mut all_bound = true;
    for dep_id in deps.begin()..deps.end() {
        let dep = &lockfile.buffers.dependencies[dep_id as usize];
        if !dep.behavior.is_peer() || snapshot_dep_paths.contains(&dep_id) {
            continue;
        }
        let name = dep.name.slice(string_bytes!(lockfile));
        let reference = groups
            .iter()
            .flatten()
            .find_map(|group| group.get(name))
            .and_then(|value| as_str(&value))
            .map(remove_suffix)
            .filter(|reference| !reference.starts_with(b"link:"));
        match reference {
            Some(reference) => snapshot_dep_paths.put(dep_id, Box::from(reference))?,
            None => all_bound = false,
        }
    }
    Ok(all_bound)
}

const DEPENDENCY_GROUPS: [(&[u8], Behavior); 3] = [
    (b"dependencies", Behavior::PROD),
    (b"devDependencies", Behavior::DEV),
    (b"optionalDependencies", Behavior::OPTIONAL),
];

struct ImporterName<'a>(&'a [u8]);

impl std::fmt::Display for ImporterName<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.0 == b"." {
            f.write_str("the root package")
        } else {
            write!(f, "workspace \"{}\"", escape_control_chars(self.0))
        }
    }
}

fn parse_append_importer_dependencies(
    lockfile: &mut Lockfile,
    manager: &mut PackageManager,
    pkg: &mut lockfile::Package,
    pkg_expr: &Expr,
    manifest: &Expr,
    importer_path: &[u8],
    exclude_links_from_lockfile: bool,
    log: &mut bun_ast::Log,
    importer_versions: &mut StringMap,
) -> Result<(), MigratePnpmLockfileError> {
    let manifest_peers = declared_peers(manifest, false)?;
    let silent = manager.options.log_level.is_silent();
    let verbose = manager.options.log_level.is_verbose();

    let off = lockfile.buffers.dependencies.len();

    for (group_name, group_behavior) in DEPENDENCY_GROUPS {
        let Some(deps) = pkg_expr.get(group_name) else {
            continue;
        };
        if !deps.is_object() {
            return Err(InvalidPnpmLockfile);
        }

        for (key, value) in props(&deps) {
            let name_str = as_str(key).ok_or(InvalidPnpmLockfile)?;

            let Some(specifier_expr) = value.get(b"specifier") else {
                bail!(
                    log,
                    "pnpm-lock.yaml dependency '{}' missing 'specifier' field",
                    escape_control_chars(name_str)
                );
            };
            let Some(version_expr) = value.get(b"version") else {
                bail!(
                    log,
                    "pnpm-lock.yaml dependency '{}' missing 'version' field",
                    escape_control_chars(name_str)
                );
            };
            let version_str = as_str(&version_expr).ok_or(InvalidPnpmLockfile)?;

            if version_str.starts_with(b"runtime:") {
                if !silent {
                    bun_core::warn!(
                        "skipping \"{}@{}\" from pnpm-lock.yaml: runtime dependencies are not supported",
                        escape_control_chars(name_str),
                        escape_control_chars(version_str)
                    );
                }
                continue;
            }

            let entry = importer_versions.get_or_put(name_str)?;
            if entry.found_existing {
                continue;
            }
            *entry.value_ptr = Box::from(remove_suffix(version_str));

            // pnpm records an importer's auto-installed peers under `dependencies`.
            if manifest_peers.contains(name_str)
                && manifest
                    .get(group_name)
                    .is_none_or(|group| group.get(name_str).is_none())
            {
                continue;
            }

            let specifier_str = as_str(&specifier_expr).ok_or(InvalidPnpmLockfile)?;

            // The dependency keeps its `catalog:` reference. This only checks that the entry
            // exists.
            if let Some(catalog_name) = specifier_str.strip_prefix(b"catalog:") {
                let catalog_name = catalog_name.trim_ascii();
                if lockfile
                    .catalogs
                    .find(string_bytes!(lockfile), catalog_name, name_str)
                    .is_none()
                {
                    bail!(
                        log,
                        "pnpm-lock.yaml catalog '{}' missing entry for dependency '{}'",
                        escape_control_chars(catalog_name),
                        escape_control_chars(name_str)
                    );
                }
            }

            let log = Some(&mut *log);
            if !append_dependency(lockfile, log, name_str, specifier_str, group_behavior)? {
                return Err(InvalidPnpmLockfile);
            }
        }
    }

    for (peer_name, decl) in manifest_peers.iter() {
        let peer_name: &[u8] = peer_name;
        if !decl.optional && !importer_versions.contains(peer_name) && verbose {
            bun_core::warn!(
                "skipping peer \"{}\" of {}: not in pnpm-lock.yaml, resolving it",
                escape_control_chars(peer_name),
                ImporterName(importer_path)
            );
        }
        let log = Some(&mut *log);
        if !append_dependency(lockfile, log, peer_name, decl.range, decl.behavior())? {
            return Err(InvalidPnpmLockfile);
        }
    }

    if exclude_links_from_lockfile && verbose {
        for (group_name, _) in DEPENDENCY_GROUPS {
            for (key, value) in props(&manifest.get(group_name).unwrap_or_default()) {
                if let (Some(name_str), Some(spec)) = (as_str(key), as_str(value))
                    && spec.starts_with(b"link:")
                    && !importer_versions.contains(name_str)
                {
                    bun_core::warn!(
                        "skipping \"{}\" from {}: excluded from pnpm-lock.yaml by excludeLinksFromLockfile",
                        escape_control_chars(name_str),
                        ImporterName(importer_path)
                    );
                }
            }
        }
    }

    if importer_path == b"." {
        for workspace_path in lockfile.workspace_paths.values().to_vec() {
            let path = workspace_path.slice(string_bytes!(lockfile)).to_vec();
            let workspace_root = importer_package_json(manager, log, &path)?;
            let name = get_str(&workspace_root, b"name").ok_or(InvalidPnpmLockfile)?;
            push_workspace_dependency(lockfile, name, &path)?;
        }
    }

    take_appended_dependencies(lockfile, pkg, off);
    Ok(())
}

/// pnpm's allow-list of packages that may run lifecycle scripts, i.e. bun's `trustedDependencies`.
/// Returns whether `list` is an array. An empty array counts, because it means that no package may
/// run scripts, even though `as_array` returns `None` for it.
fn collect_only_built_dependencies(list: &Expr, out: &mut Vec<&'static [u8]>) -> bool {
    let Some(mut items) = list.as_array() else {
        return list.is_array();
    };
    while let Some(item) = items.next() {
        let Some(name) = as_str(&item).filter(|name| !name.is_empty()) else {
            continue;
        };
        if !out.contains(&name) {
            out.push(name);
        }
    }
    true
}

fn add_trusted_dependencies(
    json: &mut Expr,
    bump: &bun_alloc::Arena,
    names: &[&'static [u8]],
) -> Result<bool, AllocError> {
    let existing = json.get(b"trustedDependencies");
    if existing.is_some_and(|existing| !matches!(existing.data, ExprData::EArray(_))) {
        return Ok(false);
    }

    let mut items = js_ast::ExprNodeList::init_capacity(names.len());
    if let Some(mut existing_items) = existing.as_ref().and_then(Expr::as_array) {
        while let Some(item) = existing_items.next() {
            VecExt::append(&mut items, item);
        }
    }

    let existing_len = items.len_u32();
    for &name in names {
        if !items.slice().iter().any(|item| as_str(item) == Some(name)) {
            let item = Expr::init(E::EString::init(name), bun_ast::Loc::EMPTY);
            VecExt::append(&mut items, item);
        }
    }
    if existing.is_some() && items.len_u32() == existing_len {
        return Ok(false);
    }

    e_object_mut(json).put(bump, b"trustedDependencies", array_expr(items))?;
    Ok(true)
}

fn array_expr(items: js_ast::ExprNodeList) -> Expr {
    let is_single_line = items.len_u32() == 1;
    Expr::init(
        E::Array {
            items,
            is_single_line,
            ..Default::default()
        },
        bun_ast::Loc::EMPTY,
    )
}

/// Used when no pnpm-lock.yaml was migrated. A `workspaces` field in the root means the config was
/// already migrated.
pub(crate) fn migrate_pnpm_workspace_config(
    manager: &mut PackageManager,
) -> Result<(), AllocError> {
    if !sys::exists_z(bun_core::zstr!("pnpm-workspace.yaml")) {
        return Ok(());
    }
    let log = manager.log_mut();
    let Some(root_pkg_json) = root_package_json(manager, log) else {
        return Ok(());
    };
    if root_pkg_json.root.get(b"workspaces").is_some() {
        return Ok(());
    }
    update_package_json_after_migration(None, manager, log, &StringArrayHashMap::new())
}

/// Edits the cached root package.json. `write_migrated` writes it if the lockfile is saved.
fn update_package_json_after_migration(
    lockfile: Option<&mut Lockfile>,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    patches: &FoundPatches,
) -> Result<(), AllocError> {
    let bump = bun_alloc::Arena::new();
    let silent = manager.options.log_level.is_silent();

    let Some(root_pkg_json) = root_package_json(manager, log) else {
        return Ok(());
    };

    let mut json = root_pkg_json.root;
    if !json.is_object() {
        return Ok(());
    }

    let mut copied: Vec<&'static str> = Vec::new();
    let mut trusted_names: Vec<&'static [u8]> = Vec::new();
    let mut pnpm_only_built_deps = false;
    let mut workspace_only_built_deps = false;

    // Copied instead of moved, because pnpm keeps reading this block and Bun only reads the
    // root-level fields.
    if let Some(pnpm_obj) = json.get_object(b"pnpm") {
        if let Some(overrides) = pnpm_obj.get(b"overrides").filter(is_non_empty_object) {
            if copy_into_root(&mut json, &bump, b"overrides", &overrides, None)? {
                copied.push("copied pnpm.overrides to overrides");
            }
        }
        if let Some(patched) = pnpm_obj
            .get(b"patchedDependencies")
            .filter(is_non_empty_object)
        {
            if copy_into_root(
                &mut json,
                &bump,
                b"patchedDependencies",
                &patched,
                Some(patches),
            )? {
                copied.push("copied pnpm.patchedDependencies to patchedDependencies");
            }
        }
        if let Some(extensions) = pnpm_obj
            .get(b"packageExtensions")
            .filter(is_non_empty_object)
        {
            if copy_into_root(&mut json, &bump, b"packageExtensions", &extensions, None)? {
                copied.push("copied pnpm.packageExtensions to packageExtensions");
            }
        }
        if let Some(only_built) = pnpm_obj.get(b"onlyBuiltDependencies") {
            pnpm_only_built_deps = collect_only_built_dependencies(&only_built, &mut trusted_names);
        }
    }

    let mut workspace_paths: Option<Vec<&[u8]>> = None;
    let mut catalog_obj: Option<Expr> = None;
    let mut catalogs_obj: Option<Expr> = None;
    let mut workspace_overrides_obj: Option<Expr> = None;
    let mut workspace_patched_deps_obj: Option<Expr> = None;
    let mut workspace_extensions_obj: Option<Expr> = None;

    match sys::File::read_from(Fd::cwd(), b"pnpm-workspace.yaml") {
        Ok(contents) => 'read_pnpm_workspace_yaml: {
            // Quoted and block scalars are copied into the parse arena, which outlives the print.
            let contents: &[u8] = bump.alloc_slice_copy(&contents);
            let yaml_source = bun_ast::Source::init_path_string(b"pnpm-workspace.yaml", contents);
            let ws_root = match bun_parsers::yaml::YAML::parse(
                &yaml_source,
                log,
                &bump,
                bun_parsers::yaml::CyclicAliases::Reject,
            ) {
                Ok(ws_root) => ws_root,
                Err(err) => {
                    // A syntax error is in `log` already.
                    if matches!(err, bun_parsers::yaml::YamlParseError::StackOverflow) {
                        log.add_error(
                            None,
                            bun_ast::Loc::EMPTY,
                            b"pnpm-workspace.yaml is nested too deeply",
                        );
                    }
                    break 'read_pnpm_workspace_yaml;
                }
            };

            if let Some(mut packages) = ws_root.get(b"packages").and_then(|p| p.as_array()) {
                let mut paths: Vec<&[u8]> = Vec::new();
                while let Some(package_path) = packages.next() {
                    paths.extend(as_str(&package_path));
                }
                workspace_paths = Some(paths);
            }

            let strings_of = |field: &'static str| -> Option<Expr> {
                let map = ws_root.get_object(field.as_bytes())?;
                let mut skipped = 0;
                let strings = string_entries(contents, &map, field == "catalogs", &mut skipped);
                if skipped > 0 && !silent {
                    bun_core::warn!(
                        "skipping non-string entries of \"{}\" in pnpm-workspace.yaml ({})",
                        field,
                        skipped,
                    );
                }
                Some(strings).filter(is_non_empty_object)
            };
            catalog_obj = strings_of("catalog");
            catalogs_obj = strings_of("catalogs");
            // The migrated root skips `Package::parse`, which would record these catalogs.
            if let Some(lockfile) = lockfile {
                let catalogs = &mut lockfile.catalogs;
                catalogs.put_missing_from_pnpm_workspace(
                    catalog_obj,
                    catalogs_obj,
                    &mut sbuf!(lockfile),
                )?;
            }
            workspace_overrides_obj = strings_of("overrides");
            workspace_patched_deps_obj = strings_of("patchedDependencies");
            if let Some(extensions) = ws_root.get_object(b"packageExtensions") {
                workspace_extensions_obj = Some(extension_entries(contents, &bump, &extensions)?)
                    .filter(is_non_empty_object);
            }
            if let Some(only_built) = ws_root.get(b"onlyBuiltDependencies") {
                workspace_only_built_deps =
                    collect_only_built_dependencies(&only_built, &mut trusted_names);
            }
        }
        Err(_) => {}
    }

    if catalog_obj.is_none() && catalogs_obj.is_none() {
        if let Some(paths) = &workspace_paths {
            e_object_mut(&mut json).put(&bump, b"workspaces", paths_array(paths))?;
            copied.push("copied pnpm-workspace.yaml to workspaces");
        }
    } else {
        // An existing `workspaces` array is replaced by the object form.
        let existing = json.get_object(b"workspaces");
        let mut workspaces = existing.unwrap_or_else(empty_object);
        let workspaces_obj = e_object_mut(&mut workspaces);
        if let Some(paths) = workspace_paths.as_ref().filter(|paths| !paths.is_empty()) {
            workspaces_obj.put(&bump, b"packages", paths_array(paths))?;
        }
        if let Some(catalog) = catalog_obj {
            workspaces_obj.put(&bump, b"catalog", catalog)?;
        }
        if let Some(catalogs) = catalogs_obj {
            workspaces_obj.put(&bump, b"catalogs", catalogs)?;
        }
        if existing.is_none() {
            e_object_mut(&mut json).put(&bump, b"workspaces", workspaces)?;
        }
        copied.push("copied pnpm-workspace.yaml to workspaces");
    }

    if let Some(overrides) = workspace_overrides_obj {
        if copy_into_root(&mut json, &bump, b"overrides", &overrides, None)? {
            copied.push("copied pnpm-workspace.yaml overrides to overrides");
        }
    }
    if let Some(patched) = workspace_patched_deps_obj {
        if copy_into_root(
            &mut json,
            &bump,
            b"patchedDependencies",
            &patched,
            Some(patches),
        )? {
            copied.push("copied pnpm-workspace.yaml patchedDependencies to patchedDependencies");
        }
    }
    if let Some(extensions) = workspace_extensions_obj {
        if copy_into_root(&mut json, &bump, b"packageExtensions", &extensions, None)? {
            copied.push("copied pnpm-workspace.yaml packageExtensions to packageExtensions");
        }
    }

    if (pnpm_only_built_deps || workspace_only_built_deps)
        && add_trusted_dependencies(&mut json, &bump, &trusted_names)?
    {
        if pnpm_only_built_deps {
            copied.push("copied pnpm.onlyBuiltDependencies to trustedDependencies");
        }
        if workspace_only_built_deps {
            copied.push("copied pnpm-workspace.yaml onlyBuiltDependencies to trustedDependencies");
        }
    }

    if copied.is_empty() {
        return Ok(());
    }

    // The spliced-in nodes live in `bump` and the AST store: the cache entry must own its tree.
    save_entry(root_pkg_json, json, log);

    package_json_write_back::record_migrated(manager, WorkspaceTarget::root(), copied);

    Ok(())
}

fn empty_object() -> Expr {
    Expr::init(E::Object::default(), bun_ast::Loc::EMPTY)
}

/// Returns the entries of the YAML `map` that package.json can represent: scalar keys and values,
/// as written.
fn string_entries(source: &[u8], map: &Expr, named: bool, skipped: &mut usize) -> Expr {
    let text_of = |scalar: &Expr| -> Option<Expr> {
        let text =
            scalar_text(source, scalar).filter(|_| !matches!(scalar.data, ExprData::ENull(_)));
        Some(Expr::init(E::EString::init(text?), scalar.loc))
    };
    let mut properties = js_ast::G::PropertyList::init_capacity(map.property_count());
    for (key, value) in props(map) {
        let key = text_of(key);
        let value = match &value.data {
            ExprData::EObject(_) if named => Some(string_entries(source, value, false, skipped)),
            _ if named => None,
            _ => text_of(value),
        };
        if key.is_none() || value.is_none() {
            *skipped += 1;
            continue;
        }
        VecExt::append(
            &mut properties,
            js_ast::G::Property {
                key,
                value,
                ..Default::default()
            },
        );
    }
    Expr::init(
        E::Object {
            properties,
            ..Default::default()
        },
        map.loc,
    )
}

/// Like `string_entries`, but for `packageExtensions`: rule -> group -> name -> range, plus
/// optional peers.
fn extension_entries(
    source: &[u8],
    bump: &bun_alloc::Arena,
    map: &Expr,
) -> Result<Expr, AllocError> {
    let mut rules = empty_object();
    for (key, value) in props(map) {
        let Some(key) = scalar_text(source, key).filter(|_| is_non_empty_object(value)) else {
            continue;
        };
        let mut rule = empty_object();
        for group in [
            b"dependencies".as_slice(),
            b"optionalDependencies",
            b"peerDependencies",
        ] {
            if let Some(ranges) = value.get_object(group) {
                let ranges = string_entries(source, &ranges, false, &mut 0);
                e_object_mut(&mut rule).put(bump, group, ranges)?;
            }
        }
        let mut meta = empty_object();
        for peer in crate::yarn_berry::optional_names(source, value, b"peerDependenciesMeta") {
            let mut optional = empty_object();
            let yes = Expr::init(E::Boolean { value: true }, bun_ast::Loc::EMPTY);
            e_object_mut(&mut optional).put(bump, b"optional", yes)?;
            e_object_mut(&mut meta).put(bump, peer, optional)?;
        }
        if is_non_empty_object(&meta) {
            e_object_mut(&mut rule).put(bump, b"peerDependenciesMeta", meta)?;
        }
        e_object_mut(&mut rules).put(bump, key, rule)?;
    }
    Ok(rules)
}

fn is_non_empty_object(expr: &Expr) -> bool {
    matches!(&expr.data, ExprData::EObject(o) if !o.properties.is_empty())
}

/// `false` if `field` is not an object. With `patches`, a bare `name` key becomes `name@version`.
fn copy_into_root(
    json: &mut Expr,
    bump: &bun_alloc::Arena,
    field: &[u8],
    src: &Expr,
    patches: Option<&FoundPatches>,
) -> Result<bool, AllocError> {
    let mut dest = match json.get(field) {
        Some(dest) if !dest.is_object() => return Ok(false),
        Some(dest) => dest,
        None => {
            let dest = empty_object();
            e_object_mut(json).put(bump, field, dest)?;
            dest
        }
    };
    for (key, value) in props(src) {
        let Some(key) = as_str(key) else {
            continue;
        };
        let Some(found) = patches.and_then(|patches| patches.get(key)) else {
            e_object_mut(&mut dest).put(bump, key, *value)?;
            continue;
        };
        for key in found {
            e_object_mut(&mut dest).put(bump, js_ast::data_store_dupe_str(key), *value)?;
        }
    }
    Ok(true)
}

fn paths_array(paths: &[&[u8]]) -> Expr {
    let mut items = js_ast::ExprNodeList::init_capacity(paths.len());
    for path in paths {
        VecExt::append(
            &mut items,
            Expr::init(E::EString::init(path), bun_ast::Loc::EMPTY),
        );
    }
    array_expr(items)
}
