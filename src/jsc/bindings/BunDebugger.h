#pragma once

#include "root.h"
#include <JavaScriptCore/JSCJSValue.h>

namespace Bun {

// node:inspector's inspector.open() / close() / waitForDebugger(), backed by
// the debugger-thread WebSocket server in src/js/internal/debugger.ts.
JSC_DECLARE_HOST_FUNCTION(jsFunction_openNodeInspector);
JSC_DECLARE_HOST_FUNCTION(jsFunction_waitForNodeInspectorConnection);
JSC_DECLARE_HOST_FUNCTION(jsFunction_postNodeInspectorControl);
JSC_DECLARE_HOST_FUNCTION(jsFunction_closeNodeInspector);

// For a global that is being destroyed: at exit, or by the GC after `bun test --isolate` replaced it.
void leakInspectorControllerThatHadFrontend(JSC::JSGlobalObject&);

} // namespace Bun
