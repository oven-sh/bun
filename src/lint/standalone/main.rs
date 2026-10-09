//! `bun-lint`: the linter without the rest of Bun, for developing and testing rules.
//!
//! - `bun-lint conformance <fixtures> ..`: runs the test cases of ESLint, typescript-eslint and the
//!   plugins and compares with what ESLint reports for them. See `conformance_cmd.rs`.
//! - `bun-lint run <rule> <file> [options as JSON]`: what one rule reports for one file.

#![forbid(unsafe_code)]

mod ast_cmd;
mod code_frame_cmd;
mod code_path_cmd;
mod conformance_cmd;
mod driver_cmd;
mod format_cmd;
mod js_plugin_cmd;
mod jsdoc_cmd;
mod linter_cmd;
mod parser_cmd;
mod perf_cmd;
mod plugins_cmd;
mod react_compiler_cmd;
mod regex_cmd;
mod selector_cmd;
mod semantic_cmd;
mod tokens_cmd;
mod types_cmd;
mod utils_core_cmd;
mod utils_eslint_cmd;
mod utils_small_cmd;
mod utils_ts_cmd;
mod utils_tsscope_cmd;

use bun_lint::context::Severity;
use bun_lint::language::LanguageOptions;
use bun_lint::options::{Json, Options};
use bun_lint::runner::{Enabled, RuleEntry};

pub(crate) use bun_sema_standalone::host;
pub(crate) use conformance_cmd::lint;
use host::{output_line, text};

fn all_rules() -> impl Iterator<Item = &'static RuleEntry> {
    bun_lint_eslint::RULES
        .iter()
        .chain(bun_lint_typescript::RULES)
        .chain(bun_lint_plugins::RULES)
        .chain(bun_lint_unicorn::RULES)
        .chain(bun_lint_react::RULES)
        .chain(bun_lint_jest::RULES)
}

pub(crate) use linter_cmd::with_file;

fn str_of<'j>(json: &'j Json, key: &str) -> Option<&'j str> {
    std::str::from_utf8(json.get(key.as_bytes())?.as_str()?).ok()
}

fn run_one(args: &[String]) {
    let [rule, path, rest @ ..] = args else {
        return output_line!("usage: bun-lint run <rule> <file> [options as JSON]");
    };
    let Some(entry) = linter_cmd::linter().registry().find(rule.as_bytes()) else {
        return output_line!("no such rule: {rule}");
    };
    let code = host::read(path).expect("the file");
    let options = rest
        .first()
        .and_then(|it| bun_lint::json::parse(it.as_bytes()));
    let options = options
        .as_ref()
        .and_then(Json::as_array)
        .unwrap_or_default();
    let outcome = lint(entry, path, &code, options, &Json::Null, &Json::Null);
    if outcome.has_parse_errors {
        output_line!("the parser rejects the code");
    }
    for it in &outcome.messages {
        output_line!(
            "{path}:{}:{}: {} ({})",
            it.line,
            it.column,
            it.message,
            it.message_id
        );
    }
    if let Some(output) = outcome.output {
        output_line!("──── after fixes\n{}", text(&output));
    }
}

/// Every `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts` file in `path`, which can be one itself.
fn collect(path: &std::path::Path, into: &mut Vec<std::path::PathBuf>) {
    const EXTENSIONS: [&str; 8] = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
    if path.is_dir() {
        let is_skipped = matches!(
            path.file_name().and_then(|it| it.to_str()),
            Some("node_modules" | ".git")
        );
        if !is_skipped {
            let mut paths = host::list(path);
            paths.sort();
            paths.iter().for_each(|it| collect(it, into));
        }
    } else if path
        .extension()
        .and_then(|it| it.to_str())
        .is_some_and(|it| EXTENSIONS.contains(&it))
    {
        into.push(path.to_owned());
    }
}

/// `bun-lint bench <paths..> [--threads=n] [--repeat=n] [--rules=a,b]`: how long parsing and binding take, and how long all the
/// rules that need no types take, with their default options.
fn bench(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let threads: usize = flag("--threads=").and_then(|n| n.parse().ok()).unwrap_or(1);
    let repeat: usize = flag("--repeat=").and_then(|n| n.parse().ok()).unwrap_or(1);
    let only: Option<Vec<&str>> = flag("--rules=").map(|it| host::split(it, ",").collect());
    let mut paths = Vec::new();
    for arg in args.iter().filter(|a| !a.starts_with("--")) {
        collect(std::path::Path::new(arg), &mut paths);
    }
    let files: Vec<(String, Vec<u8>)> = (paths.iter())
        .filter_map(|path| Some((path.to_string_lossy().into_owned(), host::read(path).ok()?)))
        .collect();
    let bytes: usize = files.iter().map(|it| it.1.len()).sum();
    let built: Vec<_> = all_rules()
        .filter(|it| {
            !it.meta.requires_types
                && only
                    .as_ref()
                    .is_none_or(|only| only.contains(&it.meta.name))
        })
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
            .map(|(nanos, rule)| {
                (
                    nanos.load(Relaxed) as f64 / 1e6 / repeat as f64,
                    rule.rule.meta().name,
                )
            })
            .collect();
        table.sort_by(|a, b| b.0.total_cmp(&a.0));
        output_line!(
            "sum of the rules alone: {:.1} ms",
            table.iter().map(|it| it.0).sum::<f64>()
        );
        for (ms, name) in table {
            output_line!("{ms:9.1} ms  {name}");
        }
    }
    let per_pass = |nanos: &AtomicU64| nanos.load(Relaxed) as f64 / 1e6 / repeat as f64;
    output_line!(
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

// With `--cfg bun_sema_mimalloc` the real mimalloc is linked, to measure with Bun's allocator.
#[cfg(bun_sema_mimalloc)]
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

fn main() {
    bun_sema_standalone::native::set_stack_size(7 << 20);
    // `bun_js_parser::sema::DirectMode`, as a number.
    if let Some(mode) = host::variable("BUN_SEMA_DIRECT").and_then(|it| it.parse().ok()) {
        bun_js_parser::sema::DIRECT_MODE.store(mode, std::sync::atomic::Ordering::Relaxed);
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("conformance") => conformance_cmd::run(&args[1..]),
        Some("run") => run_one(&args[1..]),
        Some("bench") => bench(&args[1..]),
        Some("ast") => ast_cmd::run(&args[1..]),
        Some("tokens") => tokens_cmd::run(&args[1..]),
        Some("semantic") => semantic_cmd::run(&args[1..]),
        Some("code-path") => code_path_cmd::run(&args[1..]),
        Some("perf") => perf_cmd::run_command(&args[1..]),
        Some("regex") => regex_cmd::run(&args[1..]),
        Some("types") => types_cmd::run(&args[1..]),
        Some("linter") => linter_cmd::run(&args[1..]),
        Some("parser") => parser_cmd::run(&args[1..]),
        Some("format") => format_cmd::run(&args[1..]),
        Some("cli") => driver_cmd::run(&args[1..]),
        Some("selector") => selector_cmd::run(&args[1..]),
        Some("plugins") => plugins_cmd::run(&args[1..]),
        Some("react-compiler") => react_compiler_cmd::run(&args[1..]),
        Some("code-frame") => code_frame_cmd::run(&args[1..]),
        Some("js_plugin") => js_plugin_cmd::run(&args[1..]),
        Some("jsdoc") => jsdoc_cmd::run(&args[1..]),
        Some("utils-eslint") => utils_eslint_cmd::run(&args[1..]),
        Some("utils-tsscope") => utils_tsscope_cmd::run(&args[1..]),
        Some("utils-ts") => utils_ts_cmd::run(&args[1..]),
        Some("utils-core") => utils_core_cmd::run(&args[1..]),
        Some("utils-small") => utils_small_cmd::run(&args[1..]),
        _ => output_line!(
            "usage: bun-lint conformance <fixtures> | bun-lint run <rule> <file> [options]"
        ),
    }
}
