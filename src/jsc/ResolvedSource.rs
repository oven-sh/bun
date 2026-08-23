use core::ffi::c_void;

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
pub struct ResolvedSource {
    pub source_code: BunString,
    pub source_url: BunString,

    pub is_commonjs_module: bool,

    /// When .tag is .common_js_custom_extension, this is special-cased to hold
    /// the JSFunction extension. It is kept alive by
    /// - This structure is stored on the stack
    /// - There is a JSC::Strong reference to it
    pub cjs_custom_extension_index: JSValue,

    pub allocator: *mut c_void,

    pub jsvalue_for_export: JSValue,

    pub tag: Tag,

    pub already_bundled: bool,

    pub bytecode_cache: Bytecode,
    /// `Zig::SourceProvider` takes it (nulling the field).
    pub module_info: ModuleInfo,
    /// The file path used as the source origin for bytecode cache validation.
    /// JSC validates bytecode by checking if the origin URL matches exactly what
    /// was used at build time. If empty, the origin is derived from source_url.
    /// This is converted to a file:// URL on the C++ side.
    pub bytecode_origin_path: BunString,
}

impl Default for ResolvedSource {
    fn default() -> Self {
        Self {
            source_code: BunString::empty(),
            source_url: BunString::empty(),
            is_commonjs_module: false,
            cjs_custom_extension_index: JSValue::ZERO,
            allocator: core::ptr::null_mut(),
            jsvalue_for_export: JSValue::ZERO,
            tag: Tag::Javascript,
            already_bundled: false,
            bytecode_cache: Bytecode::default(),
            module_info: ModuleInfo::default(),
            bytecode_origin_path: BunString::empty(),
        }
    }
}

/// `ResolvedSource.module_info`: C++ sees a nullable `bun_ModuleInfoDeserialized*`
/// and takes ownership by swapping in null.
// `c_void` pointee: the C++ side only ever sees an opaque pointer, and
// `improper_ctypes` would otherwise recurse into `ModuleInfoDeserialized`.
#[repr(transparent)]
#[derive(Default)]
pub struct ModuleInfo(Option<core::ptr::NonNull<c_void>>);

impl From<Box<ModuleInfoDeserialized>> for ModuleInfo {
    fn from(b: Box<ModuleInfoDeserialized>) -> Self {
        Self(Some(bun_core::heap::into_raw_nn(b).cast()))
    }
}

impl From<Option<Box<ModuleInfoDeserialized>>> for ModuleInfo {
    fn from(b: Option<Box<ModuleInfoDeserialized>>) -> Self {
        Self(b.map(|b| bun_core::heap::into_raw_nn(b).cast()))
    }
}

impl Drop for ModuleInfo {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            // SAFETY: sole owner of the `heap::into_raw` allocation.
            drop(unsafe { bun_core::heap::take(p.cast::<ModuleInfoDeserialized>().as_ptr()) });
        }
    }
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
}

impl Default for Bytecode {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
            len: 0,
            owned: false,
        }
    }
}

impl Bytecode {
    pub fn borrowed(bytes: &[u8]) -> Self {
        Self {
            ptr: bytes.as_ptr().cast_mut(),
            len: bytes.len(),
            owned: false,
        }
    }
    pub fn owned(bytes: Box<[u8]>) -> Self {
        let len = bytes.len();
        Self {
            ptr: bun_core::heap::into_raw(bytes).cast::<u8>(),
            len,
            owned: true,
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl Drop for Bytecode {
    fn drop(&mut self) {
        if self.owned && !self.ptr.is_null() {
            // SAFETY: `owned` ⇒ `heap::into_raw(Box<[u8]>)` of `len` bytes.
            drop(unsafe {
                bun_core::heap::take(core::ptr::slice_from_raw_parts_mut(self.ptr, self.len))
            });
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

// C++ mirror: `ResolvedSource` in headers-handwritten.h (2×BunString, bool,
// 3×ptr-size, u32, bool, Bytecode{ptr,usize,bool}, ptr, BunString).
bun_core::assert_ffi_layout!(ResolvedSource, 144, 8);
