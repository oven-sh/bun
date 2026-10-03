//! `bun check`: type checks a TypeScript project. `bun run --check` and `bun build --check` go through [`check_before`].

use bstr::BStr;

use bun_core::{Global, Output, ZStr, env_var};
use bun_sema_driver::format::{self, Layout, Style};
use bun_sema_driver::{CompilerOption, FlagError, Progress, Report, Request};
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;

pub(crate) struct CheckCommand;

#[derive(Default)]
struct Options {
    project: Option<Vec<u8>>,
    paths: Vec<Vec<u8>>,
    threads: usize,
    /// `--pretty`, `--no-pretty`. Not said: by where the output goes.
    pretty: Option<bool>,
    /// `--all`: never group identical errors.
    all: bool,
    /// `--strict`, `--target es2022` and so on.
    compiler_options: Vec<CompilerOption>,
    /// `-b`, `--build`: what is named is a project, as for `tsc -b`.
    build: bool,
    timing: bool,
}

fn usage_error(args: core::fmt::Arguments<'_>) -> ! {
    Output::err_generic("{}", (args,));
    bun_core::note!("run 'bun check --help' for more information");
    Global::exit(1);
}

/// `--flag value` or `--flag=value`.
fn value_of<'a>(
    arg: &'a [u8],
    names: &[&[u8]],
    rest: &mut core::slice::Iter<'_, &'a ZStr>,
) -> Option<&'a [u8]> {
    for name in names {
        if arg == *name {
            match rest.next() {
                Some(value) => return Some(value.as_bytes()),
                None => usage_error(format_args!("{} needs a value", BStr::new(name))),
            }
        }
        if name.starts_with(b"--")
            && let Some(value) = arg
                .strip_prefix(*name)
                .and_then(|after| after.strip_prefix(b"="))
        {
            return Some(value);
        }
    }
    None
}

fn parse(args: &[&ZStr]) -> Options {
    let mut options = Options::default();
    let mut rest = args.iter();
    let mut takes_flags = true;
    while let Some(arg) = rest.next() {
        let arg = arg.as_bytes();
        if !takes_flags || !arg.starts_with(b"-") || arg == b"-" {
            options.paths.push(arg.to_vec());
            continue;
        }
        if arg == b"--" {
            takes_flags = false;
        } else if arg == b"-h" || arg == b"--help" {
            crate::cli::command::tag_print_help(crate::cli::command::Tag::CheckCommand, true);
            Global::exit(0);
        } else if let Some(project) = value_of(
            arg,
            &[b"-p", b"--project", b"--tsconfig-override"],
            &mut rest,
        ) {
            options.project = Some(project.to_vec());
        } else if let Some(cwd) = value_of(arg, &[b"--cwd"], &mut rest) {
            let path = bun_core::ZBox::from_bytes(cwd);
            if let bun_sys::Result::Err(err) = bun_sys::chdir(&path) {
                Output::err(
                    err,
                    "Could not change directory to \"{}\"",
                    (BStr::new(cwd),),
                );
                Global::exit(1);
            }
        } else if let Some(threads) = value_of(arg, &[b"--threads"], &mut rest) {
            match bun_core::fmt::parse_decimal::<usize>(threads) {
                Some(n) if n > 0 => options.threads = n,
                _ => usage_error(format_args!(
                    "--threads takes a number above zero, not \"{}\"",
                    BStr::new(threads)
                )),
            }
        } else if arg == b"--pretty" || arg == b"--pretty=true" {
            options.pretty = Some(true);
        } else if arg == b"--no-pretty" || arg == b"--pretty=false" {
            options.pretty = Some(false);
        } else if arg == b"--all" {
            options.all = true;
        } else if arg == b"--timing" {
            options.timing = true;
        } else if arg == b"--no-emit" {
            // Nothing is ever emitted. `--noEmit` is a compiler option like any other, which the driver sets last.
        } else if arg == b"-b" || arg == b"--build" {
            options.build = true;
        } else if let Some(flag) = arg.strip_prefix(b"--") {
            options
                .compiler_options
                .push(compiler_option(flag, &mut rest));
        } else {
            usage_error(format_args!("Unknown flag \"{}\"", BStr::new(arg)));
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
    rest: &mut core::slice::Iter<'_, &'a ZStr>,
) -> CompilerOption {
    let (name, mut value) = match bun_core::strings::index_of_char_usize(flag, b'=') {
        Some(at) => (&flag[..at], Some(&flag[at + 1..])),
        None => (flag, None),
    };
    if value.is_none() {
        let next = rest.as_slice().first().map(|next| next.as_bytes());
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

/// Where `bun add -g` puts packages.
fn global_node_modules() -> Option<Vec<u8>> {
    if let Some(dir) = env_var::BUN_INSTALL_GLOBAL_DIR.get() {
        return Some([dir, b"/node_modules"].concat());
    }
    if let Some(dir) = env_var::BUN_INSTALL.get() {
        return Some([dir, b"/install/global/node_modules"].concat());
    }
    env_var::HOME
        .get()
        .map(|home| [home, b"/.bun/install/global/node_modules"].concat())
}

/// Shows how far `progress` has got on stderr until `is_done`, once it has taken long enough for somebody to wonder.
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
    then: impl FnOnce(Report) -> Report,
) -> Report {
    // For a person who is watching.
    if !Output::is_stderr_tty() || Output::is_ai_agent() {
        return run_quietly(cwd, project, paths, compiler_options, threads, None, then);
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
            |report| {
                is_done.store(true, Ordering::Release);
                shown.thread().unpark();
                // The line is gone before anything else is said.
                let _ = shown.join();
                then(report)
            },
        )
    })
}

fn run_quietly(
    cwd: &[u8],
    project: Option<&[u8]>,
    paths: &[Vec<u8>],
    compiler_options: &[CompilerOption],
    threads: usize,
    progress: Option<&Progress>,
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
        keeps_everything: false,
        stops_where_tsc_does: true,
        says_it_as_typescript_does: false,
        loaded: None,
        checked: None,
        after_file: None,
    };
    bun_sema_driver::check_then(&request, then)
}

/// A person at a terminal gets the source around each error, and so does an agent, in tags and without colors, which spares it opening
/// the files. A pipe or continuous integration gets a line an error.
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

impl CheckCommand {
    pub(crate) fn exec(args: &[&ZStr]) -> ! {
        let options = parse(args);
        let cwd = working_directory();
        let report = run(
            &cwd,
            options.project.as_deref(),
            &options.paths,
            &options.compiler_options,
            options.threads,
            // The process ends while all that was loaded is still there. Where leaks are looked for, all is given back first.
            |report| match bun_core::feature_flags::HELP_CATCH_MEMORY_ISSUES {
                true => report,
                false => say_and_exit(&report, &options, &cwd),
            },
        );
        say_and_exit(&report, &options, &cwd)
    }
}

/// Shows what was found and ends the process.
fn say_and_exit(report: &Report, options: &Options, cwd: &[u8]) -> ! {
    let shown_from = bun_sema_driver::host::from_native(cwd);
    // The errors are the output, as they are of `tsc`. How it went is said on the side.
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

/// Type checks `entry_points` and everything they import before they are run or bundled. Says what is wrong on stderr, which leaves
/// stdout to the program. Whether there is nothing wrong.
pub(crate) fn check_before(entry_points: &[&[u8]]) -> bool {
    // What is no TypeScript or JavaScript has no types to check: `[eval]`, a stylesheet, a page.
    const CHECKED: [&[u8]; 8] = [
        b".ts", b".tsx", b".mts", b".cts", b".js", b".jsx", b".mjs", b".cjs",
    ];
    let paths: Vec<Vec<u8>> = entry_points
        .iter()
        .filter(|path| CHECKED.iter().any(|extension| path.ends_with(extension)))
        .map(|path| path.to_vec())
        .collect();
    if paths.is_empty() {
        return true;
    }
    // A JavaScript entry point is read for what it imports, whatever `allowJs` says. Only `checkJs` has its own errors reported.
    let allow_js: Vec<CompilerOption> = paths
        .iter()
        .any(|path| !path.ends_with(b"ts") && !path.ends_with(b".tsx"))
        .then(|| bun_sema_driver::compiler_option_from_flag(b"allowJs", None).ok())
        .flatten()
        .into_iter()
        .collect();
    check_and_say(&paths, &allow_js)
}

/// Type checks the project around the working directory, as `bun check` does, before one of its scripts is run.
pub(crate) fn check_project_before() -> bool {
    check_and_say(&[], &[])
}

fn check_and_say(paths: &[Vec<u8>], compiler_options: &[CompilerOption]) -> bool {
    let cwd = working_directory();
    let report = run(&cwd, None, paths, compiler_options, 0, |report| report);
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
