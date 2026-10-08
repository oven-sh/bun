//! Whether a file is refused, and with which message.
//!
//! ESLint lints no file that its parser throws on: the one message is `Parsing error: ..`. The file here is parsed by TypeScript's
//! parser, whatever `languageOptions.parser` is, and that accepts more than either of ESLint's parsers:
//!
//! - [`typescript_estree`]: what `@typescript-eslint/parser` throws while it converts the tree.
//! - [`espree`]: what acorn checks as it parses, and how espree words an error.
//!
//! It also reports what they do not: see [`is_tolerated`].

mod espree;
mod order;
mod typescript_estree;

use super::message::LintMessage;
use crate::ast::File;
use crate::context::Severity;
use crate::language::{Parser, SourceType};
use crate::options::Json;
use bun_sema::hir::{Diagnostic, DiagnosticKind};

/// Why a parser throws, and where.
struct SyntaxError {
    at: u32,
    message: Vec<u8>,
}

/// Whether neither of ESLint's parsers, or not the one of this file, reports `diagnostic`.
fn is_tolerated(file: &File, diagnostic: &Diagnostic) -> bool {
    // They do not look into comments.
    if file.is_in_jsdoc(diagnostic.start) {
        return true;
    }
    let language = file.language();
    let is_espree = language.parser == Parser::Espree;
    match diagnostic.code {
        // Octal literals and escapes, `\8`, `08`: errors in strict mode only. TypeScript's parser always reports them.
        1121 | 1487 | 1488 | 1489 => {
            is_espree && language.source_type != SourceType::Module && !language.implied_strict
        }
        // `import a from "a" assert { .. }`, which typescript-estree accepts.
        2880 => true,
        // `a?.#b`
        18030 => is_espree,
        _ => false,
    }
}

/// The first error of TypeScript's parser that counts.
fn error_of_parser<'a>(file: &'a File<'a>) -> Option<Option<&'a Diagnostic>> {
    if !file.has_parse_errors() {
        return None;
    }
    let mut of_parser = (file.hir.diagnostics.iter()).filter(|it| it.kind == DiagnosticKind::Parse);
    match of_parser.clone().find(|it| !is_tolerated(file, it)) {
        Some(first) => Some(Some(first)),
        None if of_parser.next().is_some() => None,
        // It gave up without saying why.
        None => Some(None),
    }
}

/// The message for a file that ESLint's parser throws on. No rule runs on such a file.
pub fn parse_error<'a>(file: &'a File<'a>) -> Option<LintMessage> {
    let parser = file.language().parser;
    let of_parser = error_of_parser(file).map(|diagnostic| {
        let mut message = Vec::new();
        match diagnostic.and_then(|it| Some((it, bun_sema::messages::message(it.code)?.1))) {
            Some((it, text)) => bun_sema::messages::format(&mut message, text, &it.args),
            None => message.extend_from_slice(b"Unexpected token"),
        }
        (
            diagnostic,
            SyntaxError {
                at: diagnostic.map_or(0, |it| it.start),
                message,
            },
        )
    });
    let error = match (parser, of_parser) {
        (_, of_parser) if !file.language().refuses_what_parser_refuses => (of_parser
            .map(|it| it.1))
        .or_else(|| espree::typescript_in_javascript(file).filter(|_| file.is_javascript())),
        // It converts a tree only if the parser has nothing to say.
        (Parser::TypeScript, None) => typescript_estree::first_error(file),
        (Parser::Espree, of_parser) => {
            espree::first_error(file, of_parser.map(|it| (it.0, it.1.at)))
        }
        (_, of_parser) => of_parser.map(|it| it.1),
    }?;
    let at = file.position(error.at);
    Some(LintMessage {
        rule_id: None,
        severity: Severity::Error,
        message: [b"Parsing error: ", &error.message[..]].concat(),
        message_id: None,
        line: at.line,
        // typescript-estree counts the column of an error from 0, espree from 1.
        column: at.column + u32::from(parser != Parser::TypeScript),
        end: None,
        is_fatal: true,
        fix: None,
        suggestions: Vec::new(),
        suppressions: Vec::new(),
        comments_apply_at: None,
    })
}

/// Whether oxlint says nothing about the file, which it cannot parse: it is JavaScript, and its first comment has `@flow`.
pub(super) fn is_flow<'a>(file: &'a File<'a>) -> bool {
    file.is_javascript()
        && (file.comments().map(|it| file.slice(it.span())))
            .find(|it| !it.starts_with(b"#!"))
            .is_some_and(|it| bun_core::strings::contains(it, b"@flow"))
}

/// Whether Prettier refuses to format the file, which was parsed in the dialect of Babel
/// ([`Dialect::babel`](bun_sema::resolve::Dialect::babel)): its parser throws. That is `typescript`, which is typescript-estree, for
/// a TypeScript file, and `babel` for a JavaScript file. What `languageOptions` of the file say about a parser does not count.
pub fn refused_by_prettier<'a>(file: &'a File<'a>) -> bool {
    let is_javascript = file.is_javascript();
    // `import a from "a" assert { .. }`, which typescript-estree accepts and Babel does not without a plugin.
    let is_assert = |it: &Diagnostic| it.code == 2880;
    let is_reported = |it: &Diagnostic| {
        it.kind == DiagnosticKind::Parse && !is_assert(it) && !file.is_in_jsdoc(it.start)
    };
    let mut of_parser = file.hir.diagnostics.iter();
    let says_why = of_parser.clone().any(|it| it.kind == DiagnosticKind::Parse);
    if file.has_parse_errors() && (of_parser.clone().any(is_reported) || !says_why)
        || is_javascript && of_parser.any(is_assert)
    {
        return true;
    }
    match is_javascript {
        true => espree::is_refused_by_babel(file),
        false => typescript_estree::first_error(file).is_some(),
    }
}

/// What `@typescript-eslint/parser` throws for the file at `path`, which is absolute, if `parserOptions.projectService` is on and
/// no `tsconfig.json` includes the file. It has no place. ESLint does not lint such a file, whatever the rules are.
///
/// Whether that is so is for the caller to know: a [`File`] without types can be one for which nobody has asked.
pub fn not_in_a_project(path: &[u8]) -> LintMessage {
    let message: [&[u8]; 3] = [
        b"Parsing error: ",
        path,
        b" was not found by the project service. Consider either including it in the tsconfig.json or including it in allowDefaultProject.",
    ];
    LintMessage {
        rule_id: None,
        severity: Severity::Error,
        message: message.concat(),
        message_id: None,
        line: 0,
        column: 0,
        end: None,
        is_fatal: true,
        fix: None,
        suggestions: Vec::new(),
        suppressions: Vec::new(),
        comments_apply_at: None,
    }
}

/// What the parser has left in the HIR, for a test to look at.
#[doc(hidden)]
pub fn diagnostics(file: &File) -> Vec<Json> {
    let describe = |it: &Diagnostic| {
        let mut message = Vec::new();
        if let Some((_, text)) = bun_sema::messages::message(it.code) {
            bun_sema::messages::format(&mut message, text, &it.args);
        }
        Json::Object(vec![
            (
                b"kind".to_vec(),
                Json::String(format!("{:?}", it.kind).into_bytes()),
            ),
            (b"code".to_vec(), Json::Number(f64::from(it.code))),
            (b"start".to_vec(), Json::Number(f64::from(it.start))),
            (b"message".to_vec(), Json::String(message)),
        ])
    };
    file.hir.diagnostics.iter().map(describe).collect()
}
