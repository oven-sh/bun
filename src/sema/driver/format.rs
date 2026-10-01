//! Shows a [`Report`].
//!
//! For a person at a terminal: the lines of source around each error with what is wrong underlined, as Bun shows its own errors.
//! For everything else: TypeScript's plain format, which editors, continuous integration and other tools already read.

use crate::{Category, Diagnostic, Report};
use bun_core::output::ansi::{BLUE, BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW};
use std::fmt::Write;
use std::time::Duration;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Layout {
    /// Source lines, underlines and a summary.
    Pretty,
    /// `file(line,column): error TS1234: message`, as `tsc --pretty false` prints it.
    Plain,
    /// A tag for each error with the source around it inside, so that whoever reads it does not have to open the file.
    Agent,
}

#[derive(Copy, Clone)]
pub struct Style<'a> {
    pub layout: Layout,
    pub color: bool,
    /// What paths are shown relative to, as the checker names it.
    pub cwd: &'a str,
    /// Also print `::error` workflow commands, which GitHub Actions turns into annotations.
    pub github_annotations: bool,
    /// How many columns the terminal has. 0: it is not known, or there is none.
    pub width: usize,
    /// `--all`: never group identical diagnostics.
    pub show_all: bool,
}

/// Relative to the working directory, or absolute when that would need two or more `../`.
fn display_path(path: &str, style: &Style) -> String {
    let relative = relative_path(path, style.cwd);
    if relative.starts_with("../../") {
        crate::host::to_native(path).to_string()
    } else {
        relative
    }
}

/// `ConvertToRelativePath`
pub fn relative_path(path: &str, cwd: &str) -> String {
    let (mut from, mut to) = (
        cwd.split('/').filter(|p| !p.is_empty()).peekable(),
        path.split('/').filter(|p| !p.is_empty()).peekable(),
    );
    // On Windows what is on another drive has no relative path.
    if cfg!(windows) && from.peek() != to.peek() {
        return crate::host::to_native(path).to_string();
    }
    while from.peek().is_some() && from.peek() == to.peek() {
        from.next();
        to.next();
    }
    let mut out: Vec<&str> = from.map(|_| "..").collect();
    out.extend(to);
    out.join("/")
}

struct Paint {
    on: bool,
}

impl Paint {
    fn put(&self, out: &mut String, codes: &[&str], text: &str) {
        if !self.on || text.is_empty() {
            out.push_str(text);
            return;
        }
        for code in codes {
            out.push_str(code);
        }
        out.push_str(text);
        out.push_str(RESET);
    }
}

fn category_color(category: Category) -> &'static str {
    match category {
        Category::Error => RED,
        Category::Warning => YELLOW,
        Category::Suggestion => DIM,
        Category::Message => BLUE,
    }
}

/// `1234` as `1,234`.
fn with_commas(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn duration(d: Duration) -> String {
    let ms = d.as_secs_f64() * 1000.0;
    if ms < 1000.0 {
        format!("{ms:.0}ms")
    } else {
        format!("{:.2}s", ms / 1000.0)
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{} {}", with_commas(n), if n == 1 { one } else { many })
}

/// How many columns of a terminal `text` takes: two for most of what is written in East Asia and for emoji, none for what combines with the
/// character before it.
fn columns(text: &str) -> usize {
    bun_core::strings::visible::width::exclude_ansi_colors::utf8(text.as_bytes())
}

/// Where in `text` its UTF-16 offset `units` is, in bytes.
fn byte_offset(text: &str, units: u32) -> usize {
    let mut seen = 0;
    for (at, c) in text.char_indices() {
        if seen >= units {
            return at;
        }
        seen += c.len_utf16() as u32;
    }
    text.len()
}

/// The longest start of `text` that fits `width` columns.
fn fitting(text: &str, width: usize) -> &str {
    let end = bun_core::strings::visible::width::exclude_ansi_colors::utf8_index_at_width(
        text.as_bytes(),
        width,
    );
    &text[..end]
}

/// The part of `line` to show where there is room for `room` columns, so that the bytes `from..to`, which are what is wrong, are in it as far as
/// they fit: where it starts and ends, in bytes.
fn window(line: &str, from: usize, to: usize, room: usize) -> (usize, usize) {
    if room == 0 || columns(line) <= room {
        return (0, line.len());
    }
    // Room for a mark at either end.
    let room = room.saturating_sub(2).max(8);
    let wrong = columns(&line[from..to]).min(room);
    // What is wrong goes two thirds of the way along what is left: what leads up to it says more than what follows.
    let lead = (room - wrong) * 2 / 3;
    let mut start = from;
    let mut taken = 0;
    for (at, c) in line[..from].char_indices().rev() {
        taken += columns(c.encode_utf8(&mut [0; 4]));
        if taken > lead {
            break;
        }
        start = at;
    }
    if columns(&line[..start]) <= 1 {
        start = 0;
    }
    (start, start + fitting(&line[start..], room).len())
}

/// The lines the error is on with what is wrong underlined, and up to `before` lines before and `after` lines after them.
fn write_source(
    out: &mut String,
    d: &Diagnostic,
    paint: &Paint,
    before: usize,
    after: usize,
    width: usize,
    indent: &str,
) {
    if d.source.is_empty() {
        return;
    }
    let width = width.saturating_sub(indent.len());
    let first_error_index = (d.line - d.source_line) as usize;
    let error_lines = (d.end_line - d.line) as usize + 1;
    let is_blank = |i: usize| d.source[i].trim().is_empty();
    // Blank lines at either end show nothing.
    let first_shown = (first_error_index.saturating_sub(before)..first_error_index)
        .find(|&i| !is_blank(i))
        .unwrap_or(first_error_index);
    let after_error = first_error_index + error_lines;
    let end_shown = (after_error..d.source.len().min(after_error + after))
        .rev()
        .find(|&i| !is_blank(i))
        .map_or(after_error, |i| i + 1)
        .min(d.source.len());
    let gutter = (d.source_line as usize + end_shown - 1).to_string().len();
    let room = width.saturating_sub(gutter + 3);
    for (i, line) in d
        .source
        .iter()
        .enumerate()
        .take(end_shown)
        .skip(first_shown)
    {
        let in_error = i >= first_error_index && i < after_error;
        let nth = i.wrapping_sub(first_error_index);
        // Of an error that goes over five lines or more, the first two and the last two.
        if in_error && error_lines >= 5 && nth >= 2 && nth < error_lines - 2 {
            if nth == 2 {
                out.push_str(indent);
                paint.put(out, &[DIM], &format!("{:>gutter$} |", "..."));
                out.push('\n');
            }
            continue;
        }
        let line = line.replace('\t', " ");
        let line = line.trim_end();
        // What of the line is wrong, in bytes.
        let from = if !in_error {
            0
        } else if nth == 0 {
            byte_offset(line, d.column - 1)
        } else {
            line.len() - line.trim_start().len()
        };
        let to = if in_error && nth + 1 == error_lines {
            byte_offset(line, d.end_column - 1).max(from)
        } else if in_error {
            line.len()
        } else {
            0
        };
        let (start, end) = window(line, from, to, room);
        let number = format!("{:>gutter$} | ", d.source_line as usize + i);
        out.push_str(indent);
        paint.put(out, &[if in_error { BOLD } else { DIM }], &number);
        if start > 0 {
            paint.put(out, &[DIM], "\u{2026}");
        }
        // Colored as a whole: a part may start in the middle of a string.
        write_part(out, &highlighted(line, paint.on, &[]), start, end);
        if end < line.len() {
            paint.put(out, &[DIM], "\u{2026}");
        }
        out.push('\n');
        if !in_error {
            continue;
        }
        let (from, to) = (from.clamp(start, end), to.clamp(start, end));
        // An error without a length points at one character.
        let carets = columns(&line[from..to]).max(usize::from(error_lines == 1));
        if carets == 0 {
            continue;
        }
        let caret_offset = gutter + 3 + usize::from(start > 0) + columns(&line[start..from]);
        out.push_str(indent);
        out.extend(std::iter::repeat_n(' ', caret_offset));
        paint.put(
            out,
            &[BOLD, category_color(d.category)],
            &"^".repeat(carets),
        );
        out.push('\n');
    }
}

/// `code` in the colors Bun shows source in, on top of `base`.
fn highlighted(code: &str, colors: bool, base: &[&str]) -> String {
    let text = bun_core::fmt::fmt_javascript(
        code.as_bytes(),
        bun_core::fmt::HighlighterOptions {
            enable_colors: colors,
            ..Default::default()
        },
    )
    .to_string();
    if !colors || base.is_empty() {
        return text;
    }
    // Whatever ends a color ends everything.
    let base = base.concat();
    format!(
        "{base}{}{RESET}",
        text.replace(RESET, &format!("{RESET}{base}"))
    )
}

/// Of `colored`, which is text with escape sequences in it, the bytes `start..end` of the text and all the escape sequences, so that what
/// is left has the colors it had.
fn write_part(out: &mut String, colored: &str, start: usize, end: usize) {
    let (mut at, mut rest) = (0, colored);
    while let Some(c) = rest.chars().next() {
        if c == '\u{1b}' {
            let len = rest
                .find(|c: char| c.is_ascii_alphabetic())
                .map_or(rest.len(), |last| last + 1);
            out.push_str(&rest[..len]);
            rest = &rest[len..];
            continue;
        }
        if (start..end).contains(&at) {
            out.push(c);
        }
        at += c.len_utf8();
        rest = &rest[c.len_utf8()..];
    }
}

/// A message in pieces: what is prose and what is quoted from the program, which is a name or a type.
fn pieces(message: &str) -> Vec<(&str, bool)> {
    let bytes = message.as_bytes();
    let mut out = Vec::new();
    let (mut at, mut plain_from) = (0, 0);
    while at < bytes.len() {
        // A quote opens at the start or after a blank or a bracket, and closes before the end, a blank or punctuation. An apostrophe does neither.
        let opens = bytes[at] == b'\'' && (at == 0 || matches!(bytes[at - 1], b' ' | b'(' | b'['));
        let close = opens
            .then(|| {
                (at + 2..=bytes.len()).find(|&end| {
                    bytes[end - 1] == b'\''
                        && bytes.get(end).is_none_or(|next| {
                            matches!(next, b' ' | b'.' | b',' | b':' | b';' | b')' | b']' | b'?')
                        })
                })
            })
            .flatten();
        match close {
            Some(end) => {
                out.push((&message[plain_from..at], false));
                out.push((&message[at + 1..end - 1], true));
                (at, plain_from) = (end, end);
            }
            None => at += 1,
        }
    }
    out.push((&message[plain_from..], false));
    out.retain(|piece| !piece.0.is_empty() || piece.1);
    out
}

/// `message`, from the column `at` on. Where it does not fit `width` it goes on in the next line, after `hanging`.
fn write_message(
    out: &mut String,
    message: &str,
    paint: &Paint,
    prose: &[&str],
    mut at: usize,
    hanging: &str,
    width: usize,
) {
    let hang = columns(hanging);
    let mut is_first = true;
    for (piece, is_quoted) in pieces(message) {
        // Words stay whole, with the blanks after them, and so does a word with the quote before it and the punctuation after it, for which
        // there is room left.
        let mut opens = is_quoted;
        for word in piece.split_inclusive(' ') {
            let cells = columns(word.trim_end()) + usize::from(opens);
            let is_punctuation = !is_quoted && word.starts_with(['.', ',', ':', ';', ')', '?']);
            if width > 0 && !is_first && !is_punctuation && at + cells + 2 > width && at > hang {
                while out.ends_with(' ') {
                    out.pop();
                }
                out.push('\n');
                paint.put(out, &[DIM], hanging);
                at = hang;
            }
            is_first = false;
            if std::mem::take(&mut opens) {
                paint.put(out, &[DIM], "'");
                at += 1;
            }
            if is_quoted && paint.on {
                out.push_str(&highlighted(word, true, prose));
            } else {
                paint.put(out, prose, word);
            }
            at += columns(word);
        }
        if is_quoted {
            // Nothing was quoted but the quotes.
            paint.put(out, &[DIM], if opens { "''" } else { "'" });
            at += 1 + usize::from(opens);
        }
    }
    out.push('\n');
}

fn write_location(out: &mut String, d: &Diagnostic, style: &Style, paint: &Paint) {
    paint.put(out, &[CYAN], &display_path(&d.path, style));
    paint.put(out, &[DIM], ":");
    paint.put(out, &[YELLOW], &d.line.to_string());
    paint.put(out, &[DIM], ":");
    paint.put(out, &[YELLOW], &d.column.to_string());
}

/// `duplicates`: other diagnostics with the same code and message, when grouping.
fn write_pretty(
    out: &mut String,
    d: &Diagnostic,
    duplicates: &[&Diagnostic],
    style: &Style,
    paint: &Paint,
) {
    write_source(out, d, paint, 2, 0, style.width, "");
    paint.put(out, &[category_color(d.category)], d.category.name());
    // What is Bun's own to say has no code.
    let label = match d.code {
        0 => ": ".to_owned(),
        code => format!(" TS{code}: "),
    };
    paint.put(out, &[DIM], &label);
    let mut lines = d.text.split('\n');
    write_message(
        out,
        lines.next().unwrap_or(""),
        paint,
        &[BOLD],
        d.category.name().len() + label.len(),
        "    ",
        style.width,
    );
    // The reasons, each under what it is the reason for.
    let reasons: Vec<(usize, &str)> = lines
        .map(|line| {
            let text = line.trim_start_matches(' ');
            (((line.len() - text.len()) / 2).max(1), text)
        })
        .collect();
    for (i, &(depth, text)) in reasons.iter().enumerate() {
        // Whether another reason at `level` is still to come under the same one.
        let goes_on = |level: usize| {
            reasons[i + 1..]
                .iter()
                .find(|later| later.0 <= level)
                .is_some_and(|later| later.0 == level)
        };
        let mut guide = String::from("  ");
        for level in 1..depth {
            guide.push_str(if goes_on(level) { "\u{2502}  " } else { "   " });
        }
        let hanging = format!(
            "{guide}{}",
            if goes_on(depth) { "\u{2502}  " } else { "   " }
        );
        guide.push_str(if goes_on(depth) {
            "\u{251c}\u{2500} "
        } else {
            "\u{2514}\u{2500} "
        });
        paint.put(out, &[DIM], &guide);
        write_message(
            out,
            text,
            paint,
            &[],
            columns(&guide),
            &hanging,
            style.width,
        );
    }
    if !d.path.is_empty() {
        out.push_str("      ");
        paint.put(out, &[DIM], "at ");
        write_location(out, d, style, paint);
        out.push('\n');
    }
    if !duplicates.is_empty() {
        write_occurrences(out, d, duplicates, style, paint);
    }
    for note in d.related.iter().take(MAX_RELATED) {
        // Skip the excerpt if the main excerpt already shows that line.
        let is_already_visible = note.path == d.path
            && note.line <= d.line
            && note.line + 2 >= d.line
            && !d.source.is_empty();
        out.push_str("      ");
        paint.put(out, &[BLUE], "note");
        paint.put(out, &[DIM], ": ");
        write_message(out, &note.text, paint, &[], 12, "          ", style.width);
        if !note.path.is_empty() {
            out.push_str("        ");
            paint.put(out, &[DIM], "at ");
            write_location(out, note, style, paint);
            out.push('\n');
        }
        if !is_already_visible {
            write_source(out, note, paint, 0, 0, style.width, "        ");
        }
    }
}

/// `264 times in 6 files`, then the count for each file. The file list is never truncated.
fn write_occurrences(
    out: &mut String,
    first: &Diagnostic,
    duplicates: &[&Diagnostic],
    style: &Style,
    paint: &Paint,
) {
    // Diagnostics are sorted by path, so each file's are adjacent.
    let mut by_file: Vec<(&Diagnostic, usize)> = vec![(first, 1)];
    for &d in duplicates {
        match by_file.last_mut() {
            Some((of, count)) if of.path == d.path => *count += 1,
            _ => by_file.push((d, 1)),
        }
    }
    out.push_str("      ");
    let times = format!("{} times", with_commas(duplicates.len() + 1));
    paint.put(out, &[BOLD, YELLOW], &times);
    if let [_] = by_file[..] {
        let mut lines: Vec<u32> = duplicates
            .iter()
            .map(|d| d.line)
            .filter(|&line| line != first.line)
            .collect();
        lines.dedup();
        if lines.is_empty() {
            paint.put(out, &[DIM], " on this line\n");
            return;
        }
        let more = lines.len() > MAX_LINES_LISTED;
        let lines: Vec<String> = lines
            .iter()
            .take(MAX_LINES_LISTED)
            .map(|line| line.to_string())
            .collect();
        paint.put(out, &[DIM], " in this file, next on ");
        paint.put(
            out,
            &[DIM],
            if lines.len() == 1 { "line " } else { "lines " },
        );
        paint.put(out, &[YELLOW], &lines.join(", "));
        if more {
            paint.put(out, &[DIM], " \u{2026}");
        }
        out.push('\n');
        return;
    }
    paint.put(
        out,
        &[DIM],
        &format!(" in {}", plural(by_file.len(), "file", "files")),
    );
    out.push('\n');
    by_file.sort_by_key(|&(_, count)| std::cmp::Reverse(count));
    let width = with_commas(by_file[0].1).len();
    for (of, count) in &by_file {
        let _ = write!(out, "        {:>width$}  ", with_commas(*count));
        paint.put(out, &[CYAN], &display_path(&of.path, style));
        paint.put(out, &[DIM], &format!(":{}", of.line));
        out.push('\n');
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
fn write_plain(out: &mut String, d: &Diagnostic, style: &Style) {
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
            let _ = writeln!(out, "{}: {}", d.category.name(), d.text);
        }
        code => {
            let _ = writeln!(out, "{} TS{code}: {}", d.category.name(), d.text);
        }
    }
}

/// What is between the quotes of an attribute.
fn attribute(text: &str) -> String {
    text.replace('&', "&amp;").replace('"', "&quot;")
}

fn write_agent(out: &mut String, d: &Diagnostic, duplicates: &[&Diagnostic], style: &Style) {
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
    out.push_str(">\n");
    out.push_str(&d.text);
    out.push('\n');
    if !d.source.is_empty() {
        out.push_str("<source>\n");
        write_source(out, d, &Paint { on: false }, 3, 2, 0, "");
        out.push_str("</source>\n");
    }
    for note in &d.related {
        out.push_str("<related");
        if !note.path.is_empty() {
            let _ = write!(
                out,
                " file=\"{}\" line=\"{}\" column=\"{}\"",
                attribute(&display_path(&note.path, style)),
                note.line,
                note.column
            );
        }
        let _ = writeln!(out, ">{}</related>", note.text);
    }
    if !duplicates.is_empty() {
        out.push_str("<also>");
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
        out.push_str("</also>\n");
    }
    let _ = writeln!(out, "</{}>", d.category.name());
}

const MAX_AGENT_LOCATIONS: usize = 10;

/// The data of a workflow command: `%`, carriage returns and line feeds are escaped, and in a property `:` and `,` too.
fn github_escape(text: &str, is_property: bool) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '%' => out.push_str("%25"),
            '\r' => out.push_str("%0D"),
            '\n' => out.push_str("%0A"),
            ':' if is_property => out.push_str("%3A"),
            ',' if is_property => out.push_str("%2C"),
            c => out.push(c),
        }
    }
    out
}

fn write_github_annotation(out: &mut String, d: &Diagnostic, style: &Style) {
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
            github_escape(&relative_path(&d.path, style.cwd), true),
            d.line,
            d.column,
            d.end_line,
            d.end_column
        );
    }
    let _ = writeln!(out, "title=TS{}::{}", d.code, github_escape(&d.text, false));
}

/// The errors, one after the other.
pub fn write_diagnostics(out: &mut String, report: &Report, style: &Style) {
    let paint = Paint { on: style.color };
    if should_group(report, style) {
        write_grouped(out, report, style, &paint);
    } else {
        for d in &report.diagnostics {
            match style.layout {
                Layout::Pretty => {
                    write_pretty(out, d, &[], style, &paint);
                    out.push('\n');
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
}

/// The first line of a message. For TS2769 that line is always the same, so use the first specific reason under it.
fn summary_line(text: &str) -> &str {
    let mut lines = text.lines();
    let first = lines.next().unwrap_or("");
    if first != "No overload matches this call." {
        return first;
    }
    lines
        .map(str::trim_start)
        .find(|line| !line.starts_with("Overload ") && !line.starts_with("The last overload gave"))
        .unwrap_or(first)
}

/// Plain output is never grouped: tools parse it.
fn should_group(report: &Report, style: &Style) -> bool {
    style.layout != Layout::Plain && !style.show_all && report.diagnostics.len() > GROUP_THRESHOLD
}

/// Groups diagnostics by (code, message) and prints the largest groups first, each once with its number of occurrences per file.
/// A project with thousands of errors usually has a few root causes, and this puts them at the top.
fn write_grouped(out: &mut String, report: &Report, style: &Style, paint: &Paint) {
    let mut index: std::collections::HashMap<(u32, &str), usize> = std::collections::HashMap::new();
    let mut groups: Vec<Vec<&Diagnostic>> = Vec::new();
    for d in &report.diagnostics {
        let at = *index.entry((d.code, d.text.as_str())).or_insert_with(|| {
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
                write_pretty(out, group[0], &group[1..], style, paint);
                out.push('\n');
            }
        }
    }
    let compact_count = (groups.len() - shown).min(MAX_COMPACT_GROUPS);
    if style.layout == Layout::Pretty && compact_count > 0 {
        let width = with_commas(groups[shown].len()).len();
        for group in &groups[shown..shown + compact_count] {
            let first = group[0];
            let _ = write!(out, "  {:>width$}  ", with_commas(group.len()));
            let code = format!("TS{:<6}", first.code);
            paint.put(out, &[DIM], &code);
            let said = summary_line(&first.text);
            let place = format!("{}:{}", display_path(&first.path, style), first.line);
            // Truncate the message to the terminal width. Append the first location only if it fits.
            let room = match style.width {
                0 => usize::MAX,
                columns => columns.saturating_sub(width + 12),
            };
            let cut = fitting(said, room);
            out.push_str(cut);
            if cut.len() < said.len() {
                paint.put(out, &[DIM], "\u{2026}");
            } else if columns(said) + columns(&place) + 2 <= room {
                out.push_str("  ");
                paint.put(out, &[DIM], &place);
            }
            out.push('\n');
        }
        out.push('\n');
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
        plural(rest, "more error", "more errors"),
        plural(groups.len() - shown, "other kind", "other kinds"),
    );
    if style.layout == Layout::Agent {
        let _ = writeln!(
            out,
            "<not-shown>{errors} of {more}. Run `bun check --all` to list every error, or `bun check <path>` to check one file or directory.</not-shown>"
        );
        return;
    }
    paint.put(out, &[BOLD], &format!("{errors} of {more}"));
    paint.put(out, &[DIM], " not shown\n");
    for (command, shows) in [
        ("bun check --all ", "show every error"),
        ("bun check <path>", "check one file or directory"),
    ] {
        out.push_str("  ");
        paint.put(out, &[CYAN], command);
        paint.put(out, &[DIM], &format!("  {shows}\n"));
    }
    out.push('\n');
}

/// How far it has got, in a line that takes the place of the one before it. `tick` counts how often it has been shown.
pub fn write_progress(out: &mut String, progress: &crate::Progress, style: &Style, tick: usize) {
    use std::sync::atomic::Ordering::Relaxed;
    const SPINNER: [&str; 10] = [
        "\u{280b}", "\u{2819}", "\u{2839}", "\u{2838}", "\u{283c}", "\u{2834}", "\u{2826}",
        "\u{2827}", "\u{2807}", "\u{280f}",
    ];
    const BAR: usize = 24;
    let paint = Paint { on: style.color };
    out.push_str(ERASE_LINE);
    paint.put(out, &[CYAN], SPINNER[tick % SPINNER.len()]);
    let (total, done) = (
        progress.to_check.load(Relaxed),
        progress.checked.load(Relaxed),
    );
    if total == 0 {
        out.push_str(" Loading");
        paint.put(out, &[DIM], "\u{2026}");
        return;
    }
    out.push_str(" Checking ");
    // Only where there is room for it.
    if style.width == 0 || style.width >= 72 {
        let bytes = progress.bytes_to_check.load(Relaxed).max(1);
        let filled = (progress.bytes_checked.load(Relaxed) * BAR / bytes).min(BAR);
        paint.put(out, &[CYAN], &"\u{2501}".repeat(filled));
        paint.put(out, &[DIM], &"\u{2501}".repeat(BAR - filled));
        out.push(' ');
    }
    out.push_str(&with_commas(done));
    paint.put(out, &[DIM], &format!(" / {} files", with_commas(total)));
    match progress.errors.load(Relaxed) {
        0 => {}
        errors => {
            paint.put(out, &[DIM], ", ");
            paint.put(out, &[RED], &plural(errors, "error", "errors"));
        }
    }
}

/// Back to the start of the line, with nothing on it.
pub const ERASE_LINE: &str = "\r\u{1b}[2K";

/// Whether any diagnostic is about a global or module that `@types/bun` declares.
fn is_missing_bun_types(report: &Report) -> bool {
    report.diagnostics.iter().any(|d| match d.code {
        // `Cannot find name 'console'. Do you need to change your target library? ..`
        2584 => true,
        // `Cannot find module 'bun:test' or its corresponding type declarations.`
        2307 => {
            d.text.starts_with("Cannot find module 'bun:")
                || d.text.starts_with("Cannot find module 'bun'")
        }
        // `Cannot find name 'Bun'. Do you need to install type definitions for Bun? ..`
        2867 | 2868 => true,
        _ => false,
    })
}

/// Warnings, hints, the error count, then a per-file error count for every file.
pub fn write_summary(out: &mut String, report: &Report, style: &Style) {
    let paint = Paint { on: style.color };
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
    for path in &report.gave_up {
        paint.put(out, &[YELLOW], "warning");
        paint.put(out, &[DIM], ": ");
        let _ = writeln!(
            out,
            "gave up on {}, which took too long to check. This is a bug in Bun: nothing is reported for this file.",
            relative_path(path, style.cwd)
        );
    }
    for path in &report.incomplete {
        paint.put(out, &[YELLOW], "warning");
        paint.put(out, &[DIM], ": ");
        let _ = writeln!(
            out,
            "ran out of stack in {}. This is a bug in Bun: errors in this file may be missing.",
            relative_path(path, style.cwd)
        );
    }
    if style.layout != Layout::Plain && is_missing_bun_types(report) {
        paint.put(out, &[BLUE], "hint");
        paint.put(out, &[DIM], ": ");
        out.push_str(
            "Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: ",
        );
        paint.put(out, &[CYAN], "bun add -d @types/bun");
        out.push('\n');
    }
    let errors = report.error_count();
    let took = format!(" [{}]", duration(report.load_time + report.check_time));
    if errors == 0 {
        paint.put(out, &[GREEN], "\u{2713}");
        out.push_str(" No type errors");
        paint.put(
            out,
            &[DIM],
            &format!(
                " in {}{took}",
                plural(report.files_checked, "file", "files")
            ),
        );
        out.push('\n');
        return;
    }
    paint.put(
        out,
        &[BOLD, RED],
        &format!("Found {}", plural(errors, "error", "errors")),
    );
    if files_with_errors > 0 {
        let _ = write!(out, " in {}", plural(files_with_errors, "file", "files"));
    }
    paint.put(
        out,
        &[DIM],
        &format!(
            ", checked {}{took}",
            plural(report.files_checked, "file", "files")
        ),
    );
    out.push('\n');
    if files_with_errors < 2 {
        return;
    }
    out.push('\n');
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
        let _ = write!(out, "  {:>width$}  ", with_commas(*count));
        let path = if style.layout == Layout::Plain {
            relative_path(&first.path, style.cwd)
        } else {
            display_path(&first.path, style)
        };
        paint.put(out, &[CYAN], &path);
        paint.put(out, &[DIM], &format!(":{}", first.line));
        out.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        assert_eq!(relative_path("/a/b/c.ts", "/a/b"), "c.ts");
        assert_eq!(relative_path("/a/b/d/c.ts", "/a/b"), "d/c.ts");
        assert_eq!(relative_path("/a/x/c.ts", "/a/b"), "../x/c.ts");
        assert_eq!(relative_path("/x/c.ts", "/a/b"), "../../x/c.ts");
    }

    #[test]
    fn numbers() {
        assert_eq!(with_commas(7), "7");
        assert_eq!(with_commas(1234), "1,234");
        assert_eq!(with_commas(1234567), "1,234,567");
        assert_eq!(duration(Duration::from_millis(412)), "412ms");
        assert_eq!(duration(Duration::from_millis(2412)), "2.41s");
    }

    #[test]
    fn what_is_quoted() {
        assert_eq!(
            pieces("Type 'string' is not assignable to type 'number'."),
            [
                ("Type ", false),
                ("string", true),
                (" is not assignable to type ", false),
                ("number", true),
                (".", false)
            ]
        );
        // An apostrophe inside a string literal type, and one in prose.
        assert_eq!(
            pieces("Type '\"it's\"' isn't 'a'"),
            [
                ("Type ", false),
                ("\"it's\"", true),
                (" isn't ", false),
                ("a", true)
            ]
        );
        assert_eq!(
            pieces("Expression expected."),
            [("Expression expected.", false)]
        );
    }

    #[test]
    fn workflow_commands_are_escaped() {
        assert_eq!(github_escape("a%b\nc:d,e", false), "a%25b%0Ac:d,e");
        assert_eq!(github_escape("a:b,c", true), "a%3Ab%2Cc");
    }
}
