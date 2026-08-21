#pragma once
#include "config.h"
#include "ZigGlobalObject.h"
#include <wtf/PlatformCallingConventions.h>

extern "C" JSC::EncodedJSValue Bun__Telemetry__enterWithExtras(Zig::GlobalObject*, JSC::EncodedJSValue span, JSC::EncodedJSValue extras);
extern "C" JSC::EncodedJSValue Bun__Telemetry__enter(Zig::GlobalObject*, JSC::EncodedJSValue span);
extern "C" void Bun__Telemetry__exit(Zig::GlobalObject*, JSC::EncodedJSValue prev);
extern "C" JSC::EncodedJSValue Bun__Telemetry__activeSpan(Zig::GlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__activeExtras(Zig::GlobalObject*);
extern "C" void* Bun__Telemetry__activeSpanPtr(Zig::GlobalObject*);

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsEnterWithExtras);
JSC_DECLARE_HOST_FUNCTION(jsExitContext);
JSC_DECLARE_HOST_FUNCTION(jsActiveExtras);
JSC_DECLARE_HOST_FUNCTION(jsIsTelemetrySpan);

}
