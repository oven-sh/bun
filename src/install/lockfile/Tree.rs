use core::fmt::Write as _;
use core::marker::ConstParamTy;
use core::mem::MaybeUninit;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, DynamicBitSet, MultiArrayList, index_sort};
use bun_core::ZStr;
use bun_core::fmt::PathSep;
use bun_core::{Output, UnwrapOrOom as _};
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP};

use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{
    DepSorter, DependencyIDList, DependencyIDSlice, Lockfile, bun_lock, pruned_workspaces,
    reachable,
};
use crate::package_manager::{PackageManager, WorkspaceFilter};
use crate::{
    Dependency, DependencyID, PackageID, PackageNameHash, Resolution, invalid_dependency_id,
    invalid_package_id,
};

// ──────────────────────────────────────────────────────────────────────────
// Tree
// ──────────────────────────────────────────────────────────────────────────

// `#[repr(C)]` pins field order to declaration order so the raw
// in-memory bytes match the `[u8; 20]` `External` encoding read by
// `Buffers::load` (which decodes via `to_tree` assuming
// id|dep_id|parent|off|len). Under `repr(Rust)` rustc may reorder fields and
// the binary lockfile round-trip silently corrupts `dependencies`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Tree {
    pub(crate) id: Id,

    // Should not be used for anything other than name
    // through `folder_name()`. There is no guarantee a dependency
    // id chosen for a tree node is the same behavior or has the
    // same version literal for packages hoisted.
    pub(crate) dependency_id: DependencyID,

    pub(crate) parent: Id,
    pub(crate) dependencies: DependencyIDSlice,
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

const EXTERNAL_SIZE: usize = core::mem::size_of::<Id>()
    + core::mem::size_of::<PackageID>()
    + core::mem::size_of::<Id>()
    + core::mem::size_of::<DependencyIDSlice>();

pub(crate) type External = [u8; EXTERNAL_SIZE];
pub type List = Vec<Tree>;

pub(crate) const ROOT_DEP_ID: DependencyID = invalid_package_id - 1;
pub(crate) const INVALID_ID: Id = Id::MAX;

impl Tree {
    pub(crate) const INVALID_ID: Id = INVALID_ID;
}

// max number of node_modules folders
pub(crate) const MAX_DEPTH: usize = (MAX_PATH_BYTES / b"node_modules".len()) + 1;

/// Parent-id stack for [`relative_path_and_depth`] (32 KB on Windows, so not zeroed).
pub(crate) type DepthBuf = [MaybeUninit<Id>; MAX_DEPTH];

#[inline]
pub(crate) fn depth_buf_uninit() -> DepthBuf {
    [const { MaybeUninit::uninit() }; MAX_DEPTH]
}

impl Tree {
    pub(crate) fn folder_name<'b>(&self, deps: &'b [Dependency], buf: &'b [u8]) -> &'b [u8] {
        let dep_id = self.dependency_id;
        if dep_id == invalid_dependency_id {
            return b"";
        }
        deps[dep_id as usize].name.slice(buf)
    }

    pub(crate) fn to_external(self) -> External {
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

    pub(crate) fn to_tree(out: External) -> Tree {
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

enum HoistDependencyResult {
    DependencyLoop,
    Hoisted,
    Resolve(PackageID),
    ResolveReplace {
        id: Id,
        dep_id: DependencyID,
    },
    ResolveLater,
    /// `Hoisted`, plus the optional peer's slot now points at the version it deduplicated onto.
    Rebind(PackageID),
    Placement {
        id: Id,
        bundled: bool,
    },
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SubtreeError {
    #[error("OutOfMemory")]
    OutOfMemory,
}

bun_core::oom_from_alloc!(SubtreeError);

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
    pub(crate) tree_id: Id,
    pub(crate) path_buf: PathBuffer,

    trees: &'a [Tree],
    hoisted_dependencies: &'a [DependencyID],
    dependencies: &'a [Dependency],
    string_bytes: &'a [u8],

    pub(crate) depth_stack: DepthBuf,
}

pub struct IteratorNext<'a> {
    pub relative_path: &'a ZStr,
    pub dependencies: &'a [DependencyID],
    pub(crate) tree_id: Id,

    /// depth of the node_modules folder in the tree
    ///
    /// ```text
    ///     0 (./node_modules)
    ///    / \
    ///   1   1
    ///  /
    /// 2
    /// ```
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
    pub(crate) fn from_slices(
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
            path_buf: PathBuffer::ZEROED,
            depth_stack: depth_buf_uninit(),
        };
        if PATH_STYLE == IteratorPathStyle::NodeModules {
            iter.path_buf[0..b"node_modules".len()].copy_from_slice(b"node_modules");
        }
        iter
    }

    pub(crate) fn reset(&mut self) {
        self.tree_id = 0;
    }

    // `Option<&mut DynamicBitSet>` is accepted unconditionally; callers with PkgPath must pass None.
    pub fn next(
        &mut self,
        completed_trees: Option<&mut DynamicBitSet>,
    ) -> Option<IteratorNext<'_>> {
        let trees = self.trees;

        if (self.tree_id as usize) >= trees.len() {
            return None;
        }

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
pub(crate) fn relative_path_and_depth<'b, const PATH_STYLE: IteratorPathStyle>(
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

    if tree.id > 0 {
        let buf = string_buf;
        let mut depth_buf_len: usize = 1;

        while parent_id > 0 && (parent_id as usize) < trees.len() {
            if depth_buf_len == MAX_DEPTH {
                path_buf[path_written] = 0;
                return (ZStr::from_buf(path_buf, path_written), 0);
            }
            depth_buf[depth_buf_len].write(parent_id);
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

            // SAFETY: the parent walk above wrote `depth_buf[1..=depth]` and
            // `1 <= depth_buf_len <= depth`.
            let id = unsafe { depth_buf[depth_buf_len].assume_init() };
            let name = trees[id as usize].folder_name(dependencies, buf);
            if !crate::dependency::is_safe_install_folder_name(name) {
                Output::err_generic(
                    "Lockfile is malformed (dependency name \"{}\" is not a valid folder name)",
                    (bun_core::fmt::for_terminal(bstr::BStr::new(name)),),
                );
                bun_core::Global::crash();
            }
            let name_end = match path_written.checked_add(name.len()) {
                Some(end) if end < MAX_PATH_BYTES => end,
                _ => path_too_long(),
            };
            path_buf[path_written..name_end].copy_from_slice(name);
            path_written = name_end;

            if PATH_STYLE == IteratorPathStyle::NodeModules {
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
    /// 'libc' (optional only), and omitted dependency types (`--omit=dev/peer/optional`).
    /// Dependencies of a disabled package are not included in the output.
    Filter,
}

// `manager` and the three fields from `workspace_filters` on: only for `METHOD == .Filter`.
pub struct Builder<'a, const METHOD: BuilderMethod> {
    pub(crate) list: MultiArrayList<BuilderEntry>,
    pub(crate) resolutions: &'a mut [PackageID],
    pub(crate) dependencies: &'a [Dependency],
    pub(crate) resolution_lists: &'a [DependencyIDSlice],
    pub(crate) queue: TreeFiller,
    pub(crate) log: &'a mut bun_ast::Log,
    /// Stored as `ParentRef` (raw
    /// non-null backref) so the construction site (`Lockfile::hoist`) can
    /// split-borrow `resolutions` mutably without borrowck rejecting the
    /// overlap; reads go through [`Builder::lockfile()`] which never touches
    /// `buffers.resolutions`.
    pub lockfile: bun_ptr::ParentRef<Lockfile>,
    // Unresolved peers that might resolve later. if they do we will want to assign
    // builder.resolutions[peer.dep_id] to the resolved pkg_id. A dependency ID set is used because there
    // can be multiple instances of the same package in the tree, so the same unresolved dependency ID
    // could be visited multiple times before it's resolved.
    pub(crate) pending_peers: ArrayHashMap<PackageNameHash, ArrayHashMap<DependencyID, ()>>,
    /// A peer got bound after its dependent was placed; see `Lockfile::resolve`.
    pub(crate) late_bound_peer: bool,
    pub(crate) manager: Option<&'a PackageManager>,
    pub(crate) sort_buf: Vec<DependencyID>,
    pub(crate) workspace_filters: &'a [WorkspaceFilter],
    pub(crate) install_root_dependencies: bool,
    pub(crate) packages_to_install: Option<&'a [PackageID]>,
    /// Workspace package ids that are hoisting barriers (self-contained node_modules).
    pub(crate) self_contained: Vec<PackageID>,
    pub(crate) peer_probes: PeerProbes,
    /// The first row of each name in each tree, which is what `hoist_dependency` looks for.
    pub(crate) placed: bun_collections::HashMap<(Id, PackageNameHash), DependencyID>,
    /// Install-tree rows a tarball ships: placed as in the saved tree, then dropped by `clean`.
    pub(crate) shipped_rows: bun_collections::HashMap<(Id, DependencyID), ()>,
    /// The folder `process_subtree` is filling is one of `shipped_rows`.
    pub(crate) in_shipped_folder: bool,
    pub(crate) linked: reachable::Linked,
}

/// The hoisted package's required peers (does staying put find it in range?); who has any.
#[derive(Default)]
pub(crate) struct PeerProbes(Vec<(DependencyID, bool)>, Option<DynamicBitSet>);

impl PeerProbes {
    /// `package_id` is about to be hoisted out of the package with `owner_deps`.
    fn begin(
        &mut self,
        lockfile: &Lockfile,
        deps: &[Dependency],
        resolutions: &[PackageID],
        owner_deps: DependencyIDSlice,
        package_id: PackageID,
    ) {
        self.0.clear();
        if package_id == invalid_package_id {
            return;
        }

        let is_probed = |peer: &Dependency| {
            peer.behavior.is_peer()
                && !peer.behavior.is_optional_peer()
                && peer.version.tag == crate::dependency::VersionTag::Npm
        };
        let with_peers = self.1.get_or_insert_with(|| {
            let lists = lockfile.packages.items_resolutions();
            let mut set = DynamicBitSet::init_empty(lists.len()).unwrap_or_oom();
            for (id, list) in lists.iter().enumerate() {
                if (list.begin()..list.end()).any(|dep_id| is_probed(&deps[dep_id as usize])) {
                    set.set(id);
                }
            }
            set
        });
        if !with_peers.is_set(package_id as usize) {
            return;
        }

        let pkg_resolutions = lockfile.packages.items_resolution();
        // Installed as a link, so a nested copy would resolve the same peers as the root copy.
        if matches!(
            pkg_resolutions[package_id as usize].tag,
            crate::resolution::Tag::Workspace | crate::resolution::Tag::Symlink
        ) {
            return;
        }

        let buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_deps = lockfile.packages.items_resolutions()[package_id as usize];

        for peer_dep_id in pkg_deps.begin()..pkg_deps.end() {
            let peer = &deps[peer_dep_id as usize];
            if !is_probed(peer) {
                continue;
            }

            // A regular dependency on the same name is what gets installed next to the package.
            if (pkg_deps.begin()..pkg_deps.end()).any(|dep_id| {
                let dep = &deps[dep_id as usize];
                dep.name_hash == peer.name_hash && !dep.behavior.is_peer()
            }) {
                continue;
            }

            // The owner's own copy of the peer, if any, is the one the package finds from here.
            let owner_copy = (owner_deps.begin()..owner_deps.end())
                .find(|&dep_id| {
                    let dep = &deps[dep_id as usize];
                    dep.name_hash == peer.name_hash
                        && !dep.behavior.is_peer()
                        && resolutions[dep_id as usize] != invalid_package_id
                })
                .map(|dep_id| {
                    pkg_resolutions[resolutions[dep_id as usize] as usize]
                        .satisfies_dependency_version(&peer.version, buf, buf)
                });
            if owner_copy != Some(false) {
                self.0.push((peer_dep_id, owner_copy.is_some()));
            }
        }
    }

    /// Do `tree_deps` hold an out-of-range version of a peer that staying put finds in range?
    fn is_hidden_by(
        &mut self,
        lockfile: &Lockfile,
        deps: &[Dependency],
        resolutions: &[PackageID],
        tree_deps: &[DependencyID],
    ) -> bool {
        let pkg_resolutions = lockfile.packages.items_resolution();
        let buf = lockfile.buffers.string_bytes.as_slice();

        let mut i = 0;
        while i < self.0.len() {
            let (peer_dep_id, provided) = self.0[i];
            let peer = &deps[peer_dep_id as usize];
            let held = tree_deps
                .iter()
                .find(|&&dep_id| deps[dep_id as usize].name_hash == peer.name_hash)
                .map(|&dep_id| resolutions[dep_id as usize])
                .filter(|&res_id| res_id != invalid_package_id)
                .map(|res_id| {
                    pkg_resolutions[res_id as usize].satisfies_dependency_version(
                        &peer.version,
                        buf,
                        buf,
                    )
                });
            match held {
                None => i += 1,
                Some(true) => {
                    self.0[i].1 = true;
                    i += 1;
                }
                Some(false) if provided => return true,
                // Out of range wherever the package ends up.
                Some(false) => {
                    self.0.swap_remove(i);
                }
            }
        }

        false
    }
}

pub struct BuilderEntry {
    pub tree: Tree,
    pub dependencies: DependencyIDList,
}

bun_collections::multi_array_columns! {
    pub(crate) trait BuilderEntryColumns for BuilderEntry {
        tree: Tree,
        dependencies: DependencyIDList,
    }
}

pub(crate) struct CleanResult {
    pub trees: Vec<Tree>,
    pub dep_ids: Vec<DependencyID>,
}

/// `Some(n)`: two equal rounds of `n` trees end at `parent`, so a third would nest forever.
fn repeating_period(
    list: &MultiArrayList<BuilderEntry>,
    parent: Id,
    dependency_id: DependencyID,
) -> Option<usize> {
    let trees = list.items_tree();
    let entries = list.items_dependencies();

    let mut period: usize = 1;
    let mut round_start = parent;
    while round_start != INVALID_ID {
        let above = trees[round_start as usize].parent;
        if trees[round_start as usize].dependency_id == dependency_id {
            let (mut lower, mut upper) = (parent, above);
            let mut same: usize = 0;
            while same < period
                && upper != INVALID_ID
                && trees[lower as usize].dependency_id == trees[upper as usize].dependency_id
                && entries[upper as usize].starts_with(&entries[lower as usize])
            {
                lower = trees[lower as usize].parent;
                upper = trees[upper as usize].parent;
                same += 1;
            }
            if same == period {
                return Some(period);
            }
        }
        round_start = above;
        period += 1;
    }

    None
}

impl<'a, const METHOD: BuilderMethod> Builder<'a, METHOD> {
    /// MUST NOT be used to read `buffers.resolutions`: `self.resolutions` is a live `&mut` to it.
    #[inline]
    fn lockfile(&self) -> &Lockfile {
        self.lockfile.get()
    }

    fn bind_pending_peers(&mut self, name_hash: PackageNameHash, pkg_id: PackageID) {
        if let Some((_, peers)) = self.pending_peers.fetch_swap_remove(&name_hash) {
            for &dep_id in peers.keys() {
                self.resolutions[dep_id as usize] = pkg_id;
            }
        }
    }

    fn buf(&self) -> &[u8] {
        self.lockfile().buffers.string_bytes.as_slice()
    }

    /// Binds a peer edge the way loading `bun.lock` does, so every tree of these packages agrees.
    fn bind_peer(&mut self, dep_id: DependencyID) {
        let lockfile_ref = self.lockfile;
        let lockfile: &Lockfile = lockfile_ref.get();
        if let Some(pkg_id) = bun_lock::resolve_peer_dep_version_based(
            &self.dependencies[dep_id as usize],
            &lockfile.catalogs,
            &lockfile.package_index,
            &lockfile.overrides,
            lockfile.packages.items_resolution(),
            lockfile.buffers.string_bytes.as_slice(),
            |_| true,
        ) {
            self.resolutions[dep_id as usize] = pkg_id;
        }
    }

    #[cold]
    fn crash_on_endless_nesting(
        &self,
        parent: Id,
        dependency_id: DependencyID,
        period: usize,
    ) -> ! {
        let lockfile = self.lockfile();
        let buf = self.buf();
        let pkg_names = lockfile.packages.items_name();
        let pkg_resolutions = lockfile.packages.items_resolution();
        let trees = self.list.items_tree();

        let mut round = vec![dependency_id];
        let mut tree_id = parent;
        for _ in 0..period {
            round.push(trees[tree_id as usize].dependency_id);
            tree_id = trees[tree_id as usize].parent;
        }

        let mut cycle = String::new();
        for &dep_id in round.iter().rev() {
            let pkg_id = self.resolutions[dep_id as usize] as usize;
            let separator = if cycle.is_empty() { "" } else { " > " };
            let _ = write!(
                cycle,
                "{}{}@{}",
                separator,
                pkg_names[pkg_id].fmt(buf),
                pkg_resolutions[pkg_id].fmt(buf, PathSep::Posix),
            );
        }

        Output::err_generic(
            "dependency cycle cannot be laid out in node_modules: {}",
            (bun_core::fmt::for_terminal(bstr::BStr::new(&cycle)),),
        );
        bun_core::note!(
            "each of these needs the next one nested inside it, without end. \"overrides\" in package.json can keep a single version of one of them"
        );
        bun_core::Global::crash();
    }

    /// Flatten the multi-dimensional ArrayList of package IDs into a single easily serializable array
    pub(crate) fn clean(&mut self) -> Result<CleanResult, AllocError> {
        let mut total: u32 = 0;

        let mut slice = self.list.to_owned_slice();
        let mut trees: Vec<Tree> = slice.items_tree().to_vec();
        let dependencies: &mut [DependencyIDList] = slice.items_dependencies_mut();

        for tree in &trees {
            total += tree.dependencies.len;
        }

        let mut dep_ids: DependencyIDList = Vec::with_capacity(total as usize);

        debug_assert_eq!(trees.len(), dependencies.len());
        for (tree, child) in trees.iter_mut().zip(dependencies.iter_mut()) {
            let child = core::mem::take(child);
            let off: u32 = dep_ids.len() as u32;
            for &dep_id in child.iter() {
                let pkg_id = self.resolutions[dep_id as usize];
                if pkg_id == invalid_package_id {
                    // peers that never resolved
                    continue;
                }
                if !self.shipped_rows.is_empty()
                    && self.shipped_rows.contains_key(&(tree.id, dep_id))
                {
                    continue;
                }

                dep_ids.push(dep_id);
            }
            let len: u32 = dep_ids.len() as u32 - off;

            tree.dependencies.off = off;
            tree.dependencies.len = len;
        }

        slice.deinit_owned();

        Ok(CleanResult { trees, dep_ids })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// is_filtered_dependency_or_workspace
// ──────────────────────────────────────────────────────────────────────────

// `Builder` holds a live `&mut [PackageID]` over the resolutions buffer (see
// `Builder.lockfile` safety contract), so callers must thread `resolutions`
// explicitly to avoid an aliasing read through the shared `&Lockfile`.
pub(crate) fn is_filtered_dependency_or_workspace(
    dep_id: DependencyID,
    parent_pkg_id: PackageID,
    workspace_filters: &[WorkspaceFilter],
    install_root_dependencies: bool,
    manager: &PackageManager,
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    linked: &mut reachable::Linked,
) -> bool {
    let pkg_id = resolutions[dep_id as usize];
    let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
    if (pkg_id as usize) >= lockfile.packages.len() {
        return !dep.behavior.is_optional_peer();
    }

    let pkgs = lockfile.packages.slice();
    let pkg_names = pkgs.items_name();
    let pkg_metas = pkgs.items_meta();
    let pkg_resolutions = pkgs.items_resolution();

    let parent_res = &pkg_resolutions[parent_pkg_id as usize];

    if pkg_metas[pkg_id as usize].is_disabled(
        manager.options.cpu,
        manager.options.os,
        manager.options.libc.for_dependency(dep.behavior),
    ) {
        if manager.options.log_level.is_verbose() {
            let meta = &pkg_metas[pkg_id as usize];
            bun_core::pretty_errorln!(
                "<d>Skip installing<r> <b>{}<r> <d>- {} mismatch<r>",
                bstr::BStr::new(lockfile.str(&pkg_names[pkg_id as usize])),
                match (
                    meta.os.is_match(manager.options.os),
                    meta.arch.is_match(manager.options.cpu),
                ) {
                    (false, false) => "cpu & os",
                    (false, true) => "os",
                    (true, false) => "cpu",
                    (true, true) => "libc",
                },
            );
        }
        return true;
    }

    if !(dep.behavior).is_placed(manager.options.dependency_features(parent_res.tag)) {
        return true;
    }

    if dep.behavior.is_optional_peer()
        && linked.omits_optional_peer(
            dep_id,
            parent_pkg_id,
            workspace_filters,
            install_root_dependencies,
            manager,
            lockfile,
            resolutions,
        )
    {
        return true;
    }

    // Not a peer: an ancestor's copy can satisfy one; `process_subtree` / `build_store` decide.
    if !dep.behavior.is_peer()
        && pruned_workspaces::skips_link_to_pruned_workspace(
            manager,
            lockfile,
            parent_pkg_id,
            dep,
            pkg_id,
        )
    {
        return true;
    }

    if parent_pkg_id != 0 {
        return false;
    }

    if !dep.behavior.is_workspace() {
        return !install_root_dependencies;
    }

    if manager.summary.pruned_workspaces.contains(&dep.name_hash) {
        return true;
    }

    !WorkspaceFilter::is_selected(workspace_filters, pkg_id)
}

// ──────────────────────────────────────────────────────────────────────────
// process_subtree / hoist_dependency
// ──────────────────────────────────────────────────────────────────────────

impl Tree {
    pub(crate) fn process_subtree<const METHOD: BuilderMethod>(
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

        if let Some(period) = repeating_period(&builder.list, self.id, dependency_id) {
            builder.crash_on_endless_nesting(self.id, dependency_id, period);
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

        let next_id = (builder.list.len() - 1) as Id;
        // A self-contained workspace is a hoisting barrier: nothing below it may be
        // placed above its own node_modules.
        let hoist_root_id = if dependency_id != ROOT_DEP_ID
            && builder.dependencies[dependency_id as usize]
                .behavior
                .is_workspace()
            && builder.self_contained.contains(&parent_pkg_id)
        {
            next_id
        } else {
            hoist_root_id
        };
        let shipped = builder.shipped_rows.contains_key(&(self.id, dependency_id));
        builder.in_shipped_folder = shipped;

        // Copied out, so that neither keeps `builder` borrowed.
        let lockfile_ref = builder.lockfile;
        let lockfile: &Lockfile = lockfile_ref.get();
        let pkgs = lockfile.packages.slice();
        let pkg_resolutions = pkgs.items_resolution();
        let dependencies: &[Dependency] = builder.dependencies;

        builder.sort_buf.clear();
        builder
            .sort_buf
            .extend(resolution_list.begin()..resolution_list.end());

        {
            let sorter = DepSorter { lockfile };
            index_sort::sort_indices_unstable(&mut builder.sort_buf, &mut |a, b| {
                if DepSorter::is_less_than(&sorter, a, b) {
                    core::cmp::Ordering::Less
                } else if DepSorter::is_less_than(&sorter, b, a) {
                    core::cmp::Ordering::Greater
                } else {
                    core::cmp::Ordering::Equal
                }
            });
        }

        'dep: for sort_idx in 0..builder.sort_buf.len() {
            let dep_id = builder.sort_buf[sort_idx];
            builder.bind_peer(dep_id);
            let pkg_id = builder.resolutions[dep_id as usize];
            let dependency = &dependencies[dep_id as usize];

            // filter out disabled dependencies. Not what a tarball ships: see `shipped_rows`.
            if METHOD == BuilderMethod::Filter && !shipped && !dependency.behavior.is_bundled() {
                let manager = builder.manager.expect("manager set when METHOD == Filter");
                // As in `build_store`: the list replaces the filter for the root's own rows.
                let filtered = match builder.packages_to_install.filter(|_| parent_pkg_id == 0) {
                    Some(packages_to_install) => !packages_to_install.contains(&pkg_id),
                    None => is_filtered_dependency_or_workspace(
                        dep_id,
                        parent_pkg_id,
                        builder.workspace_filters,
                        builder.install_root_dependencies,
                        manager,
                        lockfile,
                        &*builder.resolutions,
                        &mut builder.linked,
                    ),
                };

                // unresolved packages already had their chance to resolve.
                if filtered
                    || pkg_id == invalid_package_id
                    || pruned_workspaces::skips_link_to_pruned_workspace(
                        manager,
                        lockfile,
                        parent_pkg_id,
                        dependency,
                        pkg_id,
                    )
                {
                    continue;
                }
            }

            let hoist = |hoist_root_id: Id, builder: &mut Builder<'_, METHOD>| {
                Tree::hoist_dependency::<true, METHOD>(
                    next_id,
                    hoist_root_id,
                    pkg_id,
                    dep_id,
                    resolution_list,
                    builder,
                )
            };

            let hoisted: HoistDependencyResult = 'hoisted: {
                // don't hoist if it's a folder dependency or a bundled dependency.
                if dependency.behavior.is_bundled() {
                    break 'hoisted HoistDependencyResult::Placement {
                        id: next_id,
                        bundled: true,
                    };
                }

                if pkg_id == invalid_package_id {
                    // skip unresolvable dependencies. An unbound peer binds to the nearest copy.
                    if !dependency.behavior.is_peer() {
                        continue 'dep;
                    }
                } else if pkg_resolutions[pkg_id as usize].tag == crate::resolution::Tag::Folder {
                    // A peer an ancestor edge already provides dedupes instead of nesting
                    // a second copy of the folder.
                    if dependency.behavior.is_peer()
                        && matches!(
                            hoist(hoist_root_id, &mut *builder),
                            HoistDependencyResult::Hoisted
                        )
                    {
                        break 'hoisted HoistDependencyResult::Hoisted;
                    }

                    // Folder packages never hoist, so a cycle between them would nest forever.
                    let mut tree_id = next_id;
                    while tree_id != INVALID_ID {
                        let tree: Tree = builder.list.items_tree()[tree_id as usize];
                        let ancestor_dep_id = tree.dependency_id;
                        if (ancestor_dep_id as usize) < dependencies.len()
                            && builder.resolutions[ancestor_dep_id as usize] == pkg_id
                            && dependencies[ancestor_dep_id as usize].name_hash
                                == dependency.name_hash
                        {
                            continue 'dep;
                        }
                        tree_id = tree.parent;
                    }

                    // Its own hoist root: stays in this node, dedupes against a same-name sibling.
                    break 'hoisted hoist(next_id, &mut *builder);
                }

                hoist(hoist_root_id, &mut *builder)
            };

            match hoisted {
                HoistDependencyResult::DependencyLoop | HoistDependencyResult::Hoisted => continue,

                HoistDependencyResult::Resolve(res_id) => {
                    debug_assert!(pkg_id == invalid_package_id);
                    debug_assert!(res_id != invalid_package_id);
                    builder.resolutions[dep_id as usize] = res_id;
                    debug_assert!(!builder.pending_peers.contains_key(&dependency.name_hash));
                    builder.bind_pending_peers(dependency.name_hash, res_id);
                }
                HoistDependencyResult::ResolveReplace {
                    id,
                    dep_id: replaced,
                } => {
                    debug_assert!(pkg_id != invalid_package_id);
                    builder.late_bound_peer = true;
                    builder.resolutions[replaced as usize] = pkg_id;
                    builder.bind_pending_peers(dependency.name_hash, pkg_id);
                    for placed_dep_id in &mut builder.list.items_dependencies_mut()[id as usize] {
                        if *placed_dep_id == replaced {
                            *placed_dep_id = dep_id;
                        }
                    }
                    if let Some(placed) = builder.placed.get_mut(&(id, dependency.name_hash))
                        && *placed == replaced
                    {
                        *placed = dep_id;
                    }
                    builder.shipped_rows.remove(&(id, replaced));
                    if shipped {
                        builder.shipped_rows.insert((id, dep_id), ());
                    }
                    if builder.resolution_lists[pkg_id as usize].len > 0 {
                        builder.queue.write_item(FillItem {
                            tree_id: id,
                            dependency_id: dep_id,
                            hoist_root_id,
                        })?;
                    }
                }
                HoistDependencyResult::Rebind(res_id) => {
                    debug_assert!(dependency.behavior.is_optional_peer());
                    builder.resolutions[dep_id as usize] = res_id;
                }
                HoistDependencyResult::ResolveLater => {
                    // an unresolved peer that deduplicated with another one. save it to resolve it
                    // later if it's possible to resolve it.
                    let entry = builder.pending_peers.get_or_put(dependency.name_hash)?;
                    if !entry.found_existing {
                        *entry.value_ptr = ArrayHashMap::default();
                    }

                    entry.value_ptr.put(dep_id, ())?;
                }
                HoistDependencyResult::Placement { id, bundled } => {
                    // Only a placed row names a folder; enqueue reported an unresolved one's name.
                    let dependency_name = dependency
                        .name
                        .slice(lockfile.buffers.string_bytes.as_slice());
                    if pkg_id != invalid_package_id
                        && !dependency_name.is_empty()
                        && !crate::package_installer::alias_is_safe_install_target(dependency_name)
                    {
                        builder.log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Invalid dependency name \"{}\"",
                                bun_core::fmt::for_terminal(bstr::BStr::new(dependency_name)),
                            ),
                        );
                        continue 'dep;
                    }
                    builder.list.items_dependencies_mut()[id as usize].push(dep_id);
                    let placed = builder.placed.get_or_put((id, dependency.name_hash))?;
                    if !placed.found_existing {
                        *placed.value_ptr = dep_id;
                    }
                    builder.list.items_tree_mut()[id as usize].dependencies.len += 1;
                    if METHOD == BuilderMethod::Filter && (shipped || bundled) {
                        builder.shipped_rows.insert((id, dep_id), ());
                    }
                    if pkg_id != invalid_package_id
                        && builder.resolution_lists[pkg_id as usize].len > 0
                    {
                        builder.queue.write_item(FillItem {
                            tree_id: id,
                            dependency_id: dep_id,
                            // if it's bundled, start a new hoist root
                            hoist_root_id: if bundled { id } else { hoist_root_id },
                        })?;
                    }
                }
            }
        }

        let next: Tree = builder.list.items_tree()[next_id as usize];
        if next.dependencies.len == 0 {
            debug_assert!(builder.list.len() == (next.id as usize) + 1);
            let _ = builder.list.pop();
        }

        Ok(())
    }

    // This function does one of three things:
    // 1 (return hoisted) - de-duplicate (skip) the package
    // 2 (return id) - move the package to the top directory
    // 3 (return dependency_loop) - leave the package at the same (relative) directory
    fn hoist_dependency<const AS_DEFINED: bool, const METHOD: BuilderMethod>(
        self_id: Id,
        hoist_root_id: Id,
        package_id: PackageID,
        input_dep_id: DependencyID,
        input_dep_range: DependencyIDSlice,
        builder: &mut Builder<'_, METHOD>,
    ) -> HoistDependencyResult {
        let deps: &[Dependency] = builder.dependencies;
        let dependency: &Dependency = &deps[input_dep_id as usize];

        let this: Tree = builder.list.items_tree()[self_id as usize];
        let this_deps: &[DependencyID] = this
            .dependencies
            .get(builder.list.items_dependencies()[self_id as usize].as_slice());
        if !AS_DEFINED
            && !builder.peer_probes.0.is_empty()
            && builder.peer_probes.is_hidden_by(
                builder.lockfile.get(),
                deps,
                &*builder.resolutions,
                this_deps,
            )
        {
            return HoistDependencyResult::DependencyLoop; // 3
        }
        debug_assert_eq!(
            builder.placed.get(&(this.id, dependency.name_hash)),
            this_deps
                .iter()
                .find(|&&dep_id| deps[dep_id as usize].name_hash == dependency.name_hash),
        );
        if let Some(&dep_id) = builder.placed.get(&(this.id, dependency.name_hash)) {
            let dep = &deps[dep_id as usize];
            let res_id = builder.resolutions[dep_id as usize];

            // A row bun installs resolves through no shipped row; a peer shares the bundled copy.
            if METHOD == BuilderMethod::Filter
                && !builder.in_shipped_folder
                && package_id != invalid_package_id
                && !(dependency.behavior.is_peer() && dep.behavior.is_bundled())
                && builder.shipped_rows.contains_key(&(this.id, dep_id))
            {
                return HoistDependencyResult::DependencyLoop; // 3
            }

            // The copy a tarball ships stays in this folder, resolved or not.
            if res_id == invalid_package_id && dep.behavior.is_bundled() {
                return HoistDependencyResult::DependencyLoop; // 3
            }

            if res_id == invalid_package_id && package_id == invalid_package_id {
                debug_assert!(dep.behavior.is_peer());
                debug_assert!(dependency.behavior.is_peer());
                // both peers will need to be resolved if they can resolve later.
                // remember input package_id and dependency for later
                return HoistDependencyResult::ResolveLater;
            }

            if res_id == invalid_package_id {
                debug_assert!(dep.behavior.is_peer());
                return HoistDependencyResult::ResolveReplace {
                    id: this.id,
                    dep_id,
                };
            }

            if package_id == invalid_package_id {
                debug_assert!(dependency.behavior.is_peer());
                debug_assert!(res_id != invalid_package_id);
                // resolve peer to `builder.resolutions[dep_id]`
                return HoistDependencyResult::Resolve(res_id); // 1
            }

            if res_id == package_id {
                // this dependency is the same package as the other, hoist
                return HoistDependencyResult::Hoisted; // 1
            }

            if input_dep_range.contains(dep_id) {
                // same package lists this name in another dependency group
                return HoistDependencyResult::Hoisted; // 1
            }

            // now we either keep the dependency at this place in the tree,
            // or hoist if peer version allows it

            if dependency.behavior.is_peer() {
                // A rule chose this peer's package: an alias of another package does not serve it.
                let pkg_name_hashes = builder.lockfile().packages.items_name_hash();
                if pkg_name_hashes[res_id as usize] != pkg_name_hashes[package_id as usize]
                    && builder.lockfile().is_overridden_dependency(input_dep_id)
                {
                    return HoistDependencyResult::DependencyLoop; // 3
                }

                // An optional peer's binding follows the dedupe, but only in the tree being saved.
                let dedupe = || {
                    if METHOD == BuilderMethod::Resolvable && dependency.behavior.is_optional_peer()
                    {
                        HoistDependencyResult::Rebind(res_id)
                    } else {
                        HoistDependencyResult::Hoisted
                    }
                };

                let peer_range: &crate::dependency::Version = builder
                    .lockfile()
                    .catalogs
                    .resolve_range(builder.buf(), dependency);
                if peer_range.tag == crate::dependency::VersionTag::Npm {
                    let resolution: Resolution =
                        builder.lockfile().packages.items_resolution()[res_id as usize];
                    let version = &peer_range.npm().version;
                    if resolution.tag == crate::resolution::Tag::Npm
                        && version.satisfies(resolution.npm().version, builder.buf(), builder.buf())
                    {
                        return dedupe(); // 1
                    }
                }

                // Root dependencies are manually chosen by the user. Allow them
                // to hoist other peers even if they don't satisfy the version
                if builder.lockfile().is_workspace_root_dependency(dep_id) {
                    return dedupe(); // 1
                }
            }

            return HoistDependencyResult::DependencyLoop; // 3
        }

        // this dependency was not found in this tree, try hoisting or placing in the next parent
        if this.parent != INVALID_ID && this.id != hoist_root_id {
            if AS_DEFINED {
                builder.peer_probes.begin(
                    builder.lockfile.get(),
                    deps,
                    &*builder.resolutions,
                    input_dep_range,
                    package_id,
                );
            }
            let id = Tree::hoist_dependency::<false, METHOD>(
                this.parent,
                hoist_root_id,
                package_id,
                input_dep_id,
                input_dep_range,
                builder,
            );
            if !AS_DEFINED || !matches!(id, HoistDependencyResult::DependencyLoop) {
                return id; // 1 or 2
            }
        }

        // Is the hoist root a bundle? In the installed tree it is one only for the rows it ships.
        if (METHOD == BuilderMethod::Resolvable || builder.in_shipped_folder)
            && this.id == hoist_root_id
        {
            // a bundle's dependency stops here, but must not shadow what resolves through here.
            if METHOD == BuilderMethod::Resolvable
                && !AS_DEFINED
                && Tree::hoist_root_resolves_elsewhere(
                    this.id,
                    package_id,
                    dependency.name_hash,
                    builder,
                )
            {
                return HoistDependencyResult::DependencyLoop; // 3
            }

            // Copying the bundling package into its own bundle would recurse forever.
            if (this.dependency_id as usize) < deps.len()
                && builder.resolutions[this.dependency_id as usize] == package_id
                && deps[this.dependency_id as usize].name_hash == dependency.name_hash
            {
                return HoistDependencyResult::Hoisted; // 1
            }
        }

        // place the dependency in the current tree
        HoistDependencyResult::Placement {
            id: this.id,
            bundled: false,
        } // 2
    }

    /// Does a `name_hash` edge that loading `bun.lock` would rebind to `hoist_root` go elsewhere?
    fn hoist_root_resolves_elsewhere<const METHOD: BuilderMethod>(
        hoist_root: Id,
        package_id: PackageID,
        name_hash: PackageNameHash,
        builder: &Builder<'_, METHOD>,
    ) -> bool {
        // an unbound optional peer saves no entry; once bound, `Lockfile::resolve` hoists again
        if package_id == invalid_package_id {
            return false;
        }

        let trees = builder.list.items_tree();
        if trees[hoist_root as usize].parent == INVALID_ID {
            return false;
        }

        let entry_lists = builder.list.items_dependencies();
        let deps: &[Dependency] = builder.dependencies;
        let resolutions: &[PackageID] = &*builder.resolutions;
        let resolution_lists = builder.resolution_lists;

        let resolves_elsewhere = |pkg_id: PackageID| -> bool {
            let pkg_deps = resolution_lists[pkg_id as usize];
            (pkg_deps.begin()..pkg_deps.end()).any(|dep_id| {
                let dep = &deps[dep_id as usize];
                dep.name_hash == name_hash
                    && !dep.behavior.is_bundled()
                    && resolutions[dep_id as usize] != package_id
            })
        };

        // `tree_owner`'s regular dependencies placed in its own node_modules, `tree_id`
        let nested_in = move |tree_id: Id, tree_owner: PackageID| {
            let own_deps = resolution_lists[tree_owner as usize];
            trees[tree_id as usize]
                .dependencies
                .get(entry_lists[tree_id as usize].as_slice())
                .iter()
                .filter(move |&&dep_id| {
                    own_deps.contains(dep_id) && !deps[dep_id as usize].behavior.is_bundled()
                })
                .map(move |&dep_id| resolutions[dep_id as usize])
                .filter(|&pkg_id| pkg_id != invalid_package_id)
        };

        let owner = resolutions[trees[hoist_root as usize].dependency_id as usize];
        if resolves_elsewhere(owner) {
            return true;
        }

        let mut any_nested = false;
        for pkg_id in nested_in(hoist_root, owner) {
            if resolves_elsewhere(pkg_id) {
                return true;
            }
            any_nested = true;
        }
        if !any_nested {
            return false;
        }

        // The nested packages' own trees hold more of them. A tree comes after its parent.
        let mut scope: Vec<(Id, PackageID)> = vec![(hoist_root, owner)];
        for (id, tree) in trees.iter().enumerate().skip(hoist_root as usize + 1) {
            let Some(&(_, parent_owner)) =
                scope.iter().find(|(scope_id, _)| *scope_id == tree.parent)
            else {
                continue;
            };
            if !resolution_lists[parent_owner as usize].contains(tree.dependency_id)
                || deps[tree.dependency_id as usize].behavior.is_bundled()
            {
                continue;
            }
            let tree_owner = resolutions[tree.dependency_id as usize];
            if nested_in(id as Id, tree_owner).any(&resolves_elsewhere) {
                return true;
            }
            scope.push((id as Id, tree_owner));
        }

        false
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FillItem / TreeFiller
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct FillItem {
    pub(crate) tree_id: Id,
    pub(crate) dependency_id: DependencyID,

    /// If valid, dependencies will not hoist
    /// beyond this tree if they're in a subtree
    pub(crate) hoist_root_id: Id,
}

// Dynamic, heap-backed ring buffer.
pub(crate) type TreeFiller =
    bun_collections::LinearFifo<FillItem, bun_collections::linear_fifo::DynamicBuffer<FillItem>>;

/// Each `(peer edge, package)` pair a placement of the owner resolves, nearest folder first.
pub fn served_peers(lockfile: &Lockfile) -> Vec<(DependencyID, PackageID)> {
    use bun_collections::HashMap;

    let trees = lockfile.buffers.trees.as_slice();
    let hoisted = lockfile.buffers.hoisted_dependencies.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let pkg_dependencies = lockfile.packages.items_dependencies();

    let mut served: Vec<(DependencyID, PackageID)> = Vec::new();
    if trees.is_empty() {
        return served;
    }
    let mut seen: HashMap<(DependencyID, PackageID), ()> = HashMap::default();

    // The `node_modules` folder of the package placed in `parent` under a name, if it has one.
    let mut own_folder: HashMap<(Id, PackageNameHash), Id> = HashMap::default();
    for tree in &trees[1..] {
        let name_hash = dependencies[tree.dependency_id as usize].name_hash;
        own_folder.insert((tree.parent, name_hash), tree.id);
    }

    let resolve_from = |mut tree_id: Id, name_hash: PackageNameHash| -> Option<PackageID> {
        while let Some(tree) = trees.get(tree_id as usize) {
            for &dep_id in tree.dependencies.get(hoisted) {
                if dependencies[dep_id as usize].name_hash == name_hash {
                    return Some(resolutions[dep_id as usize]);
                }
            }
            tree_id = tree.parent;
        }
        None
    };

    let mut visit = |pkg_id: PackageID, from: Id| {
        let deps = pkg_dependencies[pkg_id as usize];
        for dep_id in deps.begin()..deps.end() {
            let dep = &dependencies[dep_id as usize];
            if !dep.behavior.is_peer() {
                continue;
            }
            if let Some(target) = resolve_from(from, dep.name_hash)
                && target != invalid_package_id
                && seen.insert((dep_id, target), ()).is_none()
            {
                served.push((dep_id, target));
            }
        }
    };

    visit(0, 0);
    for tree in trees {
        for &dep_id in tree.dependencies.get(hoisted) {
            let pkg_id = resolutions[dep_id as usize];
            if pkg_id == invalid_package_id {
                continue;
            }
            let from = own_folder
                .get(&(tree.id, dependencies[dep_id as usize].name_hash))
                .copied()
                .unwrap_or(tree.id);
            visit(pkg_id, from);
        }
    }

    served
}
