//! <https://drafts.csswg.org/cssom-view/>

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope};

use crate::api::animation::{no_scroll, scroll_result};
use crate::api::core::{Doc, Element, Node, atom};
use crate::api::cssom::{self, MediaQueryList};
use crate::api::geometry::{DOMRect, DOMRectList};
use crate::computed::Visibility;
use crate::document::Document;
use crate::generated_bindgen::cssom::CSSStyleProperties;
use crate::generated_bindgen::view::*;
use crate::scroll::Alignment;
use crate::tree::{DOCUMENT, NodeId};

fn laid_out<'a, R: Default>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    id: NodeId,
    read: impl FnOnce(&mut Document) -> R,
) -> R {
    if !node.is_rendered() {
        return R::default();
    }
    node.synced_engine(cx, |engine, _| {
        engine.catch_up_with_compositor();
        engine.update_layout_for(id);
        read(engine)
    })
}

/// <https://drafts.csswg.org/cssom-view/#potentially-scrollable>
fn is_potentially_scrollable<'a>(cx: &mut JsScope<'a>, body: &'a Element) -> bool {
    laid_out(cx, body, body.id(), |engine| {
        engine.scrolls_by_itself(body.id())
    })
}

fn is_root(element: &Element) -> bool {
    element.parent().is_some_and(|it| it.as_doc().is_some())
}

fn is_body(element: &Element) -> bool {
    element.doc().body() == Some(element)
}

/// What scrolls in its place.
fn scroller<'a>(cx: &mut JsScope<'a>, element: &'a Element) -> NodeId {
    match (element.doc().quirks(), is_root(element)) {
        (true, true) => 0,
        (false, true) => DOCUMENT,
        (true, false) if is_body(element) && !is_potentially_scrollable(cx, element) => DOCUMENT,
        _ if element.is_html(atom!("input")) => crate::api::forms::text_control(element)
            .and_then(|it| it.editor())
            .unwrap_or(element)
            .id(),
        _ => element.id(),
    }
}

/// <https://drafts.csswg.org/cssom-view/#normalize-non-finite-values>
fn finite(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

#[derive(Clone, Copy, PartialEq)]
enum From {
    Origin,
    Position,
}

fn scroll<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    id: NodeId,
    to: [Option<f64>; 2],
    from: From,
    behavior: ScrollBehavior,
    is_awaited: bool,
) {
    laid_out(cx, node, id, |engine| {
        let (start, zoom) = (
            if from == From::Position {
                engine.scroll_position(id)
            } else {
                [0.0; 2]
            },
            engine.zoom_of(id),
        );
        let to = [0, 1].map(|axis| {
            to[axis].map_or(f32::NAN, |it| {
                (finite(it) + f64::from(start[axis])) as f32 * zoom
            })
        });
        engine.scroll_for_script(is_awaited, |it| {
            it.scroll_to(id, to, behavior as u8, from == From::Position)
        });
    });
    node.doc().invalidate(cx);
}

impl WindowView {
    pub(crate) fn get_computed_style<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        element: &'a Element,
        pseudo: Option<&[u8]>,
    ) -> &'a CSSStyleProperties {
        cssom::get_computed_style(heap, element, pseudo)
    }

    pub(crate) fn match_media<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        query: &[u8],
    ) -> &'a MediaQueryList {
        cssom::match_media(cx, self.document(), query)
    }

    fn scroll<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        to: [Option<f64>; 2],
        from: From,
        behavior: ScrollBehavior,
    ) -> JSValue {
        scroll(cx, self.document(), DOCUMENT, to, from, behavior, true);
        scroll_result(cx, self.document())
    }

    pub(crate) fn scroll_to<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        options: &ScrollToOptions,
    ) -> JSValue {
        self.scroll(
            cx,
            [options.left, options.top],
            From::Origin,
            options.behavior,
        )
    }

    pub(crate) fn scroll_to_point<'a>(&'a self, cx: &mut JsScope<'a>, x: f64, y: f64) -> JSValue {
        self.scroll(cx, [Some(x), Some(y)], From::Origin, ScrollBehavior::Auto)
    }

    pub(crate) fn scroll_by<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        options: &ScrollToOptions,
    ) -> JSValue {
        self.scroll(
            cx,
            [options.left, options.top],
            From::Position,
            options.behavior,
        )
    }

    pub(crate) fn scroll_by_point<'a>(&'a self, cx: &mut JsScope<'a>, x: f64, y: f64) -> JSValue {
        self.scroll(cx, [Some(x), Some(y)], From::Position, ScrollBehavior::Auto)
    }
}

pub(crate) fn jump_viewport<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    to: [f64; 2],
    behavior: ScrollBehavior,
) {
    scroll(
        cx,
        doc,
        DOCUMENT,
        to.map(Some),
        From::Origin,
        behavior,
        false,
    );
}

pub(crate) fn scroll_to_start_of<'a>(cx: &mut JsScope<'a>, element: &'a Element) {
    if element.is_rendered() {
        element.reveal(
            cx,
            [Alignment::Nearest, Alignment::Start],
            ScrollBehavior::Auto,
            crate::scroll::Scrollers::All,
            false,
        );
    }
}

impl ScrollLogicalPosition {
    fn get(self) -> Alignment {
        [
            Alignment::Start,
            Alignment::Center,
            Alignment::End,
            Alignment::Nearest,
        ][self as usize]
    }
}

impl Element {
    fn measure<'a, R: Default>(
        &'a self,
        cx: &mut JsScope<'a>,
        read: impl FnOnce(&mut Document, NodeId) -> R,
    ) -> R {
        laid_out(cx, self, self.id(), |engine| read(engine, self.id()))
    }

    pub(crate) fn client_rects<'a>(&'a self, cx: &mut JsScope<'a>) -> Vec<[f64; 4]> {
        self.measure(cx, |engine, id| {
            engine
                .client_rects(id)
                .into_iter()
                .map(|it| it.to_array().map(f64::from))
                .collect()
        })
    }

    pub(crate) fn client_bounds<'a>(&'a self, cx: &mut JsScope<'a>) -> [f64; 4] {
        self.at_a_glance(cx, Document::plain_bounding_rect)
            .unwrap_or_else(|| self.measure(cx, |engine, id| engine.bounding_rect(id)))
            .to_array()
            .map(f64::from)
    }

    pub(crate) fn scrolling_area<'a>(&'a self, cx: &mut JsScope<'a>) -> [f32; 2] {
        let id = scroller(cx, self).max(DOCUMENT);
        let around = if id == DOCUMENT { DOCUMENT } else { self.id() };
        laid_out(cx, self, id, |engine| engine.scroll_size(around, id))
    }

    fn reveal<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        align: [Alignment; 2],
        behavior: ScrollBehavior,
        scrollers: crate::scroll::Scrollers,
        is_awaited: bool,
    ) {
        let revealed = self.synced_engine(cx, |engine, id| {
            engine.scroll_into_view_for_script(id, align, behavior as u8, scrollers, is_awaited)
        });
        self.doc().invalidate(cx);
        crate::api::frames::reveal_around(cx, self.doc(), revealed);
    }

    pub(crate) fn reveal_if_needed<'a>(&'a self, cx: &mut JsScope<'a>, centers: bool) {
        if self.is_rendered() {
            self.reveal(
                cx,
                [if centers {
                    Alignment::CenterIfNeeded
                } else {
                    Alignment::Nearest
                }; 2],
                ScrollBehavior::Auto,
                crate::scroll::Scrollers::All,
                false,
            );
        }
    }
}

impl ElementView {
    pub(crate) fn get_client_rects<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a DOMRectList {
        let rects = self.client_rects(cx);
        DOMRectList::new(self.realm(&cx.heap), &rects)
    }

    pub(crate) fn get_bounding_client_rect<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a DOMRect {
        let rect = self.client_bounds(cx);
        DOMRect::new(self.realm(&cx.heap), rect)
    }

    pub(crate) fn check_visibility<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        options: &CheckVisibilityOptions,
    ) -> bool {
        let mut hidden_by = Visibility::empty();
        hidden_by.set(
            Visibility::TRANSPARENT,
            options.check_opacity || options.opacity_property,
        );
        hidden_by.set(
            Visibility::HIDDEN,
            options.check_visibility_css || options.visibility_property,
        );
        hidden_by.set(Visibility::SKIPPED, options.content_visibility_auto);
        self.is_rendered()
            && self.synced_engine(cx, |engine, id| engine.check_visibility(id, hidden_by))
    }

    pub(crate) fn scroll_into_view<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        arg: Option<AlignmentOrOptions>,
    ) -> JSValue {
        let options = match arg {
            Some(AlignmentOrOptions::Options(it)) => it,
            Some(AlignmentOrOptions::ToTop(false)) => ScrollIntoViewOptions {
                block: ScrollLogicalPosition::End,
                ..Default::default()
            },
            _ => ScrollIntoViewOptions::default(),
        };
        if !self.is_rendered() {
            return no_scroll(self.doc());
        }
        self.reveal(
            cx,
            [options.inline_position.get(), options.block.get()],
            options.behavior,
            if options.container == ScrollIntoViewContainer::Nearest {
                crate::scroll::Scrollers::Nearest
            } else {
                crate::scroll::Scrollers::All
            },
            true,
        );
        scroll_result(cx, self.doc())
    }

    pub(crate) fn scroll_into_view_if_needed<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        center_if_needed: bool,
    ) {
        self.reveal_if_needed(cx, center_if_needed);
    }

    fn scroll_awaited<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        to: [Option<f64>; 2],
        from: From,
        behavior: ScrollBehavior,
    ) -> JSValue {
        if !self.is_rendered() {
            return no_scroll(self.doc());
        }
        let id = scroller(cx, self);
        scroll(cx, self, id, to, from, behavior, true);
        scroll_result(cx, self.doc())
    }

    pub(crate) fn scroll_to<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        options: &ScrollToOptions,
    ) -> JSValue {
        self.scroll_awaited(
            cx,
            [options.left, options.top],
            From::Origin,
            options.behavior,
        )
    }

    pub(crate) fn scroll_to_point<'a>(&'a self, cx: &mut JsScope<'a>, x: f64, y: f64) -> JSValue {
        self.scroll_awaited(cx, [Some(x), Some(y)], From::Origin, ScrollBehavior::Auto)
    }

    pub(crate) fn scroll_by<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        options: &ScrollToOptions,
    ) -> JSValue {
        self.scroll_awaited(
            cx,
            [options.left, options.top],
            From::Position,
            options.behavior,
        )
    }

    pub(crate) fn scroll_by_point<'a>(&'a self, cx: &mut JsScope<'a>, x: f64, y: f64) -> JSValue {
        self.scroll_awaited(cx, [Some(x), Some(y)], From::Position, ScrollBehavior::Auto)
    }

    fn position<'a>(&'a self, cx: &mut JsScope<'a>) -> [f32; 2] {
        let id = scroller(cx, self);
        laid_out(cx, self, id, |engine| engine.scroll_position(id))
    }

    fn set_position<'a>(&'a self, cx: &mut JsScope<'a>, to: [Option<f64>; 2]) {
        if self.is_rendered() {
            let id = scroller(cx, self);
            scroll(cx, self, id, to, From::Origin, ScrollBehavior::Auto, false);
        }
    }

    pub(crate) fn get_scroll_top<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.position(cx)[1].into()
    }

    pub(crate) fn set_scroll_top<'a>(&'a self, cx: &mut JsScope<'a>, value: f64) {
        self.set_position(cx, [None, Some(value)]);
    }

    pub(crate) fn get_scroll_left<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.position(cx)[0].into()
    }

    pub(crate) fn set_scroll_left<'a>(&'a self, cx: &mut JsScope<'a>, value: f64) {
        self.set_position(cx, [Some(value), None]);
    }

    pub(crate) fn get_scroll_width<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.scrolling_area(cx)[0].into()
    }

    pub(crate) fn get_scroll_height<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.scrolling_area(cx)[1].into()
    }

    pub(crate) fn get_client_top<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.measure(cx, |engine, id| engine.client_metrics(id))[1].into()
    }

    pub(crate) fn get_client_left<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.measure(cx, |engine, id| engine.client_metrics(id))[0].into()
    }

    fn client_metrics<'a>(&'a self, cx: &mut JsScope<'a>) -> [f32; 4] {
        let is_viewport = if self.doc().quirks() {
            is_body(self)
        } else {
            is_root(self)
        };
        let id = if is_viewport || scroller(cx, self) == DOCUMENT {
            DOCUMENT
        } else {
            self.id()
        };
        laid_out(cx, self, id, |engine| engine.client_metrics(id))
    }

    pub(crate) fn get_client_width<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.client_metrics(cx)[2].into()
    }

    pub(crate) fn get_client_height<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.client_metrics(cx)[3].into()
    }

    pub(crate) fn get_current_css_zoom<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        self.measure(cx, |engine, id| {
            (engine.tree[id].layout_box != 0).then(|| engine.zoom_of(id))
        })
        .unwrap_or(1.0)
        .into()
    }
}

pub(crate) fn scrolling_element<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) -> Option<&'a Element> {
    if doc.quirks() {
        doc.body()
            .filter(|it| it.is_html(atom!("body")) && !is_potentially_scrollable(cx, it))
    } else {
        doc.document_element()
    }
}

impl DocumentView {
    pub(crate) fn get_scrolling_element<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<&'a Element> {
        scrolling_element(cx, self)
    }
}

fn offset_metrics<'a>(cx: &mut JsScope<'a>, element: &'a Element) -> [f32; 5] {
    laid_out(cx, element, element.id(), |engine| {
        engine.offset_metrics(element.id())
    })
}

pub(crate) fn offset_width<'a>(cx: &mut JsScope<'a>, element: &'a Element) -> f64 {
    offset_metrics(cx, element)[3].into()
}

/// What is in a shadow tree that the element is not in is left out.
fn offset<'a>(cx: &mut JsScope<'a>, element: &'a Element) -> (Option<&'a Element>, [f32; 2]) {
    let [mut parent, mut left, mut top, ..] = offset_metrics(cx, element);
    while let Some(hidden) = element
        .rendered_node(parent as NodeId)
        .filter(|it| !it.contains_composed(element))
    {
        let ([outer, x, y, ..], [border_left, border_top, ..]) =
            hidden.engine(|engine, id| (engine.offset_metrics(id), engine.client_metrics(id)));
        (parent, left, top) = (outer, left + x + border_left, top + y + border_top);
    }
    (
        element
            .rendered_node(parent as NodeId)
            .and_then(Node::as_element),
        [left, top],
    )
}

impl HTMLElementView {
    /// <https://drafts.csswg.org/cssom-view/#dom-htmlelement-scrollparent>
    pub(crate) fn scroll_parent<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<&'a Element> {
        let scrolling = scrolling_element(cx, self.doc());
        let all = laid_out(cx, self, self.id(), |engine| {
            engine.scrollers_around(self.id())
        });
        let visible = all
            .into_iter()
            .filter_map(|it| self.rendered_node(it))
            .find(|it| it.contains_composed(self))?;
        visible
            .as_element()
            .or(scrolling)
            .filter(|_| scrolling != Some(self) && self.doc().document_element() != Some(self))
    }

    pub(crate) fn get_offset_parent<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<&'a Element> {
        offset(cx, self).0
    }

    pub(crate) fn get_offset_top<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        offset(cx, self).1[1].into()
    }

    pub(crate) fn get_offset_left<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        offset(cx, self).1[0].into()
    }

    pub(crate) fn get_offset_width<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        offset_width(cx, self)
    }

    pub(crate) fn get_offset_height<'a>(&'a self, cx: &mut JsScope<'a>) -> f64 {
        offset_metrics(cx, self)[4].into()
    }
}
