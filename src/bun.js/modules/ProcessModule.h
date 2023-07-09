#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/CustomGetterSetter.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessModuleCommonJS,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  VM &vm = globalObject->vm();

  return JSValue::encode(
      reinterpret_cast<Zig::GlobalObject *>(globalObject)->processObject());
}

JSC_DEFINE_CUSTOM_GETTER(jsFunctionProcessModuleCommonJSGetter,
                         (JSGlobalObject * globalObject,
                          EncodedJSValue thisValue,
                          PropertyName propertyName)) {
  VM &vm = globalObject->vm();

  return JSValue::encode(reinterpret_cast<Zig::GlobalObject *>(globalObject)
                             ->processObject()
                             ->get(globalObject, propertyName));
}

JSC_DEFINE_CUSTOM_SETTER(jsFunctionProcessModuleCommonJSSetter,
                         (JSGlobalObject * globalObject,
                          EncodedJSValue thisValue, EncodedJSValue encodedValue,
                          PropertyName propertyName)) {
  VM &vm = globalObject->vm();

  return reinterpret_cast<Zig::GlobalObject *>(globalObject)
      ->processObject()
      ->putDirect(vm, propertyName, JSValue::decode(encodedValue), 0);
}

inline void generateProcessSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                                      JSC::Identifier moduleKey,
                                      Vector<JSC::Identifier, 4> &exportNames,
                                      JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  JSC::JSObject *process = globalObject->processObject();
  auto scope = DECLARE_THROW_SCOPE(vm);
  if (!process->staticPropertiesReified()) {
    process->reifyAllStaticProperties(globalObject);
    if (scope.exception())
      return;
  }

  PropertyNameArray properties(vm, PropertyNameMode::Strings,
                               PrivateSymbolMode::Exclude);
  process->getPropertyNames(globalObject, properties,
                            DontEnumPropertiesMode::Exclude);
  if (scope.exception())
    return;

  exportNames.append(vm.propertyNames->defaultKeyword);
  exportValues.append(process);

  exportNames.append(
      Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s)));
  exportValues.append(jsNumber(0));

  for (auto &entry : properties) {
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
