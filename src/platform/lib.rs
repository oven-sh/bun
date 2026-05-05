#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// B-1 gate: linux.rs/darwin.rs use bun_sys (T1 not yet green). Ungate in B-2.
#[cfg(any())] pub mod linux;
#[cfg(any())] pub mod darwin;
