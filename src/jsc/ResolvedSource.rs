use core::ffi::c_void;

use bun_core::String as BunString;

use crate::JSValue;
// The tag type lives in `crate::resolved_source_tag` so it can be kept in lock-step with
// the C `uint32_t tag` field in src/jsc/bindings/headers-handwritten.h; the builtin-module
// half of the table is code-generated (see `generated_resolved_source_tag.rs`).
pub use crate::resolved_source_tag::ResolvedSourceTag as Tag;

// `Copy` is required by `Errorable<T: Copy>` (the `#[repr(C)]` tagged-union it
// travels through to C++). All fields are POD; `BunString` is a tagged pointer
// pair and is `Copy`.
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
    // The bare JSValue field is sound here — ResolvedSource is #[repr(C)] and lives
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
    /// Statically-detected CommonJS export names (`is_commonjs_module` only).
    /// Backing allocation is a leaked `Box<[BunString]>`; C++ calls
    /// `Bun__freeCjsExportNames` to release both the strings and the slice.
    pub cjs_export_names: *mut BunString,
    pub cjs_export_names_len: usize,
    /// Re-export specifiers (same ownership protocol as `cjs_export_names`).
    pub cjs_reexport_specifiers: *mut BunString,
    pub cjs_reexport_specifiers_len: usize,
    /// Named exports cannot be statically enumerated; the synthetic-provider
    /// path applies so the CJS body runs at makeModule() for full enumeration.
    pub cjs_exports_dynamic: bool,
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
            cjs_export_names: core::ptr::null_mut(),
            cjs_export_names_len: 0,
            cjs_reexport_specifiers: core::ptr::null_mut(),
            cjs_reexport_specifiers_len: 0,
            cjs_exports_dynamic: false,
        }
    }
}

/// Leak a list of export names as a `Box<[BunString]>` for the C++ side. The
/// strings are fresh `WTFStringImpl` copies (`clone_utf8`) so they outlive the
/// parse arena. Paired with `Bun__freeCjsExportNames`.
pub fn leak_cjs_export_names<'a, I>(names: I) -> (*mut BunString, usize)
where
    I: IntoIterator<Item = &'a [u8]>,
{
    let vec: Vec<BunString> = names.into_iter().map(BunString::clone_utf8).collect();
    if vec.is_empty() {
        return (core::ptr::null_mut(), 0);
    }
    let boxed = vec.into_boxed_slice();
    let len = boxed.len();
    let ptr = Box::into_raw(boxed).cast::<BunString>();
    (ptr, len)
}

/// Release the allocation produced by `leak_cjs_export_names`. Safe to call
/// with `(null, 0)`.
///
/// # Safety
/// `ptr`/`len` must be exactly a `(ptr, len)` pair previously returned by
/// `leak_cjs_export_names` (or null). Called at most once per allocation.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__freeCjsExportNames(ptr: *mut BunString, len: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: per fn contract — `ptr` is the `Box<[BunString]>::into_raw`
    // result from `leak_cjs_export_names` with matching `len`.
    let boxed: Box<[BunString]> =
        unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(ptr, len)) };
    for s in boxed.iter() {
        s.deref();
    }
    drop(boxed);
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

/// Adopt a freshly-constructed `ResolvedSource`. The caller transfers the
/// +1 on every `BunString` field to this owner.
impl From<ResolvedSource> for OwnedResolvedSource {
    #[inline]
    fn from(rs: ResolvedSource) -> Self {
        Self(rs)
    }
}

impl OwnedResolvedSource {
    /// Hand the raw value to C++ (which takes over the `deref()` obligation
    /// per `headers-handwritten.h` `BunString::deref` callers in
    /// `Zig::ResolvedSource` consumers). After this, Rust must not touch the
    /// strings.
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
        // SAFETY: `cjs_export_names` was produced by `leak_cjs_export_names`
        // (or is null); ownership stays with us on the Rust-drop path.
        unsafe { Bun__freeCjsExportNames(self.0.cjs_export_names, self.0.cjs_export_names_len) };
        self.0.cjs_export_names = core::ptr::null_mut();
        // SAFETY: same protocol as `cjs_export_names`.
        unsafe {
            Bun__freeCjsExportNames(
                self.0.cjs_reexport_specifiers,
                self.0.cjs_reexport_specifiers_len,
            )
        };
        self.0.cjs_reexport_specifiers = core::ptr::null_mut();
    }
}
