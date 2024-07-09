/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "ErrorStackTrace.h"
#include "JavaScriptCore/Error.h"
#include "wtf/text/OrdinalNumber.h"

#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/NativeCallee.h>
#include <wtf/IterationStatus.h>

#include "ErrorStackFrame.h"

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

static bool isImplementationVisibilityPrivate(JSC::StackVisitor& visitor)
{
    ImplementationVisibility implementationVisibility = [&]() -> ImplementationVisibility {
        if (auto* codeBlock = visitor->codeBlock()) {
            if (auto* executable = codeBlock->ownerExecutable()) {
                return executable->implementationVisibility();
            }
            return ImplementationVisibility::Public;
        }

#if ENABLE(WEBASSEMBLY)
        if (visitor->isNativeCalleeFrame())
            return visitor->callee().asNativeCallee()->implementationVisibility();
#endif

        if (visitor->callee().isCell()) {
            if (auto* callee = visitor->callee().asCell()) {
                if (auto* jsFunction = jsDynamicCast<JSFunction*>(callee)) {
                    if (auto* executable = jsFunction->executable())
                        return executable->implementationVisibility();
                    return ImplementationVisibility::Public;
                }
            }
        }

        return ImplementationVisibility::Public;
    }();

    return implementationVisibility != ImplementationVisibility::Public;
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

    if (!callerName.isEmpty()) {
        JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
            if (isImplementationVisibilityPrivate(visitor)) {
                return WTF::IterationStatus::Continue;
            }

            framesCount += 1;

            // skip caller frame and all frames above it
            if (!belowCaller) {
                skipFrames += 1;

                if (visitor->functionName() == callerName) {
                    belowCaller = true;
                    return WTF::IterationStatus::Continue;
                }
            }

            return WTF::IterationStatus::Continue;
        });
    } else if (caller && caller.isCell()) {
        JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
            if (isImplementationVisibilityPrivate(visitor)) {
                return WTF::IterationStatus::Continue;
            }

            framesCount += 1;

            // skip caller frame and all frames above it
            if (!belowCaller) {
                auto callee = visitor->callee();
                skipFrames += 1;
                if (callee.isCell() && callee.asCell() == caller) {
                    belowCaller = true;
                    return WTF::IterationStatus::Continue;
                }
            }

            return WTF::IterationStatus::Continue;
        });
    } else if (caller.isEmpty() || caller.isUndefined()) {
        // Skip the first frame.
        JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
            if (isImplementationVisibilityPrivate(visitor)) {
                return WTF::IterationStatus::Continue;
            }

            framesCount += 1;

            if (!belowCaller) {
                skipFrames += 1;
                belowCaller = true;
            }

            return WTF::IterationStatus::Continue;
        });
    }

    framesCount = std::min(frameLimit, framesCount);

    // Create the actual stack frames
    size_t i = 0;
    stackFrames.reserveInitialCapacity(framesCount);
    JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        // Skip native frames
        if (isImplementationVisibilityPrivate(visitor)) {
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
    if (!hasBytecodeIndex()) {
        return false;
    }

    auto location = Bun::getAdjustedPositionForBytecode(m_codeBlock, m_bytecodeIndex);
    m_sourcePositions.line = location.line();
    m_sourcePositions.column = location.column();

    return true;
}

}
