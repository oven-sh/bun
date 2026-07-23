#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

#[path = "CodeCoverage.rs"]
pub mod code_coverage;
pub mod internal_jsc;
#[path = "JSSourceMap.rs"]
pub mod js_source_map;

// ---- public surface ---------------------------------------------------------

pub use code_coverage::{
    ByteRangeMapping, ByteRangeMappingHashMap, Fraction, Report as CoverageReport,
};
pub use js_source_map::JSSourceMap;
