//! `bun check` type-checks a TypeScript project. `bun run --check` and `bun test --check` call
//! [`check_before`]. `bun build --check` and `Bun.build({ check: true })` run the check during
//! bundling, after the bundler has read every file ([`check_for_build_command`],
//! [`check_for_bun_build`]).

use bstr::BStr;

use bun_bundler::options::{TypeChecked, loaders_from_transform_options};
use bun_clap as clap;
use bun_core::{Global, Output, ZStr, env_var};
use bun_sema_driver::format::{self, Layout, Style};
use bun_sema_driver::host::{AlreadyRead, BeforeRead, Provided};
use bun_sema_driver::{
    Category, CommandLine, CompilerOption, Diagnostic, FlagError, Progress, RejectedFlag, Report,
    Request, ScriptKind,
};
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;

#[path = "check_command/compile_check.rs"]
mod compile_check;
#[path = "check_command/declarations.rs"]
mod declarations;
#[path = "check_command/typed_files.rs"]
mod typed_files;

pub(crate) use declarations::{
    DeclarationFile, check_and_emit_declarations, take_declaration_files, take_module_types,
};
pub(crate) use typed_files::{
    CompilerOptions, TypedFilesRequest, WrittenJavaScript, typed_files_for_build,
    warn_about_skipped_typed_files, warn_unless_package_states,
};

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
    explain: Vec<&'static [u8]>,
    code_generation_flag: Option<&'static [u8]>,
    defines: Vec<&'static [u8]>,
    report_path: Option<&'static [u8]>,
    report_detail: Option<&'static [u8]>,
    trim: bool,
}

fn usage_error(args: core::fmt::Arguments<'_>) -> ! {
    Output::err_generic("{}", (args,));
    bun_core::note!("run 'bun check --help' for more information");
    Global::exit(1);
}

const PROJECT: &[clap::Param<clap::Help>] = &[clap::param!(
    "-p, --project/--tsconfig-override <path>  Path to a tsconfig.json or its directory"
)];
/// Only listed for `--help`. It's parsed as a compiler option.
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
        "--aot              Also report the errors <b>bun compile<r> would report for these entry points"
    ),
    clap::param!(
        "--explain <report>?...  With --aot: print a report. <b>guards<r> lists every type guard that can fail at run time"
    ),
    clap::param!(
        "--define <k=v>...  With --aot: substitute k with v while parsing, like <b>bun compile --define<r>"
    ),
    clap::param!("--disallow-code-generation-from-strings <level>?"),
    clap::param!("--aot-report <path>"),
    clap::param!("--aot-report-detail <detail>"),
    clap::param!("--trim"),
    clap::param!("--cwd <path>       Set the working directory"),
    // Handled by `script_or_command`.
    clap::param!(
        "--no-script        Run the type checker even if the project has a <b>check<r> script"
    ),
    clap::param!("-h, --help         Print this help menu"),
    // Accepted and ignored, since nothing is ever emitted. `--noEmit` is an ordinary compiler
    // option that the driver sets last.
    clap::param!("--no-emit"),
    clap::param!("<POS>..."),
];
pub(crate) const PARAMS: &[clap::Param<clap::Help>] = clap::concat_params!(PROJECT, PRETTY, OTHERS);
/// Compiler options aren't in the table. See `unknown_long_flags_are_positional`.
static TABLE: &clap::ConvertedTable =
    clap::comptime_table!(clap::concat_params!(PROJECT, OTHERS), cold);

/// True if `args` has `--build` in any form `clap` accepts: `--build`, `-b`, or a `b` in a group of
/// short flags before `p`, which takes a value.
fn has_build_flag(args: &[&ZStr]) -> bool {
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

/// `args` is everything after `check`.
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
        // The `ZBox` is a temporary so that it's freed before `exit`, which never returns.
        let directory = super::script_or_command::directory_of_cwd(cwd);
        let changed = bun_sys::chdir(&bun_core::ZBox::from_vec(directory));
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
        explain: parsed.options(b"--explain").to_vec(),
        code_generation_flag: parsed.option(b"--disallow-code-generation-from-strings"),
        defines: parsed.options(b"--define").to_vec(),
        report_path: parsed.option(b"--aot-report"),
        report_detail: parsed.option(b"--aot-report-detail"),
        trim: parsed.flag(b"--trim"),
        ..Default::default()
    };
    if !options.aot {
        compile_check::reject_flags_requiring_aot(&options);
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
    // Arguments before `check` belong to `bun`, like those from `BUN_OPTIONS`. Unknown flags there
    // are skipped, as in every other command.
    let positionals = parsed.positionals();
    let check = positionals.iter().position(|it| *it == b"check");
    let positionals = &positionals[check.map_or(0, |at| at + 1)..];
    // Everything after `--` is a path, even if it looks like a flag.
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
    command_line.build |= parsed.flag(b"--build") && has_build_flag(args);
    let projects = usize::from(command_line.project.is_some()) + command_line.paths.len();
    if command_line.build && projects > 1 {
        usage_error(format_args!("--build takes one project"));
    }
    options.pretty = match parsed.flag(b"--no-pretty") {
        true => Some(false),
        false => bun_sema_driver::tristate(&command_line.compiler_options, b"pretty"),
    };
    if options.aot {
        compile_check::check_arguments(&command_line);
    }
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
    // `Output`'s writers are per-thread state, and this thread isn't from Bun's pool.
    Output::Source::configure_thread_no_js();
    let initial_delay = Duration::from_millis(
        env_var::BUN_DEBUG_TEST_CHECK_PROGRESS_DELAY_MS
            .get()
            .unwrap_or(300),
    );
    let began = std::time::Instant::now();
    let mut tick = 0;
    while !is_done.load(Ordering::Acquire) {
        if began.elapsed() >= initial_delay {
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

/// The paths to check.
#[derive(Clone, Copy)]
enum Paths<'a> {
    /// `bun check`'s arguments.
    Arguments(&'a CommandLine),
    /// See `Request::are_entry_points`.
    EntryPoints(Entries<'a>),
}

/// See the `Request` fields with the same names.
#[derive(Clone, Copy, Default)]
struct Entries<'a> {
    paths: &'a [Vec<u8>],
    script_kinds: &'a [(Vec<u8>, ScriptKind)],
    script_kinds_by_extension: &'a [(Vec<u8>, ScriptKind)],
    conditions: &'a [Box<[u8]>],
}

fn run<R>(
    cwd: &[u8],
    project: Option<&[u8]>,
    paths: &Paths,
    compiler_options: &[CompilerOption],
    threads: usize,
    provided: Provided,
    then: impl FnOnce(Report) -> R,
) -> R {
    // Progress is only shown to an interactive user.
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
        let progress_thread = scope.spawn(|| show_progress(&progress, &is_done, &style));
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
                progress_thread.thread().unpark();
                // Wait until the progress line is erased before printing anything else.
                let _ = progress_thread.join();
                then(report)
            },
        )
    })
}

fn run_quietly<R>(
    cwd: &[u8],
    project: Option<&[u8]>,
    paths: &Paths,
    compiler_options: &[CompilerOption],
    threads: usize,
    progress: Option<&Progress>,
    provided: Provided,
    then: impl FnOnce(Report) -> R,
) -> R {
    let request = request(cwd, project, paths, compiler_options, threads, progress);
    bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), then)
}

/// Returns `provided` with `Provided::scripts_of_page` set.
fn with_pages(cwd: &[u8], provided: Provided) -> Provided {
    use bun_sema_driver::host::{from_native, to_native};
    // One thread at a time, because the first call initializes the `FileSystem` that the scanner
    // reads.
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
        listed_projects: None,
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
        order: 1,
        plan_options: bun_sema_driver::PlanOptions::default(),
        stops_like_tsc: true,
        uses_typescript_wording: false,
        after_file: None,
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
        // Callers that print a report override this with `Report::is_case_sensitive`.
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

/// True if `bun check --run-typescript-tests` exists. `test/cli/check/typescript-go/conformance.ts`
/// uses it. Release builds don't include it.
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

    /// `bun --check` without an entry point behaves like `bun check` without arguments. `bun` has
    /// already parsed its own arguments.
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
        if options.aot {
            compile_check::exec(options)
        }
        let (cwd, command_line) = (working_directory(), &options.command_line);
        // The closure returns the report so that it's never dropped. The process exits instead.
        let (exit_code, _report) = run(
            &cwd,
            command_line.project.as_deref(),
            &Paths::Arguments(command_line),
            &command_line.compiler_options,
            options.threads,
            // Only set here, because this function never returns.
            Provided {
                ends_the_process: true,
                ..Default::default()
            },
            |report| (print_report(&report, options, &cwd), report),
        );
        Global::exit(u32::from(exit_code));
    }
}

/// Prints the report. Returns the exit code.
fn print_report(report: &Report, options: &Options, cwd: &[u8]) -> u8 {
    let display_cwd = bun_sema_driver::host::from_native(cwd);
    // Errors go to stdout, like `tsc`'s. The summary goes to stderr.
    let mut out = Vec::new();
    format::write_diagnostics(
        &mut out,
        report,
        &Style {
            is_case_sensitive: report.is_case_sensitive,
            ..style_for(
                &display_cwd,
                options.pretty,
                Destination::stdout(),
                options.all,
            )
        },
    );
    let mut summary = Vec::new();
    format::write_summary(
        &mut summary,
        report,
        &Style {
            color: Output::enable_ansi_colors_stderr(),
            is_case_sensitive: report.is_case_sensitive,
            ..style_for(
                &display_cwd,
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
            "  {} files loaded in {:.1}ms, {} checked in {:.1}ms, {} queries, {} KB of stack at the most",
            report.files_loaded,
            report.load_time.as_secs_f64() * 1000.0,
            report.files_checked,
            report.check_time.as_secs_f64() * 1000.0,
            report.queries,
            report.deepest_stack / 1024,
        );
        if report.shared_parses > 0 {
            let _ = writeln!(
                summary,
                "  {} files parsed for all projects",
                report.shared_parses,
            );
        }
    }
    super::lint_command::print(&out, &summary, u8::from(!report.is_ok()))
}

/// A file or snippet that's about to run.
#[derive(Clone, Copy)]
pub(crate) struct EntryPoint<'a> {
    pub(crate) path: &'a [u8],
    /// The loader to use. `None` picks one from the file extension.
    pub(crate) loader: Option<bun_ast::Loader>,
    /// The source text if it isn't in a file (`-e` or stdin).
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

/// Type-checks `entry_points` and everything they import before they run. Returns true if there are
/// no errors. Errors go to stderr, so stdout stays the program's.
pub(crate) fn check_before(entry_points: &[EntryPoint], before_read: Option<BeforeRead>) -> bool {
    let cwd = working_directory();
    // `--loader`, `--conditions`
    let args = bun_options_types::context::try_get().map(|ctx| &ctx.args);
    let loaders = args.and_then(|args| args.loaders.as_ref());
    let loaders = loaders_from_transform_options(loaders, bun_ast::Target::Bun);
    let by_extension = script_kinds_by_extension(&loaders.unwrap_or_default());
    let Some((paths, script_kinds)) = paths_to_check(&cwd, entry_points, &by_extension) else {
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

/// Builds `Request::script_kinds_by_extension`: the extensions in `loaders` (which includes Bun's
/// defaults) whose loader differs from the language TypeScript infers from the extension.
fn script_kinds_by_extension(loaders: &bun_ast::LoaderHashTable) -> Vec<(Vec<u8>, ScriptKind)> {
    (loaders.iter())
        .filter_map(|(extension, &loader)| Some((extension, script_kind_of(loader)?)))
        .filter(|(extension, script_kind)| script_kind.differs_from_name(extension))
        .map(|(extension, script_kind)| (extension.to_vec(), script_kind))
        .collect()
}

/// True if `has_types`, or if `by_extension` lists the path's extension.
fn has_types_with(by_extension: &[(Vec<u8>, ScriptKind)], path: &[u8]) -> bool {
    let extension = bun_paths::extension(path);
    has_types(path) || by_extension.iter().any(|it| it.0 == extension)
}

/// `check_before`'s `before_read` under `--watch`. Registers each file with `vm`'s file watcher
/// before the check reads it, so a change during the check restarts the process just like a later
/// change. This covers every file outside `node_modules`, including type-only files and
/// configuration files. Returns `None` if there's no file watcher.
pub(crate) fn watching(vm: &bun_jsc::virtual_machine::VirtualMachine) -> Option<BeforeRead> {
    use bun_paths::{platform::Auto, resolve_path::join_abs_string};
    use bun_sema_driver::host::to_native;
    let (watch, cwd) = (vm.watcher_for_threads()?, working_directory());
    Some(Box::new(move |path| {
        if !bun_core::strings::contains(path, b"/node_modules/") {
            // The watcher keys files by their native path.
            watch(join_abs_string::<Auto>(&cwd, &[to_native(path)]));
        }
    }))
}

/// Converts `TypeChecked::sources`. A key in `Bun.build`'s `files` may be relative, and its value
/// may start with a byte order mark.
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

/// `BundleOptions::type_check` for `Bun.build({ check: true })`. Prints nothing.
pub(crate) fn check_for_bun_build(checked: TypeChecked, log: &mut bun_ast::Log) -> bool {
    check_for_build(checked, log, false)
}

/// Doesn't reread the bundle's files (`sources`). Adds the errors to `log`, which the build reports
/// like its own. Runs on the bundler's thread.
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
    // The bundler knows each file's loader. Files in `node_modules` always go by their extension.
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
    // Excludes files like `App.svelte`, which a plugin turns into TypeScript.
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
    for file in &report.incomplete {
        let path = bun_sema_driver::host::to_native(&file.path);
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("{}", BStr::new(&file.message(path))),
        );
    }
    report.is_ok()
}

/// The message, like `TS2322: Type 'string' is not assignable to type 'number'.`, with its
/// location.
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
        // A longer line is truncated, so the column may be past its end.
        (line.len() <= bun_sema_driver::MAX_SHOWN_LINE).then(|| Box::from(&line[..]))
    };
    bun_ast::Data {
        text: Cow::Owned(text),
        location: (!reported.path.is_empty()).then(|| bun_ast::Location {
            file: Box::from(bun_sema_driver::host::to_native(&reported.path)),
            line_text: line_text(),
            length: reported.end.saturating_sub(reported.start) as usize,
            offset: reported.start as usize,
            line: reported.line as i32,
            column: reported.column as i32,
            ..Default::default()
        }),
    }
}

/// Decides by the extension. Files that are neither TypeScript nor JavaScript, like stylesheets and
/// HTML pages, have no types to check.
pub(crate) fn has_types(path: &[u8]) -> bool {
    use bun_ast::Loader;
    Loader::from_string(bun_paths::extension(path)).is_some_and(Loader::is_javascript_like)
}

/// Returns the paths to check for `entry_points` (relative to `cwd`) and `Request::script_kinds`,
/// or `None` if no entry point has types to check.
fn paths_to_check(
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
            // An explicit loader overrides the extension.
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

/// The pages `bun` serves for the argument `page`. If `page` may be a glob, src/js/internal/html.ts
/// expands it with `new Bun.Glob(page).scanSync(cwd)`. Pages in `node_modules` are excluded.
fn pages_of(cwd: &[u8], page: &[u8]) -> Vec<Vec<u8>> {
    use bun_glob::{BunGlobWalker, walk};
    let mut pages = Vec::new();
    if !bun_core::strings::contains_any(page, b"*{") {
        pages.push(page.to_vec());
    } else if let Ok(Ok(mut walker)) =
        // `scanSync`'s defaults: files only.
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

/// Absolute paths of the local files that the HTML entry point `page` imports, found with the
/// bundler's HTML scanner. Empty if the page can't be read or parsed. The bundler reports that.
fn imports_of_page(cwd: &[u8], page: &[u8]) -> Vec<Vec<u8>> {
    use bun_paths::{platform::Auto, resolve_path};
    let page = resolve_path::join_abs_string::<Auto>(cwd, &[page]).to_vec();
    let Ok(contents) = bun_sys::File::read_from(bun_core::Fd::cwd(), &page) else {
        return Vec::new();
    };
    let source = bun_ast::Source::init_path_string(&page[..], &contents[..]);
    let mut log = bun_ast::Log::init();
    // The scanner resolves `/src/main.tsx` against `FileSystem`'s top-level directory, which
    // `bun ./index.html` hasn't initialized yet.
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

/// Type-checks the project containing the working directory, like `bun check`, before running one
/// of its scripts or `bun bake`'s app. For `before_read`, see `watching`.
#[inline(never)]
pub(crate) fn check_project_before(before_read: Option<BeforeRead>) -> bool {
    bun_removable_features::removable_definition!(Check, check_project_before);
    let provided = Provided {
        before_read,
        ..Default::default()
    };
    check_and_report(&Paths::EntryPoints(Entries::default()), provided)
}

/// `bun`'s `--tsconfig-override`. The runtime resolves with this tsconfig instead of any other.
fn tsconfig_override() -> Option<&'static [u8]> {
    bun_options_types::context::try_get()?
        .args
        .tsconfig_override
        .as_deref()
}

/// Returns true if there are no errors.
#[inline(never)]
fn check_and_report(paths: &Paths, provided: Provided) -> bool {
    bun_removable_features::removable_definition!(Check, check_and_report);
    let cwd = working_directory();
    let then = |report| report;
    let report = run(&cwd, tsconfig_override(), paths, &[], 0, provided, then);
    if report.diagnostics.is_empty() && report.incomplete.is_empty() {
        return report.is_ok();
    }
    let display_cwd = bun_sema_driver::host::from_native(&cwd);
    let style = Style {
        is_case_sensitive: report.is_case_sensitive,
        ..style_for(&display_cwd, None, Destination::stderr(), false)
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
