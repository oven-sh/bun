use core::ptr::NonNull;

use bun_str::String as BunString;
use bun_bundler::options::Format;

/// Opaque FFI handle to JSC cached bytecode (a C++ `RefPtr<CachedBytecode>` payload).
#[repr(C)]
pub struct CachedBytecode {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to <area>_sys
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
    // TODO(port): the returned `&'static [u8]` actually borrows from the
    // `CachedBytecode` handle and is invalidated when `deref()` is called.
    // Phase B should wrap this in an owning type whose `Drop` calls `deref`.
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
// ──────────────────────────────────────────────────────────────────────────

impl CachedBytecode {
    // TODO(port): Zig allocator-vtable ownership shim — replace call sites
    // with an owning slice type whose Drop calls deref().
    pub fn allocator(&mut self) -> &dyn bun_alloc::Allocator {
        todo!("CachedBytecode.allocator: Zig allocator-vtable shim; use owning slice type in Phase B")
    }

    // TODO(port): Zig allocator-vtable ownership shim — replace call sites
    // with an owning slice type whose Drop calls deref().
    pub fn is_instance(_allocator: &dyn bun_alloc::Allocator) -> bool {
        todo!("CachedBytecode.is_instance: Zig vtable-identity check; use owning slice type in Phase B")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/CachedBytecode.zig (76 lines)
//   confidence: medium
//   todos:      4
//   notes:      VTable/allocator/is_instance are Zig allocator-idiom shims left as todo!() stubs; Phase B should replace with an owning slice type whose Drop calls deref().
// ──────────────────────────────────────────────────────────────────────────
