//! macOS for the portable image.
//!
//! The portable image (`cfg(bun_portable)`) is compiled once, for a Linux target, and runs on Linux,
//! macOS and Windows. It has bun's code for every one of them and picks by the host when it runs
//! (`bun_core::host`). bun's code for macOS calls functions of macOS, with the structures and the
//! constants of macOS. In a build for macOS those come from the `libc` crate; in the image that crate
//! is the one for Linux. This crate has them for the image:
//!
//! - [`types`], [`constants`], [`functions`]: the definitions of macOS, for both processors, written by
//!   misctools/portable/bindings/darwin.ts from the `libc` crate for the targets of macOS (the head of
//!   `generated.rs` says from which version and files). A function is bound when it is first called,
//!   through the host of the image ([`host_imports`]).
//! - [`libc`]: what bun's code for macOS finds under the name `libc` in the image, so that the source
//!   line that a build for macOS compiles against the `libc` crate is the line that the image compiles.
//! - [`nocancel`]: the `$NOCANCEL` functions that `bun_sys` declares itself.
//! - [`abi`]: what a call from the image into macOS has to respect.
//! - [`errno`], [`translate`]: the numbers that shared code and code for macOS both handle (error
//!   numbers, the flags of `open`, `AT_FDCWD`) have the values of the image in all of bun's code. They
//!   become the values of macOS where a function of macOS is called, and nowhere else.
//!
//! A build for one OS compiles nothing of this crate.
#![no_std]
#![cfg(bun_portable)]
#![allow(non_camel_case_types, non_upper_case_globals, non_snake_case)]

// What `#[imports]` writes names this crate, also where this crate uses it.
extern crate self as bun_darwin_sys;

pub mod abi;
pub mod errno;
pub mod host_imports;
pub mod libc;
pub mod nocancel;
pub mod translate;

#[rustfmt::skip]
mod generated;
pub use generated::{constants, functions, types};
