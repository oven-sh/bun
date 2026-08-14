use crate::lockfile::package::PackageColumns as _;
use bun_collections::VecExt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::StringArrayHashMap;

use bun_ast::{self, self as js_ast, E, Expr, ExprData, G};
use bun_core::strings;
use bun_semver as semver;
use bun_semver::{ExternalString, String};
use bun_sys::{self as sys, Fd};

use crate::bin::Bin;
use crate::dependency::{self, Dependency, DependencyExt as _};
use crate::external_slice::ExternalSlice;
use crate::integrity::Integrity;
use crate::lockfile::{self, LoadResult, LoadResultOk, Lockfile};
use crate::npm::{self};
use crate::repository::Repository;
use crate::resolution::{self, Resolution, TaggedValue};
use crate::{DependencyID, INVALID_PACKAGE_ID, PackageID, PackageManager};

// A single long-lived `Buf` for the whole function would lock out every other
// `lockfile.*` access. Construct a fresh `Buf` per append so the mutable
// borrow ends immediately.
macro_rules! sbuf {
    ($lockfile:expr) => {
        semver::string::Buf {
            bytes: &mut $lockfile.buffers.string_bytes,
            pool: &mut $lockfile.string_pool,
        }
    };
}

// Borrows are kept field-disjoint — every concurrent mutation in this file
// touches `buffers.dependencies`, `buffers.resolutions`, `packages`, etc.,
// never `string_bytes` itself, so a plain
// `lockfile.buffers.string_bytes.as_slice()` at the use site is sound and
// checked. The one exception (`append_package_dedupe` taking `&mut self`)
// reads the slice from `self` internally.
macro_rules! string_bytes {
    ($lockfile:expr) => {
        $lockfile.buffers.string_bytes.as_slice()
    };
}

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
                let peers_idx =
                    strings::index_of_char(&path[i + 2..], b'(').map(|idx| (idx as usize) + i + 2);

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

/// pnpm dependency-path refToRelative
fn pnpm_reference_is_dep_path(reference: &[u8]) -> bool {
    if reference.first() == Some(&b'@') {
        return true;
    }
    let Some(at) = strings::index_of_char_usize(reference, b'@') else {
        return false;
    };
    if strings::index_of_char_usize(reference, b':').is_some_and(|colon| colon < at) {
        return false;
    }
    if strings::index_of_char_usize(reference, b'(').is_some_and(|paren| paren < at) {
        return false;
    }
    true
}

fn write_pnpm_dep_path(
    out: &mut Vec<u8>,
    dep_name: &[u8],
    reference: &[u8],
) -> Result<(), AllocError> {
    out.clear();
    if pnpm_reference_is_dep_path(reference) {
        out.extend_from_slice(reference);
        return Ok(());
    }
    write!(
        out,
        "{}@{}",
        bstr::BStr::new(dep_name),
        bstr::BStr::new(reference)
    )
    .map_err(|_| AllocError)
}

fn missing_package_entry(
    log: &mut bun_ast::Log,
    dep_path: &[u8],
    dep_name: &[u8],
    parent: core::fmt::Arguments<'_>,
) -> MigratePnpmLockfileError {
    log.add_error_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!(
            "pnpm-lock.yaml has no package entry '{}' for dependency '{}' of {}",
            bstr::BStr::new(dep_path),
            bstr::BStr::new(dep_name),
            parent
        ),
    );
    MigratePnpmLockfileError::PnpmLockfileUnresolvableDependency
}

fn collect_patch_paths(
    obj: &Expr,
    out: &mut StringArrayHashMap<Box<[u8]>>,
) -> Result<(), AllocError> {
    for prop in e_object(obj).properties.slice() {
        let key = prop.key.as_ref().expect("infallible: prop has key");
        let value = prop.value.as_ref().expect("infallible: prop has value");
        if let (Some(key_str), Some(path_str)) = (as_string(key), as_string(value)) {
            out.put(key_str, Box::from(path_str))?;
        }
    }
    Ok(())
}

/// Current pnpm records only the patch hash in the lockfile; the patch file path lives in the config.
fn read_config_patch_paths(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
) -> Result<StringArrayHashMap<Box<[u8]>>, AllocError> {
    let mut paths: StringArrayHashMap<Box<[u8]>> = StringArrayHashMap::new();

    let mut pkg_json_path = bun_paths::AutoAbsPath::init_top_level_dir();
    let _ = pkg_json_path.append(b"package.json");
    if let crate::GetJsonResult::Entry(pkg_json) = manager
        .workspace_package_json_cache
        .get_with_path(log, pkg_json_path.slice(), Default::default())
    {
        if let Some(patched) = pkg_json
            .root
            .get(b"pnpm")
            .and_then(|pnpm| pnpm.get_object(b"patchedDependencies"))
        {
            collect_patch_paths(&patched, &mut paths)?;
        }
    }

    if let Ok(contents) = sys::File::read_from(Fd::cwd(), b"pnpm-workspace.yaml") {
        let contents: &'static [u8] = js_ast::data_store_dupe_str(&contents);
        let source = bun_ast::Source::init_path_string(b"pnpm-workspace.yaml", contents);
        let arena = bun_alloc::Arena::new();
        if let Ok(ws_root) = bun_parsers::yaml::YAML::parse(
            &source,
            log,
            &arena,
            bun_parsers::yaml::CyclicAliases::Reject,
        ) {
            if let Some(patched) = ws_root.get_object(b"patchedDependencies") {
                collect_patch_paths(&patched, &mut paths)?;
            }
        }
    }

    Ok(paths)
}

/// `work:1.0.0` -> `1.0.0` for pnpm's registry-qualified dep paths (pnpm11/deps/path parseRegistryQualifiedVersion).
fn split_registry_qualified_version(res_str: &[u8]) -> Option<(&[u8], &[u8])> {
    let colon = strings::index_of_char_usize(res_str, b':')?;
    let (registry, version) = (&res_str[..colon], &res_str[colon + 1..]);
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
    let tarball = resolution_expr.and_then(|obj| get_string(obj, b"tarball").map(|(url, _)| url));

    if let Some(obj) = resolution_expr {
        let ty = get_string(obj, b"type").map(|(s, _)| s).unwrap_or_default();

        // `path:` is pnpm's `repo#commit&path:sub/dir` on git and git-hosted tarball resolutions.
        if get_string(obj, b"path").is_some() {
            return Err(MigratePnpmLockfileError::PnpmLockfileGitSubdirectory);
        }

        if ty == b"git" {
            if let Some((repo, _)) = get_string(obj, b"repo") {
                let commit = get_string(obj, b"commit")
                    .map(|(s, _)| s)
                    .unwrap_or_default();
                return Ok(Resolution::init(TaggedValue::Git(Repository {
                    repo: string_buf.append(strings::without_prefix(repo, b"git+"))?,
                    committish: string_buf.append(commit)?,
                    ..Default::default()
                })));
            }
        }

        if ty == b"directory" {
            if let Some((dir, _)) = get_string(obj, b"directory") {
                return Ok(Resolution::init(TaggedValue::Folder(
                    string_buf.append(dir)?,
                )));
            }
        }

        if let Some(path) =
            tarball.and_then(|url| strings::without_prefix_if_possible_comptime(url, b"file:"))
        {
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
        if strings::has_prefix_comptime(url, b"https://codeload.github.com/") {
            return Ok(Resolution::from_pnpm_lockfile(url, string_buf)?);
        }
        return Ok(Resolution::init(TaggedValue::RemoteTarball(
            string_buf.append(url)?,
        )));
    }

    if let Some(path) = strings::without_prefix_if_possible_comptime(res_str, b"file:") {
        if Dependency::is_tarball(path) {
            return Ok(Resolution::init(TaggedValue::LocalTarball(
                string_buf.append(path)?,
            )));
        }
    }

    Ok(Resolution::from_pnpm_lockfile(res_str, string_buf)?)
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
    #[error("PnpmLockfileMissingRootPackage")]
    PnpmLockfileMissingRootPackage,
    #[error("PnpmLockfileInvalidSnapshot")]
    PnpmLockfileInvalidSnapshot,
    #[error("PnpmLockfileMissingDependencyVersion")]
    PnpmLockfileMissingDependencyVersion,
    #[error("PnpmLockfileInvalidDependency")]
    PnpmLockfileInvalidDependency,
    #[error("PnpmLockfileMissingCatalogEntry")]
    PnpmLockfileMissingCatalogEntry,
    #[error("PnpmLockfileUnresolvableDependency")]
    PnpmLockfileUnresolvableDependency,
    #[error("PnpmLockfileGitSubdirectory")]
    PnpmLockfileGitSubdirectory,
}

bun_core::oom_from_alloc!(MigratePnpmLockfileError);

impl From<crate::Error> for MigratePnpmLockfileError {
    fn from(e: crate::Error) -> Self {
        // Preserve the known error variants; only collapse genuinely-unknown
        // tags to InvalidPnpmLockfile.
        match e {
            crate::Error::Alloc(bun_alloc::AllocError) => Self::OutOfMemory,
            crate::Error::DependencyLoop => Self::DependencyLoop,
            _ => Self::InvalidPnpmLockfile,
        }
    }
}

impl From<crate::lockfile_real::tree::SubtreeError> for MigratePnpmLockfileError {
    fn from(e: crate::lockfile_real::tree::SubtreeError) -> Self {
        use crate::lockfile_real::tree::SubtreeError as E;
        match e {
            E::OutOfMemory => Self::OutOfMemory,
            E::DependencyLoop => Self::DependencyLoop,
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

#[inline]
fn as_string(expr: &Expr) -> Option<&'static [u8]> {
    // YAML / package.json parse always produces UTF-8 EStrings; `E.String.data`
    // is a Store-backed slice, so the `'static` here is the field's own
    // lifetime — no laundering.
    if let bun_ast::ExprData::EString(s) = &expr.data {
        if s.is_utf8() {
            return Some(s.data.slice());
        }
    }
    None
}

#[inline]
fn get_string(expr: &Expr, name: &[u8]) -> Option<(&'static [u8], bun_ast::Loc)> {
    let q = expr.as_property(name)?;
    Some((as_string(&q.expr)?, q.expr.loc))
}

fn e_object(expr: &Expr) -> &E::Object {
    match &expr.data {
        ExprData::EObject(o) => &**o,
        _ => unreachable!("e_object called on non-object"),
    }
}

fn e_object_mut(expr: &mut Expr) -> &mut E::Object {
    match &mut expr.data {
        ExprData::EObject(o) => &mut **o,
        _ => unreachable!("e_object_mut called on non-object"),
    }
}

/// Shallow struct copy (`G::Property` lacks `Clone` because of its
/// `Vec`/`NonNull` fields).
fn shallow_clone_prop(p: &G::Property) -> G::Property {
    G::Property {
        key: p.key,
        value: p.value,
        ..Default::default()
    }
}

pub(crate) fn migrate_pnpm_lockfile<'a>(
    lockfile: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
    dir: Fd,
) -> Result<LoadResult<'a>, MigratePnpmLockfileError> {
    lockfile.init_empty();
    crate::initialize_store();
    bun_core::analytics::Features::pnpm_migration_inc(1);

    // The YAML parser allocates `Expr::Data` nodes into the thread-local
    // `Store` (via `Expr::init`). Later `workspace_package_json_cache.get_with_path`
    // calls (with default `init_reset_store: true`) invoke `initialize_store()`,
    // which `Store::reset()`s — invalidating every `StoreRef` in the parsed
    // YAML tree. Clone the tree out of the Store into `yaml_arena` (which
    // lives for the whole function) so `root` survives those resets.
    let yaml_source = bun_ast::Source::init_path_string(b"pnpm-lock.yaml", data);
    let yaml_arena = bun_alloc::Arena::new();
    let _root: Expr = match bun_parsers::yaml::YAML::parse(
        &yaml_source,
        log,
        &yaml_arena,
        bun_parsers::yaml::CyclicAliases::Reject,
    ) {
        Ok(r) => r,
        Err(_) => return Err(MigratePnpmLockfileError::YamlParseError),
    };
    let mut root: Expr = bun_core::handle_oom(_root.deep_clone(&yaml_arena));

    // pnpm 11 writes `---<env lockfile>---<lockfile>`; the last document is the lockfile.
    if let Some(mut documents) = root.as_array() {
        while let Some(document) = documents.next() {
            root = document;
        }
    }

    if !root.is_object() {
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "pnpm-lock.yaml root must be an object, got {}",
                root.data.tag_name()
            ),
        );
        return Err(MigratePnpmLockfileError::PnpmLockfileNotObject);
    }

    let Some(lockfile_version_expr) = root.get(b"lockfileVersion") else {
        log.add_error(
            None,
            bun_ast::Loc::EMPTY,
            b"pnpm-lock.yaml missing 'lockfileVersion' field",
        );
        return Err(MigratePnpmLockfileError::PnpmLockfileMissingVersion);
    };

    let lockfile_version_num: f64 = 'lockfile_version: {
        'err: {
            match &lockfile_version_expr.data {
                ExprData::ENumber(num) => {
                    if num.value() < 0.0 {
                        break 'err;
                    }
                    break 'lockfile_version num.value();
                }
                ExprData::EString(version_str) => {
                    let str = version_str.data.slice();
                    let end = strings::index_of_char(str, b'.')
                        .map(|i| i as usize)
                        .unwrap_or(str.len());
                    match bun_core::fmt::parse_f64(&str[0..end]) {
                        Some(v) => break 'lockfile_version v,
                        None => break 'err,
                    }
                }
                _ => {}
            }
        }

        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "pnpm-lock.yaml 'lockfileVersion' must be a number or string, got {}",
                lockfile_version_expr.data.tag_name()
            ),
        );
        return Err(MigratePnpmLockfileError::PnpmLockfileVersionInvalid);
    };

    if lockfile_version_num < 7.0 {
        return Err(MigratePnpmLockfileError::PnpmLockfileTooOld);
    }

    if lockfile_version_num >= 10.0 {
        log.add_warning_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "pnpm-lock.yaml lockfileVersion {} is newer than the supported 9.0, migrating as 9.0",
                lockfile_version_num
            ),
        );
    }

    let mut found_patches: StringArrayHashMap<Box<[u8]>> = StringArrayHashMap::new();
    let mut snapshot_dep_paths = SnapshotDepPaths::new();

    let (pkg_map, importer_dep_res_versions, workspace_pkgs_off, workspace_pkgs_end) = 'build: {
        if let Some(mut catalogs_expr) = root.get_object(b"catalogs") {
            // Borrowck: split `lockfile` into disjoint fields — `catalogs`
            // vs. the `string_bytes`/`string_pool` pair that `sbuf!` borrows.
            crate::lockfile_real::CatalogMap::from_pnpm_lockfile(
                &mut lockfile.catalogs,
                log,
                e_object_mut(&mut catalogs_expr),
                &mut sbuf!(lockfile),
            )?;
        }

        if let Some(overrides_expr) = root.get_object(b"overrides") {
            for prop in e_object(&overrides_expr).properties.slice() {
                let key = prop.key.as_ref().expect("infallible: prop has key");
                let value = prop.value.as_ref().expect("infallible: prop has value");

                let Some(name_str) = as_string(key) else {
                    return Err(invalid_pnpm_lockfile());
                };
                let Some(version_str) = as_string(value) else {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml override '{}' must be a string",
                            bstr::BStr::new(name_str)
                        ),
                    );
                    return Err(invalid_pnpm_lockfile());
                };

                if version_str == b"-" {
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml override '{}' removes the dependency ('-'), which bun does not support",
                            bstr::BStr::new(name_str)
                        ),
                    );
                } else if Dependency::split_name_and_maybe_version(name_str)
                    .1
                    .is_some()
                    || strings::contains_char(name_str, b'>')
                {
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml override '{}' is scoped to a version range or parent package, which bun does not support; it will not apply",
                            bstr::BStr::new(name_str)
                        ),
                    );
                }

                let name_hash = semver::string::Builder::string_hash(name_str);
                let name = sbuf!(lockfile).append_with_hash(name_str, name_hash)?;

                let version_hash = semver::string::Builder::string_hash(version_str);
                let version = sbuf!(lockfile).append_with_hash(version_str, version_hash)?;
                let version_sliced = version.sliced(string_bytes!(lockfile));

                let Some(version) = Dependency::parse(
                    name,
                    name_hash,
                    version_sliced.slice,
                    &version_sliced,
                    Some(&mut *log),
                    Some(&mut *manager),
                ) else {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml override '{}' has an invalid value '{}'",
                            bstr::BStr::new(name_str),
                            bstr::BStr::new(version_str)
                        ),
                    );
                    return Err(invalid_pnpm_lockfile());
                };

                let dep = Dependency {
                    name,
                    name_hash,
                    version,
                    ..Default::default()
                };

                lockfile.overrides.map.put(name_hash, dep)?;
            }
        }

        struct Patch {
            path: String,
            key: Box<[u8]>,
        }
        // patch hash -> every patchedDependencies key using that patch file
        let mut patches: StringArrayHashMap<Vec<Patch>> = StringArrayHashMap::new();
        let mut patch_join_buf: Vec<u8> = Vec::new();

        if let Some(patched_dependencies_expr) = root.get_object(b"patchedDependencies") {
            let mut config_patch_paths: Option<StringArrayHashMap<Box<[u8]>>> = None;

            for prop in e_object(&patched_dependencies_expr).properties.slice() {
                let key_expr = prop.key.as_ref().expect("infallible: prop has key");
                let value = prop.value.as_ref().expect("infallible: prop has value");

                let Some(key_str) = as_string(key_expr) else {
                    return Err(invalid_pnpm_lockfile());
                };

                let (hash_str, path_str) = if let Some(hash_str) = as_string(value) {
                    if config_patch_paths.is_none() {
                        config_patch_paths = Some(read_config_patch_paths(manager, log)?);
                    }
                    let config = config_patch_paths.as_ref().expect("set above");
                    let path = config.get(key_str).or_else(|| {
                        config.get(Dependency::split_name_and_maybe_version(key_str).0)
                    });
                    let Some(path) = path else {
                        log.add_warning_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "pnpm-lock.yaml patch for '{}' is not in patchedDependencies of package.json or pnpm-workspace.yaml, skipping",
                                bstr::BStr::new(key_str)
                            ),
                        );
                        continue;
                    };
                    (hash_str, &**path)
                } else {
                    let Some((path_str, _)) = get_string(value, b"path") else {
                        return Err(invalid_pnpm_lockfile());
                    };
                    let Some((hash_str, _)) = get_string(value, b"hash") else {
                        return Err(invalid_pnpm_lockfile());
                    };
                    (hash_str, path_str)
                };

                let path = sbuf!(lockfile).append(path_str)?;
                patches.get_or_put(hash_str)?.value_ptr.push(Patch {
                    path,
                    key: Box::from(key_str),
                });
            }
        }

        let Some(importers_obj) = root.get_object(b"importers") else {
            log.add_error(
                None,
                bun_ast::Loc::EMPTY,
                b"pnpm-lock.yaml missing 'importers' field",
            );
            return Err(MigratePnpmLockfileError::PnpmLockfileMissingImporters);
        };

        let mut has_root_pkg_expr: Option<Expr> = None;

        for prop in e_object(&importers_obj).properties.slice() {
            let Some(importer_path) =
                as_string(prop.key.as_ref().expect("infallible: prop has key"))
            else {
                return Err(invalid_pnpm_lockfile());
            };
            let value = prop.value.as_ref().expect("infallible: prop has value");

            if importer_path == b"." {
                if has_root_pkg_expr.is_some() {
                    return Err(invalid_pnpm_lockfile());
                }
                has_root_pkg_expr = Some(*value);
                continue;
            }

            let mut pkg_json_path = bun_paths::AutoAbsPath::init_top_level_dir();
            let _ = pkg_json_path.append(importer_path); // OOM/capacity error is non-actionable here
            let _ = pkg_json_path.append(b"package.json"); // OOM/capacity error is non-actionable here

            let importer_pkg_json = match manager.workspace_package_json_cache.get_with_path(
                log,
                pkg_json_path.slice(),
                Default::default(),
            ) {
                crate::GetJsonResult::Entry(j) => j,
                crate::GetJsonResult::ReadErr(_) => {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml lists importer '{}' but '{}/package.json' does not exist",
                            bstr::BStr::new(importer_path),
                            bstr::BStr::new(importer_path)
                        ),
                    );
                    return Err(invalid_pnpm_lockfile());
                }
                crate::GetJsonResult::ParseErr(_) => return Err(invalid_pnpm_lockfile()),
            };

            let workspace_root = &importer_pkg_json.root;

            let Some((name, _)) = get_string(workspace_root, b"name") else {
                // we require workspace names.
                return Err(MigratePnpmLockfileError::WorkspaceNameMissing);
            };

            let name_hash = semver::string::Builder::string_hash(name);

            let path_str = sbuf!(lockfile).append(importer_path)?;
            lockfile.workspace_paths.put(name_hash, path_str)?;

            if let Some(version_expr) = value.get(b"version") {
                let Some(version_raw) = as_string(&version_expr) else {
                    return Err(invalid_pnpm_lockfile());
                };
                let version_str = sbuf!(lockfile).append(version_raw)?;

                let parsed = semver::Version::parse(version_str.sliced(string_bytes!(lockfile)));
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
                bun_ast::Loc::EMPTY,
                b"pnpm-lock.yaml missing root package entry (importers['.'])",
            );
            return Err(MigratePnpmLockfileError::PnpmLockfileMissingRootPackage);
        };

        let mut importer_dep_res_versions: StringArrayHashMap<StringArrayHashMap<Box<[u8]>>> =
            StringArrayHashMap::new();

        {
            let mut pkg_json_path = bun_paths::AutoAbsPath::init_top_level_dir();
            let _ = pkg_json_path.append(b"package.json"); // OOM/capacity error is non-actionable here

            let pkg_json = match manager
                .workspace_package_json_cache
                .get_with_path(log, pkg_json_path.slice(), Default::default())
                .unwrap()
            {
                Ok(j) => j,
                Err(_) => return Err(invalid_pnpm_lockfile()),
            };

            let mut root_pkg = lockfile::Package::default();

            if let Some((name, _)) = get_string(&pkg_json.root, b"name") {
                let name_hash = semver::string::Builder::string_hash(name);
                root_pkg.name = sbuf!(lockfile).append_with_hash(name, name_hash)?;
                root_pkg.name_hash = name_hash;
            }

            let importer_versions = importer_dep_res_versions.get_or_put(b".")?;
            *importer_versions.value_ptr = StringArrayHashMap::new();

            let (off, len) = parse_append_importer_dependencies(
                lockfile,
                manager,
                &root_pkg_expr,
                log,
                true,
                &importers_obj,
                importer_versions.value_ptr,
            )?;

            root_pkg.dependencies = ExternalSlice::new(off, len);
            root_pkg.resolutions = ExternalSlice::new(off, len);

            root_pkg.meta.id = 0;
            root_pkg.resolution = Resolution::init_root();
            let root_name_hash = root_pkg.name_hash;
            lockfile.packages.append(root_pkg)?;
            lockfile.get_or_put_id(0, root_name_hash)?;
        }

        let mut pkg_map: StringArrayHashMap<PackageID> = StringArrayHashMap::new();

        pkg_map.put(crate::bun_fs::FileSystem::instance().top_level_dir(), 0)?;

        let workspace_pkgs_off = lockfile.packages.len();

        let workspace_paths_snapshot: Vec<String> = lockfile.workspace_paths.values().to_vec();

        'workspaces: for workspace_path in &workspace_paths_snapshot {
            for prop in e_object(&importers_obj).properties.slice() {
                let key = prop.key.as_ref().expect("infallible: prop has key");
                let value = prop.value.as_ref().expect("infallible: prop has value");

                let path = as_string(key).unwrap();
                if !strings::eql_long(path, workspace_path.slice(string_bytes!(lockfile)), true) {
                    continue;
                }

                let mut pkg = lockfile::Package {
                    resolution: Resolution::init(TaggedValue::Workspace(
                        sbuf!(lockfile).append(path)?,
                    )),
                    ..Default::default()
                };

                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                let _ = path_buf.append(path); // OOM/capacity error is non-actionable here
                let abs_path: Box<[u8]> = Box::from(path_buf.slice());
                let _ = path_buf.append(b"package.json"); // OOM/capacity error is non-actionable here

                let workspace_pkg_json = match manager
                    .workspace_package_json_cache
                    .get_with_path(log, path_buf.slice(), Default::default())
                    .unwrap()
                {
                    Ok(j) => j,
                    Err(_) => return Err(invalid_pnpm_lockfile()),
                };

                // Copy `Expr` out by value so the `&mut manager`
                // borrow held by `workspace_pkg_json` ends here — `manager`
                // is reborrowed below for `parse_append_importer_dependencies`.
                let workspace_root: Expr = workspace_pkg_json.root;

                let name = as_string(&workspace_root.get(b"name").unwrap()).unwrap();
                let name_hash = semver::string::Builder::string_hash(name);

                pkg.name = sbuf!(lockfile).append_with_hash(name, name_hash)?;
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
                    log,
                    false,
                    &importers_obj,
                    importer_versions.value_ptr,
                )?;

                pkg.dependencies = ExternalSlice::new(off, len);
                pkg.resolutions = ExternalSlice::new(off, len);

                if let Some(bin_expr) = workspace_root.get(b"bin") {
                    pkg.bin = Bin::parse_append(
                        &bin_expr,
                        &mut sbuf!(lockfile),
                        &mut lockfile.buffers.extern_strings,
                    )?;
                } else if let Some(dirs_q) = workspace_root.as_property(b"directories") {
                    if let Some(bin_expr) = dirs_q.expr.get(b"bin") {
                        pkg.bin =
                            Bin::parse_append_from_directories(&bin_expr, &mut sbuf!(lockfile))?;
                    }
                }

                let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;

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
            let pkg_id: PackageID = u32::try_from(_pkg_id).expect("int cast");

            // Own the bytes — the `'next_dep` loop body mutates
            // `lockfile.buffers.string_bytes` (via `sbuf!`) and takes
            // `&mut *lockfile` (`append_package_dedupe`), so a borrow that
            // spans the loop would conflict.
            let workspace_path_buf: Vec<u8>;
            let workspace_path: &[u8] = if pkg_id == 0 {
                b"."
            } else {
                let workspace_res = lockfile.packages.items_resolution()[pkg_id as usize];
                let ws = *workspace_res.workspace();
                workspace_path_buf = ws.slice(string_bytes!(lockfile)).to_vec();
                &workspace_path_buf
            };

            let Some(importer_versions) = importer_dep_res_versions.get(workspace_path) else {
                return Err(invalid_pnpm_lockfile());
            };

            let deps = lockfile.packages.items_dependencies()[pkg_id as usize];
            'next_dep: for _dep_id in deps.begin()..deps.end() {
                let dep_id: DependencyID = _dep_id;

                let dep = lockfile.buffers.dependencies[dep_id as usize].clone();

                if dep.behavior.is_workspace() {
                    continue;
                }

                match dep.version.tag {
                    dependency::VersionTag::Folder | dependency::VersionTag::Workspace => {
                        let Some(version_str) =
                            importer_versions.get(dep.name.slice(string_bytes!(lockfile)))
                        else {
                            return Err(invalid_pnpm_lockfile());
                        };
                        let version_without_suffix = remove_suffix(version_str);

                        if let Some(link_path) = strings::without_prefix_if_possible_comptime(
                            version_without_suffix,
                            b"link:",
                        ) {
                            // create a link package for the workspace dependency only if it doesn't already exist
                            if dep.version.tag == dependency::VersionTag::Workspace {
                                let mut link_path_buf =
                                    bun_paths::AutoAbsPath::init_top_level_dir();
                                let _ = link_path_buf.append(workspace_path); // OOM/capacity error is non-actionable here
                                let _ = link_path_buf.join(&[link_path]); // path-buffer overflow unreachable for bounded inputs

                                for existing_workspace_path in lockfile.workspace_paths.values() {
                                    let mut workspace_path_buf =
                                        bun_paths::AutoAbsPath::init_top_level_dir();
                                    // OOM/capacity error is non-actionable here
                                    let _ = workspace_path_buf.append(
                                        existing_workspace_path.slice(string_bytes!(lockfile)),
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
                                    sbuf!(lockfile).append(link_path)?,
                                ),
                                ..Default::default()
                            };

                            let mut abs_link_path = bun_paths::AutoAbsPath::init_top_level_dir();
                            let _ = abs_link_path.join(&[workspace_path, link_path]); // path-buffer overflow unreachable for bounded inputs

                            let pkg_entry = pkg_map.get_or_put(abs_link_path.slice())?;
                            if pkg_entry.found_existing {
                                // they point to the same package
                                continue;
                            }

                            *pkg_entry.value_ptr = lockfile.append_package_dedupe(&mut pkg)?;
                        }
                    }
                    dependency::VersionTag::Symlink => {
                        if !strings::is_npm_package_name(
                            dep.version.symlink().slice(string_bytes!(lockfile)),
                        ) {
                            log.add_warning_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "relative link dependency not supported: {}@{}\n",
                                    bstr::BStr::new(dep.name.slice(string_bytes!(lockfile))),
                                    bstr::BStr::new(
                                        dep.version.literal.slice(string_bytes!(lockfile))
                                    ),
                                ),
                            );
                            return Err(MigratePnpmLockfileError::RelativeLinkDependency);
                        }
                    }
                    _ => {}
                }
            }
        }

        struct SnapshotEntry {
            obj: Expr,
            patch_hash: Option<&'static [u8]>,
        }
        impl Default for SnapshotEntry {
            fn default() -> Self {
                Self {
                    obj: Expr::EMPTY,
                    patch_hash: None,
                }
            }
        }
        let mut snapshots: StringArrayHashMap<SnapshotEntry> = StringArrayHashMap::new();

        if let Some(packages_obj) = root.get_object(b"packages") {
            let Some(snapshots_obj) = root.get_object(b"snapshots") else {
                log.add_error(
                    None,
                    bun_ast::Loc::EMPTY,
                    b"pnpm-lock.yaml has 'packages' but missing 'snapshots' field",
                );
                return Err(MigratePnpmLockfileError::PnpmLockfileInvalidSnapshot);
            };

            for snapshot_prop in e_object(&snapshots_obj).properties.slice() {
                let key = snapshot_prop
                    .key
                    .as_ref()
                    .expect("infallible: prop has key");
                let value = snapshot_prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value");

                let Some(key_str) = as_string(key) else {
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

                let patch_hash = match patch_hash_idx {
                    Some(idx) => {
                        let patch_hash_str = &key_str[idx + b"(patch_hash=".len()..];
                        let Some(end_idx) = strings::index_of_char_usize(patch_hash_str, b')')
                        else {
                            return Err(invalid_pnpm_lockfile());
                        };
                        Some(&patch_hash_str[..end_idx])
                    }
                    None => None,
                };

                let entry = snapshots.get_or_put(key_str_without_suffix)?;
                if entry.found_existing {
                    continue;
                }

                *entry.value_ptr = SnapshotEntry {
                    obj: *value,
                    patch_hash,
                };
            }

            for packages_prop in e_object(&packages_obj).properties.slice() {
                let key = packages_prop
                    .key
                    .as_ref()
                    .expect("infallible: prop has key");
                let package_obj = packages_prop
                    .value
                    .as_ref()
                    .expect("infallible: prop has value");

                let Some(key_str) = as_string(key) else {
                    return Err(invalid_pnpm_lockfile());
                };

                if !package_obj.is_object() {
                    return Err(invalid_pnpm_lockfile());
                }

                // Pruned lockfiles (`turbo prune`) can leave peer-suffixed keys in `packages:`.
                let key_str = remove_suffix(key_str);
                if pkg_map.contains(key_str) {
                    continue;
                }

                // Like pnpm, a `packages:` entry without a snapshot is unreachable and ignored.
                let Some(snapshot) = snapshots.get(key_str) else {
                    continue;
                };
                let snapshot_obj = snapshot.obj;
                let snapshot_patch_hash = snapshot.patch_hash;

                let Ok((name_str, res_str)) = dependency::split_name_and_version(key_str) else {
                    return Err(invalid_pnpm_lockfile());
                };

                if strings::has_prefix_comptime(res_str, b"runtime:") {
                    continue;
                }

                let res_str = match split_registry_qualified_version(res_str) {
                    Some((registry, version)) => {
                        log.add_warning_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "pnpm-lock.yaml package '{}' is from pnpm registry '{}', resolving it from the configured registry instead",
                                bstr::BStr::new(key_str),
                                bstr::BStr::new(registry)
                            ),
                        );
                        version
                    }
                    None => res_str,
                };

                let resolution_expr: Option<Expr> = package_obj.get(b"resolution");
                if let Some(r) = &resolution_expr {
                    if !r.is_object() {
                        return Err(invalid_pnpm_lockfile());
                    }
                }

                let mut res = match resolution_from_package_entry(
                    res_str,
                    resolution_expr.as_ref(),
                    &mut sbuf!(lockfile),
                ) {
                    Ok(res) => res,
                    Err(MigratePnpmLockfileError::InvalidPnpmLockfile) => {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "pnpm-lock.yaml package '{}' has an unsupported resolution",
                                bstr::BStr::new(key_str)
                            ),
                        );
                        return Err(invalid_pnpm_lockfile());
                    }
                    Err(MigratePnpmLockfileError::PnpmLockfileGitSubdirectory) => {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "pnpm-lock.yaml package '{}' is a git sub-directory dependency (resolution.path), which bun does not support",
                                bstr::BStr::new(key_str)
                            ),
                        );
                        return Err(invalid_pnpm_lockfile());
                    }
                    Err(err) => return Err(err),
                };

                // pnpm records injected workspace packages as `name@file:<workspace dir>`.
                if res.tag == resolution::Tag::Folder {
                    let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                    let _ = path_buf.join(&[res.folder().slice(string_bytes!(lockfile))]);
                    if let Some(workspace_pkg_id) = pkg_map
                        .get(path_buf.slice())
                        .copied()
                        .filter(|id| (*id as usize) < workspace_pkgs_end)
                    {
                        let entry = pkg_map.get_or_put(key_str)?;
                        if entry.found_existing {
                            return Err(invalid_pnpm_lockfile());
                        }
                        *entry.value_ptr = workspace_pkg_id;
                        continue;
                    }
                }

                let name_hash = semver::string::Builder::string_hash(name_str);
                let name = sbuf!(lockfile).append_with_hash(name_str, name_hash)?;

                if let Some(patch_list) = snapshot_patch_hash.and_then(|hash| patches.get(hash)) {
                    if let Some(patch) = patch_list.iter().find(|patch| {
                        Dependency::split_name_and_maybe_version(&patch.key).0 == name_str
                    }) {
                        patch_join_buf.clear();
                        write!(
                            &mut patch_join_buf,
                            "{}@{}",
                            bstr::BStr::new(name_str),
                            res.fmt(string_bytes!(lockfile), bun_core::fmt::PathSep::Posix)
                        )
                        .map_err(|_| AllocError)?;
                        lockfile.patched_dependencies.put(
                            semver::string::Builder::string_hash(&patch_join_buf),
                            crate::lockfile_real::PatchedDep::with_path(patch.path),
                        )?;
                        if Dependency::split_name_and_maybe_version(&patch.key)
                            .1
                            .is_none()
                        {
                            found_patches.put(
                                &patch.key,
                                Box::from(&patch_join_buf[name_str.len() + 1..]),
                            )?;
                        }
                    }
                }

                if res.tag == resolution::Tag::Npm {
                    let registry = manager.scope_for_package_name(name_str).url.href();
                    // Registries like GitHub Packages serve tarballs off the canonical `/-/` path (pnpm/pnpm#13534).
                    let recorded = resolution_expr
                        .as_ref()
                        .and_then(|r| get_string(r, b"tarball"))
                        .map(|(url, _)| url)
                        .filter(|url| lockfile::bun_lock::url_is_under_registry(url, registry));
                    res.npm_mut().url = match recorded {
                        Some(url) => sbuf!(lockfile).append(url)?,
                        None => {
                            let url = crate::extract_tarball::build_url(
                                registry,
                                &strings::StringOrTinyString::init(
                                    name.slice(string_bytes!(lockfile)),
                                ),
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

                if let Some(integrity_expr) =
                    resolution_expr.as_ref().and_then(|r| r.get(b"integrity"))
                {
                    let Some(integrity_str) = as_string(&integrity_expr) else {
                        return Err(invalid_pnpm_lockfile());
                    };

                    pkg.meta.integrity = Integrity::parse(integrity_str);
                }

                if let Some(os_expr) = package_obj.get(b"os") {
                    pkg.meta.os = npm::negatable_from_json::<npm::OperatingSystem>(&os_expr)?;
                }
                if let Some(cpu_expr) = package_obj.get(b"cpu") {
                    pkg.meta.arch = npm::negatable_from_json::<npm::Architecture>(&cpu_expr)?;
                }
                // TODO: libc

                let (off, len) = parse_append_package_dependencies(
                    lockfile,
                    package_obj,
                    &snapshot_obj,
                    log,
                    &mut snapshot_dep_paths,
                )?;

                pkg.dependencies = ExternalSlice::new(off, len);
                pkg.resolutions = ExternalSlice::new(off, len);
                pkg.resolution = res.copy();

                let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;

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

    let mut res_buf: Vec<u8> = Vec::new();

    let dep_len = lockfile.buffers.dependencies.len();
    lockfile
        .buffers
        .resolutions
        .reserve_exact(dep_len.saturating_sub(lockfile.buffers.resolutions.len()));
    lockfile
        .buffers
        .resolutions
        .resize(dep_len, INVALID_PACKAGE_ID);

    {
        let Some(importer_versions) = importer_dep_res_versions.get(b".") else {
            return Err(invalid_pnpm_lockfile());
        };

        // resolve root dependencies first
        let root_deps = lockfile.packages.items_dependencies()[0];
        for _dep_id in root_deps.begin()..root_deps.end() {
            let dep_id: DependencyID = _dep_id;
            let dep = lockfile.buffers.dependencies[dep_id as usize].clone();
            let string_buf = string_bytes!(lockfile);

            // implicit workspace dependencies
            if dep.behavior.is_workspace() {
                let ws = *dep.version.workspace();
                let workspace_path = ws.slice(string_buf);
                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                let _ = path_buf.join(&[workspace_path]); // path-buffer overflow unreachable for bounded inputs
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
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "pnpm-lock.yaml cannot resolve root dependency '{}' - missing version in importer",
                        bstr::BStr::new(dep_name)
                    ),
                );
                return Err(MigratePnpmLockfileError::PnpmLockfileUnresolvableDependency);
            };
            if strings::has_prefix(version_maybe_alias, b"npm:") {
                version_maybe_alias = &version_maybe_alias[b"npm:".len()..];
            }
            let reference = remove_suffix(version_maybe_alias);

            if let Some(maybe_symlink_or_folder_or_workspace_path) =
                strings::without_prefix_if_possible_comptime(reference, b"link:")
            {
                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                let _ = path_buf.join(&[maybe_symlink_or_folder_or_workspace_path]); // path-buffer overflow unreachable for bounded inputs
                if let Some(pkg_id) = pkg_map.get(path_buf.slice()) {
                    lockfile.buffers.resolutions[dep_id as usize] = *pkg_id;
                    continue;
                }
            }

            write_pnpm_dep_path(&mut res_buf, dep_name, reference)?;

            let Some(pkg_id) = pkg_map.get(&res_buf) else {
                return Err(missing_package_entry(
                    log,
                    &res_buf,
                    dep_name,
                    format_args!("importer '.'"),
                ));
            };

            lockfile.buffers.resolutions[dep_id as usize] = *pkg_id;
        }
    }

    for _pkg_id in workspace_pkgs_off..workspace_pkgs_end {
        let pkg_id: PackageID = u32::try_from(_pkg_id).expect("int cast");

        let workspace_res = lockfile.packages.items_resolution()[pkg_id as usize];
        let ws = *workspace_res.workspace();
        let workspace_path = ws.slice(string_bytes!(lockfile));

        let Some(importer_versions) = importer_dep_res_versions.get(workspace_path) else {
            return Err(invalid_pnpm_lockfile());
        };

        let deps = lockfile.packages.items_dependencies()[pkg_id as usize];
        for _dep_id in deps.begin()..deps.end() {
            let dep_id: DependencyID = _dep_id;
            let dep = lockfile.buffers.dependencies[dep_id as usize].clone();
            let string_buf = string_bytes!(lockfile);
            let dep_name = dep.name.slice(string_buf);
            let Some(mut version_maybe_alias) = importer_versions.get(dep_name).map(|v| &**v)
            else {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "pnpm-lock.yaml cannot resolve workspace dependency '{}' in '{}' - missing version",
                        bstr::BStr::new(dep_name),
                        bstr::BStr::new(workspace_path)
                    ),
                );
                return Err(MigratePnpmLockfileError::PnpmLockfileUnresolvableDependency);
            };
            if strings::has_prefix(version_maybe_alias, b"npm:") {
                version_maybe_alias = &version_maybe_alias[b"npm:".len()..];
            }
            let reference = remove_suffix(version_maybe_alias);

            if let Some(maybe_symlink_or_folder_or_workspace_path) =
                strings::without_prefix_if_possible_comptime(reference, b"link:")
            {
                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                let _ = path_buf.join(&[workspace_path, maybe_symlink_or_folder_or_workspace_path]); // path-buffer overflow unreachable for bounded inputs
                if let Some(link_pkg_id) = pkg_map.get(path_buf.slice()) {
                    lockfile.buffers.resolutions[dep_id as usize] = *link_pkg_id;
                    continue;
                }
            }

            write_pnpm_dep_path(&mut res_buf, dep_name, reference)?;

            let Some(res_pkg_id) = pkg_map.get(&res_buf) else {
                return Err(missing_package_entry(
                    log,
                    &res_buf,
                    dep_name,
                    format_args!("importer '{}'", bstr::BStr::new(workspace_path)),
                ));
            };

            lockfile.buffers.resolutions[dep_id as usize] = *res_pkg_id;
        }
    }

    for _pkg_id in workspace_pkgs_end..lockfile.packages.len() {
        let pkg_id: PackageID = u32::try_from(_pkg_id).expect("int cast");

        let deps = lockfile.packages.items_dependencies()[pkg_id as usize];
        for _dep_id in deps.begin()..deps.end() {
            let dep_id: DependencyID = _dep_id;
            let dep = lockfile.buffers.dependencies[dep_id as usize].clone();
            let string_buf = string_bytes!(lockfile);
            let dep_name = dep.name.slice(string_buf);
            let mut version_maybe_alias = dep.version.literal.slice(string_buf);
            if strings::has_prefix(version_maybe_alias, b"npm:") {
                version_maybe_alias = &version_maybe_alias[b"npm:".len()..];
            }
            let reference = remove_suffix(version_maybe_alias);

            if let Some(dep_path) = snapshot_dep_paths.get(&dep_id) {
                res_buf.clear();
                res_buf.extend_from_slice(dep_path);
            } else {
                match dep.version.tag {
                    dependency::VersionTag::Folder
                    | dependency::VersionTag::Symlink
                    | dependency::VersionTag::Workspace => {
                        let maybe_symlink_or_folder_or_workspace_path =
                            strings::without_prefix(reference, b"link:");
                        let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                        let _ = path_buf.join(&[maybe_symlink_or_folder_or_workspace_path]); // path-buffer overflow unreachable for bounded inputs
                        if let Some(link_pkg_id) = pkg_map.get(path_buf.slice()) {
                            lockfile.buffers.resolutions[dep_id as usize] = *link_pkg_id;
                            continue;
                        }
                    }
                    _ => {}
                }

                write_pnpm_dep_path(&mut res_buf, dep_name, reference)?;
            }

            let Some(res_pkg_id) = pkg_map.get(&res_buf) else {
                let pkg_name = lockfile.packages.items_name()[pkg_id as usize].slice(string_buf);
                return Err(missing_package_entry(
                    log,
                    &res_buf,
                    dep_name,
                    format_args!("package '{}'", bstr::BStr::new(pkg_name)),
                ));
            };

            lockfile.buffers.resolutions[dep_id as usize] = *res_pkg_id;
        }
    }

    // pnpm records `os`/`cpu` for every `packages:` entry whose manifest
    // declares them, including `file:` folders, tarballs, and git packages.
    crate::migration::clear_non_registry_platform_constraints(lockfile);

    lockfile.resolve(log)?;

    lockfile.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration::<false>(manager)?;

    update_package_json_after_migration(manager, log, dir, &found_patches)?;

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile,
        migrated: lockfile::Migrated::Pnpm,
        serializer_result: Default::default(),
        format: lockfile::Format::Text,
    }))
}

fn invalid_pnpm_lockfile() -> MigratePnpmLockfileError {
    MigratePnpmLockfileError::InvalidPnpmLockfile
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub(crate) enum ParseAppendDependenciesError {
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

bun_core::oom_from_alloc!(ParseAppendDependenciesError);

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

/// dep -> full pnpm dep-path for aliases whose version isn't a registry version (`cfg: hi2@file:x` has no `npm:` spelling)
type SnapshotDepPaths = bun_collections::HashMap<DependencyID, Box<[u8]>>;

fn append_snapshot_dependency_version(
    lockfile: &mut Lockfile,
    reference: &[u8],
    version_buf: &mut Vec<u8>,
    aliased_dep_paths: &mut StringArrayHashMap<Box<[u8]>>,
    dep_name: &[u8],
) -> Result<(String, Option<ExternalString>), AllocError> {
    if pnpm_reference_is_dep_path(reference) {
        if let Ok((alias_str, version_str)) = dependency::split_name_and_version(reference) {
            if !version_str.first().is_some_and(u8::is_ascii_digit) {
                aliased_dep_paths.put(dep_name, Box::from(reference))?;
                return Ok((sbuf!(lockfile).append(version_str)?, None));
            }
            let alias = sbuf!(lockfile).append_external(alias_str)?;
            version_buf.clear();
            write!(version_buf, "npm:{}", bstr::BStr::new(reference)).map_err(|_| AllocError)?;
            let version = sbuf!(lockfile).append(version_buf.as_slice())?;
            return Ok((version, Some(alias)));
        }
    }
    Ok((sbuf!(lockfile).append(reference)?, None))
}

fn parse_append_package_dependencies(
    lockfile: &mut Lockfile,
    package_obj: &Expr,
    snapshot_obj: &Expr,
    log: &mut bun_ast::Log,
    snapshot_dep_paths: &mut SnapshotDepPaths,
) -> Result<(u32, u32), ParseAppendDependenciesError> {
    let mut version_buf: Vec<u8> = Vec::new();
    let mut aliased_dep_paths: StringArrayHashMap<Box<[u8]>> = StringArrayHashMap::new();

    let off = lockfile.buffers.dependencies.len();

    const SNAPSHOT_DEPENDENCY_GROUPS: [(&[u8], dependency::Behavior); 2] = [
        (b"devDependencies", dependency::Behavior::DEV),
        (b"optionalDependencies", dependency::Behavior::OPTIONAL),
    ];

    for (group_name, group_behavior) in SNAPSHOT_DEPENDENCY_GROUPS {
        if let Some(deps) = snapshot_obj.get(group_name) {
            if !deps.is_object() {
                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
            }

            for prop in e_object(&deps).properties.slice() {
                let key = prop.key.as_ref().expect("infallible: prop has key");
                let value = prop.value.as_ref().expect("infallible: prop has value");

                let Some(name_str) = as_string(key) else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let name_hash = semver::string::Builder::string_hash(name_str);
                let name = sbuf!(lockfile).append_external_with_hash(name_str, name_hash)?;

                let Some(version_str) = as_string(value) else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let version_without_suffix = remove_suffix(version_str);

                let (version, alias) = append_snapshot_dependency_version(
                    lockfile,
                    version_without_suffix,
                    &mut version_buf,
                    &mut aliased_dep_paths,
                    name_str,
                )?;
                let version_sliced = version.sliced(string_bytes!(lockfile));

                let behavior: dependency::Behavior = group_behavior;

                let dep = Dependency {
                    name: name.value,
                    name_hash,
                    behavior,
                    version: match Dependency::parse(
                        alias.map(|a| a.value).unwrap_or(name.value),
                        alias.map(|a| a.hash).unwrap_or(name.hash),
                        version_sliced.slice,
                        &version_sliced,
                        Some(&mut *log),
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
        'next_prod_dep: for prop in e_object(&deps).properties.slice() {
            let key = prop.key.as_ref().expect("infallible: prop has key");
            let value = prop.value.as_ref().expect("infallible: prop has value");

            let Some(name_str) = as_string(key) else {
                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
            };

            let name_hash = semver::string::Builder::string_hash(name_str);
            let name = sbuf!(lockfile).append_external_with_hash(name_str, name_hash)?;

            let Some(version_str) = as_string(value) else {
                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
            };

            let version_without_suffix = remove_suffix(version_str);

            let (version, alias) = append_snapshot_dependency_version(
                lockfile,
                version_without_suffix,
                &mut version_buf,
                &mut aliased_dep_paths,
                name_str,
            )?;
            let version_sliced = version.sliced(string_bytes!(lockfile));

            if let Some(peers) = package_obj.get(b"peerDependencies") {
                if !peers.is_object() {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                }

                for peer_prop in e_object(&peers).properties.slice() {
                    let Some(peer_name_str) =
                        as_string(peer_prop.key.as_ref().expect("infallible: prop has key"))
                    else {
                        return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                    };

                    let mut behavior = dependency::Behavior::PEER;

                    if strings::eql_long(name_str, peer_name_str, true) {
                        if let Some(peers_meta) = package_obj.get(b"peerDependenciesMeta") {
                            if !peers_meta.is_object() {
                                return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                            }

                            for peer_meta_prop in e_object(&peers_meta).properties.slice() {
                                let Some(peer_meta_name_str) = as_string(
                                    peer_meta_prop
                                        .key
                                        .as_ref()
                                        .expect("infallible: prop has key"),
                                ) else {
                                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                                };

                                if strings::eql_long(name_str, peer_meta_name_str, true) {
                                    let meta_obj = peer_meta_prop
                                        .value
                                        .as_ref()
                                        .expect("infallible: prop has value");
                                    if !meta_obj.is_object() {
                                        return Err(
                                            ParseAppendDependenciesError::InvalidPnpmLockfile,
                                        );
                                    }

                                    behavior.set_optional(
                                        meta_obj
                                            .get(b"optional")
                                            .and_then(|e| e.as_bool())
                                            .unwrap_or(false),
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
                                Some(&mut *log),
                                None,
                            ) {
                                Some(v) => v,
                                None => {
                                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
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
                    Some(&mut *log),
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
        let bytes = lockfile.buffers.string_bytes.as_slice();
        lockfile.buffers.dependencies[off..].sort_by(|a, b| Dependency::cmp(bytes, a, b));
    }

    if aliased_dep_paths.count() > 0 {
        let bytes = lockfile.buffers.string_bytes.as_slice();
        for (i, dep) in lockfile.buffers.dependencies[off..end].iter().enumerate() {
            if let Some(dep_path) = aliased_dep_paths.get(dep.name.slice(bytes)) {
                let dep_id = u32::try_from(off + i).expect("int cast");
                snapshot_dep_paths.put(dep_id, dep_path.clone())?;
            }
        }
    }

    Ok((
        u32::try_from(off).expect("int cast"),
        u32::try_from(end - off).expect("int cast"),
    ))
}

fn parse_append_importer_dependencies(
    lockfile: &mut Lockfile,
    manager: &mut PackageManager,
    pkg_expr: &Expr,
    log: &mut bun_ast::Log,
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

            for prop in e_object(&deps).properties.slice() {
                let key = prop.key.as_ref().expect("infallible: prop has key");
                let value = prop.value.as_ref().expect("infallible: prop has value");

                let Some(name_str) = as_string(key) else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let name_hash = semver::string::Builder::string_hash(name_str);
                let name = sbuf!(lockfile).append_external_with_hash(name_str, name_hash)?;

                let Some(specifier_expr) = value.get(b"specifier") else {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml dependency '{}' missing 'specifier' field",
                            bstr::BStr::new(name_str)
                        ),
                    );
                    return Err(ParseAppendDependenciesError::PnpmLockfileInvalidDependency);
                };

                let Some(version_expr) = value.get(b"version") else {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml dependency '{}' missing 'version' field",
                            bstr::BStr::new(name_str)
                        ),
                    );
                    return Err(ParseAppendDependenciesError::PnpmLockfileMissingDependencyVersion);
                };

                let Some(version_str) = as_string(&version_expr) else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                if strings::has_prefix_comptime(version_str, b"runtime:") {
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "pnpm-lock.yaml runtime dependency '{}@{}' is not migrated",
                            bstr::BStr::new(name_str),
                            bstr::BStr::new(version_str)
                        ),
                    );
                    continue;
                }

                let entry = importer_versions.get_or_put(name_str)?;
                if entry.found_existing {
                    continue;
                }
                *entry.value_ptr = Box::from(remove_suffix(version_str));

                let Some(specifier_str) = as_string(&specifier_expr) else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                if strings::has_prefix(specifier_str, b"catalog:") {
                    let mut catalog_group_name_str =
                        specifier_str[b"catalog:".len()..].trim_ascii();
                    if catalog_group_name_str == b"default" {
                        catalog_group_name_str = b"";
                    }
                    let catalog_group_name = sbuf!(lockfile).append(catalog_group_name_str)?;
                    // `CatalogMap::get` needs both `&mut self.catalogs` and
                    // `&self`; temporarily move catalogs out so the disjoint
                    // fields can be borrowed.
                    let catalogs = core::mem::take(&mut lockfile.catalogs);
                    let dep_result = catalogs.get(lockfile, catalog_group_name, name.value);
                    lockfile.catalogs = catalogs;
                    let Some(mut dep) = dep_result else {
                        // catalog is missing an entry in the "catalogs" object in the lockfile
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "pnpm-lock.yaml catalog '{}' missing entry for dependency '{}'",
                                bstr::BStr::new(specifier_str[b"catalog:".len()..].trim_ascii()),
                                bstr::BStr::new(name_str)
                            ),
                        );
                        return Err(ParseAppendDependenciesError::PnpmLockfileMissingCatalogEntry);
                    };

                    dep.behavior = group_behavior;

                    lockfile.buffers.dependencies.push(dep);
                    continue;
                }

                let specifier = sbuf!(lockfile).append(specifier_str)?;
                let specifier_sliced = specifier.sliced(string_bytes!(lockfile));

                let behavior: dependency::Behavior = group_behavior;

                // TODO: find peerDependencies from package.json
                let dep = Dependency {
                    name: name.value,
                    name_hash: name.hash,
                    behavior,
                    version: match Dependency::parse(
                        name.value,
                        name.hash,
                        specifier_sliced.slice,
                        &specifier_sliced,
                        Some(&mut *log),
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
        let workspace_paths_snapshot: Vec<String> = lockfile.workspace_paths.values().to_vec();
        'workspaces: for workspace_path in &workspace_paths_snapshot {
            for prop in e_object(importers_obj).properties.slice() {
                let key = prop.key.as_ref().expect("infallible: prop has key");
                let path = as_string(key).unwrap();
                if !strings::eql_long(path, workspace_path.slice(string_bytes!(lockfile)), true) {
                    continue;
                }

                let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
                let _ = path_buf.append(path); // OOM/capacity error is non-actionable here
                let _ = path_buf.append(b"package.json"); // OOM/capacity error is non-actionable here

                let workspace_pkg_json = match manager
                    .workspace_package_json_cache
                    .get_with_path(log, path_buf.slice(), Default::default())
                    .unwrap()
                {
                    Ok(j) => j,
                    Err(_) => return Err(ParseAppendDependenciesError::InvalidPnpmLockfile),
                };

                let Some((name, _)) = get_string(&workspace_pkg_json.root, b"name") else {
                    return Err(ParseAppendDependenciesError::InvalidPnpmLockfile);
                };

                let name_hash = semver::string::Builder::string_hash(name);
                let dep = Dependency {
                    name: sbuf!(lockfile).append_with_hash(name, name_hash)?,
                    name_hash,
                    behavior: dependency::Behavior::WORKSPACE,
                    version: dependency::Version {
                        tag: dependency::VersionTag::Workspace,
                        value: dependency::Value {
                            workspace: sbuf!(lockfile).append(path)?,
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
        let bytes = lockfile.buffers.string_bytes.as_slice();
        lockfile.buffers.dependencies[off..].sort_by(|a, b| Dependency::cmp(bytes, a, b));
    }

    Ok((
        u32::try_from(off).expect("int cast"),
        u32::try_from(end - off).expect("int cast"),
    ))
}

/// bun.lock keys patches by `name@version`; pnpm also allows a bare `name` key.
fn rewrite_bare_patch_keys(
    obj: &mut Expr,
    patches: &StringArrayHashMap<Box<[u8]>>,
) -> Result<(), AllocError> {
    if patches.count() == 0 {
        return Ok(());
    }
    let mut join_buf: Vec<u8> = Vec::new();
    for prop in e_object_mut(obj).properties.slice_mut() {
        let Some(key_str) = as_string(prop.key.as_ref().expect("infallible: prop has key")) else {
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
            bstr::BStr::new(&**res_str)
        )
        .map_err(|_| AllocError)?;
        // Interned into the DATA_STORE backing the cached package.json Expr tree, which outlives this fn.
        let interned: &[u8] = js_ast::data_store_dupe_str(join_buf.as_slice());
        prop.key = Some(Expr::init(E::EString::init(interned), bun_ast::Loc::EMPTY));
    }
    Ok(())
}

/// Updates package.json with workspace and catalog information after migration
fn update_package_json_after_migration(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    dir: Fd,
    patches: &StringArrayHashMap<Box<[u8]>>,
) -> Result<(), AllocError> {
    let mut pkg_json_path = bun_paths::AutoAbsPath::init_top_level_dir();
    let _ = pkg_json_path.append(b"package.json"); // OOM/capacity error is non-actionable here

    let bump = bun_alloc::Arena::new();

    let root_pkg_json = match manager
        .workspace_package_json_cache
        .get_with_path(
            log,
            pkg_json_path.slice(),
            crate::GetJsonOptions {
                guess_indentation: true,
                ..Default::default()
            },
        )
        .unwrap()
    {
        Ok(j) => j,
        Err(_) => return Ok(()),
    };

    let mut json = root_pkg_json.root;
    if !json.is_object() {
        return Ok(());
    }

    let mut needs_update = false;
    let mut moved_overrides = false;
    let mut moved_patched_deps = false;

    if let Some(mut pnpm_prop) = json.as_property(b"pnpm") {
        if pnpm_prop.expr.is_object() {
            let pnpm_obj = e_object_mut(&mut pnpm_prop.expr);

            if let Some(overrides_field) = pnpm_obj.get(b"overrides") {
                if overrides_field.is_object() {
                    if let Some(mut existing_prop) = json.as_property(b"overrides") {
                        if existing_prop.expr.is_object() {
                            let existing_overrides = e_object_mut(&mut existing_prop.expr);
                            for prop in e_object(&overrides_field).properties.slice() {
                                let Some(key) =
                                    as_string(prop.key.as_ref().expect("infallible: prop has key"))
                                else {
                                    continue;
                                };
                                existing_overrides.put(
                                    &bump,
                                    key,
                                    prop.value.expect("infallible: prop has value"),
                                )?;
                            }
                        }
                    } else {
                        e_object_mut(&mut json).put(&bump, b"overrides", overrides_field)?;
                    }
                    moved_overrides = true;
                    needs_update = true;
                }
            }

            if let Some(mut patched_field) = pnpm_obj.get(b"patchedDependencies") {
                if patched_field.is_object() {
                    rewrite_bare_patch_keys(&mut patched_field, patches)?;
                    if let Some(mut existing_prop) = json.as_property(b"patchedDependencies") {
                        if existing_prop.expr.is_object() {
                            let existing_patches = e_object_mut(&mut existing_prop.expr);
                            for prop in e_object(&patched_field).properties.slice() {
                                let Some(key) =
                                    as_string(prop.key.as_ref().expect("infallible: prop has key"))
                                else {
                                    continue;
                                };
                                existing_patches.put(
                                    &bump,
                                    key,
                                    prop.value.expect("infallible: prop has value"),
                                )?;
                            }
                        }
                    } else {
                        e_object_mut(&mut json).put(
                            &bump,
                            b"patchedDependencies",
                            patched_field,
                        )?;
                    }
                    moved_patched_deps = true;
                    needs_update = true;
                }
            }

            if moved_overrides || moved_patched_deps {
                let mut remaining_count: usize = 0;
                for prop in pnpm_obj.properties.slice() {
                    let Some(key) = as_string(prop.key.as_ref().expect("infallible: prop has key"))
                    else {
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
                    for prop in e_object(&json).properties.slice() {
                        let Some(key) =
                            as_string(prop.key.as_ref().expect("infallible: prop has key"))
                        else {
                            new_root_count += 1;
                            continue;
                        };
                        if key != b"pnpm" {
                            new_root_count += 1;
                        }
                    }

                    let mut new_root_props = G::PropertyList::init_capacity(new_root_count);
                    for prop in e_object(&json).properties.slice() {
                        let Some(key) =
                            as_string(prop.key.as_ref().expect("infallible: prop has key"))
                        else {
                            VecExt::append(&mut new_root_props, shallow_clone_prop(prop));
                            continue;
                        };
                        if key != b"pnpm" {
                            VecExt::append(&mut new_root_props, shallow_clone_prop(prop));
                        }
                    }

                    e_object_mut(&mut json).properties = new_root_props;
                } else {
                    let mut new_pnpm_props = G::PropertyList::init_capacity(remaining_count);
                    for prop in pnpm_obj.properties.slice() {
                        let Some(key) =
                            as_string(prop.key.as_ref().expect("infallible: prop has key"))
                        else {
                            VecExt::append(&mut new_pnpm_props, shallow_clone_prop(prop));
                            continue;
                        };
                        if moved_overrides && key == b"overrides" {
                            continue;
                        }
                        if moved_patched_deps && key == b"patchedDependencies" {
                            continue;
                        }
                        VecExt::append(&mut new_pnpm_props, shallow_clone_prop(prop));
                    }

                    pnpm_obj.properties = new_pnpm_props;
                }
                needs_update = true;
            }
        }
    }

    // Each `&'static [u8]` here is interned into the thread-local `DATA_STORE`
    // (see `data_store_dupe_str` below) so it shares the lifetime of the
    // `Expr` nodes it ends up backing inside the cached `root_pkg_json.root`.
    let mut workspace_paths: Option<Vec<&'static [u8]>> = None;
    let mut catalog_obj: Option<Expr> = None;
    let mut catalogs_obj: Option<Expr> = None;
    let mut workspace_overrides_obj: Option<Expr> = None;
    let mut workspace_patched_deps_obj: Option<Expr> = None;

    match sys::File::read_from(Fd::cwd(), b"pnpm-workspace.yaml") {
        Ok(contents) => 'read_pnpm_workspace_yaml: {
            // The `Vec<u8>` would drop at the end of this arm while the
            // `Expr`s it backs (catalog/catalogs/overrides/patchedDependencies
            // below) escape into `json` and the
            // `workspace_package_json_cache`. Intern the bytes into the same
            // thread-local `DATA_STORE` that owns the surrounding `Expr`
            // nodes — arena ownership, not a leak (bulk-freed on
            // `Expr::data_store_reset`).
            let contents: &'static [u8] = js_ast::data_store_dupe_str(&contents);
            let yaml_source = bun_ast::Source::init_path_string(b"pnpm-workspace.yaml", contents);
            let arena = bun_alloc::Arena::new();
            let Ok(ws_root) = bun_parsers::yaml::YAML::parse(
                &yaml_source,
                log,
                &arena,
                bun_parsers::yaml::CyclicAliases::Reject,
            ) else {
                break 'read_pnpm_workspace_yaml;
            };

            if let Some(packages_expr) = ws_root.get(b"packages") {
                if let Some(mut packages) = packages_expr.as_array() {
                    let mut paths: Vec<&'static [u8]> = Vec::new();
                    while let Some(package_path) = packages.next() {
                        if let Some(package_path_str) = as_string(&package_path) {
                            // Intern (vs. the prior `Box<[u8]>`) so the
                            // `EString` nodes built from these paths below do
                            // not dangle once this function returns and the
                            // boxes drop — they are stored into
                            // `root_pkg_json.root` which is cached in
                            // `manager.workspace_package_json_cache`.
                            paths.push(js_ast::data_store_dupe_str(package_path_str));
                        }
                    }
                    workspace_paths = Some(paths);
                }
            }

            if let Some(catalog_expr) = ws_root.get_object(b"catalog") {
                catalog_obj = Some(catalog_expr);
            }

            if let Some(catalogs_expr) = ws_root.get_object(b"catalogs") {
                catalogs_obj = Some(catalogs_expr);
            }

            if let Some(overrides_expr) = ws_root.get_object(b"overrides") {
                workspace_overrides_obj = Some(overrides_expr);
            }

            if let Some(patched_deps_expr) = ws_root.get_object(b"patchedDependencies") {
                workspace_patched_deps_obj = Some(patched_deps_expr);
            }
        }
        Err(_) => {}
    }

    let has_workspace_data =
        workspace_paths.is_some() || catalog_obj.is_some() || catalogs_obj.is_some();

    if has_workspace_data {
        let use_array_format =
            workspace_paths.is_some() && catalog_obj.is_none() && catalogs_obj.is_none();

        let existing_workspaces = e_object(&json).get(b"workspaces");
        let is_object_workspaces = existing_workspaces
            .as_ref()
            .map(|e| e.is_object())
            .unwrap_or(false);

        if use_array_format {
            let paths = workspace_paths.as_ref().unwrap();
            let mut items = js_ast::ExprNodeList::init_capacity(paths.len());
            for path in paths {
                VecExt::append(
                    &mut items,
                    Expr::init(E::EString::init(path), bun_ast::Loc::EMPTY),
                );
            }
            let array = Expr::init(
                E::Array {
                    items,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
            e_object_mut(&mut json).put(&bump, b"workspaces", array)?;
            needs_update = true;
        } else if is_object_workspaces {
            let mut existing_workspaces = existing_workspaces.unwrap();
            let ws_obj = e_object_mut(&mut existing_workspaces);

            if let Some(paths) = &workspace_paths {
                if !paths.is_empty() {
                    let mut items = js_ast::ExprNodeList::init_capacity(paths.len());
                    for path in paths {
                        VecExt::append(
                            &mut items,
                            Expr::init(E::EString::init(path), bun_ast::Loc::EMPTY),
                        );
                    }
                    let array = Expr::init(
                        E::Array {
                            items,
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    );
                    ws_obj.put(&bump, b"packages", array)?;

                    needs_update = true;
                }
            }

            if let Some(catalog) = catalog_obj {
                ws_obj.put(&bump, b"catalog", catalog)?;
                needs_update = true;
            }

            if let Some(catalogs) = catalogs_obj {
                ws_obj.put(&bump, b"catalogs", catalogs)?;
                needs_update = true;
            }
        } else if !use_array_format {
            let mut ws_props = bun_alloc::AstAlloc::vec();

            if let Some(paths) = &workspace_paths {
                if !paths.is_empty() {
                    let mut items = js_ast::ExprNodeList::init_capacity(paths.len());
                    for path in paths {
                        VecExt::append(
                            &mut items,
                            Expr::init(E::EString::init(path), bun_ast::Loc::EMPTY),
                        );
                    }
                    let value = Expr::init(
                        E::Array {
                            items,
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    );
                    let key = Expr::init(E::EString::init(b"packages"), bun_ast::Loc::EMPTY);

                    VecExt::append(
                        &mut ws_props,
                        G::Property {
                            key: Some(key),
                            value: Some(value),
                            ..Default::default()
                        },
                    );
                }
            }

            if let Some(catalog) = catalog_obj {
                let key = Expr::init(E::EString::init(b"catalog"), bun_ast::Loc::EMPTY);
                VecExt::append(
                    &mut ws_props,
                    G::Property {
                        key: Some(key),
                        value: Some(catalog),
                        ..Default::default()
                    },
                );
            }

            if let Some(catalogs) = catalogs_obj {
                let key = Expr::init(E::EString::init(b"catalogs"), bun_ast::Loc::EMPTY);
                VecExt::append(
                    &mut ws_props,
                    G::Property {
                        key: Some(key),
                        value: Some(catalogs),
                        ..Default::default()
                    },
                );
            }

            if ws_props.len_u32() > 0 {
                let workspace_obj = Expr::init(
                    E::Object {
                        properties: ws_props,
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                );
                e_object_mut(&mut json).put(&bump, b"workspaces", workspace_obj)?;
                needs_update = true;
            }
        }
    }

    // Handle overrides from pnpm-workspace.yaml
    if let Some(ws_overrides) = &workspace_overrides_obj {
        if ws_overrides.is_object() {
            if let Some(mut existing_prop) = json.as_property(b"overrides") {
                if existing_prop.expr.is_object() {
                    let existing_overrides = e_object_mut(&mut existing_prop.expr);
                    for prop in e_object(ws_overrides).properties.slice() {
                        let Some(key) =
                            as_string(prop.key.as_ref().expect("infallible: prop has key"))
                        else {
                            continue;
                        };
                        existing_overrides.put(
                            &bump,
                            key,
                            prop.value.expect("infallible: prop has value"),
                        )?;
                    }
                }
            } else {
                e_object_mut(&mut json).put(&bump, b"overrides", *ws_overrides)?;
            }
            needs_update = true;
        }
    }

    // Handle patchedDependencies from pnpm-workspace.yaml
    if let Some(ws_patched) = &mut workspace_patched_deps_obj {
        if ws_patched.is_object() {
            rewrite_bare_patch_keys(ws_patched, patches)?;
            if let Some(mut existing_prop) = json.as_property(b"patchedDependencies") {
                if existing_prop.expr.is_object() {
                    let existing_patches = e_object_mut(&mut existing_prop.expr);
                    for prop in e_object(ws_patched).properties.slice() {
                        let Some(key) =
                            as_string(prop.key.as_ref().expect("infallible: prop has key"))
                        else {
                            continue;
                        };
                        existing_patches.put(
                            &bump,
                            key,
                            prop.value.expect("infallible: prop has value"),
                        )?;
                    }
                }
            } else {
                e_object_mut(&mut json).put(&bump, b"patchedDependencies", *ws_patched)?;
            }
            needs_update = true;
        }
    }

    if needs_update {
        let mut buffer_writer = bun_js_printer::BufferWriter::init();
        buffer_writer.append_newline = !root_pkg_json.source.contents().is_empty()
            && root_pkg_json.source.contents()[root_pkg_json.source.contents().len() - 1] == b'\n';
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

        root_pkg_json.source.contents = std::borrow::Cow::Owned(
            package_json_writer
                .ctx
                .written_without_trailing_zero()
                .to_vec(),
        );

        // Write the updated package.json
        let _ = sys::File::write_file(
            dir,
            bun_core::zstr!("package.json"),
            root_pkg_json.source.contents(),
        );
    }

    Ok(())
}
