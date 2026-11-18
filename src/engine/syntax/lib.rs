//! Lexer, parser, scope analysis and early errors.

#![forbid(unsafe_code)]

pub mod ast;
mod cache;
mod chars;
mod error;
mod lexer;
mod lines;
mod names;
mod options;
mod parser;
mod scope;
mod source;
mod token;

pub use cache::{KnownCapture, KnownFunction, SourceCache};
pub use error::{Error, ErrorKind, Recovery};
pub use lines::LineTable;
pub use names::{Name, NameKind, Names};
pub use options::{
    EvalContext, FieldKind, FieldSource, FunctionFlags, FunctionKind, FunctionSource, Goal, Options,
};
pub use parser::{Parser, PauseKind, PausePosition};
