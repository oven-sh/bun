//! What is typed, directly or through an input method.

use core::cell::{Cell, RefCell};

use super::{
    By, Command, Replacement, Span, edit_target, fire_before_input, fire_input, history, replace,
    selected, selected_span, selection, typing_target,
};
use crate::abi::Rect;
use crate::api::forms::text_control;
use crate::api::ui::prelude::*;
use crate::api::uievents::{CompositionEvent, InputDetails, TextEvent};

/// The text around the caret, which is in `Ui::input_method_node`.
#[derive(Clone, PartialEq)]
pub(crate) struct Surroundings {
    pub(crate) text: DomString,
    pub(crate) selection: [u32; 2],
    pub(crate) composing: Option<[u32; 2]>,
    is_upstream: bool,
}

#[derive(Default)]
enum Told {
    #[default]
    Nothing,
    Disabled,
    Password,
    Enabled {
        around: Surroundings,
        caret: Rect,
        layout_version: u32,
    },
}

#[derive(Default)]
pub(crate) struct InputMethod {
    composed: RefCell<DomString>,
    /// Where that is in `Ui::composition_node`.
    start: Cell<u32>,
    length: Cell<u32>,
    told: RefCell<Told>,
    /// The library takes it for granted that an edit does what it says.
    owes_news: Cell<bool>,
}

fn fire_composition<'a>(cx: &mut Cx<'a>, target: &'a Element, name: Known, data: DomString) {
    let init = EventInit {
        cancelable: name == atom!("compositionstart"),
        ..COMPOSED
    };
    let event = CompositionEvent::new(&cx.heap, target.doc(), name, init, Trusted::Yes, data);
    dispatch(cx, target, event);
}

/// The offsets of an input method are in the text node that has the caret.
fn select<'a>(cx: &mut Cx<'a>, ui: &'a Ui, offsets: Option<[u32; 2]>) {
    let found = offsets
        .zip(selected(ui).map(|it| it.end()))
        .map(|(it, caret)| (bun_ui::protocol::from_start(it, caret.offset), caret.node));
    if let Some(([start, end], node)) =
        found.filter(|(it, node)| node.is_text() && it[1] <= node.length())
    {
        range::selection_of(&cx.heap, ui.doc()).select(
            cx,
            Point {
                node,
                offset: start,
            },
            Point { node, offset: end },
        );
    }
}

fn composed_offsets(ui: &Ui) -> [u32; 2] {
    let state = &ui.editing.input_method;
    [state.start.get(), state.start.get() + state.length.get()]
}

fn composed_span(ui: &Ui) -> Option<Span<'_>> {
    let offsets = composed_offsets(ui);
    let node = ui
        .composition_node()
        .filter(|it| it.is_connected() && offsets[1] <= it.length());
    node.map(|node| offsets.map(|offset| Point { node, offset }))
        .or_else(|| selected_span(ui))
}

fn in_text(span: Option<Span<'_>>) -> Option<(&Text, u32, u32)> {
    let [start, end] = span.filter(|it| it[0].node == it[1].node)?;
    Some((start.node.as_text()?, start.offset, end.offset))
}

fn note_composition<'a>(cx: &mut Cx<'a>, ui: &'a Ui, length: u32, inside: Option<[u32; 2]>) {
    let end = selected(ui)
        .map(|it| it.end())
        .filter(|it| it.node.is_text() && it.offset >= length && ui.composition_target().is_some());
    ui.set_composition_node(end.map(|it| it.node));
    let Some(Point { node, offset }) = end else {
        return;
    };
    ui.editing.input_method.start.set(offset - length);
    ui.editing.input_method.length.set(length);
    if let Some([start, end]) = inside.map(|it| {
        it.map(|it| Point {
            node,
            offset: offset - length + it.min(length),
        })
    }) {
        range::selection_of(&cx.heap, ui.doc()).select(cx, start, end);
    }
    selection::reveal(cx, ui);
}

/// `inside`: what is selected of `text`. `replaced`: what it takes the place of.
pub(crate) fn compose<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    text: &DomString,
    inside: Option<[u32; 2]>,
    replaced: Option<[u32; 2]>,
) {
    if ui.composition_target().is_none() {
        let Some(target) = edit_target(cx, ui).filter(|_| !text.is_empty()) else {
            return;
        };
        select(cx, ui, replaced);
        ui.set_composition_target(Some(target));
        ui.editing.input_method.composed.take();
        let selected = selection::text(cx, ui);
        fire_composition(cx, target, atom!("compositionstart"), selected);
    }
    let Some(target) = ui.composition_target() else {
        return;
    };
    ui.editing.input_method.composed.replace(text.clone());
    fire_composition(cx, target, atom!("compositionupdate"), text.clone());
    let (input_type, mut by) = (atom!("insertCompositionText"), By::User);
    let details = InputDetails {
        data: Some(text.clone()),
        data_transfer: None,
        is_composing: true,
    };
    if text_control(target).is_none() && !text.is_empty() && in_text(composed_span(ui)).is_some() {
        fire_before_input(cx, target, input_type, &details, |_| composed_span(ui));
        if let Some((node, start, end)) = in_text(composed_span(ui)) {
            history::change(cx, ui, target, input_type, |cx| {
                _ = node.replace_data(cx, start, end - start, text);
                range::selection_of(&cx.heap, ui.doc()).collapse(
                    cx,
                    Point {
                        node,
                        offset: start + text.len(),
                    },
                );
            });
            note_composition(cx, ui, text.len(), inside);
            return fire_input(cx, target, input_type, &details);
        }
        by = By::Script;
    }
    replace(
        cx,
        ui,
        &Replacement {
            input_type,
            details,
            text: text.clone(),
            command: Command::InsertText,
            value: text.clone(),
        },
        by,
        |_| composed_span(ui),
    );
    note_composition(cx, ui, text.len(), inside);
}

fn forget_composition(ui: &Ui) {
    ui.set_composition_target(None);
    ui.set_composition_node(None);
}

pub(crate) fn end_composition<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let Some(target) = ui.composition_target() else {
        return;
    };
    forget_composition(ui);
    ui.doc().invalidate(cx);
    fire_composition(
        cx,
        target,
        atom!("compositionend"),
        ui.editing.input_method.composed.take(),
    );
}

pub(crate) fn focus_changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui
        .composition_target()
        .is_some_and(|it| Some(it) != edit_target(cx, ui))
    {
        forget_composition(ui);
    }
}

pub(crate) fn type_text<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    text: &DomString,
    replaced: Option<[u32; 2]>,
) {
    if ui.composition_target().is_some() {
        return compose(cx, ui, text, None, None);
    }
    let Some(target) = typing_target(cx, ui) else {
        return;
    };
    select(cx, ui, replaced);
    let details = InputDetails {
        data: Some(text.clone()),
        ..Default::default()
    };
    if !fire_before_input(cx, target, atom!("insertText"), &details, |cx| {
        selected_span(ui).map(|it| selection::tighten(cx, it))
    }) {
        return;
    }
    if is_listened_to(atom!("textInput")) {
        let event = TextEvent::new(
            &cx.heap,
            ui.doc(),
            atom!("textInput"),
            EventInit {
                cancelable: true,
                ..COMPOSED
            },
            Trusted::Yes,
            text.clone(),
        );
        if !dispatch(cx, target, event) {
            return;
        }
    }
    super::insert_text(cx, ui, text, atom!("insertText"), By::Script);
}

pub(crate) fn expect_edit<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.editing.input_method.owes_news.set(true);
    ui.doc().invalidate(cx);
}

/// Something else has told the library something.
pub(crate) fn forget_what_was_told(ui: &Ui) {
    ui.editing.input_method.told.take();
}

pub(super) fn with_surroundings<R>(ui: &Ui, read: impl FnOnce(&Surroundings) -> R) -> Option<R> {
    match &*ui.editing.input_method.told.borrow() {
        Told::Enabled { around, .. } => Some(read(around)),
        _ => None,
    }
}

fn show_composition(ui: &Ui) {
    let node = ui.composition_node().filter(|it| it.is_connected());
    let points = node
        .map(|node| composed_offsets(ui).map(|offset| Point { node, offset }))
        .map(|[start, end]| range::ends_for_engine(start, end));
    ui.doc().engine(|engine, _| {
        engine.set_marks(crate::editing::Mark::Composition, 0, points.as_slice())
    });
}

/// Tells the library, if something has changed.
pub(super) fn update<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    if ui.any_container().is_some_and(|it| !it.is_focused()) {
        return false;
    }
    let told = &ui.editing.input_method.told;
    let takes_text = |cx: &mut Cx<'a>| {
        typing_target(cx, ui).is_some_and(|it| !text_control(it).is_some_and(|it| it.is_password()))
    };
    let Some(([start, end], caret)) = selected_span(ui)
        .zip(selection::caret(ui))
        .filter(|_| takes_text(cx))
    else {
        let is_password = typing_target(cx, ui)
            .and_then(|it| text_control(it))
            .is_some_and(|it| it.is_password());
        let before = told.replace(if is_password {
            Told::Password
        } else {
            Told::Disabled
        });
        if matches!(
            (before, is_password),
            (Told::Disabled, false) | (Told::Password, true)
        ) {
            return false;
        }
        ui.set_input_method_node(None);
        host::disable_input_method(ui, is_password);
        show_composition(ui);
        return true;
    };
    let around = Surroundings {
        text: end.node.text(),
        selection: if end.node.is_text() {
            [
                if start.node == end.node {
                    start.offset
                } else {
                    0
                },
                end.offset,
            ]
        } else {
            [0; 2]
        },
        composing: ui.composition_node().map(|_| composed_offsets(ui)),
        is_upstream: caret.is_upstream,
    };
    let layout_version = ui.doc().engine(|engine, _| engine.layout_version);
    let same = match &*told.borrow() {
        Told::Enabled {
            around: old,
            caret,
            layout_version,
        } if *old == around && ui.input_method_node() == Some(end.node) => {
            Some((*caret, *layout_version))
        }
        _ => None,
    };
    let owes_news = &ui.editing.input_method.owes_news;
    if same.is_some_and(|it| it.1 == layout_version) && !owes_news.get() {
        return false;
    }
    let caret = layout::caret_rect(cx, caret).unwrap_or_default();
    let has_changed = same.is_none_or(|it| it.0 != caret);
    if has_changed {
        ui.set_input_method_node(Some(end.node));
        show_composition(ui);
    }
    if has_changed || owes_news.get() {
        owes_news.set(bun_ui::queue::are_edits_waiting());
        host::set_input_method(ui, &around, caret);
    }
    told.replace(Told::Enabled {
        around,
        caret,
        layout_version,
    });
    has_changed
}
