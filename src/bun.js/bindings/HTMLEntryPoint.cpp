#include "root.h"

#include "JavaScriptCore/CallData.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "InternalModuleRegistry.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSInternalPromise.h>

namespace Bun {
using namespace JSC;
extern "C" JSInternalPromise* Bun__loadHTMLEntryPoint(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSInternalPromise* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());

    JSValue htmlModule = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::InternalHtml);
    if (UNLIKELY(scope.exception())) {
        return promise->rejectWithCaughtException(globalObject, scope);
    }

    JSObject* htmlModuleObject = htmlModule.getObject();
    if (UNLIKELY(!htmlModuleObject)) {
        BUN_PANIC("Failed to load HTML entry point");
    }

    MarkedArgumentBuffer args;
    JSValue result = JSC::call(globalObject, htmlModuleObject, args, "Failed to load HTML entry point"_s);
    if (UNLIKELY(scope.exception())) {
        return promise->rejectWithCaughtException(globalObject, scope);
    }

    promise = jsDynamicCast<JSInternalPromise*>(result);
    if (UNLIKELY(!promise)) {
        BUN_PANIC("Failed to load HTML entry point");
    }
    return promise;
}

}
