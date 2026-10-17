/*
 * Copyright (C) 2008-2020 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

#pragma once

#include "BoundaryPoint.h"
#include "CharacterData.h"

namespace WebCore {

class RangeBoundaryPoint {
public:
    explicit RangeBoundaryPoint(Node& container);

    Node& container() const;
    unsigned offset() const;
    Node* childBefore() const;

    inline void set(Ref<Node>&& container, unsigned offset, RefPtr<Node>&& childBefore);
    void setOffset(unsigned);

    void setToBeforeNode(Node&);
    void setToAfterNode(Ref<Node>&&);
    void setToBeforeContents(Ref<Node>&&);
    inline void setToAfterContents(Ref<Node>&&);

    void childBeforeWillBeRemoved();
    void invalidateOffset();

private:
    Ref<Node> m_container;
    unsigned m_offset { 0 };
    RefPtr<Node> m_childBefore;
};

BoundaryPoint makeBoundaryPoint(const RangeBoundaryPoint&);

inline RangeBoundaryPoint::RangeBoundaryPoint(Node& container)
    : m_container(container)
{
}

inline Node& RangeBoundaryPoint::container() const
{
    return m_container;
}

inline Node* RangeBoundaryPoint::childBefore() const
{
    return m_childBefore.get();
}

inline unsigned RangeBoundaryPoint::offset() const
{
    return m_offset;
}

inline void RangeBoundaryPoint::setOffset(unsigned offset)
{
    ASSERT(m_container->isCharacterDataNode());
    ASSERT(m_offset);
    ASSERT(!m_childBefore);
    m_offset = offset;
}

inline void RangeBoundaryPoint::setToBeforeNode(Node& child)
{
    ASSERT(child.parentNode());
    m_container = *child.parentNode();
    m_offset = child.computeNodeIndex();
    m_childBefore = child.previousSibling();
}

inline void RangeBoundaryPoint::setToAfterNode(Ref<Node>&& child)
{
    ASSERT(child->parentNode());
    m_container = *child->parentNode();
    m_offset = child->computeNodeIndex() + 1;
    m_childBefore = WTF::move(child);
}

inline void RangeBoundaryPoint::setToBeforeContents(Ref<Node>&& container)
{
    m_container = WTF::move(container);
    m_offset = 0;
    m_childBefore = nullptr;
}

inline void RangeBoundaryPoint::childBeforeWillBeRemoved()
{
    ASSERT(m_offset);
    ASSERT(m_childBefore);
    --m_offset;
    m_childBefore = m_childBefore->previousSibling();
}

inline void RangeBoundaryPoint::invalidateOffset()
{
    m_offset = m_childBefore ? m_childBefore->computeNodeIndex() + 1 : 0;
}

inline bool operator==(const RangeBoundaryPoint& a, const RangeBoundaryPoint& b)
{
    return &a.container() == &b.container() && a.offset() == b.offset();
}

inline BoundaryPoint makeBoundaryPoint(const RangeBoundaryPoint& point)
{
    return { point.container(), point.offset() };
}

} // namespace WebCore
