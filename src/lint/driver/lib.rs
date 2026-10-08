//! `bun lint` and `bun format` without the command line: finds the configuration and the files,
//! parses them, type checks them if a rule asks for types, runs the rules or the formatter on all
//! cores, and prints what they report.
//!
//! - [`cli`]: the flags.
//! - [`run`]: `bun lint`, given the flags and an [`Environment`].
//! - [`fmt`]: the same for `bun format`.

mod args;
pub mod cli;
mod configs;
mod deprecated;
mod discover;
mod evaluate;
pub mod fmt;
mod format;
mod fs;
mod gitignore;
mod lint;
mod paths;
mod print_config;
mod results;
mod run;
mod suppressions;
mod typed;

pub use args::Param;
pub use bun_lint::js_plugin;
pub use paths::from_native as from_native_path;
pub use run::{Environment, Outcome, Script, Stream, run};
