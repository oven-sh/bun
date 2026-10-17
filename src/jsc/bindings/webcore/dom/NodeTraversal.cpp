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

#include "config.h"
#include "NodeTraversal.h"

namespace WebCore {

namespace NodeTraversal {

Node* nextAncestorSibling(const Node& current)
{
    ASSERT(!current.nextSibling());
    for (auto* ancestor = current.parentNode(); ancestor; ancestor = ancestor->parentNode()) {
        if (ancestor->nextSibling())
            return ancestor->nextSibling();
    }
    return nullptr;
}

Node* nextAncestorSibling(const Node& current, const Node* stayWithin)
{
    ASSERT(!current.nextSibling());
    ASSERT(&current != stayWithin);
    for (auto* ancestor = current.parentNode(); ancestor; ancestor = ancestor->parentNode()) {
        if (ancestor == stayWithin)
            return nullptr;
        if (ancestor->nextSibling())
            return ancestor->nextSibling();
    }
    return nullptr;
}

Node* last(const ContainerNode& current)
{
    Node* node = current.lastChild();
    if (!node)
        return nullptr;
    while (node->lastChild())
        node = node->lastChild();
    return node;
}

Node* deepLastChild(Node& node)
{
    Node* lastChild = &node;
    while (lastChild->lastChild())
        lastChild = lastChild->lastChild();
    return lastChild;
}

Node* previousSkippingChildren(const Node& current, const Node* stayWithin)
{
    if (&current == stayWithin)
        return nullptr;
    if (current.previousSibling())
        return current.previousSibling();
    for (auto* ancestor = current.parentNode(); ancestor; ancestor = ancestor->parentNode()) {
        if (ancestor == stayWithin)
            return nullptr;
        if (ancestor->previousSibling())
            return ancestor->previousSibling();
    }
    return nullptr;
}

Node* nextPostOrder(const Node& current, const Node* stayWithin)
{
    if (&current == stayWithin)
        return nullptr;
    if (!current.nextSibling())
        return current.parentNode();
    Node* next = current.nextSibling();
    while (next->firstChild())
        next = next->firstChild();
    return next;
}

static Node* LEGACY_NODELETE previousAncestorSiblingPostOrder(const Node& current, const Node* stayWithin)
{
    ASSERT(!current.previousSibling());
    for (auto* ancestor = current.parentNode(); ancestor; ancestor = ancestor->parentNode()) {
        if (ancestor == stayWithin)
            return nullptr;
        if (ancestor->previousSibling())
            return ancestor->previousSibling();
    }
    return nullptr;
}

Node* previousPostOrder(const Node& current, const Node* stayWithin)
{
    if (current.lastChild())
        return current.lastChild();
    if (&current == stayWithin)
        return nullptr;
    if (current.previousSibling())
        return current.previousSibling();
    return previousAncestorSiblingPostOrder(current, stayWithin);
}

Node* previousSkippingChildrenPostOrder(const Node& current, const Node* stayWithin)
{
    if (&current == stayWithin)
        return nullptr;
    if (current.previousSibling())
        return current.previousSibling();
    return previousAncestorSiblingPostOrder(current, stayWithin);
}

}
}
