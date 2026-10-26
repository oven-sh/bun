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
JSC_DECLARE_HOST_FUNCTION(jsFunction_nodeInspectorUrl);

// The debugger paused the JS thread in `globalObject`: the inspector connections of that global take the commands of
// their frontends here until `isDoneProcessingEvents`.
void runInspectorConnectionsWhilePaused(JSC::JSGlobalObject&, bool& isDoneProcessingEvents);

} // namespace Bun
