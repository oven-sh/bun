/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004, 2006, 2008, 2009 Apple Inc. All rights reserved.
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

class HTMLEmbedElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLEmbedElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLEmbedElement);
public:
    static Ref<HTMLEmbedElement> create(const QualifiedName&, Document&);

    Document* getSVGDocument() const { return nullptr; }

private:
    HTMLEmbedElement(const QualifiedName&, Document&);

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;
    bool isInteractiveContent() const final { return true; }
    bool isReplaced() const final { return true; }
};

} // namespace WebCore
