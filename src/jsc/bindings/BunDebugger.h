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
JSC_DECLARE_HOST_FUNCTION(jsFunction_dispatchInProcessInspectorMessage);
JSC_DECLARE_HOST_FUNCTION(jsFunction_drainInProcessInspectorMessages);
JSC_DECLARE_HOST_FUNCTION(jsFunction_disconnectInProcessInspector);
JSC_DECLARE_HOST_FUNCTION(jsFunction_getNodeInspectorUrl);

// The methods of node:inspector's `inspector.console`, mirrored by
// InspectorConsoleMethod in src/js/node/inspector.ts. Keep both in sync.
enum class InspectorConsoleMethod : uint32_t {
    Log = 0,
    Info,
    Debug,
    Warn,
    Error,
    Dir,
    DirXML,
    Table,
    Trace,
    Clear,
    Assert,
    Group,
    GroupCollapsed,
    GroupEnd,
    Count,
    CountReset,
    Profile,
    ProfileEnd,
    Time,
    TimeLog,
    TimeEnd,
    TimeStamp,
};
static constexpr uint32_t kLastInspectorConsoleMethod = static_cast<uint32_t>(InspectorConsoleMethod::TimeStamp);

JSC_DECLARE_HOST_FUNCTION(jsFunction_inspectorConsoleCall);

} // namespace Bun
