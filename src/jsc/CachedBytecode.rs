use core::ptr::NonNull;

use bun_core::String as BunString;
use bun_options_types::Format;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to JSC cached bytecode (a C++ `RefPtr<CachedBytecode>` payload).
    pub struct CachedBytecode;
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

    // safe: `CachedBytecode` is an `opaque_ffi!` ZST handle (`!Freeze` via
    // `UnsafeCell`); `&mut` is ABI-identical to a non-null `*mut` and the C++
    // refcount decrement is interior to the cell.
    safe fn CachedBytecode__deref(this: &mut CachedBytecode);
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
                &raw mut input_code_ptr,
                &raw mut input_code_size,
                &raw mut this,
            )
        };
        if ok {
            // SAFETY: on success, C++ guarantees both out-params are non-null
            // and the slice is valid for `input_code_size` bytes until deref().
            let slice =
                unsafe { bun_core::ffi::slice(input_code_ptr.unwrap().as_ptr(), input_code_size) };
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
                &raw mut input_code_ptr,
                &raw mut input_code_size,
                &raw mut this,
            )
        };
        if ok {
            // SAFETY: on success, C++ guarantees both out-params are non-null
            // and the slice is valid for `input_code_size` bytes until deref().
            let slice =
                unsafe { bun_core::ffi::slice(input_code_ptr.unwrap().as_ptr(), input_code_size) };
            return Some((slice, this.unwrap()));
        }

        None
    }

    pub fn deref(&mut self) {
        CachedBytecode__deref(self)
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
// Zig exposed a `std.mem.Allocator` VTable here so callers could store the
// bytecode slice alongside an "allocator" whose `.free()` decrements the
// CachedBytecode refcount. This is a Zig-specific ownership-tracking idiom.
//
// PORT NOTE: the Zig `VTable.free` slot called `CachedBytecode__deref(ctx)` and
// `VTable.alloc` panicked. The Rust `bun_alloc::Allocator` marker trait has no
// `alloc`/`free` methods to dispatch through — so the "free → deref" semantics
// cannot ride the trait object. Call sites that would have freed through this
// allocator must instead call `deref()` on the `NonNull<CachedBytecode>` handle
// directly. `is_instance` is preserved for the vtable-identity check in
// `bun_safety::alloc::has_ptr`.
// ──────────────────────────────────────────────────────────────────────────

impl bun_alloc::Allocator for CachedBytecode {}

impl CachedBytecode {
    /// Zig: `allocator_.vtable == VTable`. Expressed as concrete-type identity
    /// via the `Allocator::type_id()` hook (the documented Rust mapping for
    /// Zig vtable-pointer equality checks).
    pub fn is_instance(alloc: &dyn bun_alloc::Allocator) -> bool {
        alloc.is::<Self>()
    }
}

/// Link-time entry point for lower-tier crates (declared `extern "Rust"` in
/// `bun_bundler`). Generic "generate JSC bytecode off the main JS thread"
/// helper: marks the calling thread as a bytecode-only thread (so WTF timer
/// callbacks don't try to reach a non-existent VM), initializes JSC, generates
/// bytecode for the given output `format`, copies the bytes into an owned
/// buffer, and releases the C++ handle.
///
/// Symbol is definer-prefixed (`__bun_jsc_*`) per LAYERING_AUDIT — the body is
/// jsc-internal setup, not bundler logic.
#[unsafe(no_mangle)]
pub fn __bun_jsc_generate_cached_bytecode(
    format: Format,
    source: &[u8],
    source_provider_url: &mut BunString,
) -> Option<Box<[u8]>> {
    crate::virtual_machine::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.set(true);
    crate::initialize(false);
    let (bytes, handle) = CachedBytecode::generate(format, source, source_provider_url)?;
    let owned = Box::<[u8]>::from(bytes);
    // `handle` was just produced by C++ and is valid until deref;
    // `CachedBytecode` is an opaque ZST handle so `opaque_mut` is the
    // centralised zero-byte deref proof.
    CachedBytecode__deref(CachedBytecode::opaque_mut(handle.as_ptr()));
    Some(owned)
}

// ported from: src/jsc/CachedBytecode.zig
