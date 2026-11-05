//! Writes a document of `css/doc.rs` to the document of the quick way. Both are Prettier's, part for part.
//!
//! The long way translates such a document to `ir/` (`css/embed.rs`, `markdown/embed.rs`), which has no word for some of
//! it. What is printed differently there isn't written here either: [`Unwritten::Unknown`].

use crate::css::doc::{Alignment, Doc, Line};
use bun_core::strings;
use bun_format_quick::{GroupId, Sink};
use smallvec::SmallVec;

/// Why a document isn't written.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Unwritten {
    /// It isn't certain that it's printed as the long way prints it.
    Unknown,
    NestedTooDeeply,
}

/// True if `doc` breaks the groups around it.
pub(crate) fn forces_break(doc: &Doc<'_>) -> bool {
    let mut rest = vec![doc];
    while let Some(doc) = rest.pop() {
        match doc {
            Doc::BreakParent => return true,
            Doc::Array(parts) | Doc::Fill(parts) => rest.extend(parts),
            Doc::Group {
                should_break: true, ..
            } => return true,
            Doc::Group {
                is_conditional: true,
                ..
            } => {}
            Doc::Indent(contents)
            | Doc::Align(_, contents)
            | Doc::Dedent(contents)
            | Doc::DedentToRoot(contents)
            | Doc::MarkAsRoot(contents)
            | Doc::Group { contents, .. } => rest.push(contents),
            Doc::IfBreak {
                break_contents,
                flat_contents,
                ..
            } => rest.extend([&**break_contents, &**flat_contents]),
            Doc::Text(_)
            | Doc::LineSuffix(_)
            | Doc::LineSuffixBoundary
            | Doc::Line(_)
            | Doc::KeepTrailingWhitespace => {}
        }
    }
    false
}

pub(crate) struct FromDoc<'s, 'q> {
    sink: &'s mut Sink<'q>,
    /// The ids of the document's groups, and what they're called in the other one.
    groups: SmallVec<[(u32, GroupId); 4]>,
    is_markdown: bool,
    /// How many groups and fills are around what is written.
    measured: u32,
    /// Nothing has been printed since the last line break, if that one is printed. The printer of `ir/` skips the next
    /// one then.
    is_after_line: bool,
    stack_check: bun_core::StackCheck,
}

impl<'s, 'q> FromDoc<'s, 'q> {
    /// For the document of a style sheet.
    pub(crate) fn new(sink: &'s mut Sink<'q>) -> Self {
        FromDoc {
            sink,
            groups: SmallVec::new(),
            is_markdown: false,
            measured: 0,
            is_after_line: true,
            stack_check: bun_core::StackCheck::init(),
        }
    }

    pub(crate) fn for_markdown(sink: &'s mut Sink<'q>) -> Self {
        FromDoc {
            is_markdown: true,
            ..FromDoc::new(sink)
        }
    }

    /// Writes `doc`, which has a line break in front of it and behind it.
    pub(crate) fn write_document(mut self, doc: &Doc<'_>) -> Result<(), Unwritten> {
        self.write(doc)?;
        match self.is_after_line {
            true => Err(Unwritten::Unknown),
            false => Ok(()),
        }
    }

    fn group_id(&mut self, id: u32) -> GroupId {
        if id == 0 {
            return 0;
        }
        if let Some(&(_, known)) = self.groups.iter().find(|(it, _)| *it == id) {
            return known;
        }
        let new = self.sink.new_group_id();
        self.groups.push((id, new));
        new
    }

    fn indented(&mut self, contents: &Doc<'_>) -> Result<(), Unwritten> {
        self.write(contents)?;
        self.sink.indent_close();
        Ok(())
    }

    /// `is_followed_by_break_parent`: the next part of the array is a `breakParent`.
    fn line(&mut self, line: Line, is_followed_by_break_parent: bool) -> Result<(), Unwritten> {
        let is_forced = matches!(line, Line::Hard | Line::Literal);
        // `markdown/embed.rs` counts forced line breaks in a row.
        if self.is_after_line && !(self.is_markdown && line == Line::Hard) {
            return Err(Unwritten::Unknown);
        }
        // In `ir/`, a forced line break always breaks the groups around it.
        if is_forced && !is_followed_by_break_parent {
            return Err(Unwritten::Unknown);
        }
        match line {
            Line::Space => self.sink.line(),
            Line::Soft => self.sink.softline(),
            Line::Hard => self.sink.hardline_without_break(),
            Line::Literal => self.sink.literalline_without_break(),
        }
        self.is_after_line = true;
        Ok(())
    }

    fn array(&mut self, parts: &[Doc<'_>]) -> Result<(), Unwritten> {
        let mut index = 0;
        while let Some(rest) = parts.get(index..).filter(|rest| !rest.is_empty()) {
            // The line breaks in a row of which `css/embed.rs` makes an empty line.
            let pair = match rest {
                _ if self.is_markdown => 0,
                [
                    Doc::Line(Line::Hard),
                    Doc::BreakParent,
                    Doc::Line(Line::Hard),
                    Doc::BreakParent,
                    ..,
                ] => 4,
                [
                    Doc::Line(Line::Hard),
                    Doc::BreakParent,
                    Doc::Line(Line::Space | Line::Soft),
                    ..,
                ]
                | [
                    Doc::Line(Line::Space | Line::Soft),
                    Doc::Line(Line::Hard),
                    Doc::BreakParent,
                    ..,
                ] => 3,
                [Doc::Indent(contents), Doc::Line(Line::Soft), ..]
                    if matches!(**contents, Doc::Line(Line::Soft)) =>
                {
                    2
                }
                _ => 0,
            };
            if pair > 0 && self.is_after_line {
                return Err(Unwritten::Unknown);
            }
            for at in 0..pair.max(1) {
                if pair > 0 {
                    self.is_after_line = false;
                }
                match rest.get(at) {
                    Some(Doc::Line(line)) => {
                        self.line(*line, matches!(rest.get(at + 1), Some(Doc::BreakParent)))?
                    }
                    Some(part) => self.write(part)?,
                    None => {}
                }
            }
            index += pair.max(1);
        }
        Ok(())
    }

    fn write(&mut self, doc: &Doc<'_>) -> Result<(), Unwritten> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(Unwritten::NestedTooDeeply);
        }
        match doc {
            Doc::Text(text) if text.is_empty() => {}
            // The long way measures a line break in a string differently. In Markdown it makes a `literalline` of it.
            Doc::Text(text)
                if (self.measured > 0 || self.is_markdown)
                    && strings::contains_char(text, b'\n') =>
            {
                return Err(Unwritten::Unknown);
            }
            Doc::Text(text) => {
                self.sink.text(text);
                self.is_after_line = false;
            }
            Doc::Array(parts) => self.array(parts)?,
            Doc::Indent(contents) => {
                self.sink.indent_open();
                self.indented(contents)?;
            }
            Doc::Align(Alignment::Spaces(0), contents) => self.write(contents)?,
            Doc::Align(Alignment::Spaces(width), contents) => {
                self.sink
                    .align_open(i32::try_from(*width).unwrap_or(i32::MAX));
                self.indented(contents)?;
            }
            Doc::Align(Alignment::Text(text), contents) => {
                self.sink.align_text_open(text.as_bytes());
                self.indented(contents)?;
            }
            Doc::Align(Alignment::IfBreak { .. }, _) | Doc::KeepTrailingWhitespace => {
                return Err(Unwritten::Unknown);
            }
            Doc::Dedent(contents) => {
                self.sink.dedent_open();
                self.indented(contents)?;
            }
            Doc::DedentToRoot(contents) => {
                self.sink.dedent_to_root_open();
                self.indented(contents)?;
            }
            Doc::MarkAsRoot(contents) => {
                self.sink.mark_as_root_open();
                self.indented(contents)?;
            }
            Doc::Group {
                contents,
                should_break,
                id,
                is_conditional: false,
            } => {
                let id = self.group_id(*id);
                let group = self.sink.group_open();
                self.measured += 1;
                self.write(contents)?;
                self.measured -= 1;
                self.sink.group_close(group, *should_break, id);
            }
            Doc::Group {
                contents,
                should_break,
                id: 0,
                is_conditional: true,
            } => {
                let variants = self.sink.variants_open();
                let variant = self.sink.variant_open();
                self.write(contents)?;
                self.sink.variant_close(variant);
                self.sink.variants_close(variants, *should_break);
            }
            Doc::Group { .. } => return Err(Unwritten::Unknown),
            Doc::Fill(parts) => {
                self.sink.fill_open();
                self.measured += 1;
                for (index, part) in parts.iter().enumerate() {
                    match index % 2 {
                        0 => self.sink.fill_item(),
                        _ => self.sink.fill_separator(),
                    }
                    self.write(part)?;
                }
                self.measured -= 1;
                self.sink.fill_close();
            }
            Doc::IfBreak {
                break_contents,
                flat_contents,
                group_id,
            } => {
                let id = self.group_id(*group_id);
                let is_after_line = self.is_after_line;
                let open = self.sink.if_break_open(id);
                self.write(break_contents)?;
                self.sink.if_break_else(open);
                let is_after_line = std::mem::replace(&mut self.is_after_line, is_after_line);
                self.write(flat_contents)?;
                self.sink.if_break_close(open);
                self.is_after_line |= is_after_line;
            }
            Doc::LineSuffix(contents) => {
                let is_after_line = std::mem::replace(&mut self.is_after_line, false);
                let open = self.sink.line_suffix_open();
                self.write(contents)?;
                self.sink.line_suffix_close(open);
                self.is_after_line = is_after_line;
            }
            Doc::LineSuffixBoundary => self.sink.line_suffix_boundary(),
            Doc::BreakParent => self.sink.break_parent(),
            Doc::Line(line) => self.line(*line, false)?,
        }
        Ok(())
    }
}
