//! The lint rules behind `bun --lint`.

mod ast_utils;
mod context;
mod linter;
mod rule;
mod rules;
mod tokens;

use std::borrow::Cow;

use bun_js_parser::parse::parse_entry::ParsedOnly;

/// Stand-in for the diagnostic of milestone C2: here only what the rules fill.
pub struct Diagnostic {
    pub start: u32,
    pub len: u32,
    pub severity: Severity,
    pub code: &'static str,
    pub text: Cow<'static, [u8]>,
}

/// Stand-in for the category of a diagnostic of milestone C2.
#[derive(Clone, Copy)]
pub enum Severity {
    Error,
}

/// Every rule over the statements of one file as they were written, in one walk. Not sorted, not deduplicated.
pub fn lint<'a>(
    parsed: &ParsedOnly<'_, 'a>,
    source: &'a bun_ast::Source,
    arena: &'a bun_alloc::Arena,
) -> Vec<Diagnostic> {
    linter::run(context::Context::new(parsed, source, arena), parsed.stmts)
}
