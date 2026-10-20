/*
 * Copyright (C) 2020-2025 Apple Inc. All rights reserved.
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
#include "SimpleRange.h"

#include "CharacterData.h"
#include "BoundaryPointInlines.h"
#include "NodeTraversal.h"
#include "ShadowRoot.h"
#include <wtf/text/MakeString.h>

namespace WebCore {

SimpleRange::SimpleRange(const BoundaryPoint& start, const BoundaryPoint& end)
    : start(start)
    , end(end)
{
}

SimpleRange::SimpleRange(BoundaryPoint&& start, BoundaryPoint&& end)
    : start(WTF::move(start))
    , end(WTF::move(end))
{
}

String SimpleRange::debugDescription() const
{
    return makeString("{start: "_s, start.debugDescription(), ", end: "_s, end.debugDescription(), '}');
}

WeakSimpleRange::WeakSimpleRange(const WeakBoundaryPoint& start, const WeakBoundaryPoint& end)
    : start(start)
    , end(end)
{
}

WeakSimpleRange::WeakSimpleRange(WeakBoundaryPoint&& start, WeakBoundaryPoint&& end)
    : start(WTF::move(start))
    , end(WTF::move(end))
{
}

std::optional<SimpleRange> makeRangeSelectingNode(Node& node)
{
    RefPtr parent = node.parentNode();
    if (!parent)
        return std::nullopt;
    unsigned offset = node.computeNodeIndex();
    return SimpleRange { { *parent, offset }, { *parent, offset + 1 } };
}

SimpleRange makeRangeSelectingNodeContents(Node& node)
{
    return { makeBoundaryPointBeforeNodeContents(node), makeBoundaryPointAfterNodeContents(node) };
}

OffsetRange characterDataOffsetRange(const SimpleRange& range, const Node& node)
{
    return { &node == range.start.container.ptr() ? range.start.offset : 0,
        &node == range.end.container.ptr() ? range.end.offset : std::numeric_limits<unsigned>::max() };
}

static RefPtr<Node> LEGACY_NODELETE firstIntersectingNode(const SimpleRange& range)
{
    if (range.start.container->isCharacterDataNode())
        return range.start.container.ptr();
    if (auto child = range.start.container->traverseToChildAt(range.start.offset))
        return child;
    return NodeTraversal::nextSkippingChildren(range.start.container);
}

static RefPtr<Node> LEGACY_NODELETE nodePastLastIntersectingNode(const SimpleRange& range)
{
    if (range.end.container->isCharacterDataNode())
        return NodeTraversal::nextSkippingChildren(range.end.container);
    if (auto child = range.end.container->traverseToChildAt(range.end.offset))
        return child;
    return NodeTraversal::nextSkippingChildren(range.end.container);
}

static RefPtr<Node> LEGACY_NODELETE firstIntersectingNodeWithDeprecatedZeroOffsetStartQuirk(const SimpleRange& range)
{
    if (range.start.container->isCharacterDataNode())
        return range.start.container.ptr();
    if (auto child = range.start.container->traverseToChildAt(range.start.offset))
        return child;
    if (!range.start.offset)
        return range.start.container.ptr();
    return NodeTraversal::nextSkippingChildren(range.start.container);
}

IntersectingNodeIterator::IntersectingNodeIterator(const SimpleRange& range)
    : m_node(firstIntersectingNode(range))
    , m_pastLastNode(nodePastLastIntersectingNode(range))
{
    enforceEndInvariant();
}

IntersectingNodeIterator::IntersectingNodeIterator(const SimpleRange& range, QuirkFlag)
    : m_node(firstIntersectingNodeWithDeprecatedZeroOffsetStartQuirk(range))
    , m_pastLastNode(nodePastLastIntersectingNode(range))
{
    enforceEndInvariant();
}

void IntersectingNodeIterator::advance()
{
    ASSERT(m_node);
    m_node = NodeTraversal::next(*m_node);
    enforceEndInvariant();
}

void IntersectingNodeIterator::advanceSkippingChildren()
{
    RefPtr node = m_node;
    ASSERT(node);
    m_node = node->contains(m_pastLastNode.get()) ? nullptr : NodeTraversal::nextSkippingChildren(*node);
    enforceEndInvariant();
}

void IntersectingNodeIterator::enforceEndInvariant()
{
    if (m_node == m_pastLastNode || !m_node) {
        m_node = nullptr;
        m_pastLastNode = nullptr;
    }
}

template<TreeType treeType> Node* commonInclusiveAncestor(const SimpleRange& range)
{
    return commonInclusiveAncestor<treeType>(range.start.container, range.end.container);
}

template Node* commonInclusiveAncestor<ComposedTree>(const SimpleRange&);

template<TreeType treeType> bool contains(const SimpleRange& range, const BoundaryPoint& point)
{
    return is_lteq(treeOrder<treeType>(range.start, point)) && is_lteq(treeOrder<treeType>(point, range.end));
}

template bool contains<Tree>(const SimpleRange&, const BoundaryPoint&);

template<TreeType treeType> bool contains(const SimpleRange& range, const std::optional<BoundaryPoint>& point)
{
    return point && contains<treeType>(range, *point);
}

template<> bool contains<ComposedTree>(const SimpleRange& range, const std::optional<BoundaryPoint>& point)
{
    return point && contains<ComposedTree>(range, *point);
}

bool contains(TreeType type, const SimpleRange& range, const BoundaryPoint& point)
{
    switch (type) {
    case Tree:
        return contains<Tree>(range, point);
    case ShadowIncludingTree:
        return contains<ShadowIncludingTree>(range, point);
    case ComposedTree:
        return contains<ComposedTree>(range, point);
    }
    ASSERT_NOT_REACHED();
    return false;
}

template<TreeType treeType> std::partial_ordering treeOrder(const SimpleRange& range, const BoundaryPoint& point)
{
    if (auto order = treeOrder<treeType>(range.start, point); !is_lt(order))
        return order;
    if (auto order = treeOrder<treeType>(range.end, point); !is_gt(order))
        return order;
    return std::partial_ordering::equivalent;
}

template<TreeType treeType> std::partial_ordering treeOrder(const BoundaryPoint& point, const SimpleRange& range)
{
    if (auto order = treeOrder<treeType>(point, range.start); !is_gt(order))
        return order;
    if (auto order = treeOrder<treeType>(point, range.end); !is_lt(order))
        return order;
    return std::strong_ordering::equivalent;
}

template std::partial_ordering treeOrder<Tree>(const SimpleRange&, const BoundaryPoint&);
template std::partial_ordering treeOrder<Tree>(const BoundaryPoint&, const SimpleRange&);

template<TreeType treeType> bool contains(const SimpleRange& outerRange, const SimpleRange& innerRange)
{
    return is_lteq(treeOrder<treeType>(outerRange.start, innerRange.start)) && is_gteq(treeOrder<treeType>(outerRange.end, innerRange.end));
}

template bool contains<Tree>(const SimpleRange&, const SimpleRange&);
template bool contains<ComposedTree>(const SimpleRange&, const SimpleRange&);

bool contains(TreeType type, const SimpleRange& outerRange, const SimpleRange& innerRange)
{
    switch (type) {
    case Tree:
        return contains<Tree>(outerRange, innerRange);
    case ShadowIncludingTree:
        return contains<ShadowIncludingTree>(outerRange, innerRange);
    case ComposedTree:
        return contains<ComposedTree>(outerRange, innerRange);
    }
    ASSERT_NOT_REACHED();
    return false;
}

template<TreeType treeType> bool intersects(const SimpleRange& a, const SimpleRange& b)
{
    return is_lteq(treeOrder<treeType>(a.start, b.end)) && is_lteq(treeOrder<treeType>(b.start, a.end));
}

template bool intersects<Tree>(const SimpleRange&, const SimpleRange&);
template bool intersects<ComposedTree>(const SimpleRange&, const SimpleRange&);

static bool compareByComposedTreeOrder(const BoundaryPoint& a, const BoundaryPoint& b)
{
    return is_lt(treeOrder<ComposedTree>(a, b));
}

SimpleRange unionRange(const SimpleRange& a, const SimpleRange& b)
{
    return { std::min(a.start, b.start, compareByComposedTreeOrder), std::max(a.end, b.end, compareByComposedTreeOrder) };
}

std::optional<SimpleRange> intersection(const std::optional<SimpleRange>& a, const std::optional<SimpleRange>& b)
{
    // FIXME: Can this be done more efficiently, with fewer calls to treeOrder?
    if (!a || !b || !intersects<ComposedTree>(*a, *b))
        return std::nullopt;
    return { { std::max(a->start, b->start, compareByComposedTreeOrder), std::min(a->end, b->end, compareByComposedTreeOrder) } };
}

template<TreeType treeType> bool contains(const SimpleRange& range, const Node& node)
{
    // FIXME: Consider a more efficient algorithm that avoids always computing the node index.
    // FIXME: Does this const_cast point to a design problem?
    auto nodeRange = makeRangeSelectingNode(const_cast<Node&>(node));
    return nodeRange && contains<treeType>(range, *nodeRange);
}

template bool contains<Tree>(const SimpleRange&, const Node&);
template bool contains<ComposedTree>(const SimpleRange&, const Node&);

bool contains(TreeType type, const SimpleRange& range, const Node& node)
{
    switch (type) {
    case Tree:
        return contains<Tree>(range, node);
    case ShadowIncludingTree:
        return contains<ShadowIncludingTree>(range, node);
    case ComposedTree:
        return contains<ComposedTree>(range, node);
    }
    ASSERT_NOT_REACHED();
    return false;
}

template<TreeType treeType> bool contains(const Node& outer, const Node& inner)
{
    for (RefPtr inclusiveAncestor = &inner; inclusiveAncestor; inclusiveAncestor = parent<treeType>(*inclusiveAncestor)) {
        if (inclusiveAncestor == &outer)
            return true;
    }
    return false;
}

template<> bool contains<Tree>(const Node& outer, const Node& inner)
{
    // We specialize here because we want to take advantage of optimizations in Node::isDescendantOf.
    return outer.contains(inner);
}

template<TreeType treeType> bool intersects(const SimpleRange& range, const Node& node)
{
    // FIXME: Consider a more efficient algorithm that avoids always computing the node index.
    // FIXME: Does this const_cast point to a design problem?
    auto nodeRange = makeRangeSelectingNode(const_cast<Node&>(node));
    if (!nodeRange)
        return contains<treeType>(node, range.start.container);
    return is_lt(treeOrder<treeType>(nodeRange->start, range.end)) && is_lt(treeOrder<treeType>(range.start, nodeRange->end));
}

template bool intersects<Tree>(const SimpleRange&, const Node&);
template bool intersects<ComposedTree>(const SimpleRange&, const Node&);

}
