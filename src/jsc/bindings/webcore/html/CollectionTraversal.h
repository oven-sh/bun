/*
 * Copyright (C) 2015-2020 Apple Inc. All rights reserved.
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

#include "CollectionType.h"
#include "ElementChildIterator.h"
#include "TypedElementDescendantIterator.h"
#include <wtf/WeakPtr.h>

namespace WebCore {

class ContainerNode;
class WeakPtrImplWithEventTargetData;

template <CollectionTraversalType traversalType>
struct CollectionTraversal { };

template <>
struct CollectionTraversal<CollectionTraversalType::Descendants> {
    using Iterator = ElementDescendantIterator<Element>;

    template <typename CollectionClass>
    static inline Iterator begin(const CollectionClass&, ContainerNode& rootNode);

    template <typename CollectionClass>
    static inline Iterator last(const CollectionClass&, ContainerNode& rootNode);

    template <typename CollectionClass>
    static inline void traverseForward(const CollectionClass&, Iterator& current, unsigned count, unsigned& traversedCount);

    template <typename CollectionClass>
    static inline void traverseBackward(const CollectionClass&, Iterator& current, unsigned count);
};

template <>
struct CollectionTraversal<CollectionTraversalType::WeakPtrDescendants> {
    using Iterator = WeakPtr<Element, WeakPtrImplWithEventTargetData>;

    template <typename CollectionClass>
    static inline Iterator begin(const CollectionClass&, ContainerNode& rootNode);

    template <typename CollectionClass>
    static inline Iterator last(const CollectionClass&, ContainerNode& rootNode);

    template <typename CollectionClass>
    static inline void traverseForward(const CollectionClass&, Iterator& current, unsigned count, unsigned& traversedCount);

    template <typename CollectionClass>
    static inline void traverseBackward(const CollectionClass&, Iterator& current, unsigned count);
};

template <>
struct CollectionTraversal<CollectionTraversalType::ChildrenOnly> {
    using Iterator = ElementChildIterator<Element>;

    template <typename CollectionClass>
    static inline Iterator begin(const CollectionClass&, ContainerNode& rootNode);

    template <typename CollectionClass>
    static inline Iterator last(const CollectionClass&, ContainerNode& rootNode);

    template <typename CollectionClass>
    static inline void traverseForward(const CollectionClass&, Iterator& current, unsigned count, unsigned& traversedCount);

    template <typename CollectionClass>
    static inline void traverseBackward(const CollectionClass&, Iterator& current, unsigned count);
};

template <>
struct CollectionTraversal<CollectionTraversalType::CustomForwardOnly> {
    using Iterator = Element*;

    static constexpr Element* end(ContainerNode&) { return nullptr; }

    template <typename CollectionClass>
    static inline Element* begin(const CollectionClass&, ContainerNode&);

    template <typename CollectionClass>
    static inline Element* last(const CollectionClass&, ContainerNode&);

    template <typename CollectionClass>
    static inline void traverseForward(const CollectionClass&, Element*& current, unsigned count, unsigned& traversedCount);

    template <typename CollectionClass>
    static inline void traverseBackward(const CollectionClass&, Element*&, unsigned count);
};

} // namespace WebCore

namespace std {

template<> struct iterator_traits<WeakPtr<WebCore::Element, WebCore::WeakPtrImplWithEventTargetData>> { using value_type = WebCore::Element; };

}
