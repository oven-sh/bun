//! `bun_ui::dom`

use bun_jsc::bindgen::{self, JsHeap, JsInterface as _, JsLocal, JsScope};
use bun_jsc::{JSValue, JsResult};
use bun_ui::Rect;
use bun_ui::dom::{self, Change, Hidden, Metrics, Place};
use bun_ui::main_global;
use bun_ui::protocol::Size;

use crate::api::core::{
    Atom, Doc, DomString, Element, Event, Node, Observers, append, global_of, remove, replace_all,
};
use crate::api::render::{self, RenderRoot};
use crate::api::ui::{focus, layout};
use crate::api::uievents::KeyboardEvent;
use crate::api::window::Window;
use crate::generated_bindgen::forms::HTMLInputElement;
use crate::scroll::Alignment;

fn heap() -> &'static JsHeap<'static> {
    JsHeap::from_global(main_global())
}

fn with_element<R>(
    document: dom::Document,
    place: Place<'_>,
    run: impl for<'a> FnOnce(&mut JsScope<'a>, &'a Element) -> R,
) -> Option<R> {
    let find = |cx: &mut JsScope<'_>| {
        let found = place
            .iter()
            .try_fold(Doc::from_js(&cx.heap, document.0)?.body()?, |parent, at| {
                parent.element_children().nth(*at)
            })?;
        Some(run(cx, found))
    };
    // SAFETY: this is the thread of the VM, and the caller holds the document.
    unsafe { JsScope::with(main_global().as_mut_ptr(), find) }
}

fn change<'a>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    change: Change<'_>,
) -> bindgen::Result<'a, ()> {
    let parse = |cx: &mut JsScope<'a>, markup| {
        crate::api::markup::parse_fragment(
            cx,
            element,
            &DomString::from_utf8(markup),
            element,
            Default::default(),
        )
    };
    match change {
        Change::AppendMarkup(markup) => parse(cx, markup).and_then(|it| append(cx, it, element))?,
        Change::ReplaceMarkup(markup) => {
            parse(cx, markup).map(|it| replace_all(cx, Some(it), element))?
        }
        Change::Attribute(name, value) => {
            element.set_attr(cx, Atom::new(name), DomString::from_utf8(value))
        }
        Change::Remove => remove(cx, element, Observers::Notify),
        Change::Reveal => layout::scroll_into_view(cx, element, Alignment::Nearest),
        Change::Focus => focus::focus(cx, element, focus::Cause::Script, Default::default()),
    }
    Ok(())
}

#[unsafe(no_mangle)]
fn __bun_dom_change(it: dom::Document, place: Place<'_>, what: Change<'_>) -> JsResult<()> {
    with_element(it, place, |cx, it| {
        change(cx, it, what).map_err(|it| it.into_js_error(main_global()))
    })
    .unwrap_or(Ok(()))
}

#[unsafe(no_mangle)]
fn __bun_dom_bounds(it: dom::Document, place: Place<'_>) -> Rect {
    let [x, y, width, height] =
        with_element(it, place, |cx, it| layout::bounding_rect(cx, it).to_array())
            .unwrap_or_default();
    Rect {
        x,
        y,
        width,
        height,
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_viewport(it: dom::Document) -> Size {
    let [width, height] = Doc::from_js(heap(), it.0)
        .and_then(|it| it.window()?.downcast::<Window>())
        .map_or([0.0; 2], |it| layout::narrow(it.viewport_size()));
    Size { width, height }
}

#[unsafe(no_mangle)]
fn __bun_dom_listen(it: dom::Document, event: &str, listener: JSValue) -> JsResult<()> {
    let Some(document) = Doc::from_js(heap(), it.0) else {
        return Ok(());
    };
    document
        .add_event_listener(
            heap(),
            &Atom::new(event),
            JsLocal::new(heap(), listener).as_any_object(),
            None,
        )
        .map_err(|it| it.into_js_error(main_global()))
}

#[unsafe(no_mangle)]
fn __bun_dom_render(
    it: dom::Document,
    root: Option<JSValue>,
    content: JSValue,
    window: JSValue,
) -> JsResult<JSValue> {
    let rendered = with_element(it, &[], |cx, body| {
        let root = root
            .and_then(|it| RenderRoot::from_js(&cx.heap, it))
            .map_or_else(|| render::create_root(cx, body), Ok);
        root.and_then(|it| it.render_in(cx, content, window).map(|()| it.to_js()))
            .map_err(|it| it.into_js_error(main_global()))
    });
    rendered.unwrap_or_else(|| {
        Err(main_global().throw_type_error(format_args!("The document has no body")))
    })
}

#[unsafe(no_mangle)]
fn __bun_dom_use_store(subscribe: JSValue, read: JSValue) -> JsResult<JSValue> {
    let use_it = |cx: &mut JsScope<'_>| {
        let [subscribe, read] = [subscribe, read].map(|it| JsLocal::new(&cx.heap, it));
        render::use_sync_external_store(cx, subscribe, read)
            .map_err(|it| it.into_js_error(main_global()))
    };
    // SAFETY: this is the thread of the VM.
    unsafe { JsScope::with(main_global().as_mut_ptr(), use_it) }
}

fn target_of(it: dom::Event) -> Option<&'static Node> {
    Event::from_js(heap(), it.0)?.target_node()
}

#[unsafe(no_mangle)]
fn __bun_dom_target(it: dom::Event) -> Vec<usize> {
    let Some((target, body)) = target_of(it)
        .and_then(|it| Some((it, it.doc().body()?)))
        .filter(|(it, body)| body.contains(it))
    else {
        return Vec::new();
    };
    let inside = core::iter::successors(target.as_element(), |it| it.parent_element())
        .take_while(|it| *it != body);
    let mut place: Vec<_> = inside
        .map(|it| it.previous_siblings().filter(|it| it.is_element()).count())
        .collect();
    place.reverse();
    place
}

#[unsafe(no_mangle)]
fn __bun_dom_is_target_checked(it: dom::Event) -> bool {
    target_of(it)
        .and_then(|it| HTMLInputElement::from_js(heap(), it.to_js()))
        .is_some_and(|it| it.get_checked())
}

#[unsafe(no_mangle)]
fn __bun_dom_key(it: dom::Event) -> String {
    KeyboardEvent::from_js(heap(), it.0)
        .map(|it| it.get_key().as_utf8().into_owned())
        .unwrap_or_default()
}

pub(super) fn with_node<R>(
    node: JSValue,
    run: impl for<'a> FnOnce(&mut JsScope<'a>, &'a Node) -> Option<R>,
) -> Option<R> {
    let global = global_of(Node::from_js(heap(), node)?.realm(heap()));
    // SAFETY: this is the thread of the VM, and the caller holds the node.
    unsafe {
        JsScope::with(global.as_mut_ptr(), |cx| {
            Node::from_js(&cx.heap, node).and_then(|it| run(cx, it))
        })
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_metrics(it: dom::Document) -> Metrics {
    let metrics = with_node(it.0, |cx, it| {
        let window = it.doc().window()?.downcast::<Window>()?;
        let content = it
            .doc()
            .document_element()
            .map_or([0.0; 2], |it| it.scrolling_area(cx).map(f64::from));
        Some(Metrics {
            viewport: [window.get_inner_width(cx), window.get_inner_height(cx)],
            scroll: [window.get_scroll_x(cx), window.get_scroll_y(cx)],
            content,
        })
    });
    metrics.unwrap_or_default()
}

#[unsafe(no_mangle)]
fn __bun_dom_is_node(it: dom::Node) -> bool {
    Node::from_js(heap(), it.0).is_some()
}

#[unsafe(no_mangle)]
fn __bun_dom_reveal(it: dom::Node) -> Result<(), Hidden> {
    let revealed = with_node(it.0, |cx, it| {
        let it = Some(it).filter(|it| it.is_connected())?;
        let shown = it
            .as_element()
            .or_else(|| it.parent_element())
            .filter(|it| !it.client_rects(cx).is_empty());
        Some(
            shown
                .map(|it| it.reveal_if_needed(cx, true))
                .ok_or(Hidden::NotRendered),
        )
    });
    revealed.unwrap_or(Err(Hidden::Detached))
}

#[unsafe(no_mangle)]
fn __bun_dom_focus(it: dom::Node) {
    with_node(it.0, |cx, it| {
        it.as_element()
            .map(|it| focus::focus(cx, it, focus::Cause::Script, Default::default()))
    });
}
