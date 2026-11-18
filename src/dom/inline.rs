//! Inline-level content: white space processing and shaping. `lines.rs` breaks it into lines.

use core::cell::RefCell;
use core::ops::Range;
use std::borrow::Cow;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::abi::{self, Cluster, Letter, TextRun};
use crate::boxes::BoxId;
use crate::characters::*;
use crate::document::Document;
use crate::lines::{Kept, Line, Lines, edge};
use crate::name::{Map, keyed_hash_of_words};
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
    /// It comes after a letter.
    is_in_word: bool,
    pub(crate) node: NodeId,
    /// The element that has nothing but the text, and no items of its own. 0 is none.
    pub(crate) element: NodeId,
    /// For text, of the parent.
    pub(crate) style: Rc<Style>,
    /// In `text`.
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// Of the text that its first character is shaped with.
    run_start: u32,
    pub(crate) clusters: Range<u32>,
    pub(crate) segments: Range<u32>,
    /// The `Open` item that it is in, plus one. 0 is the root.
    pub(crate) parent: u32,
}

impl Item {
    pub(crate) fn stands_for(&self, node: NodeId) -> bool {
        self.node == node || self.element == node && node != 0
    }
}

pub(crate) struct Paragraph {
    pub(crate) first_cluster: u32,
    /// In the whole text.
    start: u32,
    pub(crate) shaped: Rc<Shaped>,
}

/// Their starts are in the whole text, and their glyphs and faces in their paragraph.
pub(crate) struct Clusters {
    pub(crate) paragraphs: SmallVec<[Paragraph; 1]>,
    joined: core::cell::OnceCell<Vec<Cluster>>,
    count: u32,
    /// `joined` differs from what has been shaped.
    are_adjusted: bool,
    /// The letters of all paragraphs, if they differ from what has been shaped.
    adjusted_letters: Vec<Letter>,
    /// What `Document::shape` has got.
    direction: u8,
    /// Some may be gone.
    found: Found,
}

/// Among the characters.
#[derive(Clone, Copy, Default)]
struct Found {
    spaces: bool,
    ideographs: bool,
    quotes: bool,
    punctuation: bool,
    /// What has come of it.
    adjusts: bool,
    trims: bool,
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
        let mut joined = Vec::with_capacity(self.len());
        for Paragraph { shaped, start, .. } in &self.paragraphs {
            joined.extend(shaped.clusters().iter().map(|cluster| Cluster {
                start: cluster.start + start,
                ..*cluster
            }));
        }
        joined
            .iter_mut()
            .zip(&self.adjusted_letters)
            .for_each(|(it, letter)| (it.advance, it.flags) = (letter.advance, letter.flags));
        joined
    }

    /// `range` is in one paragraph.
    pub(crate) fn letters(&self, range: &Range<u32>) -> Option<&[Letter]> {
        if !self.adjusted_letters.is_empty() {
            return self
                .adjusted_letters
                .get(range.start as usize..range.end as usize);
        }
        let paragraph =
            (!self.are_adjusted && self.count > 0).then(|| self.paragraph_of(range.start))?;
        let letters = paragraph.shaped.letters();
        letters
            .get(
                (range.start - paragraph.first_cluster) as usize
                    ..(range.end - paragraph.first_cluster) as usize,
            )
            .filter(|_| !letters.is_empty())
    }

    /// `range` is in one paragraph. Their starts are of no use.
    pub(crate) fn part(&self, range: &Range<u32>) -> &[Cluster] {
        match self.joined.get() {
            Some(joined) => &joined[range.start as usize..range.end as usize],
            None if range.is_empty() => &[],
            None if !self.adjusted_letters.is_empty() => {
                &self[range.start as usize..range.end as usize]
            }
            None => {
                let paragraph = self.paragraph_of(range.start);
                &paragraph.shaped.clusters()[(range.start - paragraph.first_cluster) as usize
                    ..(range.end - paragraph.first_cluster) as usize]
            }
        }
    }

    /// The glyph may be missing.
    #[inline]
    pub(crate) fn letter(&self, at: u32) -> Letter {
        self.letters(&(at..at + 1))
            .map_or_else(|| abbreviated(&self.part(&(at..at + 1))[0]), |it| it[0])
    }

    /// The glyphs may be missing.
    pub(crate) fn as_letters(&self, range: Range<u32>) -> Option<Cow<'_, [Letter]>> {
        if let Some(letters) = self.letters(&range) {
            return Some(letters.into());
        }
        let mut joined = Vec::with_capacity(range.len());
        for (shaped, inside) in self.split(range.clone()) {
            (shaped.faces.len() <= 256).then_some(())?;
            match shaped.letters().get(inside.clone()) {
                _ if self.are_adjusted => {}
                Some(letters) => joined.extend_from_slice(letters),
                None => joined.extend(shaped.clusters()[inside].iter().map(abbreviated)),
            }
        }
        if self.are_adjusted {
            joined.extend(
                self[range.start as usize..range.end as usize]
                    .iter()
                    .map(abbreviated),
            );
        }
        Some(joined.into())
    }

    pub(crate) fn paragraphs_after(&self, cluster: u32) -> &[Paragraph] {
        &self.paragraphs[self
            .paragraphs
            .partition_point(|it| it.first_cluster <= cluster)..]
    }

    pub(crate) fn label(&self) -> Option<crate::lines::Label> {
        let [only] = &self.paragraphs[..] else {
            return None;
        };
        only.shaped.label.filter(|_| self.are_as_shaped())
    }

    pub(crate) fn as_shaped(&self) -> Option<&[Paragraph]> {
        self.are_as_shaped().then_some(&self.paragraphs)
    }

    fn are_as_shaped(&self) -> bool {
        !self.are_adjusted && self.adjusted_letters.is_empty()
    }

    /// The advance and the flags.
    fn adjust(&mut self, at: u32) -> (&mut f32, &mut u8) {
        if self.are_as_shaped()
            && self.joined.get().is_none()
            && self.paragraphs.iter().all(|it| it.shaped.has_letters())
        {
            self.adjusted_letters = self
                .as_letters(0..self.count)
                .map_or(Vec::new(), Cow::into_owned);
        }
        if self.adjusted_letters.is_empty() || self.joined.get().is_some() {
            let it = &mut self[at as usize];
            return (&mut it.advance, &mut it.flags);
        }
        let it = &mut self.adjusted_letters[at as usize];
        (&mut it.advance, &mut it.flags)
    }

    /// In the whole text.
    pub(crate) fn start_of(&self, cluster: u32) -> u32 {
        if let Some(joined) = self.joined.get() {
            return joined[cluster as usize].start;
        }
        let Paragraph {
            first_cluster,
            start,
            shaped,
        } = self.paragraph_of(cluster);
        start
            + if shaped.letter_count() == shaped.text.len() {
                cluster - first_cluster
            } else {
                shaped.clusters()[(cluster - first_cluster) as usize].start
            }
    }

    /// The paragraphs that have some of the clusters, each with the range in it.
    fn split(&self, range: Range<u32>) -> impl Iterator<Item = (&Shaped, Range<usize>)> {
        let first = self
            .paragraphs
            .partition_point(|it| it.first_cluster <= range.start)
            .saturating_sub(1);
        let some = self.paragraphs[first..]
            .iter()
            .take_while(move |it| it.first_cluster < range.end);
        some.map(move |it| {
            (
                &*it.shaped,
                range.start.saturating_sub(it.first_cluster) as usize
                    ..it.shaped
                        .count()
                        .min((range.end - it.first_cluster) as usize),
            )
        })
    }
}

fn abbreviated(it: &Cluster) -> Letter {
    Letter {
        advance: it.advance,
        glyph: abi::NO_GLYPH,
        flags: it.flags,
        face: it.face as u8,
    }
}

impl core::ops::Deref for Clusters {
    type Target = [Cluster];
    #[inline]
    fn deref(&self) -> &[Cluster] {
        match (self.joined.get(), &self.paragraphs[..]) {
            (Some(joined), _) => joined,
            (_, [only]) if self.adjusted_letters.is_empty() => only.shaped.clusters(),
            _ => self.joined.get_or_init(|| self.join()),
        }
    }
}

impl core::ops::DerefMut for Clusters {
    fn deref_mut(&mut self) -> &mut [Cluster] {
        self.joined.get_or_init(|| self.join());
        (self.are_adjusted, self.adjusted_letters) = (true, Vec::new());
        self.joined.get_mut().map_or(&mut [], |it| it)
    }
}

pub(crate) enum Text {
    Own(String),
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
    /// None of the items before it is one.
    first_layer: u32,
    pub(crate) has_ruby: bool,
    pub(crate) force_line: bool,
    pub(crate) has_split_text: bool,
    /// See `Document::plain_lines`.
    pub(crate) is_plain: core::cell::OnceCell<bool>,
    /// If that is all there is.
    pub(crate) label: Option<crate::lines::Label>,
    /// The same items and clusters in the style of `::first-line`, which comes with them.
    pub(crate) first_line: Option<Box<(Inline, Rc<Style>)>>,
    pub(crate) lines: Lines,
    /// How far one of so many items may paint outside of its fragments.
    pub(crate) outset: core::cell::Cell<(u32, f32)>,
    pub(crate) prose: core::cell::OnceCell<Option<Box<crate::lines::Prose>>>,
    firsts: core::cell::OnceCell<Box<Map<NodeId, u32>>>,
    /// Until there are new ones.
    pub(crate) former_lines: Option<Box<(Lines, Kept)>>,
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
        self.nodes_from(0)
    }

    pub(crate) fn nodes_from(&self, item: usize) -> impl Iterator<Item = NodeId> + '_ {
        (self.items[item..].iter())
            .filter(|item| {
                matches!(
                    item.kind,
                    ItemKind::Text | ItemKind::Open(_) | ItemKind::Break
                )
            })
            .flat_map(|item| [item.node, item.element])
            .filter(|node| *node != 0)
    }

    pub(crate) fn has_positioned_elements(&self) -> bool {
        self.items[self.first_layer as usize..]
            .iter()
            .any(|item| matches!(item.kind, ItemKind::Open(_)) && item.style.is_positioned())
    }

    pub(crate) fn paragraph_of(&self, cluster: u32) -> &Paragraph {
        self.clusters.paragraph_of(cluster)
    }

    pub(crate) fn is_newline(&self, cluster: u32) -> bool {
        let (paragraph, next) = (self.paragraph_of(cluster), cluster + 1);
        (next - paragraph.first_cluster) as usize == paragraph.shaped.count()
            && paragraph.shaped.text.ends_with('\n')
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
        match self.clusters.len() == self.text.len() {
            true => self
                .text
                .as_bytes()
                .get(cluster as usize)
                .map_or('\0', |it| char::from(*it)),
            false => self.text[self.clusters.start_of(cluster) as usize..]
                .chars()
                .next()
                .unwrap_or_default(),
        }
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
        let paragraphs = &self.clusters.paragraphs;
        let Some(it) = paragraphs[..paragraphs.partition_point(|it| it.start <= offset)].last()
        else {
            return 0;
        };
        let (inside, shaped) = (
            ((offset - it.start) as usize).min(it.shaped.text.len()),
            &it.shaped,
        );
        let is_short = shaped.letter_count() == shaped.text.len() || inside < 256;
        it.first_cluster
            + if is_short {
                shaped.count_in(0..inside)
            } else {
                shaped
                    .clusters()
                    .partition_point(|it| (it.start as usize) < inside)
            } as u32
    }

    /// From a UTF-8 offset in the item's node.
    pub(crate) fn cluster_in(&self, item: &Item, offset: u32) -> u32 {
        match self.text_offset(item, offset) {
            offset if offset == item.end => item.clusters.end,
            offset
                if offset == item.start
                    || (item.start..item.end).contains(&offset)
                        && item.clusters.len() as u32 == item.end - item.start =>
            {
                item.clusters.start + offset - item.start
            }
            offset => self.cluster_at(offset),
        }
    }

    fn first_of(&self, node: NodeId) -> Option<usize> {
        let is_first = |it: &(usize, &Item)| {
            matches!(
                it.1.kind,
                ItemKind::Text | ItemKind::Break | ItemKind::Atomic(_) | ItemKind::Open(_)
            )
        };
        let all = || self.items.iter().enumerate();
        match self.items.len() {
            ..24 => all()
                .filter(is_first)
                .find(|it| it.1.stands_for(node))
                .map(|it| it.0),
            _ if !self.has_split_text
                && self.firsts.get().is_none()
                && let Some(found) = all()
                    .rev()
                    .take(16)
                    .filter(is_first)
                    .find(|it| it.1.stands_for(node)) =>
            {
                Some(found.0)
            }
            _ => self
                .firsts
                .get_or_init(|| {
                    Box::new(
                        all()
                            .rev()
                            .filter(is_first)
                            .flat_map(|it| {
                                [it.1.node, it.1.element].map(|node| (node, it.0 as u32))
                            })
                            .collect(),
                    )
                })
                .get(&node)
                .map(|it| *it as usize),
        }
    }

    /// The first one that is text, a line break or an atomic inline.
    pub(crate) fn leaf(&self, node: NodeId) -> Option<&Item> {
        Some(&self.items[self.first_of(node)?])
            .filter(|it| !matches!(it.kind, ItemKind::Open(_)) && it.node == node)
    }

    pub(crate) fn has_text_in_place_of(&self, element: NodeId) -> bool {
        self.first_of(element)
            .is_some_and(|it| self.items[it].element == element)
    }

    /// If it is worth finding out.
    pub(crate) fn clusters_of(&self, node: NodeId) -> Option<Range<u32>> {
        let first = (self.lines.lines.len() > 4
            && self.clusters.count > 0
            && !self.has_split_text
            && !self.has_ruby)
            .then(|| self.first_of(node))
            .flatten()?;
        let it = &self.items[first];
        Some(if let ItemKind::Open(_) = it.kind {
            it.clusters.start
                ..self
                    .items
                    .get(self.inside(first).end)
                    .map_or(self.clusters.count, |it| it.clusters.end)
        } else {
            it.clusters.clone()
        })
    }

    pub(crate) fn is_cut_off(&self, node: NodeId) -> bool {
        self.items
            .iter()
            .rev()
            .take_while(|it| matches!(it.kind, ItemKind::Close(false) | ItemKind::Control))
            .any(|it| it.node == node)
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

    /// Goes on with what `inline` has before that item, whose text starts with what is not a space.
    pub(crate) fn resume(
        &mut self,
        mut inline: Box<Inline>,
        root: Rc<Style>,
        item: usize,
    ) -> Former {
        let Item {
            start,
            parent,
            segments: Range { start: segment, .. },
            ..
        } = inline.items[item];
        let rest = inline.items.drain(item..).collect();
        (self.items, self.segments) = (
            core::mem::replace(&mut inline.items, rest),
            core::mem::take(&mut inline.segments),
        );
        self.segments.truncate(segment as usize);
        match &mut inline.text {
            Text::Own(all) => {
                let rest = all.split_off(start as usize);
                self.text = core::mem::replace(all, rest);
            }
            Text::Shared(it) => self.text.push_str(&it.text[..start as usize]),
        }
        let (around, outside) = (
            core::iter::successors(parent.checked_sub(1), |it| {
                self.items[*it as usize].parent.checked_sub(1)
            }),
            self.contexts.len(),
        );
        self.contexts.extend(
            around
                .map(|it| bidi_controls(&self.items[it as usize].style).0)
                .filter(|it| !it.is_empty()),
        );
        self.contexts[outside..].reverse();
        (self.parent, self.in_word, self.are_contexts_closed) =
            (parent, inline.items[0].is_in_word, false);
        Former {
            inline,
            root,
            passed_on: [item, start as usize],
        }
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
            is_in_word: self.in_word,
            run_start: 0,
            node,
            element: 0,
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
    pub(crate) fn first_letter(&mut self, node: NodeId, data: &str, style: &Rc<Style>) {
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

    pub(crate) fn text(&mut self, node: NodeId, data: &str, style: &Rc<Style>) {
        self.text_from(node, data, 0, style);
    }

    /// See `Item::element`.
    pub(crate) fn text_in_place_of(
        &mut self,
        element: NodeId,
        node: NodeId,
        data: &str,
        style: &Rc<Style>,
    ) {
        let first = self.items.len();
        self.text_from(node, data, 0, style);
        self.items[first..]
            .iter_mut()
            .filter(|it| it.node == node)
            .for_each(|it| it.element = element);
    }

    /// `data` starts at `base` in the node.
    pub(crate) fn text_from(&mut self, node: NodeId, data: &str, base: usize, style: &Rc<Style>) {
        if !self.contexts.is_empty()
            && style.text.collapse != WhiteSpaceCollapse::Collapse
            && let Some(end) =
                bun_core::strings::index_of_char_usize(data.as_bytes(), b'\n').map(|it| it + 1)
        {
            let (mut rest, mut end) = (data, Some(end));
            while let Some(len) = end {
                self.text_run(node, &rest[..len], base + data.len() - rest.len(), style);
                (rest, self.are_contexts_closed, self.has_split_text) = (&rest[len..], true, true);
                end = Some(
                    bun_core::strings::index_of_char_usize(rest.as_bytes(), b'\n')
                        .map_or(rest.len(), |it| it + 1),
                )
                .filter(|it| *it > 0);
            }
            self.are_contexts_closed = data.ends_with('\n');
            return;
        }
        self.text_run(node, data, base, style);
    }

    fn text_run(&mut self, node: NodeId, data: &str, base: usize, style: &Rc<Style>) {
        let (collapse, transform) = (style.text.collapse, style.text.transform);
        let mask = match style.text.security {
            TextSecurity::None => None,
            TextSecurity::Disc => Some('•'),
            TextSecurity::Circle => Some('◦'),
            TextSecurity::Square => Some('▪'),
        };
        if self.are_contexts_closed && !crate::boxes::is_collapsible_space(data.as_bytes(), style) {
            self.reopen_contexts(style);
        }
        self.push(ItemKind::Text, node, style, "");
        let (index, first) = (self.items.len() - 1, self.segments.len());
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

    /// `first_line` is the style of `::first-line`, if it applies. `former` is what it replaces, with the style of its box.
    pub(crate) fn finish(
        &mut self,
        document: &mut Document,
        first_line: Option<Rc<Style>>,
        former: Option<Former>,
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
            (items, self.items.clone(), root)
        });
        let former = former.filter(|it| {
            first_line.is_none()
                && it.inline.force_line == self.force_line
                && writes_like(&it.root, &self.root)
        });
        let outset = former.as_ref().map_or((0, 0.0), |it| {
            (
                it.inline.outset.get().0.min(it.passed_on[0] as u32),
                it.inline.outset.get().1,
            )
        });
        let mut inline = shape_items(
            document,
            &mut self.text,
            take_out(&mut self.items),
            &self.root,
            former,
            false,
        );
        (inline.segments, inline.force_line, inline.has_split_text) = (
            take_out(&mut self.segments),
            self.force_line,
            self.has_split_text,
        );
        inline
            .outset
            .set(if outset.0 > 0 { outset } else { (0, 0.0) });
        inline.first_line = first_line.and_then(|(items, normal, root)| {
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
            let differ = |a: &Inline, b: &Inline| {
                a.items
                    .iter()
                    .zip(&b.items)
                    .any(|(a, b)| a.clusters != b.clusters)
            };
            let mut restyled = shape_items(document, &mut text, moved, &root, None, false);
            if differ(&restyled, &inline) {
                restyled = shape_items(
                    document,
                    &mut inline.text.to_string(),
                    items.clone(),
                    &root,
                    None,
                    false,
                );
            }
            if differ(&restyled, &inline) {
                let segments = core::mem::take(&mut inline.segments);
                restyled = shape_items(
                    document,
                    &mut inline.text.to_string(),
                    items,
                    &root,
                    None,
                    true,
                );
                inline = shape_items(
                    document,
                    &mut inline.text.to_string(),
                    normal,
                    &self.root,
                    None,
                    true,
                );
                (inline.segments, inline.force_line, inline.has_split_text) =
                    (segments, self.force_line, self.has_split_text);
            }
            (restyled.segments, restyled.force_line) = (inline.segments.clone(), inline.force_line);
            (!differ(&restyled, &inline)).then(|| {
                Box::new((
                    *restyled,
                    document.turned_style(&root, root.text.writing_mode),
                ))
            })
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
    if style
        .fixed()
        .traits
        .contains(crate::layout::Traits::IS_PLAIN_IN_LINES)
    {
        return false;
    }
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
    if text.len() - done < 33 {
        let mut last = [b'a'; 33];
        last[..text.len() - done].copy_from_slice(&text[done..]);
        if last.array_windows().fold(true, |all, it| all & stays(it)) {
            return text.len();
        }
    }
    done + text[done..]
        .array_windows()
        .take_while(|it| stays(it))
        .count()
        + 1
}

/// Leaves the memory behind unless there is much of it.
fn take_out<T>(all: &mut SmallVec<[T; 1]>) -> SmallVec<[T; 1]> {
    if all.len() > 128 {
        return core::mem::take(all);
    }
    let mut taken = SmallVec::with_capacity(all.len());
    taken.append(all);
    taken
}

fn beyond_ascii(text: &str) -> impl Iterator<Item = (usize, char)> {
    let mut at = 0;
    core::iter::from_fn(move || {
        if text.as_bytes().get(at)?.is_ascii() {
            at += bun_core::strings::first_non_ascii(&text.as_bytes()[at..])? as usize;
        }
        let found = (at, text[at..].chars().next()?);
        at += found.1.len_utf8();
        Some(found)
    })
}

fn writes_like(a: &Style, b: &Style) -> bool {
    core::ptr::eq(a, b)
        || Rc::ptr_eq(&a.font, &b.font)
            && Rc::ptr_eq(&a.text, &b.text)
            && (a.font_id, a.zoom, a.metrics) == (b.font_id, b.zoom, b.metrics)
}

fn common_start(a: &[u8], b: &[u8]) -> usize {
    let whole = a
        .as_chunks::<64>()
        .0
        .iter()
        .zip(b.as_chunks().0)
        .take_while(|it| it.0 == it.1)
        .count()
        * 64;
    whole
        + a[whole..]
            .iter()
            .zip(&b[whole..])
            .take_while(|it| it.0 == it.1)
            .count()
}

fn common_end(a: &[u8], b: &[u8]) -> usize {
    let whole = a
        .as_rchunks::<64>()
        .1
        .iter()
        .rev()
        .zip(b.as_rchunks().1.iter().rev())
        .take_while(|it| it.0 == it.1)
        .count()
        * 64;
    whole
        + a[..a.len() - whole]
            .iter()
            .rev()
            .zip(b[..b.len() - whole].iter().rev())
            .take_while(|it| it.0 == it.1)
            .count()
}

impl Inline {
    /// What `Builder` makes of a text that is all there is, in a style that `WRITES_PLAINLY`, if it needs no work.
    pub(crate) fn of_words(
        document: &Document,
        node: NodeId,
        data: &str,
        style: &Rc<Style>,
    ) -> Option<Box<Inline>> {
        (*data.as_bytes().first()? > b' '
            && data.is_ascii()
            && without_collapsing(data.as_bytes()) == data.len())
        .then_some(())?;
        let text = data.strip_suffix(' ').unwrap_or(data);
        let is_beyond_a_screenful = text.len() >= 96
            && document
                .words_built
                .replace(document.words_built.get() + text.len())
                >= 1 << 13;
        let shaped = document.shape_with(
            text,
            &[text_run(style, text.len())],
            abi::DIRECTION_LTR,
            is_beyond_a_screenful && style.text.wrap == TextWrapMode::Wrap,
        );
        let (end, count) = (text.len() as u32, shaped.count() as u32);
        let is_uniform = match shaped.has_letters() {
            true => {
                shaped.faces.len() == 1
                    || shaped
                        .letters()
                        .array_windows()
                        .all(|[a, b]| a.face == b.face)
            }
            false => shaped
                .clusters()
                .array_windows()
                .all(|[a, b]| (a.face, a.bidi_level) == (b.face, b.bidi_level)),
        };
        let item = Item {
            kind: ItemKind::Text,
            has_own_style: false,
            is_uniform,
            is_in_word: false,
            node,
            element: 0,
            style: Rc::clone(style),
            start: 0,
            end,
            run_start: 0,
            clusters: 0..count,
            segments: 0..1,
            parent: 0,
        };
        Some(Box::new(Inline {
            text: Text::Shared(Rc::clone(&shaped)),
            items: SmallVec::from_buf([item]),
            segments: SmallVec::from_buf([Segment {
                node_start: 0,
                node_end: end,
                start: 0,
                end,
            }]),
            label: shaped.label,
            clusters: Clusters {
                paragraphs: SmallVec::from_buf([Paragraph {
                    first_cluster: 0,
                    start: 0,
                    shaped,
                }]),
                joined: Default::default(),
                count,
                are_adjusted: false,
                adjusted_letters: Vec::new(),
                direction: abi::DIRECTION_LTR,
                found: Found::default(),
            },
            has_bidi: false,
            has_layers: false,
            first_layer: 1,
            has_ruby: false,
            force_line: false,
            has_split_text: false,
            is_plain: Default::default(),
            first_line: None,
            lines: Lines::default(),
            outset: Default::default(),
            prose: Default::default(),
            firsts: Default::default(),
            former_lines: None,
        }))
    }

    /// Whether something comes of keeping it for such a text.
    pub(crate) fn may_go_on_as(&self, data: &str, root: &Style, style: &Style) -> bool {
        writes_like(root, style) && common_start(self.text.as_bytes(), data.as_bytes()) >= 64
    }

    pub(crate) fn is_worth_keeping(&self) -> bool {
        (self.clusters.count >= 160 || self.items.len() >= 24)
            && !(self.clusters.are_adjusted
                || self.has_bidi
                || self.has_ruby
                || self.first_line.is_some()
                || self.clusters.paragraphs.is_empty())
    }
}

impl Inline {
    pub(crate) fn can_be_resumed(&self) -> bool {
        self.items.len() >= 8 && !self.has_split_text && self.is_worth_keeping()
    }
}

/// What is being replaced.
pub(crate) struct Former {
    pub(crate) inline: Box<Inline>,
    pub(crate) root: Rc<Style>,
    /// How many of the items are gone, because they start the new ones, and where their text ends.
    pub(crate) passed_on: [usize; 2],
}

struct Change {
    /// How many items, and how much of the text, are the same at the start.
    items: usize,
    bytes: usize,
    /// Those that are not the same.
    paragraphs: Range<usize>,
    former_len: usize,
}

impl Former {
    /// Copies what is known about the items that are alike.
    fn compare(&self, text: &str, items: &mut [Item]) -> Change {
        let (inline, [count, base]) = (&*self.inline, self.passed_on);
        let is_like = |a: &Item, b: &Item| {
            (a.kind, a.parent, a.element == 0) == (b.kind, b.parent, b.element == 0)
                && (Rc::ptr_eq(&a.style, &b.style)
                    || matches!(a.kind, ItemKind::Text | ItemKind::Control)
                        && writes_like(&a.style, &b.style))
                && (a.node == b.node || !inline.has_layers || !matches!(a.kind, ItemKind::Open(_)))
        };
        let copy = |(a, b): (&Item, &mut Item)| {
            (b.clusters, b.is_uniform, b.run_start) = (
                a.clusters.clone(),
                a.is_uniform,
                b.start.saturating_sub(a.start.saturating_sub(a.run_start)),
            )
        };
        let old = if let Text::Own(rest) = &inline.text {
            rest.as_bytes()
        } else {
            &inline.text.as_bytes()[base..]
        };
        let (new, olds, news, paragraphs, former_len) = (
            &text.as_bytes()[base..],
            &inline.items[..],
            &mut items[count..],
            &inline.clusters.paragraphs,
            base + old.len(),
        );
        let same = olds
            .iter()
            .zip(&*news)
            .take_while(|(a, b)| a.end == b.end && is_like(a, b))
            .count();
        let (limit, from) = match (olds.get(same), news.get(same)) {
            (Some(a), Some(b)) if is_like(a, b) => {
                (a.end.min(b.end) as usize - base, a.start as usize - base)
            }
            (None, None) => (old.len(), 0),
            (a, b) => (a.or(b).map_or(0, |it| it.start as usize - base), usize::MAX),
        };
        let start = common_start(&old[..limit], &new[..limit]);
        let head = paragraphs[1..].partition_point(|it| (it.start as usize) < base + start);
        let is_moved = |(a, b): (&Item, &Item)| {
            former_len - a.end as usize == text.len() - b.end as usize && is_like(a, b)
        };
        let mut tail = paragraphs.len();
        if from != usize::MAX
            && head + 1 < tail
            && olds.len() == news.len()
            && olds[same..].iter().zip(&news[same..]).all(is_moved)
        {
            let end = common_end(&old[start.max(from)..], &new[start.max(from)..]);
            tail = paragraphs
                .partition_point(|it| it.start as usize <= former_len - end)
                .max(head + 1);
        }
        let alike = if tail < paragraphs.len() {
            olds.len()
        } else {
            same + usize::from(from != usize::MAX)
        };
        olds.iter().zip(news).take(alike).for_each(copy);
        Change {
            items: count + same,
            bytes: base + start,
            paragraphs: head..tail,
            former_len,
        }
    }
}

#[derive(Default)]
struct Runs {
    runs: SmallVec<[TextRun; 16]>,
    /// For the addresses of a font and of a text style.
    known: Option<([usize; 2], u32, TextRun)>,
    are_apart: bool,
}

/// For the paragraph, from the run on that starts at `from` and has the first of `items`.
fn find_runs(
    text: &str,
    Range { start, end }: Range<usize>,
    from: usize,
    items: &mut [Item],
    Runs {
        runs,
        known,
        are_apart,
    }: &mut Runs,
) {
    runs.clear();
    let mut is_apart = false;
    for item in items
        .iter_mut()
        .take_while(|item| (item.start as usize) < end)
    {
        if item.start == item.end {
            is_apart |= interrupts_shaping(item);
            continue;
        }
        is_apart |= *are_apart;
        if let (ItemKind::Atomic(_), Some(last), false) = (item.kind, runs.last_mut(), *are_apart) {
            last.end = item.end - start as u32;
            continue;
        }
        let (font, text_style) = (
            Rc::as_ptr(&item.style.font).addr(),
            Rc::as_ptr(&item.style.text).addr(),
        );
        let like = known
            .filter(|it| (it.0, it.1) == ([font, text_style], item.style.font_id))
            .unwrap_or_else(|| {
                *known.insert((
                    [font, text_style],
                    item.style.font_id,
                    text_run(&item.style, 0),
                ))
            });
        let run = TextRun {
            end: ((item.end as usize).min(end) - start) as u32,
            ..like.2
        };
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
            if item.start as usize >= start {
                item.run_start = runs
                    .iter()
                    .nth_back(1)
                    .map_or(from as u32, |it| start as u32 + it.end);
            }
            continue;
        }
        let (first, mut flag) = ((item.start as usize).max(start) - start, 0);
        for (offset, character) in text[start + first..start + run.end as usize].char_indices() {
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
}

/// No cluster goes from one item into another if they `are_apart`.
fn shape_items(
    document: &Document,
    whole: &mut String,
    mut items: SmallVec<[Item; 1]>,
    root: &Style,
    former: Option<Former>,
    are_apart: bool,
) -> Box<Inline> {
    let text = &**whole;
    let direction = match (root.layout.unicode_bidi, root.is_rtl()) {
        (UnicodeBidi::Plaintext, _) => abi::DIRECTION_AUTO,
        (_, true) => abi::DIRECTION_RTL,
        (_, false) => abi::DIRECTION_LTR,
    };
    let is_anywhere = |it: &Item| match it.kind {
        ItemKind::Text => {
            it.style.text.line_break == LineBreak::Anywhere
                && it.style.text.collapse != WhiteSpaceCollapse::BreakSpaces
                && it.style.text.wrap == TextWrapMode::Wrap
        }
        kind => matches!(kind, ItemKind::Open(_) | ItemKind::Close(_)),
    };
    let anywhere = if items.iter().all(is_anywhere) {
        platform::BREAKS_ANYWHERE
    } else {
        0
    };
    let mut clusters = Clusters {
        paragraphs: SmallVec::new(),
        joined: Default::default(),
        count: 0,
        are_adjusted: false,
        adjusted_letters: Vec::new(),
        direction: direction | anywhere,
        found: Found::default(),
    };
    let (mut changed, mut tail, mut runs, mut replaced, mut same_items) = (
        0..text.len(),
        Vec::new(),
        Runs {
            are_apart,
            ..Runs::default()
        },
        None,
        0,
    );
    let mut former = former.filter(|it| {
        it.inline.clusters.direction == clusters.direction
            && root.text.writing_mode == WritingMode::HorizontalTb
    });
    if let Some(former) = &mut former {
        let change = former.compare(text, &mut items);
        former.inline.text = Text::Own(String::new());
        clusters.paragraphs = core::mem::take(&mut former.inline.clusters.paragraphs);
        tail.extend(
            clusters
                .paragraphs
                .drain(change.paragraphs.end..)
                .map(|it| Paragraph {
                    start: (it.start as usize + text.len() - change.former_len) as u32,
                    ..it
                }),
        );
        if let Some(first) = clusters.paragraphs.drain(change.paragraphs.start..).next() {
            changed = first.start as usize..tail.first().map_or(text.len(), |it| it.start as usize);
            (clusters.count, clusters.found, same_items) = (
                first.first_cluster,
                former.inline.clusters.found,
                change.items,
            );
            replaced = Some((first.shaped, change.bytes - changed.start));
        }
    }
    let (mut start, first_changed) = (changed.start, clusters.count);
    // Up to where the clusters have the same numbers as before, and the same letters.
    let (mut settled, mut valid) = ((start as u32, first_changed), first_changed);
    let mut first_item = if start > 0 {
        items.partition_point(|it| it.end as usize <= start)
    } else {
        0
    };
    while start < changed.end {
        let known = replaced.as_ref().map_or(0, |it| it.1.saturating_sub(1));
        let rest = &text.as_bytes()[start + known..];
        let end = start
            + known
            + bun_core::strings::index_of_char_usize(rest, b'\n').map_or(rest.len(), |it| it + 1);
        while items[first_item].end as usize <= start {
            first_item += 1;
        }
        let shape = |items: &mut [Item], runs: &mut Runs| {
            find_runs(text, start..end, start, items, runs);
            document.shape(&text[start..end], &runs.runs, clusters.direction)
        };
        let shaped = match replaced.take() {
            None => shape(&mut items[first_item..], &mut runs),
            Some((old, known)) => {
                let (shaped, skipped, same) = if known == old.text.len() && known == end - start {
                    let count = old.count();
                    (old, known, count)
                } else {
                    let near = items[..items.len().min(same_items + 1)]
                        .partition_point(|it| it.start as usize + 96 <= start + known);
                    let near = items[first_item..near.max(first_item)]
                        .iter()
                        .rposition(|it| it.kind == ItemKind::Text && it.start < it.end)
                        .map_or(first_item, |it| first_item + it);
                    let from = start.max(items[near].run_start as usize);
                    let rest = if known < 64 {
                        Err(old)
                    } else {
                        find_runs(text, start..end, from, &mut items[near..], &mut runs);
                        document.shape_rest(
                            old,
                            known,
                            &text[start..end],
                            (&runs.runs, from - start),
                            clusters.direction,
                        )
                    };
                    rest.unwrap_or_else(|old| {
                        let shaped = shape(&mut items[first_item..], &mut runs);
                        let same = shaped.letters_in_common(&old);
                        (shaped, 0, same)
                    })
                };
                settled = (
                    (start + skipped) as u32,
                    first_changed
                        + if skipped > 0 {
                            shaped.count_before(skipped) as u32
                        } else {
                            0
                        },
                );
                valid += same.min(shaped.count_before(known)).saturating_sub(2) as u32;
                shaped
            }
        };
        let first_cluster = clusters.count;
        clusters.count += shaped.count() as u32;
        clusters.paragraphs.push(Paragraph {
            first_cluster,
            start: start as u32,
            shaped,
        });
        start = end;
    }
    let (fresh, kept_tail) = (
        first_changed..clusters.count,
        tail.first().map(|it| [it.first_cluster, clusters.count]),
    );
    if let (Some([old, new]), Some(former)) = (kept_tail, &former) {
        clusters
            .paragraphs
            .extend(tail.into_iter().map(|it| Paragraph {
                first_cluster: it.first_cluster - old + new,
                ..it
            }));
        clusters.count = former.inline.clusters.count - old + new;
    }
    let unsettled = items[..same_items].partition_point(|it| it.end <= settled.0);
    let (mut next, mut paragraphs) = (
        items[..unsettled].last().map_or(0, |it| it.clusters.end),
        &clusters.paragraphs[..],
    );
    for item in &mut items[unsettled..] {
        let first = next;
        if clusters.len() == text.len() {
            next = item.end;
        } else if item.start < item.end {
            let mut from = item.start;
            if paragraphs.get(1).is_some_and(|it| it.start <= item.end) {
                paragraphs =
                    &paragraphs[paragraphs.partition_point(|it| it.start <= item.end) - 1..];
                (from, next) = (from, next).max((paragraphs[0].start, paragraphs[0].first_cluster));
            }
            if settled.0 <= item.end {
                (from, next) = (from, next).max(settled);
            }
            next += paragraphs[0].shaped.count_in(
                (from - paragraphs[0].start) as usize..(item.end - paragraphs[0].start) as usize,
            ) as u32;
        }
        item.clusters = first..next;
    }
    let is_open_layer = |it: &Item| matches!(it.kind, ItemKind::Open(_)) && is_layer(&it.style);
    let first_layer = former
        .as_ref()
        .map(|it| it.inline.first_layer as usize)
        .filter(|it| *it < same_items);
    let first_layer = first_layer.unwrap_or_else(|| {
        same_items
            + items[same_items..]
                .iter()
                .take_while(|it| !is_open_layer(it))
                .count()
    });
    let (mode, is_ascii) = (
        root.text.writing_mode.of_lines(),
        clusters.len() == text.len() || text.is_ascii(),
    );
    let mut inline = Box::new(Inline {
        has_bidi: (direction == abi::DIRECTION_RTL || !is_ascii)
            && clusters.split(fresh.clone()).any(|it| {
                !it.0.has_letters() && it.0.clusters().iter().any(|it| it.bidi_level > 0)
            }),
        has_layers: first_layer < items.len(),
        first_layer: first_layer as u32,
        has_ruby: items[same_items..]
            .iter()
            .any(|it| matches!(it.kind, ItemKind::Annotation(..))),
        text: Text::Own(String::new()),
        items,
        segments: SmallVec::new(),
        clusters,
        force_line: false,
        has_split_text: false,
        is_plain: Default::default(),
        label: None,
        first_line: None,
        lines: Lines::default(),
        outset: Default::default(),
        prose: Default::default(),
        firsts: Default::default(),
        former_lines: None,
    });
    let (before, unknown) = (inline.clusters.found, settled.0 as usize..changed.end);
    let mut found = if is_ascii { Found::default() } else { before };
    let (mut trailing_bytes, counts) = (
        0,
        !is_ascii
            && inline
                .clusters
                .split(fresh.clone())
                .all(|it| it.0.has_a_letter_per_character()),
    );
    let is_tight = core::cell::OnceCell::new();
    for (at, it) in beyond_ascii(if is_ascii { "" } else { &text[unknown.clone()] }) {
        let cluster = settled.1 + (at - trailing_bytes) as u32;
        trailing_bytes += it.len_utf8() - 1;
        match it {
            ..'\u{1680}' | '\u{2066}'..='\u{2069}' | '\u{fffc}' => {}
            '\u{4e00}'..='\u{9fff}' => found.ideographs = true,
            '\u{ac00}'..='\u{d7a3}' => {}
            '‘' | '’' | '“' | '”' => {
                let is_narrow = |it: Letter| {
                    it.advance
                        < inline.paragraph_of(cluster).shaped.faces[usize::from(it.face)].size
                            * 0.65
                };
                found.quotes = true;
                found.punctuation = found.punctuation
                    || !counts
                    || !is_narrow(inline.clusters.letter(cluster))
                    || *is_tight.get_or_init(|| {
                        inline.items[unsettled..]
                            .iter()
                            .any(|it| it.style.letter_spacing() < 0.0)
                    });
            }
            '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{205f}' | '\u{3000}' => found.spaces = true,
            _ => {
                found.ideographs |= it >= '\u{2e80}' && is_ideograph(it);
                found.punctuation |= match spacing_class(it) {
                    None => text[unknown.start + at + it.len_utf8()..]
                        .chars()
                        .next()
                        .map(spacing_class)
                        .is_some_and(|it| it != Some(Punctuation::Other)),
                    Some(class) => matches!(class, Punctuation::Opening | Punctuation::Closing),
                };
            }
        }
    }
    found.adjusts = found.adjusts
        || found.spaces
        || found.ideographs
            && (found.quotes
                || inline
                    .items
                    .iter()
                    .any(|it| it.style.text.autospace == TextAutospace::Normal));
    found.trims = found.punctuation && text.bytes().any(|it| it >= 0xe3);
    let has_ruby =
        inline.has_ruby && !is_ascii && text.chars().any(|it| !it.is_ascii() && it != '\u{fffc}');
    inline.clusters.found = found;
    inline.text = match &inline.clusters.paragraphs[..] {
        [only] => Text::Shared(Rc::clone(&only.shaped)),
        all if all.len() < 8 => Text::Own(whole.clone()),
        _ => Text::Own(core::mem::take(whole)),
    };
    let has_letters = |it: &Former| {
        it.inline.clusters.adjusted_letters.is_empty()
            || inline
                .clusters
                .split(fresh.clone())
                .all(|it| it.0.has_letters() && it.0.faces.len() <= 256)
    };
    let still_holds = !(before.punctuation && before.trims != found.trims
        || anywhere != 0 && before.adjusts != found.adjusts);
    let mut former = former
        .filter(|it| still_holds && inline.is_worth_keeping() && has_letters(it))
        .map(|it| {
            (
                Kept {
                    head: it.inline.place_to_resume(first_changed, valid),
                    tail: kept_tail,
                },
                it.inline,
            )
        });
    let (mut to_adjust, mut final_letters) = (0..u32::MAX, SmallVec::<[Letter; 3]>::new());
    if let Some((kept, former)) = &mut former {
        let [old_end, end] = kept
            .tail
            .unwrap_or([former.clusters.count, inline.clusters.count]);
        to_adjust = kept.head.saturating_sub(2)..end;
        let mut letters = core::mem::take(&mut former.clusters.adjusted_letters);
        if !letters.is_empty() {
            final_letters.extend_from_slice(
                &letters[kept.head.saturating_sub(3) as usize..kept.head as usize],
            );
            letters.splice(
                to_adjust.start as usize..old_end as usize,
                inline
                    .clusters
                    .split(to_adjust.clone())
                    .flat_map(|it| &it.0.letters()[it.1])
                    .copied(),
            );
            inline.clusters.adjusted_letters = letters;
        }
    }
    let first_to_adjust = if to_adjust.start > 0 {
        inline
            .items
            .partition_point(|it| it.clusters.end <= to_adjust.start)
    } else {
        0
    };
    for index in first_to_adjust..inline.items.len() {
        if mode.is_vertical() {
            inline.items[index].style = document.turned_style(&inline.items[index].style, mode);
        }
        let item = &inline.items[index];
        if item.clusters.start >= to_adjust.end {
            break;
        }
        if found.adjusts
            || has_ruby
            || mode.is_vertical()
            || item.style.text.line_break == LineBreak::Anywhere && anywhere == 0
            || matches!(item.kind, ItemKind::Atomic(_))
        {
            inline.adjust_clusters(index, &to_adjust);
        }
    }
    if found.trims {
        inline.trim_punctuation(first_to_adjust, &to_adjust);
    }
    for (letter, at) in final_letters
        .iter()
        .zip(former.as_ref().map_or(0, |it| it.0.head.saturating_sub(3))..)
    {
        let (advance, flags) = inline.clusters.adjust(at);
        (*advance, *flags) = (letter.advance, letter.flags);
    }
    let kind = |it: &Cluster| (it.face, it.bidi_level, it.flags & (UPRIGHT | COMBINED));
    let Inline {
        items, clusters, ..
    } = &mut *inline;
    let are_alike = |clusters: &[Cluster]| {
        clusters
            .array_windows()
            .fold(true, |all, [a, b]| all & (kind(a) == kind(b)))
    };
    for item in items[unsettled..]
        .iter_mut()
        .take_while(|it| it.clusters.start <= fresh.end)
    {
        let inside =
            item.clusters.start.max(settled.1.saturating_sub(1))..item.clusters.end.min(fresh.end);
        item.is_uniform = (inside == item.clusters || item.is_uniform)
            && (inside.len() < 2
                || match clusters.are_adjusted {
                    true => are_alike(&clusters[inside.start as usize..inside.end as usize]),
                    false => clusters.split(inside).all(|(shaped, range)| {
                        match shaped.letters().get(range.clone()) {
                            Some(letters) => {
                                shaped.faces.len() == 1
                                    || letters
                                        .array_windows()
                                        .fold(true, |all, [a, b]| all & (a.face == b.face))
                            }
                            None => are_alike(&shaped.clusters()[range]),
                        }
                    }),
                });
    }
    if let Some((kept, former)) = former.filter(|_| inline.is_worth_keeping()) {
        inline.take_over(*former, root, kept);
    }
    inline
}

thread_local! {
    static SPACING: RefCell<Box<Map<(u32, u32, bool), (Punctuation, bool)>>> = RefCell::default();
}

impl Inline {
    fn first_glyph(&self, cluster: u32) -> Option<(abi::Face, abi::Glyph)> {
        let (range, shaped) = (cluster..cluster + 1, &self.paragraph_of(cluster).shaped);
        if let Some([it]) = self.clusters.letters(&range) {
            return (it.glyph != abi::NO_GLYPH).then(|| {
                (
                    shaped.faces[usize::from(it.face)],
                    abi::Glyph {
                        id: it.glyph.into(),
                        x: 0.0,
                        y: 0.0,
                    },
                )
            });
        }
        let it = &self.clusters.part(&range)[0];
        Some((
            shaped.faces[usize::from(it.face)],
            *shaped.glyphs()[it.glyphs.range()].first()?,
        ))
    }

    /// The first one of each of the clusters, which are in the item.
    fn characters<'a>(
        &'a self,
        item: &Item,
        clusters: Range<u32>,
    ) -> impl Iterator<Item = char> + 'a {
        let are_all = !clusters.is_empty()
            && self
                .clusters
                .split(clusters.clone())
                .all(|it| it.0.has_a_letter_per_character());
        let start = || {
            let it = self.paragraph_of(clusters.start);
            it.start as usize
                + it.shaped
                    .start_of((clusters.start - it.first_cluster) as usize)
        };
        let all = if are_all {
            &self.text[if clusters.start == item.clusters.start {
                item.start as usize
            } else {
                start()
            }..]
        } else {
            ""
        };
        all.chars()
            .take(clusters.len())
            .chain(if are_all { 0..0 } else { clusters }.map(|it| self.character(it)))
    }

    /// And whether it has a half that can be trimmed.
    pub(crate) fn spacing_of(
        &self,
        cluster: u32,
        character: char,
        style: &Style,
    ) -> (Punctuation, bool) {
        let class = spacing_class(character);
        if let Some(class) =
            class.filter(|it| !matches!(it, Punctuation::Opening | Punctuation::Closing))
        {
            return (class, false);
        }
        let it = self.clusters.letter(cluster);
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
        let it = self.clusters.letter(cluster);
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
        let it = self.clusters.letter(cluster);
        if it.flags & (AUTOSPACED | abi::CLUSTER_SPACE) != AUTOSPACED {
            return 0.0;
        }
        let Paragraph {
            first_cluster,
            shaped,
            ..
        } = self.paragraph_of(cluster);
        let at = (cluster - first_cluster) as usize;
        it.advance
            - shaped
                .letters()
                .get(at)
                .map_or_else(|| shaped.clusters()[at].advance, |it| it.advance)
    }

    /// The cluster that is shown to the left of where `at` meets the text before it.
    fn left_of_boundary(&self, at: u32) -> usize {
        let at = at as usize;
        if !self.has_bidi {
            return at - 1;
        }
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

    fn trim_punctuation(&mut self, first: usize, range: &Range<u32>) {
        let (mut before, mut halved, mut marked) =
            ((Punctuation::Other, false), Vec::new(), Vec::new());
        for item in self.items[first..]
            .iter()
            .take_while(|it| it.clusters.start < range.end)
        {
            let inside = item.clusters.start.max(range.start)..item.clusters.end.min(range.end);
            for (at, character) in inside.clone().zip(self.characters(item, inside)) {
                if matches!(character, 'a'..='z' | ' ' | '\u{3041}'..='\u{30fa}' | '\u{4e00}'..='\u{d7a3}')
                {
                    before = (Punctuation::Other, false);
                    continue;
                }
                let own = self.spacing_of(at, character, &item.style);
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
                    halved.push((at - 1, item.style.letter_spacing()));
                }
                let flags = match (own, before.0) {
                    (
                        (Punctuation::Opening, true),
                        Punctuation::Other | Punctuation::NarrowClosing,
                    ) => OPENING,
                    ((Punctuation::Opening, true), _) => OPENING | TRIMS,
                    ((Punctuation::Closing, true), _)
                        if !matches!(character, '、' | '。' | '，' | '．' | '：' | '；') =>
                    {
                        TRIMS
                    }
                    _ => 0,
                };
                marked.extend((flags != 0).then_some((at, flags)));
                before = own;
            }
            if let ItemKind::RubyBase | ItemKind::Annotation(..) = item.kind {
                before = (Punctuation::Other, false);
            }
        }
        marked
            .into_iter()
            .for_each(|(at, flags)| *self.clusters.adjust(at).1 |= flags);
        for (at, spacing) in halved {
            let (advance, flags) = self.clusters.adjust(at);
            (*advance, *flags) = ((*advance + spacing) / 2.0, *flags & !TRIMS);
        }
    }

    fn adjust_clusters(&mut self, index: usize, range: &Range<u32>) {
        let (item, count) = (&self.items[index], self.clusters.len() as u32);
        let (clusters, text, is_vertical) = (
            item.clusters.clone(),
            &item.style.text,
            item.style.has_central_baseline(),
        );
        match item.kind {
            ItemKind::Atomic(_) => {
                let [before, after] = match self
                    .clusters
                    .split(clusters.start.saturating_sub(1)..clusters.end + 1)
                    .all(|it| it.0.has_a_letter_per_character())
                {
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
                        let flags = self.clusters.adjust(at).1;
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
                base.for_each(|at| *self.clusters.adjust(at).1 &= !abi::CLUSTER_BREAK_BEFORE);
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
                let clusters = clusters.start.max(range.start)..clusters.end.min(range.end);
                let next = |item: &Item| {
                    if item.clusters.end == clusters.end {
                        self.text[item.end as usize..].chars().next()
                    } else {
                        None
                    }
                };
                let characters: Vec<_> = self
                    .characters(item, clusters.clone())
                    .chain(next(item))
                    .collect();
                let mut before = match clusters
                    .start
                    .checked_sub(1)
                    .filter(|it| !clusters.is_empty() && *it >= range.start)
                {
                    Some(it) if self.paragraph_of(it).shaped.has_a_letter_per_character() => self
                        .text[..item.start as usize]
                        .chars()
                        .next_back()
                        .unwrap_or_default(),
                    it => it.map_or('\0', |it| self.character(it)),
                };
                for (at, index) in clusters.zip(0..) {
                    let character = characters[index];
                    let before = core::mem::replace(&mut before, character);
                    let flags_before = || {
                        at.checked_sub(1)
                            .map_or(0, |it| self.clusters.letter(it).flags)
                    };
                    let after_combined =
                        self.clusters.are_adjusted && flags_before() & COMBINED != 0;
                    if text.autospace == TextAutospace::Normal
                        && at > 0
                        && (is_ideograph(character) || is_ideograph(before))
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
                        let (stood, stands) = (
                            flags_before() & (UPRIGHT | COMBINED) != 0,
                            is_vertical && stands_upright(&item.style, character),
                        );
                        if is_ideograph(before) && is_letter(character) && !stands
                            || is_letter(before) && !stood && is_ideograph(character)
                        {
                            let (advance, flags) =
                                self.clusters.adjust(self.left_of_boundary(at) as u32);
                            (*advance, *flags) = (
                                *advance + item.style.metrics.ideograph_advance / 8.0,
                                *flags | AUTOSPACED,
                            );
                        }
                    }
                    if matches!(character, '“' | '”' | '‘' | '’') && is_ideograph(before) {
                        let is_bracket =
                            matches!(character, '“' | '”') && speaks(&item.style, "zh");
                        let before_wide = characters
                            .get(index + 1)
                            .is_some_and(|it| is_ideograph(*it));
                        match character {
                            '“' | '‘' if is_bracket || before_wide => {
                                *self.clusters.adjust(at).1 |= abi::CLUSTER_BREAK_BEFORE
                            }
                            '”' | '’' if before_wide => {
                                *self.clusters.adjust(at + 1).1 |= abi::CLUSTER_BREAK_BEFORE
                            }
                            _ => {}
                        }
                    }
                    match character {
                        '\u{3000}' if text.word_break == WordBreak::BreakAll => {
                            let flags = self.clusters.adjust(at).1;
                            *flags = *flags & !abi::CLUSTER_BREAK_BEFORE | IDEOGRAPHIC_SPACE;
                        }
                        '\u{3000}' => *self.clusters.adjust(at).1 |= IDEOGRAPHIC_SPACE,
                        '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{205f}' => {
                            *self.clusters.adjust(at).1 &= !abi::CLUSTER_SPACE
                        }
                        _ => {}
                    }
                    if text.line_break == LineBreak::Anywhere
                        || after_combined && character.is_alphanumeric()
                    {
                        *self.clusters.adjust(at).1 |= abi::CLUSTER_BREAK_BEFORE;
                    }
                    if is_vertical
                        && stands_upright(&item.style, character)
                        && self.first_glyph(at).is_some()
                    {
                        self.clusters[at as usize].flags |= UPRIGHT;
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
        self.shape_with(text, runs, direction, false)
    }

    #[inline]
    fn shape_with(
        &self,
        text: &str,
        runs: &[TextRun],
        direction: u8,
        outlines: bool,
    ) -> Rc<Shaped> {
        let words = |run: &TextRun| {
            let [size, letters, words] =
                [run.size, run.letter_spacing, run.word_spacing].map(|it| u64::from(it.to_bits()));
            [
                (u64::from(run.end) << 32) | u64::from(run.font),
                (size << 32) | letters,
                (words << 32) | (u64::from(run.word_break) << 8) | u64::from(direction),
            ]
        };
        let how = if let [only] = runs {
            keyed_hash_of_words(&words(only))
        } else {
            keyed_hash_of_words(&runs.iter().flat_map(words).collect::<SmallVec<[u64; 24]>>())
        };
        let mut cache = self.shaped.borrow_mut();
        if self.newly_shaped_bytes.get() > 1 << 15 {
            self.newly_shaped_bytes.set(0);
            cache.retain(|_, it| it.text.len() < 256 || Rc::strong_count(it) > 1);
        }
        let new = || {
            self.newly_shaped_bytes
                .update(|it| it + if text.len() < 256 { 0 } else { text.len() });
            self.fonts.note_written(text, 0, runs);
            let mut shaped = if outlines {
                platform::outline(text, runs[0])
            } else {
                platform::shape(text, runs, direction)
            };
            shaped.how = how;
            Rc::new(shaped)
        };
        let known = cache
            .entry(bun_wyhash::hash_with_seed(how, text.as_bytes()))
            .or_insert_with(new);
        if known.how == how && *known.text == *text {
            Rc::clone(known)
        } else {
            new()
        }
    }

    fn shape_rest(
        &self,
        former: Rc<Shaped>,
        known: usize,
        text: &str,
        runs: (&[TextRun], usize),
        direction: u8,
    ) -> Result<(Rc<Shaped>, usize, usize), Rc<Shaped>> {
        let (shaped, skipped, same) = platform::shape_rest(former, known, text, runs, direction)?;
        self.fonts.note_written(text, skipped, runs.0);
        Ok((Rc::new(shaped), skipped, same))
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
