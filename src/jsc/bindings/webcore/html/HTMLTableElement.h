/*
 * Copyright (C) 1997 Martin Jones (mjones@kde.org)
 *           (C) 1997 Torben Weis (weis@kde.org)
 *           (C) 1998 Waldo Bastian (bastian@kde.org)
 *           (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2008 Apple Inc. All rights reserved.
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

class HTMLCollection;
class HTMLTableCaptionElement;
class HTMLTableRowsCollection;
class HTMLTableSectionElement;

class HTMLTableElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTableElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTableElement);
public:
    static Ref<HTMLTableElement> create(Document&);
    static Ref<HTMLTableElement> create(const QualifiedName&, Document&);
    ~HTMLTableElement();

    WEBCORE_EXPORT RefPtr<HTMLTableCaptionElement> LEGACY_NODELETE caption() const;
    WEBCORE_EXPORT ExceptionOr<void> setCaption(RefPtr<HTMLTableCaptionElement>&&);

    WEBCORE_EXPORT RefPtr<HTMLTableSectionElement> LEGACY_NODELETE tHead() const;
    WEBCORE_EXPORT ExceptionOr<void> setTHead(RefPtr<HTMLTableSectionElement>&&);

    WEBCORE_EXPORT RefPtr<HTMLTableSectionElement> LEGACY_NODELETE tFoot() const;
    WEBCORE_EXPORT ExceptionOr<void> setTFoot(RefPtr<HTMLTableSectionElement>&&);

    WEBCORE_EXPORT Ref<HTMLTableSectionElement> createTHead();
    WEBCORE_EXPORT void deleteTHead();
    WEBCORE_EXPORT Ref<HTMLTableSectionElement> createTFoot();
    WEBCORE_EXPORT void deleteTFoot();
    WEBCORE_EXPORT Ref<HTMLTableSectionElement> createTBody();
    WEBCORE_EXPORT Ref<HTMLTableCaptionElement> createCaption();
    WEBCORE_EXPORT void deleteCaption();
    WEBCORE_EXPORT ExceptionOr<Ref<HTMLTableRowElement>> insertRow(int index = -1);
    WEBCORE_EXPORT ExceptionOr<void> deleteRow(int index);

    WEBCORE_EXPORT Ref<HTMLCollection> rows();
    WEBCORE_EXPORT Ref<HTMLCollection> tBodies();

private:
    HTMLTableElement(const QualifiedName&, Document&);

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;

    HTMLTableSectionElement* LEGACY_NODELETE lastBody() const;
};

} //namespace
