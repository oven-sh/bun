//! `bun check`: type checks a TypeScript project. `bun run --check` and `bun test --check` go through [`check_before`].
//! `bun build --check` and `Bun.build({ check: true })` run the check inside the bundle, when the bundler has read every
//! file ([`check_for_build_command`], [`check_for_bun_build`]).

use bstr::BStr;

use bun_bundler::options::{TypeChecked, loaders_from_transform_options};
use bun_clap as clap;
use bun_core::{Global, Output, UnwrapOrOom, ZStr, env_var};
use bun_sema_driver::format::{self, Layout, Style};
use bun_sema_driver::host::{AlreadyRead, BeforeRead, Provided};
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
    // What precedes `check` is for `bun`, like what `BUN_OPTIONS` has. A flag there that is not
    // one of these is skipped, as every other command skips it.
    let positionals = parsed.positionals();
    let check = positionals.iter().position(|it| *it == b"check");
    let positionals = &positionals[check.map_or(0, |at| at + 1)..];
    // What follows `--` is a path, whatever it looks like.
    let after_dashes =
        (args.iter().position(|arg| arg.as_bytes() == b"--")).map_or(0, |at| args.len() - at - 1);
    let (flags, paths) = positionals.split_at(positionals.len().saturating_sub(after_dashes));
    let mut command_line = bun_sema_driver::parse_command_line(flags, &working_directory());
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

/// Whether `check` is a script of the project: `scripts.check` of the nearest `package.json`, which
/// is where `bun run` looks. `bun check` ran it before there was a type checker, so it still does.
/// The type checker is also `bun --check`.
#[cold]
#[inline(never)]
pub(crate) fn is_package_script() -> bool {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::join_abs_string;
    let mut cwd = working_directory();
    let mut args = bun_core::argv().into_iter();
    while let Some(arg) = args.next() {
        // What follows the name of a script is for the script.
        if arg == b"check" {
            break;
        }
        // These are about scripts: those of several packages, whatever this one has, or none.
        if matches!(
            arg,
            b"--workspaces" | b"--parallel" | b"--sequential" | b"--if-present"
        ) || arg.starts_with(b"--filter")
            || arg.starts_with(b"-F")
        {
            return true;
        }
        let given = match arg.strip_prefix(b"--cwd") {
            Some(b"") => args.next(),
            Some(rest) => rest.strip_prefix(b"="),
            None => None,
        };
        if let Some(given) = given {
            cwd = join_abs_string::<Auto>(&cwd, &[given]).to_vec();
        }
    }
    let Some((dir, path, contents)) = nearest_package_json(&cwd) else {
        return false;
    };
    // In that script, and in what it runs, it is the type checker: `"check": "bun check"`.
    let running = env_var::BUN_INTERNAL_CHECK_SCRIPTS::get();
    if running.is_some_and(|running| running_package_scripts(running).any(|it| it == dir)) {
        return false;
    }
    if package_of_inherited_check_script().is_some_and(|it| it == dir) {
        return false;
    }
    // Most have no such word in them.
    if !bun_core::strings::contains(&contents, b"\"check\"") {
        return false;
    }
    bun_ast::initialize_store();
    let source = bun_ast::Source::init_path_string(&path[..], &contents[..]);
    let (mut log, bump) = (bun_ast::Log::init(), bun_alloc::Arena::new());
    let Ok(json) = bun_parsers::json::parse_package_json_utf8(&source, &mut log, &bump) else {
        return false;
    };
    (json.as_property(b"scripts"))
        .and_then(|scripts| scripts.expr.as_property(b"check"))
        .is_some_and(|script| matches!(script.expr.data, bun_ast::ExprData::EString(_)))
}

/// The `package.json` nearest to `dir`, which is where `bun run` looks: its directory, its path and
/// its text.
fn nearest_package_json(mut dir: &[u8]) -> Option<(&[u8], Vec<u8>, Vec<u8>)> {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::{dirname, join_abs_string};
    loop {
        let path = join_abs_string::<Auto>(dir, &[b"package.json"]).to_vec();
        if let Ok(contents) = bun_sys::File::read_from(bun_core::Fd::cwd(), &path) {
            let dir = bun_core::strings::without_trailing_slash(dir);
            return Some((dir, path, contents));
        }
        let parent = dirname::<Auto>(dir);
        if parent.is_empty() || parent.len() >= dir.len() {
            return None;
        }
        dir = parent;
    }
}

/// The entries of `BUN_INTERNAL_CHECK_SCRIPTS`. Each is a length, `:` and as many bytes, since a
/// path can have any byte in it.
fn running_package_scripts(mut running: &[u8]) -> impl Iterator<Item = &[u8]> {
    core::iter::from_fn(move || {
        let colon = bun_core::strings::index_of_char_usize(running, b':')?;
        let len: usize = core::str::from_utf8(&running[..colon]).ok()?.parse().ok()?;
        let (entry, rest) = running[colon + 1..].split_at_checked(len)?;
        running = rest;
        Some(entry)
    })
}

/// `bun run check` runs all three.
fn is_check_script(name: &[u8]) -> bool {
    matches!(name, b"check" | b"precheck" | b"postcheck")
}

/// The directory of the package whose `check` script another package manager has started, with
/// this process in it. npm, pnpm and yarn say which script they run. Not all say of which package:
/// then it is the one that this process is started in, not each one whose scripts it runs.
fn package_of_inherited_check_script() -> Option<Vec<u8>> {
    use bun_paths::{platform::Auto, resolve_path::dirname};
    if !env_var::npm_lifecycle_event::get().is_some_and(is_check_script) {
        return None;
    }
    match env_var::npm_package_json::get() {
        Some(of) => Some(bun_core::strings::without_trailing_slash(dirname::<Auto>(of)).to_vec()),
        None if env_var::BUN_INTERNAL_CHECK_SCRIPTS::get().is_some() => None,
        None => Some(nearest_package_json(&working_directory())?.0.to_vec()),
    }
}

/// Makes `env` that of the script `name` of the package that has `dir`. See `is_package_script`.
pub(crate) fn note_package_script(env: &mut bun_dotenv::Loader, name: &[u8], dir: &[u8]) {
    use std::io::Write;
    let key = b"BUN_INTERNAL_CHECK_SCRIPTS";
    // As `is_package_script` finds it, wherever in the package the script is started.
    let Some((dir, ..)) = nearest_package_json(dir) else {
        return;
    };
    // `name` takes the place of what another package manager has said, for what the script runs.
    let inherited = package_of_inherited_check_script();
    let mut running = env.get(key).unwrap_or_default().to_vec();
    for dir in (inherited.as_deref().into_iter()).chain(is_check_script(name).then_some(dir)) {
        if !running_package_scripts(&running).any(|it| it == dir) {
            let _ = write!(running, "{}:", dir.len());
            running.extend_from_slice(dir);
        }
    }
    if !running.is_empty() {
        env.map.put(key, &running).unwrap_or_oom();
    }
}

/// `note_package_script` for as long as `with` takes: `env` is that of other scripts too.
pub(crate) fn with_package_script<R>(
    env: &mut bun_dotenv::Loader,
    name: &[u8],
    dir: &[u8],
    with: impl FnOnce(&mut bun_dotenv::Loader) -> R,
) -> R {
    let key = b"BUN_INTERNAL_CHECK_SCRIPTS";
    let before = env.get(key).map(<[u8]>::to_vec);
    note_package_script(env, name, dir);
    let result = with(env);
    match before {
        Some(before) => env.map.put(key, &before).unwrap_or_oom(),
        None => env.map.remove(key),
    }
    result
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
        build: command_line.is_some_and(|it| it.build),
        errors: command_line.map_or(&[][..], |it| &it.errors[..]),
        paths: entries.paths,
        are_entry_points: command_line.is_none(),
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
        checked: None,
        after_file: None,
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

    fn exec_with(options: &Options) -> ! {
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
            (bun_sema_driver::host::from_native(path), text)
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

/// The files of the bundle, `sources`, are not read again. The errors are added to `log`, which the
/// build reports like its own. It runs on the thread of the bundler.
fn check_for_build(checked: TypeChecked, log: &mut bun_ast::Log, shows_progress: bool) -> bool {
    let TypeChecked {
        cwd,
        tsconfig,
        conditions,
        loaders,
        entry_points,
        sources,
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
        return true;
    }
    let paths = Paths::EntryPoints(Entries {
        paths: &paths,
        script_kinds: &script_kinds,
        script_kinds_by_extension: &by_extension,
        conditions,
    });
    let then = |report| report;
    let report = match shows_progress {
        true => run(cwd, tsconfig, &paths, &[], 0, provided, then),
        false => run_quietly(cwd, tsconfig, &paths, &[], 0, None, provided, then),
    };
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
