//! The pop-up of `<input list>`.

use super::*;
use crate::api::ui::assistive::Semantics;
use crate::api::uievents::MouseEvent;

const LIST: &str = "-internal-suggestions";
const ROW: &str = "-internal-suggestion";
const ACTIVE_ROW: &str = "-internal-suggestion-active";

pub(super) fn options(input: Input<'_>) -> impl Iterator<Item = &Element> {
    let all = input
        .list()
        .into_iter()
        .flat_map(|it| it.descendant_elements());
    all.filter(|it| option::is_option(it) && !is_disabled(it) && !option::value(it).is_empty())
}

/// Where the part of the text begins that an option takes the place of.
fn start_of_entry(input: Input<'_>) -> u32 {
    let text = input.text.text();
    match input.kind() == InputType::Email && input.element.has_attr(atom!("multiple")) {
        true => {
            text.len()
                - text
                    .units()
                    .rev()
                    .take_while(|it| *it != u16::from(b','))
                    .count() as u32
        }
        false => 0,
    }
}

/// With the row that the arrow keys have led to.
pub(crate) fn shown(input: Input<'_>) -> Option<(&Element, Option<&Element>)> {
    pop_up(input.element, LIST).map(|list| {
        (
            list,
            list.element_children().find(|it| it.is_part(ACTIVE_ROW)),
        )
    })
}

pub(crate) fn semantics(part: &Element) -> Semantics {
    let role = [(LIST, "listbox"), (ROW, "option"), (ACTIVE_ROW, "option")]
        .into_iter()
        .find(|it| part.is_part(it.0));
    role.map(|it| ("role", it.1.to_owned()))
        .into_iter()
        .collect()
}

pub(super) fn close<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    close_pop_up(cx, input.element, LIST);
}

/// Returns whether there is anything.
pub(super) fn show<'a>(cx: &mut Cx<'a>, input: Input<'a>, even_if_empty: bool) -> bool {
    const MAX_ROWS: usize = 512;
    close(cx, input);
    if !input.kind().has_editor()
        || input.text.is_password()
        || !input.text.is_mutable()
        || !even_if_empty && input.text.len() == 0
    {
        return false;
    }
    let typed = input
        .text
        .text()
        .substring(start_of_entry(input), u32::MAX)
        .to_utf8()
        .trim()
        .to_lowercase();
    let all = options(input).map(|it| [option::value(it), option::label(it)]);
    let matches = |it: &[DomString; 2]| {
        it.iter().any(|it| {
            typed.is_empty()
                || bun_core::strings::contains(
                    it.to_utf8().to_lowercase().as_bytes(),
                    typed.as_bytes(),
                )
        }) && input.sanitize(&it[0]) == it[0]
    };
    let mut rows = all.filter(matches).take(MAX_ROWS).peekable();
    let Some(list) = rows
        .peek()
        .and_then(|_| open_pop_up(cx, input.element, LIST))
    else {
        return false;
    };
    for [value, label] in rows {
        let row = div(cx, input.element, list, ROW);
        text_in(cx, row, &value.to_utf8());
        if label != value {
            let part = part(
                cx,
                input.element,
                row,
                "-internal-suggestion-label",
                atom!("span"),
            );
            text_in(cx, part, &label.to_utf8());
        }
    }
    true
}

pub(crate) fn user_typed<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    if let Some(input) =
        Input::of(element).filter(|_| element.has_attr(atom!("list")) && focus::has_focus(element))
    {
        show(cx, input, false);
    }
}

pub(super) fn options_changed<'a>(cx: &mut Cx<'a>, list: &'a Element, _: bool) {
    let focused = Ui::of(list.doc()).and_then(Ui::focused).and_then(Input::of);
    if let Some(input) =
        focused.filter(|it| it.list() == Some(list) && it.text.was_last_edited_by_user())
    {
        input.state.has_new_options.set(true);
        dirty(cx, input.element);
    }
}

fn accept<'a>(cx: &mut Cx<'a>, input: Input<'a>, row: &'a Node) {
    let value = row.first_child().map(|it| it.text()).unwrap_or_default();
    close(cx, input);
    input.text.begin_edit();
    input.set_value(
        cx,
        &DomString::concat(&[&input.text.text().prefix(start_of_entry(input)), &value]),
    );
    input.text.show_selection(cx);
    fire_input(cx, input.element);
    input.text.commit(cx);
}

pub(super) fn mouse_down<'a>(
    cx: &mut Cx<'a>,
    input: Input<'a>,
    event: &'a MouseEvent,
    origin: &'a Node,
) -> bool {
    let list = pop_up(input.element, LIST);
    if list.is_some_and(|it| it.contains_flat(origin)) {
        if let Some(row) = origin
            .inclusive_ancestors()
            .find(|it| it.is_part(ROW) || it.is_part(ACTIVE_ROW))
        {
            accept(cx, input, row);
        }
        return true;
    }
    match list {
        Some(_) => close(cx, input),
        None if event.get_button() == 0 && input.element.has_attr(atom!("list")) => {
            _ = show(cx, input, true)
        }
        None => {}
    }
    false
}

pub(super) fn key_down<'a>(cx: &mut Cx<'a>, input: Input<'a>, key: Known) -> bool {
    let is_vertical = matches!(key, atom!("ArrowDown") | atom!("ArrowUp"));
    let Some(list) = pop_up(input.element, LIST) else {
        return is_vertical
            && input.kind() != InputType::Number
            && input.element.has_attr(atom!("list"))
            && show(cx, input, true);
    };
    let active = list.children().find(|it| it.is_part(ACTIVE_ROW));
    if is_vertical {
        let next = match key {
            atom!("ArrowDown") => active
                .and_then(Node::next_sibling)
                .or_else(|| list.first_child()),
            _ => active
                .and_then(Node::previous_sibling)
                .or_else(|| list.last_child()),
        };
        for (row, name) in [(active, ROW), (next, ACTIVE_ROW)] {
            row.and_then(Node::as_element)
                .into_iter()
                .for_each(|it| it.set_pseudo(name, input.element));
        }
        next.and_then(Node::as_element)
            .into_iter()
            .for_each(|it| layout::reveal_in_nearest_scroller(cx, it));
        return true;
    }
    match (key, active) {
        (atom!("Enter") | atom!("Tab"), Some(row)) => accept(cx, input, row),
        (atom!("Enter") | atom!("Tab") | atom!("Escape"), _) => close(cx, input),
        _ => return false,
    }
    key == atom!("Escape") || key == atom!("Enter") && active.is_some()
}
