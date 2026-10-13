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
mod oxc;
mod oxc_typescript;
mod typescript_estree;

use super::message::{Details, LintMessage, NotNumbers};
use crate::ast::{File, Stmt};
use crate::context::Severity;
use crate::language::{Parser, SourceType};
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use bun_sema::hir::{Diagnostic, DiagnosticKind, StmtKind};
use std::borrow::Cow;

/// Why a parser throws, and where.
#[derive(Default)]
struct SyntaxError {
    at: u32,
    /// Where oxc's label ends, like [`Diagnostic::end`]: 0 is the end of the token at `at`. ESLint's parsers only have a place.
    end: u32,
    message: Vec<u8>,
    of_oxc: OfOxc,
}

/// What oxlint prints about an error beside its message and the place of its first label, and when it prints it.
#[derive(Default)]
struct OfOxc {
    /// 1038 for `TS(1038)`. 0: the error has no code.
    code: u16,
    /// What it says at the first label.
    first_label: Cow<'static, str>,
    /// The other labels, in oxlint's order: where each is, and what it says there.
    labels: Vec<(Span, Cow<'static, str>)>,
    help: Cow<'static, str>,
    note: Cow<'static, str>,
    stage: Stage,
    /// Where the error is in the order in which oxlint prints the errors of a file, if that is not where its last label starts.
    /// `u32::MAX`: oxc reports it when it is through with the file.
    noticed: Option<u32>,
}

/// Which part of oxc reports an error.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
enum Stage {
    /// The pass that builds the scopes. It reports all that it finds, and does not run on a file that the parser has an error for.
    #[default]
    Semantic,
    /// The parser, which goes on.
    Parser,
    /// The parser, which gives up: nothing after it is reported.
    Fatal,
}

impl SyntaxError {
    /// An error of oxc whose first label is `label`.
    #[inline(always)]
    fn of_oxc(label: Span, message: impl AsRef<[u8]>) -> SyntaxError {
        Self::of_oxc_with(label, message.as_ref())
    }

    /// One body for the hundred places that make one.
    #[cold]
    #[inline(never)]
    fn of_oxc_with(label: Span, message: &[u8]) -> SyntaxError {
        SyntaxError {
            at: label.start,
            end: match label.end == label.start {
                true => Diagnostic::NO_LENGTH,
                false => label.end,
            },
            message: message.to_vec(),
            of_oxc: OfOxc::default(),
        }
    }

    /// "Expected `;` but found `Identifier`". `wanted`: in backticks. `found`: what oxc calls the token at `label`.
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
        Self::of_oxc_with(label, &texts.concat()).says([wanted, " expected"].concat())
    }

    /// oxc takes what ends at `after` for a statement, and gives up at what follows on the line.
    #[cold]
    #[inline(never)]
    fn semicolon_after(after: u32) -> SyntaxError {
        let message =
            "Expected a semicolon or an implicit semicolon after a statement, but found none";
        Self::of_oxc(Span::empty(after), message)
            .help("Try inserting a semicolon here")
            .stage(Stage::Fatal)
    }

    /// `name` is declared at `first` and again at `again`.
    #[cold]
    #[inline(never)]
    fn redeclared(what: &str, name: &[u8], first: Span, again: Span) -> SyntaxError {
        let name = bstr::BStr::new(name);
        Self::of_oxc(first, format!("{what} `{name}` has already been declared"))
            .says(format!("`{name}` has already been declared here"))
            .and(again, "It can not be redeclared here")
    }

    /// `TS(code)`
    fn code(mut self, code: u16) -> SyntaxError {
        self.of_oxc.code = code;
        self
    }

    /// `text`: what it says at the first label.
    fn says(mut self, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.of_oxc.first_label = text.into();
        self
    }

    /// One more label.
    fn and(mut self, label: Span, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.of_oxc.labels.push((label, text.into()));
        self
    }

    fn help(mut self, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.of_oxc.help = text.into();
        self
    }

    fn note(mut self, text: impl Into<Cow<'static, str>>) -> SyntaxError {
        self.of_oxc.note = text.into();
        self
    }

    fn stage(mut self, stage: Stage) -> SyntaxError {
        self.of_oxc.stage = stage;
        self
    }

    /// [`OfOxc::noticed`]
    fn noticed_at(mut self, at: u32) -> SyntaxError {
        self.of_oxc.noticed = Some(at);
        self
    }

    /// [`OfOxc::noticed`], or where the last label starts.
    fn order(&self) -> u32 {
        let last = self.of_oxc.labels.last().map_or(self.at, |it| it.0.start);
        self.of_oxc.noticed.unwrap_or(last)
    }
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

/// The errors of TypeScript's parser that count, in the words of oxc, up to the first at which oxc's parser gives up. Which of
/// the diagnostics of the file that one is, and the token at which TypeScript's parser has it.
fn errors_of_parser_for_oxc<'a>(file: &'a File<'a>) -> (Vec<SyntaxError>, Option<(usize, u32)>) {
    match file.has_parse_errors() {
        true => in_words_of_oxc(file, file.hir.diagnostics),
        false => (Vec::new(), None),
    }
}

/// [`errors_of_parser_for_oxc`], of `diagnostics`.
#[optimize(size)]
fn in_words_of_oxc<'a>(
    file: &'a File<'a>,
    diagnostics: &[Diagnostic],
) -> (Vec<SyntaxError>, Option<(usize, u32)>) {
    let of_parser = diagnostics.iter().enumerate();
    let mut of_parser = of_parser.filter(|it| it.1.kind == DiagnosticKind::Parse);
    let mut all = Vec::new();
    // After a character that it does not know TypeScript's parser is lost, where oxc's lexer goes on. Only what it says about other
    // such characters still counts.
    let mut lost = None;
    for (place, it) in of_parser.clone().filter(|it| !is_tolerated(file, it.1)) {
        if lost.is_some() && it.code != 1127 {
            continue;
        }
        let mut errors = oxc::of_typescript(file, it);
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
        // Nothing follows a comment that is not closed.
        let is_last = it.code == 1010 || errors.iter().any(|it| it.of_oxc.stage == Stage::Fatal);
        all.append(&mut errors);
        if is_last {
            return (all, lost.or(Some((place, it.start))));
        }
        if it.code == 1127 {
            lost = lost.or(Some((place, it.start)));
        }
    }
    if lost.is_some() {
        return (all, lost);
    }
    // It gave up without saying why.
    if all.is_empty() && of_parser.next().is_none() {
        let error = SyntaxError {
            message: b"Unexpected token".to_vec(),
            ..SyntaxError::default()
        };
        all.push(error.stage(Stage::Fatal));
    }
    (all, None)
}

/// Whether the parser of the configuration, which is neither espree nor that of typescript-eslint, may read what is a syntax error
/// here. The tree has holes then, which no rule expects.
pub fn may_be_misread<'a>(file: &'a File<'a>) -> bool {
    file.language().parser == Parser::Other
        && (error_of_parser(file).is_some()
            || typescript_estree::first_error(file, false).is_some())
}

/// The message for a file that ESLint's parser throws on. No rule runs on such a file.
pub fn parse_error<'a>(file: &'a File<'a>) -> Option<LintMessage> {
    parse_errors(file).into_iter().next()
}

/// [`parse_error`], and the others that oxlint prints about the file, in its order. ESLint's parsers throw one.
pub fn parse_errors<'a>(file: &'a File<'a>) -> Vec<LintMessage> {
    parse_errors_and_stage(file).0
}

/// [`parse_errors`], and whether a parser has them. `false`: oxc has parsed the file, and the pass that builds its scopes has them.
pub(super) fn parse_errors_and_stage<'a>(file: &'a File<'a>) -> (Vec<LintMessage>, bool) {
    let parser = file.language().parser;
    // It has no place.
    if parser == Parser::Espree
        && let Some(message) = espree::editions::refused_options(file)
    {
        let refused = LintMessage {
            message: [b"Parsing error: ", &message[..]].concat(),
            is_fatal: true,
            ..LintMessage::default()
        };
        return (vec![refused], true);
    }
    if !file.language().refuses_what_parser_refuses {
        let (of_parser, stop) = errors_of_parser_for_oxc(file);
        let all = oxc::errors(file, of_parser, stop.map(|it| it.0), false);
        let is_of_parser = all.iter().any(|it| it.of_oxc.stage != Stage::Semantic);
        let messages = all.into_iter().map(|it| message_of(file, it)).collect();
        return (messages, is_of_parser);
    }
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
                end: diagnostic.map_or(0, |it| it.end),
                message,
                ..SyntaxError::default()
            },
        )
    });
    let one = |it: Option<SyntaxError>| it.into_iter().collect::<Vec<_>>();
    let errors = match (parser, of_parser) {
        // It converts a tree only if the parser has nothing to say.
        (Parser::TypeScript, None) => one(typescript_estree::first_error(file, false)),
        (Parser::Espree, of_parser) => one(espree::first_error(
            file,
            of_parser.map(|it| (it.0, it.1.at)),
        )),
        (_, of_parser) => one(of_parser.map(|it| it.1)),
    };
    let messages = (errors.into_iter())
        .map(|it| message_of(file, it))
        .collect();
    (messages, true)
}

fn message_of<'a>(file: &'a File<'a>, error: SyntaxError) -> LintMessage {
    let parser = file.language().parser;
    let at = file.position(error.at);
    let end = (!file.language().refuses_what_parser_refuses).then(|| {
        let rest = file.text().get(error.at as usize..).unwrap_or_default();
        let end = file.position(match error.end {
            Diagnostic::NO_LENGTH => error.at,
            0 => error.at + token_len(rest) as u32,
            end => end,
        });
        (end.line, end.column + 1)
    });
    let place = |at: u32| {
        let it = file.position(at);
        (it.line, it.column + 1)
    };
    let OfOxc {
        code,
        first_label,
        labels,
        help,
        note,
        ..
    } = error.of_oxc;
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
                .map(|(span, text)| (place(span.start), place(span.end), text))
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

/// Whether oxlint says nothing about the file, which it cannot parse: it is JavaScript, and its first comment has `@flow`.
/// What the pass that builds the scopes has to say about a file that oxc can parse, it prints.
/// oxc looks at the comments that its lexer has passed. Where it gives up, that's those before the token that is wrong.
pub(super) fn is_flow<'a>(file: &'a File<'a>) -> bool {
    let mut comments = file.comments().map(|it| it.span());
    let first = comments.find(|it| !file.slice(*it).starts_with(b"#!"));
    let Some(first) = first.filter(|_| file.is_javascript()) else {
        return false;
    };
    if !bun_core::strings::contains(file.slice(first), b"@flow") {
        return false;
    }
    // It goes on after some errors, to the end of the file.
    let gives_up_at = match errors_of_parser_for_oxc(file) {
        (_, Some((_, at))) => Some(at),
        (of_parser, None) if !of_parser.is_empty() => None,
        _ => espree::typescript_in_javascript(file).map(|it| it.at),
    };
    gives_up_at.is_none_or(|at| first.start < at)
}

/// Prettier's `isFlowFile`: it has `babel-flow` parse the file in place of `babel`. There is `@flow` or `@noflow` in a comment
/// before the code, or the name of the file ends with `.js.flow`.
pub fn goes_to_flow(text: &[u8], path: &[u8]) -> bool {
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
    refusal_of_prettier(file, types).is_some()
}

/// Why Prettier refuses to format a file.
pub struct Refusal {
    /// Without a place. For a TypeScript file these are the words of Prettier. For a JavaScript file they are those of
    /// TypeScript's parser or of acorn, where Prettier has Babel's.
    pub message: Vec<u8>,
    /// The offset in the text of the file.
    pub at: u32,
}

/// [`refused_by_prettier_with`], with the reason.
pub fn refusal_of_prettier<'a>(file: &'a File<'a>, types: TypesInJavaScript) -> Option<Refusal> {
    refusal(file, types, true)
}

/// Why oxfmt refuses to format a file, which was parsed as for oxlint: what oxc's parser reports. The pass that builds the scopes
/// does not run, and no regular expression is parsed.
pub fn refusal_of_oxfmt<'a>(file: &'a File<'a>) -> Option<Refusal> {
    let (of_parser, stop) = errors_of_parser_for_oxc(file);
    let all = oxc::errors(file, of_parser, stop.map(|it| it.0), true);
    all.into_iter().next().map(|it| Refusal {
        message: it.message,
        at: it.at,
    })
}

fn refusal<'a>(
    file: &'a File<'a>,
    types: TypesInJavaScript,
    finds_candidates: bool,
) -> Option<Refusal> {
    let of_diagnostic = |it: &Diagnostic| {
        let mut message = Vec::new();
        match bun_sema::messages::message(it.code) {
            Some((_, text)) => bun_sema::messages::format(&mut message, text, &it.args),
            None => message.extend_from_slice(b"Unexpected token"),
        }
        Refusal {
            message,
            at: it.start,
        }
    };
    let of_check = |it: SyntaxError| Refusal {
        message: it.message,
        at: it.at,
    };
    // `import a from "a" assert { .. }` passes. `typescript` accepts it. `babel` does not, but Prettier's own tests have such
    // JavaScript files formatted, by other parsers, and nobody is served by a refusal.
    let is_reported = |it: &&Diagnostic| {
        it.kind == DiagnosticKind::Parse && it.code != 2880 && !file.is_in_jsdoc(it.start)
    };
    let of_parser = file.hir.diagnostics.iter();
    if file.has_parse_errors() {
        if let Some(it) = of_parser.clone().find(is_reported) {
            return Some(of_diagnostic(it));
        }
        if !of_parser.clone().any(|it| it.kind == DiagnosticKind::Parse) {
            return Some(Refusal {
                message: b"Unexpected token".to_vec(),
                at: 0,
            });
        }
    }
    if !file.is_javascript() {
        return typescript_estree::first_error(file, true).map(of_check);
    }
    let of_babel = || espree::refusal_of_babel(file, finds_candidates).map(of_check);
    if file.is_flow() || goes_to_flow(file.text(), file.path()) {
        return of_babel();
    }
    // Refused even where types are tolerated: `type A = 1`, `a!`, a function without a body, decorators on both sides of
    // `export`.
    let is_strict = types == TypesInJavaScript::Refused;
    let is_typescript = |it: &&Diagnostic| {
        (is_strict && it.kind == DiagnosticKind::Js
            || matches!(it.kind, DiagnosticKind::Js | DiagnosticKind::Grammar)
                && matches!(it.code, 1206 | 8008 | 8013 | 8017 | 8038))
            && !file.is_in_jsdoc(it.start)
    };
    // `declare module "a" {}`, `declare global {}`, `export as namespace A`: the parser says nothing about them. Babel takes
    // `declare` for a name, and expects the `{` of `export {}`.
    let of_declaration = |it: Stmt| {
        let start = it.span().start;
        let after_first_token =
            start + token_len(file.text().get(start as usize..).unwrap_or_default()) as u32;
        match it.try_raw()?.kind {
            StmtKind::Module(_) => Some(Refusal {
                message: b"Missing semicolon.".to_vec(),
                at: after_first_token,
            }),
            StmtKind::ExportAsNamespace(_) => Some(Refusal {
                message: b"Unexpected token, expected \"{\"".to_vec(),
                at: skip_trivia(file.text(), after_first_token),
            }),
            _ => None,
        }
    };
    let of_typescript = of_parser
        .clone()
        .filter(is_typescript)
        .min_by_key(|it| it.start);
    let of_declaration = match is_strict {
        true => file.body().iter().find_map(of_declaration),
        false => None,
    };
    // Babel throws at once at what it cannot parse. After an early error it goes on, and Prettier throws it at the end.
    [of_typescript.map(of_diagnostic), of_declaration]
        .into_iter()
        .flatten()
        .min_by_key(|it| it.at)
        .or_else(of_babel)
}
