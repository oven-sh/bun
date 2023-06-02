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

inline JSValue
generateProcessSourceCode(JSC::JSGlobalObject *lexicalGlobalObject,
                          JSC::Identifier moduleKey,
                          Vector<JSC::Identifier, 4> &exportNames,
                          JSC::MarkedArgumentBuffer &exportValues) {
  JSC::VM &vm = lexicalGlobalObject->vm();
  GlobalObject *globalObject =
      reinterpret_cast<GlobalObject *>(lexicalGlobalObject);

  JSC::JSObject *process = globalObject->processObject();

  PropertyNameArray properties(vm, PropertyNameMode::Strings,
                               PrivateSymbolMode::Exclude);
  process->getPropertyNames(globalObject, properties,
                            DontEnumPropertiesMode::Exclude);

  exportNames.append(JSC::Identifier::fromString(vm, "default"_s));
  JSFunction *processModuleCommonJS = JSFunction::create(
      vm, globalObject, 0, "process"_s, jsFunctionProcessModuleCommonJS,
      ImplementationVisibility::Public);
  processModuleCommonJS->putDirect(
      vm,
      PropertyName(
          Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s))),
      jsBoolean(true), 0);
  exportValues.append(processModuleCommonJS);

  for (auto &entry : properties) {
    exportNames.append(entry);
    exportValues.append(process->get(globalObject, entry));
    processModuleCommonJS->putDirectCustomAccessor(
        vm, entry,
        JSC::CustomGetterSetter::create(vm,
                                        jsFunctionProcessModuleCommonJSGetter,
                                        jsFunctionProcessModuleCommonJSSetter),
        0);
  }

  return {};
}

} // namespace Zig
