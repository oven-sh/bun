#include "KitDevGlobalObject.h"
#include "JSNextTickQueue.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "headers-handwritten.h"

namespace Kit {

#define INHERIT_HOOK_METHOD(name)                                              \
  Zig::GlobalObject::s_globalObjectMethodTable.name

const JSC::GlobalObjectMethodTable DevGlobalObject::s_globalObjectMethodTable =
    {
        INHERIT_HOOK_METHOD(supportsRichSourceInfo),
        INHERIT_HOOK_METHOD(shouldInterruptScript),
        INHERIT_HOOK_METHOD(javaScriptRuntimeFlags),
        INHERIT_HOOK_METHOD(queueMicrotaskToEventLoop),
        INHERIT_HOOK_METHOD(shouldInterruptScriptBeforeTimeout),
        INHERIT_HOOK_METHOD(moduleLoaderImportModule),
        INHERIT_HOOK_METHOD(moduleLoaderResolve),
        INHERIT_HOOK_METHOD(moduleLoaderFetch),
        INHERIT_HOOK_METHOD(moduleLoaderCreateImportMetaProperties),
        INHERIT_HOOK_METHOD(moduleLoaderEvaluate),
        INHERIT_HOOK_METHOD(promiseRejectionTracker),
        INHERIT_HOOK_METHOD(reportUncaughtExceptionAtEventLoop),
        INHERIT_HOOK_METHOD(currentScriptExecutionOwner),
        INHERIT_HOOK_METHOD(scriptExecutionStatus),
        INHERIT_HOOK_METHOD(reportViolationForUnsafeEval),
        INHERIT_HOOK_METHOD(defaultLanguage),
        INHERIT_HOOK_METHOD(compileStreaming),
        INHERIT_HOOK_METHOD(instantiateStreaming),
        INHERIT_HOOK_METHOD(deriveShadowRealmGlobalObject),
        INHERIT_HOOK_METHOD(codeForEval),
        INHERIT_HOOK_METHOD(canCompileStrings),
};

DevGlobalObject *
DevGlobalObject::create(JSC::VM &vm, JSC::Structure *structure,
                        const JSC::GlobalObjectMethodTable *methodTable) {
  DevGlobalObject *ptr = new (NotNull, JSC::allocateCell<DevGlobalObject>(vm))
      DevGlobalObject(vm, structure, methodTable);
  ptr->finishCreation(vm);
  return ptr;
}

void DevGlobalObject::finishCreation(JSC::VM &vm) {
  Base::finishCreation(vm);
  ASSERT(inherits(info()));
}

extern "C" BunVirtualMachine *Bun__getVM();

// A lot of this function is taken from 'Zig__GlobalObject__create'
extern "C" DevGlobalObject *KitCreateDevGlobal(DevServer *owner,
                                               void *console) {
  JSC::VM &vm = JSC::VM::create(JSC::HeapType::Large).leakRef();
  vm.heap.acquireAccess();
  JSC::JSLockHolder locker(vm);
  BunVirtualMachine *bunVM = Bun__getVM();
  WebCore::JSVMClientData::create(&vm, bunVM);

  JSC::Structure *structure = DevGlobalObject::createStructure(vm);
  DevGlobalObject *global = DevGlobalObject::create(
      vm, structure, &DevGlobalObject::s_globalObjectMethodTable);
  if (!global)
    BUN_PANIC("Failed to create DevGlobalObject");

  global->m_devServer = owner;
  global->m_bunVM = bunVM;

  JSC::gcProtect(global);

  global->setConsole(console);
  global->setStackTraceLimit(10); // Node.js defaults to 10

  // vm.setOnComputeErrorInfo(computeErrorInfoWrapper);
  vm.setOnEachMicrotaskTick([global](JSC::VM &vm) -> void {
    if (auto nextTickQueue = global->m_nextTickQueue.get()) {
      global->resetOnEachMicrotaskTick();
      Bun::JSNextTickQueue *queue =
          jsCast<Bun::JSNextTickQueue *>(nextTickQueue);
      queue->drain(vm, global);
      return;
    }
  });

  return global;
}

}; // namespace Kit
