/*
 * Copyright (C) 2004-2020 Apple Inc. All rights reserved.
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

#include "CharacterData.h"
#include "Document.h"
#include "Element.h"
#include "EventTargetInlines.h"
#include "GCReachableRef.h"
#include "Node.h"
#include "NodeDocument.h"
#include "NodeInlinesLight.h"
#include "ShadowRoot.h"
#include "TreeScopeInlines.h"

namespace WebCore {

inline bool Node::isUserAgentShadowRoot() const
{
    auto* shadowRoot = dynamicDowncast<ShadowRoot>(*this);
    return shadowRoot && shadowRoot->mode() == ShadowRootMode::UserAgent;
}

inline ContainerNode* Node::parentOrShadowHostNode() const
{
    if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(*this))
        return shadowRoot->host();
    return parentNode();
}

inline Document* Node::ownerDocument() const
{
    auto* document = &this->document();
    return document == this ? nullptr : document;
}

inline bool Node::hasAttributes() const
{
    auto* element = dynamicDowncast<Element>(*this);
    return element && element->hasAttributes();
}

inline NamedNodeMap* Node::attributesMap() const
{
    if (auto* element = dynamicDowncast<Element>(*this))
        return &element->attributesMap();
    return nullptr;
}

inline Element* Node::parentElement() const
{
    return dynamicDowncast<Element>(parentNode());
}

inline void Node::setTabIndexState(TabIndexState state)
{
    auto bitfields = rareDataBitfields();
    bitfields.tabIndexState = std::to_underlying(state);
    setRareDataBitfields(bitfields);
}

inline unsigned Node::length() const
{
    if (auto characterData = dynamicDowncast<CharacterData>(*this))
        return characterData->length();
    return countChildNodes();
}

inline unsigned Node::countChildNodes() const
{
    auto* containerNode = dynamicDowncast<ContainerNode>(*this);
    return containerNode ? containerNode->countChildNodes() : 0;
}

inline Node* Node::traverseToChildAt(unsigned index) const
{
    auto* containerNode = dynamicDowncast<ContainerNode>(*this);
    return containerNode ? containerNode->traverseToChildAt(index) : nullptr;
}

inline Node* Node::firstChild() const
{
    auto* containerNode = dynamicDowncast<ContainerNode>(*this);
    return containerNode ? containerNode->firstChild() : nullptr;
}

inline Node* Node::lastChild() const
{
    auto* containerNode = dynamicDowncast<ContainerNode>(*this);
    return containerNode ? containerNode->lastChild() : nullptr;
}

inline bool Node::hasChildNodes() const
{
    return firstChild();
}

inline Node& Node::rootNode() const
{
    if (isInTreeScope())
        return treeScope().rootNode();
    return *m_shadowIncludingRoot;
}

inline void Node::setParentNode(ContainerNode* parent)
{
    m_parentNode = parent;
    m_refCountAndParentBit = (m_refCountAndParentBit & s_refCountMask) | !!parent;
}

ALWAYS_INLINE bool Node::hasOneRef() const
{
    ASSERT(!deletionHasBegun());
    ASSERT(!m_inRemovedLastRefFunction);
    return refCount() == 1;
}

inline void Node::setTreeScopeRecursively(TreeScope& newTreeScope)
{
    ASSERT(!isDocumentNode());
    ASSERT(!deletionHasBegun());
    if (m_treeScope != &newTreeScope) {
        Ref oldTreeScope = *m_treeScope;
        moveTreeToNewScope(*this, oldTreeScope, newTreeScope);
    }
}

inline void Node::setTreeScopeRecursivelyToMatch(const Node& node)
{
    if (m_treeScope != &node.treeScope()) [[unlikely]]
        setTreeScopeRecursively(protect(node.treeScope()));
}

inline void Node::setTreeScopeRecursivelyToDocument()
{
    if (m_treeScope != &document()) [[unlikely]]
        setTreeScopeRecursively(protect(document()));
}

inline ContainerNode* Node::parentNodeGuaranteedHostFree() const
{
    ASSERT(!isShadowRoot());
    return parentNode();
}

inline void Node::setTreeScope(TreeScope& scope)
{
    Locker locker { TreeScope::treeScopeMutationLock() };
    m_treeScope = &scope;
}

template<typename NodeClass>
inline NodeClass& Node::traverseToRootNodeInternal(const NodeClass& node)
{
    auto* current = const_cast<NodeClass*>(&node);
    while (current->parentNode())
        current = current->parentNode();
    return *current;
}

inline void collectChildNodes(Node& node, NodeVector& children)
{
    for (SUPPRESS_UNCOUNTED_LOCAL Node* child = node.firstChild(); child; child = child->nextSibling())
        children.append(*child);
}

template<typename T, typename Task>
void Node::queueTaskKeepingNodeAlive(T& node, TaskSource source, Task&& task)
{
    static_assert(!std::is_base_of_v<ActiveDOMObject, T>, "Use ActiveDOMObject::queueTaskKeepingObjectAlive instead");
    protect(node.document())->queueTask(source, [protectedThis = GCReachableRef(node), task = std::forward<Task>(task)]() mutable {
        // Static analyzer does not know about GCReachableRef.
        SUPPRESS_UNCOUNTED_ARG task(protectedThis.get());
    });
}

} // namespace WebCore
