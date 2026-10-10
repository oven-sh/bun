//! `bun-lint plugins ..`: the rules that look at other files.

use crate::host::{self, error_line, output_line};
use crate::linter_cmd::linter;
use bun_lint::linter::{LintOptions, ResolvedConfig};
use bun_lint::options::Json;
use bun_lint_graph::{Graph, Store, with_file};

/// `bun-lint plugins cycles <paths..> [--threads=n] [--json] [--oxlint] [options as JSON]`: `import/no-cycle` alone on all the files
/// in `paths`, as the command line does it, with the time that each step takes. `--oxlint`: as with a configuration of oxlint.
fn cycles(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let threads: usize = flag("--threads=").and_then(|n| n.parse().ok()).unwrap_or(1);
    let options = args
        .iter()
        .find(|it| it.starts_with('['))
        .and_then(|it| bun_lint::json::parse(it.as_bytes()));
    let mut rule = vec![Json::Number(1.0)];
    rule.extend_from_slice(
        options
            .as_ref()
            .and_then(Json::as_array)
            .unwrap_or_default(),
    );
    let config = Json::Object(vec![(
        b"rules".to_vec(),
        Json::Object(vec![(b"import/no-cycle".to_vec(), Json::Array(rule))]),
    )]);
    let mut config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    config.language.parser = bun_lint::language::Parser::TypeScript;
    config.language.experimental_decorators = true;
    config.language.refuses_what_parser_refuses = false;
    config.language.is_oxlint = args.iter().any(|it| it == "--oxlint");
    config.skips_unknown_rules = true;
    let mut paths = Vec::new();
    for arg in args
        .iter()
        .filter(|a| !a.starts_with("--") && !a.starts_with('['))
    {
        crate::collect(&host::real_path(arg).expect("a path"), &mut paths);
    }
    let paths: Vec<String> = paths
        .iter()
        .map(|it| it.to_string_lossy().into_owned())
        .collect();
    let started = std::time::Instant::now();
    let store = Store::new(paths.first().map_or(&b"/"[..], |it| it.as_bytes()));
    let graph = Graph::new(&store);
    let lint = |path: &str| {
        let text = host::read(path).unwrap_or_default();
        let linted = with_file(
            path.as_bytes(),
            &text,
            &config.language,
            Some(&graph),
            |file| {
                linter()
                    .lint(file, &config, &LintOptions::default())
                    .messages
            },
        );
        linted.unwrap_or_default()
    };
    bun_sema_standalone::for_each_parallel(threads, paths.len(), |at| {
        lint(&paths[at]);
    });
    let collected = started.elapsed();
    let again =
        graph.complete(&|count, work| bun_sema_standalone::for_each_parallel(threads, count, work));
    let completed = started.elapsed();
    let found = bun_threading::Guarded::new(Vec::new());
    bun_sema_standalone::for_each_parallel(threads, again.len(), |at| {
        let path = host::text(&again[at]);
        let messages = lint(&path);
        found
            .lock()
            .extend(messages.into_iter().map(|it| (path.clone(), it)));
    });
    let mut found = std::mem::take(&mut *found.lock());
    found.sort_by(|a, b| (&a.0, a.1.line, a.1.column).cmp(&(&b.0, b.1.line, b.1.column)));
    if args.iter().any(|it| it == "--json") {
        for (path, message) in &found {
            output_line!(
                "{path}:{}:{}: {}",
                message.line,
                message.column,
                bstr::BStr::new(&message.message)
            );
        }
    }
    error_line!(
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
        _ => output_line!(
            "usage: bun-lint plugins cycles <paths..> [--threads=n] [--json] [--oxlint] [options]"
        ),
    }
}
