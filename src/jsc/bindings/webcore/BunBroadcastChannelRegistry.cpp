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
    // Snapshot subscribers under the lock, then fan out without holding it
    // — postTaskTo takes the contexts-map lock and we don't want to nest.
    //
    // We deliberately carry ThreadSafeWeakPtr (not Ref) across the fan-out
    // and resolve it INSIDE the posted task on the target thread. Holding a
    // strong ref here can make this thread the last owner if the target is
    // a worker that tears down concurrently (its JS wrapper's deref + its
    // queued task's deref both happen on the worker thread, leaving our
    // local ref as the last), and ~BroadcastChannel → ~EventTarget →
    // EventListenerMap::clear() would then fire on the wrong thread and
    // trip releaseAssertOrSetThreadUID.
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
            targets.append({ sub.ctxId, sub.channel });
        }
    }

    // One task per (message, subscriber), queued in subscription order.
    // Same-context subscribers share a task queue, so this preserves the
    // spec-mandated (message-major, creation-minor) delivery order.
    for (auto& [ctxId, weakChannel] : targets) {
        ScriptExecutionContext::postTaskTo(ctxId, [weakChannel, message = message.copyRef()](ScriptExecutionContext&) mutable {
            // Resolve on the target thread so any last deref happens here.
            if (RefPtr channel = weakChannel.get())
                channel->dispatchMessage(WTF::move(message));
        });
    }
}

} // namespace WebCore
