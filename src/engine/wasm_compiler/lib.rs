//! Compiles WebAssembly functions to machine code.

#![forbid(unsafe_code)]

pub mod abi;
mod allocation;
pub mod baseline;
pub mod cast;
mod clauses;
pub mod optimize;
mod output;
pub mod tail_call;

pub use output::{
    CallSite, Clause, CompiledFunction, Counters, DirectCall, Environment, InlineFrame,
};
