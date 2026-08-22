// Native OpenTelemetry: the active-span slot (see TelemetryContext.h for the
// layout) and the async-frame hook that gives it structured semantics.

#include "root.h"
#include "TelemetryContext.h"
#include "TelemetryInternal.h"
#include "BunClientData.h"

namespace Bun {
using namespace JSC;

JSValue TelemetryContextSlot::build(JSGlobalObject* globalObject, JSValue header, JSValue extras, const TelemetryContextSlot& stores)
{
    unsigned storeValues = stores.storeValueCount();
    bool hasExtras = extras && extras.isCell();
    ASSERT(!hasExtras || header);
    if (!storeValues && !hasExtras)
        return header ? header : jsUndefined();
    if (!header && stores.storesStart == 0)
        return stores.array;
    MarkedArgumentBuffer values;
    if (header) {
        values.append(header);
        values.append(hasExtras ? extras : jsNull());
    }
    for (unsigned i = 0; i < storeValues; ++i)
        values.append(stores.array->getIndexQuickly(stores.storesStart + i));
    RELEASE_ASSERT(!values.hasOverflowed());
    return constructArray(globalObject, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), values);
}

// An async function's synchronous prefix runs in its caller's frame, so a span
// activated there with `using span = tracer.startActiveSpan(...)` would
// otherwise stay active in the caller after the function first suspends
// (AsyncLocalStorage.enterWith has exactly that behaviour, by design). The
// span header gets structured semantics instead: when the function first
// returns to its caller, the caller sees the span it had at the call. ALS
// stores keep Node's enterWith semantics.
JSValue telemetryLeaveAsyncFrame(JSGlobalObject* globalObject, JSValue atEntry, JSValue current)
{
    auto entry = TelemetryContextSlot::read(atEntry);
    auto now = TelemetryContextSlot::read(current);
    if (entry.sameSpanContext(now))
        return current;
    return TelemetryContextSlot::build(globalObject, entry.header, entry.extras, now);
}

// enterContext(header | undefined, extras | undefined) → previous slot value.
// An empty api Context (e.g. ROOT_CONTEXT) clears the header but keeps ALS stores.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryEnterContext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue header = callFrame->argument(0);
    JSValue extras = callFrame->argument(1);
    if (!TelemetryContextSlot::isHeader(header)) {
        // Extras with no span ride on a placeholder header (telemetry.ts placeholderSpan).
        ASSERT(!extras.isCell());
        header = JSValue();
        extras = JSValue();
    }
    auto& vm = globalObject->vm();
    auto* data = globalObject->m_asyncContextData.get();
    JSValue prev = data->getInternalField(0);
    if (header)
        globalObject->setAsyncContextTrackingEnabled(true);
    auto stores = TelemetryContextSlot::read(prev);
    if (header && extras.isUndefined())
        extras = stores.extras; // a bare Span keeps the ambient extras
    data->putInternalField(vm, 0, TelemetryContextSlot::build(globalObject, header, extras, stores));
    return JSValue::encode(prev);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetryExitContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    Bun__Telemetry__exit(defaultGlobalObject(globalObject), JSValue::encode(callFrame->argument(0)));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetryActiveExtras, (JSGlobalObject * globalObject, CallFrame*))
{
    return Bun__Telemetry__activeExtras(defaultGlobalObject(globalObject));
}

} // namespace Bun

using namespace JSC;
using Bun::TelemetryContextSlot;

/// `extras`: a Map from an explicit api Context, null for a Context without
/// extras, or empty/undefined to keep the ambient ones (baggage etc.) —
/// `startActiveSpan(name)` is `context.with(setSpan(active(), span))`.
extern "C" JSC::EncodedJSValue Bun__Telemetry__enterWithExtras(Zig::GlobalObject* globalObject, JSC::EncodedJSValue headerValue, JSC::EncodedJSValue extrasValue)
{
    auto& vm = globalObject->vm();
    auto* data = globalObject->m_asyncContextData.get();
    JSValue prev = data->getInternalField(0);
    JSValue header = JSValue::decode(headerValue);
    JSValue extras = JSValue::decode(extrasValue);
    ASSERT(TelemetryContextSlot::isHeader(header));
    globalObject->setAsyncContextTrackingEnabled(true);
    if (prev.isUndefined() && !(extras && extras.isCell())) [[likely]] {
        data->putInternalField(vm, 0, header);
        return JSValue::encode(prev);
    }
    auto stores = TelemetryContextSlot::read(prev);
    if (!extras || extras.isUndefined())
        extras = stores.extras;
    data->putInternalField(vm, 0, TelemetryContextSlot::build(globalObject, header, extras, stores));
    return JSValue::encode(prev);
}

extern "C" JSC::EncodedJSValue Bun__Telemetry__enter(Zig::GlobalObject* globalObject, JSC::EncodedJSValue header)
{
    return Bun__Telemetry__enterWithExtras(globalObject, header, JSValue::encode(JSValue()));
}

/// Leave a scope entered with `enter*`: the span header/extras go back to
/// `prev`'s, but AsyncLocalStorage stores keep whatever the scope left there
/// (Node's `enterWith` semantics, as `ALS.run` and telemetryLeaveAsyncFrame do).
extern "C" void Bun__Telemetry__exit(Zig::GlobalObject* globalObject, JSC::EncodedJSValue prevValue)
{
    auto* data = globalObject->m_asyncContextData.get();
    JSValue prev = JSValue::decode(prevValue);
    JSValue cur = data->getInternalField(0);
    // Fast path: no ALS store was touched inside the scope unless the slot is
    // an array whose store pairs differ from prev's.
    auto now = TelemetryContextSlot::read(cur);
    if (now.array) {
        auto before = TelemetryContextSlot::read(prev);
        unsigned n = now.storeValueCount();
        bool same = before.storeValueCount() == n;
        for (unsigned i = 0; same && i < n; ++i)
            same = now.array->tryGetIndexQuickly(now.storesStart + i) == before.array->tryGetIndexQuickly(before.storesStart + i);
        if (!same) {
            prev = TelemetryContextSlot::build(globalObject, before.header, before.extras, now);
        }
    }
    data->putInternalField(globalObject->vm(), 0, prev);
}

extern "C" JSC::EncodedJSValue Bun__Telemetry__activeSpanCell(Zig::GlobalObject* globalObject)
{
    auto* data = globalObject->m_asyncContextData.get();
    auto slot = TelemetryContextSlot::read(data->getInternalField(0));
    if (!slot.header)
        return JSValue::encode(jsUndefined());
    if (slot.header.isCell())
        return JSValue::encode(slot.header);
    JSValue cell = JSValue::decode(Bun__Telemetry__poolMaterialize(globalObject, slot.poolHandle()));
    if (!cell.isCell())
        return JSValue::encode(jsUndefined());
    // Swap the cell in so this continuation keeps seeing the same object.
    if (slot.array)
        slot.array->putDirectIndex(globalObject, 0, cell);
    else
        data->putInternalField(globalObject->vm(), 0, cell);
    return JSValue::encode(cell);
}

extern "C" uint64_t Bun__Telemetry__activeNativeHandle(Zig::GlobalObject* globalObject)
{
    auto slot = TelemetryContextSlot::current(globalObject);
    if (auto* span = Bun::toTelemetrySpan(slot.header))
        return span->m_native;
    return slot.poolHandle();
}

/// Identity of the active span (points into the cell or pool slot), or null.
/// This is what fetch/sql/etc. call to find their parent.
extern "C" const Bun::TelemetrySpanStub* Bun__Telemetry__activeSpanStub(Zig::GlobalObject* globalObject)
{
    auto slot = TelemetryContextSlot::current(globalObject);
    if (auto* span = Bun::toTelemetrySpan(slot.header))
        return &span->m_stub;
    if (uint64_t handle = slot.poolHandle())
        return Bun__Telemetry__poolStub(globalObject, handle);
    return nullptr;
}

extern "C" JSC::EncodedJSValue Bun__Telemetry__activeExtras(Zig::GlobalObject* globalObject)
{
    JSValue extras = TelemetryContextSlot::current(globalObject).extras;
    return JSValue::encode(extras ? extras : jsUndefined());
}

/// The W3C `baggage` header for Baggage carried in the active api Context
/// (e.g. `context.with(propagation.extract(...), ...)`), or Empty. +1 ref.
/// A failure to serialize is swallowed (Empty), never left pending.
extern "C" BunString Bun__Telemetry__activeExtrasBaggage(Zig::GlobalObject* globalObject)
{
    JSValue extras = TelemetryContextSlot::current(globalObject).extras;
    if (!extras || !extras.isCell())
        return { BunStringTag::Empty, {} };
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue fn = Bun::telemetryInternalFunction(globalObject, WebCore::builtinNames(vm).baggageHeaderFromExtrasPublicName());
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return { BunStringTag::Empty, {} };
    }
    MarkedArgumentBuffer args;
    args.append(extras);
    JSValue header = call(globalObject, fn, jsUndefined(), args, "baggageHeaderFromExtras"_s);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return { BunStringTag::Empty, {} };
    }
    if (!header.isString() || !asString(header)->length())
        return { BunStringTag::Empty, {} };
    BunString out = Bun::toStringRef(globalObject, header);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return { BunStringTag::Empty, {} };
    }
    return out;
}
