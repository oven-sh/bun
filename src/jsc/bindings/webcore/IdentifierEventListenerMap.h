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

    void markAsRemoved() { m_wasRemoved = true; }

private:
    SimpleRegisteredEventListener(Ref<EventListener>&& listener, bool once)
        : m_isOnce(once)
        , m_wasRemoved(false)
        , m_callback(WTF::move(listener))
    {
    }

    bool m_isOnce : 1;
    bool m_wasRemoved : 1;
    Ref<EventListener> m_callback;
};

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

    void replace(const JSC::Identifier& eventType, EventListener& oldListener, Ref<EventListener>&& newListener, bool once);
    bool add(const JSC::Identifier& eventType, Ref<EventListener>&&, bool once);
    bool prepend(const JSC::Identifier& eventType, Ref<EventListener>&&, bool once);
    bool remove(const JSC::Identifier& eventType, EventListener&);
    bool removeAll(const JSC::Identifier& eventType);
    WEBCORE_EXPORT SimpleEventListenerVector* find(const JSC::Identifier& eventType);
    const SimpleEventListenerVector* find(const JSC::Identifier& eventType) const { return const_cast<IdentifierEventListenerMap*>(this)->find(eventType); }
    Vector<JSC::Identifier> eventTypes() const;
    template<typename Visitor> void visitJSEventListeners(Visitor&);

    Lock& lock() { return m_lock; }

private:
    EntriesVector m_entries;
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
}

} // namespace WebCore
