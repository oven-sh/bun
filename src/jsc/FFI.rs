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
pub(crate) type EncodedJSValue = union_EncodedJSValue;

#[unsafe(no_mangle)]
pub(crate) static ValueUndefined: bun_core::RacyCell<EncodedJSValue> =
    bun_core::RacyCell::new(EncodedJSValue {
        as_int64: (2 | 8) as i64,
    });

pub(crate) const TRUE_I64: i64 = ((2 | 4) | 1) as i64;

#[unsafe(no_mangle)]
pub(crate) static ValueTrue: bun_core::RacyCell<EncodedJSValue> =
    bun_core::RacyCell::new(EncodedJSValue { as_int64: TRUE_I64 });

// TODO(port): move to jsc_sys
//
// By-value POD union arg; no invariants beyond ABI → `safe fn`.
unsafe extern "C" {
    pub safe fn JSVALUE_TO_UINT64_SLOW(value: EncodedJSValue) -> u64;
    pub safe fn JSVALUE_TO_INT64_SLOW(value: EncodedJSValue) -> i64;
}

#[inline]
pub fn uint64_to_jsvalue_slow(global_object: &JSGlobalObject, val: u64) -> JSValue {
    JSValue::from_uint64_no_truncate(global_object, val)
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSFunctionCall(globalObject: *mut c_void, callFrame: *mut c_void) -> *mut c_void;
}

pub(crate) const DOUBLE_ENCODE_OFFSET_BIT: c_int = 49;
pub(crate) const DOUBLE_ENCODE_OFFSET: c_longlong = (1 as c_longlong) << DOUBLE_ENCODE_OFFSET_BIT;
pub(crate) const OTHER_TAG: c_int = 0x2;
pub(crate) const NOT_CELL_MASK: c_ulonglong = NUMBER_TAG | OTHER_TAG as c_ulonglong;
pub(crate) const NUMBER_TAG: c_ulonglong = 0xfffe_0000_0000_0000;

// ported from: src/jsc/FFI.zig
