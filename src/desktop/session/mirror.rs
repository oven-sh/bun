//! The web engine has a session for each of the app's. The app's has the cookies, and decides.

use std::collections::BTreeMap;
use std::rc::Rc;

use bun_web::exec::{Either, race};
use bun_web::net::body::{Body, Chunk, pipe};
use bun_web::net::embedder::Outgoing;
use bun_web::net::response::{Answer, is_null_body_status};
use bun_web::net::{NetError, Result};
use bun_web::url::Url;

use super::Session;
use super::load::{all_at_once, from_pairs, from_record, latin1, or_failure, to_pairs};
use crate::prelude::*;
use crate::task::{self, Later, LocalFuture, Sender};
use crate::value::Value;
use crate::webview::engine::{self, Engine, Failure, Hold, Kind, Order, Target};
use crate::{files, paths, theme};

#[derive(Clone)]
pub(super) enum Setting {
    Call {
        method: &'static str,
        arguments: Value,
    },
    Handler {
        name: &'static str,
        is_set: bool,
        options: Value,
    },
    Preload(Value),
    Protocol {
        scheme: String,
        is_handled: bool,
    },
    WebRequest {
        event: &'static str,
        filter: Value,
    },
}

impl Setting {
    fn apply(self, engine: &Rc<Engine>, session: i32) -> Option<Later<()>> {
        let order = match self {
            Setting::Call { method, arguments } => {
                let (reply, engine) = (
                    engine.call(Target::Session(session), method, arguments, true),
                    Rc::clone(engine),
                );
                return Some(Later::of(async move {
                    // A page that loads without its proxy is worse than one that does not load.
                    if reply.await.is_err() && method == "setProxy" {
                        engine.close();
                    }
                }));
            }
            Setting::Preload(script) => {
                let path = readable(engine, script["filePath"].text());
                engine.tell(
                    Target::Session(session),
                    "registerPreloadScript",
                    list![script.with("filePath", path)],
                );
                return None;
            }
            Setting::Handler {
                name,
                is_set,
                options,
            } => {
                let is_sync = ["Permission", "USB"]
                    .iter()
                    .any(|it| crate::text::contains(name, it));
                Order::Handler {
                    session,
                    name,
                    is_set,
                    is_sync,
                    options,
                }
            }
            Setting::Protocol { scheme, is_handled } => Order::Protocol {
                session,
                scheme,
                is_handled,
            },
            Setting::WebRequest { event, filter } => Order::WebRequest {
                session,
                event,
                filter,
            },
        };
        engine.send(order);
        None
    }
}

#[derive(Default)]
pub(crate) struct Mirror {
    link: RefCell<Option<(Rc<Engine>, i32)>>,
    /// For an engine that starts later.
    settings: RefCell<Vec<(String, Setting)>>,
    stored: RefCell<Vec<Value>>,
    removed: RefCell<Vec<Value>>,
    pub(super) is_receiving: Cell<bool>,
    pub(super) extensions: RefCell<Vec<(Value, Hold)>>,
    pub(crate) workers: RefCell<Vec<i32>>,
    pub(crate) running_workers: RefCell<Value>,
}

impl Mirror {
    pub(super) fn linked(&self) -> Option<(Rc<Engine>, i32)> {
        self.link.borrow().clone()
    }

    pub(super) fn is_linked(&self) -> bool {
        self.link.borrow().is_some()
    }

    pub(crate) fn engine_closed(&self) {
        drop((
            self.link.take(),
            self.workers.take(),
            self.running_workers.take(),
            self.extensions.take(),
        ));
    }
}

/// A file in the executable is not there for another process.
pub(crate) fn readable(engine: &Engine, file: &str) -> String {
    if !["/$bunfs/", "B:/~BUN/", "B:\\~BUN\\"]
        .iter()
        .any(|it| file.starts_with(it))
    {
        return file.to_owned();
    }
    let copy = files::join(&[
        &engine.directory,
        &format!("{}.js", bun_wyhash::hash(file.as_bytes())),
    ]);
    task::report(
        files::read_with_node(file).and_then(|it| files::or_throw(files::write(&copy, &it, 0o600))),
    );
    copy
}

fn send_cookies() -> JsResult<()> {
    for Session { mirror, .. } in super::all() {
        let (stored, removed) = (mirror.stored.take(), mirror.removed.take());
        if let Some((engine, session)) =
            mirror.linked().filter(|_| stored.len() + removed.len() > 0)
        {
            engine.send(Order::Cookies {
                session,
                stored: Value::List(stored),
                removed: Value::List(removed),
            });
        }
    }
    Ok(())
}

/// A request that the engine makes for the app.
struct Load {
    engine: Rc<Engine>,
    id: i32,
    _hold: Hold,
}

impl Drop for Load {
    fn drop(&mut self) {
        self.engine.send(Order::Cancel(self.id));
    }
}

fn to_net_error(Failure { error, .. }: Failure) -> NetError {
    match error {
        Value::Error(parts) => {
            NetError::from_message(parts[1].text().as_bytes()).unwrap_or(NetError::Failed)
        }
        _ => NetError::Failed,
    }
}

/// A response that the app makes for the engine.
enum Serving {
    /// It is dropped to give up.
    Pending {
        _give_up: Sender<()>,
    },
    Body(Body),
}

state!(fn responses() -> RefCell<BTreeMap<i32, Serving>>);

type ForEngine = LocalFuture<'static, core::result::Result<Value, String>>;

async fn unless_aborted<T>(response: i32, work: impl Future<Output = T>) -> Option<T> {
    let (sender, aborted) = task::oneshot();
    responses()
        .borrow_mut()
        .insert(response, Serving::Pending { _give_up: sender });
    let Either::First(result) = race(work, aborted).await else {
        return None;
    };
    responses().borrow_mut().remove(&response);
    Some(result)
}

impl Session {
    pub(crate) fn mirror(&self) -> &Mirror {
        &self.mirror
    }

    pub(super) fn directory_of_engine(&self) -> JsResult<Option<String>> {
        let Some(own) = &self.storage_path else {
            return Ok(None);
        };
        let root = paths::path("sessionData")?;
        Ok(Some(match files::is_inside(own, &root) {
            true => files::join(&[&root, "Web Engine", "Others", &own[root.len()..]]),
            false => files::join(&[own, "Web Engine", "Session"]),
        }))
    }

    pub(super) fn forget(&self, key: &str) {
        self.mirror.settings.borrow_mut().retain(|it| it.0 != key);
    }

    pub(super) fn remember(&self, key: &str, setting: Setting) -> Option<Later<()>> {
        self.forget(key);
        self.mirror
            .settings
            .borrow_mut()
            .push((key.to_owned(), setting.clone()));
        self.mirror
            .linked()
            .and_then(|(engine, id)| setting.apply(&engine, id))
    }

    pub(super) fn remember_call(&self, method: &'static str, arguments: Value) {
        drop(self.remember(method, Setting::Call { method, arguments }));
    }

    pub(super) fn tell_engine(&self, method: &str, arguments: Value) {
        if let Some((engine, id)) = self.mirror.linked() {
            engine.tell(Target::Session(id), method, arguments);
        }
    }

    /// The engine, and what it knows the session by.
    pub(crate) fn link(&self) -> JsResult<(Rc<Engine>, i32)> {
        if let Some(linked) = self.mirror.linked() {
            return Ok(linked);
        }
        let (engine, directory) = (engine::start()?, self.directory_of_engine()?);
        let id = engine.new_id();
        engine.add_session(id, self);
        self.mirror.link.replace(Some((Rc::clone(&engine), id)));
        engine.send(theme::as_order()?);
        engine.send(Order::Session {
            id,
            directory,
            cookies: self.all_cookies(),
        });
        let settings = self.mirror.settings.borrow().clone();
        settings
            .into_iter()
            .for_each(|it| drop(it.1.apply(&engine, id)));
        Ok((engine, id))
    }

    pub(super) async fn perform(&self, method: &str, arguments: Value) -> JsResult<Value> {
        let (engine, id) = self.link()?;
        let _hold = engine.hold();
        let holds_up = ["clear", "close", "force"]
            .iter()
            .any(|it| method.starts_with(it));
        engine
            .call(Target::Session(id), method, arguments, holds_up)
            .await
            .map_err(|it| it.throw())
    }

    pub(super) fn mirror_cookie(&self, cookie: &Value, is_removed: bool) -> JsResult<()> {
        let Mirror {
            stored,
            removed,
            is_receiving,
            ..
        } = &*self.mirror;
        if !self.mirror.is_linked() || is_receiving.get() {
            return Ok(());
        }
        let is_first = stored.borrow().is_empty() && removed.borrow().is_empty();
        if is_removed {
            stored.borrow_mut().retain(|it| {
                ["name", "domain", "path"]
                    .iter()
                    .any(|name| !it[*name].is(cookie[*name].text()))
            });
        }
        if is_removed { removed } else { stored }
            .borrow_mut()
            .push(cookie.clone());
        // Before the promise of `cookies.set()` is seen to be fulfilled.
        if is_first {
            queue_microtask(send_cookies)
        } else {
            Ok(())
        }
    }

    /// Without cookies and redirects, through the network stack of the engine.
    pub(super) async fn send_by_engine(&self, request: Outgoing) -> Result<Answer> {
        let (engine, session) = or_failure(self.link())?;
        if engine.kind != Kind::Electron {
            return Err(NetError::Failed);
        }
        let (id, hold) = (engine.new_id(), engine.hold());
        let load = Load {
            engine,
            id,
            _hold: hold,
        };
        let body = match request.body {
            Some(body) => Value::buffer(&body.open().read_to_end().await?),
            None => Value::Undefined,
        };
        let request = record! {
            "url": string(request.url.href()),
            "method": string(&request.method),
            "headers": request.headers.sorted_and_combined().iter().map(|it| list![latin1(&it.0), latin1(&it.1)]).collect::<Value>(),
            "body": body,
        };
        let response = load
            .engine
            .request(|reply| Order::Load {
                reply,
                id,
                session,
                request,
            })
            .await
            .map_err(to_net_error)?;
        let (status, (writer, body)) = (response["status"].number() as u16, pipe(0));
        let has_body = response["hasBody"].is_truthy() && !is_null_body_status(status);
        task::spawn(async move {
            while has_body && writer.ready().await {
                match race(
                    load.engine.request(|reply| Order::Read { reply, id }),
                    writer.abandoned(),
                )
                .await
                {
                    Either::First(Ok(Value::Bytes(_, chunk))) => {
                        writer.write(Chunk::Owned(chunk.to_vec()))
                    }
                    Either::First(Err(failure)) => return writer.fail(to_net_error(failure)),
                    _ => break,
                }
            }
            writer.end(Ok(()));
        });
        Ok(Answer::new(
            status,
            response["statusText"].text().as_bytes(),
            from_pairs(&response["headers"]),
            body,
        ))
    }

    pub(crate) fn respond(&'static self, response: i32, request: &Value) -> ForEngine {
        let Some(url) = Url::parse(request["url"].text().as_bytes()) else {
            return Box::pin(async { Ok(Value::Undefined) });
        };
        let headers = &request["headers"];
        let outgoing = Outgoing {
            url,
            method: request["method"].text().as_bytes().into(),
            headers: if headers.is_list() {
                from_pairs(headers)
            } else {
                from_record(headers)
            },
            body: request["body"]
                .as_bytes()
                .map(|it| all_at_once(it.to_vec())),
        };
        let [origin, referrer] =
            ["initiatorOrigin", "referrer"].map(|it| request[it].as_text().map(str::to_owned));
        Box::pin(async move {
            let answer = unless_aborted(response, async {
                self.answer(outgoing, origin, referrer).await
            })
            .await;
            let Some(Ok(Answer {
                status,
                status_text,
                headers,
                body,
                ..
            })) = answer
            else {
                return Ok(Value::Undefined);
            };
            let has_body = !is_null_body_status(status);
            if has_body {
                responses()
                    .borrow_mut()
                    .insert(response, Serving::Body(body));
            }
            Ok(record! {
                "status": i32::from(status),
                "statusText": latin1(&status_text),
                "headers": to_pairs(&headers),
                "hasBody": has_body,
            })
        })
    }

    pub(crate) fn pull_response(response: i32) -> ForEngine {
        let serving = responses().borrow_mut().remove(&response);
        Box::pin(async move {
            let Some(Serving::Body(mut body)) = serving else {
                return Ok(Value::Undefined);
            };
            match unless_aborted(response, body.read()).await {
                Some(Ok(Some(chunk))) => {
                    responses()
                        .borrow_mut()
                        .insert(response, Serving::Body(body));
                    Ok(Value::Bytes(Some("Uint8Array".into()), (*chunk).into()))
                }
                Some(Err(error)) => Err(error.message().to_owned()),
                _ => Ok(Value::Undefined),
            }
        })
    }

    pub(crate) fn abort_response(response: i32) {
        let serving = responses().borrow_mut().remove(&response);
        drop(serving);
    }

    pub(crate) fn call_handler(&self, name: &str, arguments: JSValue) -> JsResult<JSValue> {
        let handler = self.handler(name)?.filter(|_| name.starts_with("set"));
        handler.map_or(Ok(JSValue::UNDEFINED), |it| {
            with_elements(arguments, |all| call(it, all))
        })
    }

    pub(crate) fn call_request_listener(
        &self,
        event: &str,
        details: &Value,
        callback: &Value,
    ) -> JsResult<()> {
        let Some(listener) = self.handler(event)?.filter(|_| event.starts_with("on")) else {
            callback.call(list![record! {}]);
            return Ok(());
        };
        let details = engine::to_js(details)?;
        let contents = get(details, "webContents")?;
        details.put(
            global(),
            b"webContentsId",
            if contents.is_object() {
                get(contents, "id")?
            } else {
                JSValue::UNDEFINED
            },
        );
        call(listener, &[details, engine::to_js(callback)?]).map(drop)
    }
}
