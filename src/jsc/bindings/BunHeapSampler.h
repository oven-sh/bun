#pragma once

#include "root.h"
#include <JavaScriptCore/AllocationSamplerClient.h>
#include <wtf/HashMap.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include <tuple>

#include <optional>

namespace JSC {
class CallFrame;
class JSGlobalObject;
class SourceProvider;
class VM;
}

namespace Bun {

// The sampling heap profiler behind HeapProfiler.startSampling and worker.startHeapProfile, one per VM on
// JSVMClientData. JSC picks the allocations; this attributes them to JS stacks and emits V8's SamplingHeapProfile.
class HeapSampler final : public JSC::AllocationSamplerClient {
    WTF_MAKE_TZONE_ALLOCATED(HeapSampler);

public:
    // The deepest tree a profile can hold: profileJSON builds and serializes it recursively.
    static constexpr unsigned maximumStackDepth = 1024;

    struct Options {
        double intervalBytes { 32768 };
        unsigned stackDepth { 128 }; // Clamped to maximumStackDepth.
        // A full collection before each profile, as V8 does for the inspector, so the profile holds what is live now.
        bool forceGC { true };
        bool includeObjectsCollectedByMajorGC { false };
        bool includeObjectsCollectedByMinorGC { false };
    };

    // (intervalBytes, stackDepth, forceGC, includeObjectsCollectedByMajorGC, includeObjectsCollectedByMinorGC) from
    // the arguments of a host function: a number >= 1, an int32 >= 0, three booleans. Throws otherwise.
    static std::optional<Options> optionsFromArguments(JSC::JSGlobalObject*, JSC::CallFrame*);

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
        RefPtr<JSC::SourceProvider> provider; // Null for (root), the pseudo nodes, and a released slot.
        unsigned id { 0 }; // The profile's node id, unique for the sampler's life while slots are reused; 0 once pruned.
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
    unsigned newNode(Node&&);
    unsigned pseudoNode(unsigned& slot, ASCIILiteral name);
    void linkSampleToCell(unsigned index);
    unsigned takeSamplesOfCell(void*);
    void voidSampleAt(unsigned index);
    void compactSamples();
    void pruneNodes();
    void releasePrunedNodes();

    JSC::VM& m_vm;
    Options m_options;
    WTF::Vector<Node> m_nodes;
    unsigned m_lastNodeId { 0 };
    // Pruned slots, unlinked from the tree but still holding their provider and name. Reconcile can run on the
    // collector thread, and a SourceProvider or an atom string may only be released on the JS thread, so the
    // release waits for the next record() or profileJSON(). Released slots are reused by newNode().
    WTF::Vector<unsigned> m_prunedNodes;
    WTF::Vector<unsigned> m_freeNodes;
    // (parent node + 1, source, first line, start column) of a function that allocated -> its node under that parent.
    WTF::HashMap<std::tuple<unsigned, JSC::SourceProvider*, unsigned, unsigned>, unsigned> m_nodeIndex;
    // Children of (root) for stackless picks, like V8's "(JS)", so (root) never has bytes of its own.
    unsigned m_jsPseudoNode { noSample };
    unsigned m_nativePseudoNode { noSample };
    WTF::Vector<Sample> m_samples; // Append-only between compactions: void entries are tombstones.
    unsigned m_voidSamples { 0 };
    // m_samples.size() after the last reconcile: an older sample is of an old cell, which an eden collection keeps.
    unsigned m_reconciledCount { 0 };
    WTF::HashMap<void*, unsigned> m_firstSampleOfCell;
    uint64_t m_lastOrdinal { 0 };
};

} // namespace Bun
