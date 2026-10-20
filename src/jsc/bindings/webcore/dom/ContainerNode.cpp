/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
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
#include "ContainerNode.h"

#include "AllDescendantsCollection.h"
#include "ChildListMutationScope.h"
#include "ClassCollection.h"
#include "CommonAtomStrings.h"
#include "ContainerNodeAlgorithms.h"
#include "ContainerNodeInlines.h"
#include "CustomElementReactionQueue.h"
#include "DOMClientData.h"
#include "DocumentInlines.h"
#include "ElementChildIteratorInlines.h"
#include "ElementRareData.h"
#include "ElementTraversal.h"
#include "GenericCachedHTMLCollection.h"
#include "HTMLSlotElement.h"
#include "HTMLTemplateElement.h"
#include "JSNodeCustom.h"
#include "Node.h"
#include "NodeRareData.h"
#include "RadioNodeList.h"
#include "ScriptDisallowedScope.h"
#include "SelectorQuery.h"
#include "SlotAssignment.h"
#include "StaticNodeList.h"
#include "TemplateContentDocumentFragment.h"
#include <algorithm>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ContainerNode);

struct SameSizeAsContainerNode : public Node {
    void* firstChild;
    void* lastChild;
};

static_assert(sizeof(ContainerNode) == sizeof(SameSizeAsContainerNode), "ContainerNode should stay small");

#if ASSERT_ENABLED
unsigned& ScriptDisallowedScope::count()
{
    return domClientData().scriptDisallowedScopeCount();
}

ScriptDisallowedScope::EventAllowedScope* ScriptDisallowedScope::EventAllowedScope::currentScope()
{
    return static_cast<EventAllowedScope*>(domClientData().eventAllowedScope());
}

void ScriptDisallowedScope::EventAllowedScope::setCurrentScope(EventAllowedScope* scope)
{
    domClientData().eventAllowedScope() = scope;
}
#endif

ALWAYS_INLINE auto ContainerNode::removeAllChildrenWithScriptAssertion(ChildChange::Source source, NodeVector& children, DeferChildrenChanged deferChildrenChanged) -> DidRemoveElements
{
    ASSERT(children.isEmpty());
    collectChildNodes(*this, children);

    if (isDocumentFragmentForInnerOuterHTML()) [[unlikely]] {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;
        RELEASE_ASSERT(!hasRareData() && !wrapper());
        bool hadElementChild = false;
        while (RefPtr child = m_firstChild.get()) {
            hadElementChild |= is<Element>(*child);
            removeBetween(nullptr, protect(child->nextSibling()).get(), *child);
        }
        document().incDOMTreeVersion();
        return hadElementChild ? DidRemoveElements::Yes : DidRemoveElements::No;
    }

    ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isEventDispatchAllowedInSubtree(*this));
    if (source == ChildChange::Source::API) {
        ChildListMutationScope mutation(*this);
        for (auto& child : children) {
            mutation.willRemoveChild(child.get());
            child->notifyMutationObserversNodeWillDetach();
        }
    } else {
        ASSERT(source == ChildChange::Source::Parser);
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;
        if (document().hasMutationObserversOfType(MutationObserverOptionType::ChildList)) [[unlikely]] {
            ChildListMutationScope mutation(*this);
            for (auto& child : children)
                mutation.willRemoveChild(child.get());
        }
    }

    ContainerNode::ChildChange childChange { ChildChange::Type::AllChildrenRemoved, nullptr, nullptr, nullptr, nullptr, source, ContainerNode::ChildChange::AffectsElements::Unknown };

    bool hadElementChild = false;

    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    if (isShadowRoot() || isInShadowTree()) [[unlikely]]
        containingShadowRoot()->willRemoveAllChildren(*this);

    Ref<Document> { document() }->nodeChildrenWillBeRemoved(*this);

    while (RefPtr child = m_firstChild.get()) {
        if (is<Element>(*child))
            hadElementChild = true;

        removeBetween(nullptr, protect(child->nextSibling()).get(), *child);
        auto subtreeObservability = notifyChildNodeRemoved(*this, *child);
        if (source == ChildChange::Source::API && subtreeObservability == RemovedSubtreeObservability::MaybeObservableByRefPtr)
            willCreatePossiblyOrphanedTreeByRemoval(*child);
    }

    childChange.affectsElements = hadElementChild ? ContainerNode::ChildChange::AffectsElements::Yes : ContainerNode::ChildChange::AffectsElements::No;

    if (deferChildrenChanged == DeferChildrenChanged::No) {
#if ASSERT_ENABLED || ENABLE(SECURITY_ASSERTIONS)
        auto treeVersion = document().domTreeVersion();
#endif
        childrenChanged(childChange);
        ASSERT_WITH_SECURITY_IMPLICATION(document().domTreeVersion() > treeVersion);
    }

    return hadElementChild ? DidRemoveElements::Yes : DidRemoveElements::No;
}

static ContainerNode::ChildChange makeChildChangeForRemoval(Node& childToRemove, ContainerNode::ChildChange::Source source)
{
    auto changeType = [&] {
        if (is<Element>(childToRemove))
            return ContainerNode::ChildChange::Type::ElementRemoved;
        if (is<Text>(childToRemove))
            return ContainerNode::ChildChange::Type::TextRemoved;
        return ContainerNode::ChildChange::Type::NonContentsChildRemoved;
    }();

    return {
        changeType,
        nullptr,
        dynamicDowncast<Element>(childToRemove),
        ElementTraversal::previousSibling(childToRemove),
        ElementTraversal::nextSibling(childToRemove),
        source,
        changeType == ContainerNode::ChildChange::Type::ElementRemoved ? ContainerNode::ChildChange::AffectsElements::Yes : ContainerNode::ChildChange::AffectsElements::No
    };
}

ALWAYS_INLINE void ContainerNode::removeNodeWithScriptAssertion(Node& childToRemove, ChildChange::Source source)
{
    Ref protectedChildToRemove { childToRemove };
    ASSERT_WITH_SECURITY_IMPLICATION(childToRemove.parentNode() == this);
    {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;
        ChildListMutationScope(*this).willRemoveChild(childToRemove);
    }

    ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isEventDispatchAllowedInSubtree(childToRemove));
    if (source == ChildChange::Source::API)
        childToRemove.notifyMutationObserversNodeWillDetach();

    auto childChange = makeChildChangeForRemoval(childToRemove, source);

    RemovedSubtreeObservability subtreeObservability;
    {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;

        if (isShadowRoot() || isInShadowTree()) [[unlikely]]
            containingShadowRoot()->resolveSlotsBeforeNodeInsertionOrRemoval();

        Ref<Document> { document() }->nodeWillBeRemoved(childToRemove);

        ASSERT_WITH_SECURITY_IMPLICATION(childToRemove.parentNode() == this);
        ASSERT(!childToRemove.isDocumentFragment());

        RefPtr previousSibling = childToRemove.previousSibling();
        RefPtr nextSibling = childToRemove.nextSibling();

        removeBetween(previousSibling.get(), nextSibling.get(), childToRemove);
        subtreeObservability = notifyChildNodeRemoved(*this, childToRemove);
    }

    if (source == ChildChange::Source::API && subtreeObservability == RemovedSubtreeObservability::MaybeObservableByRefPtr)
        willCreatePossiblyOrphanedTreeByRemoval(childToRemove);

    // FIXME: Move childrenChanged into ScriptDisallowedScope block.
    childrenChanged(childChange);
}

enum class ReplacedAllChildren { No, YesIncludingElements, YesNotIncludingElements };

static ContainerNode::ChildChange makeChildChangeForInsertion(ContainerNode& containerNode, Node& child, Node* beforeChild, ContainerNode::ChildChange::Source source, ReplacedAllChildren replacedAllChildren)
{
    if (replacedAllChildren != ReplacedAllChildren::No)
        return { ContainerNode::ChildChange::Type::AllChildrenReplaced, nullptr, nullptr, nullptr, nullptr, source, replacedAllChildren == ReplacedAllChildren::YesIncludingElements ? ContainerNode::ChildChange::AffectsElements::Yes : ContainerNode::ChildChange::AffectsElements::No };

    auto changeType = [&] {
        if (is<Element>(child))
            return ContainerNode::ChildChange::Type::ElementInserted;
        if (is<Text>(child))
            return ContainerNode::ChildChange::Type::TextInserted;
        return ContainerNode::ChildChange::Type::NonContentsChildInserted;
    }();

    auto* beforeChildElement = dynamicDowncast<Element>(beforeChild);
    return {
        changeType,
        nullptr,
        dynamicDowncast<Element>(child),
        beforeChild ? ElementTraversal::previousSibling(*beforeChild) : ElementTraversal::lastChild(containerNode),
        !beforeChild || beforeChildElement ? beforeChildElement : ElementTraversal::nextSibling(*beforeChild),
        source,
        changeType == ContainerNode::ChildChange::Type::ElementInserted ? ContainerNode::ChildChange::AffectsElements::Yes : ContainerNode::ChildChange::AffectsElements::No
    };
}

static ContainerNode::ChildChange makeChildChangeForMoveRemoval(Node& child)
{
    auto changeType = [&] {
        if (is<Element>(child))
            return ContainerNode::ChildChange::Type::ElementMovedFrom;
        if (is<Text>(child))
            return ContainerNode::ChildChange::Type::TextMovedFrom;
        return ContainerNode::ChildChange::Type::NonContentsChildMovedFrom;
    }();

    return {
        changeType,
        nullptr,
        dynamicDowncast<Element>(child),
        ElementTraversal::previousSibling(child),
        ElementTraversal::nextSibling(child),
        ContainerNode::ChildChange::Source::API,
        changeType == ContainerNode::ChildChange::Type::ElementMovedFrom ? ContainerNode::ChildChange::AffectsElements::Yes : ContainerNode::ChildChange::AffectsElements::No
    };
}

static ContainerNode::ChildChange makeChildChangeForMoveInsertion(ContainerNode& containerNode, Node& child, Node* beforeChild)
{
    auto changeType = [&] {
        if (is<Element>(child))
            return ContainerNode::ChildChange::Type::ElementMovedInto;
        if (is<Text>(child))
            return ContainerNode::ChildChange::Type::TextMovedInto;
        return ContainerNode::ChildChange::Type::NonContentsChildMovedInto;
    }();

    auto* beforeChildElement = dynamicDowncast<Element>(beforeChild);
    return {
        changeType,
        nullptr,
        dynamicDowncast<Element>(child),
        beforeChild ? ElementTraversal::previousSibling(*beforeChild) : ElementTraversal::lastChild(containerNode),
        !beforeChild || beforeChildElement ? beforeChildElement : ElementTraversal::nextSibling(*beforeChild),
        ContainerNode::ChildChange::Source::API,
        changeType == ContainerNode::ChildChange::Type::ElementMovedInto ? ContainerNode::ChildChange::AffectsElements::Yes : ContainerNode::ChildChange::AffectsElements::No
    };
}

static ContainerNode::ChildChange LEGACY_NODELETE makeChildChangeForInsertion(ContainerNode& containerNode, NodeVector& children, Node* beforeChild, ContainerNode::ChildChange::Source source, ReplacedAllChildren replacedAllChildren)
{
    using Type = ContainerNode::ChildChange::Type;
    using AffectsElements = ContainerNode::ChildChange::AffectsElements;

    if (replacedAllChildren != ReplacedAllChildren::No)
        return { Type::AllChildrenReplaced, &children, nullptr, nullptr, nullptr, source, replacedAllChildren == ReplacedAllChildren::YesIncludingElements ? AffectsElements::Yes : AffectsElements::No };

    ASSERT(children.size());
    auto changeType = Type::NonContentsChildInserted;
    for (auto& child : children) {
        if (is<Element>(child)) {
            if (changeType == Type::TextInserted)
                changeType = Type::ElementAndTextInserted;
            else if (changeType != Type::ElementAndTextInserted)
                changeType = Type::ElementInserted;
            continue;
        }
        if (is<Text>(child)) {
            if (changeType == Type::ElementInserted)
                changeType = Type::ElementAndTextInserted;
            else if (changeType != Type::ElementAndTextInserted)
                changeType = Type::TextInserted;
            continue;
        }
    }

    auto* beforeChildElement = dynamicDowncast<Element>(beforeChild);
    return {
        changeType,
        &children,
        nullptr,
        beforeChild ? ElementTraversal::previousSibling(*beforeChild) : ElementTraversal::lastChild(containerNode),
        !beforeChild || beforeChildElement ? beforeChildElement : ElementTraversal::nextSibling(*beforeChild),
        source,
        changeType == Type::ElementInserted || changeType == Type::ElementAndTextInserted ? AffectsElements::Yes : AffectsElements::No
    };
}

enum class ClonedChildIncludesElements { No, Yes };
static ContainerNode::ChildChange LEGACY_NODELETE makeChildChangeForCloneInsertion(ClonedChildIncludesElements clonedChildIncludesElements)
{
    return { ContainerNode::ChildChange::Type::AllChildrenReplaced, nullptr, nullptr, nullptr, nullptr, ContainerNode::ChildChange::Source::Clone,
        clonedChildIncludesElements == ClonedChildIncludesElements::Yes ? ContainerNode::ChildChange::AffectsElements::Yes : ContainerNode::ChildChange::AffectsElements::No };
}

template<typename DOMInsertionWork>
static ALWAYS_INLINE void executeNodeInsertionWithScriptAssertion(ContainerNode& containerNode, Node& child, Node* beforeChild,
    ContainerNode::ChildChange::Source source, ReplacedAllChildren replacedAllChildren, NOESCAPE const DOMInsertionWork& doNodeInsertion)
{
    auto childChange = makeChildChangeForInsertion(containerNode, child, beforeChild, source, replacedAllChildren);

    NodeVector postInsertionNotificationTargets;
    {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;

        if (containerNode.isShadowRoot() || containerNode.isInShadowTree()) [[unlikely]]
            containerNode.containingShadowRoot()->resolveSlotsBeforeNodeInsertionOrRemoval();

        doNodeInsertion();
        ChildListMutationScope(containerNode).childAdded(child);
        notifyChildNodeInserted(containerNode, child, postInsertionNotificationTargets);
    }
    ASSERT(postInsertionNotificationTargets.isEmpty() || child.isConnected());

    // FIXME: Move childrenChanged into ScriptDisallowedScope block.
    containerNode.childrenChanged(childChange);

    ASSERT(ScriptDisallowedScope::InMainThread::isEventDispatchAllowedInSubtree(child));
    for (auto& target : postInsertionNotificationTargets)
        target->postConnectionSteps();
}

template<typename DOMInsertionWork>
static ALWAYS_INLINE void executeNodeInsertionWithScriptAssertion(ContainerNode& containerNode, NodeVector& children, Node* beforeChild,
    ContainerNode::ChildChange::Source source, ReplacedAllChildren replacedAllChildren, NOESCAPE const DOMInsertionWork& doNodeInsertion)
{
    if (children.isEmpty())
        return;

    // FIXME: Make it work with multiple children. Add TextAndElementInserted.
    auto childChange = makeChildChangeForInsertion(containerNode, children, beforeChild, source, replacedAllChildren);

    NodeVector postInsertionNotificationTargets;
    {
        ChildListMutationScope mutation(containerNode);
        {
            ScriptDisallowedScope::InMainThread scriptDisallowedScope;

            if (containerNode.isShadowRoot() || containerNode.isInShadowTree()) [[unlikely]]
                containerNode.containingShadowRoot()->resolveSlotsBeforeNodeInsertionOrRemoval();

            for (auto& child : children) {
                doNodeInsertion(child);
                mutation.childAdded(child);
                notifyChildNodeInserted(containerNode, child, postInsertionNotificationTargets);
            }
        }
        ASSERT(postInsertionNotificationTargets.isEmpty() || children[0]->isConnected());

        // FIXME: Move childrenChanged into ScriptDisallowedScope block.
        containerNode.childrenChanged(childChange);
    }

    ASSERT(ScriptDisallowedScope::InMainThread::isEventDispatchAllowedInSubtree(containerNode));
    for (auto& target : postInsertionNotificationTargets)
        target->postConnectionSteps();
}

template<typename DOMInsertionWork>
static ALWAYS_INLINE void executeParserNodeInsertionIntoIsolatedTreeWithoutNotifyingParent(ContainerNode& containerNode, Node& child, NOESCAPE const DOMInsertionWork& doNodeInsertion)
{
    {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;

        if (containerNode.isShadowRoot() || containerNode.isInShadowTree()) [[unlikely]]
            containerNode.containingShadowRoot()->resolveSlotsBeforeNodeInsertionOrRemoval();

        doNodeInsertion();
        ChildListMutationScope(containerNode).childAdded(child);
    }
    containerNode.setHasHeldBackChildrenChanged();
}

ExceptionOr<void> ContainerNode::removeSelfOrChildNodesForInsertion(Node& child, NodeVector& nodesForInsertion)
{
    if (auto fragment = dynamicDowncast<DocumentFragment>(child)) {
        if (!fragment->hasChildNodes())
            return { };

        ASSERT(nodesForInsertion.isEmpty());
        fragment->removeAllChildrenWithScriptAssertion(ContainerNode::ChildChange::Source::API, nodesForInsertion);
        return { };
    }

    nodesForInsertion.append(child);
    RefPtr oldParent = child.parentNode();
    if (!oldParent)
        return { };
    return oldParent->removeChild(child);
}

// FIXME: This function must get a new name.
// It removes all children, not just a category called "detached children".
// So this name is terribly confusing.
void ContainerNode::removeDetachedChildren()
{
    // FIXME: We should be able to ASSERT(!attached()) here: https://bugs.webkit.org/show_bug.cgi?id=107801
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;
    removeDetachedChildrenInContainer(*this);
}

void ContainerNode::takeAllChildrenFrom(ContainerNode* oldParent)
{
    ASSERT(oldParent);

    NodeVector children;
    oldParent->removeAllChildrenWithScriptAssertion(ChildChange::Source::Parser, children);

    for (auto& child : children) {
        if (child->parentNode()) // Previous parserAppendChild may have mutated DOM.
            continue;
        ASSERT(!ensurePreInsertionValidity(child, nullptr).hasException());
        child->setTreeScopeRecursivelyToMatch(*this);
        parserAppendChild(child);
    }
}

ContainerNode::~ContainerNode()
{
    removeDetachedChildren();
}

ContainerNode::ContainerNode(ClangVTableWorkaroundTag, Document& document)
    : ContainerNode(document, NodeType::Element, { })
{
}

static inline bool LEGACY_NODELETE isChildTypeAllowed(ContainerNode& newParent, Node& child)
{
    if (!child.isDocumentFragment())
        return newParent.childTypeAllowed(child.nodeType());

    for (auto* node = child.firstChild(); node; node = node->nextSibling()) {
        if (!newParent.childTypeAllowed(node->nodeType()))
            return false;
    }
    return true;
}

static inline const ContainerNode* LEGACY_NODELETE hostIncludingParent(const Node& node)
{
    if (auto* parent = node.parentNode())
        return parent;
    if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(node))
        return shadowRoot->host();
    if (auto* fragment = dynamicDowncast<TemplateContentDocumentFragment>(node))
        return fragment->host();
    return nullptr;
}

// https://dom.spec.whatwg.org/#concept-tree-host-including-inclusive-ancestor
bool containsIncludingHostElements(const Node& possibleAncestor, const Node& node)
{
    if (&possibleAncestor == &node)
        return true;

    if (!possibleAncestor.hasChildNodes() && !possibleAncestor.shadowRoot() && !possibleAncestor.hasTagName(HTMLNames::templateTag))
        return false;

    auto* possibleAncestorRoot = &possibleAncestor.shadowIncludingRoot();
    for (auto* currentNode = &node; currentNode; currentNode = hostIncludingParent(*currentNode)) {
        if (currentNode == &possibleAncestor)
            return true;
        if (auto* currentRoot = &currentNode->shadowIncludingRoot(); currentRoot != possibleAncestorRoot)
            currentNode = currentRoot;
    }

    return false;
}

enum class ShouldValidateChildParent : bool { No, Yes };
static inline ExceptionOr<void> checkAcceptChild(ContainerNode& newParent, Node& newChild, const Node* refChild, AcceptChildOperation operation, ShouldValidateChildParent shouldValidateChildParent)
{
    if (containsIncludingHostElements(newChild, newParent))
        return Exception { ExceptionCode::HierarchyRequestError };

    // Use common case fast path if possible.
    if ((newChild.isElementNode() || newChild.isTextNode()) && newParent.isElementNode()) {
        ASSERT(!newParent.isDocumentTypeNode());
        ASSERT(isChildTypeAllowed(newParent, newChild));
        if (shouldValidateChildParent == ShouldValidateChildParent::Yes && refChild && refChild->parentNode() != &newParent)
            return Exception { ExceptionCode::NotFoundError };
        return { };
    }

    if (shouldValidateChildParent == ShouldValidateChildParent::Yes && refChild && refChild->parentNode() != &newParent)
        return Exception { ExceptionCode::NotFoundError };

    if (auto newParentDocument = dynamicDowncast<Document>(newParent)) {
        if (!newParentDocument->canAcceptChild(newChild, refChild, operation))
            return Exception { ExceptionCode::HierarchyRequestError };
    } else if (!isChildTypeAllowed(newParent, newChild))
        return Exception { ExceptionCode::HierarchyRequestError };

    return { };
}

// https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
ExceptionOr<void> ContainerNode::ensurePreInsertionValidity(Node& newChild, Node* refChild)
{
    return checkAcceptChild(*this, newChild, refChild, AcceptChildOperation::InsertOrAdd, ShouldValidateChildParent::Yes);
}

// https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity when node is a new DocumentFragment created in "converting nodes into a node"
ExceptionOr<void> ContainerNode::ensurePreInsertionValidityForPhantomDocumentFragment(NodeVector& newChildren, Node* refChild, AcceptChildOperation operation)
{
    if (is<Document>(*this)) [[unlikely]] {
        bool hasSeenElement = false;
        for (auto& child : newChildren) {
            if (!is<Element>(child))
                continue;
            if (hasSeenElement)
                return Exception { ExceptionCode::HierarchyRequestError };
            hasSeenElement = true;
        }
    }
    for (auto& child : newChildren) {
        if (auto result = checkAcceptChild(*this, child, refChild, operation, ShouldValidateChildParent::Yes); result.hasException())
            return result;
    }
    return { };
}

// https://dom.spec.whatwg.org/#concept-node-replace
static inline ExceptionOr<void> checkPreReplacementValidity(ContainerNode& newParent, Node& newChild, Node& oldChild, ShouldValidateChildParent shouldValidateChildParent)
{
    return checkAcceptChild(newParent, newChild, &oldChild, AcceptChildOperation::Replace, shouldValidateChildParent);
}

ExceptionOr<void> ContainerNode::insertBefore(Node& newChild, RefPtr<Node>&& refChild)
{
    // Check that this node is not "floating".
    // If it is, it can be deleted as a side effect of sending mutation events.
    ASSERT(refCount() || parentOrShadowHostNode());

    // Make sure adding the new child is OK.
    auto validityCheckResult = ensurePreInsertionValidity(newChild, refChild.get());
    if (validityCheckResult.hasException())
        return validityCheckResult.releaseException();

    if (refChild == &newChild)
        refChild = newChild.nextSibling();

    // insertBefore(node, null) is equivalent to appendChild(node)
    if (!refChild)
        return appendChildWithoutPreInsertionValidityCheck(newChild);

    Ref<ContainerNode> protectedThis(*this);
    Ref next = refChild.releaseNonNull();

    NodeVector targets;
    auto removeResult = removeSelfOrChildNodesForInsertion(newChild, targets);
    if (removeResult.hasException())
        return removeResult.releaseException();
    if (targets.isEmpty())
        return { };

    executeNodeInsertionWithScriptAssertion(*this, targets, next.ptr(), ChildChange::Source::API, ReplacedAllChildren::No, [&](Node& child) {
        child.setTreeScopeRecursivelyToMatch(*this);
        insertBeforeCommon(next, child);
    });

    return { };
}

void ContainerNode::insertBeforeCommon(Node& nextChild, Node& newChild)
{
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    ASSERT(nextChild.parentNode() == this);
    ASSERT(&nextChild != &newChild);
    ASSERT(!newChild.parentNode()); // Use insertBefore if you need to handle reparenting (and want DOM mutation events).
    ASSERT(!newChild.nextSibling());
    ASSERT(!newChild.previousSibling());
    ASSERT(!newChild.isShadowRoot());

    auto* previousSibling = nextChild.previousSibling();
    ASSERT(m_lastChild != previousSibling);
    nextChild.setPreviousSibling(&newChild);
    if (previousSibling) {
        ASSERT(m_firstChild != &nextChild);
        ASSERT(previousSibling->nextSibling() == &nextChild);
        previousSibling->setNextSibling(&newChild);
    } else {
        ASSERT(m_firstChild == &nextChild);
        m_firstChild = &newChild;
    }
    newChild.setParentNode(this);
    newChild.setPreviousSibling(previousSibling);
    newChild.setNextSibling(&nextChild);
}

void ContainerNode::appendChildCommon(Node& child)
{
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    ASSERT(!child.parentNode());
    child.setParentNode(this);

    if (auto* lastChild = this->lastChild()) {
        child.setPreviousSibling(lastChild);
        lastChild->setNextSibling(&child);
    } else
        m_firstChild = &child;

    m_lastChild = &child;
}

void ContainerNode::parserInsertBefore(Node& newChild, Node& nextChild)
{
    ASSERT(nextChild.parentNode() == this);
    ASSERT(!newChild.isDocumentFragment());
    ASSERT(!hasTagName(HTMLNames::templateTag));

    if (nextChild.previousSibling() == &newChild || &nextChild == &newChild) // nothing to do
        return;

    executeNodeInsertionWithScriptAssertion(*this, newChild, &nextChild, ChildChange::Source::Parser, ReplacedAllChildren::No, [&] {
        if (&document() != &newChild.document())
            static_cast<void>(protect(document())->adoptNode(newChild));

        insertBeforeCommon(nextChild, newChild);
        newChild.setTreeScopeRecursivelyToMatch(*this);
    });
}

ExceptionOr<void> ContainerNode::replaceChild(Node& newChild, Node& oldChild)
{
    // Check that this node is not "floating".
    // If it is, it can be deleted as a side effect of sending mutation events.
    ASSERT(refCount() || parentOrShadowHostNode());

    Ref protectedThis { *this };

    // Make sure replacing the old child with the new is ok
    auto validityResult = checkPreReplacementValidity(*this, newChild, oldChild, ShouldValidateChildParent::Yes);
    if (validityResult.hasException())
        return validityResult.releaseException();

    RefPtr refChild = oldChild.nextSibling();
    if (refChild.get() == &newChild)
        refChild = refChild->nextSibling();

    NodeVector targets;
    {
        ChildListMutationScope mutation(*this);
        auto collectResult = removeSelfOrChildNodesForInsertion(newChild, targets);
        if (collectResult.hasException())
            return collectResult.releaseException();
    }

    // Remove the node we're replacing.
    Ref protectOldChild { oldChild };

    ChildListMutationScope mutation(*this);

    // If oldChild == newChild then oldChild no longer has a parent at this point.
    if (oldChild.parentNode()) {
        auto removeResult = removeChild(oldChild);
        if (removeResult.hasException())
            return removeResult.releaseException();
    }

    executeNodeInsertionWithScriptAssertion(*this, targets, refChild.get(), ChildChange::Source::API, ReplacedAllChildren::No, [&](Node& child) {
        child.setTreeScopeRecursivelyToMatch(*this);
        if (refChild)
            insertBeforeCommon(*refChild, child);
        else
            appendChildCommon(child);
    });

    return { };
}

ExceptionOr<void> ContainerNode::removeChild(Node& oldChild)
{
    // Check that this node is not "floating".
    // If it is, it can be deleted as a side effect of sending mutation events.
    ASSERT(refCount() || parentOrShadowHostNode());

    Ref protectedThis { *this };
    Ref protectedOldChild { oldChild };

    // NotFoundError: Raised if oldChild is not a child of this node.
    if (oldChild.parentNode() != this)
        return Exception { ExceptionCode::NotFoundError };

    removeNodeWithScriptAssertion(oldChild, ChildChange::Source::API);

    return { };
}

void ContainerNode::removeBetween(Node* previousChild, Node* nextChild, Node& oldChild)
{
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    ASSERT(oldChild.parentNode() == this);

    if (hasShadowRootContainingSlots()) [[unlikely]]
        protect(shadowRoot())->willRemoveAssignedNode(oldChild);

    if (nextChild) {
        nextChild->setPreviousSibling(previousChild);
        oldChild.setNextSibling(nullptr);
    } else {
        ASSERT(m_lastChild == &oldChild);
        m_lastChild = previousChild;
    }
    if (previousChild) {
        previousChild->setNextSibling(nextChild);
        oldChild.setPreviousSibling(nullptr);
    } else {
        ASSERT(m_firstChild == &oldChild);
        m_firstChild = nextChild;
    }

    ASSERT(m_firstChild != &oldChild);
    ASSERT(m_lastChild != &oldChild);
    ASSERT(!oldChild.previousSibling());
    ASSERT(!oldChild.nextSibling());
    oldChild.setParentNode(nullptr);

    oldChild.setTreeScopeRecursivelyToDocument();
}

void ContainerNode::parserRemoveChild(Node& oldChild)
{
    removeNodeWithScriptAssertion(oldChild, ChildChange::Source::Parser);
}

// https://dom.spec.whatwg.org/#concept-node-replace-all
void ContainerNode::replaceAll(Node* node)
{
    if (!node) {
        ChildListMutationScope mutation(*this);
        removeChildren();
        return;
    }

    // FIXME: The code below is roughly correct for a new text node with no parent, but needs enhancement to work properly for more complex cases.

    if (!hasChildNodes()) {
        appendChildWithoutPreInsertionValidityCheck(*node);
        return;
    }

    Ref protectedThis { *this };
    ChildListMutationScope mutation(*this);
    NodeVector removedChildren;
    auto didRemoveElements = removeAllChildrenWithScriptAssertion(ChildChange::Source::API, removedChildren, DeferChildrenChanged::No);
    auto replacedAllChildren = is<Element>(*node) || didRemoveElements == DidRemoveElements::Yes
        ? ReplacedAllChildren::YesIncludingElements : ReplacedAllChildren::YesNotIncludingElements;

    executeNodeInsertionWithScriptAssertion(*this, *node, nullptr, ChildChange::Source::API, replacedAllChildren, [&] {
        node->setTreeScopeRecursivelyToMatch(*this);
        appendChildCommon(*node);
    });
}

// https://dom.spec.whatwg.org/#string-replace-all
void ContainerNode::stringReplaceAll(String&& string)
{
    replaceAll(string.isEmpty() ? nullptr : protect(document())->createTextNode(WTF::move(string)).ptr());
}

// this differs from other remove functions because it forcibly removes all the children,
// regardless of read-only status or event exceptions, e.g.
void ContainerNode::removeChildren()
{
    if (!m_firstChild)
        return;

    Ref protectedThis { *this };
    NodeVector removedChildren;
    removeAllChildrenWithScriptAssertion(ChildChange::Source::API, removedChildren, DeferChildrenChanged::No);
}

ExceptionOr<void> ContainerNode::appendChild(Node& newChild)
{
    // Check that this node is not "floating".
    // If it is, it can be deleted as a side effect of sending mutation events.
    ASSERT(refCount() || parentOrShadowHostNode());

    // Make sure adding the new child is ok
    auto validityCheckResult = ensurePreInsertionValidity(newChild, nullptr);
    if (validityCheckResult.hasException())
        return validityCheckResult.releaseException();

    return appendChildWithoutPreInsertionValidityCheck(newChild);
}

ExceptionOr<void> ContainerNode::appendChildWithoutPreInsertionValidityCheck(Node& newChild)
{
    Ref protectedThis { *this };

    NodeVector targets;
    auto removeResult = removeSelfOrChildNodesForInsertion(newChild, targets);
    if (removeResult.hasException())
        return removeResult.releaseException();

    if (targets.isEmpty())
        return { };

    executeNodeInsertionWithScriptAssertion(*this, targets, nullptr, ChildChange::Source::API, ReplacedAllChildren::No, [&](Node& child) {
        child.setTreeScopeRecursivelyToMatch(*this);
        appendChildCommon(child);
    });

    return { };
}

ExceptionOr<void> ContainerNode::insertChildrenBeforeWithoutPreInsertionValidityCheck(NodeVector&& newChildren, Node* nextChild)
{
    RefPtr refChild = nextChild;
    for (auto& child : newChildren) {
        if (RefPtr oldParent = child->parentNode()) {
            if (refChild.get() == child.ptr())
                refChild = child->nextSibling();
            if (auto result = oldParent->removeChild(child); result.hasException())
                return result.releaseException();
        }
    }

    executeNodeInsertionWithScriptAssertion(*this, newChildren, refChild.get(), ChildChange::Source::API, ReplacedAllChildren::No, [&](auto& child) {
        child->setTreeScopeRecursively(treeScope());
        if (refChild)
            insertBeforeCommon(*refChild, child);
        else
            appendChildCommon(child);
    });

    return { };
}

void ContainerNode::parserAppendChild(Node& newChild)
{
    ASSERT(!newChild.parentNode()); // Use appendChild if you need to handle reparenting (and want DOM mutation events).
    ASSERT(!newChild.isDocumentFragment());
    ASSERT(!hasTagName(HTMLNames::templateTag));

    executeNodeInsertionWithScriptAssertion(*this, newChild, nullptr, ChildChange::Source::Parser, ReplacedAllChildren::No, [&] {
        if (&document() != &newChild.document())
            static_cast<void>(protect(document())->adoptNode(newChild));

        appendChildCommon(newChild);
        newChild.setTreeScopeRecursivelyToMatch(*this);
    });
}

void ContainerNode::parserAppendChildIntoIsolatedTree(Node& newChild)
{
    ASSERT(!newChild.traverseToRootNode().wrapper());
    ASSERT(!newChild.parentNode()); // Use appendChild if you need to handle reparenting (and want DOM mutation events).
    ASSERT(is<Element>(*this) || is<DocumentFragment>(*this)); // Only Element calls parserNotifyChildrenChanged
    ASSERT(is<DocumentFragment>(*this) || !isParsingChildrenFinished());
    ASSERT(!newChild.isDocumentFragment());
    ASSERT(!hasTagName(HTMLNames::templateTag));
    RELEASE_ASSERT(&newChild.document() == &document());

    executeParserNodeInsertionIntoIsolatedTreeWithoutNotifyingParent(*this, newChild, [&] {
        appendChildCommon(newChild);
        newChild.setTreeScopeRecursivelyToMatch(*this);
    });
}

void ContainerNode::parserNotifyChildrenChanged()
{
    ASSERT(!traverseToRootNode().wrapper());
    ASSERT(is<Element>(*this));
    ASSERT(hasHeldBackChildrenChanged());
    clearHasHeldBackChildrenChanged();
    childrenChanged(ChildChange { ContainerNode::ChildChange::Type::AllChildrenReplaced, nullptr, nullptr, nullptr, nullptr, ChildChange::Source::Parser,
        firstElementChild() ? ChildChange::AffectsElements::Yes : ChildChange::AffectsElements::No, IsMutationBySetInnerHTML::Yes });
}

ExceptionOr<void> ContainerNode::appendChild(ChildChange::Source source, Node& newChild)
{
    if (source == ChildChange::Source::Parser) {
        parserAppendChild(newChild);
        return { };
    }
    return appendChild(newChild);
}

void ContainerNode::childrenChanged(const ChildChange& change)
{
    Ref<Document> document = this->document();
    document->incDOMTreeVersion();

    // FIXME: Unclear why it's always safe to skip this when parser is adding children.
    // FIXME: Seems like it's equally safe to skip for TextInserted and TextRemoved as for TextChanged.
    // FIXME: Should use switch for change type so we remember to update when adding new types.
    if (change.source == ChildChange::Source::API && change.type != ChildChange::Type::TextChanged)
        document->updateRangesAfterChildrenChanged(*this);

    if (change.isMutationBySetInnerHTML == IsMutationBySetInnerHTML::No)
        setDidMutateSubtreeAfterSetInnerHTMLOnAncestors();
    if (change.affectsElements == ChildChange::AffectsElements::Yes)
        invalidateNodeListAndCollectionCachesInAncestors();
    else if (change.type != ChildChange::Type::TextChanged) {
        if (hasRareData()) {
            if (auto* lists = rareData()->nodeLists())
                lists->clearChildNodeListCache();
        }
    }
}

static constexpr size_t cloneMaxDepth = 1024;

void ContainerNode::cloneSubtreeForFastParser(Document& document, CustomElementRegistry* fallbackRegistry, ContainerNode& clone, size_t currentDepth) const
{
    if (!hasChildNodes() || currentDepth >= cloneMaxDepth)
        return;

    for (RefPtr child = firstChild(); child; child = child->nextSibling()) {
        Ref clonedChild = child->cloneNodeInternal(document, CloningOperation::SelfOnly, fallbackRegistry);
        executeParserNodeInsertionIntoIsolatedTreeWithoutNotifyingParent(clone, clonedChild.get(), [&] {
            clone.appendChildCommon(clonedChild);
            clonedChild->setTreeScopeRecursivelyToMatch(clone);
        });

        if (RefPtr childAsContainerNode = dynamicDowncast<ContainerNode>(*child))
            childAsContainerNode->cloneSubtreeForFastParser(document, fallbackRegistry, downcast<ContainerNode>(clonedChild.get()), currentDepth + 1);
    }
    clone.parserNotifyChildrenChanged();
}

void ContainerNode::cloneChildNodes(Document& document, CustomElementRegistry* fallbackRegistry, ContainerNode& clone, size_t currentDepth) const
{
    if (currentDepth >= cloneMaxDepth)
        return;

    NodeVector postInsertionNotificationTargets;
    bool hadElement = false;
    for (RefPtr child = firstChild(); child; child = child->nextSibling()) {
        Ref clonedChild = child->cloneNodeInternal(document, CloningOperation::SelfWithTemplateContent, fallbackRegistry);
        {
            ScriptDisallowedScope::InMainThread scriptDisallowedScope;

            clonedChild->setTreeScopeRecursivelyToMatch(clone);

            clone.appendChildCommon(clonedChild);
            notifyChildNodeInserted(clone, clonedChild, postInsertionNotificationTargets);

            hadElement = hadElement || is<Element>(clonedChild);
        }
        if (RefPtr childAsContainerNode = dynamicDowncast<ContainerNode>(*child))
            childAsContainerNode->cloneChildNodes(document, fallbackRegistry, downcast<ContainerNode>(clonedChild), currentDepth + 1);
    }
    clone.childrenChanged(makeChildChangeForCloneInsertion(hadElement ? ClonedChildIncludesElements::Yes : ClonedChildIncludesElements::No));

    for (auto& target : postInsertionNotificationTargets)
        target->postConnectionSteps();
}

unsigned ContainerNode::countChildNodes() const
{
    unsigned count = 0;
    for (Node* child = firstChild(); child; child = child->nextSibling())
        ++count;
    return count;
}

Node* ContainerNode::traverseToChildAt(unsigned index) const
{
    Node* child = firstChild();
    for (; child && index > 0; --index)
        child = child->nextSibling();
    return child;
}

ExceptionOr<Element*> ContainerNode::querySelector(const String& selectors)
{
    Ref document = this->document();
    if (auto result = document->resultForSelector(*this, selectors))
        return *result;
    auto query = document->selectorQueryForString(selectors);
    if (query.hasException())
        return query.releaseException();
    auto& selectorQuery = query.releaseReturnValue();
    RefPtr result = selectorQuery.queryFirst(*this);
    if (selectorQuery.shouldStoreInDocument())
        document->addResultForSelector(*this, selectors, result.get(), selectorQuery.classNameToMatch());
    return result.get();
}

ExceptionOr<Ref<NodeList>> ContainerNode::querySelectorAll(const String& selectors)
{
    Ref document = this->document();
    if (auto results = document->resultForSelectorAll(*this, selectors))
        return Ref<NodeList> { StaticWrapperNodeList::create(results.releaseNonNull()) };
    auto query = document->selectorQueryForString(selectors);
    if (query.hasException())
        return query.releaseException();
    auto isCacheable = query.returnValue().shouldStoreInDocument();
    auto classNameToMatch = query.returnValue().classNameToMatch();
    auto nodeList = query.releaseReturnValue().queryAll(*this);
    if (isCacheable)
        document->addResultForSelectorAll(*this, selectors, nodeList, classNameToMatch);

    return nodeList;
}

Ref<HTMLCollection> ContainerNode::getElementsByTagName(const AtomString& qualifiedName)
{
    ASSERT(!qualifiedName.isNull());

    if (qualifiedName == starAtom())
        return ensureRareData().ensureNodeLists().addCachedCollection<AllDescendantsCollection>(*this);

    if (document().isHTMLDocument())
        return ensureRareData().ensureNodeLists().addCachedCollection<HTMLTagCollection>(*this, qualifiedName);
    return ensureRareData().ensureNodeLists().addCachedCollection<TagCollection>(*this, qualifiedName);
}

Ref<HTMLCollection> ContainerNode::getElementsByTagNameNS(const AtomString& namespaceURI, const AtomString& localName)
{
    ASSERT(!localName.isNull());
    return ensureRareData().ensureNodeLists().addCachedTagCollectionNS(*this, namespaceURI.isEmpty() ? nullAtom() : namespaceURI, localName);
}

Ref<HTMLCollection> ContainerNode::getElementsByClassName(const AtomString& classNames)
{
    return ensureRareData().ensureNodeLists().addCachedCollection<ClassCollection>(*this, classNames);
}

Ref<RadioNodeList> ContainerNode::radioNodeList(const AtomString& name)
{
    ASSERT(hasTagName(HTMLNames::formTag) || hasTagName(HTMLNames::fieldsetTag));
    return ensureRareData().ensureNodeLists().addCacheWithAtomName<RadioNodeList>(*this, name);
}

Ref<HTMLCollection> ContainerNode::children()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLNodeChildrenCollection>(*this);
}

Element* ContainerNode::firstElementChild() const
{
    return ElementTraversal::firstChild(*this);
}

Element* ContainerNode::lastElementChild() const
{
    return ElementTraversal::lastChild(*this);
}

unsigned ContainerNode::childElementCount() const
{
    auto children = childrenOfType<Element>(*this);
    return std::distance(children.begin(), { });
}

ExceptionOr<void> ContainerNode::append(FixedVector<NodeOrString>&& vector)
{
    auto result = convertNodesOrStringsIntoNodeVector(WTF::move(vector));
    if (result.hasException())
        return result.releaseException();

    auto newChildren = result.releaseReturnValue();
    if (auto checkResult = ensurePreInsertionValidityForPhantomDocumentFragment(newChildren); checkResult.hasException())
        return checkResult;

    Ref protectedThis { *this };
    if (auto appendResult = insertChildrenBeforeWithoutPreInsertionValidityCheck(WTF::move(newChildren)); appendResult.hasException())
        return appendResult;

    return { };
}

ExceptionOr<void> ContainerNode::prepend(FixedVector<NodeOrString>&& vector)
{
    auto result = convertNodesOrStringsIntoNodeVector(WTF::move(vector));
    if (result.hasException())
        return result.releaseException();

    RefPtr nextChild = firstChild();
    auto newChildren = result.releaseReturnValue();
    if (auto checkResult = ensurePreInsertionValidityForPhantomDocumentFragment(newChildren, nextChild.get()); checkResult.hasException())
        return checkResult;

    Ref protectedThis { *this };
    if (auto appendResult = insertChildrenBeforeWithoutPreInsertionValidityCheck(WTF::move(newChildren), nextChild.get()); appendResult.hasException())
        return appendResult;

    return { };
}

// https://dom.spec.whatwg.org/#dom-parentnode-replacechildren
ExceptionOr<void> ContainerNode::replaceChildren(FixedVector<NodeOrString>&& vector)
{
    auto result = convertNodesOrStringsIntoNodeVector(WTF::move(vector));
    if (result.hasException())
        return result.releaseException();
    auto newChildren = result.releaseReturnValue();

    if (auto checkResult = ensurePreInsertionValidityForPhantomDocumentFragment(newChildren, nullptr, AcceptChildOperation::ReplaceAll); checkResult.hasException())
        return checkResult;

    Ref protectedThis { *this };
    ChildListMutationScope mutation(*this);
    NodeVector removedChildren;
    removeAllChildrenWithScriptAssertion(ChildChange::Source::API, removedChildren, DeferChildrenChanged::No);

    if (auto appendResult = insertChildrenBeforeWithoutPreInsertionValidityCheck(WTF::move(newChildren)); appendResult.hasException())
        return appendResult;

    return { };
}

void ContainerNode::replaceChildrenWithoutValidityCheck(NodeVector&& newChildren)
{
    ChildListMutationScope mutation(*this);
    NodeVector removedChildren;
    removeAllChildrenWithScriptAssertion(ChildChange::Source::API, removedChildren, DeferChildrenChanged::No);
    auto appendResult = insertChildrenBeforeWithoutPreInsertionValidityCheck(WTF::move(newChildren));
    RELEASE_ASSERT(!appendResult.hasException());
}

static void runMovingStepsForShadowIncludingInclusiveDescendants(Node& root, Node& movedNode, ContainerNode& oldParent, bool newParentIsConnected, Node::MovingType movingType)
{
    for (RefPtr inclusiveDescendant = &root; inclusiveDescendant; inclusiveDescendant = NodeTraversal::next(*inclusiveDescendant, &root)) {
        movingType.isSubtreeRoot = inclusiveDescendant == &movedNode;
        inclusiveDescendant->movingSteps(movingType, oldParent);

        if (newParentIsConnected) {
            if (RefPtr element = dynamicDowncast<Element>(*inclusiveDescendant); element && element->isDefinedCustomElement())
                CustomElementReactionQueue::enqueueConnectedMoveCallbackIfNeeded(*element);
        }

        if (RefPtr shadowRoot = inclusiveDescendant->shadowRoot())
            runMovingStepsForShadowIncludingInclusiveDescendants(*shadowRoot, movedNode, oldParent, newParentIsConnected, { });
    }
}

// https://dom.spec.whatwg.org/#dom-parentnode-movebefore
ExceptionOr<void> ContainerNode::moveBefore(Node& node, RefPtr<Node>&& refChild)
{
    if (refChild == &node)
        refChild = node.nextSibling();

    // From https://dom.spec.whatwg.org/#move
    if (&shadowIncludingRoot() != &node.shadowIncludingRoot())
        return Exception { ExceptionCode::HierarchyRequestError };

    if (containsIncludingHostElements(node, *this))
        return Exception { ExceptionCode::HierarchyRequestError };

    if (refChild && refChild->parentNode() != this)
        return Exception { ExceptionCode::NotFoundError };

    if (!node.isElementNode() && !node.isCharacterDataNode())
        return Exception { ExceptionCode::HierarchyRequestError };

    if (is<Text>(node) && is<Document>(*this))
        return Exception { ExceptionCode::HierarchyRequestError };

    if (is<Document>(*this) && is<Element>(node)) {
        bool hasElementChild = childElementCount() > 0;
        bool childIsDoctype = refChild && refChild->isDocumentTypeNode();

        if (hasElementChild || childIsDoctype)
            return Exception { ExceptionCode::HierarchyRequestError };

        if (refChild) {
            for (RefPtr followingSibling = refChild; followingSibling; followingSibling = followingSibling->nextSibling()) {
                if (followingSibling->isDocumentTypeNode())
                    return Exception { ExceptionCode::HierarchyRequestError };
            }
        }
    }

    RefPtr oldParent = node.parentNode();
    ASSERT(oldParent);

    RefPtr oldPreviousSibling = node.previousSibling();
    RefPtr oldNextSibling = node.nextSibling();

    auto removalChildChange = makeChildChangeForMoveRemoval(node);
    std::optional<ChildChange> insertionChildChange;

    {
        Ref nodeDocument = node.document();
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;
        ChildListMutationScope(*oldParent).willRemoveChild(node);
        nodeDocument->nodeWillBeMoved(node);

        if (oldNextSibling) {
            oldNextSibling->setPreviousSibling(oldPreviousSibling.get());
            node.setNextSibling(nullptr);
        } else {
            ASSERT(oldParent->lastChild() == &node);
            oldParent->setLastChild(oldPreviousSibling.get());
        }

        if (oldPreviousSibling) {
            oldPreviousSibling->setNextSibling(oldNextSibling.get());
            node.setPreviousSibling(nullptr);
        } else {
            ASSERT(oldParent->firstChild() == &node);
            oldParent->setFirstChild(oldNextSibling.get());
        }

        node.setParentNode(nullptr);

        // FIXME(281223): Handle slot assignments and live ranges.

        insertionChildChange.emplace(makeChildChangeForMoveInsertion(*this, node, refChild.get()));

        if (refChild)
            insertBeforeCommon(*refChild, node);
        else
            appendChildCommon(node);

        node.setTreeScopeRecursivelyToMatch(*this);
        ChildListMutationScope(*this).childAdded(node);
    }

    auto newParentIsConnected = isConnected();

    runMovingStepsForShadowIncludingInclusiveDescendants(node, node, *oldParent, newParentIsConnected, { .didRemoveFromOldTreeScope = oldParent->isInTreeScope(), .didInsertIntoNewTreeScope = isInTreeScope() });

    oldParent->childrenChanged(removalChildChange);
    childrenChanged(*insertionChildChange);

    return { };
}

HTMLCollection* ContainerNode::cachedHTMLCollection(CollectionType type)
{
    return hasRareData() && rareData()->nodeLists() ? rareData()->nodeLists()->cachedCollection<HTMLCollection>(type) : nullptr;
}

ContainerNode& ContainerNode::traverseToRootNode() const
{
    return traverseToRootNodeInternal(*this);
}

} // namespace WebCore
