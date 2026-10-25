#include "root.h"

#include "JavaScriptCore/CallData.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "InternalModuleRegistry.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSPromise.h>
namespace Bun {
using namespace JSC;

// Mirrors `BuiltinEntryPoint` in src/jsc/VirtualMachine.rs.
enum class BuiltinEntryPoint : uint8_t {
    // `bun ./index.html`: src/js/internal/html.ts
    Html = 0,
    // `bun bake`: src/js/internal/bake.ts
    Bake = 1,
};

// Runs the default export of a built-in module as the program, instead of a user file.
extern "C" JSPromise* Bun__loadBuiltinEntryPoint(Zig::GlobalObject* globalObject, BuiltinEntryPoint entryPoint)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto id = entryPoint == BuiltinEntryPoint::Bake ? InternalModuleRegistry::InternalBake : InternalModuleRegistry::InternalHtml;
    JSValue module = globalObject->internalModuleRegistry()->requireId(globalObject, vm, id);
    if (scope.exception()) [[unlikely]] {
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }

    JSObject* moduleObject = module.getObject();
    if (!moduleObject) [[unlikely]] {
        BUN_PANIC("Failed to load the built-in entry point");
    }

    MarkedArgumentBuffer args;
    JSValue result = JSC::call(globalObject, moduleObject, args, "Failed to load the built-in entry point"_s);
    if (scope.exception()) [[unlikely]] {
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }

    if (result.isUndefined()) {
        RELEASE_AND_RETURN(scope, JSPromise::resolvedPromise(globalObject, result));
    }

    JSPromise* promise = dynamicDowncast<JSC::JSPromise>(result);
    if (!promise) [[unlikely]] {
        BUN_PANIC("Failed to load the built-in entry point");
    }
    // The VM reports a rejection of the entry point. Without this, the rejection tracker reports it
    // again, as an unhandled rejection.
    promise->markAsHandled();
    return promise;
}

}
