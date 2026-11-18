//! `webContents.debugger`, for a page in the web engine.

use std::rc::Rc;

use super::engine;
use super::view::View;
use crate::generated_bindgen::webview::js_ElectronRemoteDebugger as debuggers;
use crate::prelude::*;
use crate::task::{self, Later};

pub(crate) struct Debugger {
    view: Rc<View>,
    root: RefCell<Option<Later<Option<Rc<str>>>>>,
    sessions: RefCell<Vec<Rc<str>>>,
}

impl Debugger {
    pub(super) fn create(view: Rc<View>) -> &'static Debugger {
        debuggers::create(
            heap(),
            Debugger {
                view,
                root: None.into(),
                sessions: Default::default(),
            },
        )
    }

    fn listen(&self, session: &Rc<str>, is_root: bool) {
        self.sessions.borrow_mut().push(Rc::clone(session));
        let (debugger, named) = (
            Root::new(self),
            if is_root {
                "".into()
            } else {
                Rc::clone(session)
            },
        );
        let listener = move |method: &str, params: &crate::value::Value| {
            let (it, child) = (debugger.get(), params["sessionId"].text());
            if method == "Target.attachedToTarget" {
                it.listen(&child.into(), false);
            } else if method == "Target.detachedFromTarget" && it.has(child) {
                it.sessions.borrow_mut().retain(|it| **it != *child);
                it.view.engine.ignore(child);
            }
            announce(
                it.to_js(),
                "message",
                &[js(method)?, js(params)?, js(&*named)?],
            )
        };
        self.view.engine.listen(session, Rc::new(listener));
    }

    fn has(&self, session: &str) -> bool {
        self.sessions.borrow().iter().any(|it| **it == *session)
    }

    pub(crate) fn attach(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if self.is_attached() {
            return Err(error(format_args!(
                "Debugger is already attached to the target"
            )));
        }
        let (debugger, view, root) = (Root::new(self), Rc::clone(&self.view), Later::default());
        self.root.replace(Some(root.clone()));
        task::spawn(async move {
            let session = view.attach().await;
            let it = debugger.get();
            if it.root.borrow().as_ref().is_some_and(|it| it.is(&root)) {
                match &session {
                    Some(session) => it.listen(session, true),
                    None => task::report(it.end()),
                }
            }
            root.set(session);
        });
        Ok(())
    }

    pub(crate) fn is_attached(&self) -> bool {
        self.root.borrow().is_some()
    }

    pub(super) fn end(&self) -> JsResult<()> {
        let Some(root) = self.root.take() else {
            return Ok(());
        };
        let engine = Rc::clone(&self.view.engine);
        self.sessions.take().iter().for_each(|it| engine.ignore(it));
        task::spawn(async move {
            if let Some(session) = root.await {
                engine.command(
                    "Target.detachFromTarget",
                    record! { "sessionId": &*session },
                    "",
                );
            }
        });
        announce(self.to_js(), "detach", &[js("target closed")?])
    }

    pub(crate) fn detach(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.end()
    }

    pub(crate) fn send_command<'a>(
        &self,
        _: Cx<'a, '_>,
        method: &[u8],
        params: JsLocal<'a>,
        session: Option<&[u8]>,
    ) -> JsResult<JSValue> {
        let unavailable = || error(format_args!("No target available"));
        let root = self.root.borrow().clone().ok_or_else(unavailable)?;
        let (method, params) = (string(method), super::wire::data_from_js(params.to_js())?);
        let (debugger, session) = (
            Root::new(self),
            session.filter(|it| !it.is_empty()).map(string),
        );
        Ok(task::promise(async move {
            let root = root.await.ok_or_else(unavailable)?;
            let it = debugger.get();
            if session.as_ref().is_some_and(|session| !it.has(session)) {
                return Err(error(format_args!("Session with given id not found.")));
            }
            it.view.wake();
            let reply =
                it.view
                    .engine
                    .inspect(&method, params, session.as_deref().unwrap_or(&root));
            engine::to_js(&reply.await.map_err(|it| it.throw())?)
        }))
    }
}
