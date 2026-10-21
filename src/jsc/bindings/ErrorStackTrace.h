/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/WasmIndexOrName.h>

#include "ZigGlobalObject.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

/* JSCStackFrame is a view over a JSC::StackFrame, which provides the following advantages\changes:
 * - More detailed and v8 compatible "source offsets" calculations: JSC::StackFrame only provides the
 *   line number and column numbers. It's column calculation seems to be different than v8's column.
 *   According to v8's unit tests, it seems that their column number points to the beginning of
 *   the expression which raised the exception, while in JSC the column returned by computeLineAndColumn
 *   seem to point to the end of the expression. Thus, we'll do the calculations ourselves.
 *   Here, we'll also provide more information which is needed by jscshim (mainly by Message):
 *   - Full expression range in the source code
 *   - Line number
 *	 - Start\end columns (before the "throw", and after the "throw <x>")
 *	 - Line start\stop offsets in the source code
 *   Also, to avoid zero\one base confusions, we'll store all offsets as WTF::OrdinalNumber.
 * - Function name "calculation" also checks the function's "name" property. See retrieveFunctionName's
 *   documentation bellow for more information.
 * - String properties are exposed (and cached) as JSStrings, instead of WTF::String.
 * - Helper functions like isEval and isConstructor.
 *
 * Note that this is not a JSCell and uses no write barriers: whoever makes one keeps its cells alive, until detachFromCells().
 */
class JSCStackFrame {
public:
    struct SourcePositions {
        WTF::OrdinalNumber line;
        WTF::OrdinalNumber column;
    };

    // Where a line of the default error.stack points.
    struct StackLinePosition {
        WTF::String sourceURL;
        JSC::LineColumn lineColumn;
        JSC::LineColumn originalLineColumn;
        bool remapped { false };
    };

private:
    friend class JSCStackTrace;

    JSC::VM& m_vm;
    // Points into the vector this frame was built from (JSCStackTrace::fromExisting). Null once detached.
    const JSC::StackFrame* m_stackFrame;
    JSC::JSCell* m_callee { nullptr };

    // May be null
    JSC::CodeBlock* m_codeBlock { nullptr };
    JSC::BytecodeIndex m_bytecodeIndex;
    intptr_t m_sourceID { JSC::noSourceID };

    // Lazy-initialized
    WTF::String m_sourceURL;
    WTF::String m_functionName;

    // Once detached
    WTF::String m_stackFrameFunctionName;
    unsigned m_stackFrameFunctionNameFlags { 0 };

    StackLinePosition m_stackLinePosition;

    // Of JSC::StackFrame::codeBlock(), which m_codeBlock is not for a builtin without a source URL.
    std::optional<JSC::CodeType> m_codeType;
    bool m_codeBlockIsConstructor = false;

    bool m_isWasmFrame = false;

    bool m_isFunctionOrEval = false;
    bool m_isAsync = false;
    bool m_isEval = false;
    bool m_isConstructor = false;
    bool m_isStrict = false;
    bool m_isNative = false;
    bool m_calleeIsNonHostFunction = false;
    bool m_hasLineAndColumnInfo = false;
    bool m_isImplementationVisibilityPrivate = false;

    enum class SourcePositionsState {
        NotCalculated,
        Failed,
        Calculated
    };

    SourcePositions m_sourcePositions;
    SourcePositionsState m_sourcePositionsState;

public:
    JSCStackFrame(JSC::VM& vm, const JSC::StackFrame& frame);

    // For the end of a collection, before the sweep: reads what is still lazy, then keeps no cell but the callee, weakly.
    void detachFromCells();
    void clearCalleeIfDead();
    size_t sizeOfStrings() const;

    // Not once detached.
    const JSC::StackFrame& stackFrame() const { return *m_stackFrame; }
    // Null if it was collected after detachFromCells().
    JSC::JSCell* callee() const { return m_callee; }
    // Whether or not it was collected.
    bool calleeIsNonHostFunction() const { return m_calleeIsNonHostFunction; }

    intptr_t sourceID() const { return m_sourceID; }
    JSC::JSString* sourceURL();
    void setSourceURL(const WTF::String& sourceURL) { m_sourceURL = sourceURL; }
    JSC::JSString* functionName();

    bool isFunctionOrEval() const { return m_isFunctionOrEval; }
    bool isAsync() const { return m_isAsync; }

    bool hasBytecodeIndex() const { return (m_bytecodeIndex.offset() != UINT_MAX) && !m_isWasmFrame; }

    // Returns null if can't retrieve the source positions
    SourcePositions* getSourcePositions();
    void setSourcePositions(SourcePositions);

    bool isWasmFrame() const { return m_isWasmFrame; }
    bool isEval() const { return m_isEval; }
    bool isConstructor() const { return m_isConstructor; }
    bool isStrict() const { return m_isStrict; }
    // No code block, or the one of a builtin without a source URL.
    bool isNative() const { return m_isNative; }
    bool isImplementationVisibilityPrivate() const { return m_isImplementationVisibilityPrivate; }
    bool hasLineAndColumnInfo() const { return m_hasLineAndColumnInfo; }
    std::optional<JSC::CodeType> codeType() const { return m_codeType; }
    bool codeBlockIsConstructor() const { return m_codeBlockIsConstructor; }

    // Zig::functionName() of the JSC::StackFrame.
    WTF::String stackFrameFunctionName(unsigned& flags) const;
    StackLinePosition& stackLinePosition() { return m_stackLinePosition; }

private:
    ALWAYS_INLINE String retrieveSourceURL();

    /* Regarding real functions (not eval\module\global code), both v8 and JSC seem to follow
     * the same logic, which is to first try the function's "display name", and if it's not defined,
     * the function's name. In JSC, StackFrame::functionName uses JSC::getCalculatedDisplayName,
     * which will internally call the JSFunction\InternalFunction's calculatedDisplayName function.
     * But, those function don't check the function's "name" property if the "display name" isn't defined.
     * See JSFunction::name()'s and InternalFunction::name()'s implementation. According to v8's unit tests,
     * v8 does check the name property in StackFrame::GetFunctionName (see the last part of the
     * "CaptureStackTrace" test in test-api.cc).
     * Thus, we'll reimplement the general flow of JSC::getCalculatedDisplayName and it's internal calls,
     * and just try to use the "name" property when needed, so our lookup will be:
     * "display name" property -> "name" property -> JSFunction\InternalFunction "name" methods.
     */
    ALWAYS_INLINE String retrieveFunctionName();

    bool calculateSourcePositions();
};

class JSCStackTrace final : public JSC::StackTraceSnapshot {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(JSCStackTrace);

private:
    WTF::Vector<JSCStackFrame> m_frames;
    // Lazy-initialized
    WTF::String m_firstFrameExecutableSourceURL;
    bool m_isDetached = false;

public:
    JSCStackTrace()
    {
    }

    JSCStackTrace(WTF::Vector<JSCStackFrame>&& frames)
        : m_frames(WTF::move(frames))
    {
    }

    size_t size() const { return m_frames.size(); }
    bool isEmpty() const { return m_frames.isEmpty(); }
    JSCStackFrame& at(size_t i) { return m_frames.at(i); }
    // JSC::StackFrame::sourceURL() of at(0).
    const WTF::String& firstFrameExecutableSourceURL();

    WTF::Vector<JSCStackFrame>&& frames() { return WTF::move(m_frames); }

    // Reads existingFrames lazily, so they must outlive the result or its detachFromCells().
    static JSCStackTrace fromExisting(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& existingFrames);

    // The positions have gone through source maps by then: the maps are those of the code that ran.
    void detachFromCells();
    bool isDetached() const { return m_isDetached; }

    JSC::JSValue computeErrorInfo(JSC::VM&, unsigned& line, unsigned& column, WTF::String& sourceURL, JSC::JSObject* errorInstance) final;
    size_t sizeInBytes() const final;
    void reconcileWeakReferencesAtGCEnd(JSC::VM&) final;

    static void getFramesForCaller(JSC::VM& vm, JSC::CallFrame* callFrame, JSC::JSCell* owner, JSC::JSValue caller, WTF::Vector<JSC::StackFrame>& stackTrace, size_t stackTraceLimit);

private:
    JSCStackTrace(WTF::Vector<JSCStackFrame>& frames)
        : m_frames(WTF::move(frames))
    {
    }
};

bool isImplementationVisibilityPrivate(JSC::StackVisitor& visitor);
bool isImplementationVisibilityPrivate(const JSC::StackFrame& frame);

String sourceURL(const JSC::SourceOrigin& origin);
String sourceURL(JSC::SourceProvider* sourceProvider);
String sourceURL(const JSC::SourceCode& sourceCode);
String sourceURL(JSC::CodeBlock* codeBlock);
String sourceURL(JSC::CodeBlock& codeBlock);
String sourceURL(JSC::VM& vm, const JSC::StackFrame& frame);
String sourceURL(JSC::StackVisitor& visitor);
String sourceURL(JSC::VM& vm, JSC::JSFunction* function);

class FunctionNameFlags {
public:
    static constexpr unsigned None = 0;
    static constexpr unsigned Eval = 1 << 0;
    static constexpr unsigned Constructor = 1 << 1;
    static constexpr unsigned Builtin = 1 << 2;
    static constexpr unsigned Function = 1 << 3;
    static constexpr unsigned AddNewKeyword = 1 << 4;
};

String functionName(JSC::VM& vm, JSC::CodeBlock* codeBlock);
String functionName(JSC::VM& vm, JSC::JSObject* callee);
String functionName(JSC::VM& vm, const JSC::StackFrame& frame, unsigned int* flags);

}
