#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// TODO(b1): `testing` is gated because dep crate `bun_jsc` does not compile yet
// (and transitively `bun_http_jsc`). The Phase-A draft body is preserved in
// testing.rs unchanged. Un-gate in B-2 once bun_jsc is green and re-enabled in
// Cargo.toml.
#[cfg(any())]
pub mod testing;

// Minimal stub surface so downstream crates can `use bun_patch_jsc::testing::TestingAPIs;`.
#[cfg(not(any()))]
pub mod testing {
    /// Stub: real impl gated until `bun_jsc` compiles. See testing.rs.
    pub struct TestingAPIs;
    /// Stub: real impl gated until `bun_jsc` compiles. See testing.rs.
    pub struct ApplyArgs;
}
