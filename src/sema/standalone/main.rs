use bun_sema::atom::Interner;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Every file under `dir` that the front end reads, including those in `node_modules`.
fn collect_sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            collect_sources(&path, out);
        } else if [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
            .iter()
            .any(|e| name.ends_with(e))
        {
            out.push(path);
        }
    }
}

/// `--timing`: the ten tables whose shared parts use the most memory. Without `--keep` the tasks of
/// the last step, which has most of the files, publish no entries, so theirs are not counted.
fn list_largest_tables(program: &bun_sema::check::Program) {
    let mut tables = program.table_footprints();
    tables.sort_by_key(|table| std::cmp::Reverse(table.1.touched));
    for (name, footprint) in tables.iter().take(10) {
        eprintln!(
            "table {name}: {:.1} MB touched, {} entries, {} kept",
            footprint.touched as f64 / (1u64 << 20) as f64,
            footprint.entries,
            footprint.kept
        );
    }
}

/// `BUN_SEMA_LIST=<file>`: the paths of all loaded files, one per line.
fn list_loaded(program: &bun_sema::check::Program) {
    if let Ok(to) = std::env::var("BUN_SEMA_LIST") {
        let paths: Vec<&[u8]> = program.files.modules.iter().map(|m| &m.path[..]).collect();
        let _ = std::fs::write(to, paths.join(&b"\n"[..]));
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
            let mut files = Vec::new();
            for arg in args[1..].iter().filter(|a| !a.starts_with("--")) {
                let path = PathBuf::from(arg);
                if path.is_dir() {
                    collect_sources(&path, &mut files)
                } else {
                    files.push(path)
                }
            }
            let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
            if let Some(list) = flag("--list=") {
                let list = std::fs::read_to_string(list).unwrap();
                files.extend(list.lines().map(PathBuf::from));
            }
            files.sort();
            let atoms = Interner::new();
            // --repeat=n [--threads=n]: all files are read first, then parsed and lowered n times,
            // to measure parsing and lowering alone.
            if let Some(repeat) = flag("--repeat=").and_then(|n| n.parse::<u64>().ok()) {
                let threads = flag("--threads=").and_then(|n| n.parse().ok());
                let read = |file: &PathBuf| std::fs::read(file).unwrap_or_default();
                let texts: Vec<Vec<u8>> = files.iter().map(read).collect();
                let before = bun_sema_standalone::instructions_and_cycles().0;
                for _ in 0..repeat {
                    bun_sema_standalone::for_each_parallel(
                        threads.unwrap_or(1),
                        files.len(),
                        |i| {
                            let path = files[i].to_string_lossy();
                            drop(bun_sema_standalone::parse(&path, &texts[i], &atoms, false));
                        },
                    );
                }
                let after = bun_sema_standalone::instructions_and_cycles().0;
                let a_pass = (after - before) as f64 / 1e9 / repeat as f64;
                return eprintln!("{} files: {a_pass:.3} G instructions a pass", files.len());
            }
            let lines = std::sync::Mutex::new(Vec::<String>::new());
            bun_sema_standalone::for_each_parallel(4, files.len(), |i| {
                let Ok(text) = std::fs::read(&files[i]) else {
                    return;
                };
                let file =
                    bun_sema_standalone::parse(&files[i].to_string_lossy(), &text, &atoms, false);
                // Only parses and lowers: the cost is measured with `/usr/bin/time -l`.
                if args.iter().any(|a| a == "--quiet") {
                    return;
                }
                if args.iter().any(|a| a == "--nodes") {
                    // As the checker sees it: some kinds are determined by the spelling of a name.
                    let mut file = file;
                    file.text = text.into();
                    let nodes = bun_sema_standalone::hir_dump::nodes(&file);
                    let line = format!("=== {}\n{nodes}", files[i].display());
                    return lines.lock().unwrap().push(line);
                }
                let (dump, orphans) =
                    bun_sema_standalone::hir_dump::dump_and_orphans(&file, &atoms);
                let line = if args.iter().any(|a| a == "--orphans") {
                    // The unreachable nodes.
                    if orphans.is_empty() {
                        return;
                    }
                    format!("{}\t{}", files[i].display(), orphans.join(" | "))
                } else {
                    format!("=== {}\n{dump}", files[i].display())
                };
                lines.lock().unwrap().push(line);
            });
            let mut lines = lines.into_inner().unwrap();
            lines.sort();
            for line in &lines {
                println!("{line}");
            }
            if args.iter().any(|a| a == "--quiet") {
                let (instructions, _) = bun_sema_standalone::instructions_and_cycles();
                eprintln!("instructions {:.3} G", instructions as f64 / 1e9);
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
            let lib_dir = std::env::var("BUN_SEMA_TS_LIB").ok();
            // `--progress`: as `bun check` displays it on a terminal.
            let shows_progress = args.iter().any(|a| a == "--progress");
            let is_timed = args.iter().any(|a| a == "--timing");
            let progress = (shows_progress || is_timed)
                .then(|| std::sync::Arc::new(bun_sema_driver::Progress::default()));
            // `--timing`: the instruction count of loading, so that checking can be measured
            // separately. Loading opens every file, and the operating system's work for that varies
            // between runs.
            let instructions_of_loading = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            // The HIRs of all files are live at that point.
            let peak_memory_of_loading = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            if let (true, Some(progress)) = (is_timed, progress.clone()) {
                let noted = instructions_of_loading.clone();
                let noted_peak = peak_memory_of_loading.clone();
                std::thread::spawn(move || {
                    use std::sync::atomic::Ordering::Relaxed;
                    while progress.to_check.load(Relaxed) == 0 {
                        std::thread::sleep(std::time::Duration::from_micros(200));
                    }
                    noted.store(bun_sema_standalone::instructions_and_cycles().0, Relaxed);
                    noted_peak.store(bun_sema_standalone::peak_memory(), Relaxed);
                });
            }
            if let (true, Some(progress)) = (shows_progress, progress.clone()) {
                std::thread::spawn(move || {
                    let style = Style {
                        layout: Layout::Pretty,
                        color: true,
                        cwd: b"",
                        github_annotations: false,
                        width: bun_sema_standalone::terminal_width(),
                        show_all: false,
                    };
                    for tick in 0.. {
                        let mut line = Vec::new();
                        bun_sema_driver::format::write_progress(&mut line, &progress, &style, tick);
                        let _ = std::io::stderr().write_all(&line);
                        std::thread::sleep(std::time::Duration::from_millis(80));
                    }
                });
            }
            // `--error-types`: the nodes whose type is the error type, in files without errors. Path, line, column, kind of node.
            let error_types: std::sync::Mutex<Vec<(String, usize, usize, String)>> =
                Default::default();
            let note_error_types =
                |checker: &mut bun_sema::check::Checker<'_>, file: bun_sema::program::FileId| {
                    let found = checker.error_types_at_locations(file);
                    let module = &checker.p.files.modules[file.idx()];
                    let text = &module.hir.text;
                    let mut error_types = error_types.lock().unwrap();
                    for (start, kind) in found {
                        let before = &text[..(start as usize).min(text.len())];
                        let line_start = before
                            .iter()
                            .rposition(|&b| b == b'\n')
                            .map_or(0, |n| n + 1);
                        let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
                        let column = before.len() - line_start + 1;
                        let path = bun_sema::messages::text(&module.path);
                        error_types.push((path, line, column, kind));
                    }
                };
            type AfterFile<'a> =
                &'a (dyn Fn(&mut bun_sema::check::Checker<'_>, bun_sema::program::FileId) + Sync);
            let after_file = has("--error-types").then_some(&note_error_types as AfterFile<'_>);
            // `--declarations-out=<directory>`: the declaration files of a `tsc -b` run, each at
            // its absolute path inside that directory.
            let declarations_out =
                (args.iter()).find_map(|a| a.strip_prefix("--declarations-out="));
            let write_declaration_file = |path: &[u8], text: &[u8]| {
                let path = format!(
                    "{}{}",
                    declarations_out.unwrap(),
                    String::from_utf8_lossy(path)
                );
                if let Some(directory) = std::path::Path::new(&path).parent() {
                    let _ = std::fs::create_dir_all(directory);
                }
                let _ = std::fs::write(path, text);
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
                checkers: number("--checkers=", defaults.checkers),
            };
            let list_files_only = has("--listFilesOnly")
                .then(|| bun_sema_driver::compiler_option_from_flag(b"listFilesOnly", None).ok());
            let compiler_options: Vec<_> = list_files_only.flatten().into_iter().collect();
            let request = bun_sema_driver::Request {
                compiler_options: &compiler_options,
                cwd: cwd.as_bytes(),
                project: project.as_deref().map(str::as_bytes),
                paths: &paths,
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
                digests: is_timed,
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
                eprintln!("order {}", request.order);
            }
            for round in 1..=number("--repeat=", 0) {
                let started = std::time::Instant::now();
                let (errors, checked) = bun_sema_driver::check_then(&request, |report| {
                    (report.diagnostics.len(), started.elapsed())
                });
                eprintln!(
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
                eprintln!(
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
                let mut error_types = std::mem::take(&mut *error_types.lock().unwrap());
                error_types
                    .retain(|at| !report.diagnostics.iter().any(|d| d.path == at.0.as_bytes()));
                error_types.sort();
                for (path, line, column, kind) in &error_types {
                    println!("{path}({line},{column}): ERROR-TYPE {kind}");
                }
                let mut summary = Vec::new();
                write_summary(&mut summary, &report, &style);
                let _ = std::io::stderr().write_all(&summary);
                if has("--timing") {
                    eprintln!(
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
                    eprintln!("load: {}", phases.join(", ").to_lowercase());
                    let (instructions, cycles) = bun_sema_standalone::instructions_and_cycles();
                    eprintln!(
                        "instructions {:.2} G, cycles {:.2} G",
                        instructions as f64 / 1e9,
                        cycles as f64 / 1e9
                    );
                    let loading =
                        instructions_of_loading.load(std::sync::atomic::Ordering::Relaxed);
                    eprintln!(
                        "instructions of checking {:.2} G",
                        instructions.saturating_sub(loading) as f64 / 1e9
                    );
                    let peak = peak_memory_of_loading.load(std::sync::atomic::Ordering::Relaxed);
                    eprintln!(
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
                    eprintln!(
                        "plan options: step growth {}, warm-up files {}, warm-up max bytes {}, chunk bytes {}, min tasks {}",
                        plan_options.step_growth,
                        plan_options.warm_up_files,
                        plan_options.warm_up_max_bytes,
                        plan_options.chunk_bytes,
                        plan_options.min_tasks
                    );
                    eprintln!("steps: {}", report.steps.len());
                    eprintln!("tasks: {}", count(|step| step.tasks as u64));
                    eprintln!("seconds in steps: {:.3}", seconds(|step| step.in_tasks));
                    eprintln!("seconds in link: {:.3}", seconds(|step| step.in_link));
                    eprintln!(
                        "seconds in publishes: {:.3}",
                        seconds(|step| step.in_publish)
                    );
                    eprintln!("seconds idle at barriers: {:.3}", seconds(|step| step.idle));
                    eprintln!("entries buffered: {}", count(|step| step.entries.buffered));
                    eprintln!(
                        "entries published: {}",
                        count(|step| step.entries.published)
                    );
                    eprintln!("entries lost: {}", count(|step| step.entries.lost));
                    eprintln!(
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
                    eprintln!(
                        "records linked / joined by kind: {}",
                        by_kind.collect::<Vec<String>>().join(", ")
                    );
                    eprintln!(
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
                    eprintln!(
                        "foreign evaluations: {} inference, {} type syntax",
                        foreign[..8].iter().sum::<u64>(),
                        foreign[8..].iter().sum::<u64>()
                    );
                    let by_kind: Vec<String> = (kinds.iter().zip(&foreign))
                        .map(|(kind, count)| format!("{kind} {count}"))
                        .collect();
                    eprintln!("foreign evaluations by kind: {}", by_kind.join(", "));
                    let by_step = report.steps.iter().map(|step| step.entries.published);
                    let by_step: Vec<String> = by_step.map(|n| n.to_string()).collect();
                    eprintln!("entries published by step: {}", by_step.join(" "));
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
                        eprintln!("lost {name}: {} of {buffered}", buffered - published);
                    }
                    for (number, step) in report.steps.iter().enumerate() {
                        eprintln!(
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
        _ => eprintln!("usage: bun-sema cli | baselines | hir"),
    }
}
