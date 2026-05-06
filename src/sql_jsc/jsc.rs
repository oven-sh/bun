//! Local signature-compatible mirror of `bun_jsc` for the SQL bindings.
//!
//! Every type and method signature here mirrors the real `bun_jsc` surface
//! (verified against `src/jsc/*.rs`) so once `bun_jsc` is green this whole
//! file becomes `pub use bun_jsc::*;` with zero callsite churn.
//!
//! Bodies are real ports of the corresponding `.zig` spec — they call the
//! same `extern "C"` symbols the Zig side calls (linked from
//! `src/jsc/bindings/*.cpp` and the codegen). Where a body needs an accessor
//! that isn't yet exported as a C symbol, the symbol is declared here and the
//! Zig side is expected to `@export` it (see `// TODO(port): export from Zig`).

#![allow(unused_variables, non_snake_case, dead_code)]

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

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

/// Opaque `JSCell` handle (used by `create_structure`).
#[repr(C)]
pub struct JSCell { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

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
// JSCJSValue encoding constants (from JSCJSValue.h / FFI.zig).
// ──────────────────────────────────────────────────────────────────────────
const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
const NOT_CELL_MASK: usize = NUMBER_TAG | 0x2;
const DOUBLE_ENCODE_OFFSET: i64 = 1i64 << 49;

// ──────────────────────────────────────────────────────────────────────────
// host_fn helpers (mirrors src/jsc/lib.rs:419).
// ──────────────────────────────────────────────────────────────────────────
#[inline]
fn from_js_host_call(global: &JSGlobalObject, v: JSValue) -> JsResult<JSValue> {
    if global.has_exception() { return Err(JsError::Thrown); }
    debug_assert!(!v.is_empty(), "fromJSHostCall: empty JSValue with no pending exception");
    Ok(v)
}
#[inline]
fn from_js_host_call_generic<R>(global: &JSGlobalObject, r: R) -> JsResult<R> {
    if global.has_exception() { Err(JsError::Thrown) } else { Ok(r) }
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
        !self.is_empty() && (self.0 & NOT_CELL_MASK) == 0
    }
    #[inline] pub fn is_int32(self) -> bool {
        (self.0 & NUMBER_TAG) == NUMBER_TAG
    }
    #[inline] pub fn is_number(self) -> bool {
        (self.0 & NUMBER_TAG) != 0
    }
    #[inline] pub fn is_double(self) -> bool { self.is_number() && !self.is_int32() }
    #[inline] pub fn is_any_int(self) -> bool {
        // SAFETY: pure FFI predicate.
        unsafe { JSC__JSValue__isAnyInt(self) }
    }
    #[inline] pub fn is_any_error(self) -> bool {
        if !self.is_cell() { return false; }
        // SAFETY: `self` is a cell; FFI reads the cell type.
        unsafe { JSC__JSValue__isAnyError(self) }
    }
    #[inline] pub fn is_big_int(self) -> bool {
        // SAFETY: pure FFI predicate.
        unsafe { JSC__JSValue__isBigInt(self) }
    }
    pub fn is_string(self) -> bool { self.is_cell() && self.js_type().is_string_like() }
    pub fn is_date(self) -> bool { self.is_cell() && self.js_type() == JSType::JSDate }

    /// `jsType()` — only valid when `is_cell()`. Reads the JSCell type byte.
    #[inline] pub fn js_type(self) -> JSType {
        // SAFETY: caller ensures `is_cell()`; FFI reads `JSCell::m_type`.
        unsafe { JSC__JSValue__jsType(self) }
    }

    // ── constructors ─────────────────────────────────────────────────────
    #[inline] pub fn js_boolean(b: bool) -> JSValue { if b { Self::TRUE } else { Self::FALSE } }
    pub fn js_number(n: f64) -> JSValue {
        // SAFETY: pure FFI; encodes int32 fast path or double.
        unsafe { JSC__JSValue__jsNumberFromDouble(n) }
    }
    pub fn create_empty_object(global: &JSGlobalObject, len: usize) -> JSValue {
        // SAFETY: `global` is live for the duration of the call.
        unsafe { JSC__JSValue__createEmptyObject(global.as_mut_ptr(), len) }
    }
    pub fn create_empty_object_with_null_prototype(global: &JSGlobalObject) -> JSValue {
        // SAFETY: `global` is live for the duration of the call.
        unsafe { JSC__JSValue__createEmptyObjectWithNullPrototype(global.as_mut_ptr()) }
    }
    pub fn create_buffer(global: &JSGlobalObject, slice: &mut [u8]) -> JSValue {
        // JSValue.zig:createBuffer — wraps `JSBuffer__bufferFromPointerAndLengthAndDeinit`
        // with `MarkedArrayBuffer_deallocator` (or null for empty slices).
        // SAFETY: `global` is live; slice ptr/len describe a valid range whose
        // ownership is transferred to JSC (freed via the deallocator).
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global.as_mut_ptr(),
                slice.as_mut_ptr(),
                slice.len(),
                core::ptr::null_mut(),
                if slice.is_empty() { None } else { Some(MarkedArrayBuffer_deallocator) },
            )
        }
    }
    /// `JSValue.createBuffer(global, slice, null)` — Zig passes a `[]const u8`
    /// and `null` allocator, meaning JSC must not free the pointer. The SQL
    /// callsite (`bytea.zig`) passes a slice into a transient decode buffer, so
    /// the bytes are duplicated into a mimalloc allocation here and handed to
    /// JSC with the standard deallocator.
    pub fn create_buffer_copy(global: &JSGlobalObject, slice: &[u8]) -> JSValue {
        if slice.is_empty() {
            // SAFETY: `global` is live; null deallocator for empty.
            return unsafe {
                JSBuffer__bufferFromPointerAndLengthAndDeinit(
                    global.as_mut_ptr(),
                    core::ptr::NonNull::dangling().as_ptr(),
                    0,
                    core::ptr::null_mut(),
                    None,
                )
            };
        }
        // Dup into a mimalloc allocation so `MarkedArrayBuffer_deallocator`
        // (which calls `mi_free`) is the correct destructor.
        let mut owned: Vec<u8> = slice.to_vec();
        let ptr = owned.as_mut_ptr();
        let len = owned.len();
        core::mem::forget(owned);
        // SAFETY: `ptr[..len]` is a fresh mimalloc allocation; ownership
        // transfers to JSC (freed via `MarkedArrayBuffer_deallocator`).
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global.as_mut_ptr(),
                ptr,
                len,
                core::ptr::null_mut(),
                Some(MarkedArrayBuffer_deallocator),
            )
        }
    }
    /// `JSValue.parse(jsString, global)` — wraps `JSC__JSValue__parseJSON`.
    pub fn parse_json(string: JSValue, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `global` is live; `string` is a valid encoded JSValue.
        unsafe { JSC__JSValue__parseJSON(string, global.as_mut_ptr()) }
    }
    pub fn from_date_string(global: &JSGlobalObject, s: *const c_char) -> JSValue {
        // SAFETY: `global` is live; `s` is a valid NUL-terminated C string.
        unsafe { JSC__JSValue__dateInstanceFromNullTerminatedString(global.as_mut_ptr(), s) }
    }
    pub fn from_date_number(global: &JSGlobalObject, value: f64) -> JSValue {
        // SAFETY: `global` is live.
        unsafe { JSC__JSValue__dateInstanceFromNumber(global.as_mut_ptr(), value) }
    }
    pub fn from_int64_no_truncate(global: &JSGlobalObject, i: i64) -> JSValue {
        // SAFETY: `global` is live.
        unsafe { JSC__JSValue__fromInt64NoTruncate(global.as_mut_ptr(), i) }
    }

    // ── accessors / coercions ────────────────────────────────────────────
    #[inline] fn as_int32(self) -> i32 {
        debug_assert!(self.is_int32());
        (self.0 & 0xffff_ffff) as u32 as i32
    }
    #[inline] fn as_double(self) -> f64 {
        debug_assert!(self.is_double());
        // FFI.zig: JSVALUE_TO_DOUBLE — subtract DoubleEncodeOffset, bitcast.
        f64::from_bits((self.0 as i64).wrapping_sub(DOUBLE_ENCODE_OFFSET) as u64)
    }
    #[inline] fn get_number(self) -> Option<f64> {
        if self.is_number() { Some(self.as_number()) } else { None }
    }
    /// Asserts this is a number, undefined, null, or a boolean.
    pub fn as_number(self) -> f64 {
        if self.is_int32() {
            self.as_int32() as f64
        } else if self.is_number() {
            self.as_double()
        } else if self.is_undefined_or_null() {
            0.0
        } else if self.is_boolean() {
            if self.0 == Self::TRUE.0 { 1.0 } else { 0.0 }
        } else {
            f64::NAN
        }
    }
    pub fn to_int64(self) -> i64 {
        if self.is_int32() { return self.as_int32() as i64; }
        if let Some(num) = self.get_number() {
            // JSValue.zig:916 — coerceDoubleTruncatingIntoInt64.
            if num.is_nan() { return 0; }
            return num as i64; // Rust `as` saturates on overflow.
        }
        // SAFETY: pure FFI conversion (BigInt / cell fallback).
        unsafe { JSC__JSValue__toInt64(self) }
    }
    pub fn to_uint64_no_truncate(self) -> u64 {
        // SAFETY: pure FFI conversion.
        unsafe { JSC__JSValue__toUInt64NoTruncate(self) }
    }
    pub fn to_bun_string(self, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        bun_string_jsc::from_js(self, global)
    }
    pub fn get_unix_timestamp(self) -> f64 {
        // SAFETY: pure FFI; `self` must be a JSDate cell (caller-checked).
        unsafe { JSC__JSValue__getUnixTimestamp(self) }
    }
    pub fn get_own_by_value(self, global: &JSGlobalObject, property_value: JSValue) -> Option<JSValue> {
        // SAFETY: `global` is live; FFI returns ZERO for not-found.
        let v = unsafe { JSC__JSValue__getOwnByValue(self, global.as_mut_ptr(), property_value) };
        if v.is_empty() { None } else { Some(v) }
    }
    pub fn get_length(self, global: &JSGlobalObject) -> JsResult<u64> {
        // SAFETY: `global` is live; FFI may set an exception.
        let len = from_js_host_call_generic(global, unsafe {
            JSC__JSValue__getLengthIfPropertyExistsInternal(self, global.as_mut_ptr())
        })?;
        if len == f64::MAX { return Ok(0); }
        // JSValue.zig:2181 — clamps to `std.math.maxInt(i52)` (2^51 − 1).
        const I52_MAX: i64 = (1i64 << 51) - 1;
        Ok(len.clamp(0.0, I52_MAX as f64) as u64)
    }

    // ── object ops ───────────────────────────────────────────────────────
    pub fn put(self, global: &JSGlobalObject, key: &[u8], value: JSValue) {
        let zs = bun_string::ZigString::init(key);
        // SAFETY: `global` is live; `zs` borrowed for the call.
        unsafe { JSC__JSValue__put(self, global.as_mut_ptr(), &zs, value) }
    }
    pub fn is_big_int_in_int64_range(self, min: i64, max: i64) -> bool {
        // SAFETY: pure FFI predicate (JSValue.zig:40).
        unsafe { JSC__isBigIntInInt64Range(self, min, max) }
    }
    pub fn is_big_int_in_uint64_range(self, min: u64, max: u64) -> bool {
        // SAFETY: pure FFI predicate (JSValue.zig:36).
        unsafe { JSC__isBigIntInUInt64Range(self, min, max) }
    }
    pub fn to_boolean(self) -> bool {
        // JSValue.zig:2103 — `this != .zero and JSC__JSValue__toBoolean(this)`.
        // SAFETY: pure FFI predicate; the zero guard avoids passing empty.
        !self.is_empty() && unsafe { JSC__JSValue__toBoolean(self) }
    }
    /// `JSValue::jsDoubleNumber` — boxes an f64 (always double-encoded; no
    /// int32 fast path). FFI.zig: `DOUBLE_TO_JSVALUE`.
    pub fn js_double_number(n: f64) -> JSValue {
        // FFI.zig:DOUBLE_TO_JSVALUE — bitcast then add DoubleEncodeOffset.
        JSValue(
            (n.to_bits() as i64).wrapping_add(DOUBLE_ENCODE_OFFSET) as usize,
            PhantomData,
        )
    }
    pub fn ensure_still_alive(self) {
        if !self.is_cell() { return; }
        let _ = core::hint::black_box(self);
    }
    #[inline] pub fn is_termination_exception(self) -> bool {
        // SAFETY: pure FFI predicate.
        unsafe { JSC__JSValue__isTerminationException(self) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSGlobalObject surface
// ──────────────────────────────────────────────────────────────────────────

impl JSGlobalObject {
    pub fn has_exception(&self) -> bool {
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        unsafe { JSGlobalObject__hasException(self.as_mut_ptr()) }
    }
    pub fn throw(&self, args: core::fmt::Arguments<'_>) -> JsError {
        // JSGlobalObject.zig:throw → createErrorInstance(fmt, args) → throwValue.
        let mut buf: Vec<u8> = Vec::new();
        let _ = std::io::Write::write_fmt(&mut buf, args);
        let zs = bun_string::ZigString::init_utf8(&buf);
        // SAFETY: `zs` borrowed for the call; `self` is live.
        let err = unsafe { ZigString__toErrorInstance(&zs, self.as_mut_ptr()) };
        self.throw_value(err)
    }
    pub fn throw_value(&self, value: JSValue) -> JsError {
        // A termination exception (e.g. stack overflow) may already be
        // pending. Don't try to override it — that would hit
        // releaseAssertNoException in VM.throwError.
        if self.has_exception() {
            return JsError::Thrown;
        }
        // SAFETY: `self` is live; `value` is a valid encoded JSValue.
        unsafe { JSC__VM__throwError(JSC__JSGlobalObject__vm(self.as_mut_ptr()), self.as_mut_ptr(), value) };
        JsError::Thrown
    }
    pub fn take_exception(&self, proof: JsError) -> JSValue {
        match proof {
            JsError::Thrown | JsError::Terminated => {}
            JsError::OutOfMemory => { let _ = self.throw_out_of_memory(); }
        }
        self.try_take_exception().unwrap_or_else(|| {
            panic!("A JavaScript exception was thrown, but it was cleared before it could be read.")
        })
    }
    pub fn take_error(&self, proof: JsError) -> JSValue {
        match proof {
            JsError::Thrown | JsError::Terminated => {}
            JsError::OutOfMemory => { let _ = self.throw_out_of_memory(); }
        }
        self.try_take_exception()
            .unwrap_or_else(|| {
                panic!("A JavaScript exception was thrown, but it was cleared before it could be read.")
            })
            .to_error()
            .unwrap_or_else(|| {
                panic!("Couldn't convert a JavaScript exception to an Error instance.")
            })
    }
    pub fn create_out_of_memory_error(&self) -> JSValue {
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        unsafe { JSGlobalObject__createOutOfMemoryError(self.as_mut_ptr()) }
    }
    pub fn throw_out_of_memory(&self) -> JsError {
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        unsafe { JSGlobalObject__throwOutOfMemoryError(self.as_mut_ptr()) };
        JsError::Thrown
    }
    pub fn throw_invalid_arguments(&self, msg: &str) -> JsError {
        // JSGlobalObject.zig: throwInvalidArguments → toInvalidArguments → throwValue.
        let zs = bun_string::ZigString::init_utf8(msg.as_bytes());
        // SAFETY: `zs` borrowed for the call; `self` is live.
        let err = unsafe { ZigString__toErrorInstance(&zs, self.as_mut_ptr()) };
        self.throw_value(err)
    }
    /// `globalObject.ERR(.OUT_OF_RANGE, fmt, args)` — returns a builder so
    /// callsites can chain `.throw()`.
    pub fn err_out_of_range(&self, args: core::fmt::Arguments<'_>) -> ErrBuilder<'_> {
        ErrBuilder { _g: self, code: ErrorCode::OUT_OF_RANGE, message: bun_string::String::create_format(args) }
    }
    /// `globalObject.gregorianDateTimeToMS` — JSC date→ms helper.
    pub fn gregorian_date_time_to_ms(
        &self,
        year: u16, month: u8, day: u8, hour: u8, minute: u8, second: u8, ms: u32,
    ) -> JsResult<f64> {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; all args by value.
        // PORT NOTE: bun_jsc::JSGlobalObject::gregorian_date_time_to_ms takes
        // i32 args; the SQL callsites pass narrower unsigned types, widened here.
        Ok(unsafe {
            Bun__gregorianDateTimeToMS(
                self.as_mut_ptr(),
                year as i32, month as i32, day as i32,
                hour as i32, minute as i32, second as i32, ms as i32,
                true,
            )
        })
    }
    /// `globalObject.ERR(.INVALID_ARG_TYPE, fmt, args).toJS()` — used by
    /// `MySQLValue` for "expected X, got Y" diagnostics.
    pub fn ERR_INVALID_ARG_TYPE(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let mut message = bun_string::String::create_format(args);
        // SAFETY: `self` is live; `message` borrowed for the call.
        let v = unsafe { Bun__createErrorWithCode(self.as_mut_ptr(), ErrorCode::INVALID_ARG_TYPE, &mut message) };
        message.deref();
        v
    }
}

/// Minimal mirror of `bun_jsc::ErrorCode` (codegen `ErrorCode.zig`). Only the
/// codes the SQL bindings name are surfaced.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ErrorCode(pub u16);
impl ErrorCode {
    pub const INVALID_ARG_TYPE: ErrorCode = ErrorCode(119);
    pub const OUT_OF_RANGE: ErrorCode = ErrorCode(157);
}

/// Returned by `JSGlobalObject::err_*` so callsites can chain `.throw()`
/// (mirrors `bun_jsc::ErrorBuilder`).
pub struct ErrBuilder<'a> {
    _g: &'a JSGlobalObject,
    code: ErrorCode,
    message: bun_string::String,
}
impl<'a> ErrBuilder<'a> {
    pub fn throw(mut self) -> JsError {
        // SAFETY: `_g` is live; `message` borrowed for the call.
        let v = unsafe { Bun__createErrorWithCode(self._g.as_mut_ptr(), self.code, &mut self.message) };
        self.message.deref();
        self._g.throw_value(v)
    }
    pub fn to_js(mut self) -> JSValue {
        // SAFETY: `_g` is live; `message` borrowed for the call.
        let v = unsafe { Bun__createErrorWithCode(self._g.as_mut_ptr(), self.code, &mut self.message) };
        self.message.deref();
        v
    }
}

/// `JSC::MarkedArgumentBuffer` — GC-rooting append-only buffer. Opaque FFI
/// handle; only ever obtained via `MarkedArgumentBuffer::run`'s callback.
#[repr(C)]
pub struct MarkedArgumentBuffer {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
impl Default for MarkedArgumentBuffer {
    /// Only here to satisfy `#[derive(Default)]` on stack-embedded helpers;
    /// the actual buffer must come from `MarkedArgumentBuffer::run`.
    fn default() -> Self { Self { _p: [], _m: PhantomData } }
}
impl MarkedArgumentBuffer {
    pub fn append(&mut self, value: JSValue) {
        // SAFETY: `self` is a valid `*mut MarkedArgumentBuffer` by construction
        // (only ever obtained from C++ via `MarkedArgumentBuffer__run`).
        unsafe { MarkedArgumentBuffer__append(self, value) }
    }
}

impl JSGlobalObject {
    /// Shared accessor — mirrors `src/jsc/JSGlobalObject.rs:943`. Returning
    /// `&mut` here would let two calls alias the singleton VM (UB under Stacked
    /// Borrows); mutation goes through [`Self::bun_vm_ptr`] instead.
    pub fn bun_vm(&self) -> &VirtualMachine {
        // SAFETY: bunVM returns a valid *VirtualMachine for this global,
        // live for the VM lifetime.
        unsafe { &*(JSC__JSGlobalObject__bunVM(self.as_mut_ptr()) as *mut VirtualMachine) }
    }
    /// Raw-pointer variant of [`Self::bun_vm`] (mirrors
    /// `src/jsc/JSGlobalObject.rs:939`). Returns the FFI `*mut VirtualMachine`
    /// directly so callers that need to mutate VM fields don't launder
    /// provenance through `&VirtualMachine -> *mut` (UB to write through).
    /// Callers form a short-lived `&mut *p` at the use site.
    #[inline]
    pub fn bun_vm_ptr(&self) -> *mut VirtualMachine {
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        unsafe { JSC__JSGlobalObject__bunVM(self.as_mut_ptr()) as *mut VirtualMachine }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine / RareData (subset; mirrors src/jsc/VirtualMachine.rs +
// src/jsc/rare_data.rs). Only the SQL-touching surface is provided here.
//
// `VirtualMachine` is opaque on this side (it's a large Zig struct). All
// accesses go through extern "C" accessors; the Zig side `@export`s these as
// `Bun__VM__*` (see VirtualMachine.zig / virtual_machine_exports.rs).
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct VirtualMachine {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
impl VirtualMachine {
    #[inline] fn as_mut_ptr(&self) -> *mut VirtualMachine { self._opaque.get() as *mut VirtualMachine }

    pub fn rare_data(&mut self) -> &mut RareData {
        // SAFETY: `Bun__VM__rareData` lazily allocates; never returns null.
        // TODO(port): export from Zig — `Bun__VM__rareData`.
        unsafe { &mut *Bun__VM__rareData(self.as_mut_ptr()) }
    }
    pub fn global(&self) -> &JSGlobalObject {
        // SAFETY: `global` is set during init and live for the VM lifetime.
        unsafe { &*Bun__VM__global(self.as_mut_ptr()) }
    }
}

/// Mirrors `bun_jsc::rare_data::RareData` — only SQL fields surfaced.
pub struct RareData {
    pub mysql_context: crate::mysql::MySQLContext,
    pub postgresql_context: crate::postgres::PostgresSQLContext,
}

// ──────────────────────────────────────────────────────────────────────────
// CallFrame surface (mirrors src/jsc/CallFrame.rs).
// ──────────────────────────────────────────────────────────────────────────

// JSC::CallFrameSlot constants (CallFrame.h).
const OFFSET_CODE_BLOCK: usize = 2;
const OFFSET_CALLEE: usize = OFFSET_CODE_BLOCK + 1;
const OFFSET_ARGUMENT_COUNT_INCLUDING_THIS: usize = OFFSET_CALLEE + 1;
const OFFSET_THIS_ARGUMENT: usize = OFFSET_ARGUMENT_COUNT_INCLUDING_THIS + 1;
const OFFSET_FIRST_ARGUMENT: usize = OFFSET_THIS_ARGUMENT + 1;

impl CallFrame {
    #[inline]
    fn as_unsafe_js_value_array(&self) -> *const JSValue {
        // SAFETY: CallFrame's address IS the base of the JSC register array;
        // mirrors Zig `@ptrCast(@alignCast(self))`.
        (self as *const CallFrame).cast::<JSValue>()
    }
    fn argument_count_including_this(&self) -> u32 {
        // SAFETY: register at OFFSET_ARGUMENT_COUNT_INCLUDING_THIS holds the
        // count in its low 32 bits (`EncodedValueDescriptor.asBits.payload`).
        unsafe {
            (*(self as *const CallFrame as *const i64)
                .add(OFFSET_ARGUMENT_COUNT_INCLUDING_THIS)) as u32
        }
    }
    pub fn arguments_count(&self) -> u32 { self.argument_count_including_this() - 1 }

    /// Out-of-bounds access returns `undefined` (mirrors CallFrame.zig).
    pub fn argument(&self, i: usize) -> JSValue {
        if (self.arguments_count() as usize) > i {
            self.arguments()[i]
        } else {
            JSValue::UNDEFINED
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSObject surface
// ──────────────────────────────────────────────────────────────────────────

impl JSObject {
    pub fn get_index(this: JSValue, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        // SAFETY: thin FFI shim; C++ may set a pending exception.
        let value = unsafe { JSC__JSObject__getIndex(this, global.as_mut_ptr(), i) };
        if global.has_exception() { return Err(JsError::Thrown); }
        debug_assert!(!value.is_empty());
        Ok(value)
    }
    pub fn max_inline_capacity() -> c_uint {
        // SAFETY: const exported by C++; read-only.
        unsafe { JSC__JSObject__maxInlineCapacity }
    }
    /// `JSC.JSObject.createStructure` — wraps `JSC__createStructure`.
    pub fn create_structure(
        global: &JSGlobalObject,
        owner: JSValue,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue {
        debug_assert!(owner.is_cell());
        // A cell-tagged JSValue's payload IS the JSCell* (NotCellMask bits zero).
        let owner_cell = owner.0 as *mut JSCell;
        // SAFETY: `global` is live; `owner_cell` is non-null per debug_assert.
        unsafe { JSC__createStructure(global.as_mut_ptr(), owner_cell, length, names) }
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
#[allow(non_upper_case_globals)]
impl JSType {
    pub const String: JSType = JSType(2);
    pub const HeapBigInt: JSType = JSType(3);
    pub const Object: JSType = JSType(25);
    pub const FinalObject: JSType = JSType(26);
    pub const ErrorInstance: JSType = JSType(29);
    pub const InternalFunction: JSType = JSType(37);
    pub const JSFunction: JSType = JSType(38);
    pub const BooleanObject: JSType = JSType(39);
    pub const NumberObject: JSType = JSType(40);
    pub const ArrayBuffer: JSType = JSType(48);
    pub const Int8Array: JSType = JSType(49);
    pub const Uint8Array: JSType = JSType(50);
    pub const Uint8ClampedArray: JSType = JSType(51);
    pub const Int16Array: JSType = JSType(52);
    pub const Uint16Array: JSType = JSType(53);
    pub const Int32Array: JSType = JSType(54);
    pub const Uint32Array: JSType = JSType(55);
    pub const Float16Array: JSType = JSType(56);
    pub const Float32Array: JSType = JSType(57);
    pub const Float64Array: JSType = JSType(58);
    pub const BigInt64Array: JSType = JSType(59);
    pub const BigUint64Array: JSType = JSType(60);
    pub const DataView: JSType = JSType(61);
    pub const Array: JSType = JSType(76);
    pub const DerivedArray: JSType = JSType(77);
    pub const JSDate: JSType = JSType(73);
    pub const StringObject: JSType = JSType(94);
    pub const DerivedStringObject: JSType = JSType(95);

    #[inline] pub fn is_string_like(self) -> bool {
        matches!(self, JSType::String | JSType::StringObject | JSType::DerivedStringObject)
    }
    #[inline] pub fn is_object(self) -> bool {
        // inline constexpr bool isObjectType(JSType type) { return type >= ObjectType; }
        self.0 >= JSType::Object.0
    }
    #[inline] pub fn is_typed_array_or_array_buffer(self) -> bool {
        matches!(
            self,
            JSType::ArrayBuffer | JSType::BigInt64Array | JSType::BigUint64Array
                | JSType::Float32Array | JSType::Float16Array | JSType::Float64Array
                | JSType::Int16Array | JSType::Int32Array | JSType::Int8Array
                | JSType::Uint16Array | JSType::Uint32Array | JSType::Uint8Array
                | JSType::Uint8ClampedArray
        )
    }
    #[inline] pub fn is_array_buffer_like(self) -> bool {
        matches!(
            self,
            JSType::DataView | JSType::ArrayBuffer | JSType::BigInt64Array
                | JSType::BigUint64Array | JSType::Float32Array | JSType::Float16Array
                | JSType::Float64Array | JSType::Int16Array | JSType::Int32Array
                | JSType::Int8Array | JSType::Uint16Array | JSType::Uint32Array
                | JSType::Uint8Array | JSType::Uint8ClampedArray
        )
    }
    #[inline] pub fn is_array_like(self) -> bool {
        matches!(
            self,
            JSType::Array | JSType::DerivedArray | JSType::ArrayBuffer
                | JSType::BigInt64Array | JSType::BigUint64Array | JSType::Float32Array
                | JSType::Float16Array | JSType::Float64Array | JSType::Int16Array
                | JSType::Int32Array | JSType::Int8Array | JSType::Uint16Array
                | JSType::Uint32Array | JSType::Uint8Array | JSType::Uint8ClampedArray
        )
    }
    #[inline] pub fn is_indexable(self) -> bool {
        matches!(
            self,
            JSType::Object | JSType::FinalObject | JSType::Array | JSType::DerivedArray
                | JSType::ErrorInstance | JSType::JSFunction | JSType::InternalFunction
                | JSType::ArrayBuffer | JSType::BigInt64Array | JSType::BigUint64Array
                | JSType::Float32Array | JSType::Float16Array | JSType::Float64Array
                | JSType::Int16Array | JSType::Int32Array | JSType::Int8Array
                | JSType::Uint16Array | JSType::Uint32Array | JSType::Uint8Array
                | JSType::Uint8ClampedArray
        )
    }
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

/// Opaque FFI handle — backed by a `JSC::JSValue`-sized HandleSlot (Strong.cpp).
#[repr(C)]
struct StrongImpl { _p: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

#[derive(Default)]
pub struct StrongOptional {
    handle: Option<NonNull<StrongImpl>>,
}
impl StrongOptional {
    pub const fn empty() -> Self { Self { handle: None } }
    pub fn has(&self) -> bool {
        let Some(r) = self.handle else { return false };
        // SAFETY: HandleSlot storage is a live aligned encoded JSValue.
        !unsafe { *r.as_ptr().cast::<JSValue>() }.is_empty()
    }
    pub fn get(&self) -> Option<JSValue> {
        let imp = self.handle?;
        // SAFETY: HandleSlot storage is a live aligned encoded JSValue.
        let result = unsafe { *imp.as_ptr().cast::<JSValue>() };
        if result.is_empty() { None } else { Some(result) }
    }
    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        let Some(r) = self.handle else {
            if value.is_empty() { return; }
            // SAFETY: Bun__StrongRef__new never returns null (HandleSet alloc).
            self.handle = Some(unsafe {
                NonNull::new_unchecked(Bun__StrongRef__new(global.as_mut_ptr(), value))
            });
            return;
        };
        // SAFETY: `r` is a valid handle from `Bun__StrongRef__new`.
        unsafe { Bun__StrongRef__set(r.as_ptr(), global.as_mut_ptr(), value) };
    }
    pub fn deinit(&mut self) {
        let Some(r) = self.handle.take() else { return };
        // SAFETY: `r` came from `Bun__StrongRef__new`; consumed exactly once.
        unsafe { Bun__StrongRef__delete(r.as_ptr()) };
    }
}
impl Drop for StrongOptional {
    fn drop(&mut self) { self.deinit(); }
}

// ──────────────────────────────────────────────────────────────────────────
// bun.String JSC bridges (matches src/jsc/lib.rs `mod bun_string_jsc`)
// ──────────────────────────────────────────────────────────────────────────

pub mod bun_string_jsc {
    use super::{from_js_host_call, from_js_host_call_generic, JSGlobalObject, JSValue, JsError, JsResult};
    use bun_string::String;

    // TODO(port): move to jsc_sys
    unsafe extern "C" {
        fn BunString__fromJS(global: *mut JSGlobalObject, value: JSValue, out: *mut String) -> bool;
        fn BunString__toJS(global: *mut JSGlobalObject, in_: *const String) -> JSValue;
        fn BunString__createUTF8ForJS(global: *mut JSGlobalObject, ptr: *const u8, len: usize) -> JSValue;
        fn Bun__parseDate(global: *mut JSGlobalObject, this: *mut String) -> f64;
    }

    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        let mut out: String = String::DEAD;
        // SAFETY: `out` is a valid out-param; `global` borrowed for the call.
        let ok = unsafe { BunString__fromJS(global.as_mut_ptr(), value, &mut out) };
        if ok { Ok(out) } else { Err(JsError::Thrown) }
    }
    pub fn create_utf8_for_js(global: &JSGlobalObject, utf8: &[u8]) -> JsResult<JSValue> {
        // SAFETY: ptr/len from a live &[u8]; `global` borrowed for the call.
        from_js_host_call(global, unsafe {
            BunString__createUTF8ForJS(global.as_mut_ptr(), utf8.as_ptr(), utf8.len())
        })
    }
    pub fn to_js(this: &String, global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `this` is a live &String; `global` borrowed for the call.
        from_js_host_call(global, unsafe { BunString__toJS(global.as_mut_ptr(), this) })
    }
    /// `bun.String.parseDate` — parse a date string via JSC, returning the
    /// Unix-epoch ms as f64 (mirrors src/jsc/bun_string_jsc.rs:149).
    pub fn parse_date(this: &mut String, global: &JSGlobalObject) -> JsResult<f64> {
        // SAFETY: `this` is a live &mut String; `global` borrowed for the call.
        from_js_host_call_generic(global, unsafe { Bun__parseDate(global.as_mut_ptr(), this) })
    }
    /// `ZigString.toJS` — wraps `Zig::toJSStringValue`.
    pub fn zig_string_to_js(this: bun_string::ZigString, global: &JSGlobalObject) -> JSValue {
        // ZigString.zig:toJS — globally-allocated → external value, else clone.
        // SAFETY: `this` is a valid ZigString; `global` borrowed for the call.
        unsafe { super::ZigString__toValueGC(&this, global.as_mut_ptr()) }
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
    strong: StrongOptional,
}
impl JsRef {
    pub fn weak(value: JSValue) -> Self { Self { value, strong: StrongOptional::empty() } }
    pub fn get(&self) -> JSValue { self.value }
    pub fn try_get(&self) -> Option<JSValue> {
        if self.value.is_empty_or_undefined_or_null() { None } else { Some(self.value) }
    }
    pub fn set_weak(&mut self, value: JSValue) { self.value = value; }
    pub fn set_strong(&mut self, global: &JSGlobalObject, value: JSValue) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        self.value = value;
        self.strong.set(global, value);
    }
    pub fn finalize(&mut self) {
        self.value = JSValue::ZERO;
        self.strong.deinit();
    }
    pub fn deinit(&mut self) {
        self.value = JSValue::ZERO;
        self.strong.deinit();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine extended surface (event_loop, timer, is_shutting_down, get).
// ──────────────────────────────────────────────────────────────────────────

impl VirtualMachine {
    /// `bun_jsc::VirtualMachine::get()` — TLS-backed singleton accessor.
    ///
    /// Spec `VirtualMachine.zig:357-366` returns a raw `*VirtualMachine`.
    /// Callers form a short-lived `&mut *p` at the use site. Mirrors
    /// `src/jsc/VirtualMachine.rs:451`.
    pub fn get() -> *mut VirtualMachine {
        // SAFETY: `Bun__getVM` reads the thread-local; non-null on the JS thread.
        unsafe { Bun__getVM() as *mut VirtualMachine }
    }
    pub fn event_loop(&self) -> &EventLoop {
        // SAFETY: returns a non-null `*EventLoop` (self-ptr into the VM).
        // TODO(port): export from Zig — `Bun__VM__eventLoop`.
        unsafe { &*Bun__VM__eventLoop(self.as_mut_ptr()) }
    }
    pub fn is_shutting_down(&self) -> bool {
        // SAFETY: pure FFI accessor (already exported for ZigGlobalObject.h).
        unsafe { Bun__VirtualMachine__isShuttingDown(self.as_mut_ptr() as *mut c_void) }
    }
    /// `vm.timer` — exposed as a method returning `&mut TimerHeap` so callers
    /// can write `self.vm().timer().remove(..)`. The Zig field access
    /// (`vm.timer.remove`) maps to this.
    pub fn timer(&mut self) -> &mut TimerHeap {
        // SAFETY: `&vm.timer` — non-null while the VM is live.
        // TODO(port): export from Zig — `Bun__VM__timer`.
        unsafe { &mut *Bun__VM__timer(self.as_mut_ptr()) }
    }
}

/// `bun_jsc::EventLoop` — opaque, always borrowed.
#[repr(C)]
pub struct EventLoop {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
impl EventLoop {
    /// event_loop.zig:70 — counted enter; on the matching `exit` at depth 1
    /// microtasks are drained. The body is non-trivially Zig-state-machine
    /// dependent, so it's exposed via the existing `Bun__EventLoop__enter`
    /// export (which takes a `*JSGlobalObject` and reaches the loop via it).
    pub fn enter(&self) {
        // SAFETY: `self` is a live `*EventLoop`.
        // TODO(port): export from Zig — `Bun__EventLoop__enterLoop(*EventLoop)`.
        unsafe { Bun__EventLoop__enterLoop(self._opaque.get() as *mut EventLoop) }
    }
    pub fn exit(&self) {
        // SAFETY: `self` is a live `*EventLoop`.
        // TODO(port): export from Zig — `Bun__EventLoop__exitLoop(*EventLoop)`.
        unsafe { Bun__EventLoop__exitLoop(self._opaque.get() as *mut EventLoop) }
    }
}

/// `bun_jsc::api::Timer::All` — heap of `EventLoopTimer`. Opaque on this side;
/// `insert`/`remove` forward to the Zig impl (Timer.zig:63/86).
#[repr(C)]
pub struct TimerHeap {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
impl TimerHeap {
    pub fn insert(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&vm.timer`; `t` is a live intrusive heap node.
        // TODO(port): export from Zig — `Bun__Timer__All__insert`.
        unsafe { Bun__Timer__All__insert(self._opaque.get() as *mut TimerHeap, t) }
    }
    pub fn remove(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&vm.timer`; `t` is a live intrusive heap node.
        // TODO(port): export from Zig — `Bun__Timer__All__remove`.
        unsafe { Bun__Timer__All__remove(self._opaque.get() as *mut TimerHeap, t) }
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
// AutoFlusher (mirrors bun_event_loop::AutoFlusher; Zig
// `src/event_loop/AutoFlusher.zig`). Registers a deferred microtask that
// calls `T::on_auto_flush(&mut T) -> bool` until it returns false.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AutoFlusher {
    pub registered: bool,
}
impl AutoFlusher {
    /// AutoFlusher.zig: `registerDeferredMicrotaskWithTypeUnchecked` — posts
    /// `(this, Type.onAutoFlush)` into `vm.eventLoop().deferred_tasks`.
    pub fn register_deferred_microtask_with_type_unchecked<T>(this: *mut T, vm: &mut VirtualMachine) {
        // SAFETY: `vm` is live; `this` is a live `*mut T` whose `auto_flusher`
        // field has `registered == false` (caller-checked). The fn ptr ABI is
        // `fn(*mut c_void) -> bool` — identical to `fn(*mut T) -> bool` for a
        // single thin-pointer arg. The Zig side keys the deferred-task map on
        // the opaque `*anyopaque`.
        // TODO(port): export from Zig — `Bun__VM__postDeferredTask`.
        unsafe {
            Bun__VM__postDeferredTask(
                vm.as_mut_ptr(),
                this as *mut c_void,
                // PORT NOTE: callers provide `T::on_auto_flush` via the
                // `HasAutoFlusher` trait in the bun_event_loop crate; here we
                // can't name `T::on_auto_flush` without a trait bound, so this
                // half of the contract is satisfied by the caller setting
                // `auto_flusher.registered = true` and the Zig side dispatching
                // by tag. The fn pointer is forwarded as null and the Zig
                // exporter resolves it from the registered DeferredTaskQueue
                // entry's tag (matches AutoFlusher.zig comptime dispatch).
                None,
            );
        }
    }
    /// AutoFlusher.zig: `unregisterDeferredMicrotaskWithType`.
    pub fn unregister_deferred_microtask_with_type<T>(this: *mut T, vm: &mut VirtualMachine) {
        // SAFETY: `vm` is live; `this` was previously registered.
        // TODO(port): export from Zig — `Bun__VM__unregisterDeferredTask`.
        unsafe { Bun__VM__unregisterDeferredTask(vm.as_mut_ptr(), this as *mut c_void) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// api::ServerConfig::SSLConfig — TLS option bag (mirrors
// `src/runtime/socket/SSLConfig.rs`). Only the fields the SQL connection
// state machines name are surfaced.
// ──────────────────────────────────────────────────────────────────────────

pub mod api {
    use super::*;
    pub mod server_config {
        use super::*;
        #[derive(Default)]
        pub struct SSLConfig {
            pub server_name: *const c_char,
            pub reject_unauthorized: c_int,
            pub request_cert: c_int,
        }
        impl SSLConfig {
            pub fn server_name(&self) -> *const c_char { self.server_name }
            /// SSLConfig.zig:366 — `try jsc.generated.SSLConfig.fromJS(global, value)`
            /// then `.intoConfig()`. The full converter lives in `bun_runtime`;
            /// to avoid the dep cycle the body forwards through an exported C
            /// shim that wraps the Zig `SSLConfig.fromJS`.
            pub fn from_js(
                _vm: &mut VirtualMachine,
                global: &JSGlobalObject,
                value: JSValue,
            ) -> JsResult<Option<Self>> {
                let mut out = Self::default();
                // SAFETY: `out` is a valid out-param; `global` borrowed for call.
                // TODO(port): export from Zig — `Bun__SSLConfig__fromJS`.
                let rc = unsafe {
                    Bun__SSLConfig__fromJS(global.as_mut_ptr(), value, &mut out as *mut SSLConfig as *mut c_void)
                };
                if global.has_exception() { return Err(JsError::Thrown); }
                Ok(if rc { Some(out) } else { None })
            }
            /// SSLConfig.zig:117 — `asUSockets()` then flip
            /// `request_cert`/`reject_unauthorized` for client mode.
            pub fn as_usockets_for_client_verification(&self) -> bun_uws::us_bun_socket_context_options_t {
                let mut opts = bun_uws::us_bun_socket_context_options_t::default();
                // SAFETY: `self` is the lite mirror; the Zig side fills the
                // full uSockets options struct from its own `SSLConfig` state.
                // TODO(port): export from Zig — `Bun__SSLConfig__asUSocketsClient`.
                unsafe {
                    Bun__SSLConfig__asUSocketsClient(
                        self as *const SSLConfig as *const c_void,
                        &mut opts as *mut _,
                    );
                }
                opts
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
    use super::*;

    /// Opaque handle to `bun_runtime::webcore::Blob`.
    #[repr(C)]
    pub struct Blob { _opaque: core::cell::UnsafeCell<[u8; 0]> }
    impl Blob {
        pub fn needs_to_read_file(&self) -> bool {
            // SAFETY: `self` is a live `*const Blob` (codegen m_ctx payload).
            // TODO(port): export from Zig — `Bun__Blob__needsToReadFile`.
            unsafe { Bun__Blob__needsToReadFile(self._opaque.get() as *const c_void) }
        }
        pub fn shared_view(&self) -> &[u8] {
            let mut len: usize = 0;
            // SAFETY: `self` is a live `*const Blob`; the returned ptr/len
            // borrow the Blob's store, which is immutable for its lifetime.
            // TODO(port): export from Zig — `Bun__Blob__sharedView`.
            let ptr = unsafe { Bun__Blob__sharedView(self._opaque.get() as *const c_void, &mut len) };
            if ptr.is_null() || len == 0 { return &[]; }
            // SAFETY: Zig guarantees `ptr[..len]` valid while the Blob lives;
            // returned borrow tied to `&self`.
            unsafe { core::slice::from_raw_parts(ptr, len) }
        }
    }
    impl super::JsClass for Blob {
        fn from_js(value: JSValue) -> Option<*mut Self> {
            // SAFETY: codegen-emitted `Blob__fromJS` returns null when `value`
            // is not a Blob wrapper.
            let p = unsafe { Blob__fromJS(value) };
            if p.is_null() { None } else { Some(p as *mut Self) }
        }
    }

    unsafe extern "C" {
        // Codegen-emitted (ZigGeneratedClasses).
        fn Blob__fromJS(value: JSValue) -> *mut c_void;
        // TODO(port): export from Zig.
        fn Bun__Blob__needsToReadFile(this: *const c_void) -> bool;
        fn Bun__Blob__sharedView(this: *const c_void, out_len: *mut usize) -> *const u8;
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

const MIN_SAFE_INTEGER: i64 = -9007199254740991;
const MAX_SAFE_INTEGER: i64 = 9007199254740991;

impl JSGlobalObject {
    /// JSGlobalObject.zig:validateIntegerRange — generic over integer `T`.
    /// PORT NOTE: bound is `bun_core::Integer` (see src/jsc/JSGlobalObject.rs).
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
        debug_assert!(min_t <= max_t, "max must be less than min");
        debug_assert!(!range.field_name.is_empty(), "field_name must not be empty");

        if value.is_int32() {
            let int = value.to_int32();
            if range.always_allow_zero && int == 0 { return Ok(T::ZERO); }
            if i128::from(int) < min_t || i128::from(int) > max_t {
                return Err(self
                    .err_out_of_range(format_args!(
                        "The value of \"{}\" is out of range. It must be >= {} and <= {}. Received {}",
                        bstr::BStr::new(range.field_name), range.min, range.max, int
                    ))
                    .throw());
            }
            return Ok(T::from_i32(int));
        }
        if !value.is_number() {
            return Err(self.throw_value(self.ERR_INVALID_ARG_TYPE(format_args!(
                "The \"{}\" property must be of type number.",
                bstr::BStr::new(range.field_name)
            ))));
        }
        let f64_val = value.as_number();
        if range.always_allow_zero && f64_val == 0.0 { return Ok(T::ZERO); }
        if f64_val.is_nan() { return Ok(default); }
        if f64_val.floor() != f64_val {
            return Err(self.throw_value(self.ERR_INVALID_ARG_TYPE(format_args!(
                "The \"{}\" property must be an integer.",
                bstr::BStr::new(range.field_name)
            ))));
        }
        if f64_val < (min_t as f64) || f64_val > (max_t as f64) {
            return Err(self
                .err_out_of_range(format_args!(
                    "The value of \"{}\" is out of range. It must be >= {} and <= {}. Received {}",
                    bstr::BStr::new(range.field_name), range.min, range.max, f64_val
                ))
                .throw());
        }
        Ok(T::from_f64(f64_val))
    }

    pub fn validate_big_int_range<T: bun_core::Integer>(
        &self,
        value: JSValue,
        default: T,
        range: IntegerRange,
    ) -> JsResult<T> {
        if value.is_undefined() || value.is_empty() { return Ok(T::ZERO); }
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
            } else if value.is_big_int_in_uint64_range(
                u64::try_from(min_t).unwrap(),
                u64::try_from(max_t).unwrap(),
            ) {
                return Ok(T::from_u64(value.to_uint64_no_truncate()));
            }
            return Err(self
                .err_out_of_range(format_args!(
                    "The value is out of range. It must be >= {} and <= {}.",
                    min_t, max_t
                ))
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
}

// ──────────────────────────────────────────────────────────────────────────
// codegen::JS{Type} — per-JsClass cached-value getters/setters generated from
// `.classes.ts`. Bodies wrap the codegen-emitted `extern "C"` symbols (see
// build/debug/codegen/ZigGeneratedClasses.zig + generate-classes.ts:2124).
// ──────────────────────────────────────────────────────────────────────────

pub mod codegen {
    use super::{JSGlobalObject, JSValue};
    use core::ffi::c_void;

    /// Expand a cached-slot `(get, set)` pair into thin wrappers over the
    /// codegen-emitted `{Type}Prototype__{name}{Get,Set}CachedValue` externs.
    macro_rules! cached_slot {
        ($get:ident, $set:ident, $get_ext:ident, $set_ext:ident) => {
            unsafe extern "C" {
                fn $get_ext(this_value: JSValue) -> JSValue;
                fn $set_ext(this_value: JSValue, global: *mut JSGlobalObject, value: JSValue);
            }
            pub fn $get(this_value: JSValue) -> Option<JSValue> {
                // SAFETY: codegen guarantees the symbol; returns ZERO when unset.
                let result = unsafe { $get_ext(this_value) };
                if result.is_empty() { None } else { Some(result) }
            }
            pub fn $set(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
                // SAFETY: codegen guarantees the symbol.
                unsafe { $set_ext(this_value, global.as_mut_ptr(), value) }
            }
        };
    }

    /// `getConstructor` is a one-line wrapper over the codegen-emitted
    /// `extern fn {Type}__getConstructor(*JSGlobalObject) callconv(jsc.conv) JSValue`
    /// (see src/codegen/generate-classes.ts:2449-2539). The C++ side caches the
    /// constructor on the global; the wrapper just forwards.
    macro_rules! get_constructor {
        ($extern_name:ident) => {
            unsafe extern "C" {
                fn $extern_name(global: *mut JSGlobalObject) -> JSValue;
            }
            pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
                // SAFETY: `global` is a live JSGlobalObject; the codegen symbol
                // is emitted alongside the JS class wrapper and never null.
                unsafe { $extern_name(global.as_mut_ptr()) }
            }
        };
    }

    /// `to_js` / `from_js` / `from_js_direct` over the codegen-emitted
    /// `{Type}__create` / `{Type}__fromJS` / `{Type}__fromJSDirect`.
    macro_rules! js_class_fns {
        ($payload:ty, $create:ident, $from_js:ident, $from_js_direct:ident) => {
            unsafe extern "C" {
                fn $create(global: *mut JSGlobalObject, ptr: *mut c_void) -> JSValue;
                fn $from_js(value: JSValue) -> *mut c_void;
                fn $from_js_direct(value: JSValue) -> *mut c_void;
            }
            pub fn to_js(ptr: *mut $payload, g: &JSGlobalObject) -> JSValue {
                // SAFETY: `ptr` is a live m_ctx payload allocated via `Box::into_raw`;
                // ownership transfers to the JS wrapper.
                unsafe { $create(g.as_mut_ptr(), ptr as *mut c_void) }
            }
            pub fn from_js(v: JSValue) -> Option<*mut $payload> {
                // SAFETY: codegen returns null when `v` is not the wrapper type.
                let p = unsafe { $from_js(v) };
                if p.is_null() { None } else { Some(p as *mut $payload) }
            }
            pub fn from_js_direct(v: JSValue) -> Option<*mut $payload> {
                // SAFETY: codegen returns null when `v` is not the wrapper type.
                let p = unsafe { $from_js_direct(v) };
                if p.is_null() { None } else { Some(p as *mut $payload) }
            }
        };
    }

    #[allow(non_snake_case)]
    pub mod JSPostgresSQLConnection {
        use super::*;
        cached_slot!(queries_get_cached, queries_set_cached,
            PostgresSQLConnectionPrototype__queriesGetCachedValue,
            PostgresSQLConnectionPrototype__queriesSetCachedValue);
        cached_slot!(onconnect_get_cached, onconnect_set_cached,
            PostgresSQLConnectionPrototype__onconnectGetCachedValue,
            PostgresSQLConnectionPrototype__onconnectSetCachedValue);
        cached_slot!(onclose_get_cached, onclose_set_cached,
            PostgresSQLConnectionPrototype__oncloseGetCachedValue,
            PostgresSQLConnectionPrototype__oncloseSetCachedValue);
        get_constructor!(PostgresSQLConnection__getConstructor);
        js_class_fns!(crate::postgres::PostgresSQLConnection,
            PostgresSQLConnection__create,
            PostgresSQLConnection__fromJS,
            PostgresSQLConnection__fromJSDirect);
    }

    #[allow(non_snake_case)]
    pub mod JSPostgresSQLQuery {
        use super::*;
        cached_slot!(binding_get_cached, binding_set_cached,
            PostgresSQLQueryPrototype__bindingGetCachedValue,
            PostgresSQLQueryPrototype__bindingSetCachedValue);
        cached_slot!(columns_get_cached, columns_set_cached,
            PostgresSQLQueryPrototype__columnsGetCachedValue,
            PostgresSQLQueryPrototype__columnsSetCachedValue);
        cached_slot!(pending_value_get_cached, pending_value_set_cached,
            PostgresSQLQueryPrototype__pendingValueGetCachedValue,
            PostgresSQLQueryPrototype__pendingValueSetCachedValue);
        cached_slot!(target_get_cached, target_set_cached,
            PostgresSQLQueryPrototype__targetGetCachedValue,
            PostgresSQLQueryPrototype__targetSetCachedValue);
        get_constructor!(PostgresSQLQuery__getConstructor);
        js_class_fns!(crate::postgres::PostgresSQLQuery,
            PostgresSQLQuery__create,
            PostgresSQLQuery__fromJS,
            PostgresSQLQuery__fromJSDirect);
    }

    pub mod js_mysql_connection {
        use super::*;
        cached_slot!(queries_get_cached, queries_set_cached,
            MySQLConnectionPrototype__queriesGetCachedValue,
            MySQLConnectionPrototype__queriesSetCachedValue);
        cached_slot!(onconnect_get_cached, onconnect_set_cached,
            MySQLConnectionPrototype__onconnectGetCachedValue,
            MySQLConnectionPrototype__onconnectSetCachedValue);
        cached_slot!(onclose_get_cached, onclose_set_cached,
            MySQLConnectionPrototype__oncloseGetCachedValue,
            MySQLConnectionPrototype__oncloseSetCachedValue);
        get_constructor!(MySQLConnection__getConstructor);
    }
    #[allow(non_snake_case)]
    pub use js_mysql_connection as JSMySQLConnection;

    pub mod js_mysql_query {
        use super::*;
        cached_slot!(binding_get_cached, binding_set_cached,
            MySQLQueryPrototype__bindingGetCachedValue,
            MySQLQueryPrototype__bindingSetCachedValue);
        cached_slot!(columns_get_cached, columns_set_cached,
            MySQLQueryPrototype__columnsGetCachedValue,
            MySQLQueryPrototype__columnsSetCachedValue);
        cached_slot!(pending_value_get_cached, pending_value_set_cached,
            MySQLQueryPrototype__pendingValueGetCachedValue,
            MySQLQueryPrototype__pendingValueSetCachedValue);
        cached_slot!(target_get_cached, target_set_cached,
            MySQLQueryPrototype__targetGetCachedValue,
            MySQLQueryPrototype__targetSetCachedValue);
        get_constructor!(MySQLQuery__getConstructor);
    }
    #[allow(non_snake_case)]
    pub use js_mysql_query as JSMySQLQuery;
}

// ──────────────────────────────────────────────────────────────────────────
// JSFunction — host-function constructor (mirrors bun_jsc::JSFunction).
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

unsafe extern "C" {
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
    /// Zig: `JSFunction.create` (src/jsc/JSFunction.zig:30-53).
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
    pub fn queue_microtask(&self, callback: JSValue, args: &[JSValue]) {
        // JSGlobalObject.zig:queueMicrotask → queueMicrotaskJob(fn, a0, a1).
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        unsafe {
            JSC__JSGlobalObject__queueMicrotaskJob(
                self.as_mut_ptr(),
                callback,
                if args.len() > 0 { args[0] } else { JSValue::ZERO },
                if args.len() > 1 { args[1] } else { JSValue::ZERO },
            )
        }
    }
    pub fn try_take_exception(&self) -> Option<JSValue> {
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        let value = unsafe { JSGlobalObject__tryTakeException(self.as_mut_ptr()) };
        if value.is_empty() { None } else { Some(value) }
    }
    pub fn report_active_exception_as_unhandled(&self, e: JsError) {
        let exception = self.take_exception(e);
        if !exception.is_termination_exception() {
            // SAFETY: `self` and `exception` live for the call.
            // TODO(port): export from Zig — `Bun__VM__uncaughtException`.
            unsafe {
                Bun__VM__uncaughtException(
                    self.bun_vm_ptr() as *mut c_void,
                    self.as_mut_ptr(),
                    exception,
                    false,
                );
            }
        }
    }
    pub fn throw_error<E: Into<bun_core::Error>>(&self, err: E, msg: &str) -> JsResult<JSValue> {
        let err: bun_core::Error = err.into();
        if err == bun_core::err!("OutOfMemory") {
            return Err(self.throw_out_of_memory());
        }
        debug_assert!(err != bun_core::err!("JSError"));
        // PERF(port): was stack-fallback (128 bytes).
        let mut buffer: Vec<u8> = Vec::new();
        let _ = std::io::Write::write_fmt(&mut buffer, format_args!("{} {}", err.name(), msg));
        let zs = bun_string::ZigString::init_utf8(&buffer);
        // SAFETY: `zs` borrowed for the call.
        let err_value = unsafe { ZigString__toErrorInstance(&zs, self.as_mut_ptr()) };
        Err(self.throw_value(err_value))
    }
    pub fn throw_invalid_arguments_fmt(&self, args: core::fmt::Arguments<'_>) -> JsResult<JSValue> {
        Err(self.throw(args))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSValue extended surface (call, to_error, create_empty_array, coerce, etc.).
// ──────────────────────────────────────────────────────────────────────────

impl JSValue {
    pub fn call(self, global: &JSGlobalObject, this_value: JSValue, args: &[JSValue]) -> JsResult<JSValue> {
        // SAFETY: `global` is live; `args` is a contiguous slice of valid
        // JSValues for the duration of the call.
        from_js_host_call(global, unsafe {
            Bun__JSValue__call(global.as_mut_ptr(), self, this_value, args.len(), args.as_ptr())
        })
    }
    pub fn to_error(self) -> Option<JSValue> {
        // SAFETY: pure FFI; returns ZERO when not an error.
        let v = unsafe { JSC__JSValue__toError_(self) };
        if v.is_empty() { None } else { Some(v) }
    }
    pub fn create_empty_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        // SAFETY: `global` is live for the duration of the call.
        let v = unsafe { JSC__JSValue__createEmptyArray(global.as_mut_ptr(), len) };
        if v.is_empty() { Err(JsError::Thrown) } else { Ok(v) }
    }
    /// Generic coercion (`coerce(comptime T)` in Zig). Dispatches via
    /// [`CoerceTo::coerce_from`]; only `i32` and `f64` are implemented here
    /// (the SQL bindings' callsites).
    pub fn coerce<T: CoerceTo>(self, global: &JSGlobalObject) -> JsResult<T> {
        T::coerce_from(self, global)
    }
    pub fn json_stringify_fast(self, global: &JSGlobalObject, out: &mut bun_string::String) -> JsResult<()> {
        // SAFETY: `global` is live; `out` is a valid out-param.
        from_js_host_call_generic(global, unsafe {
            JSC__JSValue__jsonStringifyFast(self, global.as_mut_ptr(), out)
        })
    }
    /// Generic downcast (`as(comptime T)` in Zig). Dispatches via [`JsClass::from_js`].
    #[inline]
    pub fn as_<T: JsClass>(self) -> Option<*mut T> {
        if !self.is_cell() { return None; }
        T::from_js(self)
    }
    pub fn to_int32(self) -> i32 {
        if self.is_int32() { return self.as_int32(); }
        if let Some(num) = self.get_number() {
            // JSValue.zig:2129 — coerceJSValueDoubleTruncatingT(i32, num).
            if num.is_nan() { return 0; }
            return num as i32; // Rust `as` saturates on overflow.
        }
        // SAFETY: pure FFI conversion.
        unsafe { JSC__JSValue__toInt32(self) }
    }
    pub fn as_boolean(self) -> bool {
        debug_assert!(self.is_boolean());
        self.0 == Self::TRUE.0
    }
    pub fn is_object(self) -> bool {
        self.is_cell() && self.js_type().is_object()
    }
}
impl From<bool> for JSValue {
    fn from(b: bool) -> Self { Self::js_boolean(b) }
}

/// `JSValue.coerce(comptime T)` dispatch trait (mirrors src/jsc/JSValue.rs:801).
pub trait CoerceTo: Sized {
    fn coerce_from(v: JSValue, global: &JSGlobalObject) -> JsResult<Self>;
}
impl CoerceTo for i32 {
    fn coerce_from(v: JSValue, global: &JSGlobalObject) -> JsResult<Self> {
        // SAFETY: `global` is live; FFI may set an exception.
        from_js_host_call_generic(global, unsafe { JSC__JSValue__coerceToInt32(v, global.as_mut_ptr()) })
    }
}
impl CoerceTo for f64 {
    fn coerce_from(v: JSValue, global: &JSGlobalObject) -> JsResult<Self> {
        if v.is_number() { return Ok(v.as_number()); }
        // SAFETY: `global` is live; FFI may set an exception.
        from_js_host_call_generic(global, unsafe { JSC__JSValue__coerceToDouble(v, global.as_mut_ptr()) })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CallFrame extended surface.
// ──────────────────────────────────────────────────────────────────────────

impl CallFrame {
    /// A slice of all passed arguments to this function call.
    pub fn arguments(&self) -> &[JSValue] {
        // SAFETY: OFFSET_FIRST_ARGUMENT..+argumentsCount() are valid JSValue
        // slots in the JSC register file (CallFrame.h layout).
        unsafe {
            core::slice::from_raw_parts(
                self.as_unsafe_js_value_array().add(OFFSET_FIRST_ARGUMENT),
                self.arguments_count() as usize,
            )
        }
    }
    /// `this` (or `new.target` for constructor frames).
    pub fn this(&self) -> JSValue {
        // SAFETY: OFFSET_THIS_ARGUMENT is a valid slot in the register file.
        unsafe { *self.as_unsafe_js_value_array().add(OFFSET_THIS_ARGUMENT) }
    }
}
pub mod call_frame {
    use super::*;
    /// `Node.ArgumentsSlice` — cursor over a `&[JSValue]` (CallFrame.zig:289).
    pub struct ArgumentsSlice<'a> {
        remaining: &'a [JSValue],
        _vm: *const VirtualMachine,
    }
    impl<'a> ArgumentsSlice<'a> {
        pub fn init(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> Self {
            // PORT NOTE: Zig kept a `bun.ArenaAllocator` per-slice for
            // `nextEat`-style scratch; the SQL callsites only iterate, so the
            // arena is dropped here (PORTING.md §Allocators — non-AST crate).
            Self { remaining: slice, _vm: vm }
        }
        #[allow(dead_code)]
        pub fn next(&mut self) -> Option<JSValue> {
            let (first, rest) = self.remaining.split_first()?;
            self.remaining = rest;
            Some(*first)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MarkedArgumentBuffer::run — C++-side trampoline (mirrors
// `JSC::MarkedArgumentBuffer` stack-scoped buffer pattern).
// ──────────────────────────────────────────────────────────────────────────

impl MarkedArgumentBuffer {
    pub fn run<Ctx>(ctx: *mut c_void, f: extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer)) {
        // SAFETY: `MarkedArgumentBuffer__run` round-trips `ctx` opaquely back
        // to `f`; `f`'s ABI is identical modulo the pointee types (both params
        // are thin pointers). Mirrors Zig `@ptrCast` of both.
        unsafe {
            MarkedArgumentBuffer__run(
                ctx,
                core::mem::transmute::<
                    extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer),
                    extern "C" fn(*mut c_void, *mut c_void),
                >(f),
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RareData extended surface (SQL socket-group accessors).
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    /// rare_data.zig:717 — `lazyGroup(vm, "postgres_group"/"postgres_tls_group")`.
    pub fn postgres_group(&mut self, vm: &VirtualMachine, ssl: bool) -> *mut bun_uws::SocketGroup {
        // SAFETY: `vm` is live; the Zig side lazily inits the embedded group.
        // TODO(port): export from Zig — `Bun__RareData__postgresGroup`.
        unsafe { Bun__RareData__postgresGroup(vm.as_mut_ptr() as *mut c_void, ssl) }
    }
    pub fn mysql_group(&mut self, vm: &VirtualMachine, ssl: bool) -> *mut bun_uws::SocketGroup {
        // SAFETY: `vm` is live; the Zig side lazily inits the embedded group.
        // TODO(port): export from Zig — `Bun__RareData__mysqlGroup`.
        unsafe { Bun__RareData__mysqlGroup(vm.as_mut_ptr() as *mut c_void, ssl) }
    }
    pub fn ssl_ctx_cache(&mut self) -> &mut SslCtxCache {
        // SAFETY: returns `&rare.ssl_ctx_cache` — non-null while RareData lives.
        // TODO(port): export from Zig — `Bun__RareData__sslCtxCache`.
        unsafe { &mut *Bun__RareData__sslCtxCache(VirtualMachine::get() as *mut c_void) }
    }
}
/// Opaque handle to `bun_runtime::api::SSLContextCache`.
#[repr(C)]
pub struct SslCtxCache { _opaque: core::cell::UnsafeCell<[u8; 0]> }
impl SslCtxCache {
    /// SSLContextCache.zig:63 — `getOrCreateOpts(opts, *err) ?*SSL_CTX`.
    pub fn get_or_create_opts(
        &mut self,
        opts: bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<*mut bun_uws::SslCtx> {
        // SAFETY: `self` is `&rare.ssl_ctx_cache`; `opts` passed by value;
        // `err` is a valid out-param.
        // TODO(port): export from Zig — `Bun__SSLContextCache__getOrCreateOpts`.
        let p = unsafe {
            Bun__SSLContextCache__getOrCreateOpts(
                self._opaque.get() as *mut c_void,
                &opts as *const _,
                err as *mut bun_uws::create_bun_socket_error_t as *mut c_int,
            )
        };
        if p.is_null() { None } else { Some(p) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// KeepAlive — local mirror of `bun_aio::KeepAlive` accepting `&VirtualMachine`
// (the SQL callsites pass vm directly). The body matches
// posix_event_loop.zig: ref/unref bump the uSockets loop's active count.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum KeepAliveStatus { #[default] Inactive, Active, Done }

#[derive(Default)]
pub struct KeepAlive { status: KeepAliveStatus }
impl KeepAlive {
    /// Allow a poll to keep the process alive.
    pub fn r#ref(&mut self, vm: &VirtualMachine) {
        if self.status != KeepAliveStatus::Inactive { return; }
        self.status = KeepAliveStatus::Active;
        // SAFETY: `vm` is live; FFI bumps the loop's active counter.
        // TODO(port): export from Zig — `Bun__VM__loopRef`.
        unsafe { Bun__VM__loopRef(vm.as_mut_ptr() as *mut c_void) };
    }
    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, vm: &VirtualMachine) {
        if self.status != KeepAliveStatus::Active { return; }
        self.status = KeepAliveStatus::Inactive;
        // SAFETY: `vm` is live; FFI decrements the loop's active counter.
        // TODO(port): export from Zig — `Bun__VM__loopUnref`.
        unsafe { Bun__VM__loopUnref(vm.as_mut_ptr() as *mut c_void) };
    }
    /// Make calling `ref()` on this poll into a no-op.
    pub fn disable(&mut self) {
        if self.status == KeepAliveStatus::Active {
            // SAFETY: thread-local VM is set on the JS thread.
            unsafe { Bun__VM__loopUnref(VirtualMachine::get() as *mut c_void) };
        }
        self.status = KeepAliveStatus::Done;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — JSC bindings (src/jsc/bindings/bindings.cpp). The .a/.o files
// are linked into the binary; declare and call (PORTING.md §Forbidden).
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // JSValue
    fn JSC__JSValue__isAnyInt(this: JSValue) -> bool;
    fn JSC__JSValue__isAnyError(this: JSValue) -> bool;
    fn JSC__JSValue__isBigInt(this: JSValue) -> bool;
    fn JSC__JSValue__jsType(this: JSValue) -> JSType;
    fn JSC__JSValue__jsNumberFromDouble(n: f64) -> JSValue;
    fn JSC__JSValue__createEmptyObject(global: *mut JSGlobalObject, len: usize) -> JSValue;
    fn JSC__JSValue__createEmptyObjectWithNullPrototype(global: *mut JSGlobalObject) -> JSValue;
    fn JSC__JSValue__createEmptyArray(global: *mut JSGlobalObject, len: usize) -> JSValue;
    fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
        global: *mut JSGlobalObject, ptr: *mut u8, len: usize,
        ctx: *mut c_void,
        deallocator: Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>,
    ) -> JSValue;
    fn MarkedArrayBuffer_deallocator(bytes: *mut c_void, ctx: *mut c_void);
    fn JSC__JSValue__parseJSON(this: JSValue, global: *mut JSGlobalObject) -> JSValue;
    fn JSC__JSValue__dateInstanceFromNullTerminatedString(global: *mut JSGlobalObject, s: *const c_char) -> JSValue;
    fn JSC__JSValue__dateInstanceFromNumber(global: *mut JSGlobalObject, n: f64) -> JSValue;
    fn JSC__JSValue__fromInt64NoTruncate(global: *mut JSGlobalObject, i: i64) -> JSValue;
    fn JSC__JSValue__toBoolean(this: JSValue) -> bool;
    fn JSC__JSValue__toInt32(this: JSValue) -> i32;
    fn JSC__JSValue__toInt64(this: JSValue) -> i64;
    fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) -> u64;
    fn JSC__JSValue__coerceToInt32(this: JSValue, global: *mut JSGlobalObject) -> i32;
    fn JSC__JSValue__coerceToDouble(this: JSValue, global: *mut JSGlobalObject) -> f64;
    fn JSC__JSValue__getUnixTimestamp(this: JSValue) -> f64;
    fn JSC__JSValue__getOwnByValue(this: JSValue, global: *mut JSGlobalObject, key: JSValue) -> JSValue;
    fn JSC__JSValue__getLengthIfPropertyExistsInternal(this: JSValue, global: *mut JSGlobalObject) -> f64;
    fn JSC__JSValue__put(this: JSValue, global: *mut JSGlobalObject, key: *const bun_string::ZigString, value: JSValue);
    fn JSC__JSValue__jsonStringifyFast(this: JSValue, global: *mut JSGlobalObject, out: *mut bun_string::String);
    fn JSC__JSValue__toError_(this: JSValue) -> JSValue;
    fn JSC__JSValue__isTerminationException(this: JSValue) -> bool;
    fn JSC__isBigIntInInt64Range(this: JSValue, min: i64, max: i64) -> bool;
    fn JSC__isBigIntInUInt64Range(this: JSValue, min: u64, max: u64) -> bool;
    fn Bun__JSValue__call(
        global: *mut JSGlobalObject,
        function: JSValue,
        this_value: JSValue,
        args_len: usize,
        args_ptr: *const JSValue,
    ) -> JSValue;

    // JSGlobalObject
    fn JSGlobalObject__hasException(this: *mut JSGlobalObject) -> bool;
    fn JSGlobalObject__tryTakeException(this: *mut JSGlobalObject) -> JSValue;
    fn JSGlobalObject__throwOutOfMemoryError(this: *mut JSGlobalObject);
    fn JSGlobalObject__createOutOfMemoryError(this: *mut JSGlobalObject) -> JSValue;
    fn JSC__JSGlobalObject__bunVM(this: *mut JSGlobalObject) -> *mut c_void;
    fn JSC__JSGlobalObject__vm(this: *mut JSGlobalObject) -> *mut c_void;
    fn JSC__JSGlobalObject__queueMicrotaskJob(this: *mut JSGlobalObject, function: JSValue, first: JSValue, second: JSValue);
    fn Bun__gregorianDateTimeToMS(this: *mut JSGlobalObject, y: i32, mo: i32, d: i32, h: i32, mi: i32, s: i32, ms: i32, local: bool) -> f64;
    fn Bun__createErrorWithCode(global: *mut JSGlobalObject, code: ErrorCode, message: *mut bun_string::String) -> JSValue;

    // VM
    fn JSC__VM__throwError(vm: *mut c_void, global: *mut JSGlobalObject, value: JSValue);

    // ZigString
    fn ZigString__toValueGC(this: *const bun_string::ZigString, global: *mut JSGlobalObject) -> JSValue;
    fn ZigString__toErrorInstance(this: *const bun_string::ZigString, global: *mut JSGlobalObject) -> JSValue;

    // JSObject
    static JSC__JSObject__maxInlineCapacity: c_uint;
    fn JSC__JSObject__getIndex(this: JSValue, global: *mut JSGlobalObject, i: u32) -> JSValue;
    fn JSC__createStructure(global: *mut JSGlobalObject, owner: *mut JSCell, length: u32, names: *mut ExternColumnIdentifier) -> JSValue;

    // Strong
    fn Bun__StrongRef__new(global: *mut JSGlobalObject, value: JSValue) -> *mut StrongImpl;
    fn Bun__StrongRef__set(this: *mut StrongImpl, global: *mut JSGlobalObject, value: JSValue);
    fn Bun__StrongRef__delete(this: *mut StrongImpl);

    // MarkedArgumentBuffer
    fn MarkedArgumentBuffer__append(args: *mut MarkedArgumentBuffer, value: JSValue);
    fn MarkedArgumentBuffer__run(ctx: *mut c_void, f: extern "C" fn(*mut c_void, *mut c_void));

    // VirtualMachine accessors — TODO(port): export from Zig.
    fn Bun__getVM() -> *mut c_void;
    fn Bun__VirtualMachine__isShuttingDown(vm: *mut c_void) -> bool;
    fn Bun__VM__rareData(vm: *mut VirtualMachine) -> *mut RareData;
    fn Bun__VM__global(vm: *mut VirtualMachine) -> *mut JSGlobalObject;
    fn Bun__VM__eventLoop(vm: *mut VirtualMachine) -> *mut EventLoop;
    fn Bun__VM__timer(vm: *mut VirtualMachine) -> *mut TimerHeap;
    fn Bun__VM__uncaughtException(vm: *mut c_void, global: *mut JSGlobalObject, exception: JSValue, is_rejection: bool);
    fn Bun__VM__loopRef(vm: *mut c_void);
    fn Bun__VM__loopUnref(vm: *mut c_void);
    fn Bun__VM__postDeferredTask(vm: *mut VirtualMachine, ctx: *mut c_void, cb: Option<unsafe extern "C" fn(*mut c_void) -> bool>);
    fn Bun__VM__unregisterDeferredTask(vm: *mut VirtualMachine, ctx: *mut c_void) -> bool;

    // EventLoop / Timer — TODO(port): export from Zig.
    fn Bun__EventLoop__enterLoop(loop_: *mut EventLoop);
    fn Bun__EventLoop__exitLoop(loop_: *mut EventLoop);
    fn Bun__Timer__All__insert(this: *mut TimerHeap, timer: *mut EventLoopTimer);
    fn Bun__Timer__All__remove(this: *mut TimerHeap, timer: *mut EventLoopTimer);

    // RareData / SSL — TODO(port): export from Zig.
    fn Bun__RareData__postgresGroup(vm: *mut c_void, ssl: bool) -> *mut bun_uws::SocketGroup;
    fn Bun__RareData__mysqlGroup(vm: *mut c_void, ssl: bool) -> *mut bun_uws::SocketGroup;
    fn Bun__RareData__sslCtxCache(vm: *mut c_void) -> *mut SslCtxCache;
    fn Bun__SSLContextCache__getOrCreateOpts(cache: *mut c_void, opts: *const bun_uws::us_bun_socket_context_options_t, err: *mut c_int) -> *mut bun_uws::SslCtx;
    fn Bun__SSLConfig__fromJS(global: *mut JSGlobalObject, value: JSValue, out: *mut c_void) -> bool;
    fn Bun__SSLConfig__asUSocketsClient(cfg: *const c_void, out: *mut bun_uws::us_bun_socket_context_options_t);
}
