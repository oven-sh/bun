// Native OpenTelemetry: tracers, span creation (incl. the DOMJIT fast
// paths), startSpan option parsing, and the propagation glue used by
// internal/telemetry.ts and node:http.

#include "root.h"

#include "JSTelemetryTracer.h"
#include "JSTelemetrySpan.h"
#include "TelemetryContext.h"
#include "TelemetryInternal.h"
#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include <JavaScriptCore/DOMJITSignature.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {
using namespace JSC;

JSValue telemetryInternalFunction(Zig::GlobalObject* globalObject, const Identifier& name)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue moduleValue = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::InternalTelemetry);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue fn = moduleValue.getObject()->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(fn.isCallable());
    return fn;
}

// ─── span creation ───

// W3C tracestate/baggage travel with the span that received them so outgoing
// requests made under it can forward them. Only present when the incoming
// request carried the headers, so the common case creates nothing.
static void inheritPropagation(VM& vm, Zig::GlobalObject* globalObject, JSTelemetrySpan* child, uint64_t parentHandle, JSTelemetrySpan* parentCell)
{
    using Field = JSTelemetrySpan::Field;
    if (parentCell && !parentCell->m_native) {
        if (JSString* s = parentCell->string(Field::TraceState))
            child->field(Field::TraceState).set(vm, child, s);
        if (JSString* s = parentCell->string(Field::Baggage))
            child->field(Field::Baggage).set(vm, child, s);
        return;
    }
    uint64_t handle = parentCell ? parentCell->m_native : parentHandle;
    if (!handle)
        return;
    BunString traceState, baggage;
    if (!Bun__Telemetry__nativePropagation(globalObject, handle, &traceState, &baggage))
        return;
    if (auto s = traceState.transferToWTFString(); !s.isEmpty())
        child->field(Field::TraceState).set(vm, child, jsString(vm, WTF::move(s)));
    if (auto s = baggage.transferToWTFString(); !s.isEmpty())
        child->field(Field::Baggage).set(vm, child, jsString(vm, WTF::move(s)));
}

// New span under the active span (both DOMJIT create paths land here).
static ALWAYS_INLINE JSTelemetrySpan* telemetryCreateSpan(Zig::GlobalObject* globalObject, uint16_t scopeId, uint8_t kind, JSString* name)
{
    auto& vm = globalObject->vm();
    auto active = TelemetryContextSlot::current(globalObject);
    JSTelemetrySpan* parentCell = toTelemetrySpan(active.header);
    uint64_t parentHandle = active.poolHandle();
    const TelemetrySpanStub* parent = parentCell ? &parentCell->m_stub : parentHandle ? Bun__Telemetry__poolStub(globalObject, parentHandle)
                                                                                      : nullptr;
    TelemetrySpanStub stub;
    Bun__Telemetry__stubStart(globalObject, &stub, parent, 0);
    auto* span = JSTelemetrySpan::create(vm, globalObject, stub, scopeId, kind, name, 0);
    if (parent)
        inheritPropagation(vm, globalObject, span, parentHandle, parentCell);
    return span;
}

// startSpan's `parent`: undefined → the active span; null → none (new root);
// one of our spans → it; anything else span-like (api Span, SpanContext) →
// a non-recording carrier made by internal/telemetry.ts toNativeSpan.
static JSTelemetrySpan* resolveParent(Zig::GlobalObject* globalObject, JSValue parent)
{
    if (parent.isUndefined())
        return toTelemetrySpan(JSValue::decode(Bun__Telemetry__activeSpanCell(globalObject)));
    if (parent.isNull())
        return nullptr;
    if (auto* cell = toTelemetrySpan(parent))
        return cell;
    if (!parent.isObject())
        return nullptr;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue toNativeSpan = telemetryInternalFunction(globalObject, WebCore::builtinNames(vm).toNativeSpanPublicName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    MarkedArgumentBuffer args;
    args.append(parent);
    JSValue wrapped = call(globalObject, toNativeSpan, jsUndefined(), args, "toNativeSpan"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return toTelemetrySpan(wrapped);
}

// api Context → [span | undefined, extras | undefined] via internal/telemetry.ts unpackContext.
static std::pair<JSValue, JSValue> unpackContext(Zig::GlobalObject* globalObject, JSValue context)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue fn = telemetryInternalFunction(globalObject, WebCore::builtinNames(vm).unpackContextPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer args;
    args.append(context);
    JSValue pair = call(globalObject, fn, jsUndefined(), args, "unpackContext"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue span = pair.get(globalObject, 0u);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue extras = pair.get(globalObject, 1u);
    RETURN_IF_EXCEPTION(scope, {});
    return { span, extras };
}

// Call one of the span's builtin methods (setAttributes / addLinks) with `arg`.
static void callSpanBuiltin(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, const Identifier& name, JSValue arg)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue fn = span->getPrototypeDirect().getObject()->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, );
    MarkedArgumentBuffer args;
    args.append(arg);
    call(globalObject, fn, span, args, ""_s);
    RETURN_IF_EXCEPTION(scope, );
}

// startSpan(name, { kind, attributes, links, startTime, root, parent }?, context?)
static JSTelemetrySpan* tracerStartSpan(Zig::GlobalObject* globalObject, JSTelemetryTracer* tracer, JSValue nameValue, JSValue options, JSValue context, JSValue* extrasOut)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* name = nameValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (options.isUndefinedOrNull() && context.isUndefined())
        return telemetryCreateSpan(globalObject, tracer->m_scope, 0, name);

    auto& names = WebCore::builtinNames(vm);
    JSObject* opts = options.isObject() ? options.getObject() : nullptr;
    auto option = [&](const Identifier& id) -> JSValue {
        return opts ? opts->get(globalObject, id) : jsUndefined();
    };

    JSValue root = option(names.rootPublicName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue explicitParent = option(names.parentPublicName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue kind = option(names.kindPublicName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue startTime = option(names.startTimePublicName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue attributes = option(names.attributesPublicName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue links = option(names.linksPublicName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    bool isRoot = root.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSValue parent = jsUndefined();
    if (isRoot) {
        parent = jsNull();
    } else if (!context.isUndefined()) {
        auto [span, extras] = unpackContext(globalObject, context);
        RETURN_IF_EXCEPTION(scope, nullptr);
        parent = span.isUndefinedOrNull() ? jsNull() : span;
        if (extrasOut)
            *extrasOut = extras;
    } else if (!explicitParent.isUndefined()) {
        parent = explicitParent;
    }
    JSTelemetrySpan* parentCell = resolveParent(globalObject, parent);
    RETURN_IF_EXCEPTION(scope, nullptr);

    TelemetrySpanStub stub;
    Bun__Telemetry__stubStart(globalObject, &stub, parentCell ? &parentCell->m_stub : nullptr, telemetryTimeInputToNs(startTime));
    auto* span = JSTelemetrySpan::create(vm, globalObject, stub, tracer->m_scope, telemetryApiKind(kind), name, 0);
    inheritPropagation(vm, globalObject, span, 0, parentCell);

    if (attributes.isObject()) {
        callSpanBuiltin(globalObject, span, names.setAttributesPublicName(), attributes);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (links.isObject()) {
        callSpanBuiltin(globalObject, span, names.addLinksPublicName(), links);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return span;
}

// ─── JSTelemetryTracer ───

JSC_DECLARE_HOST_FUNCTION(jsTelemetryTracerStartSpan);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryTracerStartActiveSpan);
JSC_DECLARE_JIT_OPERATION(telemetryTracerStartSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject*, JSTelemetryTracer*, JSString*));

// startSpan(name, options?, context?)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryTracerStartSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* tracer = dynamicDowncast<JSTelemetryTracer>(callFrame->thisValue());
    if (!tracer) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "not a Tracer"_s);
    auto* span = tracerStartSpan(globalObject, tracer, callFrame->argument(0), callFrame->argument(1), callFrame->argument(2), nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(span);
}

// DFG/FTL call `startSpan(name)` (one string argument) through this directly.
JSC_DEFINE_JIT_OPERATION(telemetryTracerStartSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject * lexicalGlobalObject, JSTelemetryTracer* tracer, JSString* name))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracerFrame(vm, callFrame);
    return { JSValue::encode(telemetryCreateSpan(defaultGlobalObject(lexicalGlobalObject), tracer->m_scope, 0, name)) };
}

static const JSC::DOMJIT::Signature signatureTelemetryTracerStartSpan(
    telemetryTracerStartSpanWithoutTypeCheck,
    JSTelemetryTracer::info(),
    JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    SpecObjectOther,
    SpecString);

// startActiveSpan(name, [options], [context], fn) — or, without fn, an
// activated span for `using`.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryTracerStartActiveSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* tracer = dynamicDowncast<JSTelemetryTracer>(callFrame->thisValue());
    if (!tracer) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "not a Tracer"_s);
    JSValue a = callFrame->argument(1), b = callFrame->argument(2), c = callFrame->argument(3);
    JSValue options = jsUndefined(), context = jsUndefined(), fn = jsUndefined();
    if (a.isCallable())
        fn = a;
    else if (b.isCallable()) {
        options = a;
        fn = b;
    } else if (c.isCallable()) {
        options = a;
        context = b;
        fn = c;
    } else {
        options = a;
        context = b;
    }
    JSValue extras;
    auto* span = tracerStartSpan(globalObject, tracer, callFrame->argument(0), options, context, &extras);
    RETURN_IF_EXCEPTION(scope, {});
    // `extras` is empty when no Context was passed (keep the ambient ones),
    // else the Context's extras or null (replace them).
    JSValue prev = JSValue::decode(Bun__Telemetry__enterWithExtras(globalObject, JSValue::encode(span), JSValue::encode(extras)));
    if (fn.isUndefined()) {
        // `using span = tracer.startActiveSpan(...)`
        span->field(JSTelemetrySpan::Field::Restore).set(vm, span, prev ? prev : jsUndefined());
        return JSValue::encode(span);
    }
    MarkedArgumentBuffer args;
    args.append(span);
    JSValue result = call(globalObject, fn, jsUndefined(), args, "startActiveSpan"_s);
    Bun__Telemetry__exit(globalObject, JSValue::encode(prev));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

const ClassInfo JSTelemetryTracer::s_info = { "Tracer"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetryTracer) };

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSTelemetryTracer::subspaceFor(VM& vm)
{
    return WebCore::subspaceForImpl<JSTelemetryTracer, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSTelemetryTracer, m_subspaceForJSTelemetryTracer));
}

JSTelemetryTracer* JSTelemetryTracer::create(VM& vm, Zig::GlobalObject* globalObject, uint16_t scopeId, JSValue name, JSValue version)
{
    auto& names = WebCore::builtinNames(vm);
    // One structure per tracer is fine: tracers are long-lived singletons per library.
    Structure* structure = Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    auto* tracer = new (NotNull, allocateCell<JSTelemetryTracer>(vm)) JSTelemetryTracer(vm, structure);
    tracer->finishCreation(vm);
    tracer->m_scope = scopeId;
    tracer->putDirectNativeFunction(vm, globalObject, names.startSpanPublicName(), 1, jsTelemetryTracerStartSpan, ImplementationVisibility::Public, NoIntrinsic, &signatureTelemetryTracerStartSpan, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    tracer->putDirectNativeFunction(vm, globalObject, names.startActiveSpanPublicName(), 2, jsTelemetryTracerStartActiveSpan, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    tracer->putDirect(vm, vm.propertyNames->name, name, static_cast<unsigned>(PropertyAttribute::ReadOnly));
    tracer->putDirect(vm, names.versionPublicName(), version, static_cast<unsigned>(PropertyAttribute::ReadOnly));
    return tracer;
}

// createTracer(scopeId, name, version)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryCreateTracer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSValue::encode(JSTelemetryTracer::create(globalObject->vm(), globalObject, telemetryScopeId(callFrame->argument(0)), callFrame->argument(1), callFrame->argument(2)));
}

// ─── JSTelemetryBinding: `createSpan(scopeKind, name)` fast path (CallDOM) ───
//
// scopeKind = scope << 3 | kind. Parent is the active span.

JSC_DECLARE_HOST_FUNCTION(jsTelemetryBindingCreateSpan);
JSC_DECLARE_JIT_OPERATION(telemetryBindingCreateSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject*, JSTelemetryBinding*, int32_t, JSString*));

JSC_DEFINE_HOST_FUNCTION(jsTelemetryBindingCreateSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    int32_t scopeKind = callFrame->argument(0).isInt32() ? callFrame->argument(0).asInt32() : (Bun__Telemetry__userScope() << 3);
    JSString* name = callFrame->argument(1).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(telemetryCreateSpan(globalObject, static_cast<uint16_t>(scopeKind >> 3), static_cast<uint8_t>(scopeKind & 7), name));
}

JSC_DEFINE_JIT_OPERATION(telemetryBindingCreateSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject * lexicalGlobalObject, JSTelemetryBinding*, int32_t scopeKind, JSString* name))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return { JSValue::encode(telemetryCreateSpan(defaultGlobalObject(lexicalGlobalObject), static_cast<uint16_t>(scopeKind >> 3), static_cast<uint8_t>(scopeKind & 7), name)) };
}

const ClassInfo JSTelemetryBinding::s_info = { "TelemetryBinding"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetryBinding) };

static const JSC::DOMJIT::Signature signatureTelemetryBindingCreateSpan(
    telemetryBindingCreateSpanWithoutTypeCheck,
    JSTelemetryBinding::info(),
    JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    SpecObjectOther,
    SpecInt32Only,
    SpecString);

JSTelemetryBinding* JSTelemetryBinding::create(VM& vm, Zig::GlobalObject* globalObject)
{
    Structure* structure = Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    auto* binding = new (NotNull, allocateCell<JSTelemetryBinding>(vm)) JSTelemetryBinding(vm, structure);
    binding->finishCreation(vm);
    binding->putDirectNativeFunction(vm, globalObject, WebCore::builtinNames(vm).createSpanPublicName(), 2, jsTelemetryBindingCreateSpan, ImplementationVisibility::Public, NoIntrinsic, &signatureTelemetryBindingCreateSpan, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    return binding;
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetryCreateBinding, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSValue::encode(JSTelemetryBinding::create(globalObject->vm(), globalObject));
}

// ─── carriers for foreign / remote span contexts ───

static JSTelemetrySpan* createCarrier(Zig::GlobalObject* globalObject, const TelemetrySpanStub& stub, JSValue traceState)
{
    auto& vm = globalObject->vm();
    auto* span = JSTelemetrySpan::create(vm, globalObject, stub, Bun__Telemetry__userScope(), 0, jsEmptyString(vm), 0);
    if (traceState.isString() && asString(traceState)->length())
        span->field(JSTelemetrySpan::Field::TraceState).set(vm, span, telemetryResolve(asString(traceState)));
    return span;
}

// wrapSpanContext(traceId?, spanId?, traceFlags?, isRemote?, traceState?) —
// a non-recording span carrying that context (all-invalid ids when omitted).
JSC_DEFINE_HOST_FUNCTION(jsTelemetryWrapSpanContext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue traceId = callFrame->argument(0), spanId = callFrame->argument(1), traceFlags = callFrame->argument(2), isRemote = callFrame->argument(3);
    TelemetrySpanStub stub {};
    stub.startNs = 1;
    stub.flags = TelemetrySpanStub::NonRecording;
    if (traceId.isString() && spanId.isString()) {
        BunString t = telemetryBorrow(asString(traceId));
        BunString s = telemetryBorrow(asString(spanId));
        Bun__Telemetry__stubFromHexIds(&stub, &t, &s, traceFlags.isNumber() ? static_cast<uint8_t>(traceFlags.asNumber()) : TelemetrySpanStub::Sampled, isRemote.isBoolean() ? isRemote.asBoolean() : true);
    }
    return JSValue::encode(createCarrier(globalObject, stub, callFrame->argument(4)));
}

// parseTraceparent(traceparent, tracestate?) — remote carrier, or undefined if the header is invalid.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryParseTraceparent, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue header = callFrame->argument(0);
    if (!header.isString())
        return JSValue::encode(jsUndefined());
    BunString h = telemetryBorrow(asString(header));
    TelemetrySpanStub stub;
    if (!Bun__Telemetry__parseTraceparent(&h, &stub))
        return JSValue::encode(jsUndefined());
    return JSValue::encode(createCarrier(globalObject, stub, callFrame->argument(1)));
}

// startInstrumentSpan(instrument, name, kind) — native-owned span for a
// JS-implemented built-in instrumentation (node:http client).
JSC_DEFINE_HOST_FUNCTION(jsTelemetryStartInstrumentSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue instrument = callFrame->argument(0), name = callFrame->argument(1);
    if (!instrument.isInt32() || !name.isString())
        return JSValue::encode(jsUndefined());
    BunString n = telemetryBorrow(asString(name));
    return Bun__Telemetry__startInstrumentSpan(globalObject, static_cast<uint32_t>(instrument.asInt32()), &n, telemetryApiKind(callFrame->argument(2)));
}

// propagationHeaders(span) → [traceparent?, tracestate?, baggage?], honouring OTEL_PROPAGATORS.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryPropagationHeaders, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* out = constructEmptyArray(globalObject, nullptr, 3);
    RETURN_IF_EXCEPTION(scope, {});
    auto* span = toTelemetrySpan(callFrame->argument(0));
    if (!span)
        return JSValue::encode(out);
    uint32_t flags = Bun__Telemetry__propagationFlags();
    static constexpr uint8_t zero[16] = {};
    if ((flags & 1) && memcmp(span->m_stub.traceId, zero, 16)) {
        std::span<Latin1Character> buf;
        auto traceparent = WTF::String::createUninitialized(55, buf);
        Bun__Telemetry__formatTraceparent(&span->m_stub, buf.data());
        out->putDirectIndex(globalObject, 0, jsString(vm, WTF::move(traceparent)));
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue traceState, baggage;
    if (span->m_native) {
        BunString ts, bg;
        if (Bun__Telemetry__nativePropagation(globalObject, span->m_native, &ts, &bg)) {
            traceState = jsString(vm, ts.transferToWTFString());
            baggage = jsString(vm, bg.transferToWTFString());
        }
    } else {
        traceState = span->string(JSTelemetrySpan::Field::TraceState);
        baggage = span->string(JSTelemetrySpan::Field::Baggage);
    }
    if ((flags & 1) && traceState && asString(traceState)->length()) {
        out->putDirectIndex(globalObject, 1, traceState);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if ((flags & 2) && baggage && asString(baggage)->length()) {
        out->putDirectIndex(globalObject, 2, baggage);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(out);
}

} // namespace Bun

/// Pre-populate the @opentelemetry/api global registry with the native
/// provider (internal/telemetry.ts installGlobal). Runs during VM setup /
/// Bun.otel.start(); a failure is reported like any other uncaught error.
extern "C" void Bun__Telemetry__installApiGlobal(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSValue install = Bun::telemetryInternalFunction(globalObject, WebCore::builtinNames(vm).installGlobalPublicName());
    if (!scope.exception()) {
        JSC::MarkedArgumentBuffer args;
        JSC::call(globalObject, install, JSC::jsUndefined(), args, "installGlobal"_s);
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (!vm.isTerminationException(exception)) {
            (void)scope.tryClearException();
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
    }
}
