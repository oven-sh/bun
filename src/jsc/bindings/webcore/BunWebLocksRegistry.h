// Process-global Web Locks registry (navigator.locks / worker_threads.locks),
// shared across the main thread and every Worker like Node's LockManager
// (src/node_locks.cc). All lock state is plain data behind one WTF::Lock;
// promises and user callbacks stay in each thread's WebLocksClient
// (JSWebLocks.h). Decisions are committed under the lock at mutation time and
// the resulting granted/miss/stolen events are delivered through
// Bun::dispatchWebLockEvent on each owning context's thread (synchronously
// for the mutating context, via a posted task for the rest).
//
// Grantability is purely per-name, so each name keeps its own FIFO of waiting
// requests and processing a release pops the longest grantable prefix: a
// blocked request blocks everything queued behind it for that name, which is
// exactly the Web Locks grant order (https://w3c.github.io/web-locks/).

#pragma once

#include "root.h"

#include "ScriptExecutionContext.h"
#include <wtf/HashMap.h>
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

    // Event types delivered to Bun::dispatchWebLockEvent. NoEvent is only
    // used as request()'s "parked in the queue" immediate result.
    static constexpr int32_t NoEvent = -1;
    static constexpr int32_t GrantedEvent = 0;
    static constexpr int32_t MissEvent = 1;
    static constexpr int32_t StolenEvent = 2;

    // Called from ~ScriptExecutionContext on the context's own thread.
    // Fast no-op unless the registry has ever been used.
    static void contextDestroyed(ScriptExecutionContextIdentifier);

    // Decide a new request in one critical section. `immediateEvent` receives
    // this request's own outcome (GrantedEvent for an immediate grant or a
    // steal, MissEvent for an ifAvailable miss, NoEvent when it parked in the
    // queue) for the caller to dispatch after it has registered the returned
    // id; steal victims are notified on their own threads.
    uint64_t request(Zig::GlobalObject*, const String& name, bool exclusive, bool steal, bool ifAvailable, int32_t& immediateEvent);

    // Release a held lock, then grant whatever that unblocks.
    void release(Zig::GlobalObject*, uint64_t id, const String& name);

private:
    friend class WTF::NeverDestroyed<BunWebLocksRegistry>;
    BunWebLocksRegistry() = default;

    struct PendingRequest {
        uint64_t id;
        ScriptExecutionContextIdentifier contextId;
        bool exclusive;
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

    using EventsByContext = HashMap<ScriptExecutionContextIdentifier, Vector<Event>>;

    bool isGrantableLocked(const String& name, bool exclusive) const WTF_REQUIRES_LOCK(m_lock);
    void commitDecisionsForNameLocked(const String& name, EventsByContext&) WTF_REQUIRES_LOCK(m_lock);
    void markDirtyLocked(const String& name) WTF_REQUIRES_LOCK(m_lock);
    void purgeContextLocked(ScriptExecutionContextIdentifier) WTF_REQUIRES_LOCK(m_lock);
    bool deliverEvents(Zig::GlobalObject* selfGlobalObject, ScriptExecutionContextIdentifier self, EventsByContext&&);
    void processQueue(Zig::GlobalObject* selfGlobalObject);
    static bool dispatchEventsToJS(Zig::GlobalObject*, const Vector<Event>&);

    static std::atomic<bool> s_hasBeenUsed;

    WTF::Lock m_lock;
    uint64_t m_nextId WTF_GUARDED_BY_LOCK(m_lock) { 1 };
    HashMap<String, Vector<PendingRequest>> m_pending WTF_GUARDED_BY_LOCK(m_lock);
    HashMap<String, Vector<HeldLock>> m_held WTF_GUARDED_BY_LOCK(m_lock);
    // Names whose held set changed and whose queue should be re-examined.
    Vector<String> m_dirtyNames WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace WebCore
