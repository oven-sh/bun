//! The lint rules behind `bun --lint`.

mod ast_utils;
pub mod code_frame;
mod context;
pub mod diagnostic;
pub mod diagnosticwriter;
mod linter;
pub mod program;
mod rule;
mod rules;
pub mod scanner;
#[cfg(test)]
mod tests;
mod tokens;
pub mod tspath;

use bun_js_parser::parse::parse_entry::ParsedForLint;

pub use diagnostic::{Category, Code, Diagnostic, FileId, MessageChain, SourceFile};

/// Every rule over one file as it was written, in one walk of its statements and of what the parse pass keeps beside them. Not sorted, not deduplicated.
/// `typescript`: the loader of the file is TypeScript.
pub fn lint<'a>(
    file: FileId,
    parsed: &ParsedForLint<'_, 'a>,
    source: &'a bun_ast::Source,
    typescript: bool,
) -> Vec<Diagnostic> {
    linter::run(
        context::Context::new(file, parsed, source, typescript),
        parsed,
    )
}
