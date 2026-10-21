//! Computes what the printer needs to know about a document before printing it: which groups contain a forced line
//! break, and how wide the other groups are on one line.
//!
//! A [`Tracker`] works that out from the elements in the order they're written. The `Formatter` feeds it each element
//! as it writes it, so no extra pass is needed once the document is finished. [`propagate_expand`] does the same for a
//! document that was written without a `Formatter`.

use super::element::{
    Flat, FlatFlags, FormatElement, GroupMode, Interned, LineMode, PrintMode, Tag,
};
use super::formatter::Storage;

#[derive(Copy, Clone, PartialEq, Eq)]
enum FrameKind {
    Group,
    /// A reserved slot that may become a group's start tag. See `Formatter::reserve_tag`.
    Reserved,
    /// The content that a [`FormatElement::Skip`] skips.
    Skipped,
    /// Content that's only printed if the enclosing group is flat.
    IfFlat,
    /// Content that isn't printed when the enclosing content is flat.
    IfExpanded,
    /// Content where only the printer knows whether, or where, it's printed.
    Unknown,
}

/// A construct that's open at the current element.
#[derive(Copy, Clone)]
struct Frame {
    kind: FrameKind,
    /// [`FlatFlags::STARTS_WITH_LINE`], [`FlatFlags::STARTS_WITH_SPACE`]
    start_flags: FlatFlags,
    /// The index of its first element: the start tag or the [`FormatElement::Skip`].
    start: u32,
    /// [`State::width`] at the start of the first text in it. [`NO_TEXT`] until there is one.
    first_text: u32,
}

const NO_TEXT: u32 = u32::MAX;

/// Running totals for everything seen so far, as if printed on one line. Each `last_*` field is the index where
/// something was last seen, so a frame contains it if that index is after the frame's start. Index 0 is never part of a
/// document.
#[derive(Copy, Clone, Default)]
struct State {
    /// Total columns of all texts and the spaces between them. Wraps around on overflow.
    width: u32,
    /// A space will be printed before the next text.
    is_space_pending: bool,
    /// A [`FormatElement::Space`] has been seen since the last text.
    is_space_element_pending: bool,
    is_in_line_suffix: bool,
    /// Frames from this index on have no text yet.
    first_frame_without_text: u32,
    /// Something that forces the enclosing groups to break.
    last_break: u32,
    /// Something that makes `Storage::will_break` true.
    last_will_break: u32,
    /// Something that keeps the enclosing groups from being [`FlatFlags::MEASURED`].
    last_unknown: u32,
    last_boundary: u32,
    last_line: u32,
    last_space: u32,
    last_group_id: u32,
}

#[derive(Default)]
pub(crate) struct Tracker {
    state: State,
    frames: Vec<Frame>,
    /// The state saved before each frame whose content is measured separately from the enclosing content.
    saved: Vec<State>,
}

pub(crate) type PropagateBuffers = Tracker;

/// Prettier's `propagateBreaks`. Marks every group that contains a hard line break, a multiline text or a
/// [`FormatElement::ExpandParent`] as expanded. The variants of a [`FormatElement::BestFitting`] don't expand the
/// enclosing groups.
///
/// It also measures the remaining groups and interned content. See [`Flat`].
///
/// This is a single loop over the elements. Interned content comes before every element that refers to it, so its
/// [`FormatElement::Skip`] already has its summary by then.
pub(crate) fn propagate_expand(root: Interned, storage: &mut Storage, tracker: &mut Tracker) {
    tracker.clear();
    // The ends of the enclosing skipped contents, innermost last.
    let mut ends = Vec::new();
    let mut end = root
        .start
        .saturating_add(root.len)
        .min(storage.pool.len() as u32);
    let mut index = root.start;
    loop {
        while index < end {
            let Some(&element) = storage.pool.get(index as usize) else {
                return;
            };
            match element {
                FormatElement::Skip(skip) => {
                    tracker.start_skipped(index);
                    ends.push(end);
                    end = index.saturating_add(skip.len).saturating_add(1).min(end);
                }
                _ => tracker.note(element, index, storage),
            }
            index += 1;
        }
        let Some(outer_end) = ends.pop() else {
            return;
        };
        end = outer_end;
        if let Some((start, flat, will_break)) = tracker.end_skipped()
            && let Some(FormatElement::Skip(skip)) = storage.pool.get_mut(start as usize)
        {
            (skip.flat, skip.will_break) = (flat, will_break);
        }
    }
}

impl Tracker {
    pub(crate) fn clear(&mut self) {
        self.state = State::default();
        self.frames.clear();
        self.saved.clear();
    }

    /// Records `element`, which was written at `index`. It must not be a [`FormatElement::Skip`].
    #[inline(always)]
    pub(crate) fn note(&mut self, element: FormatElement, index: u32, storage: &mut Storage) {
        match element {
            FormatElement::Token(token) => self.text(token.len() as u32, index),
            FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                if text.width.is_multiline() && !text.width.is_one_string() {
                    self.forced_break(index);
                }
                self.text(text.width.value(), index);
            }
            FormatElement::Space => {
                self.state.last_space = index;
                self.state.is_space_pending = true;
                self.state.is_space_element_pending = true;
            }
            // These print nothing when the enclosing content is flat.
            FormatElement::TokenIfBreaks(_) | FormatElement::Nop | FormatElement::Cursor(_) => {}
            FormatElement::Line(mode) => self.line(mode, index),
            FormatElement::IndentedLineGroup(_) => {
                self.line(LineMode::SoftOrSpace, index);
                self.state.last_group_id = index;
            }
            FormatElement::ExpandParent => self.forced_break(index),
            FormatElement::LineSuffixBoundary => self.state.last_boundary = index,
            FormatElement::Skip(_) => self.state.last_unknown = index,
            FormatElement::Interned(interned) => self.interned(interned, index, storage),
            FormatElement::BestFitting(best_fitting) => {
                self.best_fitting(best_fitting.first, index, storage)
            }
            FormatElement::Tag(tag) => match tag {
                Tag::StartGroup(group) => {
                    if group.mode() == GroupMode::Expand && !self.state.is_in_line_suffix {
                        self.state.last_will_break = index;
                    }
                    self.open(FrameKind::Group, index);
                }
                Tag::EndGroup => self.end_group(index, storage),
                Tag::StartConditionalContent(condition) => {
                    match (condition.group_id, condition.mode) {
                        (Some(_), _) => self.open_isolated(FrameKind::Unknown, index),
                        (None, PrintMode::Expanded) => {
                            self.open_isolated(FrameKind::IfExpanded, index)
                        }
                        (None, PrintMode::Flat) => self.open(FrameKind::IfFlat, index),
                    }
                }
                Tag::StartLineSuffix => {
                    self.open_isolated(FrameKind::Unknown, index);
                    self.state.is_in_line_suffix = true;
                }
                Tag::EndConditionalContent | Tag::EndLineSuffix => self.end_content(index),
                Tag::StartIndentWithLine(mode) | Tag::EndIndentWithLine(mode) => {
                    self.line(mode, index)
                }
                // These only affect indentation, or nothing at all.
                Tag::StartIndent
                | Tag::EndIndent
                | Tag::StartAlign(_)
                | Tag::EndAlign
                | Tag::StartDedent(_)
                | Tag::EndDedent(_)
                | Tag::StartIndentIfGroupBreaks(_)
                | Tag::EndIndentIfGroupBreaks(_)
                | Tag::StartFill
                | Tag::EndFill
                | Tag::StartEntry
                | Tag::EndEntry
                | Tag::StartLabelled(_)
                | Tag::EndLabelled => {}
            },
        }
    }

    /// True if `Storage::will_break` is true for the elements written from `start` on. `start` must be inside the
    /// capture that's currently being written.
    #[inline]
    pub(crate) fn will_break_from(&self, start: usize) -> bool {
        self.state.last_will_break as usize >= start
    }

    #[inline(always)]
    fn line(&mut self, mode: LineMode, index: u32) {
        match mode {
            LineMode::Soft | LineMode::SoftEmpty => {}
            LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty => {
                self.state.last_line = index;
                self.state.is_space_pending = true;
            }
            LineMode::Hard | LineMode::Empty => {
                self.state.last_break = index;
                self.state.last_will_break = index;
            }
        }
    }

    /// Records something other than a line break that forces the enclosing groups to break.
    #[inline]
    fn forced_break(&mut self, index: u32) {
        self.state.last_break = index;
        if !self.state.is_in_line_suffix {
            self.state.last_will_break = index;
        }
    }

    #[inline]
    fn open(&mut self, kind: FrameKind, start: u32) {
        self.frames.push(Frame {
            kind,
            start_flags: FlatFlags::default(),
            start,
            first_text: NO_TEXT,
        });
    }

    /// Opens a frame whose content doesn't count toward the enclosing content's flat width.
    fn open_isolated(&mut self, kind: FrameKind, start: u32) {
        self.saved.push(self.state);
        self.open(kind, start);
        self.state.first_frame_without_text = self.frames.len() as u32 - 1;
    }

    /// Pops the innermost frame if its kind is one of `kinds`. Unused reserved slots inside it are dropped.
    #[inline]
    fn close(&mut self, kinds: &[FrameKind]) -> Option<Frame> {
        while self
            .frames
            .pop_if(|frame| frame.kind == FrameKind::Reserved)
            .is_some()
        {}
        let frame = self.frames.pop_if(|frame| kinds.contains(&frame.kind))?;
        self.state.first_frame_without_text = self
            .state
            .first_frame_without_text
            .min(self.frames.len() as u32);
        Some(frame)
    }

    /// Records that a slot for a start tag was reserved at `index`.
    #[inline]
    pub(crate) fn reserve(&mut self, index: u32) {
        self.open(FrameKind::Reserved, index);
    }

    /// Records that the slot reserved at `start` became a group's start tag.
    pub(crate) fn use_reserved(&mut self, start: u32, mode: GroupMode) {
        while self
            .frames
            .pop_if(|frame| frame.kind == FrameKind::Reserved && frame.start > start)
            .is_some()
        {}
        self.state.first_frame_without_text = self
            .state
            .first_frame_without_text
            .min(self.frames.len() as u32);
        if let Some(frame) = self.frames.last_mut()
            && frame.kind == FrameKind::Reserved
            && frame.start == start
        {
            frame.kind = FrameKind::Group;
        }
        if mode == GroupMode::Expand && !self.state.is_in_line_suffix {
            self.state.last_will_break = self.state.last_will_break.max(start);
        }
    }

    fn end_group(&mut self, index: u32, storage: &mut Storage) {
        if let Some(frame) = self.close(&[FrameKind::Group])
            && let Some(FormatElement::Tag(Tag::StartGroup(group))) =
                storage.pool.get_mut(frame.start as usize)
        {
            if self.state.last_break > frame.start {
                group.propagate_expand();
            }
            if group.mode().is_flat() {
                group.set_flat(self.flat_of_frame(frame), index);
            } else {
                group.set_flat(Flat::default(), index);
                self.state.last_break = index;
            }
            if group.id().is_some() {
                self.state.last_group_id = index;
            }
        }
    }

    /// Ends conditional content or a line suffix.
    fn end_content(&mut self, index: u32) {
        if let Some(Frame {
            kind: kind @ (FrameKind::IfExpanded | FrameKind::Unknown),
            ..
        }) = self.close(&[FrameKind::IfFlat, FrameKind::IfExpanded, FrameKind::Unknown])
            && let Some(saved) = self.saved.pop()
        {
            // A forced line break inside it still affects the enclosing content.
            self.state = State {
                last_break: self.state.last_break,
                last_will_break: self.state.last_will_break,
                ..saved
            };
            if kind == FrameKind::Unknown {
                self.state.last_unknown = index;
            }
        }
    }

    /// Records that a [`FormatElement::Skip`] was written at `index`. The elements that follow are what it skips.
    #[inline]
    pub(crate) fn start_skipped(&mut self, index: u32) {
        self.open_isolated(FrameKind::Skipped, index);
        self.state.is_in_line_suffix = false;
    }

    /// Ends the content of a [`FormatElement::Skip`]. Returns the `Skip`'s index, the content's flat measurements, and
    /// whether `Storage::will_break` is true for it.
    pub(crate) fn end_skipped(&mut self) -> Option<(u32, Flat, bool)> {
        let mut is_balanced = true;
        while matches!(self.frames.last(), Some(frame) if frame.kind != FrameKind::Skipped) {
            // A start tag without an end tag, unless it's a reserved slot.
            match self.frames.pop().map(|frame| frame.kind) {
                Some(FrameKind::IfExpanded | FrameKind::Unknown) => {
                    self.saved.pop();
                    is_balanced = false;
                }
                Some(FrameKind::Reserved) => {}
                _ => is_balanced = false,
            }
        }
        let frame = self.close(&[FrameKind::Skipped])?;
        let flat = if self.state.last_break > frame.start {
            Flat {
                width: 0,
                flags: FlatFlags::EXPANDS,
            }
        } else if is_balanced {
            self.flat_of_frame(frame)
        } else {
            Flat::default()
        };
        let will_break = self.state.last_will_break > frame.start;
        self.state = self.saved.pop()?;
        Some((frame.start, flat, will_break))
    }

    /// Records a text of `width` columns at `index`.
    #[inline]
    fn text(&mut self, width: u32, index: u32) {
        // Whether a space after a zero-width text counts depends on whether the line was empty before it.
        if width == 0 {
            self.state.last_unknown = index;
        }
        let start = self
            .state
            .width
            .wrapping_add(u32::from(self.state.is_space_pending));
        if (self.state.first_frame_without_text as usize) < self.frames.len() {
            self.first_text(start);
        }
        self.state.width = start.wrapping_add(width);
        self.state.is_space_pending = false;
        self.state.is_space_element_pending = false;
    }

    /// Records that a text starts at width `start` and is the first text in some frames.
    #[inline(never)]
    fn first_text(&mut self, start: u32) {
        let state = &self.state;
        for frame in self
            .frames
            .get_mut(state.first_frame_without_text as usize..)
            .unwrap_or_default()
        {
            frame.first_text = start;
            frame.start_flags = FlatFlags::default()
                .with(FlatFlags::STARTS_WITH_LINE, state.last_line > frame.start)
                .with(FlatFlags::STARTS_WITH_SPACE, state.last_space > frame.start);
        }
        self.state.first_frame_without_text = self.frames.len() as u32;
    }

    #[inline(never)]
    fn interned(&mut self, interned: Interned, index: u32, storage: &Storage) {
        let (flat, will_break) = storage.summary_of(interned);
        if flat.flags.has(FlatFlags::EXPANDS) {
            self.state.last_break = index;
        }
        if will_break && !self.state.is_in_line_suffix {
            self.state.last_will_break = index;
        }
        self.content(flat, index);
    }

    /// When flat, a `BestFitting` prints as its flattest variant, which is at `first`.
    #[inline(never)]
    fn best_fitting(&mut self, first: u32, index: u32, storage: &Storage) {
        let Some(&flattest) = storage.variants.get(first as usize) else {
            return self.state.last_unknown = index;
        };
        let (flat, will_break) = storage.summary_of(flattest);
        if will_break && !self.state.is_in_line_suffix {
            self.state.last_will_break = index;
        }
        self.content(flat, index);
    }

    /// Records already-measured content written at `index`.
    fn content(&mut self, flat: Flat, index: u32) {
        let flags = flat.flags;
        if !flags.has(FlatFlags::MEASURED) {
            self.state.last_unknown = index;
            return;
        }
        if flags.has(FlatFlags::HAS_LINE_SUFFIX_BOUNDARY) {
            self.state.last_boundary = index;
        }
        if flags.has(FlatFlags::HAS_GROUP_IDS) {
            self.state.last_group_id = index;
        }
        if flags.has(FlatFlags::STARTS_WITH_LINE) {
            self.state.last_line = index;
            self.state.is_space_pending = true;
        }
        if flags.has(FlatFlags::STARTS_WITH_SPACE) {
            self.state.last_space = index;
            self.state.is_space_pending = true;
            self.state.is_space_element_pending = true;
        }
        if flat.width > 0 {
            self.text(u32::from(flat.width), index);
            self.state.is_space_pending = flags.has(FlatFlags::ENDS_WITH_SPACE);
            self.state.is_space_element_pending = flags.has(FlatFlags::ENDS_WITH_SPACE_ELEMENT);
        }
    }

    /// Returns the measurements of `frame`, which ends here.
    fn flat_of_frame(&self, frame: Frame) -> Flat {
        let state = &self.state;
        if state.last_unknown > frame.start {
            return Flat::default();
        }
        let flags = FlatFlags::MEASURED
            .with(
                FlatFlags::HAS_LINE_SUFFIX_BOUNDARY,
                state.last_boundary > frame.start,
            )
            .with(FlatFlags::HAS_GROUP_IDS, state.last_group_id > frame.start);
        if frame.first_text == NO_TEXT {
            return Flat {
                width: 0,
                flags: flags
                    .with(FlatFlags::STARTS_WITH_LINE, state.last_line > frame.start)
                    .with(FlatFlags::STARTS_WITH_SPACE, state.last_space > frame.start),
            };
        }
        match u16::try_from(state.width.wrapping_sub(frame.first_text)) {
            Ok(width) => Flat {
                width,
                flags: flags
                    .with(frame.start_flags, true)
                    .with(FlatFlags::ENDS_WITH_SPACE, state.is_space_pending)
                    .with(
                        FlatFlags::ENDS_WITH_SPACE_ELEMENT,
                        state.is_space_element_pending,
                    ),
            },
            Err(_) => Flat::default(),
        }
    }
}
