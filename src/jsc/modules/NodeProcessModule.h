#include "ZigGlobalObject.h"
#include "_NativeModule.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "BunProcess.h"

namespace Zig {

DEFINE_LAZY_NATIVE_MODULE(NodeProcess)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    Bun::Process* process = globalObject->processObject();

    // The whole prototype chain: the EventEmitter methods are exports of this module too.
    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    process->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);

    RELEASE_AND_RETURN(scope, exportObjectProperties(globalObject, process, properties, exportNames, exportValues));
}

} // namespace Zig
