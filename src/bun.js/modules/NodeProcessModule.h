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
    if (!process->staticPropertiesReified()) {
        process->reifyAllStaticProperties(globalObject);
        if (scope.exception())
            return;
    }

    PropertyNameArray properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    process->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
    if (scope.exception())
        return;

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(process);

    for (auto& entry : properties) {
        if (entry == vm.propertyNames->defaultKeyword) {
            // skip because it's already on the default
            // export (the Process object itself)
            continue;
        }

        exportNames.append(entry);
        auto catchScope = DECLARE_CATCH_SCOPE(vm);
        JSValue result = process->get(globalObject, entry);
        if (catchScope.exception()) {
            result = jsUndefined();
            catchScope.clearException();
        }

        exportValues.append(result);
    }
}

} // namespace Zig
