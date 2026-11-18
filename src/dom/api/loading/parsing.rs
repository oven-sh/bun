//! <https://html.spec.whatwg.org/#the-end>

use super::*;
use crate::api::events::{Event, dispatch_for_document, microtask_checkpoint, now};
use crate::api::frames::entry as frames;
use crate::api::history::entry as history;
use crate::api::markup::{DocumentOptions, parse_html_document};
use crate::api::performance::{reached, response_has_ended};
use crate::api::ui::Ui;
use crate::api::ui::refs::Refs;
use crate::api::window::Window;

pub(super) fn set_ready_state<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, state: ReadyState) {
    if doc.ready_state() != state {
        doc.set_ready_state(state);
        fire(cx, doc, atom!("readystatechange"), EventInit::default());
    }
}

#[optimize(size)]
pub(super) fn start_parser<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> &'a DocumentParser {
    let parser = DocumentParser::for_loading(&cx.heap, doc);
    doc.set_edge(&cx.heap, Edge::Parser, parser.to_js());
    delay_load(doc);
    reached(&cx.heap, doc, b"domLoading", now());
    set_ready_state(cx, doc, ReadyState::Loading);
    parser
}

#[optimize(size)]
pub(crate) fn load_html<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, markup: &DomString, goes_on: bool) {
    replace_all(cx, None, doc);
    source::remember(&cx.heap, doc, markup);
    source::set_goes_on(&cx.heap, doc, goes_on);
    let parser = start_parser(cx, doc);
    if !goes_on {
        parser.end();
    }
    parser.write(markup);
    parser.run(cx);
}

fn parser_of_response<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> Option<&'a DocumentParser> {
    doc.parser(heap).filter(|it| !it.is_from_script())
}

pub(crate) fn append_html<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, markup: &DomString) -> bool {
    let Some(parser) = parser_of_response(&cx.heap, doc) else {
        return false;
    };
    source::remember_more(&cx.heap, doc, markup);
    parser.receive(markup);
    if parser.is_paused() {
        speculation::speculate(cx, doc, parser);
    } else if parser.script_nesting_level() == 0 {
        parser.run(cx);
    }
    true
}

pub(crate) fn end_html<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, is_complete: bool) {
    source::set_goes_on(&cx.heap, doc, false);
    response_has_ended(&cx.heap, doc);
    let Some(parser) = parser_of_response(&cx.heap, doc) else {
        return;
    };
    if !is_complete {
        abort_parser(cx, doc);
        return doc
            .window()
            .into_iter()
            .for_each(|it| it.host().loaded(bun_web::host::Stage::Loaded));
    }
    parser.end();
    if parser.script_nesting_level() == 0 {
        parser.run(cx);
    }
}

/// None of its scripts runs, and there is no `load` event.
pub(crate) fn parse_html<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, markup: &DomString) -> Result<'a> {
    source::remember(&cx.heap, doc, markup);
    parse_html_document(
        cx,
        doc,
        markup,
        DocumentOptions {
            allows_shadow_roots: false,
            scripting: true,
        },
    )
}

pub(crate) fn load_xml<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, markup: &DomString) {
    replace_all(cx, None, doc);
    doc.set_doc_flags(DocFlags::IS_XML, true);
    doc.engine(|engine, _| engine.set_mode(crate::document::Quirks::None, true));
    source::remember(&cx.heap, doc, markup);
    let parser = start_parser(cx, doc);
    parser.start_xml(markup);
    parser.run(cx);
}

/// <https://html.spec.whatwg.org/#abort-a-parser>. False if there is none.
#[optimize(size)]
fn abort_parser<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
    let Some(parser) = doc.parser(&cx.heap) else {
        return false;
    };
    parser.abort();
    doc.clear_edge(&cx.heap, Edge::Parser);
    doc.loading().was_parser_aborted.set(true);
    doc.loading().deferred_scripts.take();
    set_ready_state(cx, doc, ReadyState::Interactive);
    set_ready_state(cx, doc, ReadyState::Complete);
    true
}

pub(crate) fn abort_fetches(heap: &JsHeap<'_>, doc: &Doc) {
    doc.own_client(heap)
        .filter(|_| doc.has_realm(heap))
        .inspect(|it| it.abort_fetches());
}

/// False if the `load` event has been fired, or is about to be.
pub(crate) fn stop<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
    if abort_parser(cx, doc) {
        return true;
    }
    let is_waiting = doc.ready_state() != ReadyState::Complete && doc.loading().delays.get() > 0;
    if is_waiting {
        set_ready_state(cx, doc, ReadyState::Complete);
    }
    is_waiting
}

#[optimize(size)]
pub(crate) fn script_was_parsed<'a>(
    cx: Cx<'_, 'a>,
    parser: &'a DocumentParser,
    doc: &'a Doc,
    script: &'a Node,
) {
    if doc.window().is_some() && parser.script_nesting_level() == 0 {
        microtask_checkpoint(cx);
    }
    drop_stale_render_blockers(cx, doc);
    script.as_element().and_then(|it| scripts::prepare(cx, it));
}

#[optimize(size)]
pub(crate) fn parser_has_ended<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    doc.clear_edge(&cx.heap, Edge::Parser);
    if doc.window().is_none() {
        return doc.set_ready_state(ReadyState::Complete);
    }
    doc.invalidate(cx);
    Window::of(doc)
        .into_iter()
        .for_each(|it| history::restore_controls(cx, it));
    reached(&cx.heap, doc, b"domInteractive", now());
    set_ready_state(cx, doc, ReadyState::Interactive);
    let (deferred, sheets, anchor) = (
        doc.loading().deferred_scripts.take(),
        Rc::clone(&doc.loading().blocking_sheets),
        Anchor::new(doc, JSValue::UNDEFINED),
    );
    spawn_for(doc, async move {
        for script in deferred.iter().filter_map(|it| it.take()) {
            script.run_after(&sheets).await;
        }
        match deferred.is_empty() {
            true => anchor.in_task(Box::new(content_has_loaded)).await,
            false => _ = anchor.soon(content_has_loaded).await,
        }
    });
}

fn content_has_loaded<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, _: JSValue) {
    reached(&cx.heap, doc, b"domContentLoadedEventStart", now());
    fire(
        cx,
        doc,
        atom!("DOMContentLoaded"),
        EventInit {
            bubbles: true,
            ..Default::default()
        },
    );
    reached(&cx.heap, doc, b"domContentLoadedEventEnd", now());
    crate::api::service_workers::document_was_parsed(cx);
    frames::fit_container(cx, doc);
    doc.window()
        .into_iter()
        .for_each(|it| it.host().loaded(bun_web::host::Stage::Parsed));
    crate::api::window::take_requests(cx, doc);
    allow_load_now(cx, doc);
}

/// <https://html.spec.whatwg.org/#the-end>, from where nothing delays the load event.
pub(super) fn finish_loading<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    let Some(window) = Window::of(doc) else {
        return;
    };
    if window.surface() != 0
        && crate::api::frames::container(doc)
            .is_none_or(|it| it.synced_engine(cx, |engine, id| engine.is_displayed(id)))
    {
        window.render_before_load(cx);
        if doc.loading().delays.get() > 0 {
            return;
        }
    }
    doc.loading().fetched_sheets.take();
    let time = now() - crate::api::animation::time_origin(doc);
    let is_animating = doc.engine(|engine, _| {
        engine.smil.set_time(time);
        engine.start_smil();
        engine.is_animating()
    });
    if is_animating {
        doc.invalidate(cx);
    }
    let awaits_load = |it: &&Element| it.kind() == Kind::SvgSvg && it.has_listeners(atom!("load"));
    let pictures = Refs::collect(
        &cx.heap,
        doc.objects()
            .skip(1)
            .filter_map(Node::as_element)
            .filter(awaits_load),
    );
    pictures
        .iter()
        .for_each(|it| _ = fire(cx, it, atom!("load"), EventInit::default()));
    history::scroll_on_load(cx, window);
    reached(&cx.heap, doc, b"domComplete", now());
    window
        .host()
        .refresh()
        .into_iter()
        .for_each(|it| history::refresh(cx, window, it.as_bytes()));
    set_ready_state(cx, doc, ReadyState::Complete);
    let is_being_left =
        Ui::of(doc).is_some_and(frames::is_in_frame) && window.host().is_being_left();
    reached(&cx.heap, doc, b"loadEventStart", now());
    let load = Event::new(window.realm(&cx.heap), atom!("load"), EventInit::default());
    dispatch_for_document(cx, window, load);
    reached(&cx.heap, doc, b"loadEventEnd", now());
    frames::fit_container(cx, doc);
    if !is_being_left {
        frames::fire_load_at_container(cx, doc);
    }
    if !doc.is_fully_active() {
        return;
    }
    history::loaded(cx, window);
    crate::api::fonts::document_loaded(cx, doc);
    window.host().loaded(bun_web::host::Stage::Loaded);
}
