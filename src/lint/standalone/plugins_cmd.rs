//! Runs the test cases of the rules that are about several files. A case is a file of `fixtures/import-project`, with other text
//! than is on the disk.

use crate::linter_cmd::{CaseOutcome, linter};
use bun_lint::context::Severity;
use bun_lint::linter::{LintOptions, ResolvedConfig, RuleId};
use bun_lint::options::Json;
use bun_lint::runner::RuleEntry;
use bun_lint_graph::{Graph, Store, with_file};
use std::sync::OnceLock;

static PROJECT: OnceLock<String> = OnceLock::new();

/// `fixtures`: the directory of the fixtures.
pub(crate) fn set_fixtures(fixtures: &str) {
    let project = std::fs::canonicalize(format!("{fixtures}/import-project"));
    let _ = PROJECT.set(project.map_or_else(|_| fixtures.to_owned(), |it| it.to_string_lossy().into_owned()));
}

/// The same as `linter_cmd::lint_case`.
pub(crate) fn lint_case(
    entry: &'static RuleEntry,
    code: &[u8],
    filename: &str,
    options: &[Json],
    language_options: &Json,
    settings: &Json,
) -> CaseOutcome {
    let mut rule = vec![Json::Number(2.0)];
    rule.extend_from_slice(options);
    let config = Json::Object(vec![
        (b"languageOptions".to_vec(), language_options.clone()),
        (b"settings".to_vec(), settings.clone()),
        (b"rules".to_vec(), Json::Object(vec![(RuleId::Known(entry.meta).to_vec(), Json::Array(rule))])),
    ]);
    let mut config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    config.linter.report_unused_disable_directives = Severity::Off;
    let project = PROJECT.get().map_or(".", |it| &it[..]);
    let path = if filename.starts_with(['<', '/']) { filename.to_owned() } else { format!("{project}/{filename}") };
    let store = Store::new(project.as_bytes());
    let graph = Graph::new(&store);
    let lint = || {
        let linted = with_file(path.as_bytes(), code, &config.language, Some(&graph), |file| {
            linter().lint(file, &config, &LintOptions::default()).messages
        });
        linted.unwrap_or_default()
    };
    lint();
    graph.complete(&|count, work| (0..count).for_each(work));
    let messages = lint();
    let mut fixes: Vec<_> = messages.iter().filter_map(|it| it.fix.as_ref()).collect();
    let output = bun_lint::fix::apply_fixes(code, &mut fixes);
    CaseOutcome { messages, output }
}

/// `bun-lint plugins cycles <paths..> [--threads=n] [--json] [options as JSON]`: `import/no-cycle` alone on all the files in `paths`,
/// as the command line does it, with the time that each step takes.
fn cycles(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let threads: usize = flag("--threads=").and_then(|n| n.parse().ok()).unwrap_or(1);
    let options = args.iter().find(|it| it.starts_with('[')).and_then(|it| bun_lint::json::parse(it.as_bytes()));
    let mut rule = vec![Json::Number(1.0)];
    rule.extend_from_slice(options.as_ref().and_then(Json::as_array).unwrap_or_default());
    let config = Json::Object(vec![(b"rules".to_vec(), Json::Object(vec![(b"import/no-cycle".to_vec(), Json::Array(rule))]))]);
    let mut config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    // As with a configuration of oxlint.
    config.language.parser = bun_lint::language::Parser::TypeScript;
    config.language.experimental_decorators = true;
    config.language.refuses_what_parser_refuses = false;
    config.skips_unknown_rules = true;
    let mut paths = Vec::new();
    for arg in args.iter().filter(|a| !a.starts_with("--") && !a.starts_with('[')) {
        crate::collect(&std::fs::canonicalize(arg).expect("a path"), &mut paths);
    }
    let paths: Vec<String> = paths.iter().map(|it| it.to_string_lossy().into_owned()).collect();
    let started = std::time::Instant::now();
    let store = Store::new(paths.first().map_or(&b"/"[..], |it| it.as_bytes()));
    let graph = Graph::new(&store);
    let lint = |path: &str| {
        let text = std::fs::read(path).unwrap_or_default();
        let linted = with_file(path.as_bytes(), &text, &config.language, Some(&graph), |file| {
            linter().lint(file, &config, &LintOptions::default()).messages
        });
        linted.unwrap_or_default()
    };
    bun_sema_standalone::for_each_parallel(threads, paths.len(), |at| {
        lint(&paths[at]);
    });
    let collected = started.elapsed();
    let again = graph.complete(&|count, work| bun_sema_standalone::for_each_parallel(threads, count, work));
    let completed = started.elapsed();
    let found = std::sync::Mutex::new(Vec::new());
    bun_sema_standalone::for_each_parallel(threads, again.len(), |at| {
        let path = String::from_utf8_lossy(&again[at]).into_owned();
        let messages = lint(&path);
        found.lock().unwrap().extend(messages.into_iter().map(|it| (path.clone(), it)));
    });
    let mut found = found.into_inner().unwrap();
    found.sort_by(|a, b| (&a.0, a.1.line, a.1.column).cmp(&(&b.0, b.1.line, b.1.column)));
    if args.iter().any(|it| it == "--json") {
        for (path, message) in &found {
            println!("{path}:{}:{}: {}", message.line, message.column, String::from_utf8_lossy(&message.message));
        }
    }
    eprintln!(
        "{} files, {} threads: parsed and recorded in {:.1} ms, completed in {:.1} ms, {} files linted again in {:.1} ms; {} reports",
        paths.len(),
        threads,
        collected.as_secs_f64() * 1e3,
        (completed - collected).as_secs_f64() * 1e3,
        again.len(),
        (started.elapsed() - completed).as_secs_f64() * 1e3,
        found.len(),
    );
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("cycles") => cycles(&args[1..]),
        _ => println!("usage: bun-lint plugins cycles <paths..> [--threads=n] [--json] [options]"),
    }
}
