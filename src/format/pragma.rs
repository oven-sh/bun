//! `@format` and `@noformat` pragmas in a file's first comment, for the `requirePragma`,
//! `checkIgnorePragma` and `insertPragma` options.
//!
//! All of this runs on the source text **before it's parsed**. Prettier inserts the pragma into the
//! source and formats the result, and a skipped file never needs parsing. [`before_parsing`] does
//! what Prettier's `formatWithCursor` does with the three options.
//!
//! This is a port of `language-js/pragma.js` and the `jest-docblock` functions it calls, which are
//! built from regular expressions. Each function here quotes the expression it implements.

use crate::options::FormatOptions;
use bun_core::strings;
use std::borrow::Cow;

/// The decision made for a file before it's parsed.
pub enum BeforeParsing<'t> {
    /// Skip it. The file must not be formatted.
    LeaveUnchanged,
    /// Parse and format this text.
    Format(Cow<'t, [u8]>),
}

/// Applies the pragma options to `text`, which is JavaScript or TypeScript.
pub fn before_parsing<'t>(text: &'t [u8], options: &FormatOptions) -> BeforeParsing<'t> {
    let is_whole_file = options.range_start.unwrap_or(0) == 0
        && options
            .range_end
            .is_none_or(|end| end >= strings::wtf8_len_utf16(text));
    before_parsing_css(text, 0, is_whole_file, options)
}

/// Same as `before_parsing`, but for CSS, SCSS and Less, where the comment can follow front matter.
/// Mirrors Prettier's `language-css/pragma.js`. `front_matter_len` is the length of the front
/// matter at the start of `text`, through its closing `---`. `is_whole_file` is true if
/// `rangeStart` and `rangeEnd` cover the whole file. Both are offsets into the text before its line
/// breaks were normalized to `\n`.
pub fn before_parsing_css<'t>(
    text: &'t [u8],
    front_matter_len: usize,
    is_whole_file: bool,
    options: &FormatOptions,
) -> BeforeParsing<'t> {
    let (front_matter, content) = text.split_at(front_matter_len.min(text.len()));
    if (options.require_pragma && !has_pragma(content))
        || (options.check_ignore_pragma && has_ignore_pragma(content))
    {
        return BeforeParsing::LeaveUnchanged;
    }
    // Range formatting never inserts the pragma.
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

/// True if `text`'s first comment has `@format` or `@prettier`.
pub fn has_pragma(text: &[u8]) -> bool {
    has_any_pragma(text, [b"format", b"prettier"])
}

/// True if `text`'s first comment has `@noformat` or `@noprettier`.
pub fn has_ignore_pragma(text: &[u8]) -> bool {
    has_any_pragma(text, [b"noformat", b"noprettier"])
}

fn has_any_pragma(text: &[u8], names: [&[u8]; 2]) -> bool {
    let parts = Parts::of(text);
    // Fast path: nearly every file returns here.
    if !strings::contains_char(parts.doc_block, b'@') {
        return false;
    }
    let doc_block = DocBlock::parse(parts.doc_block);
    doc_block
        .pragmas
        .iter()
        .any(|(name, _)| names.contains(&name.as_slice()))
}

/// Prettier's `insertPragma`. Appends `text` to `out` with `@format` in its first comment, adding
/// the comment if there isn't one.
pub fn insert_pragma(text: &[u8], out: &mut Vec<u8>) {
    let parts = Parts::of(text);
    let doc_block = DocBlock::parse(parts.doc_block);
    // Prettier normalizes every line break to `\n` and restores the file's style when it prints.
    // The inserted lines use the file's own line break so that line-ending detection still gets the
    // same answer.
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
    match (line_break, parts.rest) {
        // This `\r` and the `\n` after it would merge into one line break.
        (b"\r", [b'\n', ..]) => out.push(b'\n'),
        (_, [b'\n' | b'\r', ..]) => out.extend_from_slice(line_break),
        _ => out.extend([line_break, line_break].concat()),
    }
    out.extend_from_slice(parts.rest);
}

/// A file split into parts. Together they cover everything except the whitespace before the first
/// comment and the line break after the shebang.
struct Parts<'t> {
    byte_order_mark: &'t [u8],
    /// `#!/usr/bin/env bun`, without its line break
    shebang: &'t [u8],
    /// The file's leading comment, or empty.
    doc_block: &'t [u8],
    /// Everything after the comment, or after the shebang if there's no comment.
    rest: &'t [u8],
}

impl<'t> Parts<'t> {
    /// Prettier's `parseDocBlock`, `extract` and `strip`.
    fn of(text: &'t [u8]) -> Self {
        let (byte_order_mark, text) = match text.strip_prefix(b"\xEF\xBB\xBF") {
            Some(rest) => (&text[..3], rest),
            None => (&text[..0], text),
        };
        let (shebang, text) = match (
            text.starts_with(b"#!"),
            strings::index_of_any(text, b"\n\r"),
        ) {
            (false, _) => (&text[..0], text),
            (true, None) => (text, &text[text.len()..]),
            (true, Some(end)) => {
                let after = if text[end..].starts_with(b"\r\n") {
                    end + 2
                } else {
                    end + 1
                };
                (&text[..end], &text[after..])
            }
        };
        match doc_block_len(strings::trim_js_whitespace_start(text)) {
            Some(len) => {
                let (doc_block, rest) = strings::trim_js_whitespace_start(text).split_at(len);
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

/// Length of the comment at the start of `text`: `/^\/\*\*?(.|\r?\n)*?\*\//`.
///
/// For `/**/` the expression only stops at the next comment's `*/`, so it treats the code in
/// between as part of the comment, and `insertPragma` then deletes that code. This port doesn't
/// copy that.
fn doc_block_len(text: &[u8]) -> Option<usize> {
    let content = text.strip_prefix(b"/*")?;
    let len = strings::index_of(content, b"*/")?;
    // `.` doesn't match U+2028 or U+2029.
    let mut rest = &content[..len];
    while let Some(at) = strings::index_of(rest, b"\xE2\x80") {
        if matches!(rest.get(at + 2), Some(0xA8 | 0xA9)) {
            return None;
        }
        rest = &rest[at + 2..];
    }
    Some(len + 4)
}

/// The result of `jest-docblock`'s `parseWithComments`.
struct DocBlock {
    /// The name and value of each `@name value`, in `Object.keys` order. Repeats of a name come
    /// right after its first occurrence.
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
    fn from_line(line: &'t [u8]) -> Option<Self> {
        let after_at = strings::trim_left(line, b" ").strip_prefix(b"@")?;
        let mut name_len = 0;
        while name_len < after_at.len() && strings::js_whitespace_len(&after_at[name_len..]) == 0 {
            name_len += 1;
        }
        let (name, rest) = after_at.split_at(name_len);
        (!name.is_empty()).then(|| Property {
            name,
            value: strings::trim_left(rest, b" "),
        })
    }

    /// The value with `// ..` stripped: `/(^|\s+)\/\/([^\n\r]*)/g`.
    fn value_without_line_comment(&self) -> &'t [u8] {
        let value = self.value;
        let mut from = 0;
        while let Some(at) = strings::index_of(&value[from..], b"//").map(|at| from + at) {
            let before = strings::trim_js_whitespace_end(&value[..at]);
            if at == 0 || before.len() < at {
                return before;
            }
            from = at + 1;
        }
        value
    }
}

impl DocBlock {
    /// `comment` is `/* .. */` or empty.
    fn parse(comment: &[u8]) -> DocBlock {
        // `/^\/\*\*?/` and `/\*\/$/`
        let content = comment
            .strip_prefix(b"/**")
            .or_else(|| comment.strip_prefix(b"/*"))
            .unwrap_or(comment);
        let content = content.strip_suffix(b"*/").unwrap_or(content);

        // Strip each line's leading `*`: `/(\r?\n|^) *\* ?/g`. Line breaks become `\n`.
        let mut text = Vec::with_capacity(content.len());
        let mut rest = content;
        loop {
            let after_spaces = strings::trim_left(rest, b" ");
            if let Some(after_star) = after_spaces.strip_prefix(b"*") {
                rest = after_star.strip_prefix(b" ").unwrap_or(after_star);
            }
            let Some(end) = strings::index_of_any(rest, b"\n\r") else {
                text.extend_from_slice(rest);
                break;
            };
            text.extend_from_slice(&rest[..end]);
            text.push(b'\n');
            rest = &rest[if rest[end..].starts_with(b"\r\n") {
                end + 2
            } else {
                end + 1
            }..];
        }

        while let Some(joined) = join_continuation_lines(&text) {
            text = joined;
        }
        let text = strings::trim_js_whitespace_end(strings::trim_left(&text, b"\n"));

        let mut pragmas: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        let mut comments = Vec::new();
        for (index, line) in strings::split(text, b"\n").enumerate() {
            let Some(property) = Property::from_line(line) else {
                if index > 0 {
                    comments.push(b'\n');
                }
                comments.extend_from_slice(line);
                continue;
            };
            let entry = (
                property.name.to_vec(),
                property.value_without_line_comment().to_vec(),
            );
            match pragmas.iter().rposition(|(name, _)| name == property.name) {
                Some(last) => pragmas.insert(last + 1, entry),
                None => pragmas.push(entry),
            }
        }
        crate::sort::sort_by_key(&mut pragmas[..], |(name, _)| {
            bun_core::fmt::js_array_index(name).map_or((1, 0), |index| (0, index))
        });
        let comments =
            strings::trim_js_whitespace_end(strings::trim_left(&comments, b"\n")).to_vec();
        DocBlock { pragmas, comments }
    }

    /// `jest-docblock`'s `print`, with `{ format: "", ...pragmas }` and `comments.trimStart()`.
    fn print_with_format_pragma(&self) -> Vec<u8> {
        let comments = strings::trim_js_whitespace_start(&self.comments);
        let is_format = |(name, _): &&(Vec<u8>, Vec<u8>)| name == b"format";
        let indexes = self
            .pragmas
            .iter()
            .take_while(|(name, _)| bun_core::fmt::js_array_index(name).is_some())
            .count();
        let (before, after) = self.pragmas.split_at(indexes);
        let added = [(b"format".to_vec(), Vec::new())];
        let format = if after.iter().any(|it| is_format(&it)) {
            &[][..]
        } else {
            &added[..]
        };
        let pragmas = (before.iter().chain(format))
            .chain(after.iter().filter(is_format))
            .chain(after.iter().filter(|it| !is_format(it)));
        // `` `@${key} ${value}`.trim() ``
        let write_pragma = |(name, value): &(Vec<u8>, Vec<u8>), out: &mut Vec<u8>| {
            out.push(b'@');
            out.extend_from_slice(name);
            if !strings::trim_js_whitespace_end(value).is_empty() {
                out.push(b' ');
                out.extend_from_slice(strings::trim_js_whitespace_end(value));
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
/// `/(?:^|\r?\n) *(@[^\n\r]*?) *\r?\n *(?![^\n\r@]*\/\/[^]*)([^\s@][^\n\r@]+?) *\r?\n/g` with
/// `"\n$1 $2\n"`. It joins a line that continues the value onto the `@name value` line before it.
/// Returns `None` if nothing matches.
fn join_continuation_lines(text: &[u8]) -> Option<Vec<u8>> {
    let mut out: Option<Vec<u8>> = None;
    // `text[..copied]` is already in `out`.
    let mut copied = 0;
    // A line can start a match only if the previous match didn't consume the line break before it.
    let mut line_start = 0;
    loop {
        let Some(first_end) =
            strings::index_of_char_usize(&text[line_start..], b'\n').map(|at| line_start + at)
        else {
            break;
        };
        let matched = (|| {
            let first = &text[line_start..first_end];
            let first = strings::trim_right(strings::trim_left(first, b" "), b" ");
            if !first.starts_with(b"@") {
                return None;
            }
            let second_start = first_end + 1;
            let second_end =
                second_start + strings::index_of_char_usize(&text[second_start..], b'\n')?;
            let second = &text[second_start..second_end];
            let second = strings::trim_left(second, b" ");
            if second.len() < 2
                || strings::js_whitespace_len(second) != 0
                || strings::contains_char(second, b'@')
                || strings::contains(second, b"//")
            {
                return None;
            }
            // The lazy `+?` matches at least one character, even a space.
            let second = &second[..strings::trim_right(second, b" ").len().max(2)];
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
                // The match consumed the line break before `end`, so the line there can't start
                // another match.
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
