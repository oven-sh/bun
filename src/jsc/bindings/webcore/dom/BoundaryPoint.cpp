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

#include "config.h"
#include "BoundaryPoint.h"
#include "ContainerNode.h"
#include "Document.h"
#include <wtf/text/MakeString.h>
#include <wtf/text/TextStream.h>

namespace WebCore {

template std::partial_ordering treeOrder<Tree>(const BoundaryPoint&, const BoundaryPoint&);
template std::partial_ordering treeOrder<ShadowIncludingTree>(const BoundaryPoint&, const BoundaryPoint&);

std::optional<BoundaryPoint> makeBoundaryPointBeforeNode(Node& node)
{
    RefPtr parent = node.parentNode();
    if (!parent)
        return std::nullopt;
    return BoundaryPoint { parent.releaseNonNull(), node.computeNodeIndex() };
}

std::optional<BoundaryPoint> makeBoundaryPointAfterNode(Node& node)
{
    RefPtr parent = node.parentNode();
    if (!parent)
        return std::nullopt;
    return BoundaryPoint { parent.releaseNonNull(), node.computeNodeIndex() + 1 };
}

static bool LEGACY_NODELETE isOffsetBeforeChild(ContainerNode& container, unsigned offset, Node& child)
{
    if (!offset)
        return true;
    // If the container is not the parent, the child is part of a shadow tree, which we sort between offset 0 and offset 1.
    if (child.parentNode() != &container)
        return false;
    unsigned currentOffset = 0;
    for (auto currentChild = container.firstChild(); currentChild && currentChild != &child; currentChild = currentChild->nextSibling()) {
        if (offset <= ++currentOffset)
            return true;
    }
    return false;
}

template<TreeType treeType> std::partial_ordering treeOrderInternal(const BoundaryPoint& a, const BoundaryPoint& b)
{
    if (a.container.ptr() == b.container.ptr())
        return a.offset <=> b.offset;

    for (RefPtr ancestor = b.container.copyRef(); ancestor; ) {
        RefPtr nextAncestor = parent<treeType>(*ancestor);
        if (nextAncestor == a.container.ptr())
            return isOffsetBeforeChild(*nextAncestor, a.offset, *ancestor) ? std::strong_ordering::less : std::strong_ordering::greater;
        ancestor = WTF::move(nextAncestor);
    }

    for (RefPtr ancestor = a.container.copyRef(); ancestor; ) {
        RefPtr nextAncestor = parent<treeType>(*ancestor);
        if (nextAncestor == b.container.ptr())
            return isOffsetBeforeChild(*nextAncestor, b.offset, *ancestor) ? std::strong_ordering::greater : std::strong_ordering::less;
        ancestor = WTF::move(nextAncestor);
    }

    return treeOrder<treeType>(a.container, b.container);
}

template<TreeType treeType> std::partial_ordering treeOrder(const BoundaryPoint& a, const BoundaryPoint& b)
{
    return treeOrderInternal<treeType>(a, b);
}

template<> std::partial_ordering treeOrder<ComposedTree>(const BoundaryPoint& a, const BoundaryPoint& b)
{
    return treeOrderInternal<ComposedTree>(a, b);
}

TextStream& operator<<(TextStream& stream, const BoundaryPoint& boundaryPoint)
{
    TextStream::GroupScope scope(stream);
    stream << "BoundaryPoint ";
    stream.dumpProperty("node"_s, protect(boundaryPoint.container)->debugDescription());
    stream.dumpProperty("offset"_s, boundaryPoint.offset);
    return stream;
}

String BoundaryPoint::debugDescription() const
{
    return makeString('{', protect(container)->debugDescription().utf8(), ", offset: "_s, offset, '}');
}

}
