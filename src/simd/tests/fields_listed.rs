//! Scans, bits that move, and what stands for a mask.
#![allow(dead_code, unreachable_pub)]
#![allow(clippy::reversed_empty_ranges)]
#![cfg(target_arch = "aarch64")]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
include!("parts/fields.rs");
