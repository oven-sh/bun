// Process-global Web Locks registry (navigator.locks / worker_threads.locks),
// shared across the main thread and every Worker, matching Node's process-wide
// LockManager (src/node_locks.cc).
//
// The registry holds plain data only (no JS values): lock/request bookkeeping
// lives here under one lock, while promises and user callbacks stay in each
// thread's internal/locks.ts module. Decisions for a context are only ever
// made on that context's own thread ("drain"); other threads are nudged with
// a posted task when state they care about changes. Grant/miss/steal outcomes
// reach JS through internal/locks.ts's exported onNativeEvent(type, id).

#pragma once

#include "root.h"

#include "ScriptExecutionContext.h"
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Vector.h>
#include <wtf/text/StringHash.h>
#include <wtf/text/WTFString.h>

namespace Zig {
class GlobalObject;
}

namespace WebCore {

class BunWebLocksRegistry {
public:
    static BunWebLocksRegistry& singleton();

    // Event types delivered to internal/locks.ts onNativeEvent(type, id).
    static constexpr int32_t GrantedEvent = 0;
    static constexpr int32_t MissEvent = 1;
    static constexpr int32_t StolenEvent = 2;

    // Called from ~ScriptExecutionContext on the context's own thread.
    // Fast no-op unless the registry has ever been used.
    static void contextDestroyed(ScriptExecutionContextIdentifier);

    uint64_t enqueue(ScriptExecutionContextIdentifier, const String& name, bool exclusive, bool steal, bool ifAvailable);
    void release(ScriptExecutionContextIdentifier, uint64_t id, const String& name);

    // Deliver pending steal notifications and grant/miss decisions for the
    // context owning `globalObject`, synchronously, then wake any other
    // context that can now make progress. Must run on that context's thread.
    void drain(JSC::JSGlobalObject*);

private:
    friend class WTF::NeverDestroyed<BunWebLocksRegistry>;
    BunWebLocksRegistry() = default;

    struct PendingRequest {
        uint64_t id;
        ScriptExecutionContextIdentifier contextId;
        String name;
        bool exclusive;
        bool steal;
        bool ifAvailable;
    };

    struct HeldLock {
        uint64_t id;
        ScriptExecutionContextIdentifier contextId;
        bool exclusive;
    };

    struct Event {
        int32_t type;
        uint64_t id;
    };

    bool dispatchEventsToJS(Zig::GlobalObject*, const Vector<Event>&);
    bool isGrantableLocked(const PendingRequest&) const WTF_REQUIRES_LOCK(m_lock);
    void commitGrantLocked(size_t pendingIndex, Vector<Event>& events) WTF_REQUIRES_LOCK(m_lock);
    bool takeDecisionLocked(ScriptExecutionContextIdentifier, Vector<Event>& events) WTF_REQUIRES_LOCK(m_lock);
    Vector<ScriptExecutionContextIdentifier> computeWakeTargetsLocked() WTF_REQUIRES_LOCK(m_lock);
    void purgeContextLocked(ScriptExecutionContextIdentifier) WTF_REQUIRES_LOCK(m_lock);
    void wakeContexts(Vector<ScriptExecutionContextIdentifier>&&);

    static std::atomic<bool> s_hasBeenUsed;

    WTF::Lock m_lock;
    std::atomic<uint64_t> m_nextId { 1 };
    Vector<PendingRequest> m_pending WTF_GUARDED_BY_LOCK(m_lock);
    HashMap<String, Vector<HeldLock>> m_held WTF_GUARDED_BY_LOCK(m_lock);
    // Stolen lock ids not yet delivered to their owner's thread.
    HashMap<ScriptExecutionContextIdentifier, Vector<uint64_t>> m_stolenToDeliver WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace WebCore

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsWebLocksEnqueueRequest);
JSC_DECLARE_HOST_FUNCTION(jsWebLocksDrain);
JSC_DECLARE_HOST_FUNCTION(jsWebLocksRelease);

} // namespace Bun
