//! SCRATCH: the planned `parse` of src/runtime/cli/lint_command.rs, as a crate of its own for the check and as a module of the probe.

use bun_js_parser::parse::syntax_errors::SyntaxErrors;
use bun_lint::{Diagnostic, FileId};

/// What is found in one file: what the parser reports and, in a file that parses, what the rules report.
pub fn parse(file: FileId, loader: bun_ast::Loader, source: &bun_ast::Source) -> Vec<Diagnostic> {
    bun_ast::initialize_store();
    let _reset = bun_ast::StoreResetGuard::new();
    let arena = bun_alloc::Arena::new();
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    // A macro call stays a call: nothing is evaluated.
    options.features.no_macros = true;
    options.features.is_macro_runtime = true;
    options.features.top_level_await = true;
    options.features.standard_decorators = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    log.level = bun_ast::Level::Warn;
    let mut errors = SyntaxErrors::default();
    // One entry for every loader: the rules read the statements as they were written and the side table beside them.
    let parsed = bun_js_parser::Parser::init(options, &mut log, source, &define, &arena).and_then(
        |parser| {
            parser.parse_for_lint_with_codes(&mut errors, |parsed| {
                bun_lint::lint(file, parsed, source)
            })
        },
    );
    let reports = match parsed {
        Ok(reports) => reports,
        Err(err) => {
            if log.errors == 0 {
                log.add_range_error(Some(source), bun_ast::Range::None, err.name().as_bytes());
            }
            Vec::new()
        }
    };
    // A TypeScript file has a syntax error as tsc has it. A JavaScript file keeps the text of Bun's parser.
    let is_coded = loader.is_typescript();
    core::mem::take(&mut log.msgs)
        .into_iter()
        .enumerate()
        .filter_map(|(index, msg)| {
            let reference = if is_coded { errors.get(index) } else { None };
            Diagnostic::from_syntax_error(file, msg, reference)
        })
        .chain(reports)
        .collect()
}
