/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2022 Apple Inc. All rights reserved.
 * Copyright (C) 2014 Google Inc. All rights reserved.
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

class HTMLLabelElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLLabelElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLLabelElement);
public:
    static Ref<HTMLLabelElement> create(const QualifiedName&, Document&);
    static Ref<HTMLLabelElement> create(Document&);

    WEBCORE_EXPORT RefPtr<HTMLElement> control() const;
    RefPtr<HTMLElement> controlForBindings() const;
    WEBCORE_EXPORT HTMLFormElement* form() const;
    RefPtr<HTMLFormElement> formForBindings() const;

    bool hasActivationBehavior() const final;

private:
    HTMLLabelElement(const QualifiedName&, Document&);

    bool isEventTargetedAtInteractiveDescendants(Event&) const;

    bool accessKeyAction(bool sendMouseEvents) final;

    // Overridden to update the hover/active state of the corresponding control.
    void setActive(bool) final;
    void setHovered(bool) final;

    // Overridden to either click() or focus() the corresponding control.
    void defaultEventHandler(Event&) final;

    void focus(const FocusOptions&) final;

    bool isInteractiveContent() const final { return true; }

    bool m_processingClick { false };
};

} //namespace
