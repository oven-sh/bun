/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/CodeBlock.h>
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
 * Note that this is not a heap allocated, garbage collected, JSCell. It must be stack allocated, as it doesn't
 * use any write barriers and rely on the GC to see the stored JSC object pointers on the stack.
 */
class JSCStackFrame {
public:
    struct SourcePositions {
        WTF::OrdinalNumber line;
        WTF::OrdinalNumber column;
    };

private:
    JSC::VM& m_vm;
    // Points into the vector this frame was built from (JSCStackTrace::fromExisting).
    const JSC::StackFrame* m_stackFrame;
    JSC::JSCell* m_callee { nullptr };

    // May be null
    JSC::CodeBlock* m_codeBlock { nullptr };
    JSC::BytecodeIndex m_bytecodeIndex;

    // Lazy-initialized
    WTF::String m_sourceURL;
    WTF::String m_functionName;

    // m_wasmFunctionIndexOrName has meaning only when m_isWasmFrame is set
    JSC::Wasm::IndexOrName m_wasmFunctionIndexOrName;
    bool m_isWasmFrame = false;

    bool m_isFunctionOrEval = false;
    bool m_isAsync = false;

    enum class SourcePositionsState {
        NotCalculated,
        Failed,
        Calculated
    };

    SourcePositions m_sourcePositions;
    SourcePositionsState m_sourcePositionsState;

public:
    JSCStackFrame(JSC::VM& vm, const JSC::StackFrame& frame);

    const JSC::StackFrame& stackFrame() const { return *m_stackFrame; }
    JSC::JSCell* callee() const { return m_callee; }
    JSC::CodeBlock* codeBlock() const { return m_codeBlock; }

    intptr_t sourceID() const;
    JSC::JSString* sourceURL();
    JSC::JSString* functionName();

    bool isFunctionOrEval() const { return m_isFunctionOrEval; }
    bool isAsync() const { return m_isAsync; }

    bool hasBytecodeIndex() const { return (m_bytecodeIndex.offset() != UINT_MAX) && !m_isWasmFrame; }

    // Returns null if can't retrieve the source positions
    SourcePositions* getSourcePositions();

    bool isEval()
    {
        if (m_codeBlock) {
            if (m_codeBlock->codeType() == JSC::EvalCode) {
                return true;
            }
            auto* executable = m_codeBlock->ownerExecutable();
            if (!executable) {
                return false;
            }

            switch (executable->evalContextType()) {
            case JSC::EvalContextType::None: {
                return false;
            }
            case JSC::EvalContextType::FunctionEvalContext:
            case JSC::EvalContextType::InstanceFieldEvalContext:
                return true;
            }
        }

        if (m_callee && m_callee->inherits<JSC::JSFunction>()) {
            auto* function = uncheckedDowncast<JSC::JSFunction>(m_callee);
            if (function->isHostFunction()) {
                return false;
            }
        }

        return false;
    }
    bool isConstructor() const
    {
        return m_codeBlock && (JSC::CodeSpecializationKind::CodeForConstruct == m_codeBlock->specializationKind());
    }

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

class JSCStackTrace {
private:
    WTF::Vector<JSCStackFrame> m_frames;

public:
    JSCStackTrace()
    {
    }

    JSCStackTrace(WTF::Vector<JSCStackFrame>&& frames)
        : m_frames(WTF::move(frames))
    {
    }

    size_t size() const { return m_frames.size(); }
    JSCStackFrame& at(size_t i) { return m_frames.at(i); }

    // Drops private-visibility frames (present when Options::showPrivateScriptsInStackTraces() is on), so the result does not index like existingFrames.
    static JSCStackTrace fromExisting(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& existingFrames);

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

enum class FinalizerSafety {
    NotInFinalizer,
    MustNotTriggerGC,
};

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
String functionName(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* callee);
String functionName(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, const JSC::StackFrame& frame, FinalizerSafety, unsigned int* flags);

}
