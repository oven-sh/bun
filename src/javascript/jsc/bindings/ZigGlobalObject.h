#include "root.h"
#pragma once

#include "headers-handwritten.h"

namespace JSC {
class Structure;
class Identifier;

} // namespace JSC

#include "Process.h"
#include "ZigConsoleClient.h"
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/Structure.h>

namespace Zig {

class GlobalObject : public JSC::JSGlobalObject {
  using Base = JSC::JSGlobalObject;

    public:
  DECLARE_EXPORT_INFO;
  static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;
  Zig::Process *m_process;
  static constexpr bool needsDestruction = true;
  template <typename CellType, JSC::SubspaceAccess mode>
  static JSC::IsoSubspace *subspaceFor(JSC::VM &vm) {
    return vm.globalObjectSpace<mode>();
  }

  static GlobalObject *create(JSC::VM &vm, JSC::Structure *structure) {
    auto *object =
      new (NotNull, JSC::allocateCell<GlobalObject>(vm.heap)) GlobalObject(vm, structure);
    object->finishCreation(vm);
    return object;
  }

  static JSC::Structure *createStructure(JSC::VM &vm, JSC::JSValue prototype) {
    auto *result = JSC::Structure::create(
      vm, nullptr, prototype, JSC::TypeInfo(JSC::GlobalObjectType, Base::StructureFlags), info());
    result->setTransitionWatchpointIsLikelyToBeFired(true);
    return result;
  }

  static void reportUncaughtExceptionAtEventLoop(JSGlobalObject *, JSC::Exception *);

  static void queueMicrotaskToEventLoop(JSC::JSGlobalObject &global, Ref<JSC::Microtask> &&task);
  static JSC::JSInternalPromise *moduleLoaderImportModule(JSGlobalObject *, JSC::JSModuleLoader *,
                                                          JSC::JSString *moduleNameValue,
                                                          JSC::JSValue parameters,
                                                          const JSC::SourceOrigin &);
  static JSC::Identifier moduleLoaderResolve(JSGlobalObject *, JSC::JSModuleLoader *,
                                             JSC::JSValue keyValue, JSC::JSValue referrerValue,
                                             JSC::JSValue);
  static JSC::JSInternalPromise *moduleLoaderFetch(JSGlobalObject *, JSC::JSModuleLoader *,
                                                   JSC::JSValue, JSC::JSValue, JSC::JSValue);
  static JSC::JSObject *moduleLoaderCreateImportMetaProperties(JSGlobalObject *,
                                                               JSC::JSModuleLoader *, JSC::JSValue,
                                                               JSC::JSModuleRecord *, JSC::JSValue);
  static JSC::JSValue moduleLoaderEvaluate(JSGlobalObject *, JSC::JSModuleLoader *, JSC::JSValue,
                                           JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue);
  static void promiseRejectionTracker(JSGlobalObject *, JSC::JSPromise *,
                                      JSC::JSPromiseRejectionOperation);
  void setConsole(void *console);
  void installAPIGlobals(JSClassRef *globals, int count);

    private:
  GlobalObject(JSC::VM &vm, JSC::Structure *structure)
    : JSC::JSGlobalObject(vm, structure, &s_globalObjectMethodTable) {}
};

class JSMicrotaskCallback : public RefCounted<JSMicrotaskCallback> {
    public:
  static Ref<JSMicrotaskCallback> create(JSC::JSGlobalObject &globalObject,
                                         Ref<JSC::Microtask> &&task) {
    return adoptRef(*new JSMicrotaskCallback(globalObject, WTFMove(task).leakRef()));
  }

  void call() {
    auto protectedThis{makeRef(*this)};
    JSC::VM &vm = m_globalObject->vm();
    auto task = &m_task.get();
    task->run(m_globalObject.get());
  }

    private:
  JSMicrotaskCallback(JSC::JSGlobalObject &globalObject, Ref<JSC::Microtask> &&task)
    : m_globalObject{globalObject.vm(), &globalObject}, m_task{WTFMove(task)} {}

  JSC::Strong<JSC::JSGlobalObject> m_globalObject;
  Ref<JSC::Microtask> m_task;
};

} // namespace Zig
