//! Inline-level content: white space processing and shaping. `lines.rs` breaks it into lines.

use core::cell::RefCell;
use core::hash::Hasher;
use core::ops::Range;
use std::borrow::Cow;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::abi::{self, Cluster, Letter, TextRun};
use crate::boxes::BoxId;
use crate::characters::*;
use crate::document::Document;
use crate::lines::{Line, Lines, edge};
use crate::name::{Map, keyed_hasher};
use crate::platform::{self, Shaped, glyph_extent, has_positioning_feature};
use crate::properties::Style;
use crate::tree::NodeId;
use crate::types::*;

/// A flag of a cluster that stands upright on a vertical line.
pub(crate) const UPRIGHT: u8 = 0x80;
/// Of one that `text-combine-upright` applies to.
pub(crate) const COMBINED: u8 = 0x40;
/// Of a space that does not collapse.
pub(crate) const IDEOGRAPHIC_SPACE: u8 = 0x20;
/// Of a cluster that is no space: `text-autospace` has added to its advance.
const AUTOSPACED: u8 = IDEOGRAPHIC_SPACE;
/// Punctuation whose first half is blank, and may be trimmed.
pub(crate) const OPENING: u8 = 0x08;
/// With [`OPENING`], the half is trimmed inside of a line. Without, the second half is at the end of one.
pub(crate) const TRIMS: u8 = 0x10;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ItemKind {
    Text,
    /// `true` unless a block splits the element here.
    Open(bool),
    Close(bool),
    Atomic(BoxId),
    Float(BoxId),
    OutOfFlow(BoxId),
    Break,
    /// The start of the base of a ruby column.
    RubyBase,
    /// The end of the base that starts at the item.
    Annotation(BoxId, u32),
    /// Bidi controls.
    Control,
}

impl ItemKind {
    pub(crate) fn embedded(self) -> Option<BoxId> {
        match self {
            ItemKind::Atomic(id)
            | ItemKind::Float(id)
            | ItemKind::OutOfFlow(id)
            | ItemKind::Annotation(id, _) => Some(id),
            _ => None,
        }
    }
}

/// A piece of a text node, and what has become of it.
#[derive(Clone, Copy)]
pub(crate) struct Segment {
    pub(crate) node_start: u32,
    pub(crate) node_end: u32,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

#[derive(Clone)]
pub(crate) struct Item {
    pub(crate) kind: ItemKind,
    /// `style` is that of `::first-line` or `::first-letter`.
    pub(crate) has_own_style: bool,
    /// Its clusters have the same face, direction and orientation.
    pub(crate) is_uniform: bool,
    pub(crate) node: NodeId,
    /// For text, of the parent.
    pub(crate) style: Rc<Style>,
    /// In `text`.
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) clusters: Range<u32>,
    pub(crate) segments: Range<u32>,
    /// The `Open` item that it is in, plus one. 0 is the root.
    pub(crate) parent: u32,
}

pub(crate) struct Paragraph {
    pub(crate) first_cluster: u32,
    pub(crate) shaped: Rc<Shaped>,
}

/// Their starts are in the whole text, and their glyphs and faces in their paragraph.
pub(crate) struct Clusters {
    pub(crate) paragraphs: SmallVec<[Paragraph; 1]>,
    joined: core::cell::OnceCell<Vec<Cluster>>,
    count: u32,
    /// The letters of the paragraphs say all.
    are_letters: bool,
}

impl Clusters {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.count as usize
    }

    fn paragraph_of(&self, cluster: u32) -> &Paragraph {
        &self.paragraphs[self
            .paragraphs
            .partition_point(|it| it.first_cluster <= cluster)
            .max(1)
            - 1]
    }

    #[cold]
    fn join(&self) -> Vec<Cluster> {
        let (mut joined, mut start) = (Vec::with_capacity(self.len()), 0);
        for Paragraph { shaped, .. } in &self.paragraphs {
            joined.extend(shaped.clusters().iter().map(|cluster| Cluster {
                start: cluster.start + start,
                ..*cluster
            }));
            start += shaped.text.len() as u32;
        }
        joined
    }

    /// `range` is in one paragraph.
    pub(crate) fn letters(&self, range: &Range<u32>) -> Option<&[Letter]> {
        let paragraph = self.are_letters.then(|| self.paragraph_of(range.start))?;
        paragraph.shaped.letters.get(
            (range.start - paragraph.first_cluster) as usize
                ..(range.end - paragraph.first_cluster) as usize,
        )
    }

    /// The glyphs may be missing.
    pub(crate) fn as_letters(&self) -> Option<Cow<'_, [Letter]>> {
        let letter = |it: &Cluster| {
            Some(Letter {
                advance: it.advance,
                glyph: abi::NO_GLYPH,
                flags: it.flags,
                face: it.face.try_into().ok()?,
            })
        };
        match &self.paragraphs[..] {
            _ if !self.are_letters => self.iter().map(letter).collect(),
            [only] => Some(Cow::Borrowed(&only.shaped.letters)),
            all => {
                let mut joined = Vec::with_capacity(self.len());
                all.iter()
                    .for_each(|it| joined.extend_from_slice(&it.shaped.letters));
                Some(joined.into())
            }
        }
    }

    pub(crate) fn label(&self) -> Option<crate::lines::Label> {
        let [only] = &self.paragraphs[..] else {
            return None;
        };
        only.shaped.label.filter(|_| self.are_letters)
    }
}

impl core::ops::Deref for Clusters {
    type Target = [Cluster];
    #[inline]
    fn deref(&self) -> &[Cluster] {
        match (self.joined.get(), &self.paragraphs[..]) {
            (Some(joined), _) => joined,
            (_, [only]) => only.shaped.clusters(),
            _ => self.joined.get_or_init(|| self.join()),
        }
    }
}

impl core::ops::DerefMut for Clusters {
    fn deref_mut(&mut self) -> &mut [Cluster] {
        self.joined.get_or_init(|| self.join());
        self.are_letters = false;
        self.joined.get_mut().map_or(&mut [], |it| it)
    }
}

pub(crate) enum Text {
    Own(Box<str>),
    /// That of the only paragraph.
    Shared(Rc<Shaped>),
}

impl core::ops::Deref for Text {
    type Target = str;
    #[inline]
    fn deref(&self) -> &str {
        match self {
            Text::Own(own) => own,
            Text::Shared(shaped) => &shaped.text,
        }
    }
}

pub(crate) struct Inline {
    pub(crate) text: Text,
    pub(crate) items: SmallVec<[Item; 1]>,
    pub(crate) segments: SmallVec<[Segment; 1]>,
    pub(crate) clusters: Clusters,
    pub(crate) has_bidi: bool,
    pub(crate) has_layers: bool,
    pub(crate) has_ruby: bool,
    pub(crate) force_line: bool,
    /// If that is all there is.
    pub(crate) label: Option<crate::lines::Label>,
    /// The same items and clusters in the style of `::first-line`, which comes with them.
    pub(crate) first_line: Option<Box<(Inline, Rc<Style>)>>,
    pub(crate) lines: Lines,
    /// How far an item may paint outside of its fragments.
    pub(crate) outset: core::cell::Cell<Option<f32>>,
    pub(crate) prose: core::cell::OnceCell<Option<crate::lines::Prose>>,
}

impl Inline {
    /// The items between `open` and its end.
    pub(crate) fn inside(&self, open: usize) -> core::ops::Range<usize> {
        let is_end =
            |it: &Item| matches!(it.kind, ItemKind::Close(_)) && it.node == self.items[open].node;
        open + 1
            ..self.items[open..]
                .iter()
                .position(is_end)
                .map_or(self.items.len(), |it| open + it)
    }

    pub(crate) fn nodes(&self) -> impl Iterator<Item = NodeId> + '_ {
        (self.items.iter())
            .filter(|item| {
                matches!(
                    item.kind,
                    ItemKind::Text | ItemKind::Open(_) | ItemKind::Break
                )
            })
            .map(|item| item.node)
            .filter(|node| *node != 0)
    }

    pub(crate) fn has_positioned_elements(&self) -> bool {
        (self.items.iter())
            .any(|item| matches!(item.kind, ItemKind::Open(_)) && item.style.is_positioned())
    }

    pub(crate) fn paragraph_of(&self, cluster: u32) -> &Paragraph {
        self.clusters.paragraph_of(cluster)
    }

    pub(crate) fn is_newline(&self, cluster: u32) -> bool {
        self.text.as_bytes()[self.clusters[cluster as usize].start as usize] == b'\n'
    }

    /// In the search for the first or the last formatted line.
    pub(crate) fn is_passed_over(&self) -> bool {
        self.text.is_empty() && !self.force_line && {
            let edges = || {
                self.items.iter().filter_map(|it| {
                    if let ItemKind::Open(edge) | ItemKind::Close(edge) = it.kind {
                        Some(edge)
                    } else {
                        None
                    }
                })
            };
            edges().next().is_none() || edges().any(|it| !it)
        }
    }

    pub(crate) fn character(&self, cluster: u32) -> char {
        self.text[self.clusters[cluster as usize].start as usize..]
            .chars()
            .next()
            .unwrap_or_default()
    }

    /// What has the styles and the glyphs for the line.
    pub(crate) fn for_line(&self, line: &Line) -> &Inline {
        self.first_line
            .as_ref()
            .filter(|_| line.fragments.start == 0)
            .map_or(self, |it| &it.0)
    }

    pub(crate) fn segments_of(&self, item: &Item) -> &[Segment] {
        &self.segments[item.segments.start as usize..item.segments.end as usize]
    }

    /// From a UTF-8 offset in the item's node.
    pub(crate) fn text_offset(&self, item: &Item, offset: u32) -> u32 {
        let segments = self.segments_of(item);
        match segments.get(segments.partition_point(|it| it.node_end <= offset)) {
            None => segments.last().map_or(item.end, |it| it.end),
            Some(it) if offset <= it.node_start => it.start,
            Some(it) if it.node_end - it.node_start == it.end - it.start => {
                it.start + offset - it.node_start
            }
            Some(it) => it.end,
        }
    }

    /// To a UTF-8 offset in the item's node.
    pub(crate) fn node_offset(&self, item: &Item, offset: u32) -> u32 {
        let segments = self.segments_of(item);
        match segments.get(segments.partition_point(|it| it.end <= offset)) {
            None => segments.last().map_or(0, |it| it.node_end),
            Some(it) if it.node_end - it.node_start == it.end - it.start => {
                it.node_start + offset.saturating_sub(it.start)
            }
            Some(it) => it.node_start,
        }
    }

    /// The first cluster that starts at `offset` or later.
    pub(crate) fn cluster_at(&self, offset: u32) -> u32 {
        self.clusters
            .partition_point(|cluster| cluster.start < offset) as u32
    }
}

pub(crate) struct Builder {
    root: Rc<Style>,
    text: String,
    items: SmallVec<[Item; 1]>,
    segments: SmallVec<[Segment; 1]>,
    /// What opens the bidi contexts around the current position.
    contexts: Vec<&'static str>,
    /// For each ruby around the current position, where the current base starts.
    bases: Vec<u32>,
    state: State,
}

#[derive(Default)]
pub(crate) struct State {
    pub(crate) id: BoxId,
    parent: u32,
    /// A collapsible space would collapse.
    after_space: bool,
    /// The item that ends the text with a collapsible space.
    trailing_space: Option<usize>,
    in_word: bool,
    force_line: bool,
    /// A forced break has closed them.
    are_contexts_closed: bool,
    /// The collapsible space at the end is a segment break.
    ends_with_break: bool,
    has_split_text: bool,
}

impl core::ops::Deref for Builder {
    type Target = State;
    fn deref(&self) -> &State {
        &self.state
    }
}

impl core::ops::DerefMut for Builder {
    fn deref_mut(&mut self) -> &mut State {
        &mut self.state
    }
}

pub(crate) fn bidi_controls(style: &Style) -> (&'static str, &'static str) {
    match (style.layout.unicode_bidi, style.is_rtl()) {
        (UnicodeBidi::Normal, _) => ("", ""),
        (UnicodeBidi::Embed, false) => ("\u{202a}", "\u{202c}"),
        (UnicodeBidi::Embed, true) => ("\u{202b}", "\u{202c}"),
        (UnicodeBidi::BidiOverride, false) => ("\u{202d}", "\u{202c}"),
        (UnicodeBidi::BidiOverride, true) => ("\u{202e}", "\u{202c}"),
        (UnicodeBidi::Isolate, false) => ("\u{2066}", "\u{2069}"),
        (UnicodeBidi::Isolate, true) => ("\u{2067}", "\u{2069}"),
        (UnicodeBidi::IsolateOverride, false) => ("\u{2068}\u{202d}", "\u{202c}\u{2069}"),
        (UnicodeBidi::IsolateOverride, true) => ("\u{2068}\u{202e}", "\u{202c}\u{2069}"),
        (UnicodeBidi::Plaintext, _) => ("\u{2068}", "\u{2069}"),
    }
}

impl Builder {
    pub(crate) fn new(id: BoxId, root: &Rc<Style>, spare: Option<Box<Builder>>) -> Box<Builder> {
        let mut builder = spare.unwrap_or_else(|| {
            let (text, items, segments, contexts, bases, state) = Default::default();
            Box::new(Builder {
                root: Rc::clone(root),
                text,
                items,
                segments,
                contexts,
                bases,
                state,
            })
        });
        builder.text.clear();
        builder.contexts.clear();
        builder.bases.clear();
        (builder.root, builder.state) = (
            Rc::clone(root),
            State {
                id,
                after_space: true,
                ..State::default()
            },
        );
        if matches!(
            root.layout.unicode_bidi,
            UnicodeBidi::BidiOverride | UnicodeBidi::IsolateOverride
        ) {
            builder.contexts.push(if root.is_rtl() {
                "\u{202e}"
            } else {
                "\u{202d}"
            });
            builder.are_contexts_closed = true;
        }
        if root.display() == Display::BlockRuby {
            builder.start_base(root);
        }
        builder
    }

    pub(crate) fn has_content(&self) -> bool {
        !self.text.is_empty()
    }

    pub(crate) fn force_line(&mut self) {
        self.force_line = true;
    }

    fn push(&mut self, kind: ItemKind, node: NodeId, style: &Rc<Style>, text: &str) {
        let start = self.text.len() as u32;
        self.text.push_str(text);
        self.items.push(Item {
            kind,
            has_own_style: false,
            is_uniform: false,
            node,
            style: Rc::clone(style),
            start,
            end: self.text.len() as u32,
            clusters: 0..0,
            segments: 0..0,
            parent: self.parent,
        });
    }

    fn control(&mut self, style: &Rc<Style>, text: &str) {
        if !text.is_empty() {
            self.push(ItemKind::Control, 0, style, text);
        }
    }

    fn reopen_contexts(&mut self, style: &Rc<Style>) {
        if core::mem::take(&mut self.are_contexts_closed) {
            self.control(style, &self.contexts.concat());
        }
    }

    pub(crate) fn open(&mut self, node: NodeId, style: &Rc<Style>, has_edge: bool) {
        let opens = bidi_controls(style).0;
        if !opens.is_empty() {
            self.reopen_contexts(style);
            self.control(style, opens);
            self.contexts.push(opens);
        }
        self.push(ItemKind::Open(has_edge), node, style, "");
        self.parent = self.items.len() as u32;
        if style.display() == Display::Ruby {
            self.start_base(style);
        }
    }

    pub(crate) fn close(&mut self, node: NodeId, style: &Rc<Style>, has_edge: bool) {
        if style.display() == Display::Ruby {
            self.bases.pop();
        }
        self.push(ItemKind::Close(has_edge), node, style, "");
        self.parent = self.items[self.parent as usize - 1].parent;
        let closes = bidi_controls(style).1;
        if !closes.is_empty() {
            self.contexts.pop();
            self.control(style, if self.are_contexts_closed { "" } else { closes });
        }
    }

    fn start_base(&mut self, style: &Rc<Style>) {
        self.bases.push(self.items.len() as u32);
        self.push(ItemKind::RubyBase, 0, style, "");
    }

    pub(crate) fn annotate(&mut self, annotation: BoxId, node: NodeId, style: &Rc<Style>) {
        let is_in_ruby = self
            .bases
            .last()
            .is_some_and(|it| self.items[*it as usize].parent == self.parent);
        let ruby = Rc::clone(
            self.parent
                .checked_sub(1)
                .map_or(&self.root, |it| &self.items[it as usize].style),
        );
        if !is_in_ruby {
            self.start_base(&ruby);
        }
        let base = self.bases.pop().unwrap_or(0);
        if self.trailing_space.is_some_and(|it| it > base as usize) {
            self.remove_trailing_space();
        }
        if self.items[base as usize].start as usize == self.text.len() {
            self.push(ItemKind::Text, 0, &ruby, "\u{200b}");
            self.items
                .last_mut()
                .into_iter()
                .for_each(|it| it.has_own_style = true);
        }
        self.push(ItemKind::Annotation(annotation, base), node, style, "");
        (self.after_space, self.trailing_space) = (false, None);
        if is_in_ruby {
            self.start_base(&ruby);
        }
    }

    /// The part of a text that `::first-letter` applies to.
    pub(crate) fn first_letter(&mut self, node: NodeId, data: &[u8], style: &Rc<Style>) {
        let first = self.items.len();
        self.open(0, style, true);
        self.text_from(node, data, 0, style);
        self.close(0, style, true);
        self.items[first..]
            .iter_mut()
            .for_each(|it| it.has_own_style = true);
        self.has_split_text = true;
    }

    pub(crate) fn pin_styles(&mut self) {
        self.items.iter_mut().for_each(|it| it.has_own_style = true);
    }

    pub(crate) fn embed(&mut self, embedded: BoxId, node: NodeId, style: &Rc<Style>) {
        if style.is_out_of_flow() {
            self.push(ItemKind::OutOfFlow(embedded), node, style, "");
        } else if style.is_floating() {
            self.push(ItemKind::Float(embedded), node, style, "");
        } else {
            self.reopen_contexts(style);
            self.push(ItemKind::Atomic(embedded), node, style, "\u{fffc}");
            (self.after_space, self.trailing_space, self.in_word) = (false, None, false);
        }
    }

    pub(crate) fn line_break(&mut self, node: NodeId, style: &Rc<Style>) {
        self.remove_trailing_space();
        self.push(ItemKind::Break, node, style, "\n");
        (self.after_space, self.in_word, self.are_contexts_closed) =
            (true, false, !self.contexts.is_empty());
    }

    fn remove_trailing_space(&mut self) {
        let Some(index) = self.trailing_space.take() else {
            return;
        };
        let item = &mut self.items[index];
        item.end -= 1;
        self.text.remove(item.end as usize);
        for later in &mut self.items[index + 1..] {
            later.start -= 1;
            later.end -= 1;
        }
        let mut shifted = self.segments.iter_mut().rev();
        let space = self.items[index].end;
        for segment in shifted.by_ref() {
            if segment.start <= space && segment.end > space {
                let (node_end, is_single) = (segment.node_end, segment.end - segment.start == 1);
                segment.end -= 1;
                if !is_single {
                    segment.node_end = node_end - 1;
                }
                break;
            }
            segment.start -= 1;
            segment.end -= 1;
        }
    }

    fn map(&mut self, first: usize, node_start: usize, node_len: usize, start: usize) {
        let new = Segment {
            node_start: node_start as u32,
            node_end: (node_start + node_len) as u32,
            start: start as u32,
            end: self.text.len() as u32,
        };
        let is_plain = |it: &Segment| it.node_end - it.node_start == it.end - it.start;
        match self.segments[first..].last_mut() {
            Some(last)
                if last.node_end == new.node_start
                    && (is_plain(last) && is_plain(&new) || last.start == new.end) =>
            {
                (last.node_end, last.end) = (new.node_end, new.end);
            }
            _ => self.segments.push(new),
        }
    }

    pub(crate) fn text(&mut self, node: NodeId, data: &[u8], style: &Rc<Style>) {
        self.text_from(node, data, 0, style);
    }

    /// `data` starts at `base` in the node.
    pub(crate) fn text_from(&mut self, node: NodeId, data: &[u8], base: usize, style: &Rc<Style>) {
        if !self.contexts.is_empty()
            && style.text.collapse != WhiteSpaceCollapse::Collapse
            && let Some(end) = bun_core::strings::index_of_char_usize(data, b'\n').map(|it| it + 1)
        {
            let (mut rest, mut end) = (data, Some(end));
            while let Some(len) = end {
                self.text_run(node, &rest[..len], base + data.len() - rest.len(), style);
                (rest, self.are_contexts_closed, self.has_split_text) = (&rest[len..], true, true);
                end = Some(
                    bun_core::strings::index_of_char_usize(rest, b'\n')
                        .map_or(rest.len(), |it| it + 1),
                )
                .filter(|it| *it > 0);
            }
            self.are_contexts_closed = data.ends_with(b"\n");
            return;
        }
        self.text_run(node, data, base, style);
    }

    fn text_run(&mut self, node: NodeId, data: &[u8], base: usize, style: &Rc<Style>) {
        let (collapse, transform) = (style.text.collapse, style.text.transform);
        let mask = match style.text.security {
            TextSecurity::None => None,
            TextSecurity::Disc => Some('•'),
            TextSecurity::Circle => Some('◦'),
            TextSecurity::Square => Some('▪'),
        };
        if self.are_contexts_closed && !crate::boxes::is_collapsible_space(data, style) {
            self.reopen_contexts(style);
        }
        self.push(ItemKind::Text, node, style, "");
        let (index, first) = (self.items.len() - 1, self.segments.len());
        let data = crate::values::text(data);
        self.text.reserve(data.len());
        if collapse.preserves_spaces()
            && transform == TextTransform::None
            && mask.is_none()
            && !data.is_empty()
        {
            let start = self.text.len();
            self.text.push_str(data);
            self.map(first, base, data.len(), start);
            (self.after_space, self.trailing_space) = (data.ends_with('\n'), None);
        } else {
            let (is_verbatim, mut rest) = (transform == TextTransform::None && mask.is_none(), 0);
            while let Some(character) = data[rest..].chars().next() {
                let offset = rest;
                rest += character.len_utf8();
                if is_verbatim && character > ' ' && character != '\u{200b}' {
                    let words = data
                        [offset..offset + without_collapsing(&data.as_bytes()[offset..])]
                        .trim_end_matches(' ');
                    let start = self.text.len();
                    self.text.push_str(words);
                    self.map(first, base + offset, words.len(), start);
                    let decisive = words
                        .chars()
                        .rfind(|it| continues_word(*it, false) || !continues_word(*it, true));
                    self.in_word = decisive.map_or(self.in_word, char::is_alphanumeric);
                    (self.after_space, self.trailing_space, rest) =
                        (false, None, offset + words.len());
                    self.ends_with_break = self.ends_with_break
                        && !bun_core::strings::contains_char(words.as_bytes(), b' ');
                    continue;
                }
                let keeps_break = character == '\n' && collapse != WhiteSpaceCollapse::Collapse;
                if keeps_break || character == '\u{200b}' && self.ends_with_break {
                    self.items[index].end = self.text.len() as u32;
                    self.remove_trailing_space();
                }
                let start = self.text.len();
                if keeps_break {
                    self.text.push('\n');
                    (self.after_space, self.in_word) = (true, false);
                } else if !collapse.preserves_spaces()
                    && matches!(character, ' ' | '\t' | '\n' | '\r')
                {
                    if !self.after_space {
                        self.text.push(' ');
                        (self.after_space, self.trailing_space, self.ends_with_break) =
                            (true, Some(index), false);
                    }
                    self.ends_with_break |= character == '\n';
                    if character == '\n'
                        && self.trailing_space.is_some()
                        && self.text.ends_with("\u{200b} ")
                    {
                        self.map(first, base + offset, 1, start);
                        self.items[index].end = self.text.len() as u32;
                        self.remove_trailing_space();
                        continue;
                    }
                    self.in_word = false;
                } else {
                    match mask {
                        Some(mask) => self.text.push(mask),
                        None if transform == TextTransform::None => self.text.push(character),
                        None => transform_into(
                            &mut self.text,
                            data,
                            offset,
                            character,
                            self.state.in_word,
                            style,
                        ),
                    }
                    self.in_word = continues_word(character, self.in_word);
                    (self.after_space, self.trailing_space) = (false, None);
                }
                self.map(first, base + offset, character.len_utf8(), start);
            }
        }
        let item = &mut self.items[index];
        item.end = self.text.len() as u32;
        item.segments = first as u32..self.segments.len() as u32;
    }

    /// `first_line` is the style of `::first-line`, if it applies.
    pub(crate) fn finish(
        &mut self,
        document: &mut Document,
        first_line: Option<Rc<Style>>,
    ) -> Box<Inline> {
        self.remove_trailing_space();
        if self.has_split_text {
            let texts = self
                .items
                .iter_mut()
                .filter(|it| it.kind == ItemKind::Text)
                .collect::<Vec<_>>();
            for parts in { texts }.chunk_by_mut(|a, b| a.node == b.node) {
                let all = parts[0].segments.start..parts[parts.len() - 1].segments.end;
                parts.iter_mut().for_each(|it| it.segments = all.clone());
            }
        }
        let first_line = first_line.map(|root| {
            let mut items = self.items.clone();
            for index in 0..items.len() {
                let parent = Rc::clone(
                    items[index]
                        .parent
                        .checked_sub(1)
                        .map_or(&root, |it| &items[it as usize].style),
                );
                let item = &mut items[index];
                item.style = match item.kind {
                    _ if item.has_own_style => continue,
                    ItemKind::Open(_) | ItemKind::Break => document.style_under(item.node, &parent),
                    ItemKind::Text | ItemKind::Close(_) | ItemKind::Control => parent,
                    _ => continue,
                };
                item.has_own_style = true;
            }
            (items, root)
        });
        let mut inline = shape_items(
            document,
            &self.text,
            core::mem::take(&mut self.items),
            &self.root,
        );
        (inline.segments, inline.force_line) =
            (core::mem::take(&mut self.segments), self.force_line);
        inline.first_line = first_line.map(|(items, root)| {
            let (mut text, mut moved, mut in_word) = (String::new(), items.clone(), false);
            for (item, normal) in moved.iter_mut().zip(&inline.items) {
                let data = &inline.text[normal.start as usize..normal.end as usize];
                item.start = text.len() as u32;
                for (offset, character) in data.char_indices() {
                    match item.style.text.transform == normal.style.text.transform {
                        true => text.push(character),
                        false => {
                            transform_into(&mut text, data, offset, character, in_word, &item.style)
                        }
                    }
                    in_word = continues_word(character, in_word);
                }
                item.end = text.len() as u32;
            }
            let mut restyled = shape_items(document, &text, moved, &root);
            if restyled
                .items
                .iter()
                .zip(&inline.items)
                .any(|(a, b)| a.clusters != b.clusters)
            {
                restyled = shape_items(document, &inline.text, items, &root);
            }
            (restyled.segments, restyled.force_line) = (inline.segments.clone(), inline.force_line);
            Box::new((
                *restyled,
                document.turned_style(&root, root.text.writing_mode),
            ))
        });
        inline.label = inline.find_label();
        inline
    }
}

fn continues_word(character: char, in_word: bool) -> bool {
    character.is_alphanumeric()
        || in_word
            && matches!(
                character,
                '\'' | '’' | '\u{ad}' | '·' | '_' | '\u{300}'..='\u{36f}'
            )
}

fn transform_into(
    out: &mut String,
    data: &str,
    offset: usize,
    character: char,
    in_word: bool,
    style: &Style,
) {
    let speaks = |language| speaks(style, language);
    let (before, after) = (&data[..offset], &data[offset + character.len_utf8()..]);
    match (style.text.transform, character) {
        (TextTransform::MathAuto, _) if before.is_empty() && after.is_empty() => {
            out.push(math_italic(character))
        }
        (TextTransform::Capitalize, 'j')
            if out.ends_with('I') && before.ends_with(['i', 'I']) && speaks("nl") =>
        {
            out.push('J')
        }
        (TextTransform::None | TextTransform::MathAuto, _) => out.push(character),
        (TextTransform::Capitalize, _) if in_word => out.push(character),
        (TextTransform::Capitalize, _) => {
            out.extend(title_case(character).map_or_else(|| character.to_uppercase().next(), Some))
        }
        (TextTransform::Uppercase, 'i') if speaks("tr") || speaks("az") => out.push('İ'),
        (TextTransform::Uppercase, '\u{307}')
            if speaks("lt") && before.ends_with(['i', 'j', 'į']) => {}
        (TextTransform::Uppercase, _) if !character.is_ascii() && speaks("el") => {
            let plain = without_greek_accent(character);
            let breaks_diphthong = before.ends_with(['ά', 'έ', 'ό', 'ύ', 'Ά', 'Έ', 'Ό', 'Ύ']);
            out.extend(plain.into_iter().flat_map(|it| match it {
                'ι' if breaks_diphthong && character == it => 'ϊ'.to_uppercase(),
                'υ' if breaks_diphthong && character == it => 'ϋ'.to_uppercase(),
                'η' if character != it && !in_word && !after.starts_with(char::is_alphabetic) => {
                    'ή'.to_uppercase()
                }
                it => it.to_uppercase(),
            }));
        }
        (TextTransform::Uppercase, _) => out.extend(character.to_uppercase()),
        (_, 'I') if speaks("tr") || speaks("az") => out.push(if after.starts_with('\u{307}') {
            'i'
        } else {
            'ı'
        }),
        (_, 'İ') if speaks("tr") || speaks("az") => out.push('i'),
        (_, '\u{307}') if before.ends_with('I') && (speaks("tr") || speaks("az")) => {}
        (_, 'Ì') if speaks("lt") => out.push_str("i\u{307}\u{300}"),
        (_, 'Í') if speaks("lt") => out.push_str("i\u{307}\u{301}"),
        (_, 'Ĩ') if speaks("lt") => out.push_str("i\u{307}\u{303}"),
        (_, 'Σ') if in_word && !after.starts_with(char::is_alphabetic) => out.push('ς'),
        _ => out.extend(character.to_lowercase()),
    }
}

fn stands_upright(style: &Style, character: char) -> bool {
    style.text.orientation == TextOrientation::Upright || is_upright(character)
}

/// <https://drafts.csswg.org/css-text/#boundary-shaping>
fn interrupts_shaping(item: &Item) -> bool {
    let (ItemKind::Open(has_edge) | ItemKind::Close(has_edge), style) = (item.kind, &item.style)
    else {
        return false;
    };
    let is_left = matches!(item.kind, ItemKind::Open(_)) != style.is_rtl();
    let takes_room = |basis: f32| edge(style, is_left, basis) != (0.0, 0.0);
    !matches!(
        style.layout.vertical_align,
        VerticalAlign::Keyword(VerticalAlignName::Baseline)
    ) || has_edge && (takes_room(100.0) || takes_room(0.0))
}

/// How long the words are that single spaces separate.
fn without_collapsing(text: &[u8]) -> usize {
    let (stays, mut done) = (
        |[it, next]: &[u8; 2]| (*next > b' ') | (*next == b' ') & (*it > b' '),
        0,
    );
    while text[done..]
        .first_chunk::<33>()
        .is_some_and(|it| it.array_windows().fold(true, |all, it| all & stays(it)))
    {
        done += 32;
    }
    done + text[done..]
        .array_windows()
        .take_while(|it| stays(it))
        .count()
        + 1
}

fn shape_items(
    document: &Document,
    text: &str,
    mut items: SmallVec<[Item; 1]>,
    root: &Style,
) -> Box<Inline> {
    let direction = match (root.layout.unicode_bidi, root.is_rtl()) {
        (UnicodeBidi::Plaintext, _) => abi::DIRECTION_AUTO,
        (_, true) => abi::DIRECTION_RTL,
        (_, false) => abi::DIRECTION_LTR,
    };
    let mut clusters = Clusters {
        paragraphs: SmallVec::new(),
        joined: Default::default(),
        count: 0,
        are_letters: !text.is_empty(),
    };
    let (mut start, mut first_item, mut runs) = (0, 0, SmallVec::<[TextRun; 4]>::new());
    while start < text.len() {
        let rest = &text.as_bytes()[start..];
        let end = start
            + bun_core::strings::index_of_char_usize(rest, b'\n').map_or(rest.len(), |it| it + 1);
        runs.clear();
        let mut is_apart = false;
        while items[first_item].end as usize <= start {
            first_item += 1;
        }
        for item in items[first_item..]
            .iter()
            .take_while(|item| (item.start as usize) < end)
        {
            if item.start == item.end {
                is_apart |= interrupts_shaping(item);
                continue;
            }
            if let (ItemKind::Atomic(_), Some(last)) = (item.kind, runs.last_mut()) {
                last.end = item.end - start as u32;
                continue;
            }
            let run = text_run(&item.style, (item.end as usize).min(end) - start);
            let mut add = |run: TextRun| match runs.last_mut() {
                Some(last)
                    if !core::mem::take(&mut is_apart)
                        && TextRun {
                            end: run.end,
                            ..*last
                        } == run =>
                {
                    last.end = run.end
                }
                _ => runs.push(run),
            };
            if item.kind != ItemKind::Text
                || !item.style.has_central_baseline()
                || item.style.text.combine == TextCombine::All
            {
                add(run);
                continue;
            }
            let (first, mut flag) = ((item.start as usize).max(start) - start, 0);
            for (offset, character) in text[start + first..start + run.end as usize].char_indices()
            {
                if offset == 0 || !extends_cluster(character) {
                    flag = if stands_upright(&item.style, character) {
                        abi::RUN_UPRIGHT
                    } else {
                        0
                    };
                }
                add(TextRun {
                    end: (first + offset + character.len_utf8()) as u32,
                    word_break: run.word_break | flag,
                    ..run
                });
            }
        }
        let shaped = document.shape(&text[start..end], &runs, direction);
        let first_cluster = clusters.count;
        (clusters.count, clusters.are_letters) = (
            first_cluster + shaped.count() as u32,
            clusters.are_letters && !shaped.letters.is_empty(),
        );
        clusters.paragraphs.push(Paragraph {
            first_cluster,
            shaped,
        });
        start = end;
    }
    let kept = match &clusters.paragraphs[..] {
        [only] => Text::Shared(Rc::clone(&only.shaped)),
        _ => Text::Own(text.into()),
    };
    let mut next = 0;
    for item in &mut items {
        let first = next;
        next = match clusters.len() == text.len() {
            true => item.end as usize,
            false if clusters.are_letters => {
                first + text[item.start as usize..item.end as usize].chars().count()
            }
            false => {
                first
                    + clusters[first..]
                        .iter()
                        .take_while(|it| it.start < item.end)
                        .count()
            }
        };
        item.clusters = first as u32..next as u32;
    }
    let (mode, is_ascii) = (root.text.writing_mode.of_lines(), text.is_ascii());
    let mut inline = Box::new(Inline {
        has_bidi: (direction == abi::DIRECTION_RTL || !is_ascii)
            && !clusters.are_letters
            && clusters.iter().any(|cluster| cluster.bidi_level > 0),
        has_layers: items
            .iter()
            .any(|it| matches!(it.kind, ItemKind::Open(_)) && is_layer(&it.style)),
        has_ruby: items
            .iter()
            .any(|it| matches!(it.kind, ItemKind::Annotation(..))),
        text: kept,
        items,
        segments: SmallVec::new(),
        clusters,
        force_line: false,
        label: None,
        first_line: None,
        lines: Lines::default(),
        outset: Default::default(),
        prose: Default::default(),
    });
    let minds_ideographs = || {
        text.chars().any(|it| matches!(it, '‘' | '’' | '“' | '”'))
            || inline
                .items
                .iter()
                .any(|it| it.style.text.autospace == TextAutospace::Normal)
    };
    let (has_ruby, is_ascii) = (
        inline.has_ruby && !is_ascii,
        is_ascii || text.chars().all(|it| it.is_ascii() || it == '\u{fffc}'),
    );
    let adjusts = !is_ascii
        && (text.chars().any(|it| {
            matches!(
                it,
                '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{205f}' | '\u{3000}'
            )
        }) || text.chars().any(|it| it >= '\u{2e80}' && is_ideograph(it))
            && minds_ideographs());
    for index in 0..inline.items.len() {
        if mode.is_vertical() {
            inline.items[index].style = document.turned_style(&inline.items[index].style, mode);
        }
        let item = &inline.items[index];
        if adjusts
            || has_ruby
            || mode.is_vertical()
            || item.style.text.line_break == LineBreak::Anywhere
            || matches!(item.kind, ItemKind::Atomic(_))
        {
            inline.adjust_clusters(index);
        }
    }
    let may_trim = |(it, next): (char, char)| match spacing_class(it) {
        None => {
            matches!(it, '‘' | '’' | '“' | '”') || spacing_class(next) != Some(Punctuation::Other)
        }
        Some(class) => matches!(class, Punctuation::Opening | Punctuation::Closing),
    };
    if !is_ascii
        && text.bytes().any(|it| it >= 0xe3)
        && text
            .chars()
            .zip(text.chars().skip(1).chain([' ']))
            .any(may_trim)
    {
        inline.trim_punctuation();
    }
    let kind = |it: &Cluster| (it.face, it.bidi_level, it.flags & (UPRIGHT | COMBINED));
    let are_uniform = !inline.has_bidi
        && !mode.is_vertical()
        && inline
            .clusters
            .paragraphs
            .iter()
            .all(|it| it.shaped.faces.len() == 1);
    let Inline {
        items, clusters, ..
    } = &mut *inline;
    let letters = (!are_uniform && clusters.are_letters)
        .then(|| clusters.as_letters())
        .flatten();
    for item in items {
        let range = item.clusters.start as usize..item.clusters.end as usize;
        item.is_uniform = are_uniform
            || match &letters {
                Some(letters) => letters[range]
                    .array_windows()
                    .fold(true, |all, [a, b]| all & (a.face == b.face)),
                None => clusters[range]
                    .array_windows()
                    .fold(true, |all, [a, b]| all & (kind(a) == kind(b))),
            };
    }
    inline
}

thread_local! {
    static SPACING: RefCell<Map<(u32, u32, bool), (Punctuation, bool)>> = RefCell::default();
}

impl Inline {
    fn first_glyph(&self, cluster: u32) -> Option<(abi::Face, abi::Glyph)> {
        let (it, shaped) = (
            &self.clusters[cluster as usize],
            &self.paragraph_of(cluster).shaped,
        );
        Some((
            shaped.faces[usize::from(it.face)],
            *shaped.glyphs()[it.glyphs.range()].first()?,
        ))
    }

    /// And whether it has a half that can be trimmed.
    pub(crate) fn spacing_of(&self, cluster: u32, style: &Style) -> (Punctuation, bool) {
        let (character, it) = (self.character(cluster), &self.clusters[cluster as usize]);
        let class = spacing_class(character);
        if let Some(class) =
            class.filter(|it| !matches!(it, Punctuation::Opening | Punctuation::Closing))
        {
            return (class, false);
        }
        let (Some((face, glyph)), stands) = (self.first_glyph(cluster), it.flags & UPRIGHT != 0)
        else {
            return (Punctuation::Other, false);
        };
        if it.advance - style.letter_spacing() < face.size * 0.9 {
            let narrow = match character {
                '‘' | '“' => Punctuation::NarrowOpening,
                '’' | '”' => Punctuation::NarrowClosing,
                _ => Punctuation::Other,
            };
            return (class.unwrap_or(narrow), false);
        }
        let (measured, can_trim) = SPACING.with_borrow_mut(|known| {
            *known.entry((face.id, glyph.id, stands)).or_insert_with(|| {
                let (ink, half) = (glyph_extent(&face, glyph.id).ink, face.size / 2.0);
                let [start, end] = if stands {
                    ink.span(1).map(|it| it + glyph.y)
                } else {
                    ink.span(0)
                };
                let class = match () {
                    () if end <= half => Punctuation::Closing,
                    () if start >= half => Punctuation::Opening,
                    () if end - start <= half && start >= half / 2.0 => Punctuation::Middle,
                    () => Punctuation::Other,
                };
                (
                    class,
                    has_positioning_feature(&face, if stands { *b"vhal" } else { *b"halt" }),
                )
            })
        });
        let turns_off = |it: &abi::FontSetting| {
            matches!(
                &it.tag,
                b"halt" | b"palt" | b"vhal" | b"vpal" | b"pwid" | b"hwid"
            ) && it.value != 0.0
        };
        (
            class.unwrap_or(measured),
            can_trim && !platform::features(style).iter().any(turns_off),
        )
    }

    /// What `text-spacing-trim` takes off its start.
    pub(crate) fn trimmed_start(&self, cluster: u32, style: &Style, starts_line: bool) -> f32 {
        let it = &self.clusters[cluster as usize];
        let trims = match style.text.spacing_trim {
            _ if !starts_line => it.flags & TRIMS != 0,
            TextSpacingTrim::SpaceFirst => cluster > 0 && !self.is_newline(cluster - 1),
            trim => trim == TextSpacingTrim::TrimStart,
        };
        if trims {
            (it.advance - style.letter_spacing()) / 2.0
        } else {
            0.0
        }
    }

    pub(crate) fn autospace_after(&self, cluster: u32) -> f32 {
        let it = &self.clusters[cluster as usize];
        if it.flags & (AUTOSPACED | abi::CLUSTER_SPACE) != AUTOSPACED {
            return 0.0;
        }
        let paragraph = self.paragraph_of(cluster);
        it.advance
            - paragraph.shaped.clusters()[(cluster - paragraph.first_cluster) as usize].advance
    }

    /// The cluster that is shown to the left of where `at` meets the text before it.
    fn left_of_boundary(&self, at: u32) -> usize {
        let at = at as usize;
        let [before, own] = [at - 1, at].map(|it| self.clusters[it].bidi_level);
        match (before & 1, own & 1) {
            (1, 0) if own < before => {
                at - self.clusters[..at]
                    .iter()
                    .rev()
                    .take_while(|it| it.bidi_level >= before)
                    .count()
            }
            (1, 0) => {
                at - 1
                    + self.clusters[at..]
                        .iter()
                        .take_while(|it| it.bidi_level >= own)
                        .count()
            }
            (_, 1) if own <= before => at,
            _ => at - 1,
        }
    }

    fn trim_punctuation(&mut self) {
        let mut before = (Punctuation::Other, false);
        for item in &self.items {
            for at in item.clusters.clone() {
                let own = self.spacing_of(at, &item.style);
                let own = (
                    own.0,
                    own.1 && item.style.text.spacing_trim != TextSpacingTrim::SpaceAll,
                );
                if before == (Punctuation::Closing, true)
                    && matches!(
                        own.0,
                        Punctuation::Closing | Punctuation::Middle | Punctuation::NarrowClosing
                    )
                {
                    let it = &mut self.clusters[at as usize - 1];
                    (it.advance, it.flags) = (
                        (it.advance + item.style.letter_spacing()) / 2.0,
                        it.flags & !TRIMS,
                    );
                }
                let flags = match (own, before.0) {
                    (
                        (Punctuation::Opening, true),
                        Punctuation::Other | Punctuation::NarrowClosing,
                    ) => OPENING,
                    ((Punctuation::Opening, true), _) => OPENING | TRIMS,
                    ((Punctuation::Closing, true), _)
                        if !matches!(
                            self.character(at),
                            '、' | '。' | '，' | '．' | '：' | '；'
                        ) =>
                    {
                        TRIMS
                    }
                    _ => 0,
                };
                if flags != 0 {
                    self.clusters[at as usize].flags |= flags;
                }
                before = own;
            }
            if let ItemKind::RubyBase | ItemKind::Annotation(..) = item.kind {
                before = (Punctuation::Other, false);
            }
        }
    }

    fn adjust_clusters(&mut self, index: usize) {
        let (item, count) = (&self.items[index], self.clusters.len() as u32);
        let (clusters, text, is_vertical) = (
            item.clusters.clone(),
            &item.style.text,
            item.style.has_central_baseline(),
        );
        match item.kind {
            ItemKind::Atomic(_) => {
                let [before, after] = match self.clusters.are_letters {
                    true => [
                        self.text[..item.start as usize].chars().next_back(),
                        self.text[item.end as usize..].chars().next(),
                    ],
                    false => [
                        clusters.start.checked_sub(1),
                        Some(clusters.end).filter(|it| *it < count),
                    ]
                    .map(|it| it.map(|it| self.character(it))),
                };
                for (at, other) in [
                    (clusters.start, before),
                    (
                        clusters.end,
                        after.filter(|it| !matches!(it, ' ' | '\t' | '\n')),
                    ),
                ] {
                    let is_right = |other| matches!(self.clusters.letters(&(at..at + 1)), Some([it]) if other == '\n' || (it.flags & abi::CLUSTER_BREAK_BEFORE == 0) == glues(other));
                    if let Some(other) = other.filter(|it| !is_right(*it)) {
                        let flags = &mut self.clusters[at as usize].flags;
                        *flags = if glues(other) {
                            *flags & !abi::CLUSTER_BREAK_BEFORE
                        } else {
                            *flags | abi::CLUSTER_BREAK_BEFORE
                        };
                    }
                }
            }
            ItemKind::Annotation(_, base) => {
                let base = self.items[base as usize].clusters.start + 1..clusters.start;
                base.for_each(|at| self.clusters[at as usize].flags &= !abi::CLUSTER_BREAK_BEFORE);
            }
            ItemKind::Text
                if text.combine == TextCombine::All
                    && matches!(
                        text.writing_mode,
                        WritingMode::VerticalRl | WritingMode::VerticalLr
                    ) =>
            {
                let continues = clusters.start > 0
                    && self.items[..index]
                        .last()
                        .is_some_and(|it| it.kind == ItemKind::Text && it.parent == item.parent);
                for at in clusters.clone() {
                    let (cluster, is_first) = (
                        &mut self.clusters[at as usize],
                        at == clusters.start && !continues,
                    );
                    cluster.advance = if is_first {
                        item.style.font.size.0 + item.style.letter_spacing()
                    } else {
                        0.0
                    };
                    cluster.flags = COMBINED
                        | if is_first {
                            abi::CLUSTER_BREAK_BEFORE
                        } else {
                            0
                        };
                }
            }
            ItemKind::Text => {
                for at in clusters {
                    let character = self.character(at);
                    let after_combined =
                        at > 0 && self.clusters[at as usize - 1].flags & COMBINED != 0;
                    if text.autospace == TextAutospace::Normal
                        && at > 0
                        && (is_ideograph(character) || is_ideograph(self.character(at - 1)))
                    {
                        let is_chinese = speaks(&item.style, "zh");
                        let is_letter = |it: char| {
                            !is_wide(it) && !is_ideograph(it) && it.is_alphanumeric()
                                || is_chinese
                                    && matches!(
                                        it,
                                        '!' | '#'
                                            | '%'
                                            | '&'
                                            | ','
                                            | '.'
                                            | ':'
                                            | ';'
                                            | '?'
                                            | '@'
                                            | '\\'
                                            | '¡'
                                            | '§'
                                            | '¶'
                                            | '¿'
                                    )
                        };
                        let (before, stood) = (
                            self.character(at - 1),
                            self.clusters[at as usize - 1].flags & (UPRIGHT | COMBINED) != 0,
                        );
                        let stands = is_vertical && stands_upright(&item.style, character);
                        if is_ideograph(before) && is_letter(character) && !stands
                            || is_letter(before) && !stood && is_ideograph(character)
                        {
                            let left = self.left_of_boundary(at);
                            let left = &mut self.clusters[left];
                            left.advance += item.style.metrics.ideograph_advance / 8.0;
                            left.flags |= AUTOSPACED;
                        }
                    }
                    if matches!(character, '“' | '”' | '‘' | '’')
                        && at > 0
                        && is_ideograph(self.character(at - 1))
                    {
                        let is_bracket =
                            matches!(character, '“' | '”') && speaks(&item.style, "zh");
                        let before_wide = at + 1 < count && is_ideograph(self.character(at + 1));
                        match character {
                            '“' | '‘' if is_bracket || before_wide => {
                                self.clusters[at as usize].flags |= abi::CLUSTER_BREAK_BEFORE
                            }
                            '”' | '’' if before_wide => {
                                self.clusters[at as usize + 1].flags |= abi::CLUSTER_BREAK_BEFORE
                            }
                            _ => {}
                        }
                    }
                    let cluster = &mut self.clusters[at as usize];
                    match character {
                        ' ' | '\t' => {}
                        '\u{3000}' if text.word_break == WordBreak::BreakAll => {
                            cluster.flags =
                                cluster.flags & !abi::CLUSTER_BREAK_BEFORE | IDEOGRAPHIC_SPACE
                        }
                        '\u{3000}' => cluster.flags |= IDEOGRAPHIC_SPACE,
                        _ => cluster.flags &= !abi::CLUSTER_SPACE,
                    }
                    if text.line_break == LineBreak::Anywhere
                        || after_combined && character.is_alphanumeric()
                    {
                        cluster.flags |= abi::CLUSTER_BREAK_BEFORE;
                    }
                    if is_vertical
                        && cluster.glyphs.start < cluster.glyphs.end
                        && stands_upright(&item.style, character)
                    {
                        cluster.flags |= UPRIGHT;
                    }
                }
            }
            _ => {}
        }
    }
}

/// Whether an inline element is painted apart from its lines.
pub(crate) fn is_layer(style: &Style) -> bool {
    style.is_positioned() || style.is_stacking_context(false)
}

pub(crate) fn speaks(style: &Style, language: &str) -> bool {
    let locale = style.font.locale.0.trim_start_matches('"').as_bytes();
    locale
        .get(..2)
        .is_some_and(|it| crate::values::eq(it, language))
        && !locale.get(2).is_some_and(u8::is_ascii_alphabetic)
}

pub(crate) fn text_run(style: &Style, end: usize) -> TextRun {
    let cj = if style.text.line_break != LineBreak::Auto
        && (speaks(style, "ja") || speaks(style, "zh"))
    {
        abi::BREAK_CJ
    } else {
        0
    };
    TextRun {
        end: end as u32,
        font: style.font_id,
        size: style.font.size.0,
        letter_spacing: style.letter_spacing(),
        word_spacing: style.word_spacing(),
        word_break: match style.text.word_break {
            WordBreak::BreakAll => abi::BREAK_ALL,
            WordBreak::KeepAll => abi::BREAK_KEEP_ALL,
            _ => abi::BREAK_NORMAL,
        } | match style.text.line_break {
            LineBreak::Normal => cj,
            LineBreak::Loose => cj | abi::BREAK_LOOSE,
            LineBreak::Strict => cj | abi::BREAK_STRICT,
            _ => 0,
        },
    }
}

impl Document {
    pub(crate) fn shape(&self, text: &str, runs: &[TextRun], direction: u8) -> Rc<Shaped> {
        let mut hasher = keyed_hasher();
        for run in runs {
            let [size, letters, words] =
                [run.size, run.letter_spacing, run.word_spacing].map(|it| u64::from(it.to_bits()));
            hasher.write_u64((u64::from(run.end) << 32) | u64::from(run.font));
            hasher.write_u64((size << 32) | letters);
            hasher
                .write_u64((words << 32) | (u64::from(run.word_break) << 8) | u64::from(direction));
        }
        hasher.write(text.as_bytes());
        let mut cache = self.shaped.borrow_mut();
        if self.newly_shaped_bytes.get() > 1 << 15 {
            self.newly_shaped_bytes.set(0);
            cache.retain(|_, it| it.text.len() < 256 || Rc::strong_count(it) > 1);
        }
        Rc::clone(cache.entry(hasher.finish()).or_insert_with(|| {
            self.newly_shaped_bytes
                .update(|it| it + if text.len() < 256 { 0 } else { text.len() });
            self.fonts.note_written(text, runs);
            Rc::new(platform::shape(text, runs, direction))
        }))
    }

    /// And whether it is below the line.
    pub(crate) fn emphasis_mark(&self, style: &Style) -> Option<(Rc<Shaped>, bool)> {
        let source = style
            .other_if_set(crate::properties::Id::TextEmphasisStyle)
            .filter(|it| *it != "none")?;
        let (is_open, shape) = source
            .strip_prefix("open ")
            .map_or((false, source), |it| (true, it));
        let marks = match shape {
            "dot" => ['\u{2022}', '\u{25e6}'],
            "circle" => ['\u{25cf}', '\u{25cb}'],
            "double-circle" => ['\u{25c9}', '\u{25ce}'],
            "triangle" => ['\u{25b2}', '\u{25b3}'],
            "sesame" => ['\u{fe45}', '\u{fe46}'],
            _ => {
                [crate::values::parse_all(source.as_bytes(), |p| {
                    crate::values::text(crate::values::string(p)?)
                        .chars()
                        .next()
                })?; 2]
            }
        };
        let mark = marks[usize::from(is_open)].to_string();
        let run = TextRun {
            size: style.font.size.0 / 2.0,
            letter_spacing: 0.0,
            word_spacing: 0.0,
            ..text_run(style, mark.len())
        };
        let position = style.other(crate::properties::Id::TextEmphasisPosition);
        let is_under = match style.text.writing_mode {
            WritingMode::HorizontalTb => position.starts_with("under"),
            mode => position.ends_with("left") != (mode == WritingMode::SidewaysLr),
        };
        Some((self.shape(&mark, &[run], abi::DIRECTION_LTR), is_under))
    }

    pub(crate) fn shape_plain(&self, text: &str, style: &Style) -> Rc<Shaped> {
        self.shape(text, &[text_run(style, text.len())], abi::DIRECTION_LTR)
    }
}
