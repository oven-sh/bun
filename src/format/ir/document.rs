//! What the printer has to know about a document before it prints it: which groups have a forced
//! line break in them, and how wide the others are on one line.
//!
//! A [`Tracker`] finds that out from the elements in the order they are written. The `Formatter`
//! tells it about each element as it writes it, so that there is nothing left to do when the
//! document is finished. [`propagate_expand`] does the same for a document that has been written
//! without a `Formatter`.

use super::element::{Flat, FlatFlags, FormatElement, GroupMode, Interned, LineMode, PrintMode, Tag};
use super::formatter::Storage;

#[derive(Copy, Clone, PartialEq, Eq)]
enum FrameKind {
    Group,
    /// The place of a start tag that may become one of a group. See `Formatter::reserve_tag`.
    Reserved,
    /// What a [`FormatElement::Skip`] skips.
    Skipped,
    /// Content that is written if the enclosing group is flat.
    IfFlat,
    /// Content that is not there when what encloses it is flat.
    IfExpanded,
    /// Content of which only the printer knows whether it is there, or where.
    Unknown,
}

/// Something that is open at the element that is being looked at.
#[derive(Copy, Clone)]
struct Frame {
    kind: FrameKind,
    /// [`FlatFlags::STARTS_WITH_LINE`], [`FlatFlags::STARTS_WITH_SPACE`]
    start_flags: FlatFlags,
    /// The index of its first element: the start tag or the [`FormatElement::Skip`].
    start: u32,
    /// [`State::width`] at the start of the first text in it. [`NO_TEXT`] as long as there is none.
    first_text: u32,
}

const NO_TEXT: u32 = u32::MAX;

/// What has been seen so far of everything on one line. The fields that are an index say where
/// something has last been seen: it is in a frame if that is after the start of the frame.
/// Index 0 is not part of any document.
#[derive(Copy, Clone, Default)]
struct State {
    /// The columns of all texts, and of the spaces between them. It wraps around.
    width: u32,
    /// A space is written before the next text.
    is_space_pending: bool,
    /// There has been a [`FormatElement::Space`] since the last text.
    is_space_element_pending: bool,
    is_in_line_suffix: bool,
    /// The frames from here on have no text yet.
    without_text: u32,
    /// What forces the enclosing groups to break.
    last_break: u32,
    /// What `Storage::will_break` is true for.
    last_will_break: u32,
    /// What keeps the enclosing groups from being [`FlatFlags::MEASURED`].
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
    /// The state before each frame whose content is apart from what encloses it.
    saved: Vec<State>,
}

pub(crate) type PropagateBuffers = Tracker;

/// Prettier's `propagateBreaks`: marks every group that has a hard line break, a text with a line
/// break or an [`FormatElement::ExpandParent`] in it as expanded. The variants of a
/// [`FormatElement::BestFitting`] do not make what encloses them expand.
///
/// It also measures the groups that are left, and interned content: see [`Flat`].
///
/// This is one loop over the elements. Interned content comes before every element that stands
/// for it, so what there is to know about it is in its [`FormatElement::Skip`] by then.
pub(crate) fn propagate_expand(root: Interned, storage: &mut Storage, tracker: &mut Tracker) {
    tracker.clear();
    // Where the skipped content ends that encloses the current one, and so on.
    let mut ends = Vec::new();
    let mut end = root.start.saturating_add(root.len).min(storage.pool.len() as u32);
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

    /// `element` has been written at `index`. It is not a [`FormatElement::Skip`].
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
            // It is not there when what encloses it is flat.
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
            FormatElement::BestFitting(best_fitting) => self.best_fitting(best_fitting.first, index, storage),
            FormatElement::Tag(tag) => match tag {
                Tag::StartGroup(group) => {
                    if group.mode() == GroupMode::Expand && !self.state.is_in_line_suffix {
                        self.state.last_will_break = index;
                    }
                    self.open(FrameKind::Group, index);
                }
                Tag::EndGroup => self.end_group(index, storage),
                Tag::StartConditionalContent(condition) => match (condition.group_id, condition.mode) {
                    (Some(_), _) => self.open_apart(FrameKind::Unknown, index),
                    (None, PrintMode::Expanded) => self.open_apart(FrameKind::IfExpanded, index),
                    (None, PrintMode::Flat) => self.open(FrameKind::IfFlat, index),
                },
                Tag::StartLineSuffix => {
                    self.open_apart(FrameKind::Unknown, index);
                    self.state.is_in_line_suffix = true;
                }
                Tag::EndConditionalContent | Tag::EndLineSuffix => self.end_content(index),
                Tag::StartIndentWithLine(mode) | Tag::EndIndentWithLine(mode) => self.line(mode, index),
                // These change where a line starts, or nothing at all.
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

    /// Whether `Storage::will_break` is true for what has been written from `start` on. `start` is
    /// in the skipped content that is being written.
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

    /// Something other than a line break that forces the enclosing groups to break.
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

    /// Opens a frame whose content is not part of what encloses it when that is on one line.
    fn open_apart(&mut self, kind: FrameKind, start: u32) {
        self.saved.push(self.state);
        self.open(kind, start);
        self.state.without_text = self.frames.len() as u32 - 1;
    }

    /// Removes the innermost frame if it is of one of `kinds`. Places that have been reserved in
    /// it and not been used are forgotten.
    #[inline]
    fn close(&mut self, kinds: &[FrameKind]) -> Option<Frame> {
        while self.frames.pop_if(|frame| frame.kind == FrameKind::Reserved).is_some() {}
        let frame = self.frames.pop_if(|frame| kinds.contains(&frame.kind))?;
        self.state.without_text = self.state.without_text.min(self.frames.len() as u32);
        Some(frame)
    }

    /// The place of a start tag has been reserved at `index`.
    #[inline]
    pub(crate) fn reserve(&mut self, index: u32) {
        self.open(FrameKind::Reserved, index);
    }

    /// The place that has been reserved at `start` has become the start tag of a group.
    pub(crate) fn use_reserved(&mut self, start: u32, mode: GroupMode) {
        while self.frames.pop_if(|frame| frame.kind == FrameKind::Reserved && frame.start > start).is_some() {}
        self.state.without_text = self.state.without_text.min(self.frames.len() as u32);
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
            && let Some(FormatElement::Tag(Tag::StartGroup(group))) = storage.pool.get_mut(frame.start as usize)
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

    /// The end of conditional content or of a line suffix.
    fn end_content(&mut self, index: u32) {
        if let Some(Frame {
            kind: kind @ (FrameKind::IfExpanded | FrameKind::Unknown),
            ..
        }) = self.close(&[FrameKind::IfFlat, FrameKind::IfExpanded, FrameKind::Unknown])
            && let Some(saved) = self.saved.pop()
        {
            // A forced line break in it counts for what encloses it.
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

    /// A [`FormatElement::Skip`] has been written at `index`. What follows is what it skips.
    #[inline]
    pub(crate) fn start_skipped(&mut self, index: u32) {
        self.open_apart(FrameKind::Skipped, index);
        self.state.is_in_line_suffix = false;
    }

    /// The end of what a [`FormatElement::Skip`] skips. Returns where that is, what the content
    /// is on one line, and whether `Storage::will_break` is true for it.
    pub(crate) fn end_skipped(&mut self) -> Option<(u32, Flat, bool)> {
        let mut is_balanced = true;
        while matches!(self.frames.last(), Some(frame) if frame.kind != FrameKind::Skipped) {
            // A start tag without its end tag, unless it is a place that has been reserved.
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

    /// A text of `width` columns at `index`.
    #[inline]
    fn text(&mut self, width: u32, index: u32) {
        // Whether a space after it counts depends on whether the line is empty before it.
        if width == 0 {
            self.state.last_unknown = index;
        }
        let start = self.state.width.wrapping_add(u32::from(self.state.is_space_pending));
        if (self.state.without_text as usize) < self.frames.len() {
            self.first_text(start);
        }
        self.state.width = start.wrapping_add(width);
        self.state.is_space_pending = false;
        self.state.is_space_element_pending = false;
    }

    /// A text starts at the width `start`, and it is the first of some frames.
    #[inline(never)]
    fn first_text(&mut self, start: u32) {
        let state = &self.state;
        for frame in self.frames.get_mut(state.without_text as usize..).unwrap_or_default() {
            frame.first_text = start;
            frame.start_flags = FlatFlags::default()
                .with(FlatFlags::STARTS_WITH_LINE, state.last_line > frame.start)
                .with(FlatFlags::STARTS_WITH_SPACE, state.last_space > frame.start);
        }
        self.state.without_text = self.frames.len() as u32;
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

    /// On one line it is its flattest variant, which is at `first`.
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

    /// Content that has been measured is written at `index`.
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

    /// What is in `frame`, which ends here.
    fn flat_of_frame(&self, frame: Frame) -> Flat {
        let state = &self.state;
        if state.last_unknown > frame.start {
            return Flat::default();
        }
        let flags = FlatFlags::MEASURED
            .with(FlatFlags::HAS_LINE_SUFFIX_BOUNDARY, state.last_boundary > frame.start)
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
                    .with(FlatFlags::ENDS_WITH_SPACE_ELEMENT, state.is_space_element_pending),
            },
            Err(_) => Flat::default(),
        }
    }
}
