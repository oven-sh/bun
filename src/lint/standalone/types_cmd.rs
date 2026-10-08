//! `bun-lint types ..`: the linter with types.
//!
//! - `bun-lint types dump <file> [--project=tsconfig.json] [--symbols]`: the type (and the symbol)
//!   at every expression, pattern and type of a file, as JSON lines, to compare with TypeScript's.
//! - `bun-lint types dump-fixtures <fixtures> [--rule=r] [--out=file]`: the same for the code of
//!   every type-aware test case.
//! - `bun-lint types run <rule> <file> [options as JSON] [--project=tsconfig.json]`: what one rule
//!   reports for one file of a project.
//! - `bun-lint types conformance <fixtures> [--rule=r] [--report=dir] [--verbose] [--jobs=n]`: runs
//!   the type-aware test cases of typescript-eslint.
//!
//! - `bun-lint types typescript-tests ..`: TypeScript's own tests, as `bun check
//!   --run-typescript-tests` runs them (test/cli/check/typescript-go/conformance.ts). The types and
//!   the symbols that they compare are those that the linter is given.
//!
//! `BUN_SEMA_TS_LIB`: the directory of TypeScript's `lib.*.d.ts`. `BUN_LINT_TYPE_ROOTS`: the
//! `node_modules/@types` that the fixture project finds `node` and `react` in.

use crate::{Outcome, Reported, Tally, expected_messages, str_of, text};
use bun_lint::ast::{File, Node};
use bun_lint::context::Severity;
use bun_lint::language::LanguageOptions;
use bun_lint::linter::{LintOptions, Linter, Registry, ResolvedConfig, RuleId};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_sema::program::FileId;
use std::fmt::Write as _;
use std::sync::Mutex;

/// A program to check, and the files of it to lint.
pub(crate) struct Project<'a> {
    /// The working directory.
    pub(crate) cwd: &'a str,
    /// The `tsconfig.json`.
    pub(crate) config: Option<&'a str>,
    /// The files to lint, as absolute paths.
    pub(crate) files: &'a [String],
    /// Files that are not on the disk, or have another text there: absolute paths and texts.
    pub(crate) overlay: Vec<(String, Vec<u8>)>,
    pub(crate) threads: usize,
}

fn linter() -> &'static Linter {
    static LINTER: std::sync::OnceLock<Linter> = std::sync::OnceLock::new();
    LINTER.get_or_init(|| Linter::new(Registry::new(&[bun_lint_eslint::RULES, bun_lint_typescript::RULES])))
}

fn find_rule(name: &str) -> Option<&'static RuleEntry> {
    linter().registry().get(Plugin::TypeScript, name.as_bytes())
}

/// The configuration that the `RuleTester` of typescript-eslint lints a case with: only that rule,
/// as an error.
fn config_of(entry: &'static RuleEntry, options: &[Json], language_options: &Json, settings: &Json) -> ResolvedConfig {
    let mut rule = vec![Json::Number(2.0)];
    rule.extend_from_slice(options);
    let config = Json::Object(vec![
        (b"languageOptions".to_vec(), language_options.clone()),
        (b"settings".to_vec(), settings.clone()),
        (b"rules".to_vec(), Json::Object(vec![(RuleId::Known(entry.meta).to_vec(), Json::Array(rule))])),
    ]);
    let mut config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    config.linter.report_unused_disable_directives = Severity::Warn;
    config
}

/// What the rule `entry`, which is the one that `config` enables, reports for `file`.
fn lint_file<'a>(entry: &'static RuleEntry, file: &'a File<'a>, code: &[u8], config: &ResolvedConfig) -> Outcome {
    let messages = linter().lint(file, config, &LintOptions::default()).messages;
    let apply = |fix: &bun_lint::fix::Fix| bun_lint::fix::apply_fixes(code, &mut vec![fix]).unwrap_or_else(|| code.to_vec());
    let mut fixes: Vec<_> = messages.iter().filter_map(|it| it.fix.as_ref()).collect();
    Outcome {
        output: bun_lint::fix::apply_fixes(code, &mut fixes),
        has_parse_errors: messages.iter().any(|it| it.is_fatal && it.message.starts_with(b"Parsing error")),
        messages: (messages.iter())
            .map(|it| Reported {
                rule_id: match &it.rule_id {
                    Some(id) if *id == RuleId::Known(entry.meta) => None,
                    Some(id) => Some(text(&id.to_vec())),
                    None => Some(String::new()),
                },
                message_id: it.message_id.unwrap_or_default().to_owned(),
                message: text(&it.message),
                line: it.line,
                column: it.column,
                end: it.end,
                suggestions: it.suggestions.iter().map(|s| (s.message_id.to_owned(), text(&apply(&s.fix)))).collect(),
            })
            .collect(),
    }
}

fn in_order(mut messages: Vec<Reported>) -> Vec<Reported> {
    messages.sort_by(|a, b| {
        (a.line, a.column, a.end, &a.message_id, &a.message).cmp(&(b.line, b.column, b.end, &b.message_id, &b.message))
    });
    messages
}

fn lib_directory() -> String {
    std::env::var("BUN_SEMA_TS_LIB").expect("BUN_SEMA_TS_LIB: the directory of the lib.*.d.ts files")
}

/// Checks `project` and calls `then` with each of `Project::files` right after it is checked.
/// Returns what `then` returned for each, in no particular order, with the path.
///
/// This is what a `bun_lint_driver` has to do:
/// - `stops_like_tsc: false`, or a syntax error anywhere means that nothing is linted.
/// - The hook also runs for the files that the linted ones import, for `node_modules` and for
///   declaration files: it picks.
/// - A task of the checker can be run again, so a result replaces the one before.
pub(crate) fn lint_project<R: Send>(
    project: Project,
    language: &LanguageOptions,
    then: &(dyn for<'a> Fn(&'a File<'a>) -> R + Sync),
) -> Vec<(Vec<u8>, R)> {
    let lib_directory = lib_directory();
    let mut args: Vec<Vec<u8>> = vec![b"--skipLibCheck".to_vec()];
    if let Ok(type_roots) = std::env::var("BUN_LINT_TYPE_ROOTS") {
        args.extend([b"--typeRoots".to_vec(), type_roots.into_bytes()]);
    }
    if let Some(config) = project.config {
        args.extend([b"--project".to_vec(), config.as_bytes().to_vec()]);
    }
    args.extend(project.files.iter().map(|it| it.as_bytes().to_vec()));
    let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
    let command_line = bun_sema_driver::parse_command_line(&args, project.cwd.as_bytes());

    let results: Mutex<Vec<(FileId, Vec<u8>, R)>> = Mutex::new(Vec::new());
    let wanted: Vec<Vec<u8>> = (project.files.iter()).map(|it| bun_sema_driver::host::from_native(it.as_bytes())).collect();
    let after_file = |checker: &mut bun_sema::check::Checker<'_, '_>, file: FileId| {
        let path = checker.p.files.module(file).file_name();
        if !wanted.iter().any(|it| it == path) {
            return;
        }
        let Some(result) = bun_lint::types::with_file(checker, file, language, |file| then(file)) else {
            return;
        };
        let mut results = results.lock().unwrap_or_else(|it| it.into_inner());
        results.retain(|it| it.0 != file);
        results.push((file, path.to_vec(), result));
    };
    let request = bun_sema_driver::Request {
        compiler_options: &command_line.compiler_options,
        cwd: project.cwd.as_bytes(),
        project: command_line.project.as_deref(),
        build: false,
        errors: &[],
        paths: &command_line.paths,
        are_entry_points: false,
        threads: project.threads,
        libs: bun_sema_driver::Libs::Directory(lib_directory.as_bytes()),
        progress: None,
        only: None,
        order: 1,
        digests: false,
        task_clock: None,
        plan_options: bun_sema_driver::PlanOptions {
            after_file_is_for_checked_files: true,
            ..Default::default()
        },
        retains_everything: false,
        script_kinds: &[],
        script_kinds_by_extension: &[],
        conditions: &[],
        stops_like_tsc: false,
        uses_typescript_wording: true,
        loaded: None,
        checked: None,
        declaration_file_emitted: None,
        after_file: Some(&after_file),
    };
    let mut provided = bun_sema_driver::host::Provided::default();
    for (path, text) in project.overlay {
        provided.already_read.insert(bun_sema_driver::host::from_native(path.as_bytes()), text);
    }
    bun_sema_driver::check_provided_then(&request, provided, |_| ());
    let results = results.into_inner().unwrap_or_else(|it| it.into_inner());
    results.into_iter().map(|it| (it.1, it.2)).collect()
}

fn absolute(path: &str) -> String {
    let path = std::path::Path::new(path);
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join(path));
    path.to_string_lossy().into_owned()
}

fn json_string(bytes: &[u8]) -> String {
    let mut out = Vec::new();
    Json::String(bytes.to_vec()).stringify(&mut out);
    text(&out)
}

/// One line for each expression, pattern and type of `file`: `[start, end, kind, type, symbol]`,
/// with offsets in bytes.
fn dump<'a>(file: &'a File<'a>, with_symbols: bool) -> String {
    let mut out = String::new();
    let mut lines: Vec<(u32, u32, &'static str, String)> = Vec::new();
    let mut work = vec![Node::File(file)];
    while let Some(node) = work.pop() {
        node.for_each_child(|child| work.push(child));
        let kind = match node {
            Node::Expr(_) => "expr",
            Node::Pat(_) => "pat",
            Node::Type(_) => "type",
            _ => continue,
        };
        let span = node.span();
        let mut line = json_string(&node.ty().to_text());
        if with_symbols {
            let symbol = node.ts_symbol().map(|it| json_string(&it.to_text()));
            let _ = write!(line, ", {}", symbol.as_deref().unwrap_or("null"));
        }
        lines.push((span.start, span.end, kind, line));
    }
    lines.sort();
    for (start, end, kind, line) in lines {
        let _ = writeln!(out, "[{start}, {end}, \"{kind}\", {line}]");
    }
    out
}

fn dump_file(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(path) = args.iter().find(|a| !a.starts_with("--")) else {
        return println!("usage: bun-lint types dump <file> [--project=tsconfig.json] [--symbols]");
    };
    let with_symbols = args.iter().any(|a| a == "--symbols");
    let files = [absolute(path)];
    let config = flag("--project=").map(absolute);
    let cwd = absolute(".");
    let project = Project {
        cwd: &cwd,
        config: config.as_deref(),
        files: &files,
        overlay: Vec::new(),
        threads: 1,
    };
    for (_, lines) in lint_project(project, &LanguageOptions::default(), &|file| dump(file, with_symbols)) {
        print!("{lines}");
    }
}

/// A type-aware test case as a project: the code is a file of the fixture project.
fn project_of_case<'a>(root: &'a str, config: &'a str, files: &'a [String], code: &[u8]) -> Project<'a> {
    Project {
        cwd: root,
        config: Some(config),
        files,
        overlay: vec![(files[0].clone(), code.to_vec())],
        threads: 1,
    }
}

struct Case<'j> {
    rule: usize,
    index: usize,
    json: &'j Json,
}

fn is_type_aware(case: &Json) -> bool {
    matches!(case.get(b"skip"), None | Some(Json::Null)) && case.get(b"typeAware").and_then(Json::as_bool) == Some(true)
}

/// The fixtures of typescript-eslint in `root`, by the name of the rule.
fn read_fixtures(root: &str, only_rule: Option<&str>) -> Vec<(String, Json)> {
    let Ok(entries) = std::fs::read_dir(format!("{root}/typescript-eslint")) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = entries.flatten().map(|it| it.path()).collect();
    paths.sort();
    let mut fixtures = Vec::new();
    for path in paths {
        let name = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        if only_rule.is_some_and(|only| only != name) {
            continue;
        }
        if let Some(fixture) = std::fs::read(&path).ok().and_then(|it| bun_lint::json::parse(&it)) {
            fixtures.push((name, fixture));
        }
    }
    fixtures
}

fn type_aware_cases(fixtures: &[(String, Json)]) -> Vec<Case<'_>> {
    let mut cases = Vec::new();
    for (rule, (_, fixture)) in fixtures.iter().enumerate() {
        let all = fixture.get(b"cases").and_then(Json::as_array).unwrap_or_default();
        let type_aware = all.iter().enumerate().filter(|it| is_type_aware(it.1));
        cases.extend(type_aware.map(|(index, json)| Case { rule, index, json }));
    }
    cases
}

/// Calls `then` with the file that the code of `case` is in the fixture project.
fn with_case<R: Send>(
    project_root: &str,
    case: &Json,
    language: &LanguageOptions,
    then: &(dyn for<'a> Fn(&'a File<'a>) -> R + Sync),
) -> Option<R> {
    let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
    let files = [format!("{project_root}/{}", str_of(case, "filename").unwrap_or("file.ts"))];
    let config = format!("{project_root}/{}", str_of(case, "tsconfig").unwrap_or("tsconfig.json"));
    let project = project_of_case(project_root, &config, &files, code);
    lint_project(project, language, then).pop().map(|it| it.1)
}

fn jobs(args: &[String]) -> usize {
    let jobs = args.iter().find_map(|a| a.strip_prefix("--jobs=")).and_then(|n| n.parse().ok());
    jobs.unwrap_or_else(|| std::thread::available_parallelism().map_or(8, |n| n.get()))
}

fn dump_fixtures(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(root) = args.iter().find(|a| !a.starts_with("--")) else {
        return println!("usage: bun-lint types dump-fixtures <fixtures> [--rule=r] [--out=file]");
    };
    let root = absolute(root);
    let project_root = format!("{root}/typescript-eslint-project");
    let fixtures = read_fixtures(&root, flag("--rule="));
    let cases = type_aware_cases(&fixtures);
    let dumps: Vec<Mutex<String>> = cases.iter().map(|_| Mutex::new(String::new())).collect();
    std::panic::set_hook(Box::new(|_| {}));
    bun_sema_standalone::for_each_parallel(jobs(args), cases.len(), |i| {
        let dumped = std::panic::catch_unwind(|| with_case(&project_root, cases[i].json, &LanguageOptions::default(), &|file| dump(file, false)));
        let dumped = match dumped {
            Ok(dumped) => dumped.unwrap_or_else(|| "\"not checked\"\n".to_owned()),
            Err(_) => "\"panicked\"\n".to_owned(),
        };
        *dumps[i].lock().unwrap_or_else(|it| it.into_inner()) = dumped;
    });
    let mut out = String::new();
    for (case, dumped) in cases.iter().zip(&dumps) {
        let _ = writeln!(out, "# {} {}", fixtures[case.rule].0, case.index);
        out.push_str(&dumped.lock().unwrap_or_else(|it| it.into_inner()));
    }
    match flag("--out=") {
        Some(path) => std::fs::write(path, out).expect("the output file"),
        None => print!("{out}"),
    }
}

/// What is wrong with what the rule reports for `case`.
fn problem_of_case(entry: &'static RuleEntry, project_root: &str, case: &Json) -> Option<String> {
    let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
    let options = case.get(b"options").and_then(Json::as_array).unwrap_or_default();
    let language_options = case.get(b"languageOptions").unwrap_or(&Json::Null);
    let config = config_of(entry, options, language_options, case.get(b"settings").unwrap_or(&Json::Null));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        with_case(project_root, case, &config.language, &|file| lint_file(entry, file, code, &config))
    }));
    let outcome = outcome.map(|outcome| {
        outcome.map(|mut outcome| {
            outcome.messages = in_order(std::mem::take(&mut outcome.messages));
            outcome
        })
    });
    let expected = in_order(expected_messages(case));
    let expected_output = case.get(b"output").and_then(Json::as_str);
    match &outcome {
        Err(_) => Some("panicked".to_owned()),
        Ok(None) => Some("the file is not part of the program".to_owned()),
        Ok(Some(Outcome { has_parse_errors: true, .. })) => Some("the parser rejects the code".to_owned()),
        Ok(Some(outcome)) if outcome.messages != expected => {
            Some(format!("messages differ\n  expected: {expected:#?}\n  actual: {:#?}", outcome.messages))
        }
        Ok(Some(outcome)) if outcome.output.as_deref() != expected_output => Some(format!(
            "output differs\n  expected: {:?}\n  actual: {:?}",
            expected_output.map(text),
            outcome.output.as_deref().map(text)
        )),
        Ok(Some(_)) => None,
    }
}

fn conformance(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(root) = args.iter().find(|a| !a.starts_with("--")) else {
        return println!("usage: bun-lint types conformance <fixtures> [--rule=r] [--report=dir] [--verbose] [--jobs=n]");
    };
    let is_verbose = args.iter().any(|a| a == "--verbose");
    let root = absolute(root);
    let project_root = format!("{root}/typescript-eslint-project");
    let fixtures = read_fixtures(&root, flag("--rule="));
    let entries: Vec<Option<&'static RuleEntry>> = fixtures.iter().map(|it| find_rule(&it.0)).collect();
    let mut cases = type_aware_cases(&fixtures);
    cases.retain(|case| entries[case.rule].is_some());
    let problems: Vec<Mutex<Option<String>>> = cases.iter().map(|_| Mutex::new(None)).collect();
    std::panic::set_hook(Box::new(|_| {}));
    let started = std::time::Instant::now();
    bun_sema_standalone::for_each_parallel(jobs(args), cases.len(), |i| {
        if let Some(entry) = entries[cases[i].rule] {
            *problems[i].lock().unwrap_or_else(|it| it.into_inner()) = problem_of_case(entry, &project_root, cases[i].json);
        }
    });
    let mut tallies: Vec<(Tally, String)> = fixtures.iter().map(|_| Default::default()).collect();
    for (case, problem) in cases.iter().zip(&problems) {
        let (tally, failures) = &mut tallies[case.rule];
        match &*problem.lock().unwrap_or_else(|it| it.into_inner()) {
            None => tally.passed += 1,
            Some(problem) => {
                tally.failed += 1;
                let mut options = Vec::new();
                case.json.get(b"options").unwrap_or(&Json::Null).stringify(&mut options);
                let _ = writeln!(
                    failures,
                    "──── case {} ({}) {} {}\noptions: {}\ncode:\n{}\n{problem}\n",
                    case.index,
                    if expected_messages(case.json).is_empty() { "valid" } else { "invalid" },
                    str_of(case.json, "filename").unwrap_or_default(),
                    str_of(case.json, "tsconfig").unwrap_or_default(),
                    text(&options),
                    text(case.json.get(b"code").and_then(Json::as_str).unwrap_or_default()),
                );
            }
        }
    }
    let (mut passed, mut failed, mut implemented, mut perfect) = (0, 0, 0, 0);
    for ((name, _), (tally, failures)) in fixtures.iter().zip(&tallies) {
        if tally.passed + tally.failed == 0 {
            continue;
        }
        implemented += 1;
        perfect += usize::from(tally.failed == 0);
        let verdict = if tally.failed == 0 { "ok  " } else { "FAIL" };
        println!("{verdict} typescript-eslint/{name}: {} passed, {} failed", tally.passed, tally.failed);
        if is_verbose {
            print!("{failures}");
        }
        if let Some(report) = flag("--report=") {
            let _ = std::fs::create_dir_all(format!("{report}/typescript-eslint"));
            let _ = std::fs::write(format!("{report}/typescript-eslint/{name}.types.txt"), failures);
        }
        passed += tally.passed;
        failed += tally.failed;
    }
    println!(
        "\n{implemented} rules with type-aware cases, {perfect} without failures\n{passed} cases passed, {failed} failed, in {:.1} s",
        started.elapsed().as_secs_f64()
    );
}

fn run_one(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let plain: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let [rule, path, rest @ ..] = &plain[..] else {
        return println!("usage: bun-lint types run <rule> <file> [options as JSON] [--project=tsconfig.json]");
    };
    let name = rule.strip_prefix("@typescript-eslint/").unwrap_or(rule);
    let Some(entry) = find_rule(name) else {
        return println!("no such rule: {rule}");
    };
    let code = std::fs::read(path).expect("the file");
    let options = rest.first().and_then(|it| bun_lint::json::parse(it.as_bytes()));
    let options = options.as_ref().and_then(Json::as_array).unwrap_or_default();
    let (files, cwd, config) = ([absolute(path)], absolute("."), flag("--project=").map(absolute));
    let project = Project {
        cwd: &cwd,
        config: config.as_deref(),
        files: &files,
        overlay: Vec::new(),
        threads: 1,
    };
    let config = config_of(entry, options, &Json::Null, &Json::Null);
    let outcomes = lint_project(project, &config.language, &|file| lint_file(entry, file, &code, &config));
    for (_, outcome) in outcomes {
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
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("dump") => dump_file(&args[1..]),
        Some("dump-fixtures") => dump_fixtures(&args[1..]),
        Some("conformance") => conformance(&args[1..]),
        Some("run") => run_one(&args[1..]),
        Some("typescript-tests") => {
            let rest: Vec<&[u8]> = args[1..].iter().map(|arg| arg.as_bytes()).collect();
            if !bun_sema_standalone::baselines::run_from_command_line(&rest) {
                std::process::exit(1);
            }
        }
        _ => println!("usage: bun-lint types dump | dump-fixtures | conformance | run"),
    }
}
