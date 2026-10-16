/*
 * Copyright (C) 2008-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2008 David Smith <catfish.man@gmail.com>
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

#include "ChildNodeList.h"
#include "CommonAtomStrings.h"
#include "HTMLCollection.h"
#include "HTMLSlotElement.h"
#include "MutationObserverRegistration.h"
#include "QualifiedName.h"
#include "TagCollection.h"
#include <new>
#include <wtf/HashSet.h>
#include <wtf/NoVirtualDestructorBase.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/WeakHashSet.h>

namespace WebCore {

class LabelsNodeList;
class LiveNodeList;
class NameNodeList;
class RadioNodeList;

template<typename ListType> struct NodeListTypeIdentifier;

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(NodeListsNodeData);
class NodeListsNodeData {
    WTF_MAKE_NONCOPYABLE(NodeListsNodeData);
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(NodeListsNodeData, NodeListsNodeData);
public:
    NodeListsNodeData() = default;

    void clearChildNodeListCache()
    {
        if (RefPtr childNodeList = m_childNodeList.get())
            childNodeList->invalidateCache();
    }

    Ref<ChildNodeList> ensureChildNodeList(ContainerNode& node)
    {
        ASSERT(!m_emptyChildNodeList);
        if (m_childNodeList)
            return *m_childNodeList;
        Ref list = ChildNodeList::create(node);
        m_childNodeList = list.ptr();
        return list;
    }

    void removeChildNodeList(ChildNodeList* list)
    {
        ASSERT(m_childNodeList == list);
        Ref ownerNode = list->ownerNode();
        if (deleteThisAndUpdateNodeRareDataIfAboutToRemoveLastList(ownerNode))
            return;
        m_childNodeList = nullptr;
    }

    Ref<EmptyNodeList> ensureEmptyChildNodeList(Node& node)
    {
        ASSERT(!m_childNodeList);
        if (m_emptyChildNodeList)
            return *m_emptyChildNodeList;
        Ref list = EmptyNodeList::create(node);
        m_emptyChildNodeList = list.ptr();
        return list;
    }

    void removeEmptyChildNodeList(EmptyNodeList* list)
    {
        ASSERT(m_emptyChildNodeList == list);
        Ref ownerNode = list->ownerNode();
        if (deleteThisAndUpdateNodeRareDataIfAboutToRemoveLastList(ownerNode))
            return;
        m_emptyChildNodeList = nullptr;
    }

    struct NodeListCacheMapEntryHash {
        static unsigned hash(const std::pair<unsigned char, AtomString>& entry)
        {
            return DefaultHash<AtomString>::hash(entry.second) + entry.first;
        }
        static bool equal(const std::pair<unsigned char, AtomString>& a, const std::pair<unsigned char, AtomString>& b) { return a.first == b.first && DefaultHash<AtomString>::equal(a.second, b.second); }
        static const bool safeToCompareToEmptyOrDeleted = DefaultHash<AtomString>::safeToCompareToEmptyOrDeleted;
    };

    using NodeListCacheMap = HashMap<std::pair<unsigned char, AtomString>, LiveNodeList*, NodeListCacheMapEntryHash>;
    using CollectionCacheMap = HashMap<std::pair<std::underlying_type_t<CollectionType>, AtomString>, HTMLCollection*, NodeListCacheMapEntryHash>;
    using TagCollectionNSCache = HashMap<QualifiedName, TagCollectionNS*>;

    template<typename T, typename ContainerType>
    ALWAYS_INLINE Ref<T> addCacheWithAtomName(ContainerType& container, const AtomString& name)
    {
        auto result = m_atomNameCaches.fastAdd(namedNodeListKey<T>(name), nullptr);
        if (!result.isNewEntry)
            return downcast<T>(*result.iterator->value);
        Ref list = T::create(container, name);
        result.iterator->value = list.ptr();
        return list;
    }

    ALWAYS_INLINE Ref<TagCollectionNS> addCachedTagCollectionNS(ContainerNode& node, const AtomString& namespaceURI, const AtomString& localName)
    {
        auto result = m_tagCollectionNSCache.fastAdd(QualifiedName { nullAtom(), localName, namespaceURI }, nullptr);
        if (!result.isNewEntry)
            return *result.iterator->value;

        Ref list = TagCollectionNS::create(node, namespaceURI, localName);
        result.iterator->value = list.ptr();
        return list;
    }

    template<typename T, typename ContainerType>
    ALWAYS_INLINE Ref<T> addCachedCollection(ContainerType& container, const AtomString& name)
    {
        auto result = m_cachedCollections.fastAdd(namedCollectionKey(CollectionClassTraits<T>::collectionType, name), nullptr);
        if (!result.isNewEntry)
            return downcast<T>(*result.iterator->value);

        Ref list = T::create(container, CollectionClassTraits<T>::collectionType, name);
        result.iterator->value = list.ptr();
        return list;
    }

    template<typename T, typename ContainerType>
    ALWAYS_INLINE Ref<T> addCachedCollection(ContainerType& container)
    {
        auto result = m_cachedCollections.fastAdd(namedCollectionKey(CollectionClassTraits<T>::collectionType, starAtom()), nullptr);
        if (!result.isNewEntry)
            return downcast<T>(*result.iterator->value);

        Ref list = T::create(container, CollectionClassTraits<T>::collectionType);
        result.iterator->value = list.ptr();
        return list;
    }

    template<typename T>
    T* cachedCollection(CollectionType collectionType)
    {
        if constexpr (std::same_as<T, HTMLCollection>)
            return m_cachedCollections.get(namedCollectionKey(collectionType, starAtom()));
        else
            return downcast<T>(m_cachedCollections.get(namedCollectionKey(collectionType, starAtom())));
    }

    template<typename NodeListType>
    void removeCacheWithAtomName(NodeListType& list, const AtomString& name)
    {
        ASSERT(&list == m_atomNameCaches.get(namedNodeListKey<NodeListType>(name)));
        Ref<Node> ownerNode = list.ownerNode();
        if (deleteThisAndUpdateNodeRareDataIfAboutToRemoveLastList(ownerNode))
            return;
        m_atomNameCaches.remove(namedNodeListKey<NodeListType>(name));
    }

    void removeCachedTagCollectionNS(HTMLCollection& collection, const AtomString& namespaceURI, const AtomString& localName)
    {
        QualifiedName name(nullAtom(), localName, namespaceURI);
        ASSERT(&collection == m_tagCollectionNSCache.get(name));
        if (deleteThisAndUpdateNodeRareDataIfAboutToRemoveLastList(collection.ownerNode()))
            return;
        m_tagCollectionNSCache.remove(name);
    }

    inline void removeCachedCollection(HTMLCollection*, const AtomString& = starAtom());

    void invalidateCaches();
    void invalidateCachesForAttribute(const QualifiedName& attrName);

    void adoptTreeScope()
    {
        invalidateCaches();
    }

    inline void adoptDocument(Document& oldDocument, Document& newDocument);

private:
    std::pair<std::underlying_type_t<CollectionType>, AtomString> namedCollectionKey(CollectionType type, const AtomString& name)
    {
        return { std::to_underlying(type), name };
    }

    template<typename NodeListType>
    std::pair<unsigned char, AtomString> namedNodeListKey(const AtomString& name)
    {
        return std::pair<unsigned char, AtomString>(NodeListTypeIdentifier<NodeListType>::value(), name);
    }

    bool deleteThisAndUpdateNodeRareDataIfAboutToRemoveLastList(Node&);

    // These two are currently mutually exclusive and could be unioned. Not very important as this class is large anyway.
    SingleThreadWeakPtr<ChildNodeList> m_childNodeList;
    SingleThreadWeakPtr<EmptyNodeList> m_emptyChildNodeList;

    NodeListCacheMap m_atomNameCaches;
    TagCollectionNSCache m_tagCollectionNSCache;
    CollectionCacheMap m_cachedCollections;
};

class NodeMutationObserverData {
    WTF_MAKE_TZONE_ALLOCATED(NodeMutationObserverData);
    WTF_MAKE_NONCOPYABLE(NodeMutationObserverData);
public:
    Vector<Ref<MutationObserverRegistration>> registry;
    WeakHashSet<MutationObserverRegistration> transientRegistry;

    NodeMutationObserverData() = default;
};

DECLARE_COMPACT_ALLOCATOR_WITH_HEAP_IDENTIFIER(NodeRareData);
class NodeRareData : public NoVirtualDestructorBase {
    WTF_MAKE_NONCOPYABLE(NodeRareData);
    WTF_DEPRECATED_MAKE_STRUCT_FAST_COMPACT_ALLOCATED_WITH_HEAP_IDENTIFIER(NodeRareData, NodeRareData);
public:
#if defined(DUMP_NODE_STATISTICS) && DUMP_NODE_STATISTICS
    enum class UseType : uint32_t {
        TabIndex = 1 << 0,
        ChildIndex = 1 << 1,
        NodeList = 1 << 2,
        MutationObserver = 1 << 3,
        ManuallyAssignedSlot = 1 << 4,
        ScrollingPosition = 1 << 5,
        ComputedStyle = 1 << 6,
        EffectiveLang = 1 << 7,
        Dataset = 1 << 8,
        ClassList = 1 << 9,
        CustomElementReactionQueue = 1 << 11,
        CustomElementDefaultARIA = 1 << 12,
        FormAssociatedCustomElement = 1 << 13,
        AttributeMap = 1 << 14,
        InteractionObserver = 1 << 15,
        ResizeObserver = 1 << 16,
        Animations = 1 << 17,
        PseudoElements = 1 << 18,
        AttributeStyleMap = 1 << 19,
        ComputedStyleMap = 1 << 20,
        PartList = 1 << 21,
        PartNames = 1 << 22,
        Nonce = 1 << 23,
        ExplicitlySetAttrElementsMap = 1 << 24,
        Popover = 1 << 25,
        DisplayContentsOrNoneStyle = 1 << 26,
        CustomStateSet = 1 << 27,
        UserInfo = 1 << 28,
        InvokedPopover = 1 << 29,
    };
#endif

    enum class Type { Element, Node };

    NodeRareData(Type type = Type::Node)
        : m_isElementRareData(type == Type::Element)
    {
    }

    bool isElementRareData() const { return m_isElementRareData; }

    void clearNodeLists() { m_nodeLists = nullptr; }
    NodeListsNodeData* nodeLists() const LIFETIME_BOUND { return m_nodeLists.get(); }
    NodeListsNodeData& ensureNodeLists() LIFETIME_BOUND
    {
        if (!m_nodeLists)
            m_nodeLists = makeUnique<NodeListsNodeData>();
        return *m_nodeLists;
    }

    NodeMutationObserverData* mutationObserverDataIfExists() const LIFETIME_BOUND { return m_mutationObserverData.get(); }
    NodeMutationObserverData& mutationObserverData() const LIFETIME_BOUND
    {
        if (!m_mutationObserverData)
            lazyInitialize(m_mutationObserverData, makeUnique<NodeMutationObserverData>());
        return *m_mutationObserverData;
    }

    // https://html.spec.whatwg.org/multipage/scripting.html#manually-assigned-nodes
    HTMLSlotElement* manuallyAssignedSlot() { return m_manuallyAssignedSlot.get(); }
    void setManuallyAssignedSlot(HTMLSlotElement* slot) { m_manuallyAssignedSlot = slot; }

#if DUMP_NODE_STATISTICS
    OptionSet<UseType> useTypes() const
    {
        OptionSet<UseType> result;
        if (m_nodeLists)
            result.add(UseType::NodeList);
        if (m_mutationObserverData)
            result.add(UseType::MutationObserver);
        if (m_manuallyAssignedSlot)
            result.add(UseType::ManuallyAssignedSlot);
        return result;
    }
#endif

    void operator delete(NodeRareData*, std::destroying_delete_t);

private:
    std::unique_ptr<NodeListsNodeData> m_nodeLists;
    const std::unique_ptr<NodeMutationObserverData> m_mutationObserverData;
    WeakPtr<HTMLSlotElement, WeakPtrImplWithEventTargetData> m_manuallyAssignedSlot;
    bool m_isElementRareData; // Keep last for better bit packing with ElementRareData.
};

template<> struct NodeListTypeIdentifier<NameNodeList> {
    static constexpr unsigned char value() { return 0; }
};

template<> struct NodeListTypeIdentifier<RadioNodeList> {
    static constexpr unsigned char value() { return 1; }
};

template<> struct NodeListTypeIdentifier<LabelsNodeList> {
    static constexpr unsigned char value() { return 2; }
};

inline bool NodeListsNodeData::deleteThisAndUpdateNodeRareDataIfAboutToRemoveLastList(Node& ownerNode)
{
    ASSERT(ownerNode.nodeLists() == this);
    size_t listsCount = (m_childNodeList ? 1 : 0)
        + (m_emptyChildNodeList ? 1 : 0)
        + m_atomNameCaches.size()
        + m_tagCollectionNSCache.size()
        + m_cachedCollections.size();
    if (listsCount != 1)
        return false;
    ownerNode.clearNodeLists();
    return true;
}

inline NodeRareData& Node::ensureRareData()
{
    if (!hasRareData())
        materializeRareData();
    return *rareData();
}

} // namespace WebCore
