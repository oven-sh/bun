//! What belongs to the global object of a window or of a worker.

use core::any::Any;
use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::c_void;
use core::mem::ManuallyDrop;
use std::rc::Rc;

use bun_collections::HashMap;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::client::Client;
use crate::held::Held;
use crate::net::embedder::ClientId;
use crate::origin::Origin;
use crate::reporting::{Members, ReportType};
use crate::tasks::{self, Priority, TaskId, Work};
use crate::timers::Timers;
use crate::url::Url;
use crate::{Bytes, runtime};

unsafe extern "C" {
    safe fn Bun__WebGlobalObject__realm(global: &JSGlobalObject) -> *const c_void;
    safe fn Bun__WebGlobalObject__globalThis(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__DesktopRealm__evaluate(
        global: &JSGlobalObject,
        source: JSValue,
        url: &bun_core::String,
        base: &bun_core::String,
    ) -> JSValue;
    safe fn Bun__DesktopRealm__baseOfScript(global: &JSGlobalObject) -> bun_core::String;
    safe fn Bun__DesktopRealm__liftRestrictions(global: &JSGlobalObject);
    safe fn Bun__DesktopRealm__restrictCode(
        global: &JSGlobalObject,
        allows_eval: bool,
        allows_web_assembly: bool,
        watches_eval: bool,
    );
    safe fn Bun__WebGlobalObject__setPaused(global: &JSGlobalObject, is_paused: bool);
    safe fn Bun__Desktop__construct(
        global: &JSGlobalObject,
        class: JSValue,
        arguments: JSValue,
    ) -> JSValue;
    safe fn Bun__Desktop__natives(global: &JSGlobalObject) -> JSValue;
}

/// One of Bun's globals, whether or not the realm shows it.
pub fn native(global: &JSGlobalObject, name: &str) -> JsResult<JSValue> {
    Ok(Bun__Desktop__natives(global)
        .get(global, name)?
        .unwrap_or(JSValue::UNDEFINED))
}

pub fn construct(
    global: &JSGlobalObject,
    class: JSValue,
    arguments: &[JSValue],
) -> JsResult<JSValue> {
    let arguments = JSValue::create_array_from_slice(global, arguments)?;
    bun_jsc::from_js_host_call(global, || Bun__Desktop__construct(global, class, arguments))
}

pub fn construct_native(
    global: &JSGlobalObject,
    class: &str,
    arguments: &[JSValue],
) -> JsResult<JSValue> {
    construct(global, native(global, class)?, arguments)
}

thread_local! {
    static RUNNING: ManuallyDrop<RefCell<Vec<*const JSGlobalObject>>> = bun_ui::lasting(|| drop(RUNNING.with(|it| it.take())));
}

/// The microtasks of the realms of this thread wait.
pub(crate) fn set_paused(is_paused: bool) {
    RUNNING.with(|all| {
        for global in &*all.borrow() {
            // SAFETY: it is removed when it is destroyed.
            Bun__WebGlobalObject__setPaused(unsafe { &**global }, is_paused);
        }
    });
}

unsafe extern "Rust" {
    safe fn __bun_dom_deliver_report(
        realm: &JSGlobalObject,
        kind: ReportType,
        body: Members,
        element: JSValue,
    );
}

/// The realm may not be there yet. `element` is only passed on.
pub(crate) fn tell_scripts(client: ClientId, kind: ReportType, body: Members, element: JSValue) {
    let steps = move |_: &JSGlobalObject, values: &[JSValue]| {
        let has_it = |it: &JSGlobalObject| Some(Realm::of(it)?.client()?.id == client);
        let first = RUNNING.with(|all| {
            // SAFETY: as in `set_paused`.
            (all.borrow().iter().map(|it| unsafe { &**it })).find(|it| has_it(it) == Some(true))
        });
        if let Some(realm) = first {
            __bun_dom_deliver_report(realm, kind, body, values[0]);
        }
        Ok(())
    };
    let (global, work) = (VirtualMachine::get().global(), Work::Once(Box::new(steps)));
    tasks::post(global, Priority::Visible, work, &[element]);
}

/// `WebGlobalObject::Scope`
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Scope {
    Window,
    DedicatedWorker,
    SharedWorker,
}

/// <https://w3c.github.io/FileAPI/#lifeTime>
#[derive(Default)]
struct BlobUrls(HashMap<Bytes, ()>);

impl Drop for BlobUrls {
    fn drop(&mut self) {
        self.0.keys().for_each(|it| runtime::revoke_blob_url(it));
    }
}

/// `WebGlobalObject` owns it.
pub struct Realm {
    global: *const JSGlobalObject,
    scope: Scope,
    is_secure_context: bool,
    is_cross_origin_isolated: bool,
    is_stopped: Cell<bool>,
    client: RefCell<Option<Rc<Client>>>,
    pub(crate) timers: Timers,
    extras: RefCell<Vec<Rc<dyn Any>>>,
    /// What follows the origin.
    blob_urls: OnceCell<Held<BlobUrls>>,
    pub console_counts: RefCell<HashMap<Bytes, u32>>,
    pub console_timers: RefCell<HashMap<Bytes, f64>>,
}

impl Realm {
    #[inline]
    pub fn of(global: &JSGlobalObject) -> Option<&Realm> {
        // SAFETY: null, or what `global` owns.
        unsafe { Bun__WebGlobalObject__realm(global).cast::<Realm>().as_ref() }
    }

    pub fn global(&self) -> &JSGlobalObject {
        // SAFETY: it owns `self`.
        unsafe { &*self.global }
    }

    /// What scripts see as `globalThis`.
    pub fn global_this(&self) -> JSValue {
        Bun__WebGlobalObject__globalThis(self.global())
    }

    pub fn client(&self) -> Option<Rc<Client>> {
        self.client.borrow().clone()
    }

    pub fn set_client(&self, client: Rc<Client>) {
        self.client.replace(Some(client));
    }

    /// The one `T` of this realm. It must not keep the realm alive.
    pub fn extra<T: Default + 'static>(&self) -> Rc<T> {
        let mut extras = self.extras.borrow_mut();
        let found = extras.iter().find_map(|it| Rc::clone(it).downcast().ok());
        found.unwrap_or_else(|| {
            let made = Rc::new(T::default());
            extras.push(Rc::clone(&made) as Rc<dyn Any>);
            made
        })
    }

    pub fn scope(&self) -> Scope {
        self.scope
    }

    pub fn is_secure_context(&self) -> bool {
        self.is_secure_context
    }

    pub fn is_cross_origin_isolated(&self) -> bool {
        self.is_cross_origin_isolated
    }

    /// The document was unloaded, or the worker is closing.
    pub fn is_stopped(&self) -> bool {
        self.is_stopped.get()
    }

    fn leave(&self) {
        RUNNING.with(|it| it.borrow_mut().retain(|it| *it != self.global));
    }

    pub fn stop(&self) {
        self.is_stopped.set(true);
        self.leave();
        self.timers.clear();
        tasks::cancel_tasks_of(self.global());
        self.release_held();
    }

    pub fn allows_eval(&self, code: &[u8]) -> bool {
        self.client().is_none_or(|it| it.allows_eval(code))
    }

    /// Whether Trusted Types are required.
    pub fn apply_policy(&self, is_for_new_document: bool) -> bool {
        self.client().is_some_and(|it| {
            if is_for_new_document {
                Bun__DesktopRealm__liftRestrictions(self.global());
            }
            let csp = &it.policies().csp;
            Bun__DesktopRealm__restrictCode(
                self.global(),
                csp.check_eval(b"").is_allowed() && !crate::compiled::is_exclusive(),
                csp.allows_web_assembly(),
                csp.watches_eval(),
            );
            csp.requires_trusted_types()
        })
    }

    /// Runs a classic script.
    pub fn evaluate(&self, source: JSValue, url: &[u8], base: &[u8]) -> JsResult<JSValue> {
        let (global, [url, base]) = (self.global(), [url, base].map(bun_core::String::clone_utf8));
        bun_jsc::from_js_host_call(global, || {
            Bun__DesktopRealm__evaluate(global, source, &url, &base)
        })
    }

    /// Empty if no script of this realm is running.
    pub fn base_of_script(&self) -> bun_core::String {
        Bun__DesktopRealm__baseOfScript(self.global())
    }

    /// It is revoked when this stops.
    pub fn adopt_blob_url(&self, url: &[u8]) {
        let urls = self
            .blob_urls
            .get_or_init(|| self.hold(BlobUrls::default()));
        match &mut *urls.borrow_mut() {
            Some(urls) => drop(urls.0.insert(url.into(), ())),
            None => runtime::revoke_blob_url(url),
        }
    }

    pub fn revoke_blob_url(&self, url: &[u8]) {
        if let Some(urls) = self.blob_urls.get()
            && let Some(urls) = &mut *urls.borrow_mut()
        {
            urls.0.remove(url);
        }
        runtime::revoke_blob_url(url);
    }

    /// <https://html.spec.whatwg.org/#queue-a-global-task>. `values` stay alive until `steps` get them.
    pub fn queue_task(
        &self,
        priority: Priority,
        values: &[JSValue],
        steps: impl FnOnce(&JSGlobalObject, &[JSValue]) -> JsResult<()> + 'static,
    ) -> Option<TaskId> {
        let work = || Work::Once(Box::new(steps));
        (!self.is_stopped()).then(|| tasks::post(self.global(), priority, work(), values))
    }

    /// <https://html.spec.whatwg.org/#run-steps-after-a-timeout>
    pub fn queue_task_after(
        &self,
        milliseconds: f64,
        values: &[JSValue],
        steps: impl FnOnce(&JSGlobalObject, &[JSValue]) -> JsResult<()> + 'static,
    ) -> Option<TaskId> {
        let work = || Work::Once(Box::new(steps));
        (!self.is_stopped())
            .then(|| tasks::post_delayed(self.global(), milliseconds, false, work(), values))
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__WebRealm__create(
    global: &JSGlobalObject,
    scope: Scope,
    is_secure_context: bool,
    is_cross_origin_isolated: bool,
) -> *mut Realm {
    RUNNING.with(|it| it.borrow_mut().push(global));
    bun_core::heap::into_raw(Box::new(Realm {
        global,
        scope,
        is_secure_context,
        is_cross_origin_isolated,
        is_stopped: Cell::new(false),
        client: RefCell::default(),
        timers: Timers::default(),
        extras: RefCell::default(),
        blob_urls: OnceCell::new(),
        console_counts: RefCell::default(),
        console_timers: RefCell::default(),
    }))
}

#[unsafe(no_mangle)]
extern "C" fn Bun__WebRealm__adoptClient(realm: &Realm, client: u32) {
    realm.client.replace(Client::find(ClientId(client)));
}

#[unsafe(no_mangle)]
extern "C" fn Bun__WebRealm__stop(realm: &Realm) {
    realm.stop();
}

#[unsafe(no_mangle)]
extern "C" fn Bun__WebRealm__originOf(url: &bun_core::String) -> bun_core::String {
    let origin = Url::parse(&url.to_utf8()).map_or_else(Origin::new_opaque, |it| Origin::of(&it));
    bun_core::String::clone_utf8(origin.as_bytes())
}

#[unsafe(no_mangle)]
extern "C" fn Bun__WebRealm__areOfSameOrigin(a: &JSGlobalObject, b: &JSGlobalObject) -> bool {
    let origin_of = |it| Some(Realm::of(it)?.client()?.origin());
    origin_of(a) == origin_of(b)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__WebRealm__allowsEval(realm: &Realm, code: &bun_core::String) -> bool {
    realm.allows_eval(&code.to_utf8())
}

/// # Safety
/// `realm` comes from [`Bun__WebRealm__create`] and is not used again.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__WebRealm__destroy(realm: *mut Realm) {
    // SAFETY: per the contract.
    unsafe { bun_core::heap::take(realm) }.leave();
}
