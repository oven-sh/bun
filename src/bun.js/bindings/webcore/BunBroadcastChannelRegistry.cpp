#include "config.h"
#include "BunBroadcastChannelRegistry.h"

#include "BroadcastChannel.h"
#include "SerializedScriptValue.h"
#include <wtf/Locker.h>
#include <wtf/NeverDestroyed.h>

namespace WebCore {

BunBroadcastChannelRegistry& BunBroadcastChannelRegistry::singleton()
{
    static NeverDestroyed<BunBroadcastChannelRegistry> registry;
    return registry.get();
}

void BunBroadcastChannelRegistry::subscribe(const String& name, ScriptExecutionContextIdentifier ctxId, BroadcastChannel& channel)
{
    Locker locker { m_lock };
    auto& list = m_subscribers.ensure(name.isolatedCopy(), [] { return Vector<Subscriber> {}; }).iterator->value;
    list.append(Subscriber { ctxId, ThreadSafeWeakPtr<BroadcastChannel> { channel }, &channel });
}

void BunBroadcastChannelRegistry::unsubscribe(const String& name, BroadcastChannel& channel)
{
    Locker locker { m_lock };
    auto it = m_subscribers.find(name);
    if (it == m_subscribers.end())
        return;
    it->value.removeFirstMatching([&](const Subscriber& s) {
        return s.identity == &channel;
    });
    if (it->value.isEmpty())
        m_subscribers.remove(it);
}

void BunBroadcastChannelRegistry::post(const String& name, BroadcastChannel& source, Ref<SerializedScriptValue>&& message)
{
    // Snapshot subscribers under the lock as (ctxId, weak) pairs, then fan
    // out without holding it — postTaskTo takes the contexts-map lock and we
    // don't want to nest.
    //
    // We deliberately do NOT take strong Refs on this thread.
    // BroadcastChannel owns thread-affine state (EventTarget's
    // EventListenerMap, the m_name String, ContextDestructionObserver
    // registration), so if a foreign-thread Ref turns out to be the last one
    // — which happens when a Worker is terminated while we're mid-post —
    // ~BroadcastChannel runs here and EventListenerMap::clear() asserts on
    // the thread mismatch. Instead, bump the queued-message count via the raw
    // identity pointer: unsubscribe() takes this same lock, so any channel
    // still in the list cannot be past close() in its destructor and the
    // pointer is valid for the duration of the locked section.
    Vector<std::pair<ScriptExecutionContextIdentifier, ThreadSafeWeakPtr<BroadcastChannel>>, 4> targets;
    {
        Locker locker { m_lock };
        auto it = m_subscribers.find(name);
        if (it == m_subscribers.end())
            return;
        // size()-1: the sender is always in the list and always skipped.
        // Fits the inline buffer exactly for up to 5 subscribers (1→4).
        if (auto n = it->value.size(); n > 1)
            targets.reserveInitialCapacity(n - 1);
        for (auto& sub : it->value) {
            if (sub.identity == &source)
                continue;
            sub.identity->m_state.fetch_add(BroadcastChannel::QueuedOne, std::memory_order_acq_rel);
            targets.append({ sub.ctxId, sub.channel });
        }
    }

    // One task per (message, subscriber), queued in subscription order.
    // Same-context subscribers share a task queue, so this preserves the
    // spec-mandated (message-major, creation-minor) delivery order. The task
    // upgrades the weak ref on the channel's own context thread, so the
    // resulting strong ref is created and dropped where ~BroadcastChannel is
    // allowed to run.
    for (auto& [ctxId, weak] : targets) {
        ScriptExecutionContext::postTaskTo(ctxId, [weak = WTF::move(weak), message = message.copyRef()](ScriptExecutionContext&) mutable {
            if (RefPtr channel = weak.get())
                channel->dispatchMessage(WTF::move(message));
        });
        // If postTaskTo returned false the context has been removed from the
        // map; ~ScriptExecutionContext will fire contextDestroyed() which
        // sets Closed, after which hasPendingActivity() ignores the queued
        // count, so the unbalanced fetch_add above is harmless. If the
        // channel is already gone (refcount hit zero while we held the lock),
        // the weak upgrade fails and the message is dropped.
    }
}

} // namespace WebCore
