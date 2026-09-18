#![feature(adt_const_params, generic_const_exprs, allocator_api)]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
#![allow(incomplete_features)]

pub mod error;
pub use error::{Error, Result};

#[path = "braces.rs"]
pub mod braces;

// ─── lexer / parser / AST ───────────────────────────────────────────────────
// Shell lex/parse — moved down from `bun_runtime::shell::shell_body`
// so `Interpreter::parse` can consume it without the JSC bridge.
#[path = "parse.rs"]
pub mod parse;

#[path = "json_fmt.rs"]
pub mod json_fmt;

pub use parse::{
    JSValueRaw, LexResult, LexerError, ParseError, Parser, ast, escape_8bit, escape_bun_str,
    needs_escape_bunstr, needs_escape_utf8_ascii_latin1,
};
