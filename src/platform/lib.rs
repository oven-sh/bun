#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! Per-OS APIs that don't fit in `bun_sys` (signposts, the `sys_epoll_pwait2` export).

// Android is listed alongside Linux so the `#[no_mangle]` C exports
// (`sys_epoll_pwait2`, …) reach the linker on the `*-linux-android` targets.
#[cfg(target_os = "macos")]
pub mod darwin;
#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux;
