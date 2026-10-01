// Scratch validation of the diagnostics table: rustc --edition 2024 --crate-type lib lib.rs
#![deny(warnings)]
#![deny(unsafe_code)]
#![deny(unreachable_pub)]

#[macro_use]
pub mod ids;
pub mod arena;
pub mod ast;
pub mod compiler;
pub mod core;
pub mod diagnostics;
pub mod diagnosticwriter;
pub mod slices;

#[cfg(test)]
mod tests;
