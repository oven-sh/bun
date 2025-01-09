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

/* JSCStackFrame is an alternative to JSC::StackFrame, which provides the following advantages\changes:
 * - Also hold the call frame (ExecState). This is mainly used by CallSite to get "this value".
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
    JSC::JSCell* m_callee { nullptr };

    // May be null
    JSC::CallFrame* m_callFrame;

    // May be null
    JSC::CodeBlock* m_codeBlock { nullptr };
    JSC::BytecodeIndex m_bytecodeIndex;

    // Lazy-initialized
    WTF::String m_sourceURL;
    WTF::String m_functionName;
    WTF::String m_typeName;

    // m_wasmFunctionIndexOrName has meaning only when m_isWasmFrame is set
    JSC::Wasm::IndexOrName m_wasmFunctionIndexOrName;
    bool m_isWasmFrame = false;

    bool m_isFunctionOrEval = false;

    enum class SourcePositionsState {
        NotCalculated,
        Failed,
        Calculated
    };

    SourcePositions m_sourcePositions;
    SourcePositionsState m_sourcePositionsState;

public:
    JSCStackFrame(JSC::VM& vm, JSC::StackVisitor& visitor);
    JSCStackFrame(JSC::VM& vm, const JSC::StackFrame& frame);

    JSC::JSCell* callee() const { return m_callee; }
    JSC::CallFrame* callFrame() const { return m_callFrame; }
    JSC::CodeBlock* codeBlock() const { return m_codeBlock; }

    intptr_t sourceID() const;
    JSC::JSString* sourceURL();
    JSC::JSString* functionName();
    JSC::JSString* typeName();

    bool isFunctionOrEval() const { return m_isFunctionOrEval; }

    bool hasBytecodeIndex() const { return (m_bytecodeIndex.offset() != UINT_MAX) && !m_isWasmFrame; }
    JSC::BytecodeIndex bytecodeIndex() const
    {
        return m_bytecodeIndex;
    }

    // Returns null if can't retrieve the source positions
    SourcePositions* getSourcePositions();

    bool isWasmFrame() const { return m_isWasmFrame; }
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
            auto* function = jsCast<JSC::JSFunction*>(m_callee);
            if (function->isHostFunction()) {
                return false;
            }
        }

        return false;
    }
    bool isConstructor() const
    {
        return m_codeBlock && (JSC::CodeForConstruct == m_codeBlock->specializationKind());
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

    ALWAYS_INLINE String retrieveTypeName();

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
        : m_frames(WTFMove(frames))
    {
    }

    size_t size() const { return m_frames.size(); }
    bool isEmpty() const { return m_frames.isEmpty(); }
    JSCStackFrame& at(size_t i) { return m_frames.at(i); }

    WTF::Vector<JSCStackFrame>&& frames() { return WTFMove(m_frames); }

    static JSCStackTrace fromExisting(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& existingFrames);

    /* This is based on JSC::Interpreter::getStackTrace, but skips native (non js and not wasm)
     * frames, which is what v8 does. Note that we could have just called JSC::Interpreter::getStackTrace
     * and and filter it later (or let our callers filter it), but that would have been both inefficient, and
     * problematic with the requested stack size limit (as it should only refer to the non-native frames,
     * thus we would have needed to pass a large limit to JSC::Interpreter::getStackTrace, and filter out
     * maxStackSize non-native frames).
     *
     * Return value must remain stack allocated. */
    static JSCStackTrace captureCurrentJSStackTrace(Zig::GlobalObject* globalObject, JSC::CallFrame* callFrame, size_t frameLimit, JSC::JSValue caller);
    static void getFramesForCaller(JSC::VM& vm, JSC::CallFrame* callFrame, JSC::JSCell* owner, JSC::JSValue caller, WTF::Vector<JSC::StackFrame>& stackTrace, size_t stackTraceLimit);

    /* In JSC, JSC::Exception points to the actual value that was thrown, usually
     * a JSC::ErrorInstance (but could be any JSValue). In v8, on the other hand,
     * TryCatch::Exception returns the thrown value, and we follow the same rule in jscshim.
     * This is a problem, since JSC::Exception is the one that holds the stack trace.
     * ErrorInstances might also hold the stack trace (until the error properties are
     * "materialized" and it is no longer needed). So, to try to get the stack trace for a thrown JSValue,
     * we'll try two things:
     * - If the current JSC (vm) exception points to our value, it means our value is probably the current
     *   exception and we could take the stack trace from the vm's current JSC::Exception. The downside
     *   of doing this is that we'll get the last stack trace of the thrown value, meaning that if the value
     *   was thrown, stored in the api and than re-thrown, we'll get the latest stack trace and not the one
     *   that was available when we stored it. For now it'll do.
     * - If that failed and our thrown value is a JSC::ErrorInstance, we'll try to use it's stack trace,
     *   if it currently has one.
     *
     * Return value must remain stack allocated */
    static JSCStackTrace getStackTraceForThrownValue(JSC::VM& vm, JSC::JSValue thrownValue);

private:
    JSCStackTrace(WTF::Vector<JSCStackFrame>& frames)
        : m_frames(WTFMove(frames))
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
String functionName(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* callee);
String functionName(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, const JSC::StackFrame& frame, bool isInFinalizer, unsigned int* flags);

}
