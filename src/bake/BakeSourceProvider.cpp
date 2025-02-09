// clang-format off
#include "BakeSourceProvider.h"
#include "BakeGlobalObject.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "ImportMetaObject.h"

namespace Bake {

extern "C" JSC::EncodedJSValue BakeLoadInitialServerCode(GlobalObject* global, BunString source, bool separateSSRGraph) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server-runtime.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(SourceProvider::create(
    source.toWTFString(),
    origin,
    WTFMove(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Program
  ));

  JSC::JSValue fnValue = vm.interpreter.executeProgram(sourceCode, global, global);
  RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));

  RELEASE_ASSERT(fnValue);

  JSC::JSFunction* fn = jsCast<JSC::JSFunction*>(fnValue);
  JSC::CallData callData = JSC::getCallData(fn);

  JSC::MarkedArgumentBuffer args;
  args.append(JSC::jsBoolean(separateSSRGraph)); // separateSSRGraph
  args.append(Zig::ImportMetaObject::create(global, "bake://server-runtime.js"_s)); // importMeta

  return JSC::JSValue::encode(JSC::profiledCall(global, JSC::ProfilingReason::API, fn, callData, JSC::jsUndefined(), args));
}

extern "C" JSC::JSInternalPromise* BakeLoadModuleByKey(GlobalObject* global, JSC::JSString* key) {
  return global->moduleLoader()->loadAndEvaluateModule(global, key, JSC::jsUndefined(), JSC::jsUndefined());
}

extern "C" JSC::EncodedJSValue BakeLoadServerHmrPatch(GlobalObject* global, BunString source) {
  JSC::VM&vm = global->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server.patch.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(SourceProvider::create(
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

extern "C" JSC::EncodedJSValue BakeGetModuleNamespace(
  JSC::JSGlobalObject* global,
  JSC::JSValue keyValue
) {
  JSC::JSString* key = JSC::jsCast<JSC::JSString*>(keyValue);
  auto& vm = JSC::getVM(global);
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
  return JSC::JSValue::encode(namespaceObject);
}

extern "C" JSC::EncodedJSValue BakeGetDefaultExportFromModule(
  JSC::JSGlobalObject* global,
  JSC::JSValue keyValue
) {
  auto& vm = JSC::getVM(global);
  return JSC::JSValue::encode(jsCast<JSC::JSModuleNamespaceObject*>(JSC::JSValue::decode(BakeGetModuleNamespace(global, keyValue)))->get(global, vm.propertyNames->defaultKeyword));
}

// There were issues when trying to use JSValue.get from zig
extern "C" JSC::EncodedJSValue BakeGetOnModuleNamespace(
  JSC::JSGlobalObject* global,
  JSC::JSModuleNamespaceObject* moduleNamespace,
  const unsigned char* key,
  size_t keyLength
) {
  auto& vm = JSC::getVM(global);
  const auto propertyString = String(StringImpl::createWithoutCopying({ key, keyLength }));
  const auto identifier = JSC::Identifier::fromString(vm, propertyString);
  const auto property = JSC::PropertyName(identifier);
  return JSC::JSValue::encode(moduleNamespace->get(global, property));
}

extern "C" JSC::EncodedJSValue BakeRegisterProductionChunk(JSC::JSGlobalObject* global, BunString virtualPathName, BunString source) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = virtualPathName.toWTFString();
  JSC::JSString* key = JSC::jsString(vm, string);
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(SourceProvider::create(
    source.toWTFString(),
    origin,
    WTFMove(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Module
  ));

  global->moduleLoader()->provideFetch(global, key, sourceCode);
  RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));

  return JSC::JSValue::encode(key);
}

} // namespace Bake
