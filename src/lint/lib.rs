//! The lint rules behind `bun --lint`.

mod ast_utils;
mod context;
pub mod diagnostic;
pub mod diagnosticwriter;
mod linter;
mod rule;
mod rules;
pub mod scanner;
mod tokens;
pub mod tspath;

use bun_js_parser::parse::parse_entry::ParsedOnly;

pub use diagnostic::{Category, Code, Diagnostic, FileId, MessageChain, SourceFile};

/// Every rule over the statements of one file as they were written, in one walk. Not sorted, not deduplicated.
pub fn lint<'a>(
    file: FileId,
    parsed: &ParsedOnly<'_, 'a>,
    source: &'a bun_ast::Source,
    arena: &'a bun_alloc::Arena,
) -> Vec<Diagnostic> {
    linter::run(
        context::Context::new(file, parsed, source, arena),
        parsed.stmts,
    )
}
