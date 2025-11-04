#include "root.h"

#include "JavaScriptCore/CallData.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "InternalModuleRegistry.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/JSPromise.h>
namespace Bun {
using namespace JSC;
extern "C" JSPromise* Bun__loadHTMLEntryPoint(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue htmlModule = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::InternalHtml);
    if (scope.exception()) [[unlikely]] {
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }

    JSObject* htmlModuleObject = htmlModule.getObject();
    if (!htmlModuleObject) [[unlikely]] {
        BUN_PANIC("Failed to load HTML entry point");
    }

    MarkedArgumentBuffer args;
    JSValue result = JSC::call(globalObject, htmlModuleObject, args, "Failed to load HTML entry point"_s);
    if (scope.exception()) [[unlikely]] {
        return JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }

    if (result.isUndefined()) {
        return JSPromise::resolvedPromise(globalObject, result);
    }

    JSPromise* promise = jsDynamicCast<JSC::JSPromise*>(result);
    if (!promise) [[unlikely]] {
        BUN_PANIC("Failed to load HTML entry point");
    }
    return promise;
}

}
