#pragma once

// The frames on the stack, and stack traces.

#include "engine/api/Code.h"

namespace JSC {

// Of a stack trace that has been captured. Whoever has one keeps what it refers to alive.
class StackFrame {
public:
    JSCell* callee() const { return m_isWasm ? nullptr : m_calleeOrNames; }
    CodeBlock* codeBlock() const { return m_codeBlock; }
    template<typename Functor> void forEachCell(const Functor& functor) const
    {
        if (m_calleeOrNames)
            functor(m_calleeOrNames);
        if (m_codeBlock)
            functor(m_codeBlock);
    }

    bool isAsyncFrame() const { return m_isAsync; }
    bool isWasmFrame() const { return m_isWasm; }
    static constexpr bool isCompiledFrame() { return false; }
    static constexpr bool representsHostFunction() { return false; }

    // With a code block.
    CodeType codeType() const { return m_codeBlock->codeType(); }
    bool isConstructor() const { return m_codeBlock->isConstructor(); }
    bool isBuiltinFunction() const { return m_codeBlock->isBuiltinFunction(); }

    bool hasBytecodeIndex() const { return m_codeBlock; }
    BytecodeIndex bytecodeIndex() const { return BytecodeIndex(m_bytecodeOffset); }
    bool hasLineAndColumnInfo() const { return m_codeBlock; }
    LineColumn computeLineAndColumn() const
    {
        LineColumn position;
        Engine::stack_frame_position(*this, position);
        return position;
    }
    String sourceURL(VM& vm) const { return Engine::stack_frame_source_url(*this, vm); }
    // With that of the module.
    String wasmFunctionName(VM& vm) const { return Engine::stack_frame_wasm_function_name(*this, vm); }

private:
    static void checkLayout();

    JSCell* m_calleeOrNames;
    CodeBlock* m_codeBlock;
    uint32_t m_bytecodeOffset;
    bool m_isAsync;
    bool m_isWasm;
};

inline void StackFrame::checkLayout()
{
    ENGINE_CHECK_SIZE(StackFrame, sizeOfStackFrame);
    ENGINE_CHECK_OFFSET(StackFrame, m_codeBlock, StackFrame_code_block);
    ENGINE_CHECK_OFFSET(StackFrame, m_bytecodeOffset, StackFrame_bytecode_offset);
    ENGINE_CHECK_OFFSET(StackFrame, m_isAsync, StackFrame_is_async);
    ENGINE_CHECK_OFFSET(StackFrame, m_isWasm, StackFrame_is_wasm);
    ENGINE_CHECK_SIZE(Vector<StackFrame>, sizeOfStackTrace);
    using Frames = WTF::Detail::VectorStorage<StackFrame, 0>;
    ENGINE_CHECK_OFFSET(Frames, m_capacity, StackTrace_capacity);
    ENGINE_CHECK_OFFSET(Frames, m_size, StackTrace_length);
}

class StackVisitor {
    WTF_MAKE_NONCOPYABLE(StackVisitor);

public:
    class Frame {
    public:
        enum CodeType : uint8_t {
            Global = GlobalCode,
            Module = ModuleCode,
            Eval = EvalCode,
            Function = FunctionCode,
            Native,
            Wasm,
        };

        // Null for WebAssembly code.
        JSCell* callee() const { return m_frame.callee(); }
        CodeBlock* codeBlock() const { return m_frame.codeBlock(); }
        CodeType codeType() const
        {
            if (codeBlock())
                return static_cast<CodeType>(m_frame.codeType());
            return m_frame.isWasmFrame() ? Wasm : Native;
        }
        ImplementationVisibility implementationVisibility() const { return m_visibility; }
        bool hasLineAndColumnInfo() const { return m_frame.hasLineAndColumnInfo(); }
        LineColumn computeLineAndColumn() const { return m_frame.computeLineAndColumn(); }

    private:
        friend class StackVisitor;

        Frame(const StackFrame& frame, ImplementationVisibility visibility)
            : m_frame(frame)
            , m_visibility(visibility)
        {
        }

        const StackFrame& m_frame;
        ImplementationVisibility m_visibility;
    };

    // From `first` outwards, if that is a frame on the stack.
    template<typename Functor> static void visit(CallFrame* first, VM& vm, const Functor& functor)
    {
        auto visitFrame = [](const void* functor, StackFrame* frame, ImplementationVisibility visibility) {
            StackVisitor visitor(*frame, visibility);
            return (*static_cast<const Functor*>(functor))(visitor) == IterationStatus::Continue;
        };
        Engine::stack_visit(vm, first, visitFrame, &functor);
    }

    Frame* operator->() { return &m_frame; }

private:
    StackVisitor(const StackFrame& frame, ImplementationVisibility visibility)
        : m_frame(frame, visibility)
    {
    }

    Frame m_frame;
};

inline void Interpreter::getStackTrace(Vector<StackFrame>& results, size_t framesToSkip, size_t maxStackSize, const StackFrameFilter* filter)
{
    auto isWanted = [](const void* filter, StackFrame* frame) { return (*static_cast<const StackFrameFilter*>(filter))(*frame); };
    Engine::stack_trace_capture(vm(), results, framesToSkip, maxStackSize, isWanted, filter);
}

inline void Interpreter::getStackTraceOfAwaiters(JSPromise* promise, Vector<StackFrame>& results, size_t maxStackSize) { Engine::stack_trace_of_awaiters(promise, results, maxStackSize); }
inline bool Interpreter::isInsideSeveralResumedAsyncFunctions() { return Engine::vm_resumed_async_function_count(vm()) > 1; }

} // namespace JSC
