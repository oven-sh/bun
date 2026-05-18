#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]

// Alias so call sites can write `bun_str::…` (string types live in `bun_core`).
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
