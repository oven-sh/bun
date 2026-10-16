/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
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
 */

#include "config.h"
#include "Node.h"

#include "Attr.h"
#include "ChildListMutationScope.h"
#include "CommonAtomStrings.h"
#include "ContainerNodeAlgorithms.h"
#include "ContainerNodeInlines.h"
#include "CustomElementRegistry.h"
#include "DocumentFragment.h"
#include "DocumentInlines.h"
#include "DocumentType.h"
#include "ElementRareData.h"
#include "ElementTraversal.h"
#include "EventDispatcher.h"
#include "EventNames.h"
#include "HTMLElement.h"
#include "HTMLSlotElement.h"
#include "LiveNodeListInlines.h"
#include "MutationObserverRegistration.h"
#include "NodeRareDataInlines.h"
#include "ProcessingInstruction.h"
#include "ScriptDisallowedScope.h"
#include "SlotAssignment.h"
#include "Text.h"
#include "TreeScopeInlines.h"
#include "UIEvent.h"
#include "Window.h"
#include "XMLNSNames.h"
#include "XMLNames.h"
#include <wtf/HexNumber.h>
#include <wtf/SHA1.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/TextStream.h>

template class mpark::variant<WTF::Ref<WebCore::Node>, WTF::String>;

namespace WebCore {

WTF_MAKE_PREFERABLY_COMPACT_TZONE_ALLOCATED_IMPL(Node);

using namespace HTMLNames;

struct SameSizeAsNode : EventTarget, CanMakeCheckedPtr<SameSizeAsNode> {
    WTF_MAKE_TZONE_ALLOCATED(SameSizeAsNode);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(SameSizeAsNode);
public:
#if ASSERT_ENABLED
    bool inRemovedLastRefFunction;
    bool deletionHasBegun;
#endif
    uint32_t refCountAndParentBit;
    uint32_t nodeFlags;
    uint32_t stateFlags;
    void* parentNode;
    void* treeScope;
    void* shadowIncludingRoot;
    void* previous;
    void* next;
    uint8_t rareDataWithBitfields[8];
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(SameSizeAsNode);

static_assert(sizeof(Node) == sizeof(SameSizeAsNode), "Node should stay small");

inline void NodeRareData::operator delete(NodeRareData* nodeRareData, std::destroying_delete_t)
{
    auto destroyAndFree = [&]<typename RareDataType> (RareDataType& value) {
        std::destroy_at(&value);
        RareDataType::freeAfterDestruction(&value);
    };

    if (auto* elementRareData = dynamicDowncast<ElementRareData>(*nodeRareData))
        destroyAndFree(*elementRareData);
    else
        destroyAndFree(*nodeRareData);
}

Node::Node(Document& document, NodeType type, OptionSet<TypeFlag> flags)
    : EventTarget(ConstructNode)
    , m_typeBitFields(constructBitFieldsFromNodeTypeAndFlags(type, flags))
    , m_treeScope((isDocumentNode() || isShadowRoot()) ? nullptr : &document)
    , m_shadowIncludingRoot(this)
{
    ASSERT(nodeType() == type);

    if (!isDocumentNode())
        document.incrementReferencingNodeCount();
}

Node::Node(ClangVTableWorkaroundTag, Document& document)
    : Node(document, NodeType::Element, { })
{
}

Node::~Node()
{
    ASSERT(deletionHasBegun());

    ASSERT(!parentNode());
    ASSERT(!m_previousSibling);
    ASSERT(!m_next);

    {
        SUPPRESS_UNCHECKED_LOCAL auto& document = this->document(); // Store document before clearing out m_treeScope.

        // The call to decrementReferencingNodeCount() below may destroy the document so we need to clear our
        // m_treeScope CheckedPtr beforehand.
        m_treeScope = nullptr;

        if (!isDocumentNode())
            document.decrementReferencingNodeCount(); // This may destroy the document.
    }

#if ASSERT_ENABLED
    if (m_refCountAndParentBit != s_refCountIncrement)
        WTF::RefCountDebuggerBase::printRefDuringDestructionLogAndCrash(this);
#endif
    RELEASE_ASSERT(m_refCountAndParentBit == s_refCountIncrement);
}

void Node::materializeRareData()
{
    if (is<Element>(*this))
        m_rareDataWithBitfields.setPointer(makeUnique<ElementRareData>());
    else
        m_rareDataWithBitfields.setPointer(makeUnique<NodeRareData>());
}

void Node::clearRareData()
{
    ASSERT(hasRareData());
    ASSERT(!transientMutationObserverRegistry() || transientMutationObserverRegistry()->isEmptyIgnoringNullReferences());

    m_rareDataWithBitfields.setPointer(nullptr);
}

String Node::nodeValue() const
{
    return String();
}

ExceptionOr<void> Node::setNodeValue(const String&)
{
    // By default, setting nodeValue has no effect.
    return { };
}

Ref<NodeList> Node::childNodes()
{
    if (auto* containerNode = dynamicDowncast<ContainerNode>(*this))
        return ensureRareData().ensureNodeLists().ensureChildNodeList(*containerNode);
    return ensureRareData().ensureNodeLists().ensureEmptyChildNodeList(*this);
}

Node* Node::lastDescendant() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST Node* node = const_cast<Node*>(this);
    while (auto* child = node->lastChild())
        node = child;
    return node;
}

Node* Node::firstDescendant() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST Node* node = const_cast<Node*>(this);
    while (auto* child = node->firstChild())
        node = child;
    return node;
}

Element* Node::previousElementSibling() const
{
    return ElementTraversal::previousSibling(*this);
}

Element* Node::nextElementSibling() const
{
    return ElementTraversal::nextSibling(*this);
}

ExceptionOr<void> Node::insertBefore(Node& newChild, RefPtr<Node>&& refChild)
{
    if (auto* containerNode = dynamicDowncast<ContainerNode>(*this))
        return containerNode->insertBefore(newChild, WTF::move(refChild));
    return Exception { ExceptionCode::HierarchyRequestError };
}

ExceptionOr<void> Node::replaceChild(Node& newChild, Node& oldChild)
{
    if (auto* containerNode = dynamicDowncast<ContainerNode>(*this))
        return containerNode->replaceChild(newChild, oldChild);
    return Exception { ExceptionCode::HierarchyRequestError };
}

ExceptionOr<void> Node::removeChild(Node& oldChild)
{
    if (auto* containerNode = dynamicDowncast<ContainerNode>(*this))
        return containerNode->removeChild(oldChild);
    return Exception { ExceptionCode::NotFoundError };
}

ExceptionOr<void> Node::appendChild(Node& newChild)
{
    if (auto* containerNode = dynamicDowncast<ContainerNode>(*this))
        return containerNode->appendChild(newChild);
    return Exception { ExceptionCode::HierarchyRequestError };
}

static HashSet<Ref<Node>> nodeSetPreTransformedFromNodeOrStringVector(const FixedVector<NodeOrString>& vector)
{
    HashSet<Ref<Node>> nodeSet;
    for (const auto& variant : vector) {
        WTF::switchOn(variant,
            [&](const Ref<Node>& node) { nodeSet.add(const_cast<Ref<Node>&>(node)); },
            [](const String&) { }
        );
    }
    return nodeSet;
}

static RefPtr<Node> LEGACY_NODELETE firstPrecedingSiblingNotInNodeSet(Node& context, const HashSet<Ref<Node>>& nodeSet)
{
    for (auto* sibling = context.previousSibling(); sibling; sibling = sibling->previousSibling()) {
        if (!nodeSet.contains(*sibling))
            return sibling;
    }
    return nullptr;
}

static RefPtr<Node> LEGACY_NODELETE firstFollowingSiblingNotInNodeSet(Node& context, const HashSet<Ref<Node>>& nodeSet)
{
    for (auto* sibling = context.nextSibling(); sibling; sibling = sibling->nextSibling()) {
        if (!nodeSet.contains(*sibling))
            return sibling;
    }
    return nullptr;
}

// https://dom.spec.whatwg.org/#converting-nodes-into-a-node
ExceptionOr<RefPtr<Node>> Node::convertNodesOrStringsIntoNode(FixedVector<NodeOrString>&& nodeOrStringVector)
{
    if (nodeOrStringVector.isEmpty())
        return nullptr;

    Ref document = this->document();
    auto nodes = WTF::map(WTF::move(nodeOrStringVector), [&](auto&& variant) -> Ref<Node> {
        return WTF::switchOn(WTF::move(variant),
            [&](Ref<Node>&& node) { return node; },
            [&](String&& string) -> Ref<Node> { return Text::create(document, WTF::move(string)); }
        );
    });

    if (nodes.size() == 1)
        return RefPtr<Node> { WTF::move(nodes.first()) };

    auto nodeToReturn = DocumentFragment::create(document);
    for (auto& node : nodes) {
        auto appendResult = nodeToReturn->appendChild(node);
        if (appendResult.hasException())
            return appendResult.releaseException();
    }
    return RefPtr<Node> { WTF::move(nodeToReturn) };
}

// https://dom.spec.whatwg.org/#converting-nodes-into-a-node except this returns a NodeVector
ExceptionOr<NodeVector> Node::convertNodesOrStringsIntoNodeVector(FixedVector<NodeOrString>&& nodeOrStringVector)
{
    if (nodeOrStringVector.isEmpty())
        return NodeVector { };

    Ref document = this->document();
    NodeVector nodeVector;
    nodeVector.reserveInitialCapacity(nodeOrStringVector.size());
    for (auto& variant : nodeOrStringVector) {
        if (std::holds_alternative<String>(variant)) {
            nodeVector.append(Text::create(document, WTF::move(std::get<String>(variant))));
            continue;
        }

        ASSERT(std::holds_alternative<Ref<Node>>(variant));
        RefPtr node = WTF::move(std::get<Ref<Node>>(variant));
        ASSERT(node);
        if (RefPtr fragment = dynamicDowncast<DocumentFragment>(node.get()); fragment) [[unlikely]] {
            for (RefPtr child = fragment->firstChild(); child; child = child->nextSibling())
                nodeVector.append(*child);
        } else
            nodeVector.append(node.releaseNonNull());
    }

    if (nodeVector.size() == 1)
        return nodeVector; // step 3, if nodes contains one node, then set node to nodes[0].

    // If the same node appears multiple times, keep only the last occurrence
    // to match the spec behavior (as if a temporary DocumentFragment was used).
    // https://dom.spec.whatwg.org/#converting-nodes-into-a-node
    {
        HashSet<Ref<Node>> seen;
        for (size_t i = nodeVector.size(); i > 0; --i) {
            if (!seen.add(nodeVector[i - 1]).isNewEntry)
                nodeVector.removeAt(i - 1);
        }
    }

    for (auto& node : nodeVector) {
        auto result = node->remove();
        if (result.hasException())
            return result.releaseException();
    }

    return nodeVector;
}

ExceptionOr<void> Node::before(FixedVector<NodeOrString>&& nodeOrStringVector)
{
    RefPtr parent = parentNode();
    if (!parent)
        return { };

    auto nodeSet = nodeSetPreTransformedFromNodeOrStringVector(nodeOrStringVector);
    RefPtr viablePreviousSibling = firstPrecedingSiblingNotInNodeSet(*this, nodeSet);

    auto result = convertNodesOrStringsIntoNodeVector(WTF::move(nodeOrStringVector));
    if (result.hasException())
        return result.releaseException();

    auto newChildren = result.releaseReturnValue();
    if (auto checkResult = parent->ensurePreInsertionValidityForPhantomDocumentFragment(newChildren); checkResult.hasException())
        return checkResult;

    RefPtr viableNextSibling = viablePreviousSibling ? viablePreviousSibling->nextSibling() : parent->firstChild();
    return parent->insertChildrenBeforeWithoutPreInsertionValidityCheck(WTF::move(newChildren), viableNextSibling.get());
}

ExceptionOr<void> Node::after(FixedVector<NodeOrString>&& nodeOrStringVector)
{
    RefPtr parent = parentNode();
    if (!parent)
        return { };

    auto nodeSet = nodeSetPreTransformedFromNodeOrStringVector(nodeOrStringVector);
    RefPtr viableNextSibling = firstFollowingSiblingNotInNodeSet(*this, nodeSet);

    auto result = convertNodesOrStringsIntoNodeVector(WTF::move(nodeOrStringVector));
    if (result.hasException())
        return result.releaseException();

    auto newChildren = result.releaseReturnValue();
    if (auto checkResult = parent->ensurePreInsertionValidityForPhantomDocumentFragment(newChildren); checkResult.hasException())
        return checkResult;

    return parent->insertChildrenBeforeWithoutPreInsertionValidityCheck(WTF::move(newChildren), viableNextSibling.get());
}

ExceptionOr<void> Node::replaceWith(FixedVector<NodeOrString>&& nodeOrStringVector)
{
    RefPtr parent = parentNode();
    if (!parent)
        return { };

    auto nodeSet = nodeSetPreTransformedFromNodeOrStringVector(nodeOrStringVector);
    RefPtr viableNextSibling = firstFollowingSiblingNotInNodeSet(*this, nodeSet);

    auto result = convertNodesOrStringsIntoNode(WTF::move(nodeOrStringVector));
    if (result.hasException())
        return result.releaseException();

    if (parentNode() == parent) {
        if (RefPtr node = result.releaseReturnValue())
            return parent->replaceChild(*node, *this);
        return parent->removeChild(*this);
    }

    if (RefPtr node = result.releaseReturnValue())
        return parent->insertBefore(*node, WTF::move(viableNextSibling));
    return { };
}

ExceptionOr<void> Node::remove()
{
    RefPtr parent = parentNode();
    if (!parent)
        return { };
    return parent->removeChild(*this);
}

ExceptionOr<void> Node::normalize()
{
    // Go through the subtree beneath us, normalizing all nodes. This means that
    // any two adjacent text nodes are merged and any empty text nodes are removed.

    Ref document = this->document();
    RefPtr node = this;
    while (RefPtr firstChild = node->firstChild())
        node = WTF::move(firstChild);
    while (node) {
        if (RefPtr element = dynamicDowncast<Element>(*node))
            element->normalizeAttributes();

        if (node == this)
            break;

        if (node->nodeType() != NodeType::Text) {
            node = NodeTraversal::nextPostOrder(*node);
            continue;
        }

        Ref text = uncheckedDowncast<Text>(*node);

        // Remove empty text nodes.
        if (!text->length()) {
            // Care must be taken to get the next node before removing the current node.
            node = NodeTraversal::nextPostOrder(*node);
            text->remove();
            continue;
        }

        // Merge text nodes.
        while (RefPtr nextSibling = node->nextSibling()) {
            if (nextSibling->nodeType() != NodeType::Text)
                break;
            Ref nextText = uncheckedDowncast<Text>(nextSibling.releaseNonNull());

            // Remove empty text nodes.
            if (!nextText->length()) {
                nextText->remove();
                continue;
            }

            // Both non-empty text nodes. Merge them.
            unsigned offset = text->length();

            if (nextText->length() > StringImpl::MaxLength - offset) {
                return Exception { ExceptionCode::InvalidModificationError,
                    "Normalized Node String representation exceeds implementation maximum length."_s };
            }

            // Update start/end for any affected Ranges before appendData since modifying contents might trigger mutation events that modify ordering.
            document->textNodesMerged(nextText, offset);

            // FIXME: DOM spec requires contents to be replaced all at once (see https://dom.spec.whatwg.org/#dom-node-normalize).
            // Appending once per sibling may trigger mutation events too many times.
            text->appendData(nextText->data());            
            nextText->remove();
        }

        node = NodeTraversal::nextPostOrder(*node);
    }

    return { };
}

Ref<Node> Node::cloneNode(CloneSubtree subtree) const
{
    ASSERT(!isShadowRoot());
    RefPtr registry = CustomElementRegistry::registryForNodeOrTreeScope(*this, protect(treeScope()));
    return cloneNodeInternal(protect(document()), subtree == CloneSubtree::Yes ? CloningOperation::Everything : CloningOperation::SelfOnly, registry.get());
}

ExceptionOr<Ref<Node>> Node::cloneNodeForBindings(bool subtree) const
{
    if (isShadowRoot()) [[unlikely]]
        return Exception { ExceptionCode::NotSupportedError };
    return cloneNode(subtree ? CloneSubtree::Yes : CloneSubtree::No);
}

const AtomString& Node::prefix() const
{
    // For nodes other than elements and attributes, the prefix is always null
    return nullAtom();
}

const AtomString& Node::localName() const
{
    return nullAtom();
}

const AtomString& Node::namespaceURI() const
{
    return nullAtom();
}

bool Node::isContentEditable() const
{
    return computeEditability() != Editability::ReadOnly;
}

Node::Editability Node::computeEditability() const
{
    return HTMLElement::editabilityFromContentEditableAttr(*this);
}

void Node::refEventTarget()
{
    ref();
}

void Node::derefEventTarget()
{
    deref();
}

unsigned Node::computeNodeIndex() const
{
    unsigned count = 0;
    for (Node* sibling = previousSibling(); sibling; sibling = sibling->previousSibling())
        ++count;
    return count;
}

template<unsigned type>
bool LEGACY_NODELETE shouldInvalidateNodeListCachesForAttr(std::span<const unsigned, numNodeListInvalidationTypes> nodeListCounts, const QualifiedName& attrName)
{
    if constexpr (type >= numNodeListInvalidationTypes)
        return false;
    else {
        if (nodeListCounts[type] && shouldInvalidateTypeOnAttributeChange(static_cast<NodeListInvalidationType>(type), attrName))
            return true;
        return shouldInvalidateNodeListCachesForAttr<type + 1>(nodeListCounts, attrName);
    }
}

inline bool Document::shouldInvalidateNodeListAndCollectionCaches() const
{
    for (int type = 0; type < numNodeListInvalidationTypes; ++type) {
        if (m_nodeListAndCollectionCounts[type])
            return true;
    }
    return false;
}

inline bool Document::shouldInvalidateNodeListAndCollectionCachesForAttribute(const QualifiedName& attrName) const
{
    return shouldInvalidateNodeListCachesForAttr<std::to_underlying(NodeListInvalidationType::DoNotInvalidateOnAttributeChanges) + 1>(m_nodeListAndCollectionCounts, attrName);
}

template <typename InvalidationFunction>
void Document::invalidateNodeListAndCollectionCaches(InvalidationFunction invalidate)
{
    for (RefPtr list : copyToVectorSpecialization<Vector<LiveNodeList*, 8>>(m_listsInvalidatedAtDocument))
        invalidate(*list);

    for (RefPtr collection : copyToVectorSpecialization<Vector<HTMLCollection*, 8>>(m_collectionsInvalidatedAtDocument))
        invalidate(*collection);
}

void Node::invalidateNodeListAndCollectionCachesInAncestors()
{
    if (hasRareData()) {
        if (auto* lists = rareData()->nodeLists())
            lists->clearChildNodeListCache();
    }

    SUPPRESS_UNCOUNTED_ARG document().invalidateQuerySelectorResults(*this);

    if (!document().shouldInvalidateNodeListAndCollectionCaches())
        return;

    protect(document())->invalidateNodeListAndCollectionCaches([](auto& list) {
        list.invalidateCache();
    });

    for (CheckedPtr node = this; node; node = node->parentNode()) {
        if (!node->hasRareData())
            continue;

        if (auto* lists = node->rareData()->nodeLists())
            lists->invalidateCaches();
    }
}

void Node::invalidateNodeListCollectionAndInnerHTMLPrefixCachesInAncestorsForAttribute(const QualifiedName& attrName, const IsMutationBySetInnerHTML isMutationBySetInnerHTML)
{
    ASSERT(is<Element>(*this));

    bool shouldInvalidate = document().shouldInvalidateNodeListAndCollectionCachesForAttribute(attrName);

    WeakPtr cachedContainer = document().cachedSetInnerHTML().cachedContainer;
    bool shouldSetMutationBit = isMutationBySetInnerHTML == IsMutationBySetInnerHTML::No && cachedContainer;

    if (!shouldInvalidate && !shouldSetMutationBit)
        return;

    if (shouldInvalidate) {
        protect(document())->invalidateNodeListAndCollectionCaches([&attrName](auto& list) {
            list.invalidateCacheForAttribute(attrName);
        });
    }

    for (CheckedPtr node = this; node; node = node->parentNode()) {
        if (shouldSetMutationBit && !node->hasDidMutateSubtreeAfterSetInnerHTML()) {
            node->setDidMutateSubtreeAfterSetInnerHTML();
            if (node == cachedContainer.get())
                shouldSetMutationBit = false;
        }

        if (!shouldInvalidate || !node->hasRareData())
            continue;

        if (auto* lists = node->rareData()->nodeLists())
            lists->invalidateCachesForAttribute(attrName);
    }
}

void Node::setDidMutateSubtreeAfterSetInnerHTMLOnAncestors()
{
    WeakPtr cachedContainer = document().cachedSetInnerHTML().cachedContainer;
    if (!cachedContainer)
        return;

    for (auto* node = this; node; node = node->parentNode()) {
        node->setDidMutateSubtreeAfterSetInnerHTML();
        if (node == cachedContainer.get())
            break;
    }
}

NodeListsNodeData* Node::nodeLists()
{
    return hasRareData() ? rareData()->nodeLists() : nullptr;
}

void Node::clearNodeLists()
{
    rareData()->clearNodeLists();
}

// https://dom.spec.whatwg.org/#concept-tree-descendant
bool Node::isDescendantOf(const Node& other) const
{
    // Return true if other is an ancestor of this.
    if (other.isTreeScope())
        return &treeScope().rootNode() == &other && !isTreeScope() && isInTreeScope();
    if (!other.hasChildNodes() || isConnected() != other.isConnected() || &shadowIncludingRoot() != &other.shadowIncludingRoot())
        return false;
    for (auto ancestor = parentNode(); ancestor; ancestor = ancestor->parentNode()) {
        if (ancestor == &other)
            return true;
    }
    return false;
}

// https://dom.spec.whatwg.org/#concept-shadow-including-inclusive-ancestor
bool Node::isShadowIncludingDescendantOf(const Node& other) const
{
    if (&shadowIncludingRoot() != &other.shadowIncludingRoot())
        return false;

    if (isDescendantOf(other))
        return true;

    for (auto host = shadowHost(); host; host = host->shadowHost()) {
        if (other.contains(*host))
            return true;
    }

    return false;
}

bool Node::isComposedTreeDescendantOf(const Node& node) const
{
    if (&shadowIncludingRoot() != &node.shadowIncludingRoot())
        return false;
    for (auto* currentAncestor = parentElementInComposedTree(); currentAncestor; currentAncestor = currentAncestor->parentElementInComposedTree()) {
        if (currentAncestor == &node)
            return true;
    }
    return false;
}

Element* Node::shadowHost() const
{
    if (ShadowRoot* root = containingShadowRoot())
        return root->host();
    return nullptr;
}

ShadowRoot* Node::containingShadowRoot() const
{
    return dynamicDowncast<ShadowRoot>(treeScope().rootNode());
}

#if ASSERT_ENABLED
// https://dom.spec.whatwg.org/#concept-closed-shadow-hidden
static bool isClosedShadowHiddenUsingSpecDefinition(const Node& A, const Node& B)
{
    return A.isInShadowTree()
        && !A.rootNode().isShadowIncludingInclusiveAncestorOf(&B)
        && (A.containingShadowRoot()->mode() != ShadowRootMode::Open || isClosedShadowHiddenUsingSpecDefinition(*A.shadowHost(), B));
}
#endif

// http://w3c.github.io/webcomponents/spec/shadow/#dfn-unclosed-node
bool Node::isClosedShadowHidden(const Node& otherNode) const
{
    // Use Vector instead of HashSet since we expect the number of ancestor tree scopes to be small.
    Vector<TreeScope*, 8> ancestorScopesOfThisNode;

    for (RefPtr scope = &treeScope(); scope; scope = scope->parentTreeScope())
        ancestorScopesOfThisNode.append(scope);

    for (auto* treeScopeThatCanAccessOtherNode = &otherNode.treeScope(); treeScopeThatCanAccessOtherNode; treeScopeThatCanAccessOtherNode = treeScopeThatCanAccessOtherNode->parentTreeScope()) {
        for (auto* scope : ancestorScopesOfThisNode) {
            if (scope == treeScopeThatCanAccessOtherNode) {
                ASSERT(!isClosedShadowHiddenUsingSpecDefinition(otherNode, *this));
                return false; // treeScopeThatCanAccessOtherNode is a shadow-including inclusive ancestor of this node.
            }
        }
        auto* shadowRoot = dynamicDowncast<ShadowRoot>(treeScopeThatCanAccessOtherNode->rootNode());
        if (shadowRoot && shadowRoot->mode() != ShadowRootMode::Open)
            break;
    }

    ASSERT(isClosedShadowHiddenUsingSpecDefinition(otherNode, *this));
    return true;
}

static inline ShadowRoot* LEGACY_NODELETE parentShadowRoot(const Node& node)
{
    if (auto* parent = node.parentElement())
        return parent->shadowRoot();
    return nullptr;
}

HTMLSlotElement* LEGACY_NODELETE Node::assignedSlot() const
{
    if (auto* shadowRoot = parentShadowRoot(*this))
        return shadowRoot->findAssignedSlot(*this);
    return nullptr;
}

HTMLSlotElement* LEGACY_NODELETE Node::assignedSlotForBindings() const
{
    auto* shadowRoot = parentShadowRoot(*this);
    if (shadowRoot && shadowRoot->mode() == ShadowRootMode::Open)
        return shadowRoot->findAssignedSlot(*this);
    return nullptr;
}

HTMLSlotElement* Node::manuallyAssignedSlot() const
{
    if (!hasRareData())
        return nullptr;
    return rareData()->manuallyAssignedSlot();
}

void Node::setManuallyAssignedSlot(HTMLSlotElement* slotElement)
{
    ensureRareData().setManuallyAssignedSlot(slotElement);
}

ContainerNode* Node::parentInComposedTree() const
{
    if (auto* slot = assignedSlot())
        return slot;
    if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(*this))
        return shadowRoot->host();
    return parentNode();
}

Element* Node::parentElementInComposedTree() const
{
    if (auto* slot = assignedSlot())
        return slot;
    if (auto* parent = parentNode()) {
        if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(*parent))
            return shadowRoot->host();
        if (auto* element = dynamicDowncast<Element>(*parent))
            return element;
    }
    return nullptr;
}

#if ASSERT_ENABLED
bool Node::checkIsInUserAgentShadowTree(bool isInUserAgentShadowTree) const
{
    auto* shadowRoot = containingShadowRoot();
    auto actualValue = shadowRoot && shadowRoot->mode() == ShadowRootMode::UserAgent;
    ASSERT(actualValue == isInUserAgentShadowTree);
    return isInUserAgentShadowTree;
}
#endif

Node* Node::nonBoundaryShadowTreeRootNode()
{
    ASSERT(!isShadowRoot());
    Node* root = this;
    while (root) {
        if (root->isShadowRoot())
            return root;
        Node* parent = root->parentNodeGuaranteedHostFree();
        if (parent && parent->isShadowRoot())
            return root;
        root = parent;
    }
    return 0;
}

ContainerNode* Node::nonShadowBoundaryParentNode() const
{
    ContainerNode* parent = parentNode();
    return parent && !parent->isShadowRoot() ? parent : nullptr;
}

Element* Node::parentOrShadowHostElement() const
{
    auto* parent = parentOrShadowHostNode();
    if (!parent)
        return nullptr;

    if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(*parent))
        return shadowRoot->host();

    return dynamicDowncast<Element>(*parent);
}

Node& Node::traverseToRootNode() const
{
    return traverseToRootNodeInternal(*this);
}

Node& Node::getRootNode(const GetRootNodeOptions& options) const
{
    return options.composed ? shadowIncludingRoot() : rootNode();
}

void Node::queueTaskToDispatchEvent(TaskSource source, Ref<Event>&& event)
{
    queueTaskKeepingNodeAlive(*this, source, [event = WTF::move(event)](Node& node) {
        node.dispatchEvent(event);
    });
}

#if ASSERT_ENABLED
static Node* traverseToShadowIncludingRoot(Node* current)
{
    while (auto* parent = current->parentOrShadowHostNode())
        current = parent;
    return current;
}
#endif

ALWAYS_INLINE void Node::updateShadowIncludingRoot()
{
    if (auto* parent = parentNode())
        m_shadowIncludingRoot = parent->m_shadowIncludingRoot;
    else if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(this)) [[unlikely]] {
        auto* host = shadowRoot->host();
        auto* root = host ? host->m_shadowIncludingRoot : shadowRoot;
        shadowRoot->setShadowIncludingRoot(root);
        m_shadowIncludingRoot = root;
    } else
        m_shadowIncludingRoot = this;
    ASSERT(traverseToShadowIncludingRoot(this) == m_shadowIncludingRoot);
}

Node::NeedsPostConnectionSteps Node::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    if (insertionType.connectedToDocument)
        setEventTargetFlag(EventTargetFlag::IsConnected);
    if (parentOfInsertedTree.isInShadowTree())
        setEventTargetFlag(EventTargetFlag::IsInShadowTree);

    updateShadowIncludingRoot();

    return NeedsPostConnectionSteps::No;
}

void Node::removingSteps(RemovalType removalType, ContainerNode&)
{
    if (removalType.disconnectedFromDocument)
        clearEventTargetFlag(EventTargetFlag::IsConnected);
    if (isInShadowTree() && !treeScope().rootNode().isShadowRoot())
        clearEventTargetFlag(EventTargetFlag::IsInShadowTree);

    updateShadowIncludingRoot();
}

void Node::movingSteps(MovingType, ContainerNode&)
{
    setEventTargetFlag(EventTargetFlag::IsInShadowTree, treeScope().rootNode().isShadowRoot());
}

void Node::updateShadowIncludingRootForSubtree()
{
    SUPPRESS_UNCOUNTED_LOCAL for (auto* current = this; current; current = NodeTraversal::next(*current, this)) {
        current->updateShadowIncludingRoot();
        SUPPRESS_UNCOUNTED_LOCAL if (auto* shadowRoot = current->shadowRoot())
            shadowRoot->updateShadowIncludingRootForSubtree();
    }
}

const URL& Node::baseURI() const
{
    auto& url = document().baseURL();
    return url.isNull() ? aboutBlankURL() : url;
}

bool Node::isEqualNode(Node* other) const
{
    if (!other)
        return false;
    
    NodeType nodeType = this->nodeType();
    if (nodeType != other->nodeType())
        return false;
    
    switch (nodeType) {
    case NodeType::DocumentType: {
        auto& thisDocType = uncheckedDowncast<DocumentType>(*this);
        auto& otherDocType = uncheckedDowncast<DocumentType>(*other);
        if (thisDocType.name() != otherDocType.name())
            return false;
        if (thisDocType.publicId() != otherDocType.publicId())
            return false;
        if (thisDocType.systemId() != otherDocType.systemId())
            return false;
        break;
        }
    case NodeType::Element: {
        auto& thisElement = uncheckedDowncast<Element>(*this);
        auto& otherElement = uncheckedDowncast<Element>(*other);
        if (thisElement.tagQName() != otherElement.tagQName())
            return false;
        if (!thisElement.hasEquivalentAttributes(otherElement))
            return false;
        break;
        }
    case NodeType::ProcessingInstruction: {
        auto& thisProcessingInstruction = uncheckedDowncast<ProcessingInstruction>(*this);
        auto& otherProcessingInstruction = uncheckedDowncast<ProcessingInstruction>(*other);
        if (thisProcessingInstruction.target() != otherProcessingInstruction.target())
            return false;
        if (thisProcessingInstruction.data() != otherProcessingInstruction.data())
            return false;
        break;
        }
    case NodeType::CDATASection:
    case NodeType::Text:
    case NodeType::Comment: {
        auto& thisCharacterData = uncheckedDowncast<CharacterData>(*this);
        auto& otherCharacterData = uncheckedDowncast<CharacterData>(*other);
        if (thisCharacterData.data() != otherCharacterData.data())
            return false;
        break;
        }
    case NodeType::Attribute: {
        auto& thisAttribute = uncheckedDowncast<Attr>(*this);
        auto& otherAttribute = uncheckedDowncast<Attr>(*other);
        if (thisAttribute.qualifiedName() != otherAttribute.qualifiedName())
            return false;
        if (thisAttribute.value() != otherAttribute.value())
            return false;
        break;
        }
    case NodeType::Document:
    case NodeType::DocumentFragment:
        break;
    }

    SUPPRESS_UNCHECKED_LOCAL Node* child = firstChild();
    SUPPRESS_UNCHECKED_LOCAL Node* otherChild = other->firstChild();
    
    while (child) {
        if (!child->isEqualNode(otherChild))
            return false;
        
        child = child->nextSibling();
        otherChild = otherChild->nextSibling();
    }
    
    if (otherChild)
        return false;
    
    return true;
}

// https://dom.spec.whatwg.org/#locate-a-namespace
static const AtomString& locateDefaultNamespace(const Node& node, const AtomString& prefix)
{
    switch (node.nodeType()) {
    case NodeType::Element: {
        if (prefix == xmlAtom())
            return XMLNames::xmlNamespaceURI.get();
        if (prefix == xmlnsAtom())
            return XMLNSNames::xmlnsNamespaceURI.get();

        auto& element = uncheckedDowncast<Element>(node);
        auto& namespaceURI = element.namespaceURI();
        if (!namespaceURI.isNull() && element.prefix() == prefix)
            return namespaceURI;

        if (element.hasAttributes()) {
            for (auto& attribute : element.attributes()) {
                if (attribute.namespaceURI() != XMLNSNames::xmlnsNamespaceURI)
                    continue;

                if ((prefix.isNull() && attribute.prefix().isNull() && attribute.localName() == xmlnsAtom()) || (attribute.prefix() == xmlnsAtom() && attribute.localName() == prefix)) {
                    auto& result = attribute.value();
                    return result.isEmpty() ? nullAtom() : result;
                }
            }
        }
        SUPPRESS_UNCHECKED_LOCAL auto* parent = node.parentElement();
        return parent ? locateDefaultNamespace(*parent, prefix) : nullAtom();
    }
    case NodeType::Document:
        if (RefPtr documentElement = uncheckedDowncast<Document>(node).documentElement())
            return locateDefaultNamespace(*documentElement, prefix);
        return nullAtom();
    case NodeType::DocumentType:
    case NodeType::DocumentFragment:
        return nullAtom();
    case NodeType::Attribute:
        if (RefPtr ownerElement = uncheckedDowncast<Attr>(node).ownerElement())
            return locateDefaultNamespace(*ownerElement, prefix);
        return nullAtom();
    default:
        if (RefPtr parent = node.parentElement())
            return locateDefaultNamespace(*parent, prefix);
        return nullAtom();
    }
}

// https://dom.spec.whatwg.org/#dom-node-isdefaultnamespace
bool Node::isDefaultNamespace(const AtomString& potentiallyEmptyNamespace) const
{
    const AtomString& namespaceURI = potentiallyEmptyNamespace.isEmpty() ? nullAtom() : potentiallyEmptyNamespace;
    return locateDefaultNamespace(*this, nullAtom()) == namespaceURI;
}

// https://dom.spec.whatwg.org/#dom-node-lookupnamespaceuri
const AtomString& Node::lookupNamespaceURI(const AtomString& potentiallyEmptyPrefix) const
{
    const AtomString& prefix = potentiallyEmptyPrefix.isEmpty() ? nullAtom() : potentiallyEmptyPrefix;
    return locateDefaultNamespace(*this, prefix);
}

// https://dom.spec.whatwg.org/#locate-a-namespace-prefix
static const AtomString& locateNamespacePrefix(const Element& element, const AtomString& namespaceURI)
{
    if (element.namespaceURI() == namespaceURI)
        return element.prefix();

    if (element.hasAttributes()) {
        for (auto& attribute : element.attributes()) {
            if (attribute.prefix() == xmlnsAtom() && attribute.value() == namespaceURI)
                return attribute.localName();
        }
    }
    SUPPRESS_UNCHECKED_LOCAL auto* parent = element.parentElement();
    return parent ? locateNamespacePrefix(*parent, namespaceURI) : nullAtom();
}

// https://dom.spec.whatwg.org/#dom-node-lookupprefix
const AtomString& Node::lookupPrefix(const AtomString& namespaceURI) const
{
    if (namespaceURI.isEmpty())
        return nullAtom();
    
    switch (nodeType()) {
    case NodeType::Element:
        return locateNamespacePrefix(uncheckedDowncast<Element>(*this), namespaceURI);
    case NodeType::Document:
        if (RefPtr documentElement = uncheckedDowncast<Document>(*this).documentElement())
            return locateNamespacePrefix(*documentElement, namespaceURI);
        return nullAtom();
    case NodeType::DocumentFragment:
    case NodeType::DocumentType:
        return nullAtom();
    case NodeType::Attribute:
        if (RefPtr ownerElement = uncheckedDowncast<Attr>(*this).ownerElement())
            return locateNamespacePrefix(*ownerElement, namespaceURI);
        return nullAtom();
    default:
        if (RefPtr parent = parentElement())
            return locateNamespacePrefix(*parent, namespaceURI);
        return nullAtom();
    }
}

static void appendTextContent(const Node* node, bool convertBRsToNewlines, bool& isNullString, StringBuilder& content)
{
    switch (node->nodeType()) {
    case NodeType::Text:
    case NodeType::CDATASection:
    case NodeType::Comment:
        isNullString = false;
        content.append(uncheckedDowncast<CharacterData>(*node).data());
        break;

    case NodeType::ProcessingInstruction:
        isNullString = false;
        content.append(uncheckedDowncast<ProcessingInstruction>(*node).data());
        break;
    
    case NodeType::Attribute:
        isNullString = false;
        content.append(uncheckedDowncast<Attr>(*node).value());
        break;

    case NodeType::Element:
        if (node->hasTagName(brTag) && convertBRsToNewlines) {
            isNullString = false;
            content.append('\n');
            break;
        }
        [[fallthrough]];
    case NodeType::DocumentFragment:
        isNullString = false;
        for (RefPtr child = node->firstChild(); child; child = child->nextSibling()) {
            if (child->nodeType() == NodeType::Comment || child->nodeType() == NodeType::ProcessingInstruction)
                continue;
            appendTextContent(child.get(), convertBRsToNewlines, isNullString, content);
        }
        break;

    case NodeType::Document:
    case NodeType::DocumentType:
        break;
    }
}

String Node::textContent(bool convertBRsToNewlines) const
{
    StringBuilder content;
    bool isNullString = true;
    appendTextContent(this, convertBRsToNewlines, isNullString, content);
    return isNullString ? String() : content.toString();
}

ExceptionOr<void> Node::setTextContent(String&& text)
{
    switch (nodeType()) {
    case NodeType::Attribute:
    case NodeType::Text:
    case NodeType::CDATASection:
    case NodeType::Comment:
    case NodeType::ProcessingInstruction:
        return setNodeValue(WTF::move(text));
    case NodeType::Element:
    case NodeType::DocumentFragment:
        uncheckedDowncast<ContainerNode>(*this).stringReplaceAll(WTF::move(text));
        return { };
    case NodeType::Document:
    case NodeType::DocumentType:
        // Do nothing.
        return { };
    }
    ASSERT_NOT_REACHED();

    return { };
}

static SHA1::Digest hashPointer(const void* pointer)
{
    SHA1 sha1;
    sha1.addBytes(asByteSpan(pointer));
    SHA1::Digest digest;
    sha1.computeHash(digest);
    return digest;
}

static inline unsigned short compareDetachedElementsPosition(Node& firstNode, Node& secondNode)
{
    // If the 2 nodes are not in the same tree, return the result of adding DOCUMENT_POSITION_DISCONNECTED,
    // DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC, and either DOCUMENT_POSITION_PRECEDING or
    // DOCUMENT_POSITION_FOLLOWING, with the constraint that this is to be consistent. Whether to return
    // DOCUMENT_POSITION_PRECEDING or DOCUMENT_POSITION_FOLLOWING is implemented by comparing cryptographic
    // hashes of Node pointers.
    // See step 3 in https://dom.spec.whatwg.org/#dom-node-comparedocumentposition
    SHA1::Digest firstHash = hashPointer(&firstNode);
    SHA1::Digest secondHash = hashPointer(&secondNode);

    unsigned short direction = is_gt(compareSpans(std::span { firstHash }, std::span { secondHash })) ? Node::DOCUMENT_POSITION_PRECEDING : Node::DOCUMENT_POSITION_FOLLOWING;

    return Node::DOCUMENT_POSITION_DISCONNECTED | Node::DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | direction;
}

bool connectedInSameTreeScope(const Node* a, const Node* b)
{
    // Note that we avoid comparing Attr nodes here, since they return false from isConnected() all the time (which seems like a bug).
    return a && b && a->isConnected() && b->isConnected() && &a->treeScope() == &b->treeScope();
}

unsigned short Node::compareDocumentPosition(Node& otherNode)
{
    if (&otherNode == this)
        return DOCUMENT_POSITION_EQUIVALENT;

    auto* attr1 = dynamicDowncast<Attr>(*this);
    auto* attr2 = dynamicDowncast<Attr>(otherNode);

    RefPtr start1 = attr1 ? attr1->ownerElement() : this;
    RefPtr start2 = attr2 ? attr2->ownerElement() : &otherNode;

    if (!start1 || !start2)
        return compareDetachedElementsPosition(*this, otherNode);

    if (attr1 && attr2 && start1 == start2) {
        Ref element = downcast<Element>(*start1);
        element->synchronizeAllAttributes();
        for (auto& attribute : element->attributes()) {
            if (attr1->qualifiedName() == attribute.name())
                return DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | DOCUMENT_POSITION_FOLLOWING;
            if (attr2->qualifiedName() == attribute.name())
                return DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | DOCUMENT_POSITION_PRECEDING;
        }
        ASSERT_NOT_REACHED();
        return DOCUMENT_POSITION_DISCONNECTED;
    }

    auto order = treeOrder<Tree>(*start1, *start2);

    if (order == std::partial_ordering::unordered)
        return compareDetachedElementsPosition(*this, otherNode);

    if (order == std::partial_ordering::equivalent) {
        if (attr1)
            return DOCUMENT_POSITION_PRECEDING | DOCUMENT_POSITION_CONTAINS;
        if (attr2)
            return DOCUMENT_POSITION_FOLLOWING | DOCUMENT_POSITION_CONTAINED_BY;
        ASSERT_NOT_REACHED();
        return DOCUMENT_POSITION_EQUIVALENT;
    }

    if (order == std::partial_ordering::less) {
        if (!attr1 && start2->isDescendantOf(*this))
            return DOCUMENT_POSITION_FOLLOWING | DOCUMENT_POSITION_CONTAINED_BY;
        return DOCUMENT_POSITION_FOLLOWING;
    }

    ASSERT(order == std::partial_ordering::greater);
    if (!attr2 && start1->isDescendantOf(otherNode))
        return DOCUMENT_POSITION_PRECEDING | DOCUMENT_POSITION_CONTAINS;
    return DOCUMENT_POSITION_PRECEDING;
}

String Node::description() const
{
    auto name = nodeName();
    return makeString(name.isEmpty() ? "<none>"_s : ""_s, name);
}

String Node::debugDescription() const
{
    auto name = nodeName();
    return makeString(name.isEmpty() ? "<none>"_s : ""_s, name, " 0x"_s, hex(reinterpret_cast<uintptr_t>(this), Lowercase));
}

#if ENABLE(TREE_DEBUGGING)

static void appendAttributeDesc(const Node* node, StringBuilder& stringBuilder, const QualifiedName& name, ASCIILiteral attrDesc)
{
    auto* element = dynamicDowncast<Element>(*node);
    if (!element)
        return;

    const AtomString& attr = element->getAttribute(name);
    if (attr.isEmpty())
        return;

    stringBuilder.append(attrDesc);
    stringBuilder.append(attr);
}

void Node::showNode(ASCIILiteral prefix) const
{
    if (prefix.isNull())
        prefix = ""_s;
    if (isTextNode()) {
        String value = makeStringByReplacingAll(nodeValue(), '\\', "\\\\"_s);
        value = makeStringByReplacingAll(value, '\n', "\\n"_s);
        SAFE_FPRINTF(stderr, "%s%s\t%p \"%s\"\n", prefix, nodeName().utf8(), this, value.utf8());
    } else {
        StringBuilder attrs;
        appendAttributeDesc(this, attrs, classAttr, " CLASS="_s);
        appendAttributeDesc(this, attrs, styleAttr, " STYLE="_s);
        SAFE_FPRINTF(stderr, "%s%s\t%p %s\n", prefix, nodeName().utf8(), this, attrs.toString().utf8());
    }
}

void Node::showTreeForThis() const
{
    showTreeAndMark(this, "*"_s);
}

void Node::showNodePathForThis() const
{
    Vector<const Node*, 16> chain;
    const Node* node = this;
    while (node->parentOrShadowHostNode()) {
        chain.append(node);
        node = node->parentOrShadowHostNode();
    }
    for (unsigned index = chain.size(); index > 0; --index) {
        const Node* node = chain[index - 1];
        if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(*node)) {
            int count = 0;
            for (; shadowRoot && shadowRoot != node; shadowRoot = shadowRoot->shadowRoot())
                ++count;
            fprintf(stderr, "/#shadow-root[%d]", count);
            continue;
        }

        switch (node->nodeType()) {
        case NodeType::Element: {
            SAFE_FPRINTF(stderr, "/%s", node->nodeName().utf8());

            const Element& element = uncheckedDowncast<Element>(*node);
            const AtomString& idattr = element.getIdAttribute();
            bool hasIdAttr = !idattr.isNull() && !idattr.isEmpty();
            if (node->previousSibling() || node->nextSibling()) {
                int count = 0;
                for (Node* previous = node->previousSibling(); previous; previous = previous->previousSibling())
                    if (previous->nodeName() == node->nodeName())
                        ++count;
                if (hasIdAttr)
                    SAFE_FPRINTF(stderr, "[@id=\"%s\" and position()=%d]", idattr.string().utf8(), count);
                else
                    fprintf(stderr, "[%d]", count);
            } else if (hasIdAttr)
                SAFE_FPRINTF(stderr, "[@id=\"%s\"]", idattr.string().utf8());
            break;
        }
        case NodeType::Text:
            fprintf(stderr, "/text()");
            break;
        case NodeType::Attribute:
            SAFE_FPRINTF(stderr, "/@%s", node->nodeName().utf8());
            break;
        default:
            break;
        }
    }
    fprintf(stderr, "\n");
}

static void traverseTreeAndMark(const String& baseIndent, const Node* rootNode, const Node* markedNode1, ASCIILiteral markedLabel1, const Node* markedNode2, ASCIILiteral markedLabel2)
{
    for (const Node* node = rootNode; node; node = NodeTraversal::next(*node)) {
        if (node == markedNode1)
            SAFE_FPRINTF(stderr, "%s", markedLabel1);
        if (node == markedNode2)
            SAFE_FPRINTF(stderr, "%s", markedLabel2);

        StringBuilder indent;
        indent.append(baseIndent);
        for (const Node* tmpNode = node; tmpNode && tmpNode != rootNode; tmpNode = tmpNode->parentOrShadowHostNode())
            indent.append('\t');
        SAFE_FPRINTF(stderr, "%s", indent.toString().utf8());
        node->showNode();
        indent.append('\t');
        if (!node->isShadowRoot()) {
            if (RefPtr shadowRoot = node->shadowRoot())
                traverseTreeAndMark(indent.toString(), shadowRoot.get(), markedNode1, markedLabel1, markedNode2, markedLabel2);
        }
    }
}

void Node::showTreeAndMark(const Node* markedNode1, ASCIILiteral markedLabel1, const Node* markedNode2, ASCIILiteral markedLabel2) const
{
    const Node* node = this;
    while (node->parentOrShadowHostNode() && !node->hasTagName(bodyTag))
        node = node->parentOrShadowHostNode();
    RefPtr rootNode = node;

    String startingIndent;
    traverseTreeAndMark(startingIndent, rootNode.get(), markedNode1, markedLabel1, markedNode2, markedLabel2);
}

#endif // ENABLE(TREE_DEBUGGING)

// --------

void NodeListsNodeData::invalidateCaches()
{
    for (auto& atomName : m_atomNameCaches)
        protect(atomName.value)->invalidateCache();

    for (auto& collection : m_cachedCollections)
        protect(collection.value)->invalidateCache();

    for (auto& tagCollection : m_tagCollectionNSCache)
        protect(tagCollection.value)->invalidateCache();
}

void NodeListsNodeData::invalidateCachesForAttribute(const QualifiedName& attrName)
{
    for (auto& atomName : m_atomNameCaches)
        protect(atomName.value)->invalidateCacheForAttribute(attrName);

    for (auto& collection : m_cachedCollections)
        protect(collection.value)->invalidateCacheForAttribute(attrName);
}

enum EventTargetInterfaceType Node::eventTargetInterface() const
{
    return EventTargetInterfaceType::Node;
}

template <typename MoveNodeFunction, typename MoveShadowRootFunction>
static unsigned traverseSubtreeToUpdateTreeScope(Node& root, NOESCAPE const MoveNodeFunction& moveNode, NOESCAPE const MoveShadowRootFunction& moveShadowRoot)
{
    unsigned count = 0;
    for (CheckedPtr node = &root; node; node = NodeTraversal::next(*node, &root)) {
        moveNode(*node);
        ++count;

        RefPtr element = dynamicDowncast<Element>(*node);
        if (!element)
            continue;

        if (element->hasSyntheticAttrChildNodes()) {
            for (auto& attr : element->attrNodeList()) {
                moveNode(attr);
                ++count;
            }
        }

        if (RefPtr shadow = element->shadowRoot())
            count += moveShadowRoot(*shadow);
    }
    return count;
}

static ALWAYS_INLINE bool isDocumentEligibleForFastAdoption(Document& oldDocument, Document& newDocument)
{
    return !oldDocument.hasNodeIterators()
        && !oldDocument.hasRanges()
        && !oldDocument.hasNodeWithEventListeners()
        && !oldDocument.hasMutationObservers()
        && !oldDocument.shouldInvalidateNodeListAndCollectionCaches()
        && oldDocument.inQuirksMode() == newDocument.inQuirksMode();
}

static ALWAYS_INLINE void adoptCustomElementRegistryIfNotExplicitlySet(ShadowRoot& shadowRoot, Document& newDocument)
{
    if (shadowRoot.hasScopedCustomElementRegistry() || !shadowRoot.usesNullCustomElementRegistry() || newDocument.usesNullCustomElementRegistry()) [[likely]]
        return;
    shadowRoot.clearUsesNullCustomElementRegistry();
    shadowRoot.setCustomElementRegistry(newDocument.customElementRegistry());
}

inline unsigned Node::moveShadowTreeToNewDocumentFastCase(ShadowRoot& shadowRoot, Document& oldDocument, Document& newDocument)
{
    ASSERT(isDocumentEligibleForFastAdoption(oldDocument, newDocument));
    adoptCustomElementRegistryIfNotExplicitlySet(shadowRoot, newDocument);
    return traverseSubtreeToUpdateTreeScope(shadowRoot, [&](Node& node) {
        node.moveNodeToNewDocumentFastCase(oldDocument, newDocument);
    }, [&oldDocument, &newDocument](ShadowRoot& innerShadowRoot) {
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&innerShadowRoot.document() == &oldDocument);
        innerShadowRoot.moveShadowRootToNewDocument(oldDocument, newDocument);
        return moveShadowTreeToNewDocumentFastCase(innerShadowRoot, oldDocument, newDocument);
    });
}

inline void Node::moveShadowTreeToNewDocumentSlowCase(ShadowRoot& shadowRoot, Document& oldDocument, Document& newDocument)
{
    ASSERT(!isDocumentEligibleForFastAdoption(oldDocument, newDocument));
    adoptCustomElementRegistryIfNotExplicitlySet(shadowRoot, newDocument);
    traverseSubtreeToUpdateTreeScope(shadowRoot, [&](Node& node) {
        node.moveNodeToNewDocumentSlowCase(oldDocument, newDocument);
    }, [&oldDocument, &newDocument](ShadowRoot& innerShadowRoot) {
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&innerShadowRoot.document() == &oldDocument);
        innerShadowRoot.moveShadowRootToNewDocument(oldDocument, newDocument);
        moveShadowTreeToNewDocumentSlowCase(innerShadowRoot, oldDocument, newDocument);
        return 0; // Unused.
    });
}

void Node::moveTreeToNewScope(Node& root, TreeScope& oldScope, TreeScope& newScope)
{
    ASSERT(&oldScope != &newScope);

    Ref oldDocument = oldScope.documentScope();
    Ref newDocument = newScope.documentScope();
    bool newScopeIsUAShadowTree = newScope.rootNode().hasBeenInUserAgentShadowTree();
    if (&oldDocument.get() != &newDocument.get()) {
        oldDocument->incrementReferencingNodeCount();
        bool isFastCase = isDocumentEligibleForFastAdoption(oldDocument, newDocument) && !newScopeIsUAShadowTree;
        if (isFastCase) {
            unsigned nodeCount = traverseSubtreeToUpdateTreeScope(root, [&](Node& node) {
                ASSERT(!node.isTreeScope());
                RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&node.treeScope() == &oldScope);
                node.setTreeScope(newScope);
                node.moveNodeToNewDocumentFastCase(oldDocument, newDocument);
            }, [&](ShadowRoot& shadowRoot) {
                ASSERT_WITH_SECURITY_IMPLICATION(&shadowRoot.document() == oldDocument.ptr());
                shadowRoot.moveShadowRootToNewParentScope(newScope, newDocument);
                return moveShadowTreeToNewDocumentFastCase(shadowRoot, oldDocument, newDocument);
            });
            newDocument->incrementReferencingNodeCount(nodeCount);
            oldDocument->decrementReferencingNodeCount(nodeCount);
        } else {
            traverseSubtreeToUpdateTreeScope(root, [&](Node& node) {
                ASSERT(!node.isTreeScope());
                RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&node.treeScope() == &oldScope);
                if (newScopeIsUAShadowTree)
                    node.setEventTargetFlag(EventTargetFlag::HasBeenInUserAgentShadowTree);
                node.setTreeScope(newScope);
                node.moveNodeToNewDocumentSlowCase(oldDocument, newDocument);
            }, [&](ShadowRoot& shadowRoot) {
                ASSERT_WITH_SECURITY_IMPLICATION(&shadowRoot.document() == oldDocument.ptr());
                shadowRoot.moveShadowRootToNewParentScope(newScope, newDocument);
                moveShadowTreeToNewDocumentSlowCase(shadowRoot, oldDocument, newDocument);
                return 0; // Unused
            });
        }
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&oldScope.documentScope() == oldDocument.ptr() && &newScope.documentScope() == newDocument.ptr());
        oldDocument->decrementReferencingNodeCount();
    } else {
        traverseSubtreeToUpdateTreeScope(root, [&](Node& node) {
            ASSERT(!node.isTreeScope());
            RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&node.treeScope() == &oldScope);
            if (newScopeIsUAShadowTree)
                node.setEventTargetFlag(EventTargetFlag::HasBeenInUserAgentShadowTree);
            node.setTreeScope(newScope);
            if (!node.hasRareData()) [[likely]]
                return;
            if (auto* nodeLists = node.rareData()->nodeLists())
                nodeLists->adoptTreeScope();
        }, [&newScope](ShadowRoot& shadowRoot) {
            shadowRoot.setParentTreeScope(newScope);
            return 0; // Unused.
        });
    }
}

inline void Node::adoptCustomElementRegistryIntoScopedRegistryDocument()
{
    // Called during adoption only when the destination document's custom element registry is scoped.
    // An element that inherits the global custom element registry (neither uses the null registry
    // nor an explicit scoped registry) has no global registry to inherit in such a document, so it
    // ends up with a null custom element registry.
    if (is<Element>(*this) && !usesNullCustomElementRegistry() && !usesScopedCustomElementRegistryMap())
        setUsesNullCustomElementRegistry();
}

void Node::moveNodeToNewDocumentFastCase(Document& oldDocument, Document& newDocument)
{
    ASSERT(!oldDocument.shouldInvalidateNodeListAndCollectionCaches());
    ASSERT(!oldDocument.hasNodeIterators());
    ASSERT(!oldDocument.hasRanges());
    ASSERT(!oldDocument.hasNodeWithEventListeners());
    ASSERT(!hasEventListeners());
    ASSERT(!mutationObserverRegistry());
    ASSERT(!transientMutationObserverRegistry());

    if (usesNullCustomElementRegistry() && !newDocument.usesNullCustomElementRegistry()) [[unlikely]]
        clearUsesNullCustomElementRegistry();

    if (RefPtr newRegistry = newDocument.customElementRegistry(); newRegistry && newRegistry->isScoped()) [[unlikely]]
        adoptCustomElementRegistryIntoScopedRegistryDocument();

    if (!hasTypeFlag(TypeFlag::HasDidMoveToNewDocument) && !hasEventTargetFlag(EventTargetFlag::HasLangAttr) && !hasEventTargetFlag(EventTargetFlag::HasXMLLangAttr)
        && !isDefinedCustomElement() && !isCustomElementUpgradeCandidate())
        return;

    if (auto* element = dynamicDowncast<Element>(*this))
        element->didMoveToNewDocument(oldDocument, newDocument);
}

void Node::moveNodeToNewDocumentSlowCase(Document& oldDocument, Document& newDocument)
{
    newDocument.incrementReferencingNodeCount();
    oldDocument.decrementReferencingNodeCount();

    if (usesNullCustomElementRegistry() && !newDocument.usesNullCustomElementRegistry()) [[unlikely]]
        clearUsesNullCustomElementRegistry();

    if (RefPtr newRegistry = newDocument.customElementRegistry(); newRegistry && newRegistry->isScoped()) [[unlikely]]
        adoptCustomElementRegistryIntoScopedRegistryDocument();

    if (hasRareData()) {
        if (auto* nodeLists = rareData()->nodeLists())
            nodeLists->adoptDocument(oldDocument, newDocument);
        if (auto* registry = mutationObserverRegistry()) {
            for (auto& registration : *registry)
                newDocument.addMutationObserverTypes(registration->mutationTypes());
        }
        if (auto* transientRegistry = transientMutationObserverRegistry()) {
            for (auto& registration : *transientRegistry)
                newDocument.addMutationObserverTypes(registration.mutationTypes());
        }
    } else {
        ASSERT(!mutationObserverRegistry());
        ASSERT(!transientMutationObserverRegistry());
    }

    oldDocument.moveNodeIteratorsToNewDocument(*this, newDocument);

    if (!parentNode())
        oldDocument.parentlessNodeMovedToNewDocument(*this);

    if (hasEventTargetData()) {
        enumerateEventListenerTypes([&](auto& eventType, uint16_t capturingCount, uint16_t bubblingCount) {
            if (capturingCount) {
                oldDocument.didRemoveEventListenersOfType(eventType, Document::IsCapture::Yes, capturingCount);
                newDocument.didAddEventListenersOfType(eventType, Document::IsCapture::Yes, capturingCount);
            }
            if (bubblingCount) {
                oldDocument.didRemoveEventListenersOfType(eventType, Document::IsCapture::No, bubblingCount);
                newDocument.didAddEventListenersOfType(eventType, Document::IsCapture::No, bubblingCount);
            }
        });
    }

    if (auto* element = dynamicDowncast<Element>(*this))
        element->didMoveToNewDocument(oldDocument, newDocument);
}

static inline bool tryAddEventListener(Node* targetNode, const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
    if (!targetNode->EventTarget::addEventListener(eventType, listener.copyRef(), options))
        return false;

    Ref document = targetNode->document();
    document->didAddEventListenersOfType(eventType, options.capture ? Document::IsCapture::Yes : Document::IsCapture::No);

    return true;
}

bool Node::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
    return tryAddEventListener(this, eventType, WTF::move(listener), options);
}

static void didRemoveEventListenersOfType(Node& targetNode, const AtomString& eventType, uint16_t capturingCount, uint16_t bubblingCount)
{
    Ref document = targetNode.document();
    if (capturingCount)
        document->didRemoveEventListenersOfType(eventType, Document::IsCapture::Yes, capturingCount);
    if (bubblingCount)
        document->didRemoveEventListenersOfType(eventType, Document::IsCapture::No, bubblingCount);
}

bool Node::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    if (!EventTarget::removeEventListener(eventType, listener, options))
        return false;
    uint16_t capturingCount = options.capture ? 1 : 0;
    uint16_t bubblingCount = options.capture ? 0 : 1;
    didRemoveEventListenersOfType(*this, eventType, capturingCount, bubblingCount);
    return true;
}

void Node::removeAllEventListeners()
{
    enumerateEventListenerTypes([&](const AtomString& type, uint16_t capturingCount, uint16_t bubblingCount) {
        didRemoveEventListenersOfType(*this, type, capturingCount, bubblingCount);
    });
    EventTarget::removeAllEventListeners();
}

Vector<Ref<MutationObserverRegistration>>* Node::mutationObserverRegistry()
{
    if (!hasRareData())
        return nullptr;
    auto* data = rareData()->mutationObserverDataIfExists();
    if (!data)
        return nullptr;
    return &data->registry;
}

WeakHashSet<MutationObserverRegistration>* Node::transientMutationObserverRegistry()
{
    if (!hasRareData())
        return nullptr;
    auto* data = rareData()->mutationObserverDataIfExists();
    if (!data)
        return nullptr;
    return &data->transientRegistry;
}

HashMap<Ref<MutationObserver>, MutationRecordDeliveryOptions> Node::registeredMutationObservers(MutationObserverOptionType type, const QualifiedName* attributeName)
{
    HashMap<Ref<MutationObserver>, MutationRecordDeliveryOptions> observers;
    ASSERT((type == MutationObserverOptionType::Attributes && attributeName) || !attributeName);

    auto collectMatchingObserversForMutation = [&](MutationObserverRegistration& registration) {
        if (registration.shouldReceiveMutationFrom(*this, type, attributeName)) {
            auto deliveryOptions = registration.deliveryOptions();
            auto result = observers.add(registration.observer(), deliveryOptions);
            if (!result.isNewEntry)
                result.iterator->value.add(deliveryOptions);
        }
    };

    for (RefPtr node = this; node; node = node->parentNode()) {
        if (auto* registry = node->mutationObserverRegistry()) {
            for (Ref registration : *registry)
                collectMatchingObserversForMutation(registration);
        }
        if (auto* registry = node->transientMutationObserverRegistry()) {
            for (Ref registration : *registry)
                collectMatchingObserversForMutation(registration);
        }
    }

    return observers;
}

void Node::registerMutationObserver(MutationObserver& observer, MutationObserverOptions options, const MemoryCompactLookupOnlyRobinHoodHashSet<AtomString>& attributeFilter)
{
    RefPtr<MutationObserverRegistration> registration;
    auto& registry = ensureRareData().mutationObserverData().registry;

    auto index = registry.findIf([&observer](auto& candidateRegistration) {
        return &candidateRegistration->observer() == &observer;
    });
    if (index != notFound) {
        registration = registry[index].copyRef();
        registration->resetObservation(options, attributeFilter);
    } else {
        registry.append(MutationObserverRegistration::create(observer, *this, options, attributeFilter));
        registration = registry.last().ptr();
    }

    document().addMutationObserverTypes(registration->mutationTypes());
}

void Node::unregisterMutationObserver(MutationObserverRegistration& registration)
{
    auto* registry = mutationObserverRegistry();
    ASSERT(registry);
    if (!registry)
        return;

    registry->removeFirstMatching([&registration] (auto& current) {
        return current.ptr() == &registration;
    });
}

void Node::registerTransientMutationObserver(MutationObserverRegistration& registration)
{
    ensureRareData().mutationObserverData().transientRegistry.add(registration);
}

void Node::unregisterTransientMutationObserver(MutationObserverRegistration& registration)
{
    auto* transientRegistry = transientMutationObserverRegistry();
    ASSERT(transientRegistry);
    if (!transientRegistry)
        return;

    ASSERT(transientRegistry->contains(registration));
    transientRegistry->remove(registration);
}

void Node::notifyMutationObserversNodeWillDetach()
{
    if (!document().hasMutationObservers())
        return;

    for (CheckedPtr node = parentNode(); node; node = node->parentNode()) {
        if (auto* registry = node->mutationObserverRegistry()) {
            for (Ref registration : *registry)
                registration->observedSubtreeNodeWillDetach(*this);
        }
        if (auto* transientRegistry = node->transientMutationObserverRegistry()) {
            for (Ref registration : *transientRegistry)
                registration->observedSubtreeNodeWillDetach(*this);
        }
    }
}

void Node::dispatchScopedEvent(Event& event)
{
    EventDispatcher::dispatchScopedEvent(*this, event);
}

void Node::dispatchEvent(Event& event)
{
    EventDispatcher::dispatchEvent(*this, event);
}

void Node::dispatchDOMActivateEvent(Event& underlyingClickEvent)
{
    ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isScriptAllowed());
    auto* uiEvent = dynamicDowncast<UIEvent>(underlyingClickEvent);
    int detail = uiEvent ? uiEvent->detail() : 0;
    Ref event = UIEvent::create(eventNames().DOMActivateEvent, Event::CanBubble::Yes, Event::IsCancelable::Yes, Event::IsComposed::Yes, document().window(), detail);
    event->setUnderlyingEvent(&underlyingClickEvent);
    dispatchScopedEvent(event);
    if (event->defaultHandled())
        underlyingClickEvent.setDefaultHandled();
}

void Node::dispatchInputEvent()
{
    dispatchScopedEvent(Event::create(eventNames().inputEvent, Event::CanBubble::Yes, Event::IsCancelable::No, Event::IsComposed::Yes));
}

void Node::defaultEventHandler(Event& event)
{
    if (event.target() != this)
        return;
    if (event.type() == eventNames().clickEvent)
        dispatchDOMActivateEvent(event);
}

bool Node::hasActivationBehavior() const
{
    return false;
}

// It's important not to inline removedLastRef, because we don't want to inline the code to
// delete a Node at each deref call site.
void Node::removedLastRef()
{
    RELEASE_ASSERT(m_refCountAndParentBit == s_refCountIncrement);

    // An explicit check for Document here is better than a virtual function since it is
    // faster for non-Document nodes, and because the call to removedLastRef that is inlined
    // at all deref call sites is smaller if it's a non-virtual function.
    if (auto* document = dynamicDowncast<Document>(*this)) {
        document->removedLastRef();
        return;
    }

#if ASSERT_ENABLED
    m_deletionHasBegun = true;
#endif
    delete this;
}

TextDirection Node::effectiveTextDirection() const
{
    if (rareDataBitfields().usesEffectiveTextDirection)
        return static_cast<TextDirection>(rareDataBitfields().effectiveTextDirection);
    return document().documentElementTextDirection();
}

void Node::setEffectiveTextDirection(TextDirection direction)
{
    auto bitfields = rareDataBitfields();
    bitfields.effectiveTextDirection = std::to_underlying(direction);
    setRareDataBitfields(bitfields);
}

void Node::setUsesEffectiveTextDirection(bool value)
{
    auto bitfields = rareDataBitfields();
    bitfields.usesEffectiveTextDirection = value;
    setRareDataBitfields(bitfields);
}

ScriptExecutionContext* Node::scriptExecutionContext() const
{
    return document().m_scriptExecutionContext.ptr();
}

template<> ContainerNode* parent<Tree>(const Node& node)
{
    return node.parentNode();
}

template<> ContainerNode* parent<ShadowIncludingTree>(const Node& node)
{
    return node.parentOrShadowHostNode();
}

template<> ContainerNode* parent<ComposedTree>(const Node& node)
{
    return node.parentInComposedTree();
}

template<TreeType treeType> size_t LEGACY_NODELETE depth(const Node& node)
{
    size_t depth = 0;
    SUPPRESS_UNCHECKED_LOCAL auto ancestor = &node;
    while ((ancestor = parent<treeType>(*ancestor)))
        ++depth;
    return depth;
}

struct AncestorAndChildren {
    const Node* commonAncestor;
    const Node* distinctAncestorA;
    const Node* distinctAncestorB;
};

template<TreeType treeType> AncestorAndChildren commonInclusiveAncestorAndChildren(const Node& a, const Node& b)
{
    // This check isn't needed for correctness, but it is cheap and likely to be
    // common enough to be worth optimizing so we don't have to walk to the root.
    if (&a == &b)
        return { &a, nullptr, nullptr };
    // FIXME: Could optimize cases where nodes are both in the same shadow tree.
    // FIXME: Could optimize cases where nodes are in different documents to quickly return false.
    // FIXME: Could optimize cases where one node is connected and the other is not to quickly return false.
    auto [depthA, depthB] = std::make_tuple(depth<treeType>(a), depth<treeType>(b));
    auto [x, y, difference] = depthA >= depthB
        ? std::make_tuple(&a, &b, depthA - depthB)
        : std::make_tuple(&b, &a, depthB - depthA);
    SUPPRESS_UNCHECKED_LOCAL decltype(x) distinctAncestorA = nullptr;
    for (decltype(difference) i = 0; i < difference; ++i) {
        distinctAncestorA = x;
        x = parent<treeType>(*x);
    }
    SUPPRESS_UNCHECKED_LOCAL decltype(y) distinctAncestorB = nullptr;
    while (x != y) {
        distinctAncestorA = x;
        distinctAncestorB = y;
        x = parent<treeType>(*x);
        y = parent<treeType>(*y);
    }
    if (depthA < depthB)
        std::swap(distinctAncestorA, distinctAncestorB);
    return { x, distinctAncestorA, distinctAncestorB };
}

template<TreeType treeType> Node* commonInclusiveAncestor(const Node& a, const Node& b)
{
    return const_cast<Node*>(commonInclusiveAncestorAndChildren<treeType>(a, b).commonAncestor);
}

template Node* commonInclusiveAncestor<Tree>(const Node&, const Node&);
template Node* commonInclusiveAncestor<ComposedTree>(const Node&, const Node&);
template Node* commonInclusiveAncestor<ShadowIncludingTree>(const Node&, const Node&);

template<TreeType treeType> bool LEGACY_NODELETE isSiblingSubsequent(const Node& siblingA, const Node& siblingB)
{
    ASSERT(&siblingA != &siblingB);
    ASSERT(parent<treeType>(siblingA));
    ASSERT(parent<treeType>(siblingA) == parent<treeType>(siblingB));

    if (!siblingB.nextSibling() || !siblingA.previousSibling())
        return true;
    if (!siblingA.nextSibling() || !siblingB.previousSibling())
        return false;

    for (const Node* following = siblingA.nextSibling(), *preceding = siblingA.previousSibling(); following || preceding;) {
        if (following == &siblingB)
            return true;
        if (preceding == &siblingB)
            return false;
        if (following)
            following = following->nextSibling();
        if (preceding)
            preceding = preceding->previousSibling();
    }

    return false;
}

template<TreeType treeType> std::partial_ordering treeOrder(const Node& a, const Node& b)
{
    if (&a == &b)
        return std::partial_ordering::equivalent;
    auto result = commonInclusiveAncestorAndChildren<treeType>(a, b);
    if (!result.commonAncestor)
        return std::partial_ordering::unordered;
    if (!result.distinctAncestorA)
        return std::partial_ordering::less;
    if (!result.distinctAncestorB)
        return std::partial_ordering::greater;
    bool isShadowRootA = result.distinctAncestorA->isShadowRoot();
    bool isShadowRootB = result.distinctAncestorB->isShadowRoot();
    if (isShadowRootA || isShadowRootB) {
        if (!isShadowRootB)
            return std::partial_ordering::less;
        if (!isShadowRootA)
            return std::partial_ordering::greater;
        ASSERT_NOT_REACHED();
        return std::partial_ordering::unordered;
    }
    return isSiblingSubsequent<treeType>(*result.distinctAncestorA, *result.distinctAncestorB) ? std::partial_ordering::less : std::partial_ordering::greater;
}

template std::partial_ordering treeOrder<Tree>(const Node&, const Node&);
template std::partial_ordering treeOrder<ShadowIncludingTree>(const Node&, const Node&);
template std::partial_ordering treeOrder<ComposedTree>(const Node&, const Node&);

TextStream& operator<<(TextStream& ts, const Node& node)
{
    ts << node.debugDescription();
    return ts;
}

} // namespace WebCore

#if ENABLE(TREE_DEBUGGING)

void showTree(const WebCore::Node* node)
{
    if (node)
        node->showTreeForThis();
}

void showNodePath(const WebCore::Node* node)
{
    if (node)
        node->showNodePathForThis();
}

#endif // ENABLE(TREE_DEBUGGING)
