//! <https://html.spec.whatwg.org/#dynamic-markup-insertion>

use super::parsing::start_parser;
use super::*;
use crate::api::markup::throws_on_markup_insertion;
use crate::api::window::Window;

#[optimize(size)]
fn require_markup_insertion<'a>(heap: &JsHeap<'a>, doc: &Doc) -> Result<'a> {
    if !doc.is_html_doc() {
        return Err(dom_error(
            heap,
            DomError::InvalidStateError,
            "This is only supported on HTML documents.",
        ));
    }
    if throws_on_markup_insertion(doc) {
        return Err(dom_error(
            heap,
            DomError::InvalidStateError,
            "The parser is in the middle of a step.",
        ));
    }
    Ok(())
}

fn is_unloading<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> bool {
    Window::of(doc).is_some_and(|it| it.ignores_opens(heap))
}

/// <https://html.spec.whatwg.org/#document-open-steps>
#[optimize(size)]
fn open_steps<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    if doc
        .parser(&cx.heap)
        .is_some_and(|it| it.script_nesting_level() > 0)
        || doc.loading().was_parser_aborted.get()
        || is_unloading(&cx.heap, doc)
    {
        return;
    }
    let entry = Window::of(doc)
        .filter(|_| doc.is_fully_active())
        .map(|it| (it, it.will_open_document(cx)));
    doc.remove_all_listeners();
    doc.shadow_including_objects()
        .for_each(|it| it.remove_all_listeners());
    doc.last_window()
        .filter(|it| it.doc() == Some(doc))
        .inspect(|it| it.remove_all_listeners());
    replace_all(cx, None, doc);
    if let Some((window, entry)) = entry.filter(|_| doc.is_fully_active()) {
        window.has_opened_document(cx, entry);
    }
    doc.set_quirks(crate::document::Quirks::None);
    let old = doc.parser(&cx.heap).inspect(|it| it.abort());
    start_parser(cx, doc).set_is_from_script(true);
    if old.is_some() {
        allow_load(doc);
    }
}

pub(crate) fn open<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> Result<'a> {
    require_markup_insertion(&cx.heap, doc).map(|()| open_steps(cx, doc))
}

pub(crate) fn close<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> Result<'a> {
    require_markup_insertion(&cx.heap, doc)?;
    doc.parser(&cx.heap).inspect(|it| it.close(cx));
    Ok(())
}

/// <https://html.spec.whatwg.org/#document-write-steps>
#[optimize(size)]
pub(crate) fn write<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, text: &DomString) -> Result<'a> {
    require_markup_insertion(&cx.heap, doc)?;
    if doc.loading().was_parser_aborted.get() {
        return Ok(());
    }
    if !doc
        .parser(&cx.heap)
        .is_some_and(DocumentParser::has_insertion_point)
    {
        if doc.loading().ignores_destructive_writes.get() > 0 || is_unloading(&cx.heap, doc) {
            return Ok(());
        }
        open_steps(cx, doc);
    }
    if let Some(parser) = doc.parser(&cx.heap) {
        parser.write(text);
        parser.run(cx);
    }
    Ok(())
}
