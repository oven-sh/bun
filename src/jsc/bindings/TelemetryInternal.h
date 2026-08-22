// Helpers shared by JSTelemetrySpan.cpp, JSTelemetryTracer.cpp and TelemetryContext.cpp.
#pragma once
#include "root.h"
#include "JSTelemetrySpan.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSString.h>

namespace Bun {
using namespace JSC;

// Borrow (Bun::toString does not ref) the characters of a JSString the
// caller keeps alive, resolving a rope in place first. Never throws: a rope
// that cannot be resolved (OOM) reads as Empty.
ALWAYS_INLINE BunString telemetryBorrow(JSString* str)
{
    if (!str)
        return { BunStringTag::Empty, {} };
    if (const WTF::StringImpl* impl = str->tryGetValueImpl())
        return Bun::toString(const_cast<WTF::StringImpl*>(impl));
    return Bun::toString(str->tryGetValue().data);
}

// The same JSString with any rope resolved (see telemetryBorrow).
ALWAYS_INLINE JSString* telemetryResolve(JSString* str)
{
    if (!str->tryGetValueImpl())
        str->tryGetValue();
    return str;
}

// The builtins' bookkeeping arrays are read without ever running JS: own,
// present elements only (holes and anything exotic read as empty).
ALWAYS_INLINE JSArray* telemetryArray(JSValue v)
{
    return v && v.isCell() ? dynamicDowncast<JSArray>(v.asCell()) : nullptr;
}

ALWAYS_INLINE JSString* telemetryArrayString(JSArray* array, unsigned i)
{
    JSValue v = array->tryGetIndexQuickly(i);
    return v && v.isString() ? asString(v) : nullptr;
}

ALWAYS_INLINE uint64_t telemetryMsToNs(double ms)
{
    return ms > 0 && ms < 1.8e13 ? static_cast<uint64_t>(ms * 1e6) : 0;
}

// @opentelemetry/api `TimeInput` (epoch-ms number, Date, or [sec, ns]) → epoch
// ns; 0 for absent / invalid / non-finite / out of range. Never runs JS.
inline uint64_t telemetryTimeInputToNs(JSValue v)
{
    if (v.isNumber())
        return telemetryMsToNs(v.asNumber());
    if (!v || !v.isCell())
        return 0;
    if (auto* date = dynamicDowncast<DateInstance>(v.asCell()))
        return telemetryMsToNs(date->internalNumber());
    if (auto* arr = dynamicDowncast<JSArray>(v.asCell())) {
        JSValue s = arr->tryGetIndexQuickly(0u), n = arr->tryGetIndexQuickly(1u);
        if (s.isNumber() && n.isNumber()) {
            {
                double ds = s.asNumber(), dn = n.asNumber();
                if (ds >= 0 && ds < 1.8e10 && dn >= 0 && dn < 1e12)
                    return static_cast<uint64_t>(ds) * 1000000000ull + static_cast<uint64_t>(dn);
            }
        }
    }
    return 0;
}

// @opentelemetry/api SpanKind (INTERNAL 0 … CONSUMER 4); anything else is INTERNAL.
// Stored and passed to Rust as-is; bun_telemetry::SpanKind::from_api is the only conversion.
// api SpanKind number, or "internal" | "server" | "client" | "producer" | "consumer".
ALWAYS_INLINE uint8_t telemetryApiKind(JSGlobalObject* globalObject, JSValue v)
{
    if (v.isInt32())
        return v.asInt32() >= 0 && v.asInt32() <= 4 ? static_cast<uint8_t>(v.asInt32()) : 0;
    if (!v.isString())
        return 0;
    auto holder = asString(v)->tryGetValue();
    const WTF::String& k = holder;
    if (k == "server"_s)
        return 1;
    if (k == "client"_s)
        return 2;
    if (k == "producer"_s)
        return 3;
    if (k == "consumer"_s)
        return 4;
    return 0;
}

ALWAYS_INLINE uint16_t telemetryScopeId(JSValue v)
{
    return v.isInt32() ? static_cast<uint16_t>(v.asInt32()) : Bun__Telemetry__userScope();
}

// `require("internal/telemetry")[name]` — the module's JS helpers.
JSValue telemetryInternalFunction(Zig::GlobalObject*, const Identifier&);
// End `span` at `endNs` (0 = now). Never runs JS.
void telemetryEndSpan(Zig::GlobalObject*, JSTelemetrySpan*, uint64_t endNs);
// One attribute onto a pooled span.
void telemetryNativeSetAttribute(Zig::GlobalObject*, uint64_t handle, JSString* key, JSValue value);
// Restore the context `span.enter()` displaced (no-op if not entered).
void telemetryExitSpan(Zig::GlobalObject*, JSTelemetrySpan*);
// span.setAttribute / span.setAttributes({...}) without calling into JS for the common cases.
void telemetrySpanSetAttribute(Zig::GlobalObject*, JSTelemetrySpan*, JSString* key, JSValue value);
bool telemetrySpanSetAttributes(Zig::GlobalObject*, JSTelemetrySpan*, JSValue attributes);
// `span.fail(error)` without running any JS (for use while unwinding).
void telemetryFailSpanNoJS(Zig::GlobalObject*, JSTelemetrySpan*, JSValue error);

} // namespace Bun
