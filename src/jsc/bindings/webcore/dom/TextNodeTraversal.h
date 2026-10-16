/*
 * Copyright (C) 2013 Apple Inc. All rights reserved.
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

#include "NodeTraversal.h"
#include "Text.h"

namespace WTF {
class StringBuilder;
}

namespace WebCore {
namespace TextNodeTraversal {

// First text child of the node.
Text* firstChild(const Node&);
Text* firstChild(const ContainerNode&);

// First text descendant of the node.
Text* firstWithin(const Node&);
Text* firstWithin(const ContainerNode&);

// Pre-order traversal skipping non-text nodes.
Text* next(const Node&);
Text* next(const Node&, const Node* stayWithin);
Text* next(const Text&);
Text* next(const Text&, const Node* stayWithin);

// Next text sibling.
Text* nextSibling(const Node&);

// Concatenated text contents of a subtree.
String contentsAsString(const Node&);
String contentsAsString(const ContainerNode&);
void appendContents(const ContainerNode&, StringBuilder& result);
String childTextContent(const ContainerNode&);

}

namespace TextNodeTraversal {

template <class NodeType>
inline Text* firstTextChildTemplate(NodeType& current)
{
    for (auto* node = current.firstChild(); node; node = node->nextSibling()) {
        if (auto* text = dynamicDowncast<Text>(*node))
            return text;
    }
    return nullptr;
}
inline Text* firstChild(const Node& current) { return firstTextChildTemplate(current); }
inline Text* firstChild(const ContainerNode& current) { return firstTextChildTemplate(current); }

template <class NodeType>
inline Text* firstTextWithinTemplate(NodeType& current)
{
    for (auto* node = current.firstChild(); node; node = NodeTraversal::next(*node, &current)) {
        if (auto* text = dynamicDowncast<Text>(*node))
            return text;
    }
    return nullptr;
}
inline Text* firstWithin(const Node& current) { return firstTextWithinTemplate(current); }
inline Text* firstWithin(const ContainerNode& current) { return firstTextWithinTemplate(current); }

template <class NodeType>
inline Text* traverseNextTextTemplate(NodeType& current)
{
    for (auto* node = NodeTraversal::next(current); node; node = NodeTraversal::next(*node)) {
        if (auto* text = dynamicDowncast<Text>(*node))
            return text;
    }
    return nullptr;
}
inline Text* next(const Node& current) { return traverseNextTextTemplate(current); }
inline Text* next(const Text& current) { return traverseNextTextTemplate(current); }

template <class NodeType>
inline Text* traverseNextTextTemplate(NodeType& current, const Node* stayWithin)
{
    for (auto* node = NodeTraversal::next(current, stayWithin); node; node = NodeTraversal::next(*node, stayWithin)) {
        if (auto* text = dynamicDowncast<Text>(*node))
            return text;
    }
    return nullptr;
}
inline Text* next(const Node& current, const Node* stayWithin) { return traverseNextTextTemplate(current, stayWithin); }
inline Text* next(const Text& current, const Node* stayWithin) { return traverseNextTextTemplate(current, stayWithin); }

inline Text* nextSibling(const Node& current)
{
    for (auto* node = current.nextSibling(); node; node = node->nextSibling()) {
        if (auto* text = dynamicDowncast<Text>(*node))
            return text;
    }
    return nullptr;
}

} // namespace TextNodeTraversal
} // namespace WebCore
