use bun_jsc::bindgen::{JsLocal, JsPayload, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_telemetry::{Carried, Instrument, ScopeId, SpanData, SpanKind, SpanStub, clock, processor};

use crate::context::{self, Binding, Bound, Context, native_span_for};
use crate::engine::Entered;
use crate::generated_bindgen::telemetry::{SpanKindInput, SpanOptions, js_Tracer as js};
use crate::span::Span;
use crate::state::VmState;
use crate::values;

pub(crate) struct Tracer(ScopeId);

#[derive(Clone, Copy)]
struct Start {
    scope: ScopeId,
    kind: SpanKind,
    /// 0 is now.
    start_ns: u64,
    is_root: bool,
}

#[inline]
#[optimize(speed)]
fn start(global: &JSGlobalObject, name: JSValue, under: &Option<JSValue>, how: Start) -> JSValue {
    let binding = Binding::of(under);
    let mut parent = binding.parent();
    if how.is_root || binding.suppresses_tracing() {
        parent.ctx = None;
        parent.carried = Carried::new(b"", Carried::parts(&parent.carried).1);
    }
    let records = bun_telemetry::enabled(Instrument::User) && !binding.suppresses_tracing();
    let stub = match records.then(|| VmState::get(global)).flatten() {
        Some(state) => SpanStub::start(
            &mut state.local().rng,
            parent.ctx.as_ref(),
            &bun_telemetry::sampler(),
            how.scope,
            how.kind,
            clock::or_now(how.start_ns),
        ),
        // As the no-op tracer of @opentelemetry/api: it passes on the ids of its parent.
        None => {
            let ctx = parent.ctx.unwrap_or_default();
            SpanStub::carrier(ctx, ctx.flags.remote())
        }
    };
    Span::create(global, SpanData::new(stub, parent.carried), Some(name))
}

#[inline]
pub(crate) fn start_internal_span(
    global: &JSGlobalObject,
    scope: ScopeId,
    name: JSValue,
    under: &Option<JSValue>,
) -> JSValue {
    let how = Start {
        scope,
        kind: SpanKind::Internal,
        start_ns: 0,
        is_root: false,
    };
    start(global, name, under, how)
}

impl Tracer {
    pub(crate) fn get(
        global: &JSGlobalObject,
        name: JSValue,
        version: JSValue,
    ) -> JsResult<JSValue> {
        let text = |value: JSValue| match value.is_undefined_or_null() {
            true => Ok(bun_core::Utf8Bytes::EMPTY),
            false => value.to_utf8(global),
        };
        let (name, version) = (text(name)?, text(version)?);
        let default_name = Instrument::User.scope_name().as_bytes();
        let name: &[u8] = if name.is_empty() { default_name } else { &name };
        let scope = if name == default_name && version.is_empty() {
            ScopeId::USER
        } else {
            processor::global().register_scope(name, &version)
        };
        let create = || {
            let name = bun_string_jsc::create_utf8_for_js(global, name)?;
            let version = match version.is_empty() {
                true => JSValue::UNDEFINED,
                false => bun_string_jsc::create_utf8_for_js(global, &version)?,
            };
            let tracer = Tracer(scope).into_js_wrapper(global).to_js();
            js::name_set_cached(tracer, global, name);
            js::version_set_cached(tracer, global, version);
            Ok(tracer)
        };
        match VmState::get(global) {
            Some(state) => state.tracer(global, scope, create),
            None => create(),
        }
    }

    /// The span, and the binding whose other values stay active beside it.
    #[optimize(speed)]
    fn start_with_options(
        &self,
        global: &JSGlobalObject,
        name: JSValue,
        options: JSValue,
        context: JSValue,
    ) -> JsResult<(JSValue, Option<JSValue>)> {
        let name = match name.is_string_literal() {
            true => name,
            false => name.to_js_string(global)?.to_js(),
        };
        let context = match context.is_undefined_or_null() {
            true => None,
            false => Some(Context::from_api(global, context)?),
        };
        if options.is_undefined_or_null() {
            let under = context.or_else(|| context::active_binding(global));
            return Ok((start_internal_span(global, self.0, name, &under), under));
        }
        SpanOptions::from_js(global, options, |options| {
            let under = context.or_else(|| context::active_binding(global));
            let mut how = Start {
                scope: self.0,
                kind: match options.kind {
                    SpanKindInput::Number(kind) => SpanKind::from_api(kind as u8),
                    SpanKindInput::Name(ref name) => match &**name {
                        b"server" => SpanKind::Server,
                        b"client" => SpanKind::Client,
                        b"producer" => SpanKind::Producer,
                        b"consumer" => SpanKind::Consumer,
                        _ => SpanKind::Internal,
                    },
                    SpanKindInput::Ignored(_) => SpanKind::Internal,
                },
                start_ns: values::time_input(global, options.start_time.to_js()),
                is_root: options.root,
            };
            let mut starts_under = under;
            if context.is_none() && !options.parent.is_undefined() {
                match native_span_for(global, options.parent.to_js())? {
                    Some(parent) => {
                        starts_under =
                            Some(Context::bind_span(global, parent, under, Bound::ForScope))
                    }
                    None => how.is_root = true,
                }
            }
            let span = start(global, name, &starts_under, how);
            let native = Span::of(&span);
            if let Some(attributes) = options.attributes {
                native.put_attributes(global, attributes.to_js())?;
            }
            if let Some(links) = options.links {
                native.put_links(global, links.to_js())?;
            }
            Ok((span, under))
        })
    }

    pub(crate) fn start_span<'a>(
        &self,
        cx: &mut JsScope<'a>,
        name: JsLocal<'a>,
        options: JsLocal<'a>,
        context: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (name, options, context) = (name.to_js(), options.to_js(), context.to_js());
        Ok(self
            .start_with_options(cx.global(), name, options, context)?
            .0)
    }

    /// `(name, options?, context?, callback?)`
    pub(crate) fn start_active_span<'a>(
        &self,
        cx: &mut JsScope<'a>,
        name: JsLocal<'a>,
        first: JsLocal<'a>,
        second: JsLocal<'a>,
        third: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        const NONE: JSValue = JSValue::UNDEFINED;
        let global = cx.global();
        let (options, context, callback) = match (first.to_js(), second.to_js(), third.to_js()) {
            (callback, ..) if callback.is_callable() => (NONE, NONE, callback),
            (options, callback, _) if callback.is_callable() => (options, NONE, callback),
            all => all,
        };
        if !callback.is_undefined() && !callback.is_callable() {
            return Err(global.throw_invalid_argument_type_value("fn", "function", callback));
        }
        let (span, under) = self.start_with_options(global, name.to_js(), options, context)?;
        if callback.is_undefined() {
            Span::enter_under(global, span, under);
            return Ok(span);
        }
        let _entered = Entered::new(
            global,
            Context::bind_new_span(global, span, under, Bound::ForScope),
        );
        callback.call_for_running_script(global, NONE, &[span])
    }
}
