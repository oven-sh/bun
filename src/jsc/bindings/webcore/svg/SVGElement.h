/*
 * Copyright (C) 2004, 2005, 2006, 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2004, 2005, 2006, 2007 Rob Buis <buis@kde.org>
 * Copyright (C) 2009-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2013 Samsung Electronics. All rights reserved.
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

#pragma once

#include "StyledElement.h"

namespace WebCore {

class SVGAnimatedString;
class SVGSVGElement;

// The base class of the elements in the SVG namespace, and the class of every tag that has none of its own. It has what scripts expect
// of any SVG element (style, dataset, focus(), the event handler attributes, ownerSVGElement) and nothing that is about graphics.
class SVGElement : public StyledElement {
    WTF_MAKE_TZONE_ALLOCATED(SVGElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(SVGElement);
public:
    static Ref<SVGElement> create(const QualifiedName&, Document&);
    virtual ~SVGElement();

    Ref<SVGAnimatedString> classNameAnimated();

    SVGSVGElement* ownerSVGElement() const;
    SVGElement* viewportElement() const;

    virtual bool isSVGGraphicsElement() const { return false; }

protected:
    SVGElement(const QualifiedName&, Document&);

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) override;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::SVGElement)
    static bool isType(const WebCore::EventTarget& target)
    {
        auto* node = dynamicDowncast<WebCore::Node>(target);
        return node && node->isSVGElement();
    }
    static bool isType(const WebCore::Node& node) { return node.isSVGElement(); }
SPECIALIZE_TYPE_TRAITS_END()
