//! What the web engine tells the app and asks of it.

use std::rc::Rc;

use bun_ui::protocol::FramePixels;

use super::engine::{self, Engine, Order};
use super::frame::{self, RemoteFrame};
use super::remote::{Emitted, Remote, emit_all, is_prevented};
use super::view::show_pixels;
use super::wire;
use super::worker::ServiceWorker;
use crate::ipc::Sender;
use crate::ports::{self, MessagePortMain};
use crate::prelude::*;
use crate::session::Session;
use crate::session::download::DownloadItem;
use crate::task::{self, LocalFuture};
use crate::value::Value;

fn carry(engine: &Rc<Engine>, id: i32, port: JSValue) -> JsResult<()> {
    engine.add_object(id, port);
    let (sender, closer) = (Rc::clone(engine), Rc::clone(engine));
    let closed = procedure(move |_| {
        if closer.remove_object(id).is_some() {
            closer.send(Order::ClosePort(id));
        }
        Ok(())
    })?;
    let received = procedure(move |given| {
        let event = argument(given, 0);
        let (data, ports) = (
            engine::from_js(get(event, "data")?)?,
            engine::from_js(get(event, "ports")?)?,
        );
        sender.send(Order::Port { id, data, ports });
        Ok(())
    })?;
    invoke(port, "on", &[js("message")?, received])?;
    invoke(port, "on", &[js("close")?, closed])?;
    invoke(port, "start", &[]).map(drop)
}

/// `wire::Name`
pub(super) fn name(value: JSValue) -> JsResult<Option<Vec<Value>>> {
    if let Some(frame) = cast::<RemoteFrame>(value) {
        return Ok(Some(vec!["frame".into(), frame.id.into()]));
    }
    if value.is::<NativeImage>() {
        let png = NativeImage::with(global(), value, |it| it.png(global()))?;
        return Ok(Some(vec!["image".into(), Value::buffer(&png)]));
    }
    let (true, Some(engine)) = (cast::<MessagePortMain>(value).is_some(), engine::running()) else {
        return Ok(None);
    };
    let id = engine.new_id();
    carry(
        &engine,
        id,
        ports::move_all(array(&[value])?)?.get_index(global(), 0)?,
    )?;
    Ok(Some(vec!["port".into(), id.into()]))
}

/// `wire::Find`
pub(super) fn find(handle: &[Value]) -> JsResult<JSValue> {
    let [kind, rest @ ..] = handle else {
        return Ok(JSValue::UNDEFINED);
    };
    match (kind.text(), rest, engine::running()) {
        ("data", [bytes], _) => {
            wire::decode_whole(bytes).map_or(Ok(JSValue::UNDEFINED), |it| js(&it))
        }
        ("image", [Value::Bytes(_, png), area @ ..], _) => {
            let image = NativeImage::from_bytes(png.to_vec());
            let image = match area {
                [x, y, width, height] => {
                    image.cropped(global(), [x, y, width, height].map(Value::number))?
                }
                _ => image,
            };
            Ok(image.to_js(global()))
        }
        ("view", [id], Some(engine)) => Ok(engine
            .view(id.int())
            .map_or(JSValue::NULL, Remote::contents)),
        ("frame", [about], Some(engine)) => Ok(frame::update(&engine, about)),
        ("session", [id], Some(engine)) => Ok(engine
            .session(id.int())
            .map_or(JSValue::NULL, JsInterface::to_js)),
        ("worker", rest, Some(engine)) => Ok(rest
            .try_into()
            .map_or(JSValue::NULL, |it| ServiceWorker::find(&engine, it))),
        ("download", [id, state], Some(engine)) => Ok(DownloadItem::find(&engine, id.int(), state)),
        ("port", [id], Some(engine)) => {
            let [carried, given] = ports::pair();
            carry(&engine, id.int(), carried)?;
            Ok(given)
        }
        _ => Ok(JSValue::UNDEFINED),
    }
}

pub(super) fn engine_closed(object: JSValue) -> JsResult<()> {
    match cast::<DownloadItem>(object) {
        Some(download) => download.engine_closed(),
        None if cast::<MessagePortMain>(object).is_some() => invoke(object, "close", &[]).map(drop),
        None => Ok(()),
    }
}

/// Returns whether the default was prevented, and what has to be done before the engine goes on.
fn emit_event(engine: &Engine, kind: &str, id: i32, emitted: Emitted) -> JsResult<Value> {
    let collects = [
        "will-download",
        "select-",
        "login",
        "certificate-",
        "file-system-",
    ];
    engine.collected.replace(
        collects
            .iter()
            .any(|it| emitted.name.starts_with(it))
            .then(Vec::new),
    );
    let result = match (kind, engine.view(id), engine.session(id)) {
        ("view", Some(view), _) => view.emit(emitted),
        (kind, _, Some(session)) => emitted.with(|name, event, arguments| {
            let emitter = if kind == "session" {
                session.to_js()
            } else {
                get(session.to_js(), kind)?
            };
            emit_all(
                emitter,
                name,
                event.map(JsInterface::to_js).as_slice(),
                arguments,
            )?;
            if name == "will-download"
                && !is_prevented(event)?
                && let Some(item) = cast::<DownloadItem>(arguments.get_index(global(), 0)?)
            {
                item.ask_where_to_save(session, arguments.get_index(global(), 1)?)?;
            }
            is_prevented(event)
        }),
        _ => Ok(false),
    };
    let calls = Value::List(engine.collected.take().unwrap_or_default());
    Ok(record! { "isPrevented": result?, "calls": calls })
}

/// What a listener that throws was asked about does not happen.
pub(super) fn emit_on_view(engine: &Engine, id: i32, emitted: Emitted) -> bool {
    emit_event(engine, "view", id, emitted).map_or_else(
        |it| (task::report(Err(it)), true).1,
        |it| it["isPrevented"].is_truthy(),
    )
}

fn event(
    engine: &Engine,
    [kind, id, name, details, arguments]: &mut [Value; 5],
) -> JsResult<Value> {
    let (details, arguments) = (
        core::mem::take(details),
        core::mem::take(arguments).into_items(),
    );
    emit_event(
        engine,
        kind.text(),
        id.int(),
        Emitted {
            name: name.text().into(),
            details,
            arguments,
        },
    )
}

fn sender(engine: &Engine, view: &Value, frame: &Value) -> JsResult<Sender> {
    let (view, frame) = (engine.view(view.int()), engine::to_js(frame)?);
    match view.filter(|_| frame.is_object()) {
        Some(view) => Sender::new(view.contents(), frame),
        None => Err(error(format_args!("Object has been destroyed"))),
    }
}

fn list_of(values: &Value) -> JsResult<JSValue> {
    let values = engine::to_js(values)?;
    if values.is_array() {
        Ok(values)
    } else {
        array(&[])
    }
}

fn cursor_named(kind: &str) -> &str {
    match kind {
        "pointer" | "custom" => "default",
        "hand" => "pointer",
        "nodrop" | "drag-drop-none" => "no-drop",
        other => other,
    }
}

pub(super) fn paint(engine: &Engine, id: i32, pixels: FramePixels) -> JsResult<()> {
    let result = match engine.view(id) {
        Some(remote) => remote.view.paint(pixels),
        None => show_pixels(0, 1., pixels),
    };
    engine.send(Order::Painted(id));
    result
}

fn is_of_stand_in(engine: &Engine, request: &Value) -> bool {
    let Value::Handle(contents) = &request["webContents"] else {
        return false;
    };
    let view = contents.get(1).and_then(|it| engine.view(it.int()));
    request["url"].text().starts_with("data:") && view.is_some_and(Remote::stands_in)
}

/// `message` has the name and at least five arguments.
pub(super) fn take(engine: &Rc<Engine>, message: &mut [Value]) -> JsResult<()> {
    let [name, arguments @ ..] = message else {
        return Ok(());
    };
    let Some(arguments) = arguments.first_chunk_mut::<5>() else {
        return Ok(());
    };
    if name.is("event") {
        return event(engine, arguments).map(drop);
    }
    let [a, b, c, d, e] = arguments;
    let id = a.int();
    let with_view =
        |then: &mut dyn FnMut(&Remote) -> JsResult<()>| engine.view(id).map_or(Ok(()), then);
    let with_session =
        |then: &dyn Fn(&Session) -> JsResult<()>| engine.session(id).map_or(Ok(()), then);
    match name.text() {
        "abort" => {
            Session::abort_response(id);
            Ok(())
        }
        "cancelDialogs" => with_view(&mut Remote::cancel_dialogs),
        "cookie" => with_session(&|it| it.receive_cookie(b, c.text(), d.is_truthy())),
        "created" => with_view(&mut |it| {
            it.view.target_id.set(Some(b.text().into()));
            Ok(())
        }),
        "cursor" => with_view(&mut |it| {
            it.view.show_cursor(cursor_named(b.text()));
            Ok(())
        }),
        "destroyed" => with_view(&mut Remote::destroyed),
        "dialog" => with_view(&mut |it| it.show_dialog(b, c.clone())),
        "download" => cast::<DownloadItem>(engine::to_js(a)?)
            .map_or(Ok(()), |it| it.changed(b.text(), c.text())),
        "frame" => with_view(&mut |it| it.receive(b)),
        "handler" => with_session(&|it| it.call_handler(b.text(), list_of(c)?).map(drop)),
        "ipc" if engine.view(id).is_some_and(|it| !it.stands_in()) => {
            let (sender, channel, values, ports) = (
                sender(engine, a, b)?,
                js(&*c)?,
                list_of(d)?,
                engine::to_js(e)?,
            );
            match ports.is_array() {
                true => sender.send_without_event(channel, values, ports),
                false => sender.send(channel, values, None),
            }
        }
        "ipcFromWorker" => cast::<ServiceWorker>(engine::to_js(a)?).map_or(Ok(()), |it| {
            it.receive(js(&*b)?, list_of(c)?, engine::to_js(d)?)
        }),
        "paint" => {
            let [width, height, x, y, w, h] =
                ["width", "height", "x", "y", "w", "h"].map(|it| b[it].number() as u32);
            let is_in_channel = b["isSent"].is_truthy();
            paint(
                engine,
                id,
                FramePixels::Raw {
                    size: [width, height],
                    area: [x, y, w, h],
                    is_in_channel,
                },
            )
        }
        "port" => engine.object(id).map_or(Ok(()), |port| {
            invoke(port, "postMessage", &[engine::to_js(b)?, engine::to_js(c)?]).map(drop)
        }),
        "portClosed" => engine.remove_object(id).map_or(Ok(()), engine_closed),
        "state" => with_view(&mut |it| it.update(core::mem::take(b))),
        "webRequest" if is_of_stand_in(engine, c) => match engine::to_js(d)? {
            answer if answer.is_callable() => call(answer, &[object!({})]).map(drop),
            _ => Ok(()),
        },
        "webRequest" => with_session(&|it| it.call_request_listener(b.text(), c, d)),
        "workers" => with_session(&|it| {
            let (workers, mirror) = (list_of(c)?, it.mirror());
            let before = mirror.workers.replace(Vec::new());
            for worker in instances::<ServiceWorker>(workers) {
                worker.map(|it| (it.session.set(id), mirror.workers.borrow_mut().push(it.id)))?;
            }
            for gone in before
                .into_iter()
                .filter(|it| !mirror.workers.borrow().contains(it))
            {
                engine.remove_object(gone);
            }
            mirror.running_workers.replace(b.clone());
            Ok(())
        }),
        _ => Ok(()),
    }
}

/// The engine is blocked meanwhile.
pub(super) fn answer(engine: &Rc<Engine>, message: &mut [Value]) -> Value {
    let [name, arguments @ ..] = message else {
        return Value::Undefined;
    };
    let Some(arguments) = arguments.first_chunk_mut::<5>() else {
        return Value::Undefined;
    };
    let (result, otherwise) = match (name.text(), arguments) {
        ("event", arguments) => (
            event(engine, arguments),
            record! { "isPrevented": true, "calls": list![] },
        ),
        ("open", [id, b, ..]) => (
            engine
                .view(id.int())
                .map_or(Ok(Value::Undefined), |it| it.open(b)),
            Value::Undefined,
        ),
        (_, [id, b, c, ..]) => {
            engine.collected.replace(Some(Vec::new()));
            let call = |it: &Session| {
                let returned = it.call_handler(b.text(), list_of(c)?)?;
                match b.text().ends_with("RequestHandler") {
                    true => Ok(Value::Undefined),
                    false => engine::from_js(returned),
                }
            };
            let result = engine.session(id.int()).map_or(Ok(Value::Undefined), call);
            let calls = Value::List(engine.collected.take().unwrap_or_default());
            (
                result.map(|it| record! { "result": it, "calls": calls }),
                record! { "calls": list![] },
            )
        }
    };
    result.unwrap_or_else(|it| (task::report(Err(it)), otherwise).1)
}

fn describe(thrown: JSValue) -> String {
    catch(text_of(thrown))
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}

pub(super) fn answer_later(
    engine: &Rc<Engine>,
    message: &[Value],
) -> LocalFuture<'static, Result<Value, String>> {
    let [name, a, b, c, d, ..] = message else {
        return Box::pin(async { Ok(Value::Undefined) });
    };
    match (name.text(), engine.session(a.int())) {
        ("fetch", Some(session)) => return session.respond(c.int(), d),
        ("pull", _) => return Session::pull_response(a.int()),
        _ => {}
    }
    let start = || match name.text() {
        _ if engine.view(a.int()).is_some_and(Remote::stands_in) => Ok(JSValue::UNDEFINED),
        "invoke" => sender(engine, a, b)?.invoke(js(c)?, list_of(d)?),
        "invokeFromWorker" => cast::<ServiceWorker>(engine::to_js(a)?)
            .map_or(Ok(JSValue::UNDEFINED), |it| it.handle(js(b)?, list_of(c)?)),
        "ipcSync" => {
            let (sender, answer) = (sender(engine, a, b)?, Deferred::new());
            let (event, promise) = (sender.event(true), answer.promise());
            event.on_answer(procedure(move |it| answer.resolve(argument(it, 0)))?);
            sender
                .dispatch(Some("ipc-message-sync"), event, js(c)?, list_of(d)?)
                .map(|()| promise)
        }
        _ => Ok(JSValue::UNDEFINED),
    };
    let outcome = task::outcome(start());
    Box::pin(async {
        let value = outcome.await.map_err(|it| describe(it.get()))?;
        match catch(engine::from_js(value.get())) {
            Ok(converted) => converted.map_err(describe),
            Err(_) => Err("The script was terminated".to_owned()),
        }
    })
}
