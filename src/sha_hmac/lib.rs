#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

pub mod sha;
pub mod hmac;

// Convenience re-export matching Phase-A intent (`crate::evp::Algorithm`).
pub use sha::evp;
