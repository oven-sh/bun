//! The speculative optimizing compiler for bytecode.

#![deny(unsafe_code)]

mod builder;
mod graph;
mod lower;
mod passes;
#[allow(unsafe_code)]
mod runtime;

pub use runtime::{did_collect, jettison, tier_up};
