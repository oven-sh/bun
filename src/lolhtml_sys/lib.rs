#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// Force the C-API rlib into the crate graph even though we only reference its
// symbols through `extern "C"` blocks below — without this the staticlib
// bundler might prune it and the `lol_html_*` definitions wouldn't make it
// into `libbun_rust.a`.
extern crate lolhtml as _;
pub mod lol_html;
pub use lol_html::*;
