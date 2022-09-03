#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCode(JSC::JSGlobalObject *globalObject,
                               JSC::JSObject *object) {
  JSC::VM &vm = globalObject->vm();

  return [strongObject = JSC::Strong<JSC::JSObject>(vm, object)](
             JSC::JSGlobalObject *lexicalGlobalObject,
             JSC::Identifier moduleKey, Vector<JSC::Identifier, 4> &exportNames,
             JSC::MarkedArgumentBuffer &exportValues) -> void {
    JSC::VM &vm = lexicalGlobalObject->vm();
    GlobalObject *globalObject =
        reinterpret_cast<GlobalObject *>(lexicalGlobalObject);
    JSC::JSObject *object = strongObject.get();

    PropertyNameArray properties(vm, PropertyNameMode::Strings,
                                 PrivateSymbolMode::Exclude);
    object->getPropertyNames(globalObject, properties,
                             DontEnumPropertiesMode::Exclude);

    for (auto &entry : properties) {
      exportNames.append(entry);
      exportValues.append(object->get(globalObject, entry));
    }
    strongObject.clear();
  };
}

} // namespace Zig