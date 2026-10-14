//! `bun lint`: lints a project with the rules of ESLint and typescript-eslint. All of it is in
//! `bun_lint_driver`. What is here is what that takes from the process: the arguments, the
//! terminal, TypeScript's libraries, a way to run a configuration file that is a program, and
//! (`lint_js.rs`) rules that are written in JavaScript.

use bstr::BStr;

use bun_core::{Global, Output, ZStr};
use bun_lint_driver::cli::{Options, UsageError};
use bun_lint_driver::{Environment, Outcome, Script, Stream, bunfig, git};
use bun_sys::File;

use super::check_command::working_directory;
use super::command::{ContextData, Tag};
use bun_bunfig::Above;

pub(crate) struct LintCommand;

pub(crate) use bun_lint_driver::cli::HELP;

/// Whether `bun lint --run-eslint-tests` exists, for `test/cli/lint/conformance.test.ts`. A release
/// build has none of it.
const HAS_TEST_RUNNER: bool = bun_core::Environment::IS_CANARY || bun_core::Environment::IS_DEBUG;

fn change_directory(cwd: &[u8]) {
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

/// `--cwd` among the flags of `bun`, which precede `command`.
fn cwd_before(command: &[u8]) -> Option<&'static [u8]> {
    let mut found = None;
    let mut args = bun_core::argv().into_iter();
    while let Some(arg) = args.next() {
        if arg == command {
            break;
        }
        let given = match arg.strip_prefix(b"--cwd") {
            Some(b"") => args.next(),
            Some(rest) => rest.strip_prefix(b"="),
            None => None,
        };
        found = given.or(found);
    }
    found
}

/// `--config=<path>` among the flags of `bun`, which precede `command`. Without the `=` the path is taken for the command.
fn bunfig_before(command: &[u8]) -> Option<&'static [u8]> {
    let flags = (bun_core::argv().into_iter()).take_while(|arg| *arg != command);
    flags
        .filter_map(|arg| {
            arg.strip_prefix(b"--config=")
                .or_else(|| arg.strip_prefix(b"-c="))
        })
        .last()
}

/// Has `read` read the bunfig.toml files that can say something to `command`, each with its path from the working directory
/// and whether `--config` names it: the one in the working directory, then those above it, from the nearest, for as long as
/// `read` wants the next. With `--config` there is only that file. Call this after `--cwd`.
pub(crate) fn read_bunfigs(
    ctx: &mut ContextData,
    tag: Tag,
    command: &[u8],
    read: &mut dyn FnMut(&bun_ast::Expr, &[u8], bool) -> Result<Above, bunfig::Refusal>,
) {
    let named = bunfig_before(command);
    let mut read = |file: &bun_ast::Expr, path: &[u8]| {
        read(file, path, named.is_some()).map_err(|refusal| (refusal.at, refusal.message))
    };
    let mut above = Above::Needed;
    let here = &mut |file: &bun_ast::Expr| {
        above = read(file, named.unwrap_or(b"bunfig.toml"))?;
        Ok(())
    };
    if let Err(err) = bun_bunfig::load_config_for_tool(tag, named, ctx, Some(here)) {
        Output::err(err, "failed to load bunfig", ());
        Global::exit(2);
    }
    if named.is_none() && above != Above::Unwanted {
        bun_bunfig::load_config_above_for_tool(tag, ctx, above, &mut read);
    }
}

/// `--disallow-code-generation-from-strings` among the flags of `bun`, which precede `command`: it holds for the plugins and
/// the configuration files.
fn disallow_code_generation_before(command: &[u8]) {
    let argv = bun_core::argv().to_vec();
    let flags = argv.iter().take_while(|it| it.as_bytes() != command);
    super::arguments::disallow_code_generation_from_strings_as_compiled(
        &flags.copied().collect::<Vec<_>>(),
    );
}

/// What `-e` has in a process that `run_script` starts.
const PROGRAM_IS_ON_STDIN: &[u8] = b"\x1e--bun-lint-program--\x1e";

/// In such a process: reads the program.
pub(crate) fn read_program_of_script(ctx: &mut ContextData) {
    let mut program = Vec::new();
    if *ctx.runtime_options.eval.script == *PROGRAM_IS_ON_STDIN
        && File::stdin().read_to_end_into(&mut program).is_ok()
    {
        ctx.runtime_options.eval.script = program.into_boxed_slice();
    }
}

/// Runs `script` with this executable, to its end.
fn run_script(script: &Script) -> Result<Vec<u8>, Vec<u8>> {
    let Ok(exe) = bun_core::self_exe_path() else {
        return Err(b"Could not find the path of the running executable.".to_vec());
    };
    let mut argv: Vec<Box<[u8]>> = vec![
        Box::from(exe.as_bytes()),
        // What is not installed is missing: nothing is fetched to read a configuration.
        Box::from(&b"--no-install"[..]),
        // It ends with this process, however that ends: a configuration can wait, or spin, for ever.
        Box::from(&b"--no-orphans"[..]),
        // Node, in which ESLint, Prettier and oxlint read a configuration, reads no `.env`.
        Box::from(&b"--no-env-file"[..]),
    ];
    use bun_core::CodeGenerationFromStrings as Level;
    match bun_core::code_generation_from_strings() {
        Level::Allowed => {}
        Level::DisallowedLikeNode => {
            argv.push(Box::from(&b"--disallow-code-generation-from-strings"[..]));
        }
        Level::Disallowed => {
            argv.push(Box::from(
                &b"--disallow-code-generation-from-strings=strict"[..],
            ));
        }
    }
    // Nor a bunfig.toml, whose `preload` would run before the configuration. Windows has no file that is empty wherever one is.
    if cfg!(not(windows)) {
        argv.push(Box::from(&b"--config=/dev/null"[..]));
    }
    // Not the program: the command line of a process has room for 32,767 characters on Windows, and an argument for 128 KB on
    // Linux.
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

/// Runs `argv` in `cwd` with `input` on its stdin, and waits for it to exit. The child gets this process's environment after
/// `adapt` has changed it. `adapt` returns false if it couldn't. `Err` says why the command didn't run.
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
    let [read, written] = match bun_sys::pipe() {
        Ok(ends) => ends.map(File::from_fd),
        Err(err) => return Err([&b"Could not start a process: "[..], err.name()].concat()),
    };
    // The process is not to have the end that is written to: it would wait for itself to close it.
    #[cfg(unix)]
    for end in [&read, &written] {
        let _ = bun_sys::set_close_on_exec(end.handle());
    }
    let options = SpawnOptions {
        argv,
        stdout: SyncStdio::Buffer,
        stderr: SyncStdio::Buffer,
        stdin: SyncStdio::Pipe(read.handle()),
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
    // It is written while what the program prints is read, so neither waits for the other.
    let spawned = std::thread::scope(|scope| {
        scope.spawn(move || input.iter().try_for_each(|it| written.write_all(it)));
        let spawned = spawn(&options);
        // Who still writes is told that nobody reads any more.
        drop(read);
        spawned
    });
    match spawned {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(err)) => Err([&b"Could not start a process: "[..], err.name()].concat()),
        Err(err) => Err([&b"Could not start a process: "[..], err.name().as_bytes()].concat()),
    }
}

/// Reports that the command line of `bun <command>` cannot be used.
pub(crate) fn usage_error(command: &str, message: &[u8]) -> ! {
    Output::err_generic("{}", (BStr::new(message),));
    bun_core::note!("run 'bun {} --help' for more information", command);
    // As ESLint.
    Global::exit(2);
}

/// Calls `run` with what it takes from this process, prints what it returns, and exits.
/// `command`: `lint` or `format`. `cwd`: its `--cwd`.
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
    // One at a time: a process is started with state that threads share.
    let turn = bun_threading::Guarded::new(());
    let run_script = |script: &Script| {
        let _turn = turn.lock();
        run_script(script)
    };
    let run_git = |command: &git::Command| {
        let _turn = turn.lock();
        run_git(command)
    };
    let command_line: Vec<&[u8]> = bun_core::argv().iter().skip(1).collect();
    let js_engine = super::lint_js::Engines::default();
    // `path.win32.resolve` asks for it where a path names another drive than its base.
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
    let _ = Output::writer().write_all(&outcome.stdout);
    let _ = Output::error_writer().write_all(&outcome.stderr);
    Output::flush();
    js_engine.end_all();
    Global::exit(u32::from(outcome.exit_code));
}

impl LintCommand {
    /// Whether `bun lint <flag>` is a valid command line.
    pub(crate) fn has_flag(flag: &[u8]) -> bool {
        Options::parse(&[flag]).is_ok()
    }

    /// `args`: what follows `lint`.
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
                bun_lint_driver::refuse_command_line(&message, environment)
            }),
        };
        if options.help {
            crate::cli::command::tag_print_help(Tag::LintCommand, options.all);
            Global::exit(0);
        }
        run_and_exit(b"lint", options.cwd.as_deref(), |environment| {
            // `[fmt]` is for the rule that holds a file against what `bun fmt` prints: it is the one that `bun fmt` would read.
            let (mut defaults, mut of_bun_format) = (None, None);
            read_bunfigs(
                ctx,
                Tag::LintCommand,
                b"lint",
                &mut |file, path, is_named| {
                    if defaults.is_none() {
                        defaults = bunfig::lint(file)?
                            .map(|it| it.of_bunfig_at(path, is_named, &environment.cwd));
                    }
                    if of_bun_format.is_none() {
                        of_bun_format =
                            bunfig::format(file)?.map(|it| it.of_bunfig_at(path, is_named));
                    }
                    Ok(match (&defaults, &of_bun_format) {
                        (Some(_), Some(_)) => Above::Unwanted,
                        (Some(it), None) if it.names_a_format_rule() => Above::Needed,
                        (Some(_), None) if options.names_a_format_rule() => Above::Needed,
                        (Some(_), None) => Above::Optional,
                        (None, _) => Above::Needed,
                    })
                },
            );
            if let Some(of_bun_format) = of_bun_format {
                defaults.get_or_insert_default().of_bun_format = Some(Box::new(of_bun_format));
            }
            match defaults.map(|defaults| Options::parse_over(defaults, &args)) {
                None => bun_lint_driver::run(&options, environment),
                Some(Ok(options)) => bun_lint_driver::run(&options, environment),
                Some(Err(UsageError(message))) => {
                    bun_lint_driver::refuse_command_line(&message, environment)
                }
            }
        })
    }
}
