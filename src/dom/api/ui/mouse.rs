//! From the mouse of the library to the events of the DOM.

use super::layout::{ScrollPart, ScrollUnit, ScrollbarMouse};
use super::pointer::{
    self, Place, Pointer, Tracking, chain_of, fire_move, fire_pointer, mouse_event, still_there,
};
use super::prelude::*;
use super::{drag, focus, popover, selecting, touch};
use crate::api::editing::{self, clipboard, input_method, spelling};
use crate::api::forms::{self, input::Input, text_control};
use crate::api::uievents::{Modifiers, PointerEvent, WheelEvent};

const DRAG_DISTANCE: f64 = 4.0;
const WHEEL_GESTURE_GAP: f64 = 500.0;
const ALL: EventInit = EventInit {
    cancelable: true,
    ..COMPOSED
};

/// The path of the event ends below it.
pub(super) fn disabled_control_above(element: &Element) -> Option<&Element> {
    element
        .flat_ancestors()
        .filter_map(Node::as_element)
        .find(|it| !it.is_html(atom!("fieldset")) && forms::is_disabled(it))
}

/// What controls do with an event that was not canceled.
pub(super) fn run_default_actions<'a>(
    cx: &mut Cx<'a>,
    target: &'a Element,
    event: &'a Event,
) -> bool {
    target.flat_ancestors().any(|it| {
        it.kind()
            .steps()
            .default_action
            .zip(it.as_element())
            .is_some_and(|(step, it)| step(cx, it, event, target))
    })
}

fn fire_mouse<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Element,
    name: Known,
    button: i16,
    detail: i32,
) -> bool {
    let (is_move, is_skipped) = (
        name == atom!("mousemove"),
        ui.pointer().skips_mouse_events.get(),
    );
    if is_move
        && ui.open_picker().is_none()
        && !is_listened_to(name)
        && !target.out_of_control().is_html(atom!("video"))
    {
        return true;
    }
    let event = mouse_event(&cx.heap, ui, name, button, detail, true);
    match disabled_control_above(target).filter(|_| !is_move) {
        Some(disabled) => is_skipped || dispatch_below(cx, target, event, Some(disabled)),
        None => {
            (is_skipped || dispatch(cx, target, event)) && !run_default_actions(cx, target, event)
        }
    }
}

/// By the document, also over a frame. As in browsers only documents in frames capture it without being asked to.
pub(crate) fn is_held(ui: &Ui) -> bool {
    let holds = |it: &Pointer| {
        let is_busy = || {
            it.pending_capture().is_some()
                || it.draggable().is_some()
                || it.is_on_scrollbar.get()
                || it.scroll_control.get() != 0
        };
        let is_tracked = || match it.tracking.get() {
            Tracking::None => false,
            Tracking::Selection(_) => range::try_selection(ui.doc())
                .and_then(Selection::span)
                .is_some_and(|it| !it.collapsed()),
            _ => true,
        };
        it.drag.get().is_some()
            || it.buttons.get() != 0 && (ui.container().is_some() || is_busy() || is_tracked())
    };
    holds(ui.mouse()) || ui.pen().is_some_and(holds)
}

/// The mouse is over a frame, which has the cursor and the events.
pub(crate) fn enter_frame<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    place: Place,
    frame: &'a Element,
    buttons: u16,
) {
    for pressed in [ui.mouse()]
        .into_iter()
        .chain(ui.pen())
        .filter(|it| it.buttons.get() != 0)
    {
        touch::with_pointer(cx, ui, pressed, |cx| {
            pressed.place(ui, place);
            pressed.buttons.set(buttons);
            pointer::settle_capture(cx, ui);
            if buttons == 0 {
                pressed.skips_mouse_events.set(false);
                abandon_press(cx, ui);
            }
        });
    }
    let pointer = ui.pointer();
    pointer.place(ui, place);
    pointer.is_inside.set(true);
    pointer.cursor.take();
    pointer::hover(cx, ui, Some(frame));
}

fn start_resizing<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element) {
    let (pointer, from) = (ui.pointer(), ui.pointer().at.get());
    let cursor = layout::cursor_at(cx, ui.doc(), from);
    let size = ["width", "height"].map(|it| {
        forms::microsyntax::parse_float(&layout::computed(cx, element, it)).unwrap_or(0.0)
    });
    pointer.is_on_scrollbar.set(true);
    pointer.track(
        Tracking::Resizer {
            from,
            size,
            axes: [cursor != "ns-resize", cursor != "ew-resize"],
        },
        element,
    );
}

/// Lets what tracks the mouse know where it is.
pub(super) fn follow<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let pointer = ui.pointer();
    match (
        pointer.tracking.get(),
        pointer.tracked().and_then(Node::as_element),
    ) {
        (Tracking::Selection(extent), _) => selecting::extend(cx, ui, extent),
        (Tracking::Slider, Some(element)) => {
            _ = Input::of(element).map(|it| it.slide_to(cx, pointer.at.get()))
        }
        (Tracking::Color, Some(part)) => forms::color_picker::follow(cx, part, pointer.at.get()),
        (Tracking::MediaSlider, Some(slider)) => {
            crate::api::media::controls::follow(cx, slider, pointer.at.get())
        }
        (Tracking::Resizer { from, size, axes }, Some(element)) => {
            let ([x, y], sign) = (
                pointer.at.get(),
                if looks_like(cx, element, Looks::RTL) {
                    -1.0
                } else {
                    1.0
                },
            );
            let wanted = [size[0] + sign * (x - from[0]), size[1] + y - from[1]];
            for axis in (0..2).filter(|it| axes[*it]) {
                let (name, wanted) = (
                    ["width", "height"][axis],
                    format!("{}px", wanted[axis].round().max(15.0)),
                );
                if wanted.as_bytes() != &layout::computed(cx, element, name)[..] {
                    host::set_style(cx, element, name, &wanted);
                }
            }
        }
        _ => {}
    }
}

fn forget_press(ui: &Ui) {
    let pointer = ui.pointer();
    pointer.is_on_scrollbar.set(false);
    pointer.may_drag_selection.set(false);
    pointer.set_draggable(None);
    pointer.stop_tracking();
}

/// There is no click, and nothing follows the mouse.
fn abandon_press<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui.pointer().is_on_scrollbar.get() {
        layout::scrollbar_mouse(cx, ui.doc(), ScrollbarMouse::Up, ui.pointer().at.get());
    }
    forget_press(ui);
    ui.pointer().release(cx);
}

fn mouse_move<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let (pointer, doc) = (ui.pointer(), ui.doc());
    if pointer.compositor_scrolls.get() {
        return;
    }
    // A menu or the window manager got the release.
    if pointer.buttons.get() == 0 && !pointer.pressed().is_empty() && pointer.drag.get().is_none() {
        abandon_press(cx, ui);
    }
    let bar = layout::scrollbar_mouse(cx, doc, ScrollbarMouse::Move, pointer.at.get());
    doc.invalidate_if_dirty(cx);
    if pointer.is_on_scrollbar.get() {
        return follow(cx, ui);
    }
    let ([x, y], [from_x, from_y]) = (pointer.at.get(), pointer.pressed_at.get());
    if (pointer.may_drag_selection.get() || pointer.draggable().is_some())
        && (x - from_x).hypot(y - from_y) >= DRAG_DISTANCE
    {
        drag::start(cx, ui);
    }
    if pointer.drag.get().is_some() {
        return drag::over(cx, ui);
    }
    let Some(target) = pointer::hover_target(cx, ui) else {
        return;
    };
    if target.is_connected() {
        fire_move(cx, ui, target, None);
    }
    still_there(ui, target).map(|it| fire_mouse(cx, ui, it, atom!("mousemove"), 0, 0));
    if pointer.is_tracking() {
        follow(cx, ui);
        doc.invalidate(cx);
    } else if matches!(bar, ScrollPart::None) {
        pointer::update_cursor(cx, ui);
    } else {
        pointer::set_cursor(ui, "default");
    }
}

fn click_event<'a>(
    heap: &JsHeap<'a>,
    ui: &Ui,
    name: Known,
    button: i16,
    detail: i32,
) -> &'a PointerEvent {
    let pointer = ui.pointer();
    PointerEvent::new(
        heap,
        ui.doc(),
        name,
        ALL,
        Trusted::Yes,
        detail,
        pointer.state(button).floored(),
        pointer.pointer_data(),
    )
}

pub(super) fn context_menu<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element) {
    let event = click_event(&cx.heap, ui, atom!("contextmenu"), 2, 0);
    if dispatch(cx, target, event) {
        let misspelled = spelling::select_misspelling(cx, ui);
        super::context_menu::show(cx, ui, ui.pointer().at.get(), &misspelled);
    }
}

fn press<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element) {
    let pointer = ui.pointer();
    pointer.release(cx);
    let chain = Refs::collect(&cx.heap, chain_of(Some(target)));
    let active = chain.iter().take(pointer::reach_of(ui, chain));
    let control = active
        .clone()
        .find(|it| it.is_html(atom!("label")))
        .and_then(forms::labeled_control);
    control
        .into_iter()
        .chain(active)
        .for_each(|it| it.set_state(cx, State::ACTIVE, true));
    pointer.set_pressed(control.map_or(chain, |it| {
        Refs::collect(&cx.heap, [it].into_iter().chain(chain.iter()))
    }));
    pointer.set_press_target(Some(target));
    pointer.pressed_at.set(pointer.at.get());
}

/// The default action of `mousedown`. What it gives can get the context menu.
fn focus_and_select<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Element,
    button: i16,
) -> Option<&'a Element> {
    let pointer = ui.pointer();
    let mut target = if target.is_connected() && target.doc() == ui.doc() {
        target
    } else {
        pointer::element_under(cx, ui)?
    };
    if pointer.scroll_control.get() != 0 {
        range::selection_of(&cx.heap, ui.doc()).clear(cx);
        return None;
    }
    let (serial, owner) = (ui.editing.selection_serial(), target.out_of_control());
    focus::focus_on_mouse_down(cx, ui, target);
    if !target.is_connected() && owner.is_connected() {
        target = pointer::element_under(cx, ui)?;
    }
    let selected = range::try_selection(ui.doc())
        .filter(|_| serial != ui.editing.selection_serial())
        .and_then(Selection::range);
    if selected.is_some_and(|it| {
        !it.collapsed() && it.start().node.out_of_control() == target.out_of_control()
    }) && ui.focused().is_some_and(|it| text_control(it).is_some())
    {
        return None;
    }
    if button == 0 && text_control(target.out_of_control()).is_none() {
        pointer.set_draggable(pointer.pressed().iter().find(|it| drag::is_draggable(it)));
    }
    if !pointer.is_tracking() && pointer.draggable().is_none() {
        selecting::start(cx, ui, target, button);
    }
    Some(target)
}

fn mouse_down<'a>(cx: &mut Cx<'a>, ui: &'a Ui, button: i16, is_first: bool) -> Option<()> {
    let (pointer, doc) = (ui.pointer(), ui.doc());
    ui.note_user_activation(true);
    pointer::hide_tooltip(cx, ui);
    if pointer.drag.get().is_some() || pointer.compositor_scrolls.get() {
        return None;
    }
    let mut target = pointer::target(cx, ui)?;
    if let Some(control) = ui.open_picker().filter(|it| !it.contains_flat(target)) {
        forms::close_picker(cx, ui);
        if control.is_html(atom!("select")) || !target.is_connected() {
            return None;
        }
    }
    input_method::end_composition(cx, ui);
    pointer.scroll_control.set(0);
    match if button == 0 {
        layout::scrollbar_mouse(cx, doc, ScrollbarMouse::Down, pointer.at.get())
    } else {
        ScrollPart::None
    } {
        ScrollPart::Resizer(id) => {
            return doc
                .rendered_node(id)?
                .as_element()
                .map(|it| start_resizing(cx, ui, it));
        }
        ScrollPart::Control(id) => pointer.scroll_control.set(id),
        ScrollPart::Bar(id) if let Some(scroller) = doc.rendered_node(id) => {
            pointer.is_on_scrollbar.set(true);
            doc.invalidate(cx);
            target = scroller.as_element().or_else(|| doc.document_element())?;
        }
        _ => {}
    }
    let (is_on_scrollbar, is_control_click) = (
        pointer.is_on_scrollbar.get(),
        IS_MAC && button == 0 && pointer.modifiers.get() == Modifiers::CONTROL,
    );
    press(cx, ui, target);
    if button == 0 && pointer.tapped_by().is_none() {
        popover::light_dismiss(cx, ui, target, true, pointer.at.get());
    }
    if pointer.tapped_by().is_none() {
        if is_first {
            pointer.skips_mouse_events.set(!fire_pointer(
                cx,
                ui,
                target,
                atom!("pointerdown"),
                Some(button),
            ));
        } else {
            fire_move(cx, ui, target, Some(button));
        }
    }
    target = still_there(ui, target)?;
    if fire_mouse(
        cx,
        ui,
        target,
        atom!("mousedown"),
        button,
        pointer.clicks.get(),
    ) && !is_on_scrollbar
        && !pointer.skips_mouse_events.get()
    {
        target = focus_and_select(cx, ui, target, if is_control_click { 2 } else { button })?;
    }
    if is_control_click {
        abandon_press(cx, ui);
    }
    if (button == 2 || is_control_click) && !cfg!(windows) && target.is_connected() {
        if IS_MAC {
            selecting::select_for_context_menu(cx, ui, target);
        }
        context_menu(cx, ui, target);
    }
    None
}

fn click<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    clicked: &'a Element,
    button: i16,
    is_on_scroll_control: bool,
) {
    let (disabled, clicks) = (
        disabled_control_above(clicked)
            .filter(|_| button == 0)
            .map(|it| &**it),
        ui.pointer().clicks.get(),
    );
    let event = click_event(
        &cx.heap,
        ui,
        if button == 0 {
            atom!("click")
        } else {
            atom!("auxclick")
        },
        button,
        clicks,
    );
    if dispatch_below(cx, clicked, event, disabled) && is_on_scroll_control {
        focus::control_scrolling(
            cx,
            ui,
            focus::ScrollAction::Click,
            ui.pointer().scroll_control.get(),
        );
    }
    if button == 0 && clicks == 2 {
        let event = mouse_event(&cx.heap, ui, atom!("dblclick"), 0, 2, true);
        dispatch_below(cx, clicked, event, disabled);
    }
}

fn mouse_up<'a>(cx: &mut Cx<'a>, ui: &'a Ui, button: i16) {
    let (pointer, doc) = (ui.pointer(), ui.doc());
    if pointer.drag.get().is_some() {
        return drag::end(cx, ui, true);
    }
    let (pressed, was_on_scrollbar, may_drag_selection) = (
        pointer.pressed(),
        pointer.is_on_scrollbar.get(),
        pointer.may_drag_selection.get(),
    );
    let (tracking, tracked, control) = (
        pointer.tracking.get(),
        pointer.tracked().and_then(Node::as_element),
        pointer.scroll_control.get(),
    );
    let part = (was_on_scrollbar || control != 0)
        .then(|| layout::scrollbar_mouse(cx, doc, ScrollbarMouse::Up, pointer.at.get()));
    if was_on_scrollbar {
        doc.invalidate(cx);
    }
    forget_press(ui);
    let (target, captured) = (pointer::target(cx, ui), pointer.capture());
    pointer.release(cx);
    let Some(target) = target else { return };
    if pointer.buttons.get() == 0 {
        fire_pointer(cx, ui, target, atom!("pointerup"), Some(button));
    } else {
        fire_move(cx, ui, target, Some(button));
    }
    let proceeds = still_there(ui, target)
        .is_none_or(|it| fire_mouse(cx, ui, it, atom!("mouseup"), button, pointer.clicks.get()));
    if let Some(slider) = tracked
        .filter(|_| matches!(tracking, Tracking::Slider))
        .and_then(Input::of)
    {
        slider.stop_sliding(cx);
    }
    if pointer.buttons.get() == 0 {
        pointer.set_pending_capture(None);
        pointer.skips_mouse_events.set(false);
        pointer::settle_capture(cx, ui);
    }
    if may_drag_selection {
        let root = editing::selection_root(cx, target);
        if let Some(it) = layout::caret_at(cx, root, pointer.at.get()) {
            range::selection_of(&cx.heap, doc).collapse(cx, it.point);
        }
    }
    if cfg!(target_os = "linux") {
        if matches!(tracking, Tracking::Selection(_)) {
            clipboard::offer_selection(cx, ui);
        } else if button == 1 && proceeds {
            clipboard::paste_selection(cx, ui);
        }
    }
    let clicked = captured.or_else(|| pressed.iter().find(|it| it.contains_flat(target)));
    if button == 0 && pointer.tapped_by().is_none() && pressed.first() == pointer.press_target() {
        popover::light_dismiss(cx, ui, target, false, pointer.at.get());
    }
    if let Some(clicked) = clicked.filter(|it| it.is_connected() && !was_on_scrollbar) {
        click(
            cx,
            ui,
            clicked,
            button,
            matches!(part, Some(ScrollPart::Control(id)) if id == control),
        );
    }
    if button == 2 && cfg!(windows) && target.is_connected() {
        context_menu(cx, ui, target);
    }
    if proceeds && matches!(button, 3 | 4) {
        crate::api::history::traverse(cx, ui.doc(), if button == 3 { -1 } else { 1 });
    }
    pointer::refresh_hover(cx, ui);
}

#[derive(Clone, Copy)]
pub(crate) enum Action {
    Move,
    Down { button: i16, clicks: i32 },
    Up { button: i16 },
}

pub(crate) fn handle<'a>(cx: &mut Cx<'a>, ui: &'a Ui, action: Action, place: Place, buttons: u16) {
    let pointer = ui.pointer();
    pointer.set_wheel_target(None);
    pointer.place(ui, place);
    pointer.is_inside.set(true);
    let is_first = pointer.buttons.replace(buttons) == 0;
    match action {
        Action::Move => mouse_move(cx, ui),
        Action::Up { button } => mouse_up(cx, ui, button),
        Action::Down { button, clicks } => {
            pointer.clicks.set(clicks);
            mouse_down(cx, ui, button, is_first);
        }
    }
}

pub(crate) fn leave<'a>(cx: &mut Cx<'a>, ui: &'a Ui, place: Option<Place>) {
    let pointer = ui.pointer();
    pointer.set_wheel_target(None);
    if let Some(it) = place {
        pointer.place(ui, it);
    }
    pointer.is_inside.set(false);
    layout::scrollbar_mouse(cx, ui.doc(), ScrollbarMouse::Leave, [0.0; 2]);
    ui.doc().invalidate(cx);
    if pointer.buttons.get() == 0 {
        pointer::hover(cx, ui, None);
    }
}

/// The rest of the gesture is for the page, also once a frame gets under the mouse.
pub(crate) fn is_scrolling_page(ui: &Ui) -> bool {
    ui.pointer().wheel_target().is_some()
        && host::now() - ui.pointer().wheel_time.get() < WHEEL_GESTURE_GAP
}

/// The events of one gesture have the same one.
fn wheel_target<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Option<&'a Element> {
    let pointer = ui.pointer();
    let goes_on = is_scrolling_page(ui) && pointer.movement.get() == [0.0; 2];
    let target = pointer
        .wheel_target()
        .filter(|it| goes_on && it.is_rendered() && it.doc() == ui.doc())
        .or_else(|| pointer::element_under(cx, ui));
    pointer.wheel_time.set(host::now());
    pointer.set_wheel_target(target);
    target
}

fn scroll<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    from: &'a Element,
    delta: [f64; 2],
    is_smooth: bool,
) -> bool {
    let has_scrolled = layout::user_scroll(cx, from, delta, ScrollUnit::Pixel, is_smooth);
    if has_scrolled {
        ui.pointer().scrolled_at.set(host::now());
        ui.doc().invalidate(cx);
    } else {
        ui.container()
            .into_iter()
            .for_each(|it| it.scroll_around(cx, delta));
    }
    has_scrolled
}

/// What is in `frame` cannot scroll any further.
pub(crate) fn scroll_around<'a>(cx: &mut Cx<'a>, ui: &'a Ui, frame: &'a Element, delta: [f64; 2]) {
    if scroll(cx, ui, frame, delta, false) {
        ui.pointer().set_wheel_target(Some(frame));
        ui.pointer().wheel_time.set(host::now());
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Wheel {
    Turn {
        delta: [f64; 2],
        is_precise: bool,
        is_handled: bool,
    },
    Pinch(f64),
}

pub(crate) fn handle_wheel<'a>(cx: &mut Cx<'a>, ui: &'a Ui, place: Place, wheel: Wheel) {
    let pointer = ui.pointer();
    pointer.place(ui, place);
    pointer.is_inside.set(true);
    let (delta, is_precise, is_handled) = match wheel {
        Wheel::Pinch(scale) => {
            pointer.modifiers.update(|it| it | Modifiers::CONTROL);
            ([0.0, -100.0 * scale], true, false)
        }
        Wheel::Turn {
            delta,
            is_precise,
            is_handled,
        } => {
            let [x, y] = delta.map(|it| it / layout::zoom(ui.doc()));
            (
                if x == 0.0 && pointer.modifiers.get().contains(Modifiers::SHIFT) {
                    [y, 0.0]
                } else {
                    [x, y]
                },
                is_precise,
                is_handled,
            )
        }
    };
    let Some(target) = (delta != [0.0; 2]).then(|| wheel_target(cx, ui)).flatten() else {
        return;
    };
    pointer::hide_tooltip(cx, ui);
    let names = [atom!("wheel"), atom!("mousewheel")];
    if names.into_iter().any(is_listened_to) {
        let cancelable = !is_handled
            && names
                .into_iter()
                .any(|it| target.has_blocking_listener_above(it));
        let event = WheelEvent::new(
            &cx.heap,
            ui.doc(),
            EventInit {
                cancelable,
                ..COMPOSED
            },
            pointer.state(0),
            delta,
        );
        if !dispatch(cx, target, event) {
            return;
        }
    }
    if !is_handled && !pointer.modifiers.get().contains(Modifiers::CONTROL) && target.is_connected()
    {
        scroll(cx, ui, target, delta, !is_precise);
    }
}
