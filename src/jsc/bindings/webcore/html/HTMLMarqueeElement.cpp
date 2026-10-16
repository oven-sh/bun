/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2007, 2010 Apple Inc. All rights reserved.
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

#include "config.h"
#include "HTMLMarqueeElement.h"

#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLMarqueeElement);

using namespace HTMLNames;

static constexpr unsigned defaultScrollAmount = 6;
static constexpr unsigned defaultScrollDelay = 85;

inline HTMLMarqueeElement::HTMLMarqueeElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(marqueeTag));
}

Ref<HTMLMarqueeElement> HTMLMarqueeElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLMarqueeElement(tagName, document));
}

unsigned HTMLMarqueeElement::scrollAmount() const
{
    return limitToOnlyHTMLNonNegative(attributeWithoutSynchronization(scrollamountAttr), defaultScrollAmount);
}

void HTMLMarqueeElement::setScrollAmount(unsigned scrollAmount)
{
    setUnsignedIntegralAttribute(scrollamountAttr, limitToOnlyHTMLNonNegative(scrollAmount, defaultScrollAmount));
}

unsigned HTMLMarqueeElement::scrollDelay() const
{
    return limitToOnlyHTMLNonNegative(attributeWithoutSynchronization(scrolldelayAttr), defaultScrollDelay);
}

void HTMLMarqueeElement::setScrollDelay(unsigned scrollDelay)
{
    setUnsignedIntegralAttribute(scrolldelayAttr, limitToOnlyHTMLNonNegative(scrollDelay, defaultScrollDelay));
}

int HTMLMarqueeElement::loop() const
{
    int loopValue = integralAttribute(loopAttr);
    return loopValue > 0 ? loopValue : -1;
}

ExceptionOr<void> HTMLMarqueeElement::setLoop(int loop)
{
    if (loop <= 0 && loop != -1)
        return Exception { ExceptionCode::IndexSizeError };
    setIntegralAttribute(loopAttr, loop);
    return { };
}

} // namespace WebCore
