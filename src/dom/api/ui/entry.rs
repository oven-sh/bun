//! What other modules call.

pub(crate) use super::assistive::{note_technology, update_accessibility_soon};
use super::focus::{self, Cause};
use super::pointer;
use super::prelude::*;
use super::{details, fullscreen, selecting, tabbing, top_layer};
use crate::api::editing::selection;
use crate::api::forms;
use crate::api::uievents::TextEvent;
use crate::generated_bindgen::interaction::*;

macro_rules! forward {
    ($($name:ident => $to:path $(, $result:ty)?;)+) => {$(
        pub(crate) fn $name<'a>(cx: &mut Cx<'a>, ui: &'a Ui) $(-> $result)? {
            $to(cx, ui)
        }
    )+};
}
forward! {
    window_resized => forms::close_picker;
    cancel_gestures => pointer::cancel_gestures;
    autoscroll => selecting::autoscroll, bool;
    fire_fullscreen_events => fullscreen::fire_events;
    fix_up_focus => focus::fix_up;
    show_selection => selection::before_frame;
}

/// `old`: that of the document that the window had before.
pub(crate) fn attach_ui<'a>(cx: &mut Cx<'a>, doc: &'a Doc, old: Option<&'a Ui>) -> &'a Ui {
    let context = crate::api::window::Window::of(doc)
        .filter(|it| it.cluster().is_some())
        .and_then(|it| it.context());
    let container = context.and_then(|it| it.container());
    let (activation, is_focused) = old
        .map(|it| (it.activation.clone(), it.is_focused.clone()))
        .unwrap_or_default();
    let has_spell_checker = doc.window().is_some_and(|it| it.host().has_spell_checker());
    let ui = Ui::attach(
        &cx.heap,
        doc,
        Ui {
            activation,
            is_focused,
            has_spell_checker,
            ..Default::default()
        },
    );
    ui.set_container(container);
    doc.set_doc_flags(DocFlags::IN_FRAME, container.is_some());
    container.into_iter().for_each(|it| it.show_document(ui));
    if container.is_none() && context.is_some_and(|it| it.is_frame()) {
        crate::api::frames::apart::settle(ui, old);
    }
    ui
}

pub(crate) fn detach_ui(ui: &Ui) {
    ui.has_window.set(false);
    ui.doc().set_doc_flags(DocFlags::IN_FRAME, false);
}

pub(crate) fn flush_autofocus<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if !ui.autofocus_candidates().is_empty() {
        focus::flush_autofocus_candidates(cx, ui);
    }
}

pub(crate) fn after_paint<'a>(cx: &mut Cx<'a>, ui: &'a Ui, has_moved: bool) {
    pointer::after_paint(cx, ui, has_moved);
}

pub(crate) fn flush_controls<'a>(cx: &mut Cx<'a>, doc: &'a Doc) {
    forms::flush(cx, doc);
}

pub(crate) fn flush_selection<'a>(cx: &mut Cx<'a>, doc: &'a Doc) {
    if let Some(it) = Ui::of(doc).filter(|it| it.editing.is_selection_unsent.take()) {
        selection::send(cx, it);
    }
}

pub(crate) fn new_user_activation<'a>(heap: &JsHeap<'a>, ui: &'a Ui) -> &'a UserActivation {
    let made = js_UserActivation::create(ui.doc().heap(heap), Default::default());
    js_UserActivation::set_ui(made, Some(ui));
    made
}

pub(crate) fn reset_focus<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    focus::set_focus(cx, ui, None, Cause::Script, None);
    ui.set_tab_start(None);
}

pub(crate) fn new_text_event<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a Event {
    TextEvent::new(
        heap,
        doc,
        atom!(""),
        EventInit::default(),
        Trusted::No,
        DomString::default(),
    )
}

pub(crate) fn tab_into_frame<'a>(cx: &mut Cx<'a>, ui: &'a Ui, is_backward: bool) {
    reset_focus(cx, ui);
    tabbing::move_focus(cx, ui, is_backward, true);
}

pub(crate) fn show_tooltip<'a>(cx: &mut Cx<'a>, ui: &'a Ui, text: &DomString) {
    if text.is_empty() {
        top_layer::hide_bubble(cx, ui)
    } else {
        pointer::show_tooltip(cx, ui, &text.to_utf8())
    }
}

pub(crate) fn reveal<'a>(cx: &mut Cx<'a>, node: &'a Node) {
    details::reveal(cx, node);
}
