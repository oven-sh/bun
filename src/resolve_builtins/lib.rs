#![allow(non_snake_case)]
#![warn(unused_must_use)]
#![forbid(unsafe_code)]
#[path = "HardcodedModule.rs"]
pub mod HardcodedModule;

pub use HardcodedModule::{
    Alias, Cfg, HardcodedModule as Module, expose_internals_enabled, set_expose_internals_enabled,
    set_stream_iter_enabled, stream_iter_alias_gated, stream_iter_enabled,
};
pub mod node_builtins;
