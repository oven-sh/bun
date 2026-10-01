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
