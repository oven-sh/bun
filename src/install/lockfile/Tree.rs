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

    /// Returns true if this tree belongs to a workspace that has no symlink in the root
    /// `node_modules`, because `hoist_dependency` gave its name to one of the root's dependencies.
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
    /// `Filter` only: the same package lists this name in another dependency group, which resolves
    /// to a different package and already has the name's row in tree `id`.
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
    /// Like `Hoisted`, but the required peer was deduplicated onto this package instead of the one
    /// it resolves to.
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
            // The buffer is reused. An unlinked workspace package's path overwrites this prefix.
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
            let mut is_workspace_path = false;
            // The tree of an unlinked workspace package is a child of the root tree, so this is the
            // first component. The path starts at the package's own folder, or `./` in bun.lock.
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
                    // A workspace can be outside the project, e.g. `../shared`.
                    is_workspace_path = true;
                }
            }
            if !is_workspace_path && !crate::dependency::is_safe_install_folder_name(name) {
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

    /// For installing. Every dependency is hoisted first, so where a package is installed does not
    /// depend on this install's options. Then `keep_linked_rows` drops what this install skips.
    Filter,
}

/// Where the `Filter` tree places the remaining packages when an install skips some dependencies.
#[derive(PartialEq, Eq, Clone, Copy)]
pub(crate) enum Layout {
    /// Every package is placed where bun.lock has it.
    Locked,
    /// See `Builder::older_layout`.
    Older,
}

/// What `Lockfile::hoist` returns, besides the trees it stores in the lockfile.
pub(crate) struct Hoisted {
    /// See `Builder::late_bound_peer`.
    pub(crate) late_bound_peer: bool,
    /// See `Builder::places`.
    pub(crate) places: Vec<(u64, PackageID)>,
}

/// Returns a key for each tree's `node_modules` folder: the `place_key` of the package that owns
/// the folder. Two hoists give the same folder the same key, even when its tree id differs.
pub(crate) fn folder_keys(trees: &[Tree], dependencies: &[Dependency]) -> Vec<u64> {
    let mut keys: Vec<u64> = Vec::with_capacity(trees.len());
    for tree in trees {
        // A tree always comes after its parent, so the parent's key is already in `keys`.
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
    /// This pass changed what a peer resolves to, and a pass that starts from the new resolution
    /// could place a package somewhere else. `Lockfile::resolve` hoists again while this is set.
    pub(crate) late_bound_peer: bool,
    /// This pass placed a bundled dependency. From then on, `hoist_root_resolves_elsewhere` may
    /// read the dependencies of packages that this pass has not walked yet.
    pub(crate) bundle_placed: bool,
    /// The packages whose dependencies this pass has walked. A package is walked again for every
    /// tree it is placed in.
    pub(crate) walked: DynamicBitSet,
    /// Peers that `bind_peer` resolved by version, each with the different package that its
    /// dependent finds from the first tree it is placed in. See `bind_served_peers`.
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
    /// A later dependency replaced a row, so a row no longer tells which dependency placed it.
    pub(crate) replaced_row: bool,
    /// `Filter` tree rows for packages that ship inside a tarball. They're placed like in the saved
    /// tree, and `clean` drops them afterwards.
    pub(crate) shipped_rows: bun_collections::HashMap<(Id, DependencyID), ()>,
    /// True if the folder that `process_subtree` is filling is one of `shipped_rows`.
    pub(crate) in_shipped_folder: bool,
    /// `Filter` only: the `(tree, name)` places where two dependency groups of one package resolve
    /// the name to different packages. Which one is installed depends on what the install skips.
    pub(crate) contested: bun_collections::HashMap<(Id, PackageNameHash), ()>,
    /// The dependencies that did not get the row at a contested place. Each still gets one tree of
    /// its own below that place, as a placed row does.
    pub(crate) contested_rows: bun_collections::HashMap<(Id, DependencyID), ()>,
    /// `Filter` only: the rows this install keeps, each mapped to the dependency id that `clean`
    /// writes in its place for the installer to read. `None` keeps every row as it is.
    pub(crate) kept: Option<RowMap>,
    /// Builds the `Filter` tree as Bun 1.4.3 and earlier did: skipped dependencies are not placed
    /// at all, so other packages hoist higher. See `prune::remove_copies_of_the_older_layout`.
    pub(crate) older_layout: bool,
    /// The `place_key` of every row, with the package placed there. Left empty when `older_layout`
    /// would place every row that this install keeps exactly where it is now.
    pub(crate) places: Vec<(u64, PackageID)>,
    pub(crate) linked: reachable::Linked,
}

/// The peers of the package that's being hoisted. Each one comes with whether the package loads an
/// in-range copy from the highest folder checked so far, and with the copy that its owner uses.
///
/// An optional peer is only listed if the owner provides it. The bit sets cache which packages have
/// peers, and which packages a regular dependency resolves to.
#[derive(Default)]
pub(crate) struct PeerProbes(
    Vec<(DependencyID, bool, OwnerCopy)>,
    Option<DynamicBitSet>,
    Option<DynamicBitSet>,
);

/// The copy of a peer that the owner of the package uses too.
#[derive(Clone, Copy)]
enum OwnerCopy {
    /// The owner doesn't use the peer, or it only has a peer dependency on the package.
    None,
    /// The owner has the same peer dependency, so it uses the first copy above it.
    FirstAbove,
    /// The owner depends on this copy.
    Package(PackageID),
}

impl PeerProbes {
    /// `package_id` is about to be hoisted out of the package with `owner_deps`.
    fn begin(
        &mut self,
        lockfile: &Lockfile,
        deps: &[Dependency],
        resolutions: &[PackageID],
        owner_deps: DependencyIDSlice,
        package_id: PackageID,
        is_for_peer: bool,
    ) {
        self.0.clear();
        if package_id == invalid_package_id {
            return;
        }

        let is_probed = |peer: &Dependency| {
            peer.behavior.is_peer() && peer.version.tag == crate::dependency::VersionTag::Npm
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
                .map(|dep_id| resolutions[dep_id as usize]);
            let is_listed = match owner_copy {
                Some(id) => pkg_resolutions[id as usize].satisfies_dependency_version(
                    &peer.version,
                    buf,
                    buf,
                ),
                None => !peer.behavior.is_optional_peer(),
            };
            if is_listed {
                let has_same_peer = || {
                    (owner_deps.begin()..owner_deps.end()).any(|dep_id| {
                        let dep = &deps[dep_id as usize];
                        dep.name_hash == peer.name_hash && !dep.behavior.is_optional_peer()
                    })
                };
                let used_by_owner = match owner_copy {
                    _ if is_for_peer => OwnerCopy::None,
                    Some(copy) => OwnerCopy::Package(copy),
                    None if has_same_peer() => OwnerCopy::FirstAbove,
                    None => OwnerCopy::None,
                };
                self.0
                    .push((peer_dep_id, owner_copy.is_some(), used_by_owner));
            }
        }
    }

    /// Returns true if the package must not be hoisted into tree `tree_id`, because it would stop
    /// loading the copy of a peer that it loads now. That's the case if the tree has:
    /// - an out-of-range version of a required peer, or
    /// - a different version than the package's owner uses, which was only installed for another
    ///   package's peer dependency. Adding an unrelated package to a project must not split a
    ///   plugin from its host. This doesn't apply to a package that's hoisted for a peer
    ///   dependency. As in pnpm, it belongs to the project.
    fn is_hidden_by(
        &mut self,
        lockfile: &Lockfile,
        deps: &[Dependency],
        resolutions: &[PackageID],
        placed: &Placed,
        tree_id: Id,
    ) -> bool {
        let pkg_resolutions = lockfile.packages.items_resolution();
        let buf = lockfile.buffers.string_bytes.as_slice();

        let mut i = 0;
        while i < self.0.len() {
            let (peer_dep_id, provided, owner_copy) = self.0[i];
            let peer = &deps[peer_dep_id as usize];
            let Some(held) = placed
                .get(&(tree_id, peer.name_hash))
                .map(|&row| resolutions[row as usize])
                .filter(|&res_id| res_id != invalid_package_id)
            else {
                i += 1;
                continue;
            };
            let is_optional = peer.behavior.is_optional_peer();
            if pkg_resolutions[held as usize].satisfies_dependency_version(&peer.version, buf, buf)
            {
                match owner_copy {
                    OwnerCopy::Package(copy) if copy != held => {
                        if !(self.2)
                            .get_or_insert_with(|| regular_targets(lockfile, deps, resolutions))
                            .is_set(held as usize)
                        {
                            return true;
                        }
                        self.0[i].2 = OwnerCopy::None;
                    }
                    OwnerCopy::FirstAbove => self.0[i].2 = OwnerCopy::Package(held),
                    _ => {}
                }
                self.0[i].1 |= !is_optional;
                i += 1;
            } else if provided && !is_optional {
                return true;
            } else {
                // Out of range wherever the package ends up.
                self.0.swap_remove(i);
            }
        }

        false
    }
}

/// Returns the packages that a dependency other than a peer dependency resolves to.
fn regular_targets(
    lockfile: &Lockfile,
    deps: &[Dependency],
    resolutions: &[PackageID],
) -> DynamicBitSet {
    let mut set = DynamicBitSet::init_empty(lockfile.packages.len()).unwrap_or_oom();
    for (dep, &id) in deps.iter().zip(resolutions) {
        if !dep.behavior.is_peer() && id != invalid_package_id {
            set.set(id as usize);
        }
    }
    set
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

/// Returns `Some(n)` if two identical rounds of `n` trees end at `parent`, which means a third
/// round would nest forever.
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

/// Runs once everything is placed. Resolves each peer in `Builder::served` to the package recorded
/// with it, unless the peer itself is a row in some tree.
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

    /// The package that loading `bun.lock` first resolves a peer to, going by its version range.
    /// `None` means the dependency keeps the package it resolves to now.
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

    /// Resolves a peer to `peer_by_version` before it is placed, so that every hoist of the same
    /// packages starts from the same resolution. Returns whether `peer_by_version` found a package.
    #[inline]
    fn bind_peer(&mut self, dep_id: DependencyID) -> bool {
        if !self.dependencies[dep_id as usize].behavior.is_peer() {
            return false;
        }
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
            "cannot install dependency cycle into node_modules: {}",
            (bun_core::fmt::for_terminal(bstr::BStr::new(&cycle)),),
        );
        bun_core::note!(
            "each needs a nested copy of the next, forever. Pin one to a single version with \"overrides\" in package.json"
        );
        bun_core::Global::crash();
    }

    /// Returns `None` without a `manager`: there is no install, so no dependency is skipped.
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

    /// Computes `kept`, and also `places` if the older layout could differ from this one.
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

/// Hashes a `(tree, name hash)` key cheaply, because the name hash is already well distributed.
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

/// Maps a `(tree, row)` pair to a `u32`, where a row is a dependency id in that tree's list. Most
/// rows are in only one tree, which `first` covers. `more` holds the rest.
pub(crate) struct RowMap {
    /// Indexed by row: the first tree inserted for the row, and the value of that pair.
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

    fn rows(&self) -> impl core::iter::Iterator<Item = (Id, DependencyID)> + '_ {
        let first = self.first.iter().enumerate();
        first
            .filter_map(|(row, slot)| slot.map(|(tree_id, _)| (tree_id, row as DependencyID)))
            .chain(self.more.keys().copied())
    }
}

/// The parts of a `Builder` that `keep_linked_rows` reads once the `Filter` tree is built.
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
    /// Returns true if this install skips the dependency `dep_id` of `pkg_id`. The answer doesn't
    /// apply to a copy of `pkg_id` that's bundled in another package's tarball, which skips
    /// nothing.
    fn leaves_out(&mut self, dep_id: DependencyID, pkg_id: PackageID) -> bool {
        let (manager, lockfile) = (self.manager, self.lockfile);
        let dep = &self.dependencies[dep_id as usize];
        let target = self.resolutions[dep_id as usize];
        if target == invalid_package_id {
            return true;
        }
        // A bundled dependency is never skipped here: see `shipped_rows`.
        if dep.behavior.is_bundled() {
            return false;
        }
        // As in `build_store`, `packages_to_install` replaces the filters for the root's own rows.
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

    /// Returns the rows that the root reaches without a skipped dependency (`None` means all rows)
    /// and `older_layout_can_differ`. Names are resolved as Node does, so this runs after hoisting.
    fn walk(&mut self) -> (Option<RowMap>, bool) {
        let (dependencies, trees, lists) = (self.dependencies, self.trees, self.resolution_lists);

        // Indexed by dependency id. Each dependency belongs to exactly one package.
        let mut left_out = vec![false; dependencies.len()];
        let mut any_left_out = false;
        for (pkg_id, list) in lists.iter().enumerate() {
            for dep_id in list.begin()..list.end() {
                let out = self.leaves_out(dep_id, pkg_id as PackageID);
                left_out[dep_id as usize] = out;
                any_left_out |= out && self.resolutions[dep_id as usize] != invalid_package_id;
            }
        }
        // Even if nothing is skipped, only one of the trees at a contested place is installed.
        if !any_left_out && self.contested.is_empty() {
            return (None, false);
        }

        let mut kept = RowMap::new(dependencies.len());

        // Maps `(parent tree, dependency)` to the dependency's own tree. It is not keyed by name,
        // because a dependency that got no row can have a tree under the same name as a row.
        let mut own_folder = RowMap::new(dependencies.len());
        for tree in trees.iter().skip(1) {
            own_folder.insert(tree.parent, tree.dependency_id, tree.id);
        }

        // Each item: the tree to start lookups from, the package, and whether that copy is bundled.
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
                    // Skip a row from another dependency group of the same package, and a bundled
                    // row. Both were placed after this dependency found its package higher up.
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
                // The dependency that placed the row keeps a contested place, unless it is skipped.
                let takes_over = self.resolutions[row as usize] != target && list.contains(row);
                if takes_over && (shipped || !left_out[row as usize]) {
                    continue;
                }
                let filler = if takes_over { dep_id } else { row };
                // Record a dependency that is not skipped. The installer reads from it whether the
                // package is optional, which decides how a failure to install it is reported.
                let follows = takes_over || self.resolutions[row as usize] == target;
                // The row holds a different package, which is kept only if its own dependency is.
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

    /// Returns true if `older_layout` could place a kept row somewhere else. That layout only
    /// hoists the dependencies that this install keeps, so it only differs if a skipped one moved a
    /// kept row.
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
            // The parent's list gets `edge` in place of this row, and `is_unlinked_member` looks
            // for `tree.dependency_id` in that list.
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

    // Peers are excluded, because an ancestor's copy can satisfy one. `process_subtree` and
    // `build_store` decide that.
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

        // This dependency links back to a workspace package from inside that package's own tree.
        // The ancestor tree already places what the workspace package needs.
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

            // Unresolved packages already had their chance to resolve. Bundled ones are still kept.
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
            // Returns true if resolving `dep_id` to `res_id` doesn't need another pass. Nothing
            // reads a resolution before the first walk of the package that lists it, so another
            // pass would give the same result.
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

                    // It's its own hoist root, so it stays in this tree and only dedupes against a
                    // sibling with the same name.
                    break 'hoisted hoist(next_id, &mut *builder);
                }

                hoist(hoist_root_id, &mut *builder)
            };

            match hoisted {
                HoistDependencyResult::DependencyLoop | HoistDependencyResult::Hoisted => continue,

                HoistDependencyResult::Served(res_id) => {
                    // A dependency has one resolution, however many times its package is placed.
                    // The first placement decides it, as in `Rebind`.
                    if first_walk && bound_by_version {
                        builder.served.push((dep_id, res_id));
                    }
                }
                HoistDependencyResult::Contested { id } => {
                    builder.contested.insert((id, dependency.name_hash), ());
                    // The dependency gets no row but still gets a tree, so its own dependencies are
                    // placed in case `keep_linked_rows` picks it.
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
                    // As in `Rebind`, only the first walk resolves an optional peer. Resolved on a
                    // later walk, it would get its own copy at the package's first placement.
                    if first_walk || !dependency.behavior.is_optional_peer() {
                        builder.resolutions[dep_id as usize] = res_id;
                        // Once resolved, it may get a copy of its own next to a peer of `res_id`.
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
                    // A replaced workspace package keeps its resolution and only loses its symlink.
                    // Its tree is already queued, and holds the dependencies that cannot hoist.
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
                    // A dependency has one resolution, however many times its package is placed.
                    // The first placement decides it, and that is the same one in every pass.
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
                    // The package also lists this name as a regular dependency, and loads that copy
                    // wherever it was placed. A copy for the peer would shadow it.
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
                        // Recorded under the same conditions as a `Served` result.
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
                    // Only a placed row becomes a folder name. For an unresolved dependency,
                    // enqueue already reported the name.
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
                                "invalid dependency name \"{}\"",
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
                &builder.placed,
                this.id,
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

            // A dependency that Bun installs never resolves to a row that a tarball ships. The
            // exception is a peer, which shares the bundled copy.
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

            // The copy that a tarball ships stays in this folder, whether or not it's resolved.
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
            // Every platform installs such a dependency, unless an option like `--omit` skips it.
            let is_always_linked =
                |row: &Dependency| !row.behavior.is_optional() && !row.behavior.is_bundled();

            if input_dep_range.contains(dep_id) {
                // Only a bun.lockb from Bun 1.4 or older has a tag of a workspace's name as a
                // registry version. Their hoisted linker linked the workspace.
                if METHOD == BuilderMethod::Filter
                    && dep.behavior.is_workspace()
                    && dependency.version.tag == crate::dependency::VersionTag::DistTag
                    && (dependency.version.dist_tag().name).eql(
                        dependency.name,
                        builder.buf(),
                        builder.buf(),
                    )
                {
                    return HoistDependencyResult::Hoisted; // 1
                }
                // A root dependency named like a workspace package takes `node_modules/<name>` from
                // it, unless an earlier dependency group resolves to the workspace package.
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
                // The package's own dependency of this name is always installed, so the peer
                // resolves to it.
                if dependency.behavior.is_peer()
                    && !dependency.behavior.is_optional_peer()
                    && is_always_linked(dep)
                    && is_in_peer_range()
                {
                    return HoistDependencyResult::Served(res_id); // 1
                }
                // The root's dependencies are being walked again, below a link to the project
                // itself. This workspace package already has its tree.
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
                // An override chose this peer's package, so an alias of a different package can't
                // stand in for it.
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
                    // A root dependency and the package's own dependency provide the name under
                    // both the hoisted and the isolated linker, wherever the package is placed.
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
                    dependency.behavior.is_peer(),
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

        // Check whether the hoist root is a bundle. In the install tree, it's only one for the rows
        // that it ships.
        if (METHOD == BuilderMethod::Resolvable || builder.in_shipped_folder)
            && this.id == hoist_root_id
        {
            // A bundle's dependency stops here, but it must not shadow a package that other
            // dependencies resolve through this folder.
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

    /// Returns true if a dependency on `name_hash` that loading `bun.lock` would rebind to
    /// `hoist_root` really resolves to a different package.
    fn hoist_root_resolves_elsewhere<const METHOD: BuilderMethod>(
        hoist_root: Id,
        package_id: PackageID,
        name_hash: PackageNameHash,
        builder: &Builder<'_, METHOD>,
    ) -> bool {
        // An unbound optional peer has no entry in bun.lock. Once it's bound, `Lockfile::resolve`
        // hoists again.
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
                // Until this pass walks a peer's package, `resolutions` holds what the last pass
                // wrote in `bind_served_peers`. Ask `peer_by_version` first, as `bind_peer` will.
                dep.name_hash == name_hash
                    && !dep.behavior.is_bundled()
                    && (builder.peer_by_version(dep_id)).unwrap_or(resolutions[dep_id as usize])
                        != package_id
            })
        };

        // Returns `tree_owner`'s regular dependencies that are placed in its own node_modules,
        // `tree_id`.
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

        // The nested packages' own trees contain more of them. A tree always comes after its
        // parent.
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

/// Returns every `(peer dependency, package)` pair that some placement of the owner resolves,
/// nearest folder first.
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
