#include "root.h"

#include "JavaScriptCore/CallData.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "InternalModuleRegistry.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSInternalPromise.h>

namespace Bun {
using namespace JSC;
extern "C" JSInternalPromise* Bun__loadSQLEntryPoint(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSInternalPromise* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());

    JSValue sqlModule = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::InternalSql);
    if (UNLIKELY(scope.exception())) {
        return promise->rejectWithCaughtException(globalObject, scope);
    }

    JSObject* sqlModuleObject = sqlModule.getObject();
    if (UNLIKELY(!sqlModuleObject)) {
        BUN_PANIC("Failed to load SQL entry point");
    }

    MarkedArgumentBuffer args;
    JSValue result = JSC::call(globalObject, sqlModuleObject, args, "Failed to load SQL entry point"_s);
    if (UNLIKELY(scope.exception())) {
        return promise->rejectWithCaughtException(globalObject, scope);
    }

    promise = jsDynamicCast<JSInternalPromise*>(result);
    if (UNLIKELY(!promise)) {
        BUN_PANIC("Failed to load SQL entry point");
    }
    return promise;
}

}
