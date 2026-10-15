/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003-2021 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#pragma once

#include "EventListener.h"
#include <wtf/Ref.h>
#include <wtf/SentinelLinkedList.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

class AbortSignal;
class EventTarget;
class RegisteredEventListener;
class WeakPtrImplWithEventTargetData;

// The abort algorithm of a listener that was added with { signal }: remove the listener from its
// target (https://dom.spec.whatwg.org/#add-an-event-listener, step 6). The listener owns it and
// the signal links it, so the listener takes it off the signal without a search.
// Linked ⇒ the signal is alive: ~AbortSignal unlinks what is left.
class EventListenerAbortAlgorithm final : public BasicRawSentinelNode<EventListenerAbortAlgorithm> {
    WTF_MAKE_TZONE_ALLOCATED(EventListenerAbortAlgorithm);
    WTF_MAKE_NONCOPYABLE(EventListenerAbortAlgorithm);

public:
    EventListenerAbortAlgorithm(AbortSignal&, EventTarget&, const AtomString& eventType, RegisteredEventListener&);
    ~EventListenerAbortAlgorithm();

    // The listener left its target: the signal has nothing to remove any more.
    void unlink();
    // The signal aborted, and has unlinked this. Frees the listener and this with it.
    void run();

private:
    AbortSignal& m_signal;
    WeakPtr<EventTarget, WeakPtrImplWithEventTargetData> m_target;
    AtomString m_eventType;
    RegisteredEventListener& m_listener;
};

// https://dom.spec.whatwg.org/#concept-event-listener
class RegisteredEventListener : public RefCounted<RegisteredEventListener> {
public:
    struct Options {
        Options(bool capture = false, bool passive = false, bool once = false, bool resistStopPropagation = false)
            : capture(capture)
            , passive(passive)
            , once(once)
            , resistStopPropagation(resistStopPropagation)
        {
        }

        bool capture;
        bool passive;
        bool once;
        bool resistStopPropagation;
    };

    static Ref<RegisteredEventListener> create(Ref<EventListener>&& listener, const Options& options)
    {
        return adoptRef(*new RegisteredEventListener(WTF::move(listener), options));
    }

    ~RegisteredEventListener();

    EventListener& callback() const { return m_callback; }
    bool useCapture() const { return m_useCapture; }
    bool isPassive() const { return m_isPassive; }
    bool isOnce() const { return m_isOnce; }
    bool wasRemoved() const { return m_wasRemoved; }
    bool resistsStopPropagation() const { return m_resistStopPropagation; }

    void markAsRemoved();

    // EventTarget::addEventListener()'s { signal }: the signal removes this listener from `target`
    // when it aborts. Removed any other way (removeEventListener, { once } firing,
    // removeAllEventListeners), the listener takes its algorithm off the signal in markAsRemoved().
    void removeOnAbort(AbortSignal&, EventTarget& target, const AtomString& eventType);

private:
    RegisteredEventListener(Ref<EventListener>&& listener, const Options& options)
        : m_useCapture(options.capture)
        , m_isPassive(options.passive)
        , m_isOnce(options.once)
        , m_wasRemoved(false)
        , m_resistStopPropagation(options.resistStopPropagation)
        , m_callback(WTF::move(listener))
    {
    }

    bool m_useCapture : 1;
    bool m_isPassive : 1;
    bool m_isOnce : 1;
    bool m_wasRemoved : 1;
    bool m_resistStopPropagation : 1;
    Ref<EventListener> m_callback;
    std::unique_ptr<EventListenerAbortAlgorithm> m_abortAlgorithm;
};

} // namespace WebCore
