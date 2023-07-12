#include "../bindings/JSStringDecoder.h"
#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

inline void
generateStringDecoderSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                                JSC::Identifier moduleKey,
                                Vector<JSC::Identifier, 4> &exportNames,
                                JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  exportNames.append(JSC::Identifier::fromString(vm, "StringDecoder"_s));
  exportValues.append(globalObject->JSStringDecoder());

  auto CommonJS =
      Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s));

  JSC::JSObject *defaultObject = constructEmptyObject(globalObject);
  defaultObject->putDirect(vm, PropertyName(CommonJS), jsNumber(0), 0);

  for (size_t i = 0; i < exportNames.size(); i++) {
    defaultObject->putDirect(vm, exportNames[i], exportValues.at(i), 0);
  }

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(defaultObject);

  exportNames.append(CommonJS);
  exportValues.append(jsNumber(0));
}

} // namespace Zig
