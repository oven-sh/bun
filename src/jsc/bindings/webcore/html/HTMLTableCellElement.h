/*
 * Copyright (C) 1997 Martin Jones (mjones@kde.org)
 *           (C) 1997 Torben Weis (weis@kde.org)
 *           (C) 1998 Waldo Bastian (bastian@kde.org)
 *           (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2010 Apple Inc. All rights reserved.
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

#pragma once

#include "HTMLTablePartElement.h"

namespace WebCore {

class HTMLTableCellElement final : public HTMLTablePartElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTableCellElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTableCellElement);
public:
    // These limits are defined in the HTML specification:
    // - https://html.spec.whatwg.org/#dom-tdth-colspan
    // - https://html.spec.whatwg.org/#dom-tdth-rowspan
    static constexpr unsigned minColspan = 1;
    static constexpr unsigned maxColspan = 1000;
    static constexpr unsigned defaultColspan = 1;
    static constexpr unsigned minRowspan = 0;
    static constexpr unsigned maxRowspan = 65534;
    static constexpr unsigned defaultRowspan = 1;

    static Ref<HTMLTableCellElement> create(const QualifiedName&, Document&);

    WEBCORE_EXPORT int LEGACY_NODELETE cellIndex() const;
    WEBCORE_EXPORT unsigned colSpan() const;
    WEBCORE_EXPORT unsigned rowSpan() const;

    WEBCORE_EXPORT void setColSpan(unsigned);
    WEBCORE_EXPORT void setRowSpan(unsigned);

    WEBCORE_EXPORT AtomString scope() const;

private:
    HTMLTableCellElement(const QualifiedName&, Document&);

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const override;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLTableCellElement)
    static bool isType(const WebCore::HTMLElement& element) { return element.hasTagName(WebCore::HTMLNames::tdTag) || element.hasTagName(WebCore::HTMLNames::thTag); }
    static bool isType(const WebCore::Node& node)
    {
        auto* htmlElement = dynamicDowncast<WebCore::HTMLElement>(node);
        return htmlElement && isType(*htmlElement);
    }
SPECIALIZE_TYPE_TRAITS_END()
