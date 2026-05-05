//! Local signature-compatible stubs for `bun_jsc`.
//!
//! TODO(b2-blocked): `bun_jsc` currently fails to compile (concurrent B-2 work
//! — `Counters` missing `Debug` derive at lib.rs:1649). Every type and method
//! signature here mirrors the real `bun_jsc` surface (verified against
//! `src/jsc/lib.rs`) so once `bun_jsc` is green this whole file is replaced by
//! `pub use bun_jsc::*;` with zero callsite churn.
//!
//! Bodies are `unimplemented!()`; this is compile-only Phase-B scaffolding.

#![allow(unused_variables)]

use core::marker::PhantomData;

// ──────────────────────────────────────────────────────────────────────────
// Core handles
// ──────────────────────────────────────────────────────────────────────────

/// `bun_jsc::JSValue` — `#[repr(transparent)]` wrapper around the encoded
/// 64-bit JSValue. `!Send + !Sync` via PhantomData (matches bun_jsc).
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct JSValue(pub usize, PhantomData<*const ()>);

impl Default for JSValue {
    fn default() -> Self { Self::ZERO }
}

/// `bun_jsc::JSGlobalObject` — opaque, always borrowed.
#[repr(C)]
pub struct JSGlobalObject { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

/// `bun_jsc::CallFrame` — opaque, always borrowed.
#[repr(C)]
pub struct CallFrame { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

/// `bun_jsc::JSObject` — opaque cell handle.
#[repr(C)]
pub struct JSObject { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JsError {
    Thrown,
    OutOfMemory,
    Terminated,
}
pub type JsResult<T> = core::result::Result<T, JsError>;

impl From<JsError> for bun_core::Error {
    fn from(_: JsError) -> Self { bun_core::err!("JSError") }
}
impl From<JsError> for bun_sql::postgres::AnyPostgresError {
    fn from(_: JsError) -> Self { bun_sql::postgres::AnyPostgresError::JSError }
}

// ──────────────────────────────────────────────────────────────────────────
// JSValue surface (subset; signatures mirror src/jsc/lib.rs exactly)
// ──────────────────────────────────────────────────────────────────────────

impl JSValue {
    pub const ZERO: JSValue = JSValue(0, PhantomData);
    pub const UNDEFINED: JSValue = JSValue(0xa, PhantomData);
    pub const NULL: JSValue = JSValue(0x2, PhantomData);
    pub const TRUE: JSValue = JSValue(0x7, PhantomData);
    pub const FALSE: JSValue = JSValue(0x6, PhantomData);

    // ── tag predicates ───────────────────────────────────────────────────
    #[inline] pub fn is_empty(self) -> bool { self.0 == 0 }
    #[inline] pub fn is_undefined(self) -> bool { self.0 == Self::UNDEFINED.0 }
    #[inline] pub fn is_null(self) -> bool { self.0 == Self::NULL.0 }
    #[inline] pub fn is_undefined_or_null(self) -> bool { (self.0 | 0x8) == 0xa }
    #[inline] pub fn is_empty_or_undefined_or_null(self) -> bool {
        self.is_empty() || self.is_undefined_or_null()
    }
    #[inline] pub fn is_boolean(self) -> bool {
        self.0 == Self::TRUE.0 || self.0 == Self::FALSE.0
    }
    #[inline] pub fn is_cell(self) -> bool {
        const NOT_CELL_MASK: usize = 0xfffe_0000_0000_0002;
        !self.is_empty() && (self.0 & NOT_CELL_MASK) == 0
    }
    #[inline] pub fn is_int32(self) -> bool {
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        (self.0 & NUMBER_TAG) == NUMBER_TAG
    }
    #[inline] pub fn is_number(self) -> bool {
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        (self.0 & NUMBER_TAG) != 0
    }
    pub fn is_any_int(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSValue::is_any_int") }
    pub fn is_string(self) -> bool { self.is_cell() && self.js_type().is_string_like() }
    pub fn is_date(self) -> bool { self.is_cell() && self.js_type() == JSType::JSDate }

    pub fn js_type(self) -> JSType { unimplemented!("b2-blocked: bun_jsc::JSValue::js_type") }

    // ── constructors ─────────────────────────────────────────────────────
    #[inline] pub fn js_boolean(b: bool) -> JSValue { if b { Self::TRUE } else { Self::FALSE } }
    pub fn js_number(n: f64) -> JSValue {
        let _ = n; unimplemented!("b2-blocked: bun_jsc::JSValue::js_number")
    }
    pub fn create_empty_object(global: &JSGlobalObject, len: usize) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSValue::create_empty_object")
    }
    pub fn create_empty_object_with_null_prototype(global: &JSGlobalObject) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSValue::create_empty_object_with_null_prototype")
    }
    pub fn create_buffer(global: &JSGlobalObject, slice: &mut [u8]) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSValue::create_buffer")
    }
    pub fn from_date_string(global: &JSGlobalObject, s: *const core::ffi::c_char) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSValue::from_date_string")
    }
    pub fn from_date_number(global: &JSGlobalObject, value: f64) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSValue::from_date_number")
    }
    pub fn from_int64_no_truncate(global: &JSGlobalObject, i: i64) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSValue::from_int64_no_truncate")
    }

    // ── accessors / coercions ────────────────────────────────────────────
    pub fn as_number(self) -> f64 { unimplemented!("b2-blocked: bun_jsc::JSValue::as_number") }
    pub fn to_int64(self) -> i64 { unimplemented!("b2-blocked: bun_jsc::JSValue::to_int64") }
    pub fn to_bun_string(self, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::to_bun_string")
    }
    pub fn get_unix_timestamp(self) -> f64 {
        unimplemented!("b2-blocked: bun_jsc::JSValue::get_unix_timestamp")
    }
    pub fn get_own_by_value(self, global: &JSGlobalObject, property_value: JSValue) -> Option<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::get_own_by_value")
    }
    pub fn get_length(self, global: &JSGlobalObject) -> JsResult<u64> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::get_length")
    }

    // ── object ops ───────────────────────────────────────────────────────
    pub fn put(self, global: &JSGlobalObject, key: &[u8], value: JSValue) {
        unimplemented!("b2-blocked: bun_jsc::JSValue::put")
    }
    pub fn ensure_still_alive(self) {
        // no-op stub: real impl is `std::hint::black_box`.
        let _ = core::hint::black_box(self);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSGlobalObject surface
// ──────────────────────────────────────────────────────────────────────────

impl JSGlobalObject {
    pub fn has_exception(&self) -> bool {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::has_exception")
    }
    pub fn throw(&self, args: core::fmt::Arguments<'_>) -> JsError {
        let _ = args; unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::throw")
    }
    pub fn throw_value(&self, value: JSValue) -> JsError {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::throw_value")
    }
    pub fn take_exception(&self, proof: JsError) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::take_exception")
    }
    pub fn take_error(&self, proof: JsError) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::take_error")
    }
    pub fn create_out_of_memory_error(&self) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::create_out_of_memory_error")
    }
    pub fn ERR_INVALID_ARG_TYPE(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let _ = args; unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::ERR_INVALID_ARG_TYPE")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CallFrame surface
// ──────────────────────────────────────────────────────────────────────────

impl CallFrame {
    pub fn argument(&self, i: usize) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::CallFrame::argument")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSObject surface
// ──────────────────────────────────────────────────────────────────────────

impl JSObject {
    pub fn get_index(this: JSValue, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::JSObject::get_index")
    }
    pub fn max_inline_capacity() -> core::ffi::c_uint {
        unimplemented!("b2-blocked: bun_jsc::JSObject::max_inline_capacity")
    }
}

/// `bun_jsc::ExternColumnIdentifier` — extern struct passed to
/// `JSObject::create_structure`. Layout matches src/jsc/lib.rs (`tag` u8 +
/// untagged union of {index, BunString}).
#[repr(C)]
pub struct ExternColumnIdentifier {
    pub tag: u8,
    pub value: ExternColumnIdentifierValue,
}
#[repr(C)]
pub union ExternColumnIdentifierValue {
    pub index: u32,
    pub name: core::mem::ManuallyDrop<bun_string::String>,
}
impl Default for ExternColumnIdentifier {
    fn default() -> Self {
        Self { tag: 0, value: ExternColumnIdentifierValue { index: 0 } }
    }
}
impl Drop for ExternColumnIdentifier {
    fn drop(&mut self) {
        // tag 2 == BunString (matches src/jsc/JSObject.rs).
        if self.tag == 2 {
            // SAFETY: tag==2 guarantees `name` is the active union field.
            unsafe { core::mem::ManuallyDrop::drop(&mut self.value.name) };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSType (subset of variants this crate names; full table in src/jsc/JSType.rs)
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct JSType(pub u8);
impl JSType {
    pub const HeapBigInt: JSType = JSType(3);
    pub const BooleanObject: JSType = JSType(39);
    pub const NumberObject: JSType = JSType(40);
    pub const Int32Array: JSType = JSType(54);
    pub const Float32Array: JSType = JSType(57);
    pub const JSDate: JSType = JSType(73);

    pub fn is_string_like(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSType::is_string_like") }
    pub fn is_object(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSType::is_object") }
    pub fn is_typed_array_or_array_buffer(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSType") }
    pub fn is_array_like(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSType::is_array_like") }
    pub fn is_indexable(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSType::is_indexable") }
}

// ──────────────────────────────────────────────────────────────────────────
// JSArrayIterator (matches src/jsc/lib.rs B-2 Track-A struct)
// ──────────────────────────────────────────────────────────────────────────

pub struct JSArrayIterator<'a> {
    pub i: u32,
    pub len: u32,
    pub array: JSValue,
    pub global: &'a JSGlobalObject,
}
impl<'a> JSArrayIterator<'a> {
    pub fn init(value: JSValue, global: &'a JSGlobalObject) -> JsResult<Self> {
        Ok(Self { i: 0, len: value.get_length(global)? as u32, array: value, global })
    }
    pub fn next(&mut self) -> JsResult<Option<JSValue>> {
        if self.i >= self.len { return Ok(None); }
        let i = self.i;
        self.i += 1;
        Ok(Some(JSObject::get_index(self.array, self.global, i)?))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Strong / Strong.Optional (matches src/jsc/Strong.rs)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct StrongOptional {
    _impl: Option<core::ptr::NonNull<()>>,
}
impl StrongOptional {
    pub const fn empty() -> Self { Self { _impl: None } }
    pub fn has(&self) -> bool { self._impl.is_some() }
    pub fn get(&self) -> Option<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::strong::Optional::get")
    }
    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        unimplemented!("b2-blocked: bun_jsc::strong::Optional::set")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// bun.String JSC bridges (matches src/jsc/lib.rs `mod bun_string_jsc`)
// ──────────────────────────────────────────────────────────────────────────

pub mod bun_string_jsc {
    use super::{JSGlobalObject, JSValue, JsResult};
    pub fn create_utf8_for_js(global: &JSGlobalObject, utf8: &[u8]) -> JsResult<JSValue> {
        let _ = (global, utf8);
        unimplemented!("b2-blocked: bun_jsc::bun_string_jsc::create_utf8_for_js")
    }
    pub fn to_js(this: &bun_string::String, global: &JSGlobalObject) -> JsResult<JSValue> {
        let _ = (this, global);
        unimplemented!("b2-blocked: bun_jsc::bun_string_jsc::to_js")
    }
}

/// `bun_jsc::StringJsc` — extension trait for `bun_string::String` providing
/// JSC-aware `.to_js()` (mirrors src/jsc/lib.rs).
pub trait StringJsc {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
}
impl StringJsc for bun_string::String {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::to_js(self, global)
    }
}
