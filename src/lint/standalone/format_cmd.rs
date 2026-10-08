//! `bun-lint format ..`: the formatter without the rest of Bun, for developing and testing it.
//!
//! Every command takes Prettier's options as `--name=value`: `--semi=false --printWidth=100`.
//!
//! - `file <path>`: the formatted file.
//! - `ir <path>`: the document that the file is printed from.
//! - `conformance <prettier>/tests/format [--filter=text] [--report=dir] [--verbose]`: formats the
//!   inputs of Prettier's own snapshot tests for JavaScript, JSX and TypeScript, and compares with
//!   the snapshots. With `--report`, `summary.md` and the expected and the actual output of each
//!   failure are written there.
//! - `check-idempotent <paths..>`: formatting what has been formatted changes nothing.
//! - `verify <paths..>`: what has been formatted has the same tokens. See `bun_format::verify`.
//! - `bench <paths..> [--iterations=n]`: MB/s, with and without parsing.
//! - `serve`: formats the file at each path that is read from stdin, one per line, and answers
//!   `ok <length>\n<bytes>` or `error <message>\n`. test/cli/format/oracle/compare.ts talks to it.

use bun_format::{FormatError, FormatOptions, Scratch};
use bun_lint::language::LanguageOptions;
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::{BufRead, Write as _};
use std::path::{Path, PathBuf};

fn format_text(path: &str, code: &[u8], options: &FormatOptions) -> Result<Vec<u8>, FormatError> {
    crate::with_file(path, code, &LanguageOptions::default(), |file| {
        let (mut scratch, mut out) = (Scratch::default(), Vec::new());
        bun_format::format(file, options, &mut scratch, &mut out).map(|()| out)
    })
}

/// The same, but a panic is an error.
fn format_text_or_panic(path: &str, code: &[u8], options: &FormatOptions) -> Result<Vec<u8>, String> {
    match std::panic::catch_unwind(|| format_text(path, code, options)) {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(error)) => Err(format!("{error:?}")),
        Err(_) => Err("panic".to_owned()),
    }
}

struct Args {
    options: FormatOptions,
    /// `--name=value` that is not an option of Prettier.
    flags: BTreeMap<String, String>,
    positional: Vec<String>,
}

impl Args {
    fn parse(args: &[String]) -> Args {
        let mut parsed = Args {
            options: FormatOptions::default(),
            flags: BTreeMap::new(),
            positional: Vec::new(),
        };
        for arg in args {
            let Some(flag) = arg.strip_prefix("--") else {
                parsed.positional.push(arg.clone());
                continue;
            };
            let (name, value) = flag.split_once('=').unwrap_or((flag, "true"));
            if parsed.options.set(name.as_bytes(), value.as_bytes()).is_err() {
                parsed.flags.insert(name.to_owned(), value.to_owned());
            }
        }
        parsed
    }

    fn flag(&self, name: &str) -> Option<&str> {
        self.flags.get(name).map(String::as_str)
    }
}

// ───────────────────────────── conformance ─────────────────────────────

/// What is not tested: syntax that is not standard, embedded languages, and features that are not
/// there yet. A case is left out if its path contains one of these.
const IGNORED: &[&str] = &[
    // Syntax that neither ECMAScript nor TypeScript has
    "js/_errors_",
    "js/babel-plugins",
    "js/bind-expression",
    "js/destructuring-private-fields",
    "js/discard-binding",
    "js/do-expression",
    "jsx/do-expression",
    "js/export-default/export-default-from",
    "js/export-default/escaped",
    "js/function-sent",
    "js/module-block",
    "js/optional-chaining-assignment",
    "js/partial-application",
    "js/pipeline-operator",
    "js/source-phase-imports",
    "js/throw-expression",
    "js/v8-intrinsic",
    "tuple-and-record",
    "jsx/fbt",
    "typescript/error-recovery",
    "js/error-recovery",
    // Embedded languages
    "js/embeded",
    "js/multiparser",
    "typescript/multiparser",
    "typescript/angular-component-examples",
    "styled-components",
    "styled-jsx",
    "css-prop",
    "embed",
    // Formatting a part of a file
    "range",
    "cursor",
];

/// A test case of a snapshot file.
struct Case {
    /// `arrow.js`, `snippet: #0`
    name: String,
    /// `name: value`, without `parsers` and `printWidth`.
    options: Vec<(String, String)>,
    parsers: String,
    print_width: Option<String>,
    input: String,
    output: String,
}

/// What `` ` `` quotes in a snapshot file.
fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.extend(chars.next()),
            _ => out.push(c),
        }
    }
    out
}

fn section<'t>(text: &'t str, title: &str) -> Option<(&'t str, &'t str)> {
    let width = 80 - title.len();
    let line = format!("{}{title}{}\n", "=".repeat(width / 2), "=".repeat(width - width / 2));
    text.split_once(line.as_str())
}

fn parse_snapshots(text: &str) -> Vec<Case> {
    let mut cases = Vec::new();
    for entry in text.split("\nexports[`").skip(1) {
        let Some((title, body)) = entry.split_once("`] = `\n") else {
            continue;
        };
        // Those for one parser, `format[acorn] 1`, are what differs from the first parser.
        let Some(title) = title.strip_suffix(" format 1") else {
            continue;
        };
        let name = title.split_once(" - {").map_or(title, |it| it.0);
        let Some(body) = body.rsplit_once("\n`;").map(|it| it.0) else {
            continue;
        };
        let body = unescape(body);
        let Some((_, rest)) = section(&body, "options") else {
            continue;
        };
        let Some((options_text, rest)) = section(rest, "input") else {
            continue;
        };
        let Some((input, rest)) = section(rest, "output") else {
            continue;
        };
        let Some(output) = rest.strip_suffix(&"=".repeat(80)) else {
            continue;
        };

        let mut case = Case {
            name: unescape(name),
            options: Vec::new(),
            parsers: String::new(),
            print_width: None,
            // The sections end with a line break that is not part of them.
            input: input.strip_suffix('\n').unwrap_or(input).to_owned(),
            output: output.strip_suffix('\n').unwrap_or(output).to_owned(),
        };
        for line in options_text.lines() {
            let Some((name, value)) = line.trim().trim_end_matches('|').split_once(": ") else {
                continue;
            };
            let value = value.trim().trim_matches('"');
            match name {
                "parsers" => case.parsers = value.to_owned(),
                "printWidth" => case.print_width = Some(value.trim_end_matches(" (default)").to_owned()),
                _ => case.options.push((name.to_owned(), value.to_owned())),
            }
        }
        cases.push(case);
    }
    cases
}

fn find_snapshot_files(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            find_snapshot_files(&path, found);
        } else if path.file_name().is_some_and(|it| it == "format.test.js.snap") {
            found.push(path);
        }
    }
}

/// `<LF>`, `<CRLF>` and `<CR>` at the ends of the lines, the way the snapshots show them.
fn visualize_end_of_line(text: &str) -> String {
    text.replace("\r\n", "<CRLF>\u{0}").replace('\r', "<CR>\u{0}").replace('\n', "<LF>\n").replace('\u{0}', "\n")
}

#[derive(Default, Clone, Copy)]
struct Tally {
    passed: usize,
    failed: usize,
    /// The parser reports a syntax error.
    syntax_errors: usize,
    /// It has an option that is not supported.
    unsupported: usize,
    panics: usize,
}

impl Tally {
    fn add(&mut self, other: Tally) {
        self.passed += other.passed;
        self.failed += other.failed;
        self.syntax_errors += other.syntax_errors;
        self.unsupported += other.unsupported;
        self.panics += other.panics;
    }

    fn total(self) -> usize {
        self.passed + self.failed
    }

    fn percent(self) -> f64 {
        100.0 * self.passed as f64 / self.total().max(1) as f64
    }
}

fn conformance(args: &Args) {
    let root = PathBuf::from(args.positional.first().expect("the path of prettier/tests/format"));
    let filter = args.flag("filter");
    let report = args.flag("report").map(PathBuf::from);
    let is_verbose = args.flag("verbose").is_some();
    // The message of a panic would be printed for each.
    std::panic::set_hook(Box::new(|_| {}));

    let mut by_directory: BTreeMap<String, Tally> = BTreeMap::new();
    let mut failures = String::new();
    for language in ["js", "jsx", "typescript"] {
        let mut snapshot_files = Vec::new();
        find_snapshot_files(&root.join(language), &mut snapshot_files);
        snapshot_files.sort();

        for snapshot_file in snapshot_files {
            let Some(directory) = snapshot_file.parent().and_then(Path::parent) else {
                continue;
            };
            let relative = directory.strip_prefix(&root).unwrap_or(directory).to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&snapshot_file).unwrap_or_default();
            // `js/arrow-expression`, whatever is below it.
            let group = relative.split('/').take(2).collect::<Vec<_>>().join("/");

            for case in parse_snapshots(&text) {
                let id = format!("{relative}/{}", case.name);
                if IGNORED.iter().any(|it| id.contains(it)) || filter.is_some_and(|it| !id.contains(it)) {
                    continue;
                }
                let tally = by_directory.entry(group.clone()).or_default();

                let mut options = FormatOptions::default();
                let all = case.options.iter().map(|(name, value)| (name.as_str(), value.as_str()));
                let print_width = case.print_width.as_deref().map(|it| ("printWidth", it));
                let described = case.options.iter().map(|(name, value)| format!(" {name}={value}")).collect::<String>();
                if all.chain(print_width).any(|(name, value)| options.set(name.as_bytes(), value.as_bytes()).is_err())
                    || !options.is_supported()
                {
                    tally.unsupported += 1;
                    continue;
                }

                // The file has what the snapshot cannot show: line endings, a byte order mark.
                let on_disk = directory.join(&case.name);
                let (path, input) = match std::fs::read(&on_disk) {
                    Ok(input) => (on_disk.to_string_lossy().into_owned(), input),
                    Err(_) => {
                        let extension = match language {
                            "typescript" => "ts",
                            "jsx" => "jsx",
                            _ if case.parsers.starts_with("[\"typescript") => "ts",
                            _ => "js",
                        };
                        (format!("snippet.{extension}"), case.input.clone().into_bytes())
                    }
                };

                let actual = match format_text_or_panic(&path, &input, &options) {
                    Ok(actual) => crate::text(&actual),
                    Err(error) if error == "SyntaxError" => {
                        tally.syntax_errors += 1;
                        if is_verbose {
                            println!("syntax error: {id}");
                        }
                        continue;
                    }
                    Err(error) => {
                        tally.panics += usize::from(error == "panic");
                        format!("<{error}>")
                    }
                };
                let is_visualized = case.output.contains("<LF>\n") || case.output.contains("<CRLF>\n");
                let actual = if is_visualized { visualize_end_of_line(&actual) } else { actual };
                let expected = case.output;

                if actual == expected {
                    tally.passed += 1;
                    continue;
                }
                tally.failed += 1;
                let _ = writeln!(failures, "- {id}{described}");
                if is_verbose {
                    println!("failed: {id}{described}");
                }
                if let Some(report) = &report {
                    let file = id.replace(['/', ' ', ':', '#'], "_") + &described.replace([' ', '='], "_");
                    let _ = std::fs::create_dir_all(report);
                    let _ = std::fs::write(report.join(format!("{file}.expected")), &expected);
                    let _ = std::fs::write(report.join(format!("{file}.actual")), &actual);
                    let _ = std::fs::write(report.join(format!("{file}.input")), &input);
                }
            }
        }
    }

    let mut summary = String::new();
    let version = std::fs::read_to_string(root.join("../../package.json")).unwrap_or_default();
    let version = version.split_once("\"version\": \"").and_then(|it| it.1.split_once('"')).map_or("?", |it| it.0);
    let _ = writeln!(summary, "# Conformance with Prettier {version}\n");
    let _ = writeln!(summary, "| directory | passed | total | % | syntax errors | unsupported options | panics |");
    let _ = writeln!(summary, "| --- | --- | --- | --- | --- | --- | --- |");
    let mut by_language: BTreeMap<&str, Tally> = BTreeMap::new();
    for (directory, tally) in &by_directory {
        by_language.entry(directory.split('/').next().unwrap_or_default()).or_default().add(*tally);
        let _ = writeln!(
            summary,
            "| {directory} | {} | {} | {:.0} | {} | {} | {} |",
            tally.passed,
            tally.total(),
            tally.percent(),
            tally.syntax_errors,
            tally.unsupported,
            tally.panics
        );
    }
    let mut totals = String::new();
    let mut everything = Tally::default();
    for (language, tally) in by_language.iter().map(|(language, tally)| (*language, *tally)) {
        everything.add(tally);
        let _ = writeln!(
            totals,
            "{language}: {}/{} ({:.2}%), {} syntax errors, {} with unsupported options, {} panics",
            tally.passed,
            tally.total(),
            tally.percent(),
            tally.syntax_errors,
            tally.unsupported,
            tally.panics
        );
    }
    let _ = writeln!(totals, "all: {}/{} ({:.2}%)", everything.passed, everything.total(), everything.percent());
    if let Some(report) = &report {
        let _ = std::fs::create_dir_all(report);
        let _ = std::fs::write(report.join("summary.md"), format!("{summary}\n{totals}\n## Failures\n\n{failures}"));
    }
    if filter.is_none() && !is_verbose {
        print!("{summary}\n");
    }
    print!("{totals}");
}

// ───────────────────────────── files ─────────────────────────────

const EXTENSIONS: &[&str] = &["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];

/// The files at `paths` and in the directories at `paths` that can be formatted.
fn collect_files(paths: &[String]) -> Vec<PathBuf> {
    fn visit(path: &Path, found: &mut Vec<PathBuf>) {
        if path.is_dir() {
            if path.file_name().is_some_and(|it| it == "node_modules" || it == ".git") {
                return;
            }
            let mut entries: Vec<_> = std::fs::read_dir(path).into_iter().flatten().flatten().map(|it| it.path()).collect();
            entries.sort();
            entries.iter().for_each(|it| visit(it, found));
        } else if path.extension().and_then(|it| it.to_str()).is_some_and(|it| EXTENSIONS.contains(&it)) {
            found.push(path.to_owned());
        }
    }
    let mut found = Vec::new();
    paths.iter().for_each(|it| visit(Path::new(it), &mut found));
    found
}

fn check_idempotent(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let (mut passed, mut failed, mut errors) = (0, 0, 0);
    for path in collect_files(&args.positional) {
        let name = path.to_string_lossy();
        let Ok(code) = std::fs::read(&path) else {
            continue;
        };
        let Ok(once) = format_text_or_panic(&name, &code, &args.options) else {
            errors += 1;
            continue;
        };
        match format_text_or_panic(&name, &once, &args.options) {
            Ok(twice) if twice == once => passed += 1,
            Ok(_) => {
                failed += 1;
                println!("not idempotent: {name}");
            }
            Err(error) => {
                failed += 1;
                println!("{error} in the formatted file: {name}");
            }
        }
    }
    println!("idempotent: {passed}, not: {failed}, not formatted: {errors}");
}

fn verify(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let (mut passed, mut failed, mut errors) = (0, 0, 0);
    for path in collect_files(&args.positional) {
        let name = path.to_string_lossy();
        let Ok(code) = std::fs::read(&path) else {
            continue;
        };
        let Ok(formatted) = format_text_or_panic(&name, &code, &args.options) else {
            errors += 1;
            continue;
        };
        let language = LanguageOptions::default();
        let difference = crate::with_file(&name, &code, &language, |before| {
            crate::with_file(&name, &formatted, &language, |after| bun_format::verify::compare(before, after))
        });
        match difference {
            Ok(()) => passed += 1,
            Err(difference) => {
                failed += 1;
                println!("{name}: {difference}");
            }
        }
    }
    println!("the same tokens: {passed}, not: {failed}, not formatted: {errors}");
}

fn bench(args: &Args) {
    let iterations: usize = args.flag("iterations").and_then(|it| it.parse().ok()).unwrap_or(10);
    let files: Vec<(String, Vec<u8>)> = collect_files(&args.positional)
        .iter()
        .filter_map(|path| Some((path.to_string_lossy().into_owned(), std::fs::read(path).ok()?)))
        .filter(|(path, code)| format_text(path, code, &args.options).is_ok())
        .collect();
    let bytes: usize = files.iter().map(|it| it.1.len()).sum();
    let language = LanguageOptions::default();
    let (mut scratch, mut out) = (Scratch::default(), Vec::new());

    let (mut parsing, mut formatting) = (std::time::Duration::ZERO, std::time::Duration::ZERO);
    for _ in 0..iterations {
        for (path, code) in &files {
            let start = std::time::Instant::now();
            crate::with_file(path, code, &language, |file| {
                parsing += start.elapsed();
                let start = std::time::Instant::now();
                out.clear();
                let _ = bun_format::format(file, &args.options, &mut scratch, &mut out);
                formatting += start.elapsed();
            });
        }
    }
    let megabytes = (bytes * iterations) as f64 / 1e6;
    println!("{} files, {:.2} MB, {iterations} iterations", files.len(), bytes as f64 / 1e6);
    println!("format:         {:8.1} MB/s", megabytes / formatting.as_secs_f64());
    println!("parse + bind:   {:8.1} MB/s", megabytes / parsing.as_secs_f64());
    println!("all:            {:8.1} MB/s", megabytes / (parsing + formatting).as_secs_f64());
}

fn serve(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let mut stdout = std::io::stdout().lock();
    for path in std::io::stdin().lock().lines().map_while(Result::ok) {
        let result = match std::fs::read(&path) {
            Ok(code) => format_text_or_panic(&path, &code, &args.options),
            Err(error) => Err(error.to_string()),
        };
        let _ = match result {
            Ok(out) => writeln!(stdout, "ok {}", out.len()).and_then(|()| stdout.write_all(&out)),
            Err(error) => writeln!(stdout, "error {error}"),
        };
        let _ = stdout.flush();
    }
}

pub(crate) fn run(args: &[String]) {
    let command = args.first().map(String::as_str);
    let args = Args::parse(args.get(1..).unwrap_or_default());
    match command {
        Some("file") => {
            let path = args.positional.first().expect("a path");
            let code = std::fs::read(path).expect("the file");
            match format_text(path, &code, &args.options) {
                Ok(out) => print!("{}", crate::text(&out)),
                Err(error) => println!("{error:?}"),
            }
        }
        Some("ir") => {
            let path = args.positional.first().expect("a path");
            let code = std::fs::read(path).expect("the file");
            let document = crate::with_file(path, &code, &LanguageOptions::default(), |file| {
                bun_format::dump_document(file, &args.options, &mut Scratch::default())
            });
            match document {
                Ok(document) => print!("{document}"),
                Err(error) => println!("{error:?}"),
            }
        }
        Some("conformance") => conformance(&args),
        Some("check-idempotent") => check_idempotent(&args),
        Some("verify") => verify(&args),
        Some("bench") => bench(&args),
        Some("serve") => serve(&args),
        _ => println!("usage: bun-lint format file|ir|conformance|check-idempotent|verify|bench|serve .."),
    }
}
