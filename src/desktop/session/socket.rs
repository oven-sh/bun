//! `net.WebSocket`

use bun_jsc::webcore_types::Blob;
use bun_jsc::{DOMExceptionCode, JSGlobalObject};
use bun_web::convert::blob_from_js;
use bun_web::exec::{Either, race};
use bun_web::headers::{is_token, is_valid_value};
use bun_web::net::NetError;
use bun_web::net::body::{Data, Writer, pipe};
use bun_web::net::fetch::Controller;
use bun_web::net::web_socket::{Closed, Connection, Handshake, Kind, Outbox};
use bun_web::origin::Origin;
use bun_web::request::Request;
use bun_web::runtime::create_blob;
use bun_web::url::Url;

use super::Session;
use super::load::{Sender, bytes_of, from_record};
use crate::generated_bindgen::session::{SocketBinaryType, js_ElectronWebSocket as fields};
use crate::prelude::*;
use crate::value::Value;
use crate::webview::wire;
use crate::{realm, task};

unsafe extern "C" {
    safe fn Bun__Desktop__createEventTarget(
        global: &JSGlobalObject,
        prototype: JSValue,
        implementation: JSValue,
    ) -> JSValue;
    safe fn Bun__Desktop__dispatchEvent(target: JSValue, event: JSValue);
    safe fn Bun__Desktop__eventHandler(target: JSValue, event: u8) -> JSValue;
    safe fn Bun__Desktop__setEventHandler(target: JSValue, event: u8, handler: JSValue);
}

type Bytes = Box<[u8]>;

const CONNECTING: u16 = 0;
const OPEN: u16 = 1;
const CLOSING: u16 = 2;
const CLOSED: u16 = 3;

pub(crate) struct WebSocket {
    url: Url,
    state: Cell<u16>,
    binary_type: Cell<SocketBinaryType>,
    buffered: Cell<u64>,
    /// The subprotocol and the extensions.
    agreed: RefCell<(Bytes, Bytes)>,
    outbox: Outbox,
}

fn exception(code: DOMExceptionCode, message: core::fmt::Arguments<'_>) -> bun_jsc::JsError {
    global().throw_value(heap().create_dom_exception(code, message).to_js())
}

fn parse(given: &str) -> JsResult<Url> {
    let invalid = |message| Err(exception(DOMExceptionCode::SyntaxError, message));
    let Some(url) = Url::parse(given.as_bytes()) else {
        return invalid(format_args!("Invalid URL: '{given}'"));
    };
    if url.fragment().is_some() {
        return invalid(format_args!(
            "The URL contains a fragment identifier, which is not allowed."
        ));
    }
    match url.scheme() {
        b"http" => Ok(url.with_scheme(b"ws")),
        b"https" => Ok(url.with_scheme(b"wss")),
        b"ws" | b"wss" => Ok(url),
        other => invalid(format_args!(
            "The URL's scheme must be either 'ws', 'wss', 'http', or 'https'. '{}' is not allowed.",
            string(other)
        )),
    }
}

fn protocols_in(given: &Value) -> JsResult<Vec<Bytes>> {
    let listed = match given {
        Value::List(all) => all,
        one if one.is_nothing() => &[][..],
        one => core::slice::from_ref(one),
    };
    let mut protocols = Vec::<Bytes>::new();
    for protocol in listed.iter().map(Value::display) {
        let problem = if !is_token(protocol.as_bytes()) {
            "invalid"
        } else if (protocols.iter()).any(|it| it.eq_ignore_ascii_case(protocol.as_bytes())) {
            "duplicated"
        } else {
            protocols.push(protocol.as_bytes().into());
            continue;
        };
        return Err(exception(
            DOMExceptionCode::SyntaxError,
            format_args!("The subprotocol '{protocol}' is {problem}."),
        ));
    }
    Ok(protocols)
}

enum Failure {
    Connection(NetError),
    Handshake { status: u16, error: NetError },
    Lost,
}

impl Failure {
    fn reason(&self) -> String {
        match *self {
            Failure::Connection(error) => {
                format!("Error in connection establishment: {}", error.message())
            }
            Failure::Handshake { status, error } => {
                let problem = match status {
                    101 => "Invalid response".to_owned(),
                    _ => format!("Unexpected response code: {status}"),
                };
                let message = error.message();
                format!("Error during WebSocket handshake: {problem} ({message})")
            }
            Failure::Lost => String::new(),
        }
    }
}

async fn connect(
    session: &Session,
    (handshake, request, uplink): (Handshake, Request, Writer),
    origin: Origin,
    protocols: &[Bytes],
) -> Result<Connection, Failure> {
    let sender = Sender {
        origin: Some(origin),
        ..Default::default()
    };
    let response = (session.load(request, sender, &(), &Controller::default()))
        .await
        .map_err(Failure::Connection)?;
    let status = response.head.status;
    let accepted = handshake.finish(response, protocols);
    (accepted.and_then(|it| it.connect(uplink)))
        .map_err(|error| Failure::Handshake { status, error })
}

macro_rules! handlers {
    ($($get:ident $set:ident $event:literal),* $(,)?) => {$(
        pub(crate) fn $get(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
            Ok(Bun__Desktop__eventHandler(self.target(), $event))
        }

        pub(crate) fn $set<'a>(&self, _: Cx<'a, '_>, handler: JsLocal<'a>) -> JsResult<()> {
            Bun__Desktop__setEventHandler(self.target(), $event, handler.to_js());
            Ok(())
        }
    )*};
}

impl WebSocket {
    pub(crate) fn constructor<'a>(
        _: Cx<'a, '_>,
        new_target: JsLocal<'a, JSObject>,
        url: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (url, options) = (parse(&text_of(url.to_js())?)?, options.to_js());
        let has_members = options.is_object() && !options.is_array();
        let member = |name| match has_members {
            true => get(options, name),
            false => Ok(JSValue::UNDEFINED),
        };
        let data = |name| wire::data_from_js(member(name)?);
        let protocols = protocols_in(&if has_members {
            data("protocols")?
        } else {
            wire::data_from_js(options)?
        })?;
        let headers = from_record(&data("headers")?);
        if !(headers.iter()).all(|it| is_token(it.0) && is_valid_value(it.1)) {
            return Err(type_error(format_args!("Invalid header name or value")));
        }
        let session = match cast::<Session>(member("session")?) {
            Some(session) => session,
            None => super::from_partition(data("partition")?.text())?,
        };
        let (uplink, frames) = pipe(0);
        let (handshake, mut request) = Handshake::start(&url, &protocols, frames);
        (headers.iter())
            .filter(|it| !it.0.eq_ignore_ascii_case(b"origin"))
            .for_each(|it| request.headers.set_if_absent(it.0, it.1));
        request.omits_cookies = !data("useSessionCookies")?.is_truthy();
        let origin = data("origin")?.as_text().map_or_else(
            || Origin::of(&request.url),
            |it| Origin::from_serialized(it.as_bytes()),
        );
        let socket = WebSocket {
            url,
            state: CONNECTING.into(),
            binary_type: SocketBinaryType::NodeBuffer.into(),
            buffered: Default::default(),
            agreed: Default::default(),
            outbox: Default::default(),
        };
        let prototype = Some(get(new_target.to_js(), "prototype")?)
            .filter(|it| it.is_object())
            .unwrap_or_else(|| fields::CLASS.prototype(heap()));
        let socket = fields::create(heap(), socket);
        let target = Bun__Desktop__createEventTarget(global(), prototype, socket.to_js());
        fields::set_target(socket, target);
        let socket = Root::new(socket);
        bun_web::exec::spawn(async move {
            let connected = connect(session, (handshake, request, uplink), origin, &protocols);
            let closed = socket.get().run(connected);
            let closed = bun_web::exec::never_at_once(closed).await;
            task::report(socket.get().end(closed));
        });
        Ok(target)
    }

    fn target(&self) -> JSValue {
        fields::target(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn fire(&self, class: &str, name: &str, init: JSValue) -> JsResult<()> {
        let event = realm::construct(class, &[js(name)?, init])?;
        bun_jsc::from_js_host_call_generic(global(), || {
            Bun__Desktop__dispatchEvent(self.target(), event);
        })
    }

    /// Why it has failed, unless it was given up.
    async fn run(
        &self,
        connected: impl Future<Output = Result<Connection, Failure>>,
    ) -> Result<Closed, Option<Failure>> {
        let Either::First(connection) = race(connected, self.outbox.closed()).await else {
            return Err(None);
        };
        let connection = connection?;
        (self.agreed).replace((connection.protocol.clone(), connection.extensions.clone()));
        self.state.set(OPEN);
        task::report(self.fire("Event", "open", JSValue::UNDEFINED));
        let received = |kind, data| task::report(self.receive(kind, data));
        let sent = |length| self.buffered.update(|it| it - length);
        let closing = || self.state.set(CLOSING);
        (connection.run(&self.outbox, received, sent, closing).await).ok_or(Some(Failure::Lost))
    }

    fn receive(&self, kind: Kind, data: Vec<u8>) -> JsResult<()> {
        if self.state.get() != OPEN {
            return Ok(());
        }
        let data = match (kind, self.binary_type.get()) {
            (Kind::Text, _) => bun_jsc::bun_string_jsc::owned_utf8_into_js(global(), data)?,
            (_, SocketBinaryType::NodeBuffer) => buffer(&data)?,
            (_, SocketBinaryType::Blob) => create_blob(global(), data, b""),
            (_, SocketBinaryType::ArrayBuffer) => {
                bun_jsc::ArrayBuffer::create::<{ bun_jsc::JSType::ArrayBuffer }>(global(), &data)?
            }
        };
        let init = object!({ "data": data, "origin": string(Origin::of(&self.url).as_bytes()) });
        self.fire("MessageEvent", "message", init)
    }

    fn end(&self, closed: Result<Closed, Option<Failure>>) -> JsResult<()> {
        self.state.set(CLOSED);
        if let Err(Some(_)) = closed {
            self.fire("Event", "error", JSValue::UNDEFINED)?;
        }
        let was_clean = closed.is_ok();
        let (code, reason) = closed.map_or_else(
            |it| (1006, it.map_or_else(String::new, |it| it.reason())),
            |it| (it.code, string(&it.reason)),
        );
        let init = object!({ "code": u32::from(code), "reason": reason, "wasClean": was_clean });
        self.fire("CloseEvent", "close", init)
    }

    handlers!(
        get_onopen set_onopen 0,
        get_onmessage set_onmessage 1,
        get_onerror set_onerror 2,
        get_onclose set_onclose 3,
    );

    pub(crate) fn get_url(&self) -> &[u8] {
        self.url.href()
    }

    pub(crate) fn get_ready_state(&self) -> u16 {
        self.state.get()
    }

    pub(crate) fn get_buffered_amount(&self) -> f64 {
        self.buffered.get() as f64
    }

    pub(crate) fn get_protocol(&self) -> String {
        string(&self.agreed.borrow().0)
    }

    pub(crate) fn get_extensions(&self) -> String {
        string(&self.agreed.borrow().1)
    }

    pub(crate) fn get_binary_type(&self) -> SocketBinaryType {
        self.binary_type.get()
    }

    pub(crate) fn set_binary_type(&self, value: SocketBinaryType) {
        self.binary_type.set(value);
    }

    pub(crate) fn close(
        &self,
        _: Cx<'_, '_>,
        code: Option<u16>,
        reason: Option<&[u8]>,
    ) -> JsResult<()> {
        if let Some(code) = code.filter(|it| !matches!(it, 1000 | 3000..=4999)) {
            return Err(exception(
                DOMExceptionCode::InvalidAccessError,
                format_args!(
                    "The close code must be either 1000, or between 3000 and 4999. {code} is neither."
                ),
            ));
        }
        if reason.is_some_and(|it| it.len() > 123) {
            return Err(exception(
                DOMExceptionCode::SyntaxError,
                format_args!("The close reason must not be greater than 123 UTF-8 bytes."),
            ));
        }
        if self.state.get() < CLOSING {
            self.state.set(CLOSING);
            self.outbox.close(code, reason.unwrap_or_default());
        }
        Ok(())
    }

    pub(crate) fn send<'a>(&self, _: Cx<'a, '_>, data: JsLocal<'a>) -> JsResult<()> {
        if self.state.get() == CONNECTING {
            return Err(exception(
                DOMExceptionCode::InvalidStateError,
                format_args!("Still in CONNECTING state."),
            ));
        }
        let data = data.to_js();
        let (kind, data) = if let Some(blob) = data.as_class_ref::<Blob>() {
            let blob = blob_from_js(&blob)
                .ok_or_else(|| type_error(format_args!("The blob cannot be read.")))?;
            (Kind::Binary, blob.data)
        } else if let Some(bytes) = bytes_of(data) {
            (Kind::Binary, Data::Bytes(bytes.into()))
        } else {
            (Kind::Text, Data::Bytes(text_of(data)?.into_bytes().into()))
        };
        self.buffered.update(|it| it + data.len());
        if self.state.get() == OPEN {
            self.outbox.send(kind, data);
        }
        Ok(())
    }
}
