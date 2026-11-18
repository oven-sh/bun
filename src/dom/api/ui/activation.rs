//! https://html.spec.whatwg.org/#tracking-user-activation

use core::cell::Cell;

use super::prelude::*;
use crate::api::uievents::{Modifiers, Mouse, PointerData, PointerEvent};

const TRANSIENT_DURATION: f64 = 5000.0;

#[derive(Clone)]
pub(crate) struct Activation {
    last: Cell<f64>,
    pub(crate) has_been_active: Cell<bool>,
    pub(crate) has_history_action: Cell<bool>,
    pub(crate) was_by_mouse: Cell<bool>,
    pub(crate) allowed_watcher_groups: Cell<u32>,
    pub(crate) allows_another_group: Cell<bool>,
}

impl Default for Activation {
    fn default() -> Self {
        Activation {
            last: Cell::new(f64::NEG_INFINITY),
            has_been_active: Cell::new(false),
            has_history_action: Cell::new(false),
            was_by_mouse: Cell::new(false),
            allowed_watcher_groups: Cell::new(1),
            allows_another_group: Cell::new(true),
        }
    }
}

impl Ui {
    pub(crate) fn activate(&self) {
        let it = &self.activation;
        self.doc()
            .window()
            .into_iter()
            .for_each(|it| it.host().activated());
        it.last.set(host::now());
        it.has_been_active.set(true);
        it.has_history_action.set(true);
        if it.allows_another_group.replace(false) {
            it.allowed_watcher_groups.update(|it| it + 1);
        }
    }

    pub(crate) fn note_user_activation(&self, is_mouse: bool) {
        self.activation.was_by_mouse.set(is_mouse);
        self.activate();
        crate::api::frames::input::spread_activation(self, is_mouse);
    }

    pub(crate) fn has_transient_activation(&self) -> bool {
        host::now() - self.activation.last.get() < TRANSIENT_DURATION
    }

    pub(crate) fn consume_activation<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        let was_active = self.has_transient_activation();
        if was_active {
            self.doc()
                .window()
                .into_iter()
                .for_each(|it| it.host().activation_consumed());
            crate::api::frames::tree(&cx.heap, self)
                .iter()
                .for_each(|it| it.activation.last.set(f64::NEG_INFINITY));
        }
        was_active
    }
}

#[derive(Default)]
struct ClickInProgress(Cell<bool>);

/// What a synthetic click takes from the event that has caused it.
#[derive(Default)]
pub(crate) struct Click {
    pub(crate) mouse: Mouse,
    pub(crate) detail: i32,
    pub(crate) pointer: Option<PointerData>,
}

impl Click {
    pub(crate) fn with(modifiers: Modifiers) -> Click {
        Click {
            mouse: Mouse {
                modifiers,
                ..Default::default()
            },
            ..Default::default()
        }
    }
}

pub(crate) fn is_clicked_without_pointer(event: &Event) -> bool {
    event
        .target_node()
        .and_then(Node::try_extra::<ClickInProgress>)
        .is_some_and(|it| it.0.get())
}

/// https://html.spec.whatwg.org/#fire-a-synthetic-pointer-event
pub(crate) fn click<'a>(cx: &mut Cx<'a>, element: &'a Element, trusted: Trusted, click: Click) {
    let in_progress = &element.extra::<ClickInProgress>().0;
    if crate::api::forms::is_disabled(element) && !element.is_html(atom!("fieldset"))
        || in_progress.replace(true)
    {
        return;
    }
    let has_position = click.pointer.is_some();
    let pointer = click.pointer.unwrap_or(PointerData {
        id: -1,
        ..Default::default()
    });
    let init = EventInit {
        cancelable: true,
        ..COMPOSED
    };
    let event = PointerEvent::new(
        &cx.heap,
        element.doc(),
        atom!("click"),
        init,
        trusted,
        click.detail,
        click.mouse,
        pointer,
    );
    if !has_position {
        event.set(crate::api::events::EventFlags::HAS_NO_POSITION);
    }
    dispatch(cx, element, event);
    in_progress.set(false);
}
