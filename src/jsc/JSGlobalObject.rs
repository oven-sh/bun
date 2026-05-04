use core::ffi::c_void;
use core::fmt::Arguments;
use core::marker::{PhantomData, PhantomPinned};

use crate::{
    CommonStrings, ErrorableString, Exception, JSValue, JsError, JsResult, VirtualMachine, VM,
    MAX_SAFE_INTEGER, MIN_SAFE_INTEGER,
};
use crate::error_code::ErrorBuilder;
use crate::Error as JscError; // jsc.Error (ErrorCode enum)
use crate::node::ErrorCode as NodeErrorCode;
use crate::webcore::{DOMExceptionCode, ReadableStream, Response};

use bun_core::{fmt as bun_fmt, perf, Output, StackCheck};
use bun_napi::NapiEnv;
use bun_str::{self as bstr_mod, strings, String as BunString, ZigString};
use bun_webcore::ScriptExecutionContext;

// ──────────────────────────────────────────────────────────────────────────────
// Opaque FFI handle (Nomicon pattern; !Send + !Sync + !Unpin).
// ──────────────────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct JSGlobalObject {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl JSGlobalObject {
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
        crate::mark_binding(core::panic::Location::caller());
        // TODO(port): move to jsc_sys
        // SAFETY: FFI — &self is a valid JSGlobalObject*; all integer args are by value.
        Ok(unsafe {
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
        crate::mark_binding(core::panic::Location::caller());
        // SAFETY: FFI — &self is a valid JSGlobalObject*; all integer args are by value.
        Ok(unsafe {
            Bun__gregorianDateTimeToMS(self, year, month, day, hour, minute, second, millisecond, false)
        })
    }

    pub fn ms_to_gregorian_date_time_utc(&self, ms: f64) -> GregorianDateTime {
        crate::mark_binding(core::panic::Location::caller());
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
        err.put(self, ZigString::static_str("name"), name_value);
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
        // TODO(port): Zig version is comptime over `arg_names.len` (0 => @compileError).
        match arg_names.len() {
            0 => unreachable!("requires at least one argument"),
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
            _ => unreachable!("implement this message"),
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

    pub fn to_js<T>(&self, value: T) -> JsResult<JSValue> {
        JSValue::from_any(self, value)
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
            // ERR_error_string_n NUL-terminates within `len` bytes.
            let msg = unsafe { bun_boringssl::c::ERR_error_string_n(err, buf.as_mut_ptr(), buf.len()) };
            return self
                .err(
                    JscError::CRYPTO_INVALID_SCRYPT_PARAMS,
                    format_args!("Invalid scrypt params: {}", bstr::BStr::new(msg)),
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

    pub fn reload(&self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.vm().drain_microtasks();
        self.vm().collect_async();
        // SAFETY: FFI — &self is a valid JSGlobalObject*; C++ side has no extra preconditions.
        unsafe { JSC__JSGlobalObject__reload(self) };
        // TODO(port): bun.cpp.JSC__JSGlobalObject__reload was `try` — verify it can fail.
        Ok(())
    }

    pub fn run_on_load_plugins(
        &self,
        namespace_: BunString,
        path: BunString,
        target: BunPluginTarget,
    ) -> JsResult<Option<JSValue>> {
        crate::mark_binding(core::panic::Location::caller());
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
        crate::mark_binding(core::panic::Location::caller());
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
            let _ = self.clear_exception_except_termination();
            // TODO(port): Zig fell back to the static `fmt` literal here; with
            // `fmt::Arguments` we no longer have it separately. Phase B may need
            // to thread `fmt: &'static str` alongside the Arguments.
            return ZigString::init_utf8(b"").to_error_instance(self);
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
            // TODO(port): see create_error_instance — lost static-fmt fallback.
            return ZigString::init_utf8(b"").to_type_error_instance(self);
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
            // TODO(port): see create_error_instance — lost static-fmt fallback.
            return ZigString::init_utf8(b"").to_syntax_error_instance(self);
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
            // TODO(port): see create_error_instance — lost static-fmt fallback.
            return ZigString::init_utf8(b"").to_range_error_instance(self);
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
        err.put(
            self,
            ZigString::static_str("code"),
            ZigString::static_str(<&'static str>::from(NodeErrorCode::ERR_OUT_OF_RANGE)).to_js(self),
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
            ZigString::static_str("code"),
            ZigString::init(<&'static str>::from(opts.code).as_bytes()).to_js(self),
        );
        if let Some(name) = opts.name {
            err.put(self, ZigString::static_str("name"), ZigString::init(name).to_js(self));
        }
        if let Some(errno) = opts.errno {
            let v = match JSValue::from_any(self, errno) {
                Ok(v) => v,
                Err(e) => return e,
            };
            err.put(self, ZigString::static_str("errno"), v);
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

    pub fn throw_pretty(&self, fmt: &'static str, args: Arguments<'_>) -> JsError {
        // TODO(port): Zig used `switch (Output.enable_ansi_colors_stderr) { inline else => |enabled| ... }`
        // with `Output.prettyFmt(fmt, enabled)` performing comptime fmt-string rewriting.
        // This needs a macro in Rust; for Phase A we forward as-is.
        let _ = fmt;
        let instance = if Output::enable_ansi_colors_stderr() {
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

    pub fn queue_microtask_callback<C>(&self, ctx_val: *mut C, function: fn(*mut C)) {
        // TODO(port): Zig version takes `comptime Function: fn(ctx)` and generates a
        // `callconv(.c)` wrapper struct at comptime. In Rust we cannot monomorphize an
        // `extern "C"` trampoline over a runtime fn pointer. Phase B should make this
        // a const-generic `<const F: fn(*mut C)>` or accept an `extern "C" fn(*mut c_void)`.
        crate::mark_binding(core::panic::Location::caller());
        unsafe extern "C" fn call<C>(_p: *mut c_void) {
            // TODO(port): cannot capture `function` here; needs const-generic fn ptr.
            unreachable!("queue_microtask_callback trampoline not yet ported");
        }
        let _ = function;
        // SAFETY: FFI — &self is a valid JSGlobalObject*; `ctx_val` is caller-supplied
        // opaque context; `call::<C>` is a valid `extern "C"` fn pointer.
        unsafe {
            JSC__JSGlobalObject__queueMicrotaskCallback(self, ctx_val as *mut c_void, call::<C>);
        }
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
            let _ = self.bun_vm().uncaught_exception(self, exception, false);
        }
    }

    pub fn vm(&self) -> &VM {
        // SAFETY: JSC guarantees the VM outlives the global object.
        unsafe { &*JSC__JSGlobalObject__vm(self) }
    }

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

    pub fn bun_vm(&self) -> &VirtualMachine {
        #[cfg(debug_assertions)]
        {
            // if this fails
            // you most likely need to run
            //   make clean-jsc-bindings
            //   make bindings -j10
            if let Some(vm_) = VirtualMachine::vm_holder_vm() {
                debug_assert!(self.bun_vm_unsafe() == vm_ as *const _ as *mut c_void);
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

        if let Some(vm_) = VirtualMachine::vm_holder_vm() {
            #[cfg(debug_assertions)]
            {
                debug_assert!(self.bun_vm_unsafe() == vm_ as *const _ as *mut c_void);
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

    pub fn make_napi_env_for_ffi(&self) -> &mut NapiEnv {
        // SAFETY: C++ returns a non-null, freshly-created NapiEnv owned by the global.
        unsafe { &mut *ZigGlobalObject__makeNapiEnvForFFI(self) }
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
        if (!opts.nullable && value.is_null())
            || (!opts.allow_array && value.is_array())
            || (!value.is_object() && (!opts.allow_function || !value.is_function()))
        {
            return Err(self.throw_invalid_argument_type_value(arg_name.as_bytes(), b"object", value));
        }
        Ok(())
    }

    pub fn throw_range_error<V: core::fmt::Display>(
        &self,
        value: V,
        options: bun_fmt::OutOfRangeOptions,
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
        let min = range.min;
        let max = range.max;

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
                        min: Some(min),
                        max: Some(max),
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
                    min: Some(min),
                    max: Some(max),
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
        if let Some(val) = obj.get(self, range.field_name) {
            return self.validate_integer_range::<T>(val, default, range).ok();
        }
        if self.has_exception() {
            return None;
        }
        Some(default)
    }

    /// Get a lazily-initialized `JSC::String` from `BunCommonStrings.h`.
    #[inline]
    pub fn common_strings(&self) -> CommonStrings<'_> {
        crate::mark_binding(core::panic::Location::caller());
        CommonStrings { global_object: self }
    }

    /// Throw an error from within the Bun runtime.
    ///
    /// The set of errors accepted by `err()` is defined in `ErrorCode.ts`.
    pub fn err<'a>(&'a self, code: JscError, args: Arguments<'a>) -> ErrorBuilder<'a> {
        // TODO(port): Zig `ERR` returns a comptime-monomorphized `ErrorBuilder(code, fmt, @TypeOf(args))`.
        // The Rust ErrorBuilder carries the code + Arguments at runtime.
        ErrorBuilder { global: self, code, args }
    }

    pub fn create(
        v: &mut VirtualMachine,
        console: *mut c_void,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: Option<*mut c_void>,
    ) -> &'static mut JSGlobalObject {
        // TODO(port): lifetime — Zig returns *JSGlobalObject owned by the JSC VM.
        let _trace = perf::trace("JSGlobalObject.create");

        v.event_loop().ensure_waker();
        // SAFETY: C++ creates and returns a non-null global object.
        let global = unsafe {
            &mut *Zig__GlobalObject__create(
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

    pub fn create_for_test_isolation(old_global: &JSGlobalObject, console: *mut c_void) -> &'static mut JSGlobalObject {
        // SAFETY: C++ returns a non-null freshly-created global.
        unsafe { &mut *Zig__GlobalObject__createForTestIsolation(old_global, console) }
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
        crate::mark_binding(core::panic::Location::caller());
        let exc = self
            .take_exception(proof)
            .as_exception(self.vm())
            .expect("exception value must be an Exception cell");
        let _ = report_uncaught_exception(self, exc);
    }

    fn get_body_stream_or_bytes_for_wasm_streaming(
        &self,
        response_value: JSValue,
        streaming_compiler: *mut c_void,
    ) -> JsResult<JSValue> {
        let response = match Response::from_js(response_value) {
            Some(r) => r,
            None => {
                return Err(self.throw_invalid_argument_type_value2(
                    b"source",
                    b"an instance of Response or an Promise resolving to Response",
                    response_value,
                ));
            }
        };

        let content_type = if let Some(content_type) = response.get_content_type()? {
            content_type.to_zig_string()
        } else {
            ZigString::static_str("null").clone()
        };

        if !content_type.eql_comptime(b"application/wasm") {
            return Err(self
                .err(
                    JscError::WEBASSEMBLY_RESPONSE,
                    format_args!(
                        "WebAssembly response has unsupported MIME type '{}'",
                        content_type
                    ),
                )
                .throw());
        }

        if !response.is_ok() {
            return Err(self
                .err(
                    JscError::WEBASSEMBLY_RESPONSE,
                    format_args!("WebAssembly response has status code {}", response.status_code()),
                )
                .throw());
        }

        if response.get_body_used(self).to_boolean() {
            return Err(self
                .err(
                    JscError::WEBASSEMBLY_RESPONSE,
                    format_args!("WebAssembly response body has already been used"),
                )
                .throw());
        }

        let body = response.get_body_value();
        // TODO(port): `body` is a *Body.Value tagged union; matching on `.Error` etc.
        // assumes Rust models it as `enum BodyValue { Error(..), Locked(..), ... }`.
        if let crate::webcore::BodyValue::Error(err) = &*body {
            return Err(self.throw_value(err.to_js(self)));
        }

        // We're done validating. From now on, deal with extracting the body.
        body.to_blob_if_possible();

        if matches!(&*body, crate::webcore::BodyValue::Locked(_)) {
            if let Some(stream) = response.get_body_readable_stream(self) {
                return Ok(stream.value);
            }
        }

        let mut any_blob = match &*body {
            crate::webcore::BodyValue::Locked(_) => match body.try_use_as_any_blob() {
                Some(b) => b,
                None => return Ok(body.to_readable_stream(self)),
            },
            _ => body.use_as_any_blob(),
        };

        if let Some(store) = any_blob.store() {
            if !matches!(store.data, crate::webcore::BlobStoreData::Bytes(_)) {
                // This is a file or an S3 object, which aren't accessible synchronously.
                // (using any_blob.slice() would return a bogus empty slice)

                // Logic from JSC.WebCore.Body.Value.toReadableStream
                let mut blob = any_blob.blob;
                // TODO(port): `defer blob.detach()` ordering — manual scope for Phase A.
                blob.resolve_size();
                let result = ReadableStream::from_blob_copy_ref(self, &blob, blob.size);
                blob.detach();
                return Ok(result);
            }
        }

        // defer any_blob.detach() — see end of scope.

        // Push the blob contents into the streaming compiler by passing a pointer and
        // length, and return null to signify this has been done.
        let slice = any_blob.slice();
        // SAFETY: FFI — `streaming_compiler` is a valid C++ StreamingCompiler* passed in by
        // the caller; `slice.as_ptr()/len()` describe a buffer kept alive by `any_blob`
        // until `detach()` below.
        unsafe {
            JSC__Wasm__StreamingCompiler__addBytes(streaming_compiler, slice.as_ptr(), slice.len());
        }

        any_blob.detach();
        Ok(JSValue::NULL)
    }

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
        let mut zig_str = ZigString::init(&buf);
        zig_str.detect_encoding();
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

    pub fn script_execution_context_identifier(&self) -> ScriptExecutionContext::Identifier {
        // SAFETY: ScriptExecutionContext::Identifier is #[repr(u32)].
        unsafe {
            core::mem::transmute::<u32, ScriptExecutionContext::Identifier>(
                ScriptExecutionContextIdentifier__forGlobalObject(self),
            )
        }
    }

    pub const EXTERN: [&'static str; 3] = ["create", "getModuleRegistryMap", "resetModuleRegistryMap"];
}

// ──────────────────────────────────────────────────────────────────────────────
// Nested types (moved out of `impl` since Rust impls cannot contain type defs).
// ──────────────────────────────────────────────────────────────────────────────

pub struct GregorianDateTime {
    pub year: i32,
    pub month: i32,
    pub day: i32,
    pub hour: i32,
    pub minute: i32,
    pub second: i32,
    pub weekday: i32,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum BunPluginTarget {
    Bun = 0,
    Node = 1,
    Browser = 2,
}

// PORT NOTE: no `Default` derive — Zig's `code: jsc.Node.ErrorCode` has NO default
// (only `errno`/`name` default to null). Callers must always supply `code`.
pub struct SysErrOptions {
    pub code: NodeErrorCode,
    pub errno: Option<i32>,
    pub name: Option<&'static [u8]>,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ThreadKind {
    Main,
    Other,
}

#[derive(Default, Copy, Clone)]
pub struct ValidateObjectOpts {
    pub allow_array: bool,
    pub allow_function: bool,
    pub nullable: bool,
}

#[derive(Copy, Clone)]
pub struct IntegerRange {
    // TODO(port): Zig used `comptime_int` for min/max; i128 covers every signed/unsigned
    // primitive integer's MIN/MAX as well as MIN/MAX_SAFE_INTEGER without narrowing.
    pub min: i128,
    pub max: i128,
    pub field_name: &'static [u8],
    pub always_allow_zero: bool,
}

impl Default for IntegerRange {
    fn default() -> Self {
        Self {
            min: i128::from(MIN_SAFE_INTEGER),
            max: i128::from(MAX_SAFE_INTEGER),
            field_name: b"",
            always_allow_zero: false,
        }
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
    crate::mark_binding(core::panic::Location::caller());
    // SAFETY: C++ passes valid non-null pointers.
    let (res, global, specifier, source, query) = unsafe {
        (&mut *res, &*global, &*specifier, &*source, &mut *query)
    };
    if let Err(_) = VirtualMachine::resolve(res, global, specifier.clone(), source.clone(), query, true) {
        debug_assert!(!res.success);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Zig__GlobalObject__reportUncaughtException(
    global: *const JSGlobalObject,
    exception: *mut Exception,
) -> JSValue {
    crate::mark_binding(core::panic::Location::caller());
    // SAFETY: C++ passes valid non-null pointers.
    unsafe { VirtualMachine::report_uncaught_exception(&*global, &mut *exception) }
}

// Safe wrapper used internally (matches Zig's pub fn).
#[inline]
pub fn report_uncaught_exception(global: &JSGlobalObject, exception: &mut Exception) -> JSValue {
    crate::mark_binding(core::panic::Location::caller());
    VirtualMachine::report_uncaught_exception(global, exception)
}

#[unsafe(no_mangle)]
pub extern "C" fn Zig__GlobalObject__onCrash() {
    crate::mark_binding(core::panic::Location::caller());
    Output::flush();
    panic!("A C++ exception occurred");
}

// TODO(port): Zig wrapped `getBodyStreamOrBytesForWasmStreaming` via `jsc.host_fn.wrap3(...)`
// and exported it. The wrap helper produces a JSHostFn-calling-convention shim. In Rust the
// `#[bun_jsc::host_fn]` proc-macro emits the shim; the export name must match
// `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming`.
#[bun_jsc::host_fn(export = "Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming")]
pub fn get_body_stream_or_bytes_for_wasm_streaming(
    global: &JSGlobalObject,
    response_value: JSValue,
    streaming_compiler: *mut c_void,
) -> JsResult<JSValue> {
    global.get_body_stream_or_bytes_for_wasm_streaming(response_value, streaming_compiler)
}

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

    fn ZigGlobalObject__makeNapiEnvForFFI(this: *const JSGlobalObject) -> *mut NapiEnv;

    fn JSC__Wasm__StreamingCompiler__addBytes(
        streaming_compiler: *mut c_void,
        bytes_ptr: *const u8,
        bytes_len: usize,
    );

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
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSGlobalObject.zig (1072 lines)
//   confidence: medium
//   todos:      26
//   notes:      heavy comptime fmt/args collapsed to fmt::Arguments (loses static-fmt fallback); validateIntegerRange/validateBigIntRange generic over bun_core::Integer (trait shape TBD); queue_microtask_callback trampoline needs const-generic fn ptr; ERR/ErrorBuilder reshaped to runtime; throwPretty needs Output.prettyFmt macro; webcore Body/Blob enum shapes guessed.
// ──────────────────────────────────────────────────────────────────────────
