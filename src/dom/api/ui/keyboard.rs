//! From the keys of the library to the events of the DOM.

use super::activation::{self, Click};
use super::focus::{self, ScrollAction};
use super::layout::ScrollUnit;
use super::mouse::{self, run_default_actions};
use super::prelude::*;
use super::{close_watcher, details, drag, fullscreen, keys, pointer, tabbing};
use crate::api::editing::{self, input_method};
use crate::api::forms::{InputType, input_type};
use crate::api::uievents::{Keyboard, KeyboardEvent, Modifiers};

#[derive(Clone)]
pub(crate) struct Key {
    pub(crate) key: Atom,
    pub(crate) code: Atom,
    /// 0 unless the system says.
    pub(crate) key_code: u32,
    pub(crate) location: u32,
    pub(crate) repeat: bool,
    pub(crate) modifiers: Modifiers,
    pub(crate) is_composing: bool,
}

impl Key {
    fn legacy_code(&self) -> u32 {
        match self.key_code {
            0 => keys::key_code(
                self.key.as_utf8().as_bytes(),
                self.code.as_utf8().as_bytes(),
            ),
            known => known,
        }
    }
}

const SHORTCUT: Modifiers = Modifiers::CONTROL
    .union(Modifiers::ALT)
    .union(Modifiers::META);

fn key_target(ui: &Ui) -> Option<&Element> {
    ui.focused()
        .or_else(|| ui.doc().body())
        .or_else(|| ui.doc().document_element())
}

/// A picker has the keys, whatever has the focus.
fn control_for_keys<'a>(ui: &'a Ui, target: &'a Element) -> &'a Element {
    ui.open_picker()
        .filter(|it| !it.contains_flat(target))
        .unwrap_or(target)
}

fn key_event<'a>(
    heap: &JsHeap<'a>,
    ui: &Ui,
    name: Known,
    key: &Key,
    key_code: u32,
    char_code: u32,
) -> &'a KeyboardEvent {
    let Key {
        key,
        code,
        location,
        repeat,
        modifiers,
        ..
    } = key.clone();
    let is_composing = ui.composition_target().is_some();
    KeyboardEvent::new(
        heap,
        ui.doc(),
        name,
        Keyboard {
            key,
            code,
            location,
            repeat,
            is_composing,
            char_code,
            key_code,
            modifiers,
        },
    )
}

fn is_pressed_with_space(element: &Element) -> bool {
    input_type(element).map_or_else(
        || {
            element.is_html(atom!("button"))
                || details::is_summary(element)
                || details::is_default_summary(element)
        },
        |it| !it.is_typed() && it != InputType::Range,
    )
}

fn is_pressed_with_enter(element: &Element) -> bool {
    is_pressed_with_space(element) && !input_type(element).is_some_and(InputType::is_checkable)
        || element.tag() == atom!("a") && element.has_attr(atom!("href"))
}

fn scroll_by_key<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Element,
    event: &'a KeyboardEvent,
) -> bool {
    let (key, alt, meta) = (event.key(), event.get_alt_key(), event.get_meta_key());
    if if event.get_ctrl_key() {
        !matches!(key, atom!("Home") | atom!("End"))
    } else {
        !IS_MAC && (alt || meta)
    } {
        return false;
    }
    let vertical = if meta {
        ScrollUnit::Document
    } else if alt {
        ScrollUnit::Page
    } else {
        ScrollUnit::Line
    };
    let (step, unit) = match key {
        atom!("ArrowUp") => ([0.0, -1.0], vertical),
        atom!("ArrowDown") => ([0.0, 1.0], vertical),
        atom!("ArrowLeft") => ([-1.0, 0.0], ScrollUnit::Line),
        atom!("ArrowRight") => ([1.0, 0.0], ScrollUnit::Line),
        atom!("PageUp") => ([0.0, -1.0], ScrollUnit::Page),
        atom!("PageDown") => ([0.0, 1.0], ScrollUnit::Page),
        atom!("Home") => ([0.0, -1.0], ScrollUnit::Document),
        atom!("End") => ([0.0, 1.0], ScrollUnit::Document),
        atom!(" ") => (
            [0.0, if event.get_shift_key() { -1.0 } else { 1.0 }],
            ScrollUnit::Page,
        ),
        _ => return false,
    };
    let from = ui
        .tab_start()
        .filter(|it| ui.focused().is_none() && it.is_rendered())
        .unwrap_or(target);
    ui.doc().invalidate(cx);
    layout::user_scroll(cx, from, step, unit, true)
}

fn press_enter<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element, key: &Key) -> bool {
    let is_line_feed = !IS_MAC && key.modifiers.contains(Modifiers::CONTROL);
    let code = if is_line_feed { 10 } else { 13 };
    let event = key_event(&cx.heap, ui, atom!("keypress"), key, code, code);
    if !dispatch(cx, target, event) {
        return true;
    }
    if is_line_feed && target.tag() != atom!("a") {
        return false;
    }
    if run_default_actions(cx, target, event) {
        return true;
    }
    if !is_pressed_with_enter(target) {
        return editing::typing_target(cx, ui).is_some()
            && editing::insert_break(cx, ui, !event.get_shift_key(), editing::By::User);
    }
    activation::click(
        cx,
        target,
        Trusted::Yes,
        Click::with(key.modifiers & (SHORTCUT | Modifiers::SHIFT)),
    );
    true
}

fn open_context_menu<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element) {
    let rect = layout::bounding_rect(cx, target);
    ui.pointer()
        .at
        .set([rect.x + rect.width / 2.0, rect.y + rect.height / 2.0].map(f64::from));
    mouse::context_menu(cx, ui, target, if cfg!(windows) { -1 } else { 2 });
}

fn default_key_down<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Element,
    event: &'a KeyboardEvent,
    key: &Key,
) -> bool {
    if run_default_actions(cx, control_for_keys(ui, target), event) {
        return true;
    }
    let is_on_control = ui.focus.is_on_scroll_control.get();
    match event.key() {
        atom!("Enter") | atom!(" ") if is_on_control => {
            focus::control_scrolling(cx, ui, ScrollAction::Activate, 0)
        }
        atom!("ArrowLeft") | atom!("ArrowUp") if is_on_control => {
            focus::control_scrolling(cx, ui, ScrollAction::Previous, 0)
        }
        atom!("ArrowRight") | atom!("ArrowDown") if is_on_control => {
            focus::control_scrolling(cx, ui, ScrollAction::Next, 0)
        }
        atom!("Enter") => {
            !key.modifiers.contains(if IS_MAC {
                Modifiers::META
            } else {
                Modifiers::ALT
            }) && press_enter(cx, ui, target, key)
        }
        atom!("Tab") if key.modifiers.intersects(SHORTCUT) => false,
        atom!("Tab") => {
            tabbing::move_focus(cx, ui, event.get_shift_key(), false);
            true
        }
        atom!("Escape") => {
            pointer::set_lock(cx, ui, None);
            super::interest::lose_all(cx, ui) | close_watcher::process(cx, ui)
        }
        atom!("ContextMenu") if cfg!(windows) => true,
        name @ (atom!("ContextMenu") | atom!("F10"))
            if name == atom!("ContextMenu") || event.get_shift_key() && !IS_MAC =>
        {
            open_context_menu(cx, ui, target);
            true
        }
        name => {
            editing::handle_key(cx, ui, event)
                || name != atom!(" ") && scroll_by_key(cx, ui, target, event)
        }
    }
}

pub(crate) enum Outcome {
    Handled,
    /// It may yet be text.
    Pending,
    /// A menu can have it.
    Unhandled,
}

/// Whatever has the focus.
pub(super) fn press_at<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element, key: &Key) {
    let code = key.legacy_code();
    let event = key_event(&cx.heap, ui, atom!("keydown"), key, code, 0);
    if dispatch(cx, target, event) {
        run_default_actions(cx, target, event);
    }
    let event = key_event(&cx.heap, ui, atom!("keyup"), key, code, 0);
    dispatch(cx, target, event);
}

pub(crate) fn key_up<'a>(cx: &mut Cx<'a>, ui: &'a Ui, key: &Key) {
    ui.pressed_key.take();
    ui.pointer().modifiers.set(key.modifiers);
    let Some(target) = key_target(ui) else { return };
    let event = key_event(&cx.heap, ui, atom!("keyup"), key, key.legacy_code(), 0);
    let was_pressed =
        key.key == atom!(" ") && target.has_state(State::ACTIVE) && is_pressed_with_space(target);
    if was_pressed {
        target.set_state(cx, State::ACTIVE, false);
    }
    let is_allowed = dispatch(cx, target, event);
    if is_allowed && was_pressed {
        activation::click(cx, target, Trusted::Yes, Click::default());
    }
    if is_allowed
        && cfg!(windows)
        && key.key == atom!("ContextMenu")
        && let Some(target) = key_target(ui)
    {
        open_context_menu(cx, ui, target);
    }
}

pub(crate) fn key_down<'a>(cx: &mut Cx<'a>, ui: &'a Ui, key: &Key) -> Outcome {
    const FOR_INPUT_METHOD: u32 = 229;
    ui.pressed_key.take();
    ui.pointer().modifiers.set(key.modifiers);
    let Some(target) = key_target(ui) else {
        return Outcome::Pending;
    };
    let name = key.key.as_utf8();
    let is_for_input_method = key.is_composing || matches!(&*name, "Process" | "Dead");
    let code = if is_for_input_method && key.key_code == 0 {
        FOR_INPUT_METHOD
    } else {
        key.legacy_code()
    };
    let event = key_event(&cx.heap, ui, atom!("keydown"), key, code, 0);
    if ui.pointer().drag.get().is_some() {
        if key.key == atom!("Escape") {
            drag::end(cx, ui, false);
        }
        return Outcome::Pending;
    }
    match code {
        27 if fullscreen::exit_fully(cx, ui) => return Outcome::Handled,
        16..=18 | 27 => {}
        _ => ui.note_user_activation(false),
    }
    pointer::hide_tooltip(cx, ui);
    if !key.modifiers.intersects(SHORTCUT) && !matches!(code, 17 | 18 | 91 | 92) {
        focus::note_key(cx, ui);
    }
    if !dispatch(cx, target, event) {
        return Outcome::Handled;
    }
    if is_for_input_method {
        return Outcome::Pending;
    }
    if editing::clipboard::offer_what_is_selected_by(cx, ui, |cx| {
        key_target(ui).is_some_and(|it| default_key_down(cx, ui, it, event, key))
    }) {
        return Outcome::Handled;
    }
    let is_text = name.encode_utf16().nth(2).is_none() && !key.modifiers.intersects(SHORTCUT);
    ui.pressed_key.replace(Some(key.clone()));
    if is_text {
        Outcome::Pending
    } else {
        Outcome::Unhandled
    }
}

/// `replaced`: what an input method wants the text in place of.
pub(crate) fn handle_text<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    text: &DomString,
    is_from_key: bool,
    replaced: Option<[u32; 2]>,
) {
    let key = ui.pressed_key.take();
    match key {
        // What a dead key does not go with comes after its accent.
        Some(key) if is_from_key && key.key_code != 0 => {
            for character in text.to_utf8().chars() {
                let text = DomString::from_utf8(character.encode_utf8(&mut [0; 4]));
                type_text(
                    cx,
                    ui,
                    &text,
                    Some(Key {
                        key: Atom::from_string(&text),
                        ..key.clone()
                    }),
                    true,
                    replaced,
                );
            }
        }
        key => type_text(cx, ui, text, key, is_from_key, replaced),
    }
}

fn type_text<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    text: &DomString,
    key: Option<Key>,
    is_from_key: bool,
    replaced: Option<[u32; 2]>,
) {
    if is_from_key && ui.composition_target().is_none() {
        let (Some(key), Some(target)) = (key, key_target(ui)) else {
            return;
        };
        let code = text.units().next().unwrap_or(0).into();
        let event = key_event(&cx.heap, ui, atom!("keypress"), &key, code, code);
        if !dispatch(cx, target, event)
            || run_default_actions(cx, control_for_keys(ui, target), event)
        {
            return;
        }
        if text.eq_str(" ") {
            if is_pressed_with_space(target) {
                return target.set_state(cx, State::ACTIVE, true);
            }
            if editing::typing_target(cx, ui).is_none() {
                scroll_by_key(cx, ui, target, event);
                return;
            }
        }
    }
    input_method::type_text(cx, ui, text, replaced);
}
