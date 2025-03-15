#pragma once

#include "root.h"

namespace JSC {
class VM;
class JSObject;
}

namespace WTF {
class MonotonicTime;
}

namespace Bun {

class EdenGCActivityCallback;
class FullGCActivityCallback;

// Implemented in C++ to properly integrate with JSC's FullGCActivityCallback & EdenGCActivityCallback
// The lifetime of this is tied to the JSVMClientData instance, which is tied to the JSC::VM instance
class GCController {
public:
    GCController(JSC::VM&, void* bunVM, JSC::HeapType heapType);
    ~GCController();

    // Configure the Eden GC for smaller, more frequent collections
    void configureEdenGC(bool enabled, unsigned intervalMs = 30);

    // Configure the Full GC for larger, less frequent collections
    void configureFullGC(bool enabled, unsigned intervalMs = 300);

    // Utility method to check for pending GC work
    bool hasPendingGCWork() const;

    // Check if the system is under memory pressure
    bool checkMemoryPressure() const;

    // Call this to maybe schedule a GC to run sometimes.
    void performOpportunisticGC();

    // Metrics
    class Metrics {
    public:
        size_t incrementalSweepCount = 0;
        size_t edenGCCount = 0;
        size_t fullGCCount = 0;
        size_t blocksSwept = 0;
        double totalSweepTimeMs = 0;
        double maxSweepTimeMs = 0;

        void reset()
        {
            incrementalSweepCount = 0;
            edenGCCount = 0;
            fullGCCount = 0;
            blocksSwept = 0;
            totalSweepTimeMs = 0;
            maxSweepTimeMs = 0;
        }
    };

    Metrics& metrics() { return m_metrics; }
    void* bunVM = nullptr;

    bool hasMoreEventLoopWorkToDo() const { return m_hasMoreEventLoopWorkToDo; }
    void setHasMoreEventLoopWorkToDo(bool hasMoreEventLoopWorkToDo) { m_hasMoreEventLoopWorkToDo = hasMoreEventLoopWorkToDo; }

private:
    JSC::VM& m_vm;
    Ref<EdenGCActivityCallback> m_edenCallback;
    Ref<FullGCActivityCallback> m_fullCallback;
    Metrics m_metrics = {};
    bool m_hasMoreEventLoopWorkToDo = false;
    size_t m_lastBlockBytesAllocated = 0;
    size_t m_hasStayedTheSameFor = 0;
};

JSC::JSObject* createGCStatsObject(JSC::VM& vm);

} // namespace Bun
