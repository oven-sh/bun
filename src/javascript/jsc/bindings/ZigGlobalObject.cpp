#include "ZigGlobalObject.h"
#include "helpers.h"

#include "ZigConsoleClient.h"
#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/BytecodeIndex.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/ClassInfo.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/ExceptionScope.h>
#include <JavaScriptCore/FunctionConstructor.h>
#include <JavaScriptCore/HashMapImpl.h>
#include <JavaScriptCore/HashMapImplInlines.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/InitializeThreading.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCallbackObject.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSClassRef.h>
// #include <JavaScriptCore/JSContextInternal.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSValueInternal.h>
#include <JavaScriptCore/JSVirtualMachineInternal.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/OptionsList.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/VMEntryScope.h>
#include <JavaScriptCore/WasmFaultSignalHandler.h>
#include <wtf/StdLibExtras.h>
#include <wtf/URL.h>
#include <wtf/text/ExternalStringImpl.h>
#include <wtf/text/StringCommon.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

#include <wtf/Gigacage.h>

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

bool has_loaded_jsc = false;

extern "C" void JSCInitialize() {
  if (has_loaded_jsc) return;
  JSC::Options::useSourceProviderCache() = true;
  JSC::Options::useUnlinkedCodeBlockJettisoning() = false;
  JSC::Options::exposeInternalModuleLoader() = true;
  JSC::Options::useSharedArrayBuffer() = true;
  // JSC::Options::useAtMethod() = true;

  // std::set_terminate([]() { Zig__GlobalObject__onCrash(); });
  WTF::initializeMainThread();
  JSC::initialize();
  // Gigacage::disablePrimitiveGigacage();
  has_loaded_jsc = true;
}

extern "C" JSC__JSGlobalObject *Zig__GlobalObject__create(JSClassRef *globalObjectClass, int count,
                                                          void *console_client) {
  auto heapSize = JSC::LargeHeap;

  JSC::VM &vm = JSC::VM::create(heapSize).leakRef();
  vm.heap.acquireAccess();
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

// This is not a publicly exposed API currently.
// This is used by the bundler to make Response, Request, FetchEvent,
// and any other objects available globally.
void GlobalObject::installAPIGlobals(JSClassRef *globals, int count) {
  WTF::Vector<GlobalPropertyInfo> extraStaticGlobals;
  extraStaticGlobals.reserveCapacity((size_t)count + 2);

  // This is not nearly a complete implementation. It's just enough to make some npm packages that
  // were compiled with Webpack to run without crashing in this environment.
  JSC::JSObject *process = JSC::constructEmptyObject(this, this->objectPrototype(), 4);

  // The transpiler inlines all defined process.env vars & dead code eliminates as relevant
  // so this is just to return undefined for any missing ones and not crash if something tries to
  // modify it or it wasn't statically analyzable
  JSC::JSObject *processDotEnv = JSC::constructEmptyObject(this, this->objectPrototype(), 0);

  // this should be transpiled out, but just incase
  process->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "browser"),
                     JSC::JSValue(false));

  // this gives some way of identifying at runtime whether the SSR is happening in node or not.
  // this should probably be renamed to what the name of the bundler is, instead of "notNodeJS"
  // but it must be something that won't evaluate to truthy in Node.js
  process->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "notNodeJS"),
                     JSC::JSValue(true));
#if defined(__APPLE__)
  process->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "platform"),
                     JSC::jsString(this->vm(), WTF::String("darwin")));
#else
  process->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "platform"),
                     JSC::jsString(this->vm(), WTF::String("linux")));
#endif
  int i = 0;
  for (; i < count - 1; i++) {
    auto jsClass = globals[i];

    JSC::JSCallbackObject<JSNonFinalObject> *object =
      JSC::JSCallbackObject<JSNonFinalObject>::create(this, this->callbackObjectStructure(),
                                                      jsClass, nullptr);
    if (JSObject *prototype = jsClass->prototype(this)) object->setPrototypeDirect(vm(), prototype);

    extraStaticGlobals.uncheckedAppend(
      GlobalPropertyInfo{JSC::Identifier::fromString(vm(), jsClass->className()),
                         JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0});
  }

  // The last one must be "process.env"
  // Runtime-support is for if they change
  {
    auto jsClass = globals[i];

    JSC::JSCallbackObject<JSNonFinalObject> *object =
      JSC::JSCallbackObject<JSNonFinalObject>::create(this, this->callbackObjectStructure(),
                                                      jsClass, nullptr);
    if (JSObject *prototype = jsClass->prototype(this)) object->setPrototypeDirect(vm(), prototype);

    process->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "env"),
                       JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0);
  }

  extraStaticGlobals.uncheckedAppend(
    GlobalPropertyInfo{JSC::Identifier::fromString(vm(), "process"), JSC::JSValue(process),
                       JSC::PropertyAttribute::DontDelete | 0});

  this->addStaticGlobals(extraStaticGlobals.data(), extraStaticGlobals.size());
  extraStaticGlobals.releaseBuffer();
}

JSC::Identifier GlobalObject::moduleLoaderResolve(JSGlobalObject *globalObject,
                                                  JSModuleLoader *loader, JSValue key,
                                                  JSValue referrer, JSValue origin) {
  ErrorableZigString res;
  res.success = false;
  ZigString keyZ = toZigString(key, globalObject);
  ZigString referrerZ = referrer.isString() ? toZigString(referrer, globalObject) : ZigStringEmpty;
  Zig__GlobalObject__resolve(&res, globalObject, &keyZ, &referrerZ);

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
  auto moduleNameZ = toZigString(moduleNameValue, globalObject);
  auto sourceOriginZ = sourceURL.isEmpty() ? ZigStringCwd : toZigString(sourceURL.fileSystemPath());
  resolved.success = false;
  Zig__GlobalObject__resolve(&resolved, globalObject, &moduleNameZ, &sourceOriginZ);
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
  JSC::VM &vm = globalObject->vm();
  if (JSC::JSObject *obj =
        JSC::jsDynamicCast<JSC::JSObject *>(globalObject->vm(), globalObject->moduleLoader())) {
    auto identifier = JSC::Identifier::fromString(globalObject->vm(), "registry");

    if (JSC::JSMap *oldMap = JSC::jsDynamicCast<JSC::JSMap *>(
          globalObject->vm(), obj->getDirect(globalObject->vm(), identifier))) {
      oldMap->clear(globalObject);
      // vm.finalizeSynchronousJSExecution();

      obj->putDirect(globalObject->vm(), identifier,
                     map->clone(globalObject, globalObject->vm(), globalObject->mapStructure()));

      // vm.deleteAllLinkedCode(JSC::DeleteAllCodeEffort::DeleteAllCodeIfNotCollecting);
      // JSC::Heap::PreventCollectionScope(vm.heap);

      // vm.heap.completeAllJITPlans();

      // vm.forEachScriptExecutableSpace([&](auto &spaceAndSet) {
      //   JSC::HeapIterationScope heapIterationScope(vm.heap);
      //   auto &set = spaceAndSet.set;
      //   set.forEachLiveCell([&](JSC::HeapCell *cell, JSC::HeapCell::Kind) {
      //     if (JSC::ModuleProgramExecutable *executable =
      //           JSC::jsDynamicCast<JSC::ModuleProgramExecutable *>(cell)) {
      //       executable->clearCode(set);
      //     }
      //   });
      // });
    }
    // globalObject->vm().heap.deleteAllUnlinkedCodeBlocks(
    //   JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
    // vm.whenIdle([globalObject, oldMap, map]() {
    //   auto recordIdentifier = JSC::Identifier::fromString(globalObject->vm(), "module");

    //   JSC::JSModuleRecord *record;
    //   JSC::JSValue key;
    //   JSC::JSValue value;
    //   JSC::JSObject *mod;
    //   JSC::JSObject *nextObject;
    //   JSC::forEachInIterable(
    //     globalObject, oldMap,
    //     [&](JSC::VM &vm, JSC::JSGlobalObject *globalObject, JSC::JSValue nextValue) {
    //       nextObject = JSC::jsDynamicCast<JSC::JSObject *>(vm, nextValue);
    //       key = nextObject->getIndex(globalObject, static_cast<unsigned>(0));

    //       if (!map->has(globalObject, key)) {
    //         value = nextObject->getIndex(globalObject, static_cast<unsigned>(1));
    //         mod = JSC::jsDynamicCast<JSC::JSObject *>(vm, value);
    //         if (mod) {
    //           record = JSC::jsDynamicCast<JSC::JSModuleRecord *>(
    //             vm, mod->getDirect(vm, recordIdentifier));
    //           if (record) {
    //             auto code = &record->sourceCode();
    //             if (code) {

    //               Zig::SourceProvider *provider =
    //                 reinterpret_cast<Zig::SourceProvider *>(code->provider());
    //               // code->~SourceCode();
    //               if (provider) { provider->freeSourceCode(); }
    //             }
    //           }
    //         }
    //       }
    //     });

    //   oldMap->clear(globalObject);
    //   }
    // }
    // map
  }
  return true;
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
  auto source = Zig::toZigString(value1, globalObject);
  ErrorableResolvedSource res;
  res.success = false;
  res.result.err.code = 0;
  res.result.err.ptr = nullptr;

  Zig__GlobalObject__fetch(&res, globalObject, &moduleKeyZig, &source);

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

  ZigString specifier = Zig::toZigString(key, globalObject);
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  JSC::JSObject *metaProperties =
    JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
  RETURN_IF_EXCEPTION(scope, nullptr);

  metaProperties->putDirect(vm, Identifier::fromString(vm, "filePath"), key);
  RETURN_IF_EXCEPTION(scope, nullptr);

  // metaProperties->putDirect(vm, Identifier::fromString(vm, "resolve"),
  //                           globalObject->globalThis()
  //                             ->get(vm, Identifier::fromString("Bun"))
  //                             .getObject()
  //                             ->get(vm, Identifier::fromString("resolve"))); );
  // RETURN_IF_EXCEPTION(scope, nullptr);

  return metaProperties;
}

JSC::JSValue GlobalObject::moduleLoaderEvaluate(JSGlobalObject *globalObject,
                                                JSModuleLoader *moduleLoader, JSValue key,
                                                JSValue moduleRecordValue, JSValue scriptFetcher,
                                                JSValue sentValue, JSValue resumeMode) {

  JSC::JSValue result = moduleLoader->evaluateNonVirtual(globalObject, key, moduleRecordValue,
                                                         scriptFetcher, sentValue, resumeMode);

  return result;
}

} // namespace Zig