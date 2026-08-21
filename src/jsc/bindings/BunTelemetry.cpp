// Native OpenTelemetry: async-context slot helpers.
//
// The AsyncLocalStorage slot (`m_asyncContextData` field 0) holds one of:
//   undefined              — nothing
//   JSTelemetrySpan        — an active span and no ALS stores
//   JSArray                — [key0, value0, key1, value1, ...] where each key is
//                            an AsyncLocalStorage instance, except that index 0
//                            may be a JSTelemetrySpan, in which case index 1 is
//                            the @opentelemetry/api Context's extra values
//                            (a JS Map) or null.
// AsyncLocalStorage compares keys by identity so the span entry is invisible
// to it; see async_hooks.ts.

#include "root.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include "BunTelemetry.h"
#include "InternalModuleRegistry.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/ObjectConstructor.h>

using namespace JSC;

namespace Bun {

static ALWAYS_INLINE JSTelemetrySpan* asSpan(JSValue value)
{
    return value && value.isCell() ? dynamicDowncast<JSTelemetrySpan>(value.asCell()) : nullptr;
}

static ALWAYS_INLINE JSTelemetrySpan* activeSpanFromSlot(JSValue slot)
{
    if (!slot.isCell())
        return nullptr;
    JSCell* cell = slot.asCell();
    if (auto* span = dynamicDowncast<JSTelemetrySpan>(cell))
        return span;
    if (auto* array = dynamicDowncast<JSArray>(cell)) {
        if (array->length() >= 2)
            return asSpan(array->getIndexQuickly(0));
    }
    return nullptr;
}

} // namespace Bun


extern "C" JSC::EncodedJSValue Bun__Telemetry__activeSpan(Zig::GlobalObject* globalObject)
{
    JSValue slot = globalObject->m_asyncContextData.get()->getInternalField(0);
    if (auto* span = Bun::activeSpanFromSlot(slot))
        return JSValue::encode(span);
    return JSValue::encode(JSValue());
}

/// Native payload of the active span, or null. This is what fetch/sql/etc.
/// call to find their parent: no JSValue decoding on the Rust side.
extern "C" void* Bun__Telemetry__activeSpanPtr(Zig::GlobalObject* globalObject)
{
    JSValue slot = globalObject->m_asyncContextData.get()->getInternalField(0);
    if (auto* span = Bun::activeSpanFromSlot(slot))
        return span->wrapped();
    return nullptr;
}

/// Make `spanValue` the active span (with optional api-Context extras).
/// Returns the previous slot value, which must be passed back to
/// `Bun__Telemetry__exit`.
extern "C" JSC::EncodedJSValue Bun__Telemetry__enterWithExtras(Zig::GlobalObject* globalObject, JSC::EncodedJSValue spanValue, JSC::EncodedJSValue extrasValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto* data = globalObject->m_asyncContextData.get();
    JSValue prev = data->getInternalField(0);
    JSValue span = JSValue::decode(spanValue);
    JSValue extras = JSValue::decode(extrasValue);
    bool hasExtras = extras && extras.isCell();
    JSValue next = span;
    JSArray* array = prev.isCell() ? dynamicDowncast<JSArray>(prev.asCell()) : nullptr;
    if (array || hasExtras) {
        unsigned length = array ? array->length() : 0;
        bool hasSpan = length >= 2 && Bun::asSpan(array->getIndexQuickly(0));
        unsigned first = hasSpan ? 2 : 0;
        if (length > first || hasExtras) {
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            MarkedArgumentBuffer args;
            args.append(span);
            args.append(hasExtras ? extras : jsNull());
            for (unsigned i = first; i < length; ++i)
                args.append(array->getIndexQuickly(i));
            next = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args);
            if (scope.exception()) [[unlikely]] {
                (void)scope.tryClearException();
                next = span;
            }
        }
    }
    globalObject->setAsyncContextTrackingEnabled(true);
    data->putInternalField(vm, 0, next);
    return JSValue::encode(prev);
}

extern "C" JSC::EncodedJSValue Bun__Telemetry__enter(Zig::GlobalObject* globalObject, JSC::EncodedJSValue spanValue)
{
    return Bun__Telemetry__enterWithExtras(globalObject, spanValue, JSValue::encode(jsUndefined()));
}

/// The api-Context extras riding with the active span, if any.
extern "C" JSC::EncodedJSValue Bun__Telemetry__activeExtras(Zig::GlobalObject* globalObject)
{
    JSValue slot = globalObject->m_asyncContextData.get()->getInternalField(0);
    if (auto* array = slot.isCell() ? dynamicDowncast<JSArray>(slot.asCell()) : nullptr) {
        if (array->length() >= 2 && Bun::asSpan(array->getIndexQuickly(0))) {
            JSValue extras = array->getIndexQuickly(1);
            if (extras.isCell())
                return JSValue::encode(extras);
        }
    }
    return JSValue::encode(jsUndefined());
}

extern "C" void Bun__Telemetry__exit(Zig::GlobalObject* globalObject, JSC::EncodedJSValue prevValue)
{
    auto& vm = JSC::getVM(globalObject);
    globalObject->m_asyncContextData.get()->putInternalField(vm, 0, JSValue::decode(prevValue));
}

/// The raw slot value, for capturing "the current context" to re-enter later
/// (e.g. ServerWebSocket handlers run under the upgrade request's context).
extern "C" JSC::EncodedJSValue Bun__Telemetry__currentContext(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->m_asyncContextData.get()->getInternalField(0));
}

/// Swap the whole slot (paired with `Bun__Telemetry__currentContext`).
extern "C" JSC::EncodedJSValue Bun__Telemetry__swapContext(Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto* data = globalObject->m_asyncContextData.get();
    JSValue prev = data->getInternalField(0);
    data->putInternalField(vm, 0, JSValue::decode(value));
    return JSValue::encode(prev);
}

/// Pre-populate the @opentelemetry/api global registry with the native
/// provider (see internal/telemetry.ts `installGlobal`).
extern "C" void Bun__Telemetry__installApiGlobal(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue moduleValue = globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::InternalTelemetry);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    JSObject* moduleObject = moduleValue.getObject();
    if (!moduleObject)
        return;
    JSValue install = moduleObject->get(globalObject, Identifier::fromString(vm, "installGlobal"_s));
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    if (!install.isCallable())
        return;
    MarkedArgumentBuffer args;
    JSC::profiledCall(globalObject, ProfilingReason::API, install, JSC::getCallData(install), moduleValue, args);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
}

// ── $newCppFunction("BunTelemetry.cpp", …) targets for internal/telemetry.ts ──

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsEnterWithExtras, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue span = callFrame->argument(0);
    JSValue extras = callFrame->argument(1);
    if (span.isUndefinedOrNull() && !extras.isCell()) {
        // Entering an empty api Context (e.g. ROOT_CONTEXT): clear the span
        // header but keep AsyncLocalStorage stores.
        auto* zig = uncheckedDowncast<Zig::GlobalObject>(globalObject);
        auto& vm = JSC::getVM(globalObject);
        auto* data = zig->m_asyncContextData.get();
        JSValue prev = data->getInternalField(0);
        JSValue next = jsUndefined();
        if (auto* array = prev.isCell() ? dynamicDowncast<JSArray>(prev.asCell()) : nullptr) {
            unsigned length = array->length();
            if (length >= 2 && asSpan(array->getIndexQuickly(0))) {
                if (length > 2) {
                    auto scope = DECLARE_THROW_SCOPE(vm);
                    MarkedArgumentBuffer args;
                    for (unsigned i = 2; i < length; ++i)
                        args.append(array->getIndexQuickly(i));
                    next = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args);
                    RETURN_IF_EXCEPTION(scope, {});
                }
            } else {
                next = prev;
            }
        }
        data->putInternalField(vm, 0, next);
        return JSValue::encode(prev);
    }
    if (!asSpan(span)) {
        // Extras but no span: use undefined in the header slot 0 is not
        // representable; callers pass a placeholder span (see telemetry.ts).
        span = jsNull();
    }
    return Bun__Telemetry__enterWithExtras(uncheckedDowncast<Zig::GlobalObject>(globalObject), JSValue::encode(span), JSValue::encode(extras));
}

JSC_DEFINE_HOST_FUNCTION(jsExitContext, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue prev = callFrame->argument(0);
    Bun__Telemetry__exit(uncheckedDowncast<Zig::GlobalObject>(globalObject), JSValue::encode(prev));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsActiveExtras, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return Bun__Telemetry__activeExtras(uncheckedDowncast<Zig::GlobalObject>(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsIsTelemetrySpan, (JSC::JSGlobalObject*, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(asSpan(callFrame->argument(0)) != nullptr));
}

} // namespace Bun

// ── VM::asyncContextLeaveAsyncFrameHook ────────────────────────────────────
//
// An async function's synchronous prefix runs in its caller's frame, so a
// span activated there with `using span = tracer.startActiveSpan(...)` would
// otherwise stay active in the caller after the function first suspends
// (AsyncLocalStorage.enterWith has exactly that behaviour, by design). For the
// span header we want structured semantics instead: when the function first
// returns to its caller, the caller sees the span it had at the call. ALS
// stores keep Node's enterWith semantics.
namespace Bun {

JSC::JSValue telemetryLeaveAsyncFrame(JSC::JSGlobalObject* globalObject, JSC::JSValue atEntry, JSC::JSValue current)
{

    auto header = [](JSValue v, JSValue& span, JSValue& extras, JSArray*& array, unsigned& pairsStart) {
        span = JSValue();
        extras = jsNull();
        array = nullptr;
        pairsStart = 0;
        if (!v.isCell())
            return;
        if (Bun::asSpan(v)) {
            span = v;
            return;
        }
        if (auto* a = dynamicDowncast<JSArray>(v.asCell())) {
            array = a;
            if (a->length() >= 2 && Bun::asSpan(a->getIndexQuickly(0))) {
                span = a->getIndexQuickly(0);
                extras = a->getIndexQuickly(1);
                pairsStart = 2;
            }
        }
    };

    JSValue entrySpan, entryExtras, currentSpan, currentExtras;
    JSArray *entryArray, *currentArray;
    unsigned entryPairs, currentPairs;
    header(atEntry, entrySpan, entryExtras, entryArray, entryPairs);
    header(current, currentSpan, currentExtras, currentArray, currentPairs);

    if (entrySpan == currentSpan && entryExtras == currentExtras)
        return current;

    unsigned pairCount = currentArray ? currentArray->length() - currentPairs : 0;
    if (!pairCount && !(entrySpan && entryExtras.isCell()))
        return entrySpan ? entrySpan : jsUndefined();

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    MarkedArgumentBuffer args;
    if (entrySpan) {
        args.append(entrySpan);
        args.append(entryExtras);
    }
    if (currentArray) {
        for (unsigned i = currentPairs; i < currentArray->length(); ++i)
            args.append(currentArray->getIndexQuickly(i));
    }
    JSValue result = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return current;
    }
    return result;
}

} // namespace Bun
