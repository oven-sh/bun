//! The part of the Chrome DevTools Protocol that automation tools need.

mod connection;
mod contents;
pub(crate) mod debugger;
mod engine;
mod frames;
pub(crate) mod input;
pub(crate) mod network;
mod page;
mod runtime;
mod server;

use std::rc::Rc;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::virtual_machine_exports::read_origin_timer;
use bun_jsc::{JsError, Weak};

use crate::prelude::*;
use crate::value::Value;
use crate::{task, text};

pub(crate) use server::listen;

type Emit = Rc<dyn Fn(&str, Value)>;
/// The result of a command, or the message of its error.
type Outcome = Result<Value, Failure>;
type Reply = Box<dyn FnOnce(Outcome)>;

#[derive(Clone)]
struct Failure(String);

impl From<JsError> for Failure {
    fn from(error: JsError) -> Failure {
        let thrown = catch::<()>(Err(error)).ok().and_then(Result::err);
        Failure::thrown(thrown.unwrap_or(JSValue::UNDEFINED))
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Failure {
        Failure(message.into())
    }
}

impl Failure {
    fn thrown(value: JSValue) -> Failure {
        let message = catch(message_of(value)).ok().and_then(Result::ok);
        Failure(message.unwrap_or_default())
    }
}

trait Session {
    fn handle(self: Rc<Self>, method: &str, params: Value, reply: Reply);
    fn close(&self);
}

fn ask(session: Rc<dyn Session>, method: &str, params: Value) -> impl Future<Output = Outcome> {
    let (sender, answer) = task::oneshot();
    session.handle(method, params, Box::new(|it| sender.send(it)));
    async { answer.await.unwrap_or(Err("Target closed".into())) }
}

fn done(result: JsResult<()>) -> Outcome {
    result?;
    Ok(Value::empty())
}

/// What there is nothing to do for.
fn unknown(method: &str) -> Outcome {
    let (domain, name) = text::split_once(method, ".").unwrap_or_default();
    let is_ignored = matches!(name, "enable" | "disable")
        || (domain == "Network" && name.starts_with("set"))
        || matches!(
            method,
            "Browser.grantPermissions"
                | "Browser.resetPermissions"
                | "Browser.setDownloadBehavior"
                | "Emulation.clearGeolocationOverride"
                | "Emulation.setDefaultBackgroundColorOverride"
                | "Emulation.setGeolocationOverride"
                | "Emulation.setTouchEmulationEnabled"
                | "Input.setInterceptDrags"
                | "Network.clearBrowserCache"
                | "Network.emulateNetworkConditions"
                | "Page.setBypassCSP"
                | "Page.setFontFamilies"
                | "Page.setInterceptFileChooserDialog"
                | "Page.setWebLifecycleState"
                | "Runtime.discardConsoleEntries"
                | "Runtime.runIfWaitingForDebugger"
                | "Security.setIgnoreCertificateErrors"
                | "Target.setAutoAttach"
                | "Target.setDiscoverTargets"
        );
    match is_ignored {
        true => Ok(Value::empty()),
        false => Err(Failure(format!("'{method}' wasn't found"))),
    }
}

fn random_id() -> String {
    let digits = text::random_bytes::<16>().map(|it| format!("{it:02X}"));
    digits.concat()
}

fn seconds() -> f64 {
    read_origin_timer(VirtualMachine::get()) as f64 / 1e9
}

state!(fn target_ids() -> RefCell<Vec<(Weak<()>, Rc<str>)>>);

/// Of a `WebContents` or a `Session`.
pub(crate) fn target_id_of(object: JSValue) -> Rc<str> {
    let mut ids = target_ids().borrow_mut();
    ids.retain(|it| it.0.get().is_some());
    if let Some(known) = ids.iter().find(|it| it.0.get() == Some(object)) {
        return Rc::clone(&known.1);
    }
    let id: Rc<str> = random_id().into();
    ids.push((Weak::create_passive(object, global()), Rc::clone(&id)));
    id
}
