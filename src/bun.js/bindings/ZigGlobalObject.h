// ** WARNING **
// This header is included in nearly every file.
// Be very cautious of sticking your #include in this file
// or adding anything into this file other than LazyClassStructure or LazyProperty
// ** WARNING **
// TODO: rename this to BunGlobalObject
#pragma once

#ifndef ZIG_GLOBAL_OBJECT
#define ZIG_GLOBAL_OBJECT

namespace JSC {
class Structure;
class Identifier;
class LazyClassStructure;
enum class JSPromiseRejectionOperation : unsigned;
} // namespace JSC

namespace WebCore {
class ScriptExecutionContext;
class DOMGuardedObject;
class EventLoopTask;
class DOMWrapperWorld;
class WorkerGlobalScope;
class SubtleCrypto;
class EventTarget;
class Performance;
} // namespace WebCore

namespace Bun {
class InternalModuleRegistry;
class NapiHandleScopeImpl;
} // namespace Bun

namespace v8 {
class GlobalInternals;
} // namespace v8

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/Structure.h>
#include "DOMConstructors.h"
#include "BunPlugin.h"
#include "JSMockFunction.h"
#include "InternalModuleRegistry.h"
#include "WebCoreJSBuiltins.h"
#include "headers-handwritten.h"
#include "BunCommonStrings.h"
#include "BunGlobalScope.h"

namespace WebCore {
class WorkerGlobalScope;
class SubtleCrypto;
class EventTarget;
}

extern "C" void Bun__reportError(JSC__JSGlobalObject*, JSC__JSValue);
extern "C" void Bun__reportUnhandledError(JSC__JSGlobalObject*, JSC::EncodedJSValue);

#if OS(WINDOWS)
#include <uv.h>
extern "C" uv_loop_t* Bun__ZigGlobalObject__uvLoop(void* /* BunVM */);
#endif

namespace Zig {

class JSCStackTrace;

using JSDOMStructureMap = HashMap<const JSC::ClassInfo*, JSC::WriteBarrier<JSC::Structure>>;
using DOMGuardedObjectSet = HashSet<WebCore::DOMGuardedObject*>;

#define ZIG_GLOBAL_OBJECT_DEFINED

class GlobalObject : public Bun::GlobalScope {
    using Base = Bun::GlobalScope;
    // Move this to the front for better cache locality.
    void* m_bunVM;

public:
    static const JSC::ClassInfo s_info;
    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    ~GlobalObject();
    static void destroy(JSC::JSCell*);

    static constexpr const JSC::ClassInfo* info() { return &s_info; }

    static JSC::Structure* createStructure(JSC::VM& vm)
    {
        return JSC::Structure::create(vm, nullptr, jsNull(), JSC::TypeInfo(JSC::GlobalObjectType, StructureFlags & ~IsImmutablePrototypeExoticObject), info());
    }

    // Make binding code generation easier.
    GlobalObject* globalObject() { return this; }

    GlobalObject(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable*);
    GlobalObject(JSC::VM& vm, JSC::Structure* structure, uint32_t, const JSC::GlobalObjectMethodTable*);

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
        GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, &s_globalObjectMethodTable);
        ptr->finishCreation(vm);
        return ptr;
    }

    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure, uint32_t scriptExecutionContextId)
    {
        GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, scriptExecutionContextId, &s_globalObjectMethodTable);
        ptr->finishCreation(vm);
        return ptr;
    }

    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable)
    {
        GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, methodTable);
        ptr->finishCreation(vm);
        return ptr;
    }

    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable* methodTable)
    {
        GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, scriptExecutionContextId, methodTable);
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
    template<typename Visitor> void visitAdditionalChildren(Visitor&);
    template<typename Visitor> static void visitOutputConstraints(JSCell*, Visitor&);

    bool worldIsNormal() const { return m_worldIsNormal; }
    static ptrdiff_t offsetOfWorldIsNormal() { return OBJECT_OFFSETOF(GlobalObject, m_worldIsNormal); }

    WebCore::ScriptExecutionContext* scriptExecutionContext();
    WebCore::ScriptExecutionContext* scriptExecutionContext() const;

    void queueTask(WebCore::EventLoopTask* task);
    void queueTaskOnTimeout(WebCore::EventLoopTask* task, int timeout);
    void queueTaskConcurrently(WebCore::EventLoopTask* task);

    JSDOMStructureMap& structures() WTF_REQUIRES_LOCK(m_gcLock) { return m_structures; }
    JSDOMStructureMap& structures(NoLockingNecessaryTag) WTF_IGNORES_THREAD_SAFETY_ANALYSIS
    {
        ASSERT(!vm().heap.mutatorShouldBeFenced());
        return m_structures;
    }

    WebCore::DOMConstructors& constructors() { return *m_constructors; }

    Lock& gcLock() WTF_RETURNS_LOCK(m_gcLock) { return m_gcLock; }

    void clearDOMGuardedObjects();

    static void createCallSitesFromFrames(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSCStackTrace& stackTrace, JSC::JSArray* callSites);
    void formatStackTrace(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites, JSValue prepareStack = JSC::jsUndefined());

    static void reportUncaughtExceptionAtEventLoop(JSGlobalObject*, JSC::Exception*);
    static JSGlobalObject* deriveShadowRealmGlobalObject(JSGlobalObject* globalObject);
    static JSC::JSInternalPromise* moduleLoaderImportModule(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSString* moduleNameValue, JSC::JSValue parameters, const JSC::SourceOrigin&);
    static JSC::Identifier moduleLoaderResolve(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue keyValue, JSC::JSValue referrerValue, JSC::JSValue);
    static JSC::JSInternalPromise* moduleLoaderFetch(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSValue, JSC::JSValue);
    static JSC::JSObject* moduleLoaderCreateImportMetaProperties(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSModuleRecord*, JSC::JSValue);
    static JSC::JSValue moduleLoaderEvaluate(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue);

    static ScriptExecutionStatus scriptExecutionStatus(JSGlobalObject*, JSObject*);
    static void promiseRejectionTracker(JSGlobalObject*, JSC::JSPromise*, JSC::JSPromiseRejectionOperation);
    void setConsole(void* console);
    WebCore::JSBuiltinInternalFunctions& builtinInternalFunctions() { return m_builtinInternalFunctions; }
    JSC::Structure* FFIFunctionStructure() const { return m_JSFFIFunctionStructure.getInitializedOnMainThread(this); }
    JSC::Structure* NapiClassStructure() const { return m_NapiClassStructure.getInitializedOnMainThread(this); }

    JSC::Structure* FileSinkStructure() const { return m_JSFileSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* FileSink() const { return m_JSFileSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue FileSinkPrototype() const { return m_JSFileSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::JSValue JSReadableFileSinkControllerPrototype() const { return m_JSFileSinkControllerPrototype.getInitializedOnMainThread(this); }

    JSC::Structure* JSBufferStructure() const { return m_JSBufferClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* JSBufferConstructor() const { return m_JSBufferClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue JSBufferPrototype() const { return m_JSBufferClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::Structure* JSBufferSubclassStructure() const { return m_JSBufferSubclassStructure.getInitializedOnMainThread(this); }

    JSC::Structure* JSCryptoKeyStructure() const { return m_JSCryptoKey.getInitializedOnMainThread(this); }

    JSC::Structure* ArrayBufferSinkStructure() const { return m_JSArrayBufferSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* ArrayBufferSink() { return m_JSArrayBufferSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue ArrayBufferSinkPrototype() const { return m_JSArrayBufferSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::JSValue JSReadableArrayBufferSinkControllerPrototype() const { return m_JSArrayBufferControllerPrototype.getInitializedOnMainThread(this); }

    JSC::Structure* HTTPResponseSinkStructure() const { return m_JSHTTPResponseSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* HTTPResponseSink() { return m_JSHTTPResponseSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue HTTPResponseSinkPrototype() const { return m_JSHTTPResponseSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::Structure* JSReadableHTTPResponseSinkController() { return m_JSHTTPResponseController.getInitializedOnMainThread(this); }

    JSC::Structure* HTTPSResponseSinkStructure() const { return m_JSHTTPSResponseSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* HTTPSResponseSink() { return m_JSHTTPSResponseSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue HTTPSResponseSinkPrototype() const { return m_JSHTTPSResponseSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::JSValue JSReadableHTTPSResponseSinkControllerPrototype() const { return m_JSHTTPSResponseControllerPrototype.getInitializedOnMainThread(this); }

    JSC::Structure* JSBufferListStructure() const { return m_JSBufferListClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* JSBufferList() { return m_JSBufferListClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue JSBufferListPrototype() const { return m_JSBufferListClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::Structure* JSStringDecoderStructure() const { return m_JSStringDecoderClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* JSStringDecoder() const { return m_JSStringDecoderClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue JSStringDecoderPrototype() const { return m_JSStringDecoderClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::Structure* NodeVMScriptStructure() const { return m_NodeVMScriptClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* NodeVMScript() const { return m_NodeVMScriptClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue NodeVMScriptPrototype() const { return m_NodeVMScriptClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::JSMap* readableStreamNativeMap() const { return m_lazyReadableStreamPrototypeMap.getInitializedOnMainThread(this); }
    JSC::JSMap* requireMap() const { return m_requireMap.getInitializedOnMainThread(this); }
    JSC::JSMap* esmRegistryMap() const { return m_esmRegistryMap.getInitializedOnMainThread(this); }

    JSC::Structure* callSiteStructure() const { return m_callSiteStructure.getInitializedOnMainThread(this); }

    JSC::JSObject* performanceObject() const { return m_performanceObject.getInitializedOnMainThread(this); }

    JSC::JSFunction* performMicrotaskFunction() const { return m_performMicrotaskFunction.getInitializedOnMainThread(this); }
    JSC::JSFunction* performMicrotaskVariadicFunction() const { return m_performMicrotaskVariadicFunction.getInitializedOnMainThread(this); }

    JSC::Structure* utilInspectOptionsStructure() const { return m_utilInspectOptionsStructure.getInitializedOnMainThread(this); }
    JSC::JSFunction* utilInspectFunction() const { return m_utilInspectFunction.getInitializedOnMainThread(this); }
    JSC::JSFunction* utilInspectStylizeColorFunction() const { return m_utilInspectStylizeColorFunction.getInitializedOnMainThread(this); }
    JSC::JSFunction* utilInspectStylizeNoColorFunction() const { return m_utilInspectStylizeNoColorFunction.getInitializedOnMainThread(this); }

    JSObject* requireFunctionUnbound() const { return m_requireFunctionUnbound.getInitializedOnMainThread(this); }
    JSObject* requireResolveFunctionUnbound() const { return m_requireResolveFunctionUnbound.getInitializedOnMainThread(this); }
    Bun::InternalModuleRegistry* internalModuleRegistry() const { return m_internalModuleRegistry.getInitializedOnMainThread(this); }

    JSObject* processBindingConstants() const { return m_processBindingConstants.getInitializedOnMainThread(this); }

    JSObject* lazyRequireCacheObject() const { return m_lazyRequireCacheObject.getInitializedOnMainThread(this); }

    Structure* NodeVMGlobalObjectStructure() const { return m_cachedNodeVMGlobalObjectStructure.getInitializedOnMainThread(this); }
    Structure* globalProxyStructure() const { return m_cachedGlobalProxyStructure.getInitializedOnMainThread(this); }
    JSObject* lazyTestModuleObject() const { return m_lazyTestModuleObject.getInitializedOnMainThread(this); }
    JSObject* lazyPreloadTestModuleObject() const { return m_lazyPreloadTestModuleObject.getInitializedOnMainThread(this); }
    Structure* CommonJSModuleObjectStructure() const { return m_commonJSModuleObjectStructure.getInitializedOnMainThread(this); }
    Structure* ImportMetaObjectStructure() const { return m_importMetaObjectStructure.getInitializedOnMainThread(this); }
    Structure* AsyncContextFrameStructure() const { return m_asyncBoundFunctionStructure.getInitializedOnMainThread(this); }

    Structure* JSSocketAddressStructure() const { return m_JSSocketAddressStructure.getInitializedOnMainThread(this); }

    JSWeakMap* vmModuleContextMap() const { return m_vmModuleContextMap.getInitializedOnMainThread(this); }

    Structure* NapiExternalStructure() const { return m_NapiExternalStructure.getInitializedOnMainThread(this); }
    Structure* NapiPrototypeStructure() const { return m_NapiPrototypeStructure.getInitializedOnMainThread(this); }
    Structure* NAPIFunctionStructure() const { return m_NAPIFunctionStructure.getInitializedOnMainThread(this); }
    Structure* NapiHandleScopeImplStructure() const { return m_NapiHandleScopeImplStructure.getInitializedOnMainThread(this); }

    Structure* JSSQLStatementStructure() const { return m_JSSQLStatementStructure.getInitializedOnMainThread(this); }

    v8::GlobalInternals* V8GlobalInternals() const { return m_V8GlobalInternals.getInitializedOnMainThread(this); }

    bool hasProcessObject() const { return m_processObject.isInitialized(); }

    RefPtr<WebCore::Performance> performance();

    JSC::JSObject* processObject() const { return m_processObject.getInitializedOnMainThread(this); }
    JSC::JSObject* processEnvObject() const { return m_processEnvObject.getInitializedOnMainThread(this); }
    JSC::JSObject* bunObject() const { return m_bunObject.getInitializedOnMainThread(this); }

    void drainMicrotasks();

    void handleRejectedPromises();
    ALWAYS_INLINE void initGeneratedLazyClasses();

    template<typename Visitor>
    void visitGeneratedLazyClasses(GlobalObject*, Visitor&);

    ALWAYS_INLINE void* bunVM() const { return m_bunVM; }
#if OS(WINDOWS)
    uv_loop_t* uvLoop() const
    {
        return Bun__ZigGlobalObject__uvLoop(m_bunVM);
    }
#endif
    bool isThreadLocalDefaultGlobalObject = false;

    JSObject* subtleCrypto() { return m_subtleCryptoObject.getInitializedOnMainThread(this); }

    JSC::EncodedJSValue assignToStream(JSValue stream, JSValue controller);

    WebCore::EventTarget& eventTarget();

    WebCore::ScriptExecutionContext* m_scriptExecutionContext;
    Bun::WorkerGlobalScope& globalEventScope;

    void resetOnEachMicrotaskTick();

    enum class PromiseFunctions : uint8_t {
        Bun__HTTPRequestContext__onReject,
        Bun__HTTPRequestContext__onRejectStream,
        Bun__HTTPRequestContext__onResolve,
        Bun__HTTPRequestContext__onResolveStream,
        Bun__HTTPRequestContextTLS__onReject,
        Bun__HTTPRequestContextTLS__onRejectStream,
        Bun__HTTPRequestContextTLS__onResolve,
        Bun__HTTPRequestContextTLS__onResolveStream,
        Bun__HTTPRequestContextDebug__onReject,
        Bun__HTTPRequestContextDebug__onRejectStream,
        Bun__HTTPRequestContextDebug__onResolve,
        Bun__HTTPRequestContextDebug__onResolveStream,
        Bun__HTTPRequestContextDebugTLS__onReject,
        Bun__HTTPRequestContextDebugTLS__onRejectStream,
        Bun__HTTPRequestContextDebugTLS__onResolve,
        Bun__HTTPRequestContextDebugTLS__onResolveStream,
        jsFunctionOnLoadObjectResultResolve,
        jsFunctionOnLoadObjectResultReject,
        Bun__TestScope__onReject,
        Bun__TestScope__onResolve,
        Bun__BodyValueBufferer__onRejectStream,
        Bun__BodyValueBufferer__onResolveStream,
        Bun__onResolveEntryPointResult,
        Bun__onRejectEntryPointResult,
    };
    static constexpr size_t promiseFunctionsSize = 24;

    static PromiseFunctions promiseHandlerID(SYSV_ABI EncodedJSValue (*handler)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1));

    JSFunction* thenable(SYSV_ABI EncodedJSValue (*handler)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1))
    {
        auto& barrier = this->m_thenables[static_cast<size_t>(GlobalObject::promiseHandlerID(handler))];
        if (JSFunction* func = barrier.get()) {
            return func;
        }

        JSFunction* func = JSC::JSFunction::create(vm(), this, 2,
            String(), handler, ImplementationVisibility::Public);

        barrier.set(vm(), this, func);
        return func;
    }

    bool asyncHooksNeedsCleanup = false;

    /**
     * WARNING: You must update visitChildrenImpl() if you add a new field.
     *
     * That informs the garbage collector that these fields exist. If you don't
     * do that, the garbage collector will not know about these fields and will
     * not trace them. This will lead to crashes and very strange behavior at runtime.
     *
     * For example, if you don't add the queueMicrotask functions to visitChildrenImpl(),
     * those callbacks will eventually never be called anymore. But it'll work the first time!
     */
    // TODO: these should use LazyProperty
    mutable WriteBarrier<JSFunction> m_assignToStream;
    mutable WriteBarrier<JSFunction> m_readableStreamToArrayBuffer;
    mutable WriteBarrier<JSFunction> m_readableStreamToArrayBufferResolve;
    mutable WriteBarrier<JSFunction> m_readableStreamToBytes;
    mutable WriteBarrier<JSFunction> m_readableStreamToBlob;
    mutable WriteBarrier<JSFunction> m_readableStreamToJSON;
    mutable WriteBarrier<JSFunction> m_readableStreamToText;
    mutable WriteBarrier<JSFunction> m_readableStreamToFormData;

    // This is set when doing `require('module')._resolveFilename = ...`
    // a hack used by Next.js to inject their versions of webpack and react
    mutable WriteBarrier<JSFunction> m_nodeModuleOverriddenResolveFilename;

    mutable WriteBarrier<Unknown> m_nextTickQueue;

    // mutable WriteBarrier<Unknown> m_JSBunDebuggerValue;
    mutable WriteBarrier<JSFunction> m_thenables[promiseFunctionsSize + 1];

    // Error.prepareStackTrace
    mutable WriteBarrier<JSC::Unknown> m_errorConstructorPrepareStackTraceValue;

    // When a napi module initializes on dlopen, we need to know what the value is
    mutable JSC::WriteBarrier<Unknown> m_pendingNapiModuleAndExports[2];

    // The handle scope where all new NAPI values will be created. You must not pass any napi_values
    // back to a NAPI function without putting them in the handle scope, as the NAPI function may
    // move them off the stack which will cause them to get collected if not in the handle scope.
    JSC::WriteBarrier<Bun::NapiHandleScopeImpl> m_currentNapiHandleScopeImpl;

    // The original, unmodified Error.prepareStackTrace.
    //
    // We set a default value for this to mimick Node.js behavior It is a
    // separate from the user-facing value so that we can tell if the user
    // really set it or if it's just the default value.
    //
    LazyProperty<JSGlobalObject, JSC::JSFunction> m_errorConstructorPrepareStackTraceInternalValue;

    LazyProperty<JSGlobalObject, JSObject> m_nodeErrorCache;
    JSObject* nodeErrorCache() const { return m_nodeErrorCache.getInitializedOnMainThread(this); }

    Structure* memoryFootprintStructure()
    {
        return m_memoryFootprintStructure.getInitializedOnMainThread(this);
    }

    JSObject* navigatorObject();
    JSFunction* nativeMicrotaskTrampoline() const { return m_nativeMicrotaskTrampoline.getInitializedOnMainThread(this); }

    String agentClusterID() const;
    static String defaultAgentClusterID();

    void trackFFIFunction(JSC::JSFunction* function)
    {
        this->m_ffiFunctions.append(JSC::Strong<JSC::JSFunction> { vm(), function });
    }
    bool untrackFFIFunction(JSC::JSFunction* function)
    {
        for (size_t i = 0; i < this->m_ffiFunctions.size(); ++i) {
            if (this->m_ffiFunctions[i].get() == function) {
                this->m_ffiFunctions[i].clear();
                this->m_ffiFunctions.remove(i);
                return true;
            }
        }
        return false;
    }

    BunPlugin::OnLoad onLoadPlugins {};
    BunPlugin::OnResolve onResolvePlugins {};

    // This increases the cache hit rate for JSC::VM's SourceProvider cache
    // It also avoids an extra allocation for the SourceProvider
    // The key is a pointer to the source code
    WTF::HashMap<uintptr_t, Ref<JSC::SourceProvider>> sourceProviderMap;
    size_t reloadCount = 0;

    void reload();

    JSC::Structure* pendingVirtualModuleResultStructure() { return m_pendingVirtualModuleResultStructure.get(this); }

    // We need to know if the napi module registered itself or we registered it.
    // To do that, we count the number of times we register a module.
    int napiModuleRegisterCallCount = 0;

    // NAPI instance data
    // This is not a correct implementation
    // Addon modules can override each other's data
    void* napiInstanceData = nullptr;
    void* napiInstanceDataFinalizer = nullptr;
    void* napiInstanceDataFinalizerHint = nullptr;

    Bun::JSMockModule mockModule;

    LazyProperty<JSGlobalObject, JSObject> m_processEnvObject;

    JSObject* cryptoObject() const { return m_cryptoObject.getInitializedOnMainThread(this); }
    JSObject* JSDOMFileConstructor() const { return m_JSDOMFileConstructor.getInitializedOnMainThread(this); }
    Bun::CommonStrings& commonStrings() { return m_commonStrings; }

#include "ZigGeneratedClasses+lazyStructureHeader.h"

private:
    void addBuiltinGlobals(JSC::VM&);

    void finishCreation(JSC::VM&);
    friend void WebCore::JSBuiltinInternalFunctions::initialize(Zig::GlobalObject&);
    WebCore::JSBuiltinInternalFunctions m_builtinInternalFunctions;
    std::unique_ptr<WebCore::DOMConstructors> m_constructors;
    uint8_t m_worldIsNormal;
    JSDOMStructureMap m_structures WTF_GUARDED_BY_LOCK(m_gcLock);
    Lock m_gcLock;
    Ref<WebCore::DOMWrapperWorld> m_world;
    Bun::CommonStrings m_commonStrings;
    RefPtr<WebCore::Performance> m_performance { nullptr };

    // JSC's hashtable code-generator tries to access these properties, so we make them public.
    // However, we'd like it better if they could be protected.
public:
    /**
     * WARNING: You must update visitChildrenImpl() if you add a new field.
     *
     * That informs the garbage collector that these fields exist. If you don't
     * do that, the garbage collector will not know about these fields and will
     * not trace them. This will lead to crashes and very strange behavior at runtime.
     *
     * For example, if you don't add the queueMicrotask functions to visitChildrenImpl(),
     * those callbacks will eventually never be called anymore. But it'll work the first time!
     */
    LazyClassStructure m_JSArrayBufferSinkClassStructure;
    LazyClassStructure m_JSBufferListClassStructure;
    LazyClassStructure m_JSFFIFunctionStructure;
    LazyClassStructure m_JSFileSinkClassStructure;
    LazyClassStructure m_JSHTTPResponseSinkClassStructure;
    LazyClassStructure m_JSHTTPSResponseSinkClassStructure;
    LazyClassStructure m_JSStringDecoderClassStructure;
    LazyClassStructure m_NapiClassStructure;
    LazyClassStructure m_callSiteStructure;
    LazyClassStructure m_JSBufferClassStructure;
    LazyClassStructure m_NodeVMScriptClassStructure;

    /**
     * WARNING: You must update visitChildrenImpl() if you add a new field.
     *
     * That informs the garbage collector that these fields exist. If you don't
     * do that, the garbage collector will not know about these fields and will
     * not trace them. This will lead to crashes and very strange behavior at runtime.
     *
     * For example, if you don't add the queueMicrotask functions to visitChildrenImpl(),
     * those callbacks will eventually never be called anymore. But it'll work the first time!
     */
    LazyProperty<JSGlobalObject, Structure> m_pendingVirtualModuleResultStructure;
    LazyProperty<JSGlobalObject, JSFunction> m_performMicrotaskFunction;
    LazyProperty<JSGlobalObject, JSFunction> m_nativeMicrotaskTrampoline;
    LazyProperty<JSGlobalObject, JSFunction> m_performMicrotaskVariadicFunction;
    LazyProperty<JSGlobalObject, JSFunction> m_utilInspectFunction;
    LazyProperty<JSGlobalObject, Structure> m_utilInspectOptionsStructure;
    LazyProperty<JSGlobalObject, JSFunction> m_utilInspectStylizeColorFunction;
    LazyProperty<JSGlobalObject, JSFunction> m_utilInspectStylizeNoColorFunction;
    LazyProperty<JSGlobalObject, JSMap> m_lazyReadableStreamPrototypeMap;
    LazyProperty<JSGlobalObject, JSMap> m_requireMap;
    LazyProperty<JSGlobalObject, JSMap> m_esmRegistryMap;
    LazyProperty<JSGlobalObject, JSObject> m_JSArrayBufferControllerPrototype;
    LazyProperty<JSGlobalObject, JSObject> m_JSHTTPSResponseControllerPrototype;
    LazyProperty<JSGlobalObject, JSObject> m_JSFileSinkControllerPrototype;
    LazyProperty<JSGlobalObject, JSObject> m_subtleCryptoObject;
    LazyProperty<JSGlobalObject, Structure> m_JSHTTPResponseController;
    LazyProperty<JSGlobalObject, Structure> m_JSBufferSubclassStructure;
    LazyProperty<JSGlobalObject, JSWeakMap> m_vmModuleContextMap;
    LazyProperty<JSGlobalObject, JSObject> m_lazyRequireCacheObject;
    LazyProperty<JSGlobalObject, JSObject> m_lazyTestModuleObject;
    LazyProperty<JSGlobalObject, JSObject> m_lazyPreloadTestModuleObject;
    LazyProperty<JSGlobalObject, JSObject> m_testMatcherUtilsObject;
    LazyProperty<JSGlobalObject, Structure> m_cachedNodeVMGlobalObjectStructure;
    LazyProperty<JSGlobalObject, Structure> m_cachedGlobalProxyStructure;
    LazyProperty<JSGlobalObject, Structure> m_commonJSModuleObjectStructure;
    LazyProperty<JSGlobalObject, Structure> m_JSSocketAddressStructure;
    LazyProperty<JSGlobalObject, Structure> m_memoryFootprintStructure;
    LazyProperty<JSGlobalObject, JSObject> m_requireFunctionUnbound;
    LazyProperty<JSGlobalObject, JSObject> m_requireResolveFunctionUnbound;
    LazyProperty<JSGlobalObject, Bun::InternalModuleRegistry> m_internalModuleRegistry;
    LazyProperty<JSGlobalObject, JSObject> m_processBindingConstants;
    LazyProperty<JSGlobalObject, Structure> m_importMetaObjectStructure;
    LazyProperty<JSGlobalObject, Structure> m_asyncBoundFunctionStructure;
    LazyProperty<JSGlobalObject, JSC::JSObject> m_JSDOMFileConstructor;
    LazyProperty<JSGlobalObject, Structure> m_JSCryptoKey;
    LazyProperty<JSGlobalObject, Structure> m_NapiExternalStructure;
    LazyProperty<JSGlobalObject, Structure> m_NapiPrototypeStructure;
    LazyProperty<JSGlobalObject, Structure> m_NAPIFunctionStructure;
    LazyProperty<JSGlobalObject, Structure> m_NapiHandleScopeImplStructure;

    LazyProperty<JSGlobalObject, Structure> m_JSSQLStatementStructure;
    LazyProperty<JSGlobalObject, v8::GlobalInternals> m_V8GlobalInternals;

    LazyProperty<JSGlobalObject, JSObject> m_bunObject;
    LazyProperty<JSGlobalObject, JSObject> m_cryptoObject;
    LazyProperty<JSGlobalObject, JSObject> m_navigatorObject;
    LazyProperty<JSGlobalObject, JSObject> m_performanceObject;
    LazyProperty<JSGlobalObject, JSObject> m_processObject;

private:
    DOMGuardedObjectSet m_guardedObjects WTF_GUARDED_BY_LOCK(m_gcLock);
    WebCore::SubtleCrypto* m_subtleCrypto = nullptr;

    WTF::Vector<JSC::Strong<JSC::JSPromise>> m_aboutToBeNotifiedRejectedPromises;
    WTF::Vector<JSC::Strong<JSC::JSFunction>> m_ffiFunctions;
};

class EvalGlobalObject : public GlobalObject {
public:
    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;
    static JSC::JSValue moduleLoaderEvaluate(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue);

    EvalGlobalObject(JSC::VM& vm, JSC::Structure* structure)
        : GlobalObject(vm, structure, &s_globalObjectMethodTable)
    {
    }
};

} // namespace Zig

// TODO: move this
namespace Bun {

String formatStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, const WTF::String& name, const WTF::String& message, OrdinalNumber& line, OrdinalNumber& column, WTF::String& sourceURL, Vector<JSC::StackFrame>& stackTrace, JSC::JSObject* errorInstance);

ALWAYS_INLINE void* vm(Zig::GlobalObject* globalObject)
{
    return globalObject->bunVM();
}

ALWAYS_INLINE void* vm(JSC::VM& vm)
{
    return WebCore::clientData(vm)->bunVM;
}

ALWAYS_INLINE void* vm(JSC::JSGlobalObject* lexicalGlobalObject)
{
    return WebCore::clientData(lexicalGlobalObject->vm())->bunVM;
}

}

#ifndef RENAMED_JSDOM_GLOBAL_OBJECT
#define RENAMED_JSDOM_GLOBAL_OBJECT
namespace WebCore {
using JSDOMGlobalObject = Zig::GlobalObject;
}
#endif

// Do not use this directly.
namespace ___private___ {
extern "C" Zig::GlobalObject* Bun__getDefaultGlobalObject();
inline Zig::GlobalObject* getDefaultGlobalObject()
{
    return Bun__getDefaultGlobalObject();
}
}

inline Zig::GlobalObject* defaultGlobalObject(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);
    if (!globalObject) {
        return ___private___::getDefaultGlobalObject();
    }
    return globalObject;
}
inline Zig::GlobalObject* defaultGlobalObject()
{
    return ___private___::getDefaultGlobalObject();
}

inline void* bunVM(JSC::JSGlobalObject* lexicalGlobalObject)
{
    if (auto* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject)) {
        return globalObject->bunVM();
    }

    return WebCore::clientData(lexicalGlobalObject->vm())->bunVM;
}

inline void* bunVM(Zig::GlobalObject* globalObject)
{
    return globalObject->bunVM();
}

#endif
