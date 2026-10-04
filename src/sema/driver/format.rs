//! Formats a [`Report`].
//!
//! For an interactive terminal: `bun_ast::Msg::write_format`, which is how Bun prints its own
//! errors.
//! For everything else: TypeScript's plain format, which editors, continuous integration and other
//! tools already parse.

use crate::{Category, Diagnostic, Report};
use bstr::{BString, ByteSlice};
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::relative_normalized;
use bun_sema::util::FxHashMap;
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
    /// One tag per error that contains the surrounding source, so that the reader does not have to
    /// open the file.
    Agent,
}

#[derive(Copy, Clone)]
pub struct Style<'a> {
    pub layout: Layout,
    pub color: bool,
    /// The directory that displayed paths are relative to, in the checker's path format.
    pub cwd: &'a [u8],
    /// Also print `::error` workflow commands, which GitHub Actions turns into annotations.
    pub github_annotations: bool,
    /// The terminal width in columns. 0: unknown, or not a terminal.
    pub width: usize,
    /// `--all`: never group identical diagnostics.
    pub show_all: bool,
}

/// Relative to the working directory, or absolute when that would need two or more `../`.
fn display_path(path: &[u8], style: &Style) -> BString {
    let relative = relative_path(path, style.cwd);
    if relative.starts_with(b"../../") {
        crate::host::to_native(path).into()
    } else {
        relative
    }
}

/// `ConvertToRelativePath`
pub fn relative_path(path: &[u8], cwd: &[u8]) -> BString {
    // On Windows a path on another drive has no relative form.
    if cfg!(windows) && path.get(..3) != cwd.get(..3) {
        return crate::host::to_native(path).into();
    }
    relative_normalized::<Posix, true>(cwd, path).into()
}

/// `1234` as `1,234`.
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

fn plural(n: usize, one: &[u8], many: &[u8]) -> BString {
    let noun = if n == 1 { one } else { many };
    alloc_print!("{} {}", with_commas(n), noun.as_bstr())
}

/// The display width of `text` in terminal columns: two for most East Asian characters and for
/// emoji, zero for combining characters.
fn columns(text: &[u8]) -> usize {
    strings::visible::width::exclude_ansi_colors::utf8(text)
}

/// The longest prefix of `text` that fits in `width` columns.
fn fitting(text: &[u8], width: usize) -> &[u8] {
    let end = strings::visible::width::exclude_ansi_colors::utf8_index_at_width(text, width);
    &text[..end]
}

/// `d` as input for `bun_ast::Msg::write_format`: the message, its location, and the last `shown`
/// source lines up to the line it starts on.
/// Only an error includes its code.
fn to_data(d: &Diagnostic, style: &Style, says_code: bool, shown: usize) -> bun_ast::Data {
    // Bun's own diagnostics have no code.
    let text = match d.code {
        code if code != 0 && says_code => alloc_print!("TS{code}: {}", d.text.as_bstr()).into(),
        _ => d.text.clone(),
    };
    // Leading blank lines carry no information.
    let lines = &d.source[..d.source.len().min((d.line - d.source_line) as usize + 1)];
    let lines = &lines[lines.len().saturating_sub(shown)..];
    let blank = lines.iter().take_while(|line| line.trim_ascii().is_empty());
    let lines = &lines[blank.count()..];
    // No source is shown either for an error on a blank line, for example at the end of the file:
    // the preceding line would be mistaken for the error's line.
    // Nor for lines that are not hand-written, which fill the screen.
    let is_blank = lines.last().is_none_or(|line| line.trim_ascii().is_empty());
    let is_hidden = is_blank || lines.iter().any(|line| line.len() > 1000);
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

/// `d` as a message of Bun's own log, with the related information as its notes.
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
                // A line that is already shown above is not repeated.
                let is_shown = note.path == d.path && (note.line..=note.line + 2).contains(&d.line);
                to_data(note, style, false, usize::from(!is_shown))
            })
            .collect(),
        ..Default::default()
    }
}

/// Formatted like Bun's own errors. `duplicates`: other diagnostics with the same code and message,
/// when grouping.
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

/// `264 times in 6 files`, then the count for each file. The file list is never truncated.
fn write_occurrences(
    out: &mut Vec<u8>,
    first: &Diagnostic,
    duplicates: &[&Diagnostic],
    style: &Style,
) {
    // Diagnostics are sorted by path, so each file's are adjacent.
    let mut by_file: Vec<(&Diagnostic, usize)> = vec![(first, 1)];
    for &d in duplicates {
        match by_file.last_mut() {
            Some((of, count)) if of.path == d.path => *count += 1,
            _ => by_file.push((d, 1)),
        }
    }
    let times = with_commas(duplicates.len() + 1);
    pretty!(out, style.color, "    <b><yellow>{} times<r>", times);
    if let [_] = by_file[..] {
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
    by_file.sort_by_key(|&(_, count)| std::cmp::Reverse(count));
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

/// `WriteFormatDiagnostic`
fn write_plain(out: &mut Vec<u8>, d: &Diagnostic, style: &Style) {
    if !d.path.is_empty() {
        let _ = write!(
            out,
            "{}({},{}): ",
            relative_path(&d.path, style.cwd),
            d.line,
            d.column
        );
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

/// An attribute value, without the quotes.
fn attribute(text: &[u8]) -> BString {
    let mut out = BString::default();
    for c in text {
        out.extend_from_slice(
            strings::xml_escape_entity(*c).unwrap_or_else(|| std::slice::from_ref(c)),
        );
    }
    out
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
    out.extend_from_slice(&d.text);
    out.push(b'\n');
    if !d.source.is_empty() {
        out.extend_from_slice(b"<source>\n");
        // For an error that spans many lines, only its start. Leading and trailing blank lines
        // carry no information.
        let at = (d.line - d.source_line) as usize;
        let blank = |lines: &mut dyn Iterator<Item = &Vec<u8>>| {
            lines
                .take_while(|line| line.trim_ascii().is_empty())
                .count()
        };
        let first = blank(&mut d.source[..at].iter());
        let end = d.source.len().min(at + 3);
        let end = end - blank(&mut d.source[at + 1..end].iter().rev());
        let gutter = bun_core::fmt::digit_count(d.source_line as usize + end - 1);
        for (line, text) in (d.source_line + first as u32..).zip(&d.source[first..end]) {
            let text = strings::replace_owned(text, b"\t", b" ");
            let _ = writeln!(out, "{line:>gutter$} | {}", text.trim_ascii_end().as_bstr());
            if line == d.line {
                let (from, end) = (d.column as usize - 1, d.end_column as usize - 1);
                let to = if d.end_line == d.line {
                    end
                } else {
                    text.len()
                };
                let carets = "^".repeat(to.saturating_sub(from).max(1));
                let _ = writeln!(out, "{:1$}{carets}", "", gutter + 3 + from);
            }
        }
        out.extend_from_slice(b"</source>\n");
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
        let _ = writeln!(out, ">{}</related>", note.text.as_bstr());
    }
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
        let _ = write!(
            out,
            "file={},line={},col={},endLine={},endColumn={},",
            bun_core::fmt::github_action_property(&relative_path(&d.path, style.cwd)),
            d.line,
            d.column,
            d.end_line,
            d.end_column
        );
    }
    // (`bun_core::fmt::github_action` leaves `%` unchanged.)
    let text = strings::replace_owned(
        &strings::replace_owned(&d.text, b"%", b"%25"),
        b"\r",
        b"%0D",
    );
    let text = strings::replace_owned(&text, b"\n", b"%0A");
    let _ = writeln!(out, "title=TS{}::{}", d.code, text.as_bstr());
}

/// Writes the diagnostics, in order.
pub fn write_diagnostics(out: &mut Vec<u8>, report: &Report, style: &Style) {
    if should_group(report, style) {
        write_grouped(out, report, style);
    } else {
        for d in &report.diagnostics {
            match style.layout {
                Layout::Pretty => {
                    write_pretty(out, d, &[], style);
                    out.push(b'\n');
                }
                Layout::Plain => write_plain(out, d, style),
                Layout::Agent => write_agent(out, d, &[], style),
            }
        }
    }
    if style.github_annotations {
        for d in &report.diagnostics {
            write_github_annotation(out, d, style);
        }
    }
    for path in &report.listed_files {
        out.extend_from_slice(crate::host::to_native(path));
        out.push(b'\n');
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

/// Plain output is never grouped: tools parse it.
fn should_group(report: &Report, style: &Style) -> bool {
    style.layout != Layout::Plain && !style.show_all && report.diagnostics.len() > GROUP_THRESHOLD
}

/// Groups diagnostics by (code, message) and prints the largest groups first, each once with its number of occurrences per file.
/// A project with thousands of errors usually has a few root causes, and this puts them at the top.
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
    // The sort is stable: ties stay in source order.
    groups.sort_by_key(|group| std::cmp::Reverse(group.len()));
    let shown = groups.len().min(MAX_GROUPS);
    for group in &groups[..shown] {
        match style.layout {
            Layout::Agent => write_agent(out, group[0], &group[1..], style),
            _ => {
                write_pretty(out, group[0], &group[1..], style);
                out.push(b'\n');
            }
        }
    }
    let compact_count = (groups.len() - shown).min(MAX_COMPACT_GROUPS);
    if style.layout == Layout::Pretty && compact_count > 0 {
        let width = with_commas(groups[shown].len()).len();
        for group in &groups[shown..shown + compact_count] {
            let first = group[0];
            pretty!(
                out,
                style.color,
                "  {:>2$}  <d>TS{:<6}<r>",
                with_commas(group.len()),
                first.code,
                width
            );
            let reported = summary_line(&first.text);
            let place = alloc_print!("{}:{}", display_path(&first.path, style), first.line);
            // Truncate the message to the terminal width. Append the first location only if it fits.
            let room = match style.width {
                0 => usize::MAX,
                columns => columns.saturating_sub(width + 12),
            };
            let cut = fitting(reported, room);
            out.extend_from_slice(cut);
            if cut.len() < reported.len() {
                pretty!(out, style.color, "<d>\u{2026}<r>");
            } else if columns(reported) + columns(&place) + 2 <= room {
                pretty!(out, style.color, "  <d>{}<r>", place);
            }
            out.push(b'\n');
        }
        out.push(b'\n');
    }
    let shown = if style.layout == Layout::Pretty {
        shown + compact_count
    } else {
        shown
    };
    let rest: usize = groups[shown..].iter().map(Vec::len).sum();
    if rest == 0 {
        return;
    }
    let (errors, more) = (
        plural(rest, b"more error", b"more errors"),
        plural(groups.len() - shown, b"other kind", b"other kinds"),
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

/// The progress, as a line that overwrites the previous one. `tick`: the number of times it has
/// been drawn.
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
    // Only if the terminal is wide enough.
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

/// Whether any diagnostic is about a global or module that `@types/bun` declares.
fn is_missing_bun_types(report: &Report) -> bool {
    report.diagnostics.iter().any(|d| match d.code {
        // `Cannot find name 'console'. Do you need to change your target library? ..`
        2584 => true,
        // `Cannot find module 'bun:test' or its corresponding type declarations.`
        2307 => {
            d.text.starts_with(b"Cannot find module 'bun:")
                || d.text.starts_with(b"Cannot find module 'bun'")
        }
        // `Cannot find name 'Bun'. Do you need to install type definitions for Bun? ..`
        2867 | 2868 => true,
        _ => false,
    })
}

/// Warnings, notes, the error count, then a per-file error count for every file.
pub fn write_summary(out: &mut Vec<u8>, report: &Report, style: &Style) {
    // Diagnostics are sorted by path, so each file's errors are adjacent.
    let mut by_file: Vec<(&Diagnostic, usize)> = Vec::new();
    for d in &report.diagnostics {
        if d.category != Category::Error || d.path.is_empty() {
            continue;
        }
        match by_file.last_mut() {
            Some((first, count)) if first.path == d.path => *count += 1,
            _ => by_file.push((d, 1)),
        }
    }
    let files_with_errors = by_file.len();
    for path in &report.incomplete {
        pretty!(
            out,
            style.color,
            "<red>error<r><d>:<r> ran out of stack in {}. This is a bug in Bun: errors in this file may be missing.\n",
            relative_path(path, style.cwd)
        );
    }
    if is_missing_bun_types(report) {
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
    // Never truncated. In a terminal the end of the output is what stays on screen, so the files with the most errors go last.
    if style.layout == Layout::Pretty {
        by_file.sort_by_key(|&(_, count)| count);
    }
    let width = by_file
        .iter()
        .map(|&(_, count)| with_commas(count).len())
        .max()
        .unwrap_or(1);
    for (first, count) in &by_file {
        let path = if style.layout == Layout::Plain {
            relative_path(&first.path, style.cwd)
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
