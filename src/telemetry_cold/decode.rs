//! Typed, zero-copy views over an encoded `ExportTraceServiceRequest`.
//! Scalar fields are decoded eagerly (last occurrence wins, proto3 defaults
//! when absent); repeated fields are walked lazily through [`Repeated`].

use core::marker::PhantomData;

use bun_telemetry::otlp::field as f;
use bun_telemetry::proto::{Reader, Value};

/// A message that can be viewed over its encoded body.
pub trait Message<'a>: Sized {
    fn decode(body: &'a [u8]) -> Self;
    /// `depth`: how many `AnyValue` array/kvlist levels enclose this message.
    fn decode_nested(body: &'a [u8], _depth: u8) -> Self {
        Self::decode(body)
    }
}

struct Fields<'a>(Reader<'a>);

impl<'a> Iterator for Fields<'a> {
    type Item = (u32, Value<'a>);
    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        self.0.next().ok().flatten()
    }
}

#[inline]
fn fields(body: &[u8]) -> Fields<'_> {
    Fields(Reader::new(body))
}

/// The length-delimited occurrences of one field in a message body, each
/// viewed as `T`.
pub struct Repeated<'a, T> {
    body: &'a [u8],
    field: u32,
    depth: u8,
    _marker: PhantomData<fn() -> T>,
}

impl<T> Clone for Repeated<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Repeated<'_, T> {}

/// Nested `AnyValue`s (arrays / kvlists) deeper than this decode as `Empty`,
/// so hostile input cannot drive a consumer's recursion arbitrarily deep.
pub const MAX_VALUE_DEPTH: u8 = 32;

impl<'a, T> Repeated<'a, T> {
    #[inline]
    fn new(body: &'a [u8], field: u32) -> Self {
        Self::nested(body, field, 0)
    }
    #[inline]
    fn nested(body: &'a [u8], field: u32, depth: u8) -> Self {
        Repeated {
            body,
            field,
            depth,
            _marker: PhantomData,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn len(&self) -> usize {
        fields(self.body)
            .filter(|(fl, _)| *fl == self.field)
            .count()
    }
}

impl<'a, T: Message<'a>> IntoIterator for Repeated<'a, T> {
    type Item = T;
    type IntoIter = RepeatedIter<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        RepeatedIter {
            fields: fields(self.body),
            field: self.field,
            depth: self.depth,
            _marker: PhantomData,
        }
    }
}

pub struct RepeatedIter<'a, T> {
    fields: Fields<'a>,
    field: u32,
    depth: u8,
    _marker: PhantomData<fn() -> T>,
}

impl<'a, T: Message<'a>> Iterator for RepeatedIter<'a, T> {
    type Item = T;
    fn next(&mut self) -> Option<T> {
        for (fl, v) in self.fields.by_ref() {
            if fl == self.field {
                if let Value::Len(body) = v {
                    return Some(T::decode_nested(body, self.depth));
                }
            }
        }
        None
    }
}

#[derive(Clone, Copy)]
pub struct TraceRequest<'a> {
    body: &'a [u8],
}

impl<'a> TraceRequest<'a> {
    pub fn new(body: &'a [u8]) -> Self {
        TraceRequest { body }
    }
    pub fn resource_spans(&self) -> Repeated<'a, ResourceSpans<'a>> {
        Repeated::new(self.body, f::RESOURCE_SPANS)
    }
    /// Every span in the request with its enclosing resource and scope.
    pub fn for_each_span(
        &self,
        mut each: impl FnMut(&ResourceSpans<'a>, &ScopeSpans<'a>, &Span<'a>),
    ) {
        for rs in self.resource_spans() {
            for ss in rs.scope_spans() {
                for span in ss.spans() {
                    each(&rs, &ss, &span);
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
pub struct ResourceSpans<'a> {
    pub resource: Option<Resource<'a>>,
    pub schema_url: &'a [u8],
    body: &'a [u8],
}

impl<'a> ResourceSpans<'a> {
    pub fn scope_spans(&self) -> Repeated<'a, ScopeSpans<'a>> {
        Repeated::new(self.body, f::RS_SCOPE_SPANS)
    }
}

impl<'a> Message<'a> for ResourceSpans<'a> {
    fn decode(body: &'a [u8]) -> Self {
        let mut m = ResourceSpans {
            resource: None,
            schema_url: b"",
            body,
        };
        for (fl, v) in fields(body) {
            match fl {
                f::RS_RESOURCE => m.resource = Some(Resource::decode(v.as_bytes())),
                f::RS_SCHEMA_URL => m.schema_url = v.as_bytes(),
                _ => {}
            }
        }
        m
    }
}

#[derive(Clone, Copy)]
pub struct Resource<'a> {
    body: &'a [u8],
}

impl<'a> Resource<'a> {
    pub fn attributes(&self) -> Repeated<'a, KeyValue<'a>> {
        Repeated::new(self.body, f::RES_ATTRIBUTES)
    }
}

impl<'a> Message<'a> for Resource<'a> {
    fn decode(body: &'a [u8]) -> Self {
        Resource { body }
    }
}

#[derive(Clone, Copy)]
pub struct ScopeSpans<'a> {
    pub scope: Option<Scope<'a>>,
    pub schema_url: &'a [u8],
    body: &'a [u8],
}

impl<'a> ScopeSpans<'a> {
    pub fn spans(&self) -> Repeated<'a, Span<'a>> {
        Repeated::new(self.body, f::SS_SPANS)
    }
}

impl<'a> Message<'a> for ScopeSpans<'a> {
    fn decode(body: &'a [u8]) -> Self {
        let mut m = ScopeSpans {
            scope: None,
            schema_url: b"",
            body,
        };
        for (fl, v) in fields(body) {
            match fl {
                f::SS_SCOPE => m.scope = Some(Scope::decode(v.as_bytes())),
                f::SS_SCHEMA_URL => m.schema_url = v.as_bytes(),
                _ => {}
            }
        }
        m
    }
}

#[derive(Clone, Copy)]
pub struct Scope<'a> {
    pub name: &'a [u8],
    pub version: &'a [u8],
    body: &'a [u8],
}

impl<'a> Scope<'a> {
    pub fn attributes(&self) -> Repeated<'a, KeyValue<'a>> {
        Repeated::new(self.body, f::SCOPE_ATTRIBUTES)
    }
}

impl<'a> Message<'a> for Scope<'a> {
    fn decode(body: &'a [u8]) -> Self {
        let mut m = Scope {
            name: b"",
            version: b"",
            body,
        };
        for (fl, v) in fields(body) {
            match fl {
                f::SCOPE_NAME => m.name = v.as_bytes(),
                f::SCOPE_VERSION => m.version = v.as_bytes(),
                _ => {}
            }
        }
        m
    }
}

/// `Span.kind` and `Status.code` carry the OTLP wire numbering.
#[derive(Clone, Copy)]
pub struct Span<'a> {
    pub trace_id: &'a [u8],
    pub span_id: &'a [u8],
    pub trace_state: &'a [u8],
    pub parent_span_id: &'a [u8],
    pub name: &'a [u8],
    pub kind: u32,
    pub start_time_ns: u64,
    pub end_time_ns: u64,
    pub dropped_attributes_count: u32,
    pub dropped_events_count: u32,
    pub dropped_links_count: u32,
    pub status: Status<'a>,
    pub flags: u32,
    body: &'a [u8],
}

impl<'a> Span<'a> {
    pub fn attributes(&self) -> Repeated<'a, KeyValue<'a>> {
        Repeated::new(self.body, f::ATTRIBUTES)
    }
    pub fn events(&self) -> Repeated<'a, Event<'a>> {
        Repeated::new(self.body, f::EVENTS)
    }
    pub fn links(&self) -> Repeated<'a, Link<'a>> {
        Repeated::new(self.body, f::LINKS)
    }
}

impl<'a> Message<'a> for Span<'a> {
    fn decode(body: &'a [u8]) -> Self {
        let mut m = Span {
            trace_id: b"",
            span_id: b"",
            trace_state: b"",
            parent_span_id: b"",
            name: b"",
            kind: 0,
            start_time_ns: 0,
            end_time_ns: 0,
            dropped_attributes_count: 0,
            dropped_events_count: 0,
            dropped_links_count: 0,
            status: Status::default(),
            flags: 0,
            body,
        };
        for (fl, v) in fields(body) {
            match fl {
                f::TRACE_ID => m.trace_id = v.as_bytes(),
                f::SPAN_ID => m.span_id = v.as_bytes(),
                f::TRACE_STATE => m.trace_state = v.as_bytes(),
                f::PARENT_SPAN_ID => m.parent_span_id = v.as_bytes(),
                f::NAME => m.name = v.as_bytes(),
                f::KIND => m.kind = v.as_u64() as u32,
                f::START_TIME => m.start_time_ns = v.as_u64(),
                f::END_TIME => m.end_time_ns = v.as_u64(),
                f::DROPPED_ATTRIBUTES => m.dropped_attributes_count = v.as_u64() as u32,
                f::DROPPED_EVENTS => m.dropped_events_count = v.as_u64() as u32,
                f::DROPPED_LINKS => m.dropped_links_count = v.as_u64() as u32,
                f::STATUS => m.status = Status::decode(v.as_bytes()),
                f::FLAGS => m.flags = v.as_u64() as u32,
                _ => {}
            }
        }
        m
    }
}

#[derive(Default, Clone, Copy)]
pub struct Status<'a> {
    pub code: u32,
    pub message: &'a [u8],
}

impl Status<'_> {
    pub fn is_set(&self) -> bool {
        self.code != 0 || !self.message.is_empty()
    }
}

impl<'a> Message<'a> for Status<'a> {
    fn decode(body: &'a [u8]) -> Self {
        let mut m = Status::default();
        for (fl, v) in fields(body) {
            match fl {
                f::STATUS_CODE => m.code = v.as_u64() as u32,
                f::STATUS_MESSAGE => m.message = v.as_bytes(),
                _ => {}
            }
        }
        m
    }
}

#[derive(Clone, Copy)]
pub struct Event<'a> {
    pub time_ns: u64,
    pub name: &'a [u8],
    pub dropped_attributes_count: u32,
    body: &'a [u8],
}

impl<'a> Event<'a> {
    pub fn attributes(&self) -> Repeated<'a, KeyValue<'a>> {
        Repeated::new(self.body, f::EV_ATTRIBUTES)
    }
}

impl<'a> Message<'a> for Event<'a> {
    fn decode(body: &'a [u8]) -> Self {
        let mut m = Event {
            time_ns: 0,
            name: b"",
            dropped_attributes_count: 0,
            body,
        };
        for (fl, v) in fields(body) {
            match fl {
                f::EV_TIME => m.time_ns = v.as_u64(),
                f::EV_NAME => m.name = v.as_bytes(),
                f::EV_DROPPED_ATTRIBUTES => m.dropped_attributes_count = v.as_u64() as u32,
                _ => {}
            }
        }
        m
    }
}

#[derive(Clone, Copy)]
pub struct Link<'a> {
    pub trace_id: &'a [u8],
    pub span_id: &'a [u8],
    pub trace_state: &'a [u8],
    pub dropped_attributes_count: u32,
    pub flags: u32,
    body: &'a [u8],
}

impl<'a> Link<'a> {
    pub fn attributes(&self) -> Repeated<'a, KeyValue<'a>> {
        Repeated::new(self.body, f::LINK_ATTRIBUTES)
    }
}

impl<'a> Message<'a> for Link<'a> {
    fn decode(body: &'a [u8]) -> Self {
        let mut m = Link {
            trace_id: b"",
            span_id: b"",
            trace_state: b"",
            dropped_attributes_count: 0,
            flags: 0,
            body,
        };
        for (fl, v) in fields(body) {
            match fl {
                f::LINK_TRACE_ID => m.trace_id = v.as_bytes(),
                f::LINK_SPAN_ID => m.span_id = v.as_bytes(),
                f::LINK_TRACE_STATE => m.trace_state = v.as_bytes(),
                f::LINK_DROPPED_ATTRIBUTES => m.dropped_attributes_count = v.as_u64() as u32,
                f::LINK_FLAGS => m.flags = v.as_u64() as u32,
                _ => {}
            }
        }
        m
    }
}

#[derive(Clone, Copy)]
pub struct KeyValue<'a> {
    pub key: &'a [u8],
    pub value: AnyValue<'a>,
}

impl<'a> Message<'a> for KeyValue<'a> {
    fn decode(body: &'a [u8]) -> Self {
        Self::decode_nested(body, 0)
    }
    fn decode_nested(body: &'a [u8], depth: u8) -> Self {
        let mut m = KeyValue {
            key: b"",
            value: AnyValue::Empty,
        };
        for (fl, v) in fields(body) {
            match fl {
                f::KV_KEY => m.key = v.as_bytes(),
                f::KV_VALUE => m.value = AnyValue::decode_nested(v.as_bytes(), depth),
                _ => {}
            }
        }
        m
    }
}

#[derive(Clone, Copy)]
pub enum AnyValue<'a> {
    Empty,
    String(&'a [u8]),
    Bool(bool),
    Int(i64),
    Double(f64),
    Array(Repeated<'a, AnyValue<'a>>),
    KvList(Repeated<'a, KeyValue<'a>>),
    Bytes(&'a [u8]),
}

impl<'a> Message<'a> for AnyValue<'a> {
    fn decode(body: &'a [u8]) -> Self {
        Self::decode_nested(body, 0)
    }
    /// `AnyValue` is a oneof: the last member present wins. Arrays / kvlists
    /// nested deeper than `MAX_VALUE_DEPTH` decode as `Empty`.
    fn decode_nested(body: &'a [u8], depth: u8) -> Self {
        let mut m = AnyValue::Empty;
        for (fl, v) in fields(body) {
            m = match fl {
                f::AV_STRING => AnyValue::String(v.as_bytes()),
                f::AV_BOOL => AnyValue::Bool(v.as_u64() != 0),
                f::AV_INT => AnyValue::Int(v.as_u64() as i64),
                f::AV_DOUBLE => AnyValue::Double(v.as_f64()),
                f::AV_ARRAY | f::AV_KVLIST if depth >= MAX_VALUE_DEPTH => AnyValue::Empty,
                f::AV_ARRAY => {
                    AnyValue::Array(Repeated::nested(v.as_bytes(), f::ARR_VALUES, depth + 1))
                }
                f::AV_KVLIST => {
                    AnyValue::KvList(Repeated::nested(v.as_bytes(), f::KVLIST_VALUES, depth + 1))
                }
                f::AV_BYTES => AnyValue::Bytes(v.as_bytes()),
                _ => continue,
            };
        }
        m
    }
}

/// Lower-case hex of an id into `out`, returning the written prefix.
pub fn hex_id<'b>(id: &[u8], out: &'b mut [u8; 64]) -> &'b [u8] {
    let n = id.len().min(32);
    bun_core::fmt::bytes_to_hex_lower(&id[..n], &mut out[..n * 2]);
    &out[..n * 2]
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_telemetry::otlp::{self, ScopeChunk, SpanWriter, Value as V};
    use bun_telemetry::span::{
        Flags, SpanContext, SpanId, SpanKind, SpanStub, StatusCode, TraceId,
    };

    #[test]
    fn nesting_is_capped() {
        // AnyValue{array_value{values:[AnyValue{array_value{...}}]}} nested 10k deep.
        let mut inner: Vec<u8> = vec![];
        for _ in 0..10_000 {
            // ArrayValue.values (field 1, LEN) wrapping the previous AnyValue
            let mut arr = vec![];
            bun_telemetry::proto::write_bytes(&mut arr, f::ARR_VALUES, &inner);
            // AnyValue.array_value (field 5, LEN)
            let mut av = vec![];
            bun_telemetry::proto::write_bytes(&mut av, f::AV_ARRAY, &arr);
            inner = av;
        }
        fn depth(v: AnyValue<'_>) -> usize {
            match v {
                AnyValue::Array(items) => 1 + items.into_iter().map(depth).max().unwrap_or(0),
                _ => 0,
            }
        }
        assert_eq!(depth(AnyValue::decode(&inner)), MAX_VALUE_DEPTH as usize);
    }

    #[test]
    fn small_int_kv_fast_paths_decode() {
        use bun_telemetry::otlp::{Value, write_key_value};
        for v in [
            0i64,
            1,
            127,
            128,
            300,
            8080,
            16383,
            16384,
            65535,
            (1 << 21) - 1,
            1 << 21,
            -1,
            i64::MAX,
        ] {
            let mut out = Vec::new();
            write_key_value(&mut out, f::ATTRIBUTES, b"k", &Value::Int(v));
            // strip the outer ATTRIBUTES tag+len and decode the KeyValue
            let (fl, val) = super::fields(&out).next().unwrap();
            assert_eq!(fl, f::ATTRIBUTES);
            let kv = KeyValue::decode(val.as_bytes());
            assert_eq!(kv.key, b"k");
            assert!(matches!(kv.value, AnyValue::Int(x) if x == v), "{v}");
        }
    }

    #[test]
    fn roundtrip() {
        let stub = SpanStub {
            ctx: SpanContext {
                trace_id: TraceId([7; 16]),
                span_id: SpanId([9; 8]),
                flags: Flags::from_w3c(Flags::SAMPLED),
            },
            parent: SpanId([0; 8]),
            start_ns: 11,
        };
        let mut spans = Vec::new();
        let list = [V::Int(1), V::Int(2)];
        let mut w = SpanWriter::begin(&mut spans, &stub, b"s", SpanKind::Server, 22, u32::MAX);
        w.attr("k", "v").attr("list", V::Array(&list));
        w.begin_event(b"e", 33).attrs(&[(b"x", V::Bool(false))]);
        w.status(StatusCode::Error, b"bad");
        w.finish();
        let scope = otlp::encode_scope(b"scope", b"1.0");
        let resource = otlp::encode_resource(&[(b"service.name", V::Str(b"svc"))]);
        let req = otlp::encode_request(
            &resource,
            &[ScopeChunk {
                scope: &scope,
                spans: &spans,
            }],
        );

        let mut seen = 0;
        TraceRequest::new(&req).for_each_span(|rs, ss, span| {
            seen += 1;
            let res_attrs: Vec<_> = rs
                .resource
                .as_ref()
                .unwrap()
                .attributes()
                .into_iter()
                .collect();
            assert_eq!(res_attrs[0].key, b"service.name");
            assert_eq!(ss.scope.as_ref().unwrap().name, b"scope");
            assert_eq!(span.name, b"s");
            assert_eq!(span.kind, SpanKind::Server as u32);
            assert_eq!(span.start_time_ns, 11);
            assert_eq!(span.end_time_ns, 22);
            assert!(span.parent_span_id.is_empty());
            assert_eq!(span.status.code, StatusCode::Error as u32);
            assert_eq!(span.status.message, b"bad");
            let attrs: Vec<_> = span.attributes().into_iter().collect();
            assert_eq!(attrs.len(), 2);
            assert!(matches!(attrs[0].value, AnyValue::String(b"v")));
            let AnyValue::Array(items) = attrs[1].value else {
                panic!()
            };
            assert_eq!(items.len(), 2);
            let ev = span.events().into_iter().next().unwrap();
            assert_eq!((ev.name, ev.time_ns), (&b"e"[..], 33));
            assert!(matches!(
                ev.attributes().into_iter().next().unwrap().value,
                AnyValue::Bool(false)
            ));
            assert!(span.links().is_empty());
        });
        assert_eq!(seen, 1);
    }
}

/// `ExportTraceServiceResponse.partial_success` → (rejected_spans, error_message).
pub fn partial_success(body: &[u8]) -> Option<(u64, Vec<u8>)> {
    for (field, v) in fields(body) {
        if let (1, Value::Len(ps)) = (field, v) {
            let mut rejected = 0u64;
            let mut message = Vec::new();
            for (f, v) in fields(ps) {
                match (f, v) {
                    (1, Value::Varint(n)) => rejected = n,
                    (2, Value::Len(m)) => message = m.to_vec(),
                    _ => {}
                }
            }
            return Some((rejected, message));
        }
    }
    None
}
