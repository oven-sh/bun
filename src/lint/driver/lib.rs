//! `bun lint` and `bun fmt` without the command line: finds the config and the files, parses them, type checks them if
//! a rule needs types, runs the rules or the formatter on all cores, and prints the results.
//!
//! - [`cli`]: the flags.
//! - [`bunfig`]: their defaults in bunfig.toml.
//! - [`run`]: runs `bun lint`, given the flags and an [`Environment`].
//! - [`fmt`]: the same for `bun fmt`.

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]
// For code that a flag like `--doctor`, `--rules` or `--init` runs once. `#[optimize(size)]` roughly halves its size,
// and its speed doesn't matter. Nothing that runs per file has it.
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

/// A linter with every rule registered.
pub(crate) type Linter = bun_lint::linter::Linter<rules::Rules>;

pub use args::Param;
pub use bun_lint::js_plugin;
pub(crate) use bun_lint::paths;
pub use bun_lint::paths::from_native as from_native_path;
pub use run::{Environment, Outcome, Script, Stream, reject_command_line, run};
