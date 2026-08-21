//! Glue between `JSTelemetrySpan` (C++, the JS-visible span and async-context
//! value) and `bun_telemetry`: id/sampler/clock at start, protobuf encoding at
//! end, and the native span pool for spans owned by integrations.

use core::ffi::c_void;

use bun_jsc::{JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsResult};
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{
    Flags, Limits, ScopeId, SpanContext, SpanId, SpanKind, SpanStub, SpanWriter, StatusCode,
    TraceId, Value, batch, clock,
};

unsafe extern "C" {
    safe fn Bun__Telemetry__activeSpanStub(global: &JSGlobalObject) -> *const SpanStub;
    safe fn Bun__Telemetry__activeSpanCell(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__enter(global: &JSGlobalObject, span: JSValue) -> JSValue;
    safe fn Bun__Telemetry__exit(global: &JSGlobalObject, prev: JSValue);
    safe fn Bun__Telemetry__currentContext(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__swapContext(global: &JSGlobalObject, value: JSValue) -> JSValue;
    safe fn Bun__TelemetrySpan__createNative(
        global: &JSGlobalObject,
        stub: &SpanStub,
        scope: u16,
        kind: u8,
        native: u64,
    ) -> JSValue;
    safe fn Bun__TelemetrySpan__fromJS(value: JSValue) -> *mut c_void;
    safe fn Bun__TelemetrySpan__stub(cell: *mut c_void) -> *const SpanStub;
    safe fn Bun__TelemetrySpan__native(cell: *mut c_void) -> u64;
}

/// `rt::Hooks::active_span` — `global` is a `JSGlobalObject*`.
pub(crate) fn active_ptr(global: *mut c_void) -> *const SpanStub {
    // SAFETY: only ever called with a live JSGlobalObject pointer.
    Bun__Telemetry__activeSpanStub(unsafe { &*global.cast::<JSGlobalObject>() })
}

/// The active span's identity. Valid until the caller next runs JS.
#[inline]
pub fn active(global: &JSGlobalObject) -> Option<&SpanStub> {
    let p = Bun__Telemetry__activeSpanStub(global);
    if p.is_null() { None } else { Some(unsafe { &*p }) }
}

#[inline]
pub fn active_context(global: &JSGlobalObject) -> Option<SpanContext> {
    active(global).map(|s| s.ctx).filter(SpanContext::is_valid)
}

/// The active span's JS cell (undefined if none).
#[inline]
pub fn active_js(global: &JSGlobalObject) -> JSValue {
    Bun__Telemetry__activeSpanCell(global)
}

/// The active span's pool handle if it is native-owned.
#[inline]
pub fn active_native(global: &JSGlobalObject) -> NativeSpan {
    let cell = Bun__TelemetrySpan__fromJS(active_js(global));
    if cell.is_null() {
        NativeSpan::NONE
    } else {
        NativeSpan(Bun__TelemetrySpan__native(cell))
    }
}

/// `f(trace_state, baggage)` for the active span (W3C headers to forward).
pub fn with_active_propagation<R>(global: &JSGlobalObject, f: impl FnOnce(&[u8], &[u8]) -> R) -> R {
    let native = active_native(global);
    let owned = if native.is_some() {
        pool::with_ref(native, |s| [s.trace_state.clone(), s.baggage.clone()]).unwrap_or_default()
    } else {
        // JS-owned spans keep inherited tracestate/baggage in their `extra`
        // object; read through C++.
        extra_propagation(global, active_js(global))
    };
    f(&owned[0], &owned[1])
}

fn extra_propagation(global: &JSGlobalObject, cell: JSValue) -> [Vec<u8>; 2] {
    let mut out = [Vec::new(), Vec::new()];
    if Bun__TelemetrySpan__fromJS(cell).is_null() {
        return out;
    }
    unsafe extern "C" {
        safe fn Bun__TelemetrySpan__extraString(global: &JSGlobalObject, cell: JSValue, which: u8) -> JSValue;
    }
    for (i, which) in [b't', b'b'].iter().enumerate() {
        let v = Bun__TelemetrySpan__extraString(global, cell, *which);
        if v.is_string() {
            if let Ok(s) = v.to_slice(global) {
                out[i].extend_from_slice(s.slice());
            }
        }
    }
    out
}

/// Create the JS cell for a native-owned span (request spans etc.).
#[inline]
pub fn create_native_cell(global: &JSGlobalObject, stub: &SpanStub, scope: ScopeId, kind: SpanKind, native: NativeSpan) -> JSValue {
    Bun__TelemetrySpan__createNative(global, stub, scope.0, kind as u8, native.0)
}

/// Is `value` a JSTelemetrySpan?
#[inline]
pub fn is_span(value: JSValue) -> bool {
    !Bun__TelemetrySpan__fromJS(value).is_null()
}

/// Identity of a JSTelemetrySpan value.
#[inline]
pub fn stub_of(value: JSValue) -> Option<SpanStub> {
    let cell = Bun__TelemetrySpan__fromJS(value);
    if cell.is_null() {
        return None;
    }
    Some(unsafe { *Bun__TelemetrySpan__stub(cell) })
}

/// RAII activation of a span cell for the duration of a native → JS call.
/// Must live on the stack (the displaced slot value is kept alive by the
/// conservative scan) and be dropped on the same JS thread.
pub struct Entered {
    global: *const JSGlobalObject,
    prev: JSValue,
}

impl Entered {
    #[inline]
    pub fn new(global: &JSGlobalObject, span_js: JSValue) -> Entered {
        Entered {
            global: global as *const JSGlobalObject,
            prev: Bun__Telemetry__enter(global, span_js),
        }
    }
}

impl Drop for Entered {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: created from a live `&JSGlobalObject` on this thread; the
        // global outlives any request/callback frame.
        Bun__Telemetry__exit(unsafe { &*self.global }, self.prev);
    }
}

/// RAII swap of the whole context slot (re-enter a captured context).
pub struct ContextScope<'a> {
    global: &'a JSGlobalObject,
    prev: JSValue,
}

impl<'a> ContextScope<'a> {
    #[inline]
    pub fn enter(global: &'a JSGlobalObject, context: JSValue) -> ContextScope<'a> {
        ContextScope {
            global,
            prev: Bun__Telemetry__swapContext(global, context),
        }
    }
    #[inline]
    pub fn current(global: &JSGlobalObject) -> JSValue {
        Bun__Telemetry__currentContext(global)
    }
}

impl Drop for ContextScope<'_> {
    #[inline]
    fn drop(&mut self) {
        Bun__Telemetry__swapContext(self.global, self.prev);
    }
}

pub fn limits() -> &'static Limits {
    &super::state().limits
}

/// `{ "k": v, ... }` → each (key, value) as attribute values (config paths).
pub(crate) fn for_each_attribute(
    global: &JSGlobalObject,
    obj: JSValue,
    mut f: impl FnMut(&[u8], &Value<'_>),
) -> JsResult<()> {
    let Some(o) = obj.get_object() else {
        return Ok(());
    };
    let mut iter = JSPropertyIterator::init(
        global,
        o,
        JSPropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
            ..Default::default()
        },
    )?;
    while let Some(name) = iter.next()? {
        let value = iter.value;
        let key = name.to_utf8();
        if value.is_string() {
            let s = value.to_slice(global)?;
            f(key.slice(), &Value::Str(s.slice()));
        } else if value.is_number() {
            let n = value.as_number();
            if n.is_finite() && n == n.trunc() && n.abs() < 9007199254740992.0 {
                f(key.slice(), &Value::Int(n as i64));
            } else {
                f(key.slice(), &Value::Double(n));
            }
        } else if value.is_boolean() {
            f(key.slice(), &Value::Bool(value.as_boolean()));
        }
    }
    Ok(())
}

/// End a native-owned span into this thread's batch.
#[inline]
pub fn end_native(span: NativeSpan, end_ns: u64, extra: impl FnOnce(&mut SpanWriter<'_>)) {
    if pool::end(span, end_ns, extra) {
        super::after_record();
    }
}

// ───────────────────── ABI for JSTelemetrySpan.cpp ─────────────────────

/// A JS string as JSC holds it: Latin-1 or UTF-16 code units.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct StrRef {
    ptr: *const u8,
    len: u32,
    is16: u8,
}

impl StrRef {
    /// Append as UTF-8.
    fn append_to(&self, out: &mut Vec<u8>) {
        if self.ptr.is_null() || self.len == 0 {
            return;
        }
        if self.is16 != 0 {
            let s = unsafe { core::slice::from_raw_parts(self.ptr.cast::<u16>(), self.len as usize) };
            bun_core::strings::convert_utf16_to_utf8_append(out, s);
        } else {
            let s = unsafe { core::slice::from_raw_parts(self.ptr, self.len as usize) };
            if bun_core::strings::is_all_ascii(s) {
                out.extend_from_slice(s);
            } else {
                let at = out.len();
                let taken = core::mem::take(out);
                *out = bun_core::strings::allocate_latin1_into_utf8_with_list(taken, at, s);
            }
        }
    }

    fn range(&self, scratch: &mut Vec<u8>) -> (usize, usize) {
        let start = scratch.len();
        self.append_to(scratch);
        (start, scratch.len() - start)
    }

    fn to_vec(&self) -> Vec<u8> {
        let mut v = Vec::new();
        self.append_to(&mut v);
        v
    }
}

/// Attribute value kinds (matches JSTelemetrySpan.cpp).
const ATTR_STR: u8 = 0;
const ATTR_BOOL: u8 = 1;
const ATTR_INT: u8 = 2;
const ATTR_DOUBLE: u8 = 3;
const ATTR_ARRAY: u8 = 4;

#[repr(C)]
#[derive(Clone, Copy)]
struct ArrayRef {
    items: *const AttrRef,
    n: u32,
}

#[repr(C)]
union AttrValue {
    str_: core::mem::ManuallyDrop<StrRef>,
    num: f64,
    int: i64,
    /// kind == ATTR_ARRAY: `items[..n]` (their keys are unused).
    array: ArrayRef,
}

#[repr(C)]
pub struct AttrRef {
    key_ptr: *const u8,
    key_len: u32,
    key_is16: u8,
    kind: u8,
    u: AttrValue,
}

const _: () = assert!(core::mem::size_of::<AttrRef>() == 32);

impl AttrRef {
    #[inline]
    fn key(&self) -> StrRef {
        StrRef { ptr: self.key_ptr, len: self.key_len, is16: self.key_is16 }
    }
}

#[repr(C)]
pub struct EventRef {
    name: StrRef,
    time_ns: u64,
    attrs: *const AttrRef,
    n_attrs: u32,
}

#[repr(C)]
pub struct LinkRef {
    trace_id: StrRef,
    span_id: StrRef,
    flags: u8,
    attrs: *const AttrRef,
    n_attrs: u32,
}

#[repr(C)]
pub struct EndDesc {
    stub: *const SpanStub,
    scope: u16,
    kind: u8,
    status: u8,
    end_ns: u64,
    name: StrRef,
    status_message: StrRef,
    trace_state: StrRef,
    attrs: *const AttrRef,
    n_attrs: u32,
    dropped_attrs: u32,
    events: *const EventRef,
    n_events: u32,
    links: *const LinkRef,
    n_links: u32,
}

impl StrRef {
    /// Borrow as UTF-8 if the JS string is Latin-1 and pure ASCII (the common
    /// case); otherwise transcode into `scratch` and borrow that.
    #[inline]
    fn utf8<'a>(&'a self, scratch: &'a mut Vec<u8>) -> &'a [u8] {
        if self.ptr.is_null() || self.len == 0 {
            return &[];
        }
        if self.is16 == 0 {
            let s = unsafe { core::slice::from_raw_parts(self.ptr, self.len as usize) };
            if bun_core::strings::is_all_ascii(s) {
                return s;
            }
        }
        scratch.clear();
        self.append_to(scratch);
        &scratch[..]
    }
}

thread_local! {
    /// Reused transcoding buffers: [key, value, name/misc].
    static SCRATCH: core::cell::RefCell<[Vec<u8>; 3]> = const { core::cell::RefCell::new([Vec::new(), Vec::new(), Vec::new()]) };
}

/// Decode `attrs[..n]` and hand each `(key, value)` to `emit`. No allocation
/// unless a string needs transcoding or a value is an array.
fn with_attrs(attrs: *const AttrRef, n: u32, scratch: &mut [Vec<u8>; 3], mut emit: impl FnMut(&[u8], &Value<'_>)) {
    if n == 0 || attrs.is_null() {
        return;
    }
    let attrs = unsafe { core::slice::from_raw_parts(attrs, n as usize) };
    let [ks, vs, _] = scratch;
    for a in attrs {
        let key_ref = a.key();
        let key = key_ref.utf8(ks);
        if key.is_empty() {
            continue;
        }
        // SAFETY: `kind` selects the live union member (written by JSTelemetrySpan.cpp).
        match a.kind {
            ATTR_STR => emit(key, &Value::Str(unsafe { &a.u.str_ }.utf8(vs))),
            ATTR_BOOL => emit(key, &Value::Bool(unsafe { a.u.int } != 0)),
            ATTR_INT => emit(key, &Value::Int(unsafe { a.u.int })),
            ATTR_DOUBLE => emit(key, &Value::Double(unsafe { a.u.num })),
            ATTR_ARRAY => {
                let arr = unsafe { a.u.array };
                let items = unsafe { core::slice::from_raw_parts(arr.items, arr.n as usize) };
                // Own every string first, then borrow.
                let mut bytes: Vec<u8> = Vec::new();
                let mut ranges: Vec<(u8, usize, usize, i64, f64)> = Vec::with_capacity(items.len());
                for it in items {
                    match it.kind {
                        ATTR_STR => {
                            let (s, n) = unsafe { &it.u.str_ }.range(&mut bytes);
                            ranges.push((ATTR_STR, s, n, 0, 0.0));
                        }
                        k => ranges.push((k, 0, 0, unsafe { it.u.int }, unsafe { it.u.num })),
                    }
                }
                let vals: Vec<Value<'_>> = ranges
                    .iter()
                    .map(|&(k, s, n, i, d)| match k {
                        ATTR_STR => Value::Str(&bytes[s..s + n]),
                        ATTR_BOOL => Value::Bool(i != 0),
                        ATTR_INT => Value::Int(i),
                        _ => Value::Double(d),
                    })
                    .collect();
                emit(key, &Value::Array(&vals));
            }
            _ => {}
        }
    }
}

/// Ids, sampling decision and start time for a new span.
/// `parent` may be null (root) and may carry `Flags::REMOTE`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__stubStart(out: &mut SpanStub, parent: *const SpanStub, start_ns: u64) {
    let parent = if parent.is_null() { None } else { Some(unsafe { &(*parent).ctx }) };
    let now = if start_ns == 0 { clock::now_unix_nanos() } else { start_ns };
    *out = SpanStub::start(parent.filter(|c| c.is_valid()), &super::state().sampler, now);
}

/// A non-recording carrier for a (possibly remote) span context.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__stubWrap(
    out: &mut SpanStub,
    trace_id: &[u8; 16],
    span_id: &[u8; 8],
    w3c_flags: u8,
    remote: bool,
) {
    *out = SpanStub {
        ctx: SpanContext {
            trace_id: TraceId(*trace_id),
            span_id: SpanId(*span_id),
            flags: Flags((w3c_flags & Flags::SAMPLED) | Flags::NON_RECORDING | if remote { Flags::REMOTE } else { 0 }),
        },
        parent: SpanId::INVALID,
        start_ns: 1,
    };
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nowNs() -> u64 {
    clock::now_unix_nanos()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__userScope() -> u16 {
    ScopeId::from(bun_telemetry::Instrument::User).0
}

fn kind_from_u8(k: u8) -> SpanKind {
    match k {
        1 => SpanKind::Server,
        2 => SpanKind::Client,
        3 => SpanKind::Producer,
        4 => SpanKind::Consumer,
        _ => SpanKind::Internal,
    }
}

fn status_from_u8(s: u8) -> StatusCode {
    match s {
        1 => StatusCode::Ok,
        2 => StatusCode::Error,
        _ => StatusCode::Unset,
    }
}

/// Encode a JS-owned span that just ended into this thread's batch.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__encodeSpan(desc: &EndDesc) {
    let stub = unsafe { &*desc.stub };
    if !stub.is_recording() {
        return;
    }
    let scope = ScopeId(desc.scope);
    let l = limits();
    let n_attrs = desc.n_attrs.min(l.attributes as u32);
    let n_events = desc.n_events.min(l.events as u32);
    let n_links = desc.n_links.min(l.links as u32);
    SCRATCH.with(|sc| {
        let mut sc = sc.borrow_mut();
        let sc = &mut *sc;
        let mut name_buf = core::mem::take(&mut sc[2]);
        let name = desc.name.utf8(&mut name_buf);
        batch::record(scope, |buf| {
            let mut w = SpanWriter::begin(buf, stub, name, kind_from_u8(desc.kind), desc.end_ns);
            if desc.trace_state.len != 0 {
                w.trace_state(&desc.trace_state.to_vec());
            }
            with_attrs(desc.attrs, n_attrs, sc, |k, v| match *v {
                Value::Str(s) if s.len() > l.attribute_value_length as usize => {
                    w.attr_bytes_key(k, Value::Str(&s[..l.attribute_value_length as usize]));
                }
                _ => {
                    w.attr_bytes_key(k, *v);
                }
            });
            if n_events != 0 {
                let events = unsafe { core::slice::from_raw_parts(desc.events, n_events as usize) };
                for e in events {
                    let ename = e.name.to_vec();
                    let mut pairs: Vec<(Vec<u8>, OwnedFlat)> = Vec::new();
                    with_attrs(e.attrs, e.n_attrs, sc, |k, v| pairs.push((k.to_vec(), OwnedFlat::from(v))));
                    let borrowed: Vec<(&[u8], Value<'_>)> = pairs.iter().map(|(k, v)| (&k[..], v.value())).collect();
                    w.event(&ename, e.time_ns, &borrowed);
                }
            }
            if n_links != 0 {
                let links = unsafe { core::slice::from_raw_parts(desc.links, n_links as usize) };
                for lk in links {
                    let (Some(t), Some(sid)) = (TraceId::from_hex(&lk.trace_id.to_vec()), SpanId::from_hex(&lk.span_id.to_vec())) else {
                        continue;
                    };
                    let ctx = SpanContext { trace_id: t, span_id: sid, flags: Flags(lk.flags & Flags::SAMPLED) };
                    let mut pairs: Vec<(Vec<u8>, OwnedFlat)> = Vec::new();
                    with_attrs(lk.attrs, lk.n_attrs, sc, |k, v| pairs.push((k.to_vec(), OwnedFlat::from(v))));
                    let borrowed: Vec<(&[u8], Value<'_>)> = pairs.iter().map(|(k, v)| (&k[..], v.value())).collect();
                    w.link(&ctx, &borrowed);
                }
            }
            let dropped_attrs = desc.dropped_attrs + (desc.n_attrs - n_attrs);
            if dropped_attrs != 0 {
                w.dropped_attributes(dropped_attrs);
            }
            if desc.n_events != n_events {
                w.dropped_events(desc.n_events - n_events);
            }
            if desc.n_links != n_links {
                w.dropped_links(desc.n_links - n_links);
            }
            if desc.status != 0 {
                w.status(status_from_u8(desc.status), &desc.status_message.to_vec());
            }
            w.finish();
        });
        sc[2] = name_buf;
    });
    super::after_record();
}

/// Flat owned attribute value for the (rare) event/link paths.
enum OwnedFlat {
    Str(Vec<u8>),
    Bool(bool),
    Int(i64),
    Double(f64),
}
impl OwnedFlat {
    fn from(v: &Value<'_>) -> OwnedFlat {
        match *v {
            Value::Str(s) => OwnedFlat::Str(s.to_vec()),
            Value::Bytes(s) => OwnedFlat::Str(s.to_vec()),
            Value::Bool(b) => OwnedFlat::Bool(b),
            Value::Int(i) => OwnedFlat::Int(i),
            Value::Double(d) => OwnedFlat::Double(d),
            Value::Array(_) => OwnedFlat::Str(Vec::new()),
        }
    }
    fn value(&self) -> Value<'_> {
        match self {
            OwnedFlat::Str(s) => Value::Str(s),
            OwnedFlat::Bool(b) => Value::Bool(*b),
            OwnedFlat::Int(i) => Value::Int(*i),
            OwnedFlat::Double(d) => Value::Double(*d),
        }
    }
}

// ─────────────── native-owned span mutations from JS ───────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeIsLive(handle: u64) -> bool {
    pool::with_ref(NativeSpan(handle), |_| ()).is_some()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeEnd(handle: u64, end_ns: u64) -> bool {
    let ended = pool::end(NativeSpan(handle), end_ns, |_| {});
    if ended {
        super::after_record();
    }
    ended
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeSetAttribute(handle: u64, attr: &AttrRef) {
    let l = limits();
    SCRATCH.with(|sc| {
        with_attrs(attr, 1, &mut sc.borrow_mut(), |k, v| {
            pool::with(NativeSpan(handle), |s| s.set_attribute(k, v, l));
        });
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeSetName(handle: u64, name: &StrRef) {
    let n = name.to_vec();
    pool::with(NativeSpan(handle), |s| s.set_name(&n));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeSetStatus(handle: u64, code: u8, message: &StrRef) {
    let m = message.to_vec();
    pool::with(NativeSpan(handle), |s| s.set_status(status_from_u8(code), &m));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeAddEvent(handle: u64, event: &EventRef) {
    let name = event.name.to_vec();
    let mut pairs: Vec<(Vec<u8>, OwnedFlat)> = Vec::new();
    SCRATCH.with(|sc| with_attrs(event.attrs, event.n_attrs, &mut sc.borrow_mut(), |k, v| pairs.push((k.to_vec(), OwnedFlat::from(v)))));
    let borrowed: Vec<(&[u8], Value<'_>)> = pairs.iter().map(|(k, v)| (&k[..], v.value())).collect();
    pool::with(NativeSpan(handle), |s| s.add_event(&name, event.time_ns, &borrowed));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeAddLink(handle: u64, link: &LinkRef) {
    let (Some(t), Some(sid)) = (TraceId::from_hex(&link.trace_id.to_vec()), SpanId::from_hex(&link.span_id.to_vec())) else {
        return;
    };
    let ctx = SpanContext { trace_id: t, span_id: sid, flags: Flags(link.flags & Flags::SAMPLED) };
    let mut pairs: Vec<(Vec<u8>, OwnedFlat)> = Vec::new();
    SCRATCH.with(|sc| with_attrs(link.attrs, link.n_attrs, &mut sc.borrow_mut(), |k, v| pairs.push((k.to_vec(), OwnedFlat::from(v)))));
    let borrowed: Vec<(&[u8], Value<'_>)> = pairs.iter().map(|(k, v)| (&k[..], v.value())).collect();
    pool::with(NativeSpan(handle), |s| bun_telemetry::otlp::encode_link(&mut s.extra, &ctx, b"", &borrowed));
}

/// The slot's current name as UTF-8 (for the `.name` getter). Writes up to
/// `cap` bytes and returns the full length.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeName(handle: u64, out: *mut u8, cap: usize) -> usize {
    pool::with_ref(NativeSpan(handle), |s| {
        let n = s.name.len().min(cap);
        unsafe { core::ptr::copy_nonoverlapping(s.name.as_ptr(), out, n) };
        s.name.len()
    })
    .unwrap_or(0)
}

/// `startLeafSpan(instrument, name, kind)` support: start a native-owned span
/// for a JS-implemented built-in instrumentation (node:http client). Returns
/// the JS cell or undefined when the instrumentation should not record.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__startInstrumentSpan(
    global: &JSGlobalObject,
    instrument: u32,
    name: &StrRef,
    kind: u8,
) -> JSValue {
    let Some(i) = bun_telemetry::Instrument::ALL.get(instrument as usize).copied() else {
        return JSValue::UNDEFINED;
    };
    let stub = super::start_leaf(global, i);
    if !stub.is_some() {
        return JSValue::UNDEFINED;
    }
    let n = name.to_vec();
    let kind = kind_from_u8(kind);
    let native = pool::begin(stub, ScopeId::from(i), &n, kind);
    with_active_propagation(global, |ts, bg| {
        if !ts.is_empty() || !bg.is_empty() {
            pool::with(native, |s| {
                s.trace_state.extend_from_slice(ts);
                s.baggage.extend_from_slice(bg);
            });
        }
    });
    create_native_cell(global, &stub, ScopeId::from(i), kind, native)
}

/// tracestate (`which == b't'`) or baggage (`b'b'`) of a native-owned span.
/// Writes up to `cap` bytes; returns the full length.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativePropagation(handle: u64, which: u8, out: *mut u8, cap: usize) -> usize {
    pool::with_ref(NativeSpan(handle), |s| {
        let src = if which == b't' { &s.trace_state } else { &s.baggage };
        let n = src.len().min(cap);
        unsafe { core::ptr::copy_nonoverlapping(src.as_ptr(), out, n) };
        src.len()
    })
    .unwrap_or(0)
}
