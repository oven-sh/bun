/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#pragma once

#include "Element.h"
#include "NodeTraversal.h"

namespace WebCore {

template <typename ElementType>
class Traversal {
public:
    // First or last ElementType child of the node.
    static ElementType* firstChild(const Node&);
    static ElementType* firstChild(const ContainerNode&);
    static ElementType* lastChild(const Node&);
    static ElementType* lastChild(const ContainerNode&);

    // First or last ElementType descendant of the node. For Elements firstWithin is always the same as first child.
    static ElementType* firstWithin(const Node&);
    static ElementType* firstWithin(const ContainerNode&);
    static ElementType* lastWithin(const Node&);
    static ElementType* lastWithin(const ContainerNode&);
    static ElementType* inclusiveFirstWithin(Node&);
    static ElementType* inclusiveFirstWithin(ContainerNode&);
    static ElementType* inclusiveLastWithin(Node&);
    static ElementType* inclusiveLastWithin(ContainerNode&);

    // Pre-order traversal skipping non-ElementType nodes.
    static ElementType* next(const Node&);
    static ElementType* next(const Node&, const Node* stayWithin);
    static ElementType* next(const ContainerNode&);
    static ElementType* next(const ContainerNode&, const Node* stayWithin);
    static ElementType* previous(const Node&);
    static ElementType* previous(const Node&, const Node* stayWithin);

    // Next or previous ElementType sibling if there is one.
    static ElementType* nextSibling(const Node&);
    static ElementType* previousSibling(const Node&);

    // Like next, but skips children.
    static ElementType* nextSkippingChildren(const Node&);
    static ElementType* nextSkippingChildren(const Node&, const Node* stayWithin);

private:
    template <typename CurrentType> static ElementType* firstChildTemplate(CurrentType&);
    template <typename CurrentType> static ElementType* lastChildTemplate(CurrentType&);
    template <typename CurrentType> static ElementType* firstWithinTemplate(CurrentType&);
    template <typename CurrentType> static ElementType* lastWithinTemplate(CurrentType&);
    template <typename CurrentType> static ElementType* nextTemplate(CurrentType&);
    template <typename CurrentType> static ElementType* nextTemplate(CurrentType&, const Node* stayWithin);
};

class ElementTraversal : public Traversal<Element> {
};

// Specialized for pure Element to exploit the fact that Elements parent is always either another Element or the root.
template <>
template <typename CurrentType>
inline Element* Traversal<Element>::firstWithinTemplate(CurrentType& current)
{
    return firstChildTemplate(current);
}

template <>
template <typename CurrentType>
inline Element* Traversal<Element>::nextTemplate(CurrentType& current)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = NodeTraversal::next(current); node; node = NodeTraversal::nextSkippingChildren(*node)) {
        if (auto* element = dynamicDowncast<Element>(*node))
            return element;
    }
    return nullptr;
}

template <>
template <typename CurrentType>
inline Element* Traversal<Element>::nextTemplate(CurrentType& current, const Node* stayWithin)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = NodeTraversal::next(current, stayWithin); node; node = NodeTraversal::nextSkippingChildren(*node, stayWithin)) {
        if (auto* element = dynamicDowncast<Element>(*node))
            return element;
    }
    return nullptr;
}

// Generic versions.
template <typename ElementType>
template <typename CurrentType>
inline ElementType* Traversal<ElementType>::firstChildTemplate(CurrentType& current)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = current.firstChild(); node; node = node->nextSibling()) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
template <typename CurrentType>
inline ElementType* Traversal<ElementType>::lastChildTemplate(CurrentType& current)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = current.lastChild(); node; node = node->previousSibling()) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
template <typename CurrentType>
inline ElementType* Traversal<ElementType>::firstWithinTemplate(CurrentType& current)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = current.firstChild(); node; node = NodeTraversal::next(*node, &current)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
template <typename CurrentType>
inline ElementType* Traversal<ElementType>::lastWithinTemplate(CurrentType& current)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = NodeTraversal::last(current); node; node = NodeTraversal::previous(*node, &current)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
template <typename CurrentType>
inline ElementType* Traversal<ElementType>::nextTemplate(CurrentType& current)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = NodeTraversal::next(current); node; node = NodeTraversal::next(*node)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
template <typename CurrentType>
inline ElementType* Traversal<ElementType>::nextTemplate(CurrentType& current, const Node* stayWithin)
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* node = NodeTraversal::next(current, stayWithin); node; node = NodeTraversal::next(*node, stayWithin)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::previous(const Node& current)
{
    for (SUPPRESS_UNCOUNTED_LOCAL auto* node = NodeTraversal::previous(current); node; node = NodeTraversal::previous(*node)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::previous(const Node& current, const Node* stayWithin)
{
    for (SUPPRESS_UNCOUNTED_LOCAL auto* node = NodeTraversal::previous(current, stayWithin); node; node = NodeTraversal::previous(*node, stayWithin)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::nextSibling(const Node& current)
{
    for (SUPPRESS_UNCOUNTED_LOCAL auto* node = current.nextSibling(); node; node = node->nextSibling()) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::previousSibling(const Node& current)
{
    for (SUPPRESS_UNCOUNTED_LOCAL auto* node = current.previousSibling(); node; node = node->previousSibling()) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::nextSkippingChildren(const Node& current)
{
    for (SUPPRESS_UNCOUNTED_LOCAL auto* node = NodeTraversal::nextSkippingChildren(current); node; node = NodeTraversal::nextSkippingChildren(*node)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::nextSkippingChildren(const Node& current, const Node* stayWithin)
{
    for (SUPPRESS_UNCOUNTED_LOCAL auto* node = NodeTraversal::nextSkippingChildren(current, stayWithin); node; node = NodeTraversal::nextSkippingChildren(*node, stayWithin)) {
        if (auto* element = dynamicDowncast<ElementType>(*node))
            return element;
    }
    return nullptr;
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::firstChild(const ContainerNode& current) { return firstChildTemplate(current); }
template <typename ElementType>
inline ElementType* Traversal<ElementType>::firstChild(const Node& current) { return firstChildTemplate(current); }
template <typename ElementType>

inline ElementType* Traversal<ElementType>::lastChild(const ContainerNode& current) { return lastChildTemplate(current); }
template <typename ElementType>
inline ElementType* Traversal<ElementType>::lastChild(const Node& current) { return lastChildTemplate(current); }

template <typename ElementType>
inline ElementType* Traversal<ElementType>::inclusiveFirstWithin(ContainerNode& current)
{
    if (auto* element = dynamicDowncast<ElementType>(current))
        return element;
    return firstWithin(current);
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::inclusiveFirstWithin(Node& current)
{
    if (auto* element = dynamicDowncast<ElementType>(current))
        return element;
    return firstWithin(current);
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::inclusiveLastWithin(ContainerNode& current)
{
    if (auto* element = dynamicDowncast<ElementType>(current))
        return element;
    return lastWithin(current);
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::inclusiveLastWithin(Node& current)
{
    if (auto* element = dynamicDowncast<ElementType>(current))
        return element;
    return lastWithin(current);
}

template <typename ElementType>
inline ElementType* Traversal<ElementType>::firstWithin(const ContainerNode& current) { return firstWithinTemplate(current); }
template <typename ElementType>
inline ElementType* Traversal<ElementType>::firstWithin(const Node& current) { return firstWithinTemplate(current); }
template <typename ElementType>

inline ElementType* Traversal<ElementType>::lastWithin(const ContainerNode& current) { return lastWithinTemplate(current); }
template <typename ElementType>
inline ElementType* Traversal<ElementType>::lastWithin(const Node& current) { return lastWithinTemplate(current); }

template <typename ElementType>
inline ElementType* Traversal<ElementType>::next(const ContainerNode& current) { return nextTemplate(current); }
template <typename ElementType>
inline ElementType* Traversal<ElementType>::next(const Node& current) { return nextTemplate(current); }
template <typename ElementType>
inline ElementType* Traversal<ElementType>::next(const ContainerNode& current, const Node* stayWithin) { return nextTemplate(current, stayWithin); }
template <typename ElementType>
inline ElementType* Traversal<ElementType>::next(const Node& current, const Node* stayWithin) { return nextTemplate(current, stayWithin); }

} // namespace WebCore
