//! The Chrome DevTools Protocol.

pub(crate) mod agent;
mod connection;
mod contents;
pub(crate) mod debugger;
mod engine;
mod frames;
pub(crate) mod frontend;
pub(crate) mod input;
mod mirror;
pub(crate) mod network;
mod page;
mod pure;
mod runtime;
mod scripts;
mod server;

use std::rc::Rc;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::virtual_machine_exports::read_origin_timer;
use bun_jsc::{JsError, Weak};

use crate::prelude::*;
use crate::value::Value;
use crate::{command_line, process, task, text};

pub(crate) use server::listen;

pub(crate) const TRIMMED: &str =
    "This executable has no developer tools: the feature inspector was trimmed";

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

const NOT_FOUND: &str = "' wasn't found";

impl Failure {
    fn describe(self) -> Value {
        let code = if self.0.ends_with(NOT_FOUND) {
            -32601
        } else {
            -32000
        };
        record! { "code": code, "message": self.0 }
    }

    fn thrown(value: JSValue) -> Failure {
        let message = catch(message_of(value)).ok().and_then(Result::ok);
        Failure(message.unwrap_or_default())
    }
}

trait Session {
    fn handle(self: Rc<Self>, method: &str, params: Value, reply: Reply);
    fn close(&self);
    /// `inspectElement()`
    fn reveal(self: Rc<Self>, point: [f64; 2]);
}

fn ask(session: Rc<dyn Session>, method: &str, params: Value) -> impl Future<Output = Outcome> {
    let (sender, answer) = task::oneshot();
    session.handle(method, params, Box::new(|it| sender.send(it)));
    async { answer.await.unwrap_or(Err("Target closed".into())) }
}

/// Those that have happened by now wait for a task.
async fn after_events() {
    let (sent, events) = task::oneshot();
    post(Priority::Host, move || {
        sent.send(());
        Ok(())
    });
    events.await;
}

fn done(result: JsResult<()>) -> Outcome {
    result?;
    Ok(Value::empty())
}

/// What there is nothing to do for.
fn unknown(method: &str) -> Outcome {
    let (domain, name) = text::split_once(method, ".").unwrap_or_default();
    let is_ignored = matches!(name, "enable" | "disable")
        || (name.starts_with("set")
            && matches!(
                domain,
                "Autofill" | "Debugger" | "Network" | "Overlay" | "Profiler" | "Storage"
            ))
        || matches!(
            method,
            "Browser.grantPermissions"
                | "Browser.resetPermissions"
                | "Browser.setDownloadBehavior"
                | "CSS.setLocalFontsEnabled"
                | "DOM.markUndoableState"
                | "DOM.setNodeStackTracesEnabled"
                | "DOMDebugger.setBreakOnCSPViolation"
                | "Emulation.clearGeolocationOverride"
                | "Emulation.setAutoDarkModeOverride"
                | "Emulation.setEmulatedVisionDeficiency"
                | "Log.clear"
                | "Log.startViolationsReport"
                | "Log.stopViolationsReport"
                | "Network.configureDurableMessages"
                | "Network.enableDeviceBoundSessions"
                | "Page.getAppId"
                | "Page.setAdBlockingEnabled"
                | "Runtime.setAsyncCallStackDepth"
                | "Runtime.setCustomObjectFormatterEnabled"
                | "Runtime.setMaxCallStackSizeToCapture"
                | "Target.setRemoteLocations"
                | "Emulation.setDefaultBackgroundColorOverride"
                | "Emulation.setGeolocationOverride"
                | "Emulation.setTouchEmulationEnabled"
                | "Input.setInterceptDrags"
                | "Page.setBypassCSP"
                | "Page.setFontFamilies"
                | "Page.setInterceptFileChooserDialog"
                | "Page.setWebLifecycleState"
                | "Runtime.runIfWaitingForDebugger"
                | "Security.setIgnoreCertificateErrors"
                | "Target.setAutoAttach"
                | "Target.setDiscoverTargets"
        );
    match is_ignored {
        true => Ok(Value::empty()),
        false => Err(Failure(format!("'{method}{NOT_FOUND}"))),
    }
}

unsafe extern "C" {
    safe fn Bun__Debugger__pauseApp(global: &crate::realm::Realm);
    safe fn Bun__Debugger__setDesktopApp(global: &crate::realm::Realm);
}

/// `--inspect` and its like, for an app that has not been compiled.
pub(crate) fn inspect_app() -> JsResult<()> {
    Bun__Debugger__setDesktopApp(global());
    if global().bun_vm().standalone_module_graph.is_some() {
        return Ok(());
    }
    let asked = ["inspect-brk", "inspect-wait", "inspect"];
    let asked = (asked.into_iter()).find_map(|it| Some((it, command_line::switch(it)?)));
    let Some((how, address)) = asked else {
        return Ok(());
    };
    let address = Some(address).filter(|it| !it.is_empty());
    let address = (address.or_else(|| command_line::value("inspect-port"))).unwrap_or_default();
    let port = (text::split(&address, ":").last()).and_then(|it| it.parse::<u16>().ok());
    let inspector = invoke(
        process::object(),
        "getBuiltinModule",
        &[js("node:inspector")?],
    )?;
    let given = [
        js(u32::from(port.unwrap_or(9229)))?,
        js("127.0.0.1")?,
        (how != "inspect").into(),
    ];
    invoke(inspector, "open", &given)?;
    if how == "inspect-brk" {
        Bun__Debugger__pauseApp(global());
    }
    Ok(())
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
