/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "ErrorStackTrace.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/CodeType.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ExecutableBase.h"
#include "JavaScriptCore/JSType.h"
#include "wtf/text/OrdinalNumber.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/NativeCallee.h>
#include <JavaScriptCore/Interpreter.h>
#include <wtf/IterationStatus.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/FunctionCodeBlock.h>

#include "ErrorStackFrame.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

static ImplementationVisibility getImplementationVisibility(JSC::CodeBlock* codeBlock)
{

    if (auto* executable = codeBlock->ownerExecutable()) {
        return executable->implementationVisibility();
    }

    return ImplementationVisibility::Public;
}

bool isImplementationVisibilityPrivate(JSC::StackVisitor& visitor)
{
    ImplementationVisibility implementationVisibility = [&]() -> ImplementationVisibility {
        if (visitor->callee().isCell()) {
            if (auto* callee = visitor->callee().asCell()) {
                if (auto* jsFunction = dynamicDowncast<JSFunction>(callee)) {
                    if (auto* executable = jsFunction->executable())
                        return executable->implementationVisibility();
                }
            }
        }

        if (auto* codeBlock = visitor->codeBlock()) {
            return getImplementationVisibility(codeBlock);
        }

#if ENABLE(WEBASSEMBLY)
        if (visitor->isNativeCalleeFrame())
            return visitor->callee().asNativeCallee()->implementationVisibility();
#endif

        return ImplementationVisibility::Public;
    }();

    return implementationVisibility != ImplementationVisibility::Public;
}

bool isImplementationVisibilityPrivate(const JSC::StackFrame& frame)
{
    ImplementationVisibility implementationVisibility = [&]() -> ImplementationVisibility {

#if ENABLE(WEBASSEMBLY)
        if (frame.isWasmFrame())
            return ImplementationVisibility::Public;
#endif

        if (auto* callee = frame.callee()) {
            if (auto* jsFunction = dynamicDowncast<JSFunction>(callee)) {
                if (auto* executable = jsFunction->executable())
                    return executable->implementationVisibility();
            }
        }

        if (auto* codeBlock = frame.codeBlock()) {
            return getImplementationVisibility(codeBlock);
        }

        return ImplementationVisibility::Public;
    }();

    return implementationVisibility != ImplementationVisibility::Public;
}

JSCStackTrace JSCStackTrace::fromExisting(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& existingFrames)
{
    WTF::Vector<JSCStackFrame> newFrames;

    size_t frameCount = existingFrames.size();
    if (0 == frameCount) {
        return JSCStackTrace();
    }

    newFrames.reserveInitialCapacity(frameCount);
    for (size_t i = 0; i < frameCount; i++) {
        if (!isImplementationVisibilityPrivate(existingFrames.at(i))) {
            newFrames.constructAndAppend(vm, existingFrames.at(i));
        }
    }

    return JSCStackTrace(newFrames);
}

void JSCStackTrace::getFramesForCaller(JSC::VM& vm, JSC::CallFrame* callFrame, JSC::JSCell* owner, JSC::JSValue caller, WTF::Vector<JSC::StackFrame>& stackTrace, size_t stackTraceLimit)
{
    UNUSED_PARAM(callFrame);

    // Delegate to Interpreter::getStackTrace which includes async stack frames
    // (from the await chain via getAsyncStackTrace). The previous hand-rolled
    // StackVisitor::visit walk only collected synchronous frames.
    //
    // We always collect with framesToSkip=1 (to drop Error.captureStackTrace
    // itself) and without the caller argument, because Interpreter::getStackTrace's
    // built-in caller filtering skips entry-frame tracking during the skip phase,
    // which loses async frames when the caller is the innermost sync frame.
    // Instead we filter out frames up to and including the caller afterwards.
    //
    // Collect without a limit: stackTraceLimit must apply to visible frames
    // AFTER Bun's post-filter and AFTER caller removal, not to raw frames from
    // JSC. If the caller is deep, capping at stackTraceLimit here would collect
    // only frames that get removed, leaving an empty trace. Stack depth is
    // bounded by native stack size so this walk is still O(actual depth).
    WTF::Vector<JSC::StackFrame> rawFrames;
    vm.interpreter.getStackTrace(owner, rawFrames, 1, std::numeric_limits<size_t>::max());

    // JSC's getStackTrace uses StackVisitor::isImplementationVisibilityPrivate
    // which differs from Bun's helper — post-filter to keep behavior consistent
    // with new Error() stack formatting.
    stackTrace.reserveInitialCapacity(rawFrames.size());
    for (auto& frame : rawFrames) {
        if (!isImplementationVisibilityPrivate(frame))
            stackTrace.append(WTF::move(frame));
    }

    if (!caller.isObject()) {
        if (stackTrace.size() > stackTraceLimit)
            stackTrace.shrink(stackTraceLimit);
        return;
    }

    JSC::JSObject* callerObject = caller.getObject();
    WTF::String callerName = Zig::functionName(vm, callerObject);

    // Match V8: remove all frames up to and including the caller. If the caller
    // is not found anywhere in the sync portion of the stack, remove everything.
    // We match by cell identity first, then by name — name matching is needed
    // because a resumed async function's frame callee is the generator's `next`
    // function (a different cell) but Zig::functionName still reports the
    // original async function's name.
    size_t removeCount = stackTrace.size();
    for (size_t i = 0; i < stackTrace.size(); i++) {
        const auto& frame = stackTrace.at(i);
        if (frame.isAsyncFrame())
            break;
        if (frame.callee() == callerObject) {
            removeCount = i + 1;
            break;
        }
        if (!callerName.isEmpty()) {
            WTF::String frameName = Zig::functionName(vm, frame, nullptr);
            if (frameName == callerName) {
                removeCount = i + 1;
                break;
            }
        }
    }

    if (removeCount > 0)
        stackTrace.removeAt(0, removeCount);

    if (stackTrace.size() > stackTraceLimit)
        stackTrace.shrink(stackTraceLimit);
}

static bool isVisibleBuiltinFunction(JSC::CodeBlock* codeBlock)
{
    if (!codeBlock->ownerExecutable()) {
        return false;
    }

    const JSC::SourceCode& source = codeBlock->source();
    return !Zig::sourceURL(source).isEmpty();
}

JSCStackFrame::JSCStackFrame(JSC::VM& vm, const JSC::StackFrame& frame)
    : m_vm(vm)
    , m_stackFrame(&frame)
    , m_codeBlock(nullptr)
    , m_bytecodeIndex(JSC::BytecodeIndex())
    , m_sourceURL()
    , m_functionName()
    , m_isWasmFrame(false)
    , m_isAsync(frame.isAsyncFrame())
    , m_sourcePositionsState(SourcePositionsState::NotCalculated)
{
    m_callee = frame.callee();

    // Based on JSC's GetStackTraceFunctor (Interpreter.cpp)
    if (frame.isWasmFrame()) {
        m_wasmFunctionIndexOrName = frame.wasmFunctionIndexOrName();
        m_isWasmFrame = true;
    } else if (auto* codeBlock = frame.codeBlock()) {
        auto* unlinkedCodeBlock = codeBlock->unlinkedCodeBlock();
        if (!unlinkedCodeBlock->isBuiltinFunction() || isVisibleBuiltinFunction(codeBlock)) {
            m_codeBlock = codeBlock;
            m_bytecodeIndex = frame.bytecodeIndex();
        }

        auto codeType = codeBlock->codeType();
        if (codeType == JSC::FunctionCode || codeType == JSC::EvalCode) {
            m_isFunctionOrEval = true;
        }
    }

    if (!m_codeBlock && frame.hasLineAndColumnInfo()) {
        auto lineColumn = frame.computeLineAndColumn();
        m_sourcePositions = { OrdinalNumber::fromOneBasedInt(lineColumn.line), OrdinalNumber::fromOneBasedInt(lineColumn.column) };
        m_sourcePositionsState = SourcePositionsState::Calculated;
        auto codeType = frame.codeBlock()->codeType();
        if (codeType == JSC::FunctionCode || codeType == JSC::EvalCode) {
            m_isFunctionOrEval = true;
        }
    }
}

intptr_t JSCStackFrame::sourceID() const
{
    return m_codeBlock ? m_codeBlock->ownerExecutable()->sourceID() : JSC::noSourceID;
}

JSC::JSString* JSCStackFrame::sourceURL()
{
    if (!m_sourceURL) {
        m_sourceURL = retrieveSourceURL();
    }

    return jsString(this->m_vm, m_sourceURL);
}

JSC::JSString* JSCStackFrame::functionName()
{
    if (!m_functionName) {
        m_functionName = retrieveFunctionName();
    }

    return jsString(this->m_vm, m_functionName);
}

JSCStackFrame::SourcePositions* JSCStackFrame::getSourcePositions()
{
    if (SourcePositionsState::NotCalculated == m_sourcePositionsState) {
        m_sourcePositionsState = calculateSourcePositions() ? SourcePositionsState::Calculated : SourcePositionsState::Failed;
    }

    return (SourcePositionsState::Calculated == m_sourcePositionsState) ? &m_sourcePositions : nullptr;
}

ALWAYS_INLINE String JSCStackFrame::retrieveSourceURL()
{
    static const auto sourceURLWasmString = MAKE_STATIC_STRING_IMPL("[wasm code]");

    if (m_isWasmFrame) {
        return String(sourceURLWasmString);
    }

    auto url = Zig::sourceURL(m_codeBlock);
    if (!url.isEmpty()) {
        return url;
    }

    if (m_callee && m_callee->isObject()) {
        if (auto* jsFunction = dynamicDowncast<JSFunction>(m_callee)) {
            WTF::String url = Zig::sourceURL(m_vm, jsFunction);
            if (!url.isEmpty()) {
                return url;
            }
        }
    }

    // BUGFIX: Don't return empty string which breaks the 'bindings' npm package
    // The bindings package uses Error.prepareStackTrace to find the calling module
    // but empty filenames cause it to use the wrong module root directory
    // Instead, try to get some identifying information for this frame

    // Try to use sourceID if available
    if (m_codeBlock) {
        auto sourceID = m_codeBlock->ownerExecutable()->sourceID();
        if (sourceID != JSC::noSourceID) {
            // Use a placeholder that includes the sourceID to make frames distinguishable
            return makeString("[source:"_s, sourceID, "]"_s);
        }
    }

    // Last resort: return a distinguishable placeholder instead of empty string
    return "[unknown]"_s;
}

ALWAYS_INLINE String JSCStackFrame::retrieveFunctionName()
{

    if (m_isWasmFrame) {
        return JSC::Wasm::makeString(m_wasmFunctionIndexOrName);
    }

    if (m_callee) {
        auto* calleeObject = m_callee->getObject();
        if (calleeObject) {
            return Zig::functionName(m_vm, calleeObject);
        }
    }

    if (m_codeBlock) {
        auto functionName = Zig::functionName(m_vm, m_codeBlock);
        if (!functionName.isEmpty()) {
            return functionName;
        }
    }

    return emptyString();
}

// General flow here is based on JSC's appendSourceToError (ErrorInstance.cpp)
bool JSCStackFrame::calculateSourcePositions()
{
    if (!m_codeBlock) {
        return false;
    }
    if (!hasBytecodeIndex()) {
        return false;
    }

    auto location = Bun::getAdjustedPositionForBytecode(m_codeBlock, m_bytecodeIndex);
    m_sourcePositions.line = location.line();
    m_sourcePositions.column = location.column();

    return true;
}

String sourceURL(const JSC::SourceOrigin& origin)
{
    if (origin.isNull()) {
        return String();
    }

    return origin.string();
}

String sourceURL(JSC::SourceProvider* sourceProvider)
{
    if (!sourceProvider) [[unlikely]] {
        return String();
    }

    String url = sourceProvider->sourceURLDirective();
    if (!url.isEmpty()) {
        return url;
    }

    url = sourceProvider->sourceURL();
    if (!url.isEmpty()) {
        return url;
    }

    const auto& origin = sourceProvider->sourceOrigin();
    return sourceURL(origin);
}

String sourceURL(const JSC::SourceCode& sourceCode)
{
    return sourceURL(sourceCode.provider());
}

String sourceURL(JSC::CodeBlock& codeBlock)
{
    if (!codeBlock.ownerExecutable()) {
        return String();
    }

    const auto& source = codeBlock.source();
    return sourceURL(source);
}

String sourceURL(JSC::CodeBlock* codeBlock)
{
    if (!codeBlock) [[unlikely]] {
        return String();
    }

    return Zig::sourceURL(*codeBlock);
}

String sourceURL(JSC::VM& vm, const JSC::StackFrame& frame)
{
    if (frame.isWasmFrame()) {
        return "[wasm code]"_s;
    }

    if (!frame.hasLineAndColumnInfo()) [[unlikely]] {
        return "[native code]"_s;
    }

    return sourceURL(frame.codeBlock());
}

String sourceURL(JSC::StackVisitor& visitor)
{
    switch (visitor->codeType()) {
    case JSC::StackVisitor::Frame::Eval:
    case JSC::StackVisitor::Frame::Module:
    case JSC::StackVisitor::Frame::Function:
    case JSC::StackVisitor::Frame::Global: {
        return sourceURL(visitor->codeBlock());
    }
    case JSC::StackVisitor::Frame::Native:
        return "[native code]"_s;
    case JSC::StackVisitor::Frame::Wasm:
        return "[wasm code]"_s;
    }

    RELEASE_ASSERT_NOT_REACHED();
}

String sourceURL(JSC::VM& vm, JSC::JSFunction* function)
{
    auto* executable = function->executable();
    if (!executable || executable->isHostFunction()) {
        return String();
    }

    return Zig::sourceURL(function->jsExecutable()->source());
}

String functionName(JSC::VM& vm, JSC::CodeBlock* codeBlock)
{
    auto codeType = codeBlock->codeType();

    auto* executable = codeBlock->ownerExecutable();
    if (!executable) {
        return String();
    }

    if (codeType == JSC::FunctionCode) {
        return uncheckedDowncast<JSC::FunctionExecutable>(executable)->ecmaNameWithoutGC();
    }

    return String();
}

String functionName(JSC::VM& vm, JSC::JSObject* object)
{
    WTF::String functionName;
    auto jstype = object->type();
    if (jstype == JSC::ProxyObjectType) return {};

    // First try the "name" property, if it is a plain data property. This also names frames at the
    // end of a collection, where nothing may be allocated in the heap and no script may run, and a
    // stack must read the same whenever it is formatted, so nothing here or below does either.
    {
        unsigned attributes;
        PropertyOffset offset = object->structure()->getConcurrently(vm.propertyNames->name.impl(), attributes);
        if (offset != invalidOffset && !(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) {
            JSValue functionNameValue = object->getDirect(offset);
            if (functionNameValue && functionNameValue.isString()) {
                auto name = asString(functionNameValue)->tryGetValueWithoutGC();
                if (!name->isEmpty())
                    return name;
            }
        }
    }

    {
        // Then try the "displayName" property (what this does internally)
        auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        functionName = JSC::getCalculatedDisplayName(vm, object);
        if (topExceptionScope.exception()) [[unlikely]] {
            (void)topExceptionScope.tryClearException();
        }
    }

    {
        if (functionName.isEmpty()) {
            if (jstype == JSC::JSFunctionType) {
                auto* function = uncheckedDowncast<JSC::JSFunction>(object);
                functionName = function->nameWithoutGC(vm);
                if (functionName.isEmpty() && !function->isHostFunction()) {
                    functionName = function->jsExecutable()->ecmaNameWithoutGC();
                }
            } else if (jstype == JSC::InternalFunctionType) {
                functionName = uncheckedDowncast<JSC::InternalFunction>(object)->name();
            }
        }
    }

    // An accessor is named `get g`, as JSC names it once it reifies `fn.name`.
    if (!functionName.isEmpty() && jstype == JSC::JSFunctionType) {
        auto* function = uncheckedDowncast<JSC::JSFunction>(object);
        if (!function->isHostFunction()) {
            auto* executable = function->jsExecutable();
            if (executable->isGetter() && !functionName.startsWith("get "_s))
                functionName = makeString("get "_s, functionName);
            else if (executable->isSetter() && !functionName.startsWith("set "_s))
                functionName = makeString("set "_s, functionName);
        }
    }

    return functionName;
}

// An own data property, read without a property table materialization, a getter, or a proxy trap.
static JSValue ownDataProperty(JSC::JSObject* object, UniquedStringImpl* name)
{
    unsigned attributes;
    PropertyOffset offset = object->structure()->getConcurrently(name, attributes);
    if (offset == invalidOffset || (attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue)))
        return {};
    return object->getDirect(offset);
}

static bool isConstructorFunction(JSC::JSObject* object)
{
    auto type = object->type();
    if (type == JSC::InternalFunctionType)
        return true;
    // V8 names a bound function "Function", not "bound f".
    return type == JSC::JSFunctionType && !object->inherits<JSC::JSBoundFunction>();
}

String receiverTypeName(JSC::VM& vm, JSC::JSValue receiver)
{
    if (!receiver || receiver.isUndefinedOrNull())
        return String();

    // V8 does ToObject on a primitive receiver and names the wrapper's class.
    if (!receiver.isObject()) {
        if (receiver.isString())
            return "String"_s;
        if (receiver.isNumber())
            return "Number"_s;
        if (receiver.isBoolean())
            return "Boolean"_s;
        if (receiver.isSymbol())
            return "Symbol"_s;
        if (receiver.isBigInt())
            return "BigInt"_s;
        return String();
    }

    JSObject* object = asObject(receiver);
    auto type = object->type();
    // A call with the global object as receiver is a top-level call (V8's IsToplevel).
    if (type == JSC::GlobalObjectType || type == JSC::GlobalProxyType)
        return String();
    if (type == JSC::ProxyObjectType)
        return "Proxy"_s;
    if (isConstructorFunction(object)) {
        // A static method: the class's own name.
        String name = Zig::functionName(vm, object);
        if (!name.isEmpty())
            return name;
    }

    // V8's JSReceiver::GetConstructorName. The receiver's own `constructor` is skipped, so that
    // `B.prototype` is named after its prototype.
    JSObject* current = object;
    while (true) {
        JSValue tag = ownDataProperty(current, vm.propertyNames->toStringTagSymbol.impl());
        if (tag && tag.isString()) {
            auto value = asString(tag)->tryGetValueWithoutGC();
            if (!value->isEmpty())
                return value;
        }

        if (current != object) {
            JSValue constructor = ownDataProperty(current, vm.propertyNames->constructor.impl());
            if (constructor && constructor.isObject() && isConstructorFunction(asObject(constructor))) {
                String name = Zig::functionName(vm, asObject(constructor));
                if (!name.isEmpty() && name != "Object"_s)
                    return name;
            }
        }

        if (current->structure()->typeInfo().overridesGetPrototype())
            break;
        JSValue prototype = current->getPrototypeDirect();
        if (!prototype.isObject())
            break;
        current = asObject(prototype);
    }

    return String(object->classInfo()->className);
}

// V8's String::IsIdentifier: `get x`, `o.f` and `bound f` get no type name prefix.
static bool isIdentifier(const String& name)
{
    if (name.isEmpty())
        return false;
    for (unsigned i = 0; i < name.length(); i++) {
        char16_t c = name[i];
        if (c == '$' || c == '_' || isASCIIAlpha(c) || c >= 0x80)
            continue;
        if (i > 0 && isASCIIDigit(c))
            continue;
        return false;
    }
    return true;
}

String methodCallName(const String& typeName, const String& functionName)
{
    if (typeName.isEmpty())
        return functionName;
    if (functionName.isEmpty())
        return makeString(typeName, ".<anonymous>"_s);
    if (isIdentifier(functionName) && functionName != typeName)
        return makeString(typeName, '.', functionName);
    return functionName;
}

String functionName(JSC::VM& vm, const JSC::StackFrame& frame, unsigned int* flags)
{
    bool isConstructor = false;
    bool isFunction = false;
    WTF::String functionName;
    JSC::JSObject* callee = frame.callee() ? frame.callee()->getObject() : nullptr;

    if (frame.hasLineAndColumnInfo()) {
        auto* codeblock = frame.codeBlock();
        if (codeblock->isConstructor()) {
            isConstructor = true;
        }

        auto codeType = codeblock->codeType();
        switch (codeType) {
        case JSC::CodeType::FunctionCode:
        case JSC::CodeType::EvalCode: {
            isFunction = codeType == JSC::CodeType::FunctionCode;
            if (flags) {
                if (codeType == JSC::CodeType::EvalCode) {
                    *flags |= static_cast<unsigned int>(FunctionNameFlags::Eval);
                } else {
                    *flags |= static_cast<unsigned int>(FunctionNameFlags::Function);
                }
            }
            if (callee) {
                functionName = Zig::functionName(vm, callee);

                if (flags && codeblock->unlinkedCodeBlock()->isBuiltinFunction()) {
                    *flags |= static_cast<unsigned int>(FunctionNameFlags::Builtin);
                }
            }
            break;
        }
        default: {
            break;
        }
        }

        if (functionName.isEmpty()) {
            functionName = Zig::functionName(vm, codeblock);
        }
    } else if (callee) {
        functionName = Zig::functionName(vm, callee);
    }

    if ((flags && (*flags & static_cast<unsigned int>(FunctionNameFlags::AddNewKeyword))) && isConstructor && !functionName.isEmpty()) {
        return makeString("new "_s, functionName);
    }

    if ((flags && (*flags & static_cast<unsigned int>(FunctionNameFlags::AddTypeName))) && isFunction && !isConstructor) {
        return methodCallName(receiverTypeName(vm, frame.thisValue()), functionName);
    }

    return functionName;
}
}
