//! Per-VM slots for spans that outlive one native call but are never
//! owned by JS (request spans, DB queries, child processes). A slot's buffers
//! survive release, so steady-state span bookkeeping does not allocate.
//!
//! A [`NativeSpan`] handle is `(index, generation)`; a stale handle (span
//! already ended) resolves to nothing, which is what lets a JS wrapper keep a
//! handle without keeping the slot alive.

use crate::otlp::{self, SpanWriter, Value, field};
use crate::span::{SpanKind, SpanStub, StatusCode};
use crate::{Limits, Local, ScopeId, clock, rt};

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

pub struct Slot {
    generation: u32,
    live: bool,
    pub js_cell: JsCellRef,
    pub stub: SpanStub,
    pub scope: ScopeId,
    pub kind: SpanKind,
    pub status: StatusCode,
    pub n_attrs: u16,
    pub dropped_attrs: u16,
    pub n_events: u16,
    pub n_links: u16,
    pub dropped_events: u16,
    pub dropped_links: u16,
    pub name: Vec<u8>,
    /// Pre-encoded `Span.attributes` entries, append-only.
    pub attrs: Vec<u8>,
    /// Pre-encoded `Span.events` / `Span.links` entries.
    pub extra: Vec<u8>,
    pub status_message: Vec<u8>,
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

    fn reset(&mut self) {
        self.live = false;
        self.js_cell = JsCellRef::NONE;
        self.status = StatusCode::Unset;
        self.n_attrs = 0;
        self.dropped_attrs = 0;
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
        match *v {
            Value::Str(s) if s.len() > limits.attribute_value_length as usize => {
                otlp::write_key_value(
                    &mut self.attrs,
                    field::ATTRIBUTES,
                    key,
                    &Value::Str(otlp::truncate_utf8(
                        s,
                        limits.attribute_value_length as usize,
                    )),
                )
            }
            _ => otlp::write_key_value(&mut self.attrs, field::ATTRIBUTES, key, v),
        }
    }

    /// Last-write-wins variant for keys that may repeat (user code).
    pub fn set_attribute(&mut self, key: &[u8], v: &Value<'_>, limits: &Limits) {
        if let Some((off, len)) = otlp::find_attribute(&self.attrs, key) {
            self.attrs.drain(off..off + len);
            self.n_attrs -= 1;
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

    pub fn add_event(
        &mut self,
        name: &[u8],
        time_ns: u64,
        attrs: &[(&[u8], Value<'_>)],
        limits: &Limits,
    ) {
        if self.n_events >= limits.events {
            self.dropped_events = self.dropped_events.saturating_add(1);
            return;
        }
        self.n_events += 1;
        let t = if time_ns == 0 {
            clock::now_unix_nanos()
        } else {
            time_ns
        };
        otlp::encode_event(&mut self.extra, name, t, attrs);
    }

    pub fn add_link(
        &mut self,
        ctx: &crate::SpanContext,
        attrs: &[(&[u8], Value<'_>)],
        limits: &Limits,
    ) {
        if self.n_links >= limits.links {
            self.dropped_links = self.dropped_links.saturating_add(1);
            return;
        }
        self.n_links += 1;
        otlp::encode_link(&mut self.extra, ctx, b"", attrs);
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
                    dropped_attrs: self.dropped_attrs,
                    dropped_events: self.dropped_events,
                    dropped_links: self.dropped_links,
                    extra: &self.extra,
                    status: self.status,
                    status_message: &self.status_message,
                },
                &rt::limits(),
            );
            return;
        }
        let mut w = SpanWriter::begin(out, &self.stub, &self.name, self.kind, end_ns);
        w.trace_state(&self.trace_state);
        w.raw(&self.attrs);
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
    fn live_slot(&mut self, handle: NativeSpan) -> Option<&mut Slot> {
        if !handle.is_some() {
            return None;
        }
        let slot = self.slots.get_mut(handle.index())?;
        if !slot.live || slot.generation != handle.generation() {
            return None;
        }
        Some(slot)
    }

    fn release(&mut self, handle: NativeSpan) {
        self.slots[handle.index()].reset();
        self.free.push_back(handle.index() as u32);
    }
}

/// Claim a slot for a span that has started. Returns `NONE` for `SpanStub::NONE`.
pub fn begin(
    p: &mut Pool,
    stub: SpanStub,
    scope: ScopeId,
    name: &[u8],
    kind: SpanKind,
) -> NativeSpan {
    begin_with(p, stub, scope, name, kind, |_| {})
}

/// [`begin`] plus an initializer run on the fresh slot.
#[inline]
pub fn begin_with(
    p: &mut Pool,
    stub: SpanStub,
    scope: ScopeId,
    name: &[u8],
    kind: SpanKind,
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
    if !handle.is_some() {
        return None;
    }
    let slot = p.slots.get(handle.index())?;
    if !slot.live || slot.generation != handle.generation() {
        return None;
    }
    Some(f(slot))
}

#[inline]
pub fn stub(p: &Pool, handle: NativeSpan) -> SpanStub {
    with_ref(p, handle, |s| s.stub).unwrap_or(SpanStub::NONE)
}

/// Result of [`end`]: whether a span was recorded, and the JS cell that had
/// been materialized for it so the caller can release it.
pub struct Ended {
    pub recorded: bool,
    pub js_cell: JsCellRef,
}

/// End the span: encode it into the VM's batch (if recording) and release
/// the slot. `extra` adds integration attributes at end time. Returns `None`
/// if the handle was stale.
pub fn end(
    l: &mut Local,
    handle: NativeSpan,
    end_ns: u64,
    mut extra: impl FnMut(&mut SpanWriter<'_>),
) -> Option<Ended> {
    end_with(l, handle, end_ns, &mut |_: &mut Slot| {}, &mut extra)
}

/// [`end`] plus a closure that runs on the slot right before it is written.
#[inline(never)]
pub fn end_with(
    l: &mut Local,
    handle: NativeSpan,
    end_ns: u64,
    prep: &mut dyn FnMut(&mut Slot),
    extra: &mut dyn FnMut(&mut SpanWriter<'_>),
) -> Option<Ended> {
    let end_ns = if end_ns == 0 {
        clock::now_unix_nanos()
    } else {
        end_ns
    };
    let Local {
        pool,
        batch,
        http_templates,
        ..
    } = l;
    let slot = pool.live_slot(handle)?;
    prep(slot);
    let mut full = false;
    let js_cell = slot.js_cell;
    let recording = slot.is_recording();
    if recording {
        let buf = batch.buffer(slot.scope);
        let start = buf.len();
        slot.write(http_templates, buf, end_ns, extra);
        full = batch.committed(slot.scope, start);
    }
    pool.release(handle);
    if full {
        crate::batch::flush_local(batch);
    }
    Some(Ended {
        recorded: recording,
        js_cell,
    })
}

/// Release without recording (e.g. the owner was torn down mid-flight and
/// the integration has nothing truthful to say about the outcome).
pub fn discard(p: &mut Pool, handle: NativeSpan) -> JsCellRef {
    let Some(slot) = p.live_slot(handle) else {
        return JsCellRef::NONE;
    };
    let cell = slot.js_cell;
    p.release(handle);
    cell
}

/// Identity of a span by handle, tolerating spans that already ended as long
/// as their slot has not been reused (callbacks captured during a request can
/// outlive it). Pointer is valid until the pool is next mutated.
pub fn stub_ptr(p: &Pool, handle: NativeSpan) -> *const SpanStub {
    if !handle.is_some() {
        return core::ptr::null();
    }
    match p.slots.get(handle.index()) {
        Some(slot) if slot.generation == handle.generation() => &raw const slot.stub,
        _ => core::ptr::null(),
    }
}

/// Whether the span behind `handle` is still open.
pub fn is_live(p: &Pool, handle: NativeSpan) -> bool {
    with_ref(p, handle, |_| ()).is_some()
}
