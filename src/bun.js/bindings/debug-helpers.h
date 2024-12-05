#include "root.h"

#include <JavaScriptCore/InspectorDebuggerAgent.h>

namespace JSC {
Inspector::InspectorDebuggerAgent* debuggerAgent(JSC::JSGlobalObject* globalObject)
{
    if (LIKELY(!globalObject->hasDebugger())) {
        return nullptr;
    }

    if (auto* debugger = globalObject->debugger()) {
        return dynamicDowncast<Inspector::InspectorDebuggerAgent>(debugger->client());
    }

    return nullptr;
}
}
