/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004, 2008, 2009, 2011 Apple Inc. All rights reserved.
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

#include "HTMLAnchorElement.h"

namespace WebCore {

class HTMLAreaElement final : public HTMLAnchorElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLAreaElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLAreaElement);
public:
    static Ref<HTMLAreaElement> create(const QualifiedName&, Document&);
    ~HTMLAreaElement();

private:
    HTMLAreaElement(const QualifiedName&, Document&);

    bool supportsFocus() const final;
    AtomString target() const final;
};

} //namespace
