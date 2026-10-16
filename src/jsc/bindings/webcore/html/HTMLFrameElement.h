/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann <hausmann@kde.org>
 * Copyright (C) 2004, 2006, 2009 Apple Inc. All rights reserved.
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

class HTMLFrameElement final : public HTMLFrameElementBase {
    WTF_MAKE_TZONE_ALLOCATED(HTMLFrameElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLFrameElement);
public:
    static Ref<HTMLFrameElement> create(const QualifiedName&, Document&);

private:
    HTMLFrameElement(const QualifiedName&, Document&);

    int defaultTabIndex() const final { return 0; }
    bool isReplaced() const final { return true; }
};

} // namespace WebCore
