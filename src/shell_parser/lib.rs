#![feature(adt_const_params, generic_const_exprs, allocator_api)]
#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
#![allow(incomplete_features)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ─── B-2 un-gate ────────────────────────────────────────────────────────────
// Phase-A draft of `braces` is now wired up. Remaining lower-tier gaps are
// flagged inline with `// TODO(b2-blocked): bun_X::Y` and reported upstream.
#![warn(unreachable_pub)]
#[path = "braces.rs"]
pub mod braces;

// Re-exports the Phase-A draft expected at crate root (it did `use crate::{...}`).
pub use braces::{
    CharIter, InputChar, ShellCharIter, ShellCharIterState, StringEncoding, has_eq_sign,
};

// ─── B-2 un-gate: lexer / parser / AST ──────────────────────────────────────
// Port of `shell.zig` lex/parse — moved down from `bun_runtime::shell::shell_body`
// so `Interpreter::parse` can consume it without the (still-gated) JSC bridge.
#[path = "parse.rs"]
pub mod parse;

#[path = "json_fmt.rs"]
pub mod json_fmt;

pub use parse::{
    BACKSLASHABLE_CHARS, EscapeUtf16Result, IfClauseTok, JSValueRaw, LEX_JS_OBJREF_PREFIX,
    LEX_JS_STRING_PREFIX, LexError, LexResult, Lexer, LexerAscii, LexerError, LexerUnicode,
    MemoryCost, ParseError, Parser, ParserError, SPECIAL_CHARS, SPECIAL_CHARS_TABLE, SmolList,
    SubShellKind, SubshellKind, TextRange, Token, TokenTag, assert_special_char, ast, ast as AST,
    escape_8bit, escape_bun_str, escape_utf16, is_valid_var_name, needs_escape_bunstr,
    needs_escape_utf8_ascii_latin1, needs_escape_utf16,
};
// NOTE: `StringEncoding`/`ShellCharIter`/`InputChar`/`has_eq_sign` already
// re-exported from `braces` above; `parse` defines its own (lexer-shaped)
// copies which stay module-scoped to avoid crate-root ambiguity.
