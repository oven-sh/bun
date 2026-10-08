//! Prettier's documents (`src/document/builders`) and `printDocToString`.
//!
//! The printer for CSS counts on what Prettier's printer does with its documents: two line breaks in a row are an
//! empty line, `dedent` undoes the last `indent`, a `fill` measures its items the way it does. The one for YAML
//! counts on `markAsRoot`, `dedentToRoot` and literal lines. So this is a printer that follows Prettier's step by
//! step.
//!
//! What it prints is `Elements`: the parts of a document one after the other, in one list. `Doc` is a tree like
//! Prettier's, for who takes documents apart and puts them together in other ways. It is written to `Elements` to be
//! printed.

use crate::options::{FormatOptions, IndentStyle, LineEnding};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Line {
    /// `line`
    Space,
    /// `softline`
    Soft,
    /// `hardlineWithoutBreakParent`
    Hard,
    /// `literallineWithoutBreakParent`
    Literal,
}

/// What `align` indents by.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Alignment {
    /// `align(" ".repeat(n), ..)`
    Spaces(u32),
    /// `align("> ", ..)`
    Text(&'static str),
}

#[derive(Debug, Clone)]
pub(crate) enum Doc<'a> {
    Text(Cow<'a, [u8]>),
    Array(Vec<Doc<'a>>),
    Indent(Box<Doc<'a>>),
    Align(Alignment, Box<Doc<'a>>),
    /// `align(-1, ..)`
    Dedent(Box<Doc<'a>>),
    /// `align(Number.NEGATIVE_INFINITY, ..)`
    DedentToRoot(Box<Doc<'a>>),
    /// `align({ type: "root" }, ..)`
    MarkAsRoot(Box<Doc<'a>>),
    Group {
        contents: Box<Doc<'a>>,
        should_break: bool,
        /// Not 0: what an `ifBreak` can ask about it by.
        id: u32,
        /// `conditionalGroup([contents])`: a line break in it does not break it, nor what is around it.
        is_conditional: bool,
    },
    /// Alternating content and separators.
    Fill(Vec<Doc<'a>>),
    IfBreak {
        break_contents: Box<Doc<'a>>,
        flat_contents: Box<Doc<'a>>,
        /// Not 0: the group that it is about. Otherwise the one that it is in.
        group_id: u32,
    },
    LineSuffix(Box<Doc<'a>>),
    LineSuffixBoundary,
    BreakParent,
    Line(Line),
}

impl<'a> Doc<'a> {
    pub(crate) const EMPTY: Doc<'static> = Doc::Text(Cow::Borrowed(b""));
    pub(crate) const LINE: Doc<'static> = Doc::Line(Line::Space);
    pub(crate) const SOFTLINE: Doc<'static> = Doc::Line(Line::Soft);

    pub(crate) fn is_empty_text(&self) -> bool {
        matches!(self, Doc::Text(text) if text.is_empty())
    }
}

impl<'a> From<&'a str> for Doc<'a> {
    fn from(text: &'a str) -> Self {
        Doc::Text(Cow::Borrowed(text.as_bytes()))
    }
}

impl<'a> From<&'a [u8]> for Doc<'a> {
    fn from(text: &'a [u8]) -> Self {
        Doc::Text(Cow::Borrowed(text))
    }
}

impl<'a> From<Vec<u8>> for Doc<'a> {
    fn from(text: Vec<u8>) -> Self {
        Doc::Text(Cow::Owned(text))
    }
}

impl<'a> From<Cow<'a, [u8]>> for Doc<'a> {
    fn from(text: Cow<'a, [u8]>) -> Self {
        Doc::Text(text)
    }
}

impl<'a> From<Vec<Doc<'a>>> for Doc<'a> {
    fn from(parts: Vec<Doc<'a>>) -> Self {
        Doc::Array(parts)
    }
}

/// `[a, b, ..]`, of anything that is a document or can be made one. `Doc` has to be in scope.
macro_rules! docs {
    ($($part:expr),* $(,)?) => {
        Doc::Array(vec![$(Doc::from($part)),*])
    };
}
pub(crate) use docs;

pub(crate) fn hardline<'a>() -> Doc<'a> {
    Doc::Array(vec![Doc::Line(Line::Hard), Doc::BreakParent])
}

pub(crate) fn indent<'a>(contents: impl Into<Doc<'a>>) -> Doc<'a> {
    Doc::Indent(Box::new(contents.into()))
}

pub(crate) fn group<'a>(contents: impl Into<Doc<'a>>) -> Doc<'a> {
    group_with(contents, false)
}

pub(crate) fn group_with<'a>(contents: impl Into<Doc<'a>>, should_break: bool) -> Doc<'a> {
    Doc::Group {
        contents: Box::new(contents.into()),
        should_break,
        id: 0,
        is_conditional: false,
    }
}

/// `align(" ".repeat(width), contents)`
pub(crate) fn align_with_spaces<'a>(width: u32, contents: impl Into<Doc<'a>>) -> Doc<'a> {
    Doc::Align(Alignment::Spaces(width), Box::new(contents.into()))
}

pub(crate) fn fill(parts: Vec<Doc<'_>>) -> Doc<'_> {
    Doc::Fill(parts)
}

pub(crate) fn join<'a>(separator: &Doc<'a>, docs: Vec<Doc<'a>>) -> Vec<Doc<'a>> {
    let mut parts = Vec::with_capacity(docs.len() * 2);
    for (index, doc) in docs.into_iter().enumerate() {
        if index != 0 {
            parts.push(separator.clone());
        }
        parts.push(doc);
    }
    parts
}

/// Prettier's `cleanDoc`: no arrays in arrays, no empty strings, strings that follow each other are
/// one.
pub(crate) fn clean<'a>(doc: Doc<'a>) -> Doc<'a> {
    let wrap = |contents: Box<Doc<'a>>, wrapper: fn(Box<Doc<'a>>) -> Doc<'a>| match clean(*contents)
    {
        contents if contents.is_empty_text() => Doc::EMPTY,
        contents => wrapper(Box::new(contents)),
    };
    match doc {
        Doc::Fill(parts) => {
            let mut parts: Vec<Doc<'a>> = parts.into_iter().map(clean).collect();
            match parts.len() {
                _ if parts.iter().all(Doc::is_empty_text) => Doc::EMPTY,
                1 => parts.swap_remove(0),
                _ => Doc::Fill(parts),
            }
        }
        Doc::Group {
            contents,
            should_break,
            id,
            is_conditional,
        } => match clean(*contents) {
            contents if contents.is_empty_text() && !should_break && id == 0 && !is_conditional => {
                Doc::EMPTY
            }
            contents @ Doc::Group {
                should_break: inner,
                id: 0,
                is_conditional: false,
                ..
            } if inner == should_break && id == 0 && !is_conditional => contents,
            contents => Doc::Group {
                contents: Box::new(contents),
                should_break,
                id,
                is_conditional,
            },
        },
        Doc::Indent(contents) => wrap(contents, Doc::Indent),
        Doc::Align(width, contents) => match clean(*contents) {
            contents if contents.is_empty_text() => Doc::EMPTY,
            contents => Doc::Align(width, Box::new(contents)),
        },
        Doc::Dedent(contents) => wrap(contents, Doc::Dedent),
        Doc::DedentToRoot(contents) => wrap(contents, Doc::DedentToRoot),
        Doc::MarkAsRoot(contents) => wrap(contents, Doc::MarkAsRoot),
        Doc::LineSuffix(contents) => wrap(contents, Doc::LineSuffix),
        Doc::IfBreak {
            break_contents,
            flat_contents,
            group_id,
        } => match (clean(*break_contents), clean(*flat_contents)) {
            (break_contents, flat_contents)
                if break_contents.is_empty_text() && flat_contents.is_empty_text() =>
            {
                Doc::EMPTY
            }
            (break_contents, flat_contents) => Doc::IfBreak {
                break_contents: Box::new(break_contents),
                flat_contents: Box::new(flat_contents),
                group_id,
            },
        },
        Doc::Array(parts) => {
            let mut cleaned: Vec<Doc<'a>> = Vec::with_capacity(parts.len());
            let mut push = |part: Doc<'a>| match (cleaned.last_mut(), part) {
                (Some(Doc::Text(last)), Doc::Text(text)) => last.to_mut().extend_from_slice(&text),
                (_, part) => cleaned.push(part),
            };
            for part in parts {
                match clean(part) {
                    part if part.is_empty_text() => {}
                    Doc::Array(parts) => parts.into_iter().for_each(&mut push),
                    part => push(part),
                }
            }
            match cleaned.len() {
                0 => Doc::EMPTY,
                1 => cleaned.swap_remove(0),
                _ => Doc::Array(cleaned),
            }
        }
        doc @ (Doc::Text(_) | Doc::Line(_) | Doc::LineSuffixBoundary | Doc::BreakParent) => doc,
    }
}

/// Prettier's `stripTrailingHardlineFromDoc`. `doc` is clean.
pub(crate) fn strip_trailing_hardline(doc: Doc<'_>) -> Doc<'_> {
    fn strip_parts(parts: &mut Vec<Doc<'_>>) {
        while matches!(parts[..], [.., Doc::Line(_), Doc::BreakParent]) {
            parts.truncate(parts.len() - 2);
        }
        if let Some(last) = parts.pop() {
            parts.push(strip_trailing_hardline(last));
        }
    }
    match doc {
        Doc::Indent(contents) => Doc::Indent(Box::new(strip_trailing_hardline(*contents))),
        Doc::LineSuffix(contents) => Doc::LineSuffix(Box::new(strip_trailing_hardline(*contents))),
        Doc::Group {
            contents,
            should_break,
            id,
            is_conditional,
        } => Doc::Group {
            contents: Box::new(strip_trailing_hardline(*contents)),
            should_break,
            id,
            is_conditional,
        },
        Doc::IfBreak {
            break_contents,
            flat_contents,
            group_id,
        } => Doc::IfBreak {
            break_contents: Box::new(strip_trailing_hardline(*break_contents)),
            flat_contents: Box::new(strip_trailing_hardline(*flat_contents)),
            group_id,
        },
        Doc::Fill(mut parts) => {
            strip_parts(&mut parts);
            Doc::Fill(parts)
        }
        Doc::Array(mut parts) => {
            strip_parts(&mut parts);
            Doc::Array(parts)
        }
        Doc::Text(mut text) => {
            let len = text
                .iter()
                .rposition(|b| !matches!(b, b'\n' | b'\r'))
                .map_or(0, |at| at + 1);
            match &mut text {
                Cow::Borrowed(text) => *text = &text[..len],
                Cow::Owned(text) => text.truncate(len),
            }
            Doc::Text(text)
        }
        doc @ (Doc::Align(..)
        | Doc::Dedent(_)
        | Doc::DedentToRoot(_)
        | Doc::MarkAsRoot(_)
        | Doc::Line(_)
        | Doc::LineSuffixBoundary
        | Doc::BreakParent) => doc,
    }
}

/// Prettier's `replaceEndOfLine(text, literallineWithoutBreakParent)`.
pub(crate) fn replace_end_of_line_with_literal_lines(text: Cow<'_, [u8]>) -> Doc<'_> {
    if !bun_core::strings::contains_char(&text, b'\n') {
        return Doc::Text(text);
    }
    let lines = bun_core::strings::split(&text, b"\n")
        .map(|line| Doc::from(line.to_vec()))
        .collect();
    Doc::Array(join(&Doc::Line(Line::Literal), lines))
}

// ───────────────────────────── a document in one piece ─────────────────────────────

/// What `indent`, `align` and the like do to the indentation.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum IndentCommand {
    Indent,
    Align(Alignment),
    Dedent,
    DedentToRoot,
    MarkAsRoot,
}

/// A part of a document. What has contents starts with one and ends with another, and knows where that is.
#[derive(Copy, Clone)]
enum Element {
    /// A range of `Elements::texts`, and its width.
    Text {
        start: u32,
        len: u32,
        width: u32,
    },
    Line(Line),
    /// `hardline`
    HardLine,
    /// It has done what it does when it was written.
    BreakParent,
    LineSuffixBoundary,
    /// What has been taken out.
    Nothing,
    StartGroup {
        end: u32,
        /// Not 0: what an `ifBreak` can ask about it by.
        id: u32,
        should_break: bool,
        /// `conditionalGroup([contents])`: a line break in it does not break it, nor what is around it.
        is_conditional: bool,
        /// There is nothing in it that is printed one way in a broken group and another way in one that is not.
        is_plain: bool,
    },
    /// An index into `Elements::indents`.
    StartIndent(u32),
    /// Of a group or an indentation.
    End,
    StartFill,
    EndFill,
    /// What is in a `fill`: contents and separators, which take turns.
    StartItem {
        end: u32,
    },
    EndItem,
    /// The contents for a broken group follow, then `Else`, then the others.
    StartIfBreak {
        otherwise: u32,
        end: u32,
        /// Not 0: the group that it is about. Otherwise the one that it is in.
        group_id: u32,
    },
    Else {
        end: u32,
    },
    StartLineSuffix {
        end: u32,
    },
}

/// A document: its parts, one after the other. It is written from the first to the last.
pub(crate) struct Elements {
    /// The first is a `hardlineWithoutBreakParent`, for the printer.
    list: Vec<Element>,
    texts: Vec<u8>,
    indents: Vec<IndentCommand>,
    /// Where what has been started and not ended starts.
    open: Vec<u32>,
    /// The same, of the groups only.
    open_groups: Vec<u32>,
    /// How many of `open_groups`, from the first on, are known not to be plain.
    groups_with_lines: usize,
}

impl Default for Elements {
    fn default() -> Self {
        Elements {
            list: vec![Element::Line(Line::Hard)],
            texts: Vec::new(),
            indents: Vec::new(),
            open: Vec::new(),
            open_groups: Vec::new(),
            groups_with_lines: 0,
        }
    }
}

impl Elements {
    pub(crate) fn clear(&mut self) {
        self.list.truncate(1);
        self.texts.clear();
        self.indents.clear();
        self.open.clear();
        self.open_groups.clear();
        self.groups_with_lines = 0;
    }

    /// What is written next depends on whether the group that it is in is broken.
    fn mark_groups(&mut self) {
        for index in self.groups_with_lines..self.open_groups.len() {
            if let Element::StartGroup { is_plain, .. } =
                &mut self.list[self.open_groups[index] as usize]
            {
                *is_plain = false;
            }
        }
        self.groups_with_lines = self.open_groups.len();
    }

    pub(crate) fn text(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        let start = self.texts.len() as u32;
        self.texts.extend_from_slice(text);
        self.list.push(Element::Text {
            start,
            len: text.len() as u32,
            width: string_width(text) as u32,
        });
    }

    pub(crate) fn line(&mut self, line: Line) {
        self.mark_groups();
        self.list.push(Element::Line(line));
    }

    /// `hardline`
    pub(crate) fn hard_line(&mut self) {
        self.mark_groups();
        self.list.push(Element::HardLine);
        self.break_groups();
    }

    pub(crate) fn break_parent(&mut self) {
        self.list.push(Element::BreakParent);
        self.break_groups();
    }

    /// What Prettier's `propagateBreaks` makes of a `breakParent`.
    fn break_groups(&mut self) {
        for &group in self.open_groups.iter().rev() {
            match &mut self.list[group as usize] {
                // So are the groups around it.
                Element::StartGroup {
                    should_break: true, ..
                } => break,
                Element::StartGroup {
                    is_conditional: true,
                    ..
                } => break,
                Element::StartGroup { should_break, .. } => *should_break = true,
                _ => {}
            }
        }
    }

    pub(crate) fn line_suffix_boundary(&mut self) {
        self.mark_groups();
        self.list.push(Element::LineSuffixBoundary);
    }

    fn start(&mut self, element: Element) {
        self.open.push(self.list.len() as u32);
        self.list.push(element);
    }

    /// Ends what has been started last with `last`, if that is something.
    fn end(&mut self, last: Element) {
        let Some(start) = self.open.pop() else {
            return;
        };
        let at = self.list.len() as u32;
        match &mut self.list[start as usize] {
            Element::StartGroup { end, .. }
            | Element::StartItem { end }
            | Element::StartIfBreak { end, .. }
            | Element::Else { end }
            | Element::StartLineSuffix { end } => *end = at,
            _ => {}
        }
        self.list.push(last);
    }

    pub(crate) fn start_group(&mut self, should_break: bool, id: u32, is_conditional: bool) {
        if should_break {
            self.break_groups();
        }
        // Whether it is broken depends on the groups around it, and something else on that.
        if id != 0 {
            self.mark_groups();
        }
        self.open_groups.push(self.list.len() as u32);
        self.start(Element::StartGroup {
            end: 0,
            id,
            should_break,
            is_conditional,
            is_plain: id == 0,
        });
    }

    pub(crate) fn end_group(&mut self) {
        self.open_groups.pop();
        self.groups_with_lines = self.groups_with_lines.min(self.open_groups.len());
        self.end(Element::End);
    }

    pub(crate) fn start_indent(&mut self, command: IndentCommand) {
        let index = self
            .indents
            .iter()
            .position(|it| *it == command)
            .unwrap_or_else(|| {
                self.indents.push(command);
                self.indents.len() - 1
            });
        self.start(Element::StartIndent(index as u32));
    }

    pub(crate) fn end_indent(&mut self) {
        self.end(Element::End);
    }

    pub(crate) fn start_fill(&mut self) {
        self.start(Element::StartFill);
    }

    pub(crate) fn end_fill(&mut self) {
        self.end(Element::EndFill);
    }

    pub(crate) fn start_item(&mut self) {
        self.start(Element::StartItem { end: 0 });
    }

    pub(crate) fn end_item(&mut self) {
        self.end(Element::EndItem);
    }

    /// Starts an `ifBreak`, with the contents for a broken group.
    pub(crate) fn start_if_break(&mut self, group_id: u32) {
        self.mark_groups();
        self.start(Element::StartIfBreak {
            otherwise: 0,
            end: 0,
            group_id,
        });
    }

    /// Starts the contents for a group on one line.
    pub(crate) fn otherwise(&mut self) {
        let at = self.list.len() as u32;
        if let Some(&start) = self.open.last()
            && let Element::StartIfBreak { otherwise, .. } = &mut self.list[start as usize]
        {
            *otherwise = at;
        }
        self.start(Element::Else { end: 0 });
    }

    pub(crate) fn end_if_break(&mut self) {
        // The `Else` and the start end at the same place.
        self.end(Element::Nothing);
        self.list.pop();
        self.end(Element::Nothing);
    }

    pub(crate) fn start_line_suffix(&mut self) {
        self.mark_groups();
        self.start(Element::StartLineSuffix { end: 0 });
    }

    pub(crate) fn end_line_suffix(&mut self) {
        self.end(Element::Nothing);
    }

    /// Where the next element goes, for `remove_lines_from`.
    pub(crate) fn len(&self) -> usize {
        self.list.len()
    }

    /// Prettier's `removeLines` for everything from `start` on.
    pub(crate) fn remove_lines_from(&mut self, start: usize) {
        let mut at = start;
        while let Some(element) = self.list.get_mut(at) {
            match *element {
                Element::Line(Line::Space) => {
                    let start = self.texts.len() as u32;
                    self.texts.push(b' ');
                    *element = Element::Text {
                        start,
                        len: 1,
                        width: 1,
                    };
                }
                Element::Line(Line::Soft) => *element = Element::Nothing,
                // Only the contents for a group on one line stay.
                Element::StartIfBreak { otherwise, .. } => {
                    self.list[at..=(otherwise as usize).max(at)].fill(Element::Nothing);
                    at = otherwise as usize;
                }
                _ => {}
            }
            at += 1;
        }
    }

    /// Puts `inserted` before the element `at`.
    fn insert(&mut self, at: usize, inserted: &[Element]) {
        let count = inserted.len() as u32;
        let shift = |position: &mut u32| {
            if *position as usize >= at {
                *position += count;
            }
        };
        for element in &mut self.list {
            match element {
                Element::StartGroup { end, .. }
                | Element::StartItem { end }
                | Element::Else { end }
                | Element::StartLineSuffix { end } => {
                    shift(end);
                }
                Element::StartIfBreak { otherwise, end, .. } => {
                    shift(otherwise);
                    shift(end);
                }
                _ => {}
            }
        }
        self.open.iter_mut().for_each(shift);
        self.open_groups.iter_mut().for_each(shift);
        self.list.splice(at..at, inserted.iter().copied());
    }

    /// In an item of a `fill`: makes a `fill` of its own of what the `fill` has so far, which starts the only item
    /// that there is then.
    pub(crate) fn nest_fill(&mut self) {
        self.end_item();
        let Some(&start) = self.open.last() else {
            return;
        };
        self.end_fill();
        self.insert(
            start as usize,
            &[Element::StartFill, Element::StartItem { end: 0 }],
        );
        self.open.extend([start, start + 1]);
    }

    /// In an item of a `fill`: puts an empty item and a `hardline` before the items of the `fill`.
    pub(crate) fn start_fill_with_hard_line(&mut self) {
        let [.., fill, _] = self.open[..] else {
            return;
        };
        let at = fill + 1;
        self.insert(
            at as usize,
            &[
                Element::StartItem { end: at + 1 },
                Element::EndItem,
                Element::StartItem { end: at + 4 },
                Element::HardLine,
                Element::EndItem,
            ],
        );
        self.mark_groups();
        self.break_groups();
    }

    /// Ends a `fill` that is to be an array of its items after all.
    pub(crate) fn end_fill_as_array(&mut self) {
        let Some(start) = self.open.pop() else {
            return;
        };
        let mut at = start as usize;
        self.list[at] = Element::Nothing;
        at += 1;
        while let Some(&Element::StartItem { end }) = self.list.get(at) {
            self.list[at] = Element::Nothing;
            self.list[end as usize] = Element::Nothing;
            at = end as usize + 1;
        }
    }

    /// Writes `doc`.
    pub(crate) fn document(&mut self, doc: &Doc<'_>) {
        let indented = |elements: &mut Self, command: IndentCommand, contents: &Doc<'_>| {
            elements.start_indent(command);
            elements.document(contents);
            elements.end_indent();
        };
        match doc {
            Doc::Text(text) => self.text(text),
            Doc::Array(parts) => parts.iter().for_each(|part| self.document(part)),
            Doc::Indent(contents) => indented(self, IndentCommand::Indent, contents),
            Doc::Align(Alignment::Spaces(0), contents) => self.document(contents),
            Doc::Align(alignment, contents) => {
                indented(self, IndentCommand::Align(*alignment), contents)
            }
            Doc::Dedent(contents) => indented(self, IndentCommand::Dedent, contents),
            Doc::DedentToRoot(contents) => indented(self, IndentCommand::DedentToRoot, contents),
            Doc::MarkAsRoot(contents) => indented(self, IndentCommand::MarkAsRoot, contents),
            Doc::Group {
                contents,
                should_break,
                id,
                is_conditional,
            } => {
                self.start_group(*should_break, *id, *is_conditional);
                self.document(contents);
                self.end_group();
            }
            Doc::Fill(parts) => {
                self.start_fill();
                for part in parts {
                    self.start_item();
                    self.document(part);
                    self.end_item();
                }
                self.end_fill();
            }
            Doc::IfBreak {
                break_contents,
                flat_contents,
                group_id,
            } => {
                self.start_if_break(*group_id);
                self.document(break_contents);
                self.otherwise();
                self.document(flat_contents);
                self.end_if_break();
            }
            Doc::LineSuffix(contents) => {
                self.start_line_suffix();
                self.document(contents);
                self.end_line_suffix();
            }
            Doc::LineSuffixBoundary => self.line_suffix_boundary(),
            Doc::BreakParent => self.break_parent(),
            Doc::Line(line) => self.line(*line),
        }
    }

    /// Writes `self.list[start..end]`, which is complete, once more.
    pub(crate) fn duplicate(&mut self, start: usize, end: usize) {
        self.mark_groups();
        let shift = (self.list.len() - start) as u32;
        for index in start..end {
            let mut element = self.list[index];
            match &mut element {
                Element::StartGroup { end, .. }
                | Element::StartItem { end }
                | Element::Else { end }
                | Element::StartLineSuffix { end } => {
                    *end += shift;
                }
                Element::StartIfBreak { otherwise, end, .. } => {
                    *otherwise += shift;
                    *end += shift;
                }
                _ => {}
            }
            self.list.push(element);
        }
    }

    /// The document as a tree.
    pub(crate) fn to_tree(&self) -> Doc<'static> {
        let mut at = 1;
        Doc::Array(self.tree_up_to(&mut at, self.list.len()))
    }

    fn tree_up_to(&self, at: &mut usize, end: usize) -> Vec<Doc<'static>> {
        let mut parts = Vec::new();
        while *at < end {
            let element = self.list[*at];
            *at += 1;
            // What is in it, and its end.
            let contents = |at: &mut usize, end: u32| {
                let contents = Doc::Array(self.tree_up_to(at, end as usize));
                *at = end as usize + 1;
                Box::new(contents)
            };
            parts.push(match element {
                Element::Text { start, len, .. } => {
                    Doc::from(self.texts[start as usize..(start + len) as usize].to_vec())
                }
                Element::HardLine => hardline(),
                Element::BreakParent => Doc::BreakParent,
                Element::Line(line) => Doc::Line(line),
                Element::LineSuffixBoundary => Doc::LineSuffixBoundary,
                Element::StartGroup {
                    end,
                    id,
                    should_break,
                    is_conditional,
                    ..
                } => Doc::Group {
                    contents: contents(at, end),
                    should_break,
                    id,
                    is_conditional,
                },
                Element::StartIndent(command) => {
                    let end = self.end_of_indent(*at);
                    let contents = contents(at, end as u32);
                    match self.indents[command as usize] {
                        IndentCommand::Indent => Doc::Indent(contents),
                        IndentCommand::Align(alignment) => Doc::Align(alignment, contents),
                        IndentCommand::Dedent => Doc::Dedent(contents),
                        IndentCommand::DedentToRoot => Doc::DedentToRoot(contents),
                        IndentCommand::MarkAsRoot => Doc::MarkAsRoot(contents),
                    }
                }
                Element::StartFill => {
                    let mut items = Vec::new();
                    while let Some(&Element::StartItem { end }) = self.list.get(*at) {
                        *at += 1;
                        items.push(*contents(at, end));
                    }
                    *at += 1;
                    Doc::Fill(items)
                }
                Element::StartIfBreak {
                    otherwise,
                    end,
                    group_id,
                } => {
                    let break_contents = contents(at, otherwise);
                    Doc::IfBreak {
                        break_contents,
                        flat_contents: contents(at, end),
                        group_id,
                    }
                }
                Element::StartLineSuffix { end } => Doc::LineSuffix(contents(at, end)),
                Element::Nothing
                | Element::End
                | Element::EndFill
                | Element::StartItem { .. }
                | Element::EndItem
                | Element::Else { .. } => {
                    continue;
                }
            });
        }
        parts
    }

    /// Where the indentation ends whose contents start at `from`.
    fn end_of_indent(&self, from: usize) -> usize {
        let mut depth = 0usize;
        let mut at = from;
        while let Some(element) = self.list.get(at) {
            match element {
                Element::StartGroup { end, .. } => at = *end as usize,
                Element::StartIndent(_) => depth += 1,
                Element::End if depth == 0 => break,
                Element::End => depth -= 1,
                _ => {}
            }
            at += 1;
        }
        at
    }
}

// ───────────────────────────── the printer ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Break,
    Flat,
}

/// Prettier's `Indent`.
struct Indent {
    /// Only `Indent` and `Align`.
    queue: Vec<IndentCommand>,
    value: Vec<u8>,
    length: usize,
    root: u32,
    /// What has been made of it.
    derived: Vec<(IndentCommand, u32)>,
}

/// What is set back at the end of something that is being printed.
#[derive(Copy, Clone)]
struct Frame {
    mode: Mode,
    indent: u32,
    /// Of a `fill`: how the separator is printed that follows the contents that are being printed, and whether the
    /// next item is a separator.
    separator_mode: Mode,
    is_at_separator: bool,
}

/// Elements that are printed later.
#[derive(Copy, Clone)]
struct Task {
    start: u32,
    end: u32,
    mode: Mode,
    indent: u32,
}

pub(crate) struct Printer<'o> {
    pub(crate) width: usize,
    use_tabs: bool,
    tab_width: usize,
    new_line: &'static [u8],
    /// What a line break in a text and a literal line are written as. See `FormatOptions::is_in_markdown`.
    literal_new_line: &'static [u8],
    pub(crate) out: &'o mut Vec<u8>,
    /// Where `out` started.
    start: usize,
    /// The first is `ROOT_INDENT`.
    indents: Vec<Indent>,
    /// The modes of the groups that have an id and have been printed.
    group_modes: Vec<(u32, Mode)>,
    frames: Vec<Frame>,
    tasks: Vec<Task>,
    line_suffixes: Vec<Task>,
    /// For `fits`: the modes around what it is looking at.
    outer_modes: Vec<Mode>,
}

fn string_width(text: &[u8]) -> usize {
    crate::ir::width::string_width(text) as usize
}

fn group_mode(group_modes: &[(u32, Mode)], id: u32) -> Option<Mode> {
    group_modes
        .iter()
        .rev()
        .find(|(group, _)| *group == id)
        .map(|(_, mode)| *mode)
}

impl<'o> Printer<'o> {
    /// `text`: what is formatted, for `endOfLine: "auto"`.
    pub(crate) fn new(options: &FormatOptions, text: &[u8], out: &'o mut Vec<u8>) -> Self {
        let start = out.len();
        Printer {
            width: options.line_width.value() as usize,
            use_tabs: matches!(options.indent_style, IndentStyle::Tab),
            tab_width: options.indent_width.value() as usize,
            new_line: match options.line_ending.resolve(text) {
                LineEnding::Crlf => b"\r\n",
                LineEnding::Cr => b"\r",
                _ => b"\n",
            },
            literal_new_line: match options.line_ending.resolve(text) {
                _ if options.is_in_markdown => b"\r\n",
                LineEnding::Crlf => b"\r\n",
                LineEnding::Cr => b"\r",
                _ => b"\n",
            },
            out,
            start,
            indents: vec![Indent {
                queue: Vec::new(),
                value: Vec::new(),
                length: 0,
                root: 0,
                derived: Vec::new(),
            }],
            group_modes: Vec::new(),
            frames: Vec::new(),
            tasks: Vec::new(),
            line_suffixes: Vec::new(),
            outer_modes: Vec::new(),
        }
    }

    /// What `indent` makes of the indentation `indent`. That of the root is 0.
    pub(crate) fn indented(&mut self, indent: u32) -> u32 {
        self.make_indent(indent, IndentCommand::Indent)
    }

    /// What `dedent` makes of the indentation `indent`.
    pub(crate) fn dedented(&mut self, indent: u32) -> u32 {
        self.make_indent(indent, IndentCommand::Dedent)
    }

    /// What a `hardline` does. Returns the column behind the indentation.
    pub(crate) fn write_hard_line(&mut self, indent: u32) -> usize {
        self.trim();
        self.out.extend_from_slice(self.new_line);
        self.write_indent(indent)
    }

    fn trim(&mut self) {
        while self.out.len() > self.start && matches!(self.out.last(), Some(b' ' | b'\t')) {
            self.out.pop();
        }
    }

    /// Prettier's `makeIndent` and `makeAlign`.
    fn make_indent(&mut self, indent: u32, command: IndentCommand) -> u32 {
        let parent = &self.indents[indent as usize];
        if command == IndentCommand::DedentToRoot {
            return parent.root;
        }
        if let Some((_, derived)) = parent.derived.iter().find(|(it, _)| *it == command) {
            return *derived;
        }
        let mut queue = parent.queue.clone();
        let mut root = parent.root;
        match command {
            IndentCommand::Dedent => {
                queue.pop();
            }
            IndentCommand::MarkAsRoot => root = indent,
            command => queue.push(command),
        }
        let (mut value, mut length) = (Vec::new(), 0);
        for command in &queue {
            match command {
                IndentCommand::Indent if self.use_tabs => {
                    value.push(b'\t');
                    length += self.tab_width;
                }
                IndentCommand::Indent => {
                    value.resize(value.len() + self.tab_width, b' ');
                    length += self.tab_width;
                }
                IndentCommand::Align(Alignment::Spaces(width)) => {
                    value.resize(value.len() + *width as usize, b' ');
                    length += *width as usize;
                }
                IndentCommand::Align(Alignment::Text(text)) => {
                    value.extend_from_slice(text.as_bytes());
                    length += text.len();
                }
                IndentCommand::Dedent | IndentCommand::DedentToRoot | IndentCommand::MarkAsRoot => {
                }
            }
        }
        let id = self.indents.len() as u32;
        self.indents.push(Indent {
            queue,
            value,
            length,
            root,
            derived: Vec::new(),
        });
        self.indents[indent as usize].derived.push((command, id));
        id
    }

    /// Writes the indentation. Returns its width.
    fn write_indent(&mut self, indent: u32) -> usize {
        let indent = &self.indents[indent as usize];
        self.out.extend_from_slice(&indent.value);
        indent.length
    }

    #[inline]
    pub(crate) fn write_text(&mut self, text: &[u8]) {
        if matches!(self.literal_new_line, [b'\n'])
            || !bun_core::strings::contains_char(text, b'\n')
        {
            return self.out.extend_from_slice(text);
        }
        for (index, line) in bun_core::strings::split(text, b"\n").enumerate() {
            if index > 0 {
                self.out.extend_from_slice(self.literal_new_line);
            }
            self.out.extend_from_slice(line);
        }
    }

    /// Prettier's `fits`, for `elements[start..end]` on one line. `rest`: what follows it, in the mode that it is
    /// printed in, up to its end. Behind that come `self.tasks`. `None`: nothing counts but the elements.
    fn fits(
        &mut self,
        elements: &Elements,
        (start, end): (usize, usize),
        rest: Option<(usize, usize, Mode)>,
        mut remaining_width: isize,
        must_be_flat: bool,
    ) -> bool {
        let list = &elements.list[..];
        let mut has_line_suffix = !self.line_suffixes.is_empty();
        let mut has_pending_space = false;
        let (mut at, mut end, mut mode) = (start, end, Mode::Flat);
        // What is left of what follows: the frames that end there, and the tasks.
        let mut rest = rest;
        let (mut frames_left, mut tasks_left) = (
            self.frames.len(),
            if rest.is_some() { self.tasks.len() } else { 0 },
        );
        // How the next item of the `fill` that is being printed is printed, if that has been decided.
        let mut separator_mode = None;
        let outer_modes = &mut self.outer_modes;
        outer_modes.clear();
        while remaining_width >= 0 {
            if at >= end {
                if let Some(next) = rest.take() {
                    (at, end, mode) = next;
                } else if tasks_left > 0 {
                    tasks_left -= 1;
                    let task = self.tasks[tasks_left];
                    (at, end, mode) = (task.start as usize, task.end as usize, task.mode);
                } else {
                    return true;
                }
                continue;
            }
            let element = list[at];
            at += 1;
            match element {
                Element::Text { width, .. } => {
                    if has_pending_space {
                        remaining_width -= 1;
                        has_pending_space = false;
                    }
                    remaining_width -= width as isize;
                }
                Element::HardLine => return true,
                Element::Line(line) => {
                    if mode == Mode::Break || matches!(line, Line::Hard | Line::Literal) {
                        return true;
                    }
                    if line == Line::Space {
                        has_pending_space = true;
                    }
                }
                Element::StartGroup { should_break, .. } => {
                    if must_be_flat && should_break {
                        return false;
                    }
                    outer_modes.push(mode);
                    if should_break {
                        mode = Mode::Break;
                    }
                }
                Element::StartIndent(_) | Element::StartFill => outer_modes.push(mode),
                Element::StartItem { .. } => {
                    outer_modes.push(mode);
                    mode = separator_mode.take().unwrap_or(mode);
                }
                Element::End | Element::EndFill | Element::EndItem => match outer_modes.pop() {
                    Some(outer) => mode = outer,
                    // It is the end of something that is being printed.
                    None => {
                        frames_left = frames_left.saturating_sub(1);
                        let Some(frame) = self.frames.get(frames_left) else {
                            continue;
                        };
                        mode = frame.mode;
                        if matches!(element, Element::EndItem)
                            && let Some(fill) = frames_left
                                .checked_sub(1)
                                .and_then(|at| self.frames.get(at))
                            && !fill.is_at_separator
                        {
                            separator_mode = Some(fill.separator_mode);
                        }
                    }
                },
                Element::StartIfBreak {
                    otherwise,
                    group_id,
                    ..
                } => {
                    let group_mode = match group_id {
                        0 => mode,
                        id => group_mode(&self.group_modes, id).unwrap_or(Mode::Flat),
                    };
                    if group_mode == Mode::Flat {
                        at = otherwise as usize + 1;
                    }
                }
                Element::Else { end } => at = end as usize,
                Element::StartLineSuffix { end } => {
                    has_line_suffix = true;
                    at = end as usize;
                }
                Element::LineSuffixBoundary => {
                    if has_line_suffix {
                        return false;
                    }
                }
                Element::BreakParent | Element::Nothing => {}
            }
        }
        false
    }

    /// Prints `elements`, which are a part of a document that no group is around and that a line break follows: with
    /// the indentation `indent`, from the column `position` on. Returns the column behind it.
    ///
    /// This is Prettier's `printDocToString`. Its stack of commands is `frames` here, for what the elements that
    /// follow are in, and `tasks`, for what is not printed where it is.
    pub(crate) fn print(&mut self, elements: &Elements, indent: u32, mut position: usize) -> usize {
        let list = &elements.list[..];
        let (mut at, mut end, mut mode, mut indent) = (1, list.len(), Mode::Break, indent);
        let mut should_remeasure = false;
        self.frames.clear();
        self.tasks.clear();
        self.line_suffixes.clear();
        loop {
            if at >= end {
                if self.tasks.is_empty() {
                    self.tasks.extend(self.line_suffixes.drain(..).rev());
                }
                let Some(task) = self.tasks.pop() else {
                    break;
                };
                (at, end, mode, indent) = (
                    task.start as usize,
                    task.end as usize,
                    task.mode,
                    task.indent,
                );
                continue;
            }
            let frame = Frame {
                mode,
                indent,
                separator_mode: Mode::Break,
                is_at_separator: false,
            };
            let element = list[at];
            at += 1;
            match element {
                Element::Text { start, len, width } => {
                    self.write_text(&elements.texts[start as usize..(start + len) as usize]);
                    position += width as usize;
                }
                Element::StartIndent(command) => {
                    self.frames.push(frame);
                    indent = self.make_indent(indent, elements.indents[command as usize]);
                }
                Element::StartGroup {
                    end: group_end,
                    id,
                    should_break,
                    is_plain,
                    ..
                } => {
                    let group_mode = if mode == Mode::Flat && !should_remeasure {
                        if should_break {
                            Mode::Break
                        } else {
                            Mode::Flat
                        }
                    } else if is_plain {
                        should_remeasure = false;
                        Mode::Flat
                    } else {
                        should_remeasure = false;
                        let remaining_width = self.width as isize - position as isize;
                        let rest = (group_end as usize + 1, end, mode);
                        match !should_break
                            && self.fits(
                                elements,
                                (at, group_end as usize),
                                Some(rest),
                                remaining_width,
                                false,
                            ) {
                            true => Mode::Flat,
                            false => Mode::Break,
                        }
                    };
                    self.frames.push(frame);
                    mode = group_mode;
                    if id != 0 {
                        self.group_modes.push((id, group_mode));
                    }
                }
                Element::StartFill => self.frames.push(frame),
                Element::End | Element::EndFill => {
                    if let Some(frame) = self.frames.pop() {
                        (mode, indent) = (frame.mode, frame.indent);
                    }
                }
                Element::StartItem { end: item_end } => {
                    let is_separator = self.frames.last().is_some_and(|fill| fill.is_at_separator);
                    let item_mode = match is_separator {
                        true => self.frames.last().map_or(mode, |fill| fill.separator_mode),
                        false => {
                            let (contents_mode, separator_mode) =
                                self.measure_fill(elements, at, item_end as usize, position);
                            if let Some(fill) = self.frames.last_mut() {
                                fill.separator_mode = separator_mode;
                            }
                            contents_mode
                        }
                    };
                    self.frames.push(frame);
                    mode = item_mode;
                }
                Element::EndItem => {
                    if let Some(frame) = self.frames.pop() {
                        (mode, indent) = (frame.mode, frame.indent);
                    }
                    if let Some(fill) = self.frames.last_mut() {
                        fill.is_at_separator = !fill.is_at_separator;
                    }
                }
                Element::StartIfBreak {
                    otherwise,
                    end: if_break_end,
                    group_id,
                } => match if group_id == 0 {
                    Some(mode)
                } else {
                    group_mode(&self.group_modes, group_id)
                } {
                    Some(Mode::Break) => {}
                    Some(Mode::Flat) => at = otherwise as usize + 1,
                    None => at = if_break_end as usize,
                },
                Element::Else { end } => at = end as usize,
                Element::StartLineSuffix { end: suffix_end } => {
                    self.line_suffixes.push(Task {
                        start: at as u32,
                        end: suffix_end,
                        mode,
                        indent,
                    });
                    at = suffix_end as usize;
                }
                Element::LineSuffixBoundary => {
                    if !self.line_suffixes.is_empty() {
                        // A `hardlineWithoutBreakParent`, then what follows.
                        self.tasks.push(Task {
                            start: at as u32,
                            end: end as u32,
                            mode,
                            indent,
                        });
                        (at, end) = (0, 1);
                    }
                }
                Element::Line(_) | Element::HardLine => {
                    let line = match element {
                        Element::Line(line) => line,
                        _ => Line::Hard,
                    };
                    let is_hard = matches!(line, Line::Hard | Line::Literal);
                    if mode == Mode::Flat && !is_hard {
                        if line == Line::Space {
                            self.out.push(b' ');
                            position += 1;
                        }
                        continue;
                    }
                    if mode == Mode::Flat {
                        // The groups that follow have been measured without it.
                        should_remeasure = true;
                    }
                    if !self.line_suffixes.is_empty() {
                        // They come first, then the line once more.
                        self.tasks.push(Task {
                            start: at as u32 - 1,
                            end: end as u32,
                            mode,
                            indent,
                        });
                        self.tasks.extend(self.line_suffixes.drain(..).rev());
                        at = end;
                    } else if line == Line::Literal {
                        self.out.extend_from_slice(self.literal_new_line);
                        position = self.write_indent(self.indents[indent as usize].root);
                    } else {
                        self.trim();
                        self.out.extend_from_slice(self.new_line);
                        position = self.write_indent(indent);
                    }
                }
                Element::BreakParent | Element::Nothing => {}
            }
        }
        position
    }

    /// What Prettier does with a `fill`: how the contents that are in `elements[start..end]` are printed, and the
    /// separator behind them.
    fn measure_fill(
        &mut self,
        elements: &Elements,
        start: usize,
        end: usize,
        position: usize,
    ) -> (Mode, Mode) {
        let remaining_width = self.width as isize - position as isize;
        let mode_of = |fits: bool| if fits { Mode::Flat } else { Mode::Break };
        let contents_fit = self.fits(elements, (start, end), None, remaining_width, true);
        let Some(&Element::StartItem { end: separator_end }) = elements.list.get(end + 1) else {
            return (mode_of(contents_fit), Mode::Break);
        };
        let Some(&Element::StartItem { end: second_end }) =
            elements.list.get(separator_end as usize + 1)
        else {
            return (mode_of(contents_fit), mode_of(contents_fit));
        };
        let first_and_second_fit = self.fits(
            elements,
            (start - 1, second_end as usize + 1),
            None,
            remaining_width,
            true,
        );
        (
            mode_of(first_and_second_fit || contents_fit),
            mode_of(first_and_second_fit),
        )
    }
}

/// Appends what `doc` prints to `out`. `text`: what is formatted, for `endOfLine: "auto"`.
pub(crate) fn print(doc: Doc<'_>, options: &FormatOptions, text: &[u8], out: &mut Vec<u8>) {
    let mut elements = Elements::default();
    elements.document(&doc);
    drop(doc);
    Printer::new(options, text, out).print(&elements, 0, 0);
}
