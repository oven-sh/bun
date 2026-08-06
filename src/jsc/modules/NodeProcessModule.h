#include "ZigGlobalObject.h"
#include "_NativeModule.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "BunProcess.h"

namespace Zig {

DEFINE_NATIVE_MODULE(NodeProcess)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    Bun::Process* process = globalObject->processObject();
    // Don't bulk-reifyAllStaticProperties here (see generateNativeModule_NodeModule
    // for the long version). It runs every PropertyCallback back-to-back without an
    // exception check in between, which trips BUN_JSC_validateExceptionChecks=1.
    // The per-export get() below lazy-reifies one property at a time inside
    // JSObject::get's own checked ThrowScope.

    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    process->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(process);

    for (auto& entry : properties.releaseData()->propertyNameVector()) {
        if (entry == vm.propertyNames->defaultKeyword) {
            // skip because it's already on the default
            // export (the Process object itself)
            continue;
        }

        exportNames.append(entry);
        auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSValue result = process->get(globalObject, entry);
        if (topExceptionScope.exception()) {
            result = jsUndefined();
            (void)topExceptionScope.tryClearException();
        }

        exportValues.append(result);
    }
}

} // namespace Zig
