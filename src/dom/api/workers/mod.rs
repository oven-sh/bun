//! <https://html.spec.whatwg.org/#workers>. A worker is a realm on a thread of its own.

mod thread;

use core::cell::{Cell, RefCell};
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use std::collections::BTreeMap;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use bun_jsc::bindgen::{self, ClassStructure, JsHeap, JsInterface, JsList, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSObject, JSValue};
use bun_web::channel::Endpoint;
use bun_web::client::{Client, Script, ScriptLocation, ScriptType};
use bun_web::exec::{self, Thread};
use bun_web::held::Held;
use bun_web::host::Host;
use bun_web::origin::Origin;
use bun_web::request::{Credentials, Destination, InitiatorType, Mode};
use bun_web::url::Url;

pub(crate) use self::thread::font_scope;
use self::thread::{Address, Inbox, Start, ToOutside};
use crate::api::core::*;
use crate::api::events::{ErrorEvent, EventInit, WindowTarget, dispatch, fire};
use crate::api::loading::new_request;
use crate::api::messaging::MessagePort;
use crate::api::network::parse_url_in_encoding;
use crate::api::realm::{Kept, client_of, hold};
use crate::api::trusted::{Factory, Trusted};
use crate::generated_bindgen::messaging::SerializeOptions;
use crate::generated_bindgen::network::DomRequestCredentials;
use crate::generated_bindgen::workers::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Objects<'a> = JsList<'a, JsLocal<'a, JSObject>>;

type Bytes = Box<[u8]>;
type ThreadOfWorker = core::ffi::c_void;

unsafe extern "C" {
    safe fn Bun__DesktopWorker__start(
        global: &JSGlobalObject,
        name: &bun_core::String,
        id: u32,
        entry: extern "C" fn(&JSGlobalObject, u32),
    ) -> Option<NonNull<ThreadOfWorker>>;
    fn Bun__DesktopWorker__terminate(thread: NonNull<ThreadOfWorker>);
}

#[derive(Clone, PartialEq)]
struct Options {
    is_module: bool,
    credentials: Credentials,
    has_extended_lifetime: bool,
    is_secure: bool,
}

/// A worker, for the thread that started it. It ends with its last [`Owner`].
struct Running {
    id: u32,
    options: Options,
    /// Of a shared one.
    key: Option<Bytes>,
    inbox: Arc<Inbox>,
    thread: Cell<Option<NonNull<ThreadOfWorker>>>,
    owners: RefCell<Vec<Weak<RefCell<Option<Owner>>>>>,
}

struct Owner {
    object: Rc<Kept>,
    _running: Rc<Running>,
}

#[derive(Default)]
struct OfThread {
    by_id: BTreeMap<u32, Weak<Running>>,
    shared: BTreeMap<Bytes, u32>,
}

thread_local! {
    static OF_THREAD: ManuallyDrop<RefCell<OfThread>> = bun_ui::lasting(|| drop(OF_THREAD.with(|it| it.take())));
}

impl Drop for Running {
    fn drop(&mut self) {
        OF_THREAD.with(|it| {
            let mut all = it.borrow_mut();
            all.by_id.remove(&self.id);
            if let Some(key) = self
                .key
                .as_ref()
                .filter(|it| all.shared.get(*it) == Some(&self.id))
            {
                all.shared.remove(key);
            }
        });
        thread::forget(self.id);
        if let Some(thread) = self.thread.take() {
            // SAFETY: the reference that `start` returned.
            unsafe { Bun__DesktopWorker__terminate(thread) }
        }
    }
}

enum Failure {
    ToStart,
    Uncaught(String, ScriptLocation),
}

impl Running {
    fn new(options: Options, key: Option<Bytes>) -> Rc<Running> {
        static LAST: AtomicU32 = AtomicU32::new(0);
        let id = LAST.fetch_add(1, Ordering::Relaxed) + 1;
        let this = Rc::new(Running {
            id,
            options,
            key,
            inbox: Arc::default(),
            thread: Cell::new(None),
            owners: RefCell::default(),
        });
        OF_THREAD.with(|it| {
            let mut all = it.borrow_mut();
            all.by_id.insert(id, Rc::downgrade(&this));
            this.key
                .iter()
                .for_each(|it| _ = all.shared.insert(it.clone(), id));
        });
        this
    }

    fn find(id: u32) -> Option<Rc<Running>> {
        OF_THREAD.with(|it| it.borrow().by_id.get(&id)?.upgrade())
    }

    fn add_owner(self: &Rc<Self>, cx: Cx<'_, '_>, object: JSValue, slot: &RefCell<Held<Owner>>) {
        let object = Rc::new(Kept::new(cx, object));
        let owner = hold(
            &cx.heap,
            Owner {
                object,
                _running: Rc::clone(self),
            },
        );
        let mut owners = self.owners.borrow_mut();
        owners.retain(|it| it.upgrade().is_some_and(|it| it.borrow().is_some()));
        owners.push(Rc::downgrade(&owner));
        slot.replace(owner);
    }

    fn objects(&self) -> Vec<Rc<Kept>> {
        self.owners
            .borrow()
            .iter()
            .filter_map(|it| Some(Rc::clone(&it.upgrade()?.borrow().as_ref()?.object)))
            .collect()
    }

    /// With what hosts the first owner.
    fn with_host<R>(&self, steps: impl FnOnce(&Host) -> R) -> Option<R> {
        self.objects()
            .first()?
            .enter(|cx, _| WindowTarget::of_realm(&cx.heap).map(|it| steps(it.host())))
    }

    fn fail(&self, failure: Failure) {
        let failure = Rc::new(failure);
        for object in self.objects() {
            let failure = Rc::clone(&failure);
            object.queue_task(move |cx, object| report_failure(cx, object, &failure));
        }
    }

    fn end(&self) {
        self.owners
            .take()
            .iter()
            .filter_map(Weak::upgrade)
            .for_each(|it| drop(it.take()));
    }

    /// <https://html.spec.whatwg.org/#run-a-worker>
    fn start(
        self: &Rc<Self>,
        cx: Cx<'_, '_>,
        Asked {
            client, url, name, ..
        }: Asked,
    ) {
        let (
            Options {
                is_module,
                credentials,
                ..
            },
            is_shared,
        ) = (self.options.clone(), self.key.is_some());
        let mut request = new_request(
            &client,
            url.clone(),
            if is_shared {
                Destination::SharedWorker
            } else {
                Destination::Worker
            },
            None,
            InitiatorType::Other,
        );
        (request.mode, request.credentials) = (
            Mode::SameOrigin,
            if is_module {
                credentials
            } else {
                Credentials::SameOrigin
            },
        );
        request.initiator_type = request.initiator_type.filter(|_| !is_shared);
        let here = Address {
            thread: Thread::current(),
            id: self.id,
        };
        let outside = ToOutside::new(cx, here, is_shared);
        let (this, name) = (Rc::downgrade(self), name.units().collect::<Vec<_>>());
        exec::spawn(async move {
            let script = match client
                .compiled_path(&url, request.destination, &request.metadata)
                .filter(|_| client.origin() == Origin::of(&url))
            {
                Some(_) => Ok(None),
                None => client
                    .fetch_script(
                        request,
                        if is_module {
                            ScriptType::JavaScriptModule
                        } else {
                            ScriptType::Classic
                        },
                    )
                    .await
                    .map(Some),
            };
            let Some(this) = this.upgrade() else { return };
            let Ok(script) = script else {
                return this.give_up();
            };
            let seed = match &script {
                Some(Script::Loaded(it)) => {
                    client.seed_worker(it.head.url.clone(), &it.head.headers, is_shared)
                }
                _ => client.seed_worker(url, &Default::default(), is_shared),
            };
            let label = bun_core::String::clone_utf16(&name);
            thread::prepare(Start {
                id: this.id,
                seed,
                name,
                is_module,
                credentials,
                source: script.map(Script::into_source),
                outside,
                inbox: Arc::clone(&this.inbox),
            });
            this.thread.set(Bun__DesktopWorker__start(
                VirtualMachine::get().global(),
                &label,
                this.id,
                thread::enter,
            ));
            if this.thread.get().is_none() {
                this.give_up();
            }
        });
    }

    fn give_up(&self) {
        self.fail(Failure::ToStart);
        self.end();
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DesktopWorker__failed(id: u32, message: &bun_core::String) {
    let message = bstr::ByteSlice::to_str_lossy(&*message.to_utf8()).into_owned();
    if let Some(it) = Running::find(id) {
        it.fail(if it.key.is_some() {
            Failure::ToStart
        } else {
            Failure::Uncaught(message, ScriptLocation::default())
        });
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DesktopWorker__ended(id: u32) {
    Running::find(id).into_iter().for_each(|it| it.end());
}

fn report_failure<'a>(cx: Cx<'_, 'a>, object: JsLocal<'a>, failure: &Failure) {
    if let Some(shared) = SharedWorker::from_js(&cx.heap, object.to_js()) {
        fire(cx, shared, atom!("error"), EventInit::default());
    }
    let Some(worker) =
        Worker::from_js(&cx.heap, object.to_js()).filter(|it| !it.is_terminated.get())
    else {
        return;
    };
    match failure {
        Failure::ToStart => drop(fire(
            cx,
            worker,
            atom!("error"),
            EventInit {
                cancelable: true,
                ..Default::default()
            },
        )),
        Failure::Uncaught(message, at) => {
            let event =
                ErrorEvent::of_script(&cx.heap, DomString::from_utf8(message), at, JSValue::NULL);
            if dispatch(cx, worker, event)
                && let Some(scope) = WindowTarget::of_realm(&cx.heap)
            {
                scope.report_error_at(cx, message.clone(), at, JSValue::NULL);
            }
        }
    }
}

struct Asked {
    client: Rc<Client>,
    url: Url,
    name: DomString,
    options: Options,
}

impl Asked {
    fn new<'a>(
        cx: Cx<'_, 'a>,
        url: JsLocal<'a>,
        sink: &str,
        name: DomString,
        kind: DomWorkerType,
        credentials: DomRequestCredentials,
    ) -> Result<'a, Asked> {
        let text =
            Trusted::ScriptUrl.string_in_realm_of(cx, Factory::for_realm(&cx.heap), url, sink)?;
        let client = client_of(&cx.heap).ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::InvalidAccessError,
                "The context is not active.",
            )
        })?;
        let url = parse_url_in_encoding(&cx.heap, &text).ok_or_else(|| {
            cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!("The URL '{}' is invalid.", text.to_utf8()),
            )
        })?;
        let origin = client.origin();
        if url.scheme() != b"data" && Origin::of(&url).as_bytes() != origin.as_bytes() {
            let [url, origin] = [url.href(), origin.as_bytes()].map(bstr::BStr::new);
            return Err(cx.heap.dom_exception(
                DomError::SecurityError,
                format_args!("Script at '{url}' cannot be accessed from origin '{origin}'."),
            ));
        }
        let credentials = match credentials {
            DomRequestCredentials::Omit => Credentials::Omit,
            DomRequestCredentials::SameOrigin => Credentials::SameOrigin,
            DomRequestCredentials::Include => Credentials::Include,
        };
        let options = Options {
            is_module: kind == DomWorkerType::Module,
            credentials,
            has_extended_lifetime: false,
            is_secure: client.is_secure(),
        };
        Ok(Asked {
            client,
            url,
            name,
            options,
        })
    }
}

#[repr(C)]
pub(crate) struct Worker {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_DomWorker::Fields,
    owner: RefCell<Held<Owner>>,
    is_terminated: Cell<bool>,
}

impl Worker {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        url: JsLocal<'a>,
        options: &DomWorkerOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let asked = Asked::new(
            cx,
            url,
            "Worker constructor",
            DomString::from_impl(options.name.get()),
            options.r#type,
            options.credentials,
        )?;
        let this = structure.create(
            &cx.heap,
            Worker {
                base: Default::default(),
                fields: Default::default(),
                owner: Default::default(),
                is_terminated: false.into(),
            },
        );
        let (ours, theirs) = Endpoint::pair();
        let port = MessagePort::new(&cx.heap, ours);
        js_DomWorker::set_port(this, Some(port));
        port.forward(cx, this.to_js());
        let running = Running::new(asked.options.clone(), None);
        running.add_owner(cx, this.to_js(), &this.owner);
        running.inbox.connect(theirs);
        running.start(cx, asked);
        Ok(this)
    }

    pub(crate) fn post_message<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        transfer: Objects<'a>,
    ) -> Result<'a> {
        js_DomWorker::port(self).map_or(Ok(()), |it| it.post_message(cx, message, transfer))
    }

    pub(crate) fn post_message_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        options: &SerializeOptions<'a>,
    ) -> Result<'a> {
        self.post_message(cx, message, options.transfer)
    }

    pub(crate) fn terminate(&self) {
        self.is_terminated.set(true);
        js_DomWorker::port(self).map(MessagePort::close);
        drop(self.owner.borrow().take());
    }
}

#[repr(C)]
pub(crate) struct SharedWorker {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_SharedWorker::Fields,
    owner: RefCell<Held<Owner>>,
}

impl SharedWorker {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        url: JsLocal<'a>,
        options: NameOrWorkerOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let sink = "SharedWorker constructor";
        let asked = match options {
            NameOrWorkerOptions::Name(name) => Asked::new(
                cx,
                url,
                sink,
                DomString::from_impl(name.get()),
                DomWorkerType::Classic,
                DomRequestCredentials::SameOrigin,
            )?,
            NameOrWorkerOptions::Options(it) => {
                let mut asked = Asked::new(
                    cx,
                    url,
                    sink,
                    DomString::from_impl(it.name.get()),
                    it.r#type,
                    it.credentials,
                )?;
                asked.options.has_extended_lifetime = it.extended_lifetime;
                asked
            }
        };
        if asked.client.origin().is_opaque() {
            return Err(dom_error(
                &cx.heap,
                DomError::SecurityError,
                "Shared workers are denied to an opaque origin.",
            ));
        }
        let this = structure.create(
            &cx.heap,
            SharedWorker {
                base: Default::default(),
                fields: Default::default(),
                owner: Default::default(),
            },
        );
        let (ours, theirs) = Endpoint::pair();
        js_SharedWorker::set_port(this, Some(MessagePort::new(&cx.heap, ours)));
        let (partition, name) = (
            asked.client.partition_key(),
            asked
                .name
                .units()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        );
        let key: Bytes = [&partition, asked.url.href(), &name].join(&b'\n').into();
        let found = OF_THREAD
            .with(|it| it.borrow().shared.get(&key).copied())
            .and_then(Running::find)
            .filter(|it| !it.inbox.is_closing());
        if found.as_ref().is_some_and(|it| it.options != asked.options) {
            Kept::new(cx, this.to_js())
                .queue_task(|cx, this| report_failure(cx, this, &Failure::ToStart));
            return Ok(this);
        }
        let running = found
            .clone()
            .unwrap_or_else(|| Running::new(asked.options.clone(), Some(key)));
        running.add_owner(cx, this.to_js(), &this.owner);
        running.inbox.connect(theirs);
        if found.is_none() {
            running.start(cx, asked);
        }
        Ok(this)
    }
}
