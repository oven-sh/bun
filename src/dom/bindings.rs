//! What the DOM asks of the engine.

use std::rc::Rc;

use bun_jsc::bindgen::JsScope;

use smallvec::{SmallVec, smallvec};

use crate::abi::Rect;
use crate::api::core::Doc;
use crate::boxes::{BoxId, Kind};
use crate::document::{Document, Environment, Quirks};
use crate::editing::{Mark, Point, Range};
use crate::name::{Name, name};
use crate::order::Order as _;
use crate::scroll::Alignment;
use crate::selector::{Matcher, Sought, key};
use crate::svg::Bounds;
use crate::tree::{DOCUMENT, Flags, NodeId, Replaced, State};
use crate::types::*;
use crate::values::{Color, Css, Ctx, parse_all};

fn number(value: f64) -> Option<f32> {
    (!value.is_nan()).then_some(value as f32)
}

impl Replaced {
    pub(crate) fn new(image: u32, width: f64, height: f64, ratio: f64) -> Replaced {
        let size = [width, height].map(|it| Some(number(it)?.min(crate::values::MAX_LENGTH)));
        Replaced {
            image,
            size,
            ratio: number(ratio).filter(|it| it.is_finite() && *it > 0.0),
        }
    }
}

impl Document {
    /// An id that JavaScript has passed, or else no node.
    fn node(&self, id: NodeId) -> NodeId {
        if self.tree.contains(id) { id } else { 0 }
    }

    pub(crate) fn point(&self, node: NodeId, offset: u32) -> Point {
        let node = self.node(node);
        Point {
            node,
            offset: self.tree[node]
                .stored_text()
                .map_or_else(|| self.node(offset), |it| it.offset_in_utf8(offset)),
        }
    }

    pub(crate) fn range(&self, [a, b, c, d]: [u32; 4]) -> Range {
        [self.point(a, b), self.point(c, d)]
    }

    pub(crate) fn node_at_point(&mut self, point: [f32; 2]) -> NodeId {
        self.update_hits();
        self.nodes_at(point)
            .next()
            .map_or(0, |it| self.not_generated(it))
    }

    pub(crate) fn updated_style_bits(&mut self, node: NodeId, wanted: u32) -> u32 {
        const OF_BOXES: u32 = 1 | 1 << 5;
        if wanted & OF_BOXES == 0 && !self.is_in_skipped_contents(node) {
            self.update_style_of(node);
            return self.style_bits(node, wanted) & wanted;
        }
        self.update_boxes_of(node);
        self.style_bits(node, wanted) & wanted
    }

    pub(crate) fn mark_ranges(&mut self, mark: Mark, priority: i32, ranges: Vec<Range>) {
        let marks = &mut self.marks;
        marks.highlights.retain(|it| it.0 != mark);
        marks
            .highlights
            .extend((!ranges.is_empty()).then_some((mark, priority, ranges)));
        marks.highlights.order_by_key(|it| it.1);
        marks.are_stale = true;
        self.pictures.outdate();
    }

    pub(crate) fn reveal_caret(&mut self, point: Point, upstream: bool, vertically: Alignment) {
        self.update_layout_for(point.node);
        if let Some((at, rect)) = self.caret_rect(point, upstream) {
            self.reveal(
                at,
                rect,
                [Alignment::Nearest, vertically],
                1,
                crate::scroll::Scrollers::All,
            );
        }
    }

    pub(crate) fn for_script(&self, point: Point) -> [u32; 2] {
        [
            point.node,
            self.tree[point.node]
                .stored_text()
                .map_or(point.offset, |it| it.offset_in_utf16(point.offset)),
        ]
    }

    fn laid_out_range(&mut self, ends: [u32; 4]) -> Range {
        self.catch_up_with_compositor();
        self.update_layout_for(self.node(ends[0]));
        self.range(ends)
    }

    pub(crate) fn client_rects_of_range(&mut self, ends: [u32; 4]) -> Vec<[f64; 4]> {
        let mut range = self.laid_out_range(ends);
        let splits_pair = ends[..2] != ends[2..]
            && self.tree[range[1].node].text().is_some_and(|it| {
                it.get(range[1].offset as usize)
                    .is_some_and(|it| *it >= 0xf0)
            })
            && self.for_script(range[1])[1] < ends[3];
        range[1].offset += if splits_pair { 4 } else { 0 };
        self.range_rects(&range)
            .iter()
            .map(|it| it.to_array().map(f64::from))
            .collect()
    }

    pub(crate) fn selectable_text_of_range(&mut self, ends: [u32; 4]) -> Vec<u8> {
        let range = self.laid_out_range(ends);
        self.rendered_text(&range, true)
    }

    pub(crate) fn not_generated(&self, mut id: NodeId) -> NodeId {
        while [id, self.tree[id].parent]
            .into_iter()
            .any(|it| self.tree.element(it).is_some_and(|it| it.is_generated()))
        {
            id = self.tree.flat_parent(id);
        }
        id
    }

    /// `None` if it is invalid.
    pub(crate) fn selector(&mut self, source: &[u8], of: Of) -> Option<Rc<Sought>> {
        let key = crate::name::keyed_hash_of_bytes(
            u64::from(of.is_xml) << 1 | u64::from(of.is_quirky),
            source,
        ) | 1 << 63;
        if self.selectors.len() > 1024 {
            self.selectors.clear();
        }
        let parse = || {
            crate::selector_parser::Parser {
                is_quirky: of.is_quirky,
                ..Default::default()
            }
            .parse(source)
            .map(|it| Rc::new(Sought::new(it, source, key, of)))
        };
        self.selectors.entry(key).or_insert_with(parse).clone()
    }

    pub(crate) fn derive_state_of_unrendered(&mut self, root: NodeId) {
        let children: Vec<_> = self
            .tree
            .element_children(root)
            .filter(|_| self.tree.element(root).is_none())
            .chain([root])
            .collect();
        children
            .into_iter()
            .for_each(|it| self.update_derived_state(it, true));
    }

    /// What `Selection::first_below` has returned, if it still would.
    #[inline]
    pub(crate) fn known_first(&self, root: NodeId, sought: &Sought) -> Option<Cell> {
        self.tree
            .found()
            .first(sought, root)
            .filter(|_| self.stale_directions.is_empty())
    }

    /// And `Selection::all_below`.
    pub(crate) fn known_all(&self, root: NodeId, key: u64) -> Option<Cells> {
        let selections = self.tree.found().selections.borrow();
        selections
            .iter()
            .find(|it| (it.key, it.root) == (key, root) && self.stale_directions.is_empty())
            .map(|it| Rc::clone(&it.cells))
    }

    pub(crate) fn select<R>(
        &mut self,
        scope: NodeId,
        sought: &Sought,
        is_rendered: bool,
        find: impl FnOnce(&Selection<'_>) -> R,
    ) -> R {
        self.update_directions();
        self.tree.prepare_to_search(scope);
        let was_xml = core::mem::replace(&mut self.tree.is_xml, sought.is_xml);
        let found = find(&self.selection(scope, sought, is_rendered));
        self.tree.is_xml = was_xml;
        found
    }

    /// If nothing has to be prepared.
    #[inline]
    pub(crate) fn plain_selection<'a>(
        &'a self,
        scope: NodeId,
        sought: &'a Sought,
    ) -> Option<Selection<'a>> {
        let matcher = || {
            Matcher::new(
                &self.tree,
                self.tree.host_of(self.tree[scope].scope),
                NodeId::MAX,
                None,
            )
        };
        (sought.is_plain && !self.tree.has_searched_enough())
            .then(|| self.selection_with(matcher(), sought, self.tree.is_rendered(scope)))
    }

    #[inline]
    fn selection<'a>(
        &'a self,
        scope: NodeId,
        sought: &'a Sought,
        is_rendered: bool,
    ) -> Selection<'a> {
        let host = self.tree.host_of(self.tree[scope].scope);
        let scope = match self.tree.element(scope) {
            None if scope == DOCUMENT || self.tree[scope].has(Flags::OTHER_DOCUMENT) => self
                .tree
                .element_children(scope)
                .next()
                .unwrap_or(NodeId::MAX),
            None => NodeId::MAX,
            Some(_) => scope,
        };
        let matcher = Matcher::new(&self.tree, host, scope, None);
        debug_assert_eq!(self.tree.cut_at.get(), 0);
        self.selection_with(matcher, sought, is_rendered)
    }

    #[inline]
    fn selection_with<'a>(
        &self,
        matcher: Matcher<'a>,
        sought: &'a Sought,
        is_rendered: bool,
    ) -> Selection<'a> {
        let (mut limit, mut filters) = (0usize, SmallVec::new());
        for kind in &sought.kinds {
            let most = match is_rendered {
                true if kind
                    .around
                    .iter()
                    .any(|it| self.attribute_keys.at_most(*it) == 0) =>
                {
                    0
                }
                true => kind
                    .own
                    .iter()
                    .map(|it| self.attribute_keys.at_most(*it))
                    .min()
                    .unwrap_or(usize::MAX),
                false => usize::MAX,
            };
            limit = limit.saturating_add(most);
            filters.extend((most != 0).then_some(kind.filter));
        }
        Selection {
            matcher,
            sought,
            limit,
            filters,
        }
    }

    pub(crate) fn has_events(&self) -> bool {
        !self.events.is_empty() || self.scrolling.has_events()
    }

    pub(crate) fn has_new_requests(&mut self) -> bool {
        self.request_fonts();
        self.has_requests()
    }

    pub(crate) fn needs_painting(&mut self) -> bool {
        self.report_finished_scrolls();
        self.needs_frame || self.is_dirty()
    }

    /// Whether a frame has something to do, apart from advancing animations.
    pub(crate) fn has_pending(&mut self) -> bool {
        self.needs_painting() || self.has_events() || self.has_new_requests()
    }

    /// Whether a frame has something to do.
    pub(crate) fn needs_attention(&mut self) -> bool {
        self.has_pending() || self.is_animating() || self.scrolling.is_animating()
    }

    /// The version of the layout.
    pub(crate) fn update_layout_for_frame(&mut self) -> u32 {
        self.update_layout();
        for _ in 0..3 {
            self.remember_sizes();
            if !self.update_auto_visibility() {
                break;
            }
            self.update_layout();
        }
        self.layout_version
    }

    pub(crate) fn paint_frame(&mut self, surface: u32) {
        self.update_scroll_timelines();
        self.update_style();
        self.start_pending_animations();
        self.remember_position_options();
        self.submit(surface);
        self.age_locks();
        self.collect_garbage();
    }

    pub(crate) fn set_composited(&mut self, on: bool) {
        self.compositor.is_on = on;
        self.pictures.discard();
    }

    pub(crate) fn set_state(&mut self, node: NodeId, bits: State, on: bool) {
        let Some(element) = self.tree.element(node) else {
            return;
        };
        self.change_state(
            node,
            if on {
                bits - element.state
            } else {
                bits & element.state
            },
        );
        if !self.tree.is_rendered(node) {
            return;
        }
        if bits.intersects(State::FOCUS_WITHIN) {
            self.relevance_changed();
        }
        if bits.intersects(State::PICKER_OPEN | State::FORM_ASSOCIATED) {
            self.update_derived_state(node, false);
        }
    }

    pub(crate) fn set_custom_state(&mut self, node: NodeId, name: Name, on: bool) {
        let Some(element) = self.tree.element_mut(node) else {
            return;
        };
        if element.custom_states.contains(&name) == on {
            return;
        }
        element.set_custom_state(name, on);
        if element.pseudo == crate::selector::Pseudo::Part(name!("-internal-cue-node"))
            && self.tree.is_rendered(node)
        {
            self.tree
                .mark_style(node, Flags::REMATCH_SUBTREE | Flags::RECASCADE);
        }
        self.feature_changed(node, key::custom_state(name));
    }

    pub(crate) fn set_blocks_wheel(&mut self, node: NodeId, on: bool) {
        let blockers = &mut self.compositor.wheel_blockers;
        if (if on {
            blockers.insert(node)
        } else {
            blockers.remove(&node)
        }) && self.compositor.is_on
        {
            self.pictures.discard();
        }
    }
}

/// The document that has the nodes.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Of {
    pub(crate) is_xml: bool,
    pub(crate) is_quirky: bool,
}

/// Where the matches are known to be.
#[derive(Clone, Copy)]
pub(crate) enum Within {
    Root,
    /// Of a descendant, which is included.
    Subtree(NodeId),
    Nothing,
}

pub(crate) type Cell = *const crate::api::core::Node;
type Cells = Rc<Vec<Cell>>;

/// What `Selection::all_below` has returned.
pub(crate) struct Selected {
    key: u64,
    root: NodeId,
    cells: Cells,
}

pub(crate) struct Selection<'a> {
    matcher: Matcher<'a>,
    sought: &'a Sought,
    /// How many can match at most.
    limit: usize,
    /// Of the `Sought::kinds` that there can be.
    filters: SmallVec<[u64; 4]>,
}

impl Selection<'_> {
    pub(crate) fn has(&self, id: NodeId) -> bool {
        self.matcher.tree[id].keys & self.sought.keys != 0
            && self.sought.matches(&self.matcher, self.matcher.tree, id)
    }

    pub(crate) fn closest(&self, id: NodeId) -> Option<NodeId> {
        let ancestors = core::iter::successors(Some(id), |it| Some(self.matcher.tree[*it].parent))
            .take_while(|it| *it != 0);
        ancestors.filter(|it| self.has(*it)).take(self.limit).next()
    }

    /// Without those that only the engine has.
    pub(crate) fn below(&self, root: NodeId) -> impl Iterator<Item = Cell> + '_ {
        let tree = self.matcher.tree;
        tree.descendants_with(root, self.sought.keys)
            .filter(|it| self.matcher.any(&self.sought.list, *it))
            .map(|it| tree.cell(it))
            .filter(|it| !it.is_null())
    }

    /// The same, until `found` returns false. It looks no further than it has to at first.
    fn each_below<const N: usize>(
        &self,
        root: NodeId,
        within: Within,
        mut found: impl FnMut(Cell) -> bool,
    ) {
        let tree = self.matcher.tree;
        let start = match within {
            Within::Root => root,
            Within::Nothing => return,
            Within::Subtree(id) if self.has(id) && !found(tree.cell(id)) => return,
            Within::Subtree(id) => id,
        };
        let (sought, mut left) = (self.sought, self.limit);
        let mut goes_on = |id: NodeId| {
            let cell = tree.cell(id);
            left = left.saturating_sub(1);
            if self.limit == 1 {
                tree.last_found_in.set(tree[id].parent);
            }
            (cell.is_null() || found(cell)) && left > 0
        };
        if self.limit == 0 {
            return;
        }
        if let Some(below) = tree.sequence.below(tree, start) {
            let rows = &tree.sequence.rows[..];
            return tree
                .sequence
                .visit::<N>(below, &sought.wanted, |batch| match N {
                    64 => batch.iter().all(|it| {
                        !sought.matches(&self.matcher, rows, *it) || goes_on(rows[*it as usize].id)
                    }),
                    _ => sought
                        .nodes_of_matches(&self.matcher, batch)
                        .iter()
                        .all(|it| goes_on(*it)),
                });
        }
        let (mut pending, mut batch, mut size) = (
            smallvec![tree.first_child_with(start, sought.keys)],
            [0; 32],
            1,
        );
        while !pending.is_empty() {
            let count = match self.filters[..] {
                [required] if required != 0 => tree.next_with(
                    &mut pending,
                    |keys| keys & required == required,
                    &mut batch[..size],
                ),
                ref all => tree.next_with(
                    &mut pending,
                    |keys| keys & sought.keys != 0 && all.iter().any(|it| keys & it == *it),
                    &mut batch[..size],
                ),
            };
            if !batch[..count]
                .iter()
                .all(|it| !sought.matches(&self.matcher, tree, *it) || goes_on(*it))
            {
                return;
            }
            size = batch.len().min(size * 2);
        }
    }

    pub(crate) fn first_below(&self, root: NodeId, within: Within) -> Cell {
        let mut first = self.only_near_last(root);
        if first.is_null() {
            self.each_below::<64>(root, within, |it| {
                first = it;
                false
            });
        }
        self.matcher
            .tree
            .found()
            .note_first(self.sought, root, first);
        first
    }

    /// If no more than one element can match, where it is found makes no difference.
    fn only_near_last(&self, root: NodeId) -> Cell {
        let (tree, parent) = (self.matcher.tree, self.matcher.tree.last_found_in.get());
        let is_below = || {
            core::iter::successors(Some(parent), |it| Some(tree[*it].parent))
                .take_while(|it| *it != 0)
                .any(|it| it == root)
        };
        let children = || {
            tree.element_children(parent)
                .inspect(|_| tree.sequence.walked.update(|it| it + 1))
        };
        let found = (self.limit == 1 && !tree.sequence.is_current() && is_below()).then(|| {
            children().find(|it| {
                tree[*it].keys & self.sought.required == self.sought.required && self.has(*it)
            })
        });
        found
            .flatten()
            .map_or(core::ptr::null(), |it| tree.cell(it))
    }

    pub(crate) fn all_below(&self, root: NodeId, within: Within) -> Cells {
        let mut cells = Vec::with_capacity(self.sought.last_count.get());
        self.each_below::<256>(root, within, |it| {
            cells.push(it);
            true
        });
        self.sought.last_count.set(cells.len());
        let cells = Rc::new(cells);
        let mut selections = self.matcher.tree.found().selections.borrow_mut();
        if selections.len() == 64
            || selections.iter().map(|it| it.cells.len()).sum::<usize>() > 1 << 16
        {
            selections.clear();
        }
        selections.push(Selected {
            key: self.sought.key,
            root,
            cells: Rc::clone(&cells),
        });
        cells
    }
}

impl Document {
    pub(crate) fn client_metrics(&self, node: NodeId) -> [f32; 4] {
        let is_table = |it: BoxId| self.boxes[it].kind == Kind::Table;
        let client =
            self.own_box(node)
                .map_or_else(Rect::default, |it| match self.client_box(it) {
                    Rect { x, y, .. } if is_table(it) => Rect {
                        x,
                        y,
                        ..self.border_box(it)
                    },
                    client => client,
                });
        client
            .to_array()
            .map(|it| (it / self.zoom_of(node)).round())
    }

    pub(crate) fn scroll_position(&self, node: NodeId) -> [f32; 2] {
        self.scroller(node).map_or([0.0; 2], |_| {
            self.scroll_offset(node).map(|it| it / self.zoom_of(node))
        })
    }

    pub(crate) fn scroll_size(&self, node: NodeId, scroller: NodeId) -> [f32; 2] {
        let Some(own) = self.own_box(node) else {
            return [0.0; 2];
        };
        let (client, range) = (
            self.client_box(own),
            if self.pieces(own).is_some() {
                [[0.0; 2]; 2]
            } else {
                self.scroll_range(self.own_box(scroller).unwrap_or(own))
            },
        );
        let extent =
            |size: f32, [min, max]: [f32; 2]| ((size + max - min) / self.zoom_of(node)).round();
        [
            extent(client.width, range[0]),
            extent(client.height, range[1]),
        ]
    }

    pub(crate) fn match_media(&mut self, query: &[u8]) -> bool {
        self.matches_media(query)
    }

    pub(crate) fn set_mode(&mut self, quirks: Quirks, is_xml: bool) {
        self.tree.is_xml = is_xml;
        self.tree.forget_found();
        self.set_environment(Environment {
            quirks,
            ..self.environment.clone()
        });
    }

    pub(crate) fn set_language(&mut self, language: &[u8]) {
        self.tree.language = crate::values::text(language).into();
        self.forget_memos();
        self.tree.forget_found();
        let roots: Vec<_> = self.tree.element_children(DOCUMENT).collect();
        for it in roots {
            self.tree.mark_style(it, Flags::REMATCH_SUBTREE);
        }
    }

    pub(crate) fn set_color_scheme(&mut self, source: &[u8]) -> bool {
        let Some(color_scheme) = parse_all(source, |p| ColorScheme::parse(p, &Ctx::dummy())) else {
            return false;
        };
        self.set_environment(Environment {
            color_scheme,
            ..self.environment.clone()
        });
        true
    }

    pub(crate) fn source_size(&mut self, sizes: &[u8]) -> f64 {
        crate::condition::source_size(sizes, &self.environment)
            .unwrap_or(self.environment.viewport[0])
            .into()
    }

    pub(crate) fn box_sizes(&self, node: NodeId) -> [f32; 6] {
        let Some(own) = self.own_box(node) else {
            let Rect { width, height, .. } = self
                .svg_bounding_box(node, Bounds::Fill)
                .unwrap_or_default();
            return [0.0, 0.0, width, height, width, height];
        };
        let ([.., width, height], layout) = (self.content_box(own), &self.boxes[own].layout);
        let sizes = [
            layout.padding.left,
            layout.padding.top,
            width,
            height,
            layout.size.width,
            layout.size.height,
        ];
        let zoom = self.boxes[own].style.zoom;
        sizes.map(|it| it / zoom)
    }

    pub(crate) fn prefetch_box_sizes(&self, nodes: &[NodeId]) {
        use core::hint::{Locality, prefetch_read};
        nodes
            .iter()
            .for_each(|it| prefetch_read(&raw const self.tree[*it], Locality::L1));
        let boxes = || {
            nodes
                .iter()
                .map(|it| &self.boxes[self.tree[*it].layout_box])
        };
        boxes().for_each(|it| {
            (
                prefetch_read(&raw const it.style, Locality::L1),
                prefetch_read(&raw const it.layout.size, Locality::L1),
                prefetch_read(&raw const it.layout.padding, Locality::L1),
            )
                .0
        });
        boxes().for_each(|it| prefetch_read(&raw const it.style.zoom, Locality::L1));
    }

    pub(crate) fn is_vertical(&self, node: NodeId) -> bool {
        self.own_box(node)
            .is_some_and(|it| self.boxes[it].mode.is_vertical())
    }

    /// The rects of the target, of the intersection and of the root.
    pub(crate) fn observe_intersection(
        &self,
        node: NodeId,
        root: NodeId,
        at: impl Fn(usize) -> f64,
    ) -> (Rect, Option<Rect>, Rect) {
        let mut root = self.root_of_observer(root, at);
        (
            self.bounding_rect(node),
            self.intersect(node, &mut root),
            root.rect,
        )
    }

    fn root_of_observer(
        &self,
        root: NodeId,
        at: impl Fn(usize) -> f64,
    ) -> crate::geometry::ObservedRoot {
        let margin = |first: usize| {
            [0, 1, 2, 3].map(|side| {
                [
                    at(first + side * 2) as f32,
                    at(first + side * 2 + 1) as f32 / 100.0,
                ]
            })
        };
        self.observed_root(root).with_margins(&margin(0), margin(8))
    }
}

pub(crate) fn parse_rgba(source: &[u8], current: u32) -> Option<u32> {
    parse_all(source, |p| Color::parse(p, &Ctx::dummy())).map(|it| it.resolve(current))
}

pub(crate) fn count_engines() -> u32 {
    crate::document::Counted::count()
}

pub(crate) fn panic_in_engine(doc: &Doc) {
    doc.engine(|_, _| panic!("for testing"))
}

pub(crate) fn dump_display_list<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) -> String {
    doc.synced_engine(cx, |engine, _| engine.update_picture().dump())
}

pub(crate) fn decodes_message<'a>(
    cx: &mut JsScope<'a>,
    family: &[u8],
    bytes: bun_jsc::bindgen::JsLocal<'a, bun_jsc::bindgen::BufferSource>,
) -> bool {
    use bun_web::channel::{Arrival, Serialized};
    use bun_web::{host, remote, wire::decode};
    let bytes = bytes.with_bytes(&cx.heap, <[u8]>::to_vec);
    let message = match family {
        b"notice" => return decode::<host::Notice>(&bytes).is_ok(),
        b"question" => return decode::<host::Question>(&bytes).is_ok(),
        b"answer" => return decode::<host::Answer>(&bytes).is_ok(),
        b"forged" => {
            return bytes.split_first().is_some_and(|(page, it)| {
                decode(it).is_ok_and(|it| remote::forge((*page).into(), it))
            });
        }
        b"call" => {
            return remote::is_page_process()
                && bytes.split_first().is_some_and(|(client, it)| {
                    bun_web::outside::forge_call((*client).into(), it)
                });
        }
        b"deed" => {
            return remote::is_page_process()
                && bytes.split_first().is_some_and(|(client, it)| {
                    bun_web::outside::forge_deed((*client).into(), it)
                });
        }
        b"port" => match remote::open(u32::MAX, &bytes) {
            Ok(Arrival::Message(it)) => it,
            _ => return false,
        },
        _ => Serialized::unchecked(bytes).into(),
    };
    message
        .open(cx.global())
        .inspect_err(|_| _ = cx.global().clear_exception_except_termination())
        .is_ok()
}

pub(crate) fn ask_as_assistive_technology(question: &[u8]) -> Vec<u8> {
    // SAFETY: the answer is copied before the next call.
    crate::platform::renderer().map_or(Vec::new(), |it| unsafe {
        (it.inspect_accessibility)(crate::abi::Slice::new(question))
            .get()
            .to_vec()
    })
}

/// `head`: the root, the focus and two points, whose offsets are in `selected`. For each node `ids` has the id, the container, how
/// many properties, relations, children and lines it has, the children, and the nodes of each relation after their number.
/// `strings` has the role, the names and values of the properties, and the names of the relations. `numbers` has six, and five per line.
#[unsafe(no_mangle)]
fn __bun_dom_submit_remote_accessibility(
    image: u32,
    zoom: f64,
    head: [u32; 6],
    selected: [&str; 2],
    mut ids: &[u32],
    strings: &[String],
    mut numbers: &[f64],
) {
    use crate::abi::accessibility::Point;
    use crate::accessibility::remote::{Node, Tree};
    let (mut tree, mut strings) = (Tree::default(), strings.iter().map(String::as_str));
    let mut next = || {
        let [id, container, properties, relations, children, lines] =
            *ids.split_off(..6)?.first_chunk()?;
        let (children, role) = (ids.split_off(..children as usize)?, strings.next()?);
        let properties = (0..properties)
            .map_while(|_| Some((strings.next()?, strings.next()?)))
            .collect();
        let relations = (0..relations)
            .map_while(|_| {
                Some((
                    strings.next()?,
                    ids.split_off_first()
                        .and_then(|it| ids.split_off(..*it as usize))?,
                ))
            })
            .collect();
        let (rect, lines) = (
            *numbers.split_off(..6)?.first_chunk()?,
            numbers.split_off(..lines as usize * 5)?.as_chunks().0,
        );
        Some(Node {
            id,
            container,
            role,
            properties,
            relations,
            children,
            rect,
            lines,
        })
    };
    while let Some(node) = next() {
        tree.add(&node);
    }
    let [root, focus, a, b, c, d] = head;
    tree.submit(
        image,
        zoom as f32,
        root,
        focus,
        [Point { node: a, offset: b }, Point { node: c, offset: d }],
        selected,
    );
}
