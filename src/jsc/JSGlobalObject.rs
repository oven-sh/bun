use core::ffi::{c_char, c_void};
use core::fmt::Arguments;
use core::marker::{PhantomData, PhantomPinned};

use crate::Error as JscError; // jsc.Error (ErrorCode enum)
use crate::ErrorCode as NodeErrorCode;
use crate::StringJsc as _; // .to_js() / .to_error_instance() on bun_core::String
use crate::ZigStringJsc as _;
use crate::error_code::ErrorBuilder;
use crate::virtual_machine::VirtualMachine;
use crate::zig_string::ZigString;
use crate::{
    CommonStrings, DOMExceptionCode, ErrorableString, Exception, JSValue, JsError, JsResult,
    MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, VM,
};

use bun_core::{Output, StackCheck, fmt as bun_fmt, perf};
use bun_core::{OwnedString, String as BunString, strings};

// ──────────────────────────────────────────────────────────────────────────────
// Opaque FFI handle (Nomicon pattern; !Send + !Sync + !Unpin).
//
// `UnsafeCell` opts the (zero) bytes out of the noalias/readonly guarantee so
// `&JSGlobalObject → *mut JSGlobalObject` (and any C++ write behind it) is
// sound under Stacked Borrows. Rust never reads or writes these bytes
// directly; all access is via FFI.
// ──────────────────────────────────────────────────────────────────────────────
bun_opaque::opaque_ffi! { pub struct JSGlobalObject; }

/// VM-lifetime handle to a `JSGlobalObject`, stored as a raw pointer.
///
/// Replaces the `&'static`-lifetime `JSGlobalObject` borrows scattered across
/// heap structs. `'static` was a lie — the global lives as long as its
/// `VirtualMachine`, not the process — and the lie forced every constructor to
/// erase a short-lived `&JSGlobalObject` to `'static`. `GlobalRef`
/// centralises that one `unsafe` inside [`Deref`] (the global outlives any
/// struct that holds a `GlobalRef`; see `LIFETIMES.tsv` JSC_BORROW), and the
/// `From<&JSGlobalObject>` impl makes construction safe at every call site.
///
/// `Copy` so it drops in for the old reference fields; `!Send + !Sync` via
/// `BackRef<JSGlobalObject>` (since `JSGlobalObject: !Sync`), matching
/// `JSGlobalObject`'s own auto-traits (single JS thread).
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct GlobalRef(bun_ptr::BackRef<JSGlobalObject>);

impl GlobalRef {
    #[inline(always)]
    pub fn new(global: &JSGlobalObject) -> Self {
        Self(bun_ptr::BackRef::new(global))
    }

    /// Raw FFI pointer (mut, matching `JSGlobalObject::as_ptr`).
    #[inline(always)]
    pub fn as_ptr(self) -> *mut JSGlobalObject {
        self.0.as_ptr()
    }
}

impl core::ops::Deref for GlobalRef {
    type Target = JSGlobalObject;
    #[inline(always)]
    fn deref(&self) -> &JSGlobalObject {
        // Constructed only from a live `&JSGlobalObject`; the global is owned
        // by the VM and outlives every JSC_BORROW holder (LIFETIMES.tsv).
        // `BackRef::get` encapsulates the single deref for what was previously
        // ~90 lifetime erasures to `'static`.
        self.0.get()
    }
}

impl From<&JSGlobalObject> for GlobalRef {
    #[inline(always)]
    fn from(g: &JSGlobalObject) -> Self {
        Self::new(g)
    }
}

impl core::fmt::Debug for GlobalRef {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("GlobalRef").field(&self.0).finish()
    }
}

impl JSGlobalObject {
    /// Alias of the macro-provided [`as_mut_ptr`](Self::as_mut_ptr) kept for
    /// call-site readability where mutation is not the intent (Zig passes
    /// `*JSGlobalObject` everywhere).
    #[inline(always)]
    pub fn as_ptr(&self) -> *mut JSGlobalObject {
        self.as_mut_ptr()
    }

    pub fn throw_stack_overflow(&self) -> JsError {
        // Wrap the raw FFI throw in a validation scope (mirrors `VM::throw_error`).
        // The Rust `#[bun_jsc::host_fn]` thunk inserts an `ExceptionValidationScope`
        // one frame above us that the Zig `toJSHostFn` does not; with that scope
        // present `~ThrowScope` inside `JSGlobalObject__throwStackOverflow` no
        // longer sees its previous scope as above `topEntryFrame`, so it
        // `simulateThrow()`s and leaves `m_needExceptionCheck` set. Observe the
        // exception here so the caller's scope dtor doesn't assert "unchecked
        // exception" under `BUN_JSC_validateExceptionChecks=1`.
        crate::validation_scope!(scope, self);
        JSGlobalObject__throwStackOverflow(self);
        scope.assert_exception_presence_matches(true);
        JsError::Thrown
    }

    pub fn throw_out_of_memory(&self) -> JsError {
        // See `throw_stack_overflow` for the validation-scope rationale.
        crate::validation_scope!(scope, self);
        JSGlobalObject__throwOutOfMemoryError(self);
        scope.assert_exception_presence_matches(true);
        JsError::Thrown
    }

    pub fn create_out_of_memory_error(&self) -> JSValue {
        JSGlobalObject__createOutOfMemoryError(self)
    }

    pub fn throw_out_of_memory_value(&self) -> JSValue {
        JSGlobalObject__throwOutOfMemoryError(self);
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
        // C++ `Bun__gregorianDateTimeToMS` is `[[ZIG_EXPORT(check_slow)]]`; the cppbind
        // wrapper opens a `top_scope!` and surfaces a thrown exception as `Err(JsError::Thrown)`.
        crate::cpp::Bun__gregorianDateTimeToMS(
            self,
            year,
            month,
            day,
            hour,
            minute,
            second,
            millisecond,
            true,
        )
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
        crate::cpp::Bun__gregorianDateTimeToMS(
            self,
            year,
            month,
            day,
            hour,
            minute,
            second,
            millisecond,
            false,
        )
    }

    pub fn ms_to_gregorian_date_time_utc(&self, ms: f64) -> GregorianDateTime {
        crate::mark_binding();
        let mut dt = GregorianDateTime::default();
        // SAFETY: FFI — &self is a valid JSGlobalObject*; out-param pointers are to live
        // stack locals (`dt` fields) and remain valid for the duration of the call.
        unsafe {
            crate::cpp::raw::Bun__msToGregorianDateTime(
                self as *const JSGlobalObject as *mut JSGlobalObject,
                ms,
                false,
                &raw mut dt.year,
                &raw mut dt.month,
                &raw mut dt.day,
                &raw mut dt.hour,
                &raw mut dt.minute,
                &raw mut dt.second,
                &raw mut dt.weekday,
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
        let name_value = match BunString::static_str("TODOError").to_js(self) {
            Ok(v) => v,
            Err(_) => return JsError::Thrown,
        };
        err.put(self, b"name", name_value);
        self.throw_value(err)
    }

    #[inline]
    pub fn request_termination(&self) {
        JSGlobalObject__requestTermination(self)
    }

    #[inline]
    pub fn clear_termination_exception(&self) {
        JSGlobalObject__clearTerminationException(self)
    }

    pub fn set_time_zone(&self, time_zone: &ZigString) -> bool {
        JSGlobalObject__setTimeZone(self, time_zone)
    }

    #[inline]
    pub fn to_js_value(&self) -> JSValue {
        // JSValue is #[repr(transparent)] over the encoded pointer-width word; encoding a
        // cell pointer is exactly Zig's `@enumFromInt(@intFromPtr(globalThis))`.
        JSValue::from_encoded(std::ptr::from_ref::<Self>(self) as usize)
    }

    pub fn throw_invalid_arguments(&self, args: Arguments<'_>) -> JsError {
        let err = self.to_invalid_arguments(args);
        self.throw_value(err)
    }

    /// Throw `TypeError: <name> is not constructable` with
    /// `.code = "ERR_ILLEGAL_CONSTRUCTOR"`.
    ///
    /// Canonical body for hand-written `pub fn constructor` stubs whose
    /// `.classes.ts` entry has `construct: true` but the class is not
    /// user-instantiable. Matches the C++ default
    /// (`JSDOMConstructorNotConstructable`, ErrorCode.cpp:2428) and Node.js.
    ///
    /// NOTE: do NOT add a stub that calls this when `.classes.ts` declares
    /// `noConstructor: true` / `construct: false` — codegen omits the
    /// `${T}Class__construct` thunk entirely, so the stub would be dead code.
    #[cold]
    pub fn throw_illegal_constructor(&self, name: &str) -> JsError {
        crate::ErrorCode::ILLEGAL_CONSTRUCTOR
            .throw(self, format_args!("{name} is not constructable"))
    }

    #[inline]
    pub fn throw_missing_arguments_value(&self, arg_names: &[&str]) -> JsError {
        // PORT NOTE: Zig version is comptime over `arg_names.len` (0 => @compileError).
        match arg_names.len() {
            0 => unreachable!("requires at least one argument"),
            1 => self
                .err(
                    JscError::MISSING_ARGS,
                    format_args!("The \"{}\" argument must be specified", arg_names[0]),
                )
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
        // PORT NOTE: Zig used std.fmt.comptimePrint here; const_format::formatcp!
        // requires the literals at the macro callsite, so we format at runtime.
        self.err(
            JscError::INVALID_ARG_TYPE,
            format_args!("Expected {} to be a {} for '{}'.", field, typename, name_),
        )
        .to_js()
    }

    pub fn to_js<T: Into<JSValue>>(&self, value: T) -> JsResult<JSValue> {
        // PORT NOTE: Zig `JSValue.fromAny(this, @TypeOf(value), value)` reflects on the
        // type. Rust callers go through `From<T> for JSValue` impls (i32, f64, bool, …).
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
        // `defer actual_string_value.deref()` → OwnedString's Drop releases the +1 ref.
        let actual_string_value = match Self::determine_specific_type(self, value) {
            Ok(s) => s,
            Err(e) => return e,
        };
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

    /// Returns a +1-ref'd `BunString` describing `value`'s type for error messages.
    /// The result is wrapped in [`OwnedString`] so the ref is released on drop —
    /// `bun_core::String` is `Copy` and has no `Drop`, so a bare `BunString`
    /// here would leak (Zig spec does `defer actual_string_value.deref()`).
    pub fn determine_specific_type(global: &Self, value: JSValue) -> JsResult<OwnedString> {
        // The C++ side opens a `DECLARE_THROW_SCOPE`; under
        // `BUN_JSC_validateExceptionChecks=1` its dtor sets `m_needExceptionCheck`, so we
        // must have a Rust-side scope live across the FFI call (and query it) rather than
        // post-hoc `has_exception()` (whose own scope ctor would assert first).
        crate::top_scope!(scope, global);
        // `errdefer str.deref()` → wrapping immediately in OwnedString releases the
        // +1 ref on the early-return path below.
        let str = OwnedString::new(Bun__ErrorCode__determineSpecificType(global, value));
        scope.return_if_exception()?;
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
        let err = bun_boringssl::c::ERR_peek_last_error();
        if err != 0 {
            let mut buf = [0u8; 256];
            // SAFETY: FFI — `buf` is a 256-byte stack buffer; `len` matches its capacity;
            // ERR_error_string_n NUL-terminates within `len` bytes.
            unsafe {
                bun_boringssl::c::ERR_error_string_n(
                    err,
                    buf.as_mut_ptr().cast::<c_char>(),
                    buf.len(),
                )
            };
            // Slice up to the NUL terminator (matches Zig's `[:0]u8` slice semantics).
            let msg = bun_core::slice_to_nul(&buf);
            return self
                .err(
                    JscError::CRYPTO_INVALID_SCRYPT_PARAMS,
                    format_args!("Invalid scrypt params: {}", bstr::BStr::new(msg)),
                )
                .throw();
        }

        self.err(
            JscError::CRYPTO_INVALID_SCRYPT_PARAMS,
            format_args!("Invalid scrypt params"),
        )
        .throw()
    }

    /// "The {argname} argument must be of type {typename}. Received {value}"
    ///
    /// Accepts `&str`, `&[u8]`, or `b"..."` for `argname`/`typename` — Zig call
    /// sites pass `[]const u8` literals, so the Rust port takes `AsRef<[u8]>`.
    pub fn throw_invalid_argument_type_value(
        &self,
        argname: impl AsRef<[u8]>,
        typename: impl AsRef<[u8]>,
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
                bstr::BStr::new(argname.as_ref()),
                bstr::BStr::new(typename.as_ref()),
                actual_string_value
            ),
        )
        .throw()
    }

    pub fn throw_invalid_argument_type_value2(
        &self,
        argname: impl AsRef<[u8]>,
        typename: impl AsRef<[u8]>,
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
                bstr::BStr::new(argname.as_ref()),
                bstr::BStr::new(typename.as_ref()),
                actual_string_value
            ),
        )
        .throw()
    }

    /// `validators.throwErrInvalidArgType` —
    /// `The "<name>" property must be of type <expected>, got <actual>`
    /// where `<actual>` is the JS `typeof` (or `"array"` for arrays).
    pub fn throw_invalid_property_type(
        &self,
        name: impl AsRef<[u8]>,
        expected_type: &str,
        value: JSValue,
    ) -> JsError {
        let actual_type = if value.js_type().is_array() {
            bun_core::ZigString::static_(b"array")
        } else {
            value.js_type_string(self).get_zig_string(self)
        };
        self.err(
            JscError::INVALID_ARG_TYPE,
            format_args!(
                "The \"{}\" property must be of type {}, got {}",
                bstr::BStr::new(name.as_ref()),
                expected_type,
                actual_type,
            ),
        )
        .throw()
    }

    /// "The <argname> argument must be one of type <typename>. Received <value>"
    pub fn throw_invalid_argument_type_value_one_of(
        &self,
        argname: impl AsRef<[u8]>,
        typename: impl AsRef<[u8]>,
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
                bstr::BStr::new(argname.as_ref()),
                bstr::BStr::new(typename.as_ref()),
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
        // `defer ty_str.deinit()` → `ZigStringSlice` is RAII: `Owned` frees
        // its `Vec<u8>`, `WTF` derefs the backing `WTFStringImpl` in `Drop`.
        let ty_str = value.js_type_string(self).to_slice(self);
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
        crate::cpp::JSC__JSGlobalObject__reload(self)
    }

    pub fn run_on_load_plugins(
        &self,
        namespace_: BunString,
        path: BunString,
        target: BunPluginTarget,
    ) -> JsResult<Option<JSValue>> {
        crate::mark_binding();
        let ns = (namespace_.length() > 0).then_some(&namespace_);
        let result =
            crate::from_js_host_call(self, || Bun__runOnLoadPlugins(self, ns, &path, target))?;
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
        let ns = (namespace_.length() > 0).then_some(&namespace_);
        let result = crate::from_js_host_call(self, || {
            Bun__runOnResolvePlugins(self, ns, &path, &source, target)
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
        use core::fmt::Write;
        if write!(WriteVec(&mut buf), "{}", args).is_err() {
            // if an exception occurs in the middle of formatting the error message, it's better to just return the formatting string than an error about an error.
            // Clear any pending JS exception (e.g. from Symbol.toPrimitive) so that throwValue doesn't hit assertNoException.
            let _ = self.clear_exception_except_termination();
            return ZigString::init_utf8(&buf).to_error_instance(self);
        }

        // Ensure we clone it.
        let str = ZigString::init_utf8(&buf);
        str.to_error_instance(self)
    }

    pub fn create_type_error_instance(&self, args: Arguments<'_>) -> JSValue {
        if let Some(fmt) = args.as_str() {
            return ZigString::init(fmt.as_bytes()).to_type_error_instance(self);
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use core::fmt::Write;
        if write!(WriteVec(&mut buf), "{}", args).is_err() {
            let _ = self.clear_exception_except_termination();
            return ZigString::from_utf8(&buf).to_type_error_instance(self);
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
            return Ok(ZigString::init(fmt.as_bytes()).to_dom_exception_instance(self, code));
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use core::fmt::Write;
        write!(WriteVec(&mut buf), "{}", args).map_err(|_| JsError::Thrown)?;
        let str = ZigString::from_utf8(&buf);
        Ok(str.to_dom_exception_instance(self, code))
    }

    pub fn create_syntax_error_instance(&self, args: Arguments<'_>) -> JSValue {
        if let Some(fmt) = args.as_str() {
            return ZigString::init(fmt.as_bytes()).to_syntax_error_instance(self);
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use core::fmt::Write;
        if write!(WriteVec(&mut buf), "{}", args).is_err() {
            let _ = self.clear_exception_except_termination();
            return ZigString::from_utf8(&buf).to_syntax_error_instance(self);
        }
        let str = ZigString::from_utf8(&buf);
        str.to_syntax_error_instance(self)
    }

    pub fn create_range_error_instance(&self, args: Arguments<'_>) -> JSValue {
        if let Some(fmt) = args.as_str() {
            return ZigString::init(fmt.as_bytes()).to_range_error_instance(self);
        }
        // PERF(port): was stack-fallback (4KB) + MutableString.init2048.
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        use core::fmt::Write;
        if write!(WriteVec(&mut buf), "{}", args).is_err() {
            let _ = self.clear_exception_except_termination();
            return ZigString::from_utf8(&buf).to_range_error_instance(self);
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
            b"code",
            ZigString::init(<&'static str>::from(NodeErrorCode::ERR_OUT_OF_RANGE).as_bytes())
                .to_js(self),
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
            ZigString::init(<&'static str>::from(opts.code).as_bytes()).to_js(self),
        );
        if let Some(name) = opts.name {
            err.put(self, b"name", ZigString::init(name).to_js(self));
        }
        if let Some(errno) = opts.errno {
            err.put(self, b"errno", JSValue::from(errno));
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
        // PORT NOTE: Zig switched on `Output.enable_ansi_colors_stderr` and
        // rewrote the *format string* at comptime (`Output.prettyFmt(fmt,
        // enabled)`). Rust can't rewrite the format string of an
        // already-captured `Arguments<'_>`, so render first, then run the
        // `<tag>` → ANSI/strip pass at runtime via `pretty_fmt_rt`.
        //
        // Zig routed through `createErrorInstance` which catches a mid-format
        // `WriteFailed` (e.g. user `Symbol.toPrimitive` throws while
        // stringifying the Received value). `pretty_fmt_rt` would `format!`
        // into a `String`, and `format!` panics if a `Display` impl returns
        // `fmt::Error` when the underlying writer didn't — so render via
        // fallible `write!` here and mirror Zig's catch: clear the pending JS
        // exception and throw with whatever was written so far.
        let enabled = Output::enable_ansi_colors_stderr();
        use core::fmt::Write;
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        if write!(WriteVec(&mut buf), "{}", args).is_err() {
            // if an exception occurs in the middle of formatting the error
            // message, it's better to just return what we have than an error
            // about an error. Clear any pending JS exception (e.g. from
            // Symbol.toPrimitive) so that throwValue doesn't hit
            // assertNoException.
            let _ = self.clear_exception_except_termination();
        }
        let pretty = Output::pretty_fmt_rt(buf.as_slice(), enabled);
        let instance = ZigString::init_utf8(&pretty).to_error_instance(self);
        if instance.is_empty() {
            debug_assert!(self.has_exception());
            return JsError::Thrown;
        }
        self.throw_value(instance)
    }

    /// Queue a native callback as a microtask. The Zig version monomorphises a
    /// `callconv(.c)` trampoline at comptime over `Function`; in Rust callers
    /// supply the C-ABI trampoline directly so the wrapper need only erase the
    /// context pointer type.
    pub fn queue_microtask_callback<C>(
        &self,
        ctx_val: *mut C,
        function: unsafe extern "C" fn(*mut c_void),
    ) {
        crate::mark_binding();
        JSC__JSGlobalObject__queueMicrotaskCallback(self, ctx_val.cast::<c_void>(), function);
    }

    pub fn queue_microtask(&self, function: JSValue, args: &[JSValue]) {
        self.queue_microtask_job(
            function,
            args.get(0).copied().unwrap_or(JSValue::ZERO),
            args.get(1).copied().unwrap_or(JSValue::ZERO),
        );
    }

    pub fn emit_warning(
        &self,
        warning: JSValue,
        type_: JSValue,
        code: JSValue,
        ctor: JSValue,
    ) -> JsResult<()> {
        crate::from_js_host_call_generic(self, || {
            Bun__Process__emitWarning(self, warning, type_, code, ctor)
        })
    }

    pub fn queue_microtask_job(&self, function: JSValue, first: JSValue, second: JSValue) {
        JSC__JSGlobalObject__queueMicrotaskJob(self, function, first, second)
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
        use core::fmt::Write;
        if write!(WriteVec(&mut buffer), "{} {}", err.name(), fmt).is_err() {
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
        message: &bun_core::ZigString,
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
        crate::from_js_host_call(self, || {
            JSC__JSGlobalObject__createAggregateErrorWithArray(
                self,
                error_array,
                message,
                JSValue::UNDEFINED,
            )
        })
    }

    pub fn generate_heap_snapshot(&self) -> JSValue {
        JSC__JSGlobalObject__generateHeapSnapshot(self)
    }

    /// DEPRECATED — use [`TopExceptionScope`](crate::TopExceptionScope) to check for exceptions
    /// and signal exceptions by returning `JsError`.
    ///
    /// **Under `BUN_JSC_validateExceptionChecks=1`**: the C++ side
    /// (`JSGlobalObject__hasException`) constructs a temporary `TopExceptionScope`, whose
    /// ctor *does* call `verifyExceptionCheckNeedIsSatisfied` — so this asserts if
    /// `vm.m_needExceptionCheck` was left set by a prior un-scoped FFI call. The remaining
    /// call sites in the port (1:1 with the `.zig` spec) follow `JsResult`-returning helpers
    /// that already opened a scope and cleared the bit, so they are sound. New code must not
    /// pair this with a raw `extern "C"` throwing call — use the generated
    /// [`crate::cpp`] wrappers or [`top_scope!`](crate::top_scope) instead.
    pub fn has_exception(&self) -> bool {
        JSGlobalObject__hasException(self)
    }

    pub fn clear_exception(&self) {
        JSGlobalObject__clearException(self)
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
        JSGlobalObject__clearExceptionExceptTermination(self)
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
            panic!(
                "A JavaScript exception was thrown, but it was cleared before it could be read."
            );
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
                panic!(
                    "A JavaScript exception was thrown, but it was cleared before it could be read."
                );
            })
            .to_error()
            .unwrap_or_else(|| {
                panic!("Couldn't convert a JavaScript exception to an Error instance.");
            })
    }

    pub fn try_take_exception(&self) -> Option<JSValue> {
        let value = JSGlobalObject__tryTakeException(self);
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
            let _ = self
                .bun_vm()
                .as_mut()
                .uncaught_exception(self, exception, false);
        }
    }

    pub fn vm(&self) -> &VM {
        // JSC guarantees the VM outlives the global object; `VM` is an opaque
        // ZST handle so the deref is the centralised `opaque_ref` proof.
        VM::opaque_ref(JSC__JSGlobalObject__vm(self))
    }

    /// Raw `*mut JSC::VM` for FFI predicates that take a VM pointer
    /// (e.g. [`JSValue::as_exception`]). C++ does not write through it.
    #[inline]
    pub fn vm_ptr(&self) -> *mut VM {
        JSC__JSGlobalObject__vm(self)
    }

    pub fn delete_module_registry_entry(&self, name_: &ZigString) -> JsResult<()> {
        crate::from_js_host_call_generic(self, || {
            JSC__JSGlobalObject__deleteModuleRegistryEntry(self, name_)
        })
    }

    fn bun_vm_unsafe(&self) -> *mut c_void {
        JSC__JSGlobalObject__bunVM(self)
    }

    /// Raw-pointer variant of [`Self::bun_vm`]. Returns the per-thread
    /// `*mut VirtualMachine` so callers that need to mutate VM fields don't
    /// launder provenance through `&VirtualMachine -> *mut` (UB under Stacked
    /// Borrows). Spec `JSGlobalObject.zig:617` returns `*VirtualMachine`
    /// (mutable); this preserves that intent.
    ///
    /// Reads the thread-local directly (one `mov fs:[OFF]`) instead of calling
    /// `JSC__JSGlobalObject__bunVM`: cross-language LTO does not inline that
    /// C++ shim into Rust callers (905 out-of-line `callq` sites in the
    /// release binary vs the symbol not even existing in the Zig build), and
    /// the FFI result is provably the same singleton — debug-asserted below
    /// and in [`Self::bun_vm`]. Same-thread callers only; cross-thread paths
    /// must use [`Self::bun_vm_concurrently`].
    #[inline]
    pub fn bun_vm_ptr(&self) -> *mut VirtualMachine {
        debug_assert!(
            self.bun_vm_unsafe() == VirtualMachine::get_mut_ptr().cast::<c_void>(),
            "bun_vm_ptr called off the JS thread; use bun_vm_concurrently",
        );
        VirtualMachine::get_mut_ptr()
    }

    /// Shared-reference accessor for the Bun `VirtualMachine`. Alias of
    /// [`bun_vm`](Self::bun_vm) kept for call-site compatibility.
    #[inline]
    pub fn bun_vm_ref(&self) -> &'static VirtualMachine {
        self.bun_vm()
    }

    /// Returns the Bun `VirtualMachine` owning this global as a safe
    /// `&'static`. The VM is a per-thread singleton allocated once in
    /// `VirtualMachine::init` and never freed while a global exists, so the
    /// `'static` lifetime is sound. Mutation goes through
    /// [`JsCell`](crate::JsCell)-wrapped fields or
    /// [`VirtualMachine::as_mut`]; legacy raw-pointer paths use
    /// [`Self::bun_vm_ptr`].
    ///
    /// Reads the thread-local directly instead of calling
    /// `JSC__JSGlobalObject__bunVM` — cross-language LTO does not inline the
    /// C++ shim, and the two are address-equal by construction (asserted in
    /// debug builds). Same-thread callers only; cross-thread paths must use
    /// [`Self::bun_vm_concurrently`].
    #[inline]
    pub fn bun_vm(&self) -> &'static VirtualMachine {
        #[cfg(debug_assertions)]
        {
            // if this fails
            // you most likely need to run
            //   make clean-jsc-bindings
            //   make bindings -j10
            if let Some(vm_) = VirtualMachine::get_or_null() {
                // SAFETY: address-equality only — neither pointer is dereferenced.
                debug_assert!(self.bun_vm_unsafe() == vm_.cast::<c_void>());
            } else {
                panic!("This thread lacks a Bun VM");
            }
        }
        VirtualMachine::get()
    }

    pub fn try_bun_vm(&self) -> (*mut VirtualMachine, ThreadKind) {
        let vm_ptr = self.bun_vm_unsafe().cast::<VirtualMachine>();

        if let Some(vm_) = VirtualMachine::get_or_null() {
            #[cfg(debug_assertions)]
            {
                // SAFETY: address-equality only — neither pointer is dereferenced.
                debug_assert!(self.bun_vm_unsafe() == vm_.cast::<c_void>());
            }
            let _ = vm_;
        } else {
            return (vm_ptr, ThreadKind::Other);
        }

        (vm_ptr, ThreadKind::Main)
    }

    /// We can't do the threadlocal check when queued from another thread
    pub fn bun_vm_concurrently(&self) -> *mut VirtualMachine {
        self.bun_vm_unsafe().cast::<VirtualMachine>()
    }

    pub fn handle_rejected_promises(&self) {
        // JSC__JSGlobalObject__handleRejectedPromises catches and reports its
        // own exceptions; the only thing that escapes is a TerminationException
        // (worker terminate() or process.exit()), and the request flag may
        // already be cleared by the time we observe it. Nothing actionable here.
        let _ = crate::from_js_host_call_generic(self, || {
            JSC__JSGlobalObject__handleRejectedPromises(self)
        });
    }

    pub fn readable_stream_to_array_buffer(&self, value: JSValue) -> JSValue {
        ZigGlobalObject__readableStreamToArrayBuffer(self, value)
    }

    pub fn readable_stream_to_bytes(&self, value: JSValue) -> JSValue {
        ZigGlobalObject__readableStreamToBytes(self, value)
    }

    pub fn readable_stream_to_text(&self, value: JSValue) -> JSValue {
        ZigGlobalObject__readableStreamToText(self, value)
    }

    pub fn readable_stream_to_json(&self, value: JSValue) -> JSValue {
        ZigGlobalObject__readableStreamToJSON(self, value)
    }

    pub fn readable_stream_to_blob(&self, value: JSValue) -> JSValue {
        ZigGlobalObject__readableStreamToBlob(self, value)
    }

    pub fn readable_stream_to_form_data(&self, value: JSValue, content_type: JSValue) -> JSValue {
        ZigGlobalObject__readableStreamToFormData(self, value, content_type)
    }

    /// Returns a freshly-created `napi_env` owned by this global, for use by
    /// the FFI module. The concrete `NapiEnv` struct lives in `bun_runtime`
    /// (which depends on `bun_jsc`), so this returns the raw pointer untyped;
    /// callers in `bun_runtime` cast to `*mut NapiEnv`.
    pub fn make_napi_env_for_ffi(&self) -> *mut c_void {
        ZigGlobalObject__makeNapiEnvForFFI(self)
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
            return Err(self.throw_invalid_argument_type_value(
                arg_name.as_bytes(),
                b"object",
                value,
            ));
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
                    i64::try_from(min_t).expect("int cast"),
                    i64::try_from(max_t).expect("int cast"),
                ) {
                    return Ok(T::from_i64(value.to_int64()));
                }
            } else {
                if value.is_big_int_in_uint64_range(
                    u64::try_from(min_t).expect("int cast"),
                    u64::try_from(max_t).expect("int cast"),
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

        // PORT NOTE: comptime { if (min_t > max_t) @compileError(...) } — became debug_assert.
        debug_assert!(min_t <= max_t, "max must be less than min");

        let field_name = range.field_name;
        // PORT NOTE: comptime field_name.len == 0 → @compileError.
        debug_assert!(!field_name.is_empty(), "field_name must not be empty");
        let always_allow_zero = range.always_allow_zero;
        // Zig passes the *unclamped* `range.min`/`range.max` to `throwRangeError`
        // (not `min_t`/`max_t`). Zig's `comptime` guaranteed these fit in the
        // formatter's `i64` range; preserve that as a checked narrowing so an
        // out-of-range bound surfaces as a panic rather than silent wrap.
        let min = i64::try_from(range.min)
            .expect("validate_integer_range: range.min exceeds i64 (Zig comptime invariant)");
        let max = i64::try_from(range.max)
            .expect("validate_integer_range: range.max exceeds i64 (Zig comptime invariant)");

        if value.is_int32() {
            let int = value.to_int32();
            if always_allow_zero && int == 0 {
                return Ok(T::ZERO);
            }
            if i128::from(int) < min_t || i128::from(int) > max_t {
                return Err(self.throw_range_error(
                    i64::from(int),
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
        // `JSValue::get` already returns `JsResult` (scoped internally), so the
        // post-hoc `has_exception()` the Zig spec carried is dead here — `Err(_)`
        // covers the throw path and `Ok(None)` is by definition exception-free.
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
        CommonStrings {
            global_object: self,
        }
    }

    /// Throw an error from within the Bun runtime.
    ///
    /// The set of errors accepted by `err()` is defined in `ErrorCode.ts`.
    pub fn err<'a>(&'a self, code: JscError, args: Arguments<'a>) -> ErrorBuilder<'a, Self> {
        // PORT NOTE: Zig `ERR` returns a comptime-monomorphized `ErrorBuilder(code, fmt, @TypeOf(args))`.
        // The Rust ErrorBuilder carries the code + Arguments at runtime.
        ErrorBuilder {
            global: self,
            code,
            args,
        }
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

        // SAFETY: caller passes the live VM under construction; event_loop()
        // returns a raw self-pointer that we mutate once to install the waker.
        unsafe { (*(*v).event_loop()).ensure_waker() };
        // C++ creates and returns a non-null global object; `console`/`worker_ptr`
        // are opaque round-trip pointers C++ stores into the new global.
        let global = Zig__GlobalObject__create(
            console,
            context_id,
            mini_mode,
            eval_mode,
            worker_ptr.unwrap_or(core::ptr::null_mut()),
        );

        // JSC might mess with the stack size.
        StackCheck::configure_thread();

        global
    }

    pub fn create_for_test_isolation(
        old_global: &JSGlobalObject,
        console: *mut c_void,
    ) -> *mut JSGlobalObject {
        Zig__GlobalObject__createForTestIsolation(old_global, console)
    }

    pub fn get_module_registry_map(global: &JSGlobalObject) -> *mut c_void {
        Zig__GlobalObject__getModuleRegistryMap(global)
    }

    pub fn reset_module_registry_map(global: &JSGlobalObject, map: *mut c_void) -> bool {
        // `map` is an opaque round-trip pointer previously returned by
        // `get_module_registry_map` (C++ owns it; never dereferenced as Rust data).
        Zig__GlobalObject__resetModuleRegistryMap(global, map)
    }

    pub fn report_uncaught_exception_from_error(&self, proof: JsError) {
        crate::mark_binding();
        let exc = self
            .take_exception(proof)
            .as_exception(std::ptr::from_ref::<VM>(self.vm()).cast_mut())
            .expect("exception value must be an Exception cell");
        // `as_exception` returned a non-null cell pointer rooted on the VM;
        // `Exception` is an opaque ZST handle — safe deref (panics on null).
        let _ = report_uncaught_exception(self, crate::Exception::opaque_ref(exc));
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
        use core::fmt::Write;
        write!(WriteVec(&mut buf), "{}", args).expect("unreachable");
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

    pub fn script_execution_context_identifier(&self) -> ScriptExecutionContextIdentifier {
        ScriptExecutionContextIdentifier(ScriptExecutionContextIdentifier__forGlobalObject(self))
    }

    pub const EXTERN: [&'static str; 3] =
        ["create", "getModuleRegistryMap", "resetModuleRegistryMap"];
}

// ──────────────────────────────────────────────────────────────────────────────
// Nested types (moved out of `impl` since Rust impls cannot contain type defs).
// ──────────────────────────────────────────────────────────────────────────────

// Unified with the crate-root definition (lib.rs) so callers importing
// `bun_jsc::GregorianDateTime` and `bun_jsc::js_global_object::GregorianDateTime`
// see one nominal type (the previous local duplicate diverged from lib.rs).
pub use crate::GregorianDateTime;

/// Spec `JSGlobalObject.BunPluginTarget` (JSGlobalObject.zig:265). The enum is
/// defined once in `bun_bundler::transpiler` (the lowest tier that names it,
/// for `Linker::link`'s call into `PluginResolver::on_resolve`) and re-exported
/// here so the C++ FFI signature and all `bun_jsc` callers share one nominal
/// type — no mirror enum, no transmute.
pub use bun_bundler::transpiler::BunPluginTarget;

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

// Unified with the crate-root definitions (lib.rs) — re-exported here so
// `bun_jsc::js_global_object::{IntegerRange, ValidateObjectOpts}` keep
// resolving for any caller that named them via this path. The previous local
// `ValidateObjectOpts` diverged from lib.rs (`nullable` vs `allow_nullable`),
// splitting the public API across two incompatible structs.
pub use crate::{IntegerRange, ValidateObjectOpts};

/// `bun.webcore.ScriptExecutionContext.Identifier` (ported here, not in
/// `bun_runtime`, because `JSGlobalObject::script_execution_context_identifier`
/// must return it without a forward dep). `bun_runtime::webcore` re-exports
/// this and layers `global_object()` / `bun_vm()` accessors on top.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct ScriptExecutionContextIdentifier(pub u32);

impl From<u32> for ScriptExecutionContextIdentifier {
    #[inline]
    fn from(id: u32) -> Self {
        Self(id)
    }
}
impl From<ScriptExecutionContextIdentifier> for u32 {
    #[inline]
    fn from(id: ScriptExecutionContextIdentifier) -> u32 {
        id.0
    }
}

use bun_core::fmt::VecWriter as WriteVec;

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
    // SAFETY: C++ passes valid non-null pointers. `BunString` is `Copy`, so
    // `*specifier` / `*source` is the bitwise load Zig spells as `specifier.*`
    // — no refcount bump (the caller still owns the ref).
    let (global, specifier, source) = unsafe { (&*global, *specifier, *source) };
    // SAFETY: C++ passes valid non-null pointers.
    let (res, query) = unsafe { (&mut *res, &mut *query) };
    match VirtualMachine::resolve(res, global, specifier, source, Some(query), true) {
        Ok(()) => {}
        Err(_) => {
            debug_assert!(!res.success);
        }
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
    Output::flush();
    panic!("A C++ exception occurred");
}

// PORT NOTE (LAYERING): `getBodyStreamOrBytesForWasmStreaming` deals entirely
// in `webcore` types (`Response`, `Body.Value`, `Blob`, `ReadableStream`)
// which live in `bun_runtime`. The exported `extern "C"` symbol
// `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming` is therefore
// defined in `bun_runtime::webcore::wasm_streaming` rather than here, to
// avoid a forward dep cycle. See `src/runtime/webcore/wasm_streaming.rs`.

// ──────────────────────────────────────────────────────────────────────────────
// extern "C" declarations
// ──────────────────────────────────────────────────────────────────────────────
// `safe fn`: parameters are either value types (`JSValue`, scalars) or Rust
// references (`&JSGlobalObject`, `&ZigString`) which are ABI-identical to
// non-null pointers and carry the validity guarantee the C++ side requires.
// Functions taking nullable raw pointers / `(ptr,len)` pairs / opaque ctx that
// the C++ side dereferences stay `unsafe` and are wrapped at the call site.
unsafe extern "C" {
    safe fn JSGlobalObject__throwStackOverflow(this: &JSGlobalObject);
    safe fn JSGlobalObject__throwOutOfMemoryError(this: &JSGlobalObject);
    safe fn JSGlobalObject__createOutOfMemoryError(this: &JSGlobalObject) -> JSValue;

    safe fn Bun__ErrorCode__determineSpecificType(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> BunString;

    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `Option<&BunString>` is ABI-identical
    // to a nullable `*const BunString` via the guaranteed null-pointer
    // optimization (C++ reads `nullptr` as "no namespace"); `&BunString` is a
    // non-null `*const BunString` borrow.
    safe fn Bun__runOnLoadPlugins(
        global: &JSGlobalObject,
        namespace_: Option<&BunString>,
        path: &BunString,
        target: BunPluginTarget,
    ) -> JSValue;
    safe fn Bun__runOnResolvePlugins(
        global: &JSGlobalObject,
        namespace_: Option<&BunString>,
        path: &BunString,
        source: &BunString,
        target: BunPluginTarget,
    ) -> JSValue;

    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `ctx` is an opaque round-trip pointer
    // C++ only stores and forwards to `function` (never dereferenced as Rust data).
    safe fn JSC__JSGlobalObject__queueMicrotaskCallback(
        this: &JSGlobalObject,
        ctx: *mut c_void,
        function: unsafe extern "C" fn(*mut c_void),
    );

    safe fn Bun__Process__emitWarning(
        global_object: &JSGlobalObject,
        warning: JSValue,
        type_: JSValue,
        code: JSValue,
        ctor: JSValue,
    );

    safe fn JSC__JSGlobalObject__queueMicrotaskJob(
        this: &JSGlobalObject,
        function: JSValue,
        first: JSValue,
        second: JSValue,
    );

    fn JSC__JSGlobalObject__createAggregateError(
        global: &JSGlobalObject,
        errors: *const JSValue,
        len: usize,
        message: &bun_core::ZigString,
    ) -> JSValue;
    safe fn JSC__JSGlobalObject__createAggregateErrorWithArray(
        global: &JSGlobalObject,
        error_array: JSValue,
        message: BunString,
        options: JSValue,
    ) -> JSValue;
    safe fn JSC__JSGlobalObject__generateHeapSnapshot(this: &JSGlobalObject) -> JSValue;

    safe fn JSC__JSGlobalObject__handleRejectedPromises(this: &JSGlobalObject);

    safe fn ZigGlobalObject__readableStreamToArrayBuffer(
        this: &JSGlobalObject,
        value: JSValue,
    ) -> JSValue;
    safe fn ZigGlobalObject__readableStreamToBytes(
        this: &JSGlobalObject,
        value: JSValue,
    ) -> JSValue;
    safe fn ZigGlobalObject__readableStreamToText(this: &JSGlobalObject, value: JSValue)
    -> JSValue;
    safe fn ZigGlobalObject__readableStreamToJSON(this: &JSGlobalObject, value: JSValue)
    -> JSValue;
    safe fn ZigGlobalObject__readableStreamToFormData(
        this: &JSGlobalObject,
        value: JSValue,
        content_type: JSValue,
    ) -> JSValue;
    safe fn ZigGlobalObject__readableStreamToBlob(this: &JSGlobalObject, value: JSValue)
    -> JSValue;

    safe fn ZigGlobalObject__makeNapiEnvForFFI(this: &JSGlobalObject) -> *mut c_void;

    safe fn JSC__JSGlobalObject__bunVM(this: &JSGlobalObject) -> *mut c_void;
    safe fn JSC__JSGlobalObject__vm(this: &JSGlobalObject) -> *mut VM;
    safe fn JSC__JSGlobalObject__deleteModuleRegistryEntry(
        this: &JSGlobalObject,
        name_: &ZigString,
    );
    safe fn JSGlobalObject__clearException(this: &JSGlobalObject);
    safe fn JSGlobalObject__clearExceptionExceptTermination(this: &JSGlobalObject) -> bool;
    safe fn JSGlobalObject__clearTerminationException(this: &JSGlobalObject);
    safe fn JSGlobalObject__hasException(this: &JSGlobalObject) -> bool;
    safe fn JSGlobalObject__setTimeZone(this: &JSGlobalObject, time_zone: &ZigString) -> bool;
    safe fn JSGlobalObject__tryTakeException(this: &JSGlobalObject) -> JSValue;
    safe fn JSGlobalObject__requestTermination(this: &JSGlobalObject);

    // safe: `console`/`worker_ptr` are opaque round-trip pointers C++ stores into
    // the new ZigGlobalObject (never dereferenced as Rust data here — same
    // contract as `Zig__GlobalObject__createForTestIsolation` below); remaining
    // args are by-value scalars.
    safe fn Zig__GlobalObject__create(
        console: *mut c_void,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: *mut c_void,
    ) -> *mut JSGlobalObject;

    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `console` is an opaque pointer C++
    // stores into the new global (never dereferenced as Rust data here).
    safe fn Zig__GlobalObject__createForTestIsolation(
        old_global: &JSGlobalObject,
        console: *mut c_void,
    ) -> *mut JSGlobalObject;

    safe fn Zig__GlobalObject__getModuleRegistryMap(global: &JSGlobalObject) -> *mut c_void;
    // safe: `map` is the opaque round-trip pointer returned by
    // `getModuleRegistryMap` (C++ owns it; never dereferenced as Rust data).
    safe fn Zig__GlobalObject__resetModuleRegistryMap(
        global: &JSGlobalObject,
        map: *mut c_void,
    ) -> bool;

    safe fn ScriptExecutionContextIdentifier__forGlobalObject(global: &JSGlobalObject) -> u32;
}

// ported from: src/jsc/JSGlobalObject.zig

impl ScriptExecutionContextIdentifier {
    /// Returns `None` if the context referred to by `self` no longer exists.
    pub fn global_object(self) -> Option<GlobalRef> {
        // FFI call returns a valid pointer or null; the JSGlobalObject is owned
        // by the VM and outlives any ScriptExecutionContext id pointing at it.
        // `JSGlobalObject` is an opaque ZST handle so the deref is the
        // centralised `opaque_ref` proof.
        let p = ScriptExecutionContextIdentifier__getGlobalObject(self.0);
        (!p.is_null()).then(|| GlobalRef::from(JSGlobalObject::opaque_ref(p)))
    }

    /// Returns `None` if the context referred to by `self` no longer exists.
    /// Concurrently-safe (`bun_vm_concurrently`) because identifiers are mostly
    /// used from off-thread tasks.
    pub fn bun_vm(self) -> Option<*mut VirtualMachine> {
        Some(self.global_object()?.bun_vm_concurrently())
    }

    pub fn valid(self) -> bool {
        self.global_object().is_some()
    }
}

unsafe extern "C" {
    // safe: by-value `u32` in, raw nullable pointer out (caller checks before deref).
    safe fn ScriptExecutionContextIdentifier__getGlobalObject(id: u32) -> *mut JSGlobalObject;
}
