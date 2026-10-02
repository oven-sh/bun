#![allow(non_snake_case)]
#![warn(unused_must_use)]
#![forbid(unsafe_code)]
//! JSC bridge for `bun_semver`. Keeps `src/semver/` free of JSC types.

#[path = "SemverObject.rs"]
pub mod SemverObject;
