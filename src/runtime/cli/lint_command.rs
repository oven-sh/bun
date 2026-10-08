//! `bun lint`: lints a project with the rules of ESLint and typescript-eslint. All of it is in
//! `bun_lint_driver`. What is here is what that takes from the process: the arguments, the
//! terminal, TypeScript's libraries, and a way to run a configuration file that is a program.
//!
//! Also what makes `bun lint` and `bun format` run the script of that name, if the project has
//! one: see [`is_package_script`].

use bstr::BStr;

use bun_core::{Global, Output, UnwrapOrOom, ZStr, env_var};
use bun_lint_driver::cli::{Options, UsageError};
use bun_lint_driver::{Environment, Script, Stream};

pub(crate) struct LintCommand;

/// For the help.
pub(crate) use bun_lint_driver::cli::PARAMS;

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

impl LintCommand {
    /// `args`: what follows `lint`.
    pub(crate) fn exec(args: &[&ZStr]) -> ! {
        let args: Vec<&[u8]> = args.iter().map(|arg| arg.as_bytes()).collect();
        let options = match Options::parse(&args) {
            Ok(options) => options,
            Err(UsageError(message)) => {
                Output::err_generic("{}", (BStr::new(&message),));
                bun_core::note!("run 'bun lint --help' for more information");
                // As ESLint.
                Global::exit(2);
            }
        };
        if options.help {
            crate::cli::command::tag_print_help(crate::cli::command::Tag::LintCommand, true);
            Global::exit(0);
        }
        if let Some(cwd) = cwd_before(b"lint") {
            change_directory(cwd);
        }
        if let Some(cwd) = &options.cwd {
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
            version: Global::package_json_version.as_bytes(),
        };
        let outcome = bun_lint_driver::run(&options, &environment);
        // The report is the output, as with ESLint. Everything else is printed separately.
        let _ = Output::writer().write_all(&outcome.stdout);
        let _ = Output::error_writer().write_all(&outcome.stderr);
        Output::flush();
        Global::exit(u32::from(outcome.exit_code));
    }
}

// ───────────────────── `"lint": "eslint ."` in package.json ─────────────────────

/// Whether `command`, which is `lint` or `format`, is a script of the project: of the nearest
/// `package.json`, which is where `bun run` looks. `bun lint` ran it before there was a linter, so
/// it still does. `check_command::is_package_script` is the same for `check`.
#[cold]
#[inline(never)]
pub(crate) fn is_package_script(command: &[u8]) -> bool {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::join_abs_string;
    let mut cwd = working_directory();
    let mut args = bun_core::argv().into_iter();
    while let Some(arg) = args.next() {
        // What follows the name of a script is for the script.
        if arg == command {
            break;
        }
        // These are about scripts: those of several packages, whatever this one has, or none.
        if matches!(
            arg,
            b"--workspaces" | b"--parallel" | b"--sequential" | b"--if-present"
        ) || arg.starts_with(b"--filter")
            || arg.starts_with(b"-F")
        {
            return true;
        }
        let given = match arg.strip_prefix(b"--cwd") {
            Some(b"") => args.next(),
            Some(rest) => rest.strip_prefix(b"="),
            None => None,
        };
        if let Some(given) = given {
            cwd = join_abs_string::<Auto>(&cwd, &[given]).to_vec();
        }
    }
    let Some((dir, path, contents)) = nearest_package_json(&cwd) else {
        return false;
    };
    // In that script, and in what it runs, it is the linter: `"lint": "bun lint"`.
    let running = env_var::BUN_INTERNAL_LINT_SCRIPTS::get();
    if running.is_some_and(|running| running_package_scripts(running).any(|it| it == (command, dir)))
    {
        return false;
    }
    if package_of_inherited_script(command).is_some_and(|it| it == dir) {
        return false;
    }
    // Most have no such word in them.
    if !bun_core::strings::contains(&contents, &[&b"\""[..], command, b"\""].concat()) {
        return false;
    }
    bun_ast::initialize_store();
    let source = bun_ast::Source::init_path_string(&path[..], &contents[..]);
    let (mut log, bump) = (bun_ast::Log::init(), bun_alloc::Arena::new());
    let Ok(json) = bun_parsers::json::parse_package_json_utf8(&source, &mut log, &bump) else {
        return false;
    };
    (json.as_property(b"scripts"))
        .and_then(|scripts| scripts.expr.as_property(command))
        .is_some_and(|script| matches!(script.expr.data, bun_ast::ExprData::EString(_)))
}

/// The `package.json` nearest to `dir`, which is where `bun run` looks: its directory, its path and
/// its text.
fn nearest_package_json(mut dir: &[u8]) -> Option<(&[u8], Vec<u8>, Vec<u8>)> {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::{dirname, join_abs_string};
    loop {
        let path = join_abs_string::<Auto>(dir, &[b"package.json"]).to_vec();
        if let Ok(contents) = bun_sys::File::read_from(bun_core::Fd::cwd(), &path) {
            let dir = bun_core::strings::without_trailing_slash(dir);
            return Some((dir, path, contents));
        }
        let parent = dirname::<Auto>(dir);
        if parent.is_empty() || parent.len() >= dir.len() {
            return None;
        }
        dir = parent;
    }
}

/// The entries of `BUN_INTERNAL_LINT_SCRIPTS`: a command and the directory of a package. Each is
/// the command, `:`, a length, `:` and as many bytes, since a path can have any byte in it.
fn running_package_scripts(mut running: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    core::iter::from_fn(move || {
        let colon = bun_core::strings::index_of_char_usize(running, b':')?;
        let (command, rest) = (&running[..colon], &running[colon + 1..]);
        let colon = bun_core::strings::index_of_char_usize(rest, b':')?;
        let len: usize = core::str::from_utf8(&rest[..colon]).ok()?.parse().ok()?;
        let (dir, rest) = rest[colon + 1..].split_at_checked(len)?;
        running = rest;
        Some((command, dir))
    })
}

/// The command whose script `name` is, or runs with: `bun run lint` runs `prelint`, `lint` and
/// `postlint`.
fn command_of_script(name: &[u8]) -> Option<&'static [u8]> {
    match name {
        b"lint" | b"prelint" | b"postlint" => Some(b"lint"),
        b"format" | b"preformat" | b"postformat" => Some(b"format"),
        _ => None,
    }
}

/// The directory of the package whose `command` script another package manager has started, with
/// this process in it. npm, pnpm and yarn say which script they run. Not all say of which package:
/// then it is the one that this process is started in, not each one whose scripts it runs.
fn package_of_inherited_script(command: &[u8]) -> Option<Vec<u8>> {
    use bun_paths::{platform::Auto, resolve_path::dirname};
    if env_var::npm_lifecycle_event::get().and_then(command_of_script) != Some(command) {
        return None;
    }
    match env_var::npm_package_json::get() {
        Some(of) => Some(bun_core::strings::without_trailing_slash(dirname::<Auto>(of)).to_vec()),
        None if env_var::BUN_INTERNAL_LINT_SCRIPTS::get().is_some() => None,
        None => Some(nearest_package_json(&working_directory())?.0.to_vec()),
    }
}

/// Makes `env` that of the script `name` of the package that has `dir`. See `is_package_script`.
pub(crate) fn note_package_script(env: &mut bun_dotenv::Loader, name: &[u8], dir: &[u8]) {
    use std::io::Write;
    let key = b"BUN_INTERNAL_LINT_SCRIPTS";
    // As `is_package_script` finds it, wherever in the package the script is started.
    let Some((dir, ..)) = nearest_package_json(dir) else {
        return;
    };
    let mut running = env.get(key).unwrap_or_default().to_vec();
    let mut note = |command: &[u8], dir: &[u8]| {
        if !running_package_scripts(&running).any(|it| it == (command, dir)) {
            running.extend_from_slice(command);
            let _ = write!(running, ":{}:", dir.len());
            running.extend_from_slice(dir);
        }
    };
    // `name` takes the place of what another package manager has said, for what the script runs.
    for command in [&b"lint"[..], b"format"] {
        if let Some(inherited) = package_of_inherited_script(command) {
            note(command, &inherited);
        }
    }
    if let Some(command) = command_of_script(name) {
        note(command, dir);
    }
    if !running.is_empty() {
        env.map.put(key, &running).unwrap_or_oom();
    }
}

/// `note_package_script` for as long as `with` takes: `env` is that of other scripts too.
pub(crate) fn with_package_script<R>(
    env: &mut bun_dotenv::Loader,
    name: &[u8],
    dir: &[u8],
    with: impl FnOnce(&mut bun_dotenv::Loader) -> R,
) -> R {
    let key = b"BUN_INTERNAL_LINT_SCRIPTS";
    let before = env.get(key).map(<[u8]>::to_vec);
    note_package_script(env, name, dir);
    let result = with(env);
    match before {
        Some(before) => env.map.put(key, &before).unwrap_or_oom(),
        None => env.map.remove(key),
    }
    result
}
