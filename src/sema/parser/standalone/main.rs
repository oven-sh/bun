//! `bun-hir`: the test harness of `bun_sema_parser`.
//!
//! - `compare <file or directory>.. [--jobs=n] [--show=n] [--decorators] [--list]`: parses every
//!   file with both parsers and compares the results node by node.
//! - `bench <file or directory>.. [--reference] [--repeat=n]`: parses every file on one thread.
//! - `snippets <file.json>..`: the same comparison for the `code` strings of test fixtures.

mod compare;

use bun_sema::atom::Interner;
use bun_sema::resolve::ScriptKind;
use bun_sema::session::Session;
use bun_sema_parser::{Options, Refused, Scratch};
use std::collections::BTreeMap;
use std::sync::Mutex;

const EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

fn walk(path: &std::path::Path, files: &mut Vec<String>) {
    if path.is_dir() {
        let mut entries: Vec<_> = std::fs::read_dir(path)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .collect();
        entries.sort();
        for entry in entries {
            let name = entry.file_name().unwrap_or_default();
            if name != "node_modules" && name != ".git" {
                walk(&entry, files);
            }
        }
    } else if (path.extension()).is_some_and(|it| EXTENSIONS.iter().any(|ext| it == *ext)) {
        files.push(path.to_string_lossy().into_owned());
    }
}

fn options_for(path: &[u8]) -> Options {
    let kind = ScriptKind::from_file_name(path);
    let is_javascript = kind.is_some_and(ScriptKind::is_javascript);
    Options {
        is_declaration_file: bun_sema::resolve::is_declaration_file_name(path),
        is_jsx: is_javascript || kind == Some(ScriptKind::Tsx),
        is_javascript,
        await_is_a_name: false,
    }
}

enum Outcome {
    Identical,
    /// The reference reports an error, and so the direct parser is right to refuse.
    BothRefuse,
    Refused(Refused),
    /// The direct parser accepts what the reference reports an error about.
    Accepted(String),
    Different(String),
}

fn compare_one(path: &[u8], text: &[u8], decorators: bool, scratch: &mut Scratch) -> Outcome {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let (reference, _) =
        bun_js_parser::sema::summarize_with_recovery(
            Default::default(),
            (arena, &session),
            path,
            None,
            text,
            &atoms,
            decorators,
            false,
        );
    let is_refused_by_reference = reference.has_errors
        || reference.has_parse_diagnostics
        || !reference.diagnostics.is_empty()
        || reference.ran_out_of_stack;
    let mut options = options_for(path);
    let mut parsed = bun_sema_parser::parse(text, options, &atoms, scratch);
    // `parseSourceFileWorker`: only a module has an await context at its top level.
    if let Ok(first) = &parsed
        && first.has_top_level_await
        && !first.file.has_module_syntax
        && ![&b".mts"[..], b".cts", b".mjs", b".cjs"]
            .iter()
            .any(|extension| path.ends_with(extension))
        && !(first.file.exprs.iter()).any(|e| matches!(e.kind, bun_sema::hir::ExprKind::ImportMeta))
    {
        options.await_is_a_name = true;
        parsed = bun_sema_parser::parse(text, options, &atoms, scratch);
    }
    match parsed {
        Err(_) if is_refused_by_reference => Outcome::BothRefuse,
        Err(why) => Outcome::Refused(why),
        Ok(parsed) => {
            let outcome = if is_refused_by_reference {
                let first = reference.diagnostics.first();
                Outcome::Accepted(format!(
                    "{:?}",
                    first.map(|it| (it.kind, it.code, it.start))
                ))
            } else {
                let mut comparison = compare::Comparison::new(&reference, &parsed.file);
                comparison.run();
                match comparison.difference.take() {
                    Some(difference) => Outcome::Different(difference),
                    None => Outcome::Identical,
                }
            };
            scratch.recycle(parsed.file);
            outcome
        }
    }
}

#[derive(Default)]
struct Totals {
    identical: usize,
    both_refuse: usize,
    refused: BTreeMap<String, Vec<String>>,
    accepted: Vec<(String, String)>,
    different: Vec<(String, String)>,
}

impl Totals {
    fn add(&mut self, name: &str, outcome: Outcome) {
        match outcome {
            Outcome::Identical => self.identical += 1,
            Outcome::BothRefuse => self.both_refuse += 1,
            Outcome::Refused(it) => self
                .refused
                .entry(format!("{:?}", it.why))
                .or_default()
                .push(format!("{name}:{} by {}:{}", it.at, it.by.file(), it.by.line())),
            Outcome::Accepted(what) => self.accepted.push((name.to_owned(), what)),
            Outcome::Different(what) => self.different.push((name.to_owned(), what)),
        }
    }

    fn print(&mut self, show: usize, list: bool) {
        self.different.sort();
        self.accepted.sort();
        for (name, what) in self.different.iter().take(show) {
            println!("DIFFERENT {name}\n    {what}");
        }
        for (name, what) in self.accepted.iter().take(show) {
            println!("ACCEPTED {name}\n    the reference reports {what}");
        }
        for (why, names) in &mut self.refused {
            names.sort();
            for name in names.iter().take(if list { usize::MAX } else { 3.min(show) }) {
                println!("REFUSED {why} {name}");
            }
        }
        let refused: usize = self.refused.values().map(Vec::len).sum();
        let valid = self.identical + refused + self.different.len();
        println!(
            "{} valid for the reference: {} identical ({:.2} %), {} different, {} refused; {} with errors: {} refused by both, {} accepted",
            valid,
            self.identical,
            self.identical as f64 * 100.0 / valid.max(1) as f64,
            self.different.len(),
            refused,
            self.both_refuse + self.accepted.len(),
            self.both_refuse,
            self.accepted.len(),
        );
        for (why, names) in &self.refused {
            println!("    refused: {why} {}", names.len());
        }
    }
}

fn flag(args: &[String], name: &str) -> Option<usize> {
    let prefix = format!("--{name}=");
    args.iter()
        .find_map(|arg| arg.strip_prefix(&prefix)?.parse().ok())
}

fn files_of(args: &[String]) -> Vec<String> {
    let mut files = Vec::new();
    for arg in args.iter().filter(|arg| !arg.starts_with("--")) {
        walk(std::path::Path::new(arg), &mut files);
    }
    files
}

fn compare(args: &[String]) {
    let files = files_of(args);
    let decorators = args.iter().any(|arg| arg == "--decorators");
    let totals = Mutex::new(Totals::default());
    bun_sema_standalone::for_each_parallel(flag(args, "jobs").unwrap_or(8), files.len(), |i| {
        thread_local! {
            static SCRATCH: std::cell::RefCell<Scratch> = Default::default();
        }
        let Ok(text) = std::fs::read(&files[i]) else {
            return;
        };
        let outcome = SCRATCH.with_borrow_mut(|scratch| {
            compare_one(files[i].as_bytes(), &text, decorators, scratch)
        });
        totals.lock().unwrap().add(&files[i], outcome);
    });
    let list = args.iter().any(|arg| arg == "--list");
    totals
        .into_inner()
        .unwrap()
        .print(flag(args, "show").unwrap_or(10), list);
}

fn bench(args: &[String]) {
    let files = files_of(args);
    let texts: Vec<Vec<u8>> = files.iter().filter_map(|it| std::fs::read(it).ok()).collect();
    let bytes: usize = texts.iter().map(Vec::len).sum();
    let is_reference = args.iter().any(|arg| arg == "--reference");
    let is_lexer = args.iter().any(|arg| arg == "--lexer");
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let mut scratch = Scratch::default();
    for _ in 0..flag(args, "repeat").unwrap_or(1) {
        let started = std::time::Instant::now();
        let (mut parsed, mut nodes) = (0usize, 0usize);
        for (path, text) in files.iter().zip(&texts) {
            if is_lexer {
                nodes += bun_sema_parser::count_tokens(text, &atoms, &mut scratch);
                parsed += 1;
            } else if is_reference {
                let session = Session::new();
                let atoms = Interner::new_in(&session);
                let file = bun_js_parser::sema::summarize(
                    session.arena(),
                    path.as_bytes(),
                    None,
                    text,
                    &atoms,
                    false,
                    false,
                );
                nodes += file.0.exprs.len();
                parsed += 1;
            } else if let Ok(file) =
                bun_sema_parser::parse(text, options_for(path.as_bytes()), &atoms, &mut scratch)
            {
                nodes += file.file.exprs.len();
                parsed += 1;
                scratch.recycle(file.file);
            }
        }
        let elapsed = started.elapsed().as_secs_f64();
        println!(
            "{parsed} of {} files, {:.1} MB, {nodes} expressions, {:.0} ms, {:.0} MB/s",
            files.len(),
            bytes as f64 / 1e6,
            elapsed * 1e3,
            bytes as f64 / 1e6 / elapsed
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let stack = 16 << 20;
    let run = move || {
        bun_sema_standalone::native::set_stack_size(stack - (256 << 10));
        match args.first().map(String::as_str) {
            Some("compare") => compare(&args[1..]),
            Some("bench") => bench(&args[1..]),
            _ => eprintln!("usage: bun-hir compare|bench <paths>"),
        }
    };
    std::thread::Builder::new()
        .stack_size(stack)
        .spawn(run)
        .unwrap()
        .join()
        .unwrap();
}
