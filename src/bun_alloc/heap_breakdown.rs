#[cfg(target_os = "macos")]
use core::ffi::c_uint;
use core::ffi::{c_char, c_void};

#[cfg(target_os = "macos")]
#[allow(non_camel_case_types)]
type vm_size_t = usize;

// Environment.allow_assert and Environment.isMac and !Environment.enable_asan
// (`bun_asan` is set via RUSTFLAGS `--cfg=bun_asan` in scripts/build/rust.ts.)
pub const ENABLED: bool = cfg!(debug_assertions) && cfg!(target_os = "macos") && !cfg!(bun_asan);

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
}

// macOS-only libmalloc symbols, kept here (gated on `target_os = "macos"`)
// since heap_breakdown is their only consumer.
#[cfg(target_os = "macos")]
unsafe extern "C" {
    /// No preconditions; allocates a new zone (process-lifetime).
    pub(crate) safe fn malloc_create_zone(start_size: vm_size_t, flags: c_uint) -> *mut Zone;
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
    pub fn malloc_zone_free(zone: *mut Zone, ptr: *mut c_void);
    pub(crate) fn malloc_set_zone_name(zone: *mut Zone, name: *const c_char);
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
}
#[cfg(not(target_os = "macos"))]
pub use stubs::{malloc_zone_calloc, malloc_zone_free, malloc_zone_malloc};
