/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Peter Kelly (pmk@post.com)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003-2018 Apple Inc. All rights reserved.
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

#include "Element.h"
#include "ElementData.h"

namespace WebCore {

class CSSStyleProperties;
class MutableStyleProperties;
class StyleProperties;

class StyledElement : public Element {
    WTF_MAKE_TZONE_ALLOCATED(StyledElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(StyledElement);
public:
    virtual ~StyledElement();

    void dirtyStyleAttribute();
    void invalidateStyleAttribute();

    // Parses the style attribute the first time it is asked for.
    const StyleProperties* inlineStyle() const;

    // FIXME: Remove suppression once rdar://189998365 is fixed.
    void synchronizeStyleAttributeInternal() const { SUPPRESS_MEMORY_UNSAFE_CAST const_cast<StyledElement*>(this)->synchronizeStyleAttributeInternalImpl(); }

    WEBCORE_EXPORT CSSStyleProperties& cssomStyle();

protected:
    StyledElement(const QualifiedName& name, Document& document, OptionSet<TypeFlag> type)
        : Element(name, document, type)
    {
    }

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason = AttributeModificationReason::Directly) override;

private:
    StyledElement(ClangVTableWorkaroundTag, const QualifiedName&, Document&);

    void styleAttributeChanged(const AtomString& newStyleString);
    void synchronizeStyleAttributeInternalImpl();

    Ref<MutableStyleProperties> ensureMutableInlineStyle();
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::StyledElement)
    static bool isType(const WebCore::Node& node) { return node.isStyledElement(); }
SPECIALIZE_TYPE_TRAITS_END()
