//! What a service worker is told.

use bun_jsc::{JSGlobalObject, JsResult};
use bun_web::exec::{Either, Receiver, Sender, oneshot};
use bun_web::headers::{is_forbidden_method, is_token, normalize_method};
use bun_web::net::NetError;
use bun_web::net::cookies::Change;
use bun_web::net::response::Response as Fetched;
use bun_web::request::{Destination, Mode};
use bun_web::service::router::{Condition, DEEPEST_CONDITION, MOST_CONDITIONS, Route, Rule};
use bun_web::service::{Busy, Event as Told, Intercepted, Served, Source};
use bun_web::url_pattern::UrlPattern;

use super::*;
use crate::api::events::{Event, EventFlags, Trusted, WindowTarget, event_init};
use crate::api::messaging::{MessagePort, receive};
use crate::api::network::{Request, Response};
use crate::api::realm::{Kept, promise_for, spawn};
use crate::generated_bindgen::events::DesktopEventInit;

/// What waits for the promises of an event.
struct Extended {
    _busy: Busy,
    result: Option<Sender<bool>>,
}

#[repr(C)]
pub(crate) struct ExtendableEvent {
    pub(crate) base: Event,
    pending: Cell<u32>,
    has_failed: Cell<bool>,
    extended: RefCell<Held<Extended>>,
}

impl ExtendableEvent {
    fn base(name: impl Into<Atom>, init: EventInit, trusted: Trusted) -> ExtendableEvent {
        ExtendableEvent {
            base: Event::base(name, init, trusted),
            pending: 0.into(),
            has_failed: false.into(),
            extended: Default::default(),
        }
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DesktopEventInit,
    ) -> Result<'a, &'a Self> {
        Ok(structure.create(
            &cx.heap,
            ExtendableEvent::base(name, event_init!(init), Trusted::No),
        ))
    }

    fn end_unless_pending(&self) {
        if self.pending.get() == 0
            && !self.has(EventFlags::DISPATCHING)
            && let Some(result) = self.extended.borrow().take().and_then(|it| it.result)
        {
            result.send(!self.has_failed.get());
        }
    }

    /// <https://w3c.github.io/ServiceWorker/#extendableevent-add-lifetime-promise>
    fn extend<'a>(&'a self, cx: Cx<'_, 'a>, promise: JsLocal<'a, bun_jsc::JSPromise>) {
        self.extend_with(cx, promise, 1);
    }

    fn extend_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        promise: JsLocal<'a, bun_jsc::JSPromise>,
        rejection_fails: u64,
    ) {
        fn end<'a>(
            cx: Cx<'_, 'a>,
            [event, _]: [JsLocal<'a>; 2],
            has_failed: u64,
            _: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            if let Some(event) = ExtendableEvent::from_js(&cx.heap, event.to_js()) {
                event.has_failed.update(|it| it || has_failed == 1);
                event.pending.update(|it| it - 1);
                event.end_unless_pending();
            }
            Ok(JSValue::UNDEFINED)
        }
        fn settled<'a>(
            cx: Cx<'_, 'a>,
            [event, _]: [JsLocal<'a>; 2],
            has_failed: u64,
            _: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            cx.heap.queue_microtask(
                cx.heap
                    .create_callback(end, [event.to_js(), JSValue::UNDEFINED], has_failed),
                JSValue::UNDEFINED,
            );
            Ok(JSValue::UNDEFINED)
        }
        self.pending.update(|it| it + 1);
        let [fulfilled, rejected] = [0, rejection_fails].map(|it| {
            cx.heap
                .create_callback(settled, [self.to_js(), JSValue::UNDEFINED], it)
        });
        promise.react(&cx.heap, Some(fulfilled), Some(rejected));
    }

    /// Whatever becomes of `promise`.
    fn extend_quietly<'a>(&'a self, cx: Cx<'_, 'a>, promise: JsLocal<'a, bun_jsc::JSPromise>) {
        self.extend_with(cx, promise, 0);
    }

    pub(crate) fn wait_until<'a>(&'a self, cx: Cx<'_, 'a>, promise: JsLocal<'a>) -> Result<'a> {
        let promise = cx.promise_resolve(promise.to_js())?;
        if !self.is_trusted() || (self.pending.get() == 0 && !self.has(EventFlags::DISPATCHING)) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The event is over.",
            ));
        }
        self.extend(cx, promise);
        Ok(())
    }

    /// False if it was canceled.
    fn fire<'a>(&'a self, cx: Cx<'_, 'a>, busy: Busy, result: Option<Sender<bool>>) -> bool {
        self.extended.replace(hold(
            &cx.heap,
            Extended {
                _busy: busy,
                result,
            },
        ));
        let goes_on = WindowTarget::of_realm(&cx.heap).is_none_or(|it| dispatch(cx, it, self));
        self.end_unless_pending();
        goes_on
    }
}

#[repr(C)]
pub(crate) struct InstallEvent {
    pub(crate) base: ExtendableEvent,
}

impl InstallEvent {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DesktopEventInit,
    ) -> Result<'a, &'a Self> {
        Ok(structure.create(
            &cx.heap,
            InstallEvent {
                base: ExtendableEvent::base(name, event_init!(init), Trusted::No),
            },
        ))
    }
}

#[optimize(size)]
fn condition_of(
    global: &JSGlobalObject,
    value: JSValue,
    base: &Url,
    depth: usize,
    count: &Cell<usize>,
) -> JsResult<Condition> {
    let invalid = || global.throw_type_error(format_args!("The condition is invalid."));
    if depth > DEEPEST_CONDITION || count.replace(count.get() + 1) == MOST_CONDITIONS {
        return Err(invalid());
    }
    RouterCondition::from_js(global, value, |it| {
        let (not, pattern) = (
            Some(it.negated.to_js()).filter(|it| !it.is_undefined()),
            Some(it.url_pattern.to_js()).filter(|it| !it.is_undefined()),
        );
        let has_others = pattern.is_some()
            || it.request_method.is_some()
            || it.request_mode.is_some()
            || it.request_destination.is_some()
            || it.running_status.is_some();
        let method = it
            .request_method
            .map(|it| it.units().map(|it| it as u8).collect::<Vec<_>>());
        match (it.alternatives, not, has_others) {
            (Some(all), None, false) => all
                .iter()
                .map(|it| condition_of(global, it.to_js(), base, depth + 1, count))
                .collect::<JsResult<_>>()
                .map(Condition::Any),
            (None, Some(not), false) => Ok(Condition::Not(
                condition_of(global, not, base, depth + 1, count)?.into(),
            )),
            (None, None, true)
                if method
                    .as_ref()
                    .is_none_or(|it| is_token(it) && !is_forbidden_method(it)) =>
            {
                Ok(Condition::All {
                    pattern: pattern
                        .map(|it| UrlPattern::from_js(global, it, base).map(Box::new))
                        .transpose()?,
                    method: method.map(|it| (*normalize_method(&it)).into()),
                    mode: it
                        .request_mode
                        .map(|it| Mode::parse(&it).ok_or_else(invalid))
                        .transpose()?,
                    destination: it
                        .request_destination
                        .map(|it| Destination::parse(&it).ok_or_else(invalid))
                        .transpose()?,
                    is_running: it.running_status.map(|it| it == RunningStatus::Running),
                })
            }
            _ => Err(invalid()),
        }
    })
}

impl InstallEvent {
    #[optimize(size)]
    pub(crate) fn add_routes<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        rules: RouterRules<'a>,
    ) -> Result<'a, JSValue> {
        let (global, base) = (
            global_of(&cx.heap),
            client_of(&cx.heap).map(|it| it.url()).ok_or_else(|| {
                dom_error(
                    &cx.heap,
                    DomError::InvalidStateError,
                    "The context is not active.",
                )
            })?,
        );
        let handles_fetch =
            WindowTarget::of_realm(&cx.heap).is_some_and(|it| it.has_listeners(atom!("fetch")));
        let count = Cell::new(0);
        let rule_of = |it: JSValue| {
            RouterRule::from_js(global, it, |it| {
                let (route, cache_name) = match it.source {
                    RouterSource::Named(it) => (
                        Some(Route::Cache),
                        it.cache_name
                            .map(|it| crate::api::network::encode_cache_name(&it.into())),
                    ),
                    RouterSource::Keyword(it) => (Route::parse(&it), None),
                };
                let route = route.filter(|it| {
                    *it != Route::None
                        && (handles_fetch || matches!(it, Route::Cache | Route::Network))
                });
                let route = route.ok_or_else(|| {
                    global.throw_type_error(format_args!(
                        "The source is invalid, or there is no listener for fetch."
                    ))
                })?;
                Ok(Rule {
                    condition: condition_of(global, it.condition.to_js(), &base, 1, &count)?,
                    route,
                    cache_name,
                })
            })
        };
        let rules = match rules {
            RouterRules::Several(all) => all
                .iter()
                .map(|it| rule_of(it.to_js()))
                .collect::<JsResult<_>>()?,
            RouterRules::One(it) => vec![rule_of(it.to_js())?],
        };
        let added = call(cx, self, Call::AddRoutes(rules))?;
        if self.pending.get() > 0 || self.has(EventFlags::DISPATCHING) {
            JsLocal::new(&cx.heap, added)
                .as_promise()
                .into_iter()
                .for_each(|it| self.extend_quietly(cx, it));
        }
        Ok(added)
    }
}

type Answer = Option<bun_web::net::Result<Served>>;

#[repr(C)]
pub(crate) struct FetchEvent {
    pub(crate) base: ExtendableEvent,
    pub(crate) fields: js_FetchEvent::Fields,
    /// Of the client, the resulting one and the replaced one.
    ids: [DomString; 3],
    has_responded: Cell<bool>,
    answer: RefCell<Held<(Sender<Answer>, Busy)>>,
    /// Dropped with the answer.
    answering: Cell<Option<Sender<()>>>,
}

impl FetchEvent {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &FetchEventInit<'a>,
    ) -> Result<'a, &'a Self> {
        let (base, ids) = (
            ExtendableEvent::base(name, event_init!(init), Trusted::No),
            [
                &init.client_id,
                &init.resulting_client_id,
                &init.replaces_client_id,
            ]
            .map(Clone::clone),
        );
        let this = structure.create(
            &cx.heap,
            FetchEvent {
                base,
                fields: Default::default(),
                ids,
                has_responded: false.into(),
                answer: Default::default(),
                answering: None.into(),
            },
        );
        js_FetchEvent::set_request(this, init.request.to_js());
        js_FetchEvent::set_preload_response(
            this,
            cx.promise_resolve(init.preload_response.to_js())?.to_js(),
        );
        js_FetchEvent::set_handled(
            this,
            if init.handled.is_undefined() {
                cx.heap.create_promise()
            } else {
                cx.promise_resolve(init.handled.to_js())?
            }
            .to_js(),
        );
        Ok(this)
    }

    pub(crate) fn get_client_id(&self) -> &DomString {
        &self.ids[0]
    }

    pub(crate) fn get_resulting_client_id(&self) -> &DomString {
        &self.ids[1]
    }

    pub(crate) fn get_replaces_client_id(&self) -> &DomString {
        &self.ids[2]
    }

    fn answer<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        make: impl FnOnce(Cx<'_, 'a>, Busy) -> Answer,
    ) -> Result<'a> {
        let Some((sender, busy)) = self.answer.borrow().take() else {
            return Ok(());
        };
        self.answering.take();
        let answer = make(cx, busy);
        let has_failed = matches!(answer, Some(Err(_)));
        sender.send(answer);
        let Some(handled) =
            js_FetchEvent::handled(self).and_then(|it| JsLocal::new(&cx.heap, it).as_promise())
        else {
            return Ok(());
        };
        if !has_failed {
            return handled.resolve(cx, JSValue::UNDEFINED);
        }
        let error = cx.catch(dom_error(
            &cx.heap,
            DomError::NetworkError,
            "The event was not answered with a response.",
        ))?;
        handled.reject(cx, error)
    }

    pub(crate) fn respond_with<'a>(&'a self, cx: Cx<'_, 'a>, response: JsLocal<'a>) -> Result<'a> {
        fn settled<'a>(
            cx: Cx<'_, 'a>,
            [event, _]: [JsLocal<'a>; 2],
            has_failed: u64,
            value: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            let Some(event) = FetchEvent::from_js(&cx.heap, event.to_js()) else {
                return Ok(JSValue::UNDEFINED);
            };
            let response =
                Response::from_js(&cx.heap, value[0].to_js()).filter(|_| has_failed == 0);
            event.answer(cx, |cx, busy| {
                Some(
                    response
                        .and_then(|it| it.serve(cx, busy))
                        .ok_or(NetError::Failed),
                )
            })?;
            Ok(JSValue::UNDEFINED)
        }
        let promise = cx.promise_resolve(response.to_js())?;
        if !self.has(EventFlags::DISPATCHING) || self.has_responded.replace(true) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The event is over, or it has been responded to.",
            ));
        }
        self.extend(cx, promise);
        self.stop_immediate_propagation();
        let [fulfilled, rejected] = [0, 1].map(|it| {
            cx.heap
                .create_callback(settled, [self.to_js(), JSValue::UNDEFINED], it)
        });
        promise.react(&cx.heap, Some(fulfilled), Some(rejected));
        Ok(())
    }
}

fn preloaded<'a>(
    cx: Cx<'_, 'a>,
    preload: Option<Receiver<bun_web::net::Result<Fetched>>>,
) -> Result<'a, JSValue> {
    let Some(preload) = preload else {
        return Ok(cx.promise_resolve(JSValue::UNDEFINED)?.to_js());
    };
    let promise = promise_for(cx, preload, |cx, fetched| match fetched {
        Some(Ok(fetched)) => Ok(Response::of_fetched(&cx.heap, fetched, Box::new(())).to_js()),
        _ => Err(cx
            .heap
            .type_error(format_args!("The navigation preload request has failed."))),
    });
    JsLocal::new(&cx.heap, promise)
        .as_promise()
        .into_iter()
        .for_each(|it| it.mark_as_handled());
    Ok(promise)
}

#[optimize(size)]
fn handle_fetch<'a>(
    cx: Cx<'_, 'a>,
    Intercepted {
        request,
        client,
        resulting_client,
        preload,
        controller,
        answer,
    }: Intercepted,
    busy: Busy,
) -> Result<'a> {
    let base = ExtendableEvent::base(
        atom!("fetch"),
        EventInit {
            cancelable: true,
            ..Default::default()
        },
        Trusted::Yes,
    );
    let (ids, answer) = (
        [client, resulting_client, None].map(id_of_client),
        hold(&cx.heap, (answer, busy.clone().without_limit())).into(),
    );
    let event = js_FetchEvent::create(
        &cx.heap,
        FetchEvent {
            base,
            fields: Default::default(),
            ids,
            has_responded: false.into(),
            answer,
            answering: None.into(),
        },
    );
    client_of(&cx.heap)
        .filter(|_| request.may_become_code)
        .inspect(|it| it.was_asked_for_code(&request.url));
    let signal = cx.heap.create_abort_signal();
    js_FetchEvent::set_request(
        event,
        Request::intercepted(&cx.heap, request, signal).to_js(),
    );
    let (signal, (sender, answered)) = (Kept::new(cx, signal.to_js()), oneshot::<()>());
    event.answering.set(Some(sender));
    spawn(&cx.heap, async move {
        if let Either::First(()) = exec::race(controller.aborted(), answered).await {
            signal.queue_task(|cx, it| {
                it.as_abort_signal()
                    .into_iter()
                    .for_each(|it| it.abort(cx, JSValue::UNDEFINED))
            });
        }
    });
    js_FetchEvent::set_preload_response(event, preloaded(cx, preload)?);
    let handled = cx.heap.create_promise();
    handled.mark_as_handled();
    js_FetchEvent::set_handled(event, handled.to_js());
    let goes_on = event.fire(cx, busy, None);
    if event.has_responded.get() {
        Ok(())
    } else {
        event.answer(cx, |_, _| (!goes_on).then_some(Err(NetError::Failed)))
    }
}

#[repr(C)]
pub(crate) struct ExtendableMessageEvent {
    pub(crate) base: ExtendableEvent,
    pub(crate) fields: js_ExtendableMessageEvent::Fields,
    origin: DomString,
    last_event_id: DomString,
}

impl ExtendableMessageEvent {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &ExtendableMessageEventInit<'a>,
    ) -> Result<'a, &'a Self> {
        let source = init.source.map(JsLocal::to_js);
        if source.is_some_and(|it| {
            !MessagePort::is(it) && !ServiceWorker::is(it) && !ClientObject::is(it)
        }) {
            return Err(cx
                .heap
                .type_error(format_args!("Invalid source of a message.")));
        }
        let (base, origin, last_event_id) = (
            ExtendableEvent::base(name, event_init!(init), Trusted::No),
            init.origin.clone(),
            init.last_event_id.clone(),
        );
        let this = structure.create(
            &cx.heap,
            ExtendableMessageEvent {
                base,
                fields: Default::default(),
                origin,
                last_event_id,
            },
        );
        let ports = frozen(&cx.heap, init.ports.iter().collect(), |_, it| it.to_js())?;
        this.set(
            if init.data.is_undefined() {
                JSValue::NULL
            } else {
                init.data.to_js()
            },
            source.unwrap_or_default(),
            ports,
        );
        Ok(this)
    }

    fn set(&self, data: JSValue, source: JSValue, ports: JSValue) {
        js_ExtendableMessageEvent::set_data(self, data);
        js_ExtendableMessageEvent::set_source(self, source);
        js_ExtendableMessageEvent::set_ports(self, ports);
    }

    pub(crate) fn get_origin(&self) -> &DomString {
        &self.origin
    }

    pub(crate) fn get_last_event_id(&self) -> &DomString {
        &self.last_event_id
    }
}

#[optimize(size)]
fn handle_message<'a>(
    cx: Cx<'_, 'a>,
    source: Source,
    message: bun_web::channel::Message,
    busy: Busy,
) -> Result<'a> {
    let (name, data, ports) = match receive(cx, message) {
        Ok((data, ports)) => (atom!("message"), data, ports),
        Err(error) => (
            atom!("messageerror"),
            cx.catch(error).map(|_| JSValue::NULL)?,
            JSValue::ZERO,
        ),
    };
    let origin = client_of(&cx.heap)
        .map(|it| DomString::from_latin1(it.origin().as_bytes()))
        .unwrap_or_default();
    let base = ExtendableEvent::base(name, EventInit::default(), Trusted::Yes);
    let event = js_ExtendableMessageEvent::create(
        &cx.heap,
        ExtendableMessageEvent {
            base,
            fields: Default::default(),
            origin,
            last_event_id: DomString::default(),
        },
    );
    event.set(data, JSValue::ZERO, ports);
    let ports = if ports.is_empty() {
        frozen(&cx.heap, Vec::new(), |_, it| it)?
    } else {
        ports
    };
    let source = match source {
        Source::Client(it) => ClientObject::new(&cx.heap, it),
        Source::Worker(it) => ServiceWorker::get(&cx.heap, it),
    };
    event.set(data, source, ports);
    event.fire(cx, busy, None);
    Ok(())
}

#[repr(C)]
pub(crate) struct ExtendableCookieChangeEvent {
    pub(crate) base: ExtendableEvent,
    pub(crate) fields: js_ExtendableCookieChangeEvent::Fields,
}

impl ExtendableCookieChangeEvent {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &CookieChangeEventInit<'a>,
    ) -> Result<'a, &'a Self> {
        let this = structure.create(
            &cx.heap,
            ExtendableCookieChangeEvent {
                base: ExtendableEvent::base(name, event_init!(init), Trusted::No),
                fields: Default::default(),
            },
        );
        this.set(
            &cx.heap,
            [init.changed, init.deleted].map(|it| it.iter().map(JsLocal::to_js).collect()),
        )?;
        Ok(this)
    }

    fn set<'a>(&'a self, heap: &JsHeap<'a>, [changed, deleted]: [Vec<JSValue>; 2]) -> Result<'a> {
        js_ExtendableCookieChangeEvent::set_changed(self, frozen(heap, changed, |_, it| it)?);
        js_ExtendableCookieChangeEvent::set_deleted(self, frozen(heap, deleted, |_, it| it)?);
        Ok(())
    }
}

fn handle_cookie_change<'a>(cx: Cx<'_, 'a>, change: &Change, busy: Busy) -> Result<'a> {
    let base = ExtendableEvent::base(atom!("cookiechange"), EventInit::default(), Trusted::Yes);
    let (event, is_removed) = (
        js_ExtendableCookieChangeEvent::create(
            &cx.heap,
            ExtendableCookieChangeEvent {
                base,
                fields: Default::default(),
            },
        ),
        change.cause.removes(),
    );
    let item = describe_cookie(&cx.heap, &change.cookie, is_removed);
    event.set(
        &cx.heap,
        [!is_removed, is_removed].map(|it| it.then(|| item.to_js()).into_iter().collect()),
    )?;
    item.to_js().ensure_still_alive();
    event.fire(cx, busy, None);
    Ok(())
}

#[repr(C)]
pub(crate) struct NotificationEvent {
    pub(crate) base: ExtendableEvent,
    pub(crate) fields: js_NotificationEvent::Fields,
    action: DomString,
}

impl NotificationEvent {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &NotificationEventInit<'a>,
    ) -> Result<'a, &'a Self> {
        let this = structure.create(
            &cx.heap,
            NotificationEvent {
                base: ExtendableEvent::base(name, event_init!(init), Trusted::No),
                fields: Default::default(),
                action: init.action.clone(),
            },
        );
        js_NotificationEvent::set_notification(this, init.notification.to_js());
        Ok(this)
    }

    pub(crate) fn get_action(&self) -> &DomString {
        &self.action
    }
}

fn handle_notification<'a>(
    cx: Cx<'_, 'a>,
    about: &bun_web::service::Notification,
    is_click: bool,
    busy: Busy,
) -> Result<'a> {
    let base = ExtendableEvent::base(
        if is_click {
            atom!("notificationclick")
        } else {
            atom!("notificationclose")
        },
        EventInit::default(),
        Trusted::Yes,
    );
    let event = js_NotificationEvent::create(
        &cx.heap,
        NotificationEvent {
            base,
            fields: Default::default(),
            action: DomString::default(),
        },
    );
    js_NotificationEvent::set_notification(event, Notification::restore(cx, about)?);
    event.fire(cx, busy, None);
    Ok(())
}

pub(super) fn handle(cx: Cx<'_, '_>, event: Told, busy: Busy) {
    let handled = match event {
        Told::Lifecycle(State::Installing, result) => {
            let base = ExtendableEvent::base(atom!("install"), EventInit::default(), Trusted::Yes);
            js_InstallEvent::create(&cx.heap, InstallEvent { base }).fire(cx, busy, Some(result));
            Ok(())
        }
        Told::Lifecycle(_, result) => {
            js_ExtendableEvent::create(
                &cx.heap,
                ExtendableEvent::base(atom!("activate"), EventInit::default(), Trusted::Yes),
            )
            .fire(cx, busy, Some(result));
            Ok(())
        }
        Told::Fetch(intercepted) => handle_fetch(cx, *intercepted, busy),
        Told::Message(source, message) => handle_message(cx, source, message, busy),
        Told::CookieChange(change) => handle_cookie_change(cx, &change, busy),
        Told::Notification { about, is_click } => handle_notification(cx, &about, is_click, busy),
    };
    exec::report(cx, handled);
}
