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
    // Resolve subscribers to strong refs under the lock, then fan out
    // without holding it — postTaskTo takes the contexts-map lock and we
    // don't want to nest. Collecting straight into strong refs (rather
    // than copying the Subscriber vector and its ThreadSafeWeakPtrs) keeps
    // this to one CAS per target; inline capacity covers the common small
    // subscriber count without a heap allocation.
    Vector<std::pair<ScriptExecutionContextIdentifier, Ref<BroadcastChannel>>, 4> targets;
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
            if (RefPtr channel = sub.channel.get())
                targets.append({ sub.ctxId, channel.releaseNonNull() });
        }
    }

    // One task per (message, subscriber), queued in subscription order.
    // Same-context subscribers share a task queue, so this preserves the
    // spec-mandated (message-major, creation-minor) delivery order.
    for (auto& [ctxId, channel] : targets) {
        // Keep the channel alive for GC until the task runs.
        channel->m_state.fetch_add(BroadcastChannel::QueuedOne, std::memory_order_acq_rel);
        bool posted = ScriptExecutionContext::postTaskTo(ctxId, [channel = channel.copyRef(), message = message.copyRef()](ScriptExecutionContext&) mutable {
            channel->dispatchMessage(WTF::move(message));
        });
        if (!posted) {
            // Context is already gone; balance the count so a subsequent
            // close() doesn't leave the channel looking busy forever.
            channel->m_state.fetch_sub(BroadcastChannel::QueuedOne, std::memory_order_acq_rel);
        }
    }
}

} // namespace WebCore
