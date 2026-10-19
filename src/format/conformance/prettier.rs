//! Prettier's own tests.
//!
//! For every fixture and every set of options, Prettier's test runner (`tests/config/format-test/run-test.js`) checks
//! that
//! - the output matches a snapshot, or the parser rejects the input,
//! - formatting the output again changes nothing,
//! - the output is the same when the input's lines end with CRLF or CR,
//! - a byte order mark before the input is kept and changes nothing else.
//!
//! This runs the same checks. Syntax error messages aren't compared.

use crate::{Bundle, Count, Failure, Flags, Format, output_line, show_cursor};
use bstr::BStr;
use bun_core::strings;
use bun_format::FormatOptions;
use std::collections::BTreeMap;

const PROPOSAL: &str = "syntax of a proposal at stage 2 or below, which only Babel parses";
const BABEL_TS: &str =
    "an input that Prettier's `typescript` parser rejects: the snapshot is made with `babel-ts`";
const ONLY_BABEL_TS_REJECTS: &str = "an input that only `babel-ts` rejects: Prettier's `typescript` parser accepts it, and the output is the same";
const HTML_LIKE_COMMENT: &str = "`babel` rejects HTML-like comments, but the snapshots of js/comments/html-like and of jsx/jsx-test-suite, made with `acorn`, have them formatted";
const PLUGIN: &str = "formatted by a plugin of Prettier";
const CHANGES_A_VALUE: &str = "Prettier's output is another value: it drops the blanks at the end of a block scalar (prettier#19764)";

/// Skipped cases and why. A case is skipped if its path contains the text.
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
    ("typescript/definite/definite.ts", BABEL_TS),
    ("typescript/definite/without-annotation.ts", BABEL_TS),
    ("misc/front-matter/with-plugins", PLUGIN),
    ("handlebars/front-matter/toml", PLUGIN),
    ("misc/plugins/embed-async-printer", PLUGIN),
    ("vue/with-plugins", PLUGIN),
    ("js/_errors_/html-like-comments.js", HTML_LIKE_COMMENT),
    (
        "jsx/jsx-test-suite/rejected-snippets/0/0006-e58e.jsx",
        HTML_LIKE_COMMENT,
    ),
    (
        "jsx/jsx-test-suite/rejected-snippets/1/0006-e58e.jsx",
        HTML_LIKE_COMMENT,
    ),
    (
        "typescript/_errors_/babel-ts2/multiline-declaration-abstract-class.ts",
        ONLY_BABEL_TS_REJECTS,
    ),
    (
        "typescript/_errors_/babel-ts2/multiline-declaration-interface.ts",
        ONLY_BABEL_TS_REJECTS,
    ),
    (
        "typescript/_errors_/babel-ts2/multiline-declaration-module.ts",
        ONLY_BABEL_TS_REJECTS,
    ),
    (
        "typescript/_errors_/babel-ts2/parenthesized-decorators-tagged-template.ts",
        ONLY_BABEL_TS_REJECTS,
    ),
    ("yaml/block-folded/block-folded-strip.yml", CHANGES_A_VALUE),
];

/// Not idempotent in Prettier either: `unstableTests` in `tests/config/format-test/failed-format-tests.js`.
const UNSTABLE: &[&str] = &[
    "flow/hook/declare-hook.js",
    "flow/hook/hook-type-annotation.js",
    "flow/comments/type_annotations.js",
    "js/ignore/semi/class-expression-decorator.js",
    "js/ignore/semi/head-ignored.js",
    "js/comments/return-statement.js",
    "js/comments/tagged-template-literal.js",
    "js/multiparser-markdown/codeblock.js",
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

const CURSOR: &[u8] = b"<|>";
const RANGE_START: &[u8] = b"<<<PRETTIER_RANGE_START>>>";
const RANGE_END: &[u8] = b"<<<PRETTIER_RANGE_END>>>";
const BOM: &[u8] = b"\xEF\xBB\xBF";
const SNAPSHOT: &[u8] = b"/__snapshots__/format.test.js.snap";

enum Expected {
    Output(Vec<u8>),
    /// The parsers that reject the input. Empty if the test has only one parser.
    Error(Vec<Vec<u8>>),
}

/// One fixture with one set of options.
struct Case {
    /// `arrow.js`, `snippet: #0`
    name: Vec<u8>,
    /// `name: value` pairs, without `parsers`.
    options: Vec<(Vec<u8>, Vec<u8>)>,
    /// The snapshot is made with the first one.
    parsers: Vec<Vec<u8>>,
    input: Vec<u8>,
    expected: Expected,
    /// Parsers that reject the input even though the snapshot has an output for it.
    rejected_by: Vec<Vec<u8>>,
}

/// Unescapes the contents of a template literal in a snapshot file.
fn unescape(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut bytes = text.iter().copied();
    while let Some(byte) = bytes.next() {
        match byte {
            b'\\' => out.extend(bytes.next()),
            byte => out.push(byte),
        }
    }
    out
}

/// Matches `====title====`, 80 columns wide.
fn is_separator(line: &[u8], title: &[u8]) -> bool {
    line.len() == 80
        && line.starts_with(b"=")
        && line.ends_with(b"=")
        && strings::trim(line, b"=") == title
}

/// Extracts the source text from a code frame: `> 1 | text` lines, with `^` marker lines in between.
fn text_of_code_frame(frame: &[&[u8]]) -> Vec<u8> {
    let lines = frame.iter().filter_map(|line| {
        let (gutter, text) = strings::split_once_char(line, b'|')?;
        gutter
            .iter()
            .any(u8::is_ascii_digit)
            .then(|| text.strip_prefix(b" ").unwrap_or(text))
    });
    lines.collect::<Vec<_>>().join(&b"\n"[..])
}

/// Splits a snapshot into its options, input and output sections.
fn sections(body: &[u8]) -> Option<(Vec<Vec<u8>>, Vec<u8>, Vec<u8>)> {
    // With a range, the input is a code frame, and every other line is shifted right to line up with it: `    : text`.
    let first = strings::split(body, b"\n").next()?;
    let offset = match first.trim_ascii_start().starts_with(b":") {
        true => strings::index_of_char_usize(first, b':')? + 1,
        false => 0,
    };
    let without_offset = |line: &[u8]| -> Option<Vec<u8>> {
        if offset == 0 {
            return Some(line.to_vec());
        }
        let rest = line.get(offset..).filter(|_| {
            line.get(..offset)
                .is_some_and(|it| it.trim_ascii_start() == b":")
        })?;
        Some(rest.strip_prefix(b" ").unwrap_or(rest).to_vec())
    };

    let (mut options, mut input, mut output) = (Vec::new(), Vec::new(), Vec::new());
    let mut section = 0;
    for line in strings::split(body, b"\n") {
        let plain = without_offset(line);
        let title = [&b"options"[..], b"input", b"output", b""]
            .get(section)
            .copied()?;
        if plain.as_deref().is_some_and(|it| is_separator(it, title)) {
            section += 1;
            if section == 4 {
                break;
            }
            continue;
        }
        match section {
            1 => options.push(plain?),
            2 => input.push(line),
            3 => output.push(plain?),
            _ => return None,
        }
    }
    if section != 4 {
        return None;
    }
    let input = if offset == 0 {
        input.join(&b"\n"[..])
    } else {
        text_of_code_frame(&input)
    };
    Some((options, input, output.join(&b"\n"[..])))
}

fn parse_snapshots(text: &[u8]) -> Vec<Case> {
    // Keyed by the title up to the end of the options, plus the number.
    let mut cases: BTreeMap<Vec<u8>, Case> = BTreeMap::new();
    for entry in strings::split(text, b"\nexports[`").skip(1) {
        let Some((title, body)) = strings::split_once(entry, b"`] = `\n") else {
            continue;
        };
        let Some((body, _)) = strings::rsplit_once(body, b"\n`;") else {
            continue;
        };
        // The number distinguishes entries with the same title: the same options with other parsers.
        let Some((title, number)) = strings::rsplit_once_char(title, b' ') else {
            continue;
        };
        // `format`, or `format[acorn]` for a parser that rejects input the first parser accepts.
        let Some((title, kind)) = strings::rsplit_once_char(title, b' ') else {
            continue;
        };
        let Some(parser) = kind.strip_prefix(b"format") else {
            continue;
        };
        let key = [title, b" ", number].concat();
        let parser = strings::trim(parser, b"[]");
        let name = unescape(strings::split_once(title, b" - {").map_or(title, |it| it.0));
        let body = unescape(body);

        let Some((option_lines, input, output)) = sections(&body) else {
            let case = cases.entry(key).or_insert_with(|| Case {
                name,
                options: Vec::new(),
                parsers: Vec::new(),
                input: Vec::new(),
                expected: Expected::Error(Vec::new()),
                rejected_by: Vec::new(),
            });
            match &mut case.expected {
                _ if parser.is_empty() => {}
                Expected::Error(parsers) => parsers.push(parser.to_vec()),
                Expected::Output(_) => case.rejected_by.push(parser.to_vec()),
            }
            continue;
        };
        let mut case = Case {
            name,
            options: Vec::new(),
            parsers: Vec::new(),
            input,
            expected: Expected::Output(output),
            rejected_by: match cases.remove(&key) {
                Some(Case {
                    expected: Expected::Error(parsers),
                    ..
                }) => parsers,
                _ => Vec::new(),
            },
        };
        for line in &option_lines {
            let Some((name, value)) = strings::split_once(strings::trim(line, b" |"), b": ") else {
                continue;
            };
            if name == b"parsers" {
                // `[]` means the parser is inferred from the file name.
                let names =
                    strings::split(strings::trim(value, b"[]"), b", ").filter(|it| !it.is_empty());
                case.parsers = names.map(|it| strings::trim(it, b"\"").to_vec()).collect();
            } else {
                let value = value.strip_suffix(b" (default)").unwrap_or(value);
                case.options
                    .push((name.to_vec(), strings::trim(value, b"\"").to_vec()));
            }
        }
        cases.insert(key, case);
    }
    cases.into_values().collect()
}

/// Removes the placeholders from `original` and stores their offsets, in UTF-16 code units, in the options.
fn replace_placeholders(original: &[u8], options: &mut FormatOptions) -> Vec<u8> {
    let placeholders = [
        (&b"cursorOffset"[..], CURSOR),
        (b"rangeStart", RANGE_START),
        (b"rangeEnd", RANGE_END),
    ];
    let mut found: Vec<_> = placeholders
        .iter()
        .filter_map(|it| Some((strings::index_of(original, it.1)?, it.0, it.1)))
        .collect();
    bun_format::sort::sort(&mut found[..]);
    let mut text = Vec::with_capacity(original.len());
    let mut end_of_previous = 0;
    for (at, name, placeholder) in found {
        text.extend_from_slice(&original[end_of_previous..at]);
        end_of_previous = at + placeholder.len();
        let _ = options.set(
            name,
            strings::element_length_utf8_into_utf16(&text)
                .to_string()
                .as_bytes(),
        );
    }
    text.extend_from_slice(&original[end_of_previous..]);
    text
}

/// Shows line endings as `<LF>`, `<CRLF>` and `<CR>`, like the snapshots.
fn visualize_end_of_line(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2);
    let mut rest = text;
    while let Some(at) = strings::index_of_any(rest, b"\r\n") {
        out.extend_from_slice(&rest[..at]);
        let (marker, len) = match &rest[at..] {
            [b'\r', b'\n', ..] => (&b"<CRLF>\n"[..], 2),
            [b'\r', ..] => (&b"<CR>\n"[..], 1),
            _ => (&b"<LF>\n"[..], 1),
        };
        out.extend_from_slice(marker);
        rest = &rest[at + len..];
    }
    out.extend_from_slice(rest);
    out
}

#[derive(Default)]
struct Tally {
    /// The output matches the snapshot.
    format: Count,
    /// How many of the mismatches are syntax errors from our parser.
    syntax_errors: usize,
    /// The input is rejected as expected.
    errors: Count,
    second_format: Count,
    crlf: Count,
    cr: Count,
    bom: Count,
}

impl Tally {
    fn merge(&mut self, other: &Tally) {
        self.format.merge(other.format);
        self.syntax_errors += other.syntax_errors;
        self.errors.merge(other.errors);
        self.second_format.merge(other.second_format);
        self.crlf.merge(other.crlf);
        self.cr.merge(other.cr);
        self.bom.merge(other.bom);
    }

    fn all(&self) -> Count {
        let mut all = Count::default();
        [
            self.format,
            self.errors,
            self.second_format,
            self.crlf,
            self.cr,
            self.bom,
        ]
        .into_iter()
        .for_each(|it| all.merge(it));
        all
    }
}

/// Returns the Prettier parser inferred from the file name.
fn parser_of(name: &[u8], language: &[u8]) -> &'static [u8] {
    match strings::rsplit_once_char(name, b'.').map_or(&b""[..], |it| it.1) {
        b"ts" | b"tsx" | b"mts" | b"cts" => b"typescript",
        b"js" | b"jsx" | b"mjs" | b"cjs" => b"babel",
        _ if language == b"typescript" => b"typescript",
        _ => b"babel",
    }
}

/// Returns the parser used for a whole directory, regardless of file names.
fn parser_of_directory(language: &[u8]) -> Option<&'static [u8]> {
    match language {
        b"html" => Some(b"html"),
        b"vue" => Some(b"vue"),
        b"angular" => Some(b"angular"),
        b"lwc" => Some(b"lwc"),
        b"mjml" => Some(b"mjml"),
        b"handlebars" => Some(b"glimmer"),
        b"flow" => Some(b"flow"),
        _ => None,
    }
}

fn is_javascript_parser(name: &[u8]) -> bool {
    matches!(
        name,
        b"babel"
            | b"typescript"
            | b"flow"
            | b"babel-ts"
            | b"babel-flow"
            | b"acorn"
            | b"espree"
            | b"meriyah"
            | b"oxc"
            | b"oxc-ts"
    )
}

/// Prints `FAIL <check> <case> <options>` for each failed check, then the pass count per kind of check and the number
/// of skipped cases per reason.
pub fn run(bundle: &Bundle<'_>, flags: &Flags<'_>, format: Format<'_>) {
    let languages = flags.languages.unwrap_or(
        b"js,jsx,typescript,flow,json,css,less,scss,graphql,yaml,markdown,mdx,handlebars,html,vue,angular,lwc,mjml,misc",
    );
    let mut by_directory: BTreeMap<Vec<u8>, Tally> = BTreeMap::new();
    let mut excluded: BTreeMap<&str, usize> = BTreeMap::new();
    let fail = |kind: &str, id: &[u8], described: &[u8]| {
        output_line!("FAIL {kind} {}{}", BStr::new(id), BStr::new(described))
    };
    let mut index = 0;

    for language in strings::split(languages, b",") {
        let prefix = [language, b"/"].concat();
        for snapshot_file in bundle
            .paths()
            .filter(|it| it.starts_with(&prefix) && it.ends_with(SNAPSHOT))
        {
            let relative = &snapshot_file[..snapshot_file.len() - SNAPSHOT.len()];
            // `js/arrows`, for any depth below it.
            let group = strings::split(relative, b"/")
                .take(2)
                .collect::<Vec<_>>()
                .join(&b"/"[..]);

            let filenames = bundle
                .read(&[relative, b"/snippet-filenames.txt"].concat())
                .unwrap_or_default();

            for case in parse_snapshots(bundle.read(snapshot_file).unwrap_or_default()) {
                let id = [relative, b"/", &case.name].concat();
                if !flags.matches_filter(&id) {
                    continue;
                }
                // For these parsers (JSON, style sheets, markup) the test's parser is used instead of one inferred from
                // the file name.
                let is_explicit_parser = |it: &&[u8]| {
                    it.starts_with(b"json")
                        || matches!(
                            *it,
                            b"css"
                                | b"less"
                                | b"scss"
                                | b"graphql"
                                | b"yaml"
                                | b"markdown"
                                | b"mdx"
                                | b"glimmer"
                                | b"html"
                                | b"vue"
                                | b"angular"
                                | b"lwc"
                                | b"mjml"
                                | b"__ng_interpolation"
                        )
                };
                let first_parser = case.parsers.first().map(Vec::as_slice);
                // A rejected case's title mentions the rejecting parser, if any.
                let rejecting_parser = match &case.expected {
                    Expected::Error(parsers) => parsers
                        .iter()
                        .map(Vec::as_slice)
                        .find(is_explicit_parser)
                        .or_else(|| parser_of_directory(language)),
                    Expected::Output(_) => None,
                };
                let explicit_parser = first_parser.filter(is_explicit_parser).or(rejecting_parser);
                let ours = explicit_parser.unwrap_or_else(|| parser_of(&case.name, language));
                if !case.parsers.is_empty()
                    && explicit_parser.is_none()
                    && !case.parsers.iter().any(|it| is_javascript_parser(it))
                {
                    *excluded.entry(PLUGIN).or_default() += 1;
                    continue;
                }
                // With `embeddedLanguageFormatting: off`, a plugin for embedded code never runs, so the case isn't
                // skipped.
                let is_embedded_formatting_off = case
                    .options
                    .iter()
                    .any(|it| it.0 == b"embeddedLanguageFormatting" && it.1 == b"off");
                if let Some(&(_, reason)) = EXCLUDED
                    .iter()
                    .filter(|it| it.1 != PLUGIN || !is_embedded_formatting_off)
                    .find(|it| strings::contains(&id, it.0.as_bytes()))
                {
                    *excluded.entry(reason).or_default() += 1;
                    continue;
                }
                index += 1;
                if (index - 1) % flags.every != flags.first % flags.every {
                    continue;
                }
                let tally = by_directory.entry(group.clone()).or_default();

                // `bun fmt` doesn't format HTML in templates and code blocks by default yet, but these tests expect it.
                let mut options = FormatOptions {
                    embedded_html: true,
                    ..FormatOptions::default()
                };
                if let Some(parser) = explicit_parser {
                    let _ = options.set(b"parser", parser);
                } else if !case.parsers.is_empty()
                    && (case.rejected_by.iter().any(|it| it == ours)
                        || !case.parsers.iter().any(|it| it == ours))
                {
                    // The output comes from another parser, which accepts what `babel` doesn't: types in a `.js` file.
                    if let Some(other) = case
                        .parsers
                        .iter()
                        .find(|it| !case.rejected_by.contains(it))
                    {
                        let _ = options.set(b"parser", other);
                    }
                }
                let mut described = Vec::new();
                for (name, value) in case
                    .options
                    .iter()
                    .filter(|it| it.0 != b"printWidth" || it.1 != b"80")
                {
                    described.extend_from_slice(&[b" ", &name[..], b"=", value].concat());
                }
                if case
                    .options
                    .iter()
                    .any(|(name, value)| options.set(name, value).is_err())
                {
                    tally.format.add(false);
                    fail("unknown-option", &id, &described);
                    continue;
                }

                // Prefer the file to the snapshot's input, which can't show line endings or a byte order mark.
                let on_disk = bundle
                    .read(&id)
                    .filter(|it| std::str::from_utf8(it).is_ok());
                let (path, original) = match on_disk {
                    Some(input) => (id.clone(), input),
                    None => {
                        // The file name that the test passes with the text, recorded by `sync.ts`, or the one in
                        // `snippet: test.cjs`. The test's parser, if it has one, still decides how it's parsed.
                        let title = case.name.strip_prefix(b"snippet: ");
                        let recorded_name = strings::split(filenames, b"\n")
                            .filter_map(|line| strings::split_once(line, b"\t"));
                        let recorded_name = recorded_name
                            .filter(|it| Some(it.0) == title)
                            .map(|it| it.1)
                            .next();
                        let name = recorded_name
                            .or_else(|| title.filter(|it| strings::contains_char(it, b'.')));
                        let _ = options.set(b"filepath", name.unwrap_or_default());
                        let extension: &[u8] = match (explicit_parser, language) {
                            (Some(parser), _) if parser.starts_with(b"json") => b"json",
                            (Some(b"glimmer"), _) => b"hbs",
                            // Prettier gets no file name here, and only a file named `.html` has its doctype
                            // normalized.
                            (Some(b"html" | b"angular" | b"lwc"), _) => b"text",
                            (Some(b"flow"), _) => b"js",
                            (Some(parser), _) => parser,
                            (None, b"typescript") => b"ts",
                            (None, b"jsx") => b"jsx",
                            _ if matches!(first_parser, Some(b"typescript" | b"babel-ts")) => b"ts",
                            _ => b"js",
                        };
                        ([b"snippet.", extension].concat(), &case.input[..])
                    }
                };
                // For a snippet with a range, the snapshot's input doesn't have the placeholders.
                let has_placeholders = options.range_start.is_none() && options.range_end.is_none()
                    || strings::contains(original, RANGE_START)
                    || strings::contains(original, RANGE_END);
                let input = replace_placeholders(original, &mut options.clone());
                let format = |original: &[u8]| {
                    let mut options = options.clone();
                    let input = replace_placeholders(original, &mut options);
                    format(&path, &input, &options).map(|(mut text, cursor)| {
                        show_cursor(&mut text, cursor);
                        text
                    })
                };

                let expected = match &case.expected {
                    Expected::Output(expected) => expected,
                    Expected::Error(parsers) => {
                        // A rejected snippet's text isn't in the snapshot, so `sync.ts` writes it to
                        // `rejected-snippets`.
                        if (parsers.is_empty() || parsers.iter().any(|it| it == ours))
                            && on_disk.is_some()
                        {
                            let is_rejected =
                                format(original).is_err_and(|it| it == Failure::SyntaxError);
                            tally.errors.add(is_rejected);
                            if !is_rejected {
                                fail("rejected", &id, &described);
                            }
                        }
                        continue;
                    }
                };

                let is_visualized = case.options.iter().any(|it| it.0 == b"endOfLine");
                let output = format(original);
                let actual = match &output {
                    Ok(actual) if is_visualized => visualize_end_of_line(actual),
                    Ok(actual) => actual.clone(),
                    Err(Failure::SyntaxError) => b"<SyntaxError>".to_vec(),
                    Err(Failure::Other) => b"<the formatter failed>".to_vec(),
                };
                tally.format.add(actual == *expected);
                let Some(output) = output.ok().filter(|_| actual == *expected) else {
                    tally.syntax_errors += usize::from(actual == b"<SyntaxError>");
                    fail("format", &id, &described);
                    flags.write_report(&[&id[..], &described].concat(), expected, &actual, &input);
                    continue;
                };

                let has_position = options.range_start.is_some()
                    || options.range_end.is_some()
                    || options.cursor_offset.is_some();
                if !has_position
                    && output != input
                    && !UNSTABLE.iter().any(|it| id == it.as_bytes())
                {
                    let is_stable = format(&output).is_ok_and(|it| it == output);
                    tally.second_format.add(is_stable);
                    if !is_stable {
                        fail("second-format", &id, &described);
                    }
                }
                if !has_placeholders {
                    continue;
                }
                let is_returned_unchanged = options.require_pragma
                    || options.check_ignore_pragma
                    || matches!((options.range_start, options.range_end), (Some(start), Some(end)) if start >= end);
                let skips_end_of_line = input.trim_ascii().is_empty()
                    || strings::contains_char(&input, b'\r')
                    || is_returned_unchanged;
                let ends_of_line = [
                    (&b"\r\n"[..], &mut tally.crlf, "CRLF"),
                    (b"\r", &mut tally.cr, "CR"),
                ];
                for (end_of_line, count, kind) in
                    ends_of_line.into_iter().filter(|_| !skips_end_of_line)
                {
                    let expected = match options.line_ending {
                        bun_format::options::LineEnding::Auto => {
                            strings::replace_owned(&output, b"\n", end_of_line)
                        }
                        _ => output.clone(),
                    };
                    let is_same = format(&strings::replace_owned(original, b"\n", end_of_line))
                        .is_ok_and(|it| it == expected);
                    count.add(is_same);
                    if !is_same {
                        fail(kind, &id, &described);
                    }
                }
                if !input.starts_with(BOM) {
                    let is_same = format(&[BOM, original].concat())
                        .is_ok_and(|it| it.strip_prefix(BOM) == Some(&output));
                    tally.bom.add(is_same);
                    if !is_same {
                        fail("BOM", &id, &described);
                    }
                }
            }
        }
    }

    let show = |name: &[u8], it: &Tally| {
        output_line!(
            "{}: format {} ({} syntax errors), rejected {}, second format {}, CRLF {}, CR {}, BOM {}",
            BStr::new(name),
            it.format,
            it.syntax_errors,
            it.errors,
            it.second_format,
            it.crlf,
            it.cr,
            it.bom
        );
    };
    let mut by_language: BTreeMap<&[u8], Tally> = BTreeMap::new();
    for (directory, tally) in &by_directory {
        by_language
            .entry(strings::split(directory, b"/").next().unwrap_or_default())
            .or_default()
            .merge(tally);
        if flags.table {
            show(directory, tally);
        }
    }
    let mut everything = Tally::default();
    for (language, tally) in &by_language {
        everything.merge(tally);
        show(language, tally);
    }
    let percent = |it: Count| 100.0 * it.passed as f64 / it.total.max(1) as f64;
    output_line!(
        "format: {} ({:.2}%)",
        everything.format,
        percent(everything.format)
    );
    output_line!(
        "all checks: {} ({:.2}%)",
        everything.all(),
        percent(everything.all())
    );
    for (reason, count) in &excluded {
        output_line!("not run: {count}: {reason}");
    }
}
