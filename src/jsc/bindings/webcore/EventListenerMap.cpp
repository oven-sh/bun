/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 *           (C) 2007, 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2011 Andreas Kling (kling@webkit.org)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

#include "config.h"
#include "EventListenerMap.h"

#include "AddEventListenerOptions.h"
#include "Event.h"
#include "EventTarget.h"
#include "JSEventListener.h"
#include <wtf/MainThread.h>
#include <wtf/StdLibExtras.h>
#include <wtf/Vector.h>

namespace WebCore {

EventListenerMap::EventListenerMap() = default;

bool EventListenerMap::containsCapturing(const AtomString& eventType) const
{
    auto* listeners = find(eventType);
    if (!listeners)
        return false;

    for (auto& eventListener : *listeners) {
        if (eventListener->useCapture())
            return true;
    }
    return false;
}

bool EventListenerMap::containsActive(const AtomString& eventType) const
{
    auto* listeners = find(eventType);
    if (!listeners)
        return false;

    for (auto& eventListener : *listeners) {
        if (!eventListener->isPassive())
            return true;
    }
    return false;
}

void EventListenerMap::clear()
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    for (auto& entry : m_entries) {
        for (auto& listener : entry.listeners)
            listener->markAsRemoved();
    }

    m_entries.clear();
}

Vector<AtomString> EventListenerMap::eventTypes() const
{
    return m_entries.map([](auto& entry) {
        return entry.type;
    });
}

static inline size_t findListener(const EventListenerVector& listeners, EventListener& listener, bool useCapture)
{
    for (size_t i = 0; i < listeners.size(); ++i) {
        auto& registeredListener = listeners[i];
        if (registeredListener->callback() == listener && registeredListener->useCapture() == useCapture)
            return i;
    }
    return notFound;
}

// Packs what JSEventListener::operator== + findListener compare on into one
// word; JSC cells are 16-byte aligned so the two flag bits fit. 0 = unkeyable.
static inline uintptr_t callbackKey(const EventListener& listener, bool useCapture)
{
    auto* jsListener = dynamicDowncast<JSEventListener>(listener);
    if (!jsListener) [[unlikely]]
        return 0;
    auto* function = jsListener->jsFunction();
    if (!function) [[unlikely]]
        return 0;
    uintptr_t bits = reinterpret_cast<uintptr_t>(function);
    ASSERT(!(bits & 3));
    return bits | static_cast<uintptr_t>(useCapture) | (static_cast<uintptr_t>(jsListener->isAttribute()) << 1);
}

static std::unique_ptr<HashSet<uintptr_t>> buildCallbackIndex(const EventListenerVector& listeners)
{
    auto index = makeUnique<HashSet<uintptr_t>>();
    index->reserveInitialCapacity(listeners.size());
    for (auto& registeredListener : listeners) {
        if (auto key = callbackKey(registeredListener->callback(), registeredListener->useCapture()))
            index->add(key);
    }
    return index;
}

void EventListenerMap::replace(const AtomString& eventType, EventListener& oldListener, Ref<EventListener>&& newListener, const RegisteredEventListener::Options& options)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    auto* entry = findEntry(eventType);
    ASSERT(entry);
    auto& listeners = entry->listeners;
    size_t index = findListener(listeners, oldListener, options.capture);
    ASSERT(index != notFound);
    auto& registeredListener = listeners.at(index);
    registeredListener->markAsRemoved();
    registeredListener = RegisteredEventListener::create(WTF::move(newListener), options);
    entry->callbackIndex = nullptr;
}

RegisteredEventListener* EventListenerMap::add(const AtomString& eventType, Ref<EventListener>&& listener, const RegisteredEventListener::Options& options)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    if (auto* entry = findEntry(eventType)) {
        auto& listeners = entry->listeners;
        uintptr_t key = callbackKey(listener.get(), options.capture);

        bool mayBeDuplicate = !key || !entry->callbackIndex || entry->callbackIndex->contains(key);
        if (mayBeDuplicate && findListener(listeners, listener, options.capture) != notFound)
            return nullptr; // Duplicate listener.

        auto registeredListener = RegisteredEventListener::create(WTF::move(listener), options);
        auto* result = registeredListener.ptr();
        listeners.append(WTF::move(registeredListener));

        if (entry->callbackIndex) {
            if (key)
                entry->callbackIndex->add(key);
        } else if (listeners.size() >= callbackIndexThreshold) [[unlikely]]
            entry->callbackIndex = buildCallbackIndex(listeners);

        return result;
    }

    auto registeredListener = RegisteredEventListener::create(WTF::move(listener), options);
    auto* result = registeredListener.ptr();
    m_entries.append({ eventType, EventListenerVector { WTF::move(registeredListener) }, nullptr });
    return result;
}

static bool removeListenerFromVector(EventListenerVector& listeners, EventListener& listener, bool useCapture)
{
    size_t indexOfRemovedListener = findListener(listeners, listener, useCapture);
    if (indexOfRemovedListener == notFound) [[unlikely]]
        return false;

    listeners[indexOfRemovedListener]->markAsRemoved();
    listeners.removeAt(indexOfRemovedListener);
    return true;
}

bool EventListenerMap::remove(const AtomString& eventType, EventListener& listener, bool useCapture)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    for (unsigned i = 0; i < m_entries.size(); ++i) {
        auto& entry = m_entries[i];
        if (entry.type == eventType) {
            // `listener` may be owned solely by the vector (setAttributeEventListener
            // and the AbortSignal removal path hold no extra ref), so sample the key
            // before removeListenerFromVector can drop the last reference.
            uintptr_t key = callbackKey(listener, useCapture);
            if (key && entry.callbackIndex && !entry.callbackIndex->contains(key))
                return false;

            bool wasRemoved = removeListenerFromVector(entry.listeners, listener, useCapture);
            if (entry.listeners.isEmpty()) {
                m_entries.removeAt(i);
            } else if (wasRemoved && entry.callbackIndex) {
                if (key)
                    entry.callbackIndex->remove(key);
                if (entry.callbackIndex->size() > entry.listeners.size() * 2 + callbackIndexThreshold)
                    entry.callbackIndex = nullptr;
            }
            return wasRemoved;
        }
    }

    return false;
}

EventListenerMap::Entry* EventListenerMap::findEntry(const AtomString& eventType)
{
    for (auto& entry : m_entries) {
        if (entry.type == eventType)
            return &entry;
    }
    return nullptr;
}

EventListenerVector* EventListenerMap::find(const AtomString& eventType)
{
    if (auto* entry = findEntry(eventType))
        return &entry->listeners;
    return nullptr;
}

static void removeFirstListenerCreatedFromMarkup(EventListenerVector& listenerVector)
{
    bool foundListener = listenerVector.removeFirstMatching([](const auto& registeredListener) {
        if (JSEventListener::wasCreatedFromMarkup(registeredListener->callback())) {
            registeredListener->markAsRemoved();
            return true;
        }
        return false;
    });
    ASSERT_UNUSED(foundListener, foundListener);
}

void EventListenerMap::removeFirstEventListenerCreatedFromMarkup(const AtomString& eventType)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    for (unsigned i = 0; i < m_entries.size(); ++i) {
        auto& entry = m_entries[i];
        if (entry.type == eventType) {
            removeFirstListenerCreatedFromMarkup(entry.listeners);
            entry.callbackIndex = nullptr;
            if (entry.listeners.isEmpty())
                m_entries.removeAt(i);
            return;
        }
    }
}

static void copyListenersNotCreatedFromMarkupToTarget(const AtomString& eventType, EventListenerVector& listenerVector, EventTarget* target)
{
    for (auto& registeredListener : listenerVector) {
        // Event listeners created from markup have already been transfered to the shadow tree during cloning.
        if (JSEventListener::wasCreatedFromMarkup(registeredListener->callback()))
            continue;
        target->addEventListener(eventType, registeredListener->callback(), registeredListener->useCapture());
    }
}

void EventListenerMap::copyEventListenersNotCreatedFromMarkupToTarget(EventTarget* target)
{
    for (auto& entry : m_entries)
        copyListenersNotCreatedFromMarkupToTarget(entry.type, entry.listeners, target);
}

} // namespace WebCore
