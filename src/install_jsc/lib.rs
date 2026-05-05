#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge surface for `bun_install`. Keeps `src/install/` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` references.
//!
//! B-2: all six modules are un-gated. Function bodies that depend on missing
//! lower-tier surface (`bun_jsc::JsResult`, `#[bun_jsc::host_fn]`, `bun_jsc`
//! method tables, `bun_install::{hosted_git_info,dependency::version,npm::*,
//! lockfile::LoadResult,package_manager::update_request,Subcommand}`, etc.)
//! are individually `#[cfg(any())]`-gated inside each file with
//! `// TODO(b2-blocked): bun_X::Y` markers — see Track-A blocked_on report.

pub mod update_request_jsc;
pub mod install_binding;
pub mod hosted_git_info_jsc;
pub mod npm_jsc;
pub mod dependency_jsc;
pub mod ini_jsc;

pub use hosted_git_info_jsc::HostedGitInfoJsc;
pub use ini_jsc::IniTestingAPIs;
pub use npm_jsc::ManifestBindings;
