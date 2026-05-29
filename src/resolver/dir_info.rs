use core::ptr::NonNull;

use bun_alloc as allocators;
use bun_core::Generation;
use bun_core::feature_flags as FeatureFlags;
use bun_sys::Fd;

use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub use allocators::IndexType;
use allocators::NOT_FOUND;

pub type Index = IndexType;

#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct DirInfoRef(bun_ptr::BackRef<DirInfo>);

impl DirInfoRef {
    /// Wrap a raw BSSMap slot pointer.
    ///
    /// # Safety
    /// `p` must be non-null and point to a `DirInfo` slot owned by the
    /// process-lifetime BSSMap singleton (`HashMap` below) — i.e. obtained
    /// from `BSSMapInner::put` / `at_index`. The slot must remain live for
    /// the entire lifetime of every copy of the returned handle (always true
    /// for BSSMap slots: they are never individually freed).
    #[inline]
    pub const unsafe fn from_raw(p: *mut DirInfo) -> Self {
        // SAFETY: caller contract — `p` is a non-null BSSMap slot that
        // outlives every copy of the handle (the `BackRef` invariant).
        DirInfoRef(unsafe { bun_ptr::BackRef::from_raw(p) })
    }

    #[inline]
    pub fn from_slot(slot: &mut DirInfo) -> Self {
        DirInfoRef(bun_ptr::BackRef::new_mut(slot))
    }

    /// Raw pointer to the underlying slot. Preserves mut-provenance from the
    /// BSSMap allocation site for the `dir_info_uncached` fill path.
    #[inline]
    pub const fn as_ptr(self) -> *mut DirInfo {
        self.0.as_ptr()
    }
}

impl core::ops::Deref for DirInfoRef {
    type Target = DirInfo;
    #[inline]
    fn deref(&self) -> &DirInfo {
        self.0.get()
    }
}

impl core::fmt::Debug for DirInfoRef {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("DirInfoRef").field(&self.0.as_ptr()).finish()
    }
}

pub struct DirInfo {
    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    pub parent: Index,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    pub enclosing_browser_scope: Index,
    pub package_json_for_browser_field: Option<&'static PackageJSON>,
    pub enclosing_tsconfig_json: Option<&'static TSConfigJSON>,

    pub enclosing_package_json: Option<&'static PackageJSON>,

    pub package_json_for_dependencies: Option<NonNull<PackageJSON>>,

    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_path: &'static [u8],
    pub entries: Index,
    pub package_json: Option<NonNull<PackageJSON>>,
    pub tsconfig_json: Option<NonNull<TSConfigJSON>>,
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

#[inline]
fn arena_ref<T>(p: NonNull<T>) -> &'static T {
    // SAFETY: ARENA — see fn doc; pointee is process-lifetime, never freed
    // while a `DirInfo` reader is live.
    unsafe { &*p.as_ptr() }
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

    /// Read-only view of `package_json`. The field stores `NonNull` to preserve
    /// mut-provenance for `reset()`; callers that only read go through here.
    #[inline]
    pub fn package_json(&self) -> Option<&'static PackageJSON> {
        self.package_json.map(arena_ref)
    }

    /// Read-only view of `package_json_for_dependencies`. The field stores
    /// `NonNull` to preserve mut-provenance for the write at resolver.zig:2394;
    /// callers that only read go through here.
    #[inline]
    pub fn package_json_for_dependencies(&self) -> Option<&'static PackageJSON> {
        self.package_json_for_dependencies.map(arena_ref)
    }

    /// Read-only view of `tsconfig_json`. See `package_json()`.
    #[inline]
    pub fn tsconfig_json(&self) -> Option<&'static TSConfigJSON> {
        self.tsconfig_json.map(arena_ref)
    }

    pub fn get_file_descriptor(&self) -> Fd {
        if FeatureFlags::STORE_FILE_DESCRIPTORS {
            if let Some(fs::EntriesOption::Entries(entries)) =
                fs::FileSystem::instance().fs.entries_at(self.entries, 0)
            {
                return entries.fd;
            }
        }
        Fd::INVALID
    }

    pub fn get_entries(&self, generation: Generation) -> Option<*mut fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries_at(self.entries, generation)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(std::ptr::from_mut(*entries)),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_entries_ref(&self, generation: Generation) -> Option<&'static fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries_at(self.entries, generation)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_entries_const(&self) -> Option<&fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries
            .at_index(self.entries)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    #[inline]
    pub fn get_parent(&self) -> Option<DirInfoRef> {
        ref_at_index(self.parent)
    }

    pub fn get_enclosing_browser_scope(&self) -> Option<DirInfoRef> {
        ref_at_index(self.enclosing_browser_scope)
    }
}

static DIR_INFO_MAP: bun_core::AtomicCell<Option<NonNull<HashMap>>> =
    bun_core::AtomicCell::new(None);

/// Raw pointer to the lazy DirInfo BSSMap singleton. Callers reborrow
/// per-access under the resolver mutex — PORTING.md §Global mutable state.
#[inline(always)]
pub fn hash_map_instance() -> *mut HashMap {
    if let Some(p) = DIR_INFO_MAP.load() {
        return p.as_ptr();
    }
    hash_map_instance_init()
}

#[cold]
#[inline(never)]
fn hash_map_instance_init() -> *mut HashMap {
    let new = HashMap::init();
    match DIR_INFO_MAP.compare_exchange(None, Some(new)) {
        Ok(_) => new.as_ptr(),
        Err(existing) => existing.unwrap().as_ptr(),
    }
}

#[inline]
fn ref_at_index(index: Index) -> Option<DirInfoRef> {
    // SAFETY: ARENA — `hash_map_instance()` is the never-null BSSMap singleton
    // (process-lifetime; never freed). Resolver mutex held by caller serializes
    // mutation. `at_index` yields a slot satisfying `DirInfoRef`'s invariant.
    unsafe { (*hash_map_instance()).at_index(index) }.map(DirInfoRef::from_slot)
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
            // SAFETY: `p` carries mut-provenance from `intern_package_json` (NonNull
            // derived from the arena's `&mut Box<PackageJSON>`); this is the sole
            // remaining owner at shutdown. `drop_in_place` releases its owned
            // resources in-place (storage itself is BSS/cache-owned and not freed
            // here, matching Zig `p.deinit()`).
            unsafe { core::ptr::drop_in_place(p.as_ptr()) };
        }
        if let Some(t) = self.tsconfig_json.take() {
            // SAFETY: `t` carries mut-provenance from `heap::alloc` in the
            // tsconfig merge loop; this is the sole remaining owner at shutdown.
            // `drop_in_place` releases its owned resources in-place (storage
            // itself is BSS/cache-owned and not freed here, matching Zig
            // `t.deinit()`).
            unsafe { core::ptr::drop_in_place(t.as_ptr()) };
        }
    }
}

pub type HashMap = allocators::BSSMapInner<DirInfo, 2048, true>;

pub trait HashMapExt {
    fn get_or_put(
        &mut self,
        key: &[u8],
    ) -> core::result::Result<allocators::Result, bun_core::Error>;
    fn put(
        &mut self,
        result: &mut allocators::Result,
        value: DirInfo,
    ) -> core::result::Result<*mut DirInfo, bun_core::Error>;
    fn mark_not_found(&mut self, result: allocators::Result);
    fn remove(&mut self, key: &[u8]) -> bool;
    fn values_mut(&mut self) -> core::slice::IterMut<'_, DirInfo>;
}
impl HashMapExt for HashMap {
    #[inline]
    fn get_or_put(
        &mut self,
        key: &[u8],
    ) -> core::result::Result<allocators::Result, bun_core::Error> {
        // Dot-syntax picks inherent `BSSMapInner::get_or_put` (inherent > trait); not recursive.
        self.get_or_put(key).map_err(Into::into)
    }
    #[inline]
    fn put(
        &mut self,
        result: &mut allocators::Result,
        value: DirInfo,
    ) -> core::result::Result<*mut DirInfo, bun_core::Error> {
        self.put(result, value)
            .map(std::ptr::from_mut::<DirInfo>)
            .map_err(Into::into)
    }
    #[inline]
    fn mark_not_found(&mut self, result: allocators::Result) {
        // Inherent `BSSMapInner::mark_not_found` (inherent > trait); not recursive.
        self.mark_not_found(result)
    }
    #[inline]
    fn remove(&mut self, key: &[u8]) -> bool {
        // Inherent `BSSMapInner::remove` (inherent > trait); not recursive.
        self.remove(key)
    }
    #[inline]
    fn values_mut(&mut self) -> core::slice::IterMut<'_, DirInfo> {
        // Spec resolver.zig:602 `for (r.dir_cache.values()) |*di|` — backing_buf slice
        // only (overflow_list excluded, matching Zig `BSSMapType` which exposes no
        // overflow iterator). Inherent `values()` already returns `&mut [DirInfo]`.
        self.values().iter_mut()
    }
}

// ported from: src/resolver/dir_info.zig
