use core::ptr::NonNull;

use bun_bundler::bytecode_order::CodeNamesRef;
use bun_core::String as BunString;
use bun_options_types::Format;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to JSC cached bytecode (a C++ `RefPtr<CachedBytecode>` payload).
    pub struct CachedBytecode;
}

bun_opaque::opaque_ffi! {
    /// One `JSC::EncoderStringTable` shared by every `encodeCodeBlock` in a `--compile --bytecode` build so ≥4-char strings become 4-byte ordinals in each chunk's payload and their characters are written once by `serialize()`.
    pub struct EncoderStringTable;
}

impl EncoderStringTable {
    pub fn new() -> NonNull<EncoderStringTable> {
        // SAFETY: C++ never returns null from `new`.
        unsafe { NonNull::new_unchecked(Bun__EncoderStringTable__create()) }
    }
    /// `hot_strings`: `bytecodeOrderStringHash` values from a payload order file, hottest first; their records go first.
    pub fn serialize(this: NonNull<EncoderStringTable>, hot_strings: &[u64]) -> Vec<u8> {
        let mut out = Vec::<u8>::new();
        unsafe extern "C" fn append(ctx: *mut core::ffi::c_void, bytes: *const u8, len: usize) {
            // SAFETY: `ctx` is `&mut Vec<u8>`; `bytes` valid for `len`.
            unsafe {
                (*ctx.cast::<Vec<u8>>()).extend_from_slice(core::slice::from_raw_parts(bytes, len))
            };
        }
        // SAFETY: `this` is a valid table; callback receives our `&mut out`.
        unsafe {
            Bun__EncoderStringTable__serialize(
                this.as_ptr(),
                hot_strings.as_ptr(),
                hot_strings.len(),
                (&raw mut out).cast(),
                append,
            )
        };
        out
    }
    pub fn destroy(this: NonNull<EncoderStringTable>) {
        // SAFETY: `this` was produced by `new`.
        unsafe { Bun__EncoderStringTable__destroy(this.as_ptr()) };
    }
    /// The 4-byte cache slot for a module-info name (`EncoderStringTable::slotFor`).
    pub fn slot_for_wtf8(this: NonNull<EncoderStringTable>, wtf8: &[u8]) -> u32 {
        match bun_core::strings::wtf8_to_utf16_alloc(wtf8) {
            // SAFETY: `this` is a live table; the slice is valid for the call.
            None => unsafe {
                Bun__EncoderStringTable__slotForLatin1(this.as_ptr(), wtf8.as_ptr(), wtf8.len())
            },
            // SAFETY: as above.
            Some(units) => unsafe {
                Bun__EncoderStringTable__slotForUTF16(this.as_ptr(), units.as_ptr(), units.len())
            },
        }
    }
}

bun_opaque::opaque_ffi! {
    /// One `JSC::BytecodeLinkEncoder`: every chunk of a `--compile --bytecode` link encoded into one payload, laid out by a payload order file.
    pub struct BytecodeLinkEncoder;
}

unsafe extern "C" {
    fn Bun__BytecodeLinkEncoder__create(
        external_strings: *mut EncoderStringTable,
        hot_functions: *const u64,
        hot_function_count: usize,
        known_functions: *const u64,
        known_function_count: usize,
        evaluated_modules: *const u64,
        evaluated_module_count: usize,
        not_evaluated_modules: *const u64,
        not_evaluated_module_count: usize,
    ) -> *mut BytecodeLinkEncoder;
    fn Bun__BytecodeLinkEncoder__destroy(this: *mut BytecodeLinkEncoder);
    fn Bun__BytecodeLinkEncoder__addModule(
        this: *mut BytecodeLinkEncoder,
        source_provider_url: &BunString,
        input_code: &BunString,
        is_module: bool,
        depth: u32,
        optimize: bool,
        names: &CodeNamesRef<'_>,
    ) -> bool;
    /// InternalModuleRegistry.cpp: what `Bun__generateInternalModuleBytecode[FromSource]` encodes, as a module of the link.
    fn Bun__BytecodeLinkEncoder__addInternalModule(
        this: *mut BytecodeLinkEncoder,
        id: u32,
        depth: u32,
        names: &CodeNamesRef<'_>,
    ) -> bool;
    fn Bun__BytecodeLinkEncoder__addInternalModuleFromSource(
        this: *mut BytecodeLinkEncoder,
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
        this: *mut BytecodeLinkEncoder,
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
    fn Bun__EncoderStringTable__create() -> *mut EncoderStringTable;
    fn Bun__EncoderStringTable__destroy(this: *mut EncoderStringTable);
    fn Bun__EncoderStringTable__serialize(
        this: *mut EncoderStringTable,
        hot_string_hashes: *const u64,
        hot_string_hash_count: usize,
        ctx: *mut core::ffi::c_void,
        append: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize),
    );
    fn Bun__EncoderStringTable__slotForLatin1(
        this: *mut EncoderStringTable,
        chars: *const u8,
        len: usize,
    ) -> u32;
    fn Bun__EncoderStringTable__slotForUTF16(
        this: *mut EncoderStringTable,
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
        external_strings: Option<NonNull<EncoderStringTable>>,
    ) -> bool;

    fn generateCachedCommonJSProgramByteCodeFromSourceCode(
        source_provider_url: &BunString,
        input_code: &BunString,
        depth: u32,
        optimize: bool,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
        external_strings: Option<NonNull<EncoderStringTable>>,
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
        external_strings: Option<NonNull<EncoderStringTable>>,
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
        external_strings: Option<NonNull<EncoderStringTable>>,
    ) -> bool;

    /// InternalModuleRegistry.cpp: this executable's builtins section (`bun_exe_format::builtins` layout).
    fn Bun__builtinsSection(length: *mut usize) -> *const u8;
}

/// `input` (WTF-8, non-ASCII from `first_non_ascii`) as a UTF-16 string JSC owns, written in place.
fn utf16_source(input: &[u8], first_non_ascii: usize) -> BunString {
    use bun_core::strings;
    let tail = &input[first_non_ascii..];
    if strings::is_valid_utf8(tail) {
        let len = first_non_ascii + strings::element_length_utf8_into_utf16(tail);
        let (string, units) = BunString::create_uninitialized_utf16(len);
        if string.is_dead() {
            bun_alloc::out_of_memory();
        }
        // SAFETY: valid UTF-8 converts to exactly `len` units; `units` is `len` u16s, 2-byte aligned.
        let written = unsafe {
            strings::write_wtf8_as_utf16le(input, first_non_ascii, units.as_mut_ptr().cast::<u8>())
        };
        debug_assert_eq!(written, 2 * len);
        return string;
    }
    // A lone surrogate or an invalid byte: the scalar path decides the length.
    BunString::clone_utf16(&strings::wtf8_to_utf16_alloc(input).expect("non-ASCII input"))
}

impl CachedBytecode {
    // SAFETY CONTRACT: the returned `&'static [u8]` actually borrows from the
    // `CachedBytecode` handle and is invalidated when `deref()` is called. Callers own
    // the handle and must call `deref()` (or drop via `allocator()`) to free.
    pub(crate) fn generate(
        format: Format,
        input: &[u8],
        source_provider_url: &BunString,
        depth: u32,
        optimize: bool,
        external_strings: Option<NonNull<EncoderStringTable>>,
    ) -> Option<(&'static [u8], NonNull<CachedBytecode>)> {
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
        let mut this: Option<NonNull<CachedBytecode>> = None;
        let mut out_size: usize = 0;
        let mut out_ptr: Option<NonNull<u8>> = None;
        // SAFETY: out-params are valid for write; `source` is live for the call.
        let ok = unsafe {
            f(
                source_provider_url,
                &source,
                depth,
                optimize,
                &raw mut out_ptr,
                &raw mut out_size,
                &raw mut this,
                external_strings,
            )
        };
        if !ok {
            return None;
        }
        // SAFETY: on success both out-params are non-null and the slice lives until `deref()`.
        let slice = unsafe { bun_core::ffi::slice(out_ptr.unwrap().as_ptr(), out_size) };
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
    source_provider_url: &BunString,
    depth: u32,
    optimize: bool,
    external_strings: Option<NonNull<EncoderStringTable>>,
) -> Option<Box<[u8]>> {
    crate::initialize(crate::InitializeOptions::default());
    let (bytes, handle) = CachedBytecode::generate(
        format,
        source,
        source_provider_url,
        depth,
        optimize,
        external_strings,
    )?;
    let owned = Box::<[u8]>::from(bytes);
    // `handle` was just produced by C++ and is valid until deref;
    // `CachedBytecode` is an opaque ZST handle so `opaque_mut` is the
    // centralised zero-byte deref proof.
    CachedBytecode__deref(CachedBytecode::opaque_mut(handle.as_ptr()));
    Some(owned)
}

/// A `JSC::BytecodeLinkEncoder` on the calling thread's bytecode VM; every later call must come from the same thread.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_new(
    external_strings: NonNull<EncoderStringTable>,
    hot_functions: &[u64],
    known_functions: &[u64],
    evaluated_modules: &[u64],
    not_evaluated_modules: &[u64],
) -> NonNull<BytecodeLinkEncoder> {
    crate::initialize(crate::InitializeOptions::default());
    // SAFETY: the slices are valid for the call (C++ copies them); `external_strings` is a live table. `new` never returns null.
    unsafe {
        NonNull::new_unchecked(Bun__BytecodeLinkEncoder__create(
            external_strings.as_ptr(),
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

#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_destroy(encoder: NonNull<BytecodeLinkEncoder>) {
    // SAFETY: `encoder` came from `__bun_jsc_bytecode_link_encoder_new` and is not used again.
    unsafe { Bun__BytecodeLinkEncoder__destroy(encoder.as_ptr()) }
}

/// Parses `source` and adds it to the link's payload; false on a parse error. The source text is what `generate` would
/// encode; `names` is what an order file calls its code.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_add_module(
    encoder: NonNull<BytecodeLinkEncoder>,
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
    // SAFETY: `encoder` is live; the strings and the names are live for the call, and C++ reads the names during it only.
    unsafe {
        Bun__BytecodeLinkEncoder__addModule(
            encoder.as_ptr(),
            source_provider_url,
            &source,
            is_module,
            depth,
            optimize,
            names,
        )
    }
}

/// This executable's internal module `id` as a module of the link; false if it does not parse.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_add_internal_module(
    encoder: NonNull<BytecodeLinkEncoder>,
    id: u32,
    depth: u32,
    names: &CodeNamesRef<'_>,
) -> bool {
    // SAFETY: `encoder` is live; the names are live for the call, and C++ reads them during it only.
    unsafe { Bun__BytecodeLinkEncoder__addInternalModule(encoder.as_ptr(), id, depth, names) }
}

/// Same, for an internal module of another bun executable (cross-compiling), as
/// `__bun_jsc_generate_internal_module_bytecode_from_source` takes it.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_add_internal_module_from_source(
    encoder: NonNull<BytecodeLinkEncoder>,
    source: &[u8],
    name: &[u8],
    url: &[u8],
    source_stamp: u32,
    depth: u32,
    names: &CodeNamesRef<'_>,
) -> bool {
    // SAFETY: `encoder` is live; the slices and the names are valid for the duration of the call.
    unsafe {
        Bun__BytecodeLinkEncoder__addInternalModuleFromSource(
            encoder.as_ptr(),
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
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_bytecode_link_encoder_finish(
    encoder: NonNull<BytecodeLinkEncoder>,
    module_count: usize,
) -> Option<bun_bundler::bytecode_order::LinkedPayload> {
    let mut bytes: Option<NonNull<u8>> = None;
    let mut size: usize = 0;
    let mut handle: Option<NonNull<CachedBytecode>> = None;
    let mut entry_offsets = vec![0u32; module_count];
    let mut region_ends = [0u32; bun_resolver::LINKED_BYTECODE_REGION_COUNT];
    let mut named_hot_functions = 0u32;
    let mut placed_hot_functions = 0u32;
    let mut functions_without_name = 0u32;
    // SAFETY: out-params are initialized locals of the sizes C++ expects.
    let ok = unsafe {
        Bun__BytecodeLinkEncoder__finish(
            encoder.as_ptr(),
            &raw mut bytes,
            &raw mut size,
            &raw mut handle,
            entry_offsets.as_mut_ptr(),
            entry_offsets.len(),
            region_ends.as_mut_ptr(),
            &raw mut named_hot_functions,
            &raw mut placed_hot_functions,
            &raw mut functions_without_name,
        )
    };
    let (true, Some(bytes), Some(handle)) = (ok, bytes, handle) else {
        return None;
    };
    // Room for the region ends the bundler appends (`bun_bundler::bytecode_order::payload_file`), so that the payload
    // is copied once.
    let mut payload = Vec::with_capacity(size + size_of_val(&region_ends));
    // SAFETY: `bytes[..size]` is the CachedBytecode's payload, valid until the deref below.
    payload.extend_from_slice(unsafe { core::slice::from_raw_parts(bytes.as_ptr(), size) });
    CachedBytecode__deref(CachedBytecode::opaque_mut(handle.as_ptr()));
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
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_destroy_bytecode_cache_vm() {
    unsafe extern "C" {
        safe fn Bun__destroyBytecodeCacheVM();
    }
    Bun__destroyBytecodeCacheVM()
}

/// Serialize the shared string table into an owned buffer for the standalone graph, then free the table.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_encoder_string_table_take(
    table: NonNull<EncoderStringTable>,
    hot_strings: &[u64],
) -> Box<[u8]> {
    let bytes = EncoderStringTable::serialize(table, hot_strings).into_boxed_slice();
    EncoderStringTable::destroy(table);
    bytes
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_encoder_string_table_slot(
    table: NonNull<EncoderStringTable>,
    wtf8: &[u8],
) -> u32 {
    EncoderStringTable::slot_for_wtf8(table, wtf8)
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
    EncoderStringTable::new()
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

fn take_bytecode(
    ok: bool,
    bytes: Option<NonNull<u8>>,
    size: usize,
    handle: Option<NonNull<CachedBytecode>>,
) -> Option<Box<[u8]>> {
    let (true, Some(bytes), Some(handle)) = (ok, bytes, handle) else {
        return None;
    };
    // SAFETY: `bytes[..size]` is the CachedBytecode's payload, valid until the deref below.
    let owned = Box::<[u8]>::from(unsafe { core::slice::from_raw_parts(bytes.as_ptr(), size) });
    CachedBytecode__deref(CachedBytecode::opaque_mut(handle.as_ptr()));
    Some(owned)
}

/// `bun build --compile --bytecode`: bytecode for this executable's internal module `id` (an InternalModuleRegistry
/// field index), generated the way InternalModuleRegistry consumes it. `depth` bounds nested-function code blocks
/// (`u32::MAX` = all of them; 0 = just the module wrapper's own).
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_generate_internal_module_bytecode(
    id: u32,
    depth: u32,
    external_strings: Option<NonNull<EncoderStringTable>>,
) -> Option<Box<[u8]>> {
    crate::initialize(crate::InitializeOptions::default());
    let mut bytes: Option<NonNull<u8>> = None;
    let mut size: usize = 0;
    let mut handle: Option<NonNull<CachedBytecode>> = None;
    // SAFETY: out-params are initialized locals; C++ fills them on success.
    let ok = unsafe {
        Bun__generateInternalModuleBytecode(
            id,
            depth,
            &raw mut bytes,
            &raw mut size,
            &raw mut handle,
            external_strings,
        )
    };
    take_bytecode(ok, bytes, size, handle)
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
    external_strings: Option<NonNull<EncoderStringTable>>,
) -> Option<Box<[u8]>> {
    crate::initialize(crate::InitializeOptions::default());
    let mut bytes: Option<NonNull<u8>> = None;
    let mut size: usize = 0;
    let mut handle: Option<NonNull<CachedBytecode>> = None;
    // SAFETY: the three slices are valid for their lengths for the duration of the call; out-params as above.
    let ok = unsafe {
        Bun__generateInternalModuleBytecodeFromSource(
            source.as_ptr(),
            source.len(),
            name.as_ptr(),
            name.len(),
            url.as_ptr(),
            url.len(),
            source_stamp,
            depth,
            &raw mut bytes,
            &raw mut size,
            &raw mut handle,
            external_strings,
        )
    };
    take_bytecode(ok, bytes, size, handle)
}
