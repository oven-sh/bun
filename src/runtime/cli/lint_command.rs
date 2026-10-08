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

/// A process that runs a script, and our ends of the pipes to it.
struct Worker {
    /// Closed first: the script ends when there is nothing more to read.
    input: Option<bun_sys::Fd>,
    output: bun_sys::Fd,
}

impl bun_lint_driver::Channel for Worker {
    fn send(&mut self, mut bytes: &[u8]) -> Result<(), Vec<u8>> {
        let input = self.input.ok_or(&b"The pipe is closed."[..])?;
        while !bytes.is_empty() {
            match bun_sys::write(input, bytes) {
                Ok(0) => return Err(b"The process does not read.".to_vec()),
                Ok(count) => bytes = &bytes[count..],
                Err(err) if err.get_errno() == bun_sys::E::INTR => {}
                Err(err) => return Err(err.name().to_vec()),
            }
        }
        Ok(())
    }

    fn receive(&mut self, mut into: &mut [u8]) -> Result<(), Vec<u8>> {
        while !into.is_empty() {
            match bun_sys::read(self.output, into) {
                Ok(0) => return Err(b"The process has ended.".to_vec()),
                Ok(count) => into = &mut into[count..],
                Err(err) if err.get_errno() == bun_sys::E::INTR => {}
                Err(err) => return Err(err.name().to_vec()),
            }
        }
        Ok(())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        if let Some(input) = self.input.take() {
            input.close();
        }
        // Until it has ended, so that what it prints for the user comes before what follows.
        let mut rest = [0; 4096];
        while bun_sys::read(self.output, &mut rest).is_ok_and(|count| count > 0) {}
        self.output.close();
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
    // [read, write]
    let to_worker = bun_sys::pipe().map_err(|err| failed(err.name()))?;
    let from_worker = bun_sys::pipe().map_err(|err| {
        to_worker.iter().for_each(|it| it.close());
        failed(err.name())
    })?;
    let spawned = spawn_process_cstr(
        &SpawnOptions {
            stdin: Stdio::Pipe(to_worker[0]),
            stdout: Stdio::Pipe(from_worker[1]),
            stderr: Stdio::Inherit,
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
    // The ends of the process are its own now.
    to_worker[0].close();
    from_worker[1].close();
    let close_ours = || {
        to_worker[1].close();
        from_worker[0].close();
    };
    match spawned {
        Ok(Ok(_)) => {}
        Ok(Err(err)) => {
            close_ours();
            return Err(failed(err.name()));
        }
        Err(err) => {
            close_ours();
            return Err(failed(err.name().as_bytes()));
        }
    }
    Ok(Box::new(Worker {
        input: Some(to_worker[1]),
        output: from_worker[0],
    }))
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
