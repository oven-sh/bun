//! What is at a point of the viewport.

use super::image_map;
use super::layout::Caret;
use super::prelude::*;
use crate::api::geometry::DOMRect;
use crate::generated_bindgen::interaction::{
    CaretPositionFromPointOptions, DocumentPoints, ScopePoints, js_CaretPosition,
};

fn in_viewport(doc: &Doc, point: [f64; 2]) -> Option<[f64; 2]> {
    let size = Ui::of(doc).map(|_| layout::viewport_size(doc))?;
    point
        .iter()
        .zip(size)
        .all(|(at, size)| (0.0..f64::from(size)).contains(at))
        .then_some(point)
}

fn element_of(node: &Node) -> Option<&Element> {
    node.as_element()
        .or_else(|| node.parent_element())
        .or_else(|| node.parent()?.host()?.as_element())
}

impl ScopePoints {
    pub(crate) fn element_from_point<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        x: f64,
        y: f64,
    ) -> Option<&'a Node> {
        let point = in_viewport(self.doc(), [x, y])?;
        let Some(found) = layout::hit_test(cx, self.doc(), point).and_then(element_of) else {
            return self.doc().document_element().map(|it| &**it);
        };
        let area = (found.is_html(atom!("img")) && found.has_attr(atom!("usemap")))
            .then(|| image_map::area_at(cx, found, point))
            .flatten();
        Some(area.unwrap_or(found).retarget(Some(self)))
    }

    pub(crate) fn elements_from_point<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        x: f64,
        y: f64,
    ) -> Vec<&'a Node> {
        let (doc, mut found) = (self.doc(), Vec::<&Node>::new());
        let Some(point) = in_viewport(doc, [x, y]) else {
            return found;
        };
        let hits: Vec<_> = layout::painted(cx, doc, |engine, _| {
            engine.hit_test_all(layout::narrow(point))
        })
        .into_iter()
        .filter_map(|it| doc.rendered_node(it))
        .collect();
        for &hit in &hits {
            let Some(element) = element_of(hit)
                .filter(|it| ***it == *hit || !hits.contains(&&***it))
                .map(|it| it.retarget(Some(self)))
            else {
                continue;
            };
            if found.last() != Some(&element) && (hit == element || !found.contains(&element)) {
                found.push(element);
            }
        }
        found.extend(
            doc.document_element()
                .map(|it| &**it)
                .filter(|it| !found.contains(it)),
        );
        found
    }

    pub(crate) fn get_selection<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a Selection> {
        Ui::of(self.doc()).map(|_| range::selection_of(heap, self))
    }

    pub(crate) fn get_picture_in_picture_element(&self) -> Option<&Node> {
        None
    }
}

fn caret_at<'a>(cx: &mut Cx<'a>, doc: &'a Doc, point: [f64; 2]) -> Option<Point<'a>> {
    let point = in_viewport(doc, point)?;
    let [id, offset] = layout::painted(cx, doc, |engine, _| {
        engine
            .any_point_at(layout::narrow(point))
            .map(|it| engine.for_script(it))
    })?;
    range::from_engine(doc, id, offset)
}

fn before_hidden_trees<'a>(point: Point<'a>, is_hidden: impl Fn(&&'a Node) -> bool) -> Point<'a> {
    core::iter::successors(Some(point), |it| {
        Point::before(Some(it.node.root()).filter(&is_hidden)?.host()?)
    })
    .last()
    .unwrap_or(point)
}

impl DocumentPoints {
    pub(crate) fn caret_position_from_point<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        x: f64,
        y: f64,
        options: &CaretPositionFromPointOptions<'a>,
    ) -> Option<&'a CaretPosition> {
        let found = caret_at(cx, self, [x, y])?;
        let seen = Point {
            node: found.node.out_of_control(),
            ..found
        };
        let lifted = before_hidden_trees(seen, |root| {
            !options
                .shadow_roots
                .iter()
                .any(|it| root.contains_composed(it))
        });
        let shown = if lifted == seen { found } else { lifted };
        let position = js_CaretPosition::create(
            self.heap(&cx.heap),
            CaretPosition {
                offset: shown.offset,
                _interior: Default::default(),
            },
        );
        js_CaretPosition::set_node(position, Some(shown.node));
        Some(position)
    }

    pub(crate) fn caret_range_from_point<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        x: i32,
        y: i32,
    ) -> Option<&'a Range> {
        let found = caret_at(cx, self, [x.into(), y.into()])?;
        let control = found.node.out_of_control();
        let point = before_hidden_trees(
            if control == found.node {
                found
            } else {
                Point::new(control, 0)
            },
            |_| true,
        );
        Some(Range::new(&cx.heap, point, point))
    }
}

pub(crate) struct CaretPosition {
    offset: u32,
    _interior: bun_jsc::bindgen::Interior,
}

impl CaretPosition {
    pub(crate) fn get_offset_node(&self) -> Option<&Node> {
        js_CaretPosition::node(self).map(Node::out_of_control)
    }

    pub(crate) fn get_offset(&self) -> u32 {
        self.offset
    }

    pub(crate) fn get_client_rect<'a>(&'a self, cx: &mut Cx<'a>) -> Option<&'a DOMRect> {
        let node = js_CaretPosition::node(self).filter(|it| it.is_connected())?;
        let rect = layout::caret_rect(
            cx,
            Caret {
                point: Point::new(node, self.offset.min(node.length())),
                is_upstream: false,
            },
        )?;
        Some(DOMRect::new(
            node.doc().heap(&cx.heap),
            [rect.x.into(), rect.y.into(), 0.0, rect.height.into()],
        ))
    }
}
