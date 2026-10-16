/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann <hausmann@kde.org>
 * Copyright (C) 2004-2023 Apple Inc. All rights reserved.
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

#include "HTMLElement.h"

namespace WebCore {

class Window;

class HTMLFrameElementBase : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLFrameElementBase);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLFrameElementBase);
public:
    virtual ~HTMLFrameElementBase();

    Window* contentWindow() const { return m_contentWindow.get(); }
    Document* contentDocument() const;

    void disconnectContentFrame();

protected:
    HTMLFrameElementBase(const QualifiedName&, Document&);

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) override;
    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void postConnectionSteps() final;
    void removingSteps(RemovalType, ContainerNode&) final;

    void setLocation(const String&);
    void openURL();

private:
    bool canContainRangeEndPoint() const final { return false; }

    bool supportsFocus() const final;

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;
    bool LEGACY_NODELETE isHTMLContentAttribute(const Attribute&) const final;

    RefPtr<Window> m_contentWindow;
    AtomString m_frameURL;
    bool m_openingURLAfterInserting { false };
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLFrameElementBase)
    static bool isType(const WebCore::HTMLElement& element) { return isAnyOf<WebCore::HTMLFrameElement, WebCore::HTMLIFrameElement>(element); }
    static bool isType(const WebCore::Node& node)
    {
        auto* htmlElement = dynamicDowncast<WebCore::HTMLElement>(node);
        return htmlElement && isType(*htmlElement);
    }
SPECIALIZE_TYPE_TRAITS_END()
