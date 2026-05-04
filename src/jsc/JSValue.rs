//! ABI-compatible with EncodedJSValue.
//! In the future, this type will exclude `zero`, encoding it as `error.JSError` instead.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

use bun_core::Output;
use bun_jsc::ffi as FFI; // src/jsc/FFI.zig
use bun_jsc::{
    self as jsc, AnyPromise, ArrayBuffer, DOMURL, JSArrayIterator, JSCell, JSGlobalObject,
    JSInternalPromise, JSObject, JSPromise, JSString, JsError, JsResult, TopExceptionScope, VM,
    ZigException, from_js_host_call, from_js_host_call_generic, to_js_host_fn,
};
use bun_jsc::c_api as C_API;
use bun_runtime::webcore::FetchHeaders;
use bun_str::{self, String as BunString, ZigString};
use bun_test_runner::pretty_format::JestPrettyFormat;

pub use crate::js_type::JSType;

/// ABI-compatible with EncodedJSValue (`#[repr(transparent)] i64`, `Copy`, `!Send`).
/// `PhantomData<*const ()>` enforces `!Send + !Sync` (negative impls are nightly-only).
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct JSValue(pub i64, PhantomData<*const ()>);

pub type BackingInt = i64;

impl JSValue {
    // fields here are prefixed in Zig so they're not accidentally mixed up with Zig's
    // undefined/null/etc. In Rust we use associated consts.
    pub const UNDEFINED: JSValue = JSValue(0xa, PhantomData);
    pub const NULL: JSValue = JSValue(0x2, PhantomData);
    pub const TRUE: JSValue = JSValue(FFI::TRUE_I64, PhantomData);
    pub const FALSE: JSValue = JSValue(0x6, PhantomData);

    // TODO: Remove
    /// Typically means an exception was thrown.
    pub const ZERO: JSValue = JSValue(0, PhantomData);

    // TODO: Remove
    /// This corresponds to `JSValue::ValueDeleted` in C++. It is never OK to use
    /// this value except in the return value of `JSC__JSValue__getIfPropertyExistsImpl`
    /// and `JSC__JSValue__fastGet`.
    ///
    /// Deleted is a special encoding used in JSC hash map internals used for
    /// the null state. It is re-used here for encoding the "not present" state
    /// in `JSC__JSValue__getIfPropertyExistsImpl`.
    pub const PROPERTY_DOES_NOT_EXIST_ON_OBJECT: JSValue = JSValue(0x4, PhantomData);

    pub const IS_POINTER: bool = false;

    #[inline]
    pub const fn from_raw(raw: i64) -> JSValue {
        JSValue(raw, PhantomData)
    }

    #[inline]
    pub const fn raw(self) -> i64 {
        self.0
    }
}

// `pub fn format(...) !void { @compileError(...) }` — intentionally NOT impl'ing Display.
// Formatting a JSValue directly is not allowed. Use jsc::ConsoleObject::Formatter.

impl JSValue {
    #[inline]
    pub fn cast<T>(ptr: *const T) -> JSValue {
        // SAFETY: bitcast pointer address to i64; mirrors @enumFromInt(@bitCast(@intFromPtr(ptr)))
        JSValue::from_raw((ptr as usize) as i64)
    }

    pub fn is_big_int_in_uint64_range(self, min: u64, max: u64) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__isBigIntInUInt64Range(self, min, max) }
    }

    pub fn is_big_int_in_int64_range(self, min: i64, max: i64) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__isBigIntInInt64Range(self, min, max) }
    }

    pub fn coerce_to_int32(self, global: &JSGlobalObject) -> JsResult<i32> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__coerceToInt32(self, global) }
    }

    pub fn coerce_to_int64(self, global: &JSGlobalObject) -> JsResult<i64> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__coerceToInt64(self, global) }
    }

    pub fn get_index(self, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        jsc::JSObject::get_index(self, global, i)
    }

    pub fn is_jsx_element(self, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__isJSXElement(self, global)
        })
    }

    pub fn get_direct_index(self, global: &JSGlobalObject, i: u32) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__getDirectIndex(self, global, i) }
    }

    pub fn is_falsey(self) -> bool {
        !self.to_boolean()
    }

    #[inline]
    pub fn is_truthy(self) -> bool {
        self.to_boolean()
    }
}

pub type PropertyIteratorFn = unsafe extern "C" fn(
    global_object: *mut JSGlobalObject,
    ctx_ptr: *mut c_void,
    key: *mut ZigString,
    value: JSValue,
    is_symbol: bool,
    is_private_symbol: bool,
);

impl JSValue {
    pub fn for_each_property_non_indexed(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: PropertyIteratorFn,
    ) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__forEachPropertyNonIndexed(self, global, ctx, Some(callback))
        })
    }

    pub fn for_each_property(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: PropertyIteratorFn,
    ) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__forEachProperty(self, global, ctx, callback) }
    }

    pub fn for_each_property_ordered(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: PropertyIteratorFn,
    ) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__forEachPropertyOrdered(self, global, ctx, callback) }
    }

    /// Perform the ToNumber abstract operation, coercing a value to a number.
    /// Equivalent to `+value`.
    /// https://tc39.es/ecma262/#sec-tonumber
    pub fn to_number(self, global: &JSGlobalObject) -> JsResult<f64> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe { Bun__JSValue__toNumber(self, global) })
    }

    // ECMA-262 20.1.2.3 Number.isInteger
    pub fn is_integer(self) -> bool {
        if self.is_int32() {
            return true;
        }
        if self.is_double() {
            let num = self.as_double();
            if num.is_finite() && num.trunc() == num {
                return true;
            }
        }
        false
    }

    // https://tc39.es/ecma262/#sec-number.issafeinteger
    pub fn is_safe_integer(self) -> bool {
        if self.is_int32() {
            return true;
        }
        if !self.is_double() {
            return false;
        }
        let d = self.as_double();
        d.trunc() == d && d.abs() <= jsc::MAX_SAFE_INTEGER
    }

    // TODO(port): Zig `coerce(comptime T: type)` dispatched on f64/i64/i32/std.c.AI.
    // Rust cannot switch on a type param; expose per-type helpers instead.
    pub fn coerce_f64(self, global: &JSGlobalObject) -> JsResult<f64> {
        if self.is_double() {
            return Ok(self.as_double());
        }
        self.to_number(global)
    }
    pub fn coerce_i64(self, global: &JSGlobalObject) -> JsResult<i64> {
        self.coerce_to_int64(global)
    }
    pub fn coerce_i32(self, global: &JSGlobalObject) -> JsResult<i32> {
        if self.is_int32() {
            return Ok(self.as_int32());
        }
        if let Some(num) = self.get_number() {
            return Ok(coerce_js_value_double_truncating_t::<i32>(num));
        }
        self.coerce_to_int32(global)
    }
    // std.c.AI arm: bitcast i32 → AI flags. TODO(port): map std.c.AI to a Rust type.

    /// This does not call [Symbol.toPrimitive] or [Symbol.toStringTag].
    /// This is only safe when you don't want to do conversions across non-primitive types.
    // TODO(port): Zig `to(comptime T: type)` dispatched on a closed type set via @typeInfo.
    // Expose per-type helpers; callers pick the right one.
    pub fn to_u32(self) -> u32 {
        self.to_u32_impl()
    }
    pub fn to_u16(self) -> u16 {
        self.to_u16_impl()
    }
    pub fn to_c_uint(self) -> c_uint {
        self.to_u32_impl() as c_uint
    }
    pub fn to_c_int(self) -> c_int {
        // @intCast — checked narrowing
        c_int::try_from(self.to_int32()).unwrap()
    }
    pub fn to_any_promise(self) -> Option<AnyPromise> {
        self.as_any_promise()
    }
    pub fn to_u52(self) -> u64 {
        // u52 truncate of u64 of max(toInt64,0)
        ((self.to_int64().max(0)) as u64) & ((1u64 << 52) - 1)
    }
    pub fn to_i52(self) -> i64 {
        // TODO(port): Zig truncated i64→i52→i52; emulate sign-extending 52-bit truncate.
        let raw = self.to_int64();
        ((raw << 12) >> 12)
    }
    pub fn to_u64(self) -> u64 {
        self.to_uint64_no_truncate()
    }
    pub fn to_u8(self) -> u8 {
        self.to_u32_impl() as u8
    }
    pub fn to_i16(self) -> i16 {
        self.to_int32() as i16
    }
    pub fn to_i8(self) -> i8 {
        self.to_int32() as i8
    }
    pub fn to_i32(self) -> i32 {
        self.to_int32()
    }
    pub fn to_i64(self) -> i64 {
        self.to_int64()
    }
    pub fn to_bool(self) -> bool {
        self.to_boolean()
    }

    pub fn to_port_number(self, global: &JSGlobalObject) -> JsResult<u16> {
        if self.is_number() {
            let double = self.to_number(global)?;
            if double.is_nan() {
                return Err(jsc::error::SOCKET_BAD_PORT.throw(global, format_args!("Invalid port number")));
            }
            let port = self.to_int64();
            if (0..=65535).contains(&port) {
                return Ok((port.max(0)) as u16);
            } else {
                return Err(jsc::error::SOCKET_BAD_PORT.throw(global, format_args!("Port number out of range: {}", port)));
            }
        }
        Err(jsc::error::SOCKET_BAD_PORT.throw(global, format_args!("Invalid port number")))
    }

    pub fn is_instance_of(self, global: &JSGlobalObject, constructor: JSValue) -> bool {
        if !self.is_cell() {
            return false;
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__isInstanceOf(self, global, constructor) }
    }

    pub fn call_with_global_this(self, global: &JSGlobalObject, args: &[JSValue]) -> JsResult<JSValue> {
        self.call(global, global.to_js_value(), args)
    }

    pub fn call(
        function: JSValue,
        global: &JSGlobalObject,
        this_value: JSValue,
        args: &[JSValue],
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        #[cfg(debug_assertions)]
        {
            let event_loop = jsc::VirtualMachine::get().event_loop();
            event_loop.debug.js_call_count_outside_tick_queue +=
                usize::from(!event_loop.debug.is_inside_tick_queue);
            if event_loop.debug.track_last_fn_name && !event_loop.debug.is_inside_tick_queue {
                event_loop.debug.last_fn_name.deref();
                event_loop.debug.last_fn_name = function.get_name(global)?;
            }
            // Do not assert that the function is callable here.
            // The Bun__JSValue__call function will already assert that, and
            // this can be an async context so it's fine if it's not callable.
        }

        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe {
            Bun__JSValue__call(global, function, this_value, args.len(), args.as_ptr())
        })
    }

    #[inline]
    pub fn call_next_tick_1(function: JSValue, global: &JSGlobalObject, a0: JSValue) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            Bun__Process__queueNextTick1(global, function, a0)
        })
    }
    #[inline]
    pub fn call_next_tick_2(
        function: JSValue,
        global: &JSGlobalObject,
        a0: JSValue,
        a1: JSValue,
    ) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            Bun__Process__queueNextTick2(global, function, a0, a1)
        })
    }
    // TODO(port): Zig `callNextTick` switched on `args.len` at comptime; in Rust callers
    // pick the arity-specific fn directly.

    /// The value cannot be empty. Check `!self.is_empty()` before calling this function.
    pub fn js_type(self) -> JSType {
        debug_assert!(self != JSValue::ZERO);
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__jsType(self) }
    }

    pub fn js_type_loose(self) -> JSType {
        if self.is_number() {
            return JSType::NumberObject;
        }
        self.js_type()
    }

    pub fn js_type_string(self, global: &JSGlobalObject) -> *mut JSString {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__jsTypeStringForValue(global, self) }
    }

    pub fn create_empty_object_with_null_prototype(global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__createEmptyObjectWithNullPrototype(global) }
    }

    /// Creates a new empty object, with Object as its prototype.
    pub fn create_empty_object(global: &JSGlobalObject, len: usize) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__createEmptyObject(global, len) }
    }

    pub fn create_empty_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe { JSC__JSValue__createEmptyArray(global, len) })
    }

    pub fn put_record(
        value: JSValue,
        global: &JSGlobalObject,
        key: &mut ZigString,
        values_array: *mut ZigString,
        values_len: usize,
    ) {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__putRecord(value, global, key, values_array, values_len) }
    }

    pub fn put_zig_string(value: JSValue, global: &JSGlobalObject, key: &ZigString, result: JSValue) {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__put(value, global, key, result) }
    }

    /// Delete a property from an object by key. Returns true if the property was deleted.
    pub fn delete_property(target: JSValue, global: &JSGlobalObject, key: impl PutKey) -> bool {
        // TODO(port): Zig used @typeInfo to accept *ZigString | ZigString | []const u8.
        // PutKey trait normalizes to a borrowed ZigString.
        let zs = key.as_zig_string();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__deleteProperty(target, global, &zs) }
    }

    fn put_bun_string(value: JSValue, global: &JSGlobalObject, key: &BunString, result: JSValue) {
        #[cfg(debug_assertions)]
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__putBunString(value, global, key, result) }
    }

    /// Put key/val pair into `obj`. If `key` is already present on the object, create an array for the values.
    pub fn put_bun_string_one_or_array(
        obj: JSValue,
        global: &JSGlobalObject,
        key: &BunString,
        value: JSValue,
    ) -> JsResult<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe {
            JSC__JSValue__upsertBunStringArray(obj, global, key, value)
        })
    }

    pub fn put(value: JSValue, global: &JSGlobalObject, key: impl PutKey, result: JSValue) {
        // TODO(port): Zig used @typeInfo to dispatch ZigString/bun.String/[]const u8.
        // PutKey trait centralizes that.
        key.put(value, global, result);
    }

    /// Same as `.put` but accepts both non-numeric and numeric keys.
    /// Prefer to use `.put` if the key is guaranteed to be non-numeric (e.g. known at comptime).
    pub fn put_may_be_index(
        self,
        global: &JSGlobalObject,
        key: &BunString,
        value: JSValue,
    ) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__putMayBeIndex(self, global, key, value) }
    }

    pub fn put_to_property_key(
        target: JSValue,
        global: &JSGlobalObject,
        key: JSValue,
        value: JSValue,
    ) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__putToPropertyKey(target, global, key, value)
        })
    }

    pub fn put_index(value: JSValue, global: &JSGlobalObject, i: u32, out: JSValue) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__putIndex(value, global, i, out)
        })
    }

    pub fn push(value: JSValue, global: &JSGlobalObject, out: JSValue) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe { JSC__JSValue__push(value, global, out) })
    }

    pub fn to_iso_string<'a>(self, global: &JSGlobalObject, buf: &'a mut [u8; 28]) -> &'a [u8] {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let count = unsafe { JSC__JSValue__toISOString(global, self, buf) };
        if count < 0 {
            return b"";
        }
        &buf[0..usize::try_from(count).unwrap()]
    }

    pub fn get_date_now_iso_string<'a>(global: &JSGlobalObject, buf: &'a mut [u8; 28]) -> &'a [u8] {
        // TODO(port): Zig body called JSC__JSValue__DateNowISOString(global, buf) but the
        // extern signature is (*JSGlobalObject, f64) → JSValue. Mirroring the body verbatim
        // would not type-check; this is likely a Zig bug. Preserve the body shape and flag.
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let count: c_int = unsafe {
            // SAFETY: see TODO above — signature mismatch in source.
            core::mem::transmute::<_, unsafe extern "C" fn(*const JSGlobalObject, *mut [u8; 28]) -> c_int>(
                JSC__JSValue__DateNowISOString as *const (),
            )(global, buf)
        };
        if count < 0 {
            return b"";
        }
        &buf[0..usize::try_from(count).unwrap()]
    }

    /// Return the pointer to the wrapped object only if it is a direct instance of the type.
    /// If the object does not match the type, return null.
    /// If the object is a subclass of the type or has mutated the structure, return null.
    /// Note: this may return null for direct instances of the type if the user adds properties to the object.
    pub fn as_direct<ZigType: jsc::FromJsDirect>(value: JSValue) -> Option<&'static mut ZigType> {
        debug_assert!(value.is_cell()); // you must have already checked this.
        ZigType::from_js_direct(value)
    }

    pub fn as_<ZigType: jsc::FromJs>(value: JSValue) -> Option<&'static mut ZigType> {
        if value.is_empty_or_undefined_or_null() {
            return None;
        }
        // TODO(port): Zig special-cased DOMURL, FetchHeaders, WebCore.Body.Value, WebCore.Blob
        // via comptime type comparison + @hasDecl. In Rust those become specialized
        // `FromJs` impls on each type; the generic path here just defers to the trait.
        ZigType::from_js(value)
    }

    pub fn from_date_string(global: &JSGlobalObject, str: *const c_char) -> JSValue {
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__dateInstanceFromNullTerminatedString(global, str) }
    }

    pub fn from_date_number(global: &JSGlobalObject, value: f64) -> JSValue {
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__dateInstanceFromNumber(global, value) }
    }

    pub fn is_buffer(value: JSValue, global: &JSGlobalObject) -> bool {
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSBuffer__isBuffer(global, value) }
    }

    pub fn is_reg_exp(self) -> bool {
        self.js_type() == JSType::RegExpObject
    }

    pub fn is_date(self) -> bool {
        self.js_type() == JSType::JSDate
    }

    /// Protects a JSValue from garbage collection by storing it in a hash table that is strongly
    /// referenced and incrementing a reference count.
    ///
    /// This is useful when you want to store a JSValue in a global or on the heap, where the
    /// garbage collector will not be able to discover your reference to it.
    ///
    /// A value may be protected multiple times and must be unprotected an equal number of times
    /// before becoming eligible for garbage collection.
    ///
    /// Note: The is_cell check is not done here because it's done in the bindings.cpp file.
    pub fn protect(self) {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { Bun__JSValue__protect(self) }
    }

    /// Unprotects a JSValue from garbage collection by removing it from the hash table and
    /// decrementing a reference count.
    ///
    /// A value may be protected multiple times and must be unprotected an equal number of times
    /// before becoming eligible for garbage collection.
    ///
    /// This is the inverse of `protect`.
    ///
    /// Note: The is_cell check is not done here because it's done in the bindings.cpp file.
    pub fn unprotect(self) {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { Bun__JSValue__unprotect(self) }
    }

    /// Create an object with exactly two properties.
    pub fn create_object2(
        global: &JSGlobalObject,
        key1: &ZigString,
        key2: &ZigString,
        value1: JSValue,
        value2: JSValue,
    ) -> JsResult<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe {
            JSC__JSValue__createObject2(global, key1, key2, value1, value2)
        })
    }

    /// `self` must have been created by `from_ptr_address()`.
    pub fn as_promise_ptr<T>(self) -> *mut T {
        self.as_ptr_address() as *mut T
    }

    pub fn create_rope_string(self, rhs: JSValue, global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__createRopeString(self, rhs, global) }
    }

    pub fn get_errors_property(self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__getErrorsProperty(self, global) }
    }

    pub fn create_buffer_from_length(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe {
            JSBuffer__bufferFromLength(global, i64::try_from(len).unwrap())
        })
    }

    pub fn jest_snapshot_pretty_format(
        self,
        out: &mut impl core::fmt::Write,
        global: &JSGlobalObject,
    ) -> Result<(), bun_core::Error> {
        let fmt_options = JestPrettyFormat::FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            quote_strings: true,
            ..Default::default()
        };

        JestPrettyFormat::format(
            JestPrettyFormat::Kind::Debug,
            global,
            core::slice::from_ref(&self),
            1,
            out,
            fmt_options,
        )?;

        // TODO(port): out.flush() — std.Io.Writer.flush has no core::fmt::Write equivalent.
        Ok(())
    }

    /// Must come from globally-allocated memory if allocator is not null.
    pub fn create_buffer(global: &JSGlobalObject, slice: &mut [u8]) -> JSValue {
        jsc::mark_binding();
        // @setRuntimeSafety(false) — no Rust equivalent needed.
        if slice.is_empty() {
            // A zero-length slice's ptr field is not guaranteed to be a valid mimalloc
            // allocation (it may be the dangling sentinel from an empty slice literal).
            // Callers that over-allocated and decoded zero bytes must free their allocation
            // before calling this.
            // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
            return unsafe {
                JSBuffer__bufferFromPointerAndLengthAndDeinit(
                    global,
                    slice.as_mut_ptr(),
                    0,
                    core::ptr::null_mut(),
                    None,
                )
            };
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global,
                slice.as_mut_ptr(),
                slice.len(),
                core::ptr::null_mut(),
                Some(jsc::array_buffer::marked_array_buffer_deallocator),
            )
        }
    }

    pub fn create_uninitialized_uint8_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe {
            JSC__JSValue__createUninitializedUint8Array(global, len)
        })
    }

    pub fn create_buffer_with_ctx(
        global: &JSGlobalObject,
        slice: &mut [u8],
        ptr: *mut c_void,
        func: jsc::c_api::JSTypedArrayBytesDeallocator,
    ) -> JSValue {
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(global, slice.as_mut_ptr(), slice.len(), ptr, func)
        }
    }

    // TODO(port): Zig `jsNumberWithType(comptime Number: type, number)` switched on the
    // numeric type at comptime (including enum tag types and comptime_int). In Rust this
    // is a `From<N> for JSValue` set; provide a generic entry that defers to that trait.
    pub fn js_number_with_type<N: IntoJsNumber>(number: N) -> JSValue {
        number.into_js_number()
    }

    pub fn create_internal_promise(global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__createInternalPromise(global) }
    }

    pub fn as_internal_promise(value: JSValue) -> Option<&'static mut JSInternalPromise> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__asInternalPromise(value).as_mut() }
    }

    pub fn as_promise(value: JSValue) -> Option<&'static mut JSPromise> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__asPromise(value).as_mut() }
    }

    pub fn as_any_promise(value: JSValue) -> Option<AnyPromise> {
        if value.is_empty_or_undefined_or_null() {
            return None;
        }
        if let Some(promise) = value.as_internal_promise() {
            return Some(AnyPromise::Internal(promise));
        }
        if let Some(promise) = value.as_promise() {
            return Some(AnyPromise::Normal(promise));
        }
        None
    }

    #[inline]
    pub const fn js_boolean(i: bool) -> JSValue {
        if i { JSValue::TRUE } else { JSValue::FALSE }
    }

    #[inline]
    pub fn js_empty_string(global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__jsEmptyString(global) }
    }

    #[inline]
    pub const fn js_null() -> JSValue {
        JSValue::NULL
    }

    pub fn js_number<N: IntoJsNumber>(number: N) -> JSValue {
        number.into_js_number()
    }

    // TODO(port): jsBigInt switched on type at comptime. Provide u64/i64 paths; u32/i32
    // widen via the same externs.
    pub fn js_big_int_u64(global: &JSGlobalObject, n: u64) -> JSValue {
        JSValue::from_uint64_no_truncate(global, n)
    }
    pub fn js_big_int_i64(global: &JSGlobalObject, n: i64) -> JSValue {
        JSValue::from_int64_no_truncate(global, n)
    }

    #[inline]
    pub fn js_tdz_value() -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__jsTDZValue() }
    }

    pub fn class_name(self, global: &JSGlobalObject) -> JsResult<ZigString> {
        let mut s = ZigString::init(b"");
        self.get_class_name(global, &mut s)?;
        Ok(s)
    }

    pub fn print(
        self,
        global: &JSGlobalObject,
        message_type: jsc::console_object::MessageType,
        message_level: jsc::console_object::MessageLevel,
    ) {
        jsc::console_object::message_with_type_and_level(
            // Zig passed `undefined` for the first arg.
            // TODO(port): determine the actual receiver type; pass null/default.
            core::ptr::null_mut(),
            message_type,
            message_level,
            global,
            &[self],
            1,
        );
    }

    /// Create a JSValue string from a Rust format-print (fmt + args).
    pub fn print_string(
        global: &JSGlobalObject,
        // PERF(port): was stack-fallback alloc with comptime stack_buffer_size — profile in Phase B
        _stack_buffer_size: usize,
        args: core::fmt::Arguments<'_>,
    ) -> JsResult<JSValue> {
        let mut buf: Vec<u8> = Vec::new();
        use std::io::Write as _;
        write!(&mut buf, "{}", args).expect("unreachable");
        BunString::init(&buf).to_js(global)
    }

    /// Create a JSValue string from a Rust format-print (fmt + args), with pretty format.
    pub fn print_string_pretty(
        global: &JSGlobalObject,
        // PERF(port): was stack-fallback alloc — profile in Phase B
        _stack_buffer_size: usize,
        args: core::fmt::Arguments<'_>,
    ) -> JsResult<JSValue> {
        let mut buf: Vec<u8> = Vec::new();
        use std::io::Write as _;
        // TODO(port): Zig used Output.prettyFmt(fmt, enabled) at comptime over the
        // `enable_ansi_colors_stderr` runtime bool via `inline else`. Phase B should expose
        // a runtime pretty-formatter; for now write plain.
        let _enabled = Output::enable_ansi_colors_stderr();
        write!(&mut buf, "{}", args).expect("unreachable");
        BunString::init(&buf).to_js(global)
    }

    pub fn from_entries(
        global: &JSGlobalObject,
        keys_array: *mut ZigString,
        values_array: *mut ZigString,
        strings_count: usize,
        clone: bool,
    ) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__fromEntries(global, keys_array, values_array, strings_count, clone) }
    }

    pub fn keys(value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe { JSC__JSValue__keys(global, value) })
    }

    /// This is `Object.values`.
    /// `value` is assumed to be not empty, undefined, or null.
    pub fn values(value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        if cfg!(debug_assertions) {
            debug_assert!(!value.is_empty_or_undefined_or_null());
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe { JSC__JSValue__values(global, value) })
    }

    /// Calls `Object.hasOwnProperty(value)`.
    /// Returns true if the object has the property, false otherwise.
    ///
    /// If the object is not an object, it will crash. **You must check if the object is an object
    /// before calling this function.**
    pub fn has_own_property_value(self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__hasOwnPropertyValue(self, global, key)
        })
    }

    #[inline]
    pub fn array_iterator(self, global: &JSGlobalObject) -> JsResult<JSArrayIterator> {
        JSArrayIterator::init(self, global)
    }

    pub fn js_double_number(i: f64) -> JSValue {
        FFI::double_to_jsvalue(i).as_js_value()
    }
    pub fn js_number_from_char(i: u8) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__jsNumberFromChar(i) }
    }
    pub fn js_number_from_u16(i: u16) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__jsNumberFromU16(i) }
    }
    pub fn js_number_from_int32(i: i32) -> JSValue {
        FFI::int32_to_jsvalue(i).as_js_value()
    }

    pub fn js_number_from_int64(i: i64) -> JSValue {
        if i <= i32::MAX as i64 && i >= i32::MIN as i64 {
            return Self::js_number_from_int32(i32::try_from(i).unwrap());
        }
        Self::js_double_number(i as f64)
    }

    pub fn js_number_from_uint64(i: u64) -> JSValue {
        if i <= i32::MAX as u64 {
            return Self::js_number_from_int32(i32::try_from(i).unwrap());
        }
        Self::js_double_number(i as f64)
    }
}

// Mirrors WTF::tryConvertToStrictInt32 (wtf/MathExtras.h). Returns the int32
// when `value` is exactly representable as i32 (rejects -0.0, NaN, ±Inf,
// non-integers, out-of-range).
pub fn try_convert_to_strict_int32(value: f64) -> Option<i32> {
    #[cfg(all(target_arch = "aarch64", target_feature = "jsconv"))]
    {
        // ARMv8.3 FJCVTZS performs JS ToInt32 and sets Z=1 iff no rounding,
        // wrap, sign-flip or NaN/Inf occurred — i.e. iff the input was an
        // exact int32 (including +0.0 → 0; -0.0 clears Z).
        let result: i32;
        let exact: u32;
        // SAFETY: pure ALU op, sets NZCV.
        unsafe {
            core::arch::asm!(
                "fjcvtzs {out:w}, {inp:d}",
                "cset {z:w}, eq",
                out = out(reg) result,
                z = out(reg) exact,
                inp = in(vreg) value,
                options(nomem, nostack),
            );
        }
        return if exact != 0 { Some(result) } else { None };
    }

    #[cfg(not(all(target_arch = "aarch64", target_feature = "jsconv")))]
    {
        // Range gate also rejects NaN/±Inf via unordered compare.
        if !(value >= -2147483648.0 && value < 2147483648.0) {
            return None;
        }
        // Note: Rust `as` saturates; we already range-checked so this is exact.
        let int = value as i32;
        if (int as f64) != value || (int == 0 && value.is_sign_negative()) {
            return None;
        }
        Some(int)
    }
}

pub fn can_be_strict_int32(value: f64) -> bool {
    try_convert_to_strict_int32(value).is_some()
}

// Zig: `has_fjcvtzs` was a comptime feature check; in Rust this is the cfg gate above.

fn coerce_js_value_double_truncating_t<T: TruncTarget>(num: f64) -> T {
    coerce_js_value_double_truncating_tt::<T, T>(num)
}

fn coerce_js_value_double_truncating_tt<T: TruncTarget, Out: From<T> + TruncTarget>(num: f64) -> Out {
    // TODO(port): Zig had an aarch64-only inline-asm fast path using `fcvtzs` for
    // T==Out==i32/i64 to bypass LLVM fptosi poison reasoning. Rust `as` already
    // saturates (NaN→0, overflow→min/max) which matches the fallback semantics, so
    // the asm path is a PERF concern only.
    // PERF(port): aarch64 fcvtzs inline asm — profile in Phase B.

    if num.is_nan() {
        return Out::ZERO;
    }
    if num <= T::MIN_F64 || num.is_infinite() && num.is_sign_negative() {
        return Out::from(T::MIN);
    }
    if num >= T::MAX_F64 || num.is_infinite() && num.is_sign_positive() {
        return Out::from(T::MAX);
    }
    // @intFromFloat — Rust `as` saturates but we've range-checked so it's exact-truncating.
    Out::from(T::from_f64_trunc(num))
}

/// Helper trait for `coerce_js_value_double_truncating_*`.
// TODO(port): hoisted from comptime `T: type`; Phase B may inline for i32/i64 only.
pub trait TruncTarget: Copy {
    const ZERO: Self;
    const MIN: Self;
    const MAX: Self;
    const MIN_F64: f64;
    const MAX_F64: f64;
    fn from_f64_trunc(n: f64) -> Self;
}
impl TruncTarget for i32 {
    const ZERO: Self = 0;
    const MIN: Self = i32::MIN;
    const MAX: Self = i32::MAX;
    const MIN_F64: f64 = i32::MIN as f64;
    const MAX_F64: f64 = i32::MAX as f64;
    fn from_f64_trunc(n: f64) -> Self { n as i32 }
}
impl TruncTarget for i64 {
    const ZERO: Self = 0;
    const MIN: Self = i64::MIN;
    const MAX: Self = i64::MAX;
    const MIN_F64: f64 = i64::MIN as f64;
    const MAX_F64: f64 = i64::MAX as f64;
    fn from_f64_trunc(n: f64) -> Self { n as i64 }
}
// Zig also instantiated with i52 (for asInt52). TODO(port): add i52 newtype if needed.

impl JSValue {
    pub fn coerce_double_truncating_into_int64(self) -> i64 {
        coerce_js_value_double_truncating_t::<i64>(self.as_number())
    }

    /// Decimal values are truncated without rounding.
    /// `NaN` coerces to 0. `-Infinity` coerces to `i64::MIN`. `Infinity` coerces to `i64::MAX`.
    pub fn to_int64(self) -> i64 {
        if self.is_int32() {
            return self.as_int32() as i64;
        }
        if self.is_number() {
            return self.coerce_double_truncating_into_int64();
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__toInt64(self) }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ComparisonResult {
    Equal,
    UndefinedResult,
    GreaterThan,
    LessThan,
    InvalidComparison,
}

impl JSValue {
    pub fn as_big_int_compare(self, global: &JSGlobalObject, other: JSValue) -> ComparisonResult {
        if !self.is_big_int() || (!other.is_big_int() && !other.is_number()) {
            return ComparisonResult::InvalidComparison;
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__asBigIntCompare(self, global, other) }
    }

    #[inline]
    pub const fn is_undefined(self) -> bool {
        self.0 == 0xa
    }
    #[inline]
    pub const fn is_null(self) -> bool {
        self.0 == JSValue::NULL.0
    }
    #[inline]
    pub const fn is_empty_or_undefined_or_null(self) -> bool {
        matches!(self.0, 0 | 0xa | 0x2)
    }
    pub const fn is_undefined_or_null(self) -> bool {
        matches!(self.0, 0xa | 0x2)
    }
    pub const fn is_boolean(self) -> bool {
        self.0 == JSValue::TRUE.0 || self.0 == JSValue::FALSE.0
    }
    pub fn is_any_int(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isAnyInt(self) }
    }
    pub fn is_uint32_as_any_int(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isUInt32AsAnyInt(self) }
    }

    pub fn as_encoded(self) -> FFI::EncodedJSValue {
        FFI::EncodedJSValue { as_js_value: self }
    }

    pub fn from_cell(ptr: *mut c_void) -> JSValue {
        FFI::EncodedJSValue { as_ptr: ptr }.as_js_value()
    }

    pub fn is_int32(self) -> bool {
        FFI::jsvalue_is_int32(FFI::EncodedJSValue { as_js_value: self })
    }

    pub fn is_int32_as_any_int(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isInt32AsAnyInt(self) }
    }

    pub fn is_number(self) -> bool {
        FFI::jsvalue_is_number(FFI::EncodedJSValue { as_js_value: self })
    }

    pub fn is_double(self) -> bool {
        self.is_number() && !self.is_int32()
    }

    /// [21.1.2.2 Number.isFinite](https://tc39.es/ecma262/#sec-number.isfinite)
    ///
    /// Returns `false` for non-numbers, `NaN`, `Infinity`, and `-Infinity`.
    pub fn is_finite(self) -> bool {
        if !self.is_number() {
            return false;
        }
        self.as_number().is_finite()
    }

    pub fn is_error(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        self.js_type() == JSType::ErrorInstance
    }

    pub fn is_any_error(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__isAnyError(self) }
    }

    pub fn to_error_(self) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__toError_(self) }
    }

    pub fn to_error(self) -> Option<JSValue> {
        let res = self.to_error_();
        if res == JSValue::ZERO {
            return None;
        }
        Some(res)
    }

    /// If `self` is an Error instance with no stack trace (e.g. created from native code at the
    /// top of the event loop), populate its stack with async frames derived from the given
    /// promise's await chain. No-op if `self` is not an Error instance or the promise has no
    /// awaiting generator.
    pub fn attach_async_stack_from_promise(self, global: &JSGlobalObject, promise: &mut JSPromise) {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { Bun__attachAsyncStackFromPromise(global, self, promise) }
    }

    /// Returns true if
    /// - `"string literal"`
    /// - `new String("123")`
    /// - `class DerivedString extends String; new DerivedString("123")`
    #[inline]
    pub fn is_string(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        self.js_type().is_string_like()
    }

    /// Returns true only for string literals
    /// - `"string literal"`
    #[inline]
    pub fn is_string_literal(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        self.js_type().is_string()
    }

    /// Returns true if
    /// - `new String("123")`
    /// - `class DerivedString extends String; new DerivedString("123")`
    #[inline]
    pub fn is_string_object_like(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        self.js_type().is_string_object_like()
    }

    pub fn is_big_int(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isBigInt(self) }
    }
    pub fn is_heap_big_int(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isHeapBigInt(self) }
    }
    pub fn is_big_int32(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isBigInt32(self) }
    }
    pub fn is_symbol(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isSymbol(self) }
    }
    pub fn is_primitive(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isPrimitive(self) }
    }
    pub fn is_getter_setter(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isGetterSetter(self) }
    }
    pub fn is_custom_getter_setter(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isCustomGetterSetter(self) }
    }
    #[inline]
    pub fn is_object(self) -> bool {
        self.is_cell() && self.js_type().is_object()
    }
    #[inline]
    pub fn is_array(self) -> bool {
        self.is_cell() && self.js_type().is_array()
    }
    #[inline]
    pub fn is_function(self) -> bool {
        self.is_cell() && self.js_type().is_function()
    }

    pub fn is_object_empty(self, global: &JSGlobalObject) -> JsResult<bool> {
        let type_of_value = self.js_type();
        // https://github.com/jestjs/jest/blob/main/packages/jest-get-type/src/index.ts#L26
        // Map and Set are not considered as object in jest-extended
        if type_of_value.is_map() || type_of_value.is_set() || self.is_reg_exp() || self.is_date() {
            return Ok(false);
        }
        Ok(self.js_type().is_object() && self.keys(global)?.get_length(global)? == 0)
    }

    pub fn is_class(self, global: &JSGlobalObject) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__isClass(self, global) }
    }

    pub fn is_constructor(self) -> bool {
        if !self.is_cell() {
            return false;
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isConstructor(self) }
    }

    pub fn get_name_property(self, global: &JSGlobalObject, ret: &mut ZigString) -> JsResult<()> {
        if self.is_empty_or_undefined_or_null() {
            return Ok(());
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__getNameProperty(self, global, ret)
        })
    }

    pub fn get_name(self, global: &JSGlobalObject) -> JsResult<BunString> {
        let mut ret = BunString::empty();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__getName(self, global, &mut ret)
        })?;
        Ok(ret)
    }

    // TODO: absorb this into class_name()
    pub fn get_class_name(self, global: &JSGlobalObject, ret: &mut ZigString) -> JsResult<()> {
        if !self.is_cell() {
            *ret = *ZigString::static_(b"[not a class]");
            return Ok(());
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__getClassName(self, global, ret)
        })
    }

    #[inline]
    pub fn is_cell(self) -> bool {
        match self {
            JSValue::ZERO | JSValue::UNDEFINED | JSValue::NULL | JSValue::TRUE | JSValue::FALSE => false,
            _ => ((self.0 as u64) & FFI::NOT_CELL_MASK) == 0,
        }
    }

    pub fn as_cell(self) -> &'static mut JSCell {
        // Asserting this lets the optimizer possibly elide other checks.
        // SAFETY: caller-checked is_cell(); decode().as_cell() cannot be null since is_cell()
        // already excluded ZERO.
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe {
            debug_assert!(self.is_cell());
            self.decode().as_cell().unwrap_unchecked()
        }
    }

    pub fn is_callable(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__isCallable(self) }
    }

    /// Statically cast a value to a cell. Returns `None` for non-cells.
    pub fn to_cell(self) -> Option<&'static mut JSCell> {
        if self.is_cell() { Some(self.as_cell()) } else { None }
    }

    pub fn is_exception(self, vm: &VM) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__isException(self, vm) }
    }

    /// Cast to an Exception pointer, or None if not an Exception.
    pub fn as_exception(self, vm: &VM) -> Option<&'static mut jsc::Exception> {
        if self.is_exception(vm) {
            Some(self.unchecked_ptr_cast::<jsc::Exception>())
        } else {
            None
        }
    }

    pub fn is_termination_exception(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__isTerminationException(self) }
    }

    pub fn to_zig_exception(self, global: &JSGlobalObject, exception: &mut ZigException) {
        // TODO: properly propagate termination
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let _ = unsafe { bun_jsc::cpp::JSC__JSValue__toZigException(self, global, exception) };
    }

    pub fn to_zig_string(self, out: &mut ZigString, global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__toZigString(self, out, global)
        })
    }

    /// Increments the reference count, you must call `.deref()` or it will leak memory.
    pub fn to_bun_string(self, global: &JSGlobalObject) -> JsResult<BunString> {
        BunString::from_js(self, global)
    }

    /// `self`: RegExp value, `other`: string value.
    pub fn to_match(self, global: &JSGlobalObject, other: JSValue) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__toMatch(self, global, other) }
    }

    pub fn as_array_buffer(self, global: &JSGlobalObject) -> Option<ArrayBuffer> {
        let mut out = core::mem::MaybeUninit::<ArrayBuffer>::uninit();
        // SAFETY: extern "C" call into JSC bindings; out is a valid uninit slot.
        if unsafe { JSC__JSValue__asArrayBuffer(self, global, out.as_mut_ptr()) } {
            // SAFETY: JSC__JSValue__asArrayBuffer fully initializes `out` when it returns true.
            return Some(unsafe { out.assume_init() });
        }
        None
    }

    /// This always returns a JS BigInt.
    pub fn from_int64_no_truncate(global: &JSGlobalObject, i: i64) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__fromInt64NoTruncate(global, i) }
    }
    /// This always returns a JS BigInt.
    pub fn from_uint64_no_truncate(global: &JSGlobalObject, i: u64) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__fromUInt64NoTruncate(global, i) }
    }
    /// This always returns a JS BigInt using std.posix.timeval from std.posix.rusage.
    pub fn from_timeval_no_truncate(global: &JSGlobalObject, nsec: i64, sec: i64) -> JsResult<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe {
            JSC__JSValue__fromTimevalNoTruncate(global, nsec, sec)
        })
    }
    /// Sums two JS BigInts.
    pub fn big_int_sum(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__bigIntSum(global, a, b) }
    }

    /// Value must be either `is_heap_big_int` or `is_number`.
    pub fn to_uint64_no_truncate(self) -> u64 {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__toUInt64NoTruncate(self) }
    }

    /// Deprecated: replace with `to_bun_string`.
    pub fn get_zig_string(self, global: &JSGlobalObject) -> JsResult<ZigString> {
        let mut s = ZigString::init(b"");
        self.to_zig_string(&mut s, global)?;
        Ok(s)
    }

    /// Convert a JSValue to a string, potentially calling `toString` on the JSValue in JavaScript.
    /// Can throw an error.
    ///
    /// This keeps the WTF::StringImpl alive if it was originally a latin1 ASCII-only string.
    /// Otherwise, it will be cloned using the allocator.
    pub fn to_slice(self, global: &JSGlobalObject) -> JsResult<bun_str::ZigStringSlice> {
        let s = BunString::from_js(self, global)?;
        // `defer s.deref()` — Drop on BunString handles refcount.
        Ok(s.to_utf8())
    }

    #[inline]
    pub fn to_slice_z(self, global: &JSGlobalObject) -> JsResult<bun_str::ZigStringSlice> {
        Ok(self.get_zig_string(global)?.to_slice_z())
    }

    /// The returned slice is always heap-owned.
    pub fn to_utf8_bytes(self, global: &JSGlobalObject) -> JsResult<Vec<u8>> {
        let s = BunString::from_js(self, global)?;
        Ok(s.to_utf8_bytes())
    }

    pub fn to_js_string(self, global: &JSGlobalObject) -> JsResult<*mut JSString> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::JSC__JSValue__toStringOrNull(self, global) }
    }

    pub fn json_stringify(self, global: &JSGlobalObject, indent: u32, out: &mut BunString) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__jsonStringify(self, global, indent, out)
        })
    }

    /// Fast version of JSON.stringify that uses JSC's FastStringifier optimization.
    /// When space is undefined (as opposed to 0), JSC uses a highly optimized SIMD-based
    /// serialization path. This is significantly faster for most common use cases.
    pub fn json_stringify_fast(self, global: &JSGlobalObject, out: &mut BunString) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__jsonStringifyFast(self, global, out)
        })
    }

    /// Call `toString()` on the JSValue and clone the result.
    pub fn to_slice_or_null(self, global: &JSGlobalObject) -> JsResult<bun_str::ZigStringSlice> {
        let s = BunString::from_js(self, global)?;
        Ok(s.to_utf8())
    }

    /// Call `toString()` on the JSValue and clone the result.
    pub fn to_slice_or_null_with_allocator(
        self,
        global: &JSGlobalObject,
        // allocator param dropped — global mimalloc
    ) -> JsResult<bun_str::ZigStringSlice> {
        let s = BunString::from_js(self, global)?;
        Ok(s.to_utf8())
    }

    /// Call `toString()` on the JSValue and clone the result.
    /// On exception or out of memory, this returns a JsError.
    ///
    /// Remember that `Symbol` throws an exception when you call `toString()`.
    pub fn to_slice_clone(self, global: &JSGlobalObject) -> JsResult<bun_str::ZigStringSlice> {
        self.to_slice_clone_with_allocator(global)
    }

    /// On exception or out of memory, this returns a JsError.
    pub fn to_slice_clone_with_allocator(
        self,
        global: &JSGlobalObject,
    ) -> JsResult<bun_str::ZigStringSlice> {
        let s = self.to_js_string(global)?;
        // SAFETY: to_js_string returned non-null on Ok path.
        unsafe { (*s).to_slice_clone(global) }
    }

    /// Runtime conversion to an object. This can have side effects.
    ///
    /// For values that are already objects, this is effectively a reinterpret cast.
    ///
    /// ## References
    /// - [ECMA-262 7.1.18 ToObject](https://tc39.es/ecma262/#sec-toobject)
    pub fn to_object(self, global: &JSGlobalObject) -> JsResult<&'static mut JSObject> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__toObject(self, global).as_mut() }.ok_or(JsError::Thrown)
    }

    /// Statically cast a value to a JSObject.
    ///
    /// Returns `None` for non-objects. Use `to_object` to runtime-cast them instead.
    pub fn get_object(self) -> Option<&'static mut JSObject> {
        if self.is_object() {
            Some(self.unchecked_ptr_cast::<JSObject>())
        } else {
            None
        }
    }

    /// Unwraps Number, Boolean, String, and BigInt objects to their primitive forms.
    pub fn unwrap_boxed_primitive(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let mut scope = TopExceptionScope::init(global);
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let result = unsafe { JSC__JSValue__unwrapBoxedPrimitive(global, self) };
        scope.return_if_exception()?;
        Ok(result)
    }

    pub fn get_prototype(self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__getPrototype(self, global) }
    }

    pub fn eql_value(self, other: JSValue) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__eqlValue(self, other) }
    }

    pub fn eql_cell(self, other: &JSCell) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__eqlCell(self, other) }
    }
}

/// This must match the enum in C++ in src/jsc/bindings/bindings.cpp BuiltinNamesMap.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr, strum::EnumString)]
pub enum BuiltinName {
    method,
    headers,
    status,
    statusText,
    url,
    body,
    data,
    toString,
    redirect,
    inspectCustom,
    highWaterMark,
    path,
    stream,
    asyncIterator,
    name,
    message,
    error,
    default,
    encoding,
    fatal,
    ignoreBOM,
    r#type,
    signal,
    cmd,
}

impl BuiltinName {
    pub fn has(property: &[u8]) -> bool {
        Self::get(property).is_some()
    }

    pub fn get(property: &[u8]) -> Option<BuiltinName> {
        // TODO(port): Zig used bun.ComptimeEnumMap (perfect hash). Phase B: phf::Map.
        BUILTIN_NAME_MAP.get(property).copied()
    }
}

// TODO(port): replace with phf::phf_map! over &'static [u8] keys.
static BUILTIN_NAME_MAP: phf::Map<&'static [u8], BuiltinName> = phf::phf_map! {
    b"method" => BuiltinName::method,
    b"headers" => BuiltinName::headers,
    b"status" => BuiltinName::status,
    b"statusText" => BuiltinName::statusText,
    b"url" => BuiltinName::url,
    b"body" => BuiltinName::body,
    b"data" => BuiltinName::data,
    b"toString" => BuiltinName::toString,
    b"redirect" => BuiltinName::redirect,
    b"inspectCustom" => BuiltinName::inspectCustom,
    b"highWaterMark" => BuiltinName::highWaterMark,
    b"path" => BuiltinName::path,
    b"stream" => BuiltinName::stream,
    b"asyncIterator" => BuiltinName::asyncIterator,
    b"name" => BuiltinName::name,
    b"message" => BuiltinName::message,
    b"error" => BuiltinName::error,
    b"default" => BuiltinName::default,
    b"encoding" => BuiltinName::encoding,
    b"fatal" => BuiltinName::fatal,
    b"ignoreBOM" => BuiltinName::ignoreBOM,
    b"type" => BuiltinName::r#type,
    b"signal" => BuiltinName::signal,
    b"cmd" => BuiltinName::cmd,
};

impl JSValue {
    pub fn fast_get_or_else(
        self,
        global: &JSGlobalObject,
        builtin_name: BuiltinName,
        alternate: Option<JSValue>,
    ) -> JsResult<Option<JSValue>> {
        if let Some(v) = self.fast_get(global, builtin_name)? {
            return Ok(Some(v));
        }
        if let Some(alt) = alternate {
            return alt.fast_get(global, builtin_name);
        }
        Ok(None)
    }

    /// `self` must be known to be an object. Intended to be more lightweight than ZigString.
    pub fn fast_get(self, global: &JSGlobalObject, builtin_name: BuiltinName) -> JsResult<Option<JSValue>> {
        if cfg!(debug_assertions) {
            debug_assert!(self.is_object());
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let v = from_js_host_call(global, || unsafe {
            JSC__JSValue__fastGet(self, global, builtin_name as u8)
        })?;
        Ok(match v {
            JSValue::ZERO => unreachable!(), // handled by from_js_host_call
            JSValue::UNDEFINED | JSValue::PROPERTY_DOES_NOT_EXIST_ON_OBJECT => None,
            val => Some(val),
        })
    }

    pub fn fast_get_direct(self, global: &JSGlobalObject, builtin_name: BuiltinName) -> Option<JSValue> {
        let result = self.fast_get_direct_(global, builtin_name as u8);
        if result == JSValue::ZERO {
            return None;
        }
        Some(result)
    }

    pub fn fast_get_own(self, global: &JSGlobalObject, builtin_name: BuiltinName) -> Option<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let result = unsafe { JSC__JSValue__fastGetOwn(self, global, builtin_name) };
        if result == JSValue::ZERO {
            return None;
        }
        Some(result)
    }

    pub fn fast_get_direct_(self, global: &JSGlobalObject, builtin_name: u8) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__fastGetDirect_(self, global, builtin_name) }
    }

    pub fn get_if_property_exists_from_path(
        self,
        global: &JSGlobalObject,
        path: JSValue,
    ) -> JsResult<JSValue> {
        let mut scope = TopExceptionScope::init(global);
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let result = unsafe { JSC__JSValue__getIfPropertyExistsFromPath(self, global, path) };
        scope.return_if_exception()?;
        Ok(result)
    }

    pub fn get_symbol_description(self, global: &JSGlobalObject, str: &mut ZigString) {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__getSymbolDescription(self, global, str) }
    }

    pub fn symbol_for(global: &JSGlobalObject, str: &mut ZigString) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__symbolFor(global, str) }
    }

    pub fn symbol_key_for(self, global: &JSGlobalObject, str: &mut ZigString) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__symbolKeyFor(self, global, str) }
    }

    fn _then(
        self,
        global: &JSGlobalObject,
        ctx: JSValue,
        resolve: jsc::JSHostFnZig,
        reject: jsc::JSHostFnZig,
    ) {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe {
            JSC__JSValue___then(self, global, ctx, to_js_host_fn(resolve), to_js_host_fn(reject))
        }
    }

    pub fn then2(
        self,
        global: &JSGlobalObject,
        ctx: JSValue,
        resolve: *const jsc::JSHostFn,
        reject: *const jsc::JSHostFn,
    ) -> Result<(), jsc::JsTerminated> {
        let mut scope = TopExceptionScope::init(global);
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue___then(self, global, ctx, resolve, reject) };
        scope.assert_no_exception_except_termination()
    }

    pub fn then(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        resolve: jsc::JSHostFnZig,
        reject: jsc::JSHostFnZig,
    ) -> Result<(), jsc::JsTerminated> {
        let mut scope = TopExceptionScope::init(global);
        self._then(global, JSValue::from_ptr_address(ctx as usize), resolve, reject);
        scope.assert_no_exception_except_termination()
    }

    /// Like `then`, but the context is a JSValue instead of a raw pointer.
    /// Use this when the context should be GC-managed (e.g., a JSCell that gets collected with
    /// the Promise's reaction if the Promise is GC'd without settling).
    pub fn then_with_value(
        self,
        global: &JSGlobalObject,
        ctx: JSValue,
        resolve: jsc::JSHostFnZig,
        reject: jsc::JSHostFnZig,
    ) -> Result<(), jsc::JsTerminated> {
        let mut scope = TopExceptionScope::init(global);
        self._then(global, ctx, resolve, reject);
        scope.assert_no_exception_except_termination()
    }

    pub fn get_description(self, global: &JSGlobalObject) -> ZigString {
        let mut zig_str = ZigString::init(b"");
        self.get_symbol_description(global, &mut zig_str);
        zig_str
    }

    /// Equivalent to `target[property]`. Calls userland getters/proxies. Can throw. `None`
    /// indicates the property does not exist OR its value is JS undefined (the two are not
    /// distinguished). JS null passes through as a value.
    ///
    /// `property` must be `&[u8]`. A comptime-known slice may defer to calling `fast_get`, which
    /// uses a more optimal code path. Zig used `inline` + `bun.isComptimeKnown` to detect this;
    /// Rust callers should call `fast_get` directly when the key is a `BuiltinName`.
    ///
    /// Cannot handle property names that are numeric indexes. (For this use `get_property_value` instead.)
    #[inline]
    pub fn get(target: JSValue, global: &JSGlobalObject, property_slice: &[u8]) -> JsResult<Option<JSValue>> {
        debug_assert!(target.is_object());

        // PERF(port): Zig `bun.isComptimeKnown(property_slice)` + comptime BuiltinName lookup
        // is not expressible in Rust without const-eval on slices. Fall back to runtime lookup.
        if let Some(builtin_name) = BuiltinName::get(property_slice) {
            return target.fast_get(global, builtin_name);
        }

        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let v = unsafe {
            bun_jsc::cpp::JSC__JSValue__getIfPropertyExistsImpl(
                target,
                global,
                property_slice.as_ptr(),
                u32::try_from(property_slice.len()).unwrap(),
            )
        }?;
        Ok(match v {
            JSValue::ZERO => unreachable!(), // handled by from_js_host_call
            JSValue::PROPERTY_DOES_NOT_EXIST_ON_OBJECT => None,
            // TODO: see bug described in ObjectBindings.cpp — since there are false positives,
            // the better path is to make them negatives, as the number of places that desire
            // throwing on existing undefined is extremely small, but non-zero.
            JSValue::UNDEFINED => None,
            val => Some(val),
        })
    }

    /// Equivalent to `target[property]`. Calls userland getters/proxies. Can throw. `None`
    /// indicates the property does not exist OR its value is JS undefined (the two are not
    /// distinguished). JS null passes through as a value.
    ///
    /// Can handle numeric index property names.
    ///
    /// If you know that the property name is not an integer index, use `get` instead.
    pub fn get_property_value(
        target: JSValue,
        global: &JSGlobalObject,
        property_name: &[u8],
    ) -> JsResult<Option<JSValue>> {
        if cfg!(debug_assertions) {
            debug_assert!(target.is_object());
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let v = from_js_host_call(global, || unsafe {
            JSC__JSValue__getPropertyValue(
                target,
                global,
                property_name.as_ptr(),
                u32::try_from(property_name.len()).unwrap(),
            )
        })?;
        Ok(match v {
            JSValue::PROPERTY_DOES_NOT_EXIST_ON_OBJECT => None,
            JSValue::UNDEFINED => None,
            val => Some(val),
        })
    }

    /// Get *own* property value (i.e. does not resolve property in the prototype chain).
    pub fn get_own(self, global: &JSGlobalObject, property_name: impl AsRef<[u8]>) -> JsResult<Option<JSValue>> {
        let property_name_str = BunString::init(property_name.as_ref());
        let mut scope = TopExceptionScope::init(global);
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let value = unsafe { JSC__JSValue__getOwn(self, global, &property_name_str) };
        scope.return_if_exception()?;
        if value == JSValue::ZERO { Ok(None) } else { Ok(Some(value)) }
    }

    pub fn get_own_by_value(self, global: &JSGlobalObject, property_value: JSValue) -> Option<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let value = unsafe { JSC__JSValue__getOwnByValue(self, global, property_value) };
        if value.0 != 0 { Some(value) } else { None }
    }

    pub fn get_own_truthy(
        self,
        global: &JSGlobalObject,
        property_name: impl AsRef<[u8]>,
    ) -> JsResult<Option<JSValue>> {
        if let Some(prop) = self.get_own(global, property_name)? {
            if prop.is_undefined() {
                return Ok(None);
            }
            return Ok(Some(prop));
        }
        Ok(None)
    }

    /// Safe to use on any JSValue, can error.
    pub fn implements_to_string(self, global: &JSGlobalObject) -> JsResult<bool> {
        if !self.is_object() {
            return Ok(false);
        }
        let Some(function) = self.fast_get(global, BuiltinName::toString)? else {
            return Ok(false);
        };
        Ok(function.is_cell() && function.is_callable())
    }

    // TODO: replace calls to this function with `get_optional`
    pub fn get_own_truthy_comptime(
        self,
        global: &JSGlobalObject,
        property: &'static [u8],
    ) -> JsResult<Option<JSValue>> {
        if let Some(builtin) = BuiltinName::get(property) {
            return Ok(self.fast_get_own(global, builtin));
        }
        self.get_own_truthy(global, property)
    }

    fn truthy_property_value(prop: JSValue) -> Option<JSValue> {
        match prop {
            JSValue::ZERO => unreachable!(),
            // Treat undefined and null as unspecified
            JSValue::NULL | JSValue::UNDEFINED => None,
            // false, 0, are deliberately not included in this list.
            // That would prevent you from passing `0` or `false` to various Bun APIs.
            _ => {
                // Ignore empty string.
                if prop.is_string() && !prop.to_boolean() {
                    return None;
                }
                Some(prop)
            }
        }
    }

    // TODO: replace calls to this function with `get_optional`
    pub fn get_truthy_comptime(
        self,
        global: &JSGlobalObject,
        property: &'static [u8],
    ) -> JsResult<Option<JSValue>> {
        if let Some(builtin) = BuiltinName::get(property) {
            let Some(v) = self.fast_get(global, builtin)? else { return Ok(None) };
            return Ok(Self::truthy_property_value(v));
        }
        self.get_truthy(global, property)
    }

    // TODO: replace calls to this function with `get_optional`
    /// This cannot handle numeric index property names safely. Please use `get_truthy_property_value` instead.
    pub fn get_truthy(self, global: &JSGlobalObject, property: &[u8]) -> JsResult<Option<JSValue>> {
        if let Some(prop) = self.get(global, property)? {
            return Ok(Self::truthy_property_value(prop));
        }
        Ok(None)
    }

    /// Get a property value handling numeric index property names safely.
    pub fn get_truthy_property_value(
        self,
        global: &JSGlobalObject,
        property: &[u8],
    ) -> JsResult<Option<JSValue>> {
        if let Some(prop) = self.get_property_value(global, property)? {
            return Ok(Self::truthy_property_value(prop));
        }
        Ok(None)
    }

    /// Get a value that can be coerced to a string.
    ///
    /// Returns `None` when the value is:
    /// - `JSValue::NULL`
    /// - `JSValue::FALSE`
    /// - `JSValue::UNDEFINED`
    /// - an empty string
    pub fn get_stringish(self, global: &JSGlobalObject, property: &[u8]) -> JsResult<Option<BunString>> {
        let mut scope = TopExceptionScope::init(global);
        let Some(prop) = self.get(global, property)? else { return Ok(None) };
        if prop.is_null() || prop == JSValue::FALSE {
            return Ok(None);
        }
        if prop.is_symbol() {
            return Err(global.throw_invalid_property_type_value(property, "string", prop));
        }

        let s = prop.to_bun_string(global)?;
        // errdefer s.deref() — Drop on BunString handles refcount on error path.
        scope.return_if_exception()?;
        if s.is_empty() { Ok(None) } else { Ok(Some(s)) }
    }

    pub fn to_enum_from_map<E, M: jsc::StringMapFromJs<E>>(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
        // TODO(port): Zig `comptime Enum: type` + `comptime StringMap: anytype` were
        // distinct params; in Rust the map type carries the enum.
    ) -> JsResult<E>
    where
        E: 'static,
    {
        if !self.is_string() {
            // PERF(port): was comptime string concat (`property_name ++ " must be a string"`) — profile in Phase B
            return Err(global.throw_invalid_arguments(format_args!(
                "{} must be a string",
                bstr::BStr::new(property_name),
            )));
        }

        match M::from_js(global, self)? {
            Some(v) => Ok(v),
            None => {
                // TODO(port): Zig built `one_of` at comptime by iterating enumFieldNames.
                // Phase B: generate via strum::VariantNames or const concat.
                // PERF(port): was comptime string concat — profile in Phase B
                Err(global.throw_invalid_arguments(format_args!(
                    "{} must be one of {}",
                    bstr::BStr::new(property_name),
                    M::ONE_OF_LIST,
                )))
            }
        }
    }

    pub fn to_enum<E: jsc::EnumWithMap>(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<E> {
        self.to_enum_from_map::<E, E::Map>(global, property_name)
    }

    pub fn to_optional_enum<E: jsc::EnumWithMap>(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<E>> {
        if self.is_empty_or_undefined_or_null() {
            return Ok(None);
        }
        self.to_enum::<E>(global, property_name).map(Some)
    }

    pub fn get_optional_enum<E: jsc::EnumWithMap>(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<E>> {
        if let Some(builtin) = BuiltinName::get(property_name) {
            if let Some(prop) = self.fast_get(global, builtin)? {
                if prop.is_empty_or_undefined_or_null() {
                    return Ok(None);
                }
                return prop.to_enum::<E>(global, property_name).map(Some);
            }
            return Ok(None);
        }

        if let Some(prop) = self.get(global, property_name)? {
            if prop.is_empty_or_undefined_or_null() {
                return Ok(None);
            }
            return prop.to_enum::<E>(global, property_name).map(Some);
        }
        Ok(None)
    }

    pub fn get_own_optional_enum<E: jsc::EnumWithMap>(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<E>> {
        if let Some(builtin) = BuiltinName::get(property_name) {
            if let Some(prop) = self.fast_get_own(global, builtin) {
                if prop.is_empty_or_undefined_or_null() {
                    return Ok(None);
                }
                return prop.to_enum::<E>(global, property_name).map(Some);
            }
            return Ok(None);
        }

        if let Some(prop) = self.get_own(global, property_name)? {
            if prop.is_empty_or_undefined_or_null() {
                return Ok(None);
            }
            return prop.to_enum::<E>(global, property_name).map(Some);
        }
        Ok(None)
    }

    pub fn coerce_to_array(
        prop: JSValue,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<JSValue>> {
        if !prop.js_type_loose().is_array() {
            // PERF(port): was comptime string concat (`property_name ++ " must be an array"`) — profile in Phase B
            return Err(global.throw_invalid_arguments(format_args!(
                "{} must be an array",
                bstr::BStr::new(property_name),
            )));
        }
        if prop.get_length(global)? == 0 {
            return Ok(None);
        }
        Ok(Some(prop))
    }

    pub fn get_array(self, global: &JSGlobalObject, property_name: &'static [u8]) -> JsResult<Option<JSValue>> {
        if let Some(prop) = self.get_optional_value(global, property_name)? {
            return Self::coerce_to_array(prop, global, property_name);
        }
        Ok(None)
    }

    pub fn get_own_array(self, global: &JSGlobalObject, property_name: &'static [u8]) -> JsResult<Option<JSValue>> {
        if let Some(prop) = self.get_own_truthy(global, property_name)? {
            return Self::coerce_to_array(prop, global, property_name);
        }
        Ok(None)
    }

    pub fn get_own_object(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<&'static mut JSObject>> {
        if let Some(prop) = self.get_own_truthy(global, property_name)? {
            let Some(obj) = prop.get_object() else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{} must be an object",
                    bstr::BStr::new(property_name)
                )));
            };
            return Ok(Some(obj));
        }
        Ok(None)
    }

    pub fn get_function(self, global: &JSGlobalObject, property_name: &'static [u8]) -> JsResult<Option<JSValue>> {
        if let Some(prop) = self.get_optional_value(global, property_name)? {
            if !prop.is_cell() || !prop.is_callable() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{} must be a function",
                    bstr::BStr::new(property_name)
                )));
            }
            return Ok(Some(prop));
        }
        Ok(None)
    }

    pub fn get_own_function(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<JSValue>> {
        if let Some(prop) = self.get_own_truthy(global, property_name)? {
            if !prop.is_cell() || !prop.is_callable() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{} must be a function",
                    bstr::BStr::new(property_name)
                )));
            }
            return Ok(Some(prop));
        }
        Ok(None)
    }

    // TODO(port): Zig `coerceOptional(comptime T: type)` switched on JSValue/bool/ZigString.Slice/i32/i64.
    // Expose per-type helpers.
    fn coerce_optional_value(prop: JSValue, _global: &JSGlobalObject, _name: &'static [u8]) -> JsResult<JSValue> {
        Ok(prop)
    }
    fn coerce_optional_slice(
        prop: JSValue,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<bun_str::ZigStringSlice> {
        if prop.is_string() {
            return prop.to_slice_or_null(global);
        }
        Err(jsc::node::validators::throw_err_invalid_arg_type(
            global,
            property_name,
            &[],
            "string",
            prop,
        ))
    }
    fn coerce_optional_i32(prop: JSValue, global: &JSGlobalObject, _name: &'static [u8]) -> JsResult<i32> {
        prop.coerce_i32(global)
    }
    fn coerce_optional_i64(prop: JSValue, global: &JSGlobalObject, _name: &'static [u8]) -> JsResult<i64> {
        prop.coerce_i64(global)
    }

    /// Many Bun APIs are loose and simply want to check if a value is truthy.
    /// Missing value and undefined return `None`. JS null returns `Some(false)`.
    #[inline]
    pub fn get_boolean_loose(self, global: &JSGlobalObject, property_name: &'static [u8]) -> JsResult<Option<bool>> {
        let Some(prop) = self.get(global, property_name)? else { return Ok(None) };
        Ok(Some(prop.to_boolean()))
    }

    /// Many Node.js APIs use `validateBoolean`.
    /// Missing value and undefined return `None`.
    #[inline]
    pub fn get_boolean_strict(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<bool>> {
        let Some(prop) = self.get(global, property_name)? else { return Ok(None) };
        match prop {
            JSValue::UNDEFINED => Ok(None),
            JSValue::FALSE | JSValue::TRUE => Ok(Some(prop == JSValue::TRUE)),
            _ => Err(jsc::node::validators::throw_err_invalid_arg_type(
                global,
                property_name,
                &[],
                "boolean",
                prop,
            )),
        }
    }

    // TODO(port): Zig `getOptional(comptime T: type)` — Rust callers pick a typed variant.
    // The `JSValue` variant (most common) is `get_optional_value`.
    #[inline]
    pub fn get_optional_value(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<JSValue>> {
        let Some(prop) = self.get(global, property_name)? else { return Ok(None) };
        debug_assert!(prop != JSValue::ZERO);
        if !prop.is_undefined_or_null() {
            return Ok(Some(prop));
        }
        Ok(None)
    }

    pub fn get_optional_int<T: OptionalInt>(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<T>> {
        let Some(value) = self.get(global, property_name)? else { return Ok(None) };
        let min: i64 = if T::IS_UNSIGNED { 0 } else { T::MIN_I64.max(-jsc::MAX_SAFE_INTEGER as i64) };
        let max: i64 = T::MAX_I64.min(jsc::MAX_SAFE_INTEGER as i64);
        global
            .validate_integer_range::<T>(value, T::ZERO, jsc::IntegerRangeOptions {
                min,
                max,
                field_name: property_name,
            })
            .map(Some)
    }

    pub fn get_own_optional_value(
        self,
        global: &JSGlobalObject,
        property_name: &'static [u8],
    ) -> JsResult<Option<JSValue>> {
        let prop = if let Some(builtin) = BuiltinName::get(property_name) {
            self.fast_get_own(global, builtin)
        } else {
            self.get_own(global, property_name)?
        };
        let Some(prop) = prop else { return Ok(None) };
        if !prop.is_empty_or_undefined_or_null() {
            return Ok(Some(prop));
        }
        Ok(None)
    }

    /// Alias for `get`.
    #[inline]
    pub fn get_if_property_exists(
        target: JSValue,
        global: &JSGlobalObject,
        property: &[u8],
    ) -> JsResult<Option<JSValue>> {
        Self::get(target, global, property)
    }

    pub fn create_type_error(message: &ZigString, code: &ZigString, global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__createTypeError(message, code, global) }
    }

    pub fn create_range_error(message: &ZigString, code: &ZigString, global: &JSGlobalObject) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__createRangeError(message, code, global) }
    }

    pub fn is_strict_equal(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__isStrictEqual(self, other, global)
        })
    }

    /// Object.is()
    ///
    /// This algorithm differs from the IsStrictlyEqual Algorithm by treating all NaN values as
    /// equivalent and by differentiating +0𝔽 from -0𝔽.
    /// https://tc39.es/ecma262/#sec-samevalue
    ///
    /// This can throw because it resolves rope strings.
    pub fn is_same_value(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        if self.0 == other.0 {
            return Ok(true);
        }
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__isSameValue(self, other, global)
        })
    }

    pub fn deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__deepEquals(self, other, global)
        })
    }
    /// Same as `deep_equals`, but with jest asymmetric matchers enabled.
    pub fn jest_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__jestDeepEquals(self, other, global)
        })
    }

    pub fn strict_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__strictDeepEquals(self, other, global)
        })
    }
    /// Same as `strict_deep_equals`, but with jest asymmetric matchers enabled.
    pub fn jest_strict_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__jestStrictDeepEquals(self, other, global)
        })
    }
    /// Same as `deep_match`, but with jest asymmetric matchers enabled.
    pub fn jest_deep_match(
        self,
        subset: JSValue,
        global: &JSGlobalObject,
        replace_props_with_asymmetric_matchers: bool,
    ) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__jestDeepMatch(self, subset, global, replace_props_with_asymmetric_matchers)
        })
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum DiffMethod {
    None,
    Character,
    Word,
    Line,
}

impl JSValue {
    pub fn determine_diff_method(self, other: JSValue, global: &JSGlobalObject) -> DiffMethod {
        if (self.is_string() && other.is_string()) || (self.is_buffer(global) && other.is_buffer(global)) {
            return DiffMethod::Character;
        }
        if (self.is_reg_exp() && other.is_object()) || (self.is_object() && other.is_reg_exp()) {
            return DiffMethod::Character;
        }
        if self.is_object() && other.is_object() {
            return DiffMethod::Line;
        }
        DiffMethod::None
    }

    /// Static cast a value into a `JSC::JSString`. Casting a non-string results in
    /// safety-protected undefined behavior.
    ///
    /// - `self` is re-interpreted, so runtime casting does not occur (e.g. `self.toString()`).
    /// - Does not allocate.
    /// - Does not increment ref count.
    /// - Make sure `self` stays on the stack. If you're method chaining, you may need to call
    ///   `self.ensure_still_alive()`.
    pub fn as_string(self) -> *mut JSString {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__asString(self) }
    }

    /// Get the internal number of the `JSC::DateInstance` object.
    /// Returns NaN if the value is not a `JSC::DateInstance` (`Date` in JS).
    pub fn get_unix_timestamp(self) -> f64 {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__getUnixTimestamp(self) }
    }

    /// Calls getTime() - getUTCT
    pub fn get_utc_timestamp(self, global: &JSGlobalObject) -> f64 {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__getUTCTimestamp(global, self) }
    }
}

pub struct StringFormatter<'a> {
    pub value: JSValue,
    pub global_object: &'a JSGlobalObject,
}

impl core::fmt::Display for StringFormatter<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let s = match self.value.to_bun_string(self.global_object) {
            Ok(s) => s,
            // TODO(port): Zig used bun.deprecated.jsErrorToWriteError; map JsError → fmt::Error.
            Err(_) => return Err(core::fmt::Error),
        };
        // defer s.deref() — Drop handles refcount.
        core::fmt::Display::fmt(&s, f)
    }
}

impl JSValue {
    pub fn fmt_string(self, global: &JSGlobalObject) -> StringFormatter<'_> {
        StringFormatter { value: self, global_object: global }
    }

    pub fn to_fmt<'a>(
        self,
        formatter: &'a mut jsc::console_object::Formatter,
    ) -> jsc::console_object::formatter::ZigFormatter<'a> {
        formatter.remaining_values = &[];
        if formatter.map_node.is_some() {
            formatter.deinit();
        }
        formatter.stack_check.update();
        jsc::console_object::formatter::ZigFormatter {
            formatter,
            value: self,
        }
    }

    /// Check if the JSValue is either a signed 32-bit integer or a double and return the value as f64.
    ///
    /// This does not call `valueOf` on the JSValue.
    pub fn get_number(self) -> Option<f64> {
        if self.is_int32() {
            return Some(self.as_int32() as f64);
        }
        if self.is_number() {
            // Don't need to check for !is_int32() because above
            return Some(self.as_double());
        }
        None
    }

    /// Asserts this is a number, undefined, null, or a boolean.
    pub fn as_number(self) -> f64 {
        debug_assert!(self.is_number() || self.is_undefined_or_null() || self.is_boolean());
        if self.is_int32() {
            self.as_int32() as f64
        } else if self.is_number() {
            // Don't need to check for !is_int32() because above
            self.as_double()
        } else if self.is_undefined_or_null() {
            0.0
        } else if self.is_boolean() {
            (self.as_boolean() as u8) as f64
        } else {
            f64::NAN // unreachable in assertion builds
        }
    }

    pub fn as_double(self) -> f64 {
        debug_assert!(self.is_double());
        FFI::jsvalue_to_double(FFI::EncodedJSValue { as_js_value: self })
    }

    /// Encodes addr as a double. Resulting value can be passed to `as_ptr_address`.
    pub fn from_ptr_address(addr: usize) -> JSValue {
        Self::js_double_number(addr as f64)
    }

    /// Interprets a numeric JSValue as a pointer address. Use on values returned by `from_ptr_address`.
    pub fn as_ptr_address(self) -> usize {
        self.as_number() as usize
    }

    /// Equivalent to the `!!` operator.
    pub fn to_boolean(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        self != JSValue::ZERO && unsafe { JSC__JSValue__toBoolean(self) }
    }

    pub fn as_boolean(self) -> bool {
        if cfg!(debug_assertions) {
            if !self.is_boolean() {
                Output::panic(format_args!(
                    "Expected boolean but found {}",
                    <&'static str>::from(self.js_type_loose())
                ));
            }
        }
        FFI::jsvalue_to_bool(FFI::EncodedJSValue { as_js_value: self })
    }

    #[inline]
    pub fn as_int52(self) -> i64 {
        if cfg!(debug_assertions) {
            debug_assert!(self.is_number());
        }
        // TODO(port): Zig used coerceJSValueDoubleTruncatingTT(i52, i64, ...).
        // Approximate with i64 truncation; revisit if i52 wrap semantics matter.
        coerce_js_value_double_truncating_tt::<i64, i64>(self.as_number())
    }

    pub fn to_int32(self) -> i32 {
        if self.is_int32() {
            return self.as_int32();
        }
        if let Some(num) = self.get_number() {
            return coerce_js_value_double_truncating_t::<i32>(num);
        }
        if cfg!(debug_assertions) {
            debug_assert!(!self.is_string()); // use coerce() instead
            debug_assert!(!self.is_cell()); // use coerce() instead
        }
        // TODO: this shouldn't be reachable.
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__toInt32(self) }
    }

    pub fn as_int32(self) -> i32 {
        // TODO: promote assertion to allow_assert. That has not been done because
        // the assertion was commented out until 2024-12-12
        if cfg!(debug_assertions) {
            debug_assert!(self.is_int32());
        }
        FFI::jsvalue_to_int32(FFI::EncodedJSValue { as_js_value: self })
    }

    pub fn as_file_descriptor(self) -> bun_sys::Fd {
        debug_assert!(self.is_number());
        bun_sys::Fd::from_uv(self.to_int32())
    }

    #[inline]
    fn to_u16_impl(self) -> u16 {
        (self.to_int32().max(0)) as u16
    }

    #[inline]
    fn to_u32_impl(self) -> u32 {
        u32::try_from(self.to_int64().max(0).min(u32::MAX as i64)).unwrap()
    }

    /// This function supports:
    /// - Array, DerivedArray & friends
    /// - String, DerivedString & friends
    /// - TypedArray
    /// - Map (size)
    /// - WeakMap (size)
    /// - Set (size)
    /// - ArrayBuffer (byteLength)
    /// - anything with a `.length` property returning a number
    ///
    /// If the "length" property does not exist, this function will return 0.
    pub fn get_length(self, global: &JSGlobalObject) -> JsResult<u64> {
        let len = self.get_length_if_property_exists_internal(global)?;
        if len == f64::MAX {
            return Ok(0);
        }
        // i52::MAX == (1<<51)-1
        const I52_MAX: f64 = ((1u64 << 51) - 1) as f64;
        Ok(len.clamp(0.0, I52_MAX) as u64)
    }

    /// Do not use this directly!
    ///
    /// If the property does not exist, this function will return `f64::MAX` instead of 0.
    /// TODO this should probably just return an optional
    pub fn get_length_if_property_exists_internal(self, global: &JSGlobalObject) -> JsResult<f64> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__getLengthIfPropertyExistsInternal(self, global)
        })
    }

    pub fn is_aggregate_error(self, global: &JSGlobalObject) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__isAggregateError(self, global) }
    }

    pub fn for_each(
        self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachCallback,
    ) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__forEach(self, global, ctx, callback)
        })
    }

    /// Same as `for_each` but accepts a typed context struct without need for ptr casts.
    #[inline]
    pub fn for_each_with_context<C>(
        self,
        global: &JSGlobalObject,
        ctx: *mut C,
        callback: unsafe extern "C" fn(*mut VM, *mut JSGlobalObject, *mut C, JSValue),
    ) -> JsResult<()> {
        // SAFETY: re-interpret typed callback as the erased fn pointer; ABI matches.
        let func: ForEachCallback = unsafe { core::mem::transmute(callback) };
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__forEach(self, global, ctx as *mut c_void, func)
        })
    }

    pub fn is_iterable(self, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call_generic(global, || unsafe { JSC__JSValue__isIterable(self, global) })
    }

    pub fn string_includes(self, global: &JSGlobalObject, other: JSValue) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { JSC__JSValue__stringIncludes(self, global, other) }
    }

    // TODO: remove this (no replacement)
    #[inline]
    pub fn as_ref(self) -> C_API::JSValueRef {
        (self.0 as u64 as usize) as C_API::JSValueRef
    }

    // TODO: remove this (no replacement)
    #[inline]
    pub fn c(this: C_API::JSValueRef) -> JSValue {
        JSValue::from_raw((this as usize) as BackingInt)
    }

    // TODO: remove this (no replacement)
    #[inline]
    pub fn from_ref(this: C_API::JSValueRef) -> JSValue {
        JSValue::from_raw((this as usize) as BackingInt)
    }

    // TODO: remove this (no replacement)
    #[inline]
    pub fn as_object_ref(self) -> C_API::JSObjectRef {
        (self.0 as u64 as usize) as C_API::JSObjectRef
    }

    /// When the GC sees a JSValue referenced in the stack, it knows not to free it.
    /// This mimics the implementation in JavaScriptCore's C++.
    #[inline]
    pub fn ensure_still_alive(self) {
        if !self.is_cell() {
            return;
        }
        // SAFETY: pointer is only fed to black_box, never dereferenced.
        core::hint::black_box(unsafe { self.as_encoded().as_ptr });
    }

    pub fn unchecked_ptr_cast<T>(value: JSValue) -> &'static mut T {
        // SAFETY: caller asserts the encoded pointer is a live cell of type T.
        unsafe { &mut *(value.as_encoded().as_ptr as *mut T) }
    }

    /// For any callback JSValue created in JS that you will not call *immediately*, you must wrap
    /// it in an AsyncContextFrame with this function. This allows AsyncLocalStorage to work by
    /// snapshotting its state and restoring it when called.
    /// - If there is no current context, this returns the callback as-is.
    /// - It is safe to run `.call()` on the resulting JSValue. This includes automatic unwrapping.
    /// - Do not pass the callback as-is to JS; the wrapped object is NOT a function.
    /// - If passed to C++, call it with `AsyncContextFrame::call()` instead of `JSC::call()`.
    #[inline]
    pub fn with_async_context_if_needed(self, global: &JSGlobalObject) -> JSValue {
        jsc::mark_binding();
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { AsyncContextFrame__withAsyncContextIfNeeded(global, self) }
    }

    pub fn is_async_context_frame(self) -> bool {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { Bun__JSValue__isAsyncContextFrame(self) }
    }

    /// Deserializes a JSValue from a serialized buffer. Zig version of `import('bun:jsc').deserialize`.
    #[inline]
    pub fn deserialize(bytes: &[u8], global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        from_js_host_call(global, || unsafe {
            Bun__JSValue__deserialize(global, bytes.as_ptr(), bytes.len())
        })
    }

    /// Throws a JsError if serialization fails, otherwise returns a SerializedScriptValue.
    /// Must be freed when you are done with the bytes.
    #[inline]
    pub fn serialize(self, global: &JSGlobalObject, flags: SerializedFlags) -> JsResult<SerializedScriptValue> {
        let mut flags_u8: u8 = 0;
        if flags.for_cross_process_transfer {
            flags_u8 |= 1 << 0;
        }
        if flags.for_storage {
            flags_u8 |= 1 << 1;
        }

        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        let value = from_js_host_call_generic(global, || unsafe {
            Bun__serializeJSValue(global, self, flags_u8)
        })?;
        // On Ok path, bytes/handle are non-null per C++ contract.
        Ok(SerializedScriptValue {
            data_ptr: value.bytes,
            data_len: value.size,
            handle: NonNull::new(value.handle).expect("non-null handle"),
        })
    }

    /// Asserts `self` is a proxy.
    pub fn get_proxy_internal_field(self, field: ProxyInternalField) -> JSValue {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { Bun__ProxyObject__getInternalField(self, field) }
    }

    /// For native C++ classes extending JSCell, this retrieves s_info's name.
    /// This is a readonly ASCII string.
    pub fn get_class_info_name(self) -> Option<&'static bun_str::ZStr> {
        if !self.is_cell() {
            return None;
        }
        let mut ptr: *const c_char = b"\0".as_ptr() as *const c_char;
        let mut len: usize = 0;
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        if !unsafe { JSC__JSValue__getClassInfoName(self, &mut ptr, &mut len) } {
            return None;
        }
        // SAFETY: C++ guarantees ptr[len] == 0 and the string is static (s_info::className).
        Some(unsafe { bun_str::ZStr::from_raw(ptr as *const u8, len) })
    }

    /// Marshall a Rust value into a JSValue using a trait.
    ///
    /// - Primitives are converted to their JS equivalent.
    /// - Types with `to_js` or `to_js_newly_created` methods have them called.
    /// - Slices are converted to JS arrays.
    /// - Enums are converted to 32-bit numbers.
    ///
    /// `lifetime` describes the lifetime of `value`. If it must be copied, specify `Temporary`.
    // TODO(port): Zig `fromAny` used heavy @typeInfo reflection (Optional unwrap, pointer deref,
    // bun.trait.isNumber, isSlice, @hasDecl(toJSNewlyCreated/toJS), enum tag). In Rust this
    // becomes a `ToJs` trait with blanket impls per category. Phase B: implement that trait
    // and replace this fn with `T: ToJs` dispatch.
    pub fn from_any<T: jsc::ToJs>(global: &JSGlobalObject, value: T) -> JsResult<JSValue> {
        value.to_js(global)
    }

    /// Print a JSValue to stdout; this is only meant for debugging purposes.
    pub fn dump(value: JSValue, global: &JSGlobalObject) -> Result<(), bun_core::Error> {
        let mut formatter = jsc::console_object::Formatter::new(global);
        // defer formatter.deinit() — Drop handles it.
        // TODO(port): Output.errorWriter().print("{f}\n", ...) — use Output writer.
        let _ = writeln!(Output::error_writer(), "{}", value.to_fmt(&mut formatter));
        Output::flush();
        Ok(())
    }

    pub fn bind(
        self,
        global: &JSGlobalObject,
        bind_this_arg: JSValue,
        name: &BunString,
        length: f64,
        args: &mut [JSValue],
    ) -> JsResult<JSValue> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe {
            bun_jsc::cpp::Bun__JSValue__bind(self, global, bind_this_arg, name, length, args.as_mut_ptr(), args.len())
        }
    }

    pub fn set_prototype_direct(self, global: &JSGlobalObject, proto: JSValue) -> JsResult<()> {
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        unsafe { bun_jsc::cpp::Bun__JSValue__setPrototypeDirect(self, global, proto) }
    }

    /// Equivalent to `JSC::JSValue::decode`.
    pub fn decode(self) -> jsc::DecodedJSValue {
        let mut decoded = jsc::DecodedJSValue::default();
        // SAFETY: DecodedJSValue.u is a union with as_int64 arm.
        unsafe { decoded.u.as_int64 = self.0 };
        decoded
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
}

pub type ForEachCallback =
    unsafe extern "C" fn(vm: *mut VM, global: *mut JSGlobalObject, ctx: *mut c_void, next_value: JSValue);

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FromAnyLifetime {
    Allocated,
    Temporary,
}

pub struct SerializedScriptValue {
    // Bytes are owned by the opaque C++ `handle` and freed in Drop; storing a
    // `&'static [u8]` would be unsound (dangles after drop). Keep raw parts and
    // expose a borrowed view via `data()`.
    data_ptr: *const u8,
    data_len: usize,
    pub handle: NonNull<c_void>,
}

impl SerializedScriptValue {
    #[inline]
    pub fn data(&self) -> &[u8] {
        // SAFETY: data_ptr/data_len came from Bun__serializeJSValue and remain
        // valid for the lifetime of `handle`, which `&self` keeps alive.
        unsafe { core::slice::from_raw_parts(self.data_ptr, self.data_len) }
    }
}

#[repr(C)]
pub struct SerializedScriptValueExternal {
    pub bytes: *const u8,
    pub size: usize,
    pub handle: *mut c_void,
}

impl Drop for SerializedScriptValue {
    fn drop(&mut self) {
        // SAFETY: handle came from Bun__serializeJSValue and is freed exactly once here.
        unsafe { Bun__SerializedScriptSlice__free(self.handle.as_ptr()) }
    }
}

// packed struct(u8) — only bool fields would be `bitflags!`, but `_padding: u6` makes this a
// transparent u8 with manual accessors. Keep as a plain struct since C++ side reads bits.
#[derive(Copy, Clone, Default)]
pub struct SerializedFlags {
    pub for_cross_process_transfer: bool,
    pub for_storage: bool,
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ProxyInternalField {
    Target = 0,
    Handler = 1,
}

pub struct JSPropertyNameIterator {
    pub array: *mut C_API::OpaqueJSPropertyNameArray,
    pub count: u32,
    pub i: u32,
}

impl JSPropertyNameIterator {
    pub fn next(&mut self) -> Option<C_API::JSStringRef> {
        if self.i >= self.count {
            return None;
        }
        let i = self.i;
        self.i += 1;
        // SAFETY: extern "C" call into JSC bindings; args are valid live cells/borrows per caller invariant.
        Some(unsafe { C_API::JSPropertyNameArrayGetNameAtIndex(self.array, i) })
    }
}

pub mod exposed_to_ffi {
    pub use bun_jsc::cpp::JSC__JSValue__toInt64 as JSVALUE_TO_INT64;
    pub use super::JSC__JSValue__toUInt64NoTruncate as JSVALUE_TO_UINT64;
    pub use super::JSC__JSValue__fromInt64NoTruncate as INT64_TO_JSVALUE;
    pub use super::JSC__JSValue__fromUInt64NoTruncate as UINT64_TO_JSVALUE;
}

// ─── helper traits (port-only) ────────────────────────────────────────────────

/// Trait abstracting over key types accepted by `put`/`delete_property`.
// TODO(port): Zig accepted *ZigString | ZigString | *bun.String | bun.String | []const u8 via
// @typeInfo. Implement for those types in Phase B.
pub trait PutKey {
    fn as_zig_string(&self) -> ZigString;
    fn put(self, target: JSValue, global: &JSGlobalObject, result: JSValue);
}

/// Trait abstracting over numeric types accepted by `js_number`/`js_number_with_type`.
// TODO(port): impl for u0/f32/f64/u31/c_ushort/u8/i16/i32/c_int/i8/u16/c_long/u32/u52/c_uint/
// i64/isize/usize/u64 + enum-tag types per Zig switch.
pub trait IntoJsNumber {
    fn into_js_number(self) -> JSValue;
}

/// Trait for `get_optional_int` integer bounds.
pub trait OptionalInt: Copy {
    const IS_UNSIGNED: bool;
    const MIN_I64: i64;
    const MAX_I64: i64;
    const ZERO: Self;
}

// ─── extern "C" declarations ──────────────────────────────────────────────────
// TODO(port): move to bun_jsc_sys

unsafe extern "C" {
    fn JSC__JSValue__isJSXElement(this: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__getDirectIndex(this: JSValue, global: *const JSGlobalObject, i: u32) -> JSValue;
    fn JSC__JSValue__forEachPropertyNonIndexed(
        v: JSValue,
        global: *const JSGlobalObject,
        ctx: *mut c_void,
        f: Option<PropertyIteratorFn>,
    );
    fn Bun__JSValue__toNumber(value: JSValue, global: *const JSGlobalObject) -> f64;
    fn JSC__JSValue__isInstanceOf(this: JSValue, global: *const JSGlobalObject, ctor: JSValue) -> bool;
    fn Bun__JSValue__call(
        ctx: *const JSGlobalObject,
        object: JSValue,
        this_object: JSValue,
        argument_count: usize,
        arguments: *const JSValue,
    ) -> JSValue;
    fn Bun__Process__queueNextTick1(global: *const JSGlobalObject, func: JSValue, a: JSValue);
    fn Bun__Process__queueNextTick2(global: *const JSGlobalObject, func: JSValue, a: JSValue, b: JSValue);
    fn JSC__JSValue__jsType(this: JSValue) -> JSType;
    fn JSC__jsTypeStringForValue(global: *const JSGlobalObject, value: JSValue) -> *mut JSString;
    fn JSC__JSValue__createEmptyObjectWithNullPrototype(global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__createEmptyObject(global: *const JSGlobalObject, len: usize) -> JSValue;
    fn JSC__JSValue__createEmptyArray(global: *const JSGlobalObject, len: usize) -> JSValue;
    fn JSC__JSValue__putRecord(
        value: JSValue,
        global: *const JSGlobalObject,
        key: *mut ZigString,
        values_array: *mut ZigString,
        values_len: usize,
    );
    fn JSC__JSValue__put(value: JSValue, global: *const JSGlobalObject, key: *const ZigString, result: JSValue);
    fn JSC__JSValue__deleteProperty(target: JSValue, global: *const JSGlobalObject, key: *const ZigString) -> bool;
    fn JSC__JSValue__putBunString(value: JSValue, global: *const JSGlobalObject, key: *const BunString, result: JSValue);
    fn JSC__JSValue__upsertBunStringArray(
        value: JSValue,
        global: *const JSGlobalObject,
        key: *const BunString,
        result: JSValue,
    ) -> JSValue;
    fn JSC__JSValue__putToPropertyKey(target: JSValue, global: *const JSGlobalObject, key: JSValue, value: JSValue);
    fn JSC__JSValue__putIndex(value: JSValue, global: *const JSGlobalObject, i: u32, out: JSValue);
    fn JSC__JSValue__push(value: JSValue, global: *const JSGlobalObject, out: JSValue);
    fn JSC__JSValue__toISOString(global: *const JSGlobalObject, this: JSValue, buf: *mut [u8; 28]) -> c_int;
    fn JSC__JSValue__DateNowISOString(global: *const JSGlobalObject, ts: f64) -> JSValue;
    fn JSC__JSValue__dateInstanceFromNullTerminatedString(global: *const JSGlobalObject, s: *const c_char) -> JSValue;
    fn JSC__JSValue__dateInstanceFromNumber(global: *const JSGlobalObject, v: f64) -> JSValue;
    fn JSBuffer__isBuffer(global: *const JSGlobalObject, v: JSValue) -> bool;
    fn Bun__JSValue__protect(value: JSValue);
    fn Bun__JSValue__unprotect(value: JSValue);
    fn JSC__JSValue__createObject2(
        global: *const JSGlobalObject,
        key1: *const ZigString,
        key2: *const ZigString,
        value1: JSValue,
        value2: JSValue,
    ) -> JSValue;
    fn JSC__JSValue__createRopeString(this: JSValue, rhs: JSValue, global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__getErrorsProperty(this: JSValue, global: *const JSGlobalObject) -> JSValue;
    fn JSBuffer__bufferFromLength(global: *const JSGlobalObject, len: i64) -> JSValue;
    fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
        global: *const JSGlobalObject,
        ptr: *mut u8,
        len: usize,
        ctx: *mut c_void,
        dealloc: jsc::c_api::JSTypedArrayBytesDeallocator,
    ) -> JSValue;
    fn JSC__JSValue__createUninitializedUint8Array(global: *const JSGlobalObject, len: usize) -> JSValue;
    fn JSC__JSValue__createInternalPromise(global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__asInternalPromise(v: JSValue) -> *mut JSInternalPromise;
    fn JSC__JSValue__asPromise(v: JSValue) -> *mut JSPromise;
    fn JSC__JSValue__fromEntries(
        global: *const JSGlobalObject,
        keys_array: *mut ZigString,
        values_array: *mut ZigString,
        strings_count: usize,
        clone: bool,
    ) -> JSValue;
    fn JSC__JSValue__keys(global: *const JSGlobalObject, value: JSValue) -> JSValue;
    fn JSC__JSValue__values(global: *const JSGlobalObject, value: JSValue) -> JSValue;
    fn JSC__JSValue__hasOwnPropertyValue(this: JSValue, global: *const JSGlobalObject, key: JSValue) -> bool;
    fn JSC__JSValue__asBigIntCompare(this: JSValue, global: *const JSGlobalObject, other: JSValue) -> ComparisonResult;
    fn JSC__JSValue__isAnyError(this: JSValue) -> bool;
    fn JSC__JSValue__toError_(this: JSValue) -> JSValue;
    fn Bun__attachAsyncStackFromPromise(global: *const JSGlobalObject, err: JSValue, promise: *mut JSPromise);
    fn JSC__JSValue__isClass(this: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__getNameProperty(this: JSValue, global: *const JSGlobalObject, ret: *mut ZigString);
    fn JSC__JSValue__getName(this: JSValue, global: *const JSGlobalObject, ret: *mut BunString);
    fn JSC__JSValue__getClassName(this: JSValue, global: *const JSGlobalObject, ret: *mut ZigString);
    fn JSC__JSValue__isException(this: JSValue, vm: *const VM) -> bool;
    fn JSC__JSValue__isTerminationException(this: JSValue) -> bool;
    fn JSC__JSValue__toZigString(this: JSValue, out: *mut ZigString, global: *const JSGlobalObject);
    fn JSC__JSValue__asArrayBuffer(this: JSValue, global: *const JSGlobalObject, out: *mut ArrayBuffer) -> bool;
    pub(crate) fn JSC__JSValue__fromInt64NoTruncate(global: *const JSGlobalObject, i: i64) -> JSValue;
    pub(crate) fn JSC__JSValue__fromUInt64NoTruncate(global: *const JSGlobalObject, i: u64) -> JSValue;
    fn JSC__JSValue__fromTimevalNoTruncate(global: *const JSGlobalObject, nsec: i64, sec: i64) -> JSValue;
    fn JSC__JSValue__bigIntSum(global: *const JSGlobalObject, a: JSValue, b: JSValue) -> JSValue;
    pub(crate) fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) -> u64;
    fn JSC__JSValue__jsonStringify(this: JSValue, global: *const JSGlobalObject, indent: u32, out: *mut BunString);
    fn JSC__JSValue__jsonStringifyFast(this: JSValue, global: *const JSGlobalObject, out: *mut BunString);
    fn JSC__JSValue__toObject(this: JSValue, global: *const JSGlobalObject) -> *mut JSObject;
    fn JSC__JSValue__unwrapBoxedPrimitive(global: *const JSGlobalObject, this: JSValue) -> JSValue;
    fn JSC__JSValue__getPrototype(this: JSValue, global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__eqlValue(this: JSValue, other: JSValue) -> bool;
    fn JSC__JSValue__eqlCell(this: JSValue, other: *const JSCell) -> bool;
    fn JSC__JSValue__fastGet(value: JSValue, global: *const JSGlobalObject, builtin_id: u8) -> JSValue;
    fn JSC__JSValue__fastGetOwn(value: JSValue, global: *const JSGlobalObject, property: BuiltinName) -> JSValue;
    fn JSC__JSValue__fastGetDirect_(this: JSValue, global: *const JSGlobalObject, builtin_name: u8) -> JSValue;
    fn JSC__JSValue__getPropertyValue(target: JSValue, global: *const JSGlobalObject, ptr: *const u8, len: u32) -> JSValue;
    fn JSC__JSValue__getIfPropertyExistsFromPath(this: JSValue, global: *const JSGlobalObject, path: JSValue) -> JSValue;
    fn JSC__JSValue__getSymbolDescription(this: JSValue, global: *const JSGlobalObject, str: *mut ZigString);
    fn JSC__JSValue__symbolFor(global: *const JSGlobalObject, str: *mut ZigString) -> JSValue;
    fn JSC__JSValue__symbolKeyFor(this: JSValue, global: *const JSGlobalObject, str: *mut ZigString) -> bool;
    fn JSC__JSValue___then(
        this: JSValue,
        global: *const JSGlobalObject,
        ctx: JSValue,
        resolve: *const jsc::JSHostFn,
        reject: *const jsc::JSHostFn,
    );
    fn JSC__JSValue__getOwn(value: JSValue, global: *const JSGlobalObject, name: *const BunString) -> JSValue;
    fn JSC__JSValue__getOwnByValue(value: JSValue, global: *const JSGlobalObject, prop: JSValue) -> JSValue;
    fn JSC__JSValue__createTypeError(msg: *const ZigString, code: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__createRangeError(msg: *const ZigString, code: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__isStrictEqual(this: JSValue, other: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__isSameValue(this: JSValue, other: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__deepEquals(this: JSValue, other: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__jestDeepEquals(this: JSValue, other: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__strictDeepEquals(this: JSValue, other: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__jestStrictDeepEquals(this: JSValue, other: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__jestDeepMatch(this: JSValue, subset: JSValue, global: *const JSGlobalObject, replace: bool) -> bool;
    fn JSC__JSValue__asString(this: JSValue) -> *mut JSString;
    fn JSC__JSValue__getUnixTimestamp(this: JSValue) -> f64;
    fn JSC__JSValue__getUTCTimestamp(global: *const JSGlobalObject, this: JSValue) -> f64;
    fn JSC__JSValue__toBoolean(this: JSValue) -> bool;
    fn JSC__JSValue__toInt32(this: JSValue) -> i32;
    fn JSC__JSValue__getLengthIfPropertyExistsInternal(this: JSValue, global: *const JSGlobalObject) -> f64;
    fn JSC__JSValue__isAggregateError(this: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__forEach(this: JSValue, global: *const JSGlobalObject, ctx: *mut c_void, cb: ForEachCallback);
    fn JSC__JSValue__isIterable(this: JSValue, global: *const JSGlobalObject) -> bool;
    fn JSC__JSValue__stringIncludes(this: JSValue, global: *const JSGlobalObject, other: JSValue) -> bool;
    fn Bun__JSValue__deserialize(global: *const JSGlobalObject, data: *const u8, len: usize) -> JSValue;
    fn Bun__serializeJSValue(global: *const JSGlobalObject, value: JSValue, flags: u8) -> SerializedScriptValueExternal;
    fn Bun__SerializedScriptSlice__free(handle: *mut c_void);
    fn Bun__ProxyObject__getInternalField(this: JSValue, field: ProxyInternalField) -> JSValue;
    fn JSC__JSValue__getClassInfoName(value: JSValue, out: *mut *const c_char, len: *mut usize) -> bool;
    fn AsyncContextFrame__withAsyncContextIfNeeded(global: *const JSGlobalObject, callback: JSValue) -> JSValue;
    fn Bun__JSValue__isAsyncContextFrame(value: JSValue) -> bool;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSValue.zig (2518 lines)
//   confidence: medium
//   todos:      30
//   notes:      Heavy comptime-reflection fns (coerce/to/put/jsNumberWithType/fromAny/toEnum*) replaced with trait stubs (PutKey/IntoJsNumber/ToJs/EnumWithMap); get_date_now_iso_string mirrors a Zig type-mismatch bug; aarch64 fcvtzs asm path deferred to PERF(port). SerializedScriptValue.data now ptr+len with borrowed data() accessor.
// ──────────────────────────────────────────────────────────────────────────
