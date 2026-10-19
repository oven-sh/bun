//! The plugin's docs. The plugin edits them after it builds them (`trim`, `trimRight`, `childDocs.pop()`), so they
//! stay in its representation until the whole component is printed, and only then are they written to the `ir`
//! document.

use crate::html::writer::Writer;
use crate::stack::Stack;
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;

/// Code in another language. It's formatted when the doc is written.
#[derive(Debug, Clone)]
pub(crate) enum Code<'a> {
    /// `embed`'s result for a node with `isJS`.
    Js(Js<'a>),
    /// `textToDoc(content, { parser })`, minus trailing line breaks. `start` is its offset in the component.
    Body {
        content: &'a [u8],
        parser: Parser,
        start: u32,
    },
}

/// The parsers for `<script>` and `<style>` content.
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

/// The `{` of a tag.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Brace {
    InMarkup,
    /// In the value of an attribute, or in a `<textarea>`.
    InValue,
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
    pub(crate) remove_parentheses: bool,
    /// Svelte resumes parsing right where the code ends and doesn't allow a comment there: `{#each a}`.
    pub(crate) forbids_trailing_comment: bool,
    /// Set if the code comes right after a `{`.
    pub(crate) follows: Option<Brace>,
}

#[derive(Debug, Clone)]
pub(crate) enum Doc<'a> {
    /// A string. Prettier doesn't look inside it.
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

/// The docs still to visit.
type Rest<'d, 'a> = SmallVec<[&'d Doc<'a>; 8]>;

impl<'a> Doc<'a> {
    /// Moves the doc out and leaves `EMPTY` in its place.
    fn take(&mut self) -> Doc<'a> {
        std::mem::replace(self, EMPTY)
    }

    /// Moves those of its children that have children themselves to `rest`.
    fn take_contents(&mut self, rest: &mut Vec<Doc<'a>>) {
        let mut take = |contents: &mut Doc<'a>| {
            if matches!(
                contents,
                Doc::List(_)
                    | Doc::Group(_)
                    | Doc::Indent(_)
                    | Doc::Dedent(_)
                    | Doc::LineSuffix(_)
                    | Doc::Fill(_)
            ) {
                rest.push(contents.take());
            }
        };
        match self {
            Doc::List(parts) | Doc::Fill(parts) => parts.iter_mut().for_each(take),
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => take(contents),
            _ => {}
        }
    }

    /// True if `is` returns true for this doc and for every doc that `is` pushes onto the list.
    fn all<'d>(&'d self, is: impl Fn(&'d Doc<'a>, &mut Rest<'d, 'a>) -> bool) -> bool {
        let mut rest: Rest<'d, 'a> = smallvec![self];
        while let Some(doc) = rest.pop() {
            if !is(doc, &mut rest) {
                return false;
            }
        }
        true
    }

    /// Its string, if it's `Text` or `Token`.
    fn as_string(&self) -> Option<&[u8]> {
        match self {
            Doc::Text(text) => Some(&text[..]),
            Doc::Token(text) => Some(text.as_bytes()),
            _ => None,
        }
    }

    /// `isLine`
    pub(crate) fn is_line(&self) -> bool {
        self.all(|doc, rest| match doc {
            Doc::Line | Doc::Softline | Doc::Hardline => true,
            Doc::List(parts) => {
                rest.extend(parts);
                true
            }
            _ => false,
        })
    }

    /// `isEmptyDoc`
    pub(crate) fn is_empty(&self) -> bool {
        self.all(|doc, rest| match doc {
            Doc::Text(text) => text.is_empty(),
            Doc::Token(text) => text.is_empty(),
            Doc::Line | Doc::Softline => true,
            Doc::List(parts) => parts.is_empty(),
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => {
                rest.push(contents);
                true
            }
            Doc::Fill(parts) => {
                rest.extend(parts);
                true
            }
            Doc::Hardline | Doc::Literalline | Doc::BreakParent | Doc::Code(_) => false,
        })
    }

    /// True for the docs that the plugin trims from a fragment: a line, an all-whitespace string or `breakParent`.
    pub(crate) fn is_fragment_whitespace(&self) -> bool {
        self.is_line()
            || matches!(self, Doc::BreakParent)
            || (self.as_string()).is_some_and(|it| {
                it.iter()
                    .all(|byte| matches!(byte, b'\t' | b'\n' | 0x0C | b'\r' | b' '))
            })
    }

    /// True if it prints nothing at all.
    fn prints_nothing(&self) -> bool {
        self.all(|doc, rest| match doc {
            Doc::Text(text) => text.is_empty(),
            Doc::Token(text) => text.is_empty(),
            Doc::List(parts) | Doc::Fill(parts) => {
                rest.extend(parts);
                true
            }
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => {
                rest.push(contents);
                true
            }
            _ => false,
        })
    }

    /// Replaces each piece of code that's only an identifier with its text. Returns false if there's any other code.
    pub(crate) fn replace_identifier_code_with_text(&mut self) -> bool {
        let mut rest: Vec<&mut Doc<'a>> = vec![self];
        while let Some(doc) = rest.pop() {
            match doc {
                Doc::List(parts) | Doc::Fill(parts) => rest.extend(parts),
                Doc::Group(contents)
                | Doc::Indent(contents)
                | Doc::Dedent(contents)
                | Doc::LineSuffix(contents) => rest.push(contents),
                Doc::Code(code) => match &**code {
                    Code::Js(js)
                        if js.kind == JsKind::Expression
                            && bun_lint::utils::text::is_identifier_name(&js.text) =>
                    {
                        *doc = Doc::Text(js.text.clone());
                    }
                    _ => return false,
                },
                _ => {}
            }
        }
        true
    }

    /// `getParts`
    fn parts_mut(&mut self) -> Option<&mut Vec<Doc<'a>>> {
        let mut doc = self;
        loop {
            match doc {
                Doc::List(parts) | Doc::Fill(parts) => return Some(parts),
                Doc::Group(contents) => doc = contents,
                _ => return None,
            }
        }
    }
}

/// Drops in a loop. A doc nests as deeply as its source, and the compiler's drop glue recurses once per level without
/// a stack check.
impl Drop for Doc<'_> {
    fn drop(&mut self) {
        let mut rest = Vec::new();
        self.take_contents(&mut rest);
        while let Some(mut doc) = rest.pop() {
            doc.take_contents(&mut rest);
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
        let trimmed_len = (group
            .iter()
            .rposition(|doc| !doc.is_empty() && !is_white_space(doc)))
        .map_or(0, |at| at + 1);
        if trimmed_len < group.len() {
            if !group.drain(trimmed_len..).all(|doc| doc.is_empty()) {
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

/// True if `doc` ends with a line that only breaks if its group breaks.
fn ends_with_soft_line(mut doc: &Doc<'_>) -> bool {
    loop {
        doc = match doc {
            Doc::Line | Doc::Softline => return true,
            Doc::List(parts) | Doc::Fill(parts) => {
                let mut non_empty = (parts.iter().rev()).filter(|it| it.as_string() != Some(b""));
                match non_empty.next() {
                    Some(last) => last,
                    None => return false,
                }
            }
            Doc::Indent(contents) | Doc::Dedent(contents) => contents,
            _ => return false,
        };
    }
}

/// Context for `write`.
pub(crate) struct Write<'w, 'a> {
    /// Writes embedded code.
    pub(crate) code: &'w mut dyn FnMut(&Code<'a>, &mut Writer<'_, '_>),
    pub(crate) stack: &'w Stack,
}

/// Writes `doc` and frees each part as soon as it's written, because the written form takes as much memory again.
pub(crate) fn write<'a>(mut doc: Doc<'a>, out: &mut Writer<'_, '_>, context: &mut Write<'_, 'a>) {
    if !context.stack.has_room() {
        return;
    }
    match &mut doc {
        Doc::Text(text) => out.string(text),
        Doc::Token(text) => {
            if !text.is_empty() {
                out.token(text);
            }
        }
        Doc::List(parts) => {
            for part in std::mem::take(parts) {
                write(part, out, context);
            }
        }
        // The writer counts any start/end pair as content, even an empty one.
        Doc::Group(contents) if contents.prints_nothing() => {}
        Doc::Group(contents) => {
            let id = ends_with_soft_line(contents).then(|| out.new_group_id());
            out.start_group_with(false, id);
            write(contents.take(), out, context);
            out.end_group();
            if let Some(id) = id {
                out.note_line_at_end_of_group(id);
            }
        }
        Doc::Indent(contents) => {
            out.start_indent();
            write(contents.take(), out, context);
            out.end_indent();
        }
        Doc::Dedent(contents) => {
            out.start_dedent();
            write(contents.take(), out, context);
            out.end_dedent();
        }
        Doc::LineSuffix(contents) => {
            out.start_line_suffix();
            write(contents.take(), out, context);
            out.end_line_suffix();
        }
        Doc::Fill(parts) => {
            out.start_fill();
            for part in std::mem::take(parts) {
                out.start_item();
                write(part, out, context);
                out.end_item();
            }
            out.end_fill();
        }
        Doc::Line => out.line_or_literal_space(),
        Doc::Softline => out.softline(),
        Doc::Hardline => out.hardline(),
        Doc::Literalline => out.text(b"\n"),
        Doc::BreakParent => out.break_parent(),
        Doc::Code(code) => {
            (context.code)(code, out);
            // A comment in the code that's deferred to the end of the line must not move past the `}`:
            // `{a[0 // b\n]}`.
            if matches!(**code, Code::Js(_)) {
                out.line_suffix_boundary();
            }
        }
    }
}
