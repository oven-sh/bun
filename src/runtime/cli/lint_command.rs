//! `bun --lint <files>`: reads and parses each operand and prints what the parser reports. No file is run.

use bstr::BStr;
use bun_core::{Global, Output};
use bun_options_types::context::Context;

/// The extensions a lint run reads, in the order TypeScript lists them.
const SUPPORTED_EXTENSIONS: &str =
    "'.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'";

/// Checks every operand and runs none. Exits with 1 without an operand, with 2 when a file has an error, else with 0.
#[cold]
#[inline(never)]
pub(crate) fn exec(ctx: Context<'_>) -> ! {
    let mut files: &[Box<[u8]>] = &ctx.positionals;
    // `bun run` keeps its own name as the first positional.
    if let [first, rest @ ..] = files
        && &**first == b"run"
    {
        files = rest;
    }
    if files.is_empty() && ctx.passthrough.is_empty() {
        bun_core::err_generic!("--lint needs one or more files");
        Global::exit(1);
    }
    let mut failed = false;
    let mut printed = false;
    for operand in files.iter().chain(ctx.passthrough.iter()) {
        failed |= check_file(operand, &mut printed);
    }
    Global::exit(if failed { 2 } else { 0 });
}

/// The loader of a file that a lint run parses, from its extension.
fn loader_of(operand: &[u8]) -> Option<bun_ast::Loader> {
    bun_bundler::options::DEFAULT_LOADERS
        .get(bun_paths::extension(operand))
        .copied()
        .filter(|loader| loader.is_javascript_like())
}

/// Declaration files are read and not parsed: the parser has no ambient top level.
fn is_declaration_file(operand: &[u8]) -> bool {
    operand.ends_with(b".d.ts") || operand.ends_with(b".d.mts") || operand.ends_with(b".d.cts")
}

/// Writes the empty line between the output of two operands.
fn separate(printed: &mut bool) {
    if core::mem::replace(printed, true) {
        Output::print_error("\n");
    }
}

/// Reads and parses one operand and prints what the log holds. `true`: the file has an error.
fn check_file(operand: &[u8], printed: &mut bool) -> bool {
    let Some(loader) = loader_of(operand) else {
        separate(printed);
        bun_core::err_generic!(
            "File '{}' has an unsupported extension. The only supported extensions are {}.",
            BStr::new(operand),
            SUPPORTED_EXTENSIONS
        );
        return true;
    };
    // The source and the log borrow the path: it outlives both.
    let path = bun_core::ZBox::from_bytes(operand);
    let source = match bun_ast::to_source(&path, bun_ast::ToSourceOptions { convert_bom: true }) {
        Ok(source) => source,
        Err(err) => {
            separate(printed);
            if err.get_errno() == bun_sys::E::ENOENT {
                bun_core::err_generic!("File '{}' not found.", BStr::new(operand));
            } else {
                bun_core::err_generic!(
                    "Cannot read file '{}': {}.",
                    BStr::new(operand),
                    BStr::new(err.name())
                );
            }
            return true;
        }
    };
    if is_declaration_file(operand) {
        return false;
    }
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
    let parsed = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena)
        .and_then(|parser| parser.parse().map(drop));
    if let Err(err) = parsed
        && log.errors == 0
    {
        log.add_range_error(Some(&source), bun_ast::Range::None, err.name().as_bytes());
    }
    if log.has_any() {
        separate(printed);
        // The buffer the messages above go to, so the output keeps the order of the operands.
        let _ = log.print(std::ptr::from_mut(Output::error_writer_buffered()));
        Output::flush();
    }
    log.errors > 0
}
