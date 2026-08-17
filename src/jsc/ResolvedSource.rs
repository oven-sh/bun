use core::ffi::c_void;

use bun_bundler::analyze_transpiled_module::ModuleInfoDeserialized;
use bun_bundler::transpiler::AlreadyBundled;
use bun_core::String as BunString;
use bun_sys::MappedFile;

use crate::JSValue;
// The tag type lives in `crate::resolved_source_tag` so it can be kept in lock-step with
// the C `uint32_t tag` field in src/jsc/bindings/headers-handwritten.h; the builtin-module
// half of the table is code-generated (see `generated_resolved_source_tag.rs`).
pub use crate::resolved_source_tag::ResolvedSourceTag as Tag;

/// C++ `ResolvedSource` (headers-handwritten.h). Every string field is owned
/// by whichever frame holds the struct: dropped here on the Rust side, or by
/// `~ErrorableResolvedSource` once written into a C++ out-param. Consumers
/// (`Zig::SourceProvider::create`) take the fields they keep by transfer.
#[repr(C)]
#[derive(Default)]
pub struct ResolvedSource {
    pub source_code: BunString,
    pub source_url: BunString,

    pub is_commonjs_module: bool,
    /// `bun build --compile`: `StringImpl::hash()` of `source_code`, computed at build time (0 = not known).
    pub source_code_hash: u32,

    /// When .tag is .common_js_custom_extension, this is special-cased to hold
    /// the JSFunction extension. It is kept alive by
    /// - This structure is stored on the stack
    /// - There is a JSC::Strong reference to it
    pub cjs_custom_extension_index: JSValue,

    pub jsvalue_for_export: JSValue,

    pub tag: Tag,

    pub already_bundled: bool,

    pub bytecode_cache: Bytecode,
    /// `Zig::SourceProvider` takes it (nulling the field).
    pub module_info: Option<Box<ModuleInfoDeserialized>>,
    /// The file path used as the source origin for bytecode cache validation.
    /// JSC validates bytecode by checking if the origin URL matches exactly what
    /// was used at build time. If empty, the origin is derived from source_url.
    /// This is converted to a file:// URL on the C++ side.
    pub bytecode_origin_path: BunString,
}

impl ResolvedSource {
    /// The fields of a `// @bun` module (the caller adds the URL and tag), or
    /// `None` for an ordinary one. `source_text` is copied unless the module
    /// text was mapped along with its bytecode.
    pub fn from_already_bundled(
        already_bundled: AlreadyBundled,
        source_text: &[u8],
    ) -> Option<Self> {
        if matches!(already_bundled, AlreadyBundled::None) {
            return None;
        }
        let is_commonjs_module = already_bundled.is_common_js();
        let (source_code, bytecode_cache) = match already_bundled.into_bytecode() {
            Some(files) => (
                files
                    .source
                    .and_then(mapped_source_text)
                    .unwrap_or_else(|| BunString::clone_latin1(source_text)),
                Bytecode::mapped(files.bytecode),
            ),
            None => (BunString::clone_latin1(source_text), Bytecode::default()),
        };
        Some(Self {
            source_code,
            is_commonjs_module,
            already_bundled: true,
            bytecode_cache,
            ..Default::default()
        })
    }
}

/// A WTF string over the mapped text; `None` when it exceeds the WTF length limit.
fn mapped_source_text(text: MappedFile) -> Option<BunString> {
    if text.as_slice().len() > BunString::max_length() {
        return None;
    }
    let file = bun_core::heap::into_raw(Box::new(text));
    // SAFETY: `file` is freed only by the string created below, after this
    // borrow ends.
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
    // SAFETY: `file` is the `into_raw` pointer `mapped_source_text` registered;
    // WTF calls this exactly once.
    unsafe { bun_core::heap::destroy(file) };
}

/// `ResolvedSource.bytecode_cache`: C++ sees `{ uint8_t* ptr; size_t len; void* file; bool persistent; }`.
/// `file` is the `Box<MappedFile>` owning `ptr[..len]` (a `.jsc` sidecar), or
/// null when the bytes are borrowed from the standalone module graph or the
/// compile cache.
#[repr(C)]
pub struct Bytecode {
    ptr: *mut u8,
    len: usize,
    file: *mut c_void,
    /// The bytes outlive every VM (executable section, retired compile-cache blob), so JSC may alias them instead of copying.
    persistent: bool,
}

impl Default for Bytecode {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
            len: 0,
            file: core::ptr::null_mut(),
            persistent: false,
        }
    }
}

impl Bytecode {
    pub fn borrowed(bytes: &[u8]) -> Self {
        if bytes.is_empty() {
            return Self::default();
        }
        Self {
            ptr: bytes.as_ptr().cast_mut(),
            len: bytes.len(),
            file: core::ptr::null_mut(),
            persistent: false,
        }
    }
    /// Borrowed from memory the caller guarantees is never freed or unmapped for the rest of the process
    /// (the executable's module graph section, NodeCompileCache's retired blobs).
    pub fn persistent(bytes: &[u8]) -> Self {
        Self {
            persistent: !bytes.is_empty(),
            ..Self::borrowed(bytes)
        }
    }
    pub fn mapped(file: MappedFile) -> Self {
        if file.is_empty() {
            return Self::default();
        }
        let file = bun_core::heap::into_raw(Box::new(file));
        // SAFETY: `file` is destroyed only through the returned value, after
        // this borrow ends.
        let bytes = unsafe { &*file }.as_slice();
        Self {
            ptr: bytes.as_ptr().cast_mut(),
            len: bytes.len(),
            file: file.cast::<c_void>(),
            persistent: false,
        }
    }
}

impl Drop for Bytecode {
    fn drop(&mut self) {
        if !self.file.is_null() {
            // SAFETY: this `Bytecode` is the only owner of `file`.
            unsafe { ResolvedSource__destroyBytecodeFile(self.file) };
        }
    }
}

/// `~ErrorableResolvedSource` / `JSC::CachedBytecode` destructor for a
/// [`Bytecode::mapped`] file.
///
/// # Safety
/// `file` is a `Bytecode::file` that nothing else will destroy or read through.
#[unsafe(no_mangle)]
unsafe extern "C" fn ResolvedSource__destroyBytecodeFile(file: *mut c_void) {
    // SAFETY: per the contract above.
    unsafe { bun_core::heap::destroy(file.cast::<MappedFile>()) };
}

bun_core::assert_ffi_layout!(ResolvedSource, 144, 8);
