#pragma once

// What a program has run, where it spends its time and what it keeps in memory.

#include "engine/api/Code.h"

namespace JSC {

// The state is in Rust, which finds it through the VM.
class VMProfiler {
public:
    VM& vm() const { return Engine::fieldAt<VM>(this, 0); }
};

// Both ends are part of it.
struct BasicBlockRange {
    int m_startOffset;
    int m_endOffset;
    bool m_hasExecuted;
    bool m_isInLoopHeader { false };
    size_t m_executionCount;
};
ENGINE_CHECK_SIZE(BasicBlockRange, sizeOfBlockRange);
ENGINE_CHECK_OFFSET(BasicBlockRange, m_endOffset, BlockRange_end);
ENGINE_CHECK_OFFSET(BasicBlockRange, m_hasExecuted, BlockRange_has_executed);
ENGINE_CHECK_OFFSET(BasicBlockRange, m_isInLoopHeader, BlockRange_is_in_loop_header);
ENGINE_CHECK_OFFSET(BasicBlockRange, m_executionCount, BlockRange_execution_count);

// A part of a source that is entered from elsewhere. Both ends are part of it.
struct CodeRange {
    enum class Kind : uint8_t {
        Function = Engine::CodeRangeKind::Function,
        StaticBlock = Engine::CodeRangeKind::StaticBlock,
    };

    unsigned start;
    unsigned end;
    Kind kind;
    bool hasExecuted;
};
ENGINE_CHECK_SIZE(CodeRange, sizeOfCodeRange);
ENGINE_CHECK_OFFSET(CodeRange, end, CodeRange_end);
ENGINE_CHECK_OFFSET(CodeRange, kind, CodeRange_kind);
ENGINE_CHECK_OFFSET(CodeRange, hasExecuted, CodeRange_has_executed);

class ControlFlowProfiler : public VMProfiler {
public:
    // Whether a block has the text of the blocks and functions that are inside it.
    enum class Gaps : bool { Without,
        With };

    Vector<BasicBlockRange> basicBlocks(SourceID, Gaps = Gaps::Without) const;
    Vector<CodeRange> codeRanges(SourceID) const;
    // Those of the code that is alive.
    Vector<Ref<SourceProvider>> sourceProviders() const;
};

// For good, whatever a frontend of the inspector asks for.
inline void VM::enableControlFlowProfiler() { Engine::coverage_enable(*this); }
inline ControlFlowProfiler* VM::controlFlowProfiler() { return Engine::coverage_is_enabled(*this) ? reinterpret_cast<ControlFlowProfiler*>(this) : nullptr; }

class HeapProfiler : public VMProfiler {
public:
    bool hasSnapshot() const { return Engine::heap_profiler_has_snapshot(vm()); }
    void clearSnapshots() { Engine::heap_profiler_clear_snapshots(vm()); }
};

inline HeapProfiler& VM::ensureHeapProfiler() { return *heapProfiler(); }
inline HeapProfiler* VM::heapProfiler() { return reinterpret_cast<HeapProfiler*>(this); }

class HeapSnapshotBuilder {
public:
    enum SnapshotType : bool { InspectorSnapshot,
        GCDebuggingSnapshot };

    explicit HeapSnapshotBuilder(HeapProfiler& profiler, SnapshotType type = InspectorSnapshot)
        : m_vm(profiler.vm())
        , m_type(type)
    {
    }

    void buildSnapshot() { m_json = Engine::heap_snapshot(m_vm, m_type == GCDebuggingSnapshot); }
    // Null if it is too long.
    String json() { return WTF::move(m_json); }

private:
    VM& m_vm;
    SnapshotType m_type;
    String m_json;
};

class BunV8HeapSnapshotBuilder {
public:
    explicit BunV8HeapSnapshotBuilder(HeapProfiler& profiler)
        : m_vm(profiler.vm())
    {
    }

    // Null if it is too long.
    String json() { return Engine::heap_v8_snapshot(m_vm); }
    // UTF-8. Empty if there is no memory for it.
    MallocSpan<uint8_t> jsonBytes()
    {
        size_t length;
        uint8_t* bytes = Engine::heap_v8_snapshot_bytes(m_vm, length);
        return adoptMallocSpan(std::span { bytes, length });
    }

private:
    VM& m_vm;
};

// Of all tiers and threads. Zero without `reportTotalCompileTimes`.
inline Seconds totalCompileTime() { return Seconds(Engine::total_compile_seconds()); }

class SamplingProfiler : public VMProfiler {
public:
    struct StackFrame {
        SourceProvider* sourceProvider() const
        {
            auto* script = dynamicDowncast<ScriptExecutable>(executable);
            return script ? script->sourceProvider() : nullptr;
        }

        String displayName;
        // Null for what is not a function or a script.
        ExecutableBase* executable;
        // -1 and the largest number if there is no source.
        int functionStartLine;
        unsigned functionStartColumn;
        std::optional<LineColumn> position;
    };

    struct StackTrace {
        MonotonicTime timestamp;
        // The innermost comes first.
        Vector<StackFrame> frames;
    };

    void setTimingInterval(Seconds interval) { Engine::sampling_profiler_set_interval(vm(), interval.microseconds()); }
    void start() { Engine::sampling_profiler_start(vm()); }
    void pause() { Engine::sampling_profiler_pause(vm()); }
    void clearData() { Engine::sampling_profiler_clear(vm()); }
    // Nothing keeps the executables alive.
    Vector<StackTrace> releaseStackTraces(const DeferGC&);
    // Releases them too. Null if it is too long.
    String stackTracesAsJSON() { return Engine::sampling_profiler_take_traces_as_json(vm()); }
    String topFunctionsReport() { return Engine::sampling_profiler_top_functions(vm()); }
    String topBytecodesReport() { return Engine::sampling_profiler_top_bytecodes(vm()); }
};

inline SamplingProfiler& VM::ensureSamplingProfiler() { return *reinterpret_cast<SamplingProfiler*>(this); }
// Null until it has been used.
inline SamplingProfiler* VM::samplingProfiler() { return Engine::sampling_profiler_exists(*this) ? reinterpret_cast<SamplingProfiler*>(this) : nullptr; }

} // namespace JSC
