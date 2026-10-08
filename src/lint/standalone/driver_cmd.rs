//! `bun-lint cli ..`: behaves like `bun lint ..`. `bun-lint cli @format ..`: like `bun format ..`.
//!
//! What is Bun's own in `bun lint` is replaced: configuration files that are programs are run by the `bun` in `PATH`, and
//! TypeScript's `lib.*.d.ts` are read from the directory `BUN_SEMA_TS_LIB`.

use crate::host::{self, error_line, os_text, output_line};
use bun_lint_driver::cli::{Options, PARAMS, UsageError};
use bun_lint_driver::{Environment, Script, Stream};
use std::io::{IsTerminal, Write};

fn run_script(script: &Script) -> Result<Vec<u8>, Vec<u8>> {
    let mut command = host::command("bun");
    command
        .arg("-e")
        .arg(script.source)
        .args(script.arguments.iter().map(|it| os_text(it)))
        .current_dir(os_text(script.cwd));
    let output = command
        .output()
        .map_err(|error| format!("Cannot run bun: {error}").into_bytes())?;
    match output.status.success() {
        true => Ok(output.stdout),
        false => Err(output.stderr),
    }
}

fn stream(is_tty: bool) -> Stream {
    let is_set = |name: &str| host::variable(name).is_some_and(|it| !it.is_empty() && it != "0");
    Stream {
        is_tty,
        colors: is_set("FORCE_COLOR") || (is_tty && !is_set("NO_COLOR")),
    }
}

fn print_help(name: &str, params: &[bun_lint_driver::Param]) {
    output_line!("Usage: bun {name} [flags] [...files, directories or patterns]\n\nFlags:");
    for param in params.iter().filter(|it| !it.id.msg_plain.is_empty()) {
        let short = param
            .names
            .short
            .map_or_else(|| "    ".to_owned(), |it| format!("-{}, ", it as char));
        let long = crate::text(param.names.long.unwrap_or_default());
        output_line!("  {short}--{long:<44} {}", crate::text(param.id.msg_plain));
    }
}

fn or_exit<T>(parsed: Result<T, UsageError>) -> T {
    parsed.unwrap_or_else(|UsageError(message)| {
        error_line!("error: {}", crate::text(&message));
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
        [b"--run-eslint-tests", ..] => Command::Lint(Box::default()),
        [b"@format", rest @ ..] => Command::Format(Box::new(or_exit(
            bun_lint_driver::fmt::cli::Options::parse(rest),
        ))),
        args => Command::Lint(Box::new(or_exit(Options::parse(args)))),
    };
    let (help, cwd) = match &command {
        Command::Lint(options) => (options.help.then_some(("lint", PARAMS)), &options.cwd),
        Command::Format(options) => (
            options
                .help
                .then_some(("format", bun_lint_driver::fmt::cli::PARAMS)),
            &options.cwd,
        ),
    };
    if let Some((name, params)) = help {
        return print_help(name, params);
    }
    if let Some(cwd) = cwd
        && let Err(error) = std::env::set_current_dir(os_text(cwd))
    {
        error_line!(
            "error: Could not change directory to \"{}\": {error}",
            crate::text(cwd)
        );
        std::process::exit(1);
    }
    let libs = host::variable("BUN_SEMA_TS_LIB")
        .unwrap_or_default()
        .into_bytes();
    // `Output::is_ai_agent`
    let is_one = |name: &str| host::variable(name).map(|it| it == "1");
    let is_agent = is_one("AGENT")
        .unwrap_or_else(|| is_one("CLAUDECODE") == Some(true) || is_one("REPL_ID") == Some(true));
    let processes = crate::js_plugin_cmd::new_processes(
        std::thread::available_parallelism().map_or(1, usize::from),
    );
    let environment = Environment {
        cwd: std::env::current_dir()
            .expect("the working directory")
            .into_os_string()
            .into_encoded_bytes(),
        stdout: stream(std::io::stdout().is_terminal()),
        stderr: stream(std::io::stderr().is_terminal()),
        is_ai_agent: is_agent,
        is_github_action: !is_agent
            && host::variable("GITHUB_ACTIONS").is_some_and(|it| it == "true"),
        libs: bun_sema_driver::Libs::Directory(&libs),
        run_script: &run_script,
        js_engine: &processes,
        version: b"0.0.0-harness",
    };
    if let [b"--run-eslint-tests", rest @ ..] = &args[..] {
        std::process::exit(i32::from(!bun_lint_driver::for_tests::run_eslint_tests(
            rest,
            &environment,
        )));
    }
    let outcome = match &command {
        Command::Lint(options) => bun_lint_driver::run(options, &environment),
        Command::Format(options) => bun_lint_driver::fmt::run(options, &environment),
    };
    let _ = std::io::stdout().write_all(&outcome.stdout);
    let _ = std::io::stderr().write_all(&outcome.stderr);
    std::process::exit(i32::from(outcome.exit_code));
}
