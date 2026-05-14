#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod simdutf;

// Top-level re-exports of the safe slice-taking wrappers in `simdutf::validate`.
// These are the canonical UTF-8 validation entry points for the codebase —
// `core::str::from_utf8` is NOT used at runtime (PORTING.md §Strings: digits
// and identifiers are ASCII; genuine validation goes through simdutf, which
// is ~3-10× faster than the std byte-by-byte DFA on AVX2/NEON hardware).
pub use simdutf::validate::ascii as validate_ascii;
pub use simdutf::validate::utf8 as validate_utf8;
