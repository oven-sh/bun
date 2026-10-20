/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
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

#include "config.h"
#include "TagCollection.h"

#include "CachedHTMLCollectionInlines.h"
#include "NodeRareDataInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TagCollection);
WTF_MAKE_TZONE_ALLOCATED_IMPL(TagCollectionNS);
WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTagCollection);

TagCollectionNS::TagCollectionNS(ContainerNode& rootNode, const AtomString& namespaceURI, const AtomString& localName)
    : CachedHTMLCollection(rootNode, CollectionType::ByTag)
    , m_namespaceURI(namespaceURI)
    , m_localName(localName)
{
    ASSERT(m_namespaceURI.isNull() || !m_namespaceURI.isEmpty());
}

TagCollectionNS::~TagCollectionNS()
{
    ownerNode().nodeLists()->removeCachedTagCollectionNS(*this, m_namespaceURI, m_localName);
}

TagCollection::TagCollection(ContainerNode& rootNode, const AtomString& qualifiedName)
    : CachedHTMLCollection(rootNode, CollectionType::ByTag)
    , m_qualifiedName(qualifiedName)
{
    ASSERT(qualifiedName != starAtom());
}

TagCollection::~TagCollection()
{
    ownerNode().nodeLists()->removeCachedCollection(this, m_qualifiedName);
}

HTMLTagCollection::HTMLTagCollection(ContainerNode& rootNode, const AtomString& qualifiedName)
    : CachedHTMLCollection(rootNode, CollectionType::ByHTMLTag)
    , m_qualifiedName(qualifiedName)
    , m_loweredQualifiedName(qualifiedName.convertToASCIILowercase())
{
    ASSERT(qualifiedName != starAtom());
}

HTMLTagCollection::~HTMLTagCollection()
{
    ownerNode().nodeLists()->removeCachedCollection(this, m_qualifiedName);
}

} // namespace WebCore
