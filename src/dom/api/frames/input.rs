//! Which frame gets the mouse, the keys and the focus.

use bun_web::input::{Action, Drag, Input, Phase, Place};

use super::*;
use crate::api::editing::input_method;
use crate::api::ui::{entry as page, mouse, pointer, surface, tabbing};

impl Frame {
    fn send(&self, mut input: Input) {
        if self.is(Flags::CLOSED) {
            return;
        }
        let (zoom, [left, top, ..]) = (layout::zoom(self.around().doc()), self.area.get());
        let unit = self.scale.get() * if self.kind == Kind::Remote { zoom } else { 1.0 };
        input.move_places(|[x, y]| [(x - left * zoom) / unit, (y - top * zoom) / unit]);
        host::input(self, input);
    }
}

fn frame_at<'a>(cx: &mut Cx<'a>, ui: &'a Ui, place: Place) -> Option<&'a Frame> {
    if mouse::is_held(ui) {
        return None;
    }
    let point = place.window.map(|it| it / layout::zoom(ui.doc()));
    let found = Frame::shown_by(pointer::element_at(cx, ui, point)?)?;
    if ui.doc().arena().is_scheduled.get() {
        place_all(cx, ui);
    }
    found.contains(point).then_some(found)
}

fn leaving(mut input: Input) -> Input {
    match &mut input {
        Input::Mouse(mouse) | Input::Pen { mouse, .. } => mouse.action = Action::Leave,
        Input::Drag { phase, .. } => *phase = Drag::Leave,
        _ => {}
    }
    input
}

fn route_pointer<'a>(cx: &mut Cx<'a>, ui: &'a Ui, input: &Input, place: Place) -> bool {
    let old = ui.frame_under_mouse();
    let held = old.filter(|_| ui.framing.hold_pointer.get());
    if matches!(input, Input::Wheel { .. }) && held.is_none() && mouse::is_scrolling_page(ui) {
        return false;
    }
    let mouse = if let Input::Mouse(mouse) | Input::Pen { mouse, .. } = input {
        Some(mouse)
    } else {
        None
    };
    let leaves = mouse.is_some_and(|it| it.action == Action::Leave)
        || matches!(
            input,
            Input::Drag {
                phase: Drag::Leave,
                ..
            }
        );
    let found = held.or_else(|| {
        if leaves {
            None
        } else {
            frame_at(cx, ui, place)
        }
    });
    if !matches!(input, Input::Wheel { .. } | Input::Pinch { .. }) {
        if let Some(old) = old.filter(|it| found.map(Handle::value) != Some(it.value())) {
            old.send(leaving(input.clone()));
        }
        ui.set_frame_under_mouse(found);
    }
    let Some(frame) = found else { return false };
    if let Some(mouse) = mouse {
        ui.framing
            .hold_pointer
            .set(mouse.buttons != 0 && (held.is_some() || mouse.action == Action::Down));
        if held.is_none() {
            mouse::enter_frame(cx, ui, place, frame.element(), mouse.buttons);
        }
        if mouse.action == Action::Down {
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
    frame.send(input.clone());
    true
}

/// All fingers go where the first one went.
fn route_touch<'a>(cx: &mut Cx<'a>, ui: &'a Ui, input: &Input) -> bool {
    let (Input::Touch { phase, fingers, .. }, down) = (input, &ui.framing.fingers_down) else {
        return false;
    };
    if *phase == Phase::Start {
        if down.get() == 0 {
            let touched = fingers.first().and_then(|it| frame_at(cx, ui, it.place));
            ui.set_touched_frame(touched);
        }
        down.update(|it| it + fingers.len() as u32);
    } else if *phase != Phase::Move {
        down.update(|it| it.saturating_sub(fingers.len() as u32));
    }
    ui.touched_frame()
        .map(|it| it.send(input.clone()))
        .is_some()
}

/// True if it is not for the document.
pub(crate) fn route<'a>(cx: &mut Cx<'a>, ui: &'a Ui, input: &Input) -> bool {
    if !ui.framing.are_shown.get() {
        return false;
    }
    if let Some(place) = input.place() {
        return route_pointer(cx, ui, input, place);
    }
    let focused = ui.focused_frame();
    match input {
        Input::Touch { .. } => route_touch(cx, ui, input),
        Input::Key(stroke) => {
            let Some(focused) = focused else { return false };
            let leaves = stroke.is_down && stroke.key == "Escape";
            if leaves && fullscreen::exit_fully(cx, ui) {
                crate::api::ui::host::key_handled();
            } else {
                focused.send(input.clone());
            }
            true
        }
        Input::Text { .. } | Input::Compose { .. } | Input::EndComposition => {
            focused.map(|it| it.send(input.clone())).is_some()
        }
        Input::Focus { .. } | Input::Blur { .. } => {
            focused.into_iter().for_each(|it| it.send(input.clone()));
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
        new.send(Input::Focus {
            direction: tabbing::direction(ui),
        });
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

pub(crate) fn blur_focused_frame(ui: &Ui) {
    if let Some(frame) = ui.focused_frame() {
        frame.send(Input::Blur { leaves: true });
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
