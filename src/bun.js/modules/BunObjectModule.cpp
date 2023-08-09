#include "root.h"

#include "ZigGlobalObject.h"

#include "ObjectModule.h"

namespace Zig {
void generateNativeModule_BunObject(JSC::JSGlobalObject *lexicalGlobalObject,
                                    JSC::Identifier moduleKey,
                                    Vector<JSC::Identifier, 4> &exportNames,
                                    JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  Zig::GlobalObject *globalObject =
      reinterpret_cast<Zig::GlobalObject *>(lexicalGlobalObject);

  JSObject *object =
      globalObject->get(globalObject, Identifier::fromString(vm, "Bun"_s))
          .getObject();

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(object);
}

} // namespace Zig