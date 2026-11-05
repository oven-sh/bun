//! Writes a document of `ir/` to the document of the quick way, which is Prettier's.
//!
//! The two are printed by different rules where white space meets white space:
//!
//! - The printer of `ir/` skips a line break on a line that's empty, and only takes its indentation. Prettier's prints
//!   every one.
//! - A [`FormatElement::Space`], and a line break that's printed as a blank, wait for the next text. Two of them are one,
//!   and at the start of a line they're nothing. Prettier's `" "` is a text like another.
//!
//! So what's written here depends on what's on the line, which [`Last`] keeps track of. Where that isn't certain (it
//! depends on whether a group breaks), and something follows that's printed differently, nothing is written:
//! [`Unwritten::Unknown`]. That never happens between two texts.

use super::from_doc::Unwritten;
use crate::ir::element::{
    BestFitting, Condition, DedentMode, Fallback, FormatElement, GroupId, Interned, LineMode,
    PrintMode, Tag, TextWidth,
};
use crate::ir::formatter::Storage;
use bun_format_quick::{self as quick, Detached, Open, Sink};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// What has been printed last, when the next element is printed.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Last {
    /// A text, so the line isn't empty.
    Text,
    /// A text and then a blank, which has been written.
    Blank,
    /// A line break.
    LineBreak,
    /// A text and then a line break that's only printed if its group breaks. `or_blank`: else it's a blank.
    LineBreakIfBroken {
        or_blank: bool,
    },
    Unknown,
}

impl Last {
    fn join(self, other: Last) -> Last {
        if self == other { self } else { Last::Unknown }
    }
}

/// What decides whether the line breaks directly in it are printed.
#[derive(Copy, Clone)]
enum Frame {
    /// `is_broken`: it's certain to break.
    Group {
        open: Open,
        id: quick::GroupId,
        is_broken: bool,
    },
    Fill {
        entries: u32,
    },
    Entry,
    Conditional {
        open: Open,
        is_for_broken: bool,
        before: Last,
    },
    LineSuffix {
        open: Open,
        before: Last,
    },
    /// The start of content whose surroundings aren't known.
    Content,
}

pub(crate) struct FromIr<'s, 'q, 'd> {
    sink: &'s mut Sink<'q>,
    storage: &'d Storage,
    source: &'d [u8],
    /// By [`GroupId::index`]: what the group is called in the other document. 0 if it has no name there yet.
    groups: &'s mut Vec<quick::GroupId>,
    frames: SmallVec<[Frame; 16]>,
    last: Last,
    /// A [`FormatElement::Space`] after a text that hasn't been written yet.
    has_pending_blank: bool,
    /// A line break with an empty line that has been left out, because another line break follows.
    carries_empty_line: bool,
    /// A line suffix has been written, so a boundary may print a line break.
    has_line_suffix: bool,
    /// Content that's written once, by what was printed before it.
    detached: FxHashMap<(Interned, Last), (Detached, Last)>,
    stack_check: bun_core::StackCheck,
}

fn is_forced(mode: LineMode) -> bool {
    matches!(mode, LineMode::Hard | LineMode::Empty)
}

fn has_empty_line(mode: LineMode) -> bool {
    matches!(
        mode,
        LineMode::Empty | LineMode::SoftEmpty | LineMode::SoftOrSpaceEmpty
    )
}

fn is_blank_if_flat(mode: LineMode) -> bool {
    matches!(mode, LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty)
}

impl<'s, 'q, 'd> FromIr<'s, 'q, 'd> {
    /// `last` is what's printed before the content. `has_line_suffix`: a line suffix may be waiting there.
    pub(crate) fn new(
        sink: &'s mut Sink<'q>,
        storage: &'d Storage,
        source: &'d [u8],
        groups: &'s mut Vec<quick::GroupId>,
        last: Last,
        has_line_suffix: bool,
    ) -> Self {
        FromIr {
            sink,
            storage,
            source,
            groups,
            frames: SmallVec::new(),
            last,
            has_pending_blank: false,
            carries_empty_line: false,
            has_line_suffix,
            detached: FxHashMap::default(),
            stack_check: bun_core::StackCheck::init(),
        }
    }

    /// Writes `elements`. Returns what's printed last, and whether a line suffix may be waiting.
    pub(crate) fn write(
        mut self,
        elements: &'d [FormatElement],
    ) -> Result<(Last, bool), Unwritten> {
        self.frames.push(Frame::Content);
        self.write_elements(elements)?;
        self.write_pending_blank();
        match (self.frames.len(), self.carries_empty_line) {
            (1, false) => Ok((self.last, self.has_line_suffix)),
            _ => Err(Unwritten::Unknown),
        }
    }

    fn group_id(&mut self, id: GroupId) -> quick::GroupId {
        let index = id.index();
        if self.groups.len() <= index {
            self.groups.resize(index + 1, 0);
        }
        match self.groups.get_mut(index) {
            Some(known) => {
                if *known == 0 {
                    *known = self.sink.new_group_id();
                }
                *known
            }
            None => 0,
        }
    }

    /// Before something that's only printed sometimes, or elsewhere.
    fn write_pending_blank(&mut self) {
        if std::mem::take(&mut self.has_pending_blank) {
            self.sink.text(b" ");
            self.last = Last::Blank;
        }
    }

    fn write_text(&mut self, text: &[u8], width: TextWidth) -> Result<(), Unwritten> {
        if text.is_empty() {
            return Ok(());
        }
        // A guess that only the other printer checks.
        if width.room_needed_after().is_some() {
            return Err(Unwritten::Unknown);
        }
        if std::mem::take(&mut self.has_pending_blank) {
            self.sink.text(b" ");
        }
        let ends_line = text.ends_with(b"\n");
        if !width.is_multiline() || width.is_one_string() {
            self.sink
                .text_of_width(text, i32::try_from(width.value()).unwrap_or(i32::MAX));
            self.last = if ends_line { Last::Unknown } else { Last::Text };
        } else {
            self.sink.lines(text, false);
            self.last = if ends_line {
                Last::LineBreak
            } else {
                Last::Text
            };
        }
        Ok(())
    }

    fn write_token(&mut self, token: &[u8]) {
        if std::mem::take(&mut self.has_pending_blank) {
            self.sink.text(b" ");
        }
        self.sink.text(token);
        self.last = Last::Text;
    }

    /// True if a line break directly in the innermost frame but `outer` is certain to be printed.
    fn is_in_broken_group(&self, outer: usize) -> bool {
        let frame = (self.frames.len().checked_sub(1 + outer)).and_then(|at| self.frames.get(at));
        matches!(
            frame,
            Some(Frame::Group {
                is_broken: true,
                ..
            })
        )
    }

    /// If nothing is printed between `elements[index]` and the next line break: whether that one is certain to be
    /// printed.
    fn is_followed_by_line_break(
        &self,
        elements: &[FormatElement],
        mut index: usize,
    ) -> Option<bool> {
        // The groups that start on the way, and how many of those around have ended.
        let (mut started, mut ended) = (SmallVec::<[bool; 4]>::new(), 0);
        loop {
            let mode = match elements.get(index)? {
                FormatElement::Nop | FormatElement::ExpandParent => None,
                FormatElement::Skip(skip) => {
                    index += skip.len as usize;
                    None
                }
                FormatElement::Line(mode) => Some(*mode),
                FormatElement::Tag(tag) => match tag {
                    Tag::StartIndentWithLine(mode) | Tag::EndIndentWithLine(mode) => Some(*mode),
                    Tag::StartGroup(group) => {
                        started.push(!group.mode().is_flat());
                        None
                    }
                    Tag::EndGroup => {
                        if started.pop().is_none() {
                            ended += 1;
                        }
                        None
                    }
                    Tag::StartIndent
                    | Tag::EndIndent
                    | Tag::StartAlign(_)
                    | Tag::EndAlign
                    | Tag::StartDedent(_)
                    | Tag::EndDedent(_)
                    | Tag::StartIndentIfGroupBreaks(_)
                    | Tag::EndIndentIfGroupBreaks(_)
                    | Tag::StartLabelled(_)
                    | Tag::EndLabelled => None,
                    _ => return None,
                },
                _ => return None,
            };
            if let Some(mode) = mode {
                return Some(
                    is_forced(mode)
                        || match started.last() {
                            Some(&is_broken) => is_broken,
                            None => self.is_in_broken_group(ended),
                        },
                );
            }
            index += 1;
        }
    }

    /// `rest` is what follows the line break in `elements`.
    fn write_line(
        &mut self,
        mode: LineMode,
        elements: &[FormatElement],
        rest: usize,
    ) -> Result<(), Unwritten> {
        let is_printed = is_forced(mode) || self.is_in_broken_group(0);
        if is_printed {
            // Of line breaks in a row, the last one has the indentation. There's at most one empty line.
            match self.is_followed_by_line_break(elements, rest) {
                Some(true) => {
                    if is_forced(mode) {
                        self.sink.break_parent();
                    }
                    self.carries_empty_line |= has_empty_line(mode);
                    return Ok(());
                }
                Some(false) => return Err(Unwritten::Unknown),
                None => {}
            }
            if !matches!(self.last, Last::Text | Last::Blank) {
                return Err(Unwritten::Unknown);
            }
            self.has_pending_blank = false;
            let count = match has_empty_line(mode) || std::mem::take(&mut self.carries_empty_line) {
                true => 2,
                false => 1,
            };
            for _ in 0..count {
                match mode {
                    LineMode::Hard | LineMode::Empty => self.sink.hardline(),
                    _ => self.sink.softline(),
                }
            }
            self.last = Last::LineBreak;
            return Ok(());
        }
        if self.last != Last::Text || self.carries_empty_line {
            return Err(Unwritten::Unknown);
        }
        let or_blank = std::mem::take(&mut self.has_pending_blank) || is_blank_if_flat(mode);
        match or_blank {
            true => self.sink.line(),
            false => self.sink.softline(),
        }
        if has_empty_line(mode) {
            self.sink.softline();
        }
        self.last = Last::LineBreakIfBroken { or_blank };
        Ok(())
    }

    fn write_space(&mut self) -> Result<(), Unwritten> {
        match self.last {
            Last::Text => self.has_pending_blank = true,
            Last::Blank | Last::LineBreak | Last::LineBreakIfBroken { or_blank: true } => {}
            Last::LineBreakIfBroken { or_blank: false } | Last::Unknown => {
                return Err(Unwritten::Unknown);
            }
        }
        Ok(())
    }

    fn write_interned(&mut self, interned: Interned) -> Result<(), Unwritten> {
        if interned.len == 0 {
            return Ok(());
        }
        self.write_pending_blank();
        let key = (interned, self.last);
        if let Some(&(detached, last)) = self.detached.get(&key) {
            self.sink.call(detached);
            self.last = last;
            return Ok(());
        }
        if !self.stack_check.is_safe_to_recurse() {
            return Err(Unwritten::NestedTooDeeply);
        }
        let open = self.sink.detach_open();
        self.write_content(self.storage.interned(interned))?;
        let detached = self.sink.detach_close(open);
        self.detached.insert(key, (detached, self.last));
        self.sink.call(detached);
        Ok(())
    }

    /// Writes content that stands by itself.
    fn write_content(&mut self, elements: &'d [FormatElement]) -> Result<(), Unwritten> {
        let depth = self.frames.len();
        self.frames.push(Frame::Content);
        self.write_elements(elements)?;
        self.write_pending_blank();
        self.frames.pop();
        match self.frames.len() == depth && !self.carries_empty_line {
            true => Ok(()),
            false => Err(Unwritten::Unknown),
        }
    }

    fn write_best_fitting(&mut self, best_fitting: BestFitting) -> Result<(), Unwritten> {
        // Prettier has no such thing.
        if best_fitting.fallback != Fallback::MostExpanded {
            return Err(Unwritten::Unknown);
        }
        if !self.stack_check.is_safe_to_recurse() {
            return Err(Unwritten::NestedTooDeeply);
        }
        self.write_pending_blank();
        let before = self.last;
        let mut after = None;
        let variants = self.sink.variants_open();
        for &variant in self.storage.variants(best_fitting) {
            let [
                FormatElement::Tag(Tag::StartEntry),
                content @ ..,
                FormatElement::Tag(Tag::EndEntry),
            ] = self.storage.interned(variant)
            else {
                return Err(Unwritten::Unknown);
            };
            self.last = before;
            let open = self.sink.variant_open();
            self.write_content(content)?;
            self.sink.variant_close(open);
            after = Some(after.map_or(self.last, |after: Last| after.join(self.last)));
        }
        self.sink.variants_close(variants, false);
        self.last = after.ok_or(Unwritten::Unknown)?;
        Ok(())
    }

    fn write_elements(&mut self, elements: &'d [FormatElement]) -> Result<(), Unwritten> {
        let mut index = 0;
        while let Some(element) = elements.get(index) {
            index += 1;
            match element {
                FormatElement::Nop => {}
                FormatElement::Skip(skip) => index += skip.len as usize,
                FormatElement::Space => self.write_space()?,
                FormatElement::Line(mode) => self.write_line(*mode, elements, index)?,
                FormatElement::IndentedLineGroup(id) => {
                    if self.last != Last::Text {
                        return Err(Unwritten::Unknown);
                    }
                    self.has_pending_blank = false;
                    let id = self.group_id(*id);
                    let group = self.sink.group_open();
                    self.sink.indent_open();
                    self.sink.line();
                    self.sink.indent_close();
                    self.sink.group_close(group, false, id);
                    self.last = Last::LineBreakIfBroken { or_blank: true };
                }
                FormatElement::ExpandParent => self.sink.break_parent(),
                FormatElement::Token(token) => self.write_token(token.as_bytes()),
                FormatElement::TokenIfBreaks(token) => {
                    self.write_pending_blank();
                    let open = self.sink.if_break_open(0);
                    self.sink.text(token.as_bytes());
                    self.sink.if_break_else(open);
                    self.sink.if_break_close(open);
                    self.last = self.last.join(Last::Text);
                }
                FormatElement::SourceText(text) => self.write_text(
                    self.source.get(text.range()).ok_or(Unwritten::Unknown)?,
                    text.width,
                )?,
                FormatElement::OwnedText(text) => self.write_text(
                    (self.storage.text.get(text.range())).ok_or(Unwritten::Unknown)?,
                    text.width,
                )?,
                FormatElement::LineSuffixBoundary => {
                    self.write_pending_blank();
                    self.sink.line_suffix_boundary();
                    if self.has_line_suffix {
                        self.last = Last::Unknown;
                    }
                }
                FormatElement::Interned(interned) => self.write_interned(*interned)?,
                FormatElement::BestFitting(best_fitting) => {
                    self.write_best_fitting(*best_fitting)?
                }
                FormatElement::Cursor(_) => return Err(Unwritten::Unknown),
                FormatElement::Tag(tag) => self.write_tag(*tag, elements, index)?,
            }
        }
        Ok(())
    }

    fn write_tag(
        &mut self,
        tag: Tag,
        elements: &[FormatElement],
        rest: usize,
    ) -> Result<(), Unwritten> {
        match tag {
            Tag::StartIndent => self.sink.indent_open(),
            Tag::StartIndentWithLine(mode) => {
                self.sink.indent_open();
                self.write_line(mode, elements, rest)?;
            }
            Tag::EndIndentWithLine(mode) => {
                self.sink.indent_close();
                self.write_line(mode, elements, rest)?;
            }
            Tag::StartAlign(align) => self
                .sink
                .align_open(i32::try_from(align.count()).unwrap_or(i32::MAX)),
            Tag::StartDedent(DedentMode::Level) => self.sink.dedent_open(),
            Tag::StartDedent(DedentMode::Root) => self.sink.dedent_to_root_open(),
            Tag::StartIndentIfGroupBreaks(id) => {
                let id = self.group_id(id);
                self.sink.indent_if_break_open(id, false);
            }
            Tag::EndIndent | Tag::EndAlign | Tag::EndDedent(_) | Tag::EndIndentIfGroupBreaks(_) => {
                self.sink.indent_close()
            }
            Tag::StartGroup(group) => {
                let id = group.id().map_or(0, |id| self.group_id(id));
                self.frames.push(Frame::Group {
                    open: self.sink.group_open(),
                    id,
                    is_broken: !group.mode().is_flat(),
                });
            }
            Tag::EndGroup => {
                let Some(Frame::Group {
                    open,
                    id,
                    is_broken,
                }) = self.frames.pop()
                else {
                    return Err(Unwritten::Unknown);
                };
                self.sink.group_close(open, is_broken, id);
            }
            Tag::StartConditionalContent(Condition { mode, group_id }) => {
                self.write_pending_blank();
                let id = group_id.map_or(0, |id| self.group_id(id));
                let open = self.sink.if_break_open(id);
                let is_for_broken = mode == PrintMode::Expanded;
                if !is_for_broken {
                    self.sink.if_break_else(open);
                }
                self.frames.push(Frame::Conditional {
                    open,
                    is_for_broken,
                    before: self.last,
                });
            }
            Tag::EndConditionalContent => {
                self.write_pending_blank();
                let Some(Frame::Conditional {
                    open,
                    is_for_broken,
                    before,
                }) = self.frames.pop()
                else {
                    return Err(Unwritten::Unknown);
                };
                if is_for_broken {
                    self.sink.if_break_else(open);
                }
                self.sink.if_break_close(open);
                self.last = self.last.join(before);
            }
            Tag::StartFill => {
                self.write_pending_blank();
                self.sink.fill_open();
                self.frames.push(Frame::Fill { entries: 0 });
            }
            Tag::EndFill => {
                let Some(Frame::Fill { .. }) = self.frames.pop() else {
                    return Err(Unwritten::Unknown);
                };
                self.sink.fill_close();
            }
            Tag::StartEntry => {
                let Some(Frame::Fill { entries }) = self.frames.last_mut() else {
                    return Err(Unwritten::Unknown);
                };
                *entries += 1;
                match *entries % 2 {
                    1 => self.sink.fill_item(),
                    _ => self.sink.fill_separator(),
                }
                self.frames.push(Frame::Entry);
            }
            Tag::EndEntry => {
                self.write_pending_blank();
                let Some(Frame::Entry) = self.frames.pop() else {
                    return Err(Unwritten::Unknown);
                };
            }
            Tag::StartLineSuffix => {
                self.write_pending_blank();
                // It's printed at the end of the line, behind what is there now.
                if !matches!(self.last, Last::Text | Last::Blank) {
                    return Err(Unwritten::Unknown);
                }
                self.frames.push(Frame::LineSuffix {
                    open: self.sink.line_suffix_open(),
                    before: self.last,
                });
                self.last = Last::Text;
            }
            Tag::EndLineSuffix => {
                self.write_pending_blank();
                let Some(Frame::LineSuffix { open, before }) = self.frames.pop() else {
                    return Err(Unwritten::Unknown);
                };
                self.sink.line_suffix_close(open);
                self.last = before;
                self.has_line_suffix = true;
            }
            Tag::StartLabelled(_) | Tag::EndLabelled => {}
        }
        Ok(())
    }
}
