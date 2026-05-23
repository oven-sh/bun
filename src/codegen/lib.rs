// Build-time codegen tool — runs on the host before bun_* crates exist.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod process_windows_translate_c;
