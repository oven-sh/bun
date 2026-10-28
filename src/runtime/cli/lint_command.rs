//! `bun lint`: lints a project with ESLint's and typescript-eslint's rules. The implementation is in `bun_lint_driver`.
//! This file provides what the driver needs from the process: the arguments, the terminal, TypeScript's libraries, a
//! way to run a configuration file that's a program, and (`lint_js.rs`) rules written in JavaScript.

use bstr::BStr;

use bun_core::{Global, Output, ZStr};
use bun_lint_driver::cli::{Options, UsageError};
use bun_lint_driver::{Environment, Outcome, Script, Stream, bunfig, git};
use bun_sys::File;

use super::check_command::working_directory;
use super::command::{ContextData, Tag};
use super::script_or_command::{arguments_before, directory_of_cwd, place_of_command};
use bun_bunfig::Above;

pub(crate) struct LintCommand;

pub(crate) use bun_lint_driver::cli::HELP;

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
    if ctx.runtime_options.eval.script.as_deref() == Some(PROGRAM_IS_ON_STDIN)
        && File::stdin().read_to_end_into(&mut program).is_ok()
    {
        ctx.runtime_options.eval.script = Some(program.into_boxed_slice());
        ctx.runtime_options.eval.reads_configuration = true;
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
/// output: the formatted text, the report, a list. `Output` drops write errors, and with exit code 0 a script like
/// `bun fmt --stdin-filepath f < f > f.tmp && mv f.tmp f` would then lose `f` on a full disk. So that's an error here.
/// A reader that has gone away (`| head`) isn't.
pub(crate) fn print(stdout: &[u8], stderr: &[u8], exit_code: u8) -> u8 {
    let write_result = bun_sys::write_all_to_stdio(bun_core::Fd::stdout(), stdout);
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
        columns: super::run_command::RunCommand::columns_of_stdout,
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
    let exit_code = print(&outcome.stdout, &outcome.stderr, outcome.exit_code);
    js_engine.end_all();
    Global::exit(u32::from(exit_code));
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
        run_and_exit(b"lint", options.cwd.as_deref(), |environment| {
            // `[fmt]` is for the rule that compares a file with `bun fmt`'s output. It's the same `[fmt]` that
            // `bun fmt` would read.
            let (mut defaults, mut bun_format_defaults) = (None, None);
            read_bunfigs(
                ctx,
                Tag::LintCommand,
                b"lint",
                &mut |file, path, is_named| {
                    if defaults.is_none() {
                        defaults = bunfig::lint(file)?
                            .map(|it| it.from_bunfig_at(path, is_named, &environment.cwd));
                    }
                    if bun_format_defaults.is_none() {
                        bun_format_defaults =
                            bunfig::format(file)?.map(|it| it.from_bunfig_at(path, is_named));
                    }
                    Ok(match (&defaults, &bun_format_defaults) {
                        (Some(_), Some(_)) => Above::Unwanted,
                        (Some(it), None) if it.mentions_format_rule() => Above::Needed,
                        (Some(_), None) if options.mentions_format_rule() => Above::Needed,
                        (Some(_), None) => Above::Optional,
                        (None, _) => Above::Needed,
                    })
                },
            );
            if let Some(bun_format_defaults) = bun_format_defaults {
                defaults.get_or_insert_default().bun_format_defaults =
                    Some(Box::new(bun_format_defaults));
            }
            match defaults.map(|defaults| Options::parse_with_defaults(defaults, &args)) {
                None => bun_lint_driver::run(&options, environment),
                Some(Ok(options)) => bun_lint_driver::run(&options, environment),
                Some(Err(UsageError(message))) => {
                    bun_lint_driver::reject_command_line(&message, environment)
                }
            }
        })
    }
}
