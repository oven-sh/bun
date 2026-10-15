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

    /// The tree of a member that the root's `node_modules` has no link to: see `hoist_dependency`.
    pub(crate) fn is_unlinked_member(
        &self,
        trees: &[Tree],
        hoisted_dependencies: &[DependencyID],
        deps: &[Dependency],
    ) -> bool {
        if self.parent == INVALID_ID {
            return false;
        }
        (deps.get(self.dependency_id as usize)).is_some_and(|dep| {
            dep.behavior.is_workspace()
                && dep.version.tag == crate::dependency::VersionTag::Workspace
        }) && !(trees[self.parent as usize].dependencies)
            .get(hoisted_dependencies)
            .contains(&self.dependency_id)
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
    /// Install tree: another group of the same package holds the place in `id` for another package.
    Contested {
        id: Id,
    },
    Resolve(PackageID),
    ResolveReplace {
        id: Id,
        dep_id: DependencyID,
    },
    ResolveLater,
    /// `Hoisted`, plus the optional peer's slot now points at the version it deduplicated onto.
    Rebind(PackageID),
    /// `Hoisted`, onto another package than the one the required peer is bound to.
    Served(PackageID),
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

    /// The saved tree has what such a member needs. No `node_modules` has it: `is_member_outside`.
    fn is_in_member_outside(&self, id: Id) -> bool {
        let mut top = self.trees[id as usize];
        for _ in 0..MAX_DEPTH {
            if top.parent == 0 {
                return (self.dependencies.get(top.dependency_id as usize)).is_some_and(|member| {
                    member.behavior.is_workspace()
                        && member.version.tag == crate::dependency::VersionTag::Workspace
                        && crate::bin::path_climbs_out(
                            member.version.workspace().slice(self.string_bytes),
                        )
                });
            }
            match self.trees.get(top.parent as usize) {
                Some(parent) => top = *parent,
                None => break,
            }
        }
        false
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

        while trees[self.tree_id as usize].dependencies.len == 0
            || (PATH_STYLE == IteratorPathStyle::NodeModules
                && self.is_in_member_outside(self.tree_id))
        {
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
            self.hoisted_dependencies,
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
    hoisted_dependencies: &[DependencyID],
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
        IteratorPathStyle::NodeModules => {
            // The last path in this buffer may have been one of an unlinked member.
            path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");
            b"node_modules".len()
        }
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
            let mut name = trees[id as usize].folder_name(dependencies, buf);
            // Below the root, so the first: its own folder on disk, `./<name>` in bun.lock.
            if trees[id as usize].is_unlinked_member(trees, hoisted_dependencies, dependencies) {
                if PATH_STYLE == IteratorPathStyle::PkgPath {
                    path_buf[..2].copy_from_slice(b"./");
                    path_written = 2;
                } else {
                    let member = &dependencies[trees[id as usize].dependency_id as usize];
                    name = bun_core::strings::without_trailing_slash(
                        member.version.workspace().slice(buf),
                    );
                    path_written = 0;
                }
            }
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

    /// For installing. Every dependency takes its place, so places do not depend on the run; then
    /// `keep_linked_rows` drops what the run leaves out: by 'os', 'cpu', 'libc' (optional only),
    /// `--omit=dev/peer/optional`, `--filter`. What only a dropped package needs is dropped too.
    Filter,
}

/// Where the install tree puts a package when the run leaves others out.
#[derive(PartialEq, Eq, Clone, Copy)]
pub(crate) enum Layout {
    /// Where bun.lock has it.
    Locked,
    /// `Builder::older_layout`.
    Older,
}

/// What `Lockfile::hoist` tells besides the tree.
pub(crate) struct Hoisted {
    /// `Builder::late_bound_peer`.
    pub(crate) late_bound_peer: bool,
    /// `Builder::places`.
    pub(crate) places: Vec<(u64, PackageID)>,
}

/// A number for the `node_modules` of each tree. It is the `place_key` of the tree's owner, and the
/// same in another hoist that has the folder.
pub(crate) fn folder_keys(trees: &[Tree], dependencies: &[Dependency]) -> Vec<u64> {
    let mut keys: Vec<u64> = Vec::with_capacity(trees.len());
    for tree in trees {
        // A tree follows its parent.
        let key = match (
            keys.get(tree.parent as usize),
            dependencies.get(tree.dependency_id as usize),
        ) {
            (Some(&parent), Some(owner)) => place_key(parent, owner.name_hash),
            _ => 0,
        };
        keys.push(key);
    }
    keys
}

pub(crate) fn place_key(folder_key: u64, name_hash: PackageNameHash) -> u64 {
    (folder_key.rotate_left(5) ^ name_hash).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

fn places_of(
    trees: &[Tree],
    rows: &[DependencyIDList],
    dependencies: &[Dependency],
    resolutions: &[PackageID],
) -> Vec<(u64, PackageID)> {
    let folders = folder_keys(trees, dependencies);
    let mut places = Vec::with_capacity(rows.iter().map(Vec::len).sum());
    for (&folder, rows) in folders.iter().zip(rows) {
        places.extend(rows.iter().map(|&row| {
            let name_hash = dependencies[row as usize].name_hash;
            (place_key(folder, name_hash), resolutions[row as usize])
        }));
    }
    places
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
    /// A peer got bound, or moved, and a pass that starts from that can place something elsewhere;
    /// see `Lockfile::resolve`.
    pub(crate) late_bound_peer: bool,
    /// `hoist_root_resolves_elsewhere` reads the rows of packages this pass has yet to walk.
    pub(crate) bundle_placed: bool,
    /// The packages whose rows this pass has walked; it walks them once per place of the package.
    pub(crate) walked: DynamicBitSet,
    /// Peers `bind_peer` bound, with the other package their dependent finds from its first place.
    pub(crate) served: Vec<(DependencyID, PackageID)>,
    pub(crate) manager: Option<&'a PackageManager>,
    pub(crate) sort_buf: Vec<DependencyID>,
    pub(crate) workspace_filters: &'a [WorkspaceFilter],
    pub(crate) install_root_dependencies: bool,
    pub(crate) packages_to_install: Option<&'a [PackageID]>,
    /// Workspace package ids that are hoisting barriers (self-contained node_modules).
    pub(crate) self_contained: Vec<PackageID>,
    pub(crate) peer_probes: PeerProbes,
    /// The first row of each name in each tree, which is what `hoist_dependency` looks for.
    pub(crate) placed: Placed,
    /// A row went to a later edge, so it no longer says which edge placed it.
    pub(crate) replaced_row: bool,
    /// Install-tree rows a tarball ships: placed as in the saved tree, then dropped by `clean`.
    pub(crate) shipped_rows: bun_collections::HashMap<(Id, DependencyID), ()>,
    /// The folder `process_subtree` is filling is one of `shipped_rows`.
    pub(crate) in_shipped_folder: bool,
    /// Install-tree places that two groups of one package want for different packages. The first
    /// group the run links fills it, so no other package shares what is there.
    pub(crate) contested: bun_collections::HashMap<(Id, PackageNameHash), ()>,
    /// The rows that did not get such a place. Each has one tree there, as a placed row has.
    pub(crate) contested_rows: bun_collections::HashMap<(Id, DependencyID), ()>,
    /// Install-tree rows this run links, each with the edge the installer reads. `None`: all.
    pub(crate) kept: Option<RowMap>,
    /// The install tree of bun 1.4.3 and before: what the run leaves out takes no place, so the
    /// rest moves up. `prune::remove_copies_of_the_older_layout` asks where that put a package.
    pub(crate) older_layout: bool,
    /// The `place_key` of every row and what is there. Empty if `older_layout` would give the rows of
    /// this run the places they have.
    pub(crate) places: Vec<(u64, PackageID)>,
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

/// Once all have a place: a peer of `Builder::served` that is no row of a tree takes that package.
pub(crate) fn bind_served_peers(
    served: &mut Vec<(DependencyID, PackageID)>,
    list: &MultiArrayList<BuilderEntry>,
    dependencies: &[Dependency],
    resolutions: &mut [PackageID],
) {
    if served.is_empty() {
        return;
    }
    let rows = list.items_dependencies().iter().flatten().copied();
    let mut placed: Vec<DependencyID> = rows
        .filter(|&row| dependencies[row as usize].behavior.is_peer())
        .collect();
    placed.sort_unstable();
    served.retain(|&(dep_id, _)| placed.binary_search(&dep_id).is_err());
    for (dep_id, pkg_id) in served.drain(..) {
        resolutions[dep_id as usize] = pkg_id;
    }
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

    /// What loading `bun.lock` binds a peer edge to at first. `None`: the edge keeps its package.
    #[inline]
    fn peer_by_version(&self, dep_id: DependencyID) -> Option<PackageID> {
        let lockfile = self.lockfile();
        bun_lock::resolve_peer_dep_version_based(
            &self.dependencies[dep_id as usize],
            &lockfile.catalogs,
            &lockfile.package_index,
            &lockfile.overrides,
            lockfile.packages.items_resolution(),
            lockfile.buffers.string_bytes.as_slice(),
            |_| true,
        )
    }

    /// Every tree of these packages places a peer from that binding, so they agree.
    #[inline]
    fn bind_peer(&mut self, dep_id: DependencyID) -> bool {
        let bound = self.peer_by_version(dep_id);
        if let Some(pkg_id) = bound {
            self.resolutions[dep_id as usize] = pkg_id;
        }
        bound.is_some()
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

    /// `None` without a `manager`: no run, so nothing is left out.
    fn linked_rows(&mut self) -> Option<LinkedRows<'_>> {
        Some(LinkedRows {
            manager: self.manager?,
            lockfile: self.lockfile.get(),
            trees: self.list.items_tree(),
            dependencies: self.dependencies,
            resolutions: &*self.resolutions,
            resolution_lists: self.resolution_lists,
            workspace_filters: self.workspace_filters,
            install_root_dependencies: self.install_root_dependencies,
            packages_to_install: self.packages_to_install,
            placed: &self.placed,
            replaced_row: self.replaced_row,
            shipped_rows: &self.shipped_rows,
            contested: &self.contested,
            linked: &mut self.linked,
        })
    }

    /// Fills `kept` and `places`.
    pub(crate) fn keep_linked_rows(&mut self) {
        if self.older_layout {
            return;
        }
        let Some(mut rows) = self.linked_rows() else {
            return;
        };
        let (kept, older_layout_can_differ) = rows.walk();
        self.kept = kept;
        if older_layout_can_differ {
            self.places = places_of(
                self.list.items_tree(),
                self.list.items_dependencies(),
                self.dependencies,
                &*self.resolutions,
            );
        }
    }
}

/// A name hash is a hash already.
#[derive(Default, Clone, Copy)]
pub(crate) struct PlaceContext;

impl bun_collections::HashContext<(Id, PackageNameHash)> for PlaceContext {
    #[inline]
    fn ctx_hash(key: &(Id, PackageNameHash)) -> u64 {
        key.1 ^ u64::from(key.0).wrapping_mul(0x9E37_79B9_7F4A_7C15)
    }
    #[inline]
    fn ctx_eql(a: &(Id, PackageNameHash), b: &(Id, PackageNameHash)) -> bool {
        a == b
    }
}

pub(crate) type Placed =
    bun_collections::HashMap<(Id, PackageNameHash), DependencyID, PlaceContext>;

/// A number for some rows of the trees. A row is in a second tree only if its owner is placed twice.
pub(crate) struct RowMap {
    /// By row: the first tree that had it, and the number there.
    first: Vec<Option<(Id, u32)>>,
    more: bun_collections::HashMap<(Id, DependencyID), u32>,
}

impl RowMap {
    fn new(rows: usize) -> RowMap {
        RowMap {
            first: vec![None; rows],
            more: Default::default(),
        }
    }

    fn get(&self, tree_id: Id, row: DependencyID) -> Option<u32> {
        match *self.first.get(row as usize)? {
            None => None,
            Some((first, number)) if first == tree_id => Some(number),
            Some(_) => self.more.get(&(tree_id, row)).copied(),
        }
    }

    fn get_mut(&mut self, tree_id: Id, row: DependencyID) -> Option<&mut u32> {
        match self.first.get_mut(row as usize)? {
            None => None,
            Some((first, number)) if *first == tree_id => Some(number),
            Some(_) => self.more.get_mut(&(tree_id, row)),
        }
    }

    fn insert(&mut self, tree_id: Id, row: DependencyID, number: u32) {
        match &mut self.first[row as usize] {
            Some((first, _)) if *first != tree_id => {
                self.more.insert((tree_id, row), number);
            }
            slot => *slot = Some((tree_id, number)),
        }
    }

    fn rows(&self) -> impl Iterator<Item = (Id, DependencyID)> + '_ {
        let first = self.first.iter().enumerate();
        first
            .filter_map(|(row, slot)| slot.map(|(tree_id, _)| (tree_id, row as DependencyID)))
            .chain(self.more.keys().copied())
    }
}

/// What `Builder::keep_linked_rows` reads of a finished install tree.
struct LinkedRows<'b> {
    manager: &'b PackageManager,
    lockfile: &'b Lockfile,
    trees: &'b [Tree],
    dependencies: &'b [Dependency],
    resolutions: &'b [PackageID],
    resolution_lists: &'b [DependencyIDSlice],
    workspace_filters: &'b [WorkspaceFilter],
    install_root_dependencies: bool,
    packages_to_install: Option<&'b [PackageID]>,
    placed: &'b Placed,
    replaced_row: bool,
    shipped_rows: &'b bun_collections::HashMap<(Id, DependencyID), ()>,
    contested: &'b bun_collections::HashMap<(Id, PackageNameHash), ()>,
    linked: &'b mut reachable::Linked,
}

impl LinkedRows<'_> {
    /// Whether this run leaves out the edge `dep_id` of `pkg_id`, a package that no tarball ships.
    fn leaves_out(&mut self, dep_id: DependencyID, pkg_id: PackageID) -> bool {
        let (manager, lockfile) = (self.manager, self.lockfile);
        let dep = &self.dependencies[dep_id as usize];
        let target = self.resolutions[dep_id as usize];
        if target == invalid_package_id {
            return true;
        }
        // What a tarball ships: see `shipped_rows`.
        if dep.behavior.is_bundled() {
            return false;
        }
        // As in `build_store`: the list replaces the filter for the root's own rows.
        let filtered = match self.packages_to_install.filter(|_| pkg_id == 0) {
            Some(packages_to_install) => !packages_to_install.contains(&target),
            None => is_filtered_dependency_or_workspace(
                dep_id,
                pkg_id,
                self.workspace_filters,
                self.install_root_dependencies,
                manager,
                lockfile,
                self.resolutions,
                self.linked,
            ),
        };
        filtered
            || pruned_workspaces::skips_link_to_pruned_workspace(
                manager, lockfile, pkg_id, dep, target,
            )
    }

    /// The rows this run's importers reach, each name looked up as node does. `None`: all.
    /// A pass of its own: an edge the run follows can lead to a row that one it leaves out placed.
    /// And `older_layout_can_differ`.
    fn walk(&mut self) -> (Option<RowMap>, bool) {
        let (dependencies, trees, lists) = (self.dependencies, self.trees, self.resolution_lists);

        // By edge, which has one owner.
        let mut left_out = vec![false; dependencies.len()];
        let mut any_left_out = false;
        for (pkg_id, list) in lists.iter().enumerate() {
            for dep_id in list.begin()..list.end() {
                let out = self.leaves_out(dep_id, pkg_id as PackageID);
                left_out[dep_id as usize] = out;
                any_left_out |= out && self.resolutions[dep_id as usize] != invalid_package_id;
            }
        }
        // A contested place has a tree for each group, and a run links one of them.
        if !any_left_out && self.contested.is_empty() {
            return (None, false);
        }

        let mut kept = RowMap::new(dependencies.len());

        // The `node_modules` of what an edge places in `parent`. Not by name: an unlinked member and
        // the losing group of a contested place have one too.
        let mut own_folder = RowMap::new(dependencies.len());
        for tree in trees.iter().skip(1) {
            own_folder.insert(tree.parent, tree.dependency_id, tree.id);
        }

        // The tree to look up from, the package, whether a tarball ships it.
        let mut todo: Vec<(Id, PackageID, bool)> = Vec::new();
        if !trees.is_empty() {
            todo.push((0, 0, false));
        }
        let mut walked = vec![false; lists.len()];
        while let Some((from, pkg_id, shipped)) = todo.pop() {
            walked[pkg_id as usize] = true;
            let list = self.resolution_lists[pkg_id as usize];
            'dep: for dep_id in list.begin()..list.end() {
                let dep = &dependencies[dep_id as usize];
                let target = self.resolutions[dep_id as usize];
                if target == invalid_package_id || (!shipped && left_out[dep_id as usize]) {
                    continue;
                }

                if pkg_id == 0
                    && dep.behavior.is_workspace()
                    && self.placed.get(&(0, dep.name_hash)) != Some(&dep_id)
                {
                    let own = own_folder.get(0, dep_id).unwrap_or(0);
                    todo.push((own, target, false));
                    continue;
                }

                let mut tree_id = from;
                let row = loop {
                    // Two kinds of row come after an edge found its package further up: another
                    // group's own copy, and, as in `hoist_dependency`, what a tarball ships.
                    if let Some(&row) = self.placed.get(&(tree_id, dep.name_hash))
                        && (self.resolutions[row as usize] == target
                            || !list.contains(row)
                            || self.contested.contains_key(&(tree_id, dep.name_hash)))
                        && (shipped
                            || dep.behavior.is_bundled()
                            || (dep.behavior.is_peer()
                                && dependencies[row as usize].behavior.is_bundled())
                            || !self.shipped_rows.contains_key(&(tree_id, row)))
                    {
                        break row;
                    }
                    tree_id = trees[tree_id as usize].parent;
                    if tree_id == INVALID_ID {
                        continue 'dep;
                    }
                };

                if let Some(edge) = kept.get_mut(tree_id, row) {
                    if dep_id == row {
                        *edge = row;
                    }
                    continue;
                }
                // A contested place goes to the group that placed the row, unless the run leaves it out.
                let takes_over = self.resolutions[row as usize] != target && list.contains(row);
                if takes_over && (shipped || !left_out[row as usize]) {
                    continue;
                }
                let filler = if takes_over { dep_id } else { row };
                // An edge this run follows: whether it is optional decides what a failure means.
                let follows = takes_over || self.resolutions[row as usize] == target;
                // Another package, found by name only: the run links it for its own edge or not at all.
                if !follows
                    && left_out[row as usize]
                    && !self.shipped_rows.contains_key(&(tree_id, row))
                {
                    continue;
                }
                kept.insert(tree_id, row, if follows { dep_id } else { row });
                let filler_pkg_id = self.resolutions[filler as usize];
                if filler_pkg_id != invalid_package_id {
                    let own = own_folder.get(tree_id, filler);
                    let shipped = self.shipped_rows.contains_key(&(tree_id, row));
                    todo.push((own.unwrap_or(tree_id), filler_pkg_id, shipped));
                }
            }
        }

        let can_differ = any_left_out && self.older_layout_can_differ(&kept, left_out, &walked);
        (Some(kept), can_differ)
    }

    /// The older layout is the hoist of the edges that the run follows, in the same order. An edge
    /// is placed as here unless one that the run does not follow got in its way or did its work:
    /// placed the row it shares, placed a row of its name above it, or placed a second copy of a
    /// linked package, whose edges then came early. A package also stays near a peer.
    fn older_layout_can_differ(&self, kept: &RowMap, mut idle: Vec<bool>, walked: &[bool]) -> bool {
        if self.replaced_row || !self.contested.is_empty() {
            return true;
        }
        for (pkg_id, list) in self.resolution_lists.iter().enumerate() {
            for dep_id in list.begin() as usize..list.end() as usize {
                if !walked[pkg_id] {
                    idle[dep_id] = true;
                } else if idle[dep_id]
                    && self.dependencies[dep_id].behavior.is_peer()
                    && self.resolutions[dep_id] != invalid_package_id
                {
                    return true;
                }
            }
        }
        let mut has_kept_row = vec![false; self.trees.len()];
        for (tree_id, row) in kept.rows() {
            if idle[row as usize] {
                return true;
            }
            has_kept_row[tree_id as usize] = true;
        }
        let mut in_the_way: Vec<PackageNameHash> = Vec::new();
        for (&(tree_id, name_hash), &row) in self.placed.iter() {
            let target = self.resolutions[row as usize] as usize;
            if target >= walked.len() || kept.get(tree_id, row).is_some() {
                continue;
            }
            if walked[target] && self.resolution_lists[target].len > 0 {
                return true;
            }
            if tree_id == 0 || has_kept_row[tree_id as usize] {
                in_the_way.push(name_hash);
            }
        }
        in_the_way.sort_unstable();
        !in_the_way.is_empty()
            && kept.rows().any(|(_, row)| {
                in_the_way
                    .binary_search(&self.dependencies[row as usize].name_hash)
                    .is_ok()
            })
    }
}

impl<'a, const METHOD: BuilderMethod> Builder<'a, METHOD> {
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
            // `is_unlinked_member` looks for the owner's row in the parent's list.
            if let Some(kept) = &self.kept
                && let Some(edge) = kept.get(tree.parent, tree.dependency_id)
            {
                tree.dependency_id = edge;
            }
            let child = core::mem::take(child);
            let off: u32 = dep_ids.len() as u32;
            for &dep_id in child.iter() {
                let pkg_id = self.resolutions[dep_id as usize];
                if pkg_id == invalid_package_id {
                    // peers that never resolved
                    continue;
                }
                let shipped = !self.shipped_rows.is_empty()
                    && self.shipped_rows.contains_key(&(tree.id, dep_id));
                let edge = match &self.kept {
                    None => Some(dep_id),
                    Some(kept) => kept.get(tree.id, dep_id),
                };
                let (false, Some(edge)) = (shipped, edge) else {
                    continue;
                };

                dep_ids.push(edge);
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
        return linked.is_member_outside(lockfile, parent_pkg_id);
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

        // The install tree has no folder there. The saved tree does not depend on the disk.
        if METHOD == BuilderMethod::Filter
            && builder.lockfile.get().is_member_outside(parent_pkg_id)
        {
            return Ok(());
        }

        // A link to a member from below that member: what it needs has its places further up.
        if dependency_id != ROOT_DEP_ID
            && !builder.dependencies[dependency_id as usize]
                .behavior
                .is_workspace()
            && builder.lockfile().packages.items_resolution()[parent_pkg_id as usize].tag
                == crate::resolution::Tag::Workspace
        {
            let mut tree_id = self.id;
            while tree_id != INVALID_ID {
                let tree: Tree = builder.list.items_tree()[tree_id as usize];
                if builder.resolutions.get(tree.dependency_id as usize) == Some(&parent_pkg_id) {
                    return Ok(());
                }
                tree_id = tree.parent;
            }
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
        let first_walk = !builder.walked.is_set(parent_pkg_id as usize);
        builder.walked.set(parent_pkg_id as usize);

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
            let bound_by_version = builder.bind_peer(dep_id);
            let pkg_id = builder.resolutions[dep_id as usize];
            let dependency = &dependencies[dep_id as usize];

            // unresolved packages already had their chance to resolve. Not what a tarball ships.
            if METHOD == BuilderMethod::Filter
                && !shipped
                && !dependency.behavior.is_bundled()
                && pkg_id == invalid_package_id
            {
                continue;
            }
            if builder.older_layout
                && !shipped
                && (builder.linked_rows())
                    .is_some_and(|mut rows| rows.leaves_out(dep_id, parent_pkg_id))
            {
                continue;
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
            // Nothing has read a row before the first walk of its package. So the pass that starts
            // from the row on `res_id` is this pass again if the row shares that copy from here.
            let stays_on = |res_id: PackageID, builder: &mut Builder<'_, METHOD>| {
                first_walk
                    && !builder.bundle_placed
                    && matches!(
                        Tree::hoist_dependency::<true, METHOD>(
                            next_id,
                            hoist_root_id,
                            res_id,
                            dep_id,
                            resolution_list,
                            builder,
                        ),
                        HoistDependencyResult::Hoisted
                    )
            };

            let hoisted: HoistDependencyResult = 'hoisted: {
                // don't hoist if it's a folder dependency or a bundled dependency.
                if dependency.behavior.is_bundled() {
                    builder.bundle_placed = true;
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
                        && let provided @ (HoistDependencyResult::Hoisted
                        | HoistDependencyResult::Served(_)) = hoist(hoist_root_id, &mut *builder)
                    {
                        break 'hoisted provided;
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

                HoistDependencyResult::Served(res_id) => {
                    // One row for all places of its package: the first decides, as in `Rebind`.
                    if first_walk && bound_by_version {
                        builder.served.push((dep_id, res_id));
                    }
                }
                HoistDependencyResult::Contested { id } => {
                    builder.contested.insert((id, dependency.name_hash), ());
                    // No row, but a tree: what this package needs has places for when it is linked.
                    // Its owner can be walked again from below that tree, so only the first time.
                    if builder.contested_rows.insert((id, dep_id), ()).is_none()
                        && builder.resolution_lists[pkg_id as usize].len > 0
                    {
                        builder.queue.write_item(FillItem {
                            tree_id: id,
                            dependency_id: dep_id,
                            hoist_root_id,
                        })?;
                    }
                }
                HoistDependencyResult::Resolve(res_id) => {
                    debug_assert!(pkg_id == invalid_package_id);
                    debug_assert!(res_id != invalid_package_id);
                    // Only this walk found the copy: `pending_peers` wait on a row in another tree.
                    // As in `Rebind`. Bound later, an optional peer gets a copy at its first place.
                    if first_walk || !dependency.behavior.is_optional_peer() {
                        builder.resolutions[dep_id as usize] = res_id;
                        // Bound, it can get a copy of its own next to a peer of that package.
                        if !stays_on(res_id, &mut *builder) {
                            builder.late_bound_peer = true;
                        }
                    }
                }
                HoistDependencyResult::ResolveReplace {
                    id,
                    dep_id: replaced,
                } => {
                    debug_assert!(pkg_id != invalid_package_id);
                    builder.replaced_row = true;
                    // A member only loses the link: its tree is queued, and holds what cannot hoist.
                    if !dependencies[replaced as usize].behavior.is_workspace() {
                        builder.late_bound_peer = true;
                        builder.resolutions[replaced as usize] = pkg_id;
                        builder.bind_pending_peers(dependency.name_hash, pkg_id);
                    }
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
                    // One row for all places of its package: the first decides, alike in each pass.
                    if first_walk {
                        builder.resolutions[dep_id as usize] = res_id;
                        if !stays_on(res_id, &mut *builder) {
                            builder.late_bound_peer = true;
                        }
                    }
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
                    // Its own dependency of that name is what the package loads, from wherever that
                    // one found its copy. A copy for the peer would stand in front of it.
                    if dependency.behavior.is_peer()
                        && !bundled
                        && let Some(own) =
                            (resolution_list.begin()..resolution_list.end()).find(|&own| {
                                let own_row = &dependencies[own as usize];
                                own_row.name_hash == dependency.name_hash
                                    && !own_row.behavior.is_peer()
                                    && builder.resolutions[own as usize] != invalid_package_id
                            })
                    {
                        let own_pkg_id = builder.resolutions[own as usize];
                        let own_behavior = dependencies[own as usize].behavior;
                        let buf = lockfile.buffers.string_bytes.as_slice();
                        // As for `Served`.
                        if first_walk
                            && bound_by_version
                            && !own_behavior.is_optional()
                            && !own_behavior.is_bundled()
                            && pkg_resolutions[own_pkg_id as usize].satisfies_dependency_version(
                                lockfile.catalogs.resolve_range(buf, dependency),
                                buf,
                                buf,
                            )
                        {
                            builder.served.push((dep_id, own_pkg_id));
                        }
                        continue 'dep;
                    }
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

            if !builder.contested.is_empty()
                && !input_dep_range.contains(dep_id)
                && (builder.contested).contains_key(&(this.id, dependency.name_hash))
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

            let is_in_peer_range = || {
                let range = (builder.lockfile().catalogs).resolve_range(builder.buf(), dependency);
                let resolution: &Resolution =
                    &builder.lockfile().packages.items_resolution()[res_id as usize];
                range.tag == crate::dependency::VersionTag::Npm
                    && resolution.tag == crate::resolution::Tag::Npm
                    && (range.npm().version).satisfies(
                        resolution.npm().version,
                        builder.buf(),
                        builder.buf(),
                    )
            };
            // An install that leaves nothing out links such a row on every platform.
            let is_always_linked =
                |row: &Dependency| !row.behavior.is_optional() && !row.behavior.is_bundled();

            if input_dep_range.contains(dep_id) {
                // The root's own dependency takes the folder from the member of that name, unless
                // an earlier group asks for the member.
                if dep.behavior.is_workspace()
                    && !(input_dep_range.begin()..input_dep_id).any(|earlier| {
                        let row = &deps[earlier as usize];
                        row.name_hash == dependency.name_hash
                            && !row.behavior.is_workspace()
                            && !row.behavior.is_peer()
                            && builder.resolutions[earlier as usize] == res_id
                    })
                {
                    return HoistDependencyResult::ResolveReplace {
                        id: this.id,
                        dep_id,
                    };
                }
                // Its own dependency of that name is what the package loads, in every run.
                if dependency.behavior.is_peer()
                    && !dependency.behavior.is_optional_peer()
                    && is_always_linked(dep)
                    && is_in_peer_range()
                {
                    return HoistDependencyResult::Served(res_id); // 1
                }
                // The root's rows again, below a link to the project: this member has its tree.
                if dependency.behavior.is_workspace() {
                    return HoistDependencyResult::Hoisted; // 1
                }
                // same package lists this name in another dependency group
                if METHOD == BuilderMethod::Filter {
                    return HoistDependencyResult::Contested { id: this.id };
                }
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
                let is_root_dependency = builder.lockfile().is_workspace_root_dependency(dep_id);
                let own_dependency_shares_it = || {
                    !dependency.behavior.is_optional_peer()
                        && (input_dep_range.begin()..input_dep_range.end()).any(|own| {
                            let own_row = &deps[own as usize];
                            own_row.name_hash == dependency.name_hash
                                && !own_row.behavior.is_peer()
                                && is_always_linked(own_row)
                                && builder.resolutions[own as usize] == res_id
                        })
                };

                if is_in_peer_range() {
                    // The two rows that provide a name under both linkers, wherever the package is.
                    if !dependency.behavior.is_optional_peer()
                        && ((is_root_dependency && is_always_linked(dep))
                            || own_dependency_shares_it())
                    {
                        return HoistDependencyResult::Served(res_id); // 1
                    }
                    return dedupe(); // 1
                }

                // Root dependencies are manually chosen by the user. Allow them
                // to hoist other peers even if they don't satisfy the version
                if is_root_dependency {
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
                // Until this pass walks its package, a peer has what the last pass `served` it.
                dep.name_hash == name_hash
                    && !dep.behavior.is_bundled()
                    && (builder.peer_by_version(dep_id)).unwrap_or(resolutions[dep_id as usize])
                        != package_id
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
        if tree.is_unlinked_member(trees, hoisted, dependencies) {
            continue;
        }
        let name_hash = dependencies[tree.dependency_id as usize].name_hash;
        own_folder.insert((tree.parent, name_hash), tree.id);
    }

    // What each folder holds under a name.
    let mut placed: HashMap<(Id, PackageNameHash), PackageID> = HashMap::default();
    for (tree_id, tree) in trees.iter().enumerate() {
        for &dep_id in tree.dependencies.get(hoisted) {
            placed
                .entry((tree_id as Id, dependencies[dep_id as usize].name_hash))
                .or_insert_with(|| resolutions[dep_id as usize]);
        }
    }

    let resolve_from = |mut tree_id: Id, name_hash: PackageNameHash| -> Option<PackageID> {
        while let Some(tree) = trees.get(tree_id as usize) {
            if let Some(&pkg_id) = placed.get(&(tree_id, name_hash)) {
                return Some(pkg_id);
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
