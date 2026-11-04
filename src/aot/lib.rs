#![feature(optimize_attribute)]
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
pub mod module_keys;
#[cfg(test)]
pub mod module_list;
pub mod modules;
#[cfg(test)]
pub mod options;
pub mod prelude;
pub mod report;
pub mod statistics;
mod test_run_loads;
#[allow(dead_code, reason = "most of its callers land apart from it")]
mod test_run_report;
mod test_runs;

#[cfg(not(test))]
pub use bun_aot_builtins::builtins;
#[cfg(not(test))]
pub use bun_aot_interface::{diagnostic_codes, module_keys, module_list, options};

pub use compile::{BuildFailed, Compilation, compile, link_program};
pub use load::source_provider::{SourceProvider, WithoutServices};
pub use options::Options;
