//! `Bun.serve()` and the server of node:http.

use std::borrow::Cow;

use bun_http_types::Method::Method;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_removable_features::removable_body_behind_value;
use bun_telemetry::http_record::{
    Facts, HttpVersion, Peer, PeerCache, SemconvMethod, forwarded_client,
};
use bun_telemetry::{Carried, Instrument, Local, Record, SpanData, SpanKind, Value, propagation};
use bun_uws::{AnyRequest, AnyResponse};
use bun_uws_sys::request::TelemetryHeaders;

use crate::context::Parent;
use crate::held::{Active, HeldSpan};
use crate::native::{self, NativeSpan};
use crate::state::VmState;

/// The fields of a header that repeats are one list.
fn list_header<'a>(
    req: &'a AnyRequest,
    name: &[u8],
    first: Option<&'a [u8]>,
    may_repeat: bool,
) -> Option<Cow<'a, [u8]>> {
    match may_repeat {
        false => first.map(Cow::Borrowed),
        true => first.and_then(|_| req.header_joined(name)),
    }
}

fn remote_parent(req: &AnyRequest, h: &TelemetryHeaders<'_>) -> Parent {
    let state = bun_telemetry::state();
    let ctx = (h.traceparent)
        .filter(|_| state.propagate_trace_context && !h.traceparent_repeats)
        .and_then(propagation::parse_traceparent);
    let trace_state =
        ctx.and_then(|_| list_header(req, b"tracestate", h.tracestate, h.tracestate_may_repeat));
    let baggage = (state.propagate_baggage)
        .then(|| list_header(req, b"baggage", h.baggage, h.baggage_may_repeat))
        .flatten();
    Parent {
        ctx,
        carried: Carried::new(
            (trace_state.as_deref())
                .and_then(propagation::tracestate_bounded)
                .unwrap_or_default(),
            (baggage.as_deref())
                .filter(|b| propagation::baggage_is_reasonable(b))
                .unwrap_or_default(),
        ),
    }
}

fn describe_request(
    record: &mut Record,
    peers: &mut PeerCache,
    req: &AnyRequest,
    h: &TelemetryHeaders<'_>,
    resp: AnyResponse,
    https: bool,
) {
    let known = Method::find(req.method());
    let method = SemconvMethod::of(known);
    if method.is_other() {
        // uWS lower-cases the token.
        let original = known.map_or_else(|| req.method(), |m| m.as_str().as_bytes());
        record.attr("http.request.method_original", original);
    }
    let facts = record.begin_http_server();
    facts.https = https;
    facts.method = method;
    facts.version = match resp {
        AnyResponse::H3(_) => HttpVersion::Http3,
        AnyResponse::H2(_) => HttpVersion::Http2,
        AnyResponse::TCP(_) | AnyResponse::SSL(_) if h.is_http_1_0 => HttpVersion::Http10,
        AnyResponse::TCP(_) | AnyResponse::SSL(_) => HttpVersion::Http11,
    };
    let ask = || match resp.get_remote_socket_info() {
        Some(a) => Peer::new(a.ip(), u16::try_from(a.port).unwrap_or(0)),
        None => Peer::UNKNOWN,
    };
    let peer = match resp.telemetry_tag(|| peers.next_tag()) {
        Some(tag) => peers.get(tag, ask),
        None => &ask(),
    };
    let url = req.url();
    let path_len = bun_core::strings::index_of_char_usize(url, b'?').unwrap_or(url.len());
    facts.set_request(
        peer,
        url,
        path_len,
        forwarded_client(h.forwarded, h.x_forwarded_for),
        h.host.unwrap_or_default(),
        h.user_agent.unwrap_or_default(),
    );
    for header in &bun_telemetry::state().capture_request_headers {
        if let Some(value) = req.header_joined(header.name()) {
            let value = Value::Array(&[Value::Str(&value)]);
            record.set_attribute(header.attribute_key(), &value);
        }
    }
}

/// `https`: the listener terminates TLS. The response cannot tell, HTTP/2 also runs in cleartext.
#[optimize(speed)]
fn start(
    global: &JSGlobalObject,
    req: &AnyRequest,
    resp: AnyResponse,
    https: bool,
) -> Option<SpanData> {
    let h = req.telemetry_headers();
    let parent = remote_parent(req, &h);
    if parent.ctx.is_none() && !bun_telemetry::allows_root(Instrument::HttpServer) {
        return None;
    }
    let mut data = native::start_under(global, parent, Instrument::HttpServer, SpanKind::Server)?;
    let Local { records, peers, .. } = &mut *VmState::current()?.local();
    if let Some(record) = data.record_mut(|| Some(records.take())) {
        describe_request(record, peers, req, &h, resp, https);
    }
    Some(data)
}

#[inline(always)]
fn facts(f: impl FnOnce(&mut Facts)) -> impl FnOnce(&mut Record) {
    |record| record.http_mut().map_or((), f)
}

/// The span of a request that script handles.
#[derive(Default)]
#[repr(transparent)]
pub struct HandledRequest(HeldSpan);

impl HandledRequest {
    #[inline(always)]
    pub fn begin(
        global: &JSGlobalObject,
        req: &AnyRequest,
        resp: AnyResponse,
        https: bool,
    ) -> HandledRequest {
        if !bun_telemetry::enabled(Instrument::HttpServer) {
            return HandledRequest::default();
        }
        removable_body_behind_value!(Telemetry, {
            let span = start(global, req, resp, https).map(|data| HeldSpan::new(global, data));
            HandledRequest(span.unwrap_or_default())
        })
    }

    #[inline(always)]
    pub fn take(&self) -> HandledRequest {
        HandledRequest(self.0.take())
    }

    #[inline(always)]
    pub fn enter<'a>(&self, global: &'a JSGlobalObject) -> Active<'a> {
        self.0.enter(global)
    }

    #[inline(always)]
    pub fn enter_route<'a>(&self, global: &'a JSGlobalObject, route: &[u8]) -> Active<'a> {
        self.0.describe(facts(|f| f.set_route(route)));
        self.0.enter(global)
    }

    #[inline(always)]
    pub fn set_status(&self, status: u16) {
        self.0.describe(facts(|f| f.status = status));
    }

    #[inline(always)]
    pub fn fail(&self, global: &JSGlobalObject, error: JSValue) {
        self.0.fail(global, error);
    }

    #[inline(always)]
    pub fn set_incomplete(&self) {
        self.0.describe(facts(|f| f.is_aborted = true));
    }

    #[inline(always)]
    pub fn end(&self, is_aborted: bool) {
        if is_aborted {
            self.set_incomplete();
        }
        self.0.end();
    }
}

/// The span of a request that Bun answers itself. It ends when it drops, and is exported if it has a status: a
/// route that writes none yields to the next.
#[derive(Default)]
pub struct AnsweredRequest {
    span: NativeSpan,
    status: u16,
}

impl AnsweredRequest {
    #[inline(always)]
    pub fn begin<'a>(
        global: &JSGlobalObject,
        req: &AnyRequest,
        resp: AnyResponse,
        https: bool,
        route: impl FnOnce() -> &'a [u8],
    ) -> AnsweredRequest {
        if !bun_telemetry::enabled(Instrument::HttpServer) {
            return AnsweredRequest::default();
        }
        removable_body_behind_value!(Telemetry, {
            let mut span =
                start(global, req, resp, https).map_or(NativeSpan::NONE, NativeSpan::if_recording);
            span.describe(facts(|f| f.set_route(route())));
            AnsweredRequest { span, status: 0 }
        })
    }

    #[inline(always)]
    pub fn set_status(&mut self, status: u16) {
        self.status = status;
    }

    #[inline(always)]
    pub fn abort(mut self) {
        core::mem::take(&mut self.span).end_with(facts(|f| {
            f.status = self.status;
            f.is_aborted = true;
        }));
    }
}

impl Drop for AnsweredRequest {
    #[inline(always)]
    fn drop(&mut self) {
        if self.status != 0 {
            core::mem::take(&mut self.span).end_with(facts(|f| f.status = self.status));
        }
    }
}

#[unsafe(no_mangle)]
static Bun__Telemetry__httpServerBit: u32 = Instrument::HttpServer.bit();
