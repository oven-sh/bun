/*
 * Copyright (C) 2007, 2015 Apple Inc. All rights reserved.
 *           (C) 2008 Nikolas Zimmermann <zimmermann@kde.org>
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

#include "ContainerNode.h"
#include <wtf/Assertions.h>

namespace WebCore {

// FIXME: Delete this class after fixing FormListedElement to avoid calling getElementById during a tree removal.
#if ASSERT_ENABLED
class ContainerChildRemovalScope {
public:
    ContainerChildRemovalScope(ContainerNode& parentOfRemovedTree, Node& child)
        : m_parentOfRemovedTree(parentOfRemovedTree)
        , m_removedChild(child)
        , m_previousScope(currentScope())
    {
        currentScope() = this;
    }

    ~ContainerChildRemovalScope()
    {
        currentScope() = m_previousScope;
    }

    ContainerNode& parentOfRemovedTree() { return m_parentOfRemovedTree; }
    Node& removedChild() { return m_removedChild; }

    static ContainerChildRemovalScope*& currentScope();

private:
    ContainerNode& m_parentOfRemovedTree;
    Node& m_removedChild;
    ContainerChildRemovalScope* m_previousScope;
};
#else // not ASSERT_ENABLED
class ContainerChildRemovalScope {
public:
    ContainerChildRemovalScope(ContainerNode&, Node&) { }
};
#endif // not ASSERT_ENABLED

void notifyChildNodeInserted(ContainerNode& parentOfInsertedTree, Node&, NodeVector& postInsertionNotificationTargets);

enum class RemovedSubtreeObservability : bool {
    NotObservable,
    MaybeObservableByRefPtr,
};

RemovedSubtreeObservability notifyChildNodeRemoved(ContainerNode& oldParentOfRemovedTree, Node&);
void removeDetachedChildrenInContainer(ContainerNode&);

} // namespace WebCore
