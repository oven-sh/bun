/*
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies).
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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

class HTMLProgressElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLProgressElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLProgressElement);
public:
    static constexpr double IndeterminatePosition = -1;
    static constexpr double InvalidPosition = -2;

    static Ref<HTMLProgressElement> create(const QualifiedName&, Document&);

    double value() const;

    double max() const;
    void setMax(double);

    double position() const;

private:
    HTMLProgressElement(const QualifiedName&, Document&);

    bool matchesIndeterminatePseudoClass() const final { return !m_isDeterminate; }
    bool isLabelable() const final { return true; }
    bool canContainRangeEndPoint() const final { return false; }

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;

    void updateDeterminateState();
    bool isDeterminate() const { return m_isDeterminate; };

    bool m_isDeterminate { false };
};

} // namespace
