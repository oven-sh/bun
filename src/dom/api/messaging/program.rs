//! The windows of a program have the ports and the events of the runtime.

use bun_jsc::JSGlobalObject;
use bun_web::realm::{construct_native, native};

use super::*;
use crate::api::events::twin_of_native_event;

unsafe extern "C" {
    safe fn Bun__DOM__isPortOfRuntime(value: JSValue) -> bool;
}

fn member<'a>(global: &JSGlobalObject, of: JSValue, name: &'static str) -> Result<'a, JSValue> {
    Ok(of.get(global, name)?.unwrap_or(JSValue::UNDEFINED))
}

fn invoke<'a>(
    global: &JSGlobalObject,
    of: JSValue,
    name: &'static str,
    arguments: &[JSValue],
) -> Result<'a, JSValue> {
    Ok(member(global, of, name)?.call(global, of, arguments)?)
}

fn text(heap: &JsHeap<'_>, value: &'static str) -> JSValue {
    DomString::from_latin1(value.as_bytes()).to_js(heap).to_js()
}

/// Of an array that may be frozen.
fn thaw<'a>(cx: Cx<'_, 'a>, array: JSValue) -> Result<'a, List<'a>> {
    let list = List::new(&cx.heap);
    if !array.is_empty() {
        let mut items = array.array_iterator(global_of(&cx.heap))?;
        while let Some(item) = items.next()? {
            list.push(&cx.heap, item);
        }
    }
    Ok(list)
}

fn pass_to_page<'a>(
    cx: Cx<'_, 'a>,
    [own, _]: [JsLocal<'a>; 2],
    _: u64,
    given: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let (Some(own), [event]) = (MessagePort::from_js(&cx.heap, own.to_js()), given) else {
        return Ok(JSValue::UNDEFINED);
    };
    let (data, ports) = (
        member(global_of(&cx.heap), event.to_js(), "data")?,
        member(global_of(&cx.heap), event.to_js(), "ports")?,
    );
    let moved = thaw(cx, ports)?;
    for at in 0..moved.len() {
        let port = to_page(cx, moved.get(at))?;
        moved.set(&cx.heap, at, port);
    }
    let message = serialize(cx, data, (0..moved.len()).map(|at| moved.get(at)))?;
    if let Some(it) = own.endpoint.borrow().as_ref() {
        it.send(message);
    }
    Ok(JSValue::UNDEFINED)
}

fn close<'a>(
    cx: Cx<'_, 'a>,
    [own, _]: [JsLocal<'a>; 2],
    _: u64,
    _: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    MessagePort::from_js(&cx.heap, own.to_js())
        .into_iter()
        .for_each(MessagePort::close);
    Ok(JSValue::UNDEFINED)
}

fn pass_to_program<'a>(cx: Cx<'_, 'a>, port: JSValue, message: Message) -> Result<'a> {
    let (data, ports) = receive(cx, message)?;
    let ports = thaw(cx, ports)?;
    let moved = all_to_program(cx, ports)?;
    invoke(global_of(&cx.heap), port, "postMessage", &[data, moved]).map(drop)
}

fn arrived<'a>(cx: Cx<'_, 'a>, own: JsLocal<'a>) {
    let Some((own, port)) = MessagePort::from_js(&cx.heap, own.to_js())
        .and_then(|it| Some((it, js_DomMessagePort::target(it)?)))
    else {
        return;
    };
    let arrival = own.endpoint.borrow().as_ref().and_then(Endpoint::take);
    let passed = match arrival {
        Some(Arrival::Message(message)) => pass_to_program(cx, port, message),
        Some(Arrival::Closed) => {
            own.close();
            invoke(global_of(&cx.heap), port, "close", &[]).map(drop)
        }
        None => Ok(()),
    };
    exec::report(cx, passed);
}

/// What arrives at one is sent through the other.
fn connect<'a>(cx: Cx<'_, 'a>, port: JSValue, own: &'a MessagePort) -> Result<'a> {
    for (name, listener) in [
        ("message", pass_to_page as bindgen::CallbackBody),
        ("close", close),
    ] {
        let listener = cx
            .heap
            .create_callback(listener, [own.to_js(), JSValue::UNDEFINED], 0)
            .to_js();
        invoke(
            global_of(&cx.heap),
            port,
            "addEventListener",
            &[text(&cx.heap, name), listener],
        )?;
    }
    invoke(global_of(&cx.heap), port, "start", &[])?;
    invoke(global_of(&cx.heap), port, "unref", &[])?;
    js_DomMessagePort::set_target(own, port);
    if let Some(it) = own.endpoint.borrow().as_ref() {
        listen(cx, it, own.to_js(), arrived);
    }
    Ok(())
}

/// What takes its place, if it is a port.
pub(crate) fn to_page<'a>(cx: Cx<'_, 'a>, object: JSValue) -> Result<'a, JSValue> {
    if !Bun__DOM__isPortOfRuntime(object) {
        return Ok(object);
    }
    let (near, far) = Endpoint::pair();
    connect(cx, object, MessagePort::new(&cx.heap, near))?;
    Ok(MessagePort::new(&cx.heap, far).to_js())
}

fn all_to_program<'a>(cx: Cx<'_, 'a>, ports: List<'a>) -> Result<'a, JSValue> {
    let moved = List::new(&cx.heap);
    for own in ports.values() {
        let Some(own) = MessagePort::from_js(&cx.heap, own) else {
            continue;
        };
        let channel = construct_native(global_of(&cx.heap), "MessageChannel", &[])?;
        let port = member(global_of(&cx.heap), channel, "port1")?;
        connect(cx, port, own)?;
        moved.push(&cx.heap, member(global_of(&cx.heap), channel, "port2")?);
    }
    Ok(moved.to_js())
}

fn message_event<'a>(
    cx: Cx<'_, 'a>,
    data: JSValue,
    origin: JSValue,
    source: JSValue,
    ports: JSValue,
) -> Result<'a, &'a Event> {
    let (global, init) = (global_of(&cx.heap), cx.heap.create_empty_object().to_js());
    [("data", data), ("origin", origin), ("ports", ports)]
        .into_iter()
        .for_each(|(name, value)| init.put(global, name.as_bytes(), value));
    let event = construct_native(global, "MessageEvent", &[text(&cx.heap, "message"), init])?;
    event.put_non_enumerable(global, b"source", source);
    let event = twin_of_native_event(cx, event)?;
    event.trust();
    Ok(event)
}

/// For another window of the program.
pub(crate) fn seal<'a>(
    cx: Cx<'_, 'a>,
    message: JsLocal<'a>,
    transfer: Objects<'a>,
) -> Result<'a, JSValue> {
    let (global, list, options) = (
        global_of(&cx.heap),
        List::new(&cx.heap),
        cx.heap.create_empty_object().to_js(),
    );
    transfer
        .iter()
        .for_each(|it| list.push(&cx.heap, it.to_js()));
    options.put(global, b"transfer", list.to_js());
    let both = [list.to_js(), message.to_js()];
    let both = List::from_fn(&cx.heap, 2, |at| both[at as usize]).to_js();
    Ok(native(global, "structuredClone")?.call(global, JSValue::UNDEFINED, &[both, options])?)
}

pub(crate) fn unseal<'a>(
    cx: Cx<'_, 'a>,
    sealed: JSValue,
    origin: JSValue,
    source: JSValue,
) -> Result<'a, &'a Event> {
    let (sealed, ports) = (List::from_script(&cx.heap, sealed), List::new(&cx.heap));
    List::from_script(&cx.heap, sealed.get(0))
        .values()
        .filter(|it| Bun__DOM__isPortOfRuntime(*it))
        .for_each(|it| ports.push(&cx.heap, it));
    message_event(cx, sealed.get(1), origin, source, ports.to_js())
}

pub(crate) fn event_of<'a>(
    cx: Cx<'_, 'a>,
    message: Message,
    origin: &DomString,
    source: JSValue,
) -> Result<'a, &'a Event> {
    let ((data, endpoints), ports) = (message.open(cx.global())?, List::new(&cx.heap));
    endpoints
        .into_iter()
        .for_each(|it| ports.push(&cx.heap, MessagePort::new(&cx.heap, it).to_js()));
    let ports = all_to_program(cx, ports)?;
    let origin = origin.to_js(&cx.heap).to_js();
    message_event(cx, data, origin, source, ports)
}
