//! Type-check probe: the planned `src/runtime/cli/lint_command.rs`, compiled with the arguments of the crate `bun_runtime`.
//! Differences from the plan: `ContextData::lint` does not exist yet, so `accept` takes `lint: &mut bool`; the items are `pub`.

use bstr::BStr;
use bun_clap as clap;
use bun_core::{Global, Output, ZStr, strings};
use bun_options_types::context::{Context, ContextData};
use bun_options_types::schema::api;

/// The extensions a lint run reads, in the order TypeScript lists them.
const SUPPORTED_EXTENSIONS: &str =
    "'.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'";

/// Reads the gate with the truthiness of `bun_core::env_var` feature flags.
fn is_enabled() -> bool {
    bun_core::getenv_z(bun_core::zstr!("BUN_FEATURE_FLAG_EXPERIMENTAL_LINT")).is_some_and(
        |value| {
            !strings::eql_any_case_insensitive_ascii(value, &[b"", b"0", b"false", b"no", b"off"])
        },
    )
}

/// `true` for `--lint` and `--lint=...`.
fn is_lint_token(token: &[u8]) -> bool {
    token == b"--lint" || token.starts_with(b"--lint=")
}

/// Says what `--lint` cannot be combined with and exits with 1.
#[cold]
#[inline(never)]
pub fn refuse(what: &str) -> ! {
    bun_core::err_generic!("--lint cannot be used with {}", what);
    Global::exit(1);
}

/// `--lint` was given to `bun` or `bun run`: exits with 1 unless a lint run may start, else fills `ctx` for it.
#[cold]
#[inline(never)]
pub fn accept(
    args: &clap::Args<clap::Help>,
    ctx: Context<'_>,
    cwd: Box<[u8]>,
    lint: &mut bool,
) -> api::TransformOptions {
    if bun_standalone_graph::Graph::get_ref().is_some() {
        bun_core::err_generic!("--lint cannot be used in a compiled executable");
        Global::exit(1);
    }
    let argv = bun_core::argv();
    for index in 1..=bun_core::bun_options_argc() {
        if argv
            .get(index)
            .is_some_and(|token| is_lint_token(token.as_bytes()))
        {
            bun_core::err_generic!("--lint cannot be set in BUN_OPTIONS");
            Global::exit(1);
        }
    }
    if !is_enabled() {
        bun_core::err_generic!(
            "--lint is experimental. Set the environment variable BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1 to enable it"
        );
        Global::exit(1);
    }
    if args.option(b"--eval").is_some() {
        refuse("--eval");
    }
    if args.option(b"--print").is_some() {
        refuse("--print");
    }
    if args.flag(b"--watch") {
        refuse("--watch");
    }
    if args.flag(b"--hot") {
        refuse("--hot");
    }
    if !args.options(b"--filter").is_empty() {
        refuse("--filter");
    }
    if args.flag(b"--parallel") {
        refuse("--parallel");
    }
    if args.flag(b"--sequential") {
        refuse("--sequential");
    }
    if args.flag(b"--workspaces") {
        refuse("--workspaces");
    }
    if args.flag(b"--interactive") {
        refuse("--interactive");
    }
    *lint = true;
    ctx.args.absolute_working_dir = Some(cwd);
    ctx.positionals = args
        .positionals()
        .iter()
        .map(|arg| Box::<[u8]>::from(*arg))
        .collect();
    ctx.passthrough = args
        .remaining()
        .iter()
        .map(|arg| Box::<[u8]>::from(*arg))
        .collect();
    ctx.args.clone()
}

/// `bunx` reads its own flags up to the package name: `--lint` among them is refused.
#[inline(never)]
pub fn refuse_in_bunx(argv: &[&'static ZStr]) {
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
        if token == b"--package" || token == b"-p" {
            let _ = tokens.next();
        }
    }
}

/// The value of `--compile-exec-argv` becomes arguments of the compiled program: `--lint` among them is refused.
#[inline(never)]
pub fn refuse_in_exec_argv(value: &[u8]) {
    if strings::tokenize_any(value, b" \t\n\r").any(is_lint_token) {
        bun_core::err_generic!("--lint cannot be set in --compile-exec-argv");
        Global::exit(1);
    }
}

/// `bun --lint <files>`: checks each operand, never runs one. Exits with 2 when a file has an error, else 0.
#[cold]
#[inline(never)]
pub fn exec(ctx: &mut ContextData) -> ! {
    let mut files: &[Box<[u8]>] = &ctx.positionals;
    if files.first().is_some_and(|first| &**first == b"run") {
        files = &files[1..];
    }
    let mut operands = files.iter().chain(ctx.passthrough.iter());
    let Some(first) = operands.next() else {
        bun_core::err_generic!("--lint needs one or more files");
        Global::exit(1);
    };
    if &**first == b"-" {
        refuse("a script from stdin");
    }
    for later in operands {
        if later.first() == Some(&b'-') {
            bun_core::err_generic!(
                "--lint cannot be used with \"{}\" after the first file",
                BStr::new(later)
            );
            Global::exit(1);
        }
    }
    let mut failed = false;
    let mut printed = false;
    for operand in files.iter().chain(ctx.passthrough.iter()) {
        failed |= check_file(operand, &mut printed);
    }
    Global::exit(if failed { 2 } else { 0 });
}

/// The loader of a file that a lint run reads, from its extension.
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

/// Declaration files are read and not parsed: the parser has no ambient top level.
fn is_declaration_file(operand: &[u8]) -> bool {
    operand.ends_with(b".d.ts") || operand.ends_with(b".d.mts") || operand.ends_with(b".d.cts")
}

/// Reads and parses one operand and prints what the log holds. `true`: the file has an error.
fn check_file(operand: &[u8], printed: &mut bool) -> bool {
    let separate = |printed: &mut bool| {
        if core::mem::replace(printed, true) {
            Output::print_error("\n");
        }
    };
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
    bun_ast::expr::data::Store::create();
    bun_ast::stmt::data::Store::create();
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
    let parsed = match bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) {
        Ok(parser) => parser.parse().map(drop),
        Err(err) => Err(err),
    };
    if let Err(err) = parsed {
        if log.errors == 0 {
            log.add_range_error(Some(&source), bun_ast::Range::None, err.name().as_bytes());
        }
    }
    if log.has_any() {
        separate(printed);
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    }
    log.errors > 0
}
