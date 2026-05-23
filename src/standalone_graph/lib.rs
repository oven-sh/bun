#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
// Early drafts used `bun_str` as the crate name; aliased here for compat.

#[path = "StandaloneModuleGraph.rs"]
pub mod StandaloneModuleGraph;

// Re-export the flat surface most downstream callers use.
pub use StandaloneModuleGraph::{
    BASE_PATH, BASE_PUBLIC_PATH, File, StandaloneModuleGraph as Graph, is_bun_standalone_file_path,
};
