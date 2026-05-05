//! Node-API (N-API) implementation.
//! Port of src/napi/napi.zig.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU8, Ordering};

use bun_aio::KeepAlive;
use bun_collections::LinearFifo;
use bun_jsc::{
    self as jsc, AnyTask, CallFrame, ConcurrentTask, Debugger, EventLoop, JSGlobalObject, JSPromise,
    JSValue, Strong, Task, VirtualMachine,
};
use bun_threading::{Condvar, Mutex, WorkPool, WorkPoolTask};

bun_output::declare_scope!(napi, visible);

const TODO_EXCEPTION: jsc::c_api::ExceptionRef = ptr::null_mut();

// ──────────────────────────────────────────────────────────────────────────
// NapiEnv
// ──────────────────────────────────────────────────────────────────────────

/// This is `struct napi_env__` from napi.h
#[repr(C)]
pub struct NapiEnv {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    fn NapiEnv__globalObject(env: *mut NapiEnv) -> *mut JSGlobalObject;
    fn NapiEnv__getAndClearPendingException(env: *mut NapiEnv, out: *mut JSValue) -> bool;
    fn napi_internal_get_version(env: *mut NapiEnv) -> u32;
    fn NapiEnv__deref(env: *mut NapiEnv);
    fn NapiEnv__ref(env: *mut NapiEnv);
    fn napi_set_last_error(env: napi_env, status: NapiStatus) -> napi_status;
}

impl NapiEnv {
    pub fn to_js(&self) -> &JSGlobalObject {
        // SAFETY: NapiEnv__globalObject always returns a valid non-null pointer.
        unsafe { &*NapiEnv__globalObject(self as *const _ as *mut _) }
    }

    /// Convert err to an extern napi_status, and store the error code in env so that it can be
    /// accessed by napi_get_last_error_info
    pub fn set_last_error(self_: Option<&Self>, err: NapiStatus) -> napi_status {
        // SAFETY: napi_set_last_error accepts null env.
        unsafe {
            napi_set_last_error(
                self_.map(|s| s as *const _ as *mut _).unwrap_or(ptr::null_mut()),
                err,
            )
        }
    }

    /// Convenience wrapper for set_last_error(.ok)
    pub fn ok(&self) -> napi_status {
        Self::set_last_error(Some(self), NapiStatus::ok)
    }

    /// These wrappers exist for convenience and so we can set a breakpoint in lldb
    pub fn invalid_arg(&self) -> napi_status {
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(napi, "invalid arg");
        }
        Self::set_last_error(Some(self), NapiStatus::invalid_arg)
    }

    pub fn generic_failure(&self) -> napi_status {
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(napi, "generic failure");
        }
        Self::set_last_error(Some(self), NapiStatus::generic_failure)
    }

    /// Assert that we're not currently performing garbage collection
    pub fn check_gc(&self) {
        // SAFETY: env is non-null.
        unsafe { napi_internal_check_gc(self as *const _ as *mut _) };
    }

    /// Return the Node-API version number declared by the module we are running code from
    pub fn get_version(&self) -> u32 {
        // SAFETY: env is non-null.
        unsafe { napi_internal_get_version(self as *const _ as *mut _) }
    }

    pub fn get_and_clear_pending_exception(&self) -> Option<JSValue> {
        let mut exception = JSValue::ZERO;
        // SAFETY: out-param is a valid stack location.
        if unsafe { NapiEnv__getAndClearPendingException(self as *const _ as *mut _, &mut exception) } {
            return Some(exception);
        }
        None
    }
}

/// Vtable for `bun_ptr::ExternalShared<NapiEnv>`.
pub mod napi_env_external_shared_descriptor {
    use super::*;
    pub unsafe fn ref_(env: *mut NapiEnv) {
        NapiEnv__ref(env)
    }
    pub unsafe fn deref(env: *mut NapiEnv) {
        NapiEnv__deref(env)
    }
}

// TODO(port): bun.ptr.ExternalShared(NapiEnv) — intrusive externally-refcounted handle.
pub type NapiEnvRef = bun_ptr::ExternalShared<NapiEnv>;

#[cold]
fn env_is_null() -> napi_status {
    // in this case we don't actually have an environment to set the last error on, so it doesn't
    // make sense to call napi_set_last_error
    NapiStatus::invalid_arg as napi_status
}

/// This is nullable because native modules may pass null pointers for the NAPI environment, which
/// is an error that our NAPI functions need to handle (by returning napi_invalid_arg). To specify
/// a Rust API that uses a never-null napi_env, use `&NapiEnv`.
pub type napi_env = *mut NapiEnv;

/// Contents are not used by any Rust code
#[repr(C)]
pub struct Ref {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

pub type napi_ref = *mut Ref;

// ──────────────────────────────────────────────────────────────────────────
// NapiHandleScope
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct NapiHandleScope {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    pub fn NapiHandleScope__open(env: *mut NapiEnv, escapable: bool) -> *mut NapiHandleScope;
    pub fn NapiHandleScope__close(env: *mut NapiEnv, current: *mut NapiHandleScope);
    fn NapiHandleScope__append(env: *mut NapiEnv, value: i64);
    fn NapiHandleScope__escape(handle_scope: *mut NapiHandleScope, value: i64) -> bool;
}

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum EscapeError {
    #[error("escape called twice")]
    EscapeCalledTwice,
}

impl From<EscapeError> for bun_core::Error {
    fn from(_: EscapeError) -> Self {
        bun_core::err!("EscapeCalledTwice")
    }
}

impl NapiHandleScope {
    /// Create a new handle scope in the given environment, or return null if creating one now is
    /// unsafe (i.e. inside a finalizer)
    pub fn open(env: &NapiEnv, escapable: bool) -> *mut NapiHandleScope {
        // SAFETY: env is valid; may return null.
        unsafe { NapiHandleScope__open(env as *const _ as *mut _, escapable) }
    }

    /// Closes the given handle scope, releasing all values inside it, if it is safe to do so.
    /// Asserts that self is the current handle scope in env.
    pub fn close(self_: *mut NapiHandleScope, env: &NapiEnv) {
        // SAFETY: NapiHandleScope__close handles null `current`.
        unsafe { NapiHandleScope__close(env as *const _ as *mut _, self_) }
    }

    /// Place a value in the handle scope. Must be done while returning any JS value into NAPI
    /// callbacks, as the value must remain alive as long as the handle scope is active, even if the
    /// native module doesn't keep it visible on the stack.
    pub fn append(env: &NapiEnv, value: JSValue) {
        // SAFETY: env is valid.
        unsafe { NapiHandleScope__append(env as *const _ as *mut _, value.encoded()) }
    }

    /// Move a value from the current handle scope (which must be escapable) to the reserved escape
    /// slot in the parent handle scope, allowing that value to outlive the current handle scope.
    /// Returns an error if escape() has already been called on this handle scope.
    pub fn escape(&self, value: JSValue) -> Result<(), EscapeError> {
        // SAFETY: self is a valid handle scope.
        if !unsafe { NapiHandleScope__escape(self as *const _ as *mut _, value.encoded()) } {
            return Err(EscapeError::EscapeCalledTwice);
        }
        Ok(())
    }
}

pub type napi_handle_scope = *mut NapiHandleScope;
pub type napi_escapable_handle_scope = *mut NapiHandleScope;
pub type napi_callback_info = *mut CallFrame;
pub type napi_deferred = *mut JSPromise::Strong;

// ──────────────────────────────────────────────────────────────────────────
// napi_value
// ──────────────────────────────────────────────────────────────────────────

/// To ensure napi_values are not collected prematurely after being returned into a native module,
/// you must use these functions rather than convert between napi_value and jsc::JSValue directly
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct napi_value(i64);

impl napi_value {
    pub fn set(&mut self, env: &NapiEnv, val: JSValue) {
        NapiHandleScope::append(env, val);
        self.0 = val.encoded();
    }

    pub fn get(&self) -> JSValue {
        // SAFETY: napi_value stores the same i64 encoding as JSValue.
        unsafe { JSValue::from_encoded(self.0) }
    }

    pub fn create(env: &NapiEnv, val: JSValue) -> napi_value {
        NapiHandleScope::append(env, val);
        napi_value(val.encoded())
    }
}

type char16_t = u16;
pub type napi_property_attributes = c_uint;

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum napi_valuetype {
    undefined = 0,
    null = 1,
    boolean = 2,
    number = 3,
    string = 4,
    symbol = 5,
    object = 6,
    function = 7,
    external = 8,
    bigint = 9,
}

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
}

impl napi_typedarray_type {
    pub fn from_js_type(this: jsc::JSType) -> Option<napi_typedarray_type> {
        use jsc::JSType::*;
        Some(match this {
            Int8Array => napi_typedarray_type::int8_array,
            Uint8Array => napi_typedarray_type::uint8_array,
            Uint8ClampedArray => napi_typedarray_type::uint8_clamped_array,
            Int16Array => napi_typedarray_type::int16_array,
            Uint16Array => napi_typedarray_type::uint16_array,
            Int32Array => napi_typedarray_type::int32_array,
            Uint32Array => napi_typedarray_type::uint32_array,
            Float32Array => napi_typedarray_type::float32_array,
            Float64Array => napi_typedarray_type::float64_array,
            BigInt64Array => napi_typedarray_type::bigint64_array,
            BigUint64Array => napi_typedarray_type::biguint64_array,
            _ => return None,
        })
    }

    pub fn to_js_type(self) -> jsc::JSType {
        use jsc::JSType::*;
        match self {
            napi_typedarray_type::int8_array => Int8Array,
            napi_typedarray_type::uint8_array => Uint8Array,
            napi_typedarray_type::uint8_clamped_array => Uint8ClampedArray,
            napi_typedarray_type::int16_array => Int16Array,
            napi_typedarray_type::uint16_array => Uint16Array,
            napi_typedarray_type::int32_array => Int32Array,
            napi_typedarray_type::uint32_array => Uint32Array,
            napi_typedarray_type::float32_array => Float32Array,
            napi_typedarray_type::float64_array => Float64Array,
            napi_typedarray_type::bigint64_array => BigInt64Array,
            napi_typedarray_type::biguint64_array => BigUint64Array,
        }
    }

    pub fn to_c(self) -> jsc::c_api::JSTypedArrayType {
        self.to_js_type().to_c()
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
}

/// This is not an `enum` so that the enum values cannot be trivially returned from NAPI functions,
/// as that would skip storing the last error code. You should wrap return values in a call to
/// NapiEnv::set_last_error.
pub type napi_status = c_uint;

pub type napi_callback = Option<extern "C" fn(napi_env, napi_callback_info) -> napi_value>;

/// expects `napi_env`, `callback_data`, `context`
pub type NapiFinalizeFunction = extern "C" fn(napi_env, *mut c_void, *mut c_void);
pub type napi_finalize = Option<NapiFinalizeFunction>;

#[repr(C)]
pub struct napi_property_descriptor {
    pub utf8name: *const c_char,
    pub name: napi_value,
    pub method: napi_callback,
    pub getter: napi_callback,
    pub setter: napi_callback,
    pub value: napi_value,
    pub attributes: napi_property_attributes,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct napi_extended_error_info {
    pub error_message: *const c_char,
    pub engine_reserved: *mut c_void,
    pub engine_error_code: u32,
    pub error_code: napi_status,
}

type napi_key_collection_mode = c_uint;
type napi_key_filter = c_uint;
type napi_key_conversion = c_uint;

#[repr(C)]
struct napi_type_tag {
    lower: u64,
    upper: u64,
}

// ──────────────────────────────────────────────────────────────────────────
// Helper macro: unwrap nullable env / nullable out-param
// ──────────────────────────────────────────────────────────────────────────

macro_rules! get_env {
    ($env:expr) => {
        // SAFETY: caller passes raw napi_env; we treat non-null as &NapiEnv borrow.
        match unsafe { $env.as_ref() } {
            Some(e) => e,
            None => return env_is_null(),
        }
    };
}

macro_rules! get_out {
    ($env:expr, $ptr:expr) => {
        // SAFETY: caller passes raw out pointer; we treat non-null as &mut borrow.
        match unsafe { $ptr.as_mut() } {
            Some(r) => r,
            None => return $env.invalid_arg(),
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Exported / extern NAPI functions
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): move to napi_sys
unsafe extern "C" {
    pub fn napi_get_last_error_info(
        env: napi_env,
        result: *mut *const napi_extended_error_info,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_undefined(env_: napi_env, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_undefined");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::UNDEFINED);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_null(env_: napi_env, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_null");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::NULL);
    env.ok()
}

unsafe extern "C" {
    pub fn napi_get_global(env: napi_env, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_boolean(env_: napi_env, value: bool, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_boolean");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::from(value));
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_array(env_: napi_env, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_array");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let arr = match JSValue::create_empty_array(env.to_js(), 0) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    result.set(env, arr);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_array_with_length(
    env_: napi_env,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_array_with_length");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);

    // https://github.com/nodejs/node/blob/14c68e3b536798e25f810ed7ae180a5cde9e47d3/deps/v8/src/api/api.cc#L8163-L8174
    // size_t immediately cast to int as argument to Array::New, then min 0
    // SAFETY: bit-reinterpret usize as i64 (same size on 64-bit targets).
    let len_i64: i64 = unsafe { core::mem::transmute::<usize, i64>(length) };
    let len_i32: i32 = len_i64 as i32; // @truncate
    let len: u32 = if len_i32 > 0 {
        // SAFETY: len_i32 > 0 so the bit pattern is a valid u32.
        unsafe { core::mem::transmute::<i32, u32>(len_i32) }
    } else {
        0
    };

    let array = match JSValue::create_empty_array(env.to_js(), len) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    array.ensure_still_alive();
    result.set(env, array);
    env.ok()
}

unsafe extern "C" {
    pub fn napi_create_double(env: napi_env, value: f64, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_int32(env_: napi_env, value: i32, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_int32");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value));
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_uint32(env_: napi_env, value: u32, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_uint32");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value));
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_int64(env_: napi_env, value: i64, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_int64");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value));
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_string_latin1(
    env_: napi_env,
    str_: *const u8,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    let env = get_env!(env_);
    let result = get_out!(env, result_);

    let slice: &[u8] = 'brk: {
        if !str_.is_null() {
            if NAPI_AUTO_LENGTH == length {
                // SAFETY: caller guarantees ptr is NUL-terminated when length == NAPI_AUTO_LENGTH.
                break 'brk unsafe { core::ffi::CStr::from_ptr(str_ as *const c_char) }.to_bytes();
            } else if length > i32::MAX as usize {
                return env.invalid_arg();
            } else {
                // SAFETY: caller guarantees [ptr, ptr+length) is valid.
                break 'brk unsafe { core::slice::from_raw_parts(str_, length) };
            }
        }

        if length == 0 {
            break 'brk &[];
        } else {
            return env.invalid_arg();
        }
    };

    bun_output::scoped_log!(napi, "napi_create_string_latin1: {}", bstr::BStr::new(slice));

    if slice.is_empty() {
        let js = match bun_str::String::empty().to_js(env.to_js()) {
            Ok(v) => v,
            Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::generic_failure),
        };
        result.set(env, js);
        return env.ok();
    }

    let (string, bytes) = bun_str::String::create_uninitialized_latin1(slice.len());
    // `string` derefs on Drop.
    bytes.copy_from_slice(slice);

    let js = match string.to_js(env.to_js()) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::generic_failure),
    };
    result.set(env, js);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_string_utf8(
    env_: napi_env,
    str_: *const u8,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    let env = get_env!(env_);
    let result = get_out!(env, result_);

    let slice: &[u8] = 'brk: {
        if !str_.is_null() {
            if NAPI_AUTO_LENGTH == length {
                // SAFETY: caller guarantees ptr is NUL-terminated when length == NAPI_AUTO_LENGTH.
                break 'brk unsafe { core::ffi::CStr::from_ptr(str_ as *const c_char) }.to_bytes();
            } else if length > i32::MAX as usize {
                return env.invalid_arg();
            } else {
                // SAFETY: caller guarantees [ptr, ptr+length) is valid.
                break 'brk unsafe { core::slice::from_raw_parts(str_, length) };
            }
        }

        if length == 0 {
            break 'brk &[];
        } else {
            return env.invalid_arg();
        }
    };

    bun_output::scoped_log!(napi, "napi_create_string_utf8: {}", bstr::BStr::new(slice));

    let global_object = env.to_js();
    let string = match bun_str::String::create_utf8_for_js(global_object, slice) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    result.set(env, string);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_string_utf16(
    env_: napi_env,
    str_: *const char16_t,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    let env = get_env!(env_);
    let result = get_out!(env, result_);

    let slice: &[u16] = 'brk: {
        if !str_.is_null() {
            if NAPI_AUTO_LENGTH == length {
                // SAFETY: caller guarantees ptr is NUL-terminated when length == NAPI_AUTO_LENGTH.
                break 'brk unsafe { bun_str::slice_to_nul_u16(str_) };
            } else if length > i32::MAX as usize {
                return env.invalid_arg();
            } else {
                // SAFETY: caller guarantees [ptr, ptr+length) is valid.
                break 'brk unsafe { core::slice::from_raw_parts(str_, length) };
            }
        }

        if length == 0 {
            break 'brk &[];
        } else {
            return env.invalid_arg();
        }
    };

    if cfg!(debug_assertions) {
        bun_output::scoped_log!(
            napi,
            "napi_create_string_utf16: {} {}",
            slice.len(),
            bun_core::fmt::FormatUtf16(&slice[..slice.len().min(512)])
        );
    }

    if slice.is_empty() {
        let js = match bun_str::String::empty().to_js(env.to_js()) {
            Ok(v) => v,
            Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::generic_failure),
        };
        result.set(env, js);
        return env.ok();
    }

    let (string, chars) = bun_str::String::create_uninitialized_utf16(slice.len());
    chars.copy_from_slice(slice);

    let js = match string.transfer_to_js(env.to_js()) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::generic_failure),
    };
    result.set(env, js);
    env.ok()
}

// TODO(port): move to napi_sys
unsafe extern "C" {
    pub fn napi_create_symbol(env: napi_env, description: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_create_error(env: napi_env, code: napi_value, msg: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_create_type_error(env: napi_env, code: napi_value, msg: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_create_range_error(env: napi_env, code: napi_value, msg: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_typeof(env: napi_env, value: napi_value, result: *mut napi_valuetype) -> napi_status;
    pub fn napi_get_value_double(env: napi_env, value: napi_value, result: *mut f64) -> napi_status;
    pub fn napi_get_value_int32(env: napi_env, value: napi_value, result: *mut i32) -> napi_status;
    pub fn napi_get_value_uint32(env: napi_env, value: napi_value, result: *mut u32) -> napi_status;
    pub fn napi_get_value_int64(env: napi_env, value: napi_value, result: *mut i64) -> napi_status;
    pub fn napi_get_value_bool(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
    pub fn napi_get_value_string_latin1(env: napi_env, value: napi_value, buf_ptr: *mut c_char, bufsize: usize, result_ptr: *mut usize) -> napi_status;
    /// Copies a JavaScript string into a UTF-8 string buffer. The result is the
    /// number of bytes (excluding the null terminator) copied into buf.
    /// A sufficient buffer size should be greater than the length of string,
    /// reserving space for null terminator.
    /// If bufsize is insufficient, the string will be truncated and null terminated.
    /// If buf is NULL, this method returns the length of the string (in bytes)
    /// via the result parameter.
    /// The result argument is optional unless buf is NULL.
    pub fn napi_get_value_string_utf8(env: napi_env, value: napi_value, buf_ptr: *mut u8, bufsize: usize, result_ptr: *mut usize) -> napi_status;
    pub fn napi_get_value_string_utf16(env: napi_env, value: napi_value, buf_ptr: *mut char16_t, bufsize: usize, result_ptr: *mut usize) -> napi_status;
    pub fn napi_coerce_to_bool(env: napi_env, value: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_coerce_to_number(env: napi_env, value: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_coerce_to_object(env: napi_env, value: napi_value, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_prototype(
    env_: napi_env,
    object_: napi_value,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_prototype");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let object = object_.get();
    if object.is_empty() {
        return env.invalid_arg();
    }
    if !object.is_object() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::object_expected);
    }

    result.set(
        env,
        JSValue::c(jsc::c_api::JSObjectGetPrototype(
            env.to_js().ref_(),
            object.as_object_ref(),
        )),
    );
    env.ok()
}

// TODO: bind JSC::ownKeys
// pub extern "C" fn napi_get_property_names(env: napi_env, object: napi_value, result: *mut napi_value) -> napi_status {
//     log("napi_get_property_names");
//     if !object.is_object() {
//         return .object_expected;
//     }
//     result.* =
// }

unsafe extern "C" {
    pub fn napi_set_element(env: napi_env, object: napi_value, index: c_uint, value: napi_value) -> napi_status;
    pub fn napi_has_element(env: napi_env, object: napi_value, index: c_uint, result: *mut bool) -> napi_status;
    pub fn napi_get_element(env: napi_env, object: napi_value, index: u32, result: *mut napi_value) -> napi_status;
    pub fn napi_delete_element(env: napi_env, object: napi_value, index: u32, result: *mut bool) -> napi_status;
    pub fn napi_define_properties(env: napi_env, object: napi_value, property_count: usize, properties: *const napi_property_descriptor) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_is_array(env_: napi_env, value_: napi_value, result_: *mut bool) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_array");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let value = value_.get();
    *result = value.js_type().is_array();
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_array_length(
    env_: napi_env,
    value_: napi_value,
    result_: *mut u32,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_array_length");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let value = value_.get();

    if !value.js_type().is_array() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::array_expected);
    }

    *result = match value.get_length(env.to_js()) {
        Ok(len) => len as u32, // @truncate
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_strict_equals(
    env_: napi_env,
    lhs_: napi_value,
    rhs_: napi_value,
    result_: *mut bool,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_strict_equals");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let (lhs, rhs) = (lhs_.get(), rhs_.get());
    *result = match lhs.is_strict_equal(rhs, env.to_js()) {
        Ok(b) => b,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    env.ok()
}

unsafe extern "C" {
    pub fn napi_call_function(env: napi_env, recv: napi_value, func: napi_value, argc: usize, argv: *const napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_new_instance(env: napi_env, constructor: napi_value, argc: usize, argv: *const napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_instanceof(env: napi_env, object: napi_value, constructor: napi_value, result: *mut bool) -> napi_status;
    pub fn napi_get_cb_info(env: napi_env, cbinfo: napi_callback_info, argc: *mut usize, argv: *mut napi_value, this_arg: *mut napi_value, data: *mut *mut c_void) -> napi_status;
    pub fn napi_get_new_target(env: napi_env, cbinfo: napi_callback_info, result: *mut napi_value) -> napi_status;
    pub fn napi_define_class(
        env: napi_env,
        utf8name: *const c_char,
        length: usize,
        constructor: napi_callback,
        data: *mut c_void,
        property_count: usize,
        properties: *const napi_property_descriptor,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_wrap(env: napi_env, js_object: napi_value, native_object: *mut c_void, finalize_cb: napi_finalize, finalize_hint: *mut c_void, result: *mut napi_ref) -> napi_status;
    pub fn napi_unwrap(env: napi_env, js_object: napi_value, result: *mut *mut c_void) -> napi_status;
    pub fn napi_remove_wrap(env: napi_env, js_object: napi_value, result: *mut *mut c_void) -> napi_status;
    pub fn napi_create_object(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_create_external(env: napi_env, data: *mut c_void, finalize_cb: napi_finalize, finalize_hint: *mut c_void, result: *mut napi_value) -> napi_status;
    pub fn napi_get_value_external(env: napi_env, value: napi_value, result: *mut *mut c_void) -> napi_status;
    pub fn napi_create_reference(env: napi_env, value: napi_value, initial_refcount: u32, result: *mut napi_ref) -> napi_status;
    pub fn napi_delete_reference(env: napi_env, ref_: napi_ref) -> napi_status;
    pub fn napi_reference_ref(env: napi_env, ref_: napi_ref, result: *mut u32) -> napi_status;
    pub fn napi_reference_unref(env: napi_env, ref_: napi_ref, result: *mut u32) -> napi_status;
    pub fn napi_get_reference_value(env: napi_env, ref_: napi_ref, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_open_handle_scope(
    env_: napi_env,
    result_: *mut napi_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_handle_scope");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    *result = NapiHandleScope::open(env, false);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_close_handle_scope(
    env_: napi_env,
    handle_scope: napi_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_handle_scope");
    let env = get_env!(env_);
    env.check_gc();
    if !handle_scope.is_null() {
        NapiHandleScope::close(handle_scope, env);
    }
    env.ok()
}

// we don't support async contexts
#[unsafe(no_mangle)]
pub extern "C" fn napi_async_init(
    env_: napi_env,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    async_ctx: *mut *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_init");
    let env = get_env!(env_);
    // SAFETY: async_ctx is a valid out-pointer per N-API contract.
    unsafe { *async_ctx = env as *const _ as *mut c_void };
    env.ok()
}

// we don't support async contexts
#[unsafe(no_mangle)]
pub extern "C" fn napi_async_destroy(env_: napi_env, _async_ctx: *mut c_void) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_destroy");
    let env = get_env!(env_);
    env.ok()
}

// this is just a regular function call
#[unsafe(no_mangle)]
pub extern "C" fn napi_make_callback(
    env_: napi_env,
    _async_ctx: *mut c_void,
    recv_: napi_value,
    func_: napi_value,
    arg_count: usize,
    args: *const napi_value,
    maybe_result: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_make_callback");
    let env = get_env!(env_);
    let (recv, func) = (recv_.get(), func_.get());
    if func.is_empty_or_undefined_or_null() || (!func.is_callable() && !func.is_async_context_frame()) {
        return NapiEnv::set_last_error(Some(env), NapiStatus::function_expected);
    }

    let this_value = if !recv.is_empty() { recv } else { JSValue::UNDEFINED };
    let args_slice: &[JSValue] = if arg_count > 0 && !args.is_null() {
        // SAFETY: napi_value is repr(transparent) over i64, same as JSValue; caller guarantees
        // [args, args+arg_count) is valid.
        unsafe { core::slice::from_raw_parts(args as *const JSValue, arg_count) }
    } else {
        &[]
    };

    let res = match func.call(env.to_js(), this_value, args_slice) {
        Ok(v) => v,
        // TODO: handle errors correctly
        Err(err) => env.to_js().take_exception(err),
    };

    if let Some(result) = unsafe { maybe_result.as_mut() } {
        result.set(env, res);
    }

    // TODO: this is likely incorrect
    if res.is_any_error() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception);
    }

    env.ok()
}

// Sometimes shared libraries reference symbols which are not used
// We don't want to fail to load the library because of that
// so we instead return an error and warn the user
fn not_implemented_yet(name: &'static str) {
    // TODO(port): bun.onceUnsafe — emit warning only once per `name`.
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        if VirtualMachine::get().log().level().at_least(bun_logger::Level::Warn) {
            bun_core::Output::pretty_errorln(
                format_args!(
                    "<r><yellow>warning<r><d>:<r> Node-API function <b>\"{}\"<r> is not implemented yet.\n Track the status of Node-API in Bun: https://github.com/oven-sh/bun/issues/158",
                    name
                ),
            );
            bun_core::Output::flush();
        }
    });
    let _ = name;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_open_escapable_handle_scope(
    env_: napi_env,
    result_: *mut napi_escapable_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_escapable_handle_scope");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    *result = NapiHandleScope::open(env, true);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_close_escapable_handle_scope(
    env_: napi_env,
    scope: napi_escapable_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_escapable_handle_scope");
    let env = get_env!(env_);
    env.check_gc();
    if !scope.is_null() {
        NapiHandleScope::close(scope, env);
    }
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_escape_handle(
    env_: napi_env,
    scope_: napi_escapable_handle_scope,
    escapee: napi_value,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_escape_handle");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    // SAFETY: scope_ is a raw NAPI handle; non-null is treated as &NapiHandleScope.
    let Some(scope) = (unsafe { scope_.as_ref() }) else {
        return env.invalid_arg();
    };
    if scope.escape(escapee.get()).is_err() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::escape_called_twice);
    }
    *result = escapee;
    env.ok()
}

unsafe extern "C" {
    pub fn napi_type_tag_object(env: napi_env, value: napi_value, tag: *const napi_type_tag) -> napi_status;
    pub fn napi_check_object_type_tag(env: napi_env, value: napi_value, tag: *const napi_type_tag, result: *mut bool) -> napi_status;
}

// do nothing for both of these
#[unsafe(no_mangle)]
pub extern "C" fn napi_open_callback_scope(
    _env: napi_env,
    _resource: napi_value,
    _context: *mut c_void,
    _result: *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_callback_scope");
    NapiStatus::ok as napi_status
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_close_callback_scope(_env: napi_env, _scope: *mut c_void) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_callback_scope");
    NapiStatus::ok as napi_status
}

unsafe extern "C" {
    pub fn napi_throw(env: napi_env, error: napi_value) -> napi_status;
    pub fn napi_throw_error(env: napi_env, code: *const c_char, msg: *const c_char) -> napi_status;
    pub fn napi_throw_type_error(env: napi_env, code: *const c_char, msg: *const c_char) -> napi_status;
    pub fn napi_throw_range_error(env: napi_env, code: *const c_char, msg: *const c_char) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_is_error(env_: napi_env, value_: napi_value, result: *mut bool) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_error");
    let env = get_env!(env_);
    env.check_gc();
    let value = value_.get();
    // SAFETY: result is a valid out-pointer per N-API contract.
    unsafe { *result = value.is_any_error() };
    env.ok()
}

unsafe extern "C" {
    pub fn napi_is_exception_pending(env: napi_env, result: *mut bool) -> napi_status;
    pub fn napi_get_and_clear_last_exception(env: napi_env, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_is_arraybuffer(
    env_: napi_env,
    value_: napi_value,
    result_: *mut bool,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_arraybuffer");
    let env = get_env!(env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let value = value_.get();
    *result = !value.is_number() && value.js_type_loose() == jsc::JSType::ArrayBuffer;
    env.ok()
}

unsafe extern "C" {
    // TODO(port): Zig signature has `data: [*]const u8`; N-API spec says `void**` out-param — verify in Phase B which is the source of truth.
    pub fn napi_create_arraybuffer(env: napi_env, byte_length: usize, data: *mut *mut c_void, result: *mut napi_value) -> napi_status;
    pub fn napi_create_external_arraybuffer(env: napi_env, external_data: *mut c_void, byte_length: usize, finalize_cb: napi_finalize, finalize_hint: *mut c_void, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_arraybuffer_info(
    env_: napi_env,
    arraybuffer_: napi_value,
    data: *mut *mut u8,
    byte_length: *mut usize,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_arraybuffer_info");
    let env = get_env!(env_);
    env.check_gc();
    let arraybuffer = arraybuffer_.get();
    let Some(array_buffer) = arraybuffer.as_array_buffer(env.to_js()) else {
        return NapiEnv::set_last_error(Some(env), NapiStatus::invalid_arg);
    };
    if array_buffer.typed_array_type != jsc::TypedArrayType::ArrayBuffer {
        return NapiEnv::set_last_error(Some(env), NapiStatus::invalid_arg);
    }

    if let Some(dat) = unsafe { data.as_mut() } {
        *dat = array_buffer.ptr;
    }
    if let Some(len) = unsafe { byte_length.as_mut() } {
        *len = array_buffer.byte_len;
    }
    env.ok()
}

unsafe extern "C" {
    pub fn napi_is_typedarray(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_typedarray_info(
    env_: napi_env,
    typedarray_: napi_value,
    maybe_type: *mut napi_typedarray_type,
    maybe_length: *mut usize,
    maybe_data: *mut *mut u8,
    maybe_arraybuffer: *mut napi_value,
    maybe_byte_offset: *mut usize, // note: this is always 0
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_typedarray_info");
    let env = get_env!(env_);
    env.check_gc();
    let typedarray = typedarray_.get();
    if typedarray.is_empty_or_undefined_or_null() {
        return env.invalid_arg();
    }
    let _keep = jsc::EnsureStillAlive(typedarray);

    let Some(array_buffer) = typedarray.as_array_buffer(env.to_js()) else {
        return env.invalid_arg();
    };
    if let Some(ty) = unsafe { maybe_type.as_mut() } {
        let Some(napi_ty) = array_buffer.typed_array_type.to_typed_array_type().to_napi() else {
            return env.invalid_arg();
        };
        *ty = napi_ty;
    }

    // TODO: handle detached
    if let Some(data) = unsafe { maybe_data.as_mut() } {
        *data = array_buffer.ptr;
    }

    if let Some(length) = unsafe { maybe_length.as_mut() } {
        *length = array_buffer.len;
    }

    if let Some(arraybuffer) = unsafe { maybe_arraybuffer.as_mut() } {
        arraybuffer.set(
            env,
            JSValue::c(jsc::c_api::JSObjectGetTypedArrayBuffer(
                env.to_js().ref_(),
                typedarray.as_object_ref(),
                ptr::null_mut(),
            )),
        );
    }

    if let Some(byte_offset) = unsafe { maybe_byte_offset.as_mut() } {
        // `jsc::ArrayBuffer` used to have an `offset` field, but it was always 0 because `ptr`
        // already had the offset applied. See <https://github.com/oven-sh/bun/issues/561>.
        // *byte_offset = array_buffer.offset;
        *byte_offset = 0;
    }
    env.ok()
}

unsafe extern "C" {
    pub fn napi_create_dataview(env: napi_env, length: usize, arraybuffer: napi_value, byte_offset: usize, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_is_dataview(env_: napi_env, value_: napi_value, result_: *mut bool) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_dataview");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let value = value_.get();
    *result = !value.is_empty_or_undefined_or_null() && value.js_type_loose() == jsc::JSType::DataView;
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_dataview_info(
    env_: napi_env,
    dataview_: napi_value,
    maybe_bytelength: *mut usize,
    maybe_data: *mut *mut u8,
    maybe_arraybuffer: *mut napi_value,
    maybe_byte_offset: *mut usize, // note: this is always 0
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_dataview_info");
    let env = get_env!(env_);
    env.check_gc();
    let dataview = dataview_.get();
    let Some(array_buffer) = dataview.as_array_buffer(env.to_js()) else {
        return NapiEnv::set_last_error(Some(env), NapiStatus::object_expected);
    };
    if let Some(bytelength) = unsafe { maybe_bytelength.as_mut() } {
        *bytelength = array_buffer.byte_len;
    }
    if let Some(data) = unsafe { maybe_data.as_mut() } {
        *data = array_buffer.ptr;
    }
    if let Some(arraybuffer) = unsafe { maybe_arraybuffer.as_mut() } {
        arraybuffer.set(
            env,
            JSValue::c(jsc::c_api::JSObjectGetTypedArrayBuffer(
                env.to_js().ref_(),
                dataview.as_object_ref(),
                ptr::null_mut(),
            )),
        );
    }
    if let Some(byte_offset) = unsafe { maybe_byte_offset.as_mut() } {
        // `jsc::ArrayBuffer` used to have an `offset` field, but it was always 0 because `ptr`
        // already had the offset applied. See <https://github.com/oven-sh/bun/issues/561>.
        // *byte_offset = array_buffer.offset;
        *byte_offset = 0;
    }

    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_version(env_: napi_env, result_: *mut u32) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_version");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // The result is supposed to be the highest NAPI version Bun supports, rather than the version reported by a NAPI module.
    *result = 9;
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_promise(
    env_: napi_env,
    deferred_: *mut napi_deferred,
    promise_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_promise");
    let env = get_env!(env_);
    let deferred = get_out!(env, deferred_);
    let promise = get_out!(env, promise_);
    let strong = Box::new(JSPromise::Strong::init(env.to_js()));
    let strong_ptr = Box::into_raw(strong);
    *deferred = strong_ptr;
    // SAFETY: strong_ptr was just created from Box::into_raw and is non-null.
    let prom_value = unsafe { (*strong_ptr).get() }.as_value(env.to_js());
    promise.set(env, prom_value);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_resolve_deferred(
    env_: napi_env,
    deferred: napi_deferred,
    resolution_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_resolve_deferred");
    let env = get_env!(env_);
    // SAFETY: deferred was created by Box::into_raw in napi_create_promise.
    let deferred_box = unsafe { Box::from_raw(deferred) };
    // `deferred_box` drops at scope exit (deinit + free).
    let resolution = resolution_.get();
    let prom = deferred_box.get();
    if prom.resolve(env.to_js(), resolution).is_err() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception);
    }
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_reject_deferred(
    env_: napi_env,
    deferred: napi_deferred,
    rejection_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_reject_deferred");
    let env = get_env!(env_);
    // SAFETY: deferred was created by Box::into_raw in napi_create_promise.
    let deferred_box = unsafe { Box::from_raw(deferred) };
    let rejection = rejection_.get();
    let prom = deferred_box.get();
    if prom.reject(env.to_js(), rejection).is_err() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception);
    }
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_is_promise(
    env_: napi_env,
    value_: napi_value,
    is_promise_: *mut bool,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_promise");
    let env = get_env!(env_);
    env.check_gc();
    let value = value_.get();
    let is_promise = get_out!(env, is_promise_);

    if value.is_empty() {
        return env.invalid_arg();
    }

    *is_promise = value.as_any_promise().is_some();
    env.ok()
}

unsafe extern "C" {
    pub fn napi_run_script(env: napi_env, script: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_adjust_external_memory(env: napi_env, change_in_bytes: i64, adjusted_value: *mut i64) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_date(env_: napi_env, time: f64, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_date");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let mut args = [JSValue::js_number(time).as_object_ref()];
    result.set(
        env,
        JSValue::c(jsc::c_api::JSObjectMakeDate(
            env.to_js().ref_(),
            1,
            args.as_mut_ptr(),
            TODO_EXCEPTION,
        )),
    );
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_is_date(env_: napi_env, value_: napi_value, is_date_: *mut bool) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_date");
    let env = get_env!(env_);
    env.check_gc();
    let is_date = get_out!(env, is_date_);
    let value = value_.get();
    *is_date = value.js_type_loose() == jsc::JSType::JSDate;
    env.ok()
}

unsafe extern "C" {
    pub fn napi_get_date_value(env: napi_env, value: napi_value, result: *mut f64) -> napi_status;
    pub fn napi_add_finalizer(env: napi_env, js_object: napi_value, native_object: *mut c_void, finalize_cb: napi_finalize, finalize_hint: *mut c_void, result: napi_ref) -> napi_status;
    pub fn napi_create_bigint_int64(env: napi_env, value: i64, result: *mut napi_value) -> napi_status;
    pub fn napi_create_bigint_uint64(env: napi_env, value: u64, result: *mut napi_value) -> napi_status;
    pub fn napi_create_bigint_words(env: napi_env, sign_bit: c_int, word_count: usize, words: *const u64, result: *mut napi_value) -> napi_status;
    pub fn napi_get_value_bigint_int64(env: napi_env, value: napi_value, result: *mut i64, lossless: *mut bool) -> napi_status;
    pub fn napi_get_value_bigint_uint64(env: napi_env, value: napi_value, result: *mut u64, lossless: *mut bool) -> napi_status;
    pub fn napi_get_value_bigint_words(env: napi_env, value: napi_value, sign_bit: *mut c_int, word_count: *mut usize, words: *mut u64) -> napi_status;
    pub fn napi_get_all_property_names(env: napi_env, object: napi_value, key_mode: napi_key_collection_mode, key_filter: napi_key_filter, key_conversion: napi_key_conversion, result: *mut napi_value) -> napi_status;
    pub fn napi_set_instance_data(env: napi_env, data: *mut c_void, finalize_cb: napi_finalize, finalize_hint: *mut c_void) -> napi_status;
    pub fn napi_get_instance_data(env: napi_env, data: *mut *mut c_void) -> napi_status;
    pub fn napi_detach_arraybuffer(env: napi_env, arraybuffer: napi_value) -> napi_status;
    pub fn napi_is_detached_arraybuffer(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
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

/// must be globally allocated
pub struct napi_async_work {
    pub task: WorkPoolTask,
    pub concurrent_task: ConcurrentTask,
    pub event_loop: &'static EventLoop,
    pub global: &'static JSGlobalObject, // JSC_BORROW (lives for vm lifetime)
    pub env: NapiEnvRef,
    pub execute: napi_async_execute_callback,
    pub complete: Option<napi_async_complete_callback>,
    pub data: *mut c_void,
    pub status: AtomicU32, // AsyncWorkStatus
    pub scheduled: bool,
    pub poll_ref: KeepAlive,
}

impl napi_async_work {
    pub fn new(
        env: &NapiEnv,
        execute: napi_async_execute_callback,
        complete: Option<napi_async_complete_callback>,
        data: *mut c_void,
    ) -> *mut napi_async_work {
        let global = env.to_js();

        // TODO(port): lifetime — global/event_loop are borrowed for the VM lifetime; transmute
        // to 'static here matching Zig's raw-pointer field semantics.
        let global_static: &'static JSGlobalObject =
            unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global) };

        Box::into_raw(Box::new(napi_async_work {
            task: WorkPoolTask::new(Self::run_from_thread_pool),
            concurrent_task: ConcurrentTask::default(),
            global: global_static,
            env: NapiEnvRef::clone_from_raw(env),
            execute,
            event_loop: global.bun_vm().event_loop(),
            complete,
            data,
            status: AtomicU32::new(AsyncWorkStatus::Pending as u32),
            scheduled: false,
            poll_ref: KeepAlive::default(),
        }))
    }

    pub fn destroy(this: *mut napi_async_work) {
        // SAFETY: `this` was created by Box::into_raw in `new`.
        // env.deinit() runs via Drop on NapiEnvRef.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn schedule(&mut self) {
        if self.scheduled {
            return;
        }
        self.scheduled = true;
        self.poll_ref.ref_(self.global.bun_vm());
        WorkPool::schedule(&mut self.task);
    }

    pub extern "C" fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: task points to napi_async_work.task; recover parent via offset_of.
        let this: &mut napi_async_work = unsafe {
            &mut *(task as *mut u8)
                .sub(core::mem::offset_of!(napi_async_work, task))
                .cast::<napi_async_work>()
        };
        this.run();
    }

    fn run(&mut self) {
        if let Err(state) = self.status.compare_exchange(
            AsyncWorkStatus::Pending as u32,
            AsyncWorkStatus::Started as u32,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            if state == AsyncWorkStatus::Cancelled as u32 {
                self.event_loop
                    .enqueue_task_concurrent(self.concurrent_task.from(self, jsc::ManualDeinit));
                return;
            }
        }
        (self.execute)(self.env.get(), self.data);
        self.status
            .store(AsyncWorkStatus::Completed as u32, Ordering::SeqCst);

        self.event_loop
            .enqueue_task_concurrent(self.concurrent_task.from(self, jsc::ManualDeinit));
    }

    pub fn cancel(&mut self) -> bool {
        self.status
            .compare_exchange(
                AsyncWorkStatus::Pending as u32,
                AsyncWorkStatus::Cancelled as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    pub fn run_from_js(&mut self, vm: &VirtualMachine, global: &JSGlobalObject) {
        // Note: the "this" value here may already be freed by the user in `complete`
        let mut poll_ref = self.poll_ref;
        let _guard = scopeguard::guard((), |_| poll_ref.unref(vm));

        // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1201
        let Some(complete) = self.complete else {
            return;
        };

        let env = self.env.get();
        // SAFETY: env is held alive by NapiEnvRef for the duration of this call.
        let handle_scope = NapiHandleScope::open(unsafe { &*env }, false);
        let _hs_guard = scopeguard::guard((), |_| {
            if !handle_scope.is_null() {
                // SAFETY: env is held alive by NapiEnvRef; handle_scope is the current scope opened above.
                NapiHandleScope::close(handle_scope, unsafe { &*env });
            }
        });

        let status: NapiStatus = if self.status.load(Ordering::SeqCst) == AsyncWorkStatus::Cancelled as u32 {
            NapiStatus::cancelled
        } else {
            NapiStatus::ok
        };

        complete(env, status as napi_status, self.data);

        // SAFETY: env is valid for the duration of this call.
        let env_ref = unsafe { &*env };
        if let Some(exception) = env_ref.get_and_clear_pending_exception() {
            let _ = vm.uncaught_exception(global, exception, false);
        } else if global.has_exception() {
            global.report_active_exception_as_unhandled(jsc::JsError::Thrown);
        }
    }
}

pub type napi_threadsafe_function = *mut ThreadSafeFunction;

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum napi_threadsafe_function_release_mode {
    release = 0,
    abort = 1,
}

pub const NAPI_TSFN_NONBLOCKING: c_uint = 0;
pub const NAPI_TSFN_BLOCKING: c_uint = 1;
pub type napi_threadsafe_function_call_mode = c_uint;
pub type napi_async_execute_callback = extern "C" fn(napi_env, *mut c_void);
pub type napi_async_complete_callback = extern "C" fn(napi_env, napi_status, *mut c_void);
pub type napi_threadsafe_function_call_js =
    extern "C" fn(napi_env, napi_value, *mut c_void, *mut c_void);

#[repr(C)]
pub struct napi_node_version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub release: *const c_char,
}

// SAFETY: napi_node_version is POD; the *const c_char points at a static literal.
unsafe impl Sync for napi_node_version {}

// TODO(port): std.SemanticVersion.parse(bun.Environment.reported_nodejs_version) at comptime.
// Phase B should generate these constants from `reported_nodejs_version`.
pub static NAPI_NODE_VERSION_GLOBAL: napi_node_version = napi_node_version {
    major: bun_core::Environment::REPORTED_NODEJS_VERSION_MAJOR,
    minor: bun_core::Environment::REPORTED_NODEJS_VERSION_MINOR,
    patch: bun_core::Environment::REPORTED_NODEJS_VERSION_PATCH,
    release: b"node\0".as_ptr() as *const c_char,
};

#[repr(C)]
pub struct struct_napi_async_cleanup_hook_handle__ {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
pub type napi_async_cleanup_hook_handle = *mut struct_napi_async_cleanup_hook_handle__;
pub type napi_async_cleanup_hook =
    Option<extern "C" fn(napi_async_cleanup_hook_handle, *mut c_void)>;

pub type napi_addon_register_func = extern "C" fn(napi_env, napi_value) -> napi_value;

#[repr(C)]
pub struct struct_napi_module {
    pub nm_version: c_int,
    pub nm_flags: c_uint,
    pub nm_filename: *const c_char,
    pub nm_register_func: napi_addon_register_func,
    pub nm_modname: *const c_char,
    pub nm_priv: *mut c_void,
    pub reserved: [*mut c_void; 4],
}
pub type napi_module = struct_napi_module;

fn napi_span(ptr: *const u8, len: usize) -> &'static [u8] {
    // SAFETY: caller-supplied C string region; lifetime is the duration of the NAPI call.
    // We use 'static here to match Zig's `[]const u8` borrow semantics across the FFI boundary.
    if ptr.is_null() {
        return &[];
    }

    if len == NAPI_AUTO_LENGTH {
        return unsafe { core::ffi::CStr::from_ptr(ptr as *const c_char) }.to_bytes();
    }

    unsafe { core::slice::from_raw_parts(ptr, len) }
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_fatal_error(
    location_ptr: *const u8,
    location_len: usize,
    message_ptr: *const u8,
    message_len_: usize,
) -> ! {
    bun_output::scoped_log!(napi, "napi_fatal_error");
    napi_internal_suppress_crash_on_abort_if_desired();
    let mut message = napi_span(message_ptr, message_len_);
    if message.is_empty() {
        message = b"fatal error";
    }

    let location = napi_span(location_ptr, location_len);
    if !location.is_empty() {
        bun_core::Output::panic(format_args!(
            "NAPI FATAL ERROR: {} {}",
            bstr::BStr::new(location),
            bstr::BStr::new(message)
        ));
    }

    bun_core::Output::panic(format_args!("napi: {}", bstr::BStr::new(message)));
}

unsafe extern "C" {
    pub fn napi_create_buffer(env: napi_env, length: usize, data: *mut *mut c_void, result: *mut napi_value) -> napi_status;
    pub fn napi_create_external_buffer(env: napi_env, length: usize, data: *mut c_void, finalize_cb: napi_finalize, finalize_hint: *mut c_void, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_buffer_copy(
    env_: napi_env,
    length: usize,
    data: *const u8,
    result_data: *mut *mut c_void,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_buffer_copy: {}", length);
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let buffer = match JSValue::create_buffer_from_length(env.to_js(), length) {
        Ok(b) => b,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    if let Some(array_buf) = buffer.as_array_buffer(env.to_js()) {
        if length > 0 {
            // SAFETY: caller guarantees `data` points to at least `length` bytes.
            let src = unsafe { core::slice::from_raw_parts(data, length) };
            array_buf.slice_mut()[..length].copy_from_slice(src);
        }
        if let Some(ptr_out) = unsafe { result_data.as_mut() } {
            *ptr_out = if length > 0 {
                array_buf.ptr as *mut c_void
            } else {
                ptr::null_mut()
            };
        }
    }

    result.set(env, buffer);

    env.ok()
}

unsafe extern "C" {
    fn napi_is_buffer(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_buffer_info(
    env_: napi_env,
    value_: napi_value,
    data: *mut *mut u8,
    length: *mut usize,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_buffer_info");
    let env = get_env!(env_);
    let value = value_.get();
    let Some(array_buf) = value.as_array_buffer(env.to_js()) else {
        return NapiEnv::set_last_error(Some(env), NapiStatus::invalid_arg);
    };

    if let Some(dat) = unsafe { data.as_mut() } {
        *dat = array_buf.ptr;
    }

    if let Some(len) = unsafe { length.as_mut() } {
        *len = array_buf.byte_len;
    }

    env.ok()
}

unsafe extern "C" {
    fn node_api_create_syntax_error(env: napi_env, code: napi_value, msg: napi_value, result: *mut napi_value) -> napi_status;
    fn node_api_symbol_for(env: napi_env, utf8: *const c_char, length: usize, result: *mut napi_value) -> napi_status;
    fn node_api_throw_syntax_error(env: napi_env, code: *const c_char, msg: *const c_char) -> napi_status;
    fn node_api_create_external_string_latin1(env: napi_env, str_: *mut u8, length: usize, finalize_cb: napi_finalize, finalize_hint: *mut c_void, result: *mut JSValue, copied: *mut bool) -> napi_status;
    fn node_api_create_external_string_utf16(env: napi_env, str_: *mut u16, length: usize, finalize_cb: napi_finalize, finalize_hint: *mut c_void, result: *mut JSValue, copied: *mut bool) -> napi_status;
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_async_work(
    env_: napi_env,
    _async_resource: napi_value,
    _async_resource_name: *const c_char,
    execute_: Option<napi_async_execute_callback>,
    complete: Option<napi_async_complete_callback>,
    data: *mut c_void,
    result_: *mut *mut napi_async_work,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_async_work");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1245
    let Some(execute) = execute_ else {
        return env.invalid_arg();
    };
    *result = napi_async_work::new(env, execute, complete, data);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_delete_async_work(env_: napi_env, work_: *mut napi_async_work) -> napi_status {
    bun_output::scoped_log!(napi, "napi_delete_async_work");
    let env = get_env!(env_);
    let Some(work) = (unsafe { work_.as_mut() }) else {
        return env.invalid_arg();
    };
    if cfg!(debug_assertions) {
        debug_assert!(core::ptr::eq(env.to_js(), work.global));
    }
    napi_async_work::destroy(work_);
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_queue_async_work(env_: napi_env, work_: *mut napi_async_work) -> napi_status {
    bun_output::scoped_log!(napi, "napi_queue_async_work");
    let env = get_env!(env_);
    let Some(work) = (unsafe { work_.as_mut() }) else {
        return env.invalid_arg();
    };
    if cfg!(debug_assertions) {
        debug_assert!(core::ptr::eq(env.to_js(), work.global));
    }
    work.schedule();
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_cancel_async_work(env_: napi_env, work_: *mut napi_async_work) -> napi_status {
    bun_output::scoped_log!(napi, "napi_cancel_async_work");
    let env = get_env!(env_);
    let Some(work) = (unsafe { work_.as_mut() }) else {
        return env.invalid_arg();
    };
    if cfg!(debug_assertions) {
        debug_assert!(core::ptr::eq(env.to_js(), work.global));
    }
    if work.cancel() {
        return env.ok();
    }

    env.generic_failure()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_node_version(
    env_: napi_env,
    version_: *mut *const napi_node_version,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_node_version");
    let env = get_env!(env_);
    let version = get_out!(env, version_);
    *version = &NAPI_NODE_VERSION_GLOBAL;
    env.ok()
}

#[cfg(windows)]
type napi_event_loop = *mut bun_sys::windows::libuv::Loop;
#[cfg(not(windows))]
type napi_event_loop = *mut EventLoop;

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_uv_event_loop(env_: napi_env, loop_: *mut napi_event_loop) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_uv_event_loop");
    let env = get_env!(env_);
    let loop_out = get_out!(env, loop_);
    #[cfg(windows)]
    {
        // alignment error is incorrect.
        // TODO(@190n) investigate
        // SAFETY: see Zig — @setRuntimeSafety(false) was used here.
        *loop_out = VirtualMachine::get().uv_loop();
    }
    #[cfg(not(windows))]
    {
        // there is no uv event loop on posix, we use our event loop handle.
        *loop_out = env.to_js().bun_vm().event_loop() as *const _ as *mut _;
    }
    env.ok()
}

unsafe extern "C" {
    pub fn napi_fatal_exception(env: napi_env, err: napi_value) -> napi_status;
    pub fn napi_add_async_cleanup_hook(env: napi_env, function: napi_async_cleanup_hook, data: *mut c_void, handle_out: *mut napi_async_cleanup_hook_handle) -> napi_status;
    pub fn napi_add_env_cleanup_hook(env: napi_env, function: Option<extern "C" fn(*mut c_void)>, data: *mut c_void) -> napi_status;
    pub fn napi_create_typedarray(env: napi_env, type_: napi_typedarray_type, length: usize, arraybuffer: napi_value, byte_offset: usize, result: *mut napi_value) -> napi_status;
    pub fn napi_remove_async_cleanup_hook(handle: napi_async_cleanup_hook_handle) -> napi_status;
    pub fn napi_remove_env_cleanup_hook(env: napi_env, function: Option<extern "C" fn(*mut c_void)>, data: *mut c_void) -> napi_status;

    fn napi_internal_cleanup_env_cpp(env: napi_env);
    fn napi_internal_check_gc(env: napi_env);
}

extern "C" fn napi_internal_register_cleanup_callback(data: *mut c_void) {
    // SAFETY: data is the napi_env we registered below.
    unsafe { napi_internal_cleanup_env_cpp(data as napi_env) };
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_internal_register_cleanup_zig(env_: napi_env) {
    // SAFETY: caller guarantees env_ is non-null (Zig used `.?`).
    let env = unsafe { &*env_ };
    env.to_js().bun_vm().rare_data().push_cleanup_hook(
        env.to_js(),
        env_ as *mut c_void,
        napi_internal_register_cleanup_callback,
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_internal_suppress_crash_on_abort_if_desired() {
    if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT.get() {
        bun_crash_handler::suppress_reporting();
    }
}

unsafe extern "C" {
    fn napi_internal_remove_finalizer(env: napi_env, fun: napi_finalize, hint: *mut c_void, data: *mut c_void);
}

// ──────────────────────────────────────────────────────────────────────────
// Finalizer
// ──────────────────────────────────────────────────────────────────────────

pub struct Finalizer {
    pub env: NapiEnvRef,
    pub fun: NapiFinalizeFunction,
    pub data: *mut c_void,
    pub hint: *mut c_void,
}

impl Finalizer {
    pub fn run(&mut self) {
        let env = self.env.get();
        // SAFETY: env is valid for the duration of this call.
        let env_ref = unsafe { &*env };
        let handle_scope = NapiHandleScope::open(env_ref, false);
        let _hs_guard = scopeguard::guard((), |_| {
            if !handle_scope.is_null() {
                NapiHandleScope::close(handle_scope, env_ref);
            }
        });

        (self.fun)(env, self.data, self.hint);
        // SAFETY: env is valid; passes the C finalizer back for bookkeeping.
        unsafe { napi_internal_remove_finalizer(env, Some(self.fun), self.hint, self.data) };

        if let Some(exception) = env_ref.to_js().try_take_exception() {
            let _ = env_ref
                .to_js()
                .bun_vm()
                .uncaught_exception(env_ref.to_js(), exception, false);
        }

        if let Some(exception) = env_ref.get_and_clear_pending_exception() {
            let _ = env_ref
                .to_js()
                .bun_vm()
                .uncaught_exception(env_ref.to_js(), exception, false);
        }
    }

    // `deinit` is handled by Drop on NapiEnvRef.

    /// Takes ownership of `this`.
    pub fn enqueue(self) {
        NapiFinalizerTask::init(self).schedule();
    }
}

/// For Node-API modules not built with NAPI_EXPERIMENTAL, finalizers should be deferred to the
/// immediate task queue instead of run immediately. This lets finalizers perform allocations,
/// which they couldn't if they ran immediately while the garbage collector is still running.
#[unsafe(no_mangle)]
pub extern "C" fn napi_internal_enqueue_finalizer(
    env: napi_env,
    fun: napi_finalize,
    data: *mut c_void,
    hint: *mut c_void,
) {
    let Some(fun) = fun else { return };
    // SAFETY: env may be null per Zig's `orelse return`.
    let Some(env_ref) = (unsafe { env.as_ref() }) else { return };
    let this = Finalizer {
        fun,
        env: NapiEnvRef::clone_from_raw(env_ref),
        data,
        hint,
    };
    this.enqueue();
}

// ──────────────────────────────────────────────────────────────────────────
// ThreadSafeFunction
// ──────────────────────────────────────────────────────────────────────────

// TODO: generate comptime version of this instead of runtime checking
pub struct ThreadSafeFunction {
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
    pub poll_ref: KeepAlive,

    // User implementation error can cause this number to go negative.
    pub thread_count: AtomicI64,
    // for std.condvar
    pub lock: Mutex,

    pub event_loop: &'static EventLoop,
    pub tracker: Debugger::AsyncTaskTracker,

    pub env: NapiEnvRef,
    pub finalizer_fun: napi_finalize,
    pub finalizer_data: *mut c_void,

    pub has_queued_finalizer: bool,
    pub queue: TsfnQueue,

    pub ctx: *mut c_void,

    pub callback: TsfnCallback,
    pub dispatch_state: AtomicU8, // DispatchState
    pub blocking_condvar: Condvar,
    pub closing: AtomicU8, // ClosingState
    pub aborted: AtomicBool,
}

pub enum TsfnCallback {
    Js(Strong::Optional),
    C {
        js: Strong::Optional,
        napi_threadsafe_function_call_js: napi_threadsafe_function_call_js,
    },
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
pub enum DispatchState {
    Idle,
    Running,
    Pending,
}

pub struct TsfnQueue {
    pub data: LinearFifo<*mut c_void>,
    /// This value will never change after initialization. Zero means the size is unlimited.
    pub max_queue_size: usize,
    pub count: AtomicU32,
}

impl TsfnQueue {
    pub fn init(max_queue_size: usize) -> TsfnQueue {
        TsfnQueue {
            data: LinearFifo::new(),
            max_queue_size,
            count: AtomicU32::new(0),
        }
    }

    pub fn is_blocked(&self) -> bool {
        self.max_queue_size > 0 && self.count.load(Ordering::SeqCst) as usize >= self.max_queue_size
    }
}

// Drop on TsfnQueue: LinearFifo drops itself.

impl ThreadSafeFunction {
    pub fn new(init: ThreadSafeFunction) -> *mut ThreadSafeFunction {
        Box::into_raw(Box::new(init))
    }

    // This has two states:
    // 1. We need to run potentially multiple tasks.
    // 2. We need to finalize the ThreadSafeFunction.
    pub fn on_dispatch(this: *mut ThreadSafeFunction) {
        // SAFETY: `this` is a live heap allocation owned by the event loop dispatch.
        let self_ = unsafe { &mut *this };
        if self_.closing.load(Ordering::SeqCst) == ClosingState::Closed as u8 {
            // Finalize the ThreadSafeFunction.
            // SAFETY: `this` is the live heap allocation we own; closed state guarantees no other thread will touch it.
            unsafe { ThreadSafeFunction::destroy(this) };
            return;
        }

        let mut is_first = true;

        // Run the tasks.
        loop {
            self_
                .dispatch_state
                .store(DispatchState::Running as u8, Ordering::SeqCst);
            if self_.dispatch_one(is_first) {
                is_first = false;
                self_
                    .dispatch_state
                    .store(DispatchState::Pending as u8, Ordering::SeqCst);
            } else {
                // We're done running tasks, for now.
                self_
                    .dispatch_state
                    .store(DispatchState::Idle as u8, Ordering::SeqCst);
                break;
            }
        }

        // Node sets a maximum number of runs per ThreadSafeFunction to 1,000.
        // We don't set a max. I would like to see an issue caused by not
        // setting a max before we do set a max. It is better for performance to
        // not add unnecessary event loop ticks.
    }

    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst) != ClosingState::NotClosing as u8
    }

    fn maybe_queue_finalizer(&mut self) {
        let prev = self.closing.swap(ClosingState::Closed as u8, Ordering::SeqCst);
        match prev {
            x if x == ClosingState::Closing as u8 || x == ClosingState::NotClosing as u8 => {
                // TODO: is this boolean necessary? Can we rely just on the closing value?
                if !self.has_queued_finalizer {
                    self.has_queued_finalizer = true;
                    // TODO(port): callback.deinit() — Strong handles drop on Drop; here we must
                    // explicitly clear before enqueuing the finalize task to match Zig ordering.
                    // PORT NOTE: replace callback with a no-op variant to drop Strong now.
                    self.callback = TsfnCallback::Js(Strong::Optional::empty());
                    self.poll_ref.disable();
                    self.event_loop.enqueue_task(Task::init(self));
                }
            }
            _ => {
                // already scheduled.
            }
        }
    }

    pub fn dispatch_one(&mut self, is_first: bool) -> bool {
        let mut queue_finalizer_after_call = false;
        let (has_more, task) = 'brk: {
            self.lock.lock();
            let _g = scopeguard::guard((), |_| self.lock.unlock());
            // PORT NOTE: reshaped for borrowck — Zig holds the lock across these reads.
            let was_blocked = self.queue.is_blocked();
            let Some(t) = self.queue.data.read_item() else {
                // When there are no tasks and the number of threads that have
                // references reaches zero, we prepare to finalize the
                // ThreadSafeFunction.
                if self.thread_count.load(Ordering::SeqCst) == 0 {
                    if self.queue.max_queue_size > 0 {
                        self.blocking_condvar.signal();
                    }
                    self.maybe_queue_finalizer();
                }
                return false;
            };

            if self.queue.count.fetch_sub(1, Ordering::SeqCst) == 1
                && self.thread_count.load(Ordering::SeqCst) == 0
            {
                self.closing
                    .store(ClosingState::Closing as u8, Ordering::SeqCst);
                if self.queue.max_queue_size > 0 {
                    self.blocking_condvar.signal();
                }
                queue_finalizer_after_call = true;
            } else if was_blocked && !self.queue.is_blocked() {
                self.blocking_condvar.signal();
            }

            break 'brk (!self.is_closing(), t);
        };

        if self.call(task, !is_first).is_err() {
            return false;
        }

        if queue_finalizer_after_call {
            self.maybe_queue_finalizer();
        }

        has_more
    }

    /// This function can be called multiple times in one tick of the event loop.
    /// See: https://github.com/nodejs/node/pull/38506
    /// In that case, we need to drain microtasks.
    fn call(&mut self, task: *mut c_void, is_first: bool) -> Result<(), bun_jsc::JsTerminated> {
        let env = self.env.get();
        if !is_first {
            self.event_loop.drain_microtasks()?;
        }
        // SAFETY: env is valid while the TSF is live.
        let global_object = unsafe { &*env }.to_js();

        self.tracker.will_dispatch(global_object);
        let _g = scopeguard::guard((), |_| self.tracker.did_dispatch(global_object));

        match &self.callback {
            TsfnCallback::Js(strong) => {
                let js: JSValue = strong.get().unwrap_or(JSValue::UNDEFINED);
                if js.is_empty_or_undefined_or_null() {
                    return Ok(());
                }

                let _ = js
                    .call(global_object, JSValue::UNDEFINED, &[])
                    .map_err(|err| global_object.report_active_exception_as_unhandled(err));
            }
            TsfnCallback::C {
                js: cb_js,
                napi_threadsafe_function_call_js,
            } => {
                let js: JSValue = cb_js.get().unwrap_or(JSValue::UNDEFINED);

                let env_ref = unsafe { &*env };
                let handle_scope = NapiHandleScope::open(env_ref, false);
                let _hs_guard = scopeguard::guard((), |_| {
                    if !handle_scope.is_null() {
                        NapiHandleScope::close(handle_scope, env_ref);
                    }
                });
                napi_threadsafe_function_call_js(
                    env,
                    napi_value::create(env_ref, js),
                    self.ctx,
                    task,
                );
            }
        }
        Ok(())
    }

    pub fn enqueue(&mut self, ctx: *mut c_void, block: bool) -> napi_status {
        self.lock.lock();
        let _g = scopeguard::guard((), |_| self.lock.unlock());
        if block {
            while self.queue.is_blocked() {
                self.blocking_condvar.wait(&self.lock);
            }
        } else {
            if self.queue.is_blocked() {
                // don't set the error on the env as this is run from another thread
                return NapiStatus::queue_full as napi_status;
            }
        }

        if self.is_closing() {
            if self.thread_count.load(Ordering::SeqCst) <= 0 {
                return NapiStatus::invalid_arg as napi_status;
            }
            let _ = self.release(napi_threadsafe_function_release_mode::release, true);
            return NapiStatus::closing as napi_status;
        }

        let _ = self.queue.count.fetch_add(1, Ordering::SeqCst);
        // Zig: bun.handleOom — Rust Vec push aborts on OOM by default.
        self.queue.data.write_item(ctx);
        self.schedule_dispatch();
        NapiStatus::ok as napi_status
    }

    fn schedule_dispatch(&mut self) {
        let prev = self
            .dispatch_state
            .swap(DispatchState::Pending as u8, Ordering::SeqCst);
        match prev {
            x if x == DispatchState::Idle as u8 => {
                self.event_loop
                    .enqueue_task_concurrent(ConcurrentTask::create_from(self));
            }
            x if x == DispatchState::Running as u8 => {
                // it will check if it has more work to do
            }
            _ => {
                // we've already scheduled it to run
            }
        }
    }

    /// Consumes and frees a heap-allocated ThreadSafeFunction (allocated by `new`).
    /// SAFETY: `this` must be a live `*mut ThreadSafeFunction` returned from `Box::into_raw`
    /// and not aliased; caller transfers ownership.
    pub unsafe fn destroy(this: *mut ThreadSafeFunction) {
        // SAFETY: caller contract — `this` is a live heap allocation; we consume it here.
        let self_ = unsafe { &mut *this };
        self_.unref();

        if let Some(fun) = self_.finalizer_fun {
            // PORT NOTE: ownership transfer of `env` into the Finalizer; we move it out of `self`
            // before freeing the box. Matches Zig where the else-branch deinits `env` instead.
            // SAFETY: moving `env` out by value; field is overwritten with a zeroed sentinel below before Box drop.
            let env = unsafe { core::ptr::read(&self_.env) };
            let finalizer = Finalizer {
                env,
                fun,
                data: self_.finalizer_data,
                hint: self_.ctx,
            };
            finalizer.enqueue();
            // Prevent double-drop of env when the box is freed below.
            // SAFETY: NapiEnvRef is #[repr(C)] POD-ish; zeroed sentinel is a valid no-op-Drop state (verified in Phase B).
            unsafe { core::ptr::write(&mut self_.env, core::mem::zeroed()) };
            // TODO(port): verify NapiEnvRef has a no-op Drop for the zeroed sentinel.
        }
        // else-branch: `env` drops with the Box below.

        // callback.deinit() and queue.deinit() run via Drop.
        // SAFETY: `this` was allocated by Box::into_raw in `new`.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn ref_(&mut self) {
        self.poll_ref.ref_concurrently_from_event_loop(self.event_loop);
    }

    pub fn unref(&mut self) {
        self.poll_ref
            .unref_concurrently_from_event_loop(self.event_loop);
    }

    pub fn acquire(&mut self) -> napi_status {
        self.lock.lock();
        let _g = scopeguard::guard((), |_| self.lock.unlock());
        if self.is_closing() {
            return NapiStatus::closing as napi_status;
        }
        let _ = self.thread_count.fetch_add(1, Ordering::SeqCst);
        NapiStatus::ok as napi_status
    }

    pub fn release(
        &mut self,
        mode: napi_threadsafe_function_release_mode,
        already_locked: bool,
    ) -> napi_status {
        if !already_locked {
            self.lock.lock();
        }
        let _g = scopeguard::guard((), |_| {
            if !already_locked {
                self.lock.unlock();
            }
        });

        if self.thread_count.load(Ordering::SeqCst) < 0 {
            return NapiStatus::invalid_arg as napi_status;
        }

        let prev_remaining = self.thread_count.fetch_sub(1, Ordering::SeqCst);

        if mode == napi_threadsafe_function_release_mode::abort || prev_remaining == 1 {
            if !self.is_closing() {
                if mode == napi_threadsafe_function_release_mode::abort {
                    self.closing
                        .store(ClosingState::Closing as u8, Ordering::SeqCst);
                    self.aborted.store(true, Ordering::SeqCst);
                    if self.queue.max_queue_size > 0 {
                        self.blocking_condvar.signal();
                    }
                }
                self.schedule_dispatch();
            }
        }

        NapiStatus::ok as napi_status
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_threadsafe_function(
    env_: napi_env,
    func_: napi_value,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    max_queue_size: usize,
    initial_thread_count: usize,
    thread_finalize_data: *mut c_void,
    thread_finalize_cb: napi_finalize,
    context: *mut c_void,
    call_js_cb: Option<napi_threadsafe_function_call_js>,
    result_: *mut napi_threadsafe_function,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_threadsafe_function");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let func = func_.get();

    if call_js_cb.is_none()
        && (func.is_empty_or_undefined_or_null()
            || (!func.is_callable() && !func.is_async_context_frame()))
    {
        return NapiEnv::set_last_error(Some(env), NapiStatus::function_expected);
    }

    let vm = env.to_js().bun_vm();
    let callback = if let Some(c) = call_js_cb {
        TsfnCallback::C {
            napi_threadsafe_function_call_js: c,
            js: if func.is_empty() {
                Strong::Optional::empty()
            } else {
                Strong::Optional::create(func.with_async_context_if_needed(env.to_js()), vm.global())
            },
        }
    } else {
        TsfnCallback::Js(if func.is_empty() {
            Strong::Optional::empty()
        } else {
            Strong::Optional::create(func.with_async_context_if_needed(env.to_js()), vm.global())
        })
    };

    let function = ThreadSafeFunction::new(ThreadSafeFunction {
        event_loop: vm.event_loop(),
        env: NapiEnvRef::clone_from_raw(env),
        callback,
        ctx: context,
        queue: TsfnQueue::init(max_queue_size),
        thread_count: AtomicI64::new(i64::try_from(initial_thread_count).unwrap()),
        poll_ref: KeepAlive::init(),
        tracker: Debugger::AsyncTaskTracker::init(vm),
        finalizer_fun: thread_finalize_cb,
        finalizer_data: thread_finalize_data,
        has_queued_finalizer: false,
        lock: Mutex::new(),
        dispatch_state: AtomicU8::new(DispatchState::Idle as u8),
        blocking_condvar: Condvar::new(),
        closing: AtomicU8::new(ClosingState::NotClosing as u8),
        aborted: AtomicBool::new(true),
    });

    // SAFETY: function is non-null (just allocated).
    let function_ref = unsafe { &mut *function };

    // nodejs by default keeps the event loop alive until the thread-safe function is unref'd
    function_ref.ref_();
    function_ref.tracker.did_schedule(vm.global());

    *result = function;
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_get_threadsafe_function_context(
    func: napi_threadsafe_function,
    result: *mut *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_threadsafe_function_context");
    // SAFETY: func and result are non-null per N-API contract.
    unsafe { *result = (*func).ctx };
    NapiStatus::ok as napi_status
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_call_threadsafe_function(
    func: napi_threadsafe_function,
    data: *mut c_void,
    is_blocking: napi_threadsafe_function_call_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_call_threadsafe_function");
    // SAFETY: func is non-null per N-API contract.
    unsafe { &mut *func }.enqueue(data, is_blocking == NAPI_TSFN_BLOCKING)
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_acquire_threadsafe_function(func: napi_threadsafe_function) -> napi_status {
    bun_output::scoped_log!(napi, "napi_acquire_threadsafe_function");
    // SAFETY: func is non-null per N-API contract.
    unsafe { &mut *func }.acquire()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_release_threadsafe_function(
    func: napi_threadsafe_function,
    mode: napi_threadsafe_function_release_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_release_threadsafe_function");
    // SAFETY: func is non-null per N-API contract.
    unsafe { &mut *func }.release(mode, false)
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_unref_threadsafe_function(
    env_: napi_env,
    func: napi_threadsafe_function,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_unref_threadsafe_function");
    let env = get_env!(env_);
    // SAFETY: func is non-null per N-API contract.
    let func = unsafe { &mut *func };
    debug_assert!(core::ptr::eq(func.event_loop.global(), env.to_js()));
    func.unref();
    env.ok()
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_ref_threadsafe_function(
    env_: napi_env,
    func: napi_threadsafe_function,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_ref_threadsafe_function");
    let env = get_env!(env_);
    // SAFETY: func is non-null per N-API contract.
    let func = unsafe { &mut *func };
    debug_assert!(core::ptr::eq(func.event_loop.global(), env.to_js()));
    func.ref_();
    env.ok()
}

const NAPI_AUTO_LENGTH: usize = usize::MAX;

// ──────────────────────────────────────────────────────────────────────────
// V8 API symbol references (DCE suppression)
// ──────────────────────────────────────────────────────────────────────────

/// v8:: C++ symbols defined in v8.cpp
///
/// Do not call these at runtime, as they do not contain type and callconv info. They are simply
/// used for DCE suppression and asserting that the symbols exist at link-time.
///
// TODO: write a script to generate this struct. ideally it wouldn't even need to be committed to source.
#[cfg(not(windows))]
mod v8_api {
    use core::ffi::c_void;
    // TODO(port): move to napi_sys
    unsafe extern "C" {
        pub fn _ZN2v87Isolate10GetCurrentEv() -> *mut c_void;
        pub fn _ZN2v87Isolate13TryGetCurrentEv() -> *mut c_void;
        pub fn _ZN2v87Isolate17GetCurrentContextEv() -> *mut c_void;
        pub fn _ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_() -> *mut c_void;
        pub fn _ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_() -> *mut c_void;
        pub fn _ZN2v86Number3NewEPNS_7IsolateEd() -> *mut c_void;
        pub fn _ZNK2v86Number5ValueEv() -> *mut c_void;
        pub fn _ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi() -> *mut c_void;
        pub fn _ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii() -> *mut c_void;
        pub fn _ZN2v812api_internal12ToLocalEmptyEv() -> *mut c_void;
        pub fn _ZNK2v86String6LengthEv() -> *mut c_void;
        pub fn _ZN2v88External3NewEPNS_7IsolateEPv() -> *mut c_void;
        pub fn _ZNK2v88External5ValueEv() -> *mut c_void;
        pub fn _ZN2v86Object3NewEPNS_7IsolateE() -> *mut c_void;
        pub fn _ZN2v86Object3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_() -> *mut c_void;
        pub fn _ZN2v86Object3SetENS_5LocalINS_7ContextEEEjNS1_INS_5ValueEEE() -> *mut c_void;
        pub fn _ZN2v86Object16SetInternalFieldEiNS_5LocalINS_4DataEEE() -> *mut c_void;
        pub fn _ZN2v86Object20SlowGetInternalFieldEi() -> *mut c_void;
        pub fn _ZN2v86Object3GetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE() -> *mut c_void;
        pub fn _ZN2v86Object3GetENS_5LocalINS_7ContextEEEj() -> *mut c_void;
        pub fn _ZN2v811HandleScope12CreateHandleEPNS_8internal7IsolateEm() -> *mut c_void;
        pub fn _ZN2v811HandleScopeC1EPNS_7IsolateE() -> *mut c_void;
        pub fn _ZN2v811HandleScopeD1Ev() -> *mut c_void;
        pub fn _ZN2v811HandleScopeD2Ev() -> *mut c_void;
        pub fn _ZN2v816FunctionTemplate11GetFunctionENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub fn _ZN2v816FunctionTemplate3NewEPNS_7IsolateEPFvRKNS_20FunctionCallbackInfoINS_5ValueEEEENS_5LocalIS4_EENSA_INS_9SignatureEEEiNS_19ConstructorBehaviorENS_14SideEffectTypeEPKNS_9CFunctionEttt() -> *mut c_void;
        pub fn _ZN2v814ObjectTemplate11NewInstanceENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub fn _ZN2v814ObjectTemplate21SetInternalFieldCountEi() -> *mut c_void;
        pub fn _ZNK2v814ObjectTemplate18InternalFieldCountEv() -> *mut c_void;
        pub fn _ZN2v814ObjectTemplate3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE() -> *mut c_void;
        pub fn _ZN2v824EscapableHandleScopeBase10EscapeSlotEPm() -> *mut c_void;
        pub fn _ZN2v824EscapableHandleScopeBaseC2EPNS_7IsolateE() -> *mut c_void;
        pub fn _ZN2v88internal35IsolateFromNeverReadOnlySpaceObjectEm() -> *mut c_void;
        pub fn _ZN2v85Array3NewEPNS_7IsolateEPNS_5LocalINS_5ValueEEEm() -> *mut c_void;
        pub fn _ZNK2v85Array6LengthEv() -> *mut c_void;
        pub fn _ZN2v85Array3NewEPNS_7IsolateEi() -> *mut c_void;
        pub fn _ZN2v85Array7IterateENS_5LocalINS_7ContextEEEPFNS0_14CallbackResultEjNS1_INS_5ValueEEEPvES7_() -> *mut c_void;
        pub fn _ZN2v85Array9CheckCastEPNS_5ValueE() -> *mut c_void;
        pub fn _ZN2v88Function7SetNameENS_5LocalINS_6StringEEE() -> *mut c_void;
        pub fn _ZNK2v85Value9IsBooleanEv() -> *mut c_void;
        pub fn _ZNK2v87Boolean5ValueEv() -> *mut c_void;
        pub fn _ZNK2v85Value10FullIsTrueEv() -> *mut c_void;
        pub fn _ZNK2v85Value11FullIsFalseEv() -> *mut c_void;
        pub fn _ZN2v820EscapableHandleScopeC1EPNS_7IsolateE() -> *mut c_void;
        pub fn _ZN2v820EscapableHandleScopeC2EPNS_7IsolateE() -> *mut c_void;
        pub fn _ZN2v820EscapableHandleScopeD1Ev() -> *mut c_void;
        pub fn _ZN2v820EscapableHandleScopeD2Ev() -> *mut c_void;
        pub fn _ZNK2v85Value8IsObjectEv() -> *mut c_void;
        pub fn _ZNK2v85Value8IsNumberEv() -> *mut c_void;
        pub fn _ZNK2v85Value8IsUint32Ev() -> *mut c_void;
        pub fn _ZNK2v85Value11Uint32ValueENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub fn _ZNK2v85Value11IsUndefinedEv() -> *mut c_void;
        pub fn _ZNK2v85Value6IsNullEv() -> *mut c_void;
        pub fn _ZNK2v85Value17IsNullOrUndefinedEv() -> *mut c_void;
        pub fn _ZNK2v85Value6IsTrueEv() -> *mut c_void;
        pub fn _ZNK2v85Value7IsFalseEv() -> *mut c_void;
        pub fn _ZNK2v85Value8IsStringEv() -> *mut c_void;
        pub fn _ZNK2v85Value12StrictEqualsENS_5LocalIS0_EE() -> *mut c_void;
        pub fn _ZN2v87Boolean3NewEPNS_7IsolateEb() -> *mut c_void;
        pub fn _ZN2v86Object16GetInternalFieldEi() -> *mut c_void;
        pub fn _ZN2v87Context10GetIsolateEv() -> *mut c_void;
        pub fn _ZN2v86String14NewFromOneByteEPNS_7IsolateEPKhNS_13NewStringTypeEi() -> *mut c_void;
        pub fn _ZNK2v86String10Utf8LengthEPNS_7IsolateE() -> *mut c_void;
        pub fn _ZNK2v86String10IsExternalEv() -> *mut c_void;
        pub fn _ZNK2v86String17IsExternalOneByteEv() -> *mut c_void;
        pub fn _ZNK2v86String17IsExternalTwoByteEv() -> *mut c_void;
        pub fn _ZNK2v86String9IsOneByteEv() -> *mut c_void;
        pub fn _ZNK2v86String19ContainsOnlyOneByteEv() -> *mut c_void;
        pub fn _ZN2v812api_internal18GlobalizeReferenceEPNS_8internal7IsolateEm() -> *mut c_void;
        pub fn _ZN2v812api_internal13DisposeGlobalEPm() -> *mut c_void;
        pub fn _ZN2v812api_internal23GetFunctionTemplateDataEPNS_7IsolateENS_5LocalINS_4DataEEE() -> *mut c_void;
        pub fn _ZNK2v88Function7GetNameEv() -> *mut c_void;
        pub fn _ZNK2v85Value10IsFunctionEv() -> *mut c_void;
        pub fn _ZNK2v85Value5IsMapEv() -> *mut c_void;
        pub fn _ZNK2v85Value7IsArrayEv() -> *mut c_void;
        pub fn _ZNK2v85Value7IsInt32Ev() -> *mut c_void;
        pub fn _ZNK2v85Value8IsBigIntEv() -> *mut c_void;
        pub fn _ZN2v812api_internal17FromJustIsNothingEv() -> *mut c_void;
        pub fn uv_os_getpid() -> *mut c_void;
        pub fn uv_os_getppid() -> *mut c_void;
    }
}

#[cfg(windows)]
mod v8_api {
    // MSVC name mangling is different than it is on unix.
    // To make this easier to deal with, I have provided a script to generate the list of functions.
    //
    // dumpbin .\build\CMakeFiles\bun-debug.dir\src\bun.js\bindings\v8\*.cpp.obj /symbols | where-object { $_.Contains(' node::') -or $_.Contains(' v8::') } | foreach-object { (($_ -split "\|")[1] -split " ")[1] } | ForEach-Object { "extern fn @`"${_}`"() *anyopaque;" }
    //
    // Bug @paperclover if you get stuck here
    //
    // TODO(port): MSVC-mangled symbol names contain `?@` and are not valid Rust identifiers.
    // Phase B should generate `#[link_name = "..."]` attributes for each entry from the Zig
    // source list (see src/napi/napi.zig V8API windows arm). The list is purely for DCE
    // suppression / link-time existence checks and has no runtime callers.
}

/// V8 API functions whose mangled name differs by C++ stdlib namespace:
/// libstdc++ = std::, Apple libc++ = std::__1::, NDK libc++ = std::__ndk1::.
#[cfg(windows)]
mod posix_platform_specific_v8_apis {}
#[cfg(all(not(windows), target_os = "android"))]
mod posix_platform_specific_v8_apis {
    use core::ffi::c_void;
    unsafe extern "C" {
        pub fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt6__ndk18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE() -> *mut c_void;
    }
}
#[cfg(all(not(windows), any(target_os = "macos", target_os = "freebsd")))]
mod posix_platform_specific_v8_apis {
    use core::ffi::c_void;
    // FreeBSD's base libc++ uses the same `std::__1::` inline namespace as Apple's.
    unsafe extern "C" {
        pub fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE() -> *mut c_void;
    }
}
#[cfg(all(
    not(windows),
    not(target_os = "android"),
    not(target_os = "macos"),
    not(target_os = "freebsd")
))]
mod posix_platform_specific_v8_apis {
    use core::ffi::c_void;
    unsafe extern "C" {
        pub fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmSt8functionIFNS_10MaybeLocalINS_5ValueEEEvEE() -> *mut c_void;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// uv_* symbol references (posix DCE suppression)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
mod uv_functions_to_export {
    // TODO(port): move to napi_sys
    unsafe extern "C" {
        pub fn uv_accept(); pub fn uv_async_init(); pub fn uv_async_send();
        pub fn uv_available_parallelism(); pub fn uv_backend_fd(); pub fn uv_backend_timeout();
        pub fn uv_barrier_destroy(); pub fn uv_barrier_init(); pub fn uv_barrier_wait();
        pub fn uv_buf_init(); pub fn uv_cancel(); pub fn uv_chdir();
        pub fn uv_check_init(); pub fn uv_check_start(); pub fn uv_check_stop();
        pub fn uv_clock_gettime(); pub fn uv_close(); pub fn uv_cond_broadcast();
        pub fn uv_cond_destroy(); pub fn uv_cond_init(); pub fn uv_cond_signal();
        pub fn uv_cond_timedwait(); pub fn uv_cond_wait(); pub fn uv_cpu_info();
        pub fn uv_cpumask_size(); pub fn uv_cwd(); pub fn uv_default_loop();
        pub fn uv_disable_stdio_inheritance(); pub fn uv_dlclose(); pub fn uv_dlerror();
        pub fn uv_dlopen(); pub fn uv_dlsym(); pub fn uv_err_name();
        pub fn uv_err_name_r(); pub fn uv_exepath(); pub fn uv_fileno();
        pub fn uv_free_cpu_info(); pub fn uv_free_interface_addresses(); pub fn uv_freeaddrinfo();
        pub fn uv_fs_access(); pub fn uv_fs_chmod(); pub fn uv_fs_chown();
        pub fn uv_fs_close(); pub fn uv_fs_closedir(); pub fn uv_fs_copyfile();
        pub fn uv_fs_event_getpath(); pub fn uv_fs_event_init(); pub fn uv_fs_event_start();
        pub fn uv_fs_event_stop(); pub fn uv_fs_fchmod(); pub fn uv_fs_fchown();
        pub fn uv_fs_fdatasync(); pub fn uv_fs_fstat(); pub fn uv_fs_fsync();
        pub fn uv_fs_ftruncate(); pub fn uv_fs_futime(); pub fn uv_fs_get_path();
        pub fn uv_fs_get_ptr(); pub fn uv_fs_get_result(); pub fn uv_fs_get_statbuf();
        pub fn uv_fs_get_system_error(); pub fn uv_fs_get_type(); pub fn uv_fs_lchown();
        pub fn uv_fs_link(); pub fn uv_fs_lstat(); pub fn uv_fs_lutime();
        pub fn uv_fs_mkdir(); pub fn uv_fs_mkdtemp(); pub fn uv_fs_mkstemp();
        pub fn uv_fs_open(); pub fn uv_fs_opendir(); pub fn uv_fs_poll_getpath();
        pub fn uv_fs_poll_init(); pub fn uv_fs_poll_start(); pub fn uv_fs_poll_stop();
        pub fn uv_fs_read(); pub fn uv_fs_readdir(); pub fn uv_fs_readlink();
        pub fn uv_fs_realpath(); pub fn uv_fs_rename(); pub fn uv_fs_req_cleanup();
        pub fn uv_fs_rmdir(); pub fn uv_fs_scandir(); pub fn uv_fs_scandir_next();
        pub fn uv_fs_sendfile(); pub fn uv_fs_stat(); pub fn uv_fs_statfs();
        pub fn uv_fs_symlink(); pub fn uv_fs_unlink(); pub fn uv_fs_utime();
        pub fn uv_fs_write(); pub fn uv_get_available_memory(); pub fn uv_get_constrained_memory();
        pub fn uv_get_free_memory(); pub fn uv_get_osfhandle(); pub fn uv_get_process_title();
        pub fn uv_get_total_memory(); pub fn uv_getaddrinfo(); pub fn uv_getnameinfo();
        pub fn uv_getrusage(); pub fn uv_getrusage_thread(); pub fn uv_gettimeofday();
        pub fn uv_guess_handle(); pub fn uv_handle_get_data(); pub fn uv_handle_get_loop();
        pub fn uv_handle_get_type(); pub fn uv_handle_set_data(); pub fn uv_handle_size();
        pub fn uv_handle_type_name(); pub fn uv_has_ref(); pub fn uv_hrtime();
        pub fn uv_idle_init(); pub fn uv_idle_start(); pub fn uv_idle_stop();
        pub fn uv_if_indextoiid(); pub fn uv_if_indextoname(); pub fn uv_inet_ntop();
        pub fn uv_inet_pton(); pub fn uv_interface_addresses(); pub fn uv_ip_name();
        pub fn uv_ip4_addr(); pub fn uv_ip4_name(); pub fn uv_ip6_addr();
        pub fn uv_ip6_name(); pub fn uv_is_active(); pub fn uv_is_closing();
        pub fn uv_is_readable(); pub fn uv_is_writable(); pub fn uv_key_create();
        pub fn uv_key_delete(); pub fn uv_key_get(); pub fn uv_key_set();
        pub fn uv_kill(); pub fn uv_library_shutdown(); pub fn uv_listen();
        pub fn uv_loadavg(); pub fn uv_loop_alive(); pub fn uv_loop_close();
        pub fn uv_loop_configure(); pub fn uv_loop_delete(); pub fn uv_loop_fork();
        pub fn uv_loop_get_data(); pub fn uv_loop_init(); pub fn uv_loop_new();
        pub fn uv_loop_set_data(); pub fn uv_loop_size(); pub fn uv_metrics_idle_time();
        pub fn uv_metrics_info(); pub fn uv_mutex_destroy(); pub fn uv_mutex_init();
        pub fn uv_mutex_init_recursive(); pub fn uv_mutex_lock(); pub fn uv_mutex_trylock();
        pub fn uv_mutex_unlock(); pub fn uv_now(); pub fn uv_once();
        pub fn uv_open_osfhandle(); pub fn uv_os_environ(); pub fn uv_os_free_environ();
        pub fn uv_os_free_group(); pub fn uv_os_free_passwd(); pub fn uv_os_get_group();
        pub fn uv_os_get_passwd(); pub fn uv_os_get_passwd2(); pub fn uv_os_getenv();
        pub fn uv_os_gethostname(); pub fn uv_os_getpid(); pub fn uv_os_getppid();
        pub fn uv_os_getpriority(); pub fn uv_os_homedir(); pub fn uv_os_setenv();
        pub fn uv_os_setpriority(); pub fn uv_os_tmpdir(); pub fn uv_os_uname();
        pub fn uv_os_unsetenv(); pub fn uv_pipe(); pub fn uv_pipe_bind();
        pub fn uv_pipe_bind2(); pub fn uv_pipe_chmod(); pub fn uv_pipe_connect();
        pub fn uv_pipe_connect2(); pub fn uv_pipe_getpeername(); pub fn uv_pipe_getsockname();
        pub fn uv_pipe_init(); pub fn uv_pipe_open(); pub fn uv_pipe_pending_count();
        pub fn uv_pipe_pending_instances(); pub fn uv_pipe_pending_type(); pub fn uv_poll_init();
        pub fn uv_poll_init_socket(); pub fn uv_poll_start(); pub fn uv_poll_stop();
        pub fn uv_prepare_init(); pub fn uv_prepare_start(); pub fn uv_prepare_stop();
        pub fn uv_print_active_handles(); pub fn uv_print_all_handles(); pub fn uv_process_get_pid();
        pub fn uv_process_kill(); pub fn uv_queue_work(); pub fn uv_random();
        pub fn uv_read_start(); pub fn uv_read_stop(); pub fn uv_recv_buffer_size();
        pub fn uv_ref(); pub fn uv_replace_allocator(); pub fn uv_req_get_data();
        pub fn uv_req_get_type(); pub fn uv_req_set_data(); pub fn uv_req_size();
        pub fn uv_req_type_name(); pub fn uv_resident_set_memory(); pub fn uv_run();
        pub fn uv_rwlock_destroy(); pub fn uv_rwlock_init(); pub fn uv_rwlock_rdlock();
        pub fn uv_rwlock_rdunlock(); pub fn uv_rwlock_tryrdlock(); pub fn uv_rwlock_trywrlock();
        pub fn uv_rwlock_wrlock(); pub fn uv_rwlock_wrunlock(); pub fn uv_sem_destroy();
        pub fn uv_sem_init(); pub fn uv_sem_post(); pub fn uv_sem_trywait();
        pub fn uv_sem_wait(); pub fn uv_send_buffer_size(); pub fn uv_set_process_title();
        pub fn uv_setup_args(); pub fn uv_shutdown(); pub fn uv_signal_init();
        pub fn uv_signal_start(); pub fn uv_signal_start_oneshot(); pub fn uv_signal_stop();
        pub fn uv_sleep(); pub fn uv_socketpair(); pub fn uv_spawn();
        pub fn uv_stop(); pub fn uv_stream_get_write_queue_size(); pub fn uv_stream_set_blocking();
        pub fn uv_strerror(); pub fn uv_strerror_r(); pub fn uv_tcp_bind();
        pub fn uv_tcp_close_reset(); pub fn uv_tcp_connect(); pub fn uv_tcp_getpeername();
        pub fn uv_tcp_getsockname(); pub fn uv_tcp_init(); pub fn uv_tcp_init_ex();
        pub fn uv_tcp_keepalive(); pub fn uv_tcp_nodelay(); pub fn uv_tcp_open();
        pub fn uv_tcp_simultaneous_accepts(); pub fn uv_thread_create(); pub fn uv_thread_create_ex();
        pub fn uv_thread_detach(); pub fn uv_thread_equal(); pub fn uv_thread_getaffinity();
        pub fn uv_thread_getcpu(); pub fn uv_thread_getname(); pub fn uv_thread_getpriority();
        pub fn uv_thread_join(); pub fn uv_thread_self(); pub fn uv_thread_setaffinity();
        pub fn uv_thread_setname(); pub fn uv_thread_setpriority(); pub fn uv_timer_again();
        pub fn uv_timer_get_due_in(); pub fn uv_timer_get_repeat(); pub fn uv_timer_init();
        pub fn uv_timer_set_repeat(); pub fn uv_timer_start(); pub fn uv_timer_stop();
        pub fn uv_translate_sys_error(); pub fn uv_try_write(); pub fn uv_try_write2();
        pub fn uv_tty_get_vterm_state(); pub fn uv_tty_get_winsize(); pub fn uv_tty_init();
        pub fn uv_tty_reset_mode(); pub fn uv_tty_set_mode(); pub fn uv_tty_set_vterm_state();
        pub fn uv_udp_bind(); pub fn uv_udp_connect(); pub fn uv_udp_get_send_queue_count();
        pub fn uv_udp_get_send_queue_size(); pub fn uv_udp_getpeername(); pub fn uv_udp_getsockname();
        pub fn uv_udp_init(); pub fn uv_udp_init_ex(); pub fn uv_udp_open();
        pub fn uv_udp_recv_start(); pub fn uv_udp_recv_stop(); pub fn uv_udp_send();
        pub fn uv_udp_set_broadcast(); pub fn uv_udp_set_membership(); pub fn uv_udp_set_multicast_interface();
        pub fn uv_udp_set_multicast_loop(); pub fn uv_udp_set_multicast_ttl(); pub fn uv_udp_set_source_membership();
        pub fn uv_udp_set_ttl(); pub fn uv_udp_try_send(); pub fn uv_udp_try_send2();
        pub fn uv_udp_using_recvmmsg(); pub fn uv_unref(); pub fn uv_update_time();
        pub fn uv_uptime(); pub fn uv_utf16_length_as_wtf8(); pub fn uv_utf16_to_wtf8();
        pub fn uv_version(); pub fn uv_version_string(); pub fn uv_walk();
        pub fn uv_write(); pub fn uv_write2(); pub fn uv_wtf8_length_as_utf16();
        pub fn uv_wtf8_to_utf16();
    }
}
#[cfg(not(unix))]
mod uv_functions_to_export {}

// ──────────────────────────────────────────────────────────────────────────
// fix_dead_code_elimination
// ──────────────────────────────────────────────────────────────────────────

/// To update this list, use find + multi-cursor in your editor.
/// - pub extern fn napi_
/// - pub export fn napi_
macro_rules! keep_symbols {
    ($($f:path),* $(,)?) => {
        $( core::hint::black_box($f as *const ()); )*
    };
}

pub fn fix_dead_code_elimination() {
    jsc::mark_binding(core::panic::Location::caller());

    // napi_functions_to_export
    keep_symbols!(
        napi_acquire_threadsafe_function, napi_add_async_cleanup_hook, napi_add_env_cleanup_hook,
        napi_add_finalizer, napi_adjust_external_memory, napi_async_destroy, napi_async_init,
        napi_call_function, napi_call_threadsafe_function, napi_cancel_async_work,
        napi_check_object_type_tag, napi_close_callback_scope, napi_close_escapable_handle_scope,
        napi_close_handle_scope, napi_coerce_to_bool, napi_coerce_to_number, napi_coerce_to_object,
        napi_create_array, napi_create_array_with_length, napi_create_arraybuffer,
        napi_create_async_work, napi_create_bigint_int64, napi_create_bigint_uint64,
        napi_create_bigint_words, napi_create_buffer, napi_create_buffer_copy,
        napi_create_dataview, napi_create_date, napi_create_double, napi_create_error,
        napi_create_external, napi_create_external_arraybuffer, napi_create_external_buffer,
        napi_create_int32, napi_create_int64, napi_create_object, napi_create_promise,
        napi_create_range_error, napi_create_reference, napi_create_string_latin1,
        napi_create_string_utf16, napi_create_string_utf8, napi_create_symbol,
        napi_create_threadsafe_function, napi_create_type_error, napi_create_typedarray,
        napi_create_uint32, napi_define_class, napi_define_properties, napi_delete_async_work,
        napi_delete_element, napi_delete_reference, napi_detach_arraybuffer, napi_escape_handle,
        napi_fatal_error, napi_fatal_exception, napi_get_all_property_names,
        napi_get_and_clear_last_exception, napi_get_array_length, napi_get_arraybuffer_info,
        napi_get_boolean, napi_get_buffer_info, napi_get_cb_info, napi_get_dataview_info,
        napi_get_date_value, napi_get_element, napi_get_global, napi_get_instance_data,
        napi_get_last_error_info, napi_get_new_target, napi_get_node_version, napi_get_null,
        napi_get_prototype, napi_get_reference_value, napi_get_threadsafe_function_context,
        napi_get_typedarray_info, napi_get_undefined, napi_get_uv_event_loop,
        napi_get_value_bigint_int64, napi_get_value_bigint_uint64, napi_get_value_bigint_words,
        napi_get_value_bool, napi_get_value_double, napi_get_value_external, napi_get_value_int32,
        napi_get_value_int64, napi_get_value_string_latin1, napi_get_value_string_utf16,
        napi_get_value_string_utf8, napi_get_value_uint32, napi_get_version, napi_has_element,
        napi_instanceof, napi_is_array, napi_is_arraybuffer, napi_is_buffer, napi_is_dataview,
        napi_is_date, napi_is_detached_arraybuffer, napi_is_error, napi_is_exception_pending,
        napi_is_promise, napi_is_typedarray, napi_make_callback, napi_new_instance,
        napi_open_callback_scope, napi_open_escapable_handle_scope, napi_open_handle_scope,
        napi_queue_async_work, napi_ref_threadsafe_function, napi_reference_ref,
        napi_reference_unref, napi_reject_deferred, napi_release_threadsafe_function,
        napi_remove_async_cleanup_hook, napi_remove_env_cleanup_hook, napi_remove_wrap,
        napi_resolve_deferred, napi_run_script, napi_set_element, napi_set_instance_data,
        napi_strict_equals, napi_throw, napi_throw_error, napi_throw_range_error,
        napi_throw_type_error, napi_type_tag_object, napi_typeof, napi_unref_threadsafe_function,
        napi_unwrap, napi_wrap,
        // -- node-api
        node_api_create_syntax_error, node_api_symbol_for, node_api_throw_syntax_error,
        node_api_create_external_string_latin1, node_api_create_external_string_utf16,
    );

    // uv_functions_to_export
    // TODO(port): Zig iterates std.meta.declarations(uv_functions_to_export) — Rust has no
    // reflection over extern blocks. Phase B should script-generate this black_box list from
    // the `uv_functions_to_export` module above, or rely on `#[used]` static fn-ptr arrays.
    #[cfg(unix)]
    {
        use uv_functions_to_export::*;
        keep_symbols!(
            uv_accept, uv_async_init, uv_async_send, uv_available_parallelism, uv_backend_fd,
            uv_backend_timeout, uv_barrier_destroy, uv_barrier_init, uv_barrier_wait, uv_buf_init,
            uv_cancel, uv_chdir, uv_check_init, uv_check_start, uv_check_stop, uv_clock_gettime,
            uv_close, uv_cond_broadcast, uv_cond_destroy, uv_cond_init, uv_cond_signal,
            uv_cond_timedwait, uv_cond_wait, uv_cpu_info, uv_cpumask_size, uv_cwd,
            uv_default_loop, uv_disable_stdio_inheritance, uv_dlclose, uv_dlerror, uv_dlopen,
            uv_dlsym, uv_err_name, uv_err_name_r, uv_exepath, uv_fileno, uv_free_cpu_info,
            uv_free_interface_addresses, uv_freeaddrinfo, uv_fs_access, uv_fs_chmod, uv_fs_chown,
            uv_fs_close, uv_fs_closedir, uv_fs_copyfile, uv_fs_event_getpath, uv_fs_event_init,
            uv_fs_event_start, uv_fs_event_stop, uv_fs_fchmod, uv_fs_fchown, uv_fs_fdatasync,
            uv_fs_fstat, uv_fs_fsync, uv_fs_ftruncate, uv_fs_futime, uv_fs_get_path,
            uv_fs_get_ptr, uv_fs_get_result, uv_fs_get_statbuf, uv_fs_get_system_error,
            uv_fs_get_type, uv_fs_lchown, uv_fs_link, uv_fs_lstat, uv_fs_lutime, uv_fs_mkdir,
            uv_fs_mkdtemp, uv_fs_mkstemp, uv_fs_open, uv_fs_opendir, uv_fs_poll_getpath,
            uv_fs_poll_init, uv_fs_poll_start, uv_fs_poll_stop, uv_fs_read, uv_fs_readdir,
            uv_fs_readlink, uv_fs_realpath, uv_fs_rename, uv_fs_req_cleanup, uv_fs_rmdir,
            uv_fs_scandir, uv_fs_scandir_next, uv_fs_sendfile, uv_fs_stat, uv_fs_statfs,
            uv_fs_symlink, uv_fs_unlink, uv_fs_utime, uv_fs_write, uv_get_available_memory,
            uv_get_constrained_memory, uv_get_free_memory, uv_get_osfhandle, uv_get_process_title,
            uv_get_total_memory, uv_getaddrinfo, uv_getnameinfo, uv_getrusage,
            uv_getrusage_thread, uv_gettimeofday, uv_guess_handle, uv_handle_get_data,
            uv_handle_get_loop, uv_handle_get_type, uv_handle_set_data, uv_handle_size,
            uv_handle_type_name, uv_has_ref, uv_hrtime, uv_idle_init, uv_idle_start, uv_idle_stop,
            uv_if_indextoiid, uv_if_indextoname, uv_inet_ntop, uv_inet_pton,
            uv_interface_addresses, uv_ip_name, uv_ip4_addr, uv_ip4_name, uv_ip6_addr,
            uv_ip6_name, uv_is_active, uv_is_closing, uv_is_readable, uv_is_writable,
            uv_key_create, uv_key_delete, uv_key_get, uv_key_set, uv_kill, uv_library_shutdown,
            uv_listen, uv_loadavg, uv_loop_alive, uv_loop_close, uv_loop_configure,
            uv_loop_delete, uv_loop_fork, uv_loop_get_data, uv_loop_init, uv_loop_new,
            uv_loop_set_data, uv_loop_size, uv_metrics_idle_time, uv_metrics_info,
            uv_mutex_destroy, uv_mutex_init, uv_mutex_init_recursive, uv_mutex_lock,
            uv_mutex_trylock, uv_mutex_unlock, uv_now, uv_once, uv_open_osfhandle, uv_os_environ,
            uv_os_free_environ, uv_os_free_group, uv_os_free_passwd, uv_os_get_group,
            uv_os_get_passwd, uv_os_get_passwd2, uv_os_getenv, uv_os_gethostname, uv_os_getpid,
            uv_os_getppid, uv_os_getpriority, uv_os_homedir, uv_os_setenv, uv_os_setpriority,
            uv_os_tmpdir, uv_os_uname, uv_os_unsetenv, uv_pipe, uv_pipe_bind, uv_pipe_bind2,
            uv_pipe_chmod, uv_pipe_connect, uv_pipe_connect2, uv_pipe_getpeername,
            uv_pipe_getsockname, uv_pipe_init, uv_pipe_open, uv_pipe_pending_count,
            uv_pipe_pending_instances, uv_pipe_pending_type, uv_poll_init, uv_poll_init_socket,
            uv_poll_start, uv_poll_stop, uv_prepare_init, uv_prepare_start, uv_prepare_stop,
            uv_print_active_handles, uv_print_all_handles, uv_process_get_pid, uv_process_kill,
            uv_queue_work, uv_random, uv_read_start, uv_read_stop, uv_recv_buffer_size, uv_ref,
            uv_replace_allocator, uv_req_get_data, uv_req_get_type, uv_req_set_data, uv_req_size,
            uv_req_type_name, uv_resident_set_memory, uv_run, uv_rwlock_destroy, uv_rwlock_init,
            uv_rwlock_rdlock, uv_rwlock_rdunlock, uv_rwlock_tryrdlock, uv_rwlock_trywrlock,
            uv_rwlock_wrlock, uv_rwlock_wrunlock, uv_sem_destroy, uv_sem_init, uv_sem_post,
            uv_sem_trywait, uv_sem_wait, uv_send_buffer_size, uv_set_process_title, uv_setup_args,
            uv_shutdown, uv_signal_init, uv_signal_start, uv_signal_start_oneshot, uv_signal_stop,
            uv_sleep, uv_socketpair, uv_spawn, uv_stop, uv_stream_get_write_queue_size,
            uv_stream_set_blocking, uv_strerror, uv_strerror_r, uv_tcp_bind, uv_tcp_close_reset,
            uv_tcp_connect, uv_tcp_getpeername, uv_tcp_getsockname, uv_tcp_init, uv_tcp_init_ex,
            uv_tcp_keepalive, uv_tcp_nodelay, uv_tcp_open, uv_tcp_simultaneous_accepts,
            uv_thread_create, uv_thread_create_ex, uv_thread_detach, uv_thread_equal,
            uv_thread_getaffinity, uv_thread_getcpu, uv_thread_getname, uv_thread_getpriority,
            uv_thread_join, uv_thread_self, uv_thread_setaffinity, uv_thread_setname,
            uv_thread_setpriority, uv_timer_again, uv_timer_get_due_in, uv_timer_get_repeat,
            uv_timer_init, uv_timer_set_repeat, uv_timer_start, uv_timer_stop,
            uv_translate_sys_error, uv_try_write, uv_try_write2, uv_tty_get_vterm_state,
            uv_tty_get_winsize, uv_tty_init, uv_tty_reset_mode, uv_tty_set_mode,
            uv_tty_set_vterm_state, uv_udp_bind, uv_udp_connect, uv_udp_get_send_queue_count,
            uv_udp_get_send_queue_size, uv_udp_getpeername, uv_udp_getsockname, uv_udp_init,
            uv_udp_init_ex, uv_udp_open, uv_udp_recv_start, uv_udp_recv_stop, uv_udp_send,
            uv_udp_set_broadcast, uv_udp_set_membership, uv_udp_set_multicast_interface,
            uv_udp_set_multicast_loop, uv_udp_set_multicast_ttl, uv_udp_set_source_membership,
            uv_udp_set_ttl, uv_udp_try_send, uv_udp_try_send2, uv_udp_using_recvmmsg, uv_unref,
            uv_update_time, uv_uptime, uv_utf16_length_as_wtf8, uv_utf16_to_wtf8, uv_version,
            uv_version_string, uv_walk, uv_write, uv_write2, uv_wtf8_length_as_utf16,
            uv_wtf8_to_utf16,
        );
    }

    // V8API
    // TODO(port): Zig iterates std.meta.declarations(V8API) — same reflection caveat as above.
    #[cfg(not(windows))]
    {
        use v8_api::*;
        keep_symbols!(
            _ZN2v87Isolate10GetCurrentEv, _ZN2v87Isolate13TryGetCurrentEv,
            _ZN2v87Isolate17GetCurrentContextEv,
            _ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_,
            _ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_,
            _ZN2v86Number3NewEPNS_7IsolateEd, _ZNK2v86Number5ValueEv,
            _ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi,
            _ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii, _ZN2v812api_internal12ToLocalEmptyEv,
            _ZNK2v86String6LengthEv, _ZN2v88External3NewEPNS_7IsolateEPv,
            _ZNK2v88External5ValueEv, _ZN2v86Object3NewEPNS_7IsolateE,
            _ZN2v86Object3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_,
            _ZN2v86Object3SetENS_5LocalINS_7ContextEEEjNS1_INS_5ValueEEE,
            _ZN2v86Object16SetInternalFieldEiNS_5LocalINS_4DataEEE,
            _ZN2v86Object20SlowGetInternalFieldEi,
            _ZN2v86Object3GetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE,
            _ZN2v86Object3GetENS_5LocalINS_7ContextEEEj,
            _ZN2v811HandleScope12CreateHandleEPNS_8internal7IsolateEm,
            _ZN2v811HandleScopeC1EPNS_7IsolateE, _ZN2v811HandleScopeD1Ev,
            _ZN2v811HandleScopeD2Ev,
            _ZN2v816FunctionTemplate11GetFunctionENS_5LocalINS_7ContextEEE,
            _ZN2v816FunctionTemplate3NewEPNS_7IsolateEPFvRKNS_20FunctionCallbackInfoINS_5ValueEEEENS_5LocalIS4_EENSA_INS_9SignatureEEEiNS_19ConstructorBehaviorENS_14SideEffectTypeEPKNS_9CFunctionEttt,
            _ZN2v814ObjectTemplate11NewInstanceENS_5LocalINS_7ContextEEE,
            _ZN2v814ObjectTemplate21SetInternalFieldCountEi,
            _ZNK2v814ObjectTemplate18InternalFieldCountEv,
            _ZN2v814ObjectTemplate3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE,
            _ZN2v824EscapableHandleScopeBase10EscapeSlotEPm,
            _ZN2v824EscapableHandleScopeBaseC2EPNS_7IsolateE,
            _ZN2v88internal35IsolateFromNeverReadOnlySpaceObjectEm,
            _ZN2v85Array3NewEPNS_7IsolateEPNS_5LocalINS_5ValueEEEm, _ZNK2v85Array6LengthEv,
            _ZN2v85Array3NewEPNS_7IsolateEi,
            _ZN2v85Array7IterateENS_5LocalINS_7ContextEEEPFNS0_14CallbackResultEjNS1_INS_5ValueEEEPvES7_,
            _ZN2v85Array9CheckCastEPNS_5ValueE,
            _ZN2v88Function7SetNameENS_5LocalINS_6StringEEE, _ZNK2v85Value9IsBooleanEv,
            _ZNK2v87Boolean5ValueEv, _ZNK2v85Value10FullIsTrueEv, _ZNK2v85Value11FullIsFalseEv,
            _ZN2v820EscapableHandleScopeC1EPNS_7IsolateE,
            _ZN2v820EscapableHandleScopeC2EPNS_7IsolateE, _ZN2v820EscapableHandleScopeD1Ev,
            _ZN2v820EscapableHandleScopeD2Ev, _ZNK2v85Value8IsObjectEv,
            _ZNK2v85Value8IsNumberEv, _ZNK2v85Value8IsUint32Ev,
            _ZNK2v85Value11Uint32ValueENS_5LocalINS_7ContextEEE, _ZNK2v85Value11IsUndefinedEv,
            _ZNK2v85Value6IsNullEv, _ZNK2v85Value17IsNullOrUndefinedEv, _ZNK2v85Value6IsTrueEv,
            _ZNK2v85Value7IsFalseEv, _ZNK2v85Value8IsStringEv,
            _ZNK2v85Value12StrictEqualsENS_5LocalIS0_EE, _ZN2v87Boolean3NewEPNS_7IsolateEb,
            _ZN2v86Object16GetInternalFieldEi, _ZN2v87Context10GetIsolateEv,
            _ZN2v86String14NewFromOneByteEPNS_7IsolateEPKhNS_13NewStringTypeEi,
            _ZNK2v86String10Utf8LengthEPNS_7IsolateE, _ZNK2v86String10IsExternalEv,
            _ZNK2v86String17IsExternalOneByteEv, _ZNK2v86String17IsExternalTwoByteEv,
            _ZNK2v86String9IsOneByteEv, _ZNK2v86String19ContainsOnlyOneByteEv,
            _ZN2v812api_internal18GlobalizeReferenceEPNS_8internal7IsolateEm,
            _ZN2v812api_internal13DisposeGlobalEPm,
            _ZN2v812api_internal23GetFunctionTemplateDataEPNS_7IsolateENS_5LocalINS_4DataEEE,
            _ZNK2v88Function7GetNameEv, _ZNK2v85Value10IsFunctionEv, _ZNK2v85Value5IsMapEv,
            _ZNK2v85Value7IsArrayEv, _ZNK2v85Value7IsInt32Ev, _ZNK2v85Value8IsBigIntEv,
            _ZN2v812api_internal17FromJustIsNothingEv, uv_os_getpid, uv_os_getppid,
        );
    }
    #[cfg(windows)]
    {
        // TODO(port): see v8_api windows module — MSVC-mangled symbols need #[link_name].
    }

    // posix_platform_specific_v8_apis
    #[cfg(all(not(windows), target_os = "android"))]
    keep_symbols!(posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt6__ndk18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE);
    #[cfg(all(not(windows), any(target_os = "macos", target_os = "freebsd")))]
    keep_symbols!(posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE);
    #[cfg(all(
        not(windows),
        not(target_os = "android"),
        not(target_os = "macos"),
        not(target_os = "freebsd")
    ))]
    keep_symbols!(posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmSt8functionIFNS_10MaybeLocalINS_5ValueEEEvEE);

    core::hint::black_box(bun_runtime::node::buffer::BufferVectorized::fill as *const ());
}

// ──────────────────────────────────────────────────────────────────────────
// NapiFinalizerTask
// ──────────────────────────────────────────────────────────────────────────

pub struct NapiFinalizerTask {
    pub finalizer: Finalizer,
}

// TODO(port): jsc.AnyTask.New(@This(), runOnJSThread) — codegen vtable wiring.
type NapiFinalizerAnyTask = AnyTask<NapiFinalizerTask>;

impl NapiFinalizerTask {
    pub fn init(finalizer: Finalizer) -> Box<NapiFinalizerTask> {
        Box::new(NapiFinalizerTask { finalizer })
    }

    pub fn schedule(self: Box<Self>) {
        // SAFETY: env is valid (held by NapiEnvRef).
        let global_this = unsafe { &*self.finalizer.env.get() }.to_js();

        let (vm, thread_kind) = global_this.try_bun_vm();
        let this = Box::into_raw(self);

        if thread_kind != jsc::ThreadKind::Main {
            // TODO(@heimskr): do we need to handle the case where the vm is shutting down?
            vm.event_loop()
                .enqueue_task_concurrent(ConcurrentTask::create(Task::init_ptr(this)));
            return;
        }

        if vm.is_shutting_down() {
            // Immediate tasks won't run, so we run this as a cleanup hook instead
            vm.rare_data()
                .push_cleanup_hook(vm.global(), this as *mut c_void, Self::run_as_cleanup_hook);
        } else {
            global_this.bun_vm().event_loop().enqueue_task(Task::init_ptr(this));
        }
    }

    pub fn run_on_js_thread(this: *mut NapiFinalizerTask) {
        // SAFETY: `this` was created by Box::into_raw in `schedule`.
        let mut this_box = unsafe { Box::from_raw(this) };
        this_box.finalizer.run();
        // finalizer.deinit() runs via Drop on NapiEnvRef when this_box drops.
    }

    extern "C" fn run_as_cleanup_hook(opaque_this: *mut c_void) {
        // SAFETY: opaque_this is the *mut NapiFinalizerTask we registered above (non-null).
        let this: *mut NapiFinalizerTask = opaque_this.cast();
        Self::run_on_js_thread(this);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/napi/napi.zig (2554 lines)
//   confidence: medium
//   todos:      16
//   notes:      Heavy FFI surface; Windows MSVC-mangled V8 symbols need #[link_name] codegen; ThreadSafeFunction lock/condvar uses bun_threading raw Mutex API (lock/unlock) — Phase B may want RAII guard; NapiEnvRef = bun_ptr::ExternalShared<NapiEnv> needs vtable wiring; ThreadSafeFunction::destroy moves env out via ptr::read+zeroed sentinel.
// ──────────────────────────────────────────────────────────────────────────
