use bun_jsc::JSString;
use bun_jsc::bindgen::{ClassStructure, JsLocal};

use super::*;
use crate::api::geometry::{DOMRect, DOMRectList};
use crate::api::markup::{self, FragmentOptions};
use crate::generated_bindgen::range::{DocumentRange, StaticRangeInit};

impl AbstractRange {
    pub(crate) fn get_start_offset(&self) -> u32 {
        self.start_offset.get()
    }

    pub(crate) fn get_end_offset(&self) -> u32 {
        self.end_offset.get()
    }

    pub(crate) fn get_collapsed(&self) -> bool {
        self.collapsed()
    }
}

impl StaticRange {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        init: &StaticRangeInit<'a>,
    ) -> Result<'a, &'a Self> {
        if [init.start_container, init.end_container]
            .iter()
            .any(|it| matches!(it.kind(), Kind::Doctype | Kind::Attr))
        {
            return Err(dom_error(
                heap,
                DomError::InvalidNodeTypeError,
                "Neither container may be a doctype or an attribute.",
            ));
        }
        let range = structure.create(heap, AbstractRange::default());
        range.store(
            Point::new(init.start_container, init.start_offset),
            Point::new(init.end_container, init.end_offset),
        );
        Ok(range)
    }
}

type Rect = [f64; 4];

pub(crate) fn client_rects<'a>(cx: Cx<'_, 'a>, start: Point<'a>, end: Point<'a>) -> Vec<Rect> {
    if !start.node.is_rendered() {
        return Vec::new();
    }
    start.node.doc().sync(cx);
    let ends = ends_for_engine(start, end);
    start
        .node
        .engine(|engine, _| engine.client_rects_of_range(ends))
}

fn bounds_of(rects: &[Rect]) -> Rect {
    let corners = rects
        .iter()
        .filter(|it| it[2] != 0.0 && it[3] != 0.0)
        .map(|[x, y, width, height]| [*x, *y, x + width, y + height]);
    match corners.reduce(|a, b| {
        [
            a[0].min(b[0]),
            a[1].min(b[1]),
            a[2].max(b[2]),
            a[3].max(b[3]),
        ]
    }) {
        Some([left, top, right, bottom]) => [left, top, right - left, bottom - top],
        None => rects.first().copied().unwrap_or_default(),
    }
}

impl AbstractRange {
    /// Those of an `OpaqueRange` are in the text that its control shows.
    pub(crate) fn rendered_ends<'a>(&'a self, cx: Cx<'_, 'a>) -> Option<[Point<'a>; 2]> {
        let Some(opaque) = self.downcast::<OpaqueRange>() else {
            return Some([self.start(), self.end()]);
        };
        let text = pending::rendered_text_of_control(cx, opaque.control()?)?;
        Some([
            Point::new(text, self.start_offset.get()),
            Point::new(text, self.end_offset.get()),
        ])
    }
}

impl OpaqueRange {
    pub(crate) fn get_container(&self, _: &JsHeap<'_>) -> JSValue {
        JSValue::UNDEFINED
    }

    pub(crate) fn disconnect<'a>(&'a self, cx: Cx<'_, 'a>) {
        if let Some(control) = self.control() {
            pending::invalidate_control(cx, control);
        }
        js::set_owner(self, JSValue::ZERO);
        self.start_offset.set(0);
        self.end_offset.set(0);
    }

    fn rects<'a>(&'a self, cx: Cx<'_, 'a>) -> Vec<Rect> {
        self.rendered_ends(cx)
            .map_or_else(Vec::new, |[start, end]| client_rects(cx, start, end))
    }

    pub(crate) fn get_client_rects<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let rects = if self.collapsed() {
            Vec::new()
        } else {
            self.rects(cx)
        };
        Ok(DOMRectList::new(self.realm(&cx.heap), &rects).to_js())
    }

    pub(crate) fn get_bounding_client_rect<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let rects = self.rects(cx);
        Ok(DOMRect::new(self.realm(&cx.heap), bounds_of(&rects)).to_js())
    }
}

fn beside<'a>(heap: &JsHeap<'a>, point: Option<Point<'a>>) -> Result<'a, Point<'a>> {
    point.ok_or_else(|| {
        dom_error(
            heap,
            DomError::InvalidNodeTypeError,
            "The given Node has no parent.",
        )
    })
}

impl Range {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
    ) -> Result<'a, &'a Self> {
        let start = Point::new(seams::current_document(cx)?, 0);
        let range = structure.create(&cx.heap, AbstractRange::default());
        range.begin(&cx.heap, start, start);
        Ok(range)
    }

    pub(crate) fn get_common_ancestor_container(&self) -> &Node {
        self.common_ancestor()
    }

    /// With both trees, if it is what is selected.
    fn span<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Range {
        self.selection(heap)
            .and_then(Selection::span)
            .unwrap_or(self)
    }

    fn move_start<'a>(&'a self, cx: Cx<'_, 'a>, to: Point<'a>) {
        let (end, composed_end) = (self.end(), self.span(&cx.heap).end());
        let collapses = to.node != end.node && to.node.root() != end.node.root()
            || compare_points(to, end).is_gt();
        self.set(cx, to, if collapses { to } else { end });
        self.selection(&cx.heap)
            .into_iter()
            .for_each(|it| it.compose(&cx.heap, to, composed_end));
    }

    fn move_end<'a>(&'a self, cx: Cx<'_, 'a>, to: Point<'a>) {
        let (start, composed_start) = (self.start(), self.span(&cx.heap).start());
        let collapses = to.node != start.node && to.node.root() != start.node.root()
            || compare_points(to, start).is_lt();
        self.set(cx, if collapses { to } else { start }, to);
        self.selection(&cx.heap)
            .into_iter()
            .for_each(|it| it.compose(&cx.heap, composed_start, to));
    }

    pub(crate) fn set_start<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        offset: u32,
    ) -> Result<'a> {
        Point::new(node, offset)
            .check(&cx.heap)
            .map(|it| self.move_start(cx, it))
    }

    pub(crate) fn set_end<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node, offset: u32) -> Result<'a> {
        Point::new(node, offset)
            .check(&cx.heap)
            .map(|it| self.move_end(cx, it))
    }

    pub(crate) fn set_start_before<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        beside(&cx.heap, Point::before(node)).map(|it| self.move_start(cx, it))
    }

    pub(crate) fn set_start_after<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        beside(&cx.heap, Point::after(node)).map(|it| self.move_start(cx, it))
    }

    pub(crate) fn set_end_before<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        beside(&cx.heap, Point::before(node)).map(|it| self.move_end(cx, it))
    }

    pub(crate) fn set_end_after<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        beside(&cx.heap, Point::after(node)).map(|it| self.move_end(cx, it))
    }

    pub(crate) fn collapse<'a>(&'a self, cx: Cx<'_, 'a>, to_start: bool) {
        let point = if to_start { self.start() } else { self.end() };
        self.set(cx, point, point);
    }

    pub(crate) fn select_node<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        let start = beside(&cx.heap, Point::before(node))?;
        self.set(cx, start, Point::new(start.node, start.offset + 1));
        Ok(())
    }

    pub(crate) fn select_node_contents<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        let start = Point::new(node, 0).check(&cx.heap)?;
        self.set(cx, start, Point::at_end_of(node));
        Ok(())
    }

    pub(crate) fn compare_boundary_points<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        how: u16,
        source: &'a Range,
    ) -> Result<'a, i32> {
        let (this, other) = match how {
            0 => (self.start(), source.start()),
            1 => (self.end(), source.start()),
            2 => (self.end(), source.end()),
            3 => (self.start(), source.end()),
            _ => {
                return Err(dom_error(
                    heap,
                    DomError::NotSupportedError,
                    "The comparison method is not supported.",
                ));
            }
        };
        if this.node.root() != other.node.root() {
            return Err(dom_error(
                heap,
                DomError::WrongDocumentError,
                "The source range is in a different document than this range.",
            ));
        }
        Ok(compare_points(this, other) as i32)
    }

    pub(crate) fn clone_range<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Range {
        Range::new(heap, self.start(), self.end())
    }

    pub(crate) fn detach(&self) {}

    fn is_in_tree_of(&self, node: &Node) -> bool {
        node.root() == self.start().node.root()
    }

    pub(crate) fn is_point_in_range<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        node: &'a Node,
        offset: u32,
    ) -> Result<'a, bool> {
        Ok(self.is_in_tree_of(node) && self.compare_point(heap, node, offset)? == 0)
    }

    pub(crate) fn compare_point<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        node: &'a Node,
        offset: u32,
    ) -> Result<'a, i32> {
        if !self.is_in_tree_of(node) {
            return Err(dom_error(
                heap,
                DomError::WrongDocumentError,
                "The node provided and the Range are not in the same tree.",
            ));
        }
        let point = Point::new(node, offset).check(heap)?;
        Ok(if compare_points(point, self.start()).is_lt() {
            -1
        } else {
            compare_points(point, self.end()).is_gt().into()
        })
    }

    pub(crate) fn intersects_node(&self, node: &Node) -> bool {
        self.is_in_tree_of(node)
            && Point::before(node).is_none_or(|before| {
                compare_points(before, self.end()).is_lt()
                    && compare_points(Point::new(before.node, before.offset + 1), self.start())
                        .is_gt()
            })
    }

    pub(crate) fn create_contextual_fragment<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        string: JsLocal<'a>,
    ) -> Result<'a, &'a Node> {
        let (markup, start) = (
            crate::api::trusted::Trusted::Html.string_in_realm_of(
                cx,
                self,
                string,
                "Range createContextualFragment",
            )?,
            self.start().node,
        );
        let around = start
            .parent()
            .filter(|_| !start.is_element())
            .unwrap_or(start);
        let context = match around
            .as_element()
            .filter(|it| !(it.doc().is_html_doc() && it.kind() == Kind::Html))
        {
            Some(element) => element,
            None => around.body_as_context(&cx.heap),
        };
        let fragment = markup::parse_fragment(
            cx,
            context,
            &markup,
            context,
            FragmentOptions {
                starts_scripts: true,
                ..Default::default()
            },
        )?;
        let mut next = fragment.first_child();
        while let Some(child) = next {
            next = child.next_sibling();
            if matches!(child.kind(), Kind::Html | Kind::Head | Kind::Body) {
                next = child.first_child().or(next);
                while let Some(inner) = child.first_child() {
                    pre_insert(cx, inner, fragment, Some(child))?;
                }
                remove(cx, child, Observers::Suppress);
            }
        }
        Ok(fragment)
    }

    pub(crate) fn get_client_rects<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let rects = client_rects(cx, self.start(), self.end());
        Ok(DOMRectList::new(self.realm(&cx.heap), &rects).to_js())
    }

    pub(crate) fn get_bounding_client_rect<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let rects = client_rects(cx, self.start(), self.end());
        Ok(DOMRect::new(self.realm(&cx.heap), bounds_of(&rects)).to_js())
    }

    pub(crate) fn expand<'a>(&'a self, cx: Cx<'_, 'a>, unit: JsLocal<'a, JSString>) {
        pending::expand_range(cx, self, unit);
    }

    pub(crate) fn stringify<'a>(&'a self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        self.text().to_js(heap)
    }
}

impl DocumentRange {
    pub(crate) fn create_range<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Range {
        Range::new(heap, Point::new(self, 0), Point::new(self, 0))
    }
}
