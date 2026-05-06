use core::ptr::NonNull;

use enumset::{EnumSet, EnumSetType};

use bun_alloc as allocators;
#[allow(unused_imports)]
use bun_core::feature_flags as FeatureFlags;
#[allow(unused_imports)]
use bun_core::Generation;
use bun_sys::Fd;

#[allow(unused_imports)]
use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub use allocators::IndexType;
use allocators::NOT_FOUND;

pub type Index = IndexType;

pub struct DirInfo {
    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    pub parent: Index,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    pub enclosing_browser_scope: Index,
    // PORT NOTE: lifetime — all `&'static` borrows below are ARENA-backed (the
    // resolver-owned PackageJSON/TSConfigJSON caches outlive every DirInfo). Zig
    // used `?*PackageJSON`; modeled as `Option<&'static T>` so call sites
    // auto-deref without `unsafe { ptr.as_ref() }` boilerplate. `reset()` casts
    // away const to drop-in-place (the storage itself is BSS/cache-owned).
    pub package_json_for_browser_field: Option<&'static PackageJSON>,
    pub enclosing_tsconfig_json: Option<&'static TSConfigJSON>,

    /// package.json used for bundling
    /// it's the deepest one in the hierarchy with a "name" field
    /// or, if using `bun run`, the name field is optional
    /// https://github.com/oven-sh/bun/issues/229
    pub enclosing_package_json: Option<&'static PackageJSON>,

    pub package_json_for_dependencies: Option<&'static PackageJSON>,

    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_path: &'static [u8],
    pub entries: Index,
    /// Is there a "package.json" file?
    // TODO(port): lifetime — reset() drops the pointee in-place; storage owned by resolver cache
    pub package_json: Option<&'static PackageJSON>,
    /// Is there a "tsconfig.json" file in this directory or a parent directory?
    // TODO(port): lifetime — reset() drops the pointee in-place; storage owned by resolver cache
    pub tsconfig_json: Option<&'static TSConfigJSON>,
    /// If non-empty, this is the real absolute path resolving any symlinks
    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_real_path: &'static [u8],

    pub flags: Flags,
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
            flags: Flags::empty(),
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
        if FeatureFlags::STORE_FILE_DESCRIPTORS {
            if let Some(entries) = self.get_entries(0) {
                return entries.fd;
            }
        }
        Fd::INVALID
    }

    pub fn get_entries(&self, generation: Generation) -> Option<&'static mut fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance().fs.entries_at(self.entries, generation)?;
        match entries_ptr {
            // SAFETY: ARENA — slot in the BSSMap-backed EntriesOptionMap
            // singleton; widening the reborrow to 'static (matches Zig).
            fs::EntriesOption::Entries(entries) => Some(unsafe { &mut *(*entries as *mut _) }),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_entries_const(&self) -> Option<&fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance().fs.entries.at_index(self.entries)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_parent(&self) -> Option<*mut DirInfo> {
        hash_map_instance().at_index(self.parent).map(|p| p as *mut _)
    }

    pub fn get_enclosing_browser_scope(&self) -> Option<&'static mut DirInfo> {
        hash_map_instance().at_index(self.enclosing_browser_scope)
    }
}

// PORT NOTE: Zig `BSSMap` is a per-monomorphization singleton (`var instance` inside
// the comptime-returned struct). Rust `BSSMapInner<DirInfo, ..>` cannot host a
// per-generic-instantiation static on stable, so the singleton pointer lives here at
// the use site and `bun_alloc::BSSMapInner::init()` hands back the storage.
// TODO(b2-blocked): bun_alloc::BSSMapInner per-type storage — `init()` body is
// currently `unimplemented!()`; this becomes real once bun_alloc un-gates its BSS
// backing arrays.
static mut DIR_INFO_MAP: Option<NonNull<HashMap>> = None;

#[inline]
pub fn hash_map_instance() -> &'static mut HashMap {
    // SAFETY: matches Zig's lazy global singleton; resolver init runs single-threaded
    // before any concurrent access. `&raw mut` avoids the static_mut_refs lint.
    unsafe {
        if (*(&raw const DIR_INFO_MAP)).is_none() {
            *(&raw mut DIR_INFO_MAP) = Some(NonNull::from(HashMap::init()));
        }
        (*(&raw mut DIR_INFO_MAP)).unwrap().as_mut()
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
    pub struct Flags: u8 {
        /// This directory is a node_modules directory
        const IsNodeModules     = 1 << 0;
        /// This directory has a node_modules subdirectory
        const HasNodeModules    = 1 << 1;
        const InsideNodeModules = 1 << 2;
    }
}
impl Flags {
    #[inline]
    pub fn set_present(&mut self, flag: Flags, present: bool) {
        self.set(flag, present);
    }
}
/// Body addresses individual flags as `DirInfo::Flag::X` (Zig nesting).
pub use Flags as Flag;

impl DirInfo {
    // TODO(port): in-place cache invalidation, not Drop — DirInfo lives in BSS-backed
    // allocators::BSSMap storage so Drop never fires naturally; callers invoke this
    // explicitly when invalidating the cache slot. Zig name was `deinit`.
    pub fn reset(&mut self) {
        if let Some(p) = self.package_json.take() {
            // SAFETY: package_json points to a live PackageJSON in the resolver cache;
            // drop_in_place releases its owned resources in-place (storage itself is
            // BSS/cache-owned and not freed here, matching Zig `p.deinit()`). Cast away
            // const — the `&'static T` shape is for ergonomic auto-deref at read sites;
            // ownership is logically held here.
            unsafe { core::ptr::drop_in_place(p as *const PackageJSON as *mut PackageJSON) };
        }
        if let Some(t) = self.tsconfig_json.take() {
            // SAFETY: tsconfig_json points to a live TSConfigJSON in the resolver cache;
            // drop_in_place releases its owned resources in-place (storage itself is
            // BSS/cache-owned and not freed here, matching Zig `t.deinit()`). See note
            // above re const cast.
            unsafe { core::ptr::drop_in_place(t as *const TSConfigJSON as *mut TSConfigJSON) };
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
pub type HashMap = allocators::BSSMapInner<DirInfo, 2048, true>;

/// Resolver-side extension trait so the body can call BSSMap methods that are
/// still gated in `bun_alloc::_bss_gated`. Type-only shims.
// TODO(b2-blocked): bun_alloc::BSSMapInner — un-gate `get_or_put`/`put`/`remove`.
pub trait HashMapExt {
    fn get_or_put(&mut self, key: &[u8]) -> core::result::Result<crate::__phase_a_body::allocators::Result, bun_core::Error>;
    fn put(&mut self, result: &crate::__phase_a_body::allocators::Result, value: DirInfo) -> core::result::Result<*mut DirInfo, bun_core::Error>;
    fn mark_not_found(&mut self, result: crate::__phase_a_body::allocators::Result);
    fn remove(&mut self, key: &[u8]) -> bool;
    fn values_mut(&mut self) -> core::slice::IterMut<'_, DirInfo>;
}
impl HashMapExt for HashMap {
    fn get_or_put(&mut self, _key: &[u8]) -> core::result::Result<crate::__phase_a_body::allocators::Result, bun_core::Error> {
        unimplemented!("BSSMap::get_or_put (Phase B)")
    }
    fn put(&mut self, _result: &crate::__phase_a_body::allocators::Result, _value: DirInfo) -> core::result::Result<*mut DirInfo, bun_core::Error> {
        unimplemented!("BSSMap::put (Phase B)")
    }
    fn mark_not_found(&mut self, _result: crate::__phase_a_body::allocators::Result) {
        unimplemented!("BSSMap::mark_not_found (Phase B)")
    }
    fn remove(&mut self, _key: &[u8]) -> bool {
        unimplemented!("BSSMap::remove (Phase B)")
    }
    fn values_mut(&mut self) -> core::slice::IterMut<'_, DirInfo> {
        unimplemented!("BSSMap::values_mut (Phase B)")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/dir_info.zig (128 lines)
//   confidence: medium
//   todos:      9
//   notes:      LIFETIMES.tsv had no rows; all *PackageJSON/*TSConfigJSON fields use Option<NonNull<T>> pending Phase B ownership analysis. BSSMap const-generic params and fs::EntriesOption variant names are guesses.
// ──────────────────────────────────────────────────────────────────────────
