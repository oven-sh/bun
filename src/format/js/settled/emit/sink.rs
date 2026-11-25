//! Where the rules write to: a document, or straight onto the source, which is compared with what would be printed.

use super::follow::Pending;
use super::*;

const NO_BREAK: u32 = u32::MAX;

/// The state of a comparison.
#[derive(Copy, Clone)]
pub(super) struct Flat {
    pub(super) is_on: bool,
    pub(super) matches: bool,
    pub(super) pending: Pending,
    pub(super) has_group: bool,
    /// The source can have line breaks. See `follow.rs`.
    pub(super) is_following: bool,
    /// A line break that only depends on the mode has been written.
    pub(super) has_line: bool,
    /// Nothing depends on what's in the nodes that are certain to be printed as they are.
    pub(super) skips: bool,
    pub(super) cursor: u32,
    /// The number of open groups.
    pub(super) depth: u32,
    /// The groups that are at least this deep are flat.
    pub(super) flat_from: u32,
    /// No line break can be printed before this offset.
    pub(super) first_break: u32,
    /// Groups from this index on started during the comparison.
    #[cfg_attr(mordant, allow(field_valid_only_when))]
    pub(super) first_group: usize,
}

impl Flat {
    fn leave_unbreakable(&mut self, before: &Flat) {
        (self.depth, self.flat_from) = (before.depth, before.flat_from);
        (self.first_break, self.has_line) = (before.first_break, before.has_line);
    }

    /// `text`: what has been compared, which is at `start`
    pub(super) fn can_stand_in(&self, start: u32, text: &[u8]) -> bool {
        self.matches
            && self.first_break != start
            && self.first_break != start + text.len() as u32
            && !bun_core::strings::contains_char(text, b'\t')
    }

    pub(super) const OFF: Flat = Flat {
        is_on: false,
        matches: true,
        pending: Pending::Nothing,
        has_group: false,
        is_following: false,
        has_line: false,
        skips: false,
        cursor: 0,
        depth: 0,
        flat_from: u32::MAX,
        first_break: NO_BREAK,
        first_group: 0,
    };
}

impl<'a> Emitter<'a, '_> {
    /// True if a group that starts here is flat, and is compared with the source.
    #[inline]
    pub(super) fn is_flat(&self) -> bool {
        self.flat.depth + 1 >= self.flat.flat_from
    }

    #[inline]
    fn is_in_flat_group(&self) -> bool {
        self.flat.depth >= self.flat.flat_from
    }

    /// Calls `write` to compare what it writes with `start..end`, which is on one line. Returns the final state.
    #[inline]
    pub(super) fn compare(&mut self, start: u32, end: u32, write: impl FnOnce(&mut Self)) -> Flat {
        self.flat = Flat {
            is_on: true,
            cursor: start,
            flat_from: 1,
            first_group: self.f.group_id("").index(),
            ..Flat::OFF
        };
        write(self);
        let mut flat = std::mem::replace(&mut self.flat, Flat::OFF);
        flat.matches &= flat.cursor == end && flat.pending == Pending::Nothing;
        flat
    }

    /// Writes a stand-in for `start..end`, which `flat` found to match. It's as wide on one line, and it can break no
    /// later. If it does break, the output differs from the source.
    pub(super) fn write_stand_in(&mut self, start: u32, end: u32, flat: Flat) {
        if flat.has_group {
            self.has_group = true;
            self.tag(Tag::StartGroup(Group::new()));
        }
        if flat.first_break < end {
            self.f.write_source_line(Span::new(start, flat.first_break));
            self.f.write_element(FormatElement::Line(LineMode::Soft));
            self.f.write_source_line(Span::new(flat.first_break, end));
        } else {
            self.f.write_source_line(Span::new(start, end));
        }
        if flat.has_group {
            self.tag(Tag::EndGroup);
        }
    }

    #[inline]
    pub(super) fn tag(&mut self, tag: Tag) {
        self.f.write_element(FormatElement::Tag(tag));
    }

    /// What's being written can't be on one line.
    #[inline]
    pub(super) fn not_flat(&mut self) {
        self.flat.matches = false;
    }

    #[inline(always)]
    fn take_pending(&mut self) {
        match self.flat.pending {
            Pending::Nothing => {}
            Pending::Space => {
                self.flat.pending = Pending::Nothing;
                self.flat.matches &= self.src.get(self.flat.cursor as usize) == Some(&b' ');
                self.flat.cursor += 1;
            }
            Pending::Indentation => self.take_indentation(),
        }
    }

    #[inline(always)]
    fn compare_bytes(&mut self, text: &[u8]) {
        self.take_pending();
        let start = self.flat.cursor as usize;
        self.flat.matches &= self.src.get(start..start + text.len()) == Some(text);
        self.flat.cursor += text.len() as u32;
    }

    #[inline(never)]
    fn write_token(&mut self, token: &'static str) {
        self.f.write_token(token);
    }

    #[inline(always)]
    pub(super) fn token(&mut self, token: &'static str) {
        match self.flat.is_on {
            true => self.compare_bytes(token.as_bytes()),
            false => self.write_token(token),
        }
    }

    /// Makes the printer print the pending indentation.
    pub(super) fn empty_token(&mut self) {
        match self.flat.is_on {
            true => self.flat.matches &= self.flat.pending != Pending::Indentation,
            false => self.write_token(""),
        }
    }

    #[inline(always)]
    pub(super) fn token_if(&mut self, condition: bool, token: &'static str) {
        if condition {
            self.token(token);
        }
    }

    /// `word` and a space
    #[inline(always)]
    pub(super) fn keyword(&mut self, word: &'static str) {
        self.token(word);
        self.space();
    }

    #[inline(always)]
    pub(super) fn keyword_if(&mut self, condition: bool, word: &'static str) {
        if condition {
            self.keyword(word);
        }
    }

    /// A token without a line break or tab.
    #[inline]
    pub(super) fn source(&mut self, start: u32, end: u32) {
        if self.flat.is_on {
            self.take_pending();
            self.flat.matches &= self.flat.cursor == start;
            self.flat.cursor = end;
        } else {
            self.f.write_source_line(Span::new(start, end));
        }
    }

    #[inline]
    pub(super) fn source_of(&mut self, id: Id) {
        let node = self.node(id);
        self.source(node.start, node.end);
    }

    /// Like [`Emitter::source`], for a token that may have characters that aren't ASCII.
    #[inline]
    pub(super) fn wide_source(&mut self, start: u32, end: u32) {
        self.source(start, end);
        if self.flat.is_following && !self.is_ascii {
            self.note_width(self.slice(start, end));
        }
    }

    /// Any text.
    pub(super) fn text(&mut self, text: &[u8]) {
        if !self.flat.is_on {
            return self.f.write_text(text, None);
        }
        self.compare_bytes(text);
        if self.flat.is_following {
            self.followed_text(text);
        }
    }

    #[inline]
    pub(super) fn space(&mut self) {
        if !self.flat.is_on {
            self.f.write_element(FormatElement::Space);
        } else if self.flat.pending == Pending::Nothing {
            self.flat.pending = Pending::Space;
        }
    }

    /// A layout that isn't written during a comparison has a line break here.
    #[inline]
    pub(super) fn may_break(&mut self) {
        self.flat.first_break = self.flat.first_break.min(self.flat.cursor);
        self.flat.matches &= self.flat.depth > 0 || self.flat.is_following;
        if self.follow.is_waiting {
            self.stop_measuring(false);
        }
    }

    /// At the start of a group, before what's only printed if it's flat. A measurement takes it to be expanded.
    pub(super) fn may_break_unless_flat(&mut self) {
        if self.flat.is_on && self.follow.is_waiting {
            self.stop_measuring(false);
        }
    }

    /// During a comparison, for content whose soft line breaks are removed.
    pub(super) fn unbreakable(&mut self, write: impl FnOnce(&mut Self)) {
        let before = self.flat;
        let is_waiting = std::mem::take(&mut self.follow.is_waiting);
        self.flat.depth += 1;
        self.flat.flat_from = before.flat_from.min(self.flat.depth);
        write(self);
        self.follow.is_waiting = is_waiting;
        self.flat.leave_unbreakable(&before);
    }

    #[inline]
    fn flat_line(&mut self, mode: LineMode) {
        if !self.is_in_flat_group() {
            return self.follow_line(mode);
        }
        self.may_break();
        self.flat.has_line = true;
        match mode {
            LineMode::Soft | LineMode::SoftEmpty => {}
            LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty => self.space(),
            LineMode::Hard | LineMode::Empty => self.not_flat(),
        }
    }

    #[inline]
    pub(super) fn line_of(&mut self, mode: LineMode) {
        match self.flat.is_on {
            true => self.flat_line(mode),
            false => self.f.write_element(FormatElement::Line(mode)),
        }
    }

    #[inline]
    pub(super) fn line(&mut self) {
        self.line_of(LineMode::SoftOrSpace);
    }

    #[inline]
    pub(super) fn soft_line(&mut self) {
        self.line_of(LineMode::Soft);
    }

    #[inline]
    pub(super) fn hard_line(&mut self) {
        self.line_of(LineMode::Hard);
    }

    pub(super) fn expand_parent(&mut self) {
        match self.flat.is_on {
            true => self.force_break(),
            false => self.f.write_element(FormatElement::ExpandParent),
        }
    }

    #[inline]
    pub(super) fn boundary(&mut self) {
        if !self.flat.is_on {
            self.f.write_element(FormatElement::LineSuffixBoundary);
        }
    }

    pub(super) fn group_id(&mut self) -> GroupId {
        self.f.group_id("")
    }

    #[inline]
    pub(super) fn start_group_of(&mut self, mode: GroupMode, id: Option<GroupId>) {
        if self.flat.is_on {
            self.flat.depth += 1;
            self.flat.has_group = true;
            match self.is_in_flat_group() {
                true => self.flat.matches &= mode.is_flat(),
                false => self.open_group(mode, id),
            }
        } else {
            self.has_group = true;
            self.tag(Tag::StartGroup(Group::new().with_id(id).with_mode(mode)));
        }
    }

    #[inline]
    pub(super) fn start_group(&mut self) {
        self.start_group_of(GroupMode::Flat, None);
    }

    #[inline]
    pub(super) fn end_group(&mut self) {
        if !self.flat.is_on {
            return self.tag(Tag::EndGroup);
        }
        if self.flat.depth as usize == self.follow.open.len() {
            self.close_group();
        }
        self.flat.depth -= 1;
    }

    #[inline]
    pub(super) fn group(&mut self, write: impl FnOnce(&mut Self)) {
        self.start_group();
        write(self);
        self.end_group();
    }

    #[inline]
    pub(super) fn group_if(&mut self, condition: bool, write: impl FnOnce(&mut Self)) {
        if condition {
            self.start_group();
        }
        write(self);
        if condition {
            self.end_group();
        }
    }

    #[inline]
    pub(super) fn group_with(
        &mut self,
        should_expand: bool,
        id: Option<GroupId>,
        write: impl FnOnce(&mut Self),
    ) {
        let mode = if should_expand {
            GroupMode::Expand
        } else {
            GroupMode::Flat
        };
        self.start_group_of(mode, id);
        write(self);
        self.end_group();
    }

    /// `group(indent(line), { id })`
    pub(super) fn indented_line_group(&mut self, id: GroupId) {
        if self.flat.is_on {
            self.group_with(false, Some(id), |e| e.indent(Self::line));
        } else {
            self.f.write_element(FormatElement::IndentedLineGroup(id));
        }
    }

    #[inline]
    fn tagged(&mut self, start: Tag, end: Tag, write: impl FnOnce(&mut Self)) {
        if !self.flat.is_on {
            self.tag(start);
        }
        write(self);
        if !self.flat.is_on {
            self.tag(end);
        }
    }

    #[inline]
    pub(super) fn indent(&mut self, write: impl FnOnce(&mut Self)) {
        let before = self.follow.indent();
        self.tagged(Tag::StartIndent, Tag::EndIndent, write);
        self.follow.indentation = before;
    }

    #[inline]
    pub(super) fn indent_if(&mut self, condition: bool, write: impl FnOnce(&mut Self)) {
        match condition {
            true => self.indent(write),
            false => write(self),
        }
    }

    pub(super) fn dedent(&mut self, mode: DedentMode, write: impl FnOnce(&mut Self)) {
        let before = self.follow.dedent();
        self.flat.matches &= !self.flat.is_following || mode == DedentMode::Level;
        self.tagged(Tag::StartDedent(mode), Tag::EndDedent(mode), write);
        self.follow.indentation = before;
    }

    pub(super) fn align(&mut self, count: u32, write: impl FnOnce(&mut Self)) {
        match count {
            0 => write(self),
            _ => {
                let before = self.follow.align(count);
                self.tagged(Tag::StartAlign(Align(count)), Tag::EndAlign, write);
                self.follow.indentation = before;
            }
        }
    }

    pub(super) fn member_chain_label(&mut self, write: impl FnOnce(&mut Self)) {
        let label = LabelId::of(JsLabels::MemberChain);
        self.tagged(Tag::StartLabelled(label), Tag::EndLabelled, write);
    }

    pub(super) fn indent_if_group_breaks(&mut self, id: GroupId, write: impl FnOnce(&mut Self)) {
        if self.flat.is_on {
            return self.indent_if(self.follow.is_expanded(id), write);
        }
        let (start, end) = (
            Tag::StartIndentIfGroupBreaks(id),
            Tag::EndIndentIfGroupBreaks(id),
        );
        self.tagged(start, end, write);
    }

    /// During a comparison, the caller has to call `write` itself, at the end of the line.
    pub(super) fn line_suffix(&mut self, write: impl FnOnce(&mut Self)) {
        if !self.flat.is_on {
            self.tagged(Tag::StartLineSuffix, Tag::EndLineSuffix, write);
        }
    }

    #[inline]
    fn indent_between(
        &mut self,
        before: LineMode,
        after: Option<LineMode>,
        write: impl FnOnce(&mut Self),
    ) {
        let indentation = self.follow.indent();
        match self.flat.is_on {
            true => self.flat_line(before),
            false => self.tag(Tag::StartIndentWithLine(before)),
        }
        write(self);
        self.follow.indentation = indentation;
        self.end_indent(after);
    }

    #[inline]
    fn end_indent(&mut self, after: Option<LineMode>) {
        match (self.flat.is_on, after) {
            (true, Some(after)) => self.flat_line(after),
            (true, None) => {}
            (false, Some(after)) => self.tag(Tag::EndIndentWithLine(after)),
            (false, None) => self.tag(Tag::EndIndent),
        }
    }

    #[inline]
    pub(super) fn block_indent(&mut self, write: impl FnOnce(&mut Self)) {
        match self.flat.is_on && (self.is_in_flat_group() || !self.flat.is_following) {
            true => self.not_flat(),
            false => self.indent_between(LineMode::Hard, Some(LineMode::Hard), write),
        }
    }

    #[inline]
    pub(super) fn soft_block_indent(&mut self, write: impl FnOnce(&mut Self)) {
        self.indent_between(LineMode::Soft, Some(LineMode::Soft), write);
    }

    #[inline]
    pub(super) fn soft_block_indent_with_space(
        &mut self,
        has_space: bool,
        write: impl FnOnce(&mut Self),
    ) {
        let mode = if has_space {
            LineMode::SoftOrSpace
        } else {
            LineMode::Soft
        };
        self.indent_between(mode, Some(mode), write);
    }

    #[inline]
    pub(super) fn soft_line_indent_or_space(&mut self, write: impl FnOnce(&mut Self)) {
        self.indent_between(LineMode::SoftOrSpace, None, write);
    }

    #[inline]
    pub(super) fn token_if_breaks(&mut self, token: &'static str) {
        if !self.flat.is_on {
            if_group_breaks(&token).fmt(self.f);
        } else if !self.is_in_flat_group() && self.is_expanded(token) {
            self.only_if_expanded(|e| e.token(token));
        } else if self.follow.is_waiting {
            self.flat.matches &= !self.follow.is_measuring_as_expanded();
        }
    }

    pub(super) fn token_if_fits(&mut self, token: &'static str) {
        if !self.flat.is_on {
            return if_group_fits_on_line(&token).fmt(self.f);
        }
        self.flat.first_break = self.flat.first_break.min(self.flat.cursor);
        match !self.is_in_flat_group() && self.is_expanded("") {
            true => self.only_if_flat(token.len() as u32),
            false => {
                if self.follow.is_waiting {
                    self.flat.matches &= !self.follow.is_measuring_as_expanded();
                }
                self.token(token);
            }
        }
    }

    fn conditional(&mut self, mode: PrintMode, id: Option<GroupId>, write: impl FnOnce(&mut Self)) {
        if !self.flat.is_on {
            let condition = Condition::new(mode).with_group_id(id);
            let start = Tag::StartConditionalContent(condition);
            return self.tagged(start, Tag::EndConditionalContent, write);
        }
        match (mode, self.is_condition_expanded(id)) {
            (PrintMode::Flat, false) => write(self),
            (PrintMode::Expanded, true) => self.only_if_expanded(write),
            _ => {}
        }
    }

    fn is_condition_expanded(&mut self, id: Option<GroupId>) -> bool {
        self.flat.first_break = self.flat.first_break.min(self.flat.cursor);
        let is_expanded = match id {
            Some(id) => {
                self.flat.matches &= self.flat.is_following || id.index() > self.flat.first_group;
                self.follow.is_expanded(id)
            }
            None => !self.is_in_flat_group() && self.is_expanded("("),
        };
        // To a measurement that started before it, a group is expanded.
        self.flat.matches &= is_expanded || id.is_some() || !self.follow.is_waiting;
        is_expanded
    }

    pub(super) fn if_breaks(&mut self, id: Option<GroupId>, write: impl FnOnce(&mut Self)) {
        self.conditional(PrintMode::Expanded, id, write);
    }

    pub(super) fn if_fits(&mut self, id: Option<GroupId>, write: impl FnOnce(&mut Self)) {
        self.conditional(PrintMode::Flat, id, write);
    }

    pub(super) fn start_fill(&mut self) {
        if !self.flat.is_on {
            self.tag(Tag::StartFill);
        }
    }

    pub(super) fn end_fill(&mut self) {
        if !self.flat.is_on {
            self.tag(Tag::EndFill);
        }
    }

    pub(super) fn entry(&mut self, write: impl FnOnce(&mut Self)) {
        self.tagged(Tag::StartEntry, Tag::EndEntry, write);
    }

    // The rest is only for writing a document.

    pub(super) fn capture(&mut self, write: impl FnOnce(&mut Self)) -> Interned {
        debug_assert!(!self.flat.is_on);
        let slot = self.f.start_capture();
        write(self);
        self.f.end_capture(slot)
    }

    pub(super) fn intern(&mut self, write: impl FnOnce(&mut Self)) -> Option<FormatElement> {
        debug_assert!(!self.flat.is_on);
        let slot = self.f.start_capture();
        write(self);
        self.f.end_intern(slot)
    }

    pub(super) fn group_from(&mut self, reserved: usize, should_expand: bool) {
        self.has_group = true;
        self.f.group_from(reserved, should_expand);
    }

    pub(super) fn element(&mut self, element: Option<FormatElement>) {
        if let Some(element) = element {
            self.f.write_element(element);
        }
    }

    /// Like a `Memoized`.
    pub(super) fn captured(&mut self, content: Interned) {
        match *self.f.storage.interned(content) {
            [] => {}
            [one] => self.f.write_element(one),
            _ => self.f.write_element(FormatElement::Interned(content)),
        }
    }

    pub(super) fn will_break(&self, content: Interned) -> bool {
        self.f.interned(content).will_break()
    }

    pub(super) fn variant(&mut self, write: impl FnOnce(&mut Self)) -> Interned {
        self.capture(|e| e.entry(write))
    }

    pub(super) fn best_fitting(&mut self, variants: &[Interned], fallback: Fallback) {
        let element = self.f.best_fitting_with(variants, fallback);
        self.f.write_element(element);
    }

    pub(super) fn without_soft_lines(&mut self, content: Interned) {
        let content = format_with(|f| f.write_element(FormatElement::Interned(content)));
        self.f.write_without_soft_lines(&content);
    }
}
