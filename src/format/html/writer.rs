//! What the printer writes the document with: the builders of Prettier's `document/builders`, for the elements of
//! `ir`.
//!
//! The printer of `ir` writes no line break on a line that is empty, Prettier's does: two of them in a row are an empty
//! line. So this keeps track of whether anything has been written since the last line break, and asks for an empty line
//! where Prettier gets one.

use crate::ir::element::{
    Condition, CursorMark, DedentMode, Group, GroupMode, Interned, LineMode, PrintMode, Text,
    TextWidth,
};
use crate::prelude::*;
use bun_core::strings;

/// Whether the line is empty where the next element is printed.
#[derive(Copy, Clone, PartialEq, Eq)]
enum EmptyLine {
    No,
    /// If the line break before is one: that is up to the group that both are in.
    IfGroupBreaks,
    Yes,
}

pub(crate) struct Writer<'w, 'f> {
    pub(crate) f: &'w mut Formatter<'f>,
    /// Line breaks right after each other that have not been written yet: what they are if the group is on one line,
    /// and how many.
    pending_line: Option<(LineMode, u32)>,
    empty_line: EmptyLine,
    /// How many `indent`s are around what is written, if nothing else has a say in where its lines start.
    indent_level: Option<u32>,
}

impl<'w, 'f> Writer<'w, 'f> {
    /// `indent_level`: how many `indent`s are around what is written, if that is known. `is_at_start`: nothing has been
    /// written yet.
    pub(crate) fn new(
        f: &'w mut Formatter<'f>,
        indent_level: Option<u32>,
        is_at_start: bool,
    ) -> Self {
        Writer {
            f,
            pending_line: None,
            empty_line: if is_at_start {
                EmptyLine::Yes
            } else {
                EmptyLine::No
            },
            indent_level,
        }
    }

    pub(crate) fn new_group_id(&mut self) -> GroupId {
        self.f.group_id("html")
    }

    pub(crate) fn indent_level(&self) -> Option<u32> {
        self.indent_level
    }

    /// The column that the lines of what is written start in, if that does not depend on how the document is printed.
    pub(crate) fn indentation_width(&self) -> Option<usize> {
        Some(self.indent_level? as usize * usize::from(self.f.options().indent_width.value()))
    }

    // ───────────────────────────── line breaks ─────────────────────────────

    fn add_line(&mut self, mode: LineMode) {
        self.pending_line = Some(match self.pending_line {
            None => (mode, 1),
            Some((LineMode::Hard, count)) => (LineMode::Hard, count + 1),
            Some((LineMode::SoftOrSpace, count)) if mode == LineMode::Soft => {
                (LineMode::SoftOrSpace, count + 1)
            }
            Some((_, count)) => (mode, count + 1),
        });
    }

    /// Writes the line breaks that are due.
    fn flush(&mut self) {
        let Some((mode, count)) = self.pending_line.take() else {
            return;
        };
        // The printer leaves out the first on a line that is empty.
        let is_line_empty = self.empty_line != EmptyLine::No;
        let written_by_mode = if is_line_empty { 0 } else { 1 };
        if mode == LineMode::Hard && is_line_empty {
            // The first is for the indentation that is due not to be written.
            self.f
                .write_element(FormatElement::Tag(Tag::StartDedent(DedentMode::Root)));
            self.f.write_element(FormatElement::Line(LineMode::Hard));
            self.f
                .write_text(&b"\n".repeat(count as usize), Some(TextWidth::multiline(0)));
            self.f
                .write_element(FormatElement::Tag(Tag::EndDedent(DedentMode::Root)));
            self.f.write_element(FormatElement::Line(LineMode::Hard));
        } else if mode == LineMode::Hard && count > written_by_mode + 1 {
            let extra = (count - written_by_mode - 1) as usize;
            self.f.write_text(
                &b"\n".repeat(extra + written_by_mode as usize),
                Some(TextWidth::multiline(0)),
            );
            self.f.write_element(FormatElement::Line(LineMode::Empty));
        } else {
            let with_empty_line = count > written_by_mode;
            self.f
                .write_element(FormatElement::Line(match (mode, with_empty_line) {
                    (mode, false) => mode,
                    (LineMode::Soft, true) => LineMode::SoftEmpty,
                    (LineMode::SoftOrSpace, true) => LineMode::SoftOrSpaceEmpty,
                    (_, true) => LineMode::Empty,
                }));
        }
        self.empty_line = if mode == LineMode::Hard {
            EmptyLine::Yes
        } else {
            EmptyLine::IfGroupBreaks
        };
    }

    /// Something starts or ends that decides by itself whether the line breaks in it are line breaks.
    fn tag(&mut self, tag: Tag) {
        self.flush();
        // A line break in what starts here is one only if those of the group around it are.
        if self.empty_line == EmptyLine::IfGroupBreaks
            && !matches!(tag, Tag::StartGroup(_) | Tag::StartFill | Tag::StartEntry)
        {
            self.empty_line = EmptyLine::No;
        }
        self.f.write_element(FormatElement::Tag(tag));
    }

    /// Something starts or ends that changes where lines start.
    fn indent_tag(&mut self, tag: Tag) {
        self.flush();
        self.f.write_element(FormatElement::Tag(tag));
    }

    pub(crate) fn line(&mut self) {
        self.add_line(LineMode::SoftOrSpace);
    }

    pub(crate) fn softline(&mut self) {
        self.add_line(LineMode::Soft);
    }

    pub(crate) fn hardline(&mut self) {
        self.add_line(LineMode::Hard);
    }

    pub(crate) fn break_parent(&mut self) {
        self.flush();
        self.f.write_element(FormatElement::ExpandParent);
    }

    // ───────────────────────────── strings ─────────────────────────────

    fn note_text(&mut self, text: &[u8]) {
        self.empty_line = if text.ends_with(b"\n") {
            EmptyLine::Yes
        } else {
            EmptyLine::No
        };
    }

    /// A keyword or a punctuator.
    pub(crate) fn token(&mut self, text: &'static str) {
        self.flush();
        self.empty_line = EmptyLine::No;
        self.f.write_token(text);
    }

    /// `replaceEndOfLine(text)`: a line break in it is a `literalline`.
    pub(crate) fn text(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        self.flush();
        self.note_text(text);
        self.f.write_text(text, None);
    }

    /// A string that Prettier does not look into: a line break in it is a character without a width.
    pub(crate) fn string(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        self.flush();
        self.note_text(text);
        super::js::write_string(text, self.f);
    }

    /// The same for what `build` appends to the vector that it is given.
    pub(crate) fn built_text(&mut self, build: impl FnOnce(&mut Vec<u8>)) {
        let start = self.f.storage.text.len();
        build(&mut self.f.storage.text);
        let Some(text) = self
            .f
            .storage
            .text
            .get(start..)
            .filter(|text| !text.is_empty())
        else {
            return;
        };
        let (len, ends_with_line_break) = (text.len() as u32, text.ends_with(b"\n"));
        let width = TextWidth::from_text_as(text, self.f.options().flavor);
        self.flush();
        self.empty_line = if ends_with_line_break {
            EmptyLine::Yes
        } else {
            EmptyLine::No
        };
        self.f.write_element(FormatElement::OwnedText(Text {
            start: start as u32,
            len,
            width,
        }));
    }

    /// `replaceEndOfLine(text.replaceAll(byte, replacement))`
    pub(crate) fn text_replacing(&mut self, text: &[u8], byte: u8, replacement: &[u8]) {
        if !strings::contains_char(text, byte) {
            return self.text(text);
        }
        self.built_text(|out| {
            let mut rest = text;
            while let Some(at) = strings::index_of_char_usize(rest, byte) {
                out.extend_from_slice(&rest[..at]);
                out.extend_from_slice(replacement);
                rest = &rest[at + 1..];
            }
            out.extend_from_slice(rest);
        });
    }

    /// Text that another formatter has printed for lines that start where these do. A line break that is part of
    /// a text in it is `\r\n`: see `FormatOptions::is_in_markdown`.
    pub(crate) fn printed_text(&mut self, text: &[u8]) {
        let mut rest = text;
        loop {
            // Up to the first line break that is not part of a text.
            let (mut end, mut has_line_breaks) = (0, false);
            while let Some(at) =
                strings::index_of_char_usize(&rest[end..], b'\n').map(|at| end + at)
                && rest[..at].ends_with(b"\r")
            {
                (end, has_line_breaks) = (at + 1, true);
            }
            let end =
                strings::index_of_char_usize(&rest[end..], b'\n').map_or(rest.len(), |at| end + at);
            let line = &rest[..end];
            match has_line_breaks {
                false => self.text(line),
                true => self.built_text(|out| {
                    for (index, part) in strings::split(line, b"\r\n").enumerate() {
                        if index > 0 {
                            out.push(b'\n');
                        }
                        out.extend_from_slice(part);
                    }
                }),
            }
            let Some(after) = rest.get(end + 1..) else {
                return;
            };
            self.hardline();
            rest = after;
        }
    }

    // ───────────────────────────── what has contents ─────────────────────────────

    pub(crate) fn start_group(&mut self) {
        self.tag(Tag::StartGroup(Group::new()));
    }

    pub(crate) fn start_group_with(&mut self, should_break: bool, id: Option<GroupId>) {
        let mode = if should_break {
            GroupMode::Expand
        } else {
            GroupMode::Flat
        };
        self.tag(Tag::StartGroup(Group::new().with_id(id).with_mode(mode)));
    }

    pub(crate) fn end_group(&mut self) {
        self.tag(Tag::EndGroup);
    }

    pub(crate) fn start_indent(&mut self) {
        self.indent_tag(Tag::StartIndent);
        self.indent_level = self.indent_level.map(|level| level + 1);
    }

    pub(crate) fn end_indent(&mut self) {
        self.indent_tag(Tag::EndIndent);
        self.indent_level = self.indent_level.map(|level| level.saturating_sub(1));
    }

    /// `dedentToRoot(softline)`
    pub(crate) fn softline_dedented_to_root(&mut self) {
        self.indent_tag(Tag::StartDedent(DedentMode::Root));
        self.softline();
        self.indent_tag(Tag::EndDedent(DedentMode::Root));
    }

    /// `indentIfBreak(.., { groupId })`. Returns what to end it with.
    pub(crate) fn start_indent_if_break(&mut self, group_id: GroupId) -> Option<u32> {
        self.indent_tag(Tag::StartIndentIfGroupBreaks(group_id));
        self.indent_level.take()
    }

    pub(crate) fn end_indent_if_break(&mut self, group_id: GroupId, indent_level: Option<u32>) {
        self.indent_tag(Tag::EndIndentIfGroupBreaks(group_id));
        self.indent_level = indent_level;
    }

    pub(crate) fn start_fill(&mut self) {
        self.tag(Tag::StartFill);
    }

    pub(crate) fn end_fill(&mut self) {
        self.tag(Tag::EndFill);
    }

    pub(crate) fn start_item(&mut self) {
        self.tag(Tag::StartEntry);
    }

    pub(crate) fn end_item(&mut self) {
        self.tag(Tag::EndEntry);
    }

    /// Starts what is only there if the group with the id is broken, or only if it is not. `None`: the group that it
    /// is in.
    pub(crate) fn start_if(&mut self, is_broken: bool, group_id: Option<GroupId>) {
        let mode = if is_broken {
            PrintMode::Expanded
        } else {
            PrintMode::Flat
        };
        self.tag(Tag::StartConditionalContent(
            Condition::new(mode).with_group_id(group_id),
        ));
    }

    pub(crate) fn end_if(&mut self) {
        self.tag(Tag::EndConditionalContent);
    }

    /// `ifBreak(softline, "", { groupId })`
    pub(crate) fn softline_if_break(&mut self, group_id: GroupId) {
        self.start_if(true, Some(group_id));
        self.softline();
        self.end_if();
    }

    /// `ifBreak(text)`
    pub(crate) fn token_if_break(&mut self, text: &'static str) {
        self.start_if(true, None);
        self.token(text);
        self.end_if();
    }

    // ───────────────────────────── what somebody else writes ─────────────────────────────

    /// Calls `write` to write something that does not start and does not end with a line break.
    pub(crate) fn foreign<R>(&mut self, write: impl FnOnce(&mut Formatter<'f>) -> R) -> R {
        self.flush();
        self.empty_line = EmptyLine::No;
        write(self.f)
    }

    /// Starts something that may not become part of the document. Returns what to end it with.
    pub(crate) fn start_attempt(&mut self) -> Attempt {
        self.flush();
        Attempt {
            slot: self.f.start_capture(),
            empty_line: self.empty_line,
            indent_level: self.indent_level,
        }
    }

    /// The start or the end of the part of the text that the cursor is in.
    pub(crate) fn cursor_mark(&mut self, mark: CursorMark) {
        self.flush();
        self.f.write_element(FormatElement::Cursor(mark));
    }

    /// The same for something that is written behind a string that has not been written yet.
    pub(crate) fn start_attempt_behind_text(&mut self) -> Attempt {
        let attempt = self.start_attempt();
        self.empty_line = EmptyLine::No;
        attempt
    }

    /// Ends it. It is part of the document if `is_kept`. Returns that.
    pub(crate) fn end_attempt(&mut self, attempt: Attempt, is_kept: bool) -> bool {
        match is_kept {
            true => self.flush(),
            false => {
                self.pending_line = None;
                self.empty_line = attempt.empty_line;
                self.indent_level = attempt.indent_level;
            }
        }
        let written = self.f.end_capture(attempt.slot);
        if is_kept && written.len > 0 {
            self.f.write_element(FormatElement::Interned(written));
        }
        is_kept
    }

    /// Ends it. Returns what has been written, which is not part of the document yet, if `is_kept` and it is
    /// something.
    pub(crate) fn end_attempt_as_content(
        &mut self,
        attempt: Attempt,
        is_kept: bool,
    ) -> Option<Interned> {
        match is_kept {
            true => self.flush(),
            false => self.pending_line = None,
        }
        self.empty_line = attempt.empty_line;
        self.indent_level = attempt.indent_level;
        Some(self.f.end_capture(attempt.slot)).filter(|written| is_kept && written.len > 0)
    }

    /// Ends what is written.
    pub(crate) fn finish(mut self) {
        self.flush();
    }
}

/// See [`Writer::start_attempt`].
pub(crate) struct Attempt {
    slot: usize,
    empty_line: EmptyLine,
    indent_level: Option<u32>,
}
