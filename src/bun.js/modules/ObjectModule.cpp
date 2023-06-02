#include "ObjectModule.h"

namespace Zig {
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCode(JSC::JSGlobalObject *globalObject,
                               JSC::JSObject *object) {
  JSC::VM &vm = globalObject->vm();

  return [object](JSC::JSGlobalObject *lexicalGlobalObject,
                  JSC::Identifier moduleKey,
                  Vector<JSC::Identifier, 4> &exportNames,
                  JSC::MarkedArgumentBuffer &exportValues) -> JSValue {
    JSC::VM &vm = lexicalGlobalObject->vm();
    GlobalObject *globalObject =
        reinterpret_cast<GlobalObject *>(lexicalGlobalObject);
    JSC::EnsureStillAliveScope stillAlive(object);

    PropertyNameArray properties(vm, PropertyNameMode::Strings,
                                 PrivateSymbolMode::Exclude);
    object->getPropertyNames(globalObject, properties,
                             DontEnumPropertiesMode::Exclude);

    for (auto &entry : properties) {
      exportNames.append(entry);
      exportValues.append(object->get(globalObject, entry));
    }

    return {};
  };
}
} // namespace Zig