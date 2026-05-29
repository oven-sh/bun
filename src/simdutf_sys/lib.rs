#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod simdutf;

pub use simdutf::validate::ascii as validate_ascii;
pub use simdutf::validate::utf8 as validate_utf8;
