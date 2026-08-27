//! Per-VM slots for spans that outlive one native call but are never
//! owned by JS (request spans, DB queries, child processes). A slot's buffers
//! survive release, so steady-state span bookkeeping does not allocate.
//!
//! A [`NativeSpan`] handle is `(index, generation)`; a stale handle (span
//! already ended) resolves to nothing, which is what lets a JS wrapper keep a
//! handle without keeping the slot alive.

use crate::otlp::{self, SpanWriter, Value, field};
use crate::span::{SpanKind, SpanStub, StatusCode};
use crate::{Limits, Local, ScopeId, clock};

/// `index | generation << 32`; 0 is the empty handle (generation starts at 1).
/// The generation is kept below 2^21 so the handle round-trips through a JS
/// number (f64) exactly.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(transparent)]
pub struct NativeSpan(pub u64);

const GENERATION_MASK: u32 = (1 << 21) - 1;

impl NativeSpan {
    pub const NONE: NativeSpan = NativeSpan(0);
    #[inline]
    pub fn is_some(self) -> bool {
        self.0 != 0
    }
    #[inline]
    fn index(self) -> usize {
        (self.0 as u32) as usize
    }
    #[inline]
    fn generation(self) -> u32 {
        (self.0 >> 32) as u32
    }
    #[inline]
    fn pack(index: usize, generation: u32) -> NativeSpan {
        NativeSpan(index as u64 | ((generation as u64) << 32))
    }
}

/// The JS `Span` cell (an EncodedJSValue owned by the runtime) materialized
/// for a pooled span; the runtime protects it while set and releases it when
/// the span ends. `NONE` = no cell.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct JsCellRef(pub usize);

impl JsCellRef {
    pub const NONE: JsCellRef = JsCellRef(0);
    #[inline]
    pub fn is_some(self) -> bool {
        self.0 != 0
    }
}

/// Which of 64 buckets an attribute key falls in (length and edge bytes:
/// cheap, and distinct for the handful of keys one span carries).
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

pub struct Slot {
    generation: u32,
    live: bool,
    pub js_cell: JsCellRef,
    pub stub: SpanStub,
    pub scope: ScopeId,
    pub kind: SpanKind,
    status: StatusCode,
    n_attrs: u16,
    dropped_attrs: u16,
    /// One bit per `key_bit(key)` of the attributes pushed so far, so
    /// `set_attribute` only scans for a duplicate when there may be one.
    attr_keys: u64,
    n_events: u16,
    n_links: u16,
    dropped_events: u16,
    dropped_links: u16,
    pub name: Vec<u8>,
    /// Pre-encoded `Span.attributes` entries, append-only.
    attrs: Vec<u8>,
    /// Pre-encoded `Span.events` / `Span.links` entries.
    extra: Vec<u8>,
    status_message: Vec<u8>,
    pub trace_state: Vec<u8>,
    pub baggage: Vec<u8>,
    /// HTTP server request facts (record mode; see http_record.rs).
    pub http: crate::http_record::Facts,
}

impl Slot {
    fn new() -> Slot {
        Slot {
            generation: 0,
            live: false,
            js_cell: JsCellRef::NONE,
            stub: SpanStub::NONE,
            scope: ScopeId(0),
            kind: SpanKind::Internal,
            status: StatusCode::Unset,
            n_attrs: 0,
            dropped_attrs: 0,
            attr_keys: 0,
            n_events: 0,
            n_links: 0,
            dropped_events: 0,
            dropped_links: 0,
            name: Vec::new(),
            attrs: Vec::with_capacity(512),
            extra: Vec::new(),
            status_message: Vec::new(),
            trace_state: Vec::new(),
            baggage: Vec::new(),
            http: crate::http_record::Facts::new(),
        }
    }

    /// A slot that will never be handed out again: no buffers.
    fn retired(generation: u32) -> Slot {
        Slot {
            generation,
            attrs: Vec::new(),
            ..Slot::new()
        }
    }

    fn reset(&mut self) {
        self.live = false;
        self.js_cell = JsCellRef::NONE;
        self.status = StatusCode::Unset;
        self.n_attrs = 0;
        self.dropped_attrs = 0;
        self.attr_keys = 0;
        self.n_events = 0;
        self.n_links = 0;
        self.dropped_events = 0;
        self.dropped_links = 0;
        self.name.clear();
        self.attrs.clear();
        self.extra.clear();
        self.status_message.clear();
        self.trace_state.clear();
        self.baggage.clear();
        self.http.reset();
        // A pathological span shouldn't pin megabytes per slot forever.
        if self.attrs.capacity() > 16 * 1024 {
            self.attrs = Vec::with_capacity(512);
        }
        if self.extra.capacity() > 16 * 1024 {
            self.extra = Vec::new();
        }
    }

    #[inline]
    pub fn is_recording(&self) -> bool {
        self.stub.is_recording()
    }

    /// An attribute with this key has been recorded on the span.
    #[inline]
    pub fn has_attribute(&self, key: &[u8]) -> bool {
        self.attr_keys & key_bit(key) != 0 && otlp::find_attribute(&self.attrs, key).is_some()
    }

    #[inline]
    pub fn set_name(&mut self, name: &[u8]) {
        self.name.clear();
        self.name.extend_from_slice(name);
    }

    /// Append an attribute. Native integrations never repeat a key, so this
    /// is append-only; JS-set attributes on native spans go through
    /// [`Slot::set_attribute`] which replaces.
    #[inline]
    pub fn push_attribute(&mut self, key: &[u8], v: &Value<'_>, limits: &Limits) {
        if self.n_attrs >= limits.attributes {
            self.dropped_attrs = self.dropped_attrs.saturating_add(1);
            return;
        }
        self.n_attrs += 1;
        self.attr_keys |= key_bit(key);
        if self.http.active {
            self.http.user_keys.insert(key);
        }
        otlp::write_key_value_limited(
            &mut self.attrs,
            field::ATTRIBUTES,
            key,
            v,
            limits.attribute_value_length as usize,
        );
    }

    /// Last-write-wins variant for keys that may repeat (user code).
    pub fn set_attribute(&mut self, key: &[u8], v: &Value<'_>, limits: &Limits) {
        // `http.route` on a request span is the route, which also names the
        // span; a non-string value is just an attribute (and the derived
        // `http.route` then stays off, like any other key set from JS).
        if self.http.active && key == b"http.route" {
            if let Value::Str(route) = *v {
                self.http.set_route(route);
                return;
            }
        }
        if self.attr_keys & key_bit(key) != 0 {
            if let Some((off, len)) = otlp::find_attribute(&self.attrs, key) {
                self.attrs.drain(off..off + len);
                self.n_attrs -= 1;
                if self.http.active {
                    self.http.user_keys.remove(key);
                }
            }
        }
        self.push_attribute(key, v, limits);
    }

    pub fn set_status(&mut self, code: StatusCode, message: &[u8]) {
        if self.status == StatusCode::Ok || code == StatusCode::Unset {
            return;
        }
        self.status = code;
        self.status_message.clear();
        if code == StatusCode::Error {
            self.status_message.extend_from_slice(message);
        }
    }

    /// `None` when the event limit is reached (counted as dropped).
    pub fn begin_event(
        &mut self,
        name: &[u8],
        time_ns: u64,
        limits: &Limits,
    ) -> Option<otlp::EntryWriter<'_>> {
        if self.n_events >= limits.events {
            self.dropped_events = self.dropped_events.saturating_add(1);
            return None;
        }
        self.n_events += 1;
        let t = clock::or_now(time_ns);
        Some(otlp::EntryWriter::event(
            &mut self.extra,
            name,
            t,
            limits.attribute_value_length as usize,
        ))
    }

    /// `None` when the link limit is reached (counted as dropped).
    pub fn begin_link(
        &mut self,
        ctx: &crate::SpanContext,
        trace_state: &[u8],
        limits: &Limits,
    ) -> Option<otlp::EntryWriter<'_>> {
        if self.n_links >= limits.links {
            self.dropped_links = self.dropped_links.saturating_add(1);
            return None;
        }
        self.n_links += 1;
        Some(otlp::EntryWriter::link(
            &mut self.extra,
            ctx,
            trace_state,
            limits.attribute_value_length as usize,
        ))
    }

    fn write(
        &self,
        templates: &mut crate::http_record::Cache,
        out: &mut Vec<u8>,
        end_ns: u64,
        extra: &mut dyn FnMut(&mut SpanWriter<'_>),
    ) {
        if self.http.active {
            crate::http_record::encode(
                templates,
                out,
                &self.http,
                &crate::http_record::SpanParts {
                    stub: &self.stub,
                    end_ns,
                    name_override: &self.name,
                    trace_state: &self.trace_state,
                    attrs: &self.attrs,
                    n_attrs: self.n_attrs,
                    dropped_attrs: self.dropped_attrs,
                    dropped_events: self.dropped_events,
                    dropped_links: self.dropped_links,
                    extra: &self.extra,
                    status: self.status,
                    status_message: &self.status_message,
                },
                &crate::state().limits,
            );
            return;
        }
        let mut w = SpanWriter::begin(
            out,
            &self.stub,
            &self.name,
            self.kind,
            end_ns,
            crate::state().limits.attribute_value_length,
        );
        w.trace_state(&self.trace_state);
        w.raw(&self.attrs);
        // (end-time attributes from `extra` get the same value limit as begin-time ones)
        extra(&mut w);
        w.raw(&self.extra);
        if self.dropped_attrs != 0 {
            w.dropped_attributes(self.dropped_attrs as u32);
        }
        if self.dropped_events != 0 {
            w.dropped_events(self.dropped_events as u32);
        }
        if self.dropped_links != 0 {
            w.dropped_links(self.dropped_links as u32);
        }
        w.status(self.status, &self.status_message);
        w.finish();
    }
}

pub struct Pool {
    slots: Vec<Slot>,
    /// FIFO so a released slot (whose identity stale handles may still read)
    /// is reused as late as possible.
    free: std::collections::VecDeque<u32>,
}

impl Pool {
    pub const fn new() -> Pool {
        Pool {
            slots: Vec::new(),
            free: std::collections::VecDeque::new(),
        }
    }

    #[inline]
    fn slot(&self, handle: NativeSpan) -> Option<&Slot> {
        if !handle.is_some() {
            return None;
        }
        let slot = self.slots.get(handle.index())?;
        (slot.live && slot.generation == handle.generation()).then_some(slot)
    }

    #[inline]
    fn live_slot(&mut self, handle: NativeSpan) -> Option<&mut Slot> {
        if !handle.is_some() {
            return None;
        }
        let slot = self.slots.get_mut(handle.index())?;
        (slot.live && slot.generation == handle.generation()).then_some(slot)
    }

    fn release(&mut self, handle: NativeSpan) {
        let slot = &mut self.slots[handle.index()];
        // A slot whose generation is about to wrap is retired rather than
        // reused, so a stale handle can never alias a later span; a retired
        // slot gives its buffers back so it costs only its inline bytes.
        if slot.generation < GENERATION_MASK {
            slot.reset();
            self.free.push_back(handle.index() as u32);
        } else {
            *slot = Slot::retired(slot.generation);
        }
    }
}

/// Claim a slot for a span that has started and run `init` on it. Returns
/// `NONE` for `SpanStub::NONE`. `trace_state`: the W3C tracestate this span
/// carries (its parent's, or the inbound header's for a server span); empty
/// for none.
#[inline]
pub fn begin_with(
    p: &mut Pool,
    stub: SpanStub,
    scope: ScopeId,
    name: &[u8],
    kind: SpanKind,
    trace_state: &[u8],
    init: impl FnOnce(&mut Slot),
) -> NativeSpan {
    if !stub.is_some() {
        return NativeSpan::NONE;
    }
    let index = match p.free.pop_front() {
        Some(i) => i as usize,
        None => {
            p.slots.push(Slot::new());
            p.slots.len() - 1
        }
    };
    let slot = &mut p.slots[index];
    slot.generation = (slot.generation.wrapping_add(1) & GENERATION_MASK).max(1);
    slot.live = true;
    slot.stub = stub;
    slot.scope = scope;
    slot.kind = kind;
    slot.name.extend_from_slice(name);
    slot.trace_state.extend_from_slice(trace_state);
    init(slot);
    NativeSpan::pack(index, slot.generation)
}

/// Run `f` on the live slot for `handle`. Returns `None` if the span has ended.
#[inline]
pub fn with<R>(p: &mut Pool, handle: NativeSpan, f: impl FnOnce(&mut Slot) -> R) -> Option<R> {
    p.live_slot(handle).map(f)
}

/// Read-only access (e.g. propagation reading trace state).
#[inline]
pub fn with_ref<R>(p: &Pool, handle: NativeSpan, f: impl FnOnce(&Slot) -> R) -> Option<R> {
    p.slot(handle).map(f)
}

/// Result of [`end`]: whether a span was recorded, and the JS cell that had
/// been materialized for it so the caller can release it — with the W3C
/// `tracestate` / `baggage` the span carried, which the cell keeps answering
/// for (`spanContext().traceState`, `propagation.inject`) after the slot is gone.
#[must_use = "the materialized js_cell must be released (rt::end_pooled / Hooks::release_cell)"]
pub struct Ended {
    pub recorded: bool,
    pub js_cell: JsCellRef,
    /// `(trace_state, baggage)`; only when `js_cell` is some and either is non-empty.
    pub propagation: Option<Box<(Vec<u8>, Vec<u8>)>>,
}

/// End the span: encode it into the VM's batch (if recording) and release
/// the slot. `extra` adds integration attributes at end time. Returns `None`
/// if the handle was stale.
#[inline(never)]
pub fn end(
    l: &mut Local,
    handle: NativeSpan,
    end_ns: u64,
    extra: &mut dyn FnMut(&mut SpanWriter<'_>),
) -> Option<Ended> {
    let end_ns = clock::or_now(end_ns);
    let Local {
        pool,
        batch,
        http_templates,
        ..
    } = l;
    let slot = pool.live_slot(handle)?;
    let js_cell = slot.js_cell;
    let propagation = (js_cell.is_some()
        && !(slot.trace_state.is_empty() && slot.baggage.is_empty()))
    .then(|| Box::new((slot.trace_state.clone(), slot.baggage.clone())));
    let recording = slot.is_recording();
    if recording {
        crate::batch::record(batch, slot.scope, &mut |buf: &mut Vec<u8>| {
            slot.write(http_templates, buf, end_ns, extra)
        });
    }
    pool.release(handle);
    Some(Ended {
        recorded: recording,
        js_cell,
        propagation,
    })
}

/// Release without recording (e.g. the owner was torn down mid-flight and
/// the integration has nothing truthful to say about the outcome).
#[must_use = "the returned js_cell must be released"]
pub fn discard(p: &mut Pool, handle: NativeSpan) -> JsCellRef {
    let Some(slot) = p.live_slot(handle) else {
        return JsCellRef::NONE;
    };
    let cell = slot.js_cell;
    p.release(handle);
    cell
}

/// Identity of a live span; `None` once it has ended (an ended span is
/// nobody's parent: its slot and ids may be reused at any moment, so the
/// answer must not depend on whether they have been yet).
pub fn stub(p: &Pool, handle: NativeSpan) -> Option<SpanStub> {
    p.slot(handle).map(|s| s.stub)
}

/// Whether the span behind `handle` is still open.
pub fn is_live(p: &Pool, handle: NativeSpan) -> bool {
    p.slot(handle).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DEFAULT_LIMITS;

    #[test]
    fn set_attribute_is_last_write_wins_even_when_key_bits_collide() {
        let mut slot = Slot::new();
        let l = &DEFAULT_LIMITS;
        // Distinct keys, some of which share a `key_bit` bucket by construction
        // (64 buckets, 100 keys), then overwrite every one.
        let keys: Vec<Vec<u8>> = (0..100u32).map(|i| format!("k{i}").into_bytes()).collect();
        for k in &keys {
            slot.set_attribute(k, &Value::Int(1), l);
        }
        for k in &keys {
            slot.set_attribute(k, &Value::Int(2), l);
        }
        assert_eq!(slot.n_attrs as usize, keys.len());
        for k in &keys {
            let (off, len) = otlp::find_attribute(&slot.attrs, k).expect("present once");
            // and only once
            assert!(otlp::find_attribute(&slot.attrs[off + len..], k).is_none());
        }
        // A key never set is not found and its bucket bit alone does not confuse set_attribute.
        slot.set_attribute(b"fresh", &Value::Bool(true), l);
        assert!(otlp::find_attribute(&slot.attrs, b"fresh").is_some());
    }
}
