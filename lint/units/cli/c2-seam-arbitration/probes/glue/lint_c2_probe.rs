//! Type-check probe of the C2 flow of `lint_command.rs`: collect, sort, print in one of two formats, exit.
#![allow(dead_code)]

use bstr::BStr;
use bun_core::{Global, Output};
use bun_lint::code_frame::write_code_frames;
use bun_lint::diagnosticwriter::write_format_diagnostics;
use bun_lint::log::diagnostics_from_msgs;
use bun_lint::program::sort_and_deduplicate_diagnostics;
use bun_lint::source_file::names_of;
use bun_lint::{Category, Code, Diagnostic, Files};
use std::borrow::Cow;
use std::io::Write;

const SUPPORTED_EXTENSIONS: &str =
    "'.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'";

/// An error that belongs to no file.
fn error_without_file(code: Code, text: Vec<u8>) -> Diagnostic {
    Diagnostic {
        file: None,
        start: 0,
        length: 0,
        category: Category::Error,
        code,
        text: Cow::Owned(text),
        chain: Vec::new(),
        related: Vec::new(),
    }
}

/// Checks each operand, prints every diagnostic once and in order, exits with 2 when one is an error.
pub(crate) fn run(cwd: &[u8], operands: &[Box<[u8]>]) -> ! {
    let mut files = Files::default();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    for operand in operands {
        check_file(cwd, operand, &mut files, &mut diagnostics);
    }
    let diagnostics = sort_and_deduplicate_diagnostics(&files, diagnostics);
    let failed = diagnostics
        .iter()
        .any(|diagnostic| diagnostic.category == Category::Error);
    if Output::is_stderr_tty() {
        let mut out = String::new();
        let _ = if Output::enable_ansi_colors_stderr() {
            write_code_frames::<true>(&mut out, &files, &diagnostics)
        } else {
            write_code_frames::<false>(&mut out, &files, &diagnostics)
        };
        let _ = Output::error_writer().write_all(out.as_bytes());
    } else {
        let mut out: Vec<u8> = Vec::new();
        write_format_diagnostics(&mut out, &files, &diagnostics);
        let _ = Output::error_writer().write_all(&out);
    }
    Output::flush();
    Global::exit(if failed { 2 } else { 0 });
}

fn loader_of(operand: &[u8]) -> Option<bun_ast::Loader> {
    match bun_bundler::options::DEFAULT_LOADERS.get(bun_paths::extension(operand)) {
        Some(
            loader @ (bun_ast::Loader::Js
            | bun_ast::Loader::Jsx
            | bun_ast::Loader::Ts
            | bun_ast::Loader::Tsx),
        ) => Some(*loader),
        _ => None,
    }
}

fn check_file(
    cwd: &[u8],
    operand: &[u8],
    files: &mut Files,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let Some(loader) = loader_of(operand) else {
        let mut text: Vec<u8> = Vec::new();
        let _ = write!(
            &mut text,
            "File '{}' has an unsupported extension. The only supported extensions are {}.",
            BStr::new(operand),
            SUPPORTED_EXTENSIONS
        );
        diagnostics.push(error_without_file(Code::UNSUPPORTED_EXTENSION, text));
        return;
    };
    let path = bun_core::ZBox::from_bytes(operand);
    let source = match bun_ast::to_source(&path, bun_ast::ToSourceOptions { convert_bom: true }) {
        Ok(source) => source,
        Err(err) => {
            let mut text: Vec<u8> = Vec::new();
            let _ = if err.get_errno() == bun_sys::E::ENOENT {
                write!(&mut text, "File '{}' not found.", BStr::new(operand))
            } else {
                write!(
                    &mut text,
                    "Cannot read file '{}': {}.",
                    BStr::new(operand),
                    BStr::new(err.name())
                )
            };
            diagnostics.push(error_without_file(Code::CANNOT_READ_FILE, text));
            return;
        }
    };
    let (name, display) = names_of(cwd, operand);
    let Some(id) = files.add(name, display, source.contents.into_owned()) else {
        diagnostics.push(error_without_file(
            Code::INTERNAL_ERROR,
            b"Too many files for one run.".to_vec(),
        ));
        return;
    };
    let Some(file) = files.get(id) else {
        return;
    };
    bun_ast::expr::data::Store::create();
    bun_ast::stmt::data::Store::create();
    let _reset = bun_ast::StoreResetGuard::new();
    let arena = bun_alloc::Arena::new();
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.is_macro_runtime = true;
    options.features.top_level_await = true;
    options.features.standard_decorators = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    log.level = bun_ast::Level::Warn;
    let parsed =
        match bun_js_parser::Parser::init(options, &mut log, file.source(), &define, &arena) {
            Ok(parser) => parser.parse().map(drop),
            Err(err) => Err(err),
        };
    if let Err(err) = parsed {
        if log.errors == 0 {
            log.add_range_error(
                Some(file.source()),
                bun_ast::Range::None,
                err.name().as_bytes(),
            );
        }
    }
    diagnostics_from_msgs(id, core::mem::take(&mut log.msgs), diagnostics);
}
