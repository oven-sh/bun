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

#include <wtf/CheckedPtr.h>

#if ASSERT_ENABLED
#include "ElementIteratorAssertions.h"
#endif

namespace WebCore {

class ContainerNode;
class Node;

template <typename ElementType>
class ElementIterator {
public:
    using iterator_category = std::forward_iterator_tag;
    using value_type = ElementType;
    using difference_type = ptrdiff_t;
    using pointer = value_type*;
    using reference = value_type&;

    ElementIterator() = default;

    inline ElementType& operator*() const;
    inline ElementType* operator->() const;

    constexpr operator bool() const { return m_current.get(); }
    constexpr bool operator!() const { return !m_current; }
    constexpr bool operator==(std::nullptr_t) const { return !m_current; }
    constexpr bool operator==(const ElementIterator&) const;

    inline ElementIterator& traverseNext();
    inline ElementIterator& traversePrevious();
    inline ElementIterator& traverseNextSibling();
    inline ElementIterator& traversePreviousSibling();
    inline ElementIterator& traverseNextSkippingChildren();
    inline ElementIterator& traverseAncestor();

    inline void dropAssertions();

protected:
    ElementIterator(const ContainerNode* root, ElementType* current);

private:
    CheckedPtr<const ContainerNode> m_root;
    CheckedPtr<ElementType> m_current;

#if ASSERT_ENABLED
    ElementIteratorAssertions m_assertions;
#endif
};

template <typename ElementType>
inline ElementType* findElementAncestorOfType(const Node&);

// ElementIterator

template <typename ElementType>
inline ElementIterator<ElementType>::ElementIterator(const ContainerNode* root, ElementType* current)
    : m_root(root)
    , m_current(current)
#if ASSERT_ENABLED
    , m_assertions(current)
#endif
{
}

template<typename ElementType> constexpr bool ElementIterator<ElementType>::operator==(const ElementIterator& other) const
{
    ASSERT(m_root == other.m_root || !m_current || !other.m_current);
    return m_current == other.m_current;
}

template <typename ElementType>
inline ElementType& ElementIterator<ElementType>::operator*() const
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());
    return *m_current;
}

template <typename ElementType>
inline ElementType* ElementIterator<ElementType>::operator->() const
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());
    return m_current.get();
}

template <typename ElementType>
inline void ElementIterator<ElementType>::dropAssertions()
{
#if ASSERT_ENABLED
    m_assertions.clear();
#endif
}

} // namespace WebCore
