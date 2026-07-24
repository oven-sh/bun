#include "root.h"

#include "JavaScriptCore/CallData.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "InternalModuleRegistry.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSPromise.h>
namespace Bun {
using namespace JSC;

// Entry point for `bun inspect` / `node inspect`: instead of loading a user
// script, require the internal debugger CLI module and call its start().
extern "C" JSPromise* Bun__loadNodeInspectEntryPoint(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue inspectModule = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::InternalDebuggerInspect);
    if (scope.exception()) [[unlikely]] {
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }

    JSObject* inspectModuleObject = inspectModule.getObject();
    if (!inspectModuleObject) [[unlikely]] {
        BUN_PANIC("Failed to load node inspect entry point");
    }

    JSValue startFunction = inspectModuleObject->get(globalObject, Identifier::fromString(vm, "start"_s));
    RETURN_IF_EXCEPTION(scope, JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));

    JSObject* startObject = startFunction.getObject();
    if (!startObject) [[unlikely]] {
        BUN_PANIC("Failed to load node inspect entry point");
    }

    MarkedArgumentBuffer args;
    JSValue result = JSC::call(globalObject, startObject, args, "Failed to start node inspect"_s);
    if (scope.exception()) [[unlikely]] {
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }

    if (JSPromise* promise = dynamicDowncast<JSC::JSPromise>(result)) {
        return promise;
    }
    RELEASE_AND_RETURN(scope, JSPromise::resolvedPromise(globalObject, jsUndefined()));
}

}
