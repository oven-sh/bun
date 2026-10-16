/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2017 Apple Inc. All rights reserved.
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
#include "ContainerNode.h"
#include "NodeList.h"
#include <wtf/CheckedRef.h>
#include <wtf/Ref.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class EmptyNodeList final : public NodeList, public CanMakeSingleThreadWeakPtr<EmptyNodeList> {
    WTF_MAKE_TZONE_ALLOCATED(EmptyNodeList);
public:
    static Ref<EmptyNodeList> create(Node& owner)
    {
        return adoptRef(*new EmptyNodeList(owner));
    }
    virtual ~EmptyNodeList();

    Node& ownerNode() { return m_owner; }

private:
    explicit EmptyNodeList(Node& owner) : m_owner(owner) { }

    unsigned length() const override { return 0; }
    Node* item(unsigned) const override { return nullptr; }
    size_t memoryCost() const override { return 0; }

    bool isEmptyNodeList() const override { return true; }

    const Ref<Node> m_owner;
};

class ChildNodeList final : public NodeList, public CanMakeSingleThreadWeakPtr<ChildNodeList> {
    WTF_MAKE_TZONE_ALLOCATED(ChildNodeList);
public:
    static Ref<ChildNodeList> create(ContainerNode& parent)
    {
        return adoptRef(*new ChildNodeList(parent));
    }

    virtual ~ChildNodeList();

    ContainerNode& ownerNode() { return m_parent; }

    void invalidateCache();

    // For CollectionIndexCache
    Node* LEGACY_NODELETE collectionBegin() const;
    Node* LEGACY_NODELETE collectionLast() const;
    void LEGACY_NODELETE collectionTraverseForward(Node*&, unsigned count, unsigned& traversedCount) const;
    void LEGACY_NODELETE collectionTraverseBackward(Node*&, unsigned count) const;
    bool collectionCanTraverseBackward() const { return true; }
    void willValidateIndexCache() const { }

private:
    explicit ChildNodeList(ContainerNode& parent);

    unsigned length() const override;
    Node* item(unsigned index) const override;
    size_t memoryCost() const override
    {
        // memoryCost() may be invoked concurrently from a GC thread, and we need to be careful
        // about what data we access here and how. Accessing m_indexCache is safe because
        // because it doesn't involve any pointer chasing.
        return m_indexCache.memoryCost();
    }

    bool isChildNodeList() const override { return true; }

    const Ref<ContainerNode> m_parent;
    mutable CollectionIndexCache<ChildNodeList, Node*> m_indexCache;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::EmptyNodeList)
    static bool isType(const WebCore::NodeList& nodeList) { return nodeList.isEmptyNodeList(); }
SPECIALIZE_TYPE_TRAITS_END()

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ChildNodeList)
    static bool isType(const WebCore::NodeList& nodeList) { return nodeList.isChildNodeList(); }
SPECIALIZE_TYPE_TRAITS_END()
