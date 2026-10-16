/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann <hausmann@kde.org>
 * Copyright (C) 2004-2019 Apple Inc. All rights reserved.
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

#include "HTMLFrameElementBase.h"

namespace WebCore {

class DOMTokenList;

enum class ReferrerPolicy : uint8_t;

class HTMLIFrameElement final : public HTMLFrameElementBase {
    WTF_MAKE_TZONE_ALLOCATED(HTMLIFrameElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLIFrameElement);
public:
    static Ref<HTMLIFrameElement> create(const QualifiedName&, Document&);
    ~HTMLIFrameElement();

    DOMTokenList& sandbox();

    String referrerPolicyForBindings() const;
    ReferrerPolicy referrerPolicy() const;

    enum LoadingValues { Lazy, Eager };

    Document* getSVGDocument() const { return nullptr; }

private:
    HTMLIFrameElement(const QualifiedName&, Document&);

    int defaultTabIndex() const final { return 0; }
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    bool isInteractiveContent() const final { return true; }
    bool isReplaced() const final { return true; }

    const std::unique_ptr<DOMTokenList> m_sandbox;
};

} // namespace WebCore
