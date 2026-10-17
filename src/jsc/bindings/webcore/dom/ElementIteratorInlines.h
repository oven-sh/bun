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

#include "ElementInlines.h"
#include "ElementIterator.h"
#include "ElementTraversal.h"

namespace WebCore {

template <typename ElementType>
inline ElementIterator<ElementType>& ElementIterator<ElementType>::traverseNext()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());
    m_current = Traversal<ElementType>::next(*m_current, m_root.get());
#if ASSERT_ENABLED
    // Drop the assertion when the iterator reaches the end.
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

template <typename ElementType>
inline ElementIterator<ElementType>& ElementIterator<ElementType>::traversePrevious()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());
    m_current = Traversal<ElementType>::previous(*m_current, m_root.get());
#if ASSERT_ENABLED
    // Drop the assertion when the iterator reaches the end.
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

template <typename ElementType>
inline ElementIterator<ElementType>& ElementIterator<ElementType>::traverseNextSibling()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());
    m_current = Traversal<ElementType>::nextSibling(*m_current);
#if ASSERT_ENABLED
    // Drop the assertion when the iterator reaches the end.
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

template <typename ElementType>
inline ElementIterator<ElementType>& ElementIterator<ElementType>::traversePreviousSibling()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());
    m_current = Traversal<ElementType>::previousSibling(*m_current);
#if ASSERT_ENABLED
    // Drop the assertion when the iterator reaches the end.
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

template <typename ElementType>
inline ElementIterator<ElementType>& ElementIterator<ElementType>::traverseNextSkippingChildren()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());
    m_current = Traversal<ElementType>::nextSkippingChildren(*m_current, m_root.get());
#if ASSERT_ENABLED
    // Drop the assertion when the iterator reaches the end.
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

template <typename ElementType>
inline ElementType* findElementAncestorOfType(const Node& current)
{
    for (RefPtr ancestor = current.parentElement(); ancestor; ancestor = ancestor->parentElement()) {
        if (auto* element = dynamicDowncast<ElementType>(*ancestor))
            return element;
    }
    return nullptr;
}

template <>
inline Element* findElementAncestorOfType<Element>(const Node& current)
{
    return current.parentElement();
}

template <typename ElementType>
inline ElementIterator<ElementType>& ElementIterator<ElementType>::traverseAncestor()
{
    ASSERT(m_current);
    ASSERT(m_current != m_root);
    ASSERT(!m_assertions.domTreeHasMutated());
    m_current = findElementAncestorOfType<ElementType>(*protect(m_current));
#if ASSERT_ENABLED
    // Drop the assertion when the iterator reaches the end.
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

}
