/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann <hausmann@kde.org>
 * Copyright (C) 2007-2016 Apple Inc. All rights reserved.
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

#include "Document.h"
#include "HTMLElement.h"
#include "HTMLNames.h"
#include "URLDecomposition.h"

namespace WebCore {

class DOMTokenList;

enum class ReferrerPolicy : uint8_t;
class HTMLAnchorElement : public HTMLElement, public URLDecomposition {
    WTF_MAKE_TZONE_ALLOCATED(HTMLAnchorElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLAnchorElement);
public:
    static Ref<HTMLAnchorElement> create(Document&);
    static Ref<HTMLAnchorElement> create(const QualifiedName&, Document&);

    virtual ~HTMLAnchorElement();

    WEBCORE_EXPORT URL href() const;

    const AtomString& LEGACY_NODELETE name() const;

    WEBCORE_EXPORT String origin() const;

    WEBCORE_EXPORT void setProtocol(StringView value);

    WEBCORE_EXPORT String text();
    void setText(String&&);

    bool hasActivationBehavior() const final;

    WEBCORE_EXPORT DOMTokenList& relList();

    String referrerPolicyForBindings() const;
    ReferrerPolicy referrerPolicy() const;

    AtomString target() const override;

protected:
    HTMLAnchorElement(const QualifiedName&, Document&);

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) override;

private:
    bool supportsFocus() const override;
    bool isMouseFocusable() const override;
    void defaultEventHandler(Event&) final;
    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;
    int defaultTabIndex() const final;
    bool draggable() const final;
    bool isInteractiveContent() const final;

    void handleClick(Event&);

    URL fullURL() const final { return href(); }
    void setFullURL(const URL&) final;

    const std::unique_ptr<DOMTokenList> m_relList;
};

} // namespace WebCore
