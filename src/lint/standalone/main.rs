//! `bun-lint`: the linter without the rest of Bun, for developing and testing rules.
//!
//! - `bun-lint conformance <fixtures> [--plugin=p] [--rule=r] [--report=dir] [--verbose]`: runs the
//!   test cases of ESLint and typescript-eslint (test/cli/lint/conformance/fixtures) and compares
//!   with what ESLint reports for them.
//! - `bun-lint run <rule> <file> [options as JSON]`: what one rule reports for one file.

mod ast_cmd;
mod code_path_cmd;
mod driver_cmd;
mod format_cmd;
mod linter_cmd;
mod regex_cmd;
mod selector_cmd;
mod semantic_cmd;
mod tokens_cmd;
mod types_cmd;
mod utils_eslint_cmd;
mod utils_tsscope_cmd;
mod utils_ts_cmd;
mod utils_core_cmd;
mod utils_small_cmd;

use bun_lint::context::Severity;
use bun_lint::language::LanguageOptions;
use bun_lint::options::{Json, Options};
use bun_lint::rule::Plugin;
use bun_lint::runner::{Enabled, RuleEntry};
use std::fmt::Write as _;

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn find_rule(plugin: Plugin, name: &str) -> Option<&'static RuleEntry> {
    let all = bun_lint_eslint::RULES.iter().chain(bun_lint_typescript::RULES);
    all.into_iter().find(|it| it.meta.plugin == plugin && it.meta.name == name)
}

/// What a rule reports for `code`, as ESLint would print it, and the code after one pass of fixes.
struct Outcome {
    messages: Vec<Reported>,
    output: Option<Vec<u8>>,
    has_parse_errors: bool,
}

#[derive(PartialEq, Eq, Debug)]
struct Reported {
    /// `None`: the rule that is tested. Empty: the linter itself.
    rule_id: Option<String>,
    message_id: String,
    message: String,
    line: u32,
    column: u32,
    end: Option<(u32, u32)>,
    /// The code after each suggestion.
    suggestions: Vec<(String, String)>,
}

pub(crate) use linter_cmd::with_file;

fn lint(
    entry: &'static RuleEntry,
    path: &str,
    code: &[u8],
    options: &[Json],
    language_options: &Json,
    settings: &Json,
) -> Outcome {
    let outcome = linter_cmd::lint_case(entry, code, path, options, language_options, settings);
    Outcome {
        has_parse_errors: (outcome.messages.iter()).any(|it| it.is_fatal && it.message.starts_with(b"Parsing error")),
        messages: outcome.messages.iter().map(|it| reported(entry, code, it)).collect(),
        output: outcome.output,
    }
}

/// What is compared of a message about `code` in a test of the rule `entry`.
pub(crate) fn reported(entry: &'static RuleEntry, code: &[u8], message: &bun_lint::linter::LintMessage) -> Reported {
    let apply = |fix: &bun_lint::fix::Fix| {
        bun_lint::fix::apply_fixes(code, &mut vec![fix]).unwrap_or_else(|| code.to_vec())
    };
    Reported {
        rule_id: match &message.rule_id {
            Some(id) if *id == bun_lint::linter::RuleId::Known(entry.meta) => None,
            Some(id) => Some(text(&id.to_vec())),
            None => Some(String::new()),
        },
        message_id: message.message_id.unwrap_or_default().to_owned(),
        message: text(&message.message),
        line: message.line,
        column: message.column,
        end: message.end,
        suggestions: (message.suggestions.iter())
            .map(|s| (s.message_id.to_owned(), text(&apply(&s.fix))))
            .collect(),
    }
}

fn str_of<'j>(json: &'j Json, key: &str) -> Option<&'j str> {
    std::str::from_utf8(json.get(key.as_bytes())?.as_str()?).ok()
}

fn number_of(json: &Json, key: &str) -> Option<u32> {
    match json.get(key.as_bytes())? {
        Json::Number(n) => Some(*n as u32),
        _ => None,
    }
}

fn expected_messages(case: &Json) -> Vec<Reported> {
    let messages = case.get(b"messages").and_then(Json::as_array).unwrap_or_default();
    let reported = messages.iter().map(|it| Reported {
        rule_id: it.get(b"ruleId").map(|id| id.as_str().map(text).unwrap_or_default()),
        message_id: str_of(it, "messageId").unwrap_or_default().to_owned(),
        message: str_of(it, "message").unwrap_or_default().to_owned(),
        line: number_of(it, "line").unwrap_or(0),
        column: number_of(it, "column").unwrap_or(0),
        end: number_of(it, "endLine").zip(number_of(it, "endColumn")),
        suggestions: (it.get(b"suggestions").and_then(Json::as_array).unwrap_or_default().iter())
            .map(|s| {
                (
                    str_of(s, "messageId").unwrap_or_default().to_owned(),
                    str_of(s, "output").unwrap_or_default().to_owned(),
                )
            })
            .collect(),
    });
    reported.collect()
}

#[derive(Default)]
struct Tally {
    passed: usize,
    failed: usize,
    skipped: usize,
}

/// Runs the cases of one fixture file. Returns the tally and a description of each failure.
fn run_fixture(fixture: &Json, entry: &'static RuleEntry) -> (Tally, String) {
    let (mut tally, mut failures) = (Tally::default(), String::new());
    let cases = fixture.get(b"cases").and_then(Json::as_array).unwrap_or_default();
    for (index, case) in cases.iter().enumerate() {
        let is_skipped = !matches!(case.get(b"skip"), None | Some(Json::Null));
        let is_type_aware = case.get(b"typeAware").and_then(Json::as_bool) == Some(true);
        if is_skipped || is_type_aware {
            tally.skipped += 1;
            continue;
        }
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = str_of(case, "filename").unwrap_or("file.js");
        let options = case.get(b"options").and_then(Json::as_array).unwrap_or_default();
        let language_options = case.get(b"languageOptions").unwrap_or(&Json::Null);
        let settings = case.get(b"settings").unwrap_or(&Json::Null);
        let outcome = std::panic::catch_unwind(|| lint(entry, path, code, options, language_options, settings));
        // The order of what starts at the same place depends on the order in which ESLint visits the nodes.
        let in_order = |mut messages: Vec<Reported>| {
            messages.sort_by(|a, b| {
                (a.line, a.column, a.end, &a.message_id, &a.message).cmp(&(b.line, b.column, b.end, &b.message_id, &b.message))
            });
            messages
        };
        let outcome = outcome.map(|mut outcome| {
            outcome.messages = in_order(std::mem::take(&mut outcome.messages));
            outcome
        });
        let expected = in_order(expected_messages(case));
        let expected_output = case.get(b"output").and_then(Json::as_str);
        let problem = match &outcome {
            Err(_) => Some("panicked".to_owned()),
            Ok(outcome) if outcome.has_parse_errors => Some("the parser rejects the code".to_owned()),
            Ok(outcome) if outcome.messages != expected => Some(format!(
                "messages differ\n  expected: {expected:#?}\n  actual: {:#?}",
                outcome.messages
            )),
            Ok(outcome) if outcome.output.as_deref() != expected_output => Some(format!(
                "output differs\n  expected: {:?}\n  actual: {:?}",
                expected_output.map(text),
                outcome.output.as_deref().map(text)
            )),
            Ok(_) => None,
        };
        match problem {
            None => tally.passed += 1,
            Some(problem) => {
                tally.failed += 1;
                let mut written = Vec::new();
                Json::Array(options.to_vec()).stringify(&mut written);
                let _ = writeln!(
                    failures,
                    "──── case {index} ({}) {path}\noptions: {}\ncode:\n{}\n{problem}\n",
                    if expected.is_empty() { "valid" } else { "invalid" },
                    text(&written),
                    text(code),
                );
            }
        }
    }
    (tally, failures)
}

fn conformance(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let root = args.iter().find(|a| !a.starts_with("--")).expect("the fixtures directory");
    let (only_plugin, only_rule, report) = (flag("--plugin="), flag("--rule="), flag("--report="));
    let is_verbose = args.iter().any(|a| a == "--verbose");
    std::panic::set_hook(Box::new(|_| {}));
    let mut total = Tally::default();
    let (mut implemented, mut perfect, mut missing) = (0, 0, Vec::new());
    for (directory, plugin) in [("eslint", Plugin::Eslint), ("typescript-eslint", Plugin::TypeScript)] {
        if only_plugin.is_some_and(|only| only != directory) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(format!("{root}/{directory}")) else {
            continue;
        };
        let mut paths: Vec<_> = entries.flatten().map(|it| it.path()).collect();
        paths.sort();
        for path in paths {
            let name = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
            if only_rule.is_some_and(|only| only != name) {
                continue;
            }
            let Some(entry) = find_rule(plugin, &name) else {
                missing.push(format!("{directory}/{name}"));
                continue;
            };
            let Some(fixture) = std::fs::read(&path).ok().and_then(|it| bun_lint::json::parse(&it)) else {
                println!("{directory}/{name}: the fixture cannot be read");
                continue;
            };
            let (tally, failures) = run_fixture(&fixture, entry);
            implemented += 1;
            perfect += usize::from(tally.failed == 0);
            println!(
                "{} {directory}/{name}: {} passed, {} failed, {} skipped",
                if tally.failed == 0 { "ok  " } else { "FAIL" },
                tally.passed,
                tally.failed,
                tally.skipped
            );
            if is_verbose {
                print!("{failures}");
            }
            if let Some(report) = report {
                let _ = std::fs::create_dir_all(format!("{report}/{directory}"));
                let _ = std::fs::write(format!("{report}/{directory}/{name}.txt"), failures);
            }
            total.passed += tally.passed;
            total.failed += tally.failed;
            total.skipped += tally.skipped;
        }
    }
    println!(
        "\n{implemented} rules, {perfect} without failures, {} not implemented\n{} cases passed, {} failed, {} skipped",
        missing.len(),
        total.passed,
        total.failed,
        total.skipped
    );
}

fn run_one(args: &[String]) {
    let [rule, path, rest @ ..] = args else {
        return println!("usage: bun-lint run <rule> <file> [options as JSON]");
    };
    let (plugin, name) = match rule.strip_prefix("@typescript-eslint/") {
        Some(name) => (Plugin::TypeScript, name),
        None => (Plugin::Eslint, rule.as_str()),
    };
    let Some(entry) = find_rule(plugin, name) else {
        return println!("no such rule: {rule}");
    };
    let code = std::fs::read(path).expect("the file");
    let options = rest.first().and_then(|it| bun_lint::json::parse(it.as_bytes()));
    let options = options.as_ref().and_then(Json::as_array).unwrap_or_default();
    let outcome = lint(entry, path, &code, options, &Json::Null, &Json::Null);
    if outcome.has_parse_errors {
        println!("the parser rejects the code");
    }
    for it in &outcome.messages {
        println!("{path}:{}:{}: {} ({})", it.line, it.column, it.message, it.message_id);
    }
    if let Some(output) = outcome.output {
        println!("──── after fixes\n{}", text(&output));
    }
}

/// Every `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts` file in `path`, which can be one itself.
fn collect(path: &std::path::Path, into: &mut Vec<std::path::PathBuf>) {
    const EXTENSIONS: [&str; 8] = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
    if path.is_dir() {
        let is_skipped = matches!(path.file_name().and_then(|it| it.to_str()), Some("node_modules" | ".git"));
        if let (false, Ok(entries)) = (is_skipped, std::fs::read_dir(path)) {
            let mut paths: Vec<_> = entries.flatten().map(|it| it.path()).collect();
            paths.sort();
            paths.iter().for_each(|it| collect(it, into));
        }
    } else if path.extension().and_then(|it| it.to_str()).is_some_and(|it| EXTENSIONS.contains(&it)) {
        into.push(path.to_owned());
    }
}

/// `bun-lint bench <paths..> [--threads=n] [--repeat=n] [--rules=a,b]`: how long parsing and binding take, and how long all the
/// rules that need no types take, with their default options.
fn bench(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let threads: usize = flag("--threads=").and_then(|n| n.parse().ok()).unwrap_or(1);
    let repeat: usize = flag("--repeat=").and_then(|n| n.parse().ok()).unwrap_or(1);
    let only: Option<Vec<&str>> = flag("--rules=").map(|it| it.split(',').collect());
    let mut paths = Vec::new();
    for arg in args.iter().filter(|a| !a.starts_with("--")) {
        collect(std::path::Path::new(arg), &mut paths);
    }
    let files: Vec<(String, Vec<u8>)> = (paths.iter())
        .filter_map(|path| Some((path.to_string_lossy().into_owned(), std::fs::read(path).ok()?)))
        .collect();
    let bytes: usize = files.iter().map(|it| it.1.len()).sum();
    let all = bun_lint_eslint::RULES.iter().chain(bun_lint_typescript::RULES);
    let built: Vec<_> = all
        .filter(|it| !it.meta.requires_types && only.as_ref().is_none_or(|only| only.contains(&it.meta.name)))
        .map(|it| (it.build)(&Options::default()))
        .collect();
    let rules: Vec<_> = (built.iter())
        .map(|rule| Enabled {
            rule: &**rule,
            severity: Severity::Error,
        })
        .collect();
    use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
    let (parsing, linting, found) = (AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0));
    // With `--per-rule`: what each rule costs on its own, once what the rules share (tokens, scopes, ..) is computed.
    let is_per_rule = args.iter().any(|a| a == "--per-rule");
    let alone: Vec<AtomicU64> = rules.iter().map(|_| AtomicU64::new(0)).collect();
    let language = LanguageOptions::default();
    let started = std::time::Instant::now();
    for _ in 0..repeat {
        bun_sema_standalone::for_each_parallel(threads, files.len(), |i| {
            let (path, code) = &files[i];
            let before = std::time::Instant::now();
            with_file(path, code, &language, |file| {
                parsing.fetch_add(before.elapsed().as_nanos() as u64, Relaxed);
                if file.has_parse_errors() {
                    return;
                }
                let before = std::time::Instant::now();
                let diagnostics = bun_lint::runner::run(file, &rules, false);
                linting.fetch_add(before.elapsed().as_nanos() as u64, Relaxed);
                found.fetch_add(diagnostics.len() as u64, Relaxed);
                if is_per_rule {
                    for (rule, nanos) in rules.iter().zip(&alone) {
                        let before = std::time::Instant::now();
                        bun_lint::runner::run(file, std::slice::from_ref(rule), false);
                        nanos.fetch_add(before.elapsed().as_nanos() as u64, Relaxed);
                    }
                }
            });
        });
    }
    if is_per_rule {
        let mut table: Vec<(f64, &str)> = (alone.iter().zip(&rules))
            .map(|(nanos, rule)| (nanos.load(Relaxed) as f64 / 1e6 / repeat as f64, rule.rule.meta().name))
            .collect();
        table.sort_by(|a, b| b.0.total_cmp(&a.0));
        println!("sum of the rules alone: {:.1} ms", table.iter().map(|it| it.0).sum::<f64>());
        for (ms, name) in table {
            println!("{ms:9.1} ms  {name}");
        }
    }
    let per_pass = |nanos: &AtomicU64| nanos.load(Relaxed) as f64 / 1e6 / repeat as f64;
    println!(
        "{} files, {:.1} MB, {} rules, {} threads: {:.1} ms wall a pass; cpu: parse+bind {:.1} ms, rules {:.1} ms; {} reports",
        files.len(),
        bytes as f64 / 1e6,
        rules.len(),
        threads,
        started.elapsed().as_secs_f64() * 1e3 / repeat as f64,
        per_pass(&parsing),
        per_pass(&linting),
        found.load(Relaxed) / repeat as u64,
    );
}

fn main() {
    bun_sema_standalone::native::set_stack_size(7 << 20);
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("conformance") => conformance(&args[1..]),
        Some("run") => run_one(&args[1..]),
        Some("bench") => bench(&args[1..]),
        Some("ast") => ast_cmd::run(&args[1..]),
        Some("tokens") => tokens_cmd::run(&args[1..]),
        Some("semantic") => semantic_cmd::run(&args[1..]),
        Some("code-path") => code_path_cmd::run(&args[1..]),
        Some("regex") => regex_cmd::run(&args[1..]),
        Some("types") => types_cmd::run(&args[1..]),
        Some("linter") => linter_cmd::run(&args[1..]),
        Some("format") => format_cmd::run(&args[1..]),
        Some("cli") => driver_cmd::run(&args[1..]),
        Some("selector") => selector_cmd::run(&args[1..]),
        Some("utils-eslint") => utils_eslint_cmd::run(&args[1..]),
        Some("utils-tsscope") => utils_tsscope_cmd::run(&args[1..]),
        Some("utils-ts") => utils_ts_cmd::run(&args[1..]),
        Some("utils-core") => utils_core_cmd::run(&args[1..]),
        Some("utils-small") => utils_small_cmd::run(&args[1..]),
        _ => println!("usage: bun-lint conformance <fixtures> | bun-lint run <rule> <file> [options]"),
    }
}
