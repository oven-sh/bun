#[allow(unused_imports)] // c_int / c_uint only used in the macOS-gated extern block
use core::ffi::{c_char, c_int, c_uint, c_void};
use std::sync::OnceLock;

// Only referenced from the Darwin `extern "C"` block below; rustc's
// reachability analysis doesn't see uses inside dead `extern fn` signatures.
#[allow(non_camel_case_types, dead_code)]
type vm_size_t = usize;

// Environment.allow_assert and Environment.isMac and !Environment.enable_asan
// TODO(port): `enable_asan` mapped to a cargo feature; verify Phase B wires this the same way.
pub const ENABLED: bool = cfg!(debug_assertions) && cfg!(target_os = "macos") && !cfg!(bun_asan);

/// Zig: `fn heapLabel(comptime T: type) [:0]const u8`
///
/// Uses `@hasDecl(T, "heap_label")` to optionally pick a custom label, else
/// `bun.meta.typeBaseName(@typeName(T))`. In Rust this is a trait with a
/// blanket default; types override by implementing `HEAP_LABEL` explicitly.
pub trait HeapLabel {
    const HEAP_LABEL: &'static str;
}

// TODO(port): blanket impl wants `bun.meta.typeBaseName(@typeName(T))` at compile
// time. `core::any::type_name::<T>()` is not `const fn` and includes the full
// module path. Phase B: either a proc-macro derive, or require every `T` used
// with heap_breakdown to impl `HeapLabel` explicitly.
fn heap_label<T: HeapLabel>() -> &'static str {
    T::HEAP_LABEL
}

/// Zig: `pub fn allocator(comptime T: type) std.mem.Allocator`
pub fn allocator<T: HeapLabel>() -> &'static dyn crate::Allocator {
    named_allocator(heap_label::<T>())
}

/// Zig: `pub fn namedAllocator(comptime name: [:0]const u8) std.mem.Allocator`
///
/// In Zig the `"Bun__" ++ name` concatenation and the per-name `static` happen
/// at comptime via monomorphization. Rust cannot monomorphize on a `&'static str`
/// const generic on stable, so the per-name `OnceLock` must be minted at the
/// call site — see the `get_zone!` macro below. This function is a thin wrapper
/// that defers to that macro at call sites; here we expose the runtime half.
pub fn named_allocator(name: &'static str) -> &'static dyn crate::Allocator {
    // TODO(port): callers should prefer `named_allocator!("Name")` / `get_zone!` directly
    // so the OnceLock is per-name. This runtime path falls back to a process-global
    // map and is not zero-cost like the Zig comptime version.
    // PERF(port): was comptime monomorphization — profile in Phase B
    //
    // Zig: `getZone("Bun__" ++ name)` — the "Bun__" prefix is applied HERE, not in
    // `getZone`/`get_zone_runtime`. PORTING.md §Forbidden: no `Box::leak` for
    // 'static — `get_zone_runtime` owns the prefixed string in its OnceLock map,
    // so pass a borrowed `&str` and let the map intern it.
    let mut prefixed = String::with_capacity(5 + name.len());
    prefixed.push_str("Bun__");
    prefixed.push_str(name);
    get_zone(prefixed.as_bytes()).allocator()
}

// Comptime-literal form of `named_allocator` lives at crate root as `get_zone!`
// (see lib.rs). A local `macro_rules! named_allocator` re-export would collide
// with the `pub fn named_allocator` above in the value namespace on macOS where
// this module is actually compiled, so it is omitted here.

/// Zig: `pub fn getZoneT(comptime T: type) *Zone`
pub fn get_zone_t<T: HeapLabel>() -> &'static Zone {
    get_zone(heap_label::<T>().as_bytes())
}

/// Zig: `pub fn getZone(comptime name: [:0]const u8) *Zone`
///
/// Each comptime instantiation in Zig gets its own `static var zone` + `std.once`.
/// The faithful Rust translation is the crate-root `get_zone!` macro in lib.rs
/// that expands a fresh `OnceLock` per call site (per literal name). Not
/// duplicated here to avoid path-export collisions on macOS.

/// Runtime `getZone(name)` — looks up (or creates) the per-name zone.
///
/// Zig used a comptime-monomorphized `static` per literal; the crate-root
/// `get_zone!` macro is the zero-cost form. This runtime path keys a
/// process-global map for callers that pass a non-literal name (or for
/// `allocator<T>()`/`get_zone_t<T>()`, which cannot expand a per-T static on
/// stable Rust without a proc-macro).
// TODO(port): Phase B may replace with a `#[heap_label]` derive that expands
// `get_zone!` directly.
#[allow(clippy::assertions_on_constants)]
pub fn get_zone(name: &[u8]) -> &'static Zone {
    debug_assert!(
        ENABLED,
        "heap_breakdown::get_zone called with ENABLED=false"
    );

    use std::collections::HashMap;
    use std::sync::Mutex;
    // Map key = `name` (no NUL) so lookups match inserts. The NUL-terminated
    // label handed to `malloc_set_zone_name` is stored as the map *value*
    // (alongside the zone) to keep its allocation alive for 'static
    // (PORTING.md §Forbidden: never `Box::leak`).
    static ZONES: OnceLock<Mutex<HashMap<Vec<u8>, (Vec<u8>, &'static Zone)>>> = OnceLock::new();
    let map = ZONES.get_or_init(|| Mutex::new(HashMap::default()));
    let mut map = map.lock().unwrap();
    if let Some((_, z)) = map.get(name) {
        return *z;
    }
    // `name` verbatim (no prefix — matches Zig `getZone`), NUL-terminated.
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
    map.insert(name.to_vec(), (owned, zone));
    zone
}

bun_opaque::opaque_ffi! {
    /// Zig: `pub const Zone = opaque { ... };`
    ///
    /// Opaque FFI handle for a macOS `malloc_zone_t`.
    ///
    /// The `UnsafeCell` field makes `Zone: !Freeze`, so a `&Zone` does not assert
    /// immutability of the pointee. This is required because every malloc-zone FFI
    /// call (`malloc_zone_memalign`, `malloc_zone_free`, …) mutates the zone's
    /// internal state, and Zig models the handle as a freely-aliasing `*Zone`.
    /// Without `UnsafeCell`, casting `&Zone as *const _ as *mut _` and writing
    /// through it (via FFI) is UB under Stacked Borrows.
    pub struct Zone;
}

// SAFETY: `malloc_zone_t` is internally synchronized by libmalloc; sharing
// `&Zone` across threads is the documented usage (matches Zig `*Zone` via `std.once`).
unsafe impl Sync for Zone {}
unsafe impl Send for Zone {}

impl Zone {
    /// Zig: `pub fn init(comptime name: [:0]const u8) *Zone`
    ///
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

    // Zig exposed a `pub const vtable: std.mem.Allocator.VTable` with
    // { alloc, resize, remap = noRemap, free }. In Rust the equivalent is an
    // `impl crate::Allocator for Zone` (see below); the raw vtable struct is a
    // Zig-ism and is not materialized here, so the `resize`/`free` vtable thunks
    // (and the `malloc_size` helper they used) are not ported.
    // TODO(port): if Phase B's `bun_alloc::Allocator` is a literal vtable struct
    // (to match `std.mem.Allocator` ABI), reintroduce a `pub static VTABLE`
    // along with the `resize`/`raw_free` thunks.

    /// Zig: `pub fn allocator(zone: *Zone) std.mem.Allocator`
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
        // TODO(port): Zig passed `@returnAddress()` as the ret_addr hint; Rust has no
        // stable equivalent. Passing 0 — the macOS zone API ignores it anyway.
        let raw = Zone::raw_alloc(
            // SAFETY: vtable context pointer — `as_mut_ptr()` yields the
            // interior-mutable `*mut Zone`, erased to `*mut c_void` to match
            // the Zig `*anyopaque` allocator-vtable signature.
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

    /// Zig: `pub fn isInstance(allocator_: std.mem.Allocator) bool`
    ///
    /// Zig: `return allocator_.vtable == &vtable;` — implemented as a `TypeId`
    /// identity check via the `Allocator::type_id()` hook.
    pub fn is_instance(allocator_: &dyn crate::Allocator) -> bool {
        allocator_.is::<Self>()
    }
}

// `crate::Allocator` is a marker trait carrying `type_id()`; the Zig vtable
// methods (`alloc`/`resize`/`free`) are inherent on `Zone` above (`raw_alloc`,
// `resize`, `raw_free`). This impl makes `Zone` usable as `&dyn Allocator`
// for `is_instance` identity checks.
impl crate::Allocator for Zone {}

// TODO(port): move to bun_alloc_sys (or keep here gated `#[cfg(target_os = "macos")]`
// since these are macOS-only libc symbols).
#[cfg(target_os = "macos")]
unsafe extern "C" {
    /// No preconditions; returns the process default malloc zone.
    pub safe fn malloc_default_zone() -> *mut Zone;
    /// No preconditions; allocates a new zone (process-lifetime).
    pub safe fn malloc_create_zone(start_size: vm_size_t, flags: c_uint) -> *mut Zone;
    pub fn malloc_destroy_zone(zone: *mut Zone);
    // `&Zone` is ABI-identical to libmalloc's `malloc_zone_t *` (thin non-null
    // pointer to an `opaque_ffi!` `!Freeze` struct — interior mutation by C is
    // sound). The reference type encodes the only pointer-validity precondition,
    // so `safe fn` discharges the link-time proof for the pure-allocation entry
    // points (alloc/calloc/valloc/memalign return null on failure).
    pub safe fn malloc_zone_malloc(zone: &Zone, size: usize) -> *mut c_void;
    pub safe fn malloc_zone_calloc(zone: &Zone, num_items: usize, size: usize) -> *mut c_void;
    pub safe fn malloc_zone_valloc(zone: &Zone, size: usize) -> *mut c_void;
    pub fn malloc_zone_free(zone: *mut Zone, ptr: *mut c_void);
    pub fn malloc_zone_realloc(zone: *mut Zone, ptr: *mut c_void, size: usize) -> *mut c_void;
    pub fn malloc_zone_from_ptr(ptr: *const c_void) -> *mut Zone;
    pub safe fn malloc_zone_memalign(zone: &Zone, alignment: usize, size: usize) -> *mut c_void;
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
    pub fn malloc_set_zone_name(zone: *mut Zone, name: *const c_char);
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
    pub fn malloc_zone_memalign(_: &Zone, _: usize, _: usize) -> *mut c_void {
        unreachable!()
    }
}
#[cfg(not(target_os = "macos"))]
use stubs::malloc_zone_memalign;
#[cfg(not(target_os = "macos"))]
pub use stubs::{malloc_zone_calloc, malloc_zone_free, malloc_zone_malloc};

// ported from: src/bun_alloc/heap_breakdown.zig
