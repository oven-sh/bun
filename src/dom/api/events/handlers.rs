//! <https://html.spec.whatwg.org/#event-handler-attributes>

use bun_jsc::JsResult;
use bun_jsc::bindgen::JsLocal;

use super::listeners::{Is, Key, Listener, Listeners};
use super::*;
use crate::generated_bindgen::events::OnEvent;

/// <https://html.spec.whatwg.org/#getting-the-current-value-of-the-event-handler>
fn current_value<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    listeners: &'a Listeners,
    handler: Listener,
) -> JSValue {
    let callback = listeners.callback(handler);
    if !handler.is.contains(Is::UNCOMPILED) {
        return callback;
    }
    listeners.change_handler(&cx.heap, handler, Is::HANDLER, JSValue::NULL);
    let compiled = attributes::compile(cx, target, callback);
    let (is, value) = compiled.map_or((handler.is, callback), |it| (Is::HANDLER, it));
    if listeners
        .first_among(handler.key, handler.serial..handler.serial + 1)
        .is_some_and(|it| listeners.callback(it).is_null())
    {
        listeners.change_handler(&cx.heap, handler, is, value);
    }
    compiled.unwrap_or(JSValue::NULL)
}

/// <https://html.spec.whatwg.org/#the-event-handler-processing-algorithm>
pub(super) fn call<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    listeners: &'a Listeners,
    handler: Listener,
    event: &'a Event,
) -> JsResult<()> {
    let callback = current_value(cx, target, listeners, handler);
    if !callback.is_callable() {
        return Ok(());
    }
    let (this, name) = (target.exposed(), event.name());
    if let Some(error) = event
        .downcast::<ErrorEvent>()
        .filter(|_| name == atom!("error") && target.as_window().is_some())
    {
        let arguments = error.arguments_of_handler(&cx.heap);
        if callback.call(cx.global(), this, &arguments)? == JSValue::TRUE {
            event.cancel();
        }
        return Ok(());
    }
    let result = callback.call(cx.global(), this, &[event.exposed()])?;
    match event
        .downcast::<BeforeUnloadEvent>()
        .filter(|_| name == atom!("beforeunload"))
    {
        Some(unloading) if !result.is_undefined_or_null() => {
            let message = JsLocal::new(&cx.heap, result);
            let message =
                DomString::from_js(cx, message).map_err(|it| it.into_js_error(cx.global()))?;
            event.cancel();
            unloading.set_message_unless_set(message);
        }
        None if result == JSValue::FALSE && name != atom!("beforeunload") => event.cancel(),
        _ => {}
    }
    Ok(())
}

impl EventTarget {
    pub(crate) fn handler<'a>(&'a self, cx: Cx<'_, 'a>, name: &Atom) -> JSValue {
        let found = self
            .listeners()
            .and_then(|it| Some((it, it.handler(EventType::of(name)?)?)));
        found.map_or(JSValue::NULL, |(listeners, handler)| {
            current_value(cx, self, listeners, handler)
        })
    }

    pub(super) fn put_handler(&self, heap: &JsHeap<'_>, name: &Atom, is: Is, value: JSValue) {
        let found = self
            .listeners()
            .and_then(|it| Some((it, it.handler(EventType::of(name)?)?)));
        match (found, value.is_object()) {
            (Some((listeners, handler)), true) => {
                listeners.change_handler(heap, handler, is, value)
            }
            (Some((listeners, handler)), false) => self.remove_listener(heap, listeners, handler),
            (None, true) => self.add_listener(
                heap,
                Key::new(EventType::for_listener(name), false),
                is,
                value,
                None,
            ),
            (None, false) => {}
        }
    }

    pub(crate) fn set_handler(&self, heap: &JsHeap<'_>, name: &Atom, value: JSValue) {
        self.put_handler(heap, name, Is::HANDLER, value);
    }
}

impl OnEvent {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, name: Known) -> JSValue {
        self.handler(cx, &Atom::of(name))
    }

    pub(crate) fn set<'a>(&'a self, cx: Cx<'_, 'a>, name: Known, value: JsLocal<'a>) {
        self.set_handler(&cx.heap, &Atom::of(name), value.to_js());
    }
}
