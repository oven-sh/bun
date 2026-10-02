//! Shows a [`Report`].
//!
//! For a person at a terminal: the lines of source around each error with what is wrong underlined, as Bun shows its own errors.
//! For everything else: TypeScript's plain format, which editors, continuous integration and other tools already read.

use crate::{Category, Diagnostic, Report};
use bstr::{BString, ByteSlice};
use bun_core::output::ansi;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::relative_normalized;
use bun_sema::util::FxHashMap;
use std::io::Write;
use std::time::Duration;

macro_rules! alloc_print {
    ($($arg:tt)*) => {{
        let mut out = BString::default();
        let _ = write!(out, $($arg)*);
        out
    }};
}

const BLUE: &[u8] = ansi::BLUE.as_bytes();
const BOLD: &[u8] = ansi::BOLD.as_bytes();
const CYAN: &[u8] = ansi::CYAN.as_bytes();
const DIM: &[u8] = ansi::DIM.as_bytes();
const GREEN: &[u8] = ansi::GREEN.as_bytes();
const RED: &[u8] = ansi::RED.as_bytes();
const RESET: &[u8] = ansi::RESET.as_bytes();
const YELLOW: &[u8] = ansi::YELLOW.as_bytes();

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
    pub cwd: &'a [u8],
    /// Also print `::error` workflow commands, which GitHub Actions turns into annotations.
    pub github_annotations: bool,
    /// How many columns the terminal has. 0: it is not known, or there is none.
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
    // On Windows what is on another drive has no relative path.
    if cfg!(windows) && path.get(..3) != cwd.get(..3) {
        return crate::host::to_native(path).into();
    }
    relative_normalized::<Posix, true>(cwd, path).into()
}

struct Paint {
    on: bool,
}

impl Paint {
    fn put(&self, out: &mut Vec<u8>, codes: &[&[u8]], text: &[u8]) {
        if !self.on || text.is_empty() {
            out.extend_from_slice(text);
            return;
        }
        for code in codes {
            out.extend_from_slice(code);
        }
        out.extend_from_slice(text);
        out.extend_from_slice(RESET);
    }
}

fn category_color(category: Category) -> &'static [u8] {
    match category {
        Category::Error => RED,
        Category::Warning => YELLOW,
        Category::Suggestion => DIM,
        Category::Message => BLUE,
    }
}

/// `1234` as `1,234`.
fn with_commas(n: usize) -> BString {
    let digits = alloc_print!("{n}");
    let mut out = BString::default();
    for (i, &c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(b',');
        }
        out.push(c);
    }
    out
}

fn duration(d: Duration) -> BString {
    let ms = d.as_secs_f64() * 1000.0;
    if ms < 1000.0 {
        alloc_print!("{ms:.0}ms")
    } else {
        alloc_print!("{:.2}s", ms / 1000.0)
    }
}

fn plural(n: usize, one: &[u8], many: &[u8]) -> BString {
    let noun = if n == 1 { one } else { many };
    alloc_print!("{} {}", with_commas(n), noun.as_bstr())
}

/// How many columns of a terminal `text` takes: two for most of what is written in East Asia and for emoji, none for what combines with the
/// character before it.
fn columns(text: &[u8]) -> usize {
    bun_core::strings::visible::width::exclude_ansi_colors::utf8(text)
}

/// Where in `text` its UTF-16 offset `units` is, in bytes.
fn byte_offset(text: &[u8], units: u32) -> usize {
    let mut seen = 0;
    for (at, _, c) in text.char_indices() {
        if seen >= units {
            return at;
        }
        seen += c.len_utf16() as u32;
    }
    text.len()
}

/// The longest start of `text` that fits `width` columns.
fn fitting(text: &[u8], width: usize) -> &[u8] {
    let end =
        bun_core::strings::visible::width::exclude_ansi_colors::utf8_index_at_width(text, width);
    &text[..end]
}

/// The part of `line` to show where there is room for `room` columns, so that the bytes `from..to`, which are what is wrong, are in it as far as
/// they fit: where it starts and ends, in bytes.
fn window(line: &[u8], from: usize, to: usize, room: usize) -> (usize, usize) {
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
    for (at, end, _) in line[..from].char_indices().rev() {
        taken += columns(&line[at..end]);
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
    out: &mut Vec<u8>,
    d: &Diagnostic,
    paint: &Paint,
    before: usize,
    after: usize,
    width: usize,
    indent: &[u8],
) {
    if d.source.is_empty() {
        return;
    }
    let width = width.saturating_sub(indent.len());
    let first_error_index = (d.line - d.source_line) as usize;
    let error_lines = (d.end_line - d.line) as usize + 1;
    let is_blank = |i: usize| d.source[i].trim_ascii().is_empty();
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
    let gutter = bun_core::fmt::digit_count(d.source_line as usize + end_shown - 1);
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
                out.extend_from_slice(indent);
                paint.put(out, &[DIM], &alloc_print!("{:>gutter$} |", "..."));
                out.push(b'\n');
            }
            continue;
        }
        let line = line.replace(b"\t", b" ");
        let line = line.trim_ascii_end();
        // What of the line is wrong, in bytes.
        let from = if !in_error {
            0
        } else if nth == 0 {
            byte_offset(line, d.column - 1)
        } else {
            line.len() - line.trim_ascii_start().len()
        };
        let to = if in_error && nth + 1 == error_lines {
            byte_offset(line, d.end_column - 1).max(from)
        } else if in_error {
            line.len()
        } else {
            0
        };
        let (start, end) = window(line, from, to, room);
        let number = alloc_print!("{:>gutter$} | ", d.source_line as usize + i);
        out.extend_from_slice(indent);
        paint.put(out, &[if in_error { BOLD } else { DIM }], &number);
        if start > 0 {
            paint.put(out, &[DIM], "\u{2026}".as_bytes());
        }
        // Colored as a whole: a part may start in the middle of a string.
        write_part(out, &highlighted(line, paint.on, &[]), start, end);
        if end < line.len() {
            paint.put(out, &[DIM], "\u{2026}".as_bytes());
        }
        out.push(b'\n');
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
        out.extend_from_slice(indent);
        out.extend(std::iter::repeat_n(b' ', caret_offset));
        paint.put(
            out,
            &[BOLD, category_color(d.category)],
            &b"^".repeat(carets),
        );
        out.push(b'\n');
    }
}

/// `code` in the colors Bun shows source in, on top of `base`.
fn highlighted(code: &[u8], colors: bool, base: &[&[u8]]) -> BString {
    let options = bun_core::fmt::HighlighterOptions {
        enable_colors: colors,
        ..Default::default()
    };
    let text = alloc_print!("{}", bun_core::fmt::fmt_javascript(code, options));
    if !colors || base.is_empty() {
        return text;
    }
    // Whatever ends a color ends everything.
    let base = base.concat();
    let text = text.replace(RESET, [RESET, &base].concat());
    [&base, &text, RESET].concat().into()
}

/// Of `colored`, which is text with escape sequences in it, the bytes `start..end` of the text and all the escape sequences, so that what
/// is left has the colors it had.
fn write_part(out: &mut Vec<u8>, colored: &[u8], start: usize, end: usize) {
    let (mut at, mut rest) = (0, colored);
    while let Some((_, len, c)) = rest.char_indices().next() {
        if c == '\u{1b}' {
            let len = rest
                .iter()
                .position(u8::is_ascii_alphabetic)
                .map_or(rest.len(), |last| last + 1);
            out.extend_from_slice(&rest[..len]);
            rest = &rest[len..];
            continue;
        }
        if (start..end).contains(&at) {
            out.extend_from_slice(&rest[..len]);
        }
        at += len;
        rest = &rest[len..];
    }
}

/// A message in pieces: what is prose and what is quoted from the program, which is a name or a type.
fn pieces(message: &[u8]) -> Vec<(&[u8], bool)> {
    let bytes = message;
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
    out: &mut Vec<u8>,
    message: &[u8],
    paint: &Paint,
    prose: &[&[u8]],
    mut at: usize,
    hanging: &[u8],
    width: usize,
) {
    let hang = columns(hanging);
    let mut is_first = true;
    for (piece, is_quoted) in pieces(message) {
        // Words stay whole, with the blanks after them, and so does a word with the quote before it and the punctuation after it, for which
        // there is room left.
        let mut opens = is_quoted;
        for word in piece.split_inclusive(|&b| b == b' ') {
            let cells = columns(word.trim_ascii_end()) + usize::from(opens);
            let is_punctuation =
                !is_quoted && matches!(word, [b'.' | b',' | b':' | b';' | b')' | b'?', ..]);
            if width > 0 && !is_first && !is_punctuation && at + cells + 2 > width && at > hang {
                while out.ends_with(b" ") {
                    out.pop();
                }
                out.push(b'\n');
                paint.put(out, &[DIM], hanging);
                at = hang;
            }
            is_first = false;
            if std::mem::take(&mut opens) {
                paint.put(out, &[DIM], b"'");
                at += 1;
            }
            if is_quoted && paint.on {
                out.extend_from_slice(&highlighted(word, true, prose));
            } else {
                paint.put(out, prose, word);
            }
            at += columns(word);
        }
        if is_quoted {
            // Nothing was quoted but the quotes.
            paint.put(out, &[DIM], if opens { b"''" } else { b"'" });
            at += 1 + usize::from(opens);
        }
    }
    out.push(b'\n');
}

fn write_location(out: &mut Vec<u8>, d: &Diagnostic, style: &Style, paint: &Paint) {
    paint.put(out, &[CYAN], &display_path(&d.path, style));
    paint.put(out, &[DIM], b":");
    paint.put(out, &[YELLOW], &alloc_print!("{}", d.line));
    paint.put(out, &[DIM], b":");
    paint.put(out, &[YELLOW], &alloc_print!("{}", d.column));
}

/// `duplicates`: other diagnostics with the same code and message, when grouping.
fn write_pretty(
    out: &mut Vec<u8>,
    d: &Diagnostic,
    duplicates: &[&Diagnostic],
    style: &Style,
    paint: &Paint,
) {
    write_source(out, d, paint, 2, 0, style.width, b"");
    paint.put(
        out,
        &[category_color(d.category)],
        d.category.name().as_bytes(),
    );
    // What is Bun's own to say has no code.
    let label = match d.code {
        0 => ": ".into(),
        code => alloc_print!(" TS{code}: "),
    };
    paint.put(out, &[DIM], &label);
    let mut lines = d.text.split(|&b| b == b'\n');
    write_message(
        out,
        lines.next().unwrap_or(b""),
        paint,
        &[BOLD],
        d.category.name().len() + label.len(),
        b"    ",
        style.width,
    );
    // The reasons, each under what it is the reason for.
    let reasons: Vec<(usize, &[u8])> = lines
        .map(|line| {
            let text = line.trim_start_with(|c| c == ' ');
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
        let mut guide = b"  ".to_vec();
        for level in 1..depth {
            guide.extend_from_slice(if goes_on(level) {
                "\u{2502}  ".as_bytes()
            } else {
                b"   "
            });
        }
        let hanging = [
            &guide,
            if goes_on(depth) { "\u{2502}  " } else { "   " }.as_bytes(),
        ]
        .concat();
        guide.extend_from_slice(if goes_on(depth) {
            "\u{251c}\u{2500} ".as_bytes()
        } else {
            "\u{2514}\u{2500} ".as_bytes()
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
        out.extend_from_slice(b"      ");
        paint.put(out, &[DIM], b"at ");
        write_location(out, d, style, paint);
        out.push(b'\n');
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
        out.extend_from_slice(b"      ");
        paint.put(out, &[BLUE], b"note");
        paint.put(out, &[DIM], b": ");
        write_message(out, &note.text, paint, &[], 12, b"          ", style.width);
        if !note.path.is_empty() {
            out.extend_from_slice(b"        ");
            paint.put(out, &[DIM], b"at ");
            write_location(out, note, style, paint);
            out.push(b'\n');
        }
        if !is_already_visible {
            write_source(out, note, paint, 0, 0, style.width, b"        ");
        }
    }
}

/// `264 times in 6 files`, then the count for each file. The file list is never truncated.
fn write_occurrences(
    out: &mut Vec<u8>,
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
    out.extend_from_slice(b"      ");
    let times = alloc_print!("{} times", with_commas(duplicates.len() + 1));
    paint.put(out, &[BOLD, YELLOW], &times);
    if let [_] = by_file[..] {
        let mut lines: Vec<u32> = duplicates
            .iter()
            .map(|d| d.line)
            .filter(|&line| line != first.line)
            .collect();
        lines.dedup();
        if lines.is_empty() {
            paint.put(out, &[DIM], b" on this line\n");
            return;
        }
        let more = lines.len() > MAX_LINES_LISTED;
        let lines: Vec<BString> = lines
            .iter()
            .take(MAX_LINES_LISTED)
            .map(|line| alloc_print!("{line}"))
            .collect();
        paint.put(out, &[DIM], b" in this file, next on ");
        paint.put(
            out,
            &[DIM],
            if lines.len() == 1 {
                b"line "
            } else {
                b"lines "
            },
        );
        paint.put(out, &[YELLOW], &bstr::join(", ", lines));
        if more {
            paint.put(out, &[DIM], " \u{2026}".as_bytes());
        }
        out.push(b'\n');
        return;
    }
    paint.put(
        out,
        &[DIM],
        &alloc_print!(" in {}", plural(by_file.len(), b"file", b"files")),
    );
    out.push(b'\n');
    by_file.sort_by_key(|&(_, count)| std::cmp::Reverse(count));
    let width = with_commas(by_file[0].1).len();
    for (of, count) in &by_file {
        let _ = write!(out, "        {:>width$}  ", with_commas(*count));
        paint.put(out, &[CYAN], &display_path(&of.path, style));
        paint.put(out, &[DIM], &alloc_print!(":{}", of.line));
        out.push(b'\n');
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

/// What is between the quotes of an attribute.
fn attribute(text: &[u8]) -> BString {
    text.replace(b"&", b"&amp;")
        .replace(b"\"", b"&quot;")
        .into()
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
        write_source(out, d, &Paint { on: false }, 3, 2, 0, b"");
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
    // (`bun_core::fmt::github_action` leaves `%` as it is.)
    let text = d.text.replace(b"%", b"%25").replace(b"\r", b"%0D");
    let text = text.replace(b"\n", b"%0A");
    let _ = writeln!(out, "title=TS{}::{}", d.code, text.as_bstr());
}

/// The errors, one after the other.
pub fn write_diagnostics(out: &mut Vec<u8>, report: &Report, style: &Style) {
    let paint = Paint { on: style.color };
    if should_group(report, style) {
        write_grouped(out, report, style, &paint);
    } else {
        for d in &report.diagnostics {
            match style.layout {
                Layout::Pretty => {
                    write_pretty(out, d, &[], style, &paint);
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
fn write_grouped(out: &mut Vec<u8>, report: &Report, style: &Style, paint: &Paint) {
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
                write_pretty(out, group[0], &group[1..], style, paint);
                out.push(b'\n');
            }
        }
    }
    let compact_count = (groups.len() - shown).min(MAX_COMPACT_GROUPS);
    if style.layout == Layout::Pretty && compact_count > 0 {
        let width = with_commas(groups[shown].len()).len();
        for group in &groups[shown..shown + compact_count] {
            let first = group[0];
            let _ = write!(out, "  {:>width$}  ", with_commas(group.len()));
            let code = alloc_print!("TS{:<6}", first.code);
            paint.put(out, &[DIM], &code);
            let said = summary_line(&first.text);
            let place = alloc_print!("{}:{}", display_path(&first.path, style), first.line);
            // Truncate the message to the terminal width. Append the first location only if it fits.
            let room = match style.width {
                0 => usize::MAX,
                columns => columns.saturating_sub(width + 12),
            };
            let cut = fitting(said, room);
            out.extend_from_slice(cut);
            if cut.len() < said.len() {
                paint.put(out, &[DIM], "\u{2026}".as_bytes());
            } else if columns(said) + columns(&place) + 2 <= room {
                out.extend_from_slice(b"  ");
                paint.put(out, &[DIM], &place);
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
    paint.put(out, &[BOLD], &[&errors[..], b" of ", &more[..]].concat());
    paint.put(out, &[DIM], b" not shown\n");
    for (command, shows) in [
        (b"bun check --all ", &b"show every error"[..]),
        (b"bun check <path>", b"check one file or directory"),
    ] {
        out.extend_from_slice(b"  ");
        paint.put(out, &[CYAN], command);
        paint.put(out, &[DIM], &[&b"  "[..], &shows[..], b"\n"].concat());
    }
    out.push(b'\n');
}

/// How far it has got, in a line that takes the place of the one before it. `tick` counts how often it has been shown.
pub fn write_progress(out: &mut Vec<u8>, progress: &crate::Progress, style: &Style, tick: usize) {
    use std::sync::atomic::Ordering::Relaxed;
    const SPINNER: [&[u8]; 10] = [
        "\u{280b}".as_bytes(),
        "\u{2819}".as_bytes(),
        "\u{2839}".as_bytes(),
        "\u{2838}".as_bytes(),
        "\u{283c}".as_bytes(),
        "\u{2834}".as_bytes(),
        "\u{2826}".as_bytes(),
        "\u{2827}".as_bytes(),
        "\u{2807}".as_bytes(),
        "\u{280f}".as_bytes(),
    ];
    const BAR: usize = 24;
    let paint = Paint { on: style.color };
    out.extend_from_slice(ERASE_LINE);
    paint.put(out, &[CYAN], SPINNER[tick % SPINNER.len()]);
    let (total, done) = (
        progress.to_check.load(Relaxed),
        progress.checked.load(Relaxed),
    );
    if total == 0 {
        out.extend_from_slice(b" Loading");
        paint.put(out, &[DIM], "\u{2026}".as_bytes());
        return;
    }
    out.extend_from_slice(b" Checking ");
    // Only where there is room for it.
    if style.width == 0 || style.width >= 72 {
        let bytes = progress.bytes_to_check.load(Relaxed).max(1);
        let filled = (progress.bytes_checked.load(Relaxed) * BAR / bytes).min(BAR);
        paint.put(out, &[CYAN], &"\u{2501}".as_bytes().repeat(filled));
        paint.put(out, &[DIM], &"\u{2501}".as_bytes().repeat(BAR - filled));
        out.push(b' ');
    }
    out.extend_from_slice(&with_commas(done));
    paint.put(
        out,
        &[DIM],
        &alloc_print!(" / {} files", with_commas(total)),
    );
    match progress.errors.load(Relaxed) {
        0 => {}
        errors => {
            paint.put(out, &[DIM], b", ");
            paint.put(out, &[RED], &plural(errors, b"error", b"errors"));
        }
    }
}

/// Back to the start of the line, with nothing on it.
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

/// Warnings, hints, the error count, then a per-file error count for every file.
pub fn write_summary(out: &mut Vec<u8>, report: &Report, style: &Style) {
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
    for path in &report.incomplete {
        paint.put(out, &[RED], b"error");
        paint.put(out, &[DIM], b": ");
        let _ = writeln!(
            out,
            "ran out of stack in {}. This is a bug in Bun: errors in this file may be missing.",
            relative_path(path, style.cwd)
        );
    }
    if is_missing_bun_types(report) {
        paint.put(out, &[BLUE], b"hint");
        paint.put(out, &[DIM], b": ");
        if report.has_bun_types_installed {
            out.extend_from_slice(
                b"Bun's type definitions (console, fetch, Bun, bun:test) are installed, but tsconfig.json does not include them. Add to compilerOptions: ",
            );
            paint.put(out, &[CYAN], b"\"types\": [\"bun\"]");
        } else {
            out.extend_from_slice(
                b"Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: ",
            );
            paint.put(out, &[CYAN], b"bun add -d @types/bun");
        }
        out.push(b'\n');
    }
    let errors = report.error_count();
    let took = alloc_print!(" [{}]", duration(report.load_time + report.check_time));
    let projects = match report.projects_checked {
        0 => BString::default(),
        n => alloc_print!(" across {}", plural(n, b"project", b"projects")),
    };
    if errors == 0 && !report.incomplete.is_empty() {
        paint.put(
            out,
            &[BOLD, RED],
            &alloc_print!(
                "Could not finish checking {}",
                plural(report.incomplete.len(), b"file", b"files")
            ),
        );
        paint.put(
            out,
            &[DIM],
            &alloc_print!(
                ", checked {}{projects}{took}",
                plural(report.files_checked, b"file", b"files")
            ),
        );
        out.push(b'\n');
        return;
    }
    if errors == 0 {
        paint.put(out, &[GREEN], "\u{2713}".as_bytes());
        out.extend_from_slice(b" No type errors");
        paint.put(
            out,
            &[DIM],
            &alloc_print!(
                " in {}{projects}{took}",
                plural(report.files_checked, b"file", b"files")
            ),
        );
        out.push(b'\n');
        return;
    }
    paint.put(
        out,
        &[BOLD, RED],
        &alloc_print!("Found {}", plural(errors, b"error", b"errors")),
    );
    if files_with_errors > 0 {
        let _ = write!(out, " in {}", plural(files_with_errors, b"file", b"files"));
    }
    paint.put(
        out,
        &[DIM],
        &alloc_print!(
            ", checked {}{projects}{took}",
            plural(report.files_checked, b"file", b"files")
        ),
    );
    out.push(b'\n');
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
        let _ = write!(out, "  {:>width$}  ", with_commas(*count));
        let path = if style.layout == Layout::Plain {
            relative_path(&first.path, style.cwd)
        } else {
            display_path(&first.path, style)
        };
        paint.put(out, &[CYAN], &path);
        paint.put(out, &[DIM], &alloc_print!(":{}", first.line));
        out.push(b'\n');
    }
}
