//! Local signature-compatible mirror of `bun_jsc` for the SQL bindings.
//!
//! Core handle types (`JSValue`, `JSGlobalObject`, `CallFrame`, `JsError`,
//! `JsResult`, `JSObject`, `JSCell`, `JSType`, …) are **re-exported from
//! `bun_jsc`** so the `#[bun_jsc::JsClass]` / `#[bun_jsc::host_fn]` proc-macros
//! see identical types. SQL-specific helpers that `bun_jsc` doesn't yet expose
//! are provided as extension traits ([`JSValueSqlExt`], [`JSGlobalObjectSqlExt`]).
//!
//! Types that must embed `crate::mysql` / `crate::postgres` state
//! ([`VirtualMachine`], [`RareData`], [`EventLoop`], …) stay local — `bun_jsc`'s
//! own `RareData.mysql_context` is an opaque placeholder, so the SQL state
//! machines need their own concrete view.

#![allow(unused_variables, non_snake_case, dead_code, unused_imports)]

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

// ──────────────────────────────────────────────────────────────────────────
// Core handles — re-exported from `bun_jsc` so proc-macro generated wrappers
// (which hard-code `bun_jsc::JSGlobalObject` / `bun_jsc::CallFrame` / …) see
// the same types as user code importing `crate::jsc::*`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::{
    JSValue, JSGlobalObject, CallFrame, JSObject, JSCell, JsError, JsResult, JSType,
    MarkedArgumentBuffer, JSArrayIterator, ErrorCode, ErrorBuilder,
    ExternColumnIdentifier, ExternColumnIdentifierValue,
    StrongOptional, JsRef, CoerceTo, ThrowFmtArgs,
    StringJsc, ZigStringJsc, bun_string_jsc, host_fn,
};

/// `bun_jsc::IntegerRange` (src/jsc/JSGlobalObject.rs:1478) — comptime-range
/// options for `validate_integer_range` / `validate_big_int_range`. Mirrored
/// locally because `bun_jsc` doesn't re-export it at the crate root.
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

/// Back-compat alias — earlier ports named this `ErrBuilder`.
pub type ErrBuilder<'a> = bun_jsc::ErrorBuilder<'a>;

// ──────────────────────────────────────────────────────────────────────────
// Error bridging.
//
// `impl From<bun_jsc::JsError> for bun_sql::*` would be an orphan (both types
// foreign to this crate), so the conversions are exposed as free fns instead.
// Callers use `.map_err(jsc::js_error_to_postgres)?` / `..._to_mysql)?`.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn js_error_to_postgres(e: JsError) -> bun_sql::postgres::AnyPostgresError {
    use bun_sql::postgres::AnyPostgresError as E;
    match e {
        JsError::Thrown => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
        JsError::Terminated => E::JSTerminated,
    }
}
#[inline]
pub fn js_error_to_mysql(e: JsError) -> bun_sql::mysql::protocol::any_mysql_error::Error {
    use bun_sql::mysql::protocol::any_mysql_error::Error as E;
    match e {
        JsError::Thrown => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
        JsError::Terminated => E::JSTerminated,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// host_fn helpers (mirrors bun_jsc::host_fn::from_js_host_call*; kept local
// for the few extension-trait bodies below that call extern "C" symbols
// directly).
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
// JSValue — SQL-specific extension surface (methods bun_jsc doesn't expose).
// ──────────────────────────────────────────────────────────────────────────

/// SQL-side helpers on `JSValue` not (yet) provided by `bun_jsc`.
pub trait JSValueSqlExt: Sized + Copy {
    fn create_buffer_copy(global: &JSGlobalObject, slice: &[u8]) -> JSValue;
    fn js_double_number(n: f64) -> JSValue;
    fn to_uint64_no_truncate(self) -> u64;
    fn is_big_int_in_int64_range(self, min: i64, max: i64) -> bool;
    fn is_big_int_in_uint64_range(self, min: u64, max: u64) -> bool;
}

const DOUBLE_ENCODE_OFFSET: i64 = 1i64 << 49;

impl JSValueSqlExt for JSValue {
    /// `JSValue.createBuffer(global, slice, null)` — Zig passes a `[]const u8`
    /// and `null` allocator, meaning JSC must not free the pointer. The SQL
    /// callsite (`bytea.zig`) passes a slice into a transient decode buffer, so
    /// the bytes are duplicated into a mimalloc allocation here and handed to
    /// JSC with the standard deallocator.
    fn create_buffer_copy(global: &JSGlobalObject, slice: &[u8]) -> JSValue {
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
    /// `JSValue::jsDoubleNumber` — boxes an f64 (always double-encoded; no
    /// int32 fast path). FFI.zig: `DOUBLE_TO_JSVALUE`.
    fn js_double_number(n: f64) -> JSValue {
        JSValue::from_encoded(
            (n.to_bits() as i64).wrapping_add(DOUBLE_ENCODE_OFFSET) as usize,
        )
    }
    fn to_uint64_no_truncate(self) -> u64 {
        // SAFETY: pure FFI conversion.
        unsafe { JSC__JSValue__toUInt64NoTruncate(self) }
    }
    fn is_big_int_in_int64_range(self, min: i64, max: i64) -> bool {
        // SAFETY: pure FFI predicate (JSValue.zig:40).
        unsafe { JSC__isBigIntInInt64Range(self, min, max) }
    }
    fn is_big_int_in_uint64_range(self, min: u64, max: u64) -> bool {
        // SAFETY: pure FFI predicate (JSValue.zig:36).
        unsafe { JSC__isBigIntInUInt64Range(self, min, max) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSGlobalObject — SQL-specific extension surface.
// ──────────────────────────────────────────────────────────────────────────

/// SQL-side helpers on `JSGlobalObject` not provided by `bun_jsc` (or where
/// the SQL bindings need a slightly different signature).
pub trait JSGlobalObjectSqlExt {
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a>;
    fn throw_invalid_arguments_fmt(&self, args: core::fmt::Arguments<'_>) -> JsResult<JSValue>;
    /// `globalObject.bunVM()` returning the **local** [`VirtualMachine`] view
    /// (whose `rare_data()` exposes the SQL `mysql_context` / `postgresql_context`).
    /// `bun_jsc::JSGlobalObject::bun_vm()` returns `bun_jsc`'s own
    /// `VirtualMachine`; SQL callsites need this one instead.
    fn sql_vm(&self) -> &VirtualMachine;
    fn sql_vm_ptr(&self) -> *mut VirtualMachine;

    // ── Ports of gated `bun_jsc::JSGlobalObject` methods (JSGlobalObject.rs is
    // behind `#![cfg(any())]` in the stub crate, so these are mirrored here so
    // SQL callsites compile against the local [`IntegerRange`]). ──
    fn validate_integer_range<T: bun_core::Integer>(
        &self,
        value: JSValue,
        default: T,
        range: IntegerRange,
    ) -> JsResult<T>;
    fn validate_big_int_range<T: bun_core::Integer>(
        &self,
        value: JSValue,
        default: T,
        range: IntegerRange,
    ) -> JsResult<T>;
    /// `Bun__gregorianDateTimeToMS` (local-time variant). Unsigned-arg
    /// signature matches the SQL `DateTime` field types.
    fn gregorian_date_time_to_ms(
        &self,
        year: u16,
        month: u8,
        day: u8,
        hour: u8,
        minute: u8,
        second: u8,
        millisecond: u32,
    ) -> JsResult<f64>;
}

impl JSGlobalObjectSqlExt for JSGlobalObject {
    #[inline]
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a> {
        self.err(ErrorCode::OUT_OF_RANGE, args)
    }
    #[inline]
    fn throw_invalid_arguments_fmt(&self, args: core::fmt::Arguments<'_>) -> JsResult<JSValue> {
        Err(self.throw(args))
    }
    #[inline]
    fn sql_vm(&self) -> &VirtualMachine {
        // SAFETY: bunVM returns a valid *VirtualMachine for this global,
        // live for the VM lifetime.
        unsafe { &*(JSC__JSGlobalObject__bunVM(self.as_mut_ptr()) as *mut VirtualMachine) }
    }
    #[inline]
    fn sql_vm_ptr(&self) -> *mut VirtualMachine {
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        unsafe { JSC__JSGlobalObject__bunVM(self.as_mut_ptr()) as *mut VirtualMachine }
    }

    fn validate_integer_range<T: bun_core::Integer>(
        &self,
        value: JSValue,
        default: T,
        range: IntegerRange,
    ) -> JsResult<T> {
        // Port of JSGlobalObject.zig `validateIntegerRange` (gated in bun_jsc).
        if value.is_undefined() || value.is_empty() {
            return Ok(default);
        }

        let min_t: i128 = range.min.max(T::MIN_I128).max(i128::from(bun_jsc::MIN_SAFE_INTEGER));
        let max_t: i128 = range.max.min(T::MAX_I128).min(i128::from(bun_jsc::MAX_SAFE_INTEGER));
        debug_assert!(min_t <= max_t, "max must be less than min");
        let field_name = range.field_name;
        debug_assert!(!field_name.is_empty(), "field_name must not be empty");
        let always_allow_zero = range.always_allow_zero;

        let throw_oor = |received: f64| -> JsError {
            self.throw_range_error(
                received,
                bun_core::fmt::OutOfRangeOptions {
                    field_name,
                    min: min_t.clamp(i64::MIN as i128, i64::MAX as i128) as i64,
                    max: max_t.clamp(i64::MIN as i128, i64::MAX as i128) as i64,
                    ..Default::default()
                },
            )
        };

        if value.is_int32() {
            let int = value.to_int32();
            if always_allow_zero && int == 0 {
                return Ok(T::ZERO);
            }
            if i128::from(int) < min_t || i128::from(int) > max_t {
                return Err(throw_oor(int as f64));
            }
            return Ok(T::from_i32(int));
        }

        if !value.is_number() {
            // PORT NOTE: gated original used `throw_invalid_property_type_value`
            // (not on the stub `JSGlobalObject`); fall back to a TypeError.
            return Err(self.throw_invalid_arguments(format_args!(
                "The \"{}\" property must be of type number.",
                bstr::BStr::new(field_name)
            )));
        }
        let f64_val = value.as_number();
        if always_allow_zero && f64_val == 0.0 {
            return Ok(T::ZERO);
        }
        if f64_val.is_nan() || f64_val.floor() != f64_val {
            return Err(self.throw_invalid_arguments(format_args!(
                "The \"{}\" property must be an integer.",
                bstr::BStr::new(field_name)
            )));
        }
        if f64_val < min_t as f64 || f64_val > max_t as f64 {
            return Err(throw_oor(f64_val));
        }
        Ok(T::from_f64(f64_val))
    }

    fn validate_big_int_range<T: bun_core::Integer>(
        &self,
        value: JSValue,
        default: T,
        range: IntegerRange,
    ) -> JsResult<T> {
        // Port of JSGlobalObject.zig `validateBigIntRange` (gated in bun_jsc).
        if value.is_undefined() || value.is_empty() {
            return Ok(T::ZERO);
        }

        let min_t: i128 = range.min.max(T::MIN_I128);
        let max_t: i128 = range.max.min(T::MAX_I128);
        if value.is_big_int() {
            if T::SIGNED {
                if value.is_big_int_in_int64_range(
                    min_t.clamp(i64::MIN as i128, i64::MAX as i128) as i64,
                    max_t.clamp(i64::MIN as i128, i64::MAX as i128) as i64,
                ) {
                    return Ok(T::from_i64(value.to_int64()));
                }
            } else if value.is_big_int_in_uint64_range(
                min_t.clamp(0, u64::MAX as i128) as u64,
                max_t.clamp(0, u64::MAX as i128) as u64,
            ) {
                return Ok(T::from_u64(value.to_uint64_no_truncate()));
            }
            return Err(self
                .err(
                    ErrorCode::OUT_OF_RANGE,
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
                min: min_t.max(i128::from(bun_jsc::MIN_SAFE_INTEGER)),
                max: max_t.min(i128::from(bun_jsc::MAX_SAFE_INTEGER)),
                field_name: range.field_name,
                always_allow_zero: range.always_allow_zero,
            },
        )
    }

    fn gregorian_date_time_to_ms(
        &self,
        year: u16,
        month: u8,
        day: u8,
        hour: u8,
        minute: u8,
        second: u8,
        millisecond: u32,
    ) -> JsResult<f64> {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; all integer args by value.
        Ok(unsafe {
            Bun__gregorianDateTimeToMS(
                self.as_mut_ptr(),
                year as c_int,
                month as c_int,
                day as c_int,
                hour as c_int,
                minute as c_int,
                second as c_int,
                millisecond as c_int,
                true,
            )
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine / RareData — local view.
//
// `bun_jsc::rare_data::RareData` declares `mysql_context` / `postgresql_context`
// as opaque ZSTs (placeholder until the runtime-crate cycle-break vtable lands).
// The SQL bindings need the *concrete* `crate::mysql::MySQLContext` /
// `crate::postgres::PostgresSQLContext`, so a local `VirtualMachine` /
// `RareData` view is kept here. All accesses go through extern "C" accessors;
// the Zig side `@export`s these as `Bun__VM__*`.
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
    /// `bun_jsc::VirtualMachine::get()` — TLS-backed singleton accessor.
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
    /// can write `self.vm().timer().remove(..)`.
    pub fn timer(&mut self) -> &mut TimerHeap {
        // SAFETY: `&vm.timer` — non-null while the VM is live.
        // TODO(port): export from Zig — `Bun__VM__timer`.
        unsafe { &mut *Bun__VM__timer(self.as_mut_ptr()) }
    }
}

/// Mirrors `bun_jsc::rare_data::RareData` — only SQL fields surfaced.
pub struct RareData {
    pub mysql_context: crate::mysql::MySQLContext,
    pub postgresql_context: crate::postgres::PostgresSQLContext,
}

// ──────────────────────────────────────────────────────────────────────────
// EventLoop / TimerHeap / EventLoopTimer — local opaque views.
// ──────────────────────────────────────────────────────────────────────────

/// `bun_jsc::EventLoop` — opaque, always borrowed.
#[repr(C)]
pub struct EventLoop {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
impl EventLoop {
    pub fn enter(&self) {
        // SAFETY: `self` is a live `*EventLoop`.
        unsafe { Bun__EventLoop__enterLoop(self._opaque.get() as *mut EventLoop) }
    }
    pub fn exit(&self) {
        // SAFETY: `self` is a live `*EventLoop`.
        unsafe { Bun__EventLoop__exitLoop(self._opaque.get() as *mut EventLoop) }
    }
    /// `EventLoop.runCallback` (event_loop.zig) — `enter()` → call → report
    /// any thrown exception as unhandled → `exit()`. Mirrors the inline body
    /// JSMySQLConnection used before this helper existed.
    pub fn run_callback(
        &self,
        function: JSValue,
        global: &JSGlobalObject,
        this_value: JSValue,
        args: &[JSValue],
    ) {
        self.enter();
        if let Err(e) = function.call(global, this_value, args) {
            global.report_active_exception_as_unhandled(e);
        }
        self.exit();
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
        unsafe { Bun__Timer__All__insert(self._opaque.get() as *mut TimerHeap, t) }
    }
    pub fn remove(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&vm.timer`; `t` is a live intrusive heap node.
        unsafe { Bun__Timer__All__remove(self._opaque.get() as *mut TimerHeap, t) }
    }
}

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
// `src/event_loop/AutoFlusher.zig`).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AutoFlusher {
    pub registered: bool,
}
impl AutoFlusher {
    pub fn register_deferred_microtask_with_type_unchecked<T>(this: *mut T, vm: &VirtualMachine) {
        // SAFETY: `vm` is live; `this` is a live `*mut T` whose `auto_flusher`
        // field has `registered == false` (caller-checked).
        // TODO(port): export from Zig — `Bun__VM__postDeferredTask`.
        unsafe {
            Bun__VM__postDeferredTask(vm.as_mut_ptr(), this as *mut c_void, None);
        }
    }
    pub fn unregister_deferred_microtask_with_type<T>(this: *mut T, vm: &VirtualMachine) {
        // SAFETY: `vm` is live; `this` was previously registered.
        // TODO(port): export from Zig — `Bun__VM__unregisterDeferredTask`.
        unsafe { Bun__VM__unregisterDeferredTask(vm.as_mut_ptr(), this as *mut c_void) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// api::ServerConfig::SSLConfig — TLS option bag (mirrors
// `src/runtime/socket/SSLConfig.rs`).
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
            unsafe { Bun__Blob__needsToReadFile(self._opaque.get() as *const c_void) }
        }
        pub fn shared_view(&self) -> &[u8] {
            let mut len: usize = 0;
            // SAFETY: `self` is a live `*const Blob`; the returned ptr/len
            // borrow the Blob's store, which is immutable for its lifetime.
            let ptr = unsafe { Bun__Blob__sharedView(self._opaque.get() as *const c_void, &mut len) };
            if ptr.is_null() || len == 0 { return &[]; }
            // SAFETY: Zig guarantees `ptr[..len]` valid while the Blob lives.
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
        fn Blob__fromJS(value: JSValue) -> *mut c_void;
        fn Bun__Blob__needsToReadFile(this: *const c_void) -> bool;
        fn Bun__Blob__sharedView(this: *const c_void, out_len: *mut usize) -> *const u8;
    }
}

/// `bun_jsc::JsClass` — generic downcast trait backing `JSValue::as_<T>()`.
/// Re-exported so the codegen module's blanket impls land on the same trait
/// `bun_jsc::JSValue::as_<T>()` keys on.
pub use bun_jsc::JsClass;

// ──────────────────────────────────────────────────────────────────────────
// codegen::JS{Type} — per-JsClass cached-value getters/setters generated from
// `.classes.ts`.
// ──────────────────────────────────────────────────────────────────────────

pub mod codegen {
    use super::{JSGlobalObject, JSValue};
    use core::ffi::c_void;

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

    macro_rules! js_class_fns {
        ($payload:ty, $create:ident, $from_js:ident, $from_js_direct:ident) => {
            unsafe extern "C" {
                fn $create(global: *mut JSGlobalObject, ptr: *mut c_void) -> JSValue;
                fn $from_js(value: JSValue) -> *mut c_void;
                fn $from_js_direct(value: JSValue) -> *mut c_void;
            }
            pub fn to_js(ptr: *mut $payload, g: &JSGlobalObject) -> JSValue {
                // SAFETY: `ptr` is a live m_ctx payload; ownership transfers.
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
        // Variant that also emits `impl JsClass` (Zig: `value.as(T)`). Some
        // payload types already provide their own `impl JsClass` (e.g. the
        // Connection types), so the impl is opt-in via this trailing marker
        // rather than unconditional.
        ($payload:ty, $create:ident, $from_js:ident, $from_js_direct:ident, impl_js_class) => {
            js_class_fns!($payload, $create, $from_js, $from_js_direct);
            impl crate::jsc::JsClass for $payload {
                fn from_js(v: JSValue) -> Option<*mut Self> { from_js(v) }
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
            PostgresSQLQuery__fromJSDirect,
            impl_js_class);
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
        js_class_fns!(crate::mysql::js_my_sql_connection::JSMySQLConnection,
            MySQLConnection__create,
            MySQLConnection__fromJS,
            MySQLConnection__fromJSDirect);
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
        js_class_fns!(crate::mysql::js_mysql_query::JSMySQLQuery,
            MySQLQuery__create,
            MySQLQuery__fromJS,
            MySQLQuery__fromJSDirect,
            impl_js_class);
    }
    #[allow(non_snake_case)]
    pub use js_mysql_query as JSMySQLQuery;
}

// ──────────────────────────────────────────────────────────────────────────
// JSFunction — host-function constructor.
//
// `bun_jsc::JSFunction` exists, but its `create` signature differs; the SQL
// callsites only need the `JSHostFn` thunk plumbing, kept local so callers
// don't churn.
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct JSFunction { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

/// `jsc.JSHostFn` — the C-ABI host-function pointer JSC dispatches to.
pub type JSHostFn = unsafe extern "C" fn(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue;
pub type JSHostFnZig = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

pub trait IntoJSHostFn<Marker>: Sized {
    fn into_js_host_fn(self) -> JSHostFn;
}
#[doc(hidden)] pub struct HostFnRaw;
#[doc(hidden)] pub struct HostFnResult;
#[doc(hidden)] pub struct HostFnPlain;

impl IntoJSHostFn<HostFnRaw> for JSHostFn {
    #[inline] fn into_js_host_fn(self) -> JSHostFn { self }
}
impl<F> IntoJSHostFn<HostFnResult> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(core::mem::size_of::<F>(), 0, "IntoJSHostFn: expected fn item (ZST)");
        let _ = self;
        unsafe extern "C" fn thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
        where
            F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static,
        {
            // SAFETY: `F` is a ZST fn item — no bit pattern to invalidate.
            let f: F = unsafe { core::mem::MaybeUninit::zeroed().assume_init() };
            // SAFETY: JSC passes live non-null `*JSGlobalObject` / `*CallFrame`.
            let global = unsafe { &*g };
            let frame = unsafe { &*c };
            match f(global, frame) {
                Ok(v) => v,
                Err(JsError::OutOfMemory) => { let _ = global.throw_out_of_memory(); JSValue::ZERO }
                Err(_) => JSValue::ZERO,
            }
        }
        thunk::<F>
    }
}
impl<F> IntoJSHostFn<HostFnPlain> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(core::mem::size_of::<F>(), 0, "IntoJSHostFn: expected fn item (ZST)");
        let _ = self;
        unsafe extern "C" fn thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
        where
            F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static,
        {
            // SAFETY: `F` is a ZST fn item.
            let f: F = unsafe { core::mem::MaybeUninit::zeroed().assume_init() };
            // SAFETY: JSC passes live non-null pointers.
            f(unsafe { &*g }, unsafe { &*c })
        }
        thunk::<F>
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Default)]
pub enum ImplementationVisibility {
    #[default]
    Public = 0,
    Private = 1,
    PrivateRecursive = 2,
}
#[repr(u8)]
#[derive(Clone, Copy, Default)]
pub enum Intrinsic {
    #[default]
    None = 0,
}
#[derive(Default)]
pub struct CreateJSFunctionOptions {
    pub implementation_visibility: ImplementationVisibility,
    pub intrinsic: Intrinsic,
    pub constructor: Option<JSHostFn>,
}

unsafe extern "C" {
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
    /// Accepts either a raw [`JSHostFn`] (C-ABI) or a safe Rust
    /// `fn(&JSGlobalObject, &CallFrame) -> JSValue` / `-> JsResult<JSValue>`
    /// via [`IntoJSHostFn`] (Zig: `jsc.toJSHostFn(fn)`).
    pub fn create<M, F: IntoJSHostFn<M>>(
        global: &JSGlobalObject,
        name: &str,
        implementation: F,
        arg_count: u32,
        opts: CreateJSFunctionOptions,
    ) -> JSValue {
        let implementation: JSHostFn = implementation.into_js_host_fn();
        let fn_name = bun_string::String::init(name);
        // SAFETY: `global` is live; `implementation` is a valid C-ABI fn ptr.
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
// CallFrame helpers — `bun_jsc::ArgumentsSlice` exists; this local variant
// keeps the `&VirtualMachine` (local view) signature the SQL callsites use.
// ──────────────────────────────────────────────────────────────────────────

pub mod call_frame {
    use super::*;
    /// `Node.ArgumentsSlice` — cursor over a `&[JSValue]` (CallFrame.zig:289).
    pub struct ArgumentsSlice<'a> {
        remaining: &'a [JSValue],
        _vm: *const c_void,
    }
    impl<'a> ArgumentsSlice<'a> {
        /// Generic over the VM handle so it accepts both the local
        /// [`VirtualMachine`] and `bun_jsc`'s (callers pass `global.bun_vm()`,
        /// which returns a raw `*mut VirtualMachineRef`). The VM is not
        /// dereferenced — it's only carried for API parity with the Zig
        /// `Node.ArgumentsSlice` shape — so it's accepted by-value and dropped.
        pub fn init<V>(_vm: V, slice: &'a [JSValue]) -> Self {
            Self { remaining: slice, _vm: core::ptr::null() }
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
// MarkedArgumentBuffer::run — C++-side trampoline. `bun_jsc::MarkedArgumentBuffer`
// exposes `new(f)`; the SQL callsites use the lower-level `run(ctx, fn_ptr)`
// shape, kept here as a free fn (cannot add inherent methods to a foreign type).
// ──────────────────────────────────────────────────────────────────────────

pub fn marked_argument_buffer_run<Ctx>(
    ctx: *mut c_void,
    f: extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer),
) {
    // SAFETY: `MarkedArgumentBuffer__run` round-trips `ctx` opaquely back to
    // `f`; both params are thin pointers so the transmute is ABI-identical.
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

// ──────────────────────────────────────────────────────────────────────────
// RareData — SQL socket-group accessors.
// ──────────────────────────────────────────────────────────────────────────

impl RareData {
    pub fn postgres_group(&mut self, vm: &VirtualMachine, ssl: bool) -> *mut bun_uws::SocketGroup {
        // SAFETY: `vm` is live; the Zig side lazily inits the embedded group.
        unsafe { Bun__RareData__postgresGroup(vm.as_mut_ptr() as *mut c_void, ssl) }
    }
    pub fn mysql_group(&mut self, vm: &VirtualMachine, ssl: bool) -> *mut bun_uws::SocketGroup {
        // SAFETY: `vm` is live; the Zig side lazily inits the embedded group.
        unsafe { Bun__RareData__mysqlGroup(vm.as_mut_ptr() as *mut c_void, ssl) }
    }
    pub fn ssl_ctx_cache(&mut self) -> &mut SslCtxCache {
        // SAFETY: returns `&rare.ssl_ctx_cache` — non-null while RareData lives.
        unsafe { &mut *Bun__RareData__sslCtxCache(VirtualMachine::get() as *mut c_void) }
    }
}
/// Opaque handle to `bun_runtime::api::SSLContextCache`.
#[repr(C)]
pub struct SslCtxCache { _opaque: core::cell::UnsafeCell<[u8; 0]> }
impl SslCtxCache {
    pub fn get_or_create_opts(
        &mut self,
        opts: bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<*mut bun_uws::SslCtx> {
        // SAFETY: `self` is `&rare.ssl_ctx_cache`; `opts` passed by value;
        // `err` is a valid out-param.
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
// KeepAlive — local mirror accepting the local `&VirtualMachine`.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum KeepAliveStatus { #[default] Inactive, Active, Done }

#[derive(Default)]
pub struct KeepAlive { status: KeepAliveStatus }
impl KeepAlive {
    pub fn ref_(&mut self, vm: &VirtualMachine) {
        if self.status != KeepAliveStatus::Inactive { return; }
        self.status = KeepAliveStatus::Active;
        // SAFETY: `vm` is live; FFI bumps the loop's active counter.
        unsafe { Bun__VM__loopRef(vm.as_mut_ptr() as *mut c_void) };
    }
    /// Back-compat alias for callers still spelling it `r#ref`.
    #[inline] pub fn r#ref(&mut self, vm: &VirtualMachine) { self.ref_(vm) }
    pub fn unref(&mut self, vm: &VirtualMachine) {
        if self.status != KeepAliveStatus::Active { return; }
        self.status = KeepAliveStatus::Inactive;
        // SAFETY: `vm` is live; FFI decrements the loop's active counter.
        unsafe { Bun__VM__loopUnref(vm.as_mut_ptr() as *mut c_void) };
    }
    pub fn disable(&mut self) {
        if self.status == KeepAliveStatus::Active {
            // SAFETY: thread-local VM is set on the JS thread.
            unsafe { Bun__VM__loopUnref(VirtualMachine::get() as *mut c_void) };
        }
        self.status = KeepAliveStatus::Done;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — JSC bindings (src/jsc/bindings/bindings.cpp) used by the
// extension traits / local types above.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // JSValue
    fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
        global: *mut JSGlobalObject, ptr: *mut u8, len: usize,
        ctx: *mut c_void,
        deallocator: Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>,
    ) -> JSValue;
    fn MarkedArrayBuffer_deallocator(bytes: *mut c_void, ctx: *mut c_void);
    fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) -> u64;
    fn JSC__isBigIntInInt64Range(this: JSValue, min: i64, max: i64) -> bool;
    fn JSC__isBigIntInUInt64Range(this: JSValue, min: u64, max: u64) -> bool;

    // JSGlobalObject
    fn JSC__JSGlobalObject__bunVM(this: *mut JSGlobalObject) -> *mut c_void;
    fn Bun__gregorianDateTimeToMS(
        global: *mut JSGlobalObject,
        year: c_int,
        month: c_int,
        day: c_int,
        hour: c_int,
        minute: c_int,
        second: c_int,
        millisecond: c_int,
        local_time: bool,
    ) -> f64;

    // MarkedArgumentBuffer
    fn MarkedArgumentBuffer__run(ctx: *mut c_void, f: extern "C" fn(*mut c_void, *mut c_void));

    // VirtualMachine accessors — TODO(port): export from Zig.
    fn Bun__getVM() -> *mut c_void;
    fn Bun__VirtualMachine__isShuttingDown(vm: *mut c_void) -> bool;
    fn Bun__VM__rareData(vm: *mut VirtualMachine) -> *mut RareData;
    fn Bun__VM__global(vm: *mut VirtualMachine) -> *mut JSGlobalObject;
    fn Bun__VM__eventLoop(vm: *mut VirtualMachine) -> *mut EventLoop;
    fn Bun__VM__timer(vm: *mut VirtualMachine) -> *mut TimerHeap;
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
    fn Bun__SSLContextCache__getOrCreateOpts(
        this: *mut c_void,
        opts: *const bun_uws::us_bun_socket_context_options_t,
        err: *mut c_int,
    ) -> *mut bun_uws::SslCtx;
    fn Bun__SSLConfig__fromJS(global: *mut JSGlobalObject, value: JSValue, out: *mut c_void) -> bool;
    fn Bun__SSLConfig__asUSocketsClient(this: *const c_void, out: *mut bun_uws::us_bun_socket_context_options_t);
}
