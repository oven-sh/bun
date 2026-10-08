//! `bun-lint cli ..`: behaves like `bun lint ..`. `bun-lint cli @format ..`: like `bun format ..`.
//!
//! What is Bun's own in `bun lint` is replaced: configuration files that are programs are run by the `bun` in `PATH`, and
//! TypeScript's `lib.*.d.ts` are read from the directory `BUN_SEMA_TS_LIB`.

use bun_lint_driver::cli::{Options, PARAMS, UsageError};
use bun_lint_driver::{Environment, Script, Stream};
use std::io::{IsTerminal, Write};
use std::os::unix::ffi::{OsStrExt, OsStringExt};

fn os(bytes: &[u8]) -> &std::ffi::OsStr {
    std::ffi::OsStr::from_bytes(bytes)
}

struct Worker {
    child: std::process::Child,
    input: Option<std::process::ChildStdin>,
    output: std::process::ChildStdout,
}

impl bun_lint::js_plugin::Channel for Worker {
    fn send(&mut self, bytes: &[u8]) -> Result<(), Vec<u8>> {
        let input = self.input.as_mut().ok_or(b"closed".as_slice())?;
        std::io::Write::write_all(input, bytes).map_err(|error| error.to_string().into_bytes())
    }

    fn receive(&mut self, into: &mut [u8]) -> Result<(), Vec<u8>> {
        std::io::Read::read_exact(&mut self.output, into).map_err(|error| error.to_string().into_bytes())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        drop(self.input.take());
        let _ = self.child.wait();
    }
}

fn spawn_worker(script: &Script) -> Result<Box<dyn bun_lint::js_plugin::Channel>, Vec<u8>> {
    use std::process::Stdio;
    let mut command = std::process::Command::new(std::env::var("BUN_LINT_BUN").unwrap_or_else(|_| "bun".to_owned()));
    command.arg("-e").arg(script.source).args(script.arguments.iter().map(|it| os(it))).current_dir(os(script.cwd));
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().map_err(|error| error.to_string().into_bytes())?;
    let (input, output) = (child.stdin.take(), child.stdout.take());
    Ok(Box::new(Worker {
        child,
        input,
        output: output.ok_or(b"no pipe".as_slice())?,
    }))
}

fn run_script(script: &Script) -> Result<Vec<u8>, Vec<u8>> {
    let mut command = std::process::Command::new("bun");
    command.arg("-e").arg(script.source).args(script.arguments.iter().map(|it| os(it))).current_dir(os(script.cwd));
    let output = command.output().map_err(|error| format!("Cannot run bun: {error}").into_bytes())?;
    match output.status.success() {
        true => Ok(output.stdout),
        false => Err(output.stderr),
    }
}

fn stream(is_tty: bool) -> Stream {
    let is_set = |name: &str| std::env::var_os(name).is_some_and(|it| !it.is_empty() && it != "0");
    Stream {
        is_tty,
        colors: is_set("FORCE_COLOR") || (is_tty && !is_set("NO_COLOR")),
    }
}

fn print_help(name: &str, params: &[bun_lint_driver::Param]) {
    println!("Usage: bun {name} [flags] [...files, directories or patterns]\n\nFlags:");
    for param in params.iter().filter(|it| !it.id.msg_plain.is_empty()) {
        let short = param.names.short.map_or("    ".to_owned(), |it| format!("-{}, ", it as char));
        let long = crate::text(param.names.long.unwrap_or_default());
        println!("  {short}--{long:<44} {}", crate::text(param.id.msg_plain));
    }
}

fn or_exit<T>(parsed: Result<T, UsageError>) -> T {
    parsed.unwrap_or_else(|UsageError(message)| {
        eprintln!("error: {}", crate::text(&message));
        std::process::exit(2);
    })
}

enum Command {
    Lint(Box<Options>),
    Format(Box<bun_lint_driver::fmt::cli::Options>),
}

pub(crate) fn run(args: &[String]) {
    let args: Vec<&[u8]> = args.iter().map(String::as_bytes).collect();
    let command = match &args[..] {
        [b"@format", rest @ ..] => Command::Format(Box::new(or_exit(bun_lint_driver::fmt::cli::Options::parse(rest)))),
        args => Command::Lint(Box::new(or_exit(Options::parse(args)))),
    };
    let (help, cwd) = match &command {
        Command::Lint(options) => (options.help.then_some(("lint", PARAMS)), &options.cwd),
        Command::Format(options) => (options.help.then_some(("format", bun_lint_driver::fmt::cli::PARAMS)), &options.cwd),
    };
    if let Some((name, params)) = help {
        return print_help(name, params);
    }
    if let Some(cwd) = cwd
        && let Err(error) = std::env::set_current_dir(os(cwd))
    {
        eprintln!("error: Could not change directory to \"{}\": {error}", crate::text(cwd));
        std::process::exit(1);
    }
    let libs = std::env::var_os("BUN_SEMA_TS_LIB").unwrap_or_default().into_vec();
    // `Output::is_ai_agent`
    let is_one = |name: &str| std::env::var_os(name).map(|it| it == "1");
    let is_agent = is_one("AGENT").unwrap_or_else(|| is_one("CLAUDECODE") == Some(true) || is_one("REPL_ID") == Some(true));
    let environment = Environment {
        cwd: std::env::current_dir().expect("the working directory").into_os_string().into_vec(),
        stdout: stream(std::io::stdout().is_terminal()),
        stderr: stream(std::io::stderr().is_terminal()),
        is_ai_agent: is_agent,
        is_github_action: !is_agent && std::env::var_os("GITHUB_ACTIONS").is_some_and(|it| it == "true"),
        libs: bun_sema_driver::Libs::Directory(&libs),
        run_script: &run_script,
        spawn_worker: &spawn_worker,
        version: b"0.0.0-harness",
    };
    let outcome = match &command {
        Command::Lint(options) => bun_lint_driver::run(options, &environment),
        Command::Format(options) => bun_lint_driver::fmt::run(options, &environment),
    };
    let _ = std::io::stdout().write_all(&outcome.stdout);
    let _ = std::io::stderr().write_all(&outcome.stderr);
    std::process::exit(i32::from(outcome.exit_code));
}
