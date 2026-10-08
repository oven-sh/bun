//! What is done to a finished document before it is printed.

use super::element::{Flat, FlatFlags, FormatElement, Interned, LineMode, PrintMode, Tag};
use super::formatter::Storage;

#[derive(Copy, Clone, PartialEq, Eq)]
enum FrameKind {
    Group,
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
    /// The frames from here on have no text yet.
    without_text: u32,
    /// What forces the enclosing groups to break.
    last_break: u32,
    /// What keeps the enclosing groups from being [`FlatFlags::MEASURED`].
    last_unknown: u32,
    last_boundary: u32,
    last_line: u32,
    last_space: u32,
    last_group_id: u32,
    /// Where the innermost skipped content ends.
    end: u32,
}

#[derive(Default)]
pub(crate) struct PropagateBuffers {
    frames: Vec<Frame>,
    /// The state before each frame that is not a group or [`FrameKind::IfFlat`].
    saved: Vec<State>,
}

/// Prettier's `propagateBreaks`: marks every group that has a hard line break, a text with a line
/// break or an [`FormatElement::ExpandParent`] in it as expanded. The variants of a
/// [`FormatElement::BestFitting`] do not make what encloses them expand.
///
/// It also measures the groups that are left, and interned content: see [`Flat`].
///
/// This is one loop over the elements. Interned content comes before every element that stands
/// for it, so what there is to know about it is in its [`FormatElement::Skip`] by then.
pub(crate) fn propagate_expand(root: Interned, storage: &mut Storage, buffers: &mut PropagateBuffers) {
    let mut pass = Pass {
        state: State {
            end: root.start.saturating_add(root.len).min(storage.pool.len() as u32),
            ..State::default()
        },
        frames: &mut buffers.frames,
        saved: &mut buffers.saved,
    };
    pass.frames.clear();
    pass.saved.clear();
    pass.run(root.start, storage);
}

struct Pass<'b> {
    state: State,
    frames: &'b mut Vec<Frame>,
    saved: &'b mut Vec<State>,
}

impl Pass<'_> {
    fn run(&mut self, start: u32, storage: &mut Storage) {
        let Storage { pool, variants, .. } = storage;
        let mut index = start;
        loop {
            while index < self.state.end {
                let Some(&element) = pool.get(index as usize) else {
                    return;
                };
                match element {
                    FormatElement::Token(token) => self.text(token.len() as u32, index),
                    FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                        if text.width.is_multiline() {
                            self.state.last_break = index;
                        }
                        self.text(text.width.value(), index);
                    }
                    FormatElement::Space => {
                        self.state.last_space = index;
                        self.state.is_space_pending = true;
                    }
                    FormatElement::Line(LineMode::Soft) | FormatElement::Nop => {}
                    FormatElement::Line(LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty) => {
                        self.state.last_line = index;
                        self.state.is_space_pending = true;
                    }
                    FormatElement::Line(LineMode::Hard | LineMode::Empty) | FormatElement::ExpandParent => {
                        self.state.last_break = index;
                    }
                    FormatElement::LineSuffixBoundary => self.state.last_boundary = index,
                    FormatElement::Skip(skip) => {
                        self.open_apart(FrameKind::Skipped, index);
                        self.state.end = index.saturating_add(skip.len).saturating_add(1).min(self.state.end);
                    }
                    FormatElement::Interned(interned) => {
                        let flat = flat_of(pool, interned);
                        if flat.flags.has(FlatFlags::EXPANDS) {
                            self.state.last_break = index;
                        }
                        self.content(flat, index);
                    }
                    // On one line it is its flattest variant.
                    FormatElement::BestFitting(best_fitting) => match variants.get(best_fitting.first as usize) {
                        Some(&flattest) => self.content(flat_of(pool, flattest), index),
                        None => self.state.last_unknown = index,
                    },
                    FormatElement::Tag(tag) => match tag {
                        Tag::StartGroup(_) => self.open(FrameKind::Group, index),
                        Tag::EndGroup => {
                            if let Some(frame) = self.close(&[FrameKind::Group])
                                && let Some(FormatElement::Tag(Tag::StartGroup(group))) = pool.get_mut(frame.start as usize)
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
                        Tag::StartConditionalContent(condition) => match (condition.group_id, condition.mode) {
                            (Some(_), _) => self.open_apart(FrameKind::Unknown, index),
                            (None, PrintMode::Expanded) => self.open_apart(FrameKind::IfExpanded, index),
                            (None, PrintMode::Flat) => self.open(FrameKind::IfFlat, index),
                        },
                        Tag::StartLineSuffix => self.open_apart(FrameKind::Unknown, index),
                        Tag::EndConditionalContent | Tag::EndLineSuffix => {
                            match self.close(&[FrameKind::IfFlat, FrameKind::IfExpanded, FrameKind::Unknown]) {
                                Some(Frame {
                                    kind: kind @ (FrameKind::IfExpanded | FrameKind::Unknown),
                                    ..
                                }) => {
                                    // A forced line break in it counts for what encloses it.
                                    let last_break = self.state.last_break;
                                    self.restore();
                                    self.state.last_break = last_break;
                                    if kind == FrameKind::Unknown {
                                        self.state.last_unknown = index;
                                    }
                                }
                                _ => {}
                            }
                        }
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
                index += 1;
            }

            // The end of skipped content, or of the document.
            while matches!(self.frames.last(), Some(frame) if frame.kind != FrameKind::Skipped) {
                // A start tag without its end tag.
                if let Some(Frame {
                    kind: FrameKind::IfExpanded | FrameKind::Unknown,
                    ..
                }) = self.frames.pop()
                {
                    self.saved.pop();
                }
                self.state.last_unknown = index;
            }
            let Some(frame) = self.close(&[FrameKind::Skipped]) else {
                return;
            };
            let mut flat = self.flat_of_frame(frame);
            if self.state.last_break > frame.start {
                flat = Flat {
                    width: 0,
                    flags: FlatFlags::EXPANDS,
                };
            }
            if let Some(FormatElement::Skip(skip)) = pool.get_mut(frame.start as usize) {
                skip.flat = flat;
            }
            self.restore();
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

    /// Goes back to the state before the last frame that was opened apart.
    fn restore(&mut self) {
        if let Some(saved) = self.saved.pop() {
            self.state = saved;
        }
    }

    /// Removes the innermost frame if it is of one of `kinds`.
    #[inline]
    fn close(&mut self, kinds: &[FrameKind]) -> Option<Frame> {
        let frame = self.frames.pop_if(|frame| kinds.contains(&frame.kind))?;
        self.state.without_text = self.state.without_text.min(self.frames.len() as u32);
        Some(frame)
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
    }

    /// A text starts at the width `start`, and it is the first of some frames.
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
        }
        if flags.has(FlatFlags::HAS_TEXT) {
            self.text(u32::from(flat.width), index);
            self.state.is_space_pending = flags.has(FlatFlags::ENDS_WITH_SPACE);
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
                    .with(FlatFlags::HAS_TEXT, true)
                    .with(frame.start_flags, true)
                    .with(FlatFlags::ENDS_WITH_SPACE, state.is_space_pending),
            },
            Err(_) => Flat::default(),
        }
    }
}

/// What has been found out about `interned`.
#[inline]
fn flat_of(pool: &[FormatElement], interned: Interned) -> Flat {
    match (interned.start as usize).checked_sub(1).and_then(|before| pool.get(before)) {
        Some(FormatElement::Skip(skip)) if skip.len == interned.len => skip.flat,
        _ => Flat {
            width: 0,
            flags: FlatFlags::default().with(FlatFlags::EXPANDS, part_expands(pool, interned, 0)),
        },
    }
}

/// Whether there is a forced line break in `part`, which is not all of what has been captured
/// but a part of it.
#[cold]
fn part_expands(pool: &[FormatElement], part: Interned, depth: u32) -> bool {
    let mut elements = pool.get(part.range()).unwrap_or_default().iter();
    while let Some(element) = elements.next() {
        let expands = match element {
            FormatElement::Skip(skip) => {
                if skip.len > 0 {
                    elements.nth(skip.len as usize - 1);
                }
                false
            }
            FormatElement::Line(mode) => mode.will_break(),
            FormatElement::ExpandParent => true,
            FormatElement::SourceText(text) | FormatElement::OwnedText(text) => text.width.is_multiline(),
            FormatElement::Tag(Tag::StartGroup(group)) => !group.mode().is_flat(),
            FormatElement::Interned(interned) => match (interned.start as usize).checked_sub(1).and_then(|at| pool.get(at)) {
                Some(FormatElement::Skip(skip)) if skip.len == interned.len => skip.flat.flags.has(FlatFlags::EXPANDS),
                _ => depth >= 16 || part_expands(pool, *interned, depth + 1),
            },
            _ => false,
        };
        if expands {
            return true;
        }
    }
    false
}
