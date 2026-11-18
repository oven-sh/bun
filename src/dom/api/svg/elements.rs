//! What SVG elements have besides their attributes.

use core::cell::Cell;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsAtom, JsHeap, JsInterface as _, JsScope};

use super::syntax::{Angle, Axis, Data, Length};
use super::values::{Owner, Value};
use crate::abi::Rect;
use crate::api::core::{
    Atom, DomString, Edge, Element, Kind, Known, Node, NodeList, Ns, Rooted, atom,
};
use crate::api::graphics::{Affine, Failure};
use crate::api::range::{Point, selection_of};
use crate::calc::Unit;
use crate::document::Document;
use crate::generated_bindgen::geometry::{DOMMatrix2DInit, DOMPointInit};
use crate::generated_bindgen::svg::*;
use crate::svg::Bounds;
use crate::tree::NodeId;
use crate::types::PointerEvents;
use crate::values::{Out, text, write_number};

/// The engine has only looked at the attributes of what is rendered.
pub(super) fn prepare(element: &Element) {
    if !element.is_rendered() {
        element
            .shadow_including_root()
            .shadow_including_descendants()
            .for_each(|it| it.engine(|engine, id| engine.prepare(id, false)));
    }
}

#[optimize(size)]
fn laid_out<'a, R: Default>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    read: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    prepare(element);
    element.synced_engine(cx, |document, id| {
        document.catch_up_with_compositor();
        document.update_layout_for(id);
        read(document, id)
    })
}

#[optimize(size)]
fn rendered<'a, R: Default>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    read: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    if element.is_rendered() {
        laid_out(cx, element, read)
    } else {
        R::default()
    }
}

pub(super) fn animated_attribute<'a>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    name: Known,
) -> Option<DomString> {
    element.is_rendered().then_some(())?;
    element.synced_engine(cx, |document, id| {
        let name = Atom::from(name).name();
        document.update_style();
        document
            .smil
            .effects
            .bases
            .contains_key(&(id, name))
            .then(|| {
                Some(DomString::from_utf8(
                    document.tree.element(id)?.attribute(name)?,
                ))
            })?
    })
}

/// `None` if there is nothing for it to be relative to.
pub(super) fn resolve_length<'a>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    source: &str,
    axis: Axis,
) -> Option<f64> {
    rendered(cx, element, |document, id| {
        let resolve = |it: crate::svg::Node| {
            Some(it.resolve(&document.parse_svg_length(&it, source)?, axis as usize))
        };
        Some(
            document
                .svg_node(id)
                .and_then(resolve)
                .filter(|it| !it.is_nan())
                .map_or(0.0, f64::from),
        )
    })
}

fn svg_ancestors(element: &Element) -> impl Iterator<Item = &Element> {
    let above = core::iter::successors(element.parent_or_host(), |it| it.parent_or_host())
        .map_while(Node::as_element);
    above.take_while(|it| it.ns() == Ns::Svg && it.kind() != Kind::SvgForeignObject)
}

fn is_viewport(element: &Element) -> bool {
    matches!(element.kind(), Kind::SvgSvg | Kind::SvgSymbol)
}

impl SVGElement {
    pub(crate) fn get_owner_svg_element(&self) -> Option<&Element> {
        svg_ancestors(self).find(|it| it.kind() == Kind::SvgSvg)
    }

    pub(crate) fn get_viewport_element(&self) -> Option<&Element> {
        svg_ancestors(self).find(|it| is_viewport(it) || it.kind() == Kind::SvgImage)
    }
}

fn matrix_of<'a>(cx: &mut JsScope<'a>, element: &'a Element, to_screen: bool) -> Affine {
    let matrix = laid_out(cx, element, |document, id| {
        if to_screen {
            document.svg_screen_matrix(id)
        } else {
            Some(document.svg_viewport_matrix(id))
        }
    });
    matrix.map_or_else(Affine::default, |it| Affine(it.map(f64::from)))
}

impl SVGGraphicsElement {
    pub(crate) fn get_nearest_viewport_element(&self) -> Option<&Element> {
        svg_ancestors(self).find(|it| is_viewport(it))
    }

    pub(crate) fn get_farthest_viewport_element(&self) -> Option<&Element> {
        svg_ancestors(self).filter(|it| is_viewport(it)).last()
    }

    pub(crate) fn get_b_box<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        _: &SVGBoundingBoxOptions,
    ) -> &'a SVGRect {
        let bounds = rendered(cx, self, |document, id| {
            document.svg_bounding_box(id, Bounds::Fill)
        });
        SVGRect::new(&cx.heap, bounds.unwrap_or_default().to_array())
    }

    pub(crate) fn get_ctm<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a SVGMatrix {
        let matrix = matrix_of(cx, self, false);
        SVGMatrix::new(&cx.heap, matrix)
    }

    pub(crate) fn get_screen_ctm<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a SVGMatrix {
        let matrix = matrix_of(cx, self, true);
        SVGMatrix::new(&cx.heap, matrix)
    }
}

impl SVGGeometryElement {
    pub(crate) fn is_point_in_fill<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        point: &DOMPointInit,
    ) -> bool {
        rendered(cx, self, |document, id| {
            document.svg_contains(id, [point.x as f32, point.y as f32], false)
        })
    }

    pub(crate) fn is_point_in_stroke<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        point: &DOMPointInit,
    ) -> bool {
        rendered(cx, self, |document, id| {
            document.svg_contains(id, [point.x as f32, point.y as f32], true)
        })
    }

    pub(crate) fn get_total_length<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        laid_out(cx, self, |document, id| {
            document.svg_point_at_length(id, 0.0)[0]
        })
    }

    pub(crate) fn get_point_at_length<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        distance: f32,
    ) -> Result<&'a SVGPoint, Failure> {
        let [_, x, y] = laid_out(cx, self, |document, id| {
            document.svg_point_at_length(id, distance)
        });
        if x.is_nan() {
            Err(Failure::invalid_state("The element's path is empty."))
        } else {
            Ok(SVGPoint::new(&cx.heap, [x, y]))
        }
    }
}

/// The start, the end, the extent, the rotation and the advance.
type Character = [f32; 10];

impl SVGTextContentElement {
    fn characters<'a>(&'a self, cx: &mut JsScope<'a>) -> Vec<Character> {
        rendered(cx, self, |document, id| {
            document.svg_characters(id).as_chunks().0.to_vec()
        })
    }

    fn characters_from<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> Result<Vec<Character>, Failure> {
        let mut all = self.characters(cx);
        if index as usize >= all.len() {
            return Err(Failure::index_size("The charnum provided is out of range."));
        }
        Ok(all.split_off(index as usize))
    }

    pub(crate) fn get_number_of_chars<'a>(&'a self, cx: &mut JsScope<'a>) -> i32 {
        self.characters(cx).len() as i32
    }

    pub(crate) fn get_computed_text_length<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        self.characters(cx)
            .iter()
            .map(|it| f64::from(it[9]))
            .sum::<f64>() as f32
            + 0.0
    }

    pub(crate) fn get_sub_string_length<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        start: u32,
        count: u32,
    ) -> Result<f32, Failure> {
        Ok(self
            .characters_from(cx, start)?
            .iter()
            .take(count as usize)
            .map(|it| f64::from(it[9]))
            .sum::<f64>() as f32
            + 0.0)
    }

    pub(crate) fn get_start_position_of_char<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> Result<&'a SVGPoint, Failure> {
        let [x, y, ..] = self.characters_from(cx, index)?[0];
        Ok(SVGPoint::new(&cx.heap, [x, y]))
    }

    pub(crate) fn get_end_position_of_char<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> Result<&'a SVGPoint, Failure> {
        let [_, _, x, y, ..] = self.characters_from(cx, index)?[0];
        Ok(SVGPoint::new(&cx.heap, [x, y]))
    }

    pub(crate) fn get_extent_of_char<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> Result<&'a SVGRect, Failure> {
        let [.., x, y, width, height, _, _] = self.characters_from(cx, index)?[0];
        Ok(SVGRect::new(&cx.heap, [x, y, width, height]))
    }

    pub(crate) fn get_rotation_of_char<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> Result<f32, Failure> {
        Ok(self.characters_from(cx, index)?[0][8])
    }

    pub(crate) fn get_char_num_at_position<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        point: &DOMPointInit,
    ) -> i32 {
        let mut found = -1;
        for (index, [.., x, y, width, height, _, advance]) in
            (0..).zip(self.characters(cx).into_iter().map(|it| it.map(f64::from)))
        {
            if (x..=x + width).contains(&point.x)
                && (y..=y + height).contains(&point.y)
                && (advance != 0.0 || found < 0)
            {
                found = index;
            }
        }
        found
    }

    pub(crate) fn select_sub_string<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        start: u32,
        count: u32,
    ) -> Result<(), Failure> {
        let end = start + count.min(self.characters_from(cx, start)?.len() as u32);
        let locate = |mut offset: u32| {
            let mut last = None;
            for text in self.descendants().filter_map(Node::as_text) {
                last = Some((text, offset.min(text.data_length())));
                offset = match offset.checked_sub(text.data_length()) {
                    None | Some(0) => break,
                    Some(rest) => rest,
                };
            }
            last
        };
        if let (Some(start), Some(end)) = (locate(start), locate(end)) {
            selection_of(&cx.heap, self.doc()).select(
                cx,
                Point::new(start.0, start.1),
                Point::new(end.0, end.1),
            );
        }
        Ok(())
    }
}

struct Zoom(Cell<f32>);

fn is_root(element: &Element) -> bool {
    element.parent().is_some_and(|it| it.as_doc().is_some())
}

fn scale_of(element: &Element) -> &Cell<f32> {
    &element.extra_with(|| Zoom(Cell::new(1.0))).0
}

fn translation_of<'a>(heap: &JsHeap<'a>, element: &Element) -> JSValue {
    element.same_object(heap, Edge::SvgTranslation, || {
        let point = SVGPoint::new(heap, [0.0; 2]);
        point.attach(Owner::ZoomedElement, element.to_js());
        point.to_js()
    })
}

#[optimize(size)]
pub(super) fn commit_zoom<'a>(cx: &mut JsScope<'a>, element: &'a Element) {
    if is_root(element) && element.is_rendered() {
        let [x, y, ..] = Value::from_js(&cx.heap, translation_of(&cx.heap, element))
            .map_or([0.0; 6], |it| it.numbers(cx));
        let scale = scale_of(element).get();
        element.synced_engine(cx, |document, id| {
            document.svg_zoom = [scale, 0.0, 0.0, scale, x as f32, y as f32];
            document.svg_changed(id);
        });
        element.doc().invalidate(cx);
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Relation {
    Intersects,
    Encloses,
}

impl SVGSVGElement {
    /// The rectangle is in the initial coordinate system of this element.
    fn relates<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        element: &'a Element,
        area: [f64; 6],
        relation: Relation,
        is_asked: bool,
    ) -> bool {
        use Kind::*;
        if matches!(element.kind(), SvgG | SvgA | SvgSwitch) && is_asked {
            let children = Rooted::from_nodes(&cx.heap, element.element_children().map(|it| &**it));
            return !children.is_empty()
                && bun_core::StackCheck::init().is_safe_to_recurse()
                && children
                    .iter()
                    .filter_map(Node::as_element)
                    .all(|it| self.relates(cx, it, area, relation, true));
        }
        let [x, y, width, height, ..] = area;
        if !matches!(
            element.kind(),
            SvgCircle
                | SvgEllipse
                | SvgForeignObject
                | SvgImage
                | SvgLine
                | SvgPath
                | SvgPolygon
                | SvgPolyline
                | SvgRect
                | SvgText
                | SvgUse
        ) {
            return false;
        }
        let ink = rendered(cx, element, |document, id| {
            let (bounds, style) = (document.bounding_rect(id), document.tree.style(id)?);
            let takes_part =
                relation == Relation::Encloses || style.ink.pointer_events != PointerEvents::None;
            (bounds.width + bounds.height != 0.0 && takes_part).then(|| {
                document
                    .svg_bounding_box(id, Bounds::Stroke)
                    .unwrap_or_default()
            })
        });
        let (Some(ink), Some(from_screen)) = (ink, matrix_of(cx, self, true).inverse()) else {
            return false;
        };
        let to_user_space = from_screen.then(matrix_of(cx, element, true).0);
        let matrix = if self.get_owner_svg_element().is_some() {
            to_user_space
        } else {
            matrix_of(cx, self, false).then(to_user_space.0)
        };
        let Rect {
            x: left, y: top, ..
        } = ink;
        let corners = [
            [left, top],
            [ink.right(), top],
            [left, ink.bottom()],
            [ink.right(), ink.bottom()],
        ];
        let corners =
            corners.map(|it| matrix.map(it.map(f64::from)).map(|it| f64::from(it as f32)));
        let [[min_x, min_y], [max_x, max_y]] = [f64::min, f64::max].map(|pick| {
            [0, 1].map(|axis| {
                corners
                    .iter()
                    .fold(corners[0][axis], |all, it| pick(all, it[axis]))
            })
        });
        match relation {
            Relation::Encloses => {
                x <= min_x && y <= min_y && max_x <= x + width && max_y <= y + height
            }
            Relation::Intersects => {
                min_x < x + width && x < max_x && min_y < y + height && y < max_y
            }
        }
    }

    fn related<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        rect: &'a SVGRect,
        reference: Option<&'a SVGElement>,
        relation: Relation,
    ) -> &'a NodeList {
        let (area, mut found) = (rect.numbers(cx), Rooted::default());
        let root: Option<&Element> = match reference {
            Some(reference) if self.contains(reference) => Some(reference),
            Some(reference) if !reference.contains(self) => None,
            _ => Some(self),
        };
        let candidates =
            Rooted::from_nodes(&cx.heap, root.into_iter().flat_map(|it| it.descendants()));
        for node in candidates.iter() {
            if node
                .as_element()
                .is_some_and(|it| self.relates(cx, it, area, relation, false))
            {
                found.push(&cx.heap, node);
            }
        }
        NodeList::from_nodes(&cx.heap, found.iter())
    }

    pub(crate) fn get_current_scale(&self) -> f32 {
        scale_of(self).get()
    }

    pub(crate) fn set_current_scale<'a>(&'a self, cx: &mut JsScope<'a>, value: f32) {
        if svg_ancestors(self).next().is_none() && self.is_connected() {
            scale_of(self).set(value);
            commit_zoom(cx, self);
        }
    }

    pub(crate) fn get_current_translate<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a SVGPoint> {
        SVGPoint::from_js(heap, translation_of(heap, self))
    }

    pub(crate) fn get_intersection_list<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        rect: &'a SVGRect,
        reference: Option<&'a SVGElement>,
    ) -> &'a NodeList {
        self.related(cx, rect, reference, Relation::Intersects)
    }

    pub(crate) fn get_enclosure_list<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        rect: &'a SVGRect,
        reference: Option<&'a SVGElement>,
    ) -> &'a NodeList {
        self.related(cx, rect, reference, Relation::Encloses)
    }

    pub(crate) fn check_intersection<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        element: &'a SVGElement,
        rect: &'a SVGRect,
    ) -> bool {
        let area = rect.numbers(cx);
        self.relates(cx, element, area, Relation::Intersects, true)
    }

    pub(crate) fn check_enclosure<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        element: &'a SVGElement,
        rect: &'a SVGRect,
    ) -> bool {
        let area = rect.numbers(cx);
        self.relates(cx, element, area, Relation::Encloses, false)
    }

    pub(crate) fn deselect_all<'a>(&'a self, cx: &mut JsScope<'a>) {
        selection_of(&cx.heap, self.doc()).clear(cx);
    }

    pub(crate) fn create_svg_number<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGNumber {
        js_SVGNumber::create(heap, Value::detached(Data::of([0])))
    }

    pub(crate) fn create_svg_length<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGLength {
        js_SVGLength::create(
            heap,
            Value::detached(Data::Length(Length::new(0.0, Unit::Number, Axis::Other))),
        )
    }

    pub(crate) fn create_svg_angle<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGAngle {
        js_SVGAngle::create(heap, Value::detached(Data::Angle(Angle::ZERO)))
    }

    pub(crate) fn create_svg_point<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGPoint {
        SVGPoint::new(heap, [0.0; 2])
    }

    pub(crate) fn create_svg_matrix<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGMatrix {
        SVGMatrix::new(heap, Affine::default())
    }

    pub(crate) fn create_svg_rect<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGRect {
        SVGRect::new(heap, [0.0; 4])
    }

    pub(crate) fn create_svg_transform<'a>(&self, heap: &JsHeap<'a>) -> &'a SVGTransform {
        SVGTransform::new(heap, Affine::default())
    }

    pub(crate) fn create_svg_transform_from_matrix<'a>(
        &self,
        heap: &JsHeap<'a>,
        matrix: &DOMMatrix2DInit,
    ) -> Result<&'a SVGTransform, Failure> {
        Ok(SVGTransform::new(heap, Affine::from_init(matrix)?))
    }

    pub(crate) fn get_element_by_id(&self, id: JsAtom<'_>) -> Option<&Element> {
        let id = Some(DomString::from_impl(id.get())).filter(|it| !it.is_empty())?;
        self.descendant_elements()
            .find(|it| it.with_attr_string(atom!("id"), |it| *it == id) == Some(true))
    }

    pub(crate) fn suspend_redraw(&self, _: u32) -> u32 {
        1
    }

    pub(crate) fn unsuspend_redraw(&self, _: u32) {}

    pub(crate) fn unsuspend_redraw_all(&self) {}

    pub(crate) fn force_redraw(&self) {}
}

impl SVGZoomAndPan {
    pub(crate) fn get_zoom_and_pan(&self) -> u16 {
        if self.with_attr(atom!("zoomAndPan"), |it| it == "disable") == Some(true) {
            1
        } else {
            2
        }
    }

    pub(crate) fn set_zoom_and_pan<'a>(&'a self, cx: &mut JsScope<'a>, value: u16) {
        if let 1 | 2 = value {
            self.set_attr(
                cx,
                atom!("zoomAndPan"),
                DomString::from(if value == 1 { "disable" } else { "magnify" }),
            );
        }
    }
}

impl SVGMarkerElement {
    pub(crate) fn set_orient_to_auto<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.set_attr(cx, atom!("orient"), DomString::from("auto"));
    }

    pub(crate) fn set_orient_to_angle<'a>(&'a self, cx: &mut JsScope<'a>, angle: &'a SVGAngle) {
        let angle = angle.get_value_as_string(cx);
        self.set_attr(cx, atom!("orient"), DomString::from(text(&angle)));
    }
}

impl SVGStdDeviation {
    pub(crate) fn set_std_deviation<'a>(&'a self, cx: &mut JsScope<'a>, x: f32, y: f32) {
        let mut pair = Out::new();
        crate::values::write_list(&[x, y], " ", &mut pair, |it, out| write_number(*it, out));
        self.set_attr(cx, atom!("stdDeviation"), DomString::from(text(&pair)));
    }
}
