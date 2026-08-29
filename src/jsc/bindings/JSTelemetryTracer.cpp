// Native OpenTelemetry: tracers (startSpan with its DOMJIT fast path,
// startActiveSpan), Bun.otel.span/wrap/set, span-context carriers, and the
// propagation glue used by internal/telemetry.ts.

#include "root.h"

#include "JSTelemetryTracer.h"
#include "JSTelemetrySpan.h"
#include "TelemetryContext.h"
#include "TelemetryInternal.h"
#include "BunClientData.h"
#include "BunProcess.h"
#include "InternalModuleRegistry.h"
#include <JavaScriptCore/DOMJITSignature.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ArrayBuffer.h>

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

// internal/telemetry awaitExport(promise, exporterId, payloadId); false if it threw.
extern "C" bool Bun__Telemetry__awaitExport(Zig::GlobalObject* globalObject, EncodedJSValue promise, double exporterId, double payloadId)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue fn = telemetryInternalFunction(globalObject, WebCore::builtinNames(vm).awaitExportPublicName());
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return false;
    }
    MarkedArgumentBuffer args;
    args.append(JSValue::decode(promise));
    args.append(jsNumber(exporterId));
    args.append(jsNumber(payloadId));
    call(globalObject, fn, jsUndefined(), args, "awaitExport"_s);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return false;
    }
    return true;
}

// ─── span creation ───

// W3C tracestate/baggage travel with the span that received them so outgoing
// requests made under it can forward them. Only present when the incoming
// request carried the headers, so the common case creates nothing.
static void inheritPropagation(VM& vm, Zig::GlobalObject* globalObject, JSTelemetrySpan* child, const TelemetryContextSlot& parent)
{
    using Field = JSTelemetrySpan::Field;
    auto propagation = parent.cell() ? telemetryPropagationOf(globalObject, parent.cell()) : telemetryPropagationOfPooled(globalObject, parent.poolHandle());
    if (propagation.traceState)
        child->field(Field::TraceState).set(vm, child, propagation.traceState);
    if (propagation.baggage)
        child->field(Field::Baggage).set(vm, child, propagation.baggage);
}

// New span under `parent` (none when `parent` has no header or is an ended pooled span).
static JSTelemetrySpan* createChildSpan(Zig::GlobalObject* globalObject, const TelemetryContextSlot& parent, uint16_t scopeId, uint8_t kind, JSString* name, uint64_t startNs)
{
    auto& vm = globalObject->vm();
    TelemetrySpanStub parentStub;
    bool hasParent = parent.stubAsParent(globalObject, &parentStub);
    TelemetrySpanStub stub;
    Bun__Telemetry__stubStart(globalObject, &stub, hasParent ? &parentStub : nullptr, startNs);
    auto* span = JSTelemetrySpan::createOwned(vm, globalObject, stub, scopeId, kind, name);
    if (hasParent)
        inheritPropagation(vm, globalObject, span, parent);
    return span;
}

// New span under the active span (both DOMJIT create paths land here).
static ALWAYS_INLINE JSTelemetrySpan* telemetryCreateSpan(Zig::GlobalObject* globalObject, uint16_t scopeId, uint8_t kind, JSString* name)
{
    return createChildSpan(globalObject, TelemetryContextSlot::current(globalObject), scopeId, kind, name, 0);
}

// startSpan's `parent`: undefined → the active span; null → none (new root);
// one of our spans → it; anything else span-like (api Span, SpanContext) →
// a non-recording carrier made by internal/telemetry.ts toNativeSpan.
// Never materializes a cell for a pooled active span.
static TelemetryContextSlot resolveParent(Zig::GlobalObject* globalObject, JSValue parent)
{
    if (parent.isUndefined())
        return TelemetryContextSlot::current(globalObject);
    TelemetryContextSlot out;
    if (parent.isNull())
        return out;
    if (toTelemetrySpan(parent)) {
        out.header = parent;
        return out;
    }
    if (!parent.isObject())
        return out;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue toNativeSpan = telemetryInternalFunction(globalObject, WebCore::builtinNames(vm).toNativeSpanPublicName());
    RETURN_IF_EXCEPTION(scope, out);
    MarkedArgumentBuffer args;
    args.append(parent);
    JSValue wrapped = call(globalObject, toNativeSpan, jsUndefined(), args, "toNativeSpan"_s);
    RETURN_IF_EXCEPTION(scope, out);
    if (toTelemetrySpan(wrapped))
        out.header = wrapped;
    return out;
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

// startSpan(name, { kind, attributes, links, startTime, root, parent }?, context?)
static JSTelemetrySpan* tracerStartSpan(Zig::GlobalObject* globalObject, JSTelemetryTracer* tracer, JSValue nameValue, JSValue options, JSValue context, JSValue* extrasOut)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* name = nameValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (options.isUndefinedOrNull() && context.isUndefined())
        return telemetryCreateSpan(globalObject, tracer->scope(), 0, name);

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
    if (!context.isUndefined()) {
        // `root: true` only drops the context's span as parent; its other values
        // (baggage) still become active.
        auto [span, extras] = unpackContext(globalObject, context);
        RETURN_IF_EXCEPTION(scope, nullptr);
        parent = isRoot || span.isUndefinedOrNull() ? jsNull() : span;
        if (extrasOut)
            *extrasOut = extras;
    } else if (isRoot) {
        parent = jsNull();
    } else if (!explicitParent.isUndefined()) {
        parent = explicitParent;
    }
    auto parentSlot = resolveParent(globalObject, parent);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* span = createChildSpan(globalObject, parentSlot, tracer->scope(), telemetryApiKind(kind), name, telemetryTimeInputToNs(startTime));

    if (attributes.isObject()) {
        telemetrySpanSetAttributes(globalObject, span, attributes);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (auto* array = links.isCell() ? dynamicDowncast<JSArray>(links.asCell()) : nullptr) {
        // What the addLinks builtin does per element.
        JSObject* addOne = globalObject->getDirect(vm, names.telemetryAddOneLinkPrivateName()).getObject();
        for (unsigned i = 0, n = array->length(); i < n && span->isRecording(); ++i) {
            JSValue link = array->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, nullptr);
            MarkedArgumentBuffer args;
            args.append(span);
            args.append(jsNumber(span->state()));
            args.append(link);
            call(globalObject, addOne, jsUndefined(), args, "addLinks"_s);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
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
    return { JSValue::encode(telemetryCreateSpan(defaultGlobalObject(lexicalGlobalObject), tracer->scope(), 0, name)) };
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
    if (fn.isUndefined()) {
        // `using span = tracer.startActiveSpan(...)`
        telemetryEnterSpan(globalObject, span, extras);
        return JSValue::encode(span);
    }
    // A scoped activation for the callback only: the span itself is not armed.
    JSValue prev = JSValue::decode(Bun__Telemetry__enterWithExtras(globalObject, JSValue::encode(span), JSValue::encode(extras)));
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
    auto* tracer = new (NotNull, allocateCell<JSTelemetryTracer>(vm)) JSTelemetryTracer(vm, structure, scopeId);
    tracer->finishCreation(vm);
    tracer->putDirectNativeFunction(vm, globalObject, names.startSpanPublicName(), 1, jsTelemetryTracerStartSpan, ImplementationVisibility::Public, NoIntrinsic, &signatureTelemetryTracerStartSpan, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    tracer->putDirectNativeFunction(vm, globalObject, names.startActiveSpanPublicName(), 2, jsTelemetryTracerStartActiveSpan, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    tracer->putDirect(vm, vm.propertyNames->name, name, static_cast<unsigned>(PropertyAttribute::ReadOnly));
    tracer->putDirect(vm, names.versionPublicName(), version, static_cast<unsigned>(PropertyAttribute::ReadOnly));
    return tracer;
}

// ── Bun.otel.span / Bun.otel.wrap / Bun.otel.set ─────────────────────────
//
// Plain host functions: create the span, make it active, call the user's
// function, restore the context, then end the span — right away, or (for a
// promise/thenable result) from the reactions the telemetryTraceSettled
// builtin attaches; the caller receives that derived promise, so an
// unhandled rejection stays unhandled.

// `fn` threw under `span`: restore, record, end; the exception stays pending.
static void unwindTraced(Zig::GlobalObject* globalObject, JSC::ThrowScope& scope, JSTelemetrySpan* span)
{
    telemetryExitSpan(globalObject, span);
    JSC::Exception* exception = scope.exception();
    if (exception && !globalObject->vm().isTerminationException(exception))
        telemetryFailSpanNoJS(globalObject, span, exception->value());
    telemetryEndSpan(globalObject, span, 0);
}

// `fn` returned `result` under `span` (still active): restore the context and
// end the span now, or hand back a promise that ends it when `result` settles.
static EncodedJSValue finishTraced(Zig::GlobalObject* globalObject, JSC::ThrowScope& scope, JSTelemetrySpan* span, JSValue result)
{
    auto& vm = globalObject->vm();
    JSPromise* promise = result.isCell() ? dynamicDowncast<JSPromise>(result.asCell()) : nullptr;
    if (!promise && result.isObject()) {
        // A thenable (query builders, PrismaPromise, …): adopt it into a real
        // Promise while the span is still active — its then() runs now, under
        // the span — and trace that promise instead.
        JSValue then = result.get(globalObject, vm.propertyNames->then);
        if (!scope.exception() && then.isCallable())
            promise = JSPromise::resolvedPromise(globalObject, result);
        if (scope.exception()) [[unlikely]] {
            unwindTraced(globalObject, scope, span);
            return {};
        }
    }
    telemetryExitSpan(globalObject, span);
    if (promise) {
        if (promise->status() == JSPromise::Status::Pending) {
            auto* settle = globalObject->getDirect(vm, WebCore::builtinNames(vm).telemetryTraceSettledPrivateName()).getObject();
            MarkedArgumentBuffer args;
            args.append(span);
            args.append(promise);
            RELEASE_AND_RETURN(scope, JSValue::encode(call(globalObject, settle, jsUndefined(), args, "telemetryTraceSettled"_s)));
        }
        if (promise->status() == JSPromise::Status::Rejected)
            telemetryFailSpanNoJS(globalObject, span, promise->result());
        result = promise;
    }
    telemetryEndSpan(globalObject, span, 0);
    return JSValue::encode(result);
}

// End `spanCell` when `promise` settles (websocket async message handlers).
// true when settlement is now being observed; false if `promise` is not a
// pending JSPromise (caller ends the span now). Empty on exception.
extern "C" EncodedJSValue Bun__Telemetry__observeSettlement(Zig::GlobalObject* globalObject, EncodedJSValue promiseValue, EncodedJSValue spanCell)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue promiseJS = JSValue::decode(promiseValue);
    auto* promise = promiseJS.isCell() ? dynamicDowncast<JSPromise>(promiseJS.asCell()) : nullptr;
    auto* span = toTelemetrySpan(JSValue::decode(spanCell));
    if (!promise || !span || promise->status() != JSPromise::Status::Pending)
        RELEASE_AND_RETURN(scope, JSValue::encode(jsBoolean(false)));
    auto* settle = globalObject->getDirect(vm, WebCore::builtinNames(vm).telemetryObserveSettledPrivateName()).getObject();
    MarkedArgumentBuffer args;
    args.append(span);
    args.append(promise);
    args.append(jsBoolean(promise->isHandled()));
    call(globalObject, settle, jsUndefined(), args, "telemetryObserveSettled"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(true));
}

// Bun.otel.span(name, attributes?, fn?) — without fn: the span, active until
// disposed/exited/ended.
// A generator function returns its iterator immediately, so tracing the call
// would end the span before the body runs; the work inside has to be traced instead.
static bool isGeneratorFunction(JSValue fn)
{
    auto* jsFunction = dynamicDowncast<JSFunction>(fn);
    return jsFunction && !jsFunction->isHostOrBuiltinFunction() && isGeneratorOrAsyncGeneratorWrapperParseMode(jsFunction->jsExecutable()->parseMode());
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetryOtelSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* name = callFrame->argument(0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue a1 = callFrame->argument(1), a2 = callFrame->argument(2);
    JSValue attributes = jsUndefined(), fn = jsUndefined();
    if (a1.isCallable()) {
        fn = a1;
        if (!a2.isUndefined())
            return throwVMTypeError(globalObject, scope, "Bun.otel.span: nothing may follow the function argument"_s);
    } else {
        attributes = a1;
        fn = a2;
    }
    if (!attributes.isUndefinedOrNull() && !attributes.isObject())
        return throwVMTypeError(globalObject, scope, "Bun.otel.span: attributes must be an object"_s);
    if (!fn.isUndefined() && !fn.isCallable())
        return throwVMTypeError(globalObject, scope, "Bun.otel.span: the last argument must be a function"_s);
    if (isGeneratorFunction(fn)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "Bun.otel.span: a generator function cannot be traced as a call (it returns before its body runs); use Bun.otel.span inside the generator instead"_s);
    auto* span = telemetryCreateSpan(globalObject, Bun__Telemetry__userScope(), 0, name);
    if (attributes.isObject()) {
        telemetrySpanSetAttributes(globalObject, span, attributes);
        RETURN_IF_EXCEPTION(scope, {});
    }
    telemetryEnterSpan(globalObject, span);
    if (fn.isUndefined())
        return JSValue::encode(span);
    MarkedArgumentBuffer args;
    args.append(span);
    JSValue result = call(globalObject, fn, jsUndefined(), args, "Bun.otel.span"_s);
    if (scope.exception()) [[unlikely]] {
        unwindTraced(globalObject, scope, span);
        return {};
    }
    return finishTraced(globalObject, scope, span, result);
}

// The function Bun.otel.wrap() returns: its target and span name are private
// properties on the callee.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryWrappedCall, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* callee = callFrame->jsCallee();
    auto& names = WebCore::builtinNames(vm);
    JSValue target = callee->getDirect(vm, names.telemetryWrapTargetPrivateName());
    JSValue nameValue = callee->getDirect(vm, names.telemetryWrapNamePrivateName());
    ASSERT(target && nameValue.isString());
    auto* span = telemetryCreateSpan(globalObject, Bun__Telemetry__userScope(), 0, asString(nameValue));
    telemetryEnterSpan(globalObject, span);
    MarkedArgumentBuffer args;
    for (unsigned i = 0; i < callFrame->argumentCount(); ++i)
        args.append(callFrame->uncheckedArgument(i));
    if (args.hasOverflowed()) [[unlikely]] {
        unwindTraced(globalObject, scope, span);
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    JSValue result = call(globalObject, target, callFrame->thisValue(), args, "Bun.otel.wrap"_s);
    if (scope.exception()) [[unlikely]] {
        unwindTraced(globalObject, scope, span);
        return {};
    }
    return finishTraced(globalObject, scope, span, result);
}

// internal: a Uint32Array over the process-wide instrument mask, so JS
// integrations (node:http) test a bit instead of calling into native when
// tracing is off.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryEnabledMask, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Static storage: nothing to free.
    auto buffer = ArrayBuffer::createFromBytes(std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(telemetryEnabledMaskAddress()), sizeof(uint32_t) }, createSharedTask<void(void*)>([](void*) {}));
    auto* view = JSUint32Array::create(globalObject, globalObject->typedArrayStructure(TypeUint32, false), WTF::move(buffer), 0, 1);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(view);
}

// Bun.otel.wrap(name, fn) — or wrap(fn), named after the function.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryOtelWrap, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue nameValue = callFrame->argument(0), fn = callFrame->argument(1);
    if (nameValue.isCallable()) {
        fn = nameValue;
        nameValue = jsUndefined();
    }
    if (!fn.isCallable()) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "Bun.otel.wrap: fn must be a function"_s);
    JSObject* target = fn.getObject();
    if (auto* jsFunction = dynamicDowncast<JSFunction>(target); jsFunction && !jsFunction->isHostOrBuiltinFunction() && jsFunction->jsExecutable()->isClassConstructorFunction()) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "Bun.otel.wrap: a class cannot be wrapped (the wrapped function is not a constructor); wrap its methods instead"_s);
    if (isGeneratorFunction(target)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "Bun.otel.wrap: a generator function cannot be wrapped (it returns before its body runs); use Bun.otel.span inside the generator instead"_s);
    JSValue targetName = target->get(globalObject, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::String fnName = targetName.isString() ? asString(targetName)->tryGetValue() : WTF::String();
    JSString* spanName = nameValue.isUndefined() ? nullptr : nameValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!spanName || !spanName->length()) {
        if (fnName.isEmpty())
            return throwVMTypeError(globalObject, scope, "Bun.otel.wrap: a span name is required when the function is anonymous"_s);
        spanName = asString(targetName);
    }
    JSValue lengthValue = target->get(globalObject, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, {});
    double lengthNumber = lengthValue.isNumber() ? lengthValue.asNumber() : 0;
    unsigned length = std::isfinite(lengthNumber) && lengthNumber > 0 && lengthNumber <= 65535 ? static_cast<unsigned>(lengthNumber) : 0;
    auto* wrapped = JSFunction::create(vm, globalObject, length, fnName.isEmpty() ? spanName->tryGetValue() : fnName, jsTelemetryWrappedCall, ImplementationVisibility::Public);
    auto& names = WebCore::builtinNames(vm);
    wrapped->putDirect(vm, names.telemetryWrapTargetPrivateName(), target, static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    wrapped->putDirect(vm, names.telemetryWrapNamePrivateName(), spanName, static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    RELEASE_AND_RETURN(scope, JSValue::encode(wrapped));
}

// Bun.otel.set(key, value) / set({...attributes}) on the active span; false if there is none.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryOtelSet, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue keyOrAttributes = callFrame->argument(0), value = callFrame->argument(1);
    if (!keyOrAttributes.isString() && !keyOrAttributes.isObject())
        return JSValue::encode(jsBoolean(false));
    auto active = TelemetryContextSlot::current(globalObject);
    if (!active.header)
        return JSValue::encode(jsBoolean(false));
    if (auto handle = active.poolHandle(); handle && keyOrAttributes.isString()) {
        // A request span and one attribute: straight into the slot, no Span object.
        // False once the request span has ended, or when it is not recording.
        return JSValue::encode(jsBoolean(telemetryNativeSetAttribute(globalObject, handle, asString(keyOrAttributes), value)));
    }
    JSTelemetrySpan* span = toTelemetrySpan(active.header);
    if (!span)
        span = toTelemetrySpan(JSValue::decode(Bun__Telemetry__activeSpanCell(globalObject)));
    if (!span)
        return JSValue::encode(jsBoolean(false));
    if (keyOrAttributes.isString())
        telemetrySpanSetAttribute(globalObject, span, asString(keyOrAttributes), value);
    else
        telemetrySpanSetAttributes(globalObject, span, keyOrAttributes);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(span->isRecording()));
}

// createTracer(scopeId, name, version)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryCreateTracer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSValue::encode(JSTelemetryTracer::create(globalObject->vm(), globalObject, telemetryScopeId(callFrame->argument(0)), callFrame->argument(1), callFrame->argument(2)));
}

// ─── carriers for foreign / remote span contexts ───

static JSTelemetrySpan* createCarrier(Zig::GlobalObject* globalObject, const TelemetrySpanStub& stub, JSValue traceState)
{
    auto& vm = globalObject->vm();
    auto* span = JSTelemetrySpan::createOwned(vm, globalObject, stub, Bun__Telemetry__userScope(), 0, jsEmptyString(vm));
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
    TelemetrySpanStub stub;
    BunString t = { BunStringTag::Empty, {} }, s = { BunStringTag::Empty, {} };
    const BunString* tp = nullptr;
    const BunString* sp = nullptr;
    if (traceId.isString() && spanId.isString()) {
        t = telemetryBorrow(asString(traceId));
        s = telemetryBorrow(asString(spanId));
        tp = &t;
        sp = &s;
    }
    Bun__Telemetry__carrierStub(&stub, tp, sp, traceFlags.isInt32() ? static_cast<uint8_t>(traceFlags.asInt32()) : TelemetrySpanStub::Sampled, isRemote.isBoolean() ? isRemote.asBoolean() : true);
    return JSValue::encode(createCarrier(globalObject, stub, callFrame->argument(4)));
}

// suppressedCarrier() — the header `context.with(suppressTracing(ctx), …)`
// activates: no span (root or child) starts under it.
extern "C" JSC::EncodedJSValue Bun__TelemetrySpan__createSuppressedCarrier(Zig::GlobalObject* globalObject)
{
    TelemetrySpanStub stub;
    Bun__Telemetry__suppressedStub(&stub);
    return JSValue::encode(createCarrier(globalObject, stub, jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySuppressedCarrier, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    return Bun__TelemetrySpan__createSuppressedCarrier(defaultGlobalObject(lexicalGlobalObject));
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
    auto propagators = Bun__Telemetry__propagators();
    if (propagators.traceContext && span->m_stub.hasTraceId()) {
        std::span<Latin1Character> buf;
        auto traceparent = WTF::String::createUninitialized(kTraceparentLength, buf);
        Bun__Telemetry__formatTraceparent(&span->m_stub, reinterpret_cast<uint8_t (*)[kTraceparentLength]>(buf.data()));
        out->putDirectIndex(globalObject, 0, jsString(vm, WTF::move(traceparent)));
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto propagation = telemetryPropagationOf(globalObject, span);
    JSValue traceState = propagation.traceState ? JSValue(propagation.traceState) : JSValue();
    JSValue baggage = propagation.baggage ? JSValue(propagation.baggage) : JSValue();
    if (propagators.traceContext && traceState) {
        out->putDirectIndex(globalObject, 1, traceState);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (propagators.baggage && baggage) {
        out->putDirectIndex(globalObject, 2, baggage);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(out);
}

// spanBaggage(span) → the W3C `baggage` header the span carries, or undefined; honours OTEL_PROPAGATORS.
JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanBaggage, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* span = toTelemetrySpan(callFrame->argument(0));
    if (!span || !Bun__Telemetry__propagators().baggage)
        return JSValue::encode(jsUndefined());
    JSString* baggage = telemetryPropagationOf(defaultGlobalObject(lexicalGlobalObject), span).baggage;
    return JSValue::encode(baggage ? JSValue(baggage) : jsUndefined());
}

} // namespace Bun

/// `process.env` as JS sees it now (the property, so a reassigned `process.env = {…}`
/// counts too). Empty on exception.
extern "C" JSC::EncodedJSValue Bun__Telemetry__processEnv(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue env = JSC::JSValue(globalObject->processObject()).get(globalObject, JSC::Identifier::fromString(vm, "env"_s));
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(env);
}

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
