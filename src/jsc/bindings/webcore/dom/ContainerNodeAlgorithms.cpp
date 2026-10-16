/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2015 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2012 Google Inc. All rights reserved.
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
#include "ContainerNodeAlgorithms.h"

#include "DOMClientData.h"
#include "NodeInlines.h"
#include "NodeTraversal.h"
#include "ScriptDisallowedScope.h"
#include "ShadowRoot.h"

namespace WebCore {

#if ASSERT_ENABLED
ContainerChildRemovalScope*& ContainerChildRemovalScope::currentScope()
{
    return domClientData().containerChildRemovalScope();
}
#endif

enum class TreeScopeChange { Changed, DidNotChange };

static void notifyNodeInsertedIntoDocument(ContainerNode& parentOfInsertedTree, Node& node, TreeScopeChange treeScopeChange, NodeVector& postInsertionNotificationTargets)
{
    ASSERT(parentOfInsertedTree.isConnected());
    ASSERT(!node.isConnected());

    for (RefPtr currentNode = node; currentNode; currentNode = NodeTraversal::next(*currentNode, &node)) {
        auto result = currentNode->insertionSteps(Node::InsertionType { /* connectedToDocument */ true, treeScopeChange == TreeScopeChange::Changed }, parentOfInsertedTree);
        if (result == Node::NeedsPostConnectionSteps::Yes)
            postInsertionNotificationTargets.append(*currentNode);
        if (RefPtr root = currentNode->shadowRoot())
            notifyNodeInsertedIntoDocument(parentOfInsertedTree, *root, TreeScopeChange::DidNotChange, postInsertionNotificationTargets);
    }
}

static void notifyNodeInsertedIntoTree(ContainerNode& parentOfInsertedTree, Node& node, TreeScopeChange treeScopeChange)
{
    ASSERT(!parentOfInsertedTree.isConnected());
    ASSERT(!node.isConnected());

    for (RefPtr currentNode = node; currentNode; currentNode = NodeTraversal::next(*currentNode, &node)) {
        auto result = currentNode->insertionSteps(Node::InsertionType { /* connectedToDocument */ false, treeScopeChange == TreeScopeChange::Changed }, parentOfInsertedTree);
        UNUSED_PARAM(result);
        if (RefPtr root = currentNode->shadowRoot())
            notifyNodeInsertedIntoTree(parentOfInsertedTree, *root, TreeScopeChange::DidNotChange);
    }
}

// We intentionally use an out-parameter for postInsertionNotificationTargets instead of returning the vector. This is because
// NodeVector has a large inline buffer and is thus not cheap to move.
void notifyChildNodeInserted(ContainerNode& parentOfInsertedTree, Node& node, NodeVector& postInsertionNotificationTargets)
{
    ASSERT(ScriptDisallowedScope::InMainThread::hasDisallowedScope());

    Ref document { node.document() };
    Ref protectNode { node };

    // Tree scope has changed if the container node into which "node" is inserted is in a document or a shadow root.
    auto treeScopeChange = parentOfInsertedTree.isInTreeScope() ? TreeScopeChange::Changed : TreeScopeChange::DidNotChange;
    if (parentOfInsertedTree.isConnected())
        notifyNodeInsertedIntoDocument(parentOfInsertedTree, node, treeScopeChange, postInsertionNotificationTargets);
    else
        notifyNodeInsertedIntoTree(parentOfInsertedTree, node, treeScopeChange);
}

inline RemovedSubtreeObservability LEGACY_NODELETE observabilityOfRemovedNode(Node& node)
{
    bool isRootOfRemovedTree = !node.parentNode();
    return node.refCount() > 1 && !isRootOfRemovedTree ? RemovedSubtreeObservability::MaybeObservableByRefPtr : RemovedSubtreeObservability::NotObservable;
}

inline void LEGACY_NODELETE updateObservability(RemovedSubtreeObservability& currentObservability, RemovedSubtreeObservability newStatus)
{
    if (newStatus == RemovedSubtreeObservability::MaybeObservableByRefPtr)
        currentObservability = newStatus;
}

static RemovedSubtreeObservability notifyNodeRemovedFromDocument(ContainerNode& oldParentOfRemovedTree, TreeScopeChange treeScopeChange, Node& node)
{
    ASSERT(!node.parentNode());
    ASSERT(oldParentOfRemovedTree.isConnected());
    ASSERT(node.isConnected());

    RemovedSubtreeObservability observability = RemovedSubtreeObservability::NotObservable;
    for (RefPtr currentNode = node; currentNode; currentNode = NodeTraversal::next(*currentNode)) {
        currentNode->removingSteps(Node::RemovalType { /* disconnectedFromDocument */ true, treeScopeChange == TreeScopeChange::Changed }, oldParentOfRemovedTree);
        updateObservability(observability, observabilityOfRemovedNode(*currentNode));
        if (RefPtr root = currentNode->shadowRoot())
            updateObservability(observability, notifyNodeRemovedFromDocument(oldParentOfRemovedTree, TreeScopeChange::DidNotChange, *root));
    }
    return observability;
}

static RemovedSubtreeObservability notifyNodeRemovedFromTree(ContainerNode& oldParentOfRemovedTree, TreeScopeChange treeScopeChange, Node& node)
{
    ASSERT(!node.parentNode());
    ASSERT(!oldParentOfRemovedTree.isConnected());
    RemovedSubtreeObservability observability = RemovedSubtreeObservability::NotObservable;
    for (RefPtr currentNode = node; currentNode; currentNode = NodeTraversal::next(*currentNode)) {
        currentNode->removingSteps(Node::RemovalType { /* disconnectedFromDocument */ false, treeScopeChange == TreeScopeChange::Changed }, oldParentOfRemovedTree);
        updateObservability(observability, observabilityOfRemovedNode(*currentNode));
        if (RefPtr root = currentNode->shadowRoot())
            updateObservability(observability, notifyNodeRemovedFromTree(oldParentOfRemovedTree, TreeScopeChange::DidNotChange, *root));
    }
    return observability;
}

RemovedSubtreeObservability notifyChildNodeRemoved(ContainerNode& oldParentOfRemovedTree, Node& child)
{
    // Assert that the caller of this function has an instance of ScriptDisallowedScope.
    ASSERT(ScriptDisallowedScope::InMainThread::hasDisallowedScope());
    ContainerChildRemovalScope removalScope(oldParentOfRemovedTree, child);

    // Tree scope has changed if the container node from which "node" is removed is in a document or a shadow root.
    auto treeScopeChange = oldParentOfRemovedTree.isInTreeScope() ? TreeScopeChange::Changed : TreeScopeChange::DidNotChange;
    if (child.isConnected())
        return notifyNodeRemovedFromDocument(oldParentOfRemovedTree, treeScopeChange, child);
    return notifyNodeRemovedFromTree(oldParentOfRemovedTree, treeScopeChange, child);
}

void removeDetachedChildrenInContainer(ContainerNode& container)
{
    container.setLastChild(nullptr);

    RefPtr<Node> next;
    for (RefPtr node = container.firstChild(); node; node = WTF::move(next)) {
        ASSERT(!node->deletionHasBegun());

        next = node->nextSibling();
        node->setNextSibling(nullptr);
        node->setParentNode(nullptr);
        node->resetShadowIncludingRoot();
        container.setFirstChild(next.get());
        if (next)
            next->setPreviousSibling(nullptr);

        node->setTreeScopeRecursively(Ref<Document> { container.document() });
        if (node->isInTreeScope())
            notifyChildNodeRemoved(container, *node);
        else if (node->refCount() > 1)
            node->updateShadowIncludingRootForSubtree();
        ASSERT_WITH_SECURITY_IMPLICATION(!node->isInTreeScope());
    }
}

}
