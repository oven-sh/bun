//! On the thread of the worker.

use core::mem::ManuallyDrop;
use core::sync::atomic::AtomicBool;
use core::time::Duration;

use bun_core::strings;
use bun_web::Guarded;
use bun_web::client::{Scripts, WorkerSeed};
use bun_web::exec::{Sender, oneshot, with_realm};
use bun_web::host::{
    Answer, Browser, ConsoleAudience, Level, Link, Notice, Permission, Question, Reply,
};
use bun_web::net::body::SharedBytes;
use bun_web::realm::{Realm, Scope};
use bun_web::service::Outside;

use super::*;
use crate::api::loading::{prepare_worker_script, run_worker_script};
use crate::api::messaging::MessageEvent;
use crate::api::realm::{queue_task, realm_of};
use crate::api::window::WorkerGlobalScope;
use crate::generated_bindgen::window::js_WorkerGlobalScope;
use crate::values::text;

unsafe extern "C" {
    safe fn Bun__DesktopRealm__createForWorker(
        global: &JSGlobalObject,
        scope: Scope,
        is_secure: bool,
        is_isolated: bool,
        runs_program: bool,
    ) -> &JSGlobalObject;
    safe fn Bun__DesktopRealm__setUpWorker(realm: &JSGlobalObject);
    safe fn Bun__DesktopRealm__dispose(realm: &JSGlobalObject, is_reachable: bool);
}

/// Of a [`Running`].
#[derive(Clone)]
pub(super) struct Address {
    pub(super) thread: Thread,
    pub(super) id: u32,
}

impl Address {
    fn post(&self, steps: impl FnOnce(&Running) + Send + 'static) {
        let id = self.id;
        self.thread
            .post(move || _ = Running::find(id).map(|it| steps(&it)));
    }
}

#[derive(Clone)]
pub(super) struct ToOutside {
    creator: Address,
    /// The outermost worker, whose creator is a document. The host is asked through it, whatever the workers in between are busy with.
    outermost: Address,
    is_shared: bool,
    browser: Browser,
    languages: Vec<String>,
    service: Option<Outside>,
}

#[derive(Default)]
struct OfWorker {
    outside: RefCell<Option<ToOutside>>,
    inbox: RefCell<Arc<Inbox>>,
    font_scope: Cell<u32>,
}

impl ToOutside {
    pub(super) fn new(cx: Cx<'_, '_>, creator: Address, is_shared: bool) -> ToOutside {
        let outermost = realm_of(&cx.heap)
            .extra::<OfWorker>()
            .outside
            .borrow()
            .as_ref()
            .map_or_else(|| creator.clone(), |it| it.outermost.clone());
        let (browser, languages) = WindowTarget::of_realm(&cx.heap)
            .map(|it| (it.browser().clone(), it.languages()))
            .unwrap_or_default();
        ToOutside {
            creator,
            outermost,
            is_shared,
            browser,
            languages,
            service: None,
        }
    }

    pub(super) fn of_service_worker(
        creator: Address,
        seed: &WorkerSeed,
        service: Outside,
    ) -> ToOutside {
        let after = strings::split_once(seed.user_agent(), b"Chrome/").map_or(&b""[..], |it| it.1);
        let browser = Browser {
            user_agent: text(seed.user_agent()).into(),
            version: text(strings::split(after, b" ").next().unwrap_or_default()).into(),
        };
        let languages = strings::split(seed.accept_language(), b",")
            .filter_map(|it| strings::split(it, b";").next())
            .map(|it| text(it.trim_ascii()).into())
            .collect();
        ToOutside {
            outermost: creator.clone(),
            creator,
            is_shared: true,
            browser,
            languages,
            service: Some(service),
        }
    }

    fn log(&self, level: Level, message: String, line: u32, url: String) {
        match &self.service {
            Some(service) => service.log(level, message, line, url),
            None => self
                .outermost
                .post(move |it| _ = it.with_host(|host| host.console(level, message, line, url))),
        }
    }
}

impl Link for ToOutside {
    fn tell(&self, notice: Notice) {
        match notice {
            Notice::Console {
                level,
                message,
                line,
                url,
            } => self.log(level, message, line, url),
            Notice::Uncaught {
                message,
                url,
                line,
                is_rejection,
                ..
            } if is_rejection || self.is_shared => self.log(Level::Error, message, line, url),
            Notice::Uncaught {
                message,
                url,
                line,
                column,
                ..
            } => {
                self.creator.post(move |it| {
                    it.fail(Failure::Uncaught(
                        message,
                        ScriptLocation {
                            url: url.as_bytes().into(),
                            line,
                            column,
                        },
                    ))
                });
            }
            _ => {}
        }
    }

    fn ask(&self, question: Question) -> Option<Answer> {
        match question {
            Question::Browser {} => Some(Answer::Browser(self.browser.clone())),
            Question::ConsoleAudience {} => Some(Answer::ConsoleAudience(ConsoleAudience::App)),
            Question::Languages {} => Some(Answer::Languages(self.languages.clone())),
            Question::PermissionState { name, .. }
                if name == "notifications"
                    && let Some(service) = &self.service =>
            {
                Some(Answer::PermissionState(
                    if exec::park_until(service.may_notify(), None)? {
                        Permission::Granted
                    } else {
                        Permission::Denied
                    },
                ))
            }
            Question::Connection {} | Question::PermissionState { .. } => {
                let id = self.outermost.id;
                let asking = self.outermost.thread.call(move || async move {
                    Running::find(id)?.with_host(|it| it.link().ask(question))?
                });
                exec::park_until(asking, None)??
            }
            _ => None,
        }
    }

    fn request(&self, question: Question, reply: Reply<Option<Answer>>) {
        let (sender, answer) = oneshot();
        if let Question::SystemVersion {} = question {
            self.outermost.post(|it| {
                _ = it.with_host(|it| {
                    it.link()
                        .request(question, Box::new(|_, answer| sender.send(answer)))
                })
            });
        }
        exec::spawn(async move {
            let answer = answer.await.flatten();
            reply(VirtualMachine::get().global(), answer);
        });
    }
}

/// The ports to those who have connected.
#[derive(Default)]
pub(super) struct Inbox {
    /// With the thread, once its script has run.
    ports: Guarded<(Vec<Endpoint>, Option<Thread>)>,
    is_closing: AtomicBool,
}

impl Inbox {
    pub(super) fn connect(&self, port: Endpoint) {
        let mut ports = self.ports.lock();
        ports.0.push(port);
        if let Some(thread) = &ports.1 {
            thread.post(|| {
                _ = SCOPE
                    .with(|it| it.borrow().clone())
                    .map(|it| it.enter(|cx, _| accept_connections(cx)))
            });
        }
    }

    pub(super) fn take_ports(&self) -> Vec<Endpoint> {
        core::mem::take(&mut self.ports.lock().0)
    }

    pub(super) fn is_closing(&self) -> bool {
        self.is_closing.load(Ordering::Relaxed)
    }
}

fn accept_connections(cx: Cx<'_, '_>) {
    let inbox = Arc::clone(&realm_of(&cx.heap).extra::<OfWorker>().inbox.borrow());
    for port in inbox.take_ports() {
        queue_task(
            &cx.heap,
            [MessagePort::new(&cx.heap, port).to_js()],
            |cx, [port]| {
                let (Some(scope), Some(port)) = (
                    WindowTarget::of_realm(&cx.heap),
                    MessagePort::from_js(&cx.heap, port.to_js()),
                ) else {
                    return;
                };
                match MessageEvent::connect(&cx.heap, port) {
                    Ok(event) => drop(dispatch(cx, scope, event)),
                    Err(error) => exec::report(cx, Err(error)),
                }
            },
        );
    }
}

pub(super) struct Start {
    pub(super) id: u32,
    pub(super) seed: WorkerSeed,
    pub(super) name: Vec<u16>,
    pub(super) is_module: bool,
    pub(super) credentials: Credentials,
    /// Unless it was compiled.
    pub(super) source: Option<SharedBytes>,
    pub(super) outside: ToOutside,
    pub(super) inbox: Arc<Inbox>,
    /// Of a service worker.
    pub(super) started: Option<Sender<(Thread, bool)>>,
}

static STARTING: Guarded<Vec<Start>> = Guarded::new(Vec::new());

pub(super) fn prepare(start: Start) {
    STARTING.lock().push(start);
}

fn take(id: u32) -> Option<Start> {
    STARTING.lock().extract_if(.., |it| it.id == id).next()
}

pub(super) fn forget(id: u32) {
    drop(take(id));
}

static SCOPE: bun_ui::Lasting<ManuallyDrop<RefCell<Option<Rc<Kept>>>>> = bun_ui::Lasting::empty();

struct ScriptsOfWorker(ToOutside);

impl Scripts for ScriptsOfWorker {
    fn log_error(&self, message: &[u8]) {
        self.0.log(
            Level::Error,
            bstr::ByteSlice::to_str_lossy(message).into_owned(),
            0,
            String::new(),
        );
    }

    fn location(&self) -> ScriptLocation {
        ScriptLocation::now(VirtualMachine::get().global())
    }

    fn is_inspected(&self) -> bool {
        false
    }
}

fn exit() {
    Thread::current().post(|| _ = VirtualMachine::get().worker_ref().map(|it| it.exit()));
}

pub(super) extern "C" fn enter(of_thread: &JSGlobalObject, id: u32) {
    extern "C" fn let_go(_: *mut core::ffi::c_void) {
        drop(SCOPE.with(|it| it.take()));
    }
    let Some(Start {
        seed,
        name,
        is_module,
        credentials,
        source,
        outside,
        inbox,
        started,
        ..
    }) = take(id)
    else {
        return;
    };
    let (client, is_shared, creator) = (
        Client::for_worker(seed),
        outside.is_shared,
        outside.creator.clone(),
    );
    client.set_scripts(Rc::new(ScriptsOfWorker(outside.clone())));
    let kind = match (&started, is_shared) {
        (Some(_), _) => Scope::ServiceWorker,
        (_, true) => Scope::SharedWorker,
        _ => Scope::DedicatedWorker,
    };
    let global = Bun__DesktopRealm__createForWorker(
        of_thread,
        kind,
        client.is_secure(),
        client.is_cross_origin_isolated(),
        client.runs_program(),
    );
    let realm = Realm::of(global).expect("a realm");
    realm.set_client(Rc::clone(&client));
    let own = realm.extra::<OfWorker>();
    own.outside.replace(Some(outside.clone()));
    own.inbox.replace(Arc::clone(&inbox));
    own.font_scope.set(0x4000_0000 + id);
    let languages = outside.languages.clone();
    WorkerGlobalScope::create(
        realm,
        Host::new(outside),
        crate::api::events::now(),
        DomString::from_utf16(&name),
    )
    .into_iter()
    .for_each(|it| _ = it.set_languages(languages.clone()));
    Bun__DesktopRealm__setUpWorker(global);
    with_realm(global, |cx| {
        let Some(scope) = WorkerGlobalScope::from_js(
            &cx.heap,
            WindowTarget::of_realm(&cx.heap).map_or(JSValue::UNDEFINED, JsInterface::to_js),
        ) else {
            return exit();
        };
        let kept = Rc::new(Kept::new(cx, scope.to_js()));
        SCOPE.with(|it| it.replace(Some(Rc::clone(&kept))));
        exec::at_exit(let_go);
        crate::api::trusted::apply_policy(&cx.heap, false);
        if !is_shared && let Some(port) = inbox.ports.lock().0.pop() {
            js_WorkerGlobalScope::set_port(scope, MessagePort::new(&cx.heap, port).to_js());
        }
        if started.is_some() {
            crate::api::service_workers::set_up_service_worker(cx);
        }
        let preparing = prepare_worker_script(cx, source, is_module, credentials);
        exec::spawn(async move {
            let script = preparing.await;
            let running = kept.in_task(move |cx, scope| {
                if !script.is_some_and(|it| run_worker_script(cx, it, kind)) {
                    return false;
                }
                if let Some(started) = started {
                    started.send((
                        Thread::current(),
                        WindowTarget::of_realm(&cx.heap)
                            .is_some_and(|it| it.has_listeners(atom!("fetch"))),
                    ));
                } else if is_shared {
                    inbox.ports.lock().1 = Some(Thread::current());
                    accept_connections(cx);
                } else if let Some(scope) = WorkerGlobalScope::from_js(&cx.heap, scope.to_js()) {
                    port_of(&cx.heap, scope)
                        .into_iter()
                        .for_each(|it| it.forward(cx, scope.window()));
                }
                true
            });
            if running.await == Some(false) {
                creator.post(|it| it.fail(Failure::ToStart));
                exit();
            }
            // It runs until it is closed or terminated.
            core::future::pending::<()>().await;
        });
    });
}

pub(crate) fn font_scope(heap: &JsHeap<'_>) -> u32 {
    Realm::of(global_of(heap)).map_or(0, |it| it.extra::<OfWorker>().font_scope.get())
}

fn port_of<'a>(heap: &JsHeap<'a>, scope: &WorkerGlobalScope) -> Option<&'a MessagePort> {
    MessagePort::from_js(heap, js_WorkerGlobalScope::port(scope)?)
}

impl ClosableScope {
    /// <https://html.spec.whatwg.org/#close-a-worker>
    pub(crate) fn close(&self, heap: &JsHeap<'_>) {
        let realm = realm_of(self.realm(heap));
        realm
            .extra::<OfWorker>()
            .inbox
            .borrow()
            .is_closing
            .store(true, Ordering::Relaxed);
        realm
            .extra::<OfWorker>()
            .outside
            .borrow()
            .iter()
            .filter(|it| it.is_shared)
            .for_each(|it| it.creator.post(|it| it.leave(false)));
        let client = realm.client();
        realm.stop();
        Thread::current().post(|| {
            if let Some(scope) = SCOPE.with(|it| it.borrow().clone()) {
                scope.enter(|cx, _| Bun__DesktopRealm__dispose(cx.global(), false));
            }
        });
        exec::spawn(async move {
            if let Some(client) = client {
                exec::race(
                    client.finish_kept_alive(),
                    exec::sleep(Duration::from_secs(30)),
                )
                .await;
            }
            exit();
        });
    }
}

impl PostingScope {
    pub(crate) fn post_message<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        transfer: Objects<'a>,
    ) -> Result<'a> {
        port_of(&cx.heap, self).map_or(Ok(()), |it| it.post_message(cx, message, transfer))
    }

    pub(crate) fn post_message_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        options: &SerializeOptions<'a>,
    ) -> Result<'a> {
        self.post_message(cx, message, options.transfer)
    }
}
