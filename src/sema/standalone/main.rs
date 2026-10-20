use bun_sema::messages::text;
use bun_sema_baselines::error_line;
use std::io::Write;

fn variable(name: &bun_core::ZStr) -> Option<String> {
    bun_core::getenv_z(name).map(text)
}

#[cfg(bun_sema_mimalloc)]
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

fn main() {
    // The main thread parses tsconfig.json. Its stack is 8 MB on macOS and Linux.
    bun_sema_standalone::native::set_stack_size(7 << 20);
    let args: Vec<String> = std::env::args().skip(1).collect();
    run(&args);
}

fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("cli") => {
            // cli [paths..] [@<response file>] [-b] [-p <project>] [--<compiler option> [value]]
            // [--threads=n] [--plain] [--no-color] [--github] [--timing]: behaves like `bun check`.
            use bun_sema_driver::format::{Layout, Style, write_diagnostics, write_summary};
            let has = |flag: &str| args.iter().any(|a| a == flag);
            let cwd = std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let arguments: Vec<&[u8]> = args[1..].iter().map(|arg| arg.as_bytes()).collect();
            let command_line = bun_sema_driver::parse_command_line(&arguments, cwd.as_bytes());
            for rejected in &command_line.rejected {
                // A flag that isn't a compiler option is one of this tool's own flags, handled below.
                if !matches!(rejected.error, bun_sema_driver::FlagError::Unknown) {
                    let flag = text(&rejected.flag);
                    error_line!("skipping {flag}: missing or invalid value");
                }
            }
            let lib_dir = variable(bun_core::zstr!("BUN_SEMA_TS_LIB"));
            let plan_options = bun_sema_driver::PlanOptions {
                task_size: match args.iter().find_map(|a| a.strip_prefix("--task-size=")) {
                    None => bun_sema_driver::TaskSize::ByCost,
                    Some("one-file") => bun_sema_driver::TaskSize::OneFile,
                    Some("unlimited") => bun_sema_driver::TaskSize::Unlimited,
                    Some(other) => panic!("--task-size={other}"),
                },
                discards_first_visits: has("--discard-first-visits"),
                ..Default::default()
            };
            let request = bun_sema_driver::Request {
                compiler_options: &command_line.compiler_options,
                cwd: cwd.as_bytes(),
                project: command_line.project.as_deref(),
                listed_projects: None,
                build: command_line.build,
                errors: &command_line.errors,
                paths: &command_line.paths,
                are_entry_points: false,
                threads: args
                    .iter()
                    .find_map(|a| a.strip_prefix("--threads="))
                    .and_then(|t| t.parse().ok())
                    .unwrap_or(0),
                libs: bun_sema_driver::Libs::Directory(
                    lib_dir
                        .as_deref()
                        .expect("BUN_SEMA_TS_LIB: the directory of the lib.*.d.ts files")
                        .as_bytes(),
                ),
                progress: None,
                order: args
                    .iter()
                    .find_map(|a| a.strip_prefix("--order="))
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(1),
                plan_options,
                script_kinds: &[],
                script_kinds_by_extension: &[],
                conditions: &[],
                stops_like_tsc: !args.iter().any(|a| a == "--every-stage"),
                uses_typescript_wording: false,
                after_file: None,
            };
            // A binary without the flag silently ignores it, so a script that tests start orders looks for this line.
            if request.order != 1 {
                error_line!("order {}", request.order);
            }
            let provided = bun_sema_driver::host::Provided {
                ends_the_process: true,
                ..Default::default()
            };
            let report = bun_sema_driver::check_provided_then(&request, provided, |report| {
                let cwd = bun_sema_driver::host::from_native(cwd.as_bytes());
                let style = Style {
                    layout: if has("--plain") {
                        Layout::Plain
                    } else if has("--agent") {
                        Layout::Agent
                    } else {
                        Layout::Pretty
                    },
                    color: !has("--no-color") && !has("--plain") && !has("--agent"),
                    cwd: &cwd,
                    is_case_sensitive: report.is_case_sensitive,
                    github_annotations: has("--github"),
                    width: args
                        .iter()
                        .find_map(|a| a.strip_prefix("--width="))
                        .and_then(|w| w.parse().ok())
                        .unwrap_or_else(bun_sema_standalone::terminal_width),
                    show_all: has("--all"),
                };
                let mut out = Vec::new();
                write_diagnostics(&mut out, &report, &style);
                let _ = std::io::stdout().write_all(&out);
                let mut summary = Vec::new();
                write_summary(&mut summary, &report, &style);
                let _ = std::io::stderr().write_all(&summary);
                if has("--timing") {
                    error_line!(
                        "loaded {} files in {:.3}s, checked {} in {:.3}s, peak {:.2} GB",
                        report.files_loaded,
                        report.load_time.as_secs_f64(),
                        report.files_checked,
                        report.check_time.as_secs_f64(),
                        bun_sema_standalone::peak_memory() as f64 / (1u64 << 30) as f64
                    );
                }
                report
            });
            std::process::exit(i32::from(!report.is_ok()));
        }
        // each --out=<directory> [--jobs=<n>] [--limit=<seconds>]: for thousands of small programs,
        // where launching a process costs more than checking. Each line of standard input is a
        // directory and the arguments to run there, separated by tabs. Line `n` runs in a fork of
        // this process and writes `<n>.out` and `<n>.err`. `<n>.status` gets its exit code, or the
        // signal that killed it.
        #[cfg(unix)]
        Some("each") => {
            use bun_core::Fd;
            use bun_sema_baselines::write_debug_file;
            let option = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
            let out = option("--out=").expect("--out=");
            let jobs: usize = option("--jobs=").map_or(8, |n| n.parse().expect("--jobs="));
            let limit: u32 = option("--limit=").map_or(60, |n| n.parse().expect("--limit="));
            let mut running: Vec<(libc::pid_t, usize)> = Vec::new();
            let wait_for_one = |running: &mut Vec<(libc::pid_t, usize)>| {
                let mut status = 0;
                // SAFETY: `status` is valid for the call to write the result to.
                let pid = unsafe { libc::wait(&raw mut status) };
                let Some(at) = running.iter().position(|it| it.0 == pid) else {
                    return;
                };
                let (_, number) = running.swap_remove(at);
                let status = if libc::WIFEXITED(status) {
                    libc::WEXITSTATUS(status).to_string()
                } else {
                    format!("signal {}", libc::WTERMSIG(status))
                };
                write_debug_file(&format!("{out}/{number}.status"), status.as_bytes());
            };
            // No thread has been started yet, so a fork is a complete copy of the process.
            for (number, line) in std::io::stdin().lines().map_while(Result::ok).enumerate() {
                if running.len() == jobs {
                    wait_for_one(&mut running);
                }
                // SAFETY: this is the only thread.
                let pid = unsafe { libc::fork() };
                if pid != 0 {
                    running.push((pid, number));
                    continue;
                }
                let mut fields = bun_core::strings::split(line.as_bytes(), b"\t").map(text);
                let directory = bun_core::ZBox::from_bytes(fields.next().unwrap());
                let mut redirected = bun_sys::chdir(&directory);
                let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;
                for (fd, extension) in [(Fd::stdout(), "out"), (Fd::stderr(), "err")] {
                    let path = format!("{out}/{number}.{extension}");
                    redirected = redirected
                        .and_then(|()| {
                            bun_sys::File::openat(Fd::cwd(), path.as_bytes(), flags, 0o644)
                        })
                        .and_then(|file| bun_sys::dup2(file.handle(), fd).map(|_| ()));
                }
                if redirected.is_err() {
                    std::process::exit(127);
                }
                // SAFETY: no handler is installed, so the signal kills a program that hangs.
                unsafe { libc::alarm(limit) };
                let arguments: Vec<String> = fields.collect();
                run(&arguments);
                std::process::exit(0);
            }
            while !running.is_empty() {
                wait_for_one(&mut running);
            }
        }
        Some("baselines") => {
            let rest: Vec<&[u8]> = args[1..].iter().map(|arg| arg.as_bytes()).collect();
            if !bun_sema_baselines::run_from_command_line(&rest) {
                std::process::exit(1);
            }
        }
        _ => error_line!("usage: bun-sema cli | each | baselines"),
    }
}
