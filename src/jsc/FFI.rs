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

impl union_EncodedJSValue {
    /// Raw 64-bit encoding. Safe: every union arm is an 8-byte POD scalar with
    /// no invalid bit patterns, so the `i64` view is always initialized
    /// regardless of which arm wrote it (same-size bit-reinterpret into a
    /// fully-inhabited type — the canonical `bytemuck::cast` precondition).
    #[inline]
    pub const fn bits(self) -> i64 {
        // SAFETY: `#[repr(C)]` union of 8-byte POD scalars (i64 / f64 / ptr /
        // `JSValue` = `repr(transparent)` usize); reading `as_int64` is sound
        // for any initialization.
        unsafe { self.as_int64 }
    }
}

// PORTING.md §Global mutable state: never mutated → would be `const`, but kept
// as `#[no_mangle] static` to preserve the exported symbol for TinyCC-compiled
// FFI stubs. `RacyCell` is `repr(transparent)` so the symbol's bytes are
// identical to a bare `EncodedJSValue`; the wrapper only satisfies `Sync`
// (the union contains `*mut c_void`).
#[unsafe(no_mangle)]
pub static ValueUndefined: bun_core::RacyCell<EncodedJSValue> =
    bun_core::RacyCell::new(EncodedJSValue {
        as_int64: (2 | 8) as i64,
    });

pub const TRUE_I64: i64 = ((2 | 4) | 1) as i64;

#[unsafe(no_mangle)]
pub static ValueTrue: bun_core::RacyCell<EncodedJSValue> =
    bun_core::RacyCell::new(EncodedJSValue { as_int64: TRUE_I64 });

pub type JSContext = *mut c_void;

#[inline]
pub fn jsvalue_is_cell(val: EncodedJSValue) -> bool {
    let bits = val.bits() as c_ulonglong;
    ((bits & NUMBER_TAG) | (2 as c_ulonglong)) == 0
}

#[inline]
pub fn jsvalue_is_int32(val: EncodedJSValue) -> bool {
    let bits = val.bits() as c_ulonglong;
    (bits & NUMBER_TAG) == NUMBER_TAG
}

#[inline]
pub fn jsvalue_is_number(val: EncodedJSValue) -> bool {
    let bits = val.bits() as c_ulonglong;
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
    JSVALUE_TO_UINT64_SLOW(value)
}

#[inline]
pub fn jsvalue_to_int64(value: EncodedJSValue) -> i64 {
    if jsvalue_is_int32(value) {
        return jsvalue_to_int32(value) as c_longlong as i64;
    }
    if jsvalue_is_number(value) {
        return jsvalue_to_double(value) as i64;
    }
    JSVALUE_TO_INT64_SLOW(value)
}

// TODO(port): move to jsc_sys
//
// By-value POD union arg; no invariants beyond ABI → `safe fn`.
unsafe extern "C" {
    pub safe fn JSVALUE_TO_UINT64_SLOW(value: EncodedJSValue) -> u64;
    pub safe fn JSVALUE_TO_INT64_SLOW(value: EncodedJSValue) -> i64;
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
    // Caller passed a non-null *JSGlobalObject erased as anyopaque (matches
    // Zig `.?` unwrap). `opaque_ref` is the safe ZST-handle deref (panics on null).
    let global = JSGlobalObject::opaque_ref(global_object.cast::<JSGlobalObject>());
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
    // Caller passed a non-null *JSGlobalObject erased as anyopaque.
    // `opaque_ref` is the safe ZST-handle deref (panics on null).
    let global = JSGlobalObject::opaque_ref(global_object.cast::<JSGlobalObject>());
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
    // `f64::to_bits` is the stdlib safe bit-reinterpret (replaces the
    // translate-c union pun `res.as_double = val; res.as_int64 += 1<<49`).
    EncodedJSValue {
        as_int64: (val.to_bits() as i64).wrapping_add((1 as c_longlong) << 49),
    }
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
    (val.bits() as c_int) as i32
}

#[inline]
pub fn jsvalue_to_float(val: EncodedJSValue) -> f32 {
    jsvalue_to_double(val) as f32
}

#[inline]
pub fn jsvalue_to_double(val: EncodedJSValue) -> f64 {
    // `f64::from_bits` is the stdlib safe bit-reinterpret (replaces the
    // translate-c union pun `val.as_int64 -= 1<<49; val.as_double`).
    f64::from_bits(val.bits().wrapping_sub((1 as c_longlong) << 49) as u64)
}

#[inline]
pub fn jsvalue_to_bool(val: EncodedJSValue) -> bool {
    val.bits() == ((2 | 4) | 1) as c_longlong
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

// ported from: src/jsc/FFI.zig
