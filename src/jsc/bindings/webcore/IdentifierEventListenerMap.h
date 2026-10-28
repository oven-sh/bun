#pragma once

#include <atomic>
#include <memory>
#include <wtf/Forward.h>
#include <wtf/Lock.h>
#include <wtf/Ref.h>
#include <JavaScriptCore/Identifier.h>
#include "EventListener.h"

namespace WebCore {

class SimpleRegisteredEventListener : public RefCounted<SimpleRegisteredEventListener> {
public:
    static Ref<SimpleRegisteredEventListener> create(Ref<EventListener>&& listener, bool once)
    {
        return adoptRef(*new SimpleRegisteredEventListener(WTF::move(listener), once));
    }

    EventListener& callback() const { return m_callback; }
    bool isOnce() const { return m_isOnce; }
    bool wasRemoved() const { return m_wasRemoved; }
    bool hasFired() const { return m_hasFired; }

    void markAsRemoved() { m_wasRemoved = true; }
    void markAsFired() { m_hasFired = true; }

private:
    SimpleRegisteredEventListener(Ref<EventListener>&& listener, bool once)
        : m_isOnce(once)
        , m_wasRemoved(false)
        , m_hasFired(false)
        , m_callback(WTF::move(listener))
    {
    }

    bool m_isOnce : 1;
    bool m_wasRemoved : 1;
    bool m_hasFired : 1;
    Ref<EventListener> m_callback;
};

struct SameSizeAsSimpleRegisteredEventListener : RefCounted<SameSizeAsSimpleRegisteredEventListener> {
    bool flags;
    void* callback;
};
static_assert(sizeof(SimpleRegisteredEventListener) == sizeof(SameSizeAsSimpleRegisteredEventListener), "every listener of every native EventEmitter has one of these");

using SimpleEventListenerVector = Vector<RefPtr<SimpleRegisteredEventListener>, 2, CrashOnOverflow, 6>;
using EntriesVector = Vector<std::pair<JSC::Identifier, SimpleEventListenerVector>, 4, CrashOnOverflow, 8>;

class IdentifierEventListenerMap {
public:
    IdentifierEventListenerMap();

    bool isEmpty() const { return m_entries.isEmpty(); }
    bool contains(const JSC::Identifier& eventType) const { return find(eventType); }
    bool containsActive(const JSC::Identifier& eventType) const;

    const EntriesVector& entries() const { return m_entries; }

    void clear();

    // Like node:events and unlike EventTarget, the same function can be registered any number of times.
    void add(const JSC::Identifier& eventType, Ref<EventListener>&&, bool once);
    void prepend(const JSC::Identifier& eventType, Ref<EventListener>&&, bool once);
    // Removes the last registration of this callback, like node's removeListener.
    bool remove(const JSC::Identifier& eventType, EventListener&);
    // Removes exactly this registration.
    bool remove(const JSC::Identifier& eventType, SimpleRegisteredEventListener&);
    bool removeAll(const JSC::Identifier& eventType);
    // Call this when an emit returns: it drops the removed registrations that no emit holds any more.
    void releaseListenersRemovedWhileFiring()
    {
        if (!m_removedWhileFiring.isEmpty()) [[unlikely]]
            releaseListenersRemovedWhileFiringSlow();
    }
    WEBCORE_EXPORT SimpleEventListenerVector* find(const JSC::Identifier& eventType);
    const SimpleEventListenerVector* find(const JSC::Identifier& eventType) const { return const_cast<IdentifierEventListenerMap*>(this)->find(eventType); }
    Vector<JSC::Identifier> eventTypes() const;
    template<typename Visitor> void visitJSEventListeners(Visitor&);

    Lock& lock() { return m_lock; }

private:
    // An emit still calls a removed registration that its copy of the vector holds, so the function stays visited until that emit returns.
    void keepAliveIfHeldByEmit(SimpleRegisteredEventListener& registration)
    {
        if (!registration.hasOneRef()) [[unlikely]]
            keepAliveUntilEmitReturns(registration);
    }
    NEVER_INLINE void keepAliveUntilEmitReturns(SimpleRegisteredEventListener&);
    NEVER_INLINE void releaseListenersRemovedWhileFiringSlow();

    EntriesVector m_entries;
    SimpleEventListenerVector m_removedWhileFiring;
    Lock m_lock;
};

template<typename Visitor>
void IdentifierEventListenerMap::visitJSEventListeners(Visitor& visitor)
{
    Locker locker { m_lock };
    for (auto& entry : m_entries) {
        for (auto& eventListener : entry.second)
            eventListener->callback().visitJSFunction(visitor);
    }
    for (auto& eventListener : m_removedWhileFiring)
        eventListener->callback().visitJSFunction(visitor);
}

} // namespace WebCore
