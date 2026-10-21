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
        newFrames.constructAndAppend(vm, existingFrames.at(i));
    }

    return JSCStackTrace(newFrames);
}

void JSCStackTrace::removeImplementationVisibilityPrivateFrames()
{
    m_frames.removeAllMatching([](const JSCStackFrame& frame) {
        return frame.isImplementationVisibilityPrivate();
    });
}

void JSCStackTrace::detachFromCells()
{
    if (!m_frames.isEmpty())
        firstFrameExecutableSourceURL();
    for (auto& frame : m_frames)
        frame.detachFromCells();
}

const WTF::String& JSCStackTrace::firstFrameExecutableSourceURL()
{
    if (!m_firstFrameExecutableSourceURL) {
        auto& frame = m_frames.first();
        m_firstFrameExecutableSourceURL = frame.m_stackFrame->sourceURL(frame.m_vm);
    }
    return m_firstFrameExecutableSourceURL;
}

size_t JSCStackTrace::sizeInBytes() const
{
    return sizeof(JSCStackTrace) + m_frames.sizeInBytes();
}

void JSCStackTrace::reconcileWeakReferencesAtGCEnd(JSC::VM&)
{
    for (auto& frame : m_frames)
        frame.clearCalleeIfDead();
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

static WTF::String emptyIfNull(WTF::String&& string)
{
    return string.isNull() ? emptyString() : WTF::move(string);
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
    , m_hasLineAndColumnInfo(frame.hasLineAndColumnInfo())
    , m_isImplementationVisibilityPrivate(Zig::isImplementationVisibilityPrivate(frame))
    , m_sourcePositionsState(SourcePositionsState::NotCalculated)
{
    m_callee = frame.callee();
    if (m_callee) {
        if (auto* object = m_callee->getObject())
            m_calleeGlobalObject = object->globalObject();
        if (auto* function = dynamicDowncast<JSC::JSFunction>(m_callee))
            m_calleeIsScriptFunction = !function->isHostFunction();
    }

    // Based on JSC's GetStackTraceFunctor (Interpreter.cpp)
    if (frame.isWasmFrame()) {
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

    m_isNative = !m_codeBlock;
    if (m_codeBlock) {
        auto* executable = m_codeBlock->ownerExecutable();
        m_sourceID = executable->sourceID();
        m_isStrict = executable->isInStrictContext();
        m_isEval = m_codeBlock->codeType() == JSC::EvalCode || executable->evalContextType() != JSC::EvalContextType::None;
        m_isConstructor = JSC::CodeSpecializationKind::CodeForConstruct == m_codeBlock->specializationKind();
    }
}

void JSCStackFrame::detachFromCells()
{
    if (!m_sourceURL)
        m_sourceURL = retrieveSourceURL();
    // An empty name is not null, so that it is not looked for again.
    if (!m_functionName)
        m_functionName = emptyIfNull(retrieveFunctionName());
    getSourcePositions();
    lineColumn();
    frameSourceURL();
    stackLineFunctionName();

    if (auto* codeBlock = m_stackFrame->codeBlock())
        m_sourceProvider = codeBlock->source().provider();
    m_stackFrame = nullptr;
    m_codeBlock = nullptr;
    clearCalleeIfDead();
}

void JSCStackFrame::clearCalleeIfDead()
{
    if (m_callee && !m_vm.heap.isMarked(m_callee))
        m_callee = nullptr;
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
        m_functionName = emptyIfNull(retrieveFunctionName());
    }

    return jsString(this->m_vm, m_functionName);
}

JSC::LineColumn JSCStackFrame::lineColumn()
{
    if (!m_lineColumn)
        m_lineColumn = m_stackFrame->computeLineAndColumn();
    return *m_lineColumn;
}

const WTF::String& JSCStackFrame::frameSourceURL()
{
    if (!m_frameSourceURL)
        m_frameSourceURL = emptyIfNull(Zig::sourceURL(m_vm, *m_stackFrame));
    return m_frameSourceURL;
}

const WTF::String& JSCStackFrame::stackLineFunctionName()
{
    if (!m_stackLineFunctionName) {
        m_stackLineFunctionNameFlags = FunctionNameFlags::AddNewKeyword;
        m_stackLineFunctionName = emptyIfNull(Zig::functionName(m_vm, *m_stackFrame, &m_stackLineFunctionNameFlags));
    }
    return m_stackLineFunctionName;
}

unsigned JSCStackFrame::stackLineFunctionNameFlags()
{
    stackLineFunctionName();
    return m_stackLineFunctionNameFlags;
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
        return JSC::Wasm::makeString(m_stackFrame->wasmFunctionIndexOrName());
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

    return functionName;
}

String functionName(JSC::VM& vm, const JSC::StackFrame& frame, unsigned int* flags)
{
    bool isConstructor = false;
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

    return functionName;
}
}
