//! A file's JSDoc comments. See [`File::jsdoc`].
//!
//! The names, fields and shapes match the oxc_jsdoc crate, which oxlint and oxfmt use to read comments, so code ported
//! from them stays a straight port. How each part's text is processed follows `oxc_jsdoc`, which is MIT licensed.
//! `bun_sema::check::jsdoc` locates the parts, once per file.
//!
//! Text is a slice of [`File::text`]. Whitespace means `char::is_whitespace`, and bytes that aren't valid UTF-8 count
//! as U+FFFD.

use super::File;
use crate::span::Span;
use bstr::ByteSlice;
use bun_core::strings;
use bun_sema::check::jsdoc::{Flavor, Outline, Range, Tag};

impl<'a> File<'a> {
    /// The file's `/** */` comments, as oxc_jsdoc reads them. This call is free, because they're parsed lazily on the
    /// first lookup.
    #[inline]
    pub fn jsdoc(&'a self) -> JSDocs<'a> {
        JSDocs { file: self }
    }
}

/// Empty if `span` is out of bounds.
fn slice(text: &[u8], span: Span) -> &[u8] {
    text.get(span.range()).unwrap_or_default()
}

fn span_of(range: Range) -> Span {
    Span::new(range.start, range.end)
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
    /// Includes the `/**` and `*/`.
    #[inline]
    pub fn comment_span(self) -> Span {
        self.comment_span
    }

    /// `JSDoc::span`: everything between the `/**` and `*/`.
    #[inline]
    pub fn span(self) -> Span {
        self.comment_span.shrink(3, 2)
    }

    /// `/***/`, `/*****/`, which oxc doesn't treat as JSDoc comments.
    pub fn is_all_asterisks(self) -> bool {
        slice(self.text, self.span())
            .iter()
            .all(|&byte| byte == b'*')
    }

    /// `JSDoc::comment`: everything before the first tag.
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

    /// `@kind{type}`. Not in oxc_jsdoc. The formatter needs it.
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
    /// Includes the braces.
    pub fn raw(self) -> &'a [u8] {
        self.raw
    }

    /// Without the braces and the whitespace just inside them.
    pub fn parsed(self) -> &'a [u8] {
        let end = self.raw.len().saturating_sub(1);
        strings::trim_unicode_whitespace(self.raw.get(1..end).unwrap_or_default())
    }
}

/// `name`, `[name]`, `[name = default]`
#[derive(Copy, Clone)]
pub struct JSDocTagTypeNamePart<'a> {
    pub span: Span,
    /// True if it's in brackets.
    pub optional: bool,
    /// True if it also has a `=`.
    pub default: bool,
    raw: &'a [u8],
}

impl<'a> JSDocTagTypeNamePart<'a> {
    pub fn raw(self) -> &'a [u8] {
        self.raw
    }

    /// Just the name.
    pub fn parsed(self) -> &'a [u8] {
        if !self.optional {
            return self.raw;
        }
        let inner = self.raw.trim_start_with(|c| c == '[');
        let inner = strings::trim_unicode_whitespace(inner.trim_end_with(|c| c == ']'));
        strings::split_once_char(inner, b'=')
            .map_or(inner, |(name, _)| strings::trim_unicode_whitespace(name))
    }
}

/// Strips a comment line's leading `*`. `*word*` at the start of a line is emphasis, so that `*` stays.
fn without_star(trimmed: &[u8]) -> Option<&[u8]> {
    let rest = trimmed.strip_prefix(b"*")?;
    let first = bstr::decode_utf8(rest).0;
    let is_emphasis = first.is_some_and(|c| c.is_alphanumeric() || c == '_');
    (!is_emphasis).then_some(rest)
}

/// A description's source text, including the `*` at the start of each line.
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

    /// The lines of `parsed()`.
    fn parsed_lines(self) -> impl Iterator<Item = &'a [u8]> + 'a {
        let is_multiline = strings::contains_char(self.raw, b'\n');
        let lines = strings::split(self.raw, b"\n").map(move |line| {
            let trimmed = strings::trim_unicode_whitespace(line);
            match without_star(trimmed).filter(|_| is_multiline) {
                Some(rest) => strings::trim_unicode_whitespace_start(rest),
                None => trimmed,
            }
        });
        lines.filter(|line| !line.is_empty())
    }

    /// Strips the `*` at the start of each line, the whitespace around each line, and empty lines.
    pub fn parsed(self) -> Vec<u8> {
        bstr::join(b"\n", self.parsed_lines())
    }

    /// Strips the `*` at the start of each line, but keeps empty lines, indentation after `* `, and two trailing spaces
    /// on a line.
    pub fn parsed_preserving_whitespace(self) -> Vec<u8> {
        if !strings::contains_char(self.raw, b'\n') {
            return strings::trim_unicode_whitespace(self.raw).to_vec();
        }
        let mut result = Vec::with_capacity(self.raw.len());
        for (index, line) in self.raw.lines().enumerate() {
            if index > 0 {
                result.push(b'\n');
            }
            let trimmed = strings::trim_unicode_whitespace(line);
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
}
