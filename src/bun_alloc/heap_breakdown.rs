use core::cell::UnsafeCell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use std::sync::OnceLock;

// Only referenced from the Darwin `extern "C"` block below; rustc's
// reachability analysis doesn't see uses inside dead `extern fn` signatures.
#[allow(non_camel_case_types, dead_code)]
type vm_size_t = usize;

// Environment.allow_assert and Environment.isMac and !Environment.enable_asan
// TODO(port): `enable_asan` mapped to a cargo feature; verify Phase B wires this the same way.
pub const ENABLED: bool =
    cfg!(debug_assertions) && cfg!(target_os = "macos") && !cfg!(feature = "asan");

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
    get_zone_runtime(&prefixed).allocator()
}

// Comptime-literal form of `named_allocator` lives at crate root as `get_zone!`
// (see lib.rs). A local `macro_rules! named_allocator` re-export would collide
// with the `pub fn named_allocator` above in the value namespace on macOS where
// this module is actually compiled, so it is omitted here.

/// Zig: `pub fn getZoneT(comptime T: type) *Zone`
pub fn get_zone_t<T: HeapLabel>() -> &'static Zone {
    get_zone_runtime(heap_label::<T>())
}

/// Zig: `pub fn getZone(comptime name: [:0]const u8) *Zone`
///
/// Each comptime instantiation in Zig gets its own `static var zone` + `std.once`.
/// The faithful Rust translation is the crate-root `get_zone!` macro in lib.rs
/// that expands a fresh `OnceLock` per call site (per literal name). Not
/// duplicated here to avoid path-export collisions on macOS.

/// Runtime fallback for `getZone` when the name is not a literal at the Rust call site.
// TODO(port): Zig had no runtime path here (every `name` was comptime). This exists
// only because `allocator<T>()`/`get_zone_t<T>()` can't expand a per-T static on
// stable Rust without a proc-macro. Phase B may replace with a `#[heap_label]`
// derive that expands `get_zone!` directly.
fn get_zone_runtime(name: &str) -> &'static Zone {
    debug_assert!(ENABLED, "heap_breakdown::get_zone_runtime called with ENABLED=false");

    use std::collections::HashMap;
    use std::sync::Mutex;
    // Map value carries the owning `Vec<u8>` for the NUL-terminated label so it
    // lives for process lifetime (PORTING.md §Forbidden: never `Box::leak`).
    static ZONES: OnceLock<Mutex<HashMap<Vec<u8>, (Vec<u8>, &'static Zone)>>> = OnceLock::new();
    let map = ZONES.get_or_init(|| Mutex::new(HashMap::default()));
    let mut map = map.lock().unwrap();
    if let Some((_, z)) = map.get(name.as_bytes()) {
        return *z;
    }
    // `name` verbatim (no prefix — matches Zig `getZone`), NUL-terminated.
    let mut owned = Vec::with_capacity(name.len() + 1);
    owned.extend_from_slice(name.as_bytes());
    owned.push(0);
    // The Vec's heap buffer address is stable across the move into the map
    // (only the {ptr,len,cap} header moves), and the entry is never removed.
    let raw = owned.as_ptr().cast::<c_char>();
    // SAFETY: `raw` points into a NUL-terminated buffer that is moved into the
    // 'static `ZONES` map immediately below and never freed — valid for process
    // lifetime per `Zone::init` contract.
    let zone = unsafe { Zone::init(raw) };
    map.insert(name.as_bytes().to_vec(), (owned, zone));
    zone
}

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
#[repr(C)]
pub struct Zone {
    _p: UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// SAFETY: `malloc_zone_t` is internally synchronized by libmalloc; sharing
// `&Zone` across threads is the documented usage (matches Zig `*Zone` via `std.once`).
unsafe impl Sync for Zone {}
unsafe impl Send for Zone {}

impl Zone {
    /// Recover the raw `*mut Zone` from a shared reference.
    ///
    /// Sound because `Zone` contains `UnsafeCell` (is `!Freeze`): a `&Zone`
    /// grants permission to mutate the opaque C state behind it, matching the
    /// Zig spec where every method takes `*Zone`.
    #[inline(always)]
    fn as_ptr(&self) -> *mut Zone {
        // SAFETY: route through `UnsafeCell::get()` — the sanctioned way to
        // derive a writable raw pointer from `&self`. `_p` is the first (and
        // only sized) field of `#[repr(C)] Zone`, so its address is `self`'s
        // address; provenance covers the full C `malloc_zone_t` allocation
        // because every `&Zone` originates from the `*mut Zone` returned by
        // `malloc_create_zone` (see `Zone::init`). Avoids the
        // `&T as *const T as *mut T` pattern, which is UB under Stacked
        // Borrows when `T: Freeze` and a lint hazard regardless.
        self._p.get().cast::<Zone>()
    }

    /// Zig: `pub fn init(comptime name: [:0]const u8) *Zone`
    ///
    /// # Safety
    /// `name` must point to a NUL-terminated C string that remains valid for
    /// the entire process lifetime — `malloc_set_zone_name` stores the pointer
    /// (does not copy).
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

    fn aligned_alloc(zone: &Zone, len: usize, alignment: usize) -> Option<*mut u8> {
        // The posix_memalign only accepts alignment values that are a
        // multiple of the pointer size
        let eff_alignment = alignment.max(core::mem::size_of::<usize>());
        // SAFETY: `zone.as_ptr()` is the live `*mut malloc_zone_t` returned by
        // `malloc_create_zone`; interior mutation through it is permitted (see
        // `Zone::as_ptr`). `eff_alignment` is a nonzero power of two ≥ word size.
        let ptr = unsafe { malloc_zone_memalign(zone.as_ptr(), eff_alignment, len) };
        if ptr.is_null() {
            None
        } else {
            Some(ptr.cast::<u8>())
        }
    }

    fn aligned_alloc_size(ptr: *mut u8) -> usize {
        // SAFETY: ptr was returned by a malloc-zone allocation in this process.
        unsafe { malloc_size(ptr.cast()) }
    }

    fn raw_alloc(zone: *mut c_void, len: usize, alignment: usize, _ret_addr: usize) -> Option<*mut u8> {
        // SAFETY: zone was produced from `&Zone` via the vtable; cast back is the original pointer.
        Zone::aligned_alloc(unsafe { &*(zone.cast::<Zone>()) }, len, alignment)
    }

    fn resize(_zone: *mut c_void, buf: &mut [u8], _alignment: usize, new_len: usize, _ret_addr: usize) -> bool {
        if new_len <= buf.len() {
            return true;
        }

        let full_len = Zone::aligned_alloc_size(buf.as_mut_ptr());
        if new_len <= full_len {
            return true;
        }

        false
    }

    fn raw_free(zone: *mut c_void, buf: &mut [u8], _alignment: usize, _ret_addr: usize) {
        // SAFETY: zone is a valid *mut Zone (see raw_alloc); buf.ptr was allocated by this zone.
        unsafe { malloc_zone_free(zone.cast::<Zone>(), buf.as_mut_ptr().cast()) };
    }

    // Zig exposed a `pub const vtable: std.mem.Allocator.VTable` with
    // { alloc, resize, remap = noRemap, free }. In Rust the equivalent is an
    // `impl crate::Allocator for Zone` (see below); the raw vtable struct is a
    // Zig-ism and is not materialized here.
    // TODO(port): if Phase B's `bun_alloc::Allocator` is a literal vtable struct
    // (to match `std.mem.Allocator` ABI), reintroduce a `pub static VTABLE`.

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
            // SAFETY: vtable context pointer — `as_ptr()` yields the
            // interior-mutable `*mut Zone`, erased to `*mut c_void` to match
            // the Zig `*anyopaque` allocator-vtable signature.
            self.as_ptr().cast::<c_void>(),
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
        // SAFETY: `self.as_ptr()` is the live malloc zone (interior-mutable,
        // see `Zone::as_ptr`); `ptr` was returned by `create`/`try_create` on
        // this same zone.
        unsafe { malloc_zone_free(self.as_ptr(), ptr.cast()) };
    }

    /// Zig: `pub fn isInstance(allocator_: std.mem.Allocator) bool`
    ///
    /// Zig: `return allocator_.vtable == &vtable;` — implemented as a `TypeId`
    /// identity check via the `Allocator::type_id()` hook.
    pub fn is_instance(allocator_: &dyn crate::Allocator) -> bool {
        crate::Allocator::type_id(allocator_) == core::any::TypeId::of::<Zone>()
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
    pub fn malloc_default_zone() -> *mut Zone;
    pub fn malloc_create_zone(start_size: vm_size_t, flags: c_uint) -> *mut Zone;
    pub fn malloc_destroy_zone(zone: *mut Zone);
    pub fn malloc_zone_malloc(zone: *mut Zone, size: usize) -> *mut c_void;
    pub fn malloc_zone_calloc(zone: *mut Zone, num_items: usize, size: usize) -> *mut c_void;
    pub fn malloc_zone_valloc(zone: *mut Zone, size: usize) -> *mut c_void;
    pub fn malloc_zone_free(zone: *mut Zone, ptr: *mut c_void);
    pub fn malloc_zone_realloc(zone: *mut Zone, ptr: *mut c_void, size: usize) -> *mut c_void;
    pub fn malloc_zone_from_ptr(ptr: *const c_void) -> *mut Zone;
    pub fn malloc_zone_memalign(zone: *mut Zone, alignment: usize, size: usize) -> *mut c_void;
    pub fn malloc_zone_batch_malloc(zone: *mut Zone, size: usize, results: *mut *mut c_void, num_requested: c_uint) -> c_uint;
    pub fn malloc_zone_batch_free(zone: *mut Zone, to_be_freed: *mut *mut c_void, num: c_uint);
    pub fn malloc_default_purgeable_zone() -> *mut Zone;
    pub fn malloc_make_purgeable(ptr: *mut c_void);
    pub fn malloc_make_nonpurgeable(ptr: *mut c_void) -> c_int;
    pub fn malloc_zone_register(zone: *mut Zone);
    pub fn malloc_zone_unregister(zone: *mut Zone);
    pub fn malloc_set_zone_name(zone: *mut Zone, name: *const c_char);
    pub fn malloc_get_zone_name(zone: *mut Zone) -> *const c_char;
    pub fn malloc_zone_pressure_relief(zone: *mut Zone, goal: usize) -> usize;

    // std.c.malloc_size
    fn malloc_size(ptr: *const c_void) -> usize;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/heap_breakdown.zig (146 lines)
//   confidence: medium
//   todos:      8
//   notes:      comptime per-name static (`getZone`) → macro + runtime fallback; `heapLabel` reflection → `HeapLabel` trait; vtable → `impl crate::Allocator`; `is_instance` stubbed; "Bun__" prefix scoped to `named_allocator` only (matches Zig).
// ──────────────────────────────────────────────────────────────────────────
