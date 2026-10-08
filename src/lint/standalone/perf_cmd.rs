//! `bun-lint perf rules <paths..> [--threads=n] [--rules=a,b | --config=<.oxlintrc.json>] [--repeat=n] [--top=n]`
//!
//! What each rule costs on its own, with its default options, summed over the files:
//! - cold: on a file of which nothing is computed yet. It pays for whatever it asks for: the nodes by kind, tokens, scopes, lines.
//! - warm: on a file on which it has run already. That is what it adds to rules that ask for the same.
//!
//! Each is the least of `--repeat` runs per file, so that what else the machine does hardly shows.
//!
//! `bun-lint perf positions <files..>`: see [`positions`].

use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::language::LanguageOptions;
use bun_lint::options::{Json, Options};
use bun_lint::rule::Plugin;
use bun_lint::runner::{Enabled, run};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::session::Session;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

/// The names of the rules that a configuration of oxlint turns on, as `(plugin, name)`.
fn rules_of_config(path: &str) -> Vec<(Plugin, String)> {
    let json = std::fs::read(path)
        .ok()
        .and_then(|it| bun_lint::json::parse(&it))
        .expect("the configuration");
    let rules = json
        .get(b"rules")
        .and_then(Json::as_object)
        .unwrap_or_default();
    (rules.iter())
        .map(|(id, _)| match String::from_utf8_lossy(id).into_owned() {
            id if id.starts_with("typescript/") => {
                (Plugin::TypeScript, id["typescript/".len()..].to_owned())
            }
            id => (Plugin::Eslint, id),
        })
        .collect()
}

/// How long `rules` take on `file`, and how much they report.
fn nanos_of<'a>(file: &'a File<'a>, rules: &[Enabled]) -> (u64, u64) {
    let started = Instant::now();
    let found = run(file, rules, false).len() as u64;
    (started.elapsed().as_nanos() as u64, found)
}

fn rules(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let number =
        |name: &str, default: usize| flag(name).and_then(|n| n.parse().ok()).unwrap_or(default);
    let (threads, repeat, top) = (
        number("--threads=", 8),
        number("--repeat=", 3),
        number("--top=", usize::MAX),
    );
    let only: Option<Vec<&str>> = flag("--rules=").map(|it| it.split(',').collect());
    let of_config = flag("--config=").map(rules_of_config);
    let mut paths = Vec::new();
    for arg in args.iter().filter(|a| !a.starts_with("--")) {
        crate::collect(std::path::Path::new(arg), &mut paths);
    }
    let files: Vec<(String, Vec<u8>)> = (paths.iter())
        .filter_map(|path| {
            Some((
                path.to_string_lossy().into_owned(),
                std::fs::read(path).ok()?,
            ))
        })
        .collect();
    let built: Vec<_> = crate::all_rules()
        .filter(|it| !it.meta.requires_types)
        .filter(|it| {
            only.as_ref()
                .is_none_or(|only| only.contains(&it.meta.name))
        })
        .filter(|it| {
            (of_config.as_ref()).is_none_or(|all| {
                all.iter()
                    .any(|(plugin, name)| *plugin == it.meta.plugin && name == it.meta.name)
            })
        })
        .map(|it| (it.build)(&Options::default()))
        .collect();
    let enabled: Vec<Enabled> = built
        .iter()
        .map(|rule| Enabled {
            rule: &**rule,
            severity: Severity::Error,
        })
        .collect();
    let zeros = || {
        enabled
            .iter()
            .map(|_| AtomicU64::new(0))
            .collect::<Vec<_>>()
    };
    let (cold, warm, reports) = (zeros(), zeros(), zeros());
    let (together, front_end) = (AtomicU64::new(0), AtomicU64::new(0));
    let nodes: [AtomicU64; 4] = Default::default();
    let language = LanguageOptions::default();
    bun_sema_standalone::for_each_parallel(threads, files.len(), |i| {
        let (path, code) = &files[i];
        let started = Instant::now();
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let arena = session.arena();
        let options = language.parse_options(path.as_bytes());
        let mut hir = bun_js_parser::sema::summarize_as(
            options.dialect,
            arena,
            path.as_bytes(),
            options.script_kind,
            code,
            &atoms,
            options.experimental_decorators,
            options.every_file_is_a_module,
        )
        .0;
        hir.text = code.to_vec().into();
        let bind_options = BindOptions {
            emit_standard_class_fields: true,
            before_es2020: false,
            before_es2017: false,
        };
        let mut recycled = Recycled::of_this_thread();
        let bound = bind_for_lint_in(&hir, bind_options, &atoms, &mut recycled);
        front_end.fetch_add(started.elapsed().as_nanos() as u64, Relaxed);
        for (count, len) in nodes.iter().zip([
            hir.exprs.len(),
            hir.stmts.len(),
            hir.types.len(),
            hir.pats.len(),
        ]) {
            count.fetch_add(len as u64, Relaxed);
        }
        // On a file of which nothing is computed yet, then once more: how long each takes, and how much is reported.
        let measure = |rules: &[Enabled]| {
            let file = File::new(path.as_bytes(), &hir, bound, &atoms, &language, None);
            let (cold, found) = nanos_of(&file, rules);
            (cold, nanos_of(&file, rules).0, found)
        };
        if hir.has_errors || hir.has_parse_diagnostics {
            return;
        }
        together.fetch_add(
            (0..repeat).map(|_| measure(&enabled).0).min().unwrap_or(0),
            Relaxed,
        );
        for (at, rule) in enabled.iter().enumerate() {
            let rule = std::slice::from_ref(rule);
            let (mut least_cold, mut least_warm, mut reported) = (u64::MAX, u64::MAX, 0);
            for _ in 0..repeat {
                let (cold, warm, found) = measure(rule);
                least_cold = least_cold.min(cold);
                least_warm = least_warm.min(warm);
                reported = found;
            }
            reports[at].fetch_add(reported, Relaxed);
            cold[at].fetch_add(least_cold, Relaxed);
            warm[at].fetch_add(least_warm, Relaxed);
        }
    });
    let ms = |nanos: &AtomicU64| nanos.load(Relaxed) as f64 / 1e6;
    let mut table: Vec<usize> = (0..enabled.len()).collect();
    table.sort_by(|&a, &b| ms(&cold[b]).total_cmp(&ms(&cold[a])));
    println!(
        "     cold      warm   reports  rule (ms of CPU, {} files)",
        files.len()
    );
    for &at in table.iter().take(top) {
        let meta = enabled[at].rule.meta();
        let prefix = if meta.plugin == Plugin::Eslint {
            ""
        } else {
            "ts/"
        };
        println!(
            "{:9.1} {:9.1} {:9}  {prefix}{}",
            ms(&cold[at]),
            ms(&warm[at]),
            reports[at].load(Relaxed),
            meta.name
        );
    }
    println!(
        "{} rules: together {:.1} ms, sum of cold {:.1} ms, sum of warm {:.1} ms; parse + bind {:.1} ms; {:?} expressions, statements, types, patterns",
        enabled.len(),
        ms(&together),
        cold.iter().map(ms).sum::<f64>(),
        warm.iter().map(ms).sum::<f64>(),
        ms(&front_end),
        nodes.map(|count| count.load(Relaxed)),
    );
}

/// `File::position` and `File::offset` of where every character of each file starts, in three orders, against counting from the
/// start of the text. Prints how long they take: it has to grow with the length of the text, however long its lines are.
fn positions(args: &[String]) {
    let language = LanguageOptions::default();
    let mut wrong = 0;
    for path in args {
        let code = std::fs::read(path).expect("the file");
        let text = String::from_utf8(code.clone()).expect("UTF-8");
        // (offset, line, column)
        let (mut expected, mut line, mut column) = (Vec::new(), 1u32, 0u32);
        let mut characters = text.char_indices().peekable();
        while let Some((at, c)) = characters.next() {
            if !(at == 0 && c == '\u{FEFF}') {
                expected.push((at as u32, line, column));
                column += c.len_utf16() as u32;
            }
            let is_break = matches!(c, '\n' | '\u{2028}' | '\u{2029}')
                || c == '\r' && characters.peek().is_none_or(|it| it.1 != '\n');
            if is_break {
                (line, column) = (line + 1, 0);
            }
        }
        expected.push((text.len() as u32, line, column));
        let orders: [(&str, Box<dyn Fn(usize) -> usize>); 3] = [
            ("forward", Box::new(|i| i)),
            ("backward", Box::new(|i| expected.len() - 1 - i)),
            (
                "scattered",
                Box::new(|i| i.wrapping_mul(2_654_435_761) % expected.len()),
            ),
        ];
        for (name, order) in &orders {
            crate::linter_cmd::with_file(path, &code, &language, |file| {
                let started = Instant::now();
                for i in 0..expected.len() {
                    let (offset, line, column) = expected[order(i)];
                    let position = file.position(offset);
                    if (position.line, position.column) != (line, column)
                        || file.offset(position) != offset
                    {
                        wrong += 1;
                        if wrong <= 10 {
                            println!(
                                "{path}: {offset}: {line}:{column} expected, {position:?}, which is at {}",
                                file.offset(position)
                            );
                        }
                    }
                }
                println!(
                    "{path}: {} positions {name}: {:.1} ms",
                    expected.len(),
                    started.elapsed().as_secs_f64() * 1e3
                );
            });
        }
    }
    println!("{wrong} wrong");
}

pub(crate) fn run_command(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("rules") => rules(&args[1..]),
        Some("positions") => positions(&args[1..]),
        _ => println!(
            "usage: bun-lint perf rules <paths..> [--threads=n] [--rules=a,b | --config=file] [--repeat=n] [--top=n]\n       bun-lint perf positions <files..>"
        ),
    }
}
