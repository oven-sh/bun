//! The JSDoc comments of a file: [`File::jsdoc`].
//!
//! The names, the fields and the shapes are those of the crate oxc_jsdoc, with which oxlint and oxfmt read comments, so that
//! a port of their code stays one. What is done with the text of a part follows `oxc_jsdoc`, which is under the MIT license.
//! Where the parts are is read by `bun_sema::check::jsdoc`, once for a file.
//!
//! Text is a slice of [`File::text`]. White space is `char::is_whitespace`, and bytes that are not UTF-8 are U+FFFD.

use super::File;
use crate::span::Span;
use bstr::ByteSlice;
use bun_core::strings;
use bun_sema::check::jsdoc::{Flavor, Outline, Range, Tag};

impl<'a> File<'a> {
    /// The `/** */` comments of the file, as oxc_jsdoc reads them. This call costs nothing: they are read when the first of
    /// them is asked for.
    #[inline]
    pub fn jsdoc(&'a self) -> JSDocs<'a> {
        JSDocs { file: self }
    }
}

/// Empty if `span` is not in `text`.
fn slice(text: &[u8], span: Span) -> &[u8] {
    text.get(span.range()).unwrap_or_default()
}

fn span_of(range: Range) -> Span {
    Span::new(range.start, range.end)
}

fn trim(text: &[u8]) -> &[u8] {
    text.trim_with(char::is_whitespace)
}

#[derive(Copy, Clone)]
pub struct JSDocs<'a> {
    file: &'a File<'a>,
}

impl<'a> JSDocs<'a> {
    /// The comment whose `/**` is at `start`.
    pub fn at(self, start: u32) -> Option<JSDoc<'a>> {
        let file = self.file;
        let read = || Outline::read(file.text(), file.hir.comments, Flavor::Oxc, &|| false);
        let outline = file.lazy.jsdoc.get_or_init(read);
        let index = outline.index_at(start)?;
        let comment = outline.comments.get(index)?;
        Some(JSDoc {
            text: file.text(),
            tags: outline.tags_of(index),
            comment_span: Span::new(comment.start, comment.end),
        })
    }
}

#[derive(Copy, Clone)]
pub struct JSDoc<'a> {
    text: &'a [u8],
    tags: &'a [Tag],
    comment_span: Span,
}

impl<'a> JSDoc<'a> {
    /// With the `/**` and the `*/`.
    #[inline]
    pub fn comment_span(self) -> Span {
        self.comment_span
    }

    /// `JSDoc::span`: what is between the `/**` and the `*/`.
    #[inline]
    pub fn span(self) -> Span {
        self.comment_span.shrink(3, 2)
    }

    /// `/***/`, `/*****/`: no JSDoc comment for oxc.
    pub fn is_all_asterisks(self) -> bool {
        slice(self.text, self.span())
            .iter()
            .all(|&byte| byte == b'*')
    }

    /// `JSDoc::comment`: what is before the first tag.
    pub fn comment(self) -> JSDocCommentPart<'a> {
        let span = self.span();
        let end = self.tags.first().map_or(span.end, |tag| tag.at);
        JSDocCommentPart::new(self.text, span.start, end)
    }

    /// `JSDoc::tags`
    pub fn tags(self) -> impl ExactSizeIterator<Item = JSDocTag<'a>> + Clone + 'a {
        let text = self.text;
        self.tags.iter().map(move |row| {
            let span = Span::new(row.at, row.name_end);
            let raw = slice(text, span);
            JSDocTag {
                span: Span::new(row.at, row.end),
                kind: JSDocTagKindPart { span, raw },
                text,
                row,
            }
        })
    }
}

#[derive(Copy, Clone)]
pub struct JSDocTag<'a> {
    /// From the `@` to the next tag.
    pub span: Span,
    pub kind: JSDocTagKindPart<'a>,
    text: &'a [u8],
    row: &'a Tag,
}

impl<'a> JSDocTag<'a> {
    /// `@kind comment`
    pub fn comment(self) -> JSDocCommentPart<'a> {
        JSDocCommentPart::new(self.text, self.row.name_end, self.row.end)
    }

    /// `@kind {type}`
    fn r#type(self) -> Option<JSDocTagTypePart<'a>> {
        let ty = self.row.ty;
        let span = span_of(ty);
        let raw = slice(self.text, span);
        ty.is_some().then_some(JSDocTagTypePart { span, raw })
    }

    /// `@kind {type} comment`
    pub fn type_comment(self) -> (Option<JSDocTagTypePart<'a>>, JSDocCommentPart<'a>) {
        let row = self.row;
        let start = if row.ty.is_none() {
            row.name_end
        } else {
            row.ty.end
        };
        let comment = JSDocCommentPart::new(self.text, start, row.end);
        (self.r#type(), comment)
    }

    /// `@kind {type} name comment`
    pub fn type_name_comment(
        self,
    ) -> (
        Option<JSDocTagTypePart<'a>>,
        Option<JSDocTagTypeNamePart<'a>>,
        JSDocCommentPart<'a>,
    ) {
        let row = self.row;
        let span = span_of(row.name);
        let raw = slice(self.text, span);
        let name = row.name.is_some().then_some(JSDocTagTypeNamePart {
            span,
            optional: raw.starts_with(b"[") && raw.ends_with(b"]"),
            default: row.default.is_some(),
            raw,
        });
        let comment = JSDocCommentPart::new(self.text, row.text, row.end);
        (self.r#type(), name, comment)
    }

    /// `@kind{type}`. The formatter's own.
    pub fn has_no_space_before_type(self) -> bool {
        self.text.get(self.row.name_end as usize) == Some(&b'{')
    }
}

/// `@kind`
#[derive(Copy, Clone)]
pub struct JSDocTagKindPart<'a> {
    pub span: Span,
    raw: &'a [u8],
}

impl<'a> JSDocTagKindPart<'a> {
    /// Without the `@`.
    pub fn parsed(self) -> &'a [u8] {
        self.raw.get(1..).unwrap_or_default()
    }
}

/// `{type}`
#[derive(Copy, Clone)]
pub struct JSDocTagTypePart<'a> {
    pub span: Span,
    raw: &'a [u8],
}

impl<'a> JSDocTagTypePart<'a> {
    /// With the braces.
    pub fn raw(self) -> &'a [u8] {
        self.raw
    }

    /// Without them and the white space in them.
    pub fn parsed(self) -> &'a [u8] {
        let end = self.raw.len().saturating_sub(1);
        trim(self.raw.get(1..end).unwrap_or_default())
    }
}

/// `name`, `[name]`, `[name = default]`
#[derive(Copy, Clone)]
pub struct JSDocTagTypeNamePart<'a> {
    pub span: Span,
    /// It is in brackets.
    pub optional: bool,
    /// And has a `=`.
    pub default: bool,
    raw: &'a [u8],
}

impl<'a> JSDocTagTypeNamePart<'a> {
    pub fn raw(self) -> &'a [u8] {
        self.raw
    }

    /// The name alone.
    pub fn parsed(self) -> &'a [u8] {
        if !self.optional {
            return self.raw;
        }
        let inner = self.raw.trim_start_with(|c| c == '[');
        let inner = trim(inner.trim_end_with(|c| c == ']'));
        strings::split_once_char(inner, b'=').map_or(inner, |(name, _)| trim(name))
    }
}

/// `*word*` at the start of a line is emphasis, not the `*` that starts a line of the comment.
fn without_star(trimmed: &[u8]) -> Option<&[u8]> {
    let rest = trimmed.strip_prefix(b"*")?;
    let first = bstr::decode_utf8(rest).0;
    let is_emphasis = first.is_some_and(|c| c.is_alphanumeric() || c == '_');
    (!is_emphasis).then_some(rest)
}

/// A description as it is written, with the `*` at the start of each line.
#[derive(Copy, Clone)]
pub struct JSDocCommentPart<'a> {
    pub span: Span,
    raw: &'a [u8],
}

impl<'a> JSDocCommentPart<'a> {
    fn new(text: &'a [u8], start: u32, end: u32) -> Self {
        let span = Span::new(start, end);
        let raw = slice(text, span);
        JSDocCommentPart { span, raw }
    }

    /// The first line that has something, without the white space around it.
    pub fn span_trimmed_first_line(self) -> Span {
        let JSDocCommentPart { span, raw } = self;
        let start_trimmed = raw.trim_start_with(char::is_whitespace);
        if start_trimmed.is_empty() {
            return Span::empty(span.start);
        }
        let start = span.start + (raw.len() - start_trimmed.len()) as u32;
        // `raw.lines().count() == 1`
        if strings::index_of_char_usize(raw, b'\n').is_none_or(|at| at + 1 == raw.len()) {
            let end_trimmed = raw.trim_end_with(char::is_whitespace);
            return Span::new(start, span.end - (raw.len() - end_trimmed.len()) as u32);
        }
        Span::new(
            start,
            start + strings::index_of_char(start_trimmed, b'\n').unwrap_or(0),
        )
    }

    /// The lines of `parsed()`.
    fn parsed_lines(self) -> impl Iterator<Item = &'a [u8]> + 'a {
        let is_multiline = strings::contains_char(self.raw, b'\n');
        let lines = strings::split(self.raw, b"\n").map(move |line| {
            let trimmed = trim(line);
            match without_star(trimmed).filter(|_| is_multiline) {
                Some(rest) => rest.trim_start_with(char::is_whitespace),
                None => trimmed,
            }
        });
        lines.filter(|line| !line.is_empty())
    }

    /// Without the `*` at the start of each line, the white space around each line, and empty lines.
    pub fn parsed(self) -> Vec<u8> {
        bstr::join(b"\n", self.parsed_lines())
    }

    /// Without the `*` at the start of each line. Empty lines stay, the indentation behind `* ` stays, two blanks at the end of
    /// a line stay.
    pub fn parsed_preserving_whitespace(self) -> Vec<u8> {
        if !strings::contains_char(self.raw, b'\n') {
            return trim(self.raw).to_vec();
        }
        let mut result = Vec::with_capacity(self.raw.len());
        for (index, line) in self.raw.lines().enumerate() {
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

    /// `parsed().is_empty()`, without the allocation.
    pub fn is_empty(self) -> bool {
        self.parsed_lines().next().is_none()
    }

    /// `parsed()`, if it is one line.
    pub fn single_line(self) -> Option<&'a [u8]> {
        let mut lines = self.parsed_lines();
        lines.next().filter(|_| lines.next().is_none())
    }
}
