#include "config.h"
#include "BunWebLocksRegistry.h"

#include "JSWebLocks.h"
#include "ZigGlobalObject.h"
#include <wtf/Locker.h>
#include <wtf/NeverDestroyed.h>

namespace WebCore {

std::atomic<bool> BunWebLocksRegistry::s_hasBeenUsed { false };

BunWebLocksRegistry& BunWebLocksRegistry::singleton()
{
    static NeverDestroyed<BunWebLocksRegistry> registry;
    return registry.get();
}

bool BunWebLocksRegistry::isGrantableLocked(const String& name, bool exclusive) const
{
    auto it = m_held.find(name);
    if (it == m_held.end())
        return true;
    if (exclusive)
        return false;
    for (auto& held : it->value) {
        if (held.exclusive)
            return false;
    }
    return true;
}

void BunWebLocksRegistry::markDirtyLocked(const String& name)
{
    if (!m_dirtyNames.contains(name))
        m_dirtyNames.append(name.isolatedCopy());
}

// Pop the longest grantable prefix of the name's queue: grants stop at the
// first request the current holders are incompatible with, and everything
// behind it keeps waiting, which is the Web Locks grant order.
void BunWebLocksRegistry::commitDecisionsForNameLocked(const String& name, EventsByContext& eventsByContext)
{
    auto it = m_pending.find(name);
    if (it == m_pending.end())
        return;
    auto& queue = it->value;

    size_t granted = 0;
    while (granted < queue.size()) {
        auto& front = queue[granted];
        if (!isGrantableLocked(name, front.exclusive))
            break;
        m_held.ensure(name, [] { return Vector<HeldLock>(); }).iterator->value.append(HeldLock { front.id, front.contextId, front.exclusive });
        eventsByContext.ensure(front.contextId, [] { return Vector<Event>(); }).iterator->value.append(Event { GrantedEvent, front.id });
        granted++;
    }
    if (granted)
        queue.removeAt(0, granted);
    if (queue.isEmpty())
        m_pending.remove(it);
}

void BunWebLocksRegistry::purgeContextLocked(ScriptExecutionContextIdentifier contextId)
{
    m_pending.removeIf([&](auto& entry) {
        bool removedAny = entry.value.removeAllMatching([&](auto& request) { return request.contextId == contextId; }) > 0;
        if (removedAny)
            markDirtyLocked(entry.key);
        return entry.value.isEmpty();
    });
    m_held.removeIf([&](auto& entry) {
        bool removedAny = entry.value.removeAllMatching([&](auto& lock) { return lock.contextId == contextId; }) > 0;
        if (removedAny)
            markDirtyLocked(entry.key);
        return entry.value.isEmpty();
    });
}

bool BunWebLocksRegistry::dispatchEventsToJS(Zig::GlobalObject* globalObject, const Vector<Event>& events)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    for (auto& event : events) {
        bool ok = Bun::dispatchWebLockEvent(globalObject, event.type, event.id);
        RETURN_IF_EXCEPTION(scope, false);
        if (!ok)
            return false;
    }
    return true;
}

// Posts each context's events to its own thread and dispatches this thread's
// events synchronously. Returns false if dispatching left an exception
// pending and processing should stop.
bool BunWebLocksRegistry::deliverEvents(Zig::GlobalObject* selfGlobalObject, ScriptExecutionContextIdentifier self, EventsByContext&& eventsByContext)
{
    Vector<Event> selfEvents = self ? eventsByContext.take(self) : Vector<Event>();

    for (auto& entry : eventsByContext) {
        bool posted = ScriptExecutionContext::postTaskTo(entry.key, [events = WTF::move(entry.value)](ScriptExecutionContext& target) {
            dispatchEventsToJS(defaultGlobalObject(target.jsGlobalObject()), events);
        });
        if (!posted) {
            // The context is gone (or terminating): nothing will ever process
            // its entries, so drop them; that marks the affected names dirty
            // and the caller's loop picks up whatever it unblocks.
            Locker locker { m_lock };
            purgeContextLocked(entry.key);
        }
    }

    if (!selfEvents.isEmpty())
        return dispatchEventsToJS(selfGlobalObject, selfEvents);
    return true;
}

void BunWebLocksRegistry::processQueue(Zig::GlobalObject* selfGlobalObject)
{
    // Re-entrant calls (a synchronous user callback releasing or requesting
    // inside a grant dispatch) fall through to the outermost loop instead of
    // recursing: a long backlog of synchronously-completing requests would
    // otherwise nest one native frame chain per grant and overflow the stack.
    static thread_local bool processingQueue = false;
    if (processingQueue)
        return;
    processingQueue = true;

    ScriptExecutionContextIdentifier self = 0;
    if (selfGlobalObject) {
        auto* context = selfGlobalObject->scriptExecutionContext();
        if (!context)
            selfGlobalObject = nullptr;
        else {
            ASSERT(context->isContextThread());
            self = context->identifier();
        }
    }

    if (selfGlobalObject) {
        auto& vm = JSC::getVM(selfGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        while (true) {
            EventsByContext eventsByContext;
            {
                Locker locker { m_lock };
                if (m_dirtyNames.isEmpty())
                    break;
                String name = m_dirtyNames.takeLast();
                commitDecisionsForNameLocked(name, eventsByContext);
            }
            if (eventsByContext.isEmpty())
                continue;
            bool ok = deliverEvents(selfGlobalObject, self, WTF::move(eventsByContext));
            bool hasException = !!scope.exception();
            if (!ok || hasException)
                break;
        }
    } else {
        // No JS runs on this path (context teardown): events can only target
        // other contexts and are posted to them.
        while (true) {
            EventsByContext eventsByContext;
            {
                Locker locker { m_lock };
                if (m_dirtyNames.isEmpty())
                    break;
                String name = m_dirtyNames.takeLast();
                commitDecisionsForNameLocked(name, eventsByContext);
            }
            if (eventsByContext.isEmpty())
                continue;
            deliverEvents(nullptr, 0, WTF::move(eventsByContext));
        }
    }

    processingQueue = false;
}

uint64_t BunWebLocksRegistry::request(Zig::GlobalObject* globalObject, const String& name, bool exclusive, bool steal, bool ifAvailable, int32_t& immediateEvent)
{
    s_hasBeenUsed.store(true, std::memory_order_release);
    auto self = globalObject->scriptExecutionContext()->identifier();

    uint64_t id;
    immediateEvent = NoEvent;
    EventsByContext eventsByContext;
    String ownedName = name.isolatedCopy();
    {
        Locker locker { m_lock };
        id = m_nextId++;

        if (steal) {
            // Steal bypasses the queue and the granting rules: every current
            // holder loses its lock. Victim events are appended before the
            // caller dispatches the grant, so their promises reject before
            // the stealing callback runs, like Node.
            auto victims = m_held.take(ownedName);
            for (auto& victim : victims)
                eventsByContext.ensure(victim.contextId, [] { return Vector<Event>(); }).iterator->value.append(Event { StolenEvent, victim.id });
            m_held.add(ownedName, Vector<HeldLock> {}).iterator->value.append(HeldLock { id, self, exclusive });
            immediateEvent = GrantedEvent;
        } else if (!m_pending.contains(ownedName) && isGrantableLocked(ownedName, exclusive)) {
            m_held.ensure(ownedName, [] { return Vector<HeldLock>(); }).iterator->value.append(HeldLock { id, self, exclusive });
            immediateEvent = GrantedEvent;
        } else if (ifAvailable) {
            // Not grantable right now (or queued behind someone): the
            // callback runs with null instead of waiting.
            immediateEvent = MissEvent;
        } else {
            m_pending.ensure(ownedName, [] { return Vector<PendingRequest>(); }).iterator->value.append(PendingRequest { id, self, exclusive });
        }
    }

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool ok = deliverEvents(globalObject, self, WTF::move(eventsByContext));
    RETURN_IF_EXCEPTION(scope, id);
    if (ok)
        processQueue(globalObject);
    RETURN_IF_EXCEPTION(scope, id);
    return id;
}

void BunWebLocksRegistry::release(Zig::GlobalObject* globalObject, uint64_t id, const String& name)
{
    auto self = globalObject->scriptExecutionContext()->identifier();
    {
        Locker locker { m_lock };
        auto it = m_held.find(name);
        if (it != m_held.end()) {
            bool removedAny = it->value.removeAllMatching([&](auto& lock) {
                return lock.id == id && lock.contextId == self;
            }) > 0;
            if (removedAny)
                markDirtyLocked(name);
            if (it->value.isEmpty())
                m_held.remove(it);
        }
    }
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    processQueue(globalObject);
    RETURN_IF_EXCEPTION(scope, );
}

void BunWebLocksRegistry::contextDestroyed(ScriptExecutionContextIdentifier contextId)
{
    if (!s_hasBeenUsed.load(std::memory_order_acquire))
        return;
    auto& registry = singleton();
    {
        Locker locker { registry.m_lock };
        registry.purgeContextLocked(contextId);
    }
    registry.processQueue(nullptr);
}

} // namespace WebCore
