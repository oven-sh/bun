//! The HTML printer's document writer: Prettier's `document/builders`, emitting `ir` elements.
//!
//! Prettier prints every line break, so two in a row make an empty line. The `ir` printer skips a line break when the
//! current line is empty. So this tracks whether anything has been written since the last line break, and emits an
//! explicit empty line where Prettier would print one.

use crate::ir::element::{
    Condition, CursorMark, DedentMode, Group, GroupMode, Interned, LineMode, PrintMode, Text,
    TextWidth,
};
use crate::prelude::*;
use bun_core::strings;

/// Tracks whether the next element is printed on an empty line.
#[derive(Copy, Clone, PartialEq, Eq)]
enum EmptyLine {
    No,
    /// Only if the preceding `line` breaks, which depends on the enclosing group.
    IfGroupBreaks,
    /// Only if the preceding `line` broke, which depends on a group that has already ended.
    IfGroupHasBroken(GroupId),
    Yes,
}

pub(crate) struct Writer<'w, 'f> {
    pub(crate) f: &'w mut Formatter<'f>,
    /// Consecutive line breaks that haven't been written yet: their combined mode and their count.
    pending_line: Option<(LineMode, u32)>,
    /// How many of them must each print a space when they don't break. See [`Writer::line_or_literal_space`].
    pending_spaces: u32,
    empty_line: EmptyLine,
    /// Number of enclosing `indent`s, or `None` if something else also affects where lines start.
    indent_level: Option<u32>,
}

impl<'w, 'f> Writer<'w, 'f> {
    /// `indent_level` is the number of enclosing `indent`s, if known. `is_at_start` means nothing has been written yet.
    pub(crate) fn new(
        f: &'w mut Formatter<'f>,
        indent_level: Option<u32>,
        is_at_start: bool,
    ) -> Self {
        Writer {
            f,
            pending_line: None,
            pending_spaces: 0,
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

    /// Returns the column where lines start, or `None` if it depends on how the document is printed.
    pub(crate) fn indentation_width(&self) -> Option<usize> {
        Some(self.indent_level? as usize * self.f.options().indent_width.value() as usize)
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

    /// Writes the pending line breaks.
    fn flush(&mut self) {
        let Some((mode, count)) = self.pending_line.take() else {
            return;
        };
        // `SoftOrSpace` prints the first space, except where the line may be empty, because the `ir` printer drops a
        // space there. The remaining spaces are written as text.
        let (mode, extra_spaces) = match (mode, std::mem::take(&mut self.pending_spaces)) {
            (LineMode::SoftOrSpace, extra_spaces @ 1..) if self.empty_line != EmptyLine::No => {
                (LineMode::Soft, extra_spaces)
            }
            (LineMode::SoftOrSpace, extra_spaces @ 1..) => (mode, extra_spaces - 1),
            _ => (mode, 0),
        };
        match self.empty_line {
            EmptyLine::IfGroupHasBroken(id) => {
                for (group_mode, is_line_empty) in
                    [(PrintMode::Expanded, true), (PrintMode::Flat, false)]
                {
                    self.f
                        .write_element(FormatElement::Tag(Tag::StartConditionalContent(
                            Condition::new(group_mode).with_group_id(Some(id)),
                        )));
                    self.write_lines(mode, count, is_line_empty);
                    self.f
                        .write_element(FormatElement::Tag(Tag::EndConditionalContent));
                }
            }
            empty_line => self.write_lines(mode, count, empty_line != EmptyLine::No),
        }
        if extra_spaces > 0 {
            let condition = Condition::new(PrintMode::Flat);
            self.f
                .write_element(FormatElement::Tag(Tag::StartConditionalContent(condition)));
            for _ in 0..extra_spaces {
                self.f.write_token(" ");
            }
            self.f
                .write_element(FormatElement::Tag(Tag::EndConditionalContent));
        }
        self.empty_line = if mode == LineMode::Hard {
            EmptyLine::Yes
        } else {
            EmptyLine::IfGroupBreaks
        };
    }

    /// `is_line_empty` means the current line is empty, so the `ir` printer will skip the first line break.
    fn write_lines(&mut self, mode: LineMode, count: u32, is_line_empty: bool) {
        let breaks_printed_by_mode = if is_line_empty { 0 } else { 1 };
        if mode == LineMode::Hard && is_line_empty {
            // The first `Hard` only resets the pending indentation, so it isn't printed on the empty lines.
            self.f
                .write_element(FormatElement::Tag(Tag::StartDedent(DedentMode::Root)));
            self.f.write_element(FormatElement::Line(LineMode::Hard));
            self.f
                .write_text(&b"\n".repeat(count as usize), Some(TextWidth::multiline(0)));
            self.f
                .write_element(FormatElement::Tag(Tag::EndDedent(DedentMode::Root)));
            self.f.write_element(FormatElement::Line(LineMode::Hard));
        } else if mode == LineMode::Hard && count > 2 {
            // The first one ends the current line and trims its trailing whitespace.
            self.f.write_element(FormatElement::Line(LineMode::Hard));
            self.write_lines(mode, count - 1, true);
        } else {
            let with_empty_line = count > breaks_printed_by_mode;
            self.f
                .write_element(FormatElement::Line(match (mode, with_empty_line) {
                    (mode, false) => mode,
                    (LineMode::Soft, true) => LineMode::SoftEmpty,
                    (LineMode::SoftOrSpace, true) => LineMode::SoftOrSpaceEmpty,
                    (_, true) => LineMode::Empty,
                }));
        }
    }

    /// Call this right after the group `id` ends if the last thing in it is a line break.
    pub(crate) fn note_line_at_end_of_group(&mut self, id: GroupId) {
        self.empty_line = EmptyLine::IfGroupHasBroken(id);
    }

    /// Writes the start or end tag of a construct that decides for itself whether its line breaks break.
    fn tag(&mut self, tag: Tag) {
        self.flush();
        // `IfGroupBreaks` survives entering a nested group, because a line break in there only breaks if the enclosing
        // group's do too.
        if self.empty_line == EmptyLine::IfGroupBreaks
            && !matches!(tag, Tag::StartGroup(_) | Tag::StartFill | Tag::StartEntry)
        {
            self.empty_line = EmptyLine::No;
        }
        self.f.write_element(FormatElement::Tag(tag));
    }

    /// Writes a start or end tag that only changes indentation.
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

    /// Prints a `hardline` after `line`, which is the output of another formatter. That formatter only prints trailing
    /// spaces and tabs that must be kept, and a `hardline` would trim them. A line break printed as text doesn't, and
    /// the `hardline` after it then only indents.
    pub(crate) fn hardline_after(&mut self, line: &[u8]) {
        if !matches!(line.last(), Some(b' ' | b'\t')) {
            return self.hardline();
        }
        self.flush();
        self.f.write_text(b"\n", Some(TextWidth::multiline(0)));
        self.f.write_element(FormatElement::Line(LineMode::Hard));
        self.empty_line = EmptyLine::Yes;
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

    /// A keyword or punctuator.
    pub(crate) fn token(&mut self, text: &'static str) {
        self.flush();
        self.empty_line = EmptyLine::No;
        self.f.write_token(text);
    }

    /// `replaceEndOfLine(text)`: each line break in it becomes a `literalline`.
    pub(crate) fn text(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        self.flush();
        self.note_text(text);
        self.f.write_text(text, None);
    }

    /// A string that Prettier prints as is, so a line break in it is just a zero-width character.
    pub(crate) fn string(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        self.flush();
        self.note_text(text);
        super::js::write_string(text, self.f);
    }

    /// Like [`Writer::text`], for whatever `build` appends to its vector.
    pub(crate) fn built_text(&mut self, build: impl FnOnce(&mut Vec<u8>)) {
        let start = self.f.storage.text.len();
        build(&mut self.f.storage.text);
        self.text_built_from(start);
    }

    /// Writes `storage.text[start..]` as one text.
    fn text_built_from(&mut self, start: usize) {
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

    /// Writes the output of another formatter, whose lines get the current indentation. A line break inside one of its
    /// texts is marked as `\r\n`. See `FormatOptions::is_in_markdown`.
    pub(crate) fn printed_text(&mut self, text: &[u8]) {
        let mut rest = text;
        loop {
            // Find the first line break that isn't part of a text.
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
            self.hardline_after(line);
            rest = after;
        }
    }

    // ───────────────────────────── containers ─────────────────────────────

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

    /// `dedent(..)`
    pub(crate) fn start_dedent(&mut self) {
        self.indent_tag(Tag::StartDedent(DedentMode::Level));
        self.indent_level = self.indent_level.map(|level| level.saturating_sub(1));
    }

    pub(crate) fn end_dedent(&mut self) {
        self.indent_tag(Tag::EndDedent(DedentMode::Level));
        self.indent_level = self.indent_level.map(|level| level + 1);
    }

    /// Prettier's `line`, exactly. When it doesn't break it prints a space, even at the start of a line or after
    /// another space, where the `ir` printer would drop it. [`Writer::line`] is enough for HTML, which never has two in
    /// a row or one at the start of a line.
    pub(crate) fn line_or_literal_space(&mut self) {
        self.add_line(LineMode::SoftOrSpace);
        self.pending_spaces += 1;
    }

    /// `lineSuffix(..)`
    pub(crate) fn start_line_suffix(&mut self) {
        self.tag(Tag::StartLineSuffix);
    }

    pub(crate) fn end_line_suffix(&mut self) {
        self.tag(Tag::EndLineSuffix);
    }

    /// `lineSuffixBoundary`
    pub(crate) fn line_suffix_boundary(&mut self) {
        self.flush();
        self.f.write_element(FormatElement::LineSuffixBoundary);
    }

    /// `dedentToRoot(softline)`
    pub(crate) fn softline_dedented_to_root(&mut self) {
        self.indent_tag(Tag::StartDedent(DedentMode::Root));
        self.softline();
        self.indent_tag(Tag::EndDedent(DedentMode::Root));
    }

    /// `indentIfBreak(.., { groupId })`. Pass the returned value to [`Writer::end_indent_if_break`].
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

    /// Starts content that's only printed if the group `group_id` is broken (`is_broken`), or only if it isn't. `None`
    /// means the enclosing group.
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

    // ───────────────────────────── content from other writers ─────────────────────────────

    /// Calls `write` to write content that neither starts nor ends with a line break.
    pub(crate) fn foreign<R>(&mut self, write: impl FnOnce(&mut Formatter<'f>) -> R) -> R {
        self.flush();
        let start = self.f.elements().len();
        let result = write(self.f);
        if self.f.elements().len() > start {
            self.empty_line = EmptyLine::No;
        }
        result
    }

    /// Starts content that may end up being discarded. Pass the returned [`Attempt`] to [`Writer::end_attempt`].
    pub(crate) fn start_attempt(&mut self) -> Attempt {
        self.flush();
        Attempt {
            slot: self.f.start_capture(),
            empty_line: self.empty_line,
            indent_level: self.indent_level,
        }
    }

    /// Marks the start or end of the text region that contains the cursor.
    pub(crate) fn cursor_mark(&mut self, mark: CursorMark) {
        self.flush();
        self.f.write_element(FormatElement::Cursor(mark));
    }

    /// Like [`Writer::start_attempt`], for content that goes after a string that hasn't been written yet.
    pub(crate) fn start_attempt_after_text(&mut self) -> Attempt {
        let attempt = self.start_attempt();
        self.empty_line = EmptyLine::No;
        attempt
    }

    /// Ends the attempt. Its content becomes part of the document if `is_kept`, which is also the return value.
    pub(crate) fn end_attempt(&mut self, attempt: Attempt, is_kept: bool) -> bool {
        match is_kept {
            true => self.flush(),
            false => {
                self.pending_line = None;
                self.pending_spaces = 0;
                self.empty_line = attempt.empty_line;
                self.indent_level = attempt.indent_level;
            }
        }
        let captured = self.f.end_capture(attempt.slot);
        if is_kept && captured.len > 0 {
            self.f.write_element(FormatElement::Interned(captured));
        }
        is_kept
    }

    /// Ends the attempt without adding its content to the document. Returns the content if `is_kept` and it isn't
    /// empty.
    pub(crate) fn end_attempt_as_content(
        &mut self,
        attempt: Attempt,
        is_kept: bool,
    ) -> Option<Interned> {
        match is_kept {
            true => self.flush(),
            false => (self.pending_line, self.pending_spaces) = (None, 0),
        }
        self.empty_line = attempt.empty_line;
        self.indent_level = attempt.indent_level;
        Some(self.f.end_capture(attempt.slot)).filter(|captured| is_kept && captured.len > 0)
    }

    /// Writes any pending line breaks.
    pub(crate) fn finish(mut self) {
        self.flush();
    }
}

/// See [`Writer::start_attempt`].
#[derive(Copy, Clone)]
pub(crate) struct Attempt {
    slot: usize,
    empty_line: EmptyLine,
    indent_level: Option<u32>,
}
