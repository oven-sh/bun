//! Port of `src/install/lockfile/bun.lock.zig` — text lockfile (bun.lock) stringifier and parser.

use bun_collections::VecExt;
use core::fmt::Write as _;

use crate::bun_json as JSON;
use bun_ast::{Expr, expr::Data as ExprData};
use bun_collections::{ArrayHashMap, HashMap, StringHashMap};
use bun_core::strings;
use bun_core::{self, OOM};
use bun_paths::PathBuffer;
use bun_semver::semver_string::{
    Buf as StringBuf, Builder as StringBuilder, JsonFormatterOptions as JsonOpts,
};
use bun_semver::{self as Semver, ExternalString, String};

use crate::{
    self as Install, DependencyID, Npm, Origin, PackageID, PackageManager, PackageNameHash,
    Repository, Resolution, TruncatedPackageNameHash,
    bin::{Bin, Tag as BinTag},
    dependency,
    dependency::{
        Behavior, Dependency, Value as DependencyVersionValue, Version as DependencyVersion,
    },
    invalid_package_id,
    resolution::{Tag as ResolutionTag, Value as ResolutionValue},
};
// Canonical `Dependency.Version.Tag` — `crate::dependency::Tag` is a Phase-A
// duplicate enum (different nominal type) that does not unify with the
// `bun_install_types::DependencyVersion::tag` field; use the install_types one
// so assignments at the two `.tag = Workspace` sites type-check.
use crate::bin_real::ToJsonStyle;
use crate::config_version::ConfigVersion;
use crate::dependency::DependencyExt as _;
use crate::extract_tarball as ExtractTarball;
use crate::integrity::Integrity;
use crate::npm::Negatable;
use crate::package_manager_real::Options as PackageManagerOptions;
use crate::repository::RepositoryExt as _;
use bun_install_types::DependencyVersionTag;
// PORT NOTE: this file is `crate::lockfile_real::bun_lock`; `super` is the
// real `Lockfile` module, distinct from the `crate::lockfile` stub.
use super::PackageIDSlice;
use super::package::{Meta, PackageColumns as _};
use super::{
    DependencySlice, LoadResult, Lockfile as BinaryLockfile, Package, PatchedDep,
    TrustedDependenciesSet, VersionHashMap, tree,
};

use bun_io::AsFmt;

/// `Bin::to_json` indent callback typed against `AsFmt` (Zig passed
/// `Stringifier.writeIndent` directly; here the writer types differ).
fn write_indent_fmt(w: &mut AsFmt<'_>, indent: &mut u32) -> core::fmt::Result {
    for _ in 0..*indent {
        w.write_str("  ")?;
    }
    Ok(())
}

/// Zig `String.arrayHashContext(lockfile, null)` — both arg and existing keys
/// resolve against the lockfile's string buffer.
#[inline]
fn string_array_hash_context(buf: &[u8]) -> bun_semver::string::ArrayHashContext<'_> {
    bun_semver::string::ArrayHashContext {
        arg_buf: buf,
        existing_buf: buf,
    }
}

// PORT NOTE: reshaped for borrowck. Zig keeps a single `var string_buf =
// lockfile.stringBuf()` for the whole parser, but in Rust that locks out every
// other `lockfile.*` access (the `string_buf()` method borrows the whole
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

// TODO(port): narrow to a concrete byte-writer trait once bun_io stabilizes.
// PERF(port): anytype → dyn dispatch — profile in Phase B (Zig used `writer: anytype`;
// PORTING.md prefers `impl Trait`, but the trait shape is unsettled so dyn for now).
type Writer = dyn bun_io::Write;
// `bun_io::Write` returns `core::result::Result<_, bun_core::Error>` (see
// `bun_io::write::Result`), so the writer error is just the global `bun_core::Error`.
type WriteError = bun_core::Error;

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Version {
    V0 = 0,

    /// fixed unnecessary listing of workspace dependencies
    V1 = 1,
}

impl Version {
    pub const CURRENT: Version = Version::V1;

    #[inline]
    pub const fn current() -> Version {
        Version::CURRENT
    }

    pub const fn from_int(n: u32) -> Option<Version> {
        match n {
            0 => Some(Version::V0),
            1 => Some(Version::V1),
            _ => None,
        }
    }
}

/// For sorting dependencies belonging to a node_modules folder. No duplicate names, so
/// only string compare
struct TreeDepsSortCtx<'a> {
    string_buf: &'a [u8],
    deps_buf: &'a [Dependency],
}

impl<'a> TreeDepsSortCtx<'a> {
    pub fn is_less_than(&self, lhs: DependencyID, rhs: DependencyID) -> bool {
        let l = &self.deps_buf[lhs as usize];
        let r = &self.deps_buf[rhs as usize];
        strings::cmp_strings_asc(
            &(),
            l.name.slice(self.string_buf),
            r.name.slice(self.string_buf),
        )
    }
}

pub struct Stringifier;

impl Stringifier {
    const INDENT_SCALAR: usize = 2;

    // pub fn save(this: &Lockfile) {
    //     let _ = this;
    // }

    pub fn save_from_binary(
        lockfile: &mut BinaryLockfile,
        load_result: &LoadResult,
        options: &PackageManagerOptions,
        writer: &mut Writer,
    ) -> Result<(), WriteError> {
        // bun.handleOom → drop wrapper; allocation aborts on OOM in Rust.
        Self::save_from_binary_inner(lockfile, load_result, options, writer)
    }

    pub fn save_from_binary_inner(
        lockfile: &mut BinaryLockfile,
        load_result: &LoadResult,
        options: &PackageManagerOptions,
        writer: &mut Writer,
    ) -> Result<(), WriteError> {
        // TODO(port): narrow error set
        let buf = lockfile.buffers.string_bytes.as_slice();
        let extern_strings = lockfile.buffers.extern_strings.as_slice();
        let deps_buf = lockfile.buffers.dependencies.as_slice();
        let resolution_buf = lockfile.buffers.resolutions.as_slice();
        let pkgs = lockfile.packages.slice();
        // PORT NOTE: Zig `pkgs.items(.field)` → derive(MultiArrayElement)-generated
        // `items_<field>()` column accessors on `Slice<Package>`.
        let pkg_dep_lists: &[DependencySlice] = pkgs.items_dependencies();
        let pkg_resolutions: &[Resolution] = pkgs.items_resolution();
        let pkg_names: &[String] = pkgs.items_name();
        let pkg_name_hashes: &[PackageNameHash] = pkgs.items_name_hash();
        let pkg_metas: &[Meta] = pkgs.items_meta();
        let pkg_bins = pkgs.items_bin();

        let mut temp_buf: Vec<u8> = Vec::new();

        let mut found_trusted_dependencies: HashMap<u64, String> = HashMap::default();
        if let Some(trusted_dependencies) = &lockfile.trusted_dependencies {
            found_trusted_dependencies.reserve(trusted_dependencies.count() as usize);
        }

        let mut found_patched_dependencies: HashMap<u64, (Box<[u8]>, String)> = HashMap::default();
        found_patched_dependencies.reserve(lockfile.patched_dependencies.count() as usize);

        let mut optional_peers_buf: Vec<String> = Vec::new();

        let mut pkg_map: PkgMap<()> = PkgMap::init();

        // PORT NOTE: `from_slices` (vs `init(lockfile)`) is used so the iterator
        // borrows only `buffers.{trees,hoisted_dependencies,dependencies,string_bytes}`;
        // `overrides`/`catalogs` are mutated below while the iterator is still live.
        let mut pkgs_iter = tree::Iterator::<'_, { tree::IteratorPathStyle::PkgPath }>::from_slices(
            lockfile.buffers.trees.as_slice(),
            lockfile.buffers.hoisted_dependencies.as_slice(),
            deps_buf,
            buf,
        );

        let mut path_buf = PathBuffer::uninit();

        // if we loaded from a binary lockfile and we're migrating it to a text lockfile, ensure
        // peer dependencies have resolutions, and mark them optional if they don't
        if load_result.loaded_from_binary_lockfile() {
            while let Some(node) = pkgs_iter.next(None) {
                for &dep_id in node.dependencies {
                    let dep = &deps_buf[dep_id as usize];

                    // clobber, there isn't data
                    let mut key: Vec<u8> = Vec::new();
                    {
                        use std::io::Write;
                        write!(
                            &mut key,
                            "{}{}{}",
                            bstr::BStr::new(node.relative_path),
                            if node.depth == 0 { "" } else { "/" },
                            bstr::BStr::new(dep.name.slice(buf)),
                        )
                        .ok();
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
            write!(
                writer,
                "\"lockfileVersion\": {},\n",
                Version::CURRENT as u32
            )?;
            Self::write_indent(writer, indent)?;

            let config_version: ConfigVersion =
                options.config_version.unwrap_or(ConfigVersion::CURRENT);
            write!(writer, "\"configVersion\": {},\n", config_version as u32)?;
            Self::write_indent(writer, indent)?;

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
                    &lockfile.workspace_versions,
                    &mut optional_peers_buf,
                    &pkg_map,
                    b"",
                    &mut path_buf,
                )?;

                let mut workspace_sort_buf: Vec<PackageID> = Vec::new();

                for _pkg_id in 0..pkgs.len() {
                    let pkg_id: PackageID = u32::try_from(_pkg_id).expect("int cast");
                    let res = &pkg_resolutions[pkg_id as usize];
                    if res.tag != ResolutionTag::Workspace {
                        continue;
                    }
                    workspace_sort_buf.push(pkg_id);
                }

                // local Sorter struct → closure
                workspace_sort_buf.sort_by(|&l, &r| {
                    let l_res = &pkg_resolutions[l as usize];
                    let r_res = &pkg_resolutions[r as usize];
                    l_res.workspace().order(r_res.workspace(), buf, buf)
                });
                // PERF(port): std.sort.pdq — Rust sort_by is also pattern-defeating quicksort

                for &workspace_pkg_id in &workspace_sort_buf {
                    let res = &pkg_resolutions[workspace_pkg_id as usize];
                    writer.write_all(b"\n")?;
                    Self::write_indent(writer, indent)?;
                    Self::write_workspace_deps(
                        writer,
                        indent,
                        u32::try_from(workspace_pkg_id).expect("int cast"),
                        // SAFETY: `workspace_sort_buf` only contains pkgs whose
                        // resolution `tag == Workspace`.
                        *res.workspace(),
                        pkg_names,
                        pkg_name_hashes,
                        pkg_bins,
                        pkg_dep_lists,
                        buf,
                        extern_strings,
                        deps_buf,
                        &lockfile.workspace_versions,
                        &mut optional_peers_buf,
                        &pkg_map,
                        pkg_names[workspace_pkg_id as usize].slice(buf),
                        &mut path_buf,
                    )?;
                }
            }
            writer.write_byte(b'\n')?;
            Self::dec_indent(writer, indent)?;
            writer.write_all(b"},\n")?;

            type TreeSortItem = (Box<[DependencyID]>, Box<[u8]>, usize);

            fn tree_sort_is_less_than(l: &TreeSortItem, r: &TreeSortItem) -> core::cmp::Ordering {
                let (_, l_rel_path, l_depth) = l;
                let (_, r_rel_path, r_depth) = r;
                match l_depth.cmp(r_depth) {
                    core::cmp::Ordering::Less => core::cmp::Ordering::Less,
                    core::cmp::Ordering::Greater => core::cmp::Ordering::Greater,
                    core::cmp::Ordering::Equal => strings::order(l_rel_path, r_rel_path),
                }
            }

            let mut tree_sort_buf: Vec<TreeSortItem> = Vec::new();

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
                        write!(&mut temp_buf, "{}@", bstr::BStr::new(pkg_name.slice(buf))).ok();
                        match res.tag {
                            ResolutionTag::Workspace => {
                                if let Some(workspace_version) =
                                    lockfile.workspace_versions.get(&pkg_name_hash)
                                {
                                    write!(&mut temp_buf, "{}", workspace_version.fmt(buf)).ok();
                                }
                            }
                            _ => {
                                write!(
                                    &mut temp_buf,
                                    "{}",
                                    res.fmt(buf, bun_core::fmt::PathSep::Posix)
                                )
                                .ok();
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
                        if trusted_dependencies
                            .contains(&(dep.name_hash as TruncatedPackageNameHash))
                        {
                            found_trusted_dependencies.insert(dep.name_hash, dep.name);
                        }
                    }
                }
            }

            pkgs_iter.reset();

            tree_sort_buf.sort_by(tree_sort_is_less_than);
            // PERF(port): std.sort.pdq

            if found_trusted_dependencies.len() > 0 {
                Self::write_indent(writer, indent)?;
                writer.write_all(b"\"trustedDependencies\": [\n")?;
                *indent += 1;
                for dep_name in found_trusted_dependencies.values() {
                    Self::write_indent(writer, indent)?;
                    write!(writer, "\"{}\",\n", bstr::BStr::new(dep_name.slice(buf)))?;
                }

                Self::dec_indent(writer, indent)?;
                writer.write_all(b"],\n")?;
            }

            if found_patched_dependencies.len() > 0 {
                Self::write_indent(writer, indent)?;
                writer.write_all(b"\"patchedDependencies\": {\n")?;
                *indent += 1;
                for value in found_patched_dependencies.values() {
                    let (name_and_version, patch_path) = value;
                    Self::write_indent(writer, indent)?;
                    write!(
                        writer,
                        "{}: {},\n",
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

            if lockfile.overrides.map.count() > 0 {
                lockfile
                    .overrides
                    .sort(lockfile.buffers.string_bytes.as_slice());

                Self::write_indent(writer, indent)?;
                writer.write_all(b"\"overrides\": {\n")?;
                *indent += 1;
                for override_dep in lockfile.overrides.map.values() {
                    Self::write_indent(writer, indent)?;
                    write!(
                        writer,
                        "{}: {},\n",
                        override_dep.name.fmt_json(buf, Default::default()),
                        override_dep
                            .version
                            .literal
                            .fmt_json(buf, Default::default()),
                    )?;
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
                Self::write_indent(writer, indent)?;
                writer.write_all(b"\"catalog\": {\n")?;
                *indent += 1;
                for catalog_dep in lockfile.catalogs.default.values() {
                    Self::write_indent(writer, indent)?;
                    write!(
                        writer,
                        "{}: {},\n",
                        catalog_dep.name.fmt_json(buf, Default::default()),
                        catalog_dep
                            .version
                            .literal
                            .fmt_json(buf, Default::default()),
                    )?;
                }

                Self::dec_indent(writer, indent)?;
                writer.write_all(b"},\n")?;
            }

            if lockfile.catalogs.groups.count() > 0 {
                Self::write_indent(writer, indent)?;
                writer.write_all(b"\"catalogs\": {\n")?;
                *indent += 1;

                let mut iter = lockfile.catalogs.groups.iter();
                while let Some((catalog_name, catalog_deps)) = iter.next() {
                    Self::write_indent(writer, indent)?;
                    write!(
                        writer,
                        "{}: {{\n",
                        catalog_name.fmt_json(buf, Default::default())
                    )?;
                    *indent += 1;

                    for catalog_dep in catalog_deps.values() {
                        Self::write_indent(writer, indent)?;
                        write!(
                            writer,
                            "{}: {},\n",
                            catalog_dep.name.fmt_json(buf, Default::default()),
                            catalog_dep
                                .version
                                .literal
                                .fmt_json(buf, Default::default()),
                        )?;
                    }

                    Self::dec_indent(writer, indent)?;
                    writer.write_all(b"},\n")?;
                }

                Self::dec_indent(writer, indent)?;
                writer.write_all(b"},\n")?;
            }

            let mut tree_deps_sort_buf: Vec<DependencyID> = Vec::new();
            let mut pkg_deps_sort_buf: Vec<DependencyID> = Vec::new();

            Self::write_indent(writer, indent)?;
            writer.write_all(b"\"packages\": {")?;
            let mut first = true;
            for item in &tree_sort_buf {
                let (dependencies, relative_path, depth) = item;
                tree_deps_sort_buf.clear();
                tree_deps_sort_buf.extend_from_slice(dependencies);

                {
                    let ctx = TreeDepsSortCtx {
                        string_buf: buf,
                        deps_buf,
                    };
                    tree_deps_sort_buf.sort_by(|&a, &b| {
                        if ctx.is_less_than(a, b) {
                            core::cmp::Ordering::Less
                        } else if ctx.is_less_than(b, a) {
                            core::cmp::Ordering::Greater
                        } else {
                            core::cmp::Ordering::Equal
                        }
                    });
                    // PERF(port): std.sort.pdq with isLessThan
                }

                for &dep_id in &tree_deps_sort_buf {
                    let pkg_id = resolution_buf[dep_id as usize];
                    if pkg_id == invalid_package_id {
                        continue;
                    }

                    let res = &pkg_resolutions[pkg_id as usize];
                    match res.tag {
                        ResolutionTag::Root
                        | ResolutionTag::Npm
                        | ResolutionTag::Folder
                        | ResolutionTag::LocalTarball
                        | ResolutionTag::Github
                        | ResolutionTag::Git
                        | ResolutionTag::Symlink
                        | ResolutionTag::Workspace
                        | ResolutionTag::RemoteTarball => {}
                        ResolutionTag::Uninitialized => continue,
                        // should not be possible, just being safe
                        ResolutionTag::SingleFileModule => continue,
                        _ => continue,
                    }

                    if first {
                        first = false;
                        writer.write_byte(b'\n')?;
                        Self::inc_indent(writer, indent)?;
                    } else {
                        writer.write_all(b",\n\n")?;
                        Self::write_indent(writer, indent)?;
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
                    pkg_deps_sort_buf.reserve(pkg_deps_list.len as usize);
                    for pkg_dep_id in pkg_deps_list.begin()..pkg_deps_list.end() {
                        pkg_deps_sort_buf.push(u32::try_from(pkg_dep_id).expect("int cast"));
                        // PERF(port): was assume_capacity
                    }

                    // there might be duplicate names due to dependency behaviors,
                    // but we print behaviors in different groups so it won't affect
                    // the result
                    {
                        let ctx = TreeDepsSortCtx {
                            string_buf: buf,
                            deps_buf,
                        };
                        pkg_deps_sort_buf.sort_by(|&a, &b| {
                            if ctx.is_less_than(a, b) {
                                core::cmp::Ordering::Less
                            } else if ctx.is_less_than(b, a) {
                                core::cmp::Ordering::Greater
                            } else {
                                core::cmp::Ordering::Equal
                            }
                        });
                    }

                    // INFO = { prod/dev/optional/peer dependencies, os, cpu, libc (TODO), bin, binDir }

                    // first index is resolution for each type of package
                    // npm         -> [ "name@version", registry (TODO: remove if default), INFO, integrity]
                    // symlink     -> [ "name@link:path", INFO ]
                    // folder      -> [ "name@file:path", INFO ]
                    // workspace   -> [ "name@workspace:path" ] // workspace is only path
                    // tarball     -> [ "name@tarball", INFO ]
                    // root        -> [ "name@root:", { bin, binDir } ]
                    // git         -> [ "name@git+repo", INFO, .bun-tag string (TODO: remove this) ]
                    // github      -> [ "name@github:user/repo", INFO, .bun-tag string (TODO: remove this) ]

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
                        ResolutionTag::Folder => {
                            write!(
                                writer,
                                "[\"{}@file:{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                res.folder().fmt_json(buf, JsonOpts { quote: false }),
                            )?;

                            Self::write_package_info_object(
                                writer,
                                dep.behavior,
                                deps_buf,
                                &pkg_deps_sort_buf,
                                pkg_meta,
                                pkg_bin,
                                buf,
                                &mut optional_peers_buf,
                                extern_strings,
                                &pkg_map,
                                relative_path,
                                &mut path_buf,
                            )?;

                            writer.write_byte(b']')?;
                        }
                        ResolutionTag::LocalTarball => {
                            write!(
                                writer,
                                "[\"{}@{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                res.local_tarball().fmt_json(buf, JsonOpts { quote: false }),
                            )?;

                            Self::write_package_info_object(
                                writer,
                                dep.behavior,
                                deps_buf,
                                &pkg_deps_sort_buf,
                                pkg_meta,
                                pkg_bin,
                                buf,
                                &mut optional_peers_buf,
                                extern_strings,
                                &pkg_map,
                                relative_path,
                                &mut path_buf,
                            )?;

                            if pkg_meta.integrity.tag.is_supported() {
                                write!(writer, ", \"{}\"]", pkg_meta.integrity)?;
                            } else {
                                writer.write_byte(b']')?;
                            }
                        }
                        ResolutionTag::RemoteTarball => {
                            write!(
                                writer,
                                "[\"{}@{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                res.remote_tarball()
                                    .fmt_json(buf, JsonOpts { quote: false }),
                            )?;

                            Self::write_package_info_object(
                                writer,
                                dep.behavior,
                                deps_buf,
                                &pkg_deps_sort_buf,
                                pkg_meta,
                                pkg_bin,
                                buf,
                                &mut optional_peers_buf,
                                extern_strings,
                                &pkg_map,
                                relative_path,
                                &mut path_buf,
                            )?;

                            if pkg_meta.integrity.tag.is_supported() {
                                write!(writer, ", \"{}\"]", pkg_meta.integrity)?;
                            } else {
                                writer.write_byte(b']')?;
                            }
                        }
                        ResolutionTag::Symlink => {
                            write!(
                                writer,
                                "[\"{}@link:{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                res.symlink().fmt_json(buf, JsonOpts { quote: false }),
                            )?;

                            Self::write_package_info_object(
                                writer,
                                dep.behavior,
                                deps_buf,
                                &pkg_deps_sort_buf,
                                pkg_meta,
                                pkg_bin,
                                buf,
                                &mut optional_peers_buf,
                                extern_strings,
                                &pkg_map,
                                relative_path,
                                &mut path_buf,
                            )?;

                            writer.write_byte(b']')?;
                        }
                        ResolutionTag::Npm => {
                            write!(
                                writer,
                                "[\"{}@{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                res.npm().version.fmt(buf),
                            )?;

                            // only write the registry if it's not the default. empty string means default registry
                            // SAFETY: `tag == Npm` in this match arm.
                            // `String::slice` ties the return to `&self` as well as `buf`, so
                            // bind the union read to a local instead of slicing a temporary.
                            let url = res.npm().url;
                            let url_slice = url.slice(buf);
                            write!(
                                writer,
                                "\"{}\", ",
                                bstr::BStr::new(
                                    if strings::has_prefix(
                                        url_slice,
                                        strings::without_trailing_slash(
                                            Npm::Registry::DEFAULT_URL.as_bytes()
                                        ),
                                    ) {
                                        b"" as &[u8]
                                    } else {
                                        url_slice
                                    }
                                ),
                            )?;

                            Self::write_package_info_object(
                                writer,
                                dep.behavior,
                                deps_buf,
                                &pkg_deps_sort_buf,
                                pkg_meta,
                                pkg_bin,
                                buf,
                                &mut optional_peers_buf,
                                extern_strings,
                                &pkg_map,
                                relative_path,
                                &mut path_buf,
                            )?;

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
                            write!(
                                writer,
                                "[\"{}@{}\", ",
                                pkg_name.fmt_json(buf, JsonOpts { quote: false }),
                                repo.fmt(prefix, buf),
                            )?;

                            Self::write_package_info_object(
                                writer,
                                dep.behavior,
                                deps_buf,
                                &pkg_deps_sort_buf,
                                pkg_meta,
                                pkg_bin,
                                buf,
                                &mut optional_peers_buf,
                                extern_strings,
                                &pkg_map,
                                relative_path,
                                &mut path_buf,
                            )?;

                            if pkg_meta.integrity.tag.is_supported() {
                                write!(
                                    writer,
                                    ", {}, \"{}\"]",
                                    repo.resolved.fmt_json(buf, Default::default()),
                                    pkg_meta.integrity,
                                )?;
                            } else {
                                write!(
                                    writer,
                                    ", {}]",
                                    repo.resolved.fmt_json(buf, Default::default()),
                                )?;
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

    /// Writes a single line object. Contains dependencies, os, cpu, libc (soon), and bin
    /// { "devDependencies": { "one": "1.1.1", "two": "2.2.2" }, "os": "none" }
    fn write_package_info_object(
        writer: &mut Writer,
        dep_behavior: Behavior,
        deps_buf: &[Dependency],
        pkg_dep_ids: &[DependencyID],
        meta: &Meta,
        bin: &Bin,
        buf: &[u8],
        optional_peers_buf: &mut Vec<String>,
        extern_strings: &[ExternalString],
        pkg_map: &PkgMap<()>,
        relative_path: &[u8],
        path_buf: &mut [u8],
    ) -> Result<(), WriteError> {
        // TODO(port): narrow error set to { OutOfMemory, WriteFailed }
        // PORT NOTE: Zig `defer optional_peers_buf.clearRetainingCapacity()` moved to fn tail.
        // Error path (`?` on writer) aborts the whole save in the caller, so skipping the
        // clear on early-return cannot leak stale entries into a subsequent call.

        writer.write_byte(b'{')?;

        let mut any = false;
        for &(group_name, group_behavior) in WORKSPACE_DEPENDENCY_GROUPS.iter() {
            // PERF(port): was `inline for` — profile in Phase B
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
                        .find_resolution(relative_path, dep, buf, path_buf)
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

        if !optional_peers_buf.is_empty() {
            debug_assert!(any);
            writer.write_all(b", \"optionalPeers\": [")?;

            for (i, optional_peer) in optional_peers_buf.iter().enumerate() {
                write!(
                    writer,
                    "{}{}{}",
                    if i != 0 { " " } else { "" },
                    bun_core::fmt::format_json_string_utf8(
                        optional_peer.slice(buf),
                        Default::default()
                    ),
                    if i != optional_peers_buf.len() - 1 {
                        ","
                    } else {
                        ""
                    },
                )?;
            }

            writer.write_byte(b']')?;
        }

        if dep_behavior.is_bundled() {
            if any {
                writer.write_byte(b',')?;
            } else {
                any = true;
            }

            writer.write_all(b" \"bundled\": true")?;
        }

        // TODO(dylan-conway)
        // if (meta.libc != .all) {
        //     try writer.writeAll(
        //         \\"libc": [
        //     );
        //     try Negatable(Npm.Libc).toJson(meta.libc, writer);
        //     try writer.writeAll("], ");
        // }

        if meta.os != Npm::OperatingSystem::ALL {
            if any {
                writer.write_byte(b',')?;
            } else {
                any = true;
            }
            writer.write_all(b" \"os\": ")?;
            Negatable::<Npm::OperatingSystem>::to_json(meta.os, &mut AsFmt::new(writer))?;
        }

        if meta.arch != Npm::Architecture::ALL {
            if any {
                writer.write_byte(b',')?;
            } else {
                any = true;
            }
            writer.write_all(b" \"cpu\": ")?;
            Negatable::<Npm::Architecture>::to_json(meta.arch, &mut AsFmt::new(writer))?;
        }

        if bin.tag != BinTag::None {
            if any {
                writer.write_byte(b',')?;
            } else {
                any = true;
            }
            writer.write_all(if bin.tag == BinTag::Dir {
                b" \"binDir\": "
            } else {
                b" \"bin\": "
            })?;
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
        workspace_versions: &VersionHashMap,
        optional_peers_buf: &mut Vec<String>,
        pkg_map: &PkgMap<()>,
        relative_path: &[u8],
        path_buf: &mut [u8],
    ) -> Result<(), WriteError> {
        // TODO(port): narrow error set to { OutOfMemory, WriteFailed }
        // PORT NOTE: Zig `defer optional_peers_buf.clearRetainingCapacity()` moved to fn tail.
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
                Self::write_indent(writer, indent)?;
                write!(writer, "\"version\": \"{}\"", version.fmt(buf))?;
            }

            if pkg_bins[pkg_id as usize].tag != BinTag::None {
                let bin = &pkg_bins[pkg_id as usize];
                writer.write_all(b",\n")?;
                Self::write_indent(writer, indent)?;
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

        for &(group_name, group_behavior) in WORKSPACE_DEPENDENCY_GROUPS.iter() {
            // PERF(port): was `inline for` — profile in Phase B
            let mut first = true;
            for dep in pkg_deps[pkg_id as usize].get(deps_buf) {
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
                        Self::write_indent(writer, indent)?;
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
                    Self::write_indent(writer, indent)?;
                }

                let name = dep.name.slice(buf);
                let version = dep.version.literal.slice(buf);

                write!(
                    writer,
                    "{}: {}",
                    bun_core::fmt::format_json_string_utf8(name, Default::default()),
                    bun_core::fmt::format_json_string_utf8(version, Default::default()),
                )?;

                if dep.behavior.contains(Behavior::PEER)
                    && !dep.behavior.contains(Behavior::OPTIONAL)
                    && pkg_map.map.len() > 0
                {
                    if let Err(err) = pkg_map.find_resolution(relative_path, dep, buf, path_buf) {
                        if err == ResolveError::Unresolvable {
                            optional_peers_buf.push(dep.name);
                        }
                    }
                }
            }

            if !first {
                writer.write_all(b",\n")?;
                Self::dec_indent(writer, indent)?;
                writer.write_all(b"}")?;
            }
        }
        if !optional_peers_buf.is_empty() {
            debug_assert!(any);
            writer.write_all(b",\n")?;
            Self::write_indent(writer, indent)?;
            writer.write_all(b"\"optionalPeers\": [\n")?;
            *indent += 1;
            for optional_peer in optional_peers_buf.iter() {
                Self::write_indent(writer, indent)?;
                write!(
                    writer,
                    "{},\n",
                    bun_core::fmt::format_json_string_utf8(
                        optional_peer.slice(buf),
                        Default::default()
                    ),
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

    fn write_indent(writer: &mut Writer, indent: &u32) -> Result<(), WriteError> {
        const INDENT: &[u8] = b"  "; // " " ** indent_scalar (2)
        const _: () = assert!(INDENT.len() == Stringifier::INDENT_SCALAR);
        for _ in 0..*indent {
            writer.write_all(INDENT)?;
        }
        Ok(())
    }

    fn inc_indent(writer: &mut Writer, indent: &mut u32) -> Result<(), WriteError> {
        *indent += 1;
        for _ in 0..*indent {
            writer.write_all(b"  ")?;
        }
        Ok(())
    }

    fn dec_indent(writer: &mut Writer, indent: &mut u32) -> Result<(), WriteError> {
        *indent -= 1;
        for _ in 0..*indent {
            writer.write_all(b"  ")?;
        }
        Ok(())
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
    InvalidOptionalValue,
    InvalidPeerValue,
    InvalidDefaultRegistry,
    InvalidPatchedDependencies,
    InvalidPatchedDependency,
    InvalidWorkspaceObject,
    InvalidPackagesObject,
    InvalidPackagesProp,
    InvalidPackageKey,
    InvalidPackageInfo,
    InvalidPackageSpecifier,
    InvalidSemver,
    InvalidPackagesTree,
    InvalidTrustedDependenciesSet,
    InvalidOverridesObject,
    InvalidCatalogObject,
    InvalidCatalogsObject,
    InvalidDependencyName,
    InvalidDependencyVersion,
    InvalidPackageResolution,
    UnexpectedResolution,
}

bun_core::oom_from_alloc!(ParseError);

bun_core::named_error_set!(ParseError);

pub type PkgPathSet = PkgMap<()>;

pub struct PkgMap<T> {
    pub map: StringHashMap<T>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, strum::IntoStaticStr)]
pub enum ResolveError {
    InvalidPackageKey,
    Unresolvable,
}

impl<T> PkgMap<T> {
    // PORT NOTE: Zig `pub const Entry = T;` — inherent associated types are
    // unstable in Rust; callers name `T` directly.

    pub fn init() -> Self {
        Self {
            map: StringHashMap::default(),
        }
    }

    // deinit → Drop (StringHashMap drops itself)

    pub fn get_or_put(
        &mut self,
        name: &[u8],
    ) -> Result<bun_collections::string_hash_map::GetOrPutResult<'_, T>, bun_alloc::AllocError>
    where
        T: Default,
    {
        self.map.get_or_put(name)
    }

    pub fn put(&mut self, name: impl AsRef<[u8]>, value: T) {
        self.map.put_assume_capacity(name.as_ref(), value);
    }

    pub fn get(&self, name: &[u8]) -> Option<&T> {
        self.map.get(name)
    }

    pub fn contains(&self, path: &[u8]) -> bool {
        self.map.contains_key(path)
    }

    pub fn find_resolution(
        &self,
        pkg_path: &[u8],
        dep: &Dependency,
        string_buf: &[u8],
        path_buf: &mut [u8],
    ) -> Result<&T, ResolveError> {
        let dep_name = dep.name.slice(string_buf);

        if pkg_path.len() + 1 + dep_name.len() > path_buf.len() {
            return Err(ResolveError::InvalidPackageKey);
        }

        path_buf[0..pkg_path.len()].copy_from_slice(pkg_path);
        path_buf[pkg_path.len()] = b'/';
        let mut offset = pkg_path.len() + 1;

        let mut valid = true;
        while valid {
            path_buf[offset..offset + dep_name.len()].copy_from_slice(dep_name);
            let res_path = &path_buf[0..offset + dep_name.len()];

            if let Some(entry) = self.map.get(res_path) {
                return Ok(entry);
            }

            if offset == 0 {
                return Err(ResolveError::Unresolvable);
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

// const PkgMap = struct {};

pub fn parse_into_binary_lockfile(
    lockfile: &mut BinaryLockfile,
    root: JSON::Expr,
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    mut manager: Option<&mut PackageManager>,
) -> Result<(), ParseError> {
    lockfile.init_empty();

    let Some(lockfile_version_expr) = root.get(b"lockfileVersion") else {
        log.add_error(Some(source), root.loc, b"Missing lockfile version");
        return Err(ParseError::InvalidLockfileVersion);
    };

    let lockfile_version_num: u32 = 'lockfile_version: {
        'err: {
            match &lockfile_version_expr.data {
                ExprData::ENumber(num) => {
                    if num.value < 0.0 || num.value > u32::MAX as f64 {
                        break 'err;
                    }

                    // std.math.divExact(f64, num.value, 1) catch break :err
                    if num.value.fract() != 0.0 {
                        break 'err;
                    }
                    break 'lockfile_version num.value as u32;
                }
                _ => {}
            }
        }

        log.add_error(
            Some(source),
            lockfile_version_expr.loc,
            b"Invalid lockfile version",
        );
        return Err(ParseError::InvalidLockfileVersion);
    };

    let Some(lockfile_version) = Version::from_int(lockfile_version_num) else {
        log.add_error(
            Some(source),
            lockfile_version_expr.loc,
            b"Unknown lockfile version",
        );
        return Err(ParseError::UnknownLockfileVersion);
    };

    lockfile.text_lockfile_version = lockfile_version;

    // configVersion is not required
    if let Some(config_version_expr) = root.get(b"configVersion") {
        lockfile.saved_config_version = match ConfigVersion::from_expr(&config_version_expr) {
            Some(v) => Some(v),
            None => {
                log.add_error(
                    Some(source),
                    config_version_expr.loc,
                    b"Invalid \"configVersion\". Expected a number",
                );
                return Err(ParseError::InvalidConfigVersion);
            }
        };
    }

    if let Some(trusted_dependencies_expr) = root.get(b"trustedDependencies") {
        let mut trusted_dependencies = TrustedDependenciesSet::default();
        if !trusted_dependencies_expr.is_array() {
            log.add_error(
                Some(source),
                trusted_dependencies_expr.loc,
                b"Expected an array",
            );
            return Err(ParseError::InvalidTrustedDependenciesSet);
        }

        for dep in trusted_dependencies_expr
            .data
            .e_array()
            .expect("infallible: variant checked")
            .items
            .slice()
        {
            if !dep.is_string() {
                log.add_error(Some(source), dep.loc, b"Expected a string");
                return Err(ParseError::InvalidTrustedDependenciesSet);
            }
            let name_hash: TruncatedPackageNameHash =
                dep.as_string_hash_utf8(StringBuilder::string_hash)?
                    .unwrap() as TruncatedPackageNameHash;
            trusted_dependencies.insert(name_hash, ());
        }

        lockfile.trusted_dependencies = Some(trusted_dependencies);
    }

    if let Some(patched_dependencies_expr) = root.get(b"patchedDependencies") {
        if !patched_dependencies_expr.is_object() {
            log.add_error(
                Some(source),
                patched_dependencies_expr.loc,
                b"Expected an object",
            );
            return Err(ParseError::InvalidPatchedDependencies);
        }

        for prop in patched_dependencies_expr
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let key = prop.key.expect("infallible: prop has key");
            let value = prop.value.expect("infallible: prop has value");
            if !key.is_string() {
                log.add_error(Some(source), key.loc, b"Expected a string");
                return Err(ParseError::InvalidPatchedDependencies);
            }

            if !value.is_string() {
                log.add_error(Some(source), value.loc, b"Expected a string");
                return Err(ParseError::InvalidPatchedDependencies);
            }

            let key_hash = key
                .as_string_hash_utf8(StringBuilder::string_hash)?
                .unwrap();
            lockfile.patched_dependencies.insert(
                key_hash,
                PatchedDep {
                    path: sbuf!(lockfile).append(
                        value
                            .as_utf8_string_literal()
                            .expect("infallible: is_string checked"),
                    )?,
                    ..Default::default()
                },
            );
        }
    }

    if let Some(overrides_expr) = root.get(b"overrides") {
        if !overrides_expr.is_object() {
            log.add_error(Some(source), overrides_expr.loc, b"Expected an object");
            return Err(ParseError::InvalidOverridesObject);
        }

        for prop in overrides_expr
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let key = prop.key.expect("infallible: prop has key");
            let value = prop.value.expect("infallible: prop has value");

            if !key.is_string()
                || key
                    .data
                    .e_string()
                    .expect("infallible: variant checked")
                    .len()
                    == 0
            {
                log.add_error(Some(source), key.loc, b"Expected a non-empty string");
                return Err(ParseError::InvalidOverridesObject);
            }

            let name_str = key
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            let name_hash = StringBuilder::string_hash(name_str);
            let name = sbuf!(lockfile).append_with_hash(name_str, name_hash)?;

            // TODO(dylan-conway) also accept object when supported
            if !value.is_string() {
                log.add_error(Some(source), value.loc, b"Expected a string");
                return Err(ParseError::InvalidOverridesObject);
            }

            let version_str = value
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            let version_hash = StringBuilder::string_hash(version_str);
            let version = sbuf!(lockfile).append_with_hash(version_str, version_hash)?;
            let version_sliced = version.sliced(lockfile.buffers.string_bytes.as_slice());

            let dep = Dependency {
                name,
                name_hash,
                version: match dependency::parse(
                    name,
                    name_hash,
                    version_sliced.slice,
                    &version_sliced,
                    &mut *log,
                    manager.as_deref_mut(),
                ) {
                    Some(v) => v,
                    None => {
                        log.add_error(Some(source), value.loc, b"Invalid override version");
                        return Err(ParseError::InvalidOverridesObject);
                    }
                },
                ..Default::default()
            };

            lockfile.overrides.map.insert(name_hash, dep);
        }
    }

    if let Some(catalog_expr) = root.get(b"catalog") {
        if !catalog_expr.is_object() {
            log.add_error(Some(source), catalog_expr.loc, b"Expected an object");
            return Err(ParseError::InvalidCatalogObject);
        }

        for prop in catalog_expr
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let key = prop.key.expect("infallible: prop has key");
            let value = prop.value.expect("infallible: prop has value");

            if !key.is_string()
                || key
                    .data
                    .e_string()
                    .expect("infallible: variant checked")
                    .len()
                    == 0
            {
                log.add_error(Some(source), key.loc, b"Expected a non-empty string");
                return Err(ParseError::InvalidCatalogObject);
            }

            let dep_name_str = key
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            let dep_name_hash = StringBuilder::string_hash(dep_name_str);
            let dep_name = sbuf!(lockfile).append_with_hash(dep_name_str, dep_name_hash)?;

            if !value.is_string() {
                log.add_error(Some(source), value.loc, b"Expected a string");
                return Err(ParseError::InvalidCatalogObject);
            }

            let version_str = value
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            let version_hash = StringBuilder::string_hash(version_str);
            let version = sbuf!(lockfile).append_with_hash(version_str, version_hash)?;
            let version_sliced = version.sliced(lockfile.buffers.string_bytes.as_slice());

            let dep = Dependency {
                name: dep_name,
                name_hash: dep_name_hash,
                version: match dependency::parse(
                    dep_name,
                    dep_name_hash,
                    version_sliced.slice,
                    &version_sliced,
                    &mut *log,
                    manager.as_deref_mut(),
                ) {
                    Some(v) => v,
                    None => {
                        log.add_error(Some(source), value.loc, b"Invalid catalog version");
                        return Err(ParseError::InvalidCatalogObject);
                    }
                },
                ..Default::default()
            };

            let entry = lockfile.catalogs.default.get_or_put_adapted(
                dep_name,
                string_array_hash_context(lockfile.buffers.string_bytes.as_slice()),
            )?;

            if entry.found_existing {
                log.add_error(Some(source), key.loc, b"Duplicate catalog entry");
                return Err(ParseError::InvalidCatalogObject);
            }

            *entry.key_ptr = dep_name;
            *entry.value_ptr = dep;
        }
    }

    if let Some(catalogs_expr) = root.get(b"catalogs") {
        if !catalogs_expr.is_object() {
            log.add_error(Some(source), catalogs_expr.loc, b"Expected an object");
            return Err(ParseError::InvalidCatalogsObject);
        }

        for catalog_prop in catalogs_expr
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let catalog_key = catalog_prop.key.expect("infallible: prop has key");
            let catalog_value = catalog_prop.value.expect("infallible: prop has value");

            if !catalog_key.is_string()
                || catalog_key
                    .data
                    .e_string()
                    .expect("infallible: variant checked")
                    .len()
                    == 0
            {
                log.add_error(
                    Some(source),
                    catalog_key.loc,
                    b"Expected a non-empty string",
                );
                return Err(ParseError::InvalidCatalogsObject);
            }

            if !catalog_value.is_object() {
                log.add_error(Some(source), catalog_value.loc, b"Expected an object");
                return Err(ParseError::InvalidCatalogsObject);
            }

            let catalog_name_str = catalog_key
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            let catalog_name = sbuf!(lockfile).append(catalog_name_str)?;

            let group = lockfile
                .catalogs
                .get_or_put_group(lockfile.buffers.string_bytes.as_slice(), catalog_name)?;

            for prop in catalog_value
                .data
                .e_object()
                .expect("infallible: variant checked")
                .properties
                .slice()
            {
                let key = prop.key.expect("infallible: prop has key");
                let value = prop.value.expect("infallible: prop has value");

                if !key.is_string()
                    || key
                        .data
                        .e_string()
                        .expect("infallible: variant checked")
                        .len()
                        == 0
                {
                    log.add_error(Some(source), key.loc, b"Expected a non-empty string");
                    return Err(ParseError::InvalidCatalogsObject);
                }

                let dep_name_str = key
                    .as_utf8_string_literal()
                    .expect("infallible: is_string checked");
                let dep_name_hash = StringBuilder::string_hash(dep_name_str);
                let dep_name = sbuf!(lockfile).append_with_hash(dep_name_str, dep_name_hash)?;

                if !value.is_string() {
                    log.add_error(Some(source), value.loc, b"Expected a string");
                    return Err(ParseError::InvalidCatalogsObject);
                }

                let version_str = value
                    .as_utf8_string_literal()
                    .expect("infallible: is_string checked");
                let version_hash = StringBuilder::string_hash(version_str);
                let version = sbuf!(lockfile).append_with_hash(version_str, version_hash)?;
                let version_sliced = version.sliced(lockfile.buffers.string_bytes.as_slice());

                let dep = Dependency {
                    name: dep_name,
                    name_hash: dep_name_hash,
                    version: match dependency::parse(
                        dep_name,
                        dep_name_hash,
                        version_sliced.slice,
                        &version_sliced,
                        &mut *log,
                        manager.as_deref_mut(),
                    ) {
                        Some(v) => v,
                        None => {
                            log.add_error(Some(source), value.loc, b"Invalid catalog version");
                            return Err(ParseError::InvalidCatalogsObject);
                        }
                    },
                    ..Default::default()
                };

                let entry = group.get_or_put_adapted(
                    dep_name,
                    string_array_hash_context(lockfile.buffers.string_bytes.as_slice()),
                )?;

                if entry.found_existing {
                    log.add_error(Some(source), key.loc, b"Duplicate catalog entry");
                    return Err(ParseError::InvalidCatalogsObject);
                }

                *entry.key_ptr = dep_name;
                *entry.value_ptr = dep;
            }
        }
    }

    let Some(workspaces_obj) = root.get_object(b"workspaces") else {
        log.add_error(
            Some(source),
            root.loc,
            b"Missing a workspaces object property",
        );
        return Err(ParseError::InvalidWorkspaceObject);
    };

    let mut maybe_root_pkg: Option<Expr> = None;

    for prop in workspaces_obj
        .data
        .e_object()
        .expect("infallible: variant checked")
        .properties
        .slice()
    {
        let key = prop.key.expect("infallible: prop has key");
        let value: Expr = prop.value.expect("infallible: prop has value");
        if !key.is_string() {
            log.add_error(Some(source), key.loc, b"Expected a string");
            return Err(ParseError::InvalidWorkspaceObject);
        }
        if !value.is_object() {
            log.add_error(Some(source), value.loc, b"Expected an object");
            return Err(ParseError::InvalidWorkspaceObject);
        }

        let path = key
            .as_utf8_string_literal()
            .expect("infallible: is_string checked");

        if path.is_empty() {
            if maybe_root_pkg.is_some() {
                log.add_error(Some(source), key.loc, b"Duplicate root package");
                return Err(ParseError::InvalidWorkspaceObject);
            }

            maybe_root_pkg = Some(value);
            continue;
        }

        let Some(name_expr) = value.get(b"name") else {
            log.add_error(Some(source), value.loc, b"Expected a string name property");
            return Err(ParseError::InvalidWorkspaceObject);
        };

        let Some(name_hash) = name_expr.as_string_hash_utf8(StringBuilder::string_hash)? else {
            log.add_error(
                Some(source),
                name_expr.loc,
                b"Expected a string name property",
            );
            return Err(ParseError::InvalidWorkspaceObject);
        };

        lockfile
            .workspace_paths
            .insert(name_hash, sbuf!(lockfile).append(path)?);

        // versions are optional
        if let Some(version_expr) = value.get(b"version") {
            if !version_expr.is_string() {
                log.add_error(
                    Some(source),
                    version_expr.loc,
                    b"Expected a string version property",
                );
                return Err(ParseError::InvalidWorkspaceObject);
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
                log.add_error(Some(source), version_expr.loc, b"Invalid semver version");
                return Err(ParseError::InvalidSemver);
            }

            lockfile
                .workspace_versions
                .insert(name_hash, parsed.version.min());
        }
    }

    let mut optional_peers_buf: HashMap<u64, ()> = HashMap::default();

    let mut bundled_pkgs = PkgPathSet::init();

    let Some(root_pkg_exr) = maybe_root_pkg else {
        log.add_error(Some(source), workspaces_obj.loc, b"Expected root package");
        return Err(ParseError::InvalidWorkspaceObject);
    };

    {
        // `Expr::get` returns by value and `as_utf8_string_literal` borrows
        // from it, so keep the expr alive for the rest of the block instead
        // of letting it drop at the end of the `if let` arm.
        let name_expr = root_pkg_exr.get(b"name");
        let maybe_name = if let Some(name) = &name_expr {
            match name.as_utf8_string_literal() {
                Some(s) => Some(s),
                None => {
                    log.add_error(Some(source), name.loc, b"Expected a string");
                    return Err(ParseError::InvalidWorkspaceObject);
                }
            }
        } else {
            None
        };

        let (off, len) = parse_append_dependencies::<false, true>(
            lockfile,
            &root_pkg_exr,
            &mut *log,
            source,
            &mut optional_peers_buf,
            None,
            None,
            Some(&workspaces_obj),
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
        let root_name_hash = root_pkg.name_hash;
        lockfile.packages.append(root_pkg)?;
        lockfile.get_or_put_id(0, root_name_hash)?;
    }

    let mut pkg_map: PkgMap<PackageID> = PkgMap::init();

    let workspace_pkgs_off: u32 = 1;
    let mut workspace_pkgs_len: u32 = 0;

    if lockfile_version != Version::V0 {
        // these are the `workspaceOnly` packages
        // PORT NOTE: snapshot the workspace-path handles up front so the loop
        // body can take `&mut *lockfile` (`parse_append_dependencies`,
        // `append_package_dedupe`) without conflicting with the
        // `workspace_paths.values()` iterator borrow. `String` is `Copy`.
        let workspace_path_snapshot: Vec<String> = lockfile.workspace_paths.values().to_vec();
        'workspaces: for workspace_path in &workspace_path_snapshot {
            for prop in workspaces_obj
                .data
                .e_object()
                .expect("infallible: variant checked")
                .properties
                .slice()
            {
                let key = prop.key.expect("infallible: prop has key");
                let value = prop.value.expect("infallible: prop has value");
                let path = key
                    .as_utf8_string_literal()
                    .expect("infallible: is_string checked");
                if !strings::eql_long(
                    path,
                    workspace_path.slice(lockfile.buffers.string_bytes.as_slice()),
                    true,
                ) {
                    continue;
                }

                let mut pkg = Package::default();

                pkg.resolution = Resolution::init(crate::resolution::TaggedValue::Workspace(
                    sbuf!(lockfile).append(path)?,
                ));

                let name_expr = value.get(b"name").unwrap();
                let name = name_expr
                    .as_utf8_string_literal()
                    .expect("infallible: is_string checked");
                let name_hash = StringBuilder::string_hash(name);

                pkg.name = sbuf!(lockfile).append_with_hash(name, name_hash)?;
                pkg.name_hash = name_hash;

                let (off, len) = parse_append_dependencies::<false, false>(
                    lockfile,
                    &value,
                    &mut *log,
                    source,
                    &mut optional_peers_buf,
                    None,
                    None,
                    None,
                )?;

                pkg.dependencies = DependencySlice::new(off, len);
                pkg.resolutions = PackageIDSlice::new(off, len);

                if let Some(bin_expr) = value.get(b"bin") {
                    pkg.bin = Bin::parse_append(
                        &bin_expr,
                        &mut sbuf!(lockfile),
                        &mut lockfile.buffers.extern_strings,
                    )?;
                } else if let Some(bin_dir_expr) = value.get(b"binDir") {
                    pkg.bin =
                        Bin::parse_append_from_directories(&bin_dir_expr, &mut sbuf!(lockfile))?;
                }

                // there should be no duplicates
                let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;

                let entry = pkg_map.get_or_put(name)?;
                if entry.found_existing {
                    log.add_error_fmt(
                        source,
                        key.loc,
                        format_args!("Duplicate workspace name: '{}'", bstr::BStr::new(name)),
                    );
                    return Err(ParseError::InvalidWorkspaceObject);
                }

                *entry.value_ptr = pkg_id;

                workspace_pkgs_len += 1;
                continue 'workspaces;
            }
        }
    }

    let Some(pkgs_expr) = root.get(b"packages") else {
        // packages is empty, but there might be empty workspace packages
        if workspace_pkgs_len == 0 {
            lockfile.init_empty();
        }
        return Ok(());
    };

    {
        if !pkgs_expr.is_object() {
            log.add_error(Some(source), pkgs_expr.loc, b"Expected an object");
            return Err(ParseError::InvalidPackagesObject);
        }

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
        for prop in pkgs_expr
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let key = prop.key.expect("infallible: prop has key");
            let value = prop.value.expect("infallible: prop has value");

            let Some(pkg_path) = key.as_utf8_string_literal() else {
                log.add_error(Some(source), key.loc, b"Expected a string");
                return Err(ParseError::InvalidPackageKey);
            };

            if !value.is_array() {
                log.add_error(Some(source), value.loc, b"Expected an array");
                return Err(ParseError::InvalidPackageInfo);
            }

            let pkg_info = &value
                .data
                .e_array()
                .expect("infallible: variant checked")
                .items;
            if (pkg_info.len_u32() as usize) < 3 {
                continue;
            }
            let maybe_info_obj = pkg_info.at(2);
            let Some(bundled_expr) = maybe_info_obj.get(b"bundled") else {
                continue;
            };
            let Some(bundled) = bundled_expr.as_bool() else {
                continue;
            };
            if !bundled {
                continue;
            }
            bundled_pkgs.put(pkg_path, ());
        }

        'next_pkg_key: for prop in pkgs_expr
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let key = prop.key.expect("infallible: prop has key");
            let value = prop.value.expect("infallible: prop has value");

            let Some(pkg_path) = key.as_utf8_string_literal() else {
                log.add_error(Some(source), key.loc, b"Expected a string");
                return Err(ParseError::InvalidPackageKey);
            };

            if !value.is_array() {
                log.add_error(Some(source), value.loc, b"Expected an array");
                return Err(ParseError::InvalidPackageInfo);
            }

            let mut i: usize = 0;
            let pkg_info = &value
                .data
                .e_array()
                .expect("infallible: variant checked")
                .items;

            if (pkg_info.len_u32() as usize) == 0 {
                log.add_error(Some(source), value.loc, b"Missing package info");
                return Err(ParseError::InvalidPackageInfo);
            }

            let res_info = pkg_info.at(i);
            i += 1;

            let Some(res_info_str) = res_info.as_utf8_string_literal() else {
                log.add_error(Some(source), res_info.loc, b"Expected a string");
                return Err(ParseError::InvalidPackageResolution);
            };

            let (name_str, res_str) = 'name_and_res: {
                if strings::has_prefix(res_info_str, b"@root:") {
                    break 'name_and_res (b"" as &[u8], &res_info_str[1..]);
                }

                match dependency::split_name_and_version(res_info_str) {
                    Ok(pair) => break 'name_and_res pair,
                    Err(_) => {
                        log.add_error(Some(source), res_info.loc, b"Invalid package resolution");
                        return Err(ParseError::InvalidPackageResolution);
                    }
                }
            };

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
                        res_info.loc,
                        format_args!("Unexpected resolution: {}", bstr::BStr::new(res_str)),
                    );
                    return Err(ParseError::UnexpectedResolution);
                }
                Err(crate::resolution::FromTextLockfileError::InvalidSemver) => {
                    log.add_error_fmt(
                        source,
                        res_info.loc,
                        format_args!("Invalid package version: {}", bstr::BStr::new(res_str)),
                    );
                    return Err(ParseError::InvalidSemver);
                }
            };

            if res.tag == ResolutionTag::Npm {
                if i >= (pkg_info.len_u32() as usize) {
                    log.add_error(Some(source), value.loc, b"Missing npm registry");
                    return Err(ParseError::InvalidPackageInfo);
                }
                let registry_expr = pkg_info.at(i);
                i += 1;

                let Some(registry_str) = registry_expr.as_utf8_string_literal() else {
                    log.add_error(Some(source), registry_expr.loc, b"Expected a string");
                    return Err(ParseError::InvalidPackageInfo);
                };

                if registry_str.is_empty() {
                    // Use scope-specific registry if available, otherwise fall back to default
                    let registry_url = if let Some(mgr) = manager.as_deref() {
                        mgr.scope_for_package_name(name_str).url.href()
                    } else {
                        Npm::Registry::DEFAULT_URL.as_bytes()
                    };

                    let url = ExtractTarball::build_url(
                        registry_url,
                        &strings::StringOrTinyString::init(
                            name.slice(lockfile.buffers.string_bytes.as_slice()),
                        ),
                        res.npm().version,
                        lockfile.buffers.string_bytes.as_slice(),
                    )?;

                    res.npm_mut().url = sbuf!(lockfile).append(&url)?;
                } else {
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
                    let pkg_names = pkgs.items_name();
                    let pkg_resolutions = pkgs.items_resolution();

                    // new entry, a matching workspace MUST exist
                    for _workspace_pkg_id in
                        workspace_pkgs_off..workspace_pkgs_off + workspace_pkgs_len
                    {
                        let workspace_pkg_id: PackageID =
                            u32::try_from(_workspace_pkg_id).expect("int cast");
                        if res.eql(
                            &pkg_resolutions[workspace_pkg_id as usize],
                            lockfile.buffers.string_bytes.as_slice(),
                            lockfile.buffers.string_bytes.as_slice(),
                        ) {
                            #[cfg(debug_assertions)]
                            {
                                debug_assert!(!strings::eql_long(
                                    pkg_path,
                                    pkg_names[workspace_pkg_id as usize]
                                        .slice(lockfile.buffers.string_bytes.as_slice()),
                                    true,
                                ));
                            }

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
                        res_info.loc,
                        format_args!(
                            "Unknown workspace: '{}'",
                            bstr::BStr::new(
                                res.workspace()
                                    .slice(lockfile.buffers.string_bytes.as_slice())
                            )
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

                        if i >= (pkg_info.len_u32() as usize) {
                            log.add_error(Some(source), value.loc, b"Missing dependencies object");
                            return Err(ParseError::InvalidPackageInfo);
                        }

                        let deps_os_cpu_libc_bin_bundle_obj = pkg_info.at(i);
                        i += 1;
                        if !deps_os_cpu_libc_bin_bundle_obj.is_object() {
                            log.add_error(
                                Some(source),
                                deps_os_cpu_libc_bin_bundle_obj.loc,
                                b"Expected an object",
                            );
                            return Err(ParseError::InvalidPackageInfo);
                        }

                        let (off, len) = parse_append_dependencies::<true, false>(
                            lockfile,
                            deps_os_cpu_libc_bin_bundle_obj,
                            &mut *log,
                            source,
                            &mut optional_peers_buf,
                            Some(pkg_path),
                            Some(&bundled_pkgs),
                            None,
                        )?;

                        pkg.dependencies = DependencySlice::new(off, len);
                        pkg.resolutions = PackageIDSlice::new(off, len);

                        if let Some(bin) = deps_os_cpu_libc_bin_bundle_obj.get(b"bin") {
                            pkg.bin = Bin::parse_append(
                                &bin,
                                &mut sbuf!(lockfile),
                                &mut lockfile.buffers.extern_strings,
                            )?;
                        } else if let Some(bin_dir) = deps_os_cpu_libc_bin_bundle_obj.get(b"binDir")
                        {
                            pkg.bin =
                                Bin::parse_append_from_directories(&bin_dir, &mut sbuf!(lockfile))?;
                        }

                        if res.tag != ResolutionTag::Workspace {
                            if let Some(os) = deps_os_cpu_libc_bin_bundle_obj.get(b"os") {
                                pkg.meta.os =
                                    Npm::negatable_from_json::<Npm::OperatingSystem>(&os)?;
                            }
                            if let Some(arch) = deps_os_cpu_libc_bin_bundle_obj.get(b"cpu") {
                                pkg.meta.arch =
                                    Npm::negatable_from_json::<Npm::Architecture>(&arch)?;
                            }
                            // TODO(dylan-conway)
                            // if (os_cpu_libc_obj.get("libc")) |libc| {
                            //     pkg.meta.libc = Negatable(Npm.Libc).fromJson(allocator, libc);
                            // }
                        }
                    }
                    ResolutionTag::Root => {
                        if i >= (pkg_info.len_u32() as usize) {
                            log.add_error(
                                Some(source),
                                value.loc,
                                b"Missing package binaries object",
                            );
                            return Err(ParseError::InvalidPackageInfo);
                        }
                        let bin_obj = pkg_info.at(i);
                        i += 1;
                        if !bin_obj.is_object() {
                            log.add_error(Some(source), bin_obj.loc, b"Expected an object");
                            return Err(ParseError::InvalidPackageInfo);
                        }

                        if let Some(bin) = bin_obj.get(b"bin") {
                            pkg.bin = Bin::parse_append(
                                &bin,
                                &mut sbuf!(lockfile),
                                &mut lockfile.buffers.extern_strings,
                            )?;
                        } else if let Some(bin_dir) = bin_obj.get(b"binDir") {
                            pkg.bin =
                                Bin::parse_append_from_directories(&bin_dir, &mut sbuf!(lockfile))?;
                        }
                    }
                    _ => {}
                }
            }

            // integrity
            match res.tag {
                ResolutionTag::Npm => {
                    if i >= (pkg_info.len_u32() as usize) {
                        log.add_error(Some(source), value.loc, b"Missing integrity");
                        return Err(ParseError::InvalidPackageInfo);
                    }
                    let integrity_expr = pkg_info.at(i);
                    i += 1;
                    let Some(integrity_str) = integrity_expr.as_utf8_string_literal() else {
                        log.add_error(Some(source), integrity_expr.loc, b"Expected a string");
                        return Err(ParseError::InvalidPackageInfo);
                    };

                    pkg.meta.integrity = Integrity::parse(integrity_str);
                }
                ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                    // integrity is optional for tarball deps (backward compat)
                    if i < (pkg_info.len_u32() as usize) {
                        let integrity_expr = pkg_info.at(i);
                        if let Some(integrity_str) = integrity_expr.as_utf8_string_literal() {
                            pkg.meta.integrity = Integrity::parse(integrity_str);
                            i += 1;
                        }
                    }
                }
                tag @ (ResolutionTag::Git | ResolutionTag::Github) => {
                    // .bun-tag
                    if i >= (pkg_info.len_u32() as usize) {
                        log.add_error(Some(source), value.loc, b"Missing git dependency tag");
                        return Err(ParseError::InvalidPackageInfo);
                    }

                    let bun_tag = pkg_info.at(i);
                    i += 1;

                    let Some(bun_tag_str) = bun_tag.as_utf8_string_literal() else {
                        log.add_error(Some(source), bun_tag.loc, b"Expected a string");
                        return Err(ParseError::InvalidPackageInfo);
                    };

                    let resolved = sbuf!(lockfile).append(bun_tag_str)?;
                    if tag == ResolutionTag::Git {
                        res.git_mut().resolved = resolved;
                    } else {
                        res.github_mut().resolved = resolved;
                    }

                    // Optional integrity hash (added to pin tarball content)
                    if i < (pkg_info.len_u32() as usize) {
                        let integrity_expr = pkg_info.at(i);
                        if let Some(integrity_str) = integrity_expr.as_utf8_string_literal() {
                            pkg.meta.integrity = Integrity::parse(integrity_str);
                            i += 1;
                        }
                    }
                }
                _ => {}
            }

            pkg.name = name;
            pkg.name_hash = name_hash;
            pkg.resolution = res;

            let pkg_id = lockfile.append_package_dedupe(&mut pkg)?;

            let entry = pkg_map.get_or_put(pkg_path)?;
            if entry.found_existing {
                log.add_error(Some(source), key.loc, b"Duplicate package path");
                return Err(ParseError::InvalidPackageKey);
            }

            *entry.value_ptr = pkg_id;
        }

        lockfile.buffers.resolutions.reserve_exact(
            lockfile
                .buffers
                .dependencies
                .len()
                .saturating_sub(lockfile.buffers.resolutions.len()),
        );
        // Zig: ensureTotalCapacityPrecise → expandToCapacity → @memset(invalid_package_id).
        lockfile
            .buffers
            .resolutions
            .resize(lockfile.buffers.dependencies.len(), invalid_package_id);
        lockfile.buffers.resolutions.fill(invalid_package_id);

        // a package can list the same dependency in each dependnecy group, but only the first
        // is chosen (dev -> optional -> prod -> peer)
        let mut seen_deps: bun_collections::StringArrayHashMap<()> = Default::default();

        // PORT NOTE: Zig grabs `pkgs.items(.meta)` / `.items(.resolution)` as
        // mutable column slices, writes index 0, then keeps the resolution slice
        // for read-only lookups. In Rust the two `[0]` writes are done first via
        // sequential `&mut` accessors so the loops can take all column views
        // immutably without overlapping exclusive borrows or `unsafe`.
        lockfile.packages.items_resolution_mut()[0] =
            Resolution::init(crate::resolution::TaggedValue::Root);
        lockfile.packages.items_meta_mut()[0].origin = Origin::Local;

        let pkgs = lockfile.packages.slice();
        let pkg_deps = pkgs.items_dependencies();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions: &[Resolution] = pkgs.items_resolution();

        // Disjoint-field split of `lockfile.buffers` so each loop body can hold
        // `&mut dependencies[i]` and `&mut resolutions[i]` together with a shared
        // `string_bytes` view (Zig's `*Dependency` / `lockfile.buffers.*.items`
        // accesses freely alias the same struct).
        let buffers = &mut lockfile.buffers;
        let string_buf: &[u8] = buffers.string_bytes.as_slice();
        let dependencies: &mut [Dependency] = buffers.dependencies.as_mut_slice();
        let resolutions: &mut [PackageID] = buffers.resolutions.as_mut_slice();

        {
            // first the root dependencies are resolved
            for _dep_id in pkg_deps[0].begin()..pkg_deps[0].end() {
                let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
                let dep = &mut dependencies[dep_id as usize];

                let Some(&res_id) = pkg_map.get(dep.name.slice(string_buf)) else {
                    if dep.behavior.contains(Behavior::OPTIONAL) {
                        continue;
                    }
                    dependency_resolution_failure(
                        dep,
                        None,
                        string_buf,
                        source,
                        log,
                        root_pkg_exr.loc,
                    )?;
                    return Err(ParseError::InvalidPackageInfo);
                };

                if !dep.behavior.is_workspace()
                    && seen_deps
                        .get_or_put(dep.name.slice(string_buf))?
                        .found_existing
                {
                    resolutions[dep_id as usize] = res_id;
                    continue;
                }

                map_dep_to_pkg(
                    dep,
                    dep_id,
                    res_id,
                    resolutions,
                    lockfile_version,
                    pkg_resolutions,
                );
            }
        }

        let mut path_buf = PathBuffer::uninit();

        if lockfile_version != Version::V0 {
            // then workspace dependencies are resolved
            for _pkg_id in workspace_pkgs_off..workspace_pkgs_off + workspace_pkgs_len {
                let pkg_id: PackageID = u32::try_from(_pkg_id).expect("int cast");
                let workspace_name = pkg_names[pkg_id as usize].slice(string_buf);

                seen_deps.clear_retaining_capacity();

                let deps = pkg_deps[pkg_id as usize];
                for _dep_id in deps.begin()..deps.end() {
                    let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
                    let dep = &mut dependencies[dep_id as usize];
                    let dep_name = dep.name.slice(string_buf);

                    let workspace_node_modules = {
                        let buf_slice = &mut path_buf[..];
                        let needed = workspace_name.len() + 1 + dep_name.len();
                        if needed > buf_slice.len() {
                            log.add_error_fmt(
                                source,
                                root_pkg_exr.loc,
                                format_args!(
                                    "Workspace and dependency name too long: '{}/{}'",
                                    bstr::BStr::new(workspace_name),
                                    bstr::BStr::new(dep_name),
                                ),
                            );
                            return Err(ParseError::InvalidPackageInfo);
                        }
                        buf_slice[..workspace_name.len()].copy_from_slice(workspace_name);
                        buf_slice[workspace_name.len()] = b'/';
                        buf_slice[workspace_name.len() + 1..needed].copy_from_slice(dep_name);
                        &buf_slice[..needed]
                    };

                    let Some(&res_id) = pkg_map
                        .get(workspace_node_modules)
                        .or_else(|| pkg_map.get(dep_name))
                    else {
                        if dep.behavior.contains(Behavior::OPTIONAL) {
                            continue;
                        }
                        dependency_resolution_failure(
                            dep,
                            Some(workspace_name),
                            string_buf,
                            source,
                            log,
                            root_pkg_exr.loc,
                        )?;
                        return Err(ParseError::InvalidPackageInfo);
                    };

                    if seen_deps.get_or_put(dep_name)?.found_existing {
                        resolutions[dep_id as usize] = res_id;
                        continue;
                    }

                    map_dep_to_pkg(
                        dep,
                        dep_id,
                        res_id,
                        resolutions,
                        lockfile_version,
                        pkg_resolutions,
                    );
                }
            }
        }

        // then each package dependency
        for prop in pkgs_expr
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let key = prop.key.expect("infallible: prop has key");

            let pkg_path = key
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");

            let Some(&pkg_id) = pkg_map.get(pkg_path) else {
                return Err(ParseError::InvalidPackagesObject);
            };

            let res = &pkg_resolutions[pkg_id as usize];

            if res.tag == ResolutionTag::Workspace {
                // we've already resolved the workspace dependencies above
                continue;
            }

            // find resolutions. iterate up to root through the pkg path.
            let deps = pkg_deps[pkg_id as usize];
            'deps: for _dep_id in deps.begin()..deps.end() {
                let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
                let dep = &mut dependencies[dep_id as usize];

                let res_id =
                    match pkg_map.find_resolution(pkg_path, dep, string_buf, &mut path_buf[..]) {
                        Ok(&id) => id,
                        Err(ResolveError::InvalidPackageKey) => {
                            log.add_error(Some(source), key.loc, b"Invalid package path");
                            return Err(ParseError::InvalidPackageKey);
                        }
                        Err(ResolveError::Unresolvable) => {
                            if dep.behavior.contains(Behavior::OPTIONAL) {
                                continue 'deps;
                            }
                            dependency_resolution_failure(
                                dep,
                                Some(pkg_path),
                                string_buf,
                                source,
                                log,
                                key.loc,
                            )?;
                            return Err(ParseError::InvalidPackageInfo);
                        }
                    };

                map_dep_to_pkg(
                    dep,
                    dep_id,
                    res_id,
                    resolutions,
                    lockfile_version,
                    pkg_resolutions,
                );
            }
        }

        if let Err(err) = lockfile.resolve(log) {
            return Err(match err {
                tree::SubtreeError::OutOfMemory => ParseError::OutOfMemory,
                tree::SubtreeError::DependencyLoop => ParseError::InvalidPackagesObject,
            });
        }
    }

    Ok(())
}

// PORT NOTE: Zig signature takes `*BinaryLockfile` plus a `*Dependency` that
// points into `lockfile.buffers.dependencies` — fine in Zig, illegal aliasing in
// Rust. The function only touches `buffers.resolutions[dep_id]` and reads
// `text_lockfile_version`, so accept those disjoint pieces directly and let the
// caller split-borrow `lockfile.buffers`.
fn map_dep_to_pkg(
    dep: &mut Dependency,
    dep_id: DependencyID,
    pkg_id: PackageID,
    resolutions: &mut [PackageID],
    text_lockfile_version: Version,
    pkg_resolutions: &[Resolution],
) {
    resolutions[dep_id as usize] = pkg_id;

    if text_lockfile_version != Version::V0 {
        let res = &pkg_resolutions[pkg_id as usize];
        if res.tag == ResolutionTag::Workspace {
            dep.version.tag = DependencyVersionTag::Workspace;
            // SAFETY: `res.tag == Workspace` was just checked, so the
            // `workspace` arm of the `Resolution.value` union is the active one.
            dep.version.value = DependencyVersionValue {
                workspace: *res.workspace(),
            };
        }
    }
}

fn dependency_resolution_failure(
    dep: &Dependency,
    pkg_path: Option<&[u8]>,
    buf: &[u8],
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    loc: bun_ast::Loc,
) -> Result<(), bun_alloc::AllocError> {
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
                bstr::BStr::new(dep.name.slice(buf)),
                bstr::BStr::new(path),
            ),
        );
    } else {
        log.add_error_fmt(
            source,
            loc,
            format_args!(
                "Failed to resolve root {} dependency '{}'",
                behavior_str,
                bstr::BStr::new(dep.name.slice(buf)),
            ),
        );
    }
    Ok(())
}

// PORT NOTE: Zig threaded `string_buf: *String.Buf` separately from `lockfile`.
// In Rust the `Buf` borrows the same `lockfile.buffers.string_bytes` /
// `string_pool` fields, so the two parameters alias. The `buf` parameter is
// dropped and each append constructs a fresh `sbuf!(lockfile)` so the borrow
// checker can see the disjoint field accesses against `buffers.dependencies`
// and `workspace_paths`.
fn parse_append_dependencies<const CHECK_FOR_BUNDLED: bool, const IS_ROOT: bool>(
    lockfile: &mut BinaryLockfile,
    obj: &Expr,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    optional_peers_buf: &mut HashMap<u64, ()>,
    // Zig: `if (check_for_bundled) string else void` → carried as Option, gated by const generic
    pkg_path: Option<&[u8]>,
    bundled_pkgs: Option<&PkgPathSet>,
    workspaces_obj: Option<&Expr>,
) -> Result<(u32, u32), ParseError> {
    // PORT NOTE: defer optional_peers_buf.clearRetainingCapacity() moved to fn tail
    // (and to each early-return path implicitly via clear-on-next-call semantics in caller).
    // TODO(port): if exact defer semantics matter on error paths, wrap in scopeguard.

    if let Some(optional_peers) = obj.get(b"optionalPeers") {
        if !optional_peers.is_array() {
            log.add_error(Some(source), optional_peers.loc, b"Expected an array");
            return Err(ParseError::InvalidPackageInfo);
        }

        for item in optional_peers
            .data
            .e_array()
            .expect("infallible: variant checked")
            .items
            .slice()
        {
            let Some(name_hash) = item.as_string_hash_utf8(StringBuilder::string_hash)? else {
                log.add_error(Some(source), item.loc, b"Expected a string");
                return Err(ParseError::InvalidPackageInfo);
            };

            optional_peers_buf.insert(name_hash, ());
        }
    }

    let mut path_buf = if CHECK_FOR_BUNDLED {
        Some(PathBuffer::uninit())
    } else {
        None
    };

    let off = lockfile.buffers.dependencies.len();
    for &(group_name, group_behavior) in WORKSPACE_DEPENDENCY_GROUPS.iter() {
        // PERF(port): was `inline for` — profile in Phase B
        if let Some(deps) = obj.get(group_name.as_bytes()) {
            if !deps.is_object() {
                log.add_error(Some(source), deps.loc, b"Expected an object");
                return Err(ParseError::InvalidPackagesTree);
            }

            for prop in deps
                .data
                .e_object()
                .expect("infallible: variant checked")
                .properties
                .slice()
            {
                let key = prop.key.expect("infallible: prop has key");
                let value = prop.value.expect("infallible: prop has value");

                let Some(name_str) = key.as_utf8_string_literal() else {
                    log.add_error(Some(source), key.loc, b"Expected a string");
                    return Err(ParseError::InvalidDependencyName);
                };

                let name_hash = StringBuilder::string_hash(name_str);
                let name = sbuf!(lockfile).append_external_with_hash(name_str, name_hash)?;

                let Some(version_str) = value.as_utf8_string_literal() else {
                    log.add_error(Some(source), value.loc, b"Expected a string");
                    return Err(ParseError::InvalidDependencyVersion);
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
                        None => {
                            log.add_error(Some(source), value.loc, b"Invalid dependency version");
                            return Err(ParseError::InvalidDependencyVersion);
                        }
                    },
                    ..Default::default()
                };

                if CHECK_FOR_BUNDLED {
                    let pkg_path = pkg_path.expect("pkg_path required when CHECK_FOR_BUNDLED");
                    let bundled_pkgs =
                        bundled_pkgs.expect("bundled_pkgs required when CHECK_FOR_BUNDLED");
                    let path_buf = &mut path_buf.as_mut().unwrap()[..];
                    let bundled_location_len = pkg_path
                        .len()
                        .saturating_add(1)
                        .saturating_add(name_str.len());
                    if bundled_location_len > path_buf.len() {
                        log.add_error(
                            Some(source),
                            key.loc,
                            b"Package path and dependency name too long",
                        );
                        return Err(ParseError::InvalidPackageKey);
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

    if IS_ROOT {
        let workspaces_obj = workspaces_obj.expect("workspaces_obj required when IS_ROOT");
        'workspaces: for workspace_path in lockfile.workspace_paths.values() {
            for prop in workspaces_obj
                .data
                .e_object()
                .expect("infallible: variant checked")
                .properties
                .slice()
            {
                let key = prop.key.expect("infallible: prop has key");
                let value = prop.value.expect("infallible: prop has value");
                let path = key
                    .as_utf8_string_literal()
                    .expect("infallible: is_string checked");
                if !strings::eql_long(
                    path,
                    workspace_path.slice(lockfile.buffers.string_bytes.as_slice()),
                    true,
                ) {
                    continue;
                }

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
                            workspace: sbuf!(lockfile).append(path)?,
                        },
                        literal: String::default(),
                    },
                };

                // after parseAppendDependencies has been called for each package the
                // size of lockfile.buffers.resolutions is set to the length of dependencies
                // and values set to invalid_package_id before mapping.
                lockfile.buffers.dependencies.push(dep);
                continue 'workspaces;
            }
        }
    }

    let end = lockfile.buffers.dependencies.len();

    {
        let bytes = lockfile.buffers.string_bytes.as_slice();
        // Zig: `std.sort.pdq(..., Dependency.isLessThan)`. `slice::sort_by` is
        // also pattern-defeating quicksort; `Dependency::cmp` is the
        // total-order form of `isLessThan` (behavior group, then name ASC).
        lockfile.buffers.dependencies[off..].sort_by(|a, b| Dependency::cmp(bytes, a, b));
    }

    optional_peers_buf.clear();

    Ok((
        u32::try_from(off).expect("int cast"),
        u32::try_from(end - off).expect("int cast"),
    ))
}

// ported from: src/install/lockfile/bun.lock.zig
