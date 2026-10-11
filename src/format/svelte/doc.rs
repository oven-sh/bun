//! The documents of the plugin. It takes them apart again after it has made them (`trim`, `trimRight`, `childDocs.pop()`),
//! so they are kept as it has them until all is said, and written to the document of `ir` then.

use crate::html::writer::Writer;
use crate::stack::Stack;
use smallvec::SmallVec;
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

/// In a loop: a document is nested as deeply as the markup, and what the compiler makes to let go of one calls itself for
/// each level without asking whether there is stack for that.
impl Drop for Doc<'_> {
    fn drop(&mut self) {
        let mut rest = Vec::new();
        self.take_contents(&mut rest);
        while let Some(mut doc) = rest.pop() {
            doc.take_contents(&mut rest);
        }
    }
}

impl<'a> Doc<'a> {
    /// What it is. It is nothing afterwards.
    fn take(&mut self) -> Doc<'a> {
        std::mem::replace(self, EMPTY)
    }

    /// What is in it.
    fn contents(&self) -> &[Doc<'a>] {
        match self {
            Doc::List(parts) | Doc::Fill(parts) => parts,
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => std::slice::from_ref(&**contents),
            _ => &[],
        }
    }

    fn contents_mut(&mut self) -> &mut [Doc<'a>] {
        match self {
            Doc::List(parts) | Doc::Fill(parts) => parts,
            Doc::Group(contents)
            | Doc::Indent(contents)
            | Doc::Dedent(contents)
            | Doc::LineSuffix(contents) => std::slice::from_mut(&mut **contents),
            _ => &mut [],
        }
    }

    /// Moves what is in it, and has something in it, to `rest`.
    fn take_contents(&mut self, rest: &mut Vec<Doc<'a>>) {
        for doc in self.contents_mut() {
            if !doc.contents().is_empty() {
                rest.push(doc.take());
            }
        }
    }

    /// Whether `is` is true for `self`. If it says `None`: for all that is in it.
    fn all(&self, is: impl Fn(&Doc<'a>) -> Option<bool>) -> bool {
        let mut rest = SmallVec::<[&Doc<'a>; 8]>::new();
        rest.push(self);
        while let Some(doc) = rest.pop() {
            match is(doc) {
                Some(true) => {}
                Some(false) => return false,
                None => rest.extend(doc.contents()),
            }
        }
        true
    }

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
        self.all(|doc| match doc {
            Doc::Line | Doc::Softline | Doc::Hardline => Some(true),
            Doc::List(_) => None,
            _ => Some(false),
        })
    }

    /// `isEmptyDoc`
    pub(crate) fn is_empty(&self) -> bool {
        self.all(|doc| match doc {
            Doc::Text(text) => Some(text.is_empty()),
            Doc::Token(text) => Some(text.is_empty()),
            Doc::Line | Doc::Softline => Some(true),
            Doc::List(parts) => Some(parts.is_empty()),
            Doc::Group(_) | Doc::Indent(_) | Doc::Dedent(_) | Doc::LineSuffix(_) | Doc::Fill(_) => {
                None
            }
            Doc::Hardline | Doc::Literalline | Doc::BreakParent | Doc::Code(_) => Some(false),
        })
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
        self.all(|doc| match doc {
            Doc::Text(text) => Some(text.is_empty()),
            Doc::Token(text) => Some(text.is_empty()),
            Doc::List(_)
            | Doc::Fill(_)
            | Doc::Group(_)
            | Doc::Indent(_)
            | Doc::Dedent(_)
            | Doc::LineSuffix(_) => None,
            _ => Some(false),
        })
    }

    /// Puts the name in the place of code that is a name, up to the first code that is none. Returns whether there is no
    /// such code.
    pub(crate) fn replace_code_by_names(&mut self) -> bool {
        // What has not been looked at. The last comes first.
        let mut rest = vec![self];
        while let Some(doc) = rest.pop() {
            if let Doc::Code(code) = doc {
                match &**code {
                    Code::Js(js)
                        if js.kind == JsKind::Expression
                            && bun_lint::utils::text::is_identifier_name(&js.text) =>
                    {
                        *doc = Doc::Text(js.text.clone());
                    }
                    _ => return false,
                }
            } else {
                rest.extend(doc.contents_mut().iter_mut().rev());
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
                Doc::Group(contents) => doc = &mut **contents,
                _ => return None,
            }
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
fn ends_with_soft_line(mut doc: &Doc<'_>) -> bool {
    loop {
        doc = match doc {
            Doc::Line | Doc::Softline => return true,
            Doc::List(parts) | Doc::Fill(parts) => {
                match (parts.iter().rev()).find(|it| !matches!(it.as_string(), Some(b""))) {
                    Some(last) => last,
                    None => return false,
                }
            }
            Doc::Indent(contents) | Doc::Dedent(contents) => &**contents,
            _ => return false,
        };
    }
}

/// Writes `doc`, and lets go of each part of it when that is written: what is written takes as much memory again.
/// `write_code` writes the code in it.
pub(crate) fn write<'a>(
    mut doc: Doc<'a>,
    out: &mut Writer<'_, '_>,
    stack: &Stack,
    write_code: &mut dyn FnMut(&Code<'a>, &mut Writer<'_, '_>),
) {
    if !stack.has_room() {
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
                write(part, out, stack, write_code);
            }
        }
        // The writer takes what has a start and an end for something.
        Doc::Group(contents) if contents.is_nothing() => {}
        Doc::Group(contents) => {
            let id = ends_with_soft_line(contents).then(|| out.new_group_id());
            out.start_group_with(false, id);
            write(contents.take(), out, stack, write_code);
            out.end_group();
            if let Some(id) = id {
                out.note_line_at_end_of_group(id);
            }
        }
        Doc::Indent(contents) => {
            out.start_indent();
            write(contents.take(), out, stack, write_code);
            out.end_indent();
        }
        Doc::Dedent(contents) => {
            out.start_dedent();
            write(contents.take(), out, stack, write_code);
            out.end_dedent();
        }
        Doc::LineSuffix(contents) => {
            out.start_line_suffix();
            write(contents.take(), out, stack, write_code);
            out.end_line_suffix();
        }
        Doc::Fill(parts) => {
            out.start_fill();
            for part in std::mem::take(parts) {
                out.start_item();
                write(part, out, stack, write_code);
                out.end_item();
            }
            out.end_fill();
        }
        Doc::Line => out.line_or_blank(),
        Doc::Softline => out.softline(),
        Doc::Hardline => out.hardline(),
        Doc::Literalline => out.text(b"\n"),
        Doc::BreakParent => out.break_parent(),
        Doc::Code(code) => write_code(code, out),
    }
}
