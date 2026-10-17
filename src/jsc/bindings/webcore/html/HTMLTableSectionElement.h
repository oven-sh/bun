/*
 * Copyright (C) 1997 Martin Jones (mjones@kde.org)
 *           (C) 1997 Torben Weis (weis@kde.org)
 *           (C) 1998 Waldo Bastian (bastian@kde.org)
 *           (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2007 Apple Inc. All rights reserved.
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

#include "HTMLNames.h"
#include "HTMLTablePartElement.h"

namespace WebCore {

class HTMLTableSectionElement final : public HTMLTablePartElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTableSectionElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTableSectionElement);
public:
    static Ref<HTMLTableSectionElement> create(const QualifiedName&, Document&);

    WEBCORE_EXPORT ExceptionOr<Ref<HTMLTableRowElement>> insertRow(int index = -1);
    WEBCORE_EXPORT ExceptionOr<void> deleteRow(int index);

    WEBCORE_EXPORT Ref<HTMLCollection> rows();

private:
    HTMLTableSectionElement(const QualifiedName& tagName, Document&);
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLTableSectionElement)
    static bool isType(const WebCore::HTMLElement& element) { return element.hasTagName(WebCore::HTMLNames::theadTag) || element.hasTagName(WebCore::HTMLNames::tfootTag) || element.hasTagName(WebCore::HTMLNames::tbodyTag); }
    static bool isType(const WebCore::Node& node)
    {
        auto* htmlElement = dynamicDowncast<WebCore::HTMLElement>(node);
        return htmlElement && isType(*htmlElement);
    }
SPECIALIZE_TYPE_TRAITS_END()
