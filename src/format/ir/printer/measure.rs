//! Running ahead of the printer to find out whether something fits on the line.

use super::{
    Elements, FlatFlags, FormatElement, Frame, FrameKind, Group, Interned, LineMode, PrintError,
    PrintMode, PrintResult, Printer, Run, Tag, TextWidth, first_of, skip_conditional_content,
    take_line_suffix,
};
use crate::ir::element::Flat;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Fits {
    Yes,
    No,
    /// It depends on what follows.
    Maybe,
}

/// Where a measurement is. The queue and the frames of the printer stay as they are: this has how
/// many of them are left, and what it adds is in `measure_queue` and `measure_frames`. So there
/// is one measurement at a time.
pub(super) struct Measure<'d> {
    line_width: usize,
    /// The width of the indentation that is due before the next text.
    pending_indent: usize,
    pending_space: bool,
    /// It is pending because of a [`FormatElement::Space`], which is a text to Prettier: it counts
    /// even if no text follows it on the line.
    is_space_element_pending: bool,
    has_line_suffix: bool,
    pub(super) must_be_flat: bool,
    /// Groups that are measured are passed over.
    uses_flat: bool,
    /// Something with a group that has an id in it has been passed over, so the mode of that group
    /// has not been noted.
    has_passed_group_ids: bool,
    elements: Elements<'d>,
    /// The number of runs that are left of the queue of the printer. One more than there are: the
    /// run that the printer is at comes first.
    queue_len: usize,
    /// The number of frames that are left of those of the printer.
    frames_len: usize,
    mode: PrintMode,
}

impl<'d> Measure<'d> {
    /// Starts where the printer is.
    pub(super) fn new(printer: &mut Printer<'d>, uses_flat: bool) -> Measure<'d> {
        printer.buffers.measure_queue.clear();
        printer.buffers.measure_frames.clear();
        let indent = printer.pending_indent;
        Measure {
            line_width: printer.line_width,
            pending_indent: indent.level() as usize * printer.options.indent_width as usize
                + indent.align() as usize,
            pending_space: printer.pending_space,
            is_space_element_pending: printer.pending_space,
            has_line_suffix: !printer.buffers.line_suffixes.is_empty(),
            must_be_flat: false,
            uses_flat,
            has_passed_group_ids: false,
            elements: printer.elements.clone(),
            queue_len: printer.buffers.queue.len(),
            frames_len: printer.buffers.frames.len(),
            mode: printer.mode,
        }
    }

    /// Whether the line is wider than `print_width` already.
    pub(super) fn is_past(&self, print_width: usize) -> bool {
        self.line_width + self.pending_indent + usize::from(self.pending_space) > print_width
    }
}

/// Tells when to stop measuring.
trait FitsEndPredicate {
    fn is_end(&mut self, element: &FormatElement) -> PrintResult<bool>;
}

/// Measures to the end of the document, or rather to the first line break.
struct AllPredicate;

impl FitsEndPredicate for AllPredicate {
    #[inline]
    fn is_end(&mut self, _element: &FormatElement) -> PrintResult<bool> {
        Ok(false)
    }
}

/// Measures from a [`Tag::StartEntry`] to its [`Tag::EndEntry`].
#[derive(Default)]
struct SingleEntryPredicate {
    depth: usize,
    is_done: bool,
}

impl FitsEndPredicate for SingleEntryPredicate {
    fn is_end(&mut self, element: &FormatElement) -> PrintResult<bool> {
        if self.is_done {
            return Ok(true);
        }
        match element {
            FormatElement::Tag(Tag::StartEntry) => self.depth += 1,
            FormatElement::Tag(Tag::EndEntry) => {
                self.depth = self
                    .depth
                    .checked_sub(1)
                    .ok_or(PrintError::InvalidDocument)?;
                self.is_done = self.depth == 0;
            }
            FormatElement::Interned(_)
            | FormatElement::Skip(_)
            | FormatElement::Nop
            | FormatElement::Cursor(_) => {}
            _ if self.depth == 0 => return Err(PrintError::InvalidDocument),
            _ => {}
        }
        Ok(self.is_done)
    }
}

impl<'d> Printer<'d> {
    /// Whether `group`, whose start tag has just been taken from the queue, fits on the line with
    /// what follows it up to the next possible line break.
    pub(super) fn group_fits(&mut self, group: &Group) -> PrintResult<bool> {
        let flat = group.flat();
        if flat.flags.has(FlatFlags::MEASURED) && group.end() < self.elements.end {
            let mut measure = Measure::new(self, true);
            if self.flat_fits(&mut measure, flat) == Fits::No {
                return Ok(false);
            }
            measure.elements.move_to(group.end() + 1);
            match self.fits(&mut measure, &mut AllPredicate) {
                Err(PrintError::MeasureAgain) => {}
                fits => return fits,
            }
            return self.group_fits_by_elements(false);
        }
        match self.group_fits_by_elements(true) {
            Err(PrintError::MeasureAgain) => self.group_fits_by_elements(false),
            fits => fits,
        }
    }

    /// The same for a [`FormatElement::IndentedLineGroup`].
    pub(super) fn indented_line_group_fits(&mut self) -> PrintResult<bool> {
        let mut measure = Measure::new(self, true);
        measure.pending_space = true;
        match self.fits(&mut measure, &mut AllPredicate) {
            Err(PrintError::MeasureAgain) => {}
            fits => return fits,
        }
        let mut measure = Measure::new(self, false);
        measure.pending_space = true;
        self.fits(&mut measure, &mut AllPredicate)
    }

    fn group_fits_by_elements(&mut self, uses_flat: bool) -> PrintResult<bool> {
        let mut measure = Measure::new(self, uses_flat);
        self.measure_push(&mut measure, FrameKind::Group, PrintMode::Flat);
        self.fits(&mut measure, &mut AllPredicate)
    }

    /// Whether `variant` of a [`FormatElement::BestFitting`] fits in place of it.
    pub(super) fn variant_fits(&mut self, variant: Interned) -> PrintResult<bool> {
        let flat = self.flat_of(variant);
        if flat.flags.has(FlatFlags::MEASURED) {
            let mut measure = Measure::new(self, true);
            if self.flat_fits(&mut measure, flat) == Fits::No {
                return Ok(false);
            }
            match self.fits(&mut measure, &mut AllPredicate) {
                Err(PrintError::MeasureAgain) => {}
                fits => return fits,
            }
            return self.variant_fits_by_elements(variant, false);
        }
        match self.variant_fits_by_elements(variant, true) {
            Err(PrintError::MeasureAgain) => self.variant_fits_by_elements(variant, false),
            fits => fits,
        }
    }

    fn variant_fits_by_elements(
        &mut self,
        variant: Interned,
        uses_flat: bool,
    ) -> PrintResult<bool> {
        let mut measure = Measure::new(self, uses_flat);
        measure.queue_len += 1;
        // Without the start tag: the frame for it has the mode.
        measure.elements = Elements::new(Run::of(variant), self.pool);
        measure.elements.skip(1);
        self.measure_push(&mut measure, FrameKind::Entry, PrintMode::Flat);
        self.fits(&mut measure, &mut AllPredicate)
    }

    /// Whether the item or the separator of a fill that is next fits on the line.
    pub(super) fn fill_entry_fits(&mut self, measure: &mut Measure<'d>) -> PrintResult<bool> {
        if !self.is_measure_at_start_entry(measure) {
            return Err(PrintError::InvalidDocument);
        }
        self.measure_push(measure, FrameKind::Fill, PrintMode::Flat);
        let mut predicate = SingleEntryPredicate::default();
        let fits = self.fits(measure, &mut predicate)?;
        if predicate.is_done {
            self.measure_pop(measure, FrameKind::Fill)?;
        }
        Ok(fits)
    }

    pub(super) fn is_measure_at_start_entry(&self, measure: &Measure<'d>) -> bool {
        let queue = &self.buffers.queue;
        let own = std::iter::once(measure.elements.run())
            .chain(self.buffers.measure_queue.iter().rev().copied());
        let of_printer = (0..measure.queue_len).rev().map(|at| {
            queue
                .get(at)
                .copied()
                .unwrap_or_else(|| self.elements.run())
        });
        let first = own
            .chain(of_printer)
            .find_map(|run| first_of(run, self.pool));
        matches!(first, Some(FormatElement::Tag(Tag::StartEntry)))
    }

    #[inline]
    fn measure_next(&mut self, measure: &mut Measure<'d>) -> Option<&'d FormatElement> {
        loop {
            if let Some(element) = measure.elements.next() {
                return Some(element);
            }
            let run = match self.buffers.measure_queue.pop() {
                Some(run) => run,
                None => {
                    measure.queue_len = measure.queue_len.checked_sub(1)?;
                    self.buffers
                        .queue
                        .get(measure.queue_len)
                        .copied()
                        .unwrap_or_else(|| self.elements.run())
                }
            };
            measure.elements = Elements::new(run, self.pool);
        }
    }

    #[inline]
    fn measure_content(&mut self, measure: &mut Measure<'d>, content: Interned) {
        if !measure.elements.is_empty() {
            self.buffers.measure_queue.push(measure.elements.run());
        }
        measure.elements = Elements::new(Run::of(content), self.pool);
    }

    #[inline]
    fn measure_push(&mut self, measure: &mut Measure<'d>, kind: FrameKind, mode: PrintMode) {
        self.buffers.measure_frames.push(Frame { kind, mode });
        measure.mode = mode;
    }

    /// Fails, and changes nothing, unless the innermost frame is of `kind`.
    #[inline]
    fn measure_pop(&mut self, measure: &mut Measure<'d>, kind: FrameKind) -> PrintResult<()> {
        let (own, of_printer) = (&mut self.buffers.measure_frames, &self.buffers.frames);
        match own.last() {
            Some(top) if top.kind == kind => {
                own.pop();
            }
            None if measure.frames_len > 1
                && of_printer
                    .get(measure.frames_len - 1)
                    .is_some_and(|top| top.kind == kind) =>
            {
                measure.frames_len -= 1;
            }
            _ => return Err(PrintError::InvalidDocument),
        }
        let top = own
            .last()
            .or_else(|| of_printer.get(measure.frames_len - 1));
        measure.mode = top.map_or(PrintMode::Expanded, |top| top.mode);
        Ok(())
    }

    /// Whether what comes next fits on the line, up to the first line break, the end of the
    /// document, or where `predicate` says.
    fn fits(
        &mut self,
        measure: &mut Measure<'d>,
        predicate: &mut impl FitsEndPredicate,
    ) -> PrintResult<bool> {
        while let Some(element) = self.measure_next(measure) {
            match self.fits_element(measure, element)? {
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

    #[inline(always)]
    fn fits_element(
        &mut self,
        measure: &mut Measure<'d>,
        element: &'d FormatElement,
    ) -> PrintResult<Fits> {
        let mode = measure.mode;
        match element {
            FormatElement::Nop | FormatElement::Cursor(_) => {}
            FormatElement::Skip(skip) => measure.elements.skip(skip.len),
            FormatElement::Space => {
                if measure.line_width > 0 {
                    measure.pending_space = true;
                    measure.is_space_element_pending = true;
                }
            }
            FormatElement::Line(line_mode)
            | FormatElement::Tag(
                Tag::StartIndentWithLine(line_mode) | Tag::EndIndentWithLine(line_mode),
            ) => {
                if mode.is_flat() {
                    match line_mode {
                        LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty => {
                            measure.pending_space = true
                        }
                        LineMode::Soft | LineMode::SoftEmpty => {}
                        // The break is there in any mode, and everything up to it fits. In a
                        // fill, an item that has a comment on a line of its own before it does
                        // not have to be alone on its line because of that. If the content is
                        // in a group, the group is known to break and this is not asked.
                        LineMode::Hard | LineMode::Empty => return Ok(Fits::Yes),
                    }
                } else {
                    // This is past the end of what is measured, in content that is expanded.
                    let width = measure.line_width + usize::from(measure.is_space_element_pending);
                    return Ok(if width > self.options.print_width {
                        Fits::No
                    } else {
                        Fits::Yes
                    });
                }
            }
            FormatElement::IndentedLineGroup(_) => {
                if !mode.is_flat() {
                    let width = measure.line_width + usize::from(measure.is_space_element_pending);
                    return Ok(if width > self.options.print_width {
                        Fits::No
                    } else {
                        Fits::Yes
                    });
                }
                measure.pending_space = true;
            }
            FormatElement::TokenIfBreaks(token) => {
                if !mode.is_flat() {
                    return Ok(self.fits_text(measure, TextWidth::single(token.len() as u32)));
                }
            }
            FormatElement::Token(token) => {
                return Ok(self.fits_text(measure, TextWidth::single(token.len() as u32)));
            }
            FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                return Ok(self.fits_text(measure, text.width));
            }
            FormatElement::LineSuffixBoundary => {
                if measure.has_line_suffix {
                    return Ok(Fits::No);
                }
            }
            FormatElement::ExpandParent => {
                if measure.must_be_flat {
                    return Ok(Fits::No);
                }
            }
            FormatElement::BestFitting(best_fitting) => {
                let variants = self.variants_of(*best_fitting);
                let variant = match mode {
                    PrintMode::Flat => variants.first(),
                    PrintMode::Expanded => variants.last(),
                };
                let &variant = variant.ok_or(PrintError::InvalidDocument)?;
                self.measure_content(measure, variant);
            }
            FormatElement::Interned(content) => self.measure_content(measure, *content),
            FormatElement::Tag(tag) => match tag {
                Tag::StartGroup(group) => {
                    if measure.must_be_flat && !group.mode().is_flat() {
                        return Ok(Fits::No);
                    }
                    let group_mode = match group.mode().is_flat() {
                        true => mode,
                        false => PrintMode::Expanded,
                    };
                    let flat = group.flat();
                    if measure.uses_flat
                        && group_mode.is_flat()
                        && flat.flags.has(FlatFlags::MEASURED)
                        && group.end() < measure.elements.end
                    {
                        measure.elements.move_to(group.end() + 1);
                        return Ok(self.flat_fits(measure, flat));
                    }
                    self.measure_push(measure, FrameKind::Group, group_mode);
                }
                Tag::EndGroup => self.measure_pop(measure, FrameKind::Group)?,
                Tag::StartConditionalContent(condition) => {
                    let group_mode = match condition.group_id {
                        None => mode,
                        Some(_) if measure.has_passed_group_ids => {
                            return Err(PrintError::MeasureAgain);
                        }
                        // As in Prettier, it is the mode that the group has been printed in. One that has only been measured
                        // counts as being on one line.
                        Some(id) => self.group_mode(id).unwrap_or(PrintMode::Flat),
                    };
                    if group_mode != condition.mode {
                        skip_conditional_content(&mut measure.elements)?;
                    }
                }
                Tag::StartLineSuffix => {
                    take_line_suffix(&mut measure.elements)?;
                    measure.has_line_suffix = true;
                }
                // Of a line suffix that is being printed.
                Tag::EndLineSuffix => self.measure_pop(measure, FrameKind::LineSuffix)?,
                Tag::StartFill => self.measure_push(measure, FrameKind::Fill, mode),
                Tag::StartEntry => {
                    // After an item that is being printed, `mode` is that of the separator.
                    let _ = self.measure_pop(measure, FrameKind::FillSeparator);
                    self.measure_push(measure, FrameKind::Entry, mode);
                }
                Tag::EndEntry => self.measure_pop(measure, FrameKind::Entry)?,
                Tag::EndFill => {
                    let _ = self.measure_pop(measure, FrameKind::FillSeparator);
                    self.measure_pop(measure, FrameKind::Fill)?;
                }
                // Where the next line starts does not matter: measuring ends there.
                Tag::StartIndent
                | Tag::EndIndent
                | Tag::StartIndentWithLine(_)
                | Tag::EndIndentWithLine(_)
                | Tag::StartAlign(_)
                | Tag::EndAlign
                | Tag::StartDedent(_)
                | Tag::EndDedent(_)
                | Tag::StartIndentIfGroupBreaks(_)
                | Tag::EndIndentIfGroupBreaks(_)
                | Tag::StartLabelled(_)
                | Tag::EndLabelled
                | Tag::EndConditionalContent => {}
            },
        }
        Ok(Fits::Maybe)
    }

    #[inline]
    fn fits_text(&self, measure: &mut Measure<'d>, width: TextWidth) -> Fits {
        // To Prettier, a text that is empty is not there.
        if width == TextWidth::single(0) {
            return Fits::Maybe;
        }
        let print_width = self.options.print_width;
        measure.line_width +=
            measure.pending_indent + usize::from(measure.pending_space) + width.value() as usize;
        measure.pending_indent = 0;
        // The line break is there in any mode. What counts is what is before it.
        if width.is_multiline() && !width.is_one_string() {
            return if measure.line_width > print_width {
                Fits::No
            } else {
                Fits::Yes
            };
        }
        if measure.line_width > print_width {
            return Fits::No;
        }
        measure.pending_space = false;
        measure.is_space_element_pending = false;
        Fits::Maybe
    }

    /// The same for content that is measured, in flat mode.
    #[inline]
    fn flat_fits(&self, measure: &mut Measure<'d>, flat: Flat) -> Fits {
        let flags = flat.flags;
        if flags.has(FlatFlags::HAS_LINE_SUFFIX_BOUNDARY) && measure.has_line_suffix {
            return Fits::No;
        }
        measure.has_passed_group_ids |= flags.has(FlatFlags::HAS_GROUP_IDS);
        let starts_with_space = flags.has(FlatFlags::STARTS_WITH_SPACE) && measure.line_width > 0;
        measure.pending_space |= starts_with_space || flags.has(FlatFlags::STARTS_WITH_LINE);
        measure.is_space_element_pending |= starts_with_space;
        if flat.width == 0 {
            return Fits::Maybe;
        }
        measure.line_width +=
            measure.pending_indent + usize::from(measure.pending_space) + flat.width as usize;
        measure.pending_indent = 0;
        if measure.line_width > self.options.print_width {
            return Fits::No;
        }
        measure.pending_space = flags.has(FlatFlags::ENDS_WITH_SPACE);
        measure.is_space_element_pending = flags.has(FlatFlags::ENDS_WITH_SPACE_ELEMENT);
        Fits::Maybe
    }
}
