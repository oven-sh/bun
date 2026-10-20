/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
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
#include "FocusEvent.h"

#include "EventTargetInlines.h"
#include "Node.h"
#include "Window.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/TextStream.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(FocusEvent);

FocusEvent::FocusEvent()
    : UIEvent(EventInterfaceType::FocusEvent)
{
}

FocusEvent::FocusEvent(const AtomString& type, CanBubble canBubble, IsCancelable isCancelable, RefPtr<Window>&& view, int detail, RefPtr<EventTarget>&& relatedTarget)
    : UIEvent(EventInterfaceType::FocusEvent, type, canBubble, isCancelable, IsComposed::Yes, WTF::move(view), detail)
    , m_relatedTarget(WTF::move(relatedTarget))
{
}

FocusEvent::FocusEvent(const AtomString& type, Init&& initializer)
    : UIEvent(EventInterfaceType::FocusEvent, type, WTF::move(initializer))
    , m_relatedTarget(WTF::move(initializer.relatedTarget))
{
}

FocusEvent::~FocusEvent() = default;

String FocusEvent::debugDescription() const
{
    String focusTargetDescription = "null"_s;
    if (RefPtr node = dynamicDowncast<Node>(m_relatedTarget))
        focusTargetDescription = node->debugDescription();
    else if (m_relatedTarget) {
        TextStream stream;
        stream << "EventTarget "_s << m_relatedTarget.get();
        focusTargetDescription = stream.release();
    }
    return makeString(UIEvent::debugDescription(), ", focus target: "_s, focusTargetDescription);
}

} // namespace WebCore
