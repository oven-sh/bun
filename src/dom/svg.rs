//! The geometry of inline SVG.

use core::f32::consts::SQRT_2;
use std::rc::Rc;

use crate::abi::{Matrix, Rect, RoundedRect};
use crate::boxes::{BoxId, Kind};
use crate::document::Document;
use crate::geometry::translation;
use crate::name::{Map, Name, Set, is_name, name};
use crate::path::{Numbers, Path, at_distance, distance};
use crate::properties::{Id, Style};
use crate::svg_paint::Reads;
use crate::svg_values::*;
use crate::tree::{Element, Namespace, NodeId, Tree};
use crate::types::*;
use crate::values::{Css, Ctx, Lp, Size, parse_all};

const MAX_DEPTH: u32 = 200;
const MAX_INSTANCES: u32 = 100_000;

pub(crate) fn has_svg_children(element: &Element) -> bool {
    element.namespace == Namespace::Svg && element.tag != name!("foreignObject")
}

pub(crate) fn scaling(x: f32, y: f32) -> Matrix {
    [x, 0.0, 0.0, y, 0.0, 0.0]
}

pub(crate) fn rotation(radians: f32) -> Matrix {
    let (sin, cos) = radians.sin_cos();
    [cos, sin, -sin, cos, 0.0, 0.0]
}

/// From the unit square.
pub(crate) fn onto(rect: Rect) -> Matrix {
    [rect.width, 0.0, 0.0, rect.height, rect.x, rect.y]
}

/// Unlike `Rect::union`, it does not leave out lines.
pub(crate) fn unite(a: Rect, b: Rect) -> Rect {
    Rect::from_edges(
        a.x.min(b.x),
        a.y.min(b.y),
        a.right().max(b.right()),
        a.bottom().max(b.bottom()),
    )
}

pub(crate) fn view_box(element: &Element) -> Option<Rect> {
    parse_view_box(element.attribute(name!("viewBox"))?)
}

pub(crate) fn parse_view_box(source: &str) -> Option<Rect> {
    let rect = Rect::new(Numbers::all(source)?.try_into().ok()?);
    (rect.width >= 0.0 && rect.height >= 0.0).then_some(rect)
}

pub(crate) fn ratio(element: &Element) -> Option<f32> {
    view_box(element)
        .filter(|it| !it.is_empty())
        .map(|it| it.width / it.height)
}

pub(crate) fn parse_transform(source: &str) -> Option<Matrix> {
    let (mut rest, mut all) = (source.as_bytes().trim_ascii(), IDENTITY);
    while !rest.is_empty() {
        let (function, after) = bun_core::strings::split_once_char(rest, b')')?;
        let (name, arguments) = bun_core::strings::split_once_char(function, b'(')?;
        let one = match (name.trim_ascii(), &Numbers::few(arguments)?[..]) {
            (b"matrix", [a, b, c, d, e, f]) => [*a, *b, *c, *d, *e, *f],
            (b"translate", [x]) => translation([*x, 0.0]),
            (b"translate", [x, y]) => translation([*x, *y]),
            (b"scale", [x]) => scaling(*x, *x),
            (b"scale", [x, y]) => scaling(*x, *y),
            (b"rotate", [degrees]) => Transform::rotation(*degrees).matrix(0.0, 0.0),
            (b"rotate", [degrees, x, y]) => {
                let turned = multiply(
                    &translation([*x, *y]),
                    &Transform::rotation(*degrees).matrix(0.0, 0.0),
                );
                multiply(&turned, &translation([-x, -y]))
            }
            (b"skewX", [degrees]) => [1.0, 0.0, degrees.to_radians().tan(), 1.0, 0.0, 0.0],
            (b"skewY", [degrees]) => [1.0, degrees.to_radians().tan(), 0.0, 1.0, 0.0, 0.0],
            _ => return None,
        };
        all = multiply(&all, &one);
        rest = after.trim_ascii();
        if let Some(more) = rest.strip_prefix(b",") {
            rest = Some(more.trim_ascii()).filter(|it| !it.is_empty())?;
        }
    }
    Some(all)
}

pub(crate) fn transform_attribute(element: &Element) -> Option<Matrix> {
    parse_transform(
        element
            .attribute(match element.tag {
                tag if is_name!(tag, "linearGradient" | "radialGradient") => {
                    name!("gradientTransform")
                }
                tag if tag == name!("pattern") => name!("patternTransform"),
                _ => name!("transform"),
            })
            .filter(|it| !it.trim_ascii().is_empty())?,
    )
}

/// What `preserveAspectRatio` makes of `view` in an area of this size.
pub(crate) fn fit_view(element: &Element, view: Rect, [width, height]: [f32; 2]) -> Matrix {
    let mut words = element
        .attribute(name!("preserveAspectRatio"))
        .unwrap_or_default()
        .split_ascii_whitespace();
    let part = |it: &[u8]| {
        ["Min", "Mid", "Max"]
            .iter()
            .position(|name| name.as_bytes() == it)
            .map(|it| it as f32 / 2.0)
    };
    let (first, second) = (words.next().unwrap_or_default().as_bytes(), words.next());
    let is_valid = matches!(second, None | Some("meet" | "slice")) && words.next().is_none();
    let (mut x, mut y, mut align) = (width / view.width, height / view.height, [0.0; 2]);
    if !(is_valid && first == b"none") {
        let given = match first {
            [b'x', a @ .., b'Y', _, _, _] if is_valid => {
                part(a).zip(part(&first[first.len() - 3..]))
            }
            _ => None,
        };
        align = given.map_or([0.5; 2], |it| [it.0, it.1]);
        x = if given.is_some() && second == Some("slice") {
            x.max(y)
        } else {
            x.min(y)
        };
        y = x;
    }
    [
        x,
        0.0,
        0.0,
        y,
        (width - view.width * x) * align[0] - view.x * x,
        (height - view.height * y) * align[1] - view.y * y,
    ]
}

pub(crate) fn percent_decoded(mut rest: &[u8]) -> Vec<u8> {
    let mut decoded = Vec::new();
    while let Some((first, after)) = rest.split_first() {
        let escaped = after
            .get(..2)
            .filter(|_| *first == b'%')
            .and_then(|it| u8::from_str_radix(crate::values::text(it), 16).ok());
        decoded.push(escaped.unwrap_or(*first));
        rest = &after[if escaped.is_some() { 2 } else { 0 }..];
    }
    decoded
}

pub(crate) fn href(element: &Element) -> Option<&str> {
    element
        .attribute(name!("href"))
        .or_else(|| element.attribute(name!("href http://www.w3.org/1999/xlink")))
}

pub(crate) fn is_graphic(element: &Element) -> bool {
    element.namespace == Namespace::Svg
        && is_name!(
            element.tag,
            "svg"
                | "g"
                | "a"
                | "switch"
                | "use"
                | "path"
                | "rect"
                | "circle"
                | "ellipse"
                | "line"
                | "polyline"
                | "polygon"
                | "text"
                | "image"
                | "foreignObject"
        )
}

pub(crate) fn passes_tests(element: &Element) -> bool {
    let is_english = |it: &[u8]| {
        matches!(
            it.trim_ascii(),
            [b'e' | b'E', b'n' | b'N'] | [b'e' | b'E', b'n' | b'N', b'-', ..]
        )
    };
    let is_known = |it: &str| {
        matches!(
            it,
            "http://www.w3.org/1999/xhtml" | "http://www.w3.org/1998/Math/MathML"
        )
    };
    element
        .attribute(name!("systemLanguage"))
        .is_none_or(|it| bun_core::strings::split(it.as_bytes(), b",").any(is_english))
        && (element.attribute(name!("requiredExtensions"))).is_none_or(|it| {
            !it.trim_ascii().is_empty() && it.split_ascii_whitespace().all(is_known)
        })
}

/// The `use` elements that something is shown by.
pub(crate) struct Uses<'a> {
    document: &'a Document,
    id: NodeId,
    target: NodeId,
    outer: Option<Rc<Uses<'a>>>,
}

/// An element in one of the places where it is shown.
#[derive(Clone)]
pub(crate) struct Node<'a> {
    pub(crate) document: &'a Document,
    pub(crate) id: NodeId,
    pub(crate) element: &'a Element,
    pub(crate) tag: Name,
    pub(crate) style: Rc<Style>,
    /// The size, in user units, that percentages refer to.
    pub(crate) viewport: [f32; 2],
    pub(crate) uses: Option<Rc<Uses<'a>>>,
    /// From the `use` whose target it is.
    size: [Option<f32>; 2],
    depth: u32,
}

impl Node<'_> {
    pub(crate) fn with_style(&self, style: Style) -> Self {
        Node {
            style: Rc::new(style),
            ..self.clone()
        }
    }

    /// Tells it from those of other documents.
    pub(crate) fn key(&self) -> (*const Document, NodeId) {
        (self.document, self.id)
    }

    /// `axis` is 2 for neither.
    fn basis(&self, axis: usize) -> f32 {
        let [width, height] = self.viewport;
        [width, height, width.hypot(height) / SQRT_2][axis]
    }

    pub(crate) fn resolve(&self, length: &Lp, axis: usize) -> f32 {
        length.resolve(self.basis(axis) * self.style.zoom) / self.style.zoom
    }

    pub(crate) fn specified_size(&self) -> [Option<f32>; 2] {
        if is_name!(self.tag, "svg" | "symbol" | "use") {
            return [(name!("width"), 0), (name!("height"), 1)]
                .map(|(name, axis)| Some(self.document.svg_length(self, name, axis)?.max(0.0)));
        }
        let layout = &self.style.layout;
        [(&layout.width, 0), (&layout.height, 1)].map(|(size, axis)| match size {
            Size::Length(length) => Some(self.resolve(length, axis).max(0.0)),
            _ => None,
        })
    }

    pub(crate) fn position(&self) -> [f32; 2] {
        [
            self.resolve(&self.style.shape.x, 0),
            self.resolve(&self.style.shape.y, 1),
        ]
    }

    pub(crate) fn stroke_width(&self) -> f32 {
        self.resolve(&self.style.svg.stroke_width.0, 2)
    }

    pub(crate) fn is_container(&self) -> bool {
        is_name!(
            self.tag,
            "svg"
                | "g"
                | "a"
                | "switch"
                | "use"
                | "symbol"
                | "marker"
                | "mask"
                | "pattern"
                | "clipPath"
                | "defs"
        )
    }

    pub(crate) fn establishes_viewport(&self) -> bool {
        is_name!(self.tag, "svg" | "symbol")
    }

    pub(crate) fn clips_overflow(&self) -> bool {
        !matches!(
            self.style.layout.overflow_x,
            Overflow::Visible | Overflow::Auto
        )
    }
}

fn transform_in(style: &Style, reference: Rect) -> Matrix {
    let [a, b, c, d, e, f] =
        style.transform(reference.width * style.zoom, reference.height * style.zoom);
    let own = multiply(
        &translation([reference.x, reference.y]),
        &[a, b, c, d, e / style.zoom, f / style.zoom],
    );
    multiply(&own, &translation([-reference.x, -reference.y]))
}

/// About what `non-scaling-stroke` makes of a length in user units.
fn fixed_scale(node: &Node, to_root: &Matrix) -> f32 {
    match node.style.shape.vector_effect {
        VectorEffect::None => 1.0,
        VectorEffect::NonScalingStroke => {
            node.style.zoom
                / (to_root[..4].iter().map(|it| it * it).sum::<f32>() / 2.0)
                    .sqrt()
                    .max(1e-6)
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Bounds {
    Fill,
    Stroke,
    /// At least what is painted.
    Ink,
}

#[derive(Default)]
pub(crate) struct Ids {
    answers: Map<(NodeId, Name), Option<NodeId>>,
    wanted: Set<Name>,
    found: Map<NodeId, Name>,
    /// The first element with each `id`, until the next change.
    of_scope: Map<NodeId, Map<Name, NodeId>>,
}

impl Ids {
    #[inline]
    pub(crate) fn tree_changed(&mut self) {
        self.of_scope.clear();
    }

    fn look_up(&mut self, tree: &Tree, scope: NodeId, id: Name) -> Option<NodeId> {
        if let Some(known) = self.answers.get(&(scope, id)) {
            return *known;
        }
        let found = [scope, crate::tree::DOCUMENT]
            .into_iter()
            .find_map(|scope| {
                let all = self.of_scope.entry(scope).or_insert_with(|| {
                    let mut all = Map::default();
                    for (node, element) in tree.descendants(scope).filter_map(|it| {
                        Some((it, tree.element(it).filter(|it| it.id != Name::NONE)?))
                    }) {
                        all.entry(element.id).or_insert(node);
                    }
                    all
                });
                all.get(&id).copied()
            });
        self.answers.insert((scope, id), found);
        self.wanted.insert(id);
        self.found.extend(found.map(|it| (it, id)));
        found
    }
}

impl Document {
    pub(crate) fn outer_svg(&self, mut id: NodeId) -> Option<NodeId> {
        self.tree
            .element(id)
            .filter(|it| it.namespace == Namespace::Svg)?;
        while self
            .tree
            .element(self.tree[id].parent)
            .is_some_and(has_svg_children)
        {
            id = self.tree[id].parent;
        }
        Some(id)
    }

    #[inline]
    pub(crate) fn svg_changed(&mut self, id: NodeId) {
        if self
            .tree
            .element(id)
            .is_some_and(|it| it.namespace == Namespace::Svg)
        {
            self.svg_or_reference_changed(id, true);
        }
    }

    fn svg_or_reference_changed(&mut self, id: NodeId, is_itself: bool) {
        let Some(outer) = self.outer_svg(id) else {
            return;
        };
        self.svg_changes = self.svg_changes.wrapping_add(1);
        if !self.path_bounds.get_mut().is_empty() {
            self.path_bounds.get_mut().remove(&id);
        }
        if self.tree.style(outer).is_some() {
            self.repaint(outer);
        }
        if let Some(users) = Some(self.referenced_svgs.get_mut())
            .filter(|it| !it.is_empty())
            .and_then(|it| it.remove(&outer))
        {
            self.svg_generation += 1;
            for user in users {
                if !self.tree.contains(user) {
                    continue;
                }
                match self.outer_svg(user) {
                    Some(_) => self.svg_or_reference_changed(user, false),
                    None => {
                        self.repaint_subtree(user);
                        self.boxes.mark_ink(self.nearest_box(user));
                    }
                }
            }
        }
        if let Some(own) = self.own_box(outer) {
            let recordings = self.boxes.recordings.get_mut();
            if !recordings.is_empty()
                && recordings
                    .get_mut(&own)
                    .is_some_and(|it| !it.note_change(&self.tree, id, outer, is_itself))
            {
                recordings.remove(&own);
            }
            if self.boxes[own].overflow.contains(&Overflow::Visible)
                || self.blends_in_svg.get()
                || !self.boxes[own].children.is_empty()
            {
                self.boxes.mark_ink(own);
            }
            if !self.boxes[own].children.is_empty() {
                self.relayout(outer);
            }
        }
    }

    /// False if it takes more than other colors for the shapes.
    pub(crate) fn svg_colors_changed(&mut self, id: NodeId) -> bool {
        let Some((outer, own)) = self
            .outer_svg(id)
            .and_then(|it| Some((it, self.own_box(it)?)))
        else {
            return false;
        };
        let is_enough = self
            .boxes
            .recordings
            .get_mut()
            .get(&own)
            .is_some_and(crate::svg_paint::Recording::can_be_tinted)
            && !self.referenced_svgs.get_mut().contains_key(&outer);
        if is_enough {
            self.retouch(own, crate::segments::Retouch::SHAPES);
        }
        is_enough
    }

    /// The element that the URL refers to.
    pub(crate) fn svg_reference(&self, from: NodeId, url: &str) -> Option<Node<'_>> {
        match self.fragment_of(url) {
            Some(id) => self.svg_node(self.svg_element_by_id(from, id)?),
            None => self.external_reference(url),
        }
    }

    pub(crate) fn svg_element_by_id(&self, from: NodeId, id: Name) -> Option<NodeId> {
        let own = self.tree[from].scope;
        self.svg_has_read(Reads::REFERENCES);
        let found = self.svg_ids.borrow_mut().look_up(&self.tree, own, id);
        let user = self.outer_svg(from).unwrap_or(from);
        self.referenced_svgs
            .borrow_mut()
            .entry(self.outer_svg(found?)?)
            .or_default()
            .insert(user);
        found
    }

    pub(crate) fn is_cross_origin(&self, url: &str) -> bool {
        let url = self.resolve_url(url);
        let origin = |it: &'_ [u8]| {
            bun_core::strings::split(it, b"/")
                .take(3)
                .map(<[u8]>::to_vec)
                .collect::<Vec<_>>()
        };
        !url.starts_with("data:")
            && !url.starts_with("blob:")
            && !url.starts_with('#')
            && origin(url.as_bytes()) != origin(&self.base_url)
    }

    /// If it is a URL in this document.
    pub(crate) fn fragment_of(&self, url: &str) -> Option<Name> {
        let (document, fragment) =
            bun_core::strings::split_once_char(url.trim_ascii().as_bytes(), b'#')?;
        let without_fragment =
            |it: &'_ [u8]| bun_core::strings::index_of_char_usize(it, b'#').unwrap_or(it.len());
        if !document.is_empty() {
            let cx = Ctx {
                base_url: &self.base_url,
                ..Ctx::dummy()
            };
            (cx.url(document).as_bytes() == &self.base_url[..without_fragment(&self.base_url)])
                .then_some(())?;
        }
        Some(Name::new(&percent_decoded(fragment)))
    }

    /// The element has come, or its `id` has changed.
    pub(crate) fn id_changed(&mut self, id: NodeId) {
        let name = self.tree.element(id).map(|it| it.id);
        let ids = self.svg_ids.get_mut();
        ids.tree_changed();
        if ids.found.get(&id).map_or_else(
            || name.is_some_and(|it| ids.wanted.contains(&it)),
            |it| Some(*it) != name,
        ) {
            self.forget_svg_references();
        }
    }

    pub(crate) fn nodes_removed(&mut self, ids: &[NodeId]) {
        let known = self.svg_ids.get_mut();
        known.tree_changed();
        if !known.found.is_empty() && ids.iter().any(|it| known.found.contains_key(it)) {
            self.forget_svg_references();
        }
    }

    fn forget_svg_references(&mut self) {
        self.svg_ids.take();
        self.smil.needs_update = !self.smil.is_empty();
        self.referenced_svgs.get_mut().clear();
        self.referenced_svg_changed();
    }

    pub(crate) fn referenced_svg_changed(&mut self) {
        self.svg_changes = self.svg_changes.wrapping_add(1);
        self.svg_generation += 1;
        self.pictures.discard();
        if !self.referenced_svgs.get_mut().is_empty() {
            self.boxes.forget_all_extents();
        }
    }

    pub(crate) fn svg_resource(&self, from: NodeId, url: &str, tag: Name) -> Option<Node<'_>> {
        self.svg_resource_with(from, url, |it| it == tag)
    }

    /// `viewport` is that of what is filtered.
    pub(crate) fn filter_element(
        &self,
        from: NodeId,
        url: &str,
        viewport: [f32; 2],
    ) -> Option<Node<'_>> {
        Some(Node {
            viewport,
            ..self
                .svg_reference(from, url)
                .filter(|it| it.tag == name!("filter"))?
        })
    }

    /// One that is not in something with `display: none`.
    pub(crate) fn svg_resource_with(
        &self,
        from: NodeId,
        url: &str,
        accepts: impl Fn(Name) -> bool,
    ) -> Option<Node<'_>> {
        let has_layout = |it: &Node| {
            it.document
                .tree
                .style(it.document.tree.flat_parent(it.id))
                .is_some_and(|it| it.display() != Display::None)
        };
        self.svg_reference(from, url)
            .filter(|it| accepts(it.tag) && has_layout(it))
    }

    pub(crate) fn svg_node(&self, id: NodeId) -> Option<Node<'_>> {
        let element = self
            .tree
            .element(id)
            .filter(|it| it.namespace == Namespace::Svg)?;
        let is_viewport = |it: &NodeId| {
            self.tree
                .element(*it)
                .is_some_and(|it| it.tag == name!("svg"))
        };
        let around = self
            .tree
            .flat_ancestors(id)
            .take_while(|it| self.tree.element(*it).is_some_and(has_svg_children))
            .find(is_viewport);
        let viewport = around
            .filter(|_| bun_core::StackCheck::init().is_safe_to_recurse())
            .and_then(|it| self.svg_node(it))
            .map_or([0.0; 2], |it| self.inner_viewport(&it));
        Some(Node {
            document: self,
            id,
            element,
            tag: element.tag,
            style: self.style_on_demand(id)?,
            viewport,
            uses: None,
            size: [None; 2],
            depth: 0,
        })
    }

    pub(crate) fn svg_child<'a>(
        &'a self,
        parent: &Node<'a>,
        id: NodeId,
        viewport: [f32; 2],
    ) -> Option<Node<'a>> {
        let element = self.tree.element(id)?;
        let is_instance = parent.uses.is_some();
        let style = match &parent.uses {
            Some(uses) => self.instance_style(id, uses.target, &parent.style),
            None => self.style_on_demand(id)?,
        };
        ((!is_instance || self.spend_svg_budget())
            && parent.depth < MAX_DEPTH
            && style.display() != Display::None)
            .then_some(())?;
        Some(Node {
            document: self,
            id,
            element,
            tag: element.tag,
            style,
            viewport,
            uses: parent.uses.clone(),
            size: [None; 2],
            depth: parent.depth + 1,
        })
    }

    pub(crate) fn reset_svg_budget(&self) {
        self.svg_budget.set(MAX_INSTANCES);
        self.externals
            .values()
            .flatten()
            .for_each(|it| it.reset_svg_budget());
    }

    pub(crate) fn spend_svg_budget(&self) -> bool {
        self.svg_budget
            .get()
            .checked_sub(1)
            .map(|it| self.svg_budget.set(it))
            .is_some()
    }

    fn use_target<'a>(&'a self, node: &Node<'a>) -> Option<Node<'a>> {
        let url = href(node.element).filter(|it| {
            !it.trim_ascii_start().starts_with("data:") || self.fragment_of(it).is_some()
        })?;
        let Node {
            document,
            id: target,
            element,
            ..
        } = self.svg_reference(node.id, url)?;
        ((is_graphic(element) || element.tag == name!("symbol"))
            && element.tag != name!("foreignObject")
            && passes_tests(element))
        .then_some(())?;
        let uses = Rc::new(Uses {
            document: self,
            id: node.id,
            target,
            outer: node.uses.clone(),
        });
        let mut chain = core::iter::successors(Some(&uses), |it| it.outer.as_ref())
            .filter(|it| core::ptr::eq(it.document, document));
        chain
            .all(|it| {
                it.id != target && !document.tree.flat_ancestors(it.id).any(|it| it == target)
            })
            .then_some(())?;
        let host = Node {
            uses: Some(uses),
            ..node.clone()
        };
        Some(Node {
            size: node.specified_size(),
            ..document.svg_child(&host, target, node.viewport)?
        })
    }

    /// Selectors see nothing outside of `root`.
    fn instance_style(&self, id: NodeId, root: NodeId, parent: &Rc<Style>) -> Rc<Style> {
        let outer = self.tree.cut_at.replace(root);
        let rules = self.match_rules(id, None, false);
        self.tree.cut_at.set(outer);
        let own = self.tree.style(id).filter(|_| {
            self.tree
                .element(id)
                .is_some_and(|it| it.rules.as_ref().is_some_and(|it| Rc::ptr_eq(it, &rules)))
        });
        match own.filter(|_| {
            self.tree
                .style(self.tree[id].parent)
                .is_some_and(|it| it.inherits_the_same_as(parent))
        }) {
            Some(own) => Rc::clone(own),
            None => self.compute_style(id, &rules, parent),
        }
    }

    pub(crate) fn viewport_in(&self, node: &Node) -> [f32; 2] {
        if node.establishes_viewport() {
            self.inner_viewport(node)
        } else {
            node.viewport
        }
    }

    /// Those that are rendered.
    pub(crate) fn svg_children<'a>(&'a self, node: &Node<'a>) -> Vec<Node<'a>> {
        if node.tag == name!("use") {
            return self.use_target(node).into_iter().collect();
        }
        let viewport = self.viewport_in(node);
        let is_rendered = |it: &Element| {
            is_graphic(it)
                && passes_tests(it)
                && (node.uses.is_none() || it.tag != name!("foreignObject"))
        };
        let clips = |it: &Element| {
            !is_name!(
                it.tag,
                "svg" | "g" | "a" | "switch" | "image" | "foreignObject"
            )
        };
        let mut children = self.tree.element_children(node.id);
        if node.tag == name!("switch") {
            let first = children.find(|it| {
                self.tree
                    .element(*it)
                    .is_some_and(|it| it.namespace == Namespace::Svg && passes_tests(it))
            });
            let first = first.filter(|it| self.tree.element(*it).is_some_and(is_rendered));
            return first
                .and_then(|it| self.svg_child(node, it, viewport))
                .into_iter()
                .collect();
        }
        if node.tag == name!("clipPath") {
            let is_direct = |it: &Node<'a>| {
                it.tag != name!("use")
                    || self
                        .use_target(it)
                        .is_some_and(|it| !it.is_container() && it.tag != name!("image"))
            };
            let shapes = children.filter(|it| {
                self.tree
                    .element(*it)
                    .is_some_and(|it| is_rendered(it) && clips(it))
            });
            return shapes
                .filter_map(|it| self.svg_child(node, it, viewport))
                .filter(is_direct)
                .collect();
        }
        let rendered = children.filter(|it| self.tree.element(*it).is_some_and(is_rendered));
        rendered
            .filter_map(|it| self.svg_child(node, it, viewport))
            .collect()
    }

    /// Those that are rendered.
    pub(crate) fn foreign_objects_in(&self, svg: NodeId) -> Vec<NodeId> {
        let (mut found, mut waiting) = (Vec::new(), vec![svg]);
        while let Some(id) = waiting.pop() {
            let Some(element) = self
                .tree
                .element(id)
                .filter(|it| it.namespace == Namespace::Svg)
            else {
                continue;
            };
            let (passes, start) = (
                |it: &NodeId| {
                    self.tree
                        .element(*it)
                        .is_some_and(|it| it.namespace == Namespace::Svg && passes_tests(it))
                },
                waiting.len(),
            );
            match element.tag {
                tag if tag == name!("foreignObject") => found.push(id),
                tag if tag == name!("switch") => {
                    waiting.extend(self.tree.element_children(id).find(passes))
                }
                tag if is_name!(tag, "svg" | "g" | "a") => {
                    waiting.extend(self.tree.element_children(id).filter(passes))
                }
                _ => {}
            }
            waiting[start..].reverse();
        }
        found
    }

    fn outer_box(&self, node: &Node) -> Option<BoxId> {
        self.own_box(node.id)
            .filter(|it| node.uses.is_none() && self.boxes[*it].kind == Kind::Svg)
    }

    /// Of an `svg` or a `symbol`, in the user space around it.
    pub(crate) fn viewport_rect(&self, node: &Node) -> Rect {
        if let Some(own) = self.outer_box(node) {
            let [x, y, width, height] = self.content_box(own);
            let [width, height] = self.svg_size_in_layout.get().unwrap_or([width, height]);
            return Rect::new([x, y, width, height].map(|it| it / node.style.zoom));
        }
        let ([x, y], own) = (node.position(), node.specified_size());
        let [width, height] =
            [0, 1].map(|axis| node.size[axis].or(own[axis]).unwrap_or(node.viewport[axis]));
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn inner_viewport(&self, node: &Node) -> [f32; 2] {
        let view = view_box(node.element)
            .filter(|it| !it.is_empty())
            .unwrap_or_else(|| {
                let rect = self.viewport_rect(node);
                self.synthesized_view(node, rect).unwrap_or(rect)
            });
        [view.width, view.height]
    }

    /// From the user space in the `svg` or `symbol` to the one around it. `None` if nothing is rendered.
    pub(crate) fn view_transform(&self, node: &Node) -> Option<Matrix> {
        let (element, rect) = (node.element, self.viewport_rect(node));
        let view = match view_box(element) {
            Some(view) if view.is_empty() => return None,
            Some(view)
                if self.stretches_view && node.uses.is_none() && self.tree.is_root(node.id) =>
            {
                multiply(
                    &scaling(rect.width / view.width, rect.height / view.height),
                    &translation([-view.x, -view.y]),
                )
            }
            Some(view) => fit_view(element, view, [rect.width, rect.height]),
            None => self.synthesized_view(node, rect).map_or(IDENTITY, |it| {
                scaling(rect.width / it.width, rect.height / it.height)
            }),
        };
        let view = if self.tree.is_root(node.id) && node.uses.is_none() {
            multiply(&self.svg_zoom, &multiply(&view, &self.view_transform))
        } else {
            view
        };
        Some(multiply(&translation([rect.x, rect.y]), &view))
    }

    pub(crate) fn parse_svg_length(&self, node: &Node, value: &str) -> Option<Lp> {
        let style = &node.style;
        let metrics = || style.metrics;
        let viewport = self.environment.viewport;
        if value
            .bytes()
            .any(|it| matches!(it | 0x20, b'v' | b'r' | b'q'))
        {
            self.svg_has_read(Reads::ANYTHING);
        }
        let cx = Ctx {
            font: style.font_units(),
            root: self.environment.root_font,
            metrics: &metrics,
            viewport,
            zoom: style.zoom,
            ..Ctx::dummy()
        };
        parse_all(value.as_bytes(), |p| SvgLength::parse(p, &cx)).map(|it| it.0)
    }

    pub(crate) fn natural_size_of_svg(&self, id: NodeId) -> [Option<f32>; 2] {
        [name!("width"), name!("height")].map(|name| {
            let value = self.tree.element(id)?.attribute(name)?;
            let length = match value.parse::<f32>() {
                Ok(number) => Lp::Px(number * self.tree.style(id)?.zoom),
                _ => self.parse_svg_length(&self.svg_node(id)?, value)?,
            };
            if let Lp::Px(length @ 0.0..1e9) = length {
                Some(length)
            } else {
                None
            }
        })
    }

    pub(crate) fn svg_length(&self, node: &Node, name: Name, axis: usize) -> Option<f32> {
        Some(node.resolve(
            &self.parse_svg_length(node, node.element.attribute(name)?)?,
            axis,
        ))
    }

    pub(crate) fn svg_number(&self, id: NodeId, name: Name) -> Option<f32> {
        match Numbers::all(self.tree.element(id)?.attribute(name)?)?[..] {
            [number] => Some(number),
            _ => None,
        }
    }

    /// Of a `foreignObject`, in zoomed pixels: the position, and what percentages refer to.
    pub(crate) fn foreign_placement(&self, id: NodeId, outer_size: [f32; 2]) -> [[f32; 2]; 2] {
        self.svg_size_in_layout.set(Some(outer_size));
        let node = self.svg_node(id);
        self.svg_size_in_layout.set(None);
        node.map_or([[0.0; 2]; 2], |it| {
            [it.position(), it.viewport].map(|pair| pair.map(|one| one * it.style.zoom))
        })
    }

    pub(crate) fn svg_image(&self, node: &Node) -> Option<crate::tree::Replaced> {
        let url = href(node.element).filter(|it| !it.trim_ascii().is_empty())?;
        self.oriented_image(&self.resolve_url(url), &node.style)
    }

    /// Of an `image` or a `foreignObject`.
    pub(crate) fn svg_rect(&self, node: &Node) -> Rect {
        let ([x, y], size) = (node.position(), node.specified_size());
        let image = (node.tag == name!("image") && size.contains(&None))
            .then(|| self.svg_image(node))
            .flatten();
        let [width, height] = match image {
            Some(image) => {
                crate::background::concrete_size(size, image.size, image.ratio, [300.0, 150.0])
            }
            None => size.map(|it| it.unwrap_or(0.0)),
        };
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    pub(crate) fn svg_path(&self, node: &Node) -> Option<Path> {
        let (element, shape) = (node.element, &node.style.shape);
        let length = |name, axis| self.svg_length(node, name, axis).unwrap_or(0.0);
        let radii = || {
            let [rx, ry] = [(&shape.rx, 0), (&shape.ry, 1)]
                .map(|(it, axis)| Some(node.resolve(&it.0.as_ref()?.0, axis)));
            [rx.or(ry).unwrap_or(0.0), ry.or(rx).unwrap_or(0.0)]
        };
        Some(match element.tag {
            tag if tag == name!("path") => {
                let data = match &shape.d {
                    PathData::Attribute => element.attribute(name!("d")).unwrap_or_default(),
                    PathData::None => "",
                    PathData::Path(data) => data,
                };
                let mut known = self.paths.borrow_mut();
                if known.len() >= 256 {
                    known.clear();
                }
                known
                    .entry_ref(data)
                    .or_insert_with(|| Path::parse(data))
                    .clone()
            }
            tag if is_name!(tag, "polyline" | "polygon") => {
                let numbers: Vec<_> = Numbers(
                    element
                        .attribute(name!("points"))
                        .unwrap_or_default()
                        .as_bytes(),
                )
                .collect();
                Path::polygon(
                    numbers.as_chunks().0.iter().copied(),
                    tag == name!("polygon"),
                )
            }
            tag if tag == name!("line") => Path::polygon(
                [
                    [length(name!("x1"), 0), length(name!("y1"), 1)],
                    [length(name!("x2"), 0), length(name!("y2"), 1)],
                ],
                false,
            ),
            tag if is_name!(tag, "circle" | "ellipse") => {
                let radii = if tag == name!("circle") {
                    [node.resolve(&shape.r.0, 2); 2]
                } else {
                    radii()
                };
                Path::ellipse(
                    [node.resolve(&shape.cx, 0), node.resolve(&shape.cy, 1)],
                    radii,
                )
            }
            tag if tag == name!("rect") => {
                let (rect, [rx, ry]) = (self.svg_rect(node), radii());
                match [rx.min(rect.width / 2.0), ry.min(rect.height / 2.0)] {
                    [0.0, _] | [_, 0.0] => Path::rect(rect),
                    radius => Path::rounded_rect(&RoundedRect {
                        rect,
                        radii: [radius; 4],
                    }),
                }
            }
            _ => return None,
        })
    }

    /// Unless a size of 0 keeps it from being rendered.
    pub(crate) fn rendered_path(&self, node: &Node) -> Option<Path> {
        let path = self.svg_path(node)?;
        (!is_name!(node.tag, "rect" | "circle" | "ellipse") || !path.bounds()?.is_empty())
            .then_some(path)
    }

    /// If they only depend on the element.
    fn bounds_of_points(&self, node: &Node) -> Option<Option<Rect>> {
        (is_name!(node.tag, "path" | "polyline" | "polygon")
            && node.uses.is_none()
            && node
                .element
                .style
                .as_ref()
                .is_some_and(|it| Rc::ptr_eq(it, &node.style)))
        .then_some(())?;
        let known = self.path_bounds.borrow().get(&node.id).copied();
        Some(known.unwrap_or_else(|| {
            let bounds = self
                .svg_path(node)
                .filter(|it| !it.verbs.is_empty())
                .map(|it| it.bounds().unwrap_or_default());
            self.path_bounds.borrow_mut().insert(node.id, bounds);
            bounds
        }))
    }

    /// How far the stroke can be from the path.
    pub(crate) fn stroke_reach(node: &Node, is_exact: bool) -> f32 {
        let svg = &node.style.svg;
        let has_corners = !is_name!(node.tag, "circle" | "ellipse" | "line")
            && !(is_exact && node.tag == name!("rect"));
        let miter = if svg.linejoin == LineJoin::Miter && has_corners {
            svg.miterlimit.0.max(1.0)
        } else {
            1.0
        };
        let has_ends = is_name!(node.tag, "path" | "line" | "polyline") || !is_exact;
        node.stroke_width() / 2.0
            * miter.max(if svg.linecap == LineCap::Square && has_ends {
                SQRT_2
            } else {
                1.0
            })
    }

    /// In the user space of the element. `None` for a container that has nothing in it.
    pub(crate) fn svg_bounds<'a>(&'a self, node: &Node<'a>, kind: Bounds) -> Option<Rect> {
        if node.is_container() {
            let children = self.svg_children(node);
            let shown = children.iter().filter(|it| {
                it.is_container() || it.tag == name!("text") || it.document.has_geometry(it)
            });
            let of_child = |it: &Node| {
                let own = it.document.svg_bounds(it, kind);
                let own = if kind == Bounds::Ink && !it.style.effects.filter.0.is_empty() {
                    Some(it.document.svg_filtered(it, own))
                } else {
                    own
                };
                Some(own?.transformed(&it.document.svg_to_parent(it)?))
            };
            return shown.filter_map(of_child).reduce(unite);
        }
        let fill = match self
            .bounds_of_points(node)
            .or_else(|| Some(self.svg_path(node)?.bounds()))
        {
            Some(bounds) => bounds.unwrap_or_default(),
            None if is_name!(node.tag, "image" | "foreignObject") => {
                return Some(self.svg_rect(node));
            }
            None => self.svg_text_bounds(node)?,
        };
        if kind == Bounds::Fill {
            return Some(fill);
        }
        let mut reach = if node.style.svg.stroke == SvgPaint::None {
            0.0
        } else {
            Document::stroke_reach(node, kind != Bounds::Ink)
        };
        let mut to_root = IDENTITY;
        if node.style.shape.vector_effect != VectorEffect::None
            && !self.is_measuring_stroke.replace(true)
        {
            to_root = self.svg_matrix(node.id);
            self.is_measuring_stroke.set(false);
        }
        reach *= fixed_scale(node, &to_root);
        if kind == Bounds::Ink && node.tag == name!("text") {
            reach += (node.style.font.size.0
                + crate::paint::shadow_extent(&node.style.ink.text_shadow.0))
                / node.style.zoom;
        }
        let markers = if kind == Bounds::Stroke {
            Vec::new()
        } else {
            self.svg_markers(node, &to_root)
        };
        let markers = markers.iter().filter_map(|(marker, matrix, _)| {
            Some(
                marker
                    .document
                    .svg_bounds(marker, kind)?
                    .transformed(matrix),
            )
        });
        Some(markers.fold(fill.grown(reach), unite))
    }

    fn svg_filtered(&self, node: &Node, ink: Option<Rect>) -> Rect {
        node.style
            .effects
            .filter
            .0
            .iter()
            .fold(ink.unwrap_or_default(), |ink, filter| match filter {
                Filter::Amount(FilterName::Blur, radius) => {
                    ink.grown(radius * 3.0 / node.style.zoom)
                }
                Filter::DropShadow(it) => ink.grown(
                    (it.offset[0].abs().max(it.offset[1].abs()) + it.blur * 3.0) / node.style.zoom,
                ),
                Filter::Url(url) => {
                    self.filter_element(node.id, url, node.viewport)
                        .map_or(ink, |filter| {
                            filter.document.resource_region(
                                &filter,
                                name!("filterUnits"),
                                self.svg_bounds(node, Bounds::Fill).unwrap_or_default(),
                            )
                        })
                }
                Filter::Amount(..) => ink,
            })
    }

    /// Relative to the border box.
    pub(crate) fn svg_ink(&self, id: NodeId) -> Option<Rect> {
        let root = self.svg_node(id)?;
        self.reset_svg_budget();
        Some(
            self.svg_bounds(&root, Bounds::Ink)?
                .transformed(&self.svg_to_parent(&root)?)
                .grown(1.0),
        )
    }

    pub(crate) fn has_geometry(&self, node: &Node) -> bool {
        match is_name!(node.tag, "image" | "foreignObject") {
            true => !self.svg_rect(node).is_empty(),
            false => self.bounds_of_points(node).map_or_else(
                || {
                    self.rendered_path(node)
                        .is_some_and(|it| !it.verbs.is_empty())
                },
                |it| it.is_some(),
            ),
        }
    }

    /// Each with the transform from its user space, and what it is clipped to in that.
    pub(crate) fn svg_markers(
        &self,
        node: &Node,
        to_root: &Matrix,
    ) -> Vec<(Node<'_>, Matrix, Option<Rect>)> {
        let svg = &node.style.svg;
        let urls = [&svg.marker_start.0, &svg.marker_mid.0, &svg.marker_end.0];
        if urls == [&None; 3]
            || !is_name!(node.tag, "path" | "line" | "polyline" | "polygon")
            || node.depth > MAX_DEPTH
        {
            return Vec::new();
        }
        let markers = urls.map(|url| {
            let marker = self
                .svg_reference(node.id, &url.as_ref()?.0)
                .filter(|it| it.tag == name!("marker"))?;
            (!core::ptr::eq(self, marker.document)
                || !self.tree.flat_ancestors(node.id).any(|it| it == marker.id))
            .then_some(())?;
            let element = marker.element;
            let length = |name, axis, default| {
                marker
                    .document
                    .svg_length(&marker, name, axis)
                    .unwrap_or(default)
            };
            let size = [
                length(name!("markerWidth"), 0, 3.0),
                length(name!("markerHeight"), 1, 3.0),
            ];
            let view = view_box(element);
            (size[0] > 0.0 && size[1] > 0.0 && !view.is_some_and(|it| it.is_empty()))
                .then_some(())?;
            let fitted = view.map_or(IDENTITY, |it| fit_view(element, it, size));
            let reference = apply(
                &fitted,
                [length(name!("refX"), 0, 0.0), length(name!("refY"), 1, 0.0)],
            );
            let scale = if element.attribute(name!("markerUnits")) == Some("userSpaceOnUse") {
                1.0
            } else {
                node.stroke_width() * fixed_scale(node, to_root)
            };
            let inner = multiply(
                &multiply(
                    &scaling(scale, scale),
                    &translation(reference.map(|it| -it)),
                ),
                &fitted,
            );
            let clip = Rect::new([0.0, 0.0, size[0], size[1]]).transformed(&invert(&fitted)?);
            let orient = element
                .attribute(name!("orient"))
                .unwrap_or_default()
                .trim_ascii();
            let angle = Numbers::all(orient)
                .and_then(|it| it.first().copied())
                .or_else(|| {
                    parse_all(orient.as_bytes(), |p| {
                        crate::values::degrees(p, &crate::values::Ctx::dummy())
                    })
                });
            let viewport = view.map_or(size, |it| [it.width, it.height]);
            Some((
                Node {
                    viewport,
                    depth: node.depth + MAX_DEPTH / 4,
                    ..marker
                },
                inner,
                clip,
                orient,
                angle.unwrap_or(0.0),
            ))
        });
        let vertices = self.svg_path(node).unwrap_or_default().vertices();
        let last = vertices.len().saturating_sub(1);
        let kinds = |index: usize| [index == 0, index > 0 && index < last, index == last];
        let placed = vertices.iter().enumerate().flat_map(|(index, it)| {
            (0..3)
                .filter(move |kind| kinds(index)[*kind])
                .map(move |kind| (kind, it))
        });
        let placed = placed.filter_map(|(kind, vertex)| {
            use core::f32::consts::PI;
            let (marker, inner, clip, orient, angle) = markers[kind].as_ref()?;
            self.spend_svg_budget().then_some(())?;
            let along = match (vertex.incoming, vertex.outgoing) {
                (Some(a), Some(b)) => a + ((b - a + PI).rem_euclid(2.0 * PI) - PI) / 2.0,
                (a, b) => a.or(b).unwrap_or(0.0),
            };
            let radians = match *orient {
                "auto" => along,
                "auto-start-reverse" => along + if kind == 0 { PI } else { 0.0 },
                _ => angle.to_radians(),
            };
            let matrix = multiply(
                &multiply(&translation(vertex.at), &rotation(radians)),
                inner,
            );
            Some((
                marker.clone(),
                matrix,
                marker.clips_overflow().then_some(*clip),
            ))
        });
        placed.collect()
    }

    pub(crate) fn svg_reference_box(&self, node: &Node, area: BoxArea) -> Rect {
        match area {
            BoxArea::ViewBox => Rect::new([0.0, 0.0, node.viewport[0], node.viewport[1]]),
            BoxArea::FillBox | BoxArea::ContentBox | BoxArea::PaddingBox => {
                self.svg_bounds(node, Bounds::Fill).unwrap_or_default()
            }
            _ => self.svg_bounds(node, Bounds::Stroke).unwrap_or_default(),
        }
    }

    pub(crate) fn svg_transform_reference(&self, node: &Node) -> Rect {
        self.svg_reference_box(
            node,
            match node.style.effects.transform_box {
                TransformBox::ViewBox => BoxArea::ViewBox,
                TransformBox::FillBox | TransformBox::ContentBox => BoxArea::FillBox,
                _ if node.style.shape.vector_effect == VectorEffect::NonScalingStroke => {
                    BoxArea::FillBox
                }
                TransformBox::StrokeBox | TransformBox::BorderBox => BoxArea::StrokeBox,
            },
        )
    }

    pub(crate) fn svg_transform(&self, node: &Node) -> Matrix {
        let style = &node.style;
        let motion = self.smil.effects.motions.get(&node.id).copied();
        if !style.has_transform() || self.outer_box(node).is_some() {
            return motion.unwrap_or(IDENTITY);
        }
        let mut reference = self.svg_transform_reference(node);
        if node.tag == name!("use") && style.effects.transform_box != TransformBox::ViewBox {
            reference = reference.moved(node.position());
        }
        if style.other_if_set(Id::OffsetPath).is_some() {
            let reference = reference.transformed(&scaling(style.zoom, style.zoom));
            let along = self.motion_in(
                node.id,
                style,
                reference,
                &|_| crate::paint::square(reference),
                &|_| None,
            );
            let [a, b, c, d, e, f] =
                crate::transform::flattened(&style.transform_3d(reference, along));
            return multiply(
                &motion.unwrap_or(IDENTITY),
                &[a, b, c, d, e / style.zoom, f / style.zoom],
            );
        }
        multiply(&motion.unwrap_or(IDENTITY), &transform_in(style, reference))
    }

    /// `bounds` are those of what uses the resource.
    pub(crate) fn resource_transform(&self, node: &Node, bounds: Rect) -> Matrix {
        let is_view = node.style.effects.transform_box == TransformBox::ViewBox;
        transform_in(
            &node.style,
            if is_view {
                self.svg_reference_box(node, BoxArea::ViewBox)
            } else {
                bounds
            },
        )
    }

    pub(crate) fn svg_to_parent(&self, node: &Node) -> Option<Matrix> {
        let own = self.svg_transform(node);
        Some(match node.tag {
            _ if self.outer_box(node).is_some() => multiply(
                &scaling(node.style.zoom, node.style.zoom),
                &self.view_transform(node)?,
            ),
            _ if node.establishes_viewport() => multiply(&own, &self.view_transform(node)?),
            tag if tag == name!("use") => multiply(&own, &translation(node.position())),
            tag if is_name!(tag, "tspan" | "textPath") => IDENTITY,
            _ => own,
        })
    }

    /// From the user space of the element to the border box of the outermost `svg`, or to the viewport of `until`.
    fn svg_matrix_to(&self, id: NodeId, until: Option<NodeId>) -> Matrix {
        self.svg_has_read(Reads::MATRIX);
        let (outer, mut matrix) = (self.outer_svg(id), IDENTITY);
        for node in core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .filter_map(|it| self.svg_node(it))
        {
            let step = match node.tag {
                _ if Some(node.id) == until => {
                    let rect = self.viewport_rect(&node);
                    self.view_transform(&node)
                        .map(|it| multiply(&translation([-rect.x, -rect.y]), &it))
                }
                tag if tag == name!("use") => Some(self.svg_transform(&node)),
                _ => self.svg_to_parent(&node),
            };
            matrix = multiply(&step.unwrap_or(IDENTITY), &matrix);
            if [until, outer].contains(&Some(node.id)) {
                break;
            }
        }
        matrix
    }

    pub(crate) fn svg_matrix(&self, id: NodeId) -> Matrix {
        self.svg_matrix_to(id, None)
    }

    /// `getCTM`
    pub(crate) fn svg_viewport_matrix(&self, id: NodeId) -> Matrix {
        let is_svg = |it: &NodeId| {
            self.tree
                .element(*it)
                .is_some_and(|it| it.tag == name!("svg"))
        };
        self.svg_matrix_to(id, self.tree.flat_ancestors(id).find(is_svg).or(Some(id)))
    }

    /// From the coordinates that a `foreignObject` is laid out in.
    pub(crate) fn foreign_matrix(&self, id: BoxId) -> Matrix {
        let zoom = self.boxes[id].style.zoom;
        multiply(
            &self.svg_matrix(self.boxes[id].node),
            &scaling(1.0 / zoom, 1.0 / zoom),
        )
    }

    pub(crate) fn svg_screen_matrix(&self, id: NodeId) -> Option<Matrix> {
        Some(multiply(
            &self.to_viewport(self.own_box(self.outer_svg(id)?)?),
            &self.svg_matrix(id),
        ))
    }

    pub(crate) fn rendered_node(&self, id: NodeId) -> Option<Node<'_>> {
        self.displayed_node(id, false)
    }

    fn displayed_node(&self, id: NodeId, ignores_groups: bool) -> Option<Node<'_>> {
        let outer = self
            .outer_svg(id)
            .filter(|it| self.own_box(*it).is_some())?;
        let mut path = core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .take_while(|it| *it != outer);
        let is_displayed = |it: NodeId, element: &Element| match self.tree.style(it) {
            _ if ignores_groups && it != id && element.tag == name!("g") => true,
            None if ignores_groups => self
                .style_on_demand(it)
                .is_some_and(|it| it.display() != Display::None),
            style => style.is_some_and(|it| it.display() != Display::None),
        };
        path.all(|it| {
            self.tree
                .element(it)
                .is_some_and(|element| is_displayed(it, element) && passes_tests(element))
        })
        .then_some(())?;
        self.svg_node(id)
    }

    /// `getBBox`
    pub(crate) fn svg_bounding_box(&self, id: NodeId, kind: Bounds) -> Option<Rect> {
        let node = self
            .displayed_node(id, true)
            .filter(|it| it.tag != name!("defs"))?;
        self.reset_svg_budget();
        Some(
            self.svg_bounds(&node, kind)?
                .moved(if node.tag == name!("use") {
                    node.position()
                } else {
                    [0.0; 2]
                }),
        )
    }

    /// https://svgwg.org/svg2-draft/render.html#TermNeverRenderedElement, or in one.
    pub(crate) fn is_never_rendered(&self, id: NodeId) -> bool {
        let path = core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .map_while(|it| self.tree.element(it));
        path.take_while(|it| it.namespace == Namespace::Svg)
            .any(|it| !is_graphic(it) && !is_name!(it.tag, "tspan" | "textPath"))
    }

    pub(crate) fn svg_element_rect(&self, id: NodeId) -> Option<(BoxId, Rect)> {
        let outer = self.own_box(self.outer_svg(id)?)?;
        let is_shown = |it: &Element| is_graphic(it) || is_name!(it.tag, "tspan" | "textPath");
        let mut path = core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .take_while(|it| self.own_box(*it).is_none());
        path.all(|it| self.tree.element(it).is_some_and(is_shown))
            .then_some(())?;
        self.rendered_node(id)?;
        Some((
            outer,
            self.svg_bounding_box(id, Bounds::Fill)
                .unwrap_or_default()
                .transformed(&self.svg_matrix(id)),
        ))
    }

    /// The length of the outline, and the point at `distance` on it.
    pub(crate) fn svg_point_at_length(&self, id: NodeId, distance: f32) -> [f32; 3] {
        let path = self
            .svg_node(id)
            .and_then(|it| self.rendered_path(&it))
            .unwrap_or_default();
        let [x, y] = at_distance(&path.pieces(), distance)
            .map(|it| it.0)
            .or_else(|| path.start())
            .unwrap_or([f32::NAN; 2]);
        [path.length(), x, y]
    }

    /// `isPointInFill` and `isPointInStroke`
    pub(crate) fn svg_contains(&self, id: NodeId, point: [f32; 2], in_stroke: bool) -> bool {
        let Some((path, node)) = self
            .rendered_node(id)
            .and_then(|it| Some((self.rendered_path(&it)?, it)))
        else {
            return false;
        };
        match (in_stroke, node.style.shape.vector_effect) {
            (false, _) => path.contains(point, node.style.svg.fill_rule == FillRule::Evenodd),
            (true, VectorEffect::None) => self.is_in_stroke(&node, &path, point),
            (true, _) => self.is_in_stroke(
                &node,
                &path.transformed(&self.svg_matrix(id)),
                apply(&self.svg_matrix(id), point),
            ),
        }
    }

    /// By how much `pathLength` scales distances.
    pub(crate) fn path_scale(&self, id: NodeId, path: &Path) -> f32 {
        let given = self
            .svg_number(id, name!("pathLength"))
            .filter(|it| *it >= 0.0);
        given.map_or(1.0, |it| (path.length() / it).min(f32::MAX))
    }

    pub(crate) fn is_in_stroke(&self, node: &Node, path: &Path, point: [f32; 2]) -> bool {
        self.pen(node, path).covers(path, point)
    }

    fn pen(&self, node: &Node, path: &Path) -> Pen {
        let svg = &node.style.svg;
        let scale = if svg.dasharray.0.0.is_empty() {
            1.0
        } else {
            self.path_scale(node.id, path)
        };
        let dashes = svg
            .dasharray
            .0
            .0
            .iter()
            .chain(svg.dasharray.0.0.iter())
            .map(|it| node.resolve(&it.0, 2) * scale)
            .collect();
        let dash_offset = node.resolve(&svg.dashoffset.0, 2) * scale;
        Pen {
            reach: node.stroke_width() / 2.0,
            linecap: svg.linecap,
            linejoin: svg.linejoin,
            miterlimit: svg.miterlimit.0,
            dashes,
            dash_offset,
        }
    }
}

struct Pen {
    reach: f32,
    linecap: LineCap,
    linejoin: LineJoin,
    miterlimit: f32,
    dashes: Vec<f32>,
    dash_offset: f32,
}

impl Pen {
    /// How far from the path it gets, along a segment and at its ends.
    fn limits(&self) -> [f32; 2] {
        let near = self.reach
            * if self.linecap == LineCap::Square {
                1.42
            } else {
                1.01
            };
        [
            near,
            near.max(if self.linejoin == LineJoin::Miter {
                self.reach * self.miterlimit
            } else {
                0.0
            }),
        ]
    }

    fn covers(&self, path: &Path, point: [f32; 2]) -> bool {
        let (svg, reach, dashes, [near, far]) = (self, self.reach, &self.dashes, self.limits());
        let (period, mut start) = (dashes.iter().sum::<f32>(), self.dash_offset);
        let mut pieces = if period > 0.0 {
            path.pieces()
        } else {
            path.pieces_near(point, near, far)
        };
        pieces.dedup_by(|it, before| it.from == before.to && it.length() < 1e-4);
        let cap = if svg.linecap == LineCap::Butt {
            0.0
        } else {
            reach
        };
        let is_drawn = |at: f32| {
            let (mut rest, mut kinds) = (
                at.rem_euclid(period),
                dashes.iter().zip([true, false].into_iter().cycle()),
            );
            period <= 0.0
                || kinds
                    .find(|it| {
                        rest -= it.0;
                        rest < 0.0
                    })
                    .is_some_and(|it| it.1 || -rest <= cap || rest + it.0 <= cap)
        };
        let joins =
            |a: usize, b: usize| pieces[a].to == pieces[b].from && (a < b || path.is_closed());
        pieces.iter().enumerate().any(|(index, piece)| {
            let (length, [dx, dy]) = (
                piece.length(),
                [point[0] - piece.from[0], point[1] - piece.from[1]],
            );
            let [ux, uy] = if length > 0.0 {
                [0, 1].map(|it| (piece.to[it] - piece.from[it]) / length)
            } else {
                [1.0, 0.0]
            };
            let (along, across, next) = (
                dx * ux + dy * uy,
                (dx * uy - dy * ux).abs(),
                (index + 1) % pieces.len(),
            );
            let (before, after) = (
                joins((index + pieces.len() - 1) % pieces.len(), index),
                joins(index, next),
            );
            let is_near = match (along < 0.0, along > length) {
                (false, false) => across <= reach && (length > 0.0 || cap > 0.0),
                (true, _) if before => false,
                (_, true) if after && svg.linejoin != LineJoin::Round => {
                    let other = &pieces[next];
                    let [vx, vy] =
                        [0, 1].map(|it| (other.to[it] - other.from[it]) / other.length().max(1e-9));
                    let ([px, py], half) = (
                        [point[0] - piece.to[0], point[1] - piece.to[1]],
                        ((1.0 + ux * vx + uy * vy) / 2.0).max(0.0).sqrt(),
                    );
                    let is_mitered =
                        svg.linejoin == LineJoin::Miter && half * svg.miterlimit >= 1.0;
                    let outwards =
                        (px * (ux - vx) + py * (uy - vy)) / (ux - vx).hypot(uy - vy).max(1e-9);
                    across <= reach
                        && (px * vy - py * vx).abs() <= reach
                        && px * vx + py * vy <= 0.0
                        && (is_mitered || outwards <= reach * half)
                }
                (_, true) if after => distance(piece, point) <= reach,
                _ => match svg.linecap {
                    LineCap::Butt => false,
                    LineCap::Round => distance(piece, point) <= reach,
                    LineCap::Square => {
                        across <= reach && (-reach..=length + reach).contains(&along)
                    }
                },
            };
            start += length;
            is_near && is_drawn(start - length + along.min(length).max(0.0))
        })
    }
}

enum Form {
    Rect(Rect),
    Circle([f32; 2], f32),
    Path(Path),
}

enum Test {
    /// In its own user space.
    Shape {
        form: Form,
        fill: Option<FillRule>,
        stroke: Option<Pen>,
    },
    /// With all that is in it, in the user space around it.
    Element { viewport: [f32; 2], depth: u32 },
}

struct Target {
    id: NodeId,
    from_box: Matrix,
    test: Test,
}

/// What can be hit in an `svg`, from the top.
#[derive(Default)]
pub(crate) struct Targets {
    made_for: (NodeId, u32, u32),
    /// The edges of what each can cover, relative to the border box.
    limits: Vec<[f32; 4]>,
    all: Vec<Target>,
}

impl Form {
    fn is_hit(&self, fill: Option<FillRule>, stroke: Option<&Pen>, point: [f32; 2]) -> bool {
        const TOUCHING: f32 = 1e-4;
        let (reach, [x, y]) = (stroke.map(|it| it.reach), point);
        let outside = match self {
            Form::Rect(it) => (it.x - x)
                .max(x - it.right())
                .max(it.y - y)
                .max(y - it.bottom()),
            Form::Circle(center, radius) => {
                ((x - center[0]).powi(2) + (y - center[1]).powi(2)).sqrt() - radius
            }
            Form::Path(path) => {
                return fill.is_some_and(|it| path.contains(point, it == FillRule::Evenodd))
                    || stroke.is_some_and(|it| it.covers(path, point));
            }
        };
        fill.is_some() && outside < TOUCHING || reach.is_some_and(|it| outside.abs() <= it)
    }
}

/// Whether the fill and the stroke can be hit.
fn sensitive_parts(style: &Style) -> [bool; 2] {
    use PointerEvents as P;
    let events = style.ink.pointer_events;
    let needs_visibility = matches!(
        events,
        P::Auto | P::VisiblePainted | P::VisibleFill | P::VisibleStroke | P::Visible
    );
    let needs_paint = matches!(events, P::Auto | P::VisiblePainted | P::Painted);
    let is_on = events != P::None && (style.is_visible() || !needs_visibility);
    let fills = !matches!(events, P::Stroke | P::VisibleStroke)
        && !(needs_paint && style.svg.fill == SvgPaint::None);
    let strokes = !matches!(events, P::Fill | P::VisibleFill)
        && !(needs_paint && style.svg.stroke == SvgPaint::None);
    [is_on && fills, is_on && strokes]
}

impl Document {
    /// `None` if there is something in an instance that takes its element to test.
    fn collect_targets(parent: &Node, to_box: &Matrix, out: &mut Targets) -> Option<()> {
        for child in parent.document.svg_children(parent).iter().rev() {
            let (document, style, before) = (child.document, &child.style, out.all.len());
            let is_plain = style.effects.clip_path.0.is_none()
                && style.shape.vector_effect == VectorEffect::None
                && style.ink.pointer_events != PointerEvents::BoundingBox
                && !child.establishes_viewport()
                && !is_name!(child.tag, "text" | "image");
            if is_plain {
                let Some(matrix) = document
                    .svg_to_parent(child)
                    .map(|it| multiply(to_box, &it))
                else {
                    continue;
                };
                if !child.is_container() {
                    document.add_shape(child, &matrix, out);
                    continue;
                }
                if Document::collect_targets(child, &matrix, out).is_some() {
                    continue;
                }
            }
            child.uses.is_none().then_some(())?;
            out.all.truncate(before);
            out.limits.truncate(before);
            if let Some(from_box) = invert(to_box) {
                out.all.push(Target {
                    id: child.id,
                    from_box,
                    test: Test::Element {
                        viewport: child.viewport,
                        depth: child.depth,
                    },
                });
                out.limits.push([f32::MIN, f32::MIN, f32::MAX, f32::MAX]);
            }
        }
        Some(())
    }

    fn add_shape(&self, node: &Node, to_box: &Matrix, out: &mut Targets) -> Option<()> {
        let [fills, strokes] = Some(sensitive_parts(&node.style)).filter(|it| *it != [false; 2])?;
        let (path, from_box) = (self.rendered_path(node)?, invert(to_box)?);
        let (bounds, stroke) = (path.bounds()?, strokes.then(|| self.pen(node, &path)));
        let is_solid = stroke.as_ref().is_none_or(|it| it.dashes.is_empty());
        let has_square_corners = stroke
            .as_ref()
            .is_none_or(|it| it.linejoin == LineJoin::Miter && it.miterlimit >= SQRT_2);
        let (form, reach) = match (
            path.as_rect(),
            stroke.as_ref().map_or([0.0; 2], |it| {
                [
                    it.reach,
                    it.limits()[usize::from(node.tag != name!("ellipse"))],
                ]
            }),
        ) {
            (Some(rect), [reach, _]) if is_solid && has_square_corners && !rect.is_empty() => {
                (Form::Rect(rect), reach)
            }
            (_, [reach, _]) if is_solid && node.tag == name!("circle") => (
                Form::Circle(
                    [
                        bounds.x + bounds.width / 2.0,
                        bounds.y + bounds.height / 2.0,
                    ],
                    bounds.width / 2.0,
                ),
                reach,
            ),
            (_, [_, far]) => (Form::Path(path), far),
        };
        let limits = bounds.grown(reach + 1e-3).transformed(to_box);
        let id = core::iter::successors(node.uses.as_ref(), |it| it.outer.as_ref())
            .last()
            .map_or(node.id, |it| it.id);
        out.limits
            .push([limits.x, limits.y, limits.right(), limits.bottom()]);
        out.all.push(Target {
            id,
            from_box,
            test: Test::Shape {
                form,
                fill: fills.then_some(node.style.svg.fill_rule),
                stroke,
            },
        });
        Some(())
    }

    fn svg_targets(&self, id: NodeId) -> Option<Rc<Targets>> {
        let made_for = (id, self.layout_version, self.svg_changes);
        if self.svg_targets.borrow().made_for != made_for {
            let (svg, mut targets) = (
                self.svg_node(id)?,
                Targets {
                    made_for,
                    ..Targets::default()
                },
            );
            self.reset_svg_budget();
            Document::collect_targets(&svg, &self.svg_matrix(id), &mut targets);
            self.svg_targets.replace(Rc::new(targets));
        }
        Some(Rc::clone(&self.svg_targets.borrow()))
    }

    fn svg_hit(&self, node: &Node, point: [f32; 2]) -> Option<NodeId> {
        use PointerEvents as P;
        let (style, events) = (&node.style, node.style.ink.pointer_events);
        if node.tag == name!("text") {
            return self.svg_text_at(node, point);
        }
        let needs_visibility = matches!(
            events,
            P::Auto | P::VisiblePainted | P::VisibleFill | P::VisibleStroke | P::Visible
        );
        (events != P::None && (style.is_visible() || !needs_visibility)).then_some(())?;
        let Some(path) = self
            .rendered_path(node)
            .filter(|_| events != P::BoundingBox)
        else {
            let is_box = events == P::BoundingBox || node.tag == name!("image");
            return (is_box
                && self
                    .svg_bounds(node, Bounds::Fill)?
                    .grown(1e-4)
                    .contains(point))
            .then_some(node.id);
        };
        let [fills, strokes] = sensitive_parts(style);
        let is_in_stroke = || match style.shape.vector_effect {
            VectorEffect::NonScalingStroke if node.uses.is_none() => {
                self.svg_contains(node.id, point, true)
            }
            _ => self.is_in_stroke(node, &path, point),
        };
        let is_hit = strokes && is_in_stroke()
            || fills && path.contains(point, style.svg.fill_rule == FillRule::Evenodd);
        is_hit.then_some(node.id)
    }

    /// `reference` is the bounding box of what is clipped.
    pub(crate) fn clip_contains<'a>(
        &'a self,
        clip: &Node<'a>,
        reference: Rect,
        point: [f32; 2],
    ) -> bool {
        let inside = |node: &Node<'a>, point| {
            let Some(point) = self
                .svg_to_parent(node)
                .and_then(|it| invert(&it))
                .map(|it| apply(&it, point))
            else {
                return false;
            };
            let targets = if node.tag == name!("use") {
                self.svg_children(node)
            } else {
                vec![node.clone()]
            };
            self.is_unclipped(node, point)
                && targets.iter().filter(|it| it.style.is_visible()).any(|it| {
                    let point = if it.key() == node.key() {
                        point
                    } else {
                        apply(
                            &invert(&it.document.svg_transform(it)).unwrap_or(IDENTITY),
                            point,
                        )
                    };
                    match it.document.rendered_path(it) {
                        Some(path) => {
                            path.contains(point, it.style.svg.clip_rule == FillRule::Evenodd)
                        }
                        None => {
                            it.tag == name!("text")
                                && it
                                    .document
                                    .svg_text_bounds(it)
                                    .is_some_and(|it| it.contains(point))
                        }
                    }
                })
        };
        let outer = match clip.style.effects.clip_path.0.as_deref() {
            Some((Shape::Url(url), _)) => self
                .svg_resource(clip.id, url, name!("clipPath"))
                .filter(|_| clip.depth < MAX_DEPTH && self.spend_svg_budget()),
            _ => None,
        };
        outer.is_none_or(|it| {
            it.document.clip_contains(
                &Node {
                    depth: clip.depth + MAX_DEPTH / 8,
                    ..it
                },
                reference,
                point,
            )
        }) && invert(&self.clip_matrix(clip, reference)).is_some_and(|it| {
            self.svg_children(clip)
                .iter()
                .any(|child| inside(child, apply(&it, point)))
        })
    }

    pub(crate) fn clip_matrix(&self, clip: &Node, reference: Rect) -> Matrix {
        let is_relative = self
            .tree
            .element(clip.id)
            .and_then(|it| it.attribute(name!("clipPathUnits")))
            == Some("objectBoundingBox");
        multiply(
            &self.resource_transform(clip, reference),
            &if is_relative {
                onto(reference)
            } else {
                IDENTITY
            },
        )
    }

    fn is_unclipped(&self, node: &Node, point: [f32; 2]) -> bool {
        match node.style.effects.clip_path.0.as_deref() {
            None => true,
            Some((Shape::Url(url), _)) => self
                .svg_resource(node.id, url, name!("clipPath"))
                .filter(|_| node.depth < MAX_DEPTH && self.spend_svg_budget())
                .is_none_or(|clip| {
                    let clip = Node {
                        depth: node.depth + MAX_DEPTH / 8,
                        ..clip
                    };
                    clip.document.clip_contains(
                        &clip,
                        self.svg_bounds(node, Bounds::Fill).unwrap_or_default(),
                        point,
                    )
                }),
            Some((shape, area)) => {
                let (path, rule) = self.svg_shape(node, shape, *area);
                path.contains(point, rule == FillRule::Evenodd)
            }
        }
    }

    pub(crate) fn svg_shape(&self, node: &Node, shape: &Shape, area: BoxArea) -> (Path, FillRule) {
        let zoom = node.style.zoom;
        let reference = crate::paint::square(
            self.svg_reference_box(node, area)
                .transformed(&scaling(zoom, zoom)),
        );
        crate::shapes::resolve(shape, &reference, zoom)
            .scaled(1.0 / zoom)
            .into_path()
    }

    /// From the top. `point` is in the user space around it.
    fn svg_hits(node: &Node, point: [f32; 2], out: &mut Vec<NodeId>) {
        let document = node.document;
        if node.establishes_viewport()
            && node.clips_overflow()
            && !invert(&document.svg_transform(node))
                .is_some_and(|it| document.viewport_rect(node).contains(apply(&it, point)))
        {
            return;
        }
        let Some(point) = document
            .svg_to_parent(node)
            .and_then(|it| invert(&it))
            .map(|it| apply(&it, point))
        else {
            return;
        };
        if document.is_unclipped(node, point) {
            if node.is_container() {
                document
                    .svg_children(node)
                    .iter()
                    .rev()
                    .for_each(|it| Document::svg_hits(it, point, out));
            }
            let host = core::iter::successors(node.uses.as_ref(), |it| it.outer.as_ref()).last();
            out.extend(
                document
                    .svg_hit(node, point)
                    .map(|it| host.map_or(it, |it| it.id)),
            );
        }
    }

    /// In front of `node`, if it is an `svg`.
    pub(crate) fn svg_elements_at(
        &self,
        node: NodeId,
        point: [f32; 2],
    ) -> impl Iterator<Item = NodeId> + '_ {
        let own = self
            .own_box(node)
            .filter(|it| self.boxes[*it].kind == Kind::Svg);
        let placed = own.and_then(|it| {
            Some((
                self.svg_targets(node)?,
                apply(&invert(&self.to_viewport(it))?, point),
            ))
        });
        let (mut next, mut found, mut last) = (0, Vec::new(), 0);
        let all = core::iter::from_fn(move || {
            let (targets, [x, y]) = placed.as_ref()?;
            while found.is_empty() {
                next += targets.limits[next..]
                    .iter()
                    .position(|it| *x >= it[0] && *y >= it[1] && *x <= it[2] && *y <= it[3])?
                    + 1;
                let Target { id, from_box, test } = &targets.all[next - 1];
                let point = apply(from_box, [*x, *y]);
                match test {
                    Test::Shape { form, fill, stroke }
                        if form.is_hit(*fill, stroke.as_ref(), point) =>
                    {
                        return Some(*id);
                    }
                    Test::Shape { .. } => {}
                    &Test::Element { viewport, depth } => {
                        let (id, element) = (*id, self.tree.element(*id)?);
                        let node = Node {
                            document: self,
                            id,
                            element,
                            tag: element.tag,
                            style: self.style_on_demand(id)?,
                            viewport,
                            uses: None,
                            size: [None; 2],
                            depth,
                        };
                        self.reset_svg_budget();
                        Document::svg_hits(&node, point, &mut found);
                        found.reverse();
                    }
                }
            }
            found.pop()
        });
        all.filter(move |it| core::mem::replace(&mut last, *it) != *it)
    }
}
