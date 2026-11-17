//! Which frame gets the mouse, the keys and the focus.

use super::*;
use crate::api::core::by_name::member;
use crate::api::editing::input_method;
use crate::api::ui::{entry as page, mouse, pointer, surface, tabbing};
use crate::generated_bindgen::interaction::{NativeKey, NativeKind, NativePlace};

/// Of a surface.
#[derive(Clone, Copy)]
pub(super) struct Event<'a>(pub(super) JsLocal<'a>);

impl<'a> Event<'a> {
    fn get(self, cx: &mut Cx<'a>, name: &'static str) -> Option<JSValue> {
        member(cx.global(), self.0.to_js(), name)
    }

    fn number(self, cx: &mut Cx<'a>, name: &'static str) -> f64 {
        self.get(cx, name)
            .and_then(JSValue::get_number)
            .unwrap_or(0.0)
    }

    fn word(self, cx: &mut Cx<'a>, name: &'static str) -> DomString {
        let value = self.get(cx, name).unwrap_or(JSValue::UNDEFINED);
        JsLocal::new(&cx.heap, value)
            .as_string()
            .and_then(|it| DomString::from_js_string(&cx.heap, it).ok())
            .unwrap_or_default()
    }

    fn points(self, cx: &mut Cx<'a>) -> Vec<Event<'a>> {
        let Some(all) = self.get(cx, "points").filter(|it| it.is_object()) else {
            return Vec::new();
        };
        let count = all.get_length(cx.global()).unwrap_or(0) as u32;
        (0..count)
            .filter_map(|it| {
                all.get_index(cx.global(), it)
                    .ok()
                    .map(|it| Event(JsLocal::new(&cx.heap, it)))
            })
            .collect()
    }

    fn with(self, cx: &mut Cx<'a>, changes: &[(&'static str, JSValue)]) -> Event<'a> {
        unsafe extern "C" {
            safe fn Bun__DOM__copyObject(
                global: &bun_jsc::JSGlobalObject,
                object: JSValue,
            ) -> JSValue;
        }
        let copy = Bun__DOM__copyObject(cx.global(), self.0.to_js());
        changes
            .iter()
            .for_each(|(name, value)| copy.put(cx.global(), name.as_bytes(), *value));
        Event(JsLocal::new(&cx.heap, copy))
    }

    fn new(cx: &mut Cx<'a>, kind: &str, name: &'static str, value: JSValue) -> Event<'a> {
        let (event, kind) = (
            JSValue::create_empty_object_with_null_prototype(cx.global()),
            DomString::from(kind).to_js(&cx.heap).to_js(),
        );
        event.put(cx.global(), b"t", kind);
        event.put(cx.global(), name.as_bytes(), value);
        Event(JsLocal::new(&cx.heap, event))
    }
}

impl Frame {
    fn moved<'a>(&'a self, cx: &mut Cx<'a>, event: Event<'a>) -> Event<'a> {
        let (zoom, [left, top, ..]) = (layout::zoom(self.around().doc()), self.area.get());
        let unit = self.scale.get() * if self.kind == Kind::Remote { zoom } else { 1.0 };
        let [x, y] = [("x", left), ("y", top)].map(|(axis, origin)| {
            (
                axis,
                JSValue::js_number((event.number(cx, axis) - origin * zoom) / unit),
            )
        });
        event.with(cx, &[x, y])
    }

    fn send<'a>(&'a self, cx: &mut Cx<'a>, event: Event<'a>) {
        if self.is(Flags::CLOSED) {
            return;
        }
        let points = event.points(cx);
        let event = if !points.is_empty() {
            let moved = JSValue::create_empty_array(cx.global(), 0).unwrap_or(JSValue::UNDEFINED);
            for point in points {
                let point = self.moved(cx, point);
                _ = moved.push(cx.global(), point.0.to_js());
            }
            event.with(cx, &[("points", moved)])
        } else if event.get(cx, "x").is_some() {
            self.moved(cx, event)
        } else {
            event
        };
        host::input(cx, self, event);
    }
}

fn frame_at<'a>(cx: &mut Cx<'a>, ui: &'a Ui, event: Event<'a>) -> Option<&'a Frame> {
    if mouse::is_held(ui) {
        return None;
    }
    let point = ["x", "y"].map(|it| event.number(cx, it) / layout::zoom(ui.doc()));
    let found = Frame::shown_by(pointer::element_at(cx, ui, point)?)?;
    if ui.doc().arena().is_scheduled.get() {
        place_all(cx, ui);
    }
    found.contains(point).then_some(found)
}

fn route_pointer<'a>(cx: &mut Cx<'a>, ui: &'a Ui, event: Event<'a>, kind: NativeKind) -> bool {
    let (old, action) = (ui.frame_under_mouse(), event.word(cx, "e"));
    let held = old.filter(|_| ui.framing.hold_pointer.get());
    if kind == NativeKind::Wheel && held.is_none() && mouse::is_scrolling_page(ui) {
        return false;
    }
    let found = held.or_else(|| {
        if action.eq_str("leave") {
            None
        } else {
            frame_at(cx, ui, event)
        }
    });
    if !matches!(kind, NativeKind::Wheel | NativeKind::Pinch) {
        if let Some(old) = old.filter(|it| found.map(Handle::value) != Some(it.value())) {
            let leave = DomString::from("leave").to_js(&cx.heap).to_js();
            let event = event.with(cx, &[("e", leave)]);
            old.send(cx, event);
        }
        ui.set_frame_under_mouse(found);
    }
    let Some(frame) = found else { return false };
    if matches!(kind, NativeKind::Mouse | NativeKind::Pen) {
        let buttons = event.number(cx, "buttons") as u16;
        ui.framing
            .hold_pointer
            .set(buttons != 0 && (held.is_some() || action.eq_str("down")));
        if held.is_none()
            && let Ok(place) = NativePlace::from_js(cx.global(), event.0.to_js())
        {
            mouse::enter_frame(cx, ui, place.place(), frame.element(), buttons);
        }
        if action.eq_str("down") {
            if frame.kind == Kind::Remote {
                ui.note_user_activation(true);
            }
            input_method::end_composition(cx, ui);
            focus::focus_on_mouse_down(cx, ui, frame.element());
            frame
                .outer_window()
                .into_iter()
                .for_each(|it| it.render_now(cx));
        }
    }
    frame.send(cx, event);
    true
}

/// All fingers go where the first one went.
fn route_touch<'a>(cx: &mut Cx<'a>, ui: &'a Ui, event: Event<'a>) -> bool {
    let (action, points, down) = (
        event.word(cx, "e"),
        event.points(cx),
        &ui.framing.fingers_down,
    );
    if action.eq_str("start") {
        if down.get() == 0 {
            let touched = points.first().and_then(|it| frame_at(cx, ui, *it));
            ui.set_touched_frame(touched);
        }
        down.update(|it| it + points.len() as u32);
    } else if !action.eq_str("move") {
        down.update(|it| it.saturating_sub(points.len() as u32));
    }
    ui.touched_frame().map(|it| it.send(cx, event)).is_some()
}

/// True if the event is not for the document.
pub(crate) fn route<'a>(cx: &mut Cx<'a>, ui: &'a Ui, kind: NativeKind, event: JSValue) -> bool {
    use NativeKind::*;
    if !ui.framing.are_shown.get() {
        return false;
    }
    let (event, focused) = (Event(JsLocal::new(&cx.heap, event)), ui.focused_frame());
    match kind {
        Touch => route_touch(cx, ui, event),
        Mouse | Pen | Wheel | Pinch | Drag => route_pointer(cx, ui, event, kind),
        Key => {
            let Some(focused) = focused else { return false };
            let Ok(stroke) = NativeKey::from_js(cx.global(), event.0.to_js()).map(|it| it.stroke())
            else {
                return false;
            };
            let leaves = stroke.is_down && stroke.key == "Escape";
            if ui
                .doc()
                .window()
                .is_some_and(|it| it.host().before_input(stroke))
                || leaves && fullscreen::exit_fully(cx, ui)
            {
                crate::api::ui::host::key_handled();
            } else {
                focused.send(cx, event);
            }
            true
        }
        Text | Compose | ComposeEnd => focused.map(|it| it.send(cx, event)).is_some(),
        Focus | Blur => {
            focused.into_iter().for_each(|it| it.send(cx, event));
            false
        }
        _ => false,
    }
}

fn set_focused_frame(ui: &Ui, frame: Option<&Frame>) {
    ui.set_focused_frame(frame);
    input_method::forget_what_was_told(ui);
}

pub(super) fn forget(ui: &Ui, frame: &Frame) {
    if ui.frame_under_mouse().map(Handle::value) == Some(frame.value()) {
        ui.set_frame_under_mouse(None);
    }
}

/// The window loses the focus to a frame in it, or gets it back.
fn follow_focus<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let (old, new) = (ui.focused_frame(), ui.focused().and_then(Frame::shown_by));
    if old.map(|it| it.element()) == new.map(|it| it.element()) {
        return ui.set_focused_frame(new);
    }
    new.into_iter()
        .for_each(|it| it.element().set_state(cx, State::FOCUS_VISIBLE, false));
    set_focused_frame(ui, new);
    if !ui.is_focused.get() {
        return;
    }
    if let Some(new) = new {
        let event = Event::new(cx, "focus", "direction", tabbing::direction(ui).into());
        new.send(cx, event);
    }
    if old.is_none() || new.is_none() {
        focus::fire_at_window(cx, ui, new.is_none());
    }
}

pub(crate) fn focus_changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui.framing.are_shown.get() {
        follow_focus(cx, ui);
    }
    if let Some(container) = ui.container().filter(|_| ui.focused().is_some()) {
        container.focus(cx);
    }
}

/// It has been replaced under the same element.
pub(super) fn frame_replaced(ui: &Ui, frame: &Frame) {
    if ui
        .focused_frame()
        .is_some_and(|it| it.element() == frame.element())
    {
        ui.set_focused_frame(Some(frame));
    }
}

pub(crate) fn blur_focused_frame<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if let Some(frame) = ui.focused_frame() {
        let event = Event::new(cx, "blur", "leaves", JSValue::TRUE);
        frame.send(cx, event);
    }
}

/// The focus goes to another frame of the same window.
pub(crate) fn leave_window<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui.focused_frame().is_none() {
        let changes = ui.focus.changes.get();
        page::reset_focus(cx, ui);
        ui.focus.changes.set(changes);
    }
    surface::set_focused(cx, ui, false);
    if ui.focused_frame().is_some() {
        set_focused_frame(ui, None);
        page::reset_focus(cx, ui);
    }
}

/// https://html.spec.whatwg.org/#activation-notification
pub(crate) fn spread_activation(ui: &Ui, is_mouse: bool) {
    activate_below(ui);
    for it in above(ui) {
        it.activation.was_by_mouse.set(is_mouse);
        it.activate();
    }
}

fn activate_below(ui: &Ui) {
    for inner in ui
        .frames()
        .iter()
        .filter(|it| it.kind == Kind::Local)
        .filter_map(Frame::inner)
    {
        if host::are_of_same_origin(ui, inner) {
            inner.activate();
            activate_below(inner);
        }
    }
}
