#include "root.h"

#include "FormatStackTraceForJS.h"
#include "ZigGlobalObject.h"
#include "helpers.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/VM.h"

#include "BunClientData.h"
#include "CallSite.h"
#include "ErrorStackTrace.h"
#include "headers-handwritten.h"

using namespace JSC;
using namespace WebCore;

namespace Bun {

static JSValue formatStackTraceToJSValue(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // default formatting
    size_t framesCount = callSites->length();

    WTF::StringBuilder sb;

    auto errorMessage = errorObject->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->message);
    RETURN_IF_EXCEPTION(scope, {});
    if (errorMessage) {
        auto* str = errorMessage.toString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (str->length() > 0) {
            auto value = str->view(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            sb.append("Error: "_s);
            sb.append(value.data);
        } else {
            sb.append("Error"_s);
        }
    } else {
        sb.append("Error"_s);
    }

    for (size_t i = 0; i < framesCount; i++) {
        sb.append("\n    at "_s);

        JSC::JSValue callSiteValue = callSites->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(scope, {});

        if (CallSite* callSite = JSC::jsDynamicCast<CallSite*>(callSiteValue)) {
            callSite->formatAsString(vm, lexicalGlobalObject, sb);
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            // This matches Node.js / V8's behavior
            // It can become "at [object Object]" if the object is not a CallSite
            auto* str = callSiteValue.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto value = str->value(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            sb.append(value.data);
        }
    }

    return jsString(vm, sb.toString());
}

static JSValue formatStackTraceToJSValue(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites, JSValue prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto stackStringValue = formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSites);
    RETURN_IF_EXCEPTION(scope, {});

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
                lexicalGlobalObject->m_errorStructure.constructor(globalObject),
                arguments);

            RETURN_IF_EXCEPTION(scope, stackStringValue);

            if (result.isUndefinedOrNull()) {
                result = jsUndefined();
            }

            return result;
        }
    }

    return stackStringValue;
}

static JSValue formatStackTraceToJSValueWithoutPrepareStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites)
{
    JSValue prepareStackTrace = {};
    if (lexicalGlobalObject->inherits<Zig::GlobalObject>()) {
        if (auto prepare = globalObject->m_errorConstructorPrepareStackTraceValue.get()) {
            prepareStackTrace = prepare;
        }
    } else {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

        auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(globalObject);
        prepareStackTrace = errorConstructor->getIfPropertyExists(lexicalGlobalObject, JSC::Identifier::fromString(vm, "prepareStackTrace"_s));
        CLEAR_IF_EXCEPTION(scope);
    }

    return formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSites, prepareStackTrace);
}

WTF::String formatStackTrace(
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
    void* bunVM = nullptr;
    const auto getBunVM = [&]() -> void* {
        if (!bunVM) {
            bunVM = clientData(vm)->bunVM;
        }
        return bunVM;
    };

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
                        Bun__remapStackFramePositions(getBunVM(), &remappedFrame, 1);

                        sourceURLForFrame = remappedFrame.source_url.toWTFString();
                    }
                }

                // there is always a newline before each stack frame line, ensuring that the name + message
                // exist on the first line, even if both are empty
                sb.append("\n"_s);

                sb.append("    at <parse> ("_s);

                sb.append(remappedFrame.source_url.toWTFString());

                if (remappedFrame.remapped) {
                    errorInstance->putDirect(vm, builtinNames(vm).originalLinePublicName(), jsNumber(originalLine.oneBasedInt()), PropertyAttribute::DontEnum | 0);
                    hasSet = true;
                    line = remappedFrame.position.line();
                }

                if (remappedFrame.remapped) {
                    sb.append(':');
                    sb.append(remappedFrame.position.line().oneBasedInt());
                } else {
                    sb.append(':');
                    sb.append(originalLine.oneBasedInt());
                }

                sb.append(')');
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
        unsigned int flags = static_cast<unsigned int>(FunctionNameFlags::AddNewKeyword);

        // -- get the data we need to render the text --
        JSC::JSGlobalObject* globalObjectForFrame = lexicalGlobalObject;
        if (frame.hasLineAndColumnInfo()) {
            auto* callee = frame.callee();
            if (callee) {
                if (auto* object = callee->getObject()) {
                    globalObjectForFrame = object->globalObject();
                }
            }
        }

        WTF::String functionName = Zig::functionName(vm, globalObjectForFrame, frame, errorInstance ? Zig::FinalizerSafety::NotInFinalizer : Zig::FinalizerSafety::MustNotTriggerGC, &flags);
        OrdinalNumber originalLine = {};
        OrdinalNumber originalColumn = {};
        OrdinalNumber displayLine = {};
        OrdinalNumber displayColumn = {};
        WTF::String sourceURLForFrame;

        if (frame.hasLineAndColumnInfo()) {
            ZigStackFrame remappedFrame = {};
            LineColumn lineColumn = frame.computeLineAndColumn();
            originalLine = OrdinalNumber::fromOneBasedInt(lineColumn.line);
            originalColumn = OrdinalNumber::fromOneBasedInt(lineColumn.column);
            displayLine = originalLine;
            displayColumn = originalColumn;

            remappedFrame.position.line_zero_based = originalLine.zeroBasedInt();
            remappedFrame.position.column_zero_based = originalColumn.zeroBasedInt();

            sourceURLForFrame = Zig::sourceURL(vm, frame);

            bool isDefinitelyNotRunninginNodeVMGlobalObject = globalObject == globalObjectForFrame;

            bool isDefaultGlobalObjectInAFinalizer = (globalObject && !lexicalGlobalObject && !errorInstance);
            if (isDefinitelyNotRunninginNodeVMGlobalObject || isDefaultGlobalObjectInAFinalizer) {
                // https://github.com/oven-sh/bun/issues/3595
                if (!sourceURLForFrame.isEmpty()) {
                    remappedFrame.source_url = Bun::toStringRef(sourceURLForFrame);

                    // This ensures the lifetime of the sourceURL is accounted for correctly
                    Bun__remapStackFramePositions(getBunVM(), &remappedFrame, 1);

                    sourceURLForFrame = remappedFrame.source_url.toWTFString();
                }
            }

            displayLine = remappedFrame.position.line();
            displayColumn = remappedFrame.position.column();

            if (!hasSet) {
                hasSet = true;
                line = remappedFrame.position.line();
                column = remappedFrame.position.column();
                sourceURL = sourceURLForFrame;

                if (remappedFrame.remapped) {
                    if (errorInstance) {
                        errorInstance->putDirect(vm, builtinNames(vm).originalLinePublicName(), jsNumber(originalLine.oneBasedInt()), PropertyAttribute::DontEnum | 0);
                        errorInstance->putDirect(vm, builtinNames(vm).originalColumnPublicName(), jsNumber(originalColumn.oneBasedInt()), PropertyAttribute::DontEnum | 0);
                    }
                }
            }
        }

        if (functionName.isEmpty()) {
            if (flags & (static_cast<unsigned int>(FunctionNameFlags::Eval) | static_cast<unsigned int>(FunctionNameFlags::Function))) {
                functionName = "<anonymous>"_s;
            }
        }

        if (sourceURLForFrame.isEmpty()) {
            if (flags & static_cast<unsigned int>(FunctionNameFlags::Builtin)) {
                sourceURLForFrame = "native"_s;
            } else {
                sourceURLForFrame = "unknown"_s;
            }
        }

        // --- actually render the text ---

        sb.append("    at "_s);

        if (!functionName.isEmpty()) {
            if (frame.isAsyncFrame()) {
                sb.append("async "_s);
            }
            sb.append(functionName);
            sb.append(" ("_s);
        }

        if (!sourceURLForFrame.isEmpty()) {
            sb.append(sourceURLForFrame);
            if (displayLine.zeroBasedInt() > 0 || displayColumn.zeroBasedInt() > 0) {
                sb.append(':');
                sb.append(displayLine.oneBasedInt());

                if (displayColumn.zeroBasedInt() > 0) {
                    sb.append(':');
                    sb.append(displayColumn.oneBasedInt());
                }
            }
        }

        if (!functionName.isEmpty()) {
            sb.append(')');
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
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String name = "Error"_s;
    WTF::String message;

    if (errorInstance) {
        // Note that we are not allowed to allocate memory in here. It's called inside a finalizer.
        if (auto* instance = jsDynamicCast<ErrorInstance*>(errorInstance)) {
            if (!lexicalGlobalObject) {
                lexicalGlobalObject = errorInstance->globalObject();
            }
            name = instance->sanitizedNameString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            message = instance->sanitizedMessageString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    if (!globalObject) [[unlikely]] {
        globalObject = defaultGlobalObject();
    }

    return Bun::formatStackTrace(vm, globalObject, lexicalGlobalObject, name, message, line, column, sourceURL, stackTrace, errorInstance);
}

static JSValue computeErrorInfoWithPrepareStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<StackFrame>& stackFrames, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorObject, JSObject* prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCStackTrace stackTrace = JSCStackTrace::fromExisting(vm, stackFrames);

    // Note: we cannot use tryCreateUninitializedRestricted here because we cannot allocate memory inside initializeIndex()
    MarkedArgumentBuffer callSites;

    // Create the call sites (one per frame)
    Zig::createCallSitesFromFrames(globalObject, lexicalGlobalObject, stackTrace, callSites);

    // We need to sourcemap it if it's a GlobalObject.

    for (int i = 0; i < stackTrace.size(); i++) {
        ZigStackFrame frame = {};
        auto& stackFrame = stackFrames.at(i);
        String sourceURLForFrame = Zig::sourceURL(vm, stackFrame);

        // When you use node:vm, the global object can be different on a
        // per-frame basis. We should sourcemap the frames which are in Bun's
        // global object, and not sourcemap the frames which are in a different
        // global object.
        JSGlobalObject* globalObjectForFrame = lexicalGlobalObject;

        if (stackFrame.hasLineAndColumnInfo()) {
            auto* callee = stackFrame.callee();
            // https://github.com/oven-sh/bun/issues/17698
            if (callee) {
                if (auto* object = callee->getObject()) {
                    globalObjectForFrame = object->globalObject();
                }
            }
        }

        if (globalObjectForFrame == globalObject) {
            if (JSCStackFrame::SourcePositions* sourcePositions = stackTrace.at(i).getSourcePositions()) {
                frame.position.line_zero_based = sourcePositions->line.zeroBasedInt();
                frame.position.column_zero_based = sourcePositions->column.zeroBasedInt();
            } else {
                frame.position.line_zero_based = -1;
                frame.position.column_zero_based = -1;
            }

            if (!sourceURLForFrame.isEmpty()) {
                frame.source_url = Bun::toStringRef(sourceURLForFrame);

                // This ensures the lifetime of the sourceURL is accounted for correctly
                Bun__remapStackFramePositions(globalObject->bunVM(), &frame, 1);

                sourceURLForFrame = frame.source_url.toWTFString();
            }
        }

        auto* callsite = jsCast<CallSite*>(callSites.at(i));

        if (!sourceURLForFrame.isEmpty())
            callsite->setSourceURL(vm, jsString(vm, sourceURLForFrame));

        if (frame.remapped) {
            callsite->setLineNumber(frame.position.line());
            callsite->setColumnNumber(frame.position.column());
        }
    }

    JSArray* callSitesArray = JSC::constructArray(globalObject, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), callSites);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSitesArray, prepareStackTrace));
}

static String computeErrorInfoToString(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL)
{

    Zig::GlobalObject* globalObject = nullptr;
    JSC::JSGlobalObject* lexicalGlobalObject = nullptr;

    return computeErrorInfoWithoutPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, line, column, sourceURL, nullptr);
}

static JSValue computeErrorInfoToJSValueWithoutSkipping(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance, void* bunErrorData)
{
    UNUSED_PARAM(bunErrorData);

    Zig::GlobalObject* globalObject = nullptr;
    JSC::JSGlobalObject* lexicalGlobalObject = nullptr;
    lexicalGlobalObject = errorInstance->globalObject();
    globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Error.prepareStackTrace - https://v8.dev/docs/stack-trace-api#customizing-stack-traces
    if (!globalObject) {
        // node:vm will use a different JSGlobalObject
        globalObject = defaultGlobalObject();
        if (!globalObject->isInsideErrorPrepareStackTraceCallback) {
            auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(lexicalGlobalObject);
            auto prepareStackTrace = errorConstructor->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "prepareStackTrace"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (prepareStackTrace) {
                if (prepareStackTrace.isCell() && prepareStackTrace.isObject() && prepareStackTrace.isCallable()) {
                    globalObject->isInsideErrorPrepareStackTraceCallback = true;
                    auto result = computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, line, column, sourceURL, errorInstance, prepareStackTrace.getObject());
                    globalObject->isInsideErrorPrepareStackTraceCallback = false;
                    RELEASE_AND_RETURN(scope, result);
                }
            }
        }
    } else if (!globalObject->isInsideErrorPrepareStackTraceCallback) {
        if (JSValue prepareStackTrace = globalObject->m_errorConstructorPrepareStackTraceValue.get()) {
            if (prepareStackTrace) {
                if (prepareStackTrace.isCallable()) {
                    globalObject->isInsideErrorPrepareStackTraceCallback = true;
                    auto result = computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, line, column, sourceURL, errorInstance, prepareStackTrace.getObject());
                    globalObject->isInsideErrorPrepareStackTraceCallback = false;
                    RELEASE_AND_RETURN(scope, result);
                }
            }
        }
    }

    String result = computeErrorInfoWithoutPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, line, column, sourceURL, errorInstance);
    RETURN_IF_EXCEPTION(scope, {});
    return jsString(vm, result);
}

static JSValue computeErrorInfoToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance, void* bunErrorData)
{
    return computeErrorInfoToJSValueWithoutSkipping(vm, stackTrace, line, column, sourceURL, errorInstance, bunErrorData);
}

WTF::String computeErrorInfoWrapperToString(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, String& sourceURL, void* bunErrorData)
{
    UNUSED_PARAM(bunErrorData);

    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(line_in);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(column_in);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    WTF::String result = computeErrorInfoToString(vm, stackTrace, line, column, sourceURL);
    if (scope.exception()) {
        // TODO: is this correct? vm.setOnComputeErrorInfo doesnt appear to properly handle a function that can throw
        // test/js/node/test/parallel/test-stream-writable-write-writev-finish.js is the one that trips the exception checker
        (void)scope.tryClearException();
        result = WTF::emptyString();
    }

    line_in = line.oneBasedInt();
    column_in = column.oneBasedInt();

    return result;
}

void computeLineColumnWithSourcemap(JSC::VM& vm, JSC::SourceProvider* _Nonnull sourceProvider, JSC::LineColumn& lineColumn)
{
    auto sourceURL = sourceProvider->sourceURL();
    if (sourceURL.isEmpty()) {
        return;
    }

    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(lineColumn.line);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(lineColumn.column);

    ZigStackFrame frame = {};
    frame.position.line_zero_based = line.zeroBasedInt();
    frame.position.column_zero_based = column.zeroBasedInt();
    frame.source_url = Bun::toStringRef(sourceURL);

    Bun__remapStackFramePositions(Bun::vm(vm), &frame, 1);

    if (frame.remapped) {
        lineColumn.line = frame.position.line().oneBasedInt();
        lineColumn.column = frame.position.column().oneBasedInt();
    }
}

JSC::JSValue computeErrorInfoWrapperToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, String& sourceURL, JSObject* errorInstance, void* bunErrorData)
{
    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(line_in);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(column_in);

    JSValue result = computeErrorInfoToJSValue(vm, stackTrace, line, column, sourceURL, errorInstance, bunErrorData);

    line_in = line.oneBasedInt();
    column_in = column.oneBasedInt();

    return result;
}

JSC_DEFINE_HOST_FUNCTION(errorConstructorFuncAppendStackTrace, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::ErrorInstance* source = jsDynamicCast<JSC::ErrorInstance*>(callFrame->argument(0));
    JSC::ErrorInstance* destination = jsDynamicCast<JSC::ErrorInstance*>(callFrame->argument(1));

    if (!source || !destination) {
        throwTypeError(lexicalGlobalObject, scope, "First & second argument must be an Error object"_s);
        return {};
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
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto errorObject = jsDynamicCast<JSC::ErrorInstance*>(callFrame->argument(0));
    auto callSites = jsDynamicCast<JSC::JSArray*>(callFrame->argument(1));
    if (!errorObject) {
        throwTypeError(lexicalGlobalObject, scope, "First argument must be an Error object"_s);
        return {};
    }
    if (!callSites) {
        callSites = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), 0);
    }

    JSValue result = formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSites, jsUndefined());

    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(errorInstanceLazyStackCustomGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* errorObject = jsDynamicCast<ErrorInstance*>(JSValue::decode(thisValue));

    // This shouldn't be possible.
    if (!errorObject) {
        return JSValue::encode(jsUndefined());
    }

    OrdinalNumber line;
    OrdinalNumber column;
    String sourceURL;
    auto stackTrace = errorObject->stackTrace();
    if (stackTrace == nullptr) {
        return JSValue::encode(jsUndefined());
    }

    JSValue result = computeErrorInfoToJSValue(vm, *stackTrace, line, column, sourceURL, errorObject, nullptr);
    stackTrace->clear();
    errorObject->setStackFrames(vm, {});
    RETURN_IF_EXCEPTION(scope, {});
    errorObject->putDirect(vm, vm.propertyNames->stack, result, 0);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_SETTER(errorInstanceLazyStackCustomSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    JSValue decodedValue = JSValue::decode(thisValue);
    if (auto* object = decodedValue.getObject()) {
        object->putDirect(vm, vm.propertyNames->stack, JSValue::decode(value), 0);
    }

    return true;
}

JSC_DEFINE_HOST_FUNCTION(errorConstructorFuncCaptureStackTrace, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
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

    WTF::Vector<JSC::StackFrame> stackTrace;
    JSCStackTrace::getFramesForCaller(vm, callFrame, errorObject, caller, stackTrace, stackTraceLimit);

    if (auto* instance = jsDynamicCast<JSC::ErrorInstance*>(errorObject)) {
        instance->setStackFrames(vm, WTF::move(stackTrace));
        if (instance->hasMaterializedErrorInfo()) {
            const auto& propertyName = vm.propertyNames->stack;
            VM::DeletePropertyModeScope scope(vm, VM::DeletePropertyMode::IgnoreConfigurable);
            DeletePropertySlot slot;
            JSObject::deleteProperty(instance, globalObject, propertyName, slot);
            if (auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject)) {
                instance->putDirectCustomAccessor(vm, vm.propertyNames->stack, zigGlobalObject->m_lazyStackCustomGetterSetter.get(zigGlobalObject), JSC::PropertyAttribute::CustomAccessor | 0);
            } else {
                instance->putDirectCustomAccessor(vm, vm.propertyNames->stack, CustomGetterSetter::create(vm, errorInstanceLazyStackCustomGetter, errorInstanceLazyStackCustomSetter), JSC::PropertyAttribute::CustomAccessor | 0);
            }
        }
    } else {
        OrdinalNumber line;
        OrdinalNumber column;
        String sourceURL;
        JSValue result = computeErrorInfoToJSValue(vm, stackTrace, line, column, sourceURL, errorObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        errorObject->putDirect(vm, vm.propertyNames->stack, result, 0);
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

} // namespace Bun

namespace Zig {

void createCallSitesFromFrames(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSCStackTrace& stackTrace, MarkedArgumentBuffer& callSites)
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

        if (!encounteredStrictFrame) {
            encounteredStrictFrame = callSite->isStrict();
        }

        callSites.append(callSite);
    }
}

} // namespace Zig
