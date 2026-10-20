//! [`Format`], and the [`Formatter`] that it writes to.

use super::document::Tracker;
use super::element::{
    BestFitting, Fallback, Flat, FlatFlags, FormatElement, Group, GroupId, GroupMode, Interned,
    LabelId, LineMode, PrintMode, Skip, Tag, Text, TextWidth,
};
use super::width::OddBlocks;
use crate::js::comments::Comments;
use crate::js::context::JsFormatContext;
use crate::js::source_text::SourceText;
use crate::options::{Flavor, FormatOptions};
use bun_lint::ast::File;
use bun_lint::span::Span;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::cell::Cell;
use std::num::NonZeroU32;

/// Something that can be written as [`FormatElement`]s.
pub(crate) trait Format<'a> {
    fn fmt(&self, f: &mut Formatter<'a>);

    /// Returns the text if this is just a keyword or punctuator.
    #[inline(always)]
    fn as_token(&self) -> Option<&'static str> {
        None
    }

    /// Returns the mode if this is just a line break.
    #[inline(always)]
    fn as_line(&self) -> Option<LineMode> {
        None
    }

    /// Returns the mode if this is an `indent` that contains only a line break.
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

/// A keyword or punctuator.
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

/// The value `format_args!` expands to: a tuple of references, written in order.
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

/// The tables that elements index into.
#[derive(Default)]
pub(crate) struct Storage {
    /// Every element of the document, in the order written. An [`Interned`] is a range of it.
    pub(crate) pool: Vec<FormatElement>,
    /// A [`BestFitting`] is a range of this.
    pub(crate) variants: Vec<Interned>,
    /// A [`FormatElement::OwnedText`] is a range of this.
    pub(crate) text: Vec<u8>,
}

/// Every pool starts with a few fixed elements, because the printer can only queue ranges of the pool.
pub(crate) const END_LINE_SUFFIX: Interned = Interned { start: 0, len: 1 };

/// The content of a [`FormatElement::IndentedLineGroup`] plus the group's end tag.
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
    /// Number of fixed elements at the start of every pool.
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

    /// Returns what was recorded about `interned` when it was written: its flat measurements and its
    /// [`Storage::will_break`] result.
    #[inline]
    pub(crate) fn summary_of(&self, interned: Interned) -> (Flat, bool) {
        match self.summary_of_whole(interned) {
            Some(summary) => summary,
            None => self.summary_of_part(interned),
        }
    }

    /// Returns `None` if `interned` is only part of a capture.
    #[inline]
    fn summary_of_whole(&self, interned: Interned) -> Option<(Flat, bool)> {
        match (interned.start as usize)
            .checked_sub(1)
            .and_then(|before| self.pool.get(before))
        {
            Some(FormatElement::Skip(skip)) if skip.len == interned.len => {
                Some((skip.flat, skip.will_break))
            }
            _ => None,
        }
    }

    #[cold]
    fn summary_of_part(&self, part: Interned) -> (Flat, bool) {
        let flat = Flat {
            width: 0,
            flags: FlatFlags::default().with(FlatFlags::EXPANDS, self.part_expands(part)),
        };
        (flat, self.will_break(self.interned(part)))
    }

    /// True if something in `part` forces the enclosing groups to break.
    fn part_expands(&self, part: Interned) -> bool {
        // Nested parts still to visit.
        let mut parts = SmallVec::<[Interned; 4]>::new();
        parts.push(part);
        while let Some(part) = parts.pop() {
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
                    FormatElement::Interned(interned) => match self.summary_of_whole(*interned) {
                        Some((flat, _)) => flat.flags.has(FlatFlags::EXPANDS),
                        None => {
                            parts.push(*interned);
                            false
                        }
                    },
                    _ => false,
                };
                if expands {
                    return true;
                }
            }
        }
        false
    }

    /// True if the printer is certain to print `elements` over several lines, because they contain a hard line break, a
    /// multiline text or an expanded group.
    pub(crate) fn will_break(&self, elements: &[FormatElement]) -> bool {
        // Nested parts of captures still to visit.
        let mut parts = SmallVec::<[&[FormatElement]; 4]>::new();
        parts.push(elements);
        while let Some(elements) = parts.pop() {
            let mut ignore_depth = 0usize;
            let mut elements = elements.iter();
            while let Some(element) = elements.next() {
                let interned = match element {
                    FormatElement::Skip(it) => {
                        skip(&mut elements, it.len);
                        continue;
                    }
                    FormatElement::Tag(Tag::StartLineSuffix) => {
                        ignore_depth += 1;
                        continue;
                    }
                    FormatElement::Tag(Tag::EndLineSuffix) => {
                        ignore_depth = ignore_depth.saturating_sub(1);
                        continue;
                    }
                    FormatElement::Line(mode)
                    | FormatElement::Tag(
                        Tag::StartIndentWithLine(mode) | Tag::EndIndentWithLine(mode),
                    ) if mode.will_break() => {
                        return true;
                    }
                    _ if ignore_depth != 0 => continue,
                    FormatElement::ExpandParent => return true,
                    // `Propagated` groups don't count. The walk reaches whatever made them break.
                    FormatElement::Tag(Tag::StartGroup(group))
                        if group.mode() == GroupMode::Expand =>
                    {
                        return true;
                    }
                    FormatElement::SourceText(text) | FormatElement::OwnedText(text)
                        if text.width.is_multiline() && !text.width.is_one_string() =>
                    {
                        return true;
                    }
                    FormatElement::Interned(interned) => Some(interned),
                    // If even the flattest variant has something that forces a break, it breaks.
                    FormatElement::BestFitting(it) => self.variants(*it).first(),
                    _ => None,
                };
                match interned.map(|&it| (it, self.summary_of_whole(it))) {
                    Some((_, Some((_, true)))) => return true,
                    Some((part, None)) => parts.push(self.interned(part)),
                    _ => {}
                }
            }
        }
        false
    }

    /// True if `elements` contains any [`FormatElement::Line`].
    pub(crate) fn may_directly_break(&self, elements: &[FormatElement], flavor: Flavor) -> bool {
        // Nested content still to visit.
        let mut rest = SmallVec::<[&[FormatElement]; 4]>::new();
        rest.push(elements);
        while let Some(elements) = rest.pop() {
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
                    | FormatElement::Tag(Tag::StartIndentWithLine(_) | Tag::EndIndentWithLine(_)) =>
                    {
                        return true;
                    }
                    FormatElement::Interned(it) => rest.push(self.interned(*it)),
                    // oxfmt doesn't look into a `BestFitting`, and it has no `FlattestIfStable`.
                    FormatElement::BestFitting(it)
                        if !flavor.is_oxfmt() || it.fallback == Fallback::FlattestIfStable =>
                    {
                        rest.push(self.most_flat(*it));
                    }
                    _ => {}
                }
            }
        }
        false
    }

    /// True if `elements` starts with the label.
    pub(crate) fn has_label(&self, elements: &[FormatElement], label: LabelId) -> bool {
        let mut elements = elements.iter();
        while let Some(element) = elements.next() {
            match element {
                FormatElement::Skip(it) => skip(&mut elements, it.len),
                FormatElement::Nop | FormatElement::Cursor(_) => {}
                FormatElement::Tag(Tag::StartLabelled(actual)) => return *actual == label,
                FormatElement::Interned(it) => elements = self.interned(*it).iter(),
                _ => return false,
            }
        }
        false
    }
}

/// Advances past the elements that a [`FormatElement::Skip`] covers.
#[inline]
fn skip(elements: &mut std::slice::Iter<'_, FormatElement>, count: u32) {
    if count > 0 {
        elements.nth(count as usize - 1);
    }
}

/// A slice of elements plus the storage needed to follow their references.
#[derive(Copy, Clone)]
pub(crate) struct Elements<'f> {
    storage: &'f Storage,
    elements: &'f [FormatElement],
    /// Set if already known.
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

    pub(crate) fn may_directly_break(self, flavor: Flavor) -> bool {
        self.storage.may_directly_break(self.elements, flavor)
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

/// A [`Formatter`]'s vectors, reused across files to keep their capacity.
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
    /// Sees every element as it's written.
    tracker: Tracker,
    /// Scratch vectors. See [`Formatter::take_vec`].
    spare: Vec<Vec<FormatElement>>,
    /// Maps interned content to its copy without soft line breaks.
    cleaned: FxHashMap<Interned, Interned>,
    next_group_id: Cell<u32>,
    source: &'a [u8],
    /// Computed from `source`.
    odd_blocks: OddBlocks,
    context: JsFormatContext<'a>,
}

impl<'a> Formatter<'a> {
    /// `source` is the text that [`FormatElement::SourceText`] ranges index into.
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
        // oxc's measurements on the VS Code sources: a median of 0.19 elements per byte, with 95% of files below 0.4.
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

    /// Returns the document's range and the buffers for reuse.
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

    /// Calls `write` with a formatter for a different text, `source`, that keeps appending to this document. Used for a
    /// script in HTML, for example.
    ///
    /// The inner formatter takes over the elements, the group id counter and the state of the open groups, so a forced
    /// line break it writes still breaks them. Pool ranges stay valid. The `source` ranges it writes are rebased onto
    /// this formatter's source if `source` is a slice of it, and otherwise onto a copy of `source`.
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

    /// Same, but discards what `write` wrote unless it returns true.
    pub(crate) fn try_write_embedded<'b>(
        &mut self,
        context: JsFormatContext<'b>,
        source: &'b [u8],
        write: impl FnOnce(&mut Formatter<'b>) -> bool,
    ) -> bool {
        let first = self.storage.pool.len();
        let mut inner = self.start_embedded(context, source);
        let slot = inner.start_capture();
        let is_written = write(&mut inner);
        if let Some(content) = inner.end_intern(slot)
            && is_written
        {
            inner.write_element(content);
        }
        self.end_embedded(inner, first);
        is_written
    }

    /// Creates a formatter for `source` that takes over this one's state.
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

    /// Takes the state back from `inner`, which wrote the elements from `first` on.
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

    // ───────────────────────────── context ─────────────────────────────

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

    /// Returns a new id. `_debug_name` only documents the group at the call site.
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

    /// Returns the width of `text`, which may contain anything.
    fn text_width(&self, text: &[u8]) -> TextWidth {
        let options = self.options();
        TextWidth::from_javascript(text, options.flavor, options.indent_width.value())
    }

    /// Returns the width in columns of `text`, which has no line break.
    #[inline]
    pub(crate) fn string_width(&self, text: &[u8]) -> u32 {
        super::width::string_width_as(text, self.options().flavor)
    }

    /// True if the source text of `span`, which has no line break or tab, is as many columns wide as it has bytes and
    /// has no backslash. False negatives are possible.
    #[inline]
    pub(crate) fn is_plain_source(&self, span: Span) -> bool {
        self.odd_blocks.is_plain(span.start, span.end)
    }

    /// Writes the source text of `span`, which has no line break or tab.
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

    /// Writes `\u0061b` as `ab`, because Prettier prints an identifier's name, not its source text. Returns false
    /// without writing anything if `text` isn't a name, optionally preceded by `.` or `?.`.
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

    /// Writes `text`, which may contain anything except `\r`. It isn't copied if it's a slice of the source text.
    pub(crate) fn write_text(&mut self, text: &[u8], width: Option<TextWidth>) {
        let width = width.unwrap_or_else(|| self.text_width(text));
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

    /// Writes whatever `build` appends to its vector as one text.
    pub(crate) fn write_built_text(&mut self, build: impl FnOnce(&mut Vec<u8>)) {
        let start = self.storage.text.len();
        build(&mut self.storage.text);
        self.write_owned_text_from(start);
    }

    /// Writes `storage.text[start..]` as one text.
    fn write_owned_text_from(&mut self, start: usize) {
        let text = self.storage.text.get(start..).unwrap_or_default();
        let width = self.text_width(text);
        let len = text.len() as u32;
        self.write_element(FormatElement::OwnedText(Text {
            start: start as u32,
            len,
            width,
        }));
    }

    // ───────────────────────────── inspecting written elements ─────────────────────────────

    /// Everything written so far. Save its length to inspect what's written after that point with
    /// `f.elements_from(start)`.
    #[inline]
    pub(crate) fn elements(&self) -> &[FormatElement] {
        &self.storage.pool
    }

    /// Returns the elements written since `f.elements().len()` was `start`.
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

    /// Starts content that isn't part of what's being written. Nothing gets moved. The content stays where it's
    /// written, after a [`FormatElement::Skip`] that tells readers of the pool to skip it.
    #[inline]
    pub(crate) fn start_capture(&mut self) -> usize {
        let slot = self.storage.pool.len();
        self.storage.pool.push(FormatElement::Skip(Skip::new(0)));
        self.tracker.start_skipped(slot as u32);
        slot
    }

    /// Ends the capture that returned `slot`.
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

    /// Formats `content` without writing it. Returns its range.
    pub(crate) fn capture(&mut self, content: &(impl Format<'a> + ?Sized)) -> Interned {
        let slot = self.start_capture();
        content.fmt(self);
        self.end_capture(slot)
    }

    /// Formats `content` without writing it. The returned element represents it and can be written any number of times.
    /// Returns `None` if `content` writes nothing.
    pub(crate) fn intern(&mut self, content: &(impl Format<'a> + ?Sized)) -> Option<FormatElement> {
        let slot = self.start_capture();
        content.fmt(self);
        self.end_intern(slot)
    }

    /// Returns an element that represents everything written since `start_capture` returned `slot`.
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

    /// Same, for existing elements.
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

    /// Returns an element that lets the printer choose among `variants`, ordered from the flattest to the most
    /// expanded. Each starts with a [`Tag::StartEntry`] and ends with a [`Tag::EndEntry`].
    pub(crate) fn best_fitting_of(&mut self, variants: &[Interned]) -> FormatElement {
        self.best_fitting_with(variants, Fallback::MostExpanded)
    }

    pub(crate) fn best_fitting_with(
        &mut self,
        variants: &[Interned],
        fallback: Fallback,
    ) -> FormatElement {
        debug_assert!(variants.len() >= 2);
        let first = self.storage.variants.len() as u32;
        self.storage.variants.extend_from_slice(variants);
        FormatElement::BestFitting(BestFitting {
            first,
            count: variants.len() as u32,
            fallback,
        })
    }

    /// Returns an empty vector that may already have capacity. Hand it back with [`Formatter::recycle_vec`].
    pub(crate) fn take_vec(&mut self) -> Vec<FormatElement> {
        self.spare.pop().unwrap_or_default()
    }

    pub(crate) fn recycle_vec(&mut self, mut vec: Vec<FormatElement>) {
        vec.clear();
        self.spare.push(vec);
    }

    // ───────────────────────────── removing soft line breaks ─────────────────────────────

    /// Writes `content` as it would print on an infinitely long line. Soft line breaks are removed or replaced by
    /// spaces, content that's only printed when a group breaks is removed, and a `BestFitting` is replaced by its
    /// flattest variant.
    pub(crate) fn write_without_soft_lines(&mut self, content: &(impl Format<'a> + ?Sized)) {
        let captured = self.capture(content);
        self.remove_soft_lines(captured, &mut Vec::new(), Variants::Flattest);
    }

    /// Prettier's `removeLines`. Same, but the printer still chooses among the variants and falls back to the most
    /// expanded one if none fits.
    pub(crate) fn write_with_lines_removed(&mut self, content: &(impl Format<'a> + ?Sized)) {
        let captured = self.capture(content);
        self.remove_soft_lines(captured, &mut Vec::new(), Variants::All);
    }

    /// Writes the elements at `range` without their soft line breaks.
    fn remove_soft_lines(
        &mut self,
        range: Interned,
        conditions: &mut Vec<PrintMode>,
        variants: Variants,
    ) {
        if !self.context_mut().has_stack_left() {
            return;
        }
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
                    FormatElement::Interned(self.clean_interned(interned, conditions, variants))
                }
                FormatElement::BestFitting(best_fitting) if variants == Variants::All => {
                    let mut cleaned = smallvec::SmallVec::<[Interned; 4]>::new();
                    for index in best_fitting.range() {
                        let Some(&variant) = self.storage.variants.get(index) else {
                            continue;
                        };
                        let slot = self.start_capture();
                        self.remove_soft_lines(variant, conditions, variants);
                        cleaned.push(self.end_capture(slot));
                    }
                    self.best_fitting_with(&cleaned, best_fitting.fallback)
                }
                FormatElement::BestFitting(best_fitting) => {
                    if let Some(&flattest) = self.storage.variants(best_fitting).first() {
                        self.remove_soft_lines(flattest, conditions, variants);
                    }
                    continue;
                }
                element => element,
            };
            self.write_element(cleaned);
        }
    }

    fn clean_interned(
        &mut self,
        interned: Interned,
        conditions: &mut Vec<PrintMode>,
        variants: Variants,
    ) -> Interned {
        // The cache only holds `Variants::Flattest` results.
        if variants == Variants::All {
            let slot = self.start_capture();
            self.remove_soft_lines(interned, conditions, variants);
            return self.end_capture(slot);
        }
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
            self.remove_soft_lines(interned, conditions, variants);
            self.end_capture(slot)
        } else {
            interned
        };
        self.cleaned.insert(interned, cleaned);
        // Cleaning cleaned content is a no-op.
        self.cleaned.insert(cleaned, cleaned);
        cleaned
    }
}

/// Formats its content once, no matter how often it's written.
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

    /// Returns the content's elements, formatting it first if needed.
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
    /// Computes the elements the first time it's written or inspected, and reuses them after that.
    fn memoized(self) -> Memoized<Self> {
        Memoized {
            inner: self,
            memory: Cell::new(None),
        }
    }
}

impl<'a, T: Format<'a>> MemoizeFormat<'a> for T {}

impl Formatter<'_> {
    /// Reserves a slot for a start tag when the content, which is written first, decides whether the tag is needed and
    /// what it is. Pass the returned index to [`Formatter::group_from`]. The content starts at the next index.
    #[inline]
    pub(crate) fn reserve_tag(&mut self) -> usize {
        let reserved = self.storage.pool.len();
        self.storage.pool.push(FormatElement::Nop);
        self.tracker.reserve(reserved as u32);
        reserved
    }

    /// Turns everything written since `reserved` was reserved into a group.
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
    /// Appends an element that represents `content` to `out` instead of to the document.
    pub(crate) fn write_into(
        &mut self,
        out: &mut Vec<FormatElement>,
        content: &(impl Format<'a> + ?Sized),
    ) {
        out.extend(self.intern(content));
    }
}

impl<'a> Formatter<'a> {
    /// Prints `content` by itself, starting at column 0 with no indentation, and returns the text. For the rare case
    /// where layout depends on the printed text of a part.
    pub(crate) fn print_to_text(&mut self, content: &(impl Format<'a> + ?Sized)) -> Vec<u8> {
        let document = self.capture(content);
        self.print_document(document)
    }

    fn print_document(&self, document: Interned) -> Vec<u8> {
        use super::printer::{PrinterBuffers, PrinterOptions, print};
        let source = self.source;
        let mut out = Vec::new();
        // The text goes back into the document, where a line break is always `\n` regardless of the file's line ending,
        // and the final print is what marks line breaks in texts for Markdown. Prettier:
        // `printDocToString(.., { endOfLine: "lf" })`.
        let options = PrinterOptions {
            line_ending: crate::options::LineEnding::Lf,
            marks_line_breaks_in_texts: false,
            ..PrinterOptions::new(self.options(), source)
        };
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

/// Selects the [`BestFitting`] variants to keep when soft line breaks are removed.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Variants {
    Flattest,
    All,
}
