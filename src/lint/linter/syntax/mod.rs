//! Decides whether a file is rejected as unparsable, and with which message.
//!
//! ESLint doesn't lint a file its parser throws on. Its only message for that file is `Parsing error: ..`. Here every
//! file is parsed by TypeScript's parser, whatever `languageOptions.parser` is, and it accepts more than either of
//! ESLint's parsers. These modules add the missing errors:
//!
//! - [`typescript_estree`]: what `@typescript-eslint/parser` throws while it converts the tree.
//! - [`espree`]: what acorn checks as it parses, and how espree words an error.
//!
//! TypeScript's parser also reports some errors they don't. See [`is_tolerated`].

mod espree;
mod order;
mod oxc;
mod oxc_typescript;
mod typescript_estree;

use super::message::{Details, LintMessage, NotNumbers};
use crate::ast::{File, Stmt, StmtTag};
use crate::context::Severity;
use crate::language::{Parser, SourceType};
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use bun_sema::hir::{Diagnostic, DiagnosticKind, StmtKind, rare};
use std::borrow::Cow;

/// Why a parser throws, and where.
#[derive(Default)]
struct SyntaxError {
    at: u32,
    /// The end of oxc's label, encoded like [`Diagnostic::end`]: 0 is the end of the token at `at`. ESLint's parsers
    /// only report a start position.
    end: u32,
    message: Vec<u8>,
    oxc_details: OxcDetails,
}

/// Everything oxlint prints for an error besides the message and the first label's position, plus what determines the
/// error's order.
#[derive(Default)]
struct OxcDetails {
    /// 1038 for `TS(1038)`. 0 if the error has no code.
    code: u16,
    /// The first label's text.
    first_label: Cow<'static, str>,
    /// The other labels' spans and texts, in oxlint's order.
    labels: Vec<(Span, Cow<'static, str>)>,
    help: Cow<'static, str>,
    note: Cow<'static, str>,
    stage: Stage,
    /// The offset oxlint sorts this error by when it prints a file's errors, if that isn't the start of the last label.
    /// `u32::MAX` means oxc reports it after it has finished the file.
    noticed: Option<u32>,
}

/// The part of oxc that reports an error.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
enum Stage {
    /// The semantic pass, which builds the scopes. It reports everything it finds, and doesn't run if the parser
    /// reported an error.
    #[default]
    Semantic,
    /// The parser, which recovers and continues.
    Parser,
    /// The parser, which gives up. Nothing after this error is reported.
    Fatal,
}

impl SyntaxError {
    /// An oxc error whose first label is at `label`.
    #[inline(always)]
    fn oxc_error(label: Span, message: impl AsRef<[u8]>) -> SyntaxError {
        Self::oxc_error_with(label, message.as_ref())
    }

    /// Out of line so that the hundred or so call sites share one body.
    #[cold]
    #[inline(never)]
    fn oxc_error_with(label: Span, message: &[u8]) -> SyntaxError {
        SyntaxError {
            at: label.start,
            end: match label.end == label.start {
                true => Diagnostic::NO_LENGTH,
                false => label.end,
            },
            message: message.to_vec(),
            oxc_details: OxcDetails::default(),
        }
    }

    /// "Expected `;` but found `Identifier`". `wanted` includes its backticks. `found` is oxc's name for the token at
    /// `label`.
    #[cold]
    #[inline(never)]
    fn expected(label: Span, wanted: &str, found: &[u8]) -> SyntaxError {
        let texts: [&[u8]; 5] = [
            b"Expected ",
            wanted.as_bytes(),
            b" but found `",
            found,
            b"`",
        ];
        Self::oxc_error_with(label, &texts.concat()).label_text([wanted, " expected"].concat())
    }

    /// oxc parsed the code ending at `after` as a statement and gives up at whatever follows on the same line.
    #[cold]
    #[inline(never)]
    fn semicolon_after(after: u32) -> SyntaxError {
        let message =
            "Expected a semicolon or an implicit semicolon after a statement, but found none";
        Self::oxc_error(Span::empty(after), message)
            .help("Try inserting a semicolon here")
            .stage(Stage::Fatal)
    }

    /// `name` is declared at `first` and again at `again`.
    #[cold]
    #[inline(never)]
    fn redeclared(what: &str, name: &[u8], first: Span, again: Span) -> SyntaxError {
        let name = bstr::BStr::new(name);
        Self::oxc_error(first, format!("{what} `{name}` has already been declared"))
            .label_text(format!("`{name}` has already been declared here"))
            .and(again, "It can not be redeclared here")
    }

    /// `TS(code)`
    fn code(mut self, code: u16) -> SyntaxError {
        self.oxc_details.code = code;
        self
    }

    /// Sets the first label's text.
    fn label_text(mut self, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.oxc_details.first_label = text.into();
        self
    }

    /// Adds another label.
    fn and(mut self, label: Span, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.oxc_details.labels.push((label, text.into()));
        self
    }

    fn help(mut self, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.oxc_details.help = text.into();
        self
    }

    fn note(mut self, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.oxc_details.note = text.into();
        self
    }

    fn stage(mut self, stage: Stage) -> SyntaxError {
        self.oxc_details.stage = stage;
        self
    }

    /// [`OxcDetails::noticed`]
    fn noticed_at(mut self, at: u32) -> SyntaxError {
        self.oxc_details.noticed = Some(at);
        self
    }

    /// [`OxcDetails::noticed`], or where the last label starts.
    fn order(&self) -> u32 {
        let last = self
            .oxc_details
            .labels
            .last()
            .map_or(self.at, |it| it.0.start);
        self.oxc_details.noticed.unwrap_or(last)
    }
}

/// True if this file's ESLint parser doesn't report `diagnostic`.
fn is_tolerated(file: &File, diagnostic: &Diagnostic) -> bool {
    // ESLint's parsers don't parse JSDoc.
    if file.is_in_jsdoc(diagnostic.start) {
        return true;
    }
    let language = file.language();
    let is_espree = language.parser == Parser::Espree;
    match diagnostic.code {
        // Octal literals and escapes, `\8`, `08`. They're errors only in strict mode, but TypeScript's parser always
        // reports them.
        1121 | 1487 | 1488 | 1489 => {
            // oxlint decides by whether the file has `import` or `export`. Don't reject a file that oxlint might
            // accept.
            !language.rejects_what_parser_rejects
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

/// The first error from TypeScript's parser that isn't tolerated. `Some(None)` means the parser failed without a
/// diagnostic.
fn first_parser_error<'a>(file: &'a File<'a>) -> Option<Option<&'a Diagnostic>> {
    if !file.has_parse_errors() {
        return None;
    }
    let mut parse_diagnostics =
        (file.hir.diagnostics.iter()).filter(|it| it.kind == DiagnosticKind::Parse);
    match parse_diagnostics.clone().find(|it| !is_tolerated(file, it)) {
        Some(first) => Some(Some(first)),
        None if parse_diagnostics.next().is_some() => None,
        None => Some(None),
    }
}

/// Translates the errors from TypeScript's parser that aren't tolerated into oxc's wording, up to the first one where
/// oxc's parser gives up. Also returns that one's index in the file's diagnostics and the offset TypeScript's parser
/// reports it at.
fn parser_errors_for_oxc<'a>(file: &'a File<'a>) -> (Vec<SyntaxError>, Option<(usize, u32)>) {
    match file.has_parse_errors() {
        true => to_oxc_errors(file, file.hir.diagnostics),
        false => (Vec::new(), None),
    }
}

/// [`parser_errors_for_oxc`] for the given `diagnostics`.
#[optimize(size)]
fn to_oxc_errors<'a>(
    file: &'a File<'a>,
    diagnostics: &[Diagnostic],
) -> (Vec<SyntaxError>, Option<(usize, u32)>) {
    let parse_diagnostics = diagnostics.iter().enumerate();
    let mut parse_diagnostics = parse_diagnostics.filter(|it| it.1.kind == DiagnosticKind::Parse);
    let mut all = Vec::new();
    // TypeScript's parser doesn't recover well from an invalid character (1127), but oxc's lexer continues. After the
    // first one, only errors about other invalid characters are used.
    let mut first_invalid_character = None;
    for (index, it) in parse_diagnostics
        .clone()
        .filter(|it| !is_tolerated(file, it.1))
    {
        if first_invalid_character.is_some() && it.code != 1127 {
            continue;
        }
        let mut errors = oxc::translate_typescript_error(file, it);
        if errors.is_empty() {
            let mut message = Vec::new();
            match bun_sema::messages::message(it.code) {
                Some((_, text)) => bun_sema::messages::format(&mut message, text, &it.args),
                None => message.extend_from_slice(b"Unexpected token"),
            }
            let error = SyntaxError {
                at: it.start,
                end: it.end,
                message,
                ..SyntaxError::default()
            };
            errors.push(error.stage(Stage::Fatal));
        }
        // Nothing can follow an unterminated comment.
        let is_last =
            it.code == 1010 || errors.iter().any(|it| it.oxc_details.stage == Stage::Fatal);
        all.append(&mut errors);
        if is_last {
            return (all, first_invalid_character.or(Some((index, it.start))));
        }
        if it.code == 1127 {
            first_invalid_character = first_invalid_character.or(Some((index, it.start)));
        }
    }
    if first_invalid_character.is_some() {
        return (all, first_invalid_character);
    }
    // The parser failed without a diagnostic.
    if all.is_empty() && parse_diagnostics.next().is_none() {
        let error = SyntaxError {
            message: b"Unexpected token".to_vec(),
            ..SyntaxError::default()
        };
        all.push(error.stage(Stage::Fatal));
    }
    (all, None)
}

/// Counts the syntax errors in a file that is linted anyway. TypeScript's parser defers them to the checker, and
/// typescript-estree doesn't report them: `var a,` at the end of a line, `class A extends B, {}`. A fix must not add
/// one.
pub(super) fn tolerated_errors<'a>(file: &'a File<'a>) -> usize {
    let is_syntax = |it: &&Diagnostic| {
        matches!(
            it.kind,
            DiagnosticKind::Parse | DiagnosticKind::Js | DiagnosticKind::Grammar
        ) && !file.is_in_jsdoc(it.start)
    };
    let found = file.hir.diagnostics.iter().filter(is_syntax).count();
    if !file.has_rare_syntax(rare::ODD_DECLARATION) {
        return found;
    }
    // The parser has no diagnostic for a declaration list that ends with a comma.
    let text = file.text();
    let ends_with_comma = |it: &Stmt| {
        let Some(StmtKind::Var(list)) = it.try_raw().map(|it| it.kind) else {
            return false;
        };
        let declarations = file.hir.var_decls.get(list.range()).unwrap_or_default();
        let after = declarations.last().map(|it| skip_trivia(text, it.loc.end));
        after.is_some_and(|it| text.get(it as usize) == Some(&b','))
    };
    let lists = file.stmts_of_kind(StmtTag::Var);
    found + lists.filter(ends_with_comma).count()
}

/// Counts the illegal redeclarations in the file: a name declared again in the same scope, such as two imports, an
/// import and a `const`, or two `let`. In JavaScript espree rejects a file like that. In TypeScript only the type
/// checker reports it (TS2300, TS2451, TS2440). Declarations that TypeScript merges don't count: overloads, an
/// interface and a class, a namespace and a function, a type and a value. This builds the file's scopes, so only call
/// it on text whose fixes will be applied or that fixes produced.
pub fn redeclarations<'a>(file: &'a File<'a>) -> usize {
    oxc::count_of_redeclarations(file)
}

/// True if the config's parser is neither espree nor typescript-eslint's, and the file has what we consider a syntax
/// error. That parser may accept the file, but our tree has holes that no rule expects.
pub fn may_be_misread<'a>(file: &'a File<'a>) -> bool {
    file.language().parser == Parser::Other
        && (first_parser_error(file).is_some()
            || typescript_estree::first_error(file, false).is_some())
}

/// The message for a file that ESLint's parser throws on. No rules run on such a file.
pub fn parse_error<'a>(file: &'a File<'a>) -> Option<LintMessage> {
    parse_errors(file).into_iter().next()
}

/// [`parse_error`], plus any further errors oxlint prints for the file, in oxlint's order. ESLint's parsers throw only
/// one.
pub fn parse_errors<'a>(file: &'a File<'a>) -> Vec<LintMessage> {
    parse_errors_and_stage(file).0
}

/// [`parse_errors`], and true if they come from a parser. False means oxc parsed the file and its semantic pass
/// reported them.
pub(super) fn parse_errors_and_stage<'a>(file: &'a File<'a>) -> (Vec<LintMessage>, bool) {
    let parser = file.language().parser;
    // This error has no position.
    if parser == Parser::Espree
        && let Some(message) = espree::editions::invalid_parser_options(file)
    {
        let options_error = LintMessage {
            message: [b"Parsing error: ", &message[..]].concat(),
            is_fatal: true,
            ..LintMessage::default()
        };
        return (vec![options_error], true);
    }
    if !file.language().rejects_what_parser_rejects {
        let (parser_errors, stop) = parser_errors_for_oxc(file);
        let all = oxc::errors(file, parser_errors, stop.map(|it| it.0), false);
        let is_from_parser = all.iter().any(|it| it.oxc_details.stage != Stage::Semantic);
        let messages = all.into_iter().map(|it| message_of(file, it)).collect();
        return (messages, is_from_parser);
    }
    let parser_error = first_parser_error(file).map(|diagnostic| {
        let mut message = Vec::new();
        match diagnostic.and_then(|it| Some((it, bun_sema::messages::message(it.code)?.1))) {
            Some((it, text)) => bun_sema::messages::format(&mut message, text, &it.args),
            None => message.extend_from_slice(b"Unexpected token"),
        }
        (
            diagnostic,
            SyntaxError {
                at: diagnostic.map_or(0, |it| it.start),
                end: diagnostic.map_or(0, |it| it.end),
                message,
                ..SyntaxError::default()
            },
        )
    });
    let one = |it: Option<SyntaxError>| it.into_iter().collect::<Vec<_>>();
    let errors = match (parser, parser_error) {
        // typescript-estree converts the tree only if the parser reported no errors.
        (Parser::TypeScript, None) => one(typescript_estree::first_error(file, false)),
        (Parser::Espree, parser_error) => one(espree::first_error(
            file,
            parser_error.map(|it| (it.0, it.1.at)),
        )),
        (_, parser_error) => one(parser_error.map(|it| it.1)),
    };
    let messages = (errors.into_iter())
        .map(|it| message_of(file, it))
        .collect();
    (messages, true)
}

fn message_of<'a>(file: &'a File<'a>, error: SyntaxError) -> LintMessage {
    let parser = file.language().parser;
    let at = file.position(error.at);
    let end = (!file.language().rejects_what_parser_rejects).then(|| {
        let rest = file.text().get(error.at as usize..).unwrap_or_default();
        let end = file.position(match error.end {
            Diagnostic::NO_LENGTH => error.at,
            0 => error.at + token_len(rest) as u32,
            end => end,
        });
        (end.line, end.column + 1)
    });
    let line_and_column = |at: u32| {
        let it = file.position(at);
        (it.line, it.column + 1)
    };
    let OxcDetails {
        code,
        first_label,
        labels,
        help,
        note,
        ..
    } = error.oxc_details;
    let has_details = code != 0
        || !first_label.is_empty()
        || !labels.is_empty()
        || !help.is_empty()
        || !note.is_empty();
    let details = has_details.then(|| {
        let labels = labels.into_iter();
        Box::new(Details {
            first_label,
            labels: labels
                .map(|(span, text)| (line_and_column(span.start), line_and_column(span.end), text))
                .collect(),
            help,
            note,
            typescript_code: code,
        })
    });
    LintMessage {
        rule_id: None,
        severity: Severity::Error,
        message: [b"Parsing error: ", &error.message[..]].concat(),
        message_id: None,
        line: at.line,
        // typescript-estree counts the column of an error from 0, espree from 1.
        column: at.column + u32::from(parser != Parser::TypeScript),
        end,
        is_fatal: true,
        claim: None,
        fix: None,
        suggestions: Vec::new(),
        suppressions: Vec::new(),
        comments_apply_at: None,
        not_numbers: NotNumbers::default(),
        details,
        constant_help: None,
        reported: 0,
    }
}

/// True if oxlint silently skips this file, which it can't parse, because it's JavaScript and its first comment has
/// `@flow`. If oxc can parse the file, oxlint still prints the semantic pass's errors. oxc only sees the comments its
/// lexer got past, so if it gives up, that's the comments before the bad token.
pub(super) fn is_flow<'a>(file: &'a File<'a>) -> bool {
    let mut comments = file.comments().map(|it| it.span());
    let first = comments.find(|it| !file.slice(*it).starts_with(b"#!"));
    let Some(first) = first.filter(|_| file.is_javascript()) else {
        return false;
    };
    if !bun_core::strings::contains(file.slice(first), b"@flow") {
        return false;
    }
    // oxc recovers from some errors and continues to the end of the file.
    let gives_up_at = match parser_errors_for_oxc(file) {
        (_, Some((_, at))) => Some(at),
        (parser_errors, None) if !parser_errors.is_empty() => None,
        _ => espree::typescript_in_javascript(file).map(|it| it.at),
    };
    gives_up_at.is_none_or(|at| first.start < at)
}

/// Prettier's `isFlowFile`. If true, Prettier parses the file with `babel-flow` instead of `babel`. That's the case if
/// a comment before the code has `@flow` or `@noflow`, or the file name ends with `.js.flow`.
pub fn is_flow_file(text: &[u8], path: &[u8]) -> bool {
    let after_shebang = match text.starts_with(b"#!") {
        true => bun_core::strings::index_of_any(text, b"\n\r").unwrap_or(text.len()),
        false => 0,
    };
    let code = skip_trivia(text, after_shebang as u32) as usize;
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
    path.ends_with(b".js.flow")
}

/// How to treat TypeScript syntax in a JavaScript file: `var a: T`, `a as T`, `interface A {}`, `class A<T> {}`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TypesInJavaScript {
    /// `babel` throws. Prettier picks `babel` for a `.js`, `.jsx`, `.mjs` or `.cjs` file and for a `js` block in
    /// Markdown.
    Rejected,
    /// The user explicitly chose `flow`, `babel-flow`, `typescript` or `babel-ts` as the parser. Some of Prettier's own
    /// tests do too and list `babel` as failing: `js/babel-plugins/typescript.js` is `const x: number = 0;`.
    Tolerated,
}

/// True if Prettier refuses to format the file. `types` controls how TypeScript syntax in JavaScript is treated.
pub fn rejected_by_prettier_with<'a>(file: &'a File<'a>, types: TypesInJavaScript) -> bool {
    prettier_rejection(file, types).is_some()
}

/// The reason Prettier refuses to format a file.
pub struct Rejection {
    /// Doesn't include the position. For a TypeScript file this is Prettier's wording. For a JavaScript file it's the
    /// wording of TypeScript's parser or acorn, where Prettier would print Babel's.
    pub message: Vec<u8>,
    /// Byte offset in the file.
    pub at: u32,
}

/// Like [`rejected_by_prettier_with`], but returns the reason.
pub fn prettier_rejection<'a>(file: &'a File<'a>, types: TypesInJavaScript) -> Option<Rejection> {
    rejection(file, types, true)
}

/// The reason oxfmt refuses to format a file, which is the first error oxc's parser reports. The file must have been
/// parsed with oxlint's settings. oxfmt doesn't run the semantic pass or parse regular expressions.
pub fn oxfmt_rejection<'a>(file: &'a File<'a>) -> Option<Rejection> {
    let (parser_errors, stop) = parser_errors_for_oxc(file);
    let all = oxc::errors(file, parser_errors, stop.map(|it| it.0), true);
    all.into_iter().next().map(|it| Rejection {
        message: it.message,
        at: it.at,
    })
}

fn rejection<'a>(
    file: &'a File<'a>,
    types: TypesInJavaScript,
    finds_candidates: bool,
) -> Option<Rejection> {
    let from_diagnostic = |it: &Diagnostic| {
        let mut message = Vec::new();
        match bun_sema::messages::message(it.code) {
            Some((_, text)) => bun_sema::messages::format(&mut message, text, &it.args),
            None => message.extend_from_slice(b"Unexpected token"),
        }
        Rejection {
            message,
            at: it.start,
        }
    };
    let from_syntax_error = |it: SyntaxError| Rejection {
        message: it.message,
        at: it.at,
    };
    // `import a from "a" assert { .. }` is accepted. `typescript` accepts it. `babel` doesn't, but Prettier's own tests
    // format such JavaScript files with other parsers, and rejecting them wouldn't help anyone.
    let is_reported = |it: &&Diagnostic| {
        it.kind == DiagnosticKind::Parse && it.code != 2880 && !file.is_in_jsdoc(it.start)
    };
    let all_diagnostics = file.hir.diagnostics.iter();
    if file.has_parse_errors() {
        if let Some(it) = all_diagnostics.clone().find(is_reported) {
            return Some(from_diagnostic(it));
        }
        if !all_diagnostics
            .clone()
            .any(|it| it.kind == DiagnosticKind::Parse)
        {
            return Some(Rejection {
                message: b"Unexpected token".to_vec(),
                at: 0,
            });
        }
    }
    if !file.is_javascript() {
        return typescript_estree::first_error(file, true).map(from_syntax_error);
    }
    let babel_error = || espree::babel_rejection(file, finds_candidates).map(from_syntax_error);
    if file.is_flow() || is_flow_file(file.text(), file.path()) {
        return babel_error();
    }
    // Rejected even where types are tolerated: `type A = 1`, `a!`, a function without a body, decorators on both sides
    // of `export`.
    let is_strict = types == TypesInJavaScript::Rejected;
    let is_typescript = |it: &&Diagnostic| {
        (is_strict && it.kind == DiagnosticKind::Js
            || matches!(it.kind, DiagnosticKind::Js | DiagnosticKind::Grammar)
                && matches!(it.code, 1206 | 8008 | 8013 | 8017 | 8038))
            && !file.is_in_jsdoc(it.start)
    };
    // The parser has no diagnostic for `declare module "a" {}`, `declare global {}` or `export as namespace A`. Babel
    // parses `declare` as an identifier, and after `export` it expects the `{` of `export {}`.
    let reject_declaration = |it: Stmt| {
        let start = it.span().start;
        let after_first_token =
            start + token_len(file.text().get(start as usize..).unwrap_or_default()) as u32;
        match it.try_raw()?.kind {
            StmtKind::Module(_) => Some(Rejection {
                message: b"Missing semicolon.".to_vec(),
                at: after_first_token,
            }),
            StmtKind::ExportAsNamespace(_) => Some(Rejection {
                message: b"Unexpected token, expected \"{\"".to_vec(),
                at: skip_trivia(file.text(), after_first_token),
            }),
            _ => None,
        }
    };
    let typescript_diagnostic = all_diagnostics
        .clone()
        .filter(is_typescript)
        .min_by_key(|it| it.start);
    let declaration_rejection = match is_strict {
        true => file.body().iter().find_map(reject_declaration),
        false => None,
    };
    // Babel throws immediately at code it can't parse. It recovers from an early error, and Prettier throws that one at
    // the end.
    [
        typescript_diagnostic.map(from_diagnostic),
        declaration_rejection,
    ]
    .into_iter()
    .flatten()
    .min_by_key(|it| it.at)
    .or_else(babel_error)
}
