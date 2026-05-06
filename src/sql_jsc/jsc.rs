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
///
/// `_opaque` is `UnsafeCell` so a shared `&JSGlobalObject` does **not** assert
/// immutability of the pointee. The Zig spec passes `*JSGlobalObject`
/// everywhere and the C++ side mutates through it; modelling that as `&T`
/// without interior mutability would make every `&T -> *mut T` cast (and any
/// C++ write behind it) UB under Stacked Borrows. Mirrors `src/jsc/lib.rs`.
#[repr(C)]
pub struct JSGlobalObject {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

impl JSGlobalObject {
    /// Raw `*mut JSGlobalObject` for FFI. Sound for callees that mutate:
    /// `JSGlobalObject` contains `UnsafeCell`, so `&Self` carries
    /// interior-mutable provenance and no read-only pointer is laundered.
    #[inline]
    pub fn as_mut_ptr(&self) -> *mut JSGlobalObject {
        // UnsafeCell::get yields `*mut` with write provenance from `&self`.
        self._opaque.get() as *mut JSGlobalObject
    }
}

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
impl From<JsError> for bun_sql::mysql::protocol::any_mysql_error::Error {
    fn from(e: JsError) -> Self {
        use bun_sql::mysql::protocol::any_mysql_error::Error as E;
        match e {
            JsError::Thrown => E::JSError,
            JsError::OutOfMemory => E::OutOfMemory,
            JsError::Terminated => E::JSTerminated,
        }
    }
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
    pub fn is_any_error(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSValue::is_any_error") }
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
    /// `JSValue.createBuffer(global, slice, null)` — Zig passes a `[]const u8` and
    /// `null` allocator, meaning the C++ side copies. The owning variant above takes
    /// `&mut [u8]`; this is the copying overload (mirrors `array_buffer::create_buffer`).
    pub fn create_buffer_copy(global: &JSGlobalObject, slice: &[u8]) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::array_buffer::create_buffer (copying)")
    }
    /// `JSValue.parse(jsString, global)` — wraps `JSC__JSValue__parseJSON`.
    pub fn parse_json(string: JSValue, global: &JSGlobalObject) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSValue::parse (JSON)")
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
    pub fn is_big_int_in_int64_range(self, _min: i64, _max: i64) -> bool {
        unimplemented!("b2-blocked: bun_jsc::JSValue::is_big_int_in_int64_range")
    }
    pub fn is_big_int_in_uint64_range(self, _min: u64, _max: u64) -> bool {
        unimplemented!("b2-blocked: bun_jsc::JSValue::is_big_int_in_uint64_range")
    }
    pub fn to_boolean(self) -> bool {
        unimplemented!("b2-blocked: bun_jsc::JSValue::to_boolean")
    }
    /// `JSValue::jsDoubleNumber` — boxes an f64. Distinct from `js_number`
    /// which may pick the int32 fast path.
    pub fn js_double_number(n: f64) -> JSValue {
        let _ = n;
        unimplemented!("b2-blocked: bun_jsc::JSValue::js_double_number")
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
    pub fn throw_invalid_arguments(&self, msg: &str) -> JsError {
        let _ = msg; unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::throw_invalid_arguments")
    }
    /// `globalObject.ERR(.OUT_OF_RANGE, fmt, args)` — returns a builder so
    /// callsites can chain `.throw()`.
    pub fn err_out_of_range(&self, args: core::fmt::Arguments<'_>) -> ErrBuilder<'_> {
        let _ = args; ErrBuilder { _g: self }
    }
    /// `globalObject.gregorianDateTimeToMS` — JSC date→ms helper.
    pub fn gregorian_date_time_to_ms(
        &self,
        year: u16, month: u8, day: u8, hour: u8, minute: u8, second: u8, ms: u32,
    ) -> JsResult<f64> {
        let _ = (year, month, day, hour, minute, second, ms);
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::gregorian_date_time_to_ms")
    }
    pub fn ERR_INVALID_ARG_TYPE(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let _ = args; unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::ERR_INVALID_ARG_TYPE")
    }
}

/// Returned by `JSGlobalObject::err_*` so callsites can chain `.throw()`
/// (mirrors `bun_jsc::ErrBuilder`).
pub struct ErrBuilder<'a> { _g: &'a JSGlobalObject }
impl<'a> ErrBuilder<'a> {
    pub fn throw(self) -> JsError { JsError::Thrown }
}

/// `JSC::MarkedArgumentBuffer` — GC-rooting append-only buffer. Stub keeps
/// the field shape so callers compile; bodies unimplemented.
#[derive(Default)]
pub struct MarkedArgumentBuffer { _opaque: PhantomData<*const ()> }
impl MarkedArgumentBuffer {
    pub fn append(&mut self, value: JSValue) {
        let _ = value;
        unimplemented!("b2-blocked: bun_jsc::MarkedArgumentBuffer::append")
    }
}

impl JSGlobalObject {
    /// Shared accessor — mirrors `src/jsc/JSGlobalObject.rs:943`. Returning
    /// `&mut` here would let two calls alias the singleton VM (UB under Stacked
    /// Borrows); mutation goes through [`Self::bun_vm_ptr`] instead.
    pub fn bun_vm(&self) -> &VirtualMachine {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::bun_vm")
    }
    /// Raw-pointer variant of [`Self::bun_vm`] (mirrors
    /// `src/jsc/JSGlobalObject.rs:939`). Returns the FFI `*mut VirtualMachine`
    /// directly so callers that need to mutate VM fields don't launder
    /// provenance through `&VirtualMachine -> *mut` (UB to write through).
    /// Callers form a short-lived `&mut *p` at the use site.
    #[inline]
    pub fn bun_vm_ptr(&self) -> *mut VirtualMachine {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::bun_vm_ptr")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine / RareData (subset; mirrors src/jsc/VirtualMachine.rs +
// src/jsc/rare_data.rs). Only the SQL-touching fields are surfaced here so
// `MySQLContext::init` / `PostgresSQLContext::init` type-check.
// ──────────────────────────────────────────────────────────────────────────

pub struct VirtualMachine {
    _opaque: [u8; 0],
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
impl VirtualMachine {
    pub fn rare_data(&mut self) -> &mut RareData {
        unimplemented!("b2-blocked: bun_jsc::VirtualMachine::rare_data")
    }
    pub fn global(&self) -> &JSGlobalObject {
        unimplemented!("b2-blocked: bun_jsc::VirtualMachine::global")
    }
}

/// Mirrors `bun_jsc::rare_data::RareData` — only SQL fields surfaced.
pub struct RareData {
    pub mysql_context: crate::mysql::MySQLContext,
    pub postgresql_context: crate::postgres::PostgresSQLContext,
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
    /// `JSC.JSObject.createStructure` — wraps `JSC__createStructure` (mirrors
    /// src/jsc/JSObject.rs:153 / src/jsc/lib.rs:1308).
    pub fn create_structure(
        global: &JSGlobalObject,
        owner: JSValue,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::JSObject::create_structure")
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
    pub fn is_array_buffer_like(self) -> bool { unimplemented!("b2-blocked: bun_jsc::JSType::is_array_buffer_like") }
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
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        let _ = (value, global);
        unimplemented!("b2-blocked: bun_jsc::bun_string_jsc::from_js")
    }
    pub fn create_utf8_for_js(global: &JSGlobalObject, utf8: &[u8]) -> JsResult<JSValue> {
        let _ = (global, utf8);
        unimplemented!("b2-blocked: bun_jsc::bun_string_jsc::create_utf8_for_js")
    }
    pub fn to_js(this: &bun_string::String, global: &JSGlobalObject) -> JsResult<JSValue> {
        let _ = (this, global);
        unimplemented!("b2-blocked: bun_jsc::bun_string_jsc::to_js")
    }
    /// `bun.String.parseDate` — parse a date string via JSC, returning the
    /// Unix-epoch ms as f64 (mirrors src/jsc/bun_string_jsc.rs:149).
    pub fn parse_date(this: &mut bun_string::String, global: &JSGlobalObject) -> JsResult<f64> {
        let _ = (this, global);
        unimplemented!("b2-blocked: bun_jsc::bun_string_jsc::parse_date")
    }
    /// `ZigString.toJS` — wraps `Zig::toJSStringValue`.
    pub fn zig_string_to_js(this: bun_string::ZigString, global: &JSGlobalObject) -> JSValue {
        let _ = (this, global);
        unimplemented!("b2-blocked: bun_jsc::bun_string_jsc::zig_string_to_js")
    }
}

/// `bun_jsc::StringJsc` — extension trait for `bun_string::String` providing
/// JSC-aware `.to_js()` / `.from_js()` (mirrors src/jsc/lib.rs).
pub trait StringJsc: Sized {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String>;
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
}
impl StringJsc for bun_string::String {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        bun_string_jsc::from_js(value, global)
    }
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::to_js(self, global)
    }
}

/// `bun_jsc::ZigStringJsc` — extension trait for `bun_string::ZigString` providing
/// JSC-aware `.to_js()` (mirrors src/jsc/bun_string_jsc.rs).
pub trait ZigStringJsc {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
}
impl ZigStringJsc for bun_string::ZigString {
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        bun_string_jsc::zig_string_to_js(self, global)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JsRef — weak/strong self-wrapper back-ref (mirrors src/jsc/JsRef.rs).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct JsRef {
    value: JSValue,
    _strong: Option<core::ptr::NonNull<()>>,
}
impl JsRef {
    pub fn weak(value: JSValue) -> Self { Self { value, _strong: None } }
    pub fn get(&self) -> JSValue { self.value }
    pub fn try_get(&self) -> Option<JSValue> {
        if self.value.is_empty_or_undefined_or_null() { None } else { Some(self.value) }
    }
    pub fn set_weak(&mut self, value: JSValue) { self.value = value; }
    pub fn set_strong(&mut self, _global: &JSGlobalObject, value: JSValue) {
        self.value = value;
        unimplemented!("b2-blocked: bun_jsc::JsRef::set_strong")
    }
    pub fn finalize(&mut self) { self.value = JSValue::ZERO; }
    pub fn deinit(&mut self) { self.value = JSValue::ZERO; }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine extended surface (event_loop, timer, is_shutting_down, get).
// ──────────────────────────────────────────────────────────────────────────

impl VirtualMachine {
    /// `bun_jsc::VirtualMachine::get()` — TLS-backed singleton accessor.
    ///
    /// Spec `VirtualMachine.zig:357-366` returns a raw `*VirtualMachine`.
    /// Returning `&'static mut` would let any two overlapping calls (e.g. a JS
    /// callback fired from inside `vm.tick()` that itself calls `get()`) hold
    /// two live `&'static mut` to the same allocation — UB. Callers form a
    /// short-lived `&mut *p` at the use site instead. Mirrors
    /// `src/jsc/VirtualMachine.rs:451`.
    pub fn get() -> *mut VirtualMachine {
        unimplemented!("b2-blocked: bun_jsc::VirtualMachine::get")
    }
    pub fn event_loop(&self) -> &EventLoop {
        unimplemented!("b2-blocked: bun_jsc::VirtualMachine::event_loop")
    }
    pub fn is_shutting_down(&self) -> bool {
        unimplemented!("b2-blocked: bun_jsc::VirtualMachine::is_shutting_down")
    }
    /// `vm.timer` — exposed as a method returning `&mut TimerHeap` so callers
    /// can write `self.vm().timer().remove(..)`. The Zig field access
    /// (`vm.timer.remove`) maps to this.
    pub fn timer(&mut self) -> &mut TimerHeap {
        unimplemented!("b2-blocked: bun_jsc::VirtualMachine::timer")
    }
}

/// `bun_jsc::EventLoop` — opaque, always borrowed.
#[repr(C)]
pub struct EventLoop { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }
impl EventLoop {
    pub fn enter(&self) { unimplemented!("b2-blocked: bun_jsc::EventLoop::enter") }
    pub fn exit(&self) { unimplemented!("b2-blocked: bun_jsc::EventLoop::exit") }
}

/// `bun_jsc::api::Timer::All` — heap of `EventLoopTimer`. Stub surface for
/// `vm.timer.insert/remove`.
pub struct TimerHeap { _opaque: [u8; 0] }
impl TimerHeap {
    pub fn insert(&mut self, _t: &mut EventLoopTimer) {
        unimplemented!("b2-blocked: bun_jsc::api::Timer::All::insert")
    }
    pub fn remove(&mut self, _t: &mut EventLoopTimer) {
        unimplemented!("b2-blocked: bun_jsc::api::Timer::All::remove")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// EventLoopTimer (mirrors bun_jsc::api::Timer::EventLoopTimer; Zig
// `src/runtime/api/Timer/EventLoopTimer.zig`). Intrusive heap node.
// ──────────────────────────────────────────────────────────────────────────

pub struct EventLoopTimer {
    pub next: bun_core::Timespec,
    pub state: EventLoopTimerState,
    pub tag: EventLoopTimerTag,
    pub heap: [usize; 3], // intrusive heap node placeholder
}
impl Default for EventLoopTimer {
    fn default() -> Self {
        Self { next: bun_core::Timespec::EPOCH, state: Default::default(), tag: Default::default(), heap: [0; 3] }
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum EventLoopTimerState { #[default] Pending, ACTIVE, FIRED, CANCELLED }
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum EventLoopTimerTag {
    #[default] Unset,
    PostgresSQLConnectionTimeout,
    PostgresSQLConnectionMaxLifetime,
    MySQLConnectionTimeout,
    MySQLConnectionMaxLifetime,
}
// Namespace shim so callers can write `EventLoopTimer::State::ACTIVE` /
// `EventLoopTimer::Tag::PostgresSQLConnectionTimeout` (Zig nested-type style).
impl EventLoopTimer {
    #[allow(non_upper_case_globals)]
    pub const State: PhantomData<EventLoopTimerState> = PhantomData;
    #[allow(non_upper_case_globals)]
    pub const Tag: PhantomData<EventLoopTimerTag> = PhantomData;
}

// ──────────────────────────────────────────────────────────────────────────
// AutoFlusher (mirrors bun_jsc::webcore::AutoFlusher; Zig
// `src/runtime/webcore/AutoFlusher.zig`). Registers a deferred microtask that
// calls `T::on_auto_flush(&mut T) -> bool` until it returns false.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AutoFlusher {
    pub registered: bool,
}
impl AutoFlusher {
    pub fn register_deferred_microtask_with_type_unchecked<T>(_this: *mut T, _vm: &mut VirtualMachine) {
        unimplemented!("b2-blocked: bun_jsc::webcore::AutoFlusher::register")
    }
    pub fn unregister_deferred_microtask_with_type<T>(_this: *mut T, _vm: &mut VirtualMachine) {
        unimplemented!("b2-blocked: bun_jsc::webcore::AutoFlusher::unregister")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// api::ServerConfig::SSLConfig — TLS option bag (mirrors
// `src/runtime/api/server/ServerConfig.rs`). Only the fields the SQL
// connection state machines name are surfaced.
// ──────────────────────────────────────────────────────────────────────────

pub mod api {
    use super::*;
    pub mod server_config {
        use super::*;
        #[derive(Default)]
        pub struct SSLConfig {
            pub server_name: *const core::ffi::c_char,
            pub reject_unauthorized: i32,
            pub request_cert: i32,
        }
        impl SSLConfig {
            pub fn server_name(&self) -> *const core::ffi::c_char { self.server_name }
            pub fn from_js(
                _vm: &mut VirtualMachine,
                _global: &JSGlobalObject,
                _value: JSValue,
            ) -> JsResult<Option<Self>> {
                unimplemented!("b2-blocked: bun_jsc::api::ServerConfig::SSLConfig::from_js")
            }
            pub fn as_usockets_for_client_verification(&self) -> bun_uws::us_bun_socket_context_options_t {
                unimplemented!("b2-blocked: SSLConfig::as_usockets_for_client_verification")
            }
        }
        // Zig-style PascalCase alias.
        pub use SSLConfig as SslConfig;
    }
    /// Zig: `jsc.API.ServerConfig.SSLConfig` — PascalCase namespace alias.
    #[allow(non_snake_case)]
    pub mod ServerConfig {
        pub use super::server_config::SSLConfig;
    }
}

pub mod webcore {
    pub use super::AutoFlusher;

    /// Opaque handle to `bun_runtime::webcore::Blob`. Signature-compatible
    /// with `bun_jsc::WebCore::Blob`; bodies stubbed until `bun_runtime` is a
    /// dependency again (see Cargo.toml b2-blocked note).
    #[repr(C)]
    pub struct Blob { _opaque: [u8; 0] }
    impl Blob {
        pub fn needs_to_read_file(&self) -> bool {
            unimplemented!("b2-blocked: bun_runtime::webcore::Blob::needs_to_read_file")
        }
        pub fn shared_view(&self) -> &[u8] {
            unimplemented!("b2-blocked: bun_runtime::webcore::Blob::shared_view")
        }
    }
    impl super::JsClass for Blob {
        fn from_js(_value: super::JSValue) -> Option<*mut Self> {
            unimplemented!("b2-blocked: bun_jsc::WebCore::Blob::from_js")
        }
    }
}

/// `bun_jsc::JsClass` — generic downcast trait backing `JSValue::as_<T>()`.
/// Mirrors src/jsc/lib.rs:2367.
pub trait JsClass {
    fn from_js(value: JSValue) -> Option<*mut Self>;
}

/// `bun_jsc::IntegerRange` (src/jsc/JSGlobalObject.rs:1463) — comptime-range
/// options for `validate_integer_range` / `validate_big_int_range`.
#[derive(Clone, Copy)]
pub struct IntegerRange {
    pub min: i128,
    pub max: i128,
    pub field_name: &'static [u8],
    pub always_allow_zero: bool,
}
impl Default for IntegerRange {
    fn default() -> Self {
        Self { min: i128::MIN, max: i128::MAX, field_name: b"", always_allow_zero: false }
    }
}

impl JSGlobalObject {
    // TODO(port): real bound is `T: bun_core::Integer` (see
    // src/jsc/JSGlobalObject.rs:1064); that trait isn't defined yet, so the
    // shim leaves `T` unbounded — bodies are stubbed regardless.
    pub fn validate_integer_range<T>(
        &self,
        _value: JSValue,
        _default: T,
        _range: IntegerRange,
    ) -> JsResult<T> {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::validate_integer_range")
    }
    pub fn validate_big_int_range<T>(
        &self,
        _value: JSValue,
        _default: T,
        _range: IntegerRange,
    ) -> JsResult<T> {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::validate_big_int_range")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// codegen::JS{Type} — per-JsClass cached-value getters/setters generated from
// `.classes.ts`. Stub modules so `js::queries_get_cached` etc. resolve; bodies
// unimplemented until the `.classes.ts` generator gains a `.rs` output mode.
// ──────────────────────────────────────────────────────────────────────────

pub mod codegen {
    use super::{JSGlobalObject, JSValue};

    macro_rules! cached_slot {
        ($get:ident, $set:ident) => {
            pub fn $get(_this_value: JSValue) -> Option<JSValue> {
                unimplemented!(concat!("b2-blocked: codegen::", stringify!($get)))
            }
            pub fn $set(_this_value: JSValue, _global: &JSGlobalObject, _value: JSValue) {
                unimplemented!(concat!("b2-blocked: codegen::", stringify!($set)))
            }
        };
    }

    /// `getConstructor` is a one-line wrapper over the codegen-emitted
    /// `extern fn {Type}__getConstructor(*JSGlobalObject) callconv(jsc.conv) JSValue`
    /// (see src/codegen/generate-classes.ts:2449-2539). The C++ side caches the
    /// constructor on the global; the wrapper just forwards.
    macro_rules! get_constructor {
        ($extern_name:ident) => {
            extern "C" {
                fn $extern_name(global: *mut JSGlobalObject) -> JSValue;
            }
            pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
                // SAFETY: `global` is a live JSGlobalObject; the codegen symbol
                // is emitted alongside the JS class wrapper and never null.
                // `as_mut_ptr` is sound via `UnsafeCell` (interior mutability).
                unsafe { $extern_name(global.as_mut_ptr()) }
            }
        };
    }

    #[allow(non_snake_case)]
    pub mod JSPostgresSQLConnection {
        use super::*;
        cached_slot!(queries_get_cached, queries_set_cached);
        cached_slot!(onconnect_get_cached, onconnect_set_cached);
        cached_slot!(onclose_get_cached, onclose_set_cached);
        get_constructor!(PostgresSQLConnection__getConstructor);
        pub fn to_js(_ptr: *mut crate::postgres::PostgresSQLConnection, _g: &JSGlobalObject) -> JSValue {
            unimplemented!("b2-blocked: codegen::JSPostgresSQLConnection::to_js")
        }
        pub fn from_js(_v: JSValue) -> Option<*mut crate::postgres::PostgresSQLConnection> {
            unimplemented!("b2-blocked: codegen::JSPostgresSQLConnection::from_js")
        }
        pub fn from_js_direct(_v: JSValue) -> Option<*mut crate::postgres::PostgresSQLConnection> {
            unimplemented!("b2-blocked: codegen::JSPostgresSQLConnection::from_js_direct")
        }
    }

    #[allow(non_snake_case)]
    pub mod JSPostgresSQLQuery {
        use super::*;
        cached_slot!(binding_get_cached, binding_set_cached);
        cached_slot!(columns_get_cached, columns_set_cached);
        cached_slot!(pending_value_get_cached, pending_value_set_cached);
        cached_slot!(target_get_cached, target_set_cached);
        get_constructor!(PostgresSQLQuery__getConstructor);
        pub fn to_js(_ptr: *mut crate::postgres::PostgresSQLQuery, _g: &JSGlobalObject) -> JSValue {
            unimplemented!("b2-blocked: codegen::JSPostgresSQLQuery::to_js")
        }
    }

    pub mod js_mysql_connection {
        use super::*;
        cached_slot!(queries_get_cached, queries_set_cached);
        cached_slot!(onconnect_get_cached, onconnect_set_cached);
        cached_slot!(onclose_get_cached, onclose_set_cached);
        get_constructor!(MySQLConnection__getConstructor);
    }
    #[allow(non_snake_case)]
    pub use js_mysql_connection as JSMySQLConnection;

    pub mod js_mysql_query {
        use super::*;
        cached_slot!(binding_get_cached, binding_set_cached);
        cached_slot!(columns_get_cached, columns_set_cached);
        cached_slot!(pending_value_get_cached, pending_value_set_cached);
        cached_slot!(target_get_cached, target_set_cached);
        get_constructor!(MySQLQuery__getConstructor);
    }
    #[allow(non_snake_case)]
    pub use js_mysql_query as JSMySQLQuery;
}

// ──────────────────────────────────────────────────────────────────────────
// JSFunction — host-function constructor (mirrors bun_jsc::JSFunction).
// `create` is generic over the host-fn pointer because callers pass both
// shim-typed (`&crate::jsc::JSGlobalObject`) and bun_jsc-typed signatures
// during the Phase-B transition; the real bun_jsc impl narrows this to
// `JSHostFn` once the shim is dropped.
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct JSFunction { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

/// `jsc.JSHostFn` — the C-ABI host-function pointer JSC dispatches to.
/// Zig: `fn(*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue`.
pub type JSHostFn = unsafe extern "C" fn(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue;

/// Zig: `JSFunction.ImplementationVisibility` (src/jsc/JSFunction.zig:2-6).
#[repr(u8)]
#[derive(Clone, Copy, Default)]
pub enum ImplementationVisibility {
    #[default]
    Public = 0,
    Private = 1,
    PrivateRecursive = 2,
}

/// Zig: `JSFunction.Intrinsic` (src/jsc/JSFunction.zig:9-12) — non-exhaustive
/// `enum(u8)`; only `.none` is named on the Zig side.
#[repr(u8)]
#[derive(Clone, Copy, Default)]
pub enum Intrinsic {
    #[default]
    None = 0,
}

/// Zig: `JSFunction.CreateJSFunctionOptions` (src/jsc/JSFunction.zig:14-18).
#[derive(Default)]
pub struct CreateJSFunctionOptions {
    pub implementation_visibility: ImplementationVisibility,
    pub intrinsic: Intrinsic,
    pub constructor: Option<JSHostFn>,
}

extern "C" {
    /// Zig: `extern fn JSFunction__createFromZig(global, fn_name, impl,
    /// arg_count, vis, intrinsic, constructor) JSValue` (JSFunction.zig:20-28).
    fn JSFunction__createFromZig(
        global: *mut JSGlobalObject,
        fn_name: bun_string::String,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;
}

impl JSFunction {
    /// Zig: `JSFunction.create` (src/jsc/JSFunction.zig:30-53) — thin wrapper
    /// over `JSFunction__createFromZig`. The Zig spec accepts either a
    /// `JSHostFnZig` (wrapped via `toJSHostFn`) or a raw `JSHostFn`; on the
    /// Rust side the `#[bun_jsc::host_fn]` proc-macro performs the wrapping at
    /// the def-site, so callers pass a `JSHostFn` directly.
    pub fn create(
        global: &JSGlobalObject,
        name: &str,
        implementation: JSHostFn,
        arg_count: u32,
        opts: CreateJSFunctionOptions,
    ) -> JSValue {
        let fn_name = bun_string::String::init(name);
        // SAFETY: `global` is live; `implementation` is a valid C-ABI fn
        // pointer; `fn_name` is moved by value (C++ side derefs on return).
        // `as_mut_ptr` is sound via `UnsafeCell` (interior mutability).
        unsafe {
            JSFunction__createFromZig(
                global.as_mut_ptr(),
                fn_name,
                implementation,
                arg_count,
                opts.implementation_visibility,
                opts.intrinsic,
                opts.constructor,
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSGlobalObject extended surface (microtask, throw helpers, exception take).
// ──────────────────────────────────────────────────────────────────────────

impl JSGlobalObject {
    pub fn queue_microtask(&self, _callback: JSValue, _args: &[JSValue]) {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::queue_microtask")
    }
    pub fn try_take_exception(&self) -> Option<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::try_take_exception")
    }
    pub fn report_active_exception_as_unhandled(&self, _e: JsError) {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::report_active_exception_as_unhandled")
    }
    pub fn throw_error<E: Into<bun_core::Error>>(&self, _err: E, _msg: &str) -> JsResult<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::JSGlobalObject::throw_error")
    }
    pub fn throw_invalid_arguments_fmt(&self, _args: core::fmt::Arguments<'_>) -> JsResult<JSValue> {
        Err(JsError::Thrown)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSValue extended surface (call, to_error, create_empty_array, coerce, etc.).
// ──────────────────────────────────────────────────────────────────────────

impl JSValue {
    pub fn call(self, _global: &JSGlobalObject, _this: JSValue, _args: &[JSValue]) -> JsResult<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::call")
    }
    pub fn to_error(self) -> Option<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::to_error")
    }
    pub fn create_empty_array(_global: &JSGlobalObject, _len: usize) -> JsResult<JSValue> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::create_empty_array")
    }
    pub fn coerce<T>(self, _global: &JSGlobalObject) -> JsResult<T> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::coerce")
    }
    pub fn json_stringify_fast(self, _global: &JSGlobalObject, _out: &mut bun_string::String) -> JsResult<()> {
        unimplemented!("b2-blocked: bun_jsc::JSValue::json_stringify_fast")
    }
    /// Generic downcast (`as(comptime T)` in Zig). Dispatches via [`JsClass::from_js`].
    #[inline]
    pub fn as_<T: JsClass>(self) -> Option<*mut T> {
        if !self.is_cell() { return None; }
        T::from_js(self)
    }
    pub fn to_int32(self) -> i32 {
        unimplemented!("b2-blocked: bun_jsc::JSValue::to_int32")
    }
    pub fn as_boolean(self) -> bool {
        unimplemented!("b2-blocked: bun_jsc::JSValue::as_boolean")
    }
    pub fn is_object(self) -> bool {
        self.is_cell() && self.js_type().is_object()
    }
}
impl From<bool> for JSValue {
    fn from(b: bool) -> Self { Self::js_boolean(b) }
}

// ──────────────────────────────────────────────────────────────────────────
// CallFrame extended surface.
// ──────────────────────────────────────────────────────────────────────────

impl CallFrame {
    pub fn arguments(&self) -> &[JSValue] {
        unimplemented!("b2-blocked: bun_jsc::CallFrame::arguments")
    }
    pub fn this(&self) -> JSValue {
        unimplemented!("b2-blocked: bun_jsc::CallFrame::this")
    }
}
pub mod call_frame {
    use super::*;
    pub struct ArgumentsSlice<'a> { _p: PhantomData<&'a ()> }
    impl<'a> ArgumentsSlice<'a> {
        pub fn init(_frame: &'a CallFrame, _: usize) -> Self {
            unimplemented!("b2-blocked: bun_jsc::call_frame::ArgumentsSlice::init")
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MarkedArgumentBuffer::run — C++-side trampoline (mirrors
// `JSC::MarkedArgumentBuffer` stack-scoped buffer pattern).
// ──────────────────────────────────────────────────────────────────────────

impl MarkedArgumentBuffer {
    pub fn run<Ctx>(_ctx: *mut core::ffi::c_void, _f: extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer)) {
        unimplemented!("b2-blocked: bun_jsc::MarkedArgumentBuffer::run")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RareData extended surface (SQL socket-group accessors).
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    pub fn postgres_group(&mut self, _vm: &VirtualMachine, _ssl: bool) -> *mut bun_uws::SocketGroup {
        unimplemented!("b2-blocked: bun_jsc::RareData::postgres_group")
    }
    pub fn mysql_group(&mut self, _vm: &VirtualMachine, _ssl: bool) -> *mut bun_uws::SocketGroup {
        unimplemented!("b2-blocked: bun_jsc::RareData::mysql_group")
    }
    pub fn ssl_ctx_cache(&mut self) -> &mut SslCtxCache {
        unimplemented!("b2-blocked: bun_jsc::RareData::ssl_ctx_cache")
    }
}
pub struct SslCtxCache { _opaque: [u8; 0] }
impl SslCtxCache {
    pub fn get_or_create_opts(
        &mut self,
        _opts: bun_uws::us_bun_socket_context_options_t,
        _err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<*mut bun_uws::SslCtx> {
        unimplemented!("b2-blocked: bun_jsc::SslCtxCache::get_or_create_opts")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// KeepAlive — local stub matching bun_aio::KeepAlive shape but accepting
// `&VirtualMachine` (the SQL callsites pass vm directly; bun_aio::KeepAlive
// wants an `EventLoopCtx` which `VirtualMachine` will impl once bun_jsc is
// green). TODO(b2-blocked): replace with `pub use bun_aio::KeepAlive` and
// add `impl Into<EventLoopCtx> for &VirtualMachine`.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct KeepAlive { _active: bool }
impl KeepAlive {
    pub fn r#ref(&mut self, _vm: &VirtualMachine) {
        unimplemented!("b2-blocked: bun_aio::KeepAlive::ref (needs EventLoopCtx)")
    }
    pub fn unref(&mut self, _vm: &VirtualMachine) {
        unimplemented!("b2-blocked: bun_aio::KeepAlive::unref (needs EventLoopCtx)")
    }
    pub fn disable(&mut self) {}
}
