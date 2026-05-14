//! Node-API (N-API) implementation.
//! Port of src/napi/napi.zig.
//!
//! B-2: full draft (2962 lines, preserved in `napi_body.rs`) depends on
//! `bun_jsc::{AnyTask, ConcurrentTask, Debugger, EventLoop, Strong, Task,
//! VirtualMachine}` method surface, `bun_jsc::c_api::ExceptionRef`,
//! `bun_collections::LinearFifo`, `bun_threading::{Condvar, Mutex, WorkPool}`,
//! `bun_output` macros.

use core::ffi::c_void;
use core::ptr;

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────

#[path = "napi_body.rs"]
mod napi_body;
pub use napi_body::{
    NapiFinalizerTask, ThreadSafeFunction, fix_dead_code_elimination, napi_async_work,
};

// ─── compiling free items ────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// This is `struct napi_env__` from napi.h
    pub struct NapiEnv;
}

#[allow(non_camel_case_types)]
pub type napi_env = *mut NapiEnv;
#[allow(non_camel_case_types)]
pub type napi_status = core::ffi::c_uint;

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
#[allow(non_camel_case_types)]
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

// ─── opaque type surface ─────────────────────────────────────────────────────
// TODO(b2-blocked): bun_jsc::EventLoop (method surface)
// TODO(b2-blocked): bun_jsc::c_api::ExceptionRef
// TODO(b2-blocked): bun_collections::LinearFifo
// TODO(b2-blocked): bun_threading::Condvar
pub struct ThreadsafeFunction(());
pub struct AsyncWork(());
pub struct Ref(());

// ported from: src/napi/napi.zig
