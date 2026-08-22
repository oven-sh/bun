#pragma once
#include "root.h"
#include "TelemetryABI.h"
#include "JSTelemetrySpan.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSArray.h>

// The active span lives in the AsyncLocalStorage slot (`m_asyncContextData`
// field 0), which holds one of:
//   undefined
//   header                                — a span and no ALS stores
//   [header, extras, key0, value0, …]     — a span (+ api Context extras) and ALS stores
//   [key0, value0, …]                     — ALS stores only
// `header` is a JSTelemetrySpan cell or a bun_telemetry::pool handle carried
// as a number (request spans get a cell only when JS asks for one); `extras`
// is the @opentelemetry/api Context's non-span values (a Map) or null.
// AsyncLocalStorage matches keys by identity, so the header pair is invisible
// to it; async_hooks.ts only preserves indices 0–1 when it rebuilds the array.

extern "C" {
JSC::EncodedJSValue Bun__Telemetry__enterWithExtras(Zig::GlobalObject*, JSC::EncodedJSValue header, JSC::EncodedJSValue extras);
JSC::EncodedJSValue Bun__Telemetry__enter(Zig::GlobalObject*, JSC::EncodedJSValue header);
void Bun__Telemetry__exit(Zig::GlobalObject*, JSC::EncodedJSValue prev);
// The active span as a cell (materializing one for a pooled span), or undefined.
JSC::EncodedJSValue Bun__Telemetry__activeSpanCell(Zig::GlobalObject*);
JSC::EncodedJSValue Bun__Telemetry__activeExtras(Zig::GlobalObject*);
const Bun::TelemetrySpanStub* Bun__Telemetry__activeSpanStub(Zig::GlobalObject*);
// Pool handle of the active span if it is native-owned, else 0.
uint64_t Bun__Telemetry__activeNativeHandle(Zig::GlobalObject*);
}

namespace Bun {

struct TelemetryContextSlot {
    JSC::JSValue header {};
    JSC::JSValue extras {};
    // The slot's array, if it is one; ALS pairs start at `storesStart`.
    JSC::JSArray* array { nullptr };
    unsigned storesStart { 0 };

    static bool isHeader(JSC::JSValue v) { return v.isNumber() || toTelemetrySpan(v); }
    static ALWAYS_INLINE TelemetryContextSlot read(JSC::JSValue slot);
    static ALWAYS_INLINE TelemetryContextSlot current(Zig::GlobalObject* globalObject) { return read(globalObject->m_asyncContextData.get()->getInternalField(0)); }

    unsigned storeValueCount() const { return array ? array->length() - storesStart : 0; }
    // The pool handle when `header` is a number, else 0.
    uint64_t poolHandle() const
    {
        if (header.isInt32())
            return static_cast<uint64_t>(header.asInt32());
        if (header.isDouble())
            return static_cast<uint64_t>(header.asDouble());
        return 0;
    }
    bool sameSpanContext(const TelemetryContextSlot& other) const { return header == other.header && extras == other.extras; }

    // A slot value carrying `header`/`extras` and the ALS pairs of `stores`.
    static JSC::JSValue build(JSC::JSGlobalObject*, JSC::JSValue header, JSC::JSValue extras, const TelemetryContextSlot& stores);
};

ALWAYS_INLINE TelemetryContextSlot TelemetryContextSlot::read(JSC::JSValue slot)
{
    TelemetryContextSlot out;
    if (!slot || slot.isUndefined())
        return out;
    if (isHeader(slot)) {
        out.header = slot;
        return out;
    }
    if (auto* array = slot.isCell() ? dynamicDowncast<JSC::JSArray>(slot.asCell()) : nullptr) {
        out.array = array;
        if (array->length() >= 2 && array->canGetIndexQuickly(0u) && isHeader(array->getIndexQuickly(0))) {
            out.header = array->getIndexQuickly(0);
            JSC::JSValue extras = array->canGetIndexQuickly(1u) ? array->getIndexQuickly(1) : JSC::JSValue();
            out.extras = extras.isCell() ? extras : JSC::JSValue();
            out.storesStart = 2;
        }
    }
    return out;
}

JSC_DECLARE_HOST_FUNCTION(jsTelemetryEnterContext);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryExitContext);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryActiveExtras);

// Installed as VM::asyncContextLeaveAsyncFrameHook.
JSC::JSValue telemetryLeaveAsyncFrame(JSC::JSGlobalObject*, JSC::JSValue atEntry, JSC::JSValue current);

} // namespace Bun
