use core::ptr::NonNull;

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
    pub fn serialize(this: NonNull<EncoderStringTable>) -> Vec<u8> {
        let mut out = Vec::<u8>::new();
        unsafe extern "C" fn append(ctx: *mut core::ffi::c_void, bytes: *const u8, len: usize) {
            // SAFETY: `ctx` is `&mut Vec<u8>`; `bytes` valid for `len`.
            unsafe {
                (*ctx.cast::<Vec<u8>>()).extend_from_slice(core::slice::from_raw_parts(bytes, len))
            };
        }
        // SAFETY: `this` is a valid table; callback receives our `&mut out`.
        unsafe { Bun__EncoderStringTable__serialize(this.as_ptr(), (&raw mut out).cast(), append) };
        out
    }
    pub fn destroy(this: NonNull<EncoderStringTable>) {
        // SAFETY: `this` was produced by `new`.
        unsafe { Bun__EncoderStringTable__destroy(this.as_ptr()) };
    }
}

unsafe extern "C" {
    fn Bun__EncoderStringTable__create() -> *mut EncoderStringTable;
    fn Bun__EncoderStringTable__destroy(this: *mut EncoderStringTable);
    fn Bun__EncoderStringTable__serialize(
        this: *mut EncoderStringTable,
        ctx: *mut core::ffi::c_void,
        append: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize),
    );

    fn generateCachedModuleByteCodeFromSourceCode(
        source_provider_url: &BunString,
        input_code: *const u8,
        input_source_code_size: usize,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
        external_strings: Option<NonNull<EncoderStringTable>>,
    ) -> bool;

    fn generateCachedCommonJSProgramByteCodeFromSourceCode(
        source_provider_url: &BunString,
        input_code: *const u8,
        input_source_code_size: usize,
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
    /// InternalModuleRegistry.cpp: the internal JS modules `id` statically requires.
    fn Bun__internalModuleDependencies(id: u32, out: *mut *const u16) -> usize;
}

impl CachedBytecode {
    // SAFETY CONTRACT: the returned `&'static [u8]` actually borrows from the
    // `CachedBytecode` handle and is invalidated when `deref()` is called. Callers own
    // the handle and must call `deref()` (or drop via `allocator()`) to free.
    pub(crate) fn generate(
        format: Format,
        input: &[u8],
        source_provider_url: &BunString,
        external_strings: Option<NonNull<EncoderStringTable>>,
    ) -> Option<(&'static [u8], NonNull<CachedBytecode>)> {
        let f = match format {
            Format::Esm => generateCachedModuleByteCodeFromSourceCode,
            Format::Cjs => generateCachedCommonJSProgramByteCodeFromSourceCode,
            _ => return None,
        };
        let mut this: Option<NonNull<CachedBytecode>> = None;
        let mut out_size: usize = 0;
        let mut out_ptr: Option<NonNull<u8>> = None;
        // SAFETY: out-params are valid for write; input slice valid for read.
        let ok = unsafe {
            f(
                source_provider_url,
                input.as_ptr(),
                input.len(),
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
    external_strings: Option<NonNull<EncoderStringTable>>,
) -> Option<Box<[u8]>> {
    crate::virtual_machine::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.set(true);
    crate::initialize(crate::InitializeOptions::default());
    let (bytes, handle) =
        CachedBytecode::generate(format, source, source_provider_url, external_strings)?;
    let owned = Box::<[u8]>::from(bytes);
    // `handle` was just produced by C++ and is valid until deref;
    // `CachedBytecode` is an opaque ZST handle so `opaque_mut` is the
    // centralised zero-byte deref proof.
    CachedBytecode__deref(CachedBytecode::opaque_mut(handle.as_ptr()));
    Some(owned)
}

/// Serialize the shared string table into an owned buffer for the standalone graph, then free the table.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_encoder_string_table_take(table: NonNull<EncoderStringTable>) -> Box<[u8]> {
    let bytes = EncoderStringTable::serialize(table).into_boxed_slice();
    EncoderStringTable::destroy(table);
    bytes
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_encoder_string_table_new() -> NonNull<EncoderStringTable> {
    crate::virtual_machine::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.set(true);
    crate::initialize(crate::InitializeOptions::default());
    EncoderStringTable::new()
}

/// `bun build --compile --bytecode`: for the builtin module specifiers a bundle imports (e.g. `b"node:fs"`), the
/// InternalModuleRegistry ids of those modules and everything they eagerly require, each with bytecode generated the
/// way InternalModuleRegistry::generateModule consumes it. Specifiers that are not JS internal modules are skipped.
/// `depth` bounds nested-function code blocks (`u32::MAX` = all of them; 0 = just each module wrapper's own).
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_generate_internal_module_bytecode(
    specifiers: &[&[u8]],
    depth: u32,
    external_strings: Option<NonNull<EncoderStringTable>>,
) -> Vec<(u32, Box<[u8]>)> {
    crate::virtual_machine::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.set(true);
    crate::initialize(crate::InitializeOptions::default());

    let mut wanted: Vec<u32> = Vec::new();
    let push = |id: u32, wanted: &mut Vec<u32>| {
        if !wanted.contains(&id) {
            wanted.push(id);
        }
    };
    for specifier in specifiers {
        let alias =
            bun_resolve_builtins::Alias::get(specifier, bun_ast::Target::Bun, Default::default());
        let canonical: &[u8] = match &alias {
            Some(alias) => alias.path.as_bytes(),
            None => specifier,
        };
        if let Some(tag) = crate::ResolvedSourceTag::try_from_name(canonical) {
            if tag.0 >= crate::ResolvedSourceTag::INTERNAL_MODULE_REGISTRY_FLAG {
                push(
                    tag.0 - crate::ResolvedSourceTag::INTERNAL_MODULE_REGISTRY_FLAG,
                    &mut wanted,
                );
            }
        }
    }
    // Transitive static requires, breadth-first.
    let mut i = 0;
    while i < wanted.len() {
        let mut deps: *const u16 = core::ptr::null();
        // SAFETY: C++ returns a pointer into a static table and its length.
        let count = unsafe { Bun__internalModuleDependencies(wanted[i], &raw mut deps) };
        for k in 0..count {
            // SAFETY: k < count.
            let dep = unsafe { *deps.add(k) } as u32;
            push(dep, &mut wanted);
        }
        i += 1;
    }

    let mut out = Vec::with_capacity(wanted.len());
    for id in wanted {
        let mut bytes: Option<NonNull<u8>> = None;
        let mut size: usize = 0;
        let mut handle: Option<NonNull<CachedBytecode>> = None;
        // SAFETY: out-params are initialized locals; C++ fills them on success.
        if !unsafe {
            Bun__generateInternalModuleBytecode(
                id,
                depth,
                &raw mut bytes,
                &raw mut size,
                &raw mut handle,
                external_strings,
            )
        } {
            continue;
        }
        let (Some(bytes), Some(handle)) = (bytes, handle) else {
            continue;
        };
        // SAFETY: `bytes[..size]` is the CachedBytecode's payload, valid until the deref below.
        let owned = Box::<[u8]>::from(unsafe { core::slice::from_raw_parts(bytes.as_ptr(), size) });
        CachedBytecode__deref(CachedBytecode::opaque_mut(handle.as_ptr()));
        out.push((id, owned));
    }
    out
}
