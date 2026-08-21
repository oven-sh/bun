//! Heap span record for spans that are JS-visible or become the active
//! context (Bun.serve request spans, user spans). Leaf native spans never
//! allocate one of these; they use `SpanStub`.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;

use crate::otlp::{self, SpanWriter, Value, field};
use crate::span::{SpanContext, SpanKind, SpanStub, StatusCode};
use crate::{ScopeId, clock};

pub struct Limits {
    pub attributes: u16,
    pub events: u16,
    pub links: u16,
    pub attribute_value_length: u32,
}

pub const DEFAULT_LIMITS: Limits = Limits { attributes: 128, events: 128, links: 128, attribute_value_length: u32::MAX };

struct Mutable {
    name: Box<[u8]>,
    kind: SpanKind,
    /// Pre-encoded `Span.attributes` entries.
    attrs: Vec<u8>,
    /// (key hash, offset, len) into `attrs`, for last-write-wins.
    attr_index: Vec<(u64, u32, u32)>,
    /// Pre-encoded `Span.events` then `Span.links` entries (order on the wire
    /// is irrelevant).
    extra: Vec<u8>,
    n_events: u16,
    n_links: u16,
    dropped_attrs: u16,
    dropped_events: u16,
    dropped_links: u16,
    status: StatusCode,
    status_message: Box<[u8]>,
    trace_state: Box<[u8]>,
    end_ns: u64,
}

/// Intrusively ref-counted; JS-thread only.
pub struct SpanData {
    ref_count: Cell<u32>,
    pub stub: SpanStub,
    pub scope: ScopeId,
    m: RefCell<Mutable>,
}

/// Owning handle. `Clone` refs, `Drop` derefs.
#[repr(transparent)]
pub struct Span(NonNull<SpanData>);

impl Span {
    pub fn new(stub: SpanStub, scope: ScopeId, name: &[u8], kind: SpanKind) -> Span {
        let b = Box::new(SpanData {
            ref_count: Cell::new(1),
            stub,
            scope,
            m: RefCell::new(Mutable {
                name: name.into(),
                kind,
                attrs: Vec::new(),
                attr_index: Vec::new(),
                extra: Vec::new(),
                n_events: 0,
                n_links: 0,
                dropped_attrs: 0,
                dropped_events: 0,
                dropped_links: 0,
                status: StatusCode::Unset,
                status_message: Box::default(),
                trace_state: Box::default(),
                end_ns: 0,
            }),
        });
        Span(NonNull::from(Box::leak(b)))
    }

    #[inline]
    pub fn as_ptr(&self) -> *mut SpanData {
        self.0.as_ptr()
    }

    /// # Safety
    /// `ptr` must have come from `into_raw`/`as_ptr` of a live `Span` and the
    /// caller must own one reference which this call adopts.
    #[inline]
    pub unsafe fn from_raw(ptr: *mut SpanData) -> Span {
        Span(unsafe { NonNull::new_unchecked(ptr) })
    }

    #[inline]
    pub fn into_raw(self) -> *mut SpanData {
        let p = self.0.as_ptr();
        core::mem::forget(self);
        p
    }

    /// # Safety
    /// `ptr` must point at a live `SpanData`. Returns a new owning reference.
    #[inline]
    pub unsafe fn ref_raw(ptr: *mut SpanData) -> Span {
        let d = unsafe { &*ptr };
        d.ref_count.set(d.ref_count.get() + 1);
        Span(unsafe { NonNull::new_unchecked(ptr) })
    }
}

impl core::ops::Deref for Span {
    type Target = SpanData;
    #[inline]
    fn deref(&self) -> &SpanData {
        // SAFETY: refcount > 0 while a `Span` exists.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for Span {
    #[inline]
    fn clone(&self) -> Span {
        self.ref_count.set(self.ref_count.get() + 1);
        Span(self.0)
    }
}

impl Drop for Span {
    #[inline]
    fn drop(&mut self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: last reference; allocated via Box in `new`.
            drop(unsafe { Box::from_raw(self.0.as_ptr()) });
        }
    }
}

#[inline]
fn key_hash(key: &[u8]) -> u64 {
    // FNV-1a; keys are short and this only guards last-write-wins.
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in key {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

impl SpanData {
    #[inline]
    pub fn context(&self) -> &SpanContext {
        &self.stub.ctx
    }
    #[inline]
    pub fn is_recording(&self) -> bool {
        self.stub.ctx.flags.sampled() && self.m.borrow().end_ns == 0
    }
    #[inline]
    pub fn ended(&self) -> bool {
        self.m.borrow().end_ns != 0
    }
    pub fn kind(&self) -> SpanKind {
        self.m.borrow().kind
    }
    pub fn with_name<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        f(&self.m.borrow().name)
    }

    pub fn set_name(&self, name: &[u8]) {
        if let Ok(mut m) = self.m.try_borrow_mut() {
            if m.end_ns == 0 {
                m.name = name.into();
            }
        }
    }

    pub fn set_kind(&self, kind: SpanKind) {
        if let Ok(mut m) = self.m.try_borrow_mut() {
            if m.end_ns == 0 {
                m.kind = kind;
            }
        }
    }

    pub fn set_attribute(&self, key: &[u8], v: &Value<'_>, limits: &Limits) {
        if !self.stub.ctx.flags.sampled() || key.is_empty() {
            return;
        }
        let Ok(mut m) = self.m.try_borrow_mut() else { return };
        if m.end_ns != 0 {
            return;
        }
        let h = key_hash(key);
        if let Some(i) = m.attr_index.iter().position(|e| e.0 == h) {
            let (_, off, len) = m.attr_index[i];
            let (off, len) = (off as usize, len as usize);
            m.attrs.drain(off..off + len);
            m.attr_index.remove(i);
            for e in m.attr_index.iter_mut() {
                if e.1 as usize > off {
                    e.1 -= len as u32;
                }
            }
        } else if m.attr_index.len() >= limits.attributes as usize {
            m.dropped_attrs = m.dropped_attrs.saturating_add(1);
            return;
        }
        let off = m.attrs.len();
        match *v {
            Value::Str(s) if s.len() > limits.attribute_value_length as usize => {
                otlp::write_key_value(&mut m.attrs, field::ATTRIBUTES, key, &Value::Str(&s[..limits.attribute_value_length as usize]))
            }
            _ => otlp::write_key_value(&mut m.attrs, field::ATTRIBUTES, key, v),
        }
        let len = m.attrs.len() - off;
        m.attr_index.push((h, off as u32, len as u32));
    }

    pub fn add_event(&self, name: &[u8], time_ns: u64, attrs: &[(&[u8], Value<'_>)], limits: &Limits) {
        if !self.stub.ctx.flags.sampled() {
            return;
        }
        let Ok(mut m) = self.m.try_borrow_mut() else { return };
        if m.end_ns != 0 {
            return;
        }
        if m.n_events >= limits.events {
            m.dropped_events = m.dropped_events.saturating_add(1);
            return;
        }
        m.n_events += 1;
        let t = if time_ns == 0 { clock::now_unix_nanos() } else { time_ns };
        otlp::encode_event(&mut m.extra, name, t, attrs);
    }

    pub fn record_exception(&self, ty: &[u8], message: &[u8], stack: &[u8], limits: &Limits) {
        let attrs: [(&[u8], Value<'_>); 3] = [
            (b"exception.type", Value::Str(ty)),
            (b"exception.message", Value::Str(message)),
            (b"exception.stacktrace", Value::Str(stack)),
        ];
        let n = if stack.is_empty() { 2 } else { 3 };
        self.add_event(b"exception", 0, &attrs[..n], limits);
    }

    pub fn add_link(&self, ctx: &SpanContext, trace_state: &[u8], attrs: &[(&[u8], Value<'_>)], limits: &Limits) {
        if !self.stub.ctx.flags.sampled() || !ctx.is_valid() {
            return;
        }
        let Ok(mut m) = self.m.try_borrow_mut() else { return };
        if m.end_ns != 0 {
            return;
        }
        if m.n_links >= limits.links {
            m.dropped_links = m.dropped_links.saturating_add(1);
            return;
        }
        m.n_links += 1;
        otlp::encode_link(&mut m.extra, ctx, trace_state, attrs);
    }

    pub fn set_status(&self, code: StatusCode, message: &[u8]) {
        let Ok(mut m) = self.m.try_borrow_mut() else { return };
        if m.end_ns != 0 {
            return;
        }
        // Spec: Ok is final; setting Unset is ignored; Error can be overridden by Ok.
        if m.status == StatusCode::Ok || code == StatusCode::Unset {
            return;
        }
        m.status = code;
        m.status_message = if code == StatusCode::Error { message.into() } else { Box::default() };
    }

    pub fn set_trace_state(&self, ts: &[u8]) {
        if let Ok(mut m) = self.m.try_borrow_mut() {
            m.trace_state = ts.into();
        }
    }

    /// End the span, letting the caller add final attributes, and write it to
    /// `out`. Returns false if it had already ended (nothing written).
    pub fn end_into(&self, out: &mut Vec<u8>, end_ns: u64, extra: impl FnOnce(&mut SpanWriter<'_>)) -> bool {
        let Ok(mut m) = self.m.try_borrow_mut() else { return false };
        if m.end_ns != 0 {
            return false;
        }
        m.end_ns = if end_ns == 0 { clock::now_unix_nanos() } else { end_ns };
        if !self.stub.ctx.flags.sampled() {
            m.attrs = Vec::new();
            m.extra = Vec::new();
            return false;
        }
        let m = &*m;
        let mut w = SpanWriter::begin(out, &self.stub, &m.name, m.kind, m.end_ns);
        w.trace_state(&m.trace_state);
        extra(&mut w);
        w.raw(&m.attrs).raw(&m.extra);
        if m.dropped_attrs != 0 {
            w.dropped_attributes(m.dropped_attrs as u32);
        }
        if m.dropped_events != 0 {
            w.dropped_events(m.dropped_events as u32);
        }
        if m.dropped_links != 0 {
            w.dropped_links(m.dropped_links as u32);
        }
        w.status(m.status, &m.status_message);
        w.finish();
        true
    }

    /// Release attribute storage after end (the record may outlive end() while
    /// a context cell or JS wrapper still references it).
    pub fn shrink(&self) {
        if let Ok(mut m) = self.m.try_borrow_mut() {
            m.attrs = Vec::new();
            m.attr_index = Vec::new();
            m.extra = Vec::new();
        }
    }
}
