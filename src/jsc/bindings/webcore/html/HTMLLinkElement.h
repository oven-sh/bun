/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2011 Google Inc. All rights reserved.
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

#include "DOMTokenList.h"
#include "HTMLElement.h"

namespace WebCore {

class CSSStyleSheet;
class DOMTokenList;

enum class ReferrerPolicy : uint8_t;
enum class RequestPriority : uint8_t;

class HTMLLinkElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLLinkElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLLinkElement);
public:
    static Ref<HTMLLinkElement> create(const QualifiedName&, Document&, bool createdByParser);
    virtual ~HTMLLinkElement();

    URL href() const;

    AtomString target() const final;

    const AtomString& LEGACY_NODELETE type() const;

    CSSStyleSheet* sheet() const { return nullptr; }

    DOMTokenList& sizes();

    WEBCORE_EXPORT String crossOrigin() const;
    WEBCORE_EXPORT String as() const;

    WEBCORE_EXPORT DOMTokenList& relList();
    WEBCORE_EXPORT DOMTokenList& blocking();

    String referrerPolicyForBindings() const;
    ReferrerPolicy referrerPolicy() const;

    String fetchPriorityForBindings() const;
    RequestPriority fetchPriority() const;

private:
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;

    HTMLLinkElement(const QualifiedName&, Document&);

    String debugDescription() const final;

    const std::unique_ptr<DOMTokenList> m_sizes;
    const std::unique_ptr<DOMTokenList> m_relList;
    const std::unique_ptr<DOMTokenList> m_blockingList;
};

}
