//! `bun lint` and `bun fmt` without the command line: finds the configuration and the files,
//! parses them, type checks them if a rule asks for types, runs the rules or the formatter on all
//! cores, and prints what they report.
//!
//! - [`cli`]: the flags.
//! - [`bunfig`]: their defaults in bunfig.toml.
//! - [`run`]: `bun lint`, given the flags and an [`Environment`].
//! - [`fmt`]: the same for `bun fmt`.

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]
// For what a flag like `--doctor`, `--rules` or `--init` runs once: `#[optimize(size)]` roughly halves it, and how fast it is
// doesn't matter. Nothing that runs for each file has it.
#![feature(optimize_attribute)]

mod args;
pub mod bunfig;
pub mod cli;
mod configs;
mod deprecated;
mod discover;
mod doctor;
mod embedded;
mod eslintrc;
mod evaluate;
mod explain;
pub mod fmt;
pub mod for_tests;
mod format;
mod fs;
pub mod git;
mod gitignore;
mod inferred;
mod init;
mod lint;
mod native;
mod print_config;
mod processor;
mod results;
pub mod rules;
mod rulesdir;
mod run;
mod suppressions;
mod typed;

/// With all the rules that there are.
pub(crate) type Linter = bun_lint::linter::Linter<rules::Rules>;

pub use args::Param;
pub use bun_lint::js_plugin;
pub(crate) use bun_lint::paths;
pub use bun_lint::paths::from_native as from_native_path;
pub use run::{Environment, Outcome, Script, Stream, refuse_command_line, run};
