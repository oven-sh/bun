//! Stand-in for `src/lint/lib.rs`: the entry, and the two types that milestone C2 owns (`Diagnostic`, `Severity`).

mod ast_utils;
mod context;
mod linter;
mod rule;
mod rules;
mod tokens;

use std::borrow::Cow;

use bun_js_parser::parse::parse_entry::ParsedOnly;

/// C2 owns this type: here only what the rules fill.
pub(crate) struct Diagnostic {
    pub(crate) start: u32,
    pub(crate) len: u32,
    pub(crate) severity: Severity,
    pub(crate) code: &'static str,
    pub(crate) text: Cow<'static, [u8]>,
}

/// C2 owns this type: the category of a diagnostic.
#[derive(Clone, Copy)]
pub(crate) enum Severity {
    Error,
}

/// Every rule over the statements of one file as they were written, in one walk. Not sorted, not deduplicated.
pub(crate) fn lint<'a>(
    parsed: &ParsedOnly<'_, 'a>,
    source: &'a bun_ast::Source,
    arena: &'a bun_alloc::Arena,
) -> Vec<Diagnostic> {
    linter::run(context::Context::new(parsed, source, arena), parsed.stmts)
}

/// Probe only: every token of the file as `start-end`, with `J` after a JSX element and `R` after a regular expression.
#[allow(clippy::disallowed_methods, clippy::disallowed_types, clippy::disallowed_macros)]
pub(crate) fn probe_tokens(
    parsed: &ParsedOnly<'_, '_>,
    source: &bun_ast::Source,
    arena: &bun_alloc::Arena,
) -> String {
    use bun_ast::lexer_tables::T;
    let Some(spans) = tokens::spans_under_stmts(&source.contents, parsed.stmts, bun_core::StackCheck::init()) else {
        return "FAILED".into();
    };
    let mut log = bun_ast::Log::init();
    let mut tokens = tokens::Tokens::new(&mut log, source, arena, &spans, 0);
    let mut line = String::new();
    while let Some(token) = tokens.next() {
        let tag = match (token.opaque, token.t) {
            (true, T::TLessThan) => "J",
            (true, T::TSlash | T::TSlashEquals) => "R",
            _ => "",
        };
        line.push_str(&format!("{}-{}{} ", token.start, token.end, tag));
    }
    line
}
