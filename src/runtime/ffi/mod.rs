//! `Bun.FFI` / `bun:ffi`.
//!
//! `ABIType` (CType) enum, `FFI`/`Function`/`Step`/`Compiled` structs,
//! formatters, dlopen data path, and the JSC host-fn entry points
//! (`open`/`close`/`compile`/`generate_symbols`) are real. The full TinyCC
//! compile bodies (`CompileC`, `Function::compile`, `cc`/`linkSymbols`/
//! `callback`) live in `ffi_body` on top of `bun_sys::tcc_sys::State`.

use core::ffi::{c_char, c_void};
use core::ptr::NonNull;

use bun_core::ZBox;

use crate::jsc::JSGlobalObject;

mod host_fns;
pub use host_fns::{generate_symbol_for_function, generate_symbols};

// ─── implementation modules ──────────────────────────────────────────────────

#[path = "ffi_body.rs"]
mod ffi_body;

/// `js2native` codegen resolves `$rust(ffi.rs, Bun__FFI__cc)` to
/// `crate::ffi::ffi::bun__ffi__cc`; the module name maps the `.rs` basename.
/// `FFI::bun_ffi_cc` lives in `ffi_body` — re-export it under
/// the codegen-expected path so the dispatch table links without forcing the
/// generator to special-case `ffi/ffi.rs`.
pub mod ffi {
    pub use super::ffi_body::bun__ffi__cc;
}

#[path = "FFIObject.rs"]
pub mod ffi_object_draft;

// Canonical name (re-exported by `runtime::api`
// as `FFIObject`); the module itself still lives under the draft name because
// `api/BunObject.rs` references `crate::ffi::ffi_object_draft::getter`.
pub use ffi_object_draft as ffi_object;

// ─── DOMCall slowpath C-ABI exports ──────────────────────────────────────────
// The C++ DOMJIT side expects a `<class>__<fn>__slowpath` export with
// signature `slowpath(global, this, args_ptr, args_len)`. The bodies live in
// `ffi_object_draft::reader::*` / `ffi_object_draft::ptr`;
// these shims are the exported wrappers.
mod dom_call_slowpath {
    use super::ffi_object_draft as ffi_object;
    use crate::jsc::{JSGlobalObject, JSValue};

    macro_rules! dom_call_slowpath {
        ($( $sym:ident => $target:path ),* $(,)?) => {$(
            #[unsafe(no_mangle)]
            #[bun_jsc::host_call]
            pub(crate) fn $sym(
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
    pub(super) fn FFI__ptr__slowpath(
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

// `bun_tcc_sys` provides the method-ful `State` (compile_string/relocate/
// add_symbol/…) with per-target link stubs where TinyCC isn't built — see
// `tcc_externs!` in `src/tcc_sys/tcc.rs`.
use bun_sys::tcc_sys as TCC;

/// Get the last dynamic-library loading error message in a cross-platform way.
/// On POSIX systems, this calls `dlerror()`.
/// On Windows, this uses `GetLastError()` and formats the error code.
/// Returns an owned byte string (heap-copied since `dlerror()`'s storage is
/// not stable across calls).
///
/// Note: never fails — `Vec` write! is infallible and the POSIX path is
/// unconditional.
pub(crate) fn get_dl_error() -> Box<[u8]> {
    #[cfg(windows)]
    {
        use std::io::Write as _;
        let err = bun_sys::windows::GetLastError();
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

// The full `CompileC`/`Source`/`SymbolsMap`/`StringArray`/`CompilerRT` port
// lives in `ffi_body`; the draft duplicates that used to sit here were unused
// and have been removed.

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

// resolved tinycc lib dir; read by the FFI compile path. RacyCell over the
// raw C-string pointer (no concurrent writers).
pub static LIB_DIR_Z: bun_core::RacyCell<*const c_char> = bun_core::RacyCell::new(c"".as_ptr());

unsafe extern "C" {
    fn FFICallbackFunctionWrapper_destroy(_: *mut c_void);
}

impl Drop for Function {
    fn drop(&mut self) {
        // base_name, arg_types, Step::Failed.msg are owned and freed by drop glue.
        if let Some(state) = self.state.take() {
            // SAFETY: `state` is the live TCCState* allocated for this Function's
            // trampoline; ownership is unique here (taken from self).
            unsafe { TCC::State::destroy(state.as_ptr()) };
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

    pub fn ffi_header() -> &'static [u8] {
        // Embedded under
        // `codegen_embed`, reloaded from disk otherwise (dev fast iteration).
        bun_core::runtime_embed_file!(Src, "runtime/ffi/FFI.h").as_bytes()
    }
}

// ─── Step ────────────────────────────────────────────────────────────────────

pub enum Step {
    Pending,
    Compiled(Compiled),
    Failed { msg: Box<[u8]>, allocated: bool },
}

/// Draft-path sibling of `ffi_body::Compiled`; see it for JS function rooting.
pub struct Compiled {
    pub ptr: *mut c_void,
    pub js_context: Option<*mut JSGlobalObject>,
    pub ffi_callback_function_wrapper: Option<NonNull<c_void>>,
}

impl Default for Compiled {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
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

// ═════════════════════════════════════════════════════════════════════════════
// ABIType — single source of truth lives in abi_type.rs
// ═════════════════════════════════════════════════════════════════════════════
mod abi_type;
pub use abi_type::{ABI_TYPE_LABEL, ABIType, EnumMapFormatter, ToCFormatter, ToJSFormatter};
