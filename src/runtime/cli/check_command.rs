//! `bun check`: type checks a TypeScript project. `bun run --check` and `bun build --check` go through [`check_before`].

use bstr::BStr;

use bun_core::{Global, Output, ZStr, env_var};
use bun_sema_driver::format::{self, Layout, Style};
use bun_sema_driver::{Report, Request};

pub(crate) struct CheckCommand;

#[derive(Default)]
struct Options {
    project: Option<String>,
    paths: Vec<String>,
    threads: usize,
    /// `--pretty`, `--no-pretty`. Not said: by where the output goes.
    pretty: Option<bool>,
    timing: bool,
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
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
            options.paths.push(text(arg));
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
            options.project = Some(text(project));
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
            match text(threads).parse::<usize>() {
                Ok(n) if n > 0 => options.threads = n,
                _ => usage_error(format_args!(
                    "--threads takes a number above zero, not \"{}\"",
                    BStr::new(threads)
                )),
            }
        } else if arg == b"--pretty" || arg == b"--pretty=true" {
            options.pretty = Some(true);
        } else if arg == b"--no-pretty" || arg == b"--pretty=false" {
            options.pretty = Some(false);
        } else if arg == b"--timing" {
            options.timing = true;
        } else if arg == b"--noEmit" || arg == b"--no-emit" {
            // What `tsc --noEmit` is written for is all this does.
        } else {
            usage_error(format_args!("Unknown flag \"{}\"", BStr::new(arg)));
        }
    }
    options
}

fn working_directory() -> String {
    let mut buf = bun_paths::path_buffer_pool::get();
    match bun_core::getcwd(&mut buf) {
        Ok(cwd) => text(cwd.as_bytes()),
        Err(err) => {
            Output::err(err, "Could not read the working directory", ());
            Global::exit(1);
        }
    }
}

/// Where `bun add -g` puts packages.
fn global_node_modules() -> Option<String> {
    if let Some(dir) = env_var::BUN_INSTALL_GLOBAL_DIR.get() {
        return Some(format!("{}/node_modules", text(dir)));
    }
    if let Some(dir) = env_var::BUN_INSTALL.get() {
        return Some(format!("{}/install/global/node_modules", text(dir)));
    }
    env_var::HOME
        .get()
        .map(|home| format!("{}/.bun/install/global/node_modules", text(home)))
}

fn run(cwd: &str, project: Option<&str>, paths: &[String], threads: usize) -> Report {
    let global = global_node_modules();
    bun_sema_driver::check(&Request {
        cwd,
        project,
        paths,
        threads,
        lib_dir: None,
        global_node_modules: global.as_deref(),
        file_time_limit: core::time::Duration::from_secs(10),
        loaded: None,
        checked: None,
    })
}

/// A person at a terminal gets the source around each error, and so does an agent, in tags and without colors, which spares it opening
/// the files. A pipe or continuous integration gets a line an error.
fn style_for(cwd: &str, pretty: Option<bool>, is_tty: bool, colors: bool) -> Style<'_> {
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
            options.threads,
        );
        let shown_from = bun_sema_driver::host::from_native(&cwd);
        // The errors are the output, as they are of `tsc`. How it went is said on the side.
        let mut out = String::new();
        format::write_diagnostics(
            &mut out,
            &report,
            &style_for(
                &shown_from,
                options.pretty,
                Output::is_stdout_tty(),
                Output::enable_ansi_colors_stdout(),
            ),
        );
        let _ = Output::writer().write_all(out.as_bytes());
        let mut summary = String::new();
        format::write_summary(
            &mut summary,
            &report,
            &Style {
                color: Output::enable_ansi_colors_stderr(),
                ..style_for(&shown_from, options.pretty, Output::is_stderr_tty(), true)
            },
        );
        if options.timing {
            use core::fmt::Write;
            let _ = writeln!(
                summary,
                "  {} files loaded in {:.1}ms, {} checked in {:.1}ms",
                report.files_loaded,
                report.load_time.as_secs_f64() * 1000.0,
                report.files_checked,
                report.check_time.as_secs_f64() * 1000.0,
            );
        }
        let _ = Output::error_writer().write_all(summary.as_bytes());
        Output::flush();
        Global::exit(u32::from(report.error_count() > 0));
    }
}

/// Type checks `entry_points` and everything they import before they are run or bundled. Says what is wrong on stderr, which leaves
/// stdout to the program. Whether there is nothing wrong.
pub(crate) fn check_before(entry_points: &[&[u8]]) -> bool {
    // What is no TypeScript or JavaScript has no types to check: `[eval]`, a stylesheet, a page.
    const CHECKED: [&[u8]; 8] = [
        b".ts", b".tsx", b".mts", b".cts", b".js", b".jsx", b".mjs", b".cjs",
    ];
    let paths: Vec<String> = entry_points
        .iter()
        .filter(|path| CHECKED.iter().any(|extension| path.ends_with(extension)))
        .map(|path| text(path))
        .collect();
    if paths.is_empty() {
        return true;
    }
    let cwd = working_directory();
    let report = run(&cwd, None, &paths, 0);
    if report.diagnostics.is_empty() && report.gave_up.is_empty() {
        return true;
    }
    let shown_from = bun_sema_driver::host::from_native(&cwd);
    let style = style_for(
        &shown_from,
        None,
        Output::is_stderr_tty(),
        Output::enable_ansi_colors_stderr(),
    );
    let mut out = String::new();
    format::write_diagnostics(&mut out, &report, &style);
    if report.error_count() > 0 || !report.gave_up.is_empty() {
        format::write_summary(&mut out, &report, &style);
    }
    let _ = Output::error_writer().write_all(out.as_bytes());
    Output::flush();
    report.error_count() == 0
}
