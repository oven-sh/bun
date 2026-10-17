/*
 * Copyright (C) 1997 Martin Jones (mjones@kde.org)
 *           (C) 1997 Torben Weis (weis@kde.org)
 *           (C) 1998 Waldo Bastian (bastian@kde.org)
 *           (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2007, 2010, 2013 Apple Inc. All rights reserved.
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

#include "HTMLTableCellElement.h"
#include "HTMLTablePartElement.h"

namespace WebCore {

class HTMLTableRowElement final : public HTMLTablePartElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTableRowElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTableRowElement);
public:
    static Ref<HTMLTableRowElement> create(Document&);
    static Ref<HTMLTableRowElement> create(const QualifiedName&, Document&);

    ~HTMLTableRowElement();

    WEBCORE_EXPORT int rowIndex() const;

    WEBCORE_EXPORT int sectionRowIndex() const;

    WEBCORE_EXPORT ExceptionOr<Ref<HTMLTableCellElement>> insertCell(int index = -1);
    WEBCORE_EXPORT ExceptionOr<void> deleteCell(int index);

    WEBCORE_EXPORT Ref<HTMLCollection> cells();

private:
    HTMLTableRowElement(const QualifiedName&, Document&);
};

} // namespace
