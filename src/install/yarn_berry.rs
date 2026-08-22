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
//! where yarn pinned it, so:
//!   * the root and workspace packages are built from their package.json
//!     (workspaces come from the root package.json `workspaces` globs, the
//!     same way `bun install` reads them), which gives the real prod/dev/
//!     optional/peer behaviours;
//!   * every other entry becomes a package from its `resolution`: npm (the
//!     tarball URL comes from `::__archiveUrl` when present, otherwise from the
//!     registry configured for bun, or the one in `.yarnrc.yml`), tarball URLs,
//!     git (pinned to the locked commit), and `file:` / `portal:` / `link:`
//!     folders relative to the workspace that declared them;
//!   * dependency edges are bound by descriptor lookup (`name@<range>`), with
//!     `catalog:` ranges translated through `.yarnrc.yml` and rewritten
//!     descriptors recovered through package.json `resolutions`, so nothing yarn
//!     had locked is re-resolved. Edges without a lockfile entry are left for
//!     `bun install` to resolve;
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
use crate::package_manager_real::update_package_json_and_install::print_package_json_into_cache_entry;
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

/// `alpha:` prefix (`npm:`, `workspace:`, `file:`, ...), not `@scope/x` or `1.2.3`.
fn has_protocol(spec: &[u8]) -> bool {
    match strings::index_of_char_usize(spec, b':') {
        Some(i) if i > 0 => spec[..i].iter().all(|c| c.is_ascii_alphabetic()),
        _ => false,
    }
}

/// `npm:^1.2.3` -> `^1.2.3`; `npm:other@^1` (an alias, which bun spells the
/// same way) is kept whole.
fn strip_npm_protocol(spec: &[u8]) -> &[u8] {
    let Some(rest) = spec.strip_prefix(b"npm:") else {
        return spec;
    };
    let is_alias = split_locator(rest).is_some_and(|(n, _)| {
        !n.is_empty()
            && !n[0].is_ascii_digit()
            && !matches!(n[0], b'^' | b'~' | b'>' | b'<' | b'=' | b'*' | b'v')
    });
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

/// `name@version` key used by `patchedDependencies`.
fn name_at_version(
    lockfile: &Lockfile,
    name: &[u8],
    package_id: PackageID,
) -> Result<Option<Vec<u8>>, AllocError> {
    let res = lockfile.packages.items_resolution()[package_id as usize];
    if res.tag != crate::resolution::Tag::Npm {
        return Ok(None);
    }
    let mut out = Vec::new();
    write!(
        &mut out,
        "{}@{}",
        bstr::BStr::new(name),
        res.npm().version.fmt(string_bytes!(lockfile))
    )
    .map_err(|_| AllocError)?;
    Ok(Some(out))
}

/// The parts of `.yarnrc.yml` the migration reads.
#[derive(Default)]
struct YarnRc {
    /// catalog group ("" for the default `catalog:`) -> name -> range
    catalogs: StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>,
    /// `npmRegistryServer`
    registry: Option<Box<[u8]>>,
    /// `npmScopes.<scope>.npmRegistryServer`, keyed without the `@`
    scope_registries: StringArrayHashMap<Box<[u8]>>,
}

fn read_yarnrc(log: &mut bun_ast::Log, dir: Fd) -> Result<YarnRc, AllocError> {
    let mut out = YarnRc::default();
    let Ok(data) = bun_sys::File::read_from(dir, b".yarnrc.yml") else {
        return Ok(out);
    };
    let source = bun_ast::Source::init_path_string(b".yarnrc.yml", data.as_slice());
    let arena = bun_alloc::Arena::new();
    let Ok(root) = bun_parsers::yaml::YAML::parse(
        &source,
        log,
        &arena,
        bun_parsers::yaml::CyclicAliases::Reject,
    ) else {
        // not fatal: the lockfile itself is what matters
        return Ok(out);
    };

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
            if let Some(range) = as_str(&value) {
                map.put(name, Box::from(range))?;
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

    if let Some(url) = get_str(&root, b"npmRegistryServer") {
        if !url.is_empty() {
            out.registry = Some(Box::from(url));
        }
    }
    if let Some(scopes) = root.get(b"npmScopes") {
        scopes.try_for_each_property(|scope, _, value| -> Result<(), AllocError> {
            if let Some(url) = get_str(&value, b"npmRegistryServer") {
                if !url.is_empty() {
                    out.scope_registries.put(scope, Box::from(url))?;
                }
            }
            Ok(())
        })?;
    }
    Ok(out)
}

/// Where the `.patch` file of a `patch:` locator lives, relative to the
/// project root, or `None` for yarn's builtin compat patches.
///
/// `source` is the decoded text after `#`: `~/.yarn/patches/x.patch` (project
/// root), `./patches/x.patch` (relative to the `locator` param's workspace),
/// or `optional!builtin<compat/fsevents>`.
fn project_patch_path(
    source: &[u8],
    params: &[(&[u8], Vec<u8>)],
    workspace_path_of_locator: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
) -> Option<Vec<u8>> {
    let source = source.strip_prefix(b"optional!").unwrap_or(source);
    if source.is_empty() || strings::contains(source, b"builtin<") {
        return None;
    }
    if let Some(rest) = source.strip_prefix(b"~/") {
        return Some(rest.to_vec());
    }
    if bun_paths::is_absolute(source) {
        return Some(source.to_vec());
    }
    let rel = source.strip_prefix(b"./").unwrap_or(source);
    let base = param(params, b"locator")
        .and_then(workspace_path_of_locator)
        .unwrap_or_default();
    if base.is_empty() || base == b"." {
        return Some(rel.to_vec());
    }
    let mut joined = base;
    joined.push(b'/');
    joined.extend_from_slice(rel);
    Some(joined)
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

/// `name@head` with any `::params` removed; the key of `locator_to_entry`.
fn locator_key(name: &[u8], reference: &[u8]) -> Vec<u8> {
    let (head, _) = split_reference_params(reference);
    let mut key = Vec::with_capacity(name.len() + 1 + head.len());
    key.extend_from_slice(name);
    key.push(b'@');
    key.extend_from_slice(head);
    key
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
    dir: Fd,
) -> Result<LoadResult<'a>, Error> {
    this.init_empty();
    crate::initialize_store();
    bun_core::analytics::Features::yarn_migration_inc(1);

    let silent = manager.options.log_level.is_silent();
    let verbose = manager.options.log_level.is_verbose();

    // Later `workspace_package_json_cache.get_with_path` calls reset the Expr
    // store, so clone the parsed tree into an arena that lives for the whole
    // function (same as the pnpm migration).
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
    if root
        .get(b"__metadata")
        .and_then(|m| m.get(b"version"))
        .is_none()
    {
        log.add_error(
            None,
            bun_ast::Loc::EMPTY,
            b"yarn.lock is missing __metadata.version",
        );
        return Err(Error::InvalidYarnBerryLockfile);
    }

    let yarnrc = read_yarnrc(log, dir)?;

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
    // descriptor with `::params` removed -> entry, or usize::MAX when ambiguous
    let mut bare_descriptor_to_entry: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // locator without `::params` ("name@npm:1.2.3") -> entry
    let mut locator_to_entry: StringArrayHashMap<usize> = StringArrayHashMap::new();
    // workspace path in the lockfile -> entry
    let mut lockfile_workspaces: StringArrayHashMap<usize> = StringArrayHashMap::new();

    for prop in root_obj.properties.slice() {
        let (Some(key), Some(value)) = (&prop.key, &prop.value) else {
            continue;
        };
        let Some(key) = as_str(key) else { continue };
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
            descriptor_to_entry.put(desc, idx)?;
            if let Some((bare, _)) = strings::split_once(desc, b"::") {
                let e = bare_descriptor_to_entry.get_or_put(bare)?;
                *e.value_ptr = if e.found_existing && *e.value_ptr != idx {
                    usize::MAX
                } else {
                    idx
                };
            }
        }
        let (head, _) = split_reference_params(reference);
        let mut loc = Vec::with_capacity(name.len() + 1 + head.len());
        loc.extend_from_slice(name);
        loc.push(b'@');
        loc.extend_from_slice(&percent_decode(head));
        locator_to_entry.put(&loc, idx)?;
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
    if !silent {
        for (path, _) in lockfile_workspaces.iter() {
            let path: &[u8] = path;
            if path != b"." && workspace_map.get(path).is_none() {
                bun_core::warn!(
                    "yarn.lock workspace \"{}\" is not one of the package.json \"workspaces\"; skipping it",
                    bstr::BStr::new(path)
                );
            }
        }
    }

    // yarn `resolutions`, consulted when a descriptor has no lockfile key of
    // its own because yarn rewrote it; keys are reduced to their last
    // `name[@range]` segment (`parent/name` and `**/name` forms).
    let mut resolutions: Vec<(&[u8], &[u8])> = Vec::new();
    if let Some(ExprData::EObject(res)) = root_manifest.get(b"resolutions").map(|e| e.data) {
        for p in res.properties.slice() {
            let (Some(k), Some(v)) = (&p.key, &p.value) else {
                continue;
            };
            if let (Some(k), Some(v)) = (as_str(k), as_str(v)) {
                resolutions.push((resolution_key_pattern(k), v));
            }
        }
    }

    let mut root_rewrites: Vec<ManifestRewrite> = Vec::new();
    let mut original_specs = OriginalSpecs::default();
    // `"name@range": "patch:..."` values only make sense to yarn; bun gets the
    // patch through `patchedDependencies` and the pinned range as the override.
    for (_, target) in &resolutions {
        if target.starts_with(b"patch:")
            && !root_rewrites.iter().any(|r| &*r.original_spec == *target)
        {
            root_rewrites.push(ManifestRewrite {
                original_spec: Box::from(*target),
                new_spec: Box::from(patch_inner_range(target)),
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

    // `name@workspace:path` (percent-encoded, as in `::locator=`) -> path
    let workspace_path_of_locator = |encoded_or_decoded: &[u8]| -> Option<Vec<u8>> {
        let decoded = percent_decode(encoded_or_decoded);
        split_locator(&decoded)
            .and_then(|(_, r)| r.strip_prefix(b"workspace:"))
            .map(|p| p.to_vec())
    };

    // -- 3. third-party packages -----------------------------------------------
    let mut warned_registries: StringArrayHashMap<()> = StringArrayHashMap::new();
    let mut skipped: u32 = 0;
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
                    let registry =
                        registry_for(manager, &yarnrc, name, &mut warned_registries, silent)?;
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
            // relative to the workspace that declared it (`::locator=name@workspace:path`)
            let base = param(&params, b"locator")
                .and_then(workspace_path_of_locator)
                .unwrap_or_default();
            let rel = path.strip_prefix(b"./").unwrap_or(path);
            let mut joined: Vec<u8> = Vec::new();
            if !bun_paths::is_absolute(rel) && !base.is_empty() && base != b"." {
                joined.extend_from_slice(&base);
                joined.push(b'/');
            }
            joined.extend_from_slice(rel);
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
            git_resolution(this, name, head)?
        } else if head.starts_with(b"https://") || head.starts_with(b"http://") {
            Resolution::init(TaggedValue::RemoteTarball(sbuf!(this).append(head)?))
        } else {
            // exec:, custom protocols from plugins, ...: let bun resolve that dependency itself.
            if !silent {
                bun_core::warn!(
                    "skipped \"{}@{}\" from yarn.lock: unsupported protocol (bun will resolve it from package.json)",
                    bstr::BStr::new(name),
                    bstr::BStr::new(reference),
                );
            }
            skipped += 1;
            continue;
        };

        let mut pkg = lockfile::Package {
            name: sbuf!(this).append_with_hash(name, name_hash)?,
            name_hash,
            resolution,
            ..Default::default()
        };
        let (off, len) = append_entry_dependencies(this, log, &entry_expr)?;
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
    }
    let _ = skipped;

    // patch entries -> same package as the locator they patch (+ patchedDependencies)
    let mut patched: Vec<(Vec<u8>, Vec<u8>)> = Vec::new(); // ("name@version", patch path)
    for i in 0..entries.len() {
        if entries[i].kind != EntryKind::Patch {
            continue;
        }
        let name = entries[i].name;
        let (spec, params) = decode_patch_spec(&entries[i].reference[b"patch:".len()..]);
        // the inner locator may itself carry ::params
        let inner_key = match split_locator(&spec.inner) {
            Some((n, r)) => locator_key(n, r),
            None => locator_key(name, &spec.inner),
        };
        let Some(&inner_idx) = locator_to_entry.get(&inner_key) else {
            if !silent {
                bun_core::warn!(
                    "skipped patch \"{}\" from yarn.lock: it patches \"{}\", which is not in the lockfile",
                    bstr::BStr::new(entries[i].reference),
                    bstr::BStr::new(&inner_key),
                );
            }
            continue;
        };
        let pid = entries[inner_idx].package_id;
        entries[i].package_id = pid;
        if pid == INVALID_PACKAGE_ID {
            continue;
        }
        if let Some(path) = project_patch_path(&spec.source, &params, &workspace_path_of_locator) {
            if let Some(key) = name_at_version(this, entries[inner_idx].name, pid)? {
                // several descriptors / `resolutions` selectors can point at one patch
                if !patched.iter().any(|(k, _)| *k == key) {
                    patched.push((key, path));
                }
            }
        }
    }

    // -- 4. bind dependency edges ---------------------------------------------
    let dep_count = this.buffers.dependencies.len();
    this.buffers.resolutions.clear();
    this.buffers
        .resolutions
        .resize(dep_count, INVALID_PACKAGE_ID);
    let mut key: Vec<u8> = Vec::with_capacity(128);
    let mut unbound: Vec<(Box<[u8]>, Box<[u8]>)> = Vec::new();
    let pkg_count = this.packages.len();
    for pkg_id in 0..pkg_count {
        // the owning workspace, for `::locator=` descriptors
        let owner_locator: Option<Vec<u8>> = {
            let res = this.packages.items_resolution()[pkg_id];
            let ws_path: &[u8] = match res.tag {
                crate::resolution::Tag::Root => b".",
                crate::resolution::Tag::Workspace => res.workspace().slice(string_bytes!(this)),
                _ => b"",
            };
            if ws_path.is_empty() {
                None
            } else {
                // yarn names an unnamed workspace itself (`root-workspace-0b6124`),
                // so prefer the name its lockfile entry carries
                let ws_name: &[u8] = match lockfile_workspaces.get(ws_path) {
                    Some(&idx) => entries[idx].name,
                    None => this.packages.items_name()[pkg_id].slice(string_bytes!(this)),
                };
                let mut raw = Vec::with_capacity(ws_name.len() + 12 + ws_path.len());
                raw.extend_from_slice(ws_name);
                raw.extend_from_slice(b"@workspace:");
                raw.extend_from_slice(ws_path);
                let mut enc = Vec::with_capacity(raw.len() + 8);
                percent_encode(&mut enc, &raw);
                Some(enc)
            }
        };

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

            // 1. exactly as written (protocol descriptors: workspace:, patch:, npm: aliases, URLs)
            key.clear();
            key.extend_from_slice(name);
            key.push(b'@');
            key.extend_from_slice(literal);
            let exact_len = key.len();
            let mut found: Option<usize> = lookup(&key);
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
            // 3. relative protocols (file:, portal:, link:) are keyed per declaring workspace
            if found.is_none() {
                if let Some(owner) = &owner_locator {
                    key.clear();
                    key.extend_from_slice(name);
                    key.push(b'@');
                    key.extend_from_slice(literal);
                    key.extend_from_slice(b"::locator=");
                    key.extend_from_slice(owner);
                    found = lookup(&key).or_else(|| {
                        bare_descriptor_to_entry
                            .get(&key[..exact_len])
                            .copied()
                            .filter(|&i| i != usize::MAX)
                    });
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
            // 5. package.json `resolutions` that rewrote this descriptor
            if found.is_none() && !dep.behavior.is_workspace() {
                for (pattern, target) in &resolutions {
                    if !resolution_pattern_matches(pattern, name, original_literal, literal) {
                        continue;
                    }
                    if let Some(i) = resolution_target_entry(
                        name,
                        target,
                        &locator_to_entry,
                        &descriptor_to_entry,
                    ) {
                        found = Some(i);
                        break;
                    }
                }
            }

            match found.map(|i| entries[i].package_id) {
                Some(pid) if pid != INVALID_PACKAGE_ID => {
                    this.buffers.resolutions[dep_id as usize] = pid;
                }
                _ => {
                    // Left for `bun install` to resolve (peers are always bound at
                    // install time, so they are not worth mentioning).
                    if !dep.behavior.is_peer() && !dep.behavior.is_workspace() {
                        unbound.push((Box::from(name), Box::from(original_literal)));
                    }
                }
            }
        }
    }
    if !unbound.is_empty() && !silent {
        if verbose {
            for (name, literal) in &unbound {
                bun_core::warn!(
                    "yarn.lock has no entry for \"{}@{}\"; bun will resolve it",
                    bstr::BStr::new(&**name),
                    bstr::BStr::new(&**literal),
                );
            }
        } else {
            bun_core::warn!(
                "yarn.lock has no entry for {} {} (e.g. \"{}@{}\"); bun will resolve {}",
                unbound.len(),
                if unbound.len() == 1 {
                    "dependency"
                } else {
                    "dependencies"
                },
                bstr::BStr::new(&*unbound[0].0),
                bstr::BStr::new(&*unbound[0].1),
                if unbound.len() == 1 { "it" } else { "them" },
            );
        }
    }

    // A fresh resolve only records os/cpu for registry packages.
    crate::migration::clear_non_registry_platform_constraints(this);

    if this.resolve(log).is_err() {
        return Err(Error::LockfileResolveFailed);
    }

    // bins yarn did not record (older lockfiles), os/cpu for lockfiles without
    // `conditions`, and tarball integrity, all from the registry manifests.
    this.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration::<true, true>(manager)?;

    // -- 5. package.json edits ----------------------------------------------------
    // patches into the lockfile so this very install applies them
    for (key, path) in &patched {
        let hash = semver::string::Builder::string_hash(key);
        let path = sbuf!(this).append(path)?;
        this.patched_dependencies
            .put(hash, lockfile::PatchedDep::with_path(path))?;
    }
    for ws in &workspaces {
        if ws.rewrites.is_empty() {
            continue;
        }
        let mut json_path = bun_paths::AutoAbsPath::init_top_level_dir();
        let _ = json_path.join(&[&ws.path, b"package.json"]); // bounded input
        update_package_json(manager, log, json_path.slice(), &ws.rewrites, &[], None)?;
    }
    update_package_json(
        manager,
        log,
        root_json_path.slice(),
        &root_rewrites,
        &patched,
        Some(&yarnrc.catalogs),
    )?;
    // bun reads `resolutions` from package.json on every install; parse them the
    // same way now (after the `patch:` values were rewritten) so the next install
    // does not see them as changed.
    parse_root_overrides(this, manager, log, root_json_path.slice(), &workspace_map)?;

    if cfg!(debug_assertions) {
        this.verify_data()?;
    }
    this.meta_hash = this.generate_meta_hash(false, this.packages.len())?;

    Ok(LoadResult::Ok(LoadResultOk {
        lockfile: this,
        migrated: lockfile::Migrated::Yarn,
        serializer_result: Default::default(),
        format: lockfile::Format::Text,
    }))
}

/// The registry tarball URLs are built from: `.yarnrc.yml` when it names a
/// registry other than the one bun is configured with (that is where yarn
/// fetched the locked packages from), otherwise bun's registry for the scope.
fn registry_for(
    manager: &PackageManager,
    yarnrc: &YarnRc,
    name: &[u8],
    warned: &mut StringArrayHashMap<()>,
    silent: bool,
) -> Result<Vec<u8>, AllocError> {
    let configured: &[u8] = manager.scope_for_package_name(name).url.href();
    let from_yarnrc: Option<&[u8]> = if name.first() == Some(&b'@') {
        let scope = npm::registry::Scope::get_name(name);
        yarnrc
            .scope_registries
            .get(scope)
            .map(|u| &**u)
            .or(yarnrc.registry.as_deref())
    } else {
        yarnrc.registry.as_deref()
    };
    let Some(url) = from_yarnrc else {
        return Ok(configured.to_vec());
    };
    let same = |a: &[u8], b: &[u8]| {
        lockfile::bun_lock::url_is_under_registry(a, b)
            && lockfile::bun_lock::url_is_under_registry(b, a)
    };
    // yarn's default registry serves the same packages as the npm registry
    if same(url, configured)
        || (same(url, b"https://registry.yarnpkg.com")
            && same(configured, npm::Registry::DEFAULT_URL.as_bytes()))
    {
        return Ok(configured.to_vec());
    }
    if !silent && !warned.get_or_put(url)?.found_existing {
        bun_core::warn!(
            "fetching yarn.lock packages from {} (npmRegistryServer in .yarnrc.yml); add it to bunfig.toml or .npmrc if it needs authentication",
            bstr::BStr::new(url)
        );
    }
    Ok(url.to_vec())
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
fn git_resolution(this: &mut Lockfile, name: &[u8], head: &[u8]) -> Result<Resolution, Error> {
    let (url, fragment) = match strings::split_once_char(head, b'#') {
        Some((url, fragment)) => (url, fragment),
        None => (head, &b""[..]),
    };
    let mut commit = fragment;
    for kv in strings::split(fragment, b"&") {
        if let Some(c) = kv.strip_prefix(b"commit=") {
            commit = c;
            break;
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
    Ok(Resolution::init(TaggedValue::Git(Repository {
        owner: String::default(),
        repo: sbuf!(this).append(url)?,
        committish: sbuf!(this).append(commit)?,
        resolved: sbuf!(this).append(commit)?,
        package_name: sbuf!(this).append(name)?,
    })))
}

/// `parent/name`, `**/name`, `name@npm:range` -> the last `name[@range]` segment.
fn resolution_key_pattern(key: &[u8]) -> &[u8] {
    // a scope's `/` is part of the name; any other `/` separates selector segments
    let mut rest = key;
    loop {
        let search_from = usize::from(rest.first() == Some(&b'@'));
        let Some(slash) = strings::index_of_char_usize(&rest[search_from..], b'/') else {
            return rest;
        };
        let slash = slash + search_from;
        let after = &rest[slash + 1..];
        if search_from == 1 {
            // `@scope/name[...]`: only a further `/` (before any `@range`) starts a new segment
            let name_end = strings::index_of_char_usize(after, b'@').unwrap_or(after.len());
            match strings::index_of_char_usize(&after[..name_end], b'/') {
                Some(next) => rest = &after[next + 1..],
                None => return rest,
            }
        } else {
            rest = after;
        }
    }
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

/// The entry a `resolutions` value points at: `1.2.3`, `npm:1.2.3`,
/// `npm:other@1.2.3`, `patch:<locator>#...`, or a full descriptor.
fn resolution_target_entry(
    name: &[u8],
    target: &[u8],
    locator_to_entry: &StringArrayHashMap<usize>,
    descriptor_to_entry: &StringArrayHashMap<usize>,
) -> Option<usize> {
    let mut key: Vec<u8> = Vec::with_capacity(name.len() + target.len() + 5);
    if let Some(rest) = target.strip_prefix(b"patch:") {
        // the patch entry itself is keyed `name@patch:...`; fall back to what it patches
        key.extend_from_slice(name);
        key.push(b'@');
        key.extend_from_slice(target);
        if let Some(&i) = descriptor_to_entry.get(&key) {
            return Some(i);
        }
        let (spec, _) = decode_patch_spec(rest);
        key = match split_locator(&spec.inner) {
            Some((n, r)) => locator_key(n, r),
            None => locator_key(name, &spec.inner),
        };
        return locator_to_entry
            .get(&key)
            .or_else(|| descriptor_to_entry.get(&key))
            .copied();
    }
    key.extend_from_slice(name);
    key.push(b'@');
    if !has_protocol(target) {
        key.extend_from_slice(b"npm:");
    }
    key.extend_from_slice(target);
    if let Some(&i) = descriptor_to_entry
        .get(&key)
        .or_else(|| locator_to_entry.get(&key))
    {
        return Some(i);
    }
    // `npm:other@1.2.3` names the aliased package's locator
    if let Some(rest) = target.strip_prefix(b"npm:") {
        if let Some((other, range)) = split_locator(rest).filter(|(n, _)| !n.is_empty()) {
            key.clear();
            key.extend_from_slice(other);
            key.extend_from_slice(b"@npm:");
            key.extend_from_slice(range);
            return descriptor_to_entry
                .get(&key)
                .or_else(|| locator_to_entry.get(&key))
                .copied();
        }
    }
    None
}

/// Names under `dependenciesMeta` / `peerDependenciesMeta` with `optional: true`.
fn optional_names(entry: &Expr, meta_key: &[u8]) -> Vec<&'static [u8]> {
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
            if let Some(k) = as_str(k) {
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
    entry: &Expr,
) -> Result<(u32, u32), Error> {
    let off = this.buffers.dependencies.len();
    let optional_deps = optional_names(entry, b"dependenciesMeta");
    let optional_peers = optional_names(entry, b"peerDependenciesMeta");
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
            let (Some(name), Some(spec)) = (as_str(k), as_str(v)) else {
                continue;
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
) -> Result<(u32, u32), Error> {
    let off = this.buffers.dependencies.len();
    let optional_peers = optional_names(manifest, b"peerDependenciesMeta");
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
            let mut behavior = behavior;
            if behavior.is_peer() {
                if optional_peers.contains(&name) {
                    behavior.insert(Behavior::OPTIONAL);
                }
            } else {
                let e = seen.get_or_put(name)?;
                if e.found_existing {
                    // optionalDependencies win over dependencies; a dev duplicate is dropped
                    if behavior.is_optional() {
                        let existing = *e.value_ptr;
                        this.buffers.dependencies[existing].behavior = Behavior::OPTIONAL;
                    }
                    continue;
                }
                *e.value_ptr = this.buffers.dependencies.len();
            }
            // Ranges only yarn understands: depend on what bun can read instead;
            // package.json is rewritten to match after migration.
            let rewritten: Option<Vec<u8>> = if spec.starts_with(b"patch:") {
                Some(patch_inner_range(spec).to_vec())
            } else {
                spec.strip_prefix(b"portal:")
                    .or_else(|| spec.strip_prefix(b"link:"))
                    .filter(|p| p.starts_with(b".") || bun_paths::is_absolute(p))
                    .map(|path| [b"file:".as_slice(), path].concat())
            };
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

fn e_object_mut(expr: &mut Expr) -> &mut E::Object {
    match &mut expr.data {
        ExprData::EObject(o) => &mut **o,
        _ => unreachable!("e_object_mut called on non-object"),
    }
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
/// Existing keys are left alone.
fn update_package_json(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    abs_path: &[u8],
    rewrites: &[ManifestRewrite],
    patched: &[(Vec<u8>, Vec<u8>)],
    catalogs: Option<&StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>>,
) -> Result<(), Error> {
    let has_catalogs = catalogs.is_some_and(|c| c.iter().any(|(_, m)| m.count() > 0));
    if rewrites.is_empty() && patched.is_empty() && !has_catalogs {
        return Ok(());
    }
    let silent = manager.options.log_level.is_silent();
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
        Err(_) => return Ok(()),
    };
    let mut json = entry.root;
    if !json.is_object() {
        return Ok(());
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

    if !patched.is_empty() && json.get(b"patchedDependencies").is_none() {
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
        return Ok(());
    }
    print_package_json_into_cache_entry(entry, json);
    // the edits spliced Store-allocated nodes into the cached tree; re-parse so
    // the entry owns its tree again
    if entry.reparse_root(log).is_err() {
        return Err(Error::InvalidPackageJSON);
    }
    let dirname = bun_paths::dirname(abs_path).unwrap_or(abs_path);
    let rel = strings::without_prefix(
        dirname,
        strings::without_trailing_slash(crate::bun_fs::FileSystem::instance().top_level_dir()),
    );
    let rel = strings::trim_prefix(rel, b"/");
    match bun_sys::File::write_file(
        Fd::cwd(),
        &bun_core::ZBox::from_bytes(abs_path),
        entry.source.contents(),
    ) {
        Ok(()) => {
            if !silent {
                bun_core::pretty_errorln!(
                    "<d>{} in <r><green>{}{}package.json<r>",
                    changed.join(", "),
                    bstr::BStr::new(rel),
                    if rel.is_empty() { "" } else { "/" },
                );
            }
        }
        Err(_) => {
            if !silent {
                bun_core::warn!(
                    "could not update {}{}package.json after migrating yarn.lock",
                    bstr::BStr::new(rel),
                    if rel.is_empty() { "" } else { "/" },
                );
            }
        }
    }
    Ok(())
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
