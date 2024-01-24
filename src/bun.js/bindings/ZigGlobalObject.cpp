#include "root.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include "helpers.h"
#include "BunClientData.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/InternalFieldTuple.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/CallFrameInlines.h"
#include "JavaScriptCore/ClassInfo.h"
#include "JavaScriptCore/CodeBlock.h"
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
#include "JavaScriptCore/JSGlobalProxyInlines.h"

#include "JavaScriptCore/JSCallbackConstructor.h"
#include "JavaScriptCore/JSCallbackObject.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSClassRef.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "ConsoleObject.h"
// #include "JavaScriptCore/JSContextInternal.h"
#include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/DeferredWorkTimer.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "JavaScriptCore/JSModuleNamespaceObjectInlines.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSSet.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSValueInternal.h"
#include "JavaScriptCore/JSVirtualMachineInternal.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/OptionsList.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/WasmFaultSignalHandler.h"
#include "wtf/Gigacage.h"
#include "wtf/URL.h"
#include "wtf/text/ExternalStringImpl.h"
#include "wtf/text/StringCommon.h"
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"
#include "JavaScriptCore/JSScriptFetchParameters.h"
#include "JavaScriptCore/ScriptFetchParameters.h"

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
#include "JSPerformance.h"
#include "Performance.h"
#include "JSPerformanceObserver.h"
#include "JSPerformanceObserverEntryList.h"
#include "JSPerformanceEntry.h"
#include "JSPerformanceMeasure.h"
#include "JSPerformanceMark.h"
#include "BunProcess.h"
#include "AsyncContextFrame.h"

#include "WebCoreJSBuiltins.h"
#include "JSBuffer.h"
#include "JSBufferList.h"
#include "JSFFIFunction.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/GetterSetter.h"
#include "napi.h"
#include "JSSQLStatement.h"
#include "ModuleLoader.h"
#include "NodeVMScript.h"
#include "ProcessIdentifier.h"
#include "SerializedScriptValue.h"
#include "NodeTTYModule.h"

#include "ZigGeneratedClasses.h"
#include "JavaScriptCore/DateInstance.h"

#include "BunPlugin.h"
#include "JSEnvironmentVariableMap.h"
#include "DOMIsoSubspaces.h"
#include "BunWorkerGlobalScope.h"
#include "JSWorker.h"
#include "JSMessageChannel.h"
#include "JSMessagePort.h"
#include "JSBroadcastChannel.h"

#include "JSDOMFile.h"

#include "ProcessBindingConstants.h"

#if ENABLE(REMOTE_INSPECTOR)
#include "JavaScriptCore/RemoteInspectorServer.h"
#endif

#include "BunObject.h"
#include "JSNextTickQueue.h"
#include "NodeHTTP.h"
#include "napi_external.h"
using namespace Bun;

extern "C" JSC__JSValue Bun__NodeUtil__jsParseArgs(JSC::JSGlobalObject*, JSC::CallFrame*);

extern "C" JSC::EncodedJSValue Bun__fetch(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
extern "C" JSC::EncodedJSValue Bun__canonicalizeIP(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
extern "C" JSC::EncodedJSValue H2FrameParser__getConstructor(Zig::GlobalObject* globalObject);
extern "C" JSC::EncodedJSValue BUN__HTTP2__getUnpackedSettings(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
extern "C" JSC::EncodedJSValue BUN__HTTP2_getPackedSettings(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
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

#if !OS(WINDOWS)
#include <dlfcn.h>
#endif

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
#include "JSEventListener.h"

#include "ReadableStream.h"
#include "JSSink.h"
#include "ImportMetaObject.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>

#include "JSDOMFormData.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertDictionary.h"
#include "JSDOMConvertEventListener.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include "AddEventListenerOptions.h"
#include "JSSocketAddress.h"

#include "ErrorStackTrace.h"
#include "CallSite.h"
#include "CallSitePrototype.h"
#include "DOMWrapperWorld-class.h"
#include "CommonJSModuleRecord.h"
#include <wtf/RAMSize.h>
#include <wtf/text/Base64.h>
#include "simdutf.h"
#include "libusockets.h"
#include "KeyObject.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSSubtleCrypto.h"

constexpr size_t DEFAULT_ERROR_STACK_TRACE_LIMIT = 10;

#ifdef __APPLE__
#include <sys/sysctl.h>
#elif defined(__linux__)
// for sysconf
#include <unistd.h>
#endif

#include "ProcessBindingTTYWrap.h"

// #include <iostream>
static bool has_loaded_jsc = false;

Structure* createMemoryFootprintStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

namespace WebCore {
class Base64Utilities {
public:
    static ExceptionOr<String> atob(const String& encodedString)
    {
        if (encodedString.isNull())
            return String();

        auto decodedData = base64DecodeToString(encodedString, Base64DecodeMode::DefaultValidatePaddingAndIgnoreWhitespace);
        if (!decodedData)
            return Exception { InvalidCharacterError };

        return decodedData;
    }
};

}
extern "C" WebCore::Worker* WebWorker__getParentWorker(void*);
extern "C" void JSCInitialize(const char* envp[], size_t envc, void (*onCrash)(const char* ptr, size_t length))
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
        // JSC::Options::useSigillCrashAnalyzer() = true;
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
        JSC::Options::usePromiseWithResolversMethod() = true;
        JSC::Options::useV8DateParser() = true;

#ifdef BUN_DEBUG
        JSC::Options::showPrivateScriptsInStackTraces() = true;
#endif
        JSC::Options::useSetMethods() = true;

        if (LIKELY(envc > 0)) {
            while (envc--) {
                const char* env = (const char*)envp[envc];
                // need to check for \0 so we might as well make this single pass
                // strlen would check the end of the string
                if (LIKELY(!(env[0] == 'B' && env[1] == 'U' && env[2] == 'N' && env[3] == '_' && env[4] == 'J' && env[5] == 'S' && env[6] == 'C' && env[7] == '_'))) {
                    continue;
                }

                if (UNLIKELY(!JSC::Options::setOption(env + 8))) {
                    onCrash(env, strlen(env));
                }
            }
        }
        JSC::Options::assertOptionsAreCoherent();
    }
}

extern "C" void* Bun__getVM();
extern "C" Zig::GlobalObject* Bun__getDefaultGlobal();

// Error.captureStackTrace may cause computeErrorInfo to be called twice
// Rather than figure out the plumbing in JSC, we just skip the next call
// TODO: thread_local for workers
static bool skipNextComputeErrorInfo = false;

WTF::String Bun::formatStackTrace(JSC::VM& vm, JSC::JSGlobalObject* globalObject, const WTF::String& name, const WTF::String& message, unsigned& line, unsigned& column, WTF::String& sourceURL, Vector<JSC::StackFrame>& stackTrace, JSC::JSObject* errorInstance)
{
    WTF::StringBuilder sb;

    if (!name.isEmpty()) {
        sb.append(name);
        if (!message.isEmpty()) {
            sb.append(": "_s);
            sb.append(message);
        }
    } else if (!message.isEmpty()) {
        sb.append(message);
    }

    // FIXME: why can size == 6 and capacity == 0?
    // https://discord.com/channels/876711213126520882/1174901590457585765/1174907969419350036
    size_t framesCount = stackTrace.size();

    bool hasSet = false;

    if (errorInstance) {
        if (JSC::ErrorInstance* err = jsDynamicCast<JSC::ErrorInstance*>(errorInstance)) {
            if (err->errorType() == ErrorType::SyntaxError && (stackTrace.isEmpty() || stackTrace.at(0).sourceURL(vm) != err->sourceURL())) {
                // There appears to be an off-by-one error.
                // The following reproduces the issue:
                // /* empty comment */
                // "".test(/[a-0]/);
                auto originalLine = WTF::OrdinalNumber::fromOneBasedInt(err->line());

                ZigStackFrame remappedFrame;
                memset(&remappedFrame, 0, sizeof(ZigStackFrame));

                remappedFrame.position.line = originalLine.zeroBasedInt() + 1;
                remappedFrame.position.column_start = 0;

                String sourceURLForFrame = err->sourceURL();

                // If it's not a Zig::GlobalObject, don't bother source-mapping it.
                if (globalObject && !sourceURLForFrame.isEmpty()) {
                    if (!sourceURLForFrame.isEmpty()) {
                        remappedFrame.source_url = Bun::toString(sourceURLForFrame);
                    } else {
                        // https://github.com/oven-sh/bun/issues/3595
                        remappedFrame.source_url = BunStringEmpty;
                    }

                    // This ensures the lifetime of the sourceURL is accounted for correctly
                    Bun__remapStackFramePositions(globalObject, &remappedFrame, 1);
                }

                // there is always a newline before each stack frame line, ensuring that the name + message
                // exist on the first line, even if both are empty
                sb.append("\n"_s);

                sb.append("    at <parse> ("_s);

                sb.append(sourceURLForFrame);

                if (remappedFrame.remapped) {
                    errorInstance->putDirect(vm, Identifier::fromString(vm, "originalLine"_s), jsNumber(originalLine.oneBasedInt()), 0);
                    hasSet = true;
                    line = remappedFrame.position.line;
                }

                if (remappedFrame.remapped) {
                    sb.append(":"_s);
                    sb.append(remappedFrame.position.line);
                } else {
                    sb.append(":"_s);
                    sb.append(originalLine.oneBasedInt());
                }

                sb.append(")"_s);
            }
        }
    }

    if (framesCount == 0) {
        ASSERT(stackTrace.isEmpty());
        return sb.toString();
    }

    sb.append("\n"_s);

    for (size_t i = 0; i < framesCount; i++) {
        StackFrame& frame = stackTrace.at(i);

        sb.append("    at "_s);

        if (auto codeblock = frame.codeBlock()) {
            if (codeblock->isConstructor()) {
                sb.append("new "_s);
            }

            // TODO: async
        }

        WTF::String functionName = frame.functionName(vm);
        if (functionName.isEmpty()) {
            sb.append("<anonymous>"_s);
        } else {
            sb.append(functionName);
        }

        if (frame.hasLineAndColumnInfo()) {
            unsigned int thisLine = 0;
            unsigned int thisColumn = 0;
            frame.computeLineAndColumn(thisLine, thisColumn);
            ZigStackFrame remappedFrame;
            remappedFrame.position.line = thisLine;
            remappedFrame.position.column_start = thisColumn;

            String sourceURLForFrame = frame.sourceURL(vm);

            // If it's not a Zig::GlobalObject, don't bother source-mapping it.
            if (globalObject) {
                if (!sourceURLForFrame.isEmpty()) {
                    remappedFrame.source_url = Bun::toString(sourceURLForFrame);
                } else {
                    // https://github.com/oven-sh/bun/issues/3595
                    remappedFrame.source_url = BunStringEmpty;
                }

                // This ensures the lifetime of the sourceURL is accounted for correctly
                Bun__remapStackFramePositions(globalObject, &remappedFrame, 1);
            }

            if (!hasSet) {
                hasSet = true;
                line = thisLine;
                column = thisColumn;
                sourceURL = frame.sourceURL(vm);

                if (remappedFrame.remapped) {
                    if (errorInstance) {
                        errorInstance->putDirect(vm, Identifier::fromString(vm, "originalLine"_s), jsNumber(thisLine), 0);
                        errorInstance->putDirect(vm, Identifier::fromString(vm, "originalColumn"_s), jsNumber(thisColumn), 0);
                    }
                }
            }

            sb.append(" ("_s);
            sb.append(sourceURLForFrame);
            sb.append(":"_s);
            sb.append(remappedFrame.position.line);
            sb.append(":"_s);
            sb.append(remappedFrame.position.column_start);
            sb.append(")"_s);
        } else {
            sb.append(" (native)"_s);
        }

        if (i != framesCount - 1) {
            sb.append("\n"_s);
        }
    }

    return sb.toString();
}

// error.stack calls this function
static String computeErrorInfoWithoutPrepareStackTrace(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned& line, unsigned& column, String& sourceURL, JSObject* errorInstance)
{
    auto* lexicalGlobalObject = errorInstance->globalObject();
    Zig::GlobalObject* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);

    WTF::String name = "Error"_s;
    WTF::String message;

    // Note that we are not allowed to allocate memory in here. It's called inside a finalizer.
    if (auto* instance = jsDynamicCast<ErrorInstance*>(errorInstance)) {
        name = instance->sanitizedNameString(lexicalGlobalObject);
        message = instance->sanitizedMessageString(lexicalGlobalObject);
    }

    return Bun::formatStackTrace(vm, globalObject, name, message, line, column, sourceURL, stackTrace, errorInstance);
}

static String computeErrorInfoWithPrepareStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<StackFrame>& stackFrames, unsigned& line, unsigned& column, String& sourceURL, JSObject* errorObject, JSObject* prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    size_t stackTraceLimit = globalObject->stackTraceLimit().value();
    if (stackTraceLimit == 0) {
        stackTraceLimit = DEFAULT_ERROR_STACK_TRACE_LIMIT;
    }

    JSCStackTrace stackTrace = JSCStackTrace::fromExisting(vm, stackFrames);

    // Note: we cannot use tryCreateUninitializedRestricted here because we cannot allocate memory inside initializeIndex()
    JSC::JSArray* callSites = JSC::JSArray::create(vm,
        globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
        stackTrace.size());

    // Create the call sites (one per frame)
    GlobalObject::createCallSitesFromFrames(globalObject, lexicalGlobalObject, stackTrace, callSites);

    // We need to sourcemap it if it's a GlobalObject.
    if (globalObject == lexicalGlobalObject) {
        size_t framesCount = stackTrace.size();
        ZigStackFrame remappedFrames[framesCount];
        for (int i = 0; i < framesCount; i++) {
            remappedFrames[i].source_url = Bun::toString(lexicalGlobalObject, stackTrace.at(i).sourceURL());
            if (JSCStackFrame::SourcePositions* sourcePositions = stackTrace.at(i).getSourcePositions()) {
                remappedFrames[i].position.line = sourcePositions->line.oneBasedInt();
                remappedFrames[i].position.column_start = sourcePositions->startColumn.oneBasedInt() + 1;
            } else {
                remappedFrames[i].position.line = -1;
                remappedFrames[i].position.column_start = -1;
            }
        }

        Bun__remapStackFramePositions(globalObject, remappedFrames, framesCount);

        for (size_t i = 0; i < framesCount; i++) {
            JSC::JSValue callSiteValue = callSites->getIndex(lexicalGlobalObject, i);
            CallSite* callSite = JSC::jsDynamicCast<CallSite*>(callSiteValue);
            if (remappedFrames[i].remapped) {
                int32_t remappedColumnStart = remappedFrames[i].position.column_start;
                JSC::JSValue columnNumber = JSC::jsNumber(remappedColumnStart);
                callSite->setColumnNumber(columnNumber);

                int32_t remappedLine = remappedFrames[i].position.line;
                JSC::JSValue lineNumber = JSC::jsNumber(remappedLine);
                callSite->setLineNumber(lineNumber);
            }
        }
    }

    globalObject->formatStackTrace(vm, lexicalGlobalObject, errorObject, callSites, prepareStackTrace);

    RETURN_IF_EXCEPTION(scope, String());
    return String();
}

static String computeErrorInfo(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned& line, unsigned& column, String& sourceURL, JSObject* errorInstance)
{
    if (skipNextComputeErrorInfo) {
        return String();
    }

    if (!errorInstance) {
        return String();
    }

    auto* lexicalGlobalObject = errorInstance->globalObject();
    Zig::GlobalObject* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);

    // Error.prepareStackTrace - https://v8.dev/docs/stack-trace-api#customizing-stack-traces
    if (!globalObject) {
        // node:vm will use a different JSGlobalObject
        globalObject = Bun__getDefaultGlobal();

        auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(lexicalGlobalObject);
        if (JSValue prepareStackTrace = errorConstructor->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "prepareStackTrace"_s))) {
            if (prepareStackTrace.isCell() && prepareStackTrace.isObject() && prepareStackTrace.isCallable()) {
                return computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, line, column, sourceURL, errorInstance, prepareStackTrace.getObject());
            }
        }
    } else {
        if (JSValue prepareStackTrace = globalObject->m_errorConstructorPrepareStackTraceValue.get()) {
            if (prepareStackTrace.isCell() && prepareStackTrace.isObject() && prepareStackTrace.isCallable()) {
                return computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, line, column, sourceURL, errorInstance, prepareStackTrace.getObject());
            }
        }
    }

    return computeErrorInfoWithoutPrepareStackTrace(vm, stackTrace, line, column, sourceURL, errorInstance);
}

static void resetOnEachMicrotaskTick(JSC::VM& vm, Zig::GlobalObject* globalObject);

static void checkIfNextTickWasCalledDuringMicrotask(JSC::VM& vm)
{
    auto* globalObject = Bun__getDefaultGlobal();
    if (auto nextTickQueueValue = globalObject->m_nextTickQueue.get()) {
        auto* queue = jsCast<Bun::JSNextTickQueue*>(nextTickQueueValue);
        resetOnEachMicrotaskTick(vm, globalObject);
        queue->drain(vm, globalObject);
    }
}

static void cleanupAsyncHooksData(JSC::VM& vm)
{
    auto* globalObject = Bun__getDefaultGlobal();
    globalObject->m_asyncContextData.get()->putInternalField(vm, 0, jsUndefined());
    globalObject->asyncHooksNeedsCleanup = false;
    if (!globalObject->m_nextTickQueue) {
        vm.setOnEachMicrotaskTick(&checkIfNextTickWasCalledDuringMicrotask);
        checkIfNextTickWasCalledDuringMicrotask(vm);
    } else {
        vm.setOnEachMicrotaskTick(nullptr);
    }
}

static void resetOnEachMicrotaskTick(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    if (globalObject->asyncHooksNeedsCleanup) {
        vm.setOnEachMicrotaskTick(&cleanupAsyncHooksData);
    } else {
        if (globalObject->m_nextTickQueue) {
            vm.setOnEachMicrotaskTick(nullptr);
        } else {
            vm.setOnEachMicrotaskTick(&checkIfNextTickWasCalledDuringMicrotask);
        }
    }
}

extern "C" JSC__JSGlobalObject* Zig__GlobalObject__create(void* console_client, int32_t executionContextId, bool miniMode, void* worker_ptr)
{

    auto heapSize = miniMode ? JSC::HeapType::Small : JSC::HeapType::Large;
    JSC::VM& vm = JSC::VM::create(heapSize).leakRef();
    // This must happen before JSVMClientData::create
    vm.heap.acquireAccess();
    JSC::JSLockHolder locker(vm);

    WebCore::JSVMClientData::create(&vm, Bun__getVM());

    Zig::GlobalObject* globalObject;

    if (UNLIKELY(executionContextId > -1)) {
        globalObject = Zig::GlobalObject::create(
            vm,
            Zig::GlobalObject::createStructure(vm, JSC::JSGlobalObject::create(vm, JSC::JSGlobalObject::createStructure(vm, JSC::jsNull())), JSC::jsNull()),
            static_cast<ScriptExecutionContextIdentifier>(executionContextId));

        if (auto* worker = static_cast<WebCore::Worker*>(worker_ptr)) {
            auto& options = worker->options();

            // ensure remote termination works.
            vm.ensureTerminationException();
            vm.forbidExecutionOnTermination();

            if (options.bun.env) {
                auto map = WTFMove(options.bun.env);
                auto size = map->size();
                auto env = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), size >= JSFinalObject::maxInlineCapacity ? JSFinalObject::maxInlineCapacity : size);
                for (auto k : *map) {
                    env->putDirect(vm, JSC::Identifier::fromString(vm, WTFMove(k.key)), JSC::jsString(vm, WTFMove(k.value)));
                }
                map->clear();
                globalObject->m_processEnvObject.set(vm, globalObject, env);
            }
        }
    } else {
        globalObject = Zig::GlobalObject::create(
            vm,
            Zig::GlobalObject::createStructure(vm, JSC::JSGlobalObject::create(vm, JSC::JSGlobalObject::createStructure(vm, JSC::jsNull())),
                JSC::jsNull()));
    }

    globalObject->setConsole(console_client);
    globalObject->isThreadLocalDefaultGlobalObject = true;
    globalObject->setStackTraceLimit(DEFAULT_ERROR_STACK_TRACE_LIMIT); // Node.js defaults to 10
    vm.setOnComputeErrorInfo(computeErrorInfo);

    JSC::gcProtect(globalObject);

    vm.setOnEachMicrotaskTick([](JSC::VM& vm) -> void {
        auto* globalObject = Bun__getDefaultGlobal();
        if (auto nextTickQueue = globalObject->m_nextTickQueue.get()) {
            resetOnEachMicrotaskTick(vm, globalObject);
            Bun::JSNextTickQueue* queue = jsCast<Bun::JSNextTickQueue*>(nextTickQueue);
            queue->drain(vm, globalObject);
            return;
        }
    });

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

    auto specifier = Bun::toString(moduleKey);
    ErrorableResolvedSource res;
    res.success = false;
    res.result.err.code = 0;
    res.result.err.ptr = nullptr;

    JSValue result = Bun::fetchESMSourceCodeSync(
        reinterpret_cast<Zig::GlobalObject*>(globalObject),
        &res,
        &specifier,
        &specifier,
        nullptr);

    if (scope.exception() || !result) {
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsUndefined()));
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

#define WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ConstructorName)                                                                                                       \
    JSValue ConstructorName##ConstructorCallback(VM& vm, JSObject* lexicalGlobalObject)                                                                             \
    {                                                                                                                                                               \
        return WebCore::JS##ConstructorName::getConstructor(vm, JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject));                                              \
    }                                                                                                                                                               \
    JSC_DEFINE_CUSTOM_GETTER(ConstructorName##_getter,                                                                                                              \
        (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,                                                                                  \
            JSC::PropertyName))                                                                                                                                     \
    {                                                                                                                                                               \
        return JSC::JSValue::encode(WebCore::JS##ConstructorName::getConstructor(lexicalGlobalObject->vm(), JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject))); \
    }

String GlobalObject::defaultAgentClusterID()
{
    return makeString(ProcessIdent::identifier().toUInt64(), "-default"_s);
}

String GlobalObject::agentClusterID() const
{
    // TODO: workers
    // if (is<SharedWorkerGlobalScope>(scriptExecutionContext()))
    //     return makeString(WProcess::identifier().toUInt64(), "-sharedworker");
    return defaultAgentClusterID();
}

namespace Zig {

using namespace WebCore;

static JSGlobalObject* deriveShadowRealmGlobalObject(JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    Zig::GlobalObject* shadow = Zig::GlobalObject::create(vm, Zig::GlobalObject::createStructure(vm, JSC::JSGlobalObject::create(vm, JSC::JSGlobalObject::createStructure(vm, JSC::jsNull())), JSC::jsNull()));
    shadow->setConsole(shadow);
    size_t count = 0;

    shadow->setConsole(shadow);

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
    object->putDirect(vm, vm.propertyNames->name, nameString, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    object->putDirect(vm, vm.propertyNames->toStringTagSymbol,
        nameString, PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);

    return JSC::JSValue::encode(JSC::JSValue(object));
}

extern "C" int Bun__VM__scriptExecutionStatus(void*);
JSC::ScriptExecutionStatus Zig::GlobalObject::scriptExecutionStatus(JSC::JSGlobalObject* globalObject, JSC::JSObject*)
{
    switch (Bun__VM__scriptExecutionStatus(jsCast<Zig::GlobalObject*>(globalObject)->bunVM())) {
    case 0:
        return JSC::ScriptExecutionStatus::Running;
    case 1:
        return JSC::ScriptExecutionStatus::Suspended;
    case 2:
        return JSC::ScriptExecutionStatus::Stopped;
    default: {
        RELEASE_ASSERT_NOT_REACHED();
    }
    }
}

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
    , m_scriptExecutionContext(new WebCore::ScriptExecutionContext(&vm, this))
    , globalEventScope(*new Bun::GlobalScope(m_scriptExecutionContext))
{
    // m_scriptExecutionContext = globalEventScope.m_context;
    mockModule = Bun::JSMockModule::create(this);
    globalEventScope.m_context = m_scriptExecutionContext;
    // FIXME: is there a better way to do this? this event handler should always be tied to the global object
    globalEventScope.relaxAdoptionRequirement();
}

GlobalObject::GlobalObject(JSC::VM& vm, JSC::Structure* structure, WebCore::ScriptExecutionContextIdentifier contextId)
    : JSC::JSGlobalObject(vm, structure, &s_globalObjectMethodTable)
    , m_bunVM(Bun__getVM())
    , m_constructors(makeUnique<WebCore::DOMConstructors>())
    , m_world(WebCore::DOMWrapperWorld::create(vm, WebCore::DOMWrapperWorld::Type::Normal))
    , m_worldIsNormal(true)
    , m_builtinInternalFunctions(vm)
    , m_scriptExecutionContext(new WebCore::ScriptExecutionContext(&vm, this, contextId))
    , globalEventScope(*new Bun::GlobalScope(m_scriptExecutionContext))
{
    // m_scriptExecutionContext = globalEventScope.m_context;
    mockModule = Bun::JSMockModule::create(this);
    globalEventScope.m_context = m_scriptExecutionContext;
    // FIXME: is there a better way to do this? this event handler should always be tied to the global object
    globalEventScope.relaxAdoptionRequirement();
}

GlobalObject::~GlobalObject()
{
    if (napiInstanceDataFinalizer) {
        napi_finalize finalizer = reinterpret_cast<napi_finalize>(napiInstanceDataFinalizer);
        finalizer(toNapi(this), napiInstanceData, napiInstanceDataFinalizerHint);
    }

    if (auto* ctx = scriptExecutionContext()) {
        ctx->removeFromContextsMap();
    }
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
    Bun__reportUnhandledError(globalObject, JSValue::encode(JSValue(exception)));
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

void GlobalObject::setConsole(void* console)
{
    this->setConsoleClient(new Bun::ConsoleObject(console));
}

JSC_DEFINE_CUSTOM_GETTER(errorConstructorPrepareStackTraceGetter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSValue value = jsUndefined();
    if (thisObject->m_errorConstructorPrepareStackTraceValue) {
        value = thisObject->m_errorConstructorPrepareStackTraceValue.get();
    }
    return JSValue::encode(value);
}

JSC_DEFINE_CUSTOM_SETTER(errorConstructorPrepareStackTraceSetter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName property))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    thisObject->m_errorConstructorPrepareStackTraceValue.set(vm, thisObject, JSValue::decode(encodedValue));
    return true;
}

#pragma mark - Globals

JSC_DEFINE_CUSTOM_GETTER(globalOnMessage,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(JSValue::decode(thisValue));
    return JSValue::encode(eventHandlerAttribute(thisObject->eventTarget(), eventNames().messageEvent, thisObject->world()));
}

JSC_DEFINE_CUSTOM_GETTER(globalOnError,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(JSValue::decode(thisValue));
    return JSValue::encode(eventHandlerAttribute(thisObject->eventTarget(), eventNames().errorEvent, thisObject->world()));
}

JSC_DEFINE_CUSTOM_SETTER(setGlobalOnMessage,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName property))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSValue value = JSValue::decode(encodedValue);
    auto* thisObject = jsCast<Zig::GlobalObject*>(JSValue::decode(thisValue));
    setEventHandlerAttribute<JSEventListener>(thisObject->eventTarget(), eventNames().messageEvent, value, *thisObject);
    vm.writeBarrier(thisObject, value);
    ensureStillAliveHere(value);
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(setGlobalOnError,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName property))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSValue value = JSValue::decode(encodedValue);
    auto* thisObject = jsCast<Zig::GlobalObject*>(JSValue::decode(thisValue));
    setEventHandlerAttribute<JSEventListener>(thisObject->eventTarget(), eventNames().errorEvent, value, *thisObject);
    vm.writeBarrier(thisObject, value);
    ensureStillAliveHere(value);
    return true;
}

WebCore::EventTarget& GlobalObject::eventTarget()
{
    return globalEventScope;
}

JSC_DEFINE_CUSTOM_GETTER(functionLazyLoadStreamPrototypeMap_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSC::JSValue::encode(
        thisObject->readableStreamNativeMap());
}

JSC_DEFINE_CUSTOM_GETTER(JSBuffer_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    return JSC::JSValue::encode(JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject)->JSBufferConstructor());
}

// This macro defines the getter needed for ZigGlobalObject.lut.h
// "<ClassName>ConstructorCallback" is a PropertyCallback
// it also defines "<ClassName>_getter" which is the getter for a JSC::CustomGetterSetter
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(AbortController);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(AbortSignal);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(BroadcastChannel);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ByteLengthQueuingStrategy)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CloseEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CountQueuingStrategy)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CryptoKey);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CustomEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DOMException);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DOMFormData);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DOMURL);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ErrorEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Event);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(EventTarget);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(FetchHeaders);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(MessageChannel);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(MessageEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(MessagePort);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Performance);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceEntry);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceMark);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceMeasure);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceObserver);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceObserverEntryList);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableByteStreamController)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStream)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamBYOBReader)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamBYOBRequest)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamDefaultController)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamDefaultReader)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(SubtleCrypto);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TextEncoder);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TransformStream)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TransformStreamDefaultController)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(URLSearchParams);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WebSocket);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Worker);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WritableStream);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WritableStreamDefaultController);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WritableStreamDefaultWriter);

JSC_DEFINE_HOST_FUNCTION(functionGetSelf,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(globalObject->globalThis());
}

JSC_DEFINE_HOST_FUNCTION(functionSetSelf,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    JSC::JSValue value = callFrame->argument(0);
    // Chrome DevTools:
    //   > Object.getOwnPropertyDescriptor(globalThis, "self")
    //   < {enumerable: true, configurable: true, get: ƒ, set: ƒ}
    //   > globalThis.self = 123
    //   < 123
    //   > Object.getOwnPropertyDescriptor(globalThis, "self")
    //   < {value: 123, writable: true, enumerable: true, configurable: true}
    globalObject->putDirect(vm, WebCore::builtinNames(vm).selfPublicName(), value, 0);
    return JSValue::encode(value);
}

JSC_DEFINE_HOST_FUNCTION(functionQueueMicrotask,
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
    JSC::JSValue asyncContext = global->m_asyncContextData.get()->getInternalField(0);

    // This is a JSC builtin function
    globalObject->queueMicrotask(global->performMicrotaskFunction(), job, asyncContext,
        JSC::JSValue {}, JSC::JSValue {});

    return JSC::JSValue::encode(JSC::jsUndefined());
}

using MicrotaskCallback = void (*)(void*);

JSC_DEFINE_HOST_FUNCTION(functionNativeMicrotaskTrampoline,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // Do not use JSCell* here because the GC will try to visit it.
    double cellPtr = callFrame->uncheckedArgument(0).asNumber();
    double callbackPtr = callFrame->uncheckedArgument(1).asNumber();

    void* cell = reinterpret_cast<void*>(bitwise_cast<uintptr_t>(cellPtr));
    auto* callback = reinterpret_cast<MicrotaskCallback>(bitwise_cast<uintptr_t>(callbackPtr));
    callback(cell);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionSetTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSValue job = callFrame->argument(0);
    JSC::JSValue num = callFrame->argument(1);
    JSC::JSValue arguments = {};
    size_t argumentCount = callFrame->argumentCount();
    switch (argumentCount) {
    case 0: {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "setTimeout requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    case 1: {
        num = jsNumber(0);
        break;
    }
    case 2: {
        break;
    }

    default: {
        JSC::ObjectInitializationScope initializationScope(vm);
        JSC::JSArray* argumentsArray = JSC::JSArray::tryCreateUninitializedRestricted(
            initializationScope, nullptr,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            argumentCount - 2);

        if (UNLIKELY(!argumentsArray)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        for (size_t i = 2; i < argumentCount; i++) {
            argumentsArray->putDirectIndex(globalObject, i - 2, callFrame->uncheckedArgument(i));
        }
        arguments = JSValue(argumentsArray);
    }
    }

    if (UNLIKELY(!job.isObject() || !job.getObject()->isCallable())) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setTimeout expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    const char* fileName = sourceOrigin.string().utf8().data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    return Bun__Timer__setTimeout(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(num), JSValue::encode(arguments));
}

JSC_DEFINE_HOST_FUNCTION(functionSetInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSValue job = callFrame->argument(0);
    JSC::JSValue num = callFrame->argument(1);
    JSC::JSValue arguments = {};
    size_t argumentCount = callFrame->argumentCount();
    switch (argumentCount) {
    case 0: {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "setInterval requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    case 1: {
        num = jsNumber(0);
        break;
    }
    case 2: {
        break;
    }

    default: {
        JSC::ObjectInitializationScope initializationScope(vm);
        JSC::JSArray* argumentsArray = JSC::JSArray::tryCreateUninitializedRestricted(
            initializationScope, nullptr,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            argumentCount - 2);

        if (UNLIKELY(!argumentsArray)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        for (size_t i = 2; i < argumentCount; i++) {
            argumentsArray->putDirectIndex(globalObject, i - 2, callFrame->uncheckedArgument(i));
        }
        arguments = JSValue(argumentsArray);
    }
    }

    if (UNLIKELY(!job.isObject() || !job.getObject()->isCallable())) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "setInterval expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    const char* fileName = sourceOrigin.string().utf8().data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    return Bun__Timer__setInterval(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(num), JSValue::encode(arguments));
}

JSC_DEFINE_HOST_FUNCTION(functionClearInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "clearInterval requires 1 argument (a number)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue num = callFrame->argument(0);

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    const char* fileName = sourceOrigin.string().utf8().data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    return Bun__Timer__clearInterval(globalObject, JSC::JSValue::encode(num));
}

JSC_DEFINE_HOST_FUNCTION(functionClearTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    if (callFrame->argumentCount() == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "clearTimeout requires 1 argument (a number)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue num = callFrame->argument(0);

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    const char* fileName = sourceOrigin.string().utf8().data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    return Bun__Timer__clearTimeout(globalObject, JSC::JSValue::encode(num));
}

JSC_DEFINE_HOST_FUNCTION(functionStructuredClone,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() == 0) {
        throwTypeError(globalObject, throwScope, "structuredClone requires 1 argument"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue options = callFrame->argument(1);

    Vector<JSC::Strong<JSC::JSObject>> transferList;

    if (options.isObject()) {
        JSC::JSObject* optionsObject = options.getObject();
        JSC::JSValue transferListValue = optionsObject->get(globalObject, vm.propertyNames->transfer);
        if (transferListValue.isObject()) {
            JSC::JSObject* transferListObject = transferListValue.getObject();
            if (auto* transferListArray = jsDynamicCast<JSC::JSArray*>(transferListObject)) {
                for (unsigned i = 0; i < transferListArray->length(); i++) {
                    JSC::JSValue transferListValue = transferListArray->get(globalObject, i);
                    if (transferListValue.isObject()) {
                        JSC::JSObject* transferListObject = transferListValue.getObject();
                        transferList.append(JSC::Strong<JSC::JSObject>(vm, transferListObject));
                    }
                }
            }
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTFMove(transferList), ports);
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        return JSValue::encode(jsUndefined());
    }

    JSValue deserialized = serialized.releaseReturnValue()->deserialize(*globalObject, globalObject, ports);

    return JSValue::encode(deserialized);
}

JSC_DEFINE_HOST_FUNCTION(functionBTOA,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (callFrame->argumentCount() == 0) {
        JSC::throwTypeError(globalObject, throwScope, "btoa requires 1 argument (a string)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSValue arg0 = callFrame->uncheckedArgument(0);
    WTF::String encodedString = arg0.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));

    if (encodedString.isEmpty()) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    if (!encodedString.containsOnlyLatin1()) {
        throwException(globalObject, throwScope, createDOMException(globalObject, InvalidCharacterError));
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    // Reminder: btoa() is for Byte Strings
    // Specifically: latin1 byte strings
    // That means even though this looks like the wrong thing to do,
    // we should be converting to latin1, not utf8.
    if (!encodedString.is8Bit()) {
        LChar* ptr;
        unsigned length = encodedString.length();
        auto dest = WTF::String::createUninitialized(length, ptr);
        WTF::StringImpl::copyCharacters(ptr, encodedString.characters16(), length);
        encodedString = WTFMove(dest);
    }

    unsigned length = encodedString.length();
    RELEASE_AND_RETURN(
        throwScope,
        Bun__encoding__toString(
            encodedString.characters8(),
            length,
            globalObject,
            static_cast<uint8_t>(WebCore::BufferEncodingType::base64)));
}

JSC_DEFINE_HOST_FUNCTION(functionATOB,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (callFrame->argumentCount() == 0) {
        JSC::throwTypeError(globalObject, throwScope, "atob requires 1 argument (a string)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    WTF::String encodedString = callFrame->uncheckedArgument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));

    auto result = WebCore::Base64Utilities::atob(encodedString);
    if (result.hasException()) {
        throwException(globalObject, throwScope, createDOMException(*globalObject, result.releaseException()));
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsString(vm, result.releaseReturnValue())));
}

JSC_DEFINE_HOST_FUNCTION(functionReportError,
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

extern "C" JSC__JSValue ArrayBuffer__fromSharedMemfd(int64_t fd, JSC::JSGlobalObject* globalObject, size_t byteOffset, size_t byteLength, size_t totalLength)
{

// Windows doesn't have mmap
// This code should pretty much only be called on Linux.
#if !OS(WINDOWS)
    auto ptr = mmap(nullptr, totalLength, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);

    if (ptr == MAP_FAILED) {
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto buffer = ArrayBuffer::createFromBytes(reinterpret_cast<char*>(ptr) + byteOffset, byteLength, createSharedTask<void(void*)>([ptr, totalLength](void* p) {
        munmap(ptr, totalLength);
    }));

    Structure* structure = globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default);

    if (UNLIKELY(!structure)) {
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    return JSValue::encode(JSC::JSArrayBuffer::create(globalObject->vm(), structure, WTFMove(buffer)));
#else
    return JSC::JSValue::encode(JSC::JSValue {});
#endif
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

extern "C" JSC__JSValue Bun__createUint8ArrayForCopy(JSC::JSGlobalObject* globalObject, const void* ptr, size_t len, bool isBuffer)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(
        globalObject,
        isBuffer ? reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSBufferSubclassStructure() : globalObject->m_typedArrayUint8.get(globalObject),
        len);

    if (UNLIKELY(!array)) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (len > 0 && ptr != nullptr)
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

JSC_DEFINE_HOST_FUNCTION(functionCallback, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSFunction* callback = jsCast<JSFunction*>(callFrame->uncheckedArgument(0));
    JSC::CallData callData = JSC::getCallData(callback);
    return JSC::JSValue::encode(JSC::call(globalObject, callback, callData, JSC::jsUndefined(), JSC::MarkedArgumentBuffer()));
}

// $lazy("async_hooks").cleanupLater
JSC_DEFINE_HOST_FUNCTION(asyncHooksCleanupLater, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // assumptions and notes:
    // - nobody else uses setOnEachMicrotaskTick
    // - this is called by js if we set async context in a way we may not clear it
    // - AsyncLocalStorage.prototype.run cleans up after itself and does not call this cb
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    global->asyncHooksNeedsCleanup = true;
    resetOnEachMicrotaskTick(globalObject->vm(), global);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(asyncHooksSetEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // assumptions and notes:
    // - nobody else uses setOnEachMicrotaskTick
    // - this is called by js if we set async context in a way we may not clear it
    // - AsyncLocalStorage.prototype.run cleans up after itself and does not call this cb
    globalObject->setAsyncContextTrackingEnabled(callFrame->argument(0).toBoolean(globalObject));
    return JSC::JSValue::encode(JSC::jsUndefined());
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

extern "C" JSC_DECLARE_HOST_FUNCTION(BunString__getStringWidth);

JSC_DEFINE_HOST_FUNCTION(jsReceiveMessageOnPort, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(lexicalGlobalObject, scope, "receiveMessageOnPort needs 1 argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto port = callFrame->argument(0);

    if (!port.isObject()) {
        throwTypeError(lexicalGlobalObject, scope, "the \"port\" argument must be a MessagePort instance"_s);
        return JSC::JSValue::encode(jsUndefined());
    }

    if (auto* messagePort = jsDynamicCast<JSMessagePort*>(port)) {
        return JSC::JSValue::encode(messagePort->wrapped().tryTakeMessage(lexicalGlobalObject));
    } else if (auto* broadcastChannel = jsDynamicCast<JSBroadcastChannel*>(port)) {
        // TODO: support broadcast channels
        return JSC::JSValue::encode(jsUndefined());
    }

    throwTypeError(lexicalGlobalObject, scope, "the \"port\" argument must be a MessagePort instance"_s);
    return JSC::JSValue::encode(jsUndefined());
}

extern "C" EncodedJSValue BunInternalFunction__syntaxHighlighter(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame);

// we're trying out a new way to do this lazy loading
// this is $lazy() in js code
JSC_DEFINE_HOST_FUNCTION(functionLazyLoad,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    VM& vm = globalObject->vm();

    switch (callFrame->argumentCount()) {
    case 0: {
        JSC::throwTypeError(globalObject, scope, "$lazy needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);
        if (moduleName.isNumber()) {
            switch (moduleName.toInt32(globalObject)) {
            case 0: {
                JSC::throwTypeError(globalObject, scope, "$lazy expects a string"_s);
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
                JSC::throwTypeError(globalObject, scope, "$lazy expects a string"_s);
                scope.release();
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            }
        }

        auto string = moduleName.toWTFString(globalObject);
        if (string.isNull()) {
            JSC::throwTypeError(globalObject, scope, "$lazy expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        if (string == "sqlite"_s) {
            return JSC::JSValue::encode(JSSQLStatementConstructor::create(vm, globalObject, JSSQLStatementConstructor::createStructure(vm, globalObject, globalObject->m_functionPrototype.get())));
        }

        if (string == "http"_s) {
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setHeader"_s)),
                JSC::JSFunction::create(vm, globalObject, 3, "setHeader"_s, jsHTTPSetHeader, ImplementationVisibility::Public), NoIntrinsic);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getHeader"_s)),
                JSC::JSFunction::create(vm, globalObject, 2, "getHeader"_s, jsHTTPGetHeader, ImplementationVisibility::Public), NoIntrinsic);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "assignHeaders"_s)),
                JSC::JSFunction::create(vm, globalObject, 2, "assignHeaders"_s, jsHTTPAssignHeaders, ImplementationVisibility::Public), NoIntrinsic);
            return JSC::JSValue::encode(obj);
        }

        if (string == "worker_threads"_s) {

            JSValue workerData = jsUndefined();
            JSValue threadId = jsNumber(0);

            if (auto* worker = WebWorker__getParentWorker(globalObject->bunVM())) {
                auto& options = worker->options();
                if (worker && options.bun.data) {
                    auto ports = MessagePort::entanglePorts(*ScriptExecutionContext::getScriptExecutionContext(worker->clientIdentifier()), WTFMove(options.bun.dataMessagePorts));
                    RefPtr<WebCore::SerializedScriptValue> serialized = WTFMove(options.bun.data);
                    JSValue deserialized = serialized->deserialize(*globalObject, globalObject, WTFMove(ports));
                    RETURN_IF_EXCEPTION(scope, {});
                    workerData = deserialized;
                }

                // Main thread starts at 1
                threadId = jsNumber(worker->clientIdentifier() - 1);
            }

            JSArray* array = constructEmptyArray(globalObject, nullptr);
            array->push(globalObject, workerData);
            array->push(globalObject, threadId);
            array->push(globalObject, JSFunction::create(vm, globalObject, 1, "receiveMessageOnPort"_s, jsReceiveMessageOnPort, ImplementationVisibility::Public, NoIntrinsic));

            return JSC::JSValue::encode(array);
        }

        if (string == "util"_s) {
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "parseArgs"_s)),
                JSC::JSFunction::create(vm, globalObject, 1, "parseArgs"_s, Bun__NodeUtil__jsParseArgs, ImplementationVisibility::Public), NoIntrinsic);

            return JSValue::encode(obj);
        }

        if (string == "getStringWidth"_s) {
            return JSValue::encode(JSC::JSFunction::create(vm, globalObject, 1, "getStringWidth"_s, BunString__getStringWidth, ImplementationVisibility::Public));
        }

        if (string == "pathToFileURL"_s) {
            return JSValue::encode(
                JSFunction::create(vm, globalObject, 1, pathToFileURLString, functionPathToFileURL, ImplementationVisibility::Public, NoIntrinsic));
        }

        if (string == "fileURLToPath"_s) {
            return JSValue::encode(
                JSFunction::create(vm, globalObject, 1, fileURLToPathString, functionFileURLToPath, ImplementationVisibility::Public, NoIntrinsic));
        }

        if (string == "bun:stream"_s) {
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
        if (string == "events"_s) {
            return JSValue::encode(WebCore::JSEventEmitter::getConstructor(vm, globalObject));
        }

        if (string == "internal/crypto"_s) {
            // auto sourceOrigin = callFrame->callerSourceOrigin(vm).url();
            // bool isBuiltin = sourceOrigin.protocolIs("builtin"_s);
            // if (!isBuiltin) {
            //     return JSC::JSValue::encode(JSC::jsUndefined());
            // }
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "symmetricKeySize"_s)), JSC::JSFunction::create(vm, globalObject, 1, "symmetricKeySize"_s, KeyObject__SymmetricKeySize, ImplementationVisibility::Public, NoIntrinsic), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "asymmetricKeyType"_s)), JSC::JSFunction::create(vm, globalObject, 1, "asymmetricKeyType"_s, KeyObject__AsymmetricKeyType, ImplementationVisibility::Public, NoIntrinsic), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "asymmetricKeyDetails"_s)), JSC::JSFunction::create(vm, globalObject, 1, "asymmetricKeyDetails"_s, KeyObject_AsymmetricKeyDetails, ImplementationVisibility::Public, NoIntrinsic), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "equals"_s)), JSC::JSFunction::create(vm, globalObject, 2, "equals"_s, KeyObject__Equals, ImplementationVisibility::Public, NoIntrinsic), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "exports"_s)), JSC::JSFunction::create(vm, globalObject, 2, "exports"_s, KeyObject__Exports, ImplementationVisibility::Public, NoIntrinsic), 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createSecretKey"_s)), JSC::JSFunction::create(vm, globalObject, 1, "createSecretKey"_s, KeyObject__createSecretKey, ImplementationVisibility::Public, NoIntrinsic), 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createPublicKey"_s)), JSC::JSFunction::create(vm, globalObject, 1, "createPublicKey"_s, KeyObject__createPublicKey, ImplementationVisibility::Public, NoIntrinsic), 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createPrivateKey"_s)), JSC::JSFunction::create(vm, globalObject, 1, "createPrivateKey"_s, KeyObject__createPrivateKey, ImplementationVisibility::Public, NoIntrinsic), 0);

            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "generateKeySync"_s)), JSC::JSFunction::create(vm, globalObject, 2, "generateKeySync"_s, KeyObject__generateKeySync, ImplementationVisibility::Public, NoIntrinsic), 0);

            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "generateKeyPairSync"_s)), JSC::JSFunction::create(vm, globalObject, 2, "generateKeyPairSync"_s, KeyObject__generateKeyPairSync, ImplementationVisibility::Public, NoIntrinsic), 0);

            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "sign"_s)), JSC::JSFunction::create(vm, globalObject, 3, "sign"_s, KeyObject__Sign, ImplementationVisibility::Public, NoIntrinsic), 0);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "verify"_s)), JSC::JSFunction::create(vm, globalObject, 4, "verify"_s, KeyObject__Verify, ImplementationVisibility::Public, NoIntrinsic), 0);

            return JSValue::encode(obj);
        }

        if (string == "internal/http2"_s) {
            auto* obj = constructEmptyObject(globalObject);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "H2FrameParser"_s)), JSValue::decode(H2FrameParser__getConstructor(globalObject)), 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getPackedSettings"_s)), JSC::JSFunction::create(vm, globalObject, 1, "getPackedSettings"_s, BUN__HTTP2_getPackedSettings, ImplementationVisibility::Public, NoIntrinsic), 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getUnpackedSettings"_s)), JSC::JSFunction::create(vm, globalObject, 1, "getUnpackedSettings"_s, BUN__HTTP2__getUnpackedSettings, ImplementationVisibility::Public, NoIntrinsic), 0);
            return JSValue::encode(obj);
        }
        if (string == "internal/tls"_s) {
            auto* obj = constructEmptyObject(globalObject);

            auto sourceOrigin = callFrame->callerSourceOrigin(vm).url();
            // expose for tests in debug mode only
            // #ifndef BUN_DEBUG
            //             bool isBuiltin = sourceOrigin.protocolIs("builtin"_s);
            //             if (!isBuiltin) {
            //                 return JSC::JSValue::encode(JSC::jsUndefined());
            //             }
            // #endif
            struct us_cert_string_t* out;
            auto size = us_raw_root_certs(&out);
            if (size < 0) {
                return JSValue::encode(JSC::jsUndefined());
            }
            auto rootCertificates = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), size);
            for (auto i = 0; i < size; i++) {
                auto raw = out[i];
                auto str = WTF::String::fromUTF8(raw.str, raw.len);
                rootCertificates->putDirectIndex(globalObject, i, JSC::jsString(vm, str));
            }
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "rootCertificates"_s)), rootCertificates, 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "canonicalizeIP"_s)), JSC::JSFunction::create(vm, globalObject, 1, "canonicalizeIP"_s, Bun__canonicalizeIP, ImplementationVisibility::Public, NoIntrinsic), 0);
            return JSValue::encode(obj);
        }

        if (string == "vm"_s) {
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Script"_s)),
                reinterpret_cast<Zig::GlobalObject*>(globalObject)->NodeVMScript(), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createContext"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "createContext"_s, vmModule_createContext, ImplementationVisibility::Public), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "isContext"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "isContext"_s, vmModule_isContext, ImplementationVisibility::Public), 0);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInNewContext"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "runInNewContext"_s, vmModuleRunInNewContext, ImplementationVisibility::Public), 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInThisContext"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "runInThisContext"_s, vmModuleRunInThisContext, ImplementationVisibility::Public), 0);
            return JSValue::encode(obj);
        }

        if (string == "async_hooks"_s) {
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setAsyncHooksEnabled"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "setAsyncHooksEnabled"_s, asyncHooksSetEnabled, ImplementationVisibility::Public), 0);

            obj->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "cleanupLater"_s)),
                JSC::JSFunction::create(vm, globalObject, 0, "cleanupLater"_s, asyncHooksCleanupLater, ImplementationVisibility::Public), 0);
            return JSValue::encode(obj);
        }

        if (string == "tty"_s) {
            return JSValue::encode(Bun::createBunTTYFunctions(lexicalGlobalObject));
        }

        if (string == "unstable_syntaxHighlight"_s) {
            JSFunction* syntaxHighlight = JSFunction::create(vm, globalObject, 1, "syntaxHighlight"_s, BunInternalFunction__syntaxHighlighter, ImplementationVisibility::Public);

            return JSValue::encode(syntaxHighlight);
        }

        if (UNLIKELY(string == "noop"_s)) {
            auto* obj = constructEmptyObject(globalObject);
            obj->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getterSetter"_s)), JSC::CustomGetterSetter::create(vm, noop_getter, noop_setter), 0);
            Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(vm, reinterpret_cast<Zig::GlobalObject*>(globalObject), 0, String(), functionNoop, JSC::NoIntrinsic);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "function"_s)), function, 0);
            obj->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "functionRegular"_s), 1, functionNoop, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
            obj->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "callback"_s), 1, functionCallback, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
            return JSC::JSValue::encode(obj);
        }

        return JSC::JSValue::encode(JSC::jsUndefined());

        break;
    }
    }
}

static inline JSC::EncodedJSValue jsFunctionAddEventListenerBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, Zig::GlobalObject* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->globalEventScope;
    if (UNLIKELY(callFrame->argumentCount() < 2))
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    EnsureStillAliveScope argument1 = callFrame->uncheckedArgument(1);
    auto listener = convert<IDLNullable<IDLEventListener<JSEventListener>>>(*lexicalGlobalObject, argument1.value(), *castedThis, [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentMustBeObjectError(lexicalGlobalObject, scope, 1, "listener", "EventTarget", "addEventListener"); });
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    EnsureStillAliveScope argument2 = callFrame->argument(2);
    auto options = argument2.value().isUndefined() ? false : convert<IDLUnion<IDLDictionary<AddEventListenerOptions>, IDLBoolean>>(*lexicalGlobalObject, argument2.value());
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    auto result = JSValue::encode(WebCore::toJS<IDLUndefined>(*lexicalGlobalObject, throwScope, [&]() -> decltype(auto) { return impl.addEventListenerForBindings(WTFMove(type), WTFMove(listener), WTFMove(options)); }));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    vm.writeBarrier(&static_cast<JSObject&>(*castedThis), argument1.value());
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAddEventListener, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsFunctionAddEventListenerBody(lexicalGlobalObject, callFrame, jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject));
}

static inline JSC::EncodedJSValue jsFunctionRemoveEventListenerBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, Zig::GlobalObject* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->globalEventScope;
    if (UNLIKELY(callFrame->argumentCount() < 2))
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    EnsureStillAliveScope argument1 = callFrame->uncheckedArgument(1);
    auto listener = convert<IDLNullable<IDLEventListener<JSEventListener>>>(*lexicalGlobalObject, argument1.value(), *castedThis, [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentMustBeObjectError(lexicalGlobalObject, scope, 1, "listener", "EventTarget", "removeEventListener"); });
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    EnsureStillAliveScope argument2 = callFrame->argument(2);
    auto options = argument2.value().isUndefined() ? false : convert<IDLUnion<IDLDictionary<EventListenerOptions>, IDLBoolean>>(*lexicalGlobalObject, argument2.value());
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    auto result = JSValue::encode(WebCore::toJS<IDLUndefined>(*lexicalGlobalObject, throwScope, [&]() -> decltype(auto) { return impl.removeEventListenerForBindings(WTFMove(type), WTFMove(listener), WTFMove(options)); }));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    vm.writeBarrier(&static_cast<JSObject&>(*castedThis), argument1.value());
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionRemoveEventListener, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsFunctionRemoveEventListenerBody(lexicalGlobalObject, callFrame, jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject));
}

static inline JSC::EncodedJSValue jsFunctionDispatchEventBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, Zig::GlobalObject* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->globalEventScope;
    if (UNLIKELY(callFrame->argumentCount() < 1))
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto event = convert<IDLInterface<Event>>(*lexicalGlobalObject, argument0.value(), [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentTypeError(lexicalGlobalObject, scope, 0, "event", "EventTarget", "dispatchEvent", "Event"); });
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    RELEASE_AND_RETURN(throwScope, JSValue::encode(WebCore::toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl.dispatchEventForBindings(*event))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDispatchEvent, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsFunctionDispatchEventBody(lexicalGlobalObject, callFrame, jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject));
}

JSC_DEFINE_CUSTOM_GETTER(getterSubtleCrypto, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return JSValue::encode(reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->subtleCrypto());
}

extern "C" JSC::EncodedJSValue ExpectMatcherUtils_createSigleton(JSC::JSGlobalObject* lexicalGlobalObject);

// Do nothing.
// This is consistent with Node.js
// This makes libraries polyfilling `globalThis.crypto.subtle` not throw.
JSC_DEFINE_CUSTOM_SETTER(setterSubtleCrypto,
    (JSC::JSGlobalObject*, JSC::EncodedJSValue,
        JSC::EncodedJSValue, JSC::PropertyName))
{
    return true;
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

    bool result = WebCore::AbortSignal::whenSignalAborted(abortSignal->wrapped(), WTFMove(abortAlgorithm));
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

    if (!ReadableStream::isLocked(globalObject, readableStream)) {
        return;
    }

    WebCore::Exception exception { AbortError };
    ReadableStream::cancel(*globalObject, readableStream, exception);
}

extern "C" void ReadableStream__detach(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject);
extern "C" void ReadableStream__detach(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* readableStream = jsDynamicCast<JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream));
    if (UNLIKELY(!readableStream))
        return;
    auto& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    readableStream->putDirect(vm, clientData->builtinNames().bunNativePtrPrivateName(), jsNumber(-1), 0);
    readableStream->putDirect(vm, clientData->builtinNames().bunNativeTypePrivateName(), jsNumber(0), 0);
    readableStream->putDirect(vm, clientData->builtinNames().disturbedPrivateName(), jsBoolean(true), 0);
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

extern "C" JSC__JSValue Bun__Jest__createTestModuleObject(JSC::JSGlobalObject*);
extern "C" JSC__JSValue Bun__Jest__createTestPreloadObject(JSC::JSGlobalObject*);
extern "C" JSC__JSValue Bun__Jest__testPreloadObject(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->lazyPreloadTestModuleObject());
}
extern "C" JSC__JSValue Bun__Jest__testModuleObject(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->lazyTestModuleObject());
}

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

extern "C" JSC__JSValue ZigGlobalObject__readableStreamToFormData(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue, JSC__JSValue contentTypeValue)
{
    auto& vm = globalObject->vm();

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToFormData = globalObject->m_readableStreamToFormData.get()) {
        function = readableStreamToFormData;
    } else {
        function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToFormDataCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToFormData.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));
    arguments.append(JSValue::decode(contentTypeValue));

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

    JSValue restoreAsyncContext = {};
    InternalFieldTuple* asyncContextData = nullptr;
    auto setAsyncContext = callframe->argument(1);
    if (!setAsyncContext.isUndefined()) {
        asyncContextData = globalObject->m_asyncContextData.get();
        restoreAsyncContext = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(vm, 0, setAsyncContext);
    }

    size_t argCount = callframe->argumentCount();
    switch (argCount) {
    case 3: {
        arguments.append(callframe->uncheckedArgument(2));
        break;
    }
    case 4: {
        arguments.append(callframe->uncheckedArgument(2));
        arguments.append(callframe->uncheckedArgument(3));
        break;
    }
    default:
        break;
    }

    JSC::call(globalObject, job, callData, jsUndefined(), arguments, exceptionPtr);

    if (asyncContextData) {
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
    }

    if (auto* exception = exceptionPtr.get()) {
        Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
    }

    return JSValue::encode(jsUndefined());
}

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

    if (callframe->argumentCount() > 3) {
        thisValue = callframe->argument(3);
    }

    JSValue restoreAsyncContext = {};
    InternalFieldTuple* asyncContextData = nullptr;
    auto setAsyncContext = callframe->argument(2);
    if (!setAsyncContext.isUndefined()) {
        asyncContextData = globalObject->m_asyncContextData.get();
        restoreAsyncContext = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(vm, 0, setAsyncContext);
    }

    JSC::call(globalObject, job, callData, thisValue, arguments, exceptionPtr);

    if (asyncContextData) {
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
    }

    if (auto* exception = exceptionPtr.get()) {
        Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
    }

    return JSValue::encode(jsUndefined());
}

void GlobalObject::createCallSitesFromFrames(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSCStackTrace& stackTrace, JSC::JSArray* callSites)
{
    /* From v8's "Stack Trace API" (https://github.com/v8/v8/wiki/Stack-Trace-API):
     * "To maintain restrictions imposed on strict mode functions, frames that have a
     * strict mode function and all frames below (its caller etc.) are not allow to access
     * their receiver and function objects. For those frames, getFunction() and getThis()
     * will return undefined."." */
    bool encounteredStrictFrame = false;

    // TODO: is it safe to use CallSite structure from a different JSGlobalObject? This case would happen within a node:vm
    JSC::Structure* callSiteStructure = globalObject->callSiteStructure();
    size_t framesCount = stackTrace.size();

    for (size_t i = 0; i < framesCount; i++) {
        CallSite* callSite = CallSite::create(lexicalGlobalObject, callSiteStructure, stackTrace.at(i), encounteredStrictFrame);
        callSites->putDirectIndex(lexicalGlobalObject, i, callSite);

        if (!encounteredStrictFrame) {
            encounteredStrictFrame = callSite->isStrict();
        }
    }
}

void GlobalObject::formatStackTrace(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites, JSValue prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(this);

    if (!prepareStackTrace) {
        if (lexicalGlobalObject->inherits<Zig::GlobalObject>()) {
            if (auto prepare = this->m_errorConstructorPrepareStackTraceValue.get()) {
                prepareStackTrace = prepare;
            }
        } else {
            prepareStackTrace = errorConstructor->getIfPropertyExists(lexicalGlobalObject, JSC::Identifier::fromString(vm, "prepareStackTrace"_s));
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
        sb.append("    at "_s);
        callSite->formatAsString(vm, lexicalGlobalObject, sb);
        if (i != framesCount - 1) {
            sb.append("\n"_s);
        }
    }

    bool orignialSkipNextComputeErrorInfo = skipNextComputeErrorInfo;
    skipNextComputeErrorInfo = true;
    if (errorObject->hasProperty(lexicalGlobalObject, vm.propertyNames->stack)) {
        skipNextComputeErrorInfo = true;
        errorObject->deleteProperty(lexicalGlobalObject, vm.propertyNames->stack);
    }
    skipNextComputeErrorInfo = orignialSkipNextComputeErrorInfo;

    // In Node, if you console.log(error.stack) inside Error.prepareStackTrace
    // it will display the stack as a formatted string, so we have to do the same.
    errorObject->putDirect(vm, vm.propertyNames->stack, JSC::JSValue(jsString(vm, sb.toString())), 0);

    if (prepareStackTrace && prepareStackTrace.isCallable()) {
        JSC::CallData prepareStackTraceCallData = JSC::getCallData(prepareStackTrace);

        if (prepareStackTraceCallData.type != JSC::CallData::Type::None) {
            JSC::MarkedArgumentBuffer arguments;
            arguments.append(errorObject);
            arguments.append(callSites);

            JSC::JSValue result = profiledCall(
                lexicalGlobalObject,
                JSC::ProfilingReason::Other,
                prepareStackTrace,
                prepareStackTraceCallData,
                errorConstructor,
                arguments);

            RETURN_IF_EXCEPTION(scope, void());

            if (result.isUndefinedOrNull()) {
                result = jsUndefined();
            }

            errorObject->putDirect(vm, vm.propertyNames->stack, result, 0);
        }
    }
}

JSC_DEFINE_HOST_FUNCTION(errorConstructorFuncAppendStackTrace, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::ErrorInstance* source = jsDynamicCast<JSC::ErrorInstance*>(callFrame->argument(0));
    JSC::ErrorInstance* destination = jsDynamicCast<JSC::ErrorInstance*>(callFrame->argument(1));

    if (!source || !destination) {
        throwTypeError(lexicalGlobalObject, scope, "First & second argument must be an Error object"_s);
        return JSC::JSValue::encode(jsUndefined());
    }

    if (!destination->stackTrace()) {
        destination->captureStackTrace(vm, globalObject, 1);
    }

    if (source->stackTrace()) {
        destination->stackTrace()->appendVector(*source->stackTrace());
        source->stackTrace()->clear();
    }

    return JSC::JSValue::encode(jsUndefined());
}

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

    size_t stackTraceLimit = globalObject->stackTraceLimit().value();
    if (stackTraceLimit == 0) {
        stackTraceLimit = DEFAULT_ERROR_STACK_TRACE_LIMIT;
    }

    JSCStackTrace stackTrace = JSCStackTrace::captureCurrentJSStackTrace(globalObject, callFrame, stackTraceLimit, caller);

    // Note: we cannot use tryCreateUninitializedRestricted here because we cannot allocate memory inside initializeIndex()
    JSC::JSArray* callSites = JSC::JSArray::create(vm,
        globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
        stackTrace.size());

    // Create the call sites (one per frame)
    GlobalObject::createCallSitesFromFrames(globalObject, lexicalGlobalObject, stackTrace, callSites);

    /* Format the stack trace.
     * Note that v8 won't actually format the stack trace here, but will create a "stack" accessor
     * on the error object, which will format the stack trace on the first access. For now, since
     * we're not being used internally by JSC, we can assume callers of Error.captureStackTrace in
     * node are interested in the (formatted) stack. */

    size_t framesCount = stackTrace.size();
    ZigStackFrame remappedFrames[64];
    framesCount = framesCount > 64 ? 64 : framesCount;

    for (int i = 0; i < framesCount; i++) {
        memset(remappedFrames + i, 0, sizeof(ZigStackFrame));
        remappedFrames[i].source_url = Bun::toString(lexicalGlobalObject, stackTrace.at(i).sourceURL());
        if (JSCStackFrame::SourcePositions* sourcePositions = stackTrace.at(i).getSourcePositions()) {
            remappedFrames[i].position.line = sourcePositions->line.oneBasedInt();
            remappedFrames[i].position.column_start = sourcePositions->startColumn.oneBasedInt() + 1;
        } else {
            remappedFrames[i].position.line = -1;
            remappedFrames[i].position.column_start = -1;
        }
    }

    // remap line and column start to original source
    // XXX: this function does not fully populate the fields of ZigStackFrame,
    // be careful reading the fields below.
    Bun__remapStackFramePositions(lexicalGlobalObject, remappedFrames, framesCount);

    // write the remapped lines back to the CallSites
    for (size_t i = 0; i < framesCount; i++) {
        JSC::JSValue callSiteValue = callSites->getIndex(lexicalGlobalObject, i);
        CallSite* callSite = JSC::jsDynamicCast<CallSite*>(callSiteValue);
        if (remappedFrames[i].remapped) {
            int32_t remappedColumnStart = remappedFrames[i].position.column_start;
            JSC::JSValue columnNumber = JSC::jsNumber(remappedColumnStart);
            callSite->setColumnNumber(columnNumber);

            int32_t remappedLine = remappedFrames[i].position.line;
            JSC::JSValue lineNumber = JSC::jsNumber(remappedLine);
            callSite->setLineNumber(lineNumber);
        }
    }

    globalObject->formatStackTrace(vm, lexicalGlobalObject, errorObject, callSites, JSC::JSValue());
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));

    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" JSC::EncodedJSValue CryptoObject__create(JSGlobalObject*);

void GlobalObject::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_commonStrings.initialize();

    m_JSDOMFileConstructor.initLater(
        [](const Initializer<JSObject>& init) {
            JSObject* fileConstructor = Bun::createJSDOMFileConstructor(init.vm, init.owner);
            init.set(fileConstructor);
        });

    m_cryptoObject.initLater(
        [](const Initializer<JSObject>& init) {
            JSC::JSGlobalObject* globalObject = init.owner;
            JSObject* crypto = JSValue::decode(CryptoObject__create(globalObject)).getObject();
            crypto->putDirectCustomAccessor(
                init.vm,
                Identifier::fromString(init.vm, "subtle"_s),
                JSC::CustomGetterSetter::create(init.vm, getterSubtleCrypto, setterSubtleCrypto),
                PropertyAttribute::DontDelete | 0);

            init.set(crypto);
        });

    m_lazyRequireCacheObject.initLater(
        [](const Initializer<JSObject>& init) {
            JSC::VM& vm = init.vm;
            JSC::JSGlobalObject* globalObject = init.owner;

            auto* function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(importMetaObjectCreateRequireCacheCodeGenerator(vm)), globalObject);

            NakedPtr<JSC::Exception> returnedException = nullptr;
            auto result = JSC::call(globalObject, function, JSC::getCallData(function), globalObject, ArgList(), returnedException);
            init.set(result.toObject(globalObject));
        });

    m_lazyTestModuleObject.initLater(
        [](const Initializer<JSObject>& init) {
            JSC::VM& vm = init.vm;
            JSC::JSGlobalObject* globalObject = init.owner;

            JSValue result = JSValue::decode(Bun__Jest__createTestModuleObject(globalObject));
            init.set(result.toObject(globalObject));
        });

    m_lazyPreloadTestModuleObject.initLater(
        [](const Initializer<JSObject>& init) {
            JSC::VM& vm = init.vm;
            JSC::JSGlobalObject* globalObject = init.owner;

            JSValue result = JSValue::decode(Bun__Jest__createTestPreloadObject(globalObject));
            init.set(result.toObject(globalObject));
        });

    m_testMatcherUtilsObject.initLater(
        [](const Initializer<JSObject>& init) {
            JSValue result = JSValue::decode(ExpectMatcherUtils_createSigleton(init.owner));
            init.set(result.toObject(init.owner));
        });

    m_commonJSModuleObjectStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(Bun::createCommonJSModuleStructure(reinterpret_cast<Zig::GlobalObject*>(init.owner)));
        });

    m_JSSQLStatementStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(WebCore::createJSSQLStatementStructure(init.owner));
        });

    m_memoryFootprintStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(
                createMemoryFootprintStructure(
                    init.vm, reinterpret_cast<Zig::GlobalObject*>(init.owner)));
        });

    m_JSSocketAddressStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(JSSocketAddress::createStructure(init.vm, init.owner));
        });

    // Change prototype from null to object for synthetic modules.
    m_moduleNamespaceObjectStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(JSModuleNamespaceObject::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });

    m_vmModuleContextMap.initLater(
        [](const Initializer<JSWeakMap>& init) {
            init.set(JSWeakMap::create(init.vm, init.owner->weakMapStructure()));
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

    m_bunSleepThenCallback.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 1, "onSleep"_s, functionBunSleepThenCallback, ImplementationVisibility::Public));
        });

    m_performMicrotaskVariadicFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 4, "performMicrotaskVariadic"_s, jsFunctionPerformMicrotaskVariadic, ImplementationVisibility::Public));
        });

    m_utilInspectFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            JSValue nodeUtilValue = jsCast<Zig::GlobalObject*>(init.owner)->internalModuleRegistry()->requireId(init.owner, init.vm, Bun::InternalModuleRegistry::Field::NodeUtil);
            RELEASE_ASSERT(nodeUtilValue.isObject());
            init.set(jsCast<JSFunction*>(nodeUtilValue.getObject()->getIfPropertyExists(init.owner, Identifier::fromString(init.vm, "inspect"_s))));
        });

    m_utilInspectStylizeColorFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            auto scope = DECLARE_THROW_SCOPE(init.vm);
            JSC::JSFunction* getStylize = JSC::JSFunction::create(init.vm, utilInspectGetStylizeWithColorCodeGenerator(init.vm), init.owner);
            // RETURN_IF_EXCEPTION(scope, {});

            JSC::MarkedArgumentBuffer args;
            args.append(jsCast<Zig::GlobalObject*>(init.owner)->utilInspectFunction());

            auto clientData = WebCore::clientData(init.vm);
            JSC::CallData callData = JSC::getCallData(getStylize);

            NakedPtr<JSC::Exception> returnedException = nullptr;
            auto result = JSC::call(init.owner, getStylize, callData, jsNull(), args, returnedException);
            // RETURN_IF_EXCEPTION(scope, {});

            if (returnedException) {
                throwException(init.owner, scope, returnedException.get());
            }
            // RETURN_IF_EXCEPTION(scope, {});
            init.set(jsCast<JSFunction*>(result));
        });

    m_utilInspectStylizeNoColorFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSC::JSFunction::create(init.vm, utilInspectStylizeWithNoColorCodeGenerator(init.vm), init.owner));
        });

    m_nativeMicrotaskTrampoline.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 2, ""_s, functionNativeMicrotaskTrampoline, ImplementationVisibility::Public));
        });

    m_navigatorObject.initLater(
        [](const Initializer<JSObject>& init) {
            int cpuCount = 0;
#ifdef __APPLE__
            size_t count_len = sizeof(cpuCount);
            sysctlbyname("hw.logicalcpu", &cpuCount, &count_len, NULL, 0);
#elif OS(WINDOWS)
            SYSTEM_INFO sysinfo;
            GetSystemInfo(&sysinfo);
            cpuCount = sysinfo.dwNumberOfProcessors;
#else
            // TODO: windows
            cpuCount = sysconf(_SC_NPROCESSORS_ONLN);
#endif

            auto str = WTF::String::fromUTF8(Bun__userAgent);
            JSC::Identifier userAgentIdentifier = JSC::Identifier::fromString(init.vm, "userAgent"_s);
            JSC::Identifier hardwareConcurrencyIdentifier = JSC::Identifier::fromString(init.vm, "hardwareConcurrency"_s);

            JSC::JSObject* obj = JSC::constructEmptyObject(init.owner, init.owner->objectPrototype(), 4);
            obj->putDirect(init.vm, userAgentIdentifier, JSC::jsString(init.vm, str));
            obj->putDirect(init.vm, init.vm.propertyNames->toStringTagSymbol,
                jsNontrivialString(init.vm, "Navigator"_s), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);

// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform
// https://github.com/oven-sh/bun/issues/4588
#if OS(DARWIN)
            obj->putDirect(init.vm, JSC::Identifier::fromString(init.vm, "platform"_s), JSC::jsString(init.vm, String("MacIntel"_s)));
#elif OS(WINDOWS)
            obj->putDirect(init.vm, JSC::Identifier::fromString(init.vm, "platform"_s), JSC::jsString(init.vm, String("Win32"_s)));
#elif OS(LINUX)
            obj->putDirect(init.vm, JSC::Identifier::fromString(init.vm, "platform"_s), JSC::jsString(init.vm, String("Linux x86_64"_s)));
#endif

            obj->putDirect(init.vm, hardwareConcurrencyIdentifier, JSC::jsNumber(cpuCount));
            init.set(obj);
        });

    this->m_pendingVirtualModuleResultStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(Bun::PendingVirtualModuleResult::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });

    m_bunObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSObject>::Initializer& init) {
            init.set(Bun::createBunObject(init.vm, init.owner));
        });

    this->initGeneratedLazyClasses();

    m_NapiExternalStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            auto& global = *reinterpret_cast<Zig::GlobalObject*>(init.owner);

            init.set(
                Bun::NapiExternal::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });

    m_NAPIFunctionStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(
                Zig::createNAPIFunctionStructure(init.vm, init.owner));
        });

    m_NapiPrototypeStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            auto& global = *reinterpret_cast<Zig::GlobalObject*>(init.owner);

            init.set(
                Bun::NapiPrototype::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });

    m_cachedGlobalObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            auto& global = *reinterpret_cast<Zig::GlobalObject*>(init.owner);

            init.set(
                JSC::JSGlobalObject::createStructure(init.vm, JSC::jsNull()));
        });

    m_cachedGlobalProxyStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(
                JSC::JSGlobalProxy::createStructure(init.vm, init.owner, JSC::jsNull()));
        });

    m_subtleCryptoObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto& global = *reinterpret_cast<Zig::GlobalObject*>(init.owner);

            if (!global.m_subtleCrypto) {
                global.m_subtleCrypto = &WebCore::SubtleCrypto::create(global.scriptExecutionContext()).leakRef();
            }

            init.set(toJS<IDLInterface<SubtleCrypto>>(*init.owner, global, global.m_subtleCrypto).getObject());
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

    m_JSUVStreamSinkControllerPrototype.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::UVStreamSink);
            init.set(prototype);
        });

    m_performanceObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(init.owner);
            init.set(toJS(init.owner, globalObject, globalObject->performance().get()).getObject());
        });

    m_processEnvObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            init.set(Bun::createEnvironmentVariablesMap(reinterpret_cast<Zig::GlobalObject*>(init.owner)).getObject());
        });

    m_processObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(init.owner);
            auto* process = Bun::Process::create(
                *globalObject, Bun::Process::createStructure(init.vm, init.owner, WebCore::JSEventEmitter::prototype(init.vm, *globalObject)));

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

    m_esmRegistryMap.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSMap>::Initializer& init) {
            auto* global = init.owner;
            auto& vm = init.vm;
            JSMap* registry = nullptr;
            if (auto loaderValue = global->getIfPropertyExists(global, JSC::Identifier::fromString(vm, "Loader"_s))) {
                if (auto registryValue = loaderValue.getObject()->getIfPropertyExists(global, JSC::Identifier::fromString(vm, "registry"_s))) {
                    registry = jsCast<JSC::JSMap*>(registryValue);
                }
            }

            if (!registry) {
                registry = JSC::JSMap::create(init.vm, init.owner->mapStructure());
            }

            init.set(registry);
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

    m_requireFunctionUnbound.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            init.set(
                JSFunction::create(
                    init.vm,
                    moduleRequireCodeGenerator(init.vm),
                    init.owner->globalScope(),
                    JSFunction::createStructure(init.vm, init.owner, RequireFunctionPrototype::create(init.owner))));
        });

    m_requireResolveFunctionUnbound.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            init.set(
                JSFunction::create(
                    init.vm,
                    moduleRequireResolveCodeGenerator(init.vm),
                    init.owner->globalScope(),
                    JSFunction::createStructure(init.vm, init.owner, RequireResolveFunctionPrototype::create(init.owner))));
        });

    m_internalModuleRegistry.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Bun::InternalModuleRegistry>::Initializer& init) {
            init.set(
                InternalModuleRegistry::create(
                    init.vm,
                    InternalModuleRegistry::createStructure(init.vm, init.owner)));
        });

    m_processBindingConstants.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            init.set(
                ProcessBindingConstants::create(
                    init.vm,
                    ProcessBindingConstants::createStructure(init.vm, init.owner)));
        });

    m_importMetaObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            init.set(Zig::ImportMetaObject::createStructure(init.vm, init.owner));
        });

    m_asyncBoundFunctionStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            init.set(AsyncContextFrame::createStructure(init.vm, init.owner));
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

    m_JSCryptoKey.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(init.owner);
            auto* prototype = JSCryptoKey::createPrototype(init.vm, *globalObject);
            auto* structure = JSCryptoKey::createStructure(init.vm, init.owner, JSValue(prototype));
            init.set(structure);
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

    m_JSUVStreamSinkClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::UVStreamSink);
            auto* structure = JSUVStreamSink::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSUVStreamSinkConstructor::create(init.vm, init.global, JSUVStreamSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<JSObject*>(prototype));
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

    m_NodeVMScriptClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = NodeVMScript::createPrototype(init.vm, init.global);
            auto* structure = NodeVMScript::createStructure(init.vm, init.global, prototype);
            auto* constructorStructure = NodeVMScriptConstructor::createStructure(
                init.vm, init.global, init.global->m_functionPrototype.get());
            auto* constructor = NodeVMScriptConstructor::create(
                init.vm, init.global, constructorStructure, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

#if ENABLE(REMOTE_INSPECTOR)
    setInspectable(false);
#endif

    addBuiltinGlobals(vm);

    ASSERT(classInfo());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionPostMessage,
    (JSC::JSGlobalObject * leixcalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = leixcalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Zig::GlobalObject* globalObject = jsDynamicCast<Zig::GlobalObject*>(leixcalGlobalObject);
    if (UNLIKELY(!globalObject))
        return JSValue::encode(jsUndefined());

    Worker* worker = WebWorker__getParentWorker(globalObject->bunVM());
    if (worker == nullptr)
        return JSValue::encode(jsUndefined());

    ScriptExecutionContext* context = worker->scriptExecutionContext();

    if (!context)
        return JSValue::encode(jsUndefined());

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue options = callFrame->argument(1);

    Vector<JSC::Strong<JSC::JSObject>> transferList;

    if (options.isObject()) {
        JSC::JSObject* optionsObject = options.getObject();
        JSC::JSValue transferListValue = optionsObject->get(globalObject, vm.propertyNames->transfer);
        if (transferListValue.isObject()) {
            JSC::JSObject* transferListObject = transferListValue.getObject();
            if (auto* transferListArray = jsDynamicCast<JSC::JSArray*>(transferListObject)) {
                for (unsigned i = 0; i < transferListArray->length(); i++) {
                    JSC::JSValue transferListValue = transferListArray->get(globalObject, i);
                    if (transferListValue.isObject()) {
                        JSC::JSObject* transferListObject = transferListValue.getObject();
                        transferList.append(JSC::Strong<JSC::JSObject>(vm, transferListObject));
                    }
                }
            }
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTFMove(transferList), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        return JSValue::encode(jsUndefined());
    }

    ExceptionOr<Vector<TransferredMessagePort>> disentangledPorts = MessagePort::disentanglePorts(WTFMove(ports));
    if (disentangledPorts.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        return JSValue::encode(jsUndefined());
    }

    MessageWithMessagePorts messageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() };

    ScriptExecutionContext::postTaskTo(context->identifier(), [message = messageWithMessagePorts, protectedThis = Ref { *worker }, ports](ScriptExecutionContext& context) mutable {
        Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(context.jsGlobalObject());

        auto ports = MessagePort::entanglePorts(context, WTFMove(message.transferredPorts));
        auto event = MessageEvent::create(*globalObject, message.message.releaseNonNull(), std::nullopt, WTFMove(ports));

        protectedThis->dispatchEvent(event.event);
    });

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(JSDOMFileConstructor_getter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    Zig::GlobalObject* bunGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(
        bunGlobalObject->JSDOMFileConstructor());
}

JSC_DEFINE_CUSTOM_SETTER(JSDOMFileConstructor_setter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName property))
{
    if (JSValue::decode(thisValue) != globalObject) {
        return false;
    }

    auto& vm = globalObject->vm();
    globalObject->putDirect(vm, property, JSValue::decode(value), 0);
    return true;
}

extern "C" JSC__JSValue Bun__Timer__setImmediate(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue JSValue3);
// https://developer.mozilla.org/en-US/docs/Web/API/Window/setImmediate
JSC_DEFINE_HOST_FUNCTION(functionSetImmediate,
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
    size_t argumentCount = callFrame->argumentCount();
    if (argumentCount > 1) {
        JSC::ObjectInitializationScope initializationScope(globalObject->vm());
        JSC::JSArray* argumentsArray = JSC::JSArray::tryCreateUninitializedRestricted(
            initializationScope, nullptr,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            argumentCount - 1);

        if (UNLIKELY(!argumentsArray)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        for (size_t i = 1; i < argumentCount; i++) {
            argumentsArray->putDirectIndex(globalObject, i - 1, callFrame->uncheckedArgument(i));
        }
        arguments = JSValue(argumentsArray);
    }
    return Bun__Timer__setImmediate(globalObject, JSC::JSValue::encode(job), JSValue::encode(arguments));
}

JSValue getEventSourceConstructor(VM& vm, JSObject* thisObject)
{
    auto globalObject = jsCast<Zig::GlobalObject*>(thisObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSFunction* getSourceEvent = JSC::JSFunction::create(vm, eventSourceGetEventSourceCodeGenerator(vm), globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::MarkedArgumentBuffer args;

    auto clientData = WebCore::clientData(vm);
    JSC::CallData callData = JSC::getCallData(getSourceEvent);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, getSourceEvent, callData, globalObject->globalThis(), args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (returnedException) {
        throwException(globalObject, scope, returnedException.get());
        return jsUndefined();
    }

    RELEASE_AND_RETURN(scope, result);
}

// `console.Console` or `import { Console } from 'console';`
JSC_DEFINE_CUSTOM_GETTER(getConsoleConstructor, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = globalObject->vm();
    auto console = JSValue::decode(thisValue).getObject();
    JSC::JSFunction* createConsoleConstructor = JSC::JSFunction::create(vm, consoleObjectCreateConsoleConstructorCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(console);
    JSC::CallData callData = JSC::getCallData(createConsoleConstructor);
    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, createConsoleConstructor, callData, console, args, returnedException);
    if (returnedException) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwException(globalObject, scope, returnedException.get());
    }
    console->putDirect(vm, property, result, 0);
    return JSValue::encode(result);
}

// `console._stdout` is equal to `process.stdout`
JSC_DEFINE_CUSTOM_GETTER(getConsoleStdout, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = globalObject->vm();
    auto console = JSValue::decode(thisValue).getObject();
    auto global = jsCast<Zig::GlobalObject*>(globalObject);

    // instead of calling the constructor builtin, go through the process.stdout getter to ensure it's only created once.
    auto stdoutValue = global->processObject()->get(globalObject, Identifier::fromString(vm, "stdout"_s));
    if (!stdoutValue)
        return JSValue::encode({});

    console->putDirect(vm, property, stdoutValue, PropertyAttribute::DontEnum | 0);
    return JSValue::encode(stdoutValue);
}

// `console._stderr` is equal to `process.stderr`
JSC_DEFINE_CUSTOM_GETTER(getConsoleStderr, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = globalObject->vm();
    auto console = JSValue::decode(thisValue).getObject();
    auto global = jsCast<Zig::GlobalObject*>(globalObject);

    // instead of calling the constructor builtin, go through the process.stdout getter to ensure it's only created once.
    auto stderrValue = global->processObject()->get(globalObject, Identifier::fromString(vm, "stderr"_s));
    if (!stderrValue)
        return JSValue::encode({});

    console->putDirect(vm, property, stderrValue, PropertyAttribute::DontEnum | 0);
    return JSValue::encode(stderrValue);
}

JSC_DEFINE_CUSTOM_SETTER(EventSource_setter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName property))
{
    if (JSValue::decode(thisValue) != globalObject) {
        return false;
    }

    auto& vm = globalObject->vm();
    globalObject->putDirect(vm, property, JSValue::decode(value), 0);
    return true;
}

EncodedJSValue GlobalObject::assignToStream(JSValue stream, JSValue controller)
{
    JSC::VM& vm = this->vm();
    JSC::JSFunction* function = this->m_assignToStream.get();
    if (!function) {
        function = JSFunction::create(vm, static_cast<JSC::FunctionExecutable*>(readableStreamInternalsAssignToStreamCodeGenerator(vm)), this);
        this->m_assignToStream.set(vm, this, function);
    }

    auto callData = JSC::getCallData(function);
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(stream);
    arguments.append(controller);

    WTF::NakedPtr<JSC::Exception> returnedException = nullptr;

    auto result = JSC::profiledCall(this, ProfilingReason::API, function, callData, JSC::jsUndefined(), arguments, returnedException);
    if (auto* exception = returnedException.get()) {
        return JSC::JSValue::encode(exception);
    }

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

    readableStream->putDirect(vm, clientData->builtinNames().bunNativePtrPrivateName(), jsNumber(0), 0);
    // -1 === detached
    readableStream->putDirect(vm, clientData->builtinNames().bunNativeTypePrivateName(), jsNumber(-1), 0);
    readableStream->putDirect(vm, clientData->builtinNames().disturbedPrivateName(), jsBoolean(true), 0);

    auto* resultObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    resultObject->putDirect(vm, clientData->builtinNames().streamPublicName(), ptrValue, 0);
    resultObject->putDirect(vm, clientData->builtinNames().dataPublicName(), typeValue, 0);

    return JSC::JSValue::encode(resultObject);
}
JSC::GCClient::IsoSubspace* GlobalObject::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<GlobalObject, WebCore::UseCustomHeapCellType::Yes>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWorkerGlobalScope.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWorkerGlobalScope = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWorkerGlobalScope.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWorkerGlobalScope = std::forward<decltype(space)>(space); },
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSWorkerGlobalScope; });
}

extern "C" JSC::EncodedJSValue WebCore__alert(JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue WebCore__prompt(JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue WebCore__confirm(JSC::JSGlobalObject*, JSC::CallFrame*);

JSValue GlobalObject_getPerformanceObject(VM& vm, JSObject* globalObject)
{
    return jsCast<Zig::GlobalObject*>(globalObject)->performanceObject();
}

JSValue GlobalObject_getGlobalThis(VM& vm, JSObject* globalObject)
{
    return jsCast<Zig::GlobalObject*>(globalObject)->globalThis();
}

// This is like `putDirectBuiltinFunction` but for the global static list.
#define globalBuiltinFunction(vm, globalObject, identifier, function, attributes) JSC::JSGlobalObject::GlobalPropertyInfo(identifier, JSFunction::create(vm, function, globalObject), attributes)

void GlobalObject::addBuiltinGlobals(JSC::VM& vm)
{
    m_builtinInternalFunctions.initialize(*this);

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    // ----- Private/Static Properties -----

    auto $lazy = JSC::JSFunction::create(vm, this, 0, "$lazy"_s, functionLazyLoad, ImplementationVisibility::Public);

    GlobalPropertyInfo staticGlobals[] = {
        GlobalPropertyInfo { builtinNames.startDirectStreamPrivateName(),
            JSC::JSFunction::create(vm, this, 1,
                String(), functionStartDirectStream, ImplementationVisibility::Public),
            PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0 },

        // TODO: Remove the "Bun.lazy" symbol
        // The reason we cant do this easily is our tests rely on this being public to test the internals.
        GlobalPropertyInfo { JSC::Identifier::fromUid(vm.symbolRegistry().symbolForKey(MAKE_STATIC_STRING_IMPL("Bun.lazy"))),
            $lazy,
            PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | 0 },

        GlobalPropertyInfo { builtinNames.lazyPrivateName(),
            $lazy,
            PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | 0 },

        GlobalPropertyInfo(builtinNames.makeThisTypeErrorPrivateName(), JSFunction::create(vm, this, 2, String(), makeThisTypeErrorForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.makeGetterTypeErrorPrivateName(), JSFunction::create(vm, this, 2, String(), makeGetterTypeErrorForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.makeDOMExceptionPrivateName(), JSFunction::create(vm, this, 2, String(), makeDOMExceptionForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.whenSignalAbortedPrivateName(), JSFunction::create(vm, this, 2, String(), whenSignalAborted, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.cloneArrayBufferPrivateName(), JSFunction::create(vm, this, 3, String(), cloneArrayBuffer, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.structuredCloneForStreamPrivateName(), JSFunction::create(vm, this, 1, String(), structuredCloneForStream, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.isAbortSignalPrivateName(), JSFunction::create(vm, this, 1, String(), isAbortSignal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.getInternalWritableStreamPrivateName(), JSFunction::create(vm, this, 1, String(), getInternalWritableStream, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.createWritableStreamFromInternalPrivateName(), JSFunction::create(vm, this, 1, String(), createWritableStreamFromInternal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.fulfillModuleSyncPrivateName(), JSFunction::create(vm, this, 1, String(), functionFulfillModuleSync, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.directPrivateName(), JSFunction::create(vm, this, 1, String(), functionGetDirectStreamDetails, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(vm.propertyNames->builtinNames().ArrayBufferPrivateName(), arrayBufferConstructor(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.LoaderPrivateName(), this->moduleLoader(), PropertyAttribute::DontDelete | 0),
        GlobalPropertyInfo(builtinNames.internalModuleRegistryPrivateName(), this->internalModuleRegistry(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.processBindingConstantsPrivateName(), this->processBindingConstants(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.requireMapPrivateName(), this->requireMap(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0),
    };
    addStaticGlobals(staticGlobals, std::size(staticGlobals));

    // TODO: most/all of these private properties can be made as static globals.
    // i've noticed doing it as is will work somewhat but getDirect() wont be able to find them

    putDirectBuiltinFunction(vm, this, builtinNames.createFIFOPrivateName(), streamInternalsCreateFIFOCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.createEmptyReadableStreamPrivateName(), readableStreamCreateEmptyReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.createUsedReadableStreamPrivateName(), readableStreamCreateUsedReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.consumeReadableStreamPrivateName(), readableStreamConsumeReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.createNativeReadableStreamPrivateName(), readableStreamCreateNativeReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.requireESMPrivateName(), importMetaObjectRequireESMCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.loadCJS2ESMPrivateName(), importMetaObjectLoadCJS2ESMCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.internalRequirePrivateName(), importMetaObjectInternalRequireCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.requireNativeModulePrivateName(), moduleRequireNativeModuleCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    putDirectBuiltinFunction(vm, this, builtinNames.overridableRequirePrivateName(), moduleOverridableRequireCodeGenerator(vm), 0);

    putDirectNativeFunction(vm, this, builtinNames.createUninitializedArrayBufferPrivateName(), 1, functionCreateUninitializedArrayBuffer, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectNativeFunction(vm, this, builtinNames.resolveSyncPrivateName(), 1, functionImportMeta__resolveSyncPrivate, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectNativeFunction(vm, this, builtinNames.createInternalModuleByIdPrivateName(), 1, InternalModuleRegistry::jsCreateInternalModuleById, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    putDirectNativeFunction(vm, this,
        builtinNames.createCommonJSModulePrivateName(),
        2,
        Bun::jsFunctionCreateCommonJSModule,
        ImplementationVisibility::Public,
        NoIntrinsic,
        PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | 0);
    putDirectNativeFunction(vm, this,
        builtinNames.evaluateCommonJSModulePrivateName(),
        2,
        Bun::jsFunctionLoadModule,
        ImplementationVisibility::Public,
        NoIntrinsic,
        PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().BufferPrivateName(), JSC::CustomGetterSetter::create(vm, JSBuffer_getter, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.lazyStreamPrototypeMapPrivateName(), JSC::CustomGetterSetter::create(vm, functionLazyLoadStreamPrototypeMap_getter, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.TransformStreamPrivateName(), CustomGetterSetter::create(vm, TransformStream_getter, nullptr), attributesForStructure(static_cast<unsigned>(PropertyAttribute::DontEnum)) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.TransformStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, TransformStreamDefaultController_getter, nullptr), attributesForStructure(static_cast<unsigned>(PropertyAttribute::DontEnum)) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableByteStreamControllerPrivateName(), CustomGetterSetter::create(vm, ReadableByteStreamController_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamPrivateName(), CustomGetterSetter::create(vm, ReadableStream_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamBYOBReaderPrivateName(), CustomGetterSetter::create(vm, ReadableStreamBYOBReader_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamBYOBRequestPrivateName(), CustomGetterSetter::create(vm, ReadableStreamBYOBRequest_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, ReadableStreamDefaultController_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamDefaultReaderPrivateName(), CustomGetterSetter::create(vm, ReadableStreamDefaultReader_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.WritableStreamPrivateName(), CustomGetterSetter::create(vm, WritableStream_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.WritableStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, WritableStreamDefaultController_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.WritableStreamDefaultWriterPrivateName(), CustomGetterSetter::create(vm, WritableStreamDefaultWriter_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomAccessorOrValue);
    putDirectCustomAccessor(vm, builtinNames.AbortSignalPrivateName(), CustomGetterSetter::create(vm, AbortSignal_getter, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessorOrValue);

    // ----- Public Properties -----

    // a direct accessor (uses js functions for get and set) cannot be on the lookup table. i think.
    putDirectAccessor(
        this,
        builtinNames.selfPublicName(),
        JSC::GetterSetter::create(
            vm,
            this,
            JSFunction::create(vm, this, 0, "get"_s, functionGetSelf, ImplementationVisibility::Public),
            JSFunction::create(vm, this, 0, "set"_s, functionSetSelf, ImplementationVisibility::Public)),
        PropertyAttribute::Accessor | 0);

    // TODO: this should be usable on the lookup table. it crashed las time i tried it
    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "onmessage"_s), JSC::CustomGetterSetter::create(vm, globalOnMessage, setGlobalOnMessage), 0);
    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "onerror"_s), JSC::CustomGetterSetter::create(vm, globalOnError, setGlobalOnError), 0);

    // ----- Extensions to Built-in objects -----

    JSC::JSObject* errorConstructor = this->errorConstructor();
    errorConstructor->putDirectNativeFunction(vm, this, JSC::Identifier::fromString(vm, "captureStackTrace"_s), 2, errorConstructorFuncCaptureStackTrace, ImplementationVisibility::Public, JSC::NoIntrinsic, PropertyAttribute::DontEnum | 0);
    errorConstructor->putDirectNativeFunction(vm, this, JSC::Identifier::fromString(vm, "appendStackTrace"_s), 2, errorConstructorFuncAppendStackTrace, ImplementationVisibility::Private, JSC::NoIntrinsic, PropertyAttribute::DontEnum | 0);
    errorConstructor->putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "prepareStackTrace"_s), JSC::CustomGetterSetter::create(vm, errorConstructorPrepareStackTraceGetter, errorConstructorPrepareStackTraceSetter), PropertyAttribute::DontEnum | PropertyAttribute::CustomValue);

    JSC::JSObject* consoleObject = this->get(this, JSC::Identifier::fromString(vm, "console"_s)).getObject();
    consoleObject->putDirectBuiltinFunction(vm, this, vm.propertyNames->asyncIteratorSymbol, consoleObjectAsyncIteratorCodeGenerator(vm), PropertyAttribute::Builtin | 0);
    consoleObject->putDirectBuiltinFunction(vm, this, clientData->builtinNames().writePublicName(), consoleObjectWriteCodeGenerator(vm), PropertyAttribute::Builtin | 0);
    consoleObject->putDirectCustomAccessor(vm, Identifier::fromString(vm, "Console"_s), CustomGetterSetter::create(vm, getConsoleConstructor, nullptr), PropertyAttribute::CustomValue | 0);
    consoleObject->putDirectCustomAccessor(vm, Identifier::fromString(vm, "_stdout"_s), CustomGetterSetter::create(vm, getConsoleStdout, nullptr), PropertyAttribute::DontEnum | PropertyAttribute::CustomValue | 0);
    consoleObject->putDirectCustomAccessor(vm, Identifier::fromString(vm, "_stderr"_s), CustomGetterSetter::create(vm, getConsoleStderr, nullptr), PropertyAttribute::DontEnum | PropertyAttribute::CustomValue | 0);
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

void GlobalObject::drainMicrotasks()
{
    auto& vm = this->vm();
    if (auto nextTickQueue = this->m_nextTickQueue.get()) {
        Bun::JSNextTickQueue* queue = jsCast<Bun::JSNextTickQueue*>(nextTickQueue);
        queue->drain(vm, this);
        return;
    }

    vm.drainMicrotasks();
}

extern "C" void JSC__JSGlobalObject__drainMicrotasks(Zig::GlobalObject* globalObject)
{
    globalObject->drainMicrotasks();
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
    thisObject->m_commonStrings.visit<Visitor>(visitor);
    visitor.append(thisObject->m_assignToStream);
    visitor.append(thisObject->m_readableStreamToArrayBuffer);
    visitor.append(thisObject->m_readableStreamToArrayBufferResolve);
    visitor.append(thisObject->m_readableStreamToBlob);
    visitor.append(thisObject->m_readableStreamToJSON);
    visitor.append(thisObject->m_readableStreamToText);
    visitor.append(thisObject->m_readableStreamToFormData);
    visitor.append(thisObject->m_nodeModuleOverriddenResolveFilename);

    visitor.append(thisObject->m_nextTickQueue);
    visitor.append(thisObject->m_errorConstructorPrepareStackTraceValue);

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
    thisObject->m_NodeVMScriptClassStructure.visit(visitor);

    thisObject->m_pendingVirtualModuleResultStructure.visit(visitor);
    thisObject->m_performMicrotaskFunction.visit(visitor);
    thisObject->m_performMicrotaskVariadicFunction.visit(visitor);
    thisObject->m_utilInspectFunction.visit(visitor);
    thisObject->m_utilInspectStylizeColorFunction.visit(visitor);
    thisObject->m_utilInspectStylizeNoColorFunction.visit(visitor);
    thisObject->m_lazyReadableStreamPrototypeMap.visit(visitor);
    thisObject->m_requireMap.visit(visitor);
    thisObject->m_esmRegistryMap.visit(visitor);
    thisObject->m_encodeIntoObjectStructure.visit(visitor);
    thisObject->m_JSArrayBufferControllerPrototype.visit(visitor);
    thisObject->m_JSFileSinkControllerPrototype.visit(visitor);
    thisObject->m_JSHTTPSResponseControllerPrototype.visit(visitor);
    thisObject->m_JSUVStreamSinkControllerPrototype.visit(visitor);
    thisObject->m_navigatorObject.visit(visitor);
    thisObject->m_nativeMicrotaskTrampoline.visit(visitor);
    thisObject->m_performanceObject.visit(visitor);
    thisObject->m_processEnvObject.visit(visitor);
    thisObject->m_processObject.visit(visitor);
    thisObject->m_bunObject.visit(visitor);
    thisObject->m_subtleCryptoObject.visit(visitor);
    thisObject->m_JSHTTPResponseController.visit(visitor);
    thisObject->m_callSiteStructure.visit(visitor);
    thisObject->m_emitReadableNextTickFunction.visit(visitor);
    thisObject->m_JSBufferSubclassStructure.visit(visitor);
    thisObject->m_JSCryptoKey.visit(visitor);

    thisObject->m_cryptoObject.visit(visitor);
    thisObject->m_JSDOMFileConstructor.visit(visitor);

    thisObject->m_requireFunctionUnbound.visit(visitor);
    thisObject->m_requireResolveFunctionUnbound.visit(visitor);
    thisObject->m_importMetaObjectStructure.visit(visitor);
    thisObject->m_asyncBoundFunctionStructure.visit(visitor);
    thisObject->m_internalModuleRegistry.visit(visitor);

    thisObject->m_lazyRequireCacheObject.visit(visitor);
    thisObject->m_vmModuleContextMap.visit(visitor);
    thisObject->m_bunSleepThenCallback.visit(visitor);
    thisObject->m_lazyTestModuleObject.visit(visitor);
    thisObject->m_lazyPreloadTestModuleObject.visit(visitor);
    thisObject->m_testMatcherUtilsObject.visit(visitor);
    thisObject->m_commonJSModuleObjectStructure.visit(visitor);
    thisObject->m_JSSQLStatementStructure.visit(visitor);
    thisObject->m_memoryFootprintStructure.visit(visitor);
    thisObject->m_JSSocketAddressStructure.visit(visitor);
    thisObject->m_cachedGlobalObjectStructure.visit(visitor);
    thisObject->m_cachedGlobalProxyStructure.visit(visitor);
    thisObject->m_NapiExternalStructure.visit(visitor);
    thisObject->m_NapiPrototypeStructure.visit(visitor);
    thisObject->m_NAPIFunctionStructure.visit(visitor);

    thisObject->mockModule.mockFunctionStructure.visit(visitor);
    thisObject->mockModule.mockResultStructure.visit(visitor);
    thisObject->mockModule.mockImplementationStructure.visit(visitor);
    thisObject->mockModule.mockObjectStructure.visit(visitor);
    thisObject->mockModule.mockModuleStructure.visit(visitor);
    thisObject->mockModule.activeSpySetStructure.visit(visitor);
    thisObject->mockModule.mockWithImplementationCleanupDataStructure.visit(visitor);
    thisObject->mockModule.withImplementationCleanupFunction.visit(visitor);

    for (auto& barrier : thisObject->m_thenables) {
        visitor.append(barrier);
    }

    thisObject->visitGeneratedLazyClasses<Visitor>(thisObject, visitor);
    thisObject->visitAdditionalChildren<Visitor>(visitor);
}

extern "C" bool JSGlobalObject__setTimeZone(JSC::JSGlobalObject* globalObject, const ZigString* timeZone)
{
    auto& vm = globalObject->vm();

    if (WTF::setTimeZoneOverride(Zig::toString(*timeZone))) {
        vm.dateCache.resetIfNecessarySlow();
        return true;
    }

    return false;
}

extern "C" void JSGlobalObject__throwTerminationException(JSC::JSGlobalObject* globalObject)
{
    globalObject->vm().setHasTerminationRequest();
}

extern "C" void JSGlobalObject__clearTerminationException(JSC::JSGlobalObject* globalObject)
{
    globalObject->vm().clearHasTerminationRequest();
}

extern "C" void Bun__queueTask(JSC__JSGlobalObject*, WebCore::EventLoopTask* task);
extern "C" void Bun__queueTaskWithTimeout(JSC__JSGlobalObject*, WebCore::EventLoopTask* task, int timeout);
extern "C" void Bun__queueTaskConcurrently(JSC__JSGlobalObject*, WebCore::EventLoopTask* task);
extern "C" void Bun__performTask(Zig::GlobalObject* globalObject, WebCore::EventLoopTask* task)
{
    task->performTask(*globalObject->scriptExecutionContext());
}

RefPtr<Performance> GlobalObject::performance()
{
    if (!m_performance) {
        auto* context = this->scriptExecutionContext();
        double nanoTimeOrigin = Bun__readOriginTimerStart(this->bunVM());
        auto timeOrigin = MonotonicTime::fromRawSeconds(nanoTimeOrigin / 1000.0);
        m_performance = Performance::create(context, timeOrigin);
    }

    return m_performance;
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

template<typename Visitor>
void GlobalObject::visitAdditionalChildren(Visitor& visitor)
{
    GlobalObject* thisObject = this;
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());

    thisObject->globalEventScope.visitJSEventListeners(visitor);

    ScriptExecutionContext* context = thisObject->scriptExecutionContext();
    visitor.addOpaqueRoot(context);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(GlobalObject);

template<typename Visitor>
void GlobalObject::visitOutputConstraints(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<GlobalObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitOutputConstraints(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}

template void GlobalObject::visitOutputConstraints(JSCell*, AbstractSlotVisitor&);
template void GlobalObject::visitOutputConstraints(JSCell*, SlotVisitor&);

// void GlobalObject::destroy(JSCell* cell)
// {
//     jsCast<Zig::GlobalObject*>(cell)->Zig::GlobalObject::~Zig::GlobalObject();
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

    // If we run the GC every time, we will never get the SourceProvider cache hit.
    // So we run the GC every other time.
    if ((this->reloadCount++ + 1) % 2 == 0) {
        this->vm().heap.collectSync();
    }
}

extern "C" void JSC__JSGlobalObject__reload(JSC__JSGlobalObject* arg0)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    globalObject->reload();
}

extern "C" void JSC__JSGlobalObject__queueMicrotaskCallback(Zig::GlobalObject* globalObject, void* ptr, MicrotaskCallback callback)
{
    JSFunction* function = globalObject->nativeMicrotaskTrampoline();

    // Do not use JSCell* here because the GC will try to visit it.
    globalObject->queueMicrotask(function, JSValue(bitwise_cast<double>(reinterpret_cast<uintptr_t>(ptr))), JSValue(bitwise_cast<double>(reinterpret_cast<uintptr_t>(callback))), jsUndefined(), jsUndefined());
}

JSC::Identifier GlobalObject::moduleLoaderResolve(JSGlobalObject* jsGlobalObject,
    JSModuleLoader* loader, JSValue key,
    JSValue referrer, JSValue origin)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(jsGlobalObject);

    ErrorableString res;
    res.success = false;

    BunString keyZ;
    if (key.isString()) {
        auto moduleName = jsCast<JSString*>(key)->value(globalObject);
        if (moduleName.startsWith("file://"_s)) {
            auto url = WTF::URL(moduleName);
            if (url.isValid() && !url.isEmpty()) {
                keyZ = Bun::toStringRef(url.fileSystemPath());
            } else {
                keyZ = Bun::toStringRef(moduleName);
            }
        } else {
            keyZ = Bun::toStringRef(moduleName);
        }

    } else {
        keyZ = Bun::toStringRef(globalObject, key);
    }
    BunString referrerZ = referrer && !referrer.isUndefinedOrNull() && referrer.isString() ? Bun::toStringRef(globalObject, referrer) : BunStringEmpty;

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(keyZ.toWTFString(), referrerZ.toWTFString())) {
            return Identifier::fromString(globalObject->vm(), resolvedString.value());
        }
    } else {
        ASSERT(!globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup);
    }

    ZigString queryString = { 0, 0 };
    Zig__GlobalObject__resolve(&res, globalObject, &keyZ, &referrerZ, &queryString);
    keyZ.deref();
    referrerZ.deref();

    if (res.success) {
        if (queryString.len > 0) {
            return JSC::Identifier::fromString(globalObject->vm(), makeString(res.result.value.toWTFString(BunString::ZeroCopy), Zig::toString(queryString)));
        }

        return Identifier::fromString(globalObject->vm(), res.result.value.toWTFString(BunString::ZeroCopy));
    } else {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        throwException(scope, res.result.err, globalObject);
        return globalObject->vm().propertyNames->emptyIdentifier;
    }
}

JSC::JSInternalPromise* GlobalObject::moduleLoaderImportModule(JSGlobalObject* jsGlobalObject,
    JSModuleLoader*,
    JSString* moduleNameValue,
    JSValue parameters,
    const SourceOrigin& sourceOrigin)
{
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(jsGlobalObject);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* promise = JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
    RETURN_IF_EXCEPTION(scope, promise->rejectWithCaughtException(globalObject, scope));

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        auto keyString = moduleNameValue->value(globalObject);
        if (auto resolution = globalObject->onLoadPlugins.resolveVirtualModule(keyString, sourceOrigin.url().protocolIsFile() ? sourceOrigin.url().fileSystemPath() : String())) {
            auto resolvedIdentifier = JSC::Identifier::fromString(vm, resolution.value());

            auto result = JSC::importModule(globalObject, resolvedIdentifier,
                JSC::jsUndefined(), parameters, JSC::jsUndefined());

            RETURN_IF_EXCEPTION(scope, promise->rejectWithCaughtException(globalObject, scope));
            return result;
        }
    }

    auto sourceURL = sourceOrigin.url();
    ErrorableString resolved;
    BunString moduleNameZ;

    auto moduleName = moduleNameValue->value(globalObject);
#if BUN_DEBUG
    auto startRefCount = moduleName.impl()->refCount();
#endif
    if (moduleName.startsWith("file://"_s)) {
        auto url = WTF::URL(moduleName);
        if (url.isValid() && !url.isEmpty()) {
            moduleNameZ = Bun::toStringRef(url.fileSystemPath());
        } else {
            moduleNameZ = Bun::toStringRef(moduleName);
        }
    } else {
        moduleNameZ = Bun::toStringRef(moduleName);
    }
    auto sourceOriginZ = sourceURL.isEmpty() ? BunStringCwd : Bun::toStringRef(sourceURL.fileSystemPath());
    ZigString queryString = { 0, 0 };
    resolved.success = false;
    Zig__GlobalObject__resolve(&resolved, globalObject, &moduleNameZ, &sourceOriginZ, &queryString);
    moduleNameZ.deref();
    sourceOriginZ.deref();
#if BUN_DEBUG
    // TODO: ASSERT doesnt work right now
    RELEASE_ASSERT(startRefCount == moduleName.impl()->refCount());
#endif
    if (!resolved.success) {
        throwException(scope, resolved.result.err, globalObject);
        return promise->rejectWithCaughtException(globalObject, scope);
    }

    JSC::Identifier resolvedIdentifier;
    if (queryString.len == 0) {
        resolvedIdentifier = JSC::Identifier::fromString(vm, resolved.result.value.toWTFString(BunString::ZeroCopy));
    } else {
        resolvedIdentifier = JSC::Identifier::fromString(vm, makeString(resolved.result.value.toWTFString(BunString::ZeroCopy), Zig::toString(queryString)));
    }

    auto result = JSC::importModule(globalObject, resolvedIdentifier,
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
    JSValue parameters, JSValue script)
{
    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);

    auto moduleKey = key.toWTFString(globalObject);
    if (UNLIKELY(scope.exception()))
        return rejectedInternalPromise(globalObject, scope.exception()->value());

    if (moduleKey.endsWith(".node"_s)) {
        return rejectedInternalPromise(globalObject, createTypeError(globalObject, "To load Node-API modules, use require() or process.dlopen instead of import."_s));
    }

    auto moduleKeyBun = Bun::toString(moduleKey);
    auto sourceString = String("undefined"_s);
    auto typeAttributeString = String();

    if (parameters && parameters.isCell()) {
        JSCell* parametersCell = parameters.asCell();
        if (parametersCell->type() == JSScriptFetchParametersType) {
            auto* obj = jsCast<JSScriptFetchParameters*>(parametersCell);
            const auto& params = obj->parameters();

            if (params.type() == ScriptFetchParameters::Type::HostDefined) {
                typeAttributeString = params.hostDefinedImportType();
            }
        }
    }

    auto source = Bun::toString(sourceString);
    auto typeAttribute = Bun::toString(typeAttributeString);
    ErrorableResolvedSource res;
    res.success = false;
    res.result.err.code = 0;
    res.result.err.ptr = nullptr;

    JSValue result = Bun::fetchESMSourceCodeAsync(
        reinterpret_cast<Zig::GlobalObject*>(globalObject),
        &res,
        &moduleKeyBun,
        &source,
        typeAttributeString.isEmpty() ? nullptr : &typeAttribute);

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

GlobalObject::PromiseFunctions GlobalObject::promiseHandlerID(EncodedJSValue (*handler)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1))
{
    if (handler == Bun__HTTPRequestContext__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onReject;
    } else if (handler == Bun__HTTPRequestContext__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onRejectStream;
    } else if (handler == Bun__HTTPRequestContext__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onResolve;
    } else if (handler == Bun__HTTPRequestContext__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextTLS__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onReject;
    } else if (handler == Bun__HTTPRequestContextTLS__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextTLS__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onResolve;
    } else if (handler == Bun__HTTPRequestContextTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebug__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onReject;
    } else if (handler == Bun__HTTPRequestContextDebug__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextDebug__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onResolve;
    } else if (handler == Bun__HTTPRequestContextDebug__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onReject;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolve;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolveStream;
    } else if (handler == jsFunctionOnLoadObjectResultResolve) {
        return GlobalObject::PromiseFunctions::jsFunctionOnLoadObjectResultResolve;
    } else if (handler == jsFunctionOnLoadObjectResultReject) {
        return GlobalObject::PromiseFunctions::jsFunctionOnLoadObjectResultReject;
    } else if (handler == Bun__TestScope__onReject) {
        return GlobalObject::PromiseFunctions::Bun__TestScope__onReject;
    } else if (handler == Bun__TestScope__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__TestScope__onResolve;
    } else if (handler == CallbackJob__onResolve) {
        return GlobalObject::PromiseFunctions::CallbackJob__onResolve;
    } else if (handler == CallbackJob__onReject) {
        return GlobalObject::PromiseFunctions::CallbackJob__onReject;
    } else if (handler == Bun__BodyValueBufferer__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__BodyValueBufferer__onResolveStream;
    } else if (handler == Bun__BodyValueBufferer__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__BodyValueBufferer__onRejectStream;
    } else {
        RELEASE_ASSERT_NOT_REACHED();
    }
}

#include "ZigGeneratedClasses+lazyStructureImpl.h"
#include "ZigGlobalObject.lut.h"

const JSC::ClassInfo GlobalObject::s_info = { "GlobalObject"_s, &Base::s_info, &bunGlobalObjectTable, nullptr,
    CREATE_METHOD_TABLE(GlobalObject) };

} // namespace Zig
