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
use crate::ast::{File, Stmt};
use crate::context::Severity;
use crate::language::{Parser, SourceType};
use crate::options::Json;
use bun_sema::hir::{Diagnostic, DiagnosticKind, StmtKind};

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
            // oxlint goes by whether the file has `import` or `export`. It is not refused here for what may pass there.
            !language.refuses_what_parser_refuses
                || is_espree
                    && language.source_type != SourceType::Module
                    && !language.implied_strict
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
        (_, of_parser) if !file.language().refuses_what_parser_refuses => {
            let of_oxlint = || match file.path() {
                _ if file.is_javascript()
                    && let Some(it) = espree::typescript_in_javascript(file) =>
                {
                    Some(it)
                }
                [.., b'.', b'c', b'j', b's'] => espree::module_syntax_in_commonjs(file, false),
                [.., b'.', b'c', b't', b's'] => espree::module_syntax_in_commonjs(file, true),
                _ => None,
            };
            of_parser.map(|it| it.1).or_else(of_oxlint)
        }
        // It converts a tree only if the parser has nothing to say.
        (Parser::TypeScript, None) => typescript_estree::first_error(file, false),
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

/// Prettier's `isFlowFile`: it has `babel-flow` parse the file in place of `babel`. There is `@flow` or `@noflow` in a comment
/// before the code.
fn goes_to_flow(file: &File) -> bool {
    let text = file.text();
    let after_shebang = match text.starts_with(b"#!") {
        true => bun_core::strings::index_of_any(text, b"\n\r").unwrap_or(text.len()),
        false => 0,
    };
    let code = crate::tokens::skip_trivia(text, after_shebang as u32) as usize;
    let mut comments = text.get(after_shebang..code).unwrap_or_default();
    while let Some(at) = bun_core::strings::index_of_char_usize(comments, b'@') {
        comments = &comments[at + 1..];
        let word = comments
            .strip_prefix(b"no")
            .unwrap_or(comments)
            .strip_prefix(b"flow");
        if word.is_some_and(|it| {
            !matches!(
                it.first(),
                Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
            )
        }) {
            return true;
        }
    }
    file.path().ends_with(b".js.flow")
}

/// Whether Prettier refuses to format the file, which was parsed in the dialect of Babel
/// ([`Dialect::babel`](bun_sema::resolve::Dialect::babel)): its parser throws. That is `typescript`, which is typescript-estree, for
/// a TypeScript file, and `babel` for a JavaScript file. What `languageOptions` of the file say about a parser does not count.
///
/// Types in JavaScript are [tolerated](TypesInJavaScript::Tolerated).
pub fn refused_by_prettier<'a>(file: &'a File<'a>) -> bool {
    refused_by_prettier_with(file, TypesInJavaScript::Tolerated)
}

/// What becomes of a JavaScript file with the syntax of TypeScript: `var a: T`, `a as T`, `interface A {}`, `class A<T> {}`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TypesInJavaScript {
    /// `babel` throws. It is what Prettier takes for a `.js`, `.jsx`, `.mjs` or `.cjs` file and for a `js` block in Markdown.
    Refused,
    /// The file goes to `flow`, `babel-flow`, `typescript` or `babel-ts`, which somebody has asked for by name. So do some of
    /// Prettier's own tests, for which `babel` is listed as failing: `js/babel-plugins/typescript.js` is `const x: number = 0;`.
    Tolerated,
}

/// [`refused_by_prettier`], with a say about types in JavaScript.
pub fn refused_by_prettier_with<'a>(file: &'a File<'a>, types: TypesInJavaScript) -> bool {
    // `import a from "a" assert { .. }` passes. `typescript` accepts it. `babel` does not, but Prettier's own tests have such
    // JavaScript files formatted, by other parsers, and nobody is served by a refusal.
    let is_reported = |it: &Diagnostic| {
        it.kind == DiagnosticKind::Parse && it.code != 2880 && !file.is_in_jsdoc(it.start)
    };
    let of_parser = file.hir.diagnostics.iter();
    let says_why = of_parser.clone().any(|it| it.kind == DiagnosticKind::Parse);
    if file.has_parse_errors() && (of_parser.clone().any(is_reported) || !says_why) {
        return true;
    }
    // Refused even where types are tolerated: `type A = 1`, `a!`, a function without a body, decorators on both sides of
    // `export`.
    let is_strict = types == TypesInJavaScript::Refused;
    let is_typescript = |it: &Diagnostic| {
        (is_strict && it.kind == DiagnosticKind::Js
            || matches!(it.kind, DiagnosticKind::Js | DiagnosticKind::Grammar)
                && matches!(it.code, 1206 | 8008 | 8013 | 8017 | 8038))
            && !file.is_in_jsdoc(it.start)
    };
    // `declare module "a" {}`, `declare global {}`, `export as namespace A`: the parser says nothing about them.
    let is_declaration = |it: Stmt| {
        matches!(
            it.try_raw().map(|it| it.kind),
            Some(StmtKind::Module(_) | StmtKind::ExportAsNamespace(_))
        )
    };
    match file.is_javascript() {
        true if goes_to_flow(file) => espree::is_refused_by_babel(file),
        true if of_parser.clone().any(is_typescript) => true,
        true if is_strict && file.body().iter().any(is_declaration) => true,
        true => espree::is_refused_by_babel(file),
        false => typescript_estree::first_error(file, true).is_some(),
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
