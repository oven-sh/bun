/*
 * Copyright (C) 2013-2020 Apple Inc. All rights reserved.
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

#include "ElementIterator.h"

namespace WebCore {

class Element;

template<typename> class DoubleElementDescendantIterator;
template<typename> class DoubleElementDescendantRange;
template<typename> class ElementDescendantRange;
template<typename> class InclusiveElementDescendantRange;
template<typename ElementType, bool(const ElementType&)> class FilteredElementDescendantRange;

// Range for iterating through descendant elements.
template<typename ElementType>
inline ElementDescendantRange<ElementType> descendantsOfType(ContainerNode&);
template<typename ElementType>
inline ElementDescendantRange<const ElementType> descendantsOfType(const ContainerNode&);
template<typename ElementType>
inline InclusiveElementDescendantRange<ElementType> inclusiveDescendantsOfType(ContainerNode&);

// Range that skips elements where the filter returns false.
template<typename ElementType, bool filter(const ElementType&)>
inline FilteredElementDescendantRange<ElementType, filter> filteredDescendants(const ContainerNode&);

// Range for use when both sets of descendants are known to be the same length.
// If they are different lengths, this will stop when the shorter one reaches the end, but also an assertion will fail.
template<typename ElementType> DoubleElementDescendantRange<ElementType> descendantsOfType(ContainerNode& firstRoot, ContainerNode& secondRoot);

template<typename ElementType> class ElementDescendantIterator : public ElementIterator<ElementType> {
public:
    ElementDescendantIterator() = default;
    inline ElementDescendantIterator(const ContainerNode& root, ElementType* current);
    inline ElementDescendantIterator& operator++();
    inline ElementDescendantIterator& operator--();
};

template<typename ElementType> class ElementDescendantRange {
public:
    inline ElementDescendantRange(const ContainerNode& root);
    inline ElementDescendantIterator<ElementType> begin() const;
    static constexpr std::nullptr_t end() { return nullptr; }
    inline ElementDescendantIterator<ElementType> beginAt(ElementType&) const;
    inline ElementDescendantIterator<ElementType> from(Element&) const;

    inline ElementType* first() const;
    inline ElementType* last() const;

private:
    CheckedRef<const ContainerNode> m_root;
};

template<typename ElementType> class InclusiveElementDescendantRange {
public:
    inline InclusiveElementDescendantRange(const ContainerNode& root);
    inline ElementDescendantIterator<ElementType> begin() const;
    static constexpr std::nullptr_t end() { return nullptr; }
    inline ElementDescendantIterator<ElementType> beginAt(ElementType&) const;
    inline ElementDescendantIterator<ElementType> from(Element&) const;

    inline ElementType* first() const;
    inline ElementType* last() const;

private:
    CheckedRef<const ContainerNode> m_root;
};

template<typename ElementType> class DoubleElementDescendantRange {
public:
    typedef ElementDescendantRange<ElementType> SingleAdapter;
    typedef DoubleElementDescendantIterator<ElementType> Iterator;

    inline DoubleElementDescendantRange(SingleAdapter&&, SingleAdapter&&);
    inline Iterator begin() const;
    static constexpr std::nullptr_t end() { return nullptr; }

private:
    std::pair<SingleAdapter, SingleAdapter> m_pair;
};

template<typename ElementType> class DoubleElementDescendantIterator {
public:
    typedef ElementDescendantIterator<ElementType> SingleIterator;
    typedef std::pair<ElementType&, ElementType&> ReferenceProxy;

    inline DoubleElementDescendantIterator(SingleIterator&&, SingleIterator&&);
    inline ReferenceProxy operator*() const;
    constexpr bool operator==(std::nullptr_t) const;
    inline DoubleElementDescendantIterator& operator++();

private:
    std::pair<SingleIterator, SingleIterator> m_pair;
};

template<typename ElementType, bool filter(const ElementType&)> class FilteredElementDescendantIterator : public ElementIterator<ElementType> {
public:
    inline FilteredElementDescendantIterator(const ContainerNode&, ElementType* = nullptr);
    inline FilteredElementDescendantIterator& operator++();
};

template<typename ElementType, bool filter(const ElementType&)> class FilteredElementDescendantRange {
public:
    using Iterator = FilteredElementDescendantIterator<ElementType, filter>;

    inline FilteredElementDescendantRange(const ContainerNode&);
    inline Iterator begin() const;
    static constexpr std::nullptr_t end() { return nullptr; }

    inline RefPtr<ElementType> first() const;

private:
    CheckedRef<const ContainerNode> m_root;
};

// ElementDescendantIterator

template<typename ElementType> ElementDescendantIterator<ElementType>::ElementDescendantIterator(const ContainerNode& root, ElementType* current)
    : ElementIterator<ElementType>(&root, current)
{
}

// ElementDescendantRange

template<typename ElementType> ElementDescendantRange<ElementType>::ElementDescendantRange(const ContainerNode& root)
    : m_root(root)
{
}

// InclusiveElementDescendantRange

template<typename ElementType> InclusiveElementDescendantRange<ElementType>::InclusiveElementDescendantRange(const ContainerNode& root)
    : m_root(root)
{
}

// DoubleElementDescendantRange

template<typename ElementType> DoubleElementDescendantRange<ElementType>::DoubleElementDescendantRange(SingleAdapter&& first, SingleAdapter&& second)
    : m_pair(WTF::move(first), WTF::move(second))
{
}

// DoubleElementDescendantIterator

template<typename ElementType> DoubleElementDescendantIterator<ElementType>::DoubleElementDescendantIterator(SingleIterator&& first, SingleIterator&& second)
    : m_pair(WTF::move(first), WTF::move(second))
{
}

// FilteredElementDescendantIterator

template<typename ElementType, bool filter(const ElementType&)> FilteredElementDescendantIterator<ElementType, filter>::FilteredElementDescendantIterator(const ContainerNode& root, ElementType* element)
    : ElementIterator<ElementType> { &root, element }
{
}

// FilteredElementDescendantRange

template<typename ElementType, bool filter(const ElementType&)> FilteredElementDescendantRange<ElementType, filter>::FilteredElementDescendantRange(const ContainerNode& root)
    : m_root { root }
{
}

// Standalone functions

} // namespace WebCore
