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

#include "ElementAncestorIterator.h"
#include "ElementIteratorInlines.h"

namespace WebCore {

// ElementAncestorIterator

template <typename ElementType>
inline ElementAncestorIterator<ElementType>& ElementAncestorIterator<ElementType>::operator++()
{
    ElementIterator<ElementType>::traverseAncestor();
    return *this;
}

// ElementAncestorRange

template <typename ElementType>
inline ElementAncestorIterator<ElementType> ElementAncestorRange<ElementType>::begin() const
{
    return ElementAncestorIterator<ElementType>(m_first.get());
}

// Standalone functions

template<> inline ElementAncestorRange<Element> lineageOfType<Element>(Element& first)
{
    return ElementAncestorRange<Element>(&first);
}

template <typename ElementType>
inline ElementAncestorRange<ElementType> lineageOfType(Element& first)
{
    if (auto* element = dynamicDowncast<ElementType>(first))
        return ElementAncestorRange<ElementType>(element);
    return ancestorsOfType<ElementType>(first);
}

template<> inline ElementAncestorRange<const Element> lineageOfType<Element>(const Element& first)
{
    return ElementAncestorRange<const Element>(&first);
}

template <typename ElementType>
inline ElementAncestorRange<const ElementType> lineageOfType(const Element& first)
{
    if (auto* element = dynamicDowncast<ElementType>(first))
        return ElementAncestorRange<const ElementType>(element);
    return ancestorsOfType<ElementType>(first);
}

template <typename ElementType>
inline ElementAncestorRange<ElementType> lineageOfType(Node& first)
{
    if (auto* element = dynamicDowncast<ElementType>(first))
        return ElementAncestorRange<ElementType>(element);
    return ancestorsOfType<ElementType>(first);
}

template <typename ElementType>
inline ElementAncestorRange<const ElementType> lineageOfType(const Node& first)
{
    if (auto* element = dynamicDowncast<ElementType>(first))
        return ElementAncestorRange<const ElementType>(element);
    return ancestorsOfType<ElementType>(first);
}

template <typename ElementType>
inline ElementAncestorRange<ElementType> ancestorsOfType(Node& descendant)
{
    return ElementAncestorRange<ElementType>(findElementAncestorOfType<ElementType>(descendant));
}

template <typename ElementType>
inline ElementAncestorRange<const ElementType> ancestorsOfType(const Node& descendant)
{
    return ElementAncestorRange<const ElementType>(findElementAncestorOfType<const ElementType>(descendant));
}
}
