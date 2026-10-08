//! `bun-lint format sort-imports ..`: import sorting on its own.
//!
//! - `text <path> --importOrder='["^a"]' ..`: the text that is formatted in place of the file.
//! - `cases <cases.json> [--filter=text] [--report=dir] [--verbose]`: the cases that
//!   test/cli/format/oracle/sort-imports/*.mjs make. Of each, the text and the formatted text are
//!   compared with those of the plugin and Prettier.
//! - `bench <paths..> [--iterations=n] [--steady]`: how long sorting takes, next to parsing and formatting. `--steady`: of
//!   the files as they are once they are formatted.
//! - `serve`: for each `<path>\t<length>\n<text>` on stdin, answers `<length>\n<text>` twice: the
//!   text that is formatted, and the formatted text. A length of `-1`: an error.

use super::Args;
use bun_format::sort_imports::{Settings, SortImports};
use bun_format::FormatOptions;
use bun_lint::language::LanguageOptions;
use bun_lint::options::Json;
use std::collections::BTreeMap;
use std::io::{BufRead, Read, Write};
use std::sync::Arc;

/// `--importOrder='["^a", "^b"]' --importOrderSeparation`
pub(super) fn from_flags(flags: &BTreeMap<String, String>) -> Option<Arc<SortImports>> {
    let mut settings = Settings::default();
    for (name, value) in flags {
        settings.set(name.as_bytes(), value.as_bytes());
    }
    settings.compile().unwrap_or_else(|error| panic!("{}", crate::text(&error)))
}

/// The text that is formatted in place of `code`, if it is another.
fn sorted(path: &str, code: &[u8], options: &FormatOptions) -> Option<Vec<u8>> {
    let how = options.sort_imports.as_deref()?;
    crate::with_file(path, code, &LanguageOptions::default(), |file| bun_format::sort_imports::sorted_text(file, how))
}

/// As it is written in JSON, a string without its quotes.
fn written(value: &Json) -> Vec<u8> {
    match value {
        Json::String(text) => text.clone(),
        other => {
            let mut out = Vec::new();
            other.stringify(&mut out);
            out
        }
    }
}

fn options_of(case: &Json, plugin: &[u8]) -> Result<FormatOptions, Vec<u8>> {
    let (mut options, mut settings) = (FormatOptions::default(), Settings::default());
    match plugin {
        b"organize" => settings.set(b"plugins", b"[\"prettier-plugin-organize-imports\"]"),
        _ => settings.set(b"plugins", &[b"[\"@", plugin, b"/prettier-plugin-sort-imports\"]"].concat()),
    };
    for (name, value) in case.get(b"options").and_then(Json::as_object).unwrap_or_default() {
        if !settings.set(name, &written(value)) {
            let _ = options.set(name, &written(value));
        }
    }
    options.sort_imports = settings.compile()?;
    Ok(options)
}

fn cases(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let path = args.positional.get(1).expect("a path");
    let json = bun_lint::json::parse(&std::fs::read(path).expect("the file")).expect("JSON");
    let string = |case: &Json, key: &[u8]| case.get(key).and_then(Json::as_str).map(<[u8]>::to_vec);
    let mut tally: BTreeMap<String, [usize; 4]> = BTreeMap::new();
    for case in json.as_array().unwrap_or_default() {
        let name = crate::text(&string(case, b"name").unwrap_or_default());
        let plugin = string(case, b"plugin").unwrap_or_default();
        let full_name = format!("{}/{name}", crate::text(&plugin));
        if args.flag("filter").is_some_and(|filter| !full_name.contains(filter)) {
            continue;
        }
        let (Some(input), Some(expected_output)) = (string(case, b"input"), string(case, b"output")) else {
            continue;
        };
        // oxfmt sorts while it formats: there is no text in between.
        let expected_text = string(case, b"text");
        let filename = crate::text(&string(case, b"filename").unwrap_or_default());
        let group = full_name.split('/').take(2).collect::<Vec<_>>().join("/");
        let counts = tally.entry(group).or_default();
        counts[0] += 1;
        let result = std::panic::catch_unwind(|| {
            let options = options_of(case, &plugin).map_err(|error| crate::text(&error))?;
            let text = sorted(&filename, &input, &options);
            let output = super::format_text(&filename, &input, &options).map_err(|error| format!("{error:?}"))?;
            // Left as it is: right if that makes no difference.
            let plain = FormatOptions {
                sort_imports: None,
                ..options
            };
            let is_text_right = match (&text, &expected_text) {
                (Some(text), Some(expected_text)) => text == expected_text,
                (None, Some(expected_text)) => Ok(&output) == super::format_text(&filename, expected_text, &plain).as_ref(),
                (text, None) => text.is_none(),
            };
            Ok::<_, String>((text, is_text_right, output))
        });
        let (text, is_text_right, output) = match result {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => (None, false, error.into_bytes()),
            Err(_) => (None, false, b"panic".to_vec()),
        };
        counts[1] += usize::from(is_text_right);
        counts[2] += usize::from(output == expected_output);
        counts[3] += usize::from(text.is_none());
        if is_text_right && output == expected_output {
            continue;
        }
        println!("FAIL {full_name}{}{}", if is_text_right { "" } else { " text" }, if output == expected_output { "" } else { " output" });
        if let Some(report) = args.flag("report") {
            let base = format!("{report}/{}", full_name.replace('/', "_"));
            let _ = std::fs::create_dir_all(report);
            let _ = std::fs::write(format!("{base}.input"), &input);
            let _ = std::fs::write(format!("{base}.text.expected"), expected_text.as_deref().unwrap_or_default());
            let _ = std::fs::write(format!("{base}.text.actual"), text.as_deref().unwrap_or(b"(unchanged)"));
            let _ = std::fs::write(format!("{base}.output.expected"), &expected_output);
            let _ = std::fs::write(format!("{base}.output.actual"), &output);
            let _ = std::fs::write(format!("{base}.options"), written(case.get(b"options").unwrap_or(&Json::Null)));
        }
    }
    println!("{:<40} {:>6} {:>6} {:>6} {:>9}", "", "cases", "text", "output", "unchanged");
    let mut total = [0; 4];
    for (group, counts) in &tally {
        println!("{group:<40} {:>6} {:>6} {:>6} {:>9}", counts[0], counts[1], counts[2], counts[3]);
        (0..4).for_each(|at| total[at] += counts[at]);
    }
    println!("{:<40} {:>6} {:>6} {:>6} {:>9}", "total", total[0], total[1], total[2], total[3]);
}

fn serve(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let (mut stdin, mut stdout) = (std::io::stdin().lock(), std::io::stdout().lock());
    let mut line = String::new();
    while stdin.read_line(&mut line).is_ok_and(|read| read > 0) {
        let (path, length) = line.trim_end().split_once('\t').expect("a path and a length");
        let mut code = vec![0; length.parse().expect("a length")];
        stdin.read_exact(&mut code).expect("the text");
        let result = std::panic::catch_unwind(|| {
            (sorted(path, &code, &args.options), super::format_text(path, &code, &args.options).ok())
        });
        let (text, output) = result.unwrap_or((None, None));
        for answer in [Some(text.unwrap_or_default()), output] {
            let _ = match answer {
                Some(answer) => writeln!(stdout, "{}", answer.len()).and_then(|()| stdout.write_all(&answer)),
                None => writeln!(stdout, "-1"),
            };
        }
        let _ = stdout.flush();
        line.clear();
    }
}

fn bench(args: &Args) {
    let mut files: Vec<(String, Vec<u8>)> = (super::collect_files(args.positional.get(1..).unwrap_or_default()).iter())
        .filter_map(|path| Some((path.to_string_lossy().into_owned(), std::fs::read(path).ok()?)))
        .collect();
    if args.flag("steady").is_some() {
        for (path, code) in &mut files {
            if let Ok(formatted) = super::format_text(path, code, &args.options) {
                *code = formatted;
            }
        }
    }
    let iterations: u32 = args.flag("iterations").and_then(|it| it.parse().ok()).unwrap_or(3);
    let how = args.options.sort_imports.as_deref().expect("options");
    let language = LanguageOptions::default();
    let (mut parsing, mut sorting, mut formatting, mut again, mut moved) = (0.0, 0.0, 0.0, 0.0, 0);
    let mut scratch = bun_format::Scratch::default();
    for _ in 0..iterations {
        moved = 0;
        for (path, code) in &files {
            let started = std::time::Instant::now();
            crate::with_file(path, code, &language, |file| {
                parsing += started.elapsed().as_secs_f64();
                // The formatter needs them anyway.
                let started = std::time::Instant::now();
                std::hint::black_box(file.comments().count());
                formatting += started.elapsed().as_secs_f64();
                let started = std::time::Instant::now();
                let sorted = bun_format::sort_imports::sorted_text(file, how);
                sorting += started.elapsed().as_secs_f64();
                let mut out = Vec::new();
                match sorted {
                    None => {
                        let started = std::time::Instant::now();
                        let _ = bun_format::format(file, &args.options, &mut scratch, &mut out);
                        formatting += started.elapsed().as_secs_f64();
                    }
                    Some(sorted) => {
                        moved += 1;
                        let started = std::time::Instant::now();
                        crate::with_file(path, &sorted, &language, |file| {
                            again += started.elapsed().as_secs_f64();
                            let started = std::time::Instant::now();
                            let _ = bun_format::format(file, &args.options, &mut scratch, &mut out);
                            formatting += started.elapsed().as_secs_f64();
                        });
                    }
                }
            });
        }
    }
    let per_pass = |seconds: f64| seconds * 1e3 / f64::from(iterations);
    println!(
        "{} files, {:.1} MB: parse + bind {:.1} ms, sort imports {:.1} ms, parse + bind again {:.1} ms for {moved} files, format {:.1} ms",
        files.len(),
        files.iter().map(|it| it.1.len()).sum::<usize>() as f64 / 1e6,
        per_pass(parsing),
        per_pass(sorting),
        per_pass(again),
        per_pass(formatting),
    );
}

pub(super) fn run(args: &Args) {
    match args.positional.first().map(String::as_str) {
        Some("text") => {
            let path = args.positional.get(1).expect("a path");
            let code = std::fs::read(path).expect("the file");
            match sorted(path, &code, &args.options) {
                Some(sorted) => print!("{}", crate::text(&sorted)),
                None => println!("(unchanged)"),
            }
        }
        Some("cases") => cases(args),
        Some("bench") => bench(args),
        Some("serve") => serve(args),
        _ => println!("usage: bun-lint format sort-imports text|cases|bench|serve .."),
    }
}
