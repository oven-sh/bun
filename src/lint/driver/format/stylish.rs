//! ESLint's `stylish` formatter, byte for byte.

use crate::results::{Counts, FileResult};
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::regex::Regex;
use std::io::Write;
use std::sync::LazyLock;

/// `util.styleText(format, text)`
struct Style {
    open: &'static [u8],
    close: &'static [u8],
}

const UNDERLINE: Style = Style {
    open: b"\x1b[4m",
    close: b"\x1b[24m",
};
const RED: Style = Style {
    open: b"\x1b[31m",
    close: b"\x1b[39m",
};
const YELLOW: Style = Style {
    open: b"\x1b[33m",
    close: b"\x1b[39m",
};
const DIM: Style = Style {
    open: b"\x1b[2m",
    close: b"\x1b[22m",
};
const BOLD: Style = Style {
    open: b"\x1b[1m",
    close: b"\x1b[22m",
};
const RESET: Style = Style {
    open: b"\x1b[0m",
    close: b"\x1b[0m",
};

fn styled(out: &mut Vec<u8>, color: bool, style: &Style, text: &[u8]) {
    if color {
        out.extend_from_slice(style.open);
    }
    out.extend_from_slice(text);
    if color {
        out.extend_from_slice(style.close);
    }
}

/// The length of the white space, as `\s` and `trimEnd()` see it, that `text` starts with: of one
/// character.
fn space_len(text: &[u8]) -> usize {
    match text {
        [b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ', ..] => 1,
        [0xC2, 0xA0, ..] => 2,
        [0xE1, 0x9A, 0x80, ..]
        | [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..]
        | [0xEF, 0xBB, 0xBF, ..] => 3,
        _ => 0,
    }
}

/// `text.trimEnd()`
fn trim_end(text: &mut Vec<u8>) {
    loop {
        let len = text.len();
        let space = (1..=3usize).find(|&n| n <= len && space_len(&text[len - n..]) == n);
        match space {
            Some(n) => text.truncate(len - n),
            None => return,
        }
    }
}

/// What `util.stripVTControlCharacters` removes.
static CONTROL_SEQUENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(concat!(
        r"/[\u001B\u009B][[\]()#;?]*",
        r"(?:(?:(?:(?:;[-a-zA-Z\d\/\#&.:=?%@~_]+)*",
        r"|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/\#&.:=?%@~_]*)*)?",
        r"(?:\u0007|\u001B\|\u009C))",
        r"|(?:(?:\d{1,4}(?:;\d{0,4})*)?",
        r"[\dA-PR-TZcf-nq-uy=><~]))/g"
    ))
});

/// `stringLength`
fn visible_len(text: &[u8]) -> usize {
    if strings::contains_char(text, 0x1B) || strings::contains(text, "\u{9b}".as_bytes()) {
        return bun_lint::source::utf16_len(&CONTROL_SEQUENCE.replace(text, b"")) as usize;
    }
    bun_lint::source::utf16_len(text) as usize
}

/// `line.replace(/(\d+)\s+(\d+)/u, (m, p1, p2) => styleText("dim", `${p1}:${p2}`))`
fn write_line_with_position(out: &mut Vec<u8>, color: bool, line: &[u8]) {
    let digits = |from: usize| {
        line[from..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count()
    };
    let mut at = 0;
    while at < line.len() {
        let first = digits(at);
        if first == 0 {
            at += 1;
            continue;
        }
        let mut second = at + first;
        while let n @ 1.. = space_len(&line[second..]) {
            second += n;
        }
        let second_len = digits(second);
        if second == at + first || second_len == 0 {
            at += first;
            continue;
        }
        out.extend_from_slice(&line[..at]);
        let position = [
            &line[at..at + first],
            b":",
            &line[second..second + second_len],
        ]
        .concat();
        styled(out, color, &DIM, &position);
        out.extend_from_slice(&line[second + second_len..]);
        return;
    }
    out.extend_from_slice(line);
}

struct Row {
    line: Vec<u8>,
    column: Vec<u8>,
    is_error: bool,
    message: Vec<u8>,
    message_len: usize,
    rule: Vec<u8>,
}

fn number(n: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(4);
    let _ = write!(out, "{n}");
    out
}

fn pad(out: &mut Vec<u8>, count: usize) {
    out.resize(out.len() + count, b' ');
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

pub(super) fn write(out: &mut Vec<u8>, results: &[FileResult], color: bool) {
    let mut counts = Counts::default();
    let mut has_errors = false;
    let start = out.len();
    if color {
        out.extend_from_slice(RESET.open);
    }
    out.push(b'\n');
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        counts.add(result.counts);
        styled(out, color, &UNDERLINE, &result.path);
        out.push(b'\n');
        let rows: Vec<Row> = (result.messages.iter())
            .map(|message| {
                let text = match &message.message[..] {
                    [.., before, b'.'] if *before != b' ' => {
                        &message.message[..message.message.len() - 1]
                    }
                    text => text,
                };
                Row {
                    line: number(message.line),
                    column: number(message.column),
                    is_error: message.is_fatal || message.severity == Severity::Error,
                    message: text.to_vec(),
                    message_len: visible_len(text),
                    rule: message
                        .rule_id
                        .as_ref()
                        .map(|id| id.to_vec())
                        .unwrap_or_default(),
                }
            })
            .collect();
        let widest = |len: &dyn Fn(&Row) -> usize| rows.iter().map(len).max().unwrap_or(0);
        let kind_len = |row: &Row| if row.is_error { 5 } else { 7 };
        let (lines, columns) = (
            widest(&|row| row.line.len()),
            widest(&|row| row.column.len()),
        );
        let (kinds, messages) = (widest(&kind_len), widest(&|row| row.message_len));
        let rules = widest(&|row| visible_len(&row.rule));
        let mut text = Vec::new();
        for (i, row) in rows.iter().enumerate() {
            has_errors |= row.is_error;
            text.clear();
            text.extend_from_slice(b"  ");
            pad(&mut text, lines - row.line.len());
            text.extend_from_slice(&row.line);
            text.extend_from_slice(b"  ");
            text.extend_from_slice(&row.column);
            pad(&mut text, columns - row.column.len() + 2);
            match row.is_error {
                true => styled(&mut text, color, &RED, b"error"),
                false => styled(&mut text, color, &YELLOW, b"warning"),
            }
            pad(&mut text, kinds - kind_len(row) + 2);
            text.extend_from_slice(&row.message);
            pad(&mut text, messages - row.message_len + 2);
            if !row.rule.is_empty() {
                styled(&mut text, color, &DIM, &row.rule);
            }
            pad(&mut text, rules - visible_len(&row.rule));
            trim_end(&mut text);
            if i > 0 {
                out.push(b'\n');
            }
            for (j, line) in strings::split(&text, b"\n").enumerate() {
                if j > 0 {
                    out.push(b'\n');
                }
                write_line_with_position(out, color, line);
            }
        }
        out.extend_from_slice(b"\n\n");
    }
    let total = counts.errors + counts.warnings;
    if total == 0 {
        out.truncate(start);
        return;
    }
    let summary = if has_errors { &RED } else { &YELLOW };
    let mut line = |text: &[u8]| {
        let mut bold = Vec::with_capacity(text.len() + 16);
        styled(&mut bold, color, &BOLD, text);
        styled(out, color, summary, &bold);
        out.push(b'\n');
    };
    let mut text = Vec::new();
    let _ = write!(
        text,
        "\u{2716} {total} problem{} ({} error{}, {} warning{})",
        plural(total),
        counts.errors,
        plural(counts.errors),
        counts.warnings,
        plural(counts.warnings),
    );
    line(&text);
    if counts.fixable_errors > 0 || counts.fixable_warnings > 0 {
        text.clear();
        let _ = write!(
            text,
            "  {} error{} and {} warning{} potentially fixable with the `--fix` option.",
            counts.fixable_errors,
            plural(counts.fixable_errors),
            counts.fixable_warnings,
            plural(counts.fixable_warnings),
        );
        line(&text);
    }
    if color {
        out.extend_from_slice(RESET.close);
    }
}
