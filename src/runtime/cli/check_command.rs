//! `bun check`: type checks a TypeScript project. `bun run --check` and `bun test --check` go through [`check_before`].
//! `bun build --check` and `Bun.build({ check: true })` run the check inside the bundle, when the bundler has read every
//! file ([`check_for_build_command`], [`check_for_bun_build`]).

use bstr::BStr;

use bun_bundler::options::{DeclarationFiles, Declarations, EarlySources, PrintedReactCompilerOutputs, SKIPPED_SOUND_FILES, SoundFile, SoundFilesRequest, TypeChecked, TypedOutputs, loaders_from_transform_options};
use bun_clap as clap;
use bun_core::{Global, Output, ZStr, env_var};
use bun_sema_driver::format::{self, Layout, Style};
use bun_sema_driver::host::{AlreadyRead, BeforeRead, DeferredRead, DeferredSources, Provided};
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
    aot_rules: bun_aot::rules::Settings,
    aot_rule_flags: Vec<Box<[u8]>>,
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
    clap::param!("--aot-explain <word>?...  With <b>--aot<r>: list the places where the compiler cannot use your types, the most expensive first. <b>costs-json<r> prints them as JSON. <b>throws<r> lists every type check that can fail when the program runs"),
    clap::param!("--cwd <path>       Set the working directory"),
    // `script_or_command` reads it.
    clap::param!(
        "--no-script        Run the type checker even if the project has a <b>check<r> script"
    ),
    clap::param!("-h, --help         Print this help menu"),
    // Nothing is ever emitted. `--noEmit` is a compiler option like any other, which the driver sets last.
    clap::param!("--no-emit"),
    clap::param!("<POS>..."),
];
pub(crate) const PARAMS: &[clap::Param<clap::Help>] = clap::concat_params!(PROJECT, PRETTY, OTHERS, crate::cli::aot::RULE_PARAMS);
/// A compiler option is not in the table: see `unknown_long_flags_are_positional`.
static TABLE: &clap::ConvertedTable =
    clap::comptime_table!(clap::concat_params!(PROJECT, OTHERS, crate::cli::aot::RULE_PARAMS), cold);

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
fn parse(ctx: &mut crate::cli::command::ContextData, args: &[&ZStr]) -> Options {
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
    let rule_flags = crate::cli::aot::rule_flags(args.iter().map(|arg| arg.as_bytes()));
    if let Some(flag) = rule_flags.first().filter(|_| !options.aot) {
        usage_error(format_args!("{} requires --aot", BStr::new(bun_core::strings::split(flag, b"=").next().unwrap_or(flag))));
    }
    if options.aot
        && let Err(err) = bun_bunfig::load_config_for_tool(crate::cli::command::Tag::CheckCommand, crate::cli::lint_command::bunfig_before(b"check"), ctx, None)
    {
        Output::err(err, "failed to load bunfig", ());
        Global::exit(1);
    }
    let rule_flags = [std::mem::take(&mut ctx.bundler_options.aot_rules), rule_flags].concat();
    match crate::cli::aot::rule_settings(&rule_flags) {
        Ok(settings) => options.aot_rules = settings,
        Err(problem) => usage_error(format_args!("{problem}")),
    }
    options.aot_rule_flags = rule_flags;
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
    if CAN_EMIT_PROGRAM {
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
            bun_sema_driver::fs_queries::invalidate_recording();
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

const CAN_EMIT_PROGRAM: bool =
    bun_core::Environment::IS_CANARY || bun_core::Environment::IS_DEBUG;

impl CheckCommand {
    pub(crate) fn exec(ctx: &mut crate::cli::command::ContextData, args: &[&ZStr]) -> ! {
        if HAS_TYPESCRIPT_TEST_RUNNER
            && let [first, rest @ ..] = args
            && first.as_bytes() == b"--run-typescript-tests"
        {
            let rest: Vec<&[u8]> = rest.iter().map(|arg| arg.as_bytes()).collect();
            let passed = bun_sema_baselines::run_from_command_line(&rest);
            Global::exit(u32::from(!passed));
        }
        Self::exec_with(&parse(ctx, args))
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
        let mut more_code: Vec<Vec<u8>> = Vec::new();
        let typed_packages = bun_threading::Guarded::new(TypedPackages::default());
        loop {
            let missing = Self::check_aot(options, &more_code, &typed_packages);
            more_code.extend(missing);
        }
    }

    fn check_aot(options: &Options, more_code: &[Vec<u8>], typed_packages: &bun_threading::Guarded<TypedPackages>) -> Vec<Vec<u8>> {
        use bun_sema_driver::host::{from_argument, from_native};
        let (cwd, command_line) = (working_directory(), &options.command_line);
        if command_line.paths.is_empty() || command_line.build {
            usage_error(format_args!("--aot takes the entry points of a program"));
        }
        let constants = bun_aot::Constants { root: from_native(&cwd), logs_type_errors: options.logs_type_errors, leaves_decorators_to_the_bundler: options.aot_out.is_none(), ..Default::default() };
        let (mut code, mut provided) = (Vec::new(), Provided { without_builtin_modules: options.without_builtin_modules, is_without_bundler: true, ..Default::default() });
        for &(name, text) in bun_aot::prelude::FILES {
            let path = bun_aot::prelude::path_of(&cwd, name);
            provided.already_read.insert(from_native(&path), text.as_bytes().into());
            code.push(path);
        }
        code.extend(more_code.iter().cloned());
        let mut script_kinds: Vec<(Vec<u8>, ScriptKind)> = Vec::new();
        for (path, text, is_typescript) in &typed_packages.lock().laid {
            provided.already_read.insert(from_native(path), text.to_vec().into());
            script_kinds.extend(is_typescript.then(|| (path.to_vec(), ScriptKind::Ts)));
        }
        let missing: bun_threading::Guarded<Vec<Vec<u8>>> = bun_threading::Guarded::new(Vec::new());
        let said: bun_threading::Guarded<(Vec<String>, Vec<String>)> = bun_threading::Guarded::new(Default::default());
        let baseline_outcome = bun_threading::Guarded::new(None);
        let translation = bun_aot::Translation::new(&constants).explaining(explaining(&options.aot_explain)).enforcing(options.aot_rules.clone());
        let begin = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>| {
            let roots = command_line.paths.iter().filter_map(|path| program.files.by_path.get(&from_argument(&from_native(&cwd), path)));
            let mut entry_points: Vec<Vec<_>> = roots.map(|root| vec![root]).collect();
            entry_points.extend(typed_packages.lock().laid.iter().filter_map(|laid| program.files.by_path.get(&from_native(&laid.0))).map(|file| vec![file]));
            if options.aot_out.is_none() {
                for (index, module) in program.files.modules.iter().enumerate() {
                    if !module.hir.decorators.is_empty() && !program.files.lowers_decorators(bun_sema_driver::FileId(index as u32)) {
                        module.is_forced_untyped.store(true, core::sync::atomic::Ordering::Relaxed);
                    }
                }
            }
            translation.begin(program, &entry_points, in_parallel);
            let compiled_of_dependencies = (program.files.modules.iter().enumerate())
                .filter(|(index, module)| module.is_dependency && matches!(bun_paths::extension(module.file_name()), b".ts" | b".tsx" | b".mts" | b".cts") && !module.file_name().starts_with(b"/$bun/") && !bun_core::strings::contains(module.path.text, b"/.bun-aot-prelude/") && translation.is_compiled(bun_sema_driver::FileId(*index as u32)))
                .map(|(_, module)| bun_sema_driver::host::to_native(module.file_name()).to_vec());
            missing.lock().extend(compiled_of_dependencies.filter(|path| !more_code.contains(path)));
            if options.aot_out.is_none() {
                missing.lock().extend(typed_packages.lock().lay_those_of(&cwd, program.files.modules.iter().map(|module| bun_sema_driver::host::to_native(module.file_name()))));
            }
            if !missing.lock().is_empty() {
                program.give_up();
            }
        };
        let translate_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| translation.translate_file(checker, file);
        let record_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| translation.record_file(checker, file);
        let merge_notes = |program: &bun_sema_driver::Program| translation.merge_notes(program);
        let analyze = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>, errors: &[(bun_sema_driver::FileId, u32)]| {
            if !missing.lock().is_empty() {
                return vec![false; errors.len()];
            }
            let mut translated = translation.finish(program, in_parallel, errors);
            if let Some(path) = &options.aot_out
                && translated.problems.is_empty()
                && !translated.kept_errors.contains(&true)
            {
                let written = bun_aot::format::write_releasing(&mut translated.program, in_parallel);
                let _ = bun_sys::File::write_file(bun_sys::Fd::cwd(), &bun_core::ZBox::from_bytes(path), &written);
            }
            *said.lock() = (translated.explained, translated.problems);
            *TYPEDNESS_OF_LAST_BUILD.lock() = Some(translated.typedness);
            *baseline_outcome.lock() = program.rule_scopes.get().and_then(|scopes| scopes.baseline_outcome());
            bun_aot::release(translated.program, in_parallel);
            translated.kept_errors
        };
        let paths = Paths::EntryPoints(Entries { paths: &command_line.paths, script_kinds: &script_kinds, ..Default::default() });
        let request = Request {
            is_one_program: true,
            code: &code,
            loaded: Some(&begin),
            after_file: Some(&translate_file),
            before_visits: Some(&record_file),
            all_visited_once: Some(&merge_notes),
            compile: Some(&analyze),
            ..request(&cwd, command_line.project.as_deref(), &paths, &command_line.compiler_options, options.threads, None)
        };
        let report = bun_sema_driver::check_provided_then(&request, with_pages(&cwd, provided), |report| report);
        let missing = core::mem::take(&mut *missing.lock());
        if !missing.is_empty() {
            return missing;
        }
        print_explained(&typed_packages.lock().said);
        let said = said.lock();
        print_explained(&said.0);
        if explaining(&options.aot_explain).rules_json {
            print_explained(&format::rule_findings_as_json(&report, &from_native(&cwd)));
        }
        for problem in &said.1 {
            Output::err_generic("{}", (problem,));
        }
        if report.is_ok() && !said.1.is_empty() {
            Global::exit(1);
        }
        if report.is_ok() {
            crate::cli::aot::finish_baseline(&options.aot_rule_flags, baseline_outcome.lock().take());
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
    if let Some(line) = take_typedness_line().filter(|_| report.is_ok()) {
        summary.extend_from_slice(line.as_bytes());
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

fn absolute_source_path<'a>(cwd: &'a [u8], path: &'a [u8]) -> &'a [u8] {
    let is_relative_to_a_drive_only = cfg!(windows) && path.starts_with(b"/");
    match is_relative_to_a_drive_only {
        true => path,
        false => bun_paths::resolve_path::join_abs_string::<bun_paths::platform::Auto>(cwd, &[path]),
    }
}

/// `sources` of `bun_bundler::options::TypeCheck`. A key of `files` of `Bun.build` may be relative,
/// and its value may start with a byte order mark.
fn already_read(cwd: &[u8], sources: &mut dyn Iterator<Item = (&[u8], &[u8])>) -> AlreadyRead {
    use bun_core::strings::without_utf8_bom;
    sources
        .map(|(path, text)| {
            let path = absolute_source_path(cwd, path);
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
    sources
        .map(|(path, text)| {
            let path = absolute_source_path(cwd, path);
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

type ReceivedRequest<'c, 'i, 'l> = (TypeChecked<'c, 'i>, &'l mut bun_ast::Log);
type HandedRequest = ReceivedRequest<'static, 'static, 'static>;

struct EarlyStart {
    sources: std::sync::Arc<EarlySources>,
    printed_react_compiler_outputs: PrintedReactCompilerOutputs,
    preserve_source_paths: bool,
}

enum AnalysisMessage {
    EarlyStart(EarlyStart),
    Request(Box<Handed<HandedRequest>>),
}

struct EarlyAnalysis {
    message_sender: Option<std::sync::mpsc::Sender<AnalysisMessage>>,
    result_receiver: std::sync::mpsc::Receiver<Handed<Option<bun_ast::type_tags::ProgramFacts>>>,
    is_cancelled: std::sync::Arc<AtomicBool>,
    is_scan_cancelled: std::sync::Arc<AtomicBool>,
    shared_directory_cache: std::sync::Arc<bun_sema_driver::host::SharedDirectoryCache>,
    has_started_early: AtomicBool,
    is_early_load_abandoned: std::sync::Arc<AtomicBool>,
}

impl EarlyAnalysis {
    fn stop_early_passes(&self) {
        self.is_cancelled.store(true, Ordering::Relaxed);
        self.is_scan_cancelled.store(true, Ordering::Relaxed);
        bun_resolver::fs::set_directory_listing_source(None);
    }
}

impl Drop for EarlyAnalysis {
    fn drop(&mut self) {
        self.stop_early_passes();
        self.is_early_load_abandoned.store(self.message_sender.is_some(), Ordering::Relaxed);
        if self.message_sender.take().is_some() && self.has_started_early.load(Ordering::Relaxed) {
            let _ = self.result_receiver.recv();
        }
    }
}

struct SharedListings(std::sync::Arc<bun_sema_driver::host::SharedDirectoryCache>);

impl bun_resolver::fs::DirectoryListingSource for SharedListings {
    fn list(&self, path: &[u8]) -> Option<Vec<(Vec<u8>, bun_sys::FileKind)>> {
        self.0.entries(path)
    }
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_runtime_start_early_analysis(
    cwd: &[u8],
    tsconfig: Option<&[u8]>,
    conditions: &[Box<[u8]>],
    loaders: &bun_ast::LoaderHashTable,
    entry_points: &[&[u8]],
) -> (bun_bundler::options::EarlyAnalysis, std::sync::mpsc::Sender<(Vec<u8>, Option<&'static [u8]>)>) {
    let (cwd, tsconfig, conditions) = (cwd.to_vec(), tsconfig.map(<[u8]>::to_vec), conditions.to_vec());
    let by_extension = script_kinds_by_extension(loaders);
    let paths: Vec<Vec<u8>> = entry_points.iter().filter(|path| has_types_with(&by_extension, path)).map(|path| path.to_vec()).collect();
    let (message_sender, message_receiver) = std::sync::mpsc::channel::<AnalysisMessage>();
    let (result_sender, result_receiver) = std::sync::mpsc::channel();
    let (path_sender, path_receiver) = std::sync::mpsc::channel::<(Vec<u8>, Option<&'static [u8]>)>();
    let (is_cancelled, is_scan_cancelled) = (std::sync::Arc::new(AtomicBool::new(false)), std::sync::Arc::new(AtomicBool::new(false)));
    let early_parse_cancelled = Some(std::sync::Arc::clone(&is_cancelled));
    let early_scan_cancelled = Some(std::sync::Arc::clone(&is_scan_cancelled));
    let shared_directory_cache = std::sync::Arc::new(bun_sema_driver::host::SharedDirectoryCache::default());
    let (cache_of_thread, cache_of_bundler) = (std::sync::Arc::clone(&shared_directory_cache), std::sync::Arc::clone(&shared_directory_cache));
    let is_early_load_abandoned = std::sync::Arc::new(AtomicBool::new(false));
    let is_load_abandoned = std::sync::Arc::clone(&is_early_load_abandoned);
    bun_resolver::fs::set_directory_listing_source(Some(std::sync::Arc::new(SharedListings(std::sync::Arc::clone(&shared_directory_cache)))));
    std::thread::Builder::new()
        .stack_size(64 << 20)
        .spawn(move || {
            bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Analyze"));
            bun_sema_driver::with_early_run(&shared_directory_cache, |run| {
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
                    let early_parse = std::cell::RefCell::new(early_parse);
                    let wait_for_early_parse = || {
                        if let Some(early_parse) = early_parse.borrow_mut().take() {
                            let _ = early_parse.join();
                        }
                    };
                    let wait_for_early_parse_pause = || {
                        while !cache_of_thread.is_early_parse_paused() && early_parse.borrow().as_ref().is_some_and(|early_parse| !early_parse.is_finished()) {
                            std::thread::sleep(Duration::from_micros(100));
                        }
                    };
                    let early = Some((run, &wait_for_early_parse as &dyn Fn()));
                    let mut is_restarted = false;
                    let request = match message_receiver.recv() {
                        Ok(AnalysisMessage::Request(handed)) => Some(handed.take()),
                        Ok(AnalysisMessage::EarlyStart(start)) => {
                            let settings = AnalysisSettings {
                                cwd: &cwd,
                                tsconfig: tsconfig.as_deref(),
                                conditions: &conditions,
                                by_extension: &by_extension,
                                rewrite_jest_for_tests: false,
                                preserve_source_paths: start.preserve_source_paths,
                                is_restarted: false,
                            };
                            let is_received = std::cell::Cell::new(false);
                            let next_request = || {
                                cache_of_thread.resume_early_parse();
                                let request = message_receiver.recv();
                                wait_for_early_parse();
                                match request {
                                    Ok(AnalysisMessage::Request(handed)) => {
                                        is_received.set(true);
                                        Some(handed.take())
                                    }
                                    _ => None,
                                }
                            };
                            let paused = Some((run, &wait_for_early_parse_pause as &dyn Fn()));
                            match analyze_sources(&settings, &start.sources, start.printed_react_compiler_outputs, PendingRequest::Awaited(&next_request, is_load_abandoned), paused) {
                                Analyzed::Superseded(request) => {
                                    is_restarted = true;
                                    Some(*request)
                                }
                                Analyzed::Finished(found) => {
                                    let unanswered = if is_received.get() { None } else { next_request() };
                                    is_restarted = unanswered.as_ref().is_some_and(|request| request.0.early_sources.is_some());
                                    if is_received.get() && !is_restarted {
                                        bun_core::Output::flush();
                                        let _ = result_sender.send(Handed(found));
                                    }
                                    unanswered.filter(|_| is_restarted)
                                }
                            }
                        }
                        Err(_) => None,
                    };
                    if let Some((checked, log)) = request {
                        let found = analyze_on_this_thread(checked, log, early, is_restarted);
                        bun_core::Output::flush();
                        let _ = result_sender.send(Handed(found));
                    }
                });
            });
        })
        .expect("failed to spawn the analysis thread");
    (Box::new(EarlyAnalysis { message_sender: Some(message_sender), result_receiver, is_cancelled, is_scan_cancelled, shared_directory_cache: cache_of_bundler, has_started_early: AtomicBool::new(false), is_early_load_abandoned }), path_sender)
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_runtime_analyze_early_sources(
    early_analysis: &bun_bundler::options::EarlyAnalysis,
    sources: std::sync::Arc<EarlySources>,
    printed_react_compiler_outputs: PrintedReactCompilerOutputs,
    preserve_source_paths: bool,
) -> bool {
    let Some(early) = early_analysis.downcast_ref::<EarlyAnalysis>() else { return false };
    let Some(message_sender) = early.message_sender.as_ref().filter(|_| bun_core::env_var::BUN_AOT_TYPED_SNAPSHOT.get().is_none()) else { return false };
    early.is_scan_cancelled.store(true, Ordering::Relaxed);
    early.shared_directory_cache.request_early_parse_pause();
    let has_started = message_sender.send(AnalysisMessage::EarlyStart(EarlyStart { sources, printed_react_compiler_outputs, preserve_source_paths })).is_ok();
    early.has_started_early.store(has_started, Ordering::Relaxed);
    has_started
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
    if let Some(mut early) = checked.early_analysis.take().and_then(|early| early.downcast::<EarlyAnalysis>().ok()) {
        let is_superseding = checked.early_sources.is_some();
        // SAFETY: only the lifetimes change. This function returns after the analysis thread has answered, and that thread answers
        // after `analyze_on_this_thread` has consumed `checked` and made its last use of `log`.
        let handed = unsafe { core::mem::transmute::<(TypeChecked<'_, '_>, &mut bun_ast::Log), HandedRequest>((checked, log)) };
        early.stop_early_passes();
        early.is_early_load_abandoned.store(is_superseding, Ordering::Relaxed);
        let message_sender = early.message_sender.take().expect("the analysis is asked for once");
        message_sender.send(AnalysisMessage::Request(Box::new(Handed(handed)))).expect("the analysis thread exited early");
        return early.result_receiver.recv().expect("the analysis thread exited without a result").take();
    }
    // `Bun.build` bundles on a thread of its own, which has less stack than a task of the checker asks for.
    if bun_core::StackCheck::init().remaining() >= 8 << 20 {
        return analyze_on_this_thread(checked, log, None, false);
    }
    let handed = Handed((checked, log));
    let analyzed = std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(64 << 20)
            .spawn_scoped(scope, move || {
                bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Analyze"));
                let (checked, log) = handed.take();
                let found = analyze_on_this_thread(checked, log, None, false);
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

#[derive(Clone, Copy)]
struct AnalysisSettings<'a> {
    cwd: &'a [u8],
    tsconfig: Option<&'a [u8]>,
    conditions: &'a [Box<[u8]>],
    by_extension: &'a [(Vec<u8>, ScriptKind)],
    rewrite_jest_for_tests: bool,
    preserve_source_paths: bool,
    is_restarted: bool,
}

enum PendingRequest<'a, 'c, 'i, 'l> {
    Received(Box<ReceivedRequest<'c, 'i, 'l>>),
    Awaited(&'a dyn Fn() -> Option<ReceivedRequest<'c, 'i, 'l>>, std::sync::Arc<AtomicBool>),
}

enum Analyzed<'c, 'i, 'l> {
    Finished(Option<bun_ast::type_tags::ProgramFacts>),
    Superseded(Box<ReceivedRequest<'c, 'i, 'l>>),
}

fn analyze_on_this_thread(
    mut checked: TypeChecked,
    log: &mut bun_ast::Log,
    early: Option<(bun_sema_driver::EarlyRun, &dyn Fn())>,
    is_restarted: bool,
) -> Option<bun_ast::type_tags::ProgramFacts> {
    let (early_sources, printed_react_compiler_outputs) = checked.early_sources.take()?;
    let by_extension = script_kinds_by_extension(checked.loaders);
    let settings = AnalysisSettings {
        cwd: checked.cwd,
        tsconfig: checked.tsconfig,
        conditions: checked.conditions,
        by_extension: &by_extension,
        rewrite_jest_for_tests: checked.rewrite_jest_for_tests,
        preserve_source_paths: checked.preserve_source_paths,
        is_restarted,
    };
    match analyze_sources(&settings, &early_sources, printed_react_compiler_outputs, PendingRequest::Received(Box::new((checked, log))), early) {
        Analyzed::Finished(found) => found,
        Analyzed::Superseded(_) => None,
    }
}

#[derive(Default)]
struct TypedPackages {
    visited: Vec<Vec<u8>>,
    laid: bun_sema_driver::typed_packages::Files,
    said: Vec<String>,
}

impl TypedPackages {
    fn lay_those_of<'a>(&mut self, cwd: &[u8], paths: impl Iterator<Item = &'a [u8]>) -> Vec<Vec<u8>> {
        let installed: &[u8] = if cfg!(windows) { b"\\node_modules\\" } else { b"/node_modules/" };
        let laid_before = self.laid.len();
        for path in paths {
            let Some(at) = bun_core::strings::last_index_of(path, installed).map(|at| at + installed.len()) else { continue };
            let mut parts = path[at..].split(|&byte| byte == std::path::MAIN_SEPARATOR as u8);
            let Some(first) = parts.next() else { continue };
            let length = match (first.starts_with(b"@"), parts.next()) {
                (true, Some(second)) => first.len() + 1 + second.len(),
                _ => first.len(),
            };
            let declared = path[at..at + length].strip_prefix(b"@types").map(|declared| &declared[1..]);
            let name = match declared.map(|declared| (declared, bun_core::strings::index_of(declared, b"__"))) {
                Some((declared, Some(scope))) => [&b"@"[..], &declared[..scope], &[std::path::MAIN_SEPARATOR as u8][..], &declared[scope + 2..]].concat(),
                Some((declared, None)) => declared.to_vec(),
                None => path[at..at + length].to_vec(),
            };
            let directory = [&path[..at], &name[..]].concat();
            let (directory, name) = (&directory[..], &name[..]);
            if self.visited.iter().any(|visited| visited == directory) {
                continue;
            }
            self.visited.push(directory.to_vec());
            let (files, said) = bun_sema_driver::typed_packages::typed_package_under_any_defines(cwd, directory, name);
            self.said.extend(said.map(|said| format!("{}: {said}", if files.is_empty() { "warn" } else { "note" })));
            self.laid.extend(files);
        }
        self.laid[laid_before..].iter().map(|laid| laid.0.to_vec()).collect()
    }
}

struct LoweredCode {
    code_of: bun_sema_driver::FxHashMap<Vec<u8>, Vec<u8>>,
    known_paths: bun_sema_driver::FxHashSet<Vec<u8>>,
    not_printed: std::sync::Arc<bun_threading::Guarded<Vec<Vec<u8>>>>,
}

impl LoweredCode {
    /// `TypeChecked::react_compiler_outputs`: the code is under a path of its own. What is written is no code any more, so no root by that: it is
    /// checked in its own right.
    fn replace(
        &mut self,
        lowered: &mut dyn Iterator<Item = &[u8]>,
        printed: PrintedReactCompilerOutputs,
        code: &mut [Vec<u8>],
        paths: &mut Vec<Vec<u8>>,
        already_read: &mut AlreadyRead,
    ) -> Option<DeferredRead> {
        use bun_sema_driver::host::from_native;
        let mut code_positions: bun_sema_driver::FxHashMap<Vec<u8>, Vec<usize>> = Default::default();
        for (place, known) in code.iter().enumerate() {
            code_positions.entry(known.clone()).or_default().push(place);
        }
        let mut printed_as: Vec<Vec<u8>> = Vec::new();
        for path in lowered {
            let elsewhere = [path, b".js"].concat();
            already_read.insert(from_native(&elsewhere), std::borrow::Cow::Borrowed(&[]));
            printed_as.push(from_native(&elsewhere));
            if let Some(places) = code_positions.remove(path) {
                for &place in &places {
                    code[place].clone_from(&elsewhere);
                }
                code_positions.entry(elsewhere.clone()).or_default().extend(places);
            }
            if self.known_paths.insert(path.to_vec()) {
                paths.push(path.to_vec());
            }
            self.code_of.insert(from_native(path), from_native(&elsewhere));
        }
        let not_printed = std::sync::Arc::clone(&self.not_printed);
        (!printed_as.is_empty()).then(|| -> DeferredRead {
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
        })
    }
}

struct CompleteRequest {
    constants: bun_aot::Constants,
    function_source_printing: std::sync::Arc<bun_threading::thread_pool::DeferredStart>,
    has_late_strings: bool,
    explain_to_log: bool,
    explains_plugins: bool,
    explains_rules_as_json: bool,
    rule_flags: Vec<Box<[u8]>>,
    deferred_source_count: usize,
}

fn analyze_sources<'c, 'i, 'l>(
    settings: &AnalysisSettings<'_>,
    early_sources: &EarlySources,
    printed_early_react_compiler_outputs: PrintedReactCompilerOutputs,
    pending_request: PendingRequest<'_, 'c, 'i, 'l>,
    early: Option<(bun_sema_driver::EarlyRun, &dyn Fn())>,
) -> Analyzed<'c, 'i, 'l> {
    use bun_sema_driver::host::from_native;
    let AnalysisSettings { cwd, tsconfig, conditions, by_extension, rewrite_jest_for_tests, preserve_source_paths, is_restarted } = *settings;
    let is_started_early = matches!(pending_request, PendingRequest::Awaited(..));
    let jsx_options_of = |path: &[u8], of_file: bun_bundler::options::FileJsxOptions<'_>| {
        let of_file = bun_sema_driver::host::FileJsxOptions {
            is_classic: of_file.is_classic,
            factory: of_file.factory.to_vec(),
            fragment: of_file.fragment.to_vec(),
            import_source: of_file.import_source.to_vec(),
            overrides_pragmas: of_file.overrides_pragmas,
        };
        (path.to_vec(), of_file)
    };
    let class_options_of = |path: &[u8], of_file: bun_bundler::options::FileClassOptions| {
        let of_file = bun_sema_driver::host::ClassOptions {
            use_define_for_class_fields: of_file.use_define_for_class_fields,
            experimental_decorators: of_file.experimental_decorators,
            emit_decorator_metadata: of_file.emit_decorator_metadata,
        };
        (path.to_vec(), of_file)
    };
    let mut script_kinds: Vec<(Vec<u8>, ScriptKind)> = Vec::new();
    // `Request::code`
    let mut code: Vec<Vec<u8>> = Vec::new();
    let mut sources = early_sources.sources.iter().map(|source| {
        let script_kind = script_kind_of(source.loader).filter(|it| it.differs_from_name(&source.path));
        script_kinds.extend(script_kind.map(|it| (source.path.to_vec(), it)));
        code.push(source.path.to_vec());
        (&source.path[..], &source.text[..])
    });
    let mut provided = Provided {
        // SAFETY: the bundler keeps them in place until the analysis has answered or `EarlyAnalysis` is dropped, which waits for this
        // thread. The host that gets the map, the programs that read from it and the report all end in this function.
        already_read: unsafe { already_read_in_place(cwd, &mut sources) },
        file_jsx_options: early_sources.jsx.iter().map(|(path, of_file)| jsx_options_of(path, of_file.borrowed())).collect(),
        file_class_options: early_sources.classes.iter().map(|(path, of_file)| class_options_of(path, *of_file)).collect(),
        preserves_source_paths: preserve_source_paths,
        code_kinds: early_sources.kinds.iter().map(|(path, is_commonjs)| (path.to_vec(), *is_commonjs)).collect(),
        import_constants: early_sources.constant_imports.iter().map(|[from, specifier, to]| ((from_native(from), specifier.to_vec()), from_native(to))).collect(),
        deferred_imports: early_sources.deferred_imports.iter().map(|[from, specifier]| (from.to_vec(), specifier.to_vec())).collect(),
        deferred_paths: early_sources.deferred_paths.iter().map(|path| path.to_vec()).collect(),
        ..Default::default()
    };
    for &(name, text) in bun_aot::prelude::FILES {
        let path = bun_aot::prelude::path_of(cwd, name);
        provided.already_read.insert(from_native(&path), text.as_bytes().into());
        code.push(path);
    }
    let mut paths: Vec<Vec<u8>> = (early_sources.entry_points.iter().map(|path| &path[..]))
        .filter(|path| has_types_with(by_extension, path) || script_kinds.iter().any(|it| it.0 == **path))
        .map(<[u8]>::to_vec)
        .collect();
    if paths.is_empty() {
        return Analyzed::Finished(None);
    }
    if rewrite_jest_for_tests {
        let path = bun_aot::prelude::path_of(cwd, "test-globals.d.ts");
        provided.already_read.insert(from_native(&path), test_runner_declarations().into());
        paths.push(path);
    }
    let mut lowered_code = LoweredCode { code_of: Default::default(), known_paths: paths.iter().cloned().collect(), not_printed: Default::default() };
    let not_printed = std::sync::Arc::clone(&lowered_code.not_printed);
    provided.deferred_read = lowered_code.replace(
        &mut early_sources.react_compiler_paths.iter().map(|path| &path[..]),
        printed_early_react_compiler_outputs,
        &mut code,
        &mut paths,
        &mut provided.already_read,
    );
    for [from, specifier] in &early_sources.deferred_imports {
        if let Some(elsewhere) = lowered_code.code_of.get(&from_native(from)) {
            provided.deferred_imports.push((elsewhere.clone(), specifier.to_vec()));
        }
    }
    // What one entry function runs: an entry point of the bundle, then what `bun:main` does once that has run.
    let mut entry_functions: Vec<[Vec<u8>; 2]> = Vec::new();
    let mut entry_function_names: Vec<Vec<u8>> = Vec::new();
    let mut imports_of_entry_functions: Vec<[Vec<u8>; 3]> = Vec::new();
    for entry_point in early_sources.own_entry_points.iter().map(|path| &path[..]).filter(|path| paths.iter().any(|it| it == path)) {
        let name = match entry_functions.len() {
            0 => "main.js".to_owned(),
            number => format!("main.{number}.js"),
        };
        let main = bun_aot::prelude::path_of(cwd, &name);
        let mut wrapper = bun_bundler::entry_points::ServerEntryPoint::default();
        if bun_bundler::entry_points::ServerEntryPoint::generate(&mut wrapper, false, entry_point).is_err() {
            return Analyzed::Finished(None);
        }
        provided.already_read.insert(from_native(&main), wrapper.contents.into_vec().into());
        code.push(main.clone());
        let to = from_native(entry_point);
        let replaced = lowered_code.code_of.get(&to).cloned();
        let root = if replaced.is_some() { [entry_point, b".js"].concat() } else { entry_point.to_vec() };
        imports_of_entry_functions.push([from_native(&main), entry_point.to_vec(), replaced.unwrap_or(to)]);
        entry_functions.push([root, main]);
        entry_function_names.push(entry_point.to_vec());
    }
    if entry_functions.is_empty() {
        return Analyzed::Finished(None);
    }
    let complete_request: std::sync::OnceLock<CompleteRequest> = std::sync::OnceLock::new();
    let translation: std::sync::OnceLock<bun_aot::Translation<'_>> = std::sync::OnceLock::new();
    let received_log: bun_threading::Guarded<Option<Handed<&'l mut bun_ast::Log>>> = bun_threading::Guarded::new(None);
    let superseding_request: bun_threading::Guarded<Option<Handed<ReceivedRequest<'c, 'i, 'l>>>> = bun_threading::Guarded::new(None);
    let (complete_request_cell, translation_cell, early_script_kinds) = (&complete_request, &translation, &script_kinds);
    let mut complete = |checked: TypeChecked<'c, 'i>, log: &'l mut bun_ast::Log| -> DeferredSources {
        let TypeChecked {
            cwd: _,
            tsconfig: _,
            conditions: _,
            loaders: _,
            entry_points,
            own_entry_points: _,
            sources,
            imports,
            dropped_imports,
            side_effect_free_files,
            lifted_commonjs,
            kinds,
            statements,
            texts,
            assets,
            has_late_strings,
            defines,
            features,
            rewrite_jest_for_tests: _,
            ignore_dce_annotations,
            jsx_side_effects,
            minify_syntax,
            minifies_identifiers,
            preserve_source_paths: _,
            react_compiler_outputs,
            jsx,
            classes,
            function_sources,
            function_source_printing,
            explain,
            explain_to_log,
            rules,
            logs_type_errors,
            early_analysis: _,
            early_sources: _,
            release_asts,
        } = checked;
        let file_url = |path: &[u8]| {
            let (path, query) = path.split_at(bun_core::strings::index_of_char_usize(path, b'?').unwrap_or(path.len()));
            let mut url = format!("{}", bun_url::file_url_from_string(&bun_core::String::from_bytes(path))).into_bytes();
            url.extend_from_slice(query);
            url
        };
        let mut deferred = DeferredSources::default();
        let mut sources = sources.map(|(path, text, loader)| {
            let script_kind = script_kind_of(loader).filter(|it| it.differs_from_name(path));
            deferred.script_kinds.extend(script_kind.map(|it| (path.to_vec(), it)));
            deferred.code.push(path.to_vec());
            (path, text)
        });
        let (imports, statements) = (Handed(imports), Handed(statements));
        let (resolved, statements_by_file, preloaded_sources) = std::thread::scope(|scope| {
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
                let mut file_statements: Option<(&[u8], Vec<(u32, bool)>)> = None;
                for (path, start, verdict) in statements {
                    match &mut file_statements {
                        Some((known, list)) if core::ptr::eq(*known, path) => list.push((start, verdict)),
                        _ => {
                            if let Some((known, mut list)) = file_statements.replace((path, vec![(start, verdict)])) {
                                statements_by_file.entry(from_native(known)).or_default().append(&mut list);
                            }
                        }
                    }
                }
                if let Some((known, mut list)) = file_statements {
                    statements_by_file.entry(from_native(known)).or_default().append(&mut list);
                }
                statements_by_file
            });
            // SAFETY: they are the bundler's, which waits for the analysis to return. The host that gets the map, the programs that read
            // from it and the report all end in `analyze_sources`.
            let preloaded_sources = unsafe { already_read_in_place(cwd, &mut sources) };
            let resolved = resolved.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic));
            let statements_by_file = statements_by_file.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic));
            (resolved, statements_by_file, preloaded_sources)
        });
        deferred.already_read = preloaded_sources;
        let mut constants = bun_aot::Constants {
            leaves_decorators_to_the_bundler: false,
            logs_type_errors,
            records_spans: false,
            has_preloads: false,
            source_path_to_url: preserve_source_paths.then_some(file_url as fn(&[u8]) -> Vec<u8>),
            has_test_globals: rewrite_jest_for_tests,
            ignores_dce_annotations: ignore_dce_annotations,
            jsx_has_side_effects: jsx_side_effects,
            minifies_syntax: minify_syntax || preserve_source_paths,
            minifies_identifiers,
            root: from_native(cwd),
            defines: defines.iter().map(|(name, value)| (name.to_vec(), value.to_vec())).collect(),
            features: features.map(<[u8]>::to_vec).collect(),
            resolved: Some(resolved),
            dropped_imports: dropped_imports.map(|(from, spec)| (from_native(from), spec.to_vec())).collect(),
            side_effect_free_files: side_effect_free_files.map(from_native).collect(),
            lifted_commonjs: lifted_commonjs.map(from_native).collect(),
            statements: statements_by_file,
            texts: texts.map(|(path, text)| (from_native(path), text.to_vec())).collect(),
            assets: assets.map(|(path, key)| (from_native(path), key.to_vec())).collect(),
            function_sources: function_sources.map(|later| -> Box<dyn Fn() -> bun_aot::FunctionSources + Send + Sync> {
                let later = bun_threading::Guarded::new(later);
                Box::new(move || {
                    let later = later.lock();
                    let texts: bun_aot::FunctionSources = ((0..later.list_count).filter_map(|_| later.printed.recv().ok()).flatten())
                        .map(|(path, printed, ranges)| (from_native(&path), (printed.into_vec(), ranges.iter().map(|it| (it.key as u32, it.start as u32, it.end as u32)).collect())))
                        .collect();
                    texts
                })
            }),
        };
        deferred.code_kinds = kinds.map(|(path, is_commonjs)| (path.to_vec(), is_commonjs)).collect();
        deferred.file_jsx_options = jsx.map(|(path, of_file)| jsx_options_of(path, of_file)).collect();
        deferred.file_class_options = classes.map(|(path, of_file)| class_options_of(path, of_file)).collect();
        release_asts();
        deferred.build_constants = Some(constants.build_constants());
        if let Some(resolved) = &constants.resolved {
            let is_constant: Vec<bool> = resolved.paths().iter().map(|to| to.ends_with(b".text.json") || to.ends_with(b".file.json")).collect();
            deferred.import_constants = (resolved.by_number())
                .filter(|import| is_constant[import.2 as usize])
                .map(|(from, specifier, to)| ((resolved.path(from).to_vec(), specifier.to_vec()), resolved.path(to).to_vec()))
                .collect();
        }
        deferred.paths = (entry_points.filter(|path| has_types_with(by_extension, path) || early_script_kinds.iter().chain(&deferred.script_kinds).any(|it| it.0 == **path)))
            .map(<[u8]>::to_vec)
            .collect();
        lowered_code.known_paths.extend(deferred.paths.iter().cloned());
        let bun_bundler::options::DeferredReactCompilerOutputs { printed, paths: lowered } = react_compiler_outputs;
        deferred.deferred_read = lowered_code.replace(&mut lowered.into_iter(), printed, &mut deferred.code, &mut deferred.paths, &mut deferred.already_read);
        if let Some(resolved) = &mut constants.resolved {
            let written: Vec<Vec<u8>> = resolved.paths().to_vec();
            let elsewhere: Vec<Option<u32>> = written.iter().map(|path| lowered_code.code_of.get(path).map(|elsewhere| resolved.number_of(elsewhere))).collect();
            let own: Vec<(u32, Vec<u8>, u32)> = (resolved.by_number())
                .filter_map(|(from, specifier, to)| Some((elsewhere[from as usize]?, specifier.to_vec(), to)))
                .collect();
            for (from, specifier, to) in own {
                resolved.insert(from, &specifier, to);
            }
            resolved.retarget(&elsewhere);
            for [from, specifier, to] in &imports_of_entry_functions {
                let [from, to] = [from, to].map(|path| resolved.number_of(path));
                resolved.insert(from, specifier, to);
            }
        }
        let explain = explaining(explain);
        let deferred_source_count = deferred.code.len();
        let complete_request = complete_request_cell.get_or_init(|| CompleteRequest { constants, function_source_printing, has_late_strings, explain_to_log, explains_plugins: explain.plugins, explains_rules_as_json: explain.rules_json, rule_flags: rules.to_vec(), deferred_source_count });
        let _ = translation_cell.set(bun_aot::Translation::new(&complete_request.constants).explaining(explain).enforcing(crate::cli::aot::rule_settings(rules).unwrap_or_default()));
        *received_log.lock() = Some(Handed(log));
        deferred
    };
    match pending_request {
        PendingRequest::Received(received) => {
            let (checked, log) = *received;
            let mut deferred = complete(checked, log);
            provided.build_constants = deferred.build_constants.take();
            if let (Some(path), Some(complete_request)) = (bun_core::env_var::BUN_AOT_TYPED_SNAPSHOT.get(), complete_request.get()) {
                provided.already_read.extend(provided.deferred_read.take().into_iter().flat_map(|wait| wait()));
                deferred.already_read.extend(deferred.deferred_read.take().into_iter().flat_map(|wait| wait()));
                let constants = &complete_request.constants;
                let snapshot = bun_sema_driver::snapshot::Snapshot {
                    cwd: cwd.to_vec(),
                    tsconfig: tsconfig.map(<[u8]>::to_vec),
                    conditions: conditions.to_vec(),
                    entry_points: paths.iter().chain(&deferred.paths).cloned().collect(),
                    code: code.iter().chain(&deferred.code).cloned().collect(),
                    script_kinds: script_kinds.iter().chain(&deferred.script_kinds).cloned().collect(),
                    script_kinds_by_extension: by_extension.to_vec(),
                    already_read: provided.already_read.iter().chain(&deferred.already_read).map(|(path, text)| (path.clone(), text.clone())).collect(),
                    deferred_entry_points: deferred.paths.len(),
                    deferred_code: deferred.code.len(),
                    deferred_imports: provided.deferred_imports.clone(),
                    deferred_paths: provided.deferred_paths.clone(),
                    resolved: constants.resolved.iter().flat_map(|resolved| resolved.iter()).map(|(from, specifier, to)| ((from.to_vec(), specifier.to_vec()), to.to_vec())).collect(),
                    dropped_imports: constants.dropped_imports.iter().cloned().collect(),
                    side_effect_free_files: constants.side_effect_free_files.iter().cloned().collect(),
                    lifted_commonjs: constants.lifted_commonjs.iter().cloned().collect(),
                    code_kinds: provided.code_kinds.iter().chain(&deferred.code_kinds).map(|(path, is_commonjs)| (path.clone(), *is_commonjs)).collect(),
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
            if early_sources.has_deferred_sources {
                provided.deferred_sources = Some(Box::new(move || Some(deferred)));
            }
        }
        PendingRequest::Awaited(next_request, is_load_abandoned) => {
            provided.is_load_abandoned = Some(is_load_abandoned);
            provided.observes_files = true;
            let superseding_request = &superseding_request;
            let wait = Handed(move || -> Option<DeferredSources> {
                let (checked, log) = next_request()?;
                if checked.early_sources.is_some() {
                    *superseding_request.lock() = Some(Handed((checked, log)));
                    return None;
                }
                Some(complete(checked, log))
            });
            let wait: Box<dyn FnOnce() -> Option<DeferredSources> + Send + '_> = Box::new(move || (wait.take())());
            // SAFETY: only the lifetime changes. `check_provided_then` calls or drops it before it returns, and all that it borrows is
            // declared above and dropped after that call.
            provided.deferred_sources = Some(unsafe { core::mem::transmute::<Box<dyn FnOnce() -> Option<DeferredSources> + Send + '_>, bun_sema_driver::host::WaitForDeferredSources>(wait) });
        }
    }
    let found: bun_threading::Guarded<Option<bun_ast::type_tags::ProgramFacts>> =
        bun_threading::Guarded::new(None);
    let not_compiled: bun_threading::Guarded<Vec<String>> = bun_threading::Guarded::new(Vec::new());
    let explained: bun_threading::Guarded<Vec<String>> = bun_threading::Guarded::new(Vec::new());
    let baseline_outcome = bun_threading::Guarded::new(None);
    let translation = || translation.get().expect("the request is complete when the program is loaded");
    let begin = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>| {
        if let Some(complete_request) = complete_request.get() {
            complete_request.function_source_printing.start(usize::from(bun_core::get_thread_count()).div_ceil(2));
        }
        // The executable runs its first entry point. The others are what it starts workers with.
        let entry_points: Vec<Vec<_>> = (entry_functions.iter())
            .map(|roots| roots.iter().filter_map(|path| program.files.by_path.get(&from_native(path))).collect())
            .collect();
        translation().begin(program, &entry_points, in_parallel);
    };
    let translate_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        translation().translate_file(checker, file);
    };
    let record_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        translation().record_file(checker, file);
    };
    let merge_notes = |program: &bun_sema_driver::Program| translation().merge_notes(program);
    let compiled_entry_points = || entry_function_names.iter().map(|name| name.clone().into_boxed_slice()).collect();
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
                    builtin_modules_of_entry_points: Vec::new(),
                    tokens: None,
                });
            }
            return vec![false; errors.len()];
        }
        let has_late_strings = complete_request.get().is_some_and(|complete_request| complete_request.has_late_strings);
        let engine: bun_threading::Guarded<Option<bun_ast::type_tags::EarlyEngine>> = bun_threading::Guarded::new(None);
        let on_written = |typed: &[u8]| *engine.lock() = Some(bun_jsc::cached_bytecode::start_typed_program(typed, has_late_strings));
        let bun_aot::EngineProgram { written: typed, kept_errors, explained: lines, typedness, tokens, builtin_modules_of_entry_points } = translation().finish_for_engine(program, in_parallel, errors, &on_written);
        *explained.lock() = lines;
        *TYPEDNESS_OF_LAST_BUILD.lock() = Some(typedness);
        *baseline_outcome.lock() = program.rule_scopes.get().and_then(|scopes| scopes.baseline_outcome());
        match typed {
            Ok(typed) => {
                *found.lock() = Some(bun_ast::type_tags::ProgramFacts {
                    engine: engine.lock().take(),
                    typed: Some(typed),
                    entry_points: compiled_entry_points(),
                    builtin_modules_of_entry_points,
                    tokens,
                });
            }
            Err(problems) => *not_compiled.lock() = problems,
        }
        kept_errors
    };
    let entries = Paths::EntryPoints(Entries {
        paths: &paths,
        script_kinds: &script_kinds,
        script_kinds_by_extension: by_extension,
        conditions,
    });
    let request = Request {
        is_one_program: true,
        code: &code,
        loaded: Some(&begin),
        after_file: Some(&translate_file),
        before_visits: Some(&record_file),
        all_visited_once: Some(&merge_notes),
        compile: Some(&analyze),
        plan_options: bun_sema_driver::PlanOptions { early_run: early.map(|(run, _)| run), ..Default::default() },
        ..request(cwd, tsconfig, &entries, &[], 0, None)
    };
    if let Some((_, wait_for_early_parse)) = early {
        wait_for_early_parse();
    }
    let report = bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), |report| report);
    if let Some(request) = superseding_request.lock().take() {
        return Analyzed::Superseded(Box::new(request.take()));
    }
    let Some(log) = received_log.lock().take().map(Handed::take) else {
        return Analyzed::Finished(None);
    };
    add_to_log(&report, log);
    if let Some(complete_request) = complete_request.get().filter(|complete_request| complete_request.explains_plugins) {
        let started = match (is_started_early, is_restarted) {
            (true, _) if report.is_reloaded_for_changed_files => "started while plugins were still answering and loaded again because files changed meanwhile",
            (true, _) => "started while plugins were still answering",
            (false, true) => "started early and started again because the early sources changed",
            (false, false) => "started after the last plugin answer",
        };
        let mut explained = explained.lock();
        explained.push(format!("aot: plugins: {} early sources, {} deferred sources, {started}", early_sources.sources.len(), complete_request.deferred_source_count));
        explained.extend(report.reloaded_paths.iter().map(|path| format!("aot: plugins: loaded again without {}, which a plugin module imports", BStr::new(path))));
    }
    if complete_request.get().is_some_and(|complete_request| complete_request.explains_rules_as_json) {
        explained.lock().extend(format::rule_findings_as_json(&report, &from_native(cwd)));
    }
    if let Some(complete_request) = complete_request.get().filter(|_| report.is_ok()) {
        crate::cli::aot::finish_baseline(&complete_request.rule_flags, baseline_outcome.lock().take());
    }
    if complete_request.get().is_some_and(|complete_request| complete_request.explain_to_log) {
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
    Analyzed::Finished(found.lock().take().filter(|_| report.is_ok()))
}

static TYPEDNESS_OF_LAST_BUILD: bun_threading::Guarded<Option<bun_aot::Typedness>> = bun_threading::Guarded::new(None);

pub(crate) fn take_typedness_line() -> Option<String> {
    TYPEDNESS_OF_LAST_BUILD.lock().take().map(|typedness| typedness_line(&typedness))
}

fn typedness_line(typedness: &bun_aot::Typedness) -> String {
    let with_commas = |n: usize| {
        let digits = n.to_string();
        let mut out = String::new();
        for (i, digit) in digits.chars().enumerate() {
            if i > 0 && (digits.len() - i).is_multiple_of(3) {
                out.push(',');
            }
            out.push(digit);
        }
        out
    };
    let counted = |n: usize, one: &str, many: &str| format!("{} {}", with_commas(n), if n == 1 { one } else { many });
    let bun_aot::Typedness { reads, typed_reads, layouts, open_layouts, classes_without_layout, untyped_packages, untyped_files } = *typedness;
    let is_fully_typed = typed_reads == reads && open_layouts + classes_without_layout + untyped_packages + untyped_files == 0;
    format!(
        "aot: {:.1}% of reads typed, {} of {} open, {} without a layout, {} and {} untyped{}\n",
        100.0 * typed_reads as f64 / reads.max(1) as f64,
        with_commas(open_layouts),
        counted(layouts, "type", "types"),
        counted(classes_without_layout, "class", "classes"),
        counted(untyped_packages, "package", "packages"),
        counted(untyped_files, "file", "files"),
        if is_fully_typed { "" } else { " (--aot-warn=all lists them)" },
    )
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
            Some(b'[' | b' ') | None => (Output::error_writer(), ""),
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

fn first_error(report: &Report) -> Option<&Diagnostic> {
    report.diagnostics.iter().find(|reported| matches!(reported.category, Category::Error) && !bun_sema_driver::is_type_only_diagnostic(reported.code))
}

pub(crate) fn sound_files_for_build(asked: &SoundFilesRequest<'_>, log: &mut bun_ast::Log) -> TypedOutputs {
    use bun_sema_driver::sound_files::{ModuleTypes, Output, sound_files, typed_outputs, annotate_implicit_any, emitted_declarations_of};
    let &SoundFilesRequest { cwd, tsconfig, conditions, loaders, outdir, written, module_types, rolls_up_declarations, keeps_modules_apart } = asked;
    let modules = module_types.and_then(|types| types.downcast_ref::<Vec<ModuleTypes>>());
    let outputs: Vec<Output<'_>> = written.iter().map(|file| Output { path: file.path, javascript: file.text, source_map: file.source_map, entry_point: file.entry_point }).collect();
    let by_extension = script_kinds_by_extension(loaders);
    let tsconfig_of_sources = if tsconfig.is_none() { bun_sema_driver::sound_files::tsconfig_of_sources(&outputs, modules.map_or(&[][..], Vec::as_slice)) } else { None };
    let tsconfig = tsconfig.or(tsconfig_of_sources.as_deref());
    let source = outputs.iter().find_map(|output| output.entry_point).or_else(|| modules.and_then(|modules| modules.first()).map(|module| &module.path[..]));
    let governing = tsconfig.zip(source).and_then(|(tsconfig, source)| {
        let entries = Paths::EntryPoints(Entries { paths: &[], script_kinds: &[], script_kinds_by_extension: &by_extension, conditions });
        bun_sema_driver::governing_config_of(&request(cwd, Some(tsconfig), &entries, &[], 0, None), tsconfig, source)
    });
    let tsconfig = governing.as_deref().or(tsconfig);
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
    let without_emitted_declarations = sound_files(outdir, &outputs, modules.map(Vec::as_slice), &[], keeps_modules_apart);
    let emitted = emitted_declarations_of(modules.map_or(&[][..], Vec::as_slice), without_emitted_declarations.as_ref().map_or(&[][..], |found| &found.modules_of_untyped_values[..]));
    let emitted_modules: bun_threading::Guarded<Vec<(u32, ModuleTypes)>> = bun_threading::Guarded::new(Vec::new());
    if !emitted.is_empty() {
        let note_module_types = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
            if let Some(found) = bun_sema_driver::sound_files::module_types(checker, file).filter(|found| emitted.iter().any(|file| file.0[..] == found.path[..])) {
                let mut emitted_modules = emitted_modules.lock();
                emitted_modules.retain(|known| known.0 != file.0);
                emitted_modules.push((file.0, found));
            }
        };
        let paths: Vec<Vec<u8>> = emitted.iter().map(|file| file.0.clone()).collect();
        let entries = Paths::EntryPoints(Entries { paths: &paths, script_kinds: &[], script_kinds_by_extension: &by_extension, conditions });
        let after_file = Some(&note_module_types as &(dyn Fn(&mut bun_sema_driver::Checker<'_, '_>, bun_sema_driver::FileId) + Sync));
        let request = Request { after_file, ..request(cwd, tsconfig, &entries, &[], 0, None) };
        let provided = Provided { already_read: already_read(cwd, &mut emitted.iter().map(|file| (&file.0[..], &file.1[..]))), ..Default::default() };
        bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), |_| ());
    }
    let mut emitted_modules = std::mem::take(&mut *emitted_modules.lock());
    emitted_modules.sort_by_key(|module| module.0);
    let emitted_modules: Vec<ModuleTypes> = emitted_modules.into_iter().map(|module| module.1).collect();
    let mut declaration_files: DeclarationFiles = (rolls_up_declarations.then(|| typed_outputs(outdir, &outputs, modules.map(Vec::as_slice), &emitted_modules, true, false).ok()).flatten())
        .filter(|typed| typed.iter().all(|(_, typed)| typed.untyped_exports.is_empty() && typed.dropped_casts == 0))
        .map(|typed| typed.into_iter().map(|(path, typed)| (path, typed.text)).collect())
        .map(|mut typed: Vec<(Vec<u8>, Vec<u8>)>| check(&mut typed, &[]))
        .filter(|report| first_error(report).is_none() && report.incomplete.is_empty())
        .map_or_else(Vec::new, |report| {
            (report.declaration_files.iter())
                .filter_map(|(source, text)| {
                    let source = bun_sema_driver::host::to_native(source);
                    let path = NAMES.iter().find_map(|(from, to)| Some([source.strip_suffix(*from)?, *to].concat()))?;
                    Some((path.into_boxed_slice(), text[..].into()))
                })
                .collect()
        });
    let found = if emitted_modules.is_empty() { without_emitted_declarations } else { sound_files(outdir, &outputs, modules.map(Vec::as_slice), &emitted_modules, keeps_modules_apart) };
    let mut found = match found {
        Ok(found) => found,
        Err(why) => {
            log.add_warning_fmt(None, bun_ast::Loc::EMPTY, format_args!("{SKIPPED_SOUND_FILES}: {why}"));
            return TypedOutputs { sound_files: Vec::new(), declaration_files };
        }
    };
    let report = check(&mut found.typed, &found.declarations_while_checked);
    if let Some(first) = first_error(&report) {
        let path = bun_sema_driver::host::to_native(&first.path);
        let shown = BStr::new(path.strip_prefix(outdir).map_or(path, |inside| inside.strip_prefix(std::path::MAIN_SEPARATOR_STR.as_bytes()).unwrap_or(inside)));
        let text = BStr::new(bun_core::strings::split(&first.text[..], b"\n").next().unwrap_or_default());
        log.add_warning_fmt(None, bun_ast::Loc::EMPTY, format_args!("{SKIPPED_SOUND_FILES}: with its types put back it has type errors, the first at {shown}:{}:{}: TS{}: {text}", first.line, first.column, first.code));
        return TypedOutputs { sound_files: Vec::new(), declaration_files };
    }
    if !report.incomplete.is_empty() {
        log.add_warning_fmt(None, bun_ast::Loc::EMPTY, format_args!("{SKIPPED_SOUND_FILES}: with its types put back it could not be type checked"));
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
        side_effect_free_files: _,
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
        minifies_identifiers: _,
        preserve_source_paths: _,
        react_compiler_outputs: _,
        jsx: _,
        classes: _,
        function_sources: _,
        function_source_printing: _,
        explain: _,
        explain_to_log: _,
        rules: _,
        logs_type_errors: _,
        early_analysis: _,
        early_sources: _,
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
    let mut module_types: Vec<bun_sema_driver::sound_files::ModuleTypes> = module_types.into_iter().map(|module| module.1).collect();
    for module in &mut module_types {
        if let Some((_, text)) = report.declaration_files.iter().find(|(source, _)| source[..] == module.path[..]) {
            module.emitted_declarations = text[..].into();
        }
    }
    report.is_ok().then(|| Declarations {
        files: declaration_files.collect(),
        module_types: (emitted == Emitted::DeclarationsAndModuleTypes).then(|| Box::new(module_types) as Box<dyn core::any::Any + Send>),
    })
}

/// The errors as those of a build.
fn add_to_log(report: &Report, log: &mut bun_ast::Log) {
    let note = format::bun_types_hint(report);
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
fn test_runner_declarations() -> Vec<u8> {
    let globals = br#"// @ts-nocheck
type BunTestRunnerInstalled = typeof import("vitest") extends { isDeclaredByBun: true } ? typeof import("@jest/globals") : typeof import("vitest");
type BunTestRunnerGlobal<Name extends keyof typeof import("bun:test")> = Name extends keyof BunTestRunnerInstalled ? BunTestRunnerInstalled[Name] : (typeof import("bun:test"))[Name];
declare var test: BunTestRunnerGlobal<"test">;
declare var it: BunTestRunnerGlobal<"it">;
declare var describe: BunTestRunnerGlobal<"describe">;
declare var expect: BunTestRunnerGlobal<"expect">;
declare var expectTypeOf: BunTestRunnerGlobal<"expectTypeOf">;
declare var beforeAll: BunTestRunnerGlobal<"beforeAll">;
declare var beforeEach: BunTestRunnerGlobal<"beforeEach">;
declare var afterEach: BunTestRunnerGlobal<"afterEach">;
declare var afterAll: BunTestRunnerGlobal<"afterAll">;
declare var jest: BunTestRunnerGlobal<"jest">;
declare var vi: BunTestRunnerGlobal<"vi">;
declare var xit: BunTestRunnerGlobal<"xit">;
declare var xtest: BunTestRunnerGlobal<"xtest">;
declare var xdescribe: BunTestRunnerGlobal<"xdescribe">;
declare module "@jest/globals*" { export * from "bun:test"; export const isDeclaredByBun: true; }
declare module "vitest*" { export * from "bun:test"; export const isDeclaredByBun: true; }
"#;
    let module = &include_bytes!("../../../packages/bun-types/test.d.ts")[..];
    let named = &b"declare module \"bun:test\" {"[..];
    let at = bun_core::strings::index_of(module, named).expect("bun-types declares the module");
    [&globals[..], &module[..at], &b"declare module \"bun:test*\" {"[..], &module[at + named.len()..]].concat()
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
            bun_sema_driver::fs_queries::invalidate_recording();
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

/// Files that are code though no check visits them: a build is told them by the bundler.
#[derive(Default, Clone, Copy)]
pub(crate) struct MoreCode<'a> {
    pub(crate) paths: &'a [Vec<u8>],
    /// So many of them, the first, stay whatever the program holds.
    pub(crate) fixed: usize,
    /// They are not called missing again.
    pub(crate) taken_out: &'a [Vec<u8>],
    pub(crate) refused_entry_points: &'a [Vec<u8>],
}

#[derive(Default)]
pub(crate) struct AuditFound {
    pub(crate) modules: Vec<(bun_aot::audit::Module, Vec<u8>)>,
    pub(crate) shapes: Vec<(String, String)>,
    pub(crate) has_errors: bool,
    pub(crate) has_build_blocking_error: bool,
    pub(crate) never_visited: Vec<Vec<u8>>,
    /// Of the files that were handed in as more code and may be taken out: those that the program does not hold.
    pub(crate) unlinked_files: Vec<Vec<u8>>,
    pub(crate) said: Vec<u8>,
    pub(crate) public_declarations: Vec<(Vec<u8>, u64, Vec<u8>)>,
    pub(crate) public_declarations_changed: bool,
    /// Of a look for tests: the entry points from which a file with an error is reached.
    pub(crate) entry_points_reaching_errors: Vec<Vec<u8>>,
}

/// `imports`: by file, its name and the files it imports. Nothing where an error belongs to no file of those.
fn find_entry_points_reaching_errors(cwd: &[u8], entry_points: &[Vec<u8>], imports: &[(Vec<u8>, Vec<u32>)], diagnostics: &[Diagnostic]) -> Vec<Vec<u8>> {
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
#[cfg(unix)]
pub(crate) fn diagnostic_format_key() -> [bool; 4] {
    let to = Destination::stderr();
    [to.is_tty, to.colors, Output::is_ai_agent(), Output::is_github_action()]
}

#[derive(Clone, Copy)]
pub(crate) enum Audited<'a> {
    Whole,
    WholeProgramInBackground,
    Alone { path: &'a [u8], text: &'a [u8], is_quiet: bool },
    #[cfg(unix)]
    Changed { paths: &'a [Vec<u8>], public_declarations: &'a [(Vec<u8>, u64, Vec<u8>)] },
}

impl Audited<'_> {
    fn is_changed(self) -> bool {
        match self {
            #[cfg(unix)]
            Audited::Changed { .. } => true,
            _ => false,
        }
    }
}

pub(crate) fn audit_before(
    entry_points: &[EntryPoint],
    before_read: Option<BeforeRead>,
    is_for_tests: bool,
    audited: Audited<'_>,
    more_code: MoreCode<'_>,
    on_found: Option<&(dyn Fn(AuditFound) + Sync)>,
) -> Option<AuditFound> {
    let MoreCode { paths: more_code, fixed, taken_out, refused_entry_points } = more_code;
    use bun_paths::{platform::Auto, resolve_path::join_abs_string};
    use bun_sema_driver::host::from_native;
    let cwd = working_directory();
    let args = bun_options_types::context::try_get().map(|ctx| &ctx.args);
    let loaders = args.and_then(|args| args.loaders.as_ref());
    let loaders = loaders_from_transform_options(loaders, bun_ast::Target::Bun);
    let by_extension = script_kinds_by_extension(&loaders.unwrap_or_default());
    let (checked_paths, script_kinds) = what_to_check(&cwd, entry_points, &by_extension)?;
    let paths: Vec<Vec<u8>> = checked_paths.iter().filter(|path| !refused_entry_points.contains(path)).cloned().collect();
    let mut in_memory = (entry_points.iter()).filter_map(|it| Some((it.path, it.text?)));
    let mut provided = Provided {
        already_read: already_read(&cwd, &mut in_memory),
        before_read,
        is_without_bundler: true,
        lowers_like_the_runtime: true,
        ..Default::default()
    };
    let mut code: Vec<Vec<u8>> = Vec::new();
    for &(name, text) in bun_aot::prelude::FILES {
        let path = bun_aot::prelude::path_of(&cwd, name);
        provided.already_read.insert(from_native(&path), text.as_bytes().into());
        code.push(path);
    }
    code.extend(more_code.iter().cloned());
    let mut roots = checked_paths;
    if is_for_tests {
        let path = bun_aot::prelude::path_of(&cwd, "test-globals.d.ts");
        provided.already_read.insert(from_native(&path), test_runner_declarations().into());
        roots.push(path);
    }
    let alone: Option<Vec<Vec<u8>>> = match audited {
        Audited::Whole | Audited::WholeProgramInBackground => None,
        Audited::Alone { path, text, .. } => {
            provided.already_read.insert(from_native(path), bun_core::strings::without_utf8_bom(text).to_vec().into());
            Some(vec![from_native(path)])
        }
        #[cfg(unix)]
        Audited::Changed { paths, public_declarations } => {
            for (path, _, declarations) in public_declarations.iter().filter(|it| !paths.contains(&it.0)) {
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
        records_spans: true,
        defines: (args.and_then(|args| args.define.as_ref())).map_or_else(Vec::new, |define| define.keys.iter().zip(&define.values).map(|(name, value)| (name.to_vec(), value.to_vec())).collect()),
        features: args.map_or_else(Vec::new, |args| args.feature_flags.iter().map(|flag| flag.to_vec()).collect()),
        has_preloads: bun_options_types::context::try_get().is_some_and(|ctx| !ctx.preloads.is_empty()),
        ..Default::default()
    };
    let translation = bun_aot::Translation::new(&constants);
    let restarted: bun_threading::Guarded<Option<(Vec<Vec<u8>>, Vec<Vec<u8>>)>> = bun_threading::Guarded::new(None);
    let begin = |program: &bun_sema_driver::Program, in_parallel: bun_sema_driver::InParallel<'_>| {
        let entry_points: Vec<Vec<_>> = (paths.iter())
            .filter_map(|path| program.files.by_path.get(&from_native(join_abs_string::<Auto>(&cwd, &[path]))))
            .map(|file| vec![file])
            .collect();
        translation.begin(program, &entry_points, in_parallel);
        if !matches!(audited, Audited::Whole | Audited::WholeProgramInBackground) {
            return;
        }
        let missing: Vec<Vec<u8>> = (program.files.modules.iter().enumerate())
            .filter(|(index, module)| module.is_dependency && matches!(bun_paths::extension(module.file_name()), b".ts" | b".tsx" | b".mts" | b".cts") && !module.file_name().starts_with(b"/$bun/") && !bun_core::strings::contains(module.path.text, b"/.bun-aot-prelude/") && translation.is_compiled(bun_sema_driver::FileId(*index as u32)))
            .map(|(_, module)| bun_sema_driver::host::to_native(module.file_name()).to_vec())
            .filter(|path| !more_code.contains(path) && !taken_out.contains(path))
            .collect();
        let too_much: Vec<Vec<u8>> = (more_code[fixed.min(more_code.len())..].iter()).filter(|path| !program.files.by_path.get(&from_native(path)).is_some_and(|file| translation.is_compiled(file))).cloned().collect();
        if !missing.is_empty() || !too_much.is_empty() {
            *restarted.lock() = Some((missing, too_much));
            program.give_up();
        }
    };
    let visited: bun_threading::Guarded<bun_sema_driver::FxHashSet<usize>> = bun_threading::Guarded::new(Default::default());
    let public_declarations: bun_threading::Guarded<Vec<(Vec<u8>, u64, Vec<u8>)>> = bun_threading::Guarded::new(Vec::new());
    /// A program with less typed TypeScript of its own is looked at whole after every edit.
    const MIN_SOURCE_BYTES_FOR_PARTIAL_ANALYSIS: u64 = 1 << 20;
    let is_its_own = |checker: &bun_sema_driver::Checker<'_, '_>, index: usize| {
        let module = &checker.p.files.modules[index];
        let name = module.file_name();
        let is_on_the_disk = !module.is_lib && !name.starts_with(b"/$bun/") && !bun_sema_driver::host::is_bundled(name) && !bun_core::strings::contains(name, b"/.bun-aot-prelude/");
        let declares_only = [&b".d.ts"[..], b".d.mts", b".d.cts"].iter().any(|ending| name.ends_with(ending));
        matches!(bun_paths::extension(name), b".ts" | b".tsx" | b".mts" | b".cts") && is_on_the_disk && !declares_only && !module.is_untyped() && !module.is_dependency
    };
    let is_large: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let translate_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        if !is_left_out(checker, file) {
            visited.lock().insert(file.idx());
            translation.translate_file(checker, file);
            let module = &checker.p.files.modules[file.idx()];
            let is_large = || *is_large.get_or_init(|| (0..checker.p.files.modules.len()).filter(|&index| is_its_own(checker, index)).map(|index| u64::from(checker.p.files.modules[index].hir.source_len)).sum::<u64>() >= MIN_SOURCE_BYTES_FOR_PARTIAL_ANALYSIS);
            if is_its_own(checker, file.idx()) && (audited.is_changed() || is_large()) {
                let path = bun_sema_driver::host::to_native(module.file_name()).to_vec();
                if let Some(declarations) = checker.declaration_file_without_reports(file) {
                    public_declarations.lock().push((path, bun_wyhash::hash(&declarations), declarations));
                }
            }
        }
    };
    let record_file = |checker: &mut bun_sema_driver::Checker<'_, '_>, file: bun_sema_driver::FileId| {
        if !is_left_out(checker, file) {
            translation.record_file(checker, file);
        }
    };
    let merge_notes = |program: &bun_sema_driver::Program| translation.merge_notes(program);
    let found: bun_threading::Guarded<AuditFound> = bun_threading::Guarded::new(AuditFound::default());
    let imports: bun_threading::Guarded<Vec<(Vec<u8>, Vec<u32>)>> = bun_threading::Guarded::new(Vec::new());
    let list = |program: &bun_sema_driver::Program,
                in_parallel: bun_sema_driver::InParallel<'_>,
                errors: &[(bun_sema_driver::FileId, u32)]|
     -> Vec<bool> {
        if let Some((never_visited, unlinked_files)) = restarted.lock().take() {
            *found.lock() = AuditFound { never_visited, unlinked_files, ..Default::default() };
            return vec![false; errors.len()];
        }
        let text_of = |path: &[u8]| {
            let path = join_abs_string::<Auto>(&cwd, &[bun_sema_driver::host::to_native(path)]);
            program.files.by_path.get(&from_native(path)).map(|file| &program.files.hir(file).text[..])
        };
        let with_sources = |modules: Vec<bun_aot::audit::Module>| -> Vec<(bun_aot::audit::Module, Vec<u8>)> {
            (modules.into_iter())
                .filter_map(|module| {
                    let text = text_of(&module.path)?.to_vec();
                    Some((module, text))
                })
                .collect()
        };
        if alone.is_some() {
            for of_fragment in translation.take_fragment_programs(program) {
                found.lock().modules.extend(with_sources(bun_aot::audit::table(&of_fragment, false, &text_of, in_parallel)));
            }
            found.lock().has_errors = !errors.is_empty();
            #[cfg(unix)]
            if let Audited::Changed { paths, public_declarations: before } = audited {
                let mut found = found.lock();
                found.public_declarations = core::mem::take(&mut *public_declarations.lock());
                found.public_declarations_changed = paths.iter().any(|path| {
                    let of = |list: &[(Vec<u8>, u64, Vec<u8>)]| list.iter().find(|it| it.0 == *path).map(|it| it.1);
                    of(before).is_none() || of(before) != of(&found.public_declarations)
                });
            }
            if let Some(on_found) = on_found {
                on_found(core::mem::take(&mut *found.lock()));
            }
            return vec![audited.is_changed(); errors.len()];
        }
        if is_for_tests {
            *imports.lock() = (program.files.modules.iter()).map(|module| (module.file_name().to_vec(), module.imports.values().map(|imported| imported.idx() as u32).collect())).collect();
        }
        let mut translated = translation.finish(program, in_parallel, errors);
        bun_aot::audit::widen_layoutless_classes_to_any_object(&mut translated.program);
        let modules = with_sources(bun_aot::audit::table(&translated.program, true, &text_of, in_parallel));
        let never_visited = (modules.iter())
            .filter(|(module, _)| matches!(bun_paths::extension(&module.path), b".ts" | b".tsx" | b".mts" | b".cts"))
            .filter_map(|(module, _)| {
                let path = join_abs_string::<Auto>(&cwd, &[bun_sema_driver::host::to_native(&module.path)]).to_vec();
                let file = program.files.by_path.get(&from_native(&path))?;
                (!visited.lock().contains(&file.idx()) && !more_code.contains(&path)).then_some(path)
            })
            .collect();
        let in_program: bun_sema_driver::FxHashSet<Vec<u8>> = modules.iter().map(|(module, _)| join_abs_string::<Auto>(&cwd, &[bun_sema_driver::host::to_native(&module.path)]).to_vec()).collect();
        let unlinked_files = more_code[fixed.min(more_code.len())..].iter().filter(|path| !in_program.contains(*path)).cloned().collect();
        *found.lock() = AuditFound {
            modules,
            shapes: bun_aot::audit::shapes(&translated.program),
            has_errors: translated.kept_errors.contains(&true),
            has_build_blocking_error: false,
            never_visited,
            unlinked_files,
            said: Vec::new(),
            public_declarations: core::mem::take(&mut *public_declarations.lock()),
            public_declarations_changed: false,
            entry_points_reaching_errors: Vec::new(),
        };
        bun_aot::release(translated.program, in_parallel);
        translated.kept_errors
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
        before_visits: Some(&record_file),
        all_visited_once: Some(&merge_notes),
        compile: Some(&list),
        only: only.as_deref(),
        threads: match audited {
            Audited::Whole => 0,
            #[cfg(unix)]
            Audited::Changed { .. } => 0,
            Audited::WholeProgramInBackground => usize::from(bun_core::get_thread_count()).div_ceil(2),
            Audited::Alone { .. } => usize::from(bun_core::get_thread_count()).min(8),
        },
        ..request(&cwd, tsconfig_override(), &entries, &[], 0, None)
    };
    let mut report = bun_sema_driver::check_provided_then(&request, with_pages(&cwd, provided), |report| report);
    let is_ok = report.is_ok();
    let is_reanalysis = is_ok && (!found.lock().never_visited.is_empty() || !found.lock().unlinked_files.is_empty());
    if !is_ok && report.incomplete.is_empty() {
        found.lock().entry_points_reaching_errors = find_entry_points_reaching_errors(&cwd, &paths, &imports.lock(), &report.diagnostics);
    }
    if is_for_tests && !is_reanalysis && matches!(audited, Audited::Whole) {
        static ALREADY_REPORTED: bun_threading::Guarded<Vec<(Vec<u8>, u32, u32)>> = bun_threading::Guarded::new(Vec::new());
        let mut said = ALREADY_REPORTED.lock();
        report.diagnostics.retain(|reported| {
            let key = (reported.path.clone(), reported.start, reported.code);
            let is_new = !said.contains(&key);
            if is_new {
                said.push(key);
            }
            is_new
        });
    }
    if !is_reanalysis && !found.lock().public_declarations_changed && !matches!(audited, Audited::Alone { is_quiet: true, .. }) && (!report.diagnostics.is_empty() || !report.incomplete.is_empty()) {
        let shown_from = from_native(&cwd);
        let style = Style {
            is_case_sensitive: report.is_case_sensitive,
            ..style_for(&shown_from, None, Destination::stderr(), false)
        };
        let mut out = Vec::new();
        format::write_diagnostics(&mut out, &report, &style);
        if matches!(audited, Audited::Whole) && !is_ok && !crate::cli::aot_audit::is_enforcing() && found.lock().modules.iter().all(|(module, _)| module.groups.is_empty() && module.parameters.is_empty()) {
            out.extend_from_slice(b"[aot] note: fix these type errors first: bun build --compile --aot stops at them, and nothing is audited until they are fixed\n");
        }
        static WRITTEN: bun_threading::Guarded<Vec<u8>> = bun_threading::Guarded::new(Vec::new());
        if *WRITTEN.lock() != out && !matches!(audited, Audited::WholeProgramInBackground) {
            let _ = Output::error_writer().write_all(&out);
            Output::flush();
        }
        (*WRITTEN.lock()).clone_from(&out);
        found.lock().said = out;
    }
    if !is_reanalysis {
        found.lock().never_visited.clear();
        found.lock().unlinked_files.clear();
    }
    found.lock().has_build_blocking_error = !is_ok;
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
