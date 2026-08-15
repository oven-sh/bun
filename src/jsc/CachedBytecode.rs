use core::ptr::NonNull;

use bun_core::String as BunString;
use bun_core::strings::EncodingNonAscii;
use bun_options_types::Format;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to JSC cached bytecode (a C++ `RefPtr<CachedBytecode>` payload).
    pub struct CachedBytecode;
}

/// How the generators read `input_code`; the C++ side of the enum is in
/// ZigSourceProvider.cpp and the two must stay in step. JSC only accepts
/// bytecode generated from a string equal to the one the module loader builds,
/// so the generator has to decode the bytes the same way the load path for
/// that kind of source does: the on-disk `.jsc` loader reads raw bytes as
/// Latin-1 (`clone_latin1`), while a compiled executable stores module text in
/// its final width (see `stores_transcoded_contents` in
/// `StandaloneModuleGraph.rs`).
#[repr(u8)]
#[derive(Clone, Copy)]
enum BytecodeSourceEncoding {
    Utf8 = 0,
    Latin1 = 1,
    Utf16 = 2,
}

impl From<EncodingNonAscii> for BytecodeSourceEncoding {
    fn from(encoding: EncodingNonAscii) -> Self {
        match encoding {
            EncodingNonAscii::Utf8 => Self::Utf8,
            EncodingNonAscii::Latin1 => Self::Latin1,
            EncodingNonAscii::Utf16 => Self::Utf16,
        }
    }
}

type Generator = unsafe extern "C" fn(
    source_provider_url: *mut BunString,
    input_code: *const u8,
    input_source_code_size: usize,
    input_encoding: BytecodeSourceEncoding,
    output_byte_code: *mut Option<NonNull<u8>>,
    output_byte_code_size: *mut usize,
    cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
) -> bool;

unsafe extern "C" {
    fn generateCachedModuleByteCodeFromSourceCode(
        source_provider_url: *mut BunString,
        input_code: *const u8,
        input_source_code_size: usize,
        input_encoding: BytecodeSourceEncoding,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
    ) -> bool;

    fn generateCachedCommonJSProgramByteCodeFromSourceCode(
        source_provider_url: *mut BunString,
        input_code: *const u8,
        input_source_code_size: usize,
        input_encoding: BytecodeSourceEncoding,
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
    // SAFETY CONTRACT: the returned `&'static [u8]` actually borrows from the
    // `CachedBytecode` handle and is invalidated when `deref()` is called. Callers own
    // the handle and must call `deref()` (or drop via `allocator()`) to free.
    pub(crate) fn generate(
        format: Format,
        input: &[u8],
        input_encoding: EncodingNonAscii,
        source_provider_url: &mut BunString,
    ) -> Option<(&'static [u8], NonNull<CachedBytecode>)> {
        let generator: Generator = match format {
            Format::Esm => generateCachedModuleByteCodeFromSourceCode,
            Format::Cjs => generateCachedCommonJSProgramByteCodeFromSourceCode,
            _ => return None,
        };

        let mut this: Option<NonNull<CachedBytecode>> = None;
        let mut output_size: usize = 0;
        let mut output_ptr: Option<NonNull<u8>> = None;
        // SAFETY: out-params are valid for write; input slice valid for read.
        let ok = unsafe {
            generator(
                source_provider_url,
                input.as_ptr(),
                input.len(),
                BytecodeSourceEncoding::from(input_encoding),
                &raw mut output_ptr,
                &raw mut output_size,
                &raw mut this,
            )
        };
        if !ok {
            return None;
        }
        // SAFETY: on success, C++ guarantees both out-params are non-null
        // and the slice is valid for `output_size` bytes until deref().
        let slice = unsafe { bun_core::ffi::slice(output_ptr.unwrap().as_ptr(), output_size) };
        Some((slice, this.unwrap()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// The `bun_alloc::Allocator` marker trait has no
// `alloc`/`free` methods to dispatch through — so "free → deref" semantics
// cannot ride the trait object. Call sites that would have freed through this
// allocator must instead call `deref()` on the `NonNull<CachedBytecode>` handle
// directly.
// ──────────────────────────────────────────────────────────────────────────

impl bun_alloc::Allocator for CachedBytecode {}

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
pub(crate) fn __bun_jsc_generate_cached_bytecode(
    format: Format,
    source: &[u8],
    source_encoding: EncodingNonAscii,
    source_provider_url: &mut BunString,
) -> Option<Box<[u8]>> {
    crate::virtual_machine::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.set(true);
    crate::initialize(crate::InitializeOptions::default());
    let (bytes, handle) =
        CachedBytecode::generate(format, source, source_encoding, source_provider_url)?;
    let owned = Box::<[u8]>::from(bytes);
    // `handle` was just produced by C++ and is valid until deref;
    // `CachedBytecode` is an opaque ZST handle so `opaque_mut` is the
    // centralised zero-byte deref proof.
    CachedBytecode__deref(CachedBytecode::opaque_mut(handle.as_ptr()));
    Some(owned)
}
