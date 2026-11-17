//! <https://dom.spec.whatwg.org/#ranges> and <https://w3c.github.io/selection-api/>

mod contents;
pub(crate) mod live;
mod members;
mod pending;
mod selection;

use core::cell::{Cell, OnceCell};
use core::cmp::Ordering;
use std::rc::Rc;

use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsScope};
use bun_jsc::{JSValue, Weak};

pub(crate) use members::client_rects;
pub(crate) use selection::{Selection, selection_of, try_selection};

use crate::api::core::*;
pub(crate) use crate::generated_bindgen::range::{OpaqueRange, Range, StaticRange};
use crate::generated_bindgen::range::{
    js_AbstractRange as js, js_OpaqueRange, js_Range, js_StaticRange,
};
use crate::tree::NodeId;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

/// A boundary point.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Point<'a> {
    pub(crate) node: &'a Node,
    pub(crate) offset: u32,
}

impl<'a> Point<'a> {
    pub(crate) fn new(node: &'a Node, offset: u32) -> Point<'a> {
        Point { node, offset }
    }

    pub(crate) fn before(node: &'a Node) -> Option<Point<'a>> {
        Some(Point::new(node.parent()?, node.index()))
    }

    pub(crate) fn after(node: &'a Node) -> Option<Point<'a>> {
        Some(Point::new(node.parent()?, node.index() + 1))
    }

    pub(crate) fn at_end_of(node: &'a Node) -> Point<'a> {
        Point::new(node, node.length())
    }

    /// The first one that starts here, or later.
    pub(crate) fn node_after(self) -> Option<&'a Node> {
        self.node
            .child_at(self.offset)
            .or_else(|| self.node.following_skip(None))
    }

    /// What scripts see of a point in the shadow tree of a control.
    pub(crate) fn out_of_control(self) -> Point<'a> {
        Some(self.node.out_of_control())
            .filter(|it| *it != self.node)
            .and_then(Point::before)
            .unwrap_or(self)
    }

    fn check(self, heap: &JsHeap<'a>) -> Result<'a, Point<'a>> {
        if self.node.kind() == Kind::Doctype {
            return Err(dom_error(
                heap,
                DomError::InvalidNodeTypeError,
                "The node provided is a doctype.",
            ));
        }
        if self.offset > 0 && self.offset > self.node.length() {
            return Err(heap.dom_exception(
                DomError::IndexSizeError,
                format_args!(
                    "The offset {} is larger than the node's length.",
                    self.offset
                ),
            ));
        }
        Ok(self)
    }
}

/// `None` is before all offsets.
fn compare_in_tree(a: (&Node, Option<u32>), b: (&Node, Option<u32>)) -> Ordering {
    if a.0 == b.0 {
        return a.1.cmp(&b.1);
    }
    if a.0.compare_order(b.0).is_gt() {
        return compare_in_tree(b, a).reverse();
    }
    match b
        .0
        .inclusive_ancestors()
        .find(|it| it.parent() == Some(a.0))
    {
        Some(child)
            if a.1.is_some_and(|it| {
                it > 0 && child.previous_siblings().nth(it as usize - 1).is_none()
            }) =>
        {
            Ordering::Greater
        }
        _ => Ordering::Less,
    }
}

/// <https://dom.spec.whatwg.org/#concept-range-bp-position>
pub(crate) fn compare_points(a: Point<'_>, b: Point<'_>) -> Ordering {
    compare_in_tree((a.node, Some(a.offset)), (b.node, Some(b.offset)))
}

/// In shadow-including tree order.
pub(crate) fn compare_composed(a: Point<'_>, b: Point<'_>) -> Ordering {
    fn outwards(from: Point<'_>) -> impl Iterator<Item = (&Node, Option<u32>)> {
        core::iter::successors(Some((from.node, Some(from.offset))), |it| {
            Some((it.0.root().host()?, None))
        })
    }
    let in_same_tree =
        outwards(a).find_map(|x| Some((x, outwards(b).find(|y| x.0.root() == y.0.root())?)));
    in_same_tree.map_or(Ordering::Equal, |(x, y)| compare_in_tree(x, y))
}

pub(crate) fn common_ancestor<'a>(a: &'a Node, b: &Node) -> &'a Node {
    if a == b {
        return a;
    }
    let (depth, other_depth) = (a.ancestors().count(), b.ancestors().count());
    let pairs = a
        .inclusive_ancestors()
        .skip(depth.saturating_sub(other_depth))
        .zip(
            b.inclusive_ancestors()
                .skip(other_depth.saturating_sub(depth)),
        );
    pairs
        .filter(|(x, y)| x == y)
        .map(|it| it.0)
        .next()
        .unwrap_or_else(|| a.root())
}

/// How the engine names a point.
pub(crate) fn to_engine(point: Point<'_>) -> (NodeId, u32) {
    let Point { node, offset } = point;
    match node.kind() {
        kind if kind.is_text() => (node.id(), offset),
        kind if kind.is_character_data() || kind == Kind::Doctype => (
            node.parent().map_or(0, Node::id),
            linked_from(node.next_sibling()),
        ),
        _ => (node.id(), linked_from(node.child_at(offset))),
    }
}

pub(crate) fn from_engine(doc: &Doc, id: NodeId, offset: u32) -> Option<Point<'_>> {
    let node = doc.rendered_node(id)?;
    match offset {
        _ if node.kind().is_text() => Some(Point::new(node, offset)),
        0 => Some(Point::at_end_of(node)),
        child => Some(Point::new(node, doc.rendered_node(child)?.index())),
    }
}

pub(crate) fn ends_for_engine(start: Point<'_>, end: Point<'_>) -> [u32; 4] {
    let (start, end) = (to_engine(start), to_engine(end));
    [start.0, start.1, end.0, end.1]
}

#[derive(Default)]
pub(crate) struct AbstractRange {
    start_offset: Cell<u32>,
    end_offset: Cell<u32>,
    /// What the nodes that a live range starts and ends in know it by.
    handle: OnceCell<Rc<Weak<()>>>,
}

impl AbstractRange {
    /// Not of an `OpaqueRange`.
    pub(crate) fn start(&self) -> Point<'_> {
        Point::new(
            js::start(self).expect("it has a container"),
            self.start_offset.get(),
        )
    }

    pub(crate) fn end(&self) -> Point<'_> {
        Point::new(
            js::end(self).expect("it has a container"),
            self.end_offset.get(),
        )
    }

    pub(crate) fn collapsed(&self) -> bool {
        self.start_offset == self.end_offset && js::start(self) == js::end(self)
    }

    fn store(&self, start: Point<'_>, end: Point<'_>) {
        js::set_start(self, Some(start.node));
        js::set_end(self, Some(end.node));
        self.start_offset.set(start.offset);
        self.end_offset.set(end.offset);
    }
}

pub(crate) fn static_range<'a>(
    heap: &JsHeap<'a>,
    start: Point<'_>,
    end: Point<'_>,
) -> &'a StaticRange {
    let range = js_StaticRange::create(start.node.doc().realm(heap), AbstractRange::default());
    range.store(start, end);
    range
}

impl Range {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, start: Point<'_>, end: Point<'_>) -> &'a Range {
        let range = js_Range::create(start.node.doc().realm(heap), AbstractRange::default());
        range.begin(heap, start, end);
        range
    }

    fn selection<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a Selection> {
        Selection::from_js(heap, js::owner(self)?)
    }

    fn set_selection(&self, selection: Option<&Selection>) {
        js::set_owner(self, selection.map_or(JSValue::ZERO, Selection::to_js));
    }

    /// As a script does.
    pub(crate) fn set<'a>(&'a self, cx: Cx<'_, 'a>, start: Point<'a>, end: Point<'a>) {
        self.put(cx, start, end);
        if let Some(selection) = self.selection(&cx.heap) {
            selection.range_was_set(cx);
        }
    }

    pub(crate) fn common_ancestor(&self) -> &Node {
        common_ancestor(self.start().node, self.end().node)
    }
}

impl OpaqueRange {
    /// Of the value of a text control.
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        control: JSValue,
        start: u32,
        end: u32,
    ) -> &'a OpaqueRange {
        let range = js_OpaqueRange::create(doc.realm(heap), AbstractRange::default());
        js::set_owner(range, control);
        range.start_offset.set(start);
        range.end_offset.set(end);
        range
    }

    pub(crate) fn control(&self) -> Option<JSValue> {
        js::owner(self)
    }

    pub(crate) fn replaced(&self, at: u32, removed: u32, added: u32) {
        for offset in [&self.start_offset, &self.end_offset] {
            offset.set(live::after_replacing(offset.get(), at, removed, added));
        }
    }
}
