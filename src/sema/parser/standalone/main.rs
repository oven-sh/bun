//! `bun-hir`: the test harness of `bun_sema_parser`.
//!
//! - `compare <file or directory>.. [--jobs=n] [--show=n] [--decorators] [--list]
//!   [--dialect=tsc|estree|espree|babel] [--script] [--recover]`: parses every file with both parsers and
//!   compares the results node by node. A `.jsonl` file is a list of texts, one to a line:
//!   `{"id", "filename", "code", "sourceType", "parser"}`. Without `--dialect` such a text is read as
//!   its `parser` reads it, `"espree"` or `"typescript"`, and a file as `tsc` reads it.
//! - `dump <inputs as for compare>`: what the reference makes of each.
//! - `bench <file or directory>.. [--reference] [--repeat=n]`: parses every file on one thread.
//! - `snippets <file.json>..`: the same comparison for the `code` strings of test fixtures.

#![forbid(unsafe_code)]

mod compare;
mod fuzz;

use bun_sema::atom::{Intern, Interner};
use bun_sema::hir::DiagnosticKind;
use bun_sema::resolve::{Dialect, ScriptKind};
use bun_sema::session::Session;
use bun_sema_parser::{Options, Refused, Scratch};
use bun_sema_standalone::host::{self, error_line, output_line};
use bun_threading::Guarded;
use std::collections::BTreeMap;

const EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

fn walk(path: &std::path::Path, files: &mut Vec<String>) {
    if path.is_dir() {
        let mut entries = host::list(path);
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

fn options_for(path: &[u8], dialect: Dialect) -> Options {
    let kind = ScriptKind::from_file_name(path);
    let is_javascript = kind.is_some_and(ScriptKind::is_javascript);
    Options {
        is_declaration_file: bun_sema::resolve::is_declaration_file_name(path),
        is_jsx: is_javascript || kind == Some(ScriptKind::Tsx),
        is_javascript,
        await_is_a_name: is_javascript && dialect.ecmascript && dialect.script,
        recovers: false,
        dialect,
    }
}

/// The dialect that `name` stands for.
fn dialect_of(name: &str, script: bool) -> Option<Dialect> {
    Some(match name {
        "tsc" => Dialect::default(),
        "estree" | "typescript" => Dialect::typescript_estree(script),
        "espree" => Dialect::espree(script),
        "babel" => Dialect::babel(script),
        "flow" => Dialect::flow(script),
        _ => return None,
    })
}

enum Outcome {
    /// With the first list that is numbered in another order, if any.
    Identical(Option<&'static str>),
    /// The reference reports an error, and so the direct parser is right to refuse. With the first
    /// error.
    BothRefuse(Refused, String),
    /// With the first diagnostic of the reference, which is not about the syntax.
    Refused(Refused, Option<String>),
    /// The direct parser accepts what the reference reports an error about.
    Accepted(String),
    Different(String),
    /// Both report errors, and go on in the same way.
    Recovered,
    /// Both report errors. With the first difference.
    RecoveredDifferently(String),
}

fn compare_one(
    path: &[u8],
    text: &[u8],
    decorators: bool,
    dialect: Dialect,
    recovers: bool,
    scratch: &mut Scratch,
) -> Outcome {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    // As the linter has it.
    let every_file_is_a_module = dialect != Dialect::default() && !dialect.script;
    let (reference, _) = bun_js_parser::sema::summarize_with_recovery(
        dialect,
        false,
        (arena, &session),
        path,
        None,
        text,
        &atoms,
        decorators,
        every_file_is_a_module,
    );
    // The other diagnostics are about a tree that is the same without them: they are compared.
    let is_refused_by_reference = reference.has_errors
        || reference.has_parse_diagnostics
        || (reference.diagnostics.iter()).any(|it| it.kind == DiagnosticKind::Parse)
        || reference.ran_out_of_stack;
    let mut options = options_for(path, dialect);
    options.recovers = recovers;
    let mut parsed = bun_sema_parser::parse(text, options, &atoms, scratch);
    // `parseSourceFileWorker`: only a module has an await context at its top level.
    if let Ok(first) = &parsed
        && first.has_top_level_await
        && !every_file_is_a_module
        && !first.file.has_module_syntax
        && (dialect.script
            || ![&b".mts"[..], b".cts", b".mjs", b".cjs"]
                .iter()
                .any(|extension| path.ends_with(extension)))
        && !(first.file.exprs.iter()).any(|e| matches!(e.kind, bun_sema::hir::ExprKind::ImportMeta))
    {
        options.await_is_a_name = true;
        parsed = bun_sema_parser::parse(text, options, &atoms, scratch);
    }
    match parsed {
        Err(why) if is_refused_by_reference => {
            let first = reference.diagnostics.first();
            let first = first.map(|it| (it.kind, it.code, it.start));
            Outcome::BothRefuse(why, format!("{first:?}"))
        }
        Err(why) => {
            let first = reference.diagnostics.first();
            Outcome::Refused(
                why,
                first.map(|it| format!("{:?}", (it.kind, it.code, it.start))),
            )
        }
        Ok(parsed) => {
            let outcome = if is_refused_by_reference && parsed.file.has_parse_diagnostics {
                let mut comparison = compare::Comparison::new(&reference, &parsed.file);
                comparison.run();
                match comparison.difference.take() {
                    Some(difference) => Outcome::RecoveredDifferently(difference),
                    None => Outcome::Recovered,
                }
            } else if is_refused_by_reference {
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
                    None => match difference_with_own_atoms(text, options, scratch) {
                        Some(difference) => Outcome::Different(difference),
                        None => Outcome::Identical(comparison.other_order),
                    },
                }
            };
            scratch.recycle(parsed.file);
            outcome
        }
    }
}

/// Parses `text` with the atoms of an interner that has seen nothing else, and with atoms of its
/// own. Both number a text where it first occurs, so the results have to be the same.
fn difference_with_own_atoms(
    text: &[u8],
    options: Options,
    scratch: &mut Scratch,
) -> Option<String> {
    let session = Session::new();
    let interner = Interner::new_in(&session);
    let shared = bun_sema_parser::parse(text, options, &interner, scratch)
        .ok()?
        .file;
    let Ok(own) = bun_sema_parser::parse_with_own_atoms(text, options, scratch) else {
        return Some("refused with its own atoms".to_owned());
    };
    let mut comparison = compare::Comparison::new(&shared, &own.file);
    comparison.run();
    if let Some(difference) = comparison.difference.take() {
        return Some(format!("with its own atoms: {difference}"));
    }
    let atoms = scratch.atoms(text);
    for atom in (0..atoms.len()).map(bun_sema::atom::Atom) {
        let written = atoms.bytes(atom);
        if written != interner.bytes(atom) {
            return Some(format!("the text of its own {atom:?}"));
        }
        let is_mentioned = own.file.may_mention(bun_sema::hir::mention_bit(written));
        if atoms.intern(written) != atom
            || atoms.find(written).is_some() != atoms.has(atom)
            || atoms.has(atom) && !is_mentioned
        {
            return Some(format!("its own {atom:?} is not found again"));
        }
    }
    let absent = atoms.intern(b"\0 a text that is in no file");
    if atoms.bytes(absent) != b"\0 a text that is in no file"
        || atoms.intern(b"\0 a text that is in no file") != absent
        || atoms.find(b"\0 a text that is in no file").is_some()
    {
        return Some("a text that is not in the file".to_owned());
    }
    None
}

#[derive(Default)]
struct Totals {
    identical: usize,
    other_order: BTreeMap<&'static str, Vec<String>>,
    both_refuse: Vec<String>,
    refused: BTreeMap<String, Vec<String>>,
    accepted: Vec<(String, String)>,
    different: Vec<(String, String)>,
    recovered: usize,
    recovered_differently: Vec<(String, String)>,
}

impl Totals {
    fn add(&mut self, name: &str, outcome: Outcome) {
        match outcome {
            Outcome::Identical(other_order) => {
                self.identical += 1;
                if let Some(list) = other_order {
                    self.other_order
                        .entry(list)
                        .or_default()
                        .push(name.to_owned());
                }
            }
            Outcome::BothRefuse(it, first) => self.both_refuse.push(format!(
                "{:?} {name}:{} by {}:{} the reference reports {first}",
                it.why,
                it.at,
                it.by.file(),
                it.by.line()
            )),
            Outcome::Refused(it, first) => (self.refused.entry(format!("{:?}", it.why)))
                .or_default()
                .push(format!(
                    "{name}:{} by {}:{}{}",
                    it.at,
                    it.by.file(),
                    it.by.line(),
                    first.map_or_else(String::new, |it| format!(
                        " the reference reports Some({it})"
                    ))
                )),
            Outcome::Accepted(what) => self.accepted.push((name.to_owned(), what)),
            Outcome::Different(what) => self.different.push((name.to_owned(), what)),
            Outcome::Recovered => self.recovered += 1,
            Outcome::RecoveredDifferently(what) => {
                self.recovered_differently.push((name.to_owned(), what));
            }
        }
    }

    fn print(&mut self, show: usize, list: bool) {
        self.different.sort();
        self.accepted.sort();
        for (name, what) in self.different.iter().take(show) {
            output_line!("DIFFERENT {name}\n    {what}");
        }
        for (name, what) in self.accepted.iter().take(show) {
            output_line!("ACCEPTED {name}\n    the reference reports {what}");
        }
        for (why, names) in &mut self.refused {
            names.sort();
            for name in names
                .iter()
                .take(if list { usize::MAX } else { 3.min(show) })
            {
                output_line!("REFUSED {why} {name}");
            }
        }
        if list {
            self.both_refuse.sort();
            for name in &self.both_refuse {
                output_line!("BOTH {name}");
            }
        }
        let refused: usize = self.refused.values().map(Vec::len).sum();
        let valid = self.identical + refused + self.different.len();
        output_line!(
            "{} valid for the reference: {} identical ({:.2} %), {} different, {} refused; {} with errors: {} refused by both, {} accepted",
            valid,
            self.identical,
            self.identical as f64 * 100.0 / valid.max(1) as f64,
            self.different.len(),
            refused,
            self.both_refuse.len() + self.accepted.len(),
            self.both_refuse.len(),
            self.accepted.len(),
        );
        if self.recovered + self.recovered_differently.len() > 0 {
            self.recovered_differently.sort();
            if list {
                for (name, what) in &self.recovered_differently {
                    output_line!("RECOVERED DIFFERENTLY {name}\n    {what}");
                }
            }
            output_line!(
                "    with errors: {} recovered as the reference, {} differently",
                self.recovered,
                self.recovered_differently.len()
            );
        }
        for (why, names) in &self.refused {
            output_line!("    refused: {why} {}", names.len());
        }
        for (list, names) in &mut self.other_order {
            names.sort();
            output_line!(
                "    identical, but numbered in another order: {list} {} (e.g. {})",
                names.len(),
                names[0]
            );
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

/// A text to parse.
struct Input {
    /// What it is called in the output.
    id: String,
    /// The name that says which language it is.
    path: String,
    /// `None`: that of the file at `path`.
    text: Option<Vec<u8>>,
    dialect: Dialect,
}

/// The value of the string field `name` of the JSON object `line`.
fn json_field(line: &str, name: &str) -> Option<String> {
    let rest = &line[host::find(line, &format!("\"{name}\":\""))? + name.len() + 4..];
    let (mut value, mut chars) = (Vec::new(), rest.chars());
    loop {
        match chars.next()? {
            '"' => break,
            '\\' => match chars.next()? {
                'n' => value.push(u16::from(b'\n')),
                'r' => value.push(u16::from(b'\r')),
                't' => value.push(u16::from(b'\t')),
                'b' => value.push(8),
                'f' => value.push(12),
                'u' => {
                    let digits: String = chars.by_ref().take(4).collect();
                    value.push(u16::from_str_radix(&digits, 16).ok()?);
                }
                other => value.extend(other.encode_utf16(&mut [0; 2]).iter()),
            },
            other => value.extend(other.encode_utf16(&mut [0; 2]).iter()),
        }
    }
    Some(String::from_utf16_lossy(&value))
}

fn inputs_of(args: &[String]) -> Vec<Input> {
    let script = args.iter().any(|arg| arg == "--script");
    let chosen = args.iter().find_map(|arg| arg.strip_prefix("--dialect="));
    let mut inputs = Vec::new();
    for arg in args.iter().filter(|arg| !arg.starts_with("--")) {
        if !arg.ends_with(".jsonl") {
            let mut files = Vec::new();
            walk(std::path::Path::new(arg), &mut files);
            let dialect = dialect_of(chosen.unwrap_or("tsc"), script).expect("a dialect");
            inputs.extend(files.into_iter().map(|path| Input {
                id: path.clone(),
                path,
                text: None,
                dialect,
            }));
            continue;
        }
        let lines = host::read_text(arg).expect("the list of texts");
        for line in host::lines(&lines) {
            let field = |name: &str| json_field(line, name);
            let (Some(id), Some(path), Some(code)) =
                (field("id"), field("filename"), field("code"))
            else {
                continue;
            };
            let script = script || field("sourceType").is_some_and(|it| it != "module");
            let parser = field("parser").unwrap_or_default();
            let Some(dialect) = dialect_of(chosen.unwrap_or(&parser), script) else {
                continue;
            };
            inputs.push(Input {
                id,
                path,
                text: Some(code.into_bytes()),
                dialect,
            });
        }
    }
    inputs
}

fn compare(args: &[String]) {
    let inputs = inputs_of(args);
    let decorators = args.iter().any(|arg| arg == "--decorators");
    let recovers = args.iter().any(|arg| arg == "--recover");
    let mut totals = Guarded::new(Totals::default());
    bun_sema_standalone::for_each_parallel(flag(args, "jobs").unwrap_or(8), inputs.len(), |i| {
        thread_local! {
            static SCRATCH: std::cell::RefCell<Scratch> = Default::default();
        }
        let input = &inputs[i];
        let read;
        let text = match &input.text {
            Some(text) => text,
            None => match host::read(&input.path) {
                Ok(text) => {
                    read = text;
                    &read
                }
                Err(_) => return,
            },
        };
        let outcome = SCRATCH.with_borrow_mut(|scratch| {
            compare_one(
                input.path.as_bytes(),
                text,
                decorators,
                input.dialect,
                recovers,
                scratch,
            )
        });
        totals.lock().add(&input.id, outcome);
    });
    let list = args.iter().any(|arg| arg == "--list");
    totals
        .get_mut()
        .print(flag(args, "show").unwrap_or(10), list);
}

fn dump(args: &[String]) {
    for input in inputs_of(args) {
        let Some(text) = input.text.or_else(|| host::read(&input.path).ok()) else {
            continue;
        };
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let dialect = input.dialect;
        let (reference, _) = bun_js_parser::sema::summarize_with_recovery(
            dialect,
            false,
            (session.arena(), &session),
            input.path.as_bytes(),
            None,
            &text,
            &atoms,
            args.iter().any(|arg| arg == "--decorators"),
            dialect != Dialect::default() && !dialect.script,
        );
        let (nodes, _) = bun_sema_standalone::hir_dump::dump_and_orphans(&reference, &atoms);
        output_line!("=== {}\n{nodes}", input.id);
    }
}

/// `fuzz <file or directory>.. [--rounds=n] [--seed=n] [--jobs=n] [--keep=directory] [--dialect=..]`
fn fuzz(args: &[String]) {
    let files = files_of(args);
    let how = (
        flag(args, "rounds").unwrap_or(20),
        flag(args, "seed").unwrap_or(1) as u64,
        flag(args, "jobs").unwrap_or(8),
    );
    let option = |name: &str| args.iter().find_map(|arg| arg.strip_prefix(name));
    let script = args.iter().any(|arg| arg == "--script");
    let dialect = dialect_of(option("--dialect=").unwrap_or("tsc"), script).expect("a dialect");
    fuzz::run(
        &files,
        how,
        option("--keep=").unwrap_or("fuzz-out"),
        &|path, text| {
            thread_local! {
                static SCRATCH: std::cell::RefCell<Scratch> = Default::default();
            }
            match SCRATCH
                .with_borrow_mut(|scratch| compare_one(path, text, false, dialect, false, scratch))
            {
                Outcome::Identical(_) => fuzz::Verdict::Identical,
                Outcome::BothRefuse(..) | Outcome::Refused(..) => fuzz::Verdict::Refused,
                Outcome::Accepted(what) => fuzz::Verdict::Wrong(format!("accepted: {what}")),
                Outcome::Different(what) => fuzz::Verdict::Wrong(format!("different: {what}")),
                Outcome::Recovered | Outcome::RecoveredDifferently(_) => fuzz::Verdict::Refused,
            }
        },
    );
}

fn bench(args: &[String]) {
    let files = files_of(args);
    let texts: Vec<Vec<u8>> = files.iter().filter_map(|it| host::read(it).ok()).collect();
    let bytes: usize = texts.iter().map(Vec::len).sum();
    let is_reference = args.iter().any(|arg| arg == "--reference");
    let is_lexer = args.iter().any(|arg| arg == "--lexer");
    let has_own_atoms = args.iter().any(|arg| arg == "--own-atoms");
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
            } else if let Ok(file) = {
                let options = options_for(path.as_bytes(), Dialect::default());
                match has_own_atoms {
                    true => bun_sema_parser::parse_with_own_atoms(text, options, &mut scratch),
                    false => bun_sema_parser::parse(text, options, &atoms, &mut scratch),
                }
            } {
                nodes += file.file.exprs.len();
                parsed += 1;
                scratch.recycle(file.file);
            }
        }
        let elapsed = started.elapsed().as_secs_f64();
        output_line!(
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
            Some("dump") => dump(&args[1..]),
            Some("bench") => bench(&args[1..]),
            Some("fuzz") => fuzz(&args[1..]),
            _ => error_line!("usage: bun-hir compare|bench <paths>"),
        }
    };
    std::thread::Builder::new()
        .stack_size(stack)
        .spawn(run)
        .unwrap()
        .join()
        .unwrap();
}
