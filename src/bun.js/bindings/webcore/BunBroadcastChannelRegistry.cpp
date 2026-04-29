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
    // Snapshot under the lock so fan-out runs without holding it —
    // postTaskTo takes the contexts-map lock and we don't want to nest.
    Vector<Subscriber> snapshot;
    {
        Locker locker { m_lock };
        auto it = m_subscribers.find(name);
        if (it == m_subscribers.end())
            return;
        snapshot = it->value;
    }

    // One task per (message, subscriber), queued in subscription order.
    // Same-context subscribers share a task queue, so this preserves the
    // spec-mandated (message-major, creation-minor) delivery order.
    for (auto& sub : snapshot) {
        if (sub.identity == &source)
            continue;
        RefPtr channel = sub.channel.get();
        if (!channel)
            continue;
        // Keep the channel alive for GC until the task runs.
        channel->m_state.fetch_add(BroadcastChannel::QueuedOne, std::memory_order_acq_rel);
        ScriptExecutionContext::postTaskTo(sub.ctxId, [channel = channel.releaseNonNull(), message = message.copyRef()](ScriptExecutionContext&) mutable {
            channel->dispatchMessage(WTF::move(message));
        });
    }
}

} // namespace WebCore
