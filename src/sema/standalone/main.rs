use bun_sema::atom::Interner;
use std::path::{Path, PathBuf};

fn collect(dir: &Path, out: &mut Vec<PathBuf>, into_node_modules: bool) {
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
            if name == ".git" || (name == "node_modules" && !into_node_modules) {
                continue;
            }
            collect(&path, out, into_node_modules);
        } else if name.ends_with(".ts")
            || name.ends_with(".tsx")
            || name.ends_with(".mts")
            || name.ends_with(".cts")
        {
            out.push(path);
        }
    }
}

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

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("parse") => {
            let mut files = Vec::new();
            let declarations_only = args.iter().any(|a| a == "--dts");
            for arg in args[1..].iter().filter(|a| !a.starts_with("--")) {
                let path = PathBuf::from(arg);
                if path.is_dir() {
                    collect(&path, &mut files, declarations_only)
                } else {
                    files.push(path)
                }
            }
            if declarations_only {
                files.retain(|f| {
                    let f = f.to_string_lossy();
                    f.ends_with(".d.ts") || f.ends_with(".d.mts") || f.ends_with(".d.cts")
                });
            }
            let atoms = Interner::new();
            let start = std::time::Instant::now();
            let stats =
                std::sync::Mutex::new((0usize, 0usize, 0usize, 0usize, Vec::<String>::new()));
            bun_sema_standalone::for_each_parallel(4, files.len(), |i| {
                let Ok(text) = std::fs::read(&files[i]) else {
                    return;
                };
                let file =
                    bun_sema_standalone::parse(&files[i].to_string_lossy(), &text, &atoms, false);
                let mut stats = stats.lock().unwrap();
                stats.0 += text.len();
                stats.1 += file.heap_size();
                stats.2 += file.exprs.len();
                stats.3 += file.syntax_errors as usize;
                if file.has_errors || file.syntax_errors > 0 {
                    let at = (file.error_pos as usize).min(text.len());
                    let from = at.saturating_sub(60);
                    let context = String::from_utf8_lossy(&text[from..(at + 40).min(text.len())])
                        .replace('\n', "\\n");
                    stats.4.push(format!(
                        "{} errors={} type_syntax={} at {}: {}",
                        files[i].display(),
                        file.has_errors,
                        file.syntax_errors,
                        at,
                        context
                    ));
                }
            });
            let stats = stats.into_inner().unwrap();
            for line in &stats.4 {
                println!("{line}");
            }
            println!(
                "{} files, {} MB source, {} MB summaries, {} expressions, {} type syntax errors, {} files with errors, {:?}",
                files.len(),
                stats.0 >> 20,
                stats.1 >> 20,
                stats.2,
                stats.3,
                stats.4.len(),
                start.elapsed()
            );
        }
        // hir <files or directories> [--print]: what the front end makes of each file, as one line `path<TAB>hash of its dump`, sorted; with
        // --print the dumps themselves. For telling whether a change to the front end changes any tree.
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
            files.sort();
            let print = args.iter().any(|a| a == "--print");
            let atoms = Interner::new();
            let lines = std::sync::Mutex::new(Vec::<String>::new());
            bun_sema_standalone::for_each_parallel(4, files.len(), |i| {
                let Ok(text) = std::fs::read(&files[i]) else {
                    return;
                };
                let file =
                    bun_sema_standalone::parse(&files[i].to_string_lossy(), &text, &atoms, false);
                let (dump, orphans) =
                    bun_sema_standalone::hir_dump::dump_and_orphans(&file, &atoms);
                let line = if args.iter().any(|a| a == "--orphans") {
                    // The nodes nothing leads to.
                    if orphans.is_empty() {
                        return;
                    }
                    format!("{}\t{}", files[i].display(), orphans.join(" | "))
                } else if args.iter().any(|a| a == "--lens") {
                    // How many nodes there are of each kind: more than another way of parsing makes are nodes nothing refers to.
                    format!(
                        "{}\ttypes={} fns={} members={} params={} type_params={} pats={} exprs={} tuple_elems={} mapped={}",
                        files[i].display(),
                        file.types.len(),
                        file.fns.len(),
                        file.members.len(),
                        file.params.len(),
                        file.type_params.len(),
                        file.pats.len(),
                        file.exprs.len(),
                        file.tuple_elems.len(),
                        file.mapped.len()
                    )
                } else if print {
                    format!("=== {}\n{dump}", files[i].display())
                } else {
                    use std::hash::{Hash, Hasher};
                    let mut hasher = std::collections::hash_map::DefaultHasher::new();
                    dump.hash(&mut hasher);
                    format!("{}\t{:016x}", files[i].display(), hasher.finish())
                };
                lines.lock().unwrap().push(line);
            });
            let mut lines = lines.into_inner().unwrap();
            lines.sort();
            for line in &lines {
                println!("{line}");
            }
            let [kept, parsed_again] = [0, 1]
                .map(|i| bun_js_parser::sema::KEPT[i].load(std::sync::atomic::Ordering::Relaxed));
            eprintln!("type lookups: found {kept}; nothing kept {parsed_again}");
        }
        Some("load") => {
            let start = std::time::Instant::now();
            let files = bun_sema_standalone::load_tree(&args[1], &["src"], 4);
            let hir: usize = files.modules.iter().map(|m| m.hir.heap_size()).sum();
            let bound: usize = files.modules.iter().map(|m| m.bound.heap_size()).sum();
            println!(
                "{} files, {} MB syntax, {} MB bound, {} globals, {:?}",
                files.modules.len(),
                hir >> 20,
                bound >> 20,
                files.globals.len(),
                start.elapsed()
            );
            if args.iter().any(|a| a == "--list") {
                for m in &files.modules {
                    println!("{}", m.path);
                }
            }
        }
        Some("bench") => {
            // bench <tree> [--threads=n]: the type of every site of every source file, and nothing done with it.
            let tree = std::fs::canonicalize(&args[1])
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let threads: usize = args
                .iter()
                .find_map(|a| a.strip_prefix("--threads="))
                .and_then(|n| n.parse().ok())
                .unwrap_or(4);
            let start = std::time::Instant::now();
            let files = bun_sema_standalone::load_tree(&tree, &["src"], threads);
            let loaded = start.elapsed();
            let after_load = bun_sema_standalone::peak_rss();
            let with_errors = args.iter().any(|a| a == "--check");
            let program = bun_sema::check::Program::new(files);
            let prefix = format!("{tree}/");
            let sources: Vec<bun_sema::program::FileId> = (0..program.files.modules.len())
                .filter(|&i| {
                    let path = &program.files.modules[i].path;
                    path.starts_with(&prefix)
                        && !path.contains("/node_modules/")
                        && !path.ends_with(".d.ts")
                })
                .map(|i| bun_sema::program::FileId(i as u32))
                .collect();
            let sites = std::sync::atomic::AtomicU64::new(0);
            let unresolved = std::sync::atomic::AtomicU64::new(0);
            let start = std::time::Instant::now();
            bun_sema_standalone::for_each_parallel(threads, sources.len(), |i| {
                let mut checker = program.checker();
                checker.set_stack_limit(bun_sema_standalone::STACK - (64 << 20));
                let (mut n, mut u) = (0u64, 0u64);
                bun_sema::sites::for_each_site(&mut checker, sources[i], |_, _, _, ty| {
                    n += 1;
                    u += (ty == bun_sema::types::TypeId::UNRESOLVED) as u64;
                });
                if with_errors {
                    std::hint::black_box(checker.check_file(sources[i]));
                }
                sites.fetch_add(n, std::sync::atomic::Ordering::Relaxed);
                unresolved.fetch_add(u, std::sync::atomic::Ordering::Relaxed);
            });
            println!(
                "peak memory: {:.2} GB after loading, {:.2} GB at the end",
                after_load as f64 / (1u64 << 30) as f64,
                bun_sema_standalone::peak_rss() as f64 / (1u64 << 30) as f64
            );
            println!(
                "threads {threads}: {} files loaded in {:.2}s; {} sites of {} files resolved in {:.2}s ({} unresolved); {} types",
                program.files.modules.len(),
                loaded.as_secs_f64(),
                sites.into_inner(),
                sources.len(),
                start.elapsed().as_secs_f64(),
                unresolved.into_inner(),
                program.types.len(),
            );
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
                    paths.push(arg.clone());
                }
            }
            let has = |flag: &str| args.iter().any(|a| a == flag);
            let cwd = std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let lib_dir = std::env::var("BUN_SEMA_TS_LIB").ok();
            let report = bun_sema_driver::check(&bun_sema_driver::Request {
                cwd: &cwd,
                project: project.as_deref(),
                paths: &paths,
                threads: args
                    .iter()
                    .find_map(|a| a.strip_prefix("--threads="))
                    .and_then(|t| t.parse().ok())
                    .unwrap_or(0),
                lib_dir: lib_dir.as_deref(),
                global_node_modules: None,
                thread_start: &bun_sema_standalone::native::set_stack_size,
                file_time_limit: std::time::Duration::from_secs(10),
            });
            let cwd = bun_sema_driver::host::from_native(&cwd);
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
            };
            let mut out = String::new();
            write_diagnostics(&mut out, &report, &style);
            print!("{out}");
            let mut summary = String::new();
            write_summary(&mut summary, &report, &style);
            eprint!("{summary}");
            if has("--timing") {
                eprintln!(
                    "loaded {} files in {:.3}s, checked {} in {:.3}s, peak {:.2} GB",
                    report.files_loaded,
                    report.load_time.as_secs_f64(),
                    report.files_checked,
                    report.check_time.as_secs_f64(),
                    bun_sema_standalone::peak_rss() as f64 / (1u64 << 30) as f64
                );
            }
            std::process::exit(i32::from(report.error_count() > 0));
        }
        Some("check") => {
            // check <tsconfig.json with "files", or a directory of sources with a tsconfig.json> [--roots=a,b] [--threads=n]
            // Prints `path:line:column TS<code>` for every error outside node_modules and TypeScript's own lib.
            let flag = |name: &str| {
                args.iter()
                    .find_map(|a| a.strip_prefix(&format!("--{name}=")).map(str::to_owned))
            };
            let threads = flag("threads").and_then(|t| t.parse().ok()).unwrap_or(8);
            let target = std::fs::canonicalize(&args[1])
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let start = std::time::Instant::now();
            let (files, dir) = if target.ends_with(".json") {
                let dir = target.rsplit_once('/').unwrap().0.to_owned();
                (bun_sema_standalone::load_project(&target), dir)
            } else {
                let roots = flag("roots").unwrap_or_else(|| "src".to_owned());
                let roots: Vec<&str> = roots.split(',').collect();
                (
                    bun_sema_standalone::load_tree(&target, &roots, threads),
                    target.clone(),
                )
            };
            let loaded = start.elapsed();
            let program = bun_sema::check::Program::new(files);
            let prefix = format!("{dir}/");
            let sources: Vec<bun_sema::program::FileId> = (0..program.files.modules.len())
                .filter(|&i| {
                    let path = &program.files.modules[i].path;
                    path.starts_with(&prefix) && !path.contains("/node_modules/")
                })
                .map(|i| bun_sema::program::FileId(i as u32))
                .collect();
            // No file takes anywhere near this. One that does has run into a bug.
            let time_limit = std::time::Duration::from_millis(
                std::env::var("BUN_SEMA_FILE_LIMIT_MS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(3000),
            );
            let lines = std::sync::Mutex::new(Vec::new());
            for code in program.files.configuration_errors() {
                lines
                    .lock()
                    .unwrap()
                    .push(format!("tsconfig.json:1:1 TS{code}"));
            }
            let start = std::time::Instant::now();
            bun_sema_standalone::for_each_parallel(threads, sources.len(), |i| {
                let module = &program.files.modules[sources[i].0 as usize];
                let path = module.path.strip_prefix(&prefix).unwrap_or(&module.path);
                if module.hir.has_errors {
                    lines
                        .lock()
                        .unwrap()
                        .push(format!("{path}:1:1 REJECTED by the parser"));
                    return;
                }
                let mut checker = program.checker();
                checker.set_stack_limit(bun_sema_standalone::STACK - (64 << 20));
                checker.set_time_limit(time_limit);
                let errors = checker.check_file(sources[i]);
                if checker.timed_out() {
                    lines.lock().unwrap().push(format!("{path}:1:1 TIMEOUT"));
                }
                if errors.is_empty() {
                    return;
                }
                let text = &module.hir.text;
                let mut found: Vec<String> = errors
                    .iter()
                    .map(|e| {
                        let before = &text[..(e.start as usize).min(text.len())];
                        let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
                        let column = before.len()
                            - before
                                .iter()
                                .rposition(|&b| b == b'\n')
                                .map_or(0, |n| n + 1)
                            + 1;
                        format!("{path}:{line}:{column} TS{}", e.code)
                    })
                    .collect();
                lines.lock().unwrap().append(&mut found);
            });
            let mut lines = lines.into_inner().unwrap();
            lines.sort();
            for line in &lines {
                println!("{line}");
            }
            eprintln!(
                "{} errors in {} files checked ({} loaded in {:.2}s, checked in {:.2}s, peak {:.2} GB)",
                lines.len(),
                sources.len(),
                program.files.modules.len(),
                loaded.as_secs_f64(),
                start.elapsed().as_secs_f64(),
                bun_sema_standalone::peak_rss() as f64 / (1u64 << 30) as f64
            );
        }
        Some("at") => {
            // at <tree> <file relative to tree> <offset>...: every site at those offsets, with the properties of its type
            let tree = std::fs::canonicalize(&args[1])
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let files = bun_sema_standalone::load_tree(&tree, &["src"], 4);
            let program = bun_sema::check::Program::new(files);
            let file = program.files.by_path[&format!("{tree}/{}", args[2])];
            let offsets: Vec<u32> = args[3..].iter().filter_map(|a| a.parse().ok()).collect();
            // `e123`: where expression 123 of the file is, for reading traces.
            for id in args[3..]
                .iter()
                .filter_map(|a| a.strip_prefix('e'))
                .filter_map(|a| a.parse::<u32>().ok())
            {
                let expr = &program.files.modules[file.idx()].hir[bun_sema::hir::ExprId(id)];
                println!("e{id} at {}: {:?}", expr.pos, expr.kind);
            }
            bun_sema_standalone::for_each_parallel(1, 1, |_| {
                let mut checker = program.checker();
                checker.set_stack_limit(200 << 20);
                let mut found = Vec::new();
                bun_sema::sites::for_each_site(&mut checker, file, |_, pos, kind, ty| {
                    if offsets.contains(&pos) {
                        found.push((pos, kind, ty));
                    }
                });
                for (pos, kind, ty) in found {
                    let text = bun_sema::describe::Describer::new(&mut checker).describe(ty);
                    println!("{pos} {} {text}", kind.code());
                    println!("  {:?}", checker.data(ty));
                    if args.iter().any(|a| a == "--props") {
                        for &part in checker.parts(ty) {
                            if let Some(members) = checker.members(part) {
                                let mut names: Vec<String> = members
                                    .shape()
                                    .props
                                    .iter()
                                    .map(|p| program.files.atoms.text(p.name).into_owned())
                                    .collect();
                                names.sort();
                                println!("  props({}): {}", names.len(), names.join(" "));
                            }
                        }
                    }
                }
            });
        }
        Some("compare") => {
            // compare <tree> <oracle dump> [--only=substring] [--report=file] [--threads=n] [--roots=a,b]
            let flag = |name: &str| {
                args.iter()
                    .find_map(|a| a.strip_prefix(&format!("--{name}=")).map(str::to_owned))
            };
            let threads = flag("threads").and_then(|t| t.parse().ok()).unwrap_or(4);
            let roots = flag("roots").unwrap_or_else(|| "src".to_owned());
            let roots: Vec<&str> = roots.split(',').collect();
            let start = std::time::Instant::now();
            let tree = std::fs::canonicalize(&args[1])
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let files = bun_sema_standalone::load_tree(&tree, &roots, threads);
            let loaded = start.elapsed();
            let program = bun_sema::check::Program::new(files);
            let oracle = bun_sema_standalone::compare::Oracle::parse(
                &std::fs::read_to_string(&args[2]).unwrap(),
            );
            let start = std::time::Instant::now();
            let comparison = bun_sema_standalone::compare::compare(
                &program,
                &tree,
                &oracle,
                threads,
                flag("only").as_deref(),
            );
            print!("{}", bun_sema_standalone::compare::table(&comparison));
            println!(
                "{} files loaded in {loaded:?}, resolved and compared in {:?}, {} types, {} files not loaded",
                program.files.modules.len(),
                start.elapsed(),
                program.types.len(),
                comparison.files_not_loaded
            );
            print!(
                "{}",
                bun_sema_standalone::compare::error_table(&comparison, 40)
            );
            if let Some(path) = flag("errors") {
                let mut bad = comparison.errors_bad.clone();
                bad.sort_unstable();
                std::fs::write(path, bad.join("\n")).unwrap();
            }
            if let Some(path) = flag("bad") {
                let mut bad = comparison.bad.clone();
                bad.sort_unstable();
                std::fs::write(path, bad.join("\n")).unwrap();
            }
            if let Some(path) = flag("report") {
                std::fs::write(
                    path,
                    bun_sema_standalone::compare::report(
                        &comparison,
                        flag("limit").and_then(|l| l.parse().ok()).unwrap_or(400),
                    ),
                )
                .unwrap();
            }
        }
        Some("messages") => {
            // messages <root> <oracle dump with tests> [--only=substring] [--threads=n]: every error of every test as it would be shown:
            // path, start, end, code, and the message with its line feeds escaped, separated by tabs.
            let flag = |name: &str| {
                args.iter()
                    .find_map(|a| a.strip_prefix(&format!("--{name}=")).map(str::to_owned))
            };
            let threads = flag("threads").and_then(|t| t.parse().ok()).unwrap_or(4);
            let only = flag("only");
            let root = std::fs::canonicalize(&args[1])
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let oracle = bun_sema_standalone::compare::Oracle::parse(
                &std::fs::read_to_string(&args[2]).unwrap(),
            );
            let lines = std::sync::Mutex::new(Vec::new());
            bun_sema_standalone::for_each_parallel(threads, oracle.tests.len(), |i| {
                let test = &oracle.tests[i];
                if test.refused.is_some() || only.as_ref().is_some_and(|o| !test.dir.contains(o)) {
                    return;
                }
                let files = bun_sema_standalone::load_project(&format!(
                    "{root}/{}/tsconfig.json",
                    test.dir
                ));
                if files.modules.iter().any(|m| m.hir.has_errors) {
                    return;
                }
                let program = bun_sema::check::Program::new(files);
                let mut found = Vec::new();
                for expected in &oracle.files[test.files.clone()] {
                    let Some(&file) = program
                        .files
                        .by_path
                        .get(&format!("{root}/{}", expected.path))
                    else {
                        continue;
                    };
                    let mut checker = program.checker();
                    checker.set_stack_limit(bun_sema_standalone::STACK - (64 << 20));
                    checker.set_time_limit(std::time::Duration::from_secs(3));
                    for e in checker.check_file_explained(file) {
                        found.push(format!(
                            "{}\t{}\t{}\t{}\t{}",
                            expected.path,
                            e.start,
                            e.end,
                            e.code,
                            e.text.replace('\\', "\\\\").replace('\n', "\\n")
                        ));
                    }
                }
                lines.lock().unwrap().append(&mut found);
            });
            let mut lines = lines.into_inner().unwrap();
            lines.sort();
            println!("{}", lines.join("\n"));
        }
        Some("suite") => {
            // suite <root> <oracle dump with tests> [--only=substring] [--report=file] [--bad=file] [--threads=n]
            let flag = |name: &str| {
                args.iter()
                    .find_map(|a| a.strip_prefix(&format!("--{name}=")).map(str::to_owned))
            };
            let threads = flag("threads").and_then(|t| t.parse().ok()).unwrap_or(4);
            let root = std::fs::canonicalize(&args[1])
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let oracle = bun_sema_standalone::compare::Oracle::parse(
                &std::fs::read_to_string(&args[2]).unwrap(),
            );
            let start = std::time::Instant::now();
            let comparison = bun_sema_standalone::compare::suite(
                &root,
                &oracle,
                threads,
                flag("only").as_deref(),
            );
            print!("{}", bun_sema_standalone::compare::table(&comparison));
            println!(
                "{} tests in {:?}: every site agrees in {} ({:.1}%); {} rejected by the parser, {} refused by the oracle, {} files not loaded; {} errors expected",
                comparison.tests,
                start.elapsed(),
                comparison.tests_agreeing,
                comparison.tests_agreeing as f64 * 100.0 / comparison.tests.max(1) as f64,
                comparison.tests_rejected,
                comparison.tests_refused,
                comparison.files_not_loaded,
                comparison.errors_expected
            );
            if let Some(path) = flag("bad") {
                let mut bad = comparison.bad.clone();
                bad.sort_unstable();
                std::fs::write(path, bad.join("\n")).unwrap();
            }
            print!(
                "{}",
                bun_sema_standalone::compare::error_table(&comparison, 40)
            );
            println!(
                "the errors are exactly the expected ones in {} tests ({:.1}%)",
                comparison.tests_with_same_errors,
                comparison.tests_with_same_errors as f64 * 100.0 / comparison.tests.max(1) as f64
            );
            if let Some(path) = flag("errors") {
                let mut bad = comparison.errors_bad.clone();
                bad.sort_unstable();
                std::fs::write(path, bad.join("\n")).unwrap();
            }
            if let Some(path) = flag("rejected") {
                let mut rejected = comparison.rejected.clone();
                rejected.sort_unstable();
                std::fs::write(path, rejected.join("\n")).unwrap();
            }
            if let Some(path) = flag("report") {
                std::fs::write(
                    path,
                    bun_sema_standalone::compare::report(
                        &comparison,
                        flag("limit").and_then(|l| l.parse().ok()).unwrap_or(400),
                    ),
                )
                .unwrap();
            }
        }
        _ => eprintln!("usage: bun-sema parse [--dts] <files or directories>"),
    }
}
