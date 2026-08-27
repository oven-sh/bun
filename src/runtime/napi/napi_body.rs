//! Node-API (N-API) implementation.
//!
//! Every `napi_*` entry point is exported through a generated `extern "C"`
//! thunk (`HOST_EXPORT`); the argument types spell the N-API contract for
//! the raw pointers an addon passes: a nullable `napi_env` is
//! `Option<&NapiEnv>`, an out-parameter is [`Out`], an owned handle given
//! back is a `Box`, a handle the addon keeps using is a [`ThisPtr`].

use core::cell::Cell;
use core::ffi::{c_char, c_uint, c_void};
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, AtomicI64, AtomicU8, AtomicU32, AtomicUsize, Ordering};

use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_event_loop::{BoxedTask, TaskHop};
use bun_io::KeepAlive;
use bun_jsc::StringJsc;
use bun_jsc::bun_string_jsc;
use bun_jsc::event_loop::{ConcurrentTaskItem as ConcurrentTask, EventLoop};
use bun_jsc::napi::{NapiEnv, NapiEnvRef, NapiHandleScope, UngatedScope};
use bun_jsc::rare_data::OwnedCleanupHook;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, Debugger, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, LoopKind,
    StrongOptional, VmHandle,
};
use bun_ptr::{JsCell, RefPtr, ThisPtr};
use bun_threading::Condition as Condvar;
use bun_threading::Guarded;
use bun_threading::work_pool::WorkPool;

bun_output::declare_scope!(napi, visible);

// ──────────────────────────────────────────────────────────────────────────
// NapiEnv
// ──────────────────────────────────────────────────────────────────────────

unsafe extern "C" {
    safe fn Bun__JSValue__isAsyncContextFrame(value: JSValue) -> bool;
    safe fn napi_set_last_error(env: Option<&NapiEnv>, status: NapiStatus) -> napi_status;
    safe fn napi_internal_cleanup_env_cpp(env: &NapiEnv);
    safe fn napi_internal_check_gc(env: &NapiEnv);
    /// Drops the env's bookkeeping entry for a finalizer that has run; the
    /// arguments are compared, not dereferenced.
    safe fn napi_internal_remove_finalizer(
        env: &NapiEnv,
        fun: napi_finalize,
        hint: *mut c_void,
        data: *mut c_void,
    );
    /// Returns false if the env has already torn down its registry. The
    /// registry holds the address only.
    safe fn NapiEnv__registerThreadSafeFunction(env: &NapiEnv, tsfn: *mut c_void) -> bool;
    safe fn NapiEnv__unregisterThreadSafeFunction(env: &NapiEnv, tsfn: *mut c_void);
}

fn is_async_context_frame(value: JSValue) -> bool {
    Bun__JSValue__isAsyncContextFrame(value)
}

/// The napi status helpers on an env (they set the env's last error too).
pub(crate) trait NapiEnvExt {
    fn env(&self) -> &NapiEnv;

    /// Convenience wrapper for set_last_error(.ok)
    fn ok(&self) -> napi_status {
        napi_set_last_error(Some(self.env()), NapiStatus::ok)
    }

    /// These wrappers exist for convenience and so we can set a breakpoint in lldb
    fn invalid_arg(&self) -> napi_status {
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(napi, "invalid arg");
        }
        napi_set_last_error(Some(self.env()), NapiStatus::invalid_arg)
    }

    fn generic_failure(&self) -> napi_status {
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(napi, "generic failure");
        }
        napi_set_last_error(Some(self.env()), NapiStatus::generic_failure)
    }

    fn pending_exception(&self) -> napi_status {
        napi_set_last_error(Some(self.env()), NapiStatus::pending_exception)
    }

    fn status(&self, status: NapiStatus) -> napi_status {
        napi_set_last_error(Some(self.env()), status)
    }

    /// Assert that we're not currently performing garbage collection
    fn check_gc(&self) {
        napi_internal_check_gc(self.env());
    }

    /// After a native addon callback (a `complete`, a finalizer, a `call_js`):
    /// what it raised through Node-API — latched on the env — or left on the VM
    /// is that call's exception, surfaced as `Err` with it pending on the VM.
    /// If both exist the VM's own wins and the latched one is discarded (it
    /// cannot be reported without running JS over the pending one).
    fn surface_exception(&self, global: &JSGlobalObject) -> JsResult<()> {
        let latched = self.env().get_and_clear_pending_exception();
        if global.has_exception() {
            return Err(jsc::JsError::Thrown);
        }
        match latched {
            Some(exception) => Err(global.throw_value(exception)),
            None => Ok(()),
        }
    }
}

impl NapiEnvExt for NapiEnv {
    #[inline]
    fn env(&self) -> &NapiEnv {
        self
    }
}

#[cold]
fn env_is_null() -> napi_status {
    // in this case we don't actually have an environment to set the last error on, so it doesn't
    // make sense to call napi_set_last_error
    NapiStatus::invalid_arg as napi_status
}

/// The `napi_env` an addon's callbacks receive. Entry points take
/// `Option<&NapiEnv>` instead: native modules may pass null, which is an error
/// they must get `napi_invalid_arg` for.
pub(crate) type napi_env = *mut NapiEnv;

/// An out-parameter: null when the addon does not want the value.
pub(crate) type Out<'a, T> = Option<&'a mut MaybeUninit<T>>;

pub(crate) type napi_handle_scope = *mut NapiHandleScope;
pub(crate) type napi_escapable_handle_scope = *mut NapiHandleScope;
pub(crate) type napi_deferred = *mut JSPromiseStrong;

// ──────────────────────────────────────────────────────────────────────────
// napi_value
// ──────────────────────────────────────────────────────────────────────────

/// To ensure napi_values are not collected prematurely after being returned into a native module,
/// you must use these functions rather than convert between napi_value and jsc::JSValue directly
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct napi_value(i64);

impl napi_value {
    pub(crate) fn get(self) -> JSValue {
        JSValue::from_encoded(self.0 as usize)
    }

    pub(crate) fn create(env: &NapiEnv, val: JSValue) -> napi_value {
        NapiHandleScope::append(env, val);
        napi_value(val.encoded() as i64)
    }
}

trait OutValue {
    fn set(&mut self, env: &NapiEnv, val: JSValue);
}
impl OutValue for MaybeUninit<napi_value> {
    fn set(&mut self, env: &NapiEnv, val: JSValue) {
        self.write(napi_value::create(env, val));
    }
}

pub(crate) type char16_t = u16;

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum napi_typedarray_type {
    int8_array = 0,
    uint8_array = 1,
    uint8_clamped_array = 2,
    int16_array = 3,
    uint16_array = 4,
    int32_array = 5,
    uint32_array = 6,
    float32_array = 7,
    float64_array = 8,
    bigint64_array = 9,
    biguint64_array = 10,
    float16_array = 11,
}

impl napi_typedarray_type {
    fn from_js_type(this: jsc::JSType) -> Option<napi_typedarray_type> {
        // Note: jsc::JSType is a newtype struct with associated consts (not an enum),
        // so glob-import is unavailable; match on the qualified const paths instead.
        Some(match this {
            jsc::JSType::Int8Array => napi_typedarray_type::int8_array,
            jsc::JSType::Uint8Array => napi_typedarray_type::uint8_array,
            jsc::JSType::Uint8ClampedArray => napi_typedarray_type::uint8_clamped_array,
            jsc::JSType::Int16Array => napi_typedarray_type::int16_array,
            jsc::JSType::Uint16Array => napi_typedarray_type::uint16_array,
            jsc::JSType::Int32Array => napi_typedarray_type::int32_array,
            jsc::JSType::Uint32Array => napi_typedarray_type::uint32_array,
            jsc::JSType::Float32Array => napi_typedarray_type::float32_array,
            jsc::JSType::Float64Array => napi_typedarray_type::float64_array,
            jsc::JSType::BigInt64Array => napi_typedarray_type::bigint64_array,
            jsc::JSType::BigUint64Array => napi_typedarray_type::biguint64_array,
            jsc::JSType::Float16Array => napi_typedarray_type::float16_array,
            _ => return None,
        })
    }
}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum NapiStatus {
    ok = 0,
    invalid_arg = 1,
    object_expected = 2,
    string_expected = 3,
    name_expected = 4,
    function_expected = 5,
    number_expected = 6,
    boolean_expected = 7,
    array_expected = 8,
    generic_failure = 9,
    pending_exception = 10,
    cancelled = 11,
    escape_called_twice = 12,
    handle_scope_mismatch = 13,
    callback_scope_mismatch = 14,
    queue_full = 15,
    closing = 16,
    bigint_expected = 17,
    date_expected = 18,
    arraybuffer_expected = 19,
    detachable_arraybuffer_expected = 20,
    would_deadlock = 21,
    no_external_buffers_allowed = 22,
    cannot_run_js = 23,
}

/// This is not an `enum` so that the enum values cannot be trivially returned from NAPI functions,
/// as that would skip storing the last error code. You should wrap return values in a call to
/// NapiEnv::set_last_error.
pub(crate) type napi_status = c_uint;

/// expects `napi_env`, `callback_data`, `context`
pub(crate) type NapiFinalizeFunction = extern "C" fn(napi_env, *mut c_void, *mut c_void);
pub(crate) type napi_finalize = Option<NapiFinalizeFunction>;

// ──────────────────────────────────────────────────────────────────────────
// Helper macros: unwrap nullable env / nullable out-param
// ──────────────────────────────────────────────────────────────────────────

macro_rules! get_env {
    ($env:expr) => {
        match $env {
            Some(e) => e,
            None => return env_is_null(),
        }
    };
}

/// Like `get_env!` but also returns `napi_pending_exception` if a JS exception
/// is pending on the env (mirrors Node's `NAPI_PREAMBLE`). Use this for napi
/// entry points that can execute JS or have observable side effects.
macro_rules! preamble {
    ($env:expr) => {{
        let env = get_env!($env);
        if env.has_pending_exception() {
            return env.pending_exception();
        }
        env
    }};
}

/// `get_env!`, then the rest of the function runs under napi.cpp's `NapiUngatedScope` (which see): no JS or addon code.
macro_rules! ungated {
    ($env:ident, $raw:expr) => {
        let $env = get_env!($raw);
        let mut napi_ungated_storage = MaybeUninit::<UngatedScope>::uninit();
        let _napi_ungated_scope = UngatedScope::enter(&mut napi_ungated_storage, $env);
    };
}

macro_rules! get_out {
    ($env:expr, $ptr:expr) => {
        match $ptr {
            Some(r) => r,
            None => return $env.invalid_arg(),
        }
    };
}

/// Write `v` through an optional N-API out-param (`NULL`: the caller doesn't
/// want this field).
#[inline]
fn write_out<T>(p: Out<'_, T>, v: T) {
    if let Some(p) = p {
        p.write(v);
    }
}

const NAPI_AUTO_LENGTH: usize = usize::MAX;

/// The code units an N-API `(const T* str, size_t length)` argument pair
/// denotes: `length` of them, or up to the NUL when `length` is
/// `NAPI_AUTO_LENGTH`.
///
/// # Safety
/// The N-API contract for string arguments: `ptr` is NUL-terminated when
/// `len == NAPI_AUTO_LENGTH` and valid for `len` reads otherwise, for `'a`.
unsafe fn napi_units<'a, T: Copy + PartialEq + Default>(ptr: NonNull<T>, len: usize) -> &'a [T] {
    let ptr = ptr.as_ptr().cast_const();
    // SAFETY: fn contract.
    unsafe {
        let len = if len != NAPI_AUTO_LENGTH {
            len
        } else if core::mem::size_of::<T>() == 1 {
            bun_core::ffi::cstr(ptr.cast::<c_char>()).to_bytes().len()
        } else {
            let mut n = 0;
            while *ptr.add(n) != T::default() {
                n += 1;
            }
            n
        };
        bun_core::ffi::slice(ptr, len)
    }
}

/// `napi_create_string_*`'s reading of its `(str, length)` arguments: a null
/// `str` is the empty string if `length` is 0, and lengths over `INT_MAX` are
/// refused, as in Node.
fn string_argument<'a, T>(
    ptr: *const T,
    len: usize,
    units: impl FnOnce(NonNull<T>) -> &'a [T],
) -> Option<&'a [T]> {
    match NonNull::new(ptr.cast_mut()) {
        None => (len == 0).then_some(&[]),
        Some(_) if len != NAPI_AUTO_LENGTH && len > i32::MAX as usize => None,
        Some(ptr) => Some(units(ptr)),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Exported NAPI functions (the rest are C++, napi.cpp)
// ──────────────────────────────────────────────────────────────────────────

// HOST_EXPORT(napi_get_undefined, c)
pub fn napi_get_undefined(env_: Option<&NapiEnv>, result_: Out<napi_value>) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_undefined");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::UNDEFINED);
    env.ok()
}

// HOST_EXPORT(napi_get_null, c)
pub fn napi_get_null(env_: Option<&NapiEnv>, result_: Out<napi_value>) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_null");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::NULL);
    env.ok()
}

// HOST_EXPORT(napi_get_boolean, c)
pub fn napi_get_boolean(
    env_: Option<&NapiEnv>,
    value: bool,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_boolean");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::from(value));
    env.ok()
}

// HOST_EXPORT(napi_create_array, c)
pub fn napi_create_array(env_: Option<&NapiEnv>, result_: Out<napi_value>) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_array");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let arr = match JSValue::create_empty_array(env.to_js(), 0) {
        Ok(v) => v,
        Err(_) => return env.status(NapiStatus::pending_exception),
    };
    result.set(env, arr);
    env.ok()
}

// HOST_EXPORT(napi_create_array_with_length, c)
pub fn napi_create_array_with_length(
    env_: Option<&NapiEnv>,
    length: usize,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_array_with_length");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);

    // https://github.com/nodejs/node/blob/14c68e3b536798e25f810ed7ae180a5cde9e47d3/deps/v8/src/api/api.cc#L8163-L8174
    // size_t immediately cast to int as argument to Array::New, then min 0
    // Bit-reinterpret usize as i64 (same width on 64-bit targets).
    let len_i64: i64 = length as i64;
    let len_i32: i32 = len_i64 as i32; // intentional truncation
    let len: u32 = if len_i32 > 0 { len_i32 as u32 } else { 0 };

    let array = match JSValue::create_empty_array(env.to_js(), len as usize) {
        Ok(v) => v,
        Err(_) => return env.status(NapiStatus::pending_exception),
    };
    array.ensure_still_alive();
    result.set(env, array);
    env.ok()
}

// HOST_EXPORT(napi_create_int32, c)
pub fn napi_create_int32(
    env_: Option<&NapiEnv>,
    value: i32,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_int32");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value as f64));
    env.ok()
}

// HOST_EXPORT(napi_create_uint32, c)
pub fn napi_create_uint32(
    env_: Option<&NapiEnv>,
    value: u32,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_uint32");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value as f64));
    env.ok()
}

// HOST_EXPORT(napi_create_int64, c)
pub fn napi_create_int64(
    env_: Option<&NapiEnv>,
    value: i64,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_int64");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value as f64));
    env.ok()
}

// HOST_EXPORT(napi_create_string_latin1, c)
pub fn napi_create_string_latin1(
    env_: Option<&NapiEnv>,
    str_: *const u8,
    length: usize,
    result_: Out<napi_value>,
) -> napi_status {
    ungated!(env, env_);
    let result = get_out!(env, result_);

    // SAFETY: the addon's string argument (N-API contract).
    let Some(slice) = string_argument(str_, length, |p| unsafe { napi_units(p, length) }) else {
        return env.invalid_arg();
    };

    bun_output::scoped_log!(
        napi,
        "napi_create_string_latin1: {}",
        bstr::BStr::new(slice)
    );

    if slice.is_empty() {
        result.set(env, JSValue::js_empty_string(env.to_js()));
        return env.ok();
    }

    let (string, bytes) = bun_core::String::create_uninitialized_latin1(slice.len());
    bytes.copy_from_slice(slice);

    let js = match string.into_js(env.to_js()) {
        Ok(v) => v,
        Err(_) => return env.status(NapiStatus::generic_failure),
    };
    result.set(env, js);
    env.ok()
}

// HOST_EXPORT(napi_create_string_utf8, c)
pub fn napi_create_string_utf8(
    env_: Option<&NapiEnv>,
    str_: *const u8,
    length: usize,
    result_: Out<napi_value>,
) -> napi_status {
    ungated!(env, env_);
    let result = get_out!(env, result_);

    // SAFETY: the addon's string argument (N-API contract).
    let Some(slice) = string_argument(str_, length, |p| unsafe { napi_units(p, length) }) else {
        return env.invalid_arg();
    };

    bun_output::scoped_log!(napi, "napi_create_string_utf8: {}", bstr::BStr::new(slice));

    let global_object = env.to_js();
    let string = match bun_string_jsc::create_utf8_for_js(global_object, slice) {
        Ok(v) => v,
        Err(_) => return env.generic_failure(),
    };
    result.set(env, string);
    env.ok()
}

// HOST_EXPORT(napi_create_string_utf16, c)
pub fn napi_create_string_utf16(
    env_: Option<&NapiEnv>,
    str_: *const char16_t,
    length: usize,
    result_: Out<napi_value>,
) -> napi_status {
    ungated!(env, env_);
    let result = get_out!(env, result_);

    // SAFETY: the addon's string argument (N-API contract).
    let Some(slice) = string_argument(str_, length, |p| unsafe { napi_units(p, length) }) else {
        return env.invalid_arg();
    };

    if cfg!(debug_assertions) {
        bun_output::scoped_log!(
            napi,
            "napi_create_string_utf16: {} {}",
            slice.len(),
            bun_core::fmt::utf16(&slice[..slice.len().min(512)])
        );
    }

    if slice.is_empty() {
        result.set(env, JSValue::js_empty_string(env.to_js()));
        return env.ok();
    }

    let (string, chars) = bun_core::String::create_uninitialized_utf16(slice.len());
    chars.copy_from_slice(slice);

    let js = match string.into_js(env.to_js()) {
        Ok(v) => v,
        Err(_) => return env.status(NapiStatus::generic_failure),
    };
    result.set(env, js);
    env.ok()
}

// HOST_EXPORT(napi_get_prototype, c)
pub fn napi_get_prototype(
    env_: Option<&NapiEnv>,
    object_: napi_value,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_prototype");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    let object = object_.get();
    if object.is_empty() {
        return env.invalid_arg();
    }
    // Node's CHECK_TO_OBJECT: ToObject throws on null/undefined; leave the
    // TypeError pending and return napi_object_expected. Other primitives are
    // coerced, so `get_prototype` (which synthesizes the prototype for
    // non-object values) handles them without an allocation.
    if object.is_undefined_or_null() {
        let _ = object.to_object(env.to_js());
        return env.status(NapiStatus::object_expected);
    }

    // Like V8's Object::GetPrototype: a Proxy yields null and its trap never runs.
    if object.js_type() == jsc::JSType::ProxyObject {
        result.set(env, JSValue::NULL);
        return env.ok();
    }
    let prototype = match object.get_prototype(env.to_js()) {
        Ok(prototype) => prototype,
        Err(_) => return env.pending_exception(),
    };
    result.set(env, prototype);
    env.ok()
}

// HOST_EXPORT(napi_is_array, c)
pub fn napi_is_array(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Out<bool>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_array");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    result.write(value.js_type().is_array());
    env.ok()
}

// HOST_EXPORT(napi_get_array_length, c)
pub fn napi_get_array_length(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Out<u32>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_array_length");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }

    if !value.js_type().is_array() {
        return env.status(NapiStatus::array_expected);
    }

    result.write(match value.get_length(env.to_js()) {
        Ok(len) => len as u32, // intentional truncation
        Err(_) => return env.status(NapiStatus::pending_exception),
    });
    env.ok()
}

// HOST_EXPORT(napi_strict_equals, c)
pub fn napi_strict_equals(
    env_: Option<&NapiEnv>,
    lhs_: napi_value,
    rhs_: napi_value,
    result_: Out<bool>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_strict_equals");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    let (lhs, rhs) = (lhs_.get(), rhs_.get());
    if lhs.is_empty() || rhs.is_empty() {
        return env.invalid_arg();
    }
    result.write(match lhs.is_strict_equal(rhs, env.to_js()) {
        Ok(b) => b,
        Err(_) => return env.status(NapiStatus::pending_exception),
    });
    env.ok()
}

// HOST_EXPORT(napi_open_handle_scope, c)
pub fn napi_open_handle_scope(
    env_: Option<&NapiEnv>,
    result_: Out<napi_handle_scope>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.write(NapiHandleScope::open(env, false));
    env.ok()
}

// HOST_EXPORT(napi_close_handle_scope, c)
pub fn napi_close_handle_scope(
    env_: Option<&NapiEnv>,
    handle_scope: Option<&NapiHandleScope>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    if let Some(handle_scope) = handle_scope {
        NapiHandleScope::close(Some(handle_scope), env);
    }
    env.ok()
}

// we don't support async contexts
// HOST_EXPORT(napi_async_init, c)
pub fn napi_async_init(
    env_: Option<&NapiEnv>,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    async_ctx_: Out<*mut c_void>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_init");
    let env = get_env!(env_);
    let async_ctx = get_out!(env, async_ctx_);
    async_ctx.write(env.as_mut_ptr().cast::<c_void>());
    env.ok()
}

// we don't support async contexts
// HOST_EXPORT(napi_async_destroy, c)
pub fn napi_async_destroy(env_: Option<&NapiEnv>, _async_ctx: *mut c_void) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_destroy");
    let env = get_env!(env_);
    env.ok()
}

// this is just a regular function call
// HOST_EXPORT(napi_make_callback, c)
pub fn napi_make_callback(
    env_: Option<&NapiEnv>,
    _async_ctx: *mut c_void,
    recv_: napi_value,
    func_: napi_value,
    arg_count: usize,
    args: *const napi_value,
    maybe_result: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_make_callback");
    let env = preamble!(env_);
    let (recv, func) = (recv_.get(), func_.get());
    if recv.is_empty() {
        return env.invalid_arg();
    }
    if arg_count > 0 && args.is_null() {
        return env.invalid_arg();
    }
    if func.is_empty_or_undefined_or_null()
        || (!func.is_callable() && !is_async_context_frame(func))
    {
        return env.invalid_arg();
    }

    let this_value = recv;
    let args_slice: &[JSValue] = if arg_count > 0 {
        // SAFETY: napi_value is repr(transparent) over i64, same as JSValue; the
        // arg_count > 0 && args.is_null() case returned napi_invalid_arg above,
        // and caller guarantees [args, args+arg_count) is valid.
        unsafe { bun_core::ffi::slice(args.cast::<JSValue>(), arg_count) }
    } else {
        &[]
    };

    // Node.js returns napi_pending_exception iff the callback threw, leaves the
    // exception pending for napi_is_exception_pending / napi_get_and_clear_last_exception,
    // and does not write *result in that case. A callback that *returns* an Error
    // without throwing is napi_ok.
    let res = match func.call(env.to_js(), this_value, args_slice) {
        Ok(v) => v,
        Err(_) => return env.pending_exception(),
    };

    if let Some(result) = maybe_result {
        result.set(env, res);
    }

    env.ok()
}

// HOST_EXPORT(napi_open_escapable_handle_scope, c)
pub fn napi_open_escapable_handle_scope(
    env_: Option<&NapiEnv>,
    result_: Out<napi_escapable_handle_scope>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_escapable_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.write(NapiHandleScope::open(env, true));
    env.ok()
}

// HOST_EXPORT(napi_close_escapable_handle_scope, c)
pub fn napi_close_escapable_handle_scope(
    env_: Option<&NapiEnv>,
    scope: Option<&NapiHandleScope>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_escapable_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    if let Some(scope) = scope {
        NapiHandleScope::close(Some(scope), env);
    }
    env.ok()
}

// HOST_EXPORT(napi_escape_handle, c)
pub fn napi_escape_handle(
    env_: Option<&NapiEnv>,
    scope_: Option<&NapiHandleScope>,
    escapee: napi_value,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_escape_handle");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let Some(scope) = scope_ else {
        return env.invalid_arg();
    };
    if scope.escape(escapee.get()).is_err() {
        return env.status(NapiStatus::escape_called_twice);
    }
    result.write(escapee);
    env.ok()
}

// do nothing for both of these
// HOST_EXPORT(napi_open_callback_scope, c)
pub fn napi_open_callback_scope(
    _env: Option<&NapiEnv>,
    _resource: napi_value,
    _context: *mut c_void,
    _result: *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_callback_scope");
    NapiStatus::ok as napi_status
}

// HOST_EXPORT(napi_close_callback_scope, c)
pub fn napi_close_callback_scope(_env: Option<&NapiEnv>, _scope: *mut c_void) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_callback_scope");
    NapiStatus::ok as napi_status
}

// HOST_EXPORT(napi_is_error, c)
pub fn napi_is_error(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Out<bool>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_error");
    ungated!(env, env_);
    env.check_gc();
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    let result = get_out!(env, result_);
    result.write(value.is_any_error());
    env.ok()
}

// HOST_EXPORT(napi_is_arraybuffer, c)
pub fn napi_is_arraybuffer(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Out<bool>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_arraybuffer");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    // A SharedArrayBuffer shares the `ArrayBuffer` cell type with a plain
    // ArrayBuffer in JSC, so `js_type` alone can't tell them apart. Node's
    // `napi_is_arraybuffer` maps to V8's `IsArrayBuffer()`, which is false for
    // SharedArrayBuffer, so exclude shared buffers here too.
    result.write(
        value
            .as_array_buffer(env.to_js())
            .is_some_and(|ab| ab.typed_array_type == jsc::JSType::ArrayBuffer && !ab.shared),
    );
    env.ok()
}

// HOST_EXPORT(napi_get_arraybuffer_info, c)
pub fn napi_get_arraybuffer_info(
    env_: Option<&NapiEnv>,
    arraybuffer_: napi_value,
    data: Out<*mut u8>,
    byte_length: Out<usize>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_arraybuffer_info");
    ungated!(env, env_);
    env.check_gc();
    let arraybuffer = arraybuffer_.get();
    let Some(array_buffer) = arraybuffer.as_array_buffer(env.to_js()) else {
        return env.status(NapiStatus::invalid_arg);
    };
    if array_buffer.typed_array_type != jsc::JSType::ArrayBuffer {
        return env.status(NapiStatus::invalid_arg);
    }

    write_out(data, array_buffer.ptr);
    write_out(byte_length, array_buffer.byte_len);
    env.ok()
}

// HOST_EXPORT(napi_get_typedarray_info, c)
pub fn napi_get_typedarray_info(
    env_: Option<&NapiEnv>,
    typedarray_: napi_value,
    maybe_type: Out<napi_typedarray_type>,
    maybe_length: Out<usize>,
    maybe_data: Out<*mut u8>,
    maybe_arraybuffer: Out<napi_value>,
    maybe_byte_offset: Out<usize>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_typedarray_info");
    ungated!(env, env_);
    env.check_gc();
    let typedarray = typedarray_.get();
    if typedarray.is_empty_or_undefined_or_null() {
        return env.invalid_arg();
    }
    let _keep = jsc::EnsureStillAlive(typedarray);

    // Keep the pointer valid for the view's lifetime, as in Node: the
    // arraybuffer out-param below would otherwise invalidate it.
    if maybe_data.is_some() && !typedarray.materialize_array_buffer_view_buffer() {
        return env.generic_failure();
    }

    let Some(array_buffer) = typedarray.as_array_buffer(env.to_js()) else {
        return env.invalid_arg();
    };
    if let Some(ty) = maybe_type {
        // The `ArrayBuffer.typed_array_type` field is already a `JSType`, so map it
        // straight to `napi_typedarray_type`.
        let Some(napi_ty) = napi_typedarray_type::from_js_type(array_buffer.typed_array_type)
        else {
            return env.invalid_arg();
        };
        ty.write(napi_ty);
    }

    // TODO: handle detached
    write_out(maybe_data, array_buffer.ptr);
    write_out(maybe_length, array_buffer.len);

    if let Some(arraybuffer) = maybe_arraybuffer {
        arraybuffer.set(env, typedarray.get_array_buffer_view_buffer(env.to_js()));
    }

    if let Some(byte_offset) = maybe_byte_offset {
        byte_offset.write(typedarray.get_array_buffer_view_byte_offset());
    }
    env.ok()
}

// HOST_EXPORT(napi_is_dataview, c)
pub fn napi_is_dataview(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Out<bool>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_dataview");
    ungated!(env, env_);
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    result.write(
        !value.is_empty_or_undefined_or_null() && value.js_type_loose() == jsc::JSType::DataView,
    );
    env.ok()
}

// HOST_EXPORT(napi_get_dataview_info, c)
pub fn napi_get_dataview_info(
    env_: Option<&NapiEnv>,
    dataview_: napi_value,
    maybe_bytelength: Out<usize>,
    maybe_data: Out<*mut u8>,
    maybe_arraybuffer: Out<napi_value>,
    maybe_byte_offset: Out<usize>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_dataview_info");
    ungated!(env, env_);
    env.check_gc();
    let dataview = dataview_.get();
    if dataview.is_empty() {
        return env.invalid_arg();
    }
    let Some(array_buffer) = dataview.as_array_buffer(env.to_js()) else {
        return env.status(NapiStatus::object_expected);
    };
    write_out(maybe_bytelength, array_buffer.byte_len);
    write_out(maybe_data, array_buffer.ptr);
    if let Some(arraybuffer) = maybe_arraybuffer {
        arraybuffer.set(env, dataview.get_array_buffer_view_buffer(env.to_js()));
    }
    if let Some(byte_offset) = maybe_byte_offset {
        byte_offset.write(dataview.get_array_buffer_view_byte_offset());
    }

    env.ok()
}

// HOST_EXPORT(napi_get_version, c)
pub fn napi_get_version(env_: Option<&NapiEnv>, result_: Out<u32>) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_version");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // The result is supposed to be the highest NAPI version Bun supports, rather than the version reported by a NAPI module.
    // Keep this in sync with process.versions.napi in BunProcess.cpp.
    result.write(10);
    env.ok()
}

// HOST_EXPORT(napi_create_promise, c)
pub fn napi_create_promise(
    env_: Option<&NapiEnv>,
    deferred_: Out<napi_deferred>,
    promise_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_promise");
    let env = preamble!(env_);
    let deferred = get_out!(env, deferred_);
    let promise = get_out!(env, promise_);
    let strong = Box::new(JSPromiseStrong::init(env.to_js()));
    let prom_value = strong.get().as_value(env.to_js());
    // Owned by the addon until `napi_resolve_deferred` / `napi_reject_deferred`.
    deferred.write(bun_core::heap::into_raw(strong));
    promise.set(env, prom_value);
    env.ok()
}

// HOST_EXPORT(napi_resolve_deferred, c)
pub fn napi_resolve_deferred(
    env_: Option<&NapiEnv>,
    deferred: Option<ManuallyDrop<Box<JSPromiseStrong>>>,
    resolution_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_resolve_deferred");
    let env = preamble!(env_);
    let Some(deferred) = deferred else {
        return env.invalid_arg();
    };
    // Ours again (allocated in `napi_create_promise`); freed at scope exit.
    let deferred = ManuallyDrop::into_inner(deferred);
    let resolution = resolution_.get();
    let prom = deferred.get();
    if prom.resolve(env.to_js(), resolution).is_err() {
        return env.generic_failure();
    }
    env.ok()
}

// HOST_EXPORT(napi_reject_deferred, c)
pub fn napi_reject_deferred(
    env_: Option<&NapiEnv>,
    deferred: Option<ManuallyDrop<Box<JSPromiseStrong>>>,
    rejection_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_reject_deferred");
    let env = preamble!(env_);
    let Some(deferred) = deferred else {
        return env.invalid_arg();
    };
    let deferred = ManuallyDrop::into_inner(deferred);
    let rejection = rejection_.get();
    let prom = deferred.get();
    if prom.reject(env.to_js(), Ok(rejection)).is_err() {
        return env.generic_failure();
    }
    env.ok()
}

// HOST_EXPORT(napi_is_promise, c)
pub fn napi_is_promise(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    is_promise_: Out<bool>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_promise");
    ungated!(env, env_);
    env.check_gc();
    let value = value_.get();
    let is_promise = get_out!(env, is_promise_);

    if value.is_empty() {
        return env.invalid_arg();
    }

    is_promise.write(value.as_any_promise().is_some());
    env.ok()
}

// HOST_EXPORT(napi_create_date, c)
pub fn napi_create_date(
    env_: Option<&NapiEnv>,
    time: f64,
    result_: Out<napi_value>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_date");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    result.set(
        env,
        JSValue::from_date_number(env.to_js(), JSValue::purify_nan(time)),
    );
    env.ok()
}

// HOST_EXPORT(napi_is_date, c)
pub fn napi_is_date(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    is_date_: Out<bool>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_date");
    ungated!(env, env_);
    env.check_gc();
    let is_date = get_out!(env, is_date_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    is_date.write(value.js_type_loose() == jsc::JSType::JSDate);
    env.ok()
}

// ──────────────────────────────────────────────────────────────────────────
// napi_async_work
// ──────────────────────────────────────────────────────────────────────────

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AsyncWorkStatus {
    Pending = 0,
    Started = 1,
    Completed = 2,
    Cancelled = 3,
}

/// The addon holds a reference from `napi_create_async_work` until
/// `napi_delete_async_work`; the pool holds one while the work is out on it
/// (`schedule` → `run_work_task`), which then rides the completion back to the
/// JS thread (`completion_ref`) so the work is only ever freed there. While it
/// is out on the pool, the pool side takes `ticket`, runs `execute` with
/// `env`/`data`, updates `status` (atomic; `cancel` races it from the JS
/// thread) and posts through `concurrent_task`; the JS thread leaves those be
/// until the completion arrives and owns `scheduled` / `poll_ref` throughout.
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct napi_async_work {
    ref_count: bun_ptr::ThreadSafeRefCount<napi_async_work>,
    /// The pool's node while the work is out on it.
    task: bun_threading::SharedWorkNode,
    /// The completion's node (pool → JS thread).
    concurrent_task: Cell<ConcurrentTask>,
    /// The queued completion's reference (the one the pool held), dropped on
    /// the JS thread once `complete` has run.
    completion_ref: Cell<Option<RefPtr<napi_async_work>>>,
    /// Held while the work is out on the pool (`schedule` until it is posted
    /// back): how the pool thread delivers completion / cancellation, and what
    /// makes the VM wait for it.
    ticket: Cell<Option<bun_jsc::Ticket>>,
    env: NapiEnvRef,
    execute: napi_async_execute_callback,
    complete: Option<napi_async_complete_callback>,
    data: *mut c_void,
    status: AtomicU32, // AsyncWorkStatus
    /// JS thread only.
    scheduled: Cell<bool>,
    /// JS thread only.
    poll_ref: Cell<KeepAlive>,
}

// Pool side / JS side split as documented on the struct; the pool's reference
// is dropped on the JS thread (`run_from_js` / `release_unrun`).
bun_threading::shared_work_task!(napi_async_work, task);

bun_event_loop::task_hop! {
    /// `task_tag::NapiAsyncWork`: the pool is done with a queued work; run its
    /// `complete` on the JS thread. The queued task holds `completion_ref`.
    pub(crate) AsyncWorkCompletion for napi_async_work => NapiAsyncWork;
    run = napi_async_work::run_from_js;
    release_unrun = napi_async_work::release_unrun;
}

impl napi_async_work {
    pub(crate) fn new(
        env: &NapiEnv,
        execute: napi_async_execute_callback,
        complete: Option<napi_async_complete_callback>,
        data: *mut c_void,
    ) -> RefPtr<napi_async_work> {
        RefPtr::new(napi_async_work {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            task: bun_threading::SharedWorkNode::new::<Self>(),
            concurrent_task: Cell::new(ConcurrentTask::default()),
            completion_ref: Cell::new(None),
            env: env.to_ref(),
            execute,
            ticket: Cell::new(None),
            complete,
            data,
            status: AtomicU32::new(AsyncWorkStatus::Pending as u32),
            scheduled: Cell::new(false),
            poll_ref: Cell::new(KeepAlive::default()),
        })
    }

    /// JS thread.
    pub(crate) fn schedule(this: ThisPtr<Self>) {
        if this.scheduled.get() {
            return;
        }
        this.scheduled.set(true);
        let mut poll_ref = this.poll_ref.take();
        poll_ref.ref_(bun_io::js_vm_ctx());
        this.poll_ref.set(poll_ref);
        // `execute` receives this env, so the VM waits for it (Node likewise
        // settles its threadpool requests before an environment is freed).
        this.ticket.set(Some(this.env.to_js().bun_vm().ticket()));
        WorkPool::schedule_shared(RefPtr::from_this(this));
    }

    pub(crate) fn cancel(&self) -> bool {
        self.status
            .compare_exchange(
                AsyncWorkStatus::Pending as u32,
                AsyncWorkStatus::Cancelled as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    /// Work the pool handed back during teardown: its `complete` callback is
    /// how the addon learns the outcome and frees the work (Node calls it from
    /// environment cleanup too); script it tries to run is refused at the
    /// boundary. `Err` is left pending for the release dispatcher's fold.
    fn release_unrun(this: ThisPtr<Self>) {
        let _ = Self::run_from_js(this);
    }

    /// JS thread: run `complete`, then drop the completion's reference.
    fn run_from_js(this: ThisPtr<Self>) -> JsResult<()> {
        let _completion = this.completion_ref.take();
        let mut poll_ref = this.poll_ref.take();
        // KeepAlive::unref needs an event-loop ctx so it cannot impl Drop
        // generically; this is a genuine one-off cleanup.
        scopeguard::defer! { poll_ref.unref(bun_io::js_vm_ctx()); }

        // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1201
        let Some(complete) = this.complete else {
            return Ok(());
        };
        let env = this.env.clone();
        let data = this.data;
        let status: NapiStatus =
            if this.status.load(Ordering::SeqCst) == AsyncWorkStatus::Cancelled as u32 {
                NapiStatus::cancelled
            } else {
                NapiStatus::ok
            };

        let _hs = NapiHandleScope::open_scoped(&env);
        complete(env.get(), status as napi_status, data);
        env.surface_exception(env.to_js())
    }

    /// Pool thread: run `execute` (unless the VM is already stopping, which
    /// cancels work it has not started, as Node's environment cleanup does
    /// with `uv_cancel`) and post the work back to the JS thread for
    /// `complete`, handing the pool's reference over to that completion.
    fn run_work_task(this: RefPtr<Self>) {
        // Moved out: the JS thread may consume the completion the moment it is
        // posted.
        let ticket = this
            .ticket
            .take()
            .expect("scheduled napi async work holds a ticket");
        let started = ticket.script_allowed()
            && match this.status.compare_exchange(
                AsyncWorkStatus::Pending as u32,
                AsyncWorkStatus::Started as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => true,
                Err(state) => state != AsyncWorkStatus::Cancelled as u32,
            };
        if started {
            (this.execute)(this.env.get(), this.data);
            this.status
                .store(AsyncWorkStatus::Completed as u32, Ordering::SeqCst);
        } else {
            let _ = this.cancel();
        }
        // A VM tearing down runs `complete` from its queue release (status
        // cancelled if `execute` never ran), as Node does at environment cleanup.
        let mut node = ConcurrentTask::default();
        node.from_task(AsyncWorkCompletion::task(this.this_ptr()));
        this.concurrent_task.set(node);
        let work = this.this_ptr();
        let carrier = NonNull::new(work.concurrent_task.as_ptr()).expect("field address");
        work.completion_ref.set(Some(this));
        ticket.post(carrier);
    }
}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum napi_threadsafe_function_release_mode {
    release = 0,
    abort = 1,
}

const NAPI_TSFN_BLOCKING: c_uint = 1;
pub(crate) type napi_threadsafe_function_call_mode = c_uint;
pub(crate) type napi_async_execute_callback = extern "C" fn(napi_env, *mut c_void);
pub(crate) type napi_async_complete_callback = extern "C" fn(napi_env, napi_status, *mut c_void);
pub(crate) type napi_threadsafe_function_call_js =
    extern "C" fn(napi_env, napi_value, *mut c_void, *mut c_void);

#[repr(C)]
pub struct napi_node_version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    /// `const char*`, a static literal.
    pub release: bun_core::SyncCStr,
}

// Splits "MAJOR.MINOR.PATCH" into u32 components at compile time.
const fn parse_semver_component(s: &str, idx: usize) -> u32 {
    let bytes = s.as_bytes();
    let mut i = 0usize;
    let mut field = 0usize;
    // advance to the requested dot-separated field
    while field < idx {
        while i < bytes.len() && bytes[i] != b'.' {
            i += 1;
        }
        i += 1; // skip '.'
        field += 1;
    }
    let mut n: u32 = 0;
    while i < bytes.len() && bytes[i] != b'.' {
        n = n * 10 + (bytes[i] - b'0') as u32;
        i += 1;
    }
    n
}

static NAPI_NODE_VERSION_GLOBAL: napi_node_version = napi_node_version {
    major: parse_semver_component(bun_core::Environment::REPORTED_NODEJS_VERSION, 0),
    minor: parse_semver_component(bun_core::Environment::REPORTED_NODEJS_VERSION, 1),
    patch: parse_semver_component(bun_core::Environment::REPORTED_NODEJS_VERSION, 2),
    release: bun_core::SyncCStr(c"node".as_ptr()),
};

// HOST_EXPORT(napi_fatal_error, c)
pub fn napi_fatal_error(
    location_ptr: *const u8,
    location_len: usize,
    message_ptr: *const u8,
    message_len_: usize,
) -> ! {
    bun_output::scoped_log!(napi, "napi_fatal_error");
    napi_internal_suppress_crash_on_abort_if_desired();
    // SAFETY: the addon's string arguments (N-API contract); null is absent.
    let (location, message) = unsafe {
        (
            NonNull::new(location_ptr.cast_mut()).map_or(&b""[..], |p| napi_units(p, location_len)),
            NonNull::new(message_ptr.cast_mut()).map_or(&b""[..], |p| napi_units(p, message_len_)),
        )
    };
    let message: &[u8] = if message.is_empty() {
        b"fatal error"
    } else {
        message
    };
    if !location.is_empty() {
        bun_core::Output::panic(format_args!(
            "NAPI FATAL ERROR: {} {}",
            bstr::BStr::new(location),
            bstr::BStr::new(message)
        ));
    }

    bun_core::Output::panic(format_args!("napi: {}", bstr::BStr::new(message)));
}

// HOST_EXPORT(napi_get_buffer_info, c)
pub fn napi_get_buffer_info(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    data: Out<*mut u8>,
    length: Out<usize>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_buffer_info");
    ungated!(env, env_);
    let value = value_.get();
    // Keep the pointer valid for the buffer's lifetime, as in Node.
    if data.is_some() && !value.materialize_array_buffer_view_buffer() {
        return env.generic_failure();
    }
    let Some(array_buf) = value.as_array_buffer(env.to_js()) else {
        return env.status(NapiStatus::invalid_arg);
    };
    // node::Buffer::HasInstance is IsArrayBufferView: reject a bare ArrayBuffer.
    if array_buf.typed_array_type == jsc::JSType::ArrayBuffer {
        return env.status(NapiStatus::invalid_arg);
    }

    write_out(data, array_buf.ptr);
    write_out(length, array_buf.byte_len);

    env.ok()
}

// HOST_EXPORT(napi_create_async_work, c)
pub fn napi_create_async_work(
    env_: Option<&NapiEnv>,
    _async_resource: napi_value,
    _async_resource_name: *const c_char,
    execute_: Option<napi_async_execute_callback>,
    complete: Option<napi_async_complete_callback>,
    data: *mut c_void,
    result_: Out<*mut napi_async_work>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_async_work");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1245
    let Some(execute) = execute_ else {
        return env.invalid_arg();
    };
    // The addon's reference, until `napi_delete_async_work`.
    result.write(RefPtr::into_raw(napi_async_work::new(
        env, execute, complete, data,
    )));
    env.ok()
}

// HOST_EXPORT(napi_delete_async_work, c)
pub fn napi_delete_async_work(
    env_: Option<&NapiEnv>,
    work_: Option<ManuallyDrop<RefPtr<napi_async_work>>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_delete_async_work");
    let env = get_env!(env_);
    let Some(work) = work_ else {
        return env.invalid_arg();
    };
    drop(ManuallyDrop::into_inner(work));
    env.ok()
}

// HOST_EXPORT(napi_queue_async_work, c)
pub fn napi_queue_async_work(
    env_: Option<&NapiEnv>,
    work_: Option<ThisPtr<napi_async_work>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_queue_async_work");
    let env = get_env!(env_);
    let Some(work) = work_ else {
        return env.invalid_arg();
    };
    napi_async_work::schedule(work);
    env.ok()
}

// HOST_EXPORT(napi_cancel_async_work, c)
pub fn napi_cancel_async_work(
    env_: Option<&NapiEnv>,
    work_: Option<&napi_async_work>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_cancel_async_work");
    let env = get_env!(env_);
    let Some(work) = work_ else {
        return env.invalid_arg();
    };
    if work.cancel() {
        return env.ok();
    }

    env.generic_failure()
}

// HOST_EXPORT(napi_get_node_version, c)
pub fn napi_get_node_version(
    env_: Option<&NapiEnv>,
    version_: Out<&'static napi_node_version>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_node_version");
    let env = get_env!(env_);
    let version = get_out!(env, version_);
    version.write(&NAPI_NODE_VERSION_GLOBAL);
    env.ok()
}

#[cfg(windows)]
pub(crate) type napi_event_loop = *mut bun_sys::windows::libuv::Loop;
#[cfg(not(windows))]
pub(crate) type napi_event_loop = *mut EventLoop;

// HOST_EXPORT(napi_get_uv_event_loop, c)
pub fn napi_get_uv_event_loop(env_: Option<&NapiEnv>, loop_: Out<napi_event_loop>) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_uv_event_loop");
    let env = get_env!(env_);
    let loop_out = get_out!(env, loop_);
    #[cfg(windows)]
    {
        // A past alignment assertion here fired spuriously.
        // TODO(@190n) investigate
        loop_out.write(VirtualMachine::get().uv_loop());
    }
    #[cfg(not(windows))]
    {
        // there is no uv event loop on posix, we use our event loop handle.
        loop_out.write(env.to_js().bun_vm().event_loop());
    }
    env.ok()
}

extern "C" fn napi_internal_register_cleanup_callback(data: *mut c_void) {
    // `data` is the env `napi_internal_register_cleanup_zig` registered.
    napi_internal_cleanup_env_cpp(NapiEnv::opaque_ref(data.cast()));
}

// HOST_EXPORT(napi_internal_register_cleanup_zig, c)
pub fn napi_internal_register_cleanup_zig(env: &NapiEnv) {
    env.to_js().bun_vm().as_mut().rare_data().push_cleanup_hook(
        env.to_js(),
        env.as_mut_ptr().cast::<c_void>(),
        napi_internal_register_cleanup_callback,
    );
}

// HOST_EXPORT(napi_internal_suppress_crash_on_abort_if_desired, c)
pub fn napi_internal_suppress_crash_on_abort_if_desired() {
    if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT
        .get()
        .unwrap_or(false)
    {
        bun_crash_handler::suppress_reporting();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Finalizer
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct Finalizer {
    pub env: NapiEnvRef,
    pub fun: NapiFinalizeFunction,
    pub data: *mut c_void,
    pub hint: *mut c_void,
}

impl Finalizer {
    /// Run the addon's finalizer. What it raised through napi (latched on the
    /// env) or left on the VM is the `Err`, for the caller's dispatcher to fold.
    pub(crate) fn run(&mut self) -> JsResult<()> {
        let env: &NapiEnv = &self.env;
        let _hs = NapiHandleScope::open_scoped(env);

        (self.fun)(env.as_mut_ptr(), self.data, self.hint);
        napi_internal_remove_finalizer(env, Some(self.fun), self.hint, self.data);

        env.surface_exception(env.to_js())
    }

    /// Takes ownership of `this`.
    pub(crate) fn enqueue(self) {
        NapiFinalizerTask::schedule(Box::new(NapiFinalizerTask { finalizer: self }));
    }
}

/// For Node-API modules not built with NAPI_EXPERIMENTAL, finalizers should be deferred to the
/// immediate task queue instead of run immediately. This lets finalizers perform allocations,
/// which they couldn't if they ran immediately while the garbage collector is still running.
// HOST_EXPORT(napi_internal_enqueue_finalizer, c)
pub fn napi_internal_enqueue_finalizer(
    env: Option<&NapiEnv>,
    fun: napi_finalize,
    data: *mut c_void,
    hint: *mut c_void,
) {
    let Some(fun) = fun else { return };
    let Some(env) = env else {
        return;
    };
    let this = Finalizer {
        fun,
        env: env.to_ref(),
        data,
        hint,
    };
    this.enqueue();
}

// ──────────────────────────────────────────────────────────────────────────
// ThreadSafeFunction
// ──────────────────────────────────────────────────────────────────────────

/// Reference-counted; each reference belongs to one holder: the JS side's
/// (`TsfnJs::owner_ref`, from creation until the function is finalized or its
/// env torn down), the addon threads' (`TsfnShared::threads_ref`, held while
/// `thread_count > 0`), a queued dispatch task's (`TsfnShared::dispatch_ref`)
/// and the queued finalize task's (`TsfnJs::finalize_ref`). Whoever drops the
/// last one frees it, on whichever thread that is (see `TsfnJs` for why that
/// is only ever plain memory by then).
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct ThreadSafeFunction {
    ref_count: bun_ptr::ThreadSafeRefCount<ThreadSafeFunction>,
    /// The addon threads' references (`napi_acquire/release_threadsafe_function`).
    /// It reaching zero (with nothing queued) is what finalizes the function.
    thread_count: AtomicI64,
    /// The call queue, and the references that change hands under its lock.
    shared: Guarded<TsfnShared>,
    /// This value will never change after initialization. Zero means the size is unlimited.
    max_queue_size: usize,
    queue_count: AtomicU32,
    dispatch_state: AtomicU8, // DispatchState
    blocking_condvar: Condvar,
    closing: AtomicU8, // ClosingState
    /// Written under `shared`'s lock by `env_teardown` on the JS thread: the
    /// loop is going away. Every path that would schedule onto it from another
    /// thread reads it under the same lock, so teardown cannot land between
    /// the check and the enqueue.
    env_dead: AtomicBool,

    ctx: *mut c_void,
    /// The addon's `call_js_cb`; `None`: `callback` is called directly.
    call_js: Option<napi_threadsafe_function_call_js>,
    /// How addon threads (`napi_call_threadsafe_function`) schedule a
    /// dispatch on the VM. Weak: addon threads hold this function for as long
    /// as they like (Node: calls after env cleanup get `napi_closing`), so it
    /// cannot be something the VM waits for.
    handle: VmHandle,
    loop_kind: LoopKind,

    /// JS-thread state.
    js: JsCell<TsfnJs>,
}

struct TsfnShared {
    queue: LinearFifo<*mut c_void, DynamicBuffer<*mut c_void>>,
    /// Held on behalf of the addon threads while `thread_count > 0`.
    threads_ref: Option<RefPtr<ThreadSafeFunction>>,
    /// The queued dispatch task's (at most one is queued: `dispatch_state`).
    dispatch_ref: Option<RefPtr<ThreadSafeFunction>>,
}

/// Only the JS thread touches this. By the time the JS side's reference is
/// released (`finalize` / `env_teardown`) everything JS-affine here has been
/// released on the JS thread — `env` taken, `callback` emptied, `poll_ref`
/// unref'd — so whichever thread drops the last reference only frees memory.
struct TsfnJs {
    /// thread-safe functions can be "referenced" and "unreferenced". A
    /// "referenced" thread-safe function will cause the event loop on the thread
    /// on which it is created to remain alive until the thread-safe function is
    /// destroyed. In contrast, an "unreferenced" thread-safe function will not
    /// prevent the event loop from exiting. The APIs napi_ref_threadsafe_function
    /// and napi_unref_threadsafe_function exist for this purpose.
    ///
    /// Neither does napi_unref_threadsafe_function mark the thread-safe
    /// functions as able to be destroyed nor does napi_ref_threadsafe_function
    /// prevent it from being destroyed.
    poll_ref: KeepAlive,
    tracker: Debugger::AsyncTaskTracker,
    /// Dropped by `env_teardown`; `None` afterwards.
    env: Option<NapiEnvRef>,
    callback: StrongOptional,
    finalizer_fun: napi_finalize,
    finalizer_data: *mut c_void,
    /// The JS side's reference: from creation until `finalize` / `env_teardown`.
    owner_ref: Option<RefPtr<ThreadSafeFunction>>,
    /// The queued finalize task's reference.
    finalize_ref: Option<RefPtr<ThreadSafeFunction>>,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
enum ClosingState {
    NotClosing,
    Closing,
    Closed,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum DispatchState {
    Idle,
    Running,
    Pending,
}

bun_event_loop::task_hop! {
    /// `task_tag::ThreadSafeFunction`: drain the queued calls on the JS thread.
    /// The queued task holds `TsfnShared::dispatch_ref`.
    pub(crate) TsfnDispatch for ThreadSafeFunction => ThreadSafeFunction;
    run = ThreadSafeFunction::run_dispatch_task;
    release_unrun = ThreadSafeFunction::release_dispatch_task;
}

bun_event_loop::task_hop! {
    /// `task_tag::ThreadSafeFunctionFinalize`: the last thread reference is gone
    /// and the queue drained; run the addon's finalizer and let the JS side go.
    /// The queued task holds `TsfnJs::finalize_ref`.
    pub(crate) TsfnFinalize for ThreadSafeFunction => ThreadSafeFunctionFinalize;
    run = ThreadSafeFunction::run_finalize_task;
    release_unrun = ThreadSafeFunction::release_finalize_task;
}

/// Live `ThreadSafeFunction` allocations, process-wide.
static THREADSAFE_FUNCTION_LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Exposed via `bun:internal-for-testing` so tests can assert a threadsafe
/// function orphaned by a dead worker is freed rather than leaked.
#[bun_jsc::host_fn]
pub(crate) fn js_threadsafe_function_live_count(
    _global: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::js_number(
        THREADSAFE_FUNCTION_LIVE_COUNT.load(Ordering::SeqCst) as f64,
    ))
}

impl Drop for ThreadSafeFunction {
    fn drop(&mut self) {
        let _ = THREADSAFE_FUNCTION_LIVE_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl ThreadSafeFunction {
    fn new(init: ThreadSafeFunction) -> RefPtr<ThreadSafeFunction> {
        let _ = THREADSAFE_FUNCTION_LIVE_COUNT.fetch_add(1, Ordering::SeqCst);
        RefPtr::new(init)
    }

    fn run_dispatch_task(this: ThisPtr<Self>) -> JsResult<()> {
        let dispatched = this.shared.lock().dispatch_ref.take();
        Self::drain(this);
        drop(dispatched);
        Ok(())
    }

    /// The env's cleanup hook (`env_teardown`, run with the exit handlers
    /// before the queue is released) already neutralised the function; only
    /// the task's reference is left to drop.
    fn release_dispatch_task(this: ThisPtr<Self>) {
        let dispatched = this.shared.lock().dispatch_ref.take();
        drop(dispatched);
    }

    fn run_finalize_task(this: ThisPtr<Self>) -> JsResult<()> {
        let queued = this.js.with_mut(|js| js.finalize_ref.take());
        if !this.env_dead.load(Ordering::SeqCst) {
            Self::finalize(this);
        }
        drop(queued);
        Ok(())
    }

    /// The finalize task never ran: normally because the VM is tearing down,
    /// in which case `env_teardown` (which the function is still registered
    /// for) runs the addon's finalizer and drops the JS side's reference; only
    /// the task's own reference is dropped here.
    fn release_finalize_task(this: ThisPtr<Self>) {
        let queued = this.js.with_mut(|js| js.finalize_ref.take());
        drop(queued);
    }

    /// The threadsafe function's queue drain is a dispatcher: each queued call
    /// is a JS entry of its own, so what one leaves pending is folded per call
    /// (`dispatch_one`) and the drain goes on; the VM's termination ends it.
    fn drain(this: ThisPtr<Self>) {
        if this.env_dead.load(Ordering::SeqCst) {
            // `env_teardown` already released everything the JS side owned. The
            // loop this task came from is being destroyed.
            return;
        }
        // Finalization is its own task (`TsfnFinalize`), queued once nothing
        // can schedule a dispatch any more.
        debug_assert!(this.closing.load(Ordering::SeqCst) != ClosingState::Closed as u8);

        let mut is_first = true;

        // Run the tasks.
        loop {
            this.dispatch_state
                .store(DispatchState::Running as u8, Ordering::SeqCst);
            // A stopping VM ends the drain like an empty queue does.
            let more = Self::dispatch_one(this, is_first).unwrap_or(false);
            if more {
                is_first = false;
                this.dispatch_state
                    .store(DispatchState::Pending as u8, Ordering::SeqCst);
            } else {
                // We're done running tasks, for now. Transition Running → Idle
                // via CAS instead of an unconditional store: between
                // dispatch_one() observing an empty queue (and dropping the
                // lock) and this point, another thread may have enqueued an
                // item and called schedule_dispatch(). That swap() saw
                // Running, so it intentionally did *not* schedule a new
                // concurrent task — it relies on this loop to pick the item
                // up. If we blindly stored Idle we'd overwrite that Pending
                // and the callback would be dropped (flaky lost-wakeup under
                // load). On CAS failure, loop and re-drain.
                if this
                    .dispatch_state
                    .compare_exchange(
                        DispatchState::Running as u8,
                        DispatchState::Idle as u8,
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    )
                    .is_ok()
                {
                    break;
                }
                // state was bumped to Pending by enqueue()/release(); re-dispatch.
            }
        }

        // Node sets a maximum number of runs per ThreadSafeFunction to 1,000.
        // We don't set a max. I would like to see an issue caused by not
        // setting a max before we do set a max. It is better for performance to
        // not add unnecessary event loop ticks.
    }

    pub(crate) fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst) != ClosingState::NotClosing as u8
    }

    fn is_blocked(&self) -> bool {
        self.max_queue_size > 0
            && self.queue_count.load(Ordering::SeqCst) as usize >= self.max_queue_size
    }

    /// This function's env; `None` once it has been torn down. JS thread.
    fn env(&self) -> Option<&NapiEnv> {
        self.js.get().env.as_deref()
    }

    /// The creating VM's event loop, or `None` once its env has been torn
    /// down. JS thread; its callers run from the loop's own dispatch.
    fn event_loop(&self) -> Option<&mut EventLoop> {
        let env = self.env()?;
        Some(env.to_js().bun_vm().event_loop_of(self.loop_kind))
    }

    fn maybe_queue_finalizer(this: ThisPtr<Self>) {
        let prev = this
            .closing
            .swap(ClosingState::Closed as u8, Ordering::SeqCst);
        if prev == ClosingState::Closed as u8 {
            // already scheduled.
            return;
        }
        let queue = this.js.with_mut(|js| {
            if js.finalize_ref.is_some() {
                return false;
            }
            js.callback = StrongOptional::empty();
            js.poll_ref.disable();
            if this.env_dead.load(Ordering::SeqCst) || js.env.is_none() {
                // env torn down: `env_teardown` owns the finalize.
                return false;
            }
            js.finalize_ref = Some(RefPtr::from_this(this));
            true
        });
        if queue && let Some(event_loop) = this.event_loop() {
            event_loop.enqueue_task(TsfnFinalize::task(this));
        }
    }

    /// `Ok(true)`: a queued call ran (what it threw has been reported), keep
    /// draining. `Err`: the VM is stopping.
    ///
    /// This can run several times in one tick of the event loop, so the
    /// microtasks one call queued are drained before the next call
    /// (https://github.com/nodejs/node/pull/38506), but not before the first.
    pub(crate) fn dispatch_one(
        this: ThisPtr<Self>,
        is_first: bool,
    ) -> Result<bool, bun_jsc::Stopped> {
        let mut queue_finalizer_after_call = false;
        let task = 'brk: {
            let mut shared = this.shared.lock();
            if this.is_closing() {
                // Closing (napi_tsfn_abort, or the last call already ran):
                // nothing still queued runs any more, as in Node's DispatchOne.
                // An abort's leftovers go back to the addon, with no lock held
                // since that re-enters it; the function finalizes once the last
                // thread reference is gone.
                let leftovers = this.take_queue(&mut shared);
                drop(shared);
                this.hand_back(leftovers);
                let _shared = this.shared.lock();
                if this.thread_count.load(Ordering::SeqCst) == 0 {
                    Self::maybe_queue_finalizer(this);
                }
                return Ok(false);
            }
            let Some(t) = shared.queue.read_item() else {
                // When there are no tasks and the number of threads that have
                // references reaches zero, we prepare to finalize the
                // ThreadSafeFunction.
                if this.thread_count.load(Ordering::SeqCst) == 0 {
                    if this.max_queue_size > 0 {
                        this.blocking_condvar.signal();
                    }
                    Self::maybe_queue_finalizer(this);
                }
                return Ok(false);
            };

            if this.queue_count.fetch_sub(1, Ordering::SeqCst) == 1
                && this.thread_count.load(Ordering::SeqCst) == 0
            {
                this.closing
                    .store(ClosingState::Closing as u8, Ordering::SeqCst);
                if this.max_queue_size > 0 {
                    this.blocking_condvar.signal();
                }
                queue_finalizer_after_call = true;
            } else if this.max_queue_size > 0 {
                // A slot opened: one blocked producer may go. (Waking one only
                // on the full → not-full edge strands the other waiters once
                // the woken producer has nothing more to push.)
                this.blocking_condvar.signal();
            }

            break 'brk t;
        };

        let called = match this.event_loop() {
            Some(event_loop) if !is_first => event_loop.drain_microtasks(),
            _ => Ok(()),
        }
        .and_then(|()| this.call(task));

        // The last queued call finalizes even when the VM is stopping.
        if queue_finalizer_after_call {
            Self::maybe_queue_finalizer(this);
        }
        called?;

        // An item was dequeued: keep `drain` looping so remaining queued
        // items drain and the empty-queue thread_count==0 path can finalize.
        Ok(true)
    }

    /// One queued call from the drain, which is its landing frame: what it
    /// left pending is folded here. `Err`: the VM is stopping.
    fn call(&self, task: *mut c_void) -> Result<(), bun_jsc::Stopped> {
        let Some(env) = self.env() else {
            // env torn down; nothing to call into.
            return Ok(());
        };
        match self.deliver(env, task) {
            Ok(()) => Ok(()),
            Err(err) => bun_jsc::task::report_error_or_terminate(env.to_js(), err),
        }
    }

    /// One queued call: a JS entry of its own, so what it leaves pending is
    /// the `Err`, for the caller's landing frame to fold. `env` is this
    /// function's own, which `js.env` still holds.
    fn deliver(&self, env: &NapiEnv, task: *mut c_void) -> JsResult<()> {
        let global_object = env.to_js();
        let (tracker, callback) = {
            let js = self.js.get();
            (js.tracker, js.callback.get())
        };
        let _dispatch = tracker.dispatch(global_object);

        match self.call_js {
            None => {
                let js: JSValue = callback.unwrap_or(JSValue::UNDEFINED);
                if js.is_empty_or_undefined_or_null() {
                    return Ok(());
                }

                js.call(global_object, JSValue::UNDEFINED, &[]).map(drop)
            }
            Some(call_js) => {
                let _hs = NapiHandleScope::open_scoped(env);
                // No func at creation => null js_callback (Node), not encoded undefined.
                let js = match callback {
                    Some(v) => napi_value::create(env, v),
                    None => napi_value(0),
                };
                call_js(env.as_mut_ptr(), js, self.ctx, task);
                env.surface_exception(global_object)
            }
        }
    }

    /// Caller holds the lock (`shared`). Empties the queue; the items are the
    /// caller's to give back to the addon once the lock is dropped.
    fn take_queue(&self, shared: &mut TsfnShared) -> Vec<*mut c_void> {
        let mut items = Vec::new();
        while let Some(item) = shared.queue.read_item() {
            items.push(item);
        }
        self.queue_count.store(0, Ordering::SeqCst);
        items
    }

    /// What a closing function does with items it will never run: each goes
    /// back to the addon's call_js_cb with a null env and js_callback, which is
    /// the signal napi_threadsafe_function_call_js documents for "free this,
    /// JS is no longer reachable" (Node's ThreadSafeFunction::EmptyQueue). A
    /// function created without a call_js_cb has nothing to give back.
    fn hand_back(&self, items: Vec<*mut c_void>) {
        let Some(call_js) = self.call_js else {
            return;
        };
        for item in items {
            call_js(ptr::null_mut(), napi_value(0), self.ctx, item);
        }
    }

    /// Runs on an addon thread. A call that reports `napi_closing` consumes the
    /// caller's thread reference (Node's `Push`), which can be the last one.
    pub(crate) fn push(this: ThisPtr<Self>, ctx: *mut c_void, block: bool) -> napi_status {
        let mut released = Released::default();
        let status = Self::enqueue(this, ctx, block, &mut released);
        drop(released);
        status
    }

    fn enqueue(
        this: ThisPtr<Self>,
        ctx: *mut c_void,
        block: bool,
        released: &mut Released,
    ) -> napi_status {
        let mut shared = this.shared.lock();
        if block {
            while this.is_blocked() && !this.is_closing() {
                this.blocking_condvar.wait_guarded(&mut shared);
            }
        } else if this.is_blocked() && !this.is_closing() {
            // A closing threadsafe function reports napi_closing even with a full
            // queue (node's `Push` skips the queue-full check unless it is open),
            // so the caller's reference is still consumed and it can finalize.
            // don't set the error on the env as this is run from another thread
            return NapiStatus::queue_full as napi_status;
        }

        if this.is_closing() {
            // `env_teardown` sets `closing` under this same lock, so an env that
            // dies while we wait above lands here, never below.
            if this.thread_count.load(Ordering::SeqCst) <= 0 {
                return NapiStatus::invalid_arg as napi_status;
            }
            // Consumes this thread's reference, like Node's `Push`, so a thread
            // that stops calling after napi_closing does not pin the loop.
            let _ = Self::release_locked(
                this,
                &mut shared,
                napi_threadsafe_function_release_mode::release,
                released,
            );
            return NapiStatus::closing as napi_status;
        }

        let _ = this.queue_count.fetch_add(1, Ordering::SeqCst);
        let _ = shared.queue.write_item(ctx); // OOM/capacity failures are fire-and-forget
        Self::schedule_dispatch(this, &mut shared, released);
        NapiStatus::ok as napi_status
    }

    /// Caller holds the lock (`shared`). Reached from addon threads (`enqueue`,
    /// `release_locked`); the VM is reached only through its handle.
    fn schedule_dispatch(this: ThisPtr<Self>, shared: &mut TsfnShared, released: &mut Released) {
        let prev = this
            .dispatch_state
            .swap(DispatchState::Pending as u8, Ordering::SeqCst);
        match prev {
            x if x == DispatchState::Idle as u8 => {
                if this.env_dead.load(Ordering::SeqCst) {
                    // env torn down: the loop is gone, nothing to schedule onto.
                    return;
                }
                debug_assert!(shared.dispatch_ref.is_none());
                shared.dispatch_ref = Some(RefPtr::from_this(this));
                if !this.handle.post_hop::<TsfnDispatch>(this.loop_kind, this) {
                    // VM closed before the env cleanup hook ran here: no
                    // dispatch will happen; the queued calls are released by the
                    // teardown path. Fall back to Idle.
                    released.add(shared.dispatch_ref.take());
                    this.dispatch_state
                        .store(DispatchState::Idle as u8, Ordering::SeqCst);
                }
            }
            x if x == DispatchState::Running as u8 => {
                // it will check if it has more work to do
            }
            _ => {
                // we've already scheduled it to run
            }
        }
    }

    /// JS thread: the queue drained with no thread references left (Node's
    /// Finalize). Queues the addon's finalizer, releases everything JS-affine
    /// (see `TsfnJs`) and drops the JS side's reference.
    fn finalize(this: ThisPtr<Self>) {
        let (finalizer, env, owner) = this.js.with_mut(|js| {
            js.poll_ref.unref(bun_io::js_vm_ctx());
            js.callback = StrongOptional::empty();
            let finalizer = js
                .finalizer_fun
                .zip(js.env.as_ref())
                .map(|(fun, env)| Finalizer {
                    env: env.clone(),
                    fun,
                    data: js.finalizer_data,
                    hint: this.ctx,
                });
            (finalizer, js.env.take(), js.owner_ref.take())
        });

        if let Some(env) = env {
            // Drops our registry entry so teardown cannot hand this pointer
            // out after it is freed.
            NapiEnv__unregisterThreadSafeFunction(&env, this.as_ptr().cast());
        }
        if let Some(finalizer) = finalizer {
            finalizer.enqueue();
        }
        drop(owner);
    }

    /// Runs on the JS thread from `NapiEnv::cleanup()` while JSC is still
    /// alive but the VirtualMachine (and the event loop this TSFN points at)
    /// is about to be destroyed. Mirrors Node's
    /// ThreadSafeFunction::Cleanup -> Finalize -> MaybeDelete.
    fn env_teardown(this: ThisPtr<Self>) {
        // Phase 1: publish "the loop is going away". From here no other thread
        // schedules onto it, but none may free us either -- the JS side's
        // reference is held until phase 3.
        let (was_closing, queued) = {
            let mut shared = this.shared.lock();
            this.env_dead.store(true, Ordering::SeqCst);
            let was_closing = this.is_closing();
            if !was_closing {
                this.closing
                    .store(ClosingState::Closing as u8, Ordering::SeqCst);
            }
            if this.max_queue_size > 0 {
                // Wake producers blocked on the bounded queue; they observe
                // is_closing and release.
                this.blocking_condvar.broadcast();
            }
            (was_closing, this.take_queue(&mut shared))
        };

        // Phase 2: addon callbacks, so no lock is held.
        //
        // What is still queued goes back to the addon only when a worker's env
        // dies under it. On the main thread this is process exit, where Node
        // runs nothing of a threadsafe function; most call_js_cbs cannot take
        // the null env a hand-back would give them (they abort), and a
        // process.exit() from inside one of them would re-enter it. The queue
        // dies with the process. In a worker the items arrive as Node's last
        // turn of the loop (CleanupHandles) delivers them: the normal call,
        // live env and js_callback, with script refused if the worker was
        // stopped. A function already closing (napi_tsfn_abort) keeps the
        // abort contract. The finalizer runs either way.
        if let Some(env) = this.env()
            && env.to_js().bun_vm().worker_ref().is_some()
        {
            if was_closing {
                this.hand_back(queued);
            } else if this.call_js.is_some() {
                for item in queued {
                    // The env's cleanup hook is each delivery's landing frame,
                    // as it is the finalizer's below.
                    crate::dispatch::fold(this.deliver(env, item));
                }
            }
        }
        let finalizer = this.js.with_mut(|js| {
            js.finalizer_fun
                .take()
                .zip(js.env.as_ref())
                .map(|(fun, env)| Finalizer {
                    env: env.clone(),
                    fun,
                    data: js.finalizer_data,
                    hint: this.ctx,
                })
        });
        if let Some(mut finalizer) = finalizer {
            // The env's cleanup hook is this finalizer's landing frame: what it
            // leaves is folded here so the next function's teardown starts clean.
            crate::dispatch::fold(finalizer.run());
        }

        // Phase 3: release what only the JS thread may release, then let the
        // JS side's reference go: from here whoever drops the last reference
        // (a thread's, a queued task's) frees the allocation (Node's
        // ReleaseResources + MaybeDelete).
        let owner = this.js.with_mut(|js| {
            js.callback = StrongOptional::empty();
            js.poll_ref.disable();
            drop(js.env.take());
            js.owner_ref.take()
        });
        drop(owner);
    }

    /// `napi_ref_threadsafe_function` — JS thread only (as in Node).
    pub(crate) fn ref_(&self) {
        self.js.with_mut(|js| js.poll_ref.ref_(bun_io::js_vm_ctx()));
    }

    /// `napi_unref_threadsafe_function` — JS thread only (as in Node).
    pub(crate) fn unref(&self) {
        self.js
            .with_mut(|js| js.poll_ref.unref(bun_io::js_vm_ctx()));
    }

    pub(crate) fn acquire(this: ThisPtr<Self>) -> napi_status {
        let mut shared = this.shared.lock();
        if this.is_closing() {
            return NapiStatus::closing as napi_status;
        }
        if this.thread_count.fetch_add(1, Ordering::SeqCst) == 0 {
            debug_assert!(shared.threads_ref.is_none());
            shared.threads_ref = Some(RefPtr::from_this(this));
        }
        NapiStatus::ok as napi_status
    }

    /// Can drop the last reference, which frees the function.
    pub(crate) fn release(
        this: ThisPtr<Self>,
        mode: napi_threadsafe_function_release_mode,
    ) -> napi_status {
        let mut released = Released::default();
        let status = {
            let mut shared = this.shared.lock();
            Self::release_locked(this, &mut shared, mode, &mut released)
        };
        drop(released);
        status
    }

    /// Caller holds the lock (`shared`). The last thread reference takes the
    /// addon threads' reference with it (into `released`).
    fn release_locked(
        this: ThisPtr<Self>,
        shared: &mut TsfnShared,
        mode: napi_threadsafe_function_release_mode,
        released: &mut Released,
    ) -> napi_status {
        if this.thread_count.load(Ordering::SeqCst) <= 0 {
            return NapiStatus::invalid_arg as napi_status;
        }

        let prev_remaining = this.thread_count.fetch_sub(1, Ordering::SeqCst);
        if prev_remaining == 1 {
            released.add(shared.threads_ref.take());
        }

        if this.env_dead.load(Ordering::SeqCst) {
            // The event loop we were created on is gone (`env_teardown` set
            // this under the lock we hold). Never schedule onto it.
            return NapiStatus::ok as napi_status;
        }

        if mode == napi_threadsafe_function_release_mode::abort || prev_remaining == 1 {
            if !this.is_closing() {
                if mode == napi_threadsafe_function_release_mode::abort {
                    this.closing
                        .store(ClosingState::Closing as u8, Ordering::SeqCst);
                    if this.max_queue_size > 0 {
                        // Wake all producers blocked in enqueue()'s bounded
                        // queue wait so they observe is_closing and release.
                        this.blocking_condvar.broadcast();
                    }
                }
                Self::schedule_dispatch(this, shared, released);
            } else if prev_remaining == 1 {
                // Already closing from an earlier abort. The last release must
                // still reach dispatch_one's thread_count==0 path so the
                // finalizer runs and the event-loop keepalive is dropped.
                Self::schedule_dispatch(this, shared, released);
            }
        }

        NapiStatus::ok as napi_status
    }
}

/// References whose holders let go inside a `ThreadSafeFunction`'s critical
/// section, dropped once its lock is released: the last one frees the
/// function, lock included.
#[derive(Default)]
struct Released([Option<RefPtr<ThreadSafeFunction>>; 2]);

impl Released {
    fn add(&mut self, r: Option<RefPtr<ThreadSafeFunction>>) {
        if let Some(r) = r {
            let slot = self.0.iter_mut().find(|slot| slot.is_none());
            *slot.expect("at most two references change hands per call") = Some(r);
        }
    }
}

/// Called from `NapiEnv::cleanup()` (JS thread) for every threadsafe function
/// still registered with the env that is being torn down. The registry only
/// holds live functions (`finalize` and this both remove the entry).
// HOST_EXPORT(napi_internal_threadsafe_function_env_teardown, c)
pub fn napi_internal_threadsafe_function_env_teardown(tsfn: ThisPtr<ThreadSafeFunction>) {
    ThreadSafeFunction::env_teardown(tsfn);
}

// HOST_EXPORT(napi_create_threadsafe_function, c)
pub fn napi_create_threadsafe_function(
    env_: Option<&NapiEnv>,
    func_: napi_value,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    max_queue_size: usize,
    initial_thread_count: usize,
    thread_finalize_data: *mut c_void,
    thread_finalize_cb: napi_finalize,
    context: *mut c_void,
    call_js_cb: Option<napi_threadsafe_function_call_js>,
    result_: Out<*mut ThreadSafeFunction>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_threadsafe_function");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let func = func_.get();

    if call_js_cb.is_none()
        && (func.is_empty_or_undefined_or_null()
            || (!func.is_callable() && !is_async_context_frame(func)))
    {
        return env.status(NapiStatus::function_expected);
    }

    let vm = env.to_js().bun_vm().as_mut();
    let callback = if func.is_empty() {
        StrongOptional::empty()
    } else {
        StrongOptional::create(func.with_async_context_if_needed(env.to_js()), vm.global())
    };

    let owner = ThreadSafeFunction::new(ThreadSafeFunction {
        ref_count: bun_ptr::ThreadSafeRefCount::init(),
        thread_count: AtomicI64::new(i64::try_from(initial_thread_count).expect("int cast")),
        shared: Guarded::new(TsfnShared {
            queue: LinearFifo::<*mut c_void, DynamicBuffer<*mut c_void>>::init(),
            threads_ref: None,
            dispatch_ref: None,
        }),
        max_queue_size,
        queue_count: AtomicU32::new(0),
        dispatch_state: AtomicU8::new(DispatchState::Idle as u8),
        blocking_condvar: Condvar::default(),
        closing: AtomicU8::new(ClosingState::NotClosing as u8),
        env_dead: AtomicBool::new(false),
        ctx: context,
        call_js: call_js_cb,
        handle: vm.handle(),
        loop_kind: vm.current_loop_kind(),
        js: JsCell::new(TsfnJs {
            poll_ref: KeepAlive::init(),
            tracker: Debugger::AsyncTaskTracker::init(vm),
            env: Some(env.to_ref()),
            callback,
            finalizer_fun: thread_finalize_cb,
            finalizer_data: thread_finalize_data,
            owner_ref: None,
            finalize_ref: None,
        }),
    });
    let this = owner.this_ptr();

    // Register with the env so that VM/worker teardown neutralizes this TSFN
    // before the event loop it points at is freed. `false` means the env has
    // already torn its threadsafe functions down -- we are running from a
    // finalizer, after the loop's last tick.
    if !NapiEnv__registerThreadSafeFunction(env, this.as_ptr().cast()) {
        // Born dead. Free only what we allocated and never run the addon's
        // finalizer: the handle was never published, so the addon still owns
        // what it passed in (node's `Init` failure path just deletes the
        // ThreadSafeFunction, whose destructor only releases its own resources).
        drop(owner);
        return env.generic_failure();
    }

    if initial_thread_count > 0 {
        this.shared.lock().threads_ref = Some(RefPtr::from_this(this));
    }
    this.js.with_mut(|js| {
        js.owner_ref = Some(owner);
        // nodejs by default keeps the event loop alive until the thread-safe function is unref'd
        js.poll_ref.ref_(bun_io::js_vm_ctx());
        js.tracker.did_schedule(vm.global());
    });

    result.write(this.as_ptr());
    env.ok()
}

// HOST_EXPORT(napi_get_threadsafe_function_context, c)
pub fn napi_get_threadsafe_function_context(
    func: Option<&ThreadSafeFunction>,
    result: Out<*mut c_void>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_threadsafe_function_context");
    let (Some(func), Some(result)) = (func, result) else {
        return NapiStatus::invalid_arg as napi_status;
    };
    result.write(func.ctx);
    NapiStatus::ok as napi_status
}

// HOST_EXPORT(napi_call_threadsafe_function, c)
pub fn napi_call_threadsafe_function(
    func: Option<ThisPtr<ThreadSafeFunction>>,
    data: *mut c_void,
    is_blocking: napi_threadsafe_function_call_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_call_threadsafe_function");
    let Some(func) = func else {
        return NapiStatus::invalid_arg as napi_status;
    };
    // The caller may not use `func` afterwards if this reports napi_closing —
    // that consumes the caller's thread reference, which can free it.
    ThreadSafeFunction::push(func, data, is_blocking == NAPI_TSFN_BLOCKING)
}

// HOST_EXPORT(napi_acquire_threadsafe_function, c)
pub fn napi_acquire_threadsafe_function(func: Option<ThisPtr<ThreadSafeFunction>>) -> napi_status {
    bun_output::scoped_log!(napi, "napi_acquire_threadsafe_function");
    let Some(func) = func else {
        return NapiStatus::invalid_arg as napi_status;
    };
    ThreadSafeFunction::acquire(func)
}

// HOST_EXPORT(napi_release_threadsafe_function, c)
pub fn napi_release_threadsafe_function(
    func: Option<ThisPtr<ThreadSafeFunction>>,
    mode: napi_threadsafe_function_release_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_release_threadsafe_function");
    let Some(func) = func else {
        return NapiStatus::invalid_arg as napi_status;
    };
    // The caller may not use `func` afterwards — this call can free it.
    ThreadSafeFunction::release(func, mode)
}

// HOST_EXPORT(napi_unref_threadsafe_function, c)
pub fn napi_unref_threadsafe_function(
    env_: Option<&NapiEnv>,
    func: Option<&ThreadSafeFunction>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_unref_threadsafe_function");
    let Some(func) = func else {
        return NapiStatus::invalid_arg as napi_status;
    };
    #[cfg(debug_assertions)]
    if let (Some(own), Some(env)) = (func.env(), env_) {
        debug_assert!(core::ptr::eq(own.to_js(), env.to_js()));
    }
    #[cfg(not(debug_assertions))]
    let _ = env_;
    func.unref();
    NapiStatus::ok as napi_status
}

// HOST_EXPORT(napi_ref_threadsafe_function, c)
pub fn napi_ref_threadsafe_function(
    env_: Option<&NapiEnv>,
    func: Option<&ThreadSafeFunction>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_ref_threadsafe_function");
    let Some(func) = func else {
        return NapiStatus::invalid_arg as napi_status;
    };
    #[cfg(debug_assertions)]
    if let (Some(own), Some(env)) = (func.env(), env_) {
        debug_assert!(core::ptr::eq(own.to_js(), env.to_js()));
    }
    #[cfg(not(debug_assertions))]
    let _ = env_;
    func.ref_();
    NapiStatus::ok as napi_status
}

// ──────────────────────────────────────────────────────────────────────────
// fix_dead_code_elimination
// ──────────────────────────────────────────────────────────────────────────

use bun_core::keep_symbols;

/// Keeps every symbol a native addon links against: the `napi_*` entry points
/// implemented here (their `extern "C"` thunks are generated) and the C/C++
/// ones (`link_symbols`).
pub(crate) fn fix_dead_code_elimination() {
    jsc::mark_binding();

    use crate::generated_host_exports as exports;
    keep_symbols!(
        exports::napi_acquire_threadsafe_function,
        exports::napi_async_destroy,
        exports::napi_async_init,
        exports::napi_call_threadsafe_function,
        exports::napi_cancel_async_work,
        exports::napi_close_callback_scope,
        exports::napi_close_escapable_handle_scope,
        exports::napi_close_handle_scope,
        exports::napi_create_array,
        exports::napi_create_array_with_length,
        exports::napi_create_async_work,
        exports::napi_create_date,
        exports::napi_create_int32,
        exports::napi_create_int64,
        exports::napi_create_promise,
        exports::napi_create_string_latin1,
        exports::napi_create_string_utf16,
        exports::napi_create_string_utf8,
        exports::napi_create_threadsafe_function,
        exports::napi_create_uint32,
        exports::napi_delete_async_work,
        exports::napi_escape_handle,
        exports::napi_fatal_error,
        exports::napi_get_array_length,
        exports::napi_get_arraybuffer_info,
        exports::napi_get_boolean,
        exports::napi_get_buffer_info,
        exports::napi_get_dataview_info,
        exports::napi_get_node_version,
        exports::napi_get_null,
        exports::napi_get_prototype,
        exports::napi_get_threadsafe_function_context,
        exports::napi_get_typedarray_info,
        exports::napi_get_undefined,
        exports::napi_get_uv_event_loop,
        exports::napi_get_version,
        exports::napi_is_array,
        exports::napi_is_arraybuffer,
        exports::napi_is_dataview,
        exports::napi_is_date,
        exports::napi_is_error,
        exports::napi_is_promise,
        exports::napi_make_callback,
        exports::napi_open_callback_scope,
        exports::napi_open_escapable_handle_scope,
        exports::napi_open_handle_scope,
        exports::napi_queue_async_work,
        exports::napi_ref_threadsafe_function,
        exports::napi_reject_deferred,
        exports::napi_release_threadsafe_function,
        exports::napi_resolve_deferred,
        exports::napi_strict_equals,
        exports::napi_unref_threadsafe_function,
    );
    super::link_symbols::keep();

    keep_symbols!(crate::node::buffer::BufferVectorized::fill);
}

// ──────────────────────────────────────────────────────────────────────────
// NapiFinalizerTask
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct NapiFinalizerTask {
    pub(crate) finalizer: Finalizer,
}

// `task_tag::NapiFinalizerTask`: run one deferred addon finalizer. One released
// unrun (the loop stopped first) runs too: Node runs an addon's finalizers
// during environment cleanup (script already forbidden), and an addon counts
// on them (external buffers freed when a Worker exits). `Err` is left pending
// for the release dispatcher's fold.
bun_event_loop::boxed_task! {
    NapiFinalizerTask => NapiFinalizerTask;
    run = |task: Box<NapiFinalizerTask>| (*task).run_finalizer();
    release_unrun = |task: Box<NapiFinalizerTask>| { let _ = (*task).run_finalizer(); };
    refused = |task: Box<NapiFinalizerTask>| (*task).refused();
}

impl OwnedCleanupHook for NapiFinalizerTask {
    /// A cleanup hook returns nothing: `Err` is left pending for the hook
    /// runner's fold.
    fn run(self: Box<Self>) {
        let _ = (*self).run_finalizer();
    }
}

impl NapiFinalizerTask {
    fn run_finalizer(mut self) -> JsResult<()> {
        self.finalizer.run()
    }

    /// The VM is already torn down, so the finalizer can never run: free the
    /// task but not the env ref — the env's count is not atomic and the env
    /// goes with its VM — as the cleanup-hooks-already-ran case in `schedule`
    /// does.
    fn refused(self) {
        let NapiFinalizerTask { finalizer } = self;
        let Finalizer { env, .. } = finalizer;
        let _ = ManuallyDrop::new(env);
    }

    pub(crate) fn schedule(self: Box<Self>) {
        // Inline of `JSGlobalObject::try_bun_vm`: the VM pointer is fetched
        // unconditionally from C++; "main thread" is determined by whether the
        // thread-local VM holder is populated.
        let is_main_thread = VirtualMachine::get_or_null().is_some();

        if !is_main_thread {
            // Off the JS thread (e.g. an external buffer finalized from a GC
            // helper thread): post through the env's VM handle (`refused` if
            // the VM is already torn down).
            let handle: VmHandle = self.finalizer.env.vm_handle();
            handle.post_boxed(LoopKind::Regular, self);
            return;
        }

        let global_this = self.finalizer.env.to_js();
        let vm: &VirtualMachine = global_this.bun_vm();
        if vm.is_shutting_down() {
            if vm.has_run_cleanup_hooks() {
                // `on_exit()` already drained cleanup hooks; we are inside the
                // final `collectNow()` (Heap::sweepArrayBuffers) and the JSC
                // VM is being torn down. The cleanup-hook list will never be
                // walked again, and running the user finalizer here (mid-GC,
                // with the global about to be freed) is not sound. Drop the task
                // so the `Box<NapiFinalizerTask>` and its `NapiEnvRef` are
                // released; the addon's external data is reclaimed by the OS
                // at process exit.
                drop(self);
                return;
            }
            // Immediate tasks won't run, so we run this as a cleanup hook instead
            vm.as_mut()
                .rare_data()
                .push_owned_cleanup_hook(vm.global(), self);
        } else {
            vm.event_loop_ref().enqueue_task(self.into_task());
        }
    }
}
