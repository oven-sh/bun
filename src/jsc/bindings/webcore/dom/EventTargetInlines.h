/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 *           (C) 2007, 2008 Nikolas Zimmermann <zimmermann@kde.org>
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

#pragma once

#include "EventTarget.h"
#include "Node.h"
#include "WebCoreOpaqueRoot.h"

namespace WebCore {

inline void EventTarget::ref()
{
    auto* node = dynamicDowncast<Node>(*this);
    if (node) [[likely]]
        node->ref();
    else
        refEventTarget();
}

inline void EventTarget::deref()
{
    auto* node = dynamicDowncast<Node>(*this);
    if (node) [[likely]]
        node->deref();
    else
        derefEventTarget();
}

inline bool EventTarget::hasEventListeners() const
{
    auto* data = eventTargetData();
    return data && !data->eventListenerMap.isEmpty();
}

inline bool EventTarget::hasEventListeners(const AtomString& eventType) const
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.contains(eventType);
}

inline bool EventTarget::hasCapturingEventListeners(const AtomString& eventType)
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.containsCapturing(eventType);
}

inline bool EventTarget::isFiringEventListeners() const
{
    auto* data = eventTargetData();
    return data && data->isFiringEventListeners;
}

inline const EventTargetData* EventTarget::eventTargetData() const
{
    if (hasEventTargetData())
        return &weakPtrFactory().impl()->eventTargetData();
    return nullptr;
}

inline EventTargetData* EventTarget::eventTargetData()
{
    if (hasEventTargetData())
        return &weakPtrFactory().impl()->eventTargetData();
    return nullptr;
}

inline EventTargetData* EventTarget::eventTargetDataConcurrently()
{
    bool flag = this->hasEventTargetData();
    auto fencedFlag = Dependency::fence(flag);
    if (flag)
        return &fencedFlag.consume(this)->weakPtrFactory().impl()->eventTargetData();
    return nullptr;
}

inline EventTargetData& EventTarget::ensureEventTargetData()
{
    if (auto* data = eventTargetData())
        return *data;
    initializeWeakPtrFactory();
    WTF::storeStoreFence();
    setEventTargetFlag(EventTargetFlag::HasEventTargetData, true);
    return weakPtrFactory().impl()->eventTargetData();
}

template<typename CallbackType>
inline void EventTarget::enumerateEventListenerTypes(NOESCAPE const CallbackType& callback) const
{
    if (auto* data = eventTargetData())
        data->eventListenerMap.enumerateEventListenerTypes(callback);
}

template<typename CallbackType>
inline bool EventTarget::containsMatchingEventListener(NOESCAPE const CallbackType& callback) const
{
    if (auto* data = eventTargetData())
        return data->eventListenerMap.containsMatchingEventListener(callback);
    return false;
}

template<typename Visitor>
inline void EventTarget::visitJSEventListenersInGCThread(Visitor& visitor)
{
    if (auto* data = eventTargetDataConcurrently())
        data->eventListenerMap.visitJSEventListenersInGCThread(visitor);
}

} // namespace WebCore
