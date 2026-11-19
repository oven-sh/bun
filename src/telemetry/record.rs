//! A span that has started. What it gathers is encoded as it arrives, so it keeps no value alive.

use std::net::IpAddr;
use std::sync::Arc;

use crate::http_record::{self, Facts};
use crate::otlp::{self, EntryWriter, SpanWriter, Value, field};
use crate::span::{SpanContext, SpanStub, StatusCode};
use crate::{clock, processor, state};

/// The W3C `tracestate` and `baggage` a trace arrived with, shared by every span below.
pub struct Carried {
    trace_state_len: usize,
    bytes: Box<[u8]>,
}

impl Carried {
    pub fn new(trace_state: &[u8], baggage: &[u8]) -> Option<Arc<Carried>> {
        if trace_state.is_empty() && baggage.is_empty() {
            return None;
        }
        Some(Arc::new(Carried {
            trace_state_len: trace_state.len(),
            bytes: [trace_state, baggage].concat().into_boxed_slice(),
        }))
    }

    /// The `tracestate` and the `baggage`, each empty if there is none.
    #[inline]
    pub fn parts(carried: &Option<Arc<Carried>>) -> (&[u8], &[u8]) {
        match carried {
            Some(c) => c.bytes.split_at(c.trace_state_len),
            None => (b"", b""),
        }
    }
}

/// One of 64 buckets, from the length and three bytes of `key`.
#[inline(always)]
fn key_bit(key: &[u8]) -> u64 {
    let n = key.len();
    let h = match n {
        0 => 0,
        _ => {
            n.wrapping_mul(31)
                ^ (key[0] as usize).wrapping_mul(7)
                ^ (key[n - 1] as usize).wrapping_mul(13)
                ^ (key[n / 2] as usize)
        }
    };
    1u64 << (h & 63)
}

pub struct Record {
    /// Encoded `Span.attributes`, `Span.events` and `Span.links` entries.
    fields: Vec<u8>,
    /// The name, then the status message.
    text: Vec<u8>,
    name_len: u32,
    /// The [`key_bit`] of every attribute: a clear bit spares the search for a duplicate.
    attr_keys: u64,
    n_attrs: u16,
    n_events: u16,
    n_links: u16,
    dropped_attrs: u16,
    dropped_events: u16,
    dropped_links: u16,
    status: StatusCode,
    /// Of an HTTP server span. A pooled record keeps it for the next one.
    http: Option<Box<Facts>>,
    is_http_server: bool,
}

const _: () = assert!(size_of::<Record>() <= 88);

impl Record {
    fn new() -> Record {
        Record {
            fields: Vec::new(),
            text: Vec::new(),
            name_len: 0,
            attr_keys: 0,
            n_attrs: 0,
            n_events: 0,
            n_links: 0,
            dropped_attrs: 0,
            dropped_events: 0,
            dropped_links: 0,
            status: StatusCode::Unset,
            http: None,
            is_http_server: false,
        }
    }

    pub fn capacity(&self) -> usize {
        let http = self.http.as_ref().map_or(0, |facts| facts.capacity());
        self.fields.capacity() + self.text.capacity() + http
    }

    fn clear(&mut self) {
        self.fields.clear();
        self.text.clear();
        self.name_len = 0;
        self.attr_keys = 0;
        self.n_attrs = 0;
        self.n_events = 0;
        self.n_links = 0;
        self.dropped_attrs = 0;
        self.dropped_events = 0;
        self.dropped_links = 0;
        self.status = StatusCode::Unset;
        self.is_http_server = false;
    }

    /// Makes this the record of an HTTP server span.
    #[inline]
    pub fn begin_http_server(&mut self) -> &mut Facts {
        self.is_http_server = true;
        let facts = self.http.get_or_insert_with(|| Box::new(Facts::new()));
        facts.clear();
        facts
    }

    #[inline]
    fn http(&self) -> Option<&Facts> {
        self.http.as_deref().filter(|_| self.is_http_server)
    }

    #[inline]
    pub fn http_mut(&mut self) -> Option<&mut Facts> {
        self.http.as_deref_mut().filter(|_| self.is_http_server)
    }

    #[inline]
    pub(crate) fn name(&self) -> &[u8] {
        &self.text[..self.name_len as usize]
    }

    #[inline]
    fn status_message(&self) -> &[u8] {
        &self.text[self.name_len as usize..]
    }

    #[optimize(speed)]
    pub fn set_name(&mut self, name: &[u8]) {
        let name = otlp::truncate_utf8(name, u16::MAX as usize);
        self.text
            .splice(..self.name_len as usize, name.iter().copied());
        self.name_len = name.len() as u32;
    }

    pub fn prefix_name(&mut self, word: &[u8]) {
        self.text.splice(..0, word.iter().copied().chain(*b" "));
        self.name_len += word.len() as u32 + 1;
    }

    /// The name the span would be exported with now.
    pub fn append_name(&self, out: &mut Vec<u8>) {
        match self.http() {
            Some(facts) if self.name_len == 0 => facts.append_name(out),
            _ => out.extend_from_slice(self.name()),
        }
    }

    #[inline]
    fn find_attribute(&self, key: &[u8]) -> Option<core::ops::Range<usize>> {
        if self.attr_keys & key_bit(key) == 0 {
            return None;
        }
        otlp::find_attribute(&self.fields, key)
    }

    pub fn has_attribute(&self, key: &[u8]) -> bool {
        self.find_attribute(key).is_some()
    }

    /// The last write wins, in the place of the first.
    #[optimize(speed)]
    pub fn set_attribute(&mut self, key: &[u8], v: &Value<'_>) {
        if let (Some(facts), b"http.route", Value::Str(route)) = (self.http_mut(), key, v) {
            return facts.set_route(route);
        }
        let limits = &state().limits;
        let old = self.find_attribute(key);
        if old.is_none() {
            if self.n_attrs >= limits.attributes {
                self.dropped_attrs = self.dropped_attrs.saturating_add(1);
                return;
            }
            self.n_attrs += 1;
            self.attr_keys |= key_bit(key);
            if let Some(facts) = self.http_mut() {
                facts.user_keys.insert(key);
            }
        }
        let end = self.fields.len();
        let max_len = limits.attribute_value_length as usize;
        otlp::write_key_value_limited(&mut self.fields, field::ATTRIBUTES, key, v, max_len);
        if let Some(old) = old {
            let new_len = self.fields.len() - end;
            self.fields[old.end..].rotate_right(new_len);
            self.fields.drain(old);
        }
    }

    #[inline]
    pub fn attr<'v>(&mut self, key: &'static str, v: impl Into<Value<'v>>) -> &mut Self {
        self.set_attribute(key.as_bytes(), &v.into());
        self
    }

    /// Nothing if `v` is empty.
    #[inline]
    pub fn attr_opt(&mut self, key: &'static str, v: &[u8]) -> &mut Self {
        if v.is_empty() {
            self
        } else {
            self.attr(key, v)
        }
    }

    /// `server.address` and, unless it is 0, `server.port`.
    pub fn server(&mut self, host: &[u8], port: u16) -> &mut Self {
        if host.is_empty() {
            return self;
        }
        self.attr(
            "server.address",
            bun_core::ip_address::strip_ipv6_brackets(host),
        );
        if port == 0 {
            self
        } else {
            self.attr("server.port", port)
        }
    }

    /// `url.full`, without credentials.
    pub fn url(&mut self, url: &[u8]) -> &mut Self {
        self.attr("url.full", &*otlp::redact_url(url))
    }

    /// `network.peer.address`, from 4 or 16 octets, and `network.peer.port`.
    pub fn peer(&mut self, octets: &[u8], port: u16) -> &mut Self {
        let ip = (<[u8; 4]>::try_from(octets).map(IpAddr::from))
            .or_else(|_| <[u8; 16]>::try_from(octets).map(IpAddr::from));
        match ip {
            Ok(ip) => self
                .attr("network.peer.address", &*ip.to_string())
                .attr("network.peer.port", port),
            Err(_) => self,
        }
    }

    /// `Ok` is final, and only `Error` has a message.
    pub fn set_status(&mut self, code: StatusCode, message: &[u8]) {
        if self.status == StatusCode::Ok || code == StatusCode::Unset {
            return;
        }
        self.status = code;
        self.text.truncate(self.name_len as usize);
        if code == StatusCode::Error {
            self.text.extend_from_slice(message);
        }
    }

    /// `None` at the event limit.
    pub fn begin_event(&mut self, name: &[u8], time_ns: u64) -> Option<EntryWriter<'_>> {
        let limits = &state().limits;
        if self.n_events >= limits.events {
            self.dropped_events = self.dropped_events.saturating_add(1);
            return None;
        }
        self.n_events += 1;
        Some(EntryWriter::event(
            &mut self.fields,
            name,
            clock::or_now(time_ns),
            limits.attribute_value_length as usize,
        ))
    }

    /// `None` at the link limit.
    pub fn begin_link(&mut self, ctx: &SpanContext, trace_state: &[u8]) -> Option<EntryWriter<'_>> {
        let limits = &state().limits;
        if self.n_links >= limits.links {
            self.dropped_links = self.dropped_links.saturating_add(1);
            return None;
        }
        self.n_links += 1;
        Some(EntryWriter::link(
            &mut self.fields,
            ctx,
            trace_state,
            limits.attribute_value_length as usize,
        ))
    }

    /// An `exception` event. semconv asks for a type or a message, so there is none without both.
    pub fn add_exception(&mut self, e: &Exception<'_>, time_ns: u64) {
        if e.ty.is_empty() && e.message.is_empty() {
            return;
        }
        if let Some(mut event) = self.begin_event(b"exception", time_ns) {
            e.write(&mut event);
        }
    }

    /// An outcome that is an error though nothing was thrown, like an exit code.
    pub fn error(&mut self, ty: &[u8], message: &[u8]) {
        self.attr("error.type", ty);
        self.set_status(StatusCode::Error, message);
    }

    pub fn fail(&mut self, e: &Exception<'_>) {
        self.add_exception(e, 0);
        let ty: &[u8] = if e.ty.is_empty() { b"Error" } else { e.ty };
        self.error(ty, &otlp::redact_urls_in(e.message));
    }

    /// [`fail`](Self::fail) for an error of native code. The code stands in for a missing message.
    pub fn fail_with_code(&mut self, code: &[u8], message: &[u8]) {
        let ty: &[u8] = if code.is_empty() { b"_OTHER" } else { code };
        self.fail(&Exception {
            ty,
            message: if message.is_empty() { ty } else { message },
            stack: b"",
        });
    }
}

pub use otlp::Exception;

/// Records of ended spans, kept for their buffers.
#[allow(clippy::vec_box, reason = "a span takes the box as it is")]
pub struct RecordPool(Vec<Box<Record>>);

impl RecordPool {
    const MAX_RECORDS: usize = 64;
    const MAX_RECORD_CAPACITY: usize = 1024;

    pub const fn new() -> RecordPool {
        RecordPool(Vec::new())
    }

    #[inline]
    pub fn take(&mut self) -> Box<Record> {
        self.0.pop().unwrap_or_else(|| Box::new(Record::new()))
    }

    #[inline]
    fn put(&mut self, mut record: Box<Record>) {
        if self.0.len() < Self::MAX_RECORDS && record.capacity() <= Self::MAX_RECORD_CAPACITY {
            record.clear();
            self.0.push(record);
        }
    }
}

pub struct SpanData {
    pub stub: SpanStub,
    pub carried: Option<Arc<Carried>>,
    /// From the first attribute, event, link or status until the span ends.
    record: Option<Box<Record>>,
}

const _: () = assert!(size_of::<SpanData>() == 64);

impl SpanData {
    #[inline]
    pub fn new(stub: SpanStub, carried: Option<Arc<Carried>>) -> SpanData {
        SpanData {
            stub,
            carried,
            record: None,
        }
    }

    #[inline]
    pub fn is_recording(&self) -> bool {
        self.stub.is_recording()
    }

    pub fn trace_state(&self) -> &[u8] {
        Carried::parts(&self.carried).0
    }

    pub fn baggage(&self) -> &[u8] {
        Carried::parts(&self.carried).1
    }

    #[inline]
    pub fn record(&self) -> Option<&Record> {
        self.record.as_deref()
    }

    /// `None` unless the span is recording. `take` supplies the record of a span that has none yet.
    #[inline]
    #[optimize(speed)]
    pub fn record_mut(
        &mut self,
        take: impl FnOnce() -> Option<Box<Record>>,
    ) -> Option<&mut Record> {
        if !self.is_recording() {
            return None;
        }
        if self.record.is_none() {
            self.record = take();
        }
        self.record.as_deref_mut()
    }

    /// Ends the span without exporting it.
    pub fn discard(&mut self) {
        self.stub.ctx.flags = self.stub.ctx.flags.with_ended();
        self.record = None;
    }

    /// Queues the span. An empty `name` leaves the recorded one.
    /// `end_ns` 0 is now.
    #[optimize(speed)]
    pub fn end(&mut self, records: &mut RecordPool, name: &[u8], end_ns: u64) {
        if !self.is_recording() {
            return self.discard();
        }
        let end_ns = clock::or_now(end_ns);
        let record = self.record.take();
        let name = match &record {
            Some(r) if name.is_empty() => r.name(),
            _ => name,
        };
        let processor = processor::global();
        match record.as_deref() {
            Some(r) if let Some(facts) = r.http() => {
                let parts = http_record::SpanParts {
                    stub: &self.stub,
                    end_ns,
                    name_override: name,
                    trace_state: self.trace_state(),
                    fields: &r.fields,
                    n_attrs: r.n_attrs,
                    dropped: [r.dropped_attrs, r.dropped_events, r.dropped_links],
                    status: r.status,
                    status_message: r.status_message(),
                };
                processor.record(&mut |queue| queue.requests.push(facts, &parts, &state().limits));
            }
            r => processor.record(&mut |queue| {
                let out = queue.scope(self.stub.scope);
                let mut w = SpanWriter::begin(out, &self.stub, name, end_ns);
                w.trace_state(self.trace_state());
                if let Some(r) = r {
                    w.raw(&r.fields)
                        .dropped_attributes(r.dropped_attrs.into())
                        .dropped_events(r.dropped_events.into())
                        .dropped_links(r.dropped_links.into())
                        .status(r.status, r.status_message());
                }
            }),
        }
        if let Some(record) = record {
            records.put(record);
        }
        self.stub.ctx.flags = self.stub.ctx.flags.with_ended();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::Reader;

    fn keys(record: &Record) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let mut r = Reader::new(&record.fields);
        while let Ok(Some((f, entry))) = r.next() {
            if f == field::ATTRIBUTES {
                let (_, key) = Reader::new(entry.as_bytes()).next().unwrap().unwrap();
                out.push(key.as_bytes().to_vec());
            }
        }
        out
    }

    #[test]
    fn set_attribute_overwrites_in_place_when_key_bits_collide() {
        let mut record = Record::new();
        // 100 keys in 64 buckets.
        let all: Vec<Vec<u8>> = (0..100u32).map(|i| format!("k{i}").into_bytes()).collect();
        for k in &all {
            record.set_attribute(k, &Value::Int(1));
        }
        for k in all.iter().rev() {
            record.set_attribute(k, &Value::Str(b"longer than before"));
        }
        assert_eq!(record.n_attrs as usize, all.len());
        assert_eq!(keys(&record), all);
    }

    #[test]
    fn an_event_named_like_an_attribute_is_not_one() {
        let mut record = Record::new();
        record.set_attribute(b"a", &Value::Int(1));
        record
            .begin_event(b"a", 1)
            .unwrap()
            .attr(b"b", &Value::Int(2));
        record.attr_keys = u64::MAX;
        assert!(!record.has_attribute(b"b"));
        record.set_attribute(b"a", &Value::Int(300));
        assert_eq!(keys(&record), [b"a".to_vec()]);
    }

    #[test]
    fn an_empty_code_or_message_is_filled_in() {
        let mut record = Record::new();
        record.fail_with_code(b"", b"");
        assert_eq!(record.status_message(), b"_OTHER");
        assert_eq!(
            (record.n_events, keys(&record)),
            (1, vec![b"error.type".to_vec()])
        );
    }

    #[test]
    fn name_and_status_message_share_a_buffer() {
        let mut record = Record::new();
        record.set_name(b"db");
        record.set_status(StatusCode::Error, b"first");
        record.prefix_name(b"SELECT");
        assert_eq!(record.name(), b"SELECT db");
        assert_eq!(record.status_message(), b"first");
        record.set_name(b"x");
        record.set_status(StatusCode::Error, b"second");
        assert_eq!(record.name(), b"x");
        assert_eq!(record.status_message(), b"second");
        record.set_status(StatusCode::Ok, b"");
        record.set_status(StatusCode::Error, b"ignored");
        assert_eq!(record.status_message(), b"");
    }
}
