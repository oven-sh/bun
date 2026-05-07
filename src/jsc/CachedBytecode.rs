use core::ptr::NonNull;

use bun_string::String as BunString;
use bun_options_types::Format;

/// Opaque FFI handle to JSC cached bytecode (a C++ `RefPtr<CachedBytecode>` payload).
#[repr(C)]
pub struct CachedBytecode {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    fn generateCachedModuleByteCodeFromSourceCode(
        source_provider_url: *mut BunString,
        input_code: *const u8,
        input_source_code_size: usize,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
    ) -> bool;

    fn generateCachedCommonJSProgramByteCodeFromSourceCode(
        source_provider_url: *mut BunString,
        input_code: *const u8,
        input_source_code_size: usize,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
    ) -> bool;

    fn CachedBytecode__deref(this: *mut CachedBytecode);
}

impl CachedBytecode {
    // PORT NOTE: the returned `&'static [u8]` actually borrows from the
    // `CachedBytecode` handle and is invalidated when `deref()` is called —
    // identical to the Zig `[]const u8` + `*CachedBytecode` pair. Callers own
    // the handle and must call `deref()` (or drop via `allocator()`) to free.
    pub fn generate_for_esm(
        source_provider_url: &mut BunString,
        input: &[u8],
    ) -> Option<(&'static [u8], NonNull<CachedBytecode>)> {
        let mut this: Option<NonNull<CachedBytecode>> = None;

        let mut input_code_size: usize = 0;
        let mut input_code_ptr: Option<NonNull<u8>> = None;
        // SAFETY: out-params are valid for write; input slice valid for read.
        let ok = unsafe {
            generateCachedModuleByteCodeFromSourceCode(
                source_provider_url,
                input.as_ptr(),
                input.len(),
                &mut input_code_ptr,
                &mut input_code_size,
                &mut this,
            )
        };
        if ok {
            // SAFETY: on success, C++ guarantees both out-params are non-null
            // and the slice is valid for `input_code_size` bytes until deref().
            let slice = unsafe {
                core::slice::from_raw_parts(input_code_ptr.unwrap().as_ptr(), input_code_size)
            };
            return Some((slice, this.unwrap()));
        }

        None
    }

    pub fn generate_for_cjs(
        source_provider_url: &mut BunString,
        input: &[u8],
    ) -> Option<(&'static [u8], NonNull<CachedBytecode>)> {
        let mut this: Option<NonNull<CachedBytecode>> = None;
        let mut input_code_size: usize = 0;
        let mut input_code_ptr: Option<NonNull<u8>> = None;
        // SAFETY: out-params are valid for write; input slice valid for read.
        let ok = unsafe {
            generateCachedCommonJSProgramByteCodeFromSourceCode(
                source_provider_url,
                input.as_ptr(),
                input.len(),
                &mut input_code_ptr,
                &mut input_code_size,
                &mut this,
            )
        };
        if ok {
            // SAFETY: on success, C++ guarantees both out-params are non-null
            // and the slice is valid for `input_code_size` bytes until deref().
            let slice = unsafe {
                core::slice::from_raw_parts(input_code_ptr.unwrap().as_ptr(), input_code_size)
            };
            return Some((slice, this.unwrap()));
        }

        None
    }

    pub fn deref(&mut self) {
        // SAFETY: self is a valid CachedBytecode handle from C++.
        unsafe { CachedBytecode__deref(self) }
    }

    pub fn generate(
        format: Format,
        input: &[u8],
        source_provider_url: &mut BunString,
    ) -> Option<(&'static [u8], NonNull<CachedBytecode>)> {
        match format {
            Format::Esm => Self::generate_for_esm(source_provider_url, input),
            Format::Cjs => Self::generate_for_cjs(source_provider_url, input),
            _ => None,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Zig exposed a `std.mem.Allocator` VTable here so that callers could store
// the bytecode slice alongside an "allocator" whose `.free()` decrements the
// CachedBytecode refcount. This is a Zig-specific ownership-tracking idiom.
// In Rust the equivalent is an owning smart-pointer type; Phase B should
// replace call sites with that.
//
// PORT NOTE: the Zig `VTable.free` slot called `CachedBytecode__deref(ctx)` and
// `VTable.alloc` panicked. The Rust `bun_alloc::Allocator` marker trait has no
// `alloc`/`free` methods to dispatch through — so the "free → deref" semantics
// cannot ride the trait object. Call sites that would have freed through this
// allocator must instead drop the owning `NonNull<CachedBytecode>` handle and
// call `deref()` directly. `is_instance` is preserved for the vtable-identity
// check in `bun_safety::alloc::has_ptr`.
// ──────────────────────────────────────────────────────────────────────────

impl bun_alloc::Allocator for CachedBytecode {}

// Zero-sized probe used to obtain this impl's trait-object vtable pointer for
// identity comparison (mirrors Zig's static `VTable` address).
static PROBE: CachedBytecode = CachedBytecode {
    _p: [],
    _m: core::marker::PhantomData,
};

#[inline]
fn vtable_of(a: &dyn bun_alloc::Allocator) -> *const () {
    let raw: *const dyn bun_alloc::Allocator = a;
    // SAFETY: `*const dyn Trait` is a two-word fat pointer (data, vtable); the
    // layout is guaranteed by the Rust trait-object ABI.
    unsafe { core::mem::transmute::<*const dyn bun_alloc::Allocator, [*const (); 2]>(raw)[1] }
}

impl CachedBytecode {
    /// Zig: `.{ .ptr = this, .vtable = VTable }`. The returned `&dyn Allocator`
    /// fat pointer carries both halves: data = `self`, vtable = the
    /// `<CachedBytecode as Allocator>` vtable.
    pub fn allocator(&self) -> &dyn bun_alloc::Allocator {
        self
    }

    /// Zig: `allocator_.vtable == VTable`. Compares the vtable half of the
    /// `&dyn Allocator` fat pointer against this type's vtable.
    pub fn is_instance(allocator: &dyn bun_alloc::Allocator) -> bool {
        core::ptr::eq(vtable_of(allocator), vtable_of(&PROBE))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/CachedBytecode.zig (76 lines)
//   confidence: medium
//   todos:      2
//   notes:      allocator()/is_instance() ported as &dyn Allocator fat-pointer vtable-identity (matches bun_safety::alloc pattern); the Zig free→deref slot has no trait method to ride, so Phase B should replace call sites with an owning slice type whose Drop calls deref().
// ──────────────────────────────────────────────────────────────────────────
