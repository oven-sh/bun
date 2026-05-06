//! Un-gated bodies for `FFI::{open, close}` and `Function::{compile,
//! print_source_code, print_callback_source_code}` plus the
//! `generate_symbols` / `generate_symbol_for_function` helpers.
//!
//! These were previously preserved in the gated Phase-A draft `ffi_body.rs`
//! pending `bun_jsc` method surface. The `bun_jsc` surface (`JSValue`,
//! `JSGlobalObject`, `JSPropertyIterator`, `SystemError`, `host_fn`) is now
//! real, so the JSC-dependent paths are wired here against the type
//! identities already declared in `super` (`FFI`, `Function`, `ABIType`,
//! `Step`, `Compiled`).
//!
//! TinyCC compile/relocate (`bun_tcc_sys::State` method-ful API) remains
//! gated; `Function::compile` therefore short-circuits with a `Step::Failed`
//! when the `tinycc` feature is off (which it always is until
//! `bun_tcc_sys::tcc` un-gates). The full TCC body is preserved in
//! `ffi_body.rs` (``) for reference.

use core::ffi::c_void;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::StringArrayHashMap;
use bun_core::ZBox;
use bun_jsc::{
    self as jsc, JSGlobalObject, JSPropertyIterator, JSValue, JsResult, SystemError,
};
use bun_str::{self, ZigString};

use crate::napi::NapiEnv;

use super::{get_dl_error, ABIType, Compiled, Function, Step, FFI};

// ─── extern thin-wrappers not yet surfaced by `bun_jsc` ──────────────────────
// These are emitted by `generate-classes.ts` (`ffi.classes.ts`) and
// `JSFFIFunction.cpp`; declared locally so `open` is real without waiting on
// the codegen `.rs` output.
// TODO(port): move to `bun_jsc::codegen` once `generate-classes.ts --rs` runs.
//
// `FFI__create` / `FFIPrototype__symbolsValueSetCachedValue` are codegen
// symbols declared `callconv(jsc.conv)` in Zig and `JSC_CALLCONV` in C++ —
// i.e. `sysv64` on Windows-x64, plain C ABI everywhere else (src/jsc/jsc.zig
// `pub const conv`). Split them out so the Rust side matches on win-x64.
//
// PORT NOTE: `global` is `*const` (not `*mut`) — `JSGlobalObject` is an
// opaque ZST handle with `UnsafeCell` interior (src/jsc/lib.rs); C++ mutates
// only C++-owned storage past the ZST, so a `&JSGlobalObject`-derived pointer
// is sound and avoids `&T as *const T as *mut T` provenance laundering.
#[cfg(all(windows, target_arch = "x86_64"))]
unsafe extern "sysv64" {
    /// `JSFFI.symbolsValueSetCached` — caches `obj` on the JS wrapper so the
    /// per-symbol `JSFunction`s stay rooted.
    #[link_name = "FFIPrototype__symbolsValueSetCachedValue"]
    fn FFIPrototype__symbolsValueSetCachedValue(
        this_value: JSValue,
        global: *const JSGlobalObject,
        value: JSValue,
    );
    /// `.classes.ts` `toJS` — boxes `*mut FFI` into a freshly-allocated JSCell.
    #[link_name = "FFI__create"]
    fn FFI__create(global: *const JSGlobalObject, ptr: *mut FFI) -> JSValue;
}
#[cfg(not(all(windows, target_arch = "x86_64")))]
unsafe extern "C" {
    /// `JSFFI.symbolsValueSetCached` — caches `obj` on the JS wrapper so the
    /// per-symbol `JSFunction`s stay rooted.
    #[link_name = "FFIPrototype__symbolsValueSetCachedValue"]
    fn FFIPrototype__symbolsValueSetCachedValue(
        this_value: JSValue,
        global: *const JSGlobalObject,
        value: JSValue,
    );
    /// `.classes.ts` `toJS` — boxes `*mut FFI` into a freshly-allocated JSCell.
    #[link_name = "FFI__create"]
    fn FFI__create(global: *const JSGlobalObject, ptr: *mut FFI) -> JSValue;
}

// Plain C ABI — `Bun__CreateFFIFunctionValue` (src/jsc/host_fn.zig) and
// `ZigGlobalObject__makeNapiEnvForFFI` are declared `extern "C"` on both the
// Zig and C++ sides (no `JSC_CALLCONV`), so no sysv64 split needed.
unsafe extern "C" {
    /// `host_fn::NewRuntimeFunction` — `Bun__CreateFFIFunctionValue`.
    fn Bun__CreateFFIFunctionValue(
        global: *const JSGlobalObject,
        symbol_name: *const ZigString,
        arg_count: u32,
        function_pointer: *const c_void,
        add_ptr_property: bool,
        input_function_ptr: *mut c_void,
    ) -> JSValue;
    /// `JSGlobalObject::makeNapiEnvForFFI` — heap-allocated env owned by VM.
    fn ZigGlobalObject__makeNapiEnvForFFI(global: *const JSGlobalObject) -> *mut NapiEnv;
    /// `JSValue::getOwn` — own-property lookup (no prototype-chain walk).
    /// Declared locally while `bun_jsc::JSValue::get_own` (JSValue.rs) is gated.
    fn JSC__JSValue__getOwn(
        value: JSValue,
        global: *const JSGlobalObject,
        name: *const bun_str::String,
    ) -> JSValue;
}

/// `JSValue::getOwn` (JSValue.zig:1578) — own-property lookup. Local thin
/// wrapper while `bun_jsc::JSValue::get_own` stays gated.
#[inline]
fn get_own(value: JSValue, global: &JSGlobalObject, key: &[u8]) -> JsResult<Option<JSValue>> {
    let key_str = bun_str::String::init(ZigString::init(key));
    // SAFETY: `global` is live; `key_str` borrows `key` for the call duration.
    let v = unsafe { JSC__JSValue__getOwn(value, global, &key_str) };
    if global.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    if v.is_empty() { Ok(None) } else { Ok(Some(v)) }
}

// ══════════════════════════════════════════════════════════════════════════
// FFI methods
// ══════════════════════════════════════════════════════════════════════════

impl FFI {
    /// `FFI.close` (FFI.zig). Drops the dylib, tears down the shared TCC
    /// state, and clears the function table. The `.classes.ts` host-fn wrapper
    /// (`#[bun_jsc::host_fn(method)]`) is supplied by codegen; this is the
    /// inner body.
    pub fn close(
        &mut self,
        _global_this: &JSGlobalObject,
        _callframe: &jsc::CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if self.closed {
            return Ok(JSValue::UNDEFINED);
        }
        self.closed = true;
        if let Some(dylib) = self.dylib.take() {
            dylib.close();
        }

        if let Some(state) = self.shared_state.take() {
            // SAFETY: `state` is the live TCCState* installed by the compile
            // path; ownership is unique here (taken from self).
            unsafe { super::TCC::tcc_delete(state.as_ptr()) };
        }

        self.functions.clear_retaining_capacity();

        Ok(JSValue::UNDEFINED)
    }

    /// `FFI.getSymbols` — `.classes.ts` cached getter; the JS-visible value
    /// is the cached `symbolsValue`, so this body is unreachable in practice.
    pub fn get_symbols(&self, _global_this: &JSGlobalObject) -> JSValue {
        // This shouldn't be called. The cachedValue is what should be called.
        JSValue::UNDEFINED
    }

    /// `FFI.open` (FFI.zig:1301) — `dlopen(name)`, parse the symbol-spec
    /// object into `Function`s, JIT a JSHostFn trampoline per symbol via
    /// `Function::compile`, and return the JSCell wrapper.
    ///
    /// PORT NOTE: divergences from the Zig body while sibling crates settle:
    ///   - `ModuleLoader::resolve_embedded_file` lives in `bun_runtime::jsc_hooks`
    ///     (dep-cycle); the standalone-binary embedded-asset path is handled in
    ///     `ffi_body.rs:1386` rather than inline here.
    ///   - `Fs::FileSystem::instance().abs(..)` retry is skipped (the
    ///     `bun_resolver::fs` singleton is mid-port); error is reported on
    ///     first `dlopen` failure instead.
    ///   - `Function::compile` returns a `Step::Failed` while `bun_tcc_sys`
    ///     stays gated, so every symbol falls through to the failure arm.
    pub fn open(global: &JSGlobalObject, name_str: ZigString, object_value: JSValue) -> JSValue {
        if !bun_core::Environment::ENABLE_TINYCC {
            let _ = global.throw(format_args!(
                "bun:ffi dlopen() is not available in this build (TinyCC is disabled)"
            ));
            return JSValue::ZERO;
        }
        jsc::mark_binding!();
        let name_slice = name_str.to_slice();
        let name: &[u8] = name_slice.slice();

        if object_value.is_empty_or_undefined_or_null() || !object_value.is_object() {
            return invalid_options_arg(global);
        }

        // TODO(b2): `ModuleLoader::resolve_embedded_file` — once its body is
        // real, resolve `name` against the standalone-module graph here
        // (FFI.zig:1380-1404).

        if name.is_empty() {
            return global.create_error_instance(format_args!("Invalid library name"));
        }

        let mut symbols = StringArrayHashMap::<Function>::default();
        match generate_symbols(global, &mut symbols, object_value) {
            Ok(None) => {}
            Ok(Some(val)) => return val,
            Err(_) => return JSValue::ZERO,
        }
        if symbols.len() == 0 {
            return global
                .create_error_instance(format_args!("Expected at least one symbol"));
        }

        let dylib: bun_sys::DynLib = match bun_sys::DynLib::open(name) {
            Ok(d) => d,
            Err(_) => {
                // TODO(b2): retry against `Fs::FileSystem::instance().abs(&[name])`
                // (FFI.zig:1425) once `bun_resolver::fs` is wired.
                let dlerror_buf = get_dl_error().ok();
                let dlerror_msg: &[u8] = dlerror_buf.as_deref().unwrap_or(b"unknown error");

                let mut msg = Vec::new();
                let _ = write!(
                    &mut msg,
                    "Failed to open library \"{}\": {}",
                    BStr::new(name),
                    BStr::new(dlerror_msg)
                );
                let system_error = SystemError {
                    errno: 0,
                    code: bun_str::String::clone_utf8(b"ERR_DLOPEN_FAILED"),
                    message: bun_str::String::clone_utf8(&msg),
                    syscall: bun_str::String::clone_utf8(b"dlopen"),
                    path: bun_str::String::EMPTY,
                    hostname: bun_str::String::EMPTY,
                    fd: -1,
                    dest: bun_str::String::EMPTY,
                };
                return system_error.to_error_instance(global);
            }
        };

        let mut size = symbols.len();
        if size >= 63 {
            size = 0;
        }
        let obj = JSValue::create_empty_object(global, size);
        obj.protect();
        let _obj_guard = scopeguard::guard((), |_| obj.unprotect());

        let napi_env = make_napi_env_if_needed(symbols.values(), global);

        for function in symbols.values_mut() {
            // PORT NOTE: reshaped for borrowck — copy `base_name` bytes so the
            // `&function` borrow is dropped before the `&mut function` writes.
            let function_name: ZBox = {
                let mut v = function
                    .base_name
                    .as_ref()
                    .map(|b| b.as_bytes().to_vec())
                    .unwrap_or_default();
                v.push(0);
                ZBox::from_vec_with_nul(v)
            };

            // optional if the user passed "ptr"
            if function.symbol_from_dynamic_library.is_none() {
                let resolved_symbol =
                    dylib.lookup::<*mut c_void>(function_name.as_zstr());
                let Some(resolved_symbol) = resolved_symbol else {
                    let ret = global.create_error_instance(format_args!(
                        "Symbol \"{}\" not found in \"{}\"",
                        BStr::new(function_name.as_bytes()),
                        BStr::new(name)
                    ));
                    // symbols freed by Drop
                    dylib.close();
                    return ret;
                };
                function.symbol_from_dynamic_library = Some(resolved_symbol);
            }

            if let Err(err) = function.compile(napi_env) {
                let ret = global.create_error_instance(format_args!(
                    "{} when compiling symbol \"{}\" in \"{}\"",
                    err,
                    BStr::new(function_name.as_bytes()),
                    BStr::new(name)
                ));
                dylib.close();
                return ret;
            }
            match &mut function.step {
                Step::Failed { msg, .. } => {
                    let res = global
                        .create_error_instance(format_args!("{}", BStr::new(msg)));
                    dylib.close();
                    return res;
                }
                Step::Pending => {
                    dylib.close();
                    return global.create_error_instance(format_args!(
                        "Failed to compile (nothing happend!)"
                    ));
                }
                Step::Compiled(compiled) => {
                    let str = ZigString::init(function_name.as_bytes());
                    // SAFETY: `global` is a live opaque JSC handle (ZST;
                    // interior owned by C++). `compiled.ptr` is a valid
                    // JSHostFn entry point emitted by TCC;
                    // `Bun__CreateFFIFunctionValue` accepts it as an opaque
                    // `*const c_void` and casts internally.
                    let cb = unsafe {
                        Bun__CreateFFIFunctionValue(
                            global,
                            &str,
                            function.arg_types.len() as u32,
                            compiled.ptr as *const c_void,
                            true,
                            function
                                .symbol_from_dynamic_library
                                .unwrap_or(core::ptr::null_mut()),
                        )
                    };
                    compiled.js_function = cb;
                    obj.put(global, function_name.as_bytes(), cb);
                }
            }
        }

        let lib = Box::into_raw(Box::new(FFI {
            dylib: Some(dylib),
            functions: symbols,
            ..Default::default()
        }));

        // SAFETY: `global` is a live opaque JSC handle (ZST; interior owned by
        // C++). `lib` is a freshly-leaked `Box<FFI>`; ownership transfers to
        // the JS wrapper (freed in `FFI::finalize`).
        let js_object = unsafe { FFI__create(global, lib) };
        // SAFETY: `global` as above. `js_object` is the wrapper just created;
        // `obj` is rooted by `protect()` for the call duration.
        unsafe { FFIPrototype__symbolsValueSetCachedValue(js_object, global, obj) };
        js_object
    }
}

// ══════════════════════════════════════════════════════════════════════════
// Symbol-spec parsing — generate_symbols / generate_symbol_for_function
// ══════════════════════════════════════════════════════════════════════════

/// Creates an Exception object indicating that options object is invalid.
/// The exception is not thrown on the VM.
#[inline]
fn invalid_options_arg(global: &JSGlobalObject) -> JSValue {
    global.create_error_instance(format_args!(
        "Expected an options object with symbol names"
    ))
}

/// `FFI.generateSymbolForFunction` (FFI.zig:1518) — parse one
/// `{ args, returns, threadsafe, ptr }` spec into a `Function`.
pub fn generate_symbol_for_function(
    global: &JSGlobalObject,
    value: JSValue,
    function: &mut Function,
) -> JsResult<Option<JSValue>> {
    jsc::mark_binding!();

    let mut abi_types: Vec<ABIType> = Vec::new();

    if let Some(args) = get_own(value, global, b"args")? {
        if args.is_empty_or_undefined_or_null() || !args.js_type().is_array() {
            return Ok(Some(global.create_error_instance(format_args!(
                "Expected an object with \"args\" as an array"
            ))));
        }

        let mut array = args.array_iterator(global)?;
        abi_types.reserve_exact(array.len as usize);
        while let Some(val) = array.next()? {
            if val.is_empty_or_undefined_or_null() {
                return Ok(Some(global.create_error_instance(format_args!(
                    "param must be a string (type name) or number"
                ))));
            }

            if val.is_any_int() {
                let int = val.to_int32();
                if (0..=ABIType::MAX).contains(&int) {
                    // SAFETY: range-checked above; ABIType is #[repr(i32)]
                    abi_types.push(unsafe { core::mem::transmute::<i32, ABIType>(int) });
                    // PERF(port): was appendAssumeCapacity
                    continue;
                } else {
                    return Ok(Some(global.create_error_instance(format_args!(
                        "invalid ABI type"
                    ))));
                }
            }

            if !val.js_type().is_string_like() {
                return Ok(Some(global.create_error_instance(format_args!(
                    "param must be a string (type name) or number"
                ))));
            }

            let type_name = val.to_slice(global)?;
            let Some(abi) = ABIType::LABEL.get(type_name.slice()).copied() else {
                return Ok(Some(global.create_type_error_instance(format_args!(
                    "Unknown type {}",
                    BStr::new(type_name.slice())
                ))));
            };
            abi_types.push(abi);
            // PERF(port): was appendAssumeCapacity
        }
    }

    let mut return_type = ABIType::Void;
    let mut threadsafe = false;

    if let Some(threadsafe_value) = value.get_truthy(global, b"threadsafe")? {
        threadsafe = threadsafe_value.to_boolean();
    }

    'brk: {
        if let Some(ret_value) = value.get_truthy(global, b"returns")? {
            if ret_value.is_any_int() {
                let int = ret_value.to_int32();
                if (0..=ABIType::MAX).contains(&int) {
                    // SAFETY: range-checked above; ABIType is #[repr(i32)]
                    return_type = unsafe { core::mem::transmute::<i32, ABIType>(int) };
                    break 'brk;
                } else {
                    return Ok(Some(global.create_error_instance(format_args!(
                        "invalid ABI type"
                    ))));
                }
            }

            let ret_slice = ret_value.to_slice(global)?;
            return_type = match ABIType::LABEL.get(ret_slice.slice()).copied() {
                Some(t) => t,
                None => {
                    return Ok(Some(global.create_type_error_instance(format_args!(
                        "Unknown return type {}",
                        BStr::new(ret_slice.slice())
                    ))));
                }
            };
        }
    }

    if return_type == ABIType::NapiEnv {
        return Ok(Some(global.create_error_instance(format_args!(
            "Cannot return napi_env to JavaScript"
        ))));
    }

    if return_type == ABIType::Buffer {
        return Ok(Some(global.create_error_instance(format_args!(
            "Cannot return a buffer to JavaScript (since byteLength and byteOffset are unknown)"
        ))));
    }

    if function.threadsafe && return_type != ABIType::Void {
        return Ok(Some(global.create_error_instance(format_args!(
            "Threadsafe functions must return void"
        ))));
    }

    // `Function` has a `Drop` impl, so functional-record-update
    // (`..Default::default()`) is rejected (E0509). Reset to default and assign
    // the parsed fields individually instead.
    *function = Function::default();
    function.arg_types = abi_types;
    function.return_type = return_type;
    function.threadsafe = threadsafe;

    if let Some(ptr) = value.get(global, b"ptr")? {
        if ptr.is_number() {
            // PORT NOTE: `as_ptr_address` is gated; `from_ptr_address` encodes
            // the addr as a JS double, so `as_number() as usize` recovers it
            // losslessly for the 48-bit address ranges in practice.
            let num = ptr.as_number() as usize;
            if num > 0 {
                function.symbol_from_dynamic_library = Some(num as *mut c_void);
            }
        }
        // TODO(b2): `is_heap_big_int` / `to_uint64_no_truncate` path — gated in
        // `bun_jsc::JSValue` (lib.rs `_gated` block).
    }

    Ok(None)
}

/// `FFI.generateSymbols` (FFI.zig:1662) — iterate own-properties of `object`,
/// parsing each value as a `Function` spec.
pub fn generate_symbols(
    global: &JSGlobalObject,
    symbols: &mut StringArrayHashMap<Function>,
    object: JSValue,
) -> JsResult<Option<JSValue>> {
    jsc::mark_binding!();

    // skip_empty_name = true, include_value = true, own_only = true
    let mut symbols_iter = JSPropertyIterator::init(
        global,
        object,
        jsc::JSPropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
            own_properties_only: true,
            ..Default::default()
        },
    )?;

    symbols.reserve(symbols_iter.len);

    while let Some(prop) = symbols_iter.next()? {
        let value = symbols_iter.value;

        if value.is_empty_or_undefined_or_null() || !value.is_object() {
            return Ok(Some(global.create_type_error_instance(format_args!(
                "Expected an object for key \"{}\"",
                prop
            ))));
        }

        let mut function = Function::default();
        if let Some(val) = generate_symbol_for_function(global, value, &mut function)? {
            return Ok(Some(val));
        }
        let base_name = prop.to_owned_slice_z();
        let key = base_name.as_bytes().to_vec().into_boxed_slice();
        function.base_name = Some(base_name);

        symbols.insert(&key, function);
        // PERF(port): was putAssumeCapacity
    }

    Ok(None)
}

// ══════════════════════════════════════════════════════════════════════════
// Function — compile + C-source emission
// ══════════════════════════════════════════════════════════════════════════

impl Function {
    /// `Function.compile` (FFI.zig:1769). Prints the C trampoline source,
    /// compiles + relocates it via TinyCC, and stores the resulting
    /// `JSFunctionCall` symbol address in `self.step`.
    ///
    /// `bun_tcc_sys::tcc` (the method-ful `State` API) is still gated, so
    /// this body short-circuits to `Step::Failed` after generating the
    /// source. The full TCC sequence (`State::init` → `add_symbol` →
    /// `compile_string` → `relocate` → `get_symbol`) is preserved verbatim
    /// in `ffi_body.rs:1940-2024` and re-enables once `bun_tcc_sys` un-gates.
    pub fn compile(&mut self, _napi_env: Option<&NapiEnv>) -> Result<(), bun_core::Error> {
        let mut source_code: Vec<u8> = Vec::new();
        self.print_source_code(&mut source_code)?;
        source_code.push(0);

        // TODO(b2-blocked): bun_tcc_sys::State (compile/relocate/add_symbol/get_symbol)
        //   — un-gate from `ffi_body.rs` once `bun_tcc_sys::tcc` is real.
        let _ = source_code;
        self.fail(b"TinyCC is not available in this build of Bun");
        Ok(())
    }

    /// `Function.printSourceCode` (FFI.zig:2007) — emit the C trampoline that
    /// adapts a JSC host-call frame to the native symbol's ABI.
    pub fn print_source_code(
        &self,
        writer: &mut impl std::io::Write,
    ) -> Result<(), bun_core::Error> {
        if !self.arg_types.is_empty() {
            writer.write_all(b"#define HAS_ARGUMENTS\n")?;
        }

        'brk: {
            if self.return_type.is_floating_point() {
                writer.write_all(b"#define USES_FLOAT 1\n")?;
                break 'brk;
            }
            for arg in self.arg_types.iter() {
                // conditionally include math.h
                if arg.is_floating_point() {
                    writer.write_all(b"#define USES_FLOAT 1\n")?;
                    break;
                }
            }
        }

        writer.write_all(Self::ffi_header())?;

        // -- Generate the FFI function symbol
        writer.write_all(b"/* --- The Function To Call */\n")?;
        self.return_type.typename(writer)?;
        writer.write_all(b" ")?;
        writer.write_all(self.base_name.as_ref().map(|b| b.as_bytes()).unwrap_or(b""))?;
        writer.write_all(b"(")?;
        let mut first = true;
        for (i, arg) in self.arg_types.iter().enumerate() {
            if !first {
                writer.write_all(b", ")?;
            }
            first = false;
            arg.param_typename(writer)?;
            write!(writer, " arg{}", i)?;
        }
        writer.write_all(
            b");\n\
              \n\
              /* ---- Your Wrapper Function ---- */\n\
              ZIG_REPR_TYPE JSFunctionCall(void* JS_GLOBAL_OBJECT, void* callFrame) {\n",
        )?;

        if self.needs_handle_scope() {
            writer.write_all(
                b"  void* handleScope = NapiHandleScope__open(&Bun__thisFFIModuleNapiEnv, false);\n",
            )?;
        }

        if !self.arg_types.is_empty() {
            writer.write_all(b"  LOAD_ARGUMENTS_FROM_CALL_FRAME;\n")?;
            for (i, arg) in self.arg_types.iter().enumerate() {
                if *arg == ABIType::NapiEnv {
                    write!(
                        writer,
                        "  napi_env arg{} = (napi_env)&Bun__thisFFIModuleNapiEnv;\n  argsPtr++;\n",
                        i
                    )?;
                } else if *arg == ABIType::NapiValue {
                    write!(
                        writer,
                        "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};\n",
                        i
                    )?;
                } else if arg.needs_a_cast_in_c() {
                    if i < self.arg_types.len() - 1 {
                        write!(
                            writer,
                            "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};\n",
                            i
                        )?;
                    } else {
                        write!(
                            writer,
                            "  EncodedJSValue arg{};\n  arg{}.asInt64 = *argsPtr;\n",
                            i, i
                        )?;
                    }
                } else if i < self.arg_types.len() - 1 {
                    write!(writer, "  int64_t arg{} = *argsPtr++;\n", i)?;
                } else {
                    write!(writer, "  int64_t arg{} = *argsPtr;\n", i)?;
                }
            }
        }

        let mut arg_buf = [0u8; 32];

        writer.write_all(b"    ")?;
        if self.return_type != ABIType::Void {
            self.return_type.typename(writer)?;
            writer.write_all(b" return_value = ")?;
        }
        write!(
            writer,
            "{}(",
            BStr::new(self.base_name.as_ref().map(|b| b.as_bytes()).unwrap_or(b""))
        )?;
        first = true;
        arg_buf[0..3].copy_from_slice(b"arg");
        for (i, arg) in self.arg_types.iter().enumerate() {
            if !first {
                writer.write_all(b", ")?;
            }
            first = false;
            writer.write_all(b"    ")?;

            let length_buf = {
                let mut cursor = std::io::Cursor::new(&mut arg_buf[3..]);
                let _ = write!(&mut cursor, "{}", i);
                cursor.position() as usize
            };
            let arg_name = &arg_buf[0..3 + length_buf];
            if arg.needs_a_cast_in_c() {
                write!(writer, "{}", arg.to_c(arg_name))?;
            } else {
                writer.write_all(arg_name)?;
            }
        }
        writer.write_all(b");\n")?;

        if !first {
            writer.write_all(b"\n")?;
        }

        writer.write_all(b"    ")?;

        if self.needs_handle_scope() {
            writer.write_all(
                b"  NapiHandleScope__close(&Bun__thisFFIModuleNapiEnv, handleScope);\n",
            )?;
        }

        writer.write_all(b"return ")?;

        if self.return_type != ABIType::Void {
            write!(writer, "{}.asZigRepr", self.return_type.to_js(b"return_value"))?;
        } else {
            writer.write_all(b"ValueUndefined.asZigRepr")?;
        }

        writer.write_all(b";\n}\n\n")?;
        Ok(())
    }

    /// `Function.printCallbackSourceCode` (FFI.zig:2170) — emit the C
    /// trampoline that adapts a native call into a JSC `FFI_Callback_call`.
    pub fn print_callback_source_code(
        &self,
        global_object: Option<&JSGlobalObject>,
        context_ptr: Option<*mut c_void>,
        writer: &mut impl std::io::Write,
    ) -> Result<(), bun_core::Error> {
        {
            let ptr = global_object.map(|g| g as *const _ as usize).unwrap_or(0);
            write!(writer, "#define JS_GLOBAL_OBJECT (void*)0x{:X}ULL\n", ptr)?;
        }

        writer.write_all(b"#define IS_CALLBACK 1\n")?;

        'brk: {
            if self.return_type.is_floating_point() {
                writer.write_all(b"#define USES_FLOAT 1\n")?;
                break 'brk;
            }
            for arg in self.arg_types.iter() {
                if arg.is_floating_point() {
                    writer.write_all(b"#define USES_FLOAT 1\n")?;
                    break;
                }
            }
        }

        writer.write_all(Self::ffi_header())?;

        // -- Generate the FFI function symbol
        writer.write_all(b"\n \n/* --- The Callback Function */\n")?;
        let mut first = true;
        self.return_type.typename(writer)?;

        writer.write_all(b" my_callback_function")?;
        writer.write_all(b"(")?;
        for (i, arg) in self.arg_types.iter().enumerate() {
            if !first {
                writer.write_all(b", ")?;
            }
            first = false;
            arg.typename(writer)?;
            write!(writer, " arg{}", i)?;
        }
        writer.write_all(b") {\n")?;

        if cfg!(debug_assertions) {
            writer.write_all(b"#ifdef INJECT_BEFORE\n")?;
            writer.write_all(b"INJECT_BEFORE;\n")?;
            writer.write_all(b"#endif\n")?;
        }

        first = true;
        let _ = first;

        if !self.arg_types.is_empty() {
            let mut arg_buf = [0u8; 32];
            write!(writer, " ZIG_REPR_TYPE arguments[{}];\n", self.arg_types.len())?;

            arg_buf[0..3].copy_from_slice(b"arg");
            for (i, arg) in self.arg_types.iter().enumerate() {
                let printed = {
                    let mut cursor = std::io::Cursor::new(&mut arg_buf[3..]);
                    let _ = write!(&mut cursor, "{}", i);
                    cursor.position() as usize
                };
                let arg_name = &arg_buf[0..3 + printed];
                write!(
                    writer,
                    "arguments[{}] = {}.asZigRepr;\n",
                    i,
                    arg.to_js(arg_name)
                )?;
            }
        }

        writer.write_all(b"  ")?;
        let mut inner_buf_ = [0u8; 372];

        let written = {
            let ptr = context_ptr.map(|p| p as usize).unwrap_or(0);
            let mut cursor = std::io::Cursor::new(&mut inner_buf_[1..]);
            if !self.arg_types.is_empty() {
                write!(
                    &mut cursor,
                    "FFI_Callback_call((void*)0x{:X}ULL, {}, arguments)",
                    ptr,
                    self.arg_types.len()
                )?;
            } else {
                write!(
                    &mut cursor,
                    "FFI_Callback_call((void*)0x{:X}ULL, 0, (ZIG_REPR_TYPE*)0)",
                    ptr
                )?;
            }
            cursor.position() as usize
        };

        if self.return_type == ABIType::Void {
            writer.write_all(&inner_buf_[1..1 + written])?;
        } else {
            inner_buf_[0] = b'_';
            let inner_buf = &inner_buf_[0..1 + written];
            write!(writer, "return {}", self.return_type.to_c_exact(inner_buf))?;
        }

        writer.write_all(b";\n}\n\n")?;
        Ok(())
    }
}

// ══════════════════════════════════════════════════════════════════════════
// NAPI env helper
// ══════════════════════════════════════════════════════════════════════════

/// Allocates a `NapiEnv` only if any `Function` in the set takes a
/// `napi_env`/`napi_value` argument.
pub(super) fn make_napi_env_if_needed<'a>(
    functions: impl IntoIterator<Item = &'a Function>,
    global_this: &JSGlobalObject,
) -> Option<&'static NapiEnv> {
    for function in functions {
        if function.needs_napi_env() {
            // SAFETY: C++ returns a non-null heap-allocated env owned by the
            // VM (lifetime ≥ DevServer/FFI lifetime).
            // TODO(port): lifetime — `'static` is a stand-in for VM lifetime.
            return Some(unsafe { &*ZigGlobalObject__makeNapiEnvForFFI(global_this) });
        }
    }
    None
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/ffi/FFI.zig (open/close/compile + symbol parsing)
//   confidence: medium (B-2 second-pass un-gate)
//   notes:      JSC host-fn entry points real; TinyCC compile body still
//               blocked on `bun_tcc_sys::tcc` (gated). `link_symbols`,
//               `callback`, `cc` remain in `ffi_body.rs` (heavy CompileC dep).
// ──────────────────────────────────────────────────────────────────────────
