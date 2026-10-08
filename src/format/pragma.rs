//! `@format` and `@noformat` in the first comment of a file: the options `requirePragma`,
//! `checkIgnorePragma` and `insertPragma`.
//!
//! All of it is about the text of a file **before it is parsed**: Prettier inserts the pragma into
//! the source and formats the result, and a file that is left as it is does not have to be parsed.
//! [`before_parsing`] does what Prettier's `formatWithCursor` does with the three options.
//!
//! It is a port of `language-js/pragma.js` and of the functions of `jest-docblock` that it calls,
//! which are made of regular expressions. Each function here names the expression that it is.

use crate::options::FormatOptions;
use bun_core::strings;
use std::borrow::Cow;

/// What to do with a file.
pub enum BeforeParsing<'t> {
    /// Nothing: it is not to be formatted.
    LeaveAsItIs,
    /// Parse and format this text.
    Format(Cow<'t, [u8]>),
}

/// What the pragmas in `text`, which is JavaScript or TypeScript, and the options about them say.
pub fn before_parsing<'t>(text: &'t [u8], options: &FormatOptions) -> BeforeParsing<'t> {
    before_parsing_css(text, 0, options)
}

/// The same for CSS, SCSS and Less, where the comment can follow front matter: Prettier's
/// `language-css/pragma.js`. `front_matter_len`: the length of the front matter that `text` starts
/// with, up to and including its last `---`.
pub fn before_parsing_css<'t>(text: &'t [u8], front_matter_len: usize, options: &FormatOptions) -> BeforeParsing<'t> {
    let (front_matter, content) = text.split_at(front_matter_len.min(text.len()));
    if (options.require_pragma && !has_pragma(content)) || (options.check_ignore_pragma && has_ignore_pragma(content)) {
        return BeforeParsing::LeaveAsItIs;
    }
    // Not if only a part of the file is formatted.
    let is_whole_file = options.range_start.unwrap_or(0) == 0 && options.range_end.is_none_or(|end| end as usize >= utf16_len(text));
    if options.insert_pragma && !options.require_pragma && is_whole_file && !has_pragma(content) {
        let mut out = Vec::with_capacity(text.len() + 32);
        if !front_matter.is_empty() {
            out.extend_from_slice(front_matter);
            out.extend_from_slice(b"\n\n");
        }
        insert_pragma(content, &mut out);
        return BeforeParsing::Format(Cow::Owned(out));
    }
    BeforeParsing::Format(Cow::Borrowed(text))
}

/// The `length` that `text` has as a string of JavaScript.
fn utf16_len(text: &[u8]) -> usize {
    // One for each character, and one more for those of four bytes.
    text.iter().filter(|b| **b & 0xC0 != 0x80).count() + text.iter().filter(|b| **b >= 0xF0).count()
}

/// Whether the first comment of `text` has `@format` or `@prettier`.
pub fn has_pragma(text: &[u8]) -> bool {
    has_any_pragma(text, [b"format", b"prettier"])
}

/// Whether the first comment of `text` has `@noformat` or `@noprettier`.
pub fn has_ignore_pragma(text: &[u8]) -> bool {
    has_any_pragma(text, [b"noformat", b"noprettier"])
}

fn has_any_pragma(text: &[u8], names: [&[u8]; 2]) -> bool {
    let parts = Parts::of(text);
    // Nearly every file is told by this.
    if !strings::contains_char(parts.doc_block, b'@') {
        return false;
    }
    let doc_block = DocBlock::parse(parts.doc_block);
    doc_block.pragmas.iter().any(|(name, _)| names.contains(&name.as_slice()))
}

/// Prettier's `isFlowFile`: whether it has Babel parse `text` as Flow, because `@flow` or `@noflow`
/// is somewhere in the comments that it starts with, or because of its name. What is printed
/// differently then: a property name that is a number keeps its quotes.
pub fn is_flow_file(text: &[u8], filepath: &[u8]) -> bool {
    if filepath.ends_with(b".js.flow") {
        return true;
    }
    let text = text.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(text);
    let text = match (text.starts_with(b"#!"), strings::index_of_any(text, b"\n\r")) {
        (false, _) => text,
        (true, None) => return false,
        (true, Some(end)) => &text[end..],
    };

    // `getNextNonSpaceNonCommentCharacterIndex`
    let mut rest = text;
    loop {
        rest = match rest {
            [b' ' | b'\t' | b'\n' | b'\r', rest @ ..] | [0xE2, 0x80, 0xA8 | 0xA9, rest @ ..] => rest,
            [b'/', b'*', comment @ ..] => match strings::index_of(comment, b"*/") {
                Some(end) => &comment[end + 2..],
                None => break,
            },
            [b'/', b'/', comment @ ..] => &comment[strings::index_of_any(comment, b"\n\r").unwrap_or(comment.len())..],
            _ => break,
        };
    }

    // `/@(?:no)?flow\b/`
    let mut comments = &text[..text.len() - rest.len()];
    while let Some(at) = strings::index_of_char_usize(comments, b'@') {
        comments = &comments[at + 1..];
        if let Some(after) = comments.strip_prefix(b"no").unwrap_or(comments).strip_prefix(b"flow")
            && !after.first().is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
        {
            return true;
        }
    }
    false
}

/// Prettier's `insertPragma`: appends `text` to `out`, with `@format` in its first comment, which is
/// added if there is none.
pub fn insert_pragma(text: &[u8], out: &mut Vec<u8>) {
    let parts = Parts::of(text);
    let doc_block = DocBlock::parse(parts.doc_block);
    // Prettier works on text whose line breaks are all `\n`, and puts those of the file back when it
    // prints. So that they are told as before, what is added has the line breaks of the file.
    let line_break: &[u8] = match strings::index_of_char_usize(text, b'\r') {
        Some(at) if text.get(at + 1) == Some(&b'\n') => b"\r\n",
        Some(_) => b"\r",
        None => b"\n",
    };

    out.extend_from_slice(parts.byte_order_mark);
    if !parts.shebang.is_empty() {
        out.extend_from_slice(parts.shebang);
        out.extend_from_slice(line_break);
    }
    for (index, line) in strings::split(&doc_block.print_with_format_pragma(), b"\n").enumerate() {
        if index > 0 {
            out.extend_from_slice(line_break);
        }
        out.extend_from_slice(line);
    }
    out.extend_from_slice(line_break);
    if !matches!(parts.rest, [b'\n' | b'\r', ..]) {
        out.extend_from_slice(line_break);
    }
    out.extend_from_slice(parts.rest);
}

/// The length of the white space or line break, `\s` of a regular expression, that `text` starts
/// with.
fn white_space_len(text: &[u8]) -> usize {
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

/// `String.prototype.trimStart`
pub(crate) fn trim_start(mut text: &[u8]) -> &[u8] {
    loop {
        match white_space_len(text) {
            0 => return text,
            len => text = &text[len..],
        }
    }
}

/// `String.prototype.trimEnd`
pub(crate) fn trim_end(mut text: &[u8]) -> &[u8] {
    loop {
        text = match text {
            [rest @ .., b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' '] | [rest @ .., 0xC2, 0xA0] => rest,
            [rest @ .., 0xE1, 0x9A, 0x80]
            | [rest @ .., 0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF]
            | [rest @ .., 0xE2, 0x81, 0x9F]
            | [rest @ .., 0xE3, 0x80, 0x80]
            | [rest @ .., 0xEF, 0xBB, 0xBF] => rest,
            _ => return text,
        };
    }
}

fn count_spaces(text: &[u8]) -> usize {
    text.iter().take_while(|b| **b == b' ').count()
}

fn without_spaces_at_end(text: &[u8]) -> &[u8] {
    &text[..text.len() - text.iter().rev().take_while(|b| **b == b' ').count()]
}

/// `/^(\r?\n)+/`
fn without_line_breaks_at_start(text: &[u8]) -> &[u8] {
    &text[text.iter().take_while(|b| **b == b'\n').count()..]
}

/// A file taken apart: all of it but the white space before the first comment and the line break
/// after the shebang.
struct Parts<'t> {
    byte_order_mark: &'t [u8],
    /// `#!/usr/bin/env bun`, without its line break
    shebang: &'t [u8],
    /// The comment that the file starts with, or nothing.
    doc_block: &'t [u8],
    /// What follows the comment. Without a comment, what follows the shebang.
    rest: &'t [u8],
}

impl<'t> Parts<'t> {
    /// Prettier's `parseDocBlock`, `extract` and `strip`.
    fn of(text: &'t [u8]) -> Self {
        let (byte_order_mark, text) = match text.strip_prefix(b"\xEF\xBB\xBF") {
            Some(rest) => (&text[..3], rest),
            None => (&text[..0], text),
        };
        let (shebang, text) = match (text.starts_with(b"#!"), strings::index_of_any(text, b"\n\r")) {
            (false, _) => (&text[..0], text),
            (true, None) => (text, &text[text.len()..]),
            (true, Some(end)) => {
                let after = if text[end..].starts_with(b"\r\n") { end + 2 } else { end + 1 };
                (&text[..end], &text[after..])
            }
        };
        match doc_block_len(trim_start(text)) {
            Some(len) => {
                let (doc_block, rest) = trim_start(text).split_at(len);
                Parts {
                    byte_order_mark,
                    shebang,
                    doc_block,
                    rest,
                }
            }
            None => Parts {
                byte_order_mark,
                shebang,
                doc_block: &text[..0],
                rest: text,
            },
        }
    }
}

/// `/^\/\*\*?(.|\r?\n)*?\*\//`: the length of the comment that `text` starts with.
///
/// The expression finds the end of `/**/` in the next comment, and takes the code in between for a
/// part of the comment, which `insertPragma` then deletes. That is not done here.
fn doc_block_len(text: &[u8]) -> Option<usize> {
    let content = text.strip_prefix(b"/*")?;
    let len = strings::index_of(content, b"*/")?;
    // `.` is not U+2028 or U+2029.
    let mut rest = &content[..len];
    while let Some(at) = strings::index_of(rest, b"\xE2\x80") {
        if matches!(rest.get(at + 2), Some(0xA8 | 0xA9)) {
            return None;
        }
        rest = &rest[at + 2..];
    }
    Some(len + 4)
}

/// What `parseWithComments` of `jest-docblock` makes of a comment.
struct DocBlock {
    /// The names and the values of `@name value`, in the order of `Object.keys`. A name that is there
    /// several times is next to its first.
    pragmas: Vec<(Vec<u8>, Vec<u8>)>,
    /// All other lines.
    comments: Vec<u8>,
}

/// A line that starts with `@name`: `/(?:^|\r?\n) *@(\S+) *([^\n\r]*)/`.
struct Property<'t> {
    name: &'t [u8],
    value: &'t [u8],
}

impl<'t> Property<'t> {
    fn of_line(line: &'t [u8]) -> Option<Self> {
        let after_at = line[count_spaces(line)..].strip_prefix(b"@")?;
        let mut name_len = 0;
        while name_len < after_at.len() && white_space_len(&after_at[name_len..]) == 0 {
            name_len += 1;
        }
        let (name, rest) = after_at.split_at(name_len);
        (!name.is_empty()).then(|| Property {
            name,
            value: &rest[count_spaces(rest)..],
        })
    }

    /// The value without `// ..`: `/(^|\s+)\/\/([^\n\r]*)/g`.
    fn value_without_line_comment(&self) -> &'t [u8] {
        let value = self.value;
        let mut from = 0;
        while let Some(at) = strings::index_of(&value[from..], b"//").map(|at| from + at) {
            let before = trim_end(&value[..at]);
            if at == 0 || before.len() < at {
                return before;
            }
            from = at + 1;
        }
        value
    }
}

/// The index that `name` is as a property of an array, if it is one. `Object.keys` has those first,
/// in ascending order.
fn as_array_index(name: &[u8]) -> Option<u32> {
    if name.len() > 10 || (name.len() > 1 && name[0] == b'0') || !name.iter().all(u8::is_ascii_digit) || name.is_empty() {
        return None;
    }
    let value = name.iter().fold(0u64, |value, digit| value * 10 + u64::from(digit - b'0'));
    u32::try_from(value).ok().filter(|index| *index != u32::MAX)
}

impl DocBlock {
    /// `comment`: `/* .. */`, or nothing.
    fn parse(comment: &[u8]) -> DocBlock {
        // `/^\/\*\*?/` and `/\*\/$/`
        let content = comment.strip_prefix(b"/**").or_else(|| comment.strip_prefix(b"/*")).unwrap_or(comment);
        let content = content.strip_suffix(b"*/").unwrap_or(content);

        // Without the `*` that the lines start with: `/(\r?\n|^) *\* ?/g`. The line breaks become `\n`.
        let mut text = Vec::with_capacity(content.len());
        let mut rest = content;
        loop {
            let after_spaces = &rest[count_spaces(rest)..];
            if let Some(after_star) = after_spaces.strip_prefix(b"*") {
                rest = after_star.strip_prefix(b" ").unwrap_or(after_star);
            }
            let Some(end) = strings::index_of_any(rest, b"\n\r") else {
                text.extend_from_slice(rest);
                break;
            };
            text.extend_from_slice(&rest[..end]);
            text.push(b'\n');
            rest = &rest[if rest[end..].starts_with(b"\r\n") { end + 2 } else { end + 1 }..];
        }

        while let Some(joined) = join_continuation_lines(&text) {
            text = joined;
        }
        let text = trim_end(without_line_breaks_at_start(&text));

        let mut pragmas: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        let mut comments = Vec::new();
        for (index, line) in strings::split(text, b"\n").enumerate() {
            let Some(property) = Property::of_line(line) else {
                if index > 0 {
                    comments.push(b'\n');
                }
                comments.extend_from_slice(line);
                continue;
            };
            let entry = (property.name.to_vec(), property.value_without_line_comment().to_vec());
            match pragmas.iter().rposition(|(name, _)| name == property.name) {
                Some(last) => pragmas.insert(last + 1, entry),
                None => pragmas.push(entry),
            }
        }
        pragmas.sort_by_key(|(name, _)| as_array_index(name).map_or((1, 0), |index| (0, index)));
        let comments = trim_end(without_line_breaks_at_start(&comments)).to_vec();
        DocBlock { pragmas, comments }
    }

    /// `print` of `jest-docblock`, with `{ format: "", ...pragmas }` and `comments.trimStart()`.
    fn print_with_format_pragma(&self) -> Vec<u8> {
        let comments = trim_start(&self.comments);
        let is_format = |(name, _): &&(Vec<u8>, Vec<u8>)| name == b"format";
        let indexes = self.pragmas.iter().take_while(|(name, _)| as_array_index(name).is_some()).count();
        let (before, after) = self.pragmas.split_at(indexes);
        let added = [(b"format".to_vec(), Vec::new())];
        let format = if after.iter().any(|it| is_format(&it)) { &[][..] } else { &added[..] };
        let pragmas = (before.iter().chain(format))
            .chain(after.iter().filter(is_format))
            .chain(after.iter().filter(|it| !is_format(it)));
        // `` `@${key} ${value}`.trim() ``
        let write_pragma = |(name, value): &(Vec<u8>, Vec<u8>), out: &mut Vec<u8>| {
            out.push(b'@');
            out.extend_from_slice(name);
            if !trim_end(value).is_empty() {
                out.push(b' ');
                out.extend_from_slice(trim_end(value));
            }
        };

        if comments.is_empty() && self.pragmas.len() + format.len() == 1 {
            let mut out = b"/** ".to_vec();
            pragmas.for_each(|it| write_pragma(it, &mut out));
            out.extend_from_slice(b" */");
            return out;
        }
        let mut out = b"/**\n".to_vec();
        if !comments.is_empty() {
            for line in strings::split(comments, b"\n") {
                out.extend_from_slice(b" * ");
                out.extend_from_slice(line);
                out.push(b'\n');
            }
            out.extend_from_slice(b" *\n");
        }
        for pragma in pragmas {
            out.extend_from_slice(b" * ");
            write_pragma(pragma, &mut out);
            out.push(b'\n');
        }
        out.extend_from_slice(b" */");
        out
    }
}

/// One `replaceAll` of
/// `/(?:^|\r?\n) *(@[^\n\r]*?) *\r?\n *(?![^\n\r@]*\/\/[^]*)([^\s@][^\n\r@]+?) *\r?\n/g` by
/// `"\n$1 $2\n"`: a line after `@name value` that goes on with the value is joined to it. `None` if
/// nothing matches.
fn join_continuation_lines(text: &[u8]) -> Option<Vec<u8>> {
    let mut out: Option<Vec<u8>> = None;
    // Up to here `text` is in `out`.
    let mut copied = 0;
    // A line can be the first of a match if the line break before it is not the end of a match.
    let mut line_start = 0;
    loop {
        let Some(first_end) = strings::index_of_char_usize(&text[line_start..], b'\n').map(|at| line_start + at) else {
            break;
        };
        let matched = (|| {
            let first = &text[line_start..first_end];
            let first = without_spaces_at_end(&first[count_spaces(first)..]);
            if !first.starts_with(b"@") {
                return None;
            }
            let second_start = first_end + 1;
            let second_end = second_start + strings::index_of_char_usize(&text[second_start..], b'\n')?;
            let second = &text[second_start..second_end];
            let second = &second[count_spaces(second)..];
            if second.len() < 2
                || white_space_len(second) != 0
                || strings::contains_char(second, b'@')
                || strings::contains(second, b"//")
            {
                return None;
            }
            // The lazy `+?` takes one character at least, even if that is a space.
            let second = &second[..without_spaces_at_end(second).len().max(2)];
            Some((first, second, second_end + 1))
        })();
        match matched {
            Some((first, second, end)) => {
                let out = out.get_or_insert_with(|| Vec::with_capacity(text.len()));
                // The line break before the first line is part of the match.
                out.extend_from_slice(&text[copied..line_start.saturating_sub(1).max(copied)]);
                out.push(b'\n');
                out.extend_from_slice(first);
                out.push(b' ');
                out.extend_from_slice(second);
                out.push(b'\n');
                copied = end;
                // The line at `end` has no line break before it that is left to match.
                match strings::index_of_char_usize(&text[end..], b'\n') {
                    Some(at) => line_start = end + at + 1,
                    None => break,
                }
            }
            None => line_start = first_end + 1,
        }
        if line_start >= text.len() {
            break;
        }
    }
    let mut out = out?;
    out.extend_from_slice(&text[copied..]);
    Some(out)
}
