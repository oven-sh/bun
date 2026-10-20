/*
 * Copyright (C) 2004 Zack Rusin <zack@kde.org>
 * Copyright (C) 2004-2019 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA
 * 02110-1301  USA
 */

#pragma once

#include "CSSStyleProperties.h"
#include "StyleExtractor.h"
#include <wtf/RefPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class Element;

class CSSComputedStyleDeclaration final : public CSSStyleProperties, public RefCounted<CSSComputedStyleDeclaration> {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(CSSComputedStyleDeclaration, WEBCORE_EXPORT);
public:
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }

    static Ref<CSSComputedStyleDeclaration> create(Element&, PseudoElementType = PseudoElementType::None);
    static Ref<CSSComputedStyleDeclaration> createEmpty(Element&);

    // What window.getComputedStyle(element, pseudoElement) returns.
    static Ref<CSSComputedStyleDeclaration> create(Element&, const String& pseudoElement);

    WEBCORE_EXPORT virtual ~CSSComputedStyleDeclaration();

    String getPropertyValue(CSSPropertyID) const;

private:
    enum class IsEmpty : bool { No, Yes };
    CSSComputedStyleDeclaration(Element&, IsEmpty);
    CSSComputedStyleDeclaration(Element&, PseudoElementType);

    // CSSOM functions. Don't make these public.
    CSSRule* parentRule() const final;
    unsigned length() const final;
    String item(unsigned index) const final;
    String getPropertyValue(const String& propertyName) final;
    String getPropertyPriority(const String& propertyName) final;
    ExceptionOr<void> setProperty(const String& propertyName, const String& value, const String& priority) final;
    ExceptionOr<String> removeProperty(const String& propertyName) final;
    String cssText() const final;
    ExceptionOr<void> setCssText(const String&) final;
    String getPropertyValueInternal(CSSPropertyID) final;
    ExceptionOr<void> setPropertyInternal(CSSPropertyID, const String& value, IsImportant) final;

    Style::Extractor extractor() const;

    const Ref<Element> m_element;
    PseudoElementType m_pseudoElement { PseudoElementType::None };
    bool m_isEmpty { false };
};

} // namespace WebCore
