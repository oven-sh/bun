//! <https://html.spec.whatwg.org/#web-messaging>

pub(crate) mod for_host;
pub(crate) mod program;
mod transfer;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{self, ClassStructure, JsHeap, JsInterface, JsList, JsLocal, JsScope};
use bun_jsc::{JSObject, JSValue};
use bun_web::channel::{Arrival, Broadcast, Endpoint, Message, Serialized};
use bun_web::exec;
use bun_web::held::Held;

pub(crate) use self::for_host::sender_of;
pub(crate) use self::transfer::{StreamEnd, receive, serialize};
use crate::api::core::*;
use crate::api::events::{Event, EventInit, Trusted, WindowTarget, dispatch, fire};
use crate::api::realm::{Kept, client_of, hold, realm_of};
use crate::generated_bindgen::messaging::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Objects<'a> = JsList<'a, JsLocal<'a, JSObject>>;

#[repr(C)]
pub(crate) struct MessageEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_DomMessageEvent::Fields,
    origin: RefCell<DomString>,
    last_event_id: RefCell<DomString>,
    /// Which opaque origin it is from.
    token: DomString,
}

fn check_source<'a>(cx: Cx<'_, 'a>, source: Option<JsLocal<'a, JSObject>>) -> Result<'a, JSValue> {
    let Some(source) = source.map(JsLocal::to_js) else {
        return Ok(JSValue::ZERO);
    };
    if MessagePort::is(source)
        || WindowTarget::of(&cx.heap, source).is_some()
        || source.js_type() == bun_jsc::JSType::GlobalProxy
    {
        Ok(source)
    } else {
        Err(cx
            .heap
            .type_error(format_args!("Invalid source of a message.")))
    }
}

fn frozen<'a>(
    heap: &JsHeap<'a>,
    ports: impl ExactSizeIterator<Item = JSValue>,
) -> Result<'a, JSValue> {
    Ok(heap
        .freeze_array(heap.create_array(ports, |heap, it| Ok(JsLocal::new(heap, it)))?)?
        .to_js())
}

impl MessageEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        name: Atom,
        data: JSValue,
        origin: DomString,
        last_event_id: DomString,
    ) -> &'a MessageEvent {
        MessageEvent::with_token(
            heap,
            name,
            data,
            origin,
            last_event_id,
            DomString::default(),
        )
    }

    fn with_token<'a>(
        heap: &JsHeap<'a>,
        name: Atom,
        data: JSValue,
        origin: DomString,
        last_event_id: DomString,
        token: DomString,
    ) -> &'a MessageEvent {
        let base = Event::base(name, EventInit::default(), Trusted::Yes);
        let this = js_DomMessageEvent::create(
            heap,
            MessageEvent {
                base,
                fields: Default::default(),
                origin: origin.into(),
                last_event_id: last_event_id.into(),
                token,
            },
        );
        js_DomMessageEvent::set_data(this, data);
        this
    }

    /// `message`, or `messageerror`.
    pub(crate) fn of<'a>(
        cx: Cx<'_, 'a>,
        message: Message,
        origin: DomString,
        token: DomString,
    ) -> Option<&'a MessageEvent> {
        let (name, data, ports) = match receive(cx, message) {
            Ok((data, ports)) => (atom!("message"), data, ports),
            Err(error) => (
                atom!("messageerror"),
                cx.catch(error).ok().map(|_| JSValue::NULL)?,
                JSValue::ZERO,
            ),
        };
        let this = MessageEvent::with_token(
            &cx.heap,
            name.into(),
            data,
            origin,
            DomString::default(),
            token,
        );
        js_DomMessageEvent::set_ports(this, ports);
        Some(this)
    }

    pub(crate) fn connect<'a>(
        heap: &JsHeap<'a>,
        port: &'a MessagePort,
    ) -> Result<'a, &'a MessageEvent> {
        let this = MessageEvent::new(
            heap,
            atom!("connect").into(),
            DomString::default().to_js(heap).to_js(),
            DomString::default(),
            DomString::default(),
        );
        js_DomMessageEvent::set_source(this, port.to_js());
        js_DomMessageEvent::set_ports(this, frozen(heap, [port.to_js()].into_iter())?);
        Ok(this)
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DomMessageEventInit<'a>,
    ) -> Result<'a, &'a Self> {
        let source = check_source(cx, init.source)?;
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        let (origin, last_event_id) = (
            init.origin.clone().into(),
            init.last_event_id.clone().into(),
        );
        let this = structure.create(
            &cx.heap,
            MessageEvent {
                base,
                fields: Default::default(),
                origin,
                last_event_id,
                token: DomString::default(),
            },
        );
        this.set(&cx.heap, init.data, source, init.ports)?;
        Ok(this)
    }

    fn set<'a>(
        &self,
        heap: &JsHeap<'a>,
        data: JsLocal<'a>,
        source: JSValue,
        ports: JsList<'a, &'a MessagePort>,
    ) -> Result<'a> {
        js_DomMessageEvent::set_data(
            self,
            if data.is_undefined() {
                JSValue::NULL
            } else {
                data.to_js()
            },
        );
        js_DomMessageEvent::set_source(self, source);
        js_DomMessageEvent::set_ports(self, frozen(heap, ports.iter().map(|it| it.to_js()))?);
        Ok(())
    }

    pub(crate) fn set_source(&self, source: JSValue) {
        js_DomMessageEvent::set_source(self, source);
    }

    pub(crate) fn get_data(&self) -> JSValue {
        js_DomMessageEvent::data(self).unwrap_or(JSValue::NULL)
    }

    pub(crate) fn get_origin(&self, _: &JsHeap<'_>) -> DomString {
        self.origin.borrow().clone()
    }

    pub(crate) fn get_last_event_id(&self, _: &JsHeap<'_>) -> DomString {
        self.last_event_id.borrow().clone()
    }

    pub(crate) fn get_ports<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        if let Some(ports) = js_DomMessageEvent::ports(self) {
            return Ok(ports);
        }
        let ports = frozen(self.realm(heap), core::iter::empty())?;
        js_DomMessageEvent::set_ports(self, ports);
        Ok(ports)
    }

    pub(crate) fn init_message_event<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: Atom,
        bubbles: bool,
        cancelable: bool,
        data: JsLocal<'a>,
        origin: DomString,
        last_event_id: DomString,
        source: Option<JsLocal<'a, JSObject>>,
        ports: JsList<'a, &'a MessagePort>,
    ) -> Result<'a> {
        let source = check_source(cx, source)?;
        if self.init(name, bubbles, cancelable) {
            self.origin.replace(origin);
            self.last_event_id.replace(last_event_id);
            self.set(&cx.heap, data, source, ports)?;
        }
        Ok(())
    }
}

/// `object` stays for as long as something can arrive.
pub(crate) fn listen<'a>(
    cx: Cx<'_, 'a>,
    endpoint: &Endpoint,
    object: JSValue,
    arrived: for<'b> fn(Cx<'_, 'b>, JsLocal<'b>),
) {
    let kept = Kept::new(cx, object);
    endpoint.listen(Rc::new(move || kept.queue_task(arrived)));
}

#[repr(C)]
pub(crate) struct MessagePort {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_DomMessagePort::Fields,
    /// Until it is detached.
    endpoint: Held<Endpoint>,
    is_started: Cell<bool>,
}

impl MessagePort {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, endpoint: Endpoint) -> &'a MessagePort {
        js_DomMessagePort::create(
            heap,
            MessagePort {
                base: Default::default(),
                fields: Default::default(),
                endpoint: hold(heap, endpoint),
                is_started: Cell::new(false),
            },
        )
    }

    pub(crate) fn detach(&self) -> Option<Endpoint> {
        self.endpoint.take().inspect(Endpoint::stop_listening)
    }

    fn arrived<'a>(cx: Cx<'_, 'a>, this: JsLocal<'a>) {
        let Some(this) = MessagePort::from_js(&cx.heap, this.to_js()) else {
            return;
        };
        let arrival = this.endpoint.borrow().as_ref().and_then(Endpoint::take);
        match arrival {
            Some(Arrival::Message(message)) => {
                let target = js_DomMessagePort::target(this)
                    .and_then(|it| EventTarget::resolve(&cx.heap, it))
                    .unwrap_or(this);
                MessageEvent::of(cx, message, DomString::default(), DomString::default())
                    .map(|it| dispatch(cx, target, it));
            }
            Some(Arrival::Closed) => {
                this.endpoint
                    .borrow()
                    .iter()
                    .for_each(Endpoint::stop_listening);
                fire(cx, this, atom!("close"), EventInit::default());
            }
            None => {}
        }
    }

    fn post<'a>(&self, cx: Cx<'_, 'a>, message: JsLocal<'a>, transfer: Objects<'a>) -> Result<'a> {
        if transfer.iter().any(|it| it.to_js() == self.to_js()) {
            return Err(dom_error(
                &cx.heap,
                DomError::DataCloneError,
                "A port cannot be transferred through itself.",
            ));
        }
        let message = serialize(cx, message.to_js(), transfer.iter().map(JsLocal::to_js))?;
        if let Some(it) = self.endpoint.borrow().as_ref() {
            it.send(message);
        }
        Ok(())
    }

    pub(crate) fn post_message<'a>(
        &self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        transfer: Objects<'a>,
    ) -> Result<'a> {
        self.post(cx, message, transfer)
    }

    pub(crate) fn post_message_with<'a>(
        &self,
        cx: Cx<'_, 'a>,
        message: JsLocal<'a>,
        options: &SerializeOptions<'a>,
    ) -> Result<'a> {
        self.post(cx, message, options.transfer)
    }

    pub(crate) fn start<'a>(&'a self, cx: Cx<'_, 'a>) {
        if !self.is_started.replace(true) {
            exec::with_realm(global_of(self.realm(&cx.heap)), |cx| {
                self.endpoint
                    .borrow()
                    .as_ref()
                    .map(|it| listen(cx, it, self.to_js(), MessagePort::arrived))
            });
        }
    }

    /// Its messages become those of `target`.
    pub(crate) fn forward<'a>(&'a self, cx: Cx<'_, 'a>, target: JSValue) {
        js_DomMessagePort::set_target(self, target);
        self.start(cx);
    }

    pub(crate) fn close(&self) {
        self.endpoint.take();
    }

    pub(crate) fn get_onmessage<'a>(&'a self, cx: Cx<'_, 'a>) -> JSValue {
        self.handler(cx, &atom!("message").into())
    }

    pub(crate) fn set_onmessage<'a>(&'a self, cx: Cx<'_, 'a>, value: JsLocal<'a>) {
        self.set_handler(&cx.heap, &atom!("message").into(), value.to_js());
        self.start(cx);
    }
}

#[derive(Default)]
pub(crate) struct MessageChannel {
    _interior: bindgen::Interior,
}

impl MessageChannel {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
    ) -> &'a Self {
        let (this, (first, second)) = (
            structure.create(heap, MessageChannel::default()),
            Endpoint::pair(),
        );
        js_DomMessageChannel::set_port1(this, Some(MessagePort::new(heap, first)));
        js_DomMessageChannel::set_port2(this, Some(MessagePort::new(heap, second)));
        this
    }
}

#[repr(C)]
pub(crate) struct BroadcastChannel {
    pub(crate) base: EventTarget,
    name: DomString,
    origin: DomString,
    joined: Held<Broadcast>,
}

impl BroadcastChannel {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: DomString,
    ) -> &'a Self {
        let client = client_of(&cx.heap);
        let origin = client
            .as_ref()
            .map(|it| DomString::from_latin1(it.origin().as_bytes()))
            .unwrap_or_default();
        let key = |partition: Vec<u8>| {
            partition
                .into_iter()
                .chain(*b"\n")
                .chain(name.units().flat_map(u16::to_le_bytes))
                .collect()
        };
        let joined = client
            .map(|it| hold(&cx.heap, Broadcast::join(key(it.partition_key()))))
            .unwrap_or_default();
        let this = structure.create(
            &cx.heap,
            BroadcastChannel {
                base: Default::default(),
                name,
                origin,
                joined,
            },
        );
        if let Some(it) = this.joined.borrow().as_ref() {
            listen(cx, &it.endpoint, this.to_js(), BroadcastChannel::arrived);
        }
        this
    }

    fn arrived<'a>(cx: Cx<'_, 'a>, this: JsLocal<'a>) {
        let Some(this) = BroadcastChannel::from_js(&cx.heap, this.to_js()) else {
            return;
        };
        let arrival = this
            .joined
            .borrow()
            .as_ref()
            .and_then(|it| it.endpoint.take());
        if let Some(Arrival::Message(message)) = arrival {
            MessageEvent::of(cx, message, this.origin.clone(), DomString::default())
                .map(|it| dispatch(cx, this, it));
        }
    }

    pub(crate) fn get_name(&self, _: &JsHeap<'_>) -> &DomString {
        &self.name
    }

    pub(crate) fn post_message<'a>(&self, cx: Cx<'_, 'a>, message: JsLocal<'a>) -> Result<'a> {
        if realm_of(self.realm(&cx.heap)).is_stopped() {
            return Ok(());
        }
        if self.joined.borrow().is_none() {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The channel is closed.",
            ));
        }
        let value = Serialized::new(cx.global(), message.to_js(), &[], &[])?;
        if let Some(it) = self.joined.borrow().as_ref() {
            it.send(&value);
        }
        Ok(())
    }

    pub(crate) fn close(&self) {
        self.joined.take();
    }
}
