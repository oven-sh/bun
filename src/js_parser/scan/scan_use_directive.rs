use bun_alloc::Arena;
use bun_ast::{Log, Range, Source, UseDirective};

use crate::lexer::{Lexer, T};
use crate::parse::parse_suffix::continues_expression_after_line_break;

/// The use directive that is the first statement of `contents`, with the range of its literal.
pub fn scan_use_directive(contents: &[u8], arena: &Arena) -> Option<(UseDirective, Range)> {
    let source = Source::init_path_string("", contents);
    // The parse that follows reports what the lexer rejects.
    let mut log = Log::init();
    let mut lexer = Lexer::init_without_reading(&mut log, &source, arena);
    lexer.step();
    lexer.next().ok()?;
    if lexer.token == T::THashbang {
        lexer.next().ok()?;
    }
    if lexer.token != T::TStringLiteral {
        return None;
    }
    let range = lexer.range();
    let directive = match lexer.string_literal_raw_content {
        b"use client" => UseDirective::Client,
        b"use server" => UseDirective::Server,
        // "use strict" comes first in CommonJS output, and a client proxy cannot list its exports.
        _ => return None,
    };
    lexer.next().ok()?;
    match lexer.token {
        T::TSemicolon | T::TEndOfFile => Some((directive, range)),
        token if lexer.has_newline_before && !continues_expression_after_line_break(token) => {
            Some((directive, range))
        }
        // The string literal is only the start of an expression.
        _ => None,
    }
}
