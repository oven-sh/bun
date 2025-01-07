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
    size_t framesCount = 0;

    bool belowCaller = false;
    int32_t skipFrames = 0;

    WTF::String callerName {};
    if (JSC::JSFunction* callerFunction = JSC::jsDynamicCast<JSC::JSFunction*>(caller)) {
        callerName = callerFunction->name(vm);
        if (callerName.isEmpty() && callerFunction->jsExecutable()) {
            callerName = callerFunction->jsExecutable()->name().string();
        }
    }
    if (JSC::InternalFunction* callerFunctionInternal = JSC::jsDynamicCast<JSC::InternalFunction*>(caller)) {
        callerName = callerFunctionInternal->name();
    }

    size_t totalFrames = 0;

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

            totalFrames += 1;

            if (totalFrames > stackTraceLimit) {
                return WTF::IterationStatus::Done;
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

            totalFrames += 1;

            if (totalFrames > stackTraceLimit) {
                return WTF::IterationStatus::Done;
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

            totalFrames += 1;

            if (totalFrames > stackTraceLimit) {
                return WTF::IterationStatus::Done;
            }

            return WTF::IterationStatus::Continue;
        });
    }
    size_t i = 0;
    totalFrames = 0;
    stackTrace.reserveInitialCapacity(framesCount);
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

        totalFrames += 1;

        if (totalFrames > stackTraceLimit) {
            return WTF::IterationStatus::Done;
        }

        if (visitor->isNativeCalleeFrame()) {

            auto* nativeCallee = visitor->callee().asNativeCallee();
            switch (nativeCallee->category()) {
            case NativeCallee::Category::Wasm: {
                stackTrace.append(StackFrame(visitor->wasmFunctionIndexOrName()));
                break;
            }
            case NativeCallee::Category::InlineCache: {
                break;
            }
            }
#if USE(ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS)
        } else if (!!visitor->codeBlock())
#else
            } else if (!!visitor->codeBlock() && !visitor->codeBlock()->unlinkedCodeBlock()->isBuiltinFunction())
#endif
            stackTrace.append(StackFrame(vm, owner, visitor->callee().asCell(), visitor->codeBlock(), visitor->bytecodeIndex()));
        else
            stackTrace.append(StackFrame(vm, owner, visitor->callee().asCell()));

        i++;

        return (i == framesCount) ? WTF::IterationStatus::Done : WTF::IterationStatus::Continue;
    });
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
    }

    if (!m_codeBlock && frame.hasLineAndColumnInfo()) {
        auto lineColumn = frame.computeLineAndColumn();
        m_sourcePositions = { OrdinalNumber::fromOneBasedInt(lineColumn.line), OrdinalNumber::fromOneBasedInt(lineColumn.column) };
        m_sourcePositionsState = SourcePositionsState::Calculated;
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

    return String();
}

ALWAYS_INLINE String JSCStackFrame::retrieveFunctionName()
{
    static const auto functionNameModuleCodeString = MAKE_STATIC_STRING_IMPL("module code");
    static const auto functionNameGlobalCodeString = MAKE_STATIC_STRING_IMPL("global code");

    if (m_isWasmFrame) {
        return JSC::Wasm::makeString(m_wasmFunctionIndexOrName);
    }

    if (m_codeBlock) {
        switch (m_codeBlock->codeType()) {
        case JSC::EvalCode:
            // Node returns null here.
            return String();
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

    if (m_callee) {
        if (auto* callee = m_callee->getObject()) {
            // Does the code block have a user-defined name property?
            JSC::JSValue name = callee->getDirect(m_vm, m_vm.propertyNames->name);
            if (name && name.isString()) {
                auto scope = DECLARE_CATCH_SCOPE(m_vm);
                auto nameString = name.toWTFString(callee->globalObject());
                if (scope.exception()) {
                    scope.clearException();
                }
                if (!nameString.isEmpty()) {
                    return nameString;
                }
            }

            return JSC::getCalculatedDisplayName(m_vm, callee);
        }
    }

    return emptyString();
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

String sourceURL(const JSC::SourceOrigin& origin)
{
    if (origin.isNull()) {
        return String();
    }

    return origin.string();
}

String sourceURL(JSC::SourceProvider* sourceProvider)
{
    if (UNLIKELY(!sourceProvider)) {
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

String sourceURL(JSC::CodeBlock* codeBlock)
{
    if (UNLIKELY(!codeBlock)) {
        return String();
    }

    if (!codeBlock->ownerExecutable()) {
        return String();
    }

    const auto& source = codeBlock->source();
    return sourceURL(source);
}

String sourceURL(JSC::VM& vm, JSC::StackFrame& frame)
{
    if (frame.isWasmFrame()) {
        return "[wasm code]"_s;
    }

    if (UNLIKELY(!frame.codeBlock())) {
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

}
