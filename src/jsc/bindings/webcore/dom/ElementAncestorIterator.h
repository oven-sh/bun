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

template<typename> class ElementAncestorRange;

// Range for iterating an element and its ancestors.
template<typename ElementType>
inline ElementAncestorRange<ElementType> lineageOfType(Element& first);
template<typename ElementType>
inline ElementAncestorRange<const ElementType> lineageOfType(const Element& first);

// Range for iterating a node's element ancestors.
template<typename ElementType>
inline ElementAncestorRange<ElementType> ancestorsOfType(Node& descendant);
template<typename ElementType>
inline ElementAncestorRange<const ElementType> ancestorsOfType(const Node& descendant);

template <typename ElementType>
class ElementAncestorIterator : public ElementIterator<ElementType> {
public:
    explicit ElementAncestorIterator(ElementType* = nullptr);
    inline ElementAncestorIterator& operator++();
};

template <typename ElementType>
class ElementAncestorRange {
public:
    explicit ElementAncestorRange(ElementType* first);
    ElementAncestorIterator<ElementType> begin() const;
    static constexpr std::nullptr_t end() { return nullptr; }
    ElementType* first() const { return m_first.get(); }

private:
    const RefPtr<ElementType> m_first;
};

// ElementAncestorIterator

template <typename ElementType>
inline ElementAncestorIterator<ElementType>::ElementAncestorIterator(ElementType* current)
    : ElementIterator<ElementType>(nullptr, current)
{
}

// ElementAncestorRange

template <typename ElementType>
inline ElementAncestorRange<ElementType>::ElementAncestorRange(ElementType* first)
    : m_first(first)
{
}

} // namespace WebCore
