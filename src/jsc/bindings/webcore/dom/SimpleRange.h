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

#include "BoundaryPoint.h"
#include "EventTarget.h"
#include "PlatformExportMacros.h"
#include <wtf/Ref.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/WeakPtrImpl.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

struct WeakSimpleRange {
    WeakBoundaryPoint start;
    WeakBoundaryPoint end;

    WEBCORE_EXPORT WeakSimpleRange(const WeakBoundaryPoint&, const WeakBoundaryPoint&);
    WEBCORE_EXPORT WeakSimpleRange(WeakBoundaryPoint&&, WeakBoundaryPoint&&);
    WEBCORE_EXPORT WeakSimpleRange(const BoundaryPoint&&, const BoundaryPoint&&);
};

struct SimpleRange {
    BoundaryPoint start;
    BoundaryPoint end;

    Node& startContainer() const { return start.container.get(); }
    unsigned startOffset() const { return start.offset; }
    Node& endContainer() const { return end.container.get(); }
    unsigned endOffset() const { return end.offset; }
    WeakSimpleRange makeWeakSimpleRange() const { return { WeakBoundaryPoint(start.container.get(), start.offset), WeakBoundaryPoint(end.container.get(), end.offset) }; }

    bool collapsed() const { return start == end; }

    friend bool operator==(const SimpleRange&, const SimpleRange&) = default;

    WEBCORE_EXPORT SimpleRange(const BoundaryPoint&, const BoundaryPoint&);
    WEBCORE_EXPORT SimpleRange(BoundaryPoint&&, BoundaryPoint&&);

    String debugDescription() const;
};

SimpleRange makeSimpleRangeHelper(BoundaryPoint&&, BoundaryPoint&&);
std::optional<SimpleRange> makeSimpleRangeHelper(std::optional<BoundaryPoint>&&, std::optional<BoundaryPoint>&&);
SimpleRange makeSimpleRangeHelper(BoundaryPoint&&);
std::optional<SimpleRange> makeSimpleRangeHelper(std::optional<BoundaryPoint>&&);
std::optional<SimpleRange> makeSimpleRangeHelper(const WeakBoundaryPoint&, const WeakBoundaryPoint&);
std::optional<SimpleRange> makeSimpleRange(const WeakSimpleRange&);

inline BoundaryPoint makeBoundaryPointHelper(const BoundaryPoint& point) { return point; }
inline BoundaryPoint makeBoundaryPointHelper(BoundaryPoint&& point) { return WTF::move(point); }
inline std::optional<BoundaryPoint> makeBoundaryPointHelper(const std::optional<BoundaryPoint>& point) { return point; }
inline std::optional<BoundaryPoint> makeBoundaryPointHelper(std::optional<BoundaryPoint>&& point) { return WTF::move(point); }
std::optional<BoundaryPoint> makeBoundaryPointHelper(const WeakBoundaryPoint&);
template<typename T> auto makeBoundaryPointHelper(T&& argument) -> decltype(makeBoundaryPoint(std::forward<T>(argument))) { return makeBoundaryPoint(std::forward<T>(argument)); }

template<typename ...T> auto makeSimpleRange(T&& ...arguments) -> decltype(makeSimpleRangeHelper(makeBoundaryPointHelper(std::forward<T>(arguments))...)) { return makeSimpleRangeHelper(makeBoundaryPointHelper(std::forward<T>(arguments))...); }

// FIXME: Would like these two functions to have shorter names; another option is to change prefix to makeSimpleRange.
WEBCORE_EXPORT std::optional<SimpleRange> makeRangeSelectingNode(Node&);
WEBCORE_EXPORT SimpleRange makeRangeSelectingNodeContents(Node&);

template<TreeType = Tree> Node* commonInclusiveAncestor(const SimpleRange&);

template<TreeType = Tree> bool LEGACY_NODELETE contains(const SimpleRange&, const BoundaryPoint&);
template<TreeType = Tree> bool contains(const SimpleRange&, const std::optional<BoundaryPoint>&);
template<TreeType = Tree> bool contains(const SimpleRange& outerRange, const SimpleRange& innerRange);
template<TreeType = Tree> bool contains(const SimpleRange&, const Node&);

template<> WEBCORE_EXPORT bool contains<ComposedTree>(const SimpleRange&, const std::optional<BoundaryPoint>&);

WEBCORE_EXPORT bool contains(TreeType, const SimpleRange& outerRange, const SimpleRange& innerRange);
WEBCORE_EXPORT bool contains(TreeType, const SimpleRange&, const Node&);
WEBCORE_EXPORT bool contains(TreeType, const SimpleRange&, const BoundaryPoint&);

template<TreeType = Tree> bool intersects(const SimpleRange&, const SimpleRange&);
template<TreeType = Tree> bool intersects(const SimpleRange&, const Node&);


// Returns equivalent if point is in range.
template<TreeType = Tree> std::partial_ordering treeOrder(const SimpleRange&, const BoundaryPoint&);
template<TreeType = Tree> std::partial_ordering treeOrder(const BoundaryPoint&, const SimpleRange&);

struct OffsetRange {
    unsigned start { 0 };
    unsigned end { 0 };
};
OffsetRange LEGACY_NODELETE characterDataOffsetRange(const SimpleRange&, const Node&);

// FIXME: Start of functions that are deprecated since they silently default to ComposedTree.

WEBCORE_EXPORT SimpleRange unionRange(const SimpleRange&, const SimpleRange&);
WEBCORE_EXPORT std::optional<SimpleRange> intersection(const std::optional<SimpleRange>&, const std::optional<SimpleRange>&);

class IntersectingNodeRange;
IntersectingNodeRange intersectingNodes(const SimpleRange&);

class IntersectingNodeRangeWithQuirk;
IntersectingNodeRangeWithQuirk intersectingNodesWithDeprecatedZeroOffsetStartQuirk(const SimpleRange&);

// FIXME: End of functions that are deprecated since they silently default to ComposedTree.

class IntersectingNodeIterator {
public:
    using iterator_category = std::forward_iterator_tag;
    using value_type = Node;
    using difference_type = ptrdiff_t;
    using pointer = value_type*;
    using reference = value_type&;

    WEBCORE_EXPORT IntersectingNodeIterator(const SimpleRange&);

    enum QuirkFlag { DeprecatedZeroOffsetStartQuirk };
    IntersectingNodeIterator(const SimpleRange&, QuirkFlag);

    Node& operator*() const { return *m_node; }
    Node* operator->() const { ASSERT(m_node); return m_node.get(); }

    operator bool() const { return m_node; }
    bool operator!() const { return !m_node; }
    bool operator==(const std::nullptr_t) const { return !m_node; }

    IntersectingNodeIterator& operator++() { advance(); return *this; }
    WEBCORE_EXPORT void advance();
    void advanceSkippingChildren();

private:
    void enforceEndInvariant();

    RefPtr<Node> m_node;
    RefPtr<Node> m_pastLastNode;
};

class IntersectingNodeRange {
public:
    IntersectingNodeRange(const SimpleRange&);

    IntersectingNodeIterator begin() const { return m_range; }
    static constexpr std::nullptr_t end() { return nullptr; }

private:
    SimpleRange m_range;
};

class IntersectingNodeRangeWithQuirk {
public:
    IntersectingNodeRangeWithQuirk(const SimpleRange&);

    IntersectingNodeIterator begin() const { return { m_range, IntersectingNodeIterator::DeprecatedZeroOffsetStartQuirk }; }
    static constexpr std::nullptr_t end() { return nullptr; }

private:
    SimpleRange m_range;
};

inline IntersectingNodeRange::IntersectingNodeRange(const SimpleRange& range)
    : m_range(range)
{
}

inline IntersectingNodeRangeWithQuirk::IntersectingNodeRangeWithQuirk(const SimpleRange& range)
    : m_range(range)
{
}

inline IntersectingNodeRange intersectingNodes(const SimpleRange& range)
{
    return { range };
}

inline IntersectingNodeRangeWithQuirk intersectingNodesWithDeprecatedZeroOffsetStartQuirk(const SimpleRange& range)
{
    return { range };
}

inline SimpleRange makeSimpleRangeHelper(BoundaryPoint&& start, BoundaryPoint&& end)
{
    return { WTF::move(start), WTF::move(end) };
}

inline std::optional<SimpleRange> makeSimpleRangeHelper(std::optional<BoundaryPoint>&& start, std::optional<BoundaryPoint>&& end)
{
    if (!start || !end)
        return std::nullopt;
    return makeSimpleRangeHelper(WTF::move(*start), WTF::move(*end));
}

inline SimpleRange makeSimpleRangeHelper(BoundaryPoint&& point)
{
    auto end = point;
    return makeSimpleRangeHelper(WTF::move(point), WTF::move(end));
}

inline std::optional<SimpleRange> makeSimpleRangeHelper(std::optional<BoundaryPoint>&& point)
{
    if (!point)
        return std::nullopt;
    return makeSimpleRangeHelper(WTF::move(*point));
}

inline std::optional<BoundaryPoint> makeBoundaryPointHelper(const WeakBoundaryPoint& point)
{
    if (!point.container)
        return { };
    return BoundaryPoint { *point.container, point.offset };
}

inline std::optional<SimpleRange> makeSimpleRangeHelper(const WeakBoundaryPoint& start, const WeakBoundaryPoint& end)
{
    return makeSimpleRangeHelper(makeBoundaryPointHelper(start), makeBoundaryPointHelper(end));
}

inline std::optional<SimpleRange> makeSimpleRange(const WeakSimpleRange& range)
{
    return makeSimpleRangeHelper(range.start, range.end);
}

}
