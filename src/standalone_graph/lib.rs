#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub mod error;
pub use error::{Error, Result};

#[path = "StandaloneModuleGraph.rs"]
pub mod StandaloneModuleGraph;

/// In-process binder for the `.node` addons merged into a Windows `--compile` exe.
#[cfg(windows)]
#[path = "LinkedNodeModule.rs"]
pub mod LinkedNodeModule;

// Re-export the flat surface most downstream callers use.
pub use StandaloneModuleGraph::{
    BASE_PATH, BASE_PUBLIC_PATH, File, StandaloneModuleGraph as Graph, is_bun_standalone_file_path,
};
