#pragma once
#include "root.h"
#include <JavaScriptCore/JSObject.h>

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

// `Bun.otel.tracer(name)` / api `trace.getTracer(name)`.
class JSTelemetryTracer final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSTelemetryTracer* create(VM&, Zig::GlobalObject*, uint16_t scope, JSValue name, JSValue version);

    uint16_t scope() const { return m_scope; }

private:
    JSTelemetryTracer(VM& vm, Structure* structure, uint16_t scope)
        : Base(vm, structure)
        , m_scope(scope)
    {
    }
    const uint16_t m_scope;
};

// $cpp / $newCppFunction("JSTelemetryTracer.cpp", …) targets for internal/telemetry.ts.
JSC_DECLARE_HOST_FUNCTION(jsTelemetryOtelSpan);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryOtelWrap);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryEnabledMask);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryOtelSet);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryCreateTracer);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryWrapSpanContext);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySuppressedCarrier);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryParseTraceparent);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryPropagationHeaders);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySpanBaggage);

} // namespace Bun
