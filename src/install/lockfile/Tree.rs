use core::fmt::Display;
use core::marker::ConstParamTy;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, DynamicBitSet, MultiArrayList};
use bun_core::Output;
use bun_core::ZStr;
use bun_paths::{self, MAX_PATH_BYTES, PathBuffer, SEP};
use bun_semver::String as SemverString;

use crate::external_slice::ExternalSlice;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{DepSorter, DependencyIDList, DependencyIDSlice, Lockfile};
use crate::package_manager::{PackageManager, WorkspaceFilter};
use crate::{
    Dependency, DependencyID, PackageID, PackageNameHash, Resolution, invalid_dependency_id,
    invalid_package_id,
};

// ──────────────────────────────────────────────────────────────────────────
// Tree
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: `#[repr(C)]` pins field order to declaration order so the raw
// in-memory bytes match the `[u8; 20]` `External` encoding read by
// `Buffers::load` (which decodes via `to_tree` assuming
// id|dep_id|parent|off|len). Under `repr(Rust)` rustc may reorder fields and
// the binary lockfile round-trip silently corrupts `dependencies`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Tree {
    pub id: Id,

    // Should not be used for anything other than name
    // through `folder_name()`. There is no guarantee a dependency
    // id chosen for a tree node is the same behavior or has the
    // same version literal for packages hoisted.
    pub dependency_id: DependencyID,

    pub parent: Id,
    pub dependencies: DependencyIDSlice,
}

impl Default for Tree {
    fn default() -> Self {
        Self {
            id: INVALID_ID,
            dependency_id: invalid_dependency_id,
            parent: INVALID_ID,
            dependencies: DependencyIDSlice::default(),
        }
    }
}

pub type Id = u32;

pub const EXTERNAL_SIZE: usize = core::mem::size_of::<Id>()
    + core::mem::size_of::<PackageID>()
    + core::mem::size_of::<Id>()
    + core::mem::size_of::<DependencyIDSlice>();

pub type External = [u8; EXTERNAL_SIZE];
pub type Slice = ExternalSlice<Tree>;
pub type List = Vec<Tree>;

pub const ROOT_DEP_ID: DependencyID = invalid_package_id - 1;
pub const INVALID_ID: Id = Id::MAX;

impl Tree {
    pub const INVALID_ID: Id = INVALID_ID;
    pub const ROOT_DEP_ID: DependencyID = ROOT_DEP_ID;
}

// max number of node_modules folders
pub const MAX_DEPTH: usize = (MAX_PATH_BYTES / b"node_modules".len()) + 1;

pub type DepthBuf = [Id; MAX_DEPTH];

/// Zig `var depth_buf: Tree.DepthBuf = undefined;` — write-only scratch buffer
/// for [`relative_path_and_depth`]. Every slot is written before it is read
/// (index 0 unconditionally, indices `1..depth_buf_len` in the parent-walk
/// loop), so leaving the ~1.4 KB array uninitialised matches the spec and
/// avoids a `memset` per tree in the `--frozen-lockfile` no-change path.
/// Same shape/contract as [`bun_core::PathBuffer::uninit`].
#[inline]
#[allow(invalid_value, clippy::uninit_assumed_init)]
pub fn depth_buf_uninit() -> DepthBuf {
    // SAFETY: `DepthBuf` is `[u32; N]`; every bit pattern is a valid `u32`.
    // Callers treat this as a write-only scratch buffer — no element is read
    // before being assigned by `relative_path_and_depth`.
    unsafe { core::mem::MaybeUninit::uninit().assume_init() }
}

impl Tree {
    pub fn folder_name<'b>(&self, deps: &'b [Dependency], buf: &'b [u8]) -> &'b [u8] {
        let dep_id = self.dependency_id;
        if dep_id == invalid_dependency_id {
            return b"";
        }
        deps[dep_id as usize].name.slice(buf)
    }

    pub fn to_external(self) -> External {
        let mut out: External = [0u8; EXTERNAL_SIZE];
        out[0..4].copy_from_slice(&self.id.to_ne_bytes());
        out[4..8].copy_from_slice(&self.dependency_id.to_ne_bytes());
        out[8..12].copy_from_slice(&self.parent.to_ne_bytes());
        out[12..16].copy_from_slice(&self.dependencies.off.to_ne_bytes());
        out[16..20].copy_from_slice(&self.dependencies.len.to_ne_bytes());
        const _: () = assert!(EXTERNAL_SIZE == 20, "Tree.External is not 20 bytes");
        const _: () = assert!(
            core::mem::size_of::<Tree>() == EXTERNAL_SIZE,
            "Tree in-memory layout must match External encoding"
        );
        out
    }

    pub fn to_tree(out: External) -> Tree {
        Tree {
            id: u32::from_ne_bytes(out[0..4].try_into().expect("infallible: size matches")),
            dependency_id: u32::from_ne_bytes(
                out[4..8].try_into().expect("infallible: size matches"),
            ),
            parent: u32::from_ne_bytes(out[8..12].try_into().expect("infallible: size matches")),
            dependencies: DependencyIDSlice::new(
                u32::from_ne_bytes(out[12..16].try_into().expect("infallible: size matches")),
                u32::from_ne_bytes(out[16..20].try_into().expect("infallible: size matches")),
            ),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HoistDependencyResult
// ──────────────────────────────────────────────────────────────────────────

pub enum HoistDependencyResult {
    DependencyLoop,
    Hoisted,
    Resolve(PackageID),
    ResolveReplace(ResolveReplace),
    ResolveLater,
    Placement(Placement),
}

pub struct ResolveReplace {
    pub id: Id,
    pub dep_id: DependencyID,
}

pub struct Placement {
    pub id: Id,
    pub bundled: bool,
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            id: 0,
            bundled: false,
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SubtreeError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("DependencyLoop")]
    DependencyLoop,
}

bun_core::oom_from_alloc!(SubtreeError);

bun_core::named_error_set!(SubtreeError);

// ──────────────────────────────────────────────────────────────────────────
// Iterator
// ──────────────────────────────────────────────────────────────────────────

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
pub enum IteratorPathStyle {
    /// `relative_path` will have the form `node_modules/jquery/node_modules/zod`.
    /// Path separators are platform.
    NodeModules,
    /// `relative_path` will have the form `jquery/zod`. Path separators are always
    /// posix separators.
    PkgPath,
}

// PORT NOTE: reshaped — Zig stores `lockfile: *const Lockfile`; here we store
// the four buffer slices the iterator actually reads so callers from both
// `crate::lockfile` (stub) and `crate::lockfile_real` can drive the same
// iterator without a unified `Lockfile` type (reconciler-6).
pub struct Iterator<'a, const PATH_STYLE: IteratorPathStyle> {
    pub tree_id: Id,
    pub path_buf: PathBuffer,

    trees: &'a [Tree],
    hoisted_dependencies: &'a [DependencyID],
    dependencies: &'a [Dependency],
    string_bytes: &'a [u8],

    pub depth_stack: DepthBuf,
}

pub struct IteratorNext<'a> {
    pub relative_path: &'a ZStr,
    pub dependencies: &'a [DependencyID],
    pub tree_id: Id,

    /// depth of the node_modules folder in the tree
    ///
    ///            0 (./node_modules)
    ///           / \
    ///          1   1
    ///         /
    ///        2
    pub depth: usize,
}

impl<'a, const PATH_STYLE: IteratorPathStyle> Iterator<'a, PATH_STYLE> {
    pub fn init(lockfile: &'a Lockfile) -> Self {
        Self::from_slices(
            lockfile.buffers.trees.as_slice(),
            lockfile.buffers.hoisted_dependencies.as_slice(),
            lockfile.buffers.dependencies.as_slice(),
            lockfile.buffers.string_bytes.as_slice(),
        )
    }

    /// Construct from raw buffer slices. Used by `bun.lock.rs` so the iterator
    /// borrows only `buffers.{trees,hoisted_dependencies,dependencies,string_bytes}`,
    /// leaving the rest of `Lockfile` available for disjoint mutation while
    /// iterating.
    pub fn from_slices(
        trees: &'a [Tree],
        hoisted_dependencies: &'a [DependencyID],
        dependencies: &'a [Dependency],
        string_bytes: &'a [u8],
    ) -> Self {
        let mut iter = Self {
            tree_id: 0,
            trees,
            hoisted_dependencies,
            dependencies,
            string_bytes,
            path_buf: PathBuffer::uninit(),
            // Zig: `depth_stack: DepthBuf = undefined` (Tree.zig:94)
            depth_stack: depth_buf_uninit(),
        };
        if PATH_STYLE == IteratorPathStyle::NodeModules {
            iter.path_buf[0..b"node_modules".len()].copy_from_slice(b"node_modules");
        }
        iter
    }

    pub fn reset(&mut self) {
        self.tree_id = 0;
    }

    // TODO(port): Zig signature varies `completed_trees` type by `path_style` (void when .pkg_path).
    // Here we accept `Option<&mut DynamicBitSet>` unconditionally; callers with PkgPath must pass None.
    pub fn next(
        &mut self,
        completed_trees: Option<&mut DynamicBitSet>,
    ) -> Option<IteratorNext<'_>> {
        let trees = self.trees;

        if (self.tree_id as usize) >= trees.len() {
            return None;
        }

        // PORT NOTE: reshaped for borrowck — cannot mutably borrow completed_trees in loop while moved.
        let mut completed_trees = completed_trees;

        while trees[self.tree_id as usize].dependencies.len == 0 {
            if PATH_STYLE == IteratorPathStyle::NodeModules {
                if let Some(ct) = completed_trees.as_deref_mut() {
                    ct.set(self.tree_id as usize);
                }
            }
            self.tree_id += 1;
            if (self.tree_id as usize) >= trees.len() {
                return None;
            }
        }

        let current_tree_id = self.tree_id;
        let tree = trees[current_tree_id as usize];
        let tree_dependencies = tree.dependencies.get(self.hoisted_dependencies);

        let (relative_path, depth) = relative_path_and_depth::<PATH_STYLE>(
            trees,
            self.dependencies,
            self.string_bytes,
            current_tree_id,
            &mut self.path_buf,
            &mut self.depth_stack,
        );

        self.tree_id += 1;

        Some(IteratorNext {
            relative_path,
            dependencies: tree_dependencies,
            tree_id: current_tree_id,
            depth,
        })
    }
}

/// Returns relative path and the depth of the tree
// PORT NOTE: reshaped — Zig takes `*const Lockfile`; here we take the three
// buffer slices directly so callers from both `crate::lockfile` (stub) and
// `crate::lockfile_real` can use this without a shared `Lockfile` type.
pub fn relative_path_and_depth<'b, const PATH_STYLE: IteratorPathStyle>(
    trees: &[Tree],
    dependencies: &[Dependency],
    string_buf: &[u8],
    tree_id: Id,
    path_buf: &'b mut PathBuffer,
    depth_buf: &mut DepthBuf,
) -> (&'b ZStr, usize) {
    let mut depth: usize = 0;

    let tree = trees[tree_id as usize];

    let mut parent_id = tree.id;
    let mut path_written: usize = match PATH_STYLE {
        IteratorPathStyle::NodeModules => b"node_modules".len(),
        IteratorPathStyle::PkgPath => 0,
    };

    let path_too_long = || -> ! {
        Output::err_generic("Lockfile is malformed (dependency path is too long)", ());
        bun_core::Global::crash();
    };

    depth_buf[0] = 0;

    if tree.id > 0 {
        let buf = string_buf;
        let mut depth_buf_len: usize = 1;

        while parent_id > 0 && (parent_id as usize) < trees.len() {
            if depth_buf_len == MAX_DEPTH {
                path_buf[path_written] = 0;
                return (ZStr::from_buf(path_buf, path_written), 0);
            }
            depth_buf[depth_buf_len] = parent_id;
            parent_id = trees[parent_id as usize].parent;
            depth_buf_len += 1;
        }

        depth_buf_len -= 1;

        depth = depth_buf_len;
        while depth_buf_len > 0 {
            if PATH_STYLE == IteratorPathStyle::PkgPath {
                if depth_buf_len != depth {
                    if path_written + 1 >= MAX_PATH_BYTES {
                        path_too_long();
                    }
                    path_buf[path_written] = b'/';
                    path_written += 1;
                }
            } else {
                if path_written + 1 >= MAX_PATH_BYTES {
                    path_too_long();
                }
                path_buf[path_written] = SEP;
                path_written += 1;
            }

            let id = depth_buf[depth_buf_len];
            let name = trees[id as usize].folder_name(dependencies, buf);
            let name_end = match path_written.checked_add(name.len()) {
                Some(end) if end < MAX_PATH_BYTES => end,
                _ => path_too_long(),
            };
            path_buf[path_written..name_end].copy_from_slice(name);
            path_written = name_end;

            if PATH_STYLE == IteratorPathStyle::NodeModules {
                // Zig: std.fs.path.sep_str ++ "node_modules" (always 13 bytes)
                if path_written + b"/node_modules".len() >= MAX_PATH_BYTES {
                    path_too_long();
                }
                path_buf[path_written] = SEP;
                path_buf[path_written + 1..path_written + 1 + b"node_modules".len()]
                    .copy_from_slice(b"node_modules");
                path_written += b"/node_modules".len();
            }

            depth_buf_len -= 1;
        }
    }
    path_buf[path_written] = 0;
    let rel = ZStr::from_buf(path_buf, path_written);

    (rel, depth)
}

// ──────────────────────────────────────────────────────────────────────────
// Builder
// ──────────────────────────────────────────────────────────────────────────

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
pub enum BuilderMethod {
    /// Hoist, but include every dependency so it's resolvable if configuration
    /// changes. For saving to disk.
    Resolvable,

    /// This will filter out disabled dependencies, resulting in more aggresive
    /// hoisting compared to `.resolvable`. We skip dependencies based on 'os', 'cpu',
    /// 'libc' (TODO), and omitted dependency types (`--omit=dev/peer/optional`).
    /// Dependencies of a disabled package are not included in the output.
    Filter,
}

// TODO(port): Zig conditionally typed `manager`/`workspace_filters`/`install_root_dependencies`/
// `packages_to_install` as `void` when method != .filter. Rust const generics cannot vary field
// types; using Option<_>/empty defaults instead. Phase B may split into two structs or use a
// trait-associated type if the size matters.
pub struct Builder<'a, const METHOD: BuilderMethod> {
    // PORT NOTE: Zig `std.mem.Allocator` param field dropped. Sole construction site is
    // `Lockfile.hoist()` (src/install/lockfile.zig) which passes `lockfile.allocator` — the
    // lockfile's persistent allocator (bun.default_allocator via PackageManager/CLI ctx), not an
    // arena. Global mimalloc is correct here; no `&'bump Bump` threading needed.
    pub list: MultiArrayList<BuilderEntry>,
    pub resolutions: &'a mut [PackageID],
    pub dependencies: &'a [Dependency],
    pub resolution_lists: &'a [DependencyIDSlice],
    pub queue: TreeFiller,
    pub log: &'a mut bun_ast::Log,
    /// PORT NOTE: Zig stores `*Lockfile` alongside `&mut buffers.resolutions`
    /// (an aliased subslice of the same struct). Stored as `ParentRef` (raw
    /// non-null backref) so the construction site (`Lockfile::hoist`) can
    /// split-borrow `resolutions` mutably without borrowck rejecting the
    /// overlap; reads go through [`Builder::lockfile()`] which never touches
    /// `buffers.resolutions`.
    pub lockfile: bun_ptr::ParentRef<Lockfile>,
    // Unresolved optional peers that might resolve later. if they do we will want to assign
    // builder.resolutions[peer.dep_id] to the resolved pkg_id. A dependency ID set is used because there
    // can be multiple instances of the same package in the tree, so the same unresolved dependency ID
    // could be visited multiple times before it's resolved.
    pub pending_optional_peers: ArrayHashMap<PackageNameHash, ArrayHashMap<DependencyID, ()>>,
    pub manager: Option<&'a PackageManager>,
    pub sort_buf: Vec<DependencyID>,
    pub workspace_filters: &'a [WorkspaceFilter],
    pub install_root_dependencies: bool,
    pub packages_to_install: Option<&'a [PackageID]>,
}

pub struct BuilderEntry {
    pub tree: Tree,
    pub dependencies: DependencyIDList,
}

bun_collections::multi_array_columns! {
    pub trait BuilderEntryColumns for BuilderEntry {
        tree: Tree,
        dependencies: DependencyIDList,
    }
}

pub struct CleanResult {
    pub trees: Vec<Tree>,
    pub dep_ids: Vec<DependencyID>,
}

impl<'a, const METHOD: BuilderMethod> Builder<'a, METHOD> {
    /// Shared read-only view of the lockfile.
    ///
    /// `self.lockfile` is set from `&mut Lockfile` in `Lockfile::hoist`, which
    /// outlives this `Builder` for `'a`. The returned `&Lockfile` MUST NOT be
    /// used to read `buffers.resolutions` while `self.resolutions` (a `&mut`
    /// alias of that same buffer) is live — callers reach resolutions via
    /// `self.resolutions` only.
    ///
    /// Callers that need a `&Lockfile` detached from `&self` (so disjoint
    /// `&mut self.<field>` borrows can coexist) should copy the `ParentRef`
    /// out first: `let lf = builder.lockfile; lf.get()`.
    #[inline]
    pub fn lockfile(&self) -> &Lockfile {
        self.lockfile.get()
    }

    pub fn maybe_report_error(&mut self, args: core::fmt::Arguments<'_>) {
        // TODO(port): bun_ast::Log::add_error_fmt signature — allocator param dropped.
        let _ = self.log.add_error_fmt(None, bun_ast::Loc::EMPTY, args);
    }

    pub fn buf(&self) -> &[u8] {
        self.lockfile().buffers.string_bytes.as_slice()
    }

    pub fn package_name(&self, id: PackageID) -> bun_semver::string::Formatter<'_> {
        self.lockfile().packages.items_name()[id as usize]
            .fmt(self.lockfile().buffers.string_bytes.as_slice())
    }

    pub fn package_version(&self, id: PackageID) -> crate::resolution::Formatter<'_, u64> {
        self.lockfile().packages.items_resolution()[id as usize].fmt(
            self.lockfile().buffers.string_bytes.as_slice(),
            bun_core::fmt::PathSep::Auto,
        )
    }

    /// Flatten the multi-dimensional ArrayList of package IDs into a single easily serializable array
    pub fn clean(&mut self) -> Result<CleanResult, AllocError> {
        let mut total: u32 = 0;

        // TODO(port): Zig captured `list.bytes` raw pointer to reuse the MultiArrayList backing
        // allocation for the output `trees` slice. That optimization depends on MultiArrayList
        // internal layout. Porting the straightforward path (fresh Vec<Tree>) instead.
        // PERF(port): was MultiArrayList buffer reuse — profile in Phase B.
        let mut slice = self.list.to_owned_slice();
        let mut trees: Vec<Tree> = slice.items_tree().to_vec();
        let dependencies: &mut [DependencyIDList] = slice.items_dependencies_mut();

        for tree in &trees {
            total += tree.dependencies.len;
        }

        let mut dep_ids: DependencyIDList = Vec::with_capacity(total as usize);

        debug_assert_eq!(trees.len(), dependencies.len());
        for (tree, child) in trees.iter_mut().zip(dependencies.iter_mut()) {
            // `child` (Vec) drops at end of `slice` scope; explicit deinit removed.

            // PERF(port): `dep_ids` is pre-reserved to `total` (sum of all
            // `tree.dependencies.len: u32`), so `len()` is provably < 2^32.
            // Avoid the `try_from` panic-format path on this per-tree hot loop.
            let off: u32 = dep_ids.len() as u32;
            for &dep_id in child.iter() {
                let pkg_id = self.resolutions[dep_id as usize];
                if pkg_id == invalid_package_id {
                    // optional peers that never resolved
                    continue;
                }

                // PERF(port): was assume_capacity
                dep_ids.push(dep_id);
            }
            let len: u32 = dep_ids.len() as u32 - off;

            tree.dependencies.off = off;
            tree.dependencies.len = len;
        }

        // queue / sort_buf / pending_optional_peers freed by Drop; explicit deinit removed.
        // TODO(port): if Builder outlives clean(), explicitly clear these fields here.

        Ok(CleanResult { trees, dep_ids })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// is_filtered_dependency_or_workspace
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: reshaped — Zig reads `lockfile.buffers.resolutions[dep_id]` directly,
// but `Builder` holds a live `&mut [PackageID]` over that buffer (see `Builder.lockfile`
// safety contract), so callers must thread `resolutions` explicitly to avoid an
// aliasing read through the shared `&Lockfile`.
pub fn is_filtered_dependency_or_workspace(
    dep_id: DependencyID,
    parent_pkg_id: PackageID,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    manager: &PackageManager,
    lockfile: &Lockfile,
    resolutions: &[PackageID],
) -> bool {
    let pkg_id = resolutions[dep_id as usize];
    if (pkg_id as usize) >= lockfile.packages.len() {
        let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
        if dep.behavior.is_optional_peer() {
            return false;
        }
        return true;
    }

    let pkgs = lockfile.packages.slice();
    let pkg_names = pkgs.items_name();
    let pkg_metas = pkgs.items_meta();
    let pkg_resolutions = pkgs.items_resolution();

    let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
    let res = &pkg_resolutions[pkg_id as usize];
    let parent_res = &pkg_resolutions[parent_pkg_id as usize];

    if pkg_metas[pkg_id as usize].is_disabled(manager.options.cpu, manager.options.os) {
        if manager.options.log_level.is_verbose() {
            let meta = &pkg_metas[pkg_id as usize];
            let name = lockfile.str(&pkg_names[pkg_id as usize]);
            if !meta.os.is_match(manager.options.os) && !meta.arch.is_match(manager.options.cpu) {
                Output::pretty_errorln(format_args!(
                    "<d>Skip installing<r> <b>{}<r> <d>- cpu & os mismatch<r>",
                    bstr::BStr::new(name)
                ));
            } else if !meta.os.is_match(manager.options.os) {
                Output::pretty_errorln(format_args!(
                    "<d>Skip installing<r> <b>{}<r> <d>- os mismatch<r>",
                    bstr::BStr::new(name)
                ));
            } else if !meta.arch.is_match(manager.options.cpu) {
                Output::pretty_errorln(format_args!(
                    "<d>Skip installing<r> <b>{}<r> <d>- cpu mismatch<r>",
                    bstr::BStr::new(name)
                ));
            }
        }
        return true;
    }

    if dep.behavior.is_bundled() {
        return true;
    }

    let dep_features = match parent_res.tag {
        crate::resolution::Tag::Root
        | crate::resolution::Tag::Workspace
        | crate::resolution::Tag::Folder => manager.options.local_package_features,
        _ => manager.options.remote_package_features,
    };

    if !dep.behavior.is_enabled(dep_features) {
        return true;
    }

    // Filtering only applies to the root package dependencies. Also
    // --filter has a different meaning if a new package is being installed.
    if manager.subcommand != crate::package_manager::Subcommand::Install || parent_pkg_id != 0 {
        return false;
    }

    if !dep.behavior.is_workspace() {
        if !install_root_dependencies {
            return true;
        }

        return false;
    }

    let mut workspace_matched = workspace_filters.is_empty();

    for filter in workspace_filters {
        // bun.AbsPath(.{ .sep = .posix }) — separator is a const generic on `bun_paths::AbsPath`.
        let mut filter_path = bun_paths::AbsPath::<
            u8,
            { bun_paths::path_options::PathSeparators::POSIX },
        >::init_top_level_dir();
        // filter_path drops at end of iteration.

        let (pattern, name_or_path): (&[u8], &[u8]) = match filter {
            WorkspaceFilter::All => {
                workspace_matched = true;
                continue;
            }
            WorkspaceFilter::Name(name_pattern) => (
                name_pattern,
                pkg_names[pkg_id as usize].slice(lockfile.buffers.string_bytes.as_slice()),
            ),
            WorkspaceFilter::Path(path_pattern) => 'path_pattern: {
                if res.tag != crate::resolution::Tag::Workspace {
                    return false;
                }

                // path-buffer overflow unreachable for bounded inputs
                let _ = filter_path.join(&[res
                    .workspace()
                    .slice(lockfile.buffers.string_bytes.as_slice())]);

                break 'path_pattern (path_pattern, filter_path.slice());
            }
        };

        match bun_glob::r#match(pattern, name_or_path) {
            bun_glob::MatchResult::Match | bun_glob::MatchResult::NegateMatch => {
                workspace_matched = true;
            }

            bun_glob::MatchResult::NegateNoMatch => {
                // always skip if a pattern specifically says "!<name|path>"
                workspace_matched = false;
                break;
            }

            bun_glob::MatchResult::NoMatch => {
                // keep looking
            }
        }
    }

    !workspace_matched
}

// ──────────────────────────────────────────────────────────────────────────
// process_subtree / hoist_dependency
// ──────────────────────────────────────────────────────────────────────────

impl Tree {
    pub fn process_subtree<const METHOD: BuilderMethod>(
        &self,
        dependency_id: DependencyID,
        hoist_root_id: Id,
        builder: &mut Builder<'_, METHOD>,
    ) -> Result<(), SubtreeError> {
        let parent_pkg_id = match dependency_id {
            ROOT_DEP_ID => 0,
            id => builder.resolutions[id as usize],
        };
        let resolution_list = builder.resolution_lists[parent_pkg_id as usize];

        if resolution_list.len == 0 {
            return Ok(());
        }

        builder.list.append(BuilderEntry {
            tree: Tree {
                parent: self.id,
                id: builder.list.len() as Id, // @truncate
                dependency_id,
                dependencies: DependencyIDSlice::default(),
            },
            dependencies: DependencyIDList::default(),
        })?;

        // TODO(port): Zig kept long-lived mutable slices into `builder.list` (trees, dependency_lists)
        // alongside &mut builder. Reshaped to re-borrow per use to satisfy borrowck.
        // PORT NOTE: reshaped for borrowck.
        let next_id = (builder.list.len() - 1) as Id;

        // Copy the `ParentRef` out (it's `Copy`) so the resulting `&Lockfile`
        // is borrowed from a local, not `&builder` — subsequent `&mut builder`
        // field borrows in the loop body do not conflict.
        let lockfile_ref = builder.lockfile;
        let lockfile: &Lockfile = lockfile_ref.get();
        let pkgs = lockfile.packages.slice();
        let pkg_resolutions = pkgs.items_resolution();
        // PORT NOTE: reshaped for borrowck — copy the `&'a [Dependency]` out of
        // `builder` so `&dependencies[i]` does not keep `builder` borrowed.
        let dependencies: &[Dependency] = builder.dependencies;

        builder.sort_buf.clear();
        builder.sort_buf.reserve(resolution_list.len as usize);

        for dep_id in resolution_list.begin()..resolution_list.end() {
            // PERF(port): was assume_capacity. `resolution_list` bounds are u32
            // (`ExternalSlice<u32>`); the range value is already u32-ranged.
            builder.sort_buf.push(dep_id as u32);
        }

        {
            let sorter = DepSorter { lockfile };
            // PERF(port): Zig used std.sort.pdq; Rust slice::sort_unstable_by is also pdqsort.
            builder.sort_buf.sort_unstable_by(|a, b| {
                if DepSorter::is_less_than(&sorter, *a, *b) {
                    core::cmp::Ordering::Less
                } else if DepSorter::is_less_than(&sorter, *b, *a) {
                    core::cmp::Ordering::Greater
                } else {
                    core::cmp::Ordering::Equal
                }
            });
        }

        // PORT NOTE: reshaped for borrowck — iterate over a snapshot of sort_buf indices since
        // builder is mutably borrowed inside the loop.
        let sort_buf_len = builder.sort_buf.len();
        'dep: for sort_idx in 0..sort_buf_len {
            let dep_id = builder.sort_buf[sort_idx];
            let pkg_id = builder.resolutions[dep_id as usize];

            // filter out disabled dependencies
            if METHOD == BuilderMethod::Filter {
                if is_filtered_dependency_or_workspace(
                    dep_id,
                    parent_pkg_id,
                    builder.workspace_filters,
                    builder.install_root_dependencies,
                    builder.manager.expect("manager set when METHOD == Filter"),
                    lockfile,
                    &*builder.resolutions,
                ) {
                    continue;
                }

                // unresolved packages are skipped when filtering. they already had
                // their chance to resolve.
                if pkg_id == invalid_package_id {
                    continue;
                }

                if let Some(packages_to_install) = builder.packages_to_install {
                    if parent_pkg_id == 0 {
                        let mut found = false;
                        for &package_to_install in packages_to_install {
                            if pkg_id == package_to_install {
                                found = true;
                                break;
                            }
                        }

                        if !found {
                            continue;
                        }
                    }
                }
            }

            let dependency = &dependencies[dep_id as usize];

            let hoisted: HoistDependencyResult = 'hoisted: {
                // don't hoist if it's a folder dependency or a bundled dependency.
                if dependency.behavior.is_bundled() {
                    break 'hoisted HoistDependencyResult::Placement(Placement {
                        id: next_id,
                        bundled: true,
                    });
                }

                if pkg_id == invalid_package_id {
                    if dependency.behavior.is_optional_peer() {
                        break 'hoisted Tree::hoist_dependency::<true, METHOD>(
                            next_id,
                            hoist_root_id,
                            pkg_id,
                            dep_id,
                            builder,
                        )?;
                    }

                    // skip unresolvable dependencies
                    continue 'dep;
                }

                if pkg_resolutions[pkg_id as usize].tag == crate::resolution::Tag::Folder {
                    break 'hoisted HoistDependencyResult::Placement(Placement {
                        id: next_id,
                        bundled: false,
                    });
                }

                Tree::hoist_dependency::<true, METHOD>(
                    next_id,
                    hoist_root_id,
                    pkg_id,
                    dep_id,
                    builder,
                )?
            };

            match hoisted {
                HoistDependencyResult::DependencyLoop | HoistDependencyResult::Hoisted => continue,

                HoistDependencyResult::Resolve(res_id) => {
                    debug_assert!(pkg_id == invalid_package_id);
                    debug_assert!(res_id != invalid_package_id);
                    builder.resolutions[dep_id as usize] = res_id;
                    if cfg!(debug_assertions) {
                        debug_assert!(
                            !builder
                                .pending_optional_peers
                                .contains_key(&dependency.name_hash)
                        );
                    }

                    if let Some(entry) = builder
                        .pending_optional_peers
                        .fetch_swap_remove(&dependency.name_hash)
                    {
                        let peers = entry.1;
                        for &unresolved_dep_id in peers.keys() {
                            // the dependency should be either unresolved or the same dependency as above
                            debug_assert!(
                                unresolved_dep_id == dep_id
                                    || builder.resolutions[unresolved_dep_id as usize]
                                        == invalid_package_id
                            );
                            builder.resolutions[unresolved_dep_id as usize] = res_id;
                        }
                        // peers drops here
                    }
                }
                HoistDependencyResult::ResolveReplace(replace) => {
                    debug_assert!(pkg_id != invalid_package_id);
                    builder.resolutions[replace.dep_id as usize] = pkg_id;
                    if let Some(entry) = builder
                        .pending_optional_peers
                        .fetch_swap_remove(&dependency.name_hash)
                    {
                        let peers = entry.1;
                        for &unresolved_dep_id in peers.keys() {
                            // the dependency should be either unresolved or the same dependency as above
                            debug_assert!(
                                unresolved_dep_id == replace.dep_id
                                    || builder.resolutions[unresolved_dep_id as usize]
                                        == invalid_package_id
                            );
                            builder.resolutions[unresolved_dep_id as usize] = pkg_id;
                        }
                    }
                    {
                        let mut list_slice = builder.list.slice();
                        let dependency_lists = list_slice.items_dependencies_mut();
                        for placed_dep_id in dependency_lists[replace.id as usize].iter_mut() {
                            if *placed_dep_id == replace.dep_id {
                                *placed_dep_id = dep_id;
                            }
                        }
                    }
                    if pkg_id != invalid_package_id
                        && builder.resolution_lists[pkg_id as usize].len > 0
                    {
                        builder.queue.write_item(FillItem {
                            tree_id: replace.id,
                            dependency_id: dep_id,
                            hoist_root_id,
                        })?;
                    }
                }
                HoistDependencyResult::ResolveLater => {
                    // `dep_id` is an unresolved optional peer. while hoisting it deduplicated
                    // with another unresolved optional peer. save it so we remember resolve it
                    // later if it's possible to resolve it.
                    let entry = builder
                        .pending_optional_peers
                        .get_or_put(dependency.name_hash)?;
                    if !entry.found_existing {
                        *entry.value_ptr = ArrayHashMap::default();
                    }

                    entry.value_ptr.put(dep_id, ())?;
                }
                HoistDependencyResult::Placement(dest) => {
                    {
                        // PORT NOTE: reshaped for borrowck — Zig held both `items(.dependencies)`
                        // and `items(.tree)` mutably from one slice; here we go through ListExt
                        // accessors sequentially so the &mut borrows do not overlap.
                        // bun.handleOom -> push (aborts on OOM via global allocator)
                        builder.list.items_dependencies_mut()[dest.id as usize].push(dep_id);
                        builder.list.items_tree_mut()[dest.id as usize]
                            .dependencies
                            .len += 1;
                    }
                    if pkg_id != invalid_package_id
                        && builder.resolution_lists[pkg_id as usize].len > 0
                    {
                        builder.queue.write_item(FillItem {
                            tree_id: dest.id,
                            dependency_id: dep_id,

                            // if it's bundled, start a new hoist root
                            hoist_root_id: if dest.bundled { dest.id } else { hoist_root_id },
                        })?;
                    }
                }
            }
        }

        // PORT NOTE: reshaped for borrowck — re-read `next` via index.
        let next: Tree = builder.list.items_tree()[next_id as usize];
        if next.dependencies.len == 0 {
            if cfg!(debug_assertions) {
                debug_assert!(builder.list.len() == (next.id as usize) + 1);
            }
            let _ = builder.list.pop();
        }

        Ok(())
    }

    // This function does one of three things:
    // 1 (return hoisted) - de-duplicate (skip) the package
    // 2 (return id) - move the package to the top directory
    // 3 (return dependency_loop) - leave the package at the same (relative) directory
    //
    // PORT NOTE: reshaped for borrowck — Zig passed `&mut self` (an element of `trees`) plus
    // `trees: &mut [Tree]`, `dependency_lists: &mut [...]`, and `builder: &mut Builder`
    // simultaneously, which overlaps mutable borrows. The body never mutates `self`, `trees`,
    // or `dependency_lists`, so we take `self_id: Id` by value and re-derive read-only views
    // from `builder.list` on each access. `dependency` is passed by id and re-derived from
    // `builder.dependencies` (a `&'a [Dependency]` field, copied out so the borrow detaches
    // from `builder`). The only long-lived `&mut` is `builder`.
    fn hoist_dependency<const AS_DEFINED: bool, const METHOD: BuilderMethod>(
        self_id: Id,
        hoist_root_id: Id,
        package_id: PackageID,
        input_dep_id: DependencyID,
        builder: &mut Builder<'_, METHOD>,
    ) -> Result<HoistDependencyResult, SubtreeError> {
        // Copy the slice ref out of `builder` so subsequent `&mut builder` does not conflict.
        let deps: &[Dependency] = builder.dependencies;
        let dependency: &Dependency = &deps[input_dep_id as usize];

        // Tree is Copy — snapshot the fields we need so we don't hold a borrow of builder.list.
        let this: Tree = builder.list.items_tree()[self_id as usize];
        // Hoist the dep-id slice once (Zig: `this.dependencies.get(dependency_lists[this.id].items)`).
        // `builder.list` is not mutated for the duration of this loop (the recursive call happens
        // *after* it), so the slice is stable; detach to raw ptr/len so the loop body can freely
        // take `&builder` / `&mut builder.log` without borrowck re-deriving the view per iteration.
        let (this_deps_ptr, this_deps_len): (*const DependencyID, usize) = {
            let s = this
                .dependencies
                .get(builder.list.items_dependencies()[self_id as usize].as_slice());
            (s.as_ptr(), s.len())
        };
        // Keep the comparand in a register; `deps.get_unchecked` may alias `dependency`.
        let target_name_hash = dependency.name_hash;
        for i in 0..this_deps_len {
            // SAFETY: `i < this_deps_len` and `builder.list` is not mutated until after this loop
            // (see invariant above), so `this_deps_ptr[0..this_deps_len)` remains valid.
            let dep_id: DependencyID = unsafe { *this_deps_ptr.add(i) };
            // SAFETY: `dep_id` was produced by the same lockfile that produced `deps`;
            // Zig release builds have no bounds check here.
            let dep = unsafe { deps.get_unchecked(dep_id as usize) };
            if dep.name_hash != target_name_hash {
                continue;
            }

            let res_id = builder.resolutions[dep_id as usize];

            if res_id == invalid_package_id && package_id == invalid_package_id {
                debug_assert!(dep.behavior.is_optional_peer());
                debug_assert!(dependency.behavior.is_optional_peer());
                // both optional peers will need to be resolved if they can resolve later.
                // remember input package_id and dependency for later
                return Ok(HoistDependencyResult::ResolveLater);
            }

            if res_id == invalid_package_id {
                debug_assert!(dep.behavior.is_optional_peer());
                return Ok(HoistDependencyResult::ResolveReplace(ResolveReplace {
                    id: this.id,
                    dep_id,
                }));
            }

            if package_id == invalid_package_id {
                debug_assert!(dependency.behavior.is_optional_peer());
                debug_assert!(res_id != invalid_package_id);
                // resolve optional peer to `builder.resolutions[dep_id]`
                return Ok(HoistDependencyResult::Resolve(res_id)); // 1
            }

            if res_id == package_id {
                // this dependency is the same package as the other, hoist
                return Ok(HoistDependencyResult::Hoisted); // 1
            }

            if AS_DEFINED {
                if dep.behavior.is_dev() != dependency.behavior.is_dev() {
                    // will only happen in workspaces and root package because
                    // dev dependencies won't be included in other types of
                    // dependencies
                    return Ok(HoistDependencyResult::Hoisted); // 1
                }
            }

            // now we either keep the dependency at this place in the tree,
            // or hoist if peer version allows it

            if dependency.behavior.is_peer() {
                if dependency.version.tag == crate::dependency::VersionTag::Npm {
                    let resolution: Resolution =
                        builder.lockfile().packages.items_resolution()[res_id as usize];
                    let version = &dependency.version.npm().version;
                    if resolution.tag == crate::resolution::Tag::Npm
                        && version.satisfies(resolution.npm().version, builder.buf(), builder.buf())
                    {
                        return Ok(HoistDependencyResult::Hoisted); // 1
                    }
                }

                // Root dependencies are manually chosen by the user. Allow them
                // to hoist other peers even if they don't satisfy the version
                if builder.lockfile().is_workspace_root_dependency(dep_id) {
                    // TODO: warning about peer dependency version mismatch
                    return Ok(HoistDependencyResult::Hoisted); // 1
                }
            }

            if AS_DEFINED && !dep.behavior.is_peer() {
                // PORT NOTE: reshaped for borrowck — `maybe_report_error` takes
                // `&mut self` but the format args borrow `&self` (via
                // `package_name`/`package_version`/`buf`). Inline against split
                // field borrows: copy the `ParentRef` out so the `&Lockfile` is
                // not tied to `&builder`, then write to `builder.log`.
                let lockfile_ref = builder.lockfile;
                let lockfile: &Lockfile = lockfile_ref.get();
                let buf = lockfile.buffers.string_bytes.as_slice();
                let names = lockfile.packages.items_name();
                let resolutions = lockfile.packages.items_resolution();
                let _ = builder.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Package \"{}@{}\" has a dependency loop\n  Resolution: \"{}@{}\"\n  Dependency: \"{}@{}\"",
                        names[package_id as usize].fmt(buf),
                        resolutions[package_id as usize].fmt(buf, bun_core::fmt::PathSep::Auto),
                        names[res_id as usize].fmt(buf),
                        resolutions[res_id as usize].fmt(buf, bun_core::fmt::PathSep::Auto),
                        dependency.name.fmt(buf),
                        dependency.version.literal.fmt(buf),
                    ),
                );
                return Err(SubtreeError::DependencyLoop);
            }

            return Ok(HoistDependencyResult::DependencyLoop); // 3
        }

        // this dependency was not found in this tree, try hoisting or placing in the next parent
        if this.parent != INVALID_ID && this.id != hoist_root_id {
            let id = match Tree::hoist_dependency::<false, METHOD>(
                this.parent,
                hoist_root_id,
                package_id,
                input_dep_id,
                builder,
            ) {
                Ok(id) => id,
                // SAFETY: `hoist_dependency::<false, _>` never returns `Err` —
                // the only `Err(SubtreeError::DependencyLoop)` site above is
                // gated on `AS_DEFINED`. Avoids faulting panic-format pages on
                // the per-dependency recursion.
                Err(_) => unsafe { core::hint::unreachable_unchecked() },
            };
            if !AS_DEFINED || !matches!(id, HoistDependencyResult::DependencyLoop) {
                return Ok(id); // 1 or 2
            }
        }

        // place the dependency in the current tree
        Ok(HoistDependencyResult::Placement(Placement {
            id: this.id,
            bundled: false,
        })) // 2
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FillItem / TreeFiller
// ──────────────────────────────────────────────────────────────────────────

pub struct FillItem {
    pub tree_id: Id,
    pub dependency_id: DependencyID,

    /// If valid, dependencies will not hoist
    /// beyond this tree if they're in a subtree
    pub hoist_root_id: Id,
}

// bun.LinearFifo(FillItem, .Dynamic) — std.fifo.LinearFifo wrapper.
// Mapped to bun_collections::LinearFifo<T, DynamicBuffer<T>> (dynamic, heap-backed ring buffer).
pub type TreeFiller =
    bun_collections::LinearFifo<FillItem, bun_collections::linear_fifo::DynamicBuffer<FillItem>>;

// ported from: src/install/lockfile/Tree.zig
