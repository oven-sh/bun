#![allow(non_snake_case)]
#![warn(unused_must_use)]

pub mod error;
pub use error::{Error, Result};

#[path = "StandaloneModuleGraph.rs"]
pub mod StandaloneModuleGraph;

// Re-export the flat surface most downstream callers use.
pub use StandaloneModuleGraph::{
    BASE_PATH, BASE_PUBLIC_PATH, File, StandaloneModuleGraph as Graph, is_bun_standalone_file_path,
};
