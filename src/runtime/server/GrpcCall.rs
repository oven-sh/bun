//! The server side of gRPC: <https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md>

use core::cell::Cell;
use std::borrow::Cow;
use std::io::Write as _;

use bstr::BStr;
use bun_core::{Timespec, TimespecMockMode, strings};
use bun_event_loop::EventLoopTimer::{OwnedTimer, State as TimerState, Tag as TimerTag};
use bun_http::Headers;
use bun_http_jsc::headers_jsc::try_from_fetch_headers;
use bun_http_types::ETag::Header;
use bun_jsc::bindgen::{JsHeap, JsScope};
use bun_jsc::{
    ArrayBuffer, ContextId, FetchHeaders, GlobalRef, JSUint8Array, JSValue, JsCell, JsRef, JsResult,
};
use bun_ptr::RefPtr;
use bun_removable_features::removable_definition;
use bun_uws_sys::response::WriteResult;
use bun_uws_sys::{AnyResponse, h2};
use bun_zlib::inflate::{Container, Status as InflateStatus};
use bun_zlib::{GZIP_ID, Inflater};

use super::{AnyServer, PendingRequest};
use crate::generated_bindgen::grpc_binding::{js_GrpcCall as js, js_GrpcRoute};
use crate::socket::socket_address::SocketAddress;
use crate::webcore::response::HeadersRef;

mod status {
    pub(super) const CANCELLED: u8 = 1;
    pub(super) const UNKNOWN: u8 = 2;
    pub(super) const DEADLINE_EXCEEDED: u8 = 4;
    pub(super) const RESOURCE_EXHAUSTED: u8 = 8;
    pub(super) const UNIMPLEMENTED: u8 = 12;
    pub(super) const INTERNAL: u8 = 13;
}

const PREFIX_LENGTH: usize = 5;
/// The client is held back once this many bytes of requests wait for the handler.
const HIGH_WATER_MARK: usize = 64 * 1024;
const LONGEST_TIMER_MS: u64 = i32::MAX as u64;
/// Clients commonly refuse more than 8 KiB of trailers, some by closing the connection.
const LONGEST_STATUS_MESSAGE: usize = 4096;

#[derive(Clone, Copy)]
pub(crate) struct GrpcMethod {
    pub(crate) request_stream: bool,
    /// The most bytes in a request message.
    pub(crate) limit: u32,
    pub(crate) is_implemented: bool,
}

/// A value in the `routes` of `Bun.serve()`.
pub(crate) struct GrpcRoute {
    pub(crate) method: GrpcMethod,
}

impl GrpcRoute {
    pub(crate) fn start(route: JSValue) -> Option<JSValue> {
        js_GrpcRoute::start_get_cached(route)
    }
}

struct Failure {
    code: u8,
    message: Cow<'static, str>,
}

impl Failure {
    fn new(code: u8, message: impl Into<Cow<'static, str>>) -> Self {
        let message = message.into();
        Self { code, message }
    }

    fn truncated() -> Self {
        let message = "The stream ended in the middle of a message";
        Self::new(status::INTERNAL, message)
    }

    fn not_one_message() -> Self {
        let message = "The request does not have exactly one message";
        Self::new(status::UNIMPLEMENTED, message)
    }
}

/// `Event` in `grpc.ts`.
#[derive(Clone, Copy)]
enum Event {
    Readable,
    Writable,
    Interrupted,
}

enum Encoding {
    Identity,
    Gzip,
    Deflate,
    Unsupported(Box<[u8]>),
}

enum Next<'a> {
    Incomplete,
    TooLong,
    Message { flag: u8, bytes: &'a [u8] },
}

struct Stream {
    response: *mut h2::Response,
    server: PendingRequest,
    /// For the callbacks of `response` and for the timer.
    _call: RefPtr<GrpcCall>,
}

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct GrpcCall {
    ref_count: Cell<u32>,
    /// Strong while there is a `stream`.
    pub(crate) this_value: JsCell<JsRef>,
    global: GlobalRef,
    context: ContextId,
    /// `None` once the call has ended.
    stream: JsCell<Option<Stream>>,
    pub(crate) deadline: OwnedTimer,
    request_stream: bool,
    limit: usize,
    encoding: Encoding,
    /// The path, the host, and each name and value of the metadata, all followed by a NUL.
    head: Vec<u8>,
    received: JsCell<Vec<u8>>,
    consumed: Cell<usize>,
    has_last_request: Cell<bool>,
    waits_for_request: Cell<bool>,
    holds_window: Cell<bool>,
    wrote_headers: Cell<bool>,
    /// What ended the call, if the handler did not.
    interruption: JsCell<Option<Failure>>,
}

impl GrpcCall {
    #[inline(never)]
    pub(crate) fn accept(
        server: AnyServer,
        server_js: JSValue,
        method: GrpcMethod,
        start: JSValue,
        request: &mut h2::Request,
        response: &mut h2::Response,
    ) {
        removable_definition!(ServeHttp2, GrpcCall::accept);
        if !is_grpc(request) {
            response.write_status(b"415 Unsupported Media Type");
            return response.end_without_body(false);
        }
        if !method.is_implemented {
            return end_with_status(response, status::UNIMPLEMENTED, NOT_IMPLEMENTED);
        }

        let mut head = Vec::with_capacity(256);
        let mut append = |field: &[u8]| {
            head.extend_from_slice(field);
            head.push(0);
        };
        append(
            strings::split(request.url(), b"?")
                .next()
                .unwrap_or_default(),
        );
        append(request.header(b"host").unwrap_or_default());
        let (mut encoding, mut timeout) = (Encoding::Identity, Ok(None));
        h2::for_each_header(request, |name, value| match name {
            b"host" => {}
            b"grpc-encoding" => encoding = Encoding::from(value),
            b"grpc-timeout" => timeout = parse_timeout(value).map(Some),
            _ if is_field_of_one_message(name) => {}
            _ => {
                append(name);
                append(value);
            }
        });
        let timeout = match timeout {
            Ok(timeout) => timeout,
            Err(Failure { code, message }) => {
                return end_with_status(response, code, message.as_bytes());
            }
        };

        let (global, config) = (server.global_this(), server.config());
        let call = RefPtr::new(GrpcCall {
            ref_count: Cell::new(1),
            this_value: JsCell::new(JsRef::empty()),
            global: GlobalRef::new(global),
            context: server.context_id(),
            stream: JsCell::new(None),
            deadline: OwnedTimer::init_paused(TimerTag::GrpcDeadline),
            request_stream: method.request_stream,
            limit: config.max_request_body_size.min(method.limit as usize),
            encoding,
            head,
            received: JsCell::new(Vec::new()),
            consumed: Cell::new(0),
            has_last_request: Cell::new(false),
            waits_for_request: Cell::new(false),
            holds_window: Cell::new(false),
            wrote_headers: Cell::new(false),
            interruption: JsCell::new(None),
        });
        let wrapper = js::wrap(call.clone(), global);
        wrapper.set_js_ref_strong(global);
        js::start_set_cached(wrapper.to_js(), global, start);
        js::server_set_cached(wrapper.to_js(), global, server_js);

        if let Some(timeout) = timeout {
            // The timer of a socket ticks every 4 seconds.
            let seconds = (timeout.div_ceil(1000) + 4).min(255) as u8;
            if config.idle_timeout != 0 && seconds > config.idle_timeout {
                response.timeout(seconds);
            }
            if timeout <= LONGEST_TIMER_MS {
                let due = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, timeout as i64);
                call.deadline.next.set(due);
                // SAFETY: `Stream` keeps the call where it is until `detach` has disarmed the timer.
                unsafe {
                    let timer = OwnedTimer::node(&raw const (*call.as_ptr()).deadline);
                    server.vm().timer_insert(timer);
                }
            }
        }

        let response = core::ptr::from_mut(response);
        call.stream.set(Some(Stream {
            response,
            server: PendingRequest::new(server),
            _call: call.clone(),
        }));
        let response = AnyResponse::H2(response);
        response.on_aborted_ref(|call: RefPtr<Self>, _| call.on_aborted(), &call);
        response.on_data(
            |call: *mut Self, chunk: &[u8], is_last| {
                // SAFETY: `Stream` holds a ref until `detach` has cleared this handler.
                unsafe { RefPtr::init_ref(call) }.on_data(chunk, is_last);
            },
            call.as_ptr(),
        );

        if method.request_stream {
            call.start(JSValue::UNDEFINED);
        }
    }

    fn response(&self) -> Option<AnyResponse> {
        let stream = self.stream.get().as_ref();
        stream.map(|it| AnyResponse::H2(it.response))
    }

    fn start(&self, request: JSValue) {
        let Some(this) = self.this_value.get().try_get() else {
            return;
        };
        let Some(start) = js::start_take_cached(this, &self.global) else {
            return;
        };
        let result = (self.global.bun_vm().event_loop()).run_callback_with_result(
            ContextId::NONE,
            start,
            &self.global,
            JSValue::UNDEFINED,
            &[this, request],
        );
        if result.is_empty() {
            self.interrupt(Failure::new(status::UNKNOWN, "Unknown error"));
        }
    }

    fn notify(&self, this: Option<JSValue>, event: Event) {
        let Some(listener) = this.and_then(js::listener_get_cached) else {
            return;
        };
        if !listener.is_callable() {
            return;
        }
        let vm = self.global.bun_vm();
        vm.event_loop().run_callback(
            self.context,
            listener,
            &self.global,
            JSValue::UNDEFINED,
            &[JSValue::js_number(f64::from(event as u8))],
        );
        if vm.is_inside_deferred_task_queue.get() {
            // The microtasks of the listener have not run, and the loop may be about to sleep.
            vm.event_loop().wakeup();
        }
    }

    fn on_data(&self, chunk: &[u8], is_last: bool) {
        self.has_last_request.set(is_last);
        if !self.request_stream {
            return self.on_data_of_only_request(chunk, is_last);
        }
        self.received.with_mut(|received| {
            let consumed = self.consumed.get();
            if consumed > received.len() / 2 {
                received.drain(..consumed);
                self.consumed.set(0);
            }
            received.extend_from_slice(chunk);
        });
        if self.waits_for_request.get() && (is_last || self.has_next()) {
            self.waits_for_request.set(false);
            self.notify(self.this_value.get().try_get(), Event::Readable);
        }
        self.control_flow();
    }

    fn on_data_of_only_request(&self, chunk: &[u8], is_last: bool) {
        let mut received = self.received.take();
        let body = if is_last && received.is_empty() {
            chunk
        } else {
            received.extend_from_slice(chunk);
            &received
        };
        let failure = match self.next(body) {
            Next::TooLong => self.too_long(),
            Next::Message { bytes, .. } if body.len() > PREFIX_LENGTH + bytes.len() => {
                Failure::not_one_message()
            }
            Next::Message { flag, bytes } if is_last => match self.message_to_js(flag, bytes) {
                Ok(Ok(request)) => return self.start(request),
                Ok(Err(failure)) => failure,
                Err(error) => {
                    crate::dispatch::fold(Err(error));
                    Failure::new(status::RESOURCE_EXHAUSTED, "Out of memory")
                }
            },
            Next::Message { .. } => return self.received.set(received),
            Next::Incomplete if is_last && body.is_empty() => Failure::not_one_message(),
            Next::Incomplete if is_last => Failure::truncated(),
            Next::Incomplete => {
                if let Some(response) = self.response() {
                    response.grow_request_window();
                }
                return self.received.set(received);
            }
        };
        self.interrupt(failure);
    }

    fn unread(&self) -> &[u8] {
        &self.received.get()[self.consumed.get()..]
    }

    fn has_next(&self) -> bool {
        !matches!(self.next(self.unread()), Next::Incomplete)
    }

    fn next<'a>(&self, bytes: &'a [u8]) -> Next<'a> {
        let Some((&[flag, length @ ..], rest)) = bytes.split_first_chunk::<PREFIX_LENGTH>() else {
            return Next::Incomplete;
        };
        let length = u32::from_be_bytes(length) as usize;
        if length > self.limit {
            return Next::TooLong;
        }
        match rest.get(..length) {
            Some(bytes) => Next::Message { flag, bytes },
            None => Next::Incomplete,
        }
    }

    fn too_long(&self) -> Failure {
        let message = format!("Received a message longer than {} bytes", self.limit);
        Failure::new(status::RESOURCE_EXHAUSTED, message)
    }

    fn message_to_js(&self, flag: u8, bytes: &[u8]) -> JsResult<Result<JSValue, Failure>> {
        if flag == 0 {
            return ArrayBuffer::create_uint8_array(&self.global, bytes).map(Ok);
        }
        match self.decompress(flag, bytes) {
            Ok(bytes) => JSUint8Array::from_bytes(&self.global, bytes.into()).map(Ok),
            Err(failure) => Ok(Err(failure)),
        }
    }

    fn decompress(&self, flag: u8, mut input: &[u8]) -> Result<Vec<u8>, Failure> {
        let name = BStr::new(self.encoding.name());
        let container = match (flag, &self.encoding) {
            (1, Encoding::Gzip) => Container::Gzip,
            (1, Encoding::Deflate) => Container::Zlib,
            (1, Encoding::Unsupported(_)) => {
                let message = format!("Received a message with the unsupported encoding {name}");
                return Err(Failure::new(status::UNIMPLEMENTED, message));
            }
            _ => {
                let message = format!(
                    "Received a message with the compression flag {flag} and {name} encoding"
                );
                return Err(Failure::new(status::INTERNAL, message));
            }
        };
        let mut inflater = Inflater::new(container);
        let mut output = Vec::new();
        loop {
            let room = self.limit + 1 - output.len();
            let result = inflater.inflate_to_vec(&mut input, &mut output, room);
            if output.len() > self.limit {
                return Err(self.too_long());
            }
            if !matches!(result, Ok(InflateStatus::StreamEnd)) {
                let message = format!("Received a message that is not valid {name}");
                return Err(Failure::new(status::INTERNAL, message));
            }
            if container != Container::Gzip || !input.starts_with(&GZIP_ID) {
                return Ok(output);
            }
            inflater.reset();
        }
    }

    fn control_flow(&self) {
        let Some(stream) = self.stream.get() else {
            return;
        };
        let is_full = self.unread().len() >= HIGH_WATER_MARK && self.has_next();
        if self.holds_window.replace(is_full) != is_full {
            bun_opaque::opaque_deref_mut(stream.response).hold_request_window(is_full);
        }
    }

    fn on_aborted(&self) {
        let this = self.this_value.get().try_get();
        let _stream = self.detach();
        let failure = Failure::new(status::CANCELLED, "The call was cancelled");
        self.interruption.set(Some(failure));
        self.notify(this, Event::Interrupted);
    }

    pub(crate) fn on_deadline(&self) {
        self.deadline.state.set(TimerState::FIRED);
        self.interrupt(Failure::new(status::DEADLINE_EXCEEDED, "Deadline exceeded"));
    }

    fn interrupt(&self, failure: Failure) {
        let this = self.this_value.get().try_get();
        if self.finish(failure.code, failure.message.as_bytes(), None) {
            self.interruption.set(Some(failure));
            self.notify(this, Event::Interrupted);
        }
    }

    /// The caller holds a ref.
    fn detach(&self) -> Option<Stream> {
        let stream = self.stream.take()?;
        let response = AnyResponse::H2(stream.response);
        response.clear_aborted();
        response.clear_on_data();
        response.clear_on_writable();
        response.clear_timeout();
        self.deadline.disarm();
        if !self.unread().is_empty() {
            self.has_last_request.set(false);
        }
        self.received.set(Vec::new());
        self.consumed.set(0);
        self.this_value.with_mut(JsRef::downgrade);
        Some(stream)
    }

    /// False if the call had ended already.
    fn finish(&self, code: u8, message: &[u8], frame: Option<&[u8]>) -> bool {
        let this = self.this_value.get().try_get();
        let Some(stream) = self.detach() else {
            return false;
        };
        let response = bun_opaque::opaque_deref_mut(stream.response);
        if self.holds_window.get() {
            response.hold_request_window(false);
        }
        let is_trailers_only = !self.write_headers(this, response) && frame.is_none();
        if let Some(frame) = frame {
            AnyResponse::H2(stream.response).write(frame);
        }
        let write = match is_trailers_only {
            true => h2::Response::write_header,
            false => h2::Response::write_trailer,
        };
        write_status(response, write, code, message);
        let trailers = this.and_then(js::response_trailers_get_cached);
        write_metadata(trailers, response, write);
        response.end_without_body(false);
        if AnyResponse::H2(stream.response).get_buffered_amount() > 0 {
            response.timeout(stream.server.config().idle_timeout);
        }
        true
    }

    /// False if nothing calls for the headers to be apart from the trailers.
    fn write_headers(&self, this: Option<JSValue>, response: &mut h2::Response) -> bool {
        if self.wrote_headers.replace(true) {
            return true;
        }
        write_protocol_headers(response);
        let headers = this.and_then(js::response_headers_get_cached);
        write_metadata(headers, response, h2::Response::write_header)
    }

    fn fields(&self) -> impl Iterator<Item = &[u8]> + Clone {
        strings::split(&self.head, b"\0")
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.head.capacity()
    }

    pub(crate) fn get_path(&self) -> &[u8] {
        self.fields().next().unwrap_or_default()
    }

    pub(crate) fn get_host(&self) -> &[u8] {
        self.fields().nth(1).unwrap_or_default()
    }

    pub(crate) fn get_headers(&self, cx: &mut JsScope<'_>) -> JSValue {
        let names = self.fields().skip(2).step_by(2);
        let values = self.fields().skip(3).step_by(2);
        let headers = names
            .zip(values)
            .map(|(name, value)| Header::new(name, value));
        HeadersRef::create_from_headers(&Headers::copy_of(headers)).to_js(cx.global())
    }

    pub(crate) fn get_response_headers(&self, cx: &mut JsScope<'_>) -> JSValue {
        HeadersRef::create_empty().to_js(cx.global())
    }

    pub(crate) fn get_response_trailers(&self, cx: &mut JsScope<'_>) -> JSValue {
        HeadersRef::create_empty().to_js(cx.global())
    }

    /// 0 if nothing has interrupted the call.
    pub(crate) fn get_interruption_code(&self) -> u8 {
        self.interruption.get().as_ref().map_or(0, |it| it.code)
    }

    pub(crate) fn get_interruption_message(&self) -> &[u8] {
        let interruption = self.interruption.get().as_ref();
        interruption.map_or(b"", |it| it.message.as_bytes())
    }

    pub(crate) fn request_ip(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let stream = self.stream.get().as_ref();
        let stream = stream.filter(|it| !it.server.config().address.is_unix());
        let response = stream.map(|it| AnyResponse::H2(it.response));
        let response = response.filter(|it| !it.is_closed());
        match response.and_then(AnyResponse::get_remote_socket_info) {
            Some(it) => SocketAddress::create_dto(cx.global(), it.ip(), it.port as u16, it.is_ipv6),
            None => Ok(JSValue::NULL),
        }
    }

    pub(crate) fn timeout(&self, seconds: u8) {
        if let Some(response) = self.response() {
            response.timeout(seconds);
        }
    }

    /// `null` after the last request. `undefined` if there is none yet: an event follows, unless the call has ended.
    pub(crate) fn read(&self, _: &mut JsScope<'_>) -> JsResult<JSValue> {
        if let Some(response) = self.response() {
            response.grow_request_window();
        }
        let unread = self.unread();
        let failure = match self.next(unread) {
            Next::Message { flag, bytes } => match self.message_to_js(flag, bytes)? {
                Ok(message) => {
                    if unread.len() == PREFIX_LENGTH + bytes.len() {
                        self.received.with_mut(|received| {
                            received.clear();
                            received.shrink_to(HIGH_WATER_MARK);
                        });
                        self.consumed.set(0);
                    } else {
                        self.consumed.update(|it| it + PREFIX_LENGTH + bytes.len());
                    }
                    self.control_flow();
                    return Ok(message);
                }
                Err(failure) => failure,
            },
            Next::TooLong => self.too_long(),
            Next::Incomplete if !self.has_last_request.get() => {
                self.waits_for_request.set(true);
                return Ok(JSValue::UNDEFINED);
            }
            Next::Incomplete if unread.is_empty() => return Ok(JSValue::NULL),
            Next::Incomplete => Failure::truncated(),
        };
        self.interrupt(failure);
        Ok(JSValue::UNDEFINED)
    }

    /// False if the next message has to wait: an event follows, unless the call has ended.
    pub(crate) fn write(self: &RefPtr<Self>, _: &JsHeap<'_>, frame: &[u8]) -> bool {
        let Some(stream) = self.stream.get() else {
            return false;
        };
        let this = self.this_value.get().try_get();
        self.write_headers(this, bun_opaque::opaque_deref_mut(stream.response));
        let response = AnyResponse::H2(stream.response);
        if let WriteResult::WantMore(_) = response.write(frame) {
            return true;
        }
        response.on_writable(
            |call: *mut Self, _, response: AnyResponse| {
                response.clear_on_writable();
                // SAFETY: `Stream` holds a ref until `detach` has cleared this handler.
                let call = unsafe { RefPtr::init_ref(call) };
                // Or else the handler writes again before uWS returns to the event loop.
                let _entered = (call.global.bun_vm()).enter_event_loop_scope_without_checkpoint();
                call.notify(call.this_value.get().try_get(), Event::Writable);
                true
            },
            self.as_ptr(),
        );
        false
    }

    pub(crate) fn end(&self, _: &JsHeap<'_>, code: u8, message: &[u8], frame: Option<&[u8]>) {
        self.finish(code, message, frame);
    }
}

impl From<&[u8]> for Encoding {
    fn from(name: &[u8]) -> Self {
        match name {
            b"identity" => Self::Identity,
            b"gzip" => Self::Gzip,
            b"deflate" => Self::Deflate,
            _ => Self::Unsupported(name.into()),
        }
    }
}

impl Encoding {
    fn name(&self) -> &[u8] {
        match self {
            Self::Identity => b"identity",
            Self::Gzip => b"gzip",
            Self::Deflate => b"deflate",
            Self::Unsupported(name) => name,
        }
    }
}

const NOT_IMPLEMENTED: &[u8] = b"The method is not implemented";

#[inline(never)]
pub(crate) fn on_unknown_method(request: &mut h2::Request, response: &mut h2::Response) {
    removable_definition!(ServeHttp2, on_unknown_method);
    match request.method() == b"post" && is_grpc(request) {
        true => end_with_status(response, status::UNIMPLEMENTED, NOT_IMPLEMENTED),
        false => request.set_yield(true),
    }
}

pub(crate) fn refuse_version(response: AnyResponse) {
    response.write_status(b"505 HTTP Version Not Supported");
    response.end(b"gRPC requires HTTP/2", false);
}

fn is_grpc(request: &mut h2::Request) -> bool {
    const GRPC: &[u8] = b"application/grpc";
    const PROTO: &[u8] = b"+proto";
    let value = request.header(b"content-type").unwrap_or_default();
    if !strings::starts_with_case_insensitive_ascii(value, GRPC) {
        return false;
    }
    let mut rest = &value[GRPC.len()..];
    if strings::starts_with_case_insensitive_ascii(rest, PROTO) {
        rest = &rest[PROTO.len()..];
    }
    matches!(rest.trim_ascii_start().first(), None | Some(b';'))
}

/// `fieldsOfOneMessage` in `grpc.ts`.
fn is_field_of_one_message(name: &[u8]) -> bool {
    const FIELDS: [&[u8]; 10] = [
        b"accept-encoding",
        b"content-encoding",
        b"content-length",
        b"content-type",
        b"grpc-accept-encoding",
        b"grpc-encoding",
        b"grpc-message",
        b"grpc-status",
        b"te",
        b"transfer-encoding",
    ];
    FIELDS.iter().any(|it| it.eq_ignore_ascii_case(name))
}

/// In milliseconds.
fn parse_timeout(value: &[u8]) -> Result<u64, Failure> {
    let parsed = value.split_last().and_then(|(unit, digits)| {
        if !(1..=8).contains(&digits.len()) || !digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let amount = (digits.iter()).fold(0, |sum, digit| sum * 10 + u64::from(digit - b'0'));
        Some(match unit {
            b'H' => amount * 3_600_000,
            b'M' => amount * 60_000,
            b'S' => amount * 1000,
            b'm' => amount,
            b'u' => amount.div_ceil(1000),
            b'n' => amount.div_ceil(1_000_000),
            _ => return None,
        })
    });
    parsed.ok_or_else(|| {
        let message = format!("Received the malformed grpc-timeout {}", BStr::new(value));
        Failure::new(status::INTERNAL, message)
    })
}

type WriteField = fn(&mut h2::Response, &[u8], &[u8]);

fn write_protocol_headers(response: &mut h2::Response) {
    AnyResponse::H2(response).mark_wrote_date_header();
    response.write_header(b"content-type", b"application/grpc");
    response.write_header(b"grpc-accept-encoding", b"identity,gzip,deflate");
}

fn end_with_status(response: &mut h2::Response, code: u8, message: &[u8]) {
    write_protocol_headers(response);
    write_status(response, h2::Response::write_header, code, message);
    response.end_without_body(false);
}

fn write_status(response: &mut h2::Response, write: WriteField, code: u8, message: &[u8]) {
    let mut digits = bun_core::fmt::ItoaBuf::new();
    write(
        response,
        b"grpc-status",
        bun_core::fmt::itoa(&mut digits, code),
    );
    if !message.is_empty() {
        write(response, b"grpc-message", &percent_encode(message));
    }
}

/// False if there was nothing to write.
fn write_metadata(
    metadata: Option<JSValue>,
    response: &mut h2::Response,
    write: WriteField,
) -> bool {
    let Some(metadata) = metadata.and_then(FetchHeaders::cast) else {
        return false;
    };
    let metadata = bun_opaque::opaque_deref(metadata.as_ptr());
    let Some(fields) = try_from_fetch_headers(Some(metadata), None) else {
        AnyResponse::H2(response).force_close();
        return false;
    };
    let mut has_written = false;
    for field in fields.iter() {
        if !is_field_of_one_message(field.name()) {
            write(response, field.name(), field.value());
            has_written = true;
        }
    }
    has_written
}

/// `Percent-Encoded` in gRPC's PROTOCOL-HTTP2.md. A field value cannot start or end with a space.
fn percent_encode(message: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(message.len().min(LONGEST_STATUS_MESSAGE));
    for (index, &byte) in message.iter().enumerate() {
        let starts_character = byte & 0xC0 != 0x80;
        if encoded.len() >= LONGEST_STATUS_MESSAGE && starts_character {
            encoded.extend_from_slice(b"...");
            break;
        }
        let is_inside = index != 0 && index + 1 != message.len();
        match byte {
            b'!'..=b'$' | b'&'..=b'~' => encoded.push(byte),
            b' ' if is_inside => encoded.push(byte),
            _ => {
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }
    encoded
}
