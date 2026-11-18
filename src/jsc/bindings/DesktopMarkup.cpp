#include "root.h"

#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/JSCInlines.h>

extern "C" void Bun__DOM__withoutCollecting(JSC::JSGlobalObject* globalObject, void* context, void (*run)(void*))
{
    JSC::DeferGCForAWhile deferred(globalObject->vm());
    run(context);
}
