#pragma once

#include "v8.h"
#include "V8Local.h"
#include <vector>

namespace v8 {

class String;
class Isolate;

// v8-profiler.h: sampled allocation profile returned by
// HeapProfiler::GetAllocationProfile(). Caller owns the returned pointer.
class AllocationProfile {
public:
    struct Allocation {
        size_t size;
        unsigned int count;
    };

    struct Node {
        Local<String> name;
        Local<String> script_name;
        int script_id;
        int start_position;
        int line_number;
        int column_number;
        uint32_t node_id;
        std::vector<Node*> children;
        std::vector<Allocation> allocations;
    };

    struct Sample {
        uint32_t node_id;
        size_t size;
        unsigned int count;
        uint64_t sample_id;
        bool is_live;
    };

    virtual Node* GetRootNode() = 0;
    virtual const std::vector<Sample>& GetSamples() = 0;

    virtual ~AllocationProfile() = default;

    static const int kNoLineNumberInfo = 0;
    static const int kNoColumnNumberInfo = 0;
};

class HeapProfiler {
public:
    enum SamplingFlags {
        kSamplingNoFlags = 0,
        kSamplingForceGC = 1 << 0,
        kSamplingIncludeObjectsCollectedByMajorGC = 1 << 1,
        kSamplingIncludeObjectsCollectedByMinorGC = 1 << 2,
    };

    BUN_EXPORT bool StartSamplingHeapProfiler(uint64_t sample_interval = 512 * 1024,
        int stack_depth = 16,
        SamplingFlags flags = kSamplingNoFlags);

    BUN_EXPORT void StopSamplingHeapProfiler();

    BUN_EXPORT AllocationProfile* GetAllocationProfile();

private:
    HeapProfiler();
    ~HeapProfiler();
    HeapProfiler(const HeapProfiler&);
    HeapProfiler& operator=(const HeapProfiler&);
};

} // namespace v8
