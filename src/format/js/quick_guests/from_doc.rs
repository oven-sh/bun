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
    /// It has something that the other document has no word for.
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
    /// How many groups and fills are around what is written. There the long way measures a line break in a string
    /// differently. For Markdown it's 1 from the start: the long way makes a `literalline` of every one.
    measured: u32,
    /// The template has substitutions.
    has_holes: bool,
    stack_check: bun_core::StackCheck,
}

impl<'s, 'q> FromDoc<'s, 'q> {
    pub(crate) fn new(sink: &'s mut Sink<'q>) -> Self {
        FromDoc {
            has_holes: sink.hole_count() > 0,
            sink,
            groups: SmallVec::new(),
            measured: 0,
            stack_check: bun_core::StackCheck::init(),
        }
    }

    /// The same for a document of Markdown.
    pub(crate) fn for_markdown(sink: &'s mut Sink<'q>) -> Self {
        FromDoc {
            measured: 1,
            ..FromDoc::new(sink)
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
        let result = self.write(contents);
        self.sink.indent_close();
        result
    }

    pub(crate) fn write(&mut self, doc: &Doc<'_>) -> Result<(), Unwritten> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(Unwritten::NestedTooDeeply);
        }
        match doc {
            Doc::Text(text) if self.measured > 0 && strings::contains_char(text, b'\n') => {
                return Err(Unwritten::Unknown);
            }
            Doc::Text(text) => self.sink.text(text),
            Doc::Array(parts) => {
                let mut parts = parts.iter().peekable();
                while let Some(part) = parts.next() {
                    // In `ir/`, a forced line break always breaks the groups around it.
                    if matches!(part, Doc::Line(Line::Hard | Line::Literal))
                        && !matches!(parts.peek(), Some(Doc::BreakParent))
                    {
                        return Err(Unwritten::Unknown);
                    }
                    // After a forced line break in what is printed on one line, a substitution is measured again, which
                    // breaks one that Prettier has printed to a string.
                    if matches!(part, Doc::Line(Line::Hard | Line::Literal))
                        && self.measured > 0
                        && self.has_holes
                    {
                        return Err(Unwritten::Unknown);
                    }
                    match part {
                        Doc::Line(Line::Hard) => self.sink.hardline_without_break(),
                        Doc::Line(Line::Literal) => self.sink.literalline_without_break(),
                        _ => self.write(part)?,
                    }
                }
            }
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
                let result = self.write(contents);
                self.measured -= 1;
                self.sink.group_close(group, *should_break, id);
                result?;
            }
            Doc::Group {
                contents,
                should_break,
                id: 0,
                is_conditional: true,
            } => {
                let variants = self.sink.variants_open();
                let variant = self.sink.variant_open();
                let result = self.write(contents);
                self.sink.variant_close(variant);
                self.sink.variants_close(variants, *should_break);
                result?;
            }
            Doc::Group { .. } => return Err(Unwritten::Unknown),
            Doc::Fill(parts) => {
                self.sink.fill_open();
                self.measured += 1;
                let mut result = Ok(());
                for (index, part) in parts.iter().enumerate() {
                    match index % 2 {
                        0 => self.sink.fill_item(),
                        _ => self.sink.fill_separator(),
                    }
                    result = self.write(part);
                    if result.is_err() {
                        break;
                    }
                }
                self.measured -= 1;
                self.sink.fill_close();
                result?;
            }
            Doc::IfBreak {
                break_contents,
                flat_contents,
                group_id,
            } => {
                let id = self.group_id(*group_id);
                let open = self.sink.if_break_open(id);
                let broken = self.write(break_contents);
                self.sink.if_break_else(open);
                let flat = self.write(flat_contents);
                self.sink.if_break_close(open);
                broken.and(flat)?;
            }
            Doc::LineSuffix(contents) => {
                let open = self.sink.line_suffix_open();
                let result = self.write(contents);
                self.sink.line_suffix_close(open);
                result?;
            }
            Doc::LineSuffixBoundary => self.sink.line_suffix_boundary(),
            Doc::BreakParent => self.sink.break_parent(),
            Doc::Line(Line::Space) => self.sink.line(),
            Doc::Line(Line::Soft) => self.sink.softline(),
            Doc::Line(Line::Hard | Line::Literal) => return Err(Unwritten::Unknown),
        }
        Ok(())
    }
}
