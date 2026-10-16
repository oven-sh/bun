/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "CollectionIndexCacheInlines.h"
#include "LiveNodeList.h"
#include "NodeInlines.h"
#include "TreeScopeInlines.h"

namespace WebCore {

ALWAYS_INLINE bool shouldInvalidateTypeOnAttributeChange(NodeListInvalidationType type, const QualifiedName& attrName)
{
    switch (type) {
    case NodeListInvalidationType::InvalidateOnClassAttrChange:
        return attrName == HTMLNames::classAttr;
    case NodeListInvalidationType::InvalidateOnNameAttrChange:
        return attrName == HTMLNames::nameAttr;
    case NodeListInvalidationType::InvalidateOnIdNameAttrChange:
        return attrName == HTMLNames::idAttr || attrName == HTMLNames::nameAttr;
    case NodeListInvalidationType::InvalidateOnForTypeAttrChange:
        return attrName == HTMLNames::forAttr || attrName == HTMLNames::typeAttr;
    case NodeListInvalidationType::InvalidateForFormControls:
        return attrName == HTMLNames::nameAttr || attrName == HTMLNames::idAttr || attrName == HTMLNames::forAttr
            || attrName == HTMLNames::formAttr || attrName == HTMLNames::typeAttr;
    case NodeListInvalidationType::InvalidateOnHRefAttrChange:
        return attrName == HTMLNames::hrefAttr;
    case NodeListInvalidationType::DoNotInvalidateOnAttributeChanges:
        return false;
    case NodeListInvalidationType::InvalidateOnAnyAttrChange:
        return true;
    }
    return false;
}

inline void LiveNodeList::invalidateCache() const
{
    invalidateCacheForDocument(protect(document()).get());
}

ALWAYS_INLINE void LiveNodeList::invalidateCacheForAttribute(const QualifiedName& attributeName) const
{
    if (shouldInvalidateTypeOnAttributeChange(m_invalidationType, attributeName))
        invalidateCache();
}

inline Document& LiveNodeList::document() const
{
    return m_ownerNode->document();
}

inline ContainerNode& LiveNodeList::rootNode() const
{
    if (isRootedAtTreeScope() && m_ownerNode->isInTreeScope())
        return m_ownerNode->treeScope().rootNode();
    return m_ownerNode;
}

template <class NodeListType, CollectionTraversalType traversalType>
CachedLiveNodeList<NodeListType, traversalType>::CachedLiveNodeList(ContainerNode& ownerNode, LiveNodeListType type, NodeListInvalidationType invalidationType)
    : LiveNodeList(ownerNode, type, invalidationType)
{
}

template <class NodeListType, CollectionTraversalType traversalType>
CachedLiveNodeList<NodeListType, traversalType>::~CachedLiveNodeList()
{
    if (m_indexCache.hasValidCache())
        protect(document())->unregisterNodeListForInvalidation(*this);
}

template <class NodeListType, CollectionTraversalType traversalType>
unsigned CachedLiveNodeList<NodeListType, traversalType>::length() const
{
    return m_indexCache.nodeCount(uncheckedDowncast<NodeListType>(*this));
}

template <class NodeListType, CollectionTraversalType traversalType>
Node* CachedLiveNodeList<NodeListType, traversalType>::item(unsigned offset) const
{
    return m_indexCache.nodeAt(uncheckedDowncast<NodeListType>(*this), offset);
}

template <class NodeListType, CollectionTraversalType traversalType>
auto CachedLiveNodeList<NodeListType, traversalType>::collectionBegin() const -> Iterator
{
    return Traversal::begin(uncheckedDowncast<NodeListType>(*this), protect(rootNode()));
}

template <class NodeListType, CollectionTraversalType traversalType>
auto CachedLiveNodeList<NodeListType, traversalType>::collectionLast() const -> Iterator
{
    return Traversal::last(uncheckedDowncast<NodeListType>(*this), protect(rootNode()));
}

template <class NodeListType, CollectionTraversalType traversalType>
void CachedLiveNodeList<NodeListType, traversalType>::collectionTraverseForward(Iterator& current, unsigned count, unsigned& traversedCount) const
{
    Traversal::traverseForward(uncheckedDowncast<NodeListType>(*this), current, count, traversedCount);
}

template <class NodeListType, CollectionTraversalType traversalType>
void CachedLiveNodeList<NodeListType, traversalType>::collectionTraverseBackward(Iterator& current, unsigned count) const
{
    Traversal::traverseBackward(uncheckedDowncast<NodeListType>(*this), current, count);
}

template <class NodeListType, CollectionTraversalType traversalType>
bool CachedLiveNodeList<NodeListType, traversalType>::collectionCanTraverseBackward() const
{
    return true;
}

template <class NodeListType, CollectionTraversalType traversalType>
void CachedLiveNodeList<NodeListType, traversalType>::willValidateIndexCache() const
{
    protect(document())->registerNodeListForInvalidation(const_cast<CachedLiveNodeList&>(*this));
}

template <class NodeListType, CollectionTraversalType traversalType>
void CachedLiveNodeList<NodeListType, traversalType>::invalidateCacheForDocument(Document& document) const
{
    if (m_indexCache.hasValidCache()) {
        document.unregisterNodeListForInvalidation(const_cast<CachedLiveNodeList&>(*this));
        m_indexCache.invalidate();
    }
}


}
