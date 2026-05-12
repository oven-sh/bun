#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
pub mod bindings;
pub use bindings::{Archive, ArchiveEntry, ArchiveResult};
