//! [`Format`], and the [`Formatter`] that it writes to.

use super::element::{
    BestFitting, FormatElement, GroupId, Interned, LabelId, LineMode, PrintMode, Skip, Tag, Text,
    TextWidth,
};
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
}

impl<'a, T: ?Sized + Format<'a>> Format<'a> for &T {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'a>) {
        Format::fmt(&**self, f);
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
pub(crate) const HARD_LINE_BREAK: Interned = Interned { start: 0, len: 1 };
pub(crate) const END_LINE_SUFFIX: Interned = Interned { start: 1, len: 1 };

impl Storage {
    /// The number of elements that are in every pool.
    const RESERVED: u32 = 2;

    pub(crate) fn clear(&mut self) {
        self.pool.clear();
        self.pool.push(FormatElement::Line(LineMode::Hard));
        self.pool.push(FormatElement::Tag(Tag::EndLineSuffix));
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

    fn element_will_break(&self, element: &FormatElement) -> bool {
        match element {
            FormatElement::ExpandParent => true,
            FormatElement::Tag(Tag::StartGroup(group)) => !group.mode().is_flat(),
            FormatElement::Line(mode) => mode.will_break(),
            FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                text.width.is_multiline()
            }
            FormatElement::Interned(interned) => self.will_break(self.interned(*interned)),
            // If even the flattest variant has something that forces a break, it breaks.
            FormatElement::BestFitting(it) => self.will_break(self.most_flat(*it)),
            FormatElement::Token(_)
            | FormatElement::LineSuffixBoundary
            | FormatElement::Space
            | FormatElement::Nop
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
                FormatElement::Line(mode) if mode.will_break() => return true,
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
                FormatElement::Line(_) => return true,
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
                FormatElement::Nop => continue,
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
}

impl<'f> Elements<'f> {
    pub(crate) fn will_break(self) -> bool {
        self.storage.will_break(self.elements)
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
    spare: Vec<Vec<FormatElement>>,
    cleaned: FxHashMap<Interned, Interned>,
}

/// Collects the elements of a document.
pub(crate) struct Formatter<'a> {
    /// `storage.pool` is the document so far.
    pub(crate) storage: Storage,
    /// Vectors for whoever needs one for a while: [`Formatter::take_vec`].
    spare: Vec<Vec<FormatElement>>,
    /// Interned content, and the same without soft line breaks.
    cleaned: FxHashMap<Interned, Interned>,
    next_group_id: Cell<u32>,
    source: &'a [u8],
    width_is_len: bool,
    context: JsFormatContext<'a>,
}

impl<'a> Formatter<'a> {
    pub(crate) fn new(context: JsFormatContext<'a>, buffers: FormatterBuffers) -> Self {
        let FormatterBuffers {
            mut storage,
            spare,
            mut cleaned,
        } = buffers;
        storage.clear();
        cleaned.clear();
        let source = context.file().text();
        // Measured by oxc on the sources of VS Code: the median is 0.19 elements per byte, and
        // 95% of the files are below 0.4.
        storage.pool.reserve(source.len() * 2 / 5);
        Formatter {
            storage,
            spare,
            cleaned,
            next_group_id: Cell::new(1),
            source,
            width_is_len: super::width::is_width_len(source),
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
            spare: self.spare,
            cleaned: self.cleaned,
        };
        (root, buffers)
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
        self.storage.pool.push(element);
    }

    #[inline(always)]
    pub(crate) fn write_token(&mut self, text: &'static str) {
        match super::element::Token::new(text) {
            Some(token) => self.write_element(FormatElement::Token(token)),
            None => self.write_owned_text(text.as_bytes(), TextWidth::single(text.len() as u32)),
        }
    }

    /// Writes the source text of `span`, which has no line break and no tab.
    #[inline]
    pub(crate) fn write_source_token(&mut self, span: Span) {
        let len = span.len();
        let width = match self.width_is_len {
            true => len,
            false => super::width::string_width(self.source.get(span.range()).unwrap_or_default()),
        };
        self.write_element(FormatElement::SourceText(Text {
            start: span.start,
            len,
            width: TextWidth::single(width),
        }));
    }

    /// Writes `text`, which can be anything but has no `\r`. It is not copied if it is part of
    /// the source text.
    pub(crate) fn write_text(&mut self, text: &[u8], width: Option<TextWidth>) {
        let width = width
            .unwrap_or_else(|| TextWidth::from_text(text, self.options().indent_width.value()));
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
        let text = self.storage.text.get(start..).unwrap_or_default();
        let width = TextWidth::from_text(text, self.options().indent_width.value());
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
        self.view(self.storage.pool.get(start..).unwrap_or_default())
    }

    pub(crate) fn view<'f>(&'f self, elements: &'f [FormatElement]) -> Elements<'f> {
        Elements {
            storage: &self.storage,
            elements,
        }
    }

    pub(crate) fn interned(&self, interned: Interned) -> Elements<'_> {
        self.view(self.storage.interned(interned))
    }

    // ───────────────────────────── interning ─────────────────────────────

    /// Starts content that is not part of what is being written. Nothing is moved: it stays where
    /// it is written, behind an element that tells whoever reads the pool to skip it.
    #[inline]
    pub(crate) fn start_capture(&mut self) -> usize {
        self.storage.pool.push(FormatElement::Skip(Skip::new(0)));
        self.storage.pool.len() - 1
    }

    /// Ends the content that `slot` started.
    pub(crate) fn end_capture(&mut self, slot: usize) -> Interned {
        let len = self.storage.pool.len().saturating_sub(slot + 1) as u32;
        match self.storage.pool.get_mut(slot) {
            Some(element) if len > 0 => *element = FormatElement::Skip(Skip::new(len)),
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
        if self.storage.pool.len() == slot + 2 {
            let only = self.storage.pool.pop();
            self.storage.pool.truncate(slot);
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
                self.storage.pool.extend_from_slice(elements);
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
        while let Some(&element) = indices.next().and_then(|index| self.storage.pool.get(index)) {
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
                FormatElement::Line(LineMode::Soft) => continue,
                FormatElement::Line(LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty) => FormatElement::Space,
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
            self.storage.pool.push(cleaned);
        }
    }

    fn clean_interned(&mut self, interned: Interned, conditions: &mut Vec<PrintMode>) -> Interned {
        if let Some(&cleaned) = self.cleaned.get(&interned) {
            return cleaned;
        }
        let needs_cleaning = self.storage.interned(interned).iter().any(|element| {
            matches!(
                element,
                FormatElement::Line(LineMode::Soft | LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty)
                    | FormatElement::Tag(
                        Tag::StartConditionalContent(_) | Tag::EndConditionalContent
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
    /// [`Formatter::fill_tag`]. The content starts at the index after it.
    #[inline]
    pub(crate) fn reserve_tag(&mut self) -> usize {
        self.storage.pool.push(FormatElement::Nop);
        self.storage.pool.len() - 1
    }

    /// Writes `tag` at a place that has been reserved. The end tag is up to the caller.
    #[inline]
    pub(crate) fn fill_tag(&mut self, reserved: usize, tag: Tag) {
        if let Some(element @ FormatElement::Nop) = self.storage.pool.get_mut(reserved) {
            *element = FormatElement::Tag(tag);
        }
    }

    /// Makes what has been written since `reserved` was reserved a group.
    pub(crate) fn group_from(&mut self, reserved: usize, should_expand: bool) {
        use super::element::{Group, GroupMode};
        let mode = if should_expand { GroupMode::Expand } else { GroupMode::Flat };
        self.fill_tag(reserved, Tag::StartGroup(Group::new().with_mode(mode)));
        self.storage.pool.push(FormatElement::Tag(Tag::EndGroup));
    }
}

impl<'a> Formatter<'a> {
    /// Appends an element that stands for what `content` writes to `out`, and nothing to what is
    /// written so far.
    pub(crate) fn write_into(&mut self, out: &mut Vec<FormatElement>, content: &(impl Format<'a> + ?Sized)) {
        out.extend(self.intern(content));
    }
}

impl<'a> Formatter<'a> {
    /// The text that `content` is printed as by itself, at the start of a line without indentation.
    /// For the rare case that how something is laid out depends on the text of its parts.
    pub(crate) fn print_to_text(&mut self, content: &(impl Format<'a> + ?Sized)) -> Vec<u8> {
        use super::printer::{PrinterBuffers, PrinterOptions, print};
        let document = self.capture(content);
        let source = self.file().text();
        let mut out = Vec::new();
        let options = PrinterOptions::new(self.options(), source);
        if print(document, &self.storage, source, options, &mut PrinterBuffers::default(), &mut out).is_err() {
            out.clear();
        }
        out
    }
}
