/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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

#include "Node.h"

namespace WebCore {

struct BoundaryPoint {
    Ref<Node> container;
    unsigned offset { 0 };

    BoundaryPoint(Ref<Node>&&, unsigned);

    inline Document& document() const; // Defined in BoundaryPointInlines.h

    String debugDescription() const;
};

bool operator==(const BoundaryPoint&, const BoundaryPoint&);

WTF::TextStream& operator<<(WTF::TextStream&, const BoundaryPoint&);

template<TreeType = Tree> std::partial_ordering treeOrder(const BoundaryPoint&, const BoundaryPoint&);
template<> WEBCORE_EXPORT std::partial_ordering treeOrder<ComposedTree>(const BoundaryPoint&, const BoundaryPoint&);

WEBCORE_EXPORT std::optional<BoundaryPoint> makeBoundaryPointBeforeNode(Node&);
WEBCORE_EXPORT std::optional<BoundaryPoint> makeBoundaryPointAfterNode(Node&);
BoundaryPoint makeBoundaryPointBeforeNodeContents(Node&);
BoundaryPoint makeBoundaryPointAfterNodeContents(Node&);

inline BoundaryPoint::BoundaryPoint(Ref<Node>&& container, unsigned offset)
    : container(WTF::move(container))
    , offset(offset)
{
}

inline bool operator==(const BoundaryPoint& a, const BoundaryPoint& b)
{
    return a.container.ptr() == b.container.ptr() && a.offset == b.offset;
}

inline BoundaryPoint makeBoundaryPointBeforeNodeContents(Node& node)
{
    return { node, 0 };
}

inline BoundaryPoint makeBoundaryPointAfterNodeContents(Node&);

struct WeakBoundaryPoint {
    WeakPtr<Node, Node::WeakPtrImplType> container;
    unsigned offset { 0 };

    WeakBoundaryPoint(WeakPtr<Node, Node::WeakPtrImplType>&&, unsigned);
};

inline WeakBoundaryPoint::WeakBoundaryPoint(WeakPtr<Node, Node::WeakPtrImplType>&& container, unsigned offset)
    : container(WTF::move(container))
    , offset(offset)
{
}

}
