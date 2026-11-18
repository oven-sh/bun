//! https://html.spec.whatwg.org/#the-popover-attribute

use core::cell::Cell;

use super::close_watcher::{Closes, Watcher};
use super::focus::{self, Cause};
use super::prelude::*;
use super::top_layer::{
    Toggled, fire_before_toggle, keep_queued_toggle, queue_toggle, set_in_top_layer,
};
use super::{dialog, interest, invokers};
use crate::api::forms;
use crate::generated_bindgen::interaction::js_ShownPopover;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Auto,
    Hint,
    Manual,
}

impl Mode {
    pub(crate) fn name(self) -> Known {
        [atom!("auto"), atom!("hint"), atom!("manual")][self as usize]
    }
}

pub(crate) struct ShownPopover {
    state: Mode,
    /// An auto popover in a hint is a hint.
    mode: Mode,
    is_hiding: Cell<bool>,
}

slots!(
    ShownPopover = js_ShownPopover {
        invoker: Element,
        previous_focus: Element,
        watcher: Watcher,
    }
);

fn shown(element: &Element) -> Option<&ShownPopover> {
    is_showing(element).then(|| ShownPopover::from_value(element.edge(Edge::Popover)?))?
}

fn mode(element: &Element) -> Option<Mode> {
    shown(element).map(|it| it.mode)
}

pub(crate) fn is_showing(element: &Element) -> bool {
    element.has(NodeFlags::SHOWS_AS_POPOVER)
}

/// Of the attribute.
pub(crate) fn state(element: &Element) -> Option<Mode> {
    if element.has(NodeFlags::USER_AGENT) && element.is_part("picker(select)") {
        return Some(Mode::Auto);
    }
    match element
        .keyword(atom!("popover"))
        .filter(|_| element.ns() == Ns::Html)?
    {
        atom!("") | atom!("auto") => Some(Mode::Auto),
        atom!("hint") => Some(Mode::Hint),
        _ => Some(Mode::Manual),
    }
}

pub(crate) fn invoker_of(element: &Element) -> Option<&Element> {
    shown(element)?.invoker()
}

pub(super) fn is_hiding(element: &Element) -> bool {
    shown(element).is_some_and(|it| it.is_hiding.get())
}

pub(crate) fn invoked_by(invoker: &Element) -> Option<&Element> {
    Ui::left_in(invoker.doc())?
        .top_layer()
        .iter()
        .find(|it| invoker_of(it) == Some(invoker))
}

/// https://html.spec.whatwg.org/#check-popover-validity
/// Without `doc`, where it is does not matter.
fn check_validity(
    element: &Element,
    expected_showing: bool,
    doc: Option<&Doc>,
) -> Result<bool, Refusal> {
    if doc.is_some() && state(element).is_none() {
        Err((
            DomError::NotSupportedError,
            "The element does not have a popover attribute.",
        ))
    } else if is_showing(element) != expected_showing {
        Ok(false)
    } else if doc
        .is_some_and(|it| !element.is_connected() || element.doc() != it || Ui::of(it).is_none())
    {
        Err((
            DomError::InvalidStateError,
            "Invalid on disconnected popover elements.",
        ))
    } else if element.has_state(State::MODAL | State::FULLSCREEN) {
        Err((
            DomError::InvalidStateError,
            "It is already in the top layer.",
        ))
    } else {
        Ok(true)
    }
}

/// From the bottom to the top.
fn stack(ui: &Ui, wanted: Mode) -> impl DoubleEndedIterator<Item = &Element> {
    ui.top_layer()
        .iter()
        .filter(move |it| mode(it) == Some(wanted))
}

fn is_light_dismissed(element: &Element) -> bool {
    mode(element).is_some_and(|it| it != Mode::Manual)
}

pub(crate) fn nearest_open(node: Option<&Node>) -> Option<&Element> {
    node?
        .flat_ancestors()
        .filter_map(Node::as_element)
        .find(|it| is_light_dismissed(it))
}

fn higher<'a>(ui: &Ui, a: Option<&'a Element>, b: Option<&'a Element>) -> Option<&'a Element> {
    let position = |of: Option<&Element>| {
        stack(ui, Mode::Auto)
            .chain(stack(ui, Mode::Hint))
            .position(|it| Some(it) == of)
    };
    if position(a) > position(b) { a } else { b }
}

impl Hiding<'_> {
    fn leaving_focus() -> Self {
        Hiding {
            restores_focus: false,
            ..Default::default()
        }
    }
}

/// https://html.spec.whatwg.org/#hide-popover-stack-until
fn hide_stack_until<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    kept: Option<&'a Element>,
    mode: Mode,
    Hiding {
        restores_focus,
        fires_events,
        ..
    }: Hiding<'a>,
) {
    let list = Refs::collect(&cx.heap, stack(ui, mode));
    let remaining = kept.and_then(|it| list.position(it)).map_or(0, |it| it + 1);
    let how = Hiding {
        restores_focus,
        fires_events,
        ..Default::default()
    };
    list.iter()
        .rev()
        .take(list.len() - remaining)
        .for_each(|it| _ = hide(cx, it, how));
    for late in Refs::collect(&cx.heap, stack(ui, mode).rev()).iter() {
        if list.position(late).is_none_or(|it| it >= remaining) {
            _ = hide(
                cx,
                late,
                Hiding {
                    fires_events: false,
                    ..how
                },
            );
        }
    }
}

pub(crate) fn hide_above<'a>(cx: &mut Cx<'a>, ui: &'a Ui, kept: Option<&'a Element>) {
    let is_hint = kept.and_then(mode) == Some(Mode::Hint);
    hide_stack_until(cx, ui, kept, Mode::Hint, Hiding::leaving_focus());
    hide_stack_until(
        cx,
        ui,
        if is_hint { ui.hint_parent() } else { kept },
        Mode::Auto,
        Hiding::leaving_focus(),
    );
}

/// https://html.spec.whatwg.org/#show-popover
pub(crate) fn show<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    invoker: Option<&'a Element>,
) -> Result<(), Refusal> {
    let doc = element.doc();
    let (true, Some(ui)) = (check_validity(element, false, Some(doc))?, Ui::of(doc)) else {
        return Ok(());
    };
    let changes = &ui.layers.popover_changes;
    if changes.get() > 0 {
        return Err((
            DomError::InvalidStateError,
            "Another popover is being shown or hidden.",
        ));
    }
    changes.set(1);
    let result = show_checked(cx, ui, element, invoker);
    changes.update(|it| it - 1);
    result
}

fn show_checked<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    element: &'a Element,
    invoker: Option<&'a Element>,
) -> Result<(), Refusal> {
    let Some(original) = state(element) else {
        return Ok(());
    };
    let is_still_valid = || match check_validity(element, false, Some(ui.doc()))? {
        true if state(element) != Some(original) => Err((
            DomError::InvalidStateError,
            "The popover attribute has changed.",
        )),
        is_valid => Ok(is_valid),
    };
    if !fire_before_toggle(cx, element, true, invoker) || !is_still_valid()? {
        return Ok(());
    }
    let (mut own_mode, mut watcher, mut previous_focus) = (original, None, None);
    if original != Mode::Manual {
        let ancestor = higher(
            ui,
            nearest_open(element.flat_parent()),
            nearest_open(invoker.map(|it| &**it)),
        );
        if ancestor.and_then(mode) == Some(Mode::Hint) {
            own_mode = Mode::Hint;
        }
        hide_stack_until(cx, ui, ancestor, Mode::Hint, Hiding::leaving_focus());
        if own_mode == Mode::Auto {
            hide_stack_until(cx, ui, ancestor, Mode::Auto, Hiding::leaving_focus());
        }
        if !is_still_valid()? {
            return Ok(());
        }
        if !ui.top_layer().iter().any(is_light_dismissed) {
            previous_focus = ui.focused();
        }
        if own_mode == Mode::Hint
            && ancestor.and_then(mode) == Some(Mode::Auto)
            && ui.hint_parent().is_none()
        {
            ui.set_hint_parent(ancestor);
        }
        watcher = Some(Watcher::establish(&cx.heap, ui, Closes::Popover, element));
    }
    let shown = js_ShownPopover::create(
        &cx.heap,
        ShownPopover {
            state: original,
            mode: own_mode,
            is_hiding: Cell::new(false),
        },
    );
    shown.set_invoker(invoker);
    shown.set_previous_focus(previous_focus);
    shown.set_watcher(watcher);
    element.set_edge(&cx.heap, Edge::Popover, shown.value());
    element.set(NodeFlags::SHOWS_AS_POPOVER);
    element.set_state(cx, State::POPOVER_OPEN, true);
    set_in_top_layer(cx, ui, element, true);
    element.synced_engine(cx, |engine, id| {
        if let Some(invoker) = invoker.filter(|it| it.doc() == ui.doc()) {
            engine.set_implicit_anchor(id, invoker.id());
        }
        engine.update_style();
    });
    if element.is_html(atom!("dialog")) {
        dialog::focus_dialog(cx, ui, element);
    } else if let Some(control) = Some(element)
        .filter(|it| it.has(NodeFlags::AUTOFOCUS))
        .or_else(|| focus::autofocus_delegate(cx, element))
    {
        dialog::focus_control(cx, control);
    }
    queue_toggle(cx, element, true, invoker, Toggled::Popover);
    Ok(())
}

#[derive(Clone, Copy)]
pub(crate) struct Hiding<'a> {
    pub(crate) restores_focus: bool,
    pub(crate) fires_events: bool,
    pub(crate) ignores_tree: bool,
    pub(crate) source: Option<&'a Element>,
}

impl Default for Hiding<'_> {
    fn default() -> Self {
        Hiding {
            restores_focus: true,
            fires_events: true,
            ignores_tree: false,
            source: None,
        }
    }
}

/// https://html.spec.whatwg.org/#hide-popover-algorithm
pub(crate) fn hide<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    how: Hiding<'a>,
) -> Result<(), Refusal> {
    let doc = element.doc();
    let (true, Some(ui), Some(popover)) = (
        check_validity(element, true, (!how.ignores_tree).then_some(doc))?,
        Ui::left_in(doc),
        shown(element),
    ) else {
        return Ok(());
    };
    let is_nested = popover.is_hiding.replace(true);
    ui.layers.popover_changes.update(|it| it + 1);
    let result = hide_checked(
        cx,
        ui,
        element,
        popover,
        Hiding {
            fires_events: how.fires_events && !is_nested,
            ..how
        },
    );
    popover.is_hiding.set(is_nested);
    if let Some(it) = popover.watcher() {
        it.destroy(&cx.heap);
    }
    ui.layers.popover_changes.update(|it| it - 1);
    result
}

fn hide_checked<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    element: &'a Element,
    popover: &'a ShownPopover,
    how: Hiding<'a>,
) -> Result<(), Refusal> {
    let is_still_valid = || check_validity(element, true, (!how.ignores_tree).then(|| ui.doc()));
    if popover.mode != Mode::Manual {
        if popover.mode == Mode::Hint || ui.hint_parent() == Some(element) {
            hide_stack_until(cx, ui, Some(element), Mode::Hint, how);
        }
        if popover.mode == Mode::Auto {
            hide_stack_until(cx, ui, Some(element), Mode::Auto, how);
        }
        if !is_still_valid()? {
            return Ok(());
        }
    }
    if how.fires_events {
        fire_before_toggle(cx, element, false, how.source);
        interest::popover_hides(cx, element);
        if !is_still_valid()? {
            return Ok(());
        }
    }
    let had_focus = ui.focused().is_some_and(|it| element.contains_flat(it));
    element.clear_edge(&cx.heap, Edge::Popover);
    element.unset(NodeFlags::SHOWS_AS_POPOVER);
    element.set_state(cx, State::POPOVER_OPEN, false);
    if let Some(control) = element
        .out_of_control()
        .as_element()
        .filter(|it| *it != element)
    {
        control.set_state(cx, State::PICKER_OPEN, false);
    }
    set_in_top_layer(cx, ui, element, false);
    if ui.hint_parent() == Some(element) || stack(ui, Mode::Hint).next().is_none() {
        ui.set_hint_parent(None);
    }
    if how.fires_events {
        queue_toggle(cx, element, false, how.source, Toggled::Popover);
    }
    if let Some(previous) = popover
        .previous_focus()
        .filter(|_| how.restores_focus && had_focus)
    {
        focus::focus(cx, previous, Cause::Script, focus::WITHOUT_SCROLLING);
    }
    Ok(())
}

pub(crate) fn toggle<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    force: Option<bool>,
    source: Option<&'a Element>,
) -> Result<bool, Refusal> {
    match (is_showing(element), force) {
        (true, None | Some(false)) => hide(cx, element, Hiding::default())?,
        (false, None | Some(true)) => show(cx, element, source)?,
        (is_showing, _) => _ = check_validity(element, is_showing, Some(element.doc()))?,
    }
    Ok(is_showing(element))
}

pub(crate) fn removed<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    _ = hide(
        cx,
        element,
        Hiding {
            restores_focus: false,
            fires_events: false,
            ignores_tree: true,
            source: None,
        },
    );
}

pub(crate) fn attribute_changed<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    if shown(element).is_some_and(|it| Some(it.state) != state(element)) {
        _ = hide(
            cx,
            element,
            Hiding {
                ignores_tree: true,
                ..Default::default()
            },
        );
        if state(element).is_none() {
            keep_queued_toggle(element, Toggled::Popover);
        }
    }
}

fn clicked_popover<'a>(ui: &Ui, target: &'a Element) -> Option<&'a Element> {
    let invoked = |at: &'a Element| {
        forms::select::picker_popover(at)
            .or_else(|| invokers::popover_target(at))
            .or_else(|| interest::target_of(at))
            .filter(|it| is_light_dismissed(it))
    };
    higher(
        ui,
        nearest_open(Some(target)),
        target
            .flat_ancestors()
            .filter_map(Node::as_element)
            .find_map(invoked),
    )
}

/// For the press and for the release of the primary button.
pub(crate) fn light_dismiss<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Element,
    is_down: bool,
    point: [f64; 2],
) {
    if ui.top_layer().is_empty() && ui.open_dialogs().is_empty() {
        return;
    }
    let (popover, dialog) = (
        clicked_popover(ui, target),
        dialog::clicked(cx, target, point),
    );
    let (pressed_popover, pressed_dialog) = (ui.pressed_popover(), ui.pressed_dialog());
    ui.set_pressed_popover(popover.filter(|_| is_down));
    ui.set_pressed_dialog(dialog.filter(|_| is_down));
    if !ui.layers.was_pressed.replace(is_down) || is_down {
        return;
    }
    if popover == pressed_popover {
        hide_above(cx, ui, popover);
    }
    if let Some(last) = ui
        .open_dialogs()
        .last()
        .filter(|it| dialog == pressed_dialog && dialog != Some(it))
    {
        dialog::light_dismiss(cx, last);
    }
}

pub(crate) fn set_previous_focus(popover: &Element, element: &Element) {
    if let Some(it) = shown(popover) {
        it.set_previous_focus(Some(element));
    }
}
