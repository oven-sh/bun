// Native OpenTelemetry: the active-span slot (see TelemetryContext.h for the
// layout): enter/exit, and what integrations read from it.

#include "root.h"
#include "TelemetryContext.h"
#include "TelemetryInternal.h"
#include "BunClientData.h"
#include <JavaScriptCore/FrameTracers.h>

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
    for (unsigned i = 0; i < storeValues; ++i) {
        JSValue v = stores.array->tryGetIndexQuickly(stores.storesStart + i);
        values.append(v ? v : jsUndefined());
    }
    RELEASE_ASSERT(!values.hasOverflowed());
    return constructArray(globalObject, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), values);
}

// An empty api Context (ROOT_CONTEXT): no active span, ALS stores kept.
static JSValue clearActiveSpanKeepingStores(Zig::GlobalObject* globalObject)
{
    auto* data = globalObject->m_asyncContextData.get();
    JSValue prev = data->getInternalField(0);
    data->putInternalField(globalObject->vm(), 0, TelemetryContextSlot::build(globalObject, JSValue(), JSValue(), TelemetryContextSlot::read(prev)));
    return prev;
}

// enterContext(header | undefined, extras | undefined) → previous slot value.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryEnterContext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue header = callFrame->argument(0);
    JSValue extras = callFrame->argument(1);
    if (TelemetryContextSlot::isHeader(header))
        return Bun__Telemetry__enterWithExtras(globalObject, JSValue::encode(header), JSValue::encode(extras));
    // Extras with no span ride on a placeholder header (telemetry.ts placeholderSpan).
    ASSERT(!extras.isCell());
    return JSValue::encode(clearActiveSpanKeepingStores(globalObject));
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

bool TelemetryContextSlot::stubAsParent(JSGlobalObject* globalObject, TelemetrySpanStub* out) const
{
    if (auto* span = cell()) {
        if (const auto* stub = span->stubAsParent()) {
            *out = *stub;
            return true;
        }
        return false;
    }
    if (auto handle = poolHandle())
        return Bun__Telemetry__poolStub(globalObject, handle, out);
    return false;
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
/// (Node's `enterWith` semantics, as `ALS.run` does).
extern "C" void Bun__Telemetry__exit(Zig::GlobalObject* globalObject, JSC::EncodedJSValue prevValue)
{
    auto* data = globalObject->m_asyncContextData.get();
    JSValue prev = JSValue::decode(prevValue);
    JSValue cur = data->getInternalField(0);
    // Fast path (the common case): neither slot carries ALS stores.
    auto now = TelemetryContextSlot::read(cur);
    auto before = TelemetryContextSlot::read(prev);
    unsigned n = now.storeValueCount();
    bool same = before.storeValueCount() == n;
    for (unsigned i = 0; same && i < n; ++i)
        same = now.array->tryGetIndexQuickly(now.storesStart + i) == before.array->tryGetIndexQuickly(before.storesStart + i);
    if (!same) {
        // Callers restore on their unwind path too (Entered::drop, a throwing
        // startActiveSpan callback): allocate with any pending exception set aside.
        JSC::SuspendExceptionScope suspend(globalObject->vm());
        prev = TelemetryContextSlot::build(globalObject, before.header, before.extras, now);
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
    // Slot values are immutable (async_hooks.ts); the pool caches the cell,
    // so every later call sees the same object anyway.
    JSValue cell = JSValue::decode(Bun__Telemetry__poolMaterialize(globalObject, slot.poolHandle()));
    return JSValue::encode(cell.isCell() ? cell : jsUndefined());
}

extern "C" Bun::TelemetryNativeHandle Bun__Telemetry__activeNativeHandle(Zig::GlobalObject* globalObject)
{
    auto slot = TelemetryContextSlot::current(globalObject);
    if (auto* span = Bun::toTelemetrySpan(slot.header))
        return span->m_native;
    return slot.poolHandle();
}

extern "C" bool Bun__Telemetry__activeSpanStub(Zig::GlobalObject* globalObject, Bun::TelemetrySpanStub* out)
{
    return TelemetryContextSlot::current(globalObject).stubAsParent(globalObject, out);
}

extern "C" JSC::EncodedJSValue Bun__Telemetry__activeExtras(Zig::GlobalObject* globalObject)
{
    JSValue extras = TelemetryContextSlot::current(globalObject).extras;
    return JSValue::encode(extras ? extras : jsUndefined());
}

/// What the active api Context (e.g. `context.with(propagation.extract(...), ...)`)
/// says about Baggage: Inherit (nothing — use the request's inbound header),
/// Masked (deleteBaggage / an empty Baggage — send none), or Header
/// (`*outHeader` is its W3C `baggage` header, +1 ref). A failure to
/// serialize is swallowed (Inherit), never left pending.
extern "C" Bun::TelemetryBaggageOverride Bun__Telemetry__activeExtrasBaggage(Zig::GlobalObject* globalObject, BunString* outHeader)
{
    using Bun::TelemetryBaggageOverride;
    JSValue extras = TelemetryContextSlot::current(globalObject).extras;
    if (!extras || !extras.isCell())
        return TelemetryBaggageOverride::Inherit;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue fn = Bun::telemetryInternalFunction(globalObject, WebCore::builtinNames(vm).baggageHeaderFromExtrasPublicName());
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return TelemetryBaggageOverride::Inherit;
    }
    MarkedArgumentBuffer args;
    args.append(extras);
    JSValue header = call(globalObject, fn, jsUndefined(), args, "baggageHeaderFromExtras"_s);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return TelemetryBaggageOverride::Inherit;
    }
    if (header.isNull())
        return TelemetryBaggageOverride::Masked;
    if (!header.isString() || !asString(header)->length())
        return TelemetryBaggageOverride::Inherit;
    BunString out = Bun::toStringRef(globalObject, header);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return TelemetryBaggageOverride::Inherit;
    }
    *outHeader = out;
    return TelemetryBaggageOverride::Header;
}
