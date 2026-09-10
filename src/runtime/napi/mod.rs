//! Node-API (N-API) implementation.
//!
//! The implementation lives in `napi_body.rs`; the FFI glue for the C++
//! `napi_env` / handle-scope objects is `bun_jsc::napi`.

#[path = "napi_body.rs"]
pub mod napi_body;
pub(crate) use bun_jsc::napi::NapiEnv;
pub use napi_body::NapiStatus;
pub(crate) use napi_body::{
    AsyncWorkCompletion, NapiFinalizerTask, TsfnDispatch, TsfnFinalize, fix_dead_code_elimination,
};

pub mod libc_check;
mod link_symbols;
