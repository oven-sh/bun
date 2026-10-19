/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/WasmIndexOrName.h>
#include <wtf/FixedVector.h>
#include <wtf/OptionSet.h>
#include <wtf/TZoneMalloc.h>

#include "ZigGlobalObject.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

// One frame of a stack trace without the cells it was captured with, so it stays good after they are collected.
// error.stack and a CallSite are made from it, for a frame that is still alive too. The two do not show the same
// functionName, position and sourceURL for every frame: a wasm function has a name only in a CallSite, a CallSite
// is at the `new` of `new X()`, and it names a source for native code.
struct DetachedStackFrame {
    enum class Flag : uint16_t {
        HasPosition = 1 << 0,
        // mappedPosition, and mappedSourceURL unless it is null, are where the source map puts position in sourceURL.
        Mapped = 1 << 1,
        Async = 1 << 2,
        EvalCode = 1 << 3,
        FunctionCode = 1 << 4,
        BuiltinFunction = 1 << 5,
        Constructor = 1 << 6,
        // The frame is left out of the CallSites (isImplementationVisibilityPrivate).
        Private = 1 << 7,
        StrictCode = 1 << 8,
        CalleeIsFunction = 1 << 9,
        CallSiteEval = 1 << 10,
        CallSiteNative = 1 << 11,
        // The code has no source URL: sourceURL is what a CallSite shows in its place.
        NoSourceURL = 1 << 12,
    };

    WTF::String functionName;
    WTF::String sourceURL;
    WTF::String mappedSourceURL;
    JSC::LineColumn position;
    JSC::LineColumn mappedPosition;
    // The realm of the frame's function. It is only compared, never read: the source map is for a reader of that realm.
    const JSC::JSGlobalObject* realm { nullptr };
    JSC::SourceID sourceID { JSC::noSourceID };
    OptionSet<Flag> flags;
};

// The frame as error.stack shows it. Allocates nothing in the JS heap.
DetachedStackFrame detachStackFrame(JSC::VM&, const JSC::StackFrame&);

// Whether there is something to ask the source map.
bool hasPositionInSource(const DetachedStackFrame&);
// Asks the source map, once for all of them, where each of these frames is in its source.
void mapDetachedStackFrames(JSC::VM&, std::span<DetachedStackFrame* const>);

// What a collection keeps of an unread stack trace when it frees one of the trace's functions or code blocks
// (JSC::ErrorInstance::reconcileWeakReferencesAtGCEnd). The stack is formatted from it when it is first needed.
class DetachedFrames final : public JSC::DetachedStackTrace {
    WTF_MAKE_TZONE_ALLOCATED(DetachedFrames);

public:
    // Runs at the end of a collection: it allocates nothing in the JS heap and runs no script.
    DetachedFrames(JSC::VM&, const WTF::Vector<JSC::StackFrame>&);

    // As error.stack reads them.
    std::span<const DetachedStackFrame> frames() const LIFETIME_BOUND { return m_frames.span(); }
    const DetachedStackFrame& callSiteFrame(size_t index) const LIFETIME_BOUND;
    // JSC::StackFrame::sourceURL() of the first frame.
    const WTF::String& topFrameSourceURL() const LIFETIME_BOUND { return m_topFrameSourceURL; }

    size_t sizeInBytes() const final;

private:
    WTF::FixedVector<DetachedStackFrame> m_frames;
    // By index in m_frames, the frames that a CallSite reads differently.
    WTF::Vector<std::pair<unsigned, DetachedStackFrame>> m_callSiteFrames;
    WTF::String m_topFrameSourceURL;
};

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
 * - Helper functions like isEval.
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
    const JSC::StackFrame* m_stackFrame;
    JSC::JSCell* m_callee { nullptr };

    // May be null
    JSC::CodeBlock* m_codeBlock { nullptr };
    JSC::BytecodeIndex m_bytecodeIndex;

    // m_wasmFunctionIndexOrName has meaning only when m_isWasmFrame is set
    JSC::Wasm::IndexOrName m_wasmFunctionIndexOrName;
    bool m_isWasmFrame = false;

    enum class SourcePositionsState {
        NotCalculated,
        Failed,
        Calculated
    };

    SourcePositions m_sourcePositions;
    SourcePositionsState m_sourcePositionsState;

public:
    JSCStackFrame(JSC::VM& vm, const JSC::StackFrame& frame);

    intptr_t sourceID() const;

    // The frame as a CallSite shows it. Allocates nothing in the JS heap.
    DetachedStackFrame detach();

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
            auto* function = uncheckedDowncast<JSC::JSFunction>(m_callee);
            if (function->isHostFunction()) {
                return false;
            }
        }

        return false;
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
public:
    static void getFramesForCaller(JSC::VM& vm, JSC::CallFrame* callFrame, JSC::JSCell* owner, JSC::JSValue caller, WTF::Vector<JSC::StackFrame>& stackTrace, size_t stackTraceLimit);
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

String functionName(JSC::VM& vm, JSC::CodeBlock* codeBlock);
String functionName(JSC::VM& vm, JSC::JSObject* callee);
String functionName(JSC::VM& vm, const JSC::StackFrame& frame);

}
