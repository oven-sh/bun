//! Pens and fingers.

use core::cell::Cell;

use super::layout::ScrollUnit;
use super::mouse::{self, Action};
use super::pointer::{self, Fires, Place, Pointer};
use super::popover;
use super::prelude::*;
use crate::api::forms::input::Input;
use crate::api::uievents::{Modifiers, PointerData, Touch, TouchEvent};
use crate::types::Display;

const SLOP: f64 = 15.0;
const DOUBLE_TAP_TIME: f64 = 400.0;

bitflags::bitflags! {
    /// What `touch-action` allows.
    #[derive(Clone, Copy, Default)]
    struct Pans: u8 {
        const LEFT = 1;
        const RIGHT = 2;
        const UP = 4;
        const DOWN = 8;
        const ZOOM = 16;
    }
}

impl Pans {
    fn from_keyword(keyword: &[u8]) -> Pans {
        match keyword {
            b"auto" | b"manipulation" => Pans::all(),
            b"pan-x" => Pans::LEFT | Pans::RIGHT,
            b"pan-y" => Pans::UP | Pans::DOWN,
            b"pan-left" => Pans::LEFT,
            b"pan-right" => Pans::RIGHT,
            b"pan-up" => Pans::UP,
            b"pan-down" => Pans::DOWN,
            b"pinch-zoom" => Pans::ZOOM,
            _ => Pans::empty(),
        }
    }

    fn at<'a>(cx: &mut Cx<'a>, target: &'a Element) -> Pans {
        let mut pans = Pans::all();
        for at in target.flat_ancestors().map_while(Node::as_element) {
            if layout::style(cx, at, |it| it.display()).is_none_or(|it| it == Display::Inline) {
                continue;
            }
            pans &= bun_core::strings::tokenize(&layout::computed(cx, at, "touch-action"), b" ")
                .map(Pans::from_keyword)
                .collect();
            if looks_like(cx, at, Looks::SCROLLS) {
                break;
            }
        }
        pans
    }
}

#[derive(Default)]
pub(crate) struct Finger {
    identifier: Cell<i32>,
    pans: Cell<Pans>,
    is_scrolling: Cell<bool>,
}

#[derive(Default)]
pub(crate) struct Touches {
    pointers_made: Cell<i32>,
    may_tap: Cell<bool>,
    /// A listener has canceled what would start scrolling.
    is_handled: Cell<bool>,
    taps: Cell<i32>,
    tapped_at: Cell<Option<f64>>,
}

pub(crate) struct Contact {
    pub(crate) id: i32,
    pub(crate) place: Place,
    pub(crate) details: PointerData,
}

fn new_pointer<'a>(heap: &JsHeap<'a>, ui: &Ui, kind: Known) -> &'a Pointer {
    ui.touches.pointers_made.update(|it| it + 1);
    let pointer = Pointer::new(heap, ui.touches.pointers_made.get() + 1, kind);
    pointer.knows_pressure.set(true);
    pointer
}

fn describe(pointer: &Pointer, details: &PointerData) {
    let PointerData {
        id,
        kind,
        is_primary,
        ..
    } = pointer.data.take();
    pointer.data.replace(PointerData {
        id,
        kind,
        is_primary,
        ..details.clone()
    });
}

pub(super) fn with_pointer<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    pointer: &'a Pointer,
    run: impl FnOnce(&mut Cx<'a>),
) {
    let before = ui.pointer();
    ui.set_current_pointer(Some(pointer));
    run(cx);
    ui.set_current_pointer(Some(before));
}

pub(crate) fn with_pen<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    details: &PointerData,
    run: impl FnOnce(&mut Cx<'a>),
) {
    let pen = ui
        .pen()
        .unwrap_or_else(|| new_pointer(&cx.heap, ui, atom!("pen")));
    ui.set_pen(Some(pen));
    describe(pen, details);
    with_pointer(cx, ui, pen, run);
}

fn place<'a>(cx: &mut Cx<'a>, ui: &'a Ui, finger: &'a Pointer, contact: &Contact) {
    finger.place(ui, contact.place);
    finger.is_inside.set(true);
    describe(finger, &contact.details);
    let (client, scroll) = (finger.at.get(), layout::viewport_scroll(ui.doc()));
    let touch = Touch {
        identifier: contact.id,
        screen: finger.screen.get(),
        client,
        page: [client[0] + scroll[0], client[1] + scroll[1]],
        radius: contact.details.size.map(|it| it as f32 / 2.0),
        rotation_angle: 0.0,
        force: contact.details.pressure,
        _interior: Default::default(),
    };
    finger.set_touch(
        finger
            .touch_target()
            .map(|it| touch.on(&cx.heap, it.out_of_control())),
    );
}

fn is_any_scrolling(fingers: Refs<'_, Pointer>) -> bool {
    fingers.iter().any(|it| it.finger.is_scrolling.get())
}

/// One event for each target. False if one was canceled.
fn fire_touch<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    name: Known,
    changed: Refs<'a, Pointer>,
    modifiers: Modifiers,
) -> bool {
    if !is_listened_to(name) {
        return true;
    }
    let (all, mut proceeds) = (ui.fingers(), true);
    for (index, target) in changed.iter().map(Pointer::touch_target).enumerate() {
        let Some(target) = target.filter(|_| {
            changed
                .iter()
                .take(index)
                .all(|it| it.touch_target() != target)
        }) else {
            continue;
        };
        let touches = |of: Refs<'a, Pointer>, everywhere: bool| {
            Refs::collect(
                &cx.heap,
                of.iter()
                    .filter(|it| everywhere || it.touch_target() == Some(target))
                    .filter_map(Pointer::touch),
            )
        };
        let is_blocking = name == atom!("touchend") || target.has_blocking_listener_above(name);
        let init = EventInit {
            cancelable: name != atom!("touchcancel") && is_blocking && !is_any_scrolling(changed),
            ..COMPOSED
        };
        let event = TouchEvent::new(
            &cx.heap,
            ui.doc(),
            name,
            init,
            modifiers,
            [
                touches(all, true),
                touches(all, false),
                touches(changed, false),
            ],
        );
        proceeds &= dispatch(cx, target, event);
    }
    proceeds
}

fn lift<'a>(cx: &mut Cx<'a>, ui: &'a Ui, finger: &'a Pointer, is_canceled: bool) {
    if finger.finger.is_scrolling.get() {
        return;
    }
    with_pointer(cx, ui, finger, |cx| {
        finger.buttons.set(0);
        let target = pointer::target(cx, ui);
        finger.data.borrow_mut().pressure = 0.0;
        let (name, button) = if is_canceled {
            (atom!("pointercancel"), None)
        } else {
            (atom!("pointerup"), Some(0))
        };
        target.map(|it| pointer::fire_pointer(cx, ui, it, name, button));
        if let Some(target) =
            target.filter(|it| !is_canceled && finger.data.borrow().is_primary && it.is_connected())
        {
            let was_modal = target.has_state(State::MODAL);
            popover::light_dismiss(cx, ui, target, false, finger.at.get());
            if was_modal && !target.has_state(State::MODAL) {
                ui.touches.may_tap.set(false);
            }
        }
        finger.set_pending_capture(None);
        pointer::settle_capture(cx, ui);
        pointer::hover(cx, ui, None);
    });
}

fn put_down<'a>(cx: &mut Cx<'a>, ui: &'a Ui, contact: &Contact) -> Option<&'a Pointer> {
    let target = pointer::element_at(
        cx,
        ui,
        contact.place.window.map(|it| it / layout::zoom(ui.doc())),
    )?;
    let finger = new_pointer(&cx.heap, ui, atom!("touch"));
    finger.set_touch_target(Some(target));
    finger.finger.identifier.set(contact.id);
    finger.finger.pans.set(Pans::at(cx, target));
    finger.data.borrow_mut().is_primary = ui.fingers().is_empty();
    finger.fires.set(Fires::POINTER_EVENTS);
    ui.set_fingers(ui.fingers().with(&cx.heap, finger));
    with_pointer(cx, ui, finger, |cx| {
        place(cx, ui, finger, contact);
        finger.pressed_at.set(finger.at.get());
        finger.buttons.set(1);
        pointer::hover(cx, ui, Some(target));
        finger.set_pending_capture(Some(target));
        if finger.data.borrow().is_primary {
            popover::light_dismiss(cx, ui, target, true, finger.at.get());
        }
        finger.skips_mouse_events.set(!pointer::fire_pointer(
            cx,
            ui,
            target,
            atom!("pointerdown"),
            Some(0),
        ));
    });
    Some(finger)
}

fn slider_of(finger: &Pointer) -> Option<Input<'_>> {
    Input::of(finger.tracked()?.as_element()?)
}

fn pan<'a>(cx: &mut Cx<'a>, ui: &'a Ui, finger: &'a Pointer, from: [f64; 2]) {
    let (state, [x, y]) = (&finger.finger, finger.at.get());
    if let Some(slider) = slider_of(finger) {
        return slider.slide_to(cx, [x, y]);
    }
    if !state.is_scrolling.get() {
        let [dx, dy] = [
            finger.pressed_at.get()[0] - x,
            finger.pressed_at.get()[1] - y,
        ];
        if dx.hypot(dy) <= SLOP {
            return;
        }
        let slider = finger
            .touch_target()
            .filter(|_| ui.touches.may_tap.replace(false))
            .and_then(|it| Input::slider_along(cx, it, dx.abs() > dy.abs()));
        if let Some(slider) = slider {
            return with_pointer(cx, ui, finger, |cx| slider.start_sliding(cx, ui, [x, y]));
        }
        let direction = match () {
            () if ui.fingers().len() > 1 => Pans::ZOOM,
            () if dx.abs() > dy.abs() => {
                if dx < 0.0 {
                    Pans::LEFT
                } else {
                    Pans::RIGHT
                }
            }
            () => {
                if dy < 0.0 {
                    Pans::UP
                } else {
                    Pans::DOWN
                }
            }
        };
        if ui.touches.is_handled.get() || !state.pans.get().contains(direction) {
            return state.pans.set(Pans::empty());
        }
        lift(cx, ui, finger, true);
        state.is_scrolling.set(true);
    }
    let along = |pans: Pans, distance: f64| {
        if state.pans.get().intersects(pans) {
            distance
        } else {
            0.0
        }
    };
    let delta = [
        along(Pans::LEFT | Pans::RIGHT, from[0] - x),
        along(Pans::UP | Pans::DOWN, from[1] - y),
    ];
    let Some(target) = finger.touch_target().filter(|it| it.is_connected()) else {
        return;
    };
    if !layout::user_scroll(cx, target, delta, ScrollUnit::Pixel, false) {
        ui.any_container()
            .into_iter()
            .for_each(|it| it.scroll_around(cx, delta));
    }
    ui.doc().invalidate(cx);
}

fn tap<'a>(cx: &mut Cx<'a>, ui: &'a Ui, finger: &'a Pointer, modifiers: Modifiers) {
    let (mouse, touches, now) = (ui.mouse(), &ui.touches, host::now());
    let is_again = touches
        .tapped_at
        .replace(Some(now))
        .is_some_and(|it| now - it < DOUBLE_TAP_TIME);
    touches.taps.update(|it| if is_again { it + 1 } else { 1 });
    let place = Place {
        window: finger.at.get().map(|it| it * layout::zoom(ui.doc())),
        screen: finger.screen.get(),
        modifiers: modifiers.bits(),
    };
    mouse.fires.set(Fires::MOUSE_EVENTS);
    mouse.set_tapped_by(Some(finger));
    for (action, buttons) in [
        (Action::Move, 0),
        (
            Action::Down {
                button: 0,
                clicks: touches.taps.get(),
            },
            1,
        ),
        (Action::Up { button: 0 }, 0),
    ] {
        mouse
            .skips_mouse_events
            .set(finger.skips_mouse_events.get());
        mouse::handle(cx, ui, action, place, buttons);
    }
    mouse.fires.take();
    mouse.set_tapped_by(None);
    mouse.is_inside.set(false);
}

fn note_result(ui: &Ui, proceeds: bool) {
    if !proceeds {
        ui.touches.is_handled.set(true);
        ui.touches.may_tap.set(false);
    }
}

pub(crate) fn start<'a>(cx: &mut Cx<'a>, ui: &'a Ui, contacts: &[Contact], modifiers: Modifiers) {
    let is_alone = ui.fingers().is_empty() && contacts.len() == 1;
    ui.touches.may_tap.set(is_alone);
    ui.touches.is_handled.update(|it| it && !is_alone);
    let mut started = Refs::default();
    for contact in contacts {
        if let Some(it) = put_down(cx, ui, contact) {
            started.push(&cx.heap, it);
        }
    }
    note_result(
        ui,
        fire_touch(cx, ui, atom!("touchstart"), started, modifiers),
    );
}

fn finger_of<'a>(ui: &'a Ui, contact: &Contact) -> Option<&'a Pointer> {
    ui.fingers()
        .iter()
        .find(|it| it.finger.identifier.get() == contact.id)
}

pub(crate) fn move_to<'a>(cx: &mut Cx<'a>, ui: &'a Ui, contacts: &[Contact], modifiers: Modifiers) {
    let changed = Refs::collect(&cx.heap, contacts.iter().filter_map(|it| finger_of(ui, it)));
    let from: Vec<_> = changed.iter().map(|it| it.at.get()).collect();
    for (contact, finger) in contacts
        .iter()
        .filter_map(|it| Some((it, finger_of(ui, it)?)))
    {
        with_pointer(cx, ui, finger, |cx| {
            place(cx, ui, finger, contact);
            let target = if finger.finger.is_scrolling.get() {
                None
            } else {
                pointer::target(cx, ui)
            };
            if let Some(it) = target {
                pointer::fire_move(cx, ui, it, None);
            }
        });
    }
    note_result(
        ui,
        fire_touch(cx, ui, atom!("touchmove"), changed, modifiers),
    );
    changed
        .iter()
        .zip(from)
        .for_each(|(finger, from)| pan(cx, ui, finger, from));
}

pub(crate) fn end<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    contacts: &[Contact],
    modifiers: Modifiers,
    is_canceled: bool,
) {
    let changed = Refs::collect(&cx.heap, contacts.iter().filter_map(|it| finger_of(ui, it)));
    if !is_canceled && !is_any_scrolling(changed) {
        ui.note_user_activation(true);
    }
    for finger in changed.iter() {
        lift(cx, ui, finger, is_canceled);
        if let Some(slider) = slider_of(finger) {
            slider.stop_sliding(cx);
        }
        ui.set_fingers(ui.fingers().without(&cx.heap, finger));
    }
    let proceeds = fire_touch(
        cx,
        ui,
        if is_canceled {
            atom!("touchcancel")
        } else {
            atom!("touchend")
        },
        changed,
        modifiers,
    );
    if let Some(only) = changed
        .first()
        .filter(|_| !is_canceled && proceeds && ui.touches.may_tap.get() && changed.len() == 1)
    {
        tap(cx, ui, only, modifiers);
    }
}
