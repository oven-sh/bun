#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! B-2 un-gate: all four Phase-A draft modules are now compiled. Function bodies
//! that depend on `bun_jsc`'s real (still-gated) method surface are individually
//! re-gated with `` and a `// TODO(b2-blocked): bun_X::Y` marker so
//! the rest of the module type-checks against the real lower-tier crates.

// Phase-A drafts wrote `bun_core::…`; the workspace crate is `bun_string`.
extern crate bun_core as bun_str;

#[path = "CodeCoverage.rs"]
pub mod code_coverage;
pub mod internal_jsc;
#[path = "JSSourceMap.rs"]
pub mod js_source_map;
pub mod source_provider;

// ---- public surface ---------------------------------------------------------

pub use code_coverage::{
    ByteRangeMapping, ByteRangeMappingHashMap, Fraction, Report as CoverageReport,
};
pub use js_source_map::JSSourceMap;
pub use source_provider::BakeSourceProvider;
