//! https://w3c.github.io/clipboard-apis/#clipboard-actions

use super::{
    By, Command, Replacement, edit_target, replace_selection, selected, selection, selection_root,
};
use crate::api::forms::text_control;
use crate::api::transfer::{self, Clipboard, DataTransfer, Mode};
use crate::api::ui::prelude::*;
use crate::api::uievents::{ClipboardEvent, InputDetails};

fn fire_clipboard<'a>(cx: &mut Cx<'a>, ui: &'a Ui, name: Known, data: &'a DataTransfer) -> bool {
    let target = match selected(ui).map(|it| it.start().node) {
        Some(start) => Some(
            start
                .parent()
                .filter(|_| !start.is_element())
                .unwrap_or(start)
                .out_of_control(),
        ),
        None => ui
            .focused()
            .or_else(|| ui.doc().body())
            .or_else(|| ui.doc().document_element())
            .map(|it| &**it),
    };
    let event = ClipboardEvent::new(
        &cx.heap,
        ui.doc(),
        name,
        EventInit {
            cancelable: true,
            ..COMPOSED
        },
        Some(data),
    );
    target.is_none_or(|it| dispatch(cx, it, event))
}

fn is_structural(element: &Element) -> bool {
    matches!(
        element.tag(),
        atom!("ol") | atom!("ul") | atom!("dl") | atom!("pre") | atom!("math")
    ) || matches!(
        element.tag(),
        atom!("table") | atom!("thead") | atom!("tbody") | atom!("tfoot") | atom!("tr")
    )
}

/// The class of a `br` that stands for the break between two blocks.
pub(super) const BREAK_BETWEEN_BLOCKS: &str = "Apple-interchange-newline";

/// Removes the copies of what `end` is in, if nothing in them is selected. Returns whether there was a block.
fn trim<'a>(
    cx: &mut Cx<'a>,
    contents: &'a Node,
    range: &'a Range,
    end: &'a Node,
    child: fn(&'a Node) -> Option<&'a Node>,
) -> bool {
    let originals: Vec<_> = end
        .inclusive_ancestors()
        .take_while(|it| *it != range.common_ancestor())
        .collect();
    let copies: Vec<_> = core::iter::successors(child(contents), |it| child(it))
        .take(originals.len())
        .collect();
    let mut had_block = false;
    for (original, copy) in originals.into_iter().zip(copies.into_iter().rev()) {
        let is_block = original.is_element() && looks_like(cx, original, Looks::BLOCK);
        let is_blank = |it: &Node| it.is_text() && it.text().units().all(is_ascii_whitespace);
        if original.length() == 0
            || copy.length() > 0 && !(is_block && copy.children().all(is_blank))
        {
            break;
        }
        had_block |= is_block;
        remove(cx, copy, Observers::Suppress);
    }
    had_block
}

/// With the elements that it would not look or mean the same without.
fn markup_of<'a>(cx: &mut Cx<'a>, range: &'a Range) -> bindgen::Result<'a, DomString> {
    let mut contents: &Node = range.clone_contents(cx)?;
    let breaks_after = trim(cx, contents, range, range.end().node, Node::last_child);
    let breaks_before = trim(cx, contents, range, range.start().node, Node::first_child)
        && contents.first_child().is_some();
    let root = selection_root(cx, range.start().node);
    for element in range
        .common_ancestor()
        .inclusive_ancestors()
        .take_while(|it| *it != root)
        .filter_map(Node::as_element)
    {
        if !is_structural(element) && looks_like(cx, element, Looks::BLOCK) {
            break;
        }
        let copy = clone_node(cx, element, element.doc(), false, None, JSValue::UNDEFINED)?;
        insert(cx, contents, copy, None, Observers::Notify);
        contents = copy;
    }
    let [before, after] = [breaks_before, breaks_after].map(|it| {
        if it {
            format!("<br class=\"{BREAK_BETWEEN_BLOCKS}\">")
                .as_str()
                .into()
        } else {
            DomString::default()
        }
    });
    Ok(DomString::concat(&[
        &before,
        &host::serialize(cx, contents),
        &after,
    ]))
}

fn plain_text<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Option<DomString> {
    let (text, mut plain) = (selection::text(cx, ui), StringBuilder::default());
    text.units()
        .for_each(|it| plain.push_unit(if it == 0xa0 { 32 } else { it }));
    (!text.is_empty()).then(|| plain.finish())
}

pub(crate) fn put_selection<'a>(cx: &mut Cx<'a>, ui: &'a Ui, data: &'a DataTransfer) -> bool {
    let Some(text) = plain_text(cx, ui) else {
        return false;
    };
    data.put(&cx.heap, "text/plain", text);
    let range = range::try_selection(ui.doc())
        .and_then(Selection::span)
        .filter(|it| it.start().node.root() == it.end().node.root());
    if let Some(Ok(markup)) = range
        .filter(|it| text_control(it.start().node.out_of_control()).is_none())
        .map(|it| markup_of(cx, it))
    {
        data.put(&cx.heap, "text/html", markup);
    }
    true
}

pub(super) fn copy<'a>(cx: &mut Cx<'a>, ui: &'a Ui, is_cut: bool, by: By) -> bool {
    let data = DataTransfer::new(ui.doc().heap(&cx.heap), Mode::ReadWrite);
    let proceeds = fire_clipboard(
        cx,
        ui,
        if is_cut { atom!("cut") } else { atom!("copy") },
        data,
    );
    data.set_mode(Mode::Disabled);
    if !proceeds {
        if !data.is_empty() {
            transfer::write_clipboard(cx, ui.doc(), data, Clipboard::General);
        }
        return true;
    }
    let data = DataTransfer::new(&cx.heap, Mode::Disabled);
    if is_cut && edit_target(cx, ui).is_none() || !put_selection(cx, ui, data) {
        return false;
    }
    transfer::write_clipboard(cx, ui.doc(), data, Clipboard::General);
    !is_cut
        || replace_selection(
            cx,
            ui,
            &Replacement::deletion(atom!("deleteByCut"), Command::DeleteSelection),
            by,
        )
}

pub(crate) fn insert_transfer<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    data: &'a DataTransfer,
    input_type: Known,
) -> bool {
    let Some(target) = edit_target(cx, ui) else {
        return false;
    };
    let (text, markup) = (&data.stored("text/plain"), &data.stored("text/html"));
    let details = match text_control(target) {
        Some(_) => InputDetails {
            data: Some(text.clone()),
            ..Default::default()
        },
        None => InputDetails {
            data_transfer: Some(data),
            ..Default::default()
        },
    };
    let is_plain = markup.is_empty() || looks_like(cx, target, Looks::PLAIN_TEXT);
    let (command, value) = if is_plain {
        (Command::InsertText, text)
    } else {
        (Command::InsertPasted, markup)
    };
    replace_selection(
        cx,
        ui,
        &Replacement {
            input_type,
            details,
            text: text.clone(),
            command,
            value: value.clone(),
        },
        By::User,
    )
}

fn paste_from<'a>(cx: &mut Cx<'a>, ui: &'a Ui, clipboard: Clipboard, as_text: bool) -> bool {
    let data = transfer::read_clipboard(cx, ui.doc(), clipboard);
    if as_text {
        data.discard(&cx.heap, "text/html");
    }
    let is_done = !fire_clipboard(cx, ui, atom!("paste"), data)
        || insert_transfer(cx, ui, data, atom!("insertFromPaste"));
    data.set_mode(Mode::Disabled);
    is_done
}

pub(super) fn paste<'a>(cx: &mut Cx<'a>, ui: &'a Ui, as_text: bool) -> bool {
    paste_from(cx, ui, Clipboard::General, as_text)
}

/// For the middle button on Linux.
pub(crate) fn offer_selection<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if !ui
        .focused()
        .and_then(|it| text_control(it))
        .is_some_and(|it| it.is_password())
        && let Some(text) = plain_text(cx, ui)
    {
        let data = DataTransfer::new(&cx.heap, Mode::Disabled);
        data.put(&cx.heap, "text/plain", text);
        transfer::write_clipboard(cx, ui.doc(), data, Clipboard::Selection);
    }
}

pub(crate) fn paste_selection<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if edit_target(cx, ui).is_some() {
        paste_from(cx, ui, Clipboard::Selection, true);
    }
}
