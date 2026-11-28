#include "../v8.h"

#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/TopExceptionScope.h"

namespace v8 {
namespace shim {

COLD NEVER_INLINE bool reportUncaughtException()
{
    auto* globalObject = defaultGlobalObject();
    JSC::VM& vm = globalObject->vm();
    // Set while JavaScript, or a native function that JavaScriptCore called, is on the stack.
    if (vm.entryScope)
        return false;

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (JSC::Exception* exception = scope.exception(); exception && scope.tryClearException())
        globalObject->reportUncaughtExceptionAtEventLoop(globalObject, exception);
    // The exception was the VM's stop, or the report requested one: an uncaught exception ends a Worker.
    if (vm.traps().maybeNeedHandling() && vm.hasExceptionsAfterHandlingTraps())
        Bun::takeTerminationOutsideScript(vm, scope);
    return true;
}

} // namespace shim
} // namespace v8
