use bun_sema::atom::Interner;
use bun_sema::messages::text;
use bun_sema::resolve::Host;
use bun_sema_baselines::{error_line, lines, output_line, read_file, write_file_to_look_at};
use bun_threading::Guarded;
use std::io::Write;
use std::sync::Arc;

/// Every file under `dir` that the front end reads, including those in `node_modules`.
fn collect_sources(disk: &dyn Host, dir: &str, out: &mut Vec<String>) {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".mts", b".cts", b".js", b".jsx", b".mjs", b".cjs",
    ];
    let (files, directories) = disk.entries(dir.as_bytes());
    let is_source = |name: &&Vec<u8>| EXTENSIONS.iter().any(|it| name.ends_with(it));
    out.extend((files.iter().filter(is_source)).map(|name| format!("{dir}/{}", text(name))));
    for name in &directories {
        collect_sources(disk, &format!("{dir}/{}", text(name)), out);
    }
}

fn variable(name: &bun_core::ZStr) -> Option<String> {
    bun_core::getenv_z(name).map(text)
}

/// `--timing`: the ten tables whose shared parts use the most memory. Without `--keep` the tasks of
/// the last step, which has most of the files, publish no entries, so theirs are not counted.
fn list_largest_tables(program: &bun_sema::check::Program) {
    let mut tables = program.table_footprints();
    tables.sort_by_key(|table| std::cmp::Reverse(table.1.touched));
    for (name, footprint) in tables.iter().take(10) {
        error_line!(
            "table {name}: {:.1} MB touched, {} entries, {} kept",
            footprint.touched as f64 / (1u64 << 20) as f64,
            footprint.entries,
            footprint.kept
        );
    }
}

/// `BUN_SEMA_LIST=<file>`: the paths of all loaded files, one per line.
fn list_loaded(program: &bun_sema::check::Program) {
    if let Some(to) = variable(bun_core::zstr!("BUN_SEMA_LIST")) {
        let paths: Vec<&[u8]> = program.files.modules.iter().map(|m| m.path).collect();
        write_file_to_look_at(&to, &paths.join(&b"\n"[..]));
    }
}

#[cfg(bun_sema_mimalloc)]
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

fn main() {
    // The main thread parses tsconfig.json. Its stack is 8 MB on macOS and Linux.
    bun_sema_standalone::native::set_stack_size(7 << 20);
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        // hir <files or directories> --print: the HIR the front end produces for each file. For
        // detecting whether a change to the front end changes any HIR.
        Some("hir") => {
            let mut files: Vec<String> = Vec::new();
            let disk = bun_sema_driver::host::Disk::with_already_read(1, Default::default(), b"/");
            for arg in args[1..].iter().filter(|a| !a.starts_with("--")) {
                if disk.is_dir(arg.as_bytes()) {
                    collect_sources(&disk, arg.trim_end_matches('/'), &mut files)
                } else {
                    files.push(arg.clone())
                }
            }
            let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
            if let Some(list) = flag("--list=") {
                let list = text(&read_file(list).unwrap());
                files.extend(lines(&list).map(str::to_owned));
            }
            files.sort();
            let session = bun_sema::session::Session::new();
            let atoms = Interner::new_in(&session);
            // --repeat=n [--threads=n]: all files are read first, then parsed and lowered n times,
            // to measure parsing and lowering alone.
            if let Some(repeat) = flag("--repeat=").and_then(|n| n.parse::<u64>().ok()) {
                let threads = flag("--threads=").and_then(|n| n.parse().ok());
                let read = |file: &String| read_file(file).unwrap_or_default();
                let texts: Vec<Vec<u8>> = files.iter().map(read).collect();
                let before = bun_sema_standalone::instructions_and_cycles().0;
                for _ in 0..repeat {
                    bun_sema_standalone::for_each_parallel(
                        threads.unwrap_or(1),
                        files.len(),
                        |i| {
                            let arena = session.arena();
                            drop(bun_sema_standalone::parse(
                                arena, &files[i], &texts[i], &atoms, false,
                            ));
                        },
                    );
                }
                let after = bun_sema_standalone::instructions_and_cycles().0;
                let a_pass = (after - before) as f64 / 1e9 / repeat as f64;
                return error_line!("{} files: {a_pass:.3} G instructions a pass", files.len());
            }
            let dumped = Guarded::new(Vec::<String>::new());
            bun_sema_standalone::for_each_parallel(4, files.len(), |i| {
                let Some(text) = read_file(&files[i]) else {
                    return;
                };
                let path = &files[i];
                let file = bun_sema_standalone::parse(session.arena(), path, &text, &atoms, false);
                // Only parses and lowers: the cost is measured with `/usr/bin/time -l`.
                if args.iter().any(|a| a == "--quiet") {
                    return;
                }
                if args.iter().any(|a| a == "--nodes") {
                    // As the checker sees it: some kinds are determined by the spelling of a name.
                    let mut file = file;
                    file.text = text.into();
                    let nodes = bun_sema_standalone::hir_dump::nodes(&file);
                    let line = format!("=== {path}\n{nodes}");
                    return dumped.lock().push(line);
                }
                let (dump, orphans) =
                    bun_sema_standalone::hir_dump::dump_and_orphans(&file, &atoms);
                let line = if args.iter().any(|a| a == "--orphans") {
                    // The unreachable nodes.
                    if orphans.is_empty() {
                        return;
                    }
                    format!("{path}\t{}", orphans.join(" | "))
                } else {
                    format!("=== {path}\n{dump}")
                };
                dumped.lock().push(line);
            });
            let mut dumped = std::mem::take(&mut *dumped.lock());
            dumped.sort();
            for line in &dumped {
                output_line!("{line}");
            }
            if args.iter().any(|a| a == "--quiet") {
                let (instructions, _) = bun_sema_standalone::instructions_and_cycles();
                error_line!("instructions {:.3} G", instructions as f64 / 1e9);
            }
        }
        Some("cli") => {
            // cli [paths..] [-p <project>] [--threads=n] [--plain] [--no-color] [--github]: behaves
            // like `bun check`.
            use bun_sema_driver::format::{Layout, Style, write_diagnostics, write_summary};
            let mut paths = Vec::new();
            let mut project = None;
            let mut rest = args[1..].iter();
            while let Some(arg) = rest.next() {
                if arg == "-p" || arg == "--project" {
                    project = rest.next().cloned();
                } else if !arg.starts_with("--") {
                    paths.push(arg.clone().into_bytes());
                }
            }
            let has = |flag: &str| args.iter().any(|a| a == flag);
            let cwd = std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let lib_dir = variable(bun_core::zstr!("BUN_SEMA_TS_LIB"));
            // `--progress`: as `bun check` displays it on a terminal.
            let shows_progress = args.iter().any(|a| a == "--progress");
            let is_timed = args.iter().any(|a| a == "--timing");
            // `--task-instructions`, with `--timing --threads=1`: every task is listed, with its
            // instructions in place of its time (1 s = 1 G).
            let task_instructions = || bun_sema_standalone::instructions_and_cycles().0;
            let progress = (shows_progress || is_timed)
                .then(|| std::sync::Arc::new(bun_sema_driver::Progress::default()));
            // `--timing`: the instruction count of loading, so that checking can be measured
            // separately. Loading opens every file, and the operating system's work for that varies
            // between runs.
            let instructions_of_loading = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            // The HIRs of all files are live at that point.
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
            // `--error-types`: the nodes whose type is the error type, in files without errors. Path, line, column, kind of node.
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
                        let path = text(module.path);
                        error_types.push((path, line, column, kind));
                    }
                };
            type AfterFile<'a> = &'a (
                    dyn Fn(&mut bun_sema::check::Checker<'_, '_>, bun_sema::program::FileId) + Sync
                );
            // `--file-instructions`, with `--threads=1 --checkers=1`: the instructions since the
            // previous file was checked, for each file. One checker in program order charges what
            // several files need to the first of them, as typescript-go's `--singleThreaded` does.
            let instructions_so_far = std::sync::atomic::AtomicU64::new(0);
            let note_instructions =
                |checker: &mut bun_sema::check::Checker<'_, '_>,
                 file: bun_sema::program::FileId| {
                    let now = bun_sema_standalone::instructions_and_cycles().0;
                    let before =
                        instructions_so_far.swap(now, std::sync::atomic::Ordering::Relaxed);
                    let path = text(checker.p.files.modules[file.idx()].path);
                    error_line!("file {:.4} G {path}", (now - before) as f64 / 1e9);
                };
            let after_file = if has("--file-instructions") {
                Some(&note_instructions as AfterFile<'_>)
            } else {
                has("--error-types").then_some(&note_error_types as AfterFile<'_>)
            };
            // `--declarations-out=<directory>`: the declaration files of a `tsc -b` run, each at
            // its absolute path inside that directory.
            let declarations_out =
                (args.iter()).find_map(|a| a.strip_prefix("--declarations-out="));
            let write_declaration_file = |path: &[u8], text: &[u8]| {
                let path = format!(
                    "{}{}",
                    declarations_out.unwrap(),
                    bun_sema::messages::text(path)
                );
                write_file_to_look_at(&path, text);
            };
            // For tuning the constants of the plan without rebuilding. To be removed once the
            // constants are chosen.
            let number = |name: &str, default: usize| {
                let actual = args.iter().find_map(|a| a.strip_prefix(name));
                actual.map_or(default, |n| n.parse().expect(name))
            };
            let defaults = bun_sema_driver::PlanOptions::default();
            let plan_options = bun_sema_driver::PlanOptions {
                step_growth: number("--step-growth=", defaults.step_growth),
                warm_up_files: number("--warm-up-files=", defaults.warm_up_files),
                warm_up_max_bytes: number("--warm-up-max-bytes=", defaults.warm_up_max_bytes),
                chunk_bytes: number("--chunk-bytes=", defaults.chunk_bytes),
                min_tasks: number("--min-tasks=", defaults.min_tasks),
                type_node_cost: number("--type-node-cost=", defaults.type_node_cost),
                split_files: number("--split-files=", defaults.split_files as usize) as u32,
                split_tolerates: number("--split-tolerates=", 0) as u8,
                split_publishes_everything: has("--split-publishes-everything"),
                checkers: number("--checkers=", defaults.checkers),
                projects_at_once: number("--projects-at-once=", defaults.projects_at_once),
            };
            let list_files_only = has("--listFilesOnly")
                .then(|| bun_sema_driver::compiler_option_from_flag(b"listFilesOnly", None).ok());
            let compiler_options: Vec<_> = list_files_only.flatten().into_iter().collect();
            let request = bun_sema_driver::Request {
                compiler_options: &compiler_options,
                cwd: cwd.as_bytes(),
                project: project.as_deref().map(str::as_bytes),
                paths: &paths,
                are_entry_points: false,
                threads: args
                    .iter()
                    .find_map(|a| a.strip_prefix("--threads="))
                    .and_then(|t| t.parse().ok())
                    .unwrap_or(0),
                lib_dir: lib_dir.as_deref().map(str::as_bytes),
                global_node_modules: None,
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
                digests: is_timed && !has("--task-instructions"),
                task_clock: has("--task-instructions")
                    .then_some(&task_instructions as &(dyn Fn() -> u64 + Sync)),
                plan_options,
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
            // A binary without the flag ignores it silently. A script that tests start orders looks for this line.
            if request.order != 1 {
                error_line!("order {}", request.order);
            }
            for round in 1..=number("--repeat=", 0) {
                let started = std::time::Instant::now();
                let (errors, checked) = bun_sema_driver::check_then(&request, |report| {
                    (report.diagnostics.len(), started.elapsed())
                });
                error_line!(
                    "repeat {round}: {errors} errors, {:.3} s to the report, {:.3} s with the memory given back, {} MB held",
                    checked.as_secs_f64(),
                    started.elapsed().as_secs_f64(),
                    bun_sema_standalone::current_memory() >> 20
                );
            }
            if number("--repeat=", 0) > 0 {
                // Memory that the allocator caches for future allocations is not memory retained by
                // the checks.
                bun_alloc::mimalloc::mi_collect(true);
                error_line!(
                    "after the allocator gave back what is free: {} MB held",
                    bun_sema_standalone::current_memory() >> 20
                );
            }
            bun_sema_driver::check_then(&request, |report| {
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
                    // Discover, link and merge are the wall time of one thread. The others are summed over all threads.
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
                        "instructions of checking {:.2} G",
                        instructions.saturating_sub(loading) as f64 / 1e9
                    );
                    let peak = peak_memory_of_loading.load(std::sync::atomic::Ordering::Relaxed);
                    error_line!(
                        "peak of loading {:.2} GB",
                        peak as f64 / (1u64 << 30) as f64
                    );
                    let seconds = |of: fn(&bun_sema_driver::StepReport) -> std::time::Duration| {
                        report
                            .steps
                            .iter()
                            .map(of)
                            .sum::<std::time::Duration>()
                            .as_secs_f64()
                    };
                    let count = |of: fn(&bun_sema_driver::StepReport) -> u64| {
                        report.steps.iter().map(of).sum::<u64>()
                    };
                    // fan/r7/tools/oracle.py reads these lines. It compares the counts between
                    // runs: they are deterministic for a given program.
                    error_line!(
                        "plan options: step growth {}, warm-up files {}, warm-up max bytes {}, chunk bytes {}, min tasks {}",
                        plan_options.step_growth,
                        plan_options.warm_up_files,
                        plan_options.warm_up_max_bytes,
                        plan_options.chunk_bytes,
                        plan_options.min_tasks
                    );
                    error_line!("steps: {}", report.steps.len());
                    error_line!("tasks: {}", count(|step| step.tasks as u64));
                    error_line!("seconds in steps: {:.3}", seconds(|step| step.in_tasks));
                    error_line!("seconds in link: {:.3}", seconds(|step| step.in_link));
                    error_line!(
                        "seconds in publishes: {:.3}",
                        seconds(|step| step.in_publish)
                    );
                    error_line!("seconds idle at barriers: {:.3}", seconds(|step| step.idle));
                    error_line!("entries buffered: {}", count(|step| step.entries.buffered));
                    error_line!(
                        "entries published: {}",
                        count(|step| step.entries.published)
                    );
                    error_line!("entries lost: {}", count(|step| step.entries.lost));
                    error_line!(
                        "records linked: {}, joined: {}",
                        count(|step| step.records.linked.iter().sum::<usize>() as u64),
                        count(|step| step.records.joined.iter().sum::<usize>() as u64)
                    );
                    let by_kind = bun_sema::types::LinkCounts::NAMES.iter().enumerate();
                    let by_kind = by_kind.map(|(kind, name)| {
                        let sum = |of: fn(&bun_sema::types::LinkCounts) -> &[usize]| {
                            report
                                .steps
                                .iter()
                                .map(|step| of(&step.records)[kind])
                                .sum::<usize>()
                        };
                        format!("{name} {} / {}", sum(|it| &it.linked), sum(|it| &it.joined))
                    });
                    error_line!(
                        "records linked / joined by kind: {}",
                        by_kind.collect::<Vec<String>>().join(", ")
                    );
                    error_line!(
                        "generic relation entries not published: {}",
                        count(|step| step.generic_relation_entries_not_published)
                    );
                    // What a task computed about a source file of another component. The first eight kinds are inference. The others are
                    // type syntax.
                    let kinds = bun_sema::check::FOREIGN_EVALUATION_KINDS;
                    let foreign: Vec<u64> = (0..kinds.len())
                        .map(|kind| {
                            report
                                .steps
                                .iter()
                                .map(|step| step.foreign_evaluations[kind])
                                .sum()
                        })
                        .collect();
                    error_line!(
                        "foreign evaluations: {} inference, {} type syntax",
                        foreign[..8].iter().sum::<u64>(),
                        foreign[8..].iter().sum::<u64>()
                    );
                    let by_kind: Vec<String> = (kinds.iter().zip(&foreign))
                        .map(|(kind, count)| format!("{kind} {count}"))
                        .collect();
                    error_line!("foreign evaluations by kind: {}", by_kind.join(", "));
                    let by_step = report.steps.iter().map(|step| step.entries.published);
                    let by_step: Vec<String> = by_step.map(|n| n.to_string()).collect();
                    error_line!("entries published by step: {}", by_step.join(" "));
                    // The ten tables with the most duplicated work.
                    let names = bun_sema::check::task::table_names();
                    let mut by_table = vec![(0u64, 0u64); names.len()];
                    for step in &report.steps {
                        for (sum, more) in by_table.iter_mut().zip(&step.entries.by_table) {
                            (sum.0, sum.1) = (sum.0 + more.0, sum.1 + more.1);
                        }
                    }
                    let mut by_table: Vec<(&str, (u64, u64))> =
                        names.into_iter().zip(by_table).collect();
                    by_table.sort_by_key(|(_, (buffered, published))| {
                        std::cmp::Reverse(buffered - published)
                    });
                    for (name, (buffered, published)) in by_table.iter().take(10) {
                        error_line!("lost {name}: {} of {buffered}", buffered - published);
                    }
                    for (number, step) in report.steps.iter().enumerate() {
                        error_line!(
                            "step {number}: {} tasks, {} files, {:.3} s, link {:.3}, publish {:.3}, idle {:.3}, entries {} / {} / {}, records {} / {}, digest {:016x}",
                            step.tasks,
                            step.files,
                            step.in_tasks.as_secs_f64(),
                            step.in_link.as_secs_f64(),
                            step.in_publish.as_secs_f64(),
                            step.idle.as_secs_f64(),
                            step.entries.buffered,
                            step.entries.published,
                            step.entries.lost,
                            step.records.linked.iter().sum::<usize>(),
                            step.records.joined.iter().sum::<usize>(),
                            step.entries.digest
                        );
                        if step.ranges != 0 {
                            let [cycle, limit, nesting] = step.ranges_by_obstacle;
                            error_line!(
                                "  ranges checked ahead {}, not published {}; met a cycle {cycle}, a limit {limit}, a cut at nested types {nesting}",
                                step.ranges,
                                step.ranges_dropped
                            );
                        }
                        for (elapsed, files, path) in &step.slowest_tasks {
                            error_line!(
                                "  task {:.3} s, {files} files, from {}",
                                elapsed.as_secs_f64(),
                                text(path)
                            );
                        }
                    }
                }
                std::process::exit(i32::from(!report.is_ok()));
            })
        }
        Some("baselines") => {
            let rest: Vec<&[u8]> = args[1..].iter().map(|arg| arg.as_bytes()).collect();
            if !bun_sema_baselines::run_from_command_line(&rest) {
                std::process::exit(1);
            }
        }
        _ => error_line!("usage: bun-sema cli | baselines | hir"),
    }
}
