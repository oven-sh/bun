#include "../bindings/JSBuffer.h"
#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {
using namespace WebCore;

inline void generateBufferSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                                     JSC::Identifier moduleKey,
                                     Vector<JSC::Identifier, 4> &exportNames,
                                     JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  exportNames.append(JSC::Identifier::fromString(vm, "Buffer"_s));
  exportValues.append(WebCore::JSBuffer::getConstructor(vm, globalObject));

  auto *slowBuffer = JSC::JSFunction::create(
      vm, globalObject, 0, "SlowBuffer"_s, WebCore::constructSlowBuffer,
      ImplementationVisibility::Public, NoIntrinsic,
      WebCore::constructSlowBuffer);
  slowBuffer->putDirect(
      vm, vm.propertyNames->prototype,
      WebCore::JSBuffer::prototype(
          vm, *jsCast<JSDOMGlobalObject *>(lexicalGlobalObject)),
      JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum |
          JSC::PropertyAttribute::DontDelete);
  exportNames.append(JSC::Identifier::fromString(vm, "SlowBuffer"_s));
  exportValues.append(slowBuffer);

  exportNames.append(JSC::Identifier::fromString(vm, "Blob"_s));
  exportValues.append(lexicalGlobalObject->get(
      globalObject, PropertyName(Identifier::fromString(vm, "Blob"_s))));

  exportNames.append(JSC::Identifier::fromString(vm, "INSPECT_MAX_BYTES"_s));
  exportValues.append(JSC::jsNumber(50));

  exportNames.append(JSC::Identifier::fromString(vm, "kMaxLength"_s));
  exportValues.append(JSC::jsNumber(4294967296LL));

  exportNames.append(JSC::Identifier::fromString(vm, "kMaxLength"_s));
  exportValues.append(JSC::jsNumber(536870888));
}

} // namespace Zig
