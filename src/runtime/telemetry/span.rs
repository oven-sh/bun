//! `TelemetrySpan`: the JS wrapper around a `bun_telemetry::SpanData`. The
//! wrapper *is* the async-context value for an active span, so
//! `Bun__Telemetry__activeSpanPtr` hands native integrations the `SpanData`
//! directly.

use bun_jsc::{
    CallFrame, JSArrayIterator, JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions,
    JSValue, JsResult, bun_string_jsc,
};
use bun_telemetry::{
    Flags, Limits, ScopeId, Span, SpanContext, SpanData, SpanId, SpanKind, SpanStub, StatusCode,
    TraceId, Value, clock,
};

pub use crate::generated_classes::js_TelemetrySpan as js;

/// Layout-identical to `SpanData` so the JS wrapper's `m_ctx` is the span
/// record itself; the wrapper owns one reference which `finalize` releases.
#[bun_jsc::JsClass(no_constructor)]
#[repr(transparent)]
pub struct TelemetrySpan(SpanData);

unsafe extern "C" {
    safe fn Bun__Telemetry__activeSpan(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__activeSpanPtr(global: &JSGlobalObject) -> *mut core::ffi::c_void;
    safe fn Bun__Telemetry__enter(global: &JSGlobalObject, span: JSValue) -> JSValue;
    safe fn Bun__Telemetry__exit(global: &JSGlobalObject, prev: JSValue);
    safe fn Bun__Telemetry__currentContext(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__swapContext(global: &JSGlobalObject, value: JSValue) -> JSValue;
}

/// `rt::Hooks::active_span` — `global` is a `JSGlobalObject*`.
pub(crate) fn active_ptr(global: *mut core::ffi::c_void) -> *const SpanData {
    // SAFETY: only ever called with a live JSGlobalObject pointer.
    Bun__Telemetry__activeSpanPtr(unsafe { &*global.cast::<JSGlobalObject>() }).cast::<SpanData>()
}

/// The active span's native record, if any. Borrow is valid for as long as
/// the caller doesn't run JS (the wrapper roots it).
#[inline]
pub fn active<'a>(global: &'a JSGlobalObject) -> Option<&'a SpanData> {
    let p = Bun__Telemetry__activeSpanPtr(global).cast::<SpanData>();
    if p.is_null() {
        None
    } else {
        Some(unsafe { &*p })
    }
}

/// A new owning reference to the active span.
#[inline]
pub fn active_ref(global: &JSGlobalObject) -> Option<Span> {
    let p = Bun__Telemetry__activeSpanPtr(global).cast::<SpanData>();
    if p.is_null() {
        None
    } else {
        Some(unsafe { Span::ref_raw(p) })
    }
}

#[inline]
pub fn active_context(global: &JSGlobalObject) -> Option<SpanContext> {
    active(global)
        .map(|s| *s.context())
        .filter(SpanContext::is_valid)
}

#[inline]
pub fn active_js(global: &JSGlobalObject) -> JSValue {
    Bun__Telemetry__activeSpan(global)
}

/// RAII activation of a span wrapper for the duration of a native → JS call.
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

impl core::ops::Deref for TelemetrySpan {
    type Target = SpanData;
    #[inline]
    fn deref(&self) -> &SpanData {
        &self.0
    }
}

pub fn limits() -> &'static Limits {
    &super::state().limits
}

/// Convert a JS attribute value. Strings borrow into `scratch`.
pub(crate) fn with_attr_value<R>(
    global: &JSGlobalObject,
    v: JSValue,
    f: impl FnOnce(Option<Value<'_>>) -> R,
) -> JsResult<R> {
    if v.is_string() {
        let s = v.to_slice(global)?;
        return Ok(f(Some(Value::Str(s.slice()))));
    }
    if v.is_number() {
        let n = v.as_number();
        if n.is_finite() && n == n.trunc() && n.abs() < 9007199254740992.0 {
            return Ok(f(Some(Value::Int(n as i64))));
        }
        return Ok(f(Some(Value::Double(n))));
    }
    if v.is_boolean() {
        return Ok(f(Some(Value::Bool(v.as_boolean()))));
    }
    if v.is_big_int() {
        // Attribute ints are int64; out-of-range BigInts become strings.
        if v.is_big_int_in_int64_range(i64::MIN, i64::MAX) {
            return Ok(f(Some(Value::Int(v.to_int64()))));
        }
        let s = v.to_slice(global)?;
        return Ok(f(Some(Value::Str(s.slice()))));
    }
    if v.is_array() {
        // Two passes: own the string slices, then build the Value list.
        let mut owned: Vec<OwnedAttr> = Vec::new();
        let mut it = JSArrayIterator::init(v, global)?;
        while let Some(item) = it.next()? {
            if item.is_string() {
                owned.push(OwnedAttr::Str(item.to_slice(global)?));
            } else if item.is_number() {
                let n = item.as_number();
                if n.is_finite() && n == n.trunc() && n.abs() < 9007199254740992.0 {
                    owned.push(OwnedAttr::Int(n as i64));
                } else {
                    owned.push(OwnedAttr::Double(n));
                }
            } else if item.is_boolean() {
                owned.push(OwnedAttr::Bool(item.as_boolean()));
            } else if item.is_undefined_or_null() {
                // Spec allows null holes in arrays; encode as empty string to keep indices.
                owned.push(OwnedAttr::Int(0));
            }
        }
        let vals: Vec<Value<'_>> = owned
            .iter()
            .map(|o| match o {
                OwnedAttr::Str(s) => Value::Str(s.slice()),
                OwnedAttr::Int(i) => Value::Int(*i),
                OwnedAttr::Double(d) => Value::Double(*d),
                OwnedAttr::Bool(b) => Value::Bool(*b),
            })
            .collect();
        return Ok(f(Some(Value::Array(&vals))));
    }
    Ok(f(None))
}

enum OwnedAttr {
    Str(bun_core::ZigStringSlice),
    Int(i64),
    Double(f64),
    Bool(bool),
}

pub(crate) fn kind_from_js(v: JSValue) -> SpanKind {
    if v.is_number() {
        // @opentelemetry/api SpanKind: INTERNAL=0 SERVER=1 CLIENT=2 PRODUCER=3 CONSUMER=4
        return match v.as_number() as i32 {
            1 => SpanKind::Server,
            2 => SpanKind::Client,
            3 => SpanKind::Producer,
            4 => SpanKind::Consumer,
            _ => SpanKind::Internal,
        };
    }
    SpanKind::Internal
}

pub(crate) fn kind_to_api(k: SpanKind) -> i32 {
    match k {
        SpanKind::Internal => 0,
        SpanKind::Server => 1,
        SpanKind::Client => 2,
        SpanKind::Producer => 3,
        SpanKind::Consumer => 4,
    }
}

/// Epoch nanoseconds from an OTel-API `TimeInput`: epoch-ms number, Date,
/// or `[seconds, nanos]` HrTime. 0 = "now".
pub(crate) fn time_from_js(global: &JSGlobalObject, v: JSValue) -> JsResult<u64> {
    if v.is_undefined_or_null() {
        return Ok(0);
    }
    if v.is_number() {
        let ms = v.as_number();
        if !(ms > 0.0) {
            return Ok(0);
        }
        return Ok((ms * 1_000_000.0) as u64);
    }
    if v.is_array() {
        let s = v.get_index(global, 0)?;
        let n = v.get_index(global, 1)?;
        if s.is_number() && n.is_number() {
            return Ok((s.as_number() as u64)
                .saturating_mul(1_000_000_000)
                .saturating_add(n.as_number() as u64));
        }
        return Ok(0);
    }
    if v.is_object() {
        // Date
        let ms = v.to_number(global)?;
        if ms > 0.0 {
            return Ok((ms * 1_000_000.0) as u64);
        }
    }
    Ok(0)
}

fn hex_js(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
    let mut buf = [0u8; 32];
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for (i, b) in bytes.iter().enumerate() {
        buf[i * 2] = HEX[(b >> 4) as usize];
        buf[i * 2 + 1] = HEX[(b & 0xf) as usize];
    }
    bun_string_jsc::create_utf8_for_js(global, &buf[..bytes.len() * 2])
}

/// Read a `SpanContext`-shaped JS object (`{traceId, spanId, traceFlags, isRemote?}`)
/// or a TelemetrySpan.
pub(crate) fn span_context_from_js(
    global: &JSGlobalObject,
    v: JSValue,
) -> JsResult<Option<SpanContext>> {
    if !v.is_object() {
        return Ok(None);
    }
    if let Some(span) = js::from_js(v) {
        return Ok(Some(*unsafe { span.as_ref() }.0.context()));
    }
    let Some(tid) = v.get(global, "traceId")? else {
        return Ok(None);
    };
    let Some(sid) = v.get(global, "spanId")? else {
        return Ok(None);
    };
    if !tid.is_string() || !sid.is_string() {
        return Ok(None);
    }
    let tid = tid.to_slice(global)?;
    let sid = sid.to_slice(global)?;
    let (Some(trace_id), Some(span_id)) = (
        TraceId::from_hex(tid.slice()),
        SpanId::from_hex(sid.slice()),
    ) else {
        return Ok(None);
    };
    let mut flags = 0u8;
    if let Some(f) = v.get(global, "traceFlags")? {
        if f.is_number() {
            flags = (f.as_number() as u32 as u8) & Flags::SAMPLED;
        }
    }
    if let Some(r) = v.get(global, "isRemote")? {
        if r.to_boolean() {
            flags |= Flags::REMOTE;
        }
    }
    Ok(Some(SpanContext {
        trace_id,
        span_id,
        flags: Flags(flags),
    }))
}

/// Collect `attributes` object entries and call `each(key, value)`.
pub(crate) fn for_each_attribute(
    global: &JSGlobalObject,
    obj: JSValue,
    mut each: impl FnMut(&[u8], &Value<'_>),
) -> JsResult<()> {
    if !obj.is_object() {
        return Ok(());
    }
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
        if value.is_undefined_or_null() {
            continue;
        }
        let key = name.to_utf8();
        with_attr_value(global, value, |v| {
            if let Some(v) = v {
                each(key.slice(), &v);
            }
        })?;
    }
    Ok(())
}

impl TelemetrySpan {
    /// Wrap `span` in a new JS object (consumes the reference).
    pub fn create(global: &JSGlobalObject, span: Span) -> JSValue {
        js::to_js(span.into_raw().cast::<TelemetrySpan>(), global)
    }

    /// Start a span and return `(record, wrapper)`.
    pub fn start(
        global: &JSGlobalObject,
        scope: ScopeId,
        name: &[u8],
        kind: SpanKind,
        parent: Option<&SpanContext>,
        start_ns: u64,
    ) -> (Span, JSValue) {
        let st = super::state();
        let now = if start_ns == 0 {
            clock::now_unix_nanos()
        } else {
            start_ns
        };
        let stub = SpanStub::start(parent, &st.sampler, now);
        let span = Span::new(stub, scope, name, kind);
        let js = Self::create(global, span.clone());
        (span, js)
    }

    /// A non-recording wrapper carrying only a (typically remote) context, so
    /// unsampled requests still propagate trace identity to outgoing calls.
    pub fn non_recording(global: &JSGlobalObject, ctx: SpanContext) -> JSValue {
        let stub = SpanStub {
            ctx: SpanContext {
                flags: Flags(ctx.flags.0 & !Flags::SAMPLED),
                ..ctx
            },
            parent: SpanId::INVALID,
            start_ns: 1,
        };
        let span = Span::new(
            stub,
            ScopeId::from(bun_telemetry::Instrument::User),
            b"",
            SpanKind::Internal,
        );
        Self::create(global, span)
    }

    pub fn finalize(self: Box<Self>) {
        // SAFETY: the wrapper owned exactly one reference, created in `create`.
        drop(unsafe { Span::from_raw(Box::into_raw(self).cast::<SpanData>()) });
    }

    #[inline]
    pub fn data(&self) -> &SpanData {
        &self.0
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_attribute(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        if !self.0.is_recording() {
            return Ok(this);
        }
        let key = frame.argument(0);
        let value = frame.argument(1);
        if !key.is_string() || value.is_undefined_or_null() {
            return Ok(this);
        }
        let key = key.to_slice(global)?;
        with_attr_value(global, value, |v| {
            if let Some(v) = v {
                self.0.set_attribute(key.slice(), &v, limits());
            }
        })?;
        Ok(this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_attributes(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        if !self.0.is_recording() {
            return Ok(this);
        }
        let l = limits();
        for_each_attribute(global, frame.argument(0), |k, v| {
            self.0.set_attribute(k, v, l)
        })?;
        Ok(this)
    }

    /// `addEvent(name, attributesOrStartTime?, startTime?)`
    #[bun_jsc::host_fn(method)]
    pub fn add_event(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        if !self.0.is_recording() {
            return Ok(this);
        }
        let name = frame.argument(0);
        if !name.is_string() {
            return Ok(this);
        }
        let name = name.to_slice(global)?;
        let mut a1 = frame.argument(1);
        let mut a2 = frame.argument(2);
        // OTel API: if the 2nd arg is a TimeInput, it is the start time.
        if a1.is_number() || a1.is_array() || (a1.is_object() && a1.is_date()) {
            a2 = a1;
            a1 = JSValue::UNDEFINED;
        }
        let time = time_from_js(global, a2)?;
        let mut owned: Vec<(Vec<u8>, OwnedValue)> = Vec::new();
        collect_attributes(global, a1, &mut owned)?;
        let borrowed: Vec<(&[u8], Value<'_>)> = owned
            .iter()
            .map(|(k, v)| (k.as_slice(), v.borrow()))
            .collect();
        self.0.add_event(name.slice(), time, &borrowed, limits());
        Ok(this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_link(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        self.add_link_value(global, frame.argument(0))?;
        Ok(this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_links(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        let links = frame.argument(0);
        if links.is_array() {
            let mut it = JSArrayIterator::init(links, global)?;
            while let Some(l) = it.next()? {
                self.add_link_value(global, l)?;
            }
        }
        Ok(this)
    }

    pub(crate) fn add_link_value(&self, global: &JSGlobalObject, link: JSValue) -> JsResult<()> {
        if !self.0.is_recording() || !link.is_object() {
            return Ok(());
        }
        // OTel API Link: { context: SpanContext, attributes? }. Also accept a Span or bare SpanContext.
        let ctx_v = link.get(global, "context")?.unwrap_or(link);
        let Some(ctx) = span_context_from_js(global, ctx_v)? else {
            return Ok(());
        };
        let mut owned: Vec<(Vec<u8>, OwnedValue)> = Vec::new();
        if let Some(attrs) = link.get(global, "attributes")? {
            collect_attributes(global, attrs, &mut owned)?;
        }
        let borrowed: Vec<(&[u8], Value<'_>)> = owned
            .iter()
            .map(|(k, v)| (k.as_slice(), v.borrow()))
            .collect();
        self.0.add_link(&ctx, b"", &borrowed, limits());
        Ok(())
    }

    /// `setStatus({ code, message })` or `setStatus(code, message)`.
    /// Codes follow @opentelemetry/api: UNSET=0 OK=1 ERROR=2.
    #[bun_jsc::host_fn(method)]
    pub fn set_status(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        let a0 = frame.argument(0);
        let (code_v, msg_v) = if a0.is_object() {
            (
                a0.get(global, "code")?.unwrap_or(JSValue::UNDEFINED),
                a0.get(global, "message")?.unwrap_or(JSValue::UNDEFINED),
            )
        } else {
            (a0, frame.argument(1))
        };
        let code = if code_v.is_number() {
            match code_v.as_number() as i32 {
                1 => StatusCode::Ok,
                2 => StatusCode::Error,
                _ => StatusCode::Unset,
            }
        } else if code_v.is_string() {
            let s = code_v.to_slice(global)?;
            match s.slice() {
                b"ok" | b"OK" => StatusCode::Ok,
                b"error" | b"ERROR" => StatusCode::Error,
                _ => StatusCode::Unset,
            }
        } else {
            StatusCode::Unset
        };
        if msg_v.is_string() {
            let m = msg_v.to_slice(global)?;
            self.0.set_status(code, m.slice());
        } else {
            self.0.set_status(code, b"");
        }
        Ok(this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn update_name(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        let n = frame.argument(0);
        if n.is_string() {
            let n = n.to_slice(global)?;
            self.0.set_name(n.slice());
        }
        Ok(this)
    }

    /// `recordException(error, time?)`
    #[bun_jsc::host_fn(method)]
    pub fn record_exception(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this = frame.this();
        if !self.0.is_recording() {
            return Ok(this);
        }
        record_exception_value(
            &self.0,
            global,
            frame.argument(0),
            time_from_js(global, frame.argument(1))?,
        )?;
        Ok(this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn is_recording(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::from(self.0.is_recording()))
    }

    /// OTel API `SpanContext` object, cached on the wrapper.
    #[bun_jsc::host_fn(method)]
    pub fn span_context(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        if let Some(v) = js::context_get_cached(this) {
            if !v.is_empty() && !v.is_undefined() {
                return Ok(v);
            }
        }
        let ctx = self.0.context();
        let obj = JSValue::create_empty_object(global, 4);
        obj.put(global, b"traceId", hex_js(global, &ctx.trace_id.0)?);
        obj.put(global, b"spanId", hex_js(global, &ctx.span_id.0)?);
        obj.put(
            global,
            b"traceFlags",
            JSValue::js_number_from_int32(ctx.flags.w3c() as i32),
        );
        if ctx.flags.remote() {
            obj.put(global, b"isRemote", JSValue::TRUE);
        }
        js::context_set_cached(this, global, obj);
        Ok(obj)
    }

    /// `end(endTime?)`
    #[bun_jsc::host_fn(method)]
    pub fn end(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let t = time_from_js(global, frame.argument(0))?;
        self.end_native(t);
        Ok(JSValue::UNDEFINED)
    }

    pub fn end_native(&self, end_ns: u64) {
        end_span(&self.0, end_ns, |_| {});
    }

    /// Make this span the active one until `exit()`/dispose. Stores the
    /// displaced slot value on the wrapper.
    #[bun_jsc::host_fn(method)]
    pub fn enter(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        if let Some(v) = js::restore_get_cached(this) {
            if !v.is_empty() {
                // Already entered; keep the first restore point.
                return Ok(this);
            }
        }
        let prev = Bun__Telemetry__enter(global, this);
        // Empty JSValue can't be stored; use the hole marker `null`? No —
        // `undefined` is a legitimate previous value. Store as-is; "not
        // entered" is represented by the slot being JSValue::ZERO (empty).
        js::restore_set_cached(
            this,
            global,
            if prev.is_empty() {
                JSValue::UNDEFINED
            } else {
                prev
            },
        );
        Ok(this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn exit(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        self.exit_native(global, this);
        Ok(this)
    }

    fn exit_native(&self, global: &JSGlobalObject, this: JSValue) {
        if let Some(prev) = js::restore_get_cached(this) {
            if !prev.is_empty() {
                Bun__Telemetry__exit(global, prev);
                js::restore_set_cached(this, global, JSValue::ZERO);
            }
        }
    }

    /// `using span = tracer.startActiveSpan(...)`: end and deactivate.
    #[bun_jsc::host_fn(method)]
    pub fn dispose(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this = frame.this();
        self.end_native(0);
        self.exit_native(global, this);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_trace_id(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        hex_js(global, &this.0.context().trace_id.0)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_span_id(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        hex_js(global, &this.0.context().span_id.0)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_parent_span_id(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.0.stub.parent.is_valid() {
            hex_js(global, &this.0.stub.parent.0)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_trace_flags(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(
            this.0.context().flags.w3c() as i32
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_is_remote(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::from(this.0.context().flags.remote()))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.0
            .with_name(|n| bun_string_jsc::create_utf8_for_js(global, n))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_kind(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number_from_int32(kind_to_api(this.0.kind())))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ended(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::from(this.0.ended()))
    }
}

pub(crate) enum OwnedValue {
    Str(bun_core::ZigStringSlice),
    Int(i64),
    Double(f64),
    Bool(bool),
}

impl OwnedValue {
    pub(crate) fn borrow(&self) -> Value<'_> {
        match self {
            OwnedValue::Str(s) => Value::Str(s.slice()),
            OwnedValue::Int(i) => Value::Int(*i),
            OwnedValue::Double(d) => Value::Double(*d),
            OwnedValue::Bool(b) => Value::Bool(*b),
        }
    }
}

pub(crate) fn collect_attributes(
    global: &JSGlobalObject,
    obj: JSValue,
    out: &mut Vec<(Vec<u8>, OwnedValue)>,
) -> JsResult<()> {
    if !obj.is_object() {
        return Ok(());
    }
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
        let key = name.to_utf8().slice().to_vec();
        if value.is_string() {
            out.push((key, OwnedValue::Str(value.to_slice(global)?)));
        } else if value.is_number() {
            let n = value.as_number();
            if n.is_finite() && n == n.trunc() && n.abs() < 9007199254740992.0 {
                out.push((key, OwnedValue::Int(n as i64)));
            } else {
                out.push((key, OwnedValue::Double(n)));
            }
        } else if value.is_boolean() {
            out.push((key, OwnedValue::Bool(value.as_boolean())));
        }
    }
    Ok(())
}

/// Record a JS exception value as an `exception` event and set Error status.
pub(crate) fn record_exception_value(
    span: &SpanData,
    global: &JSGlobalObject,
    err: JSValue,
    time_ns: u64,
) -> JsResult<()> {
    if !span.is_recording() {
        return Ok(());
    }
    let mut ty_s = None;
    let mut msg_s = None;
    let mut stack_s = None;
    if err.is_object() {
        if let Some(n) = err.get(global, "name")? {
            if n.is_string() {
                ty_s = Some(n.to_slice(global)?);
            }
        }
        if let Some(m) = err.get(global, "message")? {
            if m.is_string() {
                msg_s = Some(m.to_slice(global)?);
            }
        }
        if let Some(s) = err.get(global, "stack")? {
            if s.is_string() {
                stack_s = Some(s.to_slice(global)?);
            }
        }
    } else if err.is_string() {
        msg_s = Some(err.to_slice(global)?);
    }
    let ty = ty_s.as_ref().map(|s| s.slice()).unwrap_or(b"Error");
    let msg = msg_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    let stack = stack_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    let attrs: [(&[u8], Value<'_>); 3] = [
        (b"exception.type", Value::Str(ty)),
        (b"exception.message", Value::Str(msg)),
        (b"exception.stacktrace", Value::Str(stack)),
    ];
    let n = if stack.is_empty() { 2 } else { 3 };
    span.add_event(b"exception", time_ns, &attrs[..n], limits());
    Ok(())
}

/// End `span` into this thread's batch. `extra` adds integration attributes.
#[inline]
pub fn end_span(
    span: &SpanData,
    end_ns: u64,
    extra: impl FnOnce(&mut bun_telemetry::SpanWriter<'_>),
) {
    let scope = span.scope;
    bun_telemetry::batch::record(scope, |buf| {
        span.end_into(buf, end_ns, extra);
    });
    span.shrink();
    super::after_record();
}
