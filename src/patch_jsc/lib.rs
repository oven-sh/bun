#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

// B-2: un-gated. `bun_jsc` now compiles; testing.rs fn bodies are live.
// One inner gate remains on `bun_patch::json_fmt` (PatchFile JSON Display).
pub mod testing;
