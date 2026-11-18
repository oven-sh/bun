//! https://fullscreen.spec.whatwg.org/

use core::cell::Cell;

use super::popover;
use super::prelude::*;
use super::top_layer::set_in_top_layer;

#[derive(Clone, Copy)]
pub(crate) enum Pending {
    Change,
    Error,
}

#[derive(Default)]
struct Requested {
    /// https://fullscreen.spec.whatwg.org/#iframe-fullscreen-flag
    is_for_frame_itself: Cell<bool>,
    is_prefixed: Cell<bool>,
}

fn stack(ui: &Ui) -> impl DoubleEndedIterator<Item = &Element> {
    ui.top_layer()
        .iter()
        .filter(|it| it.has_state(State::FULLSCREEN))
}

pub(crate) fn element(ui: &Ui) -> Option<&Element> {
    stack(ui).next_back()
}

fn set_quietly<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, on: bool) {
    element.set_state(cx, State::FULLSCREEN, on);
    set_in_top_layer(cx, ui, element, on);
}

fn set<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, on: bool) {
    set_quietly(cx, ui, element, on);
    element.extra::<Requested>().is_for_frame_itself.set(false);
    queue_event(cx, ui, element, Pending::Change);
}

fn queue_event<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, event: Pending) {
    ui.set_fullscreen_events(Refs::collect(
        &cx.heap,
        ui.fullscreen_events().iter().chain([element]),
    ));
    ui.layers.fullscreen_events.borrow_mut().push(event);
    ui.doc().invalidate(cx);
}

/// https://fullscreen.spec.whatwg.org/#run-the-fullscreen-steps
pub(crate) fn fire_events<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let elements = ui.fullscreen_events();
    ui.set_fullscreen_events(Refs::default());
    for (element, event) in elements.iter().zip(ui.layers.fullscreen_events.take()) {
        let target: &Node = if element.is_connected() && element.doc() == ui.doc() {
            element
        } else {
            ui.doc()
        };
        let name = match (event, element.extra::<Requested>().is_prefixed.get()) {
            (Pending::Change, false) => atom!("fullscreenchange"),
            (Pending::Change, true) => atom!("webkitfullscreenchange"),
            (Pending::Error, false) => atom!("fullscreenerror"),
            (Pending::Error, true) => atom!("webkitfullscreenerror"),
        };
        fire(cx, target, name, COMPOSED);
    }
}

pub(crate) fn is_enabled(doc: &Doc) -> bool {
    Ui::of(doc).is_some_and(|it| {
        host::allows_feature(it, bun_web::permissions_policy::Feature::Fullscreen)
    })
}

fn is_ready(element: &Element) -> bool {
    let is_known = match element.ns() {
        Ns::Html => !element.is_html(atom!("dialog")),
        Ns::Svg => element.local() == atom!("svg"),
        Ns::MathMl => element.local() == atom!("math"),
        _ => false,
    };
    is_known && element.is_connected() && !popover::is_showing(element) && is_enabled(element.doc())
}

/// Also for the frame that has what was requested.
pub(crate) fn enter<'a>(cx: &mut Cx<'a>, ui: &'a Ui, new: &'a Element) {
    if element(ui) != Some(new) {
        popover::hide_above(cx, ui, popover::nearest_open(Some(new)));
        set(cx, ui, new, true);
    }
    host::set_fullscreen(cx, ui, true);
}

/// The promise.
pub(crate) fn request<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    is_prefixed: bool,
) -> bindgen::Result<'a, JSValue> {
    let Some(ui) = Ui::of(element.doc()) else {
        return Err(cx.heap.type_error(format_args!("Document not active")));
    };
    element.extra::<Requested>().is_prefixed.set(is_prefixed);
    let is_allowed = is_ready(element) && ui.consume_activation(cx);
    let promise = if is_prefixed {
        JSValue::UNDEFINED
    } else {
        host::new_promise(&cx.heap)
    };
    let arguments = [ui.value(), element.value(), promise];
    match is_allowed {
        true => host::ask_permission(
            cx,
            ui,
            "fullscreen",
            arguments,
            finish_request::<true>,
            finish_request::<false>,
        ),
        false => host::queue_task(cx, ui.doc(), arguments, finish_request::<false>),
    }
    Ok(promise)
}

fn finish_request<const IS_ALLOWED: bool>(cx: &mut Cx<'_>, [ui, element, promise]: [JSValue; 3]) {
    let (Some(ui), Some(element)) = (Ui::from_value(ui), Element::from_value(element)) else {
        return;
    };
    if !IS_ALLOWED || !is_ready(element) || element.doc() != ui.doc() {
        queue_event(cx, ui, element, Pending::Error);
        let error = cx.heap.type_error(format_args!("fullscreen error"));
        return host::settle(cx, promise, Err(error));
    }
    enter(cx, ui, element);
    element
        .extra::<Requested>()
        .is_for_frame_itself
        .set(element.is_html(atom!("iframe")));
    host::settle(cx, promise, Ok(()));
}

fn unfullscreen_all<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let Some(top) = element(ui) else { return };
    stack(ui)
        .filter(|it| *it != top)
        .for_each(|it| set_quietly(cx, ui, it, false));
    set(cx, ui, top, false);
}

/// `for_frame`: what was fullscreen in that frame no longer is.
pub(crate) fn leave<'a>(cx: &mut Cx<'a>, ui: &'a Ui, for_frame: Option<&'a Element>) {
    let top = element(ui);
    if for_frame
        .is_some_and(|it| top != Some(it) || it.extra::<Requested>().is_for_frame_itself.get())
    {
        return;
    }
    if let Some(top) = top {
        set(cx, ui, top, false);
    }
    if element(ui).is_none() {
        host::set_fullscreen(cx, ui, false);
    }
}

/// The promise.
pub(crate) fn exit<'a>(cx: &mut Cx<'a>, doc: &'a Doc) -> bindgen::Result<'a, JSValue> {
    let Some(ui) = Ui::of(doc).filter(|it| element(it).is_some()) else {
        return Err(cx.heap.type_error(format_args!("Document not active")));
    };
    let promise = host::new_promise(&cx.heap);
    host::queue_task(cx, doc, [ui.value(), promise], |cx, [ui, promise]| {
        if let Some(ui) = Ui::from_value(ui).filter(|it| element(it).is_some()) {
            leave(cx, ui, None);
            crate::api::frames::below(&cx.heap, ui)
                .iter()
                .for_each(|it| unfullscreen_all(cx, it));
        }
        host::settle(cx, promise, Ok(()));
    });
    Ok(promise)
}

pub(crate) fn exit_fully<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    let all = crate::api::frames::tree(&cx.heap, ui);
    let Some(top) = all.first().filter(|it| element(it).is_some()) else {
        return false;
    };
    all.iter().for_each(|it| unfullscreen_all(cx, it));
    host::set_fullscreen(cx, top, false);
    true
}

pub(crate) fn before_remove<'a>(cx: &mut Cx<'a>, ui: &'a Ui, removed: &'a Element) {
    let top = element(ui);
    for it in stack(ui).filter(|it| removed.contains_composed(it)) {
        if Some(it) != top {
            set_quietly(cx, ui, it, false);
            continue;
        }
        set(cx, ui, it, false);
        it.extra::<Requested>().is_prefixed.set(false);
        host::queue_task(cx, ui.doc(), [ui.value()], |cx, [ui]| {
            Ui::from_value(ui)
                .into_iter()
                .for_each(|it| leave(cx, it, None))
        });
    }
}
