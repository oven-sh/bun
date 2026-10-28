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
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSRemoteFunction.h>
#include <JavaScriptCore/ProxyObject.h>
#include <JavaScriptCore/VMEntryRecord.h>
#include <wtf/IterationStatus.h>
#include <wtf/ScopedLambda.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/FunctionCodeBlock.h>

#include "ErrorStackFrame.h"

#include <array>
#include <bit>

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

#if ENABLE(AOT)
        // The walk over compiled code lists the frames that are shown. The function object that names such a frame enters compiled code through an executable that is shown nowhere.
        if (frame.isCompiledFrame())
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

// Which entry into the VM the frames of suspended async functions follow is decided
// among all entries that resumed one. A walk that ends early decides alike if there
// is no second one.
static bool severalEntriesResumedAsyncFunctions(JSC::VM& vm)
{
    bool hasFoundOne = false;
    for (JSC::EntryFrame* entryFrame = vm.topEntryFrame; entryFrame; entryFrame = vmEntryRecord(entryFrame)->prevTopEntryFrame()) {
        if (!JSC::Interpreter::asyncFunctionIn(vmEntryRecord(entryFrame)->m_context))
            continue;
        if (hasFoundOne)
            return true;
        hasFoundOne = true;
    }
    return false;
}

// Visits every frame and keeps the first ones, so the limit only ends the frames of suspended async functions: two of them can await each other.
static NEVER_INLINE void getFirstFramesOfWholeStack(JSC::VM& vm, JSC::JSCell* owner, WTF::Vector<JSC::StackFrame>& stackTrace, size_t framesToKeep, const JSC::Interpreter::StackFrameFilter& isWanted)
{
    size_t framesKept = 0;
    auto isWantedInFront = [&](const JSC::StackFrame& frame) {
        if (framesKept == framesToKeep || !isWanted(frame))
            return false;
        framesKept++;
        return true;
    };
    JSC::Interpreter::StackFrameFilter filter = isWantedInFront;
    vm.interpreter.getStackTrace(owner, stackTrace, 1, 2 * framesToKeep, nullptr, nullptr, nullptr, &filter);
}

// V8 searches the stack for a JSFunction only. A bound function, a function that a ShadowRealm wraps, a Proxy and a value that is not callable select no frame.
static JSC::JSObject* functionToFindOnStack(JSC::JSValue caller)
{
    if (!caller.isCallable() || caller.inherits<JSC::JSBoundFunction>() || caller.inherits<JSC::JSRemoteFunction>() || caller.inherits<JSC::ProxyObject>())
        return nullptr;
    JSC::JSObject* function = caller.getObject();
#if ENABLE(AOT)
    if (JSC::AOT::CompiledCallee::isCompiledCallee(function) && JSC::AOT::CompiledCallee::isBoundFunction(function))
        return nullptr;
#endif
    return function;
}

void JSCStackTrace::getFramesForCaller(JSC::VM& vm, JSC::CallFrame* callFrame, JSC::JSCell* owner, JSC::JSValue caller, WTF::Vector<JSC::StackFrame>& stackTrace, size_t stackTraceLimit)
{
    UNUSED_PARAM(callFrame);

    JSC::JSObject* callerObject = functionToFindOnStack(caller);
    // Made at the first frame that is not the caller's by identity.
    std::optional<WTF::String> nameOfCaller;

    // A deep stack holds the same few functions over and over, and their names take
    // longer to make than to compare.
    struct FunctionOfFrame {
        const void* callee { nullptr };
        uintptr_t code { 0 };
        bool operator==(const FunctionOfFrame&) const = default;
    };
    std::array<FunctionOfFrame, 8> functionsWithOtherNames;

    // We match by cell identity first, then by name — name matching is needed
    // because a resumed async function's frame callee is the generator's `next`
    // function (a different cell) but Zig::functionName still reports the
    // original async function's name.
    auto isFrameOfCaller = [&](const JSC::StackFrame& frame) {
        if (frame.callee() == callerObject)
            return true;
        FunctionOfFrame function { frame.callee(), std::bit_cast<uintptr_t>(frame.codeBlock()) };
#if ENABLE(AOT)
        if (frame.isCompiledFrame()) {
            const auto& compiledFrame = frame.compiledFrame();
            function.code = static_cast<uintptr_t>(compiledFrame.function.index()) << 2 | (compiledFrame.calleeLiesInFrame ? 2 : 0) | 1;
        }
#endif
        auto& functionWithOtherName = functionsWithOtherNames[((std::bit_cast<uintptr_t>(function.callee) >> 4) + (function.code >> 2)) % functionsWithOtherNames.size()];
        if (functionWithOtherName == function)
            return false;
#if ENABLE(AOT)
        if (frame.isCompiledFrame() && JSC::AOT::isClosureOf(callerObject, frame.compiledFrame().function))
            return true;
#endif
        if (!nameOfCaller)
            nameOfCaller = Zig::functionName(vm, callerObject);
        const WTF::String& callerName = *nameOfCaller;
        if (callerName.isEmpty())
            return false;
        if (Zig::functionName(vm, frame, nullptr) == callerName)
            return true;
        functionWithOtherName = function;
        return false;
    };

    // stackTraceLimit must apply to visible frames AFTER Bun's filter and AFTER
    // caller removal, not to raw frames from JSC, so both are decided while JSC
    // walks: the walk ends at the last frame that is shown, however deep the stack is.
    //
    // JSC's getStackTrace uses StackVisitor::isImplementationVisibilityPrivate
    // which differs from Bun's helper — filter to keep behavior consistent
    // with new Error() stack formatting.
    //
    // The frame of the caller is kept until the walk is over. It tells whether the
    // frames of suspended async functions come in front of the caller or behind it.
    bool hasFoundCaller = false;
    auto isWanted = [&](const JSC::StackFrame& frame) {
        if (isImplementationVisibilityPrivate(frame))
            return false;
        if (!hasFoundCaller)
            hasFoundCaller = isFrameOfCaller(frame);
        return hasFoundCaller;
    };
    JSC::Interpreter::StackFrameFilter filter = isWanted;

    constexpr size_t everyFrame = std::numeric_limits<size_t>::max();
    size_t framesToCollect = stackTraceLimit == everyFrame || !callerObject ? stackTraceLimit : stackTraceLimit + 1;
    for (bool isSecondWalk = false;; isSecondWalk = true) {
        // Delegate to Interpreter::getStackTrace which includes async stack frames
        // (from the await chain via getAsyncStackTrace). The previous hand-rolled
        // StackVisitor::visit walk only collected synchronous frames.
        //
        // We always collect with framesToSkip=1 (to drop Error.captureStackTrace
        // itself) and without the caller argument, because Interpreter::getStackTrace's
        // built-in caller filtering skips entry-frame tracking during the skip phase,
        // which loses async frames when the caller is the innermost sync frame.
        hasFoundCaller = !callerObject;
        stackTrace.shrink(0);
        if (isSecondWalk)
            getFirstFramesOfWholeStack(vm, owner, stackTrace, framesToCollect, filter);
        else
            vm.interpreter.getStackTrace(owner, stackTrace, 1, framesToCollect, nullptr, nullptr, nullptr, &filter);

        // Match V8: if the caller is not found anywhere in the sync portion of the
        // stack, remove everything.
        if (!hasFoundCaller) {
            stackTrace.shrink(0);
            return;
        }

        // JSC puts the frames of suspended async functions in front of a caller that is behind a drain of microtasks. The trace starts behind the caller, as in V8.
        if (callerObject) {
            size_t framesInFrontOfCaller = 0;
            while (stackTrace[framesInFrontOfCaller].isAsyncFrame())
                framesInFrontOfCaller++;
            if (framesInFrontOfCaller) [[unlikely]]
                stackTrace.removeAt(0, framesInFrontOfCaller);
        }

        bool hasEveryFrame = stackTrace.size() < framesToCollect;
        if (hasEveryFrame || isSecondWalk)
            break;
        stackTrace.shrink(framesToCollect);
        bool hasAsyncFrame = false;
        bool hasPrivateAsyncFrame = false;
        for (const auto& frame : stackTrace) {
            if (!frame.isAsyncFrame())
                continue;
            hasAsyncFrame = true;
            hasPrivateAsyncFrame |= isImplementationVisibilityPrivate(frame);
        }
        if (!hasPrivateAsyncFrame && !(hasAsyncFrame && severalEntriesResumedAsyncFunctions(vm)))
            break;
    }

    stackTrace.removeAllMatching([](const JSC::StackFrame& frame) {
        return frame.isAsyncFrame() && isImplementationVisibilityPrivate(frame);
    });

    // Match V8: remove all frames up to and including the caller.
    if (callerObject)
        stackTrace.removeAt(0);

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
#if ENABLE(AOT)
    } else if (frame.isCompiledFrame()) {
        m_isAOTCompiled = true;
        if (auto position = frame.compiledPosition(); position && frame.hasLineAndColumnInfo()) {
            m_sourcePositions = { OrdinalNumber::fromOneBasedInt(position->startOfExpression().line), OrdinalNumber::fromOneBasedInt(position->startOfExpression().column) };
            m_sourcePositionsState = SourcePositionsState::Calculated;
            m_isFunctionOrEval = frame.codeType() == JSC::FunctionCode || frame.codeType() == JSC::EvalCode;
        }
        return;
#endif
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

    auto url = m_isAOTCompiled ? Zig::sourceURL(m_vm, *m_stackFrame) : Zig::sourceURL(m_codeBlock);
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

    if (m_isAOTCompiled)
        return Zig::functionName(m_vm, *m_stackFrame, nullptr);

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

#if ENABLE(AOT)
String externalSourceMapFileURL()
{
#if OS(WINDOWS)
    static const auto url = MAKE_STATIC_STRING_IMPL("B:\\~BUN\\root\\compiled.js");
#else
    static const auto url = MAKE_STATIC_STRING_IMPL("/$bunfs/root/compiled.js");
#endif
    return String(url);
}

String sourceURL(const JSC::AOT::SourcePosition& position)
{
    if (position.source)
        return JSC::AOT::sourceURLOf(position.source);
    return hasExternalSourceMap() ? externalSourceMapFileURL() : String();
}
#endif

String sourceURL(JSC::VM& vm, const JSC::StackFrame& frame)
{
    if (frame.isWasmFrame()) {
        return "[wasm code]"_s;
    }

    if (!frame.hasLineAndColumnInfo()) [[unlikely]] {
        return "[native code]"_s;
    }

#if ENABLE(AOT)
    if (frame.isCompiledFrame()) [[unlikely]] {
        auto position = frame.compiledPosition();
        return position ? sourceURL(*position) : String();
    }
#endif

    return sourceURL(frame.codeBlock());
}

String sourceURL(JSC::StackVisitor& visitor)
{
    switch (visitor->codeType()) {
    case JSC::StackVisitor::Frame::Eval:
    case JSC::StackVisitor::Frame::Module:
    case JSC::StackVisitor::Frame::Function:
    case JSC::StackVisitor::Frame::Global: {
#if ENABLE(AOT)
        if (visitor->isCompiledFrame())
            return hasExternalSourceMap() ? externalSourceMapFileURL() : visitor->compiledFrame().sourceURL();
#endif
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

#if ENABLE(AOT)
static String compiledFunctionName(JSC::VM& vm, const JSC::StackFrame& frame)
{
    JSC::AOT::FunctionDescription description(frame.compiledFrame().function);
    return frame.isAsyncFrame() ? description.name(vm) : description.nameInFrames(vm, frame.callee(), frame.compiledFrame().calleeLiesInFrame);
}

static String functionNameOfCompiledFrame(JSC::VM& vm, const JSC::StackFrame& frame, unsigned int* flags)
{
    if (!frame.hasLineAndColumnInfo())
        return compiledFunctionName(vm, frame);

    auto codeType = frame.codeType();
    if (flags && (codeType == JSC::CodeType::FunctionCode || codeType == JSC::CodeType::EvalCode)) {
        *flags |= static_cast<unsigned int>(codeType == JSC::CodeType::EvalCode ? FunctionNameFlags::Eval : FunctionNameFlags::Function);
        if (frame.isBuiltinFunction())
            *flags |= static_cast<unsigned int>(FunctionNameFlags::Builtin);
    }

    WTF::String functionName;
    if (codeType == JSC::CodeType::FunctionCode && !(frame.isAsyncFrame() && JSC::AOT::FunctionDescription(frame.compiledFrame().function).isNamedByOwner()))
        functionName = compiledFunctionName(vm, frame);
    // `bun run` evaluates a module of the library as a function that has the name of the module.
    else if (codeType == JSC::CodeType::ModuleCode && JSC::AOT::FunctionDescription(frame.compiledFrame().function).isInRuntimeModule())
        functionName = sourceURL(vm, frame);

    if ((flags && (*flags & static_cast<unsigned int>(FunctionNameFlags::AddNewKeyword))) && frame.isConstructor() && !functionName.isEmpty())
        return makeString("new "_s, functionName);

    return functionName;
}
#endif

String functionName(JSC::VM& vm, const JSC::StackFrame& frame, unsigned int* flags)
{
#if ENABLE(AOT)
    if (frame.isCompiledFrame()) [[unlikely]]
        return functionNameOfCompiledFrame(vm, frame, flags);
#endif

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
