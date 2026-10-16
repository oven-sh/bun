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

#include "ElementChildIterator.h"
#include "ElementIteratorInlines.h"

namespace WebCore {

// ElementChildIterator

template <typename ElementType>
inline ElementChildIterator<ElementType>& ElementChildIterator<ElementType>::operator--()
{
    ElementIterator<ElementType>::traversePreviousSibling();
    return *this;
}

template <typename ElementType>
inline ElementChildIterator<ElementType>& ElementChildIterator<ElementType>::operator++()
{
    ElementIterator<ElementType>::traverseNextSibling();
    return *this;
}

// ElementChildRange

template <typename ElementType>
inline ElementChildIterator<ElementType> ElementChildRange<ElementType>::begin() const
{
    return ElementChildIterator<ElementType>(m_parent, Traversal<ElementType>::firstChild(m_parent));
}

template <typename ElementType>
inline ElementType* ElementChildRange<ElementType>::first() const
{
    return Traversal<ElementType>::firstChild(m_parent);
}

template <typename ElementType>
inline ElementType* ElementChildRange<ElementType>::last() const
{
    return Traversal<ElementType>::lastChild(m_parent);
}

template <typename ElementType>
inline ElementChildIterator<ElementType> ElementChildRange<ElementType>::beginAt(ElementType& child) const
{
    ASSERT(child.parentNode() == m_parent.ptr());
    return ElementChildIterator<ElementType>(m_parent.get(), &child);
}

}
