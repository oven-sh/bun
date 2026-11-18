//! https://html.spec.whatwg.org/#close-watcher

use core::cell::Cell;

use super::prelude::*;
use super::{dialog, popover};
use crate::generated_bindgen::interaction::{CloseWatcherOptions, js_CloseWatcher, js_Watcher};

#[derive(Clone, Copy)]
pub(crate) enum Closes {
    Dialog,
    Popover,
    /// A `CloseWatcher`.
    Nothing,
}

pub(crate) struct Watcher {
    closes: Closes,
    group: u32,
    is_canceling: Cell<bool>,
}

slots!(
    Watcher = js_Watcher {
        manager: Ui,
        subject: EventTarget,
    }
);

fn group_count(ui: &Ui) -> u32 {
    let groups = ui.close_watchers().iter().map(|it| it.group);
    groups
        .fold((0, 0), |(count, last), it| {
            (count + u32::from(it != last), it)
        })
        .0
}

impl Watcher {
    pub(crate) fn establish<'a>(
        heap: &JsHeap<'a>,
        ui: &Ui,
        closes: Closes,
        subject: &EventTarget,
    ) -> &'a Watcher {
        let allowed = ui.activation.allowed_watcher_groups.get();
        let last = ui
            .close_watchers()
            .last()
            .filter(|_| allowed == 1 || group_count(ui) >= allowed);
        let group = last.map_or_else(|| ui.layers.last_watcher_group.get() + 1, |it| it.group);
        ui.layers.last_watcher_group.set(group);
        let watcher = js_Watcher::create(
            heap,
            Watcher {
                closes,
                group,
                is_canceling: Cell::new(false),
            },
        );
        watcher.set_manager(Some(ui));
        watcher.set_subject(Some(subject));
        ui.set_close_watchers(ui.close_watchers().followed_by(heap, watcher));
        ui.activation.allows_another_group.set(true);
        watcher
    }

    fn element(&self) -> Option<&Element> {
        self.subject()?.as_node()?.as_element()
    }

    fn is_enabled(&self) -> bool {
        !matches!(self.closes, Closes::Dialog)
            || self.element().is_some_and(dialog::is_watcher_enabled)
    }

    /// The manager, if this is active and enabled.
    fn ready(&self) -> Option<&Ui> {
        self.manager()
            .filter(|it| it.has_window.get() && self.is_enabled())
    }

    /// False if it was prevented.
    pub(crate) fn request_close<'a>(&'a self, cx: &mut Cx<'a>, needs_activation: bool) -> bool {
        let (Some(ui), Some(subject)) = (
            self.ready().filter(|_| !self.is_canceling.get()),
            self.subject(),
        ) else {
            return true;
        };
        let may_prevent = group_count(ui) < ui.activation.allowed_watcher_groups.get()
            && ui.activation.has_history_action.get();
        self.is_canceling.set(true);
        let init = EventInit {
            cancelable: !needs_activation || may_prevent,
            ..PLAIN
        };
        let continues =
            matches!(self.closes, Closes::Popover) || fire(cx, subject, atom!("cancel"), init);
        self.is_canceling.set(false);
        if continues {
            self.close(cx);
        } else {
            crate::api::frames::tree(&cx.heap, ui)
                .iter()
                .for_each(|it| it.activation.has_history_action.set(false));
        }
        continues
    }

    fn close<'a>(&'a self, cx: &mut Cx<'a>) {
        let (Some(_), Some(subject)) = (self.ready(), self.subject()) else {
            return;
        };
        self.destroy(&cx.heap);
        match (self.closes, self.element()) {
            (Closes::Dialog, Some(element)) => dialog::close_as_requested(cx, element),
            (Closes::Popover, Some(element)) => {
                _ = popover::hide(cx, element, popover::Hiding::default())
            }
            _ => _ = fire(cx, subject, atom!("close"), PLAIN),
        }
    }

    pub(crate) fn destroy(&self, heap: &JsHeap<'_>) {
        if let Some(ui) = self.manager() {
            ui.set_close_watchers(ui.close_watchers().without(heap, self));
            self.set_manager(None);
        }
    }
}

/// https://html.spec.whatwg.org/#process-close-watchers
pub(crate) fn process<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    let (watchers, mut is_handled) = (ui.close_watchers(), false);
    let group = watchers.last().map(|it| it.group);
    for watcher in watchers
        .iter()
        .rev()
        .take_while(|it| Some(it.group) == group)
    {
        is_handled |= watcher.is_enabled();
        if !watcher.request_close(cx, true) {
            break;
        }
    }
    ui.activation
        .allowed_watcher_groups
        .update(|it| (it - 1).max(1));
    is_handled
}

#[repr(C)]
pub(crate) struct CloseWatcher {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_CloseWatcher::Fields,
}

slots!(CloseWatcher = js_CloseWatcher { watcher: Watcher });

impl CloseWatcher {
    pub(crate) fn constructor<'a>(
        cx: &mut Cx<'a>,
        structure: ClassStructure<'a, Self>,
        options: &CloseWatcherOptions<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let Some(ui) = host::current_document(&cx.heap).and_then(Ui::of) else {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The document is not fully active.",
            ));
        };
        let this = structure.create(
            &cx.heap,
            CloseWatcher {
                base: EventTarget::default(),
                fields: Default::default(),
            },
        );
        let watcher = Watcher::establish(&cx.heap, ui, Closes::Nothing, this);
        this.set_watcher(Some(watcher));
        if let Some(signal) = options.signal {
            host::on_abort(cx, signal, watcher.value(), |cx, [watcher]| {
                Watcher::from_value(watcher)
                    .into_iter()
                    .for_each(|it| it.destroy(&cx.heap))
            });
        }
        Ok(this)
    }

    pub(crate) fn request_close<'a>(&'a self, cx: &mut Cx<'a>) {
        self.watcher().map(|it| it.request_close(cx, false));
    }

    pub(crate) fn close<'a>(&'a self, cx: &mut Cx<'a>) {
        if let Some(it) = self.watcher() {
            it.close(cx);
        }
    }

    pub(crate) fn destroy(&self, heap: &JsHeap<'_>) {
        if let Some(it) = self.watcher() {
            it.destroy(heap);
        }
    }
}
