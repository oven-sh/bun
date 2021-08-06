#include "ZigGlobalObject.h"
#include "helpers.h"

#include "ZigConsoleClient.h"
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/ClassInfo.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/HashMapImpl.h>
#include <JavaScriptCore/HashMapImplInlines.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/InitializeThreading.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSContextInternal.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSValueInternal.h>
#include <JavaScriptCore/JSVirtualMachineInternal.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/WasmFaultSignalHandler.h>
#include <wtf/URL.h>

#include <JavaScriptCore/JSLock.h>
#include <wtf/StdLibExtras.h>

#include <cstdlib>
#include <exception>
#include <iostream>

// #include <JavaScriptCore/CachedType.h>
#include <JavaScriptCore/JSCallbackObject.h>
#include <JavaScriptCore/JSClassRef.h>

#include "ZigSourceProvider.h"

using JSGlobalObject = JSC::JSGlobalObject;
using Exception = JSC::Exception;
using JSValue = JSC::JSValue;
using JSString = JSC::JSString;
using JSModuleLoader = JSC::JSModuleLoader;
using JSModuleRecord = JSC::JSModuleRecord;
using Identifier = JSC::Identifier;
using SourceOrigin = JSC::SourceOrigin;
using JSObject = JSC::JSObject;
using JSNonFinalObject = JSC::JSNonFinalObject;
namespace JSCastingHelpers = JSC::JSCastingHelpers;

extern "C" JSC__JSGlobalObject *Zig__GlobalObject__create(JSClassRef *globalObjectClass, int count,
                                                          void *console_client) {
  std::set_terminate([]() { Zig__GlobalObject__onCrash(); });
  WTF::initializeMainThread();
  JSC::initialize();

  JSC::VM &vm = JSC::VM::create(JSC::LargeHeap).leakRef();

#if ENABLE(WEBASSEMBLY)
  JSC::Wasm::enableFastMemory();
#endif

  JSC::JSLockHolder locker(vm);
  Zig::GlobalObject *globalObject =
    Zig::GlobalObject::create(vm, Zig::GlobalObject::createStructure(vm, JSC::jsNull()));
  globalObject->setConsole(globalObject);

  if (count > 0) { globalObject->installAPIGlobals(globalObjectClass, count); }

  JSC::gcProtect(globalObject);
  vm.ref();
  return globalObject;
}

namespace Zig {

const JSC::ClassInfo GlobalObject::s_info = {"GlobalObject", &Base::s_info, nullptr, nullptr,
                                             CREATE_METHOD_TABLE(GlobalObject)};

const JSC::GlobalObjectMethodTable GlobalObject::s_globalObjectMethodTable = {
  &supportsRichSourceInfo,
  &shouldInterruptScript,
  &javaScriptRuntimeFlags,
  nullptr,                                 // queueTaskToEventLoop
  nullptr,                                 // &shouldInterruptScriptBeforeTimeout,
  &moduleLoaderImportModule,               // moduleLoaderImportModule
  &moduleLoaderResolve,                    // moduleLoaderResolve
  &moduleLoaderFetch,                      // moduleLoaderFetch
  &moduleLoaderCreateImportMetaProperties, // moduleLoaderCreateImportMetaProperties
  &moduleLoaderEvaluate,                   // moduleLoaderEvaluate
  &promiseRejectionTracker,                // promiseRejectionTracker
  &reportUncaughtExceptionAtEventLoop,
  &currentScriptExecutionOwner,
  &scriptExecutionStatus,
  nullptr, // defaultLanguage
  nullptr, // compileStreaming
  nullptr, // instantiateStreaming
};

void GlobalObject::reportUncaughtExceptionAtEventLoop(JSGlobalObject *globalObject,
                                                      Exception *exception) {
  Zig__GlobalObject__reportUncaughtException(globalObject, exception);
}

void GlobalObject::promiseRejectionTracker(JSGlobalObject *obj, JSC::JSPromise *prom,
                                           JSC::JSPromiseRejectionOperation reject) {
  Zig__GlobalObject__promiseRejectionTracker(
    obj, prom, reject == JSC::JSPromiseRejectionOperation::Reject ? 0 : 1);
}

static Zig::ConsoleClient *m_console;

void GlobalObject::setConsole(void *console) {
  m_console = new Zig::ConsoleClient(console);
  this->setConsoleClient(makeWeakPtr(m_console));
}

void GlobalObject::installAPIGlobals(JSClassRef *globals, int count) {
  WTF::Vector<GlobalPropertyInfo> extraStaticGlobals;
  extraStaticGlobals.reserveCapacity((size_t)count);

  for (int i = 0; i < count; i++) {
    auto jsClass = globals[i];

    JSC::JSCallbackObject<JSNonFinalObject> *object =
      JSC::JSCallbackObject<JSNonFinalObject>::create(this, this->callbackObjectStructure(),
                                                      jsClass, nullptr);
    if (JSObject *prototype = jsClass->prototype(this)) object->setPrototypeDirect(vm(), prototype);

    extraStaticGlobals.uncheckedAppend(
      GlobalPropertyInfo{JSC::Identifier::fromString(vm(), jsClass->className()),
                         JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0});
  }
  this->addStaticGlobals(extraStaticGlobals.data(), count);
  extraStaticGlobals.releaseBuffer();
}

JSC::Identifier GlobalObject::moduleLoaderResolve(JSGlobalObject *globalObject,
                                                  JSModuleLoader *loader, JSValue key,
                                                  JSValue referrer, JSValue origin) {
  ErrorableZigString res;
  res.success = false;
  Zig__GlobalObject__resolve(&res, globalObject, toZigString(key, globalObject),
                             referrer.isString() ? toZigString(referrer, globalObject)
                                                 : ZigStringEmpty);

  if (res.success) {
    return toIdentifier(res.result.value, globalObject);
  } else {
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwException(scope, res.result.err, globalObject);
    return globalObject->vm().propertyNames->emptyIdentifier;
  }
}

JSC::JSInternalPromise *GlobalObject::moduleLoaderImportModule(JSGlobalObject *globalObject,
                                                               JSModuleLoader *,
                                                               JSString *moduleNameValue,
                                                               JSValue parameters,
                                                               const SourceOrigin &sourceOrigin) {
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  auto *promise = JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
  RETURN_IF_EXCEPTION(scope, promise->rejectWithCaughtException(globalObject, scope));

  auto sourceURL = sourceOrigin.url();
  ErrorableZigString resolved;
  resolved.success = false;
  Zig__GlobalObject__resolve(&resolved, globalObject, toZigString(moduleNameValue, globalObject),
                             sourceURL.isEmpty() ? ZigStringCwd
                                                 : toZigString(sourceURL.fileSystemPath()));
  if (!resolved.success) {
    throwException(scope, resolved.result.err, globalObject);
    return promise->rejectWithCaughtException(globalObject, scope);
  }

  auto result = JSC::importModule(globalObject, toIdentifier(resolved.result.value, globalObject),
                                  parameters, JSC::jsUndefined());
  RETURN_IF_EXCEPTION(scope, promise->rejectWithCaughtException(globalObject, scope));

  return result;
}

extern "C" void *Zig__GlobalObject__getModuleRegistryMap(JSC__JSGlobalObject *arg0) {
  if (JSC::JSObject *loader =
        JSC::jsDynamicCast<JSC::JSObject *>(arg0->vm(), arg0->moduleLoader())) {
    JSC::JSMap *map = JSC::jsDynamicCast<JSC::JSMap *>(
      arg0->vm(),
      loader->getDirect(arg0->vm(), JSC::Identifier::fromString(arg0->vm(), "registry")));

    JSC::JSMap *cloned = map->clone(arg0, arg0->vm(), arg0->mapStructure());
    JSC::gcProtect(cloned);

    return cloned;
  }

  return nullptr;
}

extern "C" bool Zig__GlobalObject__resetModuleRegistryMap(JSC__JSGlobalObject *globalObject,
                                                          void *map_ptr) {
  if (map_ptr == nullptr) return false;
  JSC::JSMap *map = reinterpret_cast<JSC::JSMap *>(map_ptr);

  if (JSC::JSObject *obj =
        JSC::jsDynamicCast<JSC::JSObject *>(globalObject->vm(), globalObject->moduleLoader())) {
    auto identifier = JSC::Identifier::fromString(globalObject->vm(), "registry");

    if (JSC::JSMap *oldMap = JSC::jsDynamicCast<JSC::JSMap *>(
          globalObject->vm(), obj->getDirect(globalObject->vm(), identifier))) {
      // Help the GC by releasing the old map.
      oldMap->clear(globalObject);
      // forEachInIterable(
      //   globalObject, oldMap, [&](VM &vm, JSGlobalObject *globalObject, JSValue nextValue) {
      //     auto scope = DECLARE_THROW_SCOPE(vm);
      //     JSC::JSValue key = nextObject->getIndex(globalObject, static_cast<unsigned>(0));
      //     RETURN_IF_EXCEPTION(scope, void());

      //     if (!map->has(globalObject, key)) {

      //       JSC::JSValue value = nextObject->getIndex(globalObject, static_cast<unsigned>(1));
      //       RETURN_IF_EXCEPTION(scope, void());

      //     }
      //     scope.release();
      //   });
    };

    return obj->putDirect(
      globalObject->vm(), identifier,
      map->clone(globalObject, globalObject->vm(), globalObject->mapStructure()));
  }

  return false;
}

JSC::JSInternalPromise *GlobalObject::moduleLoaderFetch(JSGlobalObject *globalObject,
                                                        JSModuleLoader *loader, JSValue key,
                                                        JSValue value1, JSValue value2) {
  JSC::VM &vm = globalObject->vm();
  JSC::JSInternalPromise *promise =
    JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());

  auto scope = DECLARE_THROW_SCOPE(vm);

  auto rejectWithError = [&](JSC::JSValue error) {
    promise->reject(globalObject, error);
    return promise;
  };

  auto moduleKey = key.toWTFString(globalObject);
  RETURN_IF_EXCEPTION(scope, promise->rejectWithCaughtException(globalObject, scope));
  auto moduleKeyZig = toZigString(moduleKey);
  ErrorableResolvedSource res;
  res.success = false;
  res.result.err.code = 0;
  res.result.err.ptr = nullptr;

  Zig__GlobalObject__fetch(&res, globalObject, moduleKeyZig,
                           Zig::toZigString(value1, globalObject));

  if (!res.success) {
    throwException(scope, res.result.err, globalObject);
    RETURN_IF_EXCEPTION(scope, promise->rejectWithCaughtException(globalObject, scope));
  }

  auto provider = Zig::SourceProvider::create(res.result.value);

  auto jsSourceCode = JSC::JSSourceCode::create(vm, JSC::SourceCode(provider));

  if (provider.ptr()->isBytecodeCacheEnabled()) {
    provider.ptr()->readOrGenerateByteCodeCache(vm, jsSourceCode->sourceCode());
  }

  scope.release();
  promise->resolve(globalObject, jsSourceCode);
  globalObject->vm().drainMicrotasks();
  return promise;
}

JSC::JSObject *GlobalObject::moduleLoaderCreateImportMetaProperties(JSGlobalObject *globalObject,
                                                                    JSModuleLoader *loader,
                                                                    JSValue key,
                                                                    JSModuleRecord *record,
                                                                    JSValue val) {
  return nullptr;
  // auto res = Zig__GlobalObject__createImportMetaProperties(
  //     globalObject,
  //     loader,
  //     JSValue::encode(key),
  //     record,
  //     JSValue::encode(val)
  // );

  // return JSValue::decode(res).getObject();
}

JSC::JSValue GlobalObject::moduleLoaderEvaluate(JSGlobalObject *globalObject,
                                                JSModuleLoader *moduleLoader, JSValue key,
                                                JSValue moduleRecordValue, JSValue scriptFetcher,
                                                JSValue sentValue, JSValue resumeMode) {
  // VM& vm = globalObject->vm();
  return moduleLoader->evaluateNonVirtual(globalObject, key, moduleRecordValue, scriptFetcher,
                                          sentValue, resumeMode);
}

} // namespace Zig