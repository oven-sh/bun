// Scratch validation of the port conventions: rustc --edition 2024 --crate-type lib conv.rs
#![deny(warnings)]
#![deny(unsafe_code)]

#[macro_use]
pub mod ids;
pub mod arena;
pub mod casts;
pub mod checker;
pub mod flags;
pub mod fn1_compare;
pub mod fn2_resolution;
pub mod fn3_instantiate;
pub mod fn4_links;
pub mod fn5_callbacks;
pub mod fn6_binder;
pub mod golang;
pub mod internal;
pub mod keys;
pub mod shims;
pub mod slices;
pub mod types;

#[cfg(test)]
mod tests;
