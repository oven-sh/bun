/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2025 Apple Inc. All rights reserved.
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

#include "CollectionIndexCache.h"
#include "Element.h"
#include "HTMLNames.h"
#include "LiveNodeList.h"
#include <wtf/HashMap.h>
#include <wtf/ThreadAssertions.h>

namespace WebCore {

class CollectionNamedElementCache {
    WTF_MAKE_TZONE_ALLOCATED(CollectionNamedElementCache);
public:
    inline const Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* findElementsWithId(const AtomString& id) const;
    inline const Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* findElementsWithName(const AtomString& name) const;
    const Vector<AtomString>& propertyNames() const LIFETIME_BOUND { return m_propertyNames; }
    
    inline void appendToIdCache(const AtomString& id, Element&);
    inline void appendToNameCache(const AtomString& name, Element&);
    inline void didPopulate();

    inline size_t memoryCost() const;

private:
    typedef HashMap<AtomStringImpl*, Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>> StringToElementsMap;

    inline const Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* find(const StringToElementsMap&, const AtomString& key) const;
    inline void append(StringToElementsMap&, const AtomString& key, Element&);

    StringToElementsMap m_idMap;
    StringToElementsMap m_nameMap;
    Vector<AtomString> m_propertyNames;

#if ASSERT_ENABLED
    bool m_didPopulate { false };
#endif
};

// HTMLCollection subclasses NodeList to maintain legacy ObjC API compatibility.
class HTMLCollection : public NodeList {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(HTMLCollection, WEBCORE_EXPORT);
public:
    WEBCORE_EXPORT virtual ~HTMLCollection();

    // DOM API
    Element* item(unsigned index) const override = 0; // Tighten return type from NodeList::item().
    virtual Element* namedItem(const AtomString& name) const = 0;
    const Vector<AtomString>& supportedPropertyNames();
    bool isSupportedPropertyName(const AtomString& name);

    // Non-DOM API
    Vector<Ref<Element>> namedItems(const AtomString& name) const;
    size_t memoryCost() const override;

    inline bool isRootedAtTreeScope() const;
    inline NodeListInvalidationType invalidationType() const;
    inline CollectionType type() const;
    ContainerNode& ownerNode() const { return m_ownerNode; }
    inline ContainerNode& rootNode() const;
    inline void invalidateCacheForAttribute(const QualifiedName& attributeName);
    WEBCORE_EXPORT virtual void invalidateCacheForDocument(Document&);
    inline void invalidateCache();

    inline bool hasNamedElementCache() const;

protected:
    HTMLCollection(ContainerNode& base, CollectionType);

    WEBCORE_EXPORT virtual void updateNamedElementCache() const;
    // CachedHTMLCollection<>::namedItem(), which upstream instantiates for each collection class.
    Element* namedItemMatching(const AtomString& name, CollectionTraversalType, bool (*elementMatches)(const HTMLCollection&, Element&)) const;
    WEBCORE_EXPORT Element* namedItemSlow(const AtomString& name) const;

    inline void setNamedItemCache(std::unique_ptr<CollectionNamedElementCache>) const;
    inline const CollectionNamedElementCache& namedItemCaches() const;

    inline Document& document() const;

    void invalidateNamedElementCache(Document&) const;

    enum class RootType : bool { AtNode, AtTreeScope };
    static RootType LEGACY_NODELETE rootTypeFromCollectionType(CollectionType);

    mutable Lock m_namedElementCacheAssignmentLock;

    const unsigned m_collectionType : 5; // CollectionType
    const unsigned m_invalidationType : 4; // NodeListInvalidationType
    const unsigned m_rootType : 1; // RootType

    const Ref<ContainerNode> m_ownerNode;

    // Only mutated on the main thread while holding m_namedElementCacheAssignmentLock, so
    // main-thread reads use assertIsOwnerThread() instead of locking; memoryCost() runs on the
    // GC thread and must lock even to read.
    mutable std::unique_ptr<CollectionNamedElementCache> m_namedElementCache WTF_GUARDED_BY_LOCK(m_namedElementCacheAssignmentLock);
    WTF_DECLARE_OWNER_THREAD_ASSERTIONS(m_namedElementCacheAssignmentLock, anyThreadLike);
};

inline size_t CollectionNamedElementCache::memoryCost() const
{
    // memoryCost() may be invoked concurrently from a GC thread. This is safe because
    // the named element cache is immutable after creation and its lifetime is protected
    // by m_namedElementCacheAssignmentLock in HTMLCollection::memoryCost().
    return m_idMap.byteSize() + m_nameMap.byteSize() + m_propertyNames.capacity() * sizeof(AtomString);
}

inline CollectionType HTMLCollection::type() const
{
    return static_cast<CollectionType>(m_collectionType);
}

} // namespace WebCore

#define SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(ClassName) \
SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ClassName) \
    static bool isType(const WebCore::HTMLCollection& collection) { return collection.type() == WebCore::CollectionClassTraits<WebCore::ClassName>::collectionType; } \
SPECIALIZE_TYPE_TRAITS_END()
