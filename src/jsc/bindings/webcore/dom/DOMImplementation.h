/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2008, 2016 Apple Inc. All rights reserved.
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

#include "XMLDocument.h"
#include <wtf/WeakRef.h>

namespace WebCore {

class DOMImplementation final : public ScriptWrappable {
    WTF_MAKE_TZONE_ALLOCATED(DOMImplementation);
public:
    explicit DOMImplementation(Document&);

    void ref() { m_document->ref(); }
    void deref() { m_document->deref(); }
    Document& document() { return m_document; }

    WEBCORE_EXPORT ExceptionOr<Ref<DocumentType>> createDocumentType(const AtomString& qualifiedName, const String& publicId, const String& systemId);
    WEBCORE_EXPORT ExceptionOr<Ref<XMLDocument>> createDocument(const AtomString& namespaceURI, const AtomString& qualifiedName, DocumentType*);
    WEBCORE_EXPORT Ref<HTMLDocument> createHTMLDocument(String&& title);
    static bool hasFeature() { return true; }

private:
    WeakRef<Document, WeakPtrImplWithEventTargetData> m_document;
};

} // namespace WebCore
