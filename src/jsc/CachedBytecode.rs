use core::ptr::NonNull;

use bun_bundler::bundle_v2::dispatch::{BytecodeLinkEncoder, EncoderStringTable};
use bun_bundler::bytecode_order::CodeNamesRef;
use bun_core::String as BunString;
use bun_core::vec::BorrowedBuf;
use bun_options_types::Format;
use bun_simdutf_sys::simdutf::{self, WithUtf16Len};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to JSC cached bytecode (a C++ `RefPtr<CachedBytecode>` payload).
    pub struct CachedBytecode;
}

unsafe extern "C" {
    fn Bun__BytecodeLinkEncoder__create(
        external_strings: &EncoderStringTable,
        hot_functions: *const u64,
        hot_function_count: usize,
        known_functions: *const u64,
        known_function_count: usize,
        evaluated_modules: *const u64,
        evaluated_module_count: usize,
        not_evaluated_modules: *const u64,
        not_evaluated_module_count: usize,
    ) -> *mut BytecodeLinkEncoder;
    safe fn Bun__BytecodeLinkEncoder__addModule(
        this: &BytecodeLinkEncoder,
        source_provider_url: &BunString,
        input_code: &BunString,
        is_module: bool,
        depth: u32,
        optimize: bool,
        names: &CodeNamesRef<'_>,
    ) -> bool;
    /// InternalModuleRegistry.cpp: what `Bun__generateInternalModuleBytecode[FromSource]` encodes, as a module of the link.
    safe fn Bun__BytecodeLinkEncoder__addInternalModule(
        this: &BytecodeLinkEncoder,
        id: u32,
        depth: u32,
        names: &CodeNamesRef<'_>,
    ) -> bool;
    fn Bun__BytecodeLinkEncoder__addInternalModuleFromSource(
        this: &BytecodeLinkEncoder,
        text: *const u8,
        text_len: usize,
        name: *const u8,
        name_len: usize,
        url: *const u8,
        url_len: usize,
        source_stamp: u32,
        depth: u32,
        names: &CodeNamesRef<'_>,
    ) -> bool;
    fn Bun__BytecodeLinkEncoder__finish(
        this: &BytecodeLinkEncoder,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
        entry_offsets: *mut u32,
        entry_offset_count: usize,
        region_ends: *mut u32,
        named_hot_functions: *mut u32,
        placed_hot_functions: *mut u32,
        functions_without_name: *mut u32,
    ) -> bool;
}

unsafe extern "C" {
    // safe: no arguments; C++ never returns null from `new`.
    safe fn Bun__EncoderStringTable__create() -> NonNull<EncoderStringTable>;
    fn Bun__EncoderStringTable__serialize(
        this: &EncoderStringTable,
        hot_string_hashes: *const u64,
        hot_string_hash_count: usize,
        ctx: *mut core::ffi::c_void,
        append: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize),
    );
    fn Bun__EncoderStringTable__slotForLatin1(
        this: &EncoderStringTable,
        chars: *const u8,
        len: usize,
    ) -> u32;
    fn Bun__EncoderStringTable__slotForUTF16(
        this: &EncoderStringTable,
        chars: *const u16,
        len: usize,
    ) -> u32;

    fn generateCachedModuleByteCodeFromSourceCode(
        source_provider_url: &BunString,
        input_code: &BunString,
        depth: u32,
        optimize: bool,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
        external_strings: Option<&EncoderStringTable>,
    ) -> bool;

    fn generateCachedCommonJSProgramByteCodeFromSourceCode(
        source_provider_url: &BunString,
        input_code: &BunString,
        depth: u32,
        optimize: bool,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
        external_strings: Option<&EncoderStringTable>,
    ) -> bool;

    // safe: `CachedBytecode` is an `opaque_ffi!` ZST handle (`!Freeze` via
    // `UnsafeCell`); `&mut` is ABI-identical to a non-null `*mut` and the C++
    // refcount decrement is interior to the cell.
    safe fn CachedBytecode__deref(this: &mut CachedBytecode);

    /// InternalModuleRegistry.cpp: bytecode for internal JS module `id`, as the registry will consume it.
    fn Bun__generateInternalModuleBytecode(
        id: u32,
        depth: u32,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
        external_strings: Option<&EncoderStringTable>,
    ) -> bool;
    fn Bun__generateInternalModuleBytecodeFromSource(
        text: *const u8,
        text_len: usize,
        name: *const u8,
        name_len: usize,
        url: *const u8,
        url_len: usize,
        source_stamp: u32,
        depth: u32,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
        external_strings: Option<&EncoderStringTable>,
    ) -> bool;

    /// InternalModuleRegistry.cpp: this executable's builtins section (`bun_exe_format::builtins` layout).
    fn Bun__builtinsSection(length: *mut usize) -> *const u8;
}

/// `input` (WTF-8, non-ASCII from `first_non_ascii`) as a UTF-16 string JSC owns, written in place.
fn utf16_source(input: &[u8], first_non_ascii: usize) -> BunString {
    use bun_core::strings;
    let (ascii, tail) = input.split_at(first_non_ascii);
    if strings::is_valid_utf8(tail) {
        let tail = WithUtf16Len::utf8(tail);
        let (string, units) = BunString::create_uninitialized_utf16(ascii.len() + tail.utf16_len());
        if string.is_dead() {
            bun_alloc::out_of_memory();
        }
        let (ascii_units, tail_units) = units.split_at_mut(ascii.len());
        strings::copy_u8_into_u16(ascii_units, ascii);
        let mut tail_units = BorrowedBuf::from(tail_units);
        let result =
            simdutf::convert::utf8::to::utf16::with_errors::le(tail, tail_units.unfilled());
        debug_assert!(result.is_successful());
        return string;
    }
    // A lone surrogate or an invalid byte: the scalar path decides the length.
    BunString::clone_utf16(&strings::wtf8_to_utf16_alloc(input).expect("non-ASCII input"))
}

/// The payload of a `JSC::CachedBytecode`, and a reference to it.
struct Generated {
    bytes: NonNull<u8>,
    size: usize,
    handle: NonNull<CachedBytecode>,
}

impl core::ops::Deref for Generated {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        // SAFETY: `handle` keeps its payload alive.
        unsafe { core::slice::from_raw_parts(self.bytes.as_ptr(), self.size) }
    }
}

impl Drop for Generated {
    fn drop(&mut self) {
        CachedBytecode__deref(CachedBytecode::opaque_mut(self.handle.as_ptr()));
    }
}

impl Generated {
    /// `generate` passes the out-params on to C++, which fills them in if it returns true.
    fn new(
        generate: impl FnOnce(
            &mut Option<NonNull<u8>>,
            &mut usize,
            &mut Option<NonNull<CachedBytecode>>,
        ) -> bool,
    ) -> Option<Self> {
        let (mut bytes, mut size, mut handle) = (None, 0, None);
        if !generate(&mut bytes, &mut size, &mut handle) {
            return None;
        }
        Some(Self {
            bytes: bytes?,
            size,
            handle: handle?,
        })
    }

    fn from_source(
        format: Format,
        input: &[u8],
        source_provider_url: &BunString,
        depth: u32,
        optimize: bool,
        external_strings: Option<&EncoderStringTable>,
    ) -> Option<Self> {
        let f = match format {
            Format::Esm => generateCachedModuleByteCodeFromSourceCode,
            Format::Cjs => generateCachedCommonJSProgramByteCodeFromSourceCode,
            _ => return None,
        };
        // An executable stores the chunk as `encode_text_module` writes it (Latin-1, or UTF-16 when non-ASCII) and
        // aliases it at runtime; a `.jsc` next to a bundle is keyed on the file's bytes read as Latin-1.
        let source = match external_strings.and_then(|_| bun_core::strings::first_non_ascii(input))
        {
            Some(first_non_ascii) => utf16_source(input, first_non_ascii as usize),
            None => BunString::clone_latin1(input),
        };
        // SAFETY: `source` is live for the call.
        Self::new(|bytes, size, handle| unsafe {
            f(
                source_provider_url,
                &source,
                depth,
                optimize,
                bytes,
                size,
                handle,
                external_strings,
            )
        })
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
pub(crate) fn __bun_jsc_generate_cached_bytecode(
    format: Format,
    source: &[u8],
    source_provider_url: &BunString,
    depth: u32,
    optimize: bool,
    external_strings: Option<&EncoderStringTable>,
) -> Option<Box<[u8]>> {
    crate::initialize(crate::InitializeOptions::default());
    let bytecode = Generated::from_source(
        format,
        source,
        source_provider_url,
        depth,
        optimize,
        external_strings,
    )?;
    Some(Box::from(&*bytecode))
}

/// A `JSC::BytecodeLinkEncoder` on the calling thread's bytecode VM; every later call must come from the same thread.
///
/// # Safety
/// `external_strings` outlives the encoder.
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_jsc_bytecode_link_encoder_new(
    external_strings: &EncoderStringTable,
    hot_functions: &[u64],
    known_functions: &[u64],
    evaluated_modules: &[u64],
    not_evaluated_modules: &[u64],
) -> NonNull<BytecodeLinkEncoder> {
    crate::initialize(crate::InitializeOptions::default());
    // SAFETY: the slices are valid for the call (C++ copies them), and the table is the caller's contract. `new` never returns null.
    unsafe {
        NonNull::new_unchecked(Bun__BytecodeLinkEncoder__create(
            external_strings,
            hot_functions.as_ptr(),
            hot_functions.len(),
            known_functions.as_ptr(),
            known_functions.len(),
            evaluated_modules.as_ptr(),
            evaluated_modules.len(),
            not_evaluated_modules.as_ptr(),
            not_evaluated_modules.len(),
        ))
    }
}

/// Parses `source` and adds it to the link's payload; false on a parse error. The source text is what `from_source` would
/// encode; `names` is what an order file calls its code.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_add_module(
    encoder: &BytecodeLinkEncoder,
    format: Format,
    source: &[u8],
    source_provider_url: &BunString,
    depth: u32,
    optimize: bool,
    names: &CodeNamesRef<'_>,
) -> bool {
    let is_module = match format {
        Format::Esm => true,
        Format::Cjs => false,
        _ => return false,
    };
    let source = match bun_core::strings::first_non_ascii(source) {
        Some(first_non_ascii) => utf16_source(source, first_non_ascii as usize),
        None => BunString::clone_latin1(source),
    };
    Bun__BytecodeLinkEncoder__addModule(
        encoder,
        source_provider_url,
        &source,
        is_module,
        depth,
        optimize,
        names,
    )
}

/// This executable's internal module `id` as a module of the link; false if it does not parse.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_add_internal_module(
    encoder: &BytecodeLinkEncoder,
    id: u32,
    depth: u32,
    names: &CodeNamesRef<'_>,
) -> bool {
    Bun__BytecodeLinkEncoder__addInternalModule(encoder, id, depth, names)
}

/// Same, for an internal module of another bun executable (cross-compiling), as
/// `__bun_jsc_generate_internal_module_bytecode_from_source` takes it.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_add_internal_module_from_source(
    encoder: &BytecodeLinkEncoder,
    source: &[u8],
    name: &[u8],
    url: &[u8],
    source_stamp: u32,
    depth: u32,
    names: &CodeNamesRef<'_>,
) -> bool {
    // SAFETY: the slices are valid for the duration of the call.
    unsafe {
        Bun__BytecodeLinkEncoder__addInternalModuleFromSource(
            encoder,
            source.as_ptr(),
            source.len(),
            name.as_ptr(),
            name.len(),
            url.as_ptr(),
            url.len(),
            source_stamp,
            depth,
            names,
        )
    }
}

/// The payload, each module's cache-entry offset in it (in the order of the successful `add_*` calls), where each of the
/// payload's regions ends (`JSC::BytecodeLinkEncoder`), how many of the order files' hot functions are functions
/// of this link, and for each module how many functions with code its names did not cover.
///
/// # Safety
/// `encoder` has not been finished.
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_jsc_bytecode_link_encoder_finish(
    encoder: &BytecodeLinkEncoder,
    module_count: usize,
) -> Option<bun_bundler::bytecode_order::LinkedPayload> {
    let mut entry_offsets = vec![0u32; module_count];
    let mut region_ends = [0u32; bun_resolver::LINKED_BYTECODE_REGION_COUNT];
    let mut named_hot_functions = 0u32;
    let mut placed_hot_functions = 0u32;
    let mut functions_without_name = 0u32;
    // SAFETY: the caller's contract; out-params are initialized locals of the sizes C++ expects.
    let bytecode = Generated::new(|bytes, size, handle| unsafe {
        Bun__BytecodeLinkEncoder__finish(
            encoder,
            bytes,
            size,
            handle,
            entry_offsets.as_mut_ptr(),
            entry_offsets.len(),
            region_ends.as_mut_ptr(),
            &raw mut named_hot_functions,
            &raw mut placed_hot_functions,
            &raw mut functions_without_name,
        )
    })?;
    // Room for the region ends the bundler appends (`bun_bundler::bytecode_order::payload_file`), so that the payload
    // is copied once.
    let mut payload = Vec::with_capacity(bytecode.len() + size_of_val(&region_ends));
    payload.extend_from_slice(&bytecode);
    Some(bun_bundler::bytecode_order::LinkedPayload {
        payload,
        entry_offsets,
        region_ends,
        named_hot_functions,
        placed_hot_functions,
        functions_without_name,
    })
}

/// Frees the calling thread's bytecode-generation VM, if it made one.
pub fn destroy_bytecode_cache_vm() {
    unsafe extern "C" {
        safe fn Bun__destroyBytecodeCacheVM();
    }
    Bun__destroyBytecodeCacheVM()
}

/// Serialize the shared string table into an owned buffer for the standalone graph.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_encoder_string_table_serialize(
    table: &EncoderStringTable,
    hot_strings: &[u64],
) -> Box<[u8]> {
    let mut out = Vec::<u8>::new();
    unsafe extern "C" fn append(ctx: *mut core::ffi::c_void, bytes: *const u8, len: usize) {
        // SAFETY: `ctx` is `&mut Vec<u8>`; `bytes` valid for `len`.
        unsafe {
            (*ctx.cast::<Vec<u8>>()).extend_from_slice(core::slice::from_raw_parts(bytes, len))
        };
    }
    // SAFETY: the slice is valid for the call; callback receives our `&mut out`.
    unsafe {
        Bun__EncoderStringTable__serialize(
            table,
            hot_strings.as_ptr(),
            hot_strings.len(),
            (&raw mut out).cast(),
            append,
        )
    };
    out.into_boxed_slice()
}

/// The 4-byte cache slot for a module-info name (`EncoderStringTable::slotFor`).
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_encoder_string_table_slot(table: &EncoderStringTable, wtf8: &[u8]) -> u32 {
    match bun_core::strings::wtf8_to_utf16_alloc(wtf8) {
        // SAFETY: the slice is valid for the call.
        None => unsafe { Bun__EncoderStringTable__slotForLatin1(table, wtf8.as_ptr(), wtf8.len()) },
        // SAFETY: as above.
        Some(units) => unsafe {
            Bun__EncoderStringTable__slotForUTF16(table, units.as_ptr(), units.len())
        },
    }
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_wtf_string_hash(wtf8: &[u8]) -> u32 {
    unsafe extern "C" {
        fn Bun__WTFStringHashLatin1(ptr: *const u8, len: usize) -> u32;
        fn Bun__WTFStringHashUTF16(ptr: *const u16, len: usize) -> u32;
    }
    match bun_core::strings::wtf8_to_utf16_alloc(wtf8) {
        // SAFETY: pure functions reading `len` units from `ptr`.
        None => unsafe { Bun__WTFStringHashLatin1(wtf8.as_ptr(), wtf8.len()) },
        // SAFETY: as above.
        Some(units) => unsafe { Bun__WTFStringHashUTF16(units.as_ptr(), units.len()) },
    }
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_encoder_string_table_new() -> NonNull<EncoderStringTable> {
    crate::initialize(crate::InitializeOptions::default());
    Bun__EncoderStringTable__create()
}

/// `bun build --compile --bytecode`: this executable's builtins section — header, module index and sources
/// (`bun_exe_format::builtins::Builtins::parse` reads it).
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_host_builtins() -> &'static [u8] {
    let mut length: usize = 0;
    // SAFETY: returns a pointer to immutable section data that lives for the whole process, and its length.
    unsafe {
        let ptr = Bun__builtinsSection(&raw mut length);
        core::slice::from_raw_parts(ptr, length)
    }
}

/// `bun build --compile --bytecode`: bytecode for this executable's internal module `id` (an InternalModuleRegistry
/// field index), generated the way InternalModuleRegistry consumes it. `depth` bounds nested-function code blocks
/// (`u32::MAX` = all of them; 0 = just the module wrapper's own).
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_generate_internal_module_bytecode(
    id: u32,
    depth: u32,
    external_strings: Option<&EncoderStringTable>,
) -> Option<Box<[u8]>> {
    crate::initialize(crate::InitializeOptions::default());
    // SAFETY: the out-params are the locals of `Generated::new`.
    let bytecode = Generated::new(|bytes, size, handle| unsafe {
        Bun__generateInternalModuleBytecode(id, depth, bytes, size, handle, external_strings)
    })?;
    Some(Box::from(&*bytecode))
}

/// Same, for an internal module of another bun executable (cross-compiling): `source`, `name` and `url` are that
/// module's entry in the other executable's builtins section and `source_stamp` is that section's stamp.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_generate_internal_module_bytecode_from_source(
    source: &[u8],
    name: &[u8],
    url: &[u8],
    source_stamp: u32,
    depth: u32,
    external_strings: Option<&EncoderStringTable>,
) -> Option<Box<[u8]>> {
    crate::initialize(crate::InitializeOptions::default());
    // SAFETY: the three slices are valid for their lengths for the duration of the call.
    let bytecode = Generated::new(|bytes, size, handle| unsafe {
        Bun__generateInternalModuleBytecodeFromSource(
            source.as_ptr(),
            source.len(),
            name.as_ptr(),
            name.len(),
            url.as_ptr(),
            url.len(),
            source_stamp,
            depth,
            bytes,
            size,
            handle,
            external_strings,
        )
    })?;
    Some(Box::from(&*bytecode))
}
