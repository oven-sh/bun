#include "../bindings/JSBuffer.h"
#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionNotImplemented,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  throwException(globalObject, scope,
                 createError(globalObject, "Not implemented"_s));
  return JSValue::encode(jsUndefined());
}

inline JSValue
generateBufferSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                         JSC::Identifier moduleKey,
                         Vector<JSC::Identifier, 4> &exportNames,
                         JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  JSC::JSObject *defaultObject = JSC::constructEmptyObject(
      globalObject, globalObject->objectPrototype(), 12);

  defaultObject->putDirect(vm,
                           PropertyName(Identifier::fromUid(
                               vm.symbolRegistry().symbolForKey("CommonJS"_s))),
                           jsNumber(0), 0);

  auto exportProperty = [&](JSC::Identifier name, JSC::JSValue value) {
    exportNames.append(name);
    exportValues.append(value);
    defaultObject->putDirect(vm, name, value, 0);
  };

  exportProperty(JSC::Identifier::fromString(vm, "Buffer"_s),
                 globalObject->JSBufferConstructor());

  auto *slowBuffer = JSC::JSFunction::create(
      vm, globalObject, 0, "SlowBuffer"_s, WebCore::constructSlowBuffer,
      ImplementationVisibility::Public, NoIntrinsic,
      WebCore::constructSlowBuffer);
  slowBuffer->putDirect(
      vm, vm.propertyNames->prototype, globalObject->JSBufferPrototype(),
      JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum |
          JSC::PropertyAttribute::DontDelete);
  exportProperty(JSC::Identifier::fromString(vm, "SlowBuffer"_s), slowBuffer);
  auto blobIdent = JSC::Identifier::fromString(vm, "Blob"_s);

  JSValue blobValue =
      lexicalGlobalObject->get(globalObject, PropertyName(blobIdent));
  exportProperty(blobIdent, blobValue);

  // TODO: implement File
  exportProperty(JSC::Identifier::fromString(vm, "File"_s), blobValue);

  exportProperty(JSC::Identifier::fromString(vm, "INSPECT_MAX_BYTES"_s),
                 JSC::jsNumber(50));

  exportProperty(JSC::Identifier::fromString(vm, "kMaxLength"_s),
                 JSC::jsNumber(4294967296LL));

  exportProperty(JSC::Identifier::fromString(vm, "kStringMaxLength"_s),
                 JSC::jsNumber(536870888));

  JSC::JSObject *constants = JSC::constructEmptyObject(
      lexicalGlobalObject, globalObject->objectPrototype(), 2);
  constants->putDirect(vm, JSC::Identifier::fromString(vm, "MAX_LENGTH"_s),
                       JSC::jsNumber(4294967296LL));
  constants->putDirect(vm,
                       JSC::Identifier::fromString(vm, "MAX_STRING_LENGTH"_s),
                       JSC::jsNumber(536870888));

  exportProperty(JSC::Identifier::fromString(vm, "constants"_s), constants);

  JSC::Identifier atobI = JSC::Identifier::fromString(vm, "atob"_s);
  JSC::JSValue atobV =
      lexicalGlobalObject->get(globalObject, PropertyName(atobI));

  JSC::Identifier btoaI = JSC::Identifier::fromString(vm, "btoa"_s);
  JSC::JSValue btoaV =
      lexicalGlobalObject->get(globalObject, PropertyName(btoaI));

  exportProperty(atobI, atobV);
  exportProperty(btoaI, btoaV);

  auto *transcode = InternalFunction::createFunctionThatMasqueradesAsUndefined(
      vm, globalObject, 1, "transcode"_s, jsFunctionNotImplemented);

  exportProperty(JSC::Identifier::fromString(vm, "transcode"_s), transcode);

  auto *resolveObjectURL =
      InternalFunction::createFunctionThatMasqueradesAsUndefined(
          vm, globalObject, 1, "resolveObjectURL"_s, jsFunctionNotImplemented);

  exportProperty(JSC::Identifier::fromString(vm, "resolveObjectURL"_s),
                 resolveObjectURL);

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(defaultObject);
  return {};
}

} // namespace Zig
