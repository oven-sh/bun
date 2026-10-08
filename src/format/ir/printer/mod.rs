//! Turns a document into text.
//!
//! This is an implementation of Prettier's `printDocToString` for a flat document, which started
//! as the printer of Biome and oxc.
//!
//! - [`Printer::print_elements`] goes through the elements and decides for each group whether it
//!   is printed on one line.
//! - `document::propagate_expand` has measured most groups: see [`Flat`]. For those, the decision
//!   takes the width of the group and a look at what follows it up to the next possible line
//!   break ([`Printer::fits`]), and a group that fits is printed by [`Printer::print_flat`], which
//!   has nothing to decide.
//! - A group that has not been measured is measured here, element by element.

mod measure;
mod output;

use self::measure::Measure;
use self::output::Out;
use super::element::{
    BestFitting, Condition, CursorMark, DedentMode, Flat, FlatFlags, FormatElement, Group, GroupId, Interned, LineMode,
    PrintMode, Tag, TextWidth,
};
use super::formatter::{END_LINE_SUFFIX, Storage, line_break};
use crate::options::{Flavor, FormatOptions, IndentStyle, LineEnding};
use smallvec::SmallVec;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum PrintError {
    /// Start and end tags do not match, which is a bug in the code that writes the document.
    InvalidDocument,
    /// What is being measured depends on a group that was passed over by its [`Flat`]. It has to
    /// be measured again, element by element. This does not leave the printer.
    MeasureAgain,
}

pub(crate) type PrintResult<T> = Result<T, PrintError>;

#[derive(Clone, Copy, Debug)]
pub(crate) struct PrinterOptions {
    pub(crate) indent_width: u8,
    pub(crate) print_width: usize,
    pub(crate) line_ending: LineEnding,
    pub(crate) indent_style: IndentStyle,
    pub(crate) flavor: Flavor,
    /// See `FormatOptions::is_in_markdown`.
    pub(crate) marks_line_breaks_in_texts: bool,
}

impl PrinterOptions {
    pub(crate) fn new(options: &FormatOptions, source: &[u8]) -> Self {
        PrinterOptions {
            indent_width: options.indent_width.value(),
            print_width: options.line_width.value() as usize,
            line_ending: options.line_ending.resolve(source),
            indent_style: options.indent_style,
            flavor: options.flavor,
            marks_line_breaks_in_texts: options.is_in_markdown,
        }
    }
}

/// Some elements of the pool that follow one another: those from `at` up to `end`.
#[derive(Copy, Clone)]
struct Run {
    at: u32,
    end: u32,
}

impl Run {
    #[inline]
    fn of(interned: Interned) -> Run {
        Run {
            at: interned.start,
            end: interned.start.saturating_add(interned.len),
        }
    }
}

/// A [`Run`] that is being gone through.
#[derive(Clone)]
struct Elements<'d> {
    rest: std::slice::Iter<'d, FormatElement>,
    /// [`Run::end`]
    end: u32,
}

impl<'d> Elements<'d> {
    #[inline]
    fn new(run: Run, pool: &'d [FormatElement]) -> Self {
        let rest = pool.get(run.at as usize..run.end as usize).unwrap_or_default();
        Elements {
            rest: rest.iter(),
            end: run.at + rest.len() as u32,
        }
    }

    #[inline]
    fn next(&mut self) -> Option<&'d FormatElement> {
        self.rest.next()
    }

    /// The index of the next element.
    #[inline]
    fn at(&self) -> u32 {
        self.end - self.rest.len() as u32
    }

    /// What is left.
    #[inline]
    fn run(&self) -> Run {
        Run {
            at: self.at(),
            end: self.end,
        }
    }

    #[inline]
    fn is_empty(&self) -> bool {
        self.rest.len() == 0
    }

    /// Passes over the next `count` elements.
    #[inline]
    fn skip(&mut self, count: u32) {
        self.rest = self.rest.as_slice().get(count as usize..).unwrap_or_default().iter();
    }

    /// The element at `index`, which is not behind, is the next.
    #[inline]
    fn move_to(&mut self, index: u32) {
        self.skip(index.saturating_sub(self.at()));
    }
}

/// The tags that set the mode of their content.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum FrameKind {
    Root,
    Group,
    Fill,
    /// There is no such tag. See [`Printer::print_fill_item`].
    FillSeparator,
    Entry,
    LineSuffix,
}

/// What is pushed for a start tag and popped for its end tag.
#[derive(Copy, Clone)]
struct Frame {
    kind: FrameKind,
    mode: PrintMode,
}

/// The vectors of a [`Printer`], which keep their capacity from one file to the next.
#[derive(Default)]
pub(crate) struct PrinterBuffers {
    /// What is to be printed after the current run. The last comes first.
    queue: Vec<Run>,
    frames: Vec<Frame>,
    /// The indentation of every enclosing indent and align. A dedent moves the top to `history`
    /// and its end moves it back.
    indentions: Vec<Indention>,
    history: Vec<Indention>,
    /// The indentation at each pending line suffix.
    suffix_indentions: Vec<Indention>,
    line_suffixes: Vec<(Interned, PrintMode)>,
    /// By [`GroupId::index`].
    group_modes: Vec<Option<PrintMode>>,
    /// What a [`Measure`] puts on top of `queue` and `frames`, which it leaves as they are.
    measure_queue: Vec<Run>,
    measure_frames: Vec<Frame>,
    /// Where the [`FormatElement::Cursor`]s of the last document are in its text.
    pub(crate) marks: [Option<u32>; 2],
}

struct Printer<'d> {
    options: PrinterOptions,
    pool: &'d [FormatElement],
    variants: &'d [Interned],
    source: &'d [u8],
    text: &'d [u8],
    out: Out<'d>,
    pending_indent: Indention,
    pending_space: bool,
    /// An enclosing group has been found to fit, so what is in it does not have to be measured.
    measured_group_fits: bool,
    has_empty_line: bool,
    line_width: usize,
    /// What is being printed.
    elements: Elements<'d>,
    /// That of the last of `buffers.frames`.
    mode: PrintMode,
    /// `buffers.marks[i]` is after the pending indentation and space, if those are printed.
    is_mark_pending: [bool; 2],
    /// The length of `out` before anything is printed.
    start: usize,
    buffers: &'d mut PrinterBuffers,
}

/// Appends the text of the document `root` to `out`.
pub(crate) fn print(
    root: Interned,
    storage: &Storage,
    source: &[u8],
    options: PrinterOptions,
    buffers: &mut PrinterBuffers,
    out: &mut Vec<u8>,
) -> PrintResult<()> {
    buffers.queue.clear();
    buffers.frames.clear();
    buffers.frames.push(Frame {
        kind: FrameKind::Root,
        mode: PrintMode::Expanded,
    });
    buffers.indentions.clear();
    buffers.indentions.push(Indention::default());
    buffers.history.clear();
    buffers.suffix_indentions.clear();
    buffers.line_suffixes.clear();
    buffers.group_modes.clear();
    buffers.marks = [None; 2];
    let start = out.len();
    let mut printer = Printer {
        options,
        pool: &storage.pool,
        variants: &storage.variants,
        source,
        text: &storage.text,
        out: Out::new(out, source.len() + source.len() / 8 + 64),
        pending_indent: Indention::default(),
        pending_space: false,
        measured_group_fits: true,
        has_empty_line: false,
        line_width: 0,
        elements: Elements::new(Run::of(root), &storage.pool),
        mode: PrintMode::Expanded,
        is_mark_pending: [false; 2],
        start,
        buffers,
    };
    let result = printer.print_all();
    printer.pull_marks_back();
    printer.out.finish();
    result
}

impl<'d> Printer<'d> {
    fn print_all(&mut self) -> PrintResult<()> {
        loop {
            self.print_elements::<false>(PrintMode::Expanded)?;
            if self.buffers.line_suffixes.is_empty() {
                return Ok(());
            }
            self.flush_line_suffixes(None);
        }
    }

    // ───────────────────────────── the queue ─────────────────────────────

    /// The next element, which is removed from the queue.
    #[inline]
    fn next(&mut self) -> Option<&'d FormatElement> {
        loop {
            if let Some(element) = self.elements.next() {
                return Some(element);
            }
            self.elements = Elements::new(self.buffers.queue.pop()?, self.pool);
        }
    }

    /// Puts `elements` before everything that is in the queue.
    #[inline]
    fn print_next(&mut self, elements: Interned) {
        if !self.elements.is_empty() {
            self.buffers.queue.push(self.elements.run());
        }
        self.elements = Elements::new(Run::of(elements), self.pool);
    }

    /// The next element that stands for itself.
    fn peek(&self) -> Option<&'d FormatElement> {
        first_of(self.elements.run(), self.pool)
            .or_else(|| self.buffers.queue.iter().rev().find_map(|&run| first_of(run, self.pool)))
    }

    fn is_at_start_entry(&self) -> bool {
        matches!(self.peek(), Some(FormatElement::Tag(Tag::StartEntry)))
    }

    // ───────────────────────────── modes ─────────────────────────────

    #[inline]
    fn push(&mut self, kind: FrameKind, mode: PrintMode) {
        self.buffers.frames.push(Frame { kind, mode });
        self.mode = mode;
    }

    /// Fails unless the innermost frame is of `kind`.
    #[inline]
    fn pop(&mut self, kind: FrameKind) -> PrintResult<()> {
        match *self.buffers.frames.as_slice() {
            [.., below, top] if top.kind == kind => {
                self.buffers.frames.pop();
                self.mode = below.mode;
                Ok(())
            }
            _ => Err(PrintError::InvalidDocument),
        }
    }

    fn insert_group_mode(&mut self, id: GroupId, mode: PrintMode) {
        let (index, modes) = (id.index(), &mut self.buffers.group_modes);
        if modes.len() <= index {
            modes.resize((index + 1).max(modes.len() * 2).max(64), None);
        }
        modes[index] = Some(mode);
    }

    #[inline]
    fn group_mode(&self, id: GroupId) -> Option<PrintMode> {
        self.buffers.group_modes.get(id.index()).copied().flatten()
    }

    fn variants_of(&self, best_fitting: BestFitting) -> &'d [Interned] {
        self.variants.get(best_fitting.range()).unwrap_or_default()
    }

    /// What has been found out about `interned`.
    #[inline]
    fn flat_of(&self, interned: Interned) -> Flat {
        match (interned.start as usize).checked_sub(1).and_then(|before| self.pool.get(before)) {
            Some(FormatElement::Skip(skip)) if skip.len == interned.len => skip.flat,
            _ => Flat::default(),
        }
    }

    /// Whether [`Printer::print_flat`] can print content that is `flat`.
    #[inline]
    fn can_print_flat(&self, flat: Flat) -> bool {
        flat.flags.has(FlatFlags::MEASURED)
            && (!flat.flags.has(FlatFlags::HAS_LINE_SUFFIX_BOUNDARY) || self.buffers.line_suffixes.is_empty())
    }

    // ───────────────────────────── indentation ─────────────────────────────

    #[inline]
    fn indention(&self) -> Indention {
        self.buffers.indentions.last().copied().unwrap_or_default()
    }

    #[inline]
    fn indent(&mut self) {
        let next = self.indention().increment_level(self.options.indent_style);
        self.buffers.indentions.push(next);
    }

    // ───────────────────────────── printing ─────────────────────────────

    /// Prints what is in the queue.
    ///
    /// `ENTRY`: only from the [`Tag::StartEntry`] that is next in the queue to its
    /// [`Tag::EndEntry`], in `entry_mode`.
    fn print_elements<const ENTRY: bool>(&mut self, entry_mode: PrintMode) -> PrintResult<()> {
        let mut depth = 0usize;
        loop {
            let Some(element) = self.next() else {
                return if ENTRY { Err(PrintError::InvalidDocument) } else { Ok(()) };
            };
            match element {
                FormatElement::Nop => {}
                FormatElement::Cursor(mark) => self.note_mark(*mark),
                FormatElement::Skip(skip) => self.elements.skip(skip.len),
                FormatElement::Space => {
                    if self.line_width > 0 {
                        self.pending_space = true;
                    }
                }
                FormatElement::Token(token) => {
                    self.print_pending();
                    self.out.token(token);
                    self.line_width += token.len();
                    self.has_empty_line = false;
                }
                FormatElement::TokenIfBreaks(token) => {
                    if !self.mode.is_flat() {
                        self.print_pending();
                        self.out.token(token);
                        self.line_width += token.len();
                        self.has_empty_line = false;
                    }
                }
                FormatElement::SourceText(text) => self.print_text(self.source, text.range(), text.width),
                FormatElement::OwnedText(text) => self.print_text(self.text, text.range(), text.width),
                FormatElement::Line(line_mode) => self.print_line(*line_mode),
                // `propagate_expand` has taken care of it.
                FormatElement::ExpandParent => {}
                FormatElement::LineSuffixBoundary => self.flush_line_suffixes(Some(line_break(LineMode::Hard))),
                FormatElement::BestFitting(best_fitting) => self.print_best_fitting(*best_fitting)?,
                FormatElement::Interned(content) => self.print_next(*content),
                FormatElement::Tag(tag) => match tag {
                    Tag::StartGroup(group) => {
                        let group_mode = if !group.mode().is_flat() {
                            self.measured_group_fits = true;
                            PrintMode::Expanded
                        } else if self.mode.is_flat() && self.measured_group_fits {
                            // An enclosing group fits, so this one does.
                            PrintMode::Flat
                        } else {
                            self.measured_group_fits = true;
                            if let Some(id) = group.id() {
                                self.insert_group_mode(id, PrintMode::Flat);
                            }
                            if self.group_fits(group)? { PrintMode::Flat } else { PrintMode::Expanded }
                        };
                        if let Some(id) = group.id() {
                            self.insert_group_mode(id, group_mode);
                        }
                        if group_mode.is_flat() && self.can_print_flat(group.flat()) && group.end() < self.elements.end {
                            let content = Run {
                                at: self.elements.at(),
                                end: group.end(),
                            };
                            self.elements.move_to(group.end() + 1);
                            self.print_flat(content)?;
                        } else {
                            self.push(FrameKind::Group, group_mode);
                        }
                    }
                    Tag::EndGroup => self.pop(FrameKind::Group)?,
                    Tag::StartFill => self.print_fill_entries()?,
                    Tag::EndFill => self.pop(FrameKind::Fill)?,
                    Tag::StartEntry => {
                        if ENTRY {
                            depth += 1;
                            if depth == 1 {
                                self.push(FrameKind::Entry, entry_mode);
                                continue;
                            }
                        }
                        self.push(FrameKind::Entry, self.mode);
                    }
                    Tag::EndEntry => {
                        self.pop(FrameKind::Entry)?;
                        if ENTRY {
                            depth = depth.saturating_sub(1);
                            if depth == 0 {
                                return Ok(());
                            }
                        }
                    }
                    Tag::StartIndent => self.indent(),
                    Tag::StartIndentWithLine(line_mode) => {
                        self.indent();
                        self.print_line(*line_mode);
                    }
                    Tag::EndIndentWithLine(line_mode) => {
                        self.buffers.indentions.pop();
                        self.print_line(*line_mode);
                    }
                    Tag::StartDedent(DedentMode::Level) => {
                        if let Some(indention) = self.buffers.indentions.pop() {
                            self.buffers.history.push(indention);
                        }
                    }
                    Tag::StartDedent(DedentMode::Root) => self.buffers.indentions.push(Indention::default()),
                    Tag::StartAlign(align) => {
                        let next = self.indention().set_align(align.count());
                        self.buffers.indentions.push(next);
                    }
                    Tag::StartConditionalContent(Condition {
                        mode: wanted,
                        group_id,
                    }) => {
                        let group_mode = match group_id {
                            None => self.mode,
                            Some(id) => self.group_mode(*id).ok_or(PrintError::InvalidDocument)?,
                        };
                        if group_mode != *wanted {
                            skip_conditional_content(&mut self.elements)?;
                        }
                    }
                    Tag::StartIndentIfGroupBreaks(id) => {
                        if self.group_mode(*id).ok_or(PrintError::InvalidDocument)? == PrintMode::Expanded {
                            self.indent();
                        }
                    }
                    Tag::EndIndentIfGroupBreaks(id) => {
                        if self.group_mode(*id) == Some(PrintMode::Expanded) {
                            self.buffers.indentions.pop();
                        }
                    }
                    Tag::StartLineSuffix => {
                        let indention = self.indention();
                        self.buffers.suffix_indentions.push(indention);
                        let content = take_line_suffix(&mut self.elements)?;
                        self.buffers.line_suffixes.push((content, self.mode));
                    }
                    Tag::EndLineSuffix => {
                        self.pop(FrameKind::LineSuffix)?;
                        self.buffers.indentions.pop();
                    }
                    Tag::EndIndent | Tag::EndAlign | Tag::EndDedent(DedentMode::Root) => {
                        self.buffers.indentions.pop();
                    }
                    Tag::EndDedent(DedentMode::Level) => {
                        if let Some(indention) = self.buffers.history.pop() {
                            self.buffers.indentions.push(indention);
                        }
                    }
                    Tag::StartLabelled(_) | Tag::EndLabelled | Tag::EndConditionalContent => {}
                },
            }
        }
    }

    #[inline]
    fn print_line(&mut self, line_mode: LineMode) {
        if self.mode.is_flat() {
            match line_mode {
                LineMode::Soft | LineMode::SoftEmpty => return,
                LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty => {
                    if self.line_width > 0 {
                        self.pending_space = true;
                    }
                    return;
                }
                LineMode::Hard | LineMode::Empty => self.measured_group_fits = false,
            }
        }

        // They come first, and then this again.
        if !self.buffers.line_suffixes.is_empty() {
            return self.flush_line_suffixes(Some(line_break(line_mode)));
        }

        // Not if the line is empty.
        if self.line_width > 0 {
            self.out.trim_trailing_whitespace();
            self.pull_marks_back();
            self.print_line_break();
            self.has_empty_line = false;
        }
        let is_empty_line = matches!(line_mode, LineMode::Empty | LineMode::SoftOrSpaceEmpty | LineMode::SoftEmpty);
        if is_empty_line && !self.has_empty_line {
            self.print_line_break();
            self.has_empty_line = true;
        }
        self.pending_space = false;
        self.pending_indent = self.indention();
    }

    /// Prints everything from the [`Tag::StartEntry`] that is next in the queue to its
    /// [`Tag::EndEntry`], in `mode`.
    fn print_entry(&mut self, mode: PrintMode) -> PrintResult<()> {
        match self.is_at_start_entry() {
            true => self.print_elements::<true>(mode),
            false => Err(PrintError::InvalidDocument),
        }
    }

    /// Prints content on one line that is [`FlatFlags::MEASURED`]: there is nothing in it that
    /// could break the line, and nothing that depends on anything outside of it.
    fn print_flat(&mut self, content: Run) -> PrintResult<()> {
        let mut queue = SmallVec::<[Elements<'d>; 8]>::new();
        let mut elements = Elements::new(content, self.pool);
        loop {
            while let Some(element) = elements.next() {
                match element {
                    FormatElement::Token(token) => {
                        self.print_pending();
                        self.out.token(token);
                        self.line_width += token.len();
                    }
                    FormatElement::SourceText(text) => self.print_text(self.source, text.range(), text.width),
                    FormatElement::OwnedText(text) => self.print_text(self.text, text.range(), text.width),
                    FormatElement::Space
                    | FormatElement::Line(LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty)
                    | FormatElement::Tag(
                        Tag::StartIndentWithLine(LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty)
                        | Tag::EndIndentWithLine(LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty),
                    ) => {
                        if self.line_width > 0 {
                            self.pending_space = true;
                        }
                    }
                    FormatElement::Skip(skip) => elements.skip(skip.len),
                    FormatElement::Interned(interned) => {
                        queue.push(std::mem::replace(&mut elements, Elements::new(Run::of(*interned), self.pool)));
                    }
                    FormatElement::BestFitting(best_fitting) => {
                        let flattest = self.variants_of(*best_fitting).first().ok_or(PrintError::InvalidDocument)?;
                        queue.push(std::mem::replace(&mut elements, Elements::new(Run::of(*flattest), self.pool)));
                    }
                    FormatElement::Tag(Tag::StartGroup(group)) => {
                        if let Some(id) = group.id() {
                            self.insert_group_mode(id, PrintMode::Flat);
                        }
                    }
                    FormatElement::Tag(Tag::StartConditionalContent(condition)) => {
                        if condition.mode != PrintMode::Flat {
                            skip_conditional_content(&mut elements)?;
                        }
                    }
                    FormatElement::Line(LineMode::Hard | LineMode::Empty)
                    | FormatElement::Tag(
                        Tag::StartLineSuffix
                        | Tag::StartIndentWithLine(LineMode::Hard | LineMode::Empty)
                        | Tag::EndIndentWithLine(LineMode::Hard | LineMode::Empty),
                    ) => {
                        return Err(PrintError::InvalidDocument);
                    }
                    FormatElement::Cursor(mark) => self.note_mark(*mark),
                    FormatElement::Nop
                    | FormatElement::TokenIfBreaks(_)
                    | FormatElement::Line(LineMode::Soft | LineMode::SoftEmpty)
                    | FormatElement::ExpandParent
                    | FormatElement::LineSuffixBoundary
                    | FormatElement::Tag(_) => {}
                }
            }
            match queue.pop() {
                Some(rest) => elements = rest,
                None => break,
            }
        }
        self.has_empty_line &= self.line_width == 0;
        Ok(())
    }

    /// Puts the pending line suffixes in the queue, and after them `line_break`.
    fn flush_line_suffixes(&mut self, line_break: Option<Interned>) {
        if self.buffers.line_suffixes.is_empty() {
            return;
        }
        if let Some(line_break) = line_break {
            self.print_next(line_break);
        }
        let buffers = &mut *self.buffers;
        buffers.indentions.extend(buffers.suffix_indentions.drain(..).rev());
        while let Some((content, mode)) = self.buffers.line_suffixes.pop() {
            self.push(FrameKind::LineSuffix, mode);
            self.print_next(END_LINE_SUFFIX);
            self.print_next(content);
        }
    }

    fn print_best_fitting(&mut self, best_fitting: BestFitting) -> PrintResult<()> {
        let mode = self.mode;
        let Some((&most_expanded, flatter)) = self.variants_of(best_fitting).split_last() else {
            return Err(PrintError::InvalidDocument);
        };

        if mode.is_flat() && self.measured_group_fits {
            return self.print_variant(*flatter.first().unwrap_or(&most_expanded), mode);
        }

        self.measured_group_fits = true;
        for &variant in flatter {
            if !matches!(self.pool.get(variant.start as usize), Some(FormatElement::Tag(Tag::StartEntry))) {
                return Err(PrintError::InvalidDocument);
            }
            if self.variant_fits(variant)? {
                return self.print_variant(variant, PrintMode::Flat);
            }
        }
        self.print_variant(most_expanded, PrintMode::Expanded)
    }

    fn print_variant(&mut self, variant: Interned, mode: PrintMode) -> PrintResult<()> {
        if mode.is_flat() && self.can_print_flat(self.flat_of(variant)) {
            return self.print_flat(Run::of(variant));
        }
        self.print_next(variant);
        self.print_entry(mode)
    }

    /// Puts as many items of a fill on each line as fit.
    ///
    /// For each item, its separator and the next item:
    /// - All three fit: the item and the separator are printed flat.
    /// - The item fits, the separator or the next item does not: the item is printed flat and the
    ///   separator expanded.
    /// - The item does not fit: both are printed expanded.
    fn print_fill_entries(&mut self) -> PrintResult<()> {
        let mode = self.mode;

        if self.measured_group_fits && mode.is_flat() {
            self.push(FrameKind::Fill, PrintMode::Flat);
            return Ok(());
        }

        self.push(FrameKind::Fill, mode);

        'entries: while self.is_at_start_entry() {
            let (flat_pairs, last_pair_layout) = match self.measure_fill(true) {
                Err(PrintError::MeasureAgain) => self.measure_fill(false)?,
                measured => measured?,
            };

            for _ in 0..flat_pairs {
                // A group in the item is measured again and may break. Then what has been
                // measured from here on does not hold.
                let may_break = !self.measured_group_fits;
                self.print_fill_item(PrintMode::Flat, PrintMode::Flat)?;
                self.print_entry(PrintMode::Flat)?;
                if may_break {
                    continue 'entries;
                }
            }

            let (item_mode, separator_mode) = match last_pair_layout {
                FillPairLayout::Flat => (PrintMode::Flat, PrintMode::Flat),
                FillPairLayout::ItemFlatSeparatorExpanded => (PrintMode::Flat, PrintMode::Expanded),
                FillPairLayout::Expanded => (PrintMode::Expanded, PrintMode::Expanded),
            };
            self.print_fill_item(item_mode, separator_mode)?;

            if self.is_at_start_entry() {
                // A group in an expanded separator is measured with what follows it flat.
                self.push(FrameKind::Fill, PrintMode::Flat);
                self.print_entry(separator_mode)?;
                self.pop(FrameKind::Fill)?;
            }
        }

        match self.peek() {
            Some(FormatElement::Tag(Tag::EndFill)) => Ok(()),
            _ => Err(PrintError::InvalidDocument),
        }
    }

    /// The number of pairs of an item and a separator that fit on the line, and how the pair
    /// after them is printed.
    fn measure_fill(&mut self, uses_flat: bool) -> PrintResult<(usize, FillPairLayout)> {
        let mut measure = Measure::new(self, uses_flat);
        measure.must_be_flat = true;

        let mut flat_pairs = 0usize;
        if !self.fill_entry_fits(&mut measure)? {
            return Ok((0, FillPairLayout::Expanded));
        }
        // Goes on to the first item or separator that does not fit, so that no item is measured
        // twice.
        loop {
            if !self.is_measure_at_start_entry(&measure) {
                return Ok((flat_pairs, FillPairLayout::Flat));
            }
            if !self.fill_entry_fits(&mut measure)? {
                return Ok((flat_pairs, FillPairLayout::ItemFlatSeparatorExpanded));
            }
            if !self.is_measure_at_start_entry(&measure) {
                return Ok((flat_pairs, FillPairLayout::Flat));
            }
            if !self.fill_entry_fits(&mut measure)? {
                return Ok((flat_pairs, FillPairLayout::ItemFlatSeparatorExpanded));
            }
            flat_pairs += 1;
        }
    }

    /// Prints an item of a fill. Meanwhile, whoever measures past its end finds the mode that has
    /// been decided for the separator after it on the stack.
    fn print_fill_item(&mut self, mode: PrintMode, separator_mode: PrintMode) -> PrintResult<()> {
        self.push(FrameKind::FillSeparator, separator_mode);
        self.print_entry(mode)?;
        self.pop(FrameKind::FillSeparator)
    }

    /// The indentation and the space that are due before the next text.
    #[inline(always)]
    fn print_pending(&mut self) {
        if !self.pending_indent.is_empty() {
            self.print_pending_indent();
        }
        if self.pending_space {
            self.out.byte(b' ');
            self.pending_space = false;
            self.line_width += 1;
            if self.is_mark_pending != [false; 2] {
                self.move_pending_marks();
            }
        }
    }

    /// The text of the document ends here, for now.
    #[inline]
    fn position(&self) -> u32 {
        self.out.len().saturating_sub(self.start) as u32
    }

    #[cold]
    fn note_mark(&mut self, mark: CursorMark) {
        let index = match mark {
            CursorMark::RegionStart => 0,
            CursorMark::RegionEnd if self.buffers.marks[1].is_some() => return,
            CursorMark::RegionEnd => 1,
        };
        self.buffers.marks[index] = Some(self.position());
        self.is_mark_pending[index] = self.pending_space || !self.pending_indent.is_empty();
    }

    /// What was pending has been printed.
    #[cold]
    fn move_pending_marks(&mut self) {
        for index in 0..2 {
            if std::mem::take(&mut self.is_mark_pending[index]) {
                self.buffers.marks[index] = Some(self.position());
            }
        }
    }

    /// Prettier's `trim`: what was pending or at the end of the line is not printed after all.
    #[inline]
    fn pull_marks_back(&mut self) {
        if self.buffers.marks != [None; 2] {
            let end = self.position();
            self.buffers.marks = self.buffers.marks.map(|mark| mark.map(|at| at.min(end)));
            self.is_mark_pending = [false; 2];
        }
    }

    #[inline(never)]
    fn print_pending_indent(&mut self) {
        let indent = std::mem::take(&mut self.pending_indent);
        let (level, align) = (indent.level() as usize, indent.align() as usize);
        let width = level * self.options.indent_width as usize;
        match self.options.indent_style {
            IndentStyle::Tab => self.out.repeat(b'\t', level),
            IndentStyle::Space => self.out.repeat(b' ', width),
        }
        self.out.repeat(b' ', align);
        self.line_width += width + align;
        if !self.pending_space {
            self.move_pending_marks();
        }
    }

    /// Prints the part of `text` at `range`.
    #[inline(always)]
    fn print_text(&mut self, text: &[u8], range: std::ops::Range<usize>, width: TextWidth) {
        self.print_pending();
        self.has_empty_line = false;
        if width.is_multiline() {
            return self.print_lines(text.get(range).unwrap_or_default());
        }
        self.out.part(text, range);
        self.line_width += width.value() as usize;
    }

    #[cold]
    fn print_lines(&mut self, text: &[u8]) {
        let mut lines = bun_core::strings::split(text, b"\n");
        if let Some(first) = lines.next() {
            self.out.bytes(first);
        }
        let mut last = None;
        for line in lines {
            if self.options.marks_line_breaks_in_texts {
                self.out.bytes(b"\r");
            }
            self.print_line_break();
            self.out.bytes(line);
            last = Some(line);
        }
        if let Some(last) = last {
            self.line_width = TextWidth::from_text_as(last, self.options.flavor).value() as usize;
        }
    }

    #[inline]
    fn print_line_break(&mut self) {
        self.out.bytes(self.options.line_ending.as_bytes());
        self.line_width = 0;
    }
}

/// The first element of `run` that stands for itself.
fn first_of(run: Run, pool: &[FormatElement]) -> Option<&FormatElement> {
    let mut elements = pool.get(run.at as usize..run.end as usize)?.iter();
    while let Some(element) = elements.next() {
        match element {
            FormatElement::Nop | FormatElement::Cursor(_) => {}
            FormatElement::Skip(skip) => {
                if skip.len > 0 {
                    elements.nth(skip.len as usize - 1);
                }
            }
            FormatElement::Interned(interned) => {
                if let Some(first) = first_of(Run::of(*interned), pool) {
                    return Some(first);
                }
            }
            element => return Some(element),
        }
    }
    None
}

/// Passes over what is left of conditional content, whose start tag has just been taken from
/// `elements`, and its end tag. The two are in the same run, as they are if a builder writes them.
fn skip_conditional_content(elements: &mut Elements<'_>) -> PrintResult<()> {
    let mut depth = 1usize;
    while let Some(element) = elements.next() {
        match element {
            FormatElement::Skip(skip) => elements.skip(skip.len),
            FormatElement::Tag(Tag::StartConditionalContent(_)) => depth += 1,
            FormatElement::Tag(Tag::EndConditionalContent) => {
                depth -= 1;
                if depth == 0 {
                    return Ok(());
                }
            }
            _ => {}
        }
    }
    Err(PrintError::InvalidDocument)
}

/// The same for a [`Tag::StartLineSuffix`]. Returns what is between the tags.
fn take_line_suffix(elements: &mut Elements<'_>) -> PrintResult<Interned> {
    let start = elements.at();
    let mut depth = 1usize;
    while let Some(element) = elements.next() {
        match element {
            FormatElement::Tag(Tag::StartLineSuffix) => depth += 1,
            FormatElement::Tag(Tag::EndLineSuffix) => {
                depth -= 1;
                if depth == 0 {
                    return Ok(Interned {
                        start,
                        len: elements.at() - 1 - start,
                    });
                }
            }
            _ => {}
        }
    }
    Err(PrintError::InvalidDocument)
}

#[derive(Copy, Clone, Debug)]
enum FillPairLayout {
    /// The item, the separator and the next item fit.
    Flat,
    /// The item fits. The separator or the next item does not.
    ItemFlatSeparatorExpanded,
    /// The item does not fit.
    Expanded,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum Indention {
    /// A number of levels.
    Level(u16),
    /// A number of levels and `align` spaces, which `align_count` aligns add up to.
    Align {
        level: u16,
        align: u8,
        align_count: u16,
    },
}

impl Default for Indention {
    fn default() -> Self {
        Indention::Level(0)
    }
}

impl Indention {
    #[inline]
    const fn is_empty(self) -> bool {
        matches!(self, Indention::Level(0))
    }

    #[inline]
    fn level(self) -> u16 {
        match self {
            Indention::Level(level) | Indention::Align { level, .. } => level,
        }
    }

    #[inline]
    fn align(self) -> u8 {
        match self {
            Indention::Level(_) => 0,
            Indention::Align { align, .. } => align,
        }
    }

    /// One more level. With tabs, every align becomes a level too.
    fn increment_level(self, indent_style: IndentStyle) -> Self {
        match self {
            Indention::Level(level) => Indention::Level(level.saturating_add(1)),
            Indention::Align {
                level, align_count, ..
            } if indent_style.is_tab() => {
                Indention::Level(level.saturating_add(align_count).saturating_add(1))
            }
            Indention::Align {
                level,
                align,
                align_count,
            } => Indention::Align {
                level: level.saturating_add(1),
                align,
                align_count,
            },
        }
    }

    /// `count` more spaces.
    fn set_align(self, count: u8) -> Self {
        match self {
            Indention::Level(level) => Indention::Align {
                level,
                align: count,
                align_count: 1,
            },
            Indention::Align {
                level,
                align,
                align_count,
            } => Indention::Align {
                level,
                align: align.saturating_add(count),
                align_count: align_count.saturating_add(1),
            },
        }
    }
}
