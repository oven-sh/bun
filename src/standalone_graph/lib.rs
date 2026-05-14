#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// Phase-A draft used `bun_str`; the workspace crate is `bun_string`.
#![warn(unreachable_pub)]
extern crate bun_core as bun_str;

#[path = "StandaloneModuleGraph.rs"]
pub mod StandaloneModuleGraph;

// Re-export the flat surface most downstream callers use.
pub use StandaloneModuleGraph::{
    BASE_PATH, BASE_PUBLIC_PATH, File, StandaloneModuleGraph as Graph, is_bun_standalone_file_path,
};
