//! `bun-lint format letters <paths..> [--check=false] [--refused=true]`: the trial of a check for the languages whose tree is not compared
//! before a file is written: style sheets, YAML, Markdown, GraphQL, JSON, Handlebars. Nothing with a letter in it is
//! lost, and nothing is there twice.
//!
//! Each file that formatting changes is looked at. An alarm is printed with the letters that differ. With
//! `--check=false` the files are only formatted: the difference between the two runs is what the check costs. With
//! `--refused=true` the files that are not formatted are named, with the reason.

use super::{Args, collect_files, format_text_or_panic, is_other_language};
use crate::host::{self, output_line};
use bun_core::strings;
use std::fmt::Write as _;

/// How often each letter is in a text, and each byte of a character that is not ASCII. White space, punctuation, numbers
/// and upper and lower case do not count, and neither does where a letter is.
type Letters = [u64; 26 + 128];

fn letters_of(text: &[u8]) -> Letters {
    let mut letters = [0; 26 + 128];
    let (mut at, mut previous) = (0, 0);
    while let Some(&byte) = text.get(at) {
        match byte {
            // The exponent of a number, which goes if it is zero.
            b'e' | b'E' if previous == b'.' || previous.is_ascii_digit() => {}
            // An escape.
            _ if previous == b'\\' => {}
            b'a'..=b'z' => letters[usize::from(byte - b'a')] += 1,
            b'A'..=b'Z' => letters[usize::from(byte - b'A')] += 1,
            0x80.. => match strings::js_whitespace_len(&text[at..]) {
                0 => letters[26 + usize::from(byte - 0x80)] += 1,
                len => at += len - 1,
            },
            _ => {}
        }
        previous = byte;
        at += 1;
    }
    letters
}

fn push_code_point(out: &mut Vec<u8>, digits: &[u8], radix: u32) -> bool {
    let code_point = std::str::from_utf8(digits)
        .ok()
        .filter(|it| !it.is_empty())
        .and_then(|it| u32::from_str_radix(it, radix).ok());
    // Half of a pair is no letter.
    if let Some(it) = code_point.and_then(char::from_u32) {
        out.extend_from_slice(it.encode_utf8(&mut [0; 4]).as_bytes());
    }
    code_point.is_some()
}

/// `text` with what the character references in it stand for: `&amp;`, `&#38;`, `&#x26;`. Of those with a name only
/// the five of XML.
fn without_character_references(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'&') {
        out.extend_from_slice(&rest[..at]);
        rest = &rest[at + 1..];
        let start = rest.get(..12).unwrap_or(rest);
        let Some(end) = strings::index_of_char_usize(start, b';') else {
            out.push(b'&');
            continue;
        };
        let is_reference = match &rest[..end] {
            [b'#', b'x' | b'X', digits @ ..] => push_code_point(&mut out, digits, 16),
            [b'#', digits @ ..] => push_code_point(&mut out, digits, 10),
            b"amp" | b"lt" | b"gt" | b"quot" | b"apos" => true,
            _ => false,
        };
        match is_reference {
            true => rest = &rest[end + 1..],
            false => out.push(b'&'),
        }
    }
    out.extend_from_slice(rest);
    out
}

/// `text` with what `\u0041` and `\u{41}` in it stand for.
fn without_unicode_escapes(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = strings::index_of(rest, b"\\u") {
        out.extend_from_slice(&rest[..at]);
        let after = &rest[at + 2..];
        let (digits, len) = match after.strip_prefix(b"{") {
            Some(braced) => {
                let end = strings::index_of_char_usize(braced, b'}').unwrap_or(braced.len());
                (&braced[..end], end + 2)
            }
            None => (after.get(..4).unwrap_or_default(), 4),
        };
        rest = match push_code_point(&mut out, digits, 16) {
            true => after.get(len..).unwrap_or_default(),
            false => {
                out.extend_from_slice(b"\\u");
                after
            }
        };
    }
    out.extend_from_slice(rest);
    out
}

/// The letters of which `after` has more or fewer than `before`, if any. What the language lets a formatter write in
/// another way is only looked for if the texts differ as they are.
fn difference(path: &[u8], before: &[u8], after: &[u8]) -> Option<String> {
    if letters_of(before) == letters_of(after) {
        return None;
    }
    let decode: fn(&[u8]) -> Vec<u8> = if bun_format::markdown::is_markdown_path(path) {
        without_character_references
    } else {
        without_unicode_escapes
    };
    let (before, after) = (letters_of(&decode(before)), letters_of(&decode(after)));
    let mut text = String::new();
    for (index, (&before, &after)) in before.iter().zip(&after).enumerate() {
        if before != after {
            let name = match u8::try_from(index) {
                Ok(index @ 0..26) => char::from(b'a' + index).to_string(),
                _ => format!("x{:02X}", index - 26 + 0x80),
            };
            let _ = write!(
                text,
                " {name}{:+}",
                after.cast_signed() - before.cast_signed()
            );
        }
    }
    (!text.is_empty()).then_some(text)
}

pub(super) fn run(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let checks = args.flags.get("check").is_none_or(|it| it != "false");
    let names_refused = args.flags.get("refused").is_some_and(|it| it == "true");
    let (mut files, mut refused, mut changed, mut alarms) = (0, 0, 0, 0);
    for path in collect_files(&args.positional) {
        if !is_other_language(&path) {
            continue;
        }
        let name = path.to_string_lossy();
        let Ok(code) = host::read(&path) else {
            continue;
        };
        files += 1;
        let out = match format_text_or_panic(&name, &code, &args.options) {
            Ok(out) => out,
            Err(why) => {
                refused += 1;
                if names_refused {
                    output_line!("NOT FORMATTED {name}: {why}");
                }
                continue;
            }
        };
        if out == code {
            continue;
        }
        changed += 1;
        if checks && let Some(letters) = difference(name.as_bytes(), &code, &out) {
            alarms += 1;
            output_line!("ALARM {name}:{letters}");
        }
    }
    output_line!("files: {files}, not formatted: {refused}, changed: {changed}, alarms: {alarms}");
}
