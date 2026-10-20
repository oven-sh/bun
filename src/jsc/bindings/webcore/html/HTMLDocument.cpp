/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2007, 2008 Apple Inc. All rights reserved.
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
 * Portions are Copyright (C) 2002 Netscape Communications Corporation.
 * Other contributors: David Baron <dbaron@fas.harvard.edu>
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Alternatively, the document type parsing portions of this file may be used
 * under the terms of either the Mozilla Public License Version 1.1, found at
 * http://www.mozilla.org/MPL/ (the "MPL") or the GNU General Public
 * License Version 2.0, found at http://www.fsf.org/copyleft/gpl.html
 * (the "GPL"), in which case the provisions of the MPL or the GPL are
 * applicable instead of those above.  If you wish to allow use of your
 * version of this file only under the terms of one of those two
 * licenses (the MPL or the GPL) and not to allow others to use your
 * version of this file under the LGPL, indicate your decision by
 * deleting the provisions above and replace them with the notice and
 * other provisions required by the MPL or the GPL, as the case may be.
 * If you do not delete the provisions above, a recipient may use your
 * version of this file under any of the LGPL, the MPL or the GPL.
 */

#include "config.h"
#include "HTMLDocument.h"

#include "CommonVM.h"
#include "HTMLCollection.h"
#include "HTMLDocumentParser.h"
#include "HTMLNames.h"
#include <ranges>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLDocument);

using namespace HTMLNames;

HTMLDocument::HTMLDocument(ScriptExecutionContext& context, const URL& url, DocumentClasses documentClasses)
    : Document(context, url, documentClasses | DocumentClasses(DocumentClass::HTML))
{
    clearXMLVersion();
}

HTMLDocument::~HTMLDocument() = default;

Ref<DocumentParser> HTMLDocument::createParser()
{
    return HTMLDocumentParser::create(*this, parserContentPolicy());
}

// https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem
std::optional<Variant<Ref<Element>, Ref<HTMLCollection>>> HTMLDocument::namedItem(const AtomString& name)
{
    if (!isSupportedPropertyName(name))
        return std::nullopt;

    if (documentNamedItemContainsMultipleElements(name)) [[unlikely]] {
        Ref collection = documentNamedItems(name);
        ASSERT(collection->length() > 1);
        return Variant<Ref<Element>, Ref<HTMLCollection>> { WTF::move(collection) };
    }

    return Variant<Ref<Element>, Ref<HTMLCollection>> { documentNamedItem(name).releaseNonNull() };
}

bool HTMLDocument::isSupportedPropertyName(const AtomString& name) const
{
    // As in Chrome and jsdom, what DOMParser or createHTMLDocument() made has none.
    return window() && !name.isNull() && hasDocumentNamedItem(name);
}

Vector<AtomString> HTMLDocument::supportedPropertyNames() const
{
    if (!window())
        return { };
    auto properties = m_documentNamedItem.keys();
    // The specification says these should be sorted in document order but this would be expensive
    // and other browser engines do not comply with this part of the specification. For now, just
    // do an alphabetical sort to get consistent results.
    std::ranges::sort(properties, WTF::codePointCompareLessThan);
    return properties;
}

void HTMLDocument::addDocumentNamedItem(const AtomString& name, Element& item)
{
    m_documentNamedItem.add(name, item, *this);
    addImpureProperty(name);
}

void HTMLDocument::removeDocumentNamedItem(const AtomString& name, Element& item)
{
    m_documentNamedItem.remove(name, item);
}

void HTMLDocument::addWindowNamedItem(const AtomString& name, Element& item)
{
    m_windowNamedItem.add(name, item, *this);
}

void HTMLDocument::removeWindowNamedItem(const AtomString& name, Element& item)
{
    m_windowNamedItem.remove(name, item);
}

}
