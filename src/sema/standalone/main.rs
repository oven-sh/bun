use bun_sema::atom::Interner;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Every file under `dir` the front end reads, `node_modules` too.
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

/// `BUN_SEMA_LIST=<file>`: the paths of all that is loaded, a line each.
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
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        // hir <files or directories> --print: what the front end makes of each file. For telling whether a change to the front end changes any tree.
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
            // --repeat=n [--threads=n]: everything is read first, then parsed and lowered n times: what a pass of that alone takes.
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
                // Only parsed and lowered: what that costs is read off `/usr/bin/time -l`.
                if args.iter().any(|a| a == "--quiet") {
                    return;
                }
                if args.iter().any(|a| a == "--nodes") {
                    // As the checker has it: some kinds are told by how a name is written.
                    let mut file = file;
                    file.text = text.into();
                    let nodes = bun_sema_standalone::hir_dump::nodes(&file);
                    let line = format!("=== {}\n{nodes}", files[i].display());
                    return lines.lock().unwrap().push(line);
                }
                let (dump, orphans) =
                    bun_sema_standalone::hir_dump::dump_and_orphans(&file, &atoms);
                let line = if args.iter().any(|a| a == "--orphans") {
                    // The nodes nothing leads to.
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
            // cli [paths..] [-p <project>] [--threads=n] [--plain] [--no-color] [--github]: what `bun check` does.
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
            // `--progress`: as `bun check` shows it at a terminal.
            let shows_progress = args.iter().any(|a| a == "--progress");
            let is_timed = args.iter().any(|a| a == "--timing");
            let progress = (shows_progress || is_timed)
                .then(|| std::sync::Arc::new(bun_sema_driver::Progress::default()));
            // `--timing`: the instructions of loading, so that those of checking can be told apart. Loading opens every file, and what the
            // system does for that differs from run to run.
            let instructions_of_loading = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            if let (true, Some(progress)) = (is_timed, progress.clone()) {
                let noted = instructions_of_loading.clone();
                std::thread::spawn(move || {
                    use std::sync::atomic::Ordering::Relaxed;
                    while progress.to_check.load(Relaxed) == 0 {
                        std::thread::sleep(std::time::Duration::from_micros(200));
                    }
                    noted.store(bun_sema_standalone::instructions_and_cycles().0, Relaxed);
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
            let request = bun_sema_driver::Request {
                compiler_options: &[],
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
                keeps_everything: args.iter().any(|a| a == "--keep"),
                order: args
                    .iter()
                    .find_map(|a| a.strip_prefix("--order="))
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(1),
                stops_where_tsc_does: !args.iter().any(|a| a == "--every-stage"),
                says_it_as_typescript_does: false,
                loaded: args
                    .iter()
                    .any(|a| a == "--memory")
                    .then_some(&list_loaded as &(dyn Fn(&bun_sema::check::Program) + Sync)),
                checked: None,
                after_file,
            };
            // A binary without the flag ignores it silently. A script that tests start orders looks for this line.
            if request.order != 1 {
                eprintln!("order {}", request.order);
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
                }
                std::process::exit(i32::from(!report.is_ok()));
            })
        }
        Some("baselines") => {
            // baselines --lib=<dir> --testlib=<dir> [--only=substring] [--out=dir] [--report=file] [--threads=n]
            //           <name>=<tests>=<baselines>=<file with the names of all the baselines> ..
            use bun_sema_standalone::baseline::{Level, Setup, Suite, run};
            let flag = |name: &str| {
                args.iter()
                    .find_map(|a| a.strip_prefix(&format!("--{name}=")).map(str::to_owned))
            };
            let (lib_dir, test_lib) = (flag("lib").unwrap(), flag("testlib").unwrap());
            let (only, out, types_out) = (flag("only"), flag("out"), flag("types-out"));
            let symbols_out = flag("symbols-out");
            let setup = Setup {
                lib_dir: &lib_dir,
                test_lib: &test_lib,
                only: only.as_deref(),
                out: out.as_deref(),
                types_out: types_out.as_deref(),
                symbols_out: symbols_out.as_deref(),
                threads: flag("threads").and_then(|t| t.parse().ok()).unwrap_or(8),
            };
            let mut all = Vec::new();
            for spec in args[1..].iter().filter(|a| !a.starts_with("--")) {
                let parts: Vec<&str> = spec.split('=').collect();
                let names: Vec<String> = std::fs::read_to_string(parts[3])
                    .unwrap()
                    .lines()
                    .map(str::to_owned)
                    .collect();
                all.extend(run(
                    &Suite {
                        name: parts[0],
                        cases: parts[1],
                        baselines: parts[2],
                        names: &names,
                    },
                    &setup,
                ));
            }
            let at_least = |level: Level| all.iter().filter(|o| o.level >= level).count();
            let percent = |n: usize| n as f64 * 100.0 / all.len().max(1) as f64;
            println!("{} tests (each configuration counts)", all.len());
            for (level, what) in [
                (Level::Codes, "the same errors at the same places"),
                (Level::Words, "and in the same words"),
                (Level::Spans, "and as long: all but the related information"),
                (Level::All, "byte for byte"),
            ] {
                let n = at_least(level);
                println!("{n:>6} {:>6.2}%  {what}", percent(n));
            }
            if let Some(path) = flag("report") {
                let lines: Vec<String> = all
                    .iter()
                    .map(|o| format!("{:?}\t{}\t{}", o.level, o.name, o.note))
                    .collect();
                std::fs::write(path, lines.join("\n") + "\n").unwrap();
            }
        }
        _ => eprintln!("usage: bun-sema cli | baselines | hir"),
    }
}
