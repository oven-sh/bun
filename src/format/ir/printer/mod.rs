//! Turns a document into text.
//!
//! This is the printer of Biome and oxc, which is an implementation of Prettier's
//! `printDocToString` for a flat document.

mod stack;

use self::stack::{
    AllPredicate, CallStack, FitsCallStack, FitsEndPredicate, FitsIndentStack, FitsQueue,
    IndentStack, PrintCallStack, PrintIndentStack, PrintQueue, Queue, SingleEntryPredicate,
    StackFrame, StackedStack,
};
use super::element::{
    BestFitting, Condition, DedentMode, FormatElement, GroupId, Interned, LineMode, PrintMode, Tag,
    TagKind, TextWidth,
};
use super::formatter::{END_LINE_SUFFIX, HARD_LINE_BREAK, Storage};
use crate::options::{FormatOptions, IndentStyle, LineEnding};

/// The document is malformed, which is a bug in the code that writes it.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum PrintError {
    /// Start and end tags do not match.
    InvalidDocument,
}

pub(crate) type PrintResult<T> = Result<T, PrintError>;

#[derive(Clone, Copy, Debug)]
pub(crate) struct PrinterOptions {
    pub(crate) indent_width: u8,
    pub(crate) print_width: usize,
    pub(crate) line_ending: LineEnding,
    pub(crate) indent_style: IndentStyle,
}

impl PrinterOptions {
    pub(crate) fn new(options: &FormatOptions, source: &[u8]) -> Self {
        PrinterOptions {
            indent_width: options.indent_width.value(),
            print_width: options.line_width.value() as usize,
            line_ending: options.line_ending.resolve(source),
            indent_style: options.indent_style,
        }
    }
}

/// The vectors of a [`Printer`], which keep their capacity from one file to the next.
#[derive(Default)]
pub(crate) struct PrinterBuffers {
    queue: Vec<Interned>,
    stack: Vec<StackFrame>,
    indentions: Vec<Indention>,
    history: Vec<Indention>,
    suffix_indentions: Vec<Indention>,
    line_suffixes: Vec<(Interned, PrintMode)>,
    group_modes: Vec<Option<PrintMode>>,
    fits_queue: Vec<Interned>,
    fits_stack: Vec<StackFrame>,
    fits_indentions: Vec<Indention>,
    fits_history: Vec<Indention>,
}

pub(crate) struct Printer<'d> {
    options: PrinterOptions,
    pool: &'d [FormatElement],
    variants: &'d [Interned],
    source: &'d [u8],
    text: &'d [u8],
    out: &'d mut Vec<u8>,
    pending_indent: Indention,
    pending_space: bool,
    /// An enclosing group has been found to fit, so what is in it does not have to be measured.
    measured_group_fits: bool,
    line_width: usize,
    has_empty_line: bool,
    line_suffixes: Vec<(Interned, PrintMode)>,
    /// By [`GroupId::index`].
    group_modes: Vec<Option<PrintMode>>,
    fits_queue: Vec<Interned>,
    fits_stack: Vec<StackFrame>,
    fits_indentions: Vec<Indention>,
    fits_history: Vec<Indention>,
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
    let taken = std::mem::take(buffers);
    let mut group_modes = taken.group_modes;
    group_modes.clear();
    let mut line_suffixes = taken.line_suffixes;
    line_suffixes.clear();
    let mut printer = Printer {
        options,
        pool: &storage.pool,
        variants: &storage.variants,
        source,
        text: &storage.text,
        out,
        pending_indent: Indention::default(),
        pending_space: false,
        measured_group_fits: true,
        line_width: 0,
        has_empty_line: false,
        line_suffixes,
        group_modes,
        fits_queue: taken.fits_queue,
        fits_stack: taken.fits_stack,
        fits_indentions: taken.fits_indentions,
        fits_history: taken.fits_history,
    };
    let mut stack = PrintCallStack::new(taken.stack);
    let mut queue: PrintQueue = Queue(taken.queue);
    queue.0.clear();
    queue.extend_back(root);
    let (mut indentions, mut history, mut suffixes) =
        (taken.indentions, taken.history, taken.suffix_indentions);
    indentions.clear();
    indentions.push(Indention::default());
    history.clear();
    suffixes.clear();
    let mut indent_stack = PrintIndentStack {
        stack: IndentStack {
            indentions,
            history,
        },
        suffixes,
    };

    let result = printer.print_all(&mut queue, &mut stack, &mut indent_stack);

    *buffers = PrinterBuffers {
        queue: queue.0,
        stack: stack.0,
        indentions: indent_stack.stack.indentions,
        history: indent_stack.stack.history,
        suffix_indentions: indent_stack.suffixes,
        line_suffixes: printer.line_suffixes,
        group_modes: printer.group_modes,
        fits_queue: printer.fits_queue,
        fits_stack: printer.fits_stack,
        fits_indentions: printer.fits_indentions,
        fits_history: printer.fits_history,
    };
    result
}

impl<'d> Printer<'d> {
    fn print_all(
        &mut self,
        queue: &mut PrintQueue,
        stack: &mut PrintCallStack,
        indent_stack: &mut PrintIndentStack,
    ) -> PrintResult<()> {
        while let Some(index) = queue.pop() {
            self.print_element(stack, indent_stack, queue, index)?;
            if queue.is_empty() {
                self.flush_line_suffixes(queue, stack, indent_stack, None);
            }
        }
        Ok(())
    }

    #[inline]
    fn element(&self, index: u32) -> PrintResult<&'d FormatElement> {
        self.pool.get(index as usize).ok_or(PrintError::InvalidDocument)
    }

    fn variants_of(&self, best_fitting: BestFitting) -> &'d [Interned] {
        self.variants.get(best_fitting.range()).unwrap_or_default()
    }

    fn insert_group_mode(&mut self, id: GroupId, mode: PrintMode) {
        let index = id.index();
        if self.group_modes.len() <= index {
            self.group_modes.resize(index + 1, None);
        }
        self.group_modes[index] = Some(mode);
    }

    #[inline]
    fn group_mode(&self, id: GroupId) -> Option<PrintMode> {
        self.group_modes.get(id.index()).copied().flatten()
    }

    /// Prints the element at `index`, which may put what it stands for in the queue.
    fn print_element(
        &mut self,
        stack: &mut PrintCallStack,
        indent_stack: &mut PrintIndentStack,
        queue: &mut PrintQueue,
        index: u32,
    ) -> PrintResult<()> {
        let mode = stack.top();
        match self.element(index)? {
            FormatElement::Nop => {}
            FormatElement::Skip(count) => queue.skip(*count),
            FormatElement::Space => {
                if self.line_width > 0 {
                    self.pending_space = true;
                }
            }
            FormatElement::Token(token) => {
                self.print_pending();
                self.out.extend_from_slice(token.as_bytes());
                self.line_width += token.len();
                self.has_empty_line = false;
            }
            FormatElement::SourceText(text) => {
                let bytes = self.source.get(text.range()).unwrap_or_default();
                self.print_text(bytes, text.width);
            }
            FormatElement::OwnedText(text) => {
                let bytes = self.text.get(text.range()).unwrap_or_default();
                self.print_text(bytes, text.width);
            }
            FormatElement::Line(line_mode) => {
                if mode.is_flat() {
                    match line_mode {
                        LineMode::Soft => return Ok(()),
                        LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty => {
                            if self.line_width > 0 {
                                self.pending_space = true;
                            }
                            return Ok(());
                        }
                        LineMode::Hard | LineMode::Empty => self.measured_group_fits = false,
                    }
                }

                if !self.line_suffixes.is_empty() {
                    let again = Interned {
                        start: index,
                        len: 1,
                    };
                    self.flush_line_suffixes(queue, stack, indent_stack, Some(again));
                    return Ok(());
                }

                // Not if the line is empty.
                if self.line_width > 0 {
                    self.trim_trailing_whitespace();
                    self.print_line_break();
                    self.has_empty_line = false;
                }
                if matches!(line_mode, LineMode::Empty | LineMode::SoftOrSpaceEmpty) && !self.has_empty_line {
                    self.print_line_break();
                    self.has_empty_line = true;
                }
                self.pending_space = false;
                self.pending_indent = indent_stack.stack.indention();
            }
            // `propagate_expand` has taken care of it.
            FormatElement::ExpandParent => {}
            FormatElement::LineSuffixBoundary => {
                self.flush_line_suffixes(queue, stack, indent_stack, Some(HARD_LINE_BREAK));
            }
            FormatElement::BestFitting(best_fitting) => {
                self.print_best_fitting(*best_fitting, queue, stack, indent_stack)?;
            }
            FormatElement::Interned(content) => queue.extend_back(*content),
            FormatElement::Tag(tag) => match tag {
                Tag::StartGroup(group) => {
                    let group_mode = if !group.mode().is_flat() {
                        self.measured_group_fits = true;
                        PrintMode::Expanded
                    } else if mode.is_flat() && self.measured_group_fits {
                        // An enclosing group fits, so this one does.
                        PrintMode::Flat
                    } else {
                        self.measured_group_fits = true;
                        if let Some(id) = group.id() {
                            self.insert_group_mode(id, PrintMode::Flat);
                        }
                        stack.push(TagKind::Group, PrintMode::Flat);
                        let fits = self.fits(queue, stack, indent_stack)?;
                        stack.pop(TagKind::Group)?;
                        if fits { PrintMode::Flat } else { PrintMode::Expanded }
                    };
                    stack.push(TagKind::Group, group_mode);
                    if let Some(id) = group.id() {
                        self.insert_group_mode(id, group_mode);
                    }
                }
                Tag::StartFill => self.print_fill_entries(queue, stack, indent_stack)?,
                Tag::StartIndent => {
                    indent_stack.stack.indent(self.options.indent_style);
                    stack.push(TagKind::Indent, mode);
                }
                Tag::StartDedent(dedent) => {
                    match dedent {
                        DedentMode::Level => indent_stack.stack.start_dedent(),
                        DedentMode::Root => indent_stack.stack.reset_indent(),
                    }
                    stack.push(TagKind::Dedent, mode);
                }
                Tag::StartAlign(align) => {
                    indent_stack.stack.align(align.count());
                    stack.push(TagKind::Align, mode);
                }
                Tag::StartConditionalContent(Condition {
                    mode: wanted,
                    group_id,
                }) => {
                    let group_mode = match group_id {
                        None => mode,
                        Some(id) => self.group_mode(*id).ok_or(PrintError::InvalidDocument)?,
                    };
                    if group_mode == *wanted {
                        stack.push(TagKind::ConditionalContent, mode);
                    } else {
                        queue.skip_content(TagKind::ConditionalContent, self.pool)?;
                    }
                }
                Tag::StartIndentIfGroupBreaks(id) => {
                    let group_mode = self.group_mode(*id).ok_or(PrintError::InvalidDocument)?;
                    if group_mode == PrintMode::Expanded {
                        indent_stack.stack.indent(self.options.indent_style);
                    }
                    stack.push(TagKind::IndentIfGroupBreaks, mode);
                }
                Tag::StartLineSuffix => {
                    indent_stack.push_suffix(indent_stack.stack.indention());
                    let content = queue.take_content(TagKind::LineSuffix, self.pool)?;
                    self.line_suffixes.push((content, mode));
                }
                Tag::StartLabelled(_) | Tag::StartEntry => stack.push(tag.kind(), mode),
                Tag::EndLabelled
                | Tag::EndEntry
                | Tag::EndGroup
                | Tag::EndConditionalContent
                | Tag::EndFill => stack.pop(tag.kind())?,
                Tag::EndIndentIfGroupBreaks(id) => {
                    if self.group_mode(*id) == Some(PrintMode::Expanded) {
                        indent_stack.stack.pop();
                    }
                    stack.pop(tag.kind())?;
                }
                Tag::EndIndent | Tag::EndAlign | Tag::EndLineSuffix => {
                    stack.pop(tag.kind())?;
                    indent_stack.stack.pop();
                }
                Tag::EndDedent(dedent) => {
                    match dedent {
                        DedentMode::Level => indent_stack.stack.end_dedent(),
                        DedentMode::Root => indent_stack.stack.pop(),
                    }
                    stack.pop(tag.kind())?;
                }
            },
        }
        Ok(())
    }

    fn fits(
        &mut self,
        queue: &PrintQueue,
        stack: &PrintCallStack,
        indent_stack: &PrintIndentStack,
    ) -> PrintResult<bool> {
        let mut measure = FitsMeasurer::new(queue, stack, indent_stack, self);
        let result = measure.fits(&mut AllPredicate);
        measure.finish();
        result
    }

    /// Puts the pending line suffixes in the queue, and after them `line_break`.
    fn flush_line_suffixes(
        &mut self,
        queue: &mut PrintQueue,
        stack: &mut PrintCallStack,
        indent_stack: &mut PrintIndentStack,
        line_break: Option<Interned>,
    ) {
        if self.line_suffixes.is_empty() {
            return;
        }
        if let Some(line_break) = line_break {
            queue.extend_back(line_break);
        }
        indent_stack.flush_suffixes();
        for (content, mode) in self.line_suffixes.drain(..).rev() {
            stack.push(TagKind::LineSuffix, mode);
            queue.extend_back(END_LINE_SUFFIX);
            queue.extend_back(content);
        }
    }

    fn print_best_fitting(
        &mut self,
        best_fitting: BestFitting,
        queue: &mut PrintQueue,
        stack: &mut PrintCallStack,
        indent_stack: &mut PrintIndentStack,
    ) -> PrintResult<()> {
        let mode = stack.top();
        let Some((&most_expanded, flatter)) = self.variants_of(best_fitting).split_last() else {
            return Err(PrintError::InvalidDocument);
        };

        if mode.is_flat() && self.measured_group_fits {
            queue.extend_back(*flatter.first().unwrap_or(&most_expanded));
            return self.print_entry(queue, stack, indent_stack, mode);
        }

        self.measured_group_fits = true;
        for &variant in flatter {
            if !matches!(self.element(variant.start)?, FormatElement::Tag(Tag::StartEntry)) {
                return Err(PrintError::InvalidDocument);
            }
            // Without the start tag: the frame for it has to be pushed here, with the mode.
            let content = Interned {
                start: variant.start + 1,
                len: variant.len.saturating_sub(1),
            };
            queue.extend_back(content);
            stack.push(TagKind::Entry, PrintMode::Flat);
            let variant_fits = self.fits(queue, stack, indent_stack)?;
            stack.pop(TagKind::Entry)?;
            queue.pop_slice();

            if variant_fits {
                queue.extend_back(variant);
                return self.print_entry(queue, stack, indent_stack, PrintMode::Flat);
            }
        }

        queue.extend_back(most_expanded);
        self.print_entry(queue, stack, indent_stack, PrintMode::Expanded)
    }

    fn is_at_start_entry(&self, queue: &PrintQueue) -> bool {
        matches!(queue.top(self.pool), Some(FormatElement::Tag(Tag::StartEntry)))
    }

    /// Puts as many items of a fill on each line as fit.
    ///
    /// For each item, its separator and the next item:
    /// - All three fit: the item and the separator are printed flat.
    /// - The item fits, the separator or the next item does not: the item is printed flat and the
    ///   separator expanded.
    /// - The item does not fit: both are printed expanded.
    fn print_fill_entries(
        &mut self,
        queue: &mut PrintQueue,
        stack: &mut PrintCallStack,
        indent_stack: &mut PrintIndentStack,
    ) -> PrintResult<()> {
        let mode = stack.top();

        if self.measured_group_fits && mode.is_flat() {
            stack.push(TagKind::Fill, PrintMode::Flat);
            return Ok(());
        }

        stack.push(TagKind::Fill, mode);

        'entries: while self.is_at_start_entry(queue) {
            let mut measurer = FitsMeasurer::new_flat(queue, stack, indent_stack, self);

            // The number of pairs of an item and a separator that fit on the line.
            let mut flat_pairs = 0usize;
            let mut item_fits = measurer.fill_entry_fits(PrintMode::Flat)?;

            let last_pair_layout = if item_fits {
                // Goes on to the first item or separator that does not fit, so that no item is
                // measured twice.
                loop {
                    if !measurer.is_at_start_entry() {
                        break FillPairLayout::Flat;
                    }
                    let separator_fits = measurer.fill_entry_fits(PrintMode::Flat)?;
                    if !separator_fits {
                        break FillPairLayout::ItemFlatSeparatorExpanded;
                    }
                    if !measurer.is_at_start_entry() {
                        break FillPairLayout::Flat;
                    }
                    item_fits = measurer.fill_entry_fits(PrintMode::Flat)?;
                    if item_fits {
                        flat_pairs += 1;
                    } else {
                        break FillPairLayout::ItemFlatSeparatorExpanded;
                    }
                }
            } else {
                FillPairLayout::Expanded
            };

            measurer.finish();

            for _ in 0..flat_pairs {
                // A group in the item is measured again and may break. Then what has been
                // measured from here on does not hold.
                let may_break = !self.measured_group_fits;
                self.print_fill_item(queue, stack, indent_stack, PrintMode::Flat, PrintMode::Flat)?;
                self.print_entry(queue, stack, indent_stack, PrintMode::Flat)?;
                if may_break {
                    continue 'entries;
                }
            }

            let (item_mode, separator_mode) = match last_pair_layout {
                FillPairLayout::Flat => (PrintMode::Flat, PrintMode::Flat),
                FillPairLayout::ItemFlatSeparatorExpanded => (PrintMode::Flat, PrintMode::Expanded),
                FillPairLayout::Expanded => (PrintMode::Expanded, PrintMode::Expanded),
            };
            self.print_fill_item(queue, stack, indent_stack, item_mode, separator_mode)?;

            if self.is_at_start_entry(queue) {
                // A group in an expanded separator is measured with what follows it flat.
                stack.push(TagKind::Fill, PrintMode::Flat);
                self.print_entry(queue, stack, indent_stack, separator_mode)?;
                stack.pop(TagKind::Fill)?;
            }
        }

        match queue.top(self.pool) {
            Some(FormatElement::Tag(Tag::EndFill)) => Ok(()),
            _ => Err(PrintError::InvalidDocument),
        }
    }

    /// Prints an item of a fill. Meanwhile, whoever measures past its end finds the mode that has
    /// been decided for the separator after it on the stack.
    fn print_fill_item(
        &mut self,
        queue: &mut PrintQueue,
        stack: &mut PrintCallStack,
        indent_stack: &mut PrintIndentStack,
        mode: PrintMode,
        separator_mode: PrintMode,
    ) -> PrintResult<()> {
        stack.push(TagKind::FillSeparator, separator_mode);
        self.print_entry(queue, stack, indent_stack, mode)?;
        stack.pop(TagKind::FillSeparator)
    }

    /// Prints everything from the [`Tag::StartEntry`] that is next in the queue to its
    /// [`Tag::EndEntry`], in `mode`.
    fn print_entry(
        &mut self,
        queue: &mut PrintQueue,
        stack: &mut PrintCallStack,
        indent_stack: &mut PrintIndentStack,
        mode: PrintMode,
    ) -> PrintResult<()> {
        if !self.is_at_start_entry(queue) {
            return Err(PrintError::InvalidDocument);
        }

        let mut depth = 0usize;
        while let Some(index) = queue.pop() {
            match self.element(index)? {
                FormatElement::Tag(Tag::StartEntry) => {
                    if depth == 0 {
                        depth = 1;
                        stack.push(TagKind::Entry, mode);
                        continue;
                    }
                    depth += 1;
                }
                FormatElement::Tag(Tag::EndEntry) => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        return stack.pop(TagKind::Entry);
                    }
                }
                _ => {}
            }
            self.print_element(stack, indent_stack, queue, index)?;
        }
        Err(PrintError::InvalidDocument)
    }

    /// The indentation and the space that are due before the next text.
    #[inline]
    fn print_pending(&mut self) {
        if !self.pending_indent.is_empty() {
            let indent = std::mem::take(&mut self.pending_indent);
            let (level, align) = (indent.level() as usize, indent.align() as usize);
            let width = level * self.options.indent_width as usize;
            match self.options.indent_style {
                IndentStyle::Tab => self.out.resize(self.out.len() + level, b'\t'),
                IndentStyle::Space => self.out.resize(self.out.len() + width, b' '),
            }
            self.out.resize(self.out.len() + align, b' ');
            self.line_width += width + align;
        }
        if self.pending_space {
            self.out.push(b' ');
            self.pending_space = false;
            self.line_width += 1;
        }
    }

    fn print_text(&mut self, text: &[u8], width: TextWidth) {
        self.print_pending();
        self.has_empty_line = false;
        if !width.is_multiline() {
            self.out.extend_from_slice(text);
            self.line_width += width.value() as usize;
            return;
        }
        let mut lines = bun_core::strings::split(text, b"\n");
        if let Some(first) = lines.next() {
            self.out.extend_from_slice(first);
        }
        let mut last = None;
        for line in lines {
            self.print_line_break();
            self.out.extend_from_slice(line);
            last = Some(line);
        }
        if let Some(last) = last {
            self.line_width = TextWidth::from_text(last, self.options.indent_width).value() as usize;
        }
    }

    #[inline]
    fn print_line_break(&mut self) {
        self.out.extend_from_slice(self.options.line_ending.as_bytes());
        self.line_width = 0;
    }

    fn trim_trailing_whitespace(&mut self) {
        while matches!(self.out.last(), Some(b' ' | b'\t')) {
            self.out.pop();
        }
    }
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

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Fits {
    Yes,
    No,
    /// It depends on what follows.
    Maybe,
}

/// Runs ahead of the printer to find out whether something fits on the line.
#[must_use = "it has to be finished"]
struct FitsMeasurer<'d, 'print> {
    pending_indent: Indention,
    pending_space: bool,
    has_line_suffix: bool,
    line_width: usize,
    queue: FitsQueue<'print>,
    stack: FitsCallStack<'print>,
    indent_stack: FitsIndentStack<'print>,
    printer: &'print mut Printer<'d>,
    must_be_flat: bool,
}

impl<'d, 'print> FitsMeasurer<'d, 'print> {
    fn new_flat(
        print_queue: &'print PrintQueue,
        print_stack: &'print PrintCallStack,
        print_indent_stack: &'print PrintIndentStack,
        printer: &'print mut Printer<'d>,
    ) -> Self {
        let mut measurer = Self::new(print_queue, print_stack, print_indent_stack, printer);
        measurer.must_be_flat = true;
        measurer
    }

    fn new(
        print_queue: &'print PrintQueue,
        print_stack: &'print PrintCallStack,
        print_indent_stack: &'print PrintIndentStack,
        printer: &'print mut Printer<'d>,
    ) -> Self {
        use std::mem::take;
        Self {
            pending_indent: printer.pending_indent,
            pending_space: printer.pending_space,
            has_line_suffix: !printer.line_suffixes.is_empty(),
            line_width: printer.line_width,
            queue: Queue(StackedStack::with_vec(&print_queue.0, take(&mut printer.fits_queue))),
            stack: CallStack(StackedStack::with_vec(&print_stack.0, take(&mut printer.fits_stack))),
            indent_stack: IndentStack {
                indentions: StackedStack::with_vec(
                    &print_indent_stack.stack.indentions,
                    take(&mut printer.fits_indentions),
                ),
                history: StackedStack::with_vec(
                    &print_indent_stack.stack.history,
                    take(&mut printer.fits_history),
                ),
            },
            must_be_flat: false,
            printer,
        }
    }

    /// Gives the vectors back to the printer.
    fn finish(self) {
        self.printer.fits_queue = self.queue.0.into_vec();
        self.printer.fits_stack = self.stack.0.into_vec();
        self.printer.fits_indentions = self.indent_stack.indentions.into_vec();
        self.printer.fits_history = self.indent_stack.history.into_vec();
    }

    fn is_at_start_entry(&self) -> bool {
        matches!(self.queue.top(self.printer.pool), Some(FormatElement::Tag(Tag::StartEntry)))
    }

    /// Whether what is in the queue fits on the line, up to the first line break, the end of the
    /// document, or where `predicate` says.
    fn fits(&mut self, predicate: &mut impl FitsEndPredicate) -> PrintResult<bool> {
        while let Some(index) = self.queue.pop() {
            let element = self.printer.element(index)?;
            match self.fits_element(element)? {
                Fits::Yes => return Ok(true),
                Fits::No => return Ok(false),
                Fits::Maybe => {
                    if predicate.is_end(element)? {
                        break;
                    }
                }
            }
        }
        Ok(true)
    }

    /// Whether the item or the separator of a fill that is next in the queue fits in `mode`.
    fn fill_entry_fits(&mut self, mode: PrintMode) -> PrintResult<bool> {
        if !self.is_at_start_entry() {
            return Err(PrintError::InvalidDocument);
        }
        self.stack.push(TagKind::Fill, mode);
        let mut predicate = SingleEntryPredicate::default();
        let fits = self.fits(&mut predicate)?;
        if predicate.is_done() {
            self.stack.pop(TagKind::Fill)?;
        }
        Ok(fits)
    }

    fn fits_element(&mut self, element: &'d FormatElement) -> PrintResult<Fits> {
        let mode = self.stack.top();
        let print_width = self.printer.options.print_width;
        let indent_style = self.printer.options.indent_style;

        match element {
            FormatElement::Nop => {}
            FormatElement::Skip(count) => self.queue.skip(*count),
            FormatElement::Space => {
                if self.line_width > 0 {
                    self.pending_space = true;
                }
            }
            FormatElement::Line(line_mode) => {
                if mode.is_flat() {
                    match line_mode {
                        LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty => self.pending_space = true,
                        LineMode::Soft => {}
                        // The break is there in any mode, and everything up to it fits. In a
                        // fill, an item that has a comment on a line of its own before it does
                        // not have to be alone on its line because of that. If the content is
                        // in a group, the group is known to break and this is not asked.
                        LineMode::Hard | LineMode::Empty => return Ok(Fits::Yes),
                    }
                } else {
                    // This is past the end of what is measured, in content that is expanded.
                    if self.pending_space {
                        self.line_width += 1;
                        if self.line_width > print_width {
                            return Ok(Fits::No);
                        }
                    }
                    return Ok(Fits::Yes);
                }
            }
            FormatElement::Token(token) => {
                return Ok(self.fits_text(TextWidth::single(token.len() as u32)));
            }
            FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                return Ok(self.fits_text(text.width));
            }
            FormatElement::LineSuffixBoundary => {
                if self.has_line_suffix {
                    return Ok(Fits::No);
                }
            }
            FormatElement::ExpandParent => {
                if self.must_be_flat {
                    return Ok(Fits::No);
                }
            }
            FormatElement::BestFitting(best_fitting) => {
                let variants = self.printer.variants_of(*best_fitting);
                let variant = match mode {
                    PrintMode::Flat => variants.first(),
                    PrintMode::Expanded => variants.last(),
                };
                let &variant = variant.ok_or(PrintError::InvalidDocument)?;
                self.queue.extend_back(variant);
            }
            FormatElement::Interned(content) => self.queue.extend_back(*content),
            FormatElement::Tag(tag) => match tag {
                Tag::StartIndent => {
                    self.indent_stack.indent(indent_style);
                    self.stack.push(TagKind::Indent, mode);
                }
                Tag::StartDedent(dedent) => {
                    match dedent {
                        DedentMode::Level => self.indent_stack.start_dedent(),
                        DedentMode::Root => self.indent_stack.reset_indent(),
                    }
                    self.stack.push(TagKind::Dedent, mode);
                }
                Tag::StartAlign(align) => {
                    self.indent_stack.align(align.count());
                    self.stack.push(TagKind::Align, mode);
                }
                Tag::StartGroup(group) => {
                    if self.must_be_flat && !group.mode().is_flat() {
                        return Ok(Fits::No);
                    }
                    let group_mode = match group.mode().is_flat() {
                        true => mode,
                        false => PrintMode::Expanded,
                    };
                    self.stack.push(TagKind::Group, group_mode);
                    if let Some(id) = group.id() {
                        self.printer.insert_group_mode(id, group_mode);
                    }
                }
                Tag::StartConditionalContent(condition) => {
                    let group_mode = match condition.group_id {
                        None => mode,
                        Some(id) => self.printer.group_mode(id).unwrap_or(mode),
                    };
                    if group_mode == condition.mode {
                        self.stack.push(TagKind::ConditionalContent, mode);
                    } else {
                        self.queue.skip_content(TagKind::ConditionalContent, self.printer.pool)?;
                    }
                }
                Tag::StartIndentIfGroupBreaks(id) => {
                    if self.printer.group_mode(*id).unwrap_or(mode) == PrintMode::Expanded {
                        self.indent_stack.indent(indent_style);
                    }
                    self.stack.push(TagKind::IndentIfGroupBreaks, mode);
                }
                Tag::StartLineSuffix => {
                    self.queue.skip_content(TagKind::LineSuffix, self.printer.pool)?;
                    self.has_line_suffix = true;
                }
                Tag::EndLineSuffix => return Err(PrintError::InvalidDocument),
                Tag::StartFill | Tag::StartLabelled(_) => self.stack.push(tag.kind(), mode),
                Tag::StartEntry => {
                    // After an item that is being printed, `mode` is that of the separator.
                    let _ = self.stack.pop(TagKind::FillSeparator);
                    self.stack.push(TagKind::Entry, mode);
                }
                Tag::EndFill => {
                    let _ = self.stack.pop(TagKind::FillSeparator);
                    self.stack.pop(TagKind::Fill)?;
                }
                Tag::EndLabelled
                | Tag::EndEntry
                | Tag::EndGroup
                | Tag::EndConditionalContent => self.stack.pop(tag.kind())?,
                Tag::EndIndentIfGroupBreaks(id) => {
                    if self.printer.group_mode(*id).unwrap_or(mode) == PrintMode::Expanded {
                        self.indent_stack.pop();
                    }
                    self.stack.pop(tag.kind())?;
                }
                Tag::EndIndent | Tag::EndAlign => {
                    self.stack.pop(tag.kind())?;
                    self.indent_stack.pop();
                }
                Tag::EndDedent(dedent) => {
                    if *dedent == DedentMode::Level {
                        self.indent_stack.end_dedent();
                    }
                    self.stack.pop(tag.kind())?;
                }
            },
        }
        Ok(Fits::Maybe)
    }

    #[inline]
    fn fits_text(&mut self, width: TextWidth) -> Fits {
        let print_width = self.printer.options.print_width;
        let indent = std::mem::take(&mut self.pending_indent);
        self.line_width += indent.level() as usize * self.printer.options.indent_width as usize
            + indent.align() as usize;
        if self.pending_space {
            self.line_width += 1;
        }
        self.line_width += width.value() as usize;
        if width.is_multiline() {
            return match self.must_be_flat || self.line_width > print_width {
                true => Fits::No,
                false => Fits::Yes,
            };
        }
        if self.line_width > print_width {
            return Fits::No;
        }
        self.pending_space = false;
        Fits::Maybe
    }
}
