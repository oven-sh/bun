use core::ffi::{c_char, c_void};
#[cfg(target_os = "macos")]
use core::ffi::{c_int, c_uint};

#[cfg(target_os = "macos")]
#[allow(non_camel_case_types)]
type vm_size_t = usize;

// Environment.allow_assert and Environment.isMac and !Environment.enable_asan
// (`bun_asan` is set via RUSTFLAGS `--cfg=bun_asan` in scripts/build/rust.ts.)
pub const ENABLED: bool = cfg!(debug_assertions) && cfg!(target_os = "macos") && !cfg!(bun_asan);

/// The crate-root `get_zone!` macro in lib.rs
/// expands a fresh `OnceLock` per call site (per literal name). Not
/// duplicated here to avoid path-export collisions on macOS.

/// Runtime `getZone(name)` — looks up (or creates) the per-name zone. The
/// `get_zone!` macro is the zero-cost form. This runtime path keys a
/// process-global map for callers that pass a non-literal name.
#[allow(clippy::assertions_on_constants)]
pub fn get_zone(name: &[u8]) -> &'static Zone {
    debug_assert!(
        ENABLED,
        "heap_breakdown::get_zone called with ENABLED=false"
    );

    use core::cell::UnsafeCell;
    // Map key = `name` (no NUL) so lookups match inserts. The NUL-terminated
    // label handed to `malloc_set_zone_name` is stored as the map *value*
    // (alongside the zone) to keep its allocation alive for 'static
    // (PORTING.md §Forbidden: never `Box::leak`).
    struct ZoneTable(UnsafeCell<Vec<(Vec<u8>, Vec<u8>, &'static Zone)>>);
    // SAFETY: the inner `Vec` is only accessed while `LOCK` is held.
    unsafe impl Sync for ZoneTable {}
    static LOCK: crate::Mutex = crate::Mutex::new();
    static ZONES: ZoneTable = ZoneTable(UnsafeCell::new(Vec::new()));
    let _guard = LOCK.lock();
    // SAFETY: exclusive access — `ZONES.0` is only dereferenced while `LOCK`
    // is held, and `_guard` is live for the rest of this function.
    let zones = unsafe { &mut *ZONES.0.get() };
    if let Some((_, _, z)) = zones.iter().find(|(k, _, _)| k.as_slice() == name) {
        return *z;
    }
    // `name` verbatim (no prefix), NUL-terminated.
    let mut owned = Vec::with_capacity(name.len() + 1);
    owned.extend_from_slice(name);
    owned.push(0);
    // The Vec's heap buffer address is stable across the move into the map
    // (only the {ptr,len,cap} header moves), and the entry is never removed.
    let raw = owned.as_ptr().cast::<c_char>();
    // SAFETY: `raw` points into a NUL-terminated buffer that is moved into the
    // 'static `ZONES` map immediately below and never freed — valid for process
    // lifetime per `Zone::init` contract.
    let zone = unsafe { Zone::init(raw) };
    zones.push((name.to_vec(), owned, zone));
    zone
}

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a macOS `malloc_zone_t`.
    ///
    /// The `UnsafeCell` field makes `Zone: !Freeze`, so a `&Zone` does not assert
    /// immutability of the pointee. This is required because every malloc-zone FFI
    /// call (`malloc_zone_memalign`, `malloc_zone_free`, …) mutates the zone's
    /// internal state.
    /// Without `UnsafeCell`, casting `&Zone as *const _ as *mut _` and writing
    /// through it (via FFI) is UB under Stacked Borrows.
    pub struct Zone;
}

// SAFETY: `malloc_zone_t` is internally synchronized by libmalloc; sharing
// `&Zone` across threads is the documented usage.
unsafe impl Sync for Zone {}
// SAFETY: `Zone` is an opaque libmalloc handle with no thread-affine state; the
// zone API is callable from any thread, so transferring the handle is sound.
unsafe impl Send for Zone {}

impl Zone {
    /// # Safety
    /// `name` must point to a NUL-terminated C string that remains valid for
    /// the entire process lifetime — `malloc_set_zone_name` stores the pointer
    /// (does not copy).
    #[cfg(target_os = "macos")]
    pub unsafe fn init(name: *const c_char) -> &'static Zone {
        // SAFETY: malloc_create_zone is safe to call with (0, 0); returns a
        // process-lifetime zone pointer. Caller guarantees `name` outlives the
        // process.
        unsafe {
            let zone = malloc_create_zone(0, 0);
            malloc_set_zone_name(zone, name);
            &*zone
        }
    }
    #[cfg(not(target_os = "macos"))]
    #[allow(clippy::missing_safety_doc)]
    pub unsafe fn init(_name: *const c_char) -> &'static Zone {
        unreachable!("heap_breakdown is macOS-only; guard call sites on ENABLED")
    }

    #[inline]
    pub fn malloc_zone_malloc(&self, size: usize) -> Option<*mut c_void> {
        let p = malloc_zone_malloc(self, size);
        if p.is_null() { None } else { Some(p) }
    }

    #[inline]
    pub fn malloc_zone_calloc(&self, num_items: usize, size: usize) -> Option<*mut c_void> {
        let p = malloc_zone_calloc(self, num_items, size);
        if p.is_null() { None } else { Some(p) }
    }

    /// # Safety
    /// `ptr` must have been allocated by this zone (via `malloc_zone_malloc`
    /// / `malloc_zone_calloc`) and not already freed.
    #[inline]
    pub unsafe fn malloc_zone_free(&self, ptr: *mut c_void) {
        // SAFETY: caller contract above; `self` is a live `malloc_zone_t`.
        unsafe { malloc_zone_free(self.as_mut_ptr(), ptr) }
    }

    fn aligned_alloc(zone: &Zone, len: usize, alignment: usize) -> Option<*mut u8> {
        // The posix_memalign only accepts alignment values that are a
        // multiple of the pointer size
        let eff_alignment = alignment.max(core::mem::size_of::<usize>());
        let ptr = malloc_zone_memalign(zone, eff_alignment, len);
        if ptr.is_null() {
            None
        } else {
            Some(ptr.cast::<u8>())
        }
    }

    fn raw_alloc(
        zone: *mut c_void,
        len: usize,
        alignment: usize,
        _ret_addr: usize,
    ) -> Option<*mut u8> {
        // SAFETY: zone was produced from `&Zone` via the vtable; cast back is the original pointer.
        Zone::aligned_alloc(unsafe { &*(zone.cast::<Zone>()) }, len, alignment)
    }

    pub fn allocator(&'static self) -> &'static dyn crate::Allocator {
        self
    }

    /// Create a single-item pointer with initialized data.
    #[inline]
    pub fn create<T>(&self, data: T) -> *mut T {
        // bun.handleOom → panic on OOM (Rust default).
        self.try_create(data).expect("OutOfMemory")
    }

    /// Error-returning version of `create`.
    #[inline]
    pub fn try_create<T>(&self, data: T) -> Result<*mut T, crate::AllocError> {
        let alignment = core::mem::align_of::<T>();
        // Pass 0 as the ret_addr hint — the macOS zone API ignores it anyway.
        let raw = Zone::raw_alloc(
            // SAFETY: vtable context pointer — `as_mut_ptr()` yields the
            // interior-mutable `*mut Zone`, erased to `*mut c_void` to match
            // the allocator-vtable signature.
            self.as_mut_ptr().cast::<c_void>(),
            core::mem::size_of::<T>(),
            alignment,
            0,
        )
        .ok_or(crate::AllocError)?;
        let ptr = raw.cast::<T>();
        // SAFETY: raw_alloc returned a non-null, properly aligned, sizeof(T)-byte block.
        unsafe { ptr.write(data) };
        Ok(ptr)
    }

    /// Free a single-item pointer
    #[inline]
    pub fn destroy<T>(&self, ptr: *mut T) {
        // SAFETY: `self.as_mut_ptr()` is the live malloc zone (interior-mutable,
        // see `opaque_ffi!`); `ptr` was returned by `create`/`try_create` on
        // this same zone.
        unsafe { malloc_zone_free(self.as_mut_ptr(), ptr.cast()) };
    }

    /// Implemented as a `TypeId`
    /// identity check via the `Allocator::type_id()` hook.
    pub fn is_instance(allocator_: &dyn crate::Allocator) -> bool {
        allocator_.is::<Self>()
    }
}

// `crate::Allocator` is a marker trait carrying `type_id()`; the allocation
// methods (`alloc`/`resize`/`free`) are inherent on `Zone` above (`raw_alloc`,
// `resize`, `raw_free`). This impl makes `Zone` usable as `&dyn Allocator`
// for `is_instance` identity checks.
impl crate::Allocator for Zone {}

// macOS-only libmalloc symbols, kept here (gated on `target_os = "macos"`)
// since heap_breakdown is their only consumer.
#[cfg(target_os = "macos")]
unsafe extern "C" {
    /// No preconditions; returns the process default malloc zone.
    pub safe fn malloc_default_zone() -> *mut Zone;
    /// No preconditions; allocates a new zone (process-lifetime).
    pub(crate) safe fn malloc_create_zone(start_size: vm_size_t, flags: c_uint) -> *mut Zone;
    pub fn malloc_destroy_zone(zone: *mut Zone);
    // `&Zone` is ABI-identical to libmalloc's `malloc_zone_t *` (thin non-null
    // pointer to an `opaque_ffi!` `!Freeze` struct — interior mutation by C is
    // sound). The reference type encodes the only pointer-validity precondition,
    // so `safe fn` discharges the link-time proof for the pure-allocation entry
    // points (alloc/calloc/valloc/memalign return null on failure).
    pub(crate) safe fn malloc_zone_malloc(zone: &Zone, size: usize) -> *mut c_void;
    pub(crate) safe fn malloc_zone_calloc(
        zone: &Zone,
        num_items: usize,
        size: usize,
    ) -> *mut c_void;
    pub safe fn malloc_zone_valloc(zone: &Zone, size: usize) -> *mut c_void;
    pub fn malloc_zone_free(zone: *mut Zone, ptr: *mut c_void);
    pub fn malloc_zone_realloc(zone: *mut Zone, ptr: *mut c_void, size: usize) -> *mut c_void;
    pub fn malloc_zone_from_ptr(ptr: *const c_void) -> *mut Zone;
    pub(crate) safe fn malloc_zone_memalign(
        zone: &Zone,
        alignment: usize,
        size: usize,
    ) -> *mut c_void;
    pub fn malloc_zone_batch_malloc(
        zone: *mut Zone,
        size: usize,
        results: *mut *mut c_void,
        num_requested: c_uint,
    ) -> c_uint;
    pub fn malloc_zone_batch_free(zone: *mut Zone, to_be_freed: *mut *mut c_void, num: c_uint);
    /// No preconditions.
    pub safe fn malloc_default_purgeable_zone() -> *mut Zone;
    pub fn malloc_make_purgeable(ptr: *mut c_void);
    pub fn malloc_make_nonpurgeable(ptr: *mut c_void) -> c_int;
    pub fn malloc_zone_register(zone: *mut Zone);
    pub fn malloc_zone_unregister(zone: *mut Zone);
    pub(crate) fn malloc_set_zone_name(zone: *mut Zone, name: *const c_char);
    pub fn malloc_get_zone_name(zone: *mut Zone) -> *const c_char;
    pub fn malloc_zone_pressure_relief(zone: *mut Zone, goal: usize) -> usize;
}

// Non-macOS stubs so cross-platform call sites guarded by `if ENABLED { … }`
// (where `ENABLED` is a `const false`) still type-check. Never executed.
#[cfg(not(target_os = "macos"))]
#[allow(clippy::missing_safety_doc)]
mod stubs {
    use super::*;
    pub fn malloc_zone_malloc(_: &Zone, _: usize) -> *mut c_void {
        unreachable!()
    }
    pub fn malloc_zone_calloc(_: &Zone, _: usize, _: usize) -> *mut c_void {
        unreachable!()
    }
    pub unsafe fn malloc_zone_free(_: *mut Zone, _: *mut c_void) {
        unreachable!()
    }
    pub(crate) fn malloc_zone_memalign(_: &Zone, _: usize, _: usize) -> *mut c_void {
        unreachable!()
    }
}
#[cfg(not(target_os = "macos"))]
use stubs::malloc_zone_memalign;
#[cfg(not(target_os = "macos"))]
pub use stubs::{malloc_zone_calloc, malloc_zone_free, malloc_zone_malloc};
