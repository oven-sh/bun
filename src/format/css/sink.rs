//! What the printer for style sheets writes to: the parts of a document, one after the other.
//!
//! Most of a style sheet needs no document. Where no group is around them, lines are line breaks. And if a line
//! fits as a whole with every group in it on one line, that is how Prettier prints it: a group is measured with what
//! follows it up to the next possible line break. So at first everything is written straight to the output that
//! way. If a line with a group in it turns out too long, or if there is something in a group that is more than its
//! content on one line, `Sink::end_unit` says so. Then what has been written of the unit is taken back and it is
//! written again, this time to a document, which is printed in its place.

use super::doc::{self, Doc, Line};
use std::borrow::Cow;

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

#[derive(Copy, Clone, PartialEq, Eq)]
enum Frame {
    Array,
    Group {
        should_break: bool,
    },
    Indent,
    Dedent,
    /// Items and separators take turns in it.
    Fill,
    /// The same, in an array.
    Items,
    Item,
    LineSuffix,
    WithoutLines,
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

    /// The parts of the document that are not complete yet. Empty: what is written goes straight to the output.
    frames: Vec<(Frame, Vec<Doc<'static>>)>,

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
    /// The unit takes a document.
    has_failed: bool,
}

impl<'o> Sink<'o> {
    pub(crate) fn to_output(printer: doc::Printer<'o>) -> Self {
        Sink {
            line_start: printer.out.len(),
            printer: Some(printer),
            frames: Vec::new(),
            indent: 0,
            outer_indents: Vec::new(),
            flat_groups: 0,
            line_start_column: 0,
            has_group_in_line: false,
            has_failed: false,
        }
    }

    pub(crate) fn to_document() -> Self {
        Sink {
            printer: None,
            frames: vec![(Frame::Array, Vec::new())],
            indent: 0,
            outer_indents: Vec::new(),
            flat_groups: 0,
            line_start: 0,
            line_start_column: 0,
            has_group_in_line: false,
            has_failed: false,
        }
    }

    /// Everything that has been written to `Sink::to_document()`.
    pub(crate) fn into_document(mut self) -> Doc<'static> {
        Doc::Array(self.frames.pop().map(|(_, parts)| parts).unwrap_or_default())
    }

    // ───────────────────────────── units ─────────────────────────────

    /// Starts a unit: something that no group is around and that a line break follows. `None`: it is part of
    /// something that is written again as a whole if need be, or that is written to a document.
    pub(crate) fn start_unit(&mut self) -> Option<Mark> {
        let printer = self.printer.as_ref()?;
        if !self.frames.is_empty() || self.has_group_in_line || self.has_failed || self.flat_groups > 0 {
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

    /// Ends the unit that started at `mark`. If it returns `false`, the unit has to be written once more, and
    /// `end_document` called.
    pub(crate) fn end_unit(&mut self, mark: &Mark) -> bool {
        self.check_line();
        self.has_group_in_line = false;
        if !std::mem::take(&mut self.has_failed) {
            return true;
        }
        if let Some(printer) = &mut self.printer {
            printer.out.truncate(mark.len);
        }
        self.line_start = mark.line_start;
        self.line_start_column = mark.line_start_column;
        self.indent = mark.indent;
        self.outer_indents.truncate(mark.outer_indents);
        self.flat_groups = 0;
        self.frames.push((Frame::Array, Vec::new()));
        false
    }

    /// Prints the document that the unit has been written to.
    pub(crate) fn end_document(&mut self) {
        let mut document = Doc::Array(self.frames.pop().map(|(_, parts)| parts).unwrap_or_default());
        let column = self.column();
        if let Some(printer) = &mut self.printer {
            self.line_start_column = printer.print_part(&mut document, self.indent, column);
            self.line_start = printer.out.len();
        }
    }

    /// Writes `document`, which no group is around and which ends with a line break.
    pub(crate) fn document(&mut self, mut document: Doc<'_>) {
        if !self.is_straight() {
            return self.push(doc::into_owned(document));
        }
        let column = self.column();
        if let Some(printer) = &mut self.printer {
            self.line_start_column = printer.print_part(&mut document, self.indent, column);
            self.line_start = printer.out.len();
        }
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

    // ───────────────────────────── the parts of a document ─────────────────────────────

    fn is_straight(&self) -> bool {
        self.frames.is_empty()
    }

    fn push(&mut self, doc: Doc<'static>) {
        if let Some((_, parts)) = self.frames.last_mut() {
            parts.push(doc);
        }
    }

    fn start(&mut self, frame: Frame) {
        self.frames.push((frame, Vec::new()));
    }

    fn end(&mut self) {
        let Some((frame, parts)) = self.frames.pop() else {
            return;
        };
        let doc = match frame {
            Frame::Array | Frame::Item | Frame::Items => Doc::Array(parts),
            Frame::Group { should_break } => doc::group_with(parts, should_break),
            Frame::Indent => doc::indent(parts),
            Frame::Dedent => doc::dedent(parts),
            Frame::Fill => Doc::Fill(parts),
            Frame::LineSuffix => doc::line_suffix(parts),
            Frame::WithoutLines => doc::remove_lines(Doc::Array(parts)),
        };
        self.push(doc);
    }

    pub(crate) fn text(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        match (&mut self.printer, self.frames.last_mut()) {
            (_, Some((_, parts))) => parts.push(Doc::Text(Cow::Owned(text.to_vec()))),
            (Some(printer), None) => printer.write_text(text),
            (None, None) => {}
        }
    }

    pub(crate) fn token(&mut self, text: &'static str) {
        match (&mut self.printer, self.frames.last_mut()) {
            (_, Some((_, parts))) => parts.push(Doc::from(text)),
            (Some(printer), None) => printer.out.extend_from_slice(text.as_bytes()),
            (None, None) => {}
        }
    }

    /// A line break where no group is written on one line.
    fn write_line_break(&mut self) {
        self.check_line();
        self.has_group_in_line = false;
        if let Some(printer) = &mut self.printer {
            self.line_start_column = printer.write_hard_line(self.indent);
            self.line_start = printer.out.len();
        }
    }

    pub(crate) fn line(&mut self) {
        if !self.is_straight() {
            self.push(Doc::LINE);
        } else if self.flat_groups > 0 {
            self.token(" ");
        } else {
            self.write_line_break();
        }
    }

    pub(crate) fn soft_line(&mut self) {
        if !self.is_straight() {
            self.push(Doc::SOFTLINE);
        } else if self.flat_groups == 0 {
            self.write_line_break();
        }
    }

    pub(crate) fn hard_line(&mut self) {
        if !self.is_straight() {
            self.push(doc::hardline());
        } else if self.flat_groups > 0 {
            self.has_failed = true;
        } else {
            self.write_line_break();
        }
    }

    /// `literallineWithoutBreakParent`
    pub(crate) fn literal_line(&mut self) {
        match self.is_straight() {
            true => self.has_failed = true,
            false => self.push(Doc::Line(Line::Literal)),
        }
    }

    pub(crate) fn break_parent(&mut self) {
        if !self.is_straight() {
            self.push(Doc::BreakParent);
        } else if self.flat_groups > 0 {
            self.has_failed = true;
        }
    }

    pub(crate) fn line_suffix_boundary(&mut self) {
        // Straight to the output, there is never a line suffix.
        if !self.is_straight() {
            self.push(Doc::LineSuffixBoundary);
        }
    }

    /// `ifBreak(text)`
    pub(crate) fn if_break(&mut self, text: &'static str) {
        if !self.is_straight() {
            self.push(doc::if_break(text));
        } else if self.flat_groups == 0 {
            self.token(text);
        }
    }

    pub(crate) fn start_group(&mut self, should_break: bool) {
        if !self.is_straight() {
            self.start(Frame::Group { should_break });
        } else if self.flat_groups > 0 {
            self.has_failed |= should_break;
            self.flat_groups += 1;
        } else if !should_break {
            self.flat_groups = 1;
            self.has_group_in_line = true;
        }
    }

    pub(crate) fn end_group(&mut self) {
        match self.is_straight() {
            true => self.flat_groups = self.flat_groups.saturating_sub(1),
            false => self.end(),
        }
    }

    pub(crate) fn start_indent(&mut self) {
        if !self.is_straight() {
            self.start(Frame::Indent);
        } else if self.flat_groups == 0
            && let Some(printer) = &mut self.printer
        {
            self.outer_indents.push(self.indent);
            self.indent = printer.indented(self.indent);
        }
    }

    pub(crate) fn start_dedent(&mut self) {
        if !self.is_straight() {
            self.start(Frame::Dedent);
        } else if self.flat_groups == 0
            && let Some(printer) = &mut self.printer
        {
            self.outer_indents.push(self.indent);
            self.indent = printer.dedented(self.indent);
        }
    }

    /// Ends an `indent` or a `dedent`.
    pub(crate) fn end_indent(&mut self) {
        if !self.is_straight() {
            self.end();
        } else if self.flat_groups == 0 {
            self.indent = self.outer_indents.pop().unwrap_or(0);
        }
    }

    /// Starts a `fill` and its first item, or an array of the same shape.
    pub(crate) fn start_fill(&mut self, is_fill: bool) {
        if !self.is_straight() {
            self.start(if is_fill { Frame::Fill } else { Frame::Items });
            self.start(Frame::Item);
        } else if self.flat_groups == 0 {
            // How much of it fits on each line is for the printer to find out.
            self.has_failed = true;
        }
    }

    /// Ends an item, and starts the next one behind `separator`.
    pub(crate) fn fill_separator(&mut self, separator: Separator) {
        if self.is_straight() {
            return match separator {
                Separator::Line | Separator::DedentedLine => self.token(" "),
                Separator::SoftLine => {}
                Separator::HardLine | Separator::DedentedHardLine => self.has_failed = true,
            };
        }
        self.end();
        self.push(match separator {
            Separator::Line => Doc::LINE,
            Separator::SoftLine => Doc::SOFTLINE,
            Separator::HardLine => doc::hardline(),
            Separator::DedentedLine => doc::dedent(Doc::LINE),
            Separator::DedentedHardLine => doc::dedent(doc::hardline()),
        });
        self.start(Frame::Item);
    }

    /// Makes a `fill` of its own of what the `fill` has so far, which starts the only item that there is then.
    pub(crate) fn nest_fill(&mut self) {
        if self.is_straight() {
            return;
        }
        self.end();
        let inner = self.frames.last_mut().map(|(_, parts)| std::mem::take(parts)).unwrap_or_default();
        self.start(Frame::Item);
        self.push(Doc::Fill(inner));
    }

    /// Puts an empty item and a `hardline` before the items of the `fill`.
    pub(crate) fn start_fill_with_hard_line(&mut self) {
        if let [.., (_, parts), _] = &mut self.frames[..] {
            parts.splice(0..0, [Doc::EMPTY, doc::hardline()]);
        }
    }

    pub(crate) fn end_fill(&mut self) {
        if !self.is_straight() {
            self.end();
            self.end();
        }
    }

    pub(crate) fn start_line_suffix(&mut self) {
        match self.is_straight() {
            true => self.has_failed = true,
            false => self.start(Frame::LineSuffix),
        }
    }

    pub(crate) fn end_line_suffix(&mut self) {
        if !self.is_straight() {
            self.end();
        }
    }

    /// Starts what `removeLines` is applied to.
    pub(crate) fn start_without_lines(&mut self) {
        match self.is_straight() {
            true => self.has_failed = true,
            false => self.start(Frame::WithoutLines),
        }
    }

    pub(crate) fn end_without_lines(&mut self) {
        if !self.is_straight() {
            self.end();
        }
    }
}
