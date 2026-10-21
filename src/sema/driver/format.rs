//! Formats a [`Report`].
//!
//! - Interactive terminal: `bun_ast::Msg::write_format`, which is how Bun prints its own errors.
//! - Everything else: TypeScript's plain format, which editors, continuous integration and other tools already parse.
//!   Only that format prints the text of the checked files as `tsc` does. The others print it [`escaped`].

use crate::{Category, Diagnostic, MessageChain, Report, TaskOutput};
use bstr::{BStr, BString, ByteSlice};
use bun_core::fmt::escape_control_chars;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::messages;
use bun_sema::resolve::get_relative_path_from_directory;
use bun_sema::util::FxHashMap;
use bun_sema::util::SharedSort;
use std::io::Write;

macro_rules! alloc_print {
    ($($arg:tt)*) => {
        BString::from(bun_ast::alloc_print(format_args!($($arg)*)).into_owned())
    };
}

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Layout {
    /// Source lines, underlines and a summary.
    Pretty,
    /// `file(line,column): error TS1234: message`, as `tsc --pretty false` prints it.
    Plain,
    /// One tag per error that contains the surrounding source, so the reader doesn't have to open the file.
    Agent,
}

#[derive(Copy, Clone)]
pub struct Style<'a> {
    pub layout: Layout,
    pub color: bool,
    /// The directory that displayed paths are relative to, in the checker's path format.
    pub cwd: &'a [u8],
    /// `UseCaseSensitiveFileNames`: `Report::is_case_sensitive`.
    pub is_case_sensitive: bool,
    /// Also print `::error` workflow commands, which GitHub Actions turns into annotations.
    pub github_annotations: bool,
    /// The terminal width in columns. 0 if it's unknown or not a terminal.
    pub width: usize,
    /// `--all`: never group identical diagnostics.
    pub show_all: bool,
}

/// True if `text` has an ASCII control character or a non-ASCII byte. Most text has neither and is printed as it is.
fn may_have_control_characters(text: &[u8]) -> bool {
    strings::index_of_newline_or_non_ascii(text, 0).is_some() || strings::contains_char(text, 0x7f)
}

/// Returns `text` on one line, with its control characters as escape sequences such as `\x1b`.
pub fn escaped(text: impl Into<BString>) -> BString {
    let text = text.into();
    match may_have_control_characters(&text) {
        true => alloc_print!("{}", escape_control_chars(&text)),
        false => text,
    }
}

/// Writes `text` as [`escaped`] returns it.
pub fn write_escaped(out: &mut Vec<u8>, text: &[u8]) {
    match may_have_control_characters(text) {
        true => {
            let _ = write!(out, "{}", escape_control_chars(text));
        }
        false => out.extend_from_slice(text),
    }
}

/// Writes `text`, which has its own line breaks (`\n` or `\r\n`): each line [`escaped`], with `\n` between the lines.
pub fn write_escaped_lines(out: &mut Vec<u8>, text: &[u8]) {
    let mut rest = text;
    while let Some((line, after)) = strings::split_once_char(rest, b'\n') {
        write_escaped(out, line.strip_suffix(b"\r").unwrap_or(line));
        out.push(b'\n');
        rest = after;
    }
    write_escaped(out, rest);
}

/// Returns the path relative to the working directory, or the absolute path if that would need two or more `../`.
/// The path is [`escaped`], because no layout of `tsc` prints it.
fn display_path(path: &[u8], style: &Style) -> BString {
    let relative = relative_path(path, style.cwd, style);
    if relative.starts_with(b"../../") {
        escaped(crate::host::to_native(path))
    } else {
        escaped(relative)
    }
}

/// `ConvertToRelativePath`
fn relative_path(path: &[u8], from: &[u8], style: &Style) -> BString {
    get_relative_path_from_directory(from, path, style.is_case_sensitive).into()
}

/// Writes `d.text` for Bun's own layouts: [`escaped`], each argument on one line, so no argument reads as another diagnostic.
pub fn write_message(out: &mut Vec<u8>, d: &Diagnostic) {
    if !may_have_control_characters(&d.text) {
        out.extend_from_slice(&d.text);
        return;
    }
    fn has_line_break(args: &[Box<[u8]>], chain: &[MessageChain]) -> bool {
        (args.iter()).any(|arg| strings::contains_char(arg, b'\n'))
            || (chain.iter()).any(|it| has_line_break(&it.args, &it.message_chain))
    }
    // No template has a line break, so the line breaks of `d.text` are the elaboration's.
    if !has_line_break(&d.args, &d.message_chain) {
        return write_escaped_lines(out, &d.text);
    }
    // The template gets Bun's commands, as `d.text` has them. Rewriting the finished text would change an argument too.
    fn write_composed(out: &mut Vec<u8>, template: &str, code: u32, args: &[Box<[u8]>]) {
        let with_bun_commands = crate::with_bun_commands(template.into());
        let template = std::str::from_utf8(&with_bun_commands).unwrap_or(template);
        let on_one_line = |arg: &[u8]| Vec::from(escaped(arg));
        let args: Vec<Vec<u8>> = match (code, args) {
            // The paths of the cycle follow the argument that has them all, one per line. See `open_build_task`.
            (6202, [_, paths @ ..]) if !paths.is_empty() => {
                let paths: Vec<Vec<u8>> = paths.iter().map(|path| on_one_line(path)).collect();
                vec![paths.join(&b'\n')]
            }
            _ => args.iter().map(|arg| on_one_line(arg)).collect(),
        };
        messages::format(out, template, &args);
    }
    // `MessageChain::flatten`
    fn write_chain(out: &mut Vec<u8>, chain: &[MessageChain], level: usize) {
        for it in chain {
            out.push(b'\n');
            out.extend(std::iter::repeat_n(b' ', 2 * level));
            let template = messages::message(it.code).map_or("", |m| m.1);
            write_composed(out, template, it.code, &it.args);
            write_chain(out, &it.message_chain, level + 1);
        }
    }
    let template = messages::message(d.code).map_or("Unknown error.", |m| m.1);
    write_composed(out, template, d.code, &d.args);
    write_chain(out, &d.message_chain, 1);
}

/// Formats `1234` as `1,234`.
fn with_commas(n: usize) -> BString {
    let digits = alloc_print!("{n}");
    let mut out = BString::default();
    for (i, &c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(b',');
        }
        out.push(c);
    }
    out
}

pub fn plural(n: usize, one: &[u8], many: &[u8]) -> BString {
    let noun = if n == 1 { one } else { many };
    alloc_print!("{} {}", with_commas(n), noun.as_bstr())
}

/// The display width of `text` in terminal columns: two for most East Asian characters and for
/// emoji, zero for combining characters.
fn columns(text: &[u8]) -> usize {
    strings::visible::width::exclude_ansi_colors::utf8(text)
}

/// The longest prefix of `text` that fits in `width` columns.
fn truncate_to_width(text: &[u8], width: usize) -> &[u8] {
    let end = strings::visible::width::exclude_ansi_colors::utf8_index_at_width(text, width);
    &text[..end]
}

/// Converts `d` to input for `bun_ast::Msg::write_format`: the message, its location, and the last `max_lines` source
/// lines up to the line it starts on. Only an error includes its code.
fn to_data(d: &Diagnostic, style: &Style, includes_code: bool, max_lines: usize) -> bun_ast::Data {
    let mut text = Vec::with_capacity(d.text.len() + 8);
    // Bun's own diagnostics have no code.
    if d.code != 0 && includes_code {
        let _ = write!(text, "TS{}: ", d.code);
    }
    write_message(&mut text, d);
    // Leading blank lines carry no information.
    let lines = &d.source[..d.source.len().min((d.line - d.source_line) as usize + 1)];
    let lines = &lines[lines.len().saturating_sub(max_lines)..];
    let blank = lines.iter().take_while(|line| line.trim_ascii().is_empty());
    let lines = &lines[blank.count()..];
    // An error on a blank line, for example at the end of the file, gets no source either, because the preceding line
    // would be mistaken for the error's line. Neither do lines that aren't hand-written, which would fill the screen.
    let is_blank = lines.last().is_none_or(|line| line.trim_ascii().is_empty());
    let is_hidden = is_blank || lines.iter().any(|line| line.len() > crate::MAX_SHOWN_LINE);
    let lines = if is_hidden { &[] } else { lines };
    let location = (!d.path.is_empty()).then(|| bun_ast::Location {
        file: Vec::from(display_path(&d.path, style)).into(),
        line: d.line as i32,
        column: d.column as i32,
        line_text: Some(strings::replace_owned(&bstr::join("\n", lines), b"\t", b" ").into()),
        ..Default::default()
    });
    bun_ast::Data {
        text: text.into(),
        location,
    }
}

/// Bun's own diagnostics have no code.
pub fn metadata_of(d: &Diagnostic) -> bun_ast::Metadata {
    match d.code {
        0 => bun_ast::Metadata::Build,
        code => bun_ast::Metadata::TypeScript {
            code,
            kind: bun_ast::TypeScriptKind::Checker,
        },
    }
}

/// Converts `d` to a message of Bun's own log, with the related information as its notes.
fn to_msg(d: &Diagnostic, style: &Style) -> bun_ast::Msg {
    let related = d.related.iter().take(MAX_RELATED);
    bun_ast::Msg {
        kind: match d.category {
            Category::Error => bun_ast::Kind::Err,
            Category::Warning => bun_ast::Kind::Warn,
            Category::Suggestion | Category::Message => bun_ast::Kind::Note,
        },
        data: to_data(d, style, true, 3),
        metadata: metadata_of(d),
        notes: related
            .map(|note| {
                // A line that's already shown above isn't repeated.
                let is_shown = note.path == d.path && (note.line..=note.line + 2).contains(&d.line);
                to_data(note, style, false, usize::from(!is_shown))
            })
            .collect(),
        ..Default::default()
    }
}

/// Formats `d` like Bun's own errors. `duplicates`: other diagnostics with the same code and message, when grouping.
fn write_pretty(out: &mut Vec<u8>, d: &Diagnostic, duplicates: &[&Diagnostic], style: &Style) {
    let message = to_msg(d, style);
    let to = &mut bun_core::fmt::VecWriter(out);
    let _ = match style.color {
        true => message.write_format::<true>(to),
        false => message.write_format::<false>(to),
    };
    out.push(b'\n');
    if !duplicates.is_empty() {
        write_occurrences(out, d, duplicates, style);
    }
}

/// Writes `264 times in 6 files`, then the count for each file. The file list is never truncated.
fn write_occurrences(
    out: &mut Vec<u8>,
    first: &Diagnostic,
    duplicates: &[&Diagnostic],
    style: &Style,
) {
    let all = std::iter::once(first).chain(duplicates.iter().copied());
    let mut by_file = count_by_file(all.filter(|d| !d.path.is_empty()));
    let times = with_commas(duplicates.len() + 1);
    pretty!(out, style.color, "    <b><yellow>{} times<r>", times);
    // Errors without a file, e.g. when every project of a build is missing the `types` it lists.
    if by_file.is_empty() {
        out.push(b'\n');
        return;
    }
    if let [_] = by_file[..]
        && !first.path.is_empty()
    {
        let mut lines: Vec<u32> = duplicates
            .iter()
            .map(|d| d.line)
            .filter(|&line| line != first.line)
            .collect();
        lines.dedup();
        if lines.is_empty() {
            pretty!(out, style.color, "<d> on this line<r>\n");
            return;
        }
        let more = if lines.len() > MAX_LINES_LISTED {
            " \u{2026}"
        } else {
            ""
        };
        let noun = if lines.len() == 1 { "line" } else { "lines" };
        let lines = lines.iter().take(MAX_LINES_LISTED);
        let lines = bstr::join(", ", lines.map(|line| alloc_print!("{line}")));
        pretty!(
            out,
            style.color,
            "<d> in this file, next on {} <r><yellow>{}<r><d>{}<r>\n",
            noun,
            lines.as_bstr(),
            more
        );
        return;
    }
    let files = plural(by_file.len(), b"file", b"files");
    pretty!(out, style.color, "<d> in {}<r>\n", files);
    by_file.shared_sort_by_key(|&(_, count)| std::cmp::Reverse(count));
    let width = with_commas(by_file[0].1).len();
    for (of, count) in &by_file {
        pretty!(
            out,
            style.color,
            "      {:>3$}  <cyan>{}<r><d>:{}<r>\n",
            with_commas(*count),
            display_path(&of.path, style),
            of.line,
            width
        );
    }
}

/// `getErrorSummary`: returns each file's first diagnostic and its number of diagnostics, sorted by file name. A file
/// that two projects of a build include counts once per project.
fn count_by_file<'a>(
    diagnostics: impl Iterator<Item = &'a Diagnostic>,
) -> Vec<(&'a Diagnostic, usize)> {
    let mut index: FxHashMap<(u32, &[u8]), usize> = FxHashMap::default();
    let mut by_file: Vec<(&Diagnostic, usize)> = Vec::new();
    for d in diagnostics {
        let at = *index.entry((d.project, &d.path[..])).or_insert_with(|| {
            by_file.push((d, 0));
            by_file.len() - 1
        });
        by_file[at].1 += 1;
    }
    // The sort is stable, so the projects stay in build order.
    by_file.shared_sort_by(|a, b| a.0.path.cmp(&b.0.path));
    by_file
}

/// Line numbers listed for a group whose duplicates are all in one file.
const MAX_LINES_LISTED: usize = 8;
/// Groups after the first `MAX_GROUPS` that still get a one-line entry.
const MAX_COMPACT_GROUPS: usize = 15;

/// Related-information entries printed under a diagnostic.
const MAX_RELATED: usize = 3;
/// Above this many diagnostics, identical ones are grouped instead of printed one by one.
const GROUP_THRESHOLD: usize = 50;
/// Groups printed in full, with a source excerpt.
const MAX_GROUPS: usize = 12;

/// `WriteFormatDiagnostic`. `path` is the file's `relative_path`.
fn write_plain(out: &mut Vec<u8>, d: &Diagnostic, path: &BStr) {
    if !d.path.is_empty() {
        let _ = write!(out, "{path}({},{}): ", d.line, d.column);
    }
    match d.code {
        0 => {
            let _ = writeln!(out, "{}: {}", d.category.name(), d.text.as_bstr());
        }
        code => {
            let _ = writeln!(out, "{} TS{code}: {}", d.category.name(), d.text.as_bstr());
        }
    }
}

/// Escapes an attribute value. Doesn't add the quotes.
fn attribute(text: &[u8]) -> BString {
    let mut out = BString::default();
    for c in text {
        out.extend_from_slice(
            strings::xml_escape_entity(*c).unwrap_or_else(|| std::slice::from_ref(c)),
        );
    }
    out
}

/// Returns the offset in `line` of its 0-based UTF-16 column `column`. `units` counts a run of bytes that isn't UTF-8.
pub fn offset_of_column(line: &[u8], column: usize, units: fn(&[u8]) -> u32) -> usize {
    if line.is_ascii() {
        return column.min(line.len());
    }
    let (mut offset, mut counted) = (0, 0);
    for chunk in line.utf8_chunks() {
        for character in chunk.valid().chars() {
            if counted >= column {
                return offset;
            }
            counted += character.len_utf16();
            offset += character.len_utf8();
        }
        if counted >= column {
            return offset;
        }
        counted += units(chunk.invalid()) as usize;
        offset += chunk.invalid().len();
    }
    offset
}

/// Writes the `<source>` element of a problem. `lines` isn't empty, and its first line has the number `first`. Carets
/// go below line number `at`, from byte `from` up to byte `to` of it ([`offset_of_column`]). `to` is `None` for the end of the
/// line.
pub fn write_agent_source(
    out: &mut Vec<u8>,
    first: u32,
    lines: &[&[u8]],
    at: u32,
    (from, to): (usize, Option<usize>),
) {
    out.extend_from_slice(b"<source>\n");
    let gutter = bun_core::fmt::digit_count(first as usize + lines.len() - 1);
    for (line, text) in (first..).zip(lines) {
        let text = strings::replace_owned(text, b"\t", b" ");
        let _ = write!(out, "{line:>gutter$} | ");
        write_escaped(out, text.trim_ascii_end());
        out.push(b'\n');
        if line == at {
            let from = from.min(text.len());
            let to = to.unwrap_or(text.len()).clamp(from, text.len());
            // The columns of what is printed, counted at the end of `out`: an escape sequence is longer than its character.
            let mut columns = |part: &[u8]| {
                if !may_have_control_characters(part) {
                    return part.len();
                }
                let printed = out.len();
                let _ = write!(out, "{}", escape_control_chars(part));
                let columns = strings::wtf8_len_utf16(&out[printed..]) as usize;
                out.truncate(printed);
                columns
            };
            let before = gutter + 3 + columns(&text[..from]);
            let carets = "^".repeat(columns(&text[from..to]).max(1));
            let _ = writeln!(out, "{:before$}{carets}", "");
        }
    }
    out.extend_from_slice(b"</source>\n");
}

fn write_agent(out: &mut Vec<u8>, d: &Diagnostic, duplicates: &[&Diagnostic], style: &Style) {
    let _ = write!(out, "<{}", d.category.name());
    if !d.path.is_empty() {
        let _ = write!(
            out,
            " file=\"{}\" line=\"{}\" column=\"{}\"",
            attribute(&display_path(&d.path, style)),
            d.line,
            d.column
        );
    }
    if d.code != 0 {
        let _ = write!(out, " code=\"TS{}\"", d.code);
    }
    if !duplicates.is_empty() {
        let _ = write!(out, " times=\"{}\"", duplicates.len() + 1);
    }
    out.extend_from_slice(b">\n");
    write_message(out, d);
    out.push(b'\n');
    let has_long_line = d
        .source
        .iter()
        .any(|line| line.len() > crate::MAX_SHOWN_LINE);
    if !d.source.is_empty() && !has_long_line {
        // For an error that spans many lines, shows only its start. Leading and trailing blank lines carry no
        // information.
        let at = (d.line - d.source_line) as usize;
        let blank = |lines: &mut dyn Iterator<Item = &Vec<u8>>| {
            lines
                .take_while(|line| line.trim_ascii().is_empty())
                .count()
        };
        let first = blank(&mut d.source[..at].iter());
        let end = d.source.len().min(at + 3);
        let end = end - blank(&mut d.source[at + 1..end].iter().rev());
        let lines: Vec<&[u8]> = d.source[first..end].iter().map(Vec::as_slice).collect();
        // `line_and_character` has counted them.
        let offset = |column: u32| {
            let units = strings::utf8_lossy_len_utf16;
            offset_of_column(&d.source[at], column as usize - 1, units)
        };
        let to = (d.end_line == d.line).then(|| offset(d.end_column));
        write_agent_source(
            out,
            d.source_line + first as u32,
            &lines,
            d.line,
            (offset(d.column), to),
        );
    }
    for note in &d.related {
        out.extend_from_slice(b"<related");
        if !note.path.is_empty() {
            let _ = write!(
                out,
                " file=\"{}\" line=\"{}\" column=\"{}\"",
                attribute(&display_path(&note.path, style)),
                note.line,
                note.column
            );
        }
        out.push(b'>');
        write_message(out, note);
        out.extend_from_slice(b"</related>\n");
    }
    let duplicates: Vec<&Diagnostic> = (duplicates.iter().copied())
        .filter(|other| !other.path.is_empty())
        .collect();
    if !duplicates.is_empty() {
        out.extend_from_slice(b"<also>");
        for (i, other) in duplicates.iter().take(MAX_AGENT_LOCATIONS).enumerate() {
            let _ = write!(
                out,
                "{}{}:{}:{}",
                if i > 0 { " " } else { "" },
                display_path(&other.path, style),
                other.line,
                other.column
            );
        }
        if duplicates.len() > MAX_AGENT_LOCATIONS {
            let _ = write!(out, " and {} more", duplicates.len() - MAX_AGENT_LOCATIONS);
        }
        out.extend_from_slice(b"</also>\n");
    }
    let _ = writeln!(out, "</{}>", d.category.name());
}

const MAX_AGENT_LOCATIONS: usize = 10;

fn write_github_annotation(out: &mut Vec<u8>, d: &Diagnostic, style: &Style) {
    let level = match d.category {
        Category::Error => "error",
        Category::Warning => "warning",
        Category::Suggestion | Category::Message => "notice",
    };
    let _ = write!(out, "::{level} ");
    if !d.path.is_empty() {
        // GitHub expects the path relative to the repository root, wherever the step runs.
        let workspace = bun_core::env_var::GITHUB_WORKSPACE::get().map(crate::host::from_native);
        let from = workspace.as_deref().unwrap_or(style.cwd);
        let _ = write!(
            out,
            "file={},line={},col={},endLine={},endColumn={},",
            bun_core::fmt::github_action_property(&relative_path(&d.path, from, style)),
            d.line,
            d.column,
            d.end_line,
            d.end_column
        );
    }
    // (`bun_core::fmt::github_action` leaves `%` unchanged.) No carriage return is left to encode.
    let mut text = Vec::new();
    write_message(&mut text, d);
    let text = strings::replace_owned(&text, b"%", b"%25");
    let text = strings::replace_owned(&text, b"\n", b"%0A");
    let _ = writeln!(out, "title=TS{}::{}", d.code, text.as_bstr());
}

/// A line of `--traceResolution`, `--listFiles` or `--explainFiles`.
fn write_line(out: &mut Vec<u8>, line: &[u8], style: &Style) {
    match style.layout {
        Layout::Plain => out.extend_from_slice(line),
        Layout::Pretty | Layout::Agent => write_escaped(out, line),
    }
    out.push(b'\n');
}

/// Writes the diagnostics, in order.
pub fn write_diagnostics(out: &mut Vec<u8>, report: &Report, style: &Style) {
    fn take<'a, T>(rest: &mut &'a [T], count: usize) -> &'a [T] {
        let (taken, after) = rest.split_at(count.min(rest.len()));
        *rest = after;
        taken
    }
    // Groups span the whole report, not one task.
    let is_grouped = !report.is_quiet && should_group(report, style);
    let tasks: &[TaskOutput] = if is_grouped { &[] } else { &report.tasks };
    let (mut trace, mut diagnostics, mut listed_files) = (
        &report.resolution_trace[..],
        &report.diagnostics[..],
        &report.listed_files[..],
    );
    let sum_over_tasks = |count: fn(&TaskOutput) -> usize| tasks.iter().map(count).sum::<usize>();
    let before_the_tasks = TaskOutput {
        resolution_trace: trace.len() - sum_over_tasks(|it| it.resolution_trace).min(trace.len()),
        diagnostics: diagnostics.len() - sum_over_tasks(|it| it.diagnostics).min(diagnostics.len()),
        listed_files: listed_files.len()
            - sum_over_tasks(|it| it.listed_files).min(listed_files.len()),
    };
    for task in std::iter::once(&before_the_tasks).chain(tasks) {
        for line in take(&mut trace, task.resolution_trace) {
            write_line(out, line, style);
        }
        let diagnostics = take(&mut diagnostics, task.diagnostics);
        // `QuietDiagnosticReporter`
        let diagnostics: &[Diagnostic] = if report.is_quiet { &[] } else { diagnostics };
        // Caches the previous diagnostic's file and its `relative_path`.
        let mut last: (&[u8], BString) = Default::default();
        if is_grouped {
            write_grouped(out, report, style);
        } else {
            for d in diagnostics {
                match style.layout {
                    Layout::Pretty => {
                        write_pretty(out, d, &[], style);
                        out.push(b'\n');
                    }
                    Layout::Plain => {
                        if last.0 != d.path {
                            last = (&d.path, relative_path(&d.path, style.cwd, style));
                        }
                        write_plain(out, d, last.1.as_bstr());
                    }
                    Layout::Agent => write_agent(out, d, &[], style),
                }
            }
        }
        if style.github_annotations {
            for d in diagnostics {
                write_github_annotation(out, d, style);
            }
        }
        for line in take(&mut listed_files, task.listed_files) {
            write_line(out, line, style);
        }
    }
}

/// The first line of a message. For TS2769 that line is always the same, so use the first specific reason under it.
fn summary_line(text: &[u8]) -> &[u8] {
    let mut lines = text.lines();
    let first = lines.next().unwrap_or(b"");
    if first != b"No overload matches this call." {
        return first;
    }
    lines
        .map(<[u8]>::trim_ascii_start)
        .find(|line| {
            !line.starts_with(b"Overload ") && !line.starts_with(b"The last overload gave")
        })
        .unwrap_or(first)
}

/// Plain output is never grouped, because tools parse it.
fn should_group(report: &Report, style: &Style) -> bool {
    style.layout != Layout::Plain && !style.show_all && report.diagnostics.len() > GROUP_THRESHOLD
}

/// Groups diagnostics by (code, message) and prints the largest groups first, each once with its number of occurrences
/// per file. A project with thousands of errors usually has a few root causes, and this puts them at the top.
fn write_grouped(out: &mut Vec<u8>, report: &Report, style: &Style) {
    let mut index: FxHashMap<(u32, &[u8]), usize> = FxHashMap::default();
    let mut groups: Vec<Vec<&Diagnostic>> = Vec::new();
    for d in &report.diagnostics {
        let at = *index.entry((d.code, d.text.as_slice())).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[at].push(d);
    }
    // The sort is stable, so ties stay in source order.
    groups.shared_sort_by_key(|group| std::cmp::Reverse(group.len()));
    let groups_shown = groups.len().min(MAX_GROUPS);
    for group in &groups[..groups_shown] {
        match style.layout {
            Layout::Agent => write_agent(out, group[0], &group[1..], style),
            _ => {
                write_pretty(out, group[0], &group[1..], style);
                out.push(b'\n');
            }
        }
    }
    let compact_count = (groups.len() - groups_shown).min(MAX_COMPACT_GROUPS);
    if style.layout == Layout::Pretty && compact_count > 0 {
        let width = with_commas(groups[groups_shown].len()).len();
        for group in &groups[groups_shown..groups_shown + compact_count] {
            let first = group[0];
            pretty!(
                out,
                style.color,
                "  {:>2$}  <d>TS{:<6}<r>",
                with_commas(group.len()),
                first.code,
                width
            );
            let mut message = Vec::new();
            write_message(&mut message, first);
            let reported = summary_line(&message);
            let first_location =
                alloc_print!("{}:{}", display_path(&first.path, style), first.line);
            // Truncate the message to the terminal width. Append the first location only if it fits.
            let room = match style.width {
                0 => usize::MAX,
                columns => columns.saturating_sub(width + 12),
            };
            let clipped = truncate_to_width(reported, room);
            out.extend_from_slice(clipped);
            if clipped.len() < reported.len() {
                pretty!(out, style.color, "<d>\u{2026}<r>");
            } else if !first.path.is_empty()
                && columns(reported) + columns(&first_location) + 2 <= room
            {
                pretty!(out, style.color, "  <d>{}<r>", first_location);
            }
            out.push(b'\n');
        }
        out.push(b'\n');
    }
    let groups_shown = if style.layout == Layout::Pretty {
        groups_shown + compact_count
    } else {
        groups_shown
    };
    let rest: usize = groups[groups_shown..].iter().map(Vec::len).sum();
    if rest == 0 {
        return;
    }
    let (errors, more) = (
        plural(rest, b"more error", b"more errors"),
        plural(groups.len() - groups_shown, b"other kind", b"other kinds"),
    );
    if style.layout == Layout::Agent {
        let _ = writeln!(
            out,
            "<not-shown>{errors} of {more}. Run `bun check --all` to list every error, or `bun check <path>` to check one file or directory.</not-shown>"
        );
        return;
    }
    pretty!(
        out,
        style.color,
        "<b>{} of {}<r><d> not shown<r>\n  <cyan>bun check --all <r><d>  show every error<r>\n  <cyan>bun check \\<path\\><r><d>  check one file or directory<r>\n\n",
        errors,
        more
    );
}

/// Writes the progress as a line that overwrites the previous one. `tick`: the number of times it has been drawn.
pub fn write_progress(out: &mut Vec<u8>, progress: &crate::Progress, style: &Style, tick: usize) {
    use std::sync::atomic::Ordering::Relaxed;
    const SPINNER: [char; 10] = [
        '\u{280b}', '\u{2819}', '\u{2839}', '\u{2838}', '\u{283c}', '\u{2834}', '\u{2826}',
        '\u{2827}', '\u{2807}', '\u{280f}',
    ];
    const BAR: usize = 24;
    out.extend_from_slice(ERASE_LINE);
    pretty!(
        out,
        style.color,
        "<cyan>{}<r>",
        SPINNER[tick % SPINNER.len()]
    );
    let (total, done) = (
        progress.to_check.load(Relaxed),
        progress.checked.load(Relaxed),
    );
    if total == 0 {
        pretty!(out, style.color, " Loading<d>\u{2026}<r>");
        return;
    }
    out.extend_from_slice(b" Checking ");
    // The bar is shown only if the terminal is wide enough.
    if style.width == 0 || style.width >= 72 {
        let bytes = progress.bytes_to_check.load(Relaxed).max(1);
        let filled = (progress.bytes_checked.load(Relaxed) * BAR / bytes).min(BAR);
        pretty!(
            out,
            style.color,
            "<cyan>{}<r><d>{}<r> ",
            "\u{2501}".repeat(filled),
            "\u{2501}".repeat(BAR - filled)
        );
    }
    pretty!(
        out,
        style.color,
        "{}<d> / {} files<r>",
        with_commas(done),
        with_commas(total)
    );
    match progress.errors.load(Relaxed) {
        0 => {}
        errors => {
            pretty!(
                out,
                style.color,
                "<d>, <r><red>{}<r>",
                plural(errors, b"error", b"errors")
            );
        }
    }
}

/// Moves the cursor to the start of the line and erases the line.
pub const ERASE_LINE: &[u8] = "\r\u{1b}[2K".as_bytes();

/// True if any diagnostic is about a global or module that `@types/bun` declares.
fn is_missing_bun_types(report: &Report) -> bool {
    report.diagnostics.iter().any(is_about_bun_types)
}

/// True if `d` is about a global or module that `@types/bun` declares.
pub(crate) fn is_about_bun_types(d: &Diagnostic) -> bool {
    match d.code {
        // `Cannot find name 'console'. Do you need to change your target library? ..` `document` gets the same code,
        // but it isn't Bun's.
        2584 => d.text.starts_with(b"Cannot find name 'console'."),
        // `Cannot find module 'bun:test' or its corresponding type declarations.`
        2307 => {
            d.text.starts_with(b"Cannot find module 'bun:")
                || d.text.starts_with(b"Cannot find module 'bun'")
        }
        // `Cannot find name 'Bun'. Do you need to install type definitions for Bun? ..`
        2867 | 2868 => true,
        2688 => d
            .text
            .starts_with(b"Cannot find type definition file for 'bun'."),
        _ => false,
    }
}

/// Warnings, notes, the error count, then a per-file error count for every file.
pub fn write_summary(out: &mut Vec<u8>, report: &Report, style: &Style) {
    let in_files =
        (report.diagnostics.iter()).filter(|d| d.category == Category::Error && !d.path.is_empty());
    let mut by_file = count_by_file(in_files);
    let files_with_errors = by_file.len();
    for file in &report.incomplete {
        pretty!(
            out,
            style.color,
            "<red>error<r><d>:<r> {}\n",
            BStr::new(&file.message(&escaped(relative_path(&file.path, style.cwd, style))))
        );
    }
    // A repository can have a hundred fixtures that nobody installs.
    const MAX_MANIFESTS_LISTED: usize = 3;
    for it in report.not_installed.iter().take(MAX_MANIFESTS_LISTED) {
        let (verb, count) = match it.names.len() {
            1 => ("is", BString::from("1 dependency")),
            n => ("are", alloc_print!("{n} dependencies")),
        };
        let manifest = escaped(relative_path(&it.manifest, style.cwd, style));
        let cwd_flag = match it.is_cwd_manifest {
            true => BString::default(),
            false => alloc_print!(" --cwd={}", BStr::new(dirname::<Posix>(&manifest))),
        };
        pretty!(
            out,
            style.color,
            "<blue>note<r><d>:<r> {} in {} {} not installed. Run: <cyan>bun install{}<r>\n",
            count,
            manifest,
            verb,
            cwd_flag
        );
    }
    let more = report
        .not_installed
        .len()
        .saturating_sub(MAX_MANIFESTS_LISTED);
    if more == 1 {
        pretty!(
            out,
            style.color,
            "<blue>note<r><d>:<r> 1 more package.json has dependencies that are not installed.\n"
        );
    } else if more > 1 {
        pretty!(
            out,
            style.color,
            "<blue>note<r><d>:<r> {} more package.json files have dependencies that are not installed.\n",
            more
        );
    }
    // `bun install` installs them too.
    let mut names = report.not_installed.iter().flat_map(|it| &it.names);
    let is_listed = names.any(|name| name == b"@types/bun");
    if is_missing_bun_types(report) && !is_listed {
        if report.has_bun_types_installed {
            pretty!(
                out,
                style.color,
                "<blue>note<r><d>:<r> Bun's type definitions (console, fetch, Bun, bun:test) are installed, but tsconfig.json does not include them. Add to compilerOptions: <cyan>\"types\": [\"bun\"]<r>\n"
            );
        } else {
            pretty!(
                out,
                style.color,
                "<blue>note<r><d>:<r> Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: <cyan>bun add -d @types/bun<r>\n"
            );
        }
    }
    if report.follows_references {
        pretty!(
            out,
            style.color,
            "<blue>note<r><d>:<r> tsconfig.json has no files of its own. Checked the projects it references, like <cyan>tsc -b<r>.\n"
        );
    }
    if report.files_not_checked > 0 {
        pretty!(
            out,
            style.color,
            "<blue>note<r><d>:<r> Stopped before type checking {}. Fix the errors above to see the rest.\n",
            plural(report.files_not_checked, b"file", b"files")
        );
    }
    let errors = report.error_count();
    let took = bun_core::output::Elapsed {
        colors: style.color,
        ms: (report.load_time + report.check_time).as_secs_f64() * 1000.0,
    };
    let took = alloc_print!(" {took}");
    let projects = match report.projects_checked {
        0 => BString::default(),
        n => alloc_print!(" across {}", plural(n, b"project", b"projects")),
    };
    let checked = plural(report.files_checked, b"file", b"files");
    if errors == 0 && !report.incomplete.is_empty() {
        pretty!(
            out,
            style.color,
            "<b><red>Could not finish checking {}<r><d>, checked {}{}{}<r>\n",
            plural(report.incomplete.len(), b"file", b"files"),
            checked,
            projects,
            took
        );
        return;
    }
    if errors == 0 {
        pretty!(
            out,
            style.color,
            "<green>\u{2713}<r> No type errors<d> in {}{}{}<r>\n",
            checked,
            projects,
            took
        );
        return;
    }
    let found = plural(errors, b"error", b"errors");
    pretty!(out, style.color, "<b><red>Found {}<r>", found);
    if files_with_errors > 0 {
        let _ = write!(out, " in {}", plural(files_with_errors, b"file", b"files"));
    }
    pretty!(
        out,
        style.color,
        "<d>, checked {}{}{}<r>\n",
        checked,
        projects,
        took
    );
    if files_with_errors < 2 {
        return;
    }
    out.push(b'\n');
    // Never truncated. In a terminal the end of the output is what stays on screen, so the files with the most errors
    // go last.
    if style.layout == Layout::Pretty {
        by_file.shared_sort_by_key(|&(_, count)| count);
    }
    let width = by_file
        .iter()
        .map(|&(_, count)| with_commas(count).len())
        .max()
        .unwrap_or(1);
    for (first, count) in &by_file {
        let path = if style.layout == Layout::Plain {
            escaped(relative_path(&first.path, style.cwd, style))
        } else {
            display_path(&first.path, style)
        };
        pretty!(
            out,
            style.color,
            "  {:>3$}  <cyan>{}<r><d>:{}<r>\n",
            with_commas(*count),
            path,
            first.line,
            width
        );
    }
}
