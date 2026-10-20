/*
 * Copyright (C) 2012-2022 Google Inc. All rights reserved.
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

class HTMLBDIElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLBDIElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLBDIElement);
public:
    static Ref<HTMLBDIElement> create(const QualifiedName&, Document&);

    ~HTMLBDIElement();

private:
    HTMLBDIElement(const QualifiedName&, Document&);
};

} // namespace WebCore
