//! `bun-lint format conformance <fixtures>`: Prettier's own tests. `<fixtures>` is `tests/format` of
//! a checkout of Prettier, or what is in `test/cli/format/prettier/bundle.zst`, decompressed.
//!
//! For every fixture and every set of options, Prettier's test runner
//! (`tests/config/format-test/run-test.js`) checks
//! - the output against a snapshot, or that the parser rejects the input,
//! - that formatting the output again changes nothing,
//! - that the output is the same if the lines of the input end with CRLF or with CR,
//! - that a byte order mark in front of the input is in front of the output and changes nothing else.
//!
//! So does this. The message of a syntax error is not compared.

use super::{Args, format_text_or_panic};
use bun_format::FormatOptions;
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

const PROPOSAL: &str = "syntax of a proposal at stage 2 or below, which only Babel parses";
const BABEL_TS: &str = "an input that Prettier's `typescript` parser rejects: the snapshot is made with `babel-ts`";
const FLOW: &str = "Flow's type syntax";
const EMBEDDED: &str = "embedded CSS, GraphQL, HTML or Markdown, which needs a formatter for that language";

/// What is not run, and why. A case is left out if its path contains the text.
const EXCLUDED: &[(&str, &str)] = &[
    ("js/arrows-bind", PROPOSAL),
    ("js/async-do-expressions", PROPOSAL),
    ("js/bind-expressions", PROPOSAL),
    ("js/comments-pipeline-own-line", PROPOSAL),
    ("js/discard-binding", PROPOSAL),
    ("js/do/", PROPOSAL),
    ("jsx/do/", PROPOSAL),
    ("js/export-default/export-default-from", PROPOSAL),
    ("js/export-default/escaped", PROPOSAL),
    ("js/module-blocks", PROPOSAL),
    ("valid-module-block-top-level", PROPOSAL),
    ("js/no-semi-babylon-extensions", PROPOSAL),
    ("js/objects/expression.js", PROPOSAL),
    ("js/partial-application", PROPOSAL),
    ("js/pipeline-operator", PROPOSAL),
    ("js/throw_expressions", PROPOSAL),
    ("js/v8_intrinsic", PROPOSAL),
    ("js/babel-plugins/async-do-expressions", PROPOSAL),
    ("js/babel-plugins/discard-binding", PROPOSAL),
    ("js/babel-plugins/do-expressions", PROPOSAL),
    ("js/babel-plugins/export-default-from", PROPOSAL),
    ("js/babel-plugins/function-bind", PROPOSAL),
    ("js/babel-plugins/function-sent", PROPOSAL),
    ("js/babel-plugins/module-blocks", PROPOSAL),
    ("js/babel-plugins/partial-application", PROPOSAL),
    ("js/babel-plugins/pipeline-operator", PROPOSAL),
    ("js/babel-plugins/throw-expressions", PROPOSAL),
    ("js/babel-plugins/v8intrinsic", PROPOSAL),
    ("misc/babel-redirect-to-babel-flow", FLOW),
    ("typescript/definite/definite.ts", BABEL_TS),
    ("typescript/definite/without-annotation.ts", BABEL_TS),
    ("js/embeded", EMBEDDED),
    ("js/multiparser-comments", EMBEDDED),
    ("js/multiparser-css", EMBEDDED),
    ("js/multiparser-graphql", EMBEDDED),
    ("js/multiparser-html", EMBEDDED),
    ("js/multiparser-markdown", EMBEDDED),
    ("js/multiparser-text", EMBEDDED),
    ("typescript/multiparser-css", EMBEDDED),
    ("typescript/angular-component-examples", EMBEDDED),
    ("typescript/decorators-ts/angular.ts", EMBEDDED),
    ("typescript/as/as-const-embedded.ts", EMBEDDED),
    ("misc/embedded-language-formatting", EMBEDDED),
    ("styled-components", EMBEDDED),
    ("styled-jsx", EMBEDDED),
    ("css-prop", EMBEDDED),
    ("/embed", EMBEDDED),
];

/// Formatting their output again changes it, in Prettier too: `unstableTests` of
/// `tests/config/format-test/failed-format-tests.js`.
const UNSTABLE: &[&str] = &[
    "js/ignore/semi/class-expression-decorator.js",
    "js/ignore/semi/head-ignored.js",
    "js/comments/return-statement.js",
    "js/comments/tagged-template-literal.js",
    "typescript/prettier-ignore/mapped-types.ts",
    "typescript/prettier-ignore/issue-14238.ts",
    "js/for-of/comments.js",
    "js/sequence-expression/parenthesized.js",
    "typescript/satisfies-operators/comments-unstable.ts",
    "jsx/comments/in-attributes.js",
    "typescript/import-type/long-module-name/long-module-name4.ts",
    "typescript/method-chain/object/issue-17239.ts",
    "typescript/call/callee-comments.ts",
    "js/arrows/arrow-chain-with-trailing-comments.js",
    "typescript/as/comments/18160.ts",
    "js/sequence-expression/parenthesized-trailing-comment-unstable.js",
    "typescript/union/consistent-with-flow/single-type.ts",
];

const CURSOR: &str = "<|>";
const RANGE_START: &str = "<<<PRETTIER_RANGE_START>>>";
const RANGE_END: &str = "<<<PRETTIER_RANGE_END>>>";
const BOM: &str = "\u{FEFF}";

enum Expected {
    Output(String),
    /// The parsers that reject the input. Empty: the only one there is.
    Error(Vec<String>),
}

/// A fixture with a set of options.
struct Case {
    /// `arrow.js`, `snippet: #0`
    name: String,
    /// `name: value`, without `parsers`.
    options: Vec<(String, String)>,
    /// The first is the one that the snapshot is made with.
    parsers: Vec<String>,
    input: String,
    expected: Expected,
}

/// What `` ` `` quotes in a snapshot file.
fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.extend(chars.next()),
            c => out.push(c),
        }
    }
    out
}

/// `====title====`, 80 wide.
fn is_separator(line: &str, title: &str) -> bool {
    line.len() == 80 && line.trim_matches('=') == title && line.starts_with('=') && line.ends_with('=')
}

/// The text that a code frame shows: `> 1 | text`, with lines of `^` in between.
fn text_of_code_frame(frame: &str) -> String {
    let mut lines = Vec::new();
    for line in frame.lines() {
        let Some((gutter, text)) = line.split_once('|') else {
            continue;
        };
        if gutter.contains(|c: char| c.is_ascii_digit()) {
            lines.push(text.strip_prefix(' ').unwrap_or(text));
        }
    }
    lines.join("\n")
}

/// The sections of a snapshot: the options, the input and the output.
fn sections(body: &str) -> Option<(String, String, String)> {
    // With a range, the input is a code frame, and the rest is moved to the right to line up
    // with it: `    : text`.
    let first = body.lines().next()?;
    let offset = match first.trim_start().strip_prefix(':') {
        Some(_) => first.find(':')? + 1,
        None => 0,
    };
    let without_offset = |line: &'_ str| -> Option<String> {
        if offset == 0 {
            return Some(line.to_owned());
        }
        let rest = line.get(offset..).filter(|_| line.get(..offset).is_some_and(|it| it.trim_start() == ":"))?;
        Some(rest.strip_prefix(' ').unwrap_or(rest).to_owned())
    };

    let (mut options, mut input, mut output) = (Vec::new(), Vec::new(), Vec::new());
    let mut section = 0;
    for line in body.split('\n') {
        let plain = without_offset(line);
        let title = ["options", "input", "output", ""].get(section).copied()?;
        if plain.as_deref().is_some_and(|it| is_separator(it, title)) {
            section += 1;
            if section == 4 {
                break;
            }
            continue;
        }
        match section {
            1 => options.push(plain?),
            2 => input.push(line.to_owned()),
            3 => output.push(plain?),
            _ => return None,
        }
    }
    if section != 4 {
        return None;
    }
    let input = input.join("\n");
    let input = if offset == 0 { input } else { text_of_code_frame(&input) };
    Some((options.join("\n"), input, output.join("\n")))
}

fn parse_snapshots(text: &str) -> Vec<Case> {
    // By the title without what is after the options.
    let mut cases: BTreeMap<String, Case> = BTreeMap::new();
    for entry in text.split("\nexports[`").skip(1) {
        let Some((title, body)) = entry.split_once("`] = `\n") else {
            continue;
        };
        let Some(body) = body.rsplit_once("\n`;").map(|it| it.0) else {
            continue;
        };
        // The number tells apart what has the same title: the same options with other parsers.
        let Some((title, number)) = title.rsplit_once(' ') else {
            continue;
        };
        // `format`, or `format[acorn]` for a parser that rejects what the first one takes.
        let Some((title, kind)) = title.rsplit_once(' ') else {
            continue;
        };
        let key = &format!("{title} {number}");
        let Some(parser) = kind.strip_prefix("format") else {
            continue;
        };
        let parser = parser.trim_matches(['[', ']']);
        let name = unescape(title.split_once(" - {").map_or(title, |it| it.0));
        let body = unescape(body);

        let Some((options_text, input, output)) = sections(&body) else {
            let case = cases.entry(key.to_owned()).or_insert_with(|| Case {
                name,
                options: Vec::new(),
                parsers: Vec::new(),
                input: String::new(),
                expected: Expected::Error(Vec::new()),
            });
            if let (Expected::Error(parsers), false) = (&mut case.expected, parser.is_empty()) {
                parsers.push(parser.to_owned());
            }
            continue;
        };
        let mut case = Case {
            name,
            options: Vec::new(),
            parsers: Vec::new(),
            input,
            expected: Expected::Output(output),
        };
        for line in options_text.lines() {
            let line = line.trim().trim_start_matches('|').trim_end_matches('|').trim();
            let Some((name, value)) = line.split_once(": ") else {
                continue;
            };
            match name {
                "parsers" => {
                    let names = value.trim_matches(['[', ']']).split(", ");
                    case.parsers = names.map(|it| it.trim_matches('"').to_owned()).collect();
                }
                _ => case.options.push((name.to_owned(), value.trim_end_matches(" (default)").trim_matches('"').to_owned())),
            }
        }
        cases.insert(key.to_owned(), case);
    }
    cases.into_values().collect()
}

/// Takes the placeholders out of `original`. Where they were goes into the options, in UTF-16 code
/// units.
fn replace_placeholders(original: &str, options: &mut FormatOptions) -> String {
    let placeholders = [("cursorOffset", CURSOR), ("rangeStart", RANGE_START), ("rangeEnd", RANGE_END)];
    let mut found: Vec<_> = placeholders.iter().filter_map(|it| Some((original.find(it.1)?, it.0, it.1))).collect();
    found.sort_unstable();
    let mut text = String::with_capacity(original.len());
    let mut end_of_previous = 0;
    for (at, name, placeholder) in found {
        text.push_str(&original[end_of_previous..at]);
        end_of_previous = at + placeholder.len();
        let _ = options.set(name.as_bytes(), text.encode_utf16().count().to_string().as_bytes());
    }
    text.push_str(&original[end_of_previous..]);
    text
}

/// Where the inputs and the snapshots are.
enum Fixtures {
    Directory(PathBuf),
    /// By the path from `tests/format`. In the file they are one after the other:
    /// `=== /<path> <length in bytes>\n`, the bytes, `\n`.
    Bundle(BTreeMap<String, Vec<u8>>),
}

impl Fixtures {
    fn open(path: &Path) -> Fixtures {
        if path.is_dir() {
            return Fixtures::Directory(path.to_owned());
        }
        let bytes = std::fs::read(path).expect("the fixtures");
        let mut files = BTreeMap::new();
        let mut rest = &bytes[..];
        while let Some(end) = rest.iter().position(|&byte| byte == b'\n') {
            let header = crate::text(&rest[..end]);
            let parts = header.strip_prefix("=== /").and_then(|it| it.rsplit_once(' '));
            let Some((name, Ok(length))) = parts.map(|it| (it.0, it.1.parse::<usize>())) else {
                break;
            };
            let Some(content) = rest.get(end + 1..end + 1 + length) else {
                break;
            };
            files.insert(name.to_owned(), content.to_vec());
            rest = rest.get(end + 1 + length + 1..).unwrap_or_default();
        }
        Fixtures::Bundle(files)
    }

    /// The paths of the snapshot files below `language`, in order.
    fn snapshot_files(&self, language: &str) -> Vec<String> {
        fn visit(root: &Path, directory: &Path, found: &mut Vec<String>) {
            for entry in std::fs::read_dir(directory).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    visit(root, &path, found);
                } else if path.file_name().is_some_and(|it| it == "format.test.js.snap") {
                    found.push(path.strip_prefix(root).unwrap_or(&path).to_string_lossy().into_owned());
                }
            }
        }
        let mut found = Vec::new();
        match self {
            Fixtures::Directory(root) => visit(root, &root.join(language), &mut found),
            Fixtures::Bundle(files) => {
                let is_wanted = |it: &&String| it.starts_with(&format!("{language}/")) && it.ends_with("/format.test.js.snap");
                found.extend(files.keys().filter(is_wanted).cloned());
            }
        }
        found.sort();
        found
    }

    /// `None` if there is no such file, or if it is not UTF-8.
    fn read(&self, path: &str) -> Option<String> {
        match self {
            Fixtures::Directory(root) => std::fs::read_to_string(root.join(path)).ok(),
            Fixtures::Bundle(files) => String::from_utf8(files.get(path)?.clone()).ok(),
        }
    }
}

/// `<LF>`, `<CRLF>` and `<CR>` at the ends of the lines, the way the snapshots show them.
fn visualize_end_of_line(text: &str) -> String {
    text.replace("\r\n", "<CRLF>\u{0}").replace('\r', "<CR>\u{0}").replace('\n', "<LF>\n").replace('\u{0}', "\n")
}

#[derive(Default, Clone, Copy)]
struct Count {
    passed: usize,
    total: usize,
}

impl Count {
    fn add(&mut self, passed: bool) {
        self.passed += usize::from(passed);
        self.total += 1;
    }

    fn merge(&mut self, other: Count) {
        self.passed += other.passed;
        self.total += other.total;
    }
}

impl std::fmt::Display for Count {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.passed, self.total)
    }
}

#[derive(Default, Clone, Copy)]
struct Tally {
    /// The output is that of the snapshot.
    format: Count,
    /// Of those that are not: the parser reports a syntax error.
    syntax_errors: usize,
    panics: usize,
    /// The input is rejected, as it should be.
    errors: Count,
    second_format: Count,
    crlf: Count,
    cr: Count,
    bom: Count,
}

impl Tally {
    fn merge(&mut self, other: Tally) {
        self.format.merge(other.format);
        self.syntax_errors += other.syntax_errors;
        self.panics += other.panics;
        self.errors.merge(other.errors);
        self.second_format.merge(other.second_format);
        self.crlf.merge(other.crlf);
        self.cr.merge(other.cr);
        self.bom.merge(other.bom);
    }

    fn all(self) -> Count {
        let mut all = Count::default();
        [self.format, self.errors, self.second_format, self.crlf, self.cr, self.bom].into_iter().for_each(|it| all.merge(it));
        all
    }
}

/// The parser of Prettier that a file with this name is read by.
fn parser_of(name: &str, language: &str) -> &'static str {
    match name.rsplit_once('.').map_or("", |it| it.1) {
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "babel",
        _ if language == "typescript" => "typescript",
        _ => "babel",
    }
}

pub(super) fn run(args: &Args) {
    let fixtures = Fixtures::open(Path::new(args.positional.first().expect("the path of the fixtures")));
    let filter = args.flag("filter");
    let report = args.flag("report").map(PathBuf::from);
    let is_verbose = args.flag("verbose").is_some();
    let languages = args.flag("languages").unwrap_or("js,jsx,typescript,json,misc");
    // The message of a panic would be printed for each.
    std::panic::set_hook(Box::new(|_| {}));

    let mut by_directory: BTreeMap<String, Tally> = BTreeMap::new();
    let mut excluded: BTreeMap<&str, usize> = BTreeMap::new();
    let mut failures = String::new();
    let mut fail = |kind: &str, id: &str, described: &str| {
        let _ = writeln!(failures, "- {kind}: {id}{described}");
        if is_verbose {
            println!("{kind}: {id}{described}");
        }
    };

    for language in languages.split(',') {
        for snapshot_file in fixtures.snapshot_files(language) {
            let Some(relative) = snapshot_file.strip_suffix("/__snapshots__/format.test.js.snap") else {
                continue;
            };
            let text = fixtures.read(&snapshot_file).unwrap_or_default();
            // `js/arrows`, whatever is below it.
            let group = relative.split('/').take(2).collect::<Vec<_>>().join("/");

            for case in parse_snapshots(&text) {
                let id = format!("{relative}/{}", case.name);
                if filter.is_some_and(|it| !id.contains(it)) {
                    continue;
                }
                let ours = parser_of(&case.name, language);
                // Another language.
                let is_json = case.parsers.first().is_some_and(|it| it.starts_with("json") || matches!(it.as_str(), "css" | "less" | "scss"));
                let is_ours = |it: &String| matches!(it.as_str(), "babel" | "typescript" | "flow" | "babel-ts" | "babel-flow" | "acorn" | "espree" | "meriyah" | "oxc" | "oxc-ts");
                if !case.parsers.is_empty() && !is_json && !case.parsers.iter().any(is_ours) {
                    continue;
                }
                if let Some(&(_, reason)) = EXCLUDED.iter().find(|it| id.contains(it.0)) {
                    *excluded.entry(reason).or_default() += 1;
                    continue;
                }
                let tally = by_directory.entry(group.clone()).or_default();

                let mut options = FormatOptions::default();
                if let (true, Some(parser)) = (is_json, case.parsers.first()) {
                    let _ = options.set(b"parser", parser.as_bytes());
                }
                let described = case.options.iter().filter(|it| it.0 != "printWidth" || it.1 != "80");
                let described = described.map(|(name, value)| format!(" {name}={value}")).collect::<String>();
                let unknown = case.options.iter().find(|(name, value)| options.set(name.as_bytes(), value.as_bytes()).is_err());
                if let Some((name, _)) = unknown {
                    tally.format.add(false);
                    fail(&format!("unknown option {name}"), &id, &described);
                    continue;
                }

                // The file has what the snapshot cannot show: line endings, a byte order mark.
                let on_disk = fixtures.read(&id);
                let is_on_disk = on_disk.is_some();
                let (path, original) = match on_disk {
                    Some(input) => (id.clone(), input),
                    None => {
                        // `snippet: test.cjs`: the name that the test gives the text. It is parsed
                        // as the parser of the test says.
                        let name = case.name.strip_prefix("snippet: ").filter(|it| it.contains('.'));
                        let _ = options.set(b"filepath", name.unwrap_or_default().as_bytes());
                        let extension = match language {
                            _ if is_json => case.parsers.first().map_or("json", |it| if it.starts_with("json") { "json" } else { it.as_str() }),
                            "typescript" => "ts",
                            "jsx" => "jsx",
                            _ if case.parsers.first().is_some_and(|it| it == "typescript" || it == "babel-ts") => "ts",
                            _ => "js",
                        };
                        (format!("snippet.{extension}"), case.input.clone())
                    }
                };
                // Of a snippet with a range, the snapshot does not have the text with the placeholders.
                let has_placeholders = options.range_start.is_none() && options.range_end.is_none() || original.contains(RANGE_START) || original.contains(RANGE_END);
                let input = replace_placeholders(&original, &mut options.clone());
                let format = |original: &str| {
                    let mut options = options.clone();
                    let input = replace_placeholders(original, &mut options);
                    format_text_or_panic(&path, input.as_bytes(), &options).map(|it| crate::text(&it))
                };

                let expected = match case.expected {
                    Expected::Output(expected) => expected,
                    Expected::Error(parsers) => {
                        // A snippet that is rejected is not in the snapshot.
                        if (parsers.is_empty() || parsers.iter().any(|it| it == ours)) && is_on_disk {
                            let is_rejected = format(&original).is_err_and(|it| it == "SyntaxError");
                            tally.errors.add(is_rejected);
                            if !is_rejected {
                                fail("not rejected", &id, &described);
                            }
                        }
                        continue;
                    }
                };

                let is_visualized = case.options.iter().any(|it| it.0 == "endOfLine");
                let shown = |text: String| if is_visualized { visualize_end_of_line(&text) } else { text };
                let output = format(&original);
                let actual = match &output {
                    Ok(actual) => shown(actual.clone()),
                    Err(error) => {
                        tally.syntax_errors += usize::from(error == "SyntaxError");
                        tally.panics += usize::from(error == "panic");
                        format!("<{error}>")
                    }
                };
                tally.format.add(actual == expected);
                if actual != expected {
                    fail(if output.is_ok() { "format" } else { &actual }, &id, &described);
                    if let Some(report) = &report {
                        let file = id.replace(['/', ' ', ':', '#'], "_") + &described.replace([' ', '='], "_");
                        let _ = std::fs::create_dir_all(report);
                        let _ = std::fs::write(report.join(format!("{file}.expected")), &expected);
                        let _ = std::fs::write(report.join(format!("{file}.actual")), &actual);
                        let _ = std::fs::write(report.join(format!("{file}.input")), &input);
                    }
                    continue;
                }
                let Ok(output) = output else {
                    continue;
                };

                let has_position = options.range_start.is_some() || options.range_end.is_some() || options.cursor_offset.is_some();
                if !has_position && output != input && !UNSTABLE.iter().any(|it| id == *it) {
                    let is_stable = format(&output).is_ok_and(|it| it == output);
                    tally.second_format.add(is_stable);
                    if !is_stable {
                        fail("second format", &id, &described);
                    }
                }
                if !has_placeholders {
                    continue;
                }
                let is_left_alone = options.require_pragma
                    || options.check_ignore_pragma
                    || matches!((options.range_start, options.range_end), (Some(start), Some(end)) if start >= end);
                let skips_end_of_line = input.trim().is_empty() || input.contains('\r') || is_left_alone;
                let ends_of_line = [("\r\n", &mut tally.crlf, "CRLF"), ("\r", &mut tally.cr, "CR")];
                for (end_of_line, count, kind) in ends_of_line.into_iter().filter(|_| !skips_end_of_line) {
                    let expected = match options.line_ending {
                        bun_format::options::LineEnding::Auto => output.replace('\n', end_of_line),
                        _ => output.clone(),
                    };
                    let is_same = format(&original.replace('\n', end_of_line)).is_ok_and(|it| it == expected);
                    count.add(is_same);
                    if !is_same {
                        fail(kind, &id, &described);
                    }
                }
                if !input.starts_with(BOM) {
                    let is_same = format(&format!("{BOM}{original}")).is_ok_and(|it| it.strip_prefix(BOM) == Some(&output));
                    tally.bom.add(is_same);
                    if !is_same {
                        fail("BOM", &id, &described);
                    }
                }
            }
        }
    }

    let mut summary = String::new();
    let _ = writeln!(summary, "# Prettier's tests\n");
    let _ = writeln!(summary, "| directory | format | of the rest: syntax errors | panics | rejected | second format | CRLF | CR | BOM |");
    let _ = writeln!(summary, "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    let row = |name: &str, it: &Tally| {
        format!(
            "| {name} | {} | {} | {} | {} | {} | {} | {} | {} |",
            it.format, it.syntax_errors, it.panics, it.errors, it.second_format, it.crlf, it.cr, it.bom
        )
    };
    let mut by_language: BTreeMap<&str, Tally> = BTreeMap::new();
    for (directory, tally) in &by_directory {
        by_language.entry(directory.split('/').next().unwrap_or_default()).or_default().merge(*tally);
        let _ = writeln!(summary, "{}", row(directory, tally));
    }
    let mut totals = String::new();
    let mut everything = Tally::default();
    for (language, tally) in &by_language {
        everything.merge(*tally);
        let _ = writeln!(
            totals,
            "{language}: format {} ({} syntax errors, {} panics), rejected {}, second format {}, CRLF {}, CR {}, BOM {}",
            tally.format, tally.syntax_errors, tally.panics, tally.errors, tally.second_format, tally.crlf, tally.cr, tally.bom
        );
    }
    let percent = |it: Count| 100.0 * it.passed as f64 / it.total.max(1) as f64;
    let _ = writeln!(totals, "format: {} ({:.2}%)", everything.format, percent(everything.format));
    let _ = writeln!(totals, "all checks: {} ({:.2}%)", everything.all(), percent(everything.all()));
    for (reason, count) in &excluded {
        let _ = writeln!(totals, "not run: {count}: {reason}");
    }
    if let Some(report) = &report {
        let _ = std::fs::create_dir_all(report);
        let _ = std::fs::write(report.join("summary.md"), format!("{summary}\n{totals}\n## Failures\n\n{failures}"));
    }
    if filter.is_none() && !is_verbose {
        println!("{summary}");
    }
    print!("{totals}");
}
