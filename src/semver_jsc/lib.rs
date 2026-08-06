#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! JSC bridge for `bun_semver`. Keeps `src/semver/` free of JSC types.

#[path = "SemverObject.rs"]
pub mod SemverObject;
