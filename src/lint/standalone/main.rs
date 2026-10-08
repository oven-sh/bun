//! `bun-lint`: the linter without the rest of Bun, for developing and testing rules.
//!
//! - `bun-lint conformance <fixtures> [--plugin=p] [--rule=r] [--report=dir] [--verbose]`: runs the
//!   test cases of ESLint and typescript-eslint (test/cli/lint/conformance/fixtures) and compares
//!   with what ESLint reports for them.
//! - `bun-lint run <rule> <file> [options as JSON]`: what one rule reports for one file.

use bun_lint::ast::File;
use bun_lint::context::{Diagnostic, Severity};
use bun_lint::options::{Json, Options};
use bun_lint::rule::Plugin;
use bun_lint::runner::{Enabled, RuleEntry};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, bind};
use bun_sema::session::Session;
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
    message_id: String,
    message: String,
    line: u32,
    column: u32,
    end: Option<(u32, u32)>,
    /// The code after each suggestion.
    suggestions: Vec<(String, String)>,
}

fn lint(entry: &RuleEntry, path: &str, code: &[u8], options: &[Json]) -> Outcome {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let mut hir = bun_js_parser::sema::summarize(arena, path.as_bytes(), None, code, &atoms, false, false).0;
    hir.text = code.to_vec().into();
    let bind_options = BindOptions {
        emit_standard_class_fields: true,
        before_es2020: false,
        before_es2017: false,
    };
    let bound = bind(&hir, bind_options, &atoms, arena);
    let file = File::new(path.as_bytes(), &hir, &bound, &atoms, None);
    if file.has_parse_errors() {
        return Outcome {
            messages: Vec::new(),
            output: None,
            has_parse_errors: true,
        };
    }
    let rule = (entry.build)(&Options::new(options));
    let rules = [Enabled {
        rule: &*rule,
        severity: Severity::Error,
    }];
    let diagnostics = bun_lint::runner::run(&file, &rules, true);
    let apply = |fix: &bun_lint::fix::Fix| {
        bun_lint::fix::apply_fixes(code, &mut vec![fix]).unwrap_or_else(|| code.to_vec())
    };
    let messages = diagnostics.iter().map(|it: &Diagnostic| {
        let (start, end) = (file.position(it.span.start), file.position(it.span.end));
        Reported {
            message_id: it.message_id.to_owned(),
            message: text(&it.message),
            line: start.line,
            column: start.column + 1,
            end: (!it.has_no_end).then_some((end.line, end.column + 1)),
            suggestions: (it.suggestions.iter())
                .map(|s| (s.message_id.to_owned(), text(&apply(&s.fix))))
                .collect(),
        }
    });
    let messages = messages.collect();
    let mut fixes: Vec<_> = diagnostics.iter().filter_map(|it| it.fix.as_ref()).collect();
    Outcome {
        messages,
        output: bun_lint::fix::apply_fixes(code, &mut fixes),
        has_parse_errors: false,
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
fn run_fixture(fixture: &Json, entry: &RuleEntry) -> (Tally, String) {
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
        let outcome = std::panic::catch_unwind(|| lint(entry, path, code, options));
        let expected = expected_messages(case);
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
    let outcome = lint(entry, path, &code, options);
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

fn main() {
    bun_sema_standalone::native::set_stack_size(7 << 20);
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("conformance") => conformance(&args[1..]),
        Some("run") => run_one(&args[1..]),
        _ => println!("usage: bun-lint conformance <fixtures> | bun-lint run <rule> <file> [options]"),
    }
}
