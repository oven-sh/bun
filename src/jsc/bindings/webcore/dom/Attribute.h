/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Peter Kelly (pmk@post.com)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2008, 2012, 2014 Apple Inc. All rights reserved.
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

#include "CommonAtomStrings.h"
#include "QualifiedName.h"
#include <wtf/Hasher.h>

namespace WebCore {

// This has no counterpart in DOM.
// It is an internal representation of the node value of an Attr.
// The actual Attr with its value as a Text child is allocated only if needed.
class Attribute {
public:
    Attribute(const QualifiedName& name, const AtomString& value)
        : m_name(name)
        , m_value(value)
    {
    }

    Attribute(QualifiedName&& name, AtomString&& value)
        : m_name(WTF::move(name))
        , m_value(WTF::move(value))
    {
    }

    // NOTE: The references returned by these functions are only valid for as long
    // as the Attribute stays in place. For example, calling a function that mutates
    // an Element's internal attribute storage may invalidate them.
    const AtomString& value() const LIFETIME_BOUND { return m_value; }
    static constexpr ptrdiff_t valueMemoryOffset() { return OBJECT_OFFSETOF(Attribute, m_value); }
    const AtomString& prefix() const LIFETIME_BOUND { return m_name.prefix(); }
    const AtomString& localName() const LIFETIME_BOUND { return m_name.localName(); }
    const AtomString& localNameLowercase() const LIFETIME_BOUND { return m_name.localNameLowercase(); }
    const AtomString& namespaceURI() const LIFETIME_BOUND { return m_name.namespaceURI(); }

    const QualifiedName& name() const LIFETIME_BOUND { return m_name; }
    static constexpr ptrdiff_t nameMemoryOffset() { return OBJECT_OFFSETOF(Attribute, m_name); }

    bool isEmpty() const { return m_value.isEmpty(); }
    static bool nameMatchesFilter(const QualifiedName&, const AtomString& filterPrefix, const AtomString& filterLocalName, const AtomString& filterNamespaceURI);
    bool matches(const AtomString& prefix, const AtomString& localName, const AtomString& namespaceURI) const;

    void setValue(const AtomString& value) { m_value = value; }

    // Note: This API is only for HTMLTreeBuilder.  It is not safe to change the
    // name of an attribute once parseAttribute has been called as DOM
    // elements may have placed the Attribute in a hash by name.
    void parserSetName(const QualifiedName& name) { m_name = name; }

#if COMPILER(MSVC)
    // NOTE: This constructor is not actually implemented, it's just defined so MSVC
    // will let us use a zero-length array of Attributes.
    Attribute();
#endif

private:
    QualifiedName m_name;
    AtomString m_value;
};

inline void add(Hasher& hasher, const Attribute& attribute)
{
    add(hasher, attribute.name(), attribute.value());
}

inline bool Attribute::nameMatchesFilter(const QualifiedName& name, const AtomString& filterPrefix, const AtomString& filterLocalName, const AtomString& filterNamespaceURI)
{
    if (filterLocalName != name.localName())
        return false;
    return filterPrefix == starAtom() || filterNamespaceURI == name.namespaceURI();
}

inline bool Attribute::matches(const AtomString& prefix, const AtomString& localName, const AtomString& namespaceURI) const
{
    return nameMatchesFilter(m_name, prefix, localName, namespaceURI);
}

} // namespace WebCore

namespace WTF {

template<>
struct VectorTraits<WebCore::Attribute> : SimpleClassVectorTraits { };

} // namespace WTF
