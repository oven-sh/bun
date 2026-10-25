#![cfg_attr(test, feature(linkage))]

#[cfg(test)]
pub mod builtins;
pub mod compile;
#[cfg(test)]
pub mod diagnostic_codes;
pub mod diagnostics;
pub mod emit;
pub mod engine;
pub mod ir;
pub mod known_helpers;
pub mod link;
#[cfg(not(test))]
mod linked;
pub mod load;
pub mod lower;
#[cfg(test)]
pub mod module_list;
pub mod modules;
#[cfg(test)]
pub mod options;
mod package_diagnostics;
pub mod prelude;
pub mod report;
pub mod statistics;

#[cfg(not(test))]
pub use bun_aot_builtins::builtins;
#[cfg(not(test))]
pub use bun_aot_interface::{diagnostic_codes, module_list, options};

pub use compile::{BuildFailed, Compilation, compile, emit_program, link_program};
pub use load::source_provider::{SourceProvider, WithoutServices};
pub use options::Options;
