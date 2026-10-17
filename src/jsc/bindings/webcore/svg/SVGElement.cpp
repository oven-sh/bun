/*
 * Copyright (C) 2004, 2005, 2006, 2007, 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2004, 2005, 2006, 2008 Rob Buis <buis@kde.org>
 * Copyright (C) 2008-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2024 Google Inc. All rights reserved.
 * Copyright (C) 2008 Alp Toker <alp@atoker.com>
 * Copyright (C) 2009 Cameron McCormack <cam@mcc.id.au>
 * Copyright (C) 2013 Samsung Electronics. All rights reserved.
 * Copyright (C) 2014 Adobe Systems Incorporated. All rights reserved.
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
 */

#include "config.h"
#include "SVGElement.h"

#include "HTMLElement.h"
#include "HTMLParserIdioms.h"
#include "NodeInlines.h"
#include "NodeName.h"
#include "SVGAnimatedString.h"
#include "SVGElementTypeHelpers.h"
#include "SVGNames.h"
#include "SVGSVGElement.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SVGElement);

SVGElement::SVGElement(const QualifiedName& tagName, Document& document)
    : StyledElement(tagName, document, TypeFlag::IsSVGElement)
{
}

SVGElement::~SVGElement() = default;

Ref<SVGElement> SVGElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new SVGElement(tagName, document));
}

void SVGElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    StyledElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    switch (name.nodeName()) {
    case AttributeNames::tabindexAttr:
        if (auto optionalTabIndex = parseHTMLInteger(newValue))
            setTabIndexExplicitly(optionalTabIndex.value());
        else
            setTabIndexExplicitly(std::nullopt);
        break;
    default:
        if (auto& eventName = HTMLElement::eventNameForEventHandlerAttribute(name); !eventName.isNull())
            setAttributeEventListener(eventName, name, newValue);
        break;
    }
}

Ref<SVGAnimatedString> SVGElement::classNameAnimated()
{
    return SVGAnimatedString::create(*this, HTMLNames::classAttr);
}

SVGSVGElement* SVGElement::ownerSVGElement() const
{
    auto* node = parentNode();
    while (node) {
        if (auto* svg = dynamicDowncast<SVGSVGElement>(*node))
            return svg;

        node = node->parentOrShadowHostNode();
    }

    return nullptr;
}

SVGElement* SVGElement::viewportElement() const
{
    auto* node = parentNode();
    while (node) {
        if (auto* element = dynamicDowncast<SVGElement>(*node); element && (element->hasTagName(SVGNames::svgTag) || element->hasTagName(SVGNames::imageTag) || element->hasTagName(SVGNames::symbolTag)))
            return element;

        node = node->parentOrShadowHostNode();
    }

    return nullptr;
}

} // namespace WebCore
