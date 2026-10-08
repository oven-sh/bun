//! `bun lint` and `bun format` without the command line: finds the configuration and the files,
//! parses them, type checks them if a rule asks for types, runs the rules or the formatter on all
//! cores, and prints what they report.
//!
//! - [`cli`]: the flags.
//! - [`run`]: `bun lint`, given the flags and an [`Environment`].

pub mod cli;
mod configs;
mod deprecated;
mod discover;
mod evaluate;
mod format;
mod fs;
mod gitignore;
mod lint;
mod paths;
mod results;
mod run;

pub use run::{Environment, Outcome, Script, Stream, run};
