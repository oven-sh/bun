//! Text lockfile (bun.lock) stringifier and parser.

use core::fmt::Write as _;

use crate::bun_json as JSON;
use bun_ast::{Expr, expr::Data as ExprData};
use bun_collections::{DynamicBitSet, HashContext, HashMap, StringHashMap, index_sort};
use bun_core::strings;
use bun_core::{self};
use bun_semver::semver_string::{
    Buf as StringBuf, Builder as StringBuilder, JsonFormatterOptions as JsonOpts,
};
use bun_semver::{self as Semver, ExternalString, String};

use crate::bin_real::ToJsonStyle;
use crate::config_version::ConfigVersion;
use crate::extract_tarball as ExtractTarball;
use crate::integrity::Integrity;
use crate::npm::Negatable;
use crate::repository::RepositoryExt as _;
use crate::{
    DependencyID, Npm, Origin, PackageID, PackageManager, PackageNameHash, Repository, Resolution,
    TruncatedPackageNameHash,
    bin::{Bin, Tag as BinTag},
    dependency,
    dependency::{
        Behavior, Dependency, Value as DependencyVersionValue, Version as DependencyVersion,
    },
    invalid_package_id,
    resolution::Tag as ResolutionTag,
};
use bun_install_types::DependencyVersionTag;
// this file is `crate::lockfile_real::bun_lock`; `super` is the
// real `Lockfile` module, distinct from the `crate::lockfile` stub.
use super::PackageIDSlice;
use super::override_map::ScopedOverride;
use super::override_selector::{PackageSelector, parse_package_segment};
use super::package::{Meta, PackageColumns as _, value_loc_of};
use super::{
    CatalogMap, DependencySlice, LoadResult, Lockfile as BinaryLockfile, OverrideMap, Package,
    PackageIndexMap, PatchedDep, TrustedDependenciesSet, VersionHashMap, tree,
};

use bun_io::AsFmt;

/// `Bin::to_json` indent callback typed against `AsFmt`.
fn write_indent_fmt(w: &mut AsFmt<'_>, indent: &mut u32) -> core::fmt::Result {
    for _ in 0..*indent {
        w.write_str("  ")?;
    }
    Ok(())
}

/// `true` if `url` points at a resource under `registry`: the registry href
/// (sans trailing slash) must be an exact prefix and the byte after it must be
/// a path separator, so `https://registry.example.com.evil.com/x.tgz` does not
/// count as being under a `https://registry.example.com` registry.
pub(crate) fn url_is_under_registry(url: &[u8], registry: &[u8]) -> bool {
    let registry = strings::without_trailing_slash(registry);
    strings::has_prefix(url, registry)
        && (url.len() == registry.len() || url[registry.len()] == b'/')
}

// A single `lockfile.string_buf()` held for the whole parser would lock out
// every other `lockfile.*` access (the `string_buf()` method borrows the whole
// receiver). Construct a fresh `Buf` at each append site so the disjoint
// `buffers.string_bytes` / `string_pool` borrows end immediately and the
// borrow checker can see that catalog/workspace/package mutations touch
// different fields. Mirrors `src/install/pnpm.rs::sbuf!`.
macro_rules! sbuf {
    ($lockfile:expr) => {
        StringBuf {
            bytes: &mut $lockfile.buffers.string_bytes,
            pool: &mut $lockfile.string_pool,
        }
    };
}

// Dyn dispatch for now — the trait shape is unsettled.
type Writer = dyn bun_io::Write;
// `bun_io::Write` returns `core::result::Result<_, crate::Error>` (see
// `bun_io::write::Result`), so the writer error is just the global `crate::Error`.
type WriteError = crate::Error;

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Version {
    V0 = 0,

    /// fixed unnecessary listing of workspace dependencies
    V1 = 1,

    /// Stricter parsing that rejects, rather than accepts, lockfiles the
    /// earlier versions tolerated. Gated here so an already-written v0/v1
    /// lockfile keeps loading:
    /// - an npm package resolved to a tarball URL outside the configured
    ///   registry must carry a supported integrity hash
    /// - an integrity hash is a supported one or empty
    /// - a git `.bun-tag` must be a safe path/checkout component (the same
    ///   check on a `github` tag is enforced at every version, since its
    ///   download path has no checkout-time re-validation)
    V2 = 2,

    /// `overrides` values may be objects holding scoped rules (parent-scoped or `name@range` targets); stamped while such rules exist and the package walk in `Stringifier::version_to_write` is v2-clean (object rows themselves parse at every version)
    V3 = 3,
}

impl Version {
    pub(crate) const CURRENT: Version = Version::V3;

    #[inline]
    pub(crate) const fn current() -> Version {
        Version::CURRENT
    }

    pub(crate) const fn from_int(n: u32) -> Option<Version> {
        match n {
            0 => Some(Version::V0),
            1 => Some(Version::V1),
            2 => Some(Version::V2),
            3 => Some(Version::V3),
            _ => None,
        }
    }

    /// `true` when this lockfile version is at least `other`. Used to gate
    /// strict parse-time checks introduced in a later version.
    #[inline]
    pub(crate) const fn at_least(self, other: Version) -> bool {
        (self as u32) >= (other as u32)
    }
}

/// For sorting dependencies belonging to a node_modules folder. No duplicate names, so
/// only string compare
fn sort_by_name(dep_ids: &mut [DependencyID], deps_buf: &[Dependency], string_buf: &[u8]) {
    index_sort::sort_indices(dep_ids, &mut |l, r| {
        strings::order(
            deps_buf[l as usize].name.slice(string_buf),
            deps_buf[r as usize].name.slice(string_buf),
        )
    });
}

/// The slot order every existing bun.lock has its `trustedDependencies` and
/// `patchedDependencies` in (`std.AutoHashMap(u64)`'s hash).
struct WrittenOrderContext;

impl HashContext<u64> for WrittenOrderContext {
    #[inline]
    fn ctx_hash(key: &u64) -> u64 {
        bun_wyhash::hash(&key.to_le_bytes())
    }
    #[inline]
    fn ctx_eql(a: &u64, b: &u64) -> bool {
        a == b
    }
}

pub(crate) struct Stringifier;

impl Stringifier {
    /// Pick the `lockfileVersion` to stamp. A lockfile loaded from disk keeps
    /// the version it already carried — re-saving never silently upgrades an
    /// existing `bun.lock` to a newer format. `text_lockfile_version` holds the
    /// parsed version when the lockfile was loaded from text, and defaults to
    /// `Version::CURRENT` otherwise (a fresh install, or a migration from
    /// another lockfile format), the "no version previously" case whose stamp
    /// is decided by the walk below.
    ///
    /// The one version that is *not* preserved is v0: v0→v1 was a content-format
    /// change (v1 stopped listing a workspace package's dependencies as a
    /// trailing object), and the writer only ever emits the v1+ single-element
    /// `["name@workspace:path"]` form. Stamping v0 on that output would make the
    /// next parse fail ("Missing dependencies object"), so a v0 lockfile is
    /// floored to v1 — the lowest version whose content matches what we write.
    /// v1→v2, by contrast, only added parse-time strictness on identical
    /// content, so v1 is preserved as-is.
    ///
    /// Scoped overrides (parent-scoped or `name@range` rules) are stamped v3, but
    /// only after the same walk: a lockfile the walk holds at v1 stays v1 with the
    /// override objects written as-is, since the parser reads those at every
    /// version while its v2+ integrity check is evaluated against the *reader's*
    /// registries — stamping 3 there would make the file config-dependent again.
    /// A walk-clean lockfile with scoped rules is stamped v3 whatever version was
    /// loaded. Without scoped rules a lockfile keeps its loaded v1/v2, and a fresh
    /// or v3-loaded one is walked down to v2, or to v1 on a v2-invariant violation
    /// (off-registry npm tarball without a supported integrity, unsafe git
    /// `.bun-tag`); that decision must not depend on the writer's `~/.npmrc`.
    ///
    /// Walks the package tree the same way the writer does — only packages that
    /// are actually serialized are considered, not every entry in the in-memory
    /// `pkg_resolutions` buffer (migration can leave pruned/unreferenced entries
    /// there that never reach the written `packages` object).
    fn version_to_write(lockfile: &BinaryLockfile) -> Version {
        let loaded = lockfile.text_lockfile_version;
        let has_scoped = lockfile.overrides.has_scoped();
        if !has_scoped && !loaded.at_least(Version::V3) {
            return if loaded.at_least(Version::V1) {
                loaded
            } else {
                Version::V1
            };
        }

        let buf = lockfile.buffers.string_bytes.as_slice();
        let deps_buf = lockfile.buffers.dependencies.as_slice();
        let resolution_buf = lockfile.buffers.resolutions.as_slice();
        let pkgs = lockfile.packages.slice();
        let pkg_resolutions: &[Resolution] = pkgs.items_resolution();
        let pkg_metas: &[Meta] = pkgs.items_meta();

        let mut iter = tree::Iterator::<'_, { tree::IteratorPathStyle::PkgPath }>::from_slices(
            lockfile.buffers.trees.as_slice(),
            lockfile.buffers.hoisted_dependencies.as_slice(),
            deps_buf,
            buf,
        );

        while let Some(node) = iter.next(None) {
            for &dep_id in node.dependencies {
                let pkg_id = resolution_buf[dep_id as usize];
                if pkg_id == invalid_package_id {
                    continue;
                }
                let i = pkg_id as usize;
                let res = &pkg_resolutions[i];
                match res.tag {
                    ResolutionTag::Npm => {
                        if pkg_metas[i].integrity.tag.is_supported() {
                            continue;
                        }
                        // No supported integrity: only v2-clean if the tarball
                        // URL is under the *default* registry, the one case the
                        // writer normalizes to `""` (see the npm URL
                        // serialization in `save_from_binary`). An empty
                        // URL never sets the parser's `npm_url_needs_integrity`,
                        // so that round-trips for any reader. A URL under a
                        // configured-but-not-default scope is written verbatim,
                        // and the parser's integrity check is evaluated against
                        // the *reader's* scope config, so it is not
                        // config-independent: a writer with a private `@scope`
                        // registry could stamp v2 on a lockfile a teammate
                        // without that scope then fails to parse. Stay at v1 for
                        // those so the file keeps loading everywhere.
                        let url = res.npm().url.slice(buf);
                        if !url_is_under_registry(url, Npm::Registry::DEFAULT_URL.as_bytes()) {
                            return Version::V1;
                        }
                    }
                    ResolutionTag::Git => {
                        // An unsafe git `.bun-tag` is only rejected at v2, so
                        // staying at v1 keeps it loading. (A `github` tag is
                        // rejected at every version, so no lockfile version can
                        // round-trip an unsafe one — nothing to gate here.)
                        if !crate::repository::is_safe_resolved_tag(
                            res.repository().resolved.slice(buf),
                        ) {
                            return Version::V1;
                        }
                    }
                    _ => {}
                }
            }
        }
        if has_scoped { Version::V3 } else { Version::V2 }
    }

    pub(crate) fn save_from_binary(
        lockfile: &mut BinaryLockfile,
        load_result: &LoadResult,
        config_version: ConfigVersion,
        writer: &mut Writer,
    ) -> Result<(), WriteError> {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let extern_strings = lockfile.buffers.extern_strings.as_slice();
        let deps_buf = lockfile.buffers.dependencies.as_slice();
        let resolution_buf = lockfile.buffers.resolutions.as_slice();
        let pkgs = lockfile.packages.slice();
        let pkg_dep_lists: &[DependencySlice] = pkgs.items_dependencies();
        let pkg_resolutions: &[Resolution] = pkgs.items_resolution();
        let pkg_names: &[String] = pkgs.items_name();
        let pkg_name_hashes: &[PackageNameHash] = pkgs.items_name_hash();
        let pkg_metas: &[Meta] = pkgs.items_meta();
        let pkg_bins = pkgs.items_bin();

        let mut temp_buf: Vec<u8> = Vec::new();

        // Written out in iteration order, which the hash and the reserved capacity decide.
        let mut found_trusted_dependencies: HashMap<u64, String, WrittenOrderContext> =
            HashMap::default();
        if let Some(trusted_dependencies) = &lockfile.trusted_dependencies {
            found_trusted_dependencies.reserve(trusted_dependencies.count());
        }

        let mut found_patched_dependencies: HashMap<u64, (Box<[u8]>, String), WrittenOrderContext> =
            HashMap::default();
        found_patched_dependencies.reserve(lockfile.patched_dependencies.count());

        let mut optional_peers_buf: Vec<String> = Vec::new();

        // Optional dependencies that did not resolve, although the tree has a package of the same
        // name. They are written as "unresolved" so that loading does not resolve them to it.
        let placed_rows = lockfile.buffers.hoisted_dependencies.as_slice();
        let any_unresolved = (resolution_buf.iter().zip(deps_buf))
            .any(|(&id, dep)| id == invalid_package_id && dep.behavior.is_optional());
        let unresolved_names = |dep_ids: &[DependencyID]| -> Vec<String> {
            if !any_unresolved {
                return Vec::new();
            }
            (dep_ids.iter().map(|&id| id as usize))
                .filter(|&id| resolution_buf[id] == invalid_package_id)
                .map(|id| &deps_buf[id])
                .filter(|dep| dep.behavior.is_optional())
                .filter(|dep| {
                    (placed_rows.iter())
                        .any(|&row| deps_buf[row as usize].name_hash == dep.name_hash)
                })
                .map(|dep| dep.name)
                .collect()
        };

        let mut pkg_map: PkgMap<()> = PkgMap::init();

        // `from_slices` (vs `init(lockfile)`) is used so the iterator
        // borrows only `buffers.{trees,hoisted_dependencies,dependencies,string_bytes}`;
        // `overrides`/`catalogs` are mutated below while the iterator is still live.
        let mut pkgs_iter = tree::Iterator::<'_, { tree::IteratorPathStyle::PkgPath }>::from_slices(
            lockfile.buffers.trees.as_slice(),
            lockfile.buffers.hoisted_dependencies.as_slice(),
            deps_buf,
            buf,
        );

        let mut path_buf = bun_paths::path_buffer_pool::get();

        // if we loaded from a binary lockfile or pnpm-lock.yaml and we're migrating it to a text lockfile, ensure
        // peer dependencies have resolutions, and mark them optional if they don't. This leaves the
        // "workspaces" section alone, because the next install compares it with package.json.
        if load_result.loaded_from_binary_lockfile() || load_result.migrated_from_pnpm() {
            while let Some(node) = pkgs_iter.next(None) {
                for &dep_id in node.dependencies {
                    let dep = &deps_buf[dep_id as usize];

                    // clobber, there isn't data
                    let mut key: Vec<u8> = Vec::new();
                    {
                        use std::io::Write;
                        let _ = write!(
                            &mut key,
                            "{}{}{}",
                            bstr::BStr::new(node.relative_path),
                            if node.depth == 0 { "" } else { "/" },
                            bstr::BStr::new(dep.name.slice(buf)),
                        );
                    }
                    pkg_map.put(&key, ());
                }
            }

            pkgs_iter.reset();
        }

        let mut _indent: u32 = 0;
        let indent = &mut _indent;
        writer.write_all(b"{\n")?;
        Self::inc_indent(writer, indent)?;
        {
            let lockfile_version = Self::version_to_write(lockfile);
            writeln!(writer, "\"lockfileVersion\": {},", lockfile_version as u32)?;
            Self::write_indent(writer, *indent)?;

            writeln!(writer, "\"configVersion\": {},", config_version as u32)?;
            Self::write_indent(writer, *indent)?;

            writer.write_all(b"\"workspaces\": {\n")?;
            Self::inc_indent(writer, indent)?;
            {
                Self::write_workspace_deps(
                    writer,
                    indent,
                    0,
                    String::default(),
                    pkg_names,
                    pkg_name_hashes,
                    pkg_bins,
                    pkg_dep_lists,
                    buf,
                    extern_strings,
                    deps_buf,
                    &unresolved_names,
                    &lockfile.workspace_versions,
                    &mut optional_peers_buf,
                )?;

                let mut workspace_sort_buf: Vec<PackageID> = (0..pkgs.len() as PackageID)
                    .filter(|&id| pkg_resolutions[id as usize].tag == ResolutionTag::Workspace)
                    .collect();

                index_sort::sort_indices(&mut workspace_sort_buf, &mut |l, r| {
                    let l_res = &pkg_resolutions[l as usize];
                    let r_res = &pkg_resolutions[r as usize];
                    l_res.workspace().order(*r_res.workspace(), buf, buf)
                });

                for &workspace_pkg_id in &workspace_sort_buf {
                    let res = &pkg_resolutions[workspace_pkg_id as usize];
                    writer.write_all(b"\n")?;
                    Self::write_indent(writer, *indent)?;
                    Self::write_workspace_deps(
                        writer,
                        indent,
                        workspace_pkg_id,
                        *res.workspace(),
                        pkg_names,
                        pkg_name_hashes,
                        pkg_bins,
                        pkg_dep_lists,
                        buf,
                        extern_strings,
                        deps_buf,
                        &unresolved_names,
                        &lockfile.workspace_versions,
                        &mut optional_peers_buf,
                    )?;
                }
            }
            writer.write_byte(b'\n')?;
            Self::dec_indent(writer, indent)?;
            writer.write_all(b"},\n")?;

            // dependencies, relative path, depth
            let mut tree_sort_buf: Vec<(Box<[DependencyID]>, Box<[u8]>, usize)> = Vec::new();

            // find trusted and patched dependencies. also overrides
            while let Some(node) = pkgs_iter.next(None) {
                tree_sort_buf.push((
                    Box::<[DependencyID]>::from(node.dependencies),
                    Box::<[u8]>::from(node.relative_path.as_bytes()),
                    node.depth,
                ));

                for &dep_id in node.dependencies {
                    let pkg_id = resolution_buf[dep_id as usize];
                    if pkg_id == invalid_package_id {
                        continue;
                    }

                    let pkg_name = pkg_names[pkg_id as usize];
                    let pkg_name_hash = pkg_name_hashes[pkg_id as usize];
                    let res = &pkg_resolutions[pkg_id as usize];
                    let dep = &deps_buf[dep_id as usize];

                    if lockfile.patched_dependencies.count() > 0 {
                        use std::io::Write;
                        let _ = write!(&mut temp_buf, "{}@", bstr::BStr::new(pkg_name.slice(buf)));
                        match res.tag {
                            ResolutionTag::Workspace => {
                                if let Some(workspace_version) =
                                    lockfile.workspace_versions.get(&pkg_name_hash)
                                {
                                    let _ = write!(&mut temp_buf, "{}", workspace_version.fmt(buf));
                                }
                            }
                            _ => {
                                let _ = write!(
                                    &mut temp_buf,
                                    "{}",
                                    res.fmt(buf, bun_core::fmt::PathSep::Posix)
                                );
                            }
                        }

                        let name_and_version = temp_buf.as_slice();
                        let name_and_version_hash = StringBuilder::string_hash(name_and_version);

                        if let Some(patch) =
                            lockfile.patched_dependencies.get(&name_and_version_hash)
                        {
                            found_patched_dependencies.insert(
                                name_and_version_hash,
                                (Box::<[u8]>::from(name_and_version), patch.path),
                            );
                        }

                        temp_buf.clear();
                    }

                    // intentionally not checking default trusted dependencies
                    if let Some(trusted_dependencies) = &lockfile.trusted_dependencies {
                        let (name, name_hash) =
                            res.trusted_name((dep.name, dep.name_hash), (pkg_name, pkg_name_hash));
                        if let Some(trusted_name) =
                            trusted_dependencies.get(&(name_hash as TruncatedPackageNameHash))
                        {
                            if **trusted_name == *name.slice(buf) {
                                found_trusted_dependencies.insert(name_hash, name);
                            }
                        }
                    }
                }
            }

            pkgs_iter.reset();

            index_sort::sort_slice_by(&mut tree_sort_buf, |l, r| {
                l.2.cmp(&r.2).then_with(|| strings::order(&l.1, &r.1))
            });

            if found_trusted_dependencies.len() > 0 {
                Self::write_indent(writer, *indent)?;
                writer.write_all(b"\"trustedDependencies\": [\n")?;
                *indent += 1;
                for dep_name in found_trusted_dependencies.values() {
                    Self::write_indent(writer, *indent)?;
                    writeln!(writer, "\"{}\",", bstr::BStr::new(dep_name.slice(buf)))?;
                }

                Self::dec_indent(writer, indent)?;
                writer.write_all(b"],\n")?;
            } else if (lockfile.trusted_dependencies.as_ref())
                .is_some_and(|trusted_dependencies| trusted_dependencies.count() == 0)
            {
                // A checkout without the workspace that declares `[]` must tell it from no list.
                Self::write_indent(writer, *indent)?;
                writer.write_all(b"\"trustedDependencies\": [],\n")?;
            }

            if found_patched_dependencies.len() > 0 {
                Self::write_indent(writer, *indent)?;
                writer.write_all(b"\"patchedDependencies\": {\n")?;
                *indent += 1;
                for value in found_patched_dependencies.values() {
                    let (name_and_version, patch_path) = value;
                    Self::write_indent(writer, *indent)?;
                    writeln!(
                        writer,
                        "{}: {},",
                        bun_core::fmt::format_json_string_utf8(
                            name_and_version,
                            Default::default()
                        ),
                        patch_path.fmt_json(buf, Default::default()),
                    )?;
                }

                Self::dec_indent(writer, indent)?;
                writer.write_all(b"},\n")?;
            }

            if !lockfile.overrides.is_empty() {
                lockfile
                    .overrides
                    .sort(lockfile.buffers.string_bytes.as_slice());

                Self::write_indent(writer, *indent)?;
                writer.write_all(b"\"overrides\": {\n")?;
                *indent += 1;
                if !lockfile.overrides.has_scoped() {
                    let mut key_buf: Vec<u8> = Vec::new();
                    for override_dep in lockfile.overrides.map.values() {
                        Self::write_override_rule(
                            writer,
                            *indent,
                            &mut key_buf,
                            override_dep.name.slice(buf),
                            b"",
                            override_dep.version.literal,
                            buf,
                        )?;
                    }
                } else {
                    Self::write_override_rules(writer, *indent, &lockfile.overrides, buf)?;
                }

                Self::dec_indent(writer, indent)?;
                writer.write_all(b"},\n")?;
            }

            if lockfile.catalogs.has_any() {
                // this will sort the default map, and each
                // named catalog map
                lockfile.catalogs.sort(&lockfile.buffers);
            }

            if lockfile.catalogs.default.count() > 0 {
                Self::write_indent(writer, *indent)?;
                writer.write_all(b"\"catalog\": {\n")?;
                *indent += 1;
                Self::write_catalog(writer, *indent, &lockfile.catalogs.default, buf)?;
                Self::dec_indent(writer, indent)?;
                writer.write_all(b"},\n")?;
            }

            if lockfile.catalogs.groups.count() > 0 {
                Self::write_indent(writer, *indent)?;
                writer.write_all(b"\"catalogs\": {\n")?;
                *indent += 1;

                for (catalog_name, catalog_deps) in lockfile.catalogs.groups.iter() {
                    Self::write_indent(writer, *indent)?;
                    writeln!(
                        writer,
                        "{}: {{",
                        catalog_name.fmt_json(buf, Default::default())
                    )?;
                    *indent += 1;

                    Self::write_catalog(writer, *indent, catalog_deps, buf)?;
                    Self::dec_indent(writer, indent)?;
                    writer.write_all(b"},\n")?;
                }

                Self::dec_indent(writer, indent)?;
                writer.write_all(b"},\n")?;
            }

            let extension_lines = if lockfile.package_extensions.applied.is_empty() {
                Vec::new()
            } else {
                lockfile.package_extension_lines()
            };
            if !extension_lines.is_empty() {
                Self::write_indent(writer, *indent)?;
                writer.write_all(b"\"packageExtensions\": {\n")?;
                *indent += 1;
                for line in extension_lines {
                    Self::write_indent(writer, *indent)?;
                    writer.write_all(&line)?;
                }
                Self::dec_indent(writer, indent)?;
                writer.write_all(b"},\n")?;
            }

            let mut tree_deps_sort_buf: Vec<DependencyID> = Vec::new();
            let mut pkg_deps_sort_buf: Vec<DependencyID> = Vec::new();
            let mut pkg_key_buf: Vec<u8> = Vec::new();

            Self::write_indent(writer, *indent)?;
            writer.write_all(b"\"packages\": {")?;
            let mut first = true;
            for item in &tree_sort_buf {
                let (dependencies, relative_path, depth) = item;
                tree_deps_sort_buf.clear();
                tree_deps_sort_buf.extend_from_slice(dependencies);
                sort_by_name(&mut tree_deps_sort_buf, deps_buf, buf);

                for &dep_id in &tree_deps_sort_buf {
                    let pkg_id = resolution_buf[dep_id as usize];
                    if pkg_id == invalid_package_id {
                        continue;
                    }

                    let res = &pkg_resolutions[pkg_id as usize];
                    if !res.tag.belongs_in_lockfile() {
                        continue;
                    }

                    if first {
                        first = false;
                        writer.write_byte(b'\n')?;
                        Self::inc_indent(writer, indent)?;
                    } else {
                        writer.write_all(b",\n\n")?;
                        Self::write_indent(writer, *indent)?;
                    }

                    writer.write_byte(b'"')?;
                    // relative_path is empty string for root resolutions
                    write!(
                        writer,
                        "{}",
                        bun_core::fmt::format_json_string_utf8(
                            relative_path,
                            bun_core::fmt::JSONFormatterUTF8Options { quote: false }
                        ),
                    )?;

                    if *depth != 0 {
                        writer.write_byte(b'/')?;
                    }

                    let dep = &deps_buf[dep_id as usize];
                    let dep_name = dep.name.slice(buf);

                    pkg_key_buf.clear();
                    if pkg_map.map.len() > 0 {
                        pkg_key_buf.extend_from_slice(relative_path);
                        if *depth != 0 {
                            pkg_key_buf.push(b'/');
                        }
                        pkg_key_buf.extend_from_slice(dep_name);
                    }
                    let pkg_key: &[u8] = &pkg_key_buf;

                    write!(
                        writer,
                        "{}\": ",
                        bun_core::fmt::format_json_string_utf8(
                            dep_name,
                            bun_core::fmt::JSONFormatterUTF8Options { quote: false }
                        ),
                    )?;

                    let pkg_name = pkg_names[pkg_id as usize];
                    let pkg_meta = &pkg_metas[pkg_id as usize];
                    let pkg_bin = &pkg_bins[pkg_id as usize];
                    let pkg_deps_list = pkg_dep_lists[pkg_id as usize];

                    pkg_deps_sort_buf.clear();
                    pkg_deps_sort_buf.extend(pkg_deps_list.begin()..pkg_deps_list.end());

                    // there might be duplicate names due to dependency behaviors,
                    // but we print behaviors in different groups so it won't affect
                    // the result
                    sort_by_name(&mut pkg_deps_sort_buf, deps_buf, buf);

                    // INFO = { prod/dev/optional/peer dependencies, os, cpu, libc, hasInstallScript, bin, binDir }

                    // first index is resolution for each type of package
                    // npm         -> [ "name@version", registry (TODO: remove if default), INFO, integrity]
                    // symlink     -> [ "name@link:path", INFO ]
                    // folder      -> [ "name@file:path", INFO ]
                    // workspace   -> [ "name@workspace:path" ] // workspace is only path
                    // tarball     -> [ "name@tarball", INFO ]
                    // root        -> [ "name@root:", { bin, binDir } ]
                    // git         -> [ "name@git+repo", INFO, .bun-tag string (TODO: remove this) ]
                    // github      -> [ "name@github:user/repo", INFO, .bun-tag string (TODO: remove this) ]

                    macro_rules! write_info {
                        () => {
                            Self::write_package_info_object(
                                writer,
                                dep.behavior,
                                deps_buf,
                                &unresolved_names,
                                &pkg_deps_sort_buf,
                                pkg_meta,
                                pkg_bin,
                                buf,
                                &mut optional_peers_buf,
                                extern_strings,
                                &pkg_map,
                                pkg_key,
                                &mut path_buf,
                            )?
                        };
                    }

                    match res.tag {
                        ResolutionTag::Root => {
                            write!(
                                writer,
                                "[\"{}@root:\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                // we don't read the root package version into the binary lockfile
                            )?;

                            writer.write_byte(b'{')?;
                            if pkg_bin.tag != BinTag::None {
                                writer.write_all(if pkg_bin.tag == BinTag::Dir {
                                    b" \"binDir\": "
                                } else {
                                    b" \"bin\": "
                                })?;

                                // TODO(dylan-conway) move this to "workspaces" object
                                pkg_bin.to_json::<_, { ToJsonStyle::SingleLine }>(
                                    None,
                                    buf,
                                    extern_strings,
                                    &mut AsFmt::new(writer),
                                    write_indent_fmt,
                                )?;

                                writer.write_all(b" }]")?;
                            } else {
                                writer.write_all(b"}]")?;
                            }
                        }
                        tag @ (ResolutionTag::Folder | ResolutionTag::Symlink) => {
                            let (prefix, path) = if tag == ResolutionTag::Folder {
                                ("file:", res.folder())
                            } else {
                                ("link:", res.symlink())
                            };
                            write!(
                                writer,
                                "[\"{}@{}{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                prefix,
                                path.fmt_json(buf, JsonOpts { quote: false }),
                            )?;

                            write_info!();

                            writer.write_byte(b']')?;
                        }
                        tag @ (ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball) => {
                            let tarball = if tag == ResolutionTag::LocalTarball {
                                res.local_tarball()
                            } else {
                                res.remote_tarball()
                            };
                            write!(
                                writer,
                                "[\"{}@{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                tarball.fmt_json(buf, JsonOpts { quote: false }),
                            )?;

                            write_info!();

                            if pkg_meta.integrity.tag.is_supported() {
                                write!(writer, ", \"{}\"]", pkg_meta.integrity)?;
                            } else {
                                writer.write_byte(b']')?;
                            }
                        }
                        ResolutionTag::Npm => {
                            write!(
                                writer,
                                "[\"{}@{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                res.npm().version.fmt(buf),
                            )?;

                            // only write the registry if it's not the default. empty string means default registry
                            let url = res.npm().url;
                            let url_slice = url.slice(buf);
                            write!(
                                writer,
                                "\"{}\", ",
                                bun_core::fmt::format_json_string_utf8(
                                    if url_is_under_registry(
                                        url_slice,
                                        Npm::Registry::DEFAULT_URL.as_bytes(),
                                    ) {
                                        b"" as &[u8]
                                    } else {
                                        url_slice
                                    },
                                    bun_core::fmt::JSONFormatterUTF8Options { quote: false }
                                ),
                            )?;

                            write_info!();

                            write!(writer, ", \"{}\"]", pkg_meta.integrity)?;
                        }
                        ResolutionTag::Workspace => {
                            write!(
                                writer,
                                "[\"{}@workspace:{}\"]",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                res.workspace().fmt_json(buf, JsonOpts { quote: false }),
                            )?;
                        }
                        tag @ (ResolutionTag::Git | ResolutionTag::Github) => {
                            // inline .git, .github
                            let repo: &Repository = res.repository();
                            let prefix: &str = if tag == ResolutionTag::Git {
                                "git+"
                            } else {
                                "github:"
                            };
                            {
                                use std::io::Write;
                                let _ = write!(&mut temp_buf, "{}", repo.fmt(prefix, buf));
                            }
                            write!(
                                writer,
                                "[\"{}@{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                bun_core::fmt::format_json_string_utf8(
                                    temp_buf.as_slice(),
                                    bun_core::fmt::JSONFormatterUTF8Options { quote: false }
                                ),
                            )?;
                            temp_buf.clear();

                            write_info!();

                            write!(
                                writer,
                                ", {}",
                                repo.resolved.fmt_json(buf, Default::default())
                            )?;
                            if pkg_meta.integrity.tag.is_supported() {
                                write!(writer, ", \"{}\"]", pkg_meta.integrity)?;
                            } else {
                                writer.write_byte(b']')?;
                            }
                        }
                        _ => unreachable!(),
                    }
                }
            }

            if !first {
                writer.write_all(b",\n")?;
                Self::dec_indent(writer, indent)?;
            }
            writer.write_all(b"}\n")?;
        }
        Self::dec_indent(writer, indent)?;
        writer.write_all(b"}\n")?;

        Ok(())
    }

    fn write_catalog(
        writer: &mut Writer,
        indent: u32,
        catalog: &super::catalog_map::Map,
        buf: &[u8],
    ) -> Result<(), WriteError> {
        for dep in catalog.values() {
            Self::write_indent(writer, indent)?;
            writeln!(
                writer,
                "{}: {},",
                dep.name.fmt_json(buf, Default::default()),
                dep.version.literal.fmt_json(buf, Default::default()),
            )?;
        }
        Ok(())
    }

    /// Writes a single line object. Contains dependencies, os, cpu, libc, and bin
    /// { "devDependencies": { "one": "1.1.1", "two": "2.2.2" }, "os": "none" }
    fn write_package_info_object(
        writer: &mut Writer,
        dep_behavior: Behavior,
        deps_buf: &[Dependency],
        unresolved_names: &dyn Fn(&[DependencyID]) -> Vec<String>,
        pkg_dep_ids: &[DependencyID],
        meta: &Meta,
        bin: &Bin,
        buf: &[u8],
        optional_peers_buf: &mut Vec<String>,
        extern_strings: &[ExternalString],
        pkg_map: &PkgMap<()>,
        pkg_path: &[u8],
        path_buf: &mut [u8],
    ) -> Result<(), WriteError> {
        writer.write_byte(b'{')?;

        let mut any = false;
        for &(group_name, group_behavior) in WORKSPACE_DEPENDENCY_GROUPS.iter() {
            let mut first = true;
            for &dep_id in pkg_dep_ids {
                let dep = &deps_buf[dep_id as usize];
                if !dep.behavior.intersects(group_behavior) {
                    continue;
                }

                if dep.behavior.is_optional_peer() {
                    // only write to "peerDependencies"
                    if group_behavior.is_optional() {
                        continue;
                    }

                    optional_peers_buf.push(dep.name);
                }

                if first {
                    if any {
                        writer.write_byte(b',')?;
                    }
                    writer.write_all(b" \"")?;
                    writer.write_all(group_name.as_bytes())?;
                    writer.write_all(b"\": { ")?;
                    first = false;
                    any = true;
                } else {
                    writer.write_all(b", ")?;
                }

                write!(
                    writer,
                    "{}: {}",
                    bun_core::fmt::format_json_string_utf8(dep.name.slice(buf), Default::default()),
                    bun_core::fmt::format_json_string_utf8(
                        dep.version.literal.slice(buf),
                        Default::default()
                    ),
                )?;

                if dep.behavior.contains(Behavior::PEER)
                    && !dep.behavior.contains(Behavior::OPTIONAL)
                    && pkg_map.map.len() > 0
                {
                    if pkg_map
                        .find_resolution(pkg_path, dep, buf, path_buf, None)
                        .is_err()
                    {
                        optional_peers_buf.push(dep.name);
                    }
                }
            }

            if !first {
                writer.write_all(b" }")?;
            }
        }

        let unresolved = unresolved_names(pkg_dep_ids);
        for (key, names) in [
            ("optionalPeers", optional_peers_buf.as_slice()),
            ("unresolved", unresolved.as_slice()),
        ] {
            if names.is_empty() {
                continue;
            }
            debug_assert!(any);
            write!(writer, ", \"{key}\": [")?;

            for (i, name) in names.iter().enumerate() {
                write!(
                    writer,
                    "{}{}{}",
                    if i != 0 { " " } else { "" },
                    bun_core::fmt::format_json_string_utf8(name.slice(buf), Default::default()),
                    if i != names.len() - 1 { "," } else { "" },
                )?;
            }

            writer.write_byte(b']')?;
        }

        let mut write_key = |writer: &mut Writer, key: &[u8]| -> Result<(), WriteError> {
            if core::mem::replace(&mut any, true) {
                writer.write_byte(b',')?;
            }
            writer.write_all(key)?;
            Ok(())
        };

        if dep_behavior.is_bundled() {
            write_key(&mut *writer, b" \"bundled\": true")?;
        }

        if meta.os != Npm::OperatingSystem::ALL {
            write_key(&mut *writer, b" \"os\": ")?;
            Negatable::<Npm::OperatingSystem>::to_json(meta.os, &mut AsFmt::new(writer))?;
        }

        if meta.arch != Npm::Architecture::ALL {
            write_key(&mut *writer, b" \"cpu\": ")?;
            Negatable::<Npm::Architecture>::to_json(meta.arch, &mut AsFmt::new(writer))?;
        }

        // Only a restriction to a single libc matters. It's written by name instead of
        // `Negatable`'s "!musl".
        if let Some(libc) = meta.libc.single_name() {
            write_key(&mut *writer, b" \"libc\": \"")?;
            writer.write_all(libc)?;
            writer.write_byte(b'"')?;
        }

        if meta.has_install_script() {
            write_key(&mut *writer, b" \"hasInstallScript\": true")?;
        }

        if bin.tag != BinTag::None {
            write_key(
                &mut *writer,
                if bin.tag == BinTag::Dir {
                    b" \"binDir\": "
                } else {
                    b" \"bin\": "
                },
            )?;
            bin.to_json::<_, { ToJsonStyle::SingleLine }>(
                None,
                buf,
                extern_strings,
                &mut AsFmt::new(writer),
                write_indent_fmt,
            )?;
        }

        if any {
            writer.write_all(b" }")?;
        } else {
            writer.write_byte(b'}')?;
        }

        optional_peers_buf.clear();
        Ok(())
    }

    fn write_workspace_deps(
        writer: &mut Writer,
        indent: &mut u32,
        pkg_id: PackageID,
        res: String,
        pkg_names: &[String],
        pkg_name_hashes: &[PackageNameHash],
        pkg_bins: &[Bin],
        pkg_deps: &[DependencySlice],
        buf: &[u8],
        extern_strings: &[ExternalString],
        deps_buf: &[Dependency],
        unresolved_names: &dyn Fn(&[DependencyID]) -> Vec<String>,
        workspace_versions: &VersionHashMap,
        optional_peers_buf: &mut Vec<String>,
    ) -> Result<(), WriteError> {
        // `optional_peers_buf` is cleared at the fn tail.
        // Error path (`?` on writer) aborts the whole save in the caller, so skipping the
        // clear on early-return cannot leak stale entries into a subsequent call.

        // any - have any properties been written
        let mut any = false;

        // always print the workspace key even if it doesn't have dependencies because we
        // need a way to detect new/deleted workspaces
        if pkg_id == 0 {
            writer.write_all(b"\"\": {")?;
            let root_name = pkg_names[0].slice(buf);
            if !root_name.is_empty() {
                writer.write_byte(b'\n')?;
                Self::inc_indent(writer, indent)?;
                write!(
                    writer,
                    "\"name\": {}",
                    bun_core::fmt::format_json_string_utf8(root_name, Default::default()),
                )?;

                // TODO(dylan-conway) should we save version?
                any = true;
            }
        } else {
            write!(
                writer,
                "{}: {{",
                bun_core::fmt::format_json_string_utf8(res.slice(buf), Default::default()),
            )?;
            writer.write_byte(b'\n')?;
            Self::inc_indent(writer, indent)?;
            write!(
                writer,
                "\"name\": {}",
                bun_core::fmt::format_json_string_utf8(
                    pkg_names[pkg_id as usize].slice(buf),
                    Default::default()
                ),
            )?;

            if let Some(version) = workspace_versions.get(&pkg_name_hashes[pkg_id as usize]) {
                writer.write_all(b",\n")?;
                Self::write_indent(writer, *indent)?;
                write!(writer, "\"version\": \"{}\"", version.fmt(buf))?;
            }

            if pkg_bins[pkg_id as usize].tag != BinTag::None {
                let bin = &pkg_bins[pkg_id as usize];
                writer.write_all(b",\n")?;
                Self::write_indent(writer, *indent)?;
                if bin.tag == BinTag::Dir {
                    writer.write_all(b"\"binDir\": ")?;
                } else {
                    writer.write_all(b"\"bin\": ")?;
                }
                bin.to_json::<_, { ToJsonStyle::MultiLine }>(
                    Some(indent),
                    buf,
                    extern_strings,
                    &mut AsFmt::new(writer),
                    write_indent_fmt,
                )?;
            }

            any = true;
        }

        // Re-sort by current name: a no-alias git/tarball dep sorts under its version
        // literal at parse time, and `assign_resolution` renames it without a re-sort.
        let deps_list = pkg_deps[pkg_id as usize];
        let mut deps_sort_buf: Vec<DependencyID> = (deps_list.begin()..deps_list.end()).collect();
        sort_by_name(&mut deps_sort_buf, deps_buf, buf);

        for &(group_name, group_behavior) in WORKSPACE_DEPENDENCY_GROUPS.iter() {
            let mut first = true;
            for &dep_id in &deps_sort_buf {
                let dep = &deps_buf[dep_id as usize];
                if !dep.behavior.intersects(group_behavior) {
                    continue;
                }

                if dep.behavior.is_optional_peer() {
                    if group_behavior.is_optional() {
                        continue;
                    }

                    optional_peers_buf.push(dep.name);
                }

                if first {
                    if any {
                        writer.write_byte(b',')?;
                    }
                    writer.write_byte(b'\n')?;
                    if any {
                        Self::write_indent(writer, *indent)?;
                    } else {
                        Self::inc_indent(writer, indent)?;
                    }
                    writer.write_all(b"\"")?;
                    writer.write_all(group_name.as_bytes())?;
                    writer.write_all(b"\": {\n")?;
                    Self::inc_indent(writer, indent)?;
                    any = true;
                    first = false;
                } else {
                    writer.write_all(b",\n")?;
                    Self::write_indent(writer, *indent)?;
                }

                let name = dep.name.slice(buf);
                let version = dep.version.literal.slice(buf);

                write!(
                    writer,
                    "{}: {}",
                    bun_core::fmt::format_json_string_utf8(name, Default::default()),
                    bun_core::fmt::format_json_string_utf8(version, Default::default()),
                )?;
            }

            if !first {
                writer.write_all(b",\n")?;
                Self::dec_indent(writer, indent)?;
                writer.write_all(b"}")?;
            }
        }
        let unresolved = unresolved_names(&deps_sort_buf);
        for (key, names) in [
            ("optionalPeers", optional_peers_buf.as_slice()),
            ("unresolved", unresolved.as_slice()),
        ] {
            if names.is_empty() {
                continue;
            }
            debug_assert!(any);
            writer.write_all(b",\n")?;
            Self::write_indent(writer, *indent)?;
            writeln!(writer, "\"{key}\": [")?;
            *indent += 1;
            for name in names {
                Self::write_indent(writer, *indent)?;
                writeln!(
                    writer,
                    "{},",
                    bun_core::fmt::format_json_string_utf8(name.slice(buf), Default::default()),
                )?;
            }
            Self::dec_indent(writer, indent)?;
            writer.write_byte(b']')?;
        }

        if any {
            writer.write_all(b",\n")?;
            Self::dec_indent(writer, indent)?;
        }
        writer.write_all(b"},")?;

        optional_peers_buf.clear();
        Ok(())
    }

    /// `name` when `range` is empty, else `name@range` built in `key_buf`.
    fn override_selector_key<'a>(
        key_buf: &'a mut Vec<u8>,
        name: &'a [u8],
        range: &[u8],
    ) -> &'a [u8] {
        if range.is_empty() {
            return name;
        }
        key_buf.clear();
        key_buf.extend_from_slice(name);
        key_buf.push(b'@');
        key_buf.extend_from_slice(range);
        key_buf.as_slice()
    }

    fn write_override_rule(
        writer: &mut Writer,
        indent: u32,
        key_buf: &mut Vec<u8>,
        name: &[u8],
        range: &[u8],
        value: String,
        buf: &[u8],
    ) -> Result<(), WriteError> {
        Self::write_indent(writer, indent)?;
        writeln!(
            writer,
            "{}: {},",
            bun_core::fmt::format_json_string_utf8(
                Self::override_selector_key(key_buf, name, range),
                Default::default()
            ),
            value.fmt_json(buf, Default::default()),
        )?;
        Ok(())
    }

    /// Scoped rules live in selector-keyed objects; a flat rule folds into its name's unranged group as `"."`.
    fn write_override_rules(
        writer: &mut Writer,
        indent: u32,
        overrides: &OverrideMap,
        buf: &[u8],
    ) -> Result<(), WriteError> {
        struct GroupKey<'a> {
            name_hash: PackageNameHash,
            name: &'a [u8],
            literal: &'a [u8],
        }

        fn order_keys(lhs: &GroupKey<'_>, rhs: &GroupKey<'_>) -> core::cmp::Ordering {
            strings::order(lhs.name, rhs.name)
                .then_with(|| strings::order(lhs.literal, rhs.literal))
        }

        let flat: &[Dependency] = overrides.map.values();
        let scoped: &[ScopedOverride] = overrides.scoped.as_slice();
        let solo_end = scoped
            .iter()
            .position(|rule| rule.parent.is_some())
            .unwrap_or(scoped.len());
        let mut key_buf: Vec<u8> = Vec::new();
        let mut f = 0usize;
        let mut s = 0usize;
        let mut g = solo_end;

        while f < flat.len() || s < solo_end || g < scoped.len() {
            let solo_key = (s < solo_end).then(|| GroupKey {
                name_hash: scoped[s].dep.name_hash,
                name: scoped[s].dep.name.slice(buf),
                literal: scoped[s].target_range.literal.slice(buf),
            });
            let parented_key = scoped.get(g).map(|rule| {
                let parent = rule
                    .parent
                    .as_ref()
                    .expect("OverrideMap::sort places parent-less rules first");
                GroupKey {
                    name_hash: parent.name_hash,
                    name: parent.name.slice(buf),
                    literal: parent.version.literal.slice(buf),
                }
            });
            let group = match (solo_key, parented_key) {
                (Some(solo), Some(parented)) => Some(if order_keys(&parented, &solo).is_lt() {
                    parented
                } else {
                    solo
                }),
                (solo, parented) => solo.or(parented),
            };

            if let Some(flat_dep) = flat.get(f) {
                let flat_first = match &group {
                    None => true,
                    Some(group) => match strings::order(flat_dep.name.slice(buf), group.name) {
                        core::cmp::Ordering::Less => true,
                        core::cmp::Ordering::Equal => !group.literal.is_empty(),
                        core::cmp::Ordering::Greater => false,
                    },
                };
                if flat_first {
                    Self::write_override_rule(
                        writer,
                        indent,
                        &mut key_buf,
                        flat_dep.name.slice(buf),
                        b"",
                        flat_dep.version.literal,
                        buf,
                    )?;
                    f += 1;
                    continue;
                }
            }

            let Some(group) = group else {
                break;
            };

            Self::write_indent(writer, indent)?;
            writeln!(
                writer,
                "{}: {{",
                bun_core::fmt::format_json_string_utf8(
                    Self::override_selector_key(&mut key_buf, group.name, group.literal),
                    Default::default()
                ),
            )?;

            let dot: Option<String> = if group.literal.is_empty() {
                match flat.get(f) {
                    Some(flat_dep) if flat_dep.name_hash == group.name_hash => {
                        f += 1;
                        Some(flat_dep.version.literal)
                    }
                    _ => None,
                }
            } else {
                match (s < solo_end).then(|| &scoped[s]) {
                    Some(rule)
                        if rule.dep.name_hash == group.name_hash
                            && rule.target_range.literal.slice(buf) == group.literal =>
                    {
                        s += 1;
                        Some(rule.dep.version.literal)
                    }
                    _ => None,
                }
            };
            if let Some(value) = dot {
                Self::write_indent(writer, indent + 1)?;
                writeln!(
                    writer,
                    "\".\": {},",
                    value.fmt_json(buf, Default::default())
                )?;
            }

            while let Some(rule) = scoped.get(g) {
                let in_group = rule.parent.as_ref().is_some_and(|parent| {
                    parent.name_hash == group.name_hash
                        && parent.version.literal.slice(buf) == group.literal
                });
                if !in_group {
                    break;
                }
                Self::write_override_rule(
                    writer,
                    indent + 1,
                    &mut key_buf,
                    rule.dep.name.slice(buf),
                    rule.target_range.literal.slice(buf),
                    rule.dep.version.literal,
                    buf,
                )?;
                g += 1;
            }

            Self::write_indent(writer, indent)?;
            writer.write_all(b"},\n")?;
        }

        Ok(())
    }

    fn write_indent(writer: &mut Writer, indent: u32) -> Result<(), WriteError> {
        for _ in 0..indent {
            writer.write_all(b"  ")?;
        }
        Ok(())
    }

    fn inc_indent(writer: &mut Writer, indent: &mut u32) -> Result<(), WriteError> {
        *indent += 1;
        Self::write_indent(writer, *indent)
    }

    fn dec_indent(writer: &mut Writer, indent: &mut u32) -> Result<(), WriteError> {
        *indent -= 1;
        Self::write_indent(writer, *indent)
    }
}

const WORKSPACE_DEPENDENCY_GROUPS: [(&str, Behavior); 4] = [
    ("dependencies", Behavior::PROD),
    ("devDependencies", Behavior::DEV),
    ("optionalDependencies", Behavior::OPTIONAL),
    ("peerDependencies", Behavior::PEER),
];

#[derive(Debug, Clone, Copy, Eq, PartialEq, strum::IntoStaticStr)]
pub enum ParseError {
    OutOfMemory,
    InvalidLockfileVersion,
    UnknownLockfileVersion,
    InvalidConfigVersion,
    InvalidPatchedDependencies,
    InvalidWorkspaceObject,
    InvalidPackagesObject,
    InvalidPackageKey,
    InvalidPackageInfo,
    InvalidSemver,
    InvalidPackagesTree,
    InvalidTrustedDependenciesSet,
    InvalidOverridesObject,
    InvalidCatalogObject,
    InvalidCatalogsObject,
    InvalidDependencyVersion,
    InvalidPackageResolution,
    UnexpectedResolution,
}

bun_core::oom_from_alloc!(ParseError);

type PkgPathSet = PkgMap<()>;

struct PkgMap<T> {
    pub map: StringHashMap<T>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, strum::IntoStaticStr)]
pub(crate) enum ResolveError {
    InvalidPackageKey,
    Unresolvable,
}

/// A package that's printed at several paths binds its dependencies once per path. Equal or better
/// evidence wins.
#[derive(Debug, Clone, Copy, Eq, PartialEq, PartialOrd, Ord)]
enum RowEvidence {
    Unbound,
    /// The walk found the root's own dependency. This says little about a peer, because the hoister
    /// gives a peer the root's dependency no matter which package the peer resolves to.
    RootDependency,
    /// The walk found the package at a path between this row and the root.
    Walked,
    /// The root's copy, which may be this edge's own binding, placed there from this row.
    WalkedToRoot,
    /// The walk found a copy that is outside an optional peer's range. If the peer resolved to any
    /// other package, that package would be printed in this row's own path.
    Refused,
    /// The copy that's printed under the package's own path. It's only there for the package's own
    /// dependency.
    OwnEntry,
    /// The walk found nothing, so the optional peer is unresolved. A resolved one has a copy above
    /// every path that its package is printed at.
    Unprovided,
}

impl<T> PkgMap<T> {
    fn init() -> Self {
        Self {
            map: StringHashMap::default(),
        }
    }

    fn get_or_put(
        &mut self,
        name: &[u8],
    ) -> Result<bun_collections::string_hash_map::GetOrPutResult<'_, T>, bun_alloc::AllocError>
    where
        T: Default,
    {
        self.map.get_or_put(name)
    }

    fn put(&mut self, name: impl AsRef<[u8]>, value: T) {
        self.map.put_assume_capacity(name.as_ref(), value);
    }

    fn get(&self, name: &[u8]) -> Option<&T> {
        self.map.get(name)
    }

    fn contains(&self, path: &[u8]) -> bool {
        self.map.contains_key(path)
    }

    /// With `bundled_pkgs`, the walk stops one level above a bundled package, as the hoister's.
    ///
    /// Only `"bundled": true` entries bound the walk: a transitive dependency
    /// of a bundled package also inherits the bundle's hoist root in
    /// `Tree.rs`, but its lockfile path (`a/c`, no bundled marker) is
    /// indistinguishable from an ordinary conflict-nested package whose hoist
    /// root is the lockfile root.
    fn find_resolution(
        &self,
        pkg_path: &[u8],
        dep: &Dependency,
        string_buf: &[u8],
        path_buf: &mut [u8],
        bundled_pkgs: Option<&PkgPathSet>,
    ) -> Result<(&T, RowEvidence), ResolveError> {
        let dep_name = dep.name.slice(string_buf);

        if pkg_path.len() + 1 + dep_name.len() > path_buf.len() {
            return Err(ResolveError::InvalidPackageKey);
        }

        path_buf[0..pkg_path.len()].copy_from_slice(pkg_path);
        path_buf[pkg_path.len()] = b'/';
        let mut offset = pkg_path.len() + 1;

        let mut at_bundle_root = false;
        let mut valid = true;
        while valid {
            path_buf[offset..offset + dep_name.len()].copy_from_slice(dep_name);
            let res_path = &path_buf[0..offset + dep_name.len()];

            if let Some(entry) = self.map.get(res_path) {
                let evidence = if offset == pkg_path.len() + 1 {
                    RowEvidence::OwnEntry
                } else if offset == 0 {
                    RowEvidence::WalkedToRoot
                } else {
                    RowEvidence::Walked
                };
                return Ok((entry, evidence));
            }

            if offset == 0 || at_bundle_root {
                return Err(ResolveError::Unresolvable);
            }

            if let Some(bundled_pkgs) = bundled_pkgs {
                at_bundle_root = bundled_pkgs.contains(&path_buf[0..offset - 1]);
            }

            let Some(slash) = strings::last_index_of_char(&path_buf[0..offset - 1], b'/') else {
                offset = 0;
                continue;
            };

            // might be a scoped package
            let Some(at) = strings::last_index_of_char(&path_buf[0..offset - 1], b'@') else {
                offset = slash + 1;
                continue;
            };

            if at > slash {
                valid = false;
                continue;
            }

            let Some(next_slash) = strings::last_index_of_char(&path_buf[0..slash], b'/') else {
                if at != 0 {
                    return Err(ResolveError::InvalidPackageKey);
                }
                offset = 0;
                continue;
            };

            if next_slash > at {
                // there's a scoped package but it exists farther up
                offset = slash + 1;
                continue;
            }

            if next_slash + 1 != at {
                valid = false;
                continue;
            }

            offset = at;
        }

        Err(ResolveError::InvalidPackageKey)
    }
}

fn object_rows(expr: &Expr) -> &[JSON::E::PropertyJSON] {
    match &expr.data {
        ExprData::EObjectJSON(o) => o.get().properties(),
        _ => {
            debug_assert!(!expr.is_object(), "object_rows on a mutable object");
            &[]
        }
    }
}

fn array_items(expr: &Expr) -> &[JSON::E::JsonValue] {
    match &expr.data {
        ExprData::EArrayJSON(a) => a.get().items(),
        _ => &[],
    }
}

fn item_loc(source: &bun_ast::Source, key_loc: bun_ast::Loc, index: usize) -> bun_ast::Loc {
    let array_loc = value_loc_of(source, key_loc);
    JSON::array_item_loc(&source.contents, array_loc, index).unwrap_or(array_loc)
}

/// bun writes a hash it can check, or nothing. Anything else must not turn the check off.
fn parse_integrity(
    integrity_str: &[u8],
    lockfile_version: Version,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    key_loc: bun_ast::Loc,
    index: usize,
) -> Result<Integrity, ParseError> {
    let integrity = Integrity::parse(integrity_str);
    if integrity_str.is_empty() || integrity.tag.is_supported() {
        return Ok(integrity);
    }
    let (source, loc) = (Some(source), item_loc(source, key_loc, index));
    if lockfile_version.at_least(Version::V2) {
        log.add_error(source, loc, b"Unsupported or malformed integrity hash");
        return Err(ParseError::InvalidPackageInfo);
    }
    log.add_warning(
        source,
        loc,
        b"Unsupported or malformed integrity hash; ignoring",
    );
    Ok(Integrity::default())
}

fn parse_bin(info: &Expr, lockfile: &mut BinaryLockfile) -> Result<Bin, ParseError> {
    Ok(if let Some(bin) = info.get(b"bin") {
        Bin::parse_append(
            &bin,
            &mut sbuf!(lockfile),
            &mut lockfile.buffers.extern_strings,
        )?
    } else if let Some(bin_dir) = info.get(b"binDir") {
        Bin::parse_append_from_directories(&bin_dir, &mut sbuf!(lockfile))?
    } else {
        Bin::default()
    })
}

fn parse_catalog(
    catalog: &mut super::catalog_map::Map,
    rows: &[JSON::E::PropertyJSON],
    string_buf: &mut StringBuf<'_>,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    invalid: ParseError,
) -> Result<(), ParseError> {
    for row in rows {
        let dep_name_str = row.key.slice();
        if dep_name_str.is_empty() {
            log.add_error(Some(source), row.key_loc, b"Expected a non-empty string");
            return Err(invalid);
        }

        let dep_name_hash = StringBuilder::string_hash(dep_name_str);
        let dep_name = string_buf.append_with_hash(dep_name_str, dep_name_hash)?;

        let Some(version_str) = row.value.as_str() else {
            log.add_error(
                Some(source),
                value_loc_of(source, row.key_loc),
                b"Expected a string",
            );
            return Err(invalid);
        };

        let version = string_buf.append(version_str)?;
        let version_sliced = version.sliced(string_buf.bytes.as_slice());

        let Some(version) = dependency::parse(
            dep_name,
            dep_name_hash,
            version_sliced.slice,
            &version_sliced,
            &mut *log,
            None,
        ) else {
            log.add_error(
                Some(source),
                value_loc_of(source, row.key_loc),
                b"Invalid catalog version",
            );
            return Err(invalid);
        };

        let entry = catalog.get_or_put_adapted(
            &dep_name,
            &bun_semver::string::ArrayHashContext {
                arg_buf: string_buf.bytes.as_slice(),
                existing_buf: string_buf.bytes.as_slice(),
            },
        )?;

        if entry.found_existing {
            log.add_error(Some(source), row.key_loc, b"Duplicate catalog entry");
            return Err(invalid);
        }

        *entry.key_ptr = dep_name;
        *entry.value_ptr = Dependency {
            name: dep_name,
            name_hash: dep_name_hash,
            version,
            ..Default::default()
        };
    }
    Ok(())
}

pub(crate) fn parse_into_binary_lockfile(
    lockfile: &mut BinaryLockfile,
    root: JSON::Expr,
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    manager: Option<&PackageManager>,
) -> Result<(), ParseError> {
    let at_value = |key_loc| value_loc_of(source, key_loc);
    let at_item = |key_loc, index| item_loc(source, key_loc, index);
    macro_rules! fail {
        ($error:ident, $loc:expr, $message:literal) => {{
            log.add_error(Some(source), $loc, $message);
            return Err(ParseError::$error);
        }};
    }

    lockfile.init_empty();

    let Some(lockfile_version_expr) = root.get(b"lockfileVersion") else {
        fail!(
            InvalidLockfileVersion,
            root.loc,
            b"Missing lockfile version"
        );
    };

    let lockfile_version_num: u32 = match &lockfile_version_expr.data {
        ExprData::ENumber(num)
            if (0.0..=u32::MAX as f64).contains(&num.value()) && num.value().fract() == 0.0 =>
        {
            num.value() as u32
        }
        _ => fail!(
            InvalidLockfileVersion,
            at_value(lockfile_version_expr.loc),
            b"Invalid lockfile version"
        ),
    };

    let Some(lockfile_version) = Version::from_int(lockfile_version_num) else {
        log.add_range_error_fmt_with_notes(
            Some(source),
            bun_ast::Range {
                loc: at_value(lockfile_version_expr.loc),
                ..Default::default()
            },
            Box::new([bun_ast::range_data(
                None,
                bun_ast::Range::NONE,
                b"Run 'bun upgrade' to update to the latest version of Bun",
            )]),
            format_args!(
                "Unsupported lockfile version {}. This lockfile was likely created by a newer version of Bun. (This is Bun v{}, which supports lockfile versions up to {}.)",
                lockfile_version_num,
                bun_core::Global::package_json_version,
                Version::CURRENT as u32,
            ),
        );
        return Err(ParseError::UnknownLockfileVersion);
    };

    lockfile.text_lockfile_version = lockfile_version;

    // configVersion is not required
    if let Some(config_version_expr) = root.get(b"configVersion") {
        lockfile.saved_config_version = match ConfigVersion::from_expr(&config_version_expr) {
            Some(v) => Some(v),
            None => fail!(
                InvalidConfigVersion,
                at_value(config_version_expr.loc),
                b"Invalid \"configVersion\". Expected a number"
            ),
        };
    }

    if let Some(trusted_dependencies_expr) = root.get(b"trustedDependencies") {
        let mut trusted_dependencies = TrustedDependenciesSet::default();
        if !trusted_dependencies_expr.is_array() {
            fail!(
                InvalidTrustedDependenciesSet,
                at_value(trusted_dependencies_expr.loc),
                b"Expected an array"
            );
        }

        for (i, dep) in array_items(&trusted_dependencies_expr).iter().enumerate() {
            let Some(name_str) = dep.as_str() else {
                fail!(
                    InvalidTrustedDependenciesSet,
                    at_item(trusted_dependencies_expr.loc, i),
                    b"Expected a string"
                );
            };
            let name: Box<[u8]> = Box::from(name_str);
            let name_hash: TruncatedPackageNameHash =
                StringBuilder::string_hash(&name) as TruncatedPackageNameHash;
            trusted_dependencies.insert(name_hash, name);
        }

        lockfile.trusted_dependencies = Some(trusted_dependencies);
    }

    if let Some(patched_dependencies_expr) = root.get(b"patchedDependencies") {
        if !patched_dependencies_expr.is_object() {
            fail!(
                InvalidPatchedDependencies,
                at_value(patched_dependencies_expr.loc),
                b"Expected an object"
            );
        }

        for row in object_rows(&patched_dependencies_expr) {
            let Some(path_str) = row.value.as_str() else {
                fail!(
                    InvalidPatchedDependencies,
                    at_value(row.key_loc),
                    b"Expected a string"
                );
            };

            let key_hash = StringBuilder::string_hash(row.key.slice());
            lockfile.patched_dependencies.insert(
                key_hash,
                PatchedDep {
                    path: sbuf!(lockfile).append(path_str)?,
                    ..Default::default()
                },
            );
        }
    }

    if let Some(package_extensions_expr) = root.get(b"packageExtensions") {
        lockfile
            .package_extensions
            .parse_applied(&package_extensions_expr);
    }

    if let Some(overrides_expr) = root.get(b"overrides") {
        if !overrides_expr.is_object() {
            fail!(
                InvalidOverridesObject,
                at_value(overrides_expr.loc),
                b"Expected an object"
            );
        }

        for row in object_rows(&overrides_expr) {
            let name_str = row.key.slice();
            if name_str.is_empty() {
                fail!(
                    InvalidOverridesObject,
                    row.key_loc,
                    b"Expected a non-empty string"
                );
            }

            if let Some(version_str) = row.value.as_str() {
                let ok = lockfile
                    .overrides
                    .put_lockfile_rule(
                        None,
                        PackageSelector {
                            name: name_str,
                            range: b"",
                        },
                        version_str,
                        &mut sbuf!(lockfile),
                        &mut *log,
                    )
                    .map_err(|_| ParseError::OutOfMemory)?;
                if !ok {
                    fail!(
                        InvalidOverridesObject,
                        at_value(row.key_loc),
                        b"Invalid override version"
                    );
                }
                continue;
            }

            let Some(group_obj) = row.value.as_object() else {
                fail!(
                    InvalidOverridesObject,
                    at_value(row.key_loc),
                    b"Expected a string or an object"
                );
            };

            let Ok(parent) = parse_package_segment(name_str) else {
                fail!(InvalidOverridesObject, row.key_loc, b"Invalid override key");
            };

            for child in group_obj.properties() {
                let child_key = child.key.slice();
                let Some(version_str) = child.value.as_str() else {
                    fail!(
                        InvalidOverridesObject,
                        at_value(child.key_loc),
                        b"Expected a string"
                    );
                };

                let group_selector = PackageSelector {
                    name: parent.name,
                    range: parent.range,
                };
                let (rule_parent, rule_target) = if child_key == b"." {
                    (None, group_selector)
                } else {
                    let Ok(target) = parse_package_segment(child_key) else {
                        fail!(
                            InvalidOverridesObject,
                            child.key_loc,
                            b"Invalid override key"
                        );
                    };
                    (Some(group_selector), target)
                };

                let ok = lockfile
                    .overrides
                    .put_lockfile_rule(
                        rule_parent,
                        rule_target,
                        version_str,
                        &mut sbuf!(lockfile),
                        &mut *log,
                    )
                    .map_err(|_| ParseError::OutOfMemory)?;
                if !ok {
                    fail!(
                        InvalidOverridesObject,
                        at_value(child.key_loc),
                        b"Invalid override version"
                    );
                }
            }
        }
    }

    if let Some(catalog_expr) = root.get(b"catalog") {
        if !catalog_expr.is_object() {
            fail!(
                InvalidCatalogObject,
                at_value(catalog_expr.loc),
                b"Expected an object"
            );
        }

        parse_catalog(
            &mut lockfile.catalogs.default,
            object_rows(&catalog_expr),
            &mut sbuf!(lockfile),
            log,
            source,
            ParseError::InvalidCatalogObject,
        )?;
    }

    if let Some(catalogs_expr) = root.get(b"catalogs") {
        if !catalogs_expr.is_object() {
            fail!(
                InvalidCatalogsObject,
                at_value(catalogs_expr.loc),
                b"Expected an object"
            );
        }

        for catalog_row in object_rows(&catalogs_expr) {
            let catalog_name_str = catalog_row.key.slice();
            if catalog_name_str.is_empty() {
                fail!(
                    InvalidCatalogsObject,
                    catalog_row.key_loc,
                    b"Expected a non-empty string"
                );
            }

            let Some(catalog_obj) = catalog_row.value.as_object() else {
                fail!(
                    InvalidCatalogsObject,
                    at_value(catalog_row.key_loc),
                    b"Expected an object"
                );
            };

            let catalog_name = sbuf!(lockfile).append(catalog_name_str)?;

            let group = lockfile
                .catalogs
                .get_or_put_group(lockfile.buffers.string_bytes.as_slice(), catalog_name)?;

            parse_catalog(
                group,
                catalog_obj.properties(),
                &mut sbuf!(lockfile),
                log,
                source,
                ParseError::InvalidCatalogsObject,
            )?;
        }
    }

    let Some(workspaces_obj) = root.get_object(b"workspaces") else {
        fail!(
            InvalidWorkspaceObject,
            root.loc,
            b"Missing a workspaces object property"
        );
    };

    let mut maybe_root_pkg: Option<Expr> = None;
    // The (last) row of each name, in the order of `workspace_paths`.
    let mut member_rows: Vec<&JSON::E::PropertyJSON> = Vec::new();

    for row in object_rows(&workspaces_obj) {
        if row.value.as_object().is_none() {
            fail!(
                InvalidWorkspaceObject,
                at_value(row.key_loc),
                b"Expected an object"
            );
        }
        let value = Expr::from_json_value(&row.value, row.key_loc);

        let path = row.key.slice();

        if path.is_empty() {
            if maybe_root_pkg.is_some() {
                fail!(
                    InvalidWorkspaceObject,
                    row.key_loc,
                    b"Duplicate root package"
                );
            }

            maybe_root_pkg = Some(value);
            continue;
        }

        let Some(name_expr) = value.get(b"name") else {
            fail!(
                InvalidWorkspaceObject,
                at_value(row.key_loc),
                b"Expected a string name property"
            );
        };

        let Some(name_hash) = name_expr.as_string_hash_utf8(StringBuilder::string_hash)? else {
            fail!(
                InvalidWorkspaceObject,
                at_value(name_expr.loc),
                b"Expected a string name property"
            );
        };

        let listed_before = lockfile
            .workspace_paths
            .insert(name_hash, sbuf!(lockfile).append(path)?);
        match listed_before.and_then(|_| lockfile.workspace_paths.get_index(&name_hash)) {
            Some(index) => member_rows[index] = row,
            None => member_rows.push(row),
        }

        // versions are optional
        if let Some(version_expr) = value.get(b"version") {
            if !version_expr.is_string() {
                fail!(
                    InvalidWorkspaceObject,
                    at_value(version_expr.loc),
                    b"Expected a string version property"
                );
            }

            let version_str = sbuf!(lockfile).append(
                version_expr
                    .as_utf8_string_literal()
                    .expect("infallible: is_string checked"),
            )?;

            let parsed = Semver::Version::parse(
                version_str.sliced(lockfile.buffers.string_bytes.as_slice()),
            );
            if !parsed.valid {
                fail!(
                    InvalidSemver,
                    at_value(version_expr.loc),
                    b"Invalid semver version"
                );
            }

            lockfile
                .workspace_versions
                .insert(name_hash, parsed.version.min());
        }
    }

    let mut optional_peers_buf: HashMap<u64, ()> = HashMap::default();
    let mut unresolved_rows: Vec<DependencyID> = Vec::new();

    let mut bundled_pkgs = PkgPathSet::init();

    let Some(root_pkg_exr) = maybe_root_pkg else {
        fail!(
            InvalidWorkspaceObject,
            at_value(workspaces_obj.loc),
            b"Expected root package"
        );
    };

    {
        // `Expr::get` returns by value and `as_utf8_string_literal` borrows
        // from it, so keep the expr alive for the rest of the block instead
        // of letting it drop at the end of the `if let` arm.
        let name_expr = root_pkg_exr.get(b"name");
        let maybe_name = if let Some(name) = &name_expr {
            match name.as_utf8_string_literal() {
                Some(s) => Some(s),
                None => fail!(
                    InvalidWorkspaceObject,
                    at_value(name.loc),
                    b"Expected a string"
                ),
            }
        } else {
            None
        };

        let (off, len) = parse_append_dependencies(
            lockfile,
            &root_pkg_exr,
            &mut *log,
            source,
            &mut optional_peers_buf,
            &mut unresolved_rows,
            None,
            Some(member_rows.as_slice()),
            true,
        )?;

        let mut root_pkg = Package::default();

        if let Some(name) = maybe_name {
            let name_hash = StringBuilder::string_hash(name);
            root_pkg.name = sbuf!(lockfile).append_with_hash(name, name_hash)?;
            root_pkg.name_hash = name_hash;
        }

        root_pkg.dependencies = DependencySlice::new(off, len);
        root_pkg.resolutions = PackageIDSlice::new(off, len);

        root_pkg.meta.id = 0;
        root_pkg.meta.origin = Origin::Local;
        // Set before the packages are read, so that a `<name>@root:` entry is recognized as this
        // package and not as a second one.
        root_pkg.resolution = Resolution::init(crate::resolution::TaggedValue::Root);
        let root_name_hash = root_pkg.name_hash;
        lockfile.packages.append(root_pkg)?;
        lockfile.get_or_put_id(0, root_name_hash)?;
    }

    let mut pkg_map: PkgMap<PackageID> = PkgMap::init();

    let workspace_pkgs_off: u32 = 1;
    let mut workspace_pkgs_len: u32 = 0;

    if lockfile_version != Version::V0 {
        // these are the `workspaceOnly` packages
        for row in &member_rows {
            let value = Expr::from_json_value(&row.value, row.key_loc);

            let mut pkg = Package {
                resolution: Resolution::init(crate::resolution::TaggedValue::Workspace(
                    sbuf!(lockfile).append(row.key.slice())?,
                )),
                ..Default::default()
            };

            let name_expr = value.get(b"name").unwrap();
            let name = name_expr
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            let name_hash = StringBuilder::string_hash(name);

            pkg.name = sbuf!(lockfile).append_with_hash(name, name_hash)?;
            pkg.name_hash = name_hash;

            let (off, len) = parse_append_dependencies(
                lockfile,
                &value,
                &mut *log,
                source,
                &mut optional_peers_buf,
                &mut unresolved_rows,
                None,
                None,
                true,
            )?;

            pkg.dependencies = DependencySlice::new(off, len);
            pkg.resolutions = PackageIDSlice::new(off, len);
            pkg.bin = parse_bin(&value, lockfile)?;

            // there should be no duplicates
            let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;
            pkg_map.put(name, pkg_id);
            workspace_pkgs_len += 1;
        }
    }

    // A missing "packages" object is parsed like an empty one.
    let pkgs_expr = root.get(b"packages");

    {
        if let Some(pkgs_expr) = &pkgs_expr {
            if !pkgs_expr.is_object() {
                fail!(
                    InvalidPackagesObject,
                    at_value(pkgs_expr.loc),
                    b"Expected an object"
                );
            }
        }
        let pkg_rows: &[JSON::E::PropertyJSON] = pkgs_expr.as_ref().map_or(&[], object_rows);
        pkg_map.map.reserve(pkg_rows.len());

        // find the bundle roots.
        //
        // Resolving bundled dependencies:
        // bun.lock marks package keys with { bundled: true } if they originate
        // from a bundled dependency. Transitive dependencies of bundled dependencies
        // will not have a bundled property, and `bun install` expects them to not
        // have bundled behavior set. In order to resolve these dependencies correctly,
        // first loop through each key here and add the key to a map if it's bundled.
        // Then when parsing the dependencies, lookup the package key + dep name from
        // the bundled map, and mark the dependency bundled if it exists. This works
        // because package's direct bundled dependencies can only exist at the top
        // level of it's node_modules.
        for row in pkg_rows {
            let pkg_path = row.key.slice();

            let Some(pkg_info) = row.value.as_array() else {
                fail!(
                    InvalidPackageInfo,
                    at_value(row.key_loc),
                    b"Expected an array"
                );
            };

            // Index 2 for an npm resolution (after the registry string), index 1 otherwise.
            let Some(maybe_info_obj) = pkg_info.items().iter().find_map(|item| item.as_object())
            else {
                continue;
            };
            let Some(&JSON::E::JsonValue::Boolean(bundled)) = maybe_info_obj.get(b"bundled") else {
                continue;
            };
            if !bundled {
                continue;
            }
            bundled_pkgs.put(pkg_path, ());
        }

        'next_pkg_key: for row in pkg_rows {
            let key_loc = row.key_loc;
            let pkg_path = row.key.slice();
            let pkg_info = row.value.as_array().expect("checked above").items();

            let mut i: usize = 0;

            if pkg_info.is_empty() {
                fail!(
                    InvalidPackageInfo,
                    at_value(key_loc),
                    b"Missing package info"
                );
            }

            let res_info = &pkg_info[i];
            let res_info_idx = i;
            i += 1;

            let Some(res_info_str) = res_info.as_str() else {
                fail!(
                    InvalidPackageResolution,
                    at_item(key_loc, res_info_idx),
                    b"Expected a string"
                );
            };

            let (name_str, res_str) = 'name_and_res: {
                if strings::has_prefix(res_info_str, b"@root:") {
                    break 'name_and_res (b"" as &[u8], &res_info_str[1..]);
                }

                match dependency::split_name_and_version(res_info_str) {
                    Ok(pair) => break 'name_and_res pair,
                    Err(_) => fail!(
                        InvalidPackageResolution,
                        at_item(key_loc, res_info_idx),
                        b"Invalid package resolution"
                    ),
                }
            };

            if !name_str.is_empty() && !dependency::is_safe_install_folder_name(name_str) {
                fail!(
                    InvalidPackageResolution,
                    at_item(key_loc, res_info_idx),
                    b"invalid package name"
                );
            }

            let name_hash = StringBuilder::string_hash(name_str);
            let name = sbuf!(lockfile).append(name_str)?;

            let mut res = match Resolution::from_text_lockfile(res_str, &mut sbuf!(lockfile)) {
                Ok(r) => r,
                Err(crate::resolution::FromTextLockfileError::OutOfMemory) => {
                    return Err(ParseError::OutOfMemory);
                }
                Err(crate::resolution::FromTextLockfileError::UnexpectedResolution) => {
                    log.add_error_fmt(
                        source,
                        at_item(key_loc, res_info_idx),
                        format_args!(
                            "Unexpected resolution: {}",
                            bun_core::fmt::for_terminal(bstr::BStr::new(res_str))
                        ),
                    );
                    return Err(ParseError::UnexpectedResolution);
                }
            };

            let mut npm_url_needs_integrity = false;
            if res.tag == ResolutionTag::Npm {
                if i >= pkg_info.len() {
                    fail!(
                        InvalidPackageInfo,
                        at_value(key_loc),
                        b"Missing npm registry"
                    );
                }
                let registry_expr = &pkg_info[i];
                let registry_idx = i;
                i += 1;

                let Some(registry_str) = registry_expr.as_str() else {
                    fail!(
                        InvalidPackageInfo,
                        at_item(key_loc, registry_idx),
                        b"Expected a string"
                    );
                };

                // Use scope-specific registry if available, otherwise fall back to default
                let configured_registry = manager
                    .map_or(Npm::Registry::DEFAULT_URL.as_bytes(), |mgr| {
                        mgr.scope_for_package_name(name_str).url.href()
                    });
                if registry_str.is_empty() {
                    let url = ExtractTarball::build_url(
                        configured_registry,
                        &strings::StringOrTinyString::init(
                            name.slice(lockfile.buffers.string_bytes.as_slice()),
                        ),
                        res.npm().version,
                        lockfile.buffers.string_bytes.as_slice(),
                    )?;

                    res.npm_mut().url = sbuf!(lockfile).append(url)?;
                } else {
                    npm_url_needs_integrity =
                        !url_is_under_registry(registry_str, configured_registry)
                            && !url_is_under_registry(
                                registry_str,
                                Npm::Registry::DEFAULT_URL.as_bytes(),
                            );
                    res.npm_mut().url = sbuf!(lockfile).append(registry_str)?;
                }
            }

            if lockfile_version != Version::V0 {
                if res.tag == ResolutionTag::Workspace {
                    let entry = pkg_map.get_or_put(pkg_path)?;
                    if entry.found_existing {
                        // this workspace package is already in the package map, because
                        // it was added as a workspaceOnly package earlier
                        continue;
                    }

                    let pkgs = lockfile.packages.slice();
                    let pkg_resolutions = pkgs.items_resolution();
                    let string_buf = lockfile.buffers.string_bytes.as_slice();

                    // new entry, a matching workspace MUST exist
                    for workspace_pkg_id in
                        workspace_pkgs_off..workspace_pkgs_off + workspace_pkgs_len
                    {
                        if res.eql(
                            &pkg_resolutions[workspace_pkg_id as usize],
                            string_buf,
                            string_buf,
                        ) {
                            debug_assert!(
                                pkg_path
                                    != pkgs.items_name()[workspace_pkg_id as usize]
                                        .slice(string_buf)
                            );

                            // found the workspace this key belongs to. for example both `pkg1` and `another-pkg1` should map
                            // to the same package id:
                            //
                            // "workspaces": {
                            //   "": {},
                            //   "packages/pkg1": {
                            //     "name": "pkg1",
                            //   },
                            // },
                            // "overrides": {
                            //   "some-pkg": "workspace:packages/pkg1",
                            // },
                            // "packages": {
                            //   "pkg1": "workspace:packages/pkg1",
                            //   "another-pkg1": "workspaces:packages/pkg1",
                            // },
                            *entry.value_ptr = workspace_pkg_id;
                            continue 'next_pkg_key;
                        }
                    }

                    log.add_error_fmt(
                        source,
                        at_item(key_loc, res_info_idx),
                        format_args!(
                            "Unknown workspace: '{}'",
                            bun_core::fmt::escape_control_chars(res.workspace().slice(string_buf))
                        ),
                    );
                    return Err(ParseError::InvalidPackageInfo);
                }
            }

            let mut pkg = Package::default();

            // dependencies, os, cpu, libc
            'workspace_and_not_v0: {
                match res.tag {
                    ResolutionTag::Npm
                    | ResolutionTag::Folder
                    | ResolutionTag::Git
                    | ResolutionTag::Github
                    | ResolutionTag::LocalTarball
                    | ResolutionTag::RemoteTarball
                    | ResolutionTag::Symlink
                    | ResolutionTag::Workspace => {
                        if res.tag == ResolutionTag::Workspace && lockfile_version != Version::V0 {
                            break 'workspace_and_not_v0;
                        }

                        if i >= pkg_info.len() {
                            fail!(
                                InvalidPackageInfo,
                                at_value(key_loc),
                                b"Missing dependencies object"
                            );
                        }

                        let deps_idx = i;
                        i += 1;
                        let Some(deps_os_cpu_libc_bin_bundle_obj) = pkg_info[deps_idx].as_object()
                        else {
                            fail!(
                                InvalidPackageInfo,
                                at_item(key_loc, deps_idx),
                                b"Expected an object"
                            );
                        };
                        let deps_expr = Expr::from_json_value(&pkg_info[deps_idx], key_loc);

                        let (off, len) = parse_append_dependencies(
                            lockfile,
                            &deps_expr,
                            &mut *log,
                            source,
                            &mut optional_peers_buf,
                            &mut unresolved_rows,
                            Some((pkg_path, &bundled_pkgs)),
                            None,
                            res.tag == ResolutionTag::Workspace,
                        )?;

                        pkg.dependencies = DependencySlice::new(off, len);
                        pkg.resolutions = PackageIDSlice::new(off, len);
                        pkg.bin = parse_bin(&deps_expr, lockfile)?;

                        if res.tag != ResolutionTag::Workspace {
                            if let Some(os) = deps_os_cpu_libc_bin_bundle_obj.get(b"os") {
                                pkg.meta.os =
                                    Npm::negatable_from_json_value::<Npm::OperatingSystem>(os);
                            }
                            if let Some(arch) = deps_os_cpu_libc_bin_bundle_obj.get(b"cpu") {
                                pkg.meta.arch =
                                    Npm::negatable_from_json_value::<Npm::Architecture>(arch);
                            }
                            if let Some(libc) = deps_os_cpu_libc_bin_bundle_obj.get(b"libc") {
                                pkg.meta.libc = Npm::negatable_from_json_value::<Npm::Libc>(libc);
                            }
                            if let Some(&JSON::E::JsonValue::Boolean(has_install_script)) =
                                deps_os_cpu_libc_bin_bundle_obj.get(b"hasInstallScript")
                            {
                                pkg.meta.set_has_install_script(has_install_script);
                            }
                        }
                    }
                    ResolutionTag::Root => {
                        if i >= pkg_info.len() {
                            fail!(
                                InvalidPackageInfo,
                                at_value(key_loc),
                                b"Missing package binaries object"
                            );
                        }
                        let bin_obj_idx = i;
                        i += 1;
                        if pkg_info[bin_obj_idx].as_object().is_none() {
                            fail!(
                                InvalidPackageInfo,
                                at_item(key_loc, bin_obj_idx),
                                b"Expected an object"
                            );
                        }
                        let bin_obj = Expr::from_json_value(&pkg_info[bin_obj_idx], key_loc);
                        pkg.bin = parse_bin(&bin_obj, lockfile)?;
                    }
                    _ => {}
                }
            }

            // integrity
            match res.tag {
                ResolutionTag::Npm => {
                    if i >= pkg_info.len() {
                        fail!(InvalidPackageInfo, at_value(key_loc), b"Missing integrity");
                    }
                    let Some(integrity_str) = pkg_info[i].as_str() else {
                        fail!(
                            InvalidPackageInfo,
                            at_item(key_loc, i),
                            b"Expected a string"
                        );
                    };

                    pkg.meta.integrity =
                        parse_integrity(integrity_str, lockfile_version, log, source, key_loc, i)?;

                    // Fail closed: otherwise a tampered lockfile could redirect
                    // the tarball URL off-registry and install arbitrary content
                    // under a trusted package name with verification disabled.
                    //
                    // Only enforced for v2+. Older lockfiles predate this check
                    // and may legitimately omit integrity for an off-registry
                    // tarball; rejecting them would break existing installs.
                    if lockfile_version.at_least(Version::V2)
                        && npm_url_needs_integrity
                        && !pkg.meta.integrity.tag.is_supported()
                    {
                        fail!(
                            InvalidPackageInfo,
                            at_item(key_loc, i),
                            b"Missing integrity hash for npm package resolved to a tarball URL outside the configured registry"
                        );
                    }
                }
                tag @ (ResolutionTag::Git | ResolutionTag::Github) => {
                    // .bun-tag
                    if i >= pkg_info.len() {
                        fail!(
                            InvalidPackageInfo,
                            at_value(key_loc),
                            b"Missing git dependency tag"
                        );
                    }

                    let bun_tag_idx = i;
                    i += 1;

                    let Some(bun_tag_str) = pkg_info[bun_tag_idx].as_str() else {
                        fail!(
                            InvalidPackageInfo,
                            at_item(key_loc, bun_tag_idx),
                            b"Expected a string"
                        );
                    };

                    // Reject an unsafe `.bun-tag`. For `git`, `Repository::checkout`
                    // re-validates with the same guard before building any cache
                    // path or invoking `git`, so this parse-time check is gated to
                    // v2+ — older git lockfiles keep loading without reopening the
                    // checkout hole. For `github` there is no such re-validation
                    // (the tarball-download path feeds the tag straight into the
                    // cache folder name), so the check must stay unconditional to
                    // keep the path-traversal guard intact at every version.
                    let enforce_safe_tag =
                        tag == ResolutionTag::Github || lockfile_version.at_least(Version::V2);
                    let too_long = bun_tag_str.len() > crate::repository::MAX_RESOLVED_TAG_LEN;
                    if too_long
                        || (enforce_safe_tag
                            && !crate::repository::is_safe_resolved_tag(bun_tag_str))
                    {
                        fail!(
                            InvalidPackageInfo,
                            at_item(key_loc, bun_tag_idx),
                            b"Invalid git dependency tag"
                        );
                    }

                    let resolved = sbuf!(lockfile).append(bun_tag_str)?;
                    if tag == ResolutionTag::Git {
                        res.git_mut().resolved = resolved;
                    } else {
                        res.github_mut().resolved = resolved;
                    }
                }
                _ => {}
            }

            // Optional, because older lockfiles don't have one for tarball and git dependencies.
            if matches!(
                res.tag,
                ResolutionTag::LocalTarball
                    | ResolutionTag::RemoteTarball
                    | ResolutionTag::Git
                    | ResolutionTag::Github
            ) && let Some(integrity_str) = pkg_info.get(i).and_then(|item| item.as_str())
            {
                pkg.meta.integrity =
                    parse_integrity(integrity_str, lockfile_version, log, source, key_loc, i)?;
            }

            pkg.name = name;
            pkg.name_hash = name_hash;
            pkg.resolution = res;

            let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;

            // The root's `bin` is recorded nowhere else.
            if pkg_id == 0 && res.tag == ResolutionTag::Root {
                lockfile.packages.items_bin_mut()[0] = pkg.bin;
            }

            let entry = pkg_map.get_or_put(pkg_path)?;
            // Each workspace was registered under its name above. A root dependency of the same
            // name replaces it at that key, unless that dependency is a folder.
            if entry.found_existing
                && !(res.tag != ResolutionTag::Folder
                    && (workspace_pkgs_off..workspace_pkgs_off + workspace_pkgs_len)
                        .contains(&*entry.value_ptr)
                    && lockfile.packages.items_name()[*entry.value_ptr as usize]
                        .slice(lockfile.buffers.string_bytes.as_slice())
                        == pkg_path)
            {
                fail!(InvalidPackageKey, key_loc, b"Duplicate package path");
            }

            *entry.value_ptr = pkg_id;
        }

        lockfile.buffers.resolutions =
            vec![invalid_package_id; lockfile.buffers.dependencies.len()];

        let pkgs = lockfile.packages.slice();
        let pkg_deps = pkgs.items_dependencies();
        let pkg_names = pkgs.items_name();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_resolutions: &[Resolution] = pkgs.items_resolution();
        let members = workspace_pkgs_off..workspace_pkgs_off + workspace_pkgs_len;

        // Populated by `append_package_dedupe` while the packages object was
        // parsed above; used to bind peer edges by version rather than by
        // tree path (see `resolve_peer_dep_version_based`).
        let package_index = &lockfile.package_index;
        let overrides = &lockfile.overrides;
        let catalogs: &CatalogMap = &lockfile.catalogs;

        // Disjoint-field split of `lockfile.buffers` so each loop body can hold
        // `&dependencies[i]` and `&mut resolutions[i]` together with a shared
        // `string_bytes` view.
        let buffers = &mut lockfile.buffers;
        let string_buf: &[u8] = buffers.string_bytes.as_slice();
        let dependencies: &[Dependency] = buffers.dependencies.as_slice();
        let resolutions: &mut [PackageID] = buffers.resolutions.as_mut_slice();
        let link_workspace_packages =
            manager.is_none_or(|manager| manager.options.link_workspace_packages);
        let workspace_paths = &lockfile.workspace_paths;
        let workspace_versions = &lockfile.workspace_versions;
        // Returns the workspace that a peer's range matches. `Package::parse` turns such a peer of
        // the root or of a workspace into a workspace link, so the loader resolves it the same way.
        let linked_member = |dep: &Dependency| {
            let (range, name_hash) =
                version_based_peer_range(dep, catalogs, overrides, string_buf)?;
            super::linked_workspace_path(
                link_workspace_packages,
                workspace_paths,
                workspace_versions,
                name_hash,
                &range.try_npm()?.version,
                string_buf,
            )?;
            (members.clone()).find(|&id| pkg_name_hashes[id as usize] == name_hash)
        };
        // Hoisting binds the peers again once every other dependency is resolved.
        let peer_by_version = |dep: &Dependency| {
            resolve_peer_dep_version_based(
                dep,
                catalogs,
                package_index,
                overrides,
                pkg_resolutions,
                string_buf,
                |_| true,
            )
        };
        let own_peer = |dep: &Dependency| linked_member(dep).or_else(|| peer_by_version(dep));

        {
            // first the root dependencies are resolved
            for dep_id in pkg_deps[0].begin()..pkg_deps[0].end() {
                let dep = &dependencies[dep_id as usize];

                let named = pkg_map.get(dep.name.slice(string_buf)).copied();
                // The key with a workspace's name can belong to a root dependency of the same name.
                // The workspace is then found by name among the workspace packages.
                let bound = if dep.behavior.is_workspace()
                    && !named.is_some_and(|id| members.contains(&id))
                {
                    (members.clone())
                        .find(|&id| pkg_name_hashes[id as usize] == dep.name_hash)
                        .or(named)
                } else {
                    own_peer(dep).or(named)
                };
                let Some(res_id) = bound else {
                    if may_stay_unresolved(dep) {
                        continue;
                    }
                    return Err(dependency_resolution_failure(
                        dep,
                        None,
                        string_buf,
                        source,
                        log,
                        at_value(root_pkg_exr.loc),
                    ));
                };

                resolutions[dep_id as usize] = res_id;
            }
        }

        let mut path_buf = bun_paths::path_buffer_pool::get();

        if lockfile_version != Version::V0 {
            // then workspace dependencies are resolved
            for pkg_id in workspace_pkgs_off..workspace_pkgs_off + workspace_pkgs_len {
                let workspace_name = pkg_names[pkg_id as usize].slice(string_buf);

                // If a root dependency of the same name has this workspace's key, the workspace's
                // dependencies are printed under `./<name>`. See `Tree::is_unlinked_member`.
                let unlinked = pkg_map.get(workspace_name) != Some(&pkg_id);
                let prefix: &[u8] = if unlinked { b"./" } else { b"" };
                let name_end = prefix.len() + workspace_name.len();

                let deps = pkg_deps[pkg_id as usize];
                for dep_id in deps.begin()..deps.end() {
                    let dep = &dependencies[dep_id as usize];
                    let dep_name = dep.name.slice(string_buf);

                    let workspace_node_modules = {
                        let buf_slice = &mut path_buf[..];
                        let needed = name_end + 1 + dep_name.len();
                        if needed > buf_slice.len() {
                            log.add_error_fmt(
                                source,
                                at_value(root_pkg_exr.loc),
                                format_args!(
                                    "Workspace and dependency name too long: '{}/{}'",
                                    bstr::BStr::new(workspace_name),
                                    bstr::BStr::new(dep_name),
                                ),
                            );
                            return Err(ParseError::InvalidPackageInfo);
                        }
                        buf_slice[..prefix.len()].copy_from_slice(prefix);
                        buf_slice[prefix.len()..name_end].copy_from_slice(workspace_name);
                        buf_slice[name_end] = b'/';
                        buf_slice[name_end + 1..needed].copy_from_slice(dep_name);
                        &buf_slice[..needed]
                    };

                    let Some(res_id) = own_peer(dep).or_else(|| {
                        pkg_map
                            .get(workspace_node_modules)
                            .or_else(|| pkg_map.get(dep_name))
                            .copied()
                    }) else {
                        // A bun.lock from an older Bun only has this dependency below a `packages`
                        // row of the workspace. The loop over `pkg_rows` below resolves it.
                        if unlinked || may_stay_unresolved(dep) {
                            continue;
                        }
                        return Err(dependency_resolution_failure(
                            dep,
                            Some(workspace_name),
                            string_buf,
                            source,
                            log,
                            at_value(root_pkg_exr.loc),
                        ));
                    };

                    resolutions[dep_id as usize] = res_id;
                }
            }
        }

        // then each package dependency
        let mut bound_by: Vec<RowEvidence> = vec![RowEvidence::Unbound; dependencies.len()];
        let mut root_dep_names: HashMap<u64, ()> = HashMap::default();
        for root_dep in pkg_deps[0].get(dependencies) {
            root_dep_names.insert(root_dep.name_hash, ());
        }
        for row in pkg_rows {
            let pkg_path = row.key.slice();

            let Some(&pkg_id) = pkg_map.get(pkg_path) else {
                return Err(ParseError::InvalidPackagesObject);
            };

            let res = &pkg_resolutions[pkg_id as usize];

            if pkg_id == 0
                || (res.tag == ResolutionTag::Workspace
                    && pkg_map.get(pkg_names[pkg_id as usize].slice(string_buf)) == Some(&pkg_id))
            {
                // The dependencies of the root and of this workspace were already resolved above.
                continue;
            }

            // find resolutions. iterate up to root through the pkg path.
            let deps = pkg_deps[pkg_id as usize];
            'deps: for dep_id in deps.begin()..deps.end() {
                let dep = &dependencies[dep_id as usize];

                // A stripped `catalog:` edge (`CatalogMap::strip_reference`) stays unresolved, as in a fresh install.
                if dep.version.tag == DependencyVersionTag::Uninitialized {
                    continue 'deps;
                }

                // A registry package's peer prefers a published version in range over a workspace
                // of that name, because its dependent may use the published one.
                let by_version = if res.tag == ResolutionTag::Workspace {
                    own_peer(dep)
                } else {
                    peer_by_version(dep)
                };
                let res_id = match by_version {
                    Some(id) => id,
                    None => {
                        // Bounded so the loaded lockfile binds optional peers
                        // exactly like the hoister that re-derives them after
                        // `Package::clone` resets them.
                        match pkg_map.find_resolution(
                            pkg_path,
                            dep,
                            string_buf,
                            &mut path_buf[..],
                            dep.behavior.is_optional_peer().then_some(&bundled_pkgs),
                        ) {
                            Ok((&id, mut evidence)) => {
                                let own_entry = evidence == RowEvidence::OwnEntry;
                                if evidence == RowEvidence::WalkedToRoot
                                    && dep.behavior.is_peer()
                                    && root_dep_names.contains(&dep.name_hash)
                                {
                                    evidence = RowEvidence::RootDependency;
                                } else if dep.behavior.is_optional_peer()
                                    && !own_entry
                                    && !pkg_resolutions[id as usize].satisfies_dependency_version(
                                        catalogs.resolve_range(string_buf, dep),
                                        string_buf,
                                        string_buf,
                                    )
                                {
                                    evidence = RowEvidence::Refused;
                                }
                                if bound_by[dep_id as usize] > evidence {
                                    continue 'deps;
                                }
                                bound_by[dep_id as usize] = evidence;
                                id
                            }
                            Err(ResolveError::InvalidPackageKey) => {
                                fail!(InvalidPackageKey, row.key_loc, b"Invalid package path");
                            }
                            Err(ResolveError::Unresolvable) => {
                                if dep.behavior.is_optional_peer() {
                                    bound_by[dep_id as usize] = RowEvidence::Unprovided;
                                    resolutions[dep_id as usize] = invalid_package_id;
                                }
                                if may_stay_unresolved(dep) {
                                    continue 'deps;
                                }
                                return Err(dependency_resolution_failure(
                                    dep,
                                    Some(pkg_path),
                                    string_buf,
                                    source,
                                    log,
                                    row.key_loc,
                                ));
                            }
                        }
                    }
                };

                resolutions[dep_id as usize] = res_id;
            }
        }

        // The install that wrote bun.lock did not resolve these, so they stay unresolved even if
        // the loops above found a package of the same name.
        for &dep_id in &unresolved_rows {
            resolutions[dep_id as usize] = invalid_package_id;
        }

        lockfile.tag_workspace_links(link_workspace_packages);

        // The install reports a refused name itself, after it applies package.json.
        let mut refused_names = bun_ast::Log::init();
        if let Err(tree::SubtreeError::OutOfMemory) = lockfile.resolve(&mut refused_names) {
            return Err(ParseError::OutOfMemory);
        }
    }

    Ok(())
}

/// Resolve a peer dependency edge the way the fresh resolver's
/// deferred-peer phase does (`get_or_put_resolved_package` with
/// `install_peer`): scan the package ids recorded for the dependency's
/// name — `package_index` lists are kept ordered by descending
/// `Resolution::order` — and take the first whose resolution satisfies
/// the range. `None` if none does, and for optional and bundled peers: the path walk binds those.
///
/// Peer edges cannot be resolved from the printed tree the way regular
/// edges are: a peer never materializes its own `node_modules` path when
/// the version hoisted at an enclosing path satisfies its range, so the
/// path walk rebinds the edge to the hoisted version rather than the one
/// the fresh resolve chose. That flips `buffers.resolutions` between the
/// install that wrote the lockfile and every install that loads it, which
/// re-keys isolated-linker store entries (and global-store entry hashes)
/// on warm installs.
///
/// A peer of the root or of a workspace binds to a matching workspace without this scan. A registry
/// package's peer goes through it, and stays on the workspace if no published version is in range.
///
/// For the hoister this result is only a starting point: `tree::bind_served_peers` prefers the
/// root's or the package's own dependency of that name if it is in range.
/// `is_candidate` restricts the scan for lockfiles holding packages a reload will not see.
pub(crate) fn resolve_peer_dep_version_based(
    dep: &Dependency,
    catalogs: &CatalogMap,
    package_index: &PackageIndexMap,
    overrides: &OverrideMap,
    pkg_resolutions: &[Resolution],
    string_buf: &[u8],
    is_candidate: impl Fn(PackageID) -> bool,
) -> Option<PackageID> {
    let (range, name_hash) = version_based_peer_range(dep, catalogs, overrides, string_buf)?;
    resolve_peer_dep_by_range(
        range,
        name_hash,
        package_index,
        pkg_resolutions,
        string_buf,
        is_candidate,
    )
}

/// For each package name: the packages that have no provider for a peer dependency on that name, and
/// the required peer dependencies on it that have no provider in at least one place, one per
/// distinct range. Filled on demand.
#[derive(Default)]
pub(crate) struct PeerRangeCache(
    core::cell::RefCell<HashMap<PackageNameHash, (DynamicBitSet, Box<[DependencyID]>)>>,
);

/// Finds the version that packages with a peer dependency on the same name can share.
#[derive(Clone, Copy)]
pub(crate) struct PeerRanges<'a> {
    pub(crate) cache: &'a PeerRangeCache,
    pub(crate) lockfile: &'a BinaryLockfile,
}

impl PeerRanges<'_> {
    /// `peer` is a peer dependency of `owner`. If no package provides it, returns the highest
    /// installed version that satisfies it and every other required peer range on that name that no
    /// package provides. As in pnpm, those packages share one copy.
    pub(crate) fn shared_version(self, owner: PackageID, peer: &Dependency) -> Option<PackageID> {
        let lockfile = self.lockfile;
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_resolutions = lockfile.packages.items_resolution();
        let (range, name_hash) =
            version_based_peer_range(peer, &lockfile.catalogs, &lockfile.overrides, string_buf)?;
        let candidates = lockfile.package_index.get(&name_hash)?.as_slice();
        if candidates.len() < 2 {
            return None;
        }
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let mut cache = self.cache.0.borrow_mut();
        let (missing, rows) = cache
            .entry(name_hash)
            .or_insert_with(|| self.collect(name_hash));
        if !missing.is_set(owner as usize) {
            return None;
        }
        candidates.iter().copied().find(|&id| {
            let resolution = &pkg_resolutions[id as usize];
            resolution.satisfies_dependency_version(range, string_buf, string_buf)
                && rows.iter().all(|&row| {
                    let range =
                        (lockfile.catalogs).resolve_range(string_buf, &dependencies[row as usize]);
                    resolution.satisfies_dependency_version(range, string_buf, string_buf)
                })
        })
    }

    fn collect(self, name_hash: PackageNameHash) -> (DynamicBitSet, Box<[DependencyID]>) {
        let lockfile = self.lockfile;
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let packages = lockfile.packages.items_resolution();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let missing =
            super::reachable::packages_without_peer_provider(lockfile, resolutions, name_hash);
        let somewhere = super::reachable::packages_reached_without_peer_provider(
            lockfile,
            resolutions,
            name_hash,
        );
        let mut rows: Vec<(u64, DependencyID)> = Vec::new();
        for (owner, list) in lockfile.packages.items_dependencies().iter().enumerate() {
            if !somewhere.is_set(owner) || packages[owner].tag != ResolutionTag::Npm {
                continue;
            }
            for id in list.begin()..list.end() {
                if let Some((range, asks_for)) = version_based_peer_range(
                    &dependencies[id as usize],
                    &lockfile.catalogs,
                    &lockfile.overrides,
                    string_buf,
                ) && asks_for == name_hash
                    && range.tag == DependencyVersionTag::Npm
                {
                    rows.push((bun_wyhash::hash(range.literal.slice(string_buf)), id));
                }
            }
        }
        index_sort::sort_slice_unstable_by(&mut rows, |a, b| a.cmp(b));
        rows.dedup_by_key(|row| row.0);
        (missing, rows.into_iter().map(|row| row.1).collect())
    }
}

/// Returns the range and the name that the scan looks for, or `None` for a dependency that the path
/// walk binds.
fn version_based_peer_range<'a>(
    dep: &'a Dependency,
    catalogs: &'a CatalogMap,
    overrides: &OverrideMap,
    string_buf: &[u8],
) -> Option<(&'a DependencyVersion, PackageNameHash)> {
    if !dep.behavior.is_peer() || dep.behavior.is_optional_peer() || dep.behavior.is_bundled() {
        return None;
    }
    let range = catalogs.resolve_range(string_buf, dep);
    let name_hash = peer_candidate_name_hash(dep, range, string_buf);

    // The fresh resolver rewrites the name and range through
    // `lockfile.overrides` (and any catalog entry an override points at)
    // before its scan, so filtering candidates with the raw manifest range
    // here would pick a version the override replaced. The printed tree
    // already reflects the overridden resolution, so overridden edges keep
    // the path walk. The exemptions mirror
    // `enqueue_dependency_with_main_and_success_fn`: `npm:` aliases and
    // workspace-only edges are never overridden.
    let overridable = !dep.behavior.is_workspace()
        && (dep.version.tag != DependencyVersionTag::Npm || !dep.version.npm().is_alias);
    // Overrides are applied before catalog resolution, so a catalog peer is overridden by its own name.
    let override_name_hash = if dep.version.tag == DependencyVersionTag::Catalog {
        dep.name_hash
    } else {
        name_hash
    };
    if overridable && overrides.has_rule_for_name(override_name_hash) {
        return None;
    }
    Some((range, name_hash))
}

/// `package_index` is keyed by real package names. For an alias, `range` has the real name.
pub(crate) fn peer_candidate_name_hash(
    dep: &Dependency,
    range: &DependencyVersion,
    string_buf: &[u8],
) -> PackageNameHash {
    let name = match range.tag {
        DependencyVersionTag::Npm => range.npm().name,
        DependencyVersionTag::DistTag => range.dist_tag().name,
        DependencyVersionTag::Git => range.git().package_name,
        DependencyVersionTag::Github => range.github().package_name,
        DependencyVersionTag::Tarball => range.tarball().package_name,
        _ => return dep.name_hash,
    };
    StringBuilder::string_hash(name.slice(string_buf))
}

/// The scan itself. The yarn.lock migration also uses it to bind `*` and overridden peers.
pub(crate) fn resolve_peer_dep_by_range(
    range: &DependencyVersion,
    name_hash: PackageNameHash,
    package_index: &PackageIndexMap,
    pkg_resolutions: &[Resolution],
    string_buf: &[u8],
    is_candidate: impl Fn(PackageID) -> bool,
) -> Option<PackageID> {
    let candidates = package_index.get(&name_hash)?.as_slice();
    candidates.iter().copied().find(|&id| {
        pkg_resolutions
            .get(id as usize)
            .is_some_and(|res| res.satisfies_dependency_version(range, string_buf, string_buf))
            && is_candidate(id)
    })
}

/// Call after hoisting. Binds the peers whose target isn't in any tree the way a reload would.
pub(crate) fn rebind_peers_to_printed_packages(
    lockfile: &mut BinaryLockfile,
) -> Result<(), bun_alloc::AllocError> {
    let pkg_resolutions: &[Resolution] = lockfile.packages.items_resolution();
    let package_index = &lockfile.package_index;
    let catalogs = &lockfile.catalogs;
    let overrides = &lockfile.overrides;
    let super::Buffers {
        hoisted_dependencies,
        resolutions,
        dependencies,
        string_bytes,
        ..
    } = &mut lockfile.buffers;
    let string_buf: &[u8] = string_bytes.as_slice();

    // Root and workspaces are printed from the `workspaces` section, everything else from the tree.
    let mut printed = DynamicBitSet::init_empty(pkg_resolutions.len())?;
    for (pkg_id, res) in pkg_resolutions.iter().enumerate() {
        if matches!(res.tag, ResolutionTag::Root | ResolutionTag::Workspace) {
            printed.set(pkg_id);
        }
    }
    for &dep_id in hoisted_dependencies.iter() {
        let pkg_id = resolutions[dep_id as usize];
        if (pkg_id as usize) < pkg_resolutions.len() {
            printed.set(pkg_id as usize);
        }
    }

    for (dep, target) in dependencies.iter().zip(resolutions.iter_mut()) {
        if (*target as usize) >= pkg_resolutions.len()
            || printed.is_set(*target as usize)
            || !dep.behavior.is_peer()
        {
            continue;
        }
        if let Some(printed_target) = resolve_peer_dep_version_based(
            dep,
            catalogs,
            package_index,
            overrides,
            pkg_resolutions,
            string_buf,
            |id| printed.is_set(id as usize),
        ) {
            *target = printed_target;
        }
    }

    Ok(())
}

/// Edges a fresh install may itself leave unresolved, so bun.lock lists them without a package.
pub(crate) fn may_stay_unresolved(dep: &Dependency) -> bool {
    dep.behavior.intersects(Behavior::OPTIONAL | Behavior::PEER)
}

fn dependency_resolution_failure(
    dep: &Dependency,
    pkg_path: Option<&[u8]>,
    buf: &[u8],
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    loc: bun_ast::Loc,
) -> ParseError {
    let behavior_str = if dep.behavior.contains(Behavior::DEV) {
        "dev"
    } else if dep.behavior.contains(Behavior::OPTIONAL) {
        "optional"
    } else if dep.behavior.contains(Behavior::PEER) {
        "peer"
    } else if dep.behavior.contains(Behavior::WORKSPACE) {
        "workspace"
    } else {
        "prod"
    };

    if let Some(path) = pkg_path {
        log.add_error_fmt(
            source,
            loc,
            format_args!(
                "Failed to resolve {} dependency '{}' for package '{}'",
                behavior_str,
                bun_core::fmt::escape_control_chars(dep.name.slice(buf)),
                bun_core::fmt::escape_control_chars(path),
            ),
        );
    } else {
        log.add_error_fmt(
            source,
            loc,
            format_args!(
                "Failed to resolve root {} dependency '{}'",
                behavior_str,
                bun_core::fmt::escape_control_chars(dep.name.slice(buf)),
            ),
        );
    }
    ParseError::InvalidPackageInfo
}

fn parse_append_dependencies(
    lockfile: &mut BinaryLockfile,
    obj: &Expr,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    optional_peers_buf: &mut HashMap<u64, ()>,
    // Receives the optional dependencies that `obj` lists as "unresolved".
    unresolved_rows: &mut Vec<DependencyID>,
    // For an entry of `packages`: its path, and the paths that are marked bundled.
    bundled: Option<(&[u8], &PkgPathSet)>,
    // Only for the root: the workspaces, each of which is added as a workspace dependency.
    member_rows: Option<&[&JSON::E::PropertyJSON]>,
    catalogs_apply: bool,
) -> Result<(u32, u32), ParseError> {
    let at_value = |key_loc| value_loc_of(source, key_loc);
    macro_rules! fail {
        ($error:ident, $loc:expr, $message:literal) => {{
            log.add_error(Some(source), $loc, $message);
            return Err(ParseError::$error);
        }};
    }

    optional_peers_buf.clear();
    let mut unresolved_names: Vec<PackageNameHash> = Vec::new();

    for (key, is_optional_peers) in [(&b"optionalPeers"[..], true), (&b"unresolved"[..], false)] {
        let Some(names) = obj.get(key) else {
            continue;
        };
        if !names.is_array() {
            fail!(
                InvalidPackageInfo,
                at_value(names.loc),
                b"Expected an array"
            );
        }

        for (i, item) in array_items(&names).iter().enumerate() {
            let Some(name_str) = item.as_str() else {
                fail!(
                    InvalidPackageInfo,
                    item_loc(source, names.loc, i),
                    b"Expected a string"
                );
            };

            let name_hash = StringBuilder::string_hash(name_str);
            if is_optional_peers {
                optional_peers_buf.insert(name_hash, ());
            } else {
                unresolved_names.push(name_hash);
            }
        }
    }

    let mut path_buf = bundled.map(|_| bun_paths::path_buffer_pool::get());

    let off = lockfile.buffers.dependencies.len();
    for &(group_name, group_behavior) in WORKSPACE_DEPENDENCY_GROUPS.iter() {
        if let Some(deps) = obj.get(group_name.as_bytes()) {
            if !deps.is_object() {
                fail!(
                    InvalidPackagesTree,
                    at_value(deps.loc),
                    b"Expected an object"
                );
            }

            for row in object_rows(&deps) {
                let name_str = row.key.slice();

                let name_hash = StringBuilder::string_hash(name_str);
                let name = sbuf!(lockfile).append_external_with_hash(name_str, name_hash)?;

                let Some(version_str) = row.value.as_str() else {
                    fail!(
                        InvalidDependencyVersion,
                        at_value(row.key_loc),
                        b"Expected a string"
                    );
                };

                let version = sbuf!(lockfile).append(version_str)?;
                let version_sliced = version.sliced(lockfile.buffers.string_bytes.as_slice());

                let mut dep = Dependency {
                    name: name.value,
                    name_hash: name.hash,
                    behavior: if group_behavior.contains(Behavior::PEER)
                        && optional_peers_buf.contains_key(&name.hash)
                    {
                        group_behavior.add(Behavior::OPTIONAL)
                    } else {
                        group_behavior
                    },
                    version: match dependency::parse(
                        name.value,
                        name.hash,
                        version_sliced.slice,
                        &version_sliced,
                        &mut *log,
                        None,
                    ) {
                        Some(v) => v,
                        None => fail!(
                            InvalidDependencyVersion,
                            at_value(row.key_loc),
                            b"Invalid dependency version"
                        ),
                    },
                    ..Default::default()
                };
                if !catalogs_apply {
                    CatalogMap::strip_reference(&mut dep);
                }

                if let (Some((pkg_path, bundled_pkgs)), Some(path_buf)) = (bundled, &mut path_buf) {
                    let path_buf = &mut path_buf[..];
                    let bundled_location_len = pkg_path
                        .len()
                        .saturating_add(1)
                        .saturating_add(name_str.len());
                    if bundled_location_len > path_buf.len() {
                        fail!(
                            InvalidPackageKey,
                            row.key_loc,
                            b"Package path and dependency name too long"
                        );
                    }
                    path_buf[0..pkg_path.len()].copy_from_slice(pkg_path);
                    let remain = &mut path_buf[pkg_path.len()..];
                    remain[0] = b'/';
                    let remain = &mut remain[1..];
                    remain[0..name_str.len()].copy_from_slice(name_str);
                    let bundled_location = &path_buf[0..bundled_location_len];
                    if bundled_pkgs.contains(bundled_location) {
                        dep.behavior.insert(Behavior::BUNDLED);
                    }
                }

                lockfile.buffers.dependencies.push(dep);
            }
        }
    }

    if let Some(member_rows) = member_rows {
        for row in member_rows {
            let value = Expr::from_json_value(&row.value, row.key_loc);

            let name_expr = value.get(b"name").unwrap();
            let name = name_expr
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            let name_hash = StringBuilder::string_hash(name);

            let dep = Dependency {
                name: sbuf!(lockfile).append_with_hash(name, name_hash)?,
                name_hash,
                behavior: Behavior::WORKSPACE,
                version: DependencyVersion {
                    tag: DependencyVersionTag::Workspace,
                    value: DependencyVersionValue {
                        workspace: sbuf!(lockfile).append(row.key.slice())?,
                    },
                    literal: String::default(),
                },
            };

            // `resolutions` is sized and filled with invalid_package_id once every package is in.
            lockfile.buffers.dependencies.push(dep);
        }
    }

    let end = lockfile.buffers.dependencies.len();

    {
        let bytes = lockfile.buffers.string_bytes.as_slice();
        // `Dependency::cmp` is the total-order form of `isLessThan` (behavior group, then name ASC).
        index_sort::sort_slice_by(&mut lockfile.buffers.dependencies[off..], |a, b| {
            Dependency::cmp(bytes, a, b)
        });
    }

    // This has to come after the sort, because the sort decides each dependency's id.
    if !unresolved_names.is_empty() {
        unresolved_rows.extend((off..end).filter_map(|id| {
            let dep = &lockfile.buffers.dependencies[id];
            (dep.behavior.is_optional() && unresolved_names.contains(&dep.name_hash))
                .then_some(id as DependencyID)
        }));
    }

    Ok((
        u32::try_from(off).expect("int cast"),
        u32::try_from(end - off).expect("int cast"),
    ))
}
