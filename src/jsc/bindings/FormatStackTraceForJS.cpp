#include "root.h"

#include "FormatStackTraceForJS.h"
#include "ZigGlobalObject.h"
#include "helpers.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/DeferTermination.h"
#include "JavaScriptCore/FrameTracers.h"
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

#include <wtf/Scope.h>
#include <wtf/Threading.h>

using namespace JSC;
using namespace WebCore;

namespace Bun {

// What `.stack` is when the frames do not fit in one string.
static WTF::String stackTraceHeaderOnly(const WTF::String& name, const WTF::String& message)
{
    if (name.isEmpty())
        return message;
    if (message.isEmpty())
        return name;
    WTF::String header = tryMakeString(name, ": "_s, message);
    if (header.isNull()) [[unlikely]]
        return message;
    return header;
}

// What the header does with a throw from the error's `name` (a getter, a Symbol, a toString): V8
// propagates it to a caller of the default Error.prepareStackTrace, and describes it in the header of
// the error.stack a prepareStackTrace callback sees.
enum class HeaderThrow : bool { Propagate,
    Describe };

// The two halves of Error.prototype.toString(), which is how V8's default formatter heads the stack.
static WTF::String stackTraceHeaderName(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue nameValue = errorObject->get(lexicalGlobalObject, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, {});
    if (nameValue.isUndefined())
        return "Error"_s;
    RELEASE_AND_RETURN(scope, nameValue.toWTFString(lexicalGlobalObject));
}

static WTF::String stackTraceHeaderMessage(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue messageValue = errorObject->get(lexicalGlobalObject, vm.propertyNames->message);
    RETURN_IF_EXCEPTION(scope, {});
    if (messageValue.isUndefined())
        return emptyString();
    RELEASE_AND_RETURN(scope, messageValue.toWTFString(lexicalGlobalObject));
}

static JSValue formatStackTraceToJSValue(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites, HeaderThrow headerThrow)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // default formatting
    size_t framesCount = callSites->length();

    // The message and the frames come from JS. Past `String::MaxLength` a default `StringBuilder` calls `CRASH()`.
    WTF::StringBuilder sb { WTF::OverflowPolicy::RecordOverflow };

    WTF::String name = stackTraceHeaderName(vm, lexicalGlobalObject, errorObject);
    WTF::String message;
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (headerThrow == HeaderThrow::Propagate)
            return {};
        JSValue thrown = exception->value();
        if (!scope.tryClearException())
            return {};
        // V8 describes what was thrown as it heads a stack, with Error.prototype.toString(): nothing
        // for a value that is not an object, or when describing it throws too.
        WTF::String description;
        if (JSC::JSObject* thrownObject = thrown.getObject()) {
            WTF::String thrownName = stackTraceHeaderName(vm, lexicalGlobalObject, thrownObject);
            WTF::String thrownMessage;
            if (!scope.exception()) [[likely]]
                thrownMessage = stackTraceHeaderMessage(vm, lexicalGlobalObject, thrownObject);
            if (scope.exception()) [[unlikely]] {
                if (!scope.tryClearException())
                    return {};
            } else {
                description = stackTraceHeaderOnly(thrownName, thrownMessage);
            }
        }
        // The description comes from JS: past `String::MaxLength` makeString() calls `CRASH()`.
        if (!description.isNull())
            name = tryMakeString("<error: "_s, description, '>');
        if (description.isNull() || name.isNull())
            name = "<error>"_s;
    } else {
        message = stackTraceHeaderMessage(vm, lexicalGlobalObject, errorObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!name.isEmpty()) {
        sb.append(name);
        if (!message.isEmpty()) {
            sb.append(": "_s);
            sb.append(message);
        }
    } else if (!message.isEmpty()) {
        sb.append(message);
    }

    for (size_t i = 0; i < framesCount; i++) {
        sb.append("\n    at "_s);

        JSC::JSValue callSiteValue = callSites->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(scope, {});

        if (CallSite* callSite = dynamicDowncast<CallSite>(callSiteValue)) {
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

    if (sb.hasOverflowed()) [[unlikely]]
        return jsString(vm, stackTraceHeaderOnly(name, message));

    return jsString(vm, sb.toString());
}

static JSValue formatStackTraceToJSValue(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* errorObject, JSC::JSArray* callSites, JSValue prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::CallData prepareStackTraceCallData;
    if (prepareStackTrace && prepareStackTrace.isObject())
        prepareStackTraceCallData = JSC::getCallData(prepareStackTrace);
    bool callsPrepareStackTrace = prepareStackTraceCallData.type != JSC::CallData::Type::None;

    auto stackStringValue = formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSites, callsPrepareStackTrace ? HeaderThrow::Describe : HeaderThrow::Propagate);
    RETURN_IF_EXCEPTION(scope, {});

    if (callsPrepareStackTrace) {
        // In Node, if you console.log(error.stack) inside Error.prepareStackTrace
        // it will display the stack as a formatted string, so we have to do the same.
        errorObject->putDirect(vm, vm.propertyNames->stack, stackStringValue, JSC::PropertyAttribute::DontEnum | 0);

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

// Whether the frame is of the realm that reads the stack: `globalObject`, which is the realm of the error if that is one
// of Bun's and the default one otherwise. With node:vm the realm can be different on a per-frame basis. The frames of
// Bun's global object are source-mapped, and the frames of another one are not.
static bool isOfReaderRealm(const DetachedStackFrame& frame, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject)
{
    // https://github.com/oven-sh/bun/issues/17698
    const JSC::JSGlobalObject* realm = frame.realm ? frame.realm : lexicalGlobalObject;
    return realm == globalObject;
}

// For frames that are still alive. A collection asks about every frame: it does not know who will read the stack.
static void mapFramesOfReaderRealm(JSC::VM& vm, std::span<DetachedStackFrame> frames, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject)
{
    WTF::Vector<DetachedStackFrame*, DEFAULT_ERROR_STACK_TRACE_LIMIT> inSource;
    for (auto& frame : frames) {
        // https://github.com/oven-sh/bun/issues/3595
        if (isOfReaderRealm(frame, globalObject, lexicalGlobalObject) && Zig::hasPositionInSource(frame))
            inSource.append(&frame);
    }
    Zig::mapDetachedStackFrames(vm, inSource.span());
}

static bool isSyntaxError(JSC::JSObject* errorInstance)
{
    auto* error = errorInstance ? dynamicDowncast<JSC::ErrorInstance>(errorInstance) : nullptr;
    return error && error->errorType() == ErrorType::SyntaxError;
}

// `topFrameSourceURL` is JSC::StackFrame::sourceURL() of the first frame. It is read for a SyntaxError only.
static WTF::String formatStackFrames(
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    const WTF::String& name,
    const WTF::String& message,
    OrdinalNumber& line,
    OrdinalNumber& column,
    WTF::String& sourceURL,
    std::span<const DetachedStackFrame> frames,
    const WTF::String& topFrameSourceURL,
    JSC::JSObject* errorInstance)
{
    using Flag = DetachedStackFrame::Flag;
    auto scope = DECLARE_THROW_SCOPE(vm);
    // The message and each frame's source URL come from JS. Past `String::MaxLength` a default `StringBuilder` calls `CRASH()`.
    WTF::StringBuilder sb { WTF::OverflowPolicy::RecordOverflow };

    if (!name.isEmpty()) {
        sb.append(name);
        if (!message.isEmpty()) {
            sb.append(": "_s);
            sb.append(message);
        }
    } else if (!message.isEmpty()) {
        sb.append(message);
    }

    bool hasSet = false;

    if (isSyntaxError(errorInstance)) {
        auto* err = uncheckedDowncast<JSC::ErrorInstance>(errorInstance);
        if (frames.empty() || topFrameSourceURL != err->sourceURL()) {
            // There appears to be an off-by-one error.
            // The following reproduces the issue:
            // /* empty comment */
            // "".test(/[a-0]/);
            auto originalLine = WTF::OrdinalNumber::fromOneBasedInt(err->line());

            OwnedZigStackFrames remappedFrames(1);
            ZigStackFrame& remappedFrame = remappedFrames[0];

            remappedFrame.position.line_zero_based = originalLine.zeroBasedInt();
            remappedFrame.position.column_zero_based = 0;

            String sourceURLForFrame = err->sourceURL();

            // If it's not a Zig::GlobalObject, don't bother source-mapping it.
            if (globalObject && !sourceURLForFrame.isEmpty()) {
                // https://github.com/oven-sh/bun/issues/3595
                if (!sourceURLForFrame.isEmpty()) {
                    remappedFrame.source_url = Bun::toStringRef(sourceURLForFrame);
                    remappedFrames.remap(clientData(vm)->bunVM);

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

    if (frames.empty()) {
        if (sb.hasOverflowed()) [[unlikely]]
            return stackTraceHeaderOnly(name, message);
        return sb.toString();
    }

    sb.append("\n"_s);

    for (size_t i = 0; i < frames.size(); i++) {
        const DetachedStackFrame& frame = frames[i];

        WTF::String functionName = frame.functionName;
        OrdinalNumber displayLine = {};
        OrdinalNumber displayColumn = {};
        WTF::String sourceURLForFrame;

        if (frame.flags.contains(Flag::HasPosition)) {
            OrdinalNumber originalLine = OrdinalNumber::fromOneBasedInt(frame.position.line);
            OrdinalNumber originalColumn = OrdinalNumber::fromOneBasedInt(frame.position.column);
            displayLine = originalLine;
            displayColumn = originalColumn;
            if (!frame.flags.contains(Flag::NoSourceURL))
                sourceURLForFrame = frame.sourceURL;

            bool isMapped = frame.flags.contains(Flag::Mapped) && isOfReaderRealm(frame, globalObject, lexicalGlobalObject);
            if (isMapped) {
                displayLine = OrdinalNumber::fromOneBasedInt(frame.mappedPosition.line);
                displayColumn = OrdinalNumber::fromOneBasedInt(frame.mappedPosition.column);
                if (!frame.mappedSourceURL.isNull())
                    sourceURLForFrame = frame.mappedSourceURL;
            }

            if (!hasSet) {
                hasSet = true;
                line = displayLine;
                column = displayColumn;
                sourceURL = sourceURLForFrame;

                if (isMapped) {
                    if (errorInstance) {
                        errorInstance->putDirect(vm, builtinNames(vm).originalLinePublicName(), jsNumber(originalLine.oneBasedInt()), PropertyAttribute::DontEnum | 0);
                        errorInstance->putDirect(vm, builtinNames(vm).originalColumnPublicName(), jsNumber(originalColumn.oneBasedInt()), PropertyAttribute::DontEnum | 0);
                    }
                }
            }
        }

        if (functionName.isEmpty()) {
            if (frame.flags.containsAny({ Flag::EvalCode, Flag::FunctionCode })) {
                functionName = "<anonymous>"_s;
            }
        }

        if (sourceURLForFrame.isEmpty()) {
            if (frame.flags.contains(Flag::BuiltinFunction)) {
                sourceURLForFrame = "native"_s;
            } else {
                sourceURLForFrame = "unknown"_s;
            }
        }

        // --- actually render the text ---

        sb.append("    at "_s);

        if (!functionName.isEmpty()) {
            if (frame.flags.contains(Flag::Async)) {
                sb.append("async "_s);
            }
            if (frame.flags.contains(Flag::Constructor) && !frame.functionName.isEmpty()) {
                sb.append("new "_s);
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

        if (i != frames.size() - 1) {
            sb.append("\n"_s);
        }
    }

    if (sb.hasOverflowed()) [[unlikely]]
        return stackTraceHeaderOnly(name, message);

    return sb.toString();
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
    WTF::Vector<DetachedStackFrame, DEFAULT_ERROR_STACK_TRACE_LIMIT> frames;
    frames.reserveInitialCapacity(stackTrace.size());
    for (auto& frame : stackTrace)
        frames.append(Zig::detachStackFrame(vm, frame));
    mapFramesOfReaderRealm(vm, frames.mutableSpan(), globalObject, lexicalGlobalObject);

    WTF::String topFrameSourceURL;
    if (!stackTrace.isEmpty() && isSyntaxError(errorInstance))
        topFrameSourceURL = stackTrace.at(0).sourceURL(vm);

    return formatStackFrames(vm, globalObject, lexicalGlobalObject, name, message, line, column, sourceURL, frames.span(), topFrameSourceURL, errorInstance);
}

// The frames an error's stack is made from: the ones it captured, or what a collection kept of them.
struct ErrorFrames {
    Vector<StackFrame>* captured { nullptr };
    const Zig::DetachedFrames* detached { nullptr };
};

// error.stack calls this function
static String computeErrorInfoWithoutPrepareStackTrace(
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    ErrorFrames frames,
    OrdinalNumber& line,
    OrdinalNumber& column,
    String& sourceURL,
    JSObject* errorInstance)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String name = "Error"_s;
    WTF::String message;

    if (auto* instance = dynamicDowncast<ErrorInstance>(errorInstance)) {
        name = instance->sanitizedNameString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        message = instance->sanitizedMessageString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (frames.captured)
        RELEASE_AND_RETURN(scope, Bun::formatStackTrace(vm, globalObject, lexicalGlobalObject, name, message, line, column, sourceURL, *frames.captured, errorInstance));
    RELEASE_AND_RETURN(scope, formatStackFrames(vm, globalObject, lexicalGlobalObject, name, message, line, column, sourceURL, frames.detached->frames(), frames.detached->topFrameSourceURL(), errorInstance));
}

static void appendCallSite(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, const DetachedStackFrame& frame, JSC::JSCell* callee, bool& encounteredStrictFrame, MarkedArgumentBuffer& callSites)
{
    if (frame.flags.contains(DetachedStackFrame::Flag::Private))
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CallSite* callSite = CallSite::create(lexicalGlobalObject, globalObject->callSiteStructure(), frame, isOfReaderRealm(frame, globalObject, lexicalGlobalObject), callee, encounteredStrictFrame);
    RETURN_IF_EXCEPTION(scope, );

    /* From v8's "Stack Trace API" (https://github.com/v8/v8/wiki/Stack-Trace-API):
     * "To maintain restrictions imposed on strict mode functions, frames that have a
     * strict mode function and all frames below (its caller etc.) are not allow to access
     * their receiver and function objects. For those frames, getFunction() and getThis()
     * will return undefined."." */
    if (!encounteredStrictFrame)
        encounteredStrictFrame = callSite->isStrict();
    callSites.append(callSite);
}

static JSValue computeErrorInfoWithPrepareStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, ErrorFrames frames, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorObject, JSObject* prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Note: we cannot use tryCreateUninitializedRestricted here because we cannot allocate memory inside initializeIndex()
    MarkedArgumentBuffer callSites;
    bool encounteredStrictFrame = false;

    if (frames.captured) {
        WTF::Vector<DetachedStackFrame, DEFAULT_ERROR_STACK_TRACE_LIMIT> callSiteFrames;
        callSiteFrames.reserveInitialCapacity(frames.captured->size());
        for (auto& frame : *frames.captured)
            callSiteFrames.append(Zig::JSCStackFrame(vm, frame).detach());
        mapFramesOfReaderRealm(vm, callSiteFrames.mutableSpan(), globalObject, lexicalGlobalObject);

        for (size_t i = 0; i < callSiteFrames.size(); i++) {
            appendCallSite(globalObject, lexicalGlobalObject, callSiteFrames[i], frames.captured->at(i).callee(), encounteredStrictFrame, callSites);
            RETURN_IF_EXCEPTION(scope, {});
        }
    } else {
        auto detachedFrames = frames.detached->frames();
        for (size_t i = 0; i < detachedFrames.size(); i++) {
            // The frame's function may be gone, so getFunction() is undefined, as it is for a strict function.
            appendCallSite(globalObject, lexicalGlobalObject, frames.detached->callSiteFrame(i), nullptr, encounteredStrictFrame, callSites);
            RETURN_IF_EXCEPTION(scope, {});
        }

        // The error's line, column and sourceURL are those of the first frame that has a position, as without a formatter.
        for (auto& frame : detachedFrames) {
            if (!frame.flags.contains(DetachedStackFrame::Flag::HasPosition))
                continue;
            bool isMapped = frame.flags.contains(DetachedStackFrame::Flag::Mapped) && isOfReaderRealm(frame, globalObject, lexicalGlobalObject);
            JSC::LineColumn position = isMapped ? frame.mappedPosition : frame.position;
            line = OrdinalNumber::fromOneBasedInt(position.line);
            column = OrdinalNumber::fromOneBasedInt(position.column);
            if (!frame.flags.contains(DetachedStackFrame::Flag::NoSourceURL))
                sourceURL = isMapped && !frame.mappedSourceURL.isNull() ? frame.mappedSourceURL : frame.sourceURL;
            break;
        }
    }

    JSArray* callSitesArray = JSC::constructArray(globalObject, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), callSites);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSitesArray, prepareStackTrace));
}

// `consultFormatter` is false for a stack that is about to be overwritten: Error.prepareStackTrace is not called for it.
static JSValue computeErrorInfoToJSValueWithoutSkipping(JSC::VM& vm, ErrorFrames frames, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance, bool consultFormatter)
{

    Zig::GlobalObject* globalObject = nullptr;
    JSC::JSGlobalObject* lexicalGlobalObject = nullptr;
    lexicalGlobalObject = errorInstance->globalObject();
    globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Error.prepareStackTrace - https://v8.dev/docs/stack-trace-api#customizing-stack-traces
    if (!globalObject) {
        // node:vm will use a different JSGlobalObject
        globalObject = defaultGlobalObject(vm);
        if (consultFormatter && !globalObject->isInsideErrorPrepareStackTraceCallback) {
            auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(lexicalGlobalObject);
            auto prepareStackTrace = errorConstructor->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "prepareStackTrace"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (prepareStackTrace) {
                if (prepareStackTrace.isCell() && prepareStackTrace.isObject() && prepareStackTrace.isCallable()) {
                    globalObject->isInsideErrorPrepareStackTraceCallback = true;
                    auto result = computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, frames, line, column, sourceURL, errorInstance, prepareStackTrace.getObject());
                    globalObject->isInsideErrorPrepareStackTraceCallback = false;
                    RELEASE_AND_RETURN(scope, result);
                }
            }
        }
    } else if (consultFormatter && !globalObject->isInsideErrorPrepareStackTraceCallback) {
        if (JSValue prepareStackTrace = globalObject->m_errorConstructorPrepareStackTraceValue.get()) {
            if (prepareStackTrace) {
                if (prepareStackTrace.isCallable()) {
                    globalObject->isInsideErrorPrepareStackTraceCallback = true;
                    auto result = computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, frames, line, column, sourceURL, errorInstance, prepareStackTrace.getObject());
                    globalObject->isInsideErrorPrepareStackTraceCallback = false;
                    RELEASE_AND_RETURN(scope, result);
                }
            }
        }
    }

    String result = computeErrorInfoWithoutPrepareStackTrace(vm, globalObject, lexicalGlobalObject, frames, line, column, sourceURL, errorInstance);
    RETURN_IF_EXCEPTION(scope, {});
    return jsString(vm, result);
}

static JSValue computeErrorInfoToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance)
{
    return computeErrorInfoToJSValueWithoutSkipping(vm, { .captured = &stackTrace }, line, column, sourceURL, errorInstance, true);
}

std::unique_ptr<JSC::DetachedStackTrace> detachStackTrace(JSC::VM& vm, Vector<StackFrame>& stackTrace)
{
    // ErrorInstance::reconcileWeakReferencesAtGCEnd calls this from Heap::pruneDeadReferences, which nulls
    // the current thread's atom string table and runs on whichever thread conducts the GC.
    // Releasing the last ref of an atom string there crashes in AtomStringImpl::remove(),
    // so install the VM's table for the duration; the mutator is suspended for the whole
    // end phase, so this is race-free (same as JSLock::didAcquireLock).
    // https://github.com/oven-sh/bun/issues/17087
    auto& thread = WTF::Thread::currentSingleton();
    WTF::AtomStringTable* previousAtomStringTable = thread.atomStringTable();
    bool needsVMAtomStringTable = previousAtomStringTable != vm.atomStringTable();
    if (needsVMAtomStringTable) [[unlikely]]
        thread.setCurrentAtomStringTable(vm.atomStringTable());
    auto restoreAtomStringTable = WTF::makeScopeExit([&] {
        if (needsVMAtomStringTable)
            thread.setCurrentAtomStringTable(previousAtomStringTable);
    });

    // A termination thrown in here would survive the clear below and be lost to the restore.
    JSC::DeferTerminationForAWhile deferTermination(vm);
    // Runs from the GC end phase while the mutator may have its own pending exception.
    JSC::SuspendExceptionScope suspendExceptionScope(vm);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto detached = makeUnique<Zig::DetachedFrames>(vm, stackTrace);
    // The onDetachStackTrace hook cannot propagate a throw.
    (void)scope.tryClearException();
    return detached;
}

void computeLineColumnWithSourcemap(JSC::VM& vm, JSC::SourceProvider* _Nonnull sourceProvider, JSC::LineColumn& lineColumn, WTF::String& remappedSourceURL)
{
    auto sourceURL = sourceProvider->sourceURL();
    if (sourceURL.isEmpty()) {
        return;
    }

    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(lineColumn.line);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(lineColumn.column);

    OwnedZigStackFrames frames(1);
    ZigStackFrame& frame = frames[0];
    frame.position.line_zero_based = line.zeroBasedInt();
    frame.position.column_zero_based = column.zeroBasedInt();
    frame.source_url = Bun::toStringRef(sourceURL);

    frames.remap(Bun::vm(vm));

    if (frame.remapped) {
        lineColumn.line = frame.position.line().oneBasedInt();
        lineColumn.column = frame.position.column().oneBasedInt();
        remappedSourceURL = frame.source_url.toWTFString();
    }
}

// ErrorInstance holds a frame's callee and code block weakly. Root them while user JS can run.
static void protectFrameCells(JSC::MarkedArgumentBuffer& cells, const Vector<StackFrame>& stackTrace)
{
    cells.ensureCapacity(stackTrace.size() * 2);
    for (auto& frame : stackTrace) {
        if (auto* callee = frame.callee())
            cells.append(callee);
        if (auto* codeBlock = frame.codeBlock())
            cells.append(codeBlock);
    }
}

static JSC::JSValue computeErrorInfoForHook(JSC::VM& vm, ErrorFrames frames, unsigned int& line_in, unsigned int& column_in, String& sourceURL, JSObject* errorInstance, bool consultFormatter)
{
    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(line_in);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(column_in);

    JSValue result = computeErrorInfoToJSValueWithoutSkipping(vm, frames, line, column, sourceURL, errorInstance, consultFormatter);

    line_in = line.oneBasedInt();
    column_in = column.oneBasedInt();

    // materializeErrorInfoIfNeeded putDirect()s this unconditionally; an empty JSValue
    // in property storage crashes the next read. https://github.com/oven-sh/bun/issues/34095
    if (!result) [[unlikely]]
        return jsUndefined();
    return result;
}

JSC::JSValue computeErrorInfoWrapperToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, String& sourceURL, JSObject* errorInstance)
{
    // stackTrace stays installed on errorInstance: a GC that finds one of its frames dead frees it mid-format.
    JSC::MarkedArgumentBuffer protectedFrameCells;
    protectFrameCells(protectedFrameCells, stackTrace);
    if (protectedFrameCells.hasOverflowed()) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwOutOfMemoryError(errorInstance->globalObject(), scope);
        return jsUndefined();
    }

    return computeErrorInfoForHook(vm, { .captured = &stackTrace }, line_in, column_in, sourceURL, errorInstance, true);
}

JSC::JSValue computeDetachedErrorInfoWrapperToJSValue(JSC::VM& vm, JSC::DetachedStackTrace& detachedStackTrace, unsigned int& line_in, unsigned int& column_in, String& sourceURL, JSObject* errorInstance, JSC::DetachedStackTraceUse use)
{
    auto& detached = static_cast<Zig::DetachedFrames&>(detachedStackTrace);
    return computeErrorInfoForHook(vm, { .detached = &detached }, line_in, column_in, sourceURL, errorInstance, use == JSC::DetachedStackTraceUse::Read);
}

WTF::String formatDetachedStackFrames(JSC::VM& vm, JSC::ErrorInstance* error, OrdinalNumber& line, OrdinalNumber& column, WTF::String& sourceURL)
{
    auto& detached = static_cast<Zig::DetachedFrames&>(*error->detachedStackTrace());
    JSC::JSGlobalObject* lexicalGlobalObject = error->globalObject();
    auto* globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    if (!globalObject)
        globalObject = defaultGlobalObject(vm);
    return formatStackFrames(vm, globalObject, lexicalGlobalObject, emptyString(), emptyString(), line, column, sourceURL, detached.frames(), detached.topFrameSourceURL(), nullptr);
}

JSC_DEFINE_HOST_FUNCTION(errorConstructorFuncAppendStackTrace, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::ErrorInstance* source = dynamicDowncast<JSC::ErrorInstance>(callFrame->argument(0));
    JSC::ErrorInstance* destination = dynamicDowncast<JSC::ErrorInstance>(callFrame->argument(1));

    if (!source || !destination) {
        throwTypeError(lexicalGlobalObject, scope, "First & second argument must be an Error object"_s);
        return {};
    }

    // A destination that is materialized, or is being formatted right now, never renders frames again.
    if (destination->hasMaterializedErrorInfo()) {
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
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto errorObject = dynamicDowncast<JSC::ErrorInstance>(callFrame->argument(0));
    auto callSites = dynamicDowncast<JSC::JSArray>(callFrame->argument(1));
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
    auto* errorObject = dynamicDowncast<ErrorInstance>(JSValue::decode(thisValue));

    // This shouldn't be possible.
    if (!errorObject) {
        return JSValue::encode(jsUndefined());
    }

    OrdinalNumber line;
    OrdinalNumber column;
    String sourceURL;
    auto stackTrace = errorObject->stackTrace();

    JSValue result;
    if (stackTrace == nullptr) {
        WTF::Vector<JSC::StackFrame> emptyTrace;
        result = computeErrorInfoToJSValue(vm, emptyTrace, line, column, sourceURL, errorObject);
    } else {
        // Re-entered from materializeErrorInfoIfNeeded's formatter, which still reads *stackTrace: copy, do not move.
        bool isBeingMaterialized = errorObject->hasMaterializedErrorInfo();
        auto ownedStackTrace = isBeingMaterialized
            ? makeUnique<WTF::Vector<JSC::StackFrame>>(*stackTrace)
            : makeUnique<WTF::Vector<JSC::StackFrame>>(WTF::move(*stackTrace));
        JSC::MarkedArgumentBuffer protectedFrameCells;
        protectFrameCells(protectedFrameCells, *ownedStackTrace);
        if (protectedFrameCells.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        result = computeErrorInfoToJSValue(vm, *ownedStackTrace, line, column, sourceURL, errorObject);
        if (!isBeingMaterialized)
            errorObject->setStackFrames(vm, {});
    }
    RETURN_IF_EXCEPTION(scope, {});
    errorObject->putDirect(vm, vm.propertyNames->stack, result, JSC::PropertyAttribute::DontEnum | 0);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_SETTER(errorInstanceLazyStackCustomSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    JSValue decodedValue = JSValue::decode(thisValue);
    if (auto* object = decodedValue.getObject()) {
        object->putDirect(vm, vm.propertyNames->stack, JSValue::decode(value), JSC::PropertyAttribute::DontEnum | 0);
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

    size_t stackTraceLimit = globalObject->stackTraceLimit().value_or(DEFAULT_ERROR_STACK_TRACE_LIMIT);
    if (stackTraceLimit == 0) {
        stackTraceLimit = DEFAULT_ERROR_STACK_TRACE_LIMIT;
    }

    WTF::Vector<JSC::StackFrame> stackTrace;
    JSCStackTrace::getFramesForCaller(vm, callFrame, errorObject, caller, stackTrace, stackTraceLimit);
    RETURN_IF_EXCEPTION(scope, {});

    if (auto* instance = dynamicDowncast<JSC::ErrorInstance>(errorObject)) {
        if (instance->hasMaterializedErrorInfo()) {
            // Error info was already materialized (e.g. .stack was previously accessed).
            // Don't call setStackFrames — it would leave m_errorInfoMaterialized=true with
            // a non-null m_stackTrace, causing ASSERT(!m_errorInfoMaterialized) in
            // computeErrorInfo when GC's finalizeUnconditionally finds unmarked frames.
            // Eagerly compute and set the .stack property instead.
            OrdinalNumber line;
            OrdinalNumber column;
            String sourceURL;
            JSValue result = computeErrorInfoToJSValue(vm, stackTrace, line, column, sourceURL, errorObject);
            RETURN_IF_EXCEPTION(scope, {});
            errorObject->putDirect(vm, vm.propertyNames->stack, result, JSC::PropertyAttribute::DontEnum | 0);
        } else {
            // Not yet materialized — safe to install new frames with a lazy getter.
            instance->setStackFrames(vm, WTF::move(stackTrace));

            {
                const auto& propertyName = vm.propertyNames->stack;
                VM::DeletePropertyModeScope deleteScope(vm, VM::DeletePropertyMode::IgnoreConfigurable);
                DeletePropertySlot slot;
                JSObject::deleteProperty(instance, globalObject, propertyName, slot);
            }
            RETURN_IF_EXCEPTION(scope, {});

            instance->putDirectCustomAccessor(vm, vm.propertyNames->stack, globalObject->m_lazyStackCustomGetterSetter.get(globalObject), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::CustomAccessor | 0);
        }
    } else {
        OrdinalNumber line;
        OrdinalNumber column;
        String sourceURL;
        JSValue result = computeErrorInfoToJSValue(vm, stackTrace, line, column, sourceURL, errorObject);
        RETURN_IF_EXCEPTION(scope, {});
        errorObject->putDirect(vm, vm.propertyNames->stack, result, JSC::PropertyAttribute::DontEnum | 0);
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

} // namespace Bun
