//! What a context menu needs to know.

use bun_web::host::{ContextMenu, EditFlags, MediaType};

use super::pointer;
use super::prelude::*;
use crate::api::editing::{self, Command};
use crate::api::forms::{InputType, button_type, input_type, text_control};
use crate::api::transfer::clipboard;

fn owned(text: Option<DomString>) -> String {
    text.unwrap_or_default().to_utf8().into_owned()
}

fn control_type(element: &Element) -> String {
    match (element.html_tag(), input_type(element)) {
        (_, Some(InputType::Tel)) => "input-telephone".into(),
        (_, Some(kind)) => ["input-", kind.name().as_str()].concat(),
        (atom!("button"), _) => [button_type(element).as_str(), "-button"].concat(),
        (atom!("select"), _) if element.has_attr(atom!("multiple")) => "select-multiple".into(),
        (atom!("select"), _) => "select-one".into(),
        (atom!("textarea"), _) => "text-area".into(),
        (atom!("fieldset"), _) => "field-set".into(),
        (atom!("output"), _) => "output".into(),
        _ => "none".into(),
    }
}

pub(crate) fn describe_point<'a>(cx: &mut Cx<'a>, ui: &'a Ui, point: [f64; 2]) -> ContextMenu {
    let (doc, hit) = (ui.doc(), pointer::element_at(cx, ui, point));
    let target = hit.and_then(|it| it.out_of_control().as_element());
    let link = hit
        .into_iter()
        .flat_map(|it| it.flat_ancestors())
        .filter_map(Node::as_element)
        .find(|it| it.is_html(atom!("a")) && it.has_attr(atom!("href")));
    let attribute = |name: Known| target.and_then(|it| it.attr(name));
    let mut resolve = |url: Option<DomString>| {
        owned(
            url.and_then(|it| doc.parse_url(cx, &it))
                .map(|it| it.into_href()),
        )
    };
    let (link_url, src_url) = (
        resolve(link.and_then(|it| it.attr(atom!("href")))),
        resolve(attribute(atom!("src"))),
    );
    let is_editable = editing::edit_target(cx, ui)
        .zip(target)
        .is_some_and(|(edited, target)| edited.contains_flat(target));
    let field = target.and_then(|it| text_control(it)).map(|it| {
        it.kind()
            .map_or(atom!("textarea"), InputType::name)
            .as_str()
    });
    let [can_undo, can_redo, can_cut, can_copy] =
        [Command::Undo, Command::Redo, Command::Cut, Command::Copy]
            .map(|it| editing::is_enabled(cx, ui, it));
    let [x, y] = point.map(|it| (it * layout::zoom(doc)).round());
    ContextMenu {
        x,
        y,
        page_url: owned(Some(doc.url())),
        link_url,
        link_text: owned(link.map(|it| it.descendant_text_content())),
        src_url,
        media_type: match target.map(Element::tag) {
            Some(atom!("img")) => MediaType::Image,
            Some(atom!("video")) => MediaType::Video,
            Some(atom!("audio")) => MediaType::Audio,
            Some(atom!("canvas")) => MediaType::Canvas,
            _ => MediaType::None,
        },
        alt_text: owned(attribute(atom!("alt"))),
        title_text: owned(attribute(atom!("title"))),
        selection_text: owned(Some(editing::selection::text(cx, ui))),
        is_editable,
        input_field_type: field.unwrap_or("none").into(),
        form_control_type: target.map_or_else(|| "none".into(), control_type),
        edit_flags: EditFlags {
            can_undo,
            can_redo,
            can_cut,
            can_copy,
            can_paste: is_editable && clipboard::can_paste(&cx.heap),
            can_edit_richly: is_editable && field.is_none(),
        },
        misspelled_word: String::new(),
        suggestions: Vec::new(),
    }
}

pub(crate) fn show<'a>(cx: &mut Cx<'a>, ui: &'a Ui, point: [f64; 2], misspelled: &DomString) {
    let (menu, Some(window)) = (Box::new(describe_point(cx, ui, point)), ui.doc().window()) else {
        return;
    };
    if misspelled.is_empty() {
        return window.host().context_menu(menu);
    }
    let word = misspelled.to_utf8().into_owned();
    host::guess_spelling(cx, ui, word.clone(), move |window, suggestions| {
        window.host().context_menu(Box::new(ContextMenu {
            misspelled_word: word,
            suggestions,
            ..*menu
        }))
    });
}
