#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
#[path = "HardcodedModule.rs"]
pub mod HardcodedModule;

pub use HardcodedModule::{
    Alias, Cfg, HardcodedModule as Module, set_stream_iter_enabled, stream_iter_alias_gated,
    stream_iter_enabled,
};
pub mod node_builtins;
