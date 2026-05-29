use core::ffi::c_void;

use bun_core::String as BunString;

use crate::JSValue;
// The tag type lives in `crate::resolved_source_tag` so it can be kept in lock-step with
// the C `uint32_t tag` field in src/jsc/bindings/headers-handwritten.h; the builtin-module
// half of the table is code-generated (see `generated_resolved_source_tag.rs`).
pub use crate::resolved_source_tag::ResolvedSourceTag as Tag;

// PORT NOTE: `Copy` is required by `Errorable<T: Copy>` (the `#[repr(C)]`
// tagged-union it travels through to C++). All fields are POD; `bun.String` is
// a tagged pointer pair and is `Copy` in the Rust port too.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ResolvedSource {
    /// Specifier's lifetime is the caller from C++
    /// https://github.com/oven-sh/bun/issues/9521
    pub specifier: BunString,
    pub source_code: BunString,

    /// source_url is eventually deref'd on success
    pub source_url: BunString,

    pub is_commonjs_module: bool,

    pub cjs_custom_extension_index: JSValue,

    pub allocator: *mut c_void,

    pub jsvalue_for_export: JSValue,

    pub tag: Tag,

    /// This is for source_code
    pub source_code_needs_deref: bool,
    pub already_bundled: bool,

    // -- Bytecode cache fields --
    pub bytecode_cache: *mut u8,
    pub bytecode_cache_size: usize,
    pub module_info: *mut c_void,
    pub bytecode_origin_path: BunString,
}

impl Default for ResolvedSource {
    fn default() -> Self {
        Self {
            specifier: BunString::empty(),
            source_code: BunString::empty(),
            source_url: BunString::empty(),
            is_commonjs_module: false,
            cjs_custom_extension_index: JSValue::ZERO,
            allocator: core::ptr::null_mut(),
            jsvalue_for_export: JSValue::ZERO,
            tag: Tag::Javascript,
            source_code_needs_deref: true,
            already_bundled: false,
            bytecode_cache: core::ptr::null_mut(),
            bytecode_cache_size: 0,
            module_info: core::ptr::null_mut(),
            bytecode_origin_path: BunString::empty(),
        }
    }
}

#[repr(transparent)]
#[derive(Default)]
pub struct OwnedResolvedSource(ResolvedSource);

/// Adopt a freshly-constructed `ResolvedSource`. The caller transfers the
/// +1 on every `BunString` field to this owner.
impl From<ResolvedSource> for OwnedResolvedSource {
    #[inline]
    fn from(rs: ResolvedSource) -> Self {
        Self(rs)
    }
}

impl OwnedResolvedSource {
    #[inline]
    pub fn into_ffi(self) -> ResolvedSource {
        core::mem::ManuallyDrop::new(self).0
    }

    /// Borrow the inner value for in-place mutation while keeping RAII
    /// ownership. Used for the `source_url`/`specifier` late-fill in
    /// `RuntimeTranspilerStore::run_from_js_thread`.
    #[inline]
    pub fn as_mut(&mut self) -> &mut ResolvedSource {
        &mut self.0
    }

    #[inline]
    pub fn get(&self) -> &ResolvedSource {
        &self.0
    }
}

impl Drop for OwnedResolvedSource {
    #[inline]
    fn drop(&mut self) {
        // `source_code_needs_deref` mirrors the C++ consumer's gate (when
        // `false`, the source_code is a borrowed/static slice the consumer
        // must not deref either).
        if self.0.source_code_needs_deref {
            self.0.source_code.deref();
        }
        self.0.specifier.deref();
        self.0.source_url.deref();
        self.0.bytecode_origin_path.deref();
    }
}

// ported from: src/jsc/ResolvedSource.zig
