#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! JSC bridge surface for `bun_install`. Keeps `src/install/` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` references.
//!
//! Host-fn bodies for hosted_git_info / dependency / update_request / npm /
//! install_binding compile against the `bun_jsc` + `bun_install` surface and
//! are wired into the runtime via the `dispatch_js2native` re-exports.

pub mod dependency_jsc;
pub mod hosted_git_info_jsc;
pub mod ini_jsc;
pub mod install_binding;
pub mod npm_jsc;
pub(crate) mod update_request_jsc;

