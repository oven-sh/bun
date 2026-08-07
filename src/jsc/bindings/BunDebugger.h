#pragma once

#include "root.h"
#include <JavaScriptCore/JSCJSValue.h>

namespace Bun {

// Pre-removes every ModuleProgramExecutable from clearableCodeSet so a
// following vm.deleteAllCode() skips their clearCode() and keeps each module's
// m_moduleEnvironmentSymbolTable/live JSModuleEnvironment consistent.
void protectModuleExecutablesFromClearCode(JSC::VM&);

// node:inspector's inspector.open() / close() / waitForDebugger(), backed by
// the debugger-thread WebSocket server in src/js/internal/debugger.ts.
JSC_DECLARE_HOST_FUNCTION(jsFunction_openNodeInspector);
JSC_DECLARE_HOST_FUNCTION(jsFunction_waitForNodeInspectorConnection);
JSC_DECLARE_HOST_FUNCTION(jsFunction_postNodeInspectorControl);
JSC_DECLARE_HOST_FUNCTION(jsFunction_closeNodeInspector);

} // namespace Bun
