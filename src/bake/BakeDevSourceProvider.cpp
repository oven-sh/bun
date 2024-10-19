// clang-format off
#include "BakeDevSourceProvider.h"
#include "BakeDevGlobalObject.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"

namespace Bake {

extern "C" LoadServerCodeResult BakeLoadInitialServerCode(DevGlobalObject* global, BunString source) {
  JSC::VM& vm = global->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(DevSourceProvider::create(
    source.toWTFString(),
    origin,
    WTFMove(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Module
  ));

  JSC::JSString* key = JSC::jsString(vm, string);
  global->moduleLoader()->provideFetch(global, key, sourceCode);
  RETURN_IF_EXCEPTION(scope, {});
 
  JSC::JSInternalPromise* internalPromise = global->moduleLoader()->loadAndEvaluateModule(global, key, JSC::jsUndefined(), JSC::jsUndefined());
  RETURN_IF_EXCEPTION(scope, {});

  return { internalPromise, key };
}

extern "C" JSC::EncodedJSValue BakeLoadServerHmrPatch(DevGlobalObject* global, BunString source) {
  JSC::VM&vm=global->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server.patch.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(DevSourceProvider::create(
    source.toWTFString(),
    origin,
    WTFMove(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Program
  ));
  
  JSC::JSValue result = vm.interpreter.executeProgram(sourceCode, global, global);
  RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));

  RELEASE_ASSERT(result);
  return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue BakeGetRequestHandlerFromModule(
  DevGlobalObject* global,
  JSC::JSString* key
) {
  JSC::VM&vm = global->vm();
  JSC::JSMap* map = JSC::jsCast<JSC::JSMap*>(
    global->moduleLoader()->getDirect(
      vm, JSC::Identifier::fromString(global->vm(), "registry"_s)
    ));
  JSC::JSValue entry = map->get(global, key);
  ASSERT(entry.isObject()); // should have called BakeLoadServerCode and wait for that promise
  JSC::JSValue module = entry.getObject()->get(global, JSC::Identifier::fromString(global->vm(), "module"_s));
  ASSERT(module.isCell());
  JSC::JSModuleNamespaceObject* namespaceObject = global->moduleLoader()->getModuleNamespaceObject(global, module);
  ASSERT(namespaceObject);
  return JSC::JSValue::encode(namespaceObject->get(global, vm.propertyNames->defaultKeyword));
}

} // namespace Bake
