//! `bun lint`: lints a project with the rules of ESLint and typescript-eslint. All of it is in
//! `bun_lint_driver`. What is here is what that takes from the process: the arguments, the
//! terminal, TypeScript's libraries, and a way to run a configuration file that is a program.

use bstr::BStr;

use bun_core::{Global, Output, ZStr};
use bun_lint_driver::cli::{Options, UsageError};
use bun_lint_driver::{Environment, Outcome, Script, Stream};

use super::check_command::working_directory;

pub(crate) struct LintCommand;

/// For the help.
pub(crate) use bun_lint_driver::cli::PARAMS;

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

/// Runs `script` with this executable, to its end.
fn run_script(script: &Script) -> Result<Vec<u8>, Vec<u8>> {
    use crate::api::bun::process::sync::{Options as SpawnOptions, SyncStdio, spawn};
    let Ok(exe) = bun_core::self_exe_path() else {
        return Err(b"Could not find the path of the running executable.".to_vec());
    };
    let mut argv: Vec<Box<[u8]>> = vec![
        Box::from(exe.as_bytes()),
        Box::from(&b"-e"[..]),
        Box::from(script.source.as_bytes()),
    ];
    argv.extend(script.arguments.iter().map(|it| Box::<[u8]>::from(*it)));
    let spawned = spawn(&SpawnOptions {
        argv,
        stdout: SyncStdio::Buffer,
        stderr: SyncStdio::Buffer,
        stdin: SyncStdio::Ignore,
        cwd: Box::<[u8]>::from(script.cwd),
        envp: None,
        #[cfg(windows)]
        windows: crate::api::bun::process::WindowsOptions {
            loop_: bun_jsc::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
                None, None,
            )),
            ..Default::default()
        },
        ..Default::default()
    });
    match spawned {
        Ok(Ok(result)) if result.is_ok() => Ok(result.stdout),
        Ok(Ok(result)) => Err(result.stderr),
        Ok(Err(err)) => Err([&b"Could not start a process: "[..], err.name()].concat()),
        Err(err) => Err([&b"Could not start a process: "[..], err.name().as_bytes()].concat()),
    }
}

/// Our ends of the pipes to a process that runs a script.
struct Worker {
    /// Closed first: the script ends when there is nothing more to read.
    input: Option<bun_sys::File>,
    output: bun_sys::File,
}

impl bun_lint_driver::Channel for Worker {
    fn send(&mut self, bytes: &[u8]) -> Result<(), Vec<u8>> {
        let input = self.input.as_ref().ok_or(&b"The pipe is closed."[..])?;
        input.write_all(bytes).map_err(|err| err.name().to_vec())
    }

    fn receive(&mut self, into: &mut [u8]) -> Result<(), Vec<u8>> {
        match self.output.read_all(into) {
            Ok(count) if count == into.len() => Ok(()),
            Ok(_) => Err(b"The process has ended.".to_vec()),
            Err(err) => Err(err.name().to_vec()),
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        drop(self.input.take());
        // Until it has ended, so that what it prints for the user comes before what follows.
        let mut rest = [0; 4096];
        while self.output.read(&mut rest).is_ok_and(|count| count > 0) {}
    }
}

/// Starts `script` with this executable.
fn spawn_worker(script: &Script) -> Result<Box<dyn bun_lint_driver::Channel>, Vec<u8>> {
    use crate::api::bun::process::{SpawnEnv, SpawnOptions, Stdio, spawn_process_cstr};
    let failed = |name: &[u8]| [&b"Could not start a process: "[..], name].concat();
    let Ok(exe) = bun_core::self_exe_path() else {
        return Err(b"Could not find the path of the running executable.".to_vec());
    };
    let argv = [exe.as_bytes(), b"-e", script.source.as_bytes()];
    let argv: Vec<std::ffi::CString> = (argv.iter().chain(script.arguments))
        .map(|it| std::ffi::CString::new(*it).map_err(|_| failed(b"an argument has a NUL in it")))
        .collect::<Result<_, _>>()?;
    let argv: Vec<&std::ffi::CStr> = argv.iter().map(|it| it.as_c_str()).collect();
    // The end to read from, and the end to write to.
    let pipe = || bun_sys::pipe().map(|ends| ends.map(bun_sys::File::from_fd)).map_err(|err| failed(err.name()));
    let ([its_input, input], [output, its_output]) = (pipe()?, pipe()?);
    let spawned = spawn_process_cstr(
        &SpawnOptions {
            stdin: Stdio::Ignore,
            // What the script prints is for the user, and not among the messages.
            stdout: Stdio::Pipe(bun_sys::Fd::stderr()),
            stderr: Stdio::Inherit,
            // 3 and 4
            extra_fds: Box::new([Stdio::Pipe(its_input.handle()), Stdio::Pipe(its_output.handle())]),
            cwd: Box::<[u8]>::from(script.cwd),
            #[cfg(windows)]
            windows: crate::api::bun::process::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
                    None, None,
                )),
                ..Default::default()
            },
            ..Default::default()
        },
        &argv,
        SpawnEnv::Inherit,
    );
    match spawned {
        Ok(Ok(_)) => Ok(Box::new(Worker {
            input: Some(input),
            output,
        })),
        Ok(Err(err)) => Err(failed(err.name())),
        Err(err) => Err(failed(err.name().as_bytes())),
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
        is_ai_agent: Output::is_ai_agent(),
        is_github_action: Output::is_github_action(),
        libs: bun_sema_driver::Libs::Bundled(super::typescript_libs::BUNDLED),
        run_script: &run_script,
        spawn_worker: &|script: &Script| {
            let _turn = turn.lock();
            spawn_worker(script)
        },
        version: Global::package_json_version.as_bytes(),
    };
    let outcome = run(&environment);
    // The report is the output. Everything else is printed separately.
    let _ = Output::writer().write_all(&outcome.stdout);
    let _ = Output::error_writer().write_all(&outcome.stderr);
    Output::flush();
    Global::exit(u32::from(outcome.exit_code));
}

impl LintCommand {
    /// `args`: what follows `lint`.
    pub(crate) fn exec(args: &[&ZStr]) -> ! {
        let args: Vec<&[u8]> = args.iter().map(|arg| arg.as_bytes()).collect();
        let options = match Options::parse(&args) {
            Ok(options) => options,
            Err(UsageError(message)) => usage_error("lint", &message),
        };
        if options.help {
            crate::cli::command::tag_print_help(crate::cli::command::Tag::LintCommand, true);
            Global::exit(0);
        }
        run_and_exit(b"lint", options.cwd.as_deref(), |environment| {
            bun_lint_driver::run(&options, environment)
        })
    }
}
