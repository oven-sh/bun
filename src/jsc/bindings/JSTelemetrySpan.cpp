#include "root.h"

#include "JSTelemetrySpan.h"
#include "TelemetryContext.h"
#include "TelemetryInternal.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/DOMJITSignature.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/MathCommon.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <limits>

namespace Bun {
using namespace JSC;

// ─── cell ───

const ClassInfo JSTelemetrySpan::s_info = { "Span"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetrySpan) };

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSTelemetrySpan::subspaceFor(VM& vm)
{
    return WebCore::subspaceForImpl<JSTelemetrySpan, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSTelemetrySpan, m_subspaceForJSTelemetrySpan));
}

Structure* JSTelemetrySpan::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, createTelemetrySpanPrototype(vm, defaultGlobalObject(globalObject)), TypeInfo(Type, StructureFlags), info());
}

JSTelemetrySpan* JSTelemetrySpan::create(VM& vm, Zig::GlobalObject* globalObject, const TelemetrySpanStub& stub, uint16_t scope, uint8_t kind, JSValue name, uint64_t nativeHandle)
{
    Structure* structure = globalObject->JSTelemetrySpanStructure();
    auto* cell = new (NotNull, allocateCell<JSTelemetrySpan>(vm)) JSTelemetrySpan(vm, structure);
    cell->finishCreation(vm, stub, scope, kind, name, nativeHandle);
    return cell;
}

void JSTelemetrySpan::finishCreation(VM& vm, const TelemetrySpanStub& stub, uint16_t scope, uint8_t kind, JSValue name, uint64_t nativeHandle)
{
    Base::finishCreation(vm);
    m_stub = stub;
    m_native = nativeHandle;
    m_scope = scope;
    m_kind = kind;
    int32_t state = (stub.isRecording() ? Recording : 0) | (nativeHandle ? Native : 0);
    field(Field::State).setWithoutWriteBarrier(jsNumber(state));
    field(Field::Attributes).setWithoutWriteBarrier(jsNull());
    field(Field::Name).set(vm, this, name);
    field(Field::Events).setWithoutWriteBarrier(jsNull());
    field(Field::Links).setWithoutWriteBarrier(jsNull());
    field(Field::StatusCode).setWithoutWriteBarrier(jsNumber(0));
    field(Field::StatusMessage).setWithoutWriteBarrier(jsNull());
    field(Field::TraceState).setWithoutWriteBarrier(jsNull());
    field(Field::Baggage).setWithoutWriteBarrier(jsNull());
    field(Field::Restore).setWithoutWriteBarrier(JSValue());
    field(Field::Context).setWithoutWriteBarrier(JSValue());
}

template<typename Visitor>
void JSTelemetrySpan::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTelemetrySpan>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}
DEFINE_VISIT_CHILDREN(JSTelemetrySpan);

// ─── entry points for src/runtime/telemetry/span.rs ───

extern "C" JSC::EncodedJSValue Bun__TelemetrySpan__createNative(Zig::GlobalObject* globalObject, const TelemetrySpanStub* stub, uint16_t scope, uint8_t kind, uint64_t native)
{
    return JSValue::encode(JSTelemetrySpan::create(globalObject->vm(), globalObject, *stub, scope, kind, jsNull(), native));
}

/// A pooled span with a materialized cell ended natively.
extern "C" void Bun__TelemetrySpan__nativeEnded(JSC::EncodedJSValue v)
{
    if (auto* span = toTelemetrySpan(JSValue::decode(v)))
        span->setState((span->state() | JSTelemetrySpan::Ended) & ~JSTelemetrySpan::Recording);
}

extern "C" void* Bun__TelemetrySpan__fromJS(JSC::EncodedJSValue v)
{
    return toTelemetrySpan(JSValue::decode(v));
}

extern "C" const TelemetrySpanStub* Bun__TelemetrySpan__stub(void* cell)
{
    return &static_cast<JSTelemetrySpan*>(cell)->m_stub;
}

/// Borrowed W3C `tracestate` a JS-owned span inherited (Empty if none / not a span).
extern "C" BunString Bun__TelemetrySpan__traceState(JSC::EncodedJSValue v)
{
    auto* span = toTelemetrySpan(JSValue::decode(v));
    return telemetryBorrow(span ? span->string(JSTelemetrySpan::Field::TraceState) : nullptr);
}

extern "C" BunString Bun__TelemetrySpan__baggage(JSC::EncodedJSValue v)
{
    auto* span = toTelemetrySpan(JSValue::decode(v));
    return telemetryBorrow(span ? span->string(JSTelemetrySpan::Field::Baggage) : nullptr);
}

// ─── attribute gathering ───
//
// Turns the builtins' flat `[key0, value0, …]` arrays into TelemetryAttrRefs
// for one Rust call. Only own, already-present array elements are read; no JS
// runs and nothing throws, so the borrowed strings stay valid until the call
// returns.

class TelemetryAttrGatherer {
public:
    TelemetryAttrPool pool() const
    {
        return { m_items.begin(), m_arrayItems.begin(), static_cast<uint32_t>(m_items.size()), static_cast<uint32_t>(m_arrayItems.size()) };
    }
    unsigned dropped() const { return m_dropped; }

    // null | JSArray [key0, value0, …] → the slice of pool().items it fills.
    TelemetryAttrSlice gather(JSValue flat);
    TelemetryAttrSlice gatherOne(JSString* key, JSValue value);

private:
    bool fill(TelemetryAttrRef&, JSValue, bool allowArray);

    Vector<TelemetryAttrRef, 16> m_items;
    Vector<TelemetryAttrRef, 8> m_arrayItems;
    unsigned m_dropped { 0 };
};

bool TelemetryAttrGatherer::fill(TelemetryAttrRef& out, JSValue v, bool allowArray)
{
    if (v.isString()) {
        out.kind = TelemetryAttrKind::String;
        out.value.string = telemetryBorrow(asString(v));
        return true;
    }
    if (v.isInt32()) {
        out.kind = TelemetryAttrKind::Int;
        out.value.integer = v.asInt32();
        return true;
    }
    if (v.isNumber()) {
        double d = v.asNumber();
        if (isSafeInteger(d)) {
            out.kind = TelemetryAttrKind::Int;
            out.value.integer = static_cast<int64_t>(d);
        } else {
            out.kind = TelemetryAttrKind::Double;
            out.value.number = d;
        }
        return true;
    }
    if (v.isBoolean()) {
        out.kind = TelemetryAttrKind::Bool;
        out.value.integer = v.asBoolean();
        return true;
    }
    if (v.isBigInt()) {
        // OTLP ints are int64; a BigInt outside that range is not an attribute value.
#if USE(BIGINT32)
        if (v.isBigInt32()) {
            out.kind = TelemetryAttrKind::Int;
            out.value.integer = v.bigInt32AsInt32();
            return true;
        }
#endif
        auto* big = v.asHeapBigInt();
        if (JSBigInt::compare(big, std::numeric_limits<int64_t>::min()) == JSBigInt::ComparisonResult::LessThan
            || JSBigInt::compare(big, std::numeric_limits<int64_t>::max()) == JSBigInt::ComparisonResult::GreaterThan)
            return false;
        out.kind = TelemetryAttrKind::Int;
        out.value.integer = JSBigInt::toBigInt64(big);
        return true;
    }
    if (allowArray && v.isCell()) {
        if (auto* arr = dynamicDowncast<JSArray>(v.asCell())) {
            unsigned n = std::min<unsigned>(arr->length(), kTelemetryMaxGather);
            uint32_t start = m_arrayItems.size();
            m_arrayItems.reserveCapacity(start + n);
            for (unsigned i = 0; i < n; ++i) {
                JSValue item = arr->tryGetIndexQuickly(i);
                if (!item)
                    continue;
                m_arrayItems.grow(m_arrayItems.size() + 1);
                if (!fill(m_arrayItems.last(), item, false))
                    m_arrayItems.shrink(m_arrayItems.size() - 1);
            }
            out.kind = TelemetryAttrKind::Array;
            out.value.array = { start, static_cast<uint32_t>(m_arrayItems.size() - start) };
            return true;
        }
    }
    return false;
}

TelemetryAttrSlice TelemetryAttrGatherer::gatherOne(JSString* key, JSValue value)
{
    uint32_t start = m_items.size();
    m_items.grow(start + 1);
    if (!fill(m_items.last(), value, true)) {
        m_items.shrink(start);
        return { start, 0 };
    }
    m_items.last().key = telemetryBorrow(key);
    return { start, 1 };
}

TelemetryAttrSlice TelemetryAttrGatherer::gather(JSValue flatValue)
{
    uint32_t start = m_items.size();
    auto* flat = telemetryArray(flatValue);
    if (!flat)
        return { start, 0 };
    unsigned n = flat->length() & ~1u;
    if (n > 2 * kTelemetryMaxGather) {
        m_dropped += (n - 2 * kTelemetryMaxGather) / 2;
        n = 2 * kTelemetryMaxGather;
    }
    m_items.reserveCapacity(start + n / 2);
    for (unsigned i = 0; i < n; i += 2) {
        JSValue k = flat->tryGetIndexQuickly(i);
        JSValue v = flat->tryGetIndexQuickly(i + 1);
        JSString* key = k && k.isString() ? asString(k) : nullptr;
        if (!key || !v || v.isUndefinedOrNull())
            continue;
        m_items.grow(m_items.size() + 1);
        if (!fill(m_items.last(), v, true)) {
            m_items.shrink(m_items.size() - 1);
            continue;
        }
        m_items.last().key = telemetryBorrow(key);
    }
    return { start, static_cast<uint32_t>(m_items.size() - start) };
}

// ─── end ───

// Ends `span` at `endNs` (0 = now): JS-owned spans are gathered and encoded,
// native-owned spans end their pool slot. No-op if already ended. Never runs
// JS and never throws.
static void telemetryEndSpan(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, uint64_t endNs)
{
    int32_t state = span->state();
    if (state & JSTelemetrySpan::Ended)
        return;
    span->setState((state | JSTelemetrySpan::Ended) & ~JSTelemetrySpan::Recording);
    if (span->m_native) {
        Bun__Telemetry__nativeEnd(globalObject, span->m_native, endNs);
        return;
    }
    if (!(state & JSTelemetrySpan::Recording))
        return;

    using Field = JSTelemetrySpan::Field;
    TelemetryAttrGatherer gatherer;
    Vector<TelemetryEventRef, 4> events;
    Vector<TelemetryLinkRef, 4> links;

    JSValue attributes = span->get(Field::Attributes);
    TelemetryAttrSlice attrs = attributes.isCell() ? gatherer.gather(attributes) : TelemetryAttrSlice { 0, 0 };

    if (JSArray* list = telemetryArray(span->get(Field::Events))) {
        unsigned n = std::min<unsigned>(list->length() / 3, kTelemetryMaxGather);
        events.reserveInitialCapacity(n);
        for (unsigned i = 0; i < n; ++i) {
            JSString* name = telemetryArrayString(list, i * 3);
            if (!name)
                continue;
            events.append({ telemetryBorrow(name), telemetryTimeInputToNs(list->tryGetIndexQuickly(i * 3 + 1)), gatherer.gather(list->tryGetIndexQuickly(i * 3 + 2)) });
        }
    }

    if (JSArray* list = telemetryArray(span->get(Field::Links))) {
        unsigned n = std::min<unsigned>(list->length() / 5, kTelemetryMaxGather);
        links.reserveInitialCapacity(n);
        for (unsigned i = 0; i < n; ++i) {
            JSString* traceId = telemetryArrayString(list, i * 5);
            JSString* spanId = telemetryArrayString(list, i * 5 + 1);
            JSValue flags = list->tryGetIndexQuickly(i * 5 + 2);
            if (!traceId || !spanId)
                continue;
            links.append({ telemetryBorrow(traceId), telemetryBorrow(spanId), telemetryBorrow(telemetryArrayString(list, i * 5 + 4)), gatherer.gather(list->tryGetIndexQuickly(i * 5 + 3)), static_cast<uint8_t>(flags.isInt32() ? flags.asInt32() : 0) });
        }
    }

    JSValue status = span->get(Field::StatusCode);
    TelemetryEndDesc desc {
        &span->m_stub,
        endNs,
        telemetryBorrow(span->string(Field::Name)),
        telemetryBorrow(span->string(Field::StatusMessage)),
        telemetryBorrow(span->string(Field::TraceState)),
        gatherer.pool(),
        attrs,
        events.begin(),
        links.begin(),
        static_cast<uint32_t>(events.size()),
        static_cast<uint32_t>(links.size()),
        gatherer.dropped(),
        span->m_scope,
        span->m_kind,
        static_cast<uint8_t>(status.isInt32() ? status.asInt32() : 0),
    };
    Bun__Telemetry__encodeSpan(globalObject, &desc);

    span->field(Field::Attributes).setWithoutWriteBarrier(jsNull());
    span->field(Field::Events).setWithoutWriteBarrier(jsNull());
    span->field(Field::Links).setWithoutWriteBarrier(jsNull());
}

// ─── native-owned span mutators (private globals used by TelemetrySpan.ts) ───

// $telemetrySetAttribute(span, key: string, value)
JSC_DEFINE_HOST_FUNCTION(jsTelemetrySetAttribute, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* span = toTelemetrySpan(callFrame->argument(0));
    JSValue key = callFrame->argument(1);
    if (!span || !span->m_native || !key.isString())
        return JSValue::encode(jsUndefined());
    TelemetryAttrGatherer gatherer;
    gatherer.gatherOne(asString(key), callFrame->argument(2));
    TelemetryAttrPool pool = gatherer.pool();
    Bun__Telemetry__nativeSetAttributes(globalObject, span->m_native, &pool);
    return JSValue::encode(jsUndefined());
}

// $telemetrySetName(span, name: string)
JSC_DEFINE_HOST_FUNCTION(jsTelemetrySetName, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* span = toTelemetrySpan(callFrame->argument(0));
    JSValue name = callFrame->argument(1);
    if (!span || !span->m_native || !name.isString())
        return JSValue::encode(jsUndefined());
    BunString s = telemetryBorrow(asString(name));
    Bun__Telemetry__nativeSetName(globalObject, span->m_native, &s);
    return JSValue::encode(jsUndefined());
}

// $telemetrySetStatus(span, code: 1 | 2, message: string)
JSC_DEFINE_HOST_FUNCTION(jsTelemetrySetStatus, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* span = toTelemetrySpan(callFrame->argument(0));
    JSValue code = callFrame->argument(1), message = callFrame->argument(2);
    if (!span || !span->m_native || !code.isInt32())
        return JSValue::encode(jsUndefined());
    BunString s = telemetryBorrow(message.isString() ? asString(message) : nullptr);
    Bun__Telemetry__nativeSetStatus(globalObject, span->m_native, static_cast<uint8_t>(code.asInt32()), &s);
    return JSValue::encode(jsUndefined());
}

// $telemetryAddEvent(span, name: string, flatAttributes: unknown[] | null, time: TimeInput | undefined)
// JS-owned spans keep the event in Field::Events until end(); the timestamp
// is taken here when none was given.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryAddEvent, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = toTelemetrySpan(callFrame->argument(0));
    JSValue name = callFrame->argument(1), flat = callFrame->argument(2), time = callFrame->argument(3);
    if (!span || !name.isString())
        return JSValue::encode(jsUndefined());
    if (!span->m_native) {
        JSArray* list = telemetryArray(span->get(JSTelemetrySpan::Field::Events));
        if (!list) {
            list = constructEmptyArray(globalObject, nullptr, 0);
            RETURN_IF_EXCEPTION(scope, {});
            span->field(JSTelemetrySpan::Field::Events).set(vm, span, list);
        } else if (list->length() >= 3 * kTelemetryMaxGather)
            return JSValue::encode(jsUndefined());
        if (telemetryTimeInputToNs(time) == 0)
            time = jsNumber(static_cast<double>(Bun__Telemetry__nowNs()) / 1e6);
        list->push(globalObject, name);
        RETURN_IF_EXCEPTION(scope, {});
        list->push(globalObject, time);
        RETURN_IF_EXCEPTION(scope, {});
        list->push(globalObject, flat.isCell() ? flat : jsNull());
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }
    TelemetryAttrGatherer gatherer;
    TelemetryEventRef event { telemetryBorrow(asString(name)), telemetryTimeInputToNs(time), gatherer.gather(flat) };
    TelemetryAttrPool pool = gatherer.pool();
    Bun__Telemetry__nativeAddEvent(globalObject, span->m_native, &event, &pool);
    return JSValue::encode(jsUndefined());
}

// $telemetryAddLink(span, traceId: string, spanId: string, traceFlags: int32, flatAttributes: unknown[] | null)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryAddLink, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* span = toTelemetrySpan(callFrame->argument(0));
    JSValue traceId = callFrame->argument(1), spanId = callFrame->argument(2), flags = callFrame->argument(3), traceState = callFrame->argument(5);
    if (!span || !span->m_native || !traceId.isString() || !spanId.isString())
        return JSValue::encode(jsUndefined());
    TelemetryAttrGatherer gatherer;
    TelemetryLinkRef link { telemetryBorrow(asString(traceId)), telemetryBorrow(asString(spanId)), telemetryBorrow(traceState.isString() ? asString(traceState) : nullptr), gatherer.gather(callFrame->argument(4)), static_cast<uint8_t>(flags.isInt32() ? flags.asInt32() : 0) };
    TelemetryAttrPool pool = gatherer.pool();
    Bun__Telemetry__nativeAddLink(globalObject, span->m_native, &link, &pool);
    return JSValue::encode(jsUndefined());
}

// ─── prototype ───

static JSTelemetrySpan* thisSpan(JSGlobalObject* globalObject, CallFrame* callFrame, ThrowScope& scope)
{
    auto* span = toTelemetrySpan(callFrame->thisValue());
    if (!span) [[unlikely]]
        throwTypeError(globalObject, scope, "not a Span"_s);
    return span;
}

// DFG/FTL call `end()` (no arguments) through this directly (CallDOM): no JS
// call frame, `this` already type-checked.
JSC_DEFINE_JIT_OPERATION(telemetrySpanEndWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject * lexicalGlobalObject, JSTelemetrySpan* span))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    telemetryEndSpan(defaultGlobalObject(lexicalGlobalObject), span, 0);
    return { JSValue::encode(jsUndefined()) };
}

static const JSC::DOMJIT::Signature signatureTelemetrySpanEnd(
    telemetrySpanEndWithoutTypeCheck,
    JSTelemetrySpan::info(),
    JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    SpecOther);

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncEnd, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    telemetryEndSpan(globalObject, span, telemetryTimeInputToNs(callFrame->argument(0)));
    return JSValue::encode(jsUndefined());
}

static void exitSpan(Zig::GlobalObject* globalObject, JSTelemetrySpan* span)
{
    JSValue prev = span->get(JSTelemetrySpan::Field::Restore);
    if (!prev)
        return;
    Bun__Telemetry__exit(globalObject, JSValue::encode(prev));
    span->field(JSTelemetrySpan::Field::Restore).setWithoutWriteBarrier(JSValue());
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncEnter, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (!span->get(JSTelemetrySpan::Field::Restore)) {
        JSValue prev = JSValue::decode(Bun__Telemetry__enter(globalObject, JSValue::encode(span)));
        span->field(JSTelemetrySpan::Field::Restore).set(vm, span, prev ? prev : jsUndefined());
    }
    return JSValue::encode(span);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncExit, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    exitSpan(globalObject, span);
    return JSValue::encode(span);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncDispose, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    telemetryEndSpan(globalObject, span, 0);
    exitSpan(globalObject, span);
    return JSValue::encode(jsUndefined());
}

static JSString* hexId(VM& vm, std::span<const uint8_t> bytes)
{
    std::span<Latin1Character> buf;
    auto s = WTF::String::createUninitialized(bytes.size() * 2, buf);
    Bun__Telemetry__hexLower(bytes.data(), bytes.size(), buf.data());
    return jsString(vm, WTF::move(s));
}

// The W3C tracestate header this span carries (inherited from its parent), or null.
static JSString* traceStateHeader(Zig::GlobalObject* globalObject, JSTelemetrySpan* span)
{
    if (JSString* s = span->string(JSTelemetrySpan::Field::TraceState))
        return s->length() ? s : nullptr;
    if (!span->m_native)
        return nullptr;
    BunString traceState, baggage;
    if (!Bun__Telemetry__nativePropagation(globalObject, span->m_native, &traceState, &baggage))
        return nullptr;
    baggage.deref();
    WTF::String s = traceState.transferToWTFString();
    return s.isEmpty() ? nullptr : jsString(globalObject->vm(), WTF::move(s));
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncSpanContext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (JSValue cached = span->get(JSTelemetrySpan::Field::Context))
        return JSValue::encode(cached);
    auto& names = WebCore::builtinNames(vm);
    JSObject* ctx = constructEmptyObject(globalObject, globalObject->objectPrototype(), 5);
    ctx->putDirect(vm, names.traceIdPublicName(), hexId(vm, std::span { span->m_stub.traceId }));
    ctx->putDirect(vm, names.spanIdPublicName(), hexId(vm, std::span { span->m_stub.spanId }));
    ctx->putDirect(vm, names.traceFlagsPublicName(), jsNumber(span->m_stub.flags & TelemetrySpanStub::Sampled));
    if (span->m_stub.flags & TelemetrySpanStub::Remote)
        ctx->putDirect(vm, names.isRemotePublicName(), jsBoolean(true));
    if (JSString* header = traceStateHeader(globalObject, span)) {
        // Hand out an api-shaped TraceState (get/set/unset/serialize), not the raw header.
        JSValue make = telemetryInternalFunction(globalObject, names.makeTraceStatePublicName());
        RETURN_IF_EXCEPTION(scope, {});
        MarkedArgumentBuffer args;
        args.append(header);
        JSValue traceState = call(globalObject, make, jsUndefined(), args, "makeTraceState"_s);
        RETURN_IF_EXCEPTION(scope, {});
        ctx->putDirect(vm, names.traceStatePublicName(), traceState);
    }
    span->field(JSTelemetrySpan::Field::Context).set(vm, span, ctx);
    return JSValue::encode(ctx);
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_traceId, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(hexId(globalObject->vm(), std::span { span->m_stub.traceId }));
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_spanId, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(hexId(globalObject->vm(), std::span { span->m_stub.spanId }));
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_parentSpanId, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    if (!span->m_stub.hasParent())
        return JSValue::encode(jsUndefined());
    return JSValue::encode(hexId(globalObject->vm(), std::span { span->m_stub.parentSpanId }));
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_traceFlags, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsNumber(span->m_stub.flags & TelemetrySpanStub::Sampled));
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_isRemote, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsBoolean(span->m_stub.flags & TelemetrySpanStub::Remote));
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_name, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    if (JSString* name = span->string(JSTelemetrySpan::Field::Name))
        return JSValue::encode(name);
    if (!span->m_native)
        return JSValue::encode(jsEmptyString(globalObject->vm()));
    return JSValue::encode(jsString(globalObject->vm(), Bun__Telemetry__nativeName(globalObject, span->m_native).transferToWTFString()));
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_kind, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsNumber(span->m_kind));
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_ended, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    if (span->ended())
        return JSValue::encode(jsBoolean(true));
    if (span->m_native)
        return JSValue::encode(jsBoolean(!Bun__Telemetry__nativeIsLive(globalObject, span->m_native)));
    return JSValue::encode(jsBoolean(false));
}

class JSTelemetrySpanPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    static JSTelemetrySpanPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        auto* ptr = new (NotNull, allocateCell<JSTelemetrySpanPrototype>(vm)) JSTelemetrySpanPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }
    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTelemetrySpanPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

private:
    JSTelemetrySpanPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(VM&, JSGlobalObject*);
};

static const HashTableValue JSTelemetrySpanPrototypeTableValues[] = {
    { "setAttribute"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanSetAttributeCodeGenerator, 2 } },
    { "setAttributes"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanSetAttributesCodeGenerator, 1 } },
    { "updateName"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanUpdateNameCodeGenerator, 1 } },
    { "isRecording"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanIsRecordingCodeGenerator, 0 } },
    { "setStatus"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanSetStatusCodeGenerator, 1 } },
    { "addEvent"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanAddEventCodeGenerator, 3 } },
    { "recordException"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanRecordExceptionCodeGenerator, 2 } },
    { "addLink"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanAddLinkCodeGenerator, 1 } },
    { "addLinks"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanAddLinksCodeGenerator, 1 } },
    { "end"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DOMJITFunction), NoIntrinsic, { HashTableValue::DOMJITFunctionType, jsTelemetrySpanProtoFuncEnd, &signatureTelemetrySpanEnd } },
    { "spanContext"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTelemetrySpanProtoFuncSpanContext, 0 } },
    { "enter"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTelemetrySpanProtoFuncEnter, 0 } },
    { "exit"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTelemetrySpanProtoFuncExit, 0 } },
    { "traceId"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_traceId, 0 } },
    { "spanId"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_spanId, 0 } },
    { "parentSpanId"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_parentSpanId, 0 } },
    { "traceFlags"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_traceFlags, 0 } },
    { "isRemote"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_isRemote, 0 } },
    { "name"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_name, 0 } },
    { "kind"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_kind, 0 } },
    { "ended"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_ended, 0 } },
};

const ClassInfo JSTelemetrySpanPrototype::s_info = { "Span"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetrySpanPrototype) };

void JSTelemetrySpanPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSTelemetrySpan::info(), JSTelemetrySpanPrototypeTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->disposeSymbol, JSFunction::create(vm, globalObject, 0, "[Symbol.dispose]"_s, jsTelemetrySpanProtoFuncDispose, ImplementationVisibility::Public), PropertyAttribute::DontEnum | 0);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSObject* createTelemetrySpanPrototype(VM& vm, Zig::GlobalObject* globalObject)
{
    return JSTelemetrySpanPrototype::create(vm, globalObject, JSTelemetrySpanPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

} // namespace Bun
