//! https://w3c.github.io/pointerevents/

use core::cell::{Cell, RefCell};

use super::prelude::*;
use super::{drag, image_map, selecting, top_layer, touch};
use crate::api::forms;
use crate::api::transfer::DataTransfer;
use crate::api::uievents::{Modifiers, Mouse, MouseEvent, PointerData, PointerEvent, Touch};
use crate::generated_bindgen::interaction::{PointerCapture, PointerLockOptions, js_Pointer};
use crate::tree::NodeId;

const MOUSE_ID: i32 = 1;
const SCROLL_PAUSE: f64 = 100.0;
const TOOLTIP_DELAY: f64 = 600.0;

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(crate) struct Fires: u8 {
        const POINTER_EVENTS = 1;
        const MOUSE_EVENTS = 2;
    }
}

impl Default for Fires {
    fn default() -> Self {
        Fires::all()
    }
}

/// What follows the mouse until the button is released. It is about `Pointer::tracked`.
#[derive(Clone, Copy, Default)]
pub(crate) enum Tracking {
    #[default]
    None,
    Slider,
    Color,
    MediaSlider,
    Selection(selecting::Extent),
    Resizer {
        from: [f64; 2],
        size: [f64; 2],
        axes: [bool; 2],
    },
}

/// Where the library says that it is.
pub(crate) use bun_web::input::Place;

/// A mouse, a pen or a finger.
#[derive(Default)]
pub(crate) struct Pointer {
    pub(super) data: RefCell<PointerData>,
    /// Else the pressure follows from the buttons.
    pub(super) knows_pressure: Cell<bool>,
    pub(super) fires: Cell<Fires>,
    pub(crate) at: Cell<[f64; 2]>,
    pub(super) screen: Cell<[f64; 2]>,
    pub(super) movement: Cell<[f64; 2]>,
    locked_at: Cell<Option<[f64; 2]>>,
    pub(crate) buttons: Cell<u16>,
    pub(crate) modifiers: Cell<Modifiers>,
    /// The library moves a scrollbar by itself.
    pub(super) compositor_scrolls: Cell<bool>,
    pub(super) is_inside: Cell<bool>,
    /// What it was over has been removed.
    has_lost_target: Cell<bool>,
    is_hover_cut: Cell<bool>,
    pub(super) pressed_at: Cell<[f64; 2]>,
    pub(super) clicks: Cell<i32>,
    /// `pointerdown` was canceled.
    pub(super) skips_mouse_events: Cell<bool>,
    pub(super) is_on_scrollbar: Cell<bool>,
    pub(super) scroll_control: Cell<NodeId>,
    pub(super) may_drag_selection: Cell<bool>,
    pub(crate) drag: Cell<Option<drag::Drag>>,
    pub(super) tracking: Cell<Tracking>,
    pub(super) cursor: Cell<&'static str>,
    /// The frame that is coming knows what it has to be.
    is_cursor_stale: Cell<bool>,
    /// By the style of what is hovered.
    cursor_asked_for: Cell<&'static str>,
    pub(super) wheel_time: Cell<f64>,
    pub(crate) scrolled_at: Cell<f64>,
    waits_to_hover: Cell<bool>,
    tooltip_serial: Cell<i32>,
    pub(super) finger: touch::Finger,
}

slots!(Pointer = js_Pointer {
    tapped_by: Pointer,
    lock: Element,
    press_target: Element,
    capture: Element,
    pending_capture: Element,
    draggable: Element,
    dragged: Node,
    drag_over: Element,
    drag_data: DataTransfer,
    tracked: Node,
    selection_first: Node,
    selection_last: Node,
    autoscrolls: Node,
    wheel_target: Element,
    tooltip_of: Element,
    touch: Touch,
    touch_target: Element,
} [
    hovered: Element,
    pressed: Element,
]);

impl Pointer {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, id: i32, kind: Known) -> &'a Pointer {
        let data = PointerData {
            id,
            kind: kind.into(),
            is_primary: true,
            persistent_device_id: (id == MOUSE_ID).into(),
            ..Default::default()
        };
        js_Pointer::create(
            heap,
            Pointer {
                data: data.into(),
                at: [-1.0; 2].into(),
                scrolled_at: f64::NEG_INFINITY.into(),
                ..Default::default()
            },
        )
    }

    pub(super) fn mouse<'a>(heap: &JsHeap<'a>) -> &'a Pointer {
        Pointer::new(heap, MOUSE_ID, atom!("mouse"))
    }

    fn id(&self) -> i32 {
        self.data.borrow().id
    }

    pub(super) fn state(&self, button: i16) -> Mouse {
        let (buttons, modifiers) = (self.buttons.get(), self.modifiers.get());
        Mouse {
            screen: self.screen.get(),
            client: self.at.get(),
            movement: [0.0; 2],
            button,
            buttons,
            modifiers,
        }
    }

    pub(super) fn pointer_data(&self) -> PointerData {
        let source = self.tapped_by().unwrap_or(self);
        let data = source.data.borrow().clone();
        if source.knows_pressure.get() {
            data
        } else {
            PointerData {
                pressure: if self.buttons.get() == 0 { 0.0 } else { 0.5 },
                ..data
            }
        }
    }

    pub(super) fn place(&self, ui: &Ui, place: Place) {
        const COMPOSITOR_SCROLLS: u32 = 1 << 8;
        const KEYS: u32 = 63;
        self.modifiers
            .set(Modifiers::from_bits_retain(place.modifiers & KEYS));
        self.compositor_scrolls
            .set(place.modifiers & COMPOSITOR_SCROLLS != 0);
        let is_locked = self.lock().is_some();
        let [x, y] = self
            .locked_at
            .get()
            .filter(|_| is_locked)
            .unwrap_or_else(|| self.screen.get());
        self.movement.set(if is_locked || self.is_inside.get() {
            [place.screen[0] - x, place.screen[1] - y]
        } else {
            [0.0; 2]
        });
        if is_locked {
            return self.locked_at.set(Some(place.screen));
        }
        self.screen.set(place.screen);
        self.at
            .set(place.window.map(|it| it / layout::zoom(ui.doc())));
    }

    fn stop_hovering(&self, heap: &JsHeap<'_>, removed: &Element) {
        if let Some(index) = self.hovered().position(removed) {
            self.set_hovered(self.hovered().skip(heap, index + 1));
            self.has_lost_target.set(true);
        }
    }

    fn release_capture_in(&self, removed: &Element) {
        if self
            .pending_capture()
            .is_some_and(|it| removed.contains_composed(it))
        {
            self.set_pending_capture(None);
        }
    }

    pub(crate) fn track(&self, tracking: Tracking, node: &Node) {
        self.tracking.set(tracking);
        self.set_tracked(Some(node));
    }

    pub(super) fn is_tracking(&self) -> bool {
        !matches!(self.tracking.get(), Tracking::None)
    }

    pub(crate) fn stop_tracking(&self) {
        self.tracking.take();
        self.set_tracked(None);
        self.set_selection_first(None);
        self.set_selection_last(None);
        self.set_autoscrolls(None);
    }

    pub(super) fn release<'a>(&'a self, cx: &mut Cx<'a>) {
        self.pressed()
            .iter()
            .for_each(|it| it.set_state(cx, State::ACTIVE, false));
        self.set_pressed(Refs::default());
    }
}

pub(crate) fn element_at<'a>(cx: &mut Cx<'a>, ui: &'a Ui, point: [f64; 2]) -> Option<&'a Element> {
    let Some(found) = layout::hit_test(cx, ui.doc(), point) else {
        return ui.doc().document_element();
    };
    let Some(element) = found.as_element() else {
        return found.flat_parent()?.as_element();
    };
    let has_map = element.is_html(atom!("img")) && element.has_attr(atom!("usemap"));
    has_map
        .then(|| image_map::area_at(cx, element, point))
        .flatten()
        .or(Some(element))
}

pub(super) fn element_under<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Option<&'a Element> {
    element_at(cx, ui, ui.pointer().at.get())
}

/// What stands for `element` if a listener has removed it.
pub(super) fn still_there<'a>(ui: &'a Ui, element: &'a Element) -> Option<&'a Element> {
    let is_here = element.is_connected() && element.doc() == ui.doc();
    is_here
        .then_some(element)
        .or_else(|| ui.pointer().hovered().first())
        .or_else(|| ui.doc().document_element())
}

/// From the inside out.
pub(super) fn chain_of(element: Option<&Element>) -> impl Iterator<Item = &Element> {
    core::iter::successors(element, |it| {
        it.flat_parent().or_else(|| it.parent())?.as_element()
    })
}

/// How many of them match `:hover` or `:active`, which end at the top layer.
pub(super) fn reach_of(ui: &Ui, chain: Refs<'_, Element>) -> usize {
    let layer = ui.top_layer();
    let top = if layer.is_empty() {
        None
    } else {
        chain.iter().position(|it| layer.contains(it))
    };
    top.map_or(chain.len(), |it| it + 1)
}

fn is_heard(target: &Node, name: Known, bubbles: bool) -> bool {
    if bubbles {
        is_listened_to(name)
    } else {
        target.is_heard(name)
    }
}

fn all(bubbles: bool) -> EventInit {
    EventInit {
        bubbles,
        cancelable: bubbles,
        composed: bubbles,
    }
}

fn set_related(event: &Event, related: Option<&Element>) {
    if let Some(related) = related {
        event.set_related_node(Some(related.out_of_control()));
    }
}

const NO_BUTTON: i16 = -1;

fn fire_pointer_with<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Node,
    name: Known,
    button: i16,
    related: Option<&'a Element>,
    bubbles: bool,
) -> bool {
    let pointer = ui.pointer();
    let is_timed = matches!(
        name,
        atom!("pointerdown") | atom!("pointerup") | atom!("pointercancel")
    );
    if !is_timed && !is_heard(target, name, bubbles)
        || !pointer.fires.get().contains(Fires::POINTER_EVENTS)
    {
        return true;
    }
    let (mut init, mut mouse) = (all(bubbles), pointer.state(button));
    init.cancelable &= !matches!(
        name,
        atom!("gotpointercapture")
            | atom!("lostpointercapture")
            | atom!("pointercancel")
            | atom!("pointerrawupdate")
    );
    match name {
        atom!("pointermove") | atom!("pointerrawupdate") => mouse.movement = pointer.movement.get(),
        atom!("pointercancel") => (mouse.client, mouse.screen) = ([0.0; 2], [0.0; 2]),
        _ => {}
    }
    let event = PointerEvent::new(
        &cx.heap,
        ui.doc(),
        name,
        init,
        Trusted::Yes,
        0,
        mouse,
        pointer.pointer_data(),
    );
    set_related(event, related);
    dispatch(cx, target, event)
}

pub(super) fn fire_pointer<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Node,
    name: Known,
    button: Option<i16>,
) -> bool {
    fire_pointer_with(
        cx,
        ui,
        target,
        name,
        button.unwrap_or(NO_BUTTON),
        None,
        true,
    )
}

pub(super) fn fire_move<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element, button: Option<i16>) {
    if is_listened_to(atom!("pointerrawupdate")) && ui.doc().heap(&cx.heap).is_secure_context() {
        fire_pointer(cx, ui, target, atom!("pointerrawupdate"), button);
    }
    fire_pointer(cx, ui, target, atom!("pointermove"), button);
}

pub(super) fn mouse_event<'a>(
    heap: &JsHeap<'a>,
    ui: &Ui,
    name: Known,
    button: i16,
    detail: i32,
    bubbles: bool,
) -> &'a MouseEvent {
    let mut mouse = ui.pointer().state(button).floored();
    if name == atom!("mousemove") {
        mouse.movement = ui.pointer().movement.get();
    }
    MouseEvent::new(heap, ui.doc(), name, all(bubbles), detail, mouse)
}

#[derive(Clone, Copy)]
enum Boundary {
    Out,
    Leave,
    Over,
    Enter,
}

fn fire_boundary<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    kind: Fires,
    target: &'a Node,
    boundary: Boundary,
    related: Option<&'a Element>,
) {
    let bubbles = matches!(boundary, Boundary::Out | Boundary::Over);
    if kind == Fires::POINTER_EVENTS {
        let name = [
            atom!("pointerout"),
            atom!("pointerleave"),
            atom!("pointerover"),
            atom!("pointerenter"),
        ][boundary as usize];
        let is_touching =
            ui.pointer().data.borrow().kind == atom!("touch") && ui.pointer().capture().is_none();
        fire_pointer_with(
            cx,
            ui,
            target,
            name,
            if is_touching { 0 } else { NO_BUTTON },
            related,
            bubbles,
        );
        return;
    }
    let name = [
        atom!("mouseout"),
        atom!("mouseleave"),
        atom!("mouseover"),
        atom!("mouseenter"),
    ][boundary as usize];
    if is_heard(target, name, bubbles) {
        let event = mouse_event(&cx.heap, ui, name, 0, 0, bubbles);
        set_related(event, related);
        dispatch(cx, target, event);
    } else if bubbles {
        host::count_event(cx, ui, name);
    }
}

pub(super) fn hover<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: Option<&'a Element>) {
    let pointer = ui.pointer();
    let old = pointer.hovered();
    let (previous, has_lost_target) = (old.first(), pointer.has_lost_target.take());
    if previous == target && !has_lost_target {
        return;
    }
    let chain = Refs::collect(&cx.heap, chain_of(target));
    pointer.set_hovered(chain);
    let common = old
        .iter()
        .rev()
        .zip(chain.iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let (left, entered) = (old.len() - common, chain.len() - common);
    if pointer.fires.get().contains(Fires::MOUSE_EVENTS) {
        old.iter()
            .take(left)
            .for_each(|it| it.set_state(cx, State::HOVER, false));
        let reach = reach_of(ui, chain);
        let was_cut = pointer.is_hover_cut.replace(reach < chain.len());
        let count = if was_cut || reach < chain.len() {
            chain.len()
        } else {
            entered
        };
        chain
            .iter()
            .take(count)
            .enumerate()
            .for_each(|(index, it)| it.set_state(cx, State::HOVER, index < reach));
        old.iter()
            .take(left)
            .for_each(|it| super::interest::hover_changed(cx, ui, it, false));
        chain
            .iter()
            .take(entered.min(reach))
            .for_each(|it| super::interest::hover_changed(cx, ui, it, true));
    }
    let is_same = !has_lost_target
        && previous
            .zip(target)
            .is_some_and(|(a, b)| a.out_of_control() == b.out_of_control());
    for kind in pointer.fires.get().iter().filter(|_| !is_same) {
        if let Some(previous) = previous.filter(|_| !has_lost_target) {
            fire_boundary(cx, ui, kind, previous, Boundary::Out, target);
        }
        old.iter()
            .take(left)
            .for_each(|it| fire_boundary(cx, ui, kind, it, Boundary::Leave, target));
        match target {
            None => fire_boundary(cx, ui, kind, ui.doc(), Boundary::Leave, None),
            Some(target) if target.is_connected() => {
                fire_boundary(cx, ui, kind, target, Boundary::Over, previous)
            }
            Some(_) => {}
        }
        if previous.is_none() {
            fire_boundary(cx, ui, kind, ui.doc(), Boundary::Enter, None);
        }
        chain
            .iter()
            .rev()
            .skip(common)
            .for_each(|it| fire_boundary(cx, ui, kind, it, Boundary::Enter, previous));
    }
    let [before, now] = [old, chain].map(|it| it.iter().find(|it| selecting::is_link(it)));
    if before != now && pointer.fires.get().contains(Fires::MOUSE_EVENTS) {
        let url = now
            .and_then(|it| it.doc().parse_url(cx, &it.attr(atom!("href"))?))
            .map(|it| it.into_href().to_utf8().into_owned());
        ui.doc().last_window().into_iter().for_each(|it| {
            it.host()
                .target_url_changed(url.clone().unwrap_or_default())
        });
    }
    schedule_tooltip(cx, ui);
}

/// Before `removed` leaves the document.
pub(super) fn forget<'a>(cx: &mut Cx<'a>, ui: &'a Ui, removed: &'a Element) {
    let (pointer, state) = (ui.pointer(), removed.state());
    if state.contains(State::HOVER) || pointer.is_hover_cut.get() {
        pointer.stop_hovering(&cx.heap, removed);
    }
    for finger in ui.fingers().iter() {
        finger.stop_hovering(&cx.heap, removed);
        finger.release_capture_in(removed);
    }
    if state.contains(State::ACTIVE)
        && let Some(index) = pointer.pressed().position(removed)
    {
        pointer.set_pressed(pointer.pressed().skip(&cx.heap, index + 1));
    }
    if pointer
        .lock()
        .is_some_and(|it| removed.contains_composed(it))
    {
        set_lock(cx, ui, None);
    }
    pointer.release_capture_in(removed);
}

pub(super) fn set_cursor(ui: &Ui, cursor: &'static str) {
    if ui.pointer().cursor.replace(cursor) != cursor {
        host::set_cursor(ui, cursor);
    }
}

fn show_cursor<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let pointer = ui.pointer();
    if ui.frame_under_mouse().is_none() && pointer.drag.get().is_none() && !pointer.is_tracking() {
        let cursor = layout::cursor_at(cx, ui.doc(), pointer.at.get());
        set_cursor(ui, cursor);
    }
}

pub(super) fn update_cursor<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui.doc().arena().is_scheduled.get() {
        ui.pointer().is_cursor_stale.set(true)
    } else {
        show_cursor(cx, ui)
    }
}

/// https://w3c.github.io/pointerevents/#process-pending-pointer-capture
pub(super) fn settle_capture<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let pointer = ui.pointer();
    let (capture, pending) = (pointer.capture(), pointer.pending_capture());
    if capture == pending {
        return;
    }
    pointer.set_capture(None);
    if let Some(capture) = capture {
        fire_pointer(
            cx,
            ui,
            if capture.is_connected() {
                capture
            } else {
                ui.doc()
            },
            atom!("lostpointercapture"),
            None,
        );
    }
    if let Some(pending) = pending.filter(|it| it.is_connected()) {
        pointer.set_capture(Some(pending));
        hover(cx, ui, Some(pending));
        fire_pointer(cx, ui, pending, atom!("gotpointercapture"), None);
    }
}

/// A listener may have removed it.
pub(super) fn hover_target<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Option<&'a Element> {
    let pointer = ui.pointer();
    settle_capture(cx, ui);
    if pointer.capture().is_some_and(|it| !it.is_connected()) {
        settle_capture(cx, ui);
    }
    pointer.lock().or_else(|| {
        let target = pointer.capture().or_else(|| element_under(cx, ui));
        hover(cx, ui, target);
        target
    })
}

pub(super) fn target<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Option<&'a Element> {
    hover_target(cx, ui)
        .filter(|it| it.is_connected())
        .or_else(|| element_under(cx, ui))
}

/// After what is under the mouse may have changed.
pub(super) fn refresh_hover<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let pointer = ui.pointer();
    if !pointer.is_inside.get()
        || pointer.drag.get().is_some()
        || pointer.is_on_scrollbar.get()
        || pointer.lock().is_some()
    {
        return;
    }
    if pointer.capture().is_some_and(|it| !it.is_connected()) {
        settle_capture(cx, ui);
    }
    let target = pointer.capture().or_else(|| element_under(cx, ui));
    hover(cx, ui, target);
    update_cursor(cx, ui);
}

fn refresh_hover_after_scroll<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let left = ui.pointer().scrolled_at.get() + SCROLL_PAUSE - host::now();
    ui.pointer().waits_to_hover.set(left > 0.0);
    if left <= 0.0 {
        return refresh_hover(cx, ui);
    }
    host::set_timeout(cx, ui, left + 1.0, [ui.value()], |cx, [ui]| {
        _ = Ui::from_value(ui).map(|it| refresh_hover_after_scroll(cx, it))
    });
}

/// What passes under the mouse while the user scrolls is not hovered.
pub(crate) fn after_paint<'a>(cx: &mut Cx<'a>, ui: &'a Ui, has_moved: bool) {
    let pointer = ui.pointer();
    if !pointer.is_inside.get() {
        return;
    }
    let asked_for = pointer.hovered().first().map_or("", |it| {
        it.engine(|engine, id| engine.cursor_asked_for_by(id))
    });
    if pointer.is_cursor_stale.take() | (pointer.cursor_asked_for.replace(asked_for) != asked_for) {
        show_cursor(cx, ui);
    }
    if has_moved && !pointer.waits_to_hover.get() {
        refresh_hover_after_scroll(cx, ui);
    }
}

fn schedule_tooltip<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let pointer = ui.pointer();
    let titled = pointer
        .hovered()
        .iter()
        .find(|it| it.has_attr(atom!("title")))
        .filter(|_| ui.frame_under_mouse().is_none());
    if titled == pointer.tooltip_of() {
        return;
    }
    hide_tooltip(cx, ui);
    pointer.set_tooltip_of(titled);
    if titled.is_none() || pointer.buttons.get() != 0 {
        return;
    }
    host::set_timeout(
        cx,
        ui,
        TOOLTIP_DELAY,
        [
            ui.value(),
            pointer.value(),
            pointer.tooltip_serial.get().into(),
        ],
        |cx, [ui, pointer, serial]| {
            if let (Some(ui), Some(pointer)) = (
                Ui::from_value(ui),
                Pointer::from_value(pointer)
                    .filter(|it| it.tooltip_serial.get() == serial.as_int32()),
            ) && let Some(title) = pointer
                .tooltip_of()
                .filter(|it| it.is_connected())
                .and_then(|it| it.attr(atom!("title")))
                .filter(|it| !it.is_empty())
            {
                show_tooltip(cx, ui, &title.to_utf8());
            }
        },
    );
}

pub(crate) fn show_tooltip<'a>(cx: &mut Cx<'a>, ui: &'a Ui, text: &str) {
    let [x, y] = layout::narrow(ui.pointer().at.get());
    top_layer::show_bubble(cx, ui, [x, y + 20.0], text);
}

pub(super) fn hide_tooltip<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.pointer().tooltip_serial.update(|it| it.wrapping_add(1));
    top_layer::hide_bubble(cx, ui);
}

pub(crate) fn cancel_gestures<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    forms::close_picker(cx, ui);
    hide_tooltip(cx, ui);
}

fn with_id(doc: &Doc, id: i32) -> Option<&Pointer> {
    let ui = Ui::of(doc)?;
    [ui.mouse(), ui.pointer()]
        .into_iter()
        .chain(ui.pen())
        .chain(ui.fingers().iter())
        .find(|it| it.id() == id)
}

pub(crate) fn set_lock<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: Option<&'a Element>) {
    let mouse = ui.mouse();
    if mouse.lock() == element {
        return;
    }
    mouse.set_lock(element);
    mouse.locked_at.set(None);
    mouse.set_pending_capture(None);
    host::queue_event(cx, ui.doc(), atom!("pointerlockchange"));
}

fn finish_locking<const IS_ALLOWED: bool>(cx: &mut Cx<'_>, [ui, element, promise]: [JSValue; 3]) {
    let (Some(ui), Some(element)) = (Ui::from_value(ui), Element::from_value(element)) else {
        return;
    };
    let checked = match IS_ALLOWED {
        false => Err((DomError::NotAllowedError, "The app does not allow it.")),
        true if !element.is_connected() || element.doc() != ui.doc() => Err((
            DomError::WrongDocumentError,
            "The element is not in a window.",
        )),
        true => Ok(()),
    };
    match checked {
        Ok(()) => set_lock(cx, ui, Some(element)),
        Err(_) => host::queue_event(cx, ui.doc(), atom!("pointerlockerror")),
    }
    let result = refused(&cx.heap, checked);
    host::settle(cx, promise, result);
}

impl PointerCapture {
    fn pointer<'a>(&self, heap: &JsHeap<'a>, id: i32) -> bindgen::Result<'a, &Pointer> {
        with_id(self.doc(), id).ok_or_else(|| {
            dom_error(
                heap,
                DomError::NotFoundError,
                "No active pointer with the given id is found.",
            )
        })
    }

    pub(crate) fn set_pointer_capture<'a>(
        &self,
        heap: &JsHeap<'a>,
        id: i32,
    ) -> bindgen::Result<'a, ()> {
        let pointer = self.pointer(heap, id)?;
        if !self.is_connected() || pointer.lock().is_some() {
            return Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The element cannot capture it.",
            ));
        }
        if pointer.buttons.get() != 0 {
            pointer.set_pending_capture(Some(self));
        }
        Ok(())
    }

    pub(crate) fn release_pointer_capture<'a>(
        &self,
        heap: &JsHeap<'a>,
        id: i32,
    ) -> bindgen::Result<'a, ()> {
        let pointer = self.pointer(heap, id)?;
        if pointer.pending_capture() == Some(self) {
            pointer.set_pending_capture(None);
        }
        Ok(())
    }

    pub(crate) fn has_pointer_capture(&self, id: i32) -> bool {
        with_id(self.doc(), id).and_then(Pointer::pending_capture) == Some(self)
    }

    /// https://w3c.github.io/pointerlock/#dom-element-requestpointerlock
    pub(crate) fn request_pointer_lock<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        _: &PointerLockOptions,
    ) -> bindgen::Result<'a, JSValue> {
        let checked = match Ui::of(self.doc()).filter(|_| self.is_connected()) {
            None => Err((
                DomError::WrongDocumentError,
                "The element is not in a window.",
            )),
            Some(ui) if host::is_sandboxed(ui, "allow-pointer-lock") => {
                Err((DomError::SecurityError, "The frame is sandboxed."))
            }
            Some(ui) if ui.mouse().lock().is_none() && !ui.has_transient_activation() => {
                Err((DomError::NotAllowedError, "A user gesture is required."))
            }
            Some(ui) => Ok(ui),
        };
        if checked.is_err() {
            host::queue_event(cx, self.doc(), atom!("pointerlockerror"));
        }
        let ui = refused(&cx.heap, checked)?;
        let promise = host::new_promise(&cx.heap);
        host::ask_permission(
            cx,
            ui,
            "pointerLock",
            [ui.value(), self.value(), promise],
            finish_locking::<true>,
            finish_locking::<false>,
        );
        Ok(promise)
    }
}
