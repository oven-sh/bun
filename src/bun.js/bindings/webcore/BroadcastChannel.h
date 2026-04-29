// BroadcastChannel is a thin EventTarget over the process-global
// BunBroadcastChannelRegistry.
//
// The registry is directly thread-safe; posting never bounces through the
// main thread. Each (message, subscriber) pair becomes one task on the
// subscriber's context — the HTML spec requires that same-event-loop
// subscribers observe messages in (message-major, creation-minor) order,
// which per-channel inbox batching would break. If cross-thread bursts ever
// need coalescing, the place to add it is a per-(context, name) inbox in the
// registry, not per-channel.

#pragma once

#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "ExceptionOr.h"
#include "ScriptExecutionContext.h"
#include <wtf/Forward.h>
#include <wtf/ThreadSafeWeakPtr.h>

namespace JSC {
class JSGlobalObject;
class JSValue;
}

namespace WebCore {

class SerializedScriptValue;

class BroadcastChannel final : public ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<BroadcastChannel>, public EventTarget, public ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(BroadcastChannel);

public:
    static Ref<BroadcastChannel> create(ScriptExecutionContext& context, const String& name)
    {
        return adoptRef(*new BroadcastChannel(context, name));
    }
    ~BroadcastChannel();

    using ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<BroadcastChannel>::ref;
    using ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<BroadcastChannel>::deref;

    String name() const { return m_name; }

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message);
    void close();
    bool isClosed() const { return m_state.load(std::memory_order_acquire) & Closed; }

    // Called on this channel's context thread with one message.
    void dispatchMessage(Ref<SerializedScriptValue>&&);

    bool hasPendingActivity() const;

    void jsRef(JSGlobalObject*);
    void jsUnref(JSGlobalObject*);

private:
    friend class BunBroadcastChannelRegistry;

    BroadcastChannel(ScriptExecutionContext&, const String& name);

    // EventTarget
    EventTargetInterface eventTargetInterface() const final { return BroadcastChannelEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final;
    void contextDestroyed() final;

    // State is a single atomic so the GC-thread hasPendingActivity() check
    // never takes a lock. Layout: bit 0 = Closed, high bits = count of
    // messages posted-but-not-yet-dispatched (keeps the channel alive until
    // its queued tasks run even if JS drops the last reference).
    enum State : uint64_t {
        Closed = 1ull << 0,
        QueuedShift = 8,
        QueuedOne = 1ull << QueuedShift,
    };

    const String m_name;
    const ScriptExecutionContextIdentifier m_contextId;

    std::atomic<uint64_t> m_state { 0 };

    bool m_hasRelevantEventListener { false };
    bool m_hasRef { false };
};

} // namespace WebCore
