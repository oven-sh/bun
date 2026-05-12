use core::ffi::c_void;

use bun_core::String as BunString;

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

// ──────────────────────────────────────────────────────────────────────────
// RAII owner for the +1 `BunString` refs inside a `ResolvedSource`.
//
// `ResolvedSource` itself MUST stay `#[repr(C), Copy]` (it crosses to C++ by
// value through `Errorable<ResolvedSource>`), so it cannot have `Drop`. That
// makes every Rust-side construction a leak hazard: `source_code` is a fresh
// `String::clone_utf8/clone_latin1` (+1 WTF refcount holding the entire
// transpiled module text — kilobytes-to-megabytes), and any error path or
// early return between construction and `into_ffi()` would orphan it.
//
// Hold the in-flight value as `OwnedResolvedSource`; the only way to extract
// the raw `ResolvedSource` for FFI is `into_ffi()` (consumes, forgets). If the
// owner is dropped instead, every contained `BunString` is `deref()`d.
//
// The `module_info` pointer (a `Box<ModuleInfoDeserialized>` leaked via
// `heap::into_raw`) is intentionally NOT freed here — its ownership protocol
// is separate (C++ calls `Bun__free_module_info` on success; on Rust-side drop
// it would still leak today, tracked separately).
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
#[derive(Default)]
pub struct OwnedResolvedSource(ResolvedSource);

impl OwnedResolvedSource {
    /// Adopt a freshly-constructed `ResolvedSource`. The caller transfers the
    /// +1 on every `BunString` field to this owner.
    #[inline]
    pub const fn new(rs: ResolvedSource) -> Self {
        Self(rs)
    }

    /// Hand the raw value to C++ (which takes over the `deref()` obligation
    /// per `headers-handwritten.h` `BunString::deref` callers in
    /// `Zig::ResolvedSource` consumers). After this, Rust must not touch the
    /// strings.
    #[inline]
    pub fn into_ffi(self) -> ResolvedSource {
        let rs = self.0;
        core::mem::forget(self);
        rs
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
