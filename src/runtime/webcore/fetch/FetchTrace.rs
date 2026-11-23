//! Publishes a `fetch()` to the `undici:*` channels of `node:diagnostics_channel`. See `internal/undici_channels.ts`.

use core::net::SocketAddr;
use std::borrow::Cow;

use bun_core::String as BunString;
use bun_http::request_trace::{Event, Hop, RequestTrace};
use bun_http::{AsyncHTTP, Headers, Protocol};
use bun_http_jsc::method_jsc::MethodJsc as _;
use bun_jsc::{
    ArrayBuffer, JSGlobalObject, JSUint8Array, JSValue, JsCell, JsResult, StringJsc as _, Strong,
    StrongOptional, Weak, bun_string_jsc,
};
use bun_ptr::RefPtr;

/// Keep in sync with DiagnosticsHook.h
#[repr(i32)]
#[derive(Clone, Copy)]
enum RequestEvent {
    WantedChunks,
    Create,
    Connecting,
    HeadSent,
    BodyChunkSent,
    BodySent,
    ResponseHead,
    BodyChunkReceived,
    ResponseEnd,
    Error,
    Abort,
}

pub(crate) struct FetchTrace {
    pub(crate) events: RefPtr<RequestTrace>,
    publish: Strong,
    /// Of `AsyncLocalStorage`, as `fetch()` returned.
    stores: Weak<()>,
    /// `stores`, or a `WeakMap` whose keys keep them alive.
    root_of_stores: JsCell<StrongOptional>,
    error: StrongOptional,
    has_failed: bool,
    is_abort: bool,
}

/// What a [`FetchTrace`] is made from, while the channels have subscribers.
#[inline]
pub(crate) fn hook(global: &JSGlobalObject) -> Option<JSValue> {
    let hook = bun_jsc::cpp::Bun__requestDiagnosticsHook(global);
    (!hook.is_empty()).then_some(hook)
}

impl FetchTrace {
    /// Runs no subscriber.
    pub(crate) fn new<T>(
        global: &JSGlobalObject,
        hook: JSValue,
        on_event: fn(*mut T),
        context: *mut T,
    ) -> JsResult<Box<Self>> {
        let publish = hook.call_for_running_script(global, JSValue::UNDEFINED, &[])?;
        let wanted = publish
            .call_for_running_script(
                global,
                JSValue::UNDEFINED,
                &[number(RequestEvent::WantedChunks)],
            )?
            .to_int32();
        Ok(Box::new(Self {
            events: RequestTrace::new(on_event, context, wanted & 1 != 0, wanted & 2 != 0),
            publish: Strong::create(publish, global),
            stores: Weak::default(),
            root_of_stores: JsCell::new(StrongOptional::empty()),
            error: StrongOptional::empty(),
            has_failed: false,
            is_abort: false,
        }))
    }

    pub(crate) fn publisher(&self) -> Publisher {
        Publisher {
            publish: self.publish.get(),
            stores: self.stores.get().unwrap_or(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn capture_stores(&mut self, global: &JSGlobalObject) {
        let stores = bun_jsc::cpp::Bun__currentAsyncLocalStores(global);
        if stores.is_object() {
            self.stores = Weak::create_passive(stores, global);
            self.root_stores(global);
        }
    }

    pub(crate) fn root_stores(&self, global: &JSGlobalObject) {
        if let Some(stores) = self.stores.get() {
            self.root_of_stores
                .with_mut(|root| root.set(global, stores));
        }
    }

    /// For a `reader` whose collection ends the request: the stores may lead to it.
    pub(crate) fn tie_stores_to(&self, global: &JSGlobalObject, reader: JSValue) {
        if let (Some(stores), Some(root)) = (self.stores.get(), self.root_of_stores.get().get()) {
            let map = bun_jsc::cpp::Bun__addToWeakMap(global, root, reader, stores);
            self.root_of_stores.with_mut(|root| root.set(global, map));
        }
    }

    /// The first one counts.
    pub(crate) fn remember_error(
        &mut self,
        global: &JSGlobalObject,
        error: JSValue,
        is_abort: bool,
    ) {
        if !core::mem::replace(&mut self.has_failed, true) {
            self.error.set(global, error);
            self.is_abort = is_abort;
        }
    }

    pub(crate) fn has_failed(&self) -> bool {
        self.has_failed
    }

    pub(crate) fn take_error(&mut self) -> Option<(JSValue, bool)> {
        Some((self.error.try_swap()?, self.is_abort))
    }
}

/// A copy, because a subscriber can reach the tasklet that owns the [`FetchTrace`].
#[derive(Clone, Copy)]
pub(crate) struct Publisher {
    publish: JSValue,
    stores: JSValue,
}

impl Publisher {
    /// In the context of the caller of `fetch()`, which keeps what a subscriber enters.
    pub(crate) fn first_hop(
        self,
        global: &JSGlobalObject,
        request: &AsyncHTTP<'_>,
    ) -> JsResult<Option<Headers>> {
        let arguments = arguments_of_hop(global, &request.first_hop())?;
        let fields =
            (self.publish).call_for_running_script(global, JSValue::UNDEFINED, &arguments)?;
        headers_from_js(global, fields)
    }

    pub(crate) fn next_hop(self, global: &JSGlobalObject, hop: &Hop) -> JsResult<Option<Headers>> {
        let fields = self.call(global, &arguments_of_hop(global, hop)?)?;
        headers_from_js(global, fields)
    }

    pub(crate) fn error(
        self,
        global: &JSGlobalObject,
        error: JSValue,
        is_abort: bool,
    ) -> JsResult<()> {
        let arguments = [number(RequestEvent::Error), error, JSValue::from(is_abort)];
        self.call(global, &arguments).map(drop)
    }

    /// Runs no subscriber. They hear of it in a microtask.
    pub(crate) fn abort(self, global: &JSGlobalObject, reason: JSValue) -> JsResult<()> {
        self.call(global, &[number(RequestEvent::Abort), reason])
            .map(drop)
    }

    pub(crate) fn event(self, global: &JSGlobalObject, event: Event) -> JsResult<()> {
        let result = match event {
            Event::Connecting => self.call(global, &[number(RequestEvent::Connecting)]),
            Event::HeadSent {
                head,
                protocol,
                endpoints,
            } => {
                let version = match protocol {
                    Protocol::Http1_1 => 1,
                    Protocol::Http2 => 2,
                    Protocol::Http3 => 3,
                };
                let (local, remote) = endpoints.map_or((None, None), |of| (of.local, of.remote));
                let arguments = [
                    number(RequestEvent::HeadSent),
                    bun_string_jsc::owned_latin1_into_js(global, head)?,
                    JSValue::js_number_from_int32(version),
                    ip_to_js(global, remote)?,
                    port_to_js(remote),
                    ip_to_js(global, local)?,
                    port_to_js(local),
                ];
                self.call(global, &arguments)
            }
            Event::BodyChunkSent(chunk) => {
                let chunk = JSUint8Array::from_bytes(global, chunk)?;
                self.call(global, &[number(RequestEvent::BodyChunkSent), chunk])
            }
            Event::BodySent => self.call(global, &[number(RequestEvent::BodySent)]),
            Event::DeclaredLengthSent => {
                self.call(global, &[number(RequestEvent::BodySent), JSValue::TRUE])
            }
            Event::ResponseHead(response) => {
                let arguments = [
                    number(RequestEvent::ResponseHead),
                    JSValue::js_number_from_uint64(u64::from(response.status_code)),
                    bun_string_jsc::create_utf8_for_js(global, response.status_text())?,
                    headers_to_js(global, &response.headers, ArrayBuffer::create_buffer)?,
                ];
                self.call(global, &arguments)
            }
            Event::BodyChunkReceived(chunk) => {
                let chunk = JSValue::create_buffer_from_box(global, chunk)?;
                self.call(global, &[number(RequestEvent::BodyChunkReceived), chunk])
            }
            Event::ResponseEnd => self.call(global, &[number(RequestEvent::ResponseEnd)]),
            Event::Redirect(_) => unreachable!("for next_hop()"),
        };
        result.map(drop)
    }

    fn call(self, global: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<JSValue> {
        if self.publish.call_may_have_been_dropped(global) {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: `arguments` is a live slice.
        unsafe {
            bun_jsc::cpp::Bun__callInAsyncLocalStores(
                global,
                self.publish,
                self.stores,
                arguments.as_ptr(),
                arguments.len(),
            )
        }
    }
}

fn number(event: RequestEvent) -> JSValue {
    JSValue::js_number_from_int32(event as i32)
}

fn ip_to_js(global: &JSGlobalObject, address: Option<SocketAddr>) -> JsResult<JSValue> {
    match address {
        Some(address) => BunString::create_format(format_args!("{}", address.ip())).into_js(global),
        None => Ok(JSValue::UNDEFINED),
    }
}

fn port_to_js(address: Option<SocketAddr>) -> JSValue {
    address.map_or(JSValue::UNDEFINED, |address| {
        JSValue::js_number_from_int32(i32::from(address.port()))
    })
}

fn arguments_of_hop(global: &JSGlobalObject, hop: &Hop) -> JsResult<[JSValue; 7]> {
    Ok([
        number(RequestEvent::Create),
        hop.method.to_js(global),
        bun_string_jsc::create_utf8_for_js(global, &hop.origin)?,
        bun_string_jsc::create_utf8_for_js(global, &hop.path)?,
        headers_to_js(global, &hop.headers, |global, text| {
            BunString::clone_latin1(text).into_js(global)
        })?,
        JSValue::from(hop.has_body),
        (hop.content_length).map_or(JSValue::NULL, JSValue::js_number_from_uint64),
    ])
}

fn headers_to_js(
    global: &JSGlobalObject,
    headers: &Headers,
    to_js: fn(&JSGlobalObject, &[u8]) -> JsResult<JSValue>,
) -> JsResult<JSValue> {
    let fields = JSValue::create_empty_array(global, headers.entries.len() * 2)?;
    let texts = headers.iter().flat_map(|h| [h.name(), h.value()]);
    for (index, text) in texts.enumerate() {
        fields.put_index(global, index as u32, to_js(global, text)?)?;
    }
    Ok(fields)
}

/// `writeFields()` has validated them.
fn headers_from_js(global: &JSGlobalObject, fields: JSValue) -> JsResult<Option<Headers>> {
    if !fields.is_array() {
        return Ok(None);
    }
    let mut headers = Headers::default();
    let mut fields = fields.array_iterator(global)?;
    bun_core::handle_oom((headers.entries).ensure_total_capacity(fields.len as usize / 2));
    while let (Some(name), Some(value)) = (fields.next()?, fields.next()?) {
        let (name, value) = (name.to_bun_string(global)?, value.to_bun_string(global)?);
        headers.append(&bytes_of(&name), &bytes_of(&value));
    }
    Ok(Some(headers))
}

fn bytes_of(text: &BunString) -> Cow<'_, [u8]> {
    if text.is_utf16() {
        text.utf16().iter().map(|&unit| unit as u8).collect()
    } else {
        Cow::Borrowed(text.latin1())
    }
}
