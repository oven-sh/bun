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
#include "ErrorStackFrame.h"
#include "ErrorStackTrace.h"
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

static JSC::JSGlobalObject* globalObjectForFrame(const JSC::StackFrame& frame, JSC::JSGlobalObject* lexicalGlobalObject)
{
    if (frame.hasLineAndColumnInfo()) {
        if (auto* callee = frame.callee()) {
            if (auto* object = callee->getObject())
                return object->globalObject();
        }
    }
    return lexicalGlobalObject;
}

// A node:vm frame of another realm keeps its position (https://github.com/oven-sh/bun/issues/17698).
// The collector formats with no lexicalGlobalObject, and every frame is Bun's.
static bool isSourceMappable(const JSC::StackFrame& frame, const ZigStackFrame& record, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject)
{
    if (!record.hasPosition() || record.source_url.isEmpty())
        return false;
    return !lexicalGlobalObject || globalObjectForFrame(frame, lexicalGlobalObject) == globalObject;
}

// The frames of one stack, described once for whichever way they are then rendered.
struct DescribedStackFrames {
    explicit DescribedStackFrames(size_t count)
        : records(count)
    {
    }

    OwnedZigStackFrames records;
    // A parser SyntaxError has no frame at the parse site: a `<parse>` line stands in for one.
    WTF::String parseFrame;
};

// A parser SyntaxError's `<parse>` line, which also gives the error its line. Empty when it has a frame at the parse site.
static WTF::String syntaxErrorParseFrame(JSC::VM& vm, Zig::GlobalObject* globalObject, Vector<JSC::StackFrame>& stackTrace, JSC::JSObject* errorInstance, OrdinalNumber& line, bool& hasSetLine)
{
    JSC::ErrorInstance* err = dynamicDowncast<JSC::ErrorInstance>(errorInstance);
    if (!err || err->errorType() != ErrorType::SyntaxError)
        return {};
    if (!stackTrace.isEmpty() && stackTrace.at(0).sourceURL(vm) == err->sourceURL())
        return {};

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
        remappedFrame.source_url = Bun::toStringRef(sourceURLForFrame);
        remappedFrames.remap(clientData(vm)->bunVM);
    }

    if (remappedFrame.remapped) {
        errorInstance->putDirect(vm, builtinNames(vm).originalLinePublicName(), jsNumber(originalLine.oneBasedInt()), PropertyAttribute::DontEnum | 0);
        hasSetLine = true;
        line = remappedFrame.position.line();
    }

    WTF::StringBuilder sb { WTF::OverflowPolicy::RecordOverflow };
    sb.append("<parse> ("_s);
    sb.append(remappedFrame.source_url.toWTFString());
    sb.append(':');
    sb.append(remappedFrame.remapped ? remappedFrame.position.line().oneBasedInt() : originalLine.oneBasedInt());
    sb.append(')');
    if (sb.hasOverflowed()) [[unlikely]]
        return {};
    return sb.toString();
}

// Describes every frame, source-maps them in one batch, and gives the error its own position: that of the
// first frame that has one (error.line, error.column, error.sourceURL), or of a parser SyntaxError's parse
// site. error.originalLine and error.originalColumn keep the first frame's position before the source map,
// so the error printer maps it once.
static void describeStackFrames(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<JSC::StackFrame>& stackTrace, JSC::JSObject* errorInstance, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, DescribedStackFrames& described)
{
    OwnedZigStackFrames& records = described.records;
    size_t framesCount = stackTrace.size();
    size_t first = WTF::notFound;
    ZigStackFramePosition positionBeforeMap { -1, -1, -1 };
    bool anyRemap = false;
    for (size_t i = 0; i < framesCount; i++) {
        const JSC::StackFrame& frame = stackTrace.at(i);
        ZigStackFrame& record = records[i];
        populateStackFrame(vm, frame, record);
        if (!record.hasPosition())
            continue;
        if (first == WTF::notFound) {
            first = i;
            positionBeforeMap = record.position;
        }
        if (isSourceMappable(frame, record, globalObject, lexicalGlobalObject))
            anyRemap = true;
        else
            // The remap leaves a frame that is marked as mapped as it is.
            record.remapped = true;
    }

    if (anyRemap)
        records.remap(clientData(vm)->bunVM);

    bool hasSetLine = false;
    described.parseFrame = syntaxErrorParseFrame(vm, globalObject, stackTrace, errorInstance, line, hasSetLine);
    if (hasSetLine || first == WTF::notFound)
        return;

    ZigStackFrame& record = records[first];
    line = record.position.line();
    column = record.position.column();
    sourceURL = record.source_url.toWTFString(BunString::ZeroCopy);
    if (errorInstance && record.remapped && isSourceMappable(stackTrace.at(first), record, globalObject, lexicalGlobalObject)) {
        errorInstance->putDirect(vm, builtinNames(vm).originalLinePublicName(), jsNumber(positionBeforeMap.line().oneBasedInt()), PropertyAttribute::DontEnum | 0);
        errorInstance->putDirect(vm, builtinNames(vm).originalColumnPublicName(), jsNumber(positionBeforeMap.column().oneBasedInt()), PropertyAttribute::DontEnum | 0);
    }
}

static WTF::String formatStackTraceWithRecords(const WTF::String& name, const WTF::String& message, const DescribedStackFrames& described, size_t framesCount)
{
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

    // There is always a newline before each frame, so the name and message are the first line even when both are empty.
    if (!described.parseFrame.isEmpty()) {
        sb.append("\n    at "_s);
        sb.append(described.parseFrame);
    }

    for (size_t i = 0; i < framesCount; i++) {
        sb.append("\n    at "_s);
        appendStackFrame(sb, described.records[i]);
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
    DescribedStackFrames described(stackTrace.size());
    describeStackFrames(vm, globalObject, lexicalGlobalObject, stackTrace, errorInstance, line, column, sourceURL, described);
    return formatStackTraceWithRecords(name, message, described, stackTrace.size());
}

// error.stack calls this function
static String computeErrorInfoWithoutPrepareStackTrace(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, Vector<StackFrame>& stackTrace, const DescribedStackFrames& described, JSObject* errorInstance)
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

    return formatStackTraceWithRecords(name, message, described, stackTrace.size());
}

static JSValue computeErrorInfoWithPrepareStackTrace(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<StackFrame>& stackTrace, OwnedZigStackFrames& records, JSObject* errorObject, JSObject* prepareStackTrace)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Note: we cannot use tryCreateUninitializedRestricted here because we cannot allocate memory inside initializeIndex()
    MarkedArgumentBuffer callSites;
    Zig::createCallSitesFromFrames(globalObject, lexicalGlobalObject, stackTrace, records, callSites);
    RETURN_IF_EXCEPTION(scope, {});

    JSArray* callSitesArray = JSC::constructArray(globalObject, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), callSites);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, formatStackTraceToJSValue(vm, globalObject, lexicalGlobalObject, errorObject, callSitesArray, prepareStackTrace));
}

static JSValue computeErrorInfoToJSValueWithoutSkipping(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance)
{

    Zig::GlobalObject* globalObject = nullptr;
    JSC::JSGlobalObject* lexicalGlobalObject = nullptr;
    lexicalGlobalObject = errorInstance->globalObject();
    globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Error.prepareStackTrace - https://v8.dev/docs/stack-trace-api#customizing-stack-traces
    JSObject* prepareStackTrace = nullptr;
    if (!globalObject) {
        // node:vm will use a different JSGlobalObject
        globalObject = defaultGlobalObject(vm);
        if (!globalObject->isInsideErrorPrepareStackTraceCallback) {
            auto* errorConstructor = lexicalGlobalObject->m_errorStructure.constructor(lexicalGlobalObject);
            auto prepareStackTraceValue = errorConstructor->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "prepareStackTrace"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (prepareStackTraceValue && prepareStackTraceValue.isCell() && prepareStackTraceValue.isObject() && prepareStackTraceValue.isCallable())
                prepareStackTrace = prepareStackTraceValue.getObject();
        }
    } else if (!globalObject->isInsideErrorPrepareStackTraceCallback) {
        if (JSValue prepareStackTraceValue = globalObject->m_errorConstructorPrepareStackTraceValue.get()) {
            if (prepareStackTraceValue.isCallable())
                prepareStackTrace = prepareStackTraceValue.getObject();
        }
    }

    DescribedStackFrames described(stackTrace.size());
    describeStackFrames(vm, globalObject, lexicalGlobalObject, stackTrace, errorInstance, line, column, sourceURL, described);

    if (prepareStackTrace) {
        globalObject->isInsideErrorPrepareStackTraceCallback = true;
        auto result = computeErrorInfoWithPrepareStackTrace(vm, globalObject, lexicalGlobalObject, stackTrace, described.records, errorInstance, prepareStackTrace);
        globalObject->isInsideErrorPrepareStackTraceCallback = false;
        RELEASE_AND_RETURN(scope, result);
    }

    String result = computeErrorInfoWithoutPrepareStackTrace(vm, lexicalGlobalObject, stackTrace, described, errorInstance);
    RETURN_IF_EXCEPTION(scope, {});
    return jsString(vm, result);
}

static JSValue computeErrorInfoToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, OrdinalNumber& line, OrdinalNumber& column, String& sourceURL, JSObject* errorInstance)
{
    return computeErrorInfoToJSValueWithoutSkipping(vm, stackTrace, line, column, sourceURL, errorInstance);
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

JSC::JSValue computeErrorInfoWrapperToJSValue(JSC::VM& vm, Vector<StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, String& sourceURL, JSObject* errorInstance)
{
    OrdinalNumber line = OrdinalNumber::fromOneBasedInt(line_in);
    OrdinalNumber column = OrdinalNumber::fromOneBasedInt(column_in);

    // stackTrace stays installed on errorInstance: a GC that finds one of its frames dead frees it mid-format.
    JSC::MarkedArgumentBuffer protectedFrameCells;
    protectFrameCells(protectedFrameCells, stackTrace);
    if (protectedFrameCells.hasOverflowed()) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwOutOfMemoryError(errorInstance->globalObject(), scope);
        return jsUndefined();
    }

    JSValue result = computeErrorInfoToJSValue(vm, stackTrace, line, column, sourceURL, errorInstance);

    line_in = line.oneBasedInt();
    column_in = column.oneBasedInt();

    // materializeErrorInfoIfNeeded putDirect()s this unconditionally; an empty JSValue
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

namespace Zig {

void createCallSitesFromFrames(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, Vector<JSC::StackFrame>& stackTrace, Bun::OwnedZigStackFrames& records, MarkedArgumentBuffer& callSites)
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
        // A debug build shows frames of private implementation visibility. V8 has no such frame.
        if (Zig::isImplementationVisibilityPrivate(stackTrace.at(i)))
            continue;
        CallSite* callSite = CallSite::create(lexicalGlobalObject, callSiteStructure, stackTrace.at(i), records[i], encounteredStrictFrame);

        if (!encounteredStrictFrame) {
            encounteredStrictFrame = callSite->isStrict();
        }

        callSites.append(callSite);
    }
}

} // namespace Zig
