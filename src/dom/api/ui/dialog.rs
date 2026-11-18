//! https://html.spec.whatwg.org/#the-dialog-element

use core::cell::{Cell, RefCell};

use super::close_watcher::{Closes, Watcher};
use super::focus::{self, Cause};
use super::popover;
use super::prelude::*;
use super::top_layer::{Toggled, fire_before_toggle, queue_toggle, set_in_top_layer};
use crate::generated_bindgen::interaction::HTMLDialogElement;

#[derive(Default)]
struct Dialog {
    return_value: RefCell<DomString>,
    is_requested: Cell<bool>,
    requested_value: RefCell<Option<DomString>>,
}

fn is_open(dialog: &Element) -> bool {
    dialog.has_attr(atom!("open"))
}

fn is_modal(dialog: &Element) -> bool {
    dialog.state().contains(State::MODAL)
}

fn watcher(dialog: &Element) -> Option<&Watcher> {
    Watcher::from_value(dialog.edge(Edge::DialogWatcher)?)
}

fn closed_by(dialog: &Element) -> Known {
    match dialog.keyword(atom!("closedby")) {
        Some(value @ (atom!("any") | atom!("closerequest") | atom!("none"))) => value,
        _ if is_modal(dialog) => atom!("closerequest"),
        _ => atom!("none"),
    }
}

pub(crate) fn is_watcher_enabled(dialog: &Element) -> bool {
    dialog.extra::<Dialog>().is_requested.get() || closed_by(dialog) != atom!("none")
}

pub(crate) fn clicked<'a>(
    cx: &mut Cx<'a>,
    target: &'a Element,
    point: [f64; 2],
) -> Option<&'a Element> {
    let mut dialogs = target
        .flat_ancestors()
        .filter_map(Node::as_element)
        .filter(|it| it.is_html(atom!("dialog")) && is_open(it));
    dialogs
        .find(|it| *it != target || layout::bounding_rect(cx, it).contains(layout::narrow(point)))
}

pub(crate) fn light_dismiss<'a>(cx: &mut Cx<'a>, dialog: &'a Element) {
    if let Some(watcher) = watcher(dialog).filter(|_| closed_by(dialog) == atom!("any")) {
        watcher.request_close(cx, false);
    }
}

pub(crate) fn focus_control<'a>(cx: &mut Cx<'a>, control: &'a Element) {
    focus::focus(cx, control, Cause::Script, focus::Options::default());
    focus::end_autofocus(control.doc());
}

/// https://html.spec.whatwg.org/#dialog-focusing-steps
pub(crate) fn focus_dialog<'a>(cx: &mut Cx<'a>, ui: &'a Ui, dialog: &'a Element) {
    let control = if dialog.has(NodeFlags::AUTOFOCUS) {
        dialog
    } else {
        focus::focus_delegate(cx, dialog).unwrap_or(dialog)
    };
    if focus::is_focusable(cx, control) {
        return focus_control(cx, control);
    }
    if is_modal(dialog) {
        focus::set_focus(cx, ui, None, Cause::Script, None);
    }
    focus::end_autofocus(dialog.doc());
}

fn set_up(heap: &JsHeap<'_>, dialog: &Element) {
    if let Some(ui) = Ui::of(dialog.doc()).filter(|_| watcher(dialog).is_none()) {
        ui.set_open_dialogs(ui.open_dialogs().followed_by(heap, dialog));
        dialog.set_edge(
            heap,
            Edge::DialogWatcher,
            Watcher::establish(heap, ui, Closes::Dialog, dialog).value(),
        );
    }
}

fn clean_up(heap: &JsHeap<'_>, dialog: &Element) {
    if let (Some(ui), Some(watcher)) = (Ui::left_in(dialog.doc()), watcher(dialog)) {
        ui.set_open_dialogs(ui.open_dialogs().without(heap, dialog));
        watcher.destroy(heap);
        dialog.clear_edge(heap, Edge::DialogWatcher);
    }
}

pub(crate) fn show<'a>(
    cx: &mut Cx<'a>,
    dialog: &'a Element,
    modal: bool,
    source: Option<&'a Element>,
) -> Result<(), Refusal> {
    if is_open(dialog) {
        return if modal == is_modal(dialog) {
            Ok(())
        } else {
            Err((
                DomError::InvalidStateError,
                "The dialog is already open in the other way.",
            ))
        };
    }
    let cannot_be_modal = || {
        modal
            && (!dialog.is_connected()
                || Ui::of(dialog.doc()).is_none()
                || popover::is_showing(dialog))
    };
    if cannot_be_modal() {
        return Err((
            DomError::InvalidStateError,
            "The element is not in a Document, or it is open as a popover.",
        ));
    }
    if !fire_before_toggle(cx, dialog, true, source) || is_open(dialog) || cannot_be_modal() {
        return Ok(());
    }
    queue_toggle(cx, dialog, true, source, Toggled::DetailsOrDialog);
    dialog.toggle_attr(cx, atom!("open"), true);
    let Some(ui) = Ui::of(dialog.doc()) else {
        return Ok(());
    };
    if let Some(focused) = ui.focused() {
        dialog.set_edge(&cx.heap, Edge::PreviousFocus, focused.value());
    }
    if modal {
        dialog.set_state(cx, State::MODAL, true);
        set_in_top_layer(cx, ui, dialog, true);
    }
    popover::hide_above(cx, ui, popover::nearest_open(dialog.flat_parent()));
    focus_dialog(cx, ui, dialog);
    Ok(())
}

fn leave_modal<'a>(cx: &mut Cx<'a>, dialog: &'a Element) {
    if let Some(ui) = Ui::left_in(dialog.doc()).filter(|_| is_modal(dialog)) {
        dialog.set_state(cx, State::MODAL, false);
        set_in_top_layer(cx, ui, dialog, false);
    }
}

/// https://html.spec.whatwg.org/#close-the-dialog
pub(crate) fn close<'a>(
    cx: &mut Cx<'a>,
    dialog: &'a Element,
    result: Option<DomString>,
    source: Option<&'a Element>,
) {
    if !is_open(dialog) {
        return;
    }
    fire_before_toggle(cx, dialog, false, source);
    if !is_open(dialog) {
        return;
    }
    let restores_focus =
        is_modal(dialog) || focus::focused(dialog.doc()).is_some_and(|it| dialog.contains_flat(it));
    let previous = dialog
        .edge_node(Edge::PreviousFocus)
        .and_then(Node::as_element)
        .filter(|_| restores_focus);
    queue_toggle(cx, dialog, false, source, Toggled::DetailsOrDialog);
    dialog.remove_attr(cx, atom!("open"));
    leave_modal(cx, dialog);
    if let Some(result) = result {
        dialog.extra::<Dialog>().return_value.replace(result);
    }
    dialog.clear_edge(&cx.heap, Edge::PreviousFocus);
    if let Some(previous) = previous {
        focus::focus(cx, previous, Cause::Script, focus::WITHOUT_SCROLLING);
    }
    host::queue_before_frame(cx, dialog.doc(), [dialog.value()], |cx, [dialog]| {
        Element::from_value(dialog).map(|it| fire(cx, it, atom!("close"), PLAIN));
    });
}

pub(crate) fn close_as_requested<'a>(cx: &mut Cx<'a>, dialog: &'a Element) {
    let result = dialog.extra::<Dialog>().requested_value.take();
    close(
        cx,
        dialog,
        result,
        dialog
            .edge_node(Edge::CloseRequestSource)
            .and_then(Node::as_element),
    );
}

pub(crate) fn request_close<'a>(
    cx: &mut Cx<'a>,
    dialog: &'a Element,
    result: Option<DomString>,
    source: Option<&'a Element>,
) {
    let state = dialog.extra::<Dialog>();
    let Some(watcher) = watcher(dialog).filter(|_| !state.is_requested.replace(true)) else {
        return;
    };
    state.requested_value.replace(result);
    if let Some(source) = source {
        dialog.set_edge(&cx.heap, Edge::CloseRequestSource, source.value());
    }
    watcher.request_close(cx, false);
    dialog.clear_edge(&cx.heap, Edge::CloseRequestSource);
    state.requested_value.take();
    state.is_requested.set(false);
}

impl HTMLDialogElement {
    pub(crate) fn get_return_value(&self) -> DomString {
        self.extra::<Dialog>().return_value.borrow().clone()
    }

    pub(crate) fn set_return_value(&self, value: DomString) {
        self.extra::<Dialog>().return_value.replace(value);
    }

    pub(crate) fn get_closed_by(&self) -> Known {
        closed_by(self)
    }

    pub(crate) fn set_closed_by<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("closedby"), value);
    }

    pub(crate) fn show<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, ()> {
        let result = show(cx, self, false, None);
        refused(&cx.heap, result)
    }

    pub(crate) fn show_modal<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, ()> {
        let result = show(cx, self, true, None);
        refused(&cx.heap, result)
    }

    pub(crate) fn close<'a>(&'a self, cx: &mut Cx<'a>, result: Option<DomString>) {
        close(cx, self, result, None);
    }

    pub(crate) fn request_close<'a>(&'a self, cx: &mut Cx<'a>, result: Option<DomString>) {
        request_close(cx, self, result, None);
    }
}

pub(crate) static STEPS: Steps = Steps {
    attribute_changed: Some(|cx, dialog, change| {
        if change.is(atom!("open")) && dialog.is_connected() {
            if change.new.is_some() {
                set_up(&cx.heap, dialog)
            } else {
                clean_up(&cx.heap, dialog)
            }
        }
    }),
    post_connection: Some(|cx, dialog, is_move| {
        if !is_move && is_open(dialog) {
            set_up(&cx.heap, dialog);
        }
    }),
    removed: Some(|cx, dialog, _, is_move| {
        if !is_move {
            clean_up(&cx.heap, dialog);
            leave_modal(cx, dialog);
        }
    }),
    ..Steps::NONE
};
