use core::ptr::NonNull;

use enumset::{EnumSet, EnumSetType};

use bun_alloc as allocators;
use bun_core::feature_flags as FeatureFlags;
use bun_sys::Fd;

#[allow(unused_imports)]
use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

// TODO(b2-blocked): bun_core::Generation — defined in top-level `bun.rs`, not yet
// re-exported via bun_core. Mirroring the Zig `pub const Generation = u16;` locally.
type Generation = u16;

// TODO(b2-blocked): bun_alloc::IndexType — gated inside bun_alloc (BSS section).
// Local mirror of `packed struct(u32) { index: u31, is_overflow: bool }` so the
// DirInfo struct shape compiles. Replace with `bun_alloc::IndexType` once un-gated.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct IndexType(u32);
const NOT_FOUND: IndexType = IndexType(u32::MAX >> 1);

pub type Index = IndexType;

pub struct DirInfo {
    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    pub parent: Index,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    pub enclosing_browser_scope: Index,
    // TODO(port): lifetime — borrowed from resolver-owned PackageJSON cache
    pub package_json_for_browser_field: Option<NonNull<PackageJSON>>,
    // TODO(port): lifetime — borrowed from resolver-owned TSConfigJSON cache
    pub enclosing_tsconfig_json: Option<NonNull<TSConfigJSON>>,

    /// package.json used for bundling
    /// it's the deepest one in the hierarchy with a "name" field
    /// or, if using `bun run`, the name field is optional
    /// https://github.com/oven-sh/bun/issues/229
    // TODO(port): lifetime — borrowed from resolver-owned PackageJSON cache
    pub enclosing_package_json: Option<NonNull<PackageJSON>>,

    // TODO(port): lifetime — borrowed from resolver-owned PackageJSON cache
    pub package_json_for_dependencies: Option<NonNull<PackageJSON>>,

    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_path: &'static [u8],
    pub entries: Index,
    /// Is there a "package.json" file?
    // TODO(port): lifetime — reset() drops the pointee in-place; storage owned by resolver cache
    pub package_json: Option<NonNull<PackageJSON>>,
    /// Is there a "tsconfig.json" file in this directory or a parent directory?
    // TODO(port): lifetime — reset() drops the pointee in-place; storage owned by resolver cache
    pub tsconfig_json: Option<NonNull<TSConfigJSON>>,
    /// If non-empty, this is the real absolute path resolving any symlinks
    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_real_path: &'static [u8],

    pub flags: EnumSet<Flags>,
}

impl Default for DirInfo {
    fn default() -> Self {
        Self {
            parent: NOT_FOUND,
            enclosing_browser_scope: NOT_FOUND,
            package_json_for_browser_field: None,
            enclosing_tsconfig_json: None,
            enclosing_package_json: None,
            package_json_for_dependencies: None,
            abs_path: b"",
            // PORT NOTE: Zig left this `= undefined`; using a zero-value placeholder.
            entries: Index::default(),
            package_json: None,
            tsconfig_json: None,
            abs_real_path: b"",
            flags: EnumSet::empty(),
        }
    }
}

impl DirInfo {
    /// Is there a "node_modules" subdirectory?
    #[inline]
    pub fn has_node_modules(&self) -> bool {
        self.flags.contains(Flags::HasNodeModules)
    }

    /// Is this a "node_modules" directory?
    #[inline]
    pub fn is_node_modules(&self) -> bool {
        self.flags.contains(Flags::IsNodeModules)
    }

    /// Is this inside a "node_modules" directory?
    #[inline]
    pub fn is_inside_node_modules(&self) -> bool {
        self.flags.contains(Flags::InsideNodeModules)
    }

    pub fn has_parent_package(&self) -> bool {
        let Some(parent) = self.get_parent() else {
            return false;
        };
        !parent.is_node_modules()
    }

    pub fn get_file_descriptor(&self) -> Fd {
        // TODO(b2-blocked): bun_resolver::fs::DirEntry::fd — gated until fs.rs lands.
        #[cfg(any())]
        if FeatureFlags::STORE_FILE_DESCRIPTORS {
            if let Some(entries) = self.get_entries(0) {
                return entries.fd;
            }
        }
        Fd::INVALID
    }

    #[cfg(any())] // TODO(b2-blocked): bun_resolver::fs::DirEntry — return type gated until fs.rs lands.
    pub fn get_entries(&self, generation: Generation) -> Option<&mut fs::DirEntry> {
        // TODO(b2-blocked): bun_resolver::fs::FileSystem (RealFS::entries_at) — gated until fs.rs lands.
        #[cfg(any())]
        {
        let Some(entries_ptr) = fs::FileSystem::instance().fs.entries_at(self.entries, generation) else {
            return None;
        };
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(entries),
            fs::EntriesOption::Err(_) => None,
        }
        }
        let _ = generation;
        None
    }

    #[cfg(any())] // TODO(b2-blocked): bun_resolver::fs::DirEntry — return type gated until fs.rs lands.
    pub fn get_entries_const(&self) -> Option<&fs::DirEntry> {
        // TODO(b2-blocked): bun_resolver::fs::FileSystem — gated until fs.rs lands.
        #[cfg(any())]
        {
        let Some(entries_ptr) = fs::FileSystem::instance().fs.entries.at_index(self.entries) else {
            return None;
        };
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(entries),
            fs::EntriesOption::Err(_) => None,
        }
        }
        None
    }

    pub fn get_parent(&self) -> Option<&mut DirInfo> {
        // TODO(b2-blocked): bun_alloc::BSSMap::instance — per-type singleton not yet wired.
        #[cfg(any())]
        { return HashMap::instance().at_index(self.parent); }
        None
    }

    pub fn get_enclosing_browser_scope(&self) -> Option<&mut DirInfo> {
        // TODO(b2-blocked): bun_alloc::BSSMap::instance — per-type singleton not yet wired.
        #[cfg(any())]
        { return HashMap::instance().at_index(self.enclosing_browser_scope); }
        None
    }
}

#[derive(EnumSetType, Debug)]
pub enum Flags {
    /// This directory is a node_modules directory
    IsNodeModules,
    /// This directory has a node_modules subdirectory
    HasNodeModules,

    InsideNodeModules,
}

impl DirInfo {
    // TODO(port): in-place cache invalidation, not Drop — DirInfo lives in BSS-backed
    // allocators::BSSMap storage so Drop never fires naturally; callers invoke this
    // explicitly when invalidating the cache slot. Zig name was `deinit`.
    pub fn reset(&mut self) {
        if let Some(p) = self.package_json.take() {
            // SAFETY: package_json points to a live PackageJSON in the resolver cache;
            // drop_in_place releases its owned resources in-place (storage itself is
            // BSS/cache-owned and not freed here, matching Zig `p.deinit()`).
            unsafe { core::ptr::drop_in_place(p.as_ptr()) };
        }
        if let Some(t) = self.tsconfig_json.take() {
            // SAFETY: tsconfig_json points to a live TSConfigJSON in the resolver cache;
            // drop_in_place releases its owned resources in-place (storage itself is
            // BSS/cache-owned and not freed here, matching Zig `t.deinit()`).
            unsafe { core::ptr::drop_in_place(t.as_ptr()) };
        }
    }
}

// Goal: Really fast, low allocation directory map exploiting cache locality where we don't worry about lifetimes much.
// 1. Don't store the keys or values of directories that don't exist
// 2. Don't expect a provided key to exist after it's queried
// 3. Store whether a directory has been queried and whether that query was successful.
// 4. Allocate onto the https://en.wikipedia.org/wiki/.bss#BSS_in_C instead of the heap, so we can avoid memory leaks
//
// PORT NOTE: Zig `BSSMap(DirInfo, COUNT, store_keys=false, est_key_len=128, rm_slash=true)`;
// Rust splits the comptime branch — `store_keys=false` → `BSSMapInner<V, COUNT, RM_SLASH>`.
// `est_key_len` is unused on the inner shape. COUNT mirrors `fs::preallocate::counts::DIR_ENTRY`.
// TODO(b2-blocked): bun_alloc::BSSMapInner — gated inside bun_alloc.
#[cfg(any())]
pub type HashMap = allocators::BSSMapInner<DirInfo, 2048, true>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/dir_info.zig (128 lines)
//   confidence: medium
//   todos:      9
//   notes:      LIFETIMES.tsv had no rows; all *PackageJSON/*TSConfigJSON fields use Option<NonNull<T>> pending Phase B ownership analysis. BSSMap const-generic params and fs::EntriesOption variant names are guesses.
// ──────────────────────────────────────────────────────────────────────────
