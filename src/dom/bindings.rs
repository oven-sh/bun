//! What `dom.bind.ts` declares.

use std::rc::Rc;

use crate::abi::Rect;
use crate::animation::Timing;
use crate::boxes::{BoxId, Kind};
use crate::cssom;
use crate::document::{Document, Environment, Quirks};
use crate::editing::{Mark, Point, Range};
use crate::name::Name;
use crate::properties::Prop;
use crate::scroll::Alignment;
use crate::selector::{List, Matcher, Pseudo, key};
use crate::sheet::{Block, Keyframe};
use crate::svg::Bounds;
use crate::tree::{DOCUMENT, Data, Flags, Namespace, NodeId, Replaced, State};
use crate::types::*;
use crate::values::{Color, Composite, Css, Ctx, Flow, Out, Str, parse_all, text};

/// With the last rectangle that was measured, and the number of panics since it last painted.
pub(crate) struct Engine(Box<Document>, [f32; 4], u8);

const MAX_PANICS: u8 = 3;

type Numbers = Vec<f64>;

fn numbers(values: impl IntoIterator<Item = f32>) -> Numbers {
    values.into_iter().map(f64::from).collect()
}

fn flat(rects: Vec<Rect>) -> Numbers {
    numbers(rects.into_iter().flat_map(Rect::to_array))
}

fn number(value: f64) -> Option<f32> {
    (!value.is_nan()).then_some(value as f32)
}

fn replaced(image: u32, width: f64, height: f64, ratio: f64) -> Replaced {
    Replaced {
        image,
        size: [number(width), number(height)],
        ratio: number(ratio).filter(|it| it.is_finite() && *it > 0.0),
    }
}

fn easing(source: &[u8]) -> Easing {
    parse_all(source, |p| Easing::parse(p, &Ctx::dummy())).unwrap_or_else(Easing::linear)
}

fn timing(values: &[f64], easing_source: &[u8]) -> Timing {
    use {AnimationDirection as D, FillMode as F};
    let at = |index: usize| values.get(index).copied().unwrap_or(0.0);
    Timing {
        delay: at(0),
        end_delay: at(1),
        relative_delays: [at(7), at(8)],
        duration: at(2),
        iterations: at(3),
        iteration_start: at(4),
        fill: [F::None, F::Forwards, F::Backwards, F::Both][at(5) as usize % 4],
        direction: [D::Normal, D::Reverse, D::Alternate, D::AlternateReverse][at(6) as usize % 4],
        easing: easing(easing_source),
    }
}

impl Document {
    /// An id that JavaScript has passed, or else no node.
    fn node(&self, id: NodeId) -> NodeId {
        if self.tree.contains(id) { id } else { 0 }
    }

    fn point(&self, node: NodeId, offset: u32) -> Point {
        let node = self.node(node);
        let Some(data) = self.tree[node].text() else {
            return Point {
                node,
                offset: self.node(offset),
            };
        };
        let mut units = 0;
        let found = text(data).char_indices().find(|(_, character)| {
            units += character.len_utf16() as u32;
            units > offset
        });
        Point {
            node,
            offset: found.map_or(data.len(), |it| it.0) as u32,
        }
    }

    fn range(&self, [a, b, c, d]: [u32; 4]) -> Range {
        [self.point(a, b), self.point(c, d)]
    }

    fn for_script(&self, point: Point) -> [u32; 2] {
        match self.tree[point.node].text() {
            Some(data) => [
                point.node,
                text(&data[..point.offset as usize]).encode_utf16().count() as u32,
            ],
            None => [point.node, point.offset],
        }
    }

    fn caret_for_script(&self, found: Option<(Point, bool)>) -> Vec<u32> {
        found.map_or(Vec::new(), |(point, upstream)| {
            self.for_script(point)
                .into_iter()
                .chain([upstream.into()])
                .collect()
        })
    }

    fn not_generated(&self, mut id: NodeId) -> NodeId {
        while [id, self.tree[id].parent]
            .into_iter()
            .any(|it| self.tree.element(it).is_some_and(|it| it.is_generated()))
        {
            id = self.tree.flat_parent(id);
        }
        id
    }

    fn selector(&mut self, source: &[u8]) -> Option<List> {
        if self.selectors.len() > 1024 {
            self.selectors.clear();
        }
        let is_quirky = self.environment.quirks == Quirks::All;
        let parser = crate::selector_parser::Parser {
            is_quirky,
            ..Default::default()
        };
        self.selectors
            .entry(bun_wyhash::hash(source) ^ u64::from(is_quirky))
            .or_insert_with(|| parser.parse(source))
            .clone()
    }

    /// `find` is also told how many can match at most.
    fn select<R>(
        &mut self,
        scope: NodeId,
        source: &[u8],
        find: impl FnOnce(&Document, &dyn Fn(&NodeId) -> bool, usize) -> R,
    ) -> Option<R> {
        let list = self.selector(source)?;
        self.update_directions();
        let host = self.tree.host_of(self.tree[scope].scope);
        let scope = if scope == DOCUMENT || self.tree.element(scope).is_some() {
            scope
        } else {
            NodeId::MAX
        };
        let matcher = Matcher::new(&self.tree, host, scope, None);
        let keys = list
            .iter()
            .map(|it| it.compounds[0].filter)
            .try_fold(0, |all, it| (it != 0).then_some(all | it));
        let may_match = |node: &crate::tree::Node| {
            keys.is_none_or(|it| node.keys & it != 0) && node.element().is_some()
        };
        let having = |key| self.attribute_keys.get(&key).map_or(0, |it| *it as usize);
        let limit = list
            .iter()
            .map(|it| {
                it.compounds[0]
                    .attribute_keys()
                    .map(having)
                    .min()
                    .unwrap_or(usize::MAX)
            })
            .fold(0, usize::saturating_add);
        Some(find(
            self,
            &|id| may_match(&self.tree[*id]) && matcher.any(&list, *id),
            limit,
        ))
    }

    fn keyframes(&self, offsets: &[f64], frames: &[impl AsRef<[u8]>]) -> Rc<[Keyframe]> {
        let frames = offsets.iter().zip(frames.as_chunks::<4>().0).map(
            |(offset, [range, function, composite, declarations])| Keyframe {
                offset: *offset as f32,
                block: Rc::new(Block::parse(
                    declarations.as_ref(),
                    Default::default(),
                    &self.base_url,
                )),
                easing: Some(easing(function.as_ref())),
                adds: Composite::from_name(composite.as_ref()),
                range: RangeName::from_name(range.as_ref()),
            },
        );
        frames.collect()
    }
}

impl Document {
    fn client_metrics(&self, node: NodeId) -> [f32; 4] {
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

    fn scroll_position(&self, node: NodeId) -> [f32; 2] {
        self.own_box(node).map_or([0.0; 2], |_| {
            self.scroll_offset(node).map(|it| it / self.zoom_of(node))
        })
    }

    fn scroll_size(&self, node: NodeId) -> [f32; 2] {
        let Some(own) = self.own_box(node) else {
            return [0.0; 2];
        };
        let (client, range) = (
            self.client_box(own),
            if self.pieces(own).is_some() {
                [[0.0; 2]; 2]
            } else {
                self.scroll_range(own)
            },
        );
        let extent =
            |size: f32, [min, max]: [f32; 2]| ((size + max - min) / self.zoom_of(node)).round();
        [
            extent(client.width, range[0]),
            extent(client.height, range[1]),
        ]
    }

    fn box_sizes(&self, node: NodeId) -> [f32; 6] {
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

    fn is_vertical(&self, node: NodeId) -> bool {
        self.own_box(node)
            .is_some_and(|it| self.boxes[it].mode.is_vertical())
    }

    /// The rects of the target, of the intersection and of the root.
    fn observe_intersection(
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
        let root = self.observed_root(root);
        let Rect { width, height, .. } = root.rect;
        let margin = |first: usize| {
            [0, 1, 2, 3].map(|side| {
                -at(first + side * 2) as f32
                    - at(first + side * 2 + 1) as f32 / 100.0 * [height, width][side % 2]
            })
        };
        let (root_margin, scroll_margin) = (margin(0), margin(8));
        let margin = [0, 1, 2, 3].map(|side| root_margin[side] + scroll_margin[side]);
        root.shrunk(margin, scroll_margin)
    }
}

/// The indexes of the records of `N` numbers that `is_changed`.
fn changed<const N: usize>(
    records: &[u8],
    mut is_changed: impl FnMut([f64; N]) -> bool,
) -> Option<Vec<u32>> {
    let records = bun_core::Unaligned::<f64>::slice_of(records)
        .as_chunks::<N>()
        .0
        .iter()
        .zip(0..);
    let found: Vec<_> = records
        .filter(|(record, _)| is_changed(record.each_ref().map(|it| it.get())))
        .map(|it| it.1)
        .collect();
    (!found.is_empty()).then_some(found)
}

type Strings<'a> = Vec<bun_core::Utf8Bytes<'a>>;

#[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
impl Engine {
    pub(crate) fn constructor(font_scope: u32, base_url: &[u8]) -> Engine {
        crate::recovery::install();
        Engine(Box::new(Document::new(font_scope, base_url)), [0.0; 4], 0)
    }

    #[inline]
    pub(crate) fn guarded<R: Default>(&mut self, run: impl FnOnce(&mut Engine) -> R) -> R {
        if self.is_broken() {
            return R::default();
        }
        crate::recovery::attempt(|| run(self)).unwrap_or_else(|| {
            self.recover();
            R::default()
        })
    }

    #[cold]
    fn recover(&mut self) {
        self.2 += 1;
        if self.is_broken() || crate::recovery::attempt(|| self.0.start_over()).is_none() {
            self.2 = MAX_PANICS;
            core::mem::forget(core::mem::replace(
                &mut self.0,
                Box::new(Document::new(0, b"")),
            ));
        }
    }

    pub(crate) fn is_broken(&self) -> bool {
        self.2 >= MAX_PANICS
    }

    pub(crate) fn panic_for_testing(&mut self) {
        panic!("for testing");
    }

    /// With the layout up to date.
    fn laid_out(&mut self, node: NodeId) -> (&mut Document, NodeId) {
        let node = self.0.node(node);
        self.0.catch_up_with_compositor();
        self.0.update_layout_for(node);
        (&mut self.0, node)
    }

    fn painted(&mut self) -> &mut Document {
        self.0.update_hits();
        &mut self.0
    }

    pub(crate) fn create_element(&mut self, local_name: &[u8], namespace: u8) -> u32 {
        let namespaces = [
            Namespace::Html,
            Namespace::Svg,
            Namespace::MathMl,
            Namespace::Other,
        ];
        let id = self
            .0
            .create_element(text(local_name), namespaces[usize::from(namespace.min(3))]);
        if namespace == 1 {
            self.0.update_hints(id);
        }
        id
    }

    pub(crate) fn create_text(&mut self, data: &[u8]) -> u32 {
        self.0.tree.create(Data::Text(data.to_vec()))
    }

    pub(crate) fn create_fragment(&mut self) -> u32 {
        self.0.tree.create(Data::Root)
    }

    pub(crate) fn create_document(&mut self) -> u32 {
        let id = self.0.tree.create(Data::Root);
        self.0.tree[id].set(crate::tree::Flags::OTHER_DOCUMENT);
        id
    }

    pub(crate) fn attach_shadow(&mut self, host: u32, user_agent: bool) -> u32 {
        match self.0.tree.element(host) {
            Some(_) => self.0.attach_shadow(host, user_agent),
            None => 0,
        }
    }

    pub(crate) fn insert(&mut self, parent: u32, child: u32, before: u32) {
        let tree = &self.0.tree;
        if tree.contains(parent)
            && tree.contains(child)
            && (before == 0 || tree.contains(before) && tree[before].parent == parent)
        {
            let before = if before == child {
                tree[child].next
            } else {
                before
            };
            self.0.insert(parent, child, before);
        }
    }

    pub(crate) fn move_node(&mut self, parent: u32, child: u32, before: u32) {
        let tree = &self.0.tree;
        if tree.contains(parent)
            && tree.contains(child)
            && (before == 0 || tree.contains(before) && tree[before].parent == parent)
        {
            let before = if before == child {
                tree[child].next
            } else {
                before
            };
            self.0.move_node(parent, child, before);
        }
    }

    pub(crate) fn remove(&mut self, node: u32) {
        if node != DOCUMENT && self.0.tree.contains(node) {
            self.0.remove(node);
        }
    }

    pub(crate) fn set_text(&mut self, node: u32, data: &[u8]) {
        self.0.set_text(self.0.node(node), data);
    }

    pub(crate) fn set_attribute(&mut self, node: u32, name: &[u8], value: &[u8]) {
        self.change_attribute(node, name, Some(text(value)));
    }

    pub(crate) fn remove_attribute(&mut self, node: u32, name: &[u8]) {
        self.change_attribute(node, name, None);
    }

    fn change_attribute(&mut self, node: u32, name: &[u8], value: Option<&str>) {
        let bases = &mut self.0.smil.effects.bases;
        match (!bases.is_empty())
            .then(|| bases.get_mut(&(node, Name::new(name))))
            .flatten()
        {
            Some(base) => (base.1, self.0.smil.needs_update) = (value.map(Str::from), true),
            None => self.0.set_attribute(node, text(name), value),
        }
    }

    pub(crate) fn set_state(&mut self, node: u32, bits: u32, on: bool) {
        if node == DOCUMENT {
            self.0.tree.is_xml = bits == 3;
            let quirks = [Quirks::None, Quirks::Limited, Quirks::All][bits as usize % 3];
            return self.0.set_environment(Environment {
                quirks,
                ..self.0.environment.clone()
            });
        }
        let Some(element) = self.0.tree.element(node) else {
            return;
        };
        let bits = State::from_bits_truncate(bits);
        self.0.change_state(
            node,
            if on {
                bits - element.state
            } else {
                bits & element.state
            },
        );
        if bits.intersects(State::FOCUS_WITHIN) {
            self.0.relevance_changed();
        }
        if bits.intersects(State::PICKER_OPEN | State::FORM_ASSOCIATED) {
            self.0.update_derived_state(node, false);
        }
    }

    pub(crate) fn set_custom_state(&mut self, node: u32, name: &[u8], on: bool) {
        let (Some(element), name) = (self.0.tree.element_mut(node), Name::new(name)) else {
            return;
        };
        element.custom_states.retain(|it| *it != name);
        element.custom_states.extend(on.then_some(name));
        self.0.feature_changed(node, key::custom_state(name));
    }

    pub(crate) fn set_pseudo(&mut self, node: u32, name: &[u8], originator: u32) {
        self.0.set_pseudo(node, name, self.0.node(originator));
    }

    pub(crate) fn assign_slot(&mut self, slot: u32, mut nodes: Vec<u32>) {
        nodes.retain(|it| self.0.tree.contains(*it));
        self.0.assign_slot(self.0.node(slot), nodes);
    }

    pub(crate) fn set_replaced(
        &mut self,
        node: u32,
        image: u32,
        width: f64,
        height: f64,
        ratio: f64,
    ) {
        self.0
            .set_replaced(node, Some(replaced(image, width, height, ratio)));
    }

    pub(crate) fn clear_replaced(&mut self, node: u32) {
        self.0.set_replaced(node, None);
    }

    pub(crate) fn set_top_layer(&mut self, mut nodes: Vec<u32>) {
        nodes.retain(|it| self.0.tree.element(*it).is_some());
        self.0.set_top_layer(nodes);
    }

    pub(crate) fn set_implicit_anchor(&mut self, node: u32, anchor: u32) {
        self.0.implicit_anchors.insert(node, anchor);
        self.0.relayout(self.0.node(node));
    }

    pub(crate) fn set_base_url(&mut self, url: &[u8]) {
        self.0.base_url = url.into();
    }

    pub(crate) fn set_language(&mut self, language: &[u8]) {
        self.0.tree.language = crate::values::text(language).into();
        let roots: Vec<_> = self.0.tree.element_children(DOCUMENT).collect();
        roots
            .into_iter()
            .for_each(|it| self.0.tree.mark_style(it, Flags::REMATCH_SUBTREE));
    }

    pub(crate) fn create_sheet(
        &mut self,
        source: &[u8],
        base_url: &[u8],
        media: &[u8],
        owner: u32,
    ) -> u32 {
        self.0.create_sheet(source, base_url, media, owner)
    }

    pub(crate) fn create_sheet_from_utf8(
        &mut self,
        source: &[u8],
        base_url: &[u8],
        media: &[u8],
        owner: u32,
    ) -> u32 {
        let source = source.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(source);
        match bun_core::strings::is_valid_utf8(source) {
            true => self.0.create_sheet(source, base_url, media, owner),
            false => self.0.create_sheet(
                String::from_utf8_lossy(source).as_bytes(),
                base_url,
                media,
                owner,
            ),
        }
    }

    pub(crate) fn prepare_sheet(&mut self, source: &[u8]) {
        if bun_core::strings::is_valid_utf8(source) {
            self.0
                .prepare_sheet(source.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(source));
        }
    }

    pub(crate) fn sheet_source(&self, sheet: u32) -> Out {
        self.0.sheet_source(sheet).to_vec()
    }

    pub(crate) fn release_sheet(&mut self, sheet: u32) {
        self.0.release_sheet(sheet);
    }

    pub(crate) fn sheet_imports(&mut self, sheet: u32) -> Vec<Out> {
        let imports = self
            .0
            .sheets
            .get(&sheet)
            .into_iter()
            .flat_map(|it| &it.imports);
        imports
            .flat_map(|it| [it.url.as_bytes().to_vec(), it.prelude.clone()])
            .collect()
    }

    pub(crate) fn set_sheets(&mut self, scope: u32, sheets: Vec<u32>) {
        if self.0.tree.contains(scope) {
            self.0.set_sheets(scope, &sheets);
        }
    }

    pub(crate) fn register_property(
        &mut self,
        name: &[u8],
        syntax: &[u8],
        inherits: bool,
        initial: Option<&[u8]>,
    ) -> bool {
        let registered =
            crate::custom::Registered::parse(syntax, inherits, initial, &self.0.base_url);
        registered.is_some_and(|it| self.0.register_property(crate::custom::remember(name), it))
    }

    pub(crate) fn match_media(&mut self, query: &[u8]) -> bool {
        let document = &mut *self.0;
        if document.media_queries.len() > 256 {
            document.media_queries.clear();
        }
        let parsed = document
            .media_queries
            .entry(bun_wyhash::hash(query))
            .or_insert_with(|| crate::condition::media_list(query).0);
        parsed.evaluate(&document.environment) == Some(true)
    }

    pub(crate) fn source_size(&mut self, sizes: &[u8]) -> f64 {
        crate::condition::source_size(sizes, &self.0.environment)
            .unwrap_or(self.0.environment.viewport[0])
            .into()
    }

    pub(crate) fn matches(&mut self, node: u32, selector: &[u8]) -> i32 {
        let node = self.0.node(node);
        self.0
            .select(node, selector, |_, matches, _| matches(&node).into())
            .unwrap_or(-1)
    }

    pub(crate) fn closest(&mut self, node: u32, selector: &[u8]) -> i32 {
        let node = self.0.node(node);
        let found = self.0.select(node, selector, |document, matches, limit| {
            core::iter::successors(Some(node), |it| Some(document.tree[*it].parent))
                .take_while(|it| *it != 0)
                .filter(matches)
                .take(limit)
                .next()
        });
        found.map_or(-1, |it| it.unwrap_or(0) as i32)
    }

    pub(crate) fn query_selector(&mut self, root: u32, selector: &[u8]) -> i32 {
        let root = self.0.node(root);
        let found = self.0.select(root, selector, |document, matches, limit| {
            document
                .tree
                .descendants(root)
                .filter(matches)
                .take(limit)
                .next()
        });
        found.map_or(-1, |it| it.unwrap_or(0) as i32)
    }

    pub(crate) fn query_selector_all(&mut self, root: u32, selector: &[u8]) -> Option<Vec<u32>> {
        let root = self.0.node(root);
        self.0.select(root, selector, |document, matches, limit| {
            document
                .tree
                .descendants(root)
                .filter(matches)
                .take(limit)
                .collect()
        })
    }

    pub(crate) fn set_environment(&mut self, values: Vec<f64>, flags: u32) {
        let at = |index: usize| values.get(index).map_or(f32::NAN, |it| *it as f32);
        let new = Environment {
            viewport: [at(0).max(0.0), at(1).max(0.0)],
            scale: at(2).max(0.01),
            zoom: at(3).max(0.01),
            screen: [at(4), at(5)],
            accent: values.get(6).map_or(0, |it| *it as u32),
            titlebar_area: (!at(7).is_nan()).then(|| [at(7), at(8), at(9), at(10)]),
            dark: flags & 1 != 0,
            reduced_motion: flags & 2 != 0,
            more_contrast: flags & 4 != 0,
            fullscreen: flags & 8 != 0,
            overlay_scrollbars: flags & 16 != 0,
            is_active: flags & 32 != 0,
            reduced_transparency: flags & 64 != 0,
            cannot_scroll: flags & 128 != 0,
            ..self.0.environment.clone()
        };
        self.0.set_environment(new);
    }

    pub(crate) fn set_color_scheme(&mut self, source: &[u8]) -> bool {
        let Some(color_scheme) = parse_all(source, |p| ColorScheme::parse(p, &Ctx::dummy())) else {
            return false;
        };
        self.0.set_environment(Environment {
            color_scheme,
            ..self.0.environment.clone()
        });
        true
    }

    pub(crate) fn fonts_changed(&mut self) {
        self.0.fonts_changed();
    }

    pub(crate) fn use_font(&mut self, family: &[u8], weight: u32, is_italic: bool) {
        self.0.use_font(family, weight as u16, is_italic);
    }

    pub(crate) fn set_image(
        &mut self,
        url: &[u8],
        image: u32,
        width: f64,
        height: f64,
        ratio: f64,
    ) {
        self.0
            .set_image(text(url), replaced(image, width, height, ratio));
    }

    pub(crate) fn take_requests(&mut self) -> Vec<Out> {
        self.0
            .take_requests()
            .into_iter()
            .map(|it: Str| it.as_bytes().to_vec())
            .collect()
    }

    pub(crate) fn set_external(&mut self, url: &[u8], source: &[u8]) {
        self.0.set_external(text(url), source);
    }

    pub(crate) fn create_vector(&self, source: &[u8], url: &[u8], font_scope: u32) -> Vec<f64> {
        let (id, natural) = crate::embedded::create_vector(source, url, font_scope);
        [id.into()]
            .into_iter()
            .chain(
                [natural.size[0], natural.size[1], natural.ratio]
                    .map(|it| it.map_or(f64::NAN, f64::from)),
            )
            .collect()
    }

    pub(crate) fn record_vector(&self, image: u32, width: f64, height: f64) -> u32 {
        self.0.record_vector(image, [width as f32, height as f32])
    }

    pub(crate) fn release_vector(&self, image: u32) {
        crate::embedded::release_vector(image);
    }

    pub(crate) fn take_vector_requests(&self, image: u32) -> impl IntoIterator<Item = Out> + use<> {
        crate::embedded::vector_requests(image)
            .into_iter()
            .map(|it| it.as_bytes().to_vec())
    }

    pub(crate) fn set_vector_image(
        &self,
        vector: u32,
        url: &[u8],
        image: u32,
        width: f64,
        height: f64,
        ratio: f64,
    ) {
        crate::embedded::set_vector_image(vector, text(url), replaced(image, width, height, ratio));
    }

    pub(crate) fn vector_fonts_changed(&self, image: u32) {
        crate::embedded::vector_fonts_changed(image);
    }

    pub(crate) fn view_transition(&mut self, step: u8, canvas: u32) -> u8 {
        match step {
            0 => self.0.capture_old_state(canvas).into(),
            1 => self.0.capture_new_state().into(),
            2 => self
                .0
                .update_view_transition()
                .map_or(0, |is_animated| 1 + u8::from(is_animated)),
            _ => {
                self.0.end_view_transition();
                1
            }
        }
    }

    pub(crate) fn show_fragment(&mut self) {
        self.0.show_fragment();
    }

    pub(crate) fn set_time(&mut self, now: f64) {
        self.0.set_time(now);
    }

    pub(crate) fn update_style(&mut self) {
        self.0.update_style();
    }

    pub(crate) fn update_layout(&mut self) -> u32 {
        self.0.update_layout();
        for _ in 0..3 {
            self.0.remember_sizes();
            if !self.0.update_auto_visibility() {
                break;
            }
            self.0.update_layout();
        }
        self.0.layout_version
    }

    pub(crate) fn sizes_version(&self) -> u32 {
        self.0.sizes_version
    }

    pub(crate) fn is_animating(&mut self) -> bool {
        self.0.is_animating() || self.0.scrolling.is_animating()
    }

    pub(crate) fn pending(&mut self) -> u32 {
        let document = &mut *self.0;
        document.request_fonts();
        document.report_finished_scrolls();
        u32::from(!document.events.is_empty() || document.scrolling.has_events()) << 1
            | u32::from(document.has_requests()) << 2
            | u32::from(document.needs_frame || document.is_dirty()) << 3
    }

    pub(crate) fn paint(&mut self, surface: u32) {
        self.0.update_scroll_timelines();
        self.0.update_style();
        self.0.start_pending_animations();
        self.0.remember_position_options();
        self.0.submit(surface);
        self.0.age_locks();
        self.0.collect_garbage();
        self.2 = 0;
    }

    pub(crate) fn next_wake(&mut self, for_iterations: bool) -> f64 {
        self.0.next_wake(for_iterations)
    }

    pub(crate) fn set_composited(&mut self, on: bool) {
        self.0.compositor.is_on = on;
        self.0.pictures.discard();
    }

    pub(crate) fn scrolled_by_compositor(
        &mut self,
        id: u32,
        x: f64,
        y: f64,
        has_ended: bool,
        generation: u32,
    ) {
        self.0
            .scrolled_by_compositor(id, [x, y], has_ended, generation);
    }

    pub(crate) fn set_blocks_wheel(&mut self, node: u32, on: bool) {
        let blockers = &mut self.0.compositor.wheel_blockers;
        if (if on {
            blockers.insert(node)
        } else {
            blockers.remove(&node)
        }) && self.0.compositor.is_on
        {
            self.0.pictures.discard();
        }
    }

    pub(crate) fn dump_display_list(&mut self) -> String {
        self.0.update_picture().dump()
    }

    pub(crate) fn take_events(&mut self) -> Out {
        self.0.emit_scroll_events();
        [b"[", &core::mem::take(&mut self.0.events)[..], b"]"].concat()
    }

    pub(crate) fn computed_style(&mut self, node: u32, pseudo: &[u8], property: &[u8]) -> Out {
        if property == b"-internal-text" {
            let (document, node) = self.laid_out(node);
            return document.generated_text(node, pseudo);
        }
        self.0.catch_up_with_compositor();
        self.0
            .computed_style(self.0.node(node), pseudo, property, true)
    }

    pub(crate) fn computed_value(&mut self, node: u32, property: &[u8]) -> Vec<Out> {
        self.0.catch_up_with_compositor();
        self.0
            .computed_value(self.0.node(node), property)
            .unwrap_or_default()
    }

    pub(crate) fn custom_property_names(&mut self, node: u32, pseudo: &[u8]) -> Vec<Out> {
        self.0.custom_property_names(self.0.node(node), pseudo)
    }

    pub(crate) fn style_bits(&mut self, node: u32, wanted: u32) -> u32 {
        const OF_BOXES: u32 = 1 | 1 << 5;
        let node = self.0.node(node);
        if wanted & OF_BOXES == 0 && !self.0.is_in_skipped_contents(node) {
            self.0.update_style_of(node);
            return self.0.style_bits(node, wanted) & wanted;
        }
        self.0.update_layout();
        if !self.0.auto_visible.is_empty()
            && self.0.style_bits(node, 0) >> 14 & 1 == 0
            && self.0.is_in_skipped_contents(node)
        {
            self.0.force_leaves(node);
        }
        self.0.style_bits(node, wanted) & wanted
    }

    pub(crate) fn base_appearance(&mut self, node: u32) -> u32 {
        let node = self.0.node(node);
        self.0.update_style();
        u32::from(self.0.tree[node].has(Flags::BASE_SELECT))
            | u32::from(self.0.tree[node].has(Flags::BASE_OPTIONS)) << 1
    }

    pub(crate) fn is_set_by_author(&mut self, node: u32, property: &[u8]) -> bool {
        let node = self.0.node(node);
        self.0.update_style();
        self.0.is_set_by_author(node, property)
    }

    pub(crate) fn bounding_rect(&mut self, node: u32) -> Numbers {
        let (document, node) = self.laid_out(node);
        numbers(document.bounding_rect(node).to_array())
    }

    pub(crate) fn client_rects(&mut self, node: u32) -> Numbers {
        let (document, node) = self.laid_out(node);
        flat(document.client_rects(node))
    }

    pub(crate) fn range_rects(&mut self, a: u32, b: u32, c: u32, d: u32) -> Numbers {
        let (document, _) = self.laid_out(a);
        flat(document.range_rects(&document.range([a, b, c, d])))
    }

    pub(crate) fn offset_metrics(&mut self, node: u32) -> Numbers {
        let (document, node) = self.laid_out(node);
        numbers(document.offset_metrics(node))
    }

    pub(crate) fn client_metrics(&mut self, node: u32) -> Numbers {
        let (document, node) = self.laid_out(node);
        numbers(document.client_metrics(node))
    }

    pub(crate) fn scroll_metrics(&mut self, node: u32) -> Numbers {
        let (document, node) = self.laid_out(node);
        numbers(
            document
                .scroll_position(node)
                .into_iter()
                .chain(document.scroll_size(node)),
        )
    }

    pub(crate) fn measure(&mut self, node: u32) -> f64 {
        let (document, node) = self.laid_out(node);
        self.1 = document.bounding_rect(node).to_array();
        self.1[0].into()
    }

    pub(crate) fn measured(&self, index: u8) -> f64 {
        self.1[usize::from(index) % 4].into()
    }

    pub(crate) fn metric(&mut self, node: u32, which: u8) -> f64 {
        let (document, node) = self.laid_out(node);
        let which = usize::from(which);
        f64::from(match which {
            0..4 => document.client_metrics(node)[which],
            4..6 => document.scroll_position(node)[which - 4],
            6..8 => document.scroll_size(node)[which - 6],
            13 => return document.last_scroll_request().into(),
            14 if document.tree[node].layout_box == 0 => 1.0,
            14 => document.zoom_of(node),
            15..17 => document.position_in_document(node)[which - 15],
            _ => document.offset_metrics(node)[(which - 8) % 5],
        })
    }

    pub(crate) fn last_viewport_scroll(&self, axis: u8) -> f64 {
        self.0.scroll_position(DOCUMENT)[usize::from(axis) % 2].into()
    }

    pub(crate) fn box_sizes(&mut self, node: u32) -> Numbers {
        let node = self.0.node(node);
        if node == DOCUMENT {
            return numbers(self.0.size_of_contents().into_iter());
        }
        numbers(
            self.0
                .box_sizes(node)
                .into_iter()
                .chain([self.0.is_vertical(node).into()]),
        )
    }

    pub(crate) fn changed_sizes(&self, records: &[u8], scale: f64) -> Option<Vec<u32>> {
        changed(records, |[node, kind, width, height]| {
            let sizes = match self.0.node(node as NodeId) {
                0 => [0.0; 6],
                node => self.0.box_sizes(node),
            };
            let size = match (kind as u8, sizes.map(f64::from)) {
                (0, [_, _, width, height, ..]) => [width, height],
                (1, [.., width, height]) => [width, height],
                (_, [_, _, width, height, ..]) => {
                    [(width * scale).round(), (height * scale).round()]
                }
            };
            let is_vertical = self.0.is_vertical(self.0.node(node as NodeId));
            size != (if is_vertical {
                [height, width]
            } else {
                [width, height]
            }) && !self.0.is_in_skipped_contents(self.0.node(node as NodeId))
        })
    }

    pub(crate) fn intersection(&mut self, node: u32, root: u32, margins: Vec<f64>) -> Numbers {
        let at = |index: usize| margins.get(index).copied().unwrap_or(0.0);
        let (target, intersection, root) =
            self.0
                .observe_intersection(self.0.node(node), self.0.node(root), at);
        let rects = [target, intersection.unwrap_or_default(), root];
        numbers(
            [intersection.is_some().into()]
                .into_iter()
                .chain(rects.into_iter().flat_map(Rect::to_array)),
        )
    }

    pub(crate) fn contentful(&mut self, only: u32) -> Numbers {
        self.0.update_layout();
        self.0.contentful(self.0.node(only))
    }

    pub(crate) fn changed_intersections(
        &self,
        records: &[u8],
        settings: &[u8],
    ) -> Option<Vec<u32>> {
        let settings = bun_core::Unaligned::<f64>::slice_of(settings);
        let mut roots = Vec::new();
        changed(records, |[node, root, crossed, first, thresholds]| {
            let (node, root) = (self.0.node(node as NodeId), self.0.node(root as NodeId));
            if node == 0 || root == 0 {
                return crossed != 0.0;
            }
            let at = |index: usize| {
                settings
                    .get(first as usize + index)
                    .map_or(0.0, |it| it.get())
            };
            let key = (root, core::array::from_fn::<_, 16, _>(at));
            let known = roots
                .iter()
                .position(|it: &(_, _)| it.0 == key)
                .unwrap_or_else(|| {
                    roots.push((key, self.0.root_of_observer(root, at)));
                    roots.len() - 1
                });
            let Some(intersection) = self.0.intersect(node, &mut roots[known].1) else {
                return crossed != 0.0;
            };
            if thresholds == 1.0 && at(16) == 0.0 {
                return crossed != 1.0;
            }
            let target = self.0.bounding_rect(node);
            let area = |it: Rect| f64::from(it.width) * f64::from(it.height);
            let ratio = if area(target) > 0.0 {
                (area(intersection) / area(target)).min(1.0)
            } else {
                1.0
            };
            (0..thresholds as usize)
                .take_while(|it| at(16 + it) <= ratio)
                .count() as f64
                != crossed
        })
    }

    pub(crate) fn svg_box(&mut self, node: u32, kind: u8) -> Numbers {
        let (document, node) = self.laid_out(node);
        numbers(
            document
                .svg_bounding_box(
                    node,
                    [Bounds::Fill, Bounds::Stroke, Bounds::Ink][usize::from(kind.min(2))],
                )
                .unwrap_or_default()
                .to_array(),
        )
    }

    pub(crate) fn svg_matrix(&mut self, node: u32, to_viewport: bool) -> Numbers {
        let (document, node) = self.laid_out(node);
        let matrix = if to_viewport {
            document.svg_screen_matrix(node)
        } else {
            Some(document.svg_viewport_matrix(node))
        };
        numbers(matrix.into_iter().flatten())
    }

    pub(crate) fn svg_point_at_length(&mut self, node: u32, distance: f64) -> Numbers {
        let (document, node) = self.laid_out(node);
        numbers(document.svg_point_at_length(node, distance as f32))
    }

    pub(crate) fn svg_characters(&mut self, node: u32) -> Vec<f64> {
        let (document, node) = self.laid_out(node);
        document
            .svg_characters(node)
            .into_iter()
            .map(f64::from)
            .collect()
    }

    pub(crate) fn svg_contains(&mut self, node: u32, x: f64, y: f64, in_stroke: bool) -> bool {
        let (document, node) = self.laid_out(node);
        document.svg_contains(node, [x as f32, y as f32], in_stroke)
    }

    pub(crate) fn svg_length(&mut self, node: u32, value: &[u8], axis: u8) -> f64 {
        let (document, node) = self.laid_out(node);
        let resolve = |it: crate::svg::Node| {
            Some(it.resolve(
                &document.parse_svg_length(&it, text(value))?,
                usize::from(axis.min(2)),
            ))
        };
        document
            .svg_node(node)
            .and_then(resolve)
            .map_or(f64::NAN, f64::from)
    }

    pub(crate) fn set_svg_zoom(&mut self, scale: f64, x: f64, y: f64) {
        self.0.svg_zoom = [scale, 0.0, 0.0, scale, x, y].map(|it| it as f32);
        self.0.svg_changed(self.0.tree.root_element());
    }

    pub(crate) fn control_smil(&mut self, node: u32, operation: u8, value: f64) -> Vec<f64> {
        let (node, document) = (self.0.node(node), &mut self.0);
        match operation {
            0 => document.start_smil(),
            1 => {
                return vec![
                    document.smil_time(node),
                    document.is_smil_paused(node).into(),
                ];
            }
            2 => document.seek_smil(node, value),
            3 => document.pause_smil(node, value != 0.0),
            4..8 => document.add_smil_instance(node, operation % 2 == 1, value, operation >= 6),
            8 => return document.smil_times(node).to_vec(),
            _ => document.smil.set_time(value),
        }
        Vec::new()
    }

    pub(crate) fn animated_attribute(&mut self, node: u32, name: &[u8]) -> Option<Out> {
        let (document, name) = (&mut self.0, Name::new(name));
        document.update_style();
        document
            .smil
            .effects
            .bases
            .contains_key(&(node, name))
            .then(|| {
                Some(
                    document
                        .tree
                        .element(node)?
                        .attribute(name)?
                        .as_bytes()
                        .to_vec(),
                )
            })?
    }

    pub(crate) fn scroll_to(&mut self, node: u32, x: f64, y: f64, behavior: u8) {
        let (document, node) = self.laid_out(node);
        let to = [x, y].map(|it| it as f32 * document.zoom_of(node));
        document.scroll_for_script(behavior & 8 != 0, |it| {
            it.scroll_to(node, to, behavior & 3, behavior & 4 != 0)
        });
    }

    pub(crate) fn scroll_into_view(
        &mut self,
        node: u32,
        block: u8,
        inline: u8,
        behavior: u8,
        only_nearest: bool,
    ) {
        use Alignment::*;
        self.0.update_style();
        if self.0.tree.contains(node) && !self.0.unlock_around(node) {
            return;
        }
        let (document, node) = self.laid_out(node);
        let align = [inline, block]
            .map(|it| [Start, Center, End, Nearest, CenterIfNeeded][usize::from(it.min(4))]);
        document.scroll_for_script(behavior & 8 != 0, |it| {
            it.scroll_into_view(node, align, behavior & 3, only_nearest)
        });
        if !document.carousels.is_empty() {
            document.pin_marker_around(node);
        }
    }

    pub(crate) fn reveal_point(&mut self, node: u32, offset: u32, upstream: bool) {
        let (document, node) = self.laid_out(node);
        if let Some((at, rect)) = document.caret_rect(document.point(node, offset), upstream) {
            document.reveal(at, rect, [Alignment::Nearest; 2], 1, false);
        }
    }

    pub(crate) fn user_scroll(
        &mut self,
        node: u32,
        dx: f64,
        dy: f64,
        unit: u8,
        smooth: bool,
    ) -> u32 {
        let (document, node) = self.laid_out(node);
        document.user_scroll(node, [dx as f32, dy as f32], unit, smooth)
    }

    pub(crate) fn scrollbar_mouse(&mut self, kind: u8, x: f64, y: f64) -> u32 {
        self.painted().scrollbar_mouse(kind, [x as f32, y as f32])
    }

    pub(crate) fn control_scrolling(&mut self, action: u8, part: u32) -> u32 {
        let (document, part) = self.laid_out(part);
        document.control_scrolling(action, part)
    }

    pub(crate) fn hit_test(&mut self, x: f64, y: f64) -> u32 {
        let document = self.painted();
        document
            .nodes_at([x as f32, y as f32])
            .next()
            .map_or(0, |it| document.not_generated(it))
    }

    pub(crate) fn hit_test_all(&mut self, x: f64, y: f64) -> Vec<u32> {
        let (document, mut found) = (self.painted(), Vec::new());
        for node in document.nodes_at([x as f32, y as f32]) {
            if !found.contains(&node) {
                found.push(node);
            }
        }
        let is_repeated = |it: &NodeId| {
            document.tree[*it].text().is_some() && found.contains(&document.tree.flat_parent(*it))
        };
        found
            .iter()
            .filter(|it| !is_repeated(it))
            .map(|it| document.not_generated(*it))
            .collect()
    }

    pub(crate) fn cursor_at(&mut self, x: f64, y: f64) -> &'static str {
        let (document, point) = (self.painted(), [x as f32, y as f32]);
        if let Some((id, crate::scroll::RESIZER)) = document.scrollbar_at(point) {
            let it = &document.boxes[id];
            return match (it.style.scroll.resize, it.mode.is_vertical()) {
                (Resize::Both, _) => {
                    if it.style.is_rtl() {
                        "nesw-resize"
                    } else {
                        "nwse-resize"
                    }
                }
                (Resize::Horizontal, _) | (Resize::Inline, false) | (Resize::Block, true) => {
                    "ew-resize"
                }
                _ => "ns-resize",
            };
        }
        let Some(node) = document
            .nodes_at(point)
            .next()
            .filter(|_| document.scrollbar_at(point).is_none())
        else {
            return "default";
        };
        let is_text = document.tree[node].text().is_some();
        let Some(style) = document.tree.style(if is_text {
            document.tree.flat_parent(node)
        } else {
            node
        }) else {
            return "default";
        };
        match style.ink.cursor.0 {
            CursorName::Auto
                if style.is_editable() || is_text && style.ink.user_select != UserSelect::None =>
            {
                "text"
            }
            CursorName::Auto => "default",
            cursor => cursor.name(),
        }
    }

    pub(crate) fn to_local(&mut self, node: u32, x: f64, y: f64) -> Numbers {
        let (document, node) = self.laid_out(node);
        let Some((at, rect)) = document.local_rects(node).first().copied() else {
            return vec![x, y];
        };
        let [x, y] = apply(
            &invert(&document.to_viewport(at)).unwrap_or(IDENTITY),
            [x as f32, y as f32],
        );
        numbers([x - rect.x, y - rect.y].map(|it| it / document.zoom_of(node)))
    }

    pub(crate) fn point_at(&mut self, root: u32, x: f64, y: f64) -> Vec<u32> {
        let document = self.painted();
        document.caret_for_script(document.point_at(document.node(root), [x as f32, y as f32]))
    }

    pub(crate) fn caret_rect(&mut self, node: u32, offset: u32, upstream: bool) -> Numbers {
        let (document, node) = self.laid_out(node);
        let caret = document.caret_rect(document.point(node, offset), upstream);
        flat(
            caret
                .iter()
                .map(|(at, rect)| rect.transformed(&document.to_viewport(*at)))
                .collect(),
        )
    }

    pub(crate) fn move_point(
        &mut self,
        root: u32,
        node: u32,
        offset: u32,
        upstream: bool,
        direction: u8,
        granularity: u8,
        x: f64,
    ) -> Vec<u32> {
        let (document, root) = self.laid_out(root);
        let moved = document.move_point(
            root,
            document.point(node, offset),
            upstream,
            direction,
            granularity,
            x as f32,
        );
        document.caret_for_script(moved)
    }

    pub(crate) fn expand_point(
        &mut self,
        root: u32,
        node: u32,
        offset: u32,
        granularity: u8,
    ) -> Vec<u32> {
        let (document, root) = self.laid_out(root);
        let range = document.expand_point(root, document.point(node, offset), granularity);
        range
            .into_iter()
            .flatten()
            .flat_map(|it| document.for_script(it))
            .collect()
    }

    pub(crate) fn set_selection(&mut self, a: u32, b: u32, c: u32, d: u32, caret: u8) {
        let (selection, caret) = (
            (a != 0).then(|| self.0.range([a, b, c, d])),
            (caret != 0).then_some(caret == 2),
        );
        let marks = &mut self.0.marks;
        if (marks.selection, marks.caret) != (selection, caret) {
            (marks.selection, marks.caret, marks.are_stale) = (selection, caret, true);
            self.0.relevance_changed();
            self.0.pictures.outdate();
        }
    }

    pub(crate) fn set_highlight(&mut self, name: &[u8], priority: i32, ranges: Vec<u32>) {
        let mark = if name.is_empty() {
            Mark::Composition
        } else {
            Mark::Highlight(Name::new(name))
        };
        let ranges: Vec<_> = ranges
            .as_chunks()
            .0
            .iter()
            .map(|it| self.0.range(*it))
            .collect();
        let marks = &mut self.0.marks;
        marks.highlights.retain(|it| it.0 != mark);
        marks
            .highlights
            .extend((!ranges.is_empty()).then_some((mark, priority, ranges)));
        marks.highlights.sort_by_key(|it| it.1);
        marks.are_stale = true;
        self.0.pictures.outdate();
    }

    pub(crate) fn rendered_text(
        &mut self,
        a: u32,
        b: u32,
        c: u32,
        d: u32,
        only_selectable: bool,
    ) -> Out {
        let (document, _) = self.laid_out(a);
        document.rendered_text(&document.range([a, b, c, d]), only_selectable)
    }

    pub(crate) fn inner_text(&mut self, node: u32) -> Out {
        let (document, node) = self.laid_out(node);
        document.inner_text(node)
    }

    pub(crate) fn reserve_animation(&mut self) -> u32 {
        self.0.reserve_animation()
    }

    pub(crate) fn create_animation(
        &mut self,
        id: u32,
        node: u32,
        pseudo: &[u8],
        values: Numbers,
        easing: &[u8],
    ) {
        self.0.create_animation(
            id,
            self.0.node(node),
            Pseudo::from_name(pseudo),
            timing(&values, easing),
        );
    }

    pub(crate) fn set_animation_target(&mut self, animation: u32, node: u32, pseudo: &[u8]) {
        self.0
            .set_target(animation, self.0.node(node), Pseudo::from_name(pseudo));
    }

    pub(crate) fn set_keyframes(
        &mut self,
        animation: u32,
        composite: &[u8],
        offsets: Option<Numbers>,
        frames: Strings,
    ) {
        let composite = Composite::from_name(composite).unwrap_or(Composite::Replace);
        self.0.set_keyframes(
            animation,
            offsets.map(|it| self.0.keyframes(&it, &frames)),
            composite,
        );
    }

    pub(crate) fn set_timing(
        &mut self,
        animation: u32,
        values: Numbers,
        easing: &[u8],
        members: u32,
    ) {
        self.0
            .set_timing(animation, timing(&values, easing), members as u16);
    }

    pub(crate) fn set_animation_range(&mut self, animation: u32, is_end: bool, range: &[u8]) {
        self.0.set_range(animation, is_end.into(), range);
    }

    pub(crate) fn set_animation_trigger(
        &mut self,
        animation: u32,
        timeline: u32,
        ranges: &[u8],
        behaviors: &[u8],
    ) {
        self.0
            .set_script_trigger(animation, timeline, ranges, behaviors);
    }

    pub(crate) fn set_animation_timeline(&mut self, animation: u32, timeline: u32, origin: f64) {
        self.0.set_timeline(animation, timeline, origin);
    }

    pub(crate) fn control_animation(&mut self, animation: u32, operation: u8, value: f64) -> bool {
        self.0.control_animation(animation, operation, value)
    }

    pub(crate) fn restore_animation(&mut self, animation: u32, state: Numbers) {
        self.0.restore_animation(animation, &state);
    }

    pub(crate) fn animation_state(&mut self, animation: u32) -> Numbers {
        if self.0.timing_depends_on_style(animation) {
            self.0.update_style();
        }
        self.0.animation_state(animation)
    }

    pub(crate) fn animation_info(&mut self, animation: u32) -> Vec<Out> {
        self.0.update_style();
        self.0.animation_info(animation)
    }

    pub(crate) fn computed_offsets(&mut self, animation: u32) -> Numbers {
        self.0.computed_offsets(animation)
    }

    pub(crate) fn computed_keyframes(&mut self, animation: u32) -> Vec<Out> {
        self.0.update_style();
        self.0.computed_keyframes(animation)
    }

    pub(crate) fn committed_styles(&mut self, animation: u32) -> Vec<Out> {
        self.0.update_style();
        self.0.committed_styles(animation)
    }

    pub(crate) fn get_animations(&mut self, node: u32, subtree: bool) -> Vec<u32> {
        self.0.update_layout();
        self.0.relevant_animations(node, subtree)
    }

    pub(crate) fn create_timeline(&mut self, node: u32, function: &[u8]) -> u32 {
        let cx = Ctx {
            zoom: self.0.zoom_of(node),
            ..Ctx::dummy()
        };
        let watched = parse_all(function, |p| Timeline::parse(p, &cx))
            .and_then(|it| self.0.find_timeline(self.0.node(node), &it));
        watched.map_or(0, |it| self.0.create_timeline(it))
    }

    pub(crate) fn set_timeline_node(&mut self, timeline: u32, node: Option<u32>) {
        self.0
            .set_watched_node(timeline, node.map(|it| self.0.node(it)));
    }

    pub(crate) fn timeline_state(&mut self, timeline: u32) -> Numbers {
        self.0.timeline_state(timeline)
    }

    pub(crate) fn advance_clock(&mut self, now: f64) {
        self.0.advance_clock(now);
    }
}

pub(crate) fn supports_declaration(name: &[u8], value: &[u8]) -> bool {
    crate::sheet::supports_declaration(name, value)
}

pub(crate) fn supports_condition(condition: &[u8]) -> bool {
    crate::condition::supports(condition, Default::default()) == Some(true)
}

pub(crate) fn parse_declarations(source: &[u8]) -> Vec<Out> {
    let mut out = Vec::new();
    crate::sheet::visit_declarations(source, |name, value, important| {
        out.extend([name, value, if important { b"important" } else { b"" }].map(<[u8]>::to_vec));
    });
    out
}

pub(crate) fn property_names() -> Vec<Out> {
    crate::properties::property_names()
}

pub(crate) fn longhands(name: &[u8]) -> impl IntoIterator<Item = &'static str> + use<> {
    Prop::from_name(name)
        .into_iter()
        .flat_map(cssom::longhands)
        .map(Prop::name)
}

pub(crate) fn shorthands_of(name: &[u8]) -> Vec<&'static str> {
    Prop::from_name(name).map_or(Vec::new(), cssom::shorthands_of)
}

pub(crate) fn expand_declaration(
    rule: &[u8],
    name: &[u8],
    value: &[u8],
    important: bool,
) -> Vec<Out> {
    cssom::expand(rule, name, value, important).unwrap_or_default()
}

pub(crate) fn join_shorthand(name: &[u8], values: &[u8]) -> Out {
    let Some(Prop::Short(index)) = Prop::from_name(name) else {
        return Out::new();
    };
    crate::shorthand::get(index).join(
        &bun_core::strings::split(values, b"\0").collect::<Vec<_>>(),
        None,
    )
}

pub(crate) fn split_rules(source: &[u8], has_declarations: bool, is_nested: bool) -> Vec<Out> {
    cssom::split(source, has_declarations, is_nested)
        .into_iter()
        .map(<[u8]>::to_vec)
        .collect()
}

pub(crate) fn parse_prelude(
    source: &[u8],
    parent: &[u8],
    body: Option<&[u8]>,
    namespaces: &[u8],
) -> Vec<Out> {
    cssom::prelude(source, parent, body, &cssom::namespaces(namespaces)).unwrap_or_default()
}

pub(crate) fn parse_easing(source: &[u8]) -> Out {
    let (cx, is_valid) = (
        Ctx::dummy(),
        crate::grammar::definition("<easing>").is_some_and(|it| it.accepts(source)),
    );
    let parsed = is_valid
        .then(|| parse_all(source, |p| Easing::parse(p, &cx)))
        .flatten();
    parsed
        .filter(|_| cx.deps.get().is_empty())
        .map_or(Out::new(), |it| it.written())
}

pub(crate) fn parse_keyframe_offset(source: &[u8]) -> Vec<Out> {
    cssom::keyframe_offset(source).map_or(Vec::new(), Into::into)
}

pub(crate) fn parse_pseudo_element(source: &[u8]) -> Out {
    cssom::pseudo_element(source).unwrap_or_default()
}

pub(crate) fn is_animatable(name: &[u8]) -> bool {
    Prop::from_name(name).is_some_and(|it| {
        it != Prop::All
            && it
                .longhands(Flow::DEFAULT)
                .iter()
                .any(|it| it.is_animatable())
    })
}

pub(crate) fn split_variables(source: &[u8]) -> Vec<Out> {
    cssom::split_variables(source)
}

pub(crate) fn split_value(source: &[u8], at_commas: bool) -> Vec<Out> {
    let parts = if at_commas {
        crate::grammar::split_list(source)
    } else {
        crate::hooks::words(source)
    };
    parts.into_iter().map(<[u8]>::to_vec).collect()
}

pub(crate) fn simplify_math(source: &[u8]) -> Out {
    cssom::simplify_math(source).unwrap_or_default()
}

pub(crate) fn parse_media(source: &[u8]) -> Vec<Out> {
    crate::condition::media_list(source).1
}

pub(crate) fn parse_color(source: &[u8], current: u32) -> f64 {
    parse_all(source, |p| Color::parse(p, &Ctx::dummy()))
        .map_or(-1.0, |it| it.resolve(current).into())
}

pub(crate) fn parse_transform(source: &[u8]) -> Numbers {
    numbers(
        parse_all(source, |p| Transforms::parse(p, &Ctx::dummy()))
            .into_iter()
            .flat_map(|it| it.matrix(0.0, 0.0)),
    )
}

pub(crate) fn decode_entity(name: &[u8]) -> Out {
    let mut buffer = [0; 8];
    bun_md::helpers::decode_entity_to_utf8(&[b"&", name, b";"].concat(), &mut buffer)
        .unwrap_or_default()
        .to_vec()
}
