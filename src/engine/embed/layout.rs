//! Fails to compile where `include/engine/api/Layout.h` is wrong.

#![allow(non_upper_case_globals, clippy::unnecessary_cast)]

use core::mem::offset_of;

use bun_engine_bytecode::{KnownCapture, KnownFunction, Position};
use bun_engine_inspector::profiling::{BlockRange, CodeRange};
use bun_engine_text::*;
use bun_engine_vm::heap::*;
use bun_engine_vm::*;

use crate::api::ParserError;

/// A mismatch names both numbers.
struct Is<const N: usize>;

include!(concat!(env!("OUT_DIR"), "/layout.rs"));
