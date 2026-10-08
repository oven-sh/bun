//! JavaScript's regular expressions.

pub mod ast;
mod parser;
mod unicode;
mod unicode_tables;
mod validator;
mod wtf8;

pub use ast::{Ast, Flags, Node};
pub use parser::{parse_flags, parse_literal, parse_pattern};
pub use validator::{
    Handler, Ignore, Mode, Options, SyntaxError, validate_flags, validate_literal, validate_pattern,
};
pub use wtf8::{byte_offset, utf16_index};

/// `new RegExp(pattern, flags)`
#[derive(Debug)]
pub struct Regex {}

impl Regex {
    pub fn new(_pattern: &str, _flags: &str) -> Result<Regex, SyntaxError> {
        Ok(Regex {})
    }

    /// `regex.test(text)`
    pub fn test(&self, _text: &[u8]) -> bool {
        false
    }
}
