//! The part of ICU's C API that JavaScriptCore, WTF and Bun call. Derived from ICU4C 79.1 (LICENSE.md). macOS uses the system's.
#![cfg(not(any(target_os = "macos", bun_system_icu)))]
// The arguments come from JavaScript and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]
#![cfg_attr(mordant, allow(error_collapsed_to_bool))] // A flag keeps the failure: README.md, "Allocation".
#![feature(allocator_ext)]

mod capi;
mod common;
mod i18n;
mod sys;
