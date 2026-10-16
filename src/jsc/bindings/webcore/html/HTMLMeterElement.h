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

class HTMLMeterElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLMeterElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLMeterElement);
public:
    static Ref<HTMLMeterElement> create(const QualifiedName&, Document&);

    double min() const;
    double max() const;
    double value() const;
    double low() const;
    double high() const;
    double optimum() const;

    bool canContainRangeEndPoint() const final { return false; }

private:
    HTMLMeterElement(const QualifiedName&, Document&);
    virtual ~HTMLMeterElement();

    bool isLabelable() const final { return true; }
};

} // namespace WebCore
