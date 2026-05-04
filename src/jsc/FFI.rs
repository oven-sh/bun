// This is zig translate-c run on ffi.h
// it turns out: FFI.h is faster than our implementation that calls into C++ bindings
// so we just use this in some cases
//
// PORT NOTE: the original .zig is raw `zig translate-c` output. The meaningful
// surface (EncodedJSValue + tag constants + inline coercion fns) is ported
// below; the ~390 lines of compiler-builtin macro noise (`__clang__`,
// `__INT_MAX__`, `__ARM_FEATURE_*`, …) emitted by translate-c are dropped —
// they are never referenced.

#![allow(non_snake_case, non_upper_case_globals, clippy::missing_safety_doc)]

use core::ffi::{c_int, c_longlong, c_ulonglong, c_void};

use bun_jsc::{JSGlobalObject, JSValue};

pub type JSCell = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct struct_unnamed_1 {
    pub payload: i32,
    pub tag: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union union_EncodedJSValue {
    pub as_int64: i64,
    pub ptr: *mut c_void,
    pub as_bits: struct_unnamed_1,
    pub as_ptr: *mut c_void,
    pub as_double: f64,
    pub as_js_value: JSValue,
}
pub type EncodedJSValue = union_EncodedJSValue;

#[unsafe(no_mangle)]
pub static mut ValueUndefined: EncodedJSValue = EncodedJSValue {
    as_int64: (2 | 8) as i64,
};

pub const TRUE_I64: i64 = ((2 | 4) | 1) as i64;

#[unsafe(no_mangle)]
pub static mut ValueTrue: EncodedJSValue = EncodedJSValue { as_int64: TRUE_I64 };

pub type JSContext = *mut c_void;

#[inline]
pub fn jsvalue_is_cell(val: EncodedJSValue) -> bool {
    // SAFETY: reading the i64 arm of a #[repr(C)] union of 8-byte scalars; all bit patterns valid.
    let bits = unsafe { val.as_int64 } as c_ulonglong;
    ((bits & NUMBER_TAG) | (2 as c_ulonglong)) == 0
}

#[inline]
pub fn jsvalue_is_int32(val: EncodedJSValue) -> bool {
    // SAFETY: see jsvalue_is_cell.
    let bits = unsafe { val.as_int64 } as c_ulonglong;
    (bits & NUMBER_TAG) == NUMBER_TAG
}

#[inline]
pub fn jsvalue_is_number(val: EncodedJSValue) -> bool {
    // SAFETY: see jsvalue_is_cell.
    let bits = unsafe { val.as_int64 } as c_ulonglong;
    (bits & NUMBER_TAG) != 0
}

#[inline]
pub fn jsvalue_to_uint64(value: EncodedJSValue) -> u64 {
    if jsvalue_is_int32(value) {
        return jsvalue_to_int32(value) as c_longlong as u64;
    }
    if jsvalue_is_number(value) {
        // PORT NOTE: Rust `as` saturates on overflow/NaN where Zig @intFromFloat is UB;
        // callers already range-check via the int32/number tags so behavior matches.
        return jsvalue_to_double(value) as u64;
    }
    // SAFETY: extern "C" fn with by-value POD union arg; no invariants beyond ABI.
    unsafe { JSVALUE_TO_UINT64_SLOW(value) }
}

#[inline]
pub fn jsvalue_to_int64(value: EncodedJSValue) -> i64 {
    if jsvalue_is_int32(value) {
        return jsvalue_to_int32(value) as c_longlong as i64;
    }
    if jsvalue_is_number(value) {
        return jsvalue_to_double(value) as i64;
    }
    // SAFETY: extern "C" fn with by-value POD union arg.
    unsafe { JSVALUE_TO_INT64_SLOW(value) }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSVALUE_TO_UINT64_SLOW(value: EncodedJSValue) -> u64;
    pub fn JSVALUE_TO_INT64_SLOW(value: EncodedJSValue) -> i64;
}

// In Zig these alias `jsc.JSValue.fromUInt64NoTruncate` / `fromInt64NoTruncate`
// directly; Rust cannot bind a method as a free `const`, so forward through a fn.
#[inline]
pub fn uint64_to_jsvalue_slow(global_object: &JSGlobalObject, val: u64) -> JSValue {
    JSValue::from_uint64_no_truncate(global_object, val)
}
#[inline]
pub fn int64_to_jsvalue_slow(global_object: &JSGlobalObject, val: i64) -> JSValue {
    JSValue::from_int64_no_truncate(global_object, val)
}

#[inline]
pub fn uint64_to_jsvalue(global_object: *mut c_void, val: u64) -> EncodedJSValue {
    if val < 2147483648 as c_ulonglong {
        return int32_to_jsvalue((val as u32) as i32);
    }
    if val < 9007199254740991 as c_ulonglong {
        return double_to_jsvalue(val as f64);
    }
    // SAFETY: caller passed a non-null *JSGlobalObject erased as anyopaque (matches Zig `.?` unwrap).
    let global = unsafe { &*(global_object as *mut JSGlobalObject) };
    uint64_to_jsvalue_slow(global, val).as_encoded()
}

#[inline]
pub fn int64_to_jsvalue(global_object: *mut c_void, val: i64) -> EncodedJSValue {
    if val >= -(2147483648 as c_longlong) && val <= 2147483648 as c_longlong {
        return int32_to_jsvalue((val as c_int) as i32);
    }
    if val >= -(9007199254740991 as c_longlong) && val <= 9007199254740991 as c_longlong {
        return double_to_jsvalue(val as f64);
    }
    // SAFETY: caller passed a non-null *JSGlobalObject erased as anyopaque.
    let global = unsafe { &*(global_object as *mut JSGlobalObject) };
    int64_to_jsvalue_slow(global, val).as_encoded()
}

#[inline]
pub fn int32_to_jsvalue(val: i32) -> EncodedJSValue {
    EncodedJSValue {
        as_int64: (NUMBER_TAG | (val as u32 as c_ulonglong)) as i64,
    }
}

#[inline]
pub fn double_to_jsvalue(val: f64) -> EncodedJSValue {
    let mut res = EncodedJSValue { as_double: val };
    // SAFETY: type-punning f64 bits as i64 inside a #[repr(C)] union — defined for POD scalars.
    unsafe {
        res.as_int64 = res.as_int64.wrapping_add((1 as c_longlong) << 49);
    }
    res
}

#[inline]
pub fn float_to_jsvalue(val: f32) -> EncodedJSValue {
    double_to_jsvalue(val as f64)
}

#[inline]
pub fn boolean_to_jsvalue(val: bool) -> EncodedJSValue {
    let mut res: EncodedJSValue = EncodedJSValue { as_int64: 0 };
    res.as_int64 = if (val as c_int) != 0 {
        ((2 | 4) | 1) as i64
    } else {
        ((2 | 4) | 0) as i64
    };
    res
}

#[inline]
pub fn jsvalue_to_int32(val: EncodedJSValue) -> i32 {
    // SAFETY: see jsvalue_is_cell.
    (unsafe { val.as_int64 } as c_int) as i32
}

#[inline]
pub fn jsvalue_to_float(val: EncodedJSValue) -> f32 {
    jsvalue_to_double(val) as f32
}

#[inline]
pub fn jsvalue_to_double(mut val: EncodedJSValue) -> f64 {
    // SAFETY: type-punning i64 bits as f64 inside a #[repr(C)] union.
    unsafe {
        val.as_int64 = val.as_int64.wrapping_sub((1 as c_longlong) << 49);
        val.as_double
    }
}

#[inline]
pub fn jsvalue_to_bool(val: EncodedJSValue) -> bool {
    // SAFETY: see jsvalue_is_cell.
    unsafe { val.as_int64 == ((2 | 4) | 1) as c_longlong }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSFunctionCall(globalObject: *mut c_void, callFrame: *mut c_void) -> *mut c_void;
}

// PORT NOTE: ~390 lines of translate-c compiler-builtin macro definitions
// (`__block`, `__INTMAX_C_SUFFIX__`, `__clang_major__`, `__SIZEOF_*`,
// `__ARM_FEATURE_*`, `__APPLE__`, …) from FFI.zig:121-509 intentionally
// dropped — they are clang predefined-macro spew with no callers.

pub const IS_BIG_ENDIAN: c_int = 0;
pub const USE_JSVALUE64: c_int = 1;
pub const USE_JSVALUE32_64: c_int = 0;
pub const TRUE: c_int = 1;
pub const FALSE: c_int = 0;
pub const DOUBLE_ENCODE_OFFSET_BIT: c_int = 49;
pub const DOUBLE_ENCODE_OFFSET: c_longlong = (1 as c_longlong) << DOUBLE_ENCODE_OFFSET_BIT;
pub const OTHER_TAG: c_int = 0x2;
pub const BOOL_TAG: c_int = 0x4;
pub const UNDEFINED_TAG: c_int = 0x8;
pub const TAG_VALUE_FALSE: c_int = (OTHER_TAG | BOOL_TAG) | FALSE;
pub const TAG_VALUE_TRUE: c_int = (OTHER_TAG | BOOL_TAG) | TRUE;
pub const TAG_VALUE_UNDEFINED: c_int = OTHER_TAG | UNDEFINED_TAG;
pub const TAG_VALUE_NULL: c_int = OTHER_TAG;
pub const NOT_CELL_MASK: c_ulonglong = NUMBER_TAG | OTHER_TAG as c_ulonglong;
pub const MAX_INT32: i64 = 2147483648;
pub const MAX_INT52: i64 = 9007199254740991;
pub const NUMBER_TAG: c_ulonglong = 0xfffe_0000_0000_0000;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/FFI.zig (530 lines)
//   confidence: medium
//   todos:      2
//   notes:      translate-c output; ~390 lines of clang predef-macro noise dropped intentionally; union field reads wrapped in unsafe; JSValue::as_encoded()/from_*_no_truncate assumed on bun_jsc::JSValue
// ──────────────────────────────────────────────────────────────────────────
