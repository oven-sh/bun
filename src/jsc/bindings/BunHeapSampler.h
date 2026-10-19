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

// The sampling heap profiler behind HeapProfiler.startSampling and worker.startHeapProfile, one per VM on
// JSVMClientData. JSC picks the allocations; this attributes them to JS stacks and emits V8's SamplingHeapProfile.
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
        RefPtr<JSC::SourceProvider> provider; // Null for (root) and the pseudo nodes.
        unsigned line { 0 }; // 1-based, as JSC reports the function's first line; 0 for none.
        unsigned column { 0 };
        unsigned parent { 0 };
        unsigned sampleCount { 0 }; // Samples that are not void. A function node with none and no children is pruned.
        WTF::Vector<unsigned> children;
    };

    struct Sample {
        // The cell; null when nothing owns the bytes, deadCell once collected but kept, voidSample to drop.
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
    unsigned pseudoNode(unsigned& slot, ASCIILiteral name);
    void linkSampleToCell(unsigned index);
    unsigned takeSamplesOfCell(void*);
    void voidSampleAt(unsigned index);
    void compactSamples();
    void pruneNodes();

    JSC::VM& m_vm;
    Options m_options;
    WTF::Vector<Node> m_nodes;
    // (parent node + 1, source, first line, start column) of a function that allocated -> its node under that parent.
    WTF::HashMap<std::tuple<unsigned, JSC::SourceProvider*, unsigned, unsigned>, unsigned> m_nodeIndex;
    // Stackless picks go under these children of (root), as V8 puts them under "(JS)" and the like, so (root) itself
    // never has bytes of its own.
    unsigned m_jsPseudoNode { noSample };
    unsigned m_nativePseudoNode { noSample };
    WTF::Vector<Sample> m_samples; // Append-only between compactions: void entries are tombstones.
    unsigned m_voidSamples { 0 };
    // m_samples.size() after the last reconcile. A cell sampled before it survived that collection and is old, so an
    // eden collection cannot free it; the eden reconcile starts here.
    unsigned m_reconciledCount { 0 };
    WTF::HashMap<void*, unsigned> m_firstSampleOfCell;
    uint64_t m_lastOrdinal { 0 };
};

} // namespace Bun
