/**
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2007, 2008, 2013 Apple Inc. All rights reserved.
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
#include "ChildNodeList.h"

#include "CollectionIndexCacheInlines.h"
#include "ElementIterator.h"
#include "NodeRareData.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(EmptyNodeList);
WTF_MAKE_TZONE_ALLOCATED_IMPL(ChildNodeList);

EmptyNodeList::~EmptyNodeList()
{
    m_owner.get().nodeLists()->removeEmptyChildNodeList(this);
}

ChildNodeList::ChildNodeList(ContainerNode& parent)
    : m_parent(parent)
{
}

ChildNodeList::~ChildNodeList()
{
    m_parent->nodeLists()->removeChildNodeList(this);
}

unsigned ChildNodeList::length() const
{
    return m_indexCache.nodeCount(*this);
}

Node* ChildNodeList::item(unsigned index) const
{
    return m_indexCache.nodeAt(*this, index);
}

Node* ChildNodeList::collectionBegin() const
{
    return m_parent->firstChild();
}

Node* ChildNodeList::collectionLast() const
{
    return m_parent->lastChild();
}

void ChildNodeList::collectionTraverseForward(Node*& current, unsigned count, unsigned& traversedCount) const
{
    ASSERT(count);
    for (traversedCount = 0; traversedCount < count; ++traversedCount) {
        current = current->nextSibling();
        if (!current)
            return;
    }
}

void ChildNodeList::collectionTraverseBackward(Node*& current, unsigned count) const
{
    ASSERT(count);
    for (; count && current ; --count)
        current = current->previousSibling();
}

void ChildNodeList::invalidateCache()
{
    m_indexCache.invalidate();
}

} // namespace WebCore
