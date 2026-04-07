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
#include "JavaScriptCore/ParserModes.h"
#include "wtf/text/OrdinalNumber.h"
#include "wtf/ASCIICType.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/NativeCallee.h>
#include <wtf/IterationStatus.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/FunctionCodeBlock.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/SourceProvider.h>

#include "ErrorStackFrame.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

// Forward declarations — definitions are further down in the file.
WTF::String maybePrefixClassName(JSC::CodeBlock* codeBlock, const WTF::String& name);

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
        if (callerName.isEmpty() && !callerFunction->isHostFunction() && callerFunction->jsExecutable()) {
            callerName = callerFunction->jsExecutable()->name().string();
        }
    } else if (JSC::InternalFunction* callerFunctionInternal = JSC::jsDynamicCast<JSC::InternalFunction*>(caller)) {
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
            auto name = Zig::functionName(m_vm, calleeObject->globalObject(), calleeObject);
            if (m_codeBlock)
                name = maybePrefixClassName(m_codeBlock, name);
            return name;
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

// Returns true if the character can legally appear inside a JS identifier
// (ASCII-only; good enough for recognising the `class` keyword and identifier
// names in typical source text).
static ALWAYS_INLINE bool isIdentifierChar(char16_t c)
{
    return WTF::isASCIIAlphanumeric(c) || c == '_' || c == '$';
}

// Forward declaration — the definition is below.
static WTF::String findEnclosingClassName(JSC::FunctionExecutable*);

// Given a resolved function name and a CodeBlock, return the name prefixed
// with its enclosing class (`ClassName.method`), matching V8/Node. Returns
// the original name unchanged if no enclosing class can be recovered, or if
// the name already contains a `.` (e.g. because it already has a prefix).
WTF::String maybePrefixClassName(JSC::CodeBlock* codeBlock, const WTF::String& name)
{
    if (name.isEmpty() || name.find('.') != notFound)
        return name;
    if (codeBlock->codeType() != JSC::FunctionCode)
        return name;
    auto* executable = codeBlock->ownerExecutable();
    if (!executable)
        return name;
    auto* jsExecutable = jsDynamicCast<JSC::FunctionExecutable*>(executable);
    if (!jsExecutable)
        return name;
    WTF::String className = findEnclosingClassName(jsExecutable);
    if (className.isEmpty())
        return name;
    return makeString(className, '.', name);
}

// Best-effort scan of the source text preceding a function to find an
// enclosing `class Name { ... }` declaration. Returns the class identifier,
// or a null string if none could be determined.
//
// This matches V8's observable behaviour of prefixing class-method stack
// frames with `ClassName.`, without requiring runtime `this` capture or JSC
// parser changes. It walks backwards from the method's start offset, brace-
// matches to locate the enclosing `{`, then scans back a bounded window for
// the `class` keyword. Degrades to null for anonymous classes, minified code
// with `class`/`{` inside string literals, and other pathological cases.
static WTF::String findEnclosingClassName(JSC::FunctionExecutable* jsExecutable)
{
    // Class constructors already expose their own name via ecmaName — skip.
    if (jsExecutable->isClass())
        return WTF::String();

    // Only prefix actual methods (method, get, set, async method, generator
    // method, static block). Arrow functions and regular function expressions
    // inside a class body are not "class methods" for stack-trace purposes.
    JSC::SourceParseMode parseMode = jsExecutable->parseMode();
    if (!JSC::isMethodParseMode(parseMode))
        return WTF::String();

    const JSC::SourceCode& source = jsExecutable->source();
    auto* provider = source.provider();
    if (!provider)
        return WTF::String();

    WTF::StringView sourceView = provider->source();
    int len = static_cast<int>(sourceView.length());
    int methodStart = source.startOffset();
    if (methodStart <= 0 || methodStart >= len)
        return WTF::String();

    // Cap walk distance to avoid pathological cost on very large source files.
    constexpr int maxBraceWalk = 65536;
    constexpr int maxHeaderWalk = 512;

    // Walk backwards, matching braces, until we find the enclosing `{`.
    int depth = 0;
    int bracePos = -1;
    int walkEnd = std::max(0, methodStart - 1 - maxBraceWalk);
    for (int i = methodStart - 1; i >= walkEnd; --i) {
        char16_t c = sourceView[i];
        if (c == '}') {
            depth++;
        } else if (c == '{') {
            if (depth == 0) {
                bracePos = i;
                break;
            }
            depth--;
        }
    }
    if (bracePos < 0)
        return WTF::String();

    // Walk backwards from the brace a bounded distance, looking for the
    // `class` keyword at a word boundary. The class header between `class`
    // and `{` is typically `IDENT` or `IDENT extends EXPR`, which is short.
    int headerStart = std::max(0, bracePos - maxHeaderWalk);
    int classPos = -1;
    for (int i = bracePos - 5; i >= headerStart; --i) {
        if (sourceView[i] != 'c')
            continue;
        if (sourceView[i + 1] != 'l' || sourceView[i + 2] != 'a'
            || sourceView[i + 3] != 's' || sourceView[i + 4] != 's')
            continue;
        // Word boundary on both sides.
        if (i > 0 && isIdentifierChar(sourceView[i - 1]))
            continue;
        if (i + 5 < len && isIdentifierChar(sourceView[i + 5]))
            continue;
        classPos = i;
        break;
    }
    if (classPos < 0)
        return WTF::String();

    // Extract the identifier after `class`.
    int j = classPos + 5;
    while (j < len && WTF::isASCIIWhitespace(sourceView[j]))
        j++;
    int identStart = j;
    while (j < len && isIdentifierChar(sourceView[j]))
        j++;
    int identEnd = j;
    if (identStart == identEnd)
        return WTF::String(); // anonymous class expression

    // Anything other than whitespace / `extends EXPR` between the identifier
    // and the brace means this isn't actually the enclosing class header.
    // Cheap sanity check: next non-whitespace must be `{` or the `extends`
    // keyword.
    while (j < len && WTF::isASCIIWhitespace(sourceView[j]))
        j++;
    if (j >= len)
        return WTF::String();
    if (sourceView[j] != '{') {
        // Must be `extends`.
        if (j + 7 > len
            || sourceView[j] != 'e' || sourceView[j + 1] != 'x'
            || sourceView[j + 2] != 't' || sourceView[j + 3] != 'e'
            || sourceView[j + 4] != 'n' || sourceView[j + 5] != 'd'
            || sourceView[j + 6] != 's')
            return WTF::String();
        if (j + 7 < len && isIdentifierChar(sourceView[j + 7]))
            return WTF::String();
    }

    return sourceView.substring(identStart, identEnd - identStart).toString();
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

        // V8 prefixes class-method stack frames with `ClassName.`. Try to
        // recover the enclosing class name from the source text.
        return maybePrefixClassName(codeBlock, jsExecutable->ecmaName().string());
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
            } else {
                // The object lookup above returns the bare `.name` for class
                // methods (e.g. "method"). Prepend the enclosing class name so
                // stack traces read as `ClassName.method`, matching V8/Node.
                functionName = maybePrefixClassName(codeblock, functionName);
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
