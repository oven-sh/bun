// clang-format off
#include "BakeSourceProvider.h"
#include "DevServerSourceProvider.h"
#include "BakeGlobalObject.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/ModuleRegistryEntry.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "ImportMetaObject.h"

namespace Bake {

  
extern "C" BunString BakeSourceProvider__getSourceSlice(SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

// Rust calls the EncodedJSValue-returning functions below via `jsc::from_js_host_call`: empty return <=> exception pending.

extern "C" JSC::EncodedJSValue BakeLoadInitialServerCode(JSC::JSGlobalObject* global, BunString source, bool separateSSRGraph) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server-runtime.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(SourceProvider::create(
    global,
    source.toWTFString(),
    origin,
    WTF::move(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Program
  ));

  JSC::JSValue fnValue = vm.interpreter.executeProgram(sourceCode, global, global);
  RETURN_IF_EXCEPTION(scope, {});

  RELEASE_ASSERT(fnValue);

  JSC::JSFunction* fn = uncheckedDowncast<JSC::JSFunction>(fnValue);
  JSC::CallData callData = JSC::getCallData(fn);

  JSC::MarkedArgumentBuffer args;
  args.append(JSC::jsBoolean(separateSSRGraph)); // separateSSRGraph
  args.append(Zig::ImportMetaObject::create(global, "bake://server-runtime.js"_s)); // importMeta

  // `JSC::call` returns undefined (not empty) when the callee throws.
  JSC::JSValue result = JSC::profiledCall(global, JSC::ProfilingReason::API, fn, callData, JSC::jsUndefined(), args);
  RETURN_IF_EXCEPTION(scope, {});
  return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue BakeLoadModuleByKey(JSC::JSGlobalObject* global, JSC::EncodedJSValue keyValue) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  JSC::JSString* key = uncheckedDowncast<JSC::JSString>(JSC::JSValue::decode(keyValue));
  String keyString = key->getString(global);
  RETURN_IF_EXCEPTION(scope, {});

  JSC::JSPromise* promise = JSC::loadAndEvaluateModule(global, keyString, nullptr, nullptr);
  RETURN_IF_EXCEPTION(scope, {});
  ASSERT(promise);
  return JSC::JSValue::encode(promise);
}

extern "C" JSC::EncodedJSValue BakeLoadServerHmrPatch(JSC::JSGlobalObject* global, BunString source) {
  JSC::VM&vm = global->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server.patch.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(SourceProvider::create(
    global,
    source.toWTFString(),
    origin,
    WTF::move(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Program
  ));

  JSC::JSValue result = vm.interpreter.executeProgram(sourceCode, global, global);
  RETURN_IF_EXCEPTION(scope, {});

  RELEASE_ASSERT(result);
  return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue BakeLoadServerHmrPatchWithSourceMap(JSC::JSGlobalObject* global, BunString source, const char* sourceMapJSONPtr, size_t sourceMapJSONLength) {
  JSC::VM&vm = global->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server.patch.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  
  // Use DevServerSourceProvider with the source map JSON
  auto provider = DevServerSourceProvider::create(
    global,
    source.toWTFString(),
    sourceMapJSONPtr,
    sourceMapJSONLength,
    origin,
    WTF::move(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Program
  );
  
  JSC::SourceCode sourceCode = JSC::SourceCode(provider);

  JSC::JSValue result = vm.interpreter.executeProgram(sourceCode, global, global);
  RETURN_IF_EXCEPTION(scope, {});

  RELEASE_ASSERT(result);
  return JSC::JSValue::encode(result);
}

// keyValue must name a module that has already been evaluated; then nullptr means an exception is pending.
static JSC::JSModuleNamespaceObject* getModuleNamespace(JSC::JSGlobalObject* global, JSC::JSValue keyValue) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  JSC::JSString* key = uncheckedDowncast<JSC::JSString>(keyValue);
  auto keyIdent = JSC::Identifier::fromString(vm, key->value(global));
  RETURN_IF_EXCEPTION(scope, nullptr);

  auto* entry = global->moduleLoader()->registryEntry(keyIdent);
  ASSERT(entry); // the caller waited for this module's evaluation promise
  auto* module = entry ? entry->record() : nullptr;
  ASSERT(module);
  JSC::JSModuleNamespaceObject* namespaceObject = global->moduleLoader()->getModuleNamespaceObject(global, module);
  RETURN_IF_EXCEPTION(scope, nullptr);
  ASSERT(namespaceObject);
  return namespaceObject;
}

extern "C" JSC::EncodedJSValue BakeGetModuleNamespace(
  JSC::JSGlobalObject* global,
  JSC::EncodedJSValue keyValue
) {
  return JSC::JSValue::encode(getModuleNamespace(global, JSC::JSValue::decode(keyValue)));
}

extern "C" JSC::EncodedJSValue BakeGetDefaultExportFromModule(
  JSC::JSGlobalObject* global,
  JSC::EncodedJSValue keyValue
) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  JSC::JSModuleNamespaceObject* namespaceObject = getModuleNamespace(global, JSC::JSValue::decode(keyValue));
  RETURN_IF_EXCEPTION(scope, {});

  JSC::JSValue defaultExport = namespaceObject->get(global, vm.propertyNames->defaultKeyword);
  RETURN_IF_EXCEPTION(scope, {});
  return JSC::JSValue::encode(defaultExport);
}

extern "C" JSC::EncodedJSValue BakeGetOnModuleNamespace(
  JSC::JSGlobalObject* global,
  JSC::EncodedJSValue moduleNamespaceValue,
  const unsigned char* key,
  size_t keyLength
) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  auto* moduleNamespace = uncheckedDowncast<JSC::JSModuleNamespaceObject>(JSC::JSValue::decode(moduleNamespaceValue));
  const auto propertyString = String(StringImpl::createWithoutCopying({ key, keyLength }));
  const auto identifier = JSC::Identifier::fromString(vm, propertyString);
  const auto property = JSC::PropertyName(identifier);
  JSC::JSValue value = moduleNamespace->get(global, property);
  RETURN_IF_EXCEPTION(scope, {});
  return JSC::JSValue::encode(value);
}

} // namespace Bake
