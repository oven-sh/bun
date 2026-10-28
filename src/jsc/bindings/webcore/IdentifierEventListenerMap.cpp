#include "config.h"
#include "IdentifierEventListenerMap.h"

#include "Event.h"
#include "EventTarget.h"
#include "JSEventEmitterOnceWrapper.h"
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

void IdentifierEventListenerMap::keepAliveUntilEmitReturns(SimpleRegisteredEventListener& registration)
{
    m_removedWhileFiring.append(&registration);
}

void IdentifierEventListenerMap::releaseListenersRemovedWhileFiringSlow()
{
    Locker locker { m_lock };

    // The emit that returned dropped its copy of the vector. A registration with one reference left has only this list.
    m_removedWhileFiring.removeAllMatching([](auto& registration) {
        return registration->hasOneRef();
    });
    if (m_removedWhileFiring.isEmpty())
        m_removedWhileFiring.clear();
}

void IdentifierEventListenerMap::clear()
{
    Locker locker { m_lock };

    for (auto& entry : m_entries) {
        for (auto& listener : entry.second) {
            listener->markAsRemoved();
            keepAliveIfHeldByEmit(*listener);
        }
    }

    m_entries.clear();
}

Vector<JSC::Identifier> IdentifierEventListenerMap::eventTypes() const
{
    return m_entries.map([](auto& entry) {
        return entry.first;
    });
}

void IdentifierEventListenerMap::add(const JSC::Identifier& eventType, Ref<EventListener>&& listener, bool once)
{
    Locker locker { m_lock };

    if (auto* listeners = find(eventType)) {
        listeners->append(SimpleRegisteredEventListener::create(WTF::move(listener), once));
        return;
    }

    m_entries.append({ eventType, SimpleEventListenerVector { SimpleRegisteredEventListener::create(WTF::move(listener), once) } });
}

void IdentifierEventListenerMap::prepend(const JSC::Identifier& eventType, Ref<EventListener>&& listener, bool once)
{
    Locker locker { m_lock };

    if (auto* listeners = find(eventType)) {
        listeners->insert(0, SimpleRegisteredEventListener::create(WTF::move(listener), once));
        return;
    }

    m_entries.append({ eventType, SimpleEventListenerVector { SimpleRegisteredEventListener::create(WTF::move(listener), once) } });
}

template<typename Matches, typename WillRemove>
static bool removeLastMatching(EntriesVector& entries, const JSC::Identifier& eventType, const Matches& matches, const WillRemove& willRemove)
{
    for (unsigned i = 0; i < entries.size(); ++i) {
        if (entries[i].first == eventType) {
            auto& listeners = entries[i].second;
            for (size_t j = listeners.size(); j > 0; --j) {
                if (!matches(*listeners[j - 1]))
                    continue;
                listeners[j - 1]->markAsRemoved();
                willRemove(*listeners[j - 1]);
                listeners.removeAt(j - 1);
                if (listeners.isEmpty())
                    entries.removeAt(i);
                return true;
            }
            return false;
        }
    }

    return false;
}

bool IdentifierEventListenerMap::remove(const JSC::Identifier& eventType, JSC::JSObject& function)
{
    Locker locker { m_lock };

    return removeLastMatching(
        m_entries, eventType,
        [&](SimpleRegisteredEventListener& registeredListener) {
            auto* registeredFunction = registeredListener.callback().jsFunction();
            if (registeredFunction == &function)
                return true;
            // node's `list[i].listener === listener`, and its once(type, wrapper) wraps again: https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L707
            return !registeredListener.isOnce() && JSEventEmitterOnceWrapper::unwrap(registeredFunction) == &function;
        },
        [&](SimpleRegisteredEventListener& registeredListener) {
            keepAliveIfHeldByEmit(registeredListener);
        });
}

bool IdentifierEventListenerMap::remove(const JSC::Identifier& eventType, SimpleRegisteredEventListener& registration)
{
    Locker locker { m_lock };

    return removeLastMatching(
        m_entries, eventType,
        [&](SimpleRegisteredEventListener& registeredListener) {
            return &registeredListener == &registration;
        },
        [](SimpleRegisteredEventListener&) {});
}

bool IdentifierEventListenerMap::removeAll(const JSC::Identifier& eventType)
{
    Locker locker { m_lock };

    for (unsigned i = 0; i < m_entries.size(); ++i) {
        if (m_entries[i].first == eventType) {
            for (auto& listener : m_entries[i].second)
                keepAliveIfHeldByEmit(*listener);
            m_entries.removeAt(i);
            return true;
        }
    }

    return false;
}

void IdentifierEventListenerMap::promoteOnceListener(SimpleRegisteredEventListener& registration, Ref<EventListener>&& wrapper)
{
    Locker locker { m_lock };

    ASSERT(registration.m_isOnce);
    registration.m_callback = WTF::move(wrapper);
    registration.m_isOnce = false;
}

SimpleEventListenerVector* IdentifierEventListenerMap::find(const JSC::Identifier& eventType)
{
    for (auto& entry : m_entries) {
        if (entry.first == eventType)
            return &entry.second;
    }

    return nullptr;
}

} // namespace WebCore
