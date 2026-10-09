use bun_core::strings;
use bun_lint::prelude::*;
use std::cell::OnceCell;

/// Enforce a particular style for multiline comments.
pub struct MultilineCommentStyle {
    style: Style,
    check_jsdoc: bool,
}

#[derive(Copy, Clone, PartialEq)]
enum Style {
    StarredBlock,
    SeparateLines,
    BareBlock,
}

const EXPECTED_BLOCK: Message = Message::new(
    "expectedBlock",
    "Expected a block comment instead of consecutive line comments.",
);
const EXPECTED_BARE_BLOCK: Message =
    Message::new("expectedBareBlock", "Expected a block comment without padding stars.");
const START_NEWLINE: Message = Message::new("startNewline", "Expected a linebreak after '/*'.");
const END_NEWLINE: Message = Message::new("endNewline", "Expected a linebreak before '*/'.");
const MISSING_STAR: Message =
    Message::new("missingStar", "Expected a '*' at the start of this line.");
const ALIGNMENT: Message = Message::new(
    "alignment",
    "Expected this line to be aligned with the start of the comment.",
);
const EXPECTED_LINES: Message = Message::new(
    "expectedLines",
    "Expected multiple line comments instead of a block comment.",
);

/// Comments that appear together: one block comment, or line comments on consecutive lines with
/// nothing else on them.
#[derive(Copy, Clone)]
struct Group<'a> {
    first: Token<'a>,
    last: Token<'a>,
    len: usize,
}

impl Group<'_> {
    fn span(self) -> Span {
        Span::new(self.first.start(), self.last.end())
    }
}

fn concat(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

/// `lines.map(line => prefix + line).join(separator)`
fn join(out: &mut Vec<u8>, lines: &[&[u8]], prefix: &[&[u8]], separator: &[&[u8]]) {
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            separator.iter().for_each(|part| out.extend_from_slice(part));
        }
        prefix.iter().for_each(|part| out.extend_from_slice(part));
        out.extend_from_slice(line);
    }
}

/// `string.slice(start)`
fn slice_from(string: &[u8], start: i64) -> &[u8] {
    let len = i64::from(strings::wtf8_len_utf16(string));
    let from = if start < 0 { (len + start).max(0) } else { start.min(len) };
    string.get(strings::wtf8_offset_of_utf16_index(string, from as u32)..).unwrap_or_default()
}

/// What `/^\s*/u` matches.
fn leading_whitespace(line: &[u8]) -> &[u8] {
    &line[..line.len() - strings::trim_js_whitespace_start(line).len()]
}

/// The range of a line of ESLint's text, which has no byte order mark.
fn line_span(file: &File, line: u32) -> Span {
    file.line_span(line)
}

fn is_starred_comment_line(line: &[u8]) -> bool {
    strings::trim_js_whitespace_start(line).starts_with(b"*")
}

/// Only whitespace on the first and the last line, and a star at the start of every other.
fn is_starred_block_comment(comment: Token) -> bool {
    if comment.kind() != TokenKind::Block {
        return false;
    }
    let mut lines = strings::js_lines(comment.comment_value()).enumerate().peekable();
    while let Some((i, line)) = lines.next() {
        let is_valid = match i == 0 || lines.peek().is_none() {
            true => strings::is_all_js_whitespace(line),
            false => is_starred_comment_line(line),
        };
        if !is_valid {
            return false;
        }
    }
    true
}

fn is_jsdoc_comment(comment: Token) -> bool {
    if comment.kind() != TokenKind::Block {
        return false;
    }
    let mut lines = strings::js_lines(comment.comment_value()).enumerate().peekable();
    while let Some((i, line)) = lines.next() {
        let is_last = lines.peek().is_none();
        let is_valid = match (i == 0, is_last) {
            (true, true) => false,
            (true, false) => line.strip_prefix(b"*").is_some_and(strings::is_all_js_whitespace),
            (false, true) => strings::is_all_js_whitespace(line),
            // `/^\s* /u`
            (false, false) => strings::contains_char(leading_whitespace(line), b' '),
        };
        if !is_valid {
            return false;
        }
    }
    true
}

/// The whitespace from the beginning of the line to `comment`.
fn get_initial_offset<'a>(file: &'a File<'a>, comment: Token<'a>) -> &'a [u8] {
    let line = line_span(file, file.line_of(comment.start()));
    file.slice(Span::new(line.start, comment.start()))
}

fn process_separate_line_comments<'a>(file: &'a File<'a>, group: Group<'a>) -> Vec<&'a [u8]> {
    let values = file.comments_in(group.span()).map(Token::comment_value);
    let all_lines_have_leading_space =
        values.clone().filter(|line| !strings::is_all_js_whitespace(line)).all(|line| line.starts_with(b" "));
    values
        .map(|value| match all_lines_have_leading_space {
            true => value.strip_prefix(b" ").unwrap_or(value),
            false => value,
        })
        .collect()
}

/// `comment` is in starred-block form.
fn process_starred_block_comment<'a>(comment: Token<'a>) -> Vec<&'a [u8]> {
    let mut lines: Vec<&'a [u8]> = strings::js_lines(comment.comment_value()).skip(1).collect();
    lines.pop();
    for line in &mut lines {
        let rest: &'a [u8] = strings::trim_js_whitespace_start(*line);
        *line = rest.strip_prefix(b"*").unwrap_or(rest);
    }
    let all_lines_have_leading_space =
        lines.iter().filter(|line| !strings::is_all_js_whitespace(line)).all(|line| line.starts_with(b" "));
    if all_lines_have_leading_space {
        for line in &mut lines {
            let rest: &'a [u8] = *line;
            *line = rest.strip_prefix(b" ").unwrap_or(rest);
        }
    }
    lines
}

fn process_bare_block_comment<'a>(file: &'a File<'a>, comment: Token<'a>) -> Vec<&'a [u8]> {
    /// What `/^(\s*\*?\s*)/u` matches.
    fn offset_of(line: &[u8]) -> &[u8] {
        let rest = strings::trim_js_whitespace_start(line);
        let rest = rest.strip_prefix(b"*").map_or(rest, strings::trim_js_whitespace_start);
        &line[..line.len() - rest.len()]
    }
    let lines = strings::js_lines(comment.comment_value());
    let leading_whitespace = i64::from(strings::wtf8_len_utf16(get_initial_offset(file, comment))) + 3;

    // By how much the least indented line is indented less than the text after `/* `. The first
    // line is in line with the delimiter.
    let mut offset: i64 = 0;
    for line in lines.skip(1).filter(|line| !strings::is_all_js_whitespace(line)) {
        offset = offset.max(leading_whitespace - i64::from(strings::wtf8_len_utf16(offset_of(line))));
    }

    lines
        .map(|line| {
            if strings::is_all_js_whitespace(line) {
                return &line[line.len()..];
            }
            let line_offset = offset_of(line);
            let len = i64::from(strings::wtf8_len_utf16(line_offset));
            let kept = match len > leading_whitespace {
                true => slice_from(line_offset, leading_whitespace - (offset + len)).len(),
                false => 0,
            };
            &line[line_offset.len() - kept..]
        })
        .collect()
}

/// The lines of the comments without what their form requires at the start of each.
fn get_comment_lines<'a>(file: &'a File<'a>, group: Group<'a>) -> Vec<&'a [u8]> {
    match group.first.kind() {
        TokenKind::Line => process_separate_line_comments(file, group),
        _ if is_starred_block_comment(group.first) => process_starred_block_comment(group.first),
        _ => process_bare_block_comment(file, group.first),
    }
}

fn convert_to_starred_block(initial_offset: &[u8], lines: &[&[u8]]) -> Vec<u8> {
    let mut out = b"/*\n".to_vec();
    join(&mut out, lines, &[initial_offset, b" * "], &[b"\n"]);
    out.push(b'\n');
    out.extend_from_slice(initial_offset);
    out.extend_from_slice(b" */");
    out
}

fn convert_to_separate_lines(initial_offset: &[u8], lines: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    join(&mut out, lines, &[b"// "], &[b"\n", initial_offset]);
    out
}

fn convert_to_block(initial_offset: &[u8], lines: &[&[u8]]) -> Vec<u8> {
    let mut out = b"/* ".to_vec();
    join(&mut out, lines, &[], &[b"\n", initial_offset, b"   "]);
    out.extend_from_slice(b" */");
    out
}

fn contains_block_end(lines: &[&[u8]]) -> bool {
    lines.iter().any(|line| strings::contains(line, b"*/"))
}

/// The `/*` of a block comment.
fn opening(comment: Token) -> Span {
    Span::new(comment.start(), comment.start() + 2)
}

impl MultilineCommentStyle {
    fn check_starred_block<'a>(&self, group: Group<'a>, cx: &mut Cx<'a, Self>) {
        let (file, first) = (cx.file(), group.first);
        let initial_offset = get_initial_offset(file, first);
        if group.len > 1 {
            let lines = process_separate_line_comments(file, group);
            if contains_block_end(&lines) {
                return;
            }
            cx.report(group.span(), EXPECTED_BLOCK).fix(|fixer| {
                (!lines.iter().any(|line| line.starts_with(b"/")))
                    .then(|| fixer.replace(group.span(), convert_to_starred_block(initial_offset, &lines)))
            });
            return;
        }

        let value = first.comment_value();
        let first_line = strings::js_lines(value).next().unwrap_or_default();
        let last_line = strings::js_lines(value).last().unwrap_or_default();

        if !strings::is_all_js_whitespace(first_line.strip_prefix(b"*").unwrap_or(first_line)) {
            let delimiter_end = opening(first).end + u32::from(first_line.starts_with(b"*"));
            cx.report(opening(first), START_NEWLINE).fix(|fixer| {
                fixer.insert_after(Span::empty(delimiter_end), concat(&[b"\n", initial_offset, b" *"]))
            });
        }

        if !strings::is_all_js_whitespace(last_line) {
            let closing = Span::new(first.end() - 2, first.end());
            cx.report(closing, END_NEWLINE)
                .fix(|fixer| fixer.replace(closing, concat(&[b"\n", initial_offset, b" */"])));
        }

        let start_line = file.line_of(first.start());
        // Which of the lines of the comment is the first that is not blank, once a fix asks.
        let first_line_with_text = OnceCell::new();
        for line_number in start_line + 1..=file.line_of(first.end()) {
            let line = file.line_span(line_number);
            let line_text = file.slice(line);
            if line_text.strip_prefix(initial_offset).is_some_and(|rest| rest.starts_with(b" *")) {
                continue;
            }
            let whitespace = leading_whitespace(line_text);
            let text_start = line.start + whitespace.len() as u32;
            if is_starred_comment_line(line_text) {
                cx.report(line, ALIGNMENT).fix(|fixer| {
                    fixer.replace(Span::new(line.start, text_start + 1), concat(&[initial_offset, b" *"]))
                });
                continue;
            }
            cx.report(line, MISSING_STAR).fix(|fixer| {
                let mut prefix = concat(&[initial_offset, b" *"]);
                match *first_line_with_text
                    .get_or_init(|| strings::js_lines(value).position(|line| !strings::is_all_js_whitespace(line)))
                {
                    Some(index) => {
                        let to_align_with = file.slice(line_span(file, start_line + index as u32));
                        // `/^(\s*(?:\/?\*)?(\s*))/u`
                        let rest = strings::trim_js_whitespace_start(to_align_with);
                        let after_star = rest.strip_prefix(b"/").unwrap_or(rest).strip_prefix(b"*");
                        let after_star_offset = after_star.map_or(&b""[..], leading_whitespace);
                        let rest = after_star.map_or(rest, strings::trim_js_whitespace_start);
                        let matched = &to_align_with[..to_align_with.len() - rest.len()];
                        let kept = slice_from(whitespace, i64::from(strings::wtf8_len_utf16(matched)));
                        prefix.extend_from_slice(kept);
                        prefix.extend_from_slice(after_star_offset);
                        if kept.is_empty()
                            && after_star_offset.is_empty()
                            && strings::trim_js_whitespace_start(line_text).starts_with(b"/")
                        {
                            prefix.push(b' ');
                        }
                    }
                    // As upstream, which interpolates a variable that it never assigned to.
                    None => prefix.extend_from_slice(b"undefined"),
                }
                fixer.replace(Span::new(line.start, text_start), prefix)
            });
        }
    }

    fn check_separate_lines<'a>(&self, group: Group<'a>, cx: &mut Cx<'a, Self>) {
        let (file, first) = (cx.file(), group.first);
        if first.kind() != TokenKind::Block {
            return;
        }
        let is_jsdoc = is_jsdoc_comment(first);
        if is_jsdoc && !self.check_jsdoc {
            return;
        }
        if let Some(after) = file.tokens_after(first).with_comments().next()
            && file.is_on_same_line(first.end(), after.start())
        {
            return;
        }
        cx.report(opening(first), EXPECTED_LINES).fix(|fixer| {
            let lines = get_comment_lines(file, group);
            let lines = match is_jsdoc {
                true => lines.get(1..lines.len().saturating_sub(1)).unwrap_or_default(),
                false => &lines[..],
            };
            fixer.replace(first, convert_to_separate_lines(get_initial_offset(file, first), lines))
        });
    }

    fn check_bare_block<'a>(&self, group: Group<'a>, cx: &mut Cx<'a, Self>) {
        let (file, first) = (cx.file(), group.first);
        if first.kind() == TokenKind::Line {
            let lines = process_separate_line_comments(file, group);
            if lines.len() > 1 && !contains_block_end(&lines) {
                cx.report(group.span(), EXPECTED_BLOCK).fix(|fixer| {
                    fixer.replace(group.span(), convert_to_block(get_initial_offset(file, first), &lines))
                });
            }
        // A JSDoc comment, which is left alone, is not in starred-block form.
        } else if is_starred_block_comment(first) {
            cx.report(opening(first), EXPECTED_BARE_BLOCK).fix(|fixer| {
                let lines = process_starred_block_comment(first);
                fixer.replace(first, convert_to_block(get_initial_offset(file, first), &lines))
            });
        }
    }

    fn check_group<'a>(&self, group: Group<'a>, cx: &mut Cx<'a, Self>) {
        if group.len == 1 && cx.is_on_same_line(group.first.start(), group.first.end()) {
            return;
        }
        match self.style {
            Style::StarredBlock => self.check_starred_block(group, cx),
            Style::SeparateLines => self.check_separate_lines(group, cx),
            Style::BareBlock => self.check_bare_block(group, cx),
        }
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut group: Option<Group<'a>> = None;
        for comment in file.comments() {
            if comment.kind() == TokenKind::Shebang
                || ast_utils::matches_comments_ignore_pattern(comment.comment_value())
            {
                continue;
            }
            let before = file.tokens_before(comment).with_comments().next();
            let start_line = file.line_of(comment.start());
            if before.is_some_and(|before| file.line_of(before.end()) >= start_line) {
                continue;
            }
            if let Some(group) = &mut group
                && comment.kind() == TokenKind::Line
                && group.last.kind() == TokenKind::Line
                && before == Some(group.last)
                && file.line_of(group.last.end()) + 1 == start_line
            {
                group.last = comment;
                group.len += 1;
                continue;
            }
            let new = Group {
                first: comment,
                last: comment,
                len: 1,
            };
            if let Some(finished) = group.replace(new) {
                self.check_group(finished, cx);
            }
        }
        if let Some(finished) = group {
            self.check_group(finished, cx);
        }
    }
}

impl Rule for MultilineCommentStyle {
    const META: Meta = Meta::eslint("multiline-comment-style", Kind::Suggestion)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MultilineCommentStyle {
            style: match options.str(0) {
                Some("separate-lines") => Style::SeparateLines,
                Some("bare-block") => Style::BareBlock,
                _ => Style::StarredBlock,
            },
            check_jsdoc: options.object(1).bool_or("checkJSDoc", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
