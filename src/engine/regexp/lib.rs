//! Regular expressions: parser, pattern compiler and backtracking interpreter.

#![forbid(unsafe_code)]

mod analysis;
mod compile;
mod construct;
mod context;
mod error;
mod escape;
mod flags;
mod form;
mod interpreter;
mod meter;
mod parser;
mod patient;
mod pattern;
pub mod program;
mod race;
pub mod set;
mod surrogate;
mod template;
pub mod tree;

pub use compile::{Compiler, Mode, Options, compile};
pub use construct::GroupNames;
pub use context::{Context, Outcome, helper};
pub use error::{Error, ErrorKind};
pub use escape::{escape, escape_pattern};
pub use flags::{Flags, FlagsText};
pub use form::Form;
pub use meter::FUEL;
pub use parser::{Summary, check_syntax, may_be_near_limits, summarize};
pub use patient::Patient;
pub use pattern::Pattern;
pub use program::{Program, Width};
pub use race::{Notes, Raced, Racing, Rivals, RunNative, Search};
pub use template::{Part, Template};
