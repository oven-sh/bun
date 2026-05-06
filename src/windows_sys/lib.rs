#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod externs;
// Surface the tier-0 typedefs/consts/externs at the crate root so
// `bun_sys::windows`'s `pub use bun_windows_sys::Foo;` re-exports resolve.
pub use externs::*;
