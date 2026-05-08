use core::ffi::c_void;

use bun_string::String as BunString;

use crate::JSValue;
// `@import("ResolvedSourceTag")` is a build-system module (codegen → ResolvedSourceTag.zig).
// The Rust mirror lives inline in `crate::resolved_source_tag` so it can be kept in
// lock-step with the C `uint32_t tag` field in src/jsc/bindings/headers-handwritten.h.
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

    /// When .tag is .common_js_custom_extension, this is special-cased to hold
    /// the JSFunction extension. It is kept alive by
    /// - This structure is stored on the stack
    /// - There is a JSC::Strong reference to it
    // PORT NOTE: bare JSValue field is sound here — ResolvedSource is #[repr(C)] and lives
    // on the stack while crossing to C++ (see comment above + headers-handwritten.h).
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
    /// The file path used as the source origin for bytecode cache validation.
    /// JSC validates bytecode by checking if the origin URL matches exactly what
    /// was used at build time. If empty, the origin is derived from source_url.
    /// This is converted to a file:// URL on the C++ side.
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

// ported from: src/jsc/ResolvedSource.zig
