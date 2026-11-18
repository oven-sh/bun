//! `--remote-debugging-port`

use std::rc::Rc;

use bun_removable_features::{Feature, is_removed};
use bun_web::headers::HeaderList;
use bun_web::runtime::create_response;
use bun_web::url::Url;

use super::connection::{Client, Connection, product, targets, user_agent};
use super::contents::{self, Contents};
use super::{TRIMMED, random_id};
use crate::prelude::*;
use crate::value::Value;
use crate::{dialog, files, paths, realm, task};

state!(fn connections() -> RefCell<Vec<(u32, Rc<Connection>)>>);
state!(fn last_connection() -> Cell<u32>);

fn empty(status: u16) -> JsResult<JSValue> {
    create_response(global(), status, b"", &HeaderList::default(), JSValue::NULL)
}

fn json(value: &Value) -> JsResult<JSValue> {
    let headers = [("content-type", "application/json;charset=utf-8")];
    let headers = headers.into_iter().collect();
    create_response(global(), 200, b"", &headers, js(value.to_json())?)
}

fn serve(request: JSValue, server: JSValue, browser_path: &str) -> JsResult<JSValue> {
    let url = Url::parse(text_of(get(request, "url")?)?.as_bytes());
    let has_origin = invoke(get(request, "headers")?, "has", &[js("origin")?])?.to_boolean();
    // Web pages can reach this port, by its address or by a name that resolves to it.
    let Some(url) =
        url.filter(|it| !has_origin && matches!(it.hostname(), b"localhost" | b"127.0.0.1"))
    else {
        return empty(403);
    };
    let (host, path) = (string(url.host()), string(url.path()));
    let route = path.strip_suffix('/').unwrap_or(&path);
    match route {
        "/json/version" => {
            return json(&record! {
                "Browser": product()?,
                "Protocol-Version": "1.3",
                "User-Agent": user_agent()?,
                "webSocketDebuggerUrl": format!("ws://{host}{browser_path}"),
            });
        }
        "/json" | "/json/list" => {
            let describe = |it: Value| {
                let id = it["targetId"].text();
                it.pick(&["type", "title", "url"]).and(&record! {
                    "id": id,
                    "description": "",
                    "webSocketDebuggerUrl": format!("ws://{host}/devtools/page/{id}"),
                })
            };
            return json(&targets()?.into_iter().map(describe).collect());
        }
        _ => {}
    }
    let target = route.strip_prefix("/devtools/page/");
    let target = target.and_then(contents::with_target_id);
    if target.is_some() || route == browser_path {
        last_connection().update(|it| it + 1);
        let target = target.map_or(JSValue::UNDEFINED, |it| it.object());
        let data = object!({ "id": last_connection().get(), "target": target });
        if invoke(server, "upgrade", &[request, object!({ "data": data })])?.to_boolean() {
            return Ok(JSValue::UNDEFINED);
        }
    }
    empty(404)
}

fn id_of(socket: JSValue) -> JsResult<u32> {
    Ok(get(get(socket, "data")?, "id")?.to_u32())
}

fn opened(arguments: &[JSValue]) -> JsResult<()> {
    let socket = argument(arguments, 0);
    let target = cast(get(get(socket, "data")?, "target")?);
    let target = target.map(Contents::new);
    if let Some(target) = &target {
        let close = function(socket, |socket, _| invoke(socket, "close", &[]))?;
        target.invoke("once", &[js("destroyed")?, close])?;
    }
    let kept = keep(socket);
    let send = move |json: String| {
        task::report(js(json).and_then(|it| invoke(kept.get(), "send", &[it]).map(drop)));
    };
    let connection = Connection::new(Box::new(send), Client::Program, target)?;
    let id = id_of(socket)?;
    connections().borrow_mut().push((id, connection));
    Ok(())
}

fn received(arguments: &[JSValue]) -> JsResult<()> {
    let id = id_of(argument(arguments, 0))?;
    let found =
        (connections().borrow().iter()).find_map(|it| (it.0 == id).then(|| Rc::clone(&it.1)));
    if let Some(connection) = found {
        connection.receive(&argument(arguments, 1).to_utf8(global())?);
    }
    Ok(())
}

fn closed(arguments: &[JSValue]) -> JsResult<()> {
    let id = id_of(argument(arguments, 0))?;
    let found = (connections().borrow_mut().extract_if(.., |it| it.0 == id)).last();
    found.map_or(Ok(()), |it| it.1.close())
}

/// The app starts all the same.
pub(crate) fn listen(port: u16) -> JsResult<()> {
    if is_removed(Feature::Inspector) {
        return warn(TRIMMED);
    }
    catch(start(port))?.or_else(|thrown| {
        let reason = message_of(thrown)?;
        warn(&format!("--remote-debugging-port has failed: {reason}"))
    })
}

fn start(port: u16) -> JsResult<()> {
    let browser_path = format!("/devtools/browser/{}", random_id());
    let path = browser_path.clone();
    let fetch = function(JSValue::UNDEFINED, move |_, arguments| {
        serve(argument(arguments, 0), argument(arguments, 1), &path)
    })?;
    let options = object!({
        "hostname": "127.0.0.1",
        "port": u32::from(port),
        "fetch": fetch,
        "websocket": object!({
            "maxPayloadLength": 1u32 << 28,
            "backpressureLimit": 1u32 << 28,
            "idleTimeout": 0,
            "open": procedure(opened)?,
            "message": procedure(received)?,
            "close": procedure(closed)?,
        }),
    });
    let server = invoke(realm::native(global(), "Bun")?, "serve", &[options])?;
    invoke(server, "unref", &[])?;
    let (port, directory) = (get(server, "port")?.to_u32(), paths::path("userData")?);
    files::or_throw(files::make_directory(&directory, 0o777))?;
    files::or_throw(files::write(
        &files::join(&[&directory, "DevToolsActivePort"]),
        format!("{port}\n{browser_path}").as_bytes(),
        0o666,
    ))?;
    dialog::print_error(&format!(
        "\nDevTools listening on ws://127.0.0.1:{port}{browser_path}"
    ));
    Ok(())
}
