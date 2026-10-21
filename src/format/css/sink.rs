//! The CSS printer's output sink. It receives the parts of a document in order.
//!
//! Most of a style sheet doesn't need a document. Outside of any group, a `line` is simply a line break. And if a whole
//! line fits with every group on it flat, that's how Prettier prints it, because a group is measured together with what
//! follows it up to the next possible line break. So everything is first written straight to the output that way. If a
//! line with a group on it turns out too long, or a group contains something that can't simply be written flat,
//! `Sink::end_unit` reports it. The unit's output is then rolled back, and the unit is written again, this time into a
//! document, which is printed in its place.

use super::doc::{self, Doc, Elements, Group, IndentCommand, Line};
use crate::FormatError;

/// The separator between two items of a `fill`.
#[derive(Copy, Clone)]
pub(crate) enum Separator {
    Line,
    SoftLine,
    HardLine,
    /// `dedent(line)`
    DedentedLine,
    /// `dedent(hardline)`
    DedentedHardLine,
}

/// The sink's state at the start of a unit.
pub(crate) struct Mark {
    len: usize,
    line_start: usize,
    line_start_column: usize,
    indent: u32,
    outer_indents: usize,
}

pub(crate) struct Sink<'o> {
    /// `None` if the caller only wants the document.
    printer: Option<doc::Printer<'o>>,

    /// True if writes go to `elements` instead of straight to the output.
    is_document: bool,
    elements: Elements,
    /// Start positions of the open `removeLines` regions.
    without_lines: Vec<usize>,

    indent: u32,
    /// Saved values of `indent`, restored by `end_indent`.
    outer_indents: Vec<u32>,
    /// The number of open groups that are being written flat.
    flat_groups: u32,
    /// The output offset just after the current line's indentation, or after the part of the line that the doc printer
    /// wrote, and the column at that offset.
    line_start: usize,
    line_start_column: usize,
    /// True if a group has been written flat on the current line.
    has_group_in_line: bool,
    /// How many times something other than text has gone to the output.
    line_breaks: u32,
    /// The unit needs a document.
    needs_document: bool,
    /// The style sheet is embedded in HTML, where Prettier runs `cleanDoc` on its document.
    is_cleaned: bool,
}

impl<'o> Sink<'o> {
    pub(crate) fn to_output(printer: doc::Printer<'o>, is_cleaned: bool) -> Self {
        Sink {
            is_cleaned,
            line_start: printer.out.len(),
            printer: Some(printer),
            is_document: false,
            elements: Elements::default(),
            without_lines: Vec::new(),
            indent: 0,
            outer_indents: Vec::new(),
            flat_groups: 0,
            line_start_column: 0,
            has_group_in_line: false,
            line_breaks: 0,
            needs_document: false,
        }
    }

    pub(crate) fn to_document() -> Self {
        Sink {
            is_cleaned: false,
            printer: None,
            is_document: true,
            elements: Elements::default(),
            without_lines: Vec::new(),
            indent: 0,
            outer_indents: Vec::new(),
            flat_groups: 0,
            line_start: 0,
            line_start_column: 0,
            has_group_in_line: false,
            line_breaks: 0,
            needs_document: false,
        }
    }

    /// Returns everything written to a `Sink::to_document()`.
    pub(crate) fn into_document(self) -> Result<Doc<'static>, FormatError> {
        self.elements.to_tree()
    }

    /// Not everything could be written, so the output is unusable.
    pub(crate) fn fail(&mut self, failure: FormatError) {
        if let Some(printer) = &mut self.printer {
            printer.fail(failure);
        }
    }

    /// Returns the failure, if any, that made the output unusable.
    pub(crate) fn result(&self) -> Result<(), FormatError> {
        match &self.printer {
            Some(printer) => printer.result(),
            None => Ok(()),
        }
    }

    // ───────────────────────────── units ─────────────────────────────

    /// Starts a unit: output that isn't inside a group and is followed by a line break. Returns `None` if it's already
    /// going to a document, or if it's part of something larger that would be rewritten as a whole.
    pub(crate) fn start_unit(&mut self) -> Option<Mark> {
        let printer = self.printer.as_ref()?;
        if self.is_document || self.has_group_in_line || self.needs_document || self.flat_groups > 0
        {
            return None;
        }
        Some(Mark {
            len: printer.out.len(),
            line_start: self.line_start,
            line_start_column: self.line_start_column,
            indent: self.indent,
            outer_indents: self.outer_indents.len(),
        })
    }

    /// Ends a unit. If it returns `false`, the unit must be written again between `start_document` and `end_document`.
    pub(crate) fn end_unit(&mut self) -> bool {
        self.check_line();
        self.has_group_in_line = false;
        !std::mem::take(&mut self.needs_document)
    }

    /// Rolls back the output of the unit that started at `mark`. From now on, writes go to a document.
    pub(crate) fn start_document(&mut self, mark: &Mark) {
        if let Some(printer) = &mut self.printer {
            printer.out.truncate(mark.len);
        }
        self.line_start = mark.line_start;
        self.line_start_column = mark.line_start_column;
        self.indent = mark.indent;
        self.outer_indents.truncate(mark.outer_indents);
        self.flat_groups = 0;
        self.elements.clear();
        self.is_document = true;
    }

    /// True if a text of `len` characters fits on the line.
    pub(crate) fn has_room_for(&self, len: usize) -> bool {
        self.printer.as_ref().is_none_or(|printer| {
            self.line_start_column + (printer.out.len() - self.line_start) + len <= printer.width
        })
    }

    /// Prints the document that the unit was written to.
    pub(crate) fn end_document(&mut self) {
        self.is_document = false;
        self.line_breaks += 1;
        let column = self.column();
        if let Some(printer) = &mut self.printer {
            self.line_start_column = printer.print(&self.elements, self.indent, column);
            self.line_start = printer.out.len();
        }
    }

    /// Writes `document`, which isn't inside a group and ends with a line break.
    pub(crate) fn document(&mut self, document: &Doc<'_>) {
        if !self.writes_directly() {
            return self.elements.document(document);
        }
        self.elements.clear();
        self.elements.document(document);
        self.end_document();
    }

    fn column(&self) -> usize {
        let line_so_far = self
            .printer
            .as_ref()
            .and_then(|printer| printer.out.get(self.line_start..))
            .unwrap_or_default();
        self.line_start_column + crate::ir::width::string_width(line_so_far) as usize
    }

    /// Called when the current line is complete. The unit fails if the line has a flat group on it and is too long.
    fn check_line(&mut self) {
        if self.has_group_in_line
            && self
                .printer
                .as_ref()
                .is_some_and(|printer| self.column() > printer.width)
        {
            self.needs_document = true;
        }
    }

    // ───────────────────────────── replaying cached output ─────────────────────────────

    /// Returns the current output position for `written_since`, or `None` unless writes go straight to the output.
    pub(crate) fn position(&self) -> Option<(usize, u32)> {
        let printer = self
            .printer
            .as_ref()
            .filter(|_| self.writes_directly() && !self.needs_document)?;
        Some((printer.out.len(), self.line_breaks))
    }

    /// Returns the output since `position` if it's all on one line, and whether that line has a group on it.
    pub(crate) fn written_since(&self, (len, line_breaks): (usize, u32)) -> Option<(&[u8], bool)> {
        let printer = self.printer.as_ref().filter(|_| {
            self.writes_directly() && !self.needs_document && self.line_breaks == line_breaks
        })?;
        Some((printer.out.get(len..)?, self.has_group_in_line))
    }

    /// Writes output that `written_since` returned earlier.
    pub(crate) fn replay_output(&mut self, text: &[u8], has_group: bool) {
        self.text(text);
        self.has_group_in_line |= has_group;
    }

    // ───────────────────────────── the parts of a document ─────────────────────────────

    fn writes_directly(&self) -> bool {
        !self.is_document
    }

    #[inline]
    pub(crate) fn text(&mut self, text: &[u8]) {
        if self.is_document {
            self.elements.text(text);
        } else if let Some(printer) = &mut self.printer {
            printer.write_text(text);
        }
    }

    #[inline]
    pub(crate) fn token(&mut self, text: &'static str) {
        if self.is_document {
            self.elements.token(text);
        } else if let Some(printer) = &mut self.printer {
            match *text.as_bytes() {
                [byte] => printer.out.push(byte),
                _ => printer.out.extend_from_slice(text.as_bytes()),
            }
        }
    }

    /// Writes a line break outside of any flat group.
    fn write_line_break(&mut self) {
        self.check_line();
        self.has_group_in_line = false;
        self.line_breaks += 1;
        if let Some(printer) = &mut self.printer {
            self.line_start_column = printer.write_hard_line(self.indent);
            self.line_start = printer.out.len();
        }
    }

    pub(crate) fn line(&mut self) {
        if self.is_document {
            self.elements.line(Line::Space);
        } else if self.flat_groups > 0 {
            self.token(" ");
        } else {
            self.write_line_break();
        }
    }

    pub(crate) fn soft_line(&mut self) {
        if self.is_document {
            self.elements.line(Line::Soft);
        } else if self.flat_groups == 0 {
            self.write_line_break();
        }
    }

    pub(crate) fn hard_line(&mut self) {
        if self.is_document {
            self.elements.hard_line();
        } else if self.flat_groups > 0 {
            self.needs_document = true;
        } else {
            self.write_line_break();
        }
    }

    /// `literallineWithoutBreakParent`
    pub(crate) fn literal_line(&mut self) {
        match self.is_document {
            true => self.elements.line(Line::Literal),
            false => self.needs_document = true,
        }
    }

    pub(crate) fn break_parent(&mut self) {
        if self.is_document {
            self.elements.break_parent();
        } else if self.flat_groups > 0 {
            self.needs_document = true;
        }
    }

    pub(crate) fn line_suffix_boundary(&mut self) {
        // There's never a line suffix when writing straight to the output.
        if self.is_document {
            self.elements.line_suffix_boundary();
        }
    }

    /// `ifBreak(text)`
    pub(crate) fn if_break(&mut self, text: &'static str) {
        if self.is_document {
            self.elements.start_if_break(0);
            self.elements.text(text.as_bytes());
            self.elements.otherwise();
            self.elements.end_if_break();
        } else if self.flat_groups == 0 {
            self.token(text);
        }
    }

    pub(crate) fn start_group(&mut self, should_break: bool) {
        if self.is_document {
            self.elements.start_group(Group {
                should_break,
                ..Group::default()
            });
        } else if self.flat_groups > 0 {
            self.needs_document |= should_break;
            self.flat_groups += 1;
        } else if !should_break {
            self.flat_groups = 1;
            self.has_group_in_line = true;
        }
    }

    pub(crate) fn end_group(&mut self) {
        match self.is_document {
            true => self.elements.end_group(),
            false => self.flat_groups = self.flat_groups.saturating_sub(1),
        }
    }

    pub(crate) fn start_indent(&mut self) {
        if self.is_document {
            self.elements.start_indent(IndentCommand::Indent);
        } else if self.flat_groups == 0
            && let Some(printer) = &mut self.printer
        {
            self.outer_indents.push(self.indent);
            self.indent = printer.indented(self.indent);
        }
    }

    pub(crate) fn start_dedent(&mut self) {
        if self.is_document {
            self.elements.start_indent(IndentCommand::Dedent);
        } else if self.flat_groups == 0
            && let Some(printer) = &mut self.printer
        {
            self.outer_indents.push(self.indent);
            self.indent = printer.dedented(self.indent);
        }
    }

    /// Ends an `indent` or a `dedent`.
    pub(crate) fn end_indent(&mut self) {
        if self.is_document {
            self.elements.end_indent();
        } else if self.flat_groups == 0 {
            self.indent = self.outer_indents.pop().unwrap_or(0);
        }
    }

    /// Starts a `fill` and its first item.
    pub(crate) fn start_fill(&mut self) {
        if self.is_document {
            self.elements.start_fill();
            self.elements.start_item();
        } else if self.flat_groups == 0 {
            // Only the doc printer can work out how much fits on each line.
            self.needs_document = true;
        }
    }

    /// Ends an item, writes `separator` and starts the next item.
    pub(crate) fn fill_separator(&mut self, separator: Separator) {
        if !self.is_document {
            return match separator {
                Separator::Line | Separator::DedentedLine => self.token(" "),
                Separator::SoftLine => {}
                Separator::HardLine | Separator::DedentedHardLine => self.needs_document = true,
            };
        }
        let elements = &mut self.elements;
        elements.end_item();
        elements.start_item();
        let is_dedented = matches!(
            separator,
            Separator::DedentedLine | Separator::DedentedHardLine
        );
        if is_dedented {
            elements.start_indent(IndentCommand::Dedent);
        }
        match separator {
            Separator::Line | Separator::DedentedLine => elements.line(Line::Space),
            Separator::SoftLine => elements.line(Line::Soft),
            Separator::HardLine | Separator::DedentedHardLine => elements.hard_line(),
        }
        if is_dedented {
            elements.end_indent();
        }
        elements.end_item();
        elements.start_item();
    }

    /// See `Elements::nest_fill`.
    pub(crate) fn nest_fill(&mut self) {
        if self.is_document {
            self.elements.nest_fill();
        }
    }

    /// Inserts an empty item and a `hardline` separator before the `fill`'s items.
    pub(crate) fn start_fill_with_hard_line(&mut self) {
        if self.is_document {
            self.elements.start_fill_with_hard_line();
        }
    }

    pub(crate) fn end_fill(&mut self) {
        if self.is_document {
            self.elements.end_item();
            match self.is_cleaned {
                true => self.elements.end_cleaned_fill(),
                false => self.elements.end_fill(),
            }
        }
    }

    /// Ends a `fill`, but turns it into a plain array of its items.
    pub(crate) fn end_fill_as_array(&mut self) {
        if self.is_document {
            self.elements.end_item();
            self.elements.end_fill_as_array();
        }
    }

    pub(crate) fn start_line_suffix(&mut self) {
        match self.is_document {
            true => self.elements.start_line_suffix(),
            false => self.needs_document = true,
        }
    }

    pub(crate) fn end_line_suffix(&mut self) {
        if self.is_document {
            self.elements.end_line_suffix();
        }
    }

    /// Starts a region that `removeLines` is applied to.
    pub(crate) fn start_without_lines(&mut self) {
        match self.is_document {
            true => self.without_lines.push(self.elements.position()),
            false => self.needs_document = true,
        }
    }

    pub(crate) fn end_without_lines(&mut self) {
        if self.is_document
            && let Some(start) = self.without_lines.pop()
        {
            self.elements.remove_lines_from(start);
        }
    }
}
