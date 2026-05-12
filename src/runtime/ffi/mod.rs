//! Port of `src/runtime/ffi/FFI.zig` — `Bun.FFI` / `bun:ffi`.
//!
//! B-2 second-pass: `ABIType` (CType) enum, `FFI`/`Function`/`Step`/`Compiled`
//! structs, formatters, dlopen data path, and the JSC host-fn entry points
//! (`open`/`close`/`compile`/`generate_symbols`) are real. TinyCC compile
//! bodies (`CompileC`, `Function::compile` relocate path) and the remaining
//! host-fns (`cc`/`linkSymbols`/`callback`) stay gated on `bun_tcc_sys::State`
//! API.

use core::ffi::{c_char, c_int, c_void};
use core::ptr::NonNull;
use std::sync::Once;

use bun_collections::StringArrayHashMap;
use bun_core::{ZBox, ZStr};

use crate::jsc::{JSGlobalObject, JSValue};

// ─── un-gated host-fn bodies (open/close/compile/generate_symbols) ───────────
mod host_fns;
pub use host_fns::{generate_symbol_for_function, generate_symbols};

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────

#[path = "ffi_body.rs"]
mod ffi_body; // full Phase-A draft of FFI.zig

/// `js2native` codegen resolves `$zig(ffi.zig, Bun__FFI__cc)` to
/// `crate::ffi::ffi::bun__ffi__cc`; the module name maps the `.zig` basename.
/// `FFI::bun_ffi_cc` lives in `ffi_body` (the full port) — re-export it under
/// the codegen-expected path so the dispatch table links without forcing the
/// generator to special-case `ffi/ffi.zig`.
pub mod ffi {
    pub use super::ffi_body::bun__ffi__cc;
}

#[path = "FFIObject.rs"]
pub mod ffi_object_draft;

// TODO(b2-blocked): bun_tcc_sys::State (compile/relocate/add_symbol/define_symbol)
pub mod ffi_object {}

// ─── DOMCall slowpath C-ABI exports ──────────────────────────────────────────
// Zig: `host_fn.DOMCall(class, Container, fn, effect)` emits a `comptime
// @export(&slowpath, .{ .name = class ++ "__" ++ fn ++ "__slowpath" })` where
// `slowpath(global, this, args_ptr, args_len)` calls `toJSHostCall(global,
// @src(), Container.fn, .{ global, this, args[0..len] })`. The bodies live in
// `ffi_object_draft::reader::*` / `ffi_object_draft::ptr` (already ported);
// these shims are the missing `@export` wrappers.
mod dom_call_slowpath {
    use super::ffi_object_draft as ffi_object;
    use crate::jsc::{JSGlobalObject, JSValue};

    macro_rules! dom_call_slowpath {
        ($( $sym:ident => $target:path ),* $(,)?) => {$(
            #[unsafe(no_mangle)]
            #[bun_jsc::host_call]
            pub fn $sym(
                global: *mut JSGlobalObject,
                this_value: JSValue,
                arguments_ptr: *const JSValue,
                arguments_len: usize,
            ) -> JSValue {
                // SAFETY: C++ DOMJIT slowpath caller passes a live global and a
                // valid `[JSValue; arguments_len]` span (ZigLazyStaticFunctions).
                let (global, arguments) = unsafe {
                    (&*global, core::slice::from_raw_parts(arguments_ptr, arguments_len))
                };
                bun_jsc::to_js_host_call(global, move || $target(global, this_value, arguments))
            }
        )*};
    }

    dom_call_slowpath! {
        Reader__u8__slowpath     => ffi_object::reader::u8,
        Reader__u16__slowpath    => ffi_object::reader::u16,
        Reader__u32__slowpath    => ffi_object::reader::u32,
        Reader__ptr__slowpath    => ffi_object::reader::ptr,
        Reader__i8__slowpath     => ffi_object::reader::i8,
        Reader__i16__slowpath    => ffi_object::reader::i16,
        Reader__i32__slowpath    => ffi_object::reader::i32,
        Reader__i64__slowpath    => ffi_object::reader::i64,
        Reader__u64__slowpath    => ffi_object::reader::u64,
        Reader__intptr__slowpath => ffi_object::reader::intptr,
        Reader__f32__slowpath    => ffi_object::reader::f32,
        Reader__f64__slowpath    => ffi_object::reader::f64,
    }

    // `FFI.ptr` slowpath — body returns bare `JSValue` (errors are values, not
    // exceptions), so no `to_js_host_call` mapping.
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    pub fn FFI__ptr__slowpath(
        global: *mut JSGlobalObject,
        this_value: JSValue,
        arguments_ptr: *const JSValue,
        arguments_len: usize,
    ) -> JSValue {
        // SAFETY: see `dom_call_slowpath!` above.
        let (global, arguments) = unsafe {
            (
                &*global,
                core::slice::from_raw_parts(arguments_ptr, arguments_len),
            )
        };
        ffi_object::ptr(global, this_value, arguments)
    }
}

// ─── TinyCC handle stub ──────────────────────────────────────────────────────
// `bun_tcc_sys` currently exposes only an opaque marker; the method-ful
// `State` (compile_string/relocate/add_symbol/…) is gated. Model the handle
// as an opaque pointer so `Function`/`FFI` field shapes are real.
#[allow(non_snake_case)]
mod TCC {
    bun_opaque::opaque_ffi! {
        /// `TCCState*` — Nomicon opaque-FFI pattern.
        pub struct State;
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

/// RAII scope that disables `pthread_jit_write_protect_np` for the current
/// thread on aarch64 macOS, re-enabling it on `Drop`. No-op elsewhere.
struct JitWriteUnprotected(());

impl JitWriteUnprotected {
    const HAS_PROTECTION: bool = cfg!(all(target_arch = "aarch64", target_os = "macos"));

    #[inline]
    fn new() -> Self {
        if Self::HAS_PROTECTION {
            // SAFETY: aarch64 macOS only; toggles W^X for the current thread
            unsafe { pthread_jit_write_protect_np(false as c_int) };
        }
        Self(())
    }
}

impl Drop for JitWriteUnprotected {
    #[inline]
    fn drop(&mut self) {
        if Self::HAS_PROTECTION {
            // SAFETY: re-enable JIT write protection on scope exit
            unsafe { pthread_jit_write_protect_np(true as c_int) };
        }
    }
}

/// Run a function that needs to write to JIT-protected memory.
///
/// This is dangerous as it allows overwriting executable regions of memory.
/// Do not pass in user-defined functions (including JSFunctions).
pub(crate) fn dangerously_run_without_jit_protections<R>(func: impl FnOnce() -> R) -> R {
    let _guard = JitWriteUnprotected::new();
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
    // Populated once by C++ via `Bun__FFI__ensureOffsetsAreLoaded`; Rust only
    // reads after the `Once` below fires. C++ mutates these bytes, so a plain
    // non-`mut` extern static would assert immutability to the optimizer (UB
    // per the Rust reference). `RacyCell<T>` is `#[repr(transparent)]` over
    // `UnsafeCell<T>`, so the linker sees the same `Offsets` layout while Rust
    // sees interior mutability.
    #[link_name = "Bun__FFI__offsets"]
    static BUN_FFI_OFFSETS: bun_core::RacyCell<Offsets>;
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
        unsafe { &*BUN_FFI_OFFSETS.get() }
    }
}

/// Get the last dynamic-library loading error message in a cross-platform way.
/// On POSIX systems, this calls `dlerror()`.
/// On Windows, this uses `GetLastError()` and formats the error code.
/// Returns an owned byte string (heap-copied since `dlerror()`'s storage is
/// not stable across calls).
///
/// Note: never fails — the Zig `![]const u8` was allocator-fallible only;
/// `Vec` write! is infallible and the POSIX path is unconditional, so the
/// `Result` wrapper has been dropped.
pub(crate) fn get_dl_error() -> Box<[u8]> {
    #[cfg(windows)]
    {
        use std::io::Write as _;
        // SAFETY: GetLastError() reads thread-local Win32 state, takes no
        // arguments, and has no preconditions; always safe to call.
        let err = unsafe { bun_sys::windows::GetLastError() };
        let err_int = err as u32;
        let mut v = Vec::new();
        write!(&mut v, "error code {}", err_int).ok();
        v.into_boxed_slice()
    }
    #[cfg(not(windows))]
    {
        // SAFETY: dlerror is safe to call from any thread
        let msg: &[u8] = unsafe {
            let p = libc::dlerror();
            if !p.is_null() {
                bun_core::ffi::cstr(p).to_bytes()
            } else {
                b"unknown error"
            }
        };
        Box::<[u8]>::from(msg)
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// FFI — `.classes.ts` payload (the C++ JSCell wrapper stays generated; this is
// `m_ctx`). The codegen `FFIPrototype__*` thunks resolve to `crate::ffi::FFI`,
// so this MUST be the same type that `to_js()` boxes into the wrapper.
// ═════════════════════════════════════════════════════════════════════════════

pub use ffi_body::FFI;

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
            Source::Files(files) => files.first().map(|b| b.as_zstr()).unwrap_or(ZStr::EMPTY),
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

// PORTING.md §Global mutable state: written once at startup with the
// resolved tinycc lib dir; read by the FFI compile path. RacyCell over the
// raw C-string pointer (no concurrent writers).
pub static LIB_DIR_Z: bun_core::RacyCell<*const c_char> =
    bun_core::RacyCell::new(b"\0".as_ptr().cast::<c_char>());

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
// ABIType — single source of truth lives in abi_type.rs
// ═════════════════════════════════════════════════════════════════════════════
mod abi_type;
pub use abi_type::{ABI_TYPE_LABEL, ABIType, EnumMapFormatter, ToCFormatter, ToJSFormatter};

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

// ported from: src/runtime/ffi/FFI.zig
