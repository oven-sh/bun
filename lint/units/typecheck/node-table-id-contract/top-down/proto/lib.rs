//! Prototype of the node table, its builder and the id contract. Not part of the repository.

#[macro_use]
pub mod ids;
pub mod ast;
pub mod core;
pub mod golang;
pub mod internal;
pub mod producers;
pub mod stable;

#[cfg(test)]
mod native_test_shims;
#[cfg(test)]
mod tests;
