#include "config.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// Flipped from node:diagnostics_channel when the "module.import" tracing
// channel gains or loses subscribers, so moduleLoaderImportModule's fast path
// is a single bool read.
JSC_DEFINE_HOST_FUNCTION(jsSetHasModuleImportSubscribers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    global->hasModuleImportSubscribers = callFrame->uncheckedArgument(0).toBoolean(globalObject);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
