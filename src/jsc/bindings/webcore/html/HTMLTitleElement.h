/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2010 Apple Inc. All rights reserved.
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

class HTMLTitleElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTitleElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTitleElement);
public:
    static Ref<HTMLTitleElement> create(const QualifiedName&, Document&);

    WEBCORE_EXPORT String text() const;
    WEBCORE_EXPORT void setText(String&&);

    void postConnectionSteps() final;

private:
    HTMLTitleElement(const QualifiedName&, Document&);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void removingSteps(RemovalType, ContainerNode&) final;
    void childrenChanged(const ChildChange&) final;
};

} //namespace
