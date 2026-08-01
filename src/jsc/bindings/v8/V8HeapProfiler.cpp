#include "V8HeapProfiler.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "V8String.h"
#include "shim/GlobalInternals.h"

#include <JavaScriptCore/JSString.h>

// node/v8-profiler.h is not reachable via real_v8.h (v8.h does not include it),
// so ASSERT_V8_TYPE_LAYOUT_MATCHES cannot be used for the types below. Their
// signatures are hand-matched against v8-profiler.h so the exported mangled
// names line up with what native addons import.

namespace v8 {

namespace shim {

// Concrete AllocationProfile returned to callers. Owns its root Node; children
// borrow from m_nodes.
class AllocationProfileImpl final : public AllocationProfile {
public:
    AllocationProfileImpl(Isolate* isolate)
    {
        auto& vm = isolate->vm();
        auto* handleScope = isolate->currentHandleScope();
        Local<String> empty = handleScope->createLocal<String>(vm, JSC::jsEmptyString(vm));
        m_root.name = empty;
        m_root.script_name = empty;
        m_root.script_id = 0;
        m_root.start_position = 0;
        m_root.line_number = AllocationProfile::kNoLineNumberInfo;
        m_root.column_number = AllocationProfile::kNoColumnNumberInfo;
        m_root.node_id = 1;
    }

    Node* GetRootNode() override { return &m_root; }
    const std::vector<Sample>& GetSamples() override { return m_samples; }

private:
    Node m_root;
    std::vector<Sample> m_samples;
};

// Plain-C++ backing storage for v8::HeapProfiler. One instance per Isolate,
// lazily created by Isolate::GetHeapProfiler() and reinterpret_cast'd to the
// opaque v8::HeapProfiler* handed to callers.
struct HeapProfilerImpl {
    explicit HeapProfilerImpl(Isolate* isolate)
        : m_isolate(isolate)
    {
    }

    Isolate* m_isolate;
    bool m_samplingActive { false };
};

} // namespace shim

static inline shim::HeapProfilerImpl* toImpl(HeapProfiler* p)
{
    return reinterpret_cast<shim::HeapProfilerImpl*>(p);
}

bool HeapProfiler::StartSamplingHeapProfiler(uint64_t, int, SamplingFlags)
{
    // JSC has no allocation-sampling profiler hook; record the state so the
    // Start/Stop/Get contract matches V8 (false if already running).
    auto* impl = toImpl(this);
    if (impl->m_samplingActive)
        return false;
    impl->m_samplingActive = true;
    return true;
}

void HeapProfiler::StopSamplingHeapProfiler()
{
    toImpl(this)->m_samplingActive = false;
}

AllocationProfile* HeapProfiler::GetAllocationProfile()
{
    auto* impl = toImpl(this);
    if (!impl->m_samplingActive)
        return nullptr;
    return new shim::AllocationProfileImpl(impl->m_isolate);
}

HeapProfiler* Isolate::GetHeapProfiler()
{
    if (!m_heapProfiler)
        m_heapProfiler = new shim::HeapProfilerImpl(this);
    return reinterpret_cast<HeapProfiler*>(m_heapProfiler);
}

} // namespace v8
