#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! JSC bridge for `bun_semver`. Keeps `src/semver/` free of JSC types.

pub use bun_jsc::JsResult;

#[path = "SemverObject.rs"]
pub mod SemverObject;
#[path = "SemverString_jsc.rs"]
pub mod SemverString_jsc;

pub use SemverString_jsc::SemverStringJsc;
