//! `bun lint`: lints a project with ESLint's and typescript-eslint's rules. The implementation is in `bun_lint_driver`.
//! This file provides what the driver needs from the process: the arguments, the terminal, TypeScript's libraries, a
//! way to run a configuration file that's a program, and (`lint_js.rs`) rules written in JavaScript.

use bstr::BStr;

use bun_core::{Global, Output, ZStr};
use bun_lint_driver::cli::{Options, UsageError};
use bun_lint_driver::lsp::{Args, Features, Process, Realms};
use bun_lint_driver::{Environment, Outcome, Script, Stream, bunfig, git};
use bun_sys::File;

use super::check_command::working_directory;
use super::command::{ContextData, Tag};
use super::script_or_command::{arguments_before, directory_of_cwd, place_of_command};
use bun_bunfig::Above;

pub(crate) struct LintCommand;

pub(crate) use bun_lint_driver::cli::HELP;

/// True if `bun lint` is a command. A release build doesn't have it: there `bun lint` runs the project's own `lint`.
pub(crate) const IS_ENABLED: bool = bun_core::Environment::IS_CANARY;

/// True if `bun lint --run-eslint-tests` exists, for `test/cli/lint/conformance.test.ts`. A release build doesn't have
/// it.
const HAS_TEST_RUNNER: bool = bun_core::Environment::IS_CANARY || bun_core::Environment::IS_DEBUG;

fn change_directory(cwd: &[u8]) {
    // Free the copy here, because `exit` doesn't return and nothing would free it later.
    let changed = bun_sys::chdir(&bun_core::ZBox::from_vec(directory_of_cwd(cwd)));
    if let bun_sys::Result::Err(err) = changed {
        Output::err(
            err,
            "Could not change directory to \"{}\"",
            (BStr::new(cwd),),
        );
        Global::exit(1);
    }
}

/// Returns `--cwd` from `bun`'s own flags, which precede `command`.
fn cwd_before(command: &[u8]) -> Option<&'static [u8]> {
    let mut found = None;
    let mut args = arguments_before(command).into_iter();
    while let Some(arg) = args.next() {
        let given = match arg.strip_prefix(b"--cwd") {
            Some(b"") => args.next(),
            Some(rest) => rest.strip_prefix(b"="),
            None => None,
        };
        found = given.or(found);
    }
    found
}

/// Returns `--config=<path>` from `bun`'s own flags, which precede `command`. Without the `=`, the path is parsed as
/// the command.
fn bunfig_before(command: &[u8]) -> Option<&'static [u8]> {
    (arguments_before(command).into_iter())
        .filter_map(|arg| {
            arg.strip_prefix(b"--config=")
                .or_else(|| arg.strip_prefix(b"-c="))
        })
        .next_back()
}

/// Calls `read` with each bunfig.toml that can apply to `command`, its path relative to the working directory, and
/// whether `--config` specified it. It starts with the file in the working directory and continues with the parent
/// directories, nearest first, until `read` doesn't want the next one. With `--config` it only reads that file. Call
/// this after applying `--cwd`.
pub(crate) fn read_bunfigs(
    ctx: &mut ContextData,
    tag: Tag,
    command: &[u8],
    read: &mut dyn FnMut(&bun_ast::Expr, &[u8], bool) -> Result<Above, bunfig::BunfigError>,
) {
    let config_path = bunfig_before(command);
    let mut read = |file: &bun_ast::Expr, path: &[u8]| {
        read(file, path, config_path.is_some())
            .map_err(|rejection| (rejection.at, rejection.message))
    };
    let mut above = Above::Needed;
    let here = &mut |file: &bun_ast::Expr| {
        above = read(file, config_path.unwrap_or(b"bunfig.toml"))?;
        Ok(())
    };
    if let Err(err) = bun_bunfig::load_config_for_tool(tag, config_path, ctx, Some(here)) {
        Output::err(err, "failed to load bunfig", ());
        Global::exit(2);
    }
    if config_path.is_none() && above != Above::Unwanted {
        bun_bunfig::load_config_above_for_tool(tag, ctx, above, &mut read);
    }
}

/// Line and column of `at` in `text`, from 1. `None` if `at` is nowhere.
fn line_and_column(text: &[u8], at: bun_ast::Loc) -> Option<(usize, usize)> {
    let before = text.get(..usize::try_from(at.start).ok()?)?;
    let line_start = bun_core::strings::last_index_of_char(before, b'\n').map_or(0, |it| it + 1);
    let line = bun_core::strings::count_char(before, b'\n') + 1;
    Some((line, before.len() - line_start + 1))
}

/// `Cannot use <shown>: <why>`, the reason a bunfig.toml isn't used.
fn cannot_use(shown: &[u8], why: &[&[u8]]) -> Vec<u8> {
    let mut message = b"Cannot use ".to_vec();
    message.extend_from_slice(shown);
    message.extend_from_slice(b": ");
    why.iter().for_each(|it| message.extend_from_slice(it));
    message
}

/// Calls `read` with the bunfig.toml whose text is `text`, as [`read_bunfigs_in`] does. `Err` says why the file
/// can't be used, with the line and column of the error.
fn read_bunfig_text(
    text: &[u8],
    shown: &[u8],
    is_named: bool,
    read: &mut dyn FnMut(&bun_ast::Expr, &[u8], bool) -> Result<Above, bunfig::BunfigError>,
) -> Result<Above, Vec<u8>> {
    use bun_lint_driver::json::{Notation, with_parsed_redacted};
    let text = bun_core::strings::without_utf8_bom(text);
    let parsed = with_parsed_redacted(Notation::Toml, text, |file| read(file, shown, is_named));
    let (at, message) = match parsed {
        Ok(Ok(above)) => return Ok(above),
        Ok(Err(rejection)) => (line_and_column(text, rejection.at), rejection.message),
        Err(error) => {
            let at = (usize::try_from(error.line).ok()).zip(usize::try_from(error.column).ok());
            (at, error.message)
        }
    };
    let shown = match at {
        Some((line, column)) => format!("{}:{line}:{column}", BStr::new(shown)).into_bytes(),
        None => shown.to_vec(),
    };
    Err(cannot_use(&shown, &[&message]))
}

/// As [`read_bunfigs`] with `directory` as the working directory, for the editor's server: it touches nothing of
/// the process and doesn't end it. `Err` says why a file that's needed, or that `--config` names, can't be used.
pub(crate) fn read_bunfigs_in(
    directory: &[u8],
    command: &[u8],
    read: &mut dyn FnMut(&bun_ast::Expr, &[u8], bool) -> Result<Above, bunfig::BunfigError>,
) -> Result<(), Vec<u8>> {
    use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
    let mut buffer = bun_paths::path_buffer_pool::get();
    let mut join = |shown: &[u8]| {
        join_abs_string_buf_checked::<platform::Auto>(directory, &mut buffer[..], &[shown])
            .map(<[u8]>::to_vec)
    };
    let read_file = |path: &[u8]| File::read_from(bun_core::Fd::cwd(), path);
    if let Some(config_path) = bunfig_before(command) {
        let Some(path) = join(config_path) else {
            return Err(cannot_use(config_path, &[b"the path is too long"]));
        };
        let text = read_file(&path).map_err(|error| {
            let why = error.msg().unwrap_or(b"unknown error");
            cannot_use(config_path, &[error.name(), b": ", why])
        })?;
        read_bunfig_text(&text, config_path, true, &mut *read)?;
        return Ok(());
    }
    let mut above = Above::Needed;
    let mut shown = b"bunfig.toml".to_vec();
    let mut below = Vec::new();
    loop {
        let Some(path) = join(&shown) else {
            return Ok(());
        };
        // The root is its own parent.
        if path == below {
            return Ok(());
        }
        if let Ok(text) = read_file(&path) {
            match read_bunfig_text(&text, &shown, false, &mut *read) {
                Ok(found) => above = found,
                // It can be that of another project.
                Err(_) if above == Above::Optional => return Ok(()),
                Err(why) => return Err(why),
            }
        }
        if above == Above::Unwanted {
            return Ok(());
        }
        shown.splice(0..0, *b"../");
        below = path;
    }
}

/// The defaults that `bun lint` takes from the bunfigs: `[lint]`, and `[fmt]` for the rule that compares a file with
/// `bun fmt`'s output. It's the same `[fmt]` that `bun fmt` would read.
#[derive(Default)]
struct LintDefaults {
    lint: Option<Options>,
    format: Option<bun_lint_driver::fmt::cli::Options>,
}

impl LintDefaults {
    /// Reads one bunfig, for `read_bunfigs`. `options` is the command line alone, and `cwd` the working directory
    /// that `path` is relative to.
    fn read(
        &mut self,
        options: &Options,
        cwd: &[u8],
        file: &bun_ast::Expr,
        path: &[u8],
        is_named: bool,
    ) -> Result<Above, bunfig::BunfigError> {
        if self.lint.is_none() {
            self.lint = bunfig::lint(file)?.map(|it| it.from_bunfig_at(path, is_named, cwd));
        }
        if self.format.is_none() {
            self.format = bunfig::format(file)?.map(|it| it.from_bunfig_at(path, is_named));
        }
        Ok(match (&self.lint, &self.format) {
            (Some(_), Some(_)) => Above::Unwanted,
            (Some(it), None) if it.mentions_format_rule() => Above::Needed,
            (Some(_), None) if options.mentions_format_rule() => Above::Needed,
            (Some(_), None) => Above::Optional,
            (None, _) => Above::Needed,
        })
    }

    /// The options of the run: `args` over the defaults. `None` if no bunfig has a section for `bun lint`.
    fn options(self, args: &[&[u8]]) -> Result<Option<Options>, UsageError> {
        let LintDefaults { mut lint, format } = self;
        if let Some(format) = format {
            lint.get_or_insert_default().bun_format_defaults = Some(Box::new(format));
        }
        lint.map(|defaults| Options::parse_with_defaults(defaults, args))
            .transpose()
    }
}

/// The options of `bun lint <args>` run in `directory`, with its bunfigs, for the editor's server. `Err` is what
/// the command would print before exiting with 2.
pub(crate) fn lint_options_in(directory: &[u8], args: &[&[u8]]) -> Result<Options, Vec<u8>> {
    let options = Options::parse(args).map_err(|UsageError(message)| message)?;
    let cwd = bun_lint_driver::from_native_path(directory);
    let mut defaults = LintDefaults::default();
    read_bunfigs_in(directory, b"lint", &mut |file, path, is_named| {
        defaults.read(&options, &cwd, file, path, is_named)
    })?;
    match defaults.options(args) {
        Ok(found) => Ok(found.unwrap_or(options)),
        Err(UsageError(message)) => Err(message),
    }
}

/// Reads one bunfig for `bun fmt`, for `read_bunfigs`: `[fmt]`, nearest first. Stops once found.
pub(crate) fn read_format_defaults(
    defaults: &mut Option<bun_lint_driver::fmt::cli::Options>,
    file: &bun_ast::Expr,
    path: &[u8],
    is_named: bool,
) -> Result<Above, bunfig::BunfigError> {
    let section = bunfig::format(file)?;
    *defaults = section.map(|it| it.from_bunfig_at(path, is_named));
    Ok(match defaults {
        Some(_) => Above::Unwanted,
        None => Above::Needed,
    })
}

/// The options of `bun fmt <args>` run in `directory`, with its bunfigs, for the editor's server. `Err` is what
/// the command would print before exiting with 2.
pub(crate) fn format_options_in(
    directory: &[u8],
    args: &[&[u8]],
) -> Result<bun_lint_driver::fmt::cli::Options, Vec<u8>> {
    use bun_lint_driver::fmt::cli::{Options as FormatOptions, UsageError as FormatUsageError};
    let options = FormatOptions::parse(args).map_err(|FormatUsageError(message)| message)?;
    let mut defaults = None;
    read_bunfigs_in(directory, b"fmt", &mut |file, path, is_named| {
        read_format_defaults(&mut defaults, file, path, is_named)
    })?;
    match defaults.map(|defaults| FormatOptions::parse_with_defaults(defaults, args)) {
        None => Ok(options),
        Some(Ok(options)) => Ok(options),
        Some(Err(FormatUsageError(message))) => Err(message),
    }
}

/// Applies `--disallow-code-generation-from-strings` from `bun`'s own flags, which precede `command`. It also covers
/// the plugins and the configuration files.
fn disallow_code_generation_before(command: &[u8]) {
    let argv = bun_core::argv().to_vec();
    let flags = argv
        .iter()
        .take(place_of_command(command).unwrap_or(argv.len()));
    super::arguments::disallow_code_generation_from_strings_as_compiled(
        &flags.copied().collect::<Vec<_>>(),
    );
}

/// The `-e` argument of a process that `run_script` starts.
const PROGRAM_IS_ON_STDIN: &[u8] = b"\x1e--bun-lint-program--\x1e";

/// In such a process, reads the program from stdin.
pub(crate) fn read_program_from_stdin(ctx: &mut ContextData) {
    let mut program = Vec::new();
    if *ctx.runtime_options.eval.script == *PROGRAM_IS_ON_STDIN
        && File::stdin().read_to_end_into(&mut program).is_ok()
    {
        ctx.runtime_options.eval.script = program.into_boxed_slice();
    }
}

/// Runs `script` with this executable and waits for it to exit.
fn run_script(script: &Script) -> Result<Vec<u8>, Vec<u8>> {
    let Ok(exe) = bun_core::self_exe_path() else {
        return Err(b"Could not find the path of the running executable.".to_vec());
    };
    let mut argv: Vec<Box<[u8]>> = vec![
        Box::from(exe.as_bytes()),
        // A package that isn't installed is simply missing. Reading a configuration never downloads anything.
        Box::from(&b"--no-install"[..]),
        // The child exits with this process no matter how this process ends, because a configuration can wait or spin
        // forever.
        Box::from(&b"--no-orphans"[..]),
        // ESLint, Prettier and oxlint read a configuration in Node, which doesn't read `.env`.
        Box::from(&b"--no-env-file"[..]),
    ];
    use bun_core::CodeGenerationFromStrings as Level;
    match bun_core::code_generation_from_strings() {
        Level::Allowed => {}
        Level::DisallowedLikeNode => {
            argv.push(Box::from(&b"--disallow-code-generation-from-strings"[..]));
        }
        Level::Strict => {
            argv.push(Box::from(
                &b"--disallow-code-generation-from-strings=strict"[..],
            ));
        }
    }
    // Node doesn't read a bunfig.toml either, and its `preload` would run before the configuration. Windows has no path
    // that's always an empty file.
    if cfg!(not(windows)) {
        argv.push(Box::from(&b"--config=/dev/null"[..]));
    }
    // The program isn't passed as an argument, because a command line is limited to 32,767 characters on Windows, and a
    // single argument to 128 KB on Linux.
    argv.push(Box::from(&b"-e"[..]));
    argv.push(Box::from(PROGRAM_IS_ON_STDIN));
    let parts = script.source.iter().map(|it| it.text());
    let input: Vec<&[u8]> = std::iter::once(script.head).chain(parts).collect();
    let adapt = |variables: &mut bun_dotenv::Map| {
        Script::NOT_INHERITED
            .iter()
            .for_each(|name| variables.remove(name));
        true
    };
    match run_to_end(argv, script.cwd, &adapt, &input)? {
        result if result.is_ok() => Ok(result.stdout),
        result => Err(result.stderr),
    }
}

/// Runs git and waits for it to exit.
fn run_git(command: &git::Command) -> Result<git::Finished, git::NotRun> {
    let mut buffer = bun_paths::path_buffer_pool::get();
    let path = bun_core::env_var::PATH.get().unwrap_or(b"");
    let Some(found) = bun_which::which(&mut buffer, path, command.cwd, b"git") else {
        return Err(git::NotRun::NotFound);
    };
    let argv = std::iter::once(found.as_bytes())
        .chain(command.args.iter().copied())
        .map(Box::<[u8]>::from)
        .collect();
    let adapt = |variables: &mut bun_dotenv::Map| {
        git::Command::VARIABLES
            .iter()
            .all(|(name, value)| variables.put(name, value).is_ok())
    };
    match run_to_end(argv, command.cwd, &adapt, &[command.input]) {
        Ok(result) => Ok(git::Finished {
            is_ok: result.is_ok(),
            stdout: result.stdout,
            stderr: result.stderr,
        }),
        Err(why) => Err(git::NotRun::Failed(why)),
    }
}

/// Runs `argv` in `cwd` with `input` on its stdin, and waits for it to exit. The child gets this process's environment
/// after `adapt` has changed it. `adapt` returns false if it couldn't. `Err` holds the reason the command didn't run.
fn run_to_end(
    argv: Vec<Box<[u8]>>,
    cwd: &[u8],
    adapt: &dyn Fn(&mut bun_dotenv::Map) -> bool,
    input: &[&[u8]],
) -> Result<crate::api::bun::process::sync::Result, Vec<u8>> {
    use crate::api::bun::process::sync::{Options as SpawnOptions, SyncStdio, spawn};
    let mut variables = bun_dotenv::Loader::init();
    let is_ready = variables.load_process().is_ok() && adapt(&mut variables.map);
    let Some(envp) = is_ready
        .then(|| variables.map.create_null_delimited_env_map().ok())
        .flatten()
    else {
        return Err(b"Could not start a process: out of memory".to_vec());
    };
    let [read_end, write_end] = match bun_sys::pipe() {
        Ok(ends) => ends.map(File::from_fd),
        Err(err) => return Err([&b"Could not start a process: "[..], err.name()].concat()),
    };
    // The child must not inherit the write end, or it would wait for itself to close it.
    #[cfg(unix)]
    for end in [&read_end, &write_end] {
        let _ = bun_sys::set_close_on_exec(end.handle());
    }
    let options = SpawnOptions {
        argv,
        stdout: SyncStdio::Buffer,
        stderr: SyncStdio::Buffer,
        stdin: SyncStdio::Pipe(read_end.handle()),
        cwd: Box::<[u8]>::from(cwd),
        envp: Some(envp.as_ptr()),
        #[cfg(windows)]
        windows: crate::api::bun::process::WindowsOptions {
            loop_: bun_jsc::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
                None, None,
            )),
            ..Default::default()
        },
        ..Default::default()
    };
    // Write the input while reading the program's output, so that neither side blocks the other.
    let spawned = std::thread::scope(|scope| {
        scope.spawn(move || input.iter().try_for_each(|it| write_end.write_all(it)));
        let spawned = spawn(&options);
        // Closing the read end makes a writer that's still writing fail instead of blocking.
        drop(read_end);
        spawned
    });
    match spawned {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(err)) => Err([&b"Could not start a process: "[..], err.name()].concat()),
        Err(err) => Err([&b"Could not start a process: "[..], err.name().as_bytes()].concat()),
    }
}

/// Reports an invalid `bun <command>` command line.
pub(crate) fn usage_error(command: &str, message: &[u8]) -> ! {
    Output::err_generic("{}", (BStr::new(message),));
    bun_core::note!("run 'bun {} --help' for more information", command);
    // Like ESLint.
    Global::exit(2);
}

/// Prints the output of `bun lint`, `bun fmt` or `bun check` and returns the exit code. `stdout` is the requested
/// output: the formatted text, the report, a list. It goes to `to_stdout`. `Output` drops write errors, and with exit
/// code 0 a script like `bun fmt --stdin-filepath f < f > f.tmp && mv f.tmp f` would then lose `f` on a full disk. So
/// that's an error here. A reader that has gone away (`| head`) isn't.
pub(crate) fn print(to_stdout: bun_core::Fd, stdout: &[u8], stderr: &[u8], exit_code: u8) -> u8 {
    let write_result = bun_sys::write_all_to_stdio(to_stdout, stdout);
    let _ = Output::error_writer().write_all(stderr);
    let exit_code = match write_result {
        Err(error) if error.get_errno() != bun_sys::E::EPIPE => {
            let why = error.msg().unwrap_or(b"unknown error");
            Output::err_generic(
                "Cannot write standard output: {}: {}",
                (BStr::new(error.name()), BStr::new(why)),
            );
            2
        }
        _ => exit_code,
    };
    Output::flush();
    exit_code
}

/// Calls `run` with what it needs from this process, prints what it returns, and exits. `command` is `lint` or
/// `format`, and `cwd` is its `--cwd`.
pub(crate) fn run_and_exit(
    command: &[u8],
    cwd: Option<&[u8]>,
    run: impl FnOnce(&Environment) -> Outcome,
) -> ! {
    disallow_code_generation_before(command);
    if let Some(cwd) = cwd_before(command) {
        change_directory(cwd);
    }
    if let Some(cwd) = cwd {
        change_directory(cwd);
    }
    // Start one process at a time, because spawning uses state that threads share.
    let spawn_lock = bun_threading::Guarded::new(());
    let run_script = |script: &Script| {
        let _spawn_guard = spawn_lock.lock();
        run_script(script)
    };
    let run_git = |command: &git::Command| {
        let _spawn_guard = spawn_lock.lock();
        run_git(command)
    };
    let command_line: Vec<&[u8]> = bun_core::argv().iter().skip(1).collect();
    // Only the output goes to fd 1 as it was: it becomes stderr for the rest, like a plugin's `console.log`, before
    // any VM starts. Windows keeps fd 1, so there a plugin's output still lands in the output.
    #[cfg(unix)]
    let to_stdout = (bun_sys::dup(bun_core::Fd::stdout()).map(File::from_fd).ok())
        .filter(|_| bun_sys::dup2(bun_core::Fd::stderr(), bun_core::Fd::stdout()).is_ok())
        .unwrap_or_else(File::stdout);
    #[cfg(not(unix))]
    let to_stdout = File::stdout();
    let js_engine = super::lint_js::Engines::default();
    // `path.win32.resolve` needs it when a path is on a different drive than its base.
    bun_paths::fs::FileSystem::init(&working_directory());
    let environment = Environment {
        cwd: bun_lint_driver::from_native_path(&working_directory()),
        stdout: Stream {
            is_tty: Output::is_stdout_tty(),
            colors: Output::enable_ansi_colors_stdout(),
        },
        stderr: Stream {
            is_tty: Output::is_stderr_tty(),
            colors: Output::enable_ansi_colors_stderr(),
        },
        to_stdout: to_stdout.fd(),
        columns: columns_of,
        is_ai_agent: Output::is_ai_agent(),
        is_github_action: Output::is_github_action(),
        libs: bun_sema_driver::Libs::Bundled(super::typescript_libs::BUNDLED),
        run_script: &run_script,
        run_git: &run_git,
        command_line: &command_line,
        js_engine: &js_engine,
        version: Global::package_json_version.as_bytes(),
        memory: super::lint_js::memory(),
    };
    let outcome = run(&environment);
    // The report is the output. Everything else is printed separately.
    let exit_code = print(
        environment.to_stdout,
        &outcome.stdout,
        &outcome.stderr,
        outcome.exit_code,
    );
    js_engine.end_all();
    Global::exit(u32::from(exit_code));
}

/// Width of the terminal at `fd` in columns: `COLUMNS` if it's set, else what the terminal says, else 80.
fn columns_of(fd: bun_core::Fd) -> u16 {
    if let Some(env) = bun_core::getenv_z(bun_core::zstr!("COLUMNS"))
        && let Ok(n) = bun_core::fmt::parse_int::<u16>(env, 10)
        && n > 0
    {
        return n;
    }
    (bun_core::output::File::from(fd).winsize())
        .map_or(80, |size| if size.col > 0 { size.col } else { 80 })
}

impl Realms for super::lint_js::Engines {
    fn end_all(&self) {
        super::lint_js::Engines::end_all(self);
    }

    fn free_all(&self) {
        super::lint_js::Engines::free_all(self);
    }
}

/// `bun lint --lsp` and `bun fmt --lsp`: serves the editor on standard input and output until it says `exit`.
/// `command` is `lint` or `fmt`, `args` what follows it. `bun fmt --lsp` lints too where the build has `bun lint`.
pub(crate) fn serve_editor(command: &[u8], args: &[&[u8]]) -> ! {
    let (args, features) = match command {
        b"lint" => (
            Args::Lint(args),
            Features {
                lint: true,
                format: true,
            },
        ),
        _ => (
            Args::Format(args),
            Features {
                lint: IS_ENABLED,
                format: true,
            },
        ),
    };
    let from_client = File::stdin();
    run_and_exit(command, None, |environment| {
        // Only the messages go to the client: `run_and_exit` has made fd 1 stderr for the rest.
        let to_client = File::borrow(&environment.to_stdout);
        bun_lint_driver::lsp::serve(
            args,
            environment,
            &Process {
                read: &|buffer| from_client.read(buffer).unwrap_or(0),
                write: &|message| _ = to_client.write_all(message),
                // On Windows fd 1 still carries what a plugin prints, so no plugin runs there.
                engines: &|| {
                    (!cfg!(windows))
                        .then(|| Box::new(super::lint_js::Engines::for_editor()) as Box<dyn Realms>)
                },
                exit: &|code| Global::exit(u32::from(code)),
                features,
                lint_options: &lint_options_in,
                format_options: &format_options_in,
            },
        )
    })
}

impl LintCommand {
    /// True if `bun lint <flag>` is a valid command line.
    pub(crate) fn has_flag(flag: &[u8]) -> bool {
        Options::parse(&[flag]).is_ok()
    }

    /// `args` is what follows `lint`.
    pub(crate) fn exec(ctx: &mut ContextData, args: &[&ZStr]) -> ! {
        let args: Vec<&[u8]> = args.iter().map(|arg| arg.as_bytes()).collect();
        if HAS_TEST_RUNNER && let [b"--run-eslint-tests", rest @ ..] = &args[..] {
            run_and_exit(b"lint", None, |environment| Outcome {
                exit_code: u8::from(!bun_lint_driver::for_tests::run_eslint_tests(
                    rest,
                    environment,
                )),
                ..Outcome::default()
            })
        }
        if HAS_TEST_RUNNER && let [b"--print-markdown-trees", rest @ ..] = &args[..] {
            run_and_exit(b"lint", None, |_| {
                let trees = bun_lint_driver::for_tests::print_markdown_trees(rest);
                Outcome {
                    exit_code: u8::from(trees.is_none()),
                    stdout: trees.unwrap_or_default(),
                    ..Outcome::default()
                }
            })
        }
        if HAS_TEST_RUNNER && let [b"--run-path-tests", rest @ ..] = &args[..] {
            run_and_exit(b"lint", None, |_| {
                let answers = bun_lint_driver::for_tests::run_path_tests(rest);
                Outcome {
                    exit_code: u8::from(answers.is_none()),
                    stdout: answers.unwrap_or_default(),
                    ..Outcome::default()
                }
            })
        }
        let options = match Options::parse(&args) {
            Ok(options) => options,
            Err(UsageError(message)) => run_and_exit(b"lint", None, |environment| {
                bun_lint_driver::reject_command_line(&message, environment)
            }),
        };
        if options.help {
            crate::cli::command::tag_print_help(Tag::LintCommand, options.all);
            Global::exit(0);
        }
        if let Some(message) = options.lsp_conflict_error() {
            run_and_exit(b"lint", None, |environment| {
                bun_lint_driver::reject_command_line(&message, environment)
            })
        }
        if options.lsp {
            serve_editor(b"lint", &args);
        }
        run_and_exit(b"lint", options.cwd.as_deref(), |environment| {
            let mut defaults = LintDefaults::default();
            read_bunfigs(
                ctx,
                Tag::LintCommand,
                b"lint",
                &mut |file, path, is_named| {
                    defaults.read(&options, &environment.cwd, file, path, is_named)
                },
            );
            match defaults.options(&args) {
                Ok(None) => bun_lint_driver::run(&options, environment),
                Ok(Some(options)) => bun_lint_driver::run(&options, environment),
                Err(UsageError(message)) => {
                    bun_lint_driver::reject_command_line(&message, environment)
                }
            }
        })
    }
}
