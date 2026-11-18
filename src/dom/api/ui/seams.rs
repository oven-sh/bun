//! What the tree and the selection call.

use bun_jsc::JSString;

use super::layout::{By as Reach, Direction, Unit};
use super::prelude::*;
use super::{details, focus, pointer, popover};
use crate::api::editing::{self, selection};
use crate::api::forms::{self, text_control};

pub(crate) use focus::autofocus_inserted;
pub(crate) use forms::internals::{id_changed, make_form_associated};
pub(crate) use forms::update_all_in as show_controls;

pub(crate) fn before_remove<'a>(cx: &mut Cx<'a>, node: &'a Node, is_move: bool) {
    if let Some(it) = Ui::of(node.doc()) {
        it.before_remove(cx, node, is_move);
    }
}

/// Whether `before_remove` has nothing to do for its children, unless it is hovered, pressed or focused.
pub(crate) fn is_left_alone(parent: &Node) -> bool {
    Ui::of(parent.doc()).is_none_or(|ui| {
        !ui.tab_start()
            .is_some_and(|it| parent.contains_composed(it))
            && ui.open_picker().is_none()
            && ui.top_layer().is_empty()
            && ui.interested().is_empty()
            && pointer::holds_nothing(ui)
    })
}

pub(crate) fn removed<'a>(cx: &mut Cx<'a>, node: &'a Node, is_move: bool) {
    if let Some(element) = node
        .as_element()
        .filter(|it| !is_move && popover::is_showing(it))
    {
        popover::removed(cx, element);
    }
}

fn mark_focus_in<'a>(cx: &mut Cx<'a>, node: &'a Node, on: bool) -> Option<()> {
    let ui = Ui::of(node.doc())?;
    focus::mark_chain(
        cx,
        ui,
        ui.focused().filter(|it| node.contains_composed(it))?,
        on,
    );
    Some(())
}

/// Whether it has the focus, which `after_move` gives back.
pub(crate) fn before_move<'a>(cx: &mut Cx<'a>, node: &'a Node) -> bool {
    mark_focus_in(cx, node, false).is_some()
}

pub(crate) fn after_move<'a>(cx: &mut Cx<'a>, node: &'a Node) {
    mark_focus_in(cx, node, true);
}

/// The child that goes to the first slot of a control. The others go to the second.
pub(crate) fn slotted_first(host: &Element) -> Option<&Element> {
    match host.kind() {
        Kind::Details => details::summary_of(host),
        _ => forms::select::author_button(host),
    }
}

pub(crate) fn selection_changed<'a>(cx: &mut Cx<'a>, doc: &'a Doc) {
    if let Some((ui, selection)) = Ui::of(doc).zip(range::try_selection(doc)) {
        selection::changed(cx, ui, selection);
    }
}

pub(crate) fn focus_selection<'a>(cx: &mut Cx<'a>, selection: &'a Selection) {
    if let Some((ui, range)) = Ui::of(selection.doc()).zip(selection.range()) {
        focus::follow_selection(cx, ui, range.start().node);
    }
}

fn lowercase<'a>(cx: &Cx<'a>, word: JsLocal<'a, JSString>) -> bindgen::Result<'a, String> {
    Ok(DomString::from_js_string(&cx.heap, word)?
        .to_utf8()
        .to_ascii_lowercase())
}

pub(crate) fn modify_selection<'a>(
    cx: &mut Cx<'a>,
    selection: &'a Selection,
    [alter, direction, granularity]: [JsLocal<'a, JSString>; 3],
) -> bindgen::Result<'a, ()> {
    let extends = match &*lowercase(cx, alter)? {
        "move" => false,
        "extend" => true,
        _ => return Ok(()),
    };
    let direction = match &*lowercase(cx, direction)? {
        "forward" => Direction::Forward,
        "backward" => Direction::Backward,
        "left" => Direction::Left,
        "right" => Direction::Right,
        _ => return Ok(()),
    };
    let reach = match &*lowercase(cx, granularity)? {
        "character" => Reach::Character,
        "word" => Reach::Word,
        "line" => Reach::Line,
        "lineboundary" => Reach::LineBoundary,
        "paragraph" => Reach::Paragraph,
        "paragraphboundary" | "sentence" | "sentenceboundary" => Reach::ParagraphBoundary,
        "documentboundary" => Reach::DocumentBoundary,
        _ => return Ok(()),
    };
    Ui::of(selection.doc())
        .map(|it| selection::modify(cx, it, extends, direction, reach, editing::By::Script));
    Ok(())
}

pub(crate) fn expand_range<'a>(cx: &mut Cx<'a>, range: &'a Range, unit: JsLocal<'a, JSString>) {
    let unit = match DomString::from_js_string(&cx.heap, unit)
        .as_ref()
        .map(DomString::to_utf8)
        .as_deref()
    {
        Ok("word") => Some(Unit::Word),
        Ok("sentence" | "block") => Some(Unit::Paragraph),
        Ok("document") => None,
        _ => return,
    };
    selection::expand(cx, range, unit);
}

pub(crate) fn selected_text_of_control<'a>(_: &mut Cx<'a>, control: &'a Node) -> Option<DomString> {
    text_control(control).map(|it| it.selected_text())
}

pub(crate) fn invalidate_control<'a>(cx: &mut Cx<'a>, control: JSValue) {
    if let Some(it) = Element::from_value(control).filter(|it| it.is_rendered()) {
        it.doc().invalidate(cx);
    }
}

pub(crate) fn rendered_text_of_control<'a>(cx: &mut Cx<'a>, control: JSValue) -> Option<&'a Node> {
    let control = Element::from_value(control).filter(|it| it.is_connected())?;
    control.doc().sync(cx);
    text_control(control)?.editor_text()
}
