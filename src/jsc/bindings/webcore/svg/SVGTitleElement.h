/*
 * Copyright (C) 2004, 2005 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2004, 2005, 2006 Rob Buis <buis@kde.org>
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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
 */

#pragma once

#include "SVGElement.h"

namespace WebCore {

class SVGTitleElement final : public SVGElement {
    WTF_MAKE_TZONE_ALLOCATED(SVGTitleElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(SVGTitleElement);
public:
    static Ref<SVGTitleElement> create(const QualifiedName&, Document&);

private:
    SVGTitleElement(const QualifiedName&, Document&);

    bool supportsFocus() const final { return false; }
};

} // namespace WebCore
