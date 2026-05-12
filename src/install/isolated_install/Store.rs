use core::cmp::Ordering;
use core::fmt;
use core::marker::PhantomData;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, MultiArrayList};
use bun_semver::String as SemverString;

use crate::lockfile::{Lockfile, package};
use crate::{Dependency, DependencyID, INVALID_DEPENDENCY_ID, PackageID};

pub use super::installer::Installer;

bun_output::declare_scope!(Store, visible);

#[derive(Copy, Clone)]
pub struct Ids {
    pub dep_id: DependencyID,
    pub pkg_id: PackageID,
}

pub struct Store {
    /// Accessed from multiple threads
    pub entries: entry::List,
    pub nodes: node::List,
}

pub const MODULES_DIR_NAME: &[u8] = b".bun";

// ──────────────────────────────────────────────────────────────────────────
// NewId<T> — Zig: `fn NewId(comptime T: type) type { return enum(u32) { root=0, invalid=max, _ } }`
// Rust generic newtypes are nominally distinct, so `NewId<Entry> != NewId<Node>` holds by
// construction (the Zig `comptime { bun.assert(NewId(Entry) != NewId(Node)) }` block is a no-op).
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
pub struct NewId<T>(u32, PhantomData<fn() -> T>);

impl<T> Clone for NewId<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for NewId<T> {}
impl<T> PartialEq for NewId<T> {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
impl<T> Eq for NewId<T> {}
impl<T> core::hash::Hash for NewId<T> {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}
impl<T> Default for NewId<T> {
    // Zig leaves this undefined; pick the sentinel so accidental use trips
    // the debug_assert in `get()`.
    fn default() -> Self {
        Self::INVALID
    }
}
impl<T> fmt::Debug for NewId<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0 == Self::MAX {
            f.write_str("invalid")
        } else {
            write!(f, "{}", self.0)
        }
    }
}

impl<T> NewId<T> {
    const MAX: u32 = u32::MAX;

    pub const ROOT: Self = Self(0, PhantomData);
    pub const INVALID: Self = Self(Self::MAX, PhantomData);

    pub fn from(id: u32) -> Self {
        debug_assert!(id != Self::MAX);
        Self(id, PhantomData)
    }

    pub fn get(self) -> u32 {
        debug_assert!(self != Self::INVALID);
        self.0
    }

    pub fn try_get(self) -> Option<u32> {
        if self == Self::INVALID {
            None
        } else {
            Some(self.0)
        }
    }

    pub fn get_or(self, default: u32) -> u32 {
        if self == Self::INVALID {
            default
        } else {
            self.0
        }
    }
}

impl Store {
    /// Called from multiple threads. `parent_dedupe` should not be shared between threads.
    pub fn is_cycle(
        &self,
        id: entry::Id,
        maybe_parent_id: entry::Id,
        parent_dedupe: &mut ArrayHashMap<entry::Id, ()>,
    ) -> bool {
        use entry::EntryColumns as _;
        let mut i: usize = 0;
        let mut len: usize;

        // Zig `.items(.parents)` → derive(MultiArrayElement)-generated `.items_parents()`.
        let entry_parents = self.entries.items_parents();

        for &parent_id in entry_parents[id.get() as usize].as_slice() {
            if parent_id == entry::Id::INVALID {
                continue;
            }
            if parent_id == maybe_parent_id {
                return true;
            }
            let _ = parent_dedupe.put(parent_id, ()); // OOM-only Result (Zig: catch unreachable)
        }

        len = parent_dedupe.len();
        while i < len {
            // PORT NOTE: reshaped for borrowck — capture key before mutating `parent_dedupe`.
            let key = parent_dedupe.keys()[i];
            for &parent_id in entry_parents[key.get() as usize].as_slice() {
                if parent_id == entry::Id::INVALID {
                    continue;
                }
                if parent_id == maybe_parent_id {
                    return true;
                }
                let _ = parent_dedupe.put(parent_id, ()); // OOM-only Result (Zig: catch unreachable)
                len = parent_dedupe.len();
            }
            i += 1;
        }

        false
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OrderedArraySet<T> — Zig: `fn OrderedArraySet(comptime T, comptime Ctx) type`.
// PORT NOTE: the `Ctx` type param is dropped from the struct; ctx is passed per-call as
// `&impl OrderedArraySetCtx<T>`. In Zig the Ctx param only contributed comptime method
// lookup; in Rust the two instantiations (`Dependencies`, `Peers`) are already distinct
// via `T`. Ctx structs carry borrowed slices, so binding their lifetime into the
// container type would infect stored fields.
// ──────────────────────────────────────────────────────────────────────────
pub trait OrderedArraySetCtx<T: Copy> {
    fn eql(&self, l: T, r: T) -> bool;
    fn order(&self, l: T, r: T) -> Ordering;
}

pub struct OrderedArraySet<T> {
    pub list: Vec<T>,
}

impl<T: Clone> Clone for OrderedArraySet<T> {
    fn clone(&self) -> Self {
        Self {
            list: self.list.clone(),
        }
    }
}

impl<T> Default for OrderedArraySet<T> {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl<T> OrderedArraySet<T> {
    pub const EMPTY: Self = Self { list: Vec::new() };

    pub fn init_capacity(n: usize) -> Result<Self, AllocError> {
        // allocator param dropped — global mimalloc
        Ok(Self {
            list: Vec::with_capacity(n),
        })
    }

    /// Infallible alias for `init_capacity` (Zig `initCapacity` + `bun.handleOom`).
    pub fn with_capacity(n: usize) -> Self {
        Self {
            list: Vec::with_capacity(n),
        }
    }

    // `deinit` → handled by `Drop` on `Vec<T>`; nothing to write.

    pub fn slice(&self) -> &[T] {
        &self.list
    }

    pub fn len(&self) -> usize {
        self.list.len()
    }
}

impl<T: Copy> OrderedArraySet<T> {
    pub fn eql(&self, r: &Self, ctx: &impl OrderedArraySetCtx<T>) -> bool {
        if self.list.len() != r.list.len() {
            return false;
        }

        debug_assert_eq!(self.list.len(), r.list.len());
        for (l_item, r_item) in self.list.iter().zip(&r.list) {
            if !ctx.eql(*l_item, *r_item) {
                return false;
            }
        }

        true
    }

    pub fn insert(&mut self, new: T, ctx: &impl OrderedArraySetCtx<T>) -> Result<(), AllocError> {
        // allocator param dropped — global mimalloc
        for i in 0..self.list.len() {
            let existing = self.list[i];
            if ctx.eql(new, existing) {
                return Ok(());
            }

            let order = ctx.order(new, existing);

            if order == Ordering::Equal {
                return Ok(());
            }

            if order == Ordering::Less {
                self.list.insert(i, new);
                return Ok(());
            }
        }

        self.list.push(new);
        Ok(())
    }

    pub fn insert_assume_capacity(&mut self, new: T, ctx: &impl OrderedArraySetCtx<T>) {
        for i in 0..self.list.len() {
            let existing = self.list[i];
            if ctx.eql(new, existing) {
                return;
            }

            let order = ctx.order(new, existing);

            if order == Ordering::Equal {
                return;
            }

            if order == Ordering::Less {
                // PERF(port): was insertAssumeCapacity — profile in Phase B
                self.list.insert(i, new);
                return;
            }
        }

        // PERF(port): was appendAssumeCapacity — profile in Phase B
        self.list.push(new);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Entry
// ──────────────────────────────────────────────────────────────────────────
//
// A unique entry in the store. As a path looks like:
//   './node_modules/.bun/name@version/node_modules/name'
// or if peers are involved:
//   './node_modules/.bun/name@version_peer1@version+peer2@version/node_modules/name'
//
// Entries are created for workspaces (including the root), but only in memory. If
// a module depends on a workspace, a symlink is created pointing outside the store
// directory to the workspace.
pub mod entry {
    use super::*;
    use crate::lockfile::package::PackageColumns as _;

    pub type Id = NewId<Entry>;
    pub type List = MultiArrayList<Entry>;
    pub type Dependencies = OrderedArraySet<DependenciesItem>;

    pub struct Entry {
        // Used to get dependency name for destination path and peers
        // for store path
        pub node_id: super::node::Id,
        // parent_id: Id,
        pub dependencies: Dependencies,
        // Zig default: `.empty`
        pub parents: Vec<Id>,
        // Zig default: `.init(.link_package)`
        // PORT NOTE: `std.atomic.Value(Installer.Task.Step)` → `AtomicU32` storing
        // the `#[repr(u8)]` discriminant. Loads/stores go through `Step as u32` /
        // `Step::from_u32` (see Installer.rs); no atomic-enum wrapper exists.
        pub step: core::sync::atomic::AtomicU32,

        // if true this entry gets symlinked to `node_modules/.bun/node_modules`
        pub hoisted: bool,

        pub peer_hash: PeerHash,

        /// Content hash of (package + sorted resolved dependency global-store keys),
        /// used to key the global virtual store at `<cache>/links/<storepath>-<entry_hash>/`.
        /// Two projects that resolve the same package to the same dependency closure
        /// share one global-store entry; if a transitive dep version differs, the
        /// hash differs and a new global-store entry is created. Computed after the
        /// store is built (see `computeEntryHashes`). 0 means "do not use global store"
        /// (root, workspace, folder, symlink, patched).
        // Zig default: `0`
        pub entry_hash: u64,

        // Zig default: `null`
        // PORT NOTE: `Cell` because `Installer::Task::run` writes this slot
        // from a task thread through `&Store` (each Task is the sole writer for
        // its own `entry_id`; see Installer.zig:541/1161). Without interior
        // mutability the only access path is `&Store → &[Option<_>]` and the
        // per-entry write would mutate through shared-reference provenance.
        // Raw `*mut` instead of `Box` so reads don't move out of the cell.
        // `Cell` (not `UnsafeCell`): payload is `Copy`, so `.get()/.set()` are
        // zero-unsafe; `Cell` and `UnsafeCell` have identical `Send`/`!Sync`
        // auto-traits, so the per-entry single-writer discipline is unchanged.
        pub scripts: core::cell::Cell<Option<*mut package::scripts::List>>,
    }

    bun_collections::multi_array_columns! {
        pub trait EntryColumns for Entry {
            node_id: super::node::Id,
            dependencies: Dependencies,
            parents: Vec<Id>,
            step: core::sync::atomic::AtomicU32,
            hoisted: bool,
            peer_hash: PeerHash,
            entry_hash: u64,
            scripts: core::cell::Cell<Option<*mut package::scripts::List>>,
        }
    }

    impl Default for Entry {
        fn default() -> Self {
            Self {
                node_id: super::node::Id::INVALID,
                dependencies: Dependencies::EMPTY,
                // Zig default: `.empty`
                parents: Vec::new(),
                // Zig default: `.init(.link_package)` — `Step::LinkPackage as u32 == 0`.
                step: core::sync::atomic::AtomicU32::new(0),
                hoisted: false,
                peer_hash: PeerHash::NONE,
                // Zig default: `0`
                entry_hash: 0,
                // Zig default: `null`
                scripts: core::cell::Cell::new(None),
            }
        }
    }

    #[repr(transparent)]
    #[derive(Copy, Clone, PartialEq, Eq, Hash)]
    pub struct PeerHash(u64);

    impl PeerHash {
        pub const NONE: Self = Self(0);

        pub fn from(int: u64) -> Self {
            Self(int)
        }

        pub fn cast(self) -> u64 {
            self.0
        }
    }

    pub struct StorePathFormatter<'a> {
        pub entry_id: Id,
        pub store: &'a Store,
        pub lockfile: &'a Lockfile,
    }

    impl<'a> fmt::Display for StorePathFormatter<'a> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            use super::node::NodeColumns as _;
            let store = self.store;
            let entries = store.entries.slice();
            // derive(MultiArrayElement)-generated SliceExt accessors: `.items_peer_hash()`, `.items_node_id()`.
            let entry_peer_hashes = entries.items_peer_hash();
            let entry_node_ids = entries.items_node_id();

            let peer_hash = entry_peer_hashes[self.entry_id.get() as usize];
            let node_id = entry_node_ids[self.entry_id.get() as usize];
            let pkg_id = store.nodes.items_pkg_id()[node_id.get() as usize];

            let string_buf = self.lockfile.buffers.string_bytes.as_slice();

            let pkgs = self.lockfile.packages.slice();
            let pkg_names = pkgs.items_name();
            let pkg_resolutions = pkgs.items_resolution();

            let pkg_name = pkg_names[pkg_id as usize];
            let pkg_res = &pkg_resolutions[pkg_id as usize];

            match pkg_res.tag {
                crate::resolution::Tag::Root => {
                    if pkg_name.is_empty() {
                        write!(
                            f,
                            "{}",
                            BStr::new(bun_paths::basename(
                                crate::bun_fs::FileSystem::instance().top_level_dir()
                            ))
                        )?;
                    } else {
                        write!(f, "{}@root", pkg_name.fmt_store_path(string_buf))?;
                    }
                }
                crate::resolution::Tag::Folder => {
                    // SAFETY: tag was matched as Folder; reads the union field
                    // corresponding to that tag.
                    let folder = *pkg_res.folder();
                    write!(
                        f,
                        "{}@file+{}",
                        pkg_name.fmt_store_path(string_buf),
                        folder.fmt_store_path(string_buf),
                    )?;
                }
                _ => {
                    write!(
                        f,
                        "{}@{}",
                        pkg_name.fmt_store_path(string_buf),
                        pkg_res.fmt_store_path(string_buf),
                    )?;
                }
            }

            if peer_hash != PeerHash::NONE {
                // Zig `bun.fmt.hexIntLower(u64)` zero-pads to 16 nibbles.
                write!(f, "+{:016x}", peer_hash.cast())?;
            }

            Ok(())
        }
    }

    pub fn fmt_store_path<'a>(
        entry_id: Id,
        store: &'a Store,
        lockfile: &'a Lockfile,
    ) -> StorePathFormatter<'a> {
        StorePathFormatter {
            entry_id,
            store,
            lockfile,
        }
    }

    pub struct GlobalStorePathFormatter<'a> {
        inner: StorePathFormatter<'a>,
        entry_hash: u64,
    }

    impl<'a> fmt::Display for GlobalStorePathFormatter<'a> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            self.inner.fmt(f)?;
            // Zig `bun.fmt.hexIntLower(u64)` zero-pads to 16 nibbles.
            write!(f, "-{:016x}", self.entry_hash)
        }
    }

    /// Like `fmt_store_path` but suffixes the entry's content hash so the
    /// resulting name is safe to use as a key in the shared global virtual
    /// store (different dependency closures get different directory names).
    pub fn fmt_global_store_path<'a>(
        entry_id: Id,
        store: &'a Store,
        lockfile: &'a Lockfile,
    ) -> GlobalStorePathFormatter<'a> {
        GlobalStorePathFormatter {
            inner: fmt_store_path(entry_id, store, lockfile),
            entry_hash: store.entries.items_entry_hash()[entry_id.get() as usize],
        }
    }

    pub fn debug_gather_all_parents(entry_id: Id, store: &Store) -> Vec<Id> {
        // PORT NOTE: reshaped — Zig leaked the local map and returned its keys slice;
        // Rust returns an owned Vec instead.
        let mut i: usize = 0;
        let mut len: usize;

        let entry_parents = store.entries.items_parents();

        let mut parents: ArrayHashMap<Id, ()> = ArrayHashMap::default();
        // defer parents.deinit(bun.default_allocator);

        for &parent_id in entry_parents[entry_id.get() as usize].as_slice() {
            if parent_id == Id::INVALID {
                continue;
            }
            let _ = parents.put(parent_id, ()); // OOM-only Result (Zig: catch unreachable)
        }

        len = parents.len();
        while i < len {
            // PORT NOTE: reshaped for borrowck — capture key before mutating `parents`.
            let key = parents.keys()[i];
            for &parent_id in entry_parents[key.get() as usize].as_slice() {
                if parent_id == Id::INVALID {
                    continue;
                }
                let _ = parents.put(parent_id, ()); // OOM-only Result (Zig: catch unreachable)
                len = parents.len();
            }
            i += 1;
        }

        parents.keys().to_vec()
    }

    #[derive(Copy, Clone)]
    pub struct DependenciesItem {
        pub entry_id: Id,

        // TODO: this can be removed, and instead dep_id can be retrieved through:
        // entry_id -> node_id -> node_dep_ids
        pub dep_id: DependencyID,
    }

    pub struct DependenciesOrderedArraySetCtx<'a> {
        pub string_buf: &'a [u8],
        pub dependencies: &'a [Dependency],
    }

    impl<'a> OrderedArraySetCtx<DependenciesItem> for DependenciesOrderedArraySetCtx<'a> {
        fn eql(&self, l_item: DependenciesItem, r_item: DependenciesItem) -> bool {
            if l_item.entry_id != r_item.entry_id {
                return false;
            }

            let dependencies = self.dependencies;
            let l_dep = &dependencies[l_item.dep_id as usize];
            let r_dep = &dependencies[r_item.dep_id as usize];

            l_dep.name_hash == r_dep.name_hash
        }

        fn order(&self, l: DependenciesItem, r: DependenciesItem) -> Ordering {
            let dependencies = self.dependencies;
            let l_dep = &dependencies[l.dep_id as usize];
            let r_dep = &dependencies[r.dep_id as usize];

            if l.entry_id == r.entry_id && l_dep.name_hash == r_dep.name_hash {
                return Ordering::Equal;
            }

            // TODO: y r doing
            if l.entry_id == Id::INVALID {
                if r.entry_id == Id::INVALID {
                    return Ordering::Equal;
                }
                return Ordering::Less;
            } else if r.entry_id == Id::INVALID {
                if l.entry_id == Id::INVALID {
                    return Ordering::Equal;
                }
                return Ordering::Greater;
            }

            let string_buf = self.string_buf;
            let l_dep_name = l_dep.name;
            let r_dep_name = r_dep.name;

            l_dep_name.order(&r_dep_name, string_buf, string_buf)
        }
    }

    // PORT NOTE: the Zig body references stale Entry fields (`pkg_id`,
    // `dep_name`, `parent_id`) not present on the current `Entry` struct —
    // dead debug code that Zig's lazy compilation never instantiates. Rust
    // typechecks dead code, so this is rewritten against the real shape:
    // resolve `pkg_id` via `nodes[entry.node_id].pkg_id`.
    pub fn debug_print_list(list: &List, nodes: &super::node::List, lockfile: &mut Lockfile) {
        use super::node::NodeColumns as _;
        let string_buf = lockfile.buffers.string_bytes.as_slice();

        let pkgs = lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();

        let entries = list.slice();
        let entry_node_ids = entries.items_node_id();
        let entry_dependencies = entries.items_dependencies();
        let node_pkg_ids = nodes.items_pkg_id();

        for entry_id in 0..list.len() {
            let node_id = entry_node_ids[entry_id];
            let pkg_id = node_pkg_ids[node_id.get() as usize];
            let entry_pkg_name = pkg_names[pkg_id as usize].slice(string_buf);
            bun_output::scoped_log!(
                Store,
                "entry ({}): '{}@{}'\n  node_id: {}\n  pkg_id: {}\n  ",
                entry_id,
                BStr::new(entry_pkg_name),
                pkg_resolutions[pkg_id as usize].fmt(string_buf, bun_core::fmt::PathSep::Posix),
                node_id.get(),
                pkg_id,
            );

            let deps = &entry_dependencies[entry_id];
            bun_output::scoped_log!(Store, "  dependencies ({}):\n", deps.len());
            for dep_item in deps.slice() {
                let dep_node_id = entry_node_ids[dep_item.entry_id.get() as usize];
                let dep_pkg_id = node_pkg_ids[dep_node_id.get() as usize];
                bun_output::scoped_log!(
                    Store,
                    "    {}@{}\n",
                    BStr::new(pkg_names[dep_pkg_id as usize].slice(string_buf)),
                    pkg_resolutions[dep_pkg_id as usize]
                        .fmt(string_buf, bun_core::fmt::PathSep::Posix),
                );
            }
        }
    }
}

pub use entry::Entry;
pub use entry::EntryColumns;

// ──────────────────────────────────────────────────────────────────────────
// Node
// ──────────────────────────────────────────────────────────────────────────
//
// A node used to represent the full dependency tree. Uniqueness is determined
// from `pkg_id` and `peers`
pub mod node {
    use super::*;
    use crate::lockfile::package::PackageColumns as _;

    pub type Id = NewId<Node>;
    pub type List = MultiArrayList<Node>;
    pub type Peers = OrderedArraySet<TransitivePeer>;
    /// Zig: `Node.dependencies: ArrayList(Ids)` — re-exported under a
    /// disambiguating name for callers building the dependency vec.
    pub use super::Ids as DependencyIds;

    pub struct Node {
        pub dep_id: DependencyID,
        pub pkg_id: PackageID,
        pub parent_id: Id,

        // Zig default: `.empty`
        pub dependencies: Vec<Ids>,
        // Zig default: `.empty`
        pub peers: Peers,

        // each node in this list becomes a symlink in the package's node_modules
        // Zig default: `.empty`
        pub nodes: Vec<Id>,
    }

    bun_collections::multi_array_columns! {
        pub trait NodeColumns for Node {
            dep_id: DependencyID,
            pkg_id: PackageID,
            parent_id: Id,
            dependencies: Vec<Ids>,
            peers: Peers,
            nodes: Vec<Id>,
        }
    }

    impl Default for Node {
        fn default() -> Self {
            Self {
                dep_id: INVALID_DEPENDENCY_ID,
                pkg_id: 0,
                parent_id: Id::INVALID,
                dependencies: Vec::new(),
                peers: Peers::EMPTY,
                nodes: Vec::new(),
            }
        }
    }

    #[derive(Copy, Clone)]
    pub struct TransitivePeer {
        pub dep_id: DependencyID,
        pub pkg_id: PackageID,
        pub auto_installed: bool,
    }

    // Zig: `TransitivePeer.OrderedArraySetCtx` — Rust can't nest a type inside a struct,
    // so expose a snake_case module mirroring the Zig namespace for callers.
    pub mod transitive_peer {
        pub use super::TransitivePeerOrderedArraySetCtx as OrderedArraySetCtx;
    }

    pub struct TransitivePeerOrderedArraySetCtx<'a> {
        pub string_buf: &'a [u8],
        pub pkg_names: &'a [SemverString],
    }

    impl<'a> OrderedArraySetCtx<TransitivePeer> for TransitivePeerOrderedArraySetCtx<'a> {
        fn eql(&self, l_item: TransitivePeer, r_item: TransitivePeer) -> bool {
            let _ = self;
            l_item.pkg_id == r_item.pkg_id
        }

        fn order(&self, l: TransitivePeer, r: TransitivePeer) -> Ordering {
            let l_pkg_id = l.pkg_id;
            let r_pkg_id = r.pkg_id;
            if l_pkg_id == r_pkg_id {
                return Ordering::Equal;
            }

            let string_buf = self.string_buf;
            let pkg_names = self.pkg_names;
            let l_pkg_name = pkg_names[l_pkg_id as usize];
            let r_pkg_name = pkg_names[r_pkg_id as usize];

            l_pkg_name.order(&r_pkg_name, string_buf, string_buf)
        }
    }

    impl Node {
        pub fn debug_print(&self, id: Id, lockfile: &Lockfile) {
            let pkgs = lockfile.packages.slice();
            let pkg_names = pkgs.items_name();
            let pkg_resolutions = pkgs.items_resolution();

            let string_buf = lockfile.buffers.string_bytes.as_slice();
            let deps = lockfile.buffers.dependencies.as_slice();

            let dep_name: &[u8] = if self.dep_id == INVALID_DEPENDENCY_ID {
                b"root"
            } else {
                deps[self.dep_id as usize].name.slice(string_buf)
            };
            let dep_version: &[u8] = if self.dep_id == INVALID_DEPENDENCY_ID {
                b"root"
            } else {
                deps[self.dep_id as usize].version.literal.slice(string_buf)
            };

            bun_output::scoped_log!(
                Store,
                "node({})\n  deps: {}@{}\n  res: {}@{}\n",
                id.get(),
                BStr::new(dep_name),
                BStr::new(dep_version),
                BStr::new(pkg_names[self.pkg_id as usize].slice(string_buf)),
                pkg_resolutions[self.pkg_id as usize]
                    .fmt(string_buf, bun_core::fmt::PathSep::Posix),
            );
        }
    }

    pub fn debug_print_list(list: &List, lockfile: &Lockfile) {
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let dependencies = lockfile.buffers.dependencies.as_slice();

        let pkgs = lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();

        for node_id in 0..list.len() {
            let node = list.get(node_id);
            let node_pkg_name = pkg_names[node.pkg_id as usize].slice(string_buf);
            bun_output::scoped_log!(
                Store,
                "node ({}): '{}'\n  dep_id: {}\n  pkg_id: {}\n  parent_id: {:?}\n",
                node_id,
                BStr::new(node_pkg_name),
                node.dep_id,
                node.pkg_id,
                node.parent_id,
            );

            bun_output::scoped_log!(Store, "  dependencies ({}):\n", node.dependencies.len());
            for ids in &node.dependencies {
                let dep = &dependencies[ids.dep_id as usize];
                let dep_name = dep.name.slice(string_buf);

                let pkg_name = pkg_names[ids.pkg_id as usize].slice(string_buf);
                let pkg_res = &pkg_resolutions[ids.pkg_id as usize];

                bun_output::scoped_log!(
                    Store,
                    "    {}@{} ({}@{})\n",
                    BStr::new(pkg_name),
                    pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Posix),
                    BStr::new(dep_name),
                    BStr::new(dep.version.literal.slice(string_buf)),
                );
            }

            bun_output::scoped_log!(Store, "  nodes ({}): ", node.nodes.len());
            for (i, &id) in node.nodes.iter().enumerate() {
                bun_output::scoped_log!(Store, "{}", id.get());
                if i != node.nodes.len() - 1 {
                    bun_output::scoped_log!(Store, ",");
                }
            }

            bun_output::scoped_log!(Store, "\n  peers ({}):\n", node.peers.list.len());
            for ids in &node.peers.list {
                let dep = &dependencies[ids.dep_id as usize];
                let dep_name = dep.name.slice(string_buf);
                let pkg_name = pkg_names[ids.pkg_id as usize].slice(string_buf);
                let pkg_res = &pkg_resolutions[ids.pkg_id as usize];

                bun_output::scoped_log!(
                    Store,
                    "    {}@{} ({}@{})\n",
                    BStr::new(pkg_name),
                    pkg_res.fmt(string_buf, bun_core::fmt::PathSep::Posix),
                    BStr::new(dep_name),
                    BStr::new(dep.version.literal.slice(string_buf)),
                );
            }
        }
    }
}

pub use node::Node;
pub use node::NodeColumns;

// ported from: src/install/isolated_install/Store.zig
