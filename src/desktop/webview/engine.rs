//! The browser engine that renders, in sandboxed processes of its own, what the app does not trust.

use core::future::Future;
use core::pin::Pin;
use core::task::{Context, Poll};
use std::collections::BTreeMap;
use std::rc::{Rc, Weak};

use bun_core::strings;
use bun_jsc::Strong;
use bun_ui::protocol::HelperSources;
use bun_web::scheme::{self, Privileges};

use super::chromium::{self, Backend, Browser};
use super::remote::Remote;
use super::{notices, wire};
use crate::contents::place;
use crate::generated_bindgen::webview::EngineChoice;
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::session::Session;
use crate::task::{self, Timer};
use crate::value::Value;
use crate::{app, command_line, files, paths, process};

const IDLE_MS: u64 = 30_000;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Electron,
    Chromium,
}

struct Choice {
    kind: Kind,
    path: String,
    arguments: Vec<String>,
}

#[derive(Default)]
struct State {
    /// `None` until somebody has chosen or looked.
    choice: RefCell<Option<Option<Rc<Choice>>>>,
    running: RefCell<Option<Rc<Engine>>>,
    has_run: Cell<bool>,
    /// The history of a page outlives an engine.
    last_id: Cell<i32>,
}

state!(fn state() -> State);

pub(crate) fn choose(wanted: JSValue) -> JsResult<()> {
    let choice = if wanted.is_null() {
        None
    } else {
        let invalid = || {
            type_error(format_args!(
                "Expected null, {{ type: \"bun\" }} or {{ type: \"electron\" | \"chromium\", path: string }} with an absolute path"
            ))
        };
        let given = if wanted.is_object() {
            EngineChoice::from_js(global(), wanted)?
        } else {
            return Err(invalid());
        };
        let path = string(given.path.as_deref().unwrap_or_default());
        let kind = match given.r#type.as_deref() {
            Some(b"bun") => return place::show_the_rest(true),
            Some(b"electron") => Kind::Electron,
            Some(b"chromium") => Kind::Chromium,
            _ => return Err(invalid()),
        };
        if !files::is_absolute(&path) {
            return Err(invalid());
        }
        let arguments = given.args.iter().flatten().map(|it| string(it)).collect();
        Some(Rc::new(Choice {
            kind,
            path,
            arguments,
        }))
    };
    state().choice.replace(Some(choice));
    place::show_the_rest(false)
}

unsafe extern "Rust" {
    safe fn __bun_desktop_find_chrome() -> Option<Vec<u8>>;
}

fn find() -> JsResult<Option<Rc<Choice>>> {
    if let Some(known) = state().choice.borrow().clone() {
        return Ok(known);
    }
    let executable = match () {
        () if IS_MAC => "Electron.app/Contents/MacOS/Electron",
        () if cfg!(windows) => "electron.exe",
        () => "electron",
    };
    let resources = match (paths::resources(), get(process::object(), "resourcesPath")?) {
        (Some(it), _) => it.to_owned(),
        (None, it) if it.is_string() => text_of(it)?,
        _ => paths::manifest()?.root.clone(),
    };
    let bundled = files::join(&[&resources, "electron", executable]);
    let found = match files::exists(&bundled) {
        true => Some((Kind::Electron, bundled)),
        false => __bun_desktop_find_chrome().map(|it| (Kind::Chromium, string(&it))),
    };
    let found = found.map(|(kind, path)| {
        Rc::new(Choice {
            kind,
            path,
            arguments: Vec::new(),
        })
    });
    state().choice.replace(Some(found.clone()));
    Ok(found)
}

pub(crate) fn is_available() -> JsResult<bool> {
    Ok(find()?.is_some())
}

pub(crate) fn shows_pages() -> JsResult<bool> {
    Ok(!bun_web::trust::has_sandbox_for_the_rest() && is_available()?)
}

pub(crate) fn running() -> Option<Rc<Engine>> {
    state().running.borrow().clone()
}

pub(crate) fn start() -> JsResult<Rc<Engine>> {
    if let Some(running) = running() {
        return Ok(running);
    }
    let Some(found) = find()? else {
        return Err(error(format_args!(
            "There is no web engine for pages that are not trusted. See app.setWebEngine()."
        )));
    };
    if !state().has_run.replace(true) {
        process::at_exit(|| running().map_or((), |it| it.close()));
    }
    let engine = Engine::start(&found)?;
    state().running.replace(Some(Rc::clone(&engine)));
    Ok(engine)
}

/// The switches of the app that it gets. None of them turns the sandbox off.
fn is_forwarded(name: &str) -> bool {
    const PREFIXES: [&str; 7] = [
        "proxy-",
        "no-proxy-",
        "auth-",
        "ozone-platform",
        "ignore-certificate-errors",
        "webrtc-",
        "force-webrtc-",
    ];
    let feature = name
        .strip_prefix("enable-")
        .or_else(|| name.strip_prefix("disable-"));
    PREFIXES.iter().any(|it| name.starts_with(it))
        || matches!(
            feature,
            Some(
                "features"
                    | "blink-features"
                    | "logging"
                    | "http2"
                    | "quic"
                    | "http-cache"
                    | "dev-shm-usage"
                    | "ntlm-v2"
            )
        )
        || matches!(
            name,
            "host-rules"
                | "host-resolver-rules"
                | "log-net-log"
                | "net-log-capture-mode"
                | "use-fake-device-for-media-stream"
                | "use-fake-ui-for-media-stream"
                | "disable-gpu"
                | "disable-gpu-compositing"
                | "use-gl"
                | "use-angle"
                | "disk-cache-size"
                | "autoplay-policy"
                | "v"
                | "vmodule"
        )
}

/// `resources/app.asar`, for a build of Electron that runs nothing else.
fn has_own_script(executable: &str) -> bool {
    let resources = if IS_MAC {
        "../../Resources"
    } else {
        "../resources"
    };
    ["app.asar", "app"]
        .iter()
        .any(|it| files::exists(&files::join(&[executable, resources, it])))
}

/// And removes those of the processes that were killed.
fn make_temporary(parent: &str) -> JsResult<String> {
    // A container has process ids of its own.
    let namespace = bun_sys::stat(bun_core::zstr!("/proc/self/ns/pid"));
    let prefix = namespace.map_or_else(
        |_| "bun-web-".to_owned(),
        |it| format!("bun-web-{}-", it.st_ino),
    );
    for name in files::names_in(parent) {
        let owner = name
            .strip_prefix(&prefix)
            .and_then(|it| crate::text::before(it, "-").parse().ok());
        if owner.is_some_and(|it| !process::is_running(it)) {
            let left = files::join(&[parent, &name]);
            in_background(move || files::remove_all(&left), |()| Ok(()));
        }
    }
    let name = format!(
        "{prefix}{}-{:x}",
        process::id(),
        u32::from_ne_bytes(crate::text::random_bytes())
    );
    let directory = files::join(&[parent, &name]);
    files::or_throw(bun_sys::mkdir(
        &bun_core::ZBox::from_bytes(directory.as_bytes()),
        0o700,
    ))?;
    Ok(directory)
}

/// With a statement that defines `wire`.
pub(crate) fn sources() -> JsResult<(String, HelperSources)> {
    let sources = (bun_ui::renderer(global())?.helper_sources)();
    let (functions, exports) =
        crate::text::split_once(&sources.wire, "export default").unwrap_or_default();
    Ok((
        format!("const wire = (() => {{{functions}return{exports}}})();\n"),
        sources,
    ))
}

fn write_helper(directory: &str) -> JsResult<()> {
    let (wire, sources) = sources()?;
    for (name, contents) in [
        ("main.js", format!("{wire}{}", &*sources.main)),
        ("frame.js", format!("{wire}{}", &*sources.frame)),
        (
            "package.json",
            r#"{"name":"web-engine","version":"1.0.0","main":"main.js"}"#.to_owned(),
        ),
    ] {
        files::or_throw(files::write(
            &files::join(&[directory, name]),
            contents.as_bytes(),
            0o600,
        ))?;
    }
    Ok(())
}

fn schemes() -> Value {
    let describe = |(scheme, it): (Box<[u8]>, Privileges)| {
        record! {
            "scheme": string(&scheme),
            "privileges": record! {
                "standard": it.contains(Privileges::STANDARD),
                "secure": it.contains(Privileges::SECURE),
                "bypassCSP": it.contains(Privileges::BYPASS_CSP),
                "allowServiceWorkers": it.contains(Privileges::ALLOW_SERVICE_WORKERS),
                "supportFetchAPI": it.contains(Privileges::SUPPORT_FETCH_API),
                "corsEnabled": it.contains(Privileges::CORS_ENABLED),
                "stream": it.contains(Privileges::STREAM),
                "codeCache": it.contains(Privileges::CODE_CACHE),
            },
        }
    };
    scheme::registered().into_iter().map(describe).collect()
}

#[derive(Clone)]
pub(crate) struct Failure {
    pub(crate) error: Value,
    /// More properties of the error.
    pub(crate) details: Value,
}

impl Failure {
    pub(crate) fn new(message: impl Into<Value>) -> Failure {
        Failure {
            error: Value::error(message),
            details: Value::Undefined,
        }
    }

    pub(crate) fn says(&self, message: &str) -> bool {
        matches!(&self.error, Value::Error(it) if it[1].is(message))
    }

    pub(crate) fn throw(&self) -> bun_jsc::JsError {
        let thrown = || {
            let error = to_js(&self.error)?;
            for (name, value) in self.details.members().iter().filter(|_| error.is_object()) {
                JSValue::put_to_property_key(error, global(), js(name)?, js(value)?)?;
            }
            Ok(global().throw_value(error))
        };
        thrown().unwrap_or_else(|it| it)
    }
}

pub(crate) type Reply = Result<Value, Failure>;

pub(crate) struct Awaited(task::Receiver<Reply>);

impl Future for Awaited {
    type Output = Reply;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Reply> {
        Pin::new(&mut self.0)
            .poll(cx)
            .map(|it| it.unwrap_or_else(|| Err(gone())))
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Target {
    View(i32),
    Window(i32),
    Session(i32),
    Object(i32),
    Module(&'static str),
}

impl Target {
    fn describe(self) -> [Value; 2] {
        match self {
            Target::View(id) => ["view".into(), id.into()],
            Target::Window(id) => ["window".into(), id.into()],
            Target::Session(id) => ["session".into(), id.into()],
            Target::Object(id) => ["object".into(), id.into()],
            Target::Module(name) => ["module".into(), name.into()],
        }
    }
}

pub(crate) struct Call {
    /// 0 if nobody waits.
    pub(crate) reply: i32,
    pub(crate) target: Target,
    pub(crate) method: Box<str>,
    pub(crate) arguments: Value,
    /// The commands after it wait until it has finished.
    pub(crate) holds_up: bool,
}

pub(crate) enum Order {
    Answer {
        id: i32,
        outcome: Result<Value, String>,
    },
    Call(Call),
    Cancel(i32),
    ClosePort(i32),
    Cookies {
        session: i32,
        stored: Value,
        removed: Value,
    },
    Create(Value),
    Destroy(i32),
    /// The window that a page is about to open.
    Expect(i32),
    Frame {
        view: i32,
        message: Vec<u8>,
    },
    Handle {
        channels: Value,
    },
    Handler {
        session: i32,
        name: &'static str,
        is_set: bool,
        is_sync: bool,
        options: Value,
    },
    Load {
        reply: i32,
        id: i32,
        session: i32,
        request: Value,
    },
    Media {
        reply: i32,
    },
    Painted(i32),
    PopupInput {
        reply: i32,
        view: i32,
        event: Value,
    },
    Port {
        id: i32,
        data: Value,
        ports: Value,
    },
    Protocol {
        session: i32,
        scheme: String,
        is_handled: bool,
    },
    Read {
        reply: i32,
        id: i32,
    },
    Release(i32),
    SendCookies {
        reply: i32,
        session: i32,
    },
    Session {
        id: i32,
        directory: Option<String>,
        cookies: Value,
    },
    StartTask {
        worker: i32,
        id: i32,
    },
    Theme {
        is_dark: bool,
        reduces_motion: bool,
        increases_contrast: bool,
        forces_colors: bool,
        reduces_transparency: bool,
    },
    WebRequest {
        session: i32,
        event: &'static str,
        filter: Value,
    },
}

impl Order {
    fn describe(self) -> Value {
        match self {
            Order::Answer {
                id,
                outcome: Ok(value),
            } => list!["answer", id, false, value],
            Order::Answer {
                id,
                outcome: Err(text),
            } => list!["answer", id, true, text],
            Order::Call(Call {
                reply,
                target,
                method,
                arguments,
                holds_up,
            }) => {
                let [kind, id] = target.describe();
                list!["call", reply, kind, id, &*method, arguments, holds_up]
            }
            Order::Cancel(id) => list!["cancel", id],
            Order::ClosePort(id) => list!["closePort", id],
            Order::Cookies {
                session,
                stored,
                removed,
            } => list!["cookies", session, stored, removed],
            Order::Create(description) => list!["create", description],
            Order::Destroy(id) => list!["destroy", id],
            Order::Expect(id) => list!["expect", id],
            Order::Frame { view, message } => {
                list![
                    "frame",
                    view,
                    Value::Bytes(Some("Uint8Array".into()), message.into())
                ]
            }
            Order::Handle { channels } => list!["handle", channels],
            Order::Handler {
                session,
                name,
                is_set,
                is_sync,
                options,
            } => {
                list!["handler", session, name, is_set, is_sync, options]
            }
            Order::Load {
                reply,
                id,
                session,
                request,
            } => list!["load", reply, id, session, request],
            Order::Media { reply } => list!["media", reply],
            Order::Painted(id) => list!["painted", id],
            Order::PopupInput { reply, view, event } => list!["popupInput", reply, view, event],
            Order::Port { id, data, ports } => list!["port", id, data, ports],
            Order::Protocol {
                session,
                scheme,
                is_handled,
            } => list!["protocol", session, scheme, is_handled],
            Order::Read { reply, id } => list!["read", reply, id],
            Order::Release(id) => list!["release", id],
            Order::SendCookies { reply, session } => list!["sendCookies", reply, session],
            Order::Session {
                id,
                directory,
                cookies,
            } => list!["session", id, directory, cookies],
            Order::StartTask { worker, id } => list!["startTask", worker, id],
            Order::Theme { is_dark, .. } => {
                list!["theme", if is_dark { "dark" } else { "light" }]
            }
            Order::WebRequest {
                session,
                event,
                filter,
            } => list!["webRequest", session, event, filter],
        }
    }
}

/// It gets the method and the parameters of an event of the DevTools protocol.
pub(crate) type Listener = Rc<dyn Fn(&str, &Value) -> JsResult<()>>;

struct Pending(Box<dyn FnOnce(Reply)>);

/// The pipes, as `child.stdio` has them.
const TO_BROWSER: u32 = 3;
const FROM_BROWSER: u32 = 4;
const ORDERS: u32 = 5;
const NOTICES: u32 = 6;
const ANSWERS: u32 = 7;

#[derive(Default)]
struct Read {
    bytes: Vec<u8>,
    /// Where the next message starts.
    at: usize,
    /// Up to there it does not end.
    searched: usize,
}

pub(crate) struct Engine {
    pub(crate) kind: Kind,
    pub(crate) directory: String,
    pub(crate) creation_time: f64,
    /// On Wayland it is for the application that has the focus.
    pub(crate) has_own_clipboard: bool,
    pub(crate) paints_to_files: bool,
    pub(crate) copied: RefCell<String>,
    pub(crate) has_answered: Cell<bool>,
    /// The processes that it has started, as of the last time.
    pub(crate) metrics: RefCell<Value>,
    /// While the other side waits for an answer, what it does before it goes on.
    pub(crate) collected: RefCell<Option<Vec<Value>>>,
    pub(super) backend: Backend,
    itself: Weak<Engine>,
    child: Strong,
    #[cfg(windows)]
    family: Cell<Option<crate::win32::Family>>,
    views: RefCell<BTreeMap<i32, Root<Remote>>>,
    sessions: RefCell<BTreeMap<i32, Root<Session>>>,
    /// Frames, ports, downloads and workers.
    objects: RefCell<BTreeMap<i32, Strong>>,
    /// By the id of the session, which is empty for the browser.
    inspected: RefCell<BTreeMap<Box<str>, Listener>>,
    pending: RefCell<BTreeMap<i32, Pending>>,
    read: RefCell<Read>,
    collectable: Cell<Vec<i32>>,
    holds: Cell<u32>,
    idle: Cell<Option<Timer>>,
    is_closed: Cell<bool>,
}

/// The engine runs for as long as something holds it.
pub(crate) struct Hold(Rc<Engine>);

impl Drop for Hold {
    fn drop(&mut self) {
        self.0.holds.update(|it| it - 1);
        if self.0.holds.get() == 0 && !self.0.is_closed() {
            let engine = Rc::clone(&self.0);
            self.0
                .idle
                .set(Some(Timer::new(IDLE_MS, move || engine.close())));
        }
    }
}

/// A function over there. The collector may drop it.
struct Callback(Weak<Engine>, i32);

impl Drop for Callback {
    fn drop(&mut self) {
        if let Some(engine) = self.0.upgrade() {
            let mut all = engine.collectable.take();
            all.push(self.1);
            engine.collectable.set(all);
        }
    }
}

fn gone() -> Failure {
    Failure::new("The web engine has exited")
}

impl Engine {
    fn start(choice: &Choice) -> JsResult<Rc<Engine>> {
        let kind = choice.kind;
        let directory = make_temporary(&paths::temporary()?)?;
        let mut arguments = vec![format!("--lang={}", app::locale()?)];
        // It has no window on screen, and the cookies are not kept there.
        arguments.extend(
            [
                "--disable-renderer-backgrounding",
                "--use-mock-keychain",
                "--password-store=basic",
            ]
            .map(String::from),
        );
        arguments.extend_from_slice(&choice.arguments);
        for (name, value) in command_line::all()
            .into_iter()
            .filter(|it| is_forwarded(&it.0))
        {
            arguments.push(if value.is_empty() {
                format!("--{name}")
            } else {
                format!("--{name}={value}")
            });
        }
        let scale = crate::screen::primary_display()?.scale.into();
        if kind == Kind::Chromium {
            let profile = files::join(&[&directory, "profile"]);
            arguments.extend(chromium::switches(&profile, scale));
        } else if !has_own_script(&choice.path) {
            write_helper(&directory)?;
            arguments.push(directory.clone());
        }
        let log = process::variable("ELECTRON_ENABLE_LOGGING")?.map_or("ignore", |_| "inherit");
        let stdio = match kind {
            Kind::Chromium => js(["ignore", log, log, "pipe", "pipe"])?,
            Kind::Electron => js([
                "ignore", log, log, "ignore", "ignore", "pipe", "pipe", "pipe",
            ])?,
        };
        let frames = if kind == Kind::Electron {
            answer((ui()?.open_frame_channel)())?
        } else {
            -1
        };
        #[cfg(windows)]
        let frames = match frames {
            -1 => -1,
            handle => {
                use bun_sys::FdExt as _;
                let handle = bun_sys::Fd::from_system(handle as usize as *mut _);
                handle.make_lib_uv_owned().map_or(-1, |it| it.uv())
            }
        };
        if frames >= 0 {
            stdio.push(global(), frames.into())?;
        }
        let environment = get(process::object(), "env")?;
        let how = object!({
            "stdio": stdio,
            "env": process::copy_of_environment(environment, &["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"])?,
            "windowsHide": true,
            // Or else it is killed before it has written what sites have stored.
            "detached": IS_WINDOWS && kind == Kind::Electron,
        });
        let spawn = [js(&*choice.path)?, js(arguments)?, how];
        let child = invoke(
            realm::require(global(), Module::ChildProcess)?,
            "spawn",
            &spawn,
        );
        if frames >= 0 {
            let _ = bun_sys::close(bun_sys::Fd::from_uv(frames));
        }
        let child = child?;
        #[cfg(windows)]
        let family = match get(child, "pid")? {
            id if id.is_number() && kind == Kind::Chromium => {
                crate::win32::Family::of(id.as_number() as u32)
            }
            _ => None,
        };
        let is_on_wayland =
            cfg!(target_os = "linux") && process::variable("WAYLAND_DISPLAY")?.is_some();
        let user_agent = app::user_agent()?;
        let engine = Rc::new_cyclic(|engine| Engine {
            kind,
            directory,
            creation_time: bun_core::time::milli_timestamp() as f64,
            has_own_clipboard: kind == Kind::Chromium || is_on_wayland,
            paints_to_files: kind == Kind::Electron && frames < 0,
            copied: Default::default(),
            has_answered: Default::default(),
            metrics: Default::default(),
            collected: Default::default(),
            child: keep(child),
            #[cfg(windows)]
            family: Cell::new(family),
            backend: Backend::new(user_agent.clone(), scale),
            itself: Weak::clone(engine),
            views: Default::default(),
            sessions: Default::default(),
            objects: Default::default(),
            inspected: Default::default(),
            pending: Default::default(),
            read: Default::default(),
            collectable: Default::default(),
            holds: Default::default(),
            idle: Default::default(),
            is_closed: Default::default(),
        });
        let on = |emitter, event: &str, listener: fn(&Rc<Engine>, JSValue)| {
            let engine = Rc::clone(&engine);
            let listener = procedure(move |it| {
                listener(&engine, argument(it, 0));
                Ok(())
            })?;
            invoke(emitter, "on", &[js(event)?, listener])
        };
        on(child, "error", |it, _| it.close())?;
        on(child, "exit", |it, _| it.close())?;
        invoke(child, "unref", &[])?;
        for pipe in engine.pipes()? {
            on(pipe, "error", |it, _| it.close())?;
            if get(pipe, "unref")?.is_callable() {
                invoke(pipe, "unref", &[])?;
            }
        }
        let source = if kind == Kind::Chromium {
            FROM_BROWSER
        } else {
            NOTICES
        };
        if let Some(pipe) = engine.pipe(source)? {
            on(pipe, "data", |it, chunk| it.has_read(chunk))?;
        }
        match kind {
            Kind::Chromium => Browser(Rc::clone(&engine)).start(),
            Kind::Electron => engine.answer(&record! {
                "name": paths::app_name()?,
                "directory": files::join(&[&paths::path("sessionData")?, "Web Engine", "Process"]),
                "temporary": &*engine.directory,
                "userAgent": user_agent,
                "schemes": schemes(),
            }),
        }
        Ok(engine)
    }

    fn pipe(&self, index: u32) -> JsResult<Option<JSValue>> {
        let pipe = get(self.child.get(), "stdio")?.get_index(global(), index)?;
        Ok(pipe.is_object().then_some(pipe))
    }

    /// The child has them.
    fn pipes(&self) -> JsResult<Vec<JSValue>> {
        (TO_BROWSER..=ANSWERS)
            .filter_map(|it| self.pipe(it).transpose())
            .collect()
    }

    fn write(&self, pipe: u32, bytes: &[u8]) {
        let write = || match self.pipe(pipe)? {
            Some(pipe) => invoke(pipe, "write", &[buffer(bytes)?]).map(drop),
            None => Ok(()),
        };
        task::report(write());
    }

    /// `None` if there is no whole message. What handles one may run the event loop.
    fn next_message(self: &Rc<Self>) -> Option<Option<Value>> {
        let Read {
            bytes,
            at,
            searched,
        } = &mut *self.read.borrow_mut();
        if self.kind == Kind::Chromium {
            let from = core::mem::replace(searched, bytes.len());
            let end = from + strings::index_of_char_usize(&bytes[from..], 0)?;
            *searched = end + 1;
            return Some(Value::parse(&bytes[core::mem::replace(at, end + 1)..end]));
        }
        let bytes = wire::next_message(bytes, at)?;
        let mut message = wire::decode(bytes);
        if let Some(message) = message
            .as_mut()
            .filter(|_| strings::contains(bytes, b"\"function\""))
        {
            self.adopt_functions(message);
        }
        Some(message)
    }

    fn has_read(self: &Rc<Self>, chunk: JSValue) {
        let Some(chunk) = chunk.as_array_buffer(global()) else {
            return;
        };
        self.has_answered.set(true);
        self.read
            .borrow_mut()
            .bytes
            .extend_from_slice(chunk.byte_slice());
        while let Some(message) = self.next_message().filter(|_| !self.is_closed()) {
            match (message, self.kind) {
                (Some(message), Kind::Chromium) => self.receive_from_inspector(message),
                (Some(message), Kind::Electron) => self.receive(message),
                (None, _) => {}
            }
        }
        let is_too_long = {
            let Read {
                bytes,
                at,
                searched,
            } = &mut *self.read.borrow_mut();
            *searched = searched.saturating_sub(*at);
            bytes.drain(..core::mem::take(at));
            if bytes.is_empty() {
                bytes.shrink_to(1 << 16);
            }
            self.kind == Kind::Electron && wire::is_too_long(bytes)
        };
        if is_too_long {
            self.close();
        }
    }

    fn adopt_functions(self: &Rc<Self>, value: &mut Value) {
        match value {
            Value::Handle(handle) if handle.first().is_some_and(|it| it.is("function")) => {
                let callback = Callback(Rc::downgrade(self), handle.get(1).map_or(0, Value::int));
                *value = Value::Function(Rc::new(move |arguments| {
                    if let Some(engine) = callback.0.upgrade() {
                        engine.tell(Target::Object(callback.1), "", arguments);
                    }
                }));
            }
            Value::List(items) => items.iter_mut().for_each(|it| self.adopt_functions(it)),
            Value::Record(members) => members
                .iter_mut()
                .for_each(|it| self.adopt_functions(&mut it.1)),
            Value::Shared(_, it) => self.adopt_functions(it),
            _ => {}
        }
    }

    fn receive(self: &Rc<Self>, message: Value) {
        let mut message = message.into_items();
        message.resize_with(message.len().max(8), Default::default);
        match message[0].text() {
            "reply" => {
                let [value, details] = [3, 4].map(|it| core::mem::take(&mut message[it]));
                let reply = if message[2].is_truthy() {
                    Err(Failure {
                        error: value,
                        details,
                    })
                } else {
                    Ok(value)
                };
                self.settle(message[1].int(), reply);
            }
            "inspected" => {
                if let Some(it) = Value::parse(message[1].text().as_bytes()) {
                    self.receive_from_inspector(it);
                }
            }
            "request" => {
                let (engine, id) = (Rc::clone(self), message[1].int());
                let answer = notices::answer_later(self, &message[2..]);
                task::spawn(async move {
                    let outcome = answer.await;
                    engine.send(Order::Answer { id, outcome });
                });
            }
            "ask" => self.answer(&notices::answer(self, &mut message[1..])),
            _ => task::report(notices::take(self, &mut message)),
        }
    }

    fn receive_from_inspector(&self, mut message: Value) {
        let Some(id) = message["id"].as_number() else {
            let listener = self
                .inspected
                .borrow()
                .get(message["sessionId"].text())
                .cloned();
            return listener.map_or((), |it| {
                task::report(it(message["method"].text(), &message["params"]))
            });
        };
        let error = message.take("error");
        let reply = match error.is_truthy() {
            true => Err(Failure {
                details: error.pick(&["code"]),
                ..Failure::new(&error["message"])
            }),
            false => Ok(message.take("result")),
        };
        self.settle(id as i32, reply);
    }

    fn answer(&self, value: &Value) {
        self.write(ANSWERS, &wire::encode(value));
    }

    pub(crate) fn settle(&self, id: i32, reply: Reply) {
        let pending = self.pending.borrow_mut().remove(&id);
        if let Some(Pending(then)) = pending {
            then(reply);
        }
    }

    fn expect(&self, then: Box<dyn FnOnce(Reply)>, send: impl FnOnce(i32)) {
        if self.is_closed() {
            return then(Err(gone()));
        }
        let id = -self.new_id();
        self.pending.borrow_mut().insert(id, Pending(then));
        send(id);
    }

    fn reply_to(&self, send: impl FnOnce(i32)) -> Awaited {
        let (sender, receiver) = task::oneshot();
        self.expect(Box::new(|reply| sender.send(reply)), send);
        Awaited(receiver)
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.is_closed.get()
    }

    pub(crate) fn pid(&self) -> JsResult<JSValue> {
        get(self.child.get(), "pid")
    }

    /// The other side counts up from 1.
    pub(crate) fn new_id(&self) -> i32 {
        state().last_id.update(|it| it + 1);
        -state().last_id.get()
    }

    pub(crate) fn send(&self, order: Order) {
        if self.is_closed() {
            return;
        }
        match self.kind {
            Kind::Chromium => self
                .itself
                .upgrade()
                .map_or((), |it| Browser(it).run(order)),
            Kind::Electron => {
                let released = self.collectable.take().into_iter().map(Order::Release);
                for order in released.chain([order]) {
                    self.write(ORDERS, &wire::encode(&order.describe()));
                }
            }
        }
    }

    /// `order` gets the id of the reply.
    pub(crate) fn request(&self, order: impl FnOnce(i32) -> Order) -> Awaited {
        self.reply_to(|id| self.send(order(id)))
    }

    pub(crate) fn call(
        &self,
        target: Target,
        method: &str,
        arguments: Value,
        holds_up: bool,
    ) -> Awaited {
        self.request(|reply| {
            Order::Call(Call {
                reply,
                target,
                method: method.into(),
                arguments,
                holds_up,
            })
        })
    }

    pub(crate) fn perform(&self, target: Target, method: &str, arguments: Value) -> Awaited {
        self.call(target, method, arguments, false)
    }

    pub(crate) fn tell(&self, target: Target, method: &str, arguments: Value) {
        if let (Some(collected), Target::Object(id)) = (&mut *self.collected.borrow_mut(), target) {
            return collected.push(list!["object", id, method, arguments]);
        }
        self.send(Order::Call(Call {
            reply: 0,
            target,
            method: method.into(),
            arguments,
            holds_up: false,
        }));
    }

    fn send_to_inspector(&self, id: i32, method: &str, params: Value, session: &str) {
        let session = Some(session).filter(|it| !it.is_empty());
        let json = record! { "id": id, "method": method, "params": params, "sessionId": session }
            .to_json();
        match self.kind {
            Kind::Chromium => self.write(TO_BROWSER, (json + "\0").as_bytes()),
            Kind::Electron => self.write(ORDERS, &wire::encode(&list!["inspect", json])),
        }
    }

    /// A command of the DevTools protocol. `session` is empty for the browser.
    pub(crate) fn inspect(&self, method: &str, params: Value, session: &str) -> Awaited {
        self.reply_to(|id| self.send_to_inspector(id, method, params, session))
    }

    /// `then` is called in the order of the messages, among which are the events.
    pub(crate) fn inspect_in_order(
        &self,
        method: &str,
        params: Value,
        session: &str,
        then: Box<dyn FnOnce(Reply)>,
    ) {
        self.expect(then, |id| {
            self.send_to_inspector(id, method, params, session)
        });
    }

    /// Whatever comes of it.
    pub(crate) fn command(&self, method: &str, params: Value, session: &str) {
        self.inspect_in_order(method, params, session, Box::new(drop));
    }

    /// Returns the id of a new session.
    pub(crate) async fn attach(&self, target: &str) -> Result<Rc<str>, Failure> {
        let attached = self
            .inspect(
                "Target.attachToTarget",
                record! { "targetId": target, "flatten": true },
                "",
            )
            .await?;
        Ok(attached["sessionId"].text().into())
    }

    pub(crate) fn listen(&self, session: &str, listener: Listener) {
        self.inspected.borrow_mut().insert(session.into(), listener);
    }

    pub(crate) fn ignore(&self, session: &str) {
        let listener = self.inspected.borrow_mut().remove(session);
        drop(listener);
    }

    pub(crate) fn hold(self: &Rc<Self>) -> Hold {
        self.holds.update(|it| it + 1);
        self.idle.take();
        Hold(Rc::clone(self))
    }

    pub(crate) fn measure(self: &Rc<Self>) {
        if self.kind == Kind::Electron {
            let (engine, metrics) = (
                Rc::clone(self),
                self.perform(Target::Module("app"), "getAppMetrics", list![]),
            );
            task::spawn(async move {
                if let Ok(all) = metrics.await {
                    let others = all
                        .into_items()
                        .into_iter()
                        .filter(|it| !it["type"].is("Browser"));
                    engine.metrics.replace(others.collect());
                }
            });
        }
    }

    /// What a URL or an origin is called there.
    pub(crate) fn to_engine(&self, url: &str) -> String {
        if self.kind == Kind::Chromium {
            chromium::to_engine(url)
        } else {
            url.to_owned()
        }
    }

    pub(crate) fn from_engine(&self, url: &str) -> String {
        if self.kind == Kind::Chromium {
            chromium::from_engine(url)
        } else {
            url.to_owned()
        }
    }

    pub(crate) fn view(&self, id: i32) -> Option<&'static Remote> {
        self.views.borrow().get(&id).map(Root::get)
    }

    pub(crate) fn add_view(&self, id: i32, view: &Remote) {
        self.views.borrow_mut().insert(id, Root::new(view));
    }

    pub(crate) fn remove_view(&self, id: i32) {
        self.views.borrow_mut().remove(&id);
    }

    pub(crate) fn session(&self, id: i32) -> Option<&'static Session> {
        self.sessions.borrow().get(&id).map(Root::get)
    }

    pub(crate) fn add_session(&self, id: i32, session: &Session) {
        self.sessions.borrow_mut().insert(id, Root::new(session));
    }

    pub(crate) fn object(&self, id: i32) -> Option<JSValue> {
        self.objects.borrow().get(&id).map(Strong::get)
    }

    pub(crate) fn add_object(&self, id: i32, object: JSValue) {
        self.objects.borrow_mut().insert(id, keep(object));
    }

    pub(crate) fn remove_object(&self, id: i32) -> Option<JSValue> {
        self.objects.borrow_mut().remove(&id).map(|it| it.get())
    }

    pub(crate) fn close(&self) {
        if self.is_closed.replace(true) {
            return;
        }
        let running = state().running.take();
        self.idle.take();
        task::report(self.pipes().and_then(|it| {
            it.into_iter()
                .try_for_each(|it| invoke(it, "destroy", &[]).map(drop))
        }));
        #[cfg(windows)]
        if let Some(family) = self.family.take() {
            family.end();
        }
        files::remove_all(&self.directory);
        self.pending
            .take()
            .into_values()
            .for_each(|it| it.0(Err(gone())));
        let views: Vec<i32> = self.views.borrow().keys().copied().collect();
        for view in views.into_iter().filter_map(|it| self.view(it)) {
            task::report(view.engine_closed());
        }
        self.sessions
            .take()
            .values()
            .for_each(|it| it.get().mirror().engine_closed());
        self.objects
            .take()
            .values()
            .for_each(|it| task::report(notices::engine_closed(it.get())));
        super::media::engine_closed();
        self.backend.close();
        drop((self.inspected.take(), running));
    }
}

/// Of what the engine that is running has sent.
pub(crate) fn to_js(value: &Value) -> JsResult<JSValue> {
    wire::to_js(value, &notices::find)
}

/// For the engine that is running.
pub(crate) fn from_js(value: JSValue) -> JsResult<Value> {
    wire::from_js(value, &notices::name)
}

pub(crate) fn list_from_js(values: &[JSValue]) -> JsResult<Value> {
    wire::list_from_js(values, &notices::name)
}

/// A promise for it.
pub(crate) fn promise(reply: impl Future<Output = Reply> + 'static) -> JSValue {
    task::promise(async {
        reply
            .await
            .map_or_else(|it| Err(it.throw()), |it| to_js(&it))
    })
}
