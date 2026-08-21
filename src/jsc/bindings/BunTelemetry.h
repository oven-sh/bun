#pragma once
#include "config.h"
#include "ZigGlobalObject.h"
#include <wtf/PlatformCallingConventions.h>

extern "C" JSC::EncodedJSValue Bun__Telemetry__enterWithExtras(Zig::GlobalObject*, JSC::EncodedJSValue span, JSC::EncodedJSValue extras);
extern "C" JSC::EncodedJSValue Bun__Telemetry__enter(Zig::GlobalObject*, JSC::EncodedJSValue span);
extern "C" void Bun__Telemetry__exit(Zig::GlobalObject*, JSC::EncodedJSValue prev);
extern "C" JSC::EncodedJSValue Bun__Telemetry__activeSpanCell(Zig::GlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__activeExtras(Zig::GlobalObject*);

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsEnterWithExtras);
JSC_DECLARE_HOST_FUNCTION(jsExitContext);
JSC_DECLARE_HOST_FUNCTION(jsActiveExtras);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryStartSpan);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryWrapSpanContext);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryStartInstrumentSpan);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryNativeSpanOp);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryCreateBinding);

/// Installed as VM::asyncContextLeaveAsyncFrameHook.
JSC::JSValue telemetryLeaveAsyncFrame(JSC::JSGlobalObject*, JSC::JSValue atEntry, JSC::JSValue current);

}
