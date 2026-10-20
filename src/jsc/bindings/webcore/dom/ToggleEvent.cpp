/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "ToggleEvent.h"

#include "Document.h"
#include "Element.h"
#include "TreeScope.h"

#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ToggleEvent);

ToggleEvent::ToggleEvent()
    : Event(EventInterfaceType::ToggleEvent)
{
}

ToggleEvent::ToggleEvent(const AtomString& type, const ToggleEvent::Init& initializer, Event::IsCancelable cancelable)
    : Event(EventInterfaceType::ToggleEvent, type, Event::CanBubble::No, cancelable, Event::IsComposed::No)
    , m_oldState(initializer.oldState)
    , m_newState(initializer.newState)
    , m_source(initializer.source)
{
}

ToggleEvent::ToggleEvent(const AtomString& type, const ToggleEvent::Init& initializer)
    : Event(EventInterfaceType::ToggleEvent, type, initializer, IsTrusted::No)
    , m_oldState(initializer.oldState)
    , m_newState(initializer.newState)
    , m_source(initializer.source)
{
}

Ref<ToggleEvent> ToggleEvent::create(const AtomString& eventType, const ToggleEvent::Init& init, Event::IsCancelable cancelable)
{
    return adoptRef(*new ToggleEvent(eventType, init, cancelable));
}

Ref<ToggleEvent> ToggleEvent::create(const AtomString& eventType, const ToggleEvent::Init& init)
{
    return adoptRef(*new ToggleEvent(eventType, init));
}

Ref<ToggleEvent> ToggleEvent::createForBindings()
{
    return adoptRef(*new ToggleEvent);
}

RefPtr<Element> ToggleEvent::source() const
{
    if (!m_source)
        return nullptr;

    if (RefPtr target = dynamicDowncast<Node>(currentTarget()))
        return downcast<Element>(target->treeScope().retargetToScope(*m_source));

    return downcast<Element>(m_source->treeScope().documentScope().retargetToScope(*m_source));
}

} // namespace WebCore
