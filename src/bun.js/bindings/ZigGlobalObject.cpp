

#include "root.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSImmutableButterfly.h"
#include "wtf/text/Base64.h"
#include "JavaScriptCore/BuiltinNames.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/ClassInfo.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/DeferredWorkTimer.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/GetterSetter.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "JavaScriptCore/Heap.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/InitializeThreading.h"
#include "JavaScriptCore/InternalFieldTuple.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalProxyInlines.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "JavaScriptCore/JSModuleNamespaceObjectInlines.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSScriptFetchParameters.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/ScriptFetchParameters.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "JavaScriptCore/VM.h"
#include "AddEventListenerOptions.h"
#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "BunObject.h"
#include "BunPlugin.h"
#include "BunProcess.h"
#include "BunWorkerGlobalScope.h"
#include "CallSite.h"
#include "CallSitePrototype.h"
#include "CommonJSModuleRecord.h"
#include "ConsoleObject.h"
#include "DOMWrapperWorld-class.h"
#include "ErrorStackTrace.h"
#include "IDLTypes.h"
#include "ImportMetaObject.h"
#include "JS2Native.h"
#include "JSAbortAlgorithm.h"
#include "JSAbortController.h"
#include "JSAbortSignal.h"
#include "JSBroadcastChannel.h"
#include "JSBuffer.h"
#include "JSBufferList.h"
#include "JSByteLengthQueuingStrategy.h"
#include "JSCloseEvent.h"
#include "JSCountQueuingStrategy.h"
#include "JSCustomEvent.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMException.h"
#include "JSDOMFile.h"
#include "JSDOMFormData.h"
#include "JSDOMURL.h"
#include "JSEnvironmentVariableMap.h"
#include "JSErrorEvent.h"
#include "JSEvent.h"
#include "JSEventEmitter.h"
#include "JSEventListener.h"
#include "JSEventTarget.h"
#include "JSFetchHeaders.h"
#include "JSFFIFunction.h"
#include "JSMessageChannel.h"
#include "JSMessageEvent.h"
#include "JSMessagePort.h"
#include "JSNextTickQueue.h"
#include "JSPerformance.h"
#include "JSPerformanceEntry.h"
#include "JSPerformanceMark.h"
#include "JSPerformanceMeasure.h"
#include "JSPerformanceObserver.h"
#include "JSPerformanceObserverEntryList.h"
#include "JSReadableByteStreamController.h"
#include "JSReadableStream.h"
#include "JSReadableStreamBYOBReader.h"
#include "JSReadableStreamBYOBRequest.h"
#include "JSReadableStreamDefaultController.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSSink.h"
#include "JSSocketAddress.h"
#include "JSSQLStatement.h"
#include "JSStringDecoder.h"
#include "JSTextEncoder.h"
#include "JSTextEncoderStream.h"
#include "JSTextDecoderStream.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSURLSearchParams.h"
#include "JSWebSocket.h"
#include "JSWorker.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultController.h"
#include "JSWritableStreamDefaultWriter.h"
#include "libusockets.h"
#include "ModuleLoader.h"
#include "napi_external.h"
#include "napi_handle_scope.h"
#include "napi.h"
#include "NodeHTTP.h"
#include "NodeVM.h"
#include "Performance.h"
#include "ProcessBindingConstants.h"
#include "ProcessBindingTTYWrap.h"
#include "ProcessIdentifier.h"
#include "ReadableStream.h"
#include "SerializedScriptValue.h"
#include "StructuredClone.h"
#include "WebCoreJSBuiltins.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSSubtleCrypto.h"
#include "ZigGeneratedClasses.h"
#include "ZigSourceProvider.h"
#include "UtilInspect.h"
#include "Base64Helpers.h"
#include "wtf/text/OrdinalNumber.h"
#include "ErrorCode.h"
#include "v8/V8GlobalInternals.h"

#if ENABLE(REMOTE_INSPECTOR)
#include "JavaScriptCore/RemoteInspectorServer.h"
#endif

#if !OS(WINDOWS)
#include <dlfcn.h>
#endif

#ifdef __APPLE__
#include <sys/sysctl.h>
#elif defined(__linux__)
// for sysconf
#include <unistd.h>
#endif

using namespace Bun;

BUN_DECLARE_HOST_FUNCTION(Bun__NodeUtil__jsParseArgs);
BUN_DECLARE_HOST_FUNCTION(BUN__HTTP2__getUnpackedSettings);
BUN_DECLARE_HOST_FUNCTION(BUN__HTTP2_getPackedSettings);

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

constexpr size_t DEFAULT_ERROR_STACK_TRACE_LIMIT = 10;

// #include <iostream>
static bool has_loaded_jsc = false;

Structure* createMemoryFootprintStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

extern "C" WebCore::Worker* WebWorker__getParentWorker(void*);
extern "C" void JSCInitialize(const char* envp[], size_t envc, void (*onCrash)(const char* ptr, size_t length), bool evalMode)
{
    // NOLINTBEGIN
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
        JSC::Options::useWasm() = true;
        JSC::Options::useSourceProviderCache() = true;
        // JSC::Options::useUnlinkedCodeBlockJettisoning() = false;
        JSC::Options::exposeInternalModuleLoader() = true;
        JSC::Options::useSharedArrayBuffer() = true;
        JSC::Options::useJIT() = true;
        JSC::Options::useBBQJIT() = true;
        JSC::Options::useUint8ArrayBase64Methods() = true;
        JSC::Options::useJITCage() = false;
        JSC::Options::useShadowRealm() = true;
        JSC::Options::useV8DateParser() = true;
        JSC::Options::evalMode() = evalMode;
        JSC::Options::usePromiseTryMethod() = true;
        JSC::Options::useRegExpEscape() = true;

#ifdef BUN_DEBUG
        JSC::Options::showPrivateScriptsInStackTraces() = true;
#endif

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

    // NOLINTEND
}

extern "C" void* Bun__getVM();

extern "C" void Bun__setDefaultGlobalObject(Zig::GlobalObject* globalObject);

// Error.captureStackTrace may cause computeErrorInfo to be called twice
// Rather than figure out the plumbing in JSC, we just skip the next call
// TODO: thread_local for workers
static bool skipNextComputeErrorInfo = false;

static JSValue formatStackTraceToJSValue(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites, JSValue prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(globalObject);

    if (!prepareStackTrace) {
        if (lexicalGlobalObject->inherits<Zig::GlobalObject>()) {
            if (auto prepare = globalObject->m_errorConstructorPrepareStackTraceValue.get()) {
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
        auto* str = errorMessage.toString(lexicalGlobalObject);
        if (str->length() > 0) {
            sb.append("Error: "_s);
            sb.append(str->value(lexicalGlobalObject).data);
        } else {
            sb.append("Error"_s);
        }
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

    bool originalSkipNextComputeErrorInfo = skipNextComputeErrorInfo;
    skipNextComputeErrorInfo = true;
    if (errorObject->hasProperty(lexicalGlobalObject, vm.propertyNames->stack)) {
        skipNextComputeErrorInfo = true;
        errorObject->deleteProperty(lexicalGlobalObject, vm.propertyNames->stack);
    }

    skipNextComputeErrorInfo = originalSkipNextComputeErrorInfo;

    JSValue stackStringValue = jsString(vm, sb.toString());

    if (prepareStackTrace && prepareStackTrace.isObject()) {
        JSC::CallData prepareStackTraceCallData = JSC::getCallData(prepareStackTrace);

        if (prepareStackTraceCallData.type != JSC::CallData::Type::None) {
            // In Node, if you console.log(error.stack) inside Error.prepareStackTrace
            // it will display the stack as a formatted string, so we have to do the same.
            errorObject->putDirect(vm, vm.propertyNames->stack, stackStringValue, 0);

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

            RETURN_IF_EXCEPTION(scope, {});

            if (result.isUndefinedOrNull()) {
                result = jsUndefined();
            }

            return result;
        }
    }

    return stackStringValue;
}

WTF::String Bun::formatStackTrace(
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    const WTF::String& name,
    const WTF::String& message,
    OrdinalNumber& line,
    OrdinalNumber& column,
    WTF::String& sourceURL,
    Vector<JSC::StackFrame>& stackTrace,
    JSC::JSObject* errorInstance)
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

                ZigStackFrame remappedFrame = {};
                memset(&remappedFrame, 0, sizeof(ZigStackFrame));

                remappedFrame.position.line_zero_based = originalLine.zeroBasedInt();
                remappedFrame.position.column_zero_based = 0;

                String sourceURLForFrame = err->sourceURL();

                // If it's not a Zig::GlobalObject, don't bother source-mapping it.
                if (globalObject && !sourceURLForFrame.isEmpty()) {
                    // https://github.com/oven-sh/bun/issues/3595
                    if (!sourceURLForFrame.isEmpty()) {
                        remappedFrame.source_url = Bun::toStringRef(sourceURLForFrame);

                        // This ensures the lifetime of the sourceURL is accounted for correctly
                        Bun__remapStackFramePositions(globalObject, &remappedFrame, 1);

                        sourceURLForFrame = remappedFrame.source_url.toWTFString();
                    }
                }

                // there is always a newline before each stack frame line, ensuring that the name + message
                // exist on the first line, even if both are empty
                sb.append("\n"_s);

                sb.append("    at <parse> ("_s);

                sb.append(remappedFrame.source_url.toWTFString());

                if (remappedFrame.remapped) {
                    errorInstance->putDirect(vm, builtinNames(vm).originalLinePublicName(), jsNumber(originalLine.oneBasedInt()), 0);
                    hasSet = true;
                    line = remappedFrame.position.line();
                }

                if (remappedFrame.remapped) {
                    sb.append(":"_s);
                    sb.append(remappedFrame.position.line().oneBasedInt());
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

        WTF::String functionName;

        if (auto codeblock = frame.codeBlock()) {
            if (codeblock->isConstructor()) {
                sb.append("new "_s);
            }

            // We cannot run this in FinalizeUnconditionally, as we cannot call getters there
            // We check the errorInstance to see if we are allowed to access this memory.
            if (errorInstance) {
                switch (codeblock->codeType()) {
                case JSC::CodeType::FunctionCode:
                case JSC::CodeType::EvalCode: {
                    if (auto* callee = frame.callee()) {
                        if (callee->isObject()) {
                            JSValue functionNameValue = callee->getObject()->getDirect(vm, vm.propertyNames->name);
                            if (functionNameValue && functionNameValue.isString()) {
                                functionName = functionNameValue.toWTFString(lexicalGlobalObject);
                            }
                        }
                    }
                    break;
                }
                default: {
                    break;
                }
                }
            }
        }

        if (functionName.isEmpty()) {
            functionName = frame.functionName(vm);
        }

        if (functionName.isEmpty()) {
            sb.append("<anonymous>"_s);
        } else {
            sb.append(functionName);
        }

        if (frame.hasLineAndColumnInfo()) {
            ZigStackFrame remappedFrame = {};
            LineColumn lineColumn = frame.computeLineAndColumn();
            OrdinalNumber originalLine = OrdinalNumber::fromOneBasedInt(lineColumn.line);
            OrdinalNumber originalColumn = OrdinalNumber::fromOneBasedInt(lineColumn.column);

            remappedFrame.position.line_zero_based = originalLine.zeroBasedInt();
            remappedFrame.position.column_zero_based = originalColumn.zeroBasedInt();

            String sourceURLForFrame = frame.sourceURL(vm);

            // Sometimes, the sourceURL is empty.
            // For example, pages in Next.js.
            if (sourceURLForFrame.isEmpty()) {
                // hasLineAndColumnInfo() checks codeBlock(), so this is safe to access here.
                const auto& source = frame.codeBlock()->source();

                // source.isNull() is true when the SourceProvider is a null pointer.
                if (!source.isNull()) {
                    auto* provider = source.provider();
                    // I'm not 100% sure we should show sourceURLDirective here.
                    if (!provider->sourceURLDirective().isEmpty()) {
                        sourceURLForFrame = provider->sourceURLDirective();
                    } else if (!provider->sourceURL().isEmpty()) {
                        sourceURLForFrame = provider->sourceURL();
                    } else {
                        const auto& origin = provider->sourceOrigin();
                        if (!origin.isNull()) {
                            sourceURLForFrame = origin.string();
                        }
                    }
                }
            }

            // If it's not a Zig::GlobalObject, don't bother source-mapping it.
            if (globalObject == lexicalGlobalObject && globalObject) {
                // https://github.com/oven-sh/bun/issues/3595
                if (!sourceURLForFrame.isEmpty()) {
                    remappedFrame.source_url = Bun::toStringRef(sourceURLForFrame);

                    // This ensures the lifetime of the sourceURL is accounted for correctly
                    Bun__remapStackFramePositions(globalObject, &remappedFrame, 1);

                    sourceURLForFrame = remappedFrame.source_url.toWTFString();
                }
            }

            if (!hasSet) {
                hasSet = true;
                line = remappedFrame.position.line();
                column = remappedFrame.position.column();
                sourceURL = frame.sourceURL(vm);

                if (remappedFrame.remapped) {
                    if (errorInstance) {
                        errorInstance->putDirect(vm, builtinNames(vm).originalLinePublicName(), jsNumber(originalLine.oneBasedInt()), 0);
                        errorInstance->putDirect(vm, builtinNames(vm).originalColumnPublicName(), jsNumber(originalColumn.oneBasedInt()), 0);
                    }
                }
            }

            sb.append(" ("_s);
            sb.append(sourceURLForFrame);
            sb.append(":"_s);
            sb.append(remappedFrame.position.line().oneBasedInt());
            sb.append(":"_s);
            sb.append(remappedFrame.position.column().oneBasedInt());
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
static String computeErrorInfoWithoutPrepareStackTrace(
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    Vector<StackFrame>& stackTrace,
    OrdinalNumber& line,
    OrdinalNumber& column,
    String& sourceURL,
    JSObject* errorInstance)
{

    WTF::String name = "Error"_s;
    WTF::String message;

    if (errorInstance) {
        // Note that we are not allowed to allocate memory in here. It's called inside a finalizer.
        if (auto* instance = jsDynamicCast<ErrorInstance*>(errorInstance)) {
            if (!lexicalGlobalObject) {
                lexicalGlobalObject = errorInstance->globalObject();
            }
            name = instance->sanitizedNameString(lexicalGlobalObject);
            message = instance->sanitizedMessageString(lexicalGlobalObject);
        }
    }

    if (UNLIKELY(!globalObject)) {
        globalObject = defaultGlobalObject();
    }

    return Bun::formatStackTrace(vm, globalObject, lexicalGlobalObject, name, message, line, column, sourceURL, stackTrace, errorInstance);
}

static String computeErrorInfoWithPrepareStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<StackFrame>& stackFrames, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorObject, JSObject* prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

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
        ZigStackFrame remappedFrames[64];
        framesCount = framesCount > 64 ? 64 : framesCount;
        for (int i = 0; i < framesCount; i++) {
            remappedFrames[i] = {};
            remappedFrames[i].source_url = Bun::toStringRef(lexicalGlobalObject, stackTrace.at(i).sourceURL());
            if (JSCStackFrame::SourcePositions* sourcePositions = stackTrace.at(i).getSourcePositions()) {
                remappedFrames[i].position.line_zero_based = sourcePositions->line.zeroBasedInt();
                remappedFrames[i].position.column_zero_based = sourcePositions->column.zeroBasedInt();
            } else {
                remappedFrames[i].position.line_zero_based = -1;
                remappedFrames[i].position.column_zero_based = -1;
            }
        }

        Bun__remapStackFramePositions(globalObject, remappedFrames, framesCount);

        for (size_t i = 0; i < framesCount; i++) {
            JSC::JSValue callSiteValue = callSites->getIndex(lexicalGlobalObject, i);
            CallSite* callSite = JSC::jsDynamicCast<CallSite*>(callSiteValue);
            if (remappedFrames[i].remapped) {
                callSite->setColumnNumber(remappedFrames[i].position.column());
                callSite->setLineNumber(remappedFrames[i].position.line());
            }
        }
    }

    JSValue value = formatStackTraceToJSValue(vm, jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject), lexicalGlobalObject, errorObject, callSites, prepareStackTrace);

    RETURN_IF_EXCEPTION(scope, String());

    if (errorObject && !value.isEmpty()) {
        errorObject->putDirect(vm, vm.propertyNames->stack, value, 0);
    }

    if (value.isString()) {
        return value.toWTFString(lexicalGlobalObject);
    }

    return String();
}

static String computeErrorInfo(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance)
{
    if (skipNextComputeErrorInfo) {
        return String();
    }

    Zig::GlobalObject* globalObject = nullptr;
    JSC::JSGlobalObject* lexicalGlobalObject = nullptr;

    if (errorInstance) {
        lexicalGlobalObject = errorInstance->globalObject();
        globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);

        // Error.prepareStackTrace - https://v8.dev/docs/stack-trace-api#customizing-stack-traces
        if (!globalObject) {
            // node:vm will use a different JSGlobalObject
            globalObject = defaultGlobalObject();

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
    }

    return computeErrorInfoWithoutPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, line, column, sourceURL, errorInstance);
}

// TODO: @paperdave: remove this wrapper and make the WTF::Function from JavaScriptCore expeect OrdinalNumber instead of unsigned.
static String computeErrorInfoWrapper(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, String& sourceURL, JSObject* errorInstance)
{
    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(line_in);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(column_in);

    WTF::String result = computeErrorInfo(vm, stackTrace, line, column, sourceURL, errorInstance);

    line_in = line.oneBasedInt();
    column_in = column.oneBasedInt();

    return result;
}

static void checkIfNextTickWasCalledDuringMicrotask(JSC::VM& vm)
{
    auto* globalObject = defaultGlobalObject();
    if (auto nextTickQueueValue = globalObject->m_nextTickQueue.get()) {
        auto* queue = jsCast<Bun::JSNextTickQueue*>(nextTickQueueValue);
        globalObject->resetOnEachMicrotaskTick();
        queue->drain(vm, globalObject);
    }
}

static void cleanupAsyncHooksData(JSC::VM& vm)
{
    auto* globalObject = defaultGlobalObject();
    globalObject->m_asyncContextData.get()->putInternalField(vm, 0, jsUndefined());
    globalObject->asyncHooksNeedsCleanup = false;
    if (!globalObject->m_nextTickQueue) {
        vm.setOnEachMicrotaskTick(&checkIfNextTickWasCalledDuringMicrotask);
        checkIfNextTickWasCalledDuringMicrotask(vm);
    } else {
        vm.setOnEachMicrotaskTick(nullptr);
    }
}

void Zig::GlobalObject::resetOnEachMicrotaskTick()
{
    JSC::VM& vm = this->vm();
    if (this->asyncHooksNeedsCleanup) {
        vm.setOnEachMicrotaskTick(&cleanupAsyncHooksData);
    } else {
        if (this->m_nextTickQueue) {
            vm.setOnEachMicrotaskTick(nullptr);
        } else {
            vm.setOnEachMicrotaskTick(&checkIfNextTickWasCalledDuringMicrotask);
        }
    }
}

extern "C" JSC__JSGlobalObject* Zig__GlobalObject__create(void* console_client, int32_t executionContextId, bool miniMode, bool evalMode, void* worker_ptr)
{
    auto heapSize = miniMode ? JSC::HeapType::Small : JSC::HeapType::Large;
    JSC::VM& vm = JSC::VM::create(heapSize).leakRef();
    // This must happen before JSVMClientData::create
    vm.heap.acquireAccess();
    JSC::JSLockHolder locker(vm);

    WebCore::JSVMClientData::create(&vm, Bun__getVM());

    const auto createGlobalObject = [&]() -> Zig::GlobalObject* {
        if (UNLIKELY(executionContextId > -1)) {
            auto* structure = Zig::GlobalObject::createStructure(vm);
            if (UNLIKELY(!structure)) {
                return nullptr;
            }
            return Zig::GlobalObject::create(
                vm,
                structure,
                static_cast<ScriptExecutionContextIdentifier>(executionContextId));
        } else if (evalMode) {
            auto* structure = Zig::EvalGlobalObject::createStructure(vm);
            if (UNLIKELY(!structure)) {
                return nullptr;
            }
            return Zig::EvalGlobalObject::create(
                vm,
                structure,
                &Zig::EvalGlobalObject::s_globalObjectMethodTable);

        } else {
            auto* structure = Zig::GlobalObject::createStructure(vm);
            if (UNLIKELY(!structure)) {
                return nullptr;
            }
            return Zig::GlobalObject::create(
                vm,
                structure);
        }
    };

    auto* globalObject = createGlobalObject();
    if (UNLIKELY(!globalObject)) {
        BUN_PANIC("Failed to allocate JavaScript global object. Did your computer run out of memory?");
    }

    globalObject->setConsole(console_client);
    globalObject->isThreadLocalDefaultGlobalObject = true;
    globalObject->setStackTraceLimit(DEFAULT_ERROR_STACK_TRACE_LIMIT); // Node.js defaults to 10
    Bun__setDefaultGlobalObject(globalObject);
    JSC::gcProtect(globalObject);

    vm.setOnComputeErrorInfo(computeErrorInfoWrapper);
    vm.setOnEachMicrotaskTick([](JSC::VM& vm) -> void {
        auto* globalObject = defaultGlobalObject();
        if (auto nextTickQueue = globalObject->m_nextTickQueue.get()) {
            globalObject->resetOnEachMicrotaskTick();
            Bun::JSNextTickQueue* queue = jsCast<Bun::JSNextTickQueue*>(nextTickQueue);
            queue->drain(vm, globalObject);
            return;
        }
    });

    if (executionContextId > -1) {
        const auto initializeWorker = [&](WebCore::Worker& worker) -> void {
            auto& options = worker.options();

            if (options.bun.env) {
                auto map = WTFMove(options.bun.env);
                auto size = map->size();

                // In theory, a GC could happen before we finish putting all the properties on the object.
                // So we use a MarkedArgumentBuffer to ensure that the strings are not collected and we immediately put them on the object.
                MarkedArgumentBuffer strings;
                strings.ensureCapacity(map->size());
                for (const auto& value : map->values()) {
                    strings.append(jsString(vm, value));
                }

                auto env = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), size >= JSFinalObject::maxInlineCapacity ? JSFinalObject::maxInlineCapacity : size);
                size_t i = 0;
                for (auto k : *map) {
                    // They can have environment variables with numbers as keys.
                    // So we must use putDirectMayBeIndex to handle that.
                    env->putDirectMayBeIndex(globalObject, JSC::Identifier::fromString(vm, WTFMove(k.key)), strings.at(i++));
                }
                map->clear();
                globalObject->m_processEnvObject.set(vm, globalObject, env);
            }

            // ensure remote termination works.
            vm.ensureTerminationException();
            vm.forbidExecutionOnTermination();
        };

        if (auto* worker = static_cast<WebCore::Worker*>(worker_ptr)) {
            initializeWorker(*worker);
        }
    }

    return globalObject;
}

JSC_DEFINE_HOST_FUNCTION(functionFulfillModuleSync,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

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
        globalObject,
        key,
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
            oldMap->clear(globalObject);
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
    return makeString(WebCore::Process::identifier().toUInt64(), "-default"_s);
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
    Zig::GlobalObject* shadow = Zig::GlobalObject::create(vm, Zig::GlobalObject::createStructure(vm));
    shadow->setConsole(shadow);

    return shadow;
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
    nullptr, // reportViolationForUnsafeEval
    nullptr, // defaultLanguage
    nullptr, // compileStreaming
    nullptr, // instantiateStreaming
    &Zig::deriveShadowRealmGlobalObject,
    nullptr, // codeForEval
    nullptr, // canCompileStrings
};

const JSC::GlobalObjectMethodTable EvalGlobalObject::s_globalObjectMethodTable = {
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
    nullptr, // reportViolationForUnsafeEval
    nullptr, // defaultLanguage
    nullptr, // compileStreaming
    nullptr, // instantiateStreaming
    &Zig::deriveShadowRealmGlobalObject,
    nullptr, // codeForEval
    nullptr, // canCompileStrings
};

GlobalObject::GlobalObject(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable)
    : Base(vm, structure, methodTable)
    , m_bunVM(Bun__getVM())
    , m_constructors(makeUnique<WebCore::DOMConstructors>())
    , m_world(WebCore::DOMWrapperWorld::create(vm, WebCore::DOMWrapperWorld::Type::Normal))
    , m_worldIsNormal(true)
    , m_builtinInternalFunctions(vm)
    , m_scriptExecutionContext(new WebCore::ScriptExecutionContext(&vm, this))
    , globalEventScope(*new Bun::WorkerGlobalScope(m_scriptExecutionContext))
{
    // m_scriptExecutionContext = globalEventScope.m_context;
    mockModule = Bun::JSMockModule::create(this);
    globalEventScope.m_context = m_scriptExecutionContext;
    // FIXME: is there a better way to do this? this event handler should always be tied to the global object
    globalEventScope.relaxAdoptionRequirement();
}

GlobalObject::GlobalObject(JSC::VM& vm, JSC::Structure* structure, WebCore::ScriptExecutionContextIdentifier contextId, const JSC::GlobalObjectMethodTable* methodTable)
    : Base(vm, structure, methodTable)
    , m_bunVM(Bun__getVM())
    , m_constructors(makeUnique<WebCore::DOMConstructors>())
    , m_world(WebCore::DOMWrapperWorld::create(vm, WebCore::DOMWrapperWorld::Type::Normal))
    , m_worldIsNormal(true)
    , m_builtinInternalFunctions(vm)
    , m_scriptExecutionContext(new WebCore::ScriptExecutionContext(&vm, this, contextId))
    , globalEventScope(*new Bun::WorkerGlobalScope(m_scriptExecutionContext))
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
    if (thisObject->m_errorConstructorPrepareStackTraceValue) {
        return JSValue::encode(thisObject->m_errorConstructorPrepareStackTraceValue.get());
    }

    return JSValue::encode(thisObject->m_errorConstructorPrepareStackTraceInternalValue.get(thisObject));
}

JSC_DEFINE_CUSTOM_SETTER(errorConstructorPrepareStackTraceSetter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName property))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSValue value = JSValue::decode(encodedValue);
    if (value == thisObject->m_errorConstructorPrepareStackTraceInternalValue.get(thisObject)) {
        thisObject->m_errorConstructorPrepareStackTraceValue.clear();
    } else {
        thisObject->m_errorConstructorPrepareStackTraceValue.set(vm, thisObject, value);
    }

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
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TextEncoderStream);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TextDecoderStream);
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
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() == 0) {
        JSC::throwTypeError(globalObject, scope, "queueMicrotask requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
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
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    switch (argumentCount) {
    case 0: {
        JSC::throwTypeError(globalObject, scope, "setTimeout requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    case 1:
    case 2: {
        break;
    }
    case 3: {
        arguments = callFrame->argument(2);
        break;
    }

    default: {
        ArgList argumentsList = ArgList(callFrame, 2);
        auto* args = JSC::JSImmutableButterfly::tryCreateFromArgList(vm, argumentsList);

        if (UNLIKELY(!args)) {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        arguments = JSValue(args);
    }
    }

    if (UNLIKELY(!job.isObject() || !job.getObject()->isCallable())) {
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
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    switch (argumentCount) {
    case 0: {
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
    case 3: {
        arguments = callFrame->argument(2);
        break;
    }

    default: {
        ArgList argumentsList = ArgList(callFrame, 2);
        auto* args = JSC::JSImmutableButterfly::tryCreateFromArgList(vm, argumentsList);

        if (UNLIKELY(!args)) {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        arguments = JSValue(args);
    }
    }

    if (UNLIKELY(!job.isObject() || !job.getObject()->isCallable())) {
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
        if (UNLIKELY(dest.isNull())) {
            throwOutOfMemoryError(globalObject, throwScope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        WTF::StringImpl::copyCharacters(ptr, encodedString.span16());
        encodedString = WTFMove(dest);
    }

    unsigned length = encodedString.length();
    RELEASE_AND_RETURN(
        throwScope,
        Bun__encoding__toString(
            encodedString.span8().data(),
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

    auto result = Bun::Base64::atob(encodedString);
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

extern "C" JSC__JSValue ArrayBuffer__fromSharedMemfd(int64_t fd, JSC::JSGlobalObject* globalObject, size_t byteOffset, size_t byteLength, size_t totalLength, JSC::JSType type)
{

// Windows doesn't have mmap
// This code should pretty much only be called on Linux.
#if !OS(WINDOWS)
    auto ptr = mmap(nullptr, totalLength, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);

    if (ptr == MAP_FAILED) {
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto buffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(reinterpret_cast<char*>(ptr) + byteOffset), byteLength }, createSharedTask<void(void*)>([ptr, totalLength](void* p) {
        munmap(ptr, totalLength);
    }));

    if (type == JSC::Uint8ArrayType) {
        auto uint8array = JSC::JSUint8Array::create(globalObject, globalObject->m_typedArrayUint8.get(globalObject), WTFMove(buffer), 0, byteLength);
        return JSValue::encode(uint8array);
    }

    if (type == JSC::ArrayBufferType) {

        Structure* structure = globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default);

        if (UNLIKELY(!structure)) {
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        return JSValue::encode(JSC::JSArrayBuffer::create(globalObject->vm(), structure, WTFMove(buffer)));
    } else {
        RELEASE_ASSERT_NOT_REACHED();
    }
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

extern "C" JSC__JSValue Bun__allocUint8ArrayForCopy(JSC::JSGlobalObject* globalObject, size_t len, void** ptr)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), len);

    if (UNLIKELY(!array)) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return encodedJSValue();
    }

    *ptr = array->vector();

    return JSValue::encode(array);
}

extern "C" JSC__JSValue Bun__createUint8ArrayForCopy(JSC::JSGlobalObject* globalObject, const void* ptr, size_t len, bool isBuffer)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(
        globalObject,
        isBuffer ? reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSBufferSubclassStructure() : globalObject->typedArrayStructure(TypeUint8, false),
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
    auto listener = convert<IDLNullable<IDLEventListener<JSEventListener>>>(*lexicalGlobalObject, argument1.value(), *castedThis, [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentMustBeObjectError(lexicalGlobalObject, scope, 1, "listener"_s, "EventTarget"_s, "addEventListener"_s); });
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
    auto listener = convert<IDLNullable<IDLEventListener<JSEventListener>>>(*lexicalGlobalObject, argument1.value(), *castedThis, [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentMustBeObjectError(lexicalGlobalObject, scope, 1, "listener"_s, "EventTarget"_s, "removeEventListener"_s); });
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
    auto event = convert<IDLInterface<Event>>(*lexicalGlobalObject, argument0.value(), [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentTypeError(lexicalGlobalObject, scope, 0, "event"_s, "EventTarget"_s, "dispatchEvent"_s, "Event"_s); });
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

JSC_DEFINE_HOST_FUNCTION(addAbortAlgorithmToSignal, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);

    auto& vm = globalObject->vm();
    auto* abortSignal = jsDynamicCast<JSAbortSignal*>(callFrame->uncheckedArgument(0));
    if (UNLIKELY(!abortSignal))
        return JSValue::encode(JSValue(JSC::JSValue::JSFalse));

    Ref<AbortAlgorithm> abortAlgorithm = JSAbortAlgorithm::create(vm, callFrame->uncheckedArgument(1).getObject());

    auto algorithmIdentifier = AbortSignal::addAbortAlgorithmToSignal(abortSignal->wrapped(), WTFMove(abortAlgorithm));
    return JSValue::encode(JSC::jsNumber(algorithmIdentifier));
}

JSC_DEFINE_HOST_FUNCTION(removeAbortAlgorithmFromSignal, (JSGlobalObject*, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);

    auto* abortSignal = jsDynamicCast<JSAbortSignal*>(callFrame->uncheckedArgument(0));
    if (UNLIKELY(!abortSignal))
        return JSValue::encode(JSValue(JSC::JSValue::JSFalse));

    AbortSignal::removeAbortAlgorithmFromSignal(abortSignal->wrapped(), callFrame->uncheckedArgument(1).asUInt32());
    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(isAbortSignal, (JSGlobalObject*, CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    return JSValue::encode(jsBoolean(callFrame->uncheckedArgument(0).inherits<JSAbortSignal>()));
}
static inline std::optional<JSC::JSValue> invokeReadableStreamFunction(JSC::JSGlobalObject& lexicalGlobalObject, const JSC::Identifier& identifier, JSC::JSValue thisValue, const JSC::MarkedArgumentBuffer& arguments)
{
    JSC::VM& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);

    auto function = lexicalGlobalObject.get(&lexicalGlobalObject, identifier);
    ASSERT(function.isCallable());

    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto callData = JSC::getCallData(function);
    auto result = call(&lexicalGlobalObject, function, callData, thisValue, arguments);
#if BUN_DEBUG
    if (scope.exception()) {
        Bun__reportError(&lexicalGlobalObject, JSValue::encode(scope.exception()));
    }
#endif
    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    if (scope.exception())
        return {};
    return result;
}
extern "C" bool ReadableStream__tee(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject, JSC__JSValue* possibleReadableStream1, JSC__JSValue* possibleReadableStream2)
{
    auto* readableStream = jsDynamicCast<JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream));
    if (UNLIKELY(!readableStream))
        return false;

    auto& lexicalGlobalObject = *globalObject;
    auto* clientData = static_cast<JSVMClientData*>(lexicalGlobalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamTeePrivateName();

    MarkedArgumentBuffer arguments;
    arguments.append(readableStream);
    arguments.append(JSC::jsBoolean(true));
    ASSERT(!arguments.hasOverflowed());
    auto returnedValue = invokeReadableStreamFunction(lexicalGlobalObject, privateName, JSC::jsUndefined(), arguments);
    if (!returnedValue)
        return false;

    auto results = Detail::SequenceConverter<IDLAny>::convert(lexicalGlobalObject, *returnedValue);

    ASSERT(results.size() == 2);
    *possibleReadableStream1 = JSValue::encode(results[0]);
    *possibleReadableStream2 = JSValue::encode(results[1]);
    return true;
}

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

extern "C" void ReadableStream__detach(JSC__JSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto value = JSC::JSValue::decode(possibleReadableStream);
    if (value.isEmpty() || !value.isCell())
        return;

    auto* readableStream = static_cast<JSReadableStream*>(value.asCell());
    if (UNLIKELY(!readableStream))
        return;
    readableStream->setNativePtr(globalObject->vm(), jsNumber(-1));
    readableStream->setNativeType(0);
    readableStream->setDisturbed(true);
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

extern "C" int32_t ReadableStreamTag__tagged(Zig::GlobalObject* globalObject, JSC__JSValue* possibleReadableStream, void** ptr)
{
    ASSERT(globalObject);
    JSC::JSObject* object = JSValue::decode(*possibleReadableStream).getObject();
    if (!object) {
        *ptr = nullptr;
        return -1;
    }

    auto& vm = globalObject->vm();

    if (!object->inherits<JSReadableStream>()) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        JSValue target = object;
        JSValue fn = JSValue();
        auto* function = jsDynamicCast<JSC::JSFunction*>(object);
        if (function && function->jsExecutable() && function->jsExecutable()->isAsyncGenerator()) {
            fn = object;
            target = jsUndefined();
        } else if (auto iterable = object->getIfPropertyExists(globalObject, vm.propertyNames->asyncIteratorSymbol)) {
            if (iterable.isCallable()) {
                fn = iterable;
            }
        }

        if (UNLIKELY(throwScope.exception())) {
            *ptr = nullptr;
            return -1;
        }

        if (fn.isEmpty()) {
            *ptr = nullptr;
            return -1;
        }

        auto* createIterator = globalObject->builtinInternalFunctions().readableStreamInternals().m_readableStreamFromAsyncIteratorFunction.get();

        JSC::MarkedArgumentBuffer arguments;
        arguments.append(target);
        arguments.append(fn);

        JSC::JSValue result = profiledCall(globalObject, JSC::ProfilingReason::API, createIterator, JSC::getCallData(createIterator), JSC::jsUndefined(), arguments);

        if (UNLIKELY(throwScope.exception())) {
            return -1;
        }

        if (!result.isObject()) {
            *ptr = nullptr;
            return -1;
        }

        object = result.getObject();

        ASSERT(object->inherits<JSReadableStream>());
        *possibleReadableStream = JSValue::encode(object);
        *ptr = nullptr;
        ensureStillAliveHere(object);
        return 0;
    }

    auto* readableStream = jsCast<JSReadableStream*>(object);

    JSValue nativePtrHandle = readableStream->nativePtr();
    if (nativePtrHandle.isEmpty() || !nativePtrHandle.isCell()) {
        *ptr = nullptr;
        return 0;
    }

    JSCell* cell = nativePtrHandle.asCell();

    if (auto* casted = jsDynamicCast<JSBlobInternalReadableStreamSource*>(cell)) {
        *ptr = casted->wrapped();
        return 1;
    }

    if (auto* casted = jsDynamicCast<JSFileInternalReadableStreamSource*>(cell)) {
        *ptr = casted->wrapped();
        return 2;
    }

    if (auto* casted = jsDynamicCast<JSBytesInternalReadableStreamSource*>(cell)) {
        *ptr = casted->wrapped();
        return 4;
    }

    return 0;
}

extern "C" JSC__JSValue ZigGlobalObject__createNativeReadableStream(Zig::GlobalObject* globalObject, JSC__JSValue nativePtr)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto& builtinNames = WebCore::builtinNames(vm);

    auto function = globalObject->getDirect(vm, builtinNames.createNativeReadableStreamPrivateName()).getObject();
    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
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

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* function = globalObject->m_readableStreamToArrayBuffer.get();
    if (!function) {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToArrayBufferCodeGenerator(vm)), globalObject);
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

extern "C" JSC__JSValue ZigGlobalObject__readableStreamToBytes(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue);
extern "C" JSC__JSValue ZigGlobalObject__readableStreamToBytes(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue)
{
    auto& vm = globalObject->vm();

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* function = globalObject->m_readableStreamToBytes.get();
    if (!function) {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToBytesCodeGenerator(vm)), globalObject);
        globalObject->m_readableStreamToBytes.set(vm, globalObject, function);
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

extern "C" JSC__JSValue ZigGlobalObject__readableStreamToText(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue);
extern "C" JSC__JSValue ZigGlobalObject__readableStreamToText(Zig::GlobalObject* globalObject, JSC__JSValue readableStreamValue)
{
    auto& vm = globalObject->vm();

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToText = globalObject->m_readableStreamToText.get()) {
        function = readableStreamToText;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToTextCodeGenerator(vm)), globalObject);

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

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToFormData = globalObject->m_readableStreamToFormData.get()) {
        function = readableStreamToFormData;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToFormDataCodeGenerator(vm)), globalObject);

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

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToJSON = globalObject->m_readableStreamToJSON.get()) {
        function = readableStreamToJSON;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToJSONCodeGenerator(vm)), globalObject);

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

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToBlob = globalObject->m_readableStreamToBlob.get()) {
        function = readableStreamToBlob;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToBlobCodeGenerator(vm)), globalObject);

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

JSC_DECLARE_HOST_FUNCTION(functionReadableStreamToBytes);
JSC_DEFINE_HOST_FUNCTION(functionReadableStreamToBytes, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return JSValue::encode(jsUndefined());
    }

    auto readableStreamValue = callFrame->uncheckedArgument(0);
    return ZigGlobalObject__readableStreamToBytes(reinterpret_cast<Zig::GlobalObject*>(globalObject), JSValue::encode(readableStreamValue));
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
    JSValue stackTraceValue = formatStackTraceToJSValue(vm, this, lexicalGlobalObject, errorObject, callSites, prepareStackTrace);

    if (!stackTraceValue.isEmpty()) {
        errorObject->putDirect(vm, vm.propertyNames->stack, stackTraceValue, 0);
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionDefaultErrorPrepareStackTrace, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto errorObject = jsDynamicCast<JSC::ErrorInstance*>(callFrame->argument(0));
    auto callSites = jsDynamicCast<JSC::JSArray*>(callFrame->argument(1));
    if (!errorObject) {
        throwTypeError(lexicalGlobalObject, scope, "First argument must be an Error object"_s);
        return JSC::JSValue::encode(jsUndefined());
    }

    JSValue result = formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSites, jsUndefined());

    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));

    return JSC::JSValue::encode(result);
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
        remappedFrames[i].source_url = Bun::toStringRef(lexicalGlobalObject, stackTrace.at(i).sourceURL());
        if (JSCStackFrame::SourcePositions* sourcePositions = stackTrace.at(i).getSourcePositions()) {
            remappedFrames[i].position.line_zero_based = sourcePositions->line.zeroBasedInt();
            remappedFrames[i].position.column_zero_based = sourcePositions->column.zeroBasedInt();
        } else {
            remappedFrames[i].position.line_zero_based = -1;
            remappedFrames[i].position.column_zero_based = -1;
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
            callSite->setColumnNumber(remappedFrames[i].position.column());
            callSite->setLineNumber(remappedFrames[i].position.line());
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

            auto* function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(importMetaObjectCreateRequireCacheCodeGenerator(vm)), globalObject);

            NakedPtr<JSC::Exception> returnedException = nullptr;
            auto result = JSC::call(globalObject, function, JSC::getCallData(function), globalObject, ArgList(), returnedException);
            init.set(result.toObject(globalObject));
        });

    m_lazyTestModuleObject.initLater(
        [](const Initializer<JSObject>& init) {
            JSC::JSGlobalObject* globalObject = init.owner;

            JSValue result = JSValue::decode(Bun__Jest__createTestModuleObject(globalObject));
            init.set(result.toObject(globalObject));
        });

    m_lazyPreloadTestModuleObject.initLater(
        [](const Initializer<JSObject>& init) {
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

    m_V8GlobalInternals.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, v8::GlobalInternals>::Initializer& init) {
            init.set(
                v8::GlobalInternals::create(
                    init.vm,
                    v8::GlobalInternals::createStructure(init.vm, init.owner),
                    jsDynamicCast<Zig::GlobalObject*>(init.owner)));
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

    m_errorConstructorPrepareStackTraceInternalValue.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 2, "ErrorPrepareStackTrace"_s, jsFunctionDefaultErrorPrepareStackTrace, ImplementationVisibility::Public));
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

            auto* baseStructure = globalObject->typedArrayStructure(JSC::TypeUint8, false);
            JSC::Structure* subclassStructure = JSC::InternalFunction::createSubclassStructure(globalObject, globalObject->JSBufferConstructor(), baseStructure);
            init.set(subclassStructure);
        });
    m_performMicrotaskFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            init.set(JSFunction::create(init.vm, init.owner, 4, "performMicrotask"_s, jsFunctionPerformMicrotask, ImplementationVisibility::Public));
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

    m_utilInspectOptionsStructure.initLater(
        [](const Initializer<Structure>& init) {
            init.set(Bun::createUtilInspectOptionsStructure(init.vm, init.owner));
        });

    m_nodeErrorCache.initLater(
        [](const Initializer<JSObject>& init) {
            auto* structure = ErrorCodeCache::createStructure(
                init.vm,
                init.owner);

            init.set(ErrorCodeCache::create(init.vm, structure));
        });

    m_utilInspectStylizeColorFunction.initLater(
        [](const Initializer<JSFunction>& init) {
            JSC::MarkedArgumentBuffer args;
            args.append(jsCast<Zig::GlobalObject*>(init.owner)->utilInspectFunction());

            auto scope = DECLARE_THROW_SCOPE(init.vm);
            JSC::JSFunction* getStylize = JSC::JSFunction::create(init.vm, init.owner, utilInspectGetStylizeWithColorCodeGenerator(init.vm), init.owner);
            // RETURN_IF_EXCEPTION(scope, {});

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
            init.set(JSC::JSFunction::create(init.vm, init.owner, utilInspectStylizeWithNoColorCodeGenerator(init.vm), init.owner));
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
            init.set(
                Bun::NapiPrototype::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });

    m_NapiHandleScopeImplStructure.initLater([](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
        init.set(Bun::NapiHandleScopeImpl::createStructure(init.vm, init.owner));
    });

    m_cachedNodeVMGlobalObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(WebCore::createNodeVMGlobalObjectStructure(init.vm));
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

    m_requireFunctionUnbound.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            init.set(
                JSFunction::create(
                    init.vm,
                    init.owner,
                    moduleRequireCodeGenerator(init.vm),
                    init.owner->globalScope(),
                    JSFunction::createStructure(init.vm, init.owner, RequireFunctionPrototype::create(init.owner))));
        });

    m_requireResolveFunctionUnbound.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init) {
            init.set(
                JSFunction::create(
                    init.vm,
                    init.owner,
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

    m_JSFileSinkClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::FileSink);
            auto* structure = JSFileSink::createStructure(init.vm, init.global, prototype);
            auto* constructor = JSFileSinkConstructor::create(init.vm, init.global, JSFileSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<JSObject*>(prototype));
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
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto argCount = callFrame->argumentCount();
    if (argCount == 0) {
        JSC::throwTypeError(globalObject, scope, "setImmediate requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        JSC::throwTypeError(globalObject, scope, "setImmediate expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue arguments = {};
    switch (argCount) {
    case 0:
    case 1: {
        break;
    }
    case 2: {
        arguments = callFrame->argument(1);
        break;
    }
    default: {
        ArgList argumentsList = ArgList(callFrame, 1);
        auto* args = JSC::JSImmutableButterfly::tryCreateFromArgList(vm, argumentsList);

        if (UNLIKELY(!args)) {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        arguments = JSValue(args);
    }
    }

    return Bun__Timer__setImmediate(globalObject, JSC::JSValue::encode(job), JSValue::encode(arguments));
}

JSValue getEventSourceConstructor(VM& vm, JSObject* thisObject)
{
    auto globalObject = jsCast<Zig::GlobalObject*>(thisObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSFunction* getSourceEvent = JSC::JSFunction::create(vm, globalObject, eventSourceGetEventSourceCodeGenerator(vm), globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::MarkedArgumentBuffer args;

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
    JSC::JSFunction* createConsoleConstructor = JSC::JSFunction::create(vm, globalObject, consoleObjectCreateConsoleConstructorCodeGenerator(vm), globalObject);
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
        function = JSFunction::create(vm, this, static_cast<JSC::FunctionExecutable*>(readableStreamInternalsAssignToStreamCodeGenerator(vm)), this);
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

BUN_DECLARE_HOST_FUNCTION(WebCore__alert);
BUN_DECLARE_HOST_FUNCTION(WebCore__prompt);
BUN_DECLARE_HOST_FUNCTION(WebCore__confirm);

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

    GlobalPropertyInfo staticGlobals[] = {
        GlobalPropertyInfo { builtinNames.startDirectStreamPrivateName(),
            JSC::JSFunction::create(vm, this, 1,
                String(), functionStartDirectStream, ImplementationVisibility::Public),
            PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0 },

        GlobalPropertyInfo { builtinNames.lazyPrivateName(),
            JSC::JSFunction::create(vm, this, 0, "@lazy"_s, JS2Native::jsDollarLazy, ImplementationVisibility::Public),
            PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | 0 },

        GlobalPropertyInfo(builtinNames.makeThisTypeErrorPrivateName(), JSFunction::create(vm, this, 2, String(), makeThisTypeErrorForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.makeGetterTypeErrorPrivateName(), JSFunction::create(vm, this, 2, String(), makeGetterTypeErrorForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.makeDOMExceptionPrivateName(), JSFunction::create(vm, this, 2, String(), makeDOMExceptionForBuiltins, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.addAbortAlgorithmToSignalPrivateName(), JSFunction::create(vm, this, 2, String(), addAbortAlgorithmToSignal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.removeAbortAlgorithmFromSignalPrivateName(), JSFunction::create(vm, this, 2, String(), removeAbortAlgorithmFromSignal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.cloneArrayBufferPrivateName(), JSFunction::create(vm, this, 3, String(), cloneArrayBuffer, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.structuredCloneForStreamPrivateName(), JSFunction::create(vm, this, 1, String(), structuredCloneForStream, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.isAbortSignalPrivateName(), JSFunction::create(vm, this, 1, String(), isAbortSignal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.getInternalWritableStreamPrivateName(), JSFunction::create(vm, this, 1, String(), getInternalWritableStream, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.createWritableStreamFromInternalPrivateName(), JSFunction::create(vm, this, 1, String(), createWritableStreamFromInternal, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.fulfillModuleSyncPrivateName(), JSFunction::create(vm, this, 1, String(), functionFulfillModuleSync, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(vm.propertyNames->builtinNames().ArrayBufferPrivateName(), arrayBufferConstructor(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.LoaderPrivateName(), this->moduleLoader(), PropertyAttribute::DontDelete | 0),
        GlobalPropertyInfo(builtinNames.internalModuleRegistryPrivateName(), this->internalModuleRegistry(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.processBindingConstantsPrivateName(), this->processBindingConstants(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
        GlobalPropertyInfo(builtinNames.requireMapPrivateName(), this->requireMap(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0),
        GlobalPropertyInfo(builtinNames.TextEncoderStreamEncoderPrivateName(), JSTextEncoderStreamEncoderConstructor(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0),
        GlobalPropertyInfo(builtinNames.makeErrorWithCodePrivateName(), JSFunction::create(vm, this, 2, String(), jsFunctionMakeErrorWithCode, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly),
    };
    addStaticGlobals(staticGlobals, std::size(staticGlobals));

    // TODO: most/all of these private properties can be made as static globals.
    // i've noticed doing it as is will work somewhat but getDirect() wont be able to find them

    putDirectBuiltinFunction(vm, this, builtinNames.createFIFOPrivateName(), streamInternalsCreateFIFOCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.createEmptyReadableStreamPrivateName(), readableStreamCreateEmptyReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectBuiltinFunction(vm, this, builtinNames.createUsedReadableStreamPrivateName(), readableStreamCreateUsedReadableStreamCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
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
    visitor.append(thisObject->m_readableStreamToBytes);
    visitor.append(thisObject->m_readableStreamToBlob);
    visitor.append(thisObject->m_readableStreamToJSON);
    visitor.append(thisObject->m_readableStreamToText);
    visitor.append(thisObject->m_readableStreamToFormData);
    visitor.append(thisObject->m_nodeModuleOverriddenResolveFilename);

    visitor.append(thisObject->m_nextTickQueue);
    visitor.append(thisObject->m_errorConstructorPrepareStackTraceValue);

    visitor.append(thisObject->m_pendingNapiModuleAndExports[0]);
    visitor.append(thisObject->m_pendingNapiModuleAndExports[1]);

    visitor.append(thisObject->m_currentNapiHandleScopeImpl);

    thisObject->m_asyncBoundFunctionStructure.visit(visitor);
    thisObject->m_bunObject.visit(visitor);
    thisObject->m_cachedNodeVMGlobalObjectStructure.visit(visitor);
    thisObject->m_cachedGlobalProxyStructure.visit(visitor);
    thisObject->m_callSiteStructure.visit(visitor);
    thisObject->m_commonJSModuleObjectStructure.visit(visitor);
    thisObject->m_cryptoObject.visit(visitor);
    thisObject->m_errorConstructorPrepareStackTraceInternalValue.visit(visitor);
    thisObject->m_esmRegistryMap.visit(visitor);
    thisObject->m_importMetaObjectStructure.visit(visitor);
    thisObject->m_internalModuleRegistry.visit(visitor);
    thisObject->m_JSArrayBufferControllerPrototype.visit(visitor);
    thisObject->m_JSArrayBufferSinkClassStructure.visit(visitor);
    thisObject->m_JSBufferClassStructure.visit(visitor);
    thisObject->m_JSBufferListClassStructure.visit(visitor);
    thisObject->m_JSBufferSubclassStructure.visit(visitor);
    thisObject->m_JSCryptoKey.visit(visitor);
    thisObject->m_JSDOMFileConstructor.visit(visitor);
    thisObject->m_JSFFIFunctionStructure.visit(visitor);
    thisObject->m_JSFileSinkClassStructure.visit(visitor);
    thisObject->m_JSFileSinkControllerPrototype.visit(visitor);
    thisObject->m_JSHTTPResponseController.visit(visitor);
    thisObject->m_JSHTTPResponseSinkClassStructure.visit(visitor);
    thisObject->m_JSHTTPSResponseControllerPrototype.visit(visitor);
    thisObject->m_JSHTTPSResponseSinkClassStructure.visit(visitor);
    thisObject->m_JSSocketAddressStructure.visit(visitor);
    thisObject->m_JSSQLStatementStructure.visit(visitor);
    thisObject->m_V8GlobalInternals.visit(visitor);
    thisObject->m_JSStringDecoderClassStructure.visit(visitor);
    thisObject->m_lazyPreloadTestModuleObject.visit(visitor);
    thisObject->m_lazyReadableStreamPrototypeMap.visit(visitor);
    thisObject->m_lazyRequireCacheObject.visit(visitor);
    thisObject->m_lazyTestModuleObject.visit(visitor);
    thisObject->m_memoryFootprintStructure.visit(visitor);
    thisObject->m_NapiClassStructure.visit(visitor);
    thisObject->m_NapiExternalStructure.visit(visitor);
    thisObject->m_NAPIFunctionStructure.visit(visitor);
    thisObject->m_NapiPrototypeStructure.visit(visitor);
    thisObject->m_NapiHandleScopeImplStructure.visit(visitor);
    thisObject->m_nativeMicrotaskTrampoline.visit(visitor);
    thisObject->m_navigatorObject.visit(visitor);
    thisObject->m_NodeVMScriptClassStructure.visit(visitor);
    thisObject->m_pendingVirtualModuleResultStructure.visit(visitor);
    thisObject->m_performanceObject.visit(visitor);
    thisObject->m_performMicrotaskFunction.visit(visitor);
    thisObject->m_performMicrotaskVariadicFunction.visit(visitor);
    thisObject->m_processEnvObject.visit(visitor);
    thisObject->m_processObject.visit(visitor);
    thisObject->m_requireFunctionUnbound.visit(visitor);
    thisObject->m_requireMap.visit(visitor);
    thisObject->m_requireResolveFunctionUnbound.visit(visitor);
    thisObject->m_subtleCryptoObject.visit(visitor);
    thisObject->m_testMatcherUtilsObject.visit(visitor);
    thisObject->m_utilInspectFunction.visit(visitor);
    thisObject->m_utilInspectOptionsStructure.visit(visitor);
    thisObject->m_utilInspectStylizeColorFunction.visit(visitor);
    thisObject->m_utilInspectStylizeNoColorFunction.visit(visitor);
    thisObject->m_vmModuleContextMap.visit(visitor);
    thisObject->mockModule.activeSpySetStructure.visit(visitor);
    thisObject->mockModule.mockFunctionStructure.visit(visitor);
    thisObject->mockModule.mockImplementationStructure.visit(visitor);
    thisObject->mockModule.mockModuleStructure.visit(visitor);
    thisObject->mockModule.mockObjectStructure.visit(visitor);
    thisObject->mockModule.mockResultStructure.visit(visitor);
    thisObject->mockModule.mockWithImplementationCleanupDataStructure.visit(visitor);
    thisObject->mockModule.withImplementationCleanupFunction.visit(visitor);

    thisObject->m_nodeErrorCache.visit(visitor);

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
    auto& vm = this->vm();
    JSC::JSMap* registry = jsCast<JSC::JSMap*>(moduleLoader->get(
        this,
        Identifier::fromString(vm, "registry"_s)));

    registry->clear(this);
    this->requireMap()->clear(this);

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
        if (moduleName->startsWith("file://"_s)) {
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

    String moduleName = moduleNameValue->value(globalObject);
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
    auto sourceOriginZ = sourceURL.isEmpty() ? BunStringCwd
        : sourceURL.protocolIsFile()
        ? Bun::toStringRef(sourceURL.fileSystemPath())
        : sourceURL.protocol() == "builtin"_s
        ? // On Windows, drive letter from standalone mode gets put into the URL host
        Bun::toStringRef(sourceURL.string().substring(10 /* builtin:// */))
        : Bun::toStringRef(sourceURL.path().toString());
    ZigString queryString = { 0, 0 };
    resolved.success = false;
    Zig__GlobalObject__resolve(&resolved, globalObject, &moduleNameZ, &sourceOriginZ, &queryString);
    moduleNameZ.deref();
    sourceOriginZ.deref();
    ASSERT(startRefCount == moduleName.impl()->refCount());
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

    // This gets passed through the "parameters" argument to moduleLoaderFetch.
    // Therefore, we modify it in place.
    if (parameters && parameters.isObject()) {
        auto* object = parameters.toObject(globalObject);
        if (auto withObject = object->getIfPropertyExists(globalObject, vm.propertyNames->withKeyword)) {
            if (withObject.isObject()) {
                auto* with = jsCast<JSObject*>(withObject);
                if (auto type = with->getIfPropertyExists(globalObject, vm.propertyNames->type)) {
                    if (type.isString()) {
                        const auto typeString = type.toWTFString(globalObject);
                        parameters = JSC::JSScriptFetchParameters::create(vm, ScriptFetchParameters::create(typeString));
                    }
                }
            }
        }
    }

    auto result = JSC::importModule(globalObject, resolvedIdentifier,
        JSC::jsUndefined(), parameters, jsUndefined());
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
        key,
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
    return Zig::ImportMetaObject::create(globalObject, key);
}

JSC::JSValue GlobalObject::moduleLoaderEvaluate(JSGlobalObject* lexicalGlobalObject,
    JSModuleLoader* moduleLoader, JSValue key,
    JSValue moduleRecordValue, JSValue scriptFetcher,
    JSValue sentValue, JSValue resumeMode)
{

    if (UNLIKELY(scriptFetcher && scriptFetcher.isObject())) {
        return scriptFetcher;
    }

    JSC::JSValue result = moduleLoader->evaluateNonVirtual(lexicalGlobalObject, key, moduleRecordValue,
        scriptFetcher, sentValue, resumeMode);

    return result;
}

extern "C" bool Bun__VM__specifierIsEvalEntryPoint(void*, EncodedJSValue);
extern "C" void Bun__VM__setEntryPointEvalResultESM(void*, EncodedJSValue);

JSC::JSValue EvalGlobalObject::moduleLoaderEvaluate(JSGlobalObject* lexicalGlobalObject,
    JSModuleLoader* moduleLoader, JSValue key,
    JSValue moduleRecordValue, JSValue scriptFetcher,
    JSValue sentValue, JSValue resumeMode)
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    if (UNLIKELY(scriptFetcher && scriptFetcher.isObject())) {
        if (Bun__VM__specifierIsEvalEntryPoint(globalObject->bunVM(), JSValue::encode(key))) {
            Bun__VM__setEntryPointEvalResultESM(globalObject->bunVM(), JSValue::encode(scriptFetcher));
        }
        return scriptFetcher;
    }

    JSC::JSValue result = moduleLoader->evaluateNonVirtual(lexicalGlobalObject, key, moduleRecordValue,
        scriptFetcher, sentValue, resumeMode);

    if (Bun__VM__specifierIsEvalEntryPoint(globalObject->bunVM(), JSValue::encode(key))) {
        Bun__VM__setEntryPointEvalResultESM(globalObject->bunVM(), JSValue::encode(result));
    }

    return result;
}

GlobalObject::PromiseFunctions GlobalObject::promiseHandlerID(Zig::FFIFunction handler)
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
    } else if (handler == Bun__BodyValueBufferer__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__BodyValueBufferer__onResolveStream;
    } else if (handler == Bun__BodyValueBufferer__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__BodyValueBufferer__onRejectStream;
    } else if (handler == Bun__onResolveEntryPointResult) {
        return GlobalObject::PromiseFunctions::Bun__onResolveEntryPointResult;
    } else if (handler == Bun__onRejectEntryPointResult) {
        return GlobalObject::PromiseFunctions::Bun__onRejectEntryPointResult;
    } else {
        RELEASE_ASSERT_NOT_REACHED();
    }
}

#include "ZigGeneratedClasses+lazyStructureImpl.h"
#include "ZigGlobalObject.lut.h"

const JSC::ClassInfo GlobalObject::s_info = { "GlobalObject"_s, &Base::s_info, &bunGlobalObjectTable, nullptr,
    CREATE_METHOD_TABLE(GlobalObject) };

} // namespace Zig
