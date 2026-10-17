#pragma once

#include "root.h"
#include <JavaScriptCore/AllocationSamplerClient.h>
#include <wtf/HashMap.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include <tuple>

namespace JSC {
class SourceProvider;
class VM;
}

namespace Bun {

// The allocation-sampling heap profiler behind HeapProfiler.startSampling
// (node:inspector) and worker.startHeapProfile (node:worker_threads). One per
// VM, owned by JSVMClientData. JSC picks the allocations
// (Heap::startAllocationSampling); this attributes each pick to the JS stack
// that allocated, weighs it, and follows it through GC so the profile can
// keep what has been collected (includeObjectsCollectedBy*GC) or drop it.
//
// profileJSON() has the shape of V8's SamplingHeapProfile: a tree of
// {callFrame, selfSize, id, children} from a "(root)" node, and samples
// [{size, nodeId, ordinal}]. Sizes are integers, as V8 reports them: each
// sample counts bytes * round(1 / (1 - exp(-bytes / interval))).
class HeapSampler final : public JSC::AllocationSamplerClient {
    WTF_MAKE_TZONE_ALLOCATED(HeapSampler);

public:
    struct Options {
        double intervalBytes { 32768 };
        unsigned stackDepth { 128 };
        // A full collection before each profile, as V8 does for the inspector, so the profile holds what is live now.
        bool forceGC { true };
        bool includeObjectsCollectedByMajorGC { false };
        bool includeObjectsCollectedByMinorGC { false };
    };

    // The VM's sampler, or null when sampling is off.
    static HeapSampler* get(JSC::VM&);
    // Starts sampling. Returns false, and changes nothing, when sampling is already on.
    static bool start(JSC::VM&, const Options&);
    // Turns sampling off and frees the samples.
    static void stop(JSC::VM&);

    HeapSampler(JSC::VM&, const Options&);
    ~HeapSampler() final;

    WTF::String profileJSON();

    void didSampleAllocation(JSC::HeapCell*, size_t bytes) final;
    void didSampleExtraMemory(const JSC::JSCell* owner, size_t bytes) final;
    void didRelocateCell(JSC::HeapCell* from, JSC::HeapCell* to) final;
    void reconcileSampledCells(JSC::CollectionScope) final;

private:
    static constexpr unsigned noSample = std::numeric_limits<unsigned>::max();

    struct Node {
        WTF::String functionName;
        RefPtr<JSC::SourceProvider> provider;
        unsigned line { 0 }; // 1-based, as JSC reports the function's first line; 0 for none.
        unsigned column { 0 };
        WTF::Vector<unsigned> children;
    };

    struct Sample {
        // The cell, or: null when nothing owns the bytes (they never die), deadCell once the cell has been collected
        // and the profile keeps collected allocations, voidSample for a pick that was not an allocation (the copy a
        // relocation made), dropped at the next reconcile.
        void* cell;
        unsigned node;
        unsigned nextOfSameCell;
        uint64_t ordinal;
        double size;
    };
    static void* const deadCell;
    static void* const voidSample;

    void record(void* cell, size_t bytes);
    unsigned nodeForCurrentStack();
    void linkSampleToCell(unsigned index);
    void relinkSamplesToCells();
    unsigned takeSamplesOfCell(void*);

    JSC::VM& m_vm;
    Options m_options;
    WTF::Vector<Node> m_nodes;
    // (parent node + 1, source, first line, start column) of a function that allocated -> its node under that parent.
    WTF::HashMap<std::tuple<unsigned, JSC::SourceProvider*, unsigned, unsigned>, unsigned> m_nodeIndex;
    WTF::Vector<Sample> m_samples;
    WTF::HashMap<void*, unsigned> m_firstSampleOfCell;
    uint64_t m_lastOrdinal { 0 };
};

} // namespace Bun
