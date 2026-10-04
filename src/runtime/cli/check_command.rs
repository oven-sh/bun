//! `bun check`: type checks a TypeScript project. `bun run --check` and `bun test --check` go through [`check_before`].
//! `bun build --check` and `Bun.build({ check: true })` run the check inside the bundle, when the bundler has read every
//! file ([`check_for_build_command`], [`check_for_bun_build`]).

use bstr::BStr;

use bun_clap as clap;
use bun_core::{Global, Output, ZStr, env_var};
use bun_sema_driver::format::{self, Layout, Style};
use bun_sema_driver::host::AlreadyRead;
use bun_sema_driver::{Category, CompilerOption, Diagnostic, FlagError, Progress, Report, Request};
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;

pub(crate) struct CheckCommand;

#[derive(Default)]
struct Options {
    project: Option<Vec<u8>>,
    paths: Vec<Vec<u8>>,
    threads: usize,
    /// `--pretty`, `--no-pretty`. If neither is given, it depends on the output destination.
    pretty: Option<bool>,
    /// `--all`: never group identical errors.
    all: bool,
    /// `--strict`, `--target es2022` and so on.
    compiler_options: Vec<CompilerOption>,
    /// `-b`, `--build`: the arguments name projects, as for `tsc -b`.
    build: bool,
    timing: bool,
}

fn usage_error(args: core::fmt::Arguments<'_>) -> ! {
    Output::err_generic("{}", (args,));
    bun_core::note!("run 'bun check --help' for more information");
    Global::exit(1);
}

/// A compiler option is not in the table: see `unknown_long_flags_are_positional`.
pub(crate) const PARAMS: &[clap::Param<clap::Help>] = &[
    clap::param!(
        "-p, --project/--tsconfig-override <path>  Path to a tsconfig.json or its directory"
    ),
    clap::param!(
        "--pretty <bool>?   Show source code around each error <d>(default in a terminal)<r>"
    ),
    clap::param!(
        "--no-pretty        One line per error, like <b>tsc --pretty false<r> <d>(default when piped)<r>"
    ),
    clap::param!(
        "--all              Show every error <d>(above 50, identical errors are grouped)<r>"
    ),
    clap::param!("--threads <n>      Number of threads <d>(default: one per CPU core)<r>"),
    clap::param!("--timing           Print load and check times"),
    clap::param!("--cwd <path>       Set the working directory"),
    clap::param!("-h, --help         Print this help menu"),
    // Nothing is ever emitted. `--noEmit` is a compiler option like any other, which the driver sets last.
    clap::param!("--no-emit"),
    clap::param!("-b, --build"),
    clap::param!("<POS>..."),
];
static TABLE: &clap::ConvertedTable = clap::comptime_table!(PARAMS, cold);

/// `args`: what follows `check`.
fn parse(args: &[&ZStr]) -> Options {
    let mut diagnostic = clap::Diagnostic::default();
    let parsed = clap::parse_with_table::<clap::Help>(
        TABLE,
        clap::ParseOptions {
            diagnostic: Some(&mut diagnostic),
            unknown_long_flags_are_positional: true,
            ..Default::default()
        },
    );
    let parsed = match parsed {
        Ok(parsed) => parsed,
        Err(err) => {
            let _ = diagnostic.report(Output::error_writer(), err);
            bun_core::note!("run 'bun check --help' for more information");
            Global::exit(1);
        }
    };
    if parsed.flag(b"--help") {
        crate::cli::command::tag_print_help(crate::cli::command::Tag::CheckCommand, true);
        Global::exit(0);
    }
    if let Some(cwd) = parsed.option(b"--cwd") {
        let path = bun_core::ZBox::from_bytes(cwd);
        if let bun_sys::Result::Err(err) = bun_sys::chdir(&path) {
            Output::err(
                err,
                "Could not change directory to \"{}\"",
                (BStr::new(cwd),),
            );
            Global::exit(1);
        }
    }
    let mut options = Options {
        project: parsed.option(b"--project").map(<[u8]>::to_vec),
        pretty: match parsed.option(b"--pretty") {
            _ if parsed.flag(b"--no-pretty") => Some(false),
            None => None,
            Some(b"" | b"true") => Some(true),
            Some(b"false") => Some(false),
            Some(value) => usage_error(format_args!(
                "--pretty does not take \"{}\"",
                BStr::new(value)
            )),
        },
        all: parsed.flag(b"--all"),
        build: parsed.flag(b"--build"),
        timing: parsed.flag(b"--timing"),
        ..Default::default()
    };
    if let Some(threads) = parsed.option(b"--threads") {
        match bun_core::fmt::parse_decimal::<usize>(threads) {
            Some(n) if n > 0 => options.threads = n,
            _ => usage_error(format_args!(
                "--threads takes a number above zero, not \"{}\"",
                BStr::new(threads)
            )),
        }
    }
    let positionals = parsed.positionals();
    let positionals = positionals
        .strip_prefix(&[b"check".as_slice()])
        .unwrap_or(positionals);
    // What follows `--` is a path, whatever it looks like.
    let after_dashes =
        (args.iter().position(|arg| arg.as_bytes() == b"--")).map_or(0, |at| args.len() - at - 1);
    let flags_end = positionals.len().saturating_sub(after_dashes);
    let mut rest = positionals.iter();
    while let Some(&arg) = rest.next() {
        let at = positionals.len() - rest.len() - 1;
        match arg.strip_prefix(b"--") {
            Some(flag) if at < flags_end => {
                let option = compiler_option(flag, &mut rest);
                options.compiler_options.push(option);
            }
            _ => options.paths.push(arg.to_vec()),
        }
    }
    if options.build {
        match (options.project.is_some(), options.paths.len()) {
            (_, 0) => {}
            (false, 1) => options.project = options.paths.pop(),
            _ => usage_error(format_args!("--build takes one project")),
        }
    }
    options
}

/// `flag` is what follows `--`: `strict`, `target` with the value in the next argument, or `target=es2022`.
fn compiler_option<'a>(
    flag: &'a [u8],
    rest: &mut core::slice::Iter<'_, &'a [u8]>,
) -> CompilerOption {
    let (name, mut value) = match bun_core::strings::index_of_char_usize(flag, b'=') {
        Some(at) => (&flag[..at], Some(&flag[at + 1..])),
        None => (flag, None),
    };
    if value.is_none() {
        let next = rest.as_slice().first().copied();
        let takes_next = match next {
            // `--strict false`, but not `--strict src/index.ts`.
            Some(next) if bun_sema_driver::is_boolean_compiler_option(name) => {
                next.eq_ignore_ascii_case(b"true") || next.eq_ignore_ascii_case(b"false")
            }
            Some(next) => !next.starts_with(b"-"),
            None => false,
        };
        if takes_next {
            rest.next();
            value = next;
        }
    }
    let option = bun_sema_driver::compiler_option_from_flag(name, value);
    let name = BStr::new(name);
    match option {
        Ok(option) => option,
        Err(FlagError::Unknown) => usage_error(format_args!("Unknown flag \"--{name}\"")),
        Err(FlagError::NeedsValue) => usage_error(format_args!("--{name} needs a value")),
        Err(FlagError::BadValue([])) => usage_error(format_args!(
            "--{name} does not take \"{}\"",
            BStr::new(value.unwrap_or_default())
        )),
        Err(FlagError::BadValue(allowed)) => usage_error(format_args!(
            "--{name} must be one of: {}",
            BStr::new(&allowed.join(&b", "[..]))
        )),
    }
}

fn working_directory() -> Vec<u8> {
    let mut buf = bun_paths::path_buffer_pool::get();
    match bun_core::getcwd(&mut buf) {
        Ok(cwd) => cwd.as_bytes().to_vec(),
        Err(err) => {
            Output::err(err, "Could not read the working directory", ());
            Global::exit(1);
        }
    }
}

/// The directory where `bun add -g` installs packages.
fn global_node_modules() -> Option<Vec<u8>> {
    use bun_install::package_manager_real::package_manager_options::global_dir_path;
    let install = bun_options_types::context::try_get().and_then(|ctx| ctx.install.as_deref());
    let explicit = install.and_then(|install| install.global_dir.as_deref());
    let mut buf = bun_paths::path_buffer_pool::get();
    let dir = global_dir_path(explicit.unwrap_or(b""), &mut buf.0)?;
    Some([dir, b"/node_modules"].concat())
}

/// Displays `progress` on stderr until `is_done`, starting once the check has run long enough for a
/// user to notice.
fn show_progress(progress: &Progress, is_done: &AtomicBool, style: &Style) {
    const BETWEEN: Duration = Duration::from_millis(80);
    // `Output`'s writers are per-thread state, and this thread is not from Bun's pool.
    Output::Source::configure_thread_no_js();
    let before_the_first = Duration::from_millis(
        env_var::BUN_DEBUG_TEST_CHECK_PROGRESS_DELAY_MS
            .get()
            .unwrap_or(300),
    );
    let began = std::time::Instant::now();
    let mut tick = 0;
    while !is_done.load(Ordering::Acquire) {
        if began.elapsed() >= before_the_first {
            let mut line = Vec::new();
            format::write_progress(&mut line, progress, style, tick);
            let _ = Output::error_writer().write_all(&line);
            Output::flush();
            tick += 1;
        }
        std::thread::park_timeout(BETWEEN);
    }
    if tick > 0 {
        let _ = Output::error_writer().write_all(format::ERASE_LINE);
        Output::flush();
    }
}

fn run(
    cwd: &[u8],
    project: Option<&[u8]>,
    paths: &[Vec<u8>],
    compiler_options: &[CompilerOption],
    threads: usize,
    already_read: AlreadyRead,
    then: impl FnOnce(Report) -> Report,
) -> Report {
    // Only for an interactive user.
    if !Output::is_stderr_tty() || Output::is_ai_agent() {
        return run_quietly(
            cwd,
            project,
            paths,
            compiler_options,
            threads,
            None,
            already_read,
            then,
        );
    }
    let (progress, is_done) = (Progress::default(), AtomicBool::new(false));
    let style = style_for(
        cwd,
        Some(true),
        bun_core::Fd::stderr(),
        true,
        Output::enable_ansi_colors_stderr(),
        false,
    );
    std::thread::scope(|scope| {
        let shown = scope.spawn(|| show_progress(&progress, &is_done, &style));
        let progress = Some(&progress);
        run_quietly(
            cwd,
            project,
            paths,
            compiler_options,
            threads,
            progress,
            already_read,
            |report| {
                is_done.store(true, Ordering::Release);
                shown.thread().unpark();
                // The progress line is cleared before anything else is printed.
                let _ = shown.join();
                then(report)
            },
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn run_quietly(
    cwd: &[u8],
    project: Option<&[u8]>,
    paths: &[Vec<u8>],
    compiler_options: &[CompilerOption],
    threads: usize,
    progress: Option<&Progress>,
    already_read: AlreadyRead,
    then: impl FnOnce(Report) -> Report,
) -> Report {
    let global = global_node_modules();
    let request = Request {
        cwd,
        project,
        paths,
        compiler_options,
        threads,
        lib_dir: None,
        global_node_modules: global.as_deref(),
        progress,
        only: None,
        order: 1,
        digests: false,
        plan_options: bun_sema_driver::PlanOptions::default(),
        retains_everything: false,
        stops_like_tsc: true,
        uses_typescript_wording: false,
        loaded: None,
        checked: None,
        after_file: None,
        declaration_file_emitted: None,
    };
    bun_sema_driver::check_already_read_then(&request, already_read, then)
}

/// A terminal user gets a source excerpt around each error, and so does an agent, in tags and
/// without colors, which saves it from opening the files. A pipe or continuous integration gets one
/// line per error.
fn style_for(
    cwd: &[u8],
    pretty: Option<bool>,
    to: bun_core::Fd,
    is_tty: bool,
    colors: bool,
    show_all: bool,
) -> Style<'_> {
    let layout = match pretty {
        Some(true) => Layout::Pretty,
        Some(false) => Layout::Plain,
        None if Output::is_ai_agent() => Layout::Agent,
        None if is_tty => Layout::Pretty,
        None => Layout::Plain,
    };
    Style {
        layout,
        color: layout == Layout::Pretty && colors,
        cwd,
        github_annotations: Output::is_github_action(),
        width: if is_tty {
            bun_core::output::File::from(to)
                .winsize()
                .map_or(0, |size| usize::from(size.col))
        } else {
            0
        },
        show_all,
    }
}

/// Whether `bun check --run-typescript-tests` exists, for `test/cli/check/conformance.test.ts`. A
/// release build has none of it.
const HAS_TYPESCRIPT_TEST_RUNNER: bool =
    bun_core::Environment::IS_CANARY || bun_core::Environment::IS_DEBUG;

impl CheckCommand {
    pub(crate) fn exec(args: &[&ZStr]) -> ! {
        if HAS_TYPESCRIPT_TEST_RUNNER
            && let [first, rest @ ..] = args
            && first.as_bytes() == b"--run-typescript-tests"
        {
            let rest: Vec<&[u8]> = rest.iter().map(|arg| arg.as_bytes()).collect();
            let passed = bun_sema_baselines::run_from_command_line(&rest);
            Global::exit(u32::from(!passed));
        }
        let options = parse(args);
        let cwd = working_directory();
        let report = run(
            &cwd,
            options.project.as_deref(),
            &options.paths,
            &options.compiler_options,
            options.threads,
            AlreadyRead::default(),
            // The process exits without freeing what was loaded. Under leak detection, everything
            // is freed first.
            |report| match bun_core::feature_flags::HELP_CATCH_MEMORY_ISSUES {
                true => report,
                false => report_and_exit(&report, &options, &cwd),
            },
        );
        report_and_exit(&report, &options, &cwd)
    }
}

/// Prints the report and exits the process.
fn report_and_exit(report: &Report, options: &Options, cwd: &[u8]) -> ! {
    let shown_from = bun_sema_driver::host::from_native(cwd);
    // The errors are the output, as with `tsc`. The summary is printed separately.
    let mut out = Vec::new();
    format::write_diagnostics(
        &mut out,
        report,
        &style_for(
            &shown_from,
            options.pretty,
            bun_core::Fd::stdout(),
            Output::is_stdout_tty(),
            Output::enable_ansi_colors_stdout(),
            options.all,
        ),
    );
    let _ = Output::writer().write_all(&out);
    let mut summary = Vec::new();
    format::write_summary(
        &mut summary,
        report,
        &Style {
            color: Output::enable_ansi_colors_stderr(),
            ..style_for(
                &shown_from,
                options.pretty,
                bun_core::Fd::stderr(),
                Output::is_stderr_tty(),
                true,
                options.all,
            )
        },
    );
    if options.timing {
        use std::io::Write;
        let _ = writeln!(
            summary,
            "  {} files loaded in {:.1}ms, {} checked in {:.1}ms, {} KB of stack at the most",
            report.files_loaded,
            report.load_time.as_secs_f64() * 1000.0,
            report.files_checked,
            report.check_time.as_secs_f64() * 1000.0,
            report.deepest_stack / 1024,
        );
    }
    let _ = Output::error_writer().write_all(&summary);
    Output::flush();
    Global::exit(u32::from(!report.is_ok()));
}

/// Type checks `entry_points` and everything they import before they are run. Reports the errors
/// on stderr, which leaves stdout to the program. Returns whether there are no errors.
pub(crate) fn check_before(entry_points: &[&[u8]]) -> bool {
    match what_to_check(&working_directory(), entry_points) {
        Some((paths, options)) => check_and_report(&paths, &options, AlreadyRead::default()),
        None => true,
    }
}

/// `sources` of `bun_bundler::options::TypeCheck`.
fn already_read(sources: &mut dyn Iterator<Item = (&[u8], &[u8])>) -> AlreadyRead {
    sources
        .map(|(path, text)| (bun_sema_driver::host::from_native(path), text.to_vec()))
        .collect()
}

/// `BundleOptions::type_check` for `bun build --check`. Like `check_before`, except that the files
/// of the bundle are not read again. Nothing has been written yet, so errors end the process.
pub(crate) fn check_for_build_command(
    cwd: &[u8],
    entry_points: &[Box<[u8]>],
    sources: &mut dyn Iterator<Item = (&[u8], &[u8])>,
    _log: &mut bun_ast::Log,
) -> bool {
    let entry_points: Vec<&[u8]> = entry_points.iter().map(|path| &**path).collect();
    if let Some((paths, options)) = what_to_check(cwd, &entry_points)
        && !check_and_report(&paths, &options, already_read(sources))
    {
        Global::exit(1);
    }
    true
}

/// `BundleOptions::type_check` for `Bun.build({ check: true })`. The errors are added to `log`,
/// which the build reports like its own. It runs on the thread of the bundler and prints nothing.
pub(crate) fn check_for_bun_build(
    cwd: &[u8],
    entry_points: &[Box<[u8]>],
    sources: &mut dyn Iterator<Item = (&[u8], &[u8])>,
    log: &mut bun_ast::Log,
) -> bool {
    let entry_points: Vec<&[u8]> = entry_points.iter().map(|path| &**path).collect();
    let Some((paths, options)) = what_to_check(cwd, &entry_points) else {
        return true;
    };
    let already_read = already_read(sources);
    let report = run_quietly(
        cwd,
        None,
        &paths,
        &options,
        0,
        None,
        already_read,
        |report| report,
    );
    for reported in &report.diagnostics {
        let kind = match reported.category {
            Category::Error => bun_ast::Kind::Err,
            Category::Warning => bun_ast::Kind::Warn,
            Category::Suggestion | Category::Message => continue,
        };
        match kind {
            bun_ast::Kind::Err => log.errors += 1,
            _ => log.warnings += 1,
        }
        log.add_msg(bun_ast::Msg {
            kind,
            data: log_data_of(reported),
            metadata: format::metadata_of(reported),
            notes: reported.related.iter().map(log_data_of).collect(),
            ..Default::default()
        });
    }
    for path in &report.incomplete {
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "ran out of stack in {}. This is a bug in Bun: errors in this file may be missing.",
                BStr::new(bun_sema_driver::host::to_native(path))
            ),
        );
    }
    report.is_ok()
}

/// `TS2322: Type 'string' is not assignable to type 'number'.`, where it is.
fn log_data_of(reported: &Diagnostic) -> bun_ast::Data {
    use std::borrow::Cow;
    let mut text = Vec::with_capacity(reported.text.len() + 8);
    if reported.code != 0 {
        use std::io::Write;
        let _ = write!(text, "TS{}: ", reported.code);
    }
    text.extend_from_slice(&reported.text);
    let line_text = || {
        let index = reported.line.checked_sub(reported.source_line)?;
        Some(Cow::Owned(reported.source.get(index as usize)?.clone()))
    };
    bun_ast::Data {
        text: Cow::Owned(text),
        location: (!reported.path.is_empty()).then(|| bun_ast::Location {
            file: Cow::Owned(bun_sema_driver::host::to_native(&reported.path).to_vec()),
            line_text: line_text(),
            length: (reported.end - reported.start) as usize,
            offset: reported.start as usize,
            line: reported.line as i32,
            column: reported.column as i32,
            ..Default::default()
        }),
    }
}

/// The files to name in the check of `entry_points`, which are relative to `cwd`, and the compiler
/// options that go with them. `None` if none of them has types to check.
fn what_to_check(
    cwd: &[u8],
    entry_points: &[&[u8]],
) -> Option<(Vec<Vec<u8>>, Vec<CompilerOption>)> {
    // An entry point that is neither TypeScript nor JavaScript has no types to check: `[eval]`, a
    // stylesheet, a page.
    use bun_ast::Loader;
    let loader_of = |path: &[u8]| Loader::from_string(bun_paths::extension(path));
    let is_checked = |path: &[u8]| loader_of(path).is_some_and(Loader::is_javascript_like);
    let mut paths: Vec<Vec<u8>> = Vec::new();
    for &entry_point in entry_points {
        if is_checked(entry_point) {
            paths.push(entry_point.to_vec());
        } else if entry_point.ends_with(b".html") {
            let scripts = imports_of_page(cwd, entry_point);
            paths.extend(scripts.into_iter().filter(|path| is_checked(path)));
        }
    }
    if paths.is_empty() {
        return None;
    }
    // A JavaScript entry point is loaded for its imports, regardless of `allowJs`. Its own errors
    // are reported only under `checkJs`.
    let allow_js: Vec<CompilerOption> = paths
        .iter()
        .any(|path| !loader_of(path).is_some_and(Loader::is_typescript))
        .then(|| bun_sema_driver::compiler_option_from_flag(b"allowJs", None).ok())
        .flatten()
        .into_iter()
        .collect();
    Some((paths, allow_js))
}

/// The absolute paths of the local files the HTML entry point `page` imports, from the bundler's HTML scanner. Empty if the page cannot
/// be read or parsed, which the bundler reports.
fn imports_of_page(cwd: &[u8], page: &[u8]) -> Vec<Vec<u8>> {
    use bun_paths::{platform::Auto, resolve_path};
    let page = resolve_path::join_abs_string::<Auto>(cwd, &[page]).to_vec();
    let Ok(contents) = bun_sys::File::read_from(bun_core::Fd::cwd(), &page) else {
        return Vec::new();
    };
    let source = bun_ast::Source::init_path_string(&page[..], &contents[..]);
    let mut log = bun_ast::Log::init();
    let records = bun_bundler::html_scanner::scan_import_records(&mut log, &source);
    let directory = resolve_path::dirname::<Auto>(&page);
    let is_url = |path: &[u8]| path.starts_with(b"//") || bun_core::strings::contains(path, b"://");
    (records.unwrap_or_default().iter())
        .map(|record| record.path.text())
        .filter(|path| !is_url(path))
        .map(|path| resolve_path::join_abs_string::<Auto>(directory, &[path]).to_vec())
        .collect()
}

/// Type checks the project that contains the working directory, as `bun check` does, before one of
/// its scripts is run.
pub(crate) fn check_project_before() -> bool {
    check_and_report(&[], &[], AlreadyRead::default())
}

fn check_and_report(
    paths: &[Vec<u8>],
    compiler_options: &[CompilerOption],
    already_read: AlreadyRead,
) -> bool {
    let cwd = working_directory();
    let report = run(
        &cwd,
        None,
        paths,
        compiler_options,
        0,
        already_read,
        |report| report,
    );
    if report.diagnostics.is_empty() && report.incomplete.is_empty() {
        return true;
    }
    let shown_from = bun_sema_driver::host::from_native(&cwd);
    let style = style_for(
        &shown_from,
        None,
        bun_core::Fd::stderr(),
        Output::is_stderr_tty(),
        Output::enable_ansi_colors_stderr(),
        false,
    );
    let mut out = Vec::new();
    format::write_diagnostics(&mut out, &report, &style);
    if !report.is_ok() {
        format::write_summary(&mut out, &report, &style);
    }
    let _ = Output::error_writer().write_all(&out);
    Output::flush();
    report.is_ok()
}
