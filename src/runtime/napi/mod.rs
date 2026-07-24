//! Node-API (N-API) implementation.
//!
//! The full implementation lives in `napi_body.rs` and depends on
//! `bun_jsc::{AnyTask, ConcurrentTask, Debugger, EventLoop, Strong, Task,
//! VirtualMachine}` method surface, `bun_collections::LinearFifo`,
//! `bun_threading::{Condvar, Mutex, WorkPool}`, `bun_output` macros.

#[path = "napi_body.rs"]
pub(crate) mod napi_body;
pub use napi_body::{
    NapiFinalizerTask, ThreadSafeFunction, fix_dead_code_elimination, napi_async_work,
};

// ─── compiling free items ────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// This is `struct napi_env__` from napi.h
    pub(crate) struct NapiEnv;
}

// ─── opaque type surface ─────────────────────────────────────────────────────
// TODO(blocked): bun_jsc::EventLoop (method surface)
// TODO(blocked): bun_collections::LinearFifo
// TODO(blocked): bun_threading::Condvar
