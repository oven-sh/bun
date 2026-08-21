//! Per-thread slots for spans that outlive one native call but are never
//! owned by JS (request spans, DB queries, child processes). A slot's buffers
//! survive release, so steady-state span bookkeeping does not allocate.
//!
//! A [`NativeSpan`] handle is `(index, generation)`; a stale handle (span
//! already ended) resolves to nothing, which is what lets a JS wrapper keep a
//! handle without keeping the slot alive.

use core::cell::RefCell;

use crate::otlp::{self, SpanWriter, Value, field};
use crate::span::{SpanKind, SpanStub, StatusCode};
use crate::{Limits, ScopeId, clock};


/// `index | generation << 32`; 0 is the empty handle (generation starts at 1).
#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(transparent)]
pub struct NativeSpan(pub u64);

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

pub struct Slot {
    generation: u32,
    live: bool,
    /// EncodedJSValue of the JS cell materialized for this span (0 = none);
    /// the runtime protects it while set and releases it at end.
    pub js_cell: usize,
    pub stub: SpanStub,
    pub scope: ScopeId,
    pub kind: SpanKind,
    pub status: StatusCode,
    pub n_attrs: u16,
    pub dropped_attrs: u16,
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
            js_cell: 0,
            stub: SpanStub::NONE,
            scope: ScopeId(0),
            kind: SpanKind::Internal,
            status: StatusCode::Unset,
            n_attrs: 0,
            dropped_attrs: 0,
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
        self.js_cell = 0;
        self.status = StatusCode::Unset;
        self.n_attrs = 0;
        self.dropped_attrs = 0;
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
            Value::Str(s) if s.len() > limits.attribute_value_length as usize => otlp::write_key_value(
                &mut self.attrs,
                field::ATTRIBUTES,
                key,
                &Value::Str(otlp::truncate_utf8(s, limits.attribute_value_length as usize)),
            ),
            _ => otlp::write_key_value(&mut self.attrs, field::ATTRIBUTES, key, v),
        }
    }

    /// `push_attribute` for a string value with a short literal key: the
    /// header and key become inline stores, leaving one copy for the value.
    #[inline(always)]
    pub fn push_str(&mut self, key: &'static str, v: &[u8], limits: &Limits) {
        let v = otlp::truncate_utf8(v, limits.attribute_value_length as usize);
        if !v.is_ascii() && core::str::from_utf8(v).is_err() {
            let lossy = String::from_utf8_lossy(v);
            return self.push_attribute(key.as_bytes(), &Value::Str(lossy.as_bytes()), limits);
        }
        let key = key.as_bytes();
        let kv = 2 + key.len() + 2 + 2 + v.len();
        if self.n_attrs >= limits.attributes || kv >= 128 {
            return self.push_attribute(key, &Value::Str(v), limits);
        }
        self.n_attrs += 1;
        let out = &mut self.attrs;
        out.reserve(kv + 2);
        out.extend_from_slice(&[(field::ATTRIBUTES << 3 | 2) as u8, kv as u8, (1 << 3 | 2) as u8, key.len() as u8]);
        out.extend_from_slice(key);
        out.extend_from_slice(&[(2 << 3 | 2) as u8, (2 + v.len()) as u8, (1 << 3 | 2) as u8, v.len() as u8]);
        out.extend_from_slice(v);
    }

    /// `push_attribute` for a small non-negative integer with a literal key.
    #[inline(always)]
    pub fn push_uint(&mut self, key: &'static str, v: u64, limits: &Limits) {
        let key = key.as_bytes();
        if self.n_attrs >= limits.attributes || v >= 128 || key.len() > 100 {
            return self.push_attribute(key, &Value::Int(v as i64), limits);
        }
        self.n_attrs += 1;
        let kv = 2 + key.len() + 2 + 2;
        let out = &mut self.attrs;
        out.reserve(kv + 2);
        out.extend_from_slice(&[(field::ATTRIBUTES << 3 | 2) as u8, kv as u8, (1 << 3 | 2) as u8, key.len() as u8]);
        out.extend_from_slice(key);
        out.extend_from_slice(&[(2 << 3 | 2) as u8, 2, (3 << 3) as u8, v as u8]);
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

    pub fn add_event(&mut self, name: &[u8], time_ns: u64, attrs: &[(&[u8], Value<'_>)]) {
        let t = if time_ns == 0 { clock::now_unix_nanos() } else { time_ns };
        otlp::encode_event(&mut self.extra, name, t, attrs);
    }

    fn write(&self, out: &mut Vec<u8>, end_ns: u64, extra: impl FnOnce(&mut SpanWriter<'_>)) {
        if self.http.active {
            self.http.write(
                out,
                &self.stub,
                end_ns,
                &self.name,
                &self.trace_state,
                &self.attrs,
                self.dropped_attrs,
                &self.extra,
                self.status,
                &self.status_message,
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
        w.status(self.status, &self.status_message);
        w.finish();
    }
}

struct Pool {
    slots: Vec<Slot>,
    /// FIFO so a released slot (whose identity stale handles may still read)
    /// is reused as late as possible.
    free: std::collections::VecDeque<u32>,
    live: u32,
}

thread_local! {
    static POOL: RefCell<Pool> = const { RefCell::new(Pool { slots: Vec::new(), free: std::collections::VecDeque::new(), live: 0 }) };
}

/// Claim a slot for a span that has started. Returns `NONE` for `SpanStub::NONE`.
pub fn begin(stub: SpanStub, scope: ScopeId, name: &[u8], kind: SpanKind) -> NativeSpan {
    if !stub.is_some() {
        return NativeSpan::NONE;
    }
    POOL.with(|p| {
        let mut p = p.borrow_mut();
        let p = &mut *p;
        let index = match p.free.pop_front() {
            Some(i) => i as usize,
            None => {
                p.slots.push(Slot::new());
                p.slots.len() - 1
            }
        };
        p.live += 1;
        let slot = &mut p.slots[index];
        slot.generation = slot.generation.wrapping_add(1).max(1);
        slot.live = true;
        slot.stub = stub;
        slot.scope = scope;
        slot.kind = kind;
        slot.name.extend_from_slice(name);
        NativeSpan::pack(index, slot.generation)
    })
}

/// Run `f` on the live slot for `handle`. Returns `None` if the span has ended.
#[inline]
pub fn with<R>(handle: NativeSpan, f: impl FnOnce(&mut Slot) -> R) -> Option<R> {
    if !handle.is_some() {
        return None;
    }
    POOL.with(|p| {
        let mut p = p.borrow_mut();
        let slot = p.slots.get_mut(handle.index())?;
        if !slot.live || slot.generation != handle.generation() {
            return None;
        }
        Some(f(slot))
    })
}

/// Read-only access (e.g. propagation reading trace state).
#[inline]
pub fn with_ref<R>(handle: NativeSpan, f: impl FnOnce(&Slot) -> R) -> Option<R> {
    with(handle, |s| f(s))
}

#[inline]
pub fn stub(handle: NativeSpan) -> SpanStub {
    with_ref(handle, |s| s.stub).unwrap_or(SpanStub::NONE)
}

/// Result of [`end`]: whether a span was recorded, and the JS cell that had
/// been materialized for it (0 if none) so the caller can release it.
pub struct Ended {
    pub recorded: bool,
    pub js_cell: usize,
}

/// End the span: encode it into this thread's batch (if recording) and
/// release the slot. `extra` adds integration attributes at end time.
/// Returns `None` if the handle was stale.
pub fn end(handle: NativeSpan, end_ns: u64, extra: impl FnOnce(&mut SpanWriter<'_>)) -> Option<Ended> {
    if !handle.is_some() {
        return None;
    }
    let end_ns = if end_ns == 0 { clock::now_unix_nanos() } else { end_ns };
    // Encode while borrowed, but hand the batch to the processor (which may
    // take locks / call out) after the borrow is released.
    let recorded = POOL.with(|p| {
        let mut p = p.borrow_mut();
        let p = &mut *p;
        let Some(slot) = p.slots.get_mut(handle.index()) else {
            return None;
        };
        if !slot.live || slot.generation != handle.generation() {
            return None;
        }
        let mut full = false;
        let js_cell = slot.js_cell;
        if slot.is_recording() {
            full = crate::batch::with_local(|l| {
                let buf = l.buffer(slot.scope);
                let start = buf.len();
                slot.write(buf, end_ns, extra);
                l.committed(slot.scope, start)
            });
        }
        slot.reset();
        p.free.push_back(handle.index() as u32);
        p.live -= 1;
        Some((full, js_cell))
    });
    let (full, js_cell) = recorded?;
    if full {
        crate::batch::flush_local();
    }
    Some(Ended { recorded: true, js_cell })
}

/// Release without recording (e.g. the owner was torn down mid-flight and
/// the integration has nothing truthful to say about the outcome).
pub fn discard(handle: NativeSpan) -> usize {
    POOL.with(|p| {
        let mut p = p.borrow_mut();
        let p = &mut *p;
        let slot = p.slots.get_mut(handle.index())?;
        let mut cell = 0;
        if slot.live && slot.generation == handle.generation() {
            cell = slot.js_cell;
            slot.reset();
            p.free.push_back(handle.index() as u32);
            p.live -= 1;
        }
        Some(cell)
    })
    .unwrap_or(0)
}

/// Identity of a span by handle, tolerating spans that already ended as long
/// as their slot has not been reused (callbacks captured during a request can
/// outlive it). Pointer is valid until the pool is next mutated on this thread.
pub fn stub_ptr(handle: NativeSpan) -> *const SpanStub {
    if !handle.is_some() {
        return core::ptr::null();
    }
    POOL.with(|p| {
        let p = p.borrow();
        match p.slots.get(handle.index()) {
            Some(slot) if slot.generation == handle.generation() => &slot.stub as *const SpanStub,
            _ => core::ptr::null(),
        }
    })
}

/// Whether the span behind `handle` is still open.
pub fn is_live(handle: NativeSpan) -> bool {
    with_ref(handle, |_| ()).is_some()
}

/// Number of live native spans on this thread (stats / leak tests).
pub fn live_count() -> u32 {
    POOL.with(|p| p.borrow().live)
}
