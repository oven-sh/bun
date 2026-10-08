//! What is in a JSDoc comment: a description and tags. This is the parser of `oxc_jsdoc`.

use super::text::{first_char, lines, trim, trim_end_matches, trim_start, trim_start_matches};
use bun_core::strings;

/// A description, as it is written: with the `*` at the start of each line.
#[derive(Copy, Clone)]
pub(super) struct CommentPart<'a>(&'a [u8]);

/// `*word*` at the start of a line is emphasis, not the `*` that starts a line of the comment.
fn without_star(trimmed: &[u8]) -> Option<&[u8]> {
    let rest = trimmed.strip_prefix(b"*")?;
    let is_emphasis = first_char(rest).is_some_and(|(c, _)| c.is_alphanumeric() || c == '_');
    (!is_emphasis).then_some(rest)
}

impl CommentPart<'_> {
    /// Without the `*` at the start of each line. Empty lines stay, and so does the indentation behind `* `.
    pub(super) fn parsed_preserving_whitespace(&self) -> Vec<u8> {
        if !strings::contains_char(self.0, b'\n') {
            return trim(self.0).to_vec();
        }
        let mut result = Vec::with_capacity(self.0.len());
        for (index, line) in lines(self.0).enumerate() {
            if index > 0 {
                result.push(b'\n');
            }
            let trimmed = trim(line);
            let content = match without_star(trimmed) {
                Some(rest) => rest.strip_prefix(b" ").unwrap_or(rest),
                None => trimmed,
            };
            result.extend_from_slice(content);
            // Two spaces at the end of a line are a line break in Markdown.
            if line.ends_with(b"  ") && !content.is_empty() {
                result.extend_from_slice(b"  ");
            }
        }
        result
    }

    /// Without the `*` at the start of each line, the white space around each line, and empty lines.
    pub(super) fn parsed(&self) -> Vec<u8> {
        if !strings::contains_char(self.0, b'\n') {
            return trim(self.0).to_vec();
        }
        let mut result = Vec::with_capacity(self.0.len());
        for line in lines(self.0) {
            let trimmed = trim(line);
            let content = without_star(trimmed).map_or(trimmed, trim);
            if content.is_empty() {
                continue;
            }
            if !result.is_empty() {
                result.push(b'\n');
            }
            result.extend_from_slice(content);
        }
        result
    }
}

/// `{type}`, with the braces.
#[derive(Copy, Clone)]
pub(super) struct TypePart<'a>(&'a [u8]);

impl<'a> TypePart<'a> {
    pub(super) fn raw(&self) -> &'a [u8] {
        self.0
    }

    /// Without the braces.
    pub(super) fn parsed(&self) -> &'a [u8] {
        trim(&self.0[1..self.0.len() - 1])
    }
}

/// `name`, `[name]` or `[name = default]`
#[derive(Copy, Clone)]
pub(super) struct NamePart<'a>(&'a [u8]);

impl<'a> NamePart<'a> {
    pub(super) fn raw(&self) -> &'a [u8] {
        self.0
    }

    /// The name alone.
    pub(super) fn parsed(&self) -> &'a [u8] {
        if !(self.0.starts_with(b"[") && self.0.ends_with(b"]")) {
            return self.0;
        }
        let inner = trim(trim_end_matches(
            trim_start_matches(self.0, |c| c == '['),
            |c| c == ']',
        ));
        strings::split_once_char(inner, b'=').map_or(inner, |(name, _)| trim(name))
    }
}

pub(super) struct Tag<'a> {
    /// Without the `@`.
    pub(super) kind: &'a [u8],
    /// What follows the kind, with the white space before it.
    body: &'a [u8],
}

impl<'a> Tag<'a> {
    /// Whether a type follows the kind without a space: `@type{T}`.
    pub(super) fn has_no_space_before_type(&self) -> bool {
        self.body.starts_with(b"{")
    }

    /// `@kind comment`
    pub(super) fn comment(&self) -> CommentPart<'a> {
        CommentPart(self.body)
    }

    /// `@kind {type} comment`
    pub(super) fn type_comment(&self) -> (Option<TypePart<'a>>, CommentPart<'a>) {
        match find_type_range(self.body) {
            Some((start, end)) => (
                Some(TypePart(&self.body[start..end])),
                CommentPart(&self.body[end..]),
            ),
            None => (None, CommentPart(self.body)),
        }
    }

    /// `@kind {type} name comment`
    pub(super) fn type_name_comment(
        &self,
    ) -> (Option<TypePart<'a>>, Option<NamePart<'a>>, CommentPart<'a>) {
        let (type_part, rest) = match find_type_range(self.body) {
            Some((start, end)) => (Some(TypePart(&self.body[start..end])), &self.body[end..]),
            None => (None, self.body),
        };
        match find_type_name_range(rest) {
            Some((start, end)) => (
                type_part,
                Some(NamePart(&rest[start..end])),
                CommentPart(&rest[end..]),
            ),
            None => (type_part, None, CommentPart(rest)),
        }
    }
}

/// Where the `{...}` is that `text` starts with, after white space.
fn find_type_range(text: &[u8]) -> Option<(usize, usize)> {
    let trimmed = trim_start(text);
    if !trimmed.starts_with(b"{") {
        return None;
    }
    let offset = text.len() - trimmed.len();
    let mut brace_count = 0usize;
    for (index, &byte) in trimmed.iter().enumerate() {
        match byte {
            b'{' => brace_count += 1,
            b'}' => {
                brace_count -= 1;
                if brace_count == 0 {
                    return Some((offset, offset + index + 1));
                }
            }
            _ => {}
        }
    }
    None
}

/// Like a token, but there can be white space in `[name = default]`.
fn find_type_name_range(text: &[u8]) -> Option<(usize, usize)> {
    if !trim_start(text).starts_with(b"[") {
        return find_token_range(text);
    }
    let mut bracket = 0i32;
    let mut start = None;
    let mut index = 0;
    while let Some((char, len)) = first_char(&text[index..]) {
        if char.is_whitespace() {
            if bracket == 0
                && let Some(start) = start
            {
                return Some((start, index));
            }
        } else {
            bracket += i32::from(char == '[') - i32::from(char == ']');
            start.get_or_insert(index);
        }
        index += len;
    }
    start
        .filter(|_| bracket == 0)
        .map(|start| (start, text.len()))
}

/// Where the first word of `text` is. A `{` ends it as well: `@kind{type}`.
fn find_token_range(text: &[u8]) -> Option<(usize, usize)> {
    let mut start = None;
    let mut index = 0;
    while let Some((char, len)) = first_char(&text[index..]) {
        if char.is_whitespace() || char == '{' {
            if let Some(start) = start {
                return Some((start, index));
            }
        } else {
            start.get_or_insert(index);
        }
        index += len;
    }
    start.map(|start| (start, text.len()))
}

/// `content` starts with `@`.
fn parse_tag(content: &[u8]) -> Tag<'_> {
    let (start, end) = find_token_range(content).unwrap_or((0, content.len()));
    Tag {
        kind: content.get(start + 1..end).unwrap_or_default(),
        body: &content[end..],
    }
}

/// `text`: what is between `/**` and `*/`.
pub(super) fn parse(text: &[u8]) -> (CommentPart<'_>, Vec<Tag<'_>>) {
    let mut comment = None;
    let mut tags = Vec::new();
    // An `@` in braces, brackets, parentheses, backticks or quotes does not start a tag.
    let (mut curly_brace_depth, mut brace_depth, mut square_brace_depth) = (0i32, 0i32, 0i32);
    // How many backticks have opened the code that this is in.
    let mut backtick_count = 0u32;
    let (mut in_double_quotes, mut in_single_quotes) = (false, false);
    // Only an `@` that comes first on its line, after white space and `*`, starts a tag.
    let mut at_line_start = true;
    // With five spaces or more behind the `*`, the line is code.
    let mut line_seen_star = false;
    let mut spaces_after_star = 0u32;
    let mut start = 0;
    let mut end = 0;
    while let Some(&byte) = text.get(end) {
        let can_parse = curly_brace_depth == 0
            && square_brace_depth == 0
            && brace_depth == 0
            && backtick_count == 0
            && !in_double_quotes
            && !in_single_quotes;
        let is_plain = backtick_count == 0 && !in_double_quotes && !in_single_quotes;
        match byte {
            b'`' if !in_single_quotes && !in_double_quotes => {
                let mut count = 1;
                while text.get(end + 1) == Some(&b'`') {
                    end += 1;
                    count += 1;
                }
                if backtick_count == 0 {
                    backtick_count = count;
                } else if backtick_count == count {
                    backtick_count = 0;
                }
            }
            b'"' if backtick_count == 0 && !in_single_quotes => {
                in_double_quotes = !in_double_quotes
            }
            b'\'' if backtick_count == 0 && !in_double_quotes => {
                in_single_quotes = !in_single_quotes
            }
            b'\n' => {
                in_double_quotes = false;
                in_single_quotes = false;
                brace_depth = 0;
                square_brace_depth = 0;
            }
            b'{' if is_plain => curly_brace_depth += 1,
            b'}' if is_plain => curly_brace_depth = (curly_brace_depth - 1).max(0),
            b'(' if is_plain => brace_depth += 1,
            b')' if is_plain => brace_depth = (brace_depth - 1).max(0),
            b'[' if is_plain => square_brace_depth += 1,
            b']' if is_plain => square_brace_depth = (square_brace_depth - 1).max(0),
            b'@' if can_parse && at_line_start && !(line_seen_star && spaces_after_star >= 5) => {
                let part = &text[start..end];
                match comment {
                    Some(_) => tags.push(parse_tag(part)),
                    None => comment = Some(CommentPart(part)),
                }
                start = end;
            }
            _ => {}
        }
        if byte == b'\n' {
            at_line_start = true;
            line_seen_star = false;
            spaces_after_star = 0;
        } else if at_line_start {
            match byte {
                b'*' => {
                    line_seen_star = true;
                    spaces_after_star = 0;
                }
                b' ' | b'\t' | b'\r' => spaces_after_star += u32::from(line_seen_star),
                _ => at_line_start = false,
            }
        }
        end += 1;
    }
    if start != end {
        let part = &text[start..end];
        match comment {
            Some(_) => tags.push(parse_tag(part)),
            None => comment = Some(CommentPart(part)),
        }
    }
    (comment.unwrap_or(CommentPart(b"")), tags)
}
