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

    /// Defined in `BuiltinModuleBytecode.cpp`. Compiles one JS builtin (and every
    /// function nested inside it) and serializes the whole tree.
    fn Bun__generateBuiltinModuleBytecode(
        module_id: u32,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<CachedBytecode>>,
    ) -> bool;

    /// The builtins `module_id` requires directly, as a view into a static table.
    fn Bun__builtinModuleDependencies(
        module_id: u32,
        output_ids: *mut *const u32,
        output_len: *mut usize,
    );

    // safe: `CachedBytecode` is an `opaque_ffi!` ZST handle (`!Freeze` via
    // `UnsafeCell`); `&mut` is ABI-identical to a non-null `*mut` and the C++
    // refcount decrement is interior to the cell.
    safe fn CachedBytecode__deref(this: &mut CachedBytecode);
}

impl CachedBytecode {
    // SAFETY CONTRACT: the returned `&'static [u8]` actually borrows from the
    // `CachedBytecode` handle and is invalidated when `deref()` is called. Callers own
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
// The `bun_alloc::Allocator` marker trait has no
// `alloc`/`free` methods to dispatch through — so "free → deref" semantics
// cannot ride the trait object. Call sites that would have freed through this
// allocator must instead call `deref()` on the `NonNull<CachedBytecode>` handle
// directly. `is_instance` is preserved for the vtable-identity check in
// `bun_safety::alloc::has_ptr`.
// ──────────────────────────────────────────────────────────────────────────

impl bun_alloc::Allocator for CachedBytecode {}

impl CachedBytecode {
    /// Concrete-type identity check via the `Allocator::type_id()` hook.
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
pub(crate) fn __bun_jsc_generate_cached_bytecode(
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

/// Link-time entry point for `bun_bundler`. Same thread setup as
/// [`__bun_jsc_generate_cached_bytecode`], but for one JS builtin: `module_id` indexes
/// `InternalModuleRegistry`, and the returned blob covers that builtin's top-level
/// function plus every function nested inside it.
///
/// Returns `None` for native modules, out-of-range ids, and any module whose source
/// fails to compile, which leaves the builtin to be parsed at runtime as usual.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_generate_builtin_module_bytecode(module_id: u32) -> Option<Box<[u8]>> {
    crate::virtual_machine::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE.set(true);
    crate::initialize(false);

    let mut handle: Option<NonNull<CachedBytecode>> = None;
    let mut size: usize = 0;
    let mut ptr: Option<NonNull<u8>> = None;
    // SAFETY: out-params are valid for write.
    let ok = unsafe {
        Bun__generateBuiltinModuleBytecode(module_id, &raw mut ptr, &raw mut size, &raw mut handle)
    };
    if !ok {
        return None;
    }

    // SAFETY: on success C++ guarantees both out-params are non-null and the bytes stay
    // valid until the handle is deref'd.
    let bytes = unsafe { bun_core::ffi::slice(ptr.unwrap().as_ptr(), size) };
    let owned = Box::<[u8]>::from(bytes);
    CachedBytecode__deref(CachedBytecode::opaque_mut(handle.unwrap().as_ptr()));
    Some(owned)
}

/// Link-time entry point for `bun_bundler`. The `InternalModuleRegistry` id behind a
/// canonical builtin specifier (`b"node:net"`), or `None` if it isn't a builtin.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_builtin_module_id_for_specifier(specifier: &[u8]) -> Option<u32> {
    crate::ResolvedSourceTag::try_from_name(specifier)
        .and_then(crate::ResolvedSourceTag::internal_module_id)
}

/// Link-time entry point for `bun_bundler`. The builtins `module_id` requires directly.
///
/// These edges are `@createInternalModuleById(N)` calls the builtin bundler emits for each
/// `require()` between builtins. They resolve at runtime through `InternalModuleRegistry`,
/// so they are invisible to the JS bundler — the bytecode cache has to walk them itself.
#[unsafe(no_mangle)]
pub(crate) fn __bun_jsc_builtin_module_dependencies(module_id: u32) -> &'static [u32] {
    let mut ids: *const u32 = core::ptr::null();
    let mut len: usize = 0;
    // SAFETY: out-params are valid for write.
    unsafe { Bun__builtinModuleDependencies(module_id, &raw mut ids, &raw mut len) };
    if ids.is_null() || len == 0 {
        return &[];
    }
    // SAFETY: C++ hands back a view into a `static constexpr` table.
    unsafe { core::slice::from_raw_parts(ids, len) }
}
