//! Carets, selections and ranges.

use core::cell::RefCell;
use core::ops::Range as Span;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::abi::{CLUSTER_SPACE, Matrix, Rect};
use crate::boxes::{BoxId, Kind};
use crate::cascade::Highlight;
use crate::document::Document;
use crate::inline::{Inline, Item, ItemKind};
use crate::lines::{Fragment, FragmentKind, Line};
use crate::name::{Map, Name, Set, is_name, name};
use crate::order::Order as _;
use crate::properties::Style;
use crate::selector::Pseudo;
use crate::tree::{DOCUMENT, Data, Flags, Gone, Namespace, NodeId, State};
use crate::types::*;

/// In text, a UTF-8 offset. Else the child after the point, or 0.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Point {
    pub(crate) node: NodeId,
    pub(crate) offset: u32,
}

pub(crate) type Range = [Point; 2];

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Mark {
    Highlight(Name),
    Composition,
    Selection,
}

#[derive(Default)]
pub(crate) struct Marks {
    pub(crate) selection: Option<Range>,
    /// Whether it is upstream.
    pub(crate) caret: Option<bool>,
    pub(crate) highlights: Vec<(Mark, i32, Vec<Range>)>,
    pub(crate) are_stale: bool,
    marked: Marked,
    pub(crate) styles: RefCell<Map<NodeId, SmallVec<[(Pseudo, Option<Rc<Highlight>>); 1]>>>,
    /// Rules are activated late.
    pub(crate) styled_pseudos: usize,
    /// Of those in `styles`.
    pub(crate) restyled: Vec<NodeId>,
}

#[derive(Default)]
struct Marked {
    by_node: Map<NodeId, SmallVec<[(Span<u32>, Mark); 1]>>,
    /// Elements that are selected with all that is in them, and with something after them.
    selected: Set<NodeId>,
}

impl Marked {
    fn of(&self, document: &Document, node: NodeId) -> impl Iterator<Item = &(Span<u32>, Mark)> {
        static ALL: (Span<u32>, Mark) = (0..u32::MAX, Mark::Selection);
        let is_selected = !self.selected.is_empty() && document.may_be_marked(node) && {
            let around = core::iter::once(node).chain(document.tree.flat_ancestors(node));
            around
                .take_while(|it| {
                    !document
                        .tree
                        .element(*it)
                        .is_some_and(|it| it.is_generated())
                })
                .any(|it| self.selected.contains(&it))
        };
        self.by_node
            .get(&node)
            .into_iter()
            .flatten()
            .chain(is_selected.then_some(&ALL))
    }
}

impl Marks {
    pub(crate) fn is_empty(&self) -> bool {
        self.marked.by_node.is_empty() && self.marked.selected.is_empty()
    }

    pub(crate) fn forget(&mut self, gone: &Gone) {
        gone.leave_map(self.styles.get_mut());
        let survives = |range: &Range| range.iter().all(|it| !gone.has(it.node));
        self.selection = self.selection.filter(survives);
        self.highlights
            .iter_mut()
            .for_each(|it| it.2.retain(survives));
    }
}

enum Visit {
    Text(Span<u32>),
    /// Whether the range has its start.
    Enter,
    /// The range has all of it, which need not be visited if the answer is yes.
    Inside,
    /// Whether the range has all of it.
    Leave(bool),
}

/// Before a cluster, or after the last one.
#[derive(Clone, Copy, PartialEq)]
struct Place {
    lines: BoxId,
    at: u32,
    upstream: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Class {
    Word,
    Hangul,
    Han,
    Hiragana,
    Katakana,
    Space,
    Other,
}

impl Inline {
    fn item_at(&self, cluster: u32) -> Option<&Item> {
        let index = self.items.partition_point(|it| it.clusters.end <= cluster);
        self.items
            .get(index)
            .filter(|it| it.clusters.contains(&cluster))
    }

    fn offset_of(&self, cluster: u32) -> u32 {
        if (cluster as usize) < self.clusters.len() {
            self.clusters.start_of(cluster)
        } else {
            self.text.len() as u32
        }
    }

    fn last_place(&self) -> u32 {
        let count = self.clusters.len() as u32;
        count - u32::from(count > 0 && self.is_newline(count - 1))
    }

    fn line_index(&self, at: u32, upstream: bool) -> usize {
        let lines = &self.lines.lines;
        let index = lines
            .partition_point(|it| it.clusters.end <= at)
            .min(lines.len().saturating_sub(1));
        let wraps_here =
            index > 0 && at > 0 && lines[index].clusters.start == at && !self.is_newline(at - 1);
        index - usize::from(upstream && wraps_here)
    }

    /// The last place on the line, and whether the next line starts there too.
    fn line_end(&self, line: &Line) -> (u32, bool) {
        let end = line.clusters.end;
        if end == line.clusters.start
            || end as usize == self.clusters.len() && !self.is_newline(end - 1)
        {
            return (end, false);
        }
        let has_collapsed = self.clusters.letter(end - 1).flags & CLUSTER_SPACE != 0
            && self.advance(self.lines.fragments_of(line), end - 1) == 0.0;
        if self.is_newline(end - 1) || has_collapsed {
            (end - 1, false)
        } else {
            (end, true)
        }
    }

    fn class(&self, cluster: u32) -> Class {
        let character = |cluster: u32| {
            self.text[self.offset_of(cluster) as usize..]
                .chars()
                .next()
                .unwrap_or(' ')
        };
        let own = character(cluster);
        let is_between = |is: fn(char) -> bool| {
            cluster > 0 && is(character(cluster - 1)) && is(character(cluster + 1))
        };
        let is_word = match own {
            '\'' | '’' => is_between(char::is_alphabetic) || is_between(char::is_numeric),
            '·' => is_between(char::is_alphabetic),
            '.' | ',' | ';' => is_between(char::is_numeric),
            _ => own.is_alphanumeric() || own == '_',
        };
        match own {
            '\u{ac00}'..='\u{d7a3}' => Class::Hangul,
            '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}' | '\u{20000}'..='\u{3ffff}' => {
                Class::Han
            }
            '\u{3041}'..='\u{309f}' => Class::Hiragana,
            '\u{30a1}'..='\u{30fa}' | '\u{30fc}'..='\u{30ff}' | '\u{ff66}'..='\u{ff9f}' => {
                Class::Katakana
            }
            _ if is_word => Class::Word,
            _ if own.is_whitespace() => Class::Space,
            _ => Class::Other,
        }
    }
}

impl Document {
    fn visit_range(&self, range: &Range, visit: &mut dyn FnMut(NodeId, Visit) -> bool) {
        let path = |node: NodeId| core::iter::once(node).chain(self.tree.flat_ancestors(node));
        let (to_start, mut to_end): (Vec<_>, Vec<_>) =
            (path(range[0].node).collect(), path(range[1].node).collect());
        if let Some(common) = to_start.iter().find(|it| to_end.contains(it)) {
            to_end.extend(path(self.tree.host_of(range[1].node)));
            self.visit_in(*common, range, [&to_start, &to_end], &mut false, visit);
        }
    }

    /// With what has only a part of it.
    pub(crate) fn visit_selected(&self, visit: &mut dyn FnMut(NodeId)) {
        if let Some(range) = &self.marks.selection {
            range.iter().for_each(|it| {
                core::iter::once(it.node)
                    .chain(self.tree.flat_ancestors(it.node))
                    .for_each(&mut *visit)
            });
            self.visit_range(range, &mut |it, _| (visit(it), false).1);
        }
    }

    /// Whether the range goes on. `to_end` is empty unless the end is in there.
    fn visit_in(
        &self,
        id: NodeId,
        range: &Range,
        [to_start, to_end]: [&[NodeId]; 2],
        started: &mut bool,
        visit: &mut dyn FnMut(NodeId, Visit) -> bool,
    ) -> bool {
        let ([start, end], was_started) = (range, *started);
        if let Some(text) = self.tree[id].text() {
            *started = true;
            let clamp = |offset: u32| offset.min(text.len() as u32);
            let from = if start.node == id {
                clamp(start.offset)
            } else {
                0
            };
            visit(
                id,
                Visit::Text(
                    from..if end.node == id {
                        clamp(end.offset).max(from)
                    } else {
                        text.len() as u32
                    },
                ),
            );
            return end.node != id;
        }
        if was_started && to_end.is_empty() && self.hides_contents(id) {
            return true;
        }
        if was_started {
            visit(id, Visit::Enter);
        }
        if !(was_started && to_end.is_empty() && visit(id, Visit::Inside)) {
            let host = |node: NodeId| {
                Some(self.tree.host_of(node))
                    .filter(|it| *it != 0)
                    .unwrap_or(node)
            };
            let here = |point: &Point, may_be: bool| {
                (may_be && host(point.node) == host(id)).then_some(point.offset)
            };
            let (starts_at, ends_at) = (here(start, !was_started), here(end, !to_end.is_empty()));
            let children = self
                .tree
                .flat_children(id)
                .take_while(|_| bun_core::StackCheck::init().is_safe_to_recurse())
                .chain([0]);
            for child in children {
                *started |= starts_at == Some(child);
                if ends_at == Some(child) {
                    return false;
                }
                if child != 0
                    && (*started || to_start.contains(&child))
                    && !self.visit_in(
                        child,
                        range,
                        [to_start, if to_end.contains(&child) { to_end } else { &[] }],
                        started,
                        visit,
                    )
                {
                    return false;
                }
            }
        }
        visit(id, Visit::Leave(was_started));
        true
    }

    fn contents_of(&self, id: NodeId) -> Range {
        [
            Point {
                node: id,
                offset: self.tree.flat_children(id).next().unwrap_or(0),
            },
            Point {
                node: id,
                offset: 0,
            },
        ]
    }

    fn may_be_marked(&self, id: NodeId) -> bool {
        self.tree[id].text().is_some()
            || self.tree.html_tag(id) == name!("br")
            || self
                .own_box(id)
                .is_some_and(|it| self.boxes[it].is_replaced())
    }

    pub(crate) fn marks_of(&self, node: NodeId) -> impl Iterator<Item = &(Span<u32>, Mark)> {
        self.marks.marked.of(self, node)
    }

    pub(crate) fn is_selected(&self, node: NodeId) -> bool {
        self.marks_of(node).any(|it| it.1 == Mark::Selection)
    }

    /// If the block has no other boxes, and the items are like the nodes in it.
    fn plain_lines(&self, id: NodeId) -> Option<(BoxId, &Inline)> {
        let (own, tree) = (&self.boxes[self.own_box(id)?], &self.tree);
        let &[lines] = &own.children[..] else {
            return None;
        };
        let inline = self.inline(lines).filter(|_| {
            self.boxes[lines].children.is_empty()
                && !own.is_parking
                && !tree[id].has(Flags::REDIRECTS_CHILDREN)
        })?;
        if self
            .top_layer
            .iter()
            .any(|it| tree.flat_ancestors(*it).any(|it| it == id))
        {
            return None;
        }
        let is_like_node = |it: &Item| {
            let is_child = || {
                tree[if it.element == 0 { it.node } else { it.element }].parent
                    == it
                        .parent
                        .checked_sub(1)
                        .map_or(id, |it| inline.items[it as usize].node)
            };
            match it.kind {
                ItemKind::Text => {
                    tree[it.node].text().is_some()
                        && is_child()
                        && tree.html_tag(it.element) != name!("p")
                }
                ItemKind::Open(_) => {
                    is_child()
                        && !tree[it.node].has(Flags::REDIRECTS_CHILDREN | Flags::SKIPPED)
                        && tree.html_tag(it.node) != name!("p")
                        && it.style.display() == Display::Inline
                }
                ItemKind::Break => is_child(),
                kind => matches!(kind, ItemKind::Close(_) | ItemKind::Control),
            }
        };
        inline
            .is_plain
            .get_or_init(|| !inline.has_split_text && inline.items.iter().all(is_like_node))
            .then_some((lines, inline))
    }

    /// The texts and the line breaks, each with its style.
    fn plain_texts(&self, id: NodeId) -> Option<impl Iterator<Item = (&Item, &[u8], &Style)>> {
        let (inline, mut known) = (self.plain_lines(id)?.1, None);
        Some(
            inline
                .items
                .iter()
                .filter(|it| matches!(it.kind, ItemKind::Text | ItemKind::Break))
                .map(move |it| {
                    let style = known
                        .filter(|known: &(_, _)| {
                            known.0 == [it.parent, it.element] && it.kind == ItemKind::Text
                        })
                        .map_or_else(|| &**self.current_style(it), |it| it.1);
                    known = (it.kind == ItemKind::Text).then_some(([it.parent, it.element], style));
                    (
                        it,
                        &inline.text.as_bytes()[it.start as usize..it.end as usize],
                        style,
                    )
                }),
        )
    }

    fn hides_contents(&self, id: NodeId) -> bool {
        self.tree[id].has(crate::tree::Flags::SKIPPED) && !self.auto_visible.contains_key(&id)
    }

    pub(crate) fn forget_highlights(&mut self) {
        self.marks.styles.get_mut().clear();
        let marked: Vec<NodeId> = self.marks.marked.by_node.keys().copied().collect();
        for it in marked {
            self.repaint_marks(it);
        }
        if !self.marks.marked.selected.is_empty() {
            self.pictures.discard();
        }
    }

    fn repaint_marks(&mut self, node: NodeId) {
        let parent = self.tree.flat_parent(node);
        match self
            .tree
            .element(parent)
            .is_some_and(crate::svg::has_svg_children)
        {
            true => self.svg_changed(parent),
            false => self.repaint(parent),
        }
    }

    pub(crate) fn update_marks(&mut self) {
        if !core::mem::take(&mut self.marks.are_stale) {
            return;
        }
        let mut new = Marked::default();
        let highlights = self
            .marks
            .highlights
            .iter()
            .flat_map(|it| it.2.iter().map(|range| (it.0, range)));
        let selection = self
            .marks
            .selection
            .iter()
            .filter(|it| it[0] != it[1])
            .map(|it| (Mark::Selection, it));
        for (mark, range) in highlights.chain(selection) {
            let (mut previous, mut range) = (0, *range);
            loop {
                let mut last = 0;
                self.visit_range(&range, &mut |id, visit| match visit {
                    Visit::Text(span)
                        if mark == Mark::Selection
                            && self
                                .tree
                                .element(self.tree[id].parent)
                                .is_some_and(crate::svg::has_svg_children) =>
                    {
                        new.by_node
                            .entry(id)
                            .or_default()
                            .extend((!span.is_empty()).then_some((span, mark)));
                        false
                    }
                    Visit::Text(_) | Visit::Enter if self.tree[id].layout_box != 0 => {
                        // An open end: the range goes on after the text.
                        if let Some(it) = new
                            .by_node
                            .get_mut(&core::mem::take(&mut previous))
                            .and_then(|it| it.last_mut())
                        {
                            it.0.end = u32::MAX;
                        }
                        new.selected
                            .extend(Some(core::mem::take(&mut last)).filter(|it| *it != 0));
                        if let Visit::Text(span) = visit
                            && !span.is_empty()
                        {
                            new.by_node.entry(id).or_default().push((span, mark));
                            previous = id;
                        }
                        false
                    }
                    Visit::Inside
                        if mark == Mark::Selection
                            && self.tree[id].layout_box != 0
                            && !self.may_be_marked(id) =>
                    {
                        last = id;
                        true
                    }
                    Visit::Leave(true)
                        if mark != Mark::Composition
                            && self.may_be_marked(id)
                            && (mark == Mark::Selection
                                || self.tree.html_tag(id) != name!("br")) =>
                    {
                        new.by_node.entry(id).or_default().push((0..1, mark));
                        false
                    }
                    _ => false,
                });
                if last == 0 {
                    break;
                }
                range = self.contents_of(last);
            }
        }
        for all in new.by_node.values_mut().filter(|it| it.len() > 1) {
            all.chunk_by_mut(|a, b| a.1 == b.1)
                .for_each(|it| it.order_by_key(|it| it.0.start));
            all.dedup_by(|it, before| {
                let overlaps = it.1 == before.1 && it.0.start < before.0.end;
                before.0.end = if overlaps {
                    before.0.end.max(it.0.end)
                } else {
                    before.0.end
                };
                overlaps
            });
        }
        let old = core::mem::replace(&mut self.marks.marked, new);
        if self.marks.is_empty() {
            self.marks.styles.get_mut().clear();
        }
        let new = &self.marks.marked;
        let (mut changed, mut budget): (Vec<NodeId>, usize) = (
            old.by_node
                .keys()
                .chain(new.by_node.keys())
                .copied()
                .collect(),
            2048,
        );
        for id in old
            .selected
            .symmetric_difference(&new.selected)
            .filter(|it| self.tree.contains(**it))
        {
            self.visit_range(&self.contents_of(*id), &mut |id, _| {
                budget = budget.saturating_sub(1);
                changed.extend((budget > 0).then_some(id));
                budget == 0
            });
            if budget == 0 {
                return self.pictures.discard();
            }
        }
        changed.retain(|it| !old.of(self, *it).eq(new.of(self, *it)));
        for it in changed {
            self.repaint_marks(it);
        }
    }

    fn inline(&self, id: BoxId) -> Option<&Inline> {
        self.boxes[id].inline.as_deref()
    }

    /// The lines that have the node as text, as a line break or as an atomic inline.
    fn as_leaf(&self, id: NodeId) -> Option<(BoxId, &Item)> {
        let lines = match self.own_box(id) {
            Some(own) => self.boxes[own].parent,
            None => self.tree[id].layout_box,
        };
        Some((lines, self.inline(lines)?.leaf(id)?))
    }

    fn edge_place(&self, id: NodeId, last: bool) -> Option<Place> {
        if self.is_locked(id) {
            return None;
        }
        if let Some((lines, item)) = self.as_leaf(id) {
            let at = if last {
                item.clusters.end.min(self.inline(lines)?.last_place())
            } else {
                item.clusters.start
            };
            return Some(Place {
                lines,
                at,
                upstream: false,
            });
        }
        self.tree
            .style(id)
            .filter(|it| it.display() != Display::None && !it.is_out_of_flow())?;
        let mut children: SmallVec<[NodeId; 8]> = self.tree.flat_children(id).collect();
        if last {
            children.reverse();
        }
        children
            .into_iter()
            .find_map(|child| self.edge_place(child, last))
            .or_else(|| self.empty_place(id))
    }

    /// In an element that has no text.
    fn empty_place(&self, id: NodeId) -> Option<Place> {
        let Some(own) = self.own_box(id) else {
            let lines = self.tree[id].layout_box;
            let item = self
                .inline(lines)?
                .items
                .iter()
                .find(|it| it.stands_for(id))?;
            return Some(Place {
                lines,
                at: item.clusters.start.min(self.inline(lines)?.last_place()),
                upstream: false,
            });
        };
        let lines = self.boxes[own]
            .children
            .iter()
            .copied()
            .find(|it| self.boxes[*it].kind == Kind::Lines)?;
        Some(Place {
            lines,
            at: 0,
            upstream: false,
        })
    }

    /// The lines of skipped contents are for the text that they had.
    fn place_of(&self, mut point: Point, upstream: bool) -> Option<Place> {
        while !self.is_locked(point.node) {
            let node = &self.tree[point.node];
            if node.text().is_some() {
                let Some((lines, item)) = self.as_leaf(point.node) else {
                    point = Point {
                        node: node.parent,
                        offset: point.node,
                    };
                    continue;
                };
                let inline = self.inline(lines)?;
                let at = inline
                    .cluster_in(item, point.offset)
                    .min(inline.last_place());
                return Some(Place {
                    lines,
                    at,
                    upstream,
                });
            }
            let children: SmallVec<[NodeId; 8]> = match node.data {
                Data::ShadowRoot { .. } => self.tree.children(point.node).collect(),
                _ => self.tree.flat_children(point.node).collect(),
            };
            let (before, after) = children.split_at(
                children
                    .iter()
                    .position(|it| *it == point.offset)
                    .unwrap_or(children.len()),
            );
            let found = (after.iter().find_map(|it| self.edge_place(*it, false)))
                .or_else(|| {
                    before
                        .iter()
                        .rev()
                        .find_map(|it| self.edge_place(*it, true))
                })
                .or_else(|| self.empty_place(point.node));
            if found.is_some() || node.parent == 0 || self.own_box(point.node).is_some() {
                return found.map(|place| Place { upstream, ..place });
            }
            point = Point {
                node: node.parent,
                offset: node.next,
            };
        }
        None
    }

    fn is_generated(&self, node: NodeId) -> bool {
        [node, self.tree[node].parent]
            .into_iter()
            .any(|it| self.tree.element(it).is_some_and(|it| it.is_generated()))
    }

    /// The outermost element around the item that can not be edited, in lines that can.
    fn island(&self, lines: BoxId, inline: &Inline, item: &Item) -> Option<NodeId> {
        self.boxes[lines].style.is_editable().then_some(())?;
        let (mut key, mut found) = (
            item.parent,
            (item.element != 0 && !item.style.is_editable()).then_some(item.element),
        );
        while key != 0 {
            let around = &inline.items[key as usize - 1];
            found = (!around.style.is_editable())
                .then_some(around.node)
                .or(found);
            key = around.parent;
        }
        found
    }

    fn point_of(&self, place: Place) -> Option<Point> {
        let inline = self.inline(place.lines)?;
        let is_real = |it: &&Item| it.kind != ItemKind::Control && !self.is_generated(it.node);
        let before = (0..place.at)
            .rev()
            .filter_map(|it| inline.item_at(it))
            .find(|it| it.kind != ItemKind::Control);
        let after = (place.at..inline.clusters.len() as u32)
            .filter_map(|it| inline.item_at(it))
            .find(|it| it.kind != ItemKind::Control);
        let (before, after) = (before.filter(is_real), after.filter(is_real));
        let last_real = || {
            (0..place.at)
                .rev()
                .filter_map(|it| inline.item_at(it))
                .find(is_real)
        };
        let before = if after.is_none() {
            before.or_else(last_real)
        } else {
            before
        };
        let is_open_text = |it: &&Item| {
            it.kind == ItemKind::Text
                && self.tree[it.node].text().is_some()
                && self.island(place.lines, inline, it).is_none()
        };
        let follows_wrap = !place.upstream
            && inline.line_index(place.at, true) != inline.line_index(place.at, false);
        let before = before.filter(|_| !follows_wrap || !after.is_some_and(|it| is_open_text(&it)));
        let in_text = |it: &Item| Point {
            node: it.node,
            offset: inline.node_offset(it, inline.offset_of(place.at).min(it.end).max(it.start)),
        };
        let beside = |it: &Item, is_after: bool| {
            let node = self.island(place.lines, inline, it).unwrap_or(it.node);
            Point {
                node: self.tree[node].parent,
                offset: if is_after { self.tree[node].next } else { node },
            }
        };
        (before
            .filter(is_open_text)
            .or_else(|| after.filter(is_open_text))
            .map(in_text))
        .or_else(|| after.map(|it| beside(it, false)))
        .or_else(|| before.map(|it| beside(it, true)))
        .or_else(|| {
            inline
                .items
                .iter()
                .filter(is_real)
                .find(is_open_text)
                .map(|it| Point {
                    node: it.node,
                    offset: 0,
                })
        })
        .or_else(|| {
            let mut around = core::iter::successors(Some(place.lines), |it| {
                Some(self.boxes[*it].parent).filter(|it| *it != 0)
            });
            let node = around
                .by_ref()
                .map(|it| self.boxes[it].node)
                .find(|it| *it != 0 && !self.is_generated(*it))?;
            let first = self.tree[node].first_child;
            Some(if self.tree[first].text().is_some() {
                Point {
                    node: first,
                    offset: 0,
                }
            } else {
                Point {
                    node,
                    offset: first,
                }
            })
        })
    }

    fn caret_at(&self, place: Place) -> Option<Rect> {
        let (inline, it) = (self.inline(place.lines)?, &self.boxes[place.lines]);
        let line = inline
            .lines
            .lines
            .get(inline.line_index(place.at, place.upstream))?;
        let edge = |cluster: u32, is_after: bool| {
            inline
                .lines
                .fragments_of(line)
                .iter()
                .find_map(|fragment| match &fragment.kind {
                    FragmentKind::Text { clusters, rtl, .. } if clusters.contains(&cluster) => {
                        let (_, left, advance) =
                            inline.positions(fragment).find(|it| it.0 == cluster)?;
                        Some([
                            left + if is_after != *rtl { advance } else { 0.0 },
                            fragment.y,
                            fragment.height,
                        ])
                    }
                    FragmentKind::Atomic(_)
                        if inline.items[fragment.item as usize]
                            .clusters
                            .contains(&cluster) =>
                    {
                        Some([
                            fragment.x
                                + if is_after != line.rtl {
                                    fragment.width
                                } else {
                                    0.0
                                },
                            fragment.y,
                            fragment.height,
                        ])
                    }
                    _ => None,
                })
        };
        let is_atomic = |cluster: u32| {
            inline
                .item_at(cluster)
                .is_some_and(|it| matches!(it.kind, ItemKind::Atomic(_)))
        };
        let previous = place.at.checked_sub(1);
        let [x, y, height] = (previous
            .filter(|it| !is_atomic(*it))
            .and_then(|it| edge(it, true)))
        .or_else(|| edge(place.at, false))
        .or_else(|| edge(previous?, true))
        .unwrap_or_else(|| {
            let x = match (it.style.text.align, line.rtl) {
                (TextAlign::Center | TextAlign::WebkitCenter, _) => (line.left + line.right) / 2.0,
                (TextAlign::Right | TextAlign::WebkitRight, _)
                | (TextAlign::End, false)
                | (TextAlign::Start, true) => line.right,
                _ => line.left,
            };
            [
                x,
                line.baseline - it.style.metrics.ascent,
                it.style.metrics.ascent + it.style.metrics.descent,
            ]
        });
        let [along, across] = it.mode.turn_axes(it.size());
        let (width, bounds) = (
            1.0 / self.environment.zoom,
            inline
                .lines
                .bounds
                .union(&Rect::new([0.0, 0.0, along, across])),
        );
        let x = match line.rtl {
            true => (x - width).max(bounds.x),
            false => x.min(bounds.right() - width).max(line.left.min(x)),
        };
        Some(Rect::new([x, y, width, height]))
    }

    /// Relative to the border box of the box.
    pub(crate) fn caret_rect(&self, point: Point, upstream: bool) -> Option<(BoxId, Rect)> {
        match self.place_of(point, upstream) {
            Some(place) => Some((
                place.lines,
                self.from_lines(place.lines, self.caret_at(place)?),
            )),
            None => {
                let own = self.own_box(point.node)?;
                let ([x, y, width, _], Style { metrics, .. }) =
                    (self.content_box(own), &*self.boxes[own].style);
                let indent = Some(&self.boxes[own].style.text.indent)
                    .filter(|it| !it.hangs)
                    .map_or(0.0, |it| it.length.resolve(width));
                Some((
                    own,
                    Rect::new([x + indent, y, 1.0, metrics.ascent + metrics.descent]),
                ))
            }
        }
    }

    pub(crate) fn caret_to_paint(&self) -> Option<(BoxId, Rect)> {
        let (point, upstream) = (self.marks.selection?[1], self.marks.caret?);
        let (id, bar) = self.caret_rect(point, upstream)?;
        let style = self.inherited_style(id);
        let Some(shape) = style
            .other_if_set(crate::properties::Id::CaretShape)
            .filter(|it| *it != "bar")
        else {
            return Some((id, bar));
        };
        let shaped = |it: Rect| match shape {
            "block" => it,
            _ => Rect {
                y: it.bottom() - bar.width.min(bar.height),
                height: bar.width.min(bar.height),
                ..it
            },
        };
        let Some(place) = self.place_of(point, upstream) else {
            return Some((
                id,
                shaped(Rect {
                    width: style.metrics.zero_advance,
                    ..bar
                }),
            ));
        };
        let inline = self.inline(id)?;
        let line = inline
            .lines
            .lines
            .get(inline.line_index(place.at, place.upstream))?;
        let next = inline
            .lines
            .fragments_of(line)
            .iter()
            .filter(|it| matches!(it.kind, FragmentKind::Text { .. }))
            .find_map(|fragment| {
                let (_, x, advance) = inline
                    .positions(fragment)
                    .find(|it| it.0 == place.at && it.2 > 0.0)?;
                Some(Rect::new([x, fragment.y, advance, fragment.height]))
            });
        let after = || {
            let bar = self.caret_at(place)?;
            let is_pushed_back =
                !line.rtl && bar.right() >= inline.lines.bounds.right() && bar.x > line.left;
            let x = if line.rtl {
                bar.right() - style.metrics.zero_advance
            } else if is_pushed_back {
                bar.right()
            } else {
                bar.x
            };
            Some(Rect {
                x,
                width: style.metrics.zero_advance,
                ..bar
            })
        };
        Some((id, self.from_lines(id, shaped(next.or_else(after)?))))
    }

    fn place_on_line(&self, lines: BoxId, line: &Line, x: f32) -> Option<Place> {
        let inline = self.inline(lines)?;
        let edges = inline.lines.fragments_of(line).iter().flat_map(|fragment| {
            let (item, rtl) = (
                &inline.items[fragment.item as usize],
                matches!(fragment.kind, FragmentKind::Text { rtl: true, .. }),
            );
            let atomic = matches!(fragment.kind, FragmentKind::Atomic(_)).then_some((
                item.clusters.start,
                fragment.x,
                fragment.width,
            ));
            let is_inside_island = self.island(lines, inline, item).is_some();
            let pieces = inline
                .positions(fragment)
                .chain(atomic)
                .filter(move |it| !is_inside_island || it.0 == item.clusters.start);
            pieces.flat_map(move |(at, left, advance)| {
                match (rtl || atomic.is_some() && line.rtl, is_inside_island) {
                    (_, true) => [
                        (item.clusters.start, fragment.x),
                        (item.clusters.end, fragment.x + fragment.width),
                    ],
                    (false, _) => [(at, left), (at + 1, left + advance)],
                    (true, _) => [(at, left + advance), (at + 1, left)],
                }
            })
        });
        let (end, wraps) = inline.line_end(line);
        let nearest = edges
            .filter(|it| it.0 <= end)
            .min_by(|a, b| (a.1 - x).abs().total_cmp(&(b.1 - x).abs()));
        let at = nearest.map_or(line.clusters.start, |it| it.0);
        Some(Place {
            lines,
            at,
            upstream: wraps && at == end,
        })
    }

    fn point_in_box(&self, id: BoxId, point: [f32; 2]) -> Option<(Point, bool)> {
        let it = &self.boxes[id];
        let local = |id: BoxId| {
            apply(
                &invert(&self.lines_to_viewport(id)).unwrap_or(IDENTITY),
                point,
            )
        };
        let [x, y] = local(id);
        if let Some(inline) = &it.inline {
            let mut lines = inline.lines.lines.iter().filter(|it| it.height > 0.0);
            let (first, found) = (
                lines.clone().next()?,
                lines.clone().find(|line| {
                    if it.mode.flips_lines() {
                        y >= line.y
                    } else {
                        y < line.y + line.height
                    }
                }),
            );
            if !cfg!(windows) && !it.mode.flips_lines() && (found.is_none() || y < first.y) {
                let at = if found.is_none() {
                    inline.last_place()
                } else {
                    first.clusters.start
                };
                return Some((
                    self.point_of(Place {
                        lines: id,
                        at,
                        upstream: false,
                    })?,
                    false,
                ));
            }
            let line = found.or_else(|| lines.next_back())?;
            for fragment in inline.lines.fragments_of(line) {
                if let FragmentKind::Atomic(child) = fragment.kind
                    && fragment.rect().contains([x, y])
                    && !self.is_generated(self.boxes[child].node)
                    && self.boxes[child].kind != Kind::Replaced
                    && self.boxes[child].style.is_editable() == it.style.is_editable()
                    && let Some(found) = self.point_in_box(child, point)
                {
                    return Some(found);
                }
            }
            let place = self.place_on_line(id, line, x)?;
            return Some((self.point_of(place)?, place.upstream));
        }
        let distance = |child: &BoxId| {
            let rect = self
                .border_box(*child)
                .moved(self.offset_in_container(*child));
            let outside = |at: f32, [start, end]: [f32; 2]| (start - at).max(at - end).max(0.0);
            match it.kind == Kind::Block
                && !it.mode.is_vertical()
                && !self.boxes[*child].style.is_floating()
            {
                true if y < rect.bottom() => 0.0,
                _ => outside(y, rect.span(1)) * 4096.0 + outside(x, rect.span(0)),
            }
        };
        let candidates = (it.children.iter().copied())
            .filter(|child| !self.boxes[*child].style.is_out_of_flow())
            .filter(|child| {
                self.boxes[*child].layout.size.height > 0.0
                    || self.boxes[*child]
                        .children
                        .iter()
                        .any(|it| self.boxes[*it].style.is_floating())
            })
            .filter(|child| !self.is_generated(self.boxes[*child].node));
        let point_in = |child: BoxId| {
            let own = &self.boxes[child];
            if own.is_replaced() || it.style.is_editable() && !own.style.is_editable() {
                let is_after = local(child)[1] > own.layout.size.height / 2.0;
                let (parent, next) = (self.tree[own.node].parent, self.tree[own.node].next);
                return Some((
                    Point {
                        node: parent,
                        offset: if is_after { next } else { own.node },
                    },
                    false,
                ));
            }
            if own.tag == name!("hr") {
                let parent = self.tree[own.node].parent;
                return self.own_box(parent).map(|_| {
                    (
                        Point {
                            node: parent,
                            offset: own.node,
                        },
                        false,
                    )
                });
            }
            self.point_in_box(child, point)
        };
        let mut others = Vec::new();
        let found = candidates.map(|it| (distance(&it), it)).find_map(|it| {
            if it.0 == 0.0 {
                return point_in(it.1);
            }
            others.push(it);
            None
        });
        let found = found.or_else(|| {
            others.order_by(|a, b| a.0.total_cmp(&b.0));
            others.into_iter().find_map(|it| point_in(it.1))
        });
        found.or_else(|| {
            (it.node != 0 && !it.is_replaced()).then(|| {
                (
                    Point {
                        node: it.node,
                        offset: self.tree[it.node].first_child,
                    },
                    false,
                )
            })
        })
    }

    /// Also in what cannot be selected.
    pub(crate) fn any_point_at(&self, point: [f32; 2]) -> Option<Point> {
        let hit = self.nodes_at(point).next().unwrap_or(DOCUMENT);
        if self
            .tree
            .element(hit)
            .is_some_and(|it| it.namespace == Namespace::Svg || it.tag == name!("canvas"))
        {
            return Some(Point {
                node: hit,
                offset: self.tree[hit].first_child,
            });
        }
        let (found, start) = (
            self.nearest_point(DOCUMENT, point)?.0,
            Point {
                node: hit,
                offset: 0,
            },
        );
        let place = |it: Point| self.place_of(it, false).map(|it| (it.lines, it.at));
        Some(
            if self.tree[hit].text().is_some()
                && !self.is_generated(hit)
                && place(start) == place(found)
            {
                start
            } else {
                found
            },
        )
    }

    fn nearest_point(&self, root: NodeId, point: [f32; 2]) -> Option<(Point, bool)> {
        let is_inside =
            |id: &NodeId| *id == root || self.tree.flat_ancestors(*id).any(|it| it == root);
        let hit = self
            .nodes_at(point)
            .next()
            .filter(is_inside)
            .unwrap_or(root);
        let hit = self
            .tree
            .flat_ancestors(hit)
            .find(|it| {
                self.boxes[self.tree[*it].layout_box].kind == Kind::Replaced && is_inside(it)
            })
            .unwrap_or(hit);
        let is_editable = |id: NodeId| self.tree.style(id).is_some_and(|it| it.is_editable());
        let mut around = core::iter::once(hit).chain(self.tree.flat_ancestors(hit));
        let start = around.find_map(|it| {
            let id = Some(self.tree[it].layout_box).filter(|it| {
                *it != 0 && !self.boxes[*it].is_replaced() && self.boxes[*it].tag != name!("hr")
            })?;
            (!self.is_generated(it)
                && (!is_editable(root) || self.boxes[id].style.is_editable() || it == root))
                .then_some(id)
        });
        let found = self.point_in_box(start?, point)?;
        Some((self.inside(root, found.0), found.1))
    }

    pub(crate) fn point_at(&self, root: NodeId, point: [f32; 2]) -> Option<(Point, bool)> {
        let found = self.nearest_point(root, point)?;
        let Some(place) = self
            .place_of(found.0, found.1)
            .filter(|it| !self.is_selectable(it.lines, it.at..it.at + 1))
        else {
            return Some(found);
        };
        let [before, after] =
            [false, true].map(|forward| self.selectable_beside(root, place, forward));
        let near = match (before, after) {
            (Some(before), Some(after))
                if before.lines == place.lines && after.lines != place.lines =>
            {
                before
            }
            _ => after.or(before)?,
        };
        Some((self.point_of(near)?, false))
    }

    /// An inline root shares its lines with what is around it.
    fn inside(&self, root: NodeId, point: Point) -> Point {
        if root == DOCUMENT
            || self.own_box(root).is_some()
            || point.node == root
            || self.tree.flat_ancestors(point.node).any(|it| it == root)
        {
            return point;
        }
        let places = (self.place_of(point, false), self.edge_place(root, false));
        let is_before = matches!(places, (Some(place), Some(first)) if place.lines == first.lines && place.at <= first.at);
        let mut leaves = self
            .tree
            .descendants(root)
            .filter(|it| !self.is_locked(*it))
            .filter_map(|it| self.as_leaf(it));
        let leaf = if is_before {
            leaves.next()
        } else {
            leaves.last()
        };
        let text = leaf
            .filter(|it| it.1.kind == ItemKind::Text)
            .and_then(|(lines, item)| {
                Some(Point {
                    node: item.node,
                    offset: self
                        .inline(lines)?
                        .node_offset(item, if is_before { item.start } else { item.end }),
                })
            });
        text.unwrap_or(Point {
            node: root,
            offset: if is_before {
                self.tree[root].first_child
            } else {
                0
            },
        })
    }

    /// Whether there is nothing next to the places, or something that can be selected.
    fn is_selectable(&self, lines: BoxId, places: Span<u32>) -> bool {
        let Some(inline) = self.inline(lines) else {
            return true;
        };
        let mut items = (places.start.saturating_sub(1)..places.end)
            .filter_map(|it| inline.item_at(it))
            .peekable();
        items.peek().is_none()
            || items
                .map(|it| self.current_style(it))
                .any(|it| it.ink.user_select != UserSelect::None || it.is_editable())
    }

    fn selectable_beside(&self, root: NodeId, place: Place, forward: bool) -> Option<Place> {
        let root = self.tree[root].layout_box;
        let find = |lines: &BoxId| {
            let (last, is_own) = (self.inline(*lines)?.last_place(), *lines == place.lines);
            let at = match forward {
                true => (if is_own { place.at + 1 } else { 0 }..=last)
                    .find(|it| self.is_selectable(*lines, *it..*it + 1)),
                false => (0..if is_own { place.at } else { last + 1 })
                    .rfind(|it| self.is_selectable(*lines, *it..*it + 1)),
            };
            Some(Place {
                lines: *lines,
                at: at?,
                upstream: false,
            })
        };
        self.lines_from(root, place.lines, forward)
            .find_map(|it| find(&it))
    }

    fn may_have_caret(&self, id: BoxId, root: BoxId) -> bool {
        (self.boxes[id].style.is_editable() || !self.boxes[root].style.is_editable())
            && !self.is_generated(self.boxes[id].node)
    }

    /// The first or the last ones that the caret can be in.
    fn lines_in(&self, id: BoxId, root: BoxId, forward: bool) -> Option<BoxId> {
        self.may_have_caret(id, root).then_some(())?;
        match &self.boxes[id].inline {
            Some(inline) => inline
                .lines
                .lines
                .iter()
                .any(|it| it.height > 0.0)
                .then_some(id),
            None => self.lines_among(&self.boxes[id].children, root, forward),
        }
    }

    fn lines_among(&self, boxes: &[BoxId], root: BoxId, forward: bool) -> Option<BoxId> {
        let find = |it: &BoxId| self.lines_in(*it, root, forward);
        if forward {
            boxes.iter().find_map(find)
        } else {
            boxes.iter().rev().find_map(find)
        }
    }

    /// `first` and those after or before it. None if `lines_in` does not lead to it.
    fn lines_from(
        &self,
        root: BoxId,
        first: BoxId,
        forward: bool,
    ) -> impl Iterator<Item = BoxId> + '_ {
        let up = move |id: BoxId| {
            core::iter::successors(Some(id), move |it| {
                Some(self.boxes[*it].parent).filter(|parent| *it != root && *parent != 0)
            })
        };
        let is_among = self.lines_in(first, root, forward) == Some(first)
            && up(first).last() == Some(root)
            && up(first)
                .skip(1)
                .all(|it| self.boxes[it].inline.is_none() && self.may_have_caret(it, root))
            && up(first)
                .zip(up(first).skip(1))
                .all(|(it, parent)| self.boxes[parent].children.contains(&it));
        core::iter::successors(is_among.then_some(first), move |at| {
            up(*at).zip(up(*at).skip(1)).find_map(|(it, parent)| {
                let siblings = &self.boxes[parent].children;
                let index = siblings.iter().position(|sibling| *sibling == it)?;
                self.lines_among(
                    if forward {
                        &siblings[index + 1..]
                    } else {
                        &siblings[..index]
                    },
                    root,
                    forward,
                )
            })
        })
    }

    fn step(&self, place: Place, forward: bool) -> Option<Place> {
        let inline = self.inline(place.lines)?;
        let mut at = place.at;
        loop {
            let crossed = if forward { at } else { at.checked_sub(1)? };
            at = if forward {
                Some(at + 1).filter(|it| *it <= inline.last_place())?
            } else {
                crossed
            };
            let item = inline.item_at(crossed)?;
            let island = |cluster: u32| self.island(place.lines, inline, inline.item_at(cluster)?);
            let next = if forward { Some(at) } else { at.checked_sub(1) };
            let is_inside_island =
                island(crossed).is_some() && next.and_then(island) == island(crossed);
            if item.kind != ItemKind::Control && !self.is_generated(item.node) && !is_inside_island
            {
                return Some(Place {
                    at,
                    upstream: false,
                    ..place
                });
            }
        }
    }

    pub(crate) fn move_point(
        &self,
        root: NodeId,
        from: Point,
        upstream: bool,
        direction: u8,
        granularity: u8,
        x: f32,
    ) -> Option<(Point, bool)> {
        let place = self.place_of(from, upstream)?;
        let inline = self.inline(place.lines)?;
        let forward = match direction {
            0 | 1 => direction == 0,
            _ => (direction == 3) != self.boxes[place.lines].style.is_rtl(),
        };
        let root_box = self.tree[root].layout_box;
        let neighbor = core::cell::LazyCell::new(|| {
            self.lines_from(root_box, place.lines, forward)
                .take(2)
                .nth(1)
        });
        let edge = |lines: BoxId, last: bool| {
            Some(Place {
                lines,
                at: if last {
                    self.inline(lines)?.last_place()
                } else {
                    0
                },
                upstream: false,
            })
        };
        let across = || edge((*neighbor)?, !forward);
        let here = |at: u32| Place {
            at,
            upstream: false,
            ..place
        };
        let line_index = inline.line_index(place.at, place.upstream);
        let paragraph_edge = |from: u32| match forward {
            true => (from..inline.last_place())
                .find(|it| inline.is_newline(*it))
                .unwrap_or_else(|| inline.last_place()),
            false => (0..from)
                .rev()
                .find(|it| inline.is_newline(*it))
                .map_or(0, |it| it + 1),
        };
        let x = if x.is_nan() {
            self.caret_at(place)?
                .transformed(&self.to_viewport(place.lines))
                .x
        } else {
            x
        };
        let moved = match granularity {
            0 => self.step(place, forward).or_else(across).unwrap_or(place),
            1 => {
                let crossed = |at: u32| {
                    if forward {
                        Some(at).filter(|it| *it < inline.last_place())
                    } else {
                        at.checked_sub(1)
                    }
                };
                let skip = |mut at: u32, accepts: &dyn Fn(Class) -> bool| {
                    while crossed(at).is_some_and(|it| accepts(inline.class(it))) {
                        at = if forward { at + 1 } else { at - 1 };
                    }
                    at
                };
                let skip_word = |at: u32| {
                    let class = crossed(at)
                        .map(|it| inline.class(it))
                        .filter(|it| *it != Class::Space);
                    skip(at, &|it| Some(it) == class)
                };
                let at = match cfg!(windows) && forward {
                    true => skip(skip_word(skip(place.at, &|it| it == Class::Other)), &|it| {
                        it == Class::Space
                    }),
                    false => skip_word(skip(place.at, &|it| {
                        matches!(it, Class::Space | Class::Other)
                    })),
                };
                if at == place.at {
                    across().unwrap_or(place)
                } else {
                    here(at)
                }
            }
            2 => {
                let lines = &inline.lines.lines;
                let near = match forward {
                    true => lines[line_index + 1..].iter().find(|it| it.height > 0.0),
                    false => lines[..line_index].iter().rfind(|it| it.height > 0.0),
                };
                let far = || {
                    let mut lines = self
                        .inline((*neighbor)?)?
                        .lines
                        .lines
                        .iter()
                        .filter(|it| it.height > 0.0);
                    Some((
                        (*neighbor)?,
                        if forward {
                            lines.next()
                        } else {
                            lines.next_back()
                        }?,
                    ))
                };
                match near.map(|it| (place.lines, it)).or_else(far) {
                    Some((id, line)) => self.place_on_line(
                        id,
                        line,
                        apply(&invert(&self.to_viewport(id))?, [x, 0.0])[0],
                    )?,
                    None => edge(place.lines, forward)?,
                }
            }
            3 if forward => {
                let (at, upstream) = inline.line_end(&inline.lines.lines[line_index]);
                Place {
                    at,
                    upstream,
                    ..place
                }
            }
            3 => here(inline.lines.lines[line_index].clusters.start),
            4 if paragraph_edge(place.at) == place.at => {
                let next = self.step(place, forward).or_else(across).unwrap_or(place);
                return self.move_point(
                    root,
                    self.point_of(next)?,
                    false,
                    u8::from(!forward),
                    5,
                    x,
                );
            }
            4 | 5 => here(paragraph_edge(place.at)),
            6 => edge(self.lines_in(root_box, root_box, !forward)?, forward)?,
            7 => {
                let scroller = self
                    .boxes
                    .containers(place.lines)
                    .find(|it| self.boxes[*it].scrolls())?;
                let caret = self
                    .caret_at(place)?
                    .transformed(&self.to_viewport(place.lines));
                let page = self.client_box(scroller).height * if forward { 0.875 } else { -0.875 };
                return self.point_in_box(root_box, [x, caret.y + caret.height / 2.0 + page]);
            }
            _ => place,
        };
        Some((self.inside(root, self.point_of(moved)?), moved.upstream))
    }

    pub(crate) fn expand_point(
        &self,
        root: NodeId,
        point: Point,
        granularity: u8,
    ) -> Option<Range> {
        let place = self.place_of(point, false)?;
        let inline = self.inline(place.lines)?;
        let last = inline.last_place();
        let pivot = if place.at < last && !inline.is_newline(place.at) {
            place.at
        } else {
            place.at.saturating_sub(1)
        };
        let belongs = |at: &u32| {
            !inline.is_newline(*at)
                && (granularity == 1
                    || *at == pivot
                    || inline.class(*at) == inline.class(pivot)
                        && inline.class(pivot) != Class::Other)
        };
        let start = place.at.min(pivot + 1)
            - (0..place.at.min(pivot + 1))
                .rev()
                .take_while(belongs)
                .count() as u32;
        let end = start + (start..last).take_while(belongs).count() as u32;
        let first = inline
            .item_at(start)
            .filter(|it| it.kind == ItemKind::Text && !self.is_generated(it.node));
        let first = first.map(|it| Point {
            node: it.node,
            offset: inline.node_offset(it, inline.offset_of(start)),
        });
        let end = Place { at: end, ..place };
        let is_editable = |it: Place| self.boxes[it.lines].style.is_editable();
        let next = || {
            self.selectable_beside(root, end, true)
                .filter(|it| is_editable(*it) == is_editable(end))
        };
        let end = if granularity == 1 {
            next().unwrap_or(end)
        } else {
            end
        };
        Some(
            [
                first.or_else(|| self.point_of(Place { at: start, ..place }))?,
                self.point_of(end)?,
            ]
            .map(|it| self.inside(root, it)),
        )
    }

    pub(crate) fn range_rects(&self, range: &Range) -> Vec<Rect> {
        let mut rects = Vec::new();
        let (mut entered, mut whole, mut known) = (Vec::new(), Vec::<(usize, NodeId)>::new(), None);
        let mut matrix_of = |lines: BoxId| {
            known
                .insert(
                    known
                        .filter(|it: &(BoxId, _)| it.0 == lines)
                        .unwrap_or_else(|| (lines, self.lines_to_viewport(lines))),
                )
                .1
        };
        let place = |lines: BoxId, matrix: &Matrix, it: Rect| match self.has_depth.get() {
            true => self.map_to_viewport(
                lines,
                self.line_matrix(lines)
                    .map_or(it, |turn| it.transformed(&turn)),
            ),
            false => it.transformed(matrix),
        };
        let mut add = |id: NodeId, visit: Visit| {
            match visit {
                Visit::Enter => entered.push((rects.len(), whole.len())),
                Visit::Inside => {
                    let (lines, inline) = self
                        .plain_lines(id)
                        .filter(|it| !it.1.has_bidi && !self.boxes[it.0].style.is_rtl())?;
                    let (is_text, matrix) = (
                        |it: &&Fragment| inline.items[it.item as usize].kind == ItemKind::Text,
                        matrix_of(lines),
                    );
                    inline.rects_of_text(
                        inline.lines.fragments.iter().filter(is_text),
                        &(0..u32::MAX),
                        |it| rects.push(place(lines, &matrix, it)),
                    );
                    return Some(());
                }
                Visit::Leave(false) => {}
                Visit::Leave(true) => {
                    let (start, before) = entered.pop().unwrap_or_default();
                    whole.truncate(before);
                    whole.push((start, id));
                }
                Visit::Text(span) => {
                    let Some((lines, item)) = self.as_leaf(id) else {
                        rects.extend(self.svg_text_rects(id, &span).into_iter().flatten());
                        return None;
                    };
                    let (inline, matrix) = (self.inline(lines)?, matrix_of(lines));
                    if range[0] == range[1] {
                        let caret = self
                            .place_of(range[0], false)
                            .and_then(|it| self.caret_at(it));
                        rects.extend(
                            caret.map(|it| place(lines, &matrix, Rect { width: 0.0, ..it })),
                        );
                        return None;
                    }
                    let clusters =
                        inline.cluster_in(item, span.start)..inline.cluster_in(item, span.end);
                    let own = inline
                        .lines
                        .fragments_with(&clusters)
                        .iter()
                        .filter(|it| inline.items[it.item as usize].node == id);
                    inline
                        .rects_of_text(own, &clusters, |it| rects.push(place(lines, &matrix, it)));
                }
            }
            None
        };
        self.visit_range(range, &mut |id, visit| add(id, visit).is_some());
        if whole.is_empty() {
            return rects;
        }
        let (mut all, mut done) = (Vec::with_capacity(rects.len() + whole.len()), 0);
        for (index, id) in whole {
            all.extend_from_slice(&rects[core::mem::replace(&mut done, index)..index]);
            all.extend(self.client_rects(id));
        }
        all.extend_from_slice(&rects[done..]);
        all
    }

    pub(crate) fn is_inert(&self, id: NodeId, style: &Style) -> bool {
        let blocks = |it: &&NodeId| {
            self.tree
                .element(**it)
                .is_some_and(|it| it.state.intersects(State::MODAL | State::FULLSCREEN))
        };
        style.ink.interactivity != Interactivity::Auto
            || self
                .top_layer
                .iter()
                .rfind(blocks)
                .is_some_and(|top| !self.tree.flat_ancestors(id).any(|it| it == *top))
    }

    pub(crate) fn inner_text_if_rendered(&mut self, id: NodeId) -> Option<Vec<u8>> {
        const HAS_BOX_OR_STANDS_FOR_ONE: u32 = 1 | 1 << 6 | 1 << 8;
        self.catch_up_with_compositor();
        self.update_layout_for(id);
        (self.style_bits(id, HAS_BOX_OR_STANDS_FOR_ONE) & HAS_BOX_OR_STANDS_FOR_ONE != 0)
            .then(|| self.inner_text(id))
    }

    pub(crate) fn inner_text(&self, id: NodeId) -> Vec<u8> {
        let mut out = InnerText::default();
        if !self.tree[id].has(crate::tree::Flags::SKIPPED) && !self.is_in_skipped_contents(id) {
            self.collect_contents(id, &mut out);
        }
        out.text
    }

    fn collect_contents(&self, id: NodeId, out: &mut InnerText) {
        if self.tree.html_tag(id) != name!("select") {
            if let Some(texts) = self.plain_texts(id) {
                return texts
                    .filter(|it| it.2.is_visible())
                    .for_each(|it| out.push(it.1));
            }
            let children = self
                .tree
                .children(id)
                .take_while(|_| bun_core::StackCheck::init().is_safe_to_recurse());
            return children.for_each(|it| self.collect_rendered(it, out));
        }
        for item in self
            .tree
            .descendants(id)
            .filter(|it| is_name!(self.tree.html_tag(*it), "option" | "optgroup"))
        {
            out.require_breaks(1);
            if self.tree.html_tag(item) == name!("option") {
                let text: Vec<u8> = self
                    .tree
                    .descendants(item)
                    .filter_map(|it| self.tree[it].text())
                    .flatten()
                    .copied()
                    .collect();
                out.push(
                    crate::values::text(&text)
                        .split_ascii_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                        .as_bytes(),
                );
                out.require_breaks(1);
            }
        }
    }

    /// https://html.spec.whatwg.org/#rendered-text-collection-steps
    fn collect_rendered(&self, id: NodeId, out: &mut InnerText) {
        if let Some(text) = self.tree[id].text() {
            let Some((lines, item)) = self.as_leaf(id) else {
                return;
            };
            if let Some(inline) = self
                .inline(lines)
                .filter(|_| self.current_style(item).is_visible())
            {
                let [start, end] =
                    [0, text.len() as u32].map(|it| inline.text_offset(item, it) as usize);
                out.push(&inline.text.as_bytes()[start..end]);
            }
            return;
        }
        let Some(style) = self.tree.style(id).filter(|it| {
            it.display() != Display::None && !self.tree[id].has(crate::tree::Flags::SKIPPED)
        }) else {
            return;
        };
        if self.tree[id].layout_box == 0 || !style.is_visible() {
            if self.tree[id].layout_box != 0 || style.display() == Display::Contents {
                self.collect_contents(id, out);
            }
            return;
        }
        let (tag, display) = (self.tree.html_tag(id), style.display());
        let display_of = |id: NodeId| self.tree.style(id).map_or(Display::None, |it| it.display());
        let is_row = |id: NodeId| display_of(id) == Display::TableRow;
        let has_rows = |id: NodeId| {
            is_row(id)
                || display_of(id).is_row_group() && self.tree.element_children(id).any(is_row)
        };
        let is_internal = display.is_row_group()
            || matches!(
                display,
                Display::TableRow
                    | Display::TableCell
                    | Display::TableColumn
                    | Display::TableColumnGroup
            );
        let breaks = if tag == name!("p") {
            2
        } else {
            usize::from(!display.is_inline_level() && !is_internal)
        };
        out.require_breaks(breaks);
        self.collect_contents(id, out);
        let parent = self.tree[id].parent;
        if tag == name!("br") {
            out.push(b"\n");
        } else if display == Display::TableCell
            && self
                .tree
                .next_elements(id)
                .any(|it| display_of(it) == display)
        {
            out.push(b"\t");
        } else if display == Display::TableRow
            && (self.tree.next_elements(id).any(has_rows)
                || display_of(parent).is_row_group()
                    && self.tree.next_elements(parent).any(has_rows))
        {
            out.push(b"\n");
        }
        out.require_breaks(breaks);
    }

    pub(crate) fn rendered_text(&self, range: &Range, only_selectable: bool) -> Vec<u8> {
        let (mut out, mut breaks, mut trailing) = (Vec::new(), 0, (0, 0));
        let around_end: Vec<_> = core::iter::once(range[1].node)
            .chain(self.tree.flat_ancestors(range[1].node))
            .collect();
        let shows = |id: NodeId, style: &Style| {
            style.is_visible()
                && (!only_selectable
                    || (style.ink.user_select != UserSelect::None || style.is_editable())
                        && !self.is_inert(id, style))
        };
        let mut add = |id: NodeId, visit: Visit| {
            if only_selectable
                && !matches!(visit, Visit::Leave(_))
                && self.tree[id].layout_box != 0
                && around_end.contains(&id)
            {
                trailing = (out.len(), breaks);
            }
            let mut push = |text: &[u8], breaks: &mut usize| {
                if !text.is_empty() {
                    let count = core::mem::take(breaks);
                    out.extend(core::iter::repeat_n(
                        b'\n',
                        if out.is_empty() { 0 } else { count },
                    ));
                    out.extend_from_slice(text);
                }
            };
            if let Visit::Inside = visit {
                self.plain_texts(id)?
                    .filter(|it| it.0.kind == ItemKind::Break || shows(it.0.node, it.2))
                    .for_each(|it| push(it.1, &mut breaks));
                return Some(());
            }
            let Visit::Text(span) = visit else {
                let style = self
                    .tree
                    .style(id)
                    .filter(|_| self.tree[id].layout_box != 0)?;
                let (is_end, display) = (matches!(visit, Visit::Leave(_)), style.display());
                let has_next = |display| {
                    self.tree.next_elements(id).any(|it| {
                        self.tree
                            .style(it)
                            .is_some_and(|it| it.display() == display)
                    })
                };
                if self.tree.html_tag(id) == name!("br") {
                    push(if is_end { b"\n" } else { b"" }, &mut breaks);
                } else if display == Display::TableCell {
                    push(
                        if is_end && has_next(display) {
                            b"\t"
                        } else {
                            b""
                        },
                        &mut breaks,
                    );
                } else if self.tree.html_tag(id) == name!("p") && (is_end || !only_selectable) {
                    breaks = 2;
                } else if !display.is_inline_level()
                    && !display.is_row_group()
                    && (display != Display::TableRow || is_end)
                {
                    breaks = breaks.max(1);
                }
                return None;
            };
            let (lines, item) = self.as_leaf(id)?;
            let inline = self
                .inline(lines)
                .filter(|_| shows(id, self.current_style(item)))?;
            let [start, end] =
                [span.start, span.end].map(|it| inline.text_offset(item, it) as usize);
            push(&inline.text.as_bytes()[start..end], &mut breaks);
            None
        };
        self.visit_range(range, &mut |id, visit| add(id, visit).is_some());
        if !out.is_empty() && out.len() == trailing.0 {
            out.extend(core::iter::repeat_n(b'\n', trailing.1));
        }
        out
    }
}

#[derive(Default)]
struct InnerText {
    text: Vec<u8>,
    breaks: usize,
}

impl InnerText {
    fn require_breaks(&mut self, count: usize) {
        self.breaks = self.breaks.max(count);
    }

    fn push(&mut self, text: &[u8]) {
        if !text.is_empty() {
            let count = core::mem::take(&mut self.breaks);
            self.text.extend(core::iter::repeat_n(
                b'\n',
                if self.text.is_empty() { 0 } else { count },
            ));
            self.text.extend_from_slice(text);
        }
    }
}
