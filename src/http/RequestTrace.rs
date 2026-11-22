//! The steps of a request, for an owner that publishes them and has a say in the headers of each hop.

use core::net::{IpAddr, SocketAddr};
use std::collections::VecDeque;

use bun_http_types::ETag::HeaderEntryColumns as _;
use bun_http1::Response;
use bun_ptr::RefPtr;
use bun_threading::Guarded;

use crate::http_context::HTTPSocket;
use crate::internal_state::RequestStage;
use crate::thread_safe_stream_buffer::Callback;
use crate::{
    AsyncHTTP, HTTPClient, HTTPRequestBody, HTTPThread, Headers, InFlightRequest, Method, Protocol,
    Request, headers, signals,
};

/// The first request, or the one that follows a redirect, before it is sent.
pub struct Hop {
    pub method: Method,
    pub origin: Vec<u8>,
    pub path: Box<[u8]>,
    /// The caller's, and the defaults that a caller can replace.
    pub headers: Headers,
    pub has_body: bool,
    pub content_length: Option<u64>,
}

#[derive(Clone, Copy, Default)]
pub struct Endpoints {
    pub local: Option<SocketAddr>,
    pub remote: Option<SocketAddr>,
}

pub enum Event {
    /// No open connection serves the request.
    Connecting,
    HeadSent {
        head: Vec<u8>,
        protocol: Protocol,
        endpoints: Endpoints,
    },
    BodyChunkSent(Box<[u8]>),
    BodySent,
    /// A stream has written all that `Content-Length` announced. The response may be complete before it ends.
    DeclaredLengthSent,
    ResponseHead {
        status_code: u32,
        status_text: Box<[u8]>,
        headers: Headers,
    },
    /// Not decompressed.
    BodyChunkReceived(Box<[u8]>),
    ResponseEnd,
    /// The request waits for [`RequestTrace::follow_redirect`], or to be aborted.
    Redirect(Hop),
}

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct RequestTrace {
    /// No other lock is taken while this one is held.
    state: Guarded<State>,
    on_event: Callback,
    wants_sent_chunks: bool,
    wants_received_chunks: bool,
    ref_count: bun_ptr::ThreadSafeRefCount<RequestTrace>,
}

#[derive(Default)]
struct State {
    events: VecDeque<Event>,
    headers_of_next_hop: Option<Headers>,
}

impl RequestTrace {
    /// The HTTP thread calls `on_event(context)` when there is something to [`pop`](Self::pop), up to the last result.
    pub fn new<T>(
        on_event: fn(*mut T),
        context: *mut T,
        wants_sent_chunks: bool,
        wants_received_chunks: bool,
    ) -> RefPtr<Self> {
        RefPtr::new(Self {
            state: Guarded::new(State::default()),
            on_event: Callback::init(on_event, context),
            wants_sent_chunks,
            wants_received_chunks,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
        })
    }

    pub fn wants_sent_chunks(&self) -> bool {
        self.wants_sent_chunks
    }

    /// Whether it is the only one, so that nothing is on its way to pop it.
    pub fn push(&self, event: Event) -> bool {
        let events = &mut self.state.lock().events;
        events.push_back(event);
        events.len() == 1
    }

    pub fn pop(&self) -> Option<Event> {
        self.state.lock().events.pop_front()
    }

    /// `None` sends the headers of the [`Hop`].
    pub fn follow_redirect(&self, async_http_id: u32, headers: Option<Headers>) {
        self.state.lock().headers_of_next_hop = headers;
        HTTPThread::schedule_receive_resume(async_http_id);
    }
}

pub(crate) struct Tracing {
    trace: RefPtr<RequestTrace>,
    /// The caller's, while `header_entries` has what was made of them for this hop.
    own_entries: Option<headers::EntryList>,
    own_len: usize,
    own_disable_keepalive: bool,
    /// Backs `header_buf`. It starts with the caller's, so what points there stays valid.
    buf: Vec<u8>,
    head: Vec<u8>,
    endpoints: Endpoints,
}

impl Tracing {
    fn emit(&self, event: Event) {
        if self.trace.push(event) {
            self.trace.on_event.call();
        }
    }
}

impl AsyncHTTP<'_> {
    pub fn first_hop(&self) -> Hop {
        self.client.hop(&self.request_body)
    }

    /// `headers` replace the caller's up to the first redirect.
    pub fn set_trace(&mut self, trace: RefPtr<RequestTrace>, headers: Option<Headers>) {
        self.client.tracing = Some(Box::new(Tracing {
            trace,
            own_entries: None,
            own_len: self.client.header_buf.len(),
            own_disable_keepalive: self.client.flags.disable_keepalive,
            buf: Vec::new(),
            head: Vec::new(),
            endpoints: Endpoints::default(),
        }));
        self.client.set_headers_of_hop(headers);
    }
}

impl InFlightRequest {
    pub(crate) fn follow_redirect(mut self) {
        let Some(tracing) = &self.tracing else {
            return self.connect();
        };
        if self.signals.get(signals::Field::Aborted) {
            return self.connect();
        }
        self.flags.disable_keepalive = tracing.own_disable_keepalive;
        self.unregister_abort_tracker();
        self.state.flags.is_waiting_for_headers = true;
        self.trace(|this| Event::Redirect(this.hop(&this.state.original_request_body)));
        self.hold();
    }

    pub(crate) fn resume_redirect(mut self) {
        self.state.flags.is_waiting_for_headers = false;
        let headers = (self.tracing.as_ref())
            .and_then(|tracing| tracing.trace.state.lock().headers_of_next_hop.take());
        self.set_headers_of_hop(headers);
        self.connect();
    }
}

impl HTTPClient<'_> {
    #[inline]
    pub(crate) fn trace(&self, event: impl FnOnce(&Self) -> Event) {
        if let Some(tracing) = &self.tracing {
            tracing.emit(event(self));
        }
    }

    #[inline]
    pub(crate) fn trace_socket<const IS_SSL: bool>(&mut self, socket: HTTPSocket<IS_SSL>) {
        if let Some(tracing) = &mut self.tracing {
            tracing.endpoints = endpoints_of(socket);
        }
    }

    #[inline]
    pub(crate) fn trace_head(&mut self, request: &Request<'_>) {
        if let Some(tracing) = &mut self.tracing {
            tracing.head = text_of_head(request, self.flags.protocol);
        }
    }

    /// Reports what `request_stage` has passed since the last call.
    #[inline]
    pub(crate) fn trace_request_stage(&mut self) {
        if self.tracing.is_some() {
            self.emit_request_stage();
        }
    }

    #[inline]
    pub(crate) fn trace_response_head(&mut self, response: &Response) {
        self.trace_request_stage();
        self.trace(|_| Event::ResponseHead {
            status_code: response.status_code,
            status_text: response.status_text().into(),
            headers: response.headers.clone(),
        });
    }

    #[inline]
    pub(crate) fn trace_received_chunk(tracing: Option<&Tracing>, chunk: &[u8]) {
        if let Some(tracing) = tracing
            && tracing.trace.wants_received_chunks
            && !chunk.is_empty()
        {
            tracing.emit(Event::BodyChunkReceived(chunk.into()));
        }
    }

    /// The next hop starts from the caller's headers: what was added for one origin is not for another.
    #[inline]
    pub(crate) fn restore_own_headers(&mut self) {
        if let Some(tracing) = &mut self.tracing
            && let Some(own) = tracing.own_entries.take()
        {
            self.header_entries = own;
        }
    }

    #[cold]
    fn emit_request_stage(&mut self) {
        let Some(tracing) = &mut self.tracing else {
            return;
        };
        let (stage, flags) = (self.state.request_stage, &mut self.state.flags);
        let is_done = stage == RequestStage::Done;
        if (is_done || matches!(stage, RequestStage::Body | RequestStage::ProxyBody))
            && !core::mem::replace(&mut flags.traced_head, true)
        {
            let head = core::mem::take(&mut tracing.head);
            tracing.emit(Event::HeadSent {
                head,
                protocol: self.flags.protocol,
                endpoints: tracing.endpoints,
            });
            if let HTTPRequestBody::Bytes(body @ [_, ..]) = self.state.original_request_body
                && tracing.trace.wants_sent_chunks
            {
                tracing.emit(Event::BodyChunkSent(body.into()));
            }
        }
        if is_done && !core::mem::replace(&mut flags.traced_body, true) {
            tracing.emit(Event::BodySent);
        }
    }

    fn set_headers_of_hop(&mut self, headers: Option<Headers>) {
        let (Some(tracing), Some(headers)) = (&mut self.tracing, headers) else {
            return;
        };
        let mut hop = Headers {
            entries: Default::default(),
            buf: self.header_buf[..tracing.own_len].to_vec(),
        };
        for header in headers.iter() {
            hop.append(header.name(), header.value());
        }
        tracing.own_entries = Some(core::mem::replace(&mut self.header_entries, hop.entries));
        tracing.buf = hop.buf;
        // SAFETY: self-borrow. `buf` lives as long as `self`, and only this function replaces it, between two hops.
        self.header_buf = unsafe { bun_ptr::detach_lifetime(&tracing.buf) };
    }

    fn hop(&self, body: &HTTPRequestBody<'_>) -> Hop {
        let mut headers = Headers::default();
        let names = self.header_entries.items_name();
        for (&name, &value) in names.iter().zip(self.header_entries.items_value()) {
            headers.append(self.header_str(name), self.header_str(value));
        }
        for default in self.default_request_headers() {
            if headers.get(default.name()).is_none() {
                headers.append(default.name(), default.value());
            }
        }

        let (has_body, content_length) = match body {
            HTTPRequestBody::Stream(stream) => (true, stream.framing.content_length),
            HTTPRequestBody::Bytes([]) => (false, self.method.has_request_body().then_some(0)),
            _ => (true, self.compress.is_none().then_some(body.len() as u64)),
        };
        let scheme: &[u8] = if self.url.is_https() {
            b"https://"
        } else {
            b"http://"
        };
        Hop {
            method: self.method,
            origin: [scheme, self.url.host].concat(),
            path: self.url.pathname.into(),
            headers,
            has_body,
            content_length,
        }
    }
}

#[cold]
fn endpoints_of<const IS_SSL: bool>(socket: HTTPSocket<IS_SSL>) -> Endpoints {
    let address = |ip: Option<&[u8]>, port: Option<u16>| {
        let ip = ip?;
        let ip = <[u8; 4]>::try_from(ip)
            .map(IpAddr::from)
            .or_else(|_| <[u8; 16]>::try_from(ip).map(IpAddr::from))
            .ok()?;
        Some(SocketAddr::new(ip, port?))
    };
    let mut buf = [0u8; 64];
    Endpoints {
        local: address(socket.local_address(&mut buf), socket.local_port()),
        remote: address(socket.remote_address(&mut buf), socket.remote_port()),
    }
}

/// Without the empty line, and without what only a proxy is to read.
#[cold]
fn text_of_head(request: &Request<'_>, protocol: Protocol) -> Vec<u8> {
    let is_http1 = protocol == Protocol::Http1_1;
    let mut text = if is_http1 {
        [request.method, b" ", request.path, b" HTTP/1.1\r\n"].concat()
    } else {
        let (method, path) = (request.method, request.path);
        [
            b":method: ",
            method,
            b"\r\n:scheme: https\r\n:path: ",
            path,
            b"\r\n",
        ]
        .concat()
    };
    for header in request.headers {
        let name = header.name();
        if is_http1 {
            text.extend_from_slice(name);
        } else if name.eq_ignore_ascii_case(b"host") {
            text.extend_from_slice(b":authority");
        } else if name.eq_ignore_ascii_case(b"connection")
            || name.eq_ignore_ascii_case(b"transfer-encoding")
        {
            continue;
        } else {
            text.extend(name.iter().map(u8::to_ascii_lowercase));
        }
        text.extend_from_slice(b": ");
        text.extend_from_slice(header.value());
        text.extend_from_slice(b"\r\n");
    }
    text
}
