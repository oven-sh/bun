#include "root.h"
#include "NodePerformanceTiming.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ThrowScope.h>

// Milliseconds since `performance.timeOrigin`, or -1 when the milestone has
// not been reached. Defined in src/jsc/virtual_machine_exports.rs.
extern "C" double Bun__getNodeTimingMilestone(void* bunVM, uint32_t index);

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsFunction_getNodeTimingMilestone, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint32_t index = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    double milestone = Bun__getNodeTimingMilestone(bunVM(globalObject), index);
    return JSC::JSValue::encode(JSC::jsDoubleNumber(milestone));
}

} // namespace Bun
