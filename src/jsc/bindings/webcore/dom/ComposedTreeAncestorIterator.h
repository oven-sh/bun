/*
 * Copyright (C) 2015 Apple Inc. All rights reserved.
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

#include "HTMLSlotElement.h"
#include "ShadowRoot.h"
#include "SlotAssignment.h"

namespace WebCore {

class HTMLSlotElement;

template<typename ElementType = Element>
class ComposedTreeAncestorIterator {
public:
    ComposedTreeAncestorIterator();
    ComposedTreeAncestorIterator(ElementType& current);
    ComposedTreeAncestorIterator(const Node& current);

    ElementType& operator*() { return get(); }
    ElementType* operator->() { return &get(); }

    friend bool operator==(ComposedTreeAncestorIterator, ComposedTreeAncestorIterator) = default;

    ComposedTreeAncestorIterator& operator++()
    {
        m_current = traverseParent(m_current.get());
        return *this;
    }

    ElementType& get() { return *m_current; }

private:
    static ElementType* LEGACY_NODELETE traverseParent(const Node*);

    CheckedPtr<ElementType> m_current;
};

template<typename ElementType>
inline ComposedTreeAncestorIterator<ElementType>::ComposedTreeAncestorIterator()
{
}

template<typename ElementType>
inline ComposedTreeAncestorIterator<ElementType>::ComposedTreeAncestorIterator(const Node& current)
    : m_current(traverseParent(&current))
{
    ASSERT(!is<ShadowRoot>(current));
}

template<typename ElementType>
inline ComposedTreeAncestorIterator<ElementType>::ComposedTreeAncestorIterator(ElementType& current)
    : m_current(&current)
{
}

template<typename ElementType>
inline ElementType* ComposedTreeAncestorIterator<ElementType>::traverseParent(const Node* current)
{
    auto* parent = current->parentNode();
    if (!parent)
        return nullptr;
    if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(*parent))
        return shadowRoot->host();
    auto* parentElement = dynamicDowncast<Element>(*parent);
    if (!parentElement)
        return nullptr;
    if (auto* shadowRoot = parentElement->shadowRoot())
        return shadowRoot->findAssignedSlot(*current);
    return parentElement;
}

template<typename ElementType = Element>
class ComposedTreeAncestorAdapter {
public:
    using iterator = ComposedTreeAncestorIterator<ElementType>;
    using NodeType = std::conditional_t<std::is_const_v<ElementType>, const Node, Node>;

    ComposedTreeAncestorAdapter(NodeType& node)
        : m_node(node)
    { }

    iterator begin()
    {
        if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(m_node.get())) {
            auto* shadowHost = shadowRoot->host();
            ASSERT(shadowHost);
            if (!shadowHost)
                return end();
            return iterator(*shadowHost);
        }
        return iterator(m_node);
    }
    iterator end()
    {
        return iterator();
    }
    ElementType* first()
    {
        auto it = begin();
        if (it == end())
            return nullptr;
        return &it.get();
    }

private:
    const Ref<NodeType> m_node;
};

inline ComposedTreeAncestorAdapter<Element> composedTreeAncestors(Node& node)
{
    return ComposedTreeAncestorAdapter<Element>(node);
}

inline ComposedTreeAncestorAdapter<const Element> composedTreeAncestors(const Node& node)
{
    return ComposedTreeAncestorAdapter<const Element>(node);
}

template<typename ElementType = Element>
class ComposedTreeLineageAdapter {
public:
    using iterator = ComposedTreeAncestorIterator<ElementType>;

    ComposedTreeLineageAdapter(ElementType& element)
        : m_element(element)
    { }

    iterator begin() { return iterator(m_element.get()); }
    iterator end() { return iterator(); }

private:
    const Ref<ElementType> m_element;
};

inline ComposedTreeLineageAdapter<Element> composedTreeLineage(Element& element)
{
    return ComposedTreeLineageAdapter<Element>(element);
}

inline ComposedTreeLineageAdapter<const Element> composedTreeLineage(const Element& element)
{
    return ComposedTreeLineageAdapter<const Element>(element);
}

} // namespace WebCore
