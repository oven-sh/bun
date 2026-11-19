//! `@opentelemetry/api`'s `Context`, and what a span starts under.

use std::sync::Arc;

use bun_jsc::bindgen::{JsLocal, JsPayload, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, MarkedArgumentBuffer, WrapperGuard};
use bun_telemetry::{Carried, SpanContext, SpanData, SpanStub};

use crate::baggage::Baggage;
use crate::engine::{self, PlainArray};
use crate::generated_bindgen::telemetry::{SpanContextInit, js_TelemetryContext as js};
use crate::span::Span;
use crate::state::VmState;
use crate::values::trace_state_header;

#[derive(Clone, Default)]
enum BaggageRule {
    /// What the span's trace arrived with.
    #[default]
    Carried,
    /// What the trace of a span that has been replaced arrived with.
    Inherited(Option<Arc<Carried>>),
    Header(Arc<[u8]>),
}

/// The fields of the object: `span` is the value of the span key and `nativeSpan` the [`Span`] that stands for it,
/// `entries` is `[key, value, ..]` for the other keys, and `foreign` answers for the keys that have no entry.
#[derive(Clone, Default)]
pub(crate) struct Context {
    baggage: BaggageRule,
    suppresses_tracing: bool,
    /// Script knows this context as `foreign`.
    is_stand_in: bool,
    /// See [`active_binding`].
    is_left_when_ended: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Bound {
    ForScope,
    /// By `enter()`.
    UntilEnded,
}

#[derive(Clone, Copy, Default)]
struct Fields {
    span: Option<JSValue>,
    native_span: Option<JSValue>,
    foreign: Option<JSValue>,
    entries: Option<JSValue>,
}

impl Fields {
    fn of(context: JSValue) -> Fields {
        Fields {
            span: js::span_get_cached(context),
            native_span: js::native_span_get_cached(context),
            foreign: js::foreign_get_cached(context),
            entries: js::entries_get_cached(context),
        }
    }

    fn entry(&self, key: JSValue) -> Option<JSValue> {
        let entries = PlainArray::new(self.entries?)?;
        let at = (0..entries.len())
            .step_by(2)
            .find(|&i| entries.get(i) == Some(key))?;
        entries.get(at + 1)
    }

    fn with_entry(self, global: &JSGlobalObject, key: JSValue, value: JSValue) -> JsResult<Fields> {
        let entries = MarkedArgumentBuffer::new(|list| {
            if let Some(entries) = self.entries.and_then(PlainArray::new) {
                for i in (0..entries.len()).step_by(2) {
                    if let (Some(k), Some(v)) = (entries.get(i), entries.get(i + 1))
                        && k != key
                    {
                        list.append(k);
                        list.append(v);
                    }
                }
            }
            list.append(key);
            list.append(value);
            list.construct_array(global)
        })?;
        Ok(Fields {
            entries: Some(entries),
            ..self
        })
    }
}

fn get_foreign_value(global: &JSGlobalObject, foreign: JSValue, key: JSValue) -> JsResult<JSValue> {
    match foreign.get(global, "getValue")? {
        Some(get_value) => get_value.call_for_running_script(global, foreign, &[key]),
        None => Ok(JSValue::UNDEFINED),
    }
}

impl Context {
    fn create(self, global: &JSGlobalObject, fields: Fields) -> JSValue {
        let context = self.into_js_wrapper(global).to_js();
        let set = |setter: fn(JSValue, &JSGlobalObject, JSValue), value: Option<JSValue>| {
            if let Some(value) = value {
                setter(context, global, value);
            }
        };
        set(js::span_set_cached, fields.span);
        set(js::native_span_set_cached, fields.native_span);
        set(js::foreign_set_cached, fields.foreign);
        set(js::entries_set_cached, fields.entries);
        context
    }

    pub(crate) fn create_root(global: &JSGlobalObject) -> JSValue {
        Context::default().create(global, Fields::default())
    }

    /// Under it no span starts.
    pub(crate) fn create_suppressing(global: &JSGlobalObject) -> JSValue {
        let context = Context {
            suppresses_tracing: true,
            ..Context::default()
        };
        context.create(global, Fields::default())
    }

    fn derive(&self) -> Context {
        Context {
            is_stand_in: false,
            is_left_when_ended: false,
            ..self.clone()
        }
    }

    /// For a context whose span `replaced` makes way for another.
    fn keeping_baggage_of(mut self, replaced: Option<JSValue>) -> Context {
        if let (BaggageRule::Carried, Some(replaced)) = (&self.baggage, replaced) {
            let replaced = Span::of(&replaced);
            if !replaced.data().baggage().is_empty() {
                self.baggage = BaggageRule::Inherited(replaced.data().carried.clone());
            }
        }
        self
    }

    pub(crate) fn is_api_context(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        Ok(value.is::<Context>()
            || (value.is_object()
                && value
                    .get(global, "getValue")?
                    .is_some_and(JSValue::is_callable)))
    }

    /// `value` if it is one of ours, or else one that stands in for it. What is no context counts as the root.
    pub(crate) fn from_api(global: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        if value.is::<Context>() {
            return Ok(value);
        }
        let Some(state) = VmState::get(global) else {
            return Ok(Context::create_root(global));
        };
        if !Context::is_api_context(global, value)? {
            return state.root_context(global);
        }
        let keys = state.keys();
        let span = get_foreign_value(global, value, keys.span.get())?;
        let native_span = native_span_for(global, span)?;
        let baggage = get_foreign_value(global, value, keys.baggage.get())?;
        let context = Context {
            baggage: if baggage.is_undefined_or_null() {
                BaggageRule::Carried
            } else {
                BaggageRule::Header(Baggage::header_of(global, baggage)?.into())
            },
            suppresses_tracing: get_foreign_value(global, value, keys.suppress_tracing.get())?
                == JSValue::TRUE,
            is_stand_in: true,
            is_left_when_ended: false,
        };
        let fields = Fields {
            span: Some(span).filter(|span| !span.is_undefined()),
            native_span,
            foreign: Some(value),
            entries: None,
        };
        Ok(context.create(global, fields))
    }

    /// `context.active()`
    pub(crate) fn active(global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some(binding) = active_binding(global) else {
            return match VmState::get(global) {
                Some(state) => state.root_context(global),
                None => Ok(Context::create_root(global)),
            };
        };
        match binding.as_class_ref::<Context>() {
            Some(context) if context.is_stand_in => {
                Ok(js::foreign_get_cached(binding).expect("what it stands in for"))
            }
            Some(_) => Ok(binding),
            None => {
                if let Some(context) = engine::context_kept_for(global, binding) {
                    return Ok(context);
                }
                Span::hand_to_script(binding);
                let fields = Fields {
                    span: Some(binding),
                    native_span: Some(binding),
                    ..Fields::default()
                };
                let context = Context::default().create(global, fields);
                engine::keep_context_for(global, binding, context);
                Ok(context)
            }
        }
    }

    /// As [`bind_span`](Self::bind_span). A span without ids, where nothing is active, needs no binding.
    #[inline]
    pub(crate) fn bind_new_span(
        global: &JSGlobalObject,
        span: JSValue,
        under: Option<JSValue>,
        how: Bound,
    ) -> Option<JSValue> {
        (under.is_some() || Span::of(&span).data().stub.ctx.is_valid())
            .then(|| Context::bind_span(global, span, under, how))
    }

    /// The binding that makes `span` active and keeps the other values of `under`.
    #[inline]
    pub(crate) fn bind_span(
        global: &JSGlobalObject,
        span: JSValue,
        under: Option<JSValue>,
        how: Bound,
    ) -> JSValue {
        let (context, fields, replaced) = match under.as_ref().and_then(js::from_js) {
            Some(context) => {
                let fields = Fields::of(context.to_js());
                (context.derive(), fields, fields.native_span)
            }
            None => (Context::default(), Fields::default(), under),
        };
        // A child has the baggage of its parent.
        let replaced = replaced
            .filter(|old| Span::of(old).data().baggage() != Span::of(&span).data().baggage());
        let mut context = context.keeping_baggage_of(replaced);
        context.is_left_when_ended = how == Bound::UntilEnded;
        if fields.foreign.is_none()
            && fields.entries.is_none()
            && !context.suppresses_tracing
            && matches!(context.baggage, BaggageRule::Carried)
            && (how == Bound::UntilEnded || !Span::has_entered(span))
        {
            return span;
        }
        let fields = Fields {
            span: Some(span),
            native_span: Some(span),
            ..fields
        };
        context.create(global, fields)
    }

    pub(crate) fn get_value<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        key: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (global, key) = (cx.global(), key.to_js());
        let fields = Fields::of(this_value.to_js());
        let keys = VmState::get(global).map(VmState::keys);
        if keys.is_some_and(|keys| key == keys.span.get()) {
            return Ok(fields.span.unwrap_or(JSValue::UNDEFINED));
        }
        if let Some(value) = fields.entry(key) {
            return Ok(value);
        }
        if self.suppresses_tracing && keys.is_some_and(|keys| key == keys.suppress_tracing.get()) {
            return Ok(JSValue::TRUE);
        }
        if keys.is_some_and(|keys| key == keys.baggage.get()) {
            let arrived = match &self.baggage {
                BaggageRule::Carried => Some(
                    (fields.native_span)
                        .and_then(|s| Baggage::parse(Span::of(&s).data().baggage())),
                ),
                BaggageRule::Inherited(carried) => Some(Baggage::parse(Carried::parts(carried).1)),
                BaggageRule::Header(_) => None,
            };
            if let Some(arrived) = arrived {
                return Ok(
                    arrived.map_or(JSValue::UNDEFINED, |b| b.into_js_wrapper(global).to_js())
                );
            }
        }
        match fields.foreign {
            Some(foreign) => get_foreign_value(global, foreign, key),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn set_value<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        key: JsLocal<'a>,
        value: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        self.with_value(cx.global(), this_value.to_js(), key.to_js(), value.to_js())
    }

    pub(crate) fn delete_value<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        key: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        // An entry, to hide what `foreign` or the span would answer.
        let (this_value, key) = (this_value.to_js(), key.to_js());
        self.with_value(cx.global(), this_value, key, JSValue::UNDEFINED)
    }

    pub(crate) fn with_value(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        key: JSValue,
        value: JSValue,
    ) -> JsResult<JSValue> {
        let fields = Fields::of(this_value);
        let mut context = self.derive();
        if let Some(keys) = VmState::get(global).map(VmState::keys) {
            if key == keys.span.get() {
                let context = context.keeping_baggage_of(fields.native_span);
                let fields = Fields {
                    span: Some(value).filter(|span| !span.is_undefined()),
                    native_span: native_span_for(global, value)?,
                    ..fields
                };
                return Ok(context.create(global, fields));
            }
            if key == keys.baggage.get() {
                context.baggage = BaggageRule::Header(Baggage::header_of(global, value)?.into());
            } else if key == keys.suppress_tracing.get() {
                context.suppresses_tracing = value == JSValue::TRUE;
            }
        }
        Ok(context.create(global, fields.with_entry(global, key, value)?))
    }
}

/// The [`Span`] for an api `Span` or `SpanContext`: itself, or one that carries its ids.
pub(crate) fn native_span_for(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<JSValue>> {
    if value.is::<Span>() {
        return Ok(Some(value));
    }
    if !value.is_object() {
        return Ok(None);
    }
    let span_context = match value.get(global, "spanContext")? {
        Some(f) if f.is_callable() => f.call_for_running_script(global, value, &[])?,
        _ => value,
    };
    SpanContextInit::from_js(global, span_context, |init| {
        let Some(ids) = init.ids() else {
            return Ok(None);
        };
        let trace_state = trace_state_header(global, init.trace_state.to_js())?;
        let stub = SpanStub::carrier(ids, init.is_remote.unwrap_or(false));
        let data = SpanData::new(stub, Carried::new(&trace_state, b""));
        Ok(Some(Span::create(global, data, None)))
    })
}

/// The active `Span` or `Context`. A span that entered itself has left once it has ended, also where it was not the
/// active one then: in the caller of the async function that entered it.
#[inline]
pub(crate) fn active_binding(global: &JSGlobalObject) -> Option<JSValue> {
    let mut binding = engine::binding_in_place(global);
    while let Some(displaced) = Binding::of(&binding).displaced_if_left() {
        binding = Some(displaced).filter(|b| !b.is_null());
    }
    binding
}

/// A view of a binding.
pub(crate) struct Binding<'a> {
    span: Option<JSValue>,
    context: Option<WrapperGuard<'a, Context>>,
}

impl<'a> Binding<'a> {
    #[inline]
    pub(crate) fn of(binding: &'a Option<JSValue>) -> Binding<'a> {
        let context = binding.as_ref().and_then(js::from_js);
        let span = match context {
            Some(_) => binding.and_then(js::native_span_get_cached),
            None => *binding,
        };
        Binding { span, context }
    }

    #[inline]
    pub(crate) fn span(&self) -> Option<JSValue> {
        self.span
    }

    #[inline]
    fn displaced_if_left(&self) -> Option<JSValue> {
        let displaced = Span::displaced_if_ended(self.span?)?;
        (self.context.as_ref())
            .is_none_or(|c| c.is_left_when_ended)
            .then_some(displaced)
    }

    #[inline]
    pub(crate) fn suppresses_tracing(&self) -> bool {
        self.context.as_ref().is_some_and(|c| c.suppresses_tracing)
    }

    #[inline]
    pub(crate) fn parent(&self) -> Parent {
        let Some(span) = self.span.as_ref().and_then(JSValue::as_class_ref::<Span>) else {
            return Parent::default();
        };
        let data = span.data();
        Parent {
            ctx: Some(data.stub.ctx).filter(SpanContext::is_valid),
            carried: data.carried.clone(),
        }
    }

    /// The `baggage` header, if the context has a say in it.
    pub(crate) fn baggage(&self) -> Option<&[u8]> {
        match &self.context.as_ref()?.baggage {
            BaggageRule::Carried => None,
            BaggageRule::Inherited(carried) => Some(Carried::parts(carried).1),
            BaggageRule::Header(header) => Some(header),
        }
    }
}

#[derive(Default)]
pub(crate) struct Parent {
    pub(crate) ctx: Option<SpanContext>,
    pub(crate) carried: Option<Arc<Carried>>,
}
