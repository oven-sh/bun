//! Crate root for the unit tests in `command_line.rs`. On Windows, `BinLinkingShim.rs` needs the rest of `bun_install`.

#![cfg(not(windows))]
#![feature(core_io, core_io_borrowed_buf)]

#[path = "BinLinkingShim.rs"]
pub mod _bin_linking_shim;
mod command_line;
