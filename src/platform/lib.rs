#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! Per-OS APIs that don't fit in `bun_sys` (signposts, splice/preadv2 wrappers).

#![warn(unreachable_pub)]
// Android is `target_os = "android"` (not `"linux"`) in Rust, so list both
// so the `#[no_mangle]` C exports (`sys_epoll_pwait2`, …) reach the linker on
// the `*-linux-android` targets.
#[cfg(target_os = "macos")]
pub mod darwin;
#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod linux;
