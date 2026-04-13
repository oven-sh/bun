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
                if (auto* jsFunction = jsDynamicCast<JSFunction*>(callee)) {
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
            if (auto* jsFunction = jsDynamicCast<JSFunction*>(callee)) {
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
    auto* globalObject = callerObject->globalObject();
    WTF::String callerName = Zig::functionName(vm, globalObject, callerObject);

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
        if (!callerName.isEmpty() && Zig::functionName(vm, globalObject, frame, FinalizerSafety::NotInFinalizer, nullptr) == callerName) {
            removeCount = i + 1;
            break;
        }
    }

    if (removeCount > 0)
        stackTrace.removeAt(0, removeCount);

    if (stackTrace.size() > stackTraceLimit)
        stackTrace.shrink(stackTraceLimit);
}

JSCStackTrace JSCStackTrace::getStackTraceForThrownValue(JSC::VM& vm, JSC::JSValue thrownValue)
{
    const WTF::Vector<JSC::StackFrame>* jscStackTrace = nullptr;

    JSC::Exception* currentException = DECLARE_TOP_EXCEPTION_SCOPE(vm).exception();
    if (currentException && currentException->value() == thrownValue) {
        jscStackTrace = &currentException->stack();
    } else {
        JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(thrownValue);
        if (error) {
            jscStackTrace = error->stackTrace();
        }
    }

    if (!jscStackTrace) {
        return JSCStackTrace();
    }

    return fromExisting(vm, *jscStackTrace);
}

static bool isVisibleBuiltinFunction(JSC::CodeBlock* codeBlock)
{
    if (!codeBlock->ownerExecutable()) {
        return false;
    }

    const JSC::SourceCode& source = codeBlock->source();
    return !Zig::sourceURL(source).isEmpty();
}

JSCStackFrame::JSCStackFrame(JSC::VM& vm, JSC::StackVisitor& visitor)
    : m_vm(vm)
    , m_codeBlock(nullptr)
    , m_bytecodeIndex(JSC::BytecodeIndex())
    , m_sourceURL()
    , m_functionName()
    , m_isWasmFrame(false)
    , m_isAsync(false)
    , m_sourcePositionsState(SourcePositionsState::NotCalculated)
{
    m_callee = visitor->callee().asCell();
    m_callFrame = visitor->callFrame();

    if (auto* codeBlock = visitor->codeBlock()) {
        auto codeType = codeBlock->codeType();
        if (codeType == JSC::FunctionCode || codeType == JSC::EvalCode) {
            m_isFunctionOrEval = true;
        }
    }

    // Based on JSC's GetStackTraceFunctor (Interpreter.cpp)
    if (visitor->isNativeCalleeFrame()) {
        auto* nativeCallee = visitor->callee().asNativeCallee();
        switch (nativeCallee->category()) {
        case NativeCallee::Category::Wasm: {
            m_wasmFunctionIndexOrName = visitor->wasmFunctionIndexOrName();
            m_isWasmFrame = true;
            break;
        }
        case NativeCallee::Category::InlineCache: {
            break;
        }
        }
    } else if (auto* codeBlock = visitor->codeBlock()) {
        auto* unlinkedCodeBlock = codeBlock->unlinkedCodeBlock();
        if (!unlinkedCodeBlock->isBuiltinFunction() || isVisibleBuiltinFunction(codeBlock)) {
            m_codeBlock = codeBlock;
            m_bytecodeIndex = visitor->bytecodeIndex();
        }
    }

    if (!m_bytecodeIndex && visitor->hasLineAndColumnInfo()) {
        auto lineColumn = visitor->computeLineAndColumn();
        m_sourcePositions = { OrdinalNumber::fromOneBasedInt(lineColumn.line), OrdinalNumber::fromOneBasedInt(lineColumn.column) };
        m_sourcePositionsState = SourcePositionsState::Calculated;
    }
}

JSCStackFrame::JSCStackFrame(JSC::VM& vm, const JSC::StackFrame& frame)
    : m_vm(vm)
    , m_callFrame(nullptr)
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

JSC::JSString* JSCStackFrame::typeName()
{
    if (!m_typeName) {
        m_typeName = retrieveTypeName();
    }

    return jsString(this->m_vm, m_typeName);
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
        if (auto* jsFunction = jsDynamicCast<JSFunction*>(m_callee)) {
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
            return Zig::functionName(m_vm, calleeObject->globalObject(), calleeObject);
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

ALWAYS_INLINE String JSCStackFrame::retrieveTypeName()
{
    JSC::JSObject* calleeObject = JSC::jsCast<JSC::JSObject*>(m_callee);
    return calleeObject->className();
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

    auto* jsExecutable = function->jsExecutable();
    if (!jsExecutable) {
        return String();
    }

    return Zig::sourceURL(jsExecutable->source());
}

String functionName(JSC::VM& vm, JSC::CodeBlock* codeBlock)
{
    auto codeType = codeBlock->codeType();

    auto* executable = codeBlock->ownerExecutable();
    if (!executable) {
        return String();
    }

    if (codeType == JSC::FunctionCode) {
        auto* jsExecutable = jsCast<JSC::FunctionExecutable*>(executable);
        if (!jsExecutable) {
            return String();
        }

        return jsExecutable->ecmaName().string();
    }

    return String();
}

String functionName(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* object)
{
    WTF::String functionName;
    auto jstype = object->type();
    if (jstype == JSC::ProxyObjectType) return {};

    // First try the "name" property.
    {
        WTF::String name;
        auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        if (object->getOwnNonIndexPropertySlot(vm, object->structure(), vm.propertyNames->name, slot)) {
            if (!slot.isAccessor()) {
                JSValue functionNameValue = slot.getValue(lexicalGlobalObject, vm.propertyNames->name);
                if (functionNameValue && functionNameValue.isString()) {
                    name = functionNameValue.toWTFString(lexicalGlobalObject);
                    if (!name.isEmpty()) {
                        return name;
                    }
                }
            }
        }
        if (topExceptionScope.exception()) [[unlikely]] {
            (void)topExceptionScope.tryClearException();
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
                auto* function = jsCast<JSC::JSFunction*>(object);
                if (function) {
                    functionName = function->nameWithoutGC(vm);
                    if (functionName.isEmpty() && !function->isHostFunction()) {
                        functionName = function->jsExecutable()->ecmaName().string();
                    }
                }
            } else if (jstype == JSC::InternalFunctionType) {
                auto* function = jsCast<JSC::InternalFunction*>(object);
                if (function) {
                    functionName = function->name();
                }
            }
        }
    }

    return functionName;
}

String functionName(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, const JSC::StackFrame& frame, FinalizerSafety finalizerSafety, unsigned int* flags)
{
    bool isConstructor = false;
    if (finalizerSafety == FinalizerSafety::MustNotTriggerGC) {

        if (auto* callee = frame.callee()) {
            if (auto* object = callee->getObject()) {
                auto jstype = object->type();
                Structure* structure = object->structure();

                auto setTypeFlagsIfNecessary = [&]() {
                    if (flags) {
                        if (jstype == JSC::JSFunctionType || jstype == JSC::InternalFunctionType) {
                            *flags |= static_cast<unsigned int>(FunctionNameFlags::Function);
                        }
                    }
                };

                // First try the "name" property.
                {
                    unsigned attributes;
                    PropertyOffset offset = structure->getConcurrently(vm.propertyNames->name.impl(), attributes);
                    if (offset != invalidOffset && !(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) {
                        JSValue name = object->getDirect(offset);
                        if (name && name.isString()) {
                            auto str = asString(name)->tryGetValueWithoutGC();
                            if (!str->isEmpty()) {
                                setTypeFlagsIfNecessary();
                                return str;
                            }
                        }
                    }
                }

                // Then try the "displayName" property.
                {
                    unsigned attributes;
                    PropertyOffset offset = structure->getConcurrently(vm.propertyNames->displayName.impl(), attributes);
                    if (offset != invalidOffset && !(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) {
                        JSValue name = object->getDirect(offset);
                        if (name && name.isString()) {
                            auto str = asString(name)->tryGetValueWithoutGC();
                            if (!str->isEmpty()) {
                                setTypeFlagsIfNecessary();
                                return str;
                            }
                        }
                    }
                }

                // Lastly, try type-specific properties.
                if (jstype == JSC::JSFunctionType) {
                    auto* function = jsCast<JSC::JSFunction*>(object);
                    if (function) {
                        auto str = function->nameWithoutGC(vm);
                        if (str.isEmpty() && !function->isHostFunction()) {
                            setTypeFlagsIfNecessary();
                            return function->jsExecutable()->ecmaName().string();
                        }
                        setTypeFlagsIfNecessary();
                        return str;
                    }
                } else if (jstype == JSC::InternalFunctionType) {
                    auto* function = jsCast<JSC::InternalFunction*>(object);
                    if (function) {
                        auto str = function->name();
                        setTypeFlagsIfNecessary();
                        return str;
                    }
                }
            }
        }

        return emptyString();
    }

    WTF::String functionName;
    if (frame.hasLineAndColumnInfo()) {
        auto* codeblock = frame.codeBlock();
        if (codeblock->isConstructor()) {
            isConstructor = true;
        }

        if (finalizerSafety == FinalizerSafety::NotInFinalizer) {
            auto codeType = codeblock->codeType();
            switch (codeType) {
            case JSC::CodeType::FunctionCode:
            case JSC::CodeType::EvalCode: {
                if (flags) {
                    if (codeType == JSC::CodeType::EvalCode) {
                        *flags |= static_cast<unsigned int>(FunctionNameFlags::Eval);
                    } else if (codeType == JSC::CodeType::FunctionCode) {
                        *flags |= static_cast<unsigned int>(FunctionNameFlags::Function);
                    }
                }
                if (auto* callee = frame.callee()) {
                    if (auto* object = callee->getObject()) {
                        functionName = Zig::functionName(vm, lexicalGlobalObject, object);

                        if (flags) {
                            if (auto* unlinkedCodeBlock = codeblock->unlinkedCodeBlock()) {
                                if (unlinkedCodeBlock->isBuiltinFunction()) {
                                    *flags |= static_cast<unsigned int>(FunctionNameFlags::Builtin);
                                }
                            }
                        }
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
        }
    } else {
        if (auto* callee = frame.callee()) {
            if (auto* object = callee->getObject()) {
                functionName = Zig::functionName(vm, lexicalGlobalObject, object);
            }
        }
    }

    if ((flags && (*flags & static_cast<unsigned int>(FunctionNameFlags::AddNewKeyword))) && isConstructor && !functionName.isEmpty()) {
        return makeString("new "_s, functionName);
    }

    return functionName;
}
}

extern "C" void Bun__errorInstance__finalize(void* bunErrorData)
{
    UNUSED_PARAM(bunErrorData);
}
