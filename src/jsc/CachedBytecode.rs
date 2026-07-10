use core::ptr::NonNull;

use bun_core::String as BunString;
use bun_options_types::Format;

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`CachedBytecode`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `JSC::CachedBytecode`, a `WTF::RefCounted`. `&Self` is ABI-identical
        /// to a non-null `JSC::CachedBytecode*` and carries no
        /// `noalias`/`readonly` — C++ mutates the refcount through it.
        pub struct CachedBytecode;
    }
}

// `JSC::encodeCodeBlock` allocates and the C++ generator does an explicit
// `->ref()` before leaking the pointer through the out-param, so Rust receives
// a `+1`. One `CachedBytecode` handle owns exactly that one ref.
bun_opaque::foreign_owned!(sys::CachedBytecode, CachedBytecode__deref);

/// Owned handle to a C++ `JSC::CachedBytecode`.
///
/// Holds one ref on the WTF intrusive refcount; `Drop` gives it back, freeing
/// the bytecode buffer at zero. There is no `&mut self` and no `DerefMut`: a
/// refcount is shared by definition, and a decrement is not exclusive access.
#[repr(transparent)]
pub struct CachedBytecode(bun_opaque::ForeignRef<sys::CachedBytecode>);

unsafe extern "C" {
    fn generateCachedModuleByteCodeFromSourceCode(
        source_provider_url: *mut BunString,
        input_code: *const u8,
        input_source_code_size: usize,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<sys::CachedBytecode>>,
    ) -> bool;

    fn generateCachedCommonJSProgramByteCodeFromSourceCode(
        source_provider_url: *mut BunString,
        input_code: *const u8,
        input_source_code_size: usize,
        output_byte_code: *mut Option<NonNull<u8>>,
        output_byte_code_size: *mut usize,
        cached_bytecode: *mut Option<NonNull<sys::CachedBytecode>>,
    ) -> bool;

    // safe: C++ takes `CachedBytecode*` and calls the intrusive `->deref()`. A
    // refcount decrement is not exclusive access — other refs exist by
    // definition — so the receiver is `&`, not `&mut`.
    safe fn CachedBytecode__deref(this: &sys::CachedBytecode);
}

/// Ownership plumbing.
impl CachedBytecode {
    /// Adopt a `+1` returned by C++.
    ///
    /// # Safety
    /// `ptr` must carry exactly one ref that no other handle will release.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<sys::CachedBytecode>) -> Self {
        // SAFETY: caller transfers the +1.
        Self(unsafe { bun_opaque::ForeignRef::adopt(ptr) })
    }

    /// Adopt a nullable `+1`; `None` on null.
    #[inline]
    fn adopt_ptr(ptr: Option<NonNull<sys::CachedBytecode>>) -> Option<Self> {
        // SAFETY: the C++ generators `->ref()` before writing the out-param.
        ptr.map(|p| unsafe { Self::adopt(p) })
    }

    /// The C++ pointer, still owned by `self`.
    #[inline]
    pub fn as_ptr(&self) -> *mut sys::CachedBytecode {
        self.0.as_ptr()
    }

    /// Hand our `+1` to a foreign owner. Pairs with a later [`Self::adopt`].
    #[inline]
    pub fn leak(self) -> NonNull<sys::CachedBytecode> {
        self.0.leak()
    }
}

/// Bytecode generation. Each successful call returns the `+1` C++ handed us.
impl CachedBytecode {
    // SAFETY CONTRACT: the returned `&'static [u8]` actually borrows from the
    // `CachedBytecode` handle and is invalidated when that handle is dropped.
    // Callers must keep it alive for as long as they read the slice.
    pub fn generate_for_esm(
        source_provider_url: &mut BunString,
        input: &[u8],
    ) -> Option<(&'static [u8], Self)> {
        let mut this: Option<NonNull<sys::CachedBytecode>> = None;

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
            // and the slice is valid for `input_code_size` bytes until release.
            let slice =
                unsafe { bun_core::ffi::slice(input_code_ptr.unwrap().as_ptr(), input_code_size) };
            let handle = Self::adopt_ptr(this).expect("bytecode generated but handle is null");
            return Some((slice, handle));
        }

        None
    }

    pub fn generate_for_cjs(
        source_provider_url: &mut BunString,
        input: &[u8],
    ) -> Option<(&'static [u8], Self)> {
        let mut this: Option<NonNull<sys::CachedBytecode>> = None;
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
            // and the slice is valid for `input_code_size` bytes until release.
            let slice =
                unsafe { bun_core::ffi::slice(input_code_ptr.unwrap().as_ptr(), input_code_size) };
            let handle = Self::adopt_ptr(this).expect("bytecode generated but handle is null");
            return Some((slice, handle));
        }

        None
    }

    pub fn generate(
        format: Format,
        input: &[u8],
        source_provider_url: &mut BunString,
    ) -> Option<(&'static [u8], Self)> {
        match format {
            Format::Esm => Self::generate_for_esm(source_provider_url, input),
            Format::Cjs => Self::generate_for_cjs(source_provider_url, input),
            _ => None,
        }
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
    // `bytes` borrows the C++ buffer; the copy above is done, so give the ref
    // back. Dropping `handle` is the release.
    drop(handle);
    Some(owned)
}
