use core::ffi::c_void;

use bun_bundler::transpiler::AlreadyBundled;
use bun_core::String as BunString;
use bun_sys::MappedFile;

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
    /// The `Box<MappedFile>` owning the bytes behind `bytecode_cache` when they
    /// come from a `.jsc` sidecar; destroyed (`Bun__MappedFile__destroy`) by
    /// whoever discards this struct last: the `JSC::CachedBytecode` a
    /// `SourceProvider` wraps them in, C++'s `ResolvedSourceCodeHolder` when no
    /// provider is created, or [`OwnedResolvedSource`] when the struct never
    /// reaches C++. Null when the bytes are borrowed for the life of the
    /// process (a standalone executable's embedded bytecode, the Node compile
    /// cache).
    pub bytecode_cache_file: *mut c_void,
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
            bytecode_cache_file: core::ptr::null_mut(),
            module_info: core::ptr::null_mut(),
            bytecode_origin_path: BunString::empty(),
        }
    }
}

impl ResolvedSource {
    /// The fields a module the parser found pre-bundled (`// @bun`, with or
    /// without `@bytecode`) contributes, or `None` for an ordinary module; the
    /// caller adds the specifier, URL and tag. `source_text` is the text the
    /// parser read. It is copied into the WTF string unless the module came
    /// with bytecode and its text was mapped, in which case the string reads
    /// the mapping in place.
    pub fn from_already_bundled(
        already_bundled: AlreadyBundled,
        source_text: &[u8],
    ) -> Option<Self> {
        let mut out = Self {
            already_bundled: true,
            is_commonjs_module: already_bundled.is_common_js(),
            ..Default::default()
        };
        let files = match already_bundled {
            AlreadyBundled::None => return None,
            AlreadyBundled::SourceCode | AlreadyBundled::SourceCodeCjs => {
                out.source_code = BunString::clone_latin1(source_text);
                return Some(out);
            }
            AlreadyBundled::Bytecode(files) | AlreadyBundled::BytecodeCjs(files) => files,
        };
        out.source_code = files
            .source
            .and_then(mapped_source_text)
            .unwrap_or_else(|| BunString::clone_latin1(source_text));
        let bytecode = bun_core::heap::into_raw(Box::new(files.bytecode));
        // SAFETY: `bytecode` was just produced by `into_raw`; it is destroyed
        // only through `bytecode_cache_file` (see the field doc), long after
        // this borrow ends.
        let bytes = unsafe { &*bytecode }.as_slice();
        debug_assert!(!bytes.is_empty());
        out.bytecode_cache = bytes.as_ptr().cast_mut();
        out.bytecode_cache_size = bytes.len();
        out.bytecode_cache_file = bytecode.cast::<c_void>();
        Some(out)
    }
}

/// A WTF string reading the mapped module text in place; the mapping is
/// destroyed together with the string. `None` (dropping the mapping) when the
/// text is longer than a WTF string can hold.
fn mapped_source_text(text: MappedFile) -> Option<BunString> {
    if text.as_slice().len() > BunString::max_length() {
        return None;
    }
    let file = bun_core::heap::into_raw(Box::new(text));
    // SAFETY: `file` was just produced by `into_raw`; the only thing that frees
    // it is the destruction of the string created below, after this borrow ends.
    let bytes = unsafe { &*file }.as_slice();
    Some(BunString::create_external(
        bytes,
        true,
        file,
        destroy_mapped_source_text,
    ))
}

/// `WTF::ExternalStringImpl` free function for [`mapped_source_text`].
extern "C" fn destroy_mapped_source_text(file: *mut MappedFile, _bytes: *mut c_void, _len: usize) {
    // SAFETY: `file` is the `into_raw` pointer `mapped_source_text` registered,
    // and WTF calls the free function exactly once, when the impl is destroyed.
    unsafe { bun_core::heap::destroy(file) };
}

/// Destroys a [`ResolvedSource::bytecode_cache_file`]. C++ calls this from the
/// `JSC::CachedBytecode` destructor and from `ResolvedSourceCodeHolder`
/// (ModuleLoader.cpp) for a `ResolvedSource` discarded before a provider took
/// the bytecode.
///
/// # Safety
/// `file` must be a `bytecode_cache_file` produced by
/// [`ResolvedSource::from_already_bundled`] that nothing else will destroy; the
/// bytes behind `bytecode_cache` are invalid once this returns.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__MappedFile__destroy(file: *mut c_void) {
    // SAFETY: per the contract above.
    unsafe { bun_core::heap::destroy(file.cast::<MappedFile>()) };
}

// ──────────────────────────────────────────────────────────────────────────
// RAII owner for the +1 `BunString` refs (and the mapped bytecode file) inside
// a `ResolvedSource`.
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
// owner is dropped instead, every contained `BunString` is `deref()`d and the
// `bytecode_cache_file` is destroyed.
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
    pub(crate) fn as_mut(&mut self) -> &mut ResolvedSource {
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
        if !self.0.bytecode_cache_file.is_null() {
            // SAFETY: `from_already_bundled` stored this `into_raw` pointer, and
            // C++ never saw it: handing the value over goes through `into_ffi`,
            // which skips this `Drop`.
            unsafe { bun_core::heap::destroy(self.0.bytecode_cache_file.cast::<MappedFile>()) };
        }
    }
}
