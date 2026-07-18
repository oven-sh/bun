#![warn(unused_must_use)]
#![allow(unexpected_cfgs)]
#![feature(allocator_api)]

pub mod error;
pub use error::{Error, Result};

pub mod json_index;
mod json_stage2;

#[cfg(test)]
mod native_test_shims;

#[path = "json.rs"]
pub mod json;

pub use json as json_parser;

#[path = "json5.rs"]
pub mod json5;

#[path = "toml.rs"]
pub mod toml;

#[path = "xml.rs"]
pub mod xml;

#[path = "yaml.rs"]
pub mod yaml;
