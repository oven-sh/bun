//! Random programs, an interpreter that says what they may do, and a harness that holds transformations to it.

#![allow(
    dead_code,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

pub(crate) mod datum;
pub(crate) mod disassembly;
pub(crate) mod generator;
pub(crate) mod harness;
pub(crate) mod interpreter;
pub(crate) mod memory;
pub(crate) mod native;
pub(crate) mod nodes;
pub(crate) mod promises;
pub(crate) mod random;
pub(crate) mod reducer;
pub(crate) mod sketch;
pub(crate) mod snippet;
pub(crate) mod vocabulary;
