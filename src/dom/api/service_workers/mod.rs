//! <https://w3c.github.io/ServiceWorker/>. The registrations are elsewhere: see [`bun_web::service`].

mod events;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::bindgen::{self, ClassStructure, JsHeap, JsInterface, JsList, JsLocal, JsScope};
use bun_jsc::{JSObject, JSValue, Strong};
use bun_web::exec;
use bun_web::headers::is_valid_value;
use bun_web::held::Held;
use bun_web::origin::Origin;
use bun_web::service::{
    ACTIVE, Call, ClientInfo, ClientKind, Failure, FrameType, INSTALLING, Id, Notice, Outcome,
    RegistrationInfo, State, Subscription, UpdateViaCache, WAITING, WorkerInfo,
};
use bun_web::url::Url;

pub(crate) use self::events::{
    ExtendableCookieChangeEvent, ExtendableEvent, ExtendableMessageEvent, FetchEvent, InstallEvent,
    NotificationEvent,
};
use crate::api::core::*;
use crate::api::events::{EventInit, dispatch, fire};
use crate::api::messaging::{MessageEvent, serialize};
use crate::api::network::parse_url;
use crate::api::realm::{client_of, hold, queue_task, realm_of};
use crate::api::site::{Notification, describe_cookie, store_of_service_worker};
use crate::api::trusted::{Factory, Trusted};
use crate::generated_bindgen::messaging::SerializeOptions;
use crate::generated_bindgen::service_workers::*;
use crate::generated_bindgen::site::{CookieChangeEventInit, CookieStore, NotificationOptions};
use crate::generated_bindgen::workers::DomWorkerType;
use crate::values::text;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Objects<'a> = JsList<'a, JsLocal<'a, JSObject>>;

/// Of a realm.
#[derive(Default)]
struct Known {
    /// Workers and registrations.
    objects: HashMap<Id, Strong>,
    promises: HashMap<u32, Strong>,
    last_ticket: u32,
    /// Until they are enabled.
    messages: Option<Vec<Notice>>,
}

fn object_for<'a, T: JsInterface>(heap: &JsHeap<'a>, id: Id) -> Option<&'a T> {
    T::from_js(
        heap,
        Container::of_realm(heap)?
            .known
            .borrow()
            .as_ref()?
            .objects
            .get(&id)?
            .get(),
    )
}

fn remember(heap: &JsHeap<'_>, id: Id, object: JSValue) {
    Container::of_realm(heap).map(|it| {
        it.known
            .borrow_mut()
            .as_mut()?
            .objects
            .insert(id, Strong::create(object, global_of(heap)))
    });
}

/// In the realm of `object`.
fn call<'a>(cx: Cx<'_, 'a>, object: &impl JsInterface, call: Call) -> Result<'a, JSValue> {
    let global = global_of(object.realm(&cx.heap));
    let promise = exec::with_realm(global, |cx| {
        crate::api::events::WindowTarget::of_realm(&cx.heap)
            .filter(|it| !cx.heap.is_window() || !it.host().is_closed())?;
        let (container, client, promise) = (
            Container::get(cx),
            client_of(&cx.heap)?,
            cx.heap.create_promise().to_js(),
        );
        let mut known = container.known.borrow_mut();
        let known = known.as_mut()?;
        known.last_ticket += 1;
        known
            .promises
            .insert(known.last_ticket, Strong::create(promise, global));
        client.call_service_workers(known.last_ticket, call);
        Some(promise)
    });
    promise.ok_or_else(|| {
        dom_error(
            &cx.heap,
            DomError::InvalidStateError,
            "The context is not active.",
        )
    })
}

fn post<'a>(
    cx: Cx<'_, 'a>,
    object: &impl JsInterface,
    message: JsLocal<'a>,
    transfer: Objects<'a>,
    call: impl FnOnce(bun_web::channel::Message) -> Call,
) -> Result<'a> {
    let message = serialize(cx, message.to_js(), transfer.iter().map(JsLocal::to_js))?;
    if let Some(client) = client_of(object.realm(&cx.heap)) {
        client.call_service_workers(0, call(message));
    }
    Ok(())
}

fn frozen<'a, T>(
    heap: &JsHeap<'a>,
    items: Vec<T>,
    convert: fn(&JsHeap<'a>, T) -> JSValue,
) -> Result<'a, JSValue> {
    Ok(heap
        .freeze_array(
            heap.create_array(items, |heap, it| Ok(JsLocal::new(heap, convert(heap, it))))?,
        )?
        .to_js())
}

#[optimize(size)]
fn value_of<'a>(cx: Cx<'_, 'a>, outcome: Outcome) -> Result<'a, JSValue> {
    let heap = &cx.heap;
    Ok(match outcome {
        Outcome::Done => JSValue::UNDEFINED,
        Outcome::Failed(Failure::Type, message) => {
            return Err(heap.type_error(format_args!("{message}")));
        }
        Outcome::Failed(Failure::Security, message) => {
            return Err(dom_error(heap, DomError::SecurityError, message));
        }
        Outcome::Failed(Failure::InvalidState, message) => {
            return Err(dom_error(heap, DomError::InvalidStateError, message));
        }
        Outcome::Failed(Failure::InvalidAccess, message) => {
            return Err(dom_error(heap, DomError::InvalidAccessError, message));
        }
        Outcome::Failed(Failure::Quota, message) => {
            return Err(dom_error(heap, DomError::QuotaExceededError, message));
        }
        Outcome::Failed(Failure::Abort, message) => {
            return Err(dom_error(heap, DomError::AbortError, message));
        }
        Outcome::Registration(it) => {
            it.map_or(JSValue::UNDEFINED, |it| Registration::get(heap, *it))
        }
        Outcome::Registrations(all) => frozen(heap, all, Registration::get)?,
        Outcome::Unregistered(it) => it.into(),
        Outcome::Preload(is_enabled, value) => {
            let state = heap.create_empty_object().to_js();
            state.put(global_of(heap), b"enabled", is_enabled.into());
            state.put(
                global_of(heap),
                b"headerValue",
                heap.create_latin1_string(&value).to_js(),
            );
            state
        }
        Outcome::Client(it) => it.map_or(JSValue::UNDEFINED, |it| ClientObject::new(heap, it)),
        Outcome::Navigated(it) => it.map_or(JSValue::NULL, |it| ClientObject::new(heap, it)),
        Outcome::Clients(all) => frozen(heap, all, ClientObject::new)?,
        Outcome::Subscriptions(all) => {
            let describe = |heap: &JsHeap<'a>, it: Subscription| {
                let item = heap.create_empty_object();
                it.name.into_iter().for_each(|it| {
                    item.to_js().put(
                        global_of(heap),
                        b"name",
                        DomString::from_utf8(text(&it)).to_js(heap).to_js(),
                    )
                });
                item.to_js().put(
                    global_of(heap),
                    b"url",
                    heap.create_latin1_string(it.url.href()).to_js(),
                );
                Ok(item.as_value())
            };
            heap.create_array(all, describe)?.to_js()
        }
        Outcome::Notifications(all) => {
            let list = JSValue::create_empty_array(cx.global(), 0)?;
            for it in &all {
                let it = Notification::restore(cx, it)?;
                list.push(cx.global(), it)?;
            }
            list
        }
    })
}

#[repr(C)]
pub(crate) struct Container {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_ServiceWorkerContainer::Fields,
    known: Held<Known>,
}

impl Container {
    /// A service worker has one that it does not see.
    #[optimize(size)]
    pub(crate) fn get<'a>(cx: Cx<'_, 'a>) -> &'a Container {
        if let Some(it) = Container::of_realm(&cx.heap) {
            return it;
        }
        let is_parsing = crate::api::core::seams::current_document(cx)
            .is_ok_and(|it| cx.heap.is_window() && it.ready_state() == ReadyState::Loading);
        let known = hold(
            &cx.heap,
            Known {
                messages: is_parsing.then(Vec::new),
                ..Default::default()
            },
        );
        let this = js_ServiceWorkerContainer::create(
            &cx.heap,
            Container {
                base: Default::default(),
                fields: Default::default(),
                known,
            },
        );
        this.set_of_realm(&cx.heap);
        let realm = exec::Realm::of(cx);
        let realm = hold(&cx.heap, realm);
        if let Some(client) = client_of(&cx.heap) {
            client.listen_to_service_workers(Rc::new(move |notice| {
                if let Some(realm) = &*realm.borrow() {
                    realm.enter(|cx| {
                        queue_task(&cx.heap, [], move |cx, []| {
                            Container::get(cx).receive(cx, notice)
                        })
                    });
                }
            }));
        }
        this
    }

    pub(crate) fn get_controller(&self, heap: &JsHeap<'_>) -> JSValue {
        let realm = self.realm(heap);
        client_of(realm)
            .and_then(|it| it.controller())
            .map_or(JSValue::NULL, |it| ServiceWorker::get(realm, it))
    }

    #[optimize(size)]
    fn receive<'a>(&'a self, cx: Cx<'_, 'a>, notice: Notice) {
        match notice {
            Notice::Settled(ticket, outcome) => {
                let promise = self
                    .known
                    .borrow_mut()
                    .as_mut()
                    .and_then(|it| it.promises.remove(&ticket));
                let Some(promise) =
                    promise.and_then(|it| JsLocal::new(&cx.heap, it.get()).as_promise())
                else {
                    return;
                };
                let settled = match value_of(cx, outcome) {
                    Ok(value) => promise.resolve(cx, value),
                    Err(error) => cx
                        .catch(error)
                        .and_then(|reason| promise.reject(cx, reason)),
                };
                exec::report(cx, settled);
            }
            Notice::Registration(info) => object_for::<Registration>(&cx.heap, info.id)
                .into_iter()
                .for_each(|it| it.set(&cx.heap, info.clone())),
            Notice::UpdateFound(id) => {
                _ = object_for::<Registration>(&cx.heap, id)
                    .map(|it| fire(cx, it, atom!("updatefound"), EventInit::default()))
            }
            Notice::State(id, state) => {
                if let Some(worker) = object_for::<ServiceWorker>(&cx.heap, id)
                    .filter(|it| it.state.replace(state) != state)
                {
                    fire(cx, worker, atom!("statechange"), EventInit::default());
                }
                if state == State::Redundant {
                    self.known
                        .borrow_mut()
                        .iter_mut()
                        .for_each(|it| _ = it.objects.remove(&id));
                }
            }
            Notice::Controller(_) => {
                _ = fire(cx, self, atom!("controllerchange"), EventInit::default())
            }
            Notice::Message(from, message) => {
                if let Some(waiting) = self
                    .known
                    .borrow_mut()
                    .as_mut()
                    .and_then(|it| it.messages.as_mut())
                {
                    return waiting.push(Notice::Message(from, message));
                }
                let origin = DomString::from_latin1(Origin::of(&from.url).as_bytes());
                if let Some(event) = MessageEvent::of(cx, message, origin, DomString::default()) {
                    event.set_source(ServiceWorker::get(&cx.heap, from));
                    dispatch(cx, self, event);
                }
            }
            Notice::Event(event, busy) => events::handle(cx, event, busy),
        }
    }

    pub(crate) fn get_ready<'a>(&'a self, cx: Cx<'_, 'a>) -> JSValue {
        js_ServiceWorkerContainer::ready(self).unwrap_or_else(|| {
            let ready = call(cx, self, Call::Ready)
                .ok()
                .unwrap_or_else(|| self.realm(&cx.heap).create_promise().to_js());
            js_ServiceWorkerContainer::set_ready(self, ready);
            ready
        })
    }

    /// <https://w3c.github.io/ServiceWorker/#start-register-algorithm>
    #[optimize(size)]
    pub(crate) fn register<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        script: JsLocal<'a>,
        options: &RegistrationOptions<'a>,
    ) -> Result<'a, JSValue> {
        let script = Trusted::ScriptUrl.string_in_realm_of(
            cx,
            Factory::for_realm(self.realm(&cx.heap)),
            script,
            "ServiceWorkerContainer register",
        )?;
        let checked = |url: Option<Url>| {
            let has_slash = |url: &Url| {
                [b"%2f", b"%5c"]
                    .iter()
                    .any(|it| strings::contains(&url.path().to_ascii_lowercase(), *it))
            };
            let url = url.filter(|it| {
                (it.is_http() || bun_web::service::is_allowed_at(it)) && !has_slash(it)
            });
            url.and_then(|it| Url::parse(it.without_fragment()))
                .ok_or_else(|| {
                    cx.heap.type_error(format_args!(
                        "The URL is invalid, or its scheme is not supported."
                    ))
                })
        };
        let script = checked(parse_url(self.realm(&cx.heap), &script))?;
        let scope = checked(match &options.scope {
            Some(given) => parse_url(self.realm(&cx.heap), &DomString::from_utf8(text(given))),
            None => script.join(b"./"),
        })?;
        let update_via_cache = match options.update_via_cache {
            ServiceWorkerUpdateViaCache::Imports => UpdateViaCache::Imports,
            ServiceWorkerUpdateViaCache::All => UpdateViaCache::All,
            ServiceWorkerUpdateViaCache::None => UpdateViaCache::None,
        };
        call(
            cx,
            self,
            Call::Register {
                scope,
                script,
                is_module: options.r#type == DomWorkerType::Module,
                update_via_cache,
            },
        )
    }

    pub(crate) fn get_registration<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        url: &DomString,
    ) -> Result<'a, JSValue> {
        let url = parse_url(self.realm(&cx.heap), url)
            .ok_or_else(|| cx.heap.type_error(format_args!("The URL is invalid.")))?;
        call(cx, self, Call::GetRegistration(url))
    }

    pub(crate) fn get_registrations<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::GetRegistrations)
    }

    pub(crate) fn start_messages<'a>(&'a self, cx: Cx<'_, 'a>) {
        let waiting = self
            .known
            .borrow_mut()
            .as_mut()
            .and_then(|it| it.messages.take());
        for notice in waiting.into_iter().flatten() {
            queue_task(self.realm(&cx.heap), [], move |cx, []| {
                Container::get(cx).receive(cx, notice)
            });
        }
    }

    pub(crate) fn get_onmessage<'a>(&'a self, cx: Cx<'_, 'a>) -> JSValue {
        self.handler(cx, &atom!("message").into())
    }

    pub(crate) fn set_onmessage<'a>(&'a self, cx: Cx<'_, 'a>, value: JsLocal<'a>) {
        self.set_handler(&cx.heap, &atom!("message").into(), value.to_js());
        self.start_messages(cx);
    }
}

pub(crate) fn document_was_parsed(cx: Cx<'_, '_>) {
    Container::of_realm(&cx.heap)
        .into_iter()
        .for_each(|it| it.start_messages(cx));
}

impl NavigatorOfServiceWorkers {
    pub(crate) fn get_service_worker<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, &'a Container> {
        let realm = self.realm(&cx.heap);
        if client_of(realm).is_some_and(|it| it.origin().is_opaque()) {
            return Err(dom_error(
                &cx.heap,
                DomError::SecurityError,
                "Service workers are denied to an opaque origin.",
            ));
        }
        let container = exec::with_realm(global_of(realm), |cx| Container::get(cx).to_js());
        Ok(Container::from_js(&cx.heap, container).expect("a container"))
    }
}

#[repr(C)]
pub(crate) struct ServiceWorker {
    pub(crate) base: EventTarget,
    id: Id,
    url: Url,
    state: Cell<State>,
}

impl ServiceWorker {
    fn get(heap: &JsHeap<'_>, WorkerInfo { id, url, state }: WorkerInfo) -> JSValue {
        object_for::<ServiceWorker>(heap, id)
            .map(JsInterface::to_js)
            .unwrap_or_else(|| {
                let this = js_ServiceWorker::create(
                    heap,
                    ServiceWorker {
                        base: Default::default(),
                        id,
                        url,
                        state: state.into(),
                    },
                )
                .to_js();
                remember(heap, id, this);
                this
            })
    }

    pub(crate) fn get_script_url(&self) -> &[u8] {
        self.url.href()
    }

    pub(crate) fn get_state(&self) -> &[u8] {
        self.state.get().as_bytes()
    }

    pub(crate) fn post_message<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        transfer: Objects<'a>,
    ) -> Result<'a> {
        post(cx, self, message, transfer, |it| {
            Call::PostToWorker(self.id, it)
        })
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

#[repr(C)]
pub(crate) struct Registration {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_ServiceWorkerRegistration::Fields,
    id: Id,
    scope: Url,
    update_via_cache: Cell<UpdateViaCache>,
}

impl Registration {
    fn get(heap: &JsHeap<'_>, info: RegistrationInfo) -> JSValue {
        object_for::<Registration>(heap, info.id)
            .map(JsInterface::to_js)
            .unwrap_or_else(|| {
                let (id, scope, update_via_cache) =
                    (info.id, info.scope.clone(), info.update_via_cache.into());
                let this = js_ServiceWorkerRegistration::create(
                    heap,
                    Registration {
                        base: Default::default(),
                        fields: Default::default(),
                        id,
                        scope,
                        update_via_cache,
                    },
                );
                remember(heap, id, this.to_js());
                this.set(heap, info);
                this.to_js()
            })
    }

    fn set(&self, heap: &JsHeap<'_>, mut info: RegistrationInfo) {
        let mut object = |slot: usize| {
            info.workers[slot]
                .take()
                .map_or(JSValue::ZERO, |it| ServiceWorker::get(heap, it))
        };
        js_ServiceWorkerRegistration::set_installing(self, object(INSTALLING));
        js_ServiceWorkerRegistration::set_waiting(self, object(WAITING));
        js_ServiceWorkerRegistration::set_active(self, object(ACTIVE));
        self.update_via_cache.set(info.update_via_cache);
    }

    pub(crate) fn get_navigation_preload<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> &'a NavigationPreloadManager {
        js_NavigationPreloadManager::create(self.realm(heap), NavigationPreloadManager(self.id))
    }

    pub(crate) fn get_scope(&self) -> &[u8] {
        self.scope.href()
    }

    pub(crate) fn get_update_via_cache(&self) -> &[u8] {
        self.update_via_cache.get().as_bytes()
    }

    pub(crate) fn update<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let realm = self.realm(&cx.heap);
        let own = client_of(realm)
            .and_then(|it| object_for::<ServiceWorker>(realm, it.as_service_worker()?.worker.id));
        if own.is_some_and(|it| matches!(it.state.get(), State::Parsed | State::Installing)) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "A worker that is being installed cannot be updated.",
            ));
        }
        call(cx, self, Call::Update(self.id))
    }

    pub(crate) fn unregister<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::Unregister(self.id))
    }
}

impl Registration {
    pub(crate) fn get_cookies<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CookieStoreManager {
        js_CookieStoreManager::create(
            self.realm(heap),
            CookieStoreManager(self.id, self.scope.clone().into()),
        )
    }

    pub(crate) fn get_push_manager<'a>(&'a self, heap: &JsHeap<'a>) -> &'a PushManager {
        js_PushManager::create(self.realm(heap), PushManager)
    }

    pub(crate) fn show_notification<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        title: DomString,
        options: &NotificationOptions<'a>,
    ) -> Result<'a, JSValue> {
        let shown = Notification::persistent(cx, title, options)?;
        call(cx, self, Call::ShowNotification(self.id, shown.into()))
    }

    pub(crate) fn get_notifications<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        filter: &GetNotificationOptions<'a>,
    ) -> Result<'a, JSValue> {
        call(
            cx,
            self,
            Call::GetNotifications(
                self.id,
                filter
                    .tag
                    .map(|it| DomString::from(it).to_utf8().into_owned())
                    .unwrap_or_default(),
            ),
        )
    }
}

/// With the scope.
pub(crate) struct CookieStoreManager(Id, Box<Url>);

impl CookieStoreManager {
    fn parse<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        given: JsList<'a, JsLocal<'a>>,
    ) -> Result<'a, Vec<Subscription>> {
        let global = global_of(heap);
        let parse = |it: CookieSubscription| {
            let url = it
                .url
                .map_or_else(|| Some((*self.1).clone()), |it| self.1.join(&it));
            let name = it.name.map(|it| strings::trim(&it, b"\t ").into());
            Ok(Subscription {
                name,
                url: url
                    .ok_or_else(|| global.throw_type_error(format_args!("The URL is invalid.")))?,
            })
        };
        Ok(given
            .iter()
            .map(|it| CookieSubscription::from_js(global, it.to_js()).and_then(parse))
            .collect::<bun_jsc::JsResult<_>>()?)
    }

    pub(crate) fn subscribe<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        given: JsList<'a, JsLocal<'a>>,
    ) -> Result<'a, JSValue> {
        let given = self.parse(&cx.heap, given)?;
        call(cx, self, Call::Subscribe(self.0, given))
    }

    pub(crate) fn unsubscribe<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        given: JsList<'a, JsLocal<'a>>,
    ) -> Result<'a, JSValue> {
        let given = self.parse(&cx.heap, given)?;
        call(cx, self, Call::Unsubscribe(self.0, given))
    }

    pub(crate) fn get_subscriptions<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::GetSubscriptions(self.0))
    }
}

/// There is no push service.
pub(crate) struct PushManager;

impl PushManager {
    pub(crate) fn subscribe<'a>(&'a self, cx: Cx<'_, 'a>, _: JsLocal<'a>) -> Result<'a, JSValue> {
        Err(dom_error(
            &cx.heap,
            DomError::AbortError,
            "Registration failed - push service not available",
        ))
    }

    pub(crate) fn get_subscription<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        Ok(cx.promise_resolve(JSValue::NULL)?.to_js())
    }

    pub(crate) fn permission_state<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        _: JsLocal<'a>,
    ) -> Result<'a, JSValue> {
        let state = cx.heap.create_latin1_string(b"denied").to_js();
        Ok(cx.promise_resolve(state)?.to_js())
    }
}

pub(crate) struct NavigationPreloadManager(Id);

impl NavigationPreloadManager {
    pub(crate) fn enable<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::Preload(self.0, Some(true), None))
    }

    pub(crate) fn disable<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::Preload(self.0, Some(false), None))
    }

    pub(crate) fn set_header_value<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: &DomString,
    ) -> Result<'a, JSValue> {
        let value = value.units().map(|it| it as u8).collect::<Vec<_>>();
        let value = strings::trim(&value, b"\t ");
        if !is_valid_value(value) {
            return Err(cx
                .heap
                .type_error(format_args!("The value is not valid for a header.")));
        }
        call(cx, self, Call::Preload(self.0, None, Some(value.into())))
    }

    pub(crate) fn get_state<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::Preload(self.0, None, None))
    }
}

const ID_PREFIX: &str = "00000000-0000-4000-8000-";

fn id_of_client(id: Option<Id>) -> DomString {
    id.map(|it| DomString::from_utf8(&format!("{ID_PREFIX}{it:012x}")))
        .unwrap_or_default()
}

pub(crate) struct ClientObject(Box<ClientInfo>, bindgen::Interior);

impl ClientObject {
    fn new(heap: &JsHeap<'_>, info: ClientInfo) -> JSValue {
        if info.kind != ClientKind::Window {
            return js_Client::create(heap, ClientObject(info.into(), Default::default())).to_js();
        }
        let ancestors = info.ancestors.clone();
        let this = js_WindowClient::create(
            heap,
            WindowClientObject {
                base: ClientObject(info.into(), Default::default()),
                fields: Default::default(),
            },
        );
        let ancestors = frozen(heap, ancestors, |heap, it| {
            heap.create_latin1_string(it.as_bytes()).to_js()
        });
        js_WindowClient::set_ancestor_origins(this, ancestors.unwrap_or(JSValue::UNDEFINED));
        this.to_js()
    }

    pub(crate) fn get_url(&self) -> &[u8] {
        self.0.url.href()
    }

    pub(crate) fn get_frame_type(&self) -> &[u8] {
        self.0
            .window
            .map_or(FrameType::None, |it| it.frame_type)
            .as_bytes()
    }

    pub(crate) fn get_id(&self) -> DomString {
        id_of_client(Some(self.0.id))
    }

    pub(crate) fn get_type(&self) -> &[u8] {
        self.0.kind.as_bytes()
    }

    pub(crate) fn post_message<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        transfer: Objects<'a>,
    ) -> Result<'a> {
        post(cx, self, message, transfer, |it| {
            Call::PostToClient(self.0.id, it)
        })
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

#[repr(C)]
pub(crate) struct WindowClientObject {
    pub(crate) base: ClientObject,
    pub(crate) fields: js_WindowClient::Fields,
}

impl WindowClientObject {
    pub(crate) fn get_visibility_state(&self) -> &[u8] {
        if self.base.0.window.is_some_and(|it| it.is_visible) {
            b"visible"
        } else {
            b"hidden"
        }
    }

    pub(crate) fn get_focused(&self) -> bool {
        self.base.0.window.is_some_and(|it| it.is_focused)
    }

    pub(crate) fn focus<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::Focus(self.base.0.id))
    }

    pub(crate) fn navigate<'a>(&'a self, cx: Cx<'_, 'a>, url: &DomString) -> Result<'a, JSValue> {
        let url = parse_url(&cx.heap, url)
            .filter(|it| it.scheme() != b"about")
            .ok_or_else(|| {
                cx.heap
                    .type_error(format_args!("The URL cannot be navigated to."))
            })?;
        call(cx, self, Call::Navigate(self.base.0.id, url))
    }
}

pub(crate) struct Clients;

impl Clients {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, id: &[u8]) -> Result<'a, JSValue> {
        let id = text(id)
            .strip_prefix(ID_PREFIX)
            .and_then(|it| Id::from_str_radix(it, 16).ok());
        call(cx, self, Call::GetClient(id.unwrap_or(0)))
    }

    pub(crate) fn match_all<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &ClientQueryOptions,
    ) -> Result<'a, JSValue> {
        let kind = match options.r#type {
            ClientType::Window => Some(ClientKind::Window),
            ClientType::Worker => Some(ClientKind::Worker),
            ClientType::Sharedworker => Some(ClientKind::SharedWorker),
            ClientType::All => None,
        };
        call(
            cx,
            self,
            Call::MatchAll {
                includes_uncontrolled: options.include_uncontrolled,
                kind,
            },
        )
    }

    pub(crate) fn open_window<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        url: &DomString,
    ) -> Result<'a, JSValue> {
        parse_url(&cx.heap, url)
            .ok_or_else(|| cx.heap.type_error(format_args!("The URL is invalid.")))?;
        Err(dom_error(
            &cx.heap,
            DomError::InvalidAccessError,
            "Not allowed to open a window.",
        ))
    }

    pub(crate) fn claim<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, self, Call::Claim)
    }
}

impl ServiceScope {
    pub(crate) fn get_clients<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Clients {
        let realm = self.realm(heap);
        Clients::of_realm(realm).unwrap_or_else(|| {
            let made = js_Clients::create(realm, Clients);
            made.set_of_realm(realm);
            made
        })
    }

    pub(crate) fn get_registration<'a>(&'a self, cx: Cx<'_, 'a>) -> JSValue {
        let own = realm_of(&cx.heap)
            .client()
            .and_then(|it| it.as_service_worker());
        own.map_or(JSValue::UNDEFINED, |it| {
            Registration::get(&cx.heap, it.registration)
        })
    }

    pub(crate) fn get_service_worker<'a>(&'a self, cx: Cx<'_, 'a>) -> JSValue {
        let own = realm_of(&cx.heap)
            .client()
            .and_then(|it| it.as_service_worker());
        own.map_or(JSValue::UNDEFINED, |it| {
            ServiceWorker::get(&cx.heap, it.worker)
        })
    }

    pub(crate) fn get_cookie_store<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CookieStore {
        store_of_service_worker(self.realm(heap))
    }

    pub(crate) fn skip_waiting<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        call(cx, &**self, Call::SkipWaiting)
    }
}

/// Before the script of a service worker runs.
pub(crate) fn set_up_service_worker(cx: Cx<'_, '_>) {
    let global = cx.global();
    let hide = |it: JSValue| {
        ["createObjectURL", "revokeObjectURL"]
            .into_iter()
            .try_for_each(|name| it.delete_property(global, name).map(drop))
    };
    let hidden = global
        .to_js_value()
        .get(global, "URL")
        .and_then(|it| it.map_or(Ok(()), hide));
    exec::report(cx, hidden.map_err(Into::into));
    Container::get(cx);
    if let Some(own) = client_of(&cx.heap).and_then(|it| it.as_service_worker()) {
        Registration::get(&cx.heap, own.registration);
        ServiceWorker::get(&cx.heap, own.worker);
    }
}
