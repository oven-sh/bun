#include "ZigGlobalObject.h"
#include "_NativeModule.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "BunProcess.h"
#include "ModuleGraph.h"

namespace Zig {

// node:process for `process`: the global's process object, or a Bun.unsafe.ModuleGraph's own.
inline JSC::JSObject* generateNodeProcessModule(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* process, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    // The whole prototype chain: the EventEmitter methods are exports of this module too.
    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    process->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, exportObjectProperties(globalObject, process, properties, exportNames, exportValues));
}

DEFINE_LAZY_NATIVE_MODULE(NodeProcess)
{
    return generateNodeProcessModule(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject)->processObject(), exportNames, exportValues);
}

} // namespace Zig
