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
#include "HTMLMeterElement.h"

#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLMeterElement);

using namespace HTMLNames;

HTMLMeterElement::HTMLMeterElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(meterTag));
}

HTMLMeterElement::~HTMLMeterElement() = default;

Ref<HTMLMeterElement> HTMLMeterElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLMeterElement(tagName, document));
}

double HTMLMeterElement::min() const
{
    return parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(minAttr), 0);
}

double HTMLMeterElement::max() const
{
    return std::max(parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(maxAttr), std::max(1.0, min())), min());
}

double HTMLMeterElement::value() const
{
    double value = parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(valueAttr), 0);
    return std::min(std::max(value, min()), max());
}

double HTMLMeterElement::low() const
{
    double low = parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(lowAttr), min());
    return std::min(std::max(low, min()), max());
}

double HTMLMeterElement::high() const
{
    double high = parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(highAttr), max());
    return std::min(std::max(high, low()), max());
}

double HTMLMeterElement::optimum() const
{
    double optimum = parseHTMLFloatingPointNumberValue(attributeWithoutSynchronization(optimumAttr), std::midpoint(min(), max()));
    return std::clamp(optimum, min(), max());
}

} // namespace
