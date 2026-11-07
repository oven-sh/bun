#![allow(non_snake_case)]
//! JSC bridge for `bun_semver`. Keeps `src/semver/` free of JSC types.

#[path = "SemverObject.rs"]
pub mod SemverObject;
pub(crate) mod generated_bindgen;
