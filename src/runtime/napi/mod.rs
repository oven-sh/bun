//! Node-API (N-API) implementation.
//! Port of src/napi/napi.zig.
//!
//! The full implementation lives in `napi_body.rs` and depends on
//! `bun_jsc::{AnyTask, ConcurrentTask, Debugger, EventLoop, Strong, Task,
//! VirtualMachine}` method surface, `bun_jsc::c_api::ExceptionRef`,
//! `bun_collections::LinearFifo`, `bun_threading::{Condvar, Mutex, WorkPool}`,
//! `bun_output` macros.

#[path = "napi_body.rs"]
mod napi_body;
pub use napi_body::{
    NapiFinalizerTask, ThreadSafeFunction, fix_dead_code_elimination, napi_async_work,
};

// ─── compiling free items ────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// This is `struct napi_env__` from napi.h
    pub(crate) struct NapiEnv;
}

pub struct ThreadsafeFunction(());

// ported from: src/napi/napi.zig
