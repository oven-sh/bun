//! What the user and `execCommand()` do to text controls and to editable elements.

mod characters;
pub(crate) mod clipboard;
mod command;
pub(crate) mod history;
pub(crate) mod input_method;
mod keys;
mod rich;
pub(crate) mod selection;
pub(crate) mod spelling;

use core::cell::Cell;

pub(crate) use command::Command;
pub(crate) use keys::handle_key;
pub(crate) use selection::{
    reveal_caret_in, schedule_selection_events, select_on_focus, selection_root,
};

use crate::api::forms::text_control;
use crate::api::ui::focus::editing_host;
use crate::api::ui::layout::{By as Reach, Direction};
use crate::api::ui::prelude::*;
use crate::api::uievents::{InputDetails, InputEvent};
use crate::generated_bindgen::interaction::EditingCommands;

#[derive(Default)]
pub(crate) struct Editing {
    selection_serial: Cell<u32>,
    pub(crate) is_selection_unsent: Cell<bool>,
    is_executing_command: Cell<bool>,
    settings: rich::Settings,
    input_method: input_method::InputMethod,
}

impl Editing {
    pub(crate) fn note_selection(&self) {
        self.selection_serial.update(|it| it.wrapping_add(1));
    }

    pub(crate) fn selection_serial(&self) -> u32 {
        self.selection_serial.get()
    }
}

/// Only for the user is there a `beforeinput` event.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum By {
    User,
    Script,
}

type Span<'a> = [Point<'a>; 2];

fn selected(ui: &Ui) -> Option<&Range> {
    range::try_selection(ui.doc())?.range()
}

fn selected_span(ui: &Ui) -> Option<Span<'_>> {
    selected(ui).map(|it| [it.start(), it.end()])
}

/// The text control or the editing host that the selection is in.
pub(crate) fn edit_target<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Option<&'a Element> {
    if let Some(control) = ui.focused().and_then(|it| text_control(it)) {
        return (control.is_mutable() && looks_like(cx, control.element, Looks::RENDERED))
            .then_some(control.element);
    }
    let range = selected(ui)?;
    let start = Some(range.start().node).filter(|it| !selection::is_in_idle_control(ui, it))?;
    if !range.collapsed()
        && range::try_selection(ui.doc())?
            .get_anchor_node()
            .is_some_and(|it| crate::api::ui::focus::is_inert(cx, it))
    {
        return None;
    }
    editing_host(cx, start)
        .or_else(|| rich::host_of_selection(ui).filter(|_| ui.editing.is_executing_command.get()))
}

/// The same, if the keys go there.
pub(crate) fn typing_target<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Option<&'a Element> {
    let (target, focused) = (edit_target(cx, ui)?, ui.focused());
    (focused == Some(target)
        || ui.doc().is(DocFlags::DESIGN_MODE)
        || focused.and_then(|it| editing_host(cx, it)) == Some(target))
    .then_some(target)
}

/// `span` is asked for what is about to change.
fn fire_before_input<'a>(
    cx: &mut Cx<'a>,
    target: &'a Element,
    input_type: Known,
    details: &InputDetails<'a>,
    span: impl FnOnce(&mut Cx<'a>) -> Option<Span<'a>>,
) -> bool {
    if !is_listened_to(atom!("beforeinput")) {
        return true;
    }
    let init = EventInit {
        cancelable: input_type != atom!("insertCompositionText"),
        ..COMPOSED
    };
    let event = InputEvent::new(
        &cx.heap,
        target.doc(),
        atom!("beforeinput"),
        init,
        input_type,
        details,
    );
    if text_control(target).is_none()
        && let Some([start, end]) = span(cx)
    {
        event.set_target_ranges(Refs::collect(&cx.heap, [Range::new(&cx.heap, start, end)]));
    }
    let proceeds = dispatch(cx, target, event);
    event.target_ranges().iter().for_each(Range::stop_following);
    event.set_target_ranges(Refs::default());
    proceeds
}

fn fire_input<'a>(
    cx: &mut Cx<'a>,
    target: &'a Element,
    input_type: Known,
    details: &InputDetails<'a>,
) {
    let event = InputEvent::new(
        &cx.heap,
        target.doc(),
        atom!("input"),
        COMPOSED,
        input_type,
        details,
    );
    dispatch(cx, target, event);
    crate::api::forms::suggestions::user_typed(cx, target);
}

/// Inside of one text node, where nothing but that text changes.
fn is_simple<'a>(cx: &mut Cx<'a>, ui: &'a Ui, [start, end]: Span<'a>, text: &DomString) -> bool {
    let (node, start, end) = (
        start.node,
        start.offset,
        if start.node == end.node {
            end.offset
        } else {
            return false;
        },
    );
    if !node.is_text()
        || rich::has_overrides(cx, ui)
        || node.parent().is_some_and(|it| it.is_html(atom!("option")))
    {
        return false;
    }
    let data = node.text();
    let length = data.len();
    if end == 0 && node.previous_sibling().is_some() {
        return false;
    }
    if (start == 0 || end == length)
        && (end - start == length || node.closest_html(atom!("a")).is_some())
    {
        return false;
    }
    let unit = |index: Option<u32>| {
        index
            .filter(|it| *it < length)
            .map_or(32, |it| data.unit(it))
    };
    let mut around = text
        .units()
        .chain([unit(start.checked_sub(1)), unit(Some(end))]);
    if !looks_like(cx, node, Looks::KEEPS_SPACES) {
        return !around.any(|it| matches!(it, 9 | 10 | 13 | 32 | 0xa0));
    }
    !around.any(|it| matches!(it, 10 | 13))
        && (end < length
            || !node
                .next_sibling()
                .is_some_and(|it| it.is_html(atom!("br"))))
}

struct Replacement<'a> {
    input_type: Known,
    details: InputDetails<'a>,
    /// For a text control.
    text: DomString,
    /// For an editable element.
    command: Command,
    value: DomString,
}

impl Replacement<'_> {
    fn deletion(input_type: Known, command: Command) -> Self {
        Replacement {
            input_type,
            details: InputDetails::default(),
            text: DomString::default(),
            command,
            value: DomString::default(),
        }
    }
}

/// Of what `span` answers.
fn replace<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    with: &Replacement<'a>,
    by: By,
    span: impl Fn(&mut Cx<'a>) -> Option<Span<'a>>,
) -> bool {
    let Replacement {
        input_type,
        ref details,
        ref text,
        command,
        ref value,
    } = *with;
    let Some(mut target) = edit_target(cx, ui).filter(|_| selected(ui).is_some()) else {
        return false;
    };
    if by == By::User {
        if !fire_before_input(cx, target, input_type, details, |cx| {
            span(cx).map(|it| selection::tighten(cx, it))
        }) {
            return true;
        }
        let Some(now) = edit_target(cx, ui) else {
            return true;
        };
        target = now;
    }
    let Some(replaced @ [start, end]) = span(cx) else {
        return true;
    };
    if let Some(control) = text_control(target) {
        let [start, end] = control.offsets_of(replaced);
        let allowed = if input_type == atom!("insertCompositionText") {
            text.clone()
        } else {
            control.filter(text, start, end)
        };
        if allowed.is_empty() && start == end {
            return true;
        }
        control.edit(cx, start, end, &allowed, input_type);
    } else {
        let selection = range::selection_of(&cx.heap, ui.doc());
        let (result, has_changed) = history::change(cx, ui, target, input_type, |cx| {
            if (if command.deletes() {
                start.offset < end.offset
            } else {
                command == Command::InsertText
            }) && is_simple(cx, ui, replaced, text)
                && let Some(node) = start.node.as_text()
            {
                let result = node.replace_data(cx, start.offset, end.offset - start.offset, text);
                selection.collapse(
                    cx,
                    Point {
                        offset: start.offset + text.len(),
                        ..start
                    },
                );
                return result.is_ok();
            }
            if !matches!(command, Command::Delete | Command::ForwardDelete) {
                selection.select(cx, start, end);
            }
            rich::run(cx, ui, command, value)
        });
        if !result || command.deletes() && !has_changed {
            return result;
        }
    }
    fire_input(cx, target, input_type, details);
    selection::reveal(cx, ui);
    true
}

fn replace_selection<'a>(cx: &mut Cx<'a>, ui: &'a Ui, with: &Replacement<'a>, by: By) -> bool {
    replace(cx, ui, with, by, |_| selected_span(ui))
}

pub(crate) fn insert_text<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    text: &DomString,
    input_type: Known,
    by: By,
) -> bool {
    let details = InputDetails {
        data: Some(text.clone()),
        ..Default::default()
    };
    replace_selection(
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
    )
}

pub(crate) fn insert_break<'a>(cx: &mut Cx<'a>, ui: &'a Ui, is_paragraph: bool, by: By) -> bool {
    let Some(target) = edit_target(cx, ui).filter(|it| !it.is_html(atom!("input"))) else {
        return false;
    };
    let (input_type, command) = match is_paragraph
        && if text_control(target).is_some() {
            by == By::Script
        } else {
            !looks_like(cx, target, Looks::PLAIN_TEXT)
        } {
        true => (atom!("insertParagraph"), Command::InsertParagraph),
        false => (atom!("insertLineBreak"), Command::InsertLineBreak),
    };
    let text = DomString::from("\n");
    replace_selection(
        cx,
        ui,
        &Replacement {
            input_type,
            details: InputDetails::default(),
            text: text.clone(),
            command,
            value: text,
        },
        by,
    )
}

fn insert_html<'a>(cx: &mut Cx<'a>, ui: &'a Ui, value: &DomString, by: By) -> bool {
    if ui.focused().and_then(|it| text_control(it)).is_none() {
        return replace_selection(
            cx,
            ui,
            &Replacement {
                value: value.clone(),
                ..Replacement::deletion(atom!(""), Command::InsertHtml)
            },
            by,
        );
    }
    let body = ui.doc().create_html(&cx.heap, atom!("body"));
    let text = host::parse_fragment(cx, body, value)
        .map(|it| it.descendant_text_content())
        .unwrap_or_default();
    insert_text(cx, ui, &text, atom!("insertText"), by)
}

fn delete_by<'a>(cx: &mut Cx<'a>, ui: &'a Ui, is_forward: bool, reach: Reach, by: By) -> bool {
    let input_type = match (
        if selected(ui).is_some_and(|it| it.collapsed()) {
            reach
        } else {
            Reach::Character
        },
        is_forward,
    ) {
        (Reach::Character, true) => atom!("deleteContentForward"),
        (Reach::Character, false) => atom!("deleteContentBackward"),
        (Reach::Word, true) => atom!("deleteWordForward"),
        (Reach::Word, false) => atom!("deleteWordBackward"),
        (Reach::LineBoundary, true) => atom!("deleteSoftLineForward"),
        (Reach::LineBoundary, false) => atom!("deleteSoftLineBackward"),
        (_, true) => atom!("deleteHardLineForward"),
        (_, false) => atom!("deleteHardLineBackward"),
    };
    let command = match (reach, is_forward) {
        (Reach::Character, true) => Command::ForwardDelete,
        (Reach::Character, false) => Command::Delete,
        _ => Command::DeleteSelection,
    };
    replace(
        cx,
        ui,
        &Replacement::deletion(input_type, command),
        by,
        |cx| {
            let span = selected_span(ui)?;
            let Some(caret) = selection::caret(ui).filter(|_| span[0] == span[1]) else {
                return Some(span);
            };
            let (from, root) = (caret.point, selection_root(cx, caret.point.node));
            let mut moved = |reach| {
                selection::moved(
                    cx,
                    root,
                    caret,
                    if is_forward {
                        Direction::Forward
                    } else {
                        Direction::Backward
                    },
                    reach,
                )
                .point
            };
            let takes_mark = command == Command::Delete
                && from.offset > 0
                && from.node.is_text()
                && characters::follows_mark(&from.node.text(), from.offset);
            let mut to = if takes_mark {
                Point {
                    offset: from.offset - 1,
                    ..from
                }
            } else {
                moved(reach)
            };
            if reach > Reach::Word && from == to {
                to = moved(Reach::Character);
            }
            Some(if range::compare_points(from, to).is_lt() {
                [from, to]
            } else {
                [to, from]
            })
        },
    )
}

pub(crate) fn delete_dragged<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    replace_selection(
        cx,
        ui,
        &Replacement::deletion(atom!("deleteByDrag"), Command::DeleteSelection),
        By::User,
    );
}

fn travel<'a>(cx: &mut Cx<'a>, ui: &'a Ui, is_undo: bool, by: By) -> bool {
    let Some(target) = edit_target(cx, ui) else {
        return false;
    };
    let (input_type, details) = (
        if is_undo {
            atom!("historyUndo")
        } else {
            atom!("historyRedo")
        },
        &InputDetails::default(),
    );
    if by == By::User && !fire_before_input(cx, target, input_type, details, |_| None) {
        return true;
    }
    let has_changed = match text_control(target) {
        Some(control) => control.travel(cx, is_undo),
        None => history::travel(cx, ui, target, is_undo),
    };
    if has_changed {
        fire_input(cx, target, input_type, details);
        selection::reveal(cx, ui);
    }
    has_changed
}

fn format<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    command: Command,
    input_type: Known,
    value: &DomString,
    by: By,
) -> bool {
    let Some(host) = edit_target(cx, ui)
        .filter(|it| text_control(it).is_none() && rich::is_enabled(cx, ui, command))
    else {
        return false;
    };
    let mut details = InputDetails::default();
    if by == By::User
        && !fire_before_input(cx, host, input_type, &details, |cx| {
            selected_span(ui).map(|it| selection::tighten(cx, it))
        })
    {
        return true;
    }
    if selected(ui).is_none() {
        return true;
    }
    let (result, _) = history::change(cx, ui, host, input_type, |cx| {
        rich::run(cx, ui, command, value)
    });
    if result {
        details.data = (input_type == atom!("insertLink")).then(|| value.clone());
        fire_input(cx, host, input_type, &details);
    }
    result
}

pub(crate) fn execute<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    command: Command,
    value: &DomString,
    by: By,
) -> bool {
    match command {
        Command::Copy | Command::Cut if by == By::Script && !ui.has_transient_activation() => false,
        Command::Copy => clipboard::copy(cx, ui, false, by) || by == By::Script,
        Command::Cut => clipboard::copy(cx, ui, true, by),
        Command::Paste | Command::PasteAndMatchStyle => {
            by == By::User && clipboard::paste(cx, ui, command != Command::Paste)
        }
        Command::SelectAll => {
            selection::select_all(cx, ui, by);
            true
        }
        Command::Unselect => {
            range::selection_of(&cx.heap, ui.doc()).clear(cx);
            true
        }
        Command::Undo | Command::Redo => travel(cx, ui, command == Command::Undo, by),
        Command::Delete | Command::ForwardDelete => delete_by(
            cx,
            ui,
            command == Command::ForwardDelete,
            Reach::Character,
            by,
        ),
        Command::InsertText => insert_text(cx, ui, value, atom!("insertText"), by),
        Command::InsertHtml => insert_html(cx, ui, value, by),
        Command::InsertLineBreak | Command::InsertParagraph => {
            insert_break(cx, ui, command == Command::InsertParagraph, by)
        }
        _ if command.is_setting() => rich::configure(ui, command, value),
        _ => command
            .type_of_formatting()
            .is_some_and(|it| format(cx, ui, command, it, value, by)),
    }
}

pub(crate) fn is_enabled<'a>(cx: &mut Cx<'a>, ui: &'a Ui, command: Command) -> bool {
    match command {
        Command::Copy => !selection::text(cx, ui).is_empty(),
        Command::SelectAll | Command::Unselect => true,
        _ if command.is_setting() => true,
        _ => edit_target(cx, ui).is_some_and(|target| match command {
            Command::Cut => !selection::text(cx, ui).is_empty(),
            Command::Undo | Command::Redo => {
                let is_undo = command == Command::Undo;
                text_control(target).map_or_else(
                    || history::can_travel(target, is_undo),
                    |it| it.can_travel(is_undo),
                )
            }
            _ => command.type_of_formatting().is_none() || rich::is_enabled(cx, ui, command),
        }),
    }
}

impl EditingCommands {
    fn command<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &DomString,
    ) -> bindgen::Result<'a, Option<(&'a Ui, Command)>> {
        match self.is_html_doc() {
            true => Ok(Ui::of(self).zip(Command::from_name(name))),
            false => Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "This is only supported on HTML documents.",
            )),
        }
    }

    fn query<'a, R: Default>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &DomString,
        ask: fn(&mut Cx<'a>, &'a Ui, Command) -> R,
    ) -> bindgen::Result<'a, R> {
        Ok(self
            .command(&cx.heap, name)?
            .map(|(ui, command)| ask(cx, ui, command))
            .unwrap_or_default())
    }

    pub(crate) fn exec_command<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &DomString,
        _shows_interface: bool,
        value: bindgen::JsLocal<'a>,
    ) -> bindgen::Result<'a, bool> {
        let value = if value.to_js().is_undefined() {
            Atom::EMPTY.to_js(&cx.heap).as_value()
        } else {
            value
        };
        let value = if name.eq_ignore_ascii_case("inserthtml") {
            crate::api::trusted::Trusted::Html.string_for(
                cx,
                self,
                value,
                "Document execCommand",
            )?
        } else {
            DomString::from_js(cx, value)?
        };
        let Some((ui, command)) = self
            .command(&cx.heap, name)?
            .filter(|it| !it.0.editing.is_executing_command.replace(true))
        else {
            return Ok(false);
        };
        let result = execute(cx, ui, command, &value, By::Script);
        ui.editing.is_executing_command.set(false);
        Ok(result)
    }

    pub(crate) fn query_command_supported<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &DomString,
    ) -> bindgen::Result<'a, bool> {
        self.command(&cx.heap, name)
            .map(|_| Command::from_name(name).is_some())
    }

    pub(crate) fn query_command_enabled<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &DomString,
    ) -> bindgen::Result<'a, bool> {
        self.query(cx, name, is_enabled)
    }

    pub(crate) fn query_command_state<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &DomString,
    ) -> bindgen::Result<'a, bool> {
        self.query(cx, name, rich::state)
    }

    pub(crate) fn query_command_indeterm<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &DomString,
    ) -> bindgen::Result<'a, bool> {
        self.query(cx, name, rich::is_indeterminate)
    }

    pub(crate) fn query_command_value<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &DomString,
    ) -> bindgen::Result<'a, DomString> {
        self.query(cx, name, rich::value)
            .map(|it| DomString::from_utf8(&it))
    }
}
