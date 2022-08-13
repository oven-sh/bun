#pragma once

#ifndef ZIG_GLOBAL_OBJECT
#define ZIG_GLOBAL_OBJECT

namespace JSC {
class Structure;
class Identifier;
class LazyClassStructure;

} // namespace JSC

namespace WebCore {
class ScriptExecutionContext;
class DOMGuardedObject;
class EventLoopTask;
}

#include "root.h"

#include "headers-handwritten.h"
#include "BunClientData.h"

#include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSTypeInfo.h"
#include "JavaScriptCore/Structure.h"
#include "WebCoreJSBuiltinInternals.h"

#include "ZigConsoleClient.h"

#include "DOMConstructors.h"
#include "DOMWrapperWorld-class.h"
#include "DOMIsoSubspaces.h"
// #include "EventTarget.h"

// namespace WebCore {
// class GlobalEventTarget : public EventTargetWithInlineData, public ContextDestructionObserver {
//     WTF_MAKE_ISO_ALLOCATED(GlobalEventTarget);

// public:
//     static Ref<GlobalEventTarget> create(ScriptExecutionContext&);

//     EventTargetInterface eventTargetInterface() const final { return DOMWindowEventTargetInterfaceType; }
//     ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
//     void refEventTarget() final {}
//     void derefEventTarget() final {}
//     void eventListenersDidChange() final;
// };

// }

namespace Zig {

using JSDOMStructureMap = HashMap<const JSC::ClassInfo*, JSC::WriteBarrier<JSC::Structure>>;
using DOMGuardedObjectSet = HashSet<WebCore::DOMGuardedObject*>;

#define ZIG_GLOBAL_OBJECT_DEFINED

class GlobalObject : public JSC::JSGlobalObject {
    using Base = JSC::JSGlobalObject;

public:
    static const JSC::ClassInfo s_info;
    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;

    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<GlobalObject, WebCore::UseCustomHeapCellType::Yes>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForWorkerGlobalScope.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWorkerGlobalScope = WTFMove(space); },
            [](auto& spaces) { return spaces.m_subspaceForWorkerGlobalScope.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForWorkerGlobalScope = WTFMove(space); },
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSWorkerGlobalScope; });
    }

    ~GlobalObject();
    static void destroy(JSC::JSCell*);

    static constexpr const JSC::ClassInfo* info() { return &s_info; }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* global, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, global, prototype, JSC::TypeInfo(JSC::GlobalObjectType, StructureFlags), info());
    }

    // Make binding code generation easier.
    GlobalObject* globalObject() { return this; }

    DOMGuardedObjectSet& guardedObjects() WTF_REQUIRES_LOCK(m_gcLock) { return m_guardedObjects; }

    const DOMGuardedObjectSet& guardedObjects() const WTF_IGNORES_THREAD_SAFETY_ANALYSIS
    {
        ASSERT(!Thread::mayBeGCThread());
        return m_guardedObjects;
    }
    DOMGuardedObjectSet& guardedObjects(NoLockingNecessaryTag) WTF_IGNORES_THREAD_SAFETY_ANALYSIS
    {
        ASSERT(!vm().heap.mutatorShouldBeFenced());
        return m_guardedObjects;
    }

    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure)
    {
        GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    const JSDOMStructureMap& structures() const WTF_IGNORES_THREAD_SAFETY_ANALYSIS
    {
        ASSERT(!Thread::mayBeGCThread());
        return m_structures;
    }
    const WebCore::DOMConstructors& constructors() const
    {
        ASSERT(!Thread::mayBeGCThread());
        return *m_constructors;
    }

    WebCore::DOMWrapperWorld& world() { return m_world.get(); }

    DECLARE_VISIT_CHILDREN;

    bool worldIsNormal() const { return m_worldIsNormal; }
    static ptrdiff_t offsetOfWorldIsNormal() { return OBJECT_OFFSETOF(GlobalObject, m_worldIsNormal); }

    WebCore::ScriptExecutionContext* scriptExecutionContext();
    WebCore::ScriptExecutionContext* scriptExecutionContext() const;

    void queueTask(WebCore::EventLoopTask* task);

    JSDOMStructureMap& structures() WTF_REQUIRES_LOCK(m_gcLock) { return m_structures; }
    JSDOMStructureMap& structures(NoLockingNecessaryTag) WTF_IGNORES_THREAD_SAFETY_ANALYSIS
    {
        ASSERT(!vm().heap.mutatorShouldBeFenced());
        return m_structures;
    }

    WebCore::DOMConstructors& constructors() { return *m_constructors; }

    Lock& gcLock() WTF_RETURNS_LOCK(m_gcLock) { return m_gcLock; }

    void clearDOMGuardedObjects();

    static void reportUncaughtExceptionAtEventLoop(JSGlobalObject*, JSC::Exception*);
    static JSGlobalObject* deriveShadowRealmGlobalObject(JSGlobalObject* globalObject);
    static void queueMicrotaskToEventLoop(JSC::JSGlobalObject& global, Ref<JSC::Microtask>&& task);
    static JSC::JSInternalPromise* moduleLoaderImportModule(JSGlobalObject*, JSC::JSModuleLoader*,
        JSC::JSString* moduleNameValue,
        JSC::JSValue parameters,
        const JSC::SourceOrigin&);
    static JSC::Identifier moduleLoaderResolve(JSGlobalObject*, JSC::JSModuleLoader*,
        JSC::JSValue keyValue, JSC::JSValue referrerValue,
        JSC::JSValue);
    static JSC::JSInternalPromise* moduleLoaderFetch(JSGlobalObject*, JSC::JSModuleLoader*,
        JSC::JSValue, JSC::JSValue, JSC::JSValue);
    static JSC::JSObject* moduleLoaderCreateImportMetaProperties(JSGlobalObject*,
        JSC::JSModuleLoader*, JSC::JSValue,
        JSC::JSModuleRecord*, JSC::JSValue);
    static JSC::JSValue moduleLoaderEvaluate(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue,
        JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue);
    static void promiseRejectionTracker(JSGlobalObject*, JSC::JSPromise*,
        JSC::JSPromiseRejectionOperation);
    void setConsole(void* console);
    void installAPIGlobals(JSClassRef* globals, int count, JSC::VM& vm);
    WebCore::JSBuiltinInternalFunctions& builtinInternalFunctions() { return m_builtinInternalFunctions; }
    JSC::Structure* FFIFunctionStructure() { return m_JSFFIFunctionStructure.getInitializedOnMainThread(this); }
    JSC::Structure* NapiClassStructure() { return m_NapiClassStructure.getInitializedOnMainThread(this); }

    JSC::Structure* ArrayBufferSinkStructure() { return m_JSArrayBufferSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* ArrayBufferSink() { return m_JSArrayBufferSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue ArrayBufferSinkPrototype() { return m_JSArrayBufferSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::JSValue JSReadableArrayBufferSinkControllerPrototype() { return m_JSArrayBufferControllerPrototype.getInitializedOnMainThread(this); }

    JSC::Structure* HTTPResponseSinkStructure() { return m_JSHTTPResponseSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* HTTPResponseSink() { return m_JSHTTPResponseSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue HTTPResponseSinkPrototype() { return m_JSHTTPResponseSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::Structure* JSReadableHTTPResponseSinkController() { return m_JSHTTPResponseController.getInitializedOnMainThread(this); }

    JSC::Structure* HTTPSResponseSinkStructure() { return m_JSHTTPSResponseSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* HTTPSResponseSink() { return m_JSHTTPSResponseSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue HTTPSResponseSinkPrototype() { return m_JSHTTPSResponseSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::JSValue JSReadableHTTPSResponseSinkControllerPrototype() { return m_JSHTTPSResponseControllerPrototype.getInitializedOnMainThread(this); }

    JSC::JSMap* readableStreamNativeMap() { return m_lazyReadableStreamPrototypeMap.getInitializedOnMainThread(this); }
    JSC::JSMap* requireMap() { return m_requireMap.getInitializedOnMainThread(this); }
    JSC::JSObject* encodeIntoObjectPrototype() { return m_encodeIntoObjectPrototype.getInitializedOnMainThread(this); }

    JSC::JSObject* performanceObject() { return m_performanceObject.getInitializedOnMainThread(this); }

    JSC::JSObject* processObject()
    {
        return m_processObject.getInitializedOnMainThread(this);
    }

    JSC::JSObject* processEnvObject()
    {
        return m_processEnvObject.getInitializedOnMainThread(this);
    }

    void handleRejectedPromises();

    void* bunVM() { return m_bunVM; }
    bool isThreadLocalDefaultGlobalObject = false;

    mutable WriteBarrier<JSFunction> m_readableStreamToArrayBufferResolve;
    mutable WriteBarrier<JSFunction> m_readableStreamToText;
    mutable WriteBarrier<JSFunction> m_readableStreamToBlob;
    mutable WriteBarrier<JSFunction> m_readableStreamToJSON;
    mutable WriteBarrier<JSFunction> m_readableStreamToArrayBuffer;

    void trackFFIFunction(JSC::JSFunction* function)
    {
        this->m_ffiFunctions.append(JSC::Strong<JSC::JSFunction> { vm(), function });
    }

private:
    void addBuiltinGlobals(JSC::VM&);
    void finishCreation(JSC::VM&);
    friend void WebCore::JSBuiltinInternalFunctions::initialize(Zig::GlobalObject&);
    WebCore::JSBuiltinInternalFunctions m_builtinInternalFunctions;
    GlobalObject(JSC::VM& vm, JSC::Structure* structure);
    std::unique_ptr<WebCore::DOMConstructors> m_constructors;
    uint8_t m_worldIsNormal;
    JSDOMStructureMap m_structures WTF_GUARDED_BY_LOCK(m_gcLock);
    Lock m_gcLock;
    WebCore::ScriptExecutionContext* m_scriptExecutionContext;
    Ref<WebCore::DOMWrapperWorld> m_world;
    LazyClassStructure m_JSFFIFunctionStructure;
    LazyClassStructure m_NapiClassStructure;
    LazyClassStructure m_JSArrayBufferSinkClassStructure;
    LazyClassStructure m_JSHTTPResponseSinkClassStructure;
    LazyClassStructure m_JSHTTPSResponseSinkClassStructure;

    LazyProperty<JSGlobalObject, JSObject> m_JSArrayBufferControllerPrototype;
    LazyProperty<JSGlobalObject, JSObject> m_JSHTTPSResponseControllerPrototype;
    LazyProperty<JSGlobalObject, Structure> m_JSHTTPResponseController;
    LazyProperty<JSGlobalObject, JSObject> m_processObject;
    LazyProperty<JSGlobalObject, JSObject> m_processEnvObject;
    LazyProperty<JSGlobalObject, JSMap> m_lazyReadableStreamPrototypeMap;
    LazyProperty<JSGlobalObject, JSMap> m_requireMap;
    LazyProperty<JSGlobalObject, JSObject> m_performanceObject;

    LazyProperty<JSGlobalObject, JSObject> m_encodeIntoObjectPrototype;

    // LazyProperty<JSGlobalObject, WebCore::JSEventTarget> m_eventTarget;

    JSClassRef m_dotEnvClassRef;

    DOMGuardedObjectSet m_guardedObjects WTF_GUARDED_BY_LOCK(m_gcLock);
    void* m_bunVM;
    WTF::Vector<JSC::Strong<JSC::JSPromise>> m_aboutToBeNotifiedRejectedPromises;
    WTF::Vector<JSC::Strong<JSC::JSFunction>> m_ffiFunctions;
};

class JSMicrotaskCallbackDefaultGlobal final : public RefCounted<JSMicrotaskCallbackDefaultGlobal> {
public:
    static Ref<JSMicrotaskCallbackDefaultGlobal> create(Ref<JSC::Microtask>&& task)
    {
        return adoptRef(*new JSMicrotaskCallbackDefaultGlobal(WTFMove(task).leakRef()));
    }

    void call(JSC::JSGlobalObject* globalObject)
    {

        JSC::VM& vm = globalObject->vm();
        auto task = &m_task.leakRef();
        task->run(globalObject);

        delete this;
    }

private:
    JSMicrotaskCallbackDefaultGlobal(Ref<JSC::Microtask>&& task)
        : m_task { WTFMove(task) }
    {
    }

    Ref<JSC::Microtask> m_task;
};

class JSMicrotaskCallback final : public RefCounted<JSMicrotaskCallback> {
public:
    static Ref<JSMicrotaskCallback> create(JSC::JSGlobalObject& globalObject,
        Ref<JSC::Microtask>&& task)
    {
        return adoptRef(*new JSMicrotaskCallback(globalObject, WTFMove(task).leakRef()));
    }

    void call()
    {
        auto* globalObject = m_globalObject.get();
        if (UNLIKELY(!globalObject)) {
            delete this;
            return;
        }

        JSC::VM& vm = m_globalObject->vm();
        auto task = &m_task.leakRef();
        task->run(globalObject);

        delete this;
    }

private:
    JSMicrotaskCallback(JSC::JSGlobalObject& globalObject, Ref<JSC::Microtask>&& task)
        : m_globalObject { &globalObject }
        , m_task { WTFMove(task) }
    {
    }

    JSC::Weak<JSC::JSGlobalObject> m_globalObject;
    Ref<JSC::Microtask> m_task;
};

} // namespace Zig

#ifndef RENAMED_JSDOM_GLOBAL_OBJECT
#define RENAMED_JSDOM_GLOBAL_OBJECT
namespace WebCore {
using JSDOMGlobalObject = Zig::GlobalObject;
}
#endif

#endif
