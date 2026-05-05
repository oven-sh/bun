#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

// B-2: un-gated. `bun_jsc` now compiles (stub surface only); real fn bodies in
// testing.rs remain individually gated where blocked on missing lower-tier API.
pub mod testing;
