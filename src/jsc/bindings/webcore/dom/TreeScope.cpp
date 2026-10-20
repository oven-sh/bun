/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2006-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2007 Rob Buis <buis@kde.org>
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

#include "config.h"
#include "TreeScope.h"

#include "Attr.h"
#include "ContainerNodeInlines.h"
#include "CustomElementRegistry.h"
#include "Document.h"
#include "HTMLAnchorElement.h"
#include "IdTargetObserverRegistry.h"
#include "NodeRareData.h"
#include "RadioButtonGroups.h"
#include "ShadowRoot.h"
#include "TreeScopeInlines.h"
#include "TreeScopeOrderedMap.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/text/AtomStringHash.h>
#include <wtf/text/CString.h>

namespace WebCore {

struct SameSizeAsTreeScope {
    void* pointers[8];
};

static_assert(sizeof(TreeScope) == sizeof(SameSizeAsTreeScope), "treescope should stay small");

using namespace HTMLNames;

struct NodesInCommonTreeScope {
    SUPPRESS_UNCOUNTED_MEMBER TreeScope* treeScope { nullptr };
    SUPPRESS_UNCOUNTED_MEMBER Node* nodeA { nullptr };
    SUPPRESS_UNCOUNTED_MEMBER Node* nodeB { nullptr };
};
static NodesInCommonTreeScope LEGACY_NODELETE findNodesInCommonTreeScope(Node*, Node*);

TreeScope::TreeScope(ShadowRoot& shadowRoot, Document& document, RefPtr<CustomElementRegistry>&& registry)
    : m_rootNode(shadowRoot)
    , m_documentScope(document)
    , m_parentTreeScope(&document)
    , m_customElementRegistry(WTF::move(registry))
{
    shadowRoot.setTreeScope(*this);
}

TreeScope::TreeScope(Document& document)
    : m_rootNode(document)
    , m_documentScope(document)
    , m_parentTreeScope(nullptr)
{
    document.setTreeScope(*this);
}

TreeScope::~TreeScope() = default;

void TreeScope::ref() const
{
    if (auto* document = dynamicDowncast<Document>(m_rootNode.get()))
        document->ref();
    else
        downcast<ShadowRoot>(m_rootNode.get()).ref();
}

void TreeScope::deref() const
{
    if (auto* document = dynamicDowncast<Document>(m_rootNode.get()))
        document->deref();
    else
        downcast<ShadowRoot>(m_rootNode.get()).deref();
}

IdTargetObserverRegistry& TreeScope::ensureIdTargetObserverRegistry()
{
    if (!m_idTargetObserverRegistry)
        lazyInitialize(m_idTargetObserverRegistry, makeUnique<IdTargetObserverRegistry>());
    return *m_idTargetObserverRegistry;
}

void TreeScope::destroyTreeScopeData()
{
    m_elementsById = nullptr;
    m_elementsByName = nullptr;
}

void TreeScope::setParentTreeScope(TreeScope& newParentScope)
{
    // A document node cannot be re-parented.
    ASSERT(!m_rootNode->isDocumentNode());

    m_parentTreeScope = &newParentScope;
    setDocumentScope(protect(newParentScope.documentScope()));
}

void TreeScope::setCustomElementRegistry(RefPtr<CustomElementRegistry>&& registry)
{
    m_customElementRegistry = WTF::move(registry);
}

RefPtr<Element> TreeScope::getElementById(const AtomString& elementId) const
{
    if (elementId.isEmpty())
        return nullptr;
    if (!m_elementsById)
        return nullptr;
    return m_elementsById->getElementById(elementId, *this);
}

RefPtr<Element> TreeScope::getElementById(const String& elementId) const
{
    if (!m_elementsById)
        return nullptr;

    if (auto atomElementId = elementId.toExistingAtomString(); !atomElementId.isNull())
        return m_elementsById->getElementById(atomElementId, *this);

    return nullptr;
}

RefPtr<Element> TreeScope::getElementById(StringView elementId) const
{
    if (!m_elementsById)
        return nullptr;

    if (auto atomElementId = elementId.toExistingAtomString(); !atomElementId.isNull())
        return m_elementsById->getElementById(atomElementId, *this);

    return nullptr;
}

RefPtr<Element> TreeScope::elementByIdResolvingReferenceTarget(const AtomString& elementId) const
{
    RefPtr elementForId = getElementById(elementId);
    return elementForId ? elementForId->resolveReferenceTarget() : nullptr;
}

const Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* TreeScope::getAllElementsById(const AtomString& elementId) const
{
    if (elementId.isEmpty())
        return nullptr;
    if (!m_elementsById)
        return nullptr;
    return m_elementsById->getAllElementsById(elementId, *this);
}

void TreeScope::addElementById(const AtomString& elementId, Element& element, bool notifyObservers)
{
    if (!m_elementsById)
        m_elementsById = makeUnique<TreeScopeOrderedMap>();
    m_elementsById->add(elementId, element, *this);
    if (m_idTargetObserverRegistry && notifyObservers)
        m_idTargetObserverRegistry->notifyObservers(element, elementId);
}

void TreeScope::removeElementById(const AtomString& elementId, Element& element, bool notifyObservers)
{
    if (!m_elementsById)
        return;
    m_elementsById->remove(elementId, element);
    if (m_idTargetObserverRegistry && notifyObservers)
        m_idTargetObserverRegistry->notifyObservers(element, elementId);
}

RefPtr<Element> TreeScope::getElementByName(const AtomString& name) const
{
    if (name.isEmpty())
        return nullptr;
    if (!m_elementsByName)
        return nullptr;
    return m_elementsByName->getElementByName(name, *this);
}

void TreeScope::addElementByName(const AtomString& name, Element& element)
{
    if (!m_elementsByName)
        m_elementsByName = makeUnique<TreeScopeOrderedMap>();
    m_elementsByName->add(name, element, *this);
}

void TreeScope::removeElementByName(const AtomString& name, Element& element)
{
    if (!m_elementsByName)
        return;
    m_elementsByName->remove(name, element);
}

Ref<Node> TreeScope::retargetToScope(Node& node) const
{
    ASSERT(findNodesInCommonTreeScope(&rootNode(), &node).nodeB == findNodesInCommonTreeScope(&node, &rootNode()).nodeA);
    auto* nodeInCommonAncestorTreeScope = findNodesInCommonTreeScope(&rootNode(), &node).nodeB;
    return nodeInCommonAncestorTreeScope ? *nodeInCommonAncestorTreeScope : node;
}

Node* TreeScope::ancestorNodeInThisScope(Node* node) const
{
    for (; node; node = node->shadowHost()) {
        if (&node->treeScope() == this)
            return node;
        if (!node->isInShadowTree())
            return nullptr;
    }
    return nullptr;
}

Element* TreeScope::ancestorElementInThisScope(Element* element) const
{
    for (; element; element = element->shadowHost()) {
        if (&element->treeScope() == this)
            return element;
        if (!element->isInShadowTree())
            return nullptr;
    }
    return nullptr;
}

// FIXME: Would be nice to change this to take a StringView, since that's what callers have
// and there is no particular advantage to already having a String.
RefPtr<Element> TreeScope::findAnchor(StringView name)
{
    if (name.isEmpty())
        return nullptr;
    if (RefPtr element = getElementById(name))
        return element;
    Ref rootNode = m_rootNode.get();
    for (auto& anchor : descendantsOfType<HTMLAnchorElement>(rootNode)) {
        if (isMatchingAnchor(anchor, name))
            return &anchor;
    }
    return nullptr;
}

bool TreeScope::isMatchingAnchor(HTMLAnchorElement& anchor, StringView name)
{
    if (documentScope().inQuirksMode()) {
        // Quirks mode, ASCII case-insensitive comparison of names.
        // FIXME: This behavior is not mentioned in the HTML specification.
        // We should either remove this or get this into the specification.
        if (equalIgnoringASCIICase(anchor.name(), name))
            return true;
    } else {
        // Strict mode, names need to match exactly.
        if (anchor.name() == name)
            return true;
    }
    return false;
}

Element* TreeScope::focusedElementInScope()
{
    auto& document = documentScope();
    auto* element = document.focusedElement();

    if (!element)
        element = document.focusedFrameOwnerElement();

    return ancestorElementInThisScope(element);
}

static ALWAYS_INLINE Node* LEGACY_NODELETE host(TreeScope& treeScope)
{
    if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(treeScope.rootNode()))
        return shadowRoot->host();
    return nullptr;
}

static NodesInCommonTreeScope findNodesInCommonTreeScope(Node* nodeA, Node* nodeB)
{
    if (!nodeA || !nodeB)
        return { nullptr, nullptr, nullptr };

    if (&nodeA->treeScope() == &nodeB->treeScope())
        return { &nodeA->treeScope(), nodeA, nodeB };

    if (&nodeA->document() != &nodeB->document())
        return { nullptr, nullptr, nullptr };

    unsigned depthA = 0;
    Node* currentNodeA = nodeA;
    for (auto* treeScope = &nodeA->treeScope(); treeScope; treeScope = treeScope->parentTreeScope()) {
        if (treeScope == &nodeB->treeScope())
            return { treeScope, currentNodeA, nodeB };
        depthA++;
        currentNodeA = host(*treeScope);
    }

    unsigned depthB = 0;
    Node* currentNodeB = nodeB;
    for (auto* treeScope = &nodeB->treeScope(); treeScope; treeScope = treeScope->parentTreeScope()) {
        if (treeScope == &nodeA->treeScope())
            return { treeScope, nodeA, currentNodeB };
        depthB++;
        currentNodeB = host(*treeScope);
    }

    if (depthA > depthB) {
        for (auto* treeScope = &nodeA->treeScope(); treeScope && depthA > depthB; treeScope = treeScope->parentTreeScope()) {
            nodeA = host(*treeScope);
            depthA--;
        }
    } else {
        for (auto* treeScope = &nodeB->treeScope(); treeScope && depthB > depthA; treeScope = treeScope->parentTreeScope()) {
            nodeB = host(*treeScope);
            depthB--;
        }
    }
    ASSERT(nodeA && nodeB);
    ASSERT(depthA == depthB);
    auto* treeScopeA = &nodeA->treeScope();
    auto* treeScopeB = &nodeB->treeScope();
    while (treeScopeA && treeScopeB) {
        if (treeScopeA == treeScopeB)
            return { treeScopeA, nodeA, nodeB };
        nodeA = host(*treeScopeA);
        nodeB = host(*treeScopeB);
        treeScopeA = treeScopeA->parentTreeScope();
        treeScopeB = treeScopeB->parentTreeScope();
    }

    ASSERT_NOT_REACHED(); // If they didn't share the root, document equality check above should have failed.
    return { nullptr, nullptr, nullptr };
}

TreeScope* commonTreeScope(Node* nodeA, Node* nodeB)
{
    return findNodesInCommonTreeScope(nodeA, nodeB).treeScope;
}

RadioButtonGroups& TreeScope::radioButtonGroups()
{
    if (!m_radioButtonGroups)
        lazyInitialize(m_radioButtonGroups, makeUnique<RadioButtonGroups>());
    return *m_radioButtonGroups;
}

} // namespace WebCore
