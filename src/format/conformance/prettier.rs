//! Prettier's own tests.
//!
//! For every fixture and every set of options, Prettier's test runner
//! (`tests/config/format-test/run-test.js`) checks
//! - the output against a snapshot, or that the parser rejects the input,
//! - that formatting the output again changes nothing,
//! - that the output is the same if the lines of the input end with CRLF or with CR,
//! - that a byte order mark in front of the input is in front of the output and changes nothing else.
//!
//! So does this. The message of a syntax error is not compared.

use crate::{
    Bundle, Count, Failure, Flags, Format, output_line, show_cursor, trim_bytes, utf16_len,
};
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
];

/// Formatting their output again changes it, in Prettier too: `unstableTests` of
/// `tests/config/format-test/failed-format-tests.js`.
const UNSTABLE: &[&str] = &[
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
    /// The parsers that reject the input. Empty: the only one there is.
    Error(Vec<Vec<u8>>),
}

/// A fixture with a set of options.
struct Case {
    /// `arrow.js`, `snippet: #0`
    name: Vec<u8>,
    /// `name: value`, without `parsers`.
    options: Vec<(Vec<u8>, Vec<u8>)>,
    /// The first is the one that the snapshot is made with.
    parsers: Vec<Vec<u8>>,
    input: Vec<u8>,
    expected: Expected,
    /// The parsers that reject an input of which there is an output.
    rejected_by: Vec<Vec<u8>>,
}

/// What `` ` `` quotes in a snapshot file.
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

/// `====title====`, 80 wide.
fn is_separator(line: &[u8], title: &[u8]) -> bool {
    line.len() == 80
        && line.starts_with(b"=")
        && line.ends_with(b"=")
        && trim_bytes(line, b"=") == title
}

/// The text that a code frame shows: `> 1 | text`, with lines of `^` in between.
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

/// The sections of a snapshot: the options, the input and the output.
fn sections(body: &[u8]) -> Option<(Vec<Vec<u8>>, Vec<u8>, Vec<u8>)> {
    // With a range, the input is a code frame, and the rest is moved to the right to line up
    // with it: `    : text`.
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
    // By the title without what is after the options.
    let mut cases: BTreeMap<Vec<u8>, Case> = BTreeMap::new();
    for entry in strings::split(text, b"\nexports[`").skip(1) {
        let Some((title, body)) = strings::split_once(entry, b"`] = `\n") else {
            continue;
        };
        let Some((body, _)) = strings::rsplit_once(body, b"\n`;") else {
            continue;
        };
        // The number tells apart what has the same title: the same options with other parsers.
        let Some((title, number)) = strings::rsplit_once_char(title, b' ') else {
            continue;
        };
        // `format`, or `format[acorn]` for a parser that rejects what the first one takes.
        let Some((title, kind)) = strings::rsplit_once_char(title, b' ') else {
            continue;
        };
        let Some(parser) = kind.strip_prefix(b"format") else {
            continue;
        };
        let key = [title, b" ", number].concat();
        let parser = trim_bytes(parser, b"[]");
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
            let Some((name, value)) = strings::split_once(trim_bytes(line, b" |"), b": ") else {
                continue;
            };
            if name == b"parsers" {
                // `[]`: it is left to the name of the file.
                let names =
                    strings::split(trim_bytes(value, b"[]"), b", ").filter(|it| !it.is_empty());
                case.parsers = names.map(|it| trim_bytes(it, b"\"").to_vec()).collect();
            } else {
                let value = value.strip_suffix(b" (default)").unwrap_or(value);
                case.options
                    .push((name.to_vec(), trim_bytes(value, b"\"").to_vec()));
            }
        }
        cases.insert(key, case);
    }
    cases.into_values().collect()
}

/// Takes the placeholders out of `original`. Where they were goes into the options, in UTF-16 code
/// units.
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
    found.sort_unstable();
    let mut text = Vec::with_capacity(original.len());
    let mut end_of_previous = 0;
    for (at, name, placeholder) in found {
        text.extend_from_slice(&original[end_of_previous..at]);
        end_of_previous = at + placeholder.len();
        let _ = options.set(name, utf16_len(&text).to_string().as_bytes());
    }
    text.extend_from_slice(&original[end_of_previous..]);
    text
}

/// `<LF>`, `<CRLF>` and `<CR>` at the ends of the lines, the way the snapshots show them.
fn visualize_end_of_line(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2);
    let mut rest = text;
    while let Some(at) = strings::index_of_any(rest, b"\r\n") {
        out.extend_from_slice(&rest[..at]);
        let (shown, len) = match &rest[at..] {
            [b'\r', b'\n', ..] => (&b"<CRLF>\n"[..], 2),
            [b'\r', ..] => (&b"<CR>\n"[..], 1),
            _ => (&b"<LF>\n"[..], 1),
        };
        out.extend_from_slice(shown);
        rest = &rest[at + len..];
    }
    out.extend_from_slice(rest);
    out
}

#[derive(Default)]
struct Tally {
    /// The output is that of the snapshot.
    format: Count,
    /// Of those that are not: the parser reports a syntax error.
    syntax_errors: usize,
    /// The input is rejected, as it should be.
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

/// The parser of Prettier that a file with this name is read by.
fn parser_of(name: &[u8], language: &[u8]) -> &'static [u8] {
    match strings::rsplit_once_char(name, b'.').map_or(&b""[..], |it| it.1) {
        b"ts" | b"tsx" | b"mts" | b"cts" => b"typescript",
        b"js" | b"jsx" | b"mjs" | b"cjs" => b"babel",
        _ if language == b"typescript" => b"typescript",
        _ => b"babel",
    }
}

/// The parser that all of a directory is read by, whatever the names of the files.
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

/// Prints `FAIL <check> <case> <options>` for each check that fails, how many pass of each kind,
/// and how many cases are not run for which reason.
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
            // `js/arrows`, whatever is below it.
            let group = strings::split(relative, b"/")
                .take(2)
                .collect::<Vec<_>>()
                .join(&b"/"[..]);

            let filenames = bundle
                .read(&[relative, b"/snippet-filenames.txt"].concat())
                .unwrap_or_default();

            for case in parse_snapshots(bundle.read(snapshot_file).unwrap_or_default()) {
                let id = [relative, b"/", &case.name].concat();
                if !flags.wants(&id) {
                    continue;
                }
                // JSON or a style sheet: the parser is not left to the name of the file.
                let is_named = |it: &&[u8]| {
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
                // What is rejected says by which parser in its title, or not at all.
                let rejecting_parser = match &case.expected {
                    Expected::Error(parsers) => parsers
                        .iter()
                        .map(Vec::as_slice)
                        .find(is_named)
                        .or_else(|| parser_of_directory(language)),
                    Expected::Output(_) => None,
                };
                let named_parser = first_parser.filter(is_named).or(rejecting_parser);
                let ours = named_parser.unwrap_or_else(|| parser_of(&case.name, language));
                if !case.parsers.is_empty()
                    && named_parser.is_none()
                    && !case.parsers.iter().any(|it| is_javascript_parser(it))
                {
                    *excluded.entry(PLUGIN).or_default() += 1;
                    continue;
                }
                // A plugin for what is embedded is not asked where that is left as it is.
                let is_embedded_left = case
                    .options
                    .iter()
                    .any(|it| it.0 == b"embeddedLanguageFormatting" && it.1 == b"off");
                if let Some(&(_, reason)) = EXCLUDED
                    .iter()
                    .filter(|it| it.1 != PLUGIN || !is_embedded_left)
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

                // `bun format` does not format HTML in templates and in blocks of code by itself yet. Here it is judged.
                let mut options = FormatOptions {
                    embedded_html: true,
                    ..FormatOptions::default()
                };
                if let Some(parser) = named_parser {
                    let _ = options.set(b"parser", parser);
                } else if !case.parsers.is_empty()
                    && (case.rejected_by.iter().any(|it| it == ours)
                        || !case.parsers.iter().any(|it| it == ours))
                {
                    // The output is that of another parser, which takes what `babel` does not: types in a `.js` file.
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

                // The file has what the snapshot cannot show: line endings, a byte order mark.
                let on_disk = bundle
                    .read(&id)
                    .filter(|it| std::str::from_utf8(it).is_ok());
                let (path, original) = match on_disk {
                    Some(input) => (id.clone(), input),
                    None => {
                        // The name of a file that the test gives the text, which `sync.ts` has noted. Or `snippet: test.cjs`.
                        // It is parsed as the parser of the test says, if it says.
                        let title = case.name.strip_prefix(b"snippet: ");
                        let noted = strings::split(filenames, b"\n")
                            .filter_map(|line| strings::split_once(line, b"\t"));
                        let noted = noted.filter(|it| Some(it.0) == title).map(|it| it.1).next();
                        let name = noted.or_else(|| title.filter(|it| strings::contains_char(it, b'.')));
                        let _ = options.set(b"filepath", name.unwrap_or_default());
                        let extension: &[u8] = match (named_parser, language) {
                            (Some(parser), _) if parser.starts_with(b"json") => b"json",
                            (Some(b"glimmer"), _) => b"hbs",
                            // Prettier gives it no name, and what is not called `.html` keeps its doctype as it is written.
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
                // Of a snippet with a range, the snapshot does not have the text with the placeholders.
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
                        // The text of a snippet that is rejected is not in the snapshot: `sync.ts` writes it to `rejected-snippets`.
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
                let is_left_alone = options.require_pragma
                    || options.check_ignore_pragma
                    || matches!((options.range_start, options.range_end), (Some(start), Some(end)) if start >= end);
                let skips_end_of_line = input.trim_ascii().is_empty()
                    || strings::contains_char(&input, b'\r')
                    || is_left_alone;
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
