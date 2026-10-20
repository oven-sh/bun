use bun_sema::messages::text;
use bun_sema_baselines::{error_line, output_line, write_debug_file};
use bun_threading::Guarded;
use std::io::Write;
use std::sync::Arc;

fn variable(name: &bun_core::ZStr) -> Option<String> {
    bun_core::getenv_z(name).map(text)
}

/// `--timing`: prints the ten tables whose shared parts use the most memory.
fn list_largest_tables(program: &bun_sema::check::Program) {
    let mut tables = program.table_footprints();
    tables.sort_by_key(|table| std::cmp::Reverse(table.1.touched));
    for (name, footprint) in tables.iter().take(10) {
        error_line!(
            "table {name}: {:.1} MB touched, {} entries, {} out of line",
            footprint.touched as f64 / (1u64 << 20) as f64,
            footprint.entries,
            footprint.out_of_line_values
        );
    }
}

/// `BUN_SEMA_LIST=<file>`: writes the paths of all loaded files there, one per line.
fn list_loaded(program: &bun_sema::check::Program) {
    if let Some(to) = variable(bun_core::zstr!("BUN_SEMA_LIST")) {
        let paths: Vec<&[u8]> = program
            .files
            .modules
            .iter()
            .map(|m| m.file_name())
            .collect();
        write_debug_file(&to, &paths.join(&b"\n"[..]));
    }
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
            // [--threads=n] [--plain] [--no-color] [--github]: behaves like `bun check`.
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
            // `--progress`: shows progress the way `bun check` does on a terminal.
            let shows_progress = args.iter().any(|a| a == "--progress");
            let is_timed = args.iter().any(|a| a == "--timing");
            let progress = (shows_progress || is_timed)
                .then(|| std::sync::Arc::new(bun_sema_driver::Progress::default()));
            // `--timing`: records the instruction count of loading, so that checking can be measured
            // separately. Loading opens every file, and the operating system's work for that varies
            // between runs.
            let instructions_of_loading = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            // Every file's HIR is live when loading ends.
            let peak_memory_of_loading = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            if let (true, Some(progress)) = (is_timed, progress.clone()) {
                let noted = Arc::clone(&instructions_of_loading);
                let noted_peak = Arc::clone(&peak_memory_of_loading);
                let _ = std::thread::Builder::new().spawn(move || {
                    use std::sync::atomic::Ordering::Relaxed;
                    while progress.to_check.load(Relaxed) == 0 {
                        std::thread::sleep(std::time::Duration::from_micros(200));
                    }
                    noted.store(bun_sema_standalone::instructions_and_cycles().0, Relaxed);
                    noted_peak.store(bun_sema_standalone::peak_memory(), Relaxed);
                });
            }
            if let (true, Some(progress)) = (shows_progress, progress.clone()) {
                let _ = std::thread::Builder::new().spawn(move || {
                    let style = Style {
                        layout: Layout::Pretty,
                        color: true,
                        cwd: b"",
                        is_case_sensitive: true,
                        github_annotations: false,
                        width: bun_sema_standalone::terminal_width(),
                        show_all: false,
                    };
                    let mut tick = 0;
                    loop {
                        let mut line = Vec::new();
                        bun_sema_driver::format::write_progress(&mut line, &progress, &style, tick);
                        let _ = std::io::stderr().write_all(&line);
                        std::thread::sleep(std::time::Duration::from_millis(80));
                        tick += 1;
                    }
                });
            }
            // `--error-types`: lists the nodes whose type is the error type, in files without errors, as path, line,
            // column and node kind.
            let error_types: Guarded<Vec<(String, usize, usize, String)>> =
                Guarded::new(Vec::new());
            let note_error_types =
                |checker: &mut bun_sema::check::Checker<'_, '_>,
                 file: bun_sema::program::FileId| {
                    let found = checker.error_types_at_locations(file);
                    let module = &checker.p.files.modules[file.idx()];
                    let source = &module.hir.text;
                    let mut error_types = error_types.lock();
                    for (start, kind) in found {
                        let before = &source[..(start as usize).min(source.len())];
                        let line_start = bun_core::strings::last_index_of_char(before, b'\n')
                            .map_or(0, |n| n + 1);
                        let line = bun_core::strings::count_char(before, b'\n') + 1;
                        let column = before.len() - line_start + 1;
                        let path = text(module.file_name());
                        error_types.push((path, line, column, kind));
                    }
                };
            type AfterFile<'a> = &'a (
                    dyn Fn(&mut bun_sema::check::Checker<'_, '_>, bun_sema::program::FileId) + Sync
                );
            let after_file = has("--error-types").then_some(&note_error_types as AfterFile<'_>);
            // `--declarations-out=<directory>`: writes the declaration files of a `tsc -b` run, each
            // at its absolute path inside that directory.
            let declarations_out =
                (args.iter()).find_map(|a| a.strip_prefix("--declarations-out="));
            let write_declaration_file = |path: &[u8], text: &[u8]| {
                let path = format!(
                    "{}{}",
                    declarations_out.unwrap(),
                    bun_sema::messages::text(path)
                );
                write_debug_file(&path, text);
            };
            let number = |name: &str, default: usize| {
                let actual = args.iter().find_map(|a| a.strip_prefix(name));
                actual.map_or(default, |n| n.parse().expect(name))
            };
            let defaults = bun_sema_driver::PlanOptions::default();
            let plan_options = bun_sema_driver::PlanOptions {
                max_concurrent_projects: number(
                    "--projects-at-once=",
                    defaults.max_concurrent_projects,
                ),
                task_size: match args.iter().find_map(|a| a.strip_prefix("--task-size=")) {
                    None => defaults.task_size,
                    Some("one-file") => bun_sema_driver::TaskSize::OneFile,
                    Some("unlimited") => bun_sema_driver::TaskSize::Unlimited,
                    Some(other) => panic!("--task-size={other}"),
                },
                discards_first_visits: has("--discard-first-visits"),
                ..defaults
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
                progress: progress.as_deref(),
                only: args
                    .iter()
                    .find_map(|a| a.strip_prefix("--only="))
                    .map(str::as_bytes),
                retains_everything: args.iter().any(|a| a == "--keep"),
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
                loaded: args
                    .iter()
                    .any(|a| a == "--memory")
                    .then_some(&list_loaded as &(dyn Fn(&bun_sema::check::Program) + Sync)),
                checked: is_timed
                    .then_some(&list_largest_tables as &(dyn Fn(&bun_sema::check::Program) + Sync)),
                after_file,
                declaration_file_emitted: declarations_out
                    .is_some()
                    .then_some(&write_declaration_file as &(dyn Fn(&[u8], &[u8]) + Sync)),
            };
            // A binary without the flag silently ignores it, so a script that tests start orders looks for this line.
            if request.order != 1 {
                error_line!("order {}", request.order);
            }
            for round in 1..=number("--repeat=", 0) {
                let started = std::time::Instant::now();
                let (errors, checked) = bun_sema_driver::check_then(&request, |report| {
                    (report.diagnostics.len(), started.elapsed())
                });
                error_line!(
                    "repeat {round}: {errors} errors, {:.3} s until the report, {:.3} s including freeing memory, {} MB in use",
                    checked.as_secs_f64(),
                    started.elapsed().as_secs_f64(),
                    bun_sema_standalone::current_memory() >> 20
                );
            }
            if number("--repeat=", 0) > 0 {
                // Memory that the allocator caches for future allocations isn't retained by the checks.
                bun_alloc::mimalloc::mi_collect(true);
                error_line!(
                    "after the allocator released free memory: {} MB in use",
                    bun_sema_standalone::current_memory() >> 20
                );
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
                if shows_progress {
                    let _ = std::io::stderr().write_all(bun_sema_driver::format::ERASE_LINE);
                }
                let mut out = Vec::new();
                write_diagnostics(&mut out, &report, &style);
                let _ = std::io::stdout().write_all(&out);
                let mut error_types = std::mem::take(&mut *error_types.lock());
                error_types
                    .retain(|at| !report.diagnostics.iter().any(|d| d.path == at.0.as_bytes()));
                error_types.sort();
                for (path, line, column, kind) in &error_types {
                    output_line!("{path}({line},{column}): ERROR-TYPE {kind}");
                }
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
                    // Discover, link and merge are one thread's wall time. The others are summed over all threads.
                    let phases = bun_sema::resolve::Phase::ALL.iter().zip(report.load_phases);
                    let phases: Vec<String> = phases
                        .map(|(phase, time)| format!("{phase:?} {:.3}", time.as_secs_f64()))
                        .collect();
                    error_line!("load: {}", phases.join(", ").to_lowercase());
                    let (instructions, cycles) = bun_sema_standalone::instructions_and_cycles();
                    error_line!(
                        "instructions {:.2} G, cycles {:.2} G",
                        instructions as f64 / 1e9,
                        cycles as f64 / 1e9
                    );
                    let loading =
                        instructions_of_loading.load(std::sync::atomic::Ordering::Relaxed);
                    error_line!(
                        "checking instructions {:.2} G",
                        instructions.saturating_sub(loading) as f64 / 1e9
                    );
                    let peak = peak_memory_of_loading.load(std::sync::atomic::Ordering::Relaxed);
                    error_line!(
                        "peak while loading {:.2} GB",
                        peak as f64 / (1u64 << 30) as f64
                    );
                    let walks = bun_sema::check::INFERENCE_WALK_COUNTS.iter();
                    let walks: Vec<String> = (walks.zip(report.inference_walks))
                        .map(|(name, count)| format!("{name} {count}"))
                        .collect();
                    error_line!("inference walks: {}", walks.join(", "));
                    let members = bun_sema::check::MEMBER_COUNTS.iter();
                    let members: Vec<String> = (members.zip(report.members))
                        .map(|(name, count)| format!("{name} {count}"))
                        .collect();
                    error_line!("members: {}", members.join(", "));
                    for (number, round) in report.rounds.iter().enumerate() {
                        error_line!(
                            "round {number}: {} tasks, {} files, {:.3} s, idle {:.3}, keys logged {}, entries stored {}",
                            round.tasks,
                            round.files,
                            round.elapsed.as_secs_f64(),
                            round.idle.as_secs_f64(),
                            round.logged,
                            round.stored
                        );
                        let [for_commits, in_commits, for_claims] =
                            round.waits.map(|it| it.as_secs_f64());
                        error_line!(
                            "  summed over the tasks: waiting for the commit mutex {for_commits:.3} s, in commits {in_commits:.3}, waiting for claims {for_claims:.3}"
                        );
                        for (path, why) in &round.lost {
                            error_line!("  discarded because of {why}: {}", text(path));
                        }
                        for (elapsed, files, path) in &round.slowest_tasks {
                            error_line!(
                                "  task {:.3} s, {files} files, from {}",
                                elapsed.as_secs_f64(),
                                text(path)
                            );
                        }
                    }
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
