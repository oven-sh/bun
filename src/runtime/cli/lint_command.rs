//! `bun --lint <files>`: parses each operand, runs the rules on JavaScript, prints the diagnostics sorted and each once. No file is run.

use bstr::BStr;
use bun_core::{Global, Output, ZBox, ZStr};
use bun_lint::code_frame::write_code_frames;
use bun_lint::diagnosticwriter::{FormattingOptions, write_format_diagnostics};
use bun_lint::program::sort_and_deduplicate_diagnostics;
use bun_lint::tspath::{self, ComparePathsOptions};
use bun_lint::{Category, Code, Diagnostic, FileId, SourceFile};
use bun_options_types::context::Context;

/// The extensions a lint run reads, in the order TypeScript lists them.
const SUPPORTED_EXTENSIONS: &str =
    "'.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'";

/// `true` for `--lint` and `--lint=...`.
fn is_lint_token(token: &[u8]) -> bool {
    token == b"--lint" || token.starts_with(b"--lint=")
}

/// Says what `--lint` cannot be combined with and exits with 1.
#[cold]
#[inline(never)]
pub(crate) fn refuse(what: &str) -> ! {
    bun_core::err_generic!("--lint cannot be used with {}", what);
    Global::exit(1);
}

/// Refuses `--lint` among the options of `BUN_OPTIONS`: `bun_core::argv` has them directly after the name of the program.
#[cold]
#[inline(never)]
pub(crate) fn refuse_in_bun_options() {
    let argv = bun_core::argv();
    let mut options = argv.iter().skip(1).take(bun_core::bun_options_argc());
    if options.any(is_lint_token) {
        bun_core::err_generic!("--lint cannot be set in BUN_OPTIONS");
        Global::exit(1);
    }
}

/// Refuses `--lint` among the flags that `bunx_command::Options::parse` reads before the package name.
#[inline(never)]
pub(crate) fn refuse_in_bunx(argv: &[&'static ZStr]) {
    let mut seen_command_word = false;
    let mut tokens = argv.iter();
    while let Some(token) = tokens.next() {
        let token = token.as_bytes();
        if token.first() != Some(&b'-') {
            if seen_command_word {
                return;
            }
            seen_command_word = true;
            continue;
        }
        if is_lint_token(token) {
            refuse("bunx");
        }
        // The next token is the value of the flag, whatever it is.
        if token == b"--package" || token == b"-p" {
            let _ = tokens.next();
        }
    }
}

/// Refuses `--lint` among the options a compiled executable parses: `argv` is its name, then those built into it and those of `BUN_OPTIONS`.
#[inline(never)]
pub(crate) fn refuse_in_compiled_executable(argv: &[&'static ZStr]) {
    if argv.iter().skip(1).any(|arg| is_lint_token(arg.as_bytes())) {
        bun_core::err_generic!("--lint cannot be used in a compiled executable");
        Global::exit(1);
    }
}

/// Checks every operand and runs none. Exits with 1 without an operand or with one after the first that starts with `-`, with 2 when a diagnostic is an error, else with 0.
#[cold]
#[inline(never)]
pub(crate) fn exec(ctx: Context<'_>) -> ! {
    let mut operands: &[Box<[u8]>] = &ctx.positionals;
    // `bun run` keeps its own name as the first positional.
    if let [first, rest @ ..] = operands
        && &**first == b"run"
    {
        operands = rest;
    }
    if operands.is_empty() && ctx.passthrough.is_empty() {
        bun_core::err_generic!("--lint needs one or more files");
        Global::exit(1);
    }
    // Flags are parsed up to the first operand: a later token that starts with `-` would be read as a file.
    let mut later = operands.iter().chain(&ctx.passthrough).skip(1);
    if let Some(token) = later.find(|token| token.first() == Some(&b'-')) {
        bun_core::err_generic!(
            "--lint cannot be used with \"{}\" after the first file",
            BStr::new(token)
        );
        Global::exit(1);
    }
    let cwd = ctx.args.absolute_working_dir.as_deref().unwrap_or_default();
    let failed = run(operands, &ctx.passthrough, cwd);
    Global::exit(if failed { 2 } else { 0 });
}

/// Checks the operands and prints every diagnostic of the run, in order and once. `true`: one of them is an error.
fn run(operands: &[Box<[u8]>], passthrough: &[Box<[u8]>], cwd: &[u8]) -> bool {
    // With forward slashes on every platform, as the current directory of the reference.
    let current_directory = tspath::get_normalized_absolute_path(cwd, b"");
    // A source borrows its path: `paths` is declared before `files`, so it is dropped after it.
    let paths: Vec<ZBox> = operands
        .iter()
        .chain(passthrough)
        .map(|operand| ZBox::from_bytes(&**operand))
        .collect();
    let mut files: Vec<SourceFile> = Vec::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    for path in &paths {
        check_file(path, &current_directory, &mut files, &mut diagnostics);
    }
    let diagnostics = sort_and_deduplicate_diagnostics(&files, diagnostics);
    write_diagnostics(&files, &diagnostics, &current_directory);
    diagnostics
        .iter()
        .any(|diagnostic| diagnostic.category == Category::Error)
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

/// An error that belongs to no file.
fn error_without_file(code: Code, text: core::fmt::Arguments<'_>) -> Diagnostic {
    Diagnostic {
        file: None,
        start: 0,
        length: 0,
        category: Category::Error,
        code,
        text: bun_ast::alloc_print(text),
        chain: Vec::new(),
        related: Vec::new(),
    }
}

/// Reads and parses one operand. What is found goes to `diagnostics`, and the file to `files` when something was found in it.
fn check_file(
    path: &ZStr,
    current_directory: &[u8],
    files: &mut Vec<SourceFile>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let operand = path.as_bytes();
    let Some(loader) = loader_of(operand) else {
        diagnostics.push(error_without_file(
            Code::UNSUPPORTED_EXTENSION,
            format_args!(
                "File '{}' has an unsupported extension. The only supported extensions are {}.",
                BStr::new(operand),
                SUPPORTED_EXTENSIONS
            ),
        ));
        return;
    };
    let source = match bun_ast::to_source(path, bun_ast::ToSourceOptions { convert_bom: true }) {
        Ok(source) => source,
        Err(err) => {
            diagnostics.push(if err.get_errno() == bun_sys::E::ENOENT {
                error_without_file(
                    Code::CANNOT_READ_FILE,
                    format_args!("File '{}' not found.", BStr::new(operand)),
                )
            } else {
                error_without_file(
                    Code::CANNOT_READ_FILE,
                    format_args!(
                        "Cannot read file '{}': {}.",
                        BStr::new(operand),
                        BStr::new(err.name())
                    ),
                )
            });
            return;
        }
    };
    if is_declaration_file(operand) {
        return;
    }
    // The place of the file in `files` when it is kept.
    let file = FileId(u32::try_from(files.len()).unwrap_or(u32::MAX));
    let found = parse(file, loader, &source);
    // Nothing points into the text of a file without a diagnostic: it is not kept.
    if found.is_empty() {
        return;
    }
    let file_name = tspath::get_normalized_absolute_path(operand, current_directory);
    files.push(SourceFile::new(file_name.into_boxed_slice(), source));
    diagnostics.extend(found);
}

/// What is found in one file: what the parser reports and, in a JavaScript file, what the rules report.
fn parse(file: FileId, loader: bun_ast::Loader, source: &bun_ast::Source) -> Vec<Diagnostic> {
    bun_ast::initialize_store();
    let _reset = bun_ast::StoreResetGuard::new();
    let arena = bun_alloc::Arena::new();
    let options = || {
        let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
        // A macro call stays a call: nothing is evaluated.
        options.features.no_macros = true;
        options.features.is_macro_runtime = true;
        options.features.top_level_await = true;
        options.features.standard_decorators = true;
        options
    };
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    log.level = bun_ast::Level::Warn;
    let parser = bun_js_parser::Parser::init(options(), &mut log, source, &define, &arena);
    let parsed = parser.and_then(|parser| match loader {
        // The rules read the statements as they were written: the visit pass of `Parser::parse` rewrites them.
        bun_ast::Loader::Js | bun_ast::Loader::Jsx => {
            parser.parse_only(|tree| bun_lint::lint(file, tree, source, &arena))
        }
        // `Parser::parse_only` is the parser without TypeScript: a TypeScript file gets the full parse and no rule.
        _ => parser.parse().map(|_| Vec::new()),
    });
    if matches!(parsed, Err(bun_js_parser::Error::StackOverflow)) {
        // `Parser::parse_only` only returns a stack overflow: `Parser::parse` logs it, at the place the lexer reached.
        log = bun_ast::Log::init();
        log.level = bun_ast::Level::Warn;
        let _ = bun_js_parser::Parser::init(options(), &mut log, source, &define, &arena)
            .and_then(|parser| parser.parse());
    }
    let reports = match parsed {
        Ok(reports) => reports,
        Err(err) => {
            if log.errors == 0 {
                log.add_range_error(Some(source), bun_ast::Range::None, err.name().as_bytes());
            }
            Vec::new()
        }
    };
    core::mem::take(&mut log.msgs)
        .into_iter()
        .filter_map(|msg| Diagnostic::from_msg(file, msg))
        .chain(reports)
        .collect()
}

/// Writes the diagnostics to stderr: a code frame for each on a terminal, else a line for each as tsc writes it.
fn write_diagnostics(files: &[SourceFile], diagnostics: &[Diagnostic], current_directory: &[u8]) {
    if diagnostics.is_empty() {
        return;
    }
    let format_opts = FormattingOptions {
        compare_paths_options: ComparePathsOptions {
            use_case_sensitive_file_names: tspath::USE_CASE_SENSITIVE_FILE_NAMES,
            current_directory,
        },
        new_line: b"\n",
    };
    let mut output: Vec<u8> = Vec::new();
    if Output::is_stderr_tty() {
        if Output::enable_ansi_colors_stderr() {
            write_code_frames::<true>(&mut output, files, diagnostics, &format_opts);
        } else {
            write_code_frames::<false>(&mut output, files, diagnostics, &format_opts);
        }
    } else {
        write_format_diagnostics(&mut output, files, diagnostics, &format_opts);
    }
    let _ = Output::error_writer_buffered().write_all(&output);
}
