use bun_bundler::analyze_transpiled_module::ModuleInfoDeserialized;

use bun_core::String as BunString;

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
    /// The file path whose `file://` URL is this module's source origin (what `import()` resolves against and what a
    /// bytecode cache is validated against). Empty: derived from `source_url` (a builtin gets a `builtin://` origin).
    pub origin_path: BunString,
}

/// `ResolvedSource.bytecode_cache`: C++ sees `{ uint8_t* ptr; size_t len; bool owned; }`.
/// When `owned`, `ptr` is a `heap::into_raw(Box<[u8]>)` freed on drop (or by
/// the C++ consumer once it `std::exchange`s the pointer out); otherwise it is
/// borrowed from the standalone module graph or the compile cache.
#[repr(C)]
pub struct Bytecode {
    ptr: *mut u8,
    len: usize,
    owned: bool,
    /// The bytes outlive every VM (executable section, retired compile-cache blob), so JSC may alias them instead of copying.
    persistent: bool,
}

impl Default for Bytecode {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
            len: 0,
            owned: false,
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
            owned: false,
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
    pub fn owned(bytes: Box<[u8]>) -> Self {
        if bytes.is_empty() {
            return Self::default();
        }
        let len = bytes.len();
        Self {
            ptr: bun_core::heap::into_raw(bytes).cast::<u8>(),
            len,
            owned: true,
            persistent: false,
        }
    }
}

impl Drop for Bytecode {
    fn drop(&mut self) {
        if self.owned && !self.ptr.is_null() {
            ResolvedSource__freeBytecode(self.ptr);
        }
    }
}

/// `~ErrorableResolvedSource` / `JSC::CachedBytecode` destructor for an owned
/// `Bytecode` (see above).
#[unsafe(no_mangle)]
extern "C" fn ResolvedSource__freeBytecode(bytecode: *mut u8) {
    // SAFETY: only called with the `heap::into_raw(Box<[u8]>)` base pointer;
    // mimalloc recovers the size from the heap.
    unsafe { bun_alloc::default_alloc::free(bytecode.cast()) };
}

bun_core::assert_ffi_layout!(ResolvedSource, 136, 8);
