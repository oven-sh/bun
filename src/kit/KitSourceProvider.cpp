// clang-format off
#include "KitSourceProvider.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "KitDevGlobalObject.h"

namespace Kit {


extern "C" LoadServerCodeResult KitLoadServerCode(DevGlobalObject* global, BunString source) {
  String string = "kit://server"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(KitSourceProvider::create(
    source.toWTFString(),
    origin,
    WTFMove(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Module
  ));

  JSC::JSString* key = JSC::jsString(global->vm(), string);
  global->moduleLoader()->provideFetch(global, key, sourceCode);
  
  return {
     global->moduleLoader()->loadAndEvaluateModule(global, key, JSC::jsUndefined(), JSC::jsUndefined()),
     key
  };
}

extern "C" JSC::EncodedJSValue KitGetRequestHandlerFromModule(
  DevGlobalObject* global,
  JSC::JSString* key
) {
  JSC::VM&vm = global->vm();
  JSC::JSMap* map = JSC::jsCast<JSC::JSMap*>(
    global->moduleLoader()->getDirect(
      vm, JSC::Identifier::fromString(global->vm(), "registry"_s)
    ));
  JSC::JSValue entry = map->get(global, key);
  ASSERT(entry.isObject()); // should have called KitLoadServerCode and wait for that promise
  JSC::JSValue module = entry.getObject()->get(global, JSC::Identifier::fromString(global->vm(), "module"_s));
  ASSERT(module.isCell());
  JSC::JSModuleNamespaceObject* namespaceObject = global->moduleLoader()->getModuleNamespaceObject(global, module);
  ASSERT(namespaceObject);
  return JSC::JSValue::encode(namespaceObject->get(global, vm.propertyNames->defaultKeyword));
}

} // namespace Kit
