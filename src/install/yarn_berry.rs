//! yarn 2+ ("berry") `yarn.lock` migration. A pin bun cannot keep fails it, with the reason logged.

use bun_alloc::AllocError;
use bun_ast::{E, Expr, ExprData};
use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::strings;
use bun_semver as semver;
use bun_semver::String;
use bun_sys::Fd;

use crate::bin::Bin;
use crate::dependency::{self, Behavior, Dependency, DependencyExt as _, VersionTag};
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{self, LoadResult, LoadResultOk, Lockfile};
use crate::lockfile_real::package::workspace_map::{MissingWorkspace, WorkspaceMap};
use crate::lockfile_real::package_extensions::{self, Kind as ExtensionKind};
use crate::lockfile_real::reachable;
use crate::migration::{
    as_str, get_str, parse_manifest_bin, props, push_workspace_dependency, record_workspace, sbuf,
    string_bytes, string_hash, take_appended_dependencies,
};
use crate::npm;
use crate::package_manager_real::add_remove_with_filter::WorkspaceTarget;
use crate::package_manager_real::package_json_write_back;
use crate::package_manager_real::update_package_json_and_install::save_entry;
use crate::pnpm::e_object_mut;
use crate::repository::Repository;
use crate::resolution::{Resolution, Tag as ResolutionTag, TaggedValue};
use crate::versioned_url::VersionedURLType;
use crate::{
    DependencyID, Error, GetJsonOptions, INVALID_PACKAGE_ID, PackageID, PackageManager,
    PackageNameHash, WorkspacePackageJsonCacheEntry,
};

mod builtin_extensions;

macro_rules! bail {
    ($log:expr, $($message:tt)*) => {
        return Err(invalid_lockfile($log, format_args!($($message)*)))
    };
}

#[cold]
#[inline(never)]
fn invalid_lockfile(log: &mut bun_ast::Log, args: core::fmt::Arguments<'_>) -> Error {
    log.add_error_fmt(None, bun_ast::Loc::EMPTY, args);
    Error::InvalidYarnBerryLockfile
}

fn shown(text: &[u8]) -> impl core::fmt::Display + '_ {
    bun_core::fmt::for_terminal(bstr::BStr::new(text))
}

/// Yarn reads every scalar as a string, but Bun's parser gives plain scalars a type (`2.10` becomes
/// the number 2.1). This returns the original text.
pub(crate) fn scalar_text(source: &[u8], expr: &Expr) -> Option<&'static [u8]> {
    if let Some(s) = as_str(expr) {
        return Some(s);
    }
    if !matches!(
        expr.data,
        ExprData::ENumber(_) | ExprData::EBoolean(_) | ExprData::ENull(_)
    ) {
        return None;
    }
    let rest = source.get(usize::try_from(expr.loc.start).ok()?..)?;
    let text = &rest[..strings::index_of_any(rest, b" \t\r\n:,]}").unwrap_or(rest.len())];
    // an alias (`*a`), a tagged scalar (`!!int 1`) and an empty value have no scalar text at `loc`
    let plain = !text.is_empty()
        && text
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.' | b'~'));
    plain.then(|| bun_ast::data_store_dupe_str(text))
}

/// Returns a key that appears twice in a mapping. Yarn keeps the last value, and `Expr::get`
/// returns the first.
fn duplicate_key(
    source: &[u8],
    expr: &Expr,
    depth: u8,
) -> Result<Option<&'static [u8]>, AllocError> {
    let mut seen: StringArrayHashMap<()> = StringArrayHashMap::new();
    for (key, value) in props(expr) {
        if let Some(key) = scalar_text(source, key)
            && seen.get_or_put(key)?.found_existing
        {
            return Ok(Some(key));
        }
        if depth > 0
            && let Some(key) = duplicate_key(source, value, depth - 1)?
        {
            return Ok(Some(key));
        }
    }
    Ok(None)
}

/// Bun's YAML parser expands `<<` merge keys. Yarn reads them as ordinary keys and never writes
/// them.
fn may_hold_merge_key(data: &[u8]) -> bool {
    if strings::contains(data, b"<<") {
        return true;
    }
    let mut rest = data;
    while let Some(i) = strings::index_of_char_usize(rest, b'\\') {
        rest = &rest[i + 1..];
        let hex_len = match rest.first() {
            Some(b'x') => 2,
            Some(b'u') => 4,
            Some(b'U') => 8,
            Some(b'\n' | b'\r') => return true,
            _ => continue,
        };
        let Some(hex) = rest.get(1..1 + hex_len) else {
            continue;
        };
        let code = hex.iter().try_fold(0u32, |n, &c| {
            bun_core::fmt::hex_digit_value(c).map(|v| n * 16 + u32::from(v))
        });
        if code == Some(u32::from(b'<')) {
            return true;
        }
    }
    false
}

/// Text with a malformed escape is returned as written. It won't match anything in the lockfile.
fn decoded_or_as_written(s: &[u8]) -> Vec<u8> {
    bun_url::PercentEncoding::decode_alloc(s).map_or_else(|_| s.to_vec(), Vec::from)
}

/// `name@rest`, keeping a leading scope `@`.
fn split_locator(spec: &[u8]) -> Option<(&[u8], &[u8])> {
    let from = usize::from(spec.first() == Some(&b'@'));
    let i = strings::index_of_char_usize(&spec[from..], b'@')? + from;
    Some((&spec[..i], &spec[i + 1..]))
}

/// (key, decoded value) of a reference's `::key=value&...`
type Params<'a> = [(&'a [u8], Vec<u8>)];

/// `npm:1.2.3::__archiveUrl=...` -> (`npm:1.2.3`, params)
fn split_reference_params(reference: &[u8]) -> (&[u8], Vec<(&[u8], Vec<u8>)>) {
    let Some((head, tail)) = strings::split_once(reference, b"::") else {
        return (reference, Vec::new());
    };
    let params = strings::split(tail, b"&")
        .filter_map(|kv| strings::split_once_char(kv, b'='))
        .map(|(k, v)| (k, decoded_or_as_written(v)))
        .collect();
    (head, params)
}

fn param<'a>(params: &'a Params<'_>, key: &[u8]) -> Option<&'a [u8]> {
    params
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.as_slice())
}

/// An RFC 3986 `scheme:` prefix (`npm:`, `workspace:`, `git+ssh:`, ...), not `@scope/x` or `1.2.3`.
fn has_protocol(spec: &[u8]) -> bool {
    match strings::index_of_char_usize(spec, b':') {
        Some(i) if i > 0 => {
            spec[0].is_ascii_alphabetic()
                && spec[..i]
                    .iter()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.'))
        }
        _ => false,
    }
}

/// Turns `npm:^1.2.3` into `^1.2.3`. The alias `npm:other@^1` is returned unchanged. A range never
/// contains `@`.
fn strip_npm_protocol(spec: &[u8]) -> &[u8] {
    let Some(rest) = spec.strip_prefix(b"npm:") else {
        return spec;
    };
    let is_alias = split_locator(rest).is_some_and(|(n, _)| !n.is_empty());
    if is_alias { spec } else { rest }
}

/// `os=darwin & cpu=arm64`, `(os=linux | os=win32) & cpu=x64`, `... & libc=glibc`
fn parse_conditions(cond: &[u8]) -> (npm::OperatingSystem, npm::Architecture, npm::Libc) {
    let mut os = npm::Negatable::<npm::OperatingSystem>::default();
    let mut cpu = npm::Negatable::<npm::Architecture>::default();
    let mut libc: Option<npm::Negatable<npm::Libc>> = None;
    for alt in strings::split_any(cond, b"&|") {
        let alt: &[u8] = strings::trim(alt, b" ()\t");
        if let Some(v) = alt.strip_prefix(b"os=") {
            os.apply(v);
        } else if let Some(v) = alt.strip_prefix(b"cpu=") {
            cpu.apply(v);
        } else if let Some(v) = alt.strip_prefix(b"libc=") {
            libc.get_or_insert_default().apply(v);
        }
    }
    let libc = libc.map_or(npm::Libc::NONE, |libc| libc.combine());
    (os.combine(), cpu.combine(), libc)
}

/// Returns `name@<resolution>`, or `None` for a package that Bun installs from a project folder and
/// can't patch.
fn patched_dependency_key(
    lockfile: &Lockfile,
    name: &[u8],
    package_id: PackageID,
) -> Option<Vec<u8>> {
    use ResolutionTag as Tag;
    let res = lockfile.packages.items_resolution()[package_id as usize];
    if matches!(
        res.tag,
        Tag::Root | Tag::Workspace | Tag::Folder | Tag::Symlink
    ) {
        return None;
    }
    let res = res.fmt(string_bytes!(lockfile), bun_core::fmt::PathSep::Posix);
    Some(format!("{}@{}", bstr::BStr::new(name), res).into_bytes())
}

type Ranges = Vec<(Box<[u8]>, Box<[u8]>)>;

#[derive(Default)]
struct YarnRc {
    /// catalog group ("" for the default `catalog:`) -> name -> range
    catalogs: StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>,
    /// `npmRegistryServer`
    registry: Option<Box<[u8]>>,
    /// `npmScopes.<scope>.npmRegistryServer`, keyed without the `@`
    scope_registries: StringArrayHashMap<Box<[u8]>>,
    /// yarn.lock has entries for what `packageExtensions` name, but not the edges.
    extensions: Vec<PackageExtension>,
    /// `enableTransparentWorkspaces`. Unless it's false, a range that a workspace's version
    /// satisfies resolves to that workspace.
    transparent_workspaces: Option<bool>,
}

/// A boolean setting as yarn reads it from the environment or a quoted value.
fn yarn_bool(value: &[u8]) -> Option<bool> {
    match value {
        b"true" | b"1" => Some(true),
        b"false" | b"0" => Some(false),
        _ => None,
    }
}

struct PackageExtension {
    /// `name@range`, as written
    key: Box<[u8]>,
    dependencies: Ranges,
    peer_dependencies: Ranges,
    /// The names with `peerDependenciesMeta.<name>.optional: true`.
    optional_peers: Vec<Box<[u8]>>,
}

/// The first value found wins: `YARN_*` variables, then the rc file of the project, of each parent
/// folder, and of the home folder.
fn read_yarnrc(log: &mut bun_ast::Log, manager: &PackageManager) -> Result<YarnRc, Error> {
    let env = |key: &[u8]| -> Option<&[u8]> {
        manager
            .env
            .as_ref()
            .and_then(|env| env.get().get(key))
            .filter(|v| !v.is_empty())
    };
    let mut out = YarnRc {
        registry: env(b"YARN_NPM_REGISTRY_SERVER").map(Box::from),
        transparent_workspaces: env(b"YARN_ENABLE_TRANSPARENT_WORKSPACES").and_then(yarn_bool),
        ..Default::default()
    };
    let rc_name = env(b"YARN_RC_FILENAME").unwrap_or(b".yarnrc.yml");
    let home = bun_core::env_var::HOME
        .get_not_empty()
        .map(strings::without_trailing_slash);

    let mut folder: &[u8] =
        strings::without_trailing_slash(crate::bun_fs::FileSystem::instance().top_level_dir());
    let mut in_project = true;
    let mut read_home = false;
    loop {
        read_yarnrc_file(log, &mut out, folder, rc_name, in_project)?;
        in_project = false;
        read_home |= home == Some(folder);
        match bun_paths::dirname(folder) {
            Some(parent) if parent.len() < folder.len() => {
                folder = strings::without_trailing_slash(parent);
            }
            _ => break,
        }
    }
    if let (Some(home), false) = (home, read_home) {
        read_yarnrc_file(log, &mut out, home, rc_name, false)?;
    }
    // Every rule is copied to package.json, so the next install has to parse it the same way.
    let YarnRc {
        extensions,
        catalogs,
        ..
    } = &mut out;
    for extension in extensions {
        let added = (extension.dependencies.iter_mut()).chain(&mut extension.peer_dependencies);
        for (name, range) in added {
            if let Some(group) = range.strip_prefix(b"catalog:") {
                // a package of the registry has no catalog to read it from
                let Some(in_catalog) = catalogs.get(group).and_then(|g| g.get(&**name)) else {
                    bail!(
                        log,
                        "packageExtensions \"{}\" in .yarnrc.yml adds \"{}@{}\", but the catalog has no \"{}\"",
                        shown(&extension.key),
                        shown(name),
                        shown(range),
                        shown(name),
                    );
                };
                range.clone_from(in_catalog);
            }
            // package.json would parse `npm:^1` as an alias for a package named `^1`
            *range = Box::from(strip_npm_protocol(range));
        }
    }
    for (key, rule) in props(&extensions_object(&out.extensions)) {
        let key = as_str(key).unwrap_or(b"");
        if let Some(problem) = package_extensions::rule_problem(key, rule) {
            bail!(
                log,
                "packageExtensions \"{}\" in .yarnrc.yml: {}",
                shown(key),
                problem
            );
        }
    }
    Ok(out)
}

fn read_yarnrc_file(
    log: &mut bun_ast::Log,
    out: &mut YarnRc,
    folder: &[u8],
    rc_name: &[u8],
    in_project: bool,
) -> Result<(), Error> {
    let path = [folder, b"/", rc_name].concat();
    let data = match bun_sys::File::read_from(Fd::cwd(), &path) {
        Ok(data) => data,
        Err(err) if matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            return Ok(());
        }
        Err(_) => bail!(log, "could not read {}", shown(&path)),
    };
    let source = bun_ast::Source::init_path_string(path.as_slice(), data.as_slice());
    let arena = bun_alloc::Arena::new();
    // The parser's messages point into `path` and `data`, which `log` outlives.
    let mut parse_log = bun_ast::Log::init();
    let Ok(root) = bun_parsers::yaml::YAML::parse(
        &source,
        &mut parse_log,
        &arena,
        bun_parsers::yaml::CyclicAliases::Reject,
    ) else {
        bail!(log, "{} is not valid YAML", shown(&path));
    };

    if in_project {
        let mut add_group = |group: &[u8], obj: &Expr| -> Result<(), AllocError> {
            if !obj.is_object() {
                return Ok(());
            }
            let entry = out.catalogs.get_or_put(group)?;
            if !entry.found_existing {
                *entry.value_ptr = StringArrayHashMap::new();
            }
            let map = &mut *entry.value_ptr;
            obj.try_for_each_property(|name, _, value| -> Result<(), AllocError> {
                if let Some(range) = scalar_text(&data, &value) {
                    // Yarn allows `npm:^1.0.0` here. In a Bun catalog that would be an alias.
                    map.put(name, Box::from(strip_npm_protocol(range)))?;
                }
                Ok(())
            })
        };
        if let Some(catalog) = root.get(b"catalog") {
            add_group(b"", &catalog)?;
        }
        if let Some(catalogs) = root.get(b"catalogs") {
            catalogs.try_for_each_property(|group, _, value| add_group(group, &value))?;
        }
    }

    for (key, value) in props(&root.get(b"packageExtensions").unwrap_or_default()) {
        let Some(key) = scalar_text(&data, key) else {
            continue;
        };
        if out.extensions.iter().any(|e| &*e.key == key) {
            continue;
        }
        let ranges_of = |group: &[u8]| -> Ranges {
            props(&value.get(group).unwrap_or_default())
                .filter_map(|(name, range)| {
                    let (name, range) = (scalar_text(&data, name)?, scalar_text(&data, range)?);
                    Some((Box::from(name), Box::from(range)))
                })
                .collect()
        };
        out.extensions.push(PackageExtension {
            key: Box::from(key),
            dependencies: ranges_of(b"dependencies"),
            peer_dependencies: ranges_of(b"peerDependencies"),
            optional_peers: optional_names(&data, value, b"peerDependenciesMeta")
                .into_iter()
                .map(Box::from)
                .collect(),
        });
    }

    if out.transparent_workspaces.is_none() {
        out.transparent_workspaces = root.get(b"enableTransparentWorkspaces").and_then(|v| {
            v.as_bool()
                .or_else(|| scalar_text(&data, &v).and_then(yarn_bool))
        });
    }

    let registry_of = |owner: &Expr| -> Option<Box<[u8]>> {
        get_str(owner, b"npmRegistryServer")
            .filter(|url| !url.is_empty())
            .map(Box::from)
    };
    if out.registry.is_none() {
        out.registry = registry_of(&root);
    }
    for (scope, value) in props(&root.get(b"npmScopes").unwrap_or_default()) {
        if let (Some(scope), Some(url)) = (as_str(scope), registry_of(value))
            && !out.scope_registries.contains(scope)
        {
            out.scope_registries.put(scope, url)?;
        }
    }
    Ok(())
}

/// `source` is a `&`-separated list of `~/x.patch` (relative to the project) and `./x.patch`
/// (relative to `locator`). Builtin patches are skipped.
fn project_patch_paths(source: &[u8], params: &Params<'_>) -> Option<Vec<Vec<u8>>> {
    let mut paths = Vec::new();
    for one in strings::split(source, b"&") {
        let one = one.strip_prefix(b"optional!").unwrap_or(one);
        if one.is_empty() || strings::contains(one, b"builtin<") {
            continue;
        }
        if let Some(rest) = one.strip_prefix(b"~/") {
            paths.push(rest.to_vec());
        } else if bun_paths::is_absolute(one) {
            paths.push(one.to_vec());
        } else {
            paths.push(join_folder(&owner_dir(params)?, one));
        }
    }
    Some(paths)
}

/// Splits `<percent-encoded locator>#<source>::params` into the decoded locator, the decoded
/// source, and the params.
fn decode_patch_spec(rest: &[u8]) -> (Vec<u8>, Vec<u8>, Vec<(&[u8], Vec<u8>)>) {
    let (spec, params) = split_reference_params(rest);
    let (inner, source) = strings::split_once_char(spec, b'#').unwrap_or((spec, &b""[..]));
    (
        decoded_or_as_written(inner),
        decoded_or_as_written(source),
        params,
    )
}

/// Returns the key for `locator_to_entry`: the locator without `::params`, percent-decoded. A
/// nested `patch:` is encoded twice.
fn locator_key(name: &[u8], reference: &[u8]) -> Vec<u8> {
    let (head, _) = split_reference_params(reference);
    [name, b"@", &decoded_or_as_written(head)].concat()
}

/// `file:./x#./x` -> (`file:`, `./x`), also for `portal:` and `link:`
fn split_folder_protocol(head: &[u8]) -> Option<(&'static [u8], &[u8])> {
    let (protocol, path) = [b"file:".as_slice(), b"portal:", b"link:"]
        .into_iter()
        .find_map(|p| head.strip_prefix(p).map(|rest| (p, rest)))?;
    Some((
        protocol,
        strings::split_once_char(path, b'#').map_or(path, |(p, _)| p),
    ))
}

/// Returns the folder of a decoded `::locator=` value. `name@workspace:path` gives `path`, and
/// `name@portal:./p::locator=<owner>` gives `<owner dir>/p`.
fn locator_dir(locator: &[u8], depth: u8) -> Option<Vec<u8>> {
    let (_, reference) = split_locator(locator)?;
    if let Some(path) = reference.strip_prefix(b"workspace:") {
        return Some(path.to_vec());
    }
    let (head, params) = split_reference_params(reference);
    let (_, path) = split_folder_protocol(head)?;
    if Dependency::is_tarball(path) {
        return None;
    }
    let base = match param(&params, b"locator") {
        Some(owner) if depth < 16 => locator_dir(owner, depth + 1)?,
        Some(_) => return None,
        None => Vec::new(),
    };
    Some(join_folder(&base, path))
}

/// Returns the folder that a reference's relative paths start from: its `::locator=` package, or
/// else the project root.
fn owner_dir(params: &Params<'_>) -> Option<Vec<u8>> {
    param(params, b"locator").map_or(Some(Vec::new()), |owner| locator_dir(owner, 0))
}

/// Joins the paths the way the folder resolver stores them: `.` and `..` resolved, with `/`
/// separators on every platform.
fn join_folder(base: &[u8], path: &[u8]) -> Vec<u8> {
    use bun_paths::resolve_path::{join_string_buf, platform};
    if bun_paths::is_absolute(path) {
        return path.to_vec();
    }
    let mut buf = bun_paths::path_buffer_pool::get();
    if base.len() + path.len() + 2 > buf.len() {
        // The result is longer than any valid path, so the install will report the folder as
        // missing.
        return [base, b"/", path].concat();
    }
    let mut joined = join_string_buf::<platform::Auto>(&mut buf[..], &[base, path]).to_vec();
    if cfg!(windows) {
        bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(&mut joined);
    }
    joined
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    Workspace,
    Package,
    /// A `patch:` locator. It shares the package id of the locator that it patches.
    Patch,
}

struct Entry {
    kind: EntryKind,
    expr: Expr,
    name: &'static [u8],
    /// text after `name@` in `resolution`
    reference: &'static [u8],
    package_id: PackageID,
}

/// (the dependency, its package.json range that bun reads differently, what `yarn_only_range_for_bun` makes of it)
type Rewrites = Vec<(Box<[u8]>, Box<[u8]>, Box<[u8]>)>;

fn add_rewrite(rewrites: &mut Rewrites, name: &[u8], spec: &[u8], new_spec: &[u8]) {
    let is_there =
        |(of, from, _): &(Box<[u8]>, Box<[u8]>, Box<[u8]>)| &**of == name && &**from == spec;
    if !rewrites.iter().any(is_there) {
        rewrites.push((Box::from(name), Box::from(spec), Box::from(new_spec)));
    }
}

/// Yarn's descriptor range of a manifest dependency, where bun reads another one.
#[derive(Default)]
struct OriginalSpecs {
    by_dependency: bun_collections::HashMap<DependencyID, Box<[u8]>>,
    /// Dependencies that are in several groups with different ranges. Yarn installs one range for
    /// the name, and Bun reads each group.
    in_several_groups: Vec<DependencyID>,
}

struct Workspace {
    /// relative to the project root, posix separators
    path: Box<[u8]>,
    name: Box<[u8]>,
    package_id: PackageID,
    rewrites: Rewrites,
}

fn package_json<'a>(
    manager: &'a mut PackageManager,
    log: &mut bun_ast::Log,
    abs_path: &[u8],
    options: GetJsonOptions,
) -> Result<&'a mut WorkspacePackageJsonCacheEntry, Error> {
    manager
        .workspace_package_json_cache
        .get_with_path(log, abs_path, options)
        .unwrap()
        .map_err(|_| Error::InvalidPackageJSON)
}

pub(crate) fn migrate_yarn_berry_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
) -> Result<LoadResult<'a>, Error> {
    this.init_empty();
    crate::initialize_store();
    bun_core::analytics::Features::yarn_migration_inc(1);

    let silent = manager.options.log_level.is_silent();

    if may_hold_merge_key(data) {
        bail!(
            log,
            "yarn.lock has a \"<<\" merge key, which yarn and bun read differently"
        );
    }
    // The nodes are allocated in `arena`, because later package.json reads reset the thread-local
    // `Store`.
    let source = bun_ast::Source::init_path_string(b"yarn.lock", data);
    let arena = bun_alloc::Arena::new();
    let mut allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let parsed = {
        let _scope = allocator.enter();
        bun_parsers::yaml::YAML::parse(
            &source,
            log,
            &arena,
            bun_parsers::yaml::CyclicAliases::Reject,
        )
    };
    let Ok(root) = parsed else {
        bail!(log, "yarn.lock is not valid YAML");
    };
    if !matches!(root.data, ExprData::EObject(_)) {
        bail!(log, "yarn.lock must be a YAML mapping");
    }
    let Some(version) = root
        .get(b"__metadata")
        .and_then(|m| m.get(b"version"))
        .and_then(|v| scalar_text(data, &v))
    else {
        bail!(log, "yarn.lock is missing __metadata.version");
    };
    // 4 is yarn 2.0's lockfile and 10 is the newest (yarn 4)
    if !matches!(version, b"4" | b"5" | b"6" | b"7" | b"8" | b"9" | b"10") {
        bail!(log, "yarn.lock version {} is not supported", shown(version));
    }
    if let Some(key) = duplicate_key(data, &root, 3)? {
        bail!(
            log,
            "yarn.lock has the key \"{}\" more than once in one mapping",
            shown(key)
        );
    }

    let yarnrc = read_yarnrc(log, manager)?;

    // `catalog:` ranges must resolve while this install parses package.json.
    for (group, names) in yarnrc.catalogs.iter() {
        let group: &[u8] = group;
        for (dep_name_str, range) in names.iter() {
            let dep_name_str: &[u8] = dep_name_str;
            let dep_name = sbuf!(this).append_external(dep_name_str)?;
            let version = sbuf!(this).append(range)?;
            let sliced = version.sliced(string_bytes!(this));
            let Some(parsed) = Dependency::parse(
                dep_name.value,
                dep_name.hash,
                sliced.slice,
                &sliced,
                Some(&mut *log),
                None,
            ) else {
                continue;
            };
            let dep = Dependency {
                name: dep_name.value,
                name_hash: dep_name.hash,
                version: parsed,
                behavior: Behavior::default(),
            };
            let group_str = sbuf!(this).append(group)?;
            let buf = this.buffers.string_bytes.as_slice();
            let map = this.catalogs.get_or_put_group(buf, group_str)?;
            let ctx = semver::string::ArrayHashContext {
                arg_buf: buf,
                existing_buf: buf,
            };
            let entry = map.get_or_put_adapted(&dep_name.value, &ctx)?;
            *entry.key_ptr = dep_name.value;
            *entry.value_ptr = dep;
        }
    }

    // -- 1. index the lockfile entries -------------------------------------
    let mut entries: Vec<Entry> = Vec::with_capacity(root.property_count());
    // descriptor as yarn writes it ("name@npm:^1") -> entry
    let mut descriptor_to_entry: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // locator without `::params` ("name@npm:1.2.3") -> entry
    let mut locator_to_entry: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // workspace path in the lockfile -> entry
    let mut lockfile_workspaces: StringArrayHashMap<usize> = StringArrayHashMap::new();

    for (key, value) in props(&root) {
        let Some(key) = scalar_text(data, key) else {
            bail!(log, "yarn.lock has a key that is not a string");
        };
        if key == b"__metadata" {
            continue;
        }
        if !value.is_object() {
            bail!(log, "yarn.lock entry \"{}\" is not a mapping", shown(key));
        }
        let Some(resolution) = get_str(value, b"resolution") else {
            bail!(log, "yarn.lock entry \"{}\" has no resolution", shown(key));
        };
        let Some((name, reference)) = split_locator(resolution).filter(|(n, _)| !n.is_empty())
        else {
            bail!(
                log,
                "yarn.lock entry \"{}\" has an invalid resolution \"{}\"",
                shown(key),
                shown(resolution)
            );
        };
        let idx = entries.len();
        let kind = if let Some(path) = reference.strip_prefix(b"workspace:") {
            lockfile_workspaces.put(path, idx)?;
            EntryKind::Workspace
        } else if reference.starts_with(b"patch:") {
            EntryKind::Patch
        } else {
            EntryKind::Package
        };
        entries.push(Entry {
            kind,
            expr: *value,
            name,
            reference,
            package_id: INVALID_PACKAGE_ID,
        });
        // Yarn splits on `,` and the spaces around it, so a space at the end of the key is kept.
        let descriptors: Vec<&[u8]> = strings::split(key, b",").collect();
        for (n, desc) in descriptors.iter().enumerate() {
            let mut desc: &[u8] = desc;
            if n > 0 {
                desc = strings::trim_left(desc, b" ");
            }
            if n + 1 < descriptors.len() {
                desc = strings::trim_right(desc, b" ");
            }
            if desc.is_empty() {
                continue;
            }
            let e = descriptor_to_entry.get_or_put(desc)?;
            if e.found_existing {
                bail!(
                    log,
                    "yarn.lock has more than one entry for \"{}\"",
                    shown(desc)
                );
            }
            *e.value_ptr = idx;
        }
        locator_to_entry.put(&locator_key(name, reference), idx)?;
    }

    let Some(&root_entry) = lockfile_workspaces.get(b".") else {
        bail!(
            log,
            "yarn.lock has no root workspace entry (\"@workspace:.\")"
        );
    };

    // -- 2. root + workspaces from disk ---------------------------------------
    let mut root_json_path = bun_paths::AutoAbsPath::init_top_level_dir();
    let _ = root_json_path.append(b"package.json"); // capacity error is non-actionable
    let root_json = package_json(manager, log, root_json_path.slice(), Default::default())?;
    // `process_names_array` resolves globs relative to the source's directory.
    let (root_manifest, root_source) = (root_json.root, root_json.source.clone());
    let mut workspace_map = WorkspaceMap::init();
    workspace_map.process_manifest(
        &mut manager.workspace_package_json_cache,
        log,
        &root_manifest,
        &root_source,
        MissingWorkspace::Skip,
    )?;

    let mut workspaces: Vec<Workspace> = Vec::with_capacity(workspace_map.count());
    for (path, ws) in workspace_map.keys().iter().zip(workspace_map.values()) {
        record_workspace(this, &ws.name, path, ws.version.as_deref())?;
        workspaces.push(Workspace {
            path: path.clone(),
            name: ws.name.clone(),
            package_id: INVALID_PACKAGE_ID,
            rewrites: Vec::new(),
        });
    }
    for (path, _) in lockfile_workspaces.iter() {
        let path: &[u8] = path;
        if path != b"." && workspace_map.get(path).is_none() {
            bail!(
                log,
                "yarn.lock workspace \"{}\" is not one of the package.json \"workspaces\"",
                shown(path)
            );
        }
    }

    // The rules in file order, as (parent, `name[@range]`, target). Yarn skips the ones it can't
    // parse.
    let mut resolutions: Vec<(Option<Parent>, &[u8], &[u8])> = Vec::new();
    for (k, v) in props(&root_manifest.get(b"resolutions").unwrap_or_default()) {
        if let (Some(k), Some(v)) = (as_str(k), as_str(v))
            && let Some((parent, pattern)) = resolution_key_parts(k)
        {
            resolutions.push((parent, pattern, v));
        }
    }

    // package.json already has what `bun add` or `bun update` asks for. These are skipped here so
    // that they get resolved.
    let requested: Vec<(&[u8], Vec<u8>)> = manager
        .update_requests
        .iter()
        .map(|r| (r.name, r.version.literal.slice(r.version_buf()).to_vec()))
        .collect();
    let being_added = |name: &[u8], spec: &[u8]| -> bool {
        requested.iter().any(|(requested_name, literal)| {
            if requested_name.is_empty() {
                &literal[..] == name || &literal[..] == spec
            } else {
                *requested_name == name
            }
        }) && [&b"@"[..], b"@npm:"]
            .iter()
            .all(|sep| !descriptor_to_entry.contains(&[name, sep, spec].concat()))
    };

    let mut root_rewrites: Rewrites = Vec::new();
    let mut original_specs = OriginalSpecs::default();
    // bun gets a patch through `patchedDependencies` and the pinned range as the override
    for (_, pattern, target) in &resolutions {
        let name = Dependency::split_name_and_maybe_version(pattern).0;
        if let Some(new_spec) = yarn_only_range_for_bun(name, target) {
            add_rewrite(&mut root_rewrites, name, target, &new_spec);
        }
    }

    {
        let mut pkg = lockfile::Package::default();
        if let Some(name) = get_str(&root_manifest, b"name") {
            pkg.name_hash = string_hash(name);
            pkg.name = sbuf!(this).append_with_hash(name, pkg.name_hash)?;
        }
        append_manifest_dependencies(
            this,
            log,
            &mut pkg,
            &root_manifest,
            Some(&workspaces),
            &mut root_rewrites,
            &mut original_specs,
            &being_added,
        )?;
        pkg.meta.id = 0;
        pkg.resolution = Resolution::init_root();
        if let Some(bin) = root_manifest.get(b"bin") {
            pkg.bin = Bin::parse_append(&bin, &mut sbuf!(this), &mut this.buffers.extern_strings)?;
        }
        let hash = pkg.name_hash;
        this.packages.append(pkg)?;
        this.get_or_put_id(0, hash)?;
        entries[root_entry].package_id = 0;
    }

    for ws in workspaces.iter_mut() {
        let mut json_path = bun_paths::AutoAbsPath::init_top_level_dir();
        let _ = json_path.join(&[&ws.path, b"package.json"]); // bounded input
        let manifest = package_json(manager, log, json_path.slice(), Default::default())?.root;
        let name_hash = string_hash(&ws.name);
        let mut pkg = lockfile::Package {
            name: sbuf!(this).append_with_hash(&ws.name, name_hash)?,
            name_hash,
            resolution: Resolution::init(TaggedValue::Workspace(sbuf!(this).append(&ws.path)?)),
            ..Default::default()
        };
        append_manifest_dependencies(
            this,
            log,
            &mut pkg,
            &manifest,
            None,
            &mut ws.rewrites,
            &mut original_specs,
            &being_added,
        )?;
        parse_manifest_bin(this, &mut pkg, &manifest)?;
        ws.package_id = this.append_package_dedupe(&mut pkg)?;
        if let Some(&idx) = lockfile_workspaces.get(&ws.path) {
            entries[idx].package_id = ws.package_id;
        }
    }

    // -- 3. third-party packages -----------------------------------------------
    let mut entry_of_package: Vec<Option<usize>> = Vec::new();
    for i in 0..entries.len() {
        if entries[i].kind != EntryKind::Package {
            continue;
        }
        let entry_expr = entries[i].expr;
        let name = entries[i].name;
        let reference = entries[i].reference;
        let name_hash = string_hash(name);
        let (head, params) = split_reference_params(reference);

        let resolution: Resolution = if let Some(version) = head.strip_prefix(b"npm:") {
            // `resolution` always has the real package's name, never an alias.
            let version_str = sbuf!(this).append(version)?;
            let parsed = semver::Version::parse(version_str.sliced(string_bytes!(this)));
            if !parsed.valid || parsed.wildcard != semver::query::token::Wildcard::None {
                bail!(
                    log,
                    "yarn.lock entry \"{}\" has an invalid version",
                    shown(reference)
                );
            }
            let version = parsed.version.min();
            let url = match param(&params, b"__archiveUrl") {
                Some(url) => {
                    let configured =
                        registry_without_auth(manager.scope_for_package_name(name).url.href());
                    // The integrity comes from the registry Bun is configured with. If Yarn uses a
                    // different one, report that.
                    if !lockfile::bun_lock::url_is_under_registry(url, &configured) {
                        registry_for(manager, log, &yarnrc, name)?;
                    }
                    sbuf!(this).append(url)?
                }
                None => {
                    let registry = registry_for(manager, log, &yarnrc, name)?;
                    let url = crate::extract_tarball::build_url(
                        &registry,
                        &strings::StringOrTinyString::init(name),
                        version,
                        string_bytes!(this),
                    )?;
                    sbuf!(this).append(url)?
                }
            };
            Resolution::init(TaggedValue::Npm(VersionedURLType { version, url }))
        } else if let Some((protocol, path)) = split_folder_protocol(head) {
            // relative to the package that declared it (`::locator=name@workspace:path`)
            let Some(base) = owner_dir(&params) else {
                bail!(
                    log,
                    "yarn.lock entry \"{}@{}\" is a path inside a package that is not a folder of the project",
                    shown(name),
                    shown(reference),
                );
            };
            let joined = join_folder(&base, path);
            if protocol == b"link:" {
                Resolution::init_symlink(
                    sbuf!(this).append(&dependency::link_path_for_lockfile(&joined))?,
                )
            } else if Dependency::is_tarball(&joined) {
                Resolution::init(TaggedValue::LocalTarball(sbuf!(this).append(&joined)?))
            } else {
                if protocol == b"portal:" && !silent {
                    bun_core::warn!(
                        "migrating \"{}@portal:{}\" as \"file:{}\": folder is copied, not linked (make it a workspace to keep it linked)",
                        shown(name),
                        shown(path),
                        shown(&joined),
                    );
                }
                Resolution::init(TaggedValue::Folder(sbuf!(this).append(&joined)?))
            }
        } else if is_git_reference(head) {
            git_resolution(this, log, name, head)?
        } else if head.starts_with(b"https://") || head.starts_with(b"http://") {
            Resolution::init(TaggedValue::RemoteTarball(sbuf!(this).append(head)?))
        } else {
            // exec:, custom protocols from plugins, ...
            bail!(
                log,
                "yarn.lock entry \"{}@{}\" uses a protocol bun does not support",
                shown(name),
                shown(reference),
            );
        };

        let mut pkg = lockfile::Package {
            name: sbuf!(this).append_with_hash(name, name_hash)?,
            name_hash,
            resolution,
            ..Default::default()
        };
        let extended = extensions_of(&yarnrc, &descriptor_to_entry, data, name, &entry_expr);
        let added =
            append_entry_dependencies(this, log, &mut pkg, data, name, &entry_expr, &extended)?;
        if let Some(bin) = entry_expr.get(b"bin") {
            pkg.bin = Bin::parse_append(&bin, &mut sbuf!(this), &mut this.buffers.extern_strings)?;
        }
        if let Some(cond) = get_str(&entry_expr, b"conditions") {
            (pkg.meta.os, pkg.meta.arch, pkg.meta.libc) = parse_conditions(cond);
        }
        let pid = this.append_package_dedupe(&mut pkg)?;
        entries[i].package_id = pid;
        this.record_package_extensions(pid, &added);
        if entry_of_package.len() <= pid as usize {
            entry_of_package.resize(pid as usize + 1, None);
        }
        entry_of_package[pid as usize] = Some(i);
    }

    // A patch can wrap another patch, so repeat until every chain has reached a package.
    let mut patched: Vec<(Vec<u8>, Vec<u8>)> = Vec::new(); // ("name@version", patch path)
    let mut stacked: Vec<(Vec<u8>, usize, Vec<u8>)> = Vec::new(); // ("name@version", files, the first)
    let mut patched_packages: bun_collections::HashMap<PackageID, ()> = Default::default();
    let mut pending: Vec<usize> = (0..entries.len())
        .filter(|&i| entries[i].kind == EntryKind::Patch)
        .collect();
    loop {
        let before = pending.len();
        let mut still_pending = Vec::new();
        for &i in &pending {
            let name = entries[i].name;
            let (inner, source, params) =
                decode_patch_spec(&entries[i].reference[b"patch:".len()..]);
            // the inner locator may itself carry ::params
            let (inner_name, inner_reference) = split_locator(&inner).unwrap_or((name, &inner[..]));
            let inner_key = locator_key(inner_name, inner_reference);
            let Some(&inner_idx) = locator_to_entry.get(&inner_key) else {
                bail!(
                    log,
                    "yarn.lock patch \"{}\" patches \"{}\", which is not in the lockfile",
                    shown(entries[i].reference),
                    shown(&inner_key),
                );
            };
            let pid = entries[inner_idx].package_id;
            if pid == INVALID_PACKAGE_ID {
                if entries[inner_idx].kind == EntryKind::Patch {
                    still_pending.push(i);
                }
                continue;
            }
            entries[i].package_id = pid;
            patched_packages.insert(pid, ());
            let paths = project_patch_paths(&source, &params);
            let outside = match &paths {
                None => Some(&source),
                Some(paths) => paths.iter().find(|p| {
                    p.is_empty()
                        || p.as_slice() == b"."
                        || strings::contains_char(p, 0)
                        || bun_paths::is_absolute(p)
                        || strings::split_any(p, b"/\\").any(|part| part == b"..")
                }),
            };
            if let Some(path) = outside {
                bail!(
                    log,
                    "yarn.lock patch file \"{}\" is not a file inside the project",
                    shown(path)
                );
            }
            let mut paths = paths.unwrap_or_default();
            if paths.is_empty() {
                continue;
            }
            let Some(key) = patched_dependency_key(this, entries[inner_idx].name, pid) else {
                bail!(
                    log,
                    "yarn.lock patches \"{}\" with \"{}\"; bun does not patch packages installed from a project folder",
                    shown(entries[inner_idx].name),
                    shown(&paths[0]),
                );
            };
            if paths.len() > 1 {
                if !stacked.iter().any(|(k, _, _)| *k == key) {
                    stacked.push((key, paths.len(), paths.swap_remove(0)));
                }
                continue;
            }
            // several descriptors / `resolutions` selectors can point at one patch entry
            let path = paths.swap_remove(0);
            match patched.iter().find(|(k, _)| *k == key) {
                None => patched.push((key, path)),
                Some((_, existing)) if *existing != path => {
                    bail!(
                        log,
                        "yarn.lock patches \"{}\" with both \"{}\" and \"{}\"; bun applies one patch per package",
                        shown(&key),
                        shown(existing),
                        shown(&path),
                    );
                }
                Some(_) => {}
            }
        }
        if still_pending.is_empty() || still_pending.len() == before {
            break;
        }
        pending = still_pending;
    }
    match stacked.as_slice() {
        [] => {}
        [(key, count, first)] => {
            bail!(
                log,
                "yarn.lock patches \"{}\" with {} files (\"{}\", ...); bun applies one patch per package — merge them into one file",
                shown(key),
                count,
                shown(first),
            );
        }
        several => {
            let names: Vec<std::string::String> = (several.iter())
                .map(|(key, count, _)| format!("\"{}\" with {}", shown(key), count))
                .collect();
            bail!(
                log,
                "yarn.lock applies several patch files to {} packages ({}). bun supports one per package, merge them",
                several.len(),
                names.join(", "),
            );
        }
    }

    // -- 4. bind dependency edges ---------------------------------------------
    let dep_count = this.buffers.dependencies.len();
    this.buffers.resolutions.clear();
    this.buffers
        .resolutions
        .resize(dep_count, INVALID_PACKAGE_ID);
    let mut key: Vec<u8> = Vec::with_capacity(128);
    // yarn binds the target of a `resolutions` rule to the root workspace
    let mut root_locator = Vec::new();
    for part in [entries[root_entry].name, b"@workspace:."] {
        strings::percent_encode_uri_component(part, &mut root_locator);
    }

    for pkg_id in 0..this.packages.len() {
        // this package's yarn locator, as (name, reference)
        let owner: Option<(Vec<u8>, Vec<u8>)> = {
            let res = this.packages.items_resolution()[pkg_id];
            let ws_path: Option<&[u8]> = match res.tag {
                ResolutionTag::Root => Some(b"."),
                ResolutionTag::Workspace => Some(res.workspace().slice(string_bytes!(this))),
                _ => None,
            };
            match ws_path {
                // yarn names an unnamed workspace itself (`root-workspace-0b6124`)
                Some(path) => {
                    let ws_name: &[u8] = match lockfile_workspaces.get(path) {
                        Some(&idx) => entries[idx].name,
                        None => this.packages.items_name()[pkg_id].slice(string_bytes!(this)),
                    };
                    Some((ws_name.to_vec(), [b"workspace:", path].concat()))
                }
                None => entry_of_package
                    .get(pkg_id)
                    .copied()
                    .flatten()
                    .map(|idx| (entries[idx].name.to_vec(), entries[idx].reference.to_vec())),
            }
        };
        let owner_name = owner.as_ref().map_or(&b""[..], |(n, _)| n);
        // relative protocols (`file:`, `portal:`, `link:`) are keyed by the declaring package
        let owner_locator: Option<Vec<u8>> = owner.as_ref().map(|(name, reference)| {
            let mut locator = Vec::new();
            for part in [&name[..], b"@", reference] {
                strings::percent_encode_uri_component(part, &mut locator);
            }
            locator
        });
        let is_patched = patched_packages.contains_key(&(pkg_id as PackageID));

        let deps = this.packages.items_dependencies()[pkg_id];
        for dep_id in deps.begin()..deps.end() {
            let dep = this.buffers.dependencies[dep_id as usize].clone();
            // The range yarn installs for the name can be the `catalog:` of another group.
            let yarn_range = original_specs.by_dependency.get(&dep_id);
            let catalog = match yarn_range.and_then(|range| range.strip_prefix(b"catalog:")) {
                Some(group) => Some(sbuf!(this).append(group)?),
                None if yarn_range.is_none() && dep.version.tag == VersionTag::Catalog => {
                    Some(*dep.version.catalog())
                }
                None => None,
            };
            let name = dep.name.slice(string_bytes!(this));
            let original_literal = dep.version.literal.slice(string_bytes!(this));
            // `catalog:` -> the catalog's range, which is what yarn keyed the entry by
            let catalog_range: Option<Vec<u8>> = catalog.and_then(|group| {
                this.catalogs
                    .get(this, group, dep.name)
                    .map(|d| d.version.literal.slice(string_bytes!(this)).to_vec())
            });
            let literal: &[u8] = catalog_range
                .as_deref()
                .or_else(|| yarn_range.map(|range| &**range))
                .unwrap_or(original_literal);

            let lookup = |key: &[u8]| -> Option<usize> { descriptor_to_entry.get(key).copied() };

            // Like in Yarn, the first matching rule in file order wins, before any descriptor
            // lookup.
            let rule = if dep.behavior.is_peer() || dep.behavior.is_workspace() {
                None
            } else {
                resolutions.iter().find(|(parent, pattern, _)| {
                    parent.as_ref().is_none_or(|p| {
                        owner.as_ref().is_some_and(|(owner_name, reference)| {
                            p.name == &owner_name[..]
                                && (p.range.is_empty()
                                    || (!is_patched
                                        && if has_protocol(p.range) {
                                            p.range == &reference[..]
                                        } else {
                                            reference.strip_prefix(b"npm:") == Some(p.range)
                                        }))
                        })
                    }) && resolution_pattern_matches(pattern, name, original_literal, literal)
                })
            };

            let mut found: Option<usize>;
            if let Some((_, _, target)) = rule {
                found = resolution_target_entry(name, target, &root_locator, &descriptor_to_entry);
            } else {
                // 1. exactly as written (workspace:, patch:, npm: aliases, URLs)
                key.clear();
                key.extend_from_slice(name);
                key.push(b'@');
                key.extend_from_slice(literal);
                found = lookup(&key);
                // 2. how yarn normalizes a bare range / tag
                if found.is_none() && !has_protocol(literal) {
                    key.truncate(name.len() + 1);
                    if dep.version.tag == VersionTag::Github && !literal.starts_with(b"github:") {
                        key.extend_from_slice(b"github:");
                        key.extend_from_slice(literal);
                    } else {
                        key.extend_from_slice(b"npm:");
                        key.extend_from_slice(if literal.is_empty() { b"*" } else { literal });
                    }
                    found = lookup(&key);
                }
                // 3. relative protocols (file:, portal:, link:) are keyed per declaring package
                if let (None, Some(owner)) = (found, &owner_locator) {
                    let rewritten_from = range_before_rewrite(literal);
                    found = core::iter::once(literal)
                        .chain(rewritten_from.as_deref())
                        .find_map(|range| {
                            lookup(&[name, b"@", range, b"::locator=", owner].concat())
                        });
                }
                // 4. workspaces by name (root -> workspace edges, any `workspace:` range)
                if found.is_none()
                    && (dep.behavior.is_workspace() || dep.version.tag == VersionTag::Workspace)
                {
                    if let Some(ws_path) = this.workspace_paths.get(&dep.name_hash) {
                        let ws_path = ws_path.slice(string_bytes!(this));
                        if let Some(ws) = workspaces.iter().find(|w| &*w.path == ws_path) {
                            this.buffers.resolutions[dep_id as usize] = ws.package_id;
                            continue;
                        }
                    }
                }
                // 5. a range without a key that a workspace's version satisfies, as yarn without asking the registry
                if found.is_none()
                    && dep.version.tag == VersionTag::Npm
                    && !dep.behavior.is_peer()
                    && yarnrc.transparent_workspaces != Some(false)
                {
                    let npm = dep.version.npm();
                    let linked = lockfile::linked_workspace_path(
                        manager.options.link_workspace_packages,
                        &this.workspace_paths,
                        &this.workspace_versions,
                        string_hash(npm.name.slice(string_bytes!(this))),
                        &npm.version,
                        string_bytes!(this),
                    );
                    if let Some(ws_path) = linked {
                        let ws_path = ws_path.slice(string_bytes!(this));
                        if let Some(ws) = workspaces.iter().find(|w| &*w.path == ws_path) {
                            this.buffers.resolutions[dep_id as usize] = ws.package_id;
                            continue;
                        }
                    }
                }
            }

            match found.map(|i| entries[i].package_id) {
                Some(pid) if pid != INVALID_PACKAGE_ID => {
                    let mut pid = pid;
                    let mut bound = this.packages.items_resolution()[pid as usize];
                    // Bun links every workspace into the root's node_modules under its name.
                    if pkg_id == 0
                        && !dep.behavior.is_workspace()
                        && !dep.behavior.is_peer()
                        && bound.tag != ResolutionTag::Workspace
                    {
                        if let Some(ws_path) = this.workspace_paths.get(&dep.name_hash) {
                            let ws_path = ws_path.slice(string_bytes!(this));
                            // a path to the workspace's own folder is the workspace
                            let same_folder = match bound.tag {
                                ResolutionTag::Folder => {
                                    bound.folder().slice(string_bytes!(this)) == ws_path
                                }
                                ResolutionTag::Symlink => {
                                    bound.symlink().slice(string_bytes!(this))
                                        == &*dependency::link_path_for_lockfile(ws_path)
                                }
                                _ => false,
                            };
                            match workspaces.iter().find(|w| &*w.path == ws_path) {
                                Some(ws) if same_folder => {
                                    pid = ws.package_id;
                                    bound = this.packages.items_resolution()[pid as usize];
                                }
                                _ => {
                                    bail!(
                                        log,
                                        "\"{}\" is a workspace, and yarn.lock pins the root package's \"{}@{}\" to a package that is not that workspace; bun installs the workspace in its place",
                                        shown(name),
                                        shown(name),
                                        shown(original_literal),
                                    );
                                }
                            }
                        }
                    }
                    if original_specs.in_several_groups.contains(&dep_id) {
                        // this edge's own range, which bun reads (of its catalog), has to accept what yarn locked
                        let own = match dep.version.tag {
                            VersionTag::Catalog => this
                                .catalogs
                                .get(this, *dep.version.catalog(), dep.name)
                                .map(|d| d.version),
                            _ => Some(dep.version.clone()),
                        };
                        let accepted = match (own.as_ref().map(|v| v.tag), bound.tag) {
                            (Some(VersionTag::Npm), ResolutionTag::Npm) => {
                                own.as_ref().is_some_and(|v| {
                                    v.npm().version.satisfies(
                                        bound.npm().version,
                                        string_bytes!(this),
                                        string_bytes!(this),
                                    )
                                })
                            }
                            (Some(VersionTag::Workspace), ResolutionTag::Workspace)
                            | (Some(VersionTag::DistTag), ResolutionTag::Npm) => true,
                            _ => false,
                        };
                        if !accepted {
                            bail!(
                                log,
                                "\"{}\" is in several dependency groups of \"{}\": yarn uses \"{}\" for all, but yarn.lock version does not satisfy \"{}\"",
                                shown(name),
                                shown(owner_name),
                                shown(literal),
                                shown(original_literal),
                            );
                        }
                    }
                    this.buffers.resolutions[dep_id as usize] = pid;
                }
                // a peer is bound at install time, to a package another edge brought in
                _ if dep.behavior.is_peer() || dep.behavior.is_workspace() => {}
                _ => {
                    bail!(
                        log,
                        "yarn.lock missing \"{}@{}\", a dependency of \"{}\"",
                        shown(name),
                        shown(original_literal),
                        shown(owner_name),
                    );
                }
            }
        }
    }

    crate::migration::clear_non_registry_platform_constraints(this);

    this.tag_workspace_links(manager.options.link_workspace_packages);
    if this.resolve(log).is_err() {
        return Err(Error::LockfileResolveFailed);
    }

    // bins and os/cpu that older lockfiles did not record, and tarball integrity
    this.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration(
        manager, true, // update_os_cpu
        true, // fill_integrity
        None,
    )?;
    // Without an integrity, a tarball that an edge reaches would be installed unverified.
    let reached = reachable::packages(this, &this.buffers.resolutions, reachable::Options::all(0));
    for (pid, res) in this.packages.items_resolution().iter().enumerate() {
        if reached.is_set(pid)
            && res.tag == ResolutionTag::Npm
            && !this.packages.items_meta()[pid].integrity.tag.is_supported()
        {
            let name = this.packages.items_name()[pid].slice(string_bytes!(this));
            let url = res.npm().url.slice(string_bytes!(this));
            let configured = registry_without_auth(manager.scope_for_package_name(name).url.href());
            if !url.is_empty() && !lockfile::bun_lock::url_is_under_registry(url, &configured) {
                bail!(
                    log,
                    "yarn.lock fetches \"{}@{}\" from {}, outside the configured registry ({}): cannot get integrity",
                    shown(name),
                    res.fmt(string_bytes!(this), bun_core::fmt::PathSep::Posix),
                    shown(url),
                    bun_core::fmt::redacted_npm_url(&configured),
                );
            }
            bail!(
                log,
                "could not get the integrity of \"{}@{}\" from the registry",
                shown(name),
                res.fmt(string_bytes!(this), bun_core::fmt::PathSep::Posix),
            );
        }
    }

    // -- 5. package.json edits ----------------------------------------------------
    for (key, path) in &patched {
        let path = sbuf!(this).append(path)?;
        this.patched_dependencies
            .put(string_hash(key), lockfile::PatchedDep::with_path(path))?;
    }
    // The edits are made to the cached package.json trees, root first, which is also the order
    // they're written in.
    let mut edited: Vec<(WorkspaceTarget, Vec<&'static str>)> = Vec::new();
    if let Some(changed) = edit_package_json(
        manager,
        log,
        root_json_path.slice(),
        &root_rewrites,
        &patched,
        Some(&yarnrc),
    )? {
        edited.push((WorkspaceTarget::root(), changed));
    }
    for ws in &workspaces {
        let mut json_path = bun_paths::AutoAbsPath::init_top_level_dir();
        let _ = json_path.join(&[&ws.path, b"package.json"]); // bounded input
        if let Some(changed) =
            edit_package_json(manager, log, json_path.slice(), &ws.rewrites, &[], None)?
        {
            let target = WorkspaceTarget {
                name: ws.name.clone(),
                name_hash: Some(string_hash(&ws.name)),
                package_json_path: json_path.slice().into(),
            };
            edited.push((target, changed));
        }
    }
    // This comes after the `patch:` values are rewritten, so that the next install doesn't see them
    // as changed.
    let keep_store = GetJsonOptions {
        init_reset_store: false,
        ..Default::default()
    };
    if let Ok(root_json) = package_json(manager, log, root_json_path.slice(), keep_store) {
        let (source, json) = (root_json.source.clone(), root_json.root);
        crate::migration::parse_root_overrides(this, manager, log, &source, json, &workspace_map)?;
    }

    for (target, changed) in edited {
        package_json_write_back::record_migrated(manager, target, changed);
    }

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile: this,
        migrated: lockfile::Migrated::Yarn,
        serializer_result: Default::default(),
        format: lockfile::Format::Text,
    }))
}

/// A registry that yarn's configuration names for the package has to be the one bun uses.
fn registry_for(
    manager: &PackageManager,
    log: &mut bun_ast::Log,
    yarnrc: &YarnRc,
    name: &[u8],
) -> Result<Vec<u8>, Error> {
    let configured = registry_without_auth(manager.scope_for_package_name(name).url.href());
    let scope = (name.first() == Some(&b'@')).then(|| npm::registry::Scope::get_name(name));
    let from_yarn: Option<&[u8]> = match scope.and_then(|s| yarnrc.scope_registries.get(s)) {
        Some(url) => Some(&**url),
        // yarn's builtin default for the `@jsr` scope
        None if scope == Some(b"jsr".as_slice()) => Some(b"https://npm.jsr.io"),
        None => yarnrc.registry.as_deref(),
    };
    let Some(url) = from_yarn else {
        return Ok(configured);
    };
    // yarn substitutes `${VAR}` in rc values
    if strings::contains(url, b"${") {
        bail!(
            log,
            "yarn's registry for \"{}\" uses an environment variable (\"{}\"); bun cannot tell if it is the registry bun is configured with",
            shown(name),
            bun_core::fmt::redacted_npm_url(url),
        );
    }
    let same = |a: &[u8], b: &[u8]| {
        lockfile::bun_lock::url_is_under_registry(a, b)
            && lockfile::bun_lock::url_is_under_registry(b, a)
    };
    // yarn's default registry serves the same packages as the npm registry
    let canonical = |url: &'_ [u8]| -> Vec<u8> {
        let url = registry_without_auth(url);
        if same(&url, b"https://registry.yarnpkg.com") {
            npm::Registry::DEFAULT_URL.as_bytes().to_vec()
        } else {
            url
        }
    };
    if same(&canonical(url), &canonical(&configured)) {
        return Ok(configured);
    }
    bail!(
        log,
        "yarn fetches \"{}\" from {} and bun is configured to fetch it from {}; add the registry to bunfig.toml or .npmrc",
        shown(name),
        bun_core::fmt::redacted_npm_url(url),
        bun_core::fmt::redacted_npm_url(&configured),
    )
}

/// Returns the URL without `user:password@`, because the tarball URLs built from it are written to
/// bun.lock.
pub(crate) fn registry_without_auth(href: &[u8]) -> Vec<u8> {
    let url = bun_url::URL::parse(href);
    if url.username.is_empty() && url.password.is_empty() {
        href.to_vec()
    } else {
        url.href_without_auth().into_vec()
    }
}

/// Yarn always locks git dependencies with `#commit=<sha>`. The prefixes cover hand-edited files.
fn is_git_reference(head: &[u8]) -> bool {
    let url = strings::split_once_char(head, b'#').map_or(head, |(url, _)| url);
    strings::contains(head, b"#commit=")
        || [
            b"git+".as_slice(),
            b"git://",
            b"github:",
            b"ssh://",
            b"git@",
        ]
        .iter()
        .any(|p| head.starts_with(p))
        || ((url.starts_with(b"https://") || url.starts_with(b"http://")) && url.ends_with(b".git"))
}

/// Handles `github:o/r#commit=sha` and `[git+]<url>#commit=sha`, pinned to the commit that Yarn
/// locked.
fn git_resolution(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    name: &[u8],
    head: &[u8],
) -> Result<Resolution, Error> {
    let (url, fragment) = strings::split_once_char(head, b'#').unwrap_or((head, &b""[..]));
    let mut commit = fragment;
    for kv in strings::split(fragment, b"&") {
        if let Some(c) = kv.strip_prefix(b"commit=") {
            commit = c;
        } else if kv.starts_with(b"workspace=") || kv.starts_with(b"cwd=") {
            bail!(
                log,
                "yarn.lock entry \"{}@{}\" is a package inside a git repository, which bun does not support",
                shown(name),
                shown(head),
            );
        }
    }
    let repo = match url.strip_prefix(b"github:") {
        Some(gh) => sbuf!(this).append(&[b"https://github.com/", gh, b".git"].concat())?,
        None => sbuf!(this).append(url.strip_prefix(b"git+").unwrap_or(url))?,
    };
    // `resolved` is the checked-out commit. A branch or tag is left for the install to resolve.
    let is_sha = commit.len() == 40 && commit.iter().all(u8::is_ascii_hexdigit);
    Ok(Resolution::init(TaggedValue::Git(Repository {
        owner: String::default(),
        repo,
        committish: sbuf!(this).append(commit)?,
        resolved: if is_sha {
            sbuf!(this).append(commit)?
        } else {
            String::default()
        },
        package_name: sbuf!(this).append(name)?,
    })))
}

struct Parent<'a> {
    name: &'a [u8],
    range: &'a [u8],
}

/// Parses `[parent[@range]/]name[@range]`. Returns `None` for keys that Yarn ignores: globs, and
/// keys with more than one parent.
fn resolution_key_parts(key: &[u8]) -> Option<(Option<Parent<'_>>, &[u8])> {
    fn next_segment(rest: &[u8]) -> (&[u8], &[u8]) {
        let scope = match rest.first() {
            Some(&b'@') => strings::index_of_char_usize(rest, b'/').map_or(rest.len(), |i| i + 1),
            _ => 0,
        };
        match strings::index_of_char_usize(&rest[scope..], b'/') {
            Some(i) => (&rest[..scope + i], &rest[scope + i + 1..]),
            None => (rest, &b""[..]),
        }
    }
    if key.starts_with(b"*/") || key.starts_with(b"**/") {
        return None;
    }
    let (first, rest) = next_segment(key);
    if rest.is_empty() {
        return (!first.is_empty()).then_some((None, first));
    }
    let (descriptor, extra) = next_segment(rest);
    if first.is_empty() || descriptor.is_empty() || !extra.is_empty() {
        return None;
    }
    let (name, range) = split_locator(first).unwrap_or((first, &b""[..]));
    Some((Some(Parent { name, range }), descriptor))
}

/// Matches `name`, `name@<literal>` and `name@npm:<literal>`. The literal is compared as written
/// and as its catalog's range.
fn resolution_pattern_matches(
    pattern: &[u8],
    name: &[u8],
    original_literal: &[u8],
    literal: &[u8],
) -> bool {
    let Some(rest) = pattern.strip_prefix(name) else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    let Some(range) = rest.strip_prefix(b"@") else {
        return false;
    };
    // `name@npm:other@^1` refers to an alias as written. `name@npm:^1` and `name@^1` are the same
    // range.
    let plain = range.strip_prefix(b"npm:").unwrap_or(range);
    [original_literal, literal]
        .iter()
        .any(|literal| range == *literal || plain == strip_npm_protocol(literal))
}

/// Yarn normalizes a rule's value and binds it to the root workspace. The resulting descriptor is a
/// key in yarn.lock.
fn resolution_target_entry(
    name: &[u8],
    target: &[u8],
    root_locator: &[u8],
    descriptor_to_entry: &StringArrayHashMap<usize>,
) -> Option<usize> {
    let rewritten_from = range_before_rewrite(target);
    let spellings = [
        Some((&b""[..], target)),
        (!has_protocol(target)).then_some((&b"npm:"[..], target)),
        rewritten_from.as_deref().map(|range| (&b""[..], range)),
    ];
    spellings.into_iter().flatten().find_map(|(prefix, rest)| {
        let mut key = [name, b"@", prefix, rest].concat();
        if let Some(&i) = descriptor_to_entry.get(&key) {
            return Some(i);
        }
        // relative protocols carry the workspace they are bound to
        key.extend_from_slice(b"::locator=");
        key.extend_from_slice(root_locator);
        descriptor_to_entry.get(&key).copied()
    })
}

/// Returns the names under `dependenciesMeta` or `peerDependenciesMeta` that have `optional: true`.
pub(crate) fn optional_names(source: &[u8], entry: &Expr, meta_key: &[u8]) -> Vec<&'static [u8]> {
    props(&entry.get(meta_key).unwrap_or_default())
        .filter(|(_, v)| v.get(b"optional").and_then(|e| e.as_bool()) == Some(true))
        .filter_map(|(k, _)| scalar_text(source, k))
        .collect()
}

/// The dependencies that `packageExtensions` add to one entry.
#[derive(Default)]
struct Extended<'a> {
    dependencies: Vec<(&'a [u8], &'a [u8])>,
    peer_dependencies: Vec<(&'a [u8], &'a [u8])>,
    optional_peers: Vec<&'a [u8]>,
    /// From Yarn's builtin list. Nothing in package.json corresponds to these, so they're kept as
    /// the package's own dependencies.
    builtin_dependencies: Vec<(&'a [u8], &'a [u8])>,
    builtin_optional_peers: Vec<&'a [u8]>,
}

/// Returns the dependencies that were added because of `extended`.
fn append_entry_dependencies(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    pkg: &mut lockfile::Package,
    source: &[u8],
    entry_name: &[u8],
    entry: &Expr,
    extended: &Extended<'_>,
) -> Result<Vec<(PackageNameHash, ExtensionKind)>, Error> {
    let mut added = Vec::new();
    let mut add = |name: &[u8], kind: ExtensionKind| added.push((string_hash(name), kind));
    let off = this.buffers.dependencies.len();
    let optional_deps: Vec<&[u8]> = optional_names(source, entry, b"dependenciesMeta");
    let mut optional_peers: Vec<&[u8]> = optional_names(source, entry, b"peerDependenciesMeta");
    for &name in &extended.builtin_optional_peers {
        if !optional_peers.contains(&name) {
            optional_peers.push(name);
        }
    }
    let own_optional_peers = optional_peers.len();
    for &name in &extended.optional_peers {
        if !optional_peers.contains(&name) {
            optional_peers.push(name);
        }
    }
    for (group, behavior, optional) in [
        (b"dependencies".as_slice(), Behavior::PROD, &optional_deps),
        (
            b"peerDependencies".as_slice(),
            Behavior::PEER,
            &optional_peers,
        ),
    ] {
        for (k, v) in props(&entry.get(group).unwrap_or_default()) {
            let (Some(name), Some(spec)) = (scalar_text(source, k), scalar_text(source, v)) else {
                bail!(
                    log,
                    "yarn.lock entry \"{}\" has a dependency that is not a string",
                    shown(entry_name)
                );
            };
            let mut behavior = behavior;
            if optional.contains(&name) {
                if behavior.is_peer() {
                    behavior.insert(Behavior::OPTIONAL);
                    if optional_peers[own_optional_peers..].contains(&name) {
                        add(name, ExtensionKind::OptionalPeer);
                    }
                } else {
                    behavior = Behavior::OPTIONAL;
                }
            }
            append_dependency(this, log, name, spec, behavior)?;
        }
    }
    let declares = |group: &[u8], name: &[u8]| -> bool {
        entry
            .get(group)
            .is_some_and(|deps| deps.get(name).is_some())
    };
    // An extension only adds what the package doesn't declare itself.
    for &(name, range) in &extended.dependencies {
        if !declares(b"dependencies", name) {
            append_dependency(this, log, name, range, Behavior::PROD)?;
            add(name, ExtensionKind::Dependency);
        }
    }
    for &(name, range) in &extended.builtin_dependencies {
        if !declares(b"dependencies", name) {
            append_dependency(this, log, name, range, Behavior::PROD)?;
        }
    }
    for &(name, range) in &extended.peer_dependencies {
        if !declares(b"peerDependencies", name) {
            let mut behavior = Behavior::PEER;
            if optional_peers.contains(&name) {
                behavior.insert(Behavior::OPTIONAL);
            }
            append_dependency(this, log, name, range, behavior)?;
            add(name, ExtensionKind::Peer);
        }
    }
    // peers listed only in peerDependenciesMeta
    for (i, &name) in optional_peers.iter().enumerate() {
        if !declares(b"peerDependencies", name)
            && !extended.peer_dependencies.iter().any(|(n, _)| *n == name)
        {
            append_dependency(this, log, name, b"*", Behavior::PEER | Behavior::OPTIONAL)?;
            if i >= own_optional_peers {
                add(name, ExtensionKind::Peer);
            }
        }
    }
    take_appended_dependencies(this, pkg, off);
    Ok(added)
}

/// Returns the extensions of every `name@range` that matches the entry's version. Prereleases match
/// too, like in Yarn.
fn extensions_of<'a>(
    yarnrc: &'a YarnRc,
    descriptor_to_entry: &StringArrayHashMap<usize>,
    source: &[u8],
    name: &[u8],
    entry: &Expr,
) -> Extended<'a> {
    let mut extended = Extended::default();
    let Some(version) = entry.get(b"version").and_then(|v| scalar_text(source, &v)) else {
        return extended;
    };
    let parsed = semver::Version::parse(semver::SlicedString::init(version, version));
    if !parsed.valid {
        return extended;
    }
    let matches =
        |key: &[u8]| package_extensions::key_matches(key, name, parsed.version.min(), version);
    // Yarn registers its own list before those of `.yarnrc.yml`, and the first to add a name wins.
    for &(key, dependencies, optional_peers) in builtin_extensions::BUILTIN {
        if !matches(key.as_bytes()) {
            continue;
        }
        for &(dep_name, dep_range) in dependencies {
            let (dep_name, dep_range) = (dep_name.as_bytes(), dep_range.as_bytes());
            // The list differs by release, and yarn.lock does not name the release that wrote it.
            let is_locked = [&b"@npm:"[..], b"@"]
                .iter()
                .any(|sep| descriptor_to_entry.contains(&[dep_name, sep, dep_range].concat()));
            let is_added = (extended.builtin_dependencies.iter()).any(|(n, _)| *n == dep_name);
            if is_locked && !is_added {
                extended.builtin_dependencies.push((dep_name, dep_range));
            }
        }
        extended
            .builtin_optional_peers
            .extend(optional_peers.iter().map(|name| name.as_bytes()));
    }
    for extension in &yarnrc.extensions {
        if !matches(&extension.key) {
            continue;
        }
        for (from, to, before) in [
            (
                &extension.dependencies,
                &mut extended.dependencies,
                extended.builtin_dependencies.as_slice(),
            ),
            (
                &extension.peer_dependencies,
                &mut extended.peer_dependencies,
                &[],
            ),
        ] {
            for (dep_name, dep_range) in from {
                if to.iter().chain(before).any(|(n, _)| *n == &**dep_name) {
                    continue;
                }
                to.push((&**dep_name, &**dep_range));
            }
        }
        extended
            .optional_peers
            .extend(extension.optional_peers.iter().map(|name| &**name));
    }
    extended
}

/// From a package.json, with the same groups and duplicate handling as `Package::parse`.
fn append_manifest_dependencies(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    pkg: &mut lockfile::Package,
    manifest: &Expr,
    root_workspaces: Option<&Vec<Workspace>>,
    rewrites: &mut Rewrites,
    original_specs: &mut OriginalSpecs,
    being_added: &dyn Fn(&[u8], &[u8]) -> bool,
) -> Result<(), Error> {
    let off = this.buffers.dependencies.len();
    let optional_peers = optional_names(b"", manifest, b"peerDependenciesMeta");
    let mut seen: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // `Package::parse` merges a name that several groups list only for the root package.json.
    let is_root = root_workspaces.is_some();
    // Maps each name to the range that Yarn installs for it, as Yarn writes it: the one in
    // devDependencies, or else optionalDependencies, or else dependencies.
    let mut yarn_ranges: StringArrayHashMap<&'static [u8]> = StringArrayHashMap::new();
    let mut in_dev: StringArrayHashMap<()> = StringArrayHashMap::new();
    // name -> its range in the first group that lists it
    let mut declared: StringArrayHashMap<&'static [u8]> = StringArrayHashMap::new();
    // names with another range in a later group
    let mut several_ranges: StringArrayHashMap<()> = StringArrayHashMap::new();
    for (group, behavior) in [
        (b"dependencies".as_slice(), Behavior::PROD),
        (b"devDependencies".as_slice(), Behavior::DEV),
        (b"optionalDependencies".as_slice(), Behavior::OPTIONAL),
        (b"peerDependencies".as_slice(), Behavior::PEER),
    ] {
        for (k, v) in props(&manifest.get(group).unwrap_or_default()) {
            let Some(name) = as_str(k) else { continue };
            let mut spec = as_str(v).unwrap_or(b"");
            if being_added(name, spec) {
                continue;
            }
            let mut behavior = behavior;
            let mut replaces: Option<usize> = None;
            if behavior.is_peer() {
                if optional_peers.contains(&name) {
                    behavior.insert(Behavior::OPTIONAL);
                }
            } else {
                let e = seen.get_or_put(name)?;
                if e.found_existing {
                    // As in `Package::parse`: in the root, an optional dependency replaces the
                    // first entry. In any other package it's a separate dependency.
                    if is_root && behavior.is_optional() {
                        replaces = Some(*e.value_ptr);
                    }
                    if declared.get(name).is_some_and(|first| *first != spec) {
                        several_ranges.put(name, ())?;
                    }
                } else {
                    *e.value_ptr = this.buffers.dependencies.len();
                    declared.put(name, spec)?;
                }
                if behavior.is_dev() {
                    in_dev.put(name, ())?;
                    yarn_ranges.put(name, spec)?;
                } else if !in_dev.contains(name) {
                    yarn_ranges.put(name, spec)?;
                }
            }
            // package.json is rewritten to match after migration.
            if let Some(new_spec) = yarn_only_range_for_bun(name, spec) {
                add_rewrite(rewrites, name, spec, &new_spec);
                // Interned, because the dependency's literal points at it.
                spec = bun_ast::data_store_dupe_str(&new_spec);
            }
            append_dependency(this, log, name, spec, behavior)?;
            if let Some(existing) = replaces {
                let dep = this.buffers.dependencies.pop().expect("just appended");
                this.buffers.dependencies[existing] = dep;
            }
        }
    }
    // peers listed only in peerDependenciesMeta
    for name in &optional_peers {
        if manifest
            .get(b"peerDependencies")
            .is_none_or(|peers| peers.get(name).is_none())
        {
            append_dependency(this, log, name, b"*", Behavior::PEER | Behavior::OPTIONAL)?;
        }
    }
    for ws in root_workspaces.into_iter().flatten() {
        push_workspace_dependency(this, &ws.name, &ws.path)?;
    }
    take_appended_dependencies(this, pkg, off);
    let bytes = this.buffers.string_bytes.as_slice();
    for (i, dep) in this.buffers.dependencies[off..].iter().enumerate() {
        if dep.behavior.is_peer() || dep.behavior.is_workspace() {
            continue;
        }
        let id = (off + i) as DependencyID;
        let name = dep.name.slice(bytes);
        let Some(yarn_range) = yarn_ranges.get(name) else {
            continue;
        };
        if *yarn_range != dep.version.literal.slice(bytes) {
            original_specs
                .by_dependency
                .insert(id, Box::from(*yarn_range));
        }
        if several_ranges.contains(name) {
            original_specs.in_several_groups.push(id);
        }
    }
    Ok(())
}

/// Rewrites a range that only yarn understands into what a dependency called `name` would write for
/// Bun, for example `portal:p` into `file:p`. Returns `None` if `spec` needs no rewrite.
fn yarn_only_range_for_bun(name: &[u8], spec: &[u8]) -> Option<Vec<u8>> {
    // the patched range may itself be a patch, or yarn-only (`patch:` of a `portal:` package)
    let mut patched: Option<Vec<u8>> = None;
    while let Some(rest) = patched.as_deref().unwrap_or(spec).strip_prefix(b"patch:") {
        // `ms@npm%3A2.1.3#~/.yarn/patches/ms.patch` -> `2.1.3`, under another name `npm:ms@2.1.3`
        let (inner, _, _) = decode_patch_spec(rest);
        let (inner_name, inner_ref) = split_locator(&inner).unwrap_or((name, &inner[..]));
        let (range, _) = split_reference_params(inner_ref);
        let plain = strip_npm_protocol(range);
        patched = Some(if inner_name != name && !has_protocol(plain) {
            [b"npm:", inner_name, b"@", plain].concat()
        } else {
            plain.to_vec()
        });
    }
    let range = patched.as_deref().unwrap_or(spec);
    if let Some(path) = range.strip_prefix(b"portal:").filter(|p| !p.is_empty()) {
        return Some([b"file:".as_slice(), path].concat());
    }
    range
        .strip_prefix(b"link:")
        .filter(|path| strings::is_npm_package_name(path))
        .map(|path| [b"link:./".as_slice(), path].concat())
        .or(patched)
        .or_else(|| {
            let plain = strip_npm_protocol(spec);
            (plain.len() != spec.len()).then(|| plain.to_vec())
        })
}

/// package.json is written before bun.lock is saved, so a migration that's run again can find
/// ranges that it already rewrote.
fn range_before_rewrite(range: &[u8]) -> Option<Vec<u8>> {
    if let Some(path) = range.strip_prefix(b"file:") {
        return Some([b"portal:".as_slice(), path].concat());
    }
    range
        .strip_prefix(b"link:./")
        .map(|path| [b"link:".as_slice(), path].concat())
}

fn append_dependency(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    name: &[u8],
    spec: &[u8],
    behavior: Behavior,
) -> Result<(), Error> {
    let name = sbuf!(this).append_external_with_hash(name, string_hash(name))?;
    let spec = sbuf!(this).append(strip_npm_protocol(spec))?;
    let sliced = spec.sliced(string_bytes!(this));
    let mut version = Dependency::parse(
        name.value,
        name.hash,
        sliced.slice,
        &sliced,
        Some(&mut *log),
        None,
    )
    .unwrap_or_default();
    version.literal = spec;
    this.buffers.dependencies.push(Dependency {
        name: name.value,
        name_hash: name.hash,
        behavior,
        version,
    });
    Ok(())
}

/// Interned into the store that backs the cached package.json tree.
#[inline(never)]
fn string_expr(s: &[u8]) -> Expr {
    Expr::init(
        E::EString::init(bun_ast::data_store_dupe_str(s)),
        bun_ast::Loc::EMPTY,
    )
}

fn object_expr<'a>(entries: impl IntoIterator<Item = (&'a [u8], Expr)>) -> Expr {
    object_expr_from(&mut entries.into_iter())
}

fn object_expr_from<'a>(entries: &mut dyn Iterator<Item = (&'a [u8], Expr)>) -> Expr {
    let mut properties = bun_alloc::AstAlloc::vec();
    for (key, value) in entries {
        VecExt::append(
            &mut properties,
            bun_ast::G::Property {
                key: Some(string_expr(key)),
                value: Some(value),
                ..Default::default()
            },
        );
    }
    Expr::init(
        E::Object {
            properties,
            ..Default::default()
        },
        bun_ast::Loc::EMPTY,
    )
}

fn sorted_object(map: &StringArrayHashMap<Box<[u8]>>) -> Expr {
    let mut pairs: Vec<(&[u8], &[u8])> = map.iter().map(|(k, v)| (&**k, &**v)).collect();
    pairs.sort_unstable();
    object_expr(pairs.into_iter().map(|(k, v)| (k, string_expr(v))))
}

/// `packageExtensions`, in the shape .yarnrc.yml has them.
fn extensions_object(extensions: &[PackageExtension]) -> Expr {
    object_expr(extensions.iter().map(|extension| {
        let mut fields: Vec<(&[u8], Expr)> = Vec::new();
        for (group, ranges) in [
            (b"dependencies".as_slice(), &extension.dependencies),
            (b"peerDependencies".as_slice(), &extension.peer_dependencies),
        ] {
            if !ranges.is_empty() {
                let ranges = ranges
                    .iter()
                    .map(|(name, range)| (&**name, string_expr(range)));
                fields.push((group, object_expr(ranges)));
            }
        }
        if !extension.optional_peers.is_empty() {
            let meta = object_expr(extension.optional_peers.iter().map(|name| {
                let optional = Expr::init(E::Boolean { value: true }, bun_ast::Loc::EMPTY);
                (&**name, object_expr([(b"optional".as_slice(), optional)]))
            }));
            fields.push((b"peerDependenciesMeta".as_slice(), meta));
        }
        (&*extension.key, object_expr(fields))
    }))
}

/// Leaves existing keys alone. Edits the cached tree and returns what changed.
fn edit_package_json(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    abs_path: &[u8],
    rewrites: &Rewrites,
    patched: &[(Vec<u8>, Vec<u8>)],
    yarnrc: Option<&YarnRc>,
) -> Result<Option<Vec<&'static str>>, Error> {
    let catalogs = yarnrc
        .map(|rc| &rc.catalogs)
        .filter(|c| c.iter().any(|(_, m)| m.count() > 0));
    let extensions: &[PackageExtension] = yarnrc.map_or(&[], |rc| rc.extensions.as_slice());
    if rewrites.is_empty() && patched.is_empty() && catalogs.is_none() && extensions.is_empty() {
        return Ok(None);
    }
    let options = GetJsonOptions {
        guess_indentation: true,
        init_reset_store: false,
    };
    let Ok(entry) = package_json(manager, log, abs_path, options) else {
        return Ok(None);
    };
    let mut json = entry.root;
    if !json.is_object() {
        return Ok(None);
    }
    let bump = bun_alloc::Arena::new();
    let mut changed: Vec<&'static str> = Vec::new();

    let mut any = false;
    for group in [
        b"dependencies".as_slice(),
        b"devDependencies",
        b"optionalDependencies",
        b"peerDependencies",
        b"resolutions",
    ] {
        let Some(mut obj) = json.get_object(group) else {
            continue;
        };
        for prop in e_object_mut(&mut obj).properties.slice_mut() {
            let (Some(key), Some(value)) = (
                prop.key.as_ref().and_then(as_str),
                prop.value.as_ref().and_then(as_str),
            ) else {
                continue;
            };
            // the dependency that a `resolutions` key names is its last `name[@range]`
            let name = if group == b"resolutions" {
                resolution_key_parts(key).map_or(key, |(_, pattern)| {
                    Dependency::split_name_and_maybe_version(pattern).0
                })
            } else {
                key
            };
            if let Some((_, _, new_spec)) =
                (rewrites.iter()).find(|(of, from, _)| &**of == name && &**from == value)
            {
                prop.value = Some(string_expr(new_spec));
                any = true;
            }
        }
    }
    if any {
        changed.push("rewrote patch:/portal:/link:/npm: ranges");
    }

    if !patched.is_empty() {
        // Keep what the user already declared for Bun, and add Yarn's entries to it.
        let existing = json.get(b"patchedDependencies");
        let mut patches = existing.unwrap_or_else(|| object_expr([]));
        if patches.is_object() {
            let obj = e_object_mut(&mut patches);
            let mut any = false;
            for (key, path) in patched {
                if obj.get(key).is_none() {
                    obj.put(&bump, bun_ast::data_store_dupe_str(key), string_expr(path))?;
                    any = true;
                }
            }
            if existing.is_none() {
                e_object_mut(&mut json).put(&bump, b"patchedDependencies", patches)?;
            }
            if any {
                changed.push("added patchedDependencies");
            }
        }
    }

    if let Some(catalogs) = catalogs {
        let default = catalogs.get(b"").filter(|m| m.count() > 0);
        let mut named: Vec<&[u8]> = catalogs
            .iter()
            .filter(|(k, m)| !k.is_empty() && m.count() > 0)
            .map(|(k, _)| &**k)
            .collect();
        named.sort_unstable();
        let has_key = |json: &Expr, key: &[u8]| {
            json.get(key).is_some()
                || json
                    .get_object(b"workspaces")
                    .is_some_and(|w| w.get(key).is_some())
        };
        let want_default = default.is_some() && !has_key(&json, b"catalog");
        let want_named = !named.is_empty() && !has_key(&json, b"catalogs");
        if want_default || want_named {
            // Bun reads catalogs from the `workspaces` object, so an array becomes `{ packages }`.
            let mut workspaces = match json.get(b"workspaces") {
                Some(existing) if existing.is_object() => existing,
                existing => object_expr(
                    existing
                        .filter(|e| e.is_array())
                        .map(|packages| (b"packages".as_slice(), packages)),
                ),
            };
            let ws_obj = e_object_mut(&mut workspaces);
            if let (true, Some(default)) = (want_default, default) {
                ws_obj.put(&bump, b"catalog", sorted_object(default))?;
            }
            if want_named {
                let groups = named.into_iter().map(|group| {
                    let ranges = catalogs.get(group).expect("listed above");
                    (group, sorted_object(ranges))
                });
                ws_obj.put(&bump, b"catalogs", object_expr(groups))?;
            }
            e_object_mut(&mut json).put(&bump, b"workspaces", workspaces)?;
            changed.push("copied .yarnrc.yml catalogs to workspaces");
        }
    }

    if !extensions.is_empty() && json.get(b"packageExtensions").is_none() {
        e_object_mut(&mut json).put(&bump, b"packageExtensions", extensions_object(extensions))?;
        changed.push("copied .yarnrc.yml packageExtensions to packageExtensions");
    }

    if changed.is_empty() {
        return Ok(None);
    }
    // The spliced-in nodes live in `bump` and the AST store: the cache entry must own its tree.
    save_entry(entry, json, log);
    Ok(Some(changed))
}
