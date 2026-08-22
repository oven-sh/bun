#include "NodeDiagnosticsChannel.h"

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsSetHasModuleImportSubscribers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    global->hasModuleImportSubscribers = callFrame->uncheckedArgument(0).toBoolean(globalObject);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
