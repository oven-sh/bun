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
class JSNextTickQueue;
class Process;
} // namespace Bun

namespace v8 {
namespace shim {
class GlobalInternals;
} // namespace shim
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
#include "BunHttp2CommonStrings.h"
#include "BunGlobalScope.h"
#include <js_native_api.h>
#include <node_api.h>

namespace Bun {
class JSCommonJSExtensions;
class InternalModuleRegistry;
class JSMockModule;
class JSMockFunction;
}

namespace WebCore {
class WorkerGlobalScope;
class SubtleCrypto;
class EventTarget;
}

extern "C" void Bun__reportError(JSC::JSGlobalObject*, JSC::EncodedJSValue);
extern "C" void Bun__reportUnhandledError(JSC::JSGlobalObject*, JSC::EncodedJSValue);

extern "C" bool Bun__VirtualMachine__isShuttingDown(void* /* BunVM */);

#if OS(WINDOWS)
#include <uv.h>
extern "C" uv_loop_t* Bun__ZigGlobalObject__uvLoop(void* /* BunVM */);
#endif

namespace Zig {

class JSCStackTrace;

using JSDOMStructureMap = UncheckedKeyHashMap<const JSC::ClassInfo*, JSC::WriteBarrier<JSC::Structure>>;
using DOMGuardedObjectSet = UncheckedKeyHashSet<WebCore::DOMGuardedObject*>;

#define ZIG_GLOBAL_OBJECT_DEFINED

class GlobalObject : public Bun::GlobalScope {
    using Base = Bun::GlobalScope;

public:
    // Move this to the front for better cache locality.
    void* m_bunVM;

    bool isShuttingDown() const
    {
        return Bun__VirtualMachine__isShuttingDown(m_bunVM);
    }

    static const JSC::ClassInfo s_info;
    static const JSC::GlobalObjectMethodTable& globalObjectMethodTable();

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    ~GlobalObject();
    static void destroy(JSC::JSCell*);

    static constexpr const JSC::ClassInfo* info() { return &s_info; }

    static JSC::Structure* createStructure(JSC::VM& vm);

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

    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure);
    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure, uint32_t scriptExecutionContextId);
    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable);
    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable* methodTable);

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

    static void createCallSitesFromFrames(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSCStackTrace& stackTrace, MarkedArgumentBuffer& callSites);

    static void reportUncaughtExceptionAtEventLoop(JSGlobalObject*, JSC::Exception*);
    static JSGlobalObject* deriveShadowRealmGlobalObject(JSGlobalObject* globalObject);
    static JSC::JSInternalPromise* moduleLoaderImportModule(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSString* moduleNameValue, JSC::JSValue parameters, const JSC::SourceOrigin&);
    static JSC::Identifier moduleLoaderResolve(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue key, JSC::JSValue referrer, JSC::JSValue origin);
    static JSC::JSInternalPromise* moduleLoaderFetch(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue key, JSC::JSValue parameters, JSC::JSValue script);
    static JSC::JSObject* moduleLoaderCreateImportMetaProperties(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue key, JSC::JSModuleRecord*, JSC::JSValue val);
    static JSC::JSValue moduleLoaderEvaluate(JSGlobalObject*, JSC::JSModuleLoader*, JSValue key, JSValue moduleRecordValue, JSValue scriptFetcher, JSValue sentValue, JSValue resumeMode);

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

    JSC::Structure* KeyObjectStructure() const { return m_JSKeyObjectClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* KeyObject() const { return m_JSKeyObjectClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue KeyObjectPrototype() const { return m_JSKeyObjectClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::Structure* JSBufferStructure() const { return m_JSBufferClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* JSBufferConstructor() const { return m_JSBufferClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue JSBufferPrototype() const { return m_JSBufferClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::Structure* JSBufferSubclassStructure() const { return m_JSBufferSubclassStructure.getInitializedOnMainThread(this); }
    JSC::Structure* JSResizableOrGrowableSharedBufferSubclassStructure() const { return m_JSResizableOrGrowableSharedBufferSubclassStructure.getInitializedOnMainThread(this); }

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

    JSC::Structure* NetworkSinkStructure() const { return m_JSNetworkSinkClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* NetworkSink() { return m_JSNetworkSinkClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue NetworkSinkPrototype() const { return m_JSNetworkSinkClassStructure.prototypeInitializedOnMainThread(this); }
    JSC::JSValue JSReadableNetworkSinkControllerPrototype() const { return m_JSFetchTaskletChunkedRequestControllerPrototype.getInitializedOnMainThread(this); }

    JSC::Structure* JSBufferListStructure() const { return m_JSBufferListClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* JSBufferList() { return m_JSBufferListClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue JSBufferListPrototype() const { return m_JSBufferListClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::Structure* JSStringDecoderStructure() const { return m_JSStringDecoderClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* JSStringDecoder() const { return m_JSStringDecoderClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue JSStringDecoderPrototype() const { return m_JSStringDecoderClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::Structure* NodeVMScriptStructure() const { return m_NodeVMScriptClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* NodeVMScript() const { return m_NodeVMScriptClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue NodeVMScriptPrototype() const { return m_NodeVMScriptClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::Structure* NodeVMSourceTextModuleStructure() const { return m_NodeVMSourceTextModuleClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* NodeVMSourceTextModule() const { return m_NodeVMSourceTextModuleClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue NodeVMSourceTextModulePrototype() const { return m_NodeVMSourceTextModuleClassStructure.prototypeInitializedOnMainThread(this); }

    JSC::Structure* NodeVMSyntheticModuleStructure() const { return m_NodeVMSyntheticModuleClassStructure.getInitializedOnMainThread(this); }
    JSC::JSObject* NodeVMSyntheticModule() const { return m_NodeVMSyntheticModuleClassStructure.constructorInitializedOnMainThread(this); }
    JSC::JSValue NodeVMSyntheticModulePrototype() const { return m_NodeVMSyntheticModuleClassStructure.prototypeInitializedOnMainThread(this); }

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

    JSObject* processBindingBuffer() const { return m_processBindingBuffer.getInitializedOnMainThread(this); }
    JSObject* processBindingConstants() const { return m_processBindingConstants.getInitializedOnMainThread(this); }
    JSObject* processBindingFs() const { return m_processBindingFs.getInitializedOnMainThread(this); }

    JSObject* lazyRequireCacheObject() const { return m_lazyRequireCacheObject.getInitializedOnMainThread(this); }
    Bun::JSCommonJSExtensions* lazyRequireExtensionsObject() const { return m_lazyRequireExtensionsObject.getInitializedOnMainThread(this); }
    JSC::JSFunction* modulePrototypeUnderscoreCompileFunction() const { return m_modulePrototypeUnderscoreCompileFunction.getInitializedOnMainThread(this); }
    JSC::JSFunction* requireESMFromHijackedExtension() const { return m_commonJSRequireESMFromHijackedExtensionFunction.getInitializedOnMainThread(this); }

    Structure* NodeVMGlobalObjectStructure() const { return m_cachedNodeVMGlobalObjectStructure.getInitializedOnMainThread(this); }
    Structure* globalProxyStructure() const { return m_cachedGlobalProxyStructure.getInitializedOnMainThread(this); }
    JSObject* lazyTestModuleObject() const { return m_lazyTestModuleObject.getInitializedOnMainThread(this); }
    JSObject* lazyPreloadTestModuleObject() const { return m_lazyPreloadTestModuleObject.getInitializedOnMainThread(this); }
    Structure* CommonJSModuleObjectStructure() const { return m_commonJSModuleObjectStructure.getInitializedOnMainThread(this); }
    Structure* JSSocketAddressDTOStructure() const { return m_JSSocketAddressDTOStructure.getInitializedOnMainThread(this); }
    Structure* ImportMetaObjectStructure() const { return m_importMetaObjectStructure.getInitializedOnMainThread(this); }
    Structure* AsyncContextFrameStructure() const { return m_asyncBoundFunctionStructure.getInitializedOnMainThread(this); }

    JSWeakMap* vmModuleContextMap() const { return m_vmModuleContextMap.getInitializedOnMainThread(this); }

    Structure* NapiExternalStructure() const { return m_NapiExternalStructure.getInitializedOnMainThread(this); }
    Structure* NapiPrototypeStructure() const { return m_NapiPrototypeStructure.getInitializedOnMainThread(this); }
    Structure* NapiHandleScopeImplStructure() const { return m_NapiHandleScopeImplStructure.getInitializedOnMainThread(this); }
    Structure* NapiTypeTagStructure() const { return m_NapiTypeTagStructure.getInitializedOnMainThread(this); }

    Structure* JSSQLStatementStructure() const { return m_JSSQLStatementStructure.getInitializedOnMainThread(this); }

    v8::shim::GlobalInternals* V8GlobalInternals() const { return m_V8GlobalInternals.getInitializedOnMainThread(this); }

    bool hasProcessObject() const { return m_processObject.isInitialized(); }

    RefPtr<WebCore::Performance> performance();

    Bun::Process* processObject() const { return m_processObject.getInitializedOnMainThread(this); }
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
    Ref<Bun::WorkerGlobalScope> globalEventScope;

    void resetOnEachMicrotaskTick();

    enum class PromiseFunctions : uint8_t {
        BunServe__Plugins__onResolve,
        BunServe__Plugins__onReject,
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
        Bun__NodeHTTPRequest__onResolve,
        Bun__NodeHTTPRequest__onReject,
        Bun__FetchTasklet__onRejectRequestStream,
        Bun__FetchTasklet__onResolveRequestStream,
        Bun__S3UploadStream__onRejectRequestStream,
        Bun__S3UploadStream__onResolveRequestStream,
        Bun__FileStreamWrapper__onRejectRequestStream,
        Bun__FileStreamWrapper__onResolveRequestStream,
    };
    static constexpr size_t promiseFunctionsSize = 34;

    static PromiseFunctions promiseHandlerID(SYSV_ABI EncodedJSValue (*handler)(JSC::JSGlobalObject* arg0, JSC::CallFrame* arg1));

    JSFunction* thenable(SYSV_ABI EncodedJSValue (*handler)(JSC::JSGlobalObject* arg0, JSC::CallFrame* arg1))
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
    double INSPECT_MAX_BYTES = 50;
    bool isInsideErrorPrepareStackTraceCallback = false;

    template<typename T>
    using LazyPropertyOfGlobalObject = LazyProperty<JSGlobalObject, T>;

    using ThenablesArray = std::array<WriteBarrier<JSFunction>, promiseFunctionsSize + 1>;
    using NapiModuleAndExports = std::array<WriteBarrier<Unknown>, 2>;

    // Macro for doing something with each member of GlobalObject that has to be visited by the
    // garbage collector. To use, define a macro taking three arguments (visibility, type, and
    // name), pass it to FOR_EACH_GLOBALOBJECT_GC_MEMBER, and then undefine your macro:
    //
    // #define DO_SOMETHING_WITH_EACH_MEMBER(visibility, T, name) ...
    // FOR_EACH_GLOBALOBJECT_GC_MEMBER(DO_SOMETHING_WITH_EACH_MEMBER)
    // #undef DO_SOMETHING_WITH_EACH_MEMBER
    //
    // To add a new member, write e.g.
    //
    // /* comment */                            \
    // V(private, WriteBarrier<Thing>, m_thing) \
    //
    // If you're adding a member in the middle of existing ones, make sure to put a backslash at the
    // end of every line you add (even empty lines). This escapes the newline character, allowing
    // the macro to span multiple lines. For comments you will need to use /* */ instead of //;
    // otherwise, the backslash will be commented out. clang-format will automatically insert spaces
    // so that all the backslashes are vertically aligned.
    //
    // The most common types for these properties are `LazyPropertyOfGlobalObject<T>`,
    // `WriteBarrier<T>`, and `LazyClassStructure`. To use a new type, you'll need to:
    //
    // - Make sure the type can be written with no commas in its name. This is because a type with
    //   commas will count as two macro parameters instead of one. You can add a `using` declaration
    //   like above to create an alias for a complex template type without a comma.
    // - Make sure `visitGlobalObjectMember` in `ZigGlobalObject.cpp` can handle your type.
    //   Currently it has overloads to handle:
    //
    //     - any class with a `visit` method (this covers LazyProperty and LazyClassStructure)
    //     - `WriteBarrier` of any type
    //     - `std::unique_ptr` to any class with a `visit` method
    //     - `std::array` of any number of `WriteBarrier`s of any type
    //
    //   Most members should be WriteBarriers. If your class is a container of GC-owned objects but
    //   is not itself GC-owned, you can typically just add a `visit` method. This is what's done by
    //   JSMockModule, for instance. But if you've done something very exotic you might need to add
    //   a new overload of `visitGlobalObjectMember` so it understands your type.

#define FOR_EACH_GLOBALOBJECT_GC_MEMBER(V)                                                                   \
    /* TODO: these should use LazyProperty */                                                                \
    V(private, WriteBarrier<JSFunction>, m_assignToStream)                                                   \
    V(public, WriteBarrier<JSFunction>, m_readableStreamToArrayBuffer)                                       \
    V(public, WriteBarrier<JSFunction>, m_readableStreamToBytes)                                             \
    V(public, WriteBarrier<JSFunction>, m_readableStreamToBlob)                                              \
    V(public, WriteBarrier<JSFunction>, m_readableStreamToJSON)                                              \
    V(public, WriteBarrier<JSFunction>, m_readableStreamToText)                                              \
    V(public, WriteBarrier<JSFunction>, m_readableStreamToFormData)                                          \
                                                                                                             \
    V(public, LazyPropertyOfGlobalObject<JSCell>, m_moduleResolveFilenameFunction)                           \
    V(public, LazyPropertyOfGlobalObject<JSCell>, m_moduleRunMainFunction)                                   \
    V(public, LazyPropertyOfGlobalObject<JSFunction>, m_modulePrototypeUnderscoreCompileFunction)            \
    V(public, LazyPropertyOfGlobalObject<JSFunction>, m_commonJSRequireESMFromHijackedExtensionFunction)     \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_nodeModuleConstructor)                                 \
                                                                                                             \
    V(public, WriteBarrier<Bun::JSNextTickQueue>, m_nextTickQueue)                                           \
                                                                                                             \
    /* WriteBarrier<Unknown> m_JSBunDebuggerValue; */                                                        \
    V(private, ThenablesArray, m_thenables)                                                                  \
                                                                                                             \
    /* Error.prepareStackTrace */                                                                            \
    V(public, WriteBarrier<JSC::Unknown>, m_errorConstructorPrepareStackTraceValue)                          \
                                                                                                             \
    /* When a napi module initializes on dlopen, we need to know what the value is */                        \
    V(public, NapiModuleAndExports, m_pendingNapiModuleAndExports)                                           \
                                                                                                             \
    /* The handle scope where all new NAPI values will be created. You must not pass any napi_values */      \
    /* back to a NAPI function without putting them in the handle scope, as the NAPI function may */         \
    /* move them off the stack which will cause them to get collected if not in the handle scope. */         \
    V(public, JSC::WriteBarrier<Bun::NapiHandleScopeImpl>, m_currentNapiHandleScopeImpl)                     \
                                                                                                             \
    /* Supports getEnvironmentData() and setEnvironmentData(), and is cloned into newly-created */           \
    /* Workers. Initialized in createNodeWorkerThreadsBinding. */                                            \
    V(private, WriteBarrier<JSMap>, m_nodeWorkerEnvironmentData)                                             \
                                                                                                             \
    /* The original, unmodified Error.prepareStackTrace. */                                                  \
    /* */                                                                                                    \
    /* We set a default value for this to mimic Node.js behavior It is a */                                  \
    /* separate from the user-facing value so that we can tell if the user */                                \
    /* really set it or if it's just the default value. */                                                   \
    V(public, LazyPropertyOfGlobalObject<JSC::JSFunction>, m_errorConstructorPrepareStackTraceInternalValue) \
                                                                                                             \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_nodeErrorCache)                                       \
                                                                                                             \
    /* Used by napi_type_tag_object to associate a 128-bit type ID with JS objects. */                       \
    /* Should only use JSCell* keys and NapiTypeTag values. */                                               \
    V(private, LazyPropertyOfGlobalObject<JSC::JSWeakMap>, m_napiTypeTags)                                   \
                                                                                                             \
    V(public, Bun::JSMockModule, mockModule)                                                                 \
                                                                                                             \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_processEnvObject)                                      \
                                                                                                             \
    V(public, LazyPropertyOfGlobalObject<Structure>, m_JSS3FileStructure)                                    \
    V(public, LazyPropertyOfGlobalObject<Structure>, m_S3ErrorStructure)                                     \
                                                                                                             \
    V(public, JSC::LazyClassStructure, m_JSStatsClassStructure)                                              \
    V(public, JSC::LazyClassStructure, m_JSStatsBigIntClassStructure)                                        \
    V(public, JSC::LazyClassStructure, m_JSStatFSClassStructure)                                             \
    V(public, JSC::LazyClassStructure, m_JSStatFSBigIntClassStructure)                                       \
    V(public, JSC::LazyClassStructure, m_JSDirentClassStructure)                                             \
                                                                                                             \
    V(private, WebCore::JSBuiltinInternalFunctions, m_builtinInternalFunctions)                              \
    V(private, std::unique_ptr<WebCore::DOMConstructors>, m_constructors)                                    \
    V(private, Bun::CommonStrings, m_commonStrings)                                                          \
    V(private, Bun::Http2CommonStrings, m_http2CommonStrings)                                                \
                                                                                                             \
    /* JSC's hashtable code-generator tries to access these properties, so we make them public. */           \
    /* However, we'd like it better if they could be protected. */                                           \
    V(private, LazyClassStructure, m_JSArrayBufferSinkClassStructure)                                        \
    V(private, LazyClassStructure, m_JSBufferListClassStructure)                                             \
    V(private, LazyClassStructure, m_JSFFIFunctionStructure)                                                 \
    V(private, LazyClassStructure, m_JSFileSinkClassStructure)                                               \
    V(private, LazyClassStructure, m_JSHTTPResponseSinkClassStructure)                                       \
    V(private, LazyClassStructure, m_JSHTTPSResponseSinkClassStructure)                                      \
    V(private, LazyClassStructure, m_JSNetworkSinkClassStructure)                                            \
                                                                                                             \
    V(private, LazyClassStructure, m_JSStringDecoderClassStructure)                                          \
    V(private, LazyClassStructure, m_NapiClassStructure)                                                     \
    V(private, LazyClassStructure, m_callSiteStructure)                                                      \
    V(public, LazyClassStructure, m_JSBufferClassStructure)                                                  \
    V(public, LazyClassStructure, m_NodeVMScriptClassStructure)                                              \
    V(public, LazyClassStructure, m_NodeVMSourceTextModuleClassStructure)                                    \
    V(public, LazyClassStructure, m_NodeVMSyntheticModuleClassStructure)                                     \
    V(public, LazyClassStructure, m_JSX509CertificateClassStructure)                                         \
    V(public, LazyClassStructure, m_JSSignClassStructure)                                                    \
    V(public, LazyClassStructure, m_JSVerifyClassStructure)                                                  \
    V(public, LazyClassStructure, m_JSDiffieHellmanClassStructure)                                           \
    V(public, LazyClassStructure, m_JSDiffieHellmanGroupClassStructure)                                      \
    V(public, LazyClassStructure, m_JSHmacClassStructure)                                                    \
    V(public, LazyClassStructure, m_JSHashClassStructure)                                                    \
    V(public, LazyClassStructure, m_JSECDHClassStructure)                                                    \
    V(public, LazyClassStructure, m_JSCipherClassStructure)                                                  \
    V(public, LazyClassStructure, m_JSKeyObjectClassStructure)                                               \
    V(public, LazyClassStructure, m_JSSecretKeyObjectClassStructure)                                         \
    V(public, LazyClassStructure, m_JSPublicKeyObjectClassStructure)                                         \
    V(public, LazyClassStructure, m_JSPrivateKeyObjectClassStructure)                                        \
    V(public, LazyClassStructure, m_JSMIMEParamsClassStructure)                                              \
    V(public, LazyClassStructure, m_JSMIMETypeClassStructure)                                                \
    V(public, LazyClassStructure, m_JSNodePerformanceHooksHistogramClassStructure)                           \
                                                                                                             \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_pendingVirtualModuleResultStructure)                 \
    V(private, LazyPropertyOfGlobalObject<JSFunction>, m_performMicrotaskFunction)                           \
    V(private, LazyPropertyOfGlobalObject<JSFunction>, m_nativeMicrotaskTrampoline)                          \
    V(private, LazyPropertyOfGlobalObject<JSFunction>, m_performMicrotaskVariadicFunction)                   \
    V(private, LazyPropertyOfGlobalObject<JSFunction>, m_utilInspectFunction)                                \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_utilInspectOptionsStructure)                         \
    V(private, LazyPropertyOfGlobalObject<JSFunction>, m_utilInspectStylizeColorFunction)                    \
    V(private, LazyPropertyOfGlobalObject<JSFunction>, m_utilInspectStylizeNoColorFunction)                  \
    V(private, LazyPropertyOfGlobalObject<JSMap>, m_lazyReadableStreamPrototypeMap)                          \
    V(private, LazyPropertyOfGlobalObject<JSMap>, m_requireMap)                                              \
    V(private, LazyPropertyOfGlobalObject<JSMap>, m_esmRegistryMap)                                          \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_JSArrayBufferControllerPrototype)                     \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_JSHTTPSResponseControllerPrototype)                   \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_JSFetchTaskletChunkedRequestControllerPrototype)      \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_JSFileSinkControllerPrototype)                        \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_subtleCryptoObject)                                   \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_JSHTTPResponseController)                            \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_JSBufferSubclassStructure)                           \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_JSResizableOrGrowableSharedBufferSubclassStructure)  \
    V(private, LazyPropertyOfGlobalObject<JSWeakMap>, m_vmModuleContextMap)                                  \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_lazyRequireCacheObject)                                \
    V(public, LazyPropertyOfGlobalObject<Bun::JSCommonJSExtensions>, m_lazyRequireExtensionsObject)          \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_lazyTestModuleObject)                                 \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_lazyPreloadTestModuleObject)                          \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_testMatcherUtilsObject)                                \
    V(public, LazyPropertyOfGlobalObject<Structure>, m_cachedNodeVMGlobalObjectStructure)                    \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_cachedGlobalProxyStructure)                          \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_commonJSModuleObjectStructure)                       \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_JSSocketAddressDTOStructure)                         \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_memoryFootprintStructure)                            \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_requireFunctionUnbound)                               \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_requireResolveFunctionUnbound)                        \
    V(private, LazyPropertyOfGlobalObject<Bun::InternalModuleRegistry>, m_internalModuleRegistry)            \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_processBindingBuffer)                                 \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_processBindingConstants)                              \
    V(private, LazyPropertyOfGlobalObject<JSObject>, m_processBindingFs)                                     \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_importMetaObjectStructure)                           \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_asyncBoundFunctionStructure)                         \
    V(public, LazyPropertyOfGlobalObject<JSC::JSObject>, m_JSDOMFileConstructor)                             \
    V(public, LazyPropertyOfGlobalObject<JSC::JSObject>, m_JSMIMEParamsConstructor)                          \
    V(public, LazyPropertyOfGlobalObject<JSC::JSObject>, m_JSMIMETypeConstructor)                            \
                                                                                                             \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_JSCryptoKey)                                         \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_NapiExternalStructure)                               \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_NapiPrototypeStructure)                              \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_NapiHandleScopeImplStructure)                        \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_NapiTypeTagStructure)                                \
                                                                                                             \
    V(private, LazyPropertyOfGlobalObject<Structure>, m_JSSQLStatementStructure)                             \
    V(private, LazyPropertyOfGlobalObject<v8::shim::GlobalInternals>, m_V8GlobalInternals)                   \
                                                                                                             \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_bunObject)                                             \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_cryptoObject)                                          \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_navigatorObject)                                       \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_performanceObject)                                     \
    V(public, LazyPropertyOfGlobalObject<Bun::Process>, m_processObject)                                     \
    V(public, LazyPropertyOfGlobalObject<CustomGetterSetter>, m_lazyStackCustomGetterSetter)                 \
    V(public, LazyPropertyOfGlobalObject<Structure>, m_ServerRouteListStructure)                             \
    V(public, LazyPropertyOfGlobalObject<Structure>, m_JSBunRequestStructure)                                \
    V(public, LazyPropertyOfGlobalObject<JSObject>, m_JSBunRequestParamsPrototype)                           \
                                                                                                             \
    V(public, LazyPropertyOfGlobalObject<Structure>, m_JSNodeHTTPServerSocketStructure)                      \
    V(public, LazyPropertyOfGlobalObject<JSFloat64Array>, m_statValues)                                      \
    V(public, LazyPropertyOfGlobalObject<JSBigInt64Array>, m_bigintStatValues)                               \
    V(public, LazyPropertyOfGlobalObject<JSFloat64Array>, m_statFsValues)                                    \
    V(public, LazyPropertyOfGlobalObject<JSBigInt64Array>, m_bigintStatFsValues)

#define DECLARE_GLOBALOBJECT_GC_MEMBER(visibility, T, name) \
    visibility:                                             \
    T name;

    FOR_EACH_GLOBALOBJECT_GC_MEMBER(DECLARE_GLOBALOBJECT_GC_MEMBER)

#undef DECLARE_GLOBALOBJECT_GC_MEMBER

    // Ensure that everything below here has a consistent visibility instead of taking the
    // visibility of the last thing declared with FOR_EACH_GLOBALOBJECT_GC_MEMBER
public:
    WTF::String m_moduleWrapperStart;
    WTF::String m_moduleWrapperEnd;

    // This is the result of dlopen()ing a napi module.
    // We will add it to the resulting napi value.
    void* m_pendingNapiModuleDlopenHandle = nullptr;

    JSObject* nodeErrorCache() const { return m_nodeErrorCache.getInitializedOnMainThread(this); }

    Structure* memoryFootprintStructure()
    {
        return m_memoryFootprintStructure.getInitializedOnMainThread(this);
    }

    JSObject* navigatorObject();
    JSFunction* nativeMicrotaskTrampoline() const { return m_nativeMicrotaskTrampoline.getInitializedOnMainThread(this); }

    String agentClusterID() const;
    static String defaultAgentClusterID();

    void trackFFIFunction(JSC::JSFunction* function);
    bool untrackFFIFunction(JSC::JSFunction* function);

    BunPlugin::OnLoad onLoadPlugins {};
    BunPlugin::OnResolve onResolvePlugins {};

    // This increases the cache hit rate for JSC::VM's SourceProvider cache
    // It also avoids an extra allocation for the SourceProvider
    // The key is a pointer to the source code
    WTF::UncheckedKeyHashMap<uintptr_t, Ref<JSC::SourceProvider>> sourceProviderMap;
    size_t reloadCount = 0;

    void reload();

    JSC::Structure* pendingVirtualModuleResultStructure() { return m_pendingVirtualModuleResultStructure.get(this); }

    // We need to know if the napi module registered itself or we registered it.
    // To do that, we count the number of times we register a module.
    int napiModuleRegisterCallCount = 0;

    JSC::JSWeakMap* napiTypeTags() const { return m_napiTypeTags.getInitializedOnMainThread(this); }

    JSObject* cryptoObject() const { return m_cryptoObject.getInitializedOnMainThread(this); }
    JSObject* JSDOMFileConstructor() const { return m_JSDOMFileConstructor.getInitializedOnMainThread(this); }

    JSMap* nodeWorkerEnvironmentData() { return m_nodeWorkerEnvironmentData.get(); }
    void setNodeWorkerEnvironmentData(JSMap* data);

    Bun::CommonStrings& commonStrings() { return m_commonStrings; }
    Bun::Http2CommonStrings& http2CommonStrings() { return m_http2CommonStrings; }
#include "ZigGeneratedClasses+lazyStructureHeader.h"

    void finishCreation(JSC::VM&);

private:
    void addBuiltinGlobals(JSC::VM&);

    friend void WebCore::JSBuiltinInternalFunctions::initialize(Zig::GlobalObject&);
    uint8_t m_worldIsNormal;
    JSDOMStructureMap m_structures WTF_GUARDED_BY_LOCK(m_gcLock);
    Lock m_gcLock;
    Ref<WebCore::DOMWrapperWorld> m_world;
    RefPtr<WebCore::Performance> m_performance { nullptr };

public:
    // De-optimization once `require("module")._resolveFilename` is written to
    bool hasOverriddenModuleResolveFilenameFunction = false;
    // De-optimization once `require("module").wrapper` or `require("module").wrap` is written to
    bool hasOverriddenModuleWrapper = false;
    // De-optimization once `require("module").runMain` is written to
    bool hasOverriddenModuleRunMain = false;

    WTF::Vector<std::unique_ptr<napi_env__>> m_napiEnvs;
    napi_env makeNapiEnv(const napi_module&);
    napi_env makeNapiEnvForFFI();
    bool hasNapiFinalizers() const;

private:
    DOMGuardedObjectSet m_guardedObjects WTF_GUARDED_BY_LOCK(m_gcLock);
    WebCore::SubtleCrypto* m_subtleCrypto = nullptr;

    WTF::Vector<JSC::Strong<JSC::JSPromise>> m_aboutToBeNotifiedRejectedPromises;
    WTF::Vector<JSC::Strong<JSC::JSFunction>> m_ffiFunctions;
};

class EvalGlobalObject : public GlobalObject {
public:
    static const JSC::GlobalObjectMethodTable& globalObjectMethodTable();
    static JSC::JSValue moduleLoaderEvaluate(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue);

    EvalGlobalObject(JSC::VM& vm, JSC::Structure* structure)
        : GlobalObject(vm, structure, &globalObjectMethodTable())
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

JSC_DECLARE_HOST_FUNCTION(jsFunctionNotImplemented);
JSC_DECLARE_HOST_FUNCTION(jsFunctionCreateFunctionThatMasqueradesAsUndefined);

#endif
