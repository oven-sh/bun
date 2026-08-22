//! Glue between `JSTelemetrySpan` (C++, the JS-visible span and async-context
//! value) and `bun_telemetry`: id/sampler/clock at start, protobuf encoding at
//! end, and the native span pool for spans owned by integrations.

use core::ffi::c_void;

use bun_jsc::{JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsResult};
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{
    Flags, Limits, Local, ScopeId, SpanContext, SpanId, SpanKind, SpanStub, SpanWriter, StatusCode,
    TraceId, Value, batch, clock,
};

use super::local;

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
    safe fn Bun__Telemetry__activeNativeHandle(global: &JSGlobalObject) -> u64;
    safe fn Bun__TelemetrySpan__nativeEnded(cell: JSValue);
    /// Borrowed (not ref'd) header strings of a JS-owned span; Empty otherwise.
    safe fn Bun__TelemetrySpan__traceState(cell: JSValue) -> bun_core::String;
    safe fn Bun__TelemetrySpan__baggage(cell: JSValue) -> bun_core::String;
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
pub fn with_active_propagation<R>(global: &JSGlobalObject, f: impl FnOnce(&[u8], &[u8]) -> R) -> R {
    let native = active_native(global);
    if native.is_some() {
        let owned = local(global)
            .and_then(|l| {
                pool::with_ref(&l.pool, native, |s| {
                    [s.trace_state.clone(), s.baggage.clone()]
                })
            })
            .unwrap_or_default();
        return f(&owned[0], &owned[1]);
    }
    // JS-owned spans keep the inherited headers in their TraceState/Baggage fields.
    let cell = active_js(global);
    let (ts, bg) = (
        Bun__TelemetrySpan__traceState(cell),
        Bun__TelemetrySpan__baggage(cell),
    );
    let (ts, bg) = (ts.to_utf8_without_ref(), bg.to_utf8_without_ref());
    f(ts.slice(), bg.slice())
}

/// Create the JS cell for a native-owned span (request spans etc.). The
/// cell stores the @opentelemetry/api SpanKind numbering (INTERNAL=0..).
#[inline]
pub fn create_native_cell(
    global: &JSGlobalObject,
    stub: &SpanStub,
    scope: ScopeId,
    kind: SpanKind,
    native: NativeSpan,
) -> JSValue {
    Bun__TelemetrySpan__createNative(global, stub, scope.0, kind.to_api(), native.0)
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
    // SAFETY: `cell` is a live JSTelemetrySpan; its stub is inline storage.
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

/// End a native-owned span into the VM's batch.
#[inline]
pub fn end_native(
    global: &JSGlobalObject,
    span: NativeSpan,
    end_ns: u64,
    mut extra: impl FnMut(&mut SpanWriter<'_>),
) {
    end_native_with(
        global,
        span,
        end_ns,
        &mut |_: &mut pool::Slot| {},
        &mut extra,
    )
}

/// [`end_native`] with a closure that updates the slot first (one pool borrow).
#[inline]
pub fn end_native_with(
    global: &JSGlobalObject,
    span: NativeSpan,
    end_ns: u64,
    prep: &mut dyn FnMut(&mut pool::Slot),
    extra: &mut dyn FnMut(&mut SpanWriter<'_>),
) {
    let Some(mut l) = local(global) else { return };
    let ended = pool::end_with(&mut l, span, end_ns, prep, extra);
    drop(l);
    finish_ended(global, ended);
}

#[inline]
fn finish_ended(global: &JSGlobalObject, ended: Option<pool::Ended>) {
    if let Some(e) = ended {
        release_cell(e.js_cell);
        if e.recorded {
            super::after_record(global);
        }
    }
}

/// Drop a native-owned span without recording it.
pub fn discard_native(global: &JSGlobalObject, span: NativeSpan) {
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

use bun_core::String as JsString;
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
#[derive(Clone, Copy)]
union AttrValue {
    string: JsString,
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
abi_layout!(LinkRef, 64; trace_id @ 0, span_id @ 24, attrs @ 48, trace_flags @ 56);
abi_layout!(
    EndDesc, 152;
    stub @ 0, end_ns @ 8, name @ 16, status_message @ 40, trace_state @ 64, pool @ 88, attrs @ 112,
    events @ 120, links @ 128, n_events @ 136, n_links @ 140, dropped_attrs @ 144, scope @ 148,
    kind @ 150, status @ 151
);

/// UTF-8 view of a borrowed JS string: zero-copy when it is Latin-1 and pure
/// ASCII (nearly always), otherwise transcoded into `scratch`.
#[inline(always)]
fn utf8<'a>(s: &'a JsString, scratch: &'a mut Vec<u8>) -> &'a [u8] {
    if s.is_utf16() {
        scratch.clear();
        strings::convert_utf16_to_utf8_append(scratch, s.utf16());
        return &scratch[..];
    }
    let bytes = s.latin1();
    if strings::is_all_ascii(bytes) {
        return bytes;
    }
    *scratch = strings::allocate_latin1_into_utf8_with_list(core::mem::take(scratch), 0, bytes);
    &scratch[..]
}

/// `utf8` appended to `out`; returns the range written.
fn append_utf8(s: &JsString, out: &mut Vec<u8>) -> core::ops::Range<usize> {
    let start = out.len();
    if s.is_utf16() {
        strings::convert_utf16_to_utf8_append(out, s.utf16());
    } else {
        let bytes = s.latin1();
        if strings::is_all_ascii(bytes) {
            out.extend_from_slice(bytes);
        } else {
            *out = strings::allocate_latin1_into_utf8_with_list(core::mem::take(out), start, bytes);
        }
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

/// Event/link attributes must all be alive at once for `SpanWriter::event` /
/// `link`, so they are owned: string bytes in one buffer, then borrowed.
struct OwnedAttrs {
    bytes: Vec<u8>,
    /// (key range, value) — `Err(range into arrays)` for array values.
    entries: Vec<(
        core::ops::Range<usize>,
        Result<Scalar, core::ops::Range<usize>>,
    )>,
    arrays: Vec<Scalar>,
}

impl OwnedAttrs {
    fn collect(refs: &[AttrRef], pool: &AttrPool) -> OwnedAttrs {
        let mut o = OwnedAttrs {
            bytes: Vec::new(),
            entries: Vec::with_capacity(refs.len()),
            arrays: Vec::new(),
        };
        for a in refs {
            let key = append_utf8(&a.key, &mut o.bytes);
            if key.is_empty() {
                continue;
            }
            let value = match Scalar::read(a, &mut o.bytes) {
                Some(s) => Ok(s),
                None if a.kind == attr_kind::ARRAY => {
                    let start = o.arrays.len();
                    // SAFETY: kind == ARRAY selects the live union member.
                    for it in pool.array(unsafe { a.value.array }) {
                        if let Some(s) = Scalar::read(it, &mut o.bytes) {
                            o.arrays.push(s);
                        }
                    }
                    Err(start..o.arrays.len())
                }
                None => continue,
            };
            o.entries.push((key, value));
        }
        o
    }

    fn with<R>(&self, value_limit: usize, f: impl FnOnce(&[(&[u8], Value<'_>)]) -> R) -> R {
        let arrays: Vec<Vec<Value<'_>>> = self
            .entries
            .iter()
            .filter_map(|(_, v)| v.as_ref().err())
            .map(|r| {
                self.arrays[r.clone()]
                    .iter()
                    .map(|s| s.value(&self.bytes, value_limit))
                    .collect()
            })
            .collect();
        let mut next_array = arrays.iter();
        let pairs: Vec<(&[u8], Value<'_>)> = self
            .entries
            .iter()
            .map(|(k, v)| {
                let value = match v {
                    Ok(s) => s.value(&self.bytes, value_limit),
                    Err(_) => Value::Array(next_array.next().map(Vec::as_slice).unwrap_or(&[])),
                };
                (&self.bytes[k.clone()], value)
            })
            .collect();
        f(&pairs)
    }
}

fn status_code(api: u8) -> StatusCode {
    match api {
        1 => StatusCode::Ok,
        2 => StatusCode::Error,
        _ => StatusCode::Unset,
    }
}

fn link_context(link: &LinkRef, scratch: &mut Vec<u8>) -> Option<SpanContext> {
    let trace_id = TraceId::from_hex(utf8(&link.trace_id, scratch))?;
    let span_id = SpanId::from_hex(utf8(&link.span_id, scratch))?;
    Some(SpanContext {
        trace_id,
        span_id,
        flags: Flags(link.trace_flags & Flags::SAMPLED),
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
    let now = if start_ns == 0 {
        clock::now_unix_nanos()
    } else {
        start_ns
    };
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
    let mut scratch = Vec::new();
    let Some(trace_id) = TraceId::from_hex(utf8(trace_id, &mut scratch)) else {
        return false;
    };
    let Some(span_id) = SpanId::from_hex(utf8(span_id, &mut scratch)) else {
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
    let mut scratch = Vec::new();
    match bun_telemetry::propagation::parse_traceparent(utf8(header, &mut scratch)) {
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
    let end_ns = if desc.end_ns == 0 {
        clock::now_unix_nanos()
    } else {
        desc.end_ns
    };
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
        // The name borrows scratch[2] for the whole encode; attribute keys/values use [0]/[1]/[2'].
        let mut name_buf = core::mem::take(&mut sc[2]);
        let name = utf8(&desc.name, &mut name_buf);
        batch::record(batch, ScopeId(desc.scope), &mut |buf: &mut Vec<u8>| {
            let mut w = SpanWriter::begin(buf, stub, name, SpanKind::from_api(desc.kind), end_ns);
            if !desc.trace_state.is_empty() {
                let mut tmp = Vec::new();
                w.trace_state(utf8(&desc.trace_state, &mut tmp));
            }
            each_attr(kept_attrs, &desc.pool, value_limit, sc, |k, v| {
                w.attr_bytes_key(k, *v);
            });
            for e in kept_events {
                let mut tmp = Vec::new();
                let ename = utf8(&e.name, &mut tmp);
                let time_ns = if e.time_ns == 0 { end_ns } else { e.time_ns };
                OwnedAttrs::collect(desc.pool.slice(e.attrs), &desc.pool)
                    .with(value_limit, |pairs| w.event(ename, time_ns, pairs));
            }
            for lk in kept_links {
                let mut tmp = Vec::new();
                let Some(ctx) = link_context(lk, &mut tmp) else {
                    continue;
                };
                OwnedAttrs::collect(desc.pool.slice(lk.attrs), &desc.pool)
                    .with(value_limit, |pairs| w.link(&ctx, pairs));
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
                let mut tmp = Vec::new();
                w.status(
                    status_code(desc.status),
                    utf8(&desc.status_message, &mut tmp),
                );
            }
            w.finish();
        });
        sc[2] = name_buf;
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
    let ended = pool::end(&mut l, NativeSpan(handle), end_ns, |_| {});
    drop(l);
    let live = ended.is_some();
    finish_ended(global, ended);
    live
}

/// Identity of a pooled span (tolerates ended-but-not-reused slots), or null.
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

/// The JS cell for a pooled span, creating (and pinning) it on first use.
/// After the span has ended this yields a fresh non-recording carrier of its
/// identity, or undefined once the slot was reused.
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
        let v = create_native_cell(global, &stub, scope, kind, native);
        v.protect();
        if let Some(mut l) = local(global) {
            pool::with(&mut l.pool, native, |s| {
                s.js_cell = bun_telemetry::JsCellRef(v.0)
            });
        }
        return v;
    }
    let p = pool::stub_ptr(&l.pool, native);
    if p.is_null() {
        return JSValue::UNDEFINED;
    }
    // SAFETY: non-null `stub_ptr` points at a pool slot; copied while the pool is borrowed.
    let stub = unsafe { *p };
    drop(l);
    Bun__TelemetrySpan__createNative(global, &carrier(stub.ctx, false), 0, 0, 0)
}

/// Apply every `pool.items` entry as a span attribute (last write wins per key).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeSetAttributes(
    global: &JSGlobalObject,
    handle: u64,
    attrs: &AttrPool,
) {
    let lim = limits();
    let Some(mut l) = local(global) else { return };
    let Local { pool, scratch, .. } = &mut *l;
    each_attr(
        attrs.items(),
        attrs,
        lim.attribute_value_length as usize,
        scratch,
        |k, v| {
            pool::with(pool, NativeSpan(handle), |s| s.set_attribute(k, v, lim));
        },
    );
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
    let owned = OwnedAttrs::collect(attrs.slice(event.attrs), attrs);
    let Some(mut l) = local(global) else { return };
    let Local { pool, scratch, .. } = &mut *l;
    let name = utf8(&event.name, &mut scratch[0]);
    owned.with(lim.attribute_value_length as usize, |pairs| {
        pool::with(pool, NativeSpan(handle), |s| {
            s.add_event(name, event.time_ns, pairs, lim)
        });
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
    let mut scratch = Vec::new();
    let Some(ctx) = link_context(link, &mut scratch) else {
        return;
    };
    let owned = OwnedAttrs::collect(attrs.slice(link.attrs), attrs);
    let Some(mut l) = local(global) else { return };
    owned.with(lim.attribute_value_length as usize, |pairs| {
        pool::with(&mut l.pool, NativeSpan(handle), |s| {
            s.add_link(&ctx, pairs, lim)
        });
    });
}

/// The slot's current name (for the `.name` getter); +1 ref, caller adopts.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativeName(global: &JSGlobalObject, handle: u64) -> JsString {
    let Some(l) = local(global) else {
        return JsString::empty();
    };
    pool::with_ref(&l.pool, NativeSpan(handle), |s| {
        JsString::clone_utf8(&s.name)
    })
    .unwrap_or(JsString::empty())
}

/// W3C `tracestate` / `baggage` a native-owned span received (+1 refs, caller
/// adopts). False, with both Empty, when it carries neither.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__nativePropagation(
    global: &JSGlobalObject,
    handle: u64,
    trace_state: &mut JsString,
    baggage: &mut JsString,
) -> bool {
    *trace_state = JsString::empty();
    *baggage = JsString::empty();
    let Some(l) = local(global) else {
        return false;
    };
    pool::with_ref(&l.pool, NativeSpan(handle), |s| {
        if s.trace_state.is_empty() && s.baggage.is_empty() {
            return false;
        }
        *trace_state = JsString::clone_utf8(&s.trace_state);
        *baggage = JsString::clone_utf8(&s.baggage);
        true
    })
    .unwrap_or(false)
}

/// Start a native-owned span for a JS-implemented built-in instrumentation
/// (node:http client). Returns the JS cell, or undefined when it should not
/// record.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__startInstrumentSpan(
    global: &JSGlobalObject,
    instrument: u32,
    name: &JsString,
    api_kind: u8,
) -> JSValue {
    let Some(i) = bun_telemetry::Instrument::ALL
        .get(instrument as usize)
        .copied()
    else {
        return JSValue::UNDEFINED;
    };
    let stub = super::start_leaf(global, i);
    if !stub.is_some() {
        return JSValue::UNDEFINED;
    }
    let mut scratch = Vec::new();
    let name = utf8(name, &mut scratch);
    let kind = SpanKind::from_api(api_kind);
    let native = with_active_propagation(global, |ts, bg| {
        let Some(mut l) = local(global) else {
            return NativeSpan::NONE;
        };
        pool::begin_with(&mut l.pool, stub, ScopeId::from(i), name, kind, |s| {
            s.trace_state.extend_from_slice(ts);
            s.baggage.extend_from_slice(bg);
        })
    });
    create_native_cell(global, &stub, ScopeId::from(i), kind, native)
}

/// bit 0: W3C trace context, bit 1: baggage.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__propagationFlags() -> u32 {
    let st = super::state();
    (st.propagate_trace_context as u32) | ((st.propagate_baggage as u32) << 1)
}
