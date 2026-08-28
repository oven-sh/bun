#include "root.h"

#include "JSTelemetrySpan.h"
#include "TelemetryContext.h"
#include "TelemetryInternal.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include "JSDOMException.h"
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/DOMJITSignature.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
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

JSTelemetrySpan* JSTelemetrySpan::createOwned(VM& vm, Zig::GlobalObject* globalObject, const TelemetrySpanStub& stub, uint16_t scope, uint8_t kind, JSString* name)
{
    Structure* structure = globalObject->JSTelemetrySpanStructure();
    auto* cell = new (NotNull, allocateCell<JSTelemetrySpan>(vm)) JSTelemetrySpan(vm, structure);
    cell->finishCreation(vm, stub, scope, kind, name, TelemetryNativeHandle {});
    return cell;
}

JSTelemetrySpan* JSTelemetrySpan::createNative(VM& vm, Zig::GlobalObject* globalObject, const TelemetrySpanStub& stub, uint16_t scope, uint8_t kind, TelemetryNativeHandle handle)
{
    ASSERT(handle);
    Structure* structure = globalObject->JSTelemetrySpanStructure();
    auto* cell = new (NotNull, allocateCell<JSTelemetrySpan>(vm)) JSTelemetrySpan(vm, structure);
    cell->finishCreation(vm, stub, scope, kind, nullptr, handle);
    return cell;
}

void JSTelemetrySpan::finishCreation(VM& vm, const TelemetrySpanStub& stub, uint16_t scope, uint8_t kind, JSString* nameOrNull, TelemetryNativeHandle handle)
{
    Base::finishCreation(vm);
    m_stub = stub;
    m_native = handle;
    m_scope = scope;
    m_kind = kind;
    int32_t state = (stub.isRecording() ? Recording : 0) | (handle ? Native : 0);
    field(Field::State).setWithoutWriteBarrier(jsNumber(state));
    field(Field::Attributes).setWithoutWriteBarrier(jsNull());
    field(Field::Name).set(vm, this, nameOrNull ? JSValue(nameOrNull) : jsNull());
    field(Field::Events).setWithoutWriteBarrier(jsNull());
    field(Field::Links).setWithoutWriteBarrier(jsNull());
    field(Field::StatusCode).setWithoutWriteBarrier(jsNumber(0));
    field(Field::StatusMessage).setWithoutWriteBarrier(jsNull());
    field(Field::TraceState).setWithoutWriteBarrier(jsNull());
    field(Field::Baggage).setWithoutWriteBarrier(jsNull());
    field(Field::Restore).setWithoutWriteBarrier(JSValue());
    field(Field::Context).setWithoutWriteBarrier(JSValue());
    field(Field::AttributeIndex).setWithoutWriteBarrier(jsNull());
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

extern "C" JSC::EncodedJSValue Bun__TelemetrySpan__createNative(Zig::GlobalObject* globalObject, const TelemetrySpanStub* stub, uint16_t scope, uint8_t kind, TelemetryNativeHandle native)
{
    return JSValue::encode(JSTelemetrySpan::createNative(globalObject->vm(), globalObject, *stub, scope, kind, native));
}

static void markEnded(Zig::GlobalObject*, JSTelemetrySpan*);

/// A pooled span with a materialized cell ended natively: the same Ended
/// transition as end(). The pool slot is gone after this, so what the cell
/// read from it lazily (name, tracestate, baggage) moves onto the cell now
/// unless already there. `snapshot` is null for a discarded span.
extern "C" void Bun__TelemetrySpan__nativeEnded(JSC::EncodedJSValue v, const Bun::TelemetryCellSnapshot* snapshot)
{
    auto* span = toTelemetrySpan(JSValue::decode(v));
    if (!span)
        return;
    auto* globalObject = defaultGlobalObject(span->globalObject());
    using Field = JSTelemetrySpan::Field;
    if (snapshot) {
        auto& vm = globalObject->vm();
        auto make = [&](const uint8_t* p, size_t n) -> JSString* {
            return n ? jsString(vm, WTF::String::fromUTF8ReplacingInvalidSequences(std::span { p, n })) : jsEmptyString(vm);
        };
        if (!span->string(Field::Name))
            span->field(Field::Name).set(vm, span, make(snapshot->name, snapshot->nameLen));
        if (span->get(Field::TraceState).isNull()) {
            span->field(Field::TraceState).set(vm, span, make(snapshot->traceState, snapshot->traceStateLen));
            span->field(Field::Baggage).set(vm, span, make(snapshot->baggage, snapshot->baggageLen));
        }
    }
    if (!span->ended())
        markEnded(globalObject, span);
}

extern "C" bool Bun__TelemetrySpan__is(JSC::EncodedJSValue v)
{
    return !!toTelemetrySpan(JSValue::decode(v));
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
// Turns the builtins' flat `[key0, value0, …]` arrays (or a plain object's
// own properties) into TelemetryAttrRefs for one Rust call. Only own,
// already-present elements are read; no JS runs and nothing throws, so the
// borrowed strings stay valid until the call returns.

// A `{ key: value, … }` whose own enumerable properties can be walked off its
// Structure without running JS (no getters, proxies or indexed storage).
static bool isPlainAttributesObject(JSObject* object)
{
    return object->type() == FinalObjectType && object->structure()->canPerformFastPropertyEnumeration() && !hasIndexedProperties(object->indexingType());
}

class TelemetryAttrGatherer {
public:
    TelemetryAttrPool pool() const
    {
        return { m_items.begin(), m_arrayItems.begin(), static_cast<uint32_t>(m_items.size()), static_cast<uint32_t>(m_arrayItems.size()) };
    }
    unsigned dropped() const { return m_dropped; }

    // null | JSArray [key0, value0, …] → the slice of pool().items it fills.
    // Pairs past `maxPairs` are counted in dropped() instead.
    TelemetryAttrSlice gather(JSValue flat, unsigned maxPairs = kTelemetryMaxGather);
    TelemetryAttrSlice gatherOne(JSString* key, JSValue value);
    // An isPlainAttributesObject's own enumerable properties, keys borrowed
    // from its Structure. No cap: the pooled span applies limits.attributes
    // and counts what it drops.
    TelemetryAttrSlice gatherPlainObject(VM&, JSObject*);

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

TelemetryAttrSlice TelemetryAttrGatherer::gather(JSValue flatValue, unsigned maxPairs)
{
    uint32_t start = m_items.size();
    auto* flat = telemetryArray(flatValue);
    if (!flat)
        return { start, 0 };
    unsigned n = flat->length() & ~1u;
    if (n / 2 > maxPairs) {
        m_dropped += n / 2 - maxPairs;
        n = 2 * maxPairs;
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

TelemetryAttrSlice TelemetryAttrGatherer::gatherPlainObject(VM& vm, JSObject* object)
{
    ASSERT(isPlainAttributesObject(object));
    uint32_t start = m_items.size();
    object->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
        if ((entry.attributes() & PropertyAttribute::DontEnum) || entry.key()->isSymbol())
            return true;
        JSValue v = object->getDirect(entry.offset());
        if (v.isUndefinedOrNull())
            return true;
        m_items.grow(m_items.size() + 1);
        if (!fill(m_items.last(), v, true)) {
            m_items.shrink(m_items.size() - 1);
            return true;
        }
        m_items.last().key = Bun::toString(static_cast<WTF::StringImpl*>(entry.key()));
        return true;
    });
    return { start, static_cast<uint32_t>(m_items.size() - start) };
}

// ─── end ───

// The Ended transition. A span that made itself active (`span(name)`,
// `startActiveSpan(name)`, `enter()`) and still is — in this async frame —
// stops being active here when it ends. Activation is per frame, so
// `Restore` is kept for the owning frame's `[Symbol.dispose]` / `exit()` (an
// `end()` from a timer or a Promise.all branch must not disarm it), minus any
// AsyncLocalStorage stores it captured: from here on only the previous span
// header/extras are needed, and the stores would otherwise stay reachable for
// as long as the span object does. Never runs JS and never leaves an
// exception pending (an OOM while trimming keeps the untrimmed Restore).
static void markEnded(Zig::GlobalObject* globalObject, JSTelemetrySpan* span)
{
    auto& vm = globalObject->vm();
    span->setState((span->state() | JSTelemetrySpan::Ended) & ~JSTelemetrySpan::Recording);
    JSValue prev = span->get(JSTelemetrySpan::Field::Restore);
    if (!prev)
        return;
    if (TelemetryContextSlot::current(globalObject).denotes(span))
        Bun__Telemetry__exit(globalObject, JSValue::encode(prev));
    auto before = TelemetryContextSlot::read(prev);
    if (!before.storeValueCount())
        return;
    SuspendExceptionScope suspend(vm); // may run while unwinding (Symbol.dispose)
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue trimmed = TelemetryContextSlot::build(globalObject, before.header, before.extras, TelemetryContextSlot {});
    if (scope.exception()) [[unlikely]] {
        scope.clearException();
        return;
    }
    span->field(JSTelemetrySpan::Field::Restore).set(vm, span, trimmed ? trimmed : jsUndefined());
}

// Ends `span` at `endNs` (0 = now): JS-owned spans are gathered and encoded,
// native-owned spans end their pool slot. No-op if already ended. Never runs
// JS and never throws (see markEnded).
void telemetryEndSpan(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, uint64_t endNs)
{
    int32_t state = span->state();
    if (state & JSTelemetrySpan::Ended)
        return;
    markEnded(globalObject, span);
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
            events.append(TelemetryEventRef { .name = telemetryBorrow(name), .timeNs = telemetryTimeInputToNs(list->tryGetIndexQuickly(i * 3 + 1)), .attrs = gatherer.gather(list->tryGetIndexQuickly(i * 3 + 2)) });
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
            links.append(TelemetryLinkRef { .traceId = telemetryBorrow(traceId), .spanId = telemetryBorrow(spanId), .traceState = telemetryBorrow(telemetryArrayString(list, i * 5 + 4)), .attrs = gatherer.gather(list->tryGetIndexQuickly(i * 5 + 3)), .traceFlags = static_cast<uint8_t>(flags.isInt32() ? flags.asInt32() : 0) });
        }
    }

    JSValue status = span->get(Field::StatusCode);
    TelemetryEndDesc desc {
        .stub = &span->m_stub,
        .endNs = endNs,
        .name = telemetryBorrow(span->string(Field::Name)),
        .statusMessage = telemetryBorrow(span->string(Field::StatusMessage)),
        .traceState = telemetryBorrow(span->string(Field::TraceState)),
        .pool = gatherer.pool(),
        .attrs = attrs,
        .events = events.begin(),
        .links = links.begin(),
        .nEvents = static_cast<uint32_t>(events.size()),
        .nLinks = static_cast<uint32_t>(links.size()),
        .droppedAttrs = gatherer.dropped(),
        .scope = span->m_scope,
        .kind = span->m_kind,
        .status = static_cast<uint8_t>(status.isInt32() ? status.asInt32() : 0),
    };
    Bun__Telemetry__encodeSpan(globalObject, &desc);

    span->field(Field::Attributes).setWithoutWriteBarrier(jsNull());
    span->field(Field::AttributeIndex).setWithoutWriteBarrier(jsNull());
    span->field(Field::Events).setWithoutWriteBarrier(jsNull());
    span->field(Field::Links).setWithoutWriteBarrier(jsNull());
}

// ─── native-owned span mutators (private globals used by TelemetrySpan.ts) ───

bool telemetryNativeSetAttribute(Zig::GlobalObject* globalObject, TelemetryNativeHandle handle, JSString* key, JSValue value)
{
    TelemetryAttrGatherer gatherer;
    gatherer.gatherOne(key, value);
    TelemetryAttrPool pool = gatherer.pool();
    return Bun__Telemetry__nativeSetAttributes(globalObject, handle, &pool);
}

// $isTelemetrySpan(value): the builtins' brand check before @getInternalField.
JSC_DEFINE_HOST_FUNCTION(jsIsTelemetrySpan, (JSGlobalObject*, CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(toTelemetrySpan(callFrame->argument(0))));
}

// $telemetrySpanEnd(span) / $telemetrySpanFailNoJS(span, error): for the
// telemetryTraceSettled builtin (promise reactions of a traced call).
JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanEndPrivate, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    if (auto* span = toTelemetrySpan(callFrame->argument(0)))
        telemetryEndSpan(defaultGlobalObject(lexicalGlobalObject), span, 0);
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanFailNoJSPrivate, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    if (auto* span = toTelemetrySpan(callFrame->argument(0)))
        telemetryFailSpanNoJS(defaultGlobalObject(lexicalGlobalObject), span, callFrame->argument(1));
    return JSValue::encode(jsUndefined());
}

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

// Every attribute of a plain `object` onto a pooled span in one call. False
// (nothing set) when `object` needs JS to enumerate.
static bool telemetryNativeSetAttributesOf(Zig::GlobalObject* globalObject, TelemetryNativeHandle handle, JSObject* object)
{
    if (!isPlainAttributesObject(object))
        return false;
    TelemetryAttrGatherer gatherer;
    if (gatherer.gatherPlainObject(globalObject->vm(), object).length) {
        TelemetryAttrPool pool = gatherer.pool();
        Bun__Telemetry__nativeSetAttributes(globalObject, handle, &pool);
    }
    return true;
}

// $telemetrySetAttributes(span, attributes: object | null, flat: [key0, value0, …] | null):
// false when `attributes` needs JS to enumerate — flatten it and pass `flat` instead.
JSC_DEFINE_HOST_FUNCTION(jsTelemetrySetAttributes, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* span = toTelemetrySpan(callFrame->argument(0));
    if (!span || !span->m_native)
        return JSValue::encode(jsBoolean(true));
    JSValue flat = callFrame->argument(2);
    if (flat.isCell()) {
        // No cap, like gatherPlainObject: every pair reaches the pooled span.
        TelemetryAttrGatherer gatherer;
        if (gatherer.gather(flat, std::numeric_limits<unsigned>::max()).length) {
            TelemetryAttrPool pool = gatherer.pool();
            Bun__Telemetry__nativeSetAttributes(globalObject, span->m_native, &pool);
        }
        return JSValue::encode(jsBoolean(true));
    }
    JSValue attributes = callFrame->argument(1);
    return JSValue::encode(jsBoolean(attributes.isObject() && telemetryNativeSetAttributesOf(globalObject, span->m_native, asObject(attributes))));
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
    TelemetryEventRef event { .name = telemetryBorrow(asString(name)), .timeNs = telemetryTimeInputToNs(time), .attrs = gatherer.gather(flat) };
    TelemetryAttrPool pool = gatherer.pool();
    Bun__Telemetry__nativeAddEvent(globalObject, span->m_native, &event, &pool);
    return JSValue::encode(jsUndefined());
}

// $telemetryAddLink(span, traceId: string, spanId: string, traceFlags: int32, flatAttributes: unknown[] | null, traceState: string)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryAddLink, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* span = toTelemetrySpan(callFrame->argument(0));
    JSValue traceId = callFrame->argument(1), spanId = callFrame->argument(2), flags = callFrame->argument(3), traceState = callFrame->argument(5);
    if (!span || !span->m_native || !traceId.isString() || !spanId.isString())
        return JSValue::encode(jsUndefined());
    TelemetryAttrGatherer gatherer;
    TelemetryLinkRef link { .traceId = telemetryBorrow(asString(traceId)), .spanId = telemetryBorrow(asString(spanId)), .traceState = telemetryBorrow(traceState.isString() ? asString(traceState) : nullptr), .attrs = gatherer.gather(callFrame->argument(4)), .traceFlags = static_cast<uint8_t>(flags.isInt32() ? flags.asInt32() : 0) };
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
JSC_DECLARE_JIT_OPERATION(telemetrySpanEndWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject*, JSTelemetrySpan*));
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

// = TelemetrySpan.ts Attributes.IndexFrom: below this many buffered attribute
// elements a repeated key is found by a scan, from it on by Field::AttributeIndex.
static constexpr unsigned kAttributeIndexFrom = 64;

// span.setAttribute(key, value) from C++ (what the TelemetrySpan.ts builtin does).
// Throws only on OOM.
void telemetrySpanSetAttribute(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, JSString* key, JSValue value)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!(span->state() & JSTelemetrySpan::Recording) || value.isUndefinedOrNull())
        return;
    if (span->m_native) {
        telemetryNativeSetAttribute(globalObject, span->m_native, key, value);
        return;
    }
    using Field = JSTelemetrySpan::Field;
    JSArray* attrs = telemetryArray(span->get(Field::Attributes));
    if (!attrs) {
        attrs = constructEmptyArray(globalObject, nullptr, 0);
        RETURN_IF_EXCEPTION(scope, );
        span->field(Field::Attributes).set(vm, span, attrs);
    } else if (unsigned n = attrs->length(); n < kAttributeIndexFrom) {
        // Keys stay unique: last write wins.
        for (unsigned i = 0; i + 1 < n; i += 2) {
            JSValue k = attrs->tryGetIndexQuickly(i);
            if (!k || !k.isString())
                continue;
            bool same = asString(k) == key || asString(k)->equal(globalObject, key);
            RETURN_IF_EXCEPTION(scope, );
            if (same) {
                attrs->putDirectIndex(globalObject, i + 1, value);
                RETURN_IF_EXCEPTION(scope, );
                return;
            }
        }
    } else {
        // TelemetrySpan.ts telemetrySpanSetAttributeIndexed
        JSValue indexValue = span->get(Field::AttributeIndex);
        auto* index = indexValue.isCell() ? dynamicDowncast<JSMap>(indexValue.asCell()) : nullptr;
        if (!index) {
            index = JSMap::create(vm, globalObject->mapStructure());
            for (unsigned i = 0; i + 1 < n; i += 2) {
                JSValue k = attrs->tryGetIndexQuickly(i);
                if (!k || !k.isString())
                    continue;
                index->set(globalObject, k, jsNumber(i));
                RETURN_IF_EXCEPTION(scope, );
            }
            span->field(Field::AttributeIndex).set(vm, span, index);
        }
        JSValue at = index->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, );
        if (at.isNumber()) {
            attrs->putDirectIndex(globalObject, static_cast<unsigned>(at.asNumber()) + 1, value);
            RETURN_IF_EXCEPTION(scope, );
            return;
        }
        index->set(globalObject, key, jsNumber(n));
        RETURN_IF_EXCEPTION(scope, );
    }
    attrs->push(globalObject, key);
    RETURN_IF_EXCEPTION(scope, );
    attrs->push(globalObject, value);
    RETURN_IF_EXCEPTION(scope, );
}

// span.setAttributes(object) from C++. Plain objects take a direct walk of
// their own enumerable properties.
void telemetrySpanSetAttributes(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, JSValue attributes)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!attributes.isObject() || !(span->state() & JSTelemetrySpan::Recording))
        return;
    JSObject* object = asObject(attributes);
    if (span->m_native) {
        if (telemetryNativeSetAttributesOf(globalObject, span->m_native, object))
            return;
    } else if (isPlainAttributesObject(object)) {
        using Field = JSTelemetrySpan::Field;
        bool fresh = !span->get(Field::Attributes).isCell();
        MarkedArgumentBuffer flat;
        object->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
            if (entry.attributes() & PropertyAttribute::DontEnum)
                return true;
            if (entry.key()->isSymbol())
                return true;
            JSValue value = object->getDirect(entry.offset());
            if (value.isUndefinedOrNull())
                return true;
            JSString* key = jsString(vm, String(*entry.key()));
            if (fresh) {
                flat.append(key);
                flat.append(value);
                return true;
            }
            telemetrySpanSetAttribute(globalObject, span, key, value);
            return !scope.exception();
        });
        RETURN_IF_EXCEPTION(scope, );
        if (fresh && flat.size()) {
            // A new span's attributes in one contiguous array (keys of one object are unique).
            JSArray* array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), flat);
            RETURN_IF_EXCEPTION(scope, );
            span->field(Field::Attributes).set(vm, span, array);
        }
        return;
    }
    // Anything exotic goes through the private builtin (not the user-writable prototype method).
    JSObject* impl = globalObject->getDirect(vm, WebCore::builtinNames(vm).telemetrySpanSetAttributesImplPrivateName()).getObject();
    MarkedArgumentBuffer args;
    args.append(span);
    args.append(attributes);
    call(globalObject, impl, jsUndefined(), args, "setAttributes"_s);
    RETURN_IF_EXCEPTION(scope, );
}

// `exit()` / `[Symbol.dispose]` / the end of `span(name, fn)`: put back what
// `enter()` displaced in this frame — like leaving `AsyncLocalStorage.run`,
// whatever a callee entered and left behind goes too — and disarm.
void telemetryExitSpan(Zig::GlobalObject* globalObject, JSTelemetrySpan* span)
{
    JSValue prev = span->get(JSTelemetrySpan::Field::Restore);
    if (!prev)
        return;
    Bun__Telemetry__exit(globalObject, JSValue::encode(prev));
    span->field(JSTelemetrySpan::Field::Restore).setWithoutWriteBarrier(JSValue());
}

void telemetryEnterSpan(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, JSValue extras)
{
    if (span->get(JSTelemetrySpan::Field::Restore))
        return;
    JSValue prev = JSValue::decode(Bun__Telemetry__enterWithExtras(globalObject, JSValue::encode(span), JSValue::encode(extras)));
    span->field(JSTelemetrySpan::Field::Restore).set(globalObject->vm(), span, prev ? prev : jsUndefined());
}

// span.fail(error) without running JS (getters, toString): for exceptions seen
// while unwinding. The same rule as TelemetrySpan.ts telemetryErrorType / fail:
// ErrorInstance code/name/message and DOMException name/message are read
// directly, a primitive is the message, any other object contributes only the
// generic type "Error".
void telemetryFailSpanNoJS(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, JSValue error)
{
    auto& vm = globalObject->vm();
    int32_t state = span->state();
    if (!(state & JSTelemetrySpan::Recording))
        return;
    // May run while `error` is still the pending exception (unwinding).
    SuspendExceptionScope suspendException(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    WTF::String type, message; // type: null = the value is a primitive (no exception.type)
    if (auto* instance = error.isCell() ? dynamicDowncast<ErrorInstance>(error.asCell()) : nullptr) {
        JSValue code = instance->getDirect(vm, WebCore::builtinNames(vm).codePublicName());
        if (code && code.isString())
            type = asString(code)->tryGetValue();
        if (type.isEmpty()) {
            type = instance->sanitizedNameString(globalObject);
            scope.clearException();
        }
        if (type.isEmpty())
            type = "Error"_s;
        message = instance->sanitizedMessageString(globalObject);
        scope.clearException();
    } else if (auto* dom = error.isCell() ? dynamicDowncast<WebCore::JSDOMException>(error.asCell()) : nullptr) {
        // (its numeric legacy `code` is not a type)
        type = dom->wrapped().name();
        if (type.isEmpty())
            type = "Error"_s;
        message = dom->wrapped().message();
    } else if (error.isString()) {
        message = asString(error)->tryGetValue();
    } else if (error.isNumber()) {
        message = WTF::String::number(error.asNumber());
    } else if (error.isBoolean()) {
        message = error.isTrue() ? "true"_s : "false"_s;
    } else if (error.isHeapBigInt()) {
        message = JSBigInt::tryGetString(vm, error.asHeapBigInt(), 10);
#if USE(BIGINT32)
    } else if (error.isBigInt32()) {
        message = WTF::String::number(error.bigInt32AsInt32());
#endif
    } else if (error.isObject()) {
        type = "Error"_s; // an object we cannot read without JS
    }
    // undefined / null / Symbol: nothing to describe.

    MarkedArgumentBuffer flat;
    if (!type.isNull()) {
        flat.append(jsNontrivialString(vm, "exception.type"_s));
        flat.append(jsString(vm, type));
    }
    if (!message.isEmpty()) {
        flat.append(jsNontrivialString(vm, "exception.message"_s));
        flat.append(jsString(vm, message));
    }
    JSArray* flatArray = nullptr; // null = no exception event (OTel requires type or message on it)
    if (flat.size()) {
        flatArray = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), flat);
        if (scope.exception()) [[unlikely]] {
            scope.clearException(); // (an OOM while recording is dropped)
            return;
        }
    }
    // `error.type` attribute: none for a nullish error, like span.fail(undefined).
    JSString* errorType = error.isUndefinedOrNull() ? nullptr : jsString(vm, type.isNull() ? "Error"_s : type);
    BunString messageStr = Bun::toString(message);
    if (span->m_native) {
        if (flatArray) {
            TelemetryAttrGatherer gatherer;
            TelemetryEventRef event { .name = telemetryBorrow(jsNontrivialString(vm, "exception"_s)), .timeNs = 0, .attrs = gatherer.gather(flatArray) };
            TelemetryAttrPool pool = gatherer.pool();
            Bun__Telemetry__nativeAddEvent(globalObject, span->m_native, &event, &pool);
        }
        if (errorType) {
            TelemetryAttrGatherer attr;
            attr.gatherOne(jsNontrivialString(vm, "error.type"_s), errorType);
            TelemetryAttrPool attrPool = attr.pool();
            Bun__Telemetry__nativeSetAttributes(globalObject, span->m_native, &attrPool);
        }
        Bun__Telemetry__nativeSetStatus(globalObject, span->m_native, 2, &messageStr);
        return;
    }
    using Field = JSTelemetrySpan::Field;
    auto record = [&] {
        if (flatArray) {
            JSArray* events = telemetryArray(span->get(Field::Events));
            if (!events) {
                events = constructEmptyArray(globalObject, nullptr, 0);
                RETURN_IF_EXCEPTION(scope, );
                span->field(Field::Events).set(vm, span, events);
            }
            events->push(globalObject, jsNontrivialString(vm, "exception"_s));
            RETURN_IF_EXCEPTION(scope, );
            events->push(globalObject, jsNumber(static_cast<double>(Bun__Telemetry__nowNs()) / 1e6));
            RETURN_IF_EXCEPTION(scope, );
            events->push(globalObject, flatArray);
            RETURN_IF_EXCEPTION(scope, );
        }
        if (errorType) {
            telemetrySpanSetAttribute(globalObject, span, jsNontrivialString(vm, "error.type"_s), errorType);
            RETURN_IF_EXCEPTION(scope, );
        }
        if (span->get(Field::StatusCode).asInt32() != 1) {
            span->field(Field::StatusCode).set(vm, span, jsNumber(2));
            span->field(Field::StatusMessage).set(vm, span, message.isEmpty() ? jsEmptyString(vm) : jsString(vm, message));
        }
    };
    record();
    scope.clearException(); // (an OOM while recording is dropped)
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncEnter, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    telemetryEnterSpan(globalObject, span);
    return JSValue::encode(span);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncExit, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    telemetryExitSpan(globalObject, span);
    return JSValue::encode(span);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncDispose, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    // Leave the scope (lexical restore, disarms Restore), then end: end() has
    // no context work left to do.
    telemetryExitSpan(globalObject, span);
    telemetryEndSpan(globalObject, span, 0);
    return JSValue::encode(jsUndefined());
}

static JSString* hexId(VM& vm, std::span<const uint8_t> bytes)
{
    std::span<Latin1Character> buf;
    auto s = WTF::String::createUninitialized(bytes.size() * 2, buf);
    Bun__Telemetry__hexLower(bytes.data(), bytes.size(), buf.data());
    return jsString(vm, WTF::move(s));
}

TelemetryPropagation telemetryPropagationOfPooled(Zig::GlobalObject* globalObject, TelemetryNativeHandle handle)
{
    TelemetryPropagation out;
    if (!handle)
        return out;
    BunString traceState = { BunStringTag::Empty, {} }, baggage = { BunStringTag::Empty, {} };
    JSC::EncodedJSValue cell {};
    if (!Bun__Telemetry__nativePropagation(globalObject, handle, &traceState, &baggage, &cell))
        return out;
    // A span that already has a cell caches the headers in its fields.
    if (auto* span = toTelemetrySpan(JSValue::decode(cell)))
        return telemetryPropagationOf(globalObject, span);
    auto& vm = globalObject->vm();
    if (auto s = traceState.transferToWTFString(); !s.isEmpty())
        out.traceState = jsString(vm, WTF::move(s));
    if (auto s = baggage.transferToWTFString(); !s.isEmpty())
        out.baggage = jsString(vm, WTF::move(s));
    return out;
}

// A native-owned span's TraceState/Baggage fields start null and are filled
// from its slot on the first read; the empty string means "looked up, none".
static void fillNativePropagation(Zig::GlobalObject* globalObject, JSTelemetrySpan* span)
{
    using Field = JSTelemetrySpan::Field;
    if (!span->m_native || !span->get(Field::TraceState).isNull())
        return;
    auto& vm = globalObject->vm();
    BunString traceState = { BunStringTag::Empty, {} }, baggage = { BunStringTag::Empty, {} };
    Bun__Telemetry__nativePropagation(globalObject, span->m_native, &traceState, &baggage, nullptr);
    auto adopt = [&](BunString& header) -> JSString* {
        auto s = header.transferToWTFString();
        return s.isEmpty() ? jsEmptyString(vm) : jsString(vm, WTF::move(s));
    };
    span->field(Field::TraceState).set(vm, span, adopt(traceState));
    span->field(Field::Baggage).set(vm, span, adopt(baggage));
}

TelemetryPropagation telemetryPropagationOf(Zig::GlobalObject* globalObject, JSTelemetrySpan* span)
{
    using Field = JSTelemetrySpan::Field;
    fillNativePropagation(globalObject, span);
    TelemetryPropagation out;
    if (JSString* s = span->string(Field::TraceState); s && s->length())
        out.traceState = s;
    if (JSString* s = span->string(Field::Baggage); s && s->length())
        out.baggage = s;
    return out;
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
    if (JSString* header = telemetryPropagationOf(globalObject, span).traceState) {
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

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_ended, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsBoolean(span->ended()));
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
    { "set"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanSetCodeGenerator, 2 } },
    { "fail"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanFailCodeGenerator, 1 } },
    { "ok"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanOkCodeGenerator, 0 } },
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
