//! Port of `src/runtime/ffi/FFI.zig` — `Bun.FFI` / `bun:ffi`.
//!
//! B-2 second-pass: `ABIType` (CType) enum, `FFI`/`Function`/`Step`/`Compiled`
//! structs, formatters, dlopen data path, and the JSC host-fn entry points
//! (`open`/`close`/`compile`/`generate_symbols`) are real. TinyCC compile
//! bodies (`CompileC`, `Function::compile` relocate path) and the remaining
//! host-fns (`cc`/`linkSymbols`/`callback`) stay gated on `bun_tcc_sys::State`
//! API.

use core::ffi::{c_char, c_int, c_void};
use core::fmt::{self, Write as _};
use core::ptr::NonNull;
use std::sync::Once;

use bstr::BStr;

use bun_collections::StringArrayHashMap;
use bun_core::{ZBox, ZStr};
use bun_sys::DynLib;

use crate::jsc::{JSGlobalObject, JSValue};

// ─── un-gated host-fn bodies (open/close/compile/generate_symbols) ───────────
mod host_fns;
pub use host_fns::{generate_symbol_for_function, generate_symbols};

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────

#[path = "ffi_body.rs"]
mod ffi_body; // full Phase-A draft of FFI.zig

#[path = "FFIObject.rs"]
pub mod ffi_object_draft;

// TODO(b2-blocked): bun_tcc_sys::State (compile/relocate/add_symbol/define_symbol)
pub mod ffi_object {}

// ─── TinyCC handle stub ──────────────────────────────────────────────────────
// `bun_tcc_sys` currently exposes only an opaque marker; the method-ful
// `State` (compile_string/relocate/add_symbol/…) is gated. Model the handle
// as an opaque pointer so `Function`/`FFI` field shapes are real.
#[allow(non_snake_case)]
mod TCC {
    /// `TCCState*` — Nomicon opaque-FFI pattern.
    #[repr(C)]
    pub struct State {
        _p: [u8; 0],
        _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
    }
    // Raw extern so the handle can be freed even while the method-ful
    // `bun_tcc_sys::State` API stays gated.
    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        pub fn tcc_delete(s: *mut State);
    }
}

// ─── JIT write-protect helper ────────────────────────────────────────────────

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn pthread_jit_write_protect_np(enable: c_int);
}

/// Run a function that needs to write to JIT-protected memory.
///
/// This is dangerous as it allows overwriting executable regions of memory.
/// Do not pass in user-defined functions (including JSFunctions).
pub(crate) fn dangerously_run_without_jit_protections<R>(func: impl FnOnce() -> R) -> R {
    const HAS_PROTECTION: bool = cfg!(all(target_arch = "aarch64", target_os = "macos"));
    if HAS_PROTECTION {
        // SAFETY: aarch64 macOS only; toggles W^X for the current thread
        unsafe { pthread_jit_write_protect_np(false as c_int) };
    }
    let _guard = scopeguard::guard((), |_| {
        if HAS_PROTECTION {
            // SAFETY: re-enable JIT write protection on scope exit
            unsafe { pthread_jit_write_protect_np(true as c_int) };
        }
    });
    // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
    func()
}

// ─── Offsets bridge ──────────────────────────────────────────────────────────

#[repr(C)]
pub(crate) struct Offsets {
    pub js_array_buffer_view_offset_of_length: u32,
    pub js_array_buffer_view_offset_of_byte_offset: u32,
    pub js_array_buffer_view_offset_of_vector: u32,
    pub js_cell_offset_of_type: u32,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    #[link_name = "Bun__FFI__offsets"]
    static mut BUN_FFI_OFFSETS: Offsets;
    #[link_name = "Bun__FFI__ensureOffsetsAreLoaded"]
    fn bun_ffi_ensure_offsets_are_loaded();
}

impl Offsets {
    fn load_once() {
        // SAFETY: extern "C" fn populating a static
        unsafe { bun_ffi_ensure_offsets_are_loaded() };
    }
    pub fn get() -> &'static Offsets {
        static ONCE: Once = Once::new();
        ONCE.call_once(Self::load_once);
        // SAFETY: BUN_FFI_OFFSETS is initialized by load_once and never mutated after
        unsafe { &*core::ptr::addr_of!(BUN_FFI_OFFSETS) }
    }
}

/// Get the last dynamic library loading error message in a cross-platform way.
/// On POSIX systems, this calls dlerror().
/// On Windows, this uses GetLastError() and formats the error message.
/// Returns an allocated string that must be freed by the caller.
pub(crate) fn get_dl_error() -> Result<Box<[u8]>, bun_core::Error> {
    #[cfg(windows)]
    {
        use std::io::Write as _;
        // On Windows, we need to use GetLastError() and FormatMessageW()
        // TODO(b2-blocked): bun_sys::windows::GetLastError
        let err_int = 0u32;
        let mut v = Vec::new();
        write!(&mut v, "error code {}", err_int).ok();
        Ok(v.into_boxed_slice())
    }
    #[cfg(not(windows))]
    {
        // On POSIX systems, use dlerror() to get the actual system error
        // SAFETY: dlerror is safe to call from any thread
        let msg: &[u8] = unsafe {
            let p = libc::dlerror();
            if !p.is_null() {
                core::ffi::CStr::from_ptr(p).to_bytes()
            } else {
                b"unknown error"
            }
        };
        // Return a copy since dlerror() string is not stable
        Ok(Box::<[u8]>::from(msg))
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// FFI — `.classes.ts` payload (the C++ JSCell wrapper stays generated; this is
// `m_ctx`). `#[bun_jsc::JsClass]` derive is gated; struct shape is real.
// ═════════════════════════════════════════════════════════════════════════════

// TODO(b2-blocked): #[bun_jsc::JsClass]
#[repr(C)]
pub struct FFI {
    pub dylib: Option<DynLib>,
    pub functions: StringArrayHashMap<Function>,
    pub closed: bool,
    pub shared_state: Option<NonNull<TCC::State>>,
}

impl Default for FFI {
    fn default() -> Self {
        Self {
            dylib: None,
            functions: StringArrayHashMap::default(),
            closed: false,
            shared_state: None,
        }
    }
}

impl FFI {
    /// `.classes.ts` finalize hook — runs on mutator thread during lazy sweep.
    pub fn finalize(_this: *mut FFI) {}
}

// ─── CompileC ────────────────────────────────────────────────────────────────

pub struct CompileC {
    pub source: Source,
    // TODO(port): lifetime — Zig stored borrowed [:0]const u8 into `source`
    pub current_file_for_errors: &'static ZStr,
    pub libraries: StringArray,
    pub library_dirs: StringArray,
    pub include_dirs: StringArray,
    pub symbols: SymbolsMap,
    pub define: Vec<[ZBox; 2]>,
    /// Flags to replace the default flags
    pub flags: Option<ZBox>,
    pub deferred_errors: Vec<Box<[u8]>>,
}

impl Default for CompileC {
    fn default() -> Self {
        Self {
            source: Source::File(ZBox::from_vec_with_nul(Vec::new())),
            current_file_for_errors: ZStr::EMPTY,
            libraries: StringArray::default(),
            library_dirs: StringArray::default(),
            include_dirs: StringArray::default(),
            symbols: SymbolsMap::default(),
            define: Vec::new(),
            flags: None,
            deferred_errors: Vec::new(),
        }
    }
}

pub enum Source {
    File(ZBox),
    Files(Vec<ZBox>),
}

impl Source {
    pub fn first(&self) -> &ZStr {
        match self {
            Source::File(f) => f,
            Source::Files(files) => files
                .first()
                .map(|b| b.as_zstr())
                .unwrap_or(ZStr::EMPTY),
        }
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum DeferredError {
    #[error("DeferredErrors")]
    DeferredErrors,
}

#[derive(Default)]
pub struct SymbolsMap {
    pub map: StringArrayHashMap<Function>,
}

#[derive(Default)]
pub struct StringArray {
    pub items: Vec<ZBox>,
}

impl Drop for StringArray {
    fn drop(&mut self) {
        for item in self.items.iter() {
            // Attempting to free an empty null-terminated slice will crash if it was a default value
            debug_assert!(!item.is_empty());
        }
        // Vec<ZBox> drops itself
    }
}

// ─── Function ────────────────────────────────────────────────────────────────

pub struct Function {
    pub symbol_from_dynamic_library: Option<*mut c_void>,
    pub base_name: Option<ZBox>,
    pub state: Option<NonNull<TCC::State>>,

    pub return_type: ABIType,
    pub arg_types: Vec<ABIType>,
    pub step: Step,
    pub threadsafe: bool,
    // allocator field dropped — global mimalloc
}

impl Default for Function {
    fn default() -> Self {
        Self {
            symbol_from_dynamic_library: None,
            base_name: None,
            state: None,
            return_type: ABIType::Void,
            arg_types: Vec::new(),
            step: Step::Pending,
            threadsafe: false,
        }
    }
}

// TODO(port): mutable static — wrap in OnceLock or similar
pub static mut LIB_DIR_Z: *const c_char = b"\0".as_ptr() as *const c_char;

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn FFICallbackFunctionWrapper_destroy(_: *mut c_void);
}

impl Drop for Function {
    fn drop(&mut self) {
        // base_name, arg_types, Step::Failed.msg are owned and freed by drop glue.
        if let Some(state) = self.state.take() {
            // SAFETY: `state` is the live TCCState* allocated for this Function's
            // trampoline; ownership is unique here (taken from self).
            unsafe { TCC::tcc_delete(state.as_ptr()) };
        }
        if let Step::Compiled(compiled) = &mut self.step {
            if let Some(wrapper) = compiled.ffi_callback_function_wrapper.take() {
                // SAFETY: wrapper was created by Bun__createFFICallbackFunction
                unsafe { FFICallbackFunctionWrapper_destroy(wrapper.as_ptr()) };
            }
        }
    }
}

impl Function {
    pub fn needs_handle_scope(&self) -> bool {
        for arg in self.arg_types.iter() {
            if *arg == ABIType::NapiEnv || *arg == ABIType::NapiValue {
                return true;
            }
        }
        self.return_type == ABIType::NapiValue
    }

    pub fn needs_napi_env(&self) -> bool {
        for arg in self.arg_types.iter() {
            if *arg == ABIType::NapiEnv || *arg == ABIType::NapiValue {
                return true;
            }
        }
        false
    }

    pub(super) fn fail(&mut self, msg: &'static [u8]) {
        if !matches!(self.step, Step::Failed { .. }) {
            // PORT NOTE: @branchHint(.likely) — Rust has no statement-level hint; left as-is
            self.step = Step::Failed {
                msg: Box::<[u8]>::from(msg),
                allocated: false,
            };
        }
    }

    pub fn ffi_header() -> &'static [u8] {
        // TODO(port): runtimeEmbedFile fallback when codegen_embed is off
        include_bytes!("./FFI.h")
    }
}

// ─── Step ────────────────────────────────────────────────────────────────────

pub enum Step {
    Pending,
    Compiled(Compiled),
    Failed { msg: Box<[u8]>, allocated: bool },
}

pub struct Compiled {
    pub ptr: *mut c_void,
    // TODO(port): bare JSValue on heap — rooted via JSFFI.symbolsValue own:
    // property; revisit Strong/JsRef once bun_jsc lands
    pub js_function: JSValue,
    pub js_context: Option<*mut JSGlobalObject>,
    pub ffi_callback_function_wrapper: Option<NonNull<c_void>>,
}

impl Default for Compiled {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
            js_function: JSValue::ZERO,
            js_context: None,
            ffi_callback_function_wrapper: None,
        }
    }
}

impl Step {
    pub fn compiled_ptr(&self) -> *mut c_void {
        match self {
            Step::Compiled(c) => c.ptr,
            _ => core::ptr::null_mut(),
        }
    }
}

// ─── FFI_Callback externs ────────────────────────────────────────────────────
// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn FFI_Callback_call(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_0(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_1(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_2(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_3(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_4(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_5(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_threadsafe_call(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_6(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_7(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn Bun__createFFICallbackFunction(_: &JSGlobalObject, _: JSValue) -> *mut c_void;
}

// ═════════════════════════════════════════════════════════════════════════════
// ABIType — must be kept in sync with JSFFIFunction.h
// ═════════════════════════════════════════════════════════════════════════════

#[repr(i32)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum ABIType {
    #[strum(serialize = "char")]
    Char = 0,

    #[strum(serialize = "int8_t")]
    Int8T = 1,
    #[strum(serialize = "uint8_t")]
    Uint8T = 2,

    #[strum(serialize = "int16_t")]
    Int16T = 3,
    #[strum(serialize = "uint16_t")]
    Uint16T = 4,

    #[strum(serialize = "int32_t")]
    Int32T = 5,
    #[strum(serialize = "uint32_t")]
    Uint32T = 6,

    #[strum(serialize = "int64_t")]
    Int64T = 7,
    #[strum(serialize = "uint64_t")]
    Uint64T = 8,

    #[strum(serialize = "double")]
    Double = 9,
    #[strum(serialize = "float")]
    Float = 10,

    #[strum(serialize = "bool")]
    Bool = 11,

    #[strum(serialize = "ptr")]
    Ptr = 12,

    #[strum(serialize = "void")]
    Void = 13,

    #[strum(serialize = "cstring")]
    CString = 14,

    #[strum(serialize = "i64_fast")]
    I64Fast = 15,
    #[strum(serialize = "u64_fast")]
    U64Fast = 16,

    #[strum(serialize = "function")]
    Function = 17,
    #[strum(serialize = "napi_env")]
    NapiEnv = 18,
    #[strum(serialize = "napi_value")]
    NapiValue = 19,
    #[strum(serialize = "buffer")]
    Buffer = 20,
}

impl ABIType {
    pub const MAX: i32 = ABIType::NapiValue as i32;

    pub const LABEL: phf::Map<&'static [u8], ABIType> = phf::phf_map! {
        b"bool" => ABIType::Bool,
        b"c_int" => ABIType::Int32T,
        b"c_uint" => ABIType::Uint32T,
        b"char" => ABIType::Char,
        b"char*" => ABIType::Ptr,
        b"double" => ABIType::Double,
        b"f32" => ABIType::Float,
        b"f64" => ABIType::Double,
        b"float" => ABIType::Float,
        b"i16" => ABIType::Int16T,
        b"i32" => ABIType::Int32T,
        b"i64" => ABIType::Int64T,
        b"i8" => ABIType::Int8T,
        b"int" => ABIType::Int32T,
        b"int16_t" => ABIType::Int16T,
        b"int32_t" => ABIType::Int32T,
        b"int64_t" => ABIType::Int64T,
        b"int8_t" => ABIType::Int8T,
        b"isize" => ABIType::Int64T,
        b"u16" => ABIType::Uint16T,
        b"u32" => ABIType::Uint32T,
        b"u64" => ABIType::Uint64T,
        b"u8" => ABIType::Uint8T,
        b"uint16_t" => ABIType::Uint16T,
        b"uint32_t" => ABIType::Uint32T,
        b"uint64_t" => ABIType::Uint64T,
        b"uint8_t" => ABIType::Uint8T,
        b"usize" => ABIType::Uint64T,
        b"size_t" => ABIType::Uint64T,
        b"buffer" => ABIType::Buffer,
        b"void*" => ABIType::Ptr,
        b"ptr" => ABIType::Ptr,
        b"pointer" => ABIType::Ptr,
        b"void" => ABIType::Void,
        b"cstring" => ABIType::CString,
        b"i64_fast" => ABIType::I64Fast,
        b"u64_fast" => ABIType::U64Fast,
        b"function" => ABIType::Function,
        b"callback" => ABIType::Function,
        b"fn" => ABIType::Function,
        b"napi_env" => ABIType::NapiEnv,
        b"napi_value" => ABIType::NapiValue,
    };

    // TODO(port): map_to_js_object — Zig builds a comptime "{...}" string from
    // `map` via EnumMapFormatter. Rust cannot iterate phf at const time;
    // generate via build.rs or const_format! in Phase B.
    pub const MAP_TO_JS_OBJECT: &'static str = "";

    /// Types that we can directly pass through as an `int64_t`
    pub fn needs_a_cast_in_c(self) -> bool {
        !matches!(
            self,
            ABIType::Char
                | ABIType::Int8T
                | ABIType::Uint8T
                | ABIType::Int16T
                | ABIType::Uint16T
                | ABIType::Int32T
                | ABIType::Uint32T
        )
    }

    pub fn is_floating_point(self) -> bool {
        matches!(self, ABIType::Double | ABIType::Float)
    }

    pub fn to_c(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter { tag: self, symbol, exact: false }
    }

    pub fn to_c_exact(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter { tag: self, symbol, exact: true }
    }

    pub fn to_js(self, symbol: &[u8]) -> ToJSFormatter<'_> {
        ToJSFormatter { tag: self, symbol }
    }

    pub fn typename(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub fn typename_label(self) -> &'static [u8] {
        match self {
            ABIType::Buffer | ABIType::Function | ABIType::CString | ABIType::Ptr => b"void*",
            ABIType::Bool => b"bool",
            ABIType::Int8T => b"int8_t",
            ABIType::Uint8T => b"uint8_t",
            ABIType::Int16T => b"int16_t",
            ABIType::Uint16T => b"uint16_t",
            ABIType::Int32T => b"int32_t",
            ABIType::Uint32T => b"uint32_t",
            ABIType::I64Fast | ABIType::Int64T => b"int64_t",
            ABIType::U64Fast | ABIType::Uint64T => b"uint64_t",
            ABIType::Double => b"double",
            ABIType::Float => b"float",
            ABIType::Char => b"char",
            ABIType::Void => b"void",
            ABIType::NapiEnv => b"napi_env",
            ABIType::NapiValue => b"napi_value",
        }
    }

    pub fn param_typename(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub fn param_typename_label(self) -> &'static [u8] {
        match self {
            ABIType::Function | ABIType::CString | ABIType::Ptr => b"void*",
            ABIType::Bool => b"bool",
            ABIType::Int8T => b"int8_t",
            ABIType::Uint8T => b"uint8_t",
            ABIType::Int16T => b"int16_t",
            ABIType::Uint16T => b"uint16_t",
            // see the comment in ffi.ts about why `uint32_t` acts as `int32_t`
            ABIType::Int32T | ABIType::Uint32T => b"int32_t",
            ABIType::I64Fast | ABIType::Int64T => b"int64_t",
            ABIType::U64Fast | ABIType::Uint64T => b"uint64_t",
            ABIType::Double => b"double",
            ABIType::Float => b"float",
            ABIType::Char => b"char",
            ABIType::Void => b"void",
            ABIType::NapiEnv => b"napi_env",
            ABIType::NapiValue => b"napi_value",
            ABIType::Buffer => b"buffer",
        }
    }
}

pub struct EnumMapFormatter<'a> {
    pub name: &'a [u8],
    pub entry: ABIType,
}

impl fmt::Display for EnumMapFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("['")?;
        // these are not all valid identifiers
        fmt::Display::fmt(BStr::new(self.name), f)?;
        f.write_str("']:")?;
        write!(f, "{}", self.entry as i32)?;
        f.write_str(",'")?;
        write!(f, "{}", self.entry as i32)?;
        f.write_str("':")?;
        write!(f, "{}", self.entry as i32)
    }
}

pub struct ToCFormatter<'a> {
    pub symbol: &'a [u8],
    pub tag: ABIType,
    pub exact: bool,
}

impl fmt::Display for ToCFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.tag {
            ABIType::Void => return Ok(()),
            ABIType::Bool => {
                if self.exact {
                    writer.write_str("(bool)")?;
                }
                writer.write_str("JSVALUE_TO_BOOL(")?;
            }
            ABIType::Char
            | ABIType::Int8T
            | ABIType::Uint8T
            | ABIType::Int16T
            | ABIType::Uint16T
            | ABIType::Int32T
            | ABIType::Uint32T => {
                if self.exact {
                    write!(writer, "({})", <&'static str>::from(self.tag))?;
                }
                writer.write_str("JSVALUE_TO_INT32(")?;
            }
            ABIType::I64Fast | ABIType::Int64T => {
                if self.exact {
                    writer.write_str("(int64_t)")?;
                }
                writer.write_str("JSVALUE_TO_INT64(")?;
            }
            ABIType::U64Fast | ABIType::Uint64T => {
                if self.exact {
                    writer.write_str("(uint64_t)")?;
                }
                writer.write_str("JSVALUE_TO_UINT64(")?;
            }
            ABIType::Function | ABIType::CString | ABIType::Ptr => {
                if self.exact {
                    writer.write_str("(void*)")?;
                }
                writer.write_str("JSVALUE_TO_PTR(")?;
            }
            ABIType::Double => {
                if self.exact {
                    writer.write_str("(double)")?;
                }
                writer.write_str("JSVALUE_TO_DOUBLE(")?;
            }
            ABIType::Float => {
                if self.exact {
                    writer.write_str("(float)")?;
                }
                writer.write_str("JSVALUE_TO_FLOAT(")?;
            }
            ABIType::NapiEnv => {
                writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)")?;
                return Ok(());
            }
            ABIType::NapiValue => {
                fmt::Display::fmt(BStr::new(self.symbol), writer)?;
                writer.write_str(".asNapiValue")?;
                return Ok(());
            }
            ABIType::Buffer => {
                writer.write_str("JSVALUE_TO_TYPED_ARRAY_VECTOR(")?;
            }
        }
        fmt::Display::fmt(BStr::new(self.symbol), writer)?;
        writer.write_str(")")
    }
}

pub struct ToJSFormatter<'a> {
    pub symbol: &'a [u8],
    pub tag: ABIType,
}

impl fmt::Display for ToJSFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sym = BStr::new(self.symbol);
        match self.tag {
            ABIType::Void => Ok(()),
            ABIType::Bool => write!(writer, "BOOLEAN_TO_JSVALUE({})", sym),
            ABIType::Char
            | ABIType::Int8T
            | ABIType::Uint8T
            | ABIType::Int16T
            | ABIType::Uint16T
            | ABIType::Int32T => write!(writer, "INT32_TO_JSVALUE((int32_t){})", sym),
            ABIType::Uint32T => write!(writer, "UINT32_TO_JSVALUE({})", sym),
            ABIType::I64Fast => {
                write!(writer, "INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t){})", sym)
            }
            ABIType::Int64T => {
                write!(writer, "INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::U64Fast => {
                write!(writer, "UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::Uint64T => {
                write!(writer, "UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::Function | ABIType::CString | ABIType::Ptr => {
                write!(writer, "PTR_TO_JSVALUE({})", sym)
            }
            ABIType::Double => write!(writer, "DOUBLE_TO_JSVALUE({})", sym),
            ABIType::Float => write!(writer, "FLOAT_TO_JSVALUE({})", sym),
            ABIType::NapiEnv => writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)"),
            ABIType::NapiValue => {
                write!(writer, "((EncodedJSValue) {{.asNapiValue = {} }} )", sym)
            }
            ABIType::Buffer => writer.write_str("0"),
        }
    }
}

// ─── CompilerRT (pure C-ABI helpers + embedded sources) ──────────────────────

pub struct CompilerRT;

pub struct CompilerRtSources;
impl CompilerRtSources {
    pub const SOURCES: &'static [(&'static str, &'static [u8])] = &[
        ("stdbool.h", include_bytes!("./ffi-stdbool.h")),
        ("stdarg.h", include_bytes!("./ffi-stdarg.h")),
        ("stdnoreturn.h", include_bytes!("./ffi-stdnoreturn.h")),
        ("stdalign.h", include_bytes!("./ffi-stdalign.h")),
        ("tgmath.h", include_bytes!("./ffi-tgmath.h")),
        ("stddef.h", include_bytes!("./ffi-stddef.h")),
        ("varargs.h", b"// empty"),
    ];
}

impl CompilerRT {
    #[inline(never)]
    pub extern "C" fn memset(dest: *mut u8, c: u8, byte_count: usize) {
        // SAFETY: caller (TCC-compiled code) guarantees dest[0..byte_count] is writable
        unsafe { core::slice::from_raw_parts_mut(dest, byte_count) }.fill(c);
    }

    #[inline(never)]
    pub extern "C" fn memcpy(dest: *mut u8, source: *const u8, byte_count: usize) {
        // SAFETY: caller (TCC-compiled code) guarantees non-overlapping valid ranges
        unsafe {
            core::slice::from_raw_parts_mut(dest, byte_count)
                .copy_from_slice(core::slice::from_raw_parts(source, byte_count));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/ffi/FFI.zig (2465 lines)
//   confidence: medium (B-2 second-pass un-gate)
//   notes:      ABIType + FFI/Function/Step/Compiled/CompileC structs real;
//               dlopen primitives + JSC host-fn bodies (open/close/compile/
//               generate_symbols) real in `host_fns.rs`. TinyCC compile/
//               relocate paths and cc/linkSymbols/callback preserved in
//               ffi_body.rs (gated on bun_tcc_sys::tcc).
// ──────────────────────────────────────────────────────────────────────────
