/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "ErrorStackTrace.h"

#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/NativeCallee.h>
#include <wtf/IterationStatus.h>

using namespace JSC;
using namespace WebCore;

namespace Zig {

JSCStackTrace JSCStackTrace::fromExisting(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& existingFrames)
{
    WTF::Vector<JSCStackFrame> newFrames;

    size_t frameCount = existingFrames.size();
    if (0 == frameCount) {
        return JSCStackTrace();
    }

    newFrames.reserveInitialCapacity(frameCount);
    for (size_t i = 0; i < frameCount; i++) {
        newFrames.constructAndAppend(vm, existingFrames.at(i));
    }

    return JSCStackTrace(newFrames);
}

JSCStackTrace JSCStackTrace::captureCurrentJSStackTrace(Zig::GlobalObject* globalObject, JSC::CallFrame* callFrame, size_t frameLimit, JSC::JSValue caller)
{
    JSC::VM& vm = globalObject->vm();
    if (!callFrame) {
        return JSCStackTrace();
    }

    WTF::Vector<JSCStackFrame> stackFrames;
    size_t framesCount = 0;

    bool belowCaller = false;
    int32_t skipFrames = 0;

    WTF::String callerName {};
    if (JSC::JSFunction* callerFunction = JSC::jsDynamicCast<JSC::JSFunction*>(caller)) {
        callerName = callerFunction->name(vm);
        if (!callerFunction->name(vm).isEmpty() || callerFunction->isHostOrBuiltinFunction()) {
            callerName = callerFunction->name(vm);
        } else {
            callerName = callerFunction->jsExecutable()->name().string();
        }
    }
    if (JSC::InternalFunction* callerFunctionInternal = JSC::jsDynamicCast<JSC::InternalFunction*>(caller)) {
        callerName = callerFunctionInternal->name();
    }

    JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        // skip caller frame and all frames above it
        if (!callerName.isEmpty()) {
            if (!belowCaller) {
                if (visitor->functionName() == callerName) {
                    belowCaller = true;
                    return WTF::IterationStatus::Continue;
                }
                skipFrames += 1;
            }
        }
        if (!visitor->isNativeFrame()) {
            framesCount++;
        }

        return WTF::IterationStatus::Continue;
    });
    framesCount = std::min(frameLimit, framesCount);

    // Create the actual stack frames
    size_t i = 0;
    stackFrames.reserveInitialCapacity(framesCount);
    JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        // Skip native frames
        if (visitor->isNativeFrame()) {
            return WTF::IterationStatus::Continue;
        }

        // Skip frames if needed
        if (skipFrames > 0) {
            skipFrames--;
            return WTF::IterationStatus::Continue;
        }

        stackFrames.constructAndAppend(vm, visitor);
        i++;

        return (i == framesCount) ? WTF::IterationStatus::Done : WTF::IterationStatus::Continue;
    });

    return JSCStackTrace(stackFrames);
}

JSCStackTrace JSCStackTrace::getStackTraceForThrownValue(JSC::VM& vm, JSC::JSValue thrownValue)
{
    const WTF::Vector<JSC::StackFrame>* jscStackTrace = nullptr;

    JSC::Exception* currentException = DECLARE_CATCH_SCOPE(vm).exception();
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

JSCStackFrame::JSCStackFrame(JSC::VM& vm, JSC::StackVisitor& visitor)
    : m_vm(vm)
    , m_codeBlock(nullptr)
    , m_bytecodeIndex(JSC::BytecodeIndex())
    , m_sourceURL()
    , m_functionName()
    , m_isWasmFrame(false)
    , m_sourcePositionsState(SourcePositionsState::NotCalculated)
{
    m_callee = visitor->callee().asCell();
    m_callFrame = visitor->callFrame();

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
    } else if (!!visitor->codeBlock() && !visitor->codeBlock()->unlinkedCodeBlock()->isBuiltinFunction()) {
        m_codeBlock = visitor->codeBlock();
        m_bytecodeIndex = visitor->bytecodeIndex();
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
    , m_sourcePositionsState(SourcePositionsState::NotCalculated)
{
    m_callee = frame.callee();

    // Based on JSC's GetStackTraceFunctor (Interpreter.cpp)
    if (frame.isWasmFrame()) {
        m_wasmFunctionIndexOrName = frame.wasmFunctionIndexOrName();
        m_isWasmFrame = true;
    } else {
        m_codeBlock = frame.codeBlock();
        if (frame.hasBytecodeIndex()) {
            m_bytecodeIndex = frame.bytecodeIndex();
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
    static auto sourceURLWasmString = MAKE_STATIC_STRING_IMPL("[wasm code]");
    static auto sourceURLNativeString = MAKE_STATIC_STRING_IMPL("[native code]");

    if (m_isWasmFrame) {
        return String(sourceURLWasmString);
    }

    if (!m_codeBlock) {
        return String(sourceURLNativeString);
    }

    return m_codeBlock->ownerExecutable()->sourceURL();
}

ALWAYS_INLINE String JSCStackFrame::retrieveFunctionName()
{
    static auto functionNameEvalCodeString = MAKE_STATIC_STRING_IMPL("eval code");
    static auto functionNameModuleCodeString = MAKE_STATIC_STRING_IMPL("module code");
    static auto functionNameGlobalCodeString = MAKE_STATIC_STRING_IMPL("global code");

    if (m_isWasmFrame) {
        return JSC::Wasm::makeString(m_wasmFunctionIndexOrName);
    }

    if (m_codeBlock) {
        switch (m_codeBlock->codeType()) {
        case JSC::EvalCode:
            return String(functionNameEvalCodeString);
        case JSC::ModuleCode:
            return String(functionNameModuleCodeString);
        case JSC::FunctionCode:
            break;
        case JSC::GlobalCode:
            return String(functionNameGlobalCodeString);
        default:
            ASSERT_NOT_REACHED();
        }
    }

    String name;
    if (m_callee) {
        if (m_callee->isObject())
            name = getCalculatedDisplayName(m_vm, jsCast<JSObject*>(m_callee)).impl();
    }

    return name.isNull() ? emptyString() : name;
}

ALWAYS_INLINE String JSCStackFrame::retrieveTypeName()
{
    JSC::JSObject* calleeObject = JSC::jsCast<JSC::JSObject*>(m_callee);
    // return JSC::jsTypeStringForValue(m_globalObjectcalleeObject->toThis()
    return calleeObject->className();
}

// General flow here is based on JSC's appendSourceToError (ErrorInstance.cpp)
bool JSCStackFrame::calculateSourcePositions()
{
    if (!m_codeBlock) {
        return false;
    }

    JSC::BytecodeIndex bytecodeIndex = hasBytecodeIndex() ? m_bytecodeIndex : JSC::BytecodeIndex();

    /* Get the "raw" position info.
     * Note that we're using m_codeBlock->unlinkedCodeBlock()->expressionRangeForBytecodeOffset rather than m_codeBlock->expressionRangeForBytecodeOffset
     * in order get the "raw" offsets and avoid the CodeBlock's expressionRangeForBytecodeOffset modifications to the line and column numbers,
     * (we don't need the column number from it, and we'll calculate the line "fixes" ourselves). */
    ExpressionInfo::Entry info = m_codeBlock->unlinkedCodeBlock()->expressionInfoForBytecodeIndex(bytecodeIndex);
    info.divot += m_codeBlock->sourceOffset();

    /* On the first line of the source code, it seems that we need to "fix" the column with the starting
     * offset. We currently use codeBlock->source()->startPosition().m_column.oneBasedInt() as the
     * offset in the first line rather than codeBlock->firstLineColumnOffset(), which seems simpler
     * (and what CodeBlock::expressionRangeForBytecodeOffset does). This is because firstLineColumnOffset
     * values seems different from what we expect (according to v8's tests) and I haven't dove into the
     * relevant parts in JSC (yet) to figure out why. */
    unsigned columnOffset = info.lineColumn.line ? 0 : m_codeBlock->source().startColumn().zeroBasedInt();

    // "Fix" the line number
    JSC::ScriptExecutable* executable = m_codeBlock->ownerExecutable();
    info.lineColumn.line = executable->overrideLineNumber(m_vm).value_or(info.lineColumn.line + executable->firstLine());

    // Calculate the staring\ending offsets of the entire expression
    int expressionStart = info.divot - info.startOffset;
    int expressionStop = info.divot + info.endOffset;

    // Make sure the range is valid
    StringView sourceString = m_codeBlock->source().provider()->source();
    if (!expressionStop || expressionStart > static_cast<int>(sourceString.length())) {
        return false;
    }

    // Search for the beginning of the line
    unsigned int lineStart = expressionStart;
    while ((lineStart > 0) && ('\n' != sourceString[lineStart - 1])) {
        lineStart--;
    }
    // Search for the end of the line
    unsigned int lineStop = expressionStop;
    unsigned int sourceLength = sourceString.length();
    while ((lineStop < sourceLength) && ('\n' != sourceString[lineStop])) {
        lineStop++;
    }

    /* Finally, store the source "positions" info.
     * Notes:
     * - The retrieved column seem to point the "end column". To make sure we're current, we'll calculate the
     *   columns ourselves, since we've already found where the line starts. Note that in v8 it should be 0-based
     *   here (in contrast the 1-based column number in v8::StackFrame).
     * - The static_casts are ugly, but comes from differences between JSC and v8's api, and should be OK
     *   since no source should be longer than "max int" chars.
     */
    m_sourcePositions.expressionStart = WTF::OrdinalNumber::fromZeroBasedInt(expressionStart);
    m_sourcePositions.expressionStop = WTF::OrdinalNumber::fromZeroBasedInt(expressionStop);
    m_sourcePositions.line = WTF::OrdinalNumber::fromZeroBasedInt(static_cast<int>(info.lineColumn.line));
    m_sourcePositions.startColumn = WTF::OrdinalNumber::fromZeroBasedInt((expressionStart - lineStart) + columnOffset);
    m_sourcePositions.endColumn = WTF::OrdinalNumber::fromZeroBasedInt(m_sourcePositions.startColumn.zeroBasedInt() + (expressionStop - expressionStart));
    m_sourcePositions.lineStart = WTF::OrdinalNumber::fromZeroBasedInt(static_cast<int>(lineStart));
    m_sourcePositions.lineStop = WTF::OrdinalNumber::fromZeroBasedInt(static_cast<int>(lineStop));

    return true;
}

}
