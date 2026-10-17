/*
 * Copyright (C) 2023-2025 Apple Inc. All rights reserved.
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
#include "CommandEvent.h"

#include "Document.h"
#include "Element.h"
#include "TreeScope.h"

#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CommandEvent);

CommandEvent::CommandEvent()
    : Event(EventInterfaceType::CommandEvent)
{
}

CommandEvent::CommandEvent(const AtomString& type, Init&& initializer, IsTrusted isTrusted)
    : Event(EventInterfaceType::CommandEvent, type, WTF::move(initializer), isTrusted)
    , m_source(WTF::move(initializer.source))
    , m_command(WTF::move(initializer.command))
{
}

Ref<CommandEvent> CommandEvent::create(const AtomString& eventType, Init&& initializer, IsTrusted isTrusted)
{
    return adoptRef(*new CommandEvent(eventType, WTF::move(initializer), isTrusted));
}

Ref<CommandEvent> CommandEvent::createForBindings()
{
    return adoptRef(*new CommandEvent);
}

RefPtr<Element> CommandEvent::source() const
{
    if (!m_source)
        return nullptr;

    if (RefPtr target = dynamicDowncast<Node>(currentTarget()))
        return downcast<Element>(target->treeScope().retargetToScope(*m_source));

    return downcast<Element>(m_source->treeScope().documentScope().retargetToScope(*m_source));
}

} // namespace WebCore
