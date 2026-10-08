//! What the printer for style sheets writes to: the parts of a document, one after the other.
//!
//! Most of a style sheet needs no document. Where no group is around them, lines are line breaks. And if a line
//! fits as a whole with every group in it on one line, that is how Prettier prints it: a group is measured with what
//! follows it up to the next possible line break. So at first everything is written straight to the output that
//! way. If a line with a group in it turns out too long, or if there is something in a group that is more than its
//! content on one line, `Sink::end_unit` says so. Then what has been written of the unit is taken back and it is
//! written again, this time to a document, which is printed in its place.

use super::doc::{self, Doc, Elements, IndentCommand, Line};

/// What is between two items of a `fill`.
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

/// Where a unit starts.
pub(crate) struct Mark {
    len: usize,
    line_start: usize,
    line_start_column: usize,
    indent: u32,
    outer_indents: usize,
}

pub(crate) struct Sink<'o> {
    /// `None`: all that is wanted is the document.
    printer: Option<doc::Printer<'o>>,

    /// Whether what is written goes to `elements`, not straight to the output.
    is_document: bool,
    elements: Elements,
    /// Of each `fill` of `elements` that is open, whether it is one, not an array.
    fills: Vec<bool>,
    /// Where what `removeLines` is applied to starts.
    without_lines: Vec<usize>,

    indent: u32,
    /// What `indent` is set back to.
    outer_indents: Vec<u32>,
    /// How many groups are open that are written on one line.
    flat_groups: u32,
    /// Where the line starts behind its indentation, or behind what the printer has written of it, and the column
    /// there.
    line_start: usize,
    line_start_column: usize,
    /// Whether a group has been written on one line in this line.
    has_group_in_line: bool,
    /// How many times something else than a text has gone to the output.
    line_breaks: u32,
    /// The unit takes a document.
    has_failed: bool,
}

impl<'o> Sink<'o> {
    pub(crate) fn to_output(printer: doc::Printer<'o>) -> Self {
        Sink {
            line_start: printer.out.len(),
            printer: Some(printer),
            is_document: false,
            elements: Elements::default(),
            fills: Vec::new(),
            without_lines: Vec::new(),
            indent: 0,
            outer_indents: Vec::new(),
            flat_groups: 0,
            line_start_column: 0,
            has_group_in_line: false,
            line_breaks: 0,
            has_failed: false,
        }
    }

    pub(crate) fn to_document() -> Self {
        Sink {
            printer: None,
            is_document: true,
            elements: Elements::default(),
            fills: Vec::new(),
            without_lines: Vec::new(),
            indent: 0,
            outer_indents: Vec::new(),
            flat_groups: 0,
            line_start: 0,
            line_start_column: 0,
            has_group_in_line: false,
            line_breaks: 0,
            has_failed: false,
        }
    }

    /// Everything that has been written to `Sink::to_document()`.
    pub(crate) fn into_document(self) -> Doc<'static> {
        self.elements.to_tree()
    }

    // ───────────────────────────── units ─────────────────────────────

    /// Starts a unit: something that no group is around and that a line break follows. `None`: it is part of
    /// something that is written again as a whole if need be, or that is written to a document.
    pub(crate) fn start_unit(&mut self) -> Option<Mark> {
        let printer = self.printer.as_ref()?;
        if self.is_document || self.has_group_in_line || self.has_failed || self.flat_groups > 0 {
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

    /// Ends a unit. If it returns `false`, the unit has to be written once more, between `start_document` and
    /// `end_document`.
    pub(crate) fn end_unit(&mut self) -> bool {
        self.check_line();
        self.has_group_in_line = false;
        !std::mem::take(&mut self.has_failed)
    }

    /// Takes back what has been written of the unit that started at `mark`. What is written from now on goes to a
    /// document.
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

    /// Whether a text of `len` characters fits on the line.
    pub(crate) fn has_room_for(&self, len: usize) -> bool {
        self.printer.as_ref().is_none_or(|printer| self.line_start_column + (printer.out.len() - self.line_start) + len <= printer.width)
    }

    /// Prints the document that the unit has been written to.
    pub(crate) fn end_document(&mut self) {
        self.is_document = false;
        self.line_breaks += 1;
        let column = self.column();
        if let Some(printer) = &mut self.printer {
            self.line_start_column = printer.print(&self.elements, self.indent, column);
            self.line_start = printer.out.len();
        }
    }

    /// Writes `document`, which no group is around and which ends with a line break.
    pub(crate) fn document(&mut self, document: &Doc<'_>) {
        if !self.is_straight() {
            return self.elements.document(document);
        }
        self.elements.clear();
        self.elements.document(document);
        self.end_document();
    }

    fn column(&self) -> usize {
        let written = self.printer.as_ref().and_then(|printer| printer.out.get(self.line_start..)).unwrap_or_default();
        self.line_start_column + crate::ir::width::string_width(written) as usize
    }

    /// The line is complete.
    fn check_line(&mut self) {
        if self.has_group_in_line && self.printer.as_ref().is_some_and(|printer| self.column() > printer.width) {
            self.has_failed = true;
        }
    }

    // ───────────────────────────── what is written again ─────────────────────────────

    /// Where the output is, if that is what is written to, for `written_since`.
    pub(crate) fn position(&self) -> Option<(usize, u32)> {
        let printer = self.printer.as_ref().filter(|_| self.is_straight() && !self.has_failed)?;
        Some((printer.out.len(), self.line_breaks))
    }

    /// What has been written since `position`, if that is a part of a line, and whether there is a group in the line.
    pub(crate) fn written_since(&self, (len, line_breaks): (usize, u32)) -> Option<(&[u8], bool)> {
        let printer = self.printer.as_ref().filter(|_| self.is_straight() && !self.has_failed && self.line_breaks == line_breaks)?;
        Some((printer.out.get(len..)?, self.has_group_in_line))
    }

    /// Writes what `written_since` has returned.
    pub(crate) fn write_again(&mut self, text: &[u8], has_group: bool) {
        self.text(text);
        self.has_group_in_line |= has_group;
    }

    // ───────────────────────────── the parts of a document ─────────────────────────────

    fn is_straight(&self) -> bool {
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
            self.elements.text(text.as_bytes());
        } else if let Some(printer) = &mut self.printer {
            match *text.as_bytes() {
                [byte] => printer.out.push(byte),
                _ => printer.out.extend_from_slice(text.as_bytes()),
            }
        }
    }

    /// A line break where no group is written on one line.
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
            self.has_failed = true;
        } else {
            self.write_line_break();
        }
    }

    /// `literallineWithoutBreakParent`
    pub(crate) fn literal_line(&mut self) {
        match self.is_document {
            true => self.elements.line(Line::Literal),
            false => self.has_failed = true,
        }
    }

    pub(crate) fn break_parent(&mut self) {
        if self.is_document {
            self.elements.break_parent();
        } else if self.flat_groups > 0 {
            self.has_failed = true;
        }
    }

    pub(crate) fn line_suffix_boundary(&mut self) {
        // Straight to the output, there is never a line suffix.
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
            self.elements.start_group(should_break, 0, false);
        } else if self.flat_groups > 0 {
            self.has_failed |= should_break;
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

    /// Starts a `fill` and its first item, or an array of the same shape.
    pub(crate) fn start_fill(&mut self, is_fill: bool) {
        if self.is_document {
            self.fills.push(is_fill);
            self.elements.start_fill();
            self.elements.start_item();
        } else if self.flat_groups == 0 {
            // How much of it fits on each line is for the printer to find out.
            self.has_failed = true;
        }
    }

    /// Ends an item, and starts the next one behind `separator`.
    pub(crate) fn fill_separator(&mut self, separator: Separator) {
        if !self.is_document {
            return match separator {
                Separator::Line | Separator::DedentedLine => self.token(" "),
                Separator::SoftLine => {}
                Separator::HardLine | Separator::DedentedHardLine => self.has_failed = true,
            };
        }
        let elements = &mut self.elements;
        elements.end_item();
        elements.start_item();
        let is_dedented = matches!(separator, Separator::DedentedLine | Separator::DedentedHardLine);
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

    /// Makes a `fill` of its own of what the `fill` has so far, which starts the only item that there is then.
    pub(crate) fn nest_fill(&mut self) {
        if self.is_document {
            self.elements.nest_fill();
        }
    }

    /// Puts an empty item and a `hardline` before the items of the `fill`.
    pub(crate) fn start_fill_with_hard_line(&mut self) {
        if self.is_document {
            self.elements.start_fill_with_hard_line();
        }
    }

    pub(crate) fn end_fill(&mut self) {
        if self.is_document {
            self.elements.end_item();
            match self.fills.pop() {
                Some(false) => self.elements.end_fill_as_array(),
                _ => self.elements.end_fill(),
            }
        }
    }

    pub(crate) fn start_line_suffix(&mut self) {
        match self.is_document {
            true => self.elements.start_line_suffix(),
            false => self.has_failed = true,
        }
    }

    pub(crate) fn end_line_suffix(&mut self) {
        if self.is_document {
            self.elements.end_line_suffix();
        }
    }

    /// Starts what `removeLines` is applied to.
    pub(crate) fn start_without_lines(&mut self) {
        match self.is_document {
            true => self.without_lines.push(self.elements.len()),
            false => self.has_failed = true,
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
