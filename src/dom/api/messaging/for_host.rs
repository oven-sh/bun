//! For the host of a page.

use bun_jsc::JSGlobalObject;

use super::*;
use crate::api::events::swap_top_level;

pub(crate) struct Envelope(RefCell<Option<Message>>);

impl Envelope {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, message: Message) -> &'a Envelope {
        js_Envelope::create(heap, Envelope(Some(message).into()))
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_adopt_port(realm: &JSGlobalObject, port: Endpoint) -> JSValue {
    MessagePort::new(JsHeap::from_global(realm), port).to_js()
}

#[unsafe(no_mangle)]
fn __bun_dom_release_port(realm: &JSGlobalObject, port: JSValue) -> Option<Endpoint> {
    MessagePort::from_js(JsHeap::from_global(realm), port)?.detach()
}

pub(crate) fn deliver_message(
    cx: Cx<'_, '_>,
    window: JSValue,
    message: Message,
    origin: DomString,
    source: JSValue,
    token: DomString,
) {
    let Some(target) = EventTarget::resolve(&cx.heap, window) else {
        return;
    };
    let was_at_top_level = swap_top_level(true);
    if let Some(event) = MessageEvent::of(cx, message, origin, token) {
        event.set_source(source);
        dispatch(cx, target, event);
    }
    swap_top_level(was_at_top_level);
}

pub(crate) fn deliver<'a>(
    cx: Cx<'_, 'a>,
    window: JsLocal<'a>,
    envelope: &Envelope,
    origin: DomString,
    source: JsLocal<'a>,
) {
    if let Some(message) = envelope.0.take() {
        deliver_message(
            cx,
            window.to_js(),
            message,
            origin,
            source.to_js(),
            DomString::default(),
        );
    }
}

pub(crate) fn sender_of(event: &MessageEvent) -> Option<DomString> {
    let origin =
        Some(event.origin.borrow().clone()).filter(|it| event.is_trusted() && !it.is_empty())?;
    Some(if origin.to_utf8() == "null" {
        DomString::from(&*format!("null {}", event.token.to_utf8()))
    } else {
        origin
    })
}
