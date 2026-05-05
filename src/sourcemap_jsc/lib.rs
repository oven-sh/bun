#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: all four modules depend on `bun_jsc` (and source_provider on
// `bun_runtime`), neither of which compiles yet. The Phase-A draft bodies are
// preserved on disk but gated out of the build with `#[cfg(any())]`. Minimal
// opaque stub surface is exposed below so downstream crates can name our types.
// Un-gating happens in B-2 once bun_jsc / bun_runtime are green.

#[cfg(any())]
pub mod source_provider;
#[cfg(any())]
pub mod internal_jsc;
#[cfg(any())]
pub mod JSSourceMap;
#[cfg(any())]
pub mod CodeCoverage;

// ---- stub surface (B-1) -----------------------------------------------------

// TODO(b1): bun_jsc::{JSGlobalObject, JSValue, CallFrame, VirtualMachine, ...} missing
// TODO(b1): bun_runtime::bake::production::PerThread missing

/// Stub for `CodeCoverage::ByteRangeMapping` — real impl gated behind cfg(any()).
pub struct ByteRangeMapping(());
/// Stub for `CodeCoverage::Report`.
pub struct CoverageReport(());
/// Stub for `JSSourceMap` JS class wrapper.
pub struct JSSourceMap(());

pub mod code_coverage {
    pub use super::ByteRangeMapping;
    pub use super::CoverageReport as Report;
    pub type ByteRangeMappingHashMap = bun_collections::HashMap<u64, ByteRangeMapping>;
}
