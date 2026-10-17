/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Peter Kelly (pmk@post.com)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009, 2013 Apple Inc. All rights reserved.
 *           (C) 2007 Eric Seidel (eric@webkit.org)
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
 */

#include "config.h"
#include "NamedNodeMap.h"

#include "Attr.h"
#include "ElementInlines.h"
#include "HTMLElement.h"
#include "ScriptWrappableInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

using namespace HTMLNames;

WTF_MAKE_TZONE_ALLOCATED_IMPL(NamedNodeMap);

void NamedNodeMap::ref()
{
    m_element->ref();
}

void NamedNodeMap::deref()
{
    m_element->deref();
}

RefPtr<Attr> NamedNodeMap::getNamedItem(const AtomString& name) const
{
    return protect(element())->getAttributeNode(name);
}

bool NamedNodeMap::isSupportedPropertyName(const AtomString& name) const
{
    return protect(element())->hasAttribute(name);
}

RefPtr<Attr> NamedNodeMap::getNamedItemNS(const AtomString& namespaceURI, const AtomString& localName) const
{
    return protect(element())->getAttributeNodeNS(namespaceURI, localName);
}

ExceptionOr<Ref<Attr>> NamedNodeMap::removeNamedItem(const AtomString& name)
{
    Ref element = m_element.get();
    if (!element->hasAttributes())
        return Exception { ExceptionCode::NotFoundError };
    auto index = element->findAttributeIndexByName(name, shouldIgnoreAttributeCase(m_element));
    if (index == ElementData::attributeNotFound)
        return Exception { ExceptionCode::NotFoundError };
    return element->detachAttribute(index);
}

Element& NamedNodeMap::element() const
{
    return m_element.get();
}

Vector<String> NamedNodeMap::supportedPropertyNames() const
{
    Vector<String> names = protect(m_element.get())->getAttributeNames();
    if (is<HTMLElement>(m_element.get()) && m_element->document().isHTMLDocument()) {
        names.removeAllMatching([](String& name) {
            for (auto character : StringView { name }.codeUnits()) {
                if (isASCIIUpper(character))
                    return true;
            }
            return false;
        });
    }
    return names;
}

ExceptionOr<Ref<Attr>> NamedNodeMap::removeNamedItemNS(const AtomString& namespaceURI, const AtomString& localName)
{
    Ref element = m_element.get();
    if (!element->hasAttributes())
        return Exception { ExceptionCode::NotFoundError };
    auto index = element->findAttributeIndexByName(QualifiedName { nullAtom(), localName, namespaceURI });
    if (index == ElementData::attributeNotFound)
        return Exception { ExceptionCode::NotFoundError };
    return element->detachAttribute(index);
}

ExceptionOr<RefPtr<Attr>> NamedNodeMap::setNamedItem(Attr& attr)
{
    return protect(element())->setAttributeNode(attr);
}

RefPtr<Attr> NamedNodeMap::item(unsigned index) const
{
    if (index >= length())
        return nullptr;
    Ref element = m_element.get();
    return element->ensureAttr(element->attributeAt(index).name());
}

unsigned NamedNodeMap::length() const
{
    Ref element = m_element;
    if (!element->hasAttributes())
        return 0;
    return element->attributeCount();
}

} // namespace WebCore
