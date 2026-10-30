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
#include "ObjectBindings.h"
#include "headers-handwritten.h"

#include <wtf/Scope.h>
#include <wtf/Threading.h>

using namespace JSC;
using namespace WebCore;

namespace Bun {

// What `.stack` is when the frames do not fit in one string. It cannot throw: `formatStackTrace` also runs in a GC finalizer.
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

    // JavaScriptCore composes this error's stack: the callback gets the default text from the accessor of `stack`, only if it reads it.
    auto* composedError = dynamicDowncast<JSC::ErrorInstance>(errorObject);
    if (composedError && !composedError->isComposingStack())
        composedError = nullptr;

    JSValue stackStringValue;
    if (!callsPrepareStackTrace || !composedError) {
        stackStringValue = formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSites, callsPrepareStackTrace ? HeaderThrow::Describe : HeaderThrow::Propagate);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (callsPrepareStackTrace) {
        if (!composedError) {
            // In Node, if you console.log(error.stack) inside Error.prepareStackTrace
            // it will display the stack as a formatted string, so we have to do the same.
            putDirectOrThrow(lexicalGlobalObject, errorObject, vm.propertyNames->stack, stackStringValue, JSC::PropertyAttribute::DontEnum | 0);
            RETURN_IF_EXCEPTION(scope, {});
        }

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

// What a call of formatStackTrace() is for.
enum class StackTraceFor : uint8_t {
    // The text, and the position of the error: `line`, `column`, `sourceURL` and its own `originalLine` and `originalColumn`.
    TextAndPosition,
    // The position. No frame behind the first that has one is formatted, and the caller drops the text.
    Position,
    // The text. The error has its position, and what was made of those properties since stays: Object.freeze().
    Text,
};

static WTF::String formatStackTrace(
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    const WTF::String& name,
    const WTF::String& message,
    OrdinalNumber& line,
    OrdinalNumber& column,
    WTF::String& sourceURL,
    Vector<JSC::StackFrame>& stackTrace,
    JSC::JSObject* errorInstance,
    StackTraceFor purpose)
{
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
        if (JSC::ErrorInstance* err = dynamicDowncast<JSC::ErrorInstance>(errorInstance)) {
            if (err->errorType() == ErrorType::SyntaxError && (stackTrace.isEmpty() || stackTrace.at(0).sourceURL(vm) != err->sourceURL())) {
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
                        remappedFrames.remap(getBunVM());

                        sourceURLForFrame = remappedFrame.source_url.toWTFString();
                    }
                }

                // there is always a newline before each stack frame line, ensuring that the name + message
                // exist on the first line, even if both are empty
                sb.append("\n"_s);

                sb.append("    at <parse> ("_s);

                sb.append(remappedFrame.source_url.toWTFString());

                if (remappedFrame.remapped) {
                    if (purpose != StackTraceFor::Text)
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
        if (sb.hasOverflowed()) [[unlikely]]
            return stackTraceHeaderOnly(name, message);
        return sb.toString();
    }

    if (purpose == StackTraceFor::Position) {
        size_t first = 0;
        while (first < framesCount - 1 && !stackTrace.at(first).hasLineAndColumnInfo())
            first++;
        framesCount = first + 1;
    }

    sb.append("\n"_s);

    // Pass 1: collect (line, col, source_url) for frames that should be
    // source-mapped, then batch the remap so the Rust side can resolve each
    // file's map once instead of per frame.
    OwnedZigStackFrames remappedFrames(framesCount);
    WTF::Vector<WTF::String, 8> sourceURLs;
    WTF::Vector<LineColumn, 8> originalLineColumns;
    sourceURLs.grow(framesCount);
    originalLineColumns.grow(framesCount);
    bool anyRemap = false;
#if ENABLE(AOT)
    JSC::AOT::Typed::ModuleID previousCompiledModule;
    size_t previousCompiledFrame = 0;
#endif

    for (size_t i = 0; i < framesCount; i++) {
        StackFrame& frame = stackTrace.at(i);
        ZigStackFrame& remappedFrame = remappedFrames[i];
        // Match `ZigStackFramePosition::INVALID` exactly so the Rust batch loop's
        // `position.isInvalid()` skips frames we never populate (vm-context
        // frames, frames without line/col info). A zero-initialized frame has
        // `line_start_byte = 0` which fails that byte-compare.
        remappedFrame.position.line_zero_based = -1;
        remappedFrame.position.column_zero_based = -1;
        remappedFrame.position.byte_position = -1;
        originalLineColumns[i] = {};

        if (!frame.hasLineAndColumnInfo()) continue;

#if ENABLE(AOT)
        if (frame.isCompiledFrame()) [[unlikely]] {
            if (auto position = frame.compiledPosition()) {
                originalLineColumns[i] = position->lineColumn;
                if (position->source) {
                    sourceURLs[i] = position->source == previousCompiledModule ? sourceURLs[previousCompiledFrame] : JSC::AOT::sourceURLOf(position->source);
                    previousCompiledModule = position->source;
                    previousCompiledFrame = i;
                } else
                    sourceURLs[i] = Zig::sourceURL(*position);
            }
            continue;
        }
#endif

        originalLineColumns[i] = frame.computeLineAndColumn();

        JSC::JSGlobalObject* globalObjectForFrame = lexicalGlobalObject;
        if (auto* callee = frame.callee()) {
            if (auto* object = callee->getObject()) {
                globalObjectForFrame = object->globalObject();
            }
        }

        sourceURLs[i] = Zig::sourceURL(vm, frame);

        bool isDefinitelyNotRunninginNodeVMGlobalObject = globalObject == globalObjectForFrame;
        bool isDefaultGlobalObjectInAFinalizer = (globalObject && !lexicalGlobalObject && !errorInstance);
        if (isDefinitelyNotRunninginNodeVMGlobalObject || isDefaultGlobalObjectInAFinalizer) {
            // https://github.com/oven-sh/bun/issues/3595
            if (!sourceURLs[i].isEmpty()) {
                remappedFrame.position.line_zero_based = OrdinalNumber::fromOneBasedInt(originalLineColumns[i].line).zeroBasedInt();
                remappedFrame.position.column_zero_based = OrdinalNumber::fromOneBasedInt(originalLineColumns[i].column).zeroBasedInt();
                remappedFrame.source_url = Bun::toStringRef(sourceURLs[i]);
                anyRemap = true;
            }
        }
    }

    if (anyRemap) {
        remappedFrames.remap(getBunVM());
    }

    // Pass 2: format. Everything except (display line/col, source_url) is
    // re-derived from `frame`; only the remap output is read from pass 1.
    for (size_t i = 0; i < framesCount; i++) {
        StackFrame& frame = stackTrace.at(i);
        ZigStackFrame& remappedFrame = remappedFrames[i];
        unsigned int flags = static_cast<unsigned int>(FunctionNameFlags::AddNewKeyword);

        WTF::String functionName = Zig::functionName(vm, frame, &flags);
        OrdinalNumber originalLine = {};
        OrdinalNumber originalColumn = {};
        OrdinalNumber displayLine = {};
        OrdinalNumber displayColumn = {};
        WTF::String sourceURLForFrame = sourceURLs[i];

        if (frame.hasLineAndColumnInfo()) {
            originalLine = OrdinalNumber::fromOneBasedInt(originalLineColumns[i].line);
            originalColumn = OrdinalNumber::fromOneBasedInt(originalLineColumns[i].column);
            displayLine = originalLine;
            displayColumn = originalColumn;

            if (remappedFrame.remapped) {
                displayLine = remappedFrame.position.line();
                displayColumn = remappedFrame.position.column();
                sourceURLForFrame = remappedFrame.source_url.toWTFString();
            }

            if (!hasSet) {
                hasSet = true;
                line = displayLine;
                column = displayColumn;
                sourceURL = sourceURLForFrame;

                bool showsSourcePosition = remappedFrame.remapped;
#if ENABLE(AOT)
                showsSourcePosition |= frame.isCompiledFrame() && !frame.isBuiltinFunction() && !sourceURLForFrame.isEmpty();
#endif
                if (showsSourcePosition && purpose != StackTraceFor::Text) {
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
            if (frame.hasLineAndColumnInfo()) {
                sb.append(':');
                sb.append(displayLine.oneBasedInt());
                sb.append(':');
                sb.append(displayColumn.oneBasedInt());
            }
        }

        if (!functionName.isEmpty()) {
            sb.append(')');
        }

        if (i != framesCount - 1) {
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
    return formatStackTrace(vm, globalObject, lexicalGlobalObject, name, message, line, column, sourceURL, stackTrace, errorInstance, StackTraceFor::TextAndPosition);
}

// error.stack calls this function. `collectedFrames` is not null when a collection formatted the frames: `stackTrace` is empty then.
static String computeErrorInfoWithoutPrepareStackTrace(
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    Vector<StackFrame>& stackTrace,
    const String& collectedFrames,
    OrdinalNumber& line,
    OrdinalNumber& column,
    String& sourceURL,
    JSObject* errorInstance,
    StackTraceFor purpose)
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

    if (!collectedFrames.isNull()) {
        WTF::String header = stackTraceHeaderOnly(name, message);
        // The name and the message come from JS. Past `String::MaxLength` `makeString` calls `CRASH()`.
        WTF::String stack = tryMakeString(header, collectedFrames);
        return stack.isNull() ? header : stack;
    }

    RELEASE_AND_RETURN(scope, formatStackTrace(vm, globalObject, lexicalGlobalObject, name, message, line, column, sourceURL, stackTrace, errorInstance, purpose));
}

// One CallSite for each frame, with its position in the original source.
static JSArray* createCallSitesArray(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<StackFrame>& stackFrames)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSCStackTrace stackTrace = JSCStackTrace::fromExisting(vm, stackFrames);

    // Note: we cannot use tryCreateUninitializedRestricted here because we cannot allocate memory inside initializeIndex()
    MarkedArgumentBuffer callSites;

    // Create the call sites (one per frame)
    Zig::createCallSitesFromFrames(globalObject, lexicalGlobalObject, stackTrace, callSites);
    RETURN_IF_EXCEPTION(scope, {});

    // We need to sourcemap it if it's a GlobalObject.

    const int n = stackTrace.size();
    OwnedZigStackFrames remappedFrames(n);
    WTF::Vector<WTF::String, 8> sourceURLs;
    WTF::Vector<bool, 8> didRemap;
    sourceURLs.grow(n);
    didRemap.grow(n);
    bool anyRemap = false;

    for (int i = 0; i < n; i++) {
        ZigStackFrame& frame = remappedFrames[i];
        JSCStackFrame& visibleFrame = stackTrace.at(i);
        const JSC::StackFrame& stackFrame = visibleFrame.stackFrame();
        sourceURLs[i] = Zig::sourceURL(vm, stackFrame);
        didRemap[i] = false;
        frame.position.line_zero_based = -1;
        frame.position.column_zero_based = -1;
        frame.position.byte_position = -1;

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

        // A position recorded at build time is already the one in the original source.
        bool isOriginalPosition = Zig::hasOriginalSourcePosition(stackFrame);

        if (globalObjectForFrame == globalObject && !isOriginalPosition) {
            if (JSCStackFrame::SourcePositions* sourcePositions = visibleFrame.getSourcePositions()) {
                frame.position.line_zero_based = sourcePositions->line.zeroBasedInt();
                frame.position.column_zero_based = sourcePositions->column.zeroBasedInt();
            }

            if (!sourceURLs[i].isEmpty()) {
                frame.source_url = Bun::toStringRef(sourceURLs[i]);
                didRemap[i] = true;
                anyRemap = true;
            }
        }
    }

    if (anyRemap) {
        remappedFrames.remap(globalObject->bunVM());
    }

    for (int i = 0; i < n; i++) {
        ZigStackFrame& frame = remappedFrames[i];
        WTF::String sourceURLForFrame = didRemap[i] ? frame.source_url.toWTFString() : sourceURLs[i];

        auto* callsite = uncheckedDowncast<CallSite>(callSites.at(i));

        if (!sourceURLForFrame.isEmpty())
            callsite->setSourceURL(vm, jsString(vm, sourceURLForFrame));

        if (frame.remapped) {
            callsite->setLineNumber(frame.position.line());
            callsite->setColumnNumber(frame.position.column());
        }
    }

    RELEASE_AND_RETURN(scope, JSC::constructArray(globalObject, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), callSites));
}

static JSValue computeErrorInfoWithPrepareStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<StackFrame>& stackFrames, JSObject* errorObject, JSObject* prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSArray* callSitesArray = createCallSitesArray(vm, globalObject, lexicalGlobalObject, stackFrames);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSitesArray, prepareStackTrace));
}

// The callback is about to get the frames. If it throws, the next read calls it again, so no collection may format
// the frames in between: the error keeps them until its stack is composed.
static void retainFramesForCallback(JSC::VM& vm, JSObject* errorInstance)
{
    if (auto* error = dynamicDowncast<JSC::ErrorInstance>(errorInstance))
        error->retainStackFrames(vm);
}

static JSValue computeErrorInfoToJSValueWithoutSkipping(JSC::VM& vm, Vector<StackFrame>& stackTrace, const String& collectedFrames, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance, StackTraceFor purpose)
{

    Zig::GlobalObject* globalObject = nullptr;
    JSC::JSGlobalObject* lexicalGlobalObject = nullptr;
    lexicalGlobalObject = errorInstance->globalObject();
    globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Error.prepareStackTrace - https://v8.dev/docs/stack-trace-api#customizing-stack-traces
    if (!collectedFrames.isNull()) {
        // There is no frame left to make a call site from.
        if (!globalObject)
            globalObject = defaultGlobalObject(vm);
    } else if (!globalObject) {
        // node:vm will use a different JSGlobalObject
        globalObject = defaultGlobalObject(vm);
        if (!globalObject->isInsideErrorPrepareStackTraceCallback) {
            auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(lexicalGlobalObject);
            auto prepareStackTrace = errorConstructor->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "prepareStackTrace"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (prepareStackTrace) {
                if (prepareStackTrace.isCell() && prepareStackTrace.isObject() && prepareStackTrace.isCallable()) {
                    retainFramesForCallback(vm, errorInstance);
                    globalObject->isInsideErrorPrepareStackTraceCallback = true;
                    auto result = computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, errorInstance, prepareStackTrace.getObject());
                    globalObject->isInsideErrorPrepareStackTraceCallback = false;
                    RELEASE_AND_RETURN(scope, result);
                }
            }
        }
    } else if (!globalObject->isInsideErrorPrepareStackTraceCallback) {
        if (JSValue prepareStackTrace = globalObject->m_errorConstructorPrepareStackTraceValue.get()) {
            if (prepareStackTrace) {
                if (prepareStackTrace.isCallable()) {
                    retainFramesForCallback(vm, errorInstance);
                    globalObject->isInsideErrorPrepareStackTraceCallback = true;
                    auto result = computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, errorInstance, prepareStackTrace.getObject());
                    globalObject->isInsideErrorPrepareStackTraceCallback = false;
                    RELEASE_AND_RETURN(scope, result);
                }
            }
        }
    }

    String result = computeErrorInfoWithoutPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, collectedFrames, line, column, sourceURL, errorInstance, purpose);
    RETURN_IF_EXCEPTION(scope, {});
    return jsString(vm, result);
}

static JSValue computeErrorInfoToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance)
{
    return computeErrorInfoToJSValueWithoutSkipping(vm, stackTrace, String(), line, column, sourceURL, errorInstance, StackTraceFor::TextAndPosition);
}

WTF::String computeErrorInfoWrapperToString(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, String& sourceURL)
{

    // ErrorInstance::finalizeUnconditionally calls this from Heap::runEndPhase, which nulls
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

    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(line_in);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(column_in);

    // A termination thrown in here would survive the clear below and be lost to the restore.
    JSC::DeferTerminationForAWhile deferTermination(vm);
    // Runs from the GC end phase while the mutator may have its own pending exception.
    JSC::SuspendExceptionScope suspendExceptionScope(vm);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    // The frames only: JavaScriptCore prepends the error's name and message when the stack is read.
    WTF::String result = Bun::formatStackTrace(vm, defaultGlobalObject(vm), nullptr, emptyString(), emptyString(), line, column, sourceURL, stackTrace, nullptr);
    if (scope.exception()) {
        // The onComputeErrorInfo hook cannot propagate a throw.
        (void)scope.tryClearException();
        result = WTF::emptyString();
    }

    line_in = line.oneBasedInt();
    column_in = column.oneBasedInt();

    return result;
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

// Whether a read of the stack of an error of this realm calls Error.prepareStackTrace, which gets a CallSite of each frame.
// Asked where no JavaScript may run: an accessor in a node:vm realm counts as a callback.
static bool hasPrepareStackTraceCallback(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject)
{
    if (auto* globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject)) {
        JSValue prepareStackTrace = globalObject->m_errorConstructorPrepareStackTraceValue.get();
        return prepareStackTrace && prepareStackTrace.isCallable();
    }
    auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(lexicalGlobalObject);
    JSValue prepareStackTrace = errorConstructor->getDirect(vm, Identifier::fromString(vm, "prepareStackTrace"_s));
    return prepareStackTrace && (prepareStackTrace.isCallable() || prepareStackTrace.isGetterSetter() || prepareStackTrace.isCustomGetterSetter());
}

void keepStackFramesForPrepareStackTrace(JSC::VM& vm, JSC::ErrorInstance* error)
{
    if (hasPrepareStackTraceCallback(vm, error->globalObject()))
        error->retainStackFrames(vm);
}

JSC::JSValue computeErrorInfoWrapperToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, const String& collectedFrames, unsigned int& line_in, unsigned int& column_in, String& sourceURL, JSObject* errorInstance, JSC::ErrorInfoRequest request)
{
    if (request == JSC::ErrorInfoRequest::Use) {
        if (auto* error = dynamicDowncast<JSC::ErrorInstance>(errorInstance))
            keepStackFramesForPrepareStackTrace(vm, error);
        return {};
    }

    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(line_in);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(column_in);

    if (request == JSC::ErrorInfoRequest::Position) {
        // Not a read of `stack`, so no JavaScript may run: the accessor stands for `stack` and composes it when it is read.
        JSC::JSGlobalObject* lexicalGlobalObject = errorInstance->globalObject();
        Zig::GlobalObject* globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);
        if (!globalObject)
            globalObject = defaultGlobalObject(vm);
        if (!stackTrace.isEmpty()) {
            formatStackTrace(vm, globalObject, lexicalGlobalObject, emptyString(), emptyString(), line, column, sourceURL, stackTrace, errorInstance, StackTraceFor::Position);
            line_in = line.oneBasedInt();
            column_in = column.oneBasedInt();
            if (auto* error = dynamicDowncast<JSC::ErrorInstance>(errorInstance))
                keepStackFramesForPrepareStackTrace(vm, error);
        }
        return globalObject->m_lazyStackCustomGetterSetter.get(globalObject);
    }

    // stackTrace stays installed on errorInstance: a GC that finds one of its frames dead frees it mid-format.
    JSC::MarkedArgumentBuffer protectedFrameCells;
    protectFrameCells(protectedFrameCells, stackTrace);
    if (protectedFrameCells.hasOverflowed()) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwOutOfMemoryError(errorInstance->globalObject(), scope);
        return jsUndefined();
    }

    // An error that was asked for its position before has it, and JavaScriptCore takes none from this call.
    auto* error = dynamicDowncast<JSC::ErrorInstance>(errorInstance);
    StackTraceFor purpose = error && error->hasMaterializedErrorInfo() ? StackTraceFor::Text : StackTraceFor::TextAndPosition;
    JSValue result = computeErrorInfoToJSValueWithoutSkipping(vm, stackTrace, collectedFrames, line, column, sourceURL, errorInstance, purpose);

    line_in = line.oneBasedInt();
    column_in = column.oneBasedInt();

    // ErrorInstance::composeStack() stores this as the value of `stack`; an empty JSValue
    // in property storage crashes the next read. https://github.com/oven-sh/bun/issues/34095
    if (!result) [[unlikely]]
        return jsUndefined();
    return result;
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

    // appendVector() can't append a vector to itself, and the clear() below would drop the trace.
    if (source == destination) {
        return JSC::JSValue::encode(jsUndefined());
    }

    // A destination that is materialized, or is being formatted right now, never renders frames again.
    if (destination->hasMaterializedErrorInfo() || destination->isComposingStack()) {
        return JSC::JSValue::encode(jsUndefined());
    }

    if (!destination->stackTrace()) {
        destination->captureStackTrace(vm, globalObject, 1);
    }

    if (auto* sourceFrames = source->stackTrace()) {
        // A collector thread can be reading the frames of an error that keeps them alive (retainStackFrames()): each
        // error gets new frames, and none is changed in place.
        WTF::Vector<JSC::StackFrame> frames;
        if (auto* destinationFrames = destination->stackTrace())
            frames.appendVector(*destinationFrames);
        frames.appendVector(*sourceFrames);
        destination->setStackFrames(vm, WTF::move(frames));
        keepStackFramesForPrepareStackTrace(vm, destination);
        source->setStackFrames(vm, {});
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

// What `error.stack` is when the Error.prepareStackTrace callback that composes it reads it: the default text.
static JSValue defaultStackInsideCallback(JSC::VM& vm, JSC::ErrorInstance* errorObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSGlobalObject* lexicalGlobalObject = errorObject->globalObject();
    Zig::GlobalObject* globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    if (!globalObject)
        globalObject = defaultGlobalObject(vm);

    // The callback's caller keeps the frames alive.
    WTF::Vector<JSC::StackFrame> noFrames;
    auto* stackTrace = errorObject->stackTrace();
    JSArray* callSites = createCallSitesArray(vm, globalObject, lexicalGlobalObject, stackTrace ? *stackTrace : noFrames);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSites, HeaderThrow::Describe));
}

// The error whose stack a read of `stack` on the receiver is a read of: the receiver, or as in V8 the nearest error that it
// inherits from. A lookup that is no [[Get]] (JSObject::getIfPropertyExists()) finds the accessor there and calls the getter.
static ErrorInstance* errorOfStackReceiver(JSValue receiver)
{
    for (JSObject* object = receiver.getObject(); object; object = object->getPrototypeDirect().getObject()) {
        if (auto* error = dynamicDowncast<ErrorInstance>(object))
            return error;
    }
    return nullptr;
}

JSC_DEFINE_CUSTOM_GETTER(errorInstanceLazyStackCustomGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* errorObject = errorOfStackReceiver(JSValue::decode(thisValue));

    // The receiver is no error and inherits from none: a plain object, a Proxy.
    if (!errorObject) {
        return JSValue::encode(jsUndefined());
    }

    if (errorObject->isComposingStack()) [[unlikely]] {
        // As in V8, the callback reads the default text, and that stays the stack if the callback then throws.
        // A read from the name or the message getter that the text calls gets undefined.
        errorObject->setStack(vm, jsUndefined());
        JSValue result = defaultStackInsideCallback(vm, errorObject);
        RETURN_IF_EXCEPTION(scope, {});
        errorObject->setStack(vm, result);
        return JSValue::encode(result);
    }

    JSValue result = errorObject->composeStackForAccessor(vm);
    RETURN_IF_EXCEPTION(scope, {});
    if (!result) {
        // The getter was taken from one error and called on another, which has its stack.
        unsigned attributes;
        PropertyOffset offset = errorObject->structure()->get(vm, vm.propertyNames->stack, attributes);
        if (isValidOffset(offset) && !(attributes & JSC::PropertyAttribute::AccessorOrCustomAccessorOrValue))
            result = errorObject->getDirect(offset);
    }
    return JSValue::encode(result ? result : jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(errorInstanceLazyStackCustomSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue receiver = JSValue::decode(thisValue);
    if (auto* errorObject = dynamicDowncast<ErrorInstance>(receiver))
        return errorObject->setStack(vm, JSValue::decode(value));

    // The accessor was found on an error that the receiver inherits from, or Reflect.set() named the receiver. It gets the
    // value as an assignment that finds a writable value on that error gives it one, and refuses it as that refuses it.
    PutPropertySlot slot(receiver, false);
    RELEASE_AND_RETURN(scope, JSObject::definePropertyOnReceiver(globalObject, vm.propertyNames->stack, JSValue::decode(value), slot));
}

JSC_DEFINE_HOST_FUNCTION(errorConstructorFuncCaptureStackTrace, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue objectArg = callFrame->argument(0);
    // A WebAssembly GC object can't get a property and its Structure has no global object. V8 rejects it too.
    if (!objectArg.isObject() || objectArg.asCell()->type() == JSC::JSType::WebAssemblyGCObjectType) {
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
        // The stack of this error was read or assigned, or Error.prepareStackTrace composes it right now:
        // the new stack is composed here, and takes its place.
        if (instance->isComposingStack() || (instance->hasMaterializedErrorInfo() && !instance->hasStackToCompose())) {
            OrdinalNumber line;
            OrdinalNumber column;
            String sourceURL;
            JSValue result = computeErrorInfoToJSValue(vm, stackTrace, line, column, sourceURL, errorObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (instance->isComposingStack())
                instance->setStack(vm, result);
            else
                errorObject->putDirect(vm, vm.propertyNames->stack, result, JSC::PropertyAttribute::DontEnum | 0);
        } else {
            // The stack is still to be composed: from the new frames, by the accessor, when it is read.
            instance->setStackFrames(vm, WTF::move(stackTrace));
            // An untouched error holds its frames weakly, as a new one does. One that was used keeps them for the
            // callback of the program, as it does from its first use.
            if (instance->hasMaterializedErrorInfo())
                keepStackFramesForPrepareStackTrace(vm, instance);

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
        putDirectOrThrow(globalObject, errorObject, vm.propertyNames->stack, result, JSC::PropertyAttribute::DontEnum | 0);
        RETURN_IF_EXCEPTION(scope, {});
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
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool encounteredStrictFrame = false;

    // TODO: is it safe to use CallSite structure from a different JSGlobalObject? This case would happen within a node:vm
    JSC::Structure* callSiteStructure = globalObject->callSiteStructure();
    size_t framesCount = stackTrace.size();

    for (size_t i = 0; i < framesCount; i++) {
        CallSite* callSite = CallSite::create(lexicalGlobalObject, callSiteStructure, stackTrace.at(i), encounteredStrictFrame);
        RETURN_IF_EXCEPTION(scope, );

        if (!encounteredStrictFrame) {
            encounteredStrictFrame = callSite->isStrict();
        }

        callSites.append(callSite);
    }
}

} // namespace Zig
