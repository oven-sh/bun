use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use std::sync::OnceLock;

#[allow(non_camel_case_types)]
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
    // TODO(port): callers should prefer `get_zone!("Name").allocator()` directly so
    // the OnceLock is per-name. This runtime path falls back to a process-global
    // map and is not zero-cost like the Zig comptime version.
    // PERF(port): was comptime monomorphization — profile in Phase B
    get_zone_runtime(name).allocator()
}

/// Zig: `pub fn getZoneT(comptime T: type) *Zone`
pub fn get_zone_t<T: HeapLabel>() -> &'static Zone {
    get_zone_runtime(heap_label::<T>())
}

/// Zig: `pub fn getZone(comptime name: [:0]const u8) *Zone`
///
/// Each comptime instantiation in Zig gets its own `static var zone` + `std.once`.
/// The faithful Rust translation is a macro that expands a fresh `OnceLock` per
/// call site (per literal name).
#[macro_export]
macro_rules! get_zone {
    ($name:literal) => {{
        const _: () = assert!($crate::heap_breakdown::ENABLED);
        static ZONE: ::std::sync::OnceLock<&'static $crate::heap_breakdown::Zone> =
            ::std::sync::OnceLock::new();
        *ZONE.get_or_init(|| {
            // SAFETY: concat!($name, "\0") is a valid NUL-terminated C string literal.
            let cstr = unsafe {
                ::core::ffi::CStr::from_bytes_with_nul_unchecked(
                    concat!("Bun__", $name, "\0").as_bytes(),
                )
            };
            $crate::heap_breakdown::Zone::init(cstr)
        })
    }};
}

/// Runtime fallback for `getZone` when the name is not a literal at the Rust call site.
// TODO(port): Zig had no runtime path here (every `name` was comptime). This exists
// only because `allocator<T>()`/`get_zone_t<T>()` can't expand a per-T static on
// stable Rust without a proc-macro. Phase B may replace with a `#[heap_label]`
// derive that expands `get_zone!` directly.
fn get_zone_runtime(name: &'static str) -> &'static Zone {
    const _: () = assert!(ENABLED);
    use bun_collections::StringHashMap;
    use std::sync::Mutex;
    static ZONES: OnceLock<Mutex<StringHashMap<&'static Zone>>> = OnceLock::new();
    let map = ZONES.get_or_init(|| Mutex::new(StringHashMap::default()));
    let mut map = map.lock().unwrap();
    if let Some(z) = map.get(name.as_bytes()) {
        return *z;
    }
    // "Bun__" ++ name, NUL-terminated, leaked for 'static (zones live forever).
    let mut owned = Vec::with_capacity(5 + name.len() + 1);
    owned.extend_from_slice(b"Bun__");
    owned.extend_from_slice(name.as_bytes());
    owned.push(0);
    let leaked: &'static [u8] = Box::leak(owned.into_boxed_slice());
    // SAFETY: we just wrote a trailing NUL and there are no interior NULs in a type name.
    let cstr = unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(leaked) };
    let zone = Zone::init(cstr);
    map.insert(name.as_bytes().into(), zone);
    zone
}

/// Zig: `pub const Zone = opaque { ... };`
///
/// Opaque FFI handle for a macOS `malloc_zone_t`.
#[repr(C)]
pub struct Zone {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Zone {
    /// Zig: `pub fn init(comptime name: [:0]const u8) *Zone`
    pub fn init(name: &'static core::ffi::CStr) -> &'static Zone {
        // SAFETY: malloc_create_zone is safe to call with (0, 0); returns a
        // process-lifetime zone pointer. malloc_set_zone_name stores the pointer
        // (does not copy), hence the 'static bound on `name`.
        unsafe {
            let zone = malloc_create_zone(0, 0);
            malloc_set_zone_name(zone, name.as_ptr());
            &*zone
        }
    }

    fn aligned_alloc(zone: &Zone, len: usize, alignment: usize) -> Option<*mut u8> {
        // The posix_memalign only accepts alignment values that are a
        // multiple of the pointer size
        let eff_alignment = alignment.max(core::mem::size_of::<usize>());
        // SAFETY: zone is a valid malloc_zone_t; memalign with nonzero alignment is sound.
        let ptr = unsafe { malloc_zone_memalign(zone as *const Zone as *mut Zone, eff_alignment, len) };
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
            self as *const Zone as *mut c_void,
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
        // SAFETY: ptr was returned by `create`/`try_create` on this zone.
        unsafe { malloc_zone_free(self as *const Zone as *mut Zone, ptr.cast()) };
    }

    /// Zig: `pub fn isInstance(allocator_: std.mem.Allocator) bool`
    pub fn is_instance(allocator_: &dyn crate::Allocator) -> bool {
        // TODO(port): Zig compared `allocator_.vtable == &vtable`. With a trait
        // object we cannot compare vtable identity portably. Phase B: either
        // expose a `.kind()` on `bun_alloc::Allocator` or use `Any::type_id`.
        let _ = allocator_;
        false
    }
}

// TODO(port): the `crate::Allocator` trait shape is defined elsewhere in bun_alloc;
// this impl mirrors the Zig vtable { alloc, resize, remap=noRemap, free }.
impl crate::Allocator for Zone {
    fn alloc(&self, len: usize, alignment: usize, ret_addr: usize) -> Option<*mut u8> {
        Zone::raw_alloc(self as *const Zone as *mut c_void, len, alignment, ret_addr)
    }
    fn resize(&self, buf: &mut [u8], alignment: usize, new_len: usize, ret_addr: usize) -> bool {
        Zone::resize(self as *const Zone as *mut c_void, buf, alignment, new_len, ret_addr)
    }
    fn free(&self, buf: &mut [u8], alignment: usize, ret_addr: usize) {
        Zone::raw_free(self as *const Zone as *mut c_void, buf, alignment, ret_addr)
    }
    // remap = noRemap (default: return None / unsupported)
}

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
//   todos:      7
//   notes:      comptime per-name static (`getZone`) → macro + runtime fallback; `heapLabel` reflection → `HeapLabel` trait; vtable → `impl crate::Allocator`; `is_instance` stubbed.
// ──────────────────────────────────────────────────────────────────────────
