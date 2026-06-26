//! Bindings for libghostty-vt, Ghostty's terminal emulator library.
//!
//! `ghostty_vt` holds the raw `extern "C"` declarations against
//! `include/ghostty/vt.h` plus `VirtualTerminal`, a safe owning wrapper.
//! The library is vendored and built by `scripts/build/deps/ghostty-vt.ts`;
//! symbols resolve at the final link like every other vendored C dep.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod ghostty_vt;

pub use ghostty_vt::VirtualTerminal;
