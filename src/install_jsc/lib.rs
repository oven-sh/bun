#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! JSC bridge surface for `bun_install`. Keeps `src/install/` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` references.
//!
//! Host-fn bodies for hosted_git_info / dependency / update_request / npm /
//! install_binding compile against the `bun_jsc` + `bun_install` surface.
//! `npm_jsc::js_parse_manifest` body uses `PackageManifest::{name, versions,
//! string_buf}` from `bun_install::npm`. Remaining gaps are the exact missing
//! lower-tier symbols (`JSFunction::create` ↔
//! `#[bun_jsc::host_fn]` shim-name bridge for associated fns,
//! `bun_bundler::Transpiler` mutable field access via `bun_vm()`,
//! `bun_resolver::Resolver::get_package_manager`, `bun_ini::load_npmrc` real
//! signature) and tagged `// TODO(port): bun_X::Y` — see Track-A
//! blocked_on report.
//!
//! NOTE: `cargo check -p bun_install_jsc` is currently hard-blocked on
//! transitive lower-tier compile failures in `bun_css` / `bun_http` /
//! `bun_js_parser` (via `bun_jsc → bun_bundler`); no edits in this crate can
//! be cargo-verified until those un-gate.

pub mod dependency_jsc;
pub mod hosted_git_info_jsc;
pub mod ini_jsc;
pub mod install_binding;
pub mod npm_jsc;
pub mod update_request_jsc;

pub use hosted_git_info_jsc::HostedGitInfoJsc;
pub use ini_jsc::IniTestingAPIs;
pub use npm_jsc::ManifestBindings;
