//! The HTML printer's document writer: Prettier's `document/builders`, emitting `ir` elements.
//!
//! Prettier prints every line break, so two in a row make an empty line. The `ir` printer skips a line break when the
//! current line is empty. So this tracks whether anything has been written since the last line break, and emits an
//! explicit empty line where Prettier would print one.
//!
//! For markup in a template of a script that goes the quick way, the document is Prettier's own kind: [`ToQuick`]. There
//! every builder is written as it is. Only what another formatter writes with `ir` elements is translated.

use crate::ir::element::{
    Condition, CursorMark, DedentMode, Group, GroupMode, Interned, LineMode, PrintMode, Text,
    TextWidth,
};
use crate::js::quick_guests::from_doc::{FromDoc, Unwritten};
use crate::js::quick_guests::from_ir::{FromIr, Last};
use crate::prelude::*;
use bun_core::strings;
use bun_format_quick::{self as quick, Detached, Open, Sink};

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

/// Something that has been started in the document of the quick way.
#[derive(Copy, Clone)]
enum Started {
    Group {
        open: Open,
        should_break: bool,
        id: quick::GroupId,
    },
    If {
        open: Open,
        is_broken: bool,
    },
    Fill {
        items: u32,
    },
    LineSuffix(Open),
}

/// Allocations of a [`ToQuick`], reused for the next one.
#[derive(Default)]
pub(crate) struct QuickBuffers {
    started: Vec<Started>,
    /// By [`GroupId::index`]: what a group is called in the other document.
    groups: Vec<quick::GroupId>,
}

/// The document of the quick way, and what has to be known to write to it.
pub(crate) struct ToQuick<'w, 'f> {
    sink: &'w mut Sink<'f>,
    buffers: &'w mut QuickBuffers,
    /// What is printed before the next element, for what is translated from `ir`.
    last: Last,
    has_line_suffix: bool,
    /// See `ends_with_line_suffix`.
    is_line_suffix_waiting: bool,
    /// Why what has been written is of no use.
    unwritten: Option<Unwritten>,
}

impl<'w, 'f> ToQuick<'w, 'f> {
    pub(crate) fn new(sink: &'w mut Sink<'f>, buffers: &'w mut QuickBuffers) -> Self {
        buffers.started.clear();
        buffers.groups.clear();
        ToQuick {
            sink,
            buffers,
            last: Last::Unknown,
            has_line_suffix: false,
            is_line_suffix_waiting: false,
            unwritten: None,
        }
    }

    fn group_id(&mut self, id: Option<GroupId>) -> quick::GroupId {
        let Some(index) = id.map(GroupId::index) else {
            return 0;
        };
        let groups = &mut self.buffers.groups;
        if groups.len() <= index {
            groups.resize(index + 1, 0);
        }
        match groups.get_mut(index) {
            Some(known) => {
                if *known == 0 {
                    *known = self.sink.new_group_id();
                }
                *known
            }
            None => 0,
        }
    }

    fn note_line(&mut self, last: Last) {
        (self.last, self.is_line_suffix_waiting) = (last, false);
    }

    fn note_text(&mut self, text: &[u8]) {
        self.last = match text.ends_with(b"\n") {
            true => Last::Unknown,
            false => Last::Text,
        };
    }

    /// `replaceEndOfLine(text)`
    fn text(&mut self, text: &[u8]) {
        match strings::contains_char(text, b'\n') {
            true => self.sink.lines(text, false),
            false => self.sink.text(text),
        }
        self.note_text(text);
    }

    fn end(&mut self) -> Option<Started> {
        let started = self.buffers.started.pop();
        if started.is_none() {
            self.unwritten = Some(Unwritten::Unknown);
        }
        started
    }
}

/// Content that has been written apart from where it goes.
#[derive(Copy, Clone)]
pub(crate) enum Content {
    Ir(Interned),
    Quick {
        detached: Detached,
        ends_with_line_suffix: bool,
    },
}

pub(crate) struct Writer<'w, 'f> {
    /// The document, or with `quick` what other formatters write to before it's translated.
    pub(crate) f: &'w mut Formatter<'f>,
    quick: Option<ToQuick<'w, 'f>>,
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
            quick: None,
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

    /// The same for a document of the quick way. Other formatters write to `f`, of which nothing is kept.
    pub(crate) fn to_quick(
        f: &'w mut Formatter<'f>,
        quick: ToQuick<'w, 'f>,
        indent_level: Option<u32>,
    ) -> Self {
        Writer {
            quick: Some(quick),
            ..Writer::new(f, indent_level, false)
        }
    }

    /// Why the document of the quick way is of no use, if it is.
    pub(crate) fn unwritten(&self) -> Option<Unwritten> {
        self.quick.as_ref().and_then(|quick| quick.unwritten)
    }

    /// For what has no translation to the document of the quick way. True if that's what is written.
    pub(crate) fn gives_up_quick_way(&mut self) -> bool {
        match &mut self.quick {
            Some(quick) => {
                quick.unwritten = Some(Unwritten::Unknown);
                true
            }
            None => false,
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
            self.f.write_text(
                &b"\n".repeat(count as usize),
                Some(TextWidth::forced_line_breaks()),
            );
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
        if self.quick.is_some() {
            return;
        }
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
        if let Some(quick) = &mut self.quick {
            match tag {
                Tag::StartIndent => quick.sink.indent_open(),
                Tag::StartDedent(DedentMode::Level) => quick.sink.dedent_open(),
                Tag::StartDedent(DedentMode::Root) => quick.sink.dedent_to_root_open(),
                Tag::StartIndentIfGroupBreaks(id) => {
                    let id = quick.group_id(Some(id));
                    quick.sink.indent_if_break_open(id, false);
                }
                _ => quick.sink.indent_close(),
            }
            return;
        }
        self.flush();
        self.f.write_element(FormatElement::Tag(tag));
    }

    pub(crate) fn line(&mut self) {
        if let Some(quick) = &mut self.quick {
            quick.sink.line();
            return quick.note_line(Last::Unknown);
        }
        self.add_line(LineMode::SoftOrSpace);
    }

    pub(crate) fn softline(&mut self) {
        if let Some(quick) = &mut self.quick {
            quick.sink.softline();
            return quick.note_line(Last::Unknown);
        }
        self.add_line(LineMode::Soft);
    }

    pub(crate) fn hardline(&mut self) {
        if let Some(quick) = &mut self.quick {
            quick.sink.hardline();
            return quick.note_line(Last::LineBreak);
        }
        self.add_line(LineMode::Hard);
    }

    /// Prints a `hardline` after `line`, which is the output of another formatter. That formatter only prints trailing
    /// spaces and tabs that must be kept, and a `hardline` would trim them. A line break printed as text doesn't, and
    /// the `hardline` after it then only indents.
    pub(crate) fn hardline_after(&mut self, line: &[u8]) {
        if !matches!(line.last(), Some(b' ' | b'\t')) {
            return self.hardline();
        }
        if let Some(quick) = &mut self.quick {
            // `markAsRoot(literalline)`
            quick.sink.mark_as_root_open();
            quick.sink.literalline();
            quick.sink.indent_close();
            return quick.note_line(Last::LineBreak);
        }
        self.flush();
        self.f.write_text(b"\n", Some(TextWidth::multiline(0)));
        self.f.write_element(FormatElement::Line(LineMode::Hard));
        self.empty_line = EmptyLine::Yes;
    }

    pub(crate) fn break_parent(&mut self) {
        if let Some(quick) = &mut self.quick {
            return quick.sink.break_parent();
        }
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
        if let Some(quick) = &mut self.quick {
            quick.sink.text(text.as_bytes());
            quick.last = Last::Text;
            return;
        }
        self.flush();
        self.empty_line = EmptyLine::No;
        self.f.write_token(text);
    }

    /// `replaceEndOfLine(text)`: each line break in it becomes a `literalline`.
    pub(crate) fn text(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        if let Some(quick) = &mut self.quick {
            return quick.text(text);
        }
        self.flush();
        self.note_text(text);
        self.f.write_text(text, None);
    }

    /// True if a line break comes first, given that the groups around the current place are broken.
    pub(crate) fn is_at_start_of_line(&self) -> bool {
        self.pending_line.is_some()
            || matches!(self.empty_line, EmptyLine::Yes | EmptyLine::IfGroupBreaks)
    }

    /// Like [`Writer::text`], for whole lines between two forced line breaks, so nobody asks how wide they are.
    pub(crate) fn lines(&mut self, text: &[u8]) {
        if let Some(quick) = &mut self.quick {
            return quick.text(text);
        }
        self.flush();
        self.empty_line = EmptyLine::No;
        let width = (strings::contains_char(text, b'\n')).then_some(TextWidth::multiline(0));
        self.f.write_text(text, width);
    }

    /// A string that Prettier prints as is, so a line break in it is just a zero-width character.
    pub(crate) fn string(&mut self, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        if let Some(quick) = &mut self.quick {
            quick.sink.text(text);
            return quick.note_text(text);
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
        if let Some(quick) = &mut self.quick {
            quick.text(text);
            return self.f.storage.text.truncate(start);
        }
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
        if self.quick.is_some() {
            return self.start_group_with(false, None);
        }
        self.tag(Tag::StartGroup(Group::new()));
    }

    pub(crate) fn start_group_with(&mut self, should_break: bool, id: Option<GroupId>) {
        if let Some(quick) = &mut self.quick {
            let started = Started::Group {
                id: quick.group_id(id),
                open: quick.sink.group_open(),
                should_break,
            };
            return quick.buffers.started.push(started);
        }
        let mode = if should_break {
            GroupMode::Expand
        } else {
            GroupMode::Flat
        };
        self.tag(Tag::StartGroup(Group::new().with_id(id).with_mode(mode)));
    }

    pub(crate) fn end_group(&mut self) {
        if let Some(quick) = &mut self.quick {
            match quick.end() {
                Some(Started::Group {
                    open,
                    should_break,
                    id,
                }) => quick.sink.group_close(open, should_break, id),
                _ => quick.unwritten = Some(Unwritten::Unknown),
            }
            return;
        }
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
        if self.quick.is_some() {
            return self.line();
        }
        self.add_line(LineMode::SoftOrSpace);
        self.pending_spaces += 1;
    }

    /// `lineSuffix(..)`
    pub(crate) fn start_line_suffix(&mut self) {
        if let Some(quick) = &mut self.quick {
            let started = Started::LineSuffix(quick.sink.line_suffix_open());
            return quick.buffers.started.push(started);
        }
        self.tag(Tag::StartLineSuffix);
    }

    pub(crate) fn end_line_suffix(&mut self) {
        if let Some(quick) = &mut self.quick {
            match quick.end() {
                Some(Started::LineSuffix(open)) => quick.sink.line_suffix_close(open),
                _ => quick.unwritten = Some(Unwritten::Unknown),
            }
            (quick.has_line_suffix, quick.is_line_suffix_waiting) = (true, true);
            return;
        }
        self.tag(Tag::EndLineSuffix);
    }

    /// `lineSuffixBoundary`
    pub(crate) fn line_suffix_boundary(&mut self) {
        if let Some(quick) = &mut self.quick {
            quick.sink.line_suffix_boundary();
            return quick.note_line(Last::Unknown);
        }
        self.flush();
        self.f.write_element(FormatElement::LineSuffixBoundary);
    }

    /// See [`own_line_suffix_boundary`].
    pub(crate) fn own_line_suffix_boundary(&mut self) {
        if self.quick.is_some() {
            return self.line_suffix_boundary();
        }
        self.flush();
        own_line_suffix_boundary().fmt(self.f);
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
        if let Some(quick) = &mut self.quick {
            quick.sink.fill_open();
            return quick.buffers.started.push(Started::Fill { items: 0 });
        }
        self.tag(Tag::StartFill);
    }

    pub(crate) fn end_fill(&mut self) {
        if let Some(quick) = &mut self.quick {
            match quick.end() {
                Some(Started::Fill { .. }) => quick.sink.fill_close(),
                _ => quick.unwritten = Some(Unwritten::Unknown),
            }
            return;
        }
        self.tag(Tag::EndFill);
    }

    pub(crate) fn start_item(&mut self) {
        if let Some(quick) = &mut self.quick {
            match quick.buffers.started.last_mut() {
                Some(Started::Fill { items }) => {
                    *items += 1;
                    match *items % 2 {
                        1 => quick.sink.fill_item(),
                        _ => quick.sink.fill_separator(),
                    }
                }
                _ => quick.unwritten = Some(Unwritten::Unknown),
            }
            return;
        }
        self.tag(Tag::StartEntry);
    }

    pub(crate) fn end_item(&mut self) {
        if self.quick.is_some() {
            return;
        }
        self.tag(Tag::EndEntry);
    }

    /// Starts content that's only printed if the group `group_id` is broken (`is_broken`), or only if it isn't. `None`
    /// means the enclosing group.
    pub(crate) fn start_if(&mut self, is_broken: bool, group_id: Option<GroupId>) {
        if let Some(quick) = &mut self.quick {
            let id = quick.group_id(group_id);
            let open = quick.sink.if_break_open(id);
            if !is_broken {
                quick.sink.if_break_else(open);
            }
            return quick.buffers.started.push(Started::If { open, is_broken });
        }
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
        if let Some(quick) = &mut self.quick {
            match quick.end() {
                Some(Started::If { open, is_broken }) => {
                    if is_broken {
                        quick.sink.if_break_else(open);
                    }
                    quick.sink.if_break_close(open);
                }
                _ => quick.unwritten = Some(Unwritten::Unknown),
            }
            quick.last = Last::Unknown;
            return;
        }
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
        match self.quick.is_some() {
            true => self.translate_from(start),
            false if self.f.elements().len() > start => self.empty_line = EmptyLine::No,
            false => {}
        }
        result
    }

    /// Hands the elements from `start` on to the quick way. One copy for every `foreign`.
    #[inline(never)]
    fn translate_from(&mut self, start: usize) {
        let Some(quick) = &mut self.quick else {
            return;
        };
        let elements = self.f.storage.pool.get(start..).unwrap_or_default();
        if elements.is_empty() {
            return;
        }
        quick.is_line_suffix_waiting =
            super::map_strings::is_line_suffix_waiting(elements, quick.is_line_suffix_waiting);
        let translation = FromIr::new(
            quick.sink,
            &self.f.storage,
            self.f.source_text().as_bytes(),
            &mut quick.buffers.groups,
            quick.last,
            quick.has_line_suffix,
        );
        match translation.write(elements) {
            Ok((last, has_line_suffix)) => {
                (quick.last, quick.has_line_suffix) = (last, has_line_suffix)
            }
            Err(unwritten) => quick.unwritten = Some(unwritten),
        }
    }

    /// Writes a style sheet's `document`.
    pub(crate) fn style_sheet(&mut self, document: &crate::css::doc::Doc<'_>) {
        let Some(quick) = &mut self.quick else {
            return self.foreign(|f| crate::css::embed::write_document(document, f));
        };
        if let Err(unwritten) = FromDoc::new(quick.sink).write_document(document) {
            quick.unwritten = Some(unwritten);
        }
        quick.last = Last::Unknown;
    }

    /// `[line, "", line]`. When Prettier measures whether something fits, the two count as a single space.
    pub(crate) fn two_lines(&mut self) {
        if self.quick.is_some() {
            self.line();
            return self.line();
        }
        self.start_if(false, None);
        self.foreign(|f| f.write_text(b"  ", Some(TextWidth::single(1))));
        self.end_if();
        self.softline();
        self.softline();
    }

    /// Starts content that may end up being discarded. Pass the returned [`Attempt`] to [`Writer::end_attempt`].
    pub(crate) fn start_attempt(&mut self) -> Attempt {
        self.flush();
        let quick = self.quick.as_mut().map(|quick| QuickAttempt {
            mark: quick.sink.checkpoint(),
            detached: None,
            started: quick.buffers.started.len(),
            last: quick.last,
            is_line_suffix_waiting: quick.is_line_suffix_waiting,
        });
        Attempt {
            slot: match quick {
                Some(_) => 0,
                None => self.f.start_capture(),
            },
            empty_line: self.empty_line,
            indent_level: self.indent_level,
            quick,
        }
    }

    /// Starts the value of an attribute, which goes between double quotes behind a name that hasn't been written yet.
    /// Pass the returned [`Attempt`] to [`Writer::end_attribute_value`].
    pub(crate) fn start_attribute_value(&mut self) -> Attempt {
        let mut attempt = self.start_attempt_after_text();
        if let (Some(quick), Some(it)) = (&mut self.quick, &mut attempt.quick) {
            it.detached = Some(quick.sink.detach_open());
            quick.sink.quote_entities_open();
            (quick.last, quick.is_line_suffix_waiting) = (Last::Text, false);
        }
        attempt
    }

    /// Returns the value if `is_kept` and it isn't empty.
    pub(crate) fn end_attribute_value(
        &mut self,
        attempt: Attempt,
        is_kept: bool,
    ) -> Option<Content> {
        let (Some(quick), Some(it)) = (&mut self.quick, attempt.quick) else {
            return self
                .end_attempt_as_content(attempt, is_kept)
                .map(Content::Ir);
        };
        quick.sink.quote_entities_close();
        let ends_with_line_suffix = quick.is_line_suffix_waiting;
        (quick.last, quick.is_line_suffix_waiting) = (it.last, it.is_line_suffix_waiting);
        self.indent_level = attempt.indent_level;
        let detached = it.detached.filter(|_| is_kept);
        let Some(detached) = detached.map(|open| quick.sink.detach_close(open)) else {
            quick.sink.rollback(it.mark);
            quick.buffers.started.truncate(it.started);
            return None;
        };
        quick.sink.commit(it.mark);
        (!quick.sink.is_empty(detached)).then_some(Content::Quick {
            detached,
            ends_with_line_suffix,
        })
    }

    /// True if a line-suffix comment in `value` is still pending where `value` ends.
    pub(crate) fn ends_with_line_suffix(&self, value: Content) -> bool {
        match value {
            Content::Ir(value) => super::map_strings::ends_with_line_suffix(value, self.f),
            Content::Quick {
                ends_with_line_suffix,
                ..
            } => ends_with_line_suffix,
        }
    }

    /// Writes what [`Writer::end_attribute_value`] has returned, with `&quot;` for `"`.
    pub(crate) fn attribute_value(&mut self, value: Content) {
        match (value, &mut self.quick) {
            (Content::Ir(value), _) => {
                self.foreign(|f| super::js::write_with_quote_entities(value, f))
            }
            (Content::Quick { detached, .. }, Some(quick)) => {
                quick.sink.call(detached);
                quick.last = Last::Unknown;
            }
            (Content::Quick { .. }, None) => {}
        }
    }

    /// Marks the start or end of the text region that contains the cursor.
    pub(crate) fn cursor_mark(&mut self, mark: CursorMark) {
        if self.gives_up_quick_way() {
            return;
        }
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
        if let (Some(quick), Some(it)) = (&mut self.quick, attempt.quick) {
            match is_kept {
                true => quick.sink.commit(it.mark),
                false => {
                    quick.sink.rollback(it.mark);
                    quick.buffers.started.truncate(it.started);
                    (quick.last, quick.is_line_suffix_waiting) =
                        (it.last, it.is_line_suffix_waiting);
                    self.indent_level = attempt.indent_level;
                }
            }
            return is_kept;
        }
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
    quick: Option<QuickAttempt>,
}

/// What an [`Attempt`] goes back to in the document of the quick way.
#[derive(Copy, Clone)]
struct QuickAttempt {
    mark: Open,
    /// The content is written apart from where it goes.
    detached: Option<Open>,
    /// The length of `QuickBuffers::started`.
    started: usize,
    last: Last,
    is_line_suffix_waiting: bool,
}
