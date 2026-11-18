//! A page in the web engine.

use std::rc::{Rc, Weak};

use super::connection::Connection;
use super::{Emit, Failure, Outcome, Reply, Session};
use crate::prelude::*;
use crate::value::Value;
use crate::webview::remote::Remote;

/// The client knows the frame `theirs` as `ours`.
pub(super) struct EngineSession {
    connection: Weak<Connection>,
    remote: Root<Remote>,
    pub(super) id: Rc<str>,
    theirs: Rc<str>,
    ours: Rc<str>,
    pub(super) emit: RefCell<Emit>,
    is_frame: bool,
    children: RefCell<Vec<Rc<EngineSession>>>,
    /// The frame in which the engine has an `<iframe>` of the app, whose parent is `theirs`.
    pub(super) inner: RefCell<Option<Rc<str>>>,
    pub(super) swapped_back: RefCell<Option<Box<dyn FnOnce()>>>,
    has_swapped_back: Cell<bool>,
}

fn rename(value: &mut Value, from: &str, to: &str) {
    match value {
        Value::Text(it) if crate::text::contains(it, from) => {
            *it = (crate::text::split(it, from).collect::<Vec<_>>().join(to)).into();
        }
        Value::List(items) => items.iter_mut().for_each(|it| rename(it, from, to)),
        Value::Record(members) => members.iter_mut().for_each(|(name, it)| {
            rename(name, from, to);
            rename(it, from, to);
        }),
        _ => {}
    }
}

impl EngineSession {
    fn new(
        connection: Weak<Connection>,
        remote: &Remote,
        [id, theirs, ours]: [Rc<str>; 3],
        emit: Emit,
        is_frame: bool,
    ) -> Rc<EngineSession> {
        let session = Rc::new(EngineSession {
            connection,
            remote: Root::new(remote),
            id,
            theirs,
            ours,
            emit: emit.into(),
            is_frame,
            children: RefCell::default(),
            inner: RefCell::default(),
            swapped_back: RefCell::default(),
            has_swapped_back: Cell::default(),
        });
        let receiver = Rc::clone(&session);
        let receive = move |method: &str, params: &Value| {
            receiver.receive(method, params);
            Ok(())
        };
        remote.engine().listen(&session.id, Rc::new(receive));
        session
    }

    pub(super) async fn attach(
        connection: Weak<Connection>,
        remote: Root<Remote>,
        ours: Rc<str>,
        emit: Emit,
        is_frame: bool,
    ) -> Result<Rc<EngineSession>, Failure> {
        let [id, theirs] = (remote.get().start_session().await).ok_or("No target available")?;
        let ids = [id, theirs, ours];
        Ok(Self::new(connection, remote.get(), ids, emit, is_frame))
    }

    pub(super) async fn inspect(&self, method: &str, params: Value) -> Outcome {
        let reply = self.remote.get().engine().inspect(method, params, &self.id);
        reply.await.map_err(|it| it.throw().into())
    }

    fn emit(&self, method: &str, params: Value) {
        let emit = Rc::clone(&self.emit.borrow());
        emit(method, params);
    }

    fn receive(&self, method: &str, params: &Value) {
        let (inner, session) = (self.inner.borrow().clone(), params["sessionId"].text());
        if method == "Target.attachedToTarget" {
            let Some(connection) = self.connection.upgrade() else {
                return;
            };
            let child = Self::new(
                Weak::clone(&self.connection),
                self.remote.get(),
                [
                    session.into(),
                    Rc::clone(&self.theirs),
                    Rc::clone(&self.ours),
                ],
                connection.emitter(Some(session.into())),
                params["targetInfo"]["type"].is("iframe"),
            );
            self.children.borrow_mut().push(Rc::clone(&child));
            connection.add(session.into(), child);
        } else if method == "Target.detachedFromTarget" {
            let mut children = self.children.borrow_mut();
            let gone: Vec<_> = children.extract_if(.., |it| *it.id == *session).collect();
            drop(children);
            gone.iter().for_each(|it| it.close());
            if inner.is_some_and(|it| params["targetId"].is(&it)) {
                self.has_swapped_back.set(true);
            }
        } else if let Some(inner) = inner {
            let frame = [
                &params["frameId"],
                &params["frame"]["id"],
                &params["context"]["auxData"]["frameId"],
            ];
            let frame = frame.into_iter().find(|it| !it.is_nothing());
            if frame.is_some_and(|it| it.is(&self.theirs))
                || (params["frameId"].is(&inner)
                    && matches!(method, "Page.frameAttached" | "Page.frameDetached"))
            {
                return;
            }
        }
        let mut params = params.clone();
        rename(&mut params, &self.theirs, &self.ours);
        self.emit(method, params);
    }

    pub(super) fn announce(&self, tree: &Value, is_root: bool) {
        let frame = &tree["frame"];
        if !is_root {
            let params = record! { "frameId": &frame["id"], "parentFrameId": &frame["parentId"] };
            self.emit("Page.frameAttached", params);
        }
        let params = record! { "frame": frame, "type": "Navigation" };
        self.emit("Page.frameNavigated", params);
        (tree["childFrames"].items().iter()).for_each(|it| self.announce(it, false));
    }

    fn answered(&self, method: &str, mut result: Value) -> Value {
        rename(&mut result, &self.theirs, &self.ours);
        if method == "Page.getFrameTree" && self.is_frame {
            if self.inner.borrow().is_some() {
                let inner = result["frameTree"]["childFrames"][0].clone();
                result.set("frameTree", inner);
            }
            if result["frameTree"].is_truthy() {
                self.announce(&result["frameTree"], true);
            }
        }
        if self.has_swapped_back.get()
            && method == "Page.enable"
            && let Some(swapped_back) = self.swapped_back.take()
        {
            later::soon(|_| {
                swapped_back();
                Ok(())
            });
        }
        result
    }
}

impl Session for EngineSession {
    fn handle(self: Rc<Self>, method: &str, mut params: Value, reply: Reply) {
        rename(&mut params, &self.ours, &self.theirs);
        let (remote, id, name) = (self.remote.get(), Rc::clone(&self.id), method.to_owned());
        let then = move |result: crate::webview::engine::Reply| {
            let result = result.map_err(|it| it.throw().into());
            reply(result.map(|it| self.answered(&name, it)));
        };
        remote.wake();
        (remote.engine()).inspect_in_order(method, params, &id, Box::new(then));
    }

    fn reveal(self: Rc<Self>, [x, y]: [f64; 2]) {
        crate::task::spawn(async move {
            let point = record! { "x": x.round(), "y": y.round() };
            if let Ok(found) = self.inspect("DOM.getNodeForLocation", point).await {
                let node = found.pick(&["backendNodeId"]);
                self.emit("Overlay.inspectNodeRequested", node);
            }
        });
    }

    fn close(&self) {
        self.children.take().iter().for_each(|it| it.close());
        self.swapped_back.take();
        if let Some(connection) = self.connection.upgrade() {
            connection.remove(&self.id);
        }
        let (engine, params) = (
            self.remote.get().engine(),
            record! { "sessionId": &*self.id },
        );
        engine.ignore(&self.id);
        engine.command("Target.detachFromTarget", params, "");
    }
}
