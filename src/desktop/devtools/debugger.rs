//! `webContents.debugger`, for a page in the process of the app.

use std::rc::Rc;

use bun_web::tasks::Priority;

use super::contents::Contents;
use super::page::PageSession;
use super::{Failure, Session as _};
use crate::generated_bindgen::contents::js_ElectronDebugger as fields;
use crate::prelude::*;
use crate::task;
use crate::value::Value;
use crate::webview::wire;

#[derive(Default)]
pub(crate) struct Debugger(
    RefCell<Option<Rc<PageSession>>>,
    #[expect(dead_code)] HasFields,
);

impl Debugger {
    pub(crate) fn create(contents: &crate::contents::Contents) -> &'static Debugger {
        let debugger = fields::create(heap(), Debugger::default());
        fields::set_contents(debugger, Some(contents));
        debugger
    }

    pub(crate) fn attach(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if self.is_attached() {
            return Err(error(format_args!(
                "Debugger is already attached to the target"
            )));
        }
        let debugger = Rc::new(Root::new(self));
        let emit = move |method: &str, params: Value| {
            let (debugger, method) = (Rc::clone(&debugger), method.to_owned());
            post(Priority::Host, move || {
                let arguments = [js(method)?, js(&params)?, js("")?];
                announce(debugger.get().to_js(), "message", &arguments)
            });
        };
        let contents = Contents::new(fields::contents(self).expect("it was made with one"));
        let session = PageSession::new(contents, Rc::new(emit), None)?;
        self.0.replace(Some(session));
        Ok(())
    }

    pub(crate) fn is_attached(&self) -> bool {
        self.0.borrow().is_some()
    }

    pub(crate) fn detach(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.end()
    }

    pub(crate) fn end(&self) -> JsResult<()> {
        let Some(session) = self.0.take() else {
            return Ok(());
        };
        session.close();
        announce(self.to_js(), "detach", &[js("target closed")?])
    }

    pub(crate) fn send_command<'a>(
        &self,
        _: Cx<'a, '_>,
        method: &[u8],
        params: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let session = self.0.borrow().clone();
        let session = session.ok_or_else(|| error(format_args!("No target available")))?;
        let (method, params) = (string(method), wire::data_from_js(params.to_js())?);
        Ok(task::promise(async move {
            match session.run(&method, params).await {
                Ok(result) => js(&result),
                Err(Failure(message)) => Err(error(format_args!("{message}"))),
            }
        }))
    }
}
