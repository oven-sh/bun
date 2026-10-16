/*
 * Copyright (C) 2011 Nokia Corporation and/or its subsidiary(-ies)
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

class HTMLDetailsElement;

class HTMLSummaryElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLSummaryElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLSummaryElement);
public:
    static Ref<HTMLSummaryElement> create(const QualifiedName&, Document&);

    bool isActiveSummary() const;
    bool hasActivationBehavior() const final;

private:
    HTMLSummaryElement(const QualifiedName&, Document&);

    void defaultEventHandler(Event&) final;

    bool LEGACY_NODELETE hasCustomFocusLogic() const final { return true; }

    RefPtr<HTMLDetailsElement> LEGACY_NODELETE detailsElement() const;

    int defaultTabIndex() const final;
    bool supportsFocus() const final;
};

} // namespace WebCore
