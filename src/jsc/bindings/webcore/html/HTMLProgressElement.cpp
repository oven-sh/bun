/*
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies).
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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
#include "HTMLProgressElement.h"

#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "NodeName.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLProgressElement);

using namespace HTMLNames;

HTMLProgressElement::HTMLProgressElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(progressTag));
}

Ref<HTMLProgressElement> HTMLProgressElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLProgressElement(tagName, document));
}

void HTMLProgressElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    switch (name.nodeName()) {
    case AttributeNames::valueAttr:
        updateDeterminateState();
        return;

    default:
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
    }
}

double HTMLProgressElement::value() const
{
    double value = parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(valueAttr));
    return !std::isfinite(value) || value < 0 ? 0 : std::min(value, max());
}

double HTMLProgressElement::max() const
{
    double max = parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(maxAttr));
    return !std::isfinite(max) || max <= 0 ? 1 : max;
}

void HTMLProgressElement::setMax(double max)
{
    if (max > 0)
        setAttributeWithoutSynchronization(maxAttr, AtomString::number(max));
}

double HTMLProgressElement::position() const
{
    if (!isDeterminate())
        return HTMLProgressElement::IndeterminatePosition;
    return value() / max();
}

void HTMLProgressElement::updateDeterminateState()
{
    bool newIsDeterminate = hasAttributeWithoutSynchronization(valueAttr);
    if (m_isDeterminate == newIsDeterminate)
        return;
    m_isDeterminate = newIsDeterminate;
}

} // namespace
