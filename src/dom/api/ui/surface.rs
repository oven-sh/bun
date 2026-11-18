//! What happens to the surface that shows a page.

use bun_web::host::Keystroke;
use bun_web::input::{self, Details, Drag, Finger, Input, Mouse, Phase};
use bun_web::tasks;

use super::keyboard::{self, Key, Outcome};
use super::mouse::{self, Action, Wheel};
use super::pointer::{self, Place};
use super::prelude::*;
use super::touch::{self, Contact};
use super::{assistive, drag, entry, focus};
use crate::api::editing::input_method;
use crate::api::events::HandlingInput;
use crate::api::uievents::{Modifiers, PointerData};
use crate::api::window::Window;
use crate::api::{frames, performance};

fn handle_mouse<'a>(cx: &mut Cx<'a>, ui: &'a Ui, event: &Mouse) {
    if event.action == input::Action::Down {
        performance::note_input(&cx.heap, ui.doc());
    }
    let action = match event.action {
        input::Action::Leave => {
            return mouse::leave(
                cx,
                ui,
                Some(event.place).filter(|it| !it.window[0].is_nan()),
            );
        }
        input::Action::Down => Action::Down {
            button: event.button,
            clicks: event.clicks,
        },
        input::Action::Up => Action::Up {
            button: event.button,
        },
        input::Action::Move => Action::Move,
    };
    mouse::handle(cx, ui, action, event.place, event.buttons);
}

fn pointer_data(details: &Details, pressure: f64) -> PointerData {
    let data = PointerData {
        size: details.size,
        pressure: details.pressure.unwrap_or(pressure) as f32,
        tangential_pressure: details.tangential_pressure as f32,
        twist: details.twist,
        ..Default::default()
    };
    data.with_orientation(details.tilt.map(Some), [None; 2])
}

fn handle_touch<'a>(cx: &mut Cx<'a>, ui: &'a Ui, phase: Phase, fingers: &[Finger], modifiers: u32) {
    let contact = |it: &Finger| Contact {
        id: it.id,
        place: Place {
            modifiers,
            ..it.place
        },
        details: pointer_data(&it.details, 1.0),
    };
    let (contacts, modifiers): (Vec<_>, _) = (
        fingers.iter().map(contact).collect(),
        Modifiers::from_bits_truncate(modifiers),
    );
    match phase {
        Phase::Start => touch::start(cx, ui, &contacts, modifiers),
        Phase::Move => touch::move_to(cx, ui, &contacts, modifiers),
        phase => touch::end(cx, ui, &contacts, modifiers, phase != Phase::End),
    }
}

fn handle_key<'a>(cx: &mut Cx<'a>, window: &'a Window, ui: &'a Ui, stroke: Keystroke) {
    let atom_of = |it: &str| Atom::from_string(&DomString::from_utf8(it));
    let key = Key {
        key: atom_of(&stroke.key),
        code: atom_of(&stroke.code),
        location: stroke.location,
        repeat: stroke.repeats,
        modifiers: Modifiers::from_bits_truncate(stroke.modifiers),
        is_composing: stroke.is_composing,
    };
    if !stroke.is_down {
        return keyboard::key_up(cx, ui, &key);
    }
    match keyboard::key_down(cx, ui, &key) {
        Outcome::Handled => host::key_handled(),
        Outcome::Pending => {}
        Outcome::Unhandled => window.host().unhandled_key(stroke),
    }
}

pub(crate) fn set_focused<'a>(cx: &mut Cx<'a>, ui: &'a Ui, is_focused: bool) {
    if ui.is_focused.replace(is_focused) == is_focused {
        return;
    }
    if ui.container().is_some() {
        input_method::forget_what_was_told(ui);
    }
    if !is_focused {
        pointer::cancel_gestures(cx, ui);
    }
    Window::of(ui.doc())
        .into_iter()
        .for_each(|it| it.environment_changed(cx));
    focus::window_focus_changed(cx, ui);
}

/// Whether what it has changed does not wait for the display.
fn handle<'a>(cx: &mut Cx<'a>, window: &'a Window, ui: &'a Ui, input: Input) -> bool {
    if matches!(
        input,
        Input::Touch { .. } | Input::Wheel { .. } | Input::Pinch { .. } | Input::Key(_)
    ) {
        performance::note_input(&cx.heap, ui.doc());
    }
    if matches!(
        input,
        Input::Text { .. } | Input::Compose { .. } | Input::EndComposition
    ) {
        input_method::expect_edit(cx, ui);
    }
    let _input = matches!(
        input,
        Input::Mouse(_) | Input::Pen { .. } | Input::Touch { .. } | Input::Key(_)
    )
    .then(HandlingInput::begin);
    match input {
        Input::Mouse(event) if event.action == input::Action::Move => {
            handle_mouse(cx, ui, &event);
            false
        }
        Input::Mouse(event) => {
            window.got_input();
            handle_mouse(cx, ui, &event);
            tasks::hurry(cx.global(), true);
            true
        }
        Input::Pen { mouse, details } => {
            touch::with_pen(cx, ui, &pointer_data(&details, 0.0), |cx| {
                handle_mouse(cx, ui, &mouse)
            });
            true
        }
        Input::Touch {
            phase,
            fingers,
            modifiers,
        } => {
            handle_touch(cx, ui, phase, &fingers, modifiers);
            true
        }
        Input::Wheel {
            place,
            delta,
            is_precise,
            is_handled,
        } => {
            tasks::scrolls(cx.global());
            mouse::handle_wheel(
                cx,
                ui,
                place,
                Wheel::Turn {
                    delta,
                    is_precise,
                    is_handled,
                },
            );
            false
        }
        Input::Pinch { place, delta } => {
            tasks::scrolls(cx.global());
            mouse::handle_wheel(cx, ui, place, Wheel::Pinch(delta));
            false
        }
        Input::Scroll {
            node,
            generation,
            total,
            has_ended,
        } => {
            tasks::scrolls(cx.global());
            ui.mouse().scrolled_at.set(host::now());
            ui.doc().engine(|engine, _| {
                engine.scrolled_by_compositor(node, total, has_ended, generation)
            });
            ui.doc().invalidate(cx);
            false
        }
        Input::Key(stroke) => {
            window.got_input();
            handle_key(cx, window, ui, stroke);
            tasks::hurry(cx.global(), true);
            ui.pressed_key.borrow().is_none()
        }
        Input::KeyTaken => {
            ui.pressed_key.take();
            false
        }
        Input::Text {
            text,
            is_typed,
            range,
        } => {
            keyboard::handle_text(cx, ui, &DomString::from_utf8(&text), is_typed, range);
            true
        }
        Input::Compose {
            text,
            selection,
            range,
        } => {
            input_method::compose(cx, ui, &DomString::from_utf8(&text), selection, range);
            true
        }
        Input::EndComposition => {
            input_method::end_composition(cx, ui);
            true
        }
        Input::Resize { extent, is_quiet } => {
            let shows = window.resize(cx, extent.size, extent.scale) && !is_quiet;
            if shows {
                tasks::hurry(cx.global(), false);
            }
            shows
        }
        Input::Focus { direction } => {
            set_focused(cx, ui, true);
            if direction != 0 {
                entry::tab_into_frame(cx, ui, direction < 0);
            }
            false
        }
        Input::Blur { leaves } => {
            if leaves {
                frames::input::leave_window(cx, ui);
            } else {
                set_focused(cx, ui, false);
            }
            false
        }
        Input::Drag {
            phase: Drag::Leave, ..
        } => {
            drag::end(cx, ui, false);
            false
        }
        Input::Drag {
            phase,
            place,
            files,
        } => {
            drag::files_over(cx, ui, place, phase == Drag::Drop, |cx| {
                crate::api::transfer::of_chosen_files(cx, ui.doc(), &files)
            });
            false
        }
        Input::AccessibilityChanged => {
            assistive::note_technology(cx, ui, false);
            assistive::update_accessibility(cx, ui);
            false
        }
        Input::Perform {
            node,
            action,
            numbers,
            text,
        } => {
            assistive::perform_accessibility_action(
                cx,
                ui,
                node,
                action,
                &numbers,
                &DomString::from_utf8(&text),
            );
            window.render_now(cx);
            assistive::update_accessibility(cx, ui);
            false
        }
        Input::Outside => false,
        Input::Frame { is_urgent } => {
            window.display_wants_frame(cx, is_urgent);
            false
        }
    }
}

pub(crate) fn handle_input<'a>(cx: &mut Cx<'a>, window: &'a Window, ui: &'a Ui, input: Input) {
    if !frames::input::route(cx, ui, &input) && handle(cx, window, ui, input) {
        window.render_now(cx);
    }
    if !ui.doc().arena().is_scheduled.get() {
        performance::present_events(&cx.heap, ui.doc());
    }
}
