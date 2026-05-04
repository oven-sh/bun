use core::marker::ConstParamTy;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, DynamicBitSet, MultiArrayList};
use bun_core::Output;
use bun_logger as logger;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES, SEP};
use bun_semver::String as SemverString;
use bun_str::ZStr;

use crate::lockfile::{
    DependencyIDList, DependencyIDSlice, DepSorter, ExternalSlice, Lockfile,
};
use crate::{
    invalid_dependency_id, invalid_package_id, Dependency, DependencyID, PackageID,
    PackageNameHash, Resolution,
};
use crate::package_manager::{PackageManager, WorkspaceFilter};

// ──────────────────────────────────────────────────────────────────────────
// Tree
// ──────────────────────────────────────────────────────────────────────────

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

// max number of node_modules folders
pub const MAX_DEPTH: usize = (MAX_PATH_BYTES / b"node_modules".len()) + 1;

pub type DepthBuf = [Id; MAX_DEPTH];

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
        out
    }

    pub fn to_tree(out: External) -> Tree {
        Tree {
            id: u32::from_ne_bytes(out[0..4].try_into().unwrap()),
            dependency_id: u32::from_ne_bytes(out[4..8].try_into().unwrap()),
            parent: u32::from_ne_bytes(out[8..12].try_into().unwrap()),
            dependencies: DependencyIDSlice {
                off: u32::from_ne_bytes(out[12..16].try_into().unwrap()),
                len: u32::from_ne_bytes(out[16..20].try_into().unwrap()),
            },
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
        Self { id: 0, bundled: false }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SubtreeError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("DependencyLoop")]
    DependencyLoop,
}

impl From<AllocError> for SubtreeError {
    fn from(_: AllocError) -> Self {
        SubtreeError::OutOfMemory
    }
}

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

pub struct Iterator<'a, const PATH_STYLE: IteratorPathStyle> {
    pub tree_id: Id,
    pub path_buf: PathBuffer,

    pub lockfile: &'a Lockfile,

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
        let mut iter = Self {
            tree_id: 0,
            lockfile,
            path_buf: PathBuffer::uninit(),
            depth_stack: [0; MAX_DEPTH],
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
        let trees = self.lockfile.buffers.trees.as_slice();

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
        let tree_dependencies = tree
            .dependencies
            .get(self.lockfile.buffers.hoisted_dependencies.as_slice());

        let (relative_path, depth) = relative_path_and_depth::<PATH_STYLE>(
            self.lockfile,
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
pub fn relative_path_and_depth<'b, const PATH_STYLE: IteratorPathStyle>(
    lockfile: &Lockfile,
    tree_id: Id,
    path_buf: &'b mut PathBuffer,
    depth_buf: &mut DepthBuf,
) -> (&'b ZStr, usize) {
    let trees = lockfile.buffers.trees.as_slice();
    let mut depth: usize = 0;

    let tree = trees[tree_id as usize];

    let mut parent_id = tree.id;
    let mut path_written: usize = match PATH_STYLE {
        IteratorPathStyle::NodeModules => b"node_modules".len(),
        IteratorPathStyle::PkgPath => 0,
    };

    depth_buf[0] = 0;

    if tree.id > 0 {
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let buf = lockfile.buffers.string_bytes.as_slice();
        let mut depth_buf_len: usize = 1;

        while parent_id > 0 && (parent_id as usize) < trees.len() {
            depth_buf[depth_buf_len] = parent_id;
            parent_id = trees[parent_id as usize].parent;
            depth_buf_len += 1;
        }

        depth_buf_len -= 1;

        depth = depth_buf_len;
        while depth_buf_len > 0 {
            if PATH_STYLE == IteratorPathStyle::PkgPath {
                if depth_buf_len != depth {
                    path_buf[path_written] = b'/';
                    path_written += 1;
                }
            } else {
                path_buf[path_written] = SEP;
                path_written += 1;
            }

            let id = depth_buf[depth_buf_len];
            let name = trees[id as usize].folder_name(dependencies, buf);
            path_buf[path_written..path_written + name.len()].copy_from_slice(name);
            path_written += name.len();

            if PATH_STYLE == IteratorPathStyle::NodeModules {
                // Zig: std.fs.path.sep_str ++ "node_modules" (always 13 bytes)
                path_buf[path_written] = SEP;
                path_buf[path_written + 1..path_written + 1 + b"node_modules".len()]
                    .copy_from_slice(b"node_modules");
                path_written += b"/node_modules".len();
            }

            depth_buf_len -= 1;
        }
    }
    path_buf[path_written] = 0;
    // SAFETY: path_buf[path_written] == 0 written immediately above.
    let rel = unsafe { ZStr::from_raw(path_buf.as_ptr(), path_written) };

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
    // PORT NOTE: Zig `allocator: Allocator` field dropped. Sole construction site is
    // `Lockfile.hoist()` (src/install/lockfile.zig) which passes `lockfile.allocator` — the
    // lockfile's persistent allocator (bun.default_allocator via PackageManager/CLI ctx), not an
    // arena. Global mimalloc is correct here; no `&'bump Bump` threading needed.
    pub list: MultiArrayList<BuilderEntry>,
    pub resolutions: &'a mut [PackageID],
    pub dependencies: &'a [Dependency],
    pub resolution_lists: &'a [DependencyIDSlice],
    pub queue: TreeFiller,
    pub log: &'a mut logger::Log,
    pub lockfile: &'a Lockfile,
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

pub struct CleanResult {
    pub trees: Vec<Tree>,
    pub dep_ids: Vec<DependencyID>,
}

impl<'a, const METHOD: BuilderMethod> Builder<'a, METHOD> {
    pub fn maybe_report_error(&mut self, args: core::fmt::Arguments<'_>) {
        // TODO(port): logger::Log::add_error_fmt signature — allocator param dropped.
        let _ = self.log.add_error_fmt(None, logger::Loc::EMPTY, args);
    }

    pub fn buf(&self) -> &[u8] {
        self.lockfile.buffers.string_bytes.as_slice()
    }

    pub fn package_name(&self, id: PackageID) -> bun_semver::StringFmt<'_> {
        // TODO(port): MultiArrayList column accessor (`packages.items(.name)`) — exact API TBD in bun_collections.
        self.lockfile.packages.items_name()[id as usize]
            .fmt(self.lockfile.buffers.string_bytes.as_slice())
    }

    pub fn package_version(&self, id: PackageID) -> crate::ResolutionFmt<'_> {
        // TODO(port): MultiArrayList column accessor (`packages.items(.resolution)`).
        self.lockfile.packages.items_resolution()[id as usize].fmt(
            self.lockfile.buffers.string_bytes.as_slice(),
            crate::resolution::FmtMode::Auto,
        )
    }

    /// Flatten the multi-dimensional ArrayList of package IDs into a single easily serializable array
    pub fn clean(&mut self) -> Result<CleanResult, AllocError> {
        let mut total: u32 = 0;

        // TODO(port): Zig captured `list.bytes` raw pointer to reuse the MultiArrayList backing
        // allocation for the output `trees` slice. That optimization depends on MultiArrayList
        // internal layout. Porting the straightforward path (fresh Vec<Tree>) instead.
        // PERF(port): was MultiArrayList buffer reuse — profile in Phase B.
        let slice = self.list.to_owned_slice();
        let mut trees: Vec<Tree> = slice.items_tree().to_vec();
        let dependencies = slice.items_dependencies_mut();

        for tree in &trees {
            total += tree.dependencies.len;
        }

        let mut dep_ids: DependencyIDList = Vec::with_capacity(total as usize);

        debug_assert_eq!(trees.len(), dependencies.len());
        for (tree, child) in trees.iter_mut().zip(dependencies.iter_mut()) {
            // `child` (Vec) drops at end of `slice` scope; explicit deinit removed.

            let off: u32 = u32::try_from(dep_ids.len()).unwrap();
            for &dep_id in child.iter() {
                let pkg_id = self.lockfile.buffers.resolutions.as_slice()[dep_id as usize];
                if pkg_id == invalid_package_id {
                    // optional peers that never resolved
                    continue;
                }

                // PERF(port): was assume_capacity
                dep_ids.push(dep_id);
            }
            let len: u32 = u32::try_from(dep_ids.len() - off as usize).unwrap();

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

pub fn is_filtered_dependency_or_workspace(
    dep_id: DependencyID,
    parent_pkg_id: PackageID,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    manager: &PackageManager,
    lockfile: &Lockfile,
) -> bool {
    let pkg_id = lockfile.buffers.resolutions.as_slice()[dep_id as usize];
    if (pkg_id as usize) >= lockfile.packages.len() {
        let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
        if dep.behavior.is_optional_peer() {
            return false;
        }
        return true;
    }

    let pkgs = lockfile.packages.slice();
    // TODO(port): MultiArrayList column accessors.
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
        // TODO(port): bun.AbsPath(.{ .sep = .posix }) — exact Rust type/API TBD in bun_paths.
        let mut filter_path = bun_paths::AbsPath::init_top_level_dir(bun_paths::Sep::Posix);
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

                filter_path.join(&[res
                    .value
                    .workspace
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

        let pkgs = builder.lockfile.packages.slice();
        let pkg_resolutions = pkgs.items_resolution();

        builder.sort_buf.clear();
        builder
            .sort_buf
            .reserve(resolution_list.len as usize);

        for dep_id in resolution_list.begin()..resolution_list.end() {
            // PERF(port): was assume_capacity
            builder.sort_buf.push(u32::try_from(dep_id).unwrap());
        }

        {
            let sorter = DepSorter { lockfile: builder.lockfile };
            // PERF(port): Zig used std.sort.pdq; Rust slice::sort_unstable_by is also pdqsort.
            builder
                .sort_buf
                .sort_unstable_by(|a, b| {
                    if DepSorter::is_less_than(&sorter, *a, *b) {
                        core::cmp::Ordering::Less
                    } else {
                        core::cmp::Ordering::Greater
                    }
                });
        }

        // PORT NOTE: reshaped for borrowck — iterate over a snapshot of sort_buf indices since
        // builder is mutably borrowed inside the loop.
        let sort_buf_len = builder.sort_buf.len();
        for sort_idx in 0..sort_buf_len {
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
                    builder.lockfile,
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

            let dependency = builder.dependencies[dep_id as usize];

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
                        // PORT NOTE: reshaped for borrowck — re-borrow list slices for hoist call.
                        let list_slice = builder.list.slice();
                        let trees = list_slice.items_tree_mut();
                        let dependency_lists = list_slice.items_dependencies_mut();
                        break 'hoisted trees[next_id as usize].hoist_dependency::<true, METHOD>(
                            hoist_root_id,
                            pkg_id,
                            &dependency,
                            dependency_lists,
                            trees,
                            builder,
                        )?;
                    }

                    // skip unresolvable dependencies
                    continue;
                }

                if pkg_resolutions[pkg_id as usize].tag == crate::resolution::Tag::Folder {
                    break 'hoisted HoistDependencyResult::Placement(Placement {
                        id: next_id,
                        bundled: false,
                    });
                }

                let list_slice = builder.list.slice();
                let trees = list_slice.items_tree_mut();
                let dependency_lists = list_slice.items_dependencies_mut();
                trees[next_id as usize].hoist_dependency::<true, METHOD>(
                    hoist_root_id,
                    pkg_id,
                    &dependency,
                    dependency_lists,
                    trees,
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
                        debug_assert!(!builder.pending_optional_peers.contains_key(&dependency.name_hash));
                    }

                    if let Some(entry) =
                        builder.pending_optional_peers.swap_remove(&dependency.name_hash)
                    {
                        let peers = entry;
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
                    if let Some(entry) =
                        builder.pending_optional_peers.swap_remove(&dependency.name_hash)
                    {
                        let peers = entry;
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
                        let list_slice = builder.list.slice();
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
                        let list_slice = builder.list.slice();
                        let dependency_lists = list_slice.items_dependencies_mut();
                        let trees = list_slice.items_tree_mut();
                        // bun.handleOom -> push (aborts on OOM via global allocator)
                        dependency_lists[dest.id as usize].push(dep_id);
                        trees[dest.id as usize].dependencies.len += 1;
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
        let list_slice = builder.list.slice();
        let trees = list_slice.items_tree();
        let next = &trees[next_id as usize];
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
    // TODO(port): borrowck — Zig passes `&mut self` (an element of `trees`) plus `trees: &mut [Tree]`
    // and `builder: &mut Builder` simultaneously. This overlaps mutable borrows. Phase B will need
    // to either pass `self_id: Id` and index into `trees`, or restructure with raw pointers.
    fn hoist_dependency<const AS_DEFINED: bool, const METHOD: BuilderMethod>(
        &mut self,
        hoist_root_id: Id,
        package_id: PackageID,
        dependency: &Dependency,
        dependency_lists: &mut [DependencyIDList],
        trees: &mut [Tree],
        builder: &mut Builder<'_, METHOD>,
    ) -> Result<HoistDependencyResult, SubtreeError> {
        // TODO(port): narrow error set
        let this_dependencies = self
            .dependencies
            .get(dependency_lists[self.id as usize].as_slice());
        for i in 0..this_dependencies.len() {
            let dep_id = this_dependencies[i];
            let dep = &builder.dependencies[dep_id as usize];
            if dep.name_hash != dependency.name_hash {
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
                    id: self.id,
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
                        builder.lockfile.packages.items_resolution()[res_id as usize];
                    let version = &dependency.version.value.npm.version;
                    if resolution.tag == crate::resolution::Tag::Npm
                        && version.satisfies(
                            &resolution.value.npm.version,
                            builder.buf(),
                            builder.buf(),
                        )
                    {
                        return Ok(HoistDependencyResult::Hoisted); // 1
                    }
                }

                // Root dependencies are manually chosen by the user. Allow them
                // to hoist other peers even if they don't satisfy the version
                if builder.lockfile.is_workspace_root_dependency(dep_id) {
                    // TODO: warning about peer dependency version mismatch
                    return Ok(HoistDependencyResult::Hoisted); // 1
                }
            }

            if AS_DEFINED && !dep.behavior.is_peer() {
                builder.maybe_report_error(format_args!(
                    "Package \"{}@{}\" has a dependency loop\n  Resolution: \"{}@{}\"\n  Dependency: \"{}@{}\"",
                    builder.package_name(package_id),
                    builder.package_version(package_id),
                    builder.package_name(res_id),
                    builder.package_version(res_id),
                    dependency.name.fmt(builder.buf()),
                    dependency.version.literal.fmt(builder.buf()),
                ));
                return Err(SubtreeError::DependencyLoop);
            }

            return Ok(HoistDependencyResult::DependencyLoop); // 3
        }

        // this dependency was not found in this tree, try hoisting or placing in the next parent
        if self.parent != INVALID_ID && self.id != hoist_root_id {
            let id = trees[self.parent as usize]
                .hoist_dependency::<false, METHOD>(
                    hoist_root_id,
                    package_id,
                    dependency,
                    dependency_lists,
                    trees,
                    builder,
                )
                .expect("unreachable");
            if !AS_DEFINED || !matches!(id, HoistDependencyResult::DependencyLoop) {
                return Ok(id); // 1 or 2
            }
        }

        // place the dependency in the current tree
        Ok(HoistDependencyResult::Placement(Placement {
            id: self.id,
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

// TODO(port): bun.LinearFifo(FillItem, .Dynamic) — std.fifo.LinearFifo wrapper.
// Mapped to bun_collections::LinearFifo<T> (dynamic, heap-backed ring buffer).
pub type TreeFiller = bun_collections::LinearFifo<FillItem>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/Tree.zig (813 lines)
//   confidence: medium
//   todos:      12
//   notes:      Builder/hoist_dependency need borrowck restructuring (overlapping &mut on trees/dependency_lists/builder); MultiArrayList column accessors + LinearFifo + AbsPath APIs are speculative; conditional void fields collapsed to Option.
// ──────────────────────────────────────────────────────────────────────────
