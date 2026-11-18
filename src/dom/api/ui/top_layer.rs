//! https://drafts.csswg.org/css-position-4/#top-layer

use core::cell::{Cell, RefCell};

use super::prelude::*;
use super::{focus, fullscreen};
use crate::api::uievents::ToggleEvent;
use crate::tree::NodeId;

#[derive(Default)]
pub(crate) struct Layers {
    /// Popovers that are being shown or hidden.
    pub(crate) popover_changes: Cell<u32>,
    pub(crate) was_pressed: Cell<bool>,
    pub(crate) last_watcher_group: Cell<u32>,
    /// The types of `Ui::fullscreen_events`.
    pub(crate) fullscreen_events: RefCell<Vec<fullscreen::Pending>>,
    /// A tooltip or a validation message, which only the engine knows.
    bubble: Cell<NodeId>,
    /// What the inspector draws, likewise.
    overlay: Cell<NodeId>,
    /// It has the mouse.
    pub(crate) picker: RefCell<Option<std::rc::Weak<crate::api::inspector::Inspector>>>,
}

pub(crate) fn set_in_top_layer<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, on: bool) {
    let (heap, layer) = (&cx.heap, ui.top_layer());
    ui.set_top_layer(if on {
        layer.with(heap, element)
    } else {
        layer.without(heap, element)
    });
    changed(cx, ui);
}

fn changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if !ui.has_window.get() {
        return;
    }
    let shown = ui
        .top_layer()
        .iter()
        .filter(|it| it.is_connected() && it.doc() == ui.doc())
        .map(|it| it.id());
    let ids = shown
        .chain(
            [ui.layers.bubble.get(), ui.layers.overlay.get()]
                .into_iter()
                .filter(|it| *it != 0),
        )
        .collect();
    ui.doc().engine(|engine, _| engine.set_top_layer(ids));
    if let Some(focused) = ui.focused() {
        focus::mark_chain(cx, ui, focused, true);
    }
    ui.doc().invalidate(cx);
}

/// What is not in it is inert.
pub(crate) fn top_modal(doc: &Doc) -> Option<&Element> {
    let layer = Ui::left_in(doc)?.top_layer();
    layer
        .iter()
        .rfind(|it| it.has_state(State::MODAL))
        .or_else(|| layer.iter().rfind(|it| it.has_state(State::FULLSCREEN)))
}

pub(crate) fn show_bubble_below<'a>(cx: &mut Cx<'a>, ui: &'a Ui, anchor: &'a Element, text: &str) {
    let rect = layout::bounding_rect(cx, anchor);
    show_bubble(cx, ui, [rect.x, rect.bottom() + 4.0], text);
}

pub(crate) fn show_bubble<'a>(cx: &mut Cx<'a>, ui: &'a Ui, at: [f32; 2], text: &str) {
    hide_bubble(cx, ui);
    let Some(root) = ui.doc().document_element() else {
        return;
    };
    ui.layers
        .bubble
        .set(root.engine(|engine, root| engine.create_bubble(root, text)));
    changed(cx, ui);
    ui.doc()
        .engine(|engine, _| engine.place_bubble(ui.layers.bubble.get(), at));
}

pub(crate) fn hide_bubble<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let bubble = ui.layers.bubble.take();
    if bubble != 0 {
        changed(cx, ui);
        ui.doc().engine(|engine, _| engine.remove(bubble));
    }
}

/// The style and the text of each part.
pub(crate) fn show_overlay<'a>(cx: &mut Cx<'a>, ui: &'a Ui, parts: &[[String; 2]]) {
    let root = ui.doc().document_element().filter(|_| !parts.is_empty());
    if root.is_none() && ui.layers.overlay.get() == 0 {
        return;
    }
    let old = ui.layers.overlay.replace(root.map_or(0, |it| {
        it.engine(|engine, root| engine.create_overlay(root, parts))
    }));
    changed(cx, ui);
    if old != 0 {
        ui.doc().engine(|engine, _| engine.remove(old));
    }
}

fn states(opens: bool) -> [Known; 2] {
    if opens {
        [atom!("closed"), atom!("open")]
    } else {
        [atom!("open"), atom!("closed")]
    }
}

pub(crate) fn fire_before_toggle<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    opens: bool,
    source: Option<&'a Element>,
) -> bool {
    let init = EventInit {
        cancelable: opens,
        ..PLAIN
    };
    !is_listened_to(atom!("beforetoggle")) || {
        let event = ToggleEvent::new(
            &cx.heap,
            element.doc(),
            atom!("beforetoggle"),
            init,
            states(opens),
            source,
        );
        dispatch(cx, element, event)
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Toggled {
    DetailsOrDialog,
    Popover,
}

/// https://html.spec.whatwg.org/#toggle-task-tracker
#[derive(Default)]
struct ToggleTrackers([Cell<Tracker>; 2]);

#[derive(Clone, Copy, Default)]
struct Tracker {
    task: i32,
    was_open: Option<bool>,
    /// A task that the later ones do not replace.
    kept: i32,
}

pub(crate) fn keep_queued_toggle(element: &Element, toggled: Toggled) {
    element.extra::<ToggleTrackers>().0[toggled as usize].update(|it| Tracker {
        was_open: None,
        kept: it.task,
        ..it
    });
}

pub(crate) fn queue_toggle<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    opens: bool,
    source: Option<&'a Element>,
    toggled: Toggled,
) {
    let tracker = &element.extra::<ToggleTrackers>().0[toggled as usize];
    let (task, was_open) = (
        tracker.get().task.wrapping_add(1),
        tracker.get().was_open.unwrap_or(!opens),
    );
    tracker.update(|it| Tracker {
        task,
        was_open: Some(was_open),
        ..it
    });
    let source = source.map_or(JSValue::NULL, Handle::value);
    let arguments = [
        element.value(),
        source,
        JSValue::from(was_open),
        JSValue::from(opens),
        JSValue::from(toggled as i32),
        JSValue::from(task),
    ];
    host::queue_task(
        cx,
        element.doc(),
        arguments,
        |cx, [element, source, was_open, opens, toggled, task]| {
            let Some(element) = Element::from_value(element) else {
                return;
            };
            let tracker = &element.extra::<ToggleTrackers>().0[toggled.as_int32() as usize];
            let (
                Tracker {
                    task: last, kept, ..
                },
                task,
            ) = (tracker.get(), task.as_int32());
            if task == last {
                tracker.update(|it| Tracker {
                    was_open: None,
                    ..it
                });
            }
            if task == last || task == kept {
                let states = [
                    states(!was_open.as_boolean())[0],
                    states(opens.as_boolean())[1],
                ];
                let event = ToggleEvent::new(
                    &cx.heap,
                    element.doc(),
                    atom!("toggle"),
                    PLAIN,
                    states,
                    Element::from_value(source),
                );
                dispatch(cx, element, event);
            }
        },
    );
}
