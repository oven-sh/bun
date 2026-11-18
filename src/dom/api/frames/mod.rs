//! `iframe`, `frame`, `object` and `embed`: the documents that they show.

pub(crate) mod entry;
mod host;
pub(crate) mod input;
mod local;
pub(crate) mod plugins;
mod remote;

use core::cell::{Cell, RefCell};

use crate::api::history::Context;
use crate::api::on_behalf::{allow_load, delay_load, resolve};
use crate::api::ui::prelude::*;
use crate::api::ui::{focus, fullscreen};
use crate::api::view;
use crate::api::window::Window;
use crate::generated_bindgen::frames::{FrameSvgDocument, FrameWindow, js_Frame};
use crate::tree::Replaced;

const DEFAULT_SIZE: [f64; 2] = [300.0, 150.0];
const LAZY_MARGIN: f64 = 1250.0;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// An empty document that is not shown.
    Blank,
    /// In this process.
    Local,
    /// In the web engine.
    Remote,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    struct Flags: u8 {
        const CLOSED = 1;
        const DELAYS_LOAD = 1 << 1;
        const MEASURING = 1 << 2;
        const FULLSCREEN = 1 << 3;
        const HAS_FIRED_LOAD = 1 << 4;
        const WAS_DISPLAYED = 1 << 5;
    }
}

struct Navigation {
    url: DomString,
    srcdoc: Option<DomString>,
    referrer_policy: DomString,
}

#[thread_local]
static LAST_NUMBER: Cell<u32> = Cell::new(0);
/// It is not among the frames of its document yet.
#[thread_local]
static CONNECTING: Cell<JSValue> = Cell::new(JSValue::ZERO);

/// What a page and its host call a frame or a popup.
pub(crate) fn next_number() -> u32 {
    LAST_NUMBER.update(|it| it + 1);
    LAST_NUMBER.get()
}

pub(crate) struct Frame {
    kind: Kind,
    number: u32,
    /// What the host knows: the size of the viewport, the scale, and whether it is visible.
    placement: Cell<Option<([f64; 2], f64, bool)>>,
    flags: Cell<Flags>,
    /// Where its content is in the viewport, and by how much a transform scales it.
    area: Cell<[f64; 4]>,
    scale: Cell<f64>,
    image: Cell<u32>,
    natural_size: Cell<[f64; 2]>,
    /// Of the viewport in it.
    size: Cell<[f64; 2]>,
    color_scheme: Cell<u32>,
    /// Of frames in a remote one.
    length: Cell<u32>,
    /// Until it is near the viewport.
    deferred: RefCell<Option<Navigation>>,
}

slots!(
    Frame = js_Frame {
        outer: Ui,
        inner: Ui
    }
);

/// Of a document.
#[derive(Default)]
pub(crate) struct Frames {
    /// Input may be for one of them.
    pub(crate) are_shown: Cell<bool>,
    hold_pointer: Cell<bool>,
    fingers_down: Cell<u32>,
    /// By an `IntersectionObserver` whose root is the viewport at the top.
    are_observed: Cell<bool>,
}

impl Frame {
    pub(crate) fn of(element: &Element) -> Option<&Frame> {
        Frame::from_value(element.edge(Edge::Frame)?)
    }

    /// One that gets input.
    pub(crate) fn shown_by(element: &Element) -> Option<&Frame> {
        Frame::of(element).filter(|it| it.kind != Kind::Blank)
    }

    pub(crate) fn with_number(outer: &Window, number: u32) -> Option<&Frame> {
        Ui::of(outer.document())?
            .frames()
            .iter()
            .chain(Frame::from_value(CONNECTING.get()))
            .find(|it| it.number == number)
    }

    pub(crate) fn number(&self) -> u32 {
        self.number
    }

    fn context(&self) -> Option<&Context> {
        Context::from_value(js_Frame::peer(self)?)
    }

    pub(crate) fn show_context(&self, context: &Context, image: u32) {
        js_Frame::set_peer(self, context.to_js());
        self.image.set(image);
    }

    /// If it has a document in this process.
    fn inner_window(&self) -> Option<&Window> {
        match self.kind {
            Kind::Local => self.context()?.window(),
            _ => Window::of(self.inner()?.doc()),
        }
    }

    fn is_indexed(&self) -> bool {
        self.element().root() == &**self.around().doc()
    }

    pub(crate) fn element(&self) -> &Element {
        js_Frame::element(self)
            .and_then(Element::from_value)
            .expect("it is set first")
    }

    /// Of the document that has the element.
    pub(crate) fn around(&self) -> &Ui {
        self.outer().expect("it is set first")
    }

    fn outer_window(&self) -> Option<&Window> {
        Window::of(self.around().doc())
    }

    fn is(&self, flag: Flags) -> bool {
        self.flags.get().contains(flag)
    }

    /// The result is what it was.
    fn set(&self, flag: Flags, on: bool) -> bool {
        let before = self.flags.get();
        self.flags
            .set(if on { before | flag } else { before - flag });
        before.contains(flag)
    }

    fn is_current(&self) -> bool {
        Frame::of(self.element()).is_some_and(|it| core::ptr::eq(it, self))
    }

    fn window<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        js_Frame::window(self).unwrap_or_else(|| host::window(cx, self))
    }

    /// If it has the same origin.
    fn document<'a>(&'a self, _: &mut Cx<'a>) -> Option<&'a Doc> {
        match self.kind {
            Kind::Blank => self.inner().map(Ui::doc),
            Kind::Local => host::document(self),
            Kind::Remote => None,
        }
    }

    fn target_name<'a>(&'a self, cx: &mut Cx<'a>) -> DomString {
        let given = self.name();
        if self.kind != Kind::Local {
            return self
                .inner()
                .and_then(|it| Window::of(it.doc()))
                .map_or(given, |it| it.get_name(cx));
        }
        let name = host::name(self);
        if name == given || self.document(cx).is_some() {
            name
        } else {
            DomString::default()
        }
    }

    fn replaced(&self) -> Replaced {
        let [width, height] = self.natural_size.get();
        Replaced::new(self.image.get(), width, height, f64::NAN)
    }

    fn show<'a>(&'a self, cx: &mut Cx<'a>) {
        crate::api::images::show_replaced(cx, self.element(), Some(self.replaced()));
    }

    fn is_near(&self, margin: f64) -> bool {
        let ([x, y, width, height], [right, bottom]) = (
            self.area.get(),
            self.outer_window().map_or([0.0; 2], Window::viewport_size),
        );
        width * height > 0.0
            && x < right + margin
            && y < bottom + margin
            && x + width > -margin
            && y + height > -margin
    }

    fn contains(&self, [x, y]: [f64; 2]) -> bool {
        let [left, top, width, height] = self.area.get();
        x >= left && y >= top && x < left + width && y < top + height
    }

    fn place<'a>(&'a self, cx: &mut Cx<'a>) {
        let element = self.element();
        let [left, top, outer_width, _] =
            layout::bounding_rect(cx, element).to_array().map(f64::from);
        let ([x, y, width, height, ..], [border_left, border_top, ..]) =
            element.engine(|engine, id| {
                (
                    engine.box_sizes(id).map(f64::from),
                    engine.client_metrics(id).map(f64::from),
                )
            });
        let scale = Some(outer_width / view::offset_width(cx, element))
            .filter(|it| it.is_normal())
            .unwrap_or(1.0);
        self.scale.set(scale);
        self.area.set([
            left + (border_left + x) * scale,
            top + (border_top + y) * scale,
            width * scale,
            height * scale,
        ]);
        match self.kind {
            Kind::Blank => {}
            Kind::Local => self.local_was_placed(cx),
            Kind::Remote => self.remote_was_placed(cx, [width, height]),
        }
        if self.is_near(LAZY_MARGIN) {
            self.stop_deferring(cx);
        }
    }

    fn navigate<'a>(&'a self, cx: &mut Cx<'a>) {
        match self.kind {
            Kind::Blank => {}
            Kind::Local => self.navigate_local(cx, false),
            Kind::Remote => {
                let url = source_of(cx, self.element());
                self.navigate_remote(cx, url);
            }
        }
    }

    fn start_or_defer<'a>(&'a self, cx: &mut Cx<'a>, navigation: Navigation) {
        let is_lazy = self.element().is_html(atom!("iframe"))
            && self.element().attr_is(atom!("loading"), "lazy")
            && !self.is_near(LAZY_MARGIN);
        self.deferred.replace(Some(navigation));
        if is_lazy {
            host::place_again(self.around());
        } else {
            self.stop_deferring(cx);
        }
    }

    fn stop_deferring<'a>(&'a self, _: &mut Cx<'a>) {
        match self.deferred.take() {
            Some(navigation) if self.kind == Kind::Local => host::navigate_local(self, &navigation),
            Some(navigation) => host::navigate_remote(self, &navigation.url),
            None => {}
        }
    }

    fn delay_load<'a>(&'a self, cx: &mut Cx<'a>, delays: bool) {
        match (self.set(Flags::DELAYS_LOAD, delays), delays) {
            (false, true) => delay_load(cx, self.around().doc()),
            (true, false) => allow_load(cx, self.around().doc()),
            _ => {}
        }
    }

    fn name(&self) -> DomString {
        self.element().attr(atom!("name")).unwrap_or_default()
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.is(Flags::CLOSED)
    }

    pub(crate) fn focus<'a>(&'a self, cx: &mut Cx<'a>) {
        if self.is_current() {
            focus::set_focus(
                cx,
                self.around(),
                Some(self.element()),
                focus::Cause::Mouse,
                Some(false),
            );
            self.around()
                .container()
                .into_iter()
                .for_each(|it| it.focus(cx));
        }
    }

    pub(crate) fn fullscreen<'a>(&'a self, cx: &mut Cx<'a>, on: bool) {
        self.set(Flags::FULLSCREEN, on);
        if !self.is_current() {
        } else if on {
            fullscreen::enter(cx, self.around(), self.element());
        } else {
            fullscreen::leave(cx, self.around(), Some(self.element()));
        }
    }

    pub(crate) fn is_focused(&self) -> bool {
        self.around().is_focused.get()
            && self
                .around()
                .focused_frame()
                .is_some_and(|it| core::ptr::eq(it, self))
    }

    pub(crate) fn is_inert<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        focus::is_inert(cx, self.element())
    }

    /// In the viewport at the top.
    fn origin(&self) -> [f64; 2] {
        let ([x, y, ..], [left, top]) = (self.area.get(), offset_in_top(self.around()));
        [x + left, y + top]
    }

    pub(crate) fn area(&self) -> [f64; 4] {
        self.area.get()
    }

    fn surface_scale(&self) -> f64 {
        self.outer_window().map_or(1.0, |it| it.scale() / it.zoom())
    }
}

// ───────────────────────────── the tree ─────────────────────────────

/// From the inside out. They may be of other origins.
pub(crate) fn above(ui: &Ui) -> impl Iterator<Item = &Ui> {
    core::iter::successors(ui.container(), |it| it.around().container()).map(Frame::around)
}

pub(crate) fn below<'a>(heap: &JsHeap<'a>, ui: &'a Ui) -> Refs<'a, Ui> {
    let inside = |it: &'a Ui| {
        it.frames()
            .iter()
            .rev()
            .filter(|it| it.kind == Kind::Local)
            .filter_map(Frame::inner)
    };
    let (mut found, mut pending) = (Refs::default(), inside(ui).collect::<Vec<_>>());
    while let Some(it) = pending.pop() {
        found.push(heap, it);
        pending.extend(inside(it));
    }
    found
}

/// The top first.
pub(crate) fn tree<'a>(heap: &JsHeap<'a>, ui: &'a Ui) -> Refs<'a, Ui> {
    let top = above(ui).last().unwrap_or(ui);
    Refs::collect(heap, [top].into_iter().chain(below(heap, top).iter()))
}

pub(crate) fn top_of_same_origin(ui: &Ui) -> Option<&Ui> {
    above(ui)
        .all(|it| host::are_of_same_origin(ui, it))
        .then(|| above(ui).last().unwrap_or(ui))
}

/// Where the viewport is in that at the top.
pub(crate) fn offset_in_top(ui: &Ui) -> [f64; 2] {
    core::iter::successors(ui.container(), |it| it.around().container())
        .map(Frame::area)
        .fold([0.0; 2], |[x, y], [left, top, ..]| [x + left, y + top])
}

pub(crate) fn container(doc: &Doc) -> Option<&Element> {
    Some(Ui::of(doc)?.container()?.element())
}

pub(crate) fn is_same_origin_with_top(doc: &Doc) -> bool {
    Ui::of(doc).and_then(|it| top_of_same_origin(it)).is_some()
}

/// As far as the documents are of the same origin.
pub(crate) fn reveal_around<'a>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    mut inside: Option<crate::scroll::Revealed>,
) {
    let Some(ui) = Ui::of(doc) else { return };
    for frame in core::iter::successors(ui.container(), |it| it.around().container())
        .take_while(|it| host::are_of_same_origin(ui, it.around()))
    {
        inside = inside.and_then(|it| layout::reveal_in_frame(cx, frame.element(), it));
    }
}

pub(crate) fn report_moves(doc: &Doc) {
    Ui::of(doc)
        .into_iter()
        .flat_map(above)
        .for_each(|it| it.framing.are_observed.set(true));
}

/// Those that `window[index]` has.
fn indexed(ui: &Ui) -> impl Iterator<Item = &Frame> {
    ui.frames().iter().filter(|it| it.is_indexed())
}

pub(crate) fn window_named<'a>(cx: &mut Cx<'a>, ui: &'a Ui, name: &DomString) -> Option<JSValue> {
    Some(
        indexed(ui)
            .find(|it| !name.is_empty() && it.target_name(cx) == *name)?
            .window(cx),
    )
}

pub(crate) fn may_be_unloaded<'a>(_: &mut Cx<'a>, doc: &'a Doc) -> bool {
    Ui::of(doc).is_none_or(|ui| {
        ui.frames()
            .iter()
            .filter(|it| it.kind == Kind::Local)
            .all(host::may_be_unloaded)
    })
}

pub(crate) fn stop<'a>(cx: &mut Cx<'a>, doc: &'a Doc) {
    for frame in Ui::of(doc)
        .into_iter()
        .flat_map(|it| it.frames().iter())
        .filter(|it| it.kind == Kind::Local)
    {
        host::stop(frame);
        frame.delay_load(cx, false);
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__frameCount(global: &bun_jsc::JSGlobalObject, window: JSValue) -> u32 {
    let ui = WindowTarget::of(JsHeap::from_global(global), window)
        .and_then(WindowTarget::doc)
        .and_then(Ui::of);
    ui.map_or(0, |it| indexed(it).count() as u32)
}

/// Zero if there is none.
#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__windowOfFrame(
    global: &bun_jsc::JSGlobalObject,
    window: JSValue,
    index: u32,
) -> JSValue {
    let find = |cx: &mut Cx<'_>| {
        let ui = Ui::of(WindowTarget::of(&cx.heap, window)?.doc()?)?;
        Some(indexed(ui).nth(index as usize)?.window(cx))
    };
    // SAFETY: a lookup, which may run scripts, is calling.
    unsafe { Cx::with(global.as_mut_ptr(), find) }.unwrap_or_default()
}

// ───────────────────────────── opening and closing ─────────────────────────────

fn source_of<'a>(cx: &mut Cx<'a>, element: &'a Element) -> Option<DomString> {
    let attribute = if element.is_html(atom!("object")) {
        atom!("data")
    } else {
        atom!("src")
    };
    let given = element.attr(attribute).filter(|it| !it.is_empty());
    given.map_or_else(
        || Some("about:blank".into()),
        |it| resolve(cx, element.doc(), &it),
    )
}

fn srcdoc_of(element: &Element) -> Option<DomString> {
    element
        .attr(atom!("srcdoc"))
        .filter(|_| element.is_html(atom!("iframe")))
}

fn create<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, kind: Kind) -> Option<&'a Frame> {
    if !host::take_room(ui) {
        return None;
    }
    let (placement, flags, area, image, color_scheme, length, deferred) = Default::default();
    let state = Frame {
        kind,
        number: next_number(),
        placement,
        flags,
        area,
        scale: 1.0.into(),
        image,
        natural_size: DEFAULT_SIZE.into(),
        size: Cell::default(),
        color_scheme,
        length,
        deferred,
    };
    let frame = js_Frame::create(ui.doc().heap(&cx.heap), state);
    js_Frame::set_element(frame, element.to_js());
    frame.set_outer(Some(ui));
    host::connect(cx, frame);
    element.set_edge(&cx.heap, Edge::Frame, frame.to_js());
    ui.set_frames(ui.frames().followed_by(&cx.heap, frame));
    crate::api::core::named::announce_in_window(&cx.heap, None);
    input::frame_replaced(ui, frame);
    if kind != Kind::Blank {
        ui.framing.are_shown.set(true);
        host::place_again(ui);
        frame.show(cx);
        ui.doc().invalidate(cx);
    }
    Some(frame)
}

fn open<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    let Some(ui) = Ui::of(element.doc()).filter(|_| element.is_connected()) else {
        return;
    };
    let url = if srcdoc_of(element).is_some() {
        Some("about:srcdoc".into())
    } else {
        source_of(cx, element)
    };
    let kind = match &url {
        _ if host::is_local(ui, &url.clone().unwrap_or_else(|| "about:blank".into())) => {
            Kind::Local
        }
        Some(url) if url.eq_str("about:blank") => Kind::Blank,
        _ => Kind::Remote,
    };
    match Frame::shown_by(element) {
        Some(frame) if (frame.kind == Kind::Local) == (kind == Kind::Local) => frame.navigate(cx),
        _ if kind == Kind::Remote => {
            let url = source_of(cx, element);
            remote::open(cx, ui, element, url);
        }
        _ => {
            close(cx, element);
            if kind == Kind::Local {
                local::open(cx, ui, element);
            } else if create(cx, ui, element, kind).is_some() {
                fire(cx, element, atom!("load"), PLAIN);
            }
        }
    }
}

fn close<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    let Some(frame) = Frame::of(element) else {
        return;
    };
    // Else its unload handlers have moved it.
    if !frame.set(Flags::CLOSED, true) {
        let ui = frame.around();
        ui.set_frames(ui.frames().without(&cx.heap, frame));
        host::give_room_back(ui);
        input::forget(ui, frame);
        host::dispose(frame);
        frame.delay_load(cx, false);
    }
    if frame.is_current() {
        element.clear_edge(&cx.heap, Edge::Frame);
    }
}

pub(crate) static STEPS: Steps = Steps {
    rendered: Some(|cx, element| {
        let [width, height] = DEFAULT_SIZE;
        let replaced = Frame::of(element).map_or_else(
            || Replaced::new(0, width, height, f64::NAN),
            Frame::replaced,
        );
        crate::api::images::show_replaced(cx, element, Some(replaced));
    }),
    post_connection: Some(|cx, element, is_move| {
        if !is_move {
            open(cx, element);
        } else if let Some(frame) = Frame::of(element).filter(|it| it.kind == Kind::Local) {
            host::owner_changed(frame);
        }
    }),
    removed: Some(|cx, element, _, is_move| {
        if !is_move {
            close(cx, element);
        }
    }),
    attribute_changed: Some(|cx, element, change| {
        if let Some(frame) = Frame::of(element).filter(|it| it.kind == Kind::Local)
            && [
                atom!("src"),
                atom!("srcdoc"),
                atom!("sandbox"),
                atom!("allow"),
                atom!("allowfullscreen"),
                atom!("csp"),
            ]
            .into_iter()
            .any(|it| change.is(it))
        {
            host::owner_changed(frame);
        }
        if change.is(atom!("src")) || change.is(atom!("srcdoc")) {
            return open(cx, element);
        }
        match Frame::shown_by(element) {
            Some(frame) if frame.kind == Kind::Local => frame.local_attribute_changed(cx, change),
            Some(frame) => frame.remote_attribute_changed(cx, change),
            None => {}
        }
    }),
    ..Steps::NONE
};

pub(crate) fn content_window<'a>(cx: &mut Cx<'a>, element: &'a Element) -> Option<JSValue> {
    Some(Frame::of(element)?.window(cx)).filter(|it| it.is_object())
}

impl FrameWindow {
    pub(crate) fn get_content_window<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        content_window(cx, self).unwrap_or(JSValue::NULL)
    }

    pub(crate) fn get_content_document<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        Frame::of(self)
            .and_then(|it| it.document(cx))
            .map_or(JSValue::NULL, Handle::value)
    }
}

impl FrameSvgDocument {
    pub(crate) fn svg_document<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        let doc = Frame::of(self).and_then(|it| it.document(cx));
        doc.filter(|it| it.content_type().eq_str("image/svg+xml"))
            .map_or(JSValue::NULL, Handle::value)
    }
}

// ───────────────────────────── rendering ─────────────────────────────

fn shows_foreign_content<'a>(cx: &mut Cx<'a>, frame: &'a Frame) -> bool {
    frame
        .document(cx)
        .and_then(Ui::of)
        .is_none_or(|it| it.frames().iter().any(|it| shows_foreign_content(cx, it)))
}

/// SVG filters must not see what they show.
fn mark_foreign<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    for frame in ui.frames().iter() {
        let is_foreign = shows_foreign_content(cx, frame);
        if frame.element().is_rendered() {
            frame
                .element()
                .engine(|engine, id| engine.set_foreign(id, is_foreign));
        }
    }
}

pub(crate) fn place_all<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.frames()
        .iter()
        .filter(|it| !it.is(Flags::CLOSED))
        .for_each(|it| it.place(cx));
    mark_foreign(cx, ui);
}

pub(crate) fn render_all<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.frames()
        .iter()
        .filter(|it| it.kind == Kind::Local && !it.is(Flags::CLOSED))
        .filter_map(|it| Window::of(it.inner()?.doc()))
        .for_each(|it| it.render_in_container(cx));
    mark_foreign(cx, ui);
}
