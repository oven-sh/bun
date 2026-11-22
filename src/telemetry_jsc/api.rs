//! `Bun.otel`

use core::sync::atomic::Ordering::Relaxed;

use bun_core::String as BunString;
use bun_jsc::bindgen::{Callable, JsHeap, JsLocal, JsPayload, JsScope, JsWrapper};
use bun_jsc::{
    JSArrayIterator, JSGlobalObject, JSObject, JSPromise, JSString, JSValue, JsResult, StringJsc,
    bun_string_jsc,
};
use bun_telemetry::{Carried, Instrument, ScopeId, SpanData, SpanStub, processor, propagation};

use crate::baggage::Baggage;
use crate::context::{self, Binding, Bound, Context, native_span_for};
use crate::engine::{self, Entered, FunctionKind};
use crate::generated_bindgen::telemetry::{TelemetryStats, js_ContextToken};
use crate::generated_bindgen::telemetry_internals::{
    Bun__Telemetry__callBound, Bun__Telemetry__callWrapped,
};
use crate::promise;
use crate::span::{Span, global_of};
use crate::state::VmState;
use crate::tracer::{Tracer, start_internal_span};

pub(crate) use crate::decode::decode;
pub(crate) use crate::exporter::{on_export_reject, on_export_resolve};
pub(crate) use crate::promise::{on_reject, on_resolve};

/// Calls `function` with `span` active, and ends the span with the call or with the promise it returns.
fn call_traced(
    global: &JSGlobalObject,
    span: JSValue,
    under: Option<JSValue>,
    function: JSValue,
    this: JSValue,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let entered = Entered::new(
        global,
        Context::bind_new_span(global, span, under, Bound::ForScope),
    );
    let result = function
        .call_for_running_script(global, this, args)
        .and_then(|result| engine::adopt_thenable(global, result));
    drop(entered);
    promise::end_with(global, span, result)
}

fn refuse_generator(global: &JSGlobalObject, caller: &str, function: JSValue) -> JsResult<()> {
    if engine::kind_of_function(function) == FunctionKind::GENERATOR {
        return Err(global.throw_invalid_arguments(format_args!(
            "{caller} cannot trace a generator function, which returns before its body runs\nnote: call Bun.otel.span() inside the generator"
        )));
    }
    Ok(())
}

/// `(name, attributes?, callback?)`
pub(crate) fn span<'a>(
    cx: &mut JsScope<'a>,
    name: JsLocal<'a>,
    attributes_or_callback: JsLocal<'a>,
    callback: JsLocal<'a>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let name = name.to_js().to_js_string(global)?.to_js();
    let (attributes, callback) = match (attributes_or_callback.to_js(), callback.to_js()) {
        (callback, nothing) if callback.is_callable() && nothing.is_undefined() => {
            (nothing, callback)
        }
        both => both,
    };
    if attributes.is_callable() || !(attributes.is_undefined_or_null() || attributes.is_object()) {
        return Err(global.throw_invalid_argument_type_value("attributes", "object", attributes));
    }
    if !callback.is_undefined() && !callback.is_callable() {
        return Err(global.throw_invalid_argument_type_value("fn", "function", callback));
    }
    refuse_generator(global, "Bun.otel.span()", callback)?;
    let under = context::active_binding(global);
    let span = start_internal_span(global, ScopeId::USER, name, &under);
    if attributes.is_object() {
        Span::of(&span).put_attributes(global, attributes)?;
    }
    if callback.is_undefined() {
        Span::enter_under(global, span, None);
        return Ok(span);
    }
    call_traced(global, span, under, callback, JSValue::UNDEFINED, &[span])
}

fn length_of(global: &JSGlobalObject, function: JSValue) -> JsResult<u32> {
    let length = function
        .get(global, "length")?
        .and_then(JSValue::get_number);
    Ok(length
        .filter(|n| (0.0..=65535.0).contains(n))
        .map_or(0, |n| n as u32))
}

/// `(name?, function)`
pub(crate) fn wrap<'a>(
    cx: &mut JsScope<'a>,
    name_or_function: JsLocal<'a>,
    function: JsLocal<'a>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (name, function) = match (name_or_function.to_js(), function.to_js()) {
        (function, _) if function.is_callable() => (JSValue::UNDEFINED, function),
        both => both,
    };
    if !function.is_callable() {
        return Err(global.throw_invalid_argument_type_value("fn", "function", function));
    }
    if engine::kind_of_function(function) == FunctionKind::CLASS {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.otel.wrap() cannot wrap a class\nnote: wrap its methods"
        )));
    }
    refuse_generator(global, "Bun.otel.wrap()", function)?;
    let own_name = match function.get(global, "name")? {
        Some(name) if name.is_string_literal() => name.to_bun_string(global)?,
        _ => BunString::EMPTY,
    };
    let given_name = match name.is_undefined() {
        true => BunString::EMPTY,
        false => name.to_bun_string(global)?,
    };
    let (function_name, span_name) = match (own_name.is_empty(), given_name.is_empty()) {
        (true, true) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "Bun.otel.wrap() needs a span name for an anonymous function"
            )));
        }
        (true, false) => (&given_name, &given_name),
        (false, true) => (&own_name, &own_name),
        (false, false) => (&own_name, &given_name),
    };
    Ok(engine::create_forwarder(
        global,
        Bun__Telemetry__callWrapped,
        function_name,
        length_of(global, function)?,
        function,
        span_name.to_js(global)?,
    ))
}

pub(crate) fn call_wrapped<'a>(
    cx: &mut JsScope<'a>,
    this_value: JsLocal<'a>,
    callee: JsLocal<'a>,
    args: &[JsLocal<'a>],
) -> JsResult<JSValue> {
    let global = cx.global();
    // SAFETY: only `wrap` makes a function of this body.
    let (function, name) = unsafe { engine::forwarder_parts(callee.to_js()) };
    let args = JsLocal::to_js_slice(args);
    if !bun_telemetry::enabled(Instrument::User) {
        return (function.call_for_running_script(global, this_value.to_js(), args))
            .and_then(|result| engine::adopt_thenable(global, result));
    }
    let under = context::active_binding(global);
    let span = start_internal_span(global, ScopeId::USER, name, &under);
    call_traced(global, span, under, function, this_value.to_js(), args)
}

fn with_recording_span(
    global: &JSGlobalObject,
    f: impl FnOnce(&Span) -> JsResult<()>,
) -> JsResult<bool> {
    let span = Binding::of(&context::active_binding(global)).span();
    match span.as_ref().and_then(JSValue::as_class_ref::<Span>) {
        Some(span) if span.is_recording() => f(&span).map(|()| true),
        _ => Ok(false),
    }
}

pub(crate) fn set_one<'a>(
    heap: &JsHeap<'a>,
    key: JsLocal<'a, JSString>,
    value: JsLocal<'a>,
) -> JsResult<bool> {
    let global = global_of(heap);
    with_recording_span(global, |span| {
        span.put_attribute(global, key.to_js(), value.to_js())
    })
}

pub(crate) fn set_many<'a>(
    cx: &mut JsScope<'a>,
    attributes: Option<JsLocal<'a, JSObject>>,
) -> JsResult<bool> {
    let Some(attributes) = attributes else {
        return Ok(false);
    };
    let global = cx.global();
    with_recording_span(global, |span| {
        span.put_attributes(global, attributes.to_js())
    })
}

pub(crate) fn tracer<'a>(
    cx: &mut JsScope<'a>,
    name: JsLocal<'a>,
    version: JsLocal<'a>,
) -> JsResult<JSValue> {
    Tracer::get(cx.global(), name.to_js(), version.to_js())
}

pub(crate) fn active_span(heap: &JsHeap<'_>) -> Option<JSValue> {
    let span = Binding::of(&context::active_binding(global_of(heap))).span();
    span.filter(|span| Span::of(span).data().stub.ctx.is_valid())
        .inspect(|span| Span::hand_to_script(*span))
}

fn call_with_binding(
    global: &JSGlobalObject,
    binding: Option<JSValue>,
    callback: JSValue,
    this: JSValue,
    args: &[JsLocal<'_>],
) -> JsResult<JSValue> {
    let _entered = Entered::new(global, binding);
    callback.call_for_running_script(global, this, JsLocal::to_js_slice(args))
}

pub(crate) fn with<'a>(
    cx: &mut JsScope<'a>,
    span_or_context: JsLocal<'a>,
    callback: JsLocal<'a, Callable>,
    this_arg: JsLocal<'a>,
    args: &[JsLocal<'a>],
) -> JsResult<JSValue> {
    let (global, given) = (cx.global(), span_or_context.to_js());
    let binding = if !given.is::<Span>() && Context::is_api_context(global, given)? {
        Some(Context::from_api(global, given)?)
    } else {
        native_span_for(global, given)?.map(|span| {
            Context::bind_span(
                global,
                span,
                context::active_binding(global),
                Bound::ForScope,
            )
        })
    };
    call_with_binding(global, binding, callback.to_js(), this_arg.to_js(), args)
}

pub(crate) fn force_flush(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    match (bun_telemetry::configured().then(|| VmState::get(global))).flatten() {
        Some(state) => state.force_flush(global),
        None => Ok(JSPromise::resolved_promise_value(
            global,
            JSValue::UNDEFINED,
        )),
    }
}

pub(crate) fn shutdown(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
    bun_telemetry::shut_down();
    force_flush(cx)
}

pub(crate) fn stats() -> TelemetryStats {
    let p = processor::global();
    TelemetryStats {
        spans_exported: p.stats.spans_exported.load(Relaxed) as f64,
        spans_dropped: p.stats.spans_dropped.load(Relaxed) as f64,
        exports_succeeded: p.stats.exports_ok.load(Relaxed) as f64,
        exports_failed: p.stats.exports_failed.load(Relaxed) as f64,
        spans_pending: p.pending_count().into(),
        exports_inflight: p.inflight() as f64,
    }
}

pub(crate) struct TracerProvider;

impl TracerProvider {
    pub(crate) fn get_tracer<'a>(
        &self,
        cx: &mut JsScope<'a>,
        name: JsLocal<'a>,
        version: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        tracer(cx, name, version)
    }

    pub(crate) fn force_flush(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        force_flush(cx)
    }

    pub(crate) fn shutdown(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        shutdown(cx)
    }
}

/// The field of the object is the binding that `attach()` `displaced`, `null` for none.
pub(crate) struct ContextToken;

impl ContextToken {
    pub(crate) fn dispose<'a>(&self, this_value: JsWrapper<'a, Self>, heap: &JsHeap<'a>) {
        let global = global_of(heap);
        if let Some(displaced) = js_ContextToken::displaced_take_cached(this_value.to_js(), global)
        {
            engine::set_active_binding(global, Some(displaced).filter(|b| !b.is_null()));
        }
    }
}

pub(crate) struct ContextManager;

impl ContextManager {
    pub(crate) fn active(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        Context::active(cx.global())
    }

    pub(crate) fn with<'a>(
        &self,
        cx: &mut JsScope<'a>,
        context: JsLocal<'a>,
        callback: JsLocal<'a, Callable>,
        this_arg: JsLocal<'a>,
        args: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let context = Context::from_api(global, context.to_js())?;
        call_with_binding(
            global,
            Some(context),
            callback.to_js(),
            this_arg.to_js(),
            args,
        )
    }

    /// A function, or the `emit()` of an `EventEmitter`.
    pub(crate) fn bind<'a>(
        &self,
        cx: &mut JsScope<'a>,
        context: JsLocal<'a>,
        target: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (global, target) = (cx.global(), target.to_js());
        let bind = |name: &'static str, function: JSValue| -> JsResult<JSValue> {
            Ok(engine::create_forwarder(
                global,
                Bun__Telemetry__callBound,
                &BunString::static_(name),
                length_of(global, function)?,
                function,
                Context::from_api(global, context.to_js())?,
            ))
        };
        if target.is_callable() {
            return bind("bound", target);
        }
        if target.is_object()
            && let Some(emit) = target.get(global, "emit")?
            && emit.is_callable()
            && !engine::is_forwarder(emit, Bun__Telemetry__callBound)
        {
            engine::assign(global, target, "emit", bind("emit", emit)?)?;
        }
        Ok(target)
    }

    /// As `AsyncLocalStorage.prototype.enterWith()`, until the token is disposed of.
    pub(crate) fn attach<'a>(
        &self,
        cx: &mut JsScope<'a>,
        context: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let context = Context::from_api(global, context.to_js())?;
        let token = ContextToken.into_js_wrapper(global).to_js();
        let displaced = context::active_binding(global).unwrap_or(JSValue::NULL);
        js_ContextToken::displaced_set_cached(token, global, displaced);
        engine::set_active_binding(global, Some(context));
        Ok(token)
    }

    pub(crate) fn enable<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        this_value
    }
}

pub(crate) fn call_bound<'a>(
    cx: &mut JsScope<'a>,
    this_value: JsLocal<'a>,
    callee: JsLocal<'a>,
    args: &[JsLocal<'a>],
) -> JsResult<JSValue> {
    // SAFETY: only `bind` makes a function of this body.
    let (function, context) = unsafe { engine::forwarder_parts(callee.to_js()) };
    call_with_binding(
        cx.global(),
        Some(context),
        function,
        this_value.to_js(),
        args,
    )
}

pub(crate) struct TextMapPropagator;

fn method(global: &JSGlobalObject, object: JSValue, name: &str) -> JsResult<Option<JSValue>> {
    if !object.is_object() {
        return Ok(None);
    }
    Ok(object.get(global, name)?.filter(|f| f.is_callable()))
}

/// Through the api's `TextMapSetter`, a `set()` like that of `Headers`, or as a property.
fn set_header(
    global: &JSGlobalObject,
    carrier: JSValue,
    setter: JSValue,
    name: &'static str,
    value: &[u8],
) -> JsResult<()> {
    let value = bun_string_jsc::create_utf8_for_js(global, value)?;
    let key = BunString::static_(name).to_js(global)?;
    if let Some(set) = method(global, setter, "set")? {
        set.call_for_running_script(global, setter, &[carrier, key, value])?;
    } else if let Some(set) = method(global, carrier, "set")? {
        set.call_for_running_script(global, carrier, &[key, value])?;
    } else if carrier.is_object() {
        engine::assign(global, carrier, name, value)?;
    }
    Ok(())
}

/// The values of a repeated header are joined with commas.
fn get_header(
    global: &JSGlobalObject,
    carrier: JSValue,
    getter: JSValue,
    name: &'static str,
) -> JsResult<Vec<u8>> {
    let key = BunString::static_(name).to_js(global)?;
    let value = if let Some(get) = method(global, getter, "get")? {
        get.call_for_running_script(global, getter, &[carrier, key])?
    } else if let Some(get) = method(global, carrier, "get")? {
        get.call_for_running_script(global, carrier, &[key])?
    } else if carrier.is_object() {
        carrier.get(global, name)?.unwrap_or(JSValue::UNDEFINED)
    } else {
        JSValue::UNDEFINED
    };
    if value.is_string_literal() {
        return Ok(value.to_utf8(global)?.to_vec());
    }
    let mut joined = Vec::new();
    if value.is_array() {
        let mut values = JSArrayIterator::init(value, global)?;
        while let Some(value) = values.next()? {
            if !joined.is_empty() {
                joined.push(b',');
            }
            joined.extend_from_slice(&value.to_utf8(global)?);
        }
    }
    Ok(joined)
}

impl TextMapPropagator {
    pub(crate) fn fields(&self) -> impl Iterator<Item = &'static str> {
        let state = bun_telemetry::state();
        [
            ("traceparent", state.propagate_trace_context),
            ("tracestate", state.propagate_trace_context),
            ("baggage", state.propagate_baggage),
        ]
        .into_iter()
        .filter_map(|(name, is_propagated)| is_propagated.then_some(name))
    }

    pub(crate) fn inject<'a>(
        &self,
        cx: &mut JsScope<'a>,
        context: JsLocal<'a>,
        carrier: JsLocal<'a>,
        setter: JsLocal<'a>,
    ) -> JsResult<()> {
        let (global, carrier, setter) = (cx.global(), carrier.to_js(), setter.to_js());
        let binding = match context.to_js() {
            absent if absent.is_undefined_or_null() => context::active_binding(global),
            context => Some(Context::from_api(global, context)?),
        };
        let binding = Binding::of(&binding);
        if binding.suppresses_tracing() {
            return Ok(());
        }
        let parent = binding.parent();
        let (trace_state, carried_baggage) = Carried::parts(&parent.carried);
        let state = bun_telemetry::state();
        if state.propagate_trace_context
            && let Some(ctx) = &parent.ctx
        {
            let traceparent = propagation::format_traceparent(ctx);
            set_header(global, carrier, setter, "traceparent", &traceparent)?;
            if !trace_state.is_empty() {
                set_header(global, carrier, setter, "tracestate", trace_state)?;
            }
        }
        let baggage = binding.baggage().unwrap_or(carried_baggage);
        if state.propagate_baggage && propagation::baggage_is_reasonable(baggage) {
            set_header(global, carrier, setter, "baggage", baggage)?;
        }
        Ok(())
    }

    pub(crate) fn extract<'a>(
        &self,
        cx: &mut JsScope<'a>,
        context: JsLocal<'a>,
        carrier: JsLocal<'a>,
        getter: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (global, carrier, getter) = (cx.global(), carrier.to_js(), getter.to_js());
        let Some(keys) = VmState::get(global).map(VmState::keys) else {
            return Ok(context.to_js());
        };
        let given = Context::from_api(global, context.to_js())?;
        let mut extracted = given;
        let mut set = |key: JSValue, value: JSValue| -> JsResult<()> {
            let native = extracted.as_class_ref::<Context>().expect("one of ours");
            let next = native.with_value(global, extracted, key, value)?;
            drop(native);
            extracted = next;
            Ok(())
        };
        let state = bun_telemetry::state();
        if state.propagate_trace_context
            && let Some(remote) =
                propagation::parse_traceparent(&get_header(global, carrier, getter, "traceparent")?)
        {
            let trace_state = get_header(global, carrier, getter, "tracestate")?;
            let trace_state = propagation::tracestate_bounded(&trace_state).unwrap_or_default();
            let data = SpanData::new(
                SpanStub::carrier(remote, true),
                Carried::new(trace_state, b""),
            );
            set(keys.span.get(), Span::create(global, data, None))?;
        }
        if state.propagate_baggage
            && let Some(baggage) = Baggage::parse(&get_header(global, carrier, getter, "baggage")?)
        {
            set(keys.baggage.get(), baggage.into_js_wrapper(global).to_js())?;
        }
        if extracted == given && Context::is_api_context(global, context.to_js())? {
            return Ok(context.to_js());
        }
        Ok(extracted)
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Telemetry__isEnabled() -> bool {
    bun_telemetry::any_enabled()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Telemetry__createRootContext(global: &JSGlobalObject) -> JSValue {
    Context::create_root(global)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Telemetry__createTracerProvider(global: &JSGlobalObject) -> JSValue {
    TracerProvider.into_js_wrapper(global).to_js()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Telemetry__createContextManager(global: &JSGlobalObject) -> JSValue {
    ContextManager.into_js_wrapper(global).to_js()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Telemetry__createPropagator(global: &JSGlobalObject) -> JSValue {
    TextMapPropagator.into_js_wrapper(global).to_js()
}
