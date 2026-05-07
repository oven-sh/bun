#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
//! Per-OS APIs that don't fit in `bun_sys` (signposts, splice/preadv2 wrappers).

#[cfg(target_os = "linux")]  pub mod linux;
#[cfg(target_os = "macos")]  pub mod darwin;
