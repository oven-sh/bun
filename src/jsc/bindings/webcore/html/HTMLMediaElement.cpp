/*
 * Copyright (C) 2007-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2014-2016 Google Inc. All rights reserved.
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
 */

#include "config.h"
#include "HTMLMediaElement.h"

#include "ElementInlines.h"
#include "Event.h"
#include "EventNames.h"
#include "HTMLParserIdioms.h"
#include "TimeRanges.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLMediaElement);

using namespace HTMLNames;

HTMLMediaElement::HTMLMediaElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
}

HTMLMediaElement::~HTMLMediaElement() = default;

bool HTMLMediaElement::supportsFocus() const
{
    return hasAttributeWithoutSynchronization(controlsAttr) || HTMLElement::supportsFocus();
}

bool HTMLMediaElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == srcAttr || HTMLElement::isURLAttribute(attribute);
}

bool HTMLMediaElement::isInteractiveContent() const
{
    return hasAttributeWithoutSynchronization(controlsAttr);
}

String HTMLMediaElement::crossOrigin() const
{
    return parseCORSSettingsAttribute(attributeWithoutSynchronization(crossoriginAttr));
}

Ref<TimeRanges> HTMLMediaElement::buffered() const
{
    return TimeRanges::create();
}

Ref<TimeRanges> HTMLMediaElement::played() const
{
    return TimeRanges::create();
}

Ref<TimeRanges> HTMLMediaElement::seekable() const
{
    return TimeRanges::create();
}

void HTMLMediaElement::setDefaultPlaybackRate(double rate)
{
    if (m_defaultPlaybackRate == rate)
        return;

    m_defaultPlaybackRate = rate;
    dispatchEvent(Event::create(eventNames().ratechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void HTMLMediaElement::setPlaybackRate(double rate)
{
    if (m_playbackRate == rate)
        return;

    m_playbackRate = rate;
    dispatchEvent(Event::create(eventNames().ratechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

ExceptionOr<void> HTMLMediaElement::setVolume(double volume)
{
    if (!(volume >= 0 && volume <= 1))
        return Exception { ExceptionCode::IndexSizeError };

    if (m_volume == volume)
        return { };

    m_volume = volume;
    dispatchEvent(Event::create(eventNames().volumechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
    return { };
}

void HTMLMediaElement::setMuted(bool muted)
{
    if (m_muted == muted)
        return;

    m_muted = muted;
    dispatchEvent(Event::create(eventNames().volumechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

} // namespace WebCore
