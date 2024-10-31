#include "BakeGlobalObject.h"
#include "JSNextTickQueue.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "ProcessIdentifier.h"
#include "headers-handwritten.h"

namespace Bake {

extern "C" void BakeInitProcessIdentifier()
{
    // assert is on main thread
    WebCore::Process::identifier();
}

JSC::JSInternalPromise*
bakeModuleLoaderImportModule(JSC::JSGlobalObject* jsGlobalObject,
    JSC::JSModuleLoader*, JSC::JSString* moduleNameValue,
    JSC::JSValue parameters,
    const JSC::SourceOrigin& sourceOrigin)
{
    // TODO: forward this to the runtime?
    JSC::VM& vm = jsGlobalObject->vm();
    WTF::String keyString = moduleNameValue->getString(jsGlobalObject);
    auto err = JSC::createTypeError(
        jsGlobalObject,
        WTF::makeString(
            "Dynamic import to '"_s, keyString,
            "' should have been replaced with a hook into the module runtime"_s));
    auto* promise = JSC::JSInternalPromise::create(
        vm, jsGlobalObject->internalPromiseStructure());
    promise->reject(jsGlobalObject, err);
    return promise;
}

extern "C" BunString BakeProdResolve(JSC::JSGlobalObject*, BunString a, BunString b);

JSC::Identifier bakeModuleLoaderResolve(JSC::JSGlobalObject* jsGlobal,
    JSC::JSModuleLoader* loader, JSC::JSValue key,
    JSC::JSValue referrer, JSC::JSValue origin)
{
    Bake::GlobalObject* global = jsCast<Bake::GlobalObject*>(jsGlobal);
    JSC::VM& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (global->isProduction()) {
        WTF::String keyString = key.toWTFString(global);
        RETURN_IF_EXCEPTION(scope, vm.propertyNames->emptyIdentifier);

        ASSERT(referrer.isString());
        auto refererString = jsCast<JSC::JSString*>(referrer)->value(global);

        BunString result = BakeProdResolve(global, Bun::toString(referrer.getString(global)), Bun::toString(keyString));
        return JSC::Identifier::fromString(vm, result.toWTFString(BunString::ZeroCopy));
    } else {
        JSC::throwTypeError(global, scope, "External imports are not allowed in Bun Bake's dev server. This is a bug in Bun's bundler."_s);
        return vm.propertyNames->emptyIdentifier;
    }
}

#define INHERIT_HOOK_METHOD(name) \
    Zig::GlobalObject::s_globalObjectMethodTable.name

const JSC::GlobalObjectMethodTable GlobalObject::s_globalObjectMethodTable = {
    INHERIT_HOOK_METHOD(supportsRichSourceInfo),
    INHERIT_HOOK_METHOD(shouldInterruptScript),
    INHERIT_HOOK_METHOD(javaScriptRuntimeFlags),
    INHERIT_HOOK_METHOD(queueMicrotaskToEventLoop),
    INHERIT_HOOK_METHOD(shouldInterruptScriptBeforeTimeout),
    bakeModuleLoaderImportModule,
    bakeModuleLoaderResolve,
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

GlobalObject* GlobalObject::create(JSC::VM& vm, JSC::Structure* structure,
    const JSC::GlobalObjectMethodTable* methodTable)
{
    GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm))
        GlobalObject(vm, structure, methodTable);
    ptr->finishCreation(vm);
    return ptr;
}

void GlobalObject::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

extern "C" BunVirtualMachine* Bun__getVM();

// A lot of this function is taken from 'Zig__GlobalObject__create'
// TODO: remove this entire method
extern "C" GlobalObject* BakeCreateDevGlobal(DevServer* owner,
    void* console)
{
    JSC::VM& vm = JSC::VM::create(JSC::HeapType::Large).leakRef();
    vm.heap.acquireAccess();
    JSC::JSLockHolder locker(vm);
    BunVirtualMachine* bunVM = Bun__getVM();
    WebCore::JSVMClientData::create(&vm, bunVM);

    JSC::Structure* structure = GlobalObject::createStructure(vm);
    GlobalObject* global = GlobalObject::create(
        vm, structure, &GlobalObject::s_globalObjectMethodTable);
    if (!global)
        BUN_PANIC("Failed to create BakeGlobalObject");

    global->m_devServer = owner;
    global->m_bunVM = bunVM;

    JSC::gcProtect(global);

    global->setConsole(console);
    global->setStackTraceLimit(10); // Node.js defaults to 10

    // TODO: it segfaults! process.nextTick is scoped out for now i guess!
    // vm.setOnComputeErrorInfo(computeErrorInfoWrapper);
    // vm.setOnEachMicrotaskTick([global](JSC::VM &vm) -> void {
    //   if (auto nextTickQueue = global->m_nextTickQueue.get()) {
    //     global->resetOnEachMicrotaskTick();
    //     // Bun::JSNextTickQueue *queue =
    //     //     jsCast<Bun::JSNextTickQueue *>(nextTickQueue);
    //     // queue->drain(vm, global);
    //     return;
    //   }
    // });

    return global;
}

extern "C" GlobalObject* BakeCreateProdGlobal(JSC::VM* vm, void* console)
{
    JSC::JSLockHolder locker(vm);
    BunVirtualMachine* bunVM = Bun__getVM();

    JSC::Structure* structure = GlobalObject::createStructure(*vm);
    GlobalObject* global = GlobalObject::create(*vm, structure, &GlobalObject::s_globalObjectMethodTable);
    if (!global)
        BUN_PANIC("Failed to create BakeGlobalObject");

    global->m_devServer = nullptr;
    global->m_bunVM = bunVM;

    JSC::gcProtect(global);

    global->setConsole(console);
    global->setStackTraceLimit(10); // Node.js defaults to 10

    return global;
}

}; // namespace Bake
