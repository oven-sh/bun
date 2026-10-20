/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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
#include "FormDataEvent.h"

#include "DOMFormData.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(FormDataEvent);

Ref<FormDataEvent> FormDataEvent::create(const AtomString& eventType, Init&& init)
{
    return adoptRef(*new FormDataEvent(eventType, WTF::move(init)));
}

Ref<FormDataEvent> FormDataEvent::create(const AtomString& eventType, CanBubble canBubble, IsCancelable isCancelable, IsComposed isComposed, Ref<DOMFormData>&& formData)
{
    return adoptRef(*new FormDataEvent(eventType, canBubble, isCancelable, isComposed, WTF::move(formData)));
}

FormDataEvent::FormDataEvent(const AtomString& eventType, Init&& init)
    : Event(EventInterfaceType::FormDataEvent, eventType, WTF::move(init), IsTrusted::No)
    , m_formData(WTF::move(init.formData))
{
}

FormDataEvent::FormDataEvent(const AtomString& eventType, CanBubble canBubble, IsCancelable isCancelable, IsComposed isComposed, Ref<DOMFormData>&& formData)
    : Event(EventInterfaceType::FormDataEvent, eventType, canBubble, isCancelable, isComposed)
    , m_formData(WTF::move(formData))
{
}

} // namespace WebCore
