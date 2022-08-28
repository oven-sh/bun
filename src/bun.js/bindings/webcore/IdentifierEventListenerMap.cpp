#include "config.h"
#include "IdentifierEventListenerMap.h"

#include "Event.h"
#include "EventTarget.h"
#include "JSEventListener.h"
#include <wtf/MainThread.h>
#include <wtf/StdLibExtras.h>
#include <wtf/Vector.h>


namespace WebCore {

IdentifierEventListenerMap::IdentifierEventListenerMap() = default;

bool IdentifierEventListenerMap::containsActive(const JSC::Identifier& eventType) const
{
    return false;
}

void IdentifierEventListenerMap::clear()
{
    Locker locker { m_lock };

    for (auto& entry : m_entries) {
        for (auto& listener : entry.second)
            listener->markAsRemoved();
    }

    m_entries.clear();
}

Vector<JSC::Identifier> IdentifierEventListenerMap::eventTypes() const
{
    return m_entries.map([](auto& entry) {
        return entry.first;
    });
}

static inline size_t findListener(const SimpleEventListenerVector& listeners, EventListener& listener)
{
    for (size_t i = 0; i < listeners.size(); ++i) {
        auto& registeredListener = listeners[i];
        if (registeredListener->callback() == listener)
            return i;
    }
    return notFound;
}

void IdentifierEventListenerMap::replace(const JSC::Identifier& eventType, EventListener& oldListener, Ref<EventListener>&& newListener, bool once)
{
    Locker locker { m_lock };

    auto* listeners = find(eventType);
    ASSERT(listeners);
    size_t index = findListener(*listeners, oldListener);
    ASSERT(index != notFound);
    auto& registeredListener = listeners->at(index);
    registeredListener->markAsRemoved();
    registeredListener = SimpleRegisteredEventListener::create(WTFMove(newListener), once);
}

bool IdentifierEventListenerMap::add(const JSC::Identifier& eventType, Ref<EventListener>&& listener, bool once)
{
    Locker locker { m_lock };

    if (auto* listeners = find(eventType)) {
        if (findListener(*listeners, listener) != notFound)
            return false; // Duplicate listener.
        listeners->append(SimpleRegisteredEventListener::create(WTFMove(listener), once));
        return true;
    }

    m_entries.append({ eventType, SimpleEventListenerVector { SimpleRegisteredEventListener::create(WTFMove(listener), once) } });
    return true;
}

bool IdentifierEventListenerMap::prepend(const JSC::Identifier& eventType, Ref<EventListener>&& listener, bool once)
{
    Locker locker { m_lock };

    if (auto* listeners = find(eventType)) {
        if (findListener(*listeners, listener) != notFound)
            return false; // Duplicate listener.
        listeners->insert(0, SimpleRegisteredEventListener::create(WTFMove(listener), once));
        return true;
    }

    m_entries.append({ eventType, SimpleEventListenerVector { SimpleRegisteredEventListener::create(WTFMove(listener), once) } });
    return true;
}

static bool removeListenerFromVector(SimpleEventListenerVector& listeners, EventListener& listener)
{
    size_t indexOfRemovedListener = findListener(listeners, listener);
    if (UNLIKELY(indexOfRemovedListener == notFound))
        return false;

    listeners[indexOfRemovedListener]->markAsRemoved();
    listeners.remove(indexOfRemovedListener);
    return true;
}

bool IdentifierEventListenerMap::remove(const JSC::Identifier& eventType, EventListener& listener)
{
    Locker locker { m_lock };

    for (unsigned i = 0; i < m_entries.size(); ++i) {
        if (m_entries[i].first == eventType) {
            bool wasRemoved = removeListenerFromVector(m_entries[i].second, listener);
            if (m_entries[i].second.isEmpty())
                m_entries.remove(i);
            return wasRemoved;
        }
    }

    return false;
}

bool IdentifierEventListenerMap::removeAll(const JSC::Identifier& eventType)
{
    Locker locker { m_lock };

    for (unsigned i = 0; i < m_entries.size(); ++i) {
        if (m_entries[i].first == eventType) {
            m_entries.remove(i);
            return true;
        }
    }

    return false;
}

SimpleEventListenerVector* IdentifierEventListenerMap::find(const JSC::Identifier& eventType)
{
    for (auto& entry : m_entries) {
        if (entry.first == eventType)
            return &entry.second;
    }

    return nullptr;
}

static void removeFirstListenerCreatedFromMarkup(SimpleEventListenerVector& listenerVector)
{
    bool foundListener = listenerVector.removeFirstMatching([] (const auto& registeredListener) {
        if (JSEventListener::wasCreatedFromMarkup(registeredListener->callback())) {
            registeredListener->markAsRemoved();
            return true;
        }
        return false;
    });
    ASSERT_UNUSED(foundListener, foundListener);
}

} // namespace WebCore
