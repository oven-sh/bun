#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod simdutf;

// Top-level re-exports of the safe slice-taking wrappers in `simdutf::validate`.
// These are the canonical UTF-8 validation entry points for the codebase —
// and identifiers are ASCII; genuine validation goes through simdutf, which
// is ~3-10× faster than the std byte-by-byte DFA on AVX2/NEON hardware).
pub use simdutf::validate::ascii as validate_ascii;
pub use simdutf::validate::utf8 as validate_utf8;
