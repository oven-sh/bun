//! What happens to the surface that shows a page.

use bun_jsc::JsResult;
use bun_web::host::Keystroke;
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
use crate::generated_bindgen::interaction::*;

macro_rules! place {
    ($it:expr) => {{
        let window = [$it.x.unwrap_or_default(), $it.y];
        Place {
            window,
            screen: [$it.sx.unwrap_or(window[0]), $it.sy.unwrap_or(window[1])],
            modifiers: $it.m,
        }
    }};
}

fn word<'t>(given: &'t Option<bun_core::Utf8Bytes<'static>>) -> &'t str {
    given.as_ref().map_or("", |it| crate::values::text(it))
}

impl NativePlace {
    pub(crate) fn place(&self) -> Place {
        place!(self)
    }
}

impl NativeKey {
    pub(crate) fn stroke(&self) -> Keystroke {
        let [key, code] = [&self.key, &self.code].map(|it| word(it).into());
        Keystroke {
            is_down: self.e == NativeAction::Down,
            key,
            code,
            location: self.location,
            modifiers: self.m,
            repeats: self.repeat,
            is_composing: self.composing,
        }
    }
}

fn handle_mouse<'a>(cx: &mut Cx<'a>, ui: &'a Ui, event: &NativeMouse) {
    if event.e == NativeAction::Down {
        performance::note_input(&cx.heap, ui.doc());
    }
    let action = match event.e {
        NativeAction::Leave => return mouse::leave(cx, ui, event.x.map(|_| place!(event))),
        NativeAction::Down => Action::Down {
            button: event.b,
            clicks: event.n,
        },
        NativeAction::Up => Action::Up { button: event.b },
        _ => Action::Move,
    };
    mouse::handle(cx, ui, action, place!(event), event.buttons);
}

fn pointer_data(details: &NativePointerDetails, pressure: f64) -> PointerData {
    let data = PointerData {
        size: [details.width, details.height],
        pressure: details.pressure.unwrap_or(pressure) as f32,
        tangential_pressure: details.tangential_pressure as f32,
        twist: details.twist,
        ..Default::default()
    };
    data.with_orientation([Some(details.tilt_x), Some(details.tilt_y)], [None; 2])
}

fn handle_touch<'a>(cx: &mut Cx<'a>, ui: &'a Ui, event: &NativeTouch) {
    let contact = |it: &NativeTouchPoint| Contact {
        id: it.id,
        place: Place {
            modifiers: event.m,
            ..place!(it)
        },
        details: pointer_data(&it.details, 1.0),
    };
    let (contacts, modifiers): (Vec<_>, _) = (
        event.points.iter().map(contact).collect(),
        Modifiers::from_bits_truncate(event.m),
    );
    match event.e {
        NativeAction::Start => touch::start(cx, ui, &contacts, modifiers),
        NativeAction::Move => touch::move_to(cx, ui, &contacts, modifiers),
        action => touch::end(cx, ui, &contacts, modifiers, action != NativeAction::End),
    }
}

fn handle_key<'a>(cx: &mut Cx<'a>, window: &'a Window, ui: &'a Ui, event: &NativeKey) {
    let stroke = event.stroke();
    if window.host().before_input(stroke.clone()) {
        ui.pressed_key.take();
        return host::key_handled();
    }
    let atom_of = |it: &str| Atom::from_string(&DomString::from_utf8(it));
    let key = Key {
        key: atom_of(&stroke.key),
        code: atom_of(&stroke.code),
        location: event.location,
        repeat: event.repeat,
        modifiers: Modifiers::from_bits_truncate(event.m),
        is_composing: event.composing,
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

fn offsets(list: Option<Vec<u32>>) -> Option<[u32; 2]> {
    list?.try_into().ok()
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
fn handle<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    ui: &'a Ui,
    kind: NativeKind,
    event: JSValue,
) -> JsResult<bool> {
    if matches!(
        kind,
        NativeKind::Touch | NativeKind::Wheel | NativeKind::Pinch | NativeKind::Key
    ) {
        performance::note_input(&cx.heap, ui.doc());
    }
    let _input = matches!(
        kind,
        NativeKind::Mouse | NativeKind::Pen | NativeKind::Touch | NativeKind::Key
    )
    .then(HandlingInput::begin);
    Ok(match kind {
        NativeKind::Mouse => {
            let event = NativeMouse::from_js(cx.global(), event)?;
            if event.e == NativeAction::Move {
                handle_mouse(cx, ui, &event);
                return Ok(false);
            }
            window.got_input();
            handle_mouse(cx, ui, &event);
            tasks::hurry(cx.global(), true);
            true
        }
        NativeKind::Pen => {
            let (details, event) = (
                NativePen::from_js(cx.global(), event)?.details,
                NativeMouse::from_js(cx.global(), event)?,
            );
            touch::with_pen(cx, ui, &pointer_data(&details, 0.0), |cx| {
                handle_mouse(cx, ui, &event)
            });
            true
        }
        NativeKind::Touch => {
            let event = NativeTouch::from_js(cx.global(), event)?;
            handle_touch(cx, ui, &event);
            true
        }
        NativeKind::Wheel | NativeKind::Pinch => {
            let event = NativeWheel::from_js(cx.global(), event)?;
            let wheel = match kind {
                NativeKind::Pinch => Wheel::Pinch(event.delta),
                _ => Wheel::Turn {
                    delta: [event.dx, event.dy],
                    is_precise: event.precise,
                    is_handled: event.is_handled,
                },
            };
            tasks::scrolls(cx.global());
            mouse::handle_wheel(cx, ui, place!(event), wheel);
            false
        }
        NativeKind::Scroll => {
            let event = NativeScroll::from_js(cx.global(), event)?;
            tasks::scrolls(cx.global());
            ui.mouse().scrolled_at.set(host::now());
            ui.doc().engine(|engine, _| {
                engine.scrolled_by_compositor(
                    event.id,
                    [event.x, event.y],
                    event.has_ended,
                    event.generation,
                )
            });
            ui.doc().invalidate(cx);
            false
        }
        NativeKind::Key => {
            let event = NativeKey::from_js(cx.global(), event)?;
            window.got_input();
            handle_key(cx, window, ui, &event);
            tasks::hurry(cx.global(), true);
            ui.pressed_key.borrow().is_none()
        }
        NativeKind::Text => {
            let event = NativeText::from_js(cx.global(), event)?;
            keyboard::handle_text(
                cx,
                ui,
                &DomString::from_utf8(word(&event.text)),
                event.key,
                offsets(event.range),
            );
            true
        }
        NativeKind::Compose => {
            let event = NativeText::from_js(cx.global(), event)?;
            input_method::compose(
                cx,
                ui,
                &DomString::from_utf8(word(&event.text)),
                offsets(event.selection),
                offsets(event.range),
            );
            true
        }
        NativeKind::ComposeEnd => {
            input_method::end_composition(cx, ui);
            true
        }
        NativeKind::Resize => {
            let event = NativeSize::from_js(cx.global(), event)?;
            let shows =
                window.resize(cx, [event.width, event.height], event.scale) && !event.is_quiet;
            if shows {
                tasks::hurry(cx.global(), false);
            }
            shows
        }
        NativeKind::Focus | NativeKind::Blur => {
            let event = NativeFocus::from_js(cx.global(), event)?;
            if event.leaves {
                frames::input::leave_window(cx, ui);
            } else {
                set_focused(cx, ui, kind == NativeKind::Focus);
            }
            if event.direction != 0 {
                entry::tab_into_frame(cx, ui, event.direction < 0);
            }
            false
        }
        NativeKind::Drag => {
            let (action, place) = (
                NativeDrag::from_js(cx.global(), event)?.e,
                NativePlace::from_js(cx.global(), event)?.place(),
            );
            if action == NativeAction::Leave {
                drag::end(cx, ui, false);
            } else {
                drag::files_over(cx, ui, place, action == NativeAction::Drop, |cx| {
                    crate::api::transfer::of_chosen_files(cx, ui.doc(), event)
                });
            }
            false
        }
        NativeKind::A11y => {
            assistive::note_technology(cx, ui, false);
            assistive::update_accessibility(cx, ui);
            false
        }
        NativeKind::A11yAction => {
            let event = NativeAssistance::from_js(cx.global(), event)?;
            assistive::perform_accessibility_action(
                cx,
                ui,
                event.node,
                event.action,
                &event.numbers,
                &DomString::from_utf8(word(&event.text)),
            );
            window.render_now(cx);
            assistive::update_accessibility(cx, ui);
            false
        }
        NativeKind::Outside => false,
        NativeKind::Frame => {
            let is_urgent = NativeFrame::from_js(cx.global(), event)?.is_urgent;
            window.display_wants_frame(cx, is_urgent);
            false
        }
    })
}

pub(super) fn handle_event<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    ui: &'a Ui,
    kind: NativeKind,
    event: JSValue,
) {
    if !frames::input::route(cx, ui, kind, event) {
        match handle(cx, window, ui, kind, event) {
            Ok(true) => window.render_now(cx),
            Ok(false) => {}
            Err(error) => bun_web::exec::report(cx, Err(error.into())),
        }
    }
    if !ui.doc().arena().is_scheduled.get() {
        performance::present_events(&cx.heap, ui.doc());
    }
}
