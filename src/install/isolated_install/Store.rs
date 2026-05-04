use core::cmp::Ordering;
use core::fmt;
use core::marker::PhantomData;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, MultiArrayList};
use bun_semver::String as SemverString;

use crate::lockfile::{package, Lockfile};
use crate::{Dependency, DependencyID, PackageID, INVALID_DEPENDENCY_ID};

pub use super::installer::Installer;

bun_output::declare_scope!(Store, visible);

#[derive(Copy, Clone)]
struct Ids {
    dep_id: DependencyID,
    pkg_id: PackageID,
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
        let mut i: usize = 0;
        let mut len: usize;

        // TODO(port): MultiArrayList column accessor — Zig `.items(.parents)`; assumed `.items_parents()` here.
        let entry_parents = self.entries.items_parents();

        for &parent_id in entry_parents[id.get() as usize].as_slice() {
            if parent_id == entry::Id::INVALID {
                continue;
            }
            if parent_id == maybe_parent_id {
                return true;
            }
            parent_dedupe.put(parent_id, ());
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
                parent_dedupe.put(parent_id, ());
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
        // TODO(port): std.atomic.Value(Installer.Task.Step) — need atomic-enum wrapper; using AtomicU32 placeholder.
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
        pub scripts: Option<Box<package::scripts::List>>,
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
            let store = self.store;
            let entries = store.entries.slice();
            // TODO(port): MultiArrayList Slice column accessors — assumed `.items_<field>()`.
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

            // TODO(port): Resolution is a `struct { tag, value }` in Zig (not union(enum));
            // assumed `tag: ResolutionTag` + `value` union with `.folder` arm.
            match pkg_res.tag {
                crate::resolution::Tag::Root => {
                    if pkg_name.is_empty() {
                        // TODO(port): bun.fs.FileSystem.instance.top_level_dir global accessor
                        write!(
                            f,
                            "{}",
                            BStr::new(bun_paths::basename(
                                bun_fs::FileSystem::instance().top_level_dir()
                            ))
                        )?;
                    } else {
                        write!(f, "{}@root", pkg_name.fmt_store_path(string_buf))?;
                    }
                }
                crate::resolution::Tag::Folder => {
                    write!(
                        f,
                        "{}@file+{}",
                        pkg_name.fmt_store_path(string_buf),
                        pkg_res.value.folder.fmt_store_path(string_buf),
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
            parents.put(parent_id, ());
        }

        len = parents.len();
        while i < len {
            // PORT NOTE: reshaped for borrowck — capture key before mutating `parents`.
            let key = parents.keys()[i];
            for &parent_id in entry_parents[key.get() as usize].as_slice() {
                if parent_id == Id::INVALID {
                    continue;
                }
                parents.put(parent_id, ());
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

    pub fn debug_print_list(list: &List, lockfile: &mut Lockfile) {
        let string_buf = lockfile.buffers.string_bytes.as_slice();

        let pkgs = lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();

        for entry_id in 0..list.len() {
            let entry = list.get(entry_id);
            // TODO(port): references stale Entry fields (pkg_id, dep_name, parent_id) not present
            // on the current `Entry` struct — likely dead debug code that Zig never instantiates.
            let entry_pkg_name = pkg_names[entry.pkg_id as usize].slice(string_buf);
            bun_output::scoped_log!(
                Store,
                "entry ({}): '{}@{}'\n  dep_name: {}\n  pkg_id: {}\n  parent_id: {:?}\n  ",
                entry_id,
                BStr::new(entry_pkg_name),
                pkg_resolutions[entry.pkg_id as usize].fmt(string_buf, bun_paths::Style::Posix),
                BStr::new(entry.dep_name.slice(string_buf)),
                entry.pkg_id,
                entry.parent_id,
            );

            bun_output::scoped_log!(Store, "  dependencies ({}):\n", entry.dependencies.len());
            for dep_entry_id in entry.dependencies.slice() {
                let dep_entry = list.get(dep_entry_id.get() as usize);
                bun_output::scoped_log!(
                    Store,
                    "    {}@{}\n",
                    BStr::new(pkg_names[dep_entry.pkg_id as usize].slice(string_buf)),
                    pkg_resolutions[dep_entry.pkg_id as usize]
                        .fmt(string_buf, bun_paths::Style::Posix),
                );
            }
        }
    }
}

pub use entry::Entry;

// ──────────────────────────────────────────────────────────────────────────
// Node
// ──────────────────────────────────────────────────────────────────────────
//
// A node used to represent the full dependency tree. Uniqueness is determined
// from `pkg_id` and `peers`
pub mod node {
    use super::*;

    pub type Id = NewId<Node>;
    pub type List = MultiArrayList<Node>;
    pub type Peers = OrderedArraySet<TransitivePeer>;

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

    #[derive(Copy, Clone)]
    pub struct TransitivePeer {
        pub dep_id: DependencyID,
        pub pkg_id: PackageID,
        pub auto_installed: bool,
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
                pkg_resolutions[self.pkg_id as usize].fmt(string_buf, bun_paths::Style::Posix),
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
                    pkg_res.fmt(string_buf, bun_paths::Style::Posix),
                    BStr::new(dep_name),
                    BStr::new(dep.version.literal.slice(string_buf)),
                );
            }

            bun_output::scoped_log!(Store, "  nodes ({}): ", node.nodes.len());
            for (i, id) in node.nodes.iter().enumerate() {
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
                    pkg_res.fmt(string_buf, bun_paths::Style::Posix),
                    BStr::new(dep_name),
                    BStr::new(dep.version.literal.slice(string_buf)),
                );
            }
        }
    }
}

pub use node::Node;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install/Store.zig (590 lines)
//   confidence: medium
//   todos:      5
//   notes:      MultiArrayList column-accessor API assumed (.items_<field>()); OrderedArraySet Ctx type-param dropped (ctx passed per-call); Entry.step atomic-enum needs real wrapper; Entry.debug_print_list ports stale/dead Zig debug code; Node.deinitList dropped (Drop handles it).
// ──────────────────────────────────────────────────────────────────────────
