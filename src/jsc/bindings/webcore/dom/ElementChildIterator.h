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

template<typename> class ElementChildRange;

// Range for iterating through child elements.
template <typename ElementType> ElementChildRange<ElementType> childrenOfType(ContainerNode&);
template <typename ElementType> ElementChildRange<const ElementType> childrenOfType(const ContainerNode&);

template <typename ElementType>
class ElementChildIterator : public ElementIterator<ElementType> {
public:
    ElementChildIterator() = default;
    ElementChildIterator(const ContainerNode& parent, ElementType* current);
    inline ElementChildIterator& operator--();
    inline ElementChildIterator& operator++();
};

template <typename ElementType>
class ElementChildRange {
public:
    ElementChildRange(const ContainerNode& parent);

    inline ElementChildIterator<ElementType> begin() const;
    inline static constexpr std::nullptr_t end() { return nullptr; }
    inline ElementChildIterator<ElementType> beginAt(ElementType&) const;
    
    inline ElementType* first() const;
    inline ElementType* last() const;

private:
    CheckedRef<const ContainerNode> m_parent;
};

// ElementChildIterator

template <typename ElementType>
inline ElementChildIterator<ElementType>::ElementChildIterator(const ContainerNode& parent, ElementType* current)
    : ElementIterator<ElementType>(&parent, current)
{
}

// ElementChildRange

template <typename ElementType>
inline ElementChildRange<ElementType>::ElementChildRange(const ContainerNode& parent)
    : m_parent(parent)
{
}

// Standalone functions

template <typename ElementType>
inline ElementChildRange<ElementType> childrenOfType(ContainerNode& parent)
{
    return ElementChildRange<ElementType>(parent);
}

template <typename ElementType>
inline ElementChildRange<const ElementType> childrenOfType(const ContainerNode& parent)
{
    return ElementChildRange<const ElementType>(parent);
}

} // namespace WebCore
