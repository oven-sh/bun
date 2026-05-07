use core::ffi::{c_char, c_void};
use core::fmt::Arguments;
use core::marker::{PhantomData, PhantomPinned};

use crate::error_code::ErrorBuilder;
use crate::virtual_machine::VirtualMachine;
use crate::DOMExceptionCode;
use crate::Error as JscError; // jsc.Error (ErrorCode enum)
use crate::{
    CommonStrings, ErrorableString, Exception, JSValue, JsError, JsResult, StringJsc, ZigStringJsc,
    MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, VM,
};

use bun_core::{fmt as bun_fmt, perf, StackCheck};
use bun_string::{strings, String as BunString};
use crate::zig_string::ZigString;

// ──────────────────────────────────────────────────────────────────────────────
// Opaque FFI handle (Nomicon pattern; !Send + !Sync + !Unpin).
//
// `UnsafeCell` opts the (zero) bytes out of the noalias/readonly guarantee so
// `&JSGlobalObject → *mut JSGlobalObject` (and any C++ write behind it) is
// sound under Stacked Borrows. Rust never reads or writes these bytes
// directly; all access is via FFI.
// ──────────────────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct JSGlobalObject {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl JSGlobalObject {
    /// Raw `*mut JSGlobalObject` for FFI. Sound for callees that mutate: the
    /// `UnsafeCell` field gives `&self` interior-mutable provenance, so the
    /// returned pointer carries write permission without laundering a
    /// read-only borrow.
    #[inline(always)]
    pub fn as_mut_ptr(&self) -> *mut JSGlobalObject {
        self._p.get() as *mut JSGlobalObject
    }

    /// Alias of [`as_mut_ptr`] kept for call-site readability where mutation
    /// is not the intent (Zig passes `*JSGlobalObject` everywhere).
    #[inline(always)]
    pub fn as_ptr(&self) -> *mut JSGlobalObject {
        self.as_mut_ptr()
    }

    // TODO(port): `allocator()` returned `std.mem.Allocator` (this.bunVM().allocator).
    // Allocator params are deleted in Rust (global mimalloc); keep as no-op accessor
    // only if a caller still needs the VM's allocator handle.
    #[inline]
    pub fn allocator(&self) {
        // intentionally no-op; callers should use the global allocator.
    }

    pub fn throw_stack_overflow(&self) -> JsError {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__throwStackOverflow(self) };
        JsError::Thrown
    }

    pub fn throw_out_of_memory(&self) -> JsError {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__throwOutOfMemoryError(self) };
        JsError::Thrown
    }

    pub fn create_out_of_memory_error(&self) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__createOutOfMemoryError(self) }
    }

    pub fn throw_out_of_memory_value(&self) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__throwOutOfMemoryError(self) };
        JSValue::ZERO
    }

    pub fn gregorian_date_time_to_ms(
        &self,
        year: i32,
        month: i32,
        day: i32,
        hour: i32,
        minute: i32,
        second: i32,
        millisecond: i32,
    ) -> JsResult<f64> {
        crate::mark_binding();
        // TODO(port): move to jsc_sys
        // C++ `Bun__gregorianDateTimeToMS` is `[[ZIG_EXPORT(check_slow)]]`; the Zig codegen
        // wrapper checks for a pending exception and returns `error.JSError`. Route through
        // `from_js_host_call_generic` so a thrown exception surfaces as `Err(JsError::Thrown)`.
        // SAFETY: FFI — &self is a valid JSGlobalObject*; all integer args are by value.
        crate::from_js_host_call_generic(self, || unsafe {
            Bun__gregorianDateTimeToMS(self, year, month, day, hour, minute, second, millisecond, true)
        })
    }

    pub fn gregorian_date_time_to_ms_utc(
        &self,
        year: i32,
        month: i32,
        day: i32,
        hour: i32,
        minute: i32,
        second: i32,
        millisecond: i32,
    ) -> JsResult<f64> {
        crate::mark_binding();
        // SAFETY: FFI — &self is a valid JSGlobalObject*; all integer args are by value.
        crate::from_js_host_call_generic(self, || unsafe {
            Bun__gregorianDateTimeToMS(self, year, month, day, hour, minute, second, millisecond, false)
        })
    }

    pub fn ms_to_gregorian_date_time_utc(&self, ms: f64) -> GregorianDateTime {
        crate::mark_binding();
        let mut dt = GregorianDateTime {
            year: 0,
            month: 0,
            day: 0,
            hour: 0,
            minute: 0,
            second: 0,
            weekday: 0,
        };
        // SAFETY: FFI — &self is a valid JSGlobalObject*; out-param pointers are to live
        // stack locals (`dt` fields) and remain valid for the duration of the call.
        unsafe {
            Bun__msToGregorianDateTime(
                self,
                ms,
                false,
                &mut dt.year,
                &mut dt.month,
                &mut dt.day,
                &mut dt.hour,
                &mut dt.minute,
                &mut dt.second,
                &mut dt.weekday,
            );
        }
        dt
    }

    pub fn throw_todo(&self, msg: &[u8]) -> JsError {
        let err = self.create_error_instance(format_args!("{}", bstr::BStr::new(msg)));
        if err.is_empty() {
            debug_assert!(self.has_exception());
            return JsError::Thrown;
        }
        // TODO(port): `toJS` on bun.String is fallible (`catch return error.JSError`).
        let name_value = match BunString::static_str("TODOError").to_js(self) {
            Ok(v) => v,
            Err(_) => return JsError::Thrown,
        };
        err.put(self, b"name", name_value);
        self.throw_value(err)
    }

    #[inline]
    pub fn request_termination(&self) {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__requestTermination(self) }
    }

    #[inline]
    pub fn clear_termination_exception(&self) {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__clearTerminationException(self) }
    }

    pub fn set_time_zone(&self, time_zone: &ZigString) -> bool {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `time_zone` borrow outlives the call.
        unsafe { JSGlobalObject__setTimeZone(self, time_zone) }
    }

    #[inline]
    pub fn to_js_value(&self) -> JSValue {
        // SAFETY: JSValue is #[repr(transparent)] i64; encoding a cell pointer as
        // a JSValue is the same operation Zig's `@enumFromInt(@intFromPtr(globalThis))`
        // performs.
        unsafe { core::mem::transmute::<i64, JSValue>(self as *const Self as i64) }
    }

    pub fn throw_invalid_arguments(&self, args: Arguments<'_>) -> JsError {
        let err = self.to_invalid_arguments(args);
        self.throw_value(err)
    }

    #[inline]
    pub fn throw_missing_arguments_value(&self, arg_names: &[&str]) -> JsError {
        // PORT NOTE: Zig version is comptime over `arg_names.len` (0/4+ => @compileError).
        // Runtime panic stands in for the compile-time check.
        match arg_names.len() {
            0 => panic!("requires at least one argument"),
            1 => self
                .err(JscError::MISSING_ARGS, format_args!("The \"{}\" argument must be specified", arg_names[0]))
                .throw(),
            2 => self
                .err(
                    JscError::MISSING_ARGS,
                    format_args!(
                        "The \"{}\" and \"{}\" arguments must be specified",
                        arg_names[0], arg_names[1]
                    ),
                )
                .throw(),
            3 => self
                .err(
                    JscError::MISSING_ARGS,
                    format_args!(
                        "The \"{}\", \"{}\", and \"{}\" arguments must be specified",
                        arg_names[0], arg_names[1], arg_names[2]
                    ),
                )
                .throw(),
            _ => panic!("implement this message"),
        }
    }

    /// "Expected {field} to be a {typename} for '{name}'."
    pub fn create_invalid_argument_type(
        &self,
        name_: &'static str,
        field: &'static str,
        typename: &'static str,
    ) -> JSValue {
        // TODO(port): Zig used std.fmt.comptimePrint here; const_format::formatcp!
        // requires the literals at the macro callsite, so we format at runtime.
        self.err(
            JscError::INVALID_ARG_TYPE,
            format_args!("Expected {} to be a {} for '{}'.", field, typename, name_),
        )
        .to_js()
    }

    /// Generic value→JSValue conversion. Zig's `JSValue.fromAny` reflects over
    /// `@TypeOf(value)`; in Rust the supported set is whatever implements
    /// `Into<JSValue>` (numbers, bools, JSValue itself). Struct/array reflection
    /// goes through `JSObject::create` per type.
    // TODO(port): widen via a `ToJsValue` trait once `JSValue::from_any` is fully ported.
    pub fn to_js<T: Into<JSValue>>(&self, value: T) -> JsResult<JSValue> {
        let _ = self; // global only needed for non-primitive paths in the Zig version.
        Ok(value.into())
    }

    /// "Expected {field} to be a {typename} for '{name}'."
    pub fn throw_invalid_argument_type(
        &self,
        name_: &'static str,
        field: &'static str,
        typename: &'static str,
    ) -> JsError {
        self.throw_value(self.create_invalid_argument_type(name_, field, typename))
    }

    /// "The {argname} argument is invalid. Received {value}"
    pub fn throw_invalid_argument_value(&self, argname: &[u8], value: JSValue) -> JsError {
        let actual_string_value = match Self::determine_specific_type(self, value) {
            Ok(s) => s,
            Err(e) => return e,
        };
        // `defer actual_string_value.deref()` → handled by Drop on bun_str::String.
        self.err(
            JscError::INVALID_ARG_VALUE,
            format_args!(
                "The \"{}\" argument is invalid. Received {}",
                bstr::BStr::new(argname),
                actual_string_value
            ),
        )
        .throw()
    }

    pub fn throw_invalid_argument_value_custom(
        &self,
        argname: &[u8],
        value: JSValue,
        message: &[u8],
    ) -> JsError {
        let actual_string_value = match Self::determine_specific_type(self, value) {
            Ok(s) => s,
            Err(e) => return e,
        };
        self.err(
            JscError::INVALID_ARG_VALUE,
            format_args!(
                "The \"{}\" argument {}. Received {}",
                bstr::BStr::new(argname),
                bstr::BStr::new(message),
                actual_string_value
            ),
        )
        .throw()
    }

    /// Throw an `ERR_INVALID_ARG_VALUE` when the invalid value is a property of an object.
    /// Message depends on whether `expected` is present.
    /// - "The property "{argname}" is invalid. Received {value}"
    /// - "The property "{argname}" is invalid. Expected {expected}, received {value}"
    pub fn throw_invalid_argument_property_value(
        &self,
        argname: &[u8],
        expected: Option<&'static str>,
        value: JSValue,
    ) -> JsError {
        let actual_string_value = match Self::determine_specific_type(self, value) {
            Ok(s) => s,
            Err(e) => return e,
        };
        if let Some(expected) = expected {
            self.err(
                JscError::INVALID_ARG_VALUE,
                format_args!(
                    "The property \"{}\" is invalid. Expected {}, received {}",
                    bstr::BStr::new(argname),
                    expected,
                    actual_string_value
                ),
            )
            .throw()
        } else {
            self.err(
                JscError::INVALID_ARG_VALUE,
                format_args!(
                    "The property \"{}\" is invalid. Received {}",
                    bstr::BStr::new(argname),
                    actual_string_value
                ),
            )
            .throw()
        }
    }

    pub fn determine_specific_type(global: &Self, value: JSValue) -> JsResult<BunString> {
        // SAFETY: FFI — `global` is a valid JSGlobalObject*; JSValue is passed by value.
        let str = unsafe { Bun__ErrorCode__determineSpecificType(global, value) };
        // errdefer str.deref() → Drop on BunString handles this on the error path.
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(str)
    }

    pub fn throw_incompatible_option_pair(&self, opt1: &[u8], opt2: &[u8]) -> JsError {
        self.err(
            JscError::INCOMPATIBLE_OPTION_PAIR,
            format_args!(
                "Option \"{}\" cannot be used in combination with option \"{}\"",
                bstr::BStr::new(opt1),
                bstr::BStr::new(opt2)
            ),
        )
        .throw()
    }

    pub fn throw_invalid_scrypt_params(&self) -> JsError {
        // SAFETY: FFI — BoringSSL error queue is thread-local; no preconditions.
        let err = unsafe { bun_boringssl::c::ERR_peek_last_error() };
        if err != 0 {
            let mut buf = [0u8; 256];
            // SAFETY: FFI — `buf` is a 256-byte stack buffer; `len` matches its capacity;
            // ERR_error_string_n NUL-terminates within `len` bytes and returns `buf`.
            let msg_ptr = unsafe {
                bun_boringssl::c::ERR_error_string_n(err, buf.as_mut_ptr() as *mut c_char, buf.len())
            };
            // SAFETY: ERR_error_string_n returns a NUL-terminated string inside `buf`
            // (or a static empty string); valid for CStr::from_ptr.
            let msg = unsafe { core::ffi::CStr::from_ptr(msg_ptr) };
            return self
                .err(
                    JscError::CRYPTO_INVALID_SCRYPT_PARAMS,
                    format_args!("Invalid scrypt params: {}", bstr::BStr::new(msg.to_bytes())),
                )
                .throw();
        }

        self.err(JscError::CRYPTO_INVALID_SCRYPT_PARAMS, format_args!("Invalid scrypt params"))
            .throw()
    }

    /// "The {argname} argument must be of type {typename}. Received {value}"
    pub fn throw_invalid_argument_type_value(
        &self,
        argname: &[u8],
        typename: &[u8],
        value: JSValue,
    ) -> JsError {
        let actual_string_value = match Self::determine_specific_type(self, value) {
            Ok(s) => s,
            Err(e) => return e,
        };
        self.err(
            JscError::INVALID_ARG_TYPE,
            format_args!(
                "The \"{}\" argument must be of type {}. Received {}",
                bstr::BStr::new(argname),
                bstr::BStr::new(typename),
                actual_string_value
            ),
        )
        .throw()
    }

    pub fn throw_invalid_argument_type_value2(
        &self,
        argname: &[u8],
        typename: &[u8],
        value: JSValue,
    ) -> JsError {
        let actual_string_value = match Self::determine_specific_type(self, value) {
            Ok(s) => s,
            Err(e) => return e,
        };
        self.err(
            JscError::INVALID_ARG_TYPE,
            format_args!(
                "The \"{}\" argument must be {}. Received {}",
                bstr::BStr::new(argname),
                bstr::BStr::new(typename),
                actual_string_value
            ),
        )
        .throw()
    }

    /// "The <argname> argument must be one of type <typename>. Received <value>"
    pub fn throw_invalid_argument_type_value_one_of(
        &self,
        argname: &[u8],
        typename: &[u8],
        value: JSValue,
    ) -> JsError {
        let actual_string_value = match Self::determine_specific_type(self, value) {
            Ok(s) => s,
            Err(e) => return e,
        };
        self.err(
            JscError::INVALID_ARG_TYPE,
            format_args!(
                "The \"{}\" argument must be one of type {}. Received {}",
                bstr::BStr::new(argname),
                bstr::BStr::new(typename),
                actual_string_value
            ),
        )
        .throw()
    }

    pub fn throw_invalid_argument_range_value(
        &self,
        argname: &[u8],
        typename: &[u8],
        value: i64,
    ) -> JsError {
        self.err(
            JscError::OUT_OF_RANGE,
            format_args!(
                "The \"{}\" is out of range. {}. Received {}",
                bstr::BStr::new(argname),
                bstr::BStr::new(typename),
                value
            ),
        )
        .throw()
    }

    pub fn throw_invalid_property_type_value(
        &self,
        field: &[u8],
        typename: &[u8],
        value: JSValue,
    ) -> JsError {
        let ty_str = value.js_type_string(self).to_slice(self);
        // defer ty_str.deinit() → Drop on the slice type.
        self.err(
            JscError::INVALID_ARG_TYPE,
            format_args!(
                "The \"{}\" property must be of type {}. Received {}",
                bstr::BStr::new(field),
                bstr::BStr::new(typename),
                bstr::BStr::new(ty_str.slice())
            ),
        )
        .throw()
    }

    pub fn create_not_enough_arguments(
        &self,
        name_: &'static str,
        expected: usize,
        got: usize,
    ) -> JSValue {
        self.to_type_error(
            JscError::MISSING_ARGS,
            format_args!(
                "Not enough arguments to '{}'. Expected {}, got {}.",
                name_, expected, got
            ),
        )
    }

    /// Not enough arguments passed to function named `name_`
    pub fn throw_not_enough_arguments(
        &self,
        name_: &'static str,
        expected: usize,
        got: usize,
    ) -> JsError {
        self.throw_value(self.create_not_enough_arguments(name_, expected, got))
    }

    pub fn reload(&self) -> JsResult<()> {
        self.vm().drain_microtasks();
        self.vm().collect_async();
        // C++ `JSC__JSGlobalObject__reload` is `[[ZIG_EXPORT(check_slow)]]`; the Zig codegen
        // wrapper (`bun.cpp.JSC__JSGlobalObject__reload`) returns `error{JSError}!void` by
        // checking for a pending exception after the raw call. Mirror that contract here so
        // any JS exception thrown during module reload is surfaced to the caller instead of
        // left pending.
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        crate::from_js_host_call_generic(self, || unsafe { JSC__JSGlobalObject__reload(self) })
    }

    pub fn run_on_load_plugins(
        &self,
        namespace_: BunString,
        path: BunString,
        target: BunPluginTarget,
    ) -> JsResult<Option<JSValue>> {
        crate::mark_binding();
        let ns_ptr = if namespace_.length() > 0 { Some(&namespace_) } else { None };
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `ns_ptr`/`&path` borrow stack
        // locals that outlive the call; null `namespace_` is permitted by the C++ side.
        let result = crate::from_js_host_call(self, || unsafe {
            Bun__runOnLoadPlugins(
                self,
                ns_ptr.map(|p| p as *const BunString).unwrap_or(core::ptr::null()),
                &path,
                target,
            )
        })?;
        if result.is_undefined_or_null() {
            return Ok(None);
        }
        Ok(Some(result))
    }

    pub fn run_on_resolve_plugins(
        &self,
        namespace_: BunString,
        path: BunString,
        source: BunString,
        target: BunPluginTarget,
    ) -> JsResult<Option<JSValue>> {
        crate::mark_binding();
        let ns_ptr = if namespace_.length() > 0 { Some(&namespace_) } else { None };
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `ns_ptr`/`&path`/`&source` borrow
        // stack locals that outlive the call; null `namespace_` is permitted by the C++ side.
        let result = crate::from_js_host_call(self, || unsafe {
            Bun__runOnResolvePlugins(
                self,
                ns_ptr.map(|p| p as *const BunString).unwrap_or(core::ptr::null()),
                &path,
                &source,
                target,
            )
        })?;
        if result.is_undefined_or_null() {
            return Ok(None);
        }
        Ok(Some(result))
    }

    pub fn create_error_instance(&self, args: Arguments<'_>) -> JSValue {
        // PORT NOTE: Zig branched at comptime on whether `args` is empty. With
        // `core::fmt::Arguments`, `as_str()` returns `Some(&'static str)` when
        // there are no interpolated args — equivalent fast path.
        if let Some(fmt) = args.as_str() {
            if strings::is_all_ascii(fmt.as_bytes()) {
                return BunString::static_str(fmt).to_error_instance(self);
            } else {
                return ZigString::init_utf8(fmt.as_bytes()).to_error_instance(self);
            }
        }

        // PERF(port): was stack-fallback (4KB) + Allocating writer with 2KB initial capacity.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use std::io::Write;
        if write!(&mut buf, "{}", args).is_err() {
            // if an exception occurs in the middle of formatting the error message, it's better to just return the formatting string than an error about an error.
            // Clear any pending JS exception (e.g. from Symbol.toPrimitive) so that throwValue doesn't hit assertNoException.
            // PORT NOTE: Zig fell back to the literal `fmt` string here; in Rust the fmt
            // string is folded into `Arguments`, and `write!` into `Vec<u8>` only fails if
            // a `Display` impl errors. Empty-string fallback matches "no error about an error".
            let _ = self.clear_exception_except_termination();
            return ZigString::static_str("").to_error_instance(self);
        }

        // Ensure we clone it.
        let str = ZigString::init_utf8(&buf);
        str.to_error_instance(self)
    }

    pub fn create_type_error_instance(&self, args: Arguments<'_>) -> JSValue {
        if let Some(fmt) = args.as_str() {
            return ZigString::static_str(fmt).to_type_error_instance(self);
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use std::io::Write;
        if write!(&mut buf, "{}", args).is_err() {
            let _ = self.clear_exception_except_termination();
            return ZigString::static_str("").to_type_error_instance(self);
        }
        let str = ZigString::from_utf8(&buf);
        str.to_type_error_instance(self)
    }

    pub fn create_dom_exception_instance(
        &self,
        code: DOMExceptionCode,
        args: Arguments<'_>,
    ) -> JsResult<JSValue> {
        if let Some(fmt) = args.as_str() {
            return Ok(ZigString::static_str(fmt).to_dom_exception_instance(self, code));
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use std::io::Write;
        write!(&mut buf, "{}", args).map_err(|_| JsError::Thrown)?;
        // TODO(port): Zig used `try writer.print` — map to JsError? Original error set unclear.
        let str = ZigString::from_utf8(&buf);
        Ok(str.to_dom_exception_instance(self, code))
    }

    pub fn create_syntax_error_instance(&self, args: Arguments<'_>) -> JSValue {
        if let Some(fmt) = args.as_str() {
            return ZigString::static_str(fmt).to_syntax_error_instance(self);
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use std::io::Write;
        if write!(&mut buf, "{}", args).is_err() {
            let _ = self.clear_exception_except_termination();
            return ZigString::static_str("").to_syntax_error_instance(self);
        }
        let str = ZigString::from_utf8(&buf);
        str.to_syntax_error_instance(self)
    }

    pub fn create_range_error_instance(&self, args: Arguments<'_>) -> JSValue {
        if let Some(fmt) = args.as_str() {
            return ZigString::static_str(fmt).to_range_error_instance(self);
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use std::io::Write;
        if write!(&mut buf, "{}", args).is_err() {
            let _ = self.clear_exception_except_termination();
            return ZigString::static_str("").to_range_error_instance(self);
        }
        let str = ZigString::from_utf8(&buf);
        str.to_range_error_instance(self)
    }

    pub fn create_range_error(&self, args: Arguments<'_>) -> JSValue {
        let err = self.create_error_instance(args);
        if err.is_empty() {
            debug_assert!(self.has_exception());
            return JSValue::ZERO;
        }
        // `@tagName(jsc.Node.ErrorCode.ERR_OUT_OF_RANGE)` is the literal string.
        err.put(
            self,
            b"code",
            ZigString::static_str("ERR_OUT_OF_RANGE").to_js(self),
        );
        err
    }

    pub fn create_invalid_args(&self, args: Arguments<'_>) -> JSValue {
        JscError::INVALID_ARG_TYPE.fmt(self, args)
    }

    pub fn throw_sys_error(&self, opts: SysErrOptions, message: Arguments<'_>) -> JsError {
        let err = self.create_error_instance(message);
        if err.is_empty() {
            debug_assert!(self.has_exception());
            return JsError::Thrown;
        }
        err.put(
            self,
            b"code",
            ZigString::init(opts.code.as_bytes()).to_js(self),
        );
        if let Some(name) = opts.name {
            err.put(self, b"name", ZigString::init(name).to_js(self));
        }
        if let Some(errno) = opts.errno {
            err.put(self, b"errno", JSValue::js_number_from_int32(errno));
        }
        self.throw_value(err)
    }

    /// Throw an Error from a formatted string.
    ///
    /// Note: If you are throwing an error within somewhere in the Bun API,
    /// chances are you should be using `.err(...).throw()` instead.
    pub fn throw(&self, args: Arguments<'_>) -> JsError {
        let instance = self.create_error_instance(args);
        if instance.is_empty() {
            debug_assert!(self.has_exception());
            return JsError::Thrown;
        }
        self.throw_value(instance)
    }

    pub fn throw_pretty(&self, args: Arguments<'_>) -> JsError {
        // PORT NOTE: Zig used `switch (Output.enable_ansi_colors_stderr) { inline else => |enabled| ... }`
        // with `Output.prettyFmt(fmt, enabled)` performing comptime fmt-string rewriting (strip
        // `<r>`/`<red>` markers when colors disabled). The `pretty_fmt!` macro provides the
        // equivalent rewrite at the call site, so callers should pass an already-processed `fmt`;
        // this body just creates the instance once. The branch is kept for parity with Zig but
        // both arms are identical until callers adopt `pretty_fmt!` themselves.
        let instance = if bun_core::output::ENABLE_ANSI_COLORS_STDERR
            .load(core::sync::atomic::Ordering::Relaxed)
        {
            self.create_error_instance(args)
        } else {
            self.create_error_instance(args)
        };
        if instance.is_empty() {
            debug_assert!(self.has_exception());
            return JsError::Thrown;
        }
        self.throw_value(instance)
    }

    /// Queue a native callback as a microtask.
    ///
    /// PORT NOTE: Zig version takes `comptime Function: fn(ctx)` and generates a
    /// `callconv(.c)` wrapper struct at comptime. Rust can't monomorphize an
    /// `extern "C"` trampoline over a *runtime* fn pointer, so callers supply the
    /// `extern "C" fn(*mut c_void)` directly (see [`crate::opaque_wrap`] for a
    /// typed wrapper helper). This matches the underlying FFI exactly.
    pub fn queue_microtask_callback(
        &self,
        ctx_val: *mut c_void,
        function: unsafe extern "C" fn(*mut c_void),
    ) {
        crate::mark_binding();
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `ctx_val` is caller-supplied
        // opaque context; `function` is a valid `extern "C"` fn pointer.
        unsafe { JSC__JSGlobalObject__queueMicrotaskCallback(self, ctx_val, function) }
    }

    pub fn queue_microtask(&self, function: JSValue, args: &[JSValue]) {
        self.queue_microtask_job(
            function,
            if args.len() > 0 { args[0] } else { JSValue::ZERO },
            if args.len() > 1 { args[1] } else { JSValue::ZERO },
        );
    }

    pub fn emit_warning(
        &self,
        warning: JSValue,
        type_: JSValue,
        code: JSValue,
        ctor: JSValue,
    ) -> JsResult<()> {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue args are passed by value
        // and rooted on the caller's stack for the duration of the call.
        crate::from_js_host_call_generic(self, || unsafe {
            Bun__Process__emitWarning(self, warning, type_, code, ctor)
        })
    }

    pub fn queue_microtask_job(&self, function: JSValue, first: JSValue, second: JSValue) {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue args are passed by value.
        unsafe { JSC__JSGlobalObject__queueMicrotaskJob(self, function, first, second) }
    }

    pub fn throw_value(&self, value: JSValue) -> JsError {
        // A termination exception (e.g. stack overflow) may already be
        // pending. Don't try to override it — that would hit
        // releaseAssertNoException in VM.throwError.
        if self.has_exception() {
            return JsError::Thrown;
        }
        self.vm().throw_error(self, value)
    }

    pub fn throw_type_error(&self, args: Arguments<'_>) -> JsError {
        let instance = self.create_type_error_instance(args);
        self.throw_value(instance)
    }

    pub fn throw_dom_exception(&self, code: DOMExceptionCode, args: Arguments<'_>) -> JsError {
        let instance = match self.create_dom_exception_instance(code, args) {
            Ok(v) => v,
            Err(e) => return e,
        };
        self.throw_value(instance)
    }

    pub fn throw_error(&self, err: bun_core::Error, fmt: &'static str) -> JsError {
        if err == bun_core::err!("OutOfMemory") {
            return self.throw_out_of_memory();
        }

        // If we're throwing JSError, that means either:
        // - We're throwing an exception while another exception is already active
        // - We're incorrectly returning JSError from a function that did not throw.
        debug_assert!(err != bun_core::err!("JSError"));

        // PERF(port): was stack-fallback (128 bytes).
        let mut buffer: Vec<u8> = Vec::new();
        use std::io::Write;
        if write!(&mut buffer, "{} {}", err.name(), fmt).is_err() {
            return self.throw_out_of_memory();
        }
        let str = ZigString::init_utf8(&buffer);
        let err_value = str.to_error_instance(self);
        self.throw_value(err_value)
    }

    // TODO: delete these two fns
    pub fn ref_(&self) -> &JSGlobalObject {
        self
    }
    #[inline]
    pub fn ctx(&self) -> &JSGlobalObject {
        self.ref_()
    }

    pub fn create_aggregate_error(
        &self,
        errors: &[JSValue],
        message: &ZigString,
    ) -> JsResult<JSValue> {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `errors.as_ptr()`/`len()` describe
        // a valid stack-rooted slice; `message` borrow outlives the call.
        crate::from_js_host_call(self, || unsafe {
            JSC__JSGlobalObject__createAggregateError(self, errors.as_ptr(), errors.len(), message)
        })
    }

    pub fn create_aggregate_error_with_array(
        &self,
        message: BunString,
        error_array: JSValue,
    ) -> JsResult<JSValue> {
        if cfg!(debug_assertions) {
            debug_assert!(error_array.is_array());
        }
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `error_array`/`message` are
        // by-value; C++ consumes `message` (BunString) by value.
        crate::from_js_host_call(self, || unsafe {
            JSC__JSGlobalObject__createAggregateErrorWithArray(self, error_array, message, JSValue::UNDEFINED)
        })
    }

    pub fn generate_heap_snapshot(&self) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSC__JSGlobalObject__generateHeapSnapshot(self) }
    }

    // DEPRECATED - use TopExceptionScope to check for exceptions and signal exceptions by returning JSError
    pub fn has_exception(&self) -> bool {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__hasException(self) }
    }

    pub fn clear_exception(&self) {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__clearException(self) }
    }

    /// Clear the currently active exception off the VM unless it is a
    /// termination exception.
    ///
    /// Returns `true` if the exception was cleared, `false` if it was a
    /// termination exception. Use `clear_exception` to unconditionally clear
    /// exceptions.
    ///
    /// It is safe to call this function when no exception is present.
    pub fn clear_exception_except_termination(&self) -> bool {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSGlobalObject__clearExceptionExceptTermination(self) }
    }

    /// Clears the current exception and returns that value. Requires compile-time
    /// proof of an exception via `JsError`.
    pub fn take_exception(&self, proof: JsError) -> JSValue {
        match proof {
            JsError::Thrown => {}
            JsError::OutOfMemory => {
                let _ = self.throw_out_of_memory();
            }
            JsError::Terminated => {}
        }

        self.try_take_exception().unwrap_or_else(|| {
            panic!("A JavaScript exception was thrown, but it was cleared before it could be read.");
        })
    }

    pub fn take_error(&self, proof: JsError) -> JSValue {
        match proof {
            JsError::Thrown => {}
            JsError::OutOfMemory => {
                let _ = self.throw_out_of_memory();
            }
            JsError::Terminated => {}
        }

        self.try_take_exception()
            .unwrap_or_else(|| {
                panic!("A JavaScript exception was thrown, but it was cleared before it could be read.");
            })
            .to_error()
            .unwrap_or_else(|| {
                panic!("Couldn't convert a JavaScript exception to an Error instance.");
            })
    }

    pub fn try_take_exception(&self) -> Option<JSValue> {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        let value = unsafe { JSGlobalObject__tryTakeException(self) };
        if value.is_empty() {
            return None;
        }
        Some(value)
    }

    /// This is for the common scenario you are calling into JavaScript, but there is
    /// no logical way to handle a thrown exception other than to treat it as unhandled.
    ///
    /// The pattern:
    ///
    ///     let result = match value.call(...) {
    ///         Ok(v) => v,
    ///         Err(err) => return global.report_active_exception_as_unhandled(err),
    ///     };
    ///
    pub fn report_active_exception_as_unhandled(&self, err: JsError) {
        let exception = self.take_exception(err);
        if !exception.is_termination_exception() {
            // SAFETY: `bun_vm_ptr()` returns the live per-thread VM (Zig:
            // `*VirtualMachine`); `uncaught_exception` mutates VM fields.
            let _ = unsafe { &mut *self.bun_vm_ptr() }.uncaught_exception(self, exception, false);
        }
    }

    pub fn vm(&self) -> &VM {
        // SAFETY: JSC guarantees the VM outlives the global object.
        unsafe { &*JSC__JSGlobalObject__vm(self) }
    }

    /// Raw `*mut JSC::VM` for FFI predicates that take a VM pointer
    /// (e.g. [`JSValue::as_exception`]). C++ does not write through it.
    #[inline]
    pub fn vm_ptr(&self) -> *mut VM {
        // SAFETY: JSC guarantees the VM outlives the global object.
        unsafe { JSC__JSGlobalObject__vm(self) }
    }

    // `vm_ptr()` is defined once on the crate-root `impl JSGlobalObject` (lib.rs)
    // so it's reachable before this module is fully resolved; do not duplicate here.

    pub fn delete_module_registry_entry(&self, name_: &ZigString) -> JsResult<()> {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `name_` borrow outlives the call.
        crate::from_js_host_call_generic(self, || unsafe {
            JSC__JSGlobalObject__deleteModuleRegistryEntry(self, name_)
        })
    }

    fn bun_vm_unsafe(&self) -> *mut c_void {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSC__JSGlobalObject__bunVM(self) }
    }

    /// Raw-pointer variant of [`Self::bun_vm`]. Returns the FFI
    /// `*mut VirtualMachine` directly so callers that need to mutate VM fields
    /// don't launder provenance through `&VirtualMachine -> *mut` (which is UB
    /// to write through under Stacked Borrows). Spec `JSGlobalObject.zig:617`
    /// returns `*VirtualMachine` (mutable); this preserves that intent.
    #[inline]
    pub fn bun_vm_ptr(&self) -> *mut VirtualMachine {
        self.bun_vm_unsafe() as *mut VirtualMachine
    }

    pub fn bun_vm(&self) -> &VirtualMachine {
        #[cfg(debug_assertions)]
        {
            // if this fails
            // you most likely need to run
            //   make clean-jsc-bindings
            //   make bindings -j10
            if let Some(vm_) = VirtualMachine::get_or_null() {
                // SAFETY: address-equality only — neither pointer is dereferenced.
                // `get_or_null()` yields `*mut VirtualMachine` (Zig `VMHolder.vm`),
                // so no const→mut hop is needed to reach `*mut c_void`.
                debug_assert!(self.bun_vm_unsafe() == vm_ as *mut c_void);
            } else {
                panic!("This thread lacks a Bun VM");
            }
        }
        // SAFETY: bunVMUnsafe returns a valid *VirtualMachine for this global.
        unsafe { &*(self.bun_vm_unsafe() as *mut VirtualMachine) }
    }

    pub fn try_bun_vm(&self) -> (&VirtualMachine, ThreadKind) {
        // SAFETY: bunVMUnsafe returns a valid *VirtualMachine for this global.
        let vm_ptr = unsafe { &*(self.bun_vm_unsafe() as *mut VirtualMachine) };

        if let Some(vm_) = VirtualMachine::get_or_null() {
            #[cfg(debug_assertions)]
            {
                // SAFETY: address-equality only — neither pointer is dereferenced.
                // `vm_` is already `*mut VirtualMachine`; cast is mut→mut.
                debug_assert!(self.bun_vm_unsafe() == vm_ as *mut c_void);
            }
            let _ = vm_;
        } else {
            return (vm_ptr, ThreadKind::Other);
        }

        (vm_ptr, ThreadKind::Main)
    }

    /// We can't do the threadlocal check when queued from another thread
    pub fn bun_vm_concurrently(&self) -> &VirtualMachine {
        // SAFETY: bunVMUnsafe returns a valid *VirtualMachine for this global.
        unsafe { &*(self.bun_vm_unsafe() as *mut VirtualMachine) }
    }

    pub fn handle_rejected_promises(&self) {
        // JSC__JSGlobalObject__handleRejectedPromises catches and reports its
        // own exceptions; the only thing that escapes is a TerminationException
        // (worker terminate() or process.exit()), and the request flag may
        // already be cleared by the time we observe it. Nothing actionable here.
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ catches/reports its own exceptions.
        let _ = crate::from_js_host_call_generic(self, || unsafe {
            JSC__JSGlobalObject__handleRejectedPromises(self)
        });
    }

    pub fn readable_stream_to_array_buffer(&self, value: JSValue) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue passed by value.
        unsafe { ZigGlobalObject__readableStreamToArrayBuffer(self, value) }
    }

    pub fn readable_stream_to_bytes(&self, value: JSValue) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue passed by value.
        unsafe { ZigGlobalObject__readableStreamToBytes(self, value) }
    }

    pub fn readable_stream_to_text(&self, value: JSValue) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue passed by value.
        unsafe { ZigGlobalObject__readableStreamToText(self, value) }
    }

    pub fn readable_stream_to_json(&self, value: JSValue) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue passed by value.
        unsafe { ZigGlobalObject__readableStreamToJSON(self, value) }
    }

    pub fn readable_stream_to_blob(&self, value: JSValue) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue passed by value.
        unsafe { ZigGlobalObject__readableStreamToBlob(self, value) }
    }

    pub fn readable_stream_to_form_data(&self, value: JSValue, content_type: JSValue) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; JSValue args passed by value.
        unsafe { ZigGlobalObject__readableStreamToFormData(self, value, content_type) }
    }

    /// Returns the raw `*mut NapiEnv` (mirrors Zig `*napi.NapiEnv`).
    ///
    /// LAYERING: `NapiEnv` is defined in `bun_runtime::napi` (a higher-tier crate
    /// that depends on `bun_jsc`), so this returns the opaque `*mut c_void` and
    /// runtime-tier callers cast to `*mut NapiEnv` themselves. The struct is never
    /// dereferenced at this tier.
    pub fn make_napi_env_for_ffi(&self) -> *mut c_void {
        // SAFETY: C++ returns a non-null, freshly-created NapiEnv owned by the global.
        unsafe { ZigGlobalObject__makeNapiEnvForFFI(self) }
    }

    #[inline]
    pub fn assert_on_js_thread(&self) {
        if cfg!(debug_assertions) {
            self.bun_vm().assert_on_js_thread();
        }
    }

    // returns false if it throws
    pub fn validate_object(
        &self,
        arg_name: &'static str,
        value: JSValue,
        opts: ValidateObjectOpts,
    ) -> JsResult<()> {
        if (!opts.allow_nullable && value.is_null())
            || (!opts.allow_array && value.is_array())
            || (!value.is_object() && (!opts.allow_function || !value.is_function()))
        {
            return Err(self.throw_invalid_argument_type_value(arg_name.as_bytes(), b"object", value));
        }
        Ok(())
    }

    pub fn throw_range_error<V: bun_fmt::OutOfRangeValue>(
        &self,
        value: V,
        options: bun_fmt::OutOfRangeOptions<'_>,
    ) -> JsError {
        self.err(
            JscError::OUT_OF_RANGE,
            format_args!("{}", bun_fmt::out_of_range(value, options)),
        )
        .throw()
    }

    // PORT NOTE: Zig's `validateBigIntRange` / `validateIntegerRange` / `getInteger`
    // take `comptime T: type` plus a `comptime range: IntegerRange` with
    // `comptime_int` bounds and use @typeInfo for signedness, comptime @max/@min
    // clamping, and @compileError on bad ranges. Ported as plain generics over
    // `T: bun_core::Integer`; the comptime bounds checks become `debug_assert!`.
    // TODO(port): narrow trait bound — `bun_core::Integer` must provide
    // SIGNED, MIN_I128/MAX_I128, from_i32/from_f64/from_i64/from_u64, to_f64.
    pub fn validate_big_int_range<T: bun_core::Integer>(
        &self,
        value: JSValue,
        default: T,
        range: IntegerRange,
    ) -> JsResult<T> {
        if value.is_undefined() || value.is_empty() {
            return Ok(T::ZERO);
        }

        let min_t: i128 = range.min.max(T::MIN_I128);
        let max_t: i128 = range.max.min(T::MAX_I128);
        if value.is_big_int() {
            if T::SIGNED {
                if value.is_big_int_in_int64_range(
                    i64::try_from(min_t).unwrap(),
                    i64::try_from(max_t).unwrap(),
                ) {
                    return Ok(T::from_i64(value.to_int64()));
                }
            } else {
                if value.is_big_int_in_uint64_range(
                    u64::try_from(min_t).unwrap(),
                    u64::try_from(max_t).unwrap(),
                ) {
                    return Ok(T::from_u64(value.to_uint64_no_truncate()));
                }
            }
            return Err(self
                .err(
                    JscError::OUT_OF_RANGE,
                    format_args!(
                        "The value is out of range. It must be >= {} and <= {}.",
                        min_t, max_t
                    ),
                )
                .throw());
        }

        self.validate_integer_range::<T>(
            value,
            default,
            IntegerRange {
                min: min_t.max(i128::from(MIN_SAFE_INTEGER)),
                max: max_t.min(i128::from(MAX_SAFE_INTEGER)),
                field_name: range.field_name,
                always_allow_zero: range.always_allow_zero,
            },
        )
    }

    pub fn validate_integer_range<T: bun_core::Integer>(
        &self,
        value: JSValue,
        default: T,
        range: IntegerRange,
    ) -> JsResult<T> {
        if value.is_undefined() || value.is_empty() {
            return Ok(default);
        }

        let min_t: i128 = range.min.max(T::MIN_I128).max(i128::from(MIN_SAFE_INTEGER));
        let max_t: i128 = range.max.min(T::MAX_I128).min(i128::from(MAX_SAFE_INTEGER));

        // TODO(port): comptime { if (min_t > max_t) @compileError(...) } — became debug_assert.
        debug_assert!(min_t <= max_t, "max must be less than min");

        let field_name = range.field_name;
        // TODO(port): comptime field_name.len == 0 → @compileError.
        debug_assert!(!field_name.is_empty(), "field_name must not be empty");
        let always_allow_zero = range.always_allow_zero;
        // Zig passes the *unclamped* `range.min`/`range.max` to `throwRangeError`
        // (not `min_t`/`max_t`). i128→i64 narrowing is safe here: callers always
        // supply bounds within i64 (the formatter's range type).
        let min = range.min as i64;
        let max = range.max as i64;

        if value.is_int32() {
            let int = value.to_int32();
            if always_allow_zero && int == 0 {
                return Ok(T::ZERO);
            }
            if i128::from(int) < min_t || i128::from(int) > max_t {
                return Err(self.throw_range_error(
                    int,
                    bun_fmt::OutOfRangeOptions {
                        field_name,
                        min,
                        max,
                        ..Default::default()
                    },
                ));
            }
            return Ok(T::from_i32(int));
        }

        if !value.is_number() {
            return Err(self.throw_invalid_property_type_value(field_name, b"number", value));
        }
        let f64_val = value.as_number();
        if always_allow_zero && f64_val == 0.0 {
            return Ok(T::ZERO);
        }

        if f64_val.is_nan() {
            // node treats NaN as default
            return Ok(default);
        }
        if f64_val.floor() != f64_val {
            return Err(self.throw_invalid_property_type_value(field_name, b"integer", value));
        }
        // @floatFromInt — i128→f64 (rounds beyond 2^53; bounds are already clamped to safe-integer range).
        if f64_val < (min_t as f64) || f64_val > (max_t as f64) {
            return Err(self.throw_range_error(
                f64_val,
                bun_fmt::OutOfRangeOptions {
                    field_name,
                    min,
                    max,
                    ..Default::default()
                },
            ));
        }

        Ok(T::from_f64(f64_val))
    }

    pub fn get_integer<T: bun_core::Integer>(
        &self,
        obj: JSValue,
        default: T,
        range: IntegerRange,
    ) -> Option<T> {
        match obj.get(self, range.field_name) {
            Ok(Some(val)) => self.validate_integer_range::<T>(val, default, range).ok(),
            Ok(None) => Some(default),
            Err(_) => None,
        }
    }

    /// Get a lazily-initialized `JSC::String` from `BunCommonStrings.h`.
    #[inline]
    pub fn common_strings(&self) -> CommonStrings<'_> {
        crate::mark_binding();
        CommonStrings { global_object: self }
    }

    /// Throw an error from within the Bun runtime.
    ///
    /// The set of errors accepted by `err()` is defined in `ErrorCode.ts`.
    // PORT NOTE: Zig `ERR` returns a comptime-monomorphized `ErrorBuilder(code, fmt, @TypeOf(args))`.
    // The Rust ErrorBuilder carries the code + Arguments at runtime.
    pub fn err<'a>(&'a self, code: JscError, args: Arguments<'a>) -> ErrorBuilder<'a, Self> {
        ErrorBuilder { global: self, code, args }
    }

    pub fn create(
        v: *mut VirtualMachine,
        console: *mut c_void,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: Option<*mut c_void>,
    ) -> *mut JSGlobalObject {
        let _trace = perf::trace("JSGlobalObject.create");

        // SAFETY: caller provides a live VM (Zig: `*jsc.VirtualMachine`). `event_loop()`
        // returns the VM-owned `*mut EventLoop`; `ensure_waker` mutates it in place.
        unsafe { (*(*v).event_loop()).ensure_waker() };
        // SAFETY: C++ creates and returns a non-null global object owned by the JSC VM.
        let global = unsafe {
            Zig__GlobalObject__create(
                console,
                context_id,
                mini_mode,
                eval_mode,
                worker_ptr.unwrap_or(core::ptr::null_mut()),
            )
        };

        // JSC might mess with the stack size.
        StackCheck::configure_thread();

        global
    }

    pub fn create_for_test_isolation(old_global: &JSGlobalObject, console: *mut c_void) -> *mut JSGlobalObject {
        // SAFETY: C++ returns a non-null freshly-created global owned by the JSC VM.
        unsafe { Zig__GlobalObject__createForTestIsolation(old_global, console) }
    }

    pub fn get_module_registry_map(global: &JSGlobalObject) -> *mut c_void {
        // SAFETY: FFI — `global` is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { Zig__GlobalObject__getModuleRegistryMap(global) }
    }

    pub fn reset_module_registry_map(global: &JSGlobalObject, map: *mut c_void) -> bool {
        // SAFETY: FFI — `global` is a valid JSGlobalObject*; `map` was previously returned
        // by `get_module_registry_map` (caller invariant).
        unsafe { Zig__GlobalObject__resetModuleRegistryMap(global, map) }
    }

    pub fn report_uncaught_exception_from_error(&self, proof: JsError) {
        crate::mark_binding();
        let exc = self
            .take_exception(proof)
            .as_exception(self.vm_ptr())
            .expect("exception value must be an Exception cell");
        // SAFETY: `as_exception` returned `Some(non-null *mut Exception)`; the cell is
        // GC-rooted via the value held on this stack frame for the duration of the call.
        let _ = report_uncaught_exception(self, unsafe { &*exc });
    }

    // LAYERING: `getBodyStreamOrBytesForWasmStreaming` (JSGlobalObject.zig:922) is
    // exported to C++ but its body is entirely WebCore (`Response`, `Body.Value`,
    // `ReadableStream`, `Blob.Store`) — types that live in `bun_runtime::webcore`, a
    // crate that depends on `bun_jsc`. The implementation + `#[no_mangle]` export live
    // in `bun_runtime::webcore::wasm_streaming` to break the cycle; nothing in this
    // crate needs to reference it.

    pub fn create_error(&self, args: Arguments<'_>) -> JSValue {
        if let Some(fmt) = args.as_str() {
            let mut zig_str = ZigString::init(fmt.as_bytes());
            if !strings::is_all_ascii(fmt.as_bytes()) {
                zig_str.mark_utf16();
            }
            return zig_str.to_error_instance(self);
        }
        // PERF(port): was stack-fallback (256 bytes).
        let mut buf: Vec<u8> = Vec::new();
        use std::io::Write;
        write!(&mut buf, "{}", args).expect("unreachable");
        let zig_str = ZigString::init(&buf).with_encoding();
        // it alwayas clones
        zig_str.to_error_instance(self)
    }

    pub fn to_type_error(&self, code: JscError, args: Arguments<'_>) -> JSValue {
        code.fmt(self, args)
    }

    #[cold]
    pub fn to_invalid_arguments(&self, args: Arguments<'_>) -> JSValue {
        JscError::INVALID_ARG_TYPE.fmt(self, args)
    }

    pub fn script_execution_context_identifier(&self) -> ScriptExecutionContextIdentifier {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; returns the u32 context id.
        ScriptExecutionContextIdentifier(unsafe {
            ScriptExecutionContextIdentifier__forGlobalObject(self)
        })
    }

    pub const EXTERN: [&'static str; 3] = ["create", "getModuleRegistryMap", "resetModuleRegistryMap"];
}

// ──────────────────────────────────────────────────────────────────────────────
// Nested types (moved out of `impl` since Rust impls cannot contain type defs).
// ──────────────────────────────────────────────────────────────────────────────

// `GregorianDateTime` / `ValidateObjectOpts` — canonical defs live at crate root
// (lib.rs); re-exported here for callers that path through `js_global_object::`.
pub use crate::{GregorianDateTime, IntegerRange, ValidateObjectOpts};

/// `JSGlobalObject.BunPluginTarget` (JSGlobalObject.zig:265). Canonical
/// definition — `crate::BunPluginTarget` re-exports this.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BunPluginTarget {
    Bun = 0,
    Node = 1,
    Browser = 2,
}

/// Options for [`JSGlobalObject::throw_sys_error`].
///
/// PORT NOTE: no `Default` derive — Zig's `code: jsc.Node.ErrorCode` has NO default
/// (only `errno`/`name` default to null). Callers must always supply `code`.
///
/// LAYERING: Zig types `code` as `jsc.Node.ErrorCode` (an enum living in
/// `bun_runtime::node::nodejs_error_code`, which depends on `bun_jsc`). The body
/// only ever does `@tagName(opts.code)` — i.e. it needs the *string* — so `code`
/// is `&'static str` here. Runtime-tier callers pass `code.tag_name()`.
pub struct SysErrOptions {
    pub code: &'static str,
    pub errno: Option<i32>,
    pub name: Option<&'static [u8]>,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ThreadKind {
    Main,
    Other,
}

/// `bun.webcore.ScriptExecutionContext.Identifier` — defined here (not in
/// `bun_runtime`) because [`JSGlobalObject::script_execution_context_identifier`]
/// must return it and `bun_runtime` depends on `bun_jsc`. Runtime re-exports
/// this as `webcore::script_execution_context::Identifier`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct ScriptExecutionContextIdentifier(pub u32);

impl ScriptExecutionContextIdentifier {
    #[inline]
    pub const fn from_raw(id: u32) -> Self { Self(id) }
    #[inline]
    pub const fn raw(self) -> u32 { self.0 }

    /// Returns `None` if the context referred to by `self` no longer exists.
    pub fn global_object(self) -> Option<&'static JSGlobalObject> {
        // SAFETY: FFI call returns a valid pointer or null; JSGlobalObject is owned by the VM.
        unsafe { ScriptExecutionContextIdentifier__getGlobalObject(self.0).as_ref() }
    }

    /// Returns `None` if the context referred to by `self` no longer exists.
    pub fn bun_vm(self) -> Option<*mut VirtualMachine> {
        // Concurrently because identifiers are mostly used by off-thread tasks.
        Some(self.global_object()?.bun_vm_ptr())
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Exported (callconv(.c)) functions — Zig used `comptime { @export(...) }`.
// ──────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Zig__GlobalObject__resolve(
    res: *mut ErrorableString,
    global: *const JSGlobalObject,
    specifier: *mut BunString,
    source: *mut BunString,
    query: *mut BunString,
) {
    crate::mark_binding();
    // SAFETY: C++ passes valid non-null pointers.
    let (res, global, specifier, source, query) = unsafe {
        (&mut *res, &*global, (*specifier).dupe_ref(), (*source).dupe_ref(), &mut *query)
    };
    if VirtualMachine::resolve(res, global, specifier, source, Some(query), true).is_err() {
        debug_assert!(!res.success);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Zig__GlobalObject__reportUncaughtException(
    global: *const JSGlobalObject,
    exception: *mut Exception,
) -> JSValue {
    crate::mark_binding();
    // SAFETY: C++ passes valid non-null pointers.
    unsafe { VirtualMachine::report_uncaught_exception(&*global, &*exception) }
}

// Safe wrapper used internally (matches Zig's pub fn).
#[inline]
pub fn report_uncaught_exception(global: &JSGlobalObject, exception: &Exception) -> JSValue {
    crate::mark_binding();
    VirtualMachine::report_uncaught_exception(global, exception)
}

#[unsafe(no_mangle)]
pub extern "C" fn Zig__GlobalObject__onCrash() {
    crate::mark_binding();
    bun_core::output::flush();
    panic!("A C++ exception occurred");
}

// `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming` is exported from
// `bun_runtime::webcore::wasm_streaming` (LAYERING — see method comment above).

// ──────────────────────────────────────────────────────────────────────────────
// extern "C" declarations
// TODO(port): move to jsc_sys
// ──────────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    fn JSGlobalObject__throwStackOverflow(this: *const JSGlobalObject);
    fn JSGlobalObject__throwOutOfMemoryError(this: *const JSGlobalObject);
    fn JSGlobalObject__createOutOfMemoryError(this: *const JSGlobalObject) -> JSValue;

    fn Bun__gregorianDateTimeToMS(
        this: *const JSGlobalObject,
        year: i32,
        month: i32,
        day: i32,
        hour: i32,
        minute: i32,
        second: i32,
        millisecond: i32,
        local: bool,
    ) -> f64;
    fn Bun__msToGregorianDateTime(
        this: *const JSGlobalObject,
        ms: f64,
        local: bool,
        year: *mut i32,
        month: *mut i32,
        day: *mut i32,
        hour: *mut i32,
        minute: *mut i32,
        second: *mut i32,
        weekday: *mut i32,
    );

    fn Bun__ErrorCode__determineSpecificType(global: *const JSGlobalObject, value: JSValue) -> BunString;

    fn Bun__runOnLoadPlugins(
        global: *const JSGlobalObject,
        namespace_: *const BunString,
        path: *const BunString,
        target: BunPluginTarget,
    ) -> JSValue;
    fn Bun__runOnResolvePlugins(
        global: *const JSGlobalObject,
        namespace_: *const BunString,
        path: *const BunString,
        source: *const BunString,
        target: BunPluginTarget,
    ) -> JSValue;

    fn JSC__JSGlobalObject__reload(this: *const JSGlobalObject);

    fn JSC__JSGlobalObject__queueMicrotaskCallback(
        this: *const JSGlobalObject,
        ctx: *mut c_void,
        function: unsafe extern "C" fn(*mut c_void),
    );

    fn Bun__Process__emitWarning(
        global_object: *const JSGlobalObject,
        warning: JSValue,
        type_: JSValue,
        code: JSValue,
        ctor: JSValue,
    );

    fn JSC__JSGlobalObject__queueMicrotaskJob(
        this: *const JSGlobalObject,
        function: JSValue,
        first: JSValue,
        second: JSValue,
    );

    fn JSC__JSGlobalObject__createAggregateError(
        global: *const JSGlobalObject,
        errors: *const JSValue,
        len: usize,
        message: *const ZigString,
    ) -> JSValue;
    fn JSC__JSGlobalObject__createAggregateErrorWithArray(
        global: *const JSGlobalObject,
        error_array: JSValue,
        message: BunString,
        options: JSValue,
    ) -> JSValue;
    fn JSC__JSGlobalObject__generateHeapSnapshot(this: *const JSGlobalObject) -> JSValue;

    fn JSC__JSGlobalObject__handleRejectedPromises(this: *const JSGlobalObject);

    fn ZigGlobalObject__readableStreamToArrayBuffer(this: *const JSGlobalObject, value: JSValue) -> JSValue;
    fn ZigGlobalObject__readableStreamToBytes(this: *const JSGlobalObject, value: JSValue) -> JSValue;
    fn ZigGlobalObject__readableStreamToText(this: *const JSGlobalObject, value: JSValue) -> JSValue;
    fn ZigGlobalObject__readableStreamToJSON(this: *const JSGlobalObject, value: JSValue) -> JSValue;
    fn ZigGlobalObject__readableStreamToFormData(
        this: *const JSGlobalObject,
        value: JSValue,
        content_type: JSValue,
    ) -> JSValue;
    fn ZigGlobalObject__readableStreamToBlob(this: *const JSGlobalObject, value: JSValue) -> JSValue;

    fn ZigGlobalObject__makeNapiEnvForFFI(this: *const JSGlobalObject) -> *mut c_void;

    fn JSC__JSGlobalObject__bunVM(this: *const JSGlobalObject) -> *mut c_void;
    fn JSC__JSGlobalObject__vm(this: *const JSGlobalObject) -> *mut VM;
    fn JSC__JSGlobalObject__deleteModuleRegistryEntry(this: *const JSGlobalObject, name_: *const ZigString);
    fn JSGlobalObject__clearException(this: *const JSGlobalObject);
    fn JSGlobalObject__clearExceptionExceptTermination(this: *const JSGlobalObject) -> bool;
    fn JSGlobalObject__clearTerminationException(this: *const JSGlobalObject);
    fn JSGlobalObject__hasException(this: *const JSGlobalObject) -> bool;
    fn JSGlobalObject__setTimeZone(this: *const JSGlobalObject, time_zone: *const ZigString) -> bool;
    fn JSGlobalObject__tryTakeException(this: *const JSGlobalObject) -> JSValue;
    fn JSGlobalObject__requestTermination(this: *const JSGlobalObject);

    fn Zig__GlobalObject__create(
        console: *mut c_void,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: *mut c_void,
    ) -> *mut JSGlobalObject;

    fn Zig__GlobalObject__createForTestIsolation(
        old_global: *const JSGlobalObject,
        console: *mut c_void,
    ) -> *mut JSGlobalObject;

    fn Zig__GlobalObject__getModuleRegistryMap(global: *const JSGlobalObject) -> *mut c_void;
    fn Zig__GlobalObject__resetModuleRegistryMap(global: *const JSGlobalObject, map: *mut c_void) -> bool;

    fn ScriptExecutionContextIdentifier__forGlobalObject(global: *const JSGlobalObject) -> u32;
    fn ScriptExecutionContextIdentifier__getGlobalObject(id: u32) -> *mut JSGlobalObject;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSGlobalObject.zig (1072 lines)
//   confidence: medium
//   todos:      26
//   notes:      heavy comptime fmt/args collapsed to fmt::Arguments (loses static-fmt fallback); validateIntegerRange/validateBigIntRange generic over bun_core::Integer (trait shape TBD); queue_microtask_callback trampoline needs const-generic fn ptr; ERR/ErrorBuilder reshaped to runtime; throwPretty needs Output.prettyFmt macro; webcore Body/Blob enum shapes guessed.
// ──────────────────────────────────────────────────────────────────────────
