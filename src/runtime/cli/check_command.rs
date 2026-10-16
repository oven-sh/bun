//! `bun check`: type checks a TypeScript project. `bun run --check` and `bun test --check` go through [`check_before`].
//! `bun build --check` and `Bun.build({ check: true })` run the check inside the bundle, when the bundler has read every
//! file ([`check_for_build_command`], [`check_for_bun_build`]).

use bstr::BStr;

use bun_bundler::options::{DeclarationFiles, Declarations, SOUND_FILES_LEFT_OUT, SoundFile, SoundFilesRequest, TypeChecked, TypedOutputs, loaders_from_transform_options};
use bun_clap as clap;
use bun_core::{Global, Output, ZStr, env_var};
use bun_sema_driver::format::{self, Layout, Style};
use bun_sema_driver::host::{AlreadyRead, BeforeRead, Provided, ReadLater};
use bun_sema_driver::{
    Category, CommandLine, CompilerOption, Diagnostic, FlagError, Progress, RejectedFlag, Report,
    Request, ScriptKind,
};
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;

pub(crate) struct CheckCommand;

#[derive(Default)]
struct Options {
    /// The paths, `--project`, `--build`, `--strict`, `--target es2022` and so on.
    command_line: CommandLine,
    threads: usize,
    /// `--pretty`, `--no-pretty`. If neither is given, it depends on the output destination.
    pretty: Option<bool>,
    /// `--all`: never group identical errors.
    all: bool,
    timing: bool,
    aot: bool,
    aot_explain: Vec<Box<[u8]>>,
    aot_out: Option<Box<[u8]>>,
    without_builtin_modules: bool,
    logs_type_errors: bool,
}

fn usage_error(args: core::fmt::Arguments<'_>) -> ! {
    Output::err_generic("{}", (args,));
    bun_core::note!("run 'bun check --help' for more information");
    Global::exit(1);
}

const PROJECT: &[clap::Param<clap::Help>] = &[clap::param!(
    "-p, --project/--tsconfig-override <path>  Path to a tsconfig.json or its directory"
)];
/// For the help only. It is read like a compiler option.
const PRETTY: &[clap::Param<clap::Help>] = &[clap::param!(
    "--pretty <bool>?   Show source code around each error <d>(default in a terminal)<r>"
)];
const OTHERS: &[clap::Param<clap::Help>] = &[
    clap::param!(
        "-b, --build        Check the projects in <b>references<r> too, like <b>tsc -b<r>"
    ),
    clap::param!(
        "--no-pretty        One line per error, like <b>tsc --pretty false<r> <d>(default when piped)<r>"
    ),
    clap::param!(
        "--all              Show every error <d>(above 50, identical errors are grouped)<r>"
    ),
    clap::param!("--threads <n>      Number of threads <d>(default: one per CPU core)<r>"),
    clap::param!("--timing           Print load and check times"),
    clap::param!(
        "--aot              Also report what <b>bun build --compile --aot<r> would reject in these entry points"
    ),
    clap::param!("--aot-explain <word>...  With <b>--aot<r>: print a report. <b>throws<r> lists every type check that can fail when the program runs"),
    clap::param!("--cwd <path>       Set the working directory"),
    clap::param!("-h, --help         Print this help menu"),
    // Nothing is ever emitted. `--noEmit` is a compiler option like any other, which the driver sets last.
    clap::param!("--no-emit"),
    clap::param!("<POS>..."),
];
pub(crate) const PARAMS: &[clap::Param<clap::Help>] = clap::concat_params!(PROJECT, PRETTY, OTHERS);
/// A compiler option is not in the table: see `unknown_long_flags_are_positional`.
static TABLE: &clap::ConvertedTable =
    clap::comptime_table!(clap::concat_params!(PROJECT, OTHERS), cold);

/// Whether `--build` is among `args`, in any spelling that `clap` takes: by itself, or in a chain of
/// short flags, before the one that takes a value.
fn names_build(args: &[&ZStr]) -> bool {
    (args.iter().map(|arg| arg.as_bytes()))
        .take_while(|arg| *arg != b"--")
        .any(|arg| match arg {
            b"--build" => true,
            [b'-', shorts @ ..] if !shorts.starts_with(b"-") => (shorts.iter())
                .take_while(|short| **short != b'p')
                .any(|short| *short == b'b'),
            _ => false,
        })
}

/// `args`: what follows `check`.
fn parse(args: &[&ZStr]) -> Options {
    let mut diagnostic = clap::Diagnostic::default();
    let parsed = clap::parse_with_table::<clap::Help>(
        TABLE,
        clap::ParseOptions {
            diagnostic: Some(&mut diagnostic),
            short_aliases: bun_sema_driver::SHORT_OPTION_NAMES,
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
        // The copy is freed here: `exit` does not return, so nothing would free it afterwards.
        let changed = bun_sys::chdir(&bun_core::ZBox::from_bytes(cwd));
        if let bun_sys::Result::Err(err) = changed {
            Output::err(
                err,
                "Could not change directory to \"{}\"",
                (BStr::new(cwd),),
            );
            Global::exit(1);
        }
    }
    let mut options = Options {
        all: parsed.flag(b"--all"),
        timing: parsed.flag(b"--timing"),
        aot: parsed.flag(b"--aot"),
        aot_explain: parsed.options(b"--aot-explain").iter().map(|word| Box::<[u8]>::from(*word)).collect(),
        ..Default::default()
    };
    if let Some(word) = options.aot_explain.iter().find(|word| !bun_aot::Explain::default().set(word)) {
        usage_error(format_args!("--aot-explain does not take \"{}\": it is one of {}", BStr::new(word), bun_aot::Explain::REPORTS.join(", ")));
    }
    if !options.aot && !options.aot_explain.is_empty() {
        usage_error(format_args!("--aot-explain requires --aot"));
    }
    if let Some(threads) = parsed.option(b"--threads") {
        match bun_core::fmt::parse_decimal::<usize>(threads) {
            Some(n) if n > 0 => options.threads = n,
            _ => usage_error(format_args!(
                "--threads takes a number above zero, not \"{}\"",
                BStr::new(threads)
            )),
        }
    }
    // What precedes `check` is for `bun`, like what `BUN_OPTIONS` has. A flag there that is not
    // one of these is skipped, as every other command skips it.
    let positionals = parsed.positionals();
    let check = positionals.iter().position(|it| *it == b"check");
    let positionals = &positionals[check.map_or(0, |at| at + 1)..];
    // What follows `--` is a path, whatever it looks like.
    let after_dashes =
        (args.iter().position(|arg| arg.as_bytes() == b"--")).map_or(0, |at| args.len() - at - 1);
    let (flags, paths) = positionals.split_at(positionals.len().saturating_sub(after_dashes));
    let mut flags = flags.to_vec();
    if CAN_WRITE_THE_PROGRAM {
        flags.retain(|flag| {
            if let Some(path) = flag.strip_prefix(b"--aot-out=") {
                options.aot_out = Some(path.into());
            } else if *flag == b"--no-builtin-modules" {
                options.without_builtin_modules = true;
            } else if *flag == b"--aot-type-errors=log" {
                options.logs_type_errors = true;
            } else {
                return true;
            }
            false
        });
    }
    let mut command_line = bun_sema_driver::parse_command_line(&flags, &working_directory());
    if let Some(rejected) = command_line.rejected.first() {
        reject(rejected);
    }
    command_line
        .paths
        .extend(paths.iter().map(|path| path.to_vec()));
    if let Some(project) = parsed.option(b"--project") {
        command_line.project = Some(project.to_vec());
    }
    // Before `check`, `-b` is `--bun`.
    command_line.build |= parsed.flag(b"--build") && names_build(args);
    let projects = usize::from(command_line.project.is_some()) + command_line.paths.len();
    if command_line.build && projects > 1 {
        usage_error(format_args!("--build takes one project"));
    }
    options.pretty = match parsed.flag(b"--no-pretty") {
        true => Some(false),
        false => bun_sema_driver::tristate(&command_line.compiler_options, b"pretty"),
    };
    options.command_line = command_line;
    options
}

fn reject(rejected: &RejectedFlag) -> ! {
    let flag = BStr::new(&rejected.flag);
    match &rejected.error {
        FlagError::Unknown => usage_error(format_args!("Unknown flag \"{flag}\"")),
        FlagError::NeedsValue => usage_error(format_args!("{flag} needs a value")),
        FlagError::BadValue(allowed) if allowed.is_empty() => usage_error(format_args!(
            "{flag} does not take \"{}\"",
            BStr::new(rejected.value.as_deref().unwrap_or_default())
        )),
        FlagError::BadValue(allowed) => usage_error(format_args!(
            "{flag} must be one of: {}",
            BStr::new(&allowed.join(&b", "[..]))
        )),
    }
}

pub(crate) fn working_directory() -> Vec<u8> {
    let mut buf = bun_paths::path_buffer_pool::get();
    match bun_core::getcwd(&mut buf) {
        Ok(cwd) => cwd.as_bytes().to_vec(),
        Err(err) => {
            Output::err(err, "Could not read the working directory", ());
            Global::exit(1);
        }
    }
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

/// The paths that a check names.
#[derive(Clone, Copy)]
enum Paths<'a> {
    /// The arguments of `bun check`.
    Arguments(&'a CommandLine),
    /// See `Request::are_entry_points`.
    EntryPoints(Entries<'a>),
}

/// See the fields of `Request` by these names.
#[derive(Clone, Copy, Default)]
struct Entries<'a> {
    paths: &'a [Vec<u8>],
    script_kinds: &'a [(Vec<u8>, ScriptKind)],
    script_kinds_by_extension: &'a [(Vec<u8>, ScriptKind)],
    conditions: &'a [Box<[u8]>],
}

fn run(
    cwd: &[u8],
    project: Option<&[u8]>,
    paths: &Paths,
    compiler_options: &[CompilerOption],
    threads: usize,
    provided: Provided,
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
            provided,
            then,
        );
    }
    let (progress, is_done) = (Progress::default(), AtomicBool::new(false));
    let style = style_for(cwd, Some(true), Destination::stderr(), false);
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
            provided,
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

fn run_quietly(
    cwd: &[u8],
    project: Option<&[u8]>,
    paths: &Paths,
    compiler_options: &[CompilerOption],
    threads: usize,
    progress: Option<&Progress>,
    provided: Provided,
    then: impl FnOnce(Report) -> Report,
) -> Report {
    let request = request(cwd, project, paths, compiler_options, threads, progress);
    bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), then)
}

/// `provided`, with `Provided::scripts_of_page`.
fn with_pages(cwd: &[u8], provided: Provided) -> Provided {
    use bun_sema_driver::host::{from_native, to_native};
    // One thread at a time: the first sets up what the scanner reads.
    let (cwd, turn) = (cwd.to_vec(), bun_threading::Guarded::new(()));
    Provided {
        scripts_of_page: Some(Box::new(move |page| {
            let _turn = turn.lock();
            bun_sema_driver::asked::spoil();
            let scripts = imports_of_page(&cwd, to_native(page)).into_iter();
            let scripts = scripts.filter(|path| has_types(path));
            scripts.map(|path| from_native(&path)).collect()
        })),
        ..provided
    }
}

fn request<'a>(
    cwd: &'a [u8],
    project: Option<&'a [u8]>,
    paths: &Paths<'a>,
    compiler_options: &'a [CompilerOption],
    threads: usize,
    progress: Option<&'a Progress>,
) -> Request<'a> {
    let (entries, command_line) = match *paths {
        Paths::Arguments(command_line) => {
            let paths = Entries {
                paths: &command_line.paths,
                ..Default::default()
            };
            (paths, Some(command_line))
        }
        Paths::EntryPoints(entries) => (entries, None),
    };
    Request {
        cwd,
        project,
        listed_projects: None,
        build: command_line.is_some_and(|it| it.build),
        errors: command_line.map_or(&[][..], |it| &it.errors[..]),
        paths: entries.paths,
        are_entry_points: command_line.is_none(),
        is_one_program: false,
        code: &[],
        script_kinds: entries.script_kinds,
        script_kinds_by_extension: entries.script_kinds_by_extension,
        conditions: entries.conditions,
        compiler_options,
        threads,
        libs: bun_sema_driver::Libs::Bundled(super::typescript_libs::BUNDLED),
        progress,
        only: None,
        order: 1,
        digests: false,
        task_clock: None,
        plan_options: bun_sema_driver::PlanOptions::default(),
        retains_everything: false,
        stops_like_tsc: true,
        uses_typescript_wording: false,
        loaded: None,
        compile: None,
        checked: None,
        after_file: None,
        before_visits: None,
        all_visited_once: None,
        declaration_file_emitted: None,
    }
}

/// Where a report is printed.
#[derive(Copy, Clone)]
struct Destination {
    fd: bun_core::Fd,
    is_tty: bool,
    colors: bool,
}

impl Destination {
    fn stdout() -> Destination {
        Destination {
            fd: bun_core::Fd::stdout(),
            is_tty: Output::is_stdout_tty(),
            colors: Output::enable_ansi_colors_stdout(),
        }
    }

    fn stderr() -> Destination {
        Destination {
            fd: bun_core::Fd::stderr(),
            is_tty: Output::is_stderr_tty(),
            colors: Output::enable_ansi_colors_stderr(),
        }
    }
}

/// A terminal user gets a source excerpt around each error, and so does an agent, in tags and
/// without colors, which saves it from opening the files. A pipe or continuous integration gets one
/// line per error.
fn style_for(cwd: &[u8], pretty: Option<bool>, to: Destination, show_all: bool) -> Style<'_> {
    let layout = match pretty {
        Some(true) => Layout::Pretty,
        Some(false) => Layout::Plain,
        None if Output::is_ai_agent() => Layout::Agent,
        None if to.is_tty => Layout::Pretty,
        None => Layout::Plain,
    };
    Style {
        layout,
        color: layout == Layout::Pretty && to.colors,
        cwd,
        // Whoever prints a report has it from there.
        is_case_sensitive: true,
        github_annotations: Output::is_github_action(),
        width: if to.is_tty {
            bun_core::output::File::from(to.fd)
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

const CAN_WRITE_THE_PROGRAM: bool =
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
        Self::exec_with(&parse(args))
    }

    /// `bun --check` without an entry point: `bun check` without an argument. The arguments are
    /// those of `bun`, which has read them.
    pub(crate) fn exec_without_arguments() -> ! {
        Self::exec_with(&Options {
            command_line: CommandLine {
                project: tsconfig_override().map(<[u8]>::to_vec),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    fn exec_aot(options: &Options) -> ! {
        use bun_sema_driver::host::{from_argument, from_native};
        let (cwd, command_line) = (working_directory(), &options.command_line);
        if command_line.paths.is_empty() || command_line.build {
            usage_error(format_args!("--aot takes the entry points of a program"));
        }
        let constants = bun_aot::Constants { root: from_native(&cwd), logs_type_errors: options.logs_type_errors, ..Default::default() };
        let (mut code, mut provided) = (Vec::new(), Provided { without_builtin_modules: options.without_builtin_modules, ..Default::default() });
        for &(name, text) in bun_aot::prelude::FILES {
            let path = bun_aot::prelude::path_of(&cwd, name);
            provided.already_read.insert(from_native(&path), text.as_bytes().into());
            code.push(path);
        }
        let said: bun_threading::Guarded<(Vec<String>, Vec<String>)> = bun_threading::Guarded::new(Default::default());
        let translation = bun_aot::Translation::new(&constants).explaining(explaining(&options.aot_explain));
        let begin = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>| {
            let roots = command_line.paths.iter().filter_map(|path| program.files.by_path.get(&from_argument(&from_native(&cwd), path)));
            let entry_points: Vec<Vec<_>> = roots.map(|root| vec![root]).collect();
            translation.begin(program, &entry_points, in_parallel);
        };
        let translate_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| translation.translate_file(checker, file);
        let note_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| translation.note_file(checker, file);
        let merge_notes = |program: &bun_sema_driver::Program| translation.merge_notes(program);
        let analyze = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>, errors: &[(bun_sema_driver::FileId, u32)]| {
            let mut translated = translation.finish(program, in_parallel, errors);
            if let Some(path) = &options.aot_out
                && translated.problems.is_empty()
                && !translated.errors_that_stand.contains(&true)
            {
                let written = bun_aot::format::write_releasing(&mut translated.program, in_parallel);
                let _ = bun_sys::File::write_file(bun_sys::Fd::cwd(), &bun_core::ZBox::from_bytes(path), &written);
            }
            *said.lock() = (translated.explained, translated.problems);
            bun_aot::release(translated.program, in_parallel);
            translated.errors_that_stand
        };
        let paths = Paths::EntryPoints(Entries { paths: &command_line.paths, ..Default::default() });
        let request = Request {
            is_one_program: true,
            code: &code,
            loaded: Some(&begin),
            after_file: Some(&translate_file),
            before_visits: Some(&note_file),
            all_visited_once: Some(&merge_notes),
            compile: Some(&analyze),
            ..request(&cwd, command_line.project.as_deref(), &paths, &command_line.compiler_options, options.threads, None)
        };
        let report = bun_sema_driver::check_provided_then(&request, with_pages(&cwd, provided), |report| report);
        let said = said.lock();
        print_explained(&said.0);
        for problem in &said.1 {
            Output::err_generic("{}", (problem,));
        }
        if report.is_ok() && !said.1.is_empty() {
            Global::exit(1);
        }
        report_and_exit(&report, options, &cwd)
    }

    fn exec_with(options: &Options) -> ! {
        if options.aot {
            Self::exec_aot(options);
        }
        let (cwd, command_line) = (working_directory(), &options.command_line);
        let report = run(
            &cwd,
            command_line.project.as_deref(),
            &Paths::Arguments(command_line),
            &command_line.compiler_options,
            options.threads,
            Provided::default(),
            // The process exits without freeing what was loaded. Under leak detection, everything
            // is freed first.
            |report| match bun_core::feature_flags::HELP_CATCH_MEMORY_ISSUES {
                true => report,
                false => report_and_exit(&report, options, &cwd),
            },
        );
        report_and_exit(&report, options, &cwd)
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
        &Style {
            is_case_sensitive: report.is_case_sensitive,
            ..style_for(
                &shown_from,
                options.pretty,
                Destination::stdout(),
                options.all,
            )
        },
    );
    let _ = Output::writer().write_all(&out);
    let mut summary = Vec::new();
    format::write_summary(
        &mut summary,
        report,
        &Style {
            color: Output::enable_ansi_colors_stderr(),
            is_case_sensitive: report.is_case_sensitive,
            ..style_for(
                &shown_from,
                options.pretty,
                Destination::stderr(),
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
        if report.files_parsed_for_all > 0 {
            let _ = writeln!(
                summary,
                "  {} files parsed for all projects",
                report.files_parsed_for_all,
            );
        }
    }
    let _ = Output::error_writer().write_all(&summary);
    Output::flush();
    Global::exit(u32::from(!report.is_ok()));
}

/// What is run.
#[derive(Clone, Copy)]
pub(crate) struct EntryPoint<'a> {
    pub(crate) path: &'a [u8],
    /// What it is loaded with. `None`: what its name says.
    pub(crate) loader: Option<bun_ast::Loader>,
    /// It is not in a file: `-e`, or what is read from stdin.
    pub(crate) text: Option<&'a [u8]>,
}

impl<'a> EntryPoint<'a> {
    pub(crate) fn file(path: &'a [u8]) -> EntryPoint<'a> {
        EntryPoint {
            path,
            loader: None,
            text: None,
        }
    }
}

/// Type checks `entry_points` and everything they import before they are run. Returns whether they
/// have no errors. Reports the errors on stderr, which leaves stdout to the program.
pub(crate) fn check_before(entry_points: &[EntryPoint], before_read: Option<BeforeRead>) -> bool {
    let cwd = working_directory();
    // `--loader`, `--conditions`
    let args = bun_options_types::context::try_get().map(|ctx| &ctx.args);
    let loaders = args.and_then(|args| args.loaders.as_ref());
    let loaders = loaders_from_transform_options(loaders, bun_ast::Target::Bun);
    let by_extension = script_kinds_by_extension(&loaders.unwrap_or_default());
    let Some((paths, script_kinds)) = what_to_check(&cwd, entry_points, &by_extension) else {
        return true;
    };
    let mut in_memory = (entry_points.iter()).filter_map(|it| Some((it.path, it.text?)));
    let provided = Provided {
        already_read: already_read(&cwd, &mut in_memory),
        before_read,
        ..Default::default()
    };
    let entries = Entries {
        paths: &paths,
        script_kinds: &script_kinds,
        script_kinds_by_extension: &by_extension,
        conditions: args.map_or(&[][..], |args| &args.conditions[..]),
    };
    check_and_report(&Paths::EntryPoints(entries), provided)
}

fn script_kind_of(loader: bun_ast::Loader) -> Option<ScriptKind> {
    use bun_ast::Loader;
    Some(match loader {
        Loader::Js => ScriptKind::Js,
        Loader::Jsx => ScriptKind::Jsx,
        Loader::Ts => ScriptKind::Ts,
        Loader::Tsx => ScriptKind::Tsx,
        _ => return None,
    })
}

/// `Request::script_kinds_by_extension`: the extensions that `loaders`, which has those that Bun
/// knows too, loads as another language than TypeScript takes them for.
fn script_kinds_by_extension(loaders: &bun_ast::LoaderHashTable) -> Vec<(Vec<u8>, ScriptKind)> {
    (loaders.iter())
        .filter_map(|(extension, &loader)| Some((extension, script_kind_of(loader)?)))
        .filter(|(extension, script_kind)| script_kind.differs_from_name(extension))
        .map(|(extension, script_kind)| (extension.to_vec(), script_kind))
        .collect()
}

/// `has_types`, or `by_extension` says so.
fn has_types_with(by_extension: &[(Vec<u8>, ScriptKind)], path: &[u8]) -> bool {
    let extension = bun_paths::extension(path);
    has_types(path) || by_extension.iter().any(|it| it.0 == extension)
}

/// `before_read` of `check_before` under `--watch`. The file watcher of `vm` knows a file before the
/// check reads it, so a change during the check starts the process again, like a change after it.
/// That is every file outside `node_modules`: some only have types, some are configuration files.
/// `None` without a file watcher.
pub(crate) fn watching(vm: &bun_jsc::virtual_machine::VirtualMachine) -> Option<BeforeRead> {
    use bun_paths::{platform::Auto, resolve_path::join_abs_string};
    use bun_sema_driver::host::to_native;
    let (watch, cwd) = (vm.watcher_for_threads()?, working_directory());
    Some(Box::new(move |path| {
        if !bun_core::strings::contains(path, b"/node_modules/") {
            // The watcher knows a file by its path as the system spells it.
            watch(join_abs_string::<Auto>(&cwd, &[to_native(path)]));
        }
    }))
}

/// `sources` of `bun_bundler::options::TypeCheck`. A key of `files` of `Bun.build` may be relative,
/// and its value may start with a byte order mark.
fn already_read(cwd: &[u8], sources: &mut dyn Iterator<Item = (&[u8], &[u8])>) -> AlreadyRead {
    use bun_core::strings::without_utf8_bom;
    use bun_paths::{platform::Auto, resolve_path::join_abs_string};
    sources
        .map(|(path, text)| {
            let path = join_abs_string::<Auto>(cwd, &[path]);
            let text = without_utf8_bom(text).to_vec();
            (bun_sema_driver::host::from_native(path), text.into())
        })
        .collect()
}

/// The same without a copy of the texts.
///
/// # Safety
/// The texts stay where they are, unchanged, for as long as the map, or anything that was read from it, is used.
unsafe fn already_read_in_place(cwd: &[u8], sources: &mut dyn Iterator<Item = (&[u8], &[u8])>) -> AlreadyRead {
    use bun_core::strings::without_utf8_bom;
    use bun_paths::{platform::Auto, resolve_path::join_abs_string};
    sources
        .map(|(path, text)| {
            let path = join_abs_string::<Auto>(cwd, &[path]);
            // SAFETY: the caller's.
            let text: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(without_utf8_bom(text)) };
            (bun_sema_driver::host::from_native(path), text.into())
        })
        .collect()
}

/// `BundleOptions::type_check` for `bun build --check`.
pub(crate) fn check_for_build_command(checked: TypeChecked, log: &mut bun_ast::Log) -> bool {
    check_for_build(checked, log, true)
}

/// `BundleOptions::type_check` for `Bun.build({ check: true })`. It prints nothing.
pub(crate) fn check_for_bun_build(checked: TypeChecked, log: &mut bun_ast::Log) -> bool {
    check_for_build(checked, log, false)
}

struct Handed<T>(T);
// SAFETY: this thread waits for the other one, so what is handed over is used by one thread at a time.
unsafe impl<T> Send for Handed<T> {}
impl<T> Handed<T> {
    fn take(self) -> T {
        self.0
    }
}

struct EarlyAnalysis {
    request_sender: std::sync::mpsc::Sender<Handed<(TypeChecked<'static, 'static>, &'static mut bun_ast::Log)>>,
    result_receiver: std::sync::mpsc::Receiver<Handed<Option<bun_ast::type_tags::ProgramFacts>>>,
    is_cancelled: std::sync::Arc<AtomicBool>,
}

impl Drop for EarlyAnalysis {
    fn drop(&mut self) {
        self.is_cancelled.store(true, Ordering::Relaxed);
    }
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_runtime_start_early_analysis(
    cwd: &[u8],
    tsconfig: Option<&[u8]>,
    conditions: &[Box<[u8]>],
    loaders: &bun_ast::LoaderHashTable,
    entry_points: &[&[u8]],
) -> (bun_bundler::options::EarlyAnalysis, std::sync::mpsc::Sender<Vec<u8>>) {
    let (cwd, tsconfig, conditions) = (cwd.to_vec(), tsconfig.map(<[u8]>::to_vec), conditions.to_vec());
    let by_extension = script_kinds_by_extension(loaders);
    let paths: Vec<Vec<u8>> = entry_points.iter().filter(|path| has_types_with(&by_extension, path)).map(|path| path.to_vec()).collect();
    let (request_sender, request_receiver) = std::sync::mpsc::channel::<Handed<(TypeChecked<'static, 'static>, &'static mut bun_ast::Log)>>();
    let (result_sender, result_receiver) = std::sync::mpsc::channel();
    let (path_sender, path_receiver) = std::sync::mpsc::channel::<Vec<u8>>();
    let is_cancelled = std::sync::Arc::new(AtomicBool::new(false));
    let early_parse_cancelled = Some(std::sync::Arc::clone(&is_cancelled));
    let early_scan_cancelled = Some(std::sync::Arc::clone(&is_cancelled));
    std::thread::Builder::new()
        .stack_size(64 << 20)
        .spawn(move || {
            bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Analyze"));
            bun_sema_driver::with_early_run(|run| {
                std::thread::scope(|scope| {
                    let parse_early = || {
                        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Analyze"));
                        let entries = Paths::EntryPoints(Entries {
                            paths: &paths,
                            script_kinds: &[],
                            script_kinds_by_extension: &by_extension,
                            conditions: &conditions,
                        });
                        let request = Request {
                            is_one_program: true,
                            plan_options: bun_sema_driver::PlanOptions { early_run: Some(run), early_parse_only: true, ..Default::default() },
                            ..request(&cwd, tsconfig.as_deref(), &entries, &[], 0, None)
                        };
                        bun_sema_driver::check_provided_then(&request, with_pages(&cwd, Provided { early_paths: Some(path_receiver), early_parse_cancelled, without_builtin_modules: true, ..Default::default() }), |_| ());
                    };
                    let early_parse = (!paths.is_empty()).then(|| {
                        (std::thread::Builder::new().stack_size(64 << 20))
                            .spawn_scoped(scope, parse_early)
                            .expect("failed to spawn the early parse thread")
                    });
                    if !paths.is_empty() {
                        let entries = Paths::EntryPoints(Entries {
                            paths: &paths,
                            script_kinds: &[],
                            script_kinds_by_extension: &by_extension,
                            conditions: &conditions,
                        });
                        let request = Request {
                            is_one_program: true,
                            plan_options: bun_sema_driver::PlanOptions { early_run: Some(run), early_scan_only: true, ..Default::default() },
                            ..request(&cwd, tsconfig.as_deref(), &entries, &[], 0, None)
                        };
                        bun_sema_driver::check_provided_then(&request, with_pages(&cwd, Provided { early_parse_cancelled: early_scan_cancelled, without_builtin_modules: true, ..Default::default() }), |_| ());
                    }
                    if let Ok(handed) = request_receiver.recv() {
                        let (checked, log) = handed.take();
                        let early_parse = std::cell::Cell::new(early_parse);
                        let wait_for_early_parse = || {
                            if let Some(early_parse) = early_parse.take() {
                                let _ = early_parse.join();
                            }
                        };
                        let found = analyze_on_this_thread(checked, log, Some((run, &wait_for_early_parse)));
                        bun_core::Output::flush();
                        let _ = result_sender.send(Handed(found));
                    }
                });
            });
        })
        .expect("failed to spawn the analysis thread");
    (Box::new(EarlyAnalysis { request_sender, result_receiver, is_cancelled }), path_sender)
}

/// `BundleOptions::analyze` for `bun build --compile --aot`: the entry points are checked as `bun check` checks them, and the bundle is
/// compiled by the types of that program. What is an error there, in code that is in the program, is an error of the build, and nothing
/// is compiled: see `bun_aot::Translation::finish`. The checker
/// resolves every import itself, for its types. What the bundler has resolved it to is the code, which only the compiler is told. It
/// is the check of `--check` too, which the bundler does not run besides.
pub(crate) fn analyze_for_build(
    mut checked: TypeChecked,
    log: &mut bun_ast::Log,
) -> Option<bun_ast::type_tags::ProgramFacts> {
    if let Some(early) = checked.early_analysis.take().and_then(|early| early.downcast::<EarlyAnalysis>().ok()) {
        // SAFETY: only the lifetimes change. This function returns after the analysis thread has answered, and that thread answers
        // after `analyze_on_this_thread` has consumed `checked` and made its last use of `log`.
        let handed = unsafe { core::mem::transmute::<(TypeChecked<'_, '_>, &mut bun_ast::Log), (TypeChecked<'static, 'static>, &'static mut bun_ast::Log)>((checked, log)) };
        early.is_cancelled.store(true, Ordering::Relaxed);
        early.request_sender.send(Handed(handed)).ok().expect("the analysis thread exited early");
        return early.result_receiver.recv().expect("the analysis thread exited without a result").take();
    }
    // `Bun.build` bundles on a thread of its own, which has less stack than a task of the checker asks for.
    if bun_core::StackCheck::init().remaining() >= 8 << 20 {
        return analyze_on_this_thread(checked, log, None);
    }
    let handed = Handed((checked, log));
    let analyzed = std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(64 << 20)
            .spawn_scoped(scope, move || {
                bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Analyze"));
                let (checked, log) = handed.take();
                let found = analyze_on_this_thread(checked, log, None);
                bun_core::Output::flush();
                Handed(found)
            })
            .expect("a thread for the analysis")
            .join()
    });
    match analyzed {
        Ok(found) => found.take(),
        Err(panic) => std::panic::resume_unwind(panic),
    }
}

fn analyze_on_this_thread(
    checked: TypeChecked,
    log: &mut bun_ast::Log,
    early: Option<(bun_sema_driver::EarlyRun, &dyn Fn())>,
) -> Option<bun_ast::type_tags::ProgramFacts> {
    use bun_sema_driver::host::from_native;
    let TypeChecked {
        cwd,
        tsconfig,
        conditions,
        loaders,
        entry_points,
        own_entry_points,
        sources,
        imports,
        dropped_imports,
        without_side_effects,
        lifted_commonjs,
        kinds,
        statements,
        texts,
        assets,
        has_late_strings,
        defines,
        features,
        rewrite_jest_for_tests,
        ignore_dce_annotations,
        jsx_side_effects,
        minify_syntax,
        shortens_names,
        preserve_source_paths,
        react_compiler_outputs,
        jsx,
        classes,
        function_texts,
        printing_of_function_texts,
        explain,
        explains_into_log,
        logs_type_errors,
        early_analysis: _,
        release_asts,
    } = checked;
    let file_url = |path: &[u8]| {
        let (path, query) = path.split_at(bun_core::strings::index_of_char_usize(path, b'?').unwrap_or(path.len()));
        let mut url = format!("{}", bun_url::file_url_from_string(&bun_core::String::from_bytes(path))).into_bytes();
        url.extend_from_slice(query);
        url
    };
    let by_extension = script_kinds_by_extension(loaders);
    let mut script_kinds: Vec<(Vec<u8>, ScriptKind)> = Vec::new();
    // `Request::code`
    let mut code: Vec<Vec<u8>> = Vec::new();
    let mut sources = sources.map(|(path, text, loader)| {
        let script_kind = script_kind_of(loader).filter(|it| it.differs_from_name(path));
        script_kinds.extend(script_kind.map(|it| (path.to_vec(), it)));
        code.push(path.to_vec());
        (path, text)
    });
    let (imports, statements) = (Handed(imports), Handed(statements));
    let (resolved, statements_by_file, texts_already_read) = std::thread::scope(|scope| {
        let resolved = scope.spawn(move || {
            let imports = imports.take();
            let mut resolved = bun_aot::ResolvedImports::default();
            let mut numbers: bun_sema_driver::FxHashMap<(*const u8, usize), u32> = Default::default();
            for (from, specifier, to) in imports {
                let [from, to] = [from, to].map(|path| *numbers.entry((path.as_ptr(), path.len())).or_insert_with(|| resolved.number_of(&from_native(path))));
                resolved.insert(from, specifier, to);
            }
            resolved
        });
        let statements_by_file = scope.spawn(move || {
            let statements = statements.take();
            let mut statements_by_file: bun_sema_driver::FxHashMap<Vec<u8>, Vec<(u32, bool)>> = Default::default();
            let mut statements_of_file: Option<(&[u8], Vec<(u32, bool)>)> = None;
            for (path, start, verdict) in statements {
                match &mut statements_of_file {
                    Some((known, list)) if core::ptr::eq(*known, path) => list.push((start, verdict)),
                    _ => {
                        if let Some((known, mut list)) = statements_of_file.replace((path, vec![(start, verdict)])) {
                            statements_by_file.entry(from_native(known)).or_default().append(&mut list);
                        }
                    }
                }
            }
            if let Some((known, mut list)) = statements_of_file {
                statements_by_file.entry(from_native(known)).or_default().append(&mut list);
            }
            statements_by_file
        });
        // SAFETY: they are the bundler's, which waits for this function to return. The host that gets the map, the programs that read
        // from it and the report all end in this function.
        let texts_already_read = unsafe { already_read_in_place(cwd, &mut sources) };
        let resolved = resolved.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic));
        let statements_by_file = statements_by_file.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic));
        (resolved, statements_by_file, texts_already_read)
    });
    let mut constants = bun_aot::Constants {
        logs_type_errors,
        notes_spans: false,
        has_preloads: false,
        own_paths: preserve_source_paths.then_some(file_url as fn(&[u8]) -> Vec<u8>),
        has_test_globals: rewrite_jest_for_tests,
        ignores_dce_annotations: ignore_dce_annotations,
        jsx_has_side_effects: jsx_side_effects,
        minifies_syntax: minify_syntax || preserve_source_paths,
        shortens_names,
        root: from_native(cwd),
        defines: defines.iter().map(|(name, value)| (name.to_vec(), value.to_vec())).collect(),
        features: features.map(<[u8]>::to_vec).collect(),
        resolved: Some(resolved),
        dropped_imports: dropped_imports.map(|(from, spec)| (from_native(from), spec.to_vec())).collect(),
        without_side_effects: without_side_effects.map(from_native).collect(),
        lifted_commonjs: lifted_commonjs.map(from_native).collect(),
        statements: statements_by_file,
        texts: texts.map(|(path, text)| (from_native(path), text.to_vec())).collect(),
        assets: assets.map(|(path, key)| (from_native(path), key.to_vec())).collect(),
        function_texts: function_texts.map(|later| -> Box<dyn Fn() -> bun_aot::FunctionTexts + Send + Sync> {
            let later = bun_threading::Guarded::new(later);
            Box::new(move || {
                let later = later.lock();
                let texts: bun_aot::FunctionTexts = ((0..later.number_of_lists).filter_map(|_| later.printed.recv().ok()).flatten())
                    .map(|(path, printed, ranges)| (from_native(&path), (printed.into_vec(), ranges.iter().map(|it| (it.key as u32, it.start as u32, it.end as u32)).collect())))
                    .collect();
                texts
            })
        }),
    };
    let kinds_of_code = kinds.map(|(path, is_commonjs)| (path.to_vec(), is_commonjs)).collect();
    release_asts();
    let mut provided = Provided {
        already_read: texts_already_read,
        jsx_of_files: (jsx.map(|(path, of_file)| {
            let of_file = bun_sema_driver::host::JsxOfFile {
                is_classic: of_file.is_classic,
                factory: of_file.factory.to_vec(),
                fragment: of_file.fragment.to_vec(),
                import_source: of_file.import_source.to_vec(),
            };
            (path.to_vec(), of_file)
        }))
        .collect(),
        classes_of_files: (classes.map(|(path, of_file)| {
            let of_file = bun_sema_driver::host::ClassOptions {
                use_define_for_class_fields: of_file.use_define_for_class_fields,
                experimental_decorators: of_file.experimental_decorators,
                emit_decorator_metadata: of_file.emit_decorator_metadata,
            };
            (path.to_vec(), of_file)
        }))
        .collect(),
        is_run_from_its_sources: preserve_source_paths,
        kinds_of_code,
        ..Default::default()
    };
    provided.build_constants = Some(constants.build_constants());
    if let Some(resolved) = &constants.resolved {
        let is_constant: Vec<bool> = resolved.paths().iter().map(|to| to.ends_with(b".text.json") || to.ends_with(b".file.json")).collect();
        provided.constants_of_imports = (resolved.by_number())
            .filter(|import| is_constant[import.2 as usize])
            .map(|(from, specifier, to)| ((resolved.path(from).to_vec(), specifier.to_vec()), resolved.path(to).to_vec()))
            .collect();
    }
    for &(name, text) in bun_aot::prelude::FILES {
        let path = bun_aot::prelude::path_of(cwd, name);
        provided.already_read.insert(from_native(&path), text.as_bytes().into());
        code.push(path);
    }
    let is_source = |path: &&[u8]| {
        has_types_with(&by_extension, path) || script_kinds.iter().any(|it| it.0 == **path)
    };
    let mut paths: Vec<Vec<u8>> = (entry_points.filter(is_source))
        .map(<[u8]>::to_vec)
        .collect();
    if paths.is_empty() {
        return None;
    }
    if rewrite_jest_for_tests {
        let path = bun_aot::prelude::path_of(cwd, "test-globals.d.ts");
        provided.already_read.insert(from_native(&path), declarations_of_the_test_runner().into());
        paths.push(path);
    }
    // `TypeChecked::react_compiler_outputs`: the code is under a path of its own. What is written is no code any more, so no root by that: it is
    // checked in its own right.
    let mut code_of: bun_sema_driver::FxHashMap<Vec<u8>, Vec<u8>> = Default::default();
    let mut places_in_code: bun_sema_driver::FxHashMap<Vec<u8>, Vec<usize>> = Default::default();
    for (place, known) in code.iter().enumerate() {
        places_in_code.entry(known.clone()).or_default().push(place);
    }
    let mut known_paths: bun_sema_driver::FxHashSet<Vec<u8>> = paths.iter().cloned().collect();
    let bun_bundler::options::ReactCompilerOutputsLater { printed, paths: lowered } = react_compiler_outputs;
    let mut printed_as: Vec<Vec<u8>> = Vec::with_capacity(lowered.len());
    for path in lowered {
        let elsewhere = [path, b".js"].concat();
        provided.already_read.insert(from_native(&elsewhere), std::borrow::Cow::Borrowed(&[]));
        printed_as.push(from_native(&elsewhere));
        if let Some(places) = places_in_code.remove(path) {
            for &place in &places {
                code[place].clone_from(&elsewhere);
            }
            places_in_code.entry(elsewhere.clone()).or_default().extend(places);
        }
        if known_paths.insert(path.to_vec()) {
            paths.push(path.to_vec());
        }
        code_of.insert(from_native(path), from_native(&elsewhere));
    }
    if let Some(resolved) = &mut constants.resolved {
        let written: Vec<Vec<u8>> = resolved.paths().to_vec();
        let elsewhere: Vec<Option<u32>> = written.iter().map(|path| code_of.get(path).map(|elsewhere| resolved.number_of(elsewhere))).collect();
        let own: Vec<(u32, Vec<u8>, u32)> = (resolved.by_number())
            .filter_map(|(from, specifier, to)| Some((elsewhere[from as usize]?, specifier.to_vec(), to)))
            .collect();
        for (from, specifier, to) in own {
            resolved.insert(from, &specifier, to);
        }
        resolved.retarget(&elsewhere);
    }
    let not_printed: std::sync::Arc<bun_threading::Guarded<Vec<Vec<u8>>>> = Default::default();
    let read_later: Option<ReadLater> = (!printed_as.is_empty()).then(|| -> ReadLater {
        let not_printed = std::sync::Arc::clone(&not_printed);
        Box::new(move || {
            let mut texts = AlreadyRead::default();
            for _ in 0..printed_as.len() {
                if let Ok((number, Some(javascript))) = printed.recv() {
                    texts.insert(std::mem::take(&mut printed_as[number]), javascript.into_vec().into());
                }
            }
            not_printed.lock().extend(printed_as.into_iter().filter(|path| !path.is_empty()));
            texts
        })
    });
    match read_later {
        Some(wait) if bun_core::env_var::BUN_AOT_TYPED_SNAPSHOT.get().is_some() => provided.already_read.extend(wait()),
        read_later => provided.read_later = read_later,
    }
    // What one entry function runs: an entry point of the bundle, then what `bun:main` does once that has run.
    let mut entry_functions: Vec<[Vec<u8>; 2]> = Vec::new();
    let mut names_of_entry_functions: Vec<Vec<u8>> = Vec::new();
    for entry_point in own_entry_points.filter(|path| paths.iter().any(|it| it == path)) {
        let name = match entry_functions.len() {
            0 => "main.js".to_owned(),
            number => format!("main.{number}.js"),
        };
        let main = bun_aot::prelude::path_of(cwd, &name);
        let mut wrapper = bun_bundler::entry_points::ServerEntryPoint::default();
        bun_bundler::entry_points::ServerEntryPoint::generate(&mut wrapper, false, entry_point).ok()?;
        provided.already_read.insert(from_native(&main), wrapper.contents.into_vec().into());
        code.push(main.clone());
        if let Some(resolved) = &mut constants.resolved {
            let to = from_native(entry_point);
            let to = code_of.get(&to).cloned().unwrap_or(to);
            let [from, to] = [from_native(&main), to].map(|path| resolved.number_of(&path));
            resolved.insert(from, entry_point, to);
        }
        let is_replaced = code_of.contains_key(&from_native(entry_point));
        let root = if is_replaced { [entry_point, b".js"].concat() } else { entry_point.to_vec() };
        entry_functions.push([root, main]);
        names_of_entry_functions.push(entry_point.to_vec());
    }
    if entry_functions.is_empty() {
        return None;
    }
    if let Some(path) = bun_core::env_var::BUN_AOT_TYPED_SNAPSHOT.get() {
        let snapshot = bun_sema_driver::snapshot::Snapshot {
            cwd: cwd.to_vec(),
            tsconfig: tsconfig.map(<[u8]>::to_vec),
            conditions: conditions.to_vec(),
            entry_points: paths.clone(),
            code: code.clone(),
            script_kinds: script_kinds.clone(),
            script_kinds_by_extension: by_extension.clone(),
            already_read: provided.already_read.clone(),
            resolved: constants.resolved.iter().flat_map(|resolved| resolved.iter()).map(|(from, specifier, to)| ((from.to_vec(), specifier.to_vec()), to.to_vec())).collect(),
            dropped_imports: constants.dropped_imports.iter().cloned().collect(),
            without_side_effects: constants.without_side_effects.iter().cloned().collect(),
            lifted_commonjs: constants.lifted_commonjs.iter().cloned().collect(),
            kinds_of_code: provided.kinds_of_code.iter().map(|(path, is_commonjs)| (path.clone(), *is_commonjs)).collect(),
            statements: constants.statements.iter().flat_map(|(path, list)| list.iter().map(move |&(start, verdict)| (path.clone(), start, verdict))).collect(),
            texts: constants.texts.iter().map(|(path, text)| (path.clone(), text.clone())).collect(),
            assets: constants.assets.iter().map(|(path, key)| (path.clone(), key.clone())).collect(),
            defines: constants.defines.clone(),
            features: constants.features.clone(),
            preserve_source_paths,
            entry_functions: entry_functions.clone(),
        };
        let _ = bun_sys::File::write_file(bun_sys::Fd::cwd(), &bun_core::ZBox::from_bytes(path), &snapshot.to_bytes());
    }
    let found: bun_threading::Guarded<Option<bun_ast::type_tags::ProgramFacts>> =
        bun_threading::Guarded::new(None);
    let not_compiled: bun_threading::Guarded<Vec<String>> = bun_threading::Guarded::new(Vec::new());
    let explained: bun_threading::Guarded<Vec<String>> = bun_threading::Guarded::new(Vec::new());
    let translation = bun_aot::Translation::new(&constants).explaining(explaining(explain));
    let begin = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>| {
        printing_of_function_texts.start(usize::from(bun_core::get_thread_count()).div_ceil(2));
        // The executable runs its first entry point. The others are what it starts workers with.
        let entry_points: Vec<Vec<_>> = (entry_functions.iter())
            .map(|roots| roots.iter().filter_map(|path| program.files.by_path.get(&from_native(path))).collect())
            .collect();
        translation.begin(program, &entry_points, in_parallel);
    };
    let translate_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        translation.translate_file(checker, file);
    };
    let note_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        translation.note_file(checker, file);
    };
    let merge_notes = |program: &bun_sema_driver::Program| translation.merge_notes(program);
    let compiled_entry_points = || names_of_entry_functions.iter().map(|name| name.clone().into_boxed_slice()).collect();
    let analyze = |program: &bun_sema_driver::Program,
                   in_parallel: bun_sema_driver::InParallel<'_>,
                   errors: &[(bun_sema_driver::FileId, u32)]|
     -> Vec<bool> {
        if let Some(path) = bun_core::env_var::BUN_AOT_TYPED_FILE.get() {
            if let Ok(typed) = bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
                *found.lock() = Some(bun_ast::type_tags::ProgramFacts {
                    engine: None,
                    typed: Some(typed.into_boxed_slice()),
                    entry_points: compiled_entry_points(),
                    tokens: None,
                });
            }
            return vec![false; errors.len()];
        }
        let engine: bun_threading::Guarded<Option<bun_ast::type_tags::EarlyEngine>> = bun_threading::Guarded::new(None);
        let on_written = |typed: &[u8]| *engine.lock() = Some(bun_jsc::cached_bytecode::start_typed_program(typed, has_late_strings));
        let bun_aot::ForEngine { written: typed, errors_that_stand, explained: lines, tokens } = translation.finish_for_engine(program, in_parallel, errors, &on_written);
        *explained.lock() = lines;
        match typed {
            Ok(typed) => {
                *found.lock() = Some(bun_ast::type_tags::ProgramFacts {
                    engine: engine.lock().take(),
                    typed: Some(typed),
                    entry_points: compiled_entry_points(),
                    tokens,
                });
            }
            Err(problems) => *not_compiled.lock() = problems,
        }
        errors_that_stand
    };
    let entries = Paths::EntryPoints(Entries {
        paths: &paths,
        script_kinds: &script_kinds,
        script_kinds_by_extension: &by_extension,
        conditions,
    });
    let request = Request {
        is_one_program: true,
        code: &code,
        loaded: Some(&begin),
        after_file: Some(&translate_file),
        before_visits: Some(&note_file),
        all_visited_once: Some(&merge_notes),
        compile: Some(&analyze),
        plan_options: bun_sema_driver::PlanOptions { early_run: early.map(|(run, _)| run), ..Default::default() },
        ..request(cwd, tsconfig, &entries, &[], 0, None)
    };
    if let Some((_, wait_for_early_parse)) = early {
        wait_for_early_parse();
    }
    let report = bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), |report| report);
    add_to_log(&report, log);
    if explains_into_log {
        for line in std::mem::take(&mut *explained.lock()) {
            log.add_msg(bun_ast::Msg { kind: bun_ast::Kind::Verbose, data: bun_ast::Data { text: std::borrow::Cow::Owned(line.into_bytes()), location: None }, ..Default::default() });
        }
    }
    print_explained(&explained.lock());
    for problem in not_compiled.lock().iter() {
        log.add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("{problem}"));
    }
    for path in not_printed.lock().iter() {
        log.add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("{}: internal error: the module could not be printed as the React Compiler or the lowering of decorators leaves it; please report it", BStr::new(path)));
    }
    found.lock().take().filter(|_| report.is_ok())
}

fn explaining(words: &[Box<[u8]>]) -> bun_aot::Explain {
    let mut explain = bun_aot::Explain::default();
    for word in words {
        explain.set(word);
    }
    explain
}

fn print_explained(lines: &[String]) {
    for line in lines {
        let (writer, prefix) = match line.as_bytes().first() {
            Some(b'{') => (Output::writer(), ""),
            Some(b'[') => (Output::error_writer(), ""),
            _ => (Output::error_writer(), "aot: "),
        };
        let _ = writer.write_all(prefix.as_bytes());
        let _ = writer.write_all(line.as_bytes());
        let _ = writer.write_all(b"\n");
    }
    Output::flush();
}

/// The files of the bundle, `sources`, are not read again. The errors are added to `log`, which the
/// build reports like its own. It runs on the thread of the bundler.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Emitted {
    Nothing,
    Declarations,
    DeclarationsAndModuleTypes,
}

pub(crate) fn declarations_for_build_command(checked: TypeChecked, log: &mut bun_ast::Log) -> Option<Declarations> {
    check_and_emit_for_build(checked, log, true, Emitted::Declarations)
}

pub(crate) fn declarations_for_bun_build(checked: TypeChecked, log: &mut bun_ast::Log) -> Option<Declarations> {
    check_and_emit_for_build(checked, log, false, Emitted::Declarations)
}

pub(crate) fn sound_declarations_for_build(checked: TypeChecked, log: &mut bun_ast::Log) -> Option<Declarations> {
    check_and_emit_for_build(checked, log, false, Emitted::DeclarationsAndModuleTypes)
}

pub(crate) fn sound_files_for_build(asked: SoundFilesRequest<'_>, log: &mut bun_ast::Log) -> TypedOutputs {
    use bun_sema_driver::sound_files::{ModuleTypes, Output, sound_files, typed_outputs, annotate_implicit_any};
    let SoundFilesRequest { cwd, tsconfig, conditions, loaders, outdir, written, module_types, rolls_up_declarations, keeps_modules_apart } = asked;
    let modules = module_types.and_then(|types| types.downcast_ref::<Vec<ModuleTypes>>());
    let outputs: Vec<Output<'_>> = written.iter().map(|file| Output { path: file.path, javascript: file.text, source_map: file.source_map, entry_point: file.entry_point }).collect();
    let by_extension = script_kinds_by_extension(loaders);
    let check = |typed: &mut Vec<(Vec<u8>, Vec<u8>)>, declarations: &[(Vec<u8>, Vec<u8>)]| {
        let paths: Vec<Vec<u8>> = typed.iter().map(|file| file.0.clone()).collect();
        let entries = Paths::EntryPoints(Entries { paths: &paths, script_kinds: &[], script_kinds_by_extension: &by_extension, conditions });
        let plan_options = bun_sema_driver::PlanOptions { writes_declaration_files: true, ..Default::default() };
        let request = Request { plan_options, ..request(cwd, tsconfig, &entries, &[], 0, None) };
        let mut rounds = 0;
        loop {
            let provided = Provided { already_read: already_read(cwd, &mut typed.iter().chain(declarations).map(|file| (&file.0[..], &file.1[..]))), ..Default::default() };
            let report = bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), |report| report);
            rounds += 1;
            if rounds == 3 || !annotate_implicit_any(typed, &report.diagnostics) {
                return report;
            }
        }
    };
    const NAMES: [(&[u8], &[u8]); 3] = [(b".sound.ts", b".d.ts"), (b".sound.mts", b".d.mts"), (b".sound.cts", b".d.cts")];
    let mut declaration_files: DeclarationFiles = (rolls_up_declarations.then(|| typed_outputs(outdir, &outputs, modules.map(Vec::as_slice), true, false).ok()).flatten())
        .filter(|typed| typed.iter().all(|(_, typed)| typed.untyped_exports.is_empty() && typed.dropped_casts == 0))
        .map(|typed| typed.into_iter().map(|(path, typed)| (path, typed.text)).collect())
        .map(|mut typed: Vec<(Vec<u8>, Vec<u8>)>| check(&mut typed, &[]))
        .filter(|report| report.is_ok())
        .map_or_else(Vec::new, |report| {
            (report.declaration_files.iter())
                .filter_map(|(source, text)| {
                    let source = bun_sema_driver::host::to_native(source);
                    let path = NAMES.iter().find_map(|(from, to)| Some([source.strip_suffix(*from)?, *to].concat()))?;
                    Some((path.into_boxed_slice(), text[..].into()))
                })
                .collect()
        });
    let mut found = match sound_files(outdir, &outputs, modules.map(Vec::as_slice), keeps_modules_apart) {
        Ok(found) => found,
        Err(why) => {
            log.add_warning_fmt(None, bun_ast::Loc::EMPTY, format_args!("{SOUND_FILES_LEFT_OUT}: {why}"));
            return TypedOutputs { sound_files: Vec::new(), declaration_files };
        }
    };
    let report = check(&mut found.typed, &found.declarations_while_checked);
    if let Some(first) = report.diagnostics.iter().find(|reported| matches!(reported.category, Category::Error)).filter(|_| !report.is_ok()) {
        let path = bun_sema_driver::host::to_native(&first.path);
        let shown = BStr::new(path.strip_prefix(outdir).map_or(&path[..], |inside| inside.strip_prefix(b"/").unwrap_or(inside)));
        let text = BStr::new(bun_core::strings::split(&first.text[..], b"\n").next().unwrap_or_default());
        log.add_warning_fmt(None, bun_ast::Loc::EMPTY, format_args!("{SOUND_FILES_LEFT_OUT}: with its types put back it has type errors, the first at {shown}:{}:{}: TS{}: {text}", first.line, first.column, first.code));
        return TypedOutputs { sound_files: Vec::new(), declaration_files };
    }
    if !report.is_ok() {
        log.add_warning_fmt(None, bun_ast::Loc::EMPTY, format_args!("{SOUND_FILES_LEFT_OUT}: with its types put back it could not be type checked"));
        return TypedOutputs { sound_files: Vec::new(), declaration_files };
    }
    let sound_files = (found.typed.into_iter().zip(found.marks))
        .map(|((path, text), (declaration_file, mark))| {
            let rolled_up = declaration_files.iter_mut().find(|(path, _)| path[..] == declaration_file[..]);
            let is_marked = rolled_up.map(|(_, text)| *text = [&mark[..], &text[..]].concat().into_boxed_slice()).is_some();
            let mark = if is_marked { Vec::new() } else { mark };
            SoundFile { path: path.into_boxed_slice(), text: text.into_boxed_slice(), declaration_file: declaration_file.into_boxed_slice(), mark: mark.into_boxed_slice() }
        })
        .collect();
    TypedOutputs { sound_files, declaration_files }
}

fn check_for_build(checked: TypeChecked, log: &mut bun_ast::Log, shows_progress: bool) -> bool {
    check_and_emit_for_build(checked, log, shows_progress, Emitted::Nothing).is_some()
}

fn check_and_emit_for_build(checked: TypeChecked, log: &mut bun_ast::Log, shows_progress: bool, emitted: Emitted) -> Option<Declarations> {
    let TypeChecked {
        cwd,
        tsconfig,
        conditions,
        loaders,
        entry_points,
        own_entry_points: _,
        sources,
        imports: _,
        dropped_imports: _,
        without_side_effects: _,
        lifted_commonjs: _,
        kinds: _,
        statements: _,
        texts: _,
        assets: _,
        has_late_strings: _,
        defines: _,
        features: _,
        rewrite_jest_for_tests: _,
        ignore_dce_annotations: _,
        jsx_side_effects: _,
        minify_syntax: _,
        shortens_names: _,
        preserve_source_paths: _,
        react_compiler_outputs: _,
        jsx: _,
        classes: _,
        function_texts: _,
        printing_of_function_texts: _,
        explain: _,
        explains_into_log: _,
        logs_type_errors: _,
        early_analysis: _,
        release_asts: _,
    } = checked;
    let by_extension = script_kinds_by_extension(loaders);
    // The bundler knows what it loads each file with. What is installed is what its name says.
    let mut script_kinds: Vec<(Vec<u8>, ScriptKind)> = Vec::new();
    let mut sources = sources.map(|(path, text, loader)| {
        let script_kind = script_kind_of(loader).filter(|it| it.differs_from_name(path));
        if !bun_core::strings::contains(path, bun_paths::NODE_MODULES_NEEDLE) {
            script_kinds.extend(script_kind.map(|it| (path.to_vec(), it)));
        }
        (path, text)
    });
    let provided = Provided {
        already_read: already_read(cwd, &mut sources),
        ..Default::default()
    };
    // Not `App.svelte`, which a plugin turns into TypeScript.
    let is_source = |path: &&[u8]| {
        has_types_with(&by_extension, path) || script_kinds.iter().any(|it| it.0 == **path)
    };
    let paths: Vec<Vec<u8>> = (entry_points.filter(is_source))
        .map(<[u8]>::to_vec)
        .collect();
    // Only stylesheets and the like.
    if paths.is_empty() {
        return Some(Declarations { files: Vec::new(), module_types: None });
    }
    let paths = Paths::EntryPoints(Entries {
        paths: &paths,
        script_kinds: &script_kinds,
        script_kinds_by_extension: &by_extension,
        conditions,
    });
    let then = |report| report;
    let module_types: bun_threading::Guarded<Vec<(u32, bun_sema_driver::sound_files::ModuleTypes)>> = bun_threading::Guarded::new(Vec::new());
    let note_module_types = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        if let Some(found) = bun_sema_driver::sound_files::module_types(checker, file) {
            let mut module_types = module_types.lock();
            module_types.retain(|known| known.0 != file.0);
            module_types.push((file.0, found));
        }
    };
    let report = match shows_progress {
        _ if emitted != Emitted::Nothing => {
            let plan_options = bun_sema_driver::PlanOptions { writes_declaration_files: true, ..Default::default() };
            let after_file = (emitted == Emitted::DeclarationsAndModuleTypes)
                .then_some(&note_module_types as &(dyn Fn(&mut bun_sema_driver::Checker<'_, '_>, bun_sema_driver::FileId) + Sync));
            let request = Request { plan_options, after_file, ..request(cwd, tsconfig, &paths, &[], 0, None) };
            bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), then)
        }
        true => run(cwd, tsconfig, &paths, &[], 0, provided, then),
        false => run_quietly(cwd, tsconfig, &paths, &[], 0, None, provided, then),
    };
    add_to_log(&report, log);
    let declaration_files = report.declaration_files.iter().map(|(source, text)| (bun_sema_driver::host::to_native(source).into(), text[..].into()));
    let mut module_types = std::mem::take(&mut *module_types.lock());
    module_types.sort_by_key(|module| module.0);
    let module_types: Vec<bun_sema_driver::sound_files::ModuleTypes> = module_types.into_iter().map(|module| module.1).collect();
    report.is_ok().then(|| Declarations {
        files: declaration_files.collect(),
        module_types: (emitted == Emitted::DeclarationsAndModuleTypes).then(|| Box::new(module_types) as Box<dyn core::any::Any + Send>),
    })
}

/// The errors as those of a build.
fn add_to_log(report: &Report, log: &mut bun_ast::Log) {
    let note = format::note_on_bun_types(report);
    for (index, reported) in report.diagnostics.iter().enumerate() {
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
            notes: (reported.related.iter().map(log_data_of))
                .chain(
                    note.filter(|note| note.0 == index)
                        .map(|note| bun_ast::Data {
                            text: std::borrow::Cow::Borrowed(note.1),
                            location: None,
                        }),
                )
                .collect(),
            ..Default::default()
        });
    }
    for file in &report.incomplete {
        let path = bun_sema_driver::host::to_native(&file.path);
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("{}", BStr::new(&file.message(path))),
        );
    }
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
        let line = reported.source.get(index as usize)?;
        // Of a longer one only the beginning is kept, which the column need not be in.
        (line.len() <= bun_sema_driver::MAX_SHOWN_LINE).then(|| Cow::Owned(line.clone()))
    };
    bun_ast::Data {
        text: Cow::Owned(text),
        location: (!reported.path.is_empty()).then(|| bun_ast::Location {
            file: Cow::Owned(bun_sema_driver::host::to_native(&reported.path).to_vec()),
            line_text: line_text(),
            length: reported.end.saturating_sub(reported.start) as usize,
            offset: reported.start as usize,
            line: reported.line as i32,
            column: reported.column as i32,
            ..Default::default()
        }),
    }
}

/// By its name. A file that is neither TypeScript nor JavaScript has no types to check: a
/// stylesheet, a page.
pub(crate) fn has_types(path: &[u8]) -> bool {
    use bun_ast::Loader;
    Loader::from_string(bun_paths::extension(path)).is_some_and(Loader::is_javascript_like)
}

/// The files to name in the check of `entry_points`, which are relative to `cwd`, and
/// `Request::script_kinds`. `None` if none of them has types to check.
fn declarations_of_the_test_runner() -> Vec<u8> {
    let also = br#"
declare module "@jest/globals*" { export * from "bun:test"; }
declare module "vitest*" { export * from "bun:test"; }
"#;
    let module = &include_bytes!("../../../packages/bun-types/test.d.ts")[..];
    let named = &b"declare module \"bun:test\" {"[..];
    let at = module.windows(named.len()).position(|text| text == named).expect("bun-types declares the module");
    [&b"// @ts-nocheck\n"[..], &include_bytes!("../../../packages/bun-types/test-globals.d.ts")[..], &also[..], &module[..at], &b"declare module \"bun:test*\" {"[..], &module[at + named.len()..]].concat()
}

fn what_to_check(
    cwd: &[u8],
    entry_points: &[EntryPoint],
    by_extension: &[(Vec<u8>, ScriptKind)],
) -> Option<(Vec<Vec<u8>>, Vec<(Vec<u8>, ScriptKind)>)> {
    let has_types = |path: &[u8]| has_types_with(by_extension, path);
    let (mut paths, mut script_kinds) = (Vec::new(), Vec::new());
    for entry_point in entry_points {
        let path = entry_point.path;
        if path.ends_with(b".html") {
            bun_sema_driver::asked::spoil();
            for page in pages_of(cwd, path) {
                let scripts = imports_of_page(cwd, &page);
                paths.extend(scripts.into_iter().filter(|path| has_types(path)));
            }
        } else if let Some(loader) = entry_point.loader {
            // Whatever its name says.
            let Some(script_kind) = script_kind_of(loader) else {
                continue;
            };
            paths.push(path.to_vec());
            if script_kind.differs_from_name(path) {
                script_kinds.push((path.to_vec(), script_kind));
            }
        } else if has_types(path) {
            paths.push(path.to_vec());
        }
    }
    (!paths.is_empty()).then_some((paths, script_kinds))
}

/// The pages that `bun` serves for the argument `page`, which src/js/internal/html.ts finds with
/// `new Bun.Glob(page).scanSync(cwd)` if it can be a pattern. None of them is in a `node_modules`.
fn pages_of(cwd: &[u8], page: &[u8]) -> Vec<Vec<u8>> {
    use bun_glob::{BunGlobWalker, walk};
    let mut pages = Vec::new();
    if !bun_core::strings::contains_any(page, b"*{") {
        pages.push(page.to_vec());
    } else if let Ok(Ok(mut walker)) =
        // The defaults of `scanSync`: files only.
        BunGlobWalker::init_with_cwd(
            page, cwd, false, false, false, false, true, None,
        )
    {
        let mut matches = walk::Iterator::new(&mut walker);
        if matches!(matches.init(), Ok(Ok(()))) {
            while let Ok(Ok(Some(path))) = matches.next() {
                pages.push(path.into_vec());
            }
        }
    }
    pages.retain(|page| {
        let page =
            bun_paths::resolve_path::join_abs_string::<bun_paths::platform::Auto>(cwd, &[page]);
        !bun_core::strings::contains(page, bun_paths::NODE_MODULES_NEEDLE)
    });
    pages
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
    // The scanner takes `/src/main.tsx` from there. `bun ./index.html` has not come to it yet.
    if bun_resolver::fs::FileSystem::init(None).is_err() {
        return Vec::new();
    }
    let records = bun_bundler::html_scanner::scan_import_records(&mut log, &source);
    let directory = resolve_path::dirname::<Auto>(&page);
    let is_url = |path: &[u8]| path.starts_with(b"//") || bun_core::strings::contains(path, b"://");
    (records.unwrap_or_default().iter())
        .map(|record| record.path.text())
        .filter(|path| !is_url(path))
        .map(|path| resolve_path::join_abs_string::<Auto>(directory, &[path]).to_vec())
        .collect()
}

#[derive(Default)]
pub(crate) struct AuditFound {
    pub(crate) modules: Vec<(bun_aot::audit::Module, Vec<u8>)>,
    pub(crate) shapes: Vec<(String, String)>,
    pub(crate) has_errors: bool,
    pub(crate) stops_a_build: bool,
    pub(crate) never_visited: Vec<Vec<u8>>,
    /// The TypeScript files of dependencies that are loaded and were not visited: whatever further looks could find never visited is among them.
    pub(crate) may_be_visited: Vec<Vec<u8>>,
    /// Of the files that were handed in as more code: those that the linked program does not hold.
    pub(crate) not_in_the_program: Vec<Vec<u8>>,
    pub(crate) said: Vec<u8>,
    pub(crate) seen_by_others: Vec<(Vec<u8>, u64, Vec<u8>)>,
    pub(crate) is_seen_otherwise: bool,
    /// Of a look for tests: the entry points from which a file with an error is reached.
    pub(crate) reach_errors: Vec<Vec<u8>>,
}

/// `imports`: by file, its name and the files it imports. Nothing where an error belongs to no file of those.
fn entry_points_that_reach_errors(cwd: &[u8], entry_points: &[Vec<u8>], imports: &[(Vec<u8>, Vec<u32>)], diagnostics: &[Diagnostic]) -> Vec<Vec<u8>> {
    use bun_paths::{platform::Auto, resolve_path::join_abs_string};
    let mut has_errors = vec![false; imports.len()];
    for error in diagnostics.iter().filter(|reported| matches!(reported.category, Category::Error)) {
        let Some(file) = imports.iter().position(|(name, _)| *name == error.path) else { return Vec::new() };
        has_errors[file] = true;
    }
    let reaches_one = |path: &Vec<u8>| {
        let name = bun_sema_driver::host::from_native(join_abs_string::<Auto>(cwd, &[path]));
        let mut is_walked = vec![false; imports.len()];
        let mut left: Vec<u32> = imports.iter().position(|(known, _)| *known == name).map(|file| file as u32).into_iter().collect();
        while let Some(file) = left.pop() {
            if has_errors[file as usize] {
                return true;
            }
            if !core::mem::replace(&mut is_walked[file as usize], true) {
                left.extend_from_slice(&imports[file as usize].1);
            }
        }
        false
    };
    entry_points.iter().filter(|path| reaches_one(path)).cloned().collect()
}

/// What the form of `AuditFound::said` depends on.
pub(crate) fn form_of_what_is_said() -> [bool; 4] {
    let to = Destination::stderr();
    [to.is_tty, to.colors, Output::is_ai_agent(), Output::is_github_action()]
}

#[derive(Clone, Copy)]
pub(crate) enum Audited<'a> {
    Whole,
    WholeInTheBackground,
    Alone { path: &'a [u8], text: &'a [u8], is_quiet: bool },
    Changed { paths: &'a [Vec<u8>], seen_by_others: &'a [(Vec<u8>, u64, Vec<u8>)] },
}

pub(crate) fn audit_before(
    entry_points: &[EntryPoint],
    before_read: Option<BeforeRead>,
    is_for_tests: bool,
    audited: Audited<'_>,
    more_code: &[Vec<u8>],
    as_soon_as_found: Option<&(dyn Fn(AuditFound) + Sync)>,
) -> Option<AuditFound> {
    use bun_paths::{platform::Auto, resolve_path::join_abs_string};
    use bun_sema_driver::host::from_native;
    let cwd = working_directory();
    let args = bun_options_types::context::try_get().map(|ctx| &ctx.args);
    let loaders = args.and_then(|args| args.loaders.as_ref());
    let loaders = loaders_from_transform_options(loaders, bun_ast::Target::Bun);
    let by_extension = script_kinds_by_extension(&loaders.unwrap_or_default());
    let (paths, script_kinds) = what_to_check(&cwd, entry_points, &by_extension)?;
    let mut in_memory = (entry_points.iter()).filter_map(|it| Some((it.path, it.text?)));
    let mut provided = Provided {
        already_read: already_read(&cwd, &mut in_memory),
        before_read,
        ..Default::default()
    };
    let mut code: Vec<Vec<u8>> = Vec::new();
    for &(name, text) in bun_aot::prelude::FILES {
        let path = bun_aot::prelude::path_of(&cwd, name);
        provided.already_read.insert(from_native(&path), text.as_bytes().into());
        code.push(path);
    }
    code.extend(more_code.iter().cloned());
    let mut roots = paths.clone();
    if is_for_tests {
        let path = bun_aot::prelude::path_of(&cwd, "test-globals.d.ts");
        provided.already_read.insert(from_native(&path), declarations_of_the_test_runner().into());
        roots.push(path);
    }
    let alone: Option<Vec<Vec<u8>>> = match audited {
        Audited::Whole | Audited::WholeInTheBackground => None,
        Audited::Alone { path, text, .. } => {
            provided.already_read.insert(from_native(path), bun_core::strings::without_utf8_bom(text).to_vec().into());
            Some(vec![from_native(path)])
        }
        Audited::Changed { paths, seen_by_others } => {
            for (path, _, declarations) in seen_by_others.iter().filter(|it| !paths.contains(&it.0)) {
                provided.already_read.insert(from_native(path), declarations.clone().into());
            }
            Some(paths.iter().map(|path| from_native(path)).collect())
        }
    };
    let only = alone.as_ref().map(|alone| alone.join(&0u8));
    let is_left_out = |checker: &bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        alone.as_ref().is_some_and(|alone| !alone.iter().any(|alone| checker.p.files.modules[file.idx()].file_name() == &alone[..]))
    };
    let constants = bun_aot::Constants {
        root: from_native(&cwd),
        has_test_globals: is_for_tests,
        notes_spans: true,
        defines: (args.and_then(|args| args.define.as_ref())).map_or_else(Vec::new, |define| define.keys.iter().zip(&define.values).map(|(name, value)| (name.to_vec(), value.to_vec())).collect()),
        features: args.map_or_else(Vec::new, |args| args.feature_flags.iter().map(|flag| flag.to_vec()).collect()),
        has_preloads: bun_options_types::context::try_get().is_some_and(|ctx| !ctx.preloads.is_empty()),
        ..Default::default()
    };
    let translation = bun_aot::Translation::new(&constants);
    let begin = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>| {
        let entry_points: Vec<Vec<_>> = (paths.iter())
            .filter_map(|path| program.files.by_path.get(&from_native(join_abs_string::<Auto>(&cwd, &[path]))))
            .map(|file| vec![file])
            .collect();
        translation.begin(program, &entry_points, in_parallel);
    };
    let visited: bun_threading::Guarded<bun_sema_driver::FxHashSet<usize>> = bun_threading::Guarded::new(Default::default());
    let seen_by_others: bun_threading::Guarded<Vec<(Vec<u8>, u64, Vec<u8>)>> = bun_threading::Guarded::new(Vec::new());
    let translate_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        if !is_left_out(checker, file) {
            visited.lock().insert(file.idx());
            translation.translate_file(checker, file);
            let module = &checker.p.files.modules[file.idx()];
            if matches!(bun_paths::extension(module.file_name()), b".ts" | b".tsx" | b".mts" | b".cts") && !module.is_untyped() && !module.is_of_a_dependency {
                let path = bun_sema_driver::host::to_native(module.file_name()).to_vec();
                if let Some(declarations) = checker.declaration_file_without_reports(file) {
                    seen_by_others.lock().push((path, bun_wyhash::hash(&declarations), declarations));
                }
            }
        }
    };
    let note_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        if !is_left_out(checker, file) {
            translation.note_file(checker, file);
        }
    };
    let merge_notes = |program: &bun_sema_driver::Program| translation.merge_notes(program);
    let found: bun_threading::Guarded<AuditFound> = bun_threading::Guarded::new(AuditFound::default());
    let imports: bun_threading::Guarded<Vec<(Vec<u8>, Vec<u32>)>> = bun_threading::Guarded::new(Vec::new());
    let list = |program: &bun_sema_driver::Program,
                in_parallel: bun_sema_driver::InParallel<'_>,
                errors: &[(bun_sema_driver::FileId, u32)]|
     -> Vec<bool> {
        let text_of = |path: &[u8]| {
            let path = join_abs_string::<Auto>(&cwd, &[bun_sema_driver::host::to_native(path)]);
            program.files.by_path.get(&from_native(path)).map(|file| &program.files.hir(file).text[..])
        };
        let with_texts = |modules: Vec<bun_aot::audit::Module>| -> Vec<(bun_aot::audit::Module, Vec<u8>)> {
            (modules.into_iter())
                .filter_map(|module| {
                    let text = text_of(&module.path)?.to_vec();
                    Some((module, text))
                })
                .collect()
        };
        if alone.is_some() {
            for of_fragment in translation.take_programs_of_fragments(program) {
                found.lock().modules.extend(with_texts(bun_aot::audit::table(&of_fragment, false, &text_of, in_parallel)));
            }
            found.lock().has_errors = !errors.is_empty();
            if let Audited::Changed { paths, seen_by_others: before } = audited {
                let mut found = found.lock();
                found.seen_by_others = core::mem::take(&mut *seen_by_others.lock());
                found.is_seen_otherwise = paths.iter().any(|path| {
                    let of = |list: &[(Vec<u8>, u64, Vec<u8>)]| list.iter().find(|it| it.0 == *path).map(|it| it.1);
                    of(before).is_none() || of(before) != of(&found.seen_by_others)
                });
            }
            if let Some(as_soon_as_found) = as_soon_as_found {
                as_soon_as_found(core::mem::take(&mut *found.lock()));
            }
            return vec![matches!(audited, Audited::Changed { .. }); errors.len()];
        }
        if is_for_tests {
            *imports.lock() = (program.files.modules.iter()).map(|module| (module.file_name().to_vec(), module.imports.values().map(|imported| imported.idx() as u32).collect())).collect();
        }
        let mut translated = translation.finish(program, in_parallel, errors);
        bun_aot::audit::let_any_object_pass_for_classes_without_a_layout(&mut translated.program);
        let modules = with_texts(bun_aot::audit::table(&translated.program, true, &text_of, in_parallel));
        let never_visited = (modules.iter())
            .filter(|(module, _)| matches!(bun_paths::extension(&module.path), b".ts" | b".tsx" | b".mts" | b".cts"))
            .filter_map(|(module, _)| {
                let path = join_abs_string::<Auto>(&cwd, &[bun_sema_driver::host::to_native(&module.path)]).to_vec();
                let file = program.files.by_path.get(&from_native(&path))?;
                (!visited.lock().contains(&file.idx()) && !more_code.contains(&path)).then_some(path)
            })
            .collect();
        let may_be_visited = (program.files.modules.iter().enumerate())
            .filter(|(index, module)| module.is_of_a_dependency && matches!(bun_paths::extension(module.file_name()), b".ts" | b".tsx" | b".mts" | b".cts") && ![&b".d.ts"[..], b".d.mts", b".d.cts"].iter().any(|ending| module.file_name().ends_with(ending)) && !visited.lock().contains(index))
            .map(|(_, module)| bun_sema_driver::host::to_native(module.file_name()).to_vec())
            .filter(|path| !more_code.contains(path))
            .collect();
        let in_the_program: bun_sema_driver::FxHashSet<Vec<u8>> = modules.iter().map(|(module, _)| join_abs_string::<Auto>(&cwd, &[bun_sema_driver::host::to_native(&module.path)]).to_vec()).collect();
        let not_in_the_program = more_code.iter().filter(|path| !in_the_program.contains(*path)).cloned().collect();
        *found.lock() = AuditFound {
            modules,
            shapes: bun_aot::audit::shapes(&translated.program),
            has_errors: translated.errors_that_stand.contains(&true),
            stops_a_build: false,
            never_visited,
            may_be_visited,
            not_in_the_program,
            said: Vec::new(),
            seen_by_others: core::mem::take(&mut *seen_by_others.lock()),
            is_seen_otherwise: false,
            reach_errors: Vec::new(),
        };
        bun_aot::release(translated.program, in_parallel);
        translated.errors_that_stand
    };
    let entries = Paths::EntryPoints(Entries {
        paths: &roots,
        script_kinds: &script_kinds,
        script_kinds_by_extension: &by_extension,
        conditions: args.map_or(&[][..], |args| &args.conditions[..]),
    });
    let request = Request {
        is_one_program: true,
        code: &code,
        loaded: Some(&begin),
        after_file: Some(&translate_file),
        before_visits: Some(&note_file),
        all_visited_once: Some(&merge_notes),
        compile: Some(&list),
        only: only.as_deref(),
        threads: match audited {
            Audited::Whole | Audited::Changed { .. } => 0,
            Audited::WholeInTheBackground => usize::from(bun_core::get_thread_count()).div_ceil(2),
            Audited::Alone { .. } => usize::from(bun_core::get_thread_count()).min(8),
        },
        ..request(&cwd, tsconfig_override(), &entries, &[], 0, None)
    };
    let mut report = bun_sema_driver::check_provided_then(&request, with_pages(&cwd, provided), |report| report);
    let is_ok = report.is_ok();
    let is_looked_at_again = is_ok && !found.lock().never_visited.is_empty();
    if !is_ok && report.incomplete.is_empty() {
        found.lock().reach_errors = entry_points_that_reach_errors(&cwd, &paths, &imports.lock(), &report.diagnostics);
    }
    if is_for_tests && !is_looked_at_again && matches!(audited, Audited::Whole) {
        static SAID: bun_threading::Guarded<Vec<(Vec<u8>, u32, u32)>> = bun_threading::Guarded::new(Vec::new());
        let mut said = SAID.lock();
        report.diagnostics.retain(|reported| {
            let key = (reported.path.clone(), reported.start, reported.code);
            let is_new = !said.contains(&key);
            if is_new {
                said.push(key);
            }
            is_new
        });
    }
    if !is_looked_at_again && !found.lock().is_seen_otherwise && !matches!(audited, Audited::Alone { is_quiet: true, .. }) && (!report.diagnostics.is_empty() || !report.incomplete.is_empty()) {
        let shown_from = from_native(&cwd);
        let style = Style {
            is_case_sensitive: report.is_case_sensitive,
            ..style_for(&shown_from, None, Destination::stderr(), false)
        };
        let mut out = Vec::new();
        format::write_diagnostics(&mut out, &report, &style);
        if matches!(audited, Audited::Whole) && !is_ok && !crate::cli::aot_audit::acts() && found.lock().modules.iter().all(|(module, _)| module.groups.is_empty() && module.parameters.is_empty()) {
            out.extend_from_slice(b"[aot] note: fix these type errors first: bun build --compile --aot stops at them, and nothing is audited until they are fixed\n");
        }
        static WRITTEN: bun_threading::Guarded<Vec<u8>> = bun_threading::Guarded::new(Vec::new());
        if *WRITTEN.lock() != out && !matches!(audited, Audited::WholeInTheBackground) {
            let _ = Output::error_writer().write_all(&out);
            Output::flush();
        }
        *WRITTEN.lock() = out.clone();
        found.lock().said = out;
    }
    if !is_looked_at_again {
        found.lock().never_visited.clear();
    }
    found.lock().stops_a_build = !is_ok;
    Some(core::mem::take(&mut *found.lock()))
}

/// Type checks the project that contains the working directory, as `bun check` does, before one of
/// its scripts is run.
pub(crate) fn check_project_before() -> bool {
    check_and_report(&Paths::EntryPoints(Entries::default()), Provided::default())
}

/// `--tsconfig-override` of `bun`: what is run is resolved with it, in place of every other.
fn tsconfig_override() -> Option<&'static [u8]> {
    bun_options_types::context::try_get()?
        .args
        .tsconfig_override
        .as_deref()
}

/// Returns whether there are no errors.
fn check_and_report(paths: &Paths, provided: Provided) -> bool {
    let cwd = working_directory();
    let then = |report| report;
    let report = run(&cwd, tsconfig_override(), paths, &[], 0, provided, then);
    if report.diagnostics.is_empty() && report.incomplete.is_empty() {
        return report.is_ok();
    }
    let shown_from = bun_sema_driver::host::from_native(&cwd);
    let style = Style {
        is_case_sensitive: report.is_case_sensitive,
        ..style_for(&shown_from, None, Destination::stderr(), false)
    };
    let mut out = Vec::new();
    format::write_diagnostics(&mut out, &report, &style);
    if !report.is_ok() {
        format::write_summary(&mut out, &report, &style);
    }
    let _ = Output::error_writer().write_all(&out);
    Output::flush();
    report.is_ok()
}
