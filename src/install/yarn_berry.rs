//! yarn 2+ ("berry") `yarn.lock` -> bun lockfile migration.
//!
//! Berry lockfiles are YAML with one entry per *locator*. Each entry lists the
//! descriptors (`name@npm:^1.2.3`, `name@workspace:packages/x`, ...) that
//! resolved to it, the exact `resolution`, its `dependencies` (values are the
//! range halves of descriptors: `"npm:^7.0.0"`), `peerDependencies`,
//! optional-ness via `dependenciesMeta` / `peerDependenciesMeta`, `bin`, and
//! platform `conditions`.
//!
//! The point of migrating is that every third-party version stays exactly
//! where yarn pinned it. What yarn.lock pins and bun cannot keep (an edge with
//! no entry, a patch `patchedDependencies` cannot express, a protocol bun does
//! not have, a registry bun is not configured with, a package with no
//! integrity) fails the migration with the reason in the log, and bun resolves
//! from package.json instead. Otherwise:
//!   * the root and workspace packages are built from their package.json
//!     (workspaces come from the root package.json `workspaces` globs, the
//!     same way `bun install` reads them), which gives the real prod/dev/
//!     optional/peer behaviours;
//!   * every other entry becomes a package from its `resolution`: npm (the
//!     tarball URL comes from `::__archiveUrl` when present, otherwise from the
//!     registry configured for bun, which has to be yarn's too), tarball URLs,
//!     git (pinned to the locked commit), and `file:` / `portal:` / `link:`
//!     folders relative to the workspace that declared them;
//!   * dependency edges are bound the way yarn bound them: through the first
//!     matching package.json `resolutions` rule, else by descriptor lookup
//!     (`name@<range>`), with `catalog:` ranges translated through
//!     `.yarnrc.yml`. Peer edges may stay unbound; the install binds them;
//!   * `patch:` locators fold onto the package they patch. Project patches
//!     (`.yarn/patches/...`) are recorded in package.json `patchedDependencies`;
//!     yarn's builtin compat patches are dropped;
//!   * `conditions` map to os/cpu. `checksum` is a hash of yarn's zip archive,
//!     not of the registry tarball, so integrity is filled in from the registry
//!     manifests after migration.

use bun_collections::VecExt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_ast::{E, Expr, ExprData};
use bun_collections::StringArrayHashMap;
use bun_core::strings;
use bun_semver as semver;
use bun_semver::String;
use bun_sys::Fd;

use crate::bin::Bin;
use crate::dependency::{self, Behavior, Dependency, DependencyExt as _};
use crate::external_slice::ExternalSlice;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{self, LoadResult, LoadResultOk, Lockfile};
use crate::lockfile_real::package::value_loc_of;
use crate::lockfile_real::package::workspace_map::{MissingWorkspace, NamesArray, WorkspaceMap};
use crate::npm;
use crate::package_manager_real::add_remove_with_filter::WorkspaceTarget;
use crate::package_manager_real::options::Do;
use crate::package_manager_real::package_json_write_back;
use crate::package_manager_real::update_package_json_and_install::print_package_json_into_cache_entry;
use crate::pnpm::e_object_mut;
use crate::repository::Repository;
use crate::resolution::{Resolution, TaggedValue};
use crate::versioned_url::VersionedURLType;
use crate::{DependencyID, Error, INVALID_PACKAGE_ID, PackageID, PackageManager};

// A `Buf` held for the whole function would lock out every other `lockfile.*`
// access; build a fresh one per append so the borrow ends immediately
// (same pattern as pnpm.rs).
macro_rules! sbuf {
    ($lockfile:expr) => {
        semver::string::Buf {
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

fn as_str(expr: &Expr) -> Option<&'static [u8]> {
    match &expr.data {
        // YAML / package.json strings are Store-backed; the `'static` is the
        // field's own lifetime.
        ExprData::EString(s) if s.is_utf8() => Some(s.data.slice()),
        _ => None,
    }
}

fn get_str(expr: &Expr, key: &[u8]) -> Option<&'static [u8]> {
    expr.get(key).and_then(|e| as_str(&e))
}

/// The text of a scalar in yarn.lock / .yarnrc.yml. Yarn reads both with YAML's
/// failsafe schema, where every scalar is a string. Bun's parser types plain
/// scalars, so `wrappy: 1` and `ms: 2.10` arrive as numbers (the second one as
/// `2.1`); their text is the source bytes at the node's `loc`.
fn scalar_text(source: &[u8], expr: &Expr) -> Option<&'static [u8]> {
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
    // an alias (`*a`), a tagged scalar (`!!int 1`) and an empty value have no
    // scalar text at `loc`
    let plain = !text.is_empty()
        && text
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.' | b'~'));
    plain.then(|| bun_ast::data_store_dupe_str(text))
}

/// A key that one mapping of yarn.lock holds twice (nested mappings included).
/// Yarn keeps the last value and `Expr::get` returns the first, so the two would
/// read different entries.
fn duplicate_key(
    source: &[u8],
    expr: &Expr,
    depth: u8,
) -> Result<Option<&'static [u8]>, AllocError> {
    let ExprData::EObject(obj) = &expr.data else {
        return Ok(None);
    };
    let mut seen: StringArrayHashMap<()> = StringArrayHashMap::new();
    for p in obj.properties.slice() {
        if let Some(key) = p.key.as_ref().and_then(|k| scalar_text(source, k)) {
            if seen.get_or_put(key)?.found_existing {
                return Ok(Some(key));
            }
        }
        if let (Some(value), true) = (&p.value, depth > 0) {
            if let Some(key) = duplicate_key(source, value, depth - 1)? {
                return Ok(Some(key));
            }
        }
    }
    Ok(None)
}

/// Whether yarn.lock can hold a `<<` merge key. Bun's YAML parser expands merge
/// keys and yarn reads `<<` as an ordinary key, so the two would see different
/// entries. Yarn never writes `<<`, a `\` escape for `<`, or a `\` line
/// continuation (the two ways to spell `<<` without the bytes).
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
        let code = hex
            .iter()
            .try_fold(0u32, |n, &c| hex_val(c).map(|v| n * 16 + u32::from(v)));
        if code == Some(u32::from(b'<')) {
            return true;
        }
    }
    false
}

fn invalid_lockfile(log: &mut bun_ast::Log, args: core::fmt::Arguments<'_>) -> Error {
    log.add_error_fmt(None, bun_ast::Loc::EMPTY, args);
    Error::InvalidYarnBerryLockfile
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s[i] == b'%' && i + 2 < s.len() {
            if let (Some(a), Some(b)) = (hex_val(s[i + 1]), hex_val(s[i + 2])) {
                out.push(a * 16 + b);
                i += 3;
                continue;
            }
        }
        out.push(s[i]);
        i += 1;
    }
    out
}

/// `encodeURIComponent`, which is how yarn embeds a locator in `::locator=`.
fn percent_encode(out: &mut Vec<u8>, s: &[u8]) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    for &c in s {
        if c.is_ascii_alphanumeric()
            || matches!(
                c,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            out.push(c);
        } else {
            out.push(b'%');
            out.push(HEX[(c >> 4) as usize]);
            out.push(HEX[(c & 0xf) as usize]);
        }
    }
}

/// `name@rest`, keeping a leading scope `@`.
fn split_locator(spec: &[u8]) -> Option<(&[u8], &[u8])> {
    let from = usize::from(spec.first() == Some(&b'@'));
    let i = strings::index_of_char_usize(&spec[from..], b'@')? + from;
    Some((&spec[..i], &spec[i + 1..]))
}

/// `npm:1.2.3::__archiveUrl=...` -> (`npm:1.2.3`, [(key, decoded value)]).
fn split_reference_params(reference: &[u8]) -> (&[u8], Vec<(&[u8], Vec<u8>)>) {
    let Some((head, tail)) = strings::split_once(reference, b"::") else {
        return (reference, Vec::new());
    };
    let mut params = Vec::new();
    for kv in strings::split(tail, b"&") {
        if let Some((k, v)) = strings::split_once_char(kv, b'=') {
            params.push((k, percent_decode(v)));
        }
    }
    (head, params)
}

fn param<'a>(params: &'a [(&[u8], Vec<u8>)], key: &[u8]) -> Option<&'a [u8]> {
    params
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.as_slice())
}

/// A `scheme:` prefix (`npm:`, `workspace:`, `file:`, `git+ssh:`, ...), not
/// `@scope/x` or `1.2.3`; RFC 3986 scheme characters.
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

/// `npm:^1.2.3` -> `^1.2.3`; `npm:other@^1` (an alias, which bun spells the
/// same way) is kept whole. A range never contains `@`, so `name@…` after the
/// protocol (scope included) means an alias — also for names like `7zip-bin`.
fn strip_npm_protocol(spec: &[u8]) -> &[u8] {
    let Some(rest) = spec.strip_prefix(b"npm:") else {
        return spec;
    };
    let is_alias = split_locator(rest).is_some_and(|(n, _)| !n.is_empty());
    if is_alias { spec } else { rest }
}

/// `os=darwin & cpu=arm64`, `(os=linux | os=win32) & cpu=x64`, `... & libc=glibc`
fn parse_conditions(cond: &[u8]) -> (npm::OperatingSystem, npm::Architecture) {
    let mut os = npm::OperatingSystem::NONE.negatable();
    let mut cpu = npm::Architecture::NONE.negatable();
    let (mut any_os, mut any_cpu) = (false, false);
    for term in strings::split(cond, b"&") {
        for alt in strings::split(term, b"|") {
            let alt: &[u8] = strings::trim(alt, b" ()\t");
            if let Some(v) = alt.strip_prefix(b"os=") {
                os.apply(v);
                any_os = true;
            } else if let Some(v) = alt.strip_prefix(b"cpu=") {
                cpu.apply(v);
                any_cpu = true;
            }
            // bun's lockfile has no libc column; `libc=` is dropped.
        }
    }
    (
        if any_os {
            os.combine()
        } else {
            npm::OperatingSystem::ALL
        },
        if any_cpu {
            cpu.combine()
        } else {
            npm::Architecture::ALL
        },
    )
}

/// The `patchedDependencies` key bun looks a package's patch up by:
/// `name@<resolution>` (`no-deps@1.0.0`, `x@github:o/r#sha`, `y@https://…/y.tgz`).
/// `None` for what bun installs straight from a project folder and does not
/// patch: the root, workspaces, and `file:` / `link:` folders.
fn patched_dependency_key(
    lockfile: &Lockfile,
    name: &[u8],
    package_id: PackageID,
) -> Result<Option<Vec<u8>>, AllocError> {
    use crate::resolution::Tag;
    let res = lockfile.packages.items_resolution()[package_id as usize];
    if matches!(
        res.tag,
        Tag::Root | Tag::Workspace | Tag::Folder | Tag::Symlink
    ) {
        return Ok(None);
    }
    let mut out = Vec::new();
    write!(
        &mut out,
        "{}@{}",
        bstr::BStr::new(name),
        res.fmt(string_bytes!(lockfile), bun_core::fmt::PathSep::Posix)
    )
    .map_err(|_| AllocError)?;
    Ok(Some(out))
}

/// The parts of yarn's configuration the migration reads.
#[derive(Default)]
struct YarnRc {
    /// catalog group ("" for the default `catalog:`) -> name -> range
    catalogs: StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>,
    /// `npmRegistryServer`
    registry: Option<Box<[u8]>>,
    /// `npmScopes.<scope>.npmRegistryServer`, keyed without the `@`
    scope_registries: StringArrayHashMap<Box<[u8]>>,
}

/// Yarn's settings come from `YARN_*` environment variables, then the rc file
/// of the project folder, of each parent folder and of the home folder; the
/// first source that sets a value wins.
fn read_yarnrc(log: &mut bun_ast::Log, manager: &PackageManager) -> Result<YarnRc, Error> {
    let mut out = YarnRc::default();
    let env = |key: &[u8]| -> Option<&[u8]> {
        manager
            .env
            .as_ref()
            .and_then(|env| env.get().get(key))
            .filter(|v| !v.is_empty())
    };
    if let Some(url) = env(b"YARN_NPM_REGISTRY_SERVER") {
        out.registry = Some(Box::from(url));
    }
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
        Err(err)
            if err.errno == bun_sys::SystemErrno::ENOENT as u16
                || err.errno == bun_sys::SystemErrno::ENOTDIR as u16 =>
        {
            return Ok(());
        }
        Err(_) => {
            return Err(invalid_lockfile(
                log,
                format_args!("could not read {}", bstr::BStr::new(&path)),
            ));
        }
    };
    let source = bun_ast::Source::init_path_string(path.as_slice(), data.as_slice());
    let arena = bun_alloc::Arena::new();
    // The parser's messages point into `path` and `data`, which do not outlive
    // this function; `log` does.
    let mut parse_log = bun_ast::Log::init();
    let Ok(root) = bun_parsers::yaml::YAML::parse(
        &source,
        &mut parse_log,
        &arena,
        bun_parsers::yaml::CyclicAliases::Reject,
    ) else {
        return Err(invalid_lockfile(
            log,
            format_args!("{} is not valid YAML", bstr::BStr::new(&path)),
        ));
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
                    // yarn allows `npm:^1.0.0` here; in a bun catalog that is an alias
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

    let registry_of = |owner: &Expr| -> Option<Box<[u8]>> {
        get_str(owner, b"npmRegistryServer")
            .filter(|url| !url.is_empty())
            .map(Box::from)
    };
    if out.registry.is_none() {
        out.registry = registry_of(&root);
    }
    if let Some(ExprData::EObject(scopes)) = root.get(b"npmScopes").map(|e| e.data) {
        for p in scopes.properties.slice() {
            let (Some(scope), Some(value)) = (p.key.as_ref().and_then(as_str), &p.value) else {
                continue;
            };
            if out.scope_registries.contains(scope) {
                continue;
            }
            if let Some(url) = registry_of(value) {
                out.scope_registries.put(scope, url)?;
            }
        }
    }
    Ok(())
}

/// Where the project's `.patch` files of a `patch:` locator live, relative to
/// the project root; yarn's builtin compat patches are left out.
///
/// `source` is the decoded text after `#`, one or more `&`-separated patches:
/// `~/.yarn/patches/x.patch` (project root), `./patches/x.patch` (relative to
/// the `locator` param's package), or `optional!builtin<compat/fsevents>`.
fn project_patch_paths(
    source: &[u8],
    params: &[(&[u8], Vec<u8>)],
    workspace_path_of_locator: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
) -> Vec<Vec<u8>> {
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
            let base = param(params, b"locator")
                .and_then(workspace_path_of_locator)
                .unwrap_or_default();
            paths.push(join_folder(&base, one));
        }
    }
    paths
}

/// `patch:<percent-encoded locator>#<source>::params`
struct PatchSpec {
    /// decoded inner locator / descriptor, e.g. `ms@npm:2.1.3`
    inner: Vec<u8>,
    /// decoded `<source>`
    source: Vec<u8>,
}

fn decode_patch_spec(rest: &[u8]) -> (PatchSpec, Vec<(&[u8], Vec<u8>)>) {
    let (spec, params) = split_reference_params(rest);
    let (inner, source) = match strings::split_once_char(spec, b'#') {
        Some((inner, source)) => (inner, source),
        None => (spec, &b""[..]),
    };
    (
        PatchSpec {
            inner: percent_decode(inner),
            source: percent_decode(source),
        },
        params,
    )
}

/// `name@head` with any `::params` removed and `head` percent-decoded; the key
/// of `locator_to_entry` (a `patch:` of a `patch:` encodes its inner locator twice).
fn locator_key(name: &[u8], reference: &[u8]) -> Vec<u8> {
    let (head, _) = split_reference_params(reference);
    let mut key = Vec::with_capacity(name.len() + 1 + head.len());
    key.extend_from_slice(name);
    key.push(b'@');
    key.extend_from_slice(&percent_decode(head));
    key
}

/// The project-relative directory of the package a (percent-encoded) locator
/// names: `name@workspace:path` -> `path`; `name@portal:./p::locator=<owner>` ->
/// `<owner dir>/p`. `None` for anything that is not a folder.
fn locator_dir(encoded: &[u8], depth: u8) -> Option<Vec<u8>> {
    let decoded = percent_decode(encoded);
    let (_, reference) = split_locator(&decoded)?;
    if let Some(path) = reference.strip_prefix(b"workspace:") {
        return Some(path.to_vec());
    }
    let (head, params) = split_reference_params(reference);
    let path = [b"file:".as_slice(), b"portal:", b"link:"]
        .iter()
        .find_map(|p| head.strip_prefix(*p))?;
    let path = strings::split_once_char(path, b'#').map_or(path, |(p, _)| p);
    let base = match param(&params, b"locator") {
        Some(owner) if depth < 16 => locator_dir(owner, depth + 1).unwrap_or_default(),
        _ => Vec::new(),
    };
    Some(join_folder(&base, path))
}

/// `base` + `path` (which yarn writes relative to the declaring package), as
/// the project-relative path the folder resolver stores for a `file:`
/// dependency: `.` / `..` segments resolved (so `packages/a/../shared` and
/// `packages/b/../shared` are one folder) and `/` separators on every platform.
fn join_folder(base: &[u8], path: &[u8]) -> Vec<u8> {
    use bun_paths::resolve_path::{join_string_buf, platform};
    if bun_paths::is_absolute(path) {
        return path.to_vec();
    }
    let mut buf = bun_paths::path_buffer_pool::get();
    if base.len() + path.len() + 2 > buf.len() {
        // longer than a path can be; the install reports the folder as missing
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
    /// `patch:` locator: shares the package id of the locator it patches
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

/// A package.json range bun cannot read, rewritten after migration: `patch:`
/// (bun reads patches from `patchedDependencies`) becomes the plain range it
/// patches, and yarn's `portal:` / `link:` paths become `file:` paths.
struct ManifestRewrite {
    original_spec: Box<[u8]>,
    new_spec: Box<[u8]>,
}

/// The yarn descriptor range of a rewritten manifest dependency, which is what
/// the lockfile keys it by.
type OriginalSpecs = bun_collections::HashMap<DependencyID, Box<[u8]>>;

struct Workspace {
    /// relative to the project root, posix separators
    path: Box<[u8]>,
    name: Box<[u8]>,
    package_id: PackageID,
    rewrites: Vec<ManifestRewrite>,
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

    // Later `workspace_package_json_cache.get_with_path` calls reset the Expr
    // store, so clone the parsed tree into an arena that lives for the whole
    // function (same as the pnpm migration).
    if may_hold_merge_key(data) {
        return Err(invalid_lockfile(
            log,
            format_args!("yarn.lock has a \"<<\" merge key, which yarn and bun read differently"),
        ));
    }
    let source = bun_ast::Source::init_path_string(b"yarn.lock", data);
    let arena = bun_alloc::Arena::new();
    let root: Expr = match bun_parsers::yaml::YAML::parse(
        &source,
        log,
        &arena,
        bun_parsers::yaml::CyclicAliases::Reject,
    ) {
        Ok(r) => bun_core::handle_oom(r.deep_clone(&arena)),
        Err(_) => {
            log.add_error(None, bun_ast::Loc::EMPTY, b"yarn.lock is not valid YAML");
            return Err(Error::InvalidYarnBerryLockfile);
        }
    };
    let ExprData::EObject(root_obj) = &root.data else {
        log.add_error(
            None,
            bun_ast::Loc::EMPTY,
            b"yarn.lock must be a YAML mapping",
        );
        return Err(Error::InvalidYarnBerryLockfile);
    };
    let Some(version) = root
        .get(b"__metadata")
        .and_then(|m| m.get(b"version"))
        .and_then(|v| scalar_text(data, &v))
    else {
        log.add_error(
            None,
            bun_ast::Loc::EMPTY,
            b"yarn.lock is missing __metadata.version",
        );
        return Err(Error::InvalidYarnBerryLockfile);
    };
    // 4 is yarn 2.0's lockfile and 10 is the newest (yarn 4); a later format may
    // change what the fields mean
    if !matches!(version, b"4" | b"5" | b"6" | b"7" | b"8" | b"9" | b"10") {
        return Err(invalid_lockfile(
            log,
            format_args!(
                "yarn.lock version {} is not supported",
                bstr::BStr::new(version)
            ),
        ));
    }
    if let Some(key) = duplicate_key(data, &root, 3)? {
        return Err(invalid_lockfile(
            log,
            format_args!(
                "yarn.lock has the key \"{}\" more than once in one mapping",
                bstr::BStr::new(key)
            ),
        ));
    }

    let yarnrc = read_yarnrc(log, manager)?;

    // `catalog:` ranges must resolve while this install parses package.json
    // (against `lockfile.catalogs`); they are also written to package.json at
    // the end so the project keeps working without .yarnrc.yml.
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
    let mut entries: Vec<Entry> = Vec::with_capacity(root_obj.properties.len_u32() as usize);
    // descriptor as yarn writes it ("name@npm:^1") -> entry
    let mut descriptor_to_entry: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // locator without `::params` ("name@npm:1.2.3") -> entry
    let mut locator_to_entry: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // workspace path in the lockfile -> entry
    let mut lockfile_workspaces: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // `name@link:path` descriptors (without `::locator=`): yarn's `link:` is a
    // folder, unlike bun's
    let mut yarn_links: StringArrayHashMap<()> = StringArrayHashMap::new();

    for prop in root_obj.properties.slice() {
        let (Some(key), Some(value)) = (&prop.key, &prop.value) else {
            continue;
        };
        let Some(key) = scalar_text(data, key) else {
            return Err(invalid_lockfile(
                log,
                format_args!("yarn.lock has a key that is not a string"),
            ));
        };
        if key == b"__metadata" {
            continue;
        }
        if !value.is_object() {
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "yarn.lock entry \"{}\" is not a mapping",
                    bstr::BStr::new(key)
                ),
            );
            return Err(Error::InvalidYarnBerryLockfile);
        }
        let Some(resolution) = get_str(value, b"resolution") else {
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "yarn.lock entry \"{}\" has no resolution",
                    bstr::BStr::new(key)
                ),
            );
            return Err(Error::InvalidYarnBerryLockfile);
        };
        let Some((name, reference)) = split_locator(resolution).filter(|(n, _)| !n.is_empty())
        else {
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "yarn.lock entry \"{}\" has an invalid resolution \"{}\"",
                    bstr::BStr::new(key),
                    bstr::BStr::new(resolution)
                ),
            );
            return Err(Error::InvalidYarnBerryLockfile);
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
        for desc in strings::split(key, b",") {
            let desc = strings::trim(desc, b" ");
            if desc.is_empty() {
                continue;
            }
            let e = descriptor_to_entry.get_or_put(desc)?;
            if e.found_existing {
                return Err(invalid_lockfile(
                    log,
                    format_args!(
                        "yarn.lock has more than one entry for \"{}\"",
                        bstr::BStr::new(desc)
                    ),
                ));
            }
            *e.value_ptr = idx;
            if reference.starts_with(b"link:") {
                yarn_links.put(
                    strings::split_once(desc, b"::").map_or(desc, |(bare, _)| bare),
                    (),
                )?;
            }
        }
        locator_to_entry.put(&locator_key(name, reference), idx)?;
    }

    if lockfile_workspaces.get(b".").is_none() {
        log.add_error(
            None,
            bun_ast::Loc::EMPTY,
            b"yarn.lock has no root workspace entry (\"@workspace:.\")",
        );
        return Err(Error::InvalidYarnBerryLockfile);
    }

    // -- 2. root + workspaces from disk ---------------------------------------
    let mut root_json_path = bun_paths::AutoAbsPath::init_top_level_dir();
    let _ = root_json_path.append(b"package.json"); // capacity error is non-actionable
    let (root_manifest, workspace_map) = {
        let root_json = match manager
            .workspace_package_json_cache
            .get_with_path(log, root_json_path.slice(), Default::default())
            .unwrap()
        {
            Ok(j) => j,
            Err(_) => return Err(Error::InvalidPackageJSON),
        };
        let manifest: Expr = root_json.root;
        // `process_names_array` resolves globs relative to the source's directory.
        let source: bun_ast::Source = root_json.source.clone();

        let mut workspace_map = WorkspaceMap::init();
        let workspaces = manifest.as_property(b"workspaces");
        let packages = workspaces
            .as_ref()
            .filter(|q| !q.expr.is_array())
            .and_then(|q| q.expr.as_property(b"packages"));
        let names = match (&workspaces, &packages) {
            (Some(q), _) if q.expr.is_array() => {
                NamesArray::from_expr(&q.expr, value_loc_of(&source, q.loc)).map(|a| (a, q.loc))
            }
            (Some(_), Some(p)) if p.expr.is_array() => {
                NamesArray::from_expr(&p.expr, value_loc_of(&source, p.loc)).map(|a| (a, p.loc))
            }
            _ => None,
        };
        if let Some((arr, loc)) = names {
            workspace_map.process_names_array(
                &mut manager.workspace_package_json_cache,
                log,
                arr,
                &source,
                loc,
                None,
                MissingWorkspace::Skip,
            )?;
        }
        (manifest, workspace_map)
    };

    let mut workspaces: Vec<Workspace> = Vec::with_capacity(workspace_map.count());
    for (path, ws) in workspace_map.keys().iter().zip(workspace_map.values()) {
        let name_hash = semver::string::Builder::string_hash(&ws.name);
        let path_str = sbuf!(this).append(path)?;
        this.workspace_paths.put(name_hash, path_str)?;
        if let Some(v) = &ws.version {
            let vs = sbuf!(this).append(v)?;
            let parsed = semver::Version::parse(vs.sliced(string_bytes!(this)));
            if parsed.valid && parsed.wildcard == semver::query::token::Wildcard::None {
                this.workspace_versions
                    .put(name_hash, parsed.version.min())?;
            }
        }
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
            return Err(invalid_lockfile(
                log,
                format_args!(
                    "yarn.lock workspace \"{}\" is not one of the package.json \"workspaces\"",
                    bstr::BStr::new(path)
                ),
            ));
        }
    }

    // yarn `resolutions`, in file order: (parent of a `parent[@range]/name` key,
    // the `name[@range]` segment, target). Yarn skips a key it cannot parse and
    // a value that is not a string.
    let mut resolutions: Vec<(Option<Parent>, &[u8], &[u8])> = Vec::new();
    if let Some(ExprData::EObject(res)) = root_manifest.get(b"resolutions").map(|e| e.data) {
        for p in res.properties.slice() {
            let (Some(k), Some(v)) = (&p.key, &p.value) else {
                continue;
            };
            if let (Some(k), Some(v)) = (as_str(k), as_str(v)) {
                if let Some((parent, pattern)) = resolution_key_parts(k) {
                    resolutions.push((parent, pattern, v));
                }
            }
        }
    }

    // `bun add <name>` / `bun update <name>` as the first command in the project:
    // package.json already holds the range that command is about to resolve, and
    // yarn.lock has nothing for it. Left out of the migrated package, the install
    // sees the dependency as added and resolves it.
    // (A request for a git / tarball / folder has no name yet: package.json holds
    // its literal.)
    let requested: Vec<(&[u8], &[u8])> = manager
        .update_requests
        .iter()
        .map(|r| (r.name, r.version.literal.slice(r.version_buf())))
        .collect();
    let being_added = |name: &[u8], spec: &[u8]| -> bool {
        requested.iter().any(|(requested_name, literal)| {
            if requested_name.is_empty() {
                *literal == name || *literal == spec
            } else {
                *requested_name == name
            }
        }) && [&b"@"[..], b"@npm:"]
            .iter()
            .all(|sep| !descriptor_to_entry.contains(&[name, sep, spec].concat()))
    };

    let mut root_rewrites: Vec<ManifestRewrite> = Vec::new();
    let mut original_specs = OriginalSpecs::default();
    // `patch:` / `portal:` / `link:` values only make sense to yarn: bun gets a
    // patch through `patchedDependencies` and the pinned range as the override,
    // and a folder as `file:`.
    for (_, pattern, target) in &resolutions {
        if root_rewrites.iter().any(|r| &*r.original_spec == *target) {
            continue;
        }
        let name = Dependency::split_name_and_maybe_version(pattern).0;
        if let Some(new_spec) = yarn_only_range_for_bun(name, target, &yarn_links) {
            root_rewrites.push(ManifestRewrite {
                original_spec: Box::from(*target),
                new_spec: Box::from(new_spec),
            });
        }
    }

    // root package
    {
        let mut pkg = lockfile::Package::default();
        if let Some(name) = get_str(&root_manifest, b"name") {
            let hash = semver::string::Builder::string_hash(name);
            pkg.name = sbuf!(this).append_with_hash(name, hash)?;
            pkg.name_hash = hash;
        }
        let (off, len) = append_manifest_dependencies(
            this,
            log,
            &root_manifest,
            Some(&workspaces),
            &mut root_rewrites,
            &mut original_specs,
            &yarn_links,
            &being_added,
        )?;
        pkg.dependencies = ExternalSlice::new(off, len);
        pkg.resolutions = ExternalSlice::new(off, len);
        pkg.meta.id = 0;
        pkg.resolution = Resolution::init_root();
        if let Some(bin) = root_manifest.get(b"bin") {
            pkg.bin = Bin::parse_append(&bin, &mut sbuf!(this), &mut this.buffers.extern_strings)?;
        }
        let hash = pkg.name_hash;
        this.packages.append(pkg)?;
        this.get_or_put_id(0, hash)?;
        if let Some(&idx) = lockfile_workspaces.get(b".") {
            entries[idx].package_id = 0;
        }
    }

    // workspace packages
    for ws in workspaces.iter_mut() {
        let mut json_path = bun_paths::AutoAbsPath::init_top_level_dir();
        let _ = json_path.join(&[&ws.path, b"package.json"]); // bounded input
        let manifest: Expr = match manager
            .workspace_package_json_cache
            .get_with_path(log, json_path.slice(), Default::default())
            .unwrap()
        {
            Ok(j) => j.root,
            Err(_) => return Err(Error::InvalidPackageJSON),
        };
        let name_hash = semver::string::Builder::string_hash(&ws.name);
        let mut pkg = lockfile::Package {
            name: sbuf!(this).append_with_hash(&ws.name, name_hash)?,
            name_hash,
            resolution: Resolution::init(TaggedValue::Workspace(sbuf!(this).append(&ws.path)?)),
            ..Default::default()
        };
        let (off, len) = append_manifest_dependencies(
            this,
            log,
            &manifest,
            None,
            &mut ws.rewrites,
            &mut original_specs,
            &yarn_links,
            &being_added,
        )?;
        pkg.dependencies = ExternalSlice::new(off, len);
        pkg.resolutions = ExternalSlice::new(off, len);
        if let Some(bin) = manifest.get(b"bin") {
            pkg.bin = Bin::parse_append(&bin, &mut sbuf!(this), &mut this.buffers.extern_strings)?;
        } else if let Some(bin) = manifest.get(b"directories").and_then(|d| d.get(b"bin")) {
            pkg.bin = Bin::parse_append_from_directories(&bin, &mut sbuf!(this))?;
        }
        ws.package_id = this.append_package_dedupe(&mut pkg)?;
        if let Some(&idx) = lockfile_workspaces.get(&ws.path) {
            entries[idx].package_id = ws.package_id;
        }
    }

    // the directory a `::locator=` param points at: a workspace's path, or the
    // folder of a `file:` / `portal:` / `link:` package (itself relative to its owner)
    let workspace_path_of_locator = |encoded: &[u8]| -> Option<Vec<u8>> { locator_dir(encoded, 0) };

    // -- 3. third-party packages -----------------------------------------------
    // package id -> the lockfile entry it was built from (third-party packages)
    let mut entry_of_package: Vec<Option<usize>> = Vec::new();
    for i in 0..entries.len() {
        if entries[i].kind != EntryKind::Package {
            continue;
        }
        let entry_expr = entries[i].expr;
        let name = entries[i].name;
        let reference = entries[i].reference;
        let name_hash = semver::string::Builder::string_hash(name);
        let (head, params) = split_reference_params(reference);

        let resolution: Resolution = if let Some(version) = head.strip_prefix(b"npm:") {
            // aliases never appear in `resolution`; it always names the real package
            let version_str = sbuf!(this).append(version)?;
            let parsed = semver::Version::parse(version_str.sliced(string_bytes!(this)));
            if !parsed.valid || parsed.wildcard != semver::query::token::Wildcard::None {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "yarn.lock entry \"{}\" has an invalid version",
                        bstr::BStr::new(reference)
                    ),
                );
                return Err(Error::InvalidYarnBerryLockfile);
            }
            let version = parsed.version.min();
            let url = match param(&params, b"__archiveUrl") {
                Some(url) => sbuf!(this).append(url)?,
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
        } else if let Some((protocol, path)) = [b"file:".as_slice(), b"portal:", b"link:"]
            .iter()
            .find_map(|p| head.strip_prefix(*p).map(|rest| (*p, rest)))
        {
            // `file:./x#./x::hash=..&locator=..`: drop the repeated `#path`
            let path = strings::split_once_char(path, b'#').map_or(path, |(p, _)| p);
            // relative to the package that declared it (`::locator=name@workspace:path`)
            let base = param(&params, b"locator")
                .and_then(workspace_path_of_locator)
                .unwrap_or_default();
            let joined = join_folder(&base, path);
            let rel = joined.as_slice();
            if protocol != b"file:" && !silent {
                // bun has no symlinked-folder protocol (`link:` means a package
                // registered with `bun link`), so these install as copies.
                bun_core::warn!(
                    "\"{}@{}{}\" is migrated as \"file:{}\"; bun installs a copy of the folder instead of linking it (make it a workspace to keep it linked)",
                    bstr::BStr::new(name),
                    bstr::BStr::new(protocol),
                    bstr::BStr::new(path),
                    bstr::BStr::new(&joined),
                );
            }
            if Dependency::is_tarball(rel) {
                Resolution::init(TaggedValue::LocalTarball(sbuf!(this).append(&joined)?))
            } else {
                Resolution::init(TaggedValue::Folder(sbuf!(this).append(&joined)?))
            }
        } else if is_git_reference(head) {
            git_resolution(this, log, name, head)?
        } else if head.starts_with(b"https://") || head.starts_with(b"http://") {
            Resolution::init(TaggedValue::RemoteTarball(sbuf!(this).append(head)?))
        } else {
            // exec:, custom protocols from plugins, ...
            return Err(invalid_lockfile(
                log,
                format_args!(
                    "yarn.lock entry \"{}@{}\" uses a protocol bun does not support",
                    bstr::BStr::new(name),
                    bstr::BStr::new(reference),
                ),
            ));
        };

        let mut pkg = lockfile::Package {
            name: sbuf!(this).append_with_hash(name, name_hash)?,
            name_hash,
            resolution,
            ..Default::default()
        };
        let (off, len) = append_entry_dependencies(this, log, data, name, &entry_expr)?;
        pkg.dependencies = ExternalSlice::new(off, len);
        pkg.resolutions = ExternalSlice::new(off, len);
        if let Some(bin) = entry_expr.get(b"bin") {
            pkg.bin = Bin::parse_append(&bin, &mut sbuf!(this), &mut this.buffers.extern_strings)?;
        }
        if let Some(cond) = get_str(&entry_expr, b"conditions") {
            let (os, cpu) = parse_conditions(cond);
            pkg.meta.os = os;
            pkg.meta.arch = cpu;
        }
        entries[i].package_id = this.append_package_dedupe(&mut pkg)?;
        if let Some(slot) = entry_of_package.get_mut(entries[i].package_id as usize) {
            *slot = Some(i);
        } else {
            entry_of_package.resize(entries[i].package_id as usize + 1, None);
            entry_of_package[entries[i].package_id as usize] = Some(i);
        }
    }

    // patch entries -> same package as the locator they patch (+ patchedDependencies).
    // A patch can wrap another patch (yarn's builtin compat patch around a user
    // patch), so repeat until every chain reached a package.
    let mut patched: Vec<(Vec<u8>, Vec<u8>)> = Vec::new(); // ("name@version", patch path)
    // In yarn the patched package is a second package next to its source; here it
    // is the same one.
    let mut patched_packages: bun_collections::HashMap<PackageID, ()> = Default::default();
    let mut pending: Vec<usize> = (0..entries.len())
        .filter(|&i| entries[i].kind == EntryKind::Patch)
        .collect();
    loop {
        let before = pending.len();
        let mut still_pending = Vec::new();
        for &i in &pending {
            let name = entries[i].name;
            let (spec, params) = decode_patch_spec(&entries[i].reference[b"patch:".len()..]);
            // the inner locator may itself carry ::params
            let inner_key = match split_locator(&spec.inner) {
                Some((n, r)) => locator_key(n, r),
                None => locator_key(name, &spec.inner),
            };
            let Some(&inner_idx) = locator_to_entry.get(&inner_key) else {
                return Err(invalid_lockfile(
                    log,
                    format_args!(
                        "yarn.lock patch \"{}\" patches \"{}\", which is not in the lockfile",
                        bstr::BStr::new(entries[i].reference),
                        bstr::BStr::new(&inner_key),
                    ),
                ));
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
            let mut paths = project_patch_paths(&spec.source, &params, &workspace_path_of_locator);
            if paths.is_empty() {
                continue;
            }
            if let Some(path) = paths.iter().find(|p| {
                p.is_empty()
                    || p.as_slice() == b"."
                    || strings::contains_char(p, 0)
                    || bun_paths::is_absolute(p)
                    || strings::split_any(p, b"/\\").any(|part| part == b"..")
            }) {
                return Err(invalid_lockfile(
                    log,
                    format_args!(
                        "yarn.lock patch file \"{}\" is not a file inside the project",
                        bstr::BStr::new(path)
                    ),
                ));
            }
            let Some(key) = patched_dependency_key(this, entries[inner_idx].name, pid)? else {
                return Err(invalid_lockfile(
                    log,
                    format_args!(
                        "yarn.lock patches \"{}\" with \"{}\"; bun does not patch packages installed from a project folder",
                        bstr::BStr::new(entries[inner_idx].name),
                        bstr::BStr::new(&paths[0]),
                    ),
                ));
            };
            if paths.len() > 1 {
                return Err(invalid_lockfile(
                    log,
                    format_args!(
                        "yarn.lock patches \"{}\" with {} files (\"{}\", ...); bun applies one patch per package — merge them into one file",
                        bstr::BStr::new(&key),
                        paths.len(),
                        bstr::BStr::new(&paths[0]),
                    ),
                ));
            }
            // several descriptors / `resolutions` selectors can point at one patch entry
            let path = paths.swap_remove(0);
            match patched.iter().find(|(k, _)| *k == key) {
                None => patched.push((key, path)),
                Some((_, existing)) if *existing != path => {
                    return Err(invalid_lockfile(
                        log,
                        format_args!(
                            "yarn.lock patches \"{}\" with both \"{}\" and \"{}\"; bun applies one patch per package",
                            bstr::BStr::new(&key),
                            bstr::BStr::new(existing),
                            bstr::BStr::new(&path),
                        ),
                    ));
                }
                Some(_) => {}
            }
        }
        if still_pending.is_empty() || still_pending.len() == before {
            break;
        }
        pending = still_pending;
    }

    // -- 4. bind dependency edges ---------------------------------------------
    let dep_count = this.buffers.dependencies.len();
    this.buffers.resolutions.clear();
    this.buffers
        .resolutions
        .resize(dep_count, INVALID_PACKAGE_ID);
    let mut key: Vec<u8> = Vec::with_capacity(128);
    // yarn binds the target of a `resolutions` rule to the root workspace
    let root_locator: Vec<u8> = {
        let root_name = lockfile_workspaces
            .get(b".")
            .map_or(&b""[..], |&idx| entries[idx].name);
        let mut enc = Vec::new();
        percent_encode(&mut enc, &[root_name, b"@workspace:."].concat());
        enc
    };

    let pkg_count = this.packages.len();
    for pkg_id in 0..pkg_count {
        // this package's yarn locator, as (name, reference)
        let owner: Option<(Vec<u8>, Vec<u8>)> = {
            let res = this.packages.items_resolution()[pkg_id];
            let ws_path: Option<&[u8]> = match res.tag {
                crate::resolution::Tag::Root => Some(b"."),
                crate::resolution::Tag::Workspace => {
                    Some(res.workspace().slice(string_bytes!(this)))
                }
                _ => None,
            };
            match ws_path {
                // yarn names an unnamed workspace itself (`root-workspace-0b6124`),
                // so prefer the name its lockfile entry carries
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
        // relative protocols (`file:`, `portal:`, `link:`) are keyed by the package
        // that declared them
        let owner_locator: Option<Vec<u8>> = owner.as_ref().map(|(name, reference)| {
            let mut enc = Vec::with_capacity(name.len() + reference.len() + 16);
            percent_encode(&mut enc, &[&name[..], b"@", reference].concat());
            enc
        });
        let is_patched = patched_packages.contains_key(&(pkg_id as PackageID));

        let deps = this.packages.items_dependencies()[pkg_id];
        for dep_id in deps.begin()..deps.end() {
            let dep = this.buffers.dependencies[dep_id as usize].clone();
            let name = dep.name.slice(string_bytes!(this));
            let original_literal = dep.version.literal.slice(string_bytes!(this));
            // `catalog:` -> the catalog's range, which is what yarn keyed the entry by
            let catalog_range: Option<Vec<u8>> =
                if dep.version.tag == dependency::VersionTag::Catalog {
                    this.catalogs
                        .get(this, *dep.version.catalog(), dep.name)
                        .map(|d| d.version.literal.slice(string_bytes!(this)).to_vec())
                } else {
                    None
                };
            let literal: &[u8] = match original_specs.get(&dep_id) {
                Some(spec) => spec,
                None => catalog_range.as_deref().unwrap_or(original_literal),
            };

            let lookup = |key: &[u8]| -> Option<usize> { descriptor_to_entry.get(key).copied() };
            // The migration rewrites `portal:` / `link:` ranges in package.json to
            // `file:` before the install saves bun.lock. When that install fails, the
            // next one migrates again and finds its own spelling.
            let rewritten_from: Vec<Vec<u8>> = match literal.strip_prefix(b"file:") {
                Some(path) => vec![[b"portal:", path].concat(), [b"link:", path].concat()],
                None => Vec::new(),
            };

            // Yarn passes every dependency (peers are not dependencies) through
            // `resolutions` before it looks the descriptor up, and takes the first
            // rule in file order whose parent and descriptor both match. A rule
            // with `parent@range` names the parent's locator, which a patched
            // package no longer has.
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
                // 1. exactly as written (protocol descriptors: workspace:, patch:, npm: aliases, URLs)
                key.clear();
                key.extend_from_slice(name);
                key.push(b'@');
                key.extend_from_slice(literal);
                found = lookup(&key);
                // 2. how yarn normalizes a bare range / tag
                if found.is_none() && !has_protocol(literal) {
                    key.truncate(name.len() + 1);
                    if dep.version.tag == dependency::VersionTag::Github
                        && !literal.starts_with(b"github:")
                    {
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
                    for spelling in
                        core::iter::once(literal).chain(rewritten_from.iter().map(Vec::as_slice))
                    {
                        key.clear();
                        key.extend_from_slice(name);
                        key.push(b'@');
                        key.extend_from_slice(spelling);
                        key.extend_from_slice(b"::locator=");
                        key.extend_from_slice(owner);
                        found = lookup(&key);
                        if found.is_some() {
                            break;
                        }
                    }
                }
                // 4. workspaces by name (root -> workspace edges, and `workspace:` ranges however spelled)
                if found.is_none()
                    && (dep.behavior.is_workspace()
                        || dep.version.tag == dependency::VersionTag::Workspace)
                {
                    if let Some(ws_path) = this.workspace_paths.get(&dep.name_hash) {
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
                    this.buffers.resolutions[dep_id as usize] = pid;
                }
                // a peer is bound at install time, to a package another edge brought in
                _ if dep.behavior.is_peer() || dep.behavior.is_workspace() => {}
                _ => {
                    return Err(invalid_lockfile(
                        log,
                        format_args!(
                            "yarn.lock has no entry for \"{}@{}\", a dependency of \"{}\"",
                            bstr::BStr::new(name),
                            bstr::BStr::new(original_literal),
                            bstr::BStr::new(owner.as_ref().map_or(&b""[..], |(n, _)| n)),
                        ),
                    ));
                }
            }
        }
    }

    // A fresh resolve only records os/cpu for registry packages.
    crate::migration::clear_non_registry_platform_constraints(this);

    this.tag_workspace_links(manager.options.link_workspace_packages);
    if this.resolve(log).is_err() {
        return Err(Error::LockfileResolveFailed);
    }

    // bins yarn did not record (older lockfiles), os/cpu for lockfiles without
    // `conditions`, and tarball integrity, all from the registry manifests.
    this.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration::<true, true>(manager)?;
    // Yarn's `checksum` covers yarn's own zip of the package, so the registry
    // manifest is the only integrity there is for the tarball. Without one (the
    // registry was not reachable, or the manifest does not list an
    // `__archiveUrl`) the tarball would be installed unverified.
    // (An entry no edge reaches is not installed and not written to bun.lock.)
    let mut reachable = vec![false; this.packages.len()];
    let mut queue: Vec<PackageID> = vec![0];
    reachable[0] = true;
    while let Some(pid) = queue.pop() {
        let edges = this.packages.items_resolutions()[pid as usize];
        for &next in edges.get(&this.buffers.resolutions) {
            if let Some(seen @ false) = reachable.get_mut(next as usize) {
                *seen = true;
                queue.push(next);
            }
        }
    }
    for (pid, res) in this.packages.items_resolution().iter().enumerate() {
        if reachable[pid]
            && res.tag == crate::resolution::Tag::Npm
            && !this.packages.items_meta()[pid].integrity.tag.is_supported()
        {
            return Err(invalid_lockfile(
                log,
                format_args!(
                    "could not get the integrity of \"{}@{}\" from the registry",
                    bstr::BStr::new(this.packages.items_name()[pid].slice(string_bytes!(this))),
                    res.fmt(string_bytes!(this), bun_core::fmt::PathSep::Posix),
                ),
            ));
        }
    }

    // -- 5. package.json edits ----------------------------------------------------
    // patches into the lockfile so this very install applies them
    for (key, path) in &patched {
        let hash = semver::string::Builder::string_hash(key);
        let path = sbuf!(this).append(path)?;
        this.patched_dependencies
            .put(hash, lockfile::PatchedDep::with_path(path))?;
    }
    // The edits go to the cached package.json trees. They are written with the
    // install's other package.json edits, after bun.lock is saved, so a failed
    // migration or install, `--dry-run` and commands that only read the lockfile
    // leave every package.json as it was.
    let mut edited: Vec<(WorkspaceTarget, Vec<&'static str>)> = Vec::new();
    for ws in &workspaces {
        if ws.rewrites.is_empty() {
            continue;
        }
        let mut json_path = bun_paths::AutoAbsPath::init_top_level_dir();
        let _ = json_path.join(&[&ws.path, b"package.json"]); // bounded input
        if let Some(changed) =
            edit_package_json(manager, log, json_path.slice(), &ws.rewrites, &[], None)?
        {
            let target = WorkspaceTarget {
                name: ws.name.clone(),
                name_hash: Some(semver::string::Builder::string_hash(&ws.name)),
                package_json_path: json_path.slice().into(),
            };
            edited.push((target, changed));
        }
    }
    if let Some(changed) = edit_package_json(
        manager,
        log,
        root_json_path.slice(),
        &root_rewrites,
        &patched,
        Some(&yarnrc.catalogs),
    )? {
        let target = WorkspaceTarget {
            name: Box::default(),
            name_hash: None,
            package_json_path: root_json_path.slice().into(),
        };
        edited.push((target, changed));
    }
    // bun reads `resolutions` from package.json on every install; parse them the
    // same way now (after the `patch:` values were rewritten) so the next install
    // does not see them as changed.
    parse_root_overrides(this, manager, log, root_json_path.slice(), &workspace_map)?;

    if cfg!(debug_assertions) {
        this.verify_data()?;
    }
    this.meta_hash = this.generate_meta_hash(false, this.packages.len())?;

    // bun.lock is saved for the edited package.json files, so a command that does
    // not write package.json (`--dry-run`, `--no-save`) cannot keep the two in step.
    if !edited.is_empty() && !manager.options.do_.contains(Do::WRITE_PACKAGE_JSON) {
        return Err(invalid_lockfile(
            log,
            format_args!(
                "migrating yarn.lock has to edit package.json ({}), and this command does not write package.json",
                edited[0].1.join(", "),
            ),
        ));
    }
    for (target, changed) in edited {
        if !silent {
            let dirname =
                bun_paths::dirname(&target.package_json_path).unwrap_or(&target.package_json_path);
            let rel = strings::without_prefix(
                dirname,
                strings::without_trailing_slash(
                    crate::bun_fs::FileSystem::instance().top_level_dir(),
                ),
            );
            let rel = strings::trim_prefix(rel, b"/");
            bun_core::pretty_errorln!(
                "<d>{} in <r><green>{}{}package.json<r>",
                changed.join(", "),
                bstr::BStr::new(rel),
                if rel.is_empty() { "" } else { "/" },
            );
        }
        package_json_write_back::record(manager, target, false);
    }

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile: this,
        migrated: lockfile::Migrated::Yarn,
        serializer_result: Default::default(),
        format: lockfile::Format::Text,
    }))
}

/// The registry `name` is fetched from. When yarn's configuration names a
/// registry for the package, it has to be the one bun is configured with: the
/// tarball, its manifest (where the integrity comes from) and every later
/// install of the package come from bun's.
fn registry_for(
    manager: &PackageManager,
    log: &mut bun_ast::Log,
    yarnrc: &YarnRc,
    name: &[u8],
) -> Result<Vec<u8>, Error> {
    let configured = registry_without_auth(manager.scope_for_package_name(name).url.href());
    let configured: &[u8] = &configured;
    let from_yarn: Option<&[u8]> = if name.first() == Some(&b'@') {
        let scope = npm::registry::Scope::get_name(name);
        match yarnrc.scope_registries.get(scope) {
            Some(url) => Some(&**url),
            // yarn's builtin default for the `@jsr` scope
            None if scope == b"jsr" => Some(b"https://npm.jsr.io"),
            None => yarnrc.registry.as_deref(),
        }
    } else {
        yarnrc.registry.as_deref()
    };
    let Some(url) = from_yarn else {
        return Ok(configured.to_vec());
    };
    // yarn substitutes `${VAR}` in rc values; a registry spelled that way cannot
    // be compared with bun's
    if strings::contains(url, b"${") {
        return Err(invalid_lockfile(
            log,
            format_args!(
                "yarn's registry for \"{}\" uses an environment variable (\"{}\"); bun cannot tell if it is the registry bun is configured with",
                bstr::BStr::new(name),
                bun_core::fmt::redacted_npm_url(url),
            ),
        ));
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
    if same(&canonical(url), &canonical(configured)) {
        return Ok(configured.to_vec());
    }
    Err(invalid_lockfile(
        log,
        format_args!(
            "yarn fetches \"{}\" from {} and bun is configured to fetch it from {}; add the registry to bunfig.toml or .npmrc",
            bstr::BStr::new(name),
            // a registry URL can carry a password or a token
            bun_core::fmt::redacted_npm_url(url),
            bun_core::fmt::redacted_npm_url(configured),
        ),
    ))
}

/// A registry href can carry `user:password@` (one that comes from an environment
/// variable keeps it). The tarball URLs built on it are written to bun.lock,
/// which is committed, so they are built on the href without it.
pub(crate) fn registry_without_auth(href: &[u8]) -> Vec<u8> {
    let url = bun_url::URL::parse(href);
    if url.username.is_empty() && url.password.is_empty() {
        href.to_vec()
    } else {
        url.href_without_auth().into_vec()
    }
}

/// yarn always locks git dependencies with `#commit=<sha>`; the prefixes cover
/// hand-edited lockfiles.
fn is_git_reference(head: &[u8]) -> bool {
    if strings::contains(head, b"#commit=") {
        return true;
    }
    if [
        b"git+".as_slice(),
        b"git://",
        b"github:",
        b"ssh://",
        b"git@",
    ]
    .iter()
    .any(|p| head.starts_with(p))
    {
        return true;
    }
    let url = strings::split_once_char(head, b'#').map_or(head, |(url, _)| url);
    (url.starts_with(b"https://") || url.starts_with(b"http://")) && url.ends_with(b".git")
}

/// `github:o/r#commit=sha`, `https://github.com/o/r.git#commit=sha`,
/// `git+ssh://git@host/o/r.git#commit=sha`, `ssh://...#commit=sha`: pinned to
/// the commit yarn locked.
fn git_resolution(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    name: &[u8],
    head: &[u8],
) -> Result<Resolution, Error> {
    let (url, fragment) = match strings::split_once_char(head, b'#') {
        Some((url, fragment)) => (url, fragment),
        None => (head, &b""[..]),
    };
    let mut commit = fragment;
    for kv in strings::split(fragment, b"&") {
        if let Some(c) = kv.strip_prefix(b"commit=") {
            commit = c;
        } else if kv.starts_with(b"workspace=") || kv.starts_with(b"cwd=") {
            // a package inside the repository; a bun git dependency is the repository root
            return Err(invalid_lockfile(
                log,
                format_args!(
                    "yarn.lock entry \"{}@{}\" is a package inside a git repository, which bun does not support",
                    bstr::BStr::new(name),
                    bstr::BStr::new(head),
                ),
            ));
        }
    }
    let mut url_buf: Vec<u8> = Vec::new();
    let url: &[u8] = if let Some(gh) = url.strip_prefix(b"github:") {
        write!(
            &mut url_buf,
            "https://github.com/{}.git",
            bstr::BStr::new(gh)
        )
        .map_err(|_| AllocError)?;
        &url_buf
    } else {
        url.strip_prefix(b"git+").unwrap_or(url)
    };
    // `resolved` is the checked-out commit; a branch or tag (only in a hand-edited
    // lockfile — yarn always writes `#commit=`) is left for the install to resolve.
    let is_sha = commit.len() == 40 && commit.iter().all(u8::is_ascii_hexdigit);
    Ok(Resolution::init(TaggedValue::Git(Repository {
        owner: String::default(),
        repo: sbuf!(this).append(url)?,
        committish: sbuf!(this).append(commit)?,
        resolved: if is_sha {
            sbuf!(this).append(commit)?
        } else {
            String::default()
        },
        package_name: sbuf!(this).append(name)?,
    })))
}

/// A `resolutions` key -> (the parent for `parent[@range]/name` keys, the
/// `name[@range]` segment). Yarn's grammar: an optional parent, then `/`, then
/// the descriptor; a leading `@scope/` belongs to the name and a range never
/// contains `/` (`@babel/core@npm:7.0.0/regenerator-runtime`, `ms@^2`). `None`
/// for what yarn rejects (and then ignores): glob keys (`**/left-pad`) and more
/// than one parent.
struct Parent<'a> {
    name: &'a [u8],
    range: &'a [u8],
}

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
    // `@scope/name@range` / `name@range`
    let from = usize::from(first.first() == Some(&b'@'));
    let parent = match strings::index_of_char_usize(&first[from..], b'@') {
        Some(i) => Parent {
            name: &first[..from + i],
            range: &first[from + i + 1..],
        },
        None => Parent {
            name: first,
            range: b"",
        },
    };
    Some((Some(parent), descriptor))
}

/// `name`, `name@<literal>`, `name@npm:<literal>` (either the literal as
/// written or the catalog-translated one).
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
    let range = range.strip_prefix(b"npm:").unwrap_or(range);
    range == strip_npm_protocol(original_literal) || range == strip_npm_protocol(literal)
}

/// The entry a matched `resolutions` rule sends an edge to. Yarn replaces the
/// edge's range with the rule's value (`1.2.3`, `npm:other@1.2.3`,
/// `patch:<locator>#...`, `file:./fork`, ...), normalizes it and binds it to
/// the root workspace, so the lockfile has a key for exactly that descriptor.
fn resolution_target_entry(
    name: &[u8],
    target: &[u8],
    root_locator: &[u8],
    descriptor_to_entry: &StringArrayHashMap<usize>,
) -> Option<usize> {
    let mut key: Vec<u8> = Vec::with_capacity(name.len() + target.len() + root_locator.len() + 16);
    key.extend_from_slice(name);
    key.push(b'@');
    // `file:` may be this migration's own rewrite of `portal:` / `link:`
    let path = target.strip_prefix(b"file:");
    let spellings = [
        Some((&b""[..], target)),
        (!has_protocol(target)).then_some((&b"npm:"[..], target)),
        path.map(|path| (&b"portal:"[..], path)),
        path.map(|path| (&b"link:"[..], path)),
    ];
    for (prefix, rest) in spellings.into_iter().flatten() {
        key.truncate(name.len() + 1);
        key.extend_from_slice(prefix);
        key.extend_from_slice(rest);
        if let Some(&i) = descriptor_to_entry.get(&key) {
            return Some(i);
        }
        // relative protocols carry the workspace they are bound to
        key.extend_from_slice(b"::locator=");
        key.extend_from_slice(root_locator);
        if let Some(&i) = descriptor_to_entry.get(&key) {
            return Some(i);
        }
    }
    None
}

/// Names under `dependenciesMeta` / `peerDependenciesMeta` with `optional: true`.
fn optional_names(source: &[u8], entry: &Expr, meta_key: &[u8]) -> Vec<&'static [u8]> {
    let mut names = Vec::new();
    let Some(meta) = entry.get(meta_key) else {
        return names;
    };
    let ExprData::EObject(obj) = &meta.data else {
        return names;
    };
    for p in obj.properties.slice() {
        let (Some(k), Some(v)) = (&p.key, &p.value) else {
            continue;
        };
        if v.get(b"optional").and_then(|e| e.as_bool()) == Some(true) {
            if let Some(k) = scalar_text(source, k) {
                names.push(k);
            }
        }
    }
    names
}

/// Dependencies of a third-party entry: `dependencies` (optional ones per
/// `dependenciesMeta`) and `peerDependencies` (optional per `peerDependenciesMeta`).
fn append_entry_dependencies(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    source: &[u8],
    entry_name: &[u8],
    entry: &Expr,
) -> Result<(u32, u32), Error> {
    let off = this.buffers.dependencies.len();
    let optional_deps = optional_names(source, entry, b"dependenciesMeta");
    let optional_peers = optional_names(source, entry, b"peerDependenciesMeta");
    for (group, behavior, optional) in [
        (b"dependencies".as_slice(), Behavior::PROD, &optional_deps),
        (
            b"peerDependencies".as_slice(),
            Behavior::PEER,
            &optional_peers,
        ),
    ] {
        let Some(obj) = entry.get(group) else {
            continue;
        };
        let ExprData::EObject(obj) = &obj.data else {
            continue;
        };
        for p in obj.properties.slice() {
            let (Some(k), Some(v)) = (&p.key, &p.value) else {
                continue;
            };
            let (Some(name), Some(spec)) = (scalar_text(source, k), scalar_text(source, v)) else {
                return Err(invalid_lockfile(
                    log,
                    format_args!(
                        "yarn.lock entry \"{}\" has a dependency that is not a string",
                        bstr::BStr::new(entry_name)
                    ),
                ));
            };
            let mut behavior = behavior;
            if optional.contains(&name) {
                if behavior.is_peer() {
                    behavior.insert(Behavior::OPTIONAL);
                } else {
                    behavior = Behavior::OPTIONAL;
                }
            }
            append_dependency(this, log, name, spec, behavior)?;
        }
    }
    // peers listed only in peerDependenciesMeta
    for name in &optional_peers {
        if entry
            .get(b"peerDependencies")
            .is_none_or(|peers| peers.get(name).is_none())
        {
            append_dependency(this, log, name, b"*", Behavior::PEER | Behavior::OPTIONAL)?;
        }
    }
    let end = this.buffers.dependencies.len();
    sort_dependencies(this, off);
    Ok((off as u32, (end - off) as u32))
}

/// Root / workspace dependencies from package.json, with the same groups and
/// duplicate handling as `Package::parse`.
fn append_manifest_dependencies(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    manifest: &Expr,
    root_workspaces: Option<&Vec<Workspace>>,
    rewrites: &mut Vec<ManifestRewrite>,
    original_specs: &mut OriginalSpecs,
    yarn_links: &StringArrayHashMap<()>,
    being_added: &dyn Fn(&[u8], &[u8]) -> bool,
) -> Result<(u32, u32), Error> {
    let off = this.buffers.dependencies.len();
    let optional_peers = optional_names(b"", manifest, b"peerDependenciesMeta");
    let mut seen: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // name -> yarn's spelling of a rewritten range (bound to dependency ids after the sort below)
    let mut originals: StringArrayHashMap<&'static [u8]> = StringArrayHashMap::new();
    for (group, behavior) in [
        (b"dependencies".as_slice(), Behavior::PROD),
        (b"devDependencies".as_slice(), Behavior::DEV),
        (b"optionalDependencies".as_slice(), Behavior::OPTIONAL),
        (b"peerDependencies".as_slice(), Behavior::PEER),
    ] {
        let Some(obj) = manifest.get(group) else {
            continue;
        };
        let ExprData::EObject(obj) = &obj.data else {
            continue;
        };
        for p in obj.properties.slice() {
            let (Some(k), Some(v)) = (&p.key, &p.value) else {
                continue;
            };
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
                    // an optionalDependencies entry replaces the dependencies one (as in
                    // `Package::parse`); a dev duplicate is dropped
                    if !behavior.is_optional() {
                        continue;
                    }
                    replaces = Some(*e.value_ptr);
                } else {
                    *e.value_ptr = this.buffers.dependencies.len();
                }
            }
            // Ranges only yarn understands: depend on what bun can read instead;
            // package.json is rewritten to match after migration.
            let rewritten = yarn_only_range_for_bun(name, spec, yarn_links);
            if !behavior.is_peer() {
                // an earlier group's rewrite of this name no longer applies
                originals.swap_remove(name);
            }
            if let Some(new_spec) = rewritten {
                if !behavior.is_peer() {
                    originals.put(name, spec)?;
                }
                // interned: the dependency literal points at it
                let new_spec: &'static [u8] = bun_ast::data_store_dupe_str(&new_spec);
                if !rewrites.iter().any(|r| &*r.original_spec == spec) {
                    rewrites.push(ManifestRewrite {
                        original_spec: Box::from(spec),
                        new_spec: Box::from(new_spec),
                    });
                }
                spec = new_spec;
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
    if let Some(workspaces) = root_workspaces {
        // bun models workspaces as dependencies of the root package
        for ws in workspaces {
            let name_hash = semver::string::Builder::string_hash(&ws.name);
            let dep = Dependency {
                name: sbuf!(this).append_with_hash(&ws.name, name_hash)?,
                name_hash,
                behavior: Behavior::WORKSPACE,
                version: dependency::Version {
                    tag: dependency::VersionTag::Workspace,
                    value: dependency::Value {
                        workspace: sbuf!(this).append(&ws.path)?,
                    },
                    ..Default::default()
                },
            };
            this.buffers.dependencies.push(dep);
        }
    }
    let end = this.buffers.dependencies.len();
    sort_dependencies(this, off);
    if originals.count() > 0 {
        let bytes = this.buffers.string_bytes.as_slice();
        for (i, dep) in this.buffers.dependencies[off..end].iter().enumerate() {
            if dep.behavior.is_peer() || dep.behavior.is_workspace() {
                continue;
            }
            if let Some(spec) = originals.get(dep.name.slice(bytes)) {
                original_specs.insert((off + i) as DependencyID, Box::from(*spec));
            }
        }
    }
    Ok((off as u32, (end - off) as u32))
}

/// What bun should read instead of a yarn-only range: `patch:…` -> the range it
/// patches, `portal:`/`link:` path -> `file:` path. `None` when bun reads it fine.
fn yarn_only_range_for_bun(
    name: &[u8],
    spec: &[u8],
    yarn_links: &StringArrayHashMap<()>,
) -> Option<Vec<u8>> {
    if spec.starts_with(b"patch:") {
        // the patched range may itself be yarn-only (`patch:` of a `portal:` package)
        let inner = patch_inner_range(spec);
        return Some(
            yarn_only_range_for_bun(name, inner, yarn_links).unwrap_or_else(|| inner.to_vec()),
        );
    }
    // `portal:` is always a path; a bare `link:name` could be a `bun link`
    // registration, so `link:` needs to look like a path or be what yarn locked as one
    spec.strip_prefix(b"portal:")
        .or_else(|| {
            spec.strip_prefix(b"link:").filter(|p| {
                p.starts_with(b".")
                    || bun_paths::is_absolute(p)
                    || strings::contains_char(p, b'/')
                    || yarn_links.contains(&[name, b"@", spec].concat())
            })
        })
        .filter(|p| !p.is_empty())
        .map(|path| [b"file:".as_slice(), path].concat())
}

/// `patch:<locator>#<source>` -> the range of the locator being patched
/// (`patch:ms@npm%3A2.1.3#~/.yarn/patches/ms.patch` -> `2.1.3`).
fn patch_inner_range(spec: &[u8]) -> &'static [u8] {
    let rest = spec.strip_prefix(b"patch:").unwrap_or(spec);
    let (patch, _) = decode_patch_spec(rest);
    let inner_ref: &[u8] = split_locator(&patch.inner).map_or(&patch.inner[..], |(_, r)| r);
    let (range, _) = split_reference_params(inner_ref);
    // interned: dependency literals and rewritten package.json nodes point at it
    bun_ast::data_store_dupe_str(strip_npm_protocol(range))
}

fn append_dependency(
    this: &mut Lockfile,
    log: &mut bun_ast::Log,
    name: &[u8],
    spec: &[u8],
    behavior: Behavior,
) -> Result<(), Error> {
    let name_hash = semver::string::Builder::string_hash(name);
    let name = sbuf!(this).append_external_with_hash(name, name_hash)?;
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

fn sort_dependencies(this: &mut Lockfile, off: usize) {
    let bytes = this.buffers.string_bytes.as_slice();
    let mut appended = this.buffers.dependencies.split_off(off);
    bun_collections::index_sort::sort_vec_by(&mut appended, |a, b| Dependency::cmp(bytes, a, b));
    this.buffers.dependencies.append(&mut appended);
}

fn string_expr(s: &[u8]) -> Expr {
    // Interned into the store that backs the cached package.json tree, which
    // outlives this function.
    Expr::init(
        E::EString::init(bun_ast::data_store_dupe_str(s)),
        bun_ast::Loc::EMPTY,
    )
}

fn object_expr(props: bun_alloc::AstVec<bun_ast::G::Property>) -> Expr {
    Expr::init(
        E::Object {
            properties: props,
            ..Default::default()
        },
        bun_ast::Loc::EMPTY,
    )
}

fn sorted_object(map: &StringArrayHashMap<Box<[u8]>>) -> Expr {
    let mut pairs: Vec<(&[u8], &[u8])> = map.iter().map(|(k, v)| (&**k, &**v)).collect();
    pairs.sort_unstable();
    let mut props = bun_alloc::AstAlloc::vec();
    for (k, v) in pairs {
        VecExt::append(
            &mut props,
            bun_ast::G::Property {
                key: Some(string_expr(k)),
                value: Some(string_expr(v)),
                ..Default::default()
            },
        );
    }
    object_expr(props)
}

/// After migration: `patch:` / `portal:` / `link:` ranges become ones bun can
/// parse, project patches go to `patchedDependencies`, and .yarnrc.yml catalogs
/// go to `workspaces.catalog(s)`, so the project keeps working with bun alone.
/// Existing keys are left alone. Edits the cached tree and returns what
/// changed.
fn edit_package_json(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    abs_path: &[u8],
    rewrites: &[ManifestRewrite],
    patched: &[(Vec<u8>, Vec<u8>)],
    catalogs: Option<&StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>>,
) -> Result<Option<Vec<&'static str>>, Error> {
    let has_catalogs = catalogs.is_some_and(|c| c.iter().any(|(_, m)| m.count() > 0));
    if rewrites.is_empty() && patched.is_empty() && !has_catalogs {
        return Ok(None);
    }
    let entry = match manager
        .workspace_package_json_cache
        .get_with_path(
            log,
            abs_path,
            crate::GetJsonOptions {
                guess_indentation: true,
                init_reset_store: false,
            },
        )
        .unwrap()
    {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let mut json = entry.root;
    if !json.is_object() {
        return Ok(None);
    }
    let bump = bun_alloc::Arena::new();
    let mut changed: Vec<&'static str> = Vec::new();

    if !rewrites.is_empty() {
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
                let Some(value) = prop.value.as_ref().and_then(as_str) else {
                    continue;
                };
                if let Some(ip) = rewrites.iter().find(|ip| &*ip.original_spec == value) {
                    prop.value = Some(string_expr(&ip.new_spec));
                    any = true;
                }
            }
        }
        if any {
            changed.push("rewrote patch:/portal:/link: ranges");
        }
    }

    if !patched.is_empty() {
        match json.get(b"patchedDependencies") {
            Some(mut existing) if existing.is_object() => {
                // keep what the user already declared for bun; add yarn's on top
                let obj = e_object_mut(&mut existing);
                let mut any = false;
                for (key, path) in patched {
                    if obj.get(key).is_none() {
                        obj.put(&bump, bun_ast::data_store_dupe_str(key), string_expr(path))?;
                        any = true;
                    }
                }
                if any {
                    changed.push("added patchedDependencies");
                }
            }
            Some(_) => {}
            None => {
                let mut props = bun_alloc::AstAlloc::vec();
                for (key, path) in patched {
                    VecExt::append(
                        &mut props,
                        bun_ast::G::Property {
                            key: Some(string_expr(key)),
                            value: Some(string_expr(path)),
                            ..Default::default()
                        },
                    );
                }
                e_object_mut(&mut json).put(&bump, b"patchedDependencies", object_expr(props))?;
                changed.push("added patchedDependencies");
            }
        }
    }

    if let Some(catalogs) = catalogs.filter(|_| has_catalogs) {
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
            // bun reads catalogs from the `workspaces` object (or the top level
            // when `workspaces` exists); convert an array to `{ packages: [...] }`.
            let mut workspaces = match json.get(b"workspaces") {
                Some(existing) if existing.is_object() => existing,
                existing => {
                    let mut props = bun_alloc::AstAlloc::vec();
                    if let Some(arr) = existing.filter(|e| e.is_array()) {
                        VecExt::append(
                            &mut props,
                            bun_ast::G::Property {
                                key: Some(string_expr(b"packages")),
                                value: Some(arr),
                                ..Default::default()
                            },
                        );
                    }
                    object_expr(props)
                }
            };
            let ws_obj = e_object_mut(&mut workspaces);
            if let (true, Some(default)) = (want_default, default) {
                ws_obj.put(&bump, b"catalog", sorted_object(default))?;
            }
            if want_named {
                let mut props = bun_alloc::AstAlloc::vec();
                for group in named {
                    VecExt::append(
                        &mut props,
                        bun_ast::G::Property {
                            key: Some(string_expr(group)),
                            value: Some(sorted_object(catalogs.get(group).expect("listed above"))),
                            ..Default::default()
                        },
                    );
                }
                ws_obj.put(&bump, b"catalogs", object_expr(props))?;
            }
            e_object_mut(&mut json).put(&bump, b"workspaces", workspaces)?;
            changed.push("moved .yarnrc.yml catalogs to workspaces");
        }
    }

    if changed.is_empty() {
        return Ok(None);
    }
    print_package_json_into_cache_entry(entry, json);
    // the edits spliced Store-allocated nodes into the cached tree; re-parse so
    // the entry owns its tree again
    if entry.reparse_root(log).is_err() {
        return Err(Error::InvalidPackageJSON);
    }
    Ok(Some(changed))
}

/// `resolutions` / `overrides` from the root package.json, parsed the way a
/// regular install does (see yarn.rs).
fn parse_root_overrides(
    this: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    abs_path: &[u8],
    workspace_map: &WorkspaceMap,
) -> Result<(), Error> {
    let (source, package_json) = match manager
        .workspace_package_json_cache
        .get_with_path(
            log,
            abs_path,
            crate::GetJsonOptions {
                init_reset_store: false,
                ..Default::default()
            },
        )
        .unwrap()
    {
        Ok(e) => (e.source.clone(), e.root),
        Err(_) => return Ok(()),
    };
    if package_json.as_property(b"overrides").is_none()
        && package_json.as_property(b"resolutions").is_none()
    {
        return Ok(());
    }
    let root_package = *this.packages.get(0);
    let (mut string_builder, lf) = this.string_builder_split();
    lf.overrides.parse_count(
        manager,
        log,
        &source,
        workspace_map,
        package_json,
        &mut string_builder,
    );
    string_builder.allocate()?;
    lf.overrides.parse_append(
        manager,
        lf.dependencies.as_slice(),
        &root_package,
        log,
        &source,
        workspace_map,
        package_json,
        &mut string_builder,
    )?;
    string_builder.clamp();
    Ok(())
}
