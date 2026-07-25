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
<<<<<<< HEAD
JSC_DECLARE_HOST_FUNCTION(jsFunction_dispatchInProcessInspectorMessage);
JSC_DECLARE_HOST_FUNCTION(jsFunction_drainInProcessInspectorMessages);
JSC_DECLARE_HOST_FUNCTION(jsFunction_disconnectInProcessInspector);
=======
>>>>>>> df6c7eed6b37c4d632e4742d158285e2f436eeb0

} // namespace Bun
