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

    uint16_t m_scope { 0 };

private:
    JSTelemetryTracer(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

// Holder for the `createSpan` fast path so DFG can emit it as CallDOM.
class JSTelemetryBinding final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_EXPORT_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTelemetryBinding, Base);
        return &vm.plainObjectSpace();
    }
    static JSTelemetryBinding* create(VM&, Zig::GlobalObject*);

private:
    JSTelemetryBinding(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

// $newCppFunction("JSTelemetryTracer.cpp", …) targets for internal/telemetry.ts.
JSC_DECLARE_HOST_FUNCTION(jsTelemetryCreateTracer);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryCreateBinding);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryWrapSpanContext);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryParseTraceparent);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryStartInstrumentSpan);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryPropagationHeaders);

} // namespace Bun
