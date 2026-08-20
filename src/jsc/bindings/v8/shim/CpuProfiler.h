#pragma once

#include "root.h"
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>
#include <memory>

namespace v8 {

class Isolate;

namespace shim {

// Plain-C++ (non-JSCell) backing storage for v8::CpuProfileNode. Instances are
// owned by CpuProfileImpl::m_nodes and handed out as raw pointers
// reinterpret_cast'd to `const v8::CpuProfileNode*`.
struct CpuProfileNodeImpl {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(CpuProfileNodeImpl);

    struct LineTick {
        int line;
        unsigned hit_count;
    };

    unsigned id { 0 };
    // UTF-8 copies kept for the profile's lifetime so GetFunctionNameStr()/
    // GetScriptResourceNameStr() can return stable `const char*`.
    WTF::CString functionName;
    WTF::CString scriptResourceName;
    int scriptId { 0 };
    // 1-based; 0 == kNoLineNumberInfo / kNoColumnNumberInfo.
    int lineNumber { 0 };
    int columnNumber { 0 };
    unsigned hitCount { 0 };
    WTF::Vector<CpuProfileNodeImpl*> children;
    WTF::Vector<LineTick> lineTicks;
};

// Plain-C++ backing storage for v8::CpuProfile. Heap-allocated by
// CpuProfilerImpl::stop() and freed by v8::CpuProfile::Delete().
struct CpuProfileImpl {
    // Owns every node in the tree (including the root). Child/sample pointers
    // borrow from here.
    WTF::Vector<std::unique_ptr<CpuProfileNodeImpl>> m_nodes;
    CpuProfileNodeImpl* m_root { nullptr };
    WTF::Vector<CpuProfileNodeImpl*> m_samples;
    WTF::Vector<int64_t> m_sampleTimestamps;
    int64_t m_startTime { 0 };
    int64_t m_endTime { 0 };
};

// Plain-C++ backing storage for v8::CpuProfiler. Heap-allocated by
// v8::CpuProfiler::New() and freed by v8::CpuProfiler::Dispose().
struct CpuProfilerImpl {
    struct Session {
        uint32_t id;
        int64_t startTime;
        bool recordSamples;
    };

    explicit CpuProfilerImpl(Isolate* isolate)
        : m_isolate(isolate)
    {
    }

    uint32_t start(bool recordSamples);
    CpuProfileImpl* stop(uint32_t id);

    Isolate* m_isolate;
    int m_samplingIntervalUs { 1000 };
    uint32_t m_nextId { 1 };
    WTF::Vector<Session> m_sessions;
};

} // namespace shim
} // namespace v8
