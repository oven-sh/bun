//! The documents of the plugin. It takes them apart again after it has made them (`trim`, `trimRight`, `childDocs.pop()`),
//! so they are kept as it has them until all is said, and written to the document of `ir` then.

use crate::html::writer::Writer;
use std::borrow::Cow;

/// Code in another language, which is formatted where it is written.
#[derive(Debug, Clone)]
pub(crate) enum Code<'a> {
    /// What `embed` makes of a node with `isJS`.
    Js(Js<'a>),
    /// `textToDoc(content, { parser })`, without the line breaks at its end.
    Body { content: &'a [u8], parser: Parser },
}

/// The parsers for what is in a `<script>` or a `<style>`.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Parser {
    TypeScript,
    BabelTs,
    Json,
    Css,
    Scss,
    Less,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum JsKind {
    /// `forceIntoExpression`
    Expression,
    /// `asStatement`
    Statement,
    /// `asFunction`: a name and parameters.
    Function,
}

#[derive(Debug, Clone)]
pub(crate) struct Js<'a> {
    /// `getText(node, options, true)`
    pub(crate) text: Cow<'a, [u8]>,
    pub(crate) kind: JsKind,
    /// `forceSingleQuote`
    pub(crate) has_single_quotes: bool,
    /// `forceSingleLine`
    pub(crate) is_on_one_line: bool,
    /// `removeParentheses`
    pub(crate) is_without_parentheses: bool,
}

#[derive(Debug, Clone)]
pub(crate) enum Doc<'a> {
    /// A string. Prettier does not look into it.
    Text(Cow<'a, [u8]>),
    Token(&'static str),
    List(Vec<Doc<'a>>),
    Group(Box<Doc<'a>>),
    Indent(Box<Doc<'a>>),
    Dedent(Box<Doc<'a>>),
    LineSuffix(Box<Doc<'a>>),
    Fill(Vec<Doc<'a>>),
    Line,
    Softline,
    Hardline,
    Literalline,
    BreakParent,
    Code(Box<Code<'a>>),
}

pub(crate) const EMPTY: Doc<'static> = Doc::Token("");

pub(crate) fn text(text: &[u8]) -> Doc<'_> {
    Doc::Text(Cow::Borrowed(text))
}

pub(crate) fn owned<'a>(text: Vec<u8>) -> Doc<'a> {
    Doc::Text(Cow::Owned(text))
}

pub(crate) fn group(contents: Vec<Doc<'_>>) -> Doc<'_> {
    Doc::Group(Box::new(Doc::List(contents)))
}

pub(crate) fn indent(contents: Vec<Doc<'_>>) -> Doc<'_> {
    Doc::Indent(Box::new(Doc::List(contents)))
}

pub(crate) fn dedent(contents: Doc<'_>) -> Doc<'_> {
    Doc::Dedent(Box::new(contents))
}

impl<'a> Doc<'a> {
    /// The string that it is.
    fn as_string(&self) -> Option<&[u8]> {
        match self {
            Doc::Text(text) => Some(&text[..]),
            Doc::Token(text) => Some(text.as_bytes()),
            _ => None,
        }
    }

    /// `isLine`
    pub(crate) fn is_line(&self) -> bool {
        match self {
            Doc::Line | Doc::Softline | Doc::Hardline => true,
            Doc::List(parts) => parts.iter().all(Doc::is_line),
            _ => false,
        }
    }

    /// `isEmptyDoc`
    pub(crate) fn is_empty(&self) -> bool {
        match self {
            Doc::Text(text) => text.is_empty(),
            Doc::Token(text) => text.is_empty(),
            Doc::Line | Doc::Softline => true,
            Doc::List(parts) => parts.is_empty(),
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => contents.is_empty(),
            Doc::Fill(parts) => parts.iter().all(Doc::is_empty),
            Doc::Hardline | Doc::Literalline | Doc::BreakParent | Doc::Code(_) => false,
        }
    }

    /// What the plugin trims a fragment of: a line, a string of blanks, `breakParent`.
    pub(crate) fn is_white_space_of_fragment(&self) -> bool {
        self.is_line()
            || matches!(self, Doc::BreakParent)
            || (self.as_string()).is_some_and(|it| {
                it.iter()
                    .all(|byte| matches!(byte, b'\t' | b'\n' | 0x0C | b'\r' | b' '))
            })
    }

    /// Nothing at all is printed for it.
    fn is_nothing(&self) -> bool {
        match self {
            Doc::Text(text) => text.is_empty(),
            Doc::Token(text) => text.is_empty(),
            Doc::List(parts) | Doc::Fill(parts) => parts.iter().all(Doc::is_nothing),
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => contents.is_nothing(),
            _ => false,
        }
    }

    /// Puts the name in the place of code that is a name. Returns whether there is no other code.
    pub(crate) fn replace_code_by_names(&mut self) -> bool {
        match self {
            Doc::List(parts) | Doc::Fill(parts) => parts.iter_mut().all(Doc::replace_code_by_names),
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => contents.replace_code_by_names(),
            Doc::Code(code) => match &**code {
                Code::Js(js)
                    if js.kind == JsKind::Expression
                        && bun_lint::utils::text::is_identifier_name(&js.text) =>
                {
                    *self = Doc::Text(js.text.clone());
                    true
                }
                _ => false,
            },
            _ => true,
        }
    }

    /// `getParts`
    fn parts_mut(&mut self) -> Option<&mut Vec<Doc<'a>>> {
        match self {
            Doc::List(parts) | Doc::Fill(parts) => Some(parts),
            Doc::Group(contents) => contents.parts_mut(),
            _ => None,
        }
    }
}

/// `trimLeft`
pub(crate) fn trim_left<'a>(mut group: &mut Vec<Doc<'a>>, is_white_space: fn(&Doc<'a>) -> bool) {
    loop {
        let first = (group
            .iter()
            .position(|doc| !doc.is_empty() && !is_white_space(doc)))
        .unwrap_or(group.len());
        if first > 0 {
            if !group.drain(..first).all(|doc| doc.is_empty()) {
                return;
            }
        } else {
            match group.first_mut().and_then(Doc::parts_mut) {
                Some(parts) => group = parts,
                None => return,
            }
        }
    }
}

/// `trimRight`
pub(crate) fn trim_right<'a>(mut group: &mut Vec<Doc<'a>>, is_white_space: fn(&Doc<'a>) -> bool) {
    loop {
        // One more than `lastNonWhitespace`.
        let kept = (group
            .iter()
            .rposition(|doc| !doc.is_empty() && !is_white_space(doc)))
        .map_or(0, |at| at + 1);
        if kept < group.len() {
            if !group.drain(kept..).all(|doc| doc.is_empty()) {
                return;
            }
        } else {
            match group.last_mut().and_then(Doc::parts_mut) {
                Some(parts) => group = parts,
                None => return,
            }
        }
    }
}

/// Whether the last thing in `doc` is a line break that is one only if its group is broken.
fn ends_with_soft_line(doc: &Doc<'_>) -> bool {
    match doc {
        Doc::Line | Doc::Softline => true,
        Doc::List(parts) | Doc::Fill(parts) => (parts
            .iter()
            .rev()
            .find(|it| !matches!(it.as_string(), Some(b""))))
        .is_some_and(ends_with_soft_line),
        Doc::Indent(contents) | Doc::Dedent(contents) => ends_with_soft_line(contents),
        _ => false,
    }
}

/// Writes `doc`, and lets go of each part of it when that is written: what is written takes as much memory again.
/// `write_code` writes the code in it.
pub(crate) fn write<'a>(
    doc: Doc<'a>,
    out: &mut Writer<'_, '_>,
    write_code: &mut dyn FnMut(&Code<'a>, &mut Writer<'_, '_>),
) {
    match doc {
        Doc::Text(text) => out.string(&text),
        Doc::Token(text) => {
            if !text.is_empty() {
                out.token(text);
            }
        }
        Doc::List(parts) => {
            for part in parts {
                write(part, out, write_code);
            }
        }
        // The writer takes what has a start and an end for something.
        Doc::Group(contents) if contents.is_nothing() => {}
        Doc::Group(contents) => {
            let id = ends_with_soft_line(&contents).then(|| out.new_group_id());
            out.start_group_with(false, id);
            write(*contents, out, write_code);
            out.end_group();
            if let Some(id) = id {
                out.note_line_at_end_of_group(id);
            }
        }
        Doc::Indent(contents) => {
            out.start_indent();
            write(*contents, out, write_code);
            out.end_indent();
        }
        Doc::Dedent(contents) => {
            out.start_dedent();
            write(*contents, out, write_code);
            out.end_dedent();
        }
        Doc::LineSuffix(contents) => {
            out.start_line_suffix();
            write(*contents, out, write_code);
            out.end_line_suffix();
        }
        Doc::Fill(parts) => {
            out.start_fill();
            for part in parts {
                out.start_item();
                write(part, out, write_code);
                out.end_item();
            }
            out.end_fill();
        }
        Doc::Line => out.line_or_blank(),
        Doc::Softline => out.softline(),
        Doc::Hardline => out.hardline(),
        Doc::Literalline => out.text(b"\n"),
        Doc::BreakParent => out.break_parent(),
        Doc::Code(code) => write_code(&code, out),
    }
}
