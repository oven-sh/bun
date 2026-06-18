#pragma once

#include "root.h"
#include <JavaScriptCore/JSCJSValue.h>

namespace Bun {

// node:inspector's inspector.open() / close() / waitForDebugger(), backed by
// the debugger-thread WebSocket server in src/js/internal/debugger.ts.
JSC_DECLARE_HOST_FUNCTION(jsFunction_openNodeInspector);
JSC_DECLARE_HOST_FUNCTION(jsFunction_waitForNodeInspectorConnection);
JSC_DECLARE_HOST_FUNCTION(jsFunction_postNodeInspectorControl);
JSC_DECLARE_HOST_FUNCTION(jsFunction_markNodeInspectorClosed);

} // namespace Bun
