#include "root.h"
#include "ZigGlobalObject.h"

#include "helpers.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/CallFrameInlines.h"
#include "JavaScriptCore/ClassInfo.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/CodeCache.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/HashMapImpl.h"
#include "JavaScriptCore/HashMapImplInlines.h"
#include "JavaScriptCore/Heap.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/InitializeThreading.h"
#include "JavaScriptCore/IteratorOperations.h"
#include "JavaScriptCore/JSArray.h"

#include "JavaScriptCore/JSCallbackConstructor.h"
#include "JavaScriptCore/JSCallbackObject.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSClassRef.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "ZigConsoleClient.h"
// #include "JavaScriptCore/JSContextInternal.h"
#include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/DeferredWorkTimer.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSSet.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSValueInternal.h"
#include "JavaScriptCore/JSVirtualMachineInternal.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/OptionsList.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/VMEntryScope.h"
#include "JavaScriptCore/WasmFaultSignalHandler.h"
#include "wtf/Gigacage.h"
#include "wtf/URL.h"
#include "wtf/text/ExternalStringImpl.h"
#include "wtf/text/StringCommon.h"
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"

#include "wtf/text/Base64.h"
// #include "JavaScriptCore/CachedType.h"
#include "JavaScriptCore/JSCallbackObject.h"
#include "JavaScriptCore/JSClassRef.h"
#include "JavaScriptCore/CallData.h"
#include "GCDefferalContext.h"

#include "BunClientData.h"

#include "ZigSourceProvider.h"

#include "JSDOMURL.h"
#include "JSURLSearchParams.h"
#include "JSDOMException.h"
#include "JSEventTarget.h"
#include "JSEventEmitter.h"
#include "EventTargetConcrete.h"
#include "JSAbortSignal.h"
#include "JSCustomEvent.h"
#include "JSAbortController.h"
#include "JSEvent.h"
#include "JSErrorEvent.h"
#include "JSCloseEvent.h"
#include "JSFetchHeaders.h"
#include "JSStringDecoder.h"
#include "JSReadableState.h"
#include "JSReadableHelper.h"
#include "Process.h"

#include "WebCoreJSBuiltinInternals.h"
#include "JSBuffer.h"
#include "JSBufferList.h"
#include "JSFFIFunction.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "napi.h"
#include "JSSQLStatement.h"
#include "ReadableStreamBuiltins.h"
#include "BunJSCModule.h"
#include "ModuleLoader.h"

#include "ZigGeneratedClasses.h"

#include "BunPlugin.h"

#if ENABLE(REMOTE_INSPECTOR)
#include "JavaScriptCore/RemoteInspectorServer.h"
#endif

using JSGlobalObject
    = JSC::JSGlobalObject;
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
#include <dlfcn.h>

#include "IDLTypes.h"

#include "JSAbortAlgorithm.h"
#include "JSDOMAttribute.h"
#include "JSByteLengthQueuingStrategy.h"
#include "JSCountQueuingStrategy.h"
#include "JSReadableByteStreamController.h"
#include "JSReadableStream.h"
#include "JSReadableStreamBYOBReader.h"
#include "JSReadableStreamBYOBRequest.h"
#include "JSReadableStreamDefaultController.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultController.h"
#include "JSWritableStreamDefaultWriter.h"
#include "JavaScriptCore/BuiltinNames.h"
#include "JSTextEncoder.h"
#include "StructuredClone.h"
#include "JSWebSocket.h"
#include "JSMessageEvent.h"

#include "ReadableStream.h"
#include "JSSink.h"
#include "ImportMetaObject.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>

#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSSubtleCrypto.h"

constexpr size_t DEFAULT_ERROR_STACK_TRACE_LIMIT = 10;

#ifdef __APPLE__
#include <sys/sysctl.h>
#else
// for sysconf
#include <unistd.h>
#endif

// #include <iostream>
static bool has_loaded_jsc = false;

extern "C" void JSCInitialize()
{
    if (has_loaded_jsc)
        return;
    has_loaded_jsc = true;
    JSC::Config::enableRestrictedOptions();

    std::set_terminate([]() { Zig__GlobalObject__onCrash(); });
    WTF::initializeMainThread();
    JSC::initialize();
    {
        JSC::Options::AllowUnfinalizedAccessScope scope;

        JSC::Options::useConcurrentJIT() = true;
        JSC::Options::useSigillCrashAnalyzer() = true;
        JSC::Options::useWebAssembly() = true;
        JSC::Options::useSourceProviderCache() = true;
        // JSC::Options::useUnlinkedCodeBlockJettisoning() = false;
        JSC::Options::exposeInternalModuleLoader() = true;
        JSC::Options::useSharedArrayBuffer() = true;
        JSC::Options::useJIT() = true;
        JSC::Options::useBBQJIT() = true;
        JSC::Options::useJITCage() = false;
        JSC::Options::useShadowRealm() = true;
        JSC::Options::useResizableArrayBuffer() = true;
        JSC::Options::showPrivateScriptsInStackTraces() = true;
        JSC::Options::assertOptionsAreCoherent();
    }
}

extern "C" void* Bun__getVM();

extern "C" JSC__JSGlobalObject* Zig__GlobalObject__create(JSClassRef* globalObjectClass, int count,
    void* console_client)
{
    auto heapSize = JSC::HeapType::Large;

    JSC::VM& vm = JSC::VM::create(heapSize).leakRef();

    // This must happen before JSVMClientData::create
    vm.heap.acquireAccess();

    WebCore::JSVMClientData::create(&vm);

    JSC::JSLockHolder locker(vm);
    Zig::GlobalObject* globalObject = Zig::GlobalObject::create(vm, Zig::GlobalObject::createStructure(vm, JSC::JSGlobalObject::create(vm, JSC::JSGlobalObject::createStructure(vm, JSC::jsNull())), JSC::jsNull()));
    globalObject->setConsole(globalObject);
    globalObject->isThreadLocalDefaultGlobalObject = true;
    if (count > 0) {
        globalObject->installAPIGlobals(globalObjectClass, count, vm);
    }

    JSC::gcProtect(globalObject);

    vm.ref();
    return globalObject;
}

JSC_DEFINE_HOST_FUNCTION(functionFulfillModuleSync,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{

    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue key = callFrame->argument(0);

    auto moduleKey = key.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(JSC::jsUndefined()));

    if (moduleKey.endsWith(".node"_s)) {
        throwException(globalObject, scope, createTypeError(globalObject, "To load Node-API modules, use require() or process.dlopen instead of importSync."_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto specifier = Zig::toZigString(moduleKey);
    ErrorableResolvedSource res;
    res.success = false;
    res.result.err.code = 0;
    res.result.err.ptr = nullptr;

    JSValue result = Bun::fetchSourceCodeSync(
        reinterpret_cast<Zig::GlobalObject*>(globalObject),
        &res,
        &specifier,
        &specifier);

    if (result.isUndefined() || !result) {
        return JSValue::encode(result);
    }

    globalObject->moduleLoader()->provideFetch(globalObject, key, jsCast<JSC::JSSourceCode*>(result)->sourceCode());
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsUndefined()));
}

extern "C" void* Zig__GlobalObject__getModuleRegistryMap(JSC__JSGlobalObject* arg0)
{
    if (JSC::JSObject* loader = JSC::jsDynamicCast<JSC::JSObject*>(arg0->moduleLoader())) {
        JSC::JSMap* map = JSC::jsDynamicCast<JSC::JSMap*>(
            loader->getDirect(arg0->vm(), JSC::Identifier::fromString(arg0->vm(), "registry"_s)));

        JSC::JSMap* cloned = map->clone(arg0, arg0->vm(), arg0->mapStructure());
        JSC::gcProtect(cloned);

        return cloned;
    }

    return nullptr;
}

extern "C" bool Zig__GlobalObject__resetModuleRegistryMap(JSC__JSGlobalObject* globalObject,
    void* map_ptr)
{
    if (map_ptr == nullptr)
        return false;
    JSC::JSMap* map = reinterpret_cast<JSC::JSMap*>(map_ptr);
    JSC::VM& vm = globalObject->vm();
    if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(globalObject->moduleLoader())) {
        auto identifier = JSC::Identifier::fromString(globalObject->vm(), "registry"_s);

        if (JSC::JSMap* oldMap = JSC::jsDynamicCast<JSC::JSMap*>(
                obj->getDirect(globalObject->vm(), identifier))) {

            vm.finalizeSynchronousJSExecution();

            obj->putDirect(globalObject->vm(), identifier,
                map->clone(globalObject, globalObject->vm(), globalObject->mapStructure()));

            // vm.deleteAllLinkedCode(JSC::DeleteAllCodeEffort::DeleteAllCodeIfNotCollecting);
            // JSC::Heap::PreventCollectionScope(vm.heap);
            oldMap->clear(vm);
            JSC::gcUnprotect(oldMap);
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

            // globalObject->vm().heap.deleteAllUnlinkedCodeBlocks(
            //   JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
        }
    }
    // map
    // }
    return true;
}

#define GENERATED_CONSTRUCTOR_GETTER(ConstructorName)                                         \
    JSC_DECLARE_CUSTOM_GETTER(ConstructorName##_getter);                                      \
    JSC_DEFINE_CUSTOM_GETTER(ConstructorName##_getter,                                        \
        (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,            \
            JSC::PropertyName))                                                               \
    {                                                                                         \
        Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject); \
        if (JSValue override = thisObject->m_##ConstructorName##SetterValue.get()) {          \
            return JSC::JSValue::encode(override);                                            \
        }                                                                                     \
        return JSC::JSValue::encode(                                                          \
            thisObject->ConstructorName##Constructor());                                      \
    }

#define GENERATED_CONSTRUCTOR_SETTER(ConstructorName)                                                           \
    JSC_DECLARE_CUSTOM_SETTER(ConstructorName##_setter);                                                        \
    JSC_DEFINE_CUSTOM_SETTER(ConstructorName##_setter,                                                          \
        (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,                              \
            EncodedJSValue value, JSC::PropertyName))                                                           \
    {                                                                                                           \
        Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);                   \
        thisObject->m_##ConstructorName##SetterValue.set(thisObject->vm(), thisObject, JSValue::decode(value)); \
        return true;                                                                                            \
    }

#define WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ConstructorName)                                       \
    JSC_DECLARE_CUSTOM_GETTER(ConstructorName##_getter);                                            \
    JSC_DEFINE_CUSTOM_GETTER(ConstructorName##_getter,                                              \
        (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,                  \
            JSC::PropertyName))                                                                     \
    {                                                                                               \
        Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);       \
        if (JSValue override = thisObject->m_##ConstructorName##SetterValue.get()) {                \
            return JSC::JSValue::encode(override);                                                  \
        }                                                                                           \
        return JSC::JSValue::encode(                                                                \
            WebCore::ConstructorName::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject)); \
    }

#define WEBCORE_GENERATED_CONSTRUCTOR_SETTER(ConstructorName)                                                   \
    JSC_DECLARE_CUSTOM_SETTER(ConstructorName##_setter);                                                        \
    JSC_DEFINE_CUSTOM_SETTER(ConstructorName##_setter,                                                          \
        (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,                              \
            EncodedJSValue value, JSC::PropertyName))                                                           \
    {                                                                                                           \
        Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);                   \
        thisObject->m_##ConstructorName##SetterValue.set(thisObject->vm(), thisObject, JSValue::decode(value)); \
        return true;                                                                                            \
    }

#define PUT_WEBCORE_GENERATED_CONSTRUCTOR(name, ConstructorName) \
    putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, name)), JSC::CustomGetterSetter::create(vm, ConstructorName##_getter, ConstructorName##_setter), 0)

namespace Zig {

using namespace WebCore;

const JSC::ClassInfo GlobalObject::s_info = { "GlobalObject"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(GlobalObject) };

extern "C" JSClassRef* Zig__getAPIGlobals(size_t* count);
extern "C" const JSC__JSValue* Zig__getAPIConstructors(size_t* count, JSC__JSGlobalObject*);

static JSGlobalObject* deriveShadowRealmGlobalObject(JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    Zig::GlobalObject* shadow = Zig::GlobalObject::create(vm, Zig::GlobalObject::createStructure(vm, JSC::JSGlobalObject::create(vm, JSC::JSGlobalObject::createStructure(vm, JSC::jsNull())), JSC::jsNull()));
    shadow->setConsole(shadow);
    size_t count = 0;
    JSClassRef* globalObjectClass = Zig__getAPIGlobals(&count);

    shadow->setConsole(shadow);
    if (count > 0) {
        shadow->installAPIGlobals(globalObjectClass, count, vm);
    }

    return shadow;
}

extern "C" JSC__JSValue JSC__JSValue__makeWithNameAndPrototype(JSC__JSGlobalObject* globalObject, void* arg1, void* arg2, const ZigString* visibleInterfaceName)
{
    auto& vm = globalObject->vm();
    JSClassRef jsClass = reinterpret_cast<JSClassRef>(arg1);
    JSClassRef protoClass = reinterpret_cast<JSClassRef>(arg2);
    JSObjectRef objectRef = JSObjectMakeConstructor(reinterpret_cast<JSContextRef>(globalObject), protoClass, jsClass->callAsConstructor);
    JSObjectRef wrappedRef = JSObjectMake(reinterpret_cast<JSContextRef>(globalObject), jsClass, nullptr);
    JSC::JSObject* object = JSC::JSValue::decode(reinterpret_cast<JSC__JSValue>(objectRef)).getObject();
    JSC::JSObject* wrapped = JSC::JSValue::decode(reinterpret_cast<JSC__JSValue>(wrappedRef)).getObject();
    object->setPrototypeDirect(vm, wrapped);
    JSString* nameString = JSC::jsNontrivialString(vm, Zig::toString(*visibleInterfaceName));
    object->putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    object->putDirect(vm, vm.propertyNames->toStringTagSymbol,
        nameString, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);

    return JSC::JSValue::encode(JSC::JSValue(object));
}

extern "C" EncodedJSValue Bun__escapeHTML8(JSGlobalObject* globalObject, EncodedJSValue input, const LChar* ptr, size_t length);
extern "C" EncodedJSValue Bun__escapeHTML16(JSGlobalObject* globalObject, EncodedJSValue input, const UChar* ptr, size_t length);

const JSC::GlobalObjectMethodTable GlobalObject::s_globalObjectMethodTable = {
    &supportsRichSourceInfo,
    &shouldInterruptScript,
    &javaScriptRuntimeFlags,
    // &queueMicrotaskToEventLoop, // queueTaskToEventLoop
    nullptr,
    nullptr, // &shouldInterruptScriptBeforeTimeout,
    &moduleLoaderImportModule, // moduleLoaderImportModule
    &moduleLoaderResolve, // moduleLoaderResolve
    &moduleLoaderFetch, // moduleLoaderFetch
    &moduleLoaderCreateImportMetaProperties, // moduleLoaderCreateImportMetaProperties
    &moduleLoaderEvaluate, // moduleLoaderEvaluate
    &promiseRejectionTracker, // promiseRejectionTracker
    &reportUncaughtExceptionAtEventLoop,
    &currentScriptExecutionOwner,
    &scriptExecutionStatus,
    nullptr, // defaultLanguage
    nullptr, // compileStreaming
    nullptr, // instantiateStreaming
    nullptr,
    &Zig::deriveShadowRealmGlobalObject
};

GlobalObject::GlobalObject(JSC::VM& vm, JSC::Structure* structure)
    : JSC::JSGlobalObject(vm, structure, &s_globalObjectMethodTable)
    , m_bunVM(Bun__getVM())
    , m_constructors(makeUnique<WebCore::DOMConstructors>())
    , m_world(WebCore::DOMWrapperWorld::create(vm, WebCore::DOMWrapperWorld::Type::Normal))
    , m_worldIsNormal(true)
    , m_builtinInternalFunctions(vm)

{

    m_scriptExecutionContext = new WebCore::ScriptExecutionContext(&vm, this);
}

GlobalObject::~GlobalObject()
{
    if (napiInstanceDataFinalizer) {
        napi_finalize finalizer = reinterpret_cast<napi_finalize>(napiInstanceDataFinalizer);
        finalizer(toNapi(this), napiInstanceData, napiInstanceDataFinalizerHint);
    }

    delete crypto;
    scriptExecutionContext()->removeFromContextsMap();
}

void GlobalObject::destroy(JSCell* cell)
{
    static_cast<GlobalObject*>(cell)->GlobalObject::~GlobalObject();
}

WebCore::ScriptExecutionContext* GlobalObject::scriptExecutionContext()
{
    return m_scriptExecutionContext;
}

WebCore::ScriptExecutionContext* GlobalObject::scriptExecutionContext() const
{
    return m_scriptExecutionContext;
}

void GlobalObject::reportUncaughtExceptionAtEventLoop(JSGlobalObject* globalObject,
    JSC::Exception* exception)
{
    Bun__reportError(globalObject, JSValue::encode(JSValue(exception)));
}

void GlobalObject::promiseRejectionTracker(JSGlobalObject* obj, JSC::JSPromise* promise,
    JSC::JSPromiseRejectionOperation operation)
{
    // Zig__GlobalObject__promiseRejectionTracker(
    //     obj, prom, reject == JSC::JSPromiseRejectionOperation::Reject ? 0 : 1);

    // Do this in C++ for now
    auto* globalObj = reinterpret_cast<GlobalObject*>(obj);
    switch (operation) {
    case JSPromiseRejectionOperation::Reject:
        globalObj->m_aboutToBeNotifiedRejectedPromises.append(JSC::Strong<JSPromise>(obj->vm(), promise));
        break;
    case JSPromiseRejectionOperation::Handle:
        globalObj->m_aboutToBeNotifiedRejectedPromises.removeFirstMatching([&](Strong<JSPromise>& unhandledPromise) {
            return unhandledPromise.get() == promise;
        });
        break;
    }
}

static Zig::ConsoleClient* m_console;

void GlobalObject::setConsole(void* console)
{
    m_console = new Zig::ConsoleClient(console);
    this->setConsoleClient(m_console);
}

#pragma mark - Globals

JSC_DECLARE_CUSTOM_GETTER(functionLazyLoadStreamPrototypeMap_getter);

JSC_DEFINE_CUSTOM_GETTER(functionLazyLoadStreamPrototypeMap_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        thisObject->readableStreamNativeMap());
}

JSC_DECLARE_CUSTOM_GETTER(JSDOMURL_getter);

JSC_DEFINE_CUSTOM_GETTER(JSDOMURL_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSDOMURL::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DECLARE_CUSTOM_GETTER(JSErrorEvent_getter);

JSC_DEFINE_CUSTOM_GETTER(JSErrorEvent_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSErrorEvent::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DECLARE_CUSTOM_GETTER(JSCloseEvent_getter);

JSC_DEFINE_CUSTOM_GETTER(JSCloseEvent_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSCloseEvent::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(JSBuffer_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        thisObject->JSBufferConstructor());
}

GENERATED_CONSTRUCTOR_GETTER(JSTextDecoder);
GENERATED_CONSTRUCTOR_SETTER(JSTextDecoder);

GENERATED_CONSTRUCTOR_GETTER(JSResponse);
GENERATED_CONSTRUCTOR_SETTER(JSResponse);

GENERATED_CONSTRUCTOR_GETTER(JSRequest);
GENERATED_CONSTRUCTOR_SETTER(JSRequest);

GENERATED_CONSTRUCTOR_GETTER(JSBlob);
GENERATED_CONSTRUCTOR_SETTER(JSBlob);

WEBCORE_GENERATED_CONSTRUCTOR_GETTER(JSMessageEvent);
WEBCORE_GENERATED_CONSTRUCTOR_SETTER(JSMessageEvent);

WEBCORE_GENERATED_CONSTRUCTOR_GETTER(JSWebSocket);
WEBCORE_GENERATED_CONSTRUCTOR_SETTER(JSWebSocket);

WEBCORE_GENERATED_CONSTRUCTOR_GETTER(JSFetchHeaders);
WEBCORE_GENERATED_CONSTRUCTOR_SETTER(JSFetchHeaders);

WEBCORE_GENERATED_CONSTRUCTOR_GETTER(JSTextEncoder);
WEBCORE_GENERATED_CONSTRUCTOR_SETTER(JSTextEncoder);

WEBCORE_GENERATED_CONSTRUCTOR_GETTER(JSURLSearchParams);
WEBCORE_GENERATED_CONSTRUCTOR_SETTER(JSURLSearchParams);

JSC_DECLARE_CUSTOM_GETTER(JSEvent_getter);

JSC_DEFINE_CUSTOM_GETTER(JSEvent_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSEvent::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DECLARE_CUSTOM_GETTER(JSCustomEvent_getter);

JSC_DEFINE_CUSTOM_GETTER(JSCustomEvent_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSCustomEvent::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DECLARE_CUSTOM_GETTER(JSEventTarget_getter);

JSC_DEFINE_CUSTOM_GETTER(JSEventTarget_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSEventTarget::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DECLARE_CUSTOM_GETTER(JSDOMAbortController_getter);

JSC_DEFINE_CUSTOM_GETTER(JSDOMAbortController_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSAbortController::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DECLARE_CUSTOM_GETTER(JSDOMAbortSignal_getter);

JSC_DEFINE_CUSTOM_GETTER(JSDOMAbortSignal_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSAbortSignal::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

JSC_DECLARE_CUSTOM_GETTER(JSDOMException_getter);

JSC_DEFINE_CUSTOM_GETTER(JSDOMException_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        WebCore::JSDOMException::getConstructor(JSC::getVM(lexicalGlobalObject), thisObject));
}

static JSC_DECLARE_CUSTOM_SETTER(property_lazyProcessSetter);
static JSC_DECLARE_CUSTOM_GETTER(property_lazyProcessGetter);

JSC_DEFINE_CUSTOM_SETTER(property_lazyProcessSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    return false;
}

JSC_DEFINE_CUSTOM_GETTER(property_lazyProcessGetter,
    (JSC::JSGlobalObject * _globalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(_globalObject);

    JSC::VM& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    return JSC::JSValue::encode(
        globalObject->processObject());
}

JSC_DEFINE_CUSTOM_SETTER(lazyProcessEnvSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    return false;
}

JSC_DEFINE_CUSTOM_GETTER(lazyProcessEnvGetter,
    (JSC::JSGlobalObject * _globalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(_globalObject);
    return JSC::JSValue::encode(
        globalObject->processEnvObject());
}

static JSC_DEFINE_HOST_FUNCTION(functionQueueMicrotask,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "queueMicrotask requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "queueMicrotask expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    Zig::GlobalObject* global = JSC::jsCast<Zig::GlobalObject*>(globalObject);

    // This is a JSC builtin function
    globalObject->queueMicrotask(global->performMicrotaskFunction(), job, JSC::JSValue {},
        JSC::JSValue {}, JSC::JSValue {});

    return JSC::JSValue::encode(JSC::jsUndefined());
}

static JSC_DEFINE_HOST_FUNCTION(functionSetTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setTimeout requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setTimeout expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (callFrame->argumentCount() == 1) {
        globalObject->queueMicrotask(job, JSC::JSValue {}, JSC::JSValue {},
            JSC::JSValue {}, JSC::JSValue {});
        return JSC::JSValue::encode(JSC::jsNumber(Bun__Timer__getNextID()));
    }

    JSC::JSValue num = callFrame->argument(1);
    JSC::JSValue arguments = {};
    size_t argumentCount = callFrame->argumentCount() - 2;
    if (argumentCount > 0) {
        JSC::ObjectInitializationScope initializationScope(globalObject->vm());
        JSC::JSArray* argumentsArray = JSC::JSArray::tryCreateUninitializedRestricted(
            initializationScope, nullptr,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            argumentCount);

        if (UNLIKELY(!argumentsArray)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        for (size_t i = 0; i < argumentCount; i++) {
            argumentsArray->putDirectIndex(globalObject, i, callFrame->uncheckedArgument(i + 2));
        }
        arguments = JSValue(argumentsArray);
    }
    return Bun__Timer__setTimeout(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(num), JSValue::encode(arguments));
}

static JSC_DEFINE_HOST_FUNCTION(functionSetInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setInterval requires 2 arguments (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setInterval expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue num = callFrame->argument(1);

    JSC::JSValue arguments = {};
    size_t argumentCount = callFrame->argumentCount() - 2;
    if (argumentCount > 0) {
        JSC::ObjectInitializationScope initializationScope(globalObject->vm());
        JSC::JSArray* argumentsArray = JSC::JSArray::tryCreateUninitializedRestricted(
            initializationScope, nullptr,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            argumentCount);

        if (UNLIKELY(!argumentsArray)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        for (size_t i = 0; i < argumentCount; i++) {
            argumentsArray->putDirectIndex(globalObject, i, callFrame->uncheckedArgument(i + 2));
        }
        arguments = JSValue(argumentsArray);
    }
    return Bun__Timer__setInterval(globalObject, JSC::JSValue::encode(job),
        JSC::JSValue::encode(num), JSValue::encode(arguments));
}

static JSC_DEFINE_HOST_FUNCTION(functionClearInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "clearInterval requires 1 argument (a number)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue num = callFrame->argument(0);

    return Bun__Timer__clearInterval(globalObject, JSC::JSValue::encode(num));
}

static JSC_DEFINE_HOST_FUNCTION(functionClearTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "clearTimeout requires 1 argument (a number)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue num = callFrame->argument(0);

    return Bun__Timer__clearTimeout(globalObject, JSC::JSValue::encode(num));
}

static JSC_DEFINE_HOST_FUNCTION(functionBTOA,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "btoa requires 1 argument (a string)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    const String& stringToEncode = callFrame->argument(0).toWTFString(globalObject);

    if (!stringToEncode || stringToEncode.isNull()) {
        return JSC::JSValue::encode(JSC::jsString(vm, WTF::String()));
    }

    if (!stringToEncode.isAllLatin1()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        // TODO: DOMException
        JSC::throwTypeError(globalObject, scope, "The string contains invalid characters."_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    return JSC::JSValue::encode(JSC::jsString(vm, WTF::base64EncodeToString(stringToEncode.latin1())));
}

static JSC_DEFINE_HOST_FUNCTION(functionATOB,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "atob requires 1 argument (a string)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    const WTF::String& encodedString = callFrame->argument(0).toWTFString(globalObject);

    if (encodedString.isNull()) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    auto decodedData = WTF::base64Decode(encodedString, {
                                                            WTF::Base64DecodeOptions::ValidatePadding,
                                                            WTF::Base64DecodeOptions::IgnoreSpacesAndNewLines,
                                                            WTF::Base64DecodeOptions::DiscardVerticalTab,
                                                        });
    if (!decodedData) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        // TODO: DOMException
        JSC::throwTypeError(globalObject, scope, "The string contains invalid characters."_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    return JSC::JSValue::encode(JSC::jsString(vm, WTF::String(decodedData->data(), decodedData->size())));
}

static JSC_DEFINE_HOST_FUNCTION(functionHashCode,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::JSValue stringToHash = callFrame->argument(0);
    JSC::JSString* str = stringToHash.toStringOrNull(globalObject);
    if (!str) {
        return JSC::JSValue::encode(jsNumber(0));
    }

    auto view = str->value(globalObject);
    return JSC::JSValue::encode(jsNumber(view.hash()));
}

static JSC_DEFINE_HOST_FUNCTION(functionReportError,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    switch (callFrame->argumentCount()) {
    case 0: {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    default: {
        Bun__reportError(globalObject, JSC::JSValue::encode(callFrame->argument(0)));
    }
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" JSC__JSValue Bun__createArrayBufferForCopy(JSC::JSGlobalObject* globalObject, const void* ptr, size_t len)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(len, 1);

    if (UNLIKELY(!arrayBuffer)) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (len > 0)
        memcpy(arrayBuffer->data(), ptr, len);

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSArrayBuffer::create(globalObject->vm(), globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTFMove(arrayBuffer))));
}

extern "C" JSC__JSValue Bun__createUint8ArrayForCopy(JSC::JSGlobalObject* globalObject, const void* ptr, size_t len)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), len);

    if (UNLIKELY(!array)) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (len > 0)
        memcpy(array->vector(), ptr, len);

    RELEASE_AND_RETURN(scope, JSValue::encode(array));
}

JSC_DECLARE_HOST_FUNCTION(functionCreateUninitializedArrayBuffer);
JSC_DEFINE_HOST_FUNCTION(functionCreateUninitializedArrayBuffer,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    size_t len = static_cast<size_t>(JSC__JSValue__toInt64(JSC::JSValue::encode(callFrame->argument(0))));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(len, 1);

    if (UNLIKELY(!arrayBuffer)) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSArrayBuffer::create(globalObject->vm(), globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTFMove(arrayBuffer))));
}

JSC_DEFINE_HOST_FUNCTION(functionNoop, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionPathToFileURL);
JSC_DECLARE_HOST_FUNCTION(functionFileURLToPath);

JSC_DEFINE_HOST_FUNCTION(functionPathToFileURL, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& globalObject = *reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto path = JSC::JSValue::encode(callFrame->argument(0));

    JSC::JSString* pathString = JSC::JSValue::decode(path).toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));

    auto fileURL = WTF::URL::fileURLWithFileSystemPath(pathString->value(lexicalGlobalObject));
    auto object = WebCore::DOMURL::create(fileURL.string(), String());
    auto jsValue = toJSNewlyCreated<IDLInterface<DOMURL>>(*lexicalGlobalObject, globalObject, throwScope, WTFMove(object));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(jsValue));
}

JSC_DEFINE_HOST_FUNCTION(functionFileURLToPath, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue arg0 = callFrame->argument(0);
    auto path = JSC::JSValue::encode(arg0);
    auto* domURL = WebCoreCast<WebCore::JSDOMURL, WebCore__DOMURL>(path);
    if (!domURL) {
        if (arg0.isString()) {
            auto url = WTF::URL(arg0.toWTFString(globalObject));
            RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));
            RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, url.fileSystemPath())));
        }
        throwTypeError(globalObject, scope, "Argument must be a URL"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    return JSC::JSValue::encode(JSC::jsString(vm, domURL->href().fileSystemPath()));
}

JSC_DEFINE_CUSTOM_GETTER(noop_getter, (JSGlobalObject*, EncodedJSValue, PropertyName))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(noop_setter,
    (JSC::JSGlobalObject*, JSC::EncodedJSValue,
        JSC::EncodedJSValue, JSC::PropertyName))
{
    return true;
}

static NeverDestroyed<const String> pathToFileURLString(MAKE_STATIC_STRING_IMPL("pathToFileURL"));
static NeverDestroyed<const String> fileURLToPathString(MAKE_STATIC_STRING_IMPL("fileURLToPath"));

enum ReadableStreamTag : int32_t {
    Invalid = -1,

    /// ReadableStreamDefaultController or ReadableByteStreamController
    JavaScript = 0,

    /// ReadableByteStreamController
    /// but with a BlobLoader
    /// we can skip the BlobLoader and just use the underlying Blob
    Blob = 1,

    /// ReadableByteStreamController
    /// but with a FileLoader
    /// we can skip the FileLoader and just use the underlying File
    File = 2,

    /// This is a direct readable stream
    /// That means we can turn it into whatever we want
    Direct = 3,

    // This is an ambiguous stream of bytes
    Bytes = 4,
};

// we're trying out a new way to do this lazy loading
static JSC_DEFINE_HOST_FUNCTION(functionLazyLoad,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
JSC:
    VM& vm = globalObject->vm();
    switch (callFrame->argumentCount()) {
    case 0: {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "lazyLoad needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        static NeverDestroyed<const String> sqliteString(MAKE_STATIC_STRING_IMPL("sqlite"));
        static NeverDestroyed<const String> bunJSCString(MAKE_STATIC_STRING_IMPL("bun:jsc"));
        static NeverDestroyed<const String> bunStreamString(MAKE_STATIC_STRING_IMPL("bun:stream"));
        static NeverDestroyed<const String> noopString(MAKE_STATIC_STRING_IMPL("noop"));
        static NeverDestroyed<const String> createImportMeta(MAKE_STATIC_STRING_IMPL("createImportMeta"));

        JSC::JSValue moduleName = callFrame->argument(0);
        if (moduleName.isNumber()) {
            switch (moduleName.toInt32(globalObject)) {
            case 0: {
                auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
                JSC::throwTypeError(globalObject, scope, "lazyLoad expects a string"_s);
                scope.release();
                return JSC::JSValue::encode(JSC::JSValue {});
            }

            case ReadableStreamTag::Blob: {
                return ByteBlob__JSReadableStreamSource__load(globalObject);
            }
            case ReadableStreamTag::File: {
                return FileReader__JSReadableStreamSource__load(globalObject);
            }
            case ReadableStreamTag::Bytes: {
                return ByteStream__JSReadableStreamSource__load(globalObject);
            }

            default: {
                auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
                JSC::throwTypeError(globalObject, scope, "lazyLoad expects a string"_s);
                scope.release();
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            }
        }

        auto string = moduleName.toWTFString(globalObject);
        if (string.isNull()) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "lazyLoad expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        if (string == sqliteString) {
            return JSC::JSValue::encode(JSSQLStatementConstructor::create(vm, globalObject, JSSQLStatementConstructor::createStructure(vm, globalObject, globalObject->m_functionPrototype.get())));
        }

        if (string == bunJSCString) {
            return JSC::JSValue::encode(createJSCModule(globalObject));
        }

        if (string == pathToFileURLString) {
            return JSValue::encode(
                JSFunction::create(vm, globalObject, 1, pathToFileURLString, functionPathToFileURL, ImplementationVisibility::Public, NoIntrinsic));
        }
        if (string == fileURLToPathString) {
            return JSValue::encode(
                JSFunction::create(vm, globalObject, 1, fileURLToPathString, functionFileURLToPath, ImplementationVisibility::Public, NoIntrinsic));
        }

        if (string == bunStreamString) {
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "BufferList"_s)), reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSBufferList(), 0);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "ReadableState"_s)), reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSReadableState(), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "maybeReadMore"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "maybeReadMore"_s, jsReadable_maybeReadMore, ImplementationVisibility::Public), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "resume"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "resume"_s, jsReadable_resume, ImplementationVisibility::Public), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "emitReadable"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "emitReadable"_s, jsReadable_emitReadable, ImplementationVisibility::Public), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "onEofChunk"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "onEofChunk"_s, jsReadable_onEofChunk, ImplementationVisibility::Public), 0);
            return JSValue::encode(obj);
        }

        if (string == createImportMeta) {
            Zig::ImportMetaObject* obj = Zig::ImportMetaObject::create(globalObject, callFrame->argument(1));
            return JSValue::encode(obj);
        }

        if (UNLIKELY(string == noopString)) {
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getterSetter"_s)), JSC::CustomGetterSetter::create(vm, noop_getter, noop_setter), 0);
            Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(vm, reinterpret_cast<Zig::GlobalObject*>(globalObject), 0, String(), functionNoop, JSC::NoIntrinsic);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "function"_s)), function, JSC::PropertyAttribute::Function | 0);
            obj->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "functionRegular"_s), 1, functionNoop, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::Function);
            return JSC::JSValue::encode(obj);
        }

        return JSC::JSValue::encode(JSC::jsUndefined());

        break;
    }
    }
}

static inline JSValue jsServiceWorkerGlobalScope_ByteLengthQueuingStrategyConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSByteLengthQueuingStrategy::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_ByteLengthQueuingStrategyConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_ByteLengthQueuingStrategyConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_CountQueuingStrategyConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSCountQueuingStrategy::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_CountQueuingStrategyConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_CountQueuingStrategyConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_ReadableByteStreamControllerConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSReadableByteStreamController::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_ReadableByteStreamControllerConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_ReadableByteStreamControllerConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_ReadableStreamConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSReadableStream::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_ReadableStreamConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_ReadableStreamConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_ReadableStreamBYOBReaderConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSReadableStreamBYOBReader::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_ReadableStreamBYOBReaderConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_ReadableStreamBYOBReaderConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_ReadableStreamBYOBRequestConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSReadableStreamBYOBRequest::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_ReadableStreamBYOBRequestConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_ReadableStreamBYOBRequestConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_ReadableStreamDefaultControllerConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSReadableStreamDefaultController::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_ReadableStreamDefaultControllerConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_ReadableStreamDefaultControllerConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_ReadableStreamDefaultReaderConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSReadableStreamDefaultReader::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_ReadableStreamDefaultReaderConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_ReadableStreamDefaultReaderConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_TransformStreamConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSTransformStream::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_TransformStreamConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_TransformStreamConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_TransformStreamDefaultControllerConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSTransformStreamDefaultController::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_TransformStreamDefaultControllerConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_TransformStreamDefaultControllerConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_WritableStreamConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSWritableStream::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_WritableStreamConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_WritableStreamConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_WritableStreamDefaultControllerConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSWritableStreamDefaultController::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_WritableStreamDefaultControllerConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_WritableStreamDefaultControllerConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsServiceWorkerGlobalScope_WritableStreamDefaultWriterConstructorGetter(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return JSWritableStreamDefaultWriter::getConstructor(JSC::getVM(&lexicalGlobalObject), &thisObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsServiceWorkerGlobalScope_WritableStreamDefaultWriterConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<Zig::GlobalObject>::get<jsServiceWorkerGlobalScope_WritableStreamDefaultWriterConstructorGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

JSC_DEFINE_CUSTOM_GETTER(getterSubtleCryptoConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(
        JSSubtleCrypto::getConstructor(thisObject->vm(), thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(getterCryptoKeyConstructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(
        JSCryptoKey::getConstructor(thisObject->vm(), thisObject));
}

static inline JSValue getterSubtleCryptoBody(JSGlobalObject& lexicalGlobalObject, Zig::GlobalObject& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    return thisObject.subtleCrypto();
}

JSC_DEFINE_CUSTOM_GETTER(getterSubtleCrypto, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return JSValue::encode(
        getterSubtleCryptoBody(*lexicalGlobalObject, *reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)));
}

JSC_DECLARE_HOST_FUNCTION(makeThisTypeErrorForBuiltins);
JSC_DECLARE_HOST_FUNCTION(makeGetterTypeErrorForBuiltins);
JSC_DECLARE_HOST_FUNCTION(makeDOMExceptionForBuiltins);
JSC_DECLARE_HOST_FUNCTION(createWritableStreamFromInternal);
JSC_DECLARE_HOST_FUNCTION(getInternalWritableStream);
JSC_DECLARE_HOST_FUNCTION(whenSignalAborted);
JSC_DECLARE_HOST_FUNCTION(isAbortSignal);
JSC_DEFINE_HOST_FUNCTION(makeThisTypeErrorForBuiltins, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);
    VM& vm = globalObject->vm();
    DeferTermination deferScope(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto interfaceName = callFrame->uncheckedArgument(0).getString(globalObject);
    scope.assertNoException();
    auto functionName = callFrame->uncheckedArgument(1).getString(globalObject);
    scope.assertNoException();
    return JSValue::encode(createTypeError(globalObject, makeThisTypeErrorMessage(interfaceName.utf8().data(), functionName.utf8().data())));
}

JSC_DEFINE_HOST_FUNCTION(makeGetterTypeErrorForBuiltins, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);
    VM& vm = globalObject->vm();
    DeferTermination deferScope(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto interfaceName = callFrame->uncheckedArgument(0).getString(globalObject);
    scope.assertNoException();
    auto attributeName = callFrame->uncheckedArgument(1).getString(globalObject);
    scope.assertNoException();

    auto error = static_cast<ErrorInstance*>(createTypeError(globalObject, JSC::makeDOMAttributeGetterTypeErrorMessage(interfaceName.utf8().data(), attributeName)));
    error->setNativeGetterTypeError();
    return JSValue::encode(error);
}

JSC_DEFINE_HOST_FUNCTION(makeDOMExceptionForBuiltins, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);

    auto& vm = globalObject->vm();
    DeferTermination deferScope(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto codeValue = callFrame->uncheckedArgument(0).getString(globalObject);
    scope.assertNoException();

    auto message = callFrame->uncheckedArgument(1).getString(globalObject);
    scope.assertNoException();

    ExceptionCode code { TypeError };
    if (codeValue == "AbortError"_s)
        code = AbortError;
    auto value = createDOMException(globalObject, code, message);

    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());

    return JSValue::encode(value);
}

JSC_DEFINE_HOST_FUNCTION(getInternalWritableStream, (JSGlobalObject*, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 1);

    auto* writableStream = jsDynamicCast<JSWritableStream*>(callFrame->uncheckedArgument(0));
    if (UNLIKELY(!writableStream))
        return JSValue::encode(jsUndefined());
    return JSValue::encode(writableStream->wrapped().internalWritableStream());
}

JSC_DEFINE_HOST_FUNCTION(createWritableStreamFromInternal, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 1);
    ASSERT(callFrame->uncheckedArgument(0).isObject());

    auto* jsDOMGlobalObject = JSC::jsCast<JSDOMGlobalObject*>(globalObject);
    auto internalWritableStream = InternalWritableStream::fromObject(*jsDOMGlobalObject, *callFrame->uncheckedArgument(0).toObject(globalObject));
    return JSValue::encode(toJSNewlyCreated(globalObject, jsDOMGlobalObject, WritableStream::create(WTFMove(internalWritableStream))));
}

JSC_DEFINE_HOST_FUNCTION(whenSignalAborted, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);

    auto& vm = globalObject->vm();
    auto* abortSignal = jsDynamicCast<JSAbortSignal*>(callFrame->uncheckedArgument(0));
    if (UNLIKELY(!abortSignal))
        return JSValue::encode(JSValue(JSC::JSValue::JSFalse));

    Ref<AbortAlgorithm> abortAlgorithm = JSAbortAlgorithm::create(vm, callFrame->uncheckedArgument(1).getObject());

    bool result = AbortSignal::whenSignalAborted(abortSignal->wrapped(), WTFMove(abortAlgorithm));
    return JSValue::encode(result ? JSValue(JSC::JSValue::JSTrue) : JSValue(JSC::JSValue::JSFalse));
}

JSC_DEFINE_HOST_FUNCTION(isAbortSignal, (JSGlobalObject*, CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    return JSValue::encode(jsBoolean(callFrame->uncheckedArgument(0).inherits<JSAbortSignal>()));
}

extern "C" void ReadableStream__cancel(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject);
extern "C" void ReadableStream__cancel(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* readableStream = jsDynamicCast<JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream));
    if (UNLIKELY(!readableStream))
        return;

    if (!ReadableStream(*globalObject, *readableStream).isLocked()) {
        return;
    }

    WebCore::Exception exception { AbortError };
    ReadableStream(*globalObject, *readableStream).cancel(exception);
}

extern "C" void ReadableStream__detach(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject);
extern "C" void ReadableStream__detach(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* readableStream = jsDynamicCast<JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream));
    if (UNLIKELY(!readableStream))
        return;
    auto& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    readableStream->putDirect(vm, clientData->builtinNames().bunNativePtrPrivateName(), JSC::jsUndefined(), 0);
    readableStream->putDirect(vm, clientData->builtinNames().bunNativeTypePrivateName(), JSC::jsUndefined(), 0);
}
extern "C" bool ReadableStream__isDisturbed(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject);
extern "C" bool ReadableStream__isDisturbed(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    ASSERT(globalObject);
    return ReadableStream::isDisturbed(globalObject, jsDynamicCast<WebCore::JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream)));
}

extern "C" bool ReadableStream__isLocked(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject);
extern "C" bool ReadableStream__isLocked(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    ASSERT(globalObject);
    WebCore::JSReadableStream* stream = jsDynamicCast<WebCore::JSReadableStream*>(JSValue::decode(possibleReadableStream));
    return stream != nullptr && ReadableStream::isLocked(globalObject, stream);
}

extern "C" int32_t ReadableStreamTag__tagged(Zig::GlobalObject* globalObject, JSC__JSValue possibleReadableStream, JSValue* ptr);
extern "C" int32_t ReadableStreamTag__tagged(Zig::GlobalObject* globalObject, JSC__JSValue possibleReadableStream, JSValue* ptr)
{
    ASSERT(globalObject);
    JSC::JSObject* object = JSValue::decode(possibleReadableStream).getObject();
    if (!object || !object->inherits<JSReadableStream>()) {
        *ptr = JSC::JSValue();
        return -1;
    }

    auto* readableStream = jsCast<JSReadableStream*>(object);
    auto& vm = globalObject->vm();
    auto& builtinNames = WebCore::clientData(vm)->builtinNames();
    int32_t num = 0;
    if (JSValue numberValue = readableStream->getDirect(vm, builtinNames.bunNativeTypePrivateName())) {
        num = numberValue.toInt32(globalObject);
    }

    // If this type is outside the expected range, it means something is wrong.
    if (UNLIKELY(!(num > 0 && num < 5))) {
        *ptr = JSC::JSValue();
        return 0;
    }

    *ptr = readableStream->getDirect(vm, builtinNames.bunNativePtrPrivateName());
    return num;
}

extern "C" JSC__JSValue ReadableStream__consume(Zig::GlobalObject* globalObject, JSC__JSValue stream, JSC__JSValue nativeType, JSC__JSValue nativePtr);
extern "C" JSC__JSValue ReadableStream__consume(Zig::GlobalObject* globalObject, JSC__JSValue stream, JSC__JSValue nativeType, JSC__JSValue nativePtr)
{
    ASSERT(globalObject);

    auto& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    auto function = globalObject->getDirect(vm, builtinNames.consumeReadableStreamPrivateName()).getObject();
    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(nativePtr));
    arguments.append(JSValue::decode(nativeType));
    arguments.append(JSValue::decode(stream));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

extern "C" JSC__JSValue ZigGlobalObject__createNativeReadableStream(Zig::GlobalObject* globalObject, JSC__JSValue nativeType, JSC__JSValue nativePtr);
extern "C" JSC__JSValue ZigGlobalObject__createNativeReadableStream(Zig::GlobalObject* globalObject, JSC__JSValue nativeType, JSC__JSValue nativePtr)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    auto function = globalObject->getDirect(vm, builtinNames.createNativeReadableStreamPrivateName()).getObject();
    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(nativeType));
    arguments.append(JSValue::decode(nativePtr));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

static inline EncodedJSValue flattenArrayOfBuffersIntoArrayBuffer(JSGlobalObject* lexicalGlobalObject, JSValue arrayValue)
{
    auto& vm = lexicalGlobalObject->vm();

    auto clientData = WebCore::clientData(vm);
    if (arrayValue.isUndefinedOrNull() || !arrayValue) {
        return JSC::JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1)));
    }

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto array = JSC::jsDynamicCast<JSC::JSArray*>(arrayValue);
    if (UNLIKELY(!array)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Argument must be an array"_s);
        return JSValue::encode(jsUndefined());
    }

    size_t arrayLength = array->length();
    if (arrayLength < 1) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1))));
    }

    size_t byteLength = 0;
    bool any_buffer = false;
    bool any_typed = false;

    for (size_t i = 0; i < arrayLength; i++) {
        auto element = array->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(throwScope, {});

        if (auto* typedArray = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(element)) {
            if (UNLIKELY(typedArray->isDetached())) {
                throwTypeError(lexicalGlobalObject, throwScope, "ArrayBufferView is detached"_s);
                return JSValue::encode(jsUndefined());
            }
            byteLength += typedArray->byteLength();
            any_typed = true;
        } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(element)) {
            auto* impl = arrayBuffer->impl();
            if (UNLIKELY(!impl)) {
                throwTypeError(lexicalGlobalObject, throwScope, "ArrayBuffer is detached"_s);
                return JSValue::encode(jsUndefined());
            }

            byteLength += impl->byteLength();
            any_buffer = true;
        } else {
            throwTypeError(lexicalGlobalObject, throwScope, "Expected TypedArray"_s);
            return JSValue::encode(jsUndefined());
        }
    }

    if (byteLength == 0) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), JSC::ArrayBuffer::create(static_cast<size_t>(0), 1))));
    }

    auto buffer = JSC::ArrayBuffer::tryCreateUninitialized(byteLength, 1);
    if (UNLIKELY(!buffer)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Failed to allocate ArrayBuffer"_s);
        return JSValue::encode(jsUndefined());
    }

    size_t remain = byteLength;
    auto* head = reinterpret_cast<char*>(buffer->data());

    if (!any_buffer) {
        for (size_t i = 0; i < arrayLength && remain > 0; i++) {
            auto element = array->getIndex(lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(throwScope, {});
            auto* view = JSC::jsCast<JSC::JSArrayBufferView*>(element);
            size_t length = std::min(remain, view->byteLength());
            memcpy(head, view->vector(), length);
            remain -= length;
            head += length;
        }
    } else if (!any_typed) {
        for (size_t i = 0; i < arrayLength && remain > 0; i++) {
            auto element = array->getIndex(lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(throwScope, {});
            auto* view = JSC::jsCast<JSC::JSArrayBuffer*>(element);
            size_t length = std::min(remain, view->impl()->byteLength());
            memcpy(head, view->impl()->data(), length);
            remain -= length;
            head += length;
        }
    } else {
        for (size_t i = 0; i < arrayLength && remain > 0; i++) {
            auto element = array->getIndex(lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(throwScope, {});
            size_t length = 0;
            if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(element)) {
                length = std::min(remain, view->impl()->byteLength());
                memcpy(head, view->impl()->data(), length);
            } else {
                auto* typedArray = JSC::jsCast<JSC::JSArrayBufferView*>(element);
                length = std::min(remain, typedArray->byteLength());
                memcpy(head, typedArray->vector(), length);
            }

            remain -= length;
            head += length;
        }
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), WTFMove(buffer))));
}

JSC_DECLARE_HOST_FUNCTION(functionConcatTypedArrays);

JSC_DEFINE_HOST_FUNCTION(functionConcatTypedArrays, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return JSValue::encode(jsUndefined());
    }

    auto arrayValue = callFrame->uncheckedArgument(0);

    return flattenArrayOfBuffersIntoArrayBuffer(globalObject, arrayValue);
}

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);

static inline EncodedJSValue functionPerformanceNowBody(JSGlobalObject* globalObject)
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    // nanoseconds to seconds
    uint64_t time = Bun__readOriginTimer(global->bunVM());
    double result = time / 1000000.0;
    return JSValue::encode(jsNumber(result));
}

extern "C" {
class JSPerformanceObject;
static JSC_DECLARE_HOST_FUNCTION(functionPerformanceNow);
static JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(functionPerformanceNowWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject*, JSPerformanceObject*));
static JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(functionBunNanosecondsWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject*, JSObject*));
static JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(functionBunEscapeHTMLWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject*, JSObject*, JSString*));
}

class JSPerformanceObject final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSPerformanceObject* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSPerformanceObject* ptr = new (NotNull, JSC::allocateCell<JSPerformanceObject>(vm)) JSPerformanceObject(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSPerformanceObject, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSPerformanceObject(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        static const JSC::DOMJIT::Signature DOMJITSignatureForPerformanceNow(
            functionPerformanceNowWithoutTypeCheck,
            JSPerformanceObject::info(),
            JSC::DOMJIT::Effect::forWriteKinds(DFG::AbstractHeapKind::SideState),
            SpecBytecodeDouble);

        JSFunction* function = JSFunction::create(
            vm,
            globalObject(),
            0,
            String("now"_s),
            functionPerformanceNow, ImplementationVisibility::Public, NoIntrinsic, functionPerformanceNow,
            &DOMJITSignatureForPerformanceNow);

        this->putDirect(vm, JSC::Identifier::fromString(vm, "now"_s), function, JSC::PropertyAttribute::DOMJITFunction | JSC::PropertyAttribute::Function);
        this->putDirect(
            vm,
            JSC::Identifier::fromString(vm, "timeOrigin"_s),
            jsNumber(Bun__readOriginTimerStart(reinterpret_cast<Zig::GlobalObject*>(this->globalObject())->bunVM())),
            JSC::PropertyAttribute::ReadOnly | 0);
    }
};
const ClassInfo JSPerformanceObject::s_info = { "Performance"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPerformanceObject) };

JSC_DEFINE_HOST_FUNCTION(functionPerformanceNow, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return functionPerformanceNowBody(globalObject);
}

JSC_DEFINE_JIT_OPERATION(functionPerformanceNowWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, JSPerformanceObject* castedThis))
{
    VM& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return functionPerformanceNowBody(lexicalGlobalObject);
}

JSC_DEFINE_JIT_OPERATION(functionBunEscapeHTMLWithoutTypeCheck, JSC::EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, JSObject* castedThis, JSString* string))
{
    JSC::VM& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    size_t length = string->length();
    if (!length)
        return JSValue::encode(string);

    auto resolvedString = string->value(lexicalGlobalObject);
    if (!resolvedString.is8Bit()) {
        return Bun__escapeHTML16(lexicalGlobalObject, JSValue::encode(string), resolvedString.characters16(), length);
    } else {
        return Bun__escapeHTML8(lexicalGlobalObject, JSValue::encode(string), resolvedString.characters8(), length);
    }
}

JSC_DECLARE_HOST_FUNCTION(functionBunEscapeHTML);
JSC_DEFINE_HOST_FUNCTION(functionBunEscapeHTML, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = JSC::getVM(lexicalGlobalObject);
    JSC::JSValue argument = callFrame->argument(0);
    if (argument.isEmpty())
        return JSValue::encode(jsEmptyString(vm));
    if (argument.isNumber() || argument.isBoolean())
        return JSValue::encode(argument.toString(lexicalGlobalObject));

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto string = argument.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    size_t length = string->length();
    if (!length)
        RELEASE_AND_RETURN(scope, JSValue::encode(string));

    auto resolvedString = string->value(lexicalGlobalObject);
    EncodedJSValue encodedInput = JSValue::encode(string);
    if (!resolvedString.is8Bit()) {
        RELEASE_AND_RETURN(scope, Bun__escapeHTML16(lexicalGlobalObject, encodedInput, resolvedString.characters16(), length));
    } else {
        RELEASE_AND_RETURN(scope, Bun__escapeHTML8(lexicalGlobalObject, encodedInput, resolvedString.characters8(), length));
    }
}

JSC_DECLARE_HOST_FUNCTION(functionBunDeepEquals);

JSC_DEFINE_HOST_FUNCTION(functionBunDeepEquals, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    JSC::VM& vm = global->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected 2 values to compare"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSValue arg1 = callFrame->uncheckedArgument(0);
    JSC::JSValue arg2 = callFrame->uncheckedArgument(1);
    JSC::JSValue arg3 = callFrame->argument(2);

    Vector<std::pair<JSValue, JSValue>, 16> stack;

    if (arg3.isBoolean() && arg3.asBoolean()) {
        bool isEqual = Bun__deepEquals<true>(globalObject, arg1, arg2, stack, &scope, true);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(isEqual));
    } else {
        bool isEqual = Bun__deepEquals<false>(globalObject, arg1, arg2, stack, &scope, true);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(isEqual));
    }
}

JSC_DECLARE_HOST_FUNCTION(functionBunNanoseconds);

JSC_DEFINE_HOST_FUNCTION(functionBunNanoseconds, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = reinterpret_cast<GlobalObject*>(globalObject);
    uint64_t time = Bun__readOriginTimer(global->bunVM());
    return JSValue::encode(jsNumber(time));
}

JSC_DECLARE_HOST_FUNCTION(functionConcatTypedArraysFromIterator);

JSC_DEFINE_HOST_FUNCTION(functionConcatTypedArraysFromIterator, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return JSValue::encode(jsUndefined());
    }

    auto arrayValue = callFrame->uncheckedArgument(0);
    if (UNLIKELY(!arrayValue.isObject())) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected an object"_s);
        return JSValue::encode(jsUndefined());
    }

    auto* iter = JSC::jsCast<JSC::JSObject*>(arrayValue);

    return flattenArrayOfBuffersIntoArrayBuffer(globalObject, iter->getDirect(vm, vm.propertyNames->value));
}

static inline JSC__JSValue ZigGlobalObject__readableStreamToArrayBufferBody(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue);
static inline JSC__JSValue ZigGlobalObject__readableStreamToArrayBufferBody(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue)
{
    auto& vm = globalObject->vm();

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* function = globalObject->m_readableStreamToArrayBuffer.get();
    if (!function) {
        function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToArrayBufferCodeGenerator(vm)), globalObject);
        globalObject->m_readableStreamToArrayBuffer.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    JSValue result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);

    JSC::JSObject* object = result.getObject();

    if (UNLIKELY(!result || result.isUndefinedOrNull()))
        return JSValue::encode(result);

    if (UNLIKELY(!object)) {

        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected object"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(object);
    if (UNLIKELY(!promise)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected promise"_s);
        return JSValue::encode(jsUndefined());
    }

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(promise));
}

extern "C" JSC__JSValue ZigGlobalObject__readableStreamToArrayBuffer(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue);
extern "C" JSC__JSValue ZigGlobalObject__readableStreamToArrayBuffer(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue)
{
    return ZigGlobalObject__readableStreamToArrayBufferBody(reinterpret_cast<Zig::GlobalObject*>(globalObject), readableStreamValue);
}

extern "C" JSC__JSValue ZigGlobalObject__readableStreamToText(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue);
extern "C" JSC__JSValue ZigGlobalObject__readableStreamToText(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue)
{
    auto& vm = globalObject->vm();

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToText = globalObject->m_readableStreamToText.get()) {
        function = readableStreamToText;
    } else {
        function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToTextCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToText.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

extern "C" JSC__JSValue ZigGlobalObject__readableStreamToJSON(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue);
extern "C" JSC__JSValue ZigGlobalObject__readableStreamToJSON(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue)
{
    auto& vm = globalObject->vm();

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToJSON = globalObject->m_readableStreamToJSON.get()) {
        function = readableStreamToJSON;
    } else {
        function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToJSONCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToJSON.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

extern "C" JSC__JSValue ZigGlobalObject__readableStreamToBlob(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue);
extern "C" JSC__JSValue ZigGlobalObject__readableStreamToBlob(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue)
{
    auto& vm = globalObject->vm();

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToBlob = globalObject->m_readableStreamToBlob.get()) {
        function = readableStreamToBlob;
    } else {
        function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToBlobCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToBlob.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

JSC_DECLARE_HOST_FUNCTION(functionReadableStreamToArrayBuffer);
JSC_DEFINE_HOST_FUNCTION(functionReadableStreamToArrayBuffer, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return JSValue::encode(jsUndefined());
    }

    auto readableStreamValue = callFrame->uncheckedArgument(0);
    return ZigGlobalObject__readableStreamToArrayBufferBody(reinterpret_cast<Zig::GlobalObject*>(globalObject), JSValue::encode(readableStreamValue));
}

class BunPrimordialsObject final : public JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | GetOwnPropertySlotMayBeWrongAboutDontEnum;
    static BunPrimordialsObject* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        BunPrimordialsObject* ptr = new (NotNull, JSC::allocateCell<BunPrimordialsObject>(vm)) BunPrimordialsObject(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(BunPrimordialsObject, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
    {
        JSC::VM& vm = globalObject->vm();

        auto str = String(propertyName.publicName());
        SymbolImpl* symbol = vm.propertyNames->builtinNames().lookUpPrivateName(str);
        if (!symbol) {
            return false;
        }

        auto identifier = JSC::Identifier::fromUid(vm, symbol);
        if (auto value = globalObject->getIfPropertyExists(globalObject, identifier)) {
            slot.setValue(globalObject, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly, value);
            return true;
        } else if (auto value = vm.bytecodeIntrinsicRegistry().lookup(identifier)) {
            auto name = identifier.string();
            String functionText;
            bool isFunction = false;
            // this is...terrible code
            if (name.characters8()[0] >= 'A' && name.characters8()[0] <= 'Z') {
                functionText = makeString("(function () { return @"_s, name, ";\n})\n"_s);
            } else if (name.characters8()[0] == 'p' || name.characters8()[0] == 't' || name.characters8()[0] == 'g') {
                isFunction = true;
                functionText = makeString("(function (arg1, arg2) { return @"_s, name, "(arg1, arg2);\n})\n"_s);
            } else {
                isFunction = true;
                functionText = makeString("(function (arg1) { return @"_s, name, "(arg1);\n})\n"_s);
            }

            SourceCode source = makeSource(WTFMove(functionText), {});
            JSFunction* func = JSFunction::create(vm, createBuiltinExecutable(vm, source, Identifier::fromString(vm, name), ImplementationVisibility::Public, ConstructorKind::None, ConstructAbility::CannotConstruct)->link(vm, nullptr, source), globalObject);

            slot.setValue(
                globalObject,
                PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | 0,
                isFunction ? JSValue(func) : JSC::call(globalObject, func, JSC::getCallData(func), globalObject, JSC::MarkedArgumentBuffer()));

            return true;
        }
        return false;
    }

    DECLARE_INFO

    BunPrimordialsObject(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }
};

const ClassInfo BunPrimordialsObject::s_info = { "Primordials"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(BunPrimordialsObject) };

extern "C" void Bun__reportUnhandledError(JSGlobalObject*, EncodedJSValue);
JSC_DEFINE_HOST_FUNCTION(jsFunctionPerformMicrotask, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto job = callframe->argument(0);
    if (UNLIKELY(!job || job.isUndefinedOrNull())) {
        return JSValue::encode(jsUndefined());
    }

    auto callData = JSC::getCallData(job);
    MarkedArgumentBuffer arguments;

    if (UNLIKELY(callData.type == CallData::Type::None)) {
        return JSValue::encode(jsUndefined());
    }

    JSValue result;
    WTF::NakedPtr<JSC::Exception> exceptionPtr;

    size_t argCount = callframe->argumentCount();
    if (argCount > 1) {
        if (JSValue arg0 = callframe->argument(1)) {
            arguments.append(arg0);
        }

        if (argCount > 2) {
            if (JSValue arg1 = callframe->argument(2)) {
                arguments.append(arg1);
            }

            if (argCount > 3) {
                if (JSValue arg2 = callframe->argument(3)) {
                    arguments.append(arg2);
                }
            }
        }
    }

    JSC::call(globalObject, job, callData, jsUndefined(), arguments, exceptionPtr);

    if (auto* exception = exceptionPtr.get()) {
        Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
    }

    return JSValue::encode(jsUndefined());
}

extern "C" EncodedJSValue Bun__DNSResolver__lookup(JSGlobalObject*, JSC::CallFrame*);

JSC_DEFINE_HOST_FUNCTION(jsFunctionPerformMicrotaskVariadic, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto job = callframe->argument(0);
    if (!job || job.isUndefinedOrNull()) {
        return JSValue::encode(jsUndefined());
    }

    auto callData = JSC::getCallData(job);
    MarkedArgumentBuffer arguments;
    if (UNLIKELY(callData.type == CallData::Type::None)) {
        return JSValue::encode(jsUndefined());
    }

    JSArray* array = jsCast<JSArray*>(callframe->argument(1));
    unsigned length = array->length();
    for (unsigned i = 0; i < length; i++) {
        arguments.append(array->getIndex(globalObject, i));
    }

    JSValue result;
    WTF::NakedPtr<JSC::Exception> exceptionPtr;
    JSValue thisValue = jsUndefined();

    if (callframe->argumentCount() > 2) {
        thisValue = callframe->argument(2);
    }

    JSC::call(globalObject, job, callData, thisValue, arguments, exceptionPtr);

    if (auto* exception = exceptionPtr.get()) {
        Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
    }

    return JSValue::encode(jsUndefined());
}

void GlobalObject::createCallSitesFromFrames(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ObjectInitializationScope& objectScope, JSCStackTrace& stackTrace, JSC::JSArray* callSites)
{
    /* From v8's "Stack Trace API" (https://github.com/v8/v8/wiki/Stack-Trace-API):
     * "To maintain restrictions imposed on strict mode functions, frames that have a
     * strict mode function and all frames below (its caller etc.) are not allow to access
     * their receiver and function objects. For those frames, getFunction() and getThis()
     * will return undefined."." */
    bool encounteredStrictFrame = false;
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);

    JSC::Structure* callSiteStructure = globalObject->callSiteStructure();
    JSC::IndexingType callSitesIndexingType = callSites->indexingType();
    size_t framesCount = stackTrace.size();
    for (size_t i = 0; i < framesCount; i++) {
        /* Note that we're using initializeIndex and not callSites->butterfly()->contiguous().data()
         * directly, since if we're "having a bad time" (globalObject->isHavingABadTime()),
         * the array won't be contiguous, but a "slow put" array.
         * See https://github.com/WebKit/webkit/commit/1c4a32c94c1f6c6aa35cf04a2b40c8fe29754b8e for more info
         * about what's a "bad time". */
        CallSite* callSite = CallSite::create(lexicalGlobalObject, callSiteStructure, stackTrace.at(i), encounteredStrictFrame);
        callSites->initializeIndex(objectScope, i, callSite, callSitesIndexingType);

        if (!encounteredStrictFrame) {
            encounteredStrictFrame = callSite->isStrict();
        }
    }
}

JSC::JSValue GlobalObject::formatStackTrace(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites, ZigStackFrame remappedStackFrames[])
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue errorValue = this->get(this, JSC::Identifier::fromString(vm, "Error"_s));
    if (UNLIKELY(scope.exception())) {
        return JSValue();
    }

    if (!errorValue || errorValue.isUndefined() || !errorValue.isObject()) {
        return JSValue(jsEmptyString(vm));
    }

    auto* errorConstructor = jsDynamicCast<JSC::JSObject*>(errorValue);

    /* If the user has set a callable Error.prepareStackTrace - use it to format the stack trace. */
    JSC::JSValue prepareStackTrace = errorConstructor->getIfPropertyExists(lexicalGlobalObject, JSC::Identifier::fromString(vm, "prepareStackTrace"_s));
    if (prepareStackTrace && prepareStackTrace.isCallable()) {
        JSC::CallData prepareStackTraceCallData = JSC::getCallData(prepareStackTrace);

        if (prepareStackTraceCallData.type != JSC::CallData::Type::None) {
            JSC::MarkedArgumentBuffer arguments;
            arguments.append(errorObject);
            arguments.append(callSites);
            ASSERT(!arguments.hasOverflowed());

            JSC::JSValue result = profiledCall(
                lexicalGlobalObject,
                JSC::ProfilingReason::Other,
                prepareStackTrace,
                prepareStackTraceCallData,
                errorConstructor,
                arguments);
            RETURN_IF_EXCEPTION(scope, JSC::jsUndefined());
            return result;
        }
    }

    // default formatting
    size_t framesCount = callSites->length();

    WTF::StringBuilder sb;
    if (JSC::JSValue errorMessage = errorObject->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->message)) {
        sb.append("Error: "_s);
        sb.append(errorMessage.getString(lexicalGlobalObject));
    } else {
        sb.append("Error"_s);
    }

    if (framesCount > 0) {
        sb.append("\n"_s);
    }

    for (size_t i = 0; i < framesCount; i++) {
        JSC::JSValue callSiteValue = callSites->getIndex(lexicalGlobalObject, i);
        CallSite* callSite = JSC::jsDynamicCast<CallSite*>(callSiteValue);

        JSString* typeName = jsTypeStringForValue(lexicalGlobalObject, callSite->thisValue());
        JSString* function = callSite->functionName().toString(lexicalGlobalObject);
        JSString* functionName = callSite->functionName().toString(lexicalGlobalObject);
        JSString* sourceURL = callSite->sourceURL().toString(lexicalGlobalObject);
        JSString* columnNumber = remappedStackFrames[i].position.column_start >= 0 ? jsNontrivialString(vm, String::number(remappedStackFrames[i].position.column_start)) : jsEmptyString(vm);
        JSString* lineNumber = remappedStackFrames[i].position.line >= 0 ? jsNontrivialString(vm, String::number(remappedStackFrames[i].position.line)) : jsEmptyString(vm);
        bool isConstructor = callSite->isConstructor();

        sb.append("    at "_s);
        if (functionName->length() > 0) {
            if (isConstructor) {
                sb.append("new "_s);
            } else {
                // TODO: print type or class name if available
                // sb.append(typeName->getString(lexicalGlobalObject));
                // sb.append(" "_s);
            }
            sb.append(functionName->getString(lexicalGlobalObject));
        } else {
            sb.append("<anonymous>"_s);
        }
        sb.append(" ("_s);
        if (callSite->isNative()) {
            sb.append("native"_s);
        } else {
            sb.append(sourceURL->getString(lexicalGlobalObject));
            sb.append(":"_s);
            sb.append(lineNumber->getString(lexicalGlobalObject));
            sb.append(":"_s);
            sb.append(columnNumber->getString(lexicalGlobalObject));
        }
        sb.append(")"_s);
        if (i != framesCount - 1) {
            sb.append("\n"_s);
        }
    }

    return JSC::JSValue(jsString(vm, sb.toString()));
}

extern "C" void Bun__remapStackFramePositions(JSC::JSGlobalObject*, ZigStackFrame*, size_t);

JSC_DECLARE_HOST_FUNCTION(errorConstructorFuncCaptureStackTrace);
JSC_DEFINE_HOST_FUNCTION(errorConstructorFuncCaptureStackTrace, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue objectArg = callFrame->argument(0);
    if (!objectArg.isObject()) {
        return JSC::JSValue::encode(throwTypeError(lexicalGlobalObject, scope, "invalid_argument"_s));
    }

    JSC::JSObject* errorObject = objectArg.asCell()->getObject();
    JSC::JSValue caller = callFrame->argument(1);

    JSValue errorValue = lexicalGlobalObject->get(lexicalGlobalObject, vm.propertyNames->Error);
    auto* errorConstructor = jsDynamicCast<JSC::JSObject*>(errorValue);

    size_t stackTraceLimit = DEFAULT_ERROR_STACK_TRACE_LIMIT;
    if (JSC::JSValue stackTraceLimitProp = errorConstructor->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->stackTraceLimit)) {
        if (stackTraceLimitProp.isNumber()) {
            stackTraceLimit = std::min(std::max(static_cast<size_t>(stackTraceLimitProp.toIntegerOrInfinity(lexicalGlobalObject)), 0ul), 2048ul);
            if (stackTraceLimit == 0) {
                stackTraceLimit = 2048;
            }
        }
    }
    JSCStackTrace stackTrace = JSCStackTrace::captureCurrentJSStackTrace(globalObject, callFrame, stackTraceLimit, caller);

    // Create an (uninitialized) array for our "call sites"
    JSC::GCDeferralContext deferralContext(vm);
    JSC::ObjectInitializationScope objectScope(vm);
    JSC::JSArray* callSites = JSC::JSArray::tryCreateUninitializedRestricted(objectScope,
        &deferralContext,
        globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
        stackTrace.size());
    RELEASE_ASSERT(callSites);

    // Create the call sites (one per frame)
    GlobalObject::createCallSitesFromFrames(lexicalGlobalObject, objectScope, stackTrace, callSites);

    /* Foramt the stack trace.
     * Note that v8 won't actually format the stack trace here, but will create a "stack" accessor
     * on the error object, which will format the stack trace on the first access. For now, since
     * we're not being used internally by JSC, we can assume callers of Error.captureStackTrace in
     * node are interested in the (formatted) stack. */

    size_t framesCount = stackTrace.size();
    ZigStackFrame remappedFrames[framesCount];
    for (int i = 0; i < framesCount; i++) {
        remappedFrames[i].source_url = Zig::toZigString(stackTrace.at(i).sourceURL(), lexicalGlobalObject);
        if (JSCStackFrame::SourcePositions* sourcePositions = stackTrace.at(i).getSourcePositions()) {
            remappedFrames[i].position.line = sourcePositions->line.zeroBasedInt();
            remappedFrames[i].position.column_start = sourcePositions->startColumn.zeroBasedInt() + 1;
        } else {
            remappedFrames[i].position.line = -1;
            remappedFrames[i].position.column_start = -1;
        }
    }

    // remap line and column start to original source
    Bun__remapStackFramePositions(lexicalGlobalObject, remappedFrames, framesCount);

    JSC::JSValue formattedStackTrace = globalObject->formatStackTrace(vm, lexicalGlobalObject, errorObject, callSites, remappedFrames);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));

    if (errorObject->hasProperty(lexicalGlobalObject, vm.propertyNames->stack)) {
        errorObject->deleteProperty(lexicalGlobalObject, vm.propertyNames->stack);
    }
    if (formattedStackTrace.isUndefinedOrNull()) {
        errorObject->putDirect(vm, vm.propertyNames->stack, jsUndefined(), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    } else {
        errorObject->putDirect(vm, vm.propertyNames->stack, formattedStackTrace.toString(lexicalGlobalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    }

    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSValue {}));

    return JSC::JSValue::encode(JSC::jsUndefined());
}

void GlobalObject::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    // Change prototype from null to object for synthetic modules.
    m_moduleNamespaceObjectStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(JSModuleNamespaceObject::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });

    m_JSBufferSubclassStructure.initLater(
        [](const Initializer<Structure>& init) {
            auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(init.owner);
            auto clientData = WebCore::clientData(init.vm);

            auto* baseStructure = globalObject->typedArrayStructure(JSC::TypeUint8, false);
            JSC::Structure* subclassStructure = JSC::InternalFunction::createSubclassStructure(globalObject, globalObject->JSBufferConstructor(), baseStructure);
            init.set(subclassStructure);
        });
    m_performMicrotaskFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 4, "performMicrotask"_s, jsFunctionPerformMicrotask, ImplementationVisibility::Public));
        });
    m_emitReadableNextTickFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 4, "emitReadable"_s, WebCore::jsReadable_emitReadable_, ImplementationVisibility::Public));
        });

    m_performMicrotaskVariadicFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 4, "performMicrotaskVariadic"_s, jsFunctionPerformMicrotaskVariadic, ImplementationVisibility::Public));
        });

    m_navigatorObject.initLater(
        [](const Initializer<JSObject>& init) {
            int cpuCount = 0;
#ifdef __APPLE__
            size_t count_len = sizeof(cpuCount);
            sysctlbyname("hw.logicalcpu", &cpuCount, &count_len, NULL, 0);
#else
            // TODO: windows
            cpuCount = sysconf(_SC_NPROCESSORS_ONLN);
#endif

            auto str = WTF::String::fromUTF8(Bun__userAgent);
            JSC::Identifier userAgentIdentifier = JSC::Identifier::fromString(init.vm, "userAgent"_s);
            JSC::Identifier hardwareConcurrencyIdentifier = JSC::Identifier::fromString(init.vm, "hardwareConcurrency"_s);

            JSC::JSObject* obj = JSC::constructEmptyObject(init.owner, init.owner->objectPrototype(), 3);
            obj->putDirect(init.vm, userAgentIdentifier, JSC::jsString(init.vm, str));
            obj->putDirect(init.vm, init.vm.propertyNames->toStringTagSymbol,
                jsNontrivialString(init.vm, "Navigator"_s), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);

            obj->putDirect(init.vm, hardwareConcurrencyIdentifier, JSC::jsNumber(cpuCount));
            init.set(
                obj);
        });

    this->m_pendingVirtualModuleResultStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(Bun::PendingVirtualModuleResult::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });

    this->initGeneratedLazyClasses();

    m_subtleCryptoObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto& global = *reinterpret_cast<Zig::GlobalObject*>(init.owner);
            if (global.crypto == nullptr) {
                global.crypto = WebCore::SubtleCrypto::createPtr(global.scriptExecutionContext());
                global.crypto->ref();
            }

            init.set(
                toJS<IDLInterface<SubtleCrypto>>(*init.owner, global, global.crypto).getObject());
        });

    m_primordialsObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto& global = *reinterpret_cast<Zig::GlobalObject*>(init.owner);
            BunPrimordialsObject* object = BunPrimordialsObject::create(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.owner),
                BunPrimordialsObject::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
            init.set(object);
        });

    m_NapiClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            init.setStructure(Zig::NapiClass::createStructure(init.vm, init.global, init.global->functionPrototype()));
        });

    m_JSArrayBufferControllerPrototype.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::ArrayBufferSink);
            init.set(prototype);
        });

    m_JSFileSinkControllerPrototype.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::FileSink);
            init.set(prototype);
        });

    m_JSHTTPResponseController.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto* structure = createJSSinkControllerStructure(init.vm, init.owner, WebCore::SinkID::HTTPResponseSink);
            init.set(structure);
        });

    m_JSHTTPSResponseControllerPrototype.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::HTTPSResponseSink);
            init.set(prototype);
        });

    m_performanceObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            JSPerformanceObject* object = JSPerformanceObject::create(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.owner),
                JSPerformanceObject::createStructure(init.vm, init.owner, init.owner->objectPrototype()));

            init.set(object);
        });

    m_processEnvObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            init.set(Bun::createEnvironmentVariablesMap(reinterpret_cast<Zig::GlobalObject*>(init.owner)).getObject());
        });

    m_processObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(init.owner);
            auto* process = Zig::Process::create(
                *globalObject, Zig::Process::createStructure(init.vm, init.owner, WebCore::JSEventEmitter::prototype(init.vm, *globalObject)));
            process->putDirectCustomAccessor(init.vm, JSC::Identifier::fromString(init.vm, "env"_s),
                JSC::CustomGetterSetter::create(init.vm, lazyProcessEnvGetter, lazyProcessEnvSetter),
                JSC::PropertyAttribute::DontDelete
                    | JSC::PropertyAttribute::CustomValue
                    | 0);
            init.set(process);
        });

    m_lazyReadableStreamPrototypeMap.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSMap>::Initializer& init) {
            auto* map = JSC::JSMap::create(init.vm, init.owner->mapStructure());
            init.set(map);
        });

    m_requireMap.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSMap>::Initializer& init) {
            auto* map = JSC::JSMap::create(init.vm, init.owner->mapStructure());
            init.set(map);
        });

    m_encodeIntoObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& vm = init.vm;
            auto& globalObject = *init.owner;
            Structure* structure = globalObject.structureCache().emptyObjectStructureForPrototype(&globalObject, globalObject.objectPrototype(), 2);
            PropertyOffset offset;
            auto clientData = WebCore::clientData(vm);
            structure = Structure::addPropertyTransition(vm, structure, clientData->builtinNames().readPublicName(), 0, offset);
            RELEASE_ASSERT(offset == 0);
            structure = Structure::addPropertyTransition(vm, structure, clientData->builtinNames().writtenPublicName(), 0, offset);
            RELEASE_ASSERT(offset == 1);
            init.set(structure);
        });

    m_JSFileSinkClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::FileSink);
            auto* structure = JSFileSink::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSFileSinkConstructor::create(init.vm, init.global, JSFileSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<JSObject*>(prototype));
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_JSArrayBufferSinkClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::ArrayBufferSink);
            auto* structure = JSArrayBufferSink::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSArrayBufferSinkConstructor::create(init.vm, init.global, JSArrayBufferSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<JSObject*>(prototype));
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_JSHTTPResponseSinkClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::HTTPResponseSink);
            auto* structure = JSHTTPResponseSink::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSHTTPResponseSinkConstructor::create(init.vm, init.global, JSHTTPResponseSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<JSObject*>(prototype));
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_JSBufferClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = WebCore::createBufferPrototype(init.vm, init.global);
            auto* structure = WebCore::createBufferStructure(init.vm, init.global, JSValue(prototype));
            auto* constructor = WebCore::createBufferConstructor(init.vm, init.global, jsCast<JSObject*>(prototype));
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_JSHTTPSResponseSinkClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::HTTPSResponseSink);
            auto* structure = JSHTTPSResponseSink::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSHTTPSResponseSinkConstructor::create(init.vm, init.global, JSHTTPSResponseSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<JSObject*>(prototype));
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_JSBufferListClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = JSBufferListPrototype::create(
                init.vm, init.global, JSBufferListPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
            auto* structure = JSBufferList::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSBufferListConstructor::create(
                init.vm, init.global, JSBufferListConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_callSiteStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = CallSitePrototype::create(init.vm, CallSitePrototype::createStructure(init.vm, init.global, init.global->objectPrototype()), init.global);
            auto* structure = CallSite::createStructure(init.vm, init.global, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
        });

    m_JSStringDecoderClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = JSStringDecoderPrototype::create(
                init.vm, init.global, JSStringDecoderPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
            auto* structure = JSStringDecoder::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSStringDecoderConstructor::create(
                init.vm, init.global, JSStringDecoderConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_JSReadableStateClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = JSReadableStatePrototype::create(
                init.vm, init.global, JSReadableStatePrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
            auto* structure = JSReadableState::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSReadableStateConstructor::create(
                init.vm, init.global, JSReadableStateConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    m_JSFFIFunctionStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            init.setStructure(Zig::JSFFIFunction::createStructure(init.vm, init.global, init.global->functionPrototype()));
        });

    addBuiltinGlobals(vm);

#if ENABLE(REMOTE_INSPECTOR)
    setInspectable(false);
#endif

    RELEASE_ASSERT(classInfo());

    JSC::JSObject* errorConstructor = this->errorConstructor();
    errorConstructor->putDirectNativeFunctionWithoutTransition(vm, this, JSC::Identifier::fromString(vm, "captureStackTrace"_s), 2, errorConstructorFuncCaptureStackTrace, ImplementationVisibility::Public, JSC::NoIntrinsic, PropertyAttribute::DontEnum | 0);

    // JSC default is 100
    errorConstructor->putDirect(vm, vm.propertyNames->stackTraceLimit, jsNumber(DEFAULT_ERROR_STACK_TRACE_LIMIT), JSC::PropertyAttribute::DontEnum | 0);

    JSC::JSValue console = this->get(this, JSC::Identifier::fromString(vm, "console"_s));
    JSC::JSObject* consoleObject = console.getObject();
    consoleObject->putDirectBuiltinFunction(vm, this, vm.propertyNames->asyncIteratorSymbol, consoleObjectAsyncIteratorCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete);
    auto clientData = WebCore::clientData(vm);
    consoleObject->putDirectBuiltinFunction(vm, this, clientData->builtinNames().writePublicName(), consoleObjectWriteCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
}

JSC_DEFINE_HOST_FUNCTION(functionBunPeek,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue promiseValue = callFrame->argument(0);
    if (UNLIKELY(!promiseValue)) {
        return JSValue::encode(jsUndefined());
    } else if (!promiseValue.isCell()) {
        return JSValue::encode(promiseValue);
    }

    auto* promise = jsDynamicCast<JSPromise*>(promiseValue);

    if (!promise) {
        return JSValue::encode(promiseValue);
    }

    JSValue invalidateValue = callFrame->argument(1);
    bool invalidate = invalidateValue.isBoolean() && invalidateValue.asBoolean();

    switch (promise->status(vm)) {
    case JSPromise::Status::Pending: {
        break;
    }
    case JSPromise::Status::Fulfilled: {
        JSValue result = promise->result(vm);
        if (invalidate) {
            promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, jsUndefined());
        }
        return JSValue::encode(result);
    }
    case JSPromise::Status::Rejected: {
        JSValue result = promise->result(vm);
        JSC::EnsureStillAliveScope ensureStillAliveScope(result);

        if (invalidate) {
            promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32() | JSC::JSPromise::isHandledFlag));
            promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, JSC::jsUndefined());
        }

        return JSValue::encode(result);
    }
    }

    return JSValue::encode(promiseValue);
}

JSC_DEFINE_HOST_FUNCTION(functionBunPeekStatus,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    static NeverDestroyed<String> fulfilled = MAKE_STATIC_STRING_IMPL("fulfilled");

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue promiseValue = callFrame->argument(0);
    if (!promiseValue || !promiseValue.isCell()) {
        return JSValue::encode(jsOwnedString(vm, fulfilled));
    }

    auto* promise = jsDynamicCast<JSPromise*>(promiseValue);

    if (!promise) {
        return JSValue::encode(jsOwnedString(vm, fulfilled));
    }

    switch (promise->status(vm)) {
    case JSPromise::Status::Pending: {
        static NeverDestroyed<String> pending = MAKE_STATIC_STRING_IMPL("pending");
        return JSValue::encode(jsOwnedString(vm, pending));
    }
    case JSPromise::Status::Fulfilled: {
        return JSValue::encode(jsOwnedString(vm, fulfilled));
    }
    case JSPromise::Status::Rejected: {
        static NeverDestroyed<String> rejected = MAKE_STATIC_STRING_IMPL("rejected");
        return JSValue::encode(jsOwnedString(vm, rejected));
    }
    }

    return JSValue::encode(jsUndefined());
}

extern "C" void Bun__setOnEachMicrotaskTick(JSC::VM* vm, void* ptr, void (*callback)(void* ptr))
{
    if (callback == nullptr) {
        vm->setOnEachMicrotaskTick(nullptr);
        return;
    }

    vm->setOnEachMicrotaskTick([=](JSC::VM& vm) {
        callback(ptr);
    });
}

// This implementation works the same as setTimeout(myFunction, 0)
// TODO: make it more efficient
// https://developer.mozilla.org/en-US/docs/Web/API/Window/setImmediate
static JSC_DEFINE_HOST_FUNCTION(functionSetImmediate,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto argCount = callFrame->argumentCount();
    if (argCount == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setImmediate requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setImmediate expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue arguments = {};
    size_t argumentCount = callFrame->argumentCount() - 1;
    if (argumentCount > 0) {
        JSC::ObjectInitializationScope initializationScope(globalObject->vm());
        JSC::JSArray* argumentsArray = JSC::JSArray::tryCreateUninitializedRestricted(
            initializationScope, nullptr,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            argumentCount);

        if (UNLIKELY(!argumentsArray)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        for (size_t i = 0; i < argumentCount; i++) {
            argumentsArray->putDirectIndex(globalObject, i, callFrame->uncheckedArgument(i + 1));
        }
        arguments = JSValue(argumentsArray);
    }
    return Bun__Timer__setTimeout(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(jsNumber(0)), JSValue::encode(arguments));
}

JSC_DEFINE_CUSTOM_GETTER(JSModuleLoader_getter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    return JSValue::encode(globalObject->moduleLoader());
}

EncodedJSValue GlobalObject::assignToStream(JSValue stream, JSValue controller)
{
    JSC::VM& vm = this->vm();
    JSC::JSFunction* function = this->m_assignToStream.get();
    if (!function) {
        function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(readableStreamInternalsAssignToStreamCodeGenerator(vm)), this);
        this->m_assignToStream.set(vm, this, function);
    }

    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto callData = JSC::getCallData(function);
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(stream);
    arguments.append(controller);

    auto result = JSC::call(this, function, callData, JSC::jsUndefined(), arguments);
    if (scope.exception())
        return JSC::JSValue::encode(scope.exception());

    return JSC::JSValue::encode(result);
}

JSC::JSObject* GlobalObject::navigatorObject()
{
    return this->m_navigatorObject.get(this);
}

JSC_DEFINE_CUSTOM_GETTER(functionLazyNavigatorGetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    return JSC::JSValue::encode(reinterpret_cast<Zig::GlobalObject*>(globalObject)->navigatorObject());
}

JSC_DEFINE_HOST_FUNCTION(functionGetDirectStreamDetails, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto argCount = callFrame->argumentCount();
    if (argCount != 1) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    auto stream = callFrame->argument(0);
    if (!stream.isObject()) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    auto* streamObject = stream.getObject();
    auto* readableStream = jsDynamicCast<WebCore::JSReadableStream*>(streamObject);
    if (!readableStream) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    auto clientData = WebCore::clientData(vm);

    JSValue ptrValue = readableStream->get(globalObject, clientData->builtinNames().bunNativePtrPrivateName());
    JSValue typeValue = readableStream->get(globalObject, clientData->builtinNames().bunNativeTypePrivateName());
    auto result = ptrValue.asAnyInt();

    if (result == 0 || !typeValue.isNumber()) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    readableStream->putDirect(vm, clientData->builtinNames().bunNativePtrPrivateName(), jsUndefined(), 0);
    readableStream->putDirect(vm, clientData->builtinNames().bunNativeTypePrivateName(), jsUndefined(), 0);

    auto* resultObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    resultObject->putDirect(vm, clientData->builtinNames().streamPublicName(), ptrValue, 0);
    resultObject->putDirect(vm, clientData->builtinNames().dataPublicName(), typeValue, 0);

    return JSC::JSValue::encode(resultObject);
}

void GlobalObject::addBuiltinGlobals(JSC::VM& vm)
{
    m_builtinInternalFunctions.initialize(*this);

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    WTF::Vector<GlobalPropertyInfo> extraStaticGlobals;
    extraStaticGlobals.reserveCapacity(42);

    JSC::Identifier queueMicrotaskIdentifier = JSC::Identifier::fromString(vm, "queueMicrotask"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { queueMicrotaskIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 2,
                "queueMicrotask"_s, functionQueueMicrotask, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { JSC::Identifier::fromString(vm, "setImmediate"_s),
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "setImmediate"_s, functionSetImmediate, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { JSC::Identifier::fromString(vm, "clearImmediate"_s),
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "clearImmediate"_s, functionClearTimeout, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });

    JSC::Identifier setTimeoutIdentifier = JSC::Identifier::fromString(vm, "setTimeout"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { setTimeoutIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "setTimeout"_s, functionSetTimeout, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });

    JSC::Identifier clearTimeoutIdentifier = JSC::Identifier::fromString(vm, "clearTimeout"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { clearTimeoutIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "clearTimeout"_s, functionClearTimeout, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });

    JSC::Identifier setIntervalIdentifier = JSC::Identifier::fromString(vm, "setInterval"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { setIntervalIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "setInterval"_s, functionSetInterval, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });

    JSC::Identifier clearIntervalIdentifier = JSC::Identifier::fromString(vm, "clearInterval"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { clearIntervalIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "clearInterval"_s, functionClearInterval, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });

    JSC::Identifier atobIdentifier = JSC::Identifier::fromString(vm, "atob"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { atobIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "atob"_s, functionATOB, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });

    JSC::Identifier btoaIdentifier = JSC::Identifier::fromString(vm, "btoa"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { btoaIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "btoa"_s, functionBTOA, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });
    JSC::Identifier reportErrorIdentifier = JSC::Identifier::fromString(vm, "reportError"_s);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { reportErrorIdentifier,
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                "reportError"_s, functionReportError, ImplementationVisibility::Public),
            JSC::PropertyAttribute::DontDelete | 0 });

    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { builtinNames.startDirectStreamPrivateName(),
            JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
                String(), functionStartDirectStream, ImplementationVisibility::Public),
            JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0 });

    static NeverDestroyed<const String> BunLazyString(MAKE_STATIC_STRING_IMPL("Bun.lazy"));
    static NeverDestroyed<const String> CommonJSSymbolKey(MAKE_STATIC_STRING_IMPL("CommonJS"));
    JSC::Identifier BunLazyIdentifier = JSC::Identifier::fromUid(vm.symbolRegistry().symbolForKey(BunLazyString));
    JSC::JSFunction* lazyLoadFunction = JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
        BunLazyString, functionLazyLoad, ImplementationVisibility::Public);
    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { BunLazyIdentifier,
            lazyLoadFunction,
            JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function | 0 });

    extraStaticGlobals.uncheckedAppend(
        GlobalPropertyInfo { builtinNames.lazyLoadPrivateName(),
            lazyLoadFunction,
            JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function | 0 });

    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.makeThisTypeErrorPrivateName(), JSFunction::create(vm, this, 2, String(), makeThisTypeErrorForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.makeGetterTypeErrorPrivateName(), JSFunction::create(vm, this, 2, String(), makeGetterTypeErrorForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.makeDOMExceptionPrivateName(), JSFunction::create(vm, this, 2, String(), makeDOMExceptionForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.whenSignalAbortedPrivateName(), JSFunction::create(vm, this, 2, String(), whenSignalAborted, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.cloneArrayBufferPrivateName(), JSFunction::create(vm, this, 3, String(), cloneArrayBuffer, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.structuredCloneForStreamPrivateName(), JSFunction::create(vm, this, 1, String(), structuredCloneForStream, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.streamClosedPrivateName(), jsNumber(1), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::ConstantInteger));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.streamClosingPrivateName(), jsNumber(2), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::ConstantInteger));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.streamErroredPrivateName(), jsNumber(3), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::ConstantInteger));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.streamReadablePrivateName(), jsNumber(4), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::ConstantInteger));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.streamWaitingPrivateName(), jsNumber(5), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::ConstantInteger));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.streamWritablePrivateName(), jsNumber(6), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::ConstantInteger));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.isAbortSignalPrivateName(), JSFunction::create(vm, this, 1, String(), isAbortSignal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.getInternalWritableStreamPrivateName(), JSFunction::create(vm, this, 1, String(), getInternalWritableStream, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.createWritableStreamFromInternalPrivateName(), JSFunction::create(vm, this, 1, String(), createWritableStreamFromInternal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.fulfillModuleSyncPrivateName(), JSFunction::create(vm, this, 1, String(), functionFulfillModuleSync, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::Function));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.commonJSSymbolPrivateName(), JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(CommonJSSymbolKey)), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(builtinNames.directPrivateName(), JSFunction::create(vm, this, 1, String(), functionGetDirectStreamDetails, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::Function));
    extraStaticGlobals.uncheckedAppend(GlobalPropertyInfo(vm.propertyNames->builtinNames().ArrayBufferPrivateName(), arrayBufferConstructor(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));

    this->addStaticGlobals(extraStaticGlobals.data(), extraStaticGlobals.size());

    extraStaticGlobals.releaseBuffer();

    putDirectBuiltinFunction(vm, this, builtinNames.createFIFOPrivateName(), streamInternalsCreateFIFOCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.createEmptyReadableStreamPrivateName(), readableStreamCreateEmptyReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.consumeReadableStreamPrivateName(), readableStreamConsumeReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    putDirect(vm, builtinNames.LoaderPrivateName(), this->moduleLoader(), 0);
    putDirectBuiltinFunction(vm, this, builtinNames.createNativeReadableStreamPrivateName(), readableStreamCreateNativeReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    putDirectBuiltinFunction(vm, this, builtinNames.requireESMPrivateName(), importMetaObjectRequireESMCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.requirePrivateName(), importMetaObjectRequireCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.loadCJS2ESMPrivateName(), importMetaObjectLoadCJS2ESMCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectNativeFunction(vm, this, builtinNames.createUninitializedArrayBufferPrivateName(), 1, functionCreateUninitializedArrayBuffer, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::Function);
    putDirectNativeFunction(vm, this, builtinNames.resolveSyncPrivateName(), 1, functionImportMeta__resolveSync, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::Function);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "process"_s), JSC::CustomGetterSetter::create(vm, property_lazyProcessGetter, property_lazyProcessSetter),
        JSC::PropertyAttribute::CustomAccessor | 0);

    putDirect(vm, JSC::Identifier::fromString(vm, "performance"_s), this->performanceObject(),
        0);

    putDirect(vm, JSC::Identifier::fromString(vm, "self"_s), this->globalThis(), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | 0);
    putDirect(vm, JSC::Identifier::fromString(vm, "global"_s), this->globalThis(), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "URL"_s), JSC::CustomGetterSetter::create(vm, JSDOMURL_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, builtinNames.lazyStreamPrototypeMapPrivateName(), JSC::CustomGetterSetter::create(vm, functionLazyLoadStreamPrototypeMap_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "navigator"_s), JSC::CustomGetterSetter::create(vm, functionLazyNavigatorGetter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

    putDirect(vm, builtinNames.requireMapPrivateName(), this->requireMap(),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "Request"_s), JSC::CustomGetterSetter::create(vm, JSRequest_getter, JSRequest_setter),
        JSC::PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "Response"_s), JSC::CustomGetterSetter::create(vm, JSResponse_getter, JSResponse_setter),
        JSC::PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "TextDecoder"_s), JSC::CustomGetterSetter::create(vm, JSTextDecoder_getter, JSTextDecoder_setter),
        JSC::PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "Blob"_s), JSC::CustomGetterSetter::create(vm, JSBlob_getter, JSBlob_setter),
        JSC::PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "DOMException"_s), JSC::CustomGetterSetter::create(vm, JSDOMException_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "Event"_s), JSC::CustomGetterSetter::create(vm, JSEvent_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "EventTarget"_s), JSC::CustomGetterSetter::create(vm, JSEventTarget_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "AbortController"_s), JSC::CustomGetterSetter::create(vm, JSDOMAbortController_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "AbortSignal"_s), JSC::CustomGetterSetter::create(vm, JSDOMAbortSignal_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "CustomEvent"_s), JSC::CustomGetterSetter::create(vm, JSCustomEvent_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "ErrorEvent"_s), JSC::CustomGetterSetter::create(vm, JSErrorEvent_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "CloseEvent"_s), JSC::CustomGetterSetter::create(vm, JSCloseEvent_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "Buffer"_s), JSC::CustomGetterSetter::create(vm, JSBuffer_getter, nullptr),
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    PUT_WEBCORE_GENERATED_CONSTRUCTOR("TextEncoder"_s, JSTextEncoder);
    PUT_WEBCORE_GENERATED_CONSTRUCTOR("MessageEvent"_s, JSMessageEvent);
    PUT_WEBCORE_GENERATED_CONSTRUCTOR("WebSocket"_s, JSWebSocket);
    PUT_WEBCORE_GENERATED_CONSTRUCTOR("Headers"_s, JSFetchHeaders);
    PUT_WEBCORE_GENERATED_CONSTRUCTOR("URLSearchParams"_s, JSURLSearchParams);

    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().TransformStreamPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_TransformStreamConstructor, nullptr), attributesForStructure(static_cast<unsigned>(JSC::PropertyAttribute::DontEnum)));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().TransformStreamPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_TransformStreamConstructor, nullptr), attributesForStructure(static_cast<unsigned>(JSC::PropertyAttribute::DontEnum)));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().TransformStreamDefaultControllerPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_TransformStreamDefaultControllerConstructor, nullptr), attributesForStructure(static_cast<unsigned>(JSC::PropertyAttribute::DontEnum)));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().TransformStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_TransformStreamDefaultControllerConstructor, nullptr), attributesForStructure(static_cast<unsigned>(JSC::PropertyAttribute::DontEnum)));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableByteStreamControllerPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableByteStreamControllerConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamBYOBReaderPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamBYOBReaderConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamBYOBRequestPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamBYOBRequestConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamDefaultControllerConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamDefaultReaderPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamDefaultReaderConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().WritableStreamPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_WritableStreamConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().WritableStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_WritableStreamDefaultControllerConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().WritableStreamDefaultWriterPrivateName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_WritableStreamDefaultWriterConstructor, nullptr), attributesForStructure(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().AbortSignalPrivateName(), CustomGetterSetter::create(vm, JSDOMAbortSignal_getter, nullptr), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().TransformStreamDefaultControllerPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_TransformStreamDefaultControllerConstructor, nullptr), static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontEnum));
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableByteStreamControllerPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableByteStreamControllerConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamBYOBReaderPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamBYOBReaderConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamBYOBRequestPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamBYOBRequestConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamDefaultControllerPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamDefaultControllerConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().ReadableStreamDefaultReaderPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ReadableStreamDefaultReaderConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().WritableStreamPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_WritableStreamConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().WritableStreamDefaultControllerPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_WritableStreamDefaultControllerConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().WritableStreamDefaultWriterPublicName(), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_WritableStreamDefaultWriterConstructor, nullptr), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "ByteLengthQueuingStrategy"_s), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_ByteLengthQueuingStrategyConstructor, nullptr), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "CountQueuingStrategy"_s), CustomGetterSetter::create(vm, jsServiceWorkerGlobalScope_CountQueuingStrategyConstructor, nullptr), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "SubtleCrypto"_s), JSC::CustomGetterSetter::create(vm, getterSubtleCryptoConstructor, nullptr), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "CryptoKey"_s), JSC::CustomGetterSetter::create(vm, getterCryptoKeyConstructor, nullptr), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

// We set it in here since it's a global
extern "C" void Crypto__randomUUID__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value);
extern "C" void Crypto__getRandomValues__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value);

// This is not a publicly exposed API currently.
// This is used by the bundler to make Response, Request, FetchEvent,
// and any other objects available globally.
void GlobalObject::installAPIGlobals(JSClassRef* globals, int count, JSC::VM& vm)
{
    auto clientData = WebCore::clientData(vm);
    size_t constructor_count = 0;
    auto& builtinNames = clientData->builtinNames();
    JSC__JSValue const* constructors = Zig__getAPIConstructors(&constructor_count, this);
    WTF::Vector<GlobalPropertyInfo> extraStaticGlobals;
    extraStaticGlobals.reserveCapacity((size_t)count + constructor_count + 3 + 1 + 1);
    int i = 0;
    for (; i < constructor_count; i++) {
        auto* object = JSC::jsDynamicCast<JSC::JSCallbackConstructor*>(JSC::JSValue::decode(constructors[i]).asCell()->getObject());

        extraStaticGlobals.uncheckedAppend(
            GlobalPropertyInfo { JSC::Identifier::fromString(vm, object->get(this, vm.propertyNames->name).toWTFString(this)),
                JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0 });
    }
    int j = 0;
    {
        // first one is Bun object
        auto jsClass = globals[j];

        JSC::JSCallbackObject<JSNonFinalObject>* object = JSC::JSCallbackObject<JSNonFinalObject>::create(this, this->callbackObjectStructure(),
            jsClass, nullptr);
        if (JSObject* prototype = object->classRef()->prototype(this))
            object->setPrototypeDirect(vm, prototype);

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "escapeHTML"_s);
            static ClassInfo escapeHTMLClassInfo = *object->classInfo();
            static const JSC::DOMJIT::Signature DOMJITSignatureForEscapeHTML(
                functionBunEscapeHTMLWithoutTypeCheck,
                object->classInfo(),
                JSC::DOMJIT::Effect::forPure(),
                SpecString,
                SpecString);
            object->putDirectNativeFunction(vm, this, identifier, 1, functionBunEscapeHTML, ImplementationVisibility::Public, NoIntrinsic, &DOMJITSignatureForEscapeHTML,
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "peek"_s);
            JSFunction* peekFunction = JSFunction::create(vm, this, 2, WTF::String("peek"_s), functionBunPeek, ImplementationVisibility::Public, NoIntrinsic);
            JSFunction* peekStatus = JSFunction::create(vm, this, 1, WTF::String("status"_s), functionBunPeekStatus, ImplementationVisibility::Public, NoIntrinsic);
            peekFunction->putDirect(vm, PropertyName(JSC::Identifier::fromString(vm, "status"_s)), peekStatus, JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
            object->putDirect(vm, PropertyName(identifier), JSValue(peekFunction),
                JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "readableStreamToArrayBuffer"_s);
            object->putDirectBuiltinFunction(vm, this, identifier, readableStreamReadableStreamToArrayBufferCodeGenerator(vm),
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "readableStreamToText"_s);
            object->putDirectBuiltinFunction(vm, this, identifier, readableStreamReadableStreamToTextCodeGenerator(vm),
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "readableStreamToBlob"_s);
            object->putDirectBuiltinFunction(vm, this, identifier, readableStreamReadableStreamToBlobCodeGenerator(vm),
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "readableStreamToArray"_s);
            object->putDirectBuiltinFunction(vm, this, identifier, readableStreamReadableStreamToArrayCodeGenerator(vm),
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "readableStreamToJSON"_s);
            object->putDirectBuiltinFunction(vm, this, identifier, readableStreamReadableStreamToJSONCodeGenerator(vm),
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "concatArrayBuffers"_s);
            object->putDirectNativeFunction(vm, this, identifier, 1, functionConcatTypedArrays, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "ArrayBufferSink"_s);
            object->putDirectCustomAccessor(vm, identifier, JSC::CustomGetterSetter::create(vm, functionArrayBufferSink__getter, nullptr),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "nanoseconds"_s);
            object->putDirectNativeFunction(vm, this, identifier, 1, functionBunNanoseconds, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "deepEquals"_s);
            object->putDirectNativeFunction(vm, this, identifier, 2, functionBunDeepEquals, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {

            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "version"_s);
            object->putDirect(vm, PropertyName(identifier), JSC::jsOwnedString(vm, makeString(Bun__version + 1)),
                JSC::PropertyAttribute::DontDelete | 0);
        }

        {

            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "revision"_s);
            object->putDirect(vm, PropertyName(identifier), JSC::jsOwnedString(vm, makeString(Bun__version_sha)),
                JSC::PropertyAttribute::DontDelete | 0);
        }

        {

            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "env"_s);
            object->putDirectCustomAccessor(vm, identifier,
                JSC::CustomGetterSetter::create(vm, lazyProcessEnvGetter, lazyProcessEnvSetter),
                JSC::PropertyAttribute::DontDelete
                    | JSC::PropertyAttribute::CustomValue
                    | 0);
        }

        {

            JSC::Identifier identifier = JSC::Identifier::fromString(vm, pathToFileURLString);
            object->putDirectNativeFunction(vm, this, identifier, 1, functionPathToFileURL, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, fileURLToPathString);
            object->putDirectNativeFunction(vm, this, identifier, 1, functionFileURLToPath, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "stringHashCode"_s);
            object->putDirectNativeFunction(vm, this, identifier, 1, functionHashCode, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "dns"_s);
            JSC::JSObject* dnsObject = JSC::constructEmptyObject(this);
            dnsObject->putDirectNativeFunction(vm, this, JSC::Identifier::fromString(vm, "lookup"_s), 2, Bun__DNSResolver__lookup, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
            object->putDirect(vm, PropertyName(identifier), dnsObject, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        }

        {
            JSC::Identifier identifier = JSC::Identifier::fromString(vm, "plugin"_s);
            JSFunction* pluginFunction = JSFunction::create(vm, this, 1, String("plugin"_s), jsFunctionBunPlugin, ImplementationVisibility::Public, NoIntrinsic);
            pluginFunction->putDirectNativeFunction(vm, this, JSC::Identifier::fromString(vm, "clearAll"_s), 1, jsFunctionBunPluginClear, ImplementationVisibility::Public, NoIntrinsic,
                JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
            object->putDirect(vm, PropertyName(identifier), pluginFunction, JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete | 0);
        }

        extraStaticGlobals.uncheckedAppend(
            GlobalPropertyInfo { builtinNames.BunPublicName(),
                JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0 });
        extraStaticGlobals.uncheckedAppend(
            GlobalPropertyInfo { builtinNames.BunPrivateName(),
                JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0 });
    }

    {
        j = 1;
        auto jsClass = globals[j];

        JSC::JSCallbackObject<JSNonFinalObject>* object = JSC::JSCallbackObject<JSNonFinalObject>::create(this, this->callbackObjectStructure(),
            jsClass, nullptr);
        if (JSObject* prototype = object->classRef()->prototype(this))
            object->setPrototypeDirect(vm, prototype);

        Crypto__getRandomValues__put(this, JSValue::encode(object));
        Crypto__randomUUID__put(this, JSValue::encode(object));
        Crypto__timingSafeEqual__put(this, JSValue::encode(object));
        object->putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "subtle"_s), JSC::CustomGetterSetter::create(vm, getterSubtleCrypto, nullptr),
            JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        this->putDirect(vm, JSC::Identifier::fromString(vm, "crypto"_s), object, JSC::PropertyAttribute::DontDelete | 0);
    }

    for (j = 2; j < count; j++) {
        auto jsClass = globals[j];

        JSC::JSCallbackObject<JSNonFinalObject>* object = JSC::JSCallbackObject<JSNonFinalObject>::create(this, this->callbackObjectStructure(),
            jsClass, nullptr);
        if (JSObject* prototype = object->classRef()->prototype(this))
            object->setPrototypeDirect(vm, prototype);

        this->putDirect(vm, JSC::Identifier::fromString(vm, jsClass->className()), JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0);
    }

    // // The last one must be "process.env"
    // // Runtime-support is for if they change
    // {
    //   auto jsClass = globals[i];

    //   JSC::JSCallbackObject<JSNonFinalObject> *object =
    //     JSC::JSCallbackObject<JSNonFinalObject>::create(this, this->callbackObjectStructure(),
    //                                                     jsClass, nullptr);
    //   if (JSObject *prototype = jsClass->prototype(this)) object->setPrototypeDirect(vm,
    //   prototype);

    //   process->putDirect(this->vm, JSC::Identifier::fromString(this->vm, "env"),
    //                      JSC::JSValue(object), JSC::PropertyAttribute::DontDelete | 0);
    // }

    this->addStaticGlobals(extraStaticGlobals.data(), extraStaticGlobals.size());

    // putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "SQL"_s), JSC::CustomGetterSetter::create(vm, JSSQLStatement_getter, nullptr),
    //     JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    extraStaticGlobals.releaseBuffer();
}

extern "C" bool JSC__JSGlobalObject__startRemoteInspector(JSC__JSGlobalObject* globalObject, unsigned char* host, uint16_t arg1)
{
#if !ENABLE(REMOTE_INSPECTOR)
    return false;
#else
    globalObject->setInspectable(true);
    auto& server = Inspector::RemoteInspectorServer::singleton();
    return server.start(reinterpret_cast<const char*>(host), arg1);
#endif
}

template<typename Visitor>
void GlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    GlobalObject* thisObject = jsCast<GlobalObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    {
        // The GC thread has to grab the GC lock even though it is not mutating the containers.
        Locker locker { thisObject->m_gcLock };

        for (auto& structure : thisObject->m_structures.values())
            visitor.append(structure);

        for (auto& guarded : thisObject->m_guardedObjects)
            guarded->visitAggregate(visitor);
    }

    for (auto& constructor : thisObject->constructors().array())
        visitor.append(constructor);

    thisObject->m_builtinInternalFunctions.visit(visitor);

    visitor.append(thisObject->m_assignToStream);
    visitor.append(thisObject->m_readableStreamToArrayBuffer);
    visitor.append(thisObject->m_readableStreamToArrayBufferResolve);
    visitor.append(thisObject->m_readableStreamToBlob);
    visitor.append(thisObject->m_readableStreamToJSON);
    visitor.append(thisObject->m_readableStreamToText);

    visitor.append(thisObject->m_JSTextDecoderSetterValue);
    visitor.append(thisObject->m_JSResponseSetterValue);
    visitor.append(thisObject->m_JSRequestSetterValue);
    visitor.append(thisObject->m_JSBlobSetterValue);
    visitor.append(thisObject->m_JSMessageEventSetterValue);
    visitor.append(thisObject->m_JSBufferSetterValue);
    visitor.append(thisObject->m_JSWebSocketSetterValue);
    visitor.append(thisObject->m_JSFetchHeadersSetterValue);
    visitor.append(thisObject->m_JSTextEncoderSetterValue);
    visitor.append(thisObject->m_JSURLSearchParamsSetterValue);

    thisObject->m_JSArrayBufferSinkClassStructure.visit(visitor);
    thisObject->m_JSBufferListClassStructure.visit(visitor);
    thisObject->m_JSFFIFunctionStructure.visit(visitor);
    thisObject->m_JSFileSinkClassStructure.visit(visitor);
    thisObject->m_JSHTTPResponseSinkClassStructure.visit(visitor);
    thisObject->m_JSHTTPSResponseSinkClassStructure.visit(visitor);
    thisObject->m_JSReadableStateClassStructure.visit(visitor);
    thisObject->m_JSStringDecoderClassStructure.visit(visitor);
    thisObject->m_NapiClassStructure.visit(visitor);
    thisObject->m_JSBufferClassStructure.visit(visitor);

    thisObject->m_pendingVirtualModuleResultStructure.visit(visitor);
    thisObject->m_performMicrotaskFunction.visit(visitor);
    thisObject->m_performMicrotaskVariadicFunction.visit(visitor);
    thisObject->m_lazyReadableStreamPrototypeMap.visit(visitor);
    thisObject->m_requireMap.visit(visitor);
    thisObject->m_encodeIntoObjectStructure.visit(visitor);
    thisObject->m_JSArrayBufferControllerPrototype.visit(visitor);
    thisObject->m_JSFileSinkControllerPrototype.visit(visitor);
    thisObject->m_JSHTTPSResponseControllerPrototype.visit(visitor);
    thisObject->m_navigatorObject.visit(visitor);
    thisObject->m_performanceObject.visit(visitor);
    thisObject->m_primordialsObject.visit(visitor);
    thisObject->m_processEnvObject.visit(visitor);
    thisObject->m_processObject.visit(visitor);
    thisObject->m_subtleCryptoObject.visit(visitor);
    thisObject->m_JSHTTPResponseController.visit(visitor);
    thisObject->m_callSiteStructure.visit(visitor);
    thisObject->m_emitReadableNextTickFunction.visit(visitor);
    thisObject->m_JSBufferSubclassStructure.visit(visitor);

    for (auto& barrier : thisObject->m_thenables) {
        visitor.append(barrier);
    }

    thisObject->visitGeneratedLazyClasses<Visitor>(thisObject, visitor);

    ScriptExecutionContext* context = thisObject->scriptExecutionContext();
    visitor.addOpaqueRoot(context);
}

extern "C" void Bun__queueTask(JSC__JSGlobalObject*, WebCore::EventLoopTask* task);
extern "C" void Bun__queueTaskWithTimeout(JSC__JSGlobalObject*, WebCore::EventLoopTask* task, int timeout);
extern "C" void Bun__queueTaskConcurrently(JSC__JSGlobalObject*, WebCore::EventLoopTask* task);
extern "C" void Bun__performTask(Zig::GlobalObject* globalObject, WebCore::EventLoopTask* task)
{
    task->performTask(*globalObject->scriptExecutionContext());
}

void GlobalObject::queueTask(WebCore::EventLoopTask* task)
{
    Bun__queueTask(this, task);
}

void GlobalObject::queueTaskOnTimeout(WebCore::EventLoopTask* task, int timeout)
{
    Bun__queueTaskWithTimeout(this, task, timeout);
}

void GlobalObject::queueTaskConcurrently(WebCore::EventLoopTask* task)
{
    Bun__queueTaskConcurrently(this, task);
}

extern "C" void Bun__handleRejectedPromise(Zig::GlobalObject* JSGlobalObject, JSC::JSPromise* promise);

void GlobalObject::handleRejectedPromises()
{
    JSC::VM& virtual_machine = vm();
    do {
        auto unhandledRejections = WTFMove(m_aboutToBeNotifiedRejectedPromises);
        for (auto& promise : unhandledRejections) {
            if (promise->isHandled(virtual_machine))
                continue;

            Bun__handleRejectedPromise(this, promise.get());
        }
    } while (!m_aboutToBeNotifiedRejectedPromises.isEmpty());
}

DEFINE_VISIT_CHILDREN(GlobalObject);

// void GlobalObject::destroy(JSCell* cell)
// {
//     static_cast<Zig::GlobalObject*>(cell)->Zig::GlobalObject::~Zig::GlobalObject();
// }

// template<typename Visitor>
// void GlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     Zig::GlobalObject* thisObject = jsCast<Zig::GlobalObject*>(cell);
//     ASSERT_GC_OBJECT_INHERITS(thisObject, info());
//     Base::visitChildren(thisObject, visitor);

//     {
//         // The GC thread has to grab the GC lock even though it is not mutating the containers.
//         Locker locker { thisObject->m_gcLock };

//         for (auto& structure : thisObject->m_structures.values())
//             visitor.append(structure);

//         for (auto& guarded : thisObject->m_guardedObjects)
//             guarded->visitAggregate(visitor);
//     }

//     for (auto& constructor : thisObject->constructors().array())
//         visitor.append(constructor);

//     thisObject->m_builtinInternalFunctions.visit(visitor);
// }

// DEFINE_VISIT_CHILDREN(Zig::GlobalObject);

void GlobalObject::reload()
{
    JSModuleLoader* moduleLoader = this->moduleLoader();
    JSC::JSMap* registry = jsCast<JSC::JSMap*>(moduleLoader->get(
        this,
        Identifier::fromString(this->vm(), "registry"_s)));

    registry->clear(this->vm());
    this->requireMap()->clear(this->vm());
    this->vm().heap.collectSync();
}

extern "C" void JSC__JSGlobalObject__reload(JSC__JSGlobalObject* arg0)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    globalObject->reload();
}

JSC::Identifier GlobalObject::moduleLoaderResolve(JSGlobalObject* globalObject,
    JSModuleLoader* loader, JSValue key,
    JSValue referrer, JSValue origin)
{
    ErrorableZigString res;
    res.success = false;
    ZigString keyZ = toZigString(key, globalObject);
    ZigString referrerZ = referrer && !referrer.isUndefinedOrNull() && referrer.isString() ? toZigString(referrer, globalObject) : ZigStringEmpty;
    Zig__GlobalObject__resolve(&res, globalObject, &keyZ, &referrerZ);

    if (res.success) {
        return toIdentifier(res.result.value, globalObject);
    } else {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        throwException(scope, res.result.err, globalObject);
        return globalObject->vm().propertyNames->emptyIdentifier;
    }
}

JSC::JSInternalPromise* GlobalObject::moduleLoaderImportModule(JSGlobalObject* globalObject,
    JSModuleLoader*,
    JSString* moduleNameValue,
    JSValue parameters,
    const SourceOrigin& sourceOrigin)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* promise = JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
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
        JSC::jsUndefined(), parameters, JSC::jsUndefined());
    RETURN_IF_EXCEPTION(scope, promise->rejectWithCaughtException(globalObject, scope));

    return result;
}

static JSC::JSInternalPromise* rejectedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    JSC::VM& vm = globalObject->vm();
    JSInternalPromise* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, value);
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32AsAnyInt() | JSC::JSPromise::isFirstResolvingFunctionCalledFlag | static_cast<unsigned>(JSC::JSPromise::Status::Rejected)));
    return promise;
}

JSC::JSInternalPromise* GlobalObject::moduleLoaderFetch(JSGlobalObject* globalObject,
    JSModuleLoader* loader, JSValue key,
    JSValue value1, JSValue value2)
{
    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);

    auto moduleKey = key.toWTFString(globalObject);
    if (UNLIKELY(scope.exception()))
        return rejectedInternalPromise(globalObject, scope.exception()->value());

    if (moduleKey.endsWith(".node"_s)) {
        return rejectedInternalPromise(globalObject, createTypeError(globalObject, "To load Node-API modules, use require() or process.dlopen instead of import."_s));
    }

    auto moduleKeyZig = toZigString(moduleKey);
    auto source = Zig::toZigString(value1, globalObject);
    ErrorableResolvedSource res;
    res.success = false;
    res.result.err.code = 0;
    res.result.err.ptr = nullptr;

    JSValue result = Bun::fetchSourceCodeAsync(
        reinterpret_cast<Zig::GlobalObject*>(globalObject),
        &res,
        &moduleKeyZig,
        &source);

    if (auto* internalPromise = JSC::jsDynamicCast<JSC::JSInternalPromise*>(result)) {
        return internalPromise;
    } else if (auto* promise = JSC::jsDynamicCast<JSC::JSPromise*>(result)) {
        return jsCast<JSC::JSInternalPromise*>(promise);
    } else {
        return rejectedInternalPromise(globalObject, result);
    }
}

JSC::JSObject* GlobalObject::moduleLoaderCreateImportMetaProperties(JSGlobalObject* globalObject,
    JSModuleLoader* loader,
    JSValue key,
    JSModuleRecord* record,
    JSValue val)
{

    JSC::VM& vm = globalObject->vm();
    JSC::JSString* keyString = key.toStringOrNull(globalObject);
    if (UNLIKELY(!keyString))
        return JSC::constructEmptyObject(globalObject);

    return Zig::ImportMetaObject::create(globalObject, keyString);
}

JSC::JSValue GlobalObject::moduleLoaderEvaluate(JSGlobalObject* globalObject,
    JSModuleLoader* moduleLoader, JSValue key,
    JSValue moduleRecordValue, JSValue scriptFetcher,
    JSValue sentValue, JSValue resumeMode)
{

    if (UNLIKELY(scriptFetcher && scriptFetcher.isObject())) {
        return scriptFetcher;
    }

    JSC::JSValue result = moduleLoader->evaluateNonVirtual(globalObject, key, moduleRecordValue,
        scriptFetcher, sentValue, resumeMode);

    return result;
}

#include "ZigGeneratedClasses+lazyStructureImpl.h"

} // namespace Zig
