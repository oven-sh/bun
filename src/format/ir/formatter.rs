//! [`Format`], and the [`Formatter`] that it writes to.

use super::document::Tracker;
use super::element::{
    BestFitting, Flat, FlatFlags, FormatElement, Group, GroupId, GroupMode, Interned, LabelId,
    LineMode, PrintMode, Skip, Tag, Text, TextWidth,
};
use super::width::OddBlocks;
use crate::js::comments::Comments;
use crate::js::context::JsFormatContext;
use crate::js::source_text::SourceText;
use crate::options::FormatOptions;
use bun_lint::ast::File;
use bun_lint::span::Span;
use rustc_hash::FxHashMap;
use std::cell::Cell;
use std::num::NonZeroU32;

/// Something that can be written as [`FormatElement`]s.
pub(crate) trait Format<'a> {
    fn fmt(&self, f: &mut Formatter<'a>);

    /// The text, if this is a keyword or a punctuator and nothing else.
    #[inline(always)]
    fn as_token(&self) -> Option<&'static str> {
        None
    }

    /// The mode, if this is a line break and nothing else.
    #[inline(always)]
    fn as_line(&self) -> Option<LineMode> {
        None
    }

    /// The mode, if this is an `indent` with a line break and nothing else in it.
    #[inline(always)]
    fn as_indented_line(&self) -> Option<LineMode> {
        None
    }
}

impl<'a, T: ?Sized + Format<'a>> Format<'a> for &T {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'a>) {
        Format::fmt(&**self, f);
    }

    #[inline(always)]
    fn as_token(&self) -> Option<&'static str> {
        Format::as_token(&**self)
    }

    #[inline(always)]
    fn as_line(&self) -> Option<LineMode> {
        Format::as_line(&**self)
    }

    #[inline(always)]
    fn as_indented_line(&self) -> Option<LineMode> {
        Format::as_indented_line(&**self)
    }
}

impl<'a, T: Format<'a>> Format<'a> for Option<T> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        if let Some(value) = self {
            value.fmt(f);
        }
    }
}

impl<'a> Format<'a> for () {
    #[inline]
    fn fmt(&self, _: &mut Formatter<'a>) {}
}

/// A keyword or a punctuator.
impl<'a> Format<'a> for &'static str {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_token(self);
    }

    #[inline(always)]
    fn as_token(&self) -> Option<&'static str> {
        Some(self)
    }
}

/// What `format_args!` makes: a tuple of references, written one after the other.
#[derive(Copy, Clone)]
pub(crate) struct Arguments<T>(pub(crate) T);

macro_rules! arguments {
    ($($name:ident)+) => {
        impl<'a, $($name: Format<'a>),+> Format<'a> for Arguments<($(&$name,)+)> {
            #[inline(always)]
            #[allow(non_snake_case)]
            fn fmt(&self, f: &mut Formatter<'a>) {
                let ($($name,)+) = self.0;
                $($name.fmt(f);)+
            }
        }
    };
}
arguments!(A);
arguments!(A B);
arguments!(A B C);
arguments!(A B C D);
arguments!(A B C D E);
arguments!(A B C D E F);
arguments!(A B C D E F G);
arguments!(A B C D E F G H);
arguments!(A B C D E F G H I);
arguments!(A B C D E F G H I J);
arguments!(A B C D E F G H I J K);
arguments!(A B C D E F G H I J K L);
arguments!(A B C D E F G H I J K L M);
arguments!(A B C D E F G H I J K L M N);
arguments!(A B C D E F G H I J K L M N O);
arguments!(A B C D E F G H I J K L M N O P);
arguments!(A B C D E F G H I J K L M N O P Q);
arguments!(A B C D E F G H I J K L M N O P Q R);
arguments!(A B C D E F G H I J K L M N O P Q R S);
arguments!(A B C D E F G H I J K L M N O P Q R S T);
arguments!(A B C D E F G H I J K L M N O P Q R S T U);
arguments!(A B C D E F G H I J K L M N O P Q R S T U V);
arguments!(A B C D E F G H I J K L M N O P Q R S T U V W);
arguments!(A B C D E F G H I J K L M N O P Q R S T U V W X);

/// What elements refer to by index.
#[derive(Default)]
pub(crate) struct Storage {
    /// Every element of the document, in the order they are written. [`Interned`] is a range of
    /// it.
    pub(crate) pool: Vec<FormatElement>,
    /// What [`BestFitting`] is a range of.
    pub(crate) variants: Vec<Interned>,
    /// What [`FormatElement::OwnedText`] is a range of.
    pub(crate) text: Vec<u8>,
}

/// The first elements of every pool, which the printer needs to be somewhere.
pub(crate) const END_LINE_SUFFIX: Interned = Interned { start: 0, len: 1 };

/// What is in a [`FormatElement::IndentedLineGroup`], and the end tag of the group.
pub(crate) const REST_OF_INDENTED_LINE_GROUP: Interned = Interned {
    start: 1 + LineMode::ALL.len() as u32,
    len: 3,
};

/// A [`FormatElement::Line`] of `mode`.
#[inline]
pub(crate) const fn line_break(mode: LineMode) -> Interned {
    Interned {
        start: 1 + mode as u32,
        len: 1,
    }
}

impl Storage {
    /// The number of elements that are in every pool.
    const RESERVED: u32 = REST_OF_INDENTED_LINE_GROUP.start + REST_OF_INDENTED_LINE_GROUP.len;

    pub(crate) fn clear(&mut self) {
        self.pool.clear();
        self.pool.push(FormatElement::Tag(Tag::EndLineSuffix));
        self.pool.extend(LineMode::ALL.map(FormatElement::Line));
        self.pool.extend(
            [
                Tag::StartIndentWithLine(LineMode::SoftOrSpace),
                Tag::EndIndent,
                Tag::EndGroup,
            ]
            .map(FormatElement::Tag),
        );
        self.variants.clear();
        self.text.clear();
    }

    #[inline]
    pub(crate) fn interned(&self, interned: Interned) -> &[FormatElement] {
        self.pool.get(interned.range()).unwrap_or_default()
    }

    #[inline]
    pub(crate) fn variants(&self, best_fitting: BestFitting) -> &[Interned] {
        self.variants.get(best_fitting.range()).unwrap_or_default()
    }

    fn most_flat(&self, best_fitting: BestFitting) -> &[FormatElement] {
        match self.variants(best_fitting).first() {
            Some(&variant) => self.interned(variant),
            None => &[],
        }
    }

    /// What has been found out about `interned` when it was written: what it is on one line, and
    /// whether it [will break](Storage::will_break).
    #[inline]
    pub(crate) fn summary_of(&self, interned: Interned) -> (Flat, bool) {
        match (interned.start as usize)
            .checked_sub(1)
            .and_then(|before| self.pool.get(before))
        {
            Some(FormatElement::Skip(skip)) if skip.len == interned.len => {
                (skip.flat, skip.will_break)
            }
            _ => self.summary_of_part(interned),
        }
    }

    /// The same for what is not all of what has been captured but a part of it.
    #[cold]
    fn summary_of_part(&self, part: Interned) -> (Flat, bool) {
        let flat = Flat {
            width: 0,
            flags: FlatFlags::default().with(FlatFlags::EXPANDS, self.part_expands(part, 0)),
        };
        (flat, self.will_break(self.interned(part)))
    }

    /// Whether there is something in `part` that forces the groups around it to break.
    fn part_expands(&self, part: Interned, depth: u32) -> bool {
        let mut elements = self.interned(part).iter();
        while let Some(element) = elements.next() {
            let expands = match element {
                FormatElement::Skip(it) => {
                    skip(&mut elements, it.len);
                    false
                }
                FormatElement::Line(mode)
                | FormatElement::Tag(
                    Tag::StartIndentWithLine(mode) | Tag::EndIndentWithLine(mode),
                ) => mode.will_break(),
                FormatElement::ExpandParent => true,
                FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                    text.width.is_multiline() && !text.width.is_one_string()
                }
                FormatElement::Tag(Tag::StartGroup(group)) => !group.mode().is_flat(),
                FormatElement::Interned(interned) => match (interned.start as usize)
                    .checked_sub(1)
                    .and_then(|at| self.pool.get(at))
                {
                    Some(FormatElement::Skip(it)) if it.len == interned.len => {
                        it.flat.flags.has(FlatFlags::EXPANDS)
                    }
                    _ => depth >= 16 || self.part_expands(*interned, depth + 1),
                },
                _ => false,
            };
            if expands {
                return true;
            }
        }
        false
    }

    fn element_will_break(&self, element: &FormatElement) -> bool {
        match element {
            FormatElement::ExpandParent => true,
            // Not one that is only known to break because of what is in it: that is looked at.
            FormatElement::Tag(Tag::StartGroup(group)) => group.mode() == GroupMode::Expand,
            FormatElement::Line(mode) => mode.will_break(),
            FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                text.width.is_multiline() && !text.width.is_one_string()
            }
            FormatElement::Interned(interned) => self.summary_of(*interned).1,
            // If even the flattest variant has something that forces a break, it breaks.
            FormatElement::BestFitting(it) => self
                .variants(*it)
                .first()
                .is_some_and(|&flattest| self.summary_of(flattest).1),
            FormatElement::Token(_)
            | FormatElement::TokenIfBreaks(_)
            | FormatElement::IndentedLineGroup(_)
            | FormatElement::LineSuffixBoundary
            | FormatElement::Space
            | FormatElement::Nop
            | FormatElement::Cursor(_)
            | FormatElement::Skip(_)
            | FormatElement::Tag(_) => false,
        }
    }

    /// Whether the printer is certain to print `elements` over several lines: there is a hard
    /// line break, a text with a line break, or an expanded group.
    pub(crate) fn will_break(&self, elements: &[FormatElement]) -> bool {
        let mut ignore_depth = 0usize;
        let mut elements = elements.iter();
        while let Some(element) = elements.next() {
            match element {
                FormatElement::Skip(it) => skip(&mut elements, it.len),
                FormatElement::Tag(Tag::StartLineSuffix) => ignore_depth += 1,
                FormatElement::Tag(Tag::EndLineSuffix) => {
                    ignore_depth = ignore_depth.saturating_sub(1);
                }
                FormatElement::Line(mode)
                | FormatElement::Tag(
                    Tag::StartIndentWithLine(mode) | Tag::EndIndentWithLine(mode),
                ) if mode.will_break() => {
                    return true;
                }
                element if ignore_depth == 0 && self.element_will_break(element) => return true,
                _ => {}
            }
        }
        false
    }

    /// Whether there is any [`FormatElement::Line`] in `elements`.
    pub(crate) fn may_directly_break(&self, elements: &[FormatElement]) -> bool {
        let mut ignore_depth = 0usize;
        let mut elements = elements.iter();
        while let Some(element) = elements.next() {
            match element {
                FormatElement::Skip(it) => skip(&mut elements, it.len),
                FormatElement::Tag(Tag::StartLineSuffix) => ignore_depth += 1,
                FormatElement::Tag(Tag::EndLineSuffix) => {
                    ignore_depth = ignore_depth.saturating_sub(1);
                }
                _ if ignore_depth != 0 => {}
                FormatElement::Line(_)
                | FormatElement::IndentedLineGroup(_)
                | FormatElement::Tag(Tag::StartIndentWithLine(_) | Tag::EndIndentWithLine(_)) => {
                    return true;
                }
                FormatElement::Interned(it) if self.may_directly_break(self.interned(*it)) => {
                    return true;
                }
                FormatElement::BestFitting(it) if self.may_directly_break(self.most_flat(*it)) => {
                    return true;
                }
                _ => {}
            }
        }
        false
    }

    /// Whether `elements` starts with the label.
    pub(crate) fn has_label(&self, elements: &[FormatElement], label: LabelId) -> bool {
        let mut elements = elements.iter();
        while let Some(element) = elements.next() {
            return match element {
                FormatElement::Skip(it) => {
                    skip(&mut elements, it.len);
                    continue;
                }
                FormatElement::Nop | FormatElement::Cursor(_) => continue,
                FormatElement::Tag(Tag::StartLabelled(actual)) => *actual == label,
                FormatElement::Interned(it) => self.has_label(self.interned(*it), label),
                _ => false,
            };
        }
        false
    }
}

/// Moves on by what a [`FormatElement::Skip`] says.
#[inline]
fn skip(elements: &mut std::slice::Iter<'_, FormatElement>, count: u32) {
    if count > 0 {
        elements.nth(count as usize - 1);
    }
}

/// Some elements, with what it takes to look into them.
#[derive(Copy, Clone)]
pub(crate) struct Elements<'f> {
    storage: &'f Storage,
    elements: &'f [FormatElement],
    /// If it is known already.
    will_break: Option<bool>,
}

impl<'f> Elements<'f> {
    #[inline]
    pub(crate) fn will_break(self) -> bool {
        match self.will_break {
            Some(will_break) => will_break,
            None => self.storage.will_break(self.elements),
        }
    }

    pub(crate) fn may_directly_break(self) -> bool {
        self.storage.may_directly_break(self.elements)
    }

    pub(crate) fn has_label(self, label: LabelId) -> bool {
        self.storage.has_label(self.elements, label)
    }
}

impl FormatElement {
    /// See [`Storage::will_break`].
    pub(crate) fn will_break(&self, f: &Formatter<'_>) -> bool {
        f.storage.will_break(std::slice::from_ref(self))
    }
}

/// The vectors of a [`Formatter`], which keep their capacity from one file to the next.
#[derive(Default)]
pub(crate) struct FormatterBuffers {
    pub(crate) storage: Storage,
    tracker: Tracker,
    odd_blocks: OddBlocks,
    spare: Vec<Vec<FormatElement>>,
    cleaned: FxHashMap<Interned, Interned>,
}

/// Collects the elements of a document.
pub(crate) struct Formatter<'a> {
    /// `storage.pool` is the document so far.
    pub(crate) storage: Storage,
    /// It is told about every element that is written.
    tracker: Tracker,
    /// Vectors for whoever needs one for a while: [`Formatter::take_vec`].
    spare: Vec<Vec<FormatElement>>,
    /// Interned content, and the same without soft line breaks.
    cleaned: FxHashMap<Interned, Interned>,
    next_group_id: Cell<u32>,
    source: &'a [u8],
    /// Of `source`.
    odd_blocks: OddBlocks,
    context: JsFormatContext<'a>,
}

impl<'a> Formatter<'a> {
    /// `source`: what [`FormatElement::SourceText`] is a range of.
    pub(crate) fn new(
        context: JsFormatContext<'a>,
        source: &'a [u8],
        buffers: FormatterBuffers,
    ) -> Self {
        let FormatterBuffers {
            mut storage,
            mut tracker,
            mut odd_blocks,
            spare,
            mut cleaned,
        } = buffers;
        storage.clear();
        tracker.clear();
        odd_blocks.mark(source);
        cleaned.clear();
        // Measured by oxc on the sources of VS Code: the median is 0.19 elements per byte, and
        // 95% of the files are below 0.4.
        storage.pool.reserve(source.len() * 2 / 5);
        Formatter {
            storage,
            tracker,
            spare,
            cleaned,
            next_group_id: Cell::new(1),
            source,
            odd_blocks,
            context,
        }
    }

    /// Returns where the document is, and the vectors.
    pub(crate) fn finish(self) -> (Interned, FormatterBuffers) {
        let root = Interned {
            start: Storage::RESERVED,
            len: (self.storage.pool.len() as u32).saturating_sub(Storage::RESERVED),
        };
        let buffers = FormatterBuffers {
            storage: self.storage,
            tracker: self.tracker,
            odd_blocks: self.odd_blocks,
            spare: self.spare,
            cleaned: self.cleaned,
        };
        (root, buffers)
    }

    /// Calls `write` with a formatter for `source`, another text, that goes on with this document: a script in HTML.
    ///
    /// It has the elements, the ids of groups and what is known about the groups that are open, so that a forced line
    /// break in what it writes breaks them. Ranges of the pool stay what they are. The ranges of `source` that it writes
    /// become ranges of the source of this formatter if `source` is a part of that, and of a copy of `source` if not.
    pub(crate) fn write_embedded<'b, R>(
        &mut self,
        context: JsFormatContext<'b>,
        source: &'b [u8],
        write: impl FnOnce(&mut Formatter<'b>) -> R,
    ) -> R {
        let first = self.storage.pool.len();
        let mut inner = self.start_embedded(context, source);
        let result = write(&mut inner);
        self.end_embedded(inner, first);
        result
    }

    /// A formatter for `source` that has what this one has written.
    fn start_embedded<'b>(
        &mut self,
        context: JsFormatContext<'b>,
        source: &'b [u8],
    ) -> Formatter<'b> {
        let mut odd_blocks = OddBlocks::default();
        odd_blocks.mark(source);
        Formatter {
            storage: std::mem::take(&mut self.storage),
            tracker: std::mem::take(&mut self.tracker),
            spare: std::mem::take(&mut self.spare),
            cleaned: std::mem::take(&mut self.cleaned),
            next_group_id: Cell::new(self.next_group_id.get()),
            source,
            odd_blocks,
            context,
        }
    }

    /// Takes everything back from `inner`, which has written the elements from `first` on.
    fn end_embedded(&mut self, inner: Formatter<'_>, first: usize) {
        let source = inner.source;
        self.context.ran_out_of_stack |= inner.context.ran_out_of_stack;
        self.next_group_id.set(inner.next_group_id.get());
        (self.storage, self.tracker, self.spare, self.cleaned) =
            (inner.storage, inner.tracker, inner.spare, inner.cleaned);

        let (own, part) = (self.source.as_ptr_range(), source.as_ptr_range());
        let offset = (own.start <= part.start && part.end <= own.end)
            .then(|| (part.start.addr() - own.start.addr()) as u32);
        let Storage {
            pool, text: owned, ..
        } = &mut self.storage;
        let mut copy = None;
        for element in pool.get_mut(first..).unwrap_or_default() {
            if let FormatElement::SourceText(text) = element {
                match offset {
                    Some(offset) => text.start += offset,
                    None => {
                        text.start += *copy.get_or_insert_with(|| {
                            let start = owned.len() as u32;
                            owned.extend_from_slice(source);
                            start
                        });
                        *element = FormatElement::OwnedText(*text);
                    }
                }
            }
        }
    }

    // ───────────────────────────── the context ─────────────────────────────

    #[inline]
    pub(crate) fn context(&self) -> &JsFormatContext<'a> {
        &self.context
    }

    #[inline]
    pub(crate) fn context_mut(&mut self) -> &mut JsFormatContext<'a> {
        &mut self.context
    }

    #[inline]
    pub(crate) fn options(&self) -> &FormatOptions {
        self.context.options()
    }

    #[inline]
    pub(crate) fn file(&self) -> &'a File<'a> {
        self.context.file()
    }

    /// Prettier's `filepath` option.
    pub(crate) fn filepath(&self) -> &[u8] {
        match &self.options().filepath {
            Some(filepath) => filepath,
            None => self.file().path(),
        }
    }

    #[inline]
    pub(crate) fn comments(&self) -> &Comments<'a> {
        self.context.comments()
    }

    #[inline]
    pub(crate) fn comments_mut(&mut self) -> &mut Comments<'a> {
        self.context.comments_mut()
    }

    #[inline]
    pub(crate) fn source_text(&self) -> SourceText<'a> {
        SourceText::new(self.source)
    }

    /// A new id. `_debug_name` says what the group is to whoever reads the code.
    #[inline]
    pub(crate) fn group_id(&self, _debug_name: &'static str) -> GroupId {
        let id = self.next_group_id.get();
        self.next_group_id.set(id.saturating_add(1));
        GroupId::new(NonZeroU32::new(id).unwrap_or(NonZeroU32::MIN))
    }

    // ───────────────────────────── writing ─────────────────────────────

    #[inline(always)]
    pub(crate) fn write_element(&mut self, element: FormatElement) {
        let index = self.storage.pool.len() as u32;
        self.storage.pool.push(element);
        self.tracker.note(element, index, &mut self.storage);
    }

    #[inline(always)]
    pub(crate) fn write_token(&mut self, text: &'static str) {
        match super::element::Token::new(text) {
            Some(token) => self.write_element(FormatElement::Token(token)),
            None => self.write_owned_text(text.as_bytes(), TextWidth::single(text.len() as u32)),
        }
    }

    /// The number of columns that `text` takes, which has no line break.
    #[inline]
    pub(crate) fn string_width(&self, text: &[u8]) -> u32 {
        super::width::string_width_as(text, self.options().flavor)
    }

    /// Whether the source text of `span`, which has no line break and no tab, is as wide as it is
    /// long and has no backslash. It can be so without this saying so.
    #[inline]
    pub(crate) fn is_plain_source(&self, span: Span) -> bool {
        self.odd_blocks.is_plain(span.start, span.end)
    }

    /// Writes the source text of `span`, which has no line break and no tab.
    #[inline]
    pub(crate) fn write_source_token(&mut self, span: Span) {
        if !self.is_plain_source(span) {
            return self.write_odd_source_token(span);
        }
        self.write_element(FormatElement::SourceText(Text {
            start: span.start,
            len: span.len(),
            width: TextWidth::single(span.len()),
        }));
    }

    #[inline(never)]
    fn write_odd_source_token(&mut self, span: Span) {
        let text = self.source.get(span.range()).unwrap_or_default();
        if bun_core::strings::contains_char(text, b'\\') && self.write_name_without_escapes(text) {
            return;
        }
        self.write_element(FormatElement::SourceText(Text {
            start: span.start,
            len: span.len(),
            width: TextWidth::single(self.string_width(text)),
        }));
    }

    /// `\u0061b` is written `ab`: Prettier prints the name of an identifier, not its text. Returns
    /// whether `text` is a name, with or without the `.` or `?.` before it.
    #[cold]
    fn write_name_without_escapes(&mut self, text: &[u8]) -> bool {
        if !matches!(
            text.first(),
            Some(b'\\' | b'#' | b'.' | b'?' | b'$' | b'_' | b'a'..=b'z' | b'A'..=b'Z' | 0x80..)
        ) {
            return false;
        }
        let name = crate::verify::without_unicode_escapes(text);
        let width = TextWidth::single(self.string_width(&name));
        self.write_owned_text(&name, width);
        true
    }

    /// Writes `text`, which can be anything but has no `\r`. It is not copied if it is part of
    /// the source text.
    pub(crate) fn write_text(&mut self, text: &[u8], width: Option<TextWidth>) {
        let width = width.unwrap_or_else(|| TextWidth::from_text_as(text, self.options().flavor));
        let (source, part) = (self.source.as_ptr_range(), text.as_ptr_range());
        if source.start <= part.start && part.end <= source.end {
            self.write_element(FormatElement::SourceText(Text {
                start: (part.start.addr() - source.start.addr()) as u32,
                len: text.len() as u32,
                width,
            }));
        } else {
            self.write_owned_text(text, width);
        }
    }

    fn write_owned_text(&mut self, text: &[u8], width: TextWidth) {
        let start = self.storage.text.len() as u32;
        self.storage.text.extend_from_slice(text);
        self.write_element(FormatElement::OwnedText(Text {
            start,
            len: text.len() as u32,
            width,
        }));
    }

    /// Writes what `build` appends to the vector it is given, as one text.
    pub(crate) fn write_built_text(&mut self, build: impl FnOnce(&mut Vec<u8>)) {
        let start = self.storage.text.len();
        build(&mut self.storage.text);
        self.write_owned_text_from(start);
    }

    /// Writes what is in `storage.text` from `start` on, as one text.
    fn write_owned_text_from(&mut self, start: usize) {
        let text = self.storage.text.get(start..).unwrap_or_default();
        let width = TextWidth::from_text_as(text, self.options().flavor);
        let len = text.len() as u32;
        self.write_element(FormatElement::OwnedText(Text {
            start: start as u32,
            len,
            width,
        }));
    }

    // ───────────────────────────── looking at what is written ─────────────────────────────

    /// Everything that is written so far. Remember its length to look at what is written from
    /// then on: `f.elements_from(start)`.
    #[inline]
    pub(crate) fn elements(&self) -> &[FormatElement] {
        &self.storage.pool
    }

    /// What has been written since `f.elements().len()` was `start`.
    pub(crate) fn elements_from(&self, start: usize) -> Elements<'_> {
        Elements {
            storage: &self.storage,
            elements: self.storage.pool.get(start..).unwrap_or_default(),
            will_break: Some(self.tracker.will_break_from(start)),
        }
    }

    pub(crate) fn interned(&self, interned: Interned) -> Elements<'_> {
        Elements {
            storage: &self.storage,
            elements: self.storage.interned(interned),
            will_break: Some(self.storage.summary_of(interned).1),
        }
    }

    // ───────────────────────────── interning ─────────────────────────────

    /// Starts content that is not part of what is being written. Nothing is moved: it stays where
    /// it is written, behind an element that tells whoever reads the pool to skip it.
    #[inline]
    pub(crate) fn start_capture(&mut self) -> usize {
        let slot = self.storage.pool.len();
        self.storage.pool.push(FormatElement::Skip(Skip::new(0)));
        self.tracker.start_skipped(slot as u32);
        slot
    }

    /// Ends the content that `slot` started.
    pub(crate) fn end_capture(&mut self, slot: usize) -> Interned {
        let len = self.storage.pool.len().saturating_sub(slot + 1) as u32;
        let (_, flat, will_break) = self.tracker.end_skipped().unwrap_or_default();
        match self.storage.pool.get_mut(slot) {
            Some(element) if len > 0 => {
                *element = FormatElement::Skip(Skip {
                    len,
                    flat,
                    will_break,
                });
            }
            _ => self.storage.pool.truncate(slot),
        }
        Interned {
            start: slot as u32 + 1,
            len,
        }
    }

    /// Formats `content` without writing it. Returns where it is.
    pub(crate) fn capture(&mut self, content: &(impl Format<'a> + ?Sized)) -> Interned {
        let slot = self.start_capture();
        content.fmt(self);
        self.end_capture(slot)
    }

    /// Formats `content` without writing it. The element that is returned stands for it, and can
    /// be written any number of times. `None` if `content` writes nothing.
    pub(crate) fn intern(&mut self, content: &(impl Format<'a> + ?Sized)) -> Option<FormatElement> {
        let slot = self.start_capture();
        content.fmt(self);
        self.end_intern(slot)
    }

    /// The element that stands for what has been written since `start_capture` returned `slot`.
    fn end_intern(&mut self, slot: usize) -> Option<FormatElement> {
        if self.storage.pool.len() == slot + 2 {
            let only = self.storage.pool.pop();
            self.storage.pool.truncate(slot);
            self.tracker.end_skipped();
            return only;
        }
        let interned = self.end_capture(slot);
        (interned.len > 0).then_some(FormatElement::Interned(interned))
    }

    /// The same for elements that are already there.
    pub(crate) fn intern_slice(&mut self, elements: &[FormatElement]) -> Option<FormatElement> {
        match elements {
            [] => None,
            [one] => Some(*one),
            _ => {
                let slot = self.start_capture();
                for &element in elements {
                    self.write_element(element);
                }
                Some(FormatElement::Interned(self.end_capture(slot)))
            }
        }
    }

    /// The element that lets the printer choose among `variants`, which are ordered from the
    /// flattest to the most expanded. Each starts with a [`Tag::StartEntry`] and ends with a
    /// [`Tag::EndEntry`].
    pub(crate) fn best_fitting_of(&mut self, variants: &[Interned]) -> FormatElement {
        debug_assert!(variants.len() >= 2);
        let first = self.storage.variants.len() as u32;
        self.storage.variants.extend_from_slice(variants);
        FormatElement::BestFitting(BestFitting {
            first,
            count: variants.len() as u32,
        })
    }

    /// An empty vector, which may have some capacity. Give it back with
    /// [`Formatter::recycle_vec`].
    pub(crate) fn take_vec(&mut self) -> Vec<FormatElement> {
        self.spare.pop().unwrap_or_default()
    }

    pub(crate) fn recycle_vec(&mut self, mut vec: Vec<FormatElement>) {
        vec.clear();
        self.spare.push(vec);
    }

    // ───────────────────────────── without soft line breaks ─────────────────────────────

    /// Writes `content` as it would be printed if the line were infinitely long: soft line
    /// breaks are removed or replaced by spaces, what is written only if a group breaks is
    /// removed, and of several variants the flattest is taken.
    pub(crate) fn write_without_soft_lines(&mut self, content: &(impl Format<'a> + ?Sized)) {
        let written = self.capture(content);
        self.remove_soft_lines(written, &mut Vec::new());
    }

    /// Writes the elements at `range` without their soft line breaks.
    fn remove_soft_lines(&mut self, range: Interned, conditions: &mut Vec<PrintMode>) {
        let mut indices = range.range();
        while let Some(&element) = indices
            .next()
            .and_then(|index| self.storage.pool.get(index))
        {
            let cleaned = match element {
                FormatElement::Skip(it) => {
                    if it.len > 0 {
                        indices.nth(it.len as usize - 1);
                    }
                    continue;
                }
                FormatElement::Tag(Tag::StartConditionalContent(condition)) => {
                    conditions.push(condition.mode);
                    continue;
                }
                FormatElement::Tag(Tag::EndConditionalContent) => {
                    conditions.pop();
                    continue;
                }
                _ if conditions.last() == Some(&PrintMode::Expanded) => continue,
                FormatElement::TokenIfBreaks(_) => continue,
                FormatElement::IndentedLineGroup(id) => {
                    self.write_element(FormatElement::Tag(Tag::StartGroup(
                        Group::new().with_id(Some(id)),
                    )));
                    self.write_element(FormatElement::Tag(Tag::StartIndent));
                    self.write_element(FormatElement::Space);
                    self.write_element(FormatElement::Tag(Tag::EndIndent));
                    FormatElement::Tag(Tag::EndGroup)
                }
                FormatElement::Tag(
                    tag @ (Tag::StartIndentWithLine(mode) | Tag::EndIndentWithLine(mode)),
                ) if !mode.will_break() => {
                    self.write_element(FormatElement::Tag(if tag.is_start() {
                        Tag::StartIndent
                    } else {
                        Tag::EndIndent
                    }));
                    match mode {
                        LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty => FormatElement::Space,
                        _ => continue,
                    }
                }
                FormatElement::Line(LineMode::Soft | LineMode::SoftEmpty) => continue,
                FormatElement::Line(LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty) => {
                    FormatElement::Space
                }
                FormatElement::Interned(interned) => {
                    FormatElement::Interned(self.clean_interned(interned, conditions))
                }
                FormatElement::BestFitting(best_fitting) => {
                    if let Some(&flattest) = self.storage.variants(best_fitting).first() {
                        self.remove_soft_lines(flattest, conditions);
                    }
                    continue;
                }
                element => element,
            };
            self.write_element(cleaned);
        }
    }

    fn clean_interned(&mut self, interned: Interned, conditions: &mut Vec<PrintMode>) -> Interned {
        if let Some(&cleaned) = self.cleaned.get(&interned) {
            return cleaned;
        }
        let needs_cleaning = self.storage.interned(interned).iter().any(|element| {
            matches!(
                element,
                FormatElement::Line(
                    LineMode::Soft
                        | LineMode::SoftOrSpace
                        | LineMode::SoftOrSpaceEmpty
                        | LineMode::SoftEmpty
                ) | FormatElement::TokenIfBreaks(_)
                    | FormatElement::IndentedLineGroup(_)
                    | FormatElement::Tag(
                        Tag::StartConditionalContent(_)
                            | Tag::EndConditionalContent
                            | Tag::StartIndentWithLine(_)
                            | Tag::EndIndentWithLine(_)
                    )
                    | FormatElement::BestFitting(_)
                    | FormatElement::Interned(_)
            )
        });
        let cleaned = if needs_cleaning {
            let slot = self.start_capture();
            self.remove_soft_lines(interned, conditions);
            self.end_capture(slot)
        } else {
            interned
        };
        self.cleaned.insert(interned, cleaned);
        // What has been cleaned stays as it is.
        self.cleaned.insert(cleaned, cleaned);
        cleaned
    }
}

/// Formats its content once, however often it is written.
pub(crate) struct Memoized<F> {
    inner: F,
    memory: Cell<Option<Interned>>,
}

impl<F> Memoized<F> {
    fn interned<'a>(&self, f: &mut Formatter<'a>) -> Interned
    where
        F: Format<'a>,
    {
        match self.memory.get() {
            Some(interned) => interned,
            None => {
                let interned = f.capture(&self.inner);
                self.memory.set(Some(interned));
                interned
            }
        }
    }

    /// The elements of the content, which is formatted now if it has not been.
    pub(crate) fn inspect<'f, 'a>(&self, f: &'f mut Formatter<'a>) -> Elements<'f>
    where
        F: Format<'a>,
    {
        let interned = self.interned(f);
        f.interned(interned)
    }
}

impl<'a, F: Format<'a>> Format<'a> for Memoized<F> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let interned = self.interned(f);
        match f.storage.interned(interned) {
            [] => {}
            &[one] => f.write_element(one),
            _ => f.write_element(FormatElement::Interned(interned)),
        }
    }
}

pub(crate) trait MemoizeFormat<'a>: Format<'a> + Sized {
    /// Its elements are computed the first time it is written or inspected, and reused after
    /// that.
    fn memoized(self) -> Memoized<Self> {
        Memoized {
            inner: self,
            memory: Cell::new(None),
        }
    }
}

impl<'a, T: Format<'a>> MemoizeFormat<'a> for T {}

impl Formatter<'_> {
    /// Keeps a place for a start tag of which it is not known yet whether it is needed, or what it
    /// says: that depends on the content, which is written first. Returns what to pass to
    /// [`Formatter::group_from`]. The content starts at the index after it.
    #[inline]
    pub(crate) fn reserve_tag(&mut self) -> usize {
        let reserved = self.storage.pool.len();
        self.storage.pool.push(FormatElement::Nop);
        self.tracker.reserve(reserved as u32);
        reserved
    }

    /// Makes what has been written since `reserved` was reserved a group.
    pub(crate) fn group_from(&mut self, reserved: usize, should_expand: bool) {
        let mode = if should_expand {
            GroupMode::Expand
        } else {
            GroupMode::Flat
        };
        if let Some(element @ FormatElement::Nop) = self.storage.pool.get_mut(reserved) {
            *element = FormatElement::Tag(Tag::StartGroup(Group::new().with_mode(mode)));
            self.tracker.use_reserved(reserved as u32, mode);
            self.write_element(FormatElement::Tag(Tag::EndGroup));
        }
    }
}

impl<'a> Formatter<'a> {
    /// Appends an element that stands for what `content` writes to `out`, and nothing to what is
    /// written so far.
    pub(crate) fn write_into(
        &mut self,
        out: &mut Vec<FormatElement>,
        content: &(impl Format<'a> + ?Sized),
    ) {
        out.extend(self.intern(content));
    }
}

impl<'a> Formatter<'a> {
    /// The text that `content` is printed as by itself, at the start of a line without indentation.
    /// For the rare case that how something is laid out depends on the text of its parts.
    pub(crate) fn print_to_text(&mut self, content: &(impl Format<'a> + ?Sized)) -> Vec<u8> {
        let document = self.capture(content);
        self.print_document(document)
    }

    fn print_document(&self, document: Interned) -> Vec<u8> {
        use super::printer::{PrinterBuffers, PrinterOptions, print};
        let source = self.source;
        let mut out = Vec::new();
        let options = PrinterOptions::new(self.options(), source);
        if print(
            document,
            &self.storage,
            source,
            options,
            &mut PrinterBuffers::default(),
            &mut out,
        )
        .is_err()
        {
            out.clear();
        }
        out
    }
}
