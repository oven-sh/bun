/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#include "ElementIteratorInlines.h"
#include "TypedElementDescendantIterator.h"

namespace WebCore {

// ElementDescendantIterator

template<typename ElementType> ElementDescendantIterator<ElementType>& ElementDescendantIterator<ElementType>::operator++()
{
    ElementIterator<ElementType>::traverseNext();
    return *this;
}

template<typename ElementType> ElementDescendantIterator<ElementType>& ElementDescendantIterator<ElementType>::operator--()
{
    ElementIterator<ElementType>::traversePrevious();
    return *this;
}

// ElementDescendantRange

template<typename ElementType> ElementDescendantIterator<ElementType> ElementDescendantRange<ElementType>::begin() const
{
    return ElementDescendantIterator<ElementType>(m_root, Traversal<ElementType>::firstWithin(m_root));
}

template<typename ElementType> ElementDescendantIterator<ElementType> ElementDescendantRange<ElementType>::beginAt(ElementType& descendant) const
{
    ASSERT(descendant.isDescendantOf(m_root));
    return ElementDescendantIterator<ElementType>(m_root, &descendant);
}

template<typename ElementType> ElementDescendantIterator<ElementType> ElementDescendantRange<ElementType>::from(Element& descendant) const
{
    ASSERT(descendant.isDescendantOf(m_root));
    if (auto descendantElement = dynamicDowncast<ElementType>(descendant))
        return ElementDescendantIterator<ElementType>(m_root, descendantElement);
    auto* next = Traversal<ElementType>::next(descendant, m_root.ptr());
    return ElementDescendantIterator<ElementType>(m_root, next);
}

template<typename ElementType> ElementType* ElementDescendantRange<ElementType>::first() const
{
    return Traversal<ElementType>::firstWithin(m_root);
}

template<typename ElementType> ElementType* ElementDescendantRange<ElementType>::last() const
{
    return Traversal<ElementType>::lastWithin(m_root);
}

// InclusiveElementDescendantRange

template<typename ElementType> ElementDescendantIterator<ElementType> InclusiveElementDescendantRange<ElementType>::begin() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST return ElementDescendantIterator<ElementType>(m_root, Traversal<ElementType>::inclusiveFirstWithin(const_cast<ContainerNode&>(m_root.get())));
}

template<typename ElementType> ElementDescendantIterator<ElementType> InclusiveElementDescendantRange<ElementType>::beginAt(ElementType& descendant) const
{
    ASSERT(descendant.isInclusiveDescendantOf(m_root));
    return ElementDescendantIterator<ElementType>(m_root, &descendant);
}

template<typename ElementType> ElementDescendantIterator<ElementType> InclusiveElementDescendantRange<ElementType>::from(Element& descendant) const
{
    ASSERT(descendant.isInclusiveDescendantOf(m_root));
    if (auto descendantElement = dynamicDowncast<ElementType>(descendant))
        return ElementDescendantIterator<ElementType>(m_root, descendantElement);
    ElementType* next = Traversal<ElementType>::next(descendant, &m_root);
    return ElementDescendantIterator<ElementType>(m_root, next);
}

template<typename ElementType> ElementType* InclusiveElementDescendantRange<ElementType>::first() const
{
    return Traversal<ElementType>::inclusiveFirstWithin(m_root);
}

template<typename ElementType> ElementType* InclusiveElementDescendantRange<ElementType>::last() const
{
    return Traversal<ElementType>::inclusiveLastWithin(m_root);
}

// DoubleElementDescendantRange

template<typename ElementType> auto DoubleElementDescendantRange<ElementType>::begin() const -> Iterator
{
    return Iterator(m_pair.first.begin(), m_pair.second.begin());
}

// DoubleElementDescendantIterator

template<typename ElementType> auto DoubleElementDescendantIterator<ElementType>::operator*() const -> ReferenceProxy
{
    return { *m_pair.first, *m_pair.second };
}

template<typename ElementType> constexpr bool DoubleElementDescendantIterator<ElementType>::operator==(std::nullptr_t) const
{
    ASSERT(!m_pair.first == !m_pair.second);
    return !m_pair.first;
}

template<typename ElementType> DoubleElementDescendantIterator<ElementType>& DoubleElementDescendantIterator<ElementType>::operator++()
{
    ++m_pair.first;
    ++m_pair.second;
    return *this;
}

// FilteredElementDescendantIterator

template<typename ElementType, bool filter(const ElementType&)> FilteredElementDescendantIterator<ElementType, filter>& FilteredElementDescendantIterator<ElementType, filter>::operator++()
{
    do {
        ElementIterator<ElementType>::traverseNext();
    } while (*this && !filter(protect(**this)));
    return *this;
}

// FilteredElementDescendantRange

template<typename ElementType, bool filter(const ElementType&)> auto FilteredElementDescendantRange<ElementType, filter>::begin() const -> Iterator
{
    return { m_root, first().get() };
}

template<typename ElementType, bool filter(const ElementType&)> RefPtr<ElementType> FilteredElementDescendantRange<ElementType, filter>::first() const
{
    for (RefPtr element = Traversal<ElementType>::firstWithin(m_root.get()); element; element = Traversal<ElementType>::next(*element, m_root.ptr())) {
        if (filter(*element))
            return element;
    }
    return nullptr;
}

// Standalone functions

template<typename ElementType> ElementDescendantRange<ElementType> descendantsOfType(ContainerNode& root)
{
    return ElementDescendantRange<ElementType>(root);
}

template<typename ElementType> InclusiveElementDescendantRange<ElementType> inclusiveDescendantsOfType(ContainerNode& root)
{
    return InclusiveElementDescendantRange<ElementType>(root);
}

template<typename ElementType> ElementDescendantRange<const ElementType> descendantsOfType(const ContainerNode& root)
{
    return ElementDescendantRange<const ElementType>(root);
}

template<typename ElementType> DoubleElementDescendantRange<ElementType> descendantsOfType(ContainerNode& firstRoot, ContainerNode& secondRoot)
{
    return { descendantsOfType<ElementType>(firstRoot), descendantsOfType<ElementType>(secondRoot) };
}

template<typename ElementType, bool filter(const ElementType&)> FilteredElementDescendantRange<ElementType, filter> filteredDescendants(const ContainerNode& root)
{
    return { root };
}


}
