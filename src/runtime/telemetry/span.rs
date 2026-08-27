//! Glue between `JSTelemetrySpan` (C++, the JS-visible span and async-context
//! value) and `bun_telemetry`: id/sampler/clock at start, protobuf encoding at
//! end, and the native span pool for spans owned by integrations.

use core::ffi::c_void;

use bun_jsc::{JSGlobalObject, JSValue};
use bun_telemetry::otlp::EntryWriter;
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{
    Flags, Limits, Local, ScopeId, SpanContext, SpanId, SpanKind, SpanStub, SpanWriter, StatusCode,
    TraceId, Value, batch, clock,
};

use super::local;

unsafe extern "C" {
    safe fn Bun__Telemetry__activeSpanStub(global: &JSGlobalObject) -> *const SpanStub;
    safe fn Bun__Telemetry__activeExtrasBaggage(global: &JSGlobalObject) -> OwnedJsString;
    safe fn Bun__Telemetry__activeSpanCell(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__enter(global: &JSGlobalObject, span: JSValue) -> JSValue;
    safe fn Bun__Telemetry__exit(global: &JSGlobalObject, prev: JSValue);
    safe fn Bun__TelemetrySpan__createNative(
        global: &JSGlobalObject,
        stub: &SpanStub,
        scope: u16,
        kind: u8,
        native: u64,
    ) -> JSValue;
    safe fn Bun__TelemetrySpan__fromJS(value: JSValue) -> *mut c_void;
    safe fn Bun__Telemetry__activeNativeHandle(global: &JSGlobalObject) -> u64;
    safe fn Bun__TelemetrySpan__nativeEnded(cell: JSValue);
    /// Borrowed (not ref'd) header strings of a JS-owned span; Empty otherwise.
    /// Valid until the caller next runs JS.
    safe fn Bun__TelemetrySpan__traceState(cell: JSValue) -> bun_core::StringView<'static>;
    safe fn Bun__TelemetrySpan__baggage(cell: JSValue) -> bun_core::StringView<'static>;
}

/// `rt::Hooks::active_span` — `global` is a `JSGlobalObject*`.
pub(crate) fn active_ptr(global: *mut c_void) -> *const SpanStub {
    Bun__Telemetry__activeSpanStub(JSGlobalObject::opaque_ref(global.cast::<JSGlobalObject>()))
}

/// The active span's identity. Valid until the caller next runs JS.
#[inline]
pub fn active(global: &JSGlobalObject) -> Option<&SpanStub> {
    let p = Bun__Telemetry__activeSpanStub(global);
    if p.is_null() {
        None
    } else {
        // SAFETY: points into the active JSTelemetrySpan cell; valid until JS next runs (see doc).
        Some(unsafe { &*p })
    }
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

/// The active span's pool handle if it is native-owned (slot holds either
/// the bare handle as a number or a materialized cell).
#[inline]
pub fn active_native(global: &JSGlobalObject) -> NativeSpan {
    NativeSpan(Bun__Telemetry__activeNativeHandle(global))
}

/// The async-context slot value for a native-owned span: the pool handle as
/// a JS number. No cell is allocated unless JS asks for the active span.
#[inline]
pub fn native_context_value(native: NativeSpan) -> JSValue {
    JSValue::js_number(native.0 as f64)
}

/// Release the JS cell a pooled span materialized (see `pool::Ended`).
pub(crate) fn release_cell(js_cell: bun_telemetry::JsCellRef) {
    if !js_cell.is_some() {
        return;
    }
    let v = JSValue::from_encoded(js_cell.0);
    Bun__TelemetrySpan__nativeEnded(v);
    v.unprotect();
}

/// `f(trace_state, baggage)` for the active span (W3C headers to forward).
/// Baggage the active api Context set (or deleted) wins over what the span
/// inherited from the incoming request — the same rule as propagator.inject
/// and node:http.
pub fn with_active_propagation<R>(global: &JSGlobalObject, f: impl FnOnce(&[u8], &[u8]) -> R) -> R {
    // Empty: the Context says nothing (use inherited); Dead: it says "none".
    let from_context = Bun__Telemetry__activeExtrasBaggage(global);
    let masked = from_context.tag() == bun_core::Tag::Dead;
    let from_context = if masked {
        bun_core::Utf8Bytes::EMPTY
    } else {
        from_context.to_utf8()
    };
    fn pick<'a>(masked: bool, from_context: &'a [u8], inherited: &'a [u8]) -> &'a [u8] {
        if masked || !from_context.is_empty() {
            from_context
        } else {
            inherited
        }
    }
    let from_context = from_context.slice();
    let native = active_native(global);
    if native.is_some() {
        let owned = local(global)
            .and_then(|l| {
                pool::with_ref(&l.pool, native, |s| {
                    [s.trace_state.clone(), s.baggage.clone()]
                })
            })
            .unwrap_or_default();
        return f(&owned[0], pick(masked, from_context, &owned[1]));
    }
    // JS-owned spans keep the inherited headers in their TraceState/Baggage fields.
    let cell = active_js(global);
    let (ts, bg) = (
        Bun__TelemetrySpan__traceState(cell),
        Bun__TelemetrySpan__baggage(cell),
    );
    let (ts, bg) = (ts.to_utf8(), bg.to_utf8());
    f(ts.slice(), pick(masked, from_context, bg.slice()))
}

/// Is `value` a JSTelemetrySpan?
#[inline]
pub fn is_span(value: JSValue) -> bool {
    !Bun__TelemetrySpan__fromJS(value).is_null()
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
            global: core::ptr::from_ref(global),
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

pub fn limits() -> &'static Limits {
    &super::state().limits
}

/// End a native-owned span into the VM's batch.
#[inline]
pub fn end_native(
    global: &JSGlobalObject,
    span: NativeSpan,
    end_ns: u64,
    mut extra: impl FnMut(&mut SpanWriter<'_>),
) {
    let Some(mut l) = local(global) else { return };
    let ended = pool::end(&mut l, span, end_ns, &mut extra);
    drop(l);
    finish_ended(global, ended);
}

#[inline]
pub(super) fn finish_ended(global: &JSGlobalObject, ended: Option<pool::Ended>) {
    if let Some(e) = ended {
        release_cell(e.js_cell);
        if e.recorded {
            super::after_record(global);
        }
    }
}

/// Drop a native-owned span without recording it.
pub fn discard_native(global: &JSGlobalObject, span: NativeSpan) {
    if !span.is_some() {
        return;
    }
    let Some(mut l) = local(global) else { return };
    let cell = pool::discard(&mut l.pool, span);
    drop(l);
    release_cell(cell);
}

// ───────────────────── ABI for JSTelemetrySpan.cpp ─────────────────────
//
// Mirrors src/jsc/bindings/TelemetryABI.h. Strings arrive as borrowed
// (not ref'd) WTFStringImpl-backed `BunString`s that C++ keeps alive for the
// duration of the call; nothing here retains them.

/// A BunString C++ owns (a JSString's value or a stack temporary) that Rust
/// only reads during the call: same 24 bytes as `bun_core::String`, no ref.
type JsString = bun_core::StringView<'static>;
use bun_core::String as OwnedJsString;
use bun_core::strings;

/// bun_telemetry::Instrument::Sqlite's enable bit, for JSSQLStatement.cpp.
#[unsafe(no_mangle)]
pub static Bun__Telemetry__SQLITE_MASK: u32 = bun_telemetry::Instrument::Sqlite.bit();

/// `AttrRef::kind` (TelemetryAttrKind); values are only ever produced by C++.
mod attr_kind {
    pub(super) const STRING: u8 = 0;
    pub(super) const BOOL: u8 = 1;
    pub(super) const INT: u8 = 2;
    pub(super) const DOUBLE: u8 = 3;
    pub(super) const ARRAY: u8 = 4;
}

/// `items[start .. start + length]` of an [`AttrPool`] (`array_items` when
/// it is an attribute value, `items` everywhere else).
#[repr(C)]
#[derive(Clone, Copy)]
struct AttrSlice {
    start: u32,
    length: u32,
}

#[repr(C)]
union AttrValue {
    string: core::mem::ManuallyDrop<JsString>,
    /// Also Bool (0/1).
    integer: i64,
    number: f64,
    array: AttrSlice,
}

#[repr(C)]
pub struct AttrRef {
    key: JsString,
    kind: u8,
    value: AttrValue,
}

#[repr(C)]
pub struct AttrPool {
    items: *const AttrRef,
    array_items: *const AttrRef,
    n_items: u32,
    n_array_items: u32,
}

#[repr(C)]
pub struct EventRef {
    name: JsString,
    /// 0 = not given (now).
    time_ns: u64,
    attrs: AttrSlice,
}

#[repr(C)]
pub struct LinkRef {
    trace_id: JsString,
    span_id: JsString,
    /// W3C header form; may be empty.
    trace_state: JsString,
    attrs: AttrSlice,
    trace_flags: u8,
}

/// Everything a JS-owned span gathered, handed over once at end().
#[repr(C)]
pub struct EndDesc {
    stub: *const SpanStub,
    /// 0 = now.
    end_ns: u64,
    name: JsString,
    status_message: JsString,
    trace_state: JsString,
    pool: AttrPool,
    attrs: AttrSlice,
    events: *const EventRef,
    links: *const LinkRef,
    n_events: u32,
    n_links: u32,
    /// Attributes C++ did not pass (beyond its gather cap).
    dropped_attrs: u32,
    scope: u16,
    /// @opentelemetry/api SpanKind.
    kind: u8,
    /// @opentelemetry/api SpanStatusCode.
    status: u8,
}

/// Size and field offsets the C++ mirror static_asserts too.
macro_rules! abi_layout {
    ($T:ty, $size:expr; $($field:ident @ $off:expr),+ $(,)?) => {
        const _: () = {
            assert!(core::mem::size_of::<$T>() == $size);
            $(assert!(core::mem::offset_of!($T, $field) == $off);)+
        };
    };
}

abi_layout!(SpanStub, 48; ctx @ 0, parent @ 25, start_ns @ 40);
const _: () = assert!(core::mem::size_of::<JsString>() == 24);
abi_layout!(AttrSlice, 8; start @ 0, length @ 4);
abi_layout!(AttrRef, 56; key @ 0, kind @ 24, value @ 32);
abi_layout!(AttrPool, 24; items @ 0, array_items @ 8, n_items @ 16, n_array_items @ 20);
abi_layout!(EventRef, 40; name @ 0, time_ns @ 24, attrs @ 32);
abi_layout!(LinkRef, 88; trace_id @ 0, span_id @ 24, trace_state @ 48, attrs @ 72, trace_flags @ 80);
abi_layout!(
    EndDesc, 152;
    stub @ 0, end_ns @ 8, name @ 16, status_message @ 40, trace_state @ 64, pool @ 88, attrs @ 112,
    events @ 120, links @ 128, n_events @ 136, n_links @ 140, dropped_attrs @ 144, scope @ 148,
    kind @ 150, status @ 151
);

/// UTF-8 view of a borrowed JS string: zero-copy when it is already ASCII
/// (nearly always), otherwise transcoded into the reused `scratch`.
#[inline(always)]
fn utf8<'a>(s: &'a JsString, scratch: &'a mut Vec<u8>) -> &'a [u8] {
    if let Some(b) = s.as_utf8() {
        return b;
    }
    scratch.clear();
    let r = append_utf8(s, scratch);
    &scratch[r]
}

/// `s` as UTF-8 appended to `out`; returns the range written.
fn append_utf8(s: &JsString, out: &mut Vec<u8>) -> core::ops::Range<usize> {
    let start = out.len();
    if s.is_utf16() {
        strings::convert_utf16_to_utf8_append(out, s.utf16());
    } else {
        *out =
            strings::allocate_latin1_into_utf8_with_list(core::mem::take(out), start, s.latin1());
    }
    start..out.len()
}

impl AttrPool {
    fn items(&self) -> &[AttrRef] {
        if self.n_items == 0 {
            return &[];
        }
        // SAFETY: C++ passes `n_items` live entries (TelemetryAttrGatherer).
        unsafe { core::slice::from_raw_parts(self.items, self.n_items as usize) }
    }
    fn array_items(&self) -> &[AttrRef] {
        if self.n_array_items == 0 {
            return &[];
        }
        // SAFETY: as above.
        unsafe { core::slice::from_raw_parts(self.array_items, self.n_array_items as usize) }
    }
    fn slice(&self, s: AttrSlice) -> &[AttrRef] {
        let items = self.items();
        let start = (s.start as usize).min(items.len());
        let end = (start + s.length as usize).min(items.len());
        &items[start..end]
    }
    fn array(&self, s: AttrSlice) -> &[AttrRef] {
        let items = self.array_items();
        let start = (s.start as usize).min(items.len());
        let end = (start + s.length as usize).min(items.len());
        &items[start..end]
    }
}

/// A scalar attribute value with any string bytes owned elsewhere (`bytes`).
#[derive(Clone, Copy)]
enum Scalar {
    Str(usize, usize),
    Bool(bool),
    Int(i64),
    Double(f64),
}

impl Scalar {
    /// `None` for arrays (and unknown kinds).
    fn read(a: &AttrRef, bytes: &mut Vec<u8>) -> Option<Scalar> {
        Some(match a.kind {
            attr_kind::STRING => {
                // SAFETY: `kind` selects the live union member (TelemetryAttrGatherer::fill).
                let r = append_utf8(unsafe { &a.value.string }, bytes);
                Scalar::Str(r.start, r.end)
            }
            // SAFETY: as above.
            attr_kind::BOOL => Scalar::Bool(unsafe { a.value.integer } != 0),
            // SAFETY: as above.
            attr_kind::INT => Scalar::Int(unsafe { a.value.integer }),
            // SAFETY: as above.
            attr_kind::DOUBLE => Scalar::Double(unsafe { a.value.number }),
            _ => return None,
        })
    }
    fn value<'a>(&self, bytes: &'a [u8], value_limit: usize) -> Value<'a> {
        match *self {
            Scalar::Str(s, e) => Value::Str(bun_telemetry::otlp::truncate_utf8(
                &bytes[s..e],
                value_limit,
            )),
            Scalar::Bool(b) => Value::Bool(b),
            Scalar::Int(i) => Value::Int(i),
            Scalar::Double(d) => Value::Double(d),
        }
    }
}

/// Decode `refs` and hand each `(key, value)` to `emit`, in order. Top-level
/// strings borrow the JS characters directly when they are ASCII; `scratch`
/// ([key, value, array bytes]) absorbs the rest so nothing allocates per call
/// once warm.
#[inline]
fn each_attr(
    refs: &[AttrRef],
    pool: &AttrPool,
    value_limit: usize,
    scratch: &mut [Vec<u8>; 3],
    mut emit: impl FnMut(&[u8], &Value<'_>),
) {
    let [key_buf, val_buf, arr_buf] = scratch;
    for a in refs {
        let key = utf8(&a.key, key_buf);
        if key.is_empty() {
            continue;
        }
        match a.kind {
            attr_kind::STRING => {
                // SAFETY: `kind` selects the live union member (TelemetryAttrGatherer::fill).
                let s = utf8(unsafe { &a.value.string }, val_buf);
                emit(
                    key,
                    &Value::Str(bun_telemetry::otlp::truncate_utf8(s, value_limit)),
                );
            }
            // SAFETY: as above.
            attr_kind::BOOL => emit(key, &Value::Bool(unsafe { a.value.integer } != 0)),
            // SAFETY: as above.
            attr_kind::INT => emit(key, &Value::Int(unsafe { a.value.integer })),
            // SAFETY: as above.
            attr_kind::DOUBLE => emit(key, &Value::Double(unsafe { a.value.number })),
            attr_kind::ARRAY => {
                arr_buf.clear();
                // SAFETY: as above.
                let items = pool.array(unsafe { a.value.array });
                let scalars: Vec<Scalar> = items
                    .iter()
                    .filter_map(|it| Scalar::read(it, arr_buf))
                    .collect();
                let values: Vec<Value<'_>> = scalars
                    .iter()
                    .map(|s| s.value(arr_buf, value_limit))
                    .collect();
                emit(key, &Value::Array(&values));
            }
            _ => {}
        }
    }
}

/// [`each_attr`] into an open event/link entry, then close the entry.
fn entry_attrs(
    mut w: EntryWriter<'_>,
    refs: &[AttrRef],
    pool: &AttrPool,
    value_limit: usize,
    scratch: &mut [Vec<u8>; 3],
) {
    each_attr(refs, pool, value_limit, scratch, |k, v| w.attr(k, v));
}

fn status_code(api: u8) -> StatusCode {
    match api {
        1 => StatusCode::Ok,
        2 => StatusCode::Error,
        _ => StatusCode::Unset,
    }
}

fn link_context(link: &LinkRef) -> Option<SpanContext> {
    let trace_id = TraceId::from_hex(link.trace_id.to_utf8().slice())?;
    let span_id = SpanId::from_hex(link.span_id.to_utf8().slice())?;
    Some(SpanContext {
        trace_id,
        span_id,
        flags: Flags(link.trace_flags & (Flags::SAMPLED | Flags::REMOTE)),
    })
}

/// Ids, sampling decision and start time for a new span.
/// `parent` may be null (root) and may carry `Flags::REMOTE`.
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn Bun__Telemetry__stubStart(
    global: &JSGlobalObject,
    out: &mut SpanStub,
    parent: *const SpanStub,
    start_ns: u64,
) {
    let parent = if parent.is_null() {
        None
    } else {
        // SAFETY: C++ passes null or a live stub.
        Some(unsafe { (*parent).ctx })
    };
    if parent.is_some_and(|c| c.flags.suppressed()) {
        // Under suppressTracing(): a no-op span that keeps suppressing.
        *out = carrier(SpanStub::NONE.ctx, false);
        out.ctx.flags = Flags(out.ctx.flags.0 | Flags::SUPPRESSED);
        return;
    }
    let now = clock::or_now(start_ns);
    let Some(mut l) = local(global) else {
        *out = SpanStub::NONE;
        return;
    };
    *out = SpanStub::start(
        &mut l.rng,
        parent.as_ref().filter(|c| c.is_valid()),
        &super::state().sampler,
        now,
    );
    if !super::configured()
        || bun_telemetry::is_shut_down()
        || !bun_telemetry::enabled(bun_telemetry::Instrument::User)
    {
        // No pipeline (no BUN_OTEL / bunfig / start()): the span still carries
        // ids for propagation but records nothing and is never buffered.
        out.ctx.flags = Flags(out.ctx.flags.0 | Flags::NON_RECORDING);
    }
}

/// `f(trace_state)` of the active span (no baggage work; for leaf spans that
/// only inherit tracestate: sql, redis, sqlite, spawn).
pub fn with_active_trace_state<R>(global: &JSGlobalObject, f: impl FnOnce(&[u8]) -> R) -> R {
    let native = active_native(global);
    if native.is_some() {
        let owned = local(global)
            .and_then(|l| pool::with_ref(&l.pool, native, |s| s.trace_state.clone()))
            .unwrap_or_default();
        return f(&owned);
    }
    let ts = Bun__TelemetrySpan__traceState(active_js(global));
    let ts = ts.to_utf8();
    f(ts.slice())
}

/// A non-recording carrier cell with the SUPPRESSED bit (see VmState::enter_suppressed).
pub(crate) fn suppressed_carrier_cell(global: &JSGlobalObject) -> JSValue {
    let mut stub = carrier(SpanStub::NONE.ctx, false);
    stub.ctx.flags = Flags(stub.ctx.flags.0 | Flags::SUPPRESSED);
    Bun__TelemetrySpan__createNative(global, &stub, 0, 0, 0)
}

fn carrier(ctx: SpanContext, remote: bool) -> SpanStub {
    SpanStub {
        ctx: SpanContext {
            flags: Flags(
                (ctx.flags.0 & Flags::SAMPLED)
                    | Flags::NON_RECORDING
                    | if remote { Flags::REMOTE } else { 0 },
            ),
            ..ctx
        },
        parent: SpanId::INVALID,
        start_ns: 1,
    }
}

/// A non-recording carrier for a (possibly remote) span context given as hex ids.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__stubFromHexIds(
    out: &mut SpanStub,
    trace_id: &JsString,
    span_id: &JsString,
    trace_flags: u8,
    remote: bool,
) -> bool {
    let Some(trace_id) = TraceId::from_hex(trace_id.to_utf8().slice()) else {
        return false;
    };
    let Some(span_id) = SpanId::from_hex(span_id.to_utf8().slice()) else {
        return false;
    };
    let flags = Flags(trace_flags);
    *out = carrier(
        SpanContext {
            trace_id,
            span_id,
            flags,
        },
        remote,
    );
    true
}

/// W3C `traceparent` for `stub` into `out[..55]`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__formatTraceparent(
    stub: &SpanStub,
    out: &mut [u8; bun_telemetry::propagation::TRACEPARENT_LEN],
) {
    bun_telemetry::propagation::format_traceparent(&stub.ctx, out);
}

/// Parse a W3C `traceparent` into a remote, non-recording carrier.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__parseTraceparent(header: &JsString, out: &mut SpanStub) -> bool {
    match bun_telemetry::propagation::parse_traceparent(header.to_utf8().slice()) {
        Some(ctx) => {
            *out = carrier(ctx, true);
            true
        }
        None => false,
    }
}

/// Lowercase hex of `bytes[..n]` into `out[..2n]` (span/trace id getters).
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn Bun__Telemetry__hexLower(bytes: *const u8, n: usize, out: *mut u8) {
    // SAFETY: C++ passes `n` readable bytes and `2n` writable bytes.
    let (bytes, out) = unsafe {
        (
            core::slice::from_raw_parts(bytes, n),
            core::slice::from_raw_parts_mut(out, n * 2),
        )
    };
    bun_core::fmt::bytes_to_hex_lower(bytes, out);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nowNs() -> u64 {
    clock::now_unix_nanos()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__userScope() -> u16 {
    ScopeId::from(bun_telemetry::Instrument::User).0
}

/// Encode a JS-owned span that just ended into the VM's batch.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__encodeSpan(global: &JSGlobalObject, desc: &EndDesc) {
    // SAFETY: `desc` is built on the C++ stack from a live JSTelemetrySpan.
    let stub = unsafe { &*desc.stub };
    if !stub.is_recording() {
        return;
    }
    let lim = limits();
    let value_limit = lim.attribute_value_length as usize;
    let end_ns = clock::or_now(desc.end_ns);
    let attrs = desc.pool.slice(desc.attrs);
    let kept_attrs = &attrs[..attrs.len().min(lim.attributes as usize)];
    let events: &[EventRef] = if desc.n_events == 0 {
        &[]
    } else {
        // SAFETY: C++ passes `n_events` entries alongside the pointer.
        unsafe { core::slice::from_raw_parts(desc.events, desc.n_events as usize) }
    };
    let links: &[LinkRef] = if desc.n_links == 0 {
        &[]
    } else {
        // SAFETY: C++ passes `n_links` entries alongside the pointer.
        unsafe { core::slice::from_raw_parts(desc.links, desc.n_links as usize) }
    };
    let kept_events = &events[..events.len().min(lim.events as usize)];
    let kept_links = &links[..links.len().min(lim.links as usize)];
    {
        let Some(mut lo) = local(global) else { return };
        let Local {
            batch, scratch: sc, ..
        } = &mut *lo;
        let [sc @ .., name_buf] = sc;
        let name = utf8(&desc.name, name_buf);
        batch::record(batch, ScopeId(desc.scope), &mut |buf: &mut Vec<u8>| {
            let mut w = SpanWriter::begin(buf, stub, name, SpanKind::from_api(desc.kind), end_ns);
            if !desc.trace_state.is_empty() {
                w.trace_state(desc.trace_state.to_utf8().slice());
            }
            each_attr(kept_attrs, &desc.pool, value_limit, sc, |k, v| {
                w.attr_bytes_key(k, *v);
            });
            for e in kept_events {
                let time_ns = if e.time_ns == 0 { end_ns } else { e.time_ns };
                let ev = w.begin_event(e.name.to_utf8().slice(), time_ns);
                entry_attrs(ev, desc.pool.slice(e.attrs), &desc.pool, value_limit, sc);
            }
            for lk in kept_links {
                let Some(ctx) = link_context(lk) else {
                    continue;
                };
                let lw = w.begin_link(&ctx, lk.trace_state.to_utf8().slice());
                entry_attrs(lw, desc.pool.slice(lk.attrs), &desc.pool, value_limit, sc);
            }
            let dropped_attrs = desc.dropped_attrs + (attrs.len() - kept_attrs.len()) as u32;
            if dropped_attrs != 0 {
                w.dropped_attributes(dropped_attrs);
            }
            if events.len() != kept_events.len() {
                w.dropped_events((events.len() - kept_events.len()) as u32);
            }
            if links.len() != kept_links.len() {
                w.dropped_links((links.len() - kept_links.len()) as u32);
            }
            if desc.status != 0 {
                w.status(
                    status_code(desc.status),
                    desc.status_message.to_utf8().slice(),
                );
            }
            w.finish();
        });
    }
    super::after_record(global);
}

// ─────────────── native-owned (pooled) spans ───────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeIsLive(global: &JSGlobalObject, handle: u64) -> bool {
    local(global).is_some_and(|l| pool::is_live(&l.pool, NativeSpan(handle)))
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeEnd(
    global: &JSGlobalObject,
    handle: u64,
    end_ns: u64,
) -> bool {
    let Some(mut l) = local(global) else {
        return false;
    };
    let ended = pool::end(&mut l, NativeSpan(handle), end_ns, &mut |_| {});
    drop(l);
    let live = ended.is_some();
    finish_ended(global, ended);
    live
}

/// Identity of a live pooled span, or null once it has ended.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__poolStub(
    global: &JSGlobalObject,
    handle: u64,
) -> *const SpanStub {
    match local(global) {
        Some(l) => pool::stub_ptr(&l.pool, NativeSpan(handle)),
        None => core::ptr::null(),
    }
}

/// The JS cell for a pooled span, creating (and pinning) it on first use;
/// undefined once the span has ended.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__poolMaterialize(global: &JSGlobalObject, handle: u64) -> JSValue {
    let native = NativeSpan(handle);
    let Some(mut l) = local(global) else {
        return JSValue::UNDEFINED;
    };
    let live = pool::with(&mut l.pool, native, |s| {
        (s.js_cell, s.stub, s.scope, s.kind)
    });
    if let Some((cell, stub, scope, kind)) = live {
        drop(l);
        if cell.is_some() {
            return JSValue::from_encoded(cell.0);
        }
        let v = Bun__TelemetrySpan__createNative(global, &stub, scope.0, kind.to_api(), native.0);
        v.protect();
        if let Some(mut l) = local(global) {
            pool::with(&mut l.pool, native, |s| {
                s.js_cell = bun_telemetry::JsCellRef(v.0)
            });
        }
        return v;
    }
    JSValue::UNDEFINED
}

/// Apply every `pool.items` entry as a span attribute (last write wins per key).
#[unsafe(no_mangle)]
/// False when the span has ended (its slot released) or is not recording.
pub extern "C" fn Bun__Telemetry__nativeSetAttributes(
    global: &JSGlobalObject,
    handle: u64,
    attrs: &AttrPool,
) -> bool {
    let lim = limits();
    let Some(mut l) = local(global) else {
        return false;
    };
    let Local { pool, scratch, .. } = &mut *l;
    if !pool::with_ref(pool, NativeSpan(handle), |s| s.stub.is_recording()).unwrap_or(false) {
        return false;
    }
    let [scratch @ .., _] = scratch;
    each_attr(
        attrs.items(),
        attrs,
        lim.attribute_value_length as usize,
        scratch,
        |k, v| {
            pool::with(pool, NativeSpan(handle), |s| s.set_attribute(k, v, lim));
        },
    );
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeSetName(
    global: &JSGlobalObject,
    handle: u64,
    name: &JsString,
) {
    let Some(mut l) = local(global) else { return };
    let Local { pool, scratch, .. } = &mut *l;
    let name = utf8(name, &mut scratch[0]);
    pool::with(pool, NativeSpan(handle), |s| s.set_name(name));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeSetStatus(
    global: &JSGlobalObject,
    handle: u64,
    code: u8,
    message: &JsString,
) {
    let Some(mut l) = local(global) else { return };
    let Local { pool, scratch, .. } = &mut *l;
    let message = utf8(message, &mut scratch[0]);
    pool::with(pool, NativeSpan(handle), |s| {
        s.set_status(status_code(code), message)
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeAddEvent(
    global: &JSGlobalObject,
    handle: u64,
    event: &EventRef,
    attrs: &AttrPool,
) {
    let lim = limits();
    let value_limit = lim.attribute_value_length as usize;
    let Some(mut l) = local(global) else { return };
    let Local { pool, scratch, .. } = &mut *l;
    let [scratch @ .., name_buf] = scratch;
    let name = utf8(&event.name, name_buf);
    pool::with(pool, NativeSpan(handle), |s| {
        if let Some(ev) = s.begin_event(name, event.time_ns, lim) {
            entry_attrs(ev, attrs.slice(event.attrs), attrs, value_limit, scratch);
        }
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeAddLink(
    global: &JSGlobalObject,
    handle: u64,
    link: &LinkRef,
    attrs: &AttrPool,
) {
    let lim = limits();
    let Some(ctx) = link_context(link) else {
        return;
    };
    let value_limit = lim.attribute_value_length as usize;
    let Some(mut l) = local(global) else { return };
    let Local { pool, scratch, .. } = &mut *l;
    let [scratch @ .., _] = scratch;
    pool::with(pool, NativeSpan(handle), |s| {
        if let Some(lw) = s.begin_link(&ctx, link.trace_state.to_utf8().slice(), lim) {
            entry_attrs(lw, attrs.slice(link.attrs), attrs, value_limit, scratch);
        }
    });
}

/// The slot's current name (for the `.name` getter); +1 ref, caller adopts.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeName(
    global: &JSGlobalObject,
    handle: u64,
) -> OwnedJsString {
    let Some(l) = local(global) else {
        return OwnedJsString::EMPTY;
    };
    pool::with_ref(&l.pool, NativeSpan(handle), |s| {
        if s.name.is_empty() && s.http.active {
            // A request span's name is derived (method + route) rather than stored.
            let mut name = Vec::with_capacity(32);
            s.http.append_name(&mut name);
            return OwnedJsString::clone_utf8(&name);
        }
        OwnedJsString::clone_utf8(&s.name)
    })
    .unwrap_or(OwnedJsString::EMPTY)
}

/// W3C `tracestate` / `baggage` a native-owned span received (+1 refs, caller
/// adopts). False, with both Empty, when it carries neither.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativePropagation(
    global: &JSGlobalObject,
    handle: u64,
    trace_state: &mut OwnedJsString,
    baggage: &mut OwnedJsString,
) -> bool {
    *trace_state = OwnedJsString::EMPTY;
    *baggage = OwnedJsString::EMPTY;
    let Some(l) = local(global) else {
        return false;
    };
    pool::with_ref(&l.pool, NativeSpan(handle), |s| {
        if s.trace_state.is_empty() && s.baggage.is_empty() {
            return false;
        }
        *trace_state = OwnedJsString::clone_utf8(&s.trace_state);
        *baggage = OwnedJsString::clone_utf8(&s.baggage);
        true
    })
    .unwrap_or(false)
}

/// bit 0: W3C trace context, bit 1: baggage.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__propagationFlags() -> u32 {
    let st = super::state();
    (st.propagate_trace_context as u32) | ((st.propagate_baggage as u32) << 1)
}

/// Record a thrown JS value on a native span per semconv: an `exception`
/// event, `error.type` = the exception's class, status Error with its message.
pub fn record_exception(
    global: &JSGlobalObject,
    span: NativeSpan,
    err: JSValue,
) -> bun_jsc::JsResult<()> {
    let mut ty_s = None;
    let mut msg_s = None;
    let mut stack_s = None;
    // Describing the thrown value must not change what the application sees:
    // a throwing getter on it is ignored here (the error is still delivered
    // by the caller); only a pending termination is propagated.
    let read = |v: bun_jsc::JsResult<Option<JSValue>>| -> bun_jsc::JsResult<Option<bun_core::Utf8Bytes<'static>>> {
        let slice = match v {
            Ok(Some(v)) if v.is_string() => v.to_utf8(global).map(Some),
            Ok(_) => Ok(None),
            Err(e) => Err(e),
        };
        match slice {
            Err(_) if global.clear_exception_except_termination() => Ok(None),
            other => other,
        }
    };
    if err.is_object() {
        // `code` (ETIMEDOUT, ERR_*) is the low-cardinality identifier semconv
        // asks for; `name` otherwise (same as recordException / fail()).
        ty_s = read(err.get(global, "code"))?;
        if ty_s.is_none() {
            ty_s = read(err.get(global, "name"))?;
        }
        msg_s = read(err.get(global, "message"))?;
        stack_s = read(err.get(global, "stack"))?;
    } else if err.is_string() {
        msg_s = read(Ok(Some(err)))?;
    }
    let ty = ty_s.as_ref().map(|s| s.slice()).unwrap_or(b"Error");
    let msg = msg_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    let stack = stack_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    if let Some(mut l) = super::local(global) {
        let lim = limits();
        pool::with(&mut l.pool, span, |s| {
            if let Some(mut ev) = s.begin_event(b"exception", 0, lim) {
                bun_telemetry::otlp::with_exception_attrs(ty, msg, stack, |a| {
                    ev.attrs(a);
                });
            }
            s.set_attribute(b"error.type", &Value::Str(ty), lim);
            s.http.flags |= bun_telemetry::http_record::FLAG_HAS_ERROR_TYPE;
            s.set_status(StatusCode::Error, msg);
        });
    }
    Ok(())
}
