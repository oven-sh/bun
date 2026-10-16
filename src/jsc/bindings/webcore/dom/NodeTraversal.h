/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
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
#include "NodeInlines.h"
#include "Text.h"

namespace WebCore {
namespace NodeTraversal {

// Does a pre-order traversal of the tree to find the next node after this one.
// This uses the same order that tags appear in the source file. If the stayWithin
// argument is non-null, the traversal will stop once the specified node is reached.
// This can be used to restrict traversal to a particular sub-tree.
inline Node* next(const Node&);
inline Node* next(const Node&, const Node* stayWithin);
inline Node* next(const ContainerNode&);
inline Node* next(const ContainerNode&, const Node* stayWithin);
inline Node* next(const Text&);
inline Node* next(const Text&, const Node* stayWithin);

// Like next, but skips children and starts with the next sibling.
inline Node* nextSkippingChildren(const Node&);
inline Node* nextSkippingChildren(const Node&, const Node* stayWithin);

// Does a reverse pre-order traversal to find the node that comes before the current one in document order
WEBCORE_EXPORT Node* LEGACY_NODELETE last(const ContainerNode&);
inline Node* previous(const Node&, const Node* stayWithin = nullptr);

// Like previous, but skips children and starts with the next sibling.
Node* LEGACY_NODELETE previousSkippingChildren(const Node&, const Node* stayWithin = nullptr);

// Like next, but visits parents after their children.
Node* LEGACY_NODELETE nextPostOrder(const Node&, const Node* stayWithin = nullptr);

// Like previous/previousSkippingChildren, but visits parents before their children.
Node* LEGACY_NODELETE previousPostOrder(const Node&, const Node* stayWithin = nullptr);
Node* LEGACY_NODELETE previousSkippingChildrenPostOrder(const Node&, const Node* stayWithin = nullptr);

}

namespace NodeTraversal {

WEBCORE_EXPORT Node* LEGACY_NODELETE nextAncestorSibling(const Node&);
WEBCORE_EXPORT Node* LEGACY_NODELETE nextAncestorSibling(const Node&, const Node* stayWithin);
WEBCORE_EXPORT Node* LEGACY_NODELETE deepLastChild(Node&);

template <class NodeType>
inline Node* traverseNextTemplate(NodeType& current)
{
    if (current.firstChild())
        return current.firstChild();
    if (current.nextSibling())
        return current.nextSibling();
    return nextAncestorSibling(current);
}
inline Node* next(const Node& current) { return traverseNextTemplate(current); }
inline Node* next(const ContainerNode& current) { return traverseNextTemplate(current); }

template <class NodeType>
inline Node* traverseNextTemplate(NodeType& current, const Node* stayWithin)
{
    if (current.firstChild())
        return current.firstChild();
    if (&current == stayWithin)
        return nullptr;
    if (current.nextSibling())
        return current.nextSibling();
    return nextAncestorSibling(current, stayWithin);
}
inline Node* next(const Node& current, const Node* stayWithin) { return traverseNextTemplate(current, stayWithin); }
inline Node* next(const ContainerNode& current, const Node* stayWithin) { return traverseNextTemplate(current, stayWithin); }

inline Node* nextSkippingChildren(const Node& current)
{
    if (current.nextSibling())
        return current.nextSibling();
    return nextAncestorSibling(current);
}

inline Node* nextSkippingChildren(const Node& current, const Node* stayWithin)
{
    if (&current == stayWithin)
        return nullptr;
    if (current.nextSibling())
        return current.nextSibling();
    return nextAncestorSibling(current, stayWithin);
}

inline Node* next(const Text& current) { return nextSkippingChildren(current); }
inline Node* next(const Text& current, const Node* stayWithin) { return nextSkippingChildren(current, stayWithin); }

inline Node* previous(const Node& current, const Node* stayWithin)
{
    if (auto* previous = current.previousSibling())
        return deepLastChild(*previous);
    if (current.parentNode() == stayWithin)
        return nullptr;
    return current.parentNode();
}

}
}
