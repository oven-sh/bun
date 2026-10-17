/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2008, 2014-2016 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Nokia Corporation and/or its subsidiary(-ies)
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

#pragma once

#include "CollectionType.h"

namespace WebCore {

class TagCollection;
class TagCollectionNS;
class HTMLTagCollection;

template<>
struct CollectionClassTraits<TagCollection> {
    static constexpr CollectionType collectionType = CollectionType::ByTag;
};

template<>
struct CollectionClassTraits<TagCollectionNS> {
    static constexpr CollectionType collectionType = CollectionType::ByTag;
};

template<>
struct CollectionClassTraits<HTMLTagCollection> {
    static constexpr CollectionType collectionType = CollectionType::ByHTMLTag;
};

} // namespace WebCore

#include "CachedHTMLCollection.h"
#include "CommonAtomStrings.h"
#include <wtf/text/AtomString.h>

namespace WebCore {

// HTMLCollection that limits to a particular tag.
class TagCollection final : public CachedHTMLCollection<TagCollection> {
    WTF_MAKE_TZONE_ALLOCATED(TagCollection);
public:
    static Ref<TagCollection> create(ContainerNode& rootNode, CollectionType type, const AtomString& qualifiedName)
    {
        ASSERT_UNUSED(type, type == CollectionType::ByTag);
        return adoptRef(*new TagCollection(rootNode, qualifiedName));
    }

    virtual ~TagCollection();
    bool elementMatches(Element&) const;

private:
    TagCollection(ContainerNode& rootNode, const AtomString& qualifiedName);

    AtomString m_qualifiedName;
};

class TagCollectionNS final : public CachedHTMLCollection<TagCollectionNS> {
    WTF_MAKE_TZONE_ALLOCATED(TagCollectionNS);
public:
    static Ref<TagCollectionNS> create(ContainerNode& rootNode, const AtomString& namespaceURI, const AtomString& localName)
    {
        return adoptRef(*new TagCollectionNS(rootNode, namespaceURI, localName));
    }

    virtual ~TagCollectionNS();
    bool elementMatches(Element&) const;

private:
    TagCollectionNS(ContainerNode& rootNode, const AtomString& namespaceURI, const AtomString& localName);

    AtomString m_namespaceURI;
    AtomString m_localName;
};

class HTMLTagCollection final : public CachedHTMLCollection<HTMLTagCollection> {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTagCollection);
public:
    static Ref<HTMLTagCollection> create(ContainerNode& rootNode, CollectionType type, const AtomString& qualifiedName)
    {
        ASSERT_UNUSED(type, type == CollectionType::ByHTMLTag);
        return adoptRef(*new HTMLTagCollection(rootNode, qualifiedName));
    }

    virtual ~HTMLTagCollection();
    bool elementMatches(Element&) const;

private:
    HTMLTagCollection(ContainerNode& rootNode, const AtomString& qualifiedName);

    AtomString m_qualifiedName;
    AtomString m_loweredQualifiedName;
};

inline bool TagCollection::elementMatches(Element& element) const
{
    return m_qualifiedName == element.tagQName().toString();
}

inline bool TagCollectionNS::elementMatches(Element& element) const
{
    if (m_localName != starAtom() && m_localName != element.localName())
        return false;
    return m_namespaceURI == starAtom() || m_namespaceURI == element.namespaceURI();
}

inline bool HTMLTagCollection::elementMatches(Element& element) const
{
    if (element.isHTMLElement())
        return m_loweredQualifiedName == element.tagQName().toString();
    return m_qualifiedName == element.tagQName().toString();
}

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(TagCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(TagCollectionNS)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLTagCollection)
