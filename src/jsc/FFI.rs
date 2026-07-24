// Mechanical translation of ffi.h.
// it turns out: FFI.h is faster than our implementation that calls into C++ bindings
// so we just use this in some cases
//
// The meaningful surface is EncodedJSValue + tag constants + inline coercion
// fns; the compiler-builtin macro noise from ffi.h is dropped — it is never
// referenced.

#![allow(non_snake_case, non_upper_case_globals, clippy::missing_safety_doc)]

use core::ffi::{c_int, c_longlong, c_ulonglong, c_void};

use bun_jsc::JSValue;

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

// PORTING.md §Global mutable state: never mutated → would be `const`, but kept
// as `#[no_mangle] static` to preserve the exported symbol for TinyCC-compiled
// FFI stubs. `RacyCell` is `repr(transparent)` so the symbol's bytes are
// identical to a bare `EncodedJSValue`; the wrapper only satisfies `Sync`
// (the union contains `*mut c_void`).
#[unsafe(no_mangle)]
pub(crate) static ValueUndefined: bun_core::RacyCell<EncodedJSValue> =
    bun_core::RacyCell::new(EncodedJSValue {
        as_int64: (2 | 8) as i64,
    });

pub(crate) const TRUE_I64: i64 = ((2 | 4) | 1) as i64;

#[unsafe(no_mangle)]
pub(crate) static ValueTrue: bun_core::RacyCell<EncodedJSValue> =
    bun_core::RacyCell::new(EncodedJSValue { as_int64: TRUE_I64 });

pub(crate) const DOUBLE_ENCODE_OFFSET_BIT: c_int = 49;
pub(crate) const DOUBLE_ENCODE_OFFSET: c_longlong = (1 as c_longlong) << DOUBLE_ENCODE_OFFSET_BIT;
pub(crate) const OTHER_TAG: c_int = 0x2;
pub(crate) const NOT_CELL_MASK: c_ulonglong = NUMBER_TAG | OTHER_TAG as c_ulonglong;
pub(crate) const NUMBER_TAG: c_ulonglong = 0xfffe_0000_0000_0000;
