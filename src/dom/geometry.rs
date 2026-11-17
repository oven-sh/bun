//! Where boxes are.

use crate::abi::{Matrix, Rect};
use crate::boxes::{BoxId, Kind, VIEWPORT};
use crate::document::Document;
use crate::engine_event::ForNode;
use crate::inline::{Inline, ItemKind};
use crate::layout::margin;
use crate::layout::{at_least, at_most};
use crate::lines::{Fragment, FragmentKind};
use crate::name::{is_name, name};
use crate::properties::Id;
use crate::svg_values::TransformBox;
use crate::tree::{DOCUMENT, Flags, NodeId};
use crate::types::*;

impl Rect {
    pub(crate) fn new([x, y, width, height]: [f32; 4]) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[inline]
    pub(crate) fn from_edges(left: f32, top: f32, right: f32, bottom: f32) -> Rect {
        Rect::new([
            left,
            top,
            at_least(0.0, right - left),
            at_least(0.0, bottom - top),
        ])
    }

    pub(crate) fn right(&self) -> f32 {
        self.x + self.width
    }

    pub(crate) fn bottom(&self) -> f32 {
        self.y + self.height
    }

    pub(crate) fn span(&self, axis: usize) -> [f32; 2] {
        [[self.x, self.right()], [self.y, self.bottom()]][axis]
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.width <= 0.0 || self.height <= 0.0
    }

    pub(crate) fn moved(&self, [x, y]: [f32; 2]) -> Rect {
        Rect {
            x: self.x + x,
            y: self.y + y,
            ..*self
        }
    }

    /// By top, right, bottom and left.
    #[inline]
    pub(crate) fn shrunk(&self, [top, right, bottom, left]: [f32; 4]) -> Rect {
        Rect::from_edges(
            self.x + left,
            self.y + top,
            self.right() - right,
            self.bottom() - bottom,
        )
    }

    #[inline]
    pub(crate) fn grown(&self, by: f32) -> Rect {
        self.shrunk([-by; 4])
    }

    #[inline(always)]
    pub(crate) fn union(&self, other: &Rect) -> Rect {
        let (left, top) = (at_most(self.x, other.x), at_most(self.y, other.y));
        Rect::from_edges(
            left,
            top,
            at_least(self.right(), other.right()),
            at_least(self.bottom(), other.bottom()),
        )
    }

    #[inline]
    pub(crate) fn intersection(&self, other: &Rect) -> Rect {
        let (left, top) = (self.x.max(other.x), self.y.max(other.y));
        Rect::from_edges(
            left,
            top,
            self.right().min(other.right()),
            self.bottom().min(other.bottom()),
        )
    }

    /// Also at an edge.
    pub(crate) fn touches(&self, other: &Rect) -> bool {
        self.x <= other.right()
            && other.x <= self.right()
            && self.y <= other.bottom()
            && other.y <= self.bottom()
    }

    pub(crate) fn contains(&self, [x, y]: [f32; 2]) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }

    pub(crate) fn transformed(&self, matrix: &Matrix) -> Rect {
        if let [1.0, 0.0, 0.0, 1.0, x, y] = *matrix
            && self.width >= 0.0
            && self.height >= 0.0
        {
            return Rect::from_edges(self.x + x, self.y + y, self.right() + x, self.bottom() + y);
        }
        let corners = [
            [self.x, self.y],
            [self.right(), self.y],
            [self.x, self.bottom()],
            [self.right(), self.bottom()],
        ];
        let corners = corners.map(|corner| apply(matrix, corner));
        let [left, top] = corners.iter().fold([f32::MAX; 2], |it, corner| {
            [it[0].min(corner[0]), it[1].min(corner[1])]
        });
        let [right, bottom] = corners.iter().fold([f32::MIN; 2], |it, corner| {
            [it[0].max(corner[0]), it[1].max(corner[1])]
        });
        Rect::from_edges(left, top, right, bottom)
    }

    pub(crate) fn to_array(self) -> [f32; 4] {
        [self.x, self.y, self.width, self.height]
    }
}

pub(crate) fn translation([x, y]: [f32; 2]) -> Matrix {
    [1.0, 0.0, 0.0, 1.0, x, y]
}

fn clipped(rect: Rect, clip: Option<Rect>) -> Option<Rect> {
    clip.map_or(Some(rect), |it| {
        it.touches(&rect).then(|| rect.intersection(&it))
    })
}

/// What can be seen of the contents of a box.
#[derive(Clone, Copy)]
enum Shown {
    Nothing,
    /// Where the box is in the viewport, and what clips there.
    Moved([f32; 2], Rect),
    Transformed,
}

/// For as long as nothing changes.
pub(crate) struct ObservedRoot {
    id: BoxId,
    pub(crate) rect: Rect,
    to_viewport: Matrix,
    /// For the scroll containers on the way.
    scroll_margin: Outsets,
    known: crate::name::Map<BoxId, Shown>,
}

/// In pixels and as a fraction, at the top, right, bottom and left.
pub(crate) type Outsets = [[f32; 2]; 4];

fn outset(rect: Rect, by: &Outsets) -> [f32; 4] {
    [0, 1, 2, 3].map(|side| -by[side][0] - by[side][1] * [rect.height, rect.width][side % 2])
}

impl ObservedRoot {
    pub(crate) fn with_margins(self, margin: &Outsets, scroll_margin: Outsets) -> ObservedRoot {
        let rect = self
            .rect
            .shrunk(outset(self.rect, margin))
            .shrunk(outset(self.rect, &scroll_margin));
        ObservedRoot {
            rect,
            scroll_margin,
            ..self
        }
    }
}

/// How far a sticky box would move if nothing were scrolled, and how far it can.
#[derive(Clone, Copy)]
pub(crate) struct Sticky {
    back: Option<(f32, f32)>,
    forth: Option<(f32, f32)>,
}

impl Sticky {
    pub(crate) fn offset(&self, scroll: f32) -> f32 {
        let forth = self
            .forth
            .map_or(0.0, |(by, limit)| (by + scroll).max(0.0).min(limit));
        if forth > 0.0 {
            forth
        } else {
            self.back
                .map_or(0.0, |(by, limit)| (by + scroll).min(0.0).max(limit))
        }
    }
}

impl Fragment {
    pub(crate) fn rect(&self) -> Rect {
        Rect::new([self.x, self.y, self.width, self.height])
    }
}

impl Document {
    #[inline]
    pub(crate) fn border_box(&self, id: BoxId) -> Rect {
        let size = self.boxes[id].layout.size;
        Rect::new([0.0, 0.0, size.width, size.height])
    }

    /// What the scrollbars take from the top, right, bottom and left of the padding box.
    #[inline]
    pub(crate) fn gutters(&self, id: BoxId) -> [f32; 4] {
        self.boxes[id].gutters().to_array()
    }

    /// The padding box without the scrollbars.
    #[inline]
    pub(crate) fn client_box(&self, id: BoxId) -> Rect {
        self.border_box(id)
            .shrunk(self.boxes[id].border())
            .shrunk(self.gutters(id))
    }

    pub(crate) fn content_box(&self, id: BoxId) -> [f32; 4] {
        let inset = self.boxes[id].layout.border + self.boxes[id].layout.padding;
        let content =
            self.border_box(id)
                .shrunk([inset.top, inset.right, inset.bottom, inset.left]);
        content.shrunk(self.gutters(id)).to_array()
    }

    /// For `scroll`, or else for the offset that the scroller has.
    pub(crate) fn sticky_offset(&self, id: BoxId, scroll: Option<[f32; 2]>) -> [f32; 2] {
        let (sticky, scroller) = self.sticky(id, scroll);
        let scroll = scroll.unwrap_or_else(|| self.scroll_offset(self.boxes[scroller].node));
        [0, 1].map(|axis| sticky[axis].offset(scroll[axis]))
    }

    /// With the scroller. `scroll` only matters if a container is sticky too.
    pub(crate) fn sticky(&self, id: BoxId, scroll: Option<[f32; 2]>) -> ([Sticky; 2], BoxId) {
        let it = &self.boxes[id];
        let (mut rect, mut limits) = (
            self.border_box(id)
                .moved([it.layout.location.x, it.layout.location.y]),
            None,
        );
        let (mut scroller, mut is_fixed) = (VIEWPORT, false);
        for container in self.boxes.containers(id) {
            let is_block = !matches!(
                self.boxes[container].kind,
                Kind::Lines | Kind::Row | Kind::RowGroup
            );
            if limits.is_none() && is_block {
                let mut content = Rect::new(self.content_box(container));
                if self.boxes[container].scrolls() {
                    let (range, padding) = (
                        self.scroll_range(container),
                        self.boxes[container].layout.padding,
                    );
                    content =
                        content.shrunk([range[1][0], -range[0][1], -range[1][1], range[0][0]]);
                    content.height += padding.bottom * f32::from(container == VIEWPORT);
                }
                limits = Some(content);
            }
            if self.boxes[container].scrolls() {
                scroller = container;
                break;
            }
            is_fixed |= self.is_fixed_to_viewport(container);
            let offset = self.unscrolled_offset(container, scroll);
            (rect, limits) = (rect.moved(offset), limits.map(|it| it.moved(offset)));
        }
        let (margin, padding) = (
            margin(&it.style, self.content_box(it.container)[2]),
            self.boxes[scroller].layout.padding,
        );
        let limits = limits.unwrap_or_default().shrunk([
            margin.top,
            margin.right,
            margin.bottom,
            margin.left,
        ]);
        let view = self.client_box(scroller).shrunk([
            padding.top,
            padding.right,
            padding.bottom,
            padding.left,
        ]);
        let l = &it.style.layout;
        let sticky = [0, 1].map(|axis| {
            let ([start, end], [min, max], [near, far]) =
                (rect.span(axis), limits.span(axis), view.span(axis));
            let inset = |inset: &Inset| match inset {
                Inset::Length(length) => Some(length.resolve(far - near)),
                _ => None,
            };
            let [mut before, mut after] =
                [[&l.left, &l.right], [&l.top, &l.bottom]][axis].map(inset);
            if let (Some(first), Some(last)) = (&mut before, &mut after) {
                let missing = (end - start - (far - near - *first - *last)).max(0.0);
                *(if self.boxes[scroller].starts_far(axis) {
                    first
                } else {
                    last
                }) -= missing;
            }
            Sticky {
                back: after.map(|it| (far - it - end, (min - start).min(0.0))),
                forth: before.map(|it| (near + it - start, (max - end).max(0.0))),
            }
        });
        let still = |it: Sticky| Sticky {
            back: Some((f32::MIN, it.offset(0.0).min(0.0))),
            forth: Some((f32::MAX, it.offset(0.0).max(0.0))),
        };
        (if is_fixed { sticky.map(still) } else { sticky }, scroller)
    }

    pub(crate) fn unscrolled_offset(&self, id: BoxId, scroll: Option<[f32; 2]>) -> [f32; 2] {
        let it = &self.boxes[id];
        let shift = match it.style.layout.position {
            PositionKind::Sticky => self.sticky_offset(id, scroll),
            _ if it.anchored.is_some() => {
                self.anchored.get(&it.node).map_or([0.0; 2], |it| it.shift)
            }
            _ => [0.0; 2],
        };
        [
            it.layout.location.x + shift[0],
            it.layout.location.y + shift[1],
        ]
    }

    pub(crate) fn is_fixed_to_viewport(&self, id: BoxId) -> bool {
        let it = &self.boxes[id];
        it.container == VIEWPORT && it.style.layout.position == PositionKind::Fixed
    }

    /// From the border box of the container to its own.
    pub(crate) fn offset_in_container(&self, id: BoxId) -> [f32; 2] {
        let ([x, y], container) = (
            self.unscrolled_offset(id, None),
            &self.boxes[self.boxes[id].container],
        );
        match container.scrolls() && !self.is_fixed_to_viewport(id) && !self.is_legend(id) {
            true => {
                let scroll = self.scroll_offset(container.node);
                [x - scroll[0], y - scroll[1]]
            }
            false => [x, y],
        }
    }

    pub(crate) fn own_transform(&self, id: BoxId) -> Option<Matrix> {
        let it = &self.boxes[id];
        if it.style.effects.transform_box != TransformBox::ViewBox
            || it.style.other_if_set(Id::OffsetPath).is_some()
        {
            return self.own_transform_3d(id).map(|it| {
                crate::three_d::affine(&it).unwrap_or_else(|| crate::transform::flattened(&it))
            });
        }
        (it.style.has_transform() && !it.is_foreign_object).then(|| {
            it.style
                .transform(it.layout.size.width, it.layout.size.height)
        })
    }

    /// What `to_container` comes down to for most.
    #[inline]
    fn plain_offset(&self, id: BoxId) -> Option<[f32; 2]> {
        let it = &self.boxes[id];
        (it.style.is_plain() && it.anchored.is_none() && !it.is_foreign_object).then(|| match self
            .boxes[it.container]
            .scrolls()
        {
            true => self.offset_in_container(id),
            false => [it.layout.location.x, it.layout.location.y],
        })
    }

    pub(crate) fn to_container(&self, id: BoxId) -> Matrix {
        if let Some(offset) = self.plain_offset(id) {
            return translation(offset);
        }
        let mut offset = translation(self.offset_in_container(id));
        if self.boxes[id].is_foreign_object {
            offset = multiply(&self.foreign_matrix(id), &offset);
        }
        self.own_transform(id)
            .map_or(offset, |own| multiply(&offset, &own))
    }

    /// From the coordinates of the border box.
    pub(crate) fn to_viewport(&self, id: BoxId) -> Matrix {
        let inside = core::iter::once(id)
            .chain(self.boxes.containers(id))
            .take_while(|it| *it != VIEWPORT);
        inside.fold(IDENTITY, |[a, b, c, d, e, f], id| {
            match self.plain_offset(id) {
                Some([x, y]) => [a, b, c, d, e + x, f + y],
                None => multiply(&self.to_container(id), &[a, b, c, d, e, f]),
            }
        })
    }

    /// The boxes whose lines have the text or the inline element.
    pub(crate) fn lines_with(&self, node: NodeId) -> impl Iterator<Item = (BoxId, &Inline)> + '_ {
        let first = self.tree[node].layout_box;
        let is_split = self.boxes[first].inline.as_ref().is_some_and(|inline| {
            inline
                .items
                .iter()
                .any(|it| it.node == node && it.kind == ItemKind::Close(false))
        });
        let siblings = if is_split {
            &self.boxes[self.boxes[first].parent].children[..]
        } else {
            &[]
        };
        let later = siblings
            .iter()
            .copied()
            .skip_while(move |it| *it != first)
            .skip(1);
        core::iter::once(first)
            .chain(later)
            .filter_map(|id| Some((id, self.boxes[id].inline.as_deref()?)))
    }

    /// Lays out what `content-visibility` skips, if the node is in it.
    pub(crate) fn update_layout_for(&mut self, node: NodeId) {
        if !self.needs_layout && self.moved_boxes.is_empty() && self.has_current_styles() {
            crate::layout::set_scale_of_units(self.environment.scale);
            return self.request_fonts();
        }
        self.stop_lagging(node);
        self.force(node, Document::update_forced_layout);
    }

    pub(crate) fn set_skipped(&mut self, id: NodeId, skipped: bool) {
        match skipped {
            true => self.lock(id, self.tree.style(id).cloned()),
            false => {
                self.unlock(id);
                self.tree.dirty_child(id).set(0);
                self.tree.mark_style(id, Flags::DIRTY_DESCENDANTS);
            }
        }
        self.emit(id, ForNode::ContentVisibility { skipped });
    }

    /// Whether `content-visibility: auto` has changed its mind.
    pub(crate) fn update_auto_visibility(&mut self) -> bool {
        let is_current =
            self.locks.proximity_is_for.replace(self.layout_version) == Some(self.layout_version);
        if is_current && self.auto_visible.values().all(Option::is_some)
            || self.auto_visible.is_empty()
        {
            return false;
        }
        let [width, height] = self.environment.viewport;
        let margin = [height, width, height, width].map(|it| [it * 1.5, 0.0]);
        let mut root = self
            .observed_root(DOCUMENT)
            .with_margins(&Outsets::default(), margin);
        let (mut relevant, mut found, mut changed) = (None, Vec::new(), Vec::new());
        for (id, known) in self.auto_visible.iter().map(|it| (*it.0, *it.1)) {
            if self.own_box(id).is_none_or(|it| self.boxes.is_parked(it)) {
                continue;
            }
            let is_near = self.locks.are_open || self.intersect(id, &mut root).is_some();
            if known == Some(is_near)
                && is_near != self.tree[id].has(Flags::SKIPPED)
                && self.anchored.is_empty()
            {
                continue;
            }
            let skips = !is_near
                && !self.has_focus_within(id)
                && !relevant
                    .get_or_insert_with(|| self.relevant_nodes())
                    .contains(&id);
            if known != Some(is_near) {
                found.push((
                    id,
                    is_near,
                    known.is_none() && skips == self.tree[id].has(Flags::SKIPPED),
                ));
            }
            if skips != self.tree[id].has(Flags::SKIPPED) {
                changed.push((id, skips));
            }
        }
        for (id, is_near, is_news) in found {
            self.auto_visible.insert(id, Some(is_near));
            if is_news {
                self.emit(
                    id,
                    ForNode::ContentVisibility {
                        skipped: self.tree[id].has(Flags::SKIPPED),
                    },
                );
            }
        }
        changed
            .iter()
            .for_each(|(id, skips)| self.set_skipped(*id, *skips));
        !changed.is_empty()
    }

    /// Each is relative to the border box of the box.
    pub(crate) fn local_rects(&self, node: NodeId) -> Vec<(BoxId, Rect)> {
        if let Some(own) = self.own_box(node) {
            return self.pieces(own).map_or_else(
                || vec![(own, self.border_box(own))],
                |it| it.iter().map(|it| (own, it.rect)).collect(),
            );
        }
        if let Some(rect) = self.svg_element_rect(node) {
            return vec![rect];
        }
        let mut rects = Vec::new();
        for (id, inline) in self.lines_with(node) {
            let is_own = |it: &&Fragment| {
                inline.items[it.item as usize].node == node
                    && !matches!(it.kind, FragmentKind::Hyphen(_))
            };
            rects.extend(
                inline
                    .lines
                    .fragments
                    .iter()
                    .filter(is_own)
                    .map(|it| (id, self.from_lines(id, it.rect()))),
            );
        }
        if let (Some(first), Some(last)) =
            (rects.first().map(|it| it.0), rects.last().map(|it| it.0))
        {
            let (parent, is_block) = (self.boxes[first].parent, |id: &&BoxId| {
                self.boxes[**id].kind != Kind::Lines
            });
            let between = self.boxes[parent]
                .children
                .iter()
                .skip_while(|it| **it != first)
                .take_while(|it| **it != last);
            let ([x, y, width, height], mode) = (self.content_box(parent), self.boxes[parent].mode);
            if !self.boxes.pieces.is_empty() && self.is_in_columns(first) {
                let width = mode.turn_axes(self.boxes[first].size())[0];
                for id in between
                    .filter(is_block)
                    .filter(|it| !self.boxes[**it].spans_columns())
                {
                    let (margin, whole) = (self.boxes[*id].layout.margin, [self.border_box(*id)]);
                    let pieces = self.pieces(*id).map_or_else(
                        || whole.to_vec(),
                        |it| it.iter().map(|it| it.rect).collect(),
                    );
                    rects.extend(pieces.into_iter().map(|it| match mode.is_vertical() {
                        true => (
                            *id,
                            Rect {
                                y: it.y - margin.top,
                                height: width,
                                ..it
                            },
                        ),
                        false => (
                            *id,
                            Rect {
                                x: it.x - margin.left,
                                width,
                                ..it
                            },
                        ),
                    }));
                }
                return rects;
            }
            rects.extend(between.filter(is_block).map(|id| {
                let layout = &self.boxes[*id].layout;
                match mode.is_vertical() {
                    true => (
                        *id,
                        Rect::new([0.0, y - layout.location.y, layout.size.width, height]),
                    ),
                    false => (
                        *id,
                        Rect::new([x - layout.location.x, 0.0, width, layout.size.height]),
                    ),
                }
            }));
        }
        rects
    }

    pub(crate) fn client_rects(&self, node: NodeId) -> Vec<Rect> {
        let rects = self.local_rects(node);
        rects
            .iter()
            .map(|(id, rect)| self.map_to_viewport(*id, *rect))
            .collect()
    }

    /// If there is nothing to lay out, and nothing but offsets to add up.
    pub(crate) fn plain_bounding_rect(&self, node: NodeId) -> Option<Rect> {
        let own = self.own_box(node).filter(|it| {
            self.is_at_rest() && !self.has_depth.get() && self.pieces(*it).is_none()
        })?;
        let (mut at, mut offset) = (own, [0.0; 2]);
        while at != VIEWPORT && at != 0 {
            let [x, y] = self.plain_offset(at)?;
            (at, offset) = (self.boxes[at].container, [offset[0] + x, offset[1] + y]);
        }
        Some(self.border_box(own).transformed(&translation(offset)))
    }

    pub(crate) fn bounding_rect(&self, node: NodeId) -> Rect {
        if let Some(own) = self.own_box(node).filter(|it| self.pieces(*it).is_none()) {
            return self.map_to_viewport(own, self.border_box(own));
        }
        let rects = self.client_rects(node);
        let non_empty = rects
            .iter()
            .filter(|it| !it.is_empty())
            .copied()
            .reduce(|a, b| a.union(&b));
        let is_split = self
            .own_box(node)
            .is_some_and(|it| self.pieces(it).is_some());
        non_empty
            .or_else(|| {
                if is_split {
                    rects.last()
                } else {
                    rects.first()
                }
                .copied()
            })
            .unwrap_or_default()
    }

    pub(crate) fn zoom_of(&self, node: NodeId) -> f32 {
        self.tree.style(node).map_or(1.0, |it| it.zoom)
    }

    /// From the inside out, along the containing blocks. `DOCUMENT` stands for the viewport.
    pub(crate) fn scrollers_around(&self, node: NodeId) -> Vec<NodeId> {
        let first = self.tree[node].layout_box;
        let inside = core::iter::once(first)
            .filter(|it| *it != 0)
            .chain(self.boxes.containers(first))
            .take_while(|it| *it != VIEWPORT);
        let mut all: Vec<_> = inside
            .clone()
            .filter(|it| self.boxes[*it].scrolls())
            .map(|it| self.boxes[it].node)
            .filter(|it| *it != node)
            .collect();
        all.extend(
            inside
                .last()
                .filter(|it| !self.is_fixed_to_viewport(*it))
                .map(|_| DOCUMENT),
        );
        all
    }

    fn offset_parent(&self, node: NodeId) -> NodeId {
        let Some(style) = self.tree.style(node) else {
            return 0;
        };
        if self.tree.html_tag(node) == name!("body") || self.tree.is_root(node) {
            return 0;
        }
        let is_fixed = style.layout.position == PositionKind::Fixed;
        let found = self.tree.flat_ancestors(node).find(|ancestor| {
            let tag = self.tree.html_tag(*ancestor);
            self.tree[*ancestor].layout_box != 0
                && self.tree.style(*ancestor).is_some_and(|it| {
                    it.contains_fixed()
                        || self
                            .own_box(*ancestor)
                            .is_some_and(|it| self.boxes[it].is_foreign_object)
                        || it.zoom != style.zoom
                        || !is_fixed
                            && (it.is_positioned()
                                || tag == name!("body")
                                || !style.is_positioned() && is_name!(tag, "td" | "th" | "table"))
                })
        });
        found.unwrap_or(0)
    }

    /// Of the border box, from the initial containing block, without transforms and scrolling.
    fn layout_position(&self, id: BoxId) -> [f32; 2] {
        let inside = core::iter::once(id).chain(self.boxes.containers(id));
        inside
            .map(|it| self.unscrolled_offset(it, None))
            .fold([0.0; 2], |sum, it| [sum[0] + it[0], sum[1] + it[1]])
    }

    pub(crate) fn position_in_document(&self, node: NodeId) -> [f32; 2] {
        self.own_box(node)
            .map_or([0.0; 2], |it| self.layout_position(it).map(f32::trunc))
    }

    /// Of the content box.
    pub(crate) fn device_pixel_size(&self, node: NodeId) -> [f32; 2] {
        let scale = self.environment.scale;
        let Some(own) = self.own_box(node) else {
            let [.., width, height] = self.box_sizes(node);
            return [width, height].map(|it| (it * self.zoom_of(node) * scale).round());
        };
        let content = Rect::new(self.content_box(own)).moved(self.layout_position(own));
        [0, 1]
            .map(|axis| content.span(axis).map(|it| (it * scale + 0.5).floor()))
            .map(|[near, far]| far - near)
    }

    /// Without transforms and scrolling.
    pub(crate) fn layout_rects(&self, node: NodeId) -> Vec<Rect> {
        let rects = self.own_box(node).map_or_else(
            || self.local_rects(node),
            |own| vec![(own, self.border_box(own))],
        );
        rects
            .into_iter()
            .map(|(id, rect)| rect.moved(self.layout_position(id)))
            .collect()
    }

    pub(crate) fn offset_metrics(&self, node: NodeId) -> [f32; 5] {
        let rects = self.layout_rects(node);
        let placed = |(id, rect): &(BoxId, Rect)| rect.moved(self.layout_position(*id));
        let (Some(first), Some(all)) = (
            rects.first().copied(),
            rects.iter().copied().reduce(|a, b| a.union(&b)),
        ) else {
            return [0.0; 5];
        };
        let parent = self.offset_parent(node);
        let is_static_body = parent == self.tree.body()
            && self
                .tree
                .style(parent)
                .is_some_and(|it| !it.is_positioned());
        let origin = self
            .local_rects(parent)
            .first()
            .filter(|_| parent != 0 && !is_static_body)
            .map_or([0.0; 2], |it| {
                let (rect, border) = (
                    placed(it),
                    self.tree
                        .style(parent)
                        .filter(|_| self.own_box(parent).is_some())
                        .map_or([0.0; 4], |it| it.border()),
                );
                [rect.x + border[3], rect.y + border[0]]
            });
        let zoom = self.zoom_of(node);
        let rounded = |it: f32| (it / zoom + 0.5).floor();
        [
            parent as f32,
            rounded(first.x - origin[0]),
            rounded(first.y - origin[1]),
            rounded(all.width),
            rounded(all.height),
        ]
    }

    /// What clips the contents, relative to the border box.
    pub(crate) fn overflow_clip(&self, id: BoxId) -> Option<Rect> {
        let clip = self.whole_overflow_clip(id)?;
        let pieces = self
            .pieces(id)
            .into_iter()
            .flatten()
            .map(|it| clip.moved(it.shift).intersection(&it.clip));
        pieces.reduce(|a, b| a.union(&b)).or(Some(clip))
    }

    /// As if the box were not split.
    pub(crate) fn whole_overflow_clip(&self, id: BoxId) -> Option<Rect> {
        const FAR: f32 = 1e7;
        let it = &self.boxes[id];
        let contains_paint = !it.style.is_plain() && it.style.contain().contains(Contain::PAINT);
        let [x, y] = it
            .overflow
            .map(|it| it != Overflow::Visible || contains_paint);
        if !x && !y {
            return None;
        }
        let mut clip = self.client_box(id);
        if x && y && (!it.scrolls() || it.is_replaced()) {
            let ClipMargin(area, margin) = it.style.effects.clip_margin;
            clip = match area {
                BoxArea::ContentBox => Rect::new(self.content_box(id)),
                BoxArea::BorderBox => self.border_box(id),
                _ => clip,
            }
            .grown(margin);
        }
        let open = |clips: bool| if clips { 0.0 } else { -FAR };
        Some(clip.shrunk([open(y), open(x), open(y), open(x)]))
    }

    /// Without margins.
    pub(crate) fn observed_root(&self, root: NodeId) -> ObservedRoot {
        let id = self.own_box(root).unwrap_or(0);
        let (rect, to_viewport) = (
            if self.boxes[id].scrolls() && self.boxes[id].kind != Kind::Table {
                self.client_box(id)
            } else {
                self.border_box(id)
            },
            self.to_viewport(id),
        );
        ObservedRoot {
            id,
            rect: rect.transformed(&to_viewport),
            to_viewport,
            scroll_margin: Outsets::default(),
            known: Default::default(),
        }
    }

    /// What clips the contents. Nothing touches an empty clip path.
    fn observed_clips(&self, id: BoxId, scroll_margin: &Outsets) -> impl Iterator<Item = Rect> {
        let widened = |it: Rect| {
            if self.boxes[id].scrolls() {
                it.shrunk(outset(it, scroll_margin))
            } else {
                it
            }
        };
        let path = self.clip_bounds(id).map(|it| {
            if it.is_empty() {
                Rect::new([f32::NAN; 4])
            } else {
                widened(it)
            }
        });
        [self.overflow_clip(id).map(widened), path]
            .into_iter()
            .flatten()
    }

    fn shown_in(&self, mut id: BoxId, root: &mut ObservedRoot) -> Shown {
        let [mut left, mut top] = [0.0; 2];
        while id != root.id
            && id != 0
            && !self.boxes[id].is_skipped
            && self.boxes[id].overflow == [Overflow::Visible; 2]
            && let Some([x, y]) = self.plain_offset(id)
        {
            (left, top, id) = (left + x, top + y, self.boxes[id].container);
        }
        match self.shown_in_clip(id, root) {
            Shown::Moved([x, y], clip) => Shown::Moved([x + left, y + top], clip),
            shown => shown,
        }
    }

    fn shown_in_clip(&self, id: BoxId, root: &mut ObservedRoot) -> Shown {
        if let Some(known) = root.known.get(&id) {
            return *known;
        }
        let offset_of =
            |[a, b, c, d, x, y]: Matrix| ([a, b, c, d] == [1.0, 0.0, 0.0, 1.0]).then_some([x, y]);
        let shown = if id == 0 || self.boxes[id].is_skipped {
            Shown::Nothing
        } else if id == root.id {
            offset_of(root.to_viewport)
                .map_or(Shown::Transformed, |offset| Shown::Moved(offset, root.rect))
        } else {
            match (
                self.shown_in(self.boxes[id].container, root),
                offset_of(self.to_container(id)),
            ) {
                (Shown::Moved([x, y], clip), Some(own)) => {
                    let offset = [x + own[0], y + own[1]];
                    let mut clips = self
                        .observed_clips(id, &root.scroll_margin)
                        .map(|it| it.moved(offset));
                    let clip = clips.try_fold(clip, |all, it| {
                        it.touches(&all).then(|| all.intersection(&it))
                    });
                    clip.map_or(Shown::Nothing, |it| Shown::Moved(offset, it))
                }
                (Shown::Nothing, _) => Shown::Nothing,
                _ => Shown::Transformed,
            }
        };
        root.known.insert(id, shown);
        shown
    }

    pub(crate) fn intersect(&self, node: NodeId, root: &mut ObservedRoot) -> Option<Rect> {
        let rects = self.local_rects(node);
        let at = rects.first()?.0;
        (!self.boxes[at].is_skipped || self.boxes[at].node == node).then_some(())?;
        let mut rect = rects
            .iter()
            .filter(|it| it.0 == at)
            .map(|it| it.1)
            .reduce(|a, b| a.union(&b))?;
        if self.boxes[at].kind == Kind::Svg && self.boxes[at].node != node {
            if at == root.id {
                return clipped(rect.transformed(&root.to_viewport), Some(root.rect));
            }
            rect = clipped(rect, self.overflow_clip(at))?;
        }
        rect = clipped(rect, self.clip_bounds(at))?.transformed(&self.to_container(at));
        for (id, other) in rects
            .iter()
            .filter(|it| it.0 != at && self.boxes[it.0].container == self.boxes[at].container)
        {
            rect = rect.union(&other.transformed(&self.to_container(*id)));
        }
        self.shown_part(at, rect, root)
    }

    /// `rect` is in the viewport of a frame. With what maps that to this one.
    pub(crate) fn intersect_contents(
        &self,
        frame: NodeId,
        rect: Rect,
        root: &mut ObservedRoot,
    ) -> Option<(Rect, Matrix)> {
        let own = self
            .own_box(frame)
            .filter(|it| !self.boxes[*it].is_skipped)?;
        let ([x, y, ..], zoom) = (self.content_box(own), self.zoom_of(frame));
        let to_box = [zoom, 0.0, 0.0, zoom, x, y];
        let rect = clipped(rect.transformed(&to_box), self.clip_bounds(own))?;
        let shown = match self.has_depth.get() {
            false => self.shown_part(own, rect.transformed(&self.to_container(own)), root)?,
            true => {
                let around = self.boxes.containers(own).take_while(|it| *it != root.id);
                let clips = around.flat_map(|id| {
                    self.observed_clips(id, &root.scroll_margin)
                        .map(move |it| self.map_to_viewport(id, it))
                });
                clips
                    .chain([root.rect])
                    .try_fold(self.map_to_viewport(own, rect), |rect, it| {
                        clipped(rect, Some(it))
                    })?
            }
        };
        Some((shown, multiply(&self.to_viewport(own), &to_box)))
    }

    /// Of `rect`, which is in the container of `at`.
    fn shown_part(&self, mut at: BoxId, mut rect: Rect, root: &mut ObservedRoot) -> Option<Rect> {
        match self.shown_in(self.boxes[at].container, root) {
            Shown::Nothing => return None,
            Shown::Moved(offset, clip) => return clipped(rect.moved(offset), Some(clip)),
            Shown::Transformed => {}
        }
        loop {
            at = self.boxes[at].container;
            (!self.boxes[at].is_skipped).then_some(())?;
            if at == root.id || at == 0 {
                break;
            }
            rect = self
                .observed_clips(at, &root.scroll_margin)
                .try_fold(rect, |rect, it| clipped(rect, Some(it)))?
                .transformed(&self.to_container(at));
        }
        clipped(rect.transformed(&root.to_viewport), Some(root.rect)).filter(|_| at != 0)
    }
}
