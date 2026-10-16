/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004, 2006, 2007, 2008, 2009 Apple Inc. All rights reserved.
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

#include "Document.h"
#include "TreeScopeOrderedMap.h"

namespace WebCore {

class HTMLDocument : public Document {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(HTMLDocument, WEBCORE_EXPORT);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLDocument);
public:
    static Ref<HTMLDocument> create(ScriptExecutionContext&, const URL&);
    virtual ~HTMLDocument();
    
    std::optional<Variant<Ref<Element>, Ref<HTMLCollection>>> namedItem(const AtomString&);
    Vector<AtomString> supportedPropertyNames() const;
    bool LEGACY_NODELETE isSupportedPropertyName(const AtomString&) const;

    RefPtr<Element> documentNamedItem(const AtomString& name) const { return m_documentNamedItem.getElementByDocumentNamedItem(name, *this); }
    bool hasDocumentNamedItem(const AtomString& name) const { return m_documentNamedItem.contains(name); }
    bool documentNamedItemContainsMultipleElements(const AtomString& name) const { return m_documentNamedItem.containsMultiple(name); }
    void addDocumentNamedItem(const AtomString&, Element&);
    void removeDocumentNamedItem(const AtomString&, Element&);

    RefPtr<Element> windowNamedItem(const AtomString& name) const { return m_windowNamedItem.getElementByWindowNamedItem(name, *this); }
    bool hasWindowNamedItem(const AtomString& name) const { return m_windowNamedItem.contains(name); }
    bool windowNamedItemContainsMultipleElements(const AtomString& name) const { return m_windowNamedItem.containsMultiple(name); }
    void addWindowNamedItem(const AtomString&, Element&);
    void removeWindowNamedItem(const AtomString&, Element&);

protected:
    WEBCORE_EXPORT HTMLDocument(ScriptExecutionContext&, const URL&, DocumentClasses = { });

private:
    Ref<DocumentParser> createParser() override;

    TreeScopeOrderedMap m_documentNamedItem;
    TreeScopeOrderedMap m_windowNamedItem;
};

inline Ref<HTMLDocument> HTMLDocument::create(ScriptExecutionContext& context, const URL& url)
{
    return adoptRef(*new HTMLDocument(context, url, { DocumentClass::HTML }));
}

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLDocument)
    static bool isType(const WebCore::Document& document) { return document.isHTMLDocument(); }
    static bool isType(const WebCore::Node& node)
    {
        auto* document = dynamicDowncast<WebCore::Document>(node);
        return document && isType(*document);
    }
SPECIALIZE_TYPE_TRAITS_END()
