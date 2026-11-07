#![allow(non_snake_case)]
#![cfg_attr(test, feature(linkage))]

#[cfg(test)]
use bun_sema_standalone as _;
#[cfg(test)]
#[path = "../aot/standalone/engine_stubs.rs"]
mod engine_stubs;
#[cfg(test)]
bun_aot::define_linked_functions! {
    fn bun_aot_log_part_outside_stages(_name: &str) {}
}

pub mod error;
pub use error::{Error, Result};

#[path = "StandaloneModuleGraph.rs"]
pub mod StandaloneModuleGraph;
pub mod compiled_program;
mod executable_file;
pub mod executable_request;
pub use compiled_program::{
    CompiledEntryPointInput, CompiledPackageNameInput, CompiledPathAliasInput, CompiledProgramInput,
};
pub use executable_file::with_executable_image;

// Re-export the flat surface most downstream callers use.
pub use StandaloneModuleGraph::{
    BASE_PATH, BASE_PUBLIC_PATH, File, StandaloneModuleGraph as Graph, is_bun_standalone_file_path,
};
