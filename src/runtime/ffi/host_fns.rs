//! Bodies for `FFI::{open, close}` and `Function::{compile,
//! print_source_code, print_callback_source_code}` plus the
//! `generate_symbols` / `generate_symbol_for_function` helpers.
//!
//! The JSC-dependent paths are wired against the type identities declared in
//! `super` (`FFI`, `Function`, `ABIType`, `Step`, `Compiled`).

use std::ffi::c_void;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::StringArrayHashMap;
use bun_jsc::{self as jsc, JSGlobalObject, JSPropertyIterator, JSValue, JsResult};

use super::{ABIType, Function};

// ══════════════════════════════════════════════════════════════════════════
// Symbol-spec parsing — generate_symbols / generate_symbol_for_function
// ══════════════════════════════════════════════════════════════════════════

/// Parse one
/// `{ args, returns, threadsafe, ptr }` spec into a `Function`.
pub fn generate_symbol_for_function(
    global: &JSGlobalObject,
    value: JSValue,
    function: &mut Function,
) -> JsResult<Option<JSValue>> {
    jsc::mark_binding!();

    let mut abi_types: Vec<ABIType> = Vec::new();

    if let Some(args) = value.get_own(global, &bun_core::String::static_(b"args"))? {
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
                // Reject Buffer (20); only the string-label path accepts it.
                if let Some(t) = ABIType::from_int(int).filter(|_| int <= ABIType::MAX) {
                    abi_types.push(t);
                    continue;
                } else {
                    return Ok(Some(
                        global.create_error_instance(format_args!("invalid ABI type")),
                    ));
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
                // Reject Buffer (20); only the string-label path accepts it.
                if let Some(t) = ABIType::from_int(int).filter(|_| int <= ABIType::MAX) {
                    return_type = t;
                    break 'brk;
                } else {
                    return Ok(Some(
                        global.create_error_instance(format_args!("invalid ABI type")),
                    ));
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

    if threadsafe && return_type != ABIType::Void {
        return Ok(Some(global.create_error_instance(format_args!(
            "Threadsafe functions must return void"
        ))));
    }

    if threadsafe {
        for arg in abi_types.iter() {
            if matches!(arg, ABIType::NapiEnv | ABIType::NapiValue) {
                return Ok(Some(global.create_error_instance(format_args!(
                    "Threadsafe callbacks cannot accept napi_env or napi_value arguments"
                ))));
            }
        }
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
            let num = ptr.as_ptr_address();
            if num > 0 {
                function.symbol_from_dynamic_library = Some(num as *mut c_void);
            }
        } else if ptr.is_heap_big_int() {
            let num = ptr.to_uint64_no_truncate() as usize;
            if num > 0 {
                function.symbol_from_dynamic_library = Some(num as *mut c_void);
            }
        }
    }

    Ok(None)
}

/// Iterate own-properties of `object`,
/// parsing each value as a `Function` spec.
pub fn generate_symbols(
    global: &JSGlobalObject,
    symbols: &mut StringArrayHashMap<Function>,
    object: impl jsc::IntoIterObject,
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
    }

    Ok(None)
}

// ══════════════════════════════════════════════════════════════════════════
// Function — compile + C-source emission
// ══════════════════════════════════════════════════════════════════════════

impl Function {
    /// Emit the C trampoline that
    /// adapts a JSC host-call frame to the native symbol's ABI.
    pub fn print_source_code(&self, writer: &mut impl std::io::Write) -> Result<(), crate::Error> {
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
                    writeln!(
                        writer,
                        "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};",
                        i
                    )?;
                } else if arg.needs_a_cast_in_c() {
                    if i < self.arg_types.len() - 1 {
                        writeln!(
                            writer,
                            "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};",
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
                    writeln!(writer, "  int64_t arg{} = *argsPtr++;", i)?;
                } else {
                    writeln!(writer, "  int64_t arg{} = *argsPtr;", i)?;
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

            let length_buf = bun_core::fmt::print_int(&mut arg_buf[3..], i);
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
            write!(
                writer,
                "{}.asZigRepr",
                self.return_type.to_js(b"return_value")
            )?;
        } else {
            writer.write_all(b"ValueUndefined.asZigRepr")?;
        }

        writer.write_all(b";\n}\n\n")?;
        Ok(())
    }

    /// Emit the C
    /// trampoline that adapts a native call into a JSC `FFI_Callback_call`.
    pub fn print_callback_source_code(
        &self,
        global_object: Option<&JSGlobalObject>,
        context_ptr: Option<*mut c_void>,
        writer: &mut impl std::io::Write,
    ) -> Result<(), crate::Error> {
        {
            let ptr = global_object
                .map(|g| std::ptr::from_ref(g) as usize)
                .unwrap_or(0);
            writeln!(writer, "#define JS_GLOBAL_OBJECT (void*)0x{:X}ULL", ptr)?;
        }

        writer.write_all(b"#define IS_CALLBACK 1\n")?;
        if self.threadsafe {
            writer.write_all(b"#define IS_THREADSAFE 1\n")?;
        }

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
            writeln!(
                writer,
                " ZIG_REPR_TYPE arguments[{}];",
                self.arg_types.len()
            )?;

            arg_buf[0..3].copy_from_slice(b"arg");
            for (i, arg) in self.arg_types.iter().enumerate() {
                let printed = bun_core::fmt::print_int(&mut arg_buf[3..], i);
                let arg_name = &arg_buf[0..3 + printed];
                if self.threadsafe && arg.may_allocate_bigint_when_converted_to_js() {
                    // The trampoline for a threadsafe callback may run on an
                    // arbitrary OS thread. Converting a 64-bit integer here
                    // would call {U,}INT64_TO_JSVALUE_SLOW, which allocates a
                    // JSBigInt on the calling thread without the JS lock and
                    // corrupts the GC heap. Pass the raw bits through instead
                    // and let FFI_Callback_threadsafe_call convert them on the
                    // JS thread using the argTypes table emitted below.
                    writeln!(
                        writer,
                        "arguments[{}] = (ZIG_REPR_TYPE)(int64_t){};",
                        i,
                        BStr::new(arg_name)
                    )?;
                } else {
                    writeln!(
                        writer,
                        "arguments[{}] = {}.asZigRepr;",
                        i,
                        arg.to_js(arg_name)
                    )?;
                }
            }

            if self.threadsafe {
                write!(
                    writer,
                    "static const uint8_t argTypes[{}] = {{",
                    self.arg_types.len()
                )?;
                for (i, arg) in self.arg_types.iter().enumerate() {
                    if i > 0 {
                        writer.write_all(b", ")?;
                    }
                    write!(writer, "{}", *arg as i32)?;
                }
                writer.write_all(b"};\n")?;
            }
        }

        writer.write_all(b"  ")?;
        let mut inner_buf_ = [0u8; 372];

        let written = {
            let ptr = context_ptr.map(|p| p as usize).unwrap_or(0);
            let mut cursor = std::io::Cursor::new(&mut inner_buf_[1..]);
            if self.threadsafe {
                if !self.arg_types.is_empty() {
                    write!(
                        &mut cursor,
                        "FFI_Callback_call((void*)0x{:X}ULL, {}, arguments, argTypes)",
                        ptr,
                        self.arg_types.len()
                    )?;
                } else {
                    write!(
                        &mut cursor,
                        "FFI_Callback_call((void*)0x{:X}ULL, 0, (ZIG_REPR_TYPE*)0, (const uint8_t*)0)",
                        ptr
                    )?;
                }
            } else if !self.arg_types.is_empty() {
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
