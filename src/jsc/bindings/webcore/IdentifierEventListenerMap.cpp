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
        for (auto& listener : entry.listeners)
            listener->markAsRemoved();
    }

    m_entries.clear();
}

Vector<JSC::Identifier> IdentifierEventListenerMap::eventTypes() const
{
    return m_entries.map([](auto& entry) {
        return entry.eventType;
    });
}

unsigned IdentifierEventListenerMap::insert(const JSC::Identifier& eventType, Ref<EventListener>&& listener, bool once, bool prepend)
{
    Locker locker { m_lock };

    auto registration = SimpleRegisteredEventListener::create(WTF::move(listener), once);
    auto* list = findList(eventType);
    if (!list) {
        m_entries.append({ eventType, SimpleEventListenerVector { WTF::move(registration) } });
        return 1;
    }

    if (prepend)
        list->listeners.insert(0, WTF::move(registration));
    else
        list->listeners.append(WTF::move(registration));

    // node keeps `warned` on the array of listeners, and a list of two is always a new array:
    // https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L570-L574 and #L722-L723
    unsigned size = list->listeners.size();
    if (size == 2)
        list->warnedOfTooManyListeners = false;
    return size;
}

unsigned IdentifierEventListenerMap::add(const JSC::Identifier& eventType, Ref<EventListener>&& listener, bool once)
{
    return insert(eventType, WTF::move(listener), once, false);
}

unsigned IdentifierEventListenerMap::prepend(const JSC::Identifier& eventType, Ref<EventListener>&& listener, bool once)
{
    return insert(eventType, WTF::move(listener), once, true);
}

unsigned IdentifierEventListenerMap::markWarnedOfTooManyListeners(const JSC::Identifier& eventType)
{
    auto* list = findList(eventType);
    if (!list || list->warnedOfTooManyListeners)
        return 0;
    list->warnedOfTooManyListeners = true;
    return list->listeners.size();
}

template<typename Matches>
static bool removeLastMatching(EntriesVector& entries, const JSC::Identifier& eventType, const Matches& matches)
{
    for (unsigned i = 0; i < entries.size(); ++i) {
        if (entries[i].eventType == eventType) {
            auto& listeners = entries[i].listeners;
            for (size_t j = listeners.size(); j > 0; --j) {
                if (!matches(*listeners[j - 1]))
                    continue;
                listeners[j - 1]->markAsRemoved();
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

bool IdentifierEventListenerMap::remove(const JSC::Identifier& eventType, EventListener& listener)
{
    Locker locker { m_lock };

    return removeLastMatching(m_entries, eventType, [&](SimpleRegisteredEventListener& registeredListener) {
        return registeredListener.callback() == listener;
    });
}

bool IdentifierEventListenerMap::remove(const JSC::Identifier& eventType, SimpleRegisteredEventListener& registration)
{
    Locker locker { m_lock };

    return removeLastMatching(m_entries, eventType, [&](SimpleRegisteredEventListener& registeredListener) {
        return &registeredListener == &registration;
    });
}

bool IdentifierEventListenerMap::removeAll(const JSC::Identifier& eventType)
{
    Locker locker { m_lock };

    for (unsigned i = 0; i < m_entries.size(); ++i) {
        if (m_entries[i].eventType == eventType) {
            m_entries.removeAt(i);
            return true;
        }
    }

    return false;
}

EventListenerList* IdentifierEventListenerMap::findList(const JSC::Identifier& eventType)
{
    for (auto& entry : m_entries) {
        if (entry.eventType == eventType)
            return &entry;
    }

    return nullptr;
}

SimpleEventListenerVector* IdentifierEventListenerMap::find(const JSC::Identifier& eventType)
{
    auto* list = findList(eventType);
    return list ? &list->listeners : nullptr;
}

} // namespace WebCore
