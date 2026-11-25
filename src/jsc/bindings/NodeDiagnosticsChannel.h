#pragma once

#include "root.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ConsoleTypes.h>

namespace Inspector {
class ScriptArguments;
}

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsSetDiagnosticsHook);
JSC_DECLARE_HOST_FUNCTION(jsObservePromise);
// One more instance of the function that Module.prototype.require holds at start-up.
JSC::JSValue createOriginalRequireFunction(Zig::GlobalObject*);

// Subscribers can change what is printed. If this returns true, it is in `printed`, for the type that is set now.
bool publishConsoleCall(Zig::GlobalObject*, JSC::MessageType&, JSC::MessageLevel, const Inspector::ScriptArguments&, JSC::MarkedArgumentBuffer& printed, size_t printedLimit);

// Calls `import` between the start and the end event. `import` returns null if it throws.
JSC::JSPromise* traceImportCall(Zig::GlobalObject*, JSC::JSObject* hook, JSC::JSString* specifier, const JSC::SourceOrigin&, const WTF::ScopedLambda<JSC::JSPromise*()>& import);

}
