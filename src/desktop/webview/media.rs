//! The page of the web engine that has the microphone, the speakers and the decoders. See `src/dom/api/media/link.rs`.

use std::rc::Rc;

use bun_web::channel::Serialized;
use bun_web::media::{Connection, Listener};

use super::engine::{self, Engine, Failure, Hold, Kind, Order, Target};
use super::wire;
use crate::generated_bindgen::electron::ElectronDesktopCapturer;
use crate::prelude::*;
use crate::task::{self, Later, Sequence};
use crate::value::quote;

struct Host {
    engine: Rc<Engine>,
    listeners: RefCell<Vec<(u32, Listener)>>,
    session: Later<Option<Rc<str>>>,
    commands: Sequence,
}

#[derive(Default)]
struct State {
    running: RefCell<Option<Rc<Host>>>,
    last_client: Cell<u32>,
}

state!(fn state() -> State);

impl Host {
    fn start() -> JsResult<Rc<Host>> {
        let script = engine::sources()?.0 + include_str!("media.js");
        let host = Rc::new(Host {
            engine: engine::start()?,
            listeners: Default::default(),
            session: Default::default(),
            commands: Default::default(),
        });
        state().running.replace(Some(Rc::clone(&host)));
        let it = Rc::clone(&host);
        task::spawn(async move {
            let session = Rc::clone(&it).open(script).await.ok();
            if session.is_none() {
                it.close();
            }
            it.session.set(session);
        });
        Ok(host)
    }

    async fn open(self: Rc<Self>, script: String) -> Result<Rc<str>, Failure> {
        let engine = Rc::clone(&self.engine);
        let target = engine.request(|reply| Order::Media { reply }).await?;
        let session = engine.attach(target.text()).await?;
        engine.listen(
            &session,
            Rc::new(move |method, params| match method {
                "Inspector.targetCrashed" => {
                    self.close();
                    Ok(())
                }
                "Runtime.bindingCalled" => {
                    self.receive(params["payload"].text());
                    Ok(())
                }
                _ => Ok(()),
            }),
        );
        for (method, params) in [
            ("Inspector.enable", record! {}),
            ("Runtime.enable", record! {}),
            ("Runtime.addBinding", record! { "name": "send" }),
            ("Runtime.evaluate", record! { "expression": script }),
        ] {
            engine.inspect(method, params, &session).await?;
        }
        Ok(session)
    }

    fn receive(&self, payload: &str) {
        let (client, line) = crate::text::split_once(payload, " ").unwrap_or_default();
        let listener = self
            .listeners
            .borrow()
            .iter()
            .find(|it| client.parse() == Ok(it.0))
            .map(|it| Rc::clone(&it.1));
        if let Some(listener) = listener {
            listener(Some(line.as_bytes()));
        }
    }

    fn evaluate(self: &Rc<Self>, expression: String) {
        let host = Rc::clone(self);
        self.commands.add(async move {
            if let Some(session) = host.session.clone().await {
                let params = record! { "expression": expression, "userGesture": true };
                host.engine.command("Runtime.evaluate", params, &session);
            }
        });
    }

    fn close(&self) {
        if state()
            .running
            .borrow()
            .as_ref()
            .is_some_and(|it| same(&**it, self))
        {
            engine_closed();
        }
    }
}

pub(super) fn engine_closed() {
    let listeners = state().running.take().map(|it| it.listeners.take());
    for (_, listener) in listeners.into_iter().flatten() {
        listener(None);
    }
}

struct Link {
    id: u32,
    host: Rc<Host>,
    _hold: Hold,
}

impl Link {
    fn new(listener: &Listener) -> JsResult<Option<Link>> {
        if !engine::is_available()? {
            return Ok(None);
        }
        let running = state().running.borrow().clone();
        let host = running.map_or_else(Host::start, Ok)?;
        state().last_client.update(|it| it + 1);
        let (id, _hold) = (state().last_client.get(), host.engine.hold());
        host.listeners.borrow_mut().push((id, Rc::clone(listener)));
        Ok(Some(Link { id, host, _hold }))
    }
}

struct MaybeLink(Option<Link>);

impl Connection for MaybeLink {
    fn send(&self, commands: &[u8], [may_list, may_capture]: [bool; 2]) {
        if let Some(Link { id, host, .. }) = &self.0 {
            host.evaluate(format!(
                "receive({id},JSON.parse({}),{may_list},{may_capture})",
                quote(&string(commands))
            ));
        }
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        let Link { id, host, .. } = self;
        host.listeners.borrow_mut().retain(|it| it.0 != *id);
        host.evaluate(format!("leave({id})"));
    }
}

#[unsafe(no_mangle)]
fn __bun_desktop_connect_media(listener: &Listener) -> Box<dyn Connection> {
    let link = Link::new(listener).map_err(|it| task::report(Err(it)));
    let link = link.ok().flatten();
    if link.is_none() {
        listener(None);
    }
    Box::new(MaybeLink(link))
}

fn unless_thrown<T>(result: JsResult<T>) -> Option<T> {
    result.map_err(|it| global().take_error(it)).ok()
}

#[unsafe(no_mangle)]
fn __bun_desktop_encode_for_media(value: &Serialized) -> Option<Vec<u8>> {
    let check = |it: JSValue| {
        let is_shared = it.as_array_buffer(global()).is_some_and(|it| it.shared);
        if is_shared || it.get_class_info_name() == Some(b"WebAssembly.Module") {
            return Err(error(format_args!("It cannot leave the process.")));
        }
        Ok(None)
    };
    let value = value.deserialize(global(), &[]);
    unless_thrown(value.and_then(|it| wire::from_js(it, &check))).map(|it| wire::encode(&it))
}

#[unsafe(no_mangle)]
fn __bun_desktop_decode_from_media(bytes: &[u8]) -> Option<Serialized> {
    let value = wire::to_js(&wire::decode(bytes.get(4..)?)?, &|_| Ok(JSValue::UNDEFINED));
    unless_thrown(value.and_then(|it| Serialized::new(global(), it, &[], &[])))
}

impl ElectronDesktopCapturer {
    pub(crate) fn get_sources<'a>(_: Cx<'a, '_>, options: JsLocal<'a>) -> JsResult<JSValue> {
        let options = wire::data_from_js(options.to_js())?;
        if !options["types"].is_list() {
            return Err(error(format_args!("Invalid options")));
        }
        let engine = engine::start()?;
        if engine.kind != Kind::Electron {
            return Err(unsupported("desktopCapturer"));
        }
        let (hold, capturer) = (engine.hold(), Target::Module("desktopCapturer"));
        let sources = engine.perform(capturer, "getSources", list![options]);
        Ok(task::busy_promise(async {
            let _hold = hold;
            engine::to_js(&sources.await.map_err(|it| it.throw())?)
        }))
    }
}
