/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 * Copyright (C) 2013-2023 Apple Inc. All rights reserved.
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
#include "EventPath.h"

#include "ContainerNodeInlines.h"
#include "ElementRareData.h"
#include "Event.h"
#include "EventContext.h"
#include "EventNames.h"
#include "FocusEvent.h"
#include "HTMLSlotElement.h"
#include "MouseEvent.h"
#include "ShadowRoot.h"
#include "SlotAssignment.h"
#include "TouchEvent.h"
#include "TreeScopeInlines.h"
#include "Window.h"
#include <wtf/CheckedPtr.h>

namespace WebCore {

static inline bool LEGACY_NODELETE shouldEventCrossShadowBoundary(Event& event, ShadowRoot& shadowRoot, EventTarget& target)
{
    auto* targetNode = dynamicDowncast<Node>(target);
    bool targetIsInShadowRoot = targetNode && &targetNode->treeScope().rootNode() == &shadowRoot;
    return !targetIsInShadowRoot || event.composed();
}

class RelatedNodeRetargeter {
public:
    RelatedNodeRetargeter(Ref<Node>&& relatedNode, Node& target);

    Node* LEGACY_NODELETE currentNode(Node& currentTreeScope);
    void moveToNewTreeScope(TreeScope* previousTreeScope, TreeScope& newTreeScope);

private:
    Node* LEGACY_NODELETE nodeInLowestCommonAncestor();
    void collectTreeScopes();

    void LEGACY_NODELETE checkConsistency(Node& currentTarget);

    const Ref<Node> m_relatedNode;
    RefPtr<Node> m_retargetedRelatedNode;
    Vector<Ref<TreeScope>, 8> m_ancestorTreeScopes;
    unsigned m_lowestCommonAncestorIndex { 0 };
    bool m_hasDifferentTreeRoot { false };
};

EventPath::EventPath(Node& originalTarget, Event& event)
{
    buildPath(originalTarget, event);

    if (RefPtr relatedTarget = dynamicDowncast<Node>(event.relatedTarget()); relatedTarget && !m_path.isEmpty())
        setRelatedTarget(originalTarget, *relatedTarget);

#if ENABLE(TOUCH_EVENTS)
    if (RefPtr touchEvent = dynamicDowncast<TouchEvent>(event))
        retargetTouchLists(*touchEvent);
#endif
}

void EventPath::buildPath(Node& originalTarget, Event& event)
{
    auto contextType = [&] {
        if (isAnyOf<MouseEvent, FocusEvent>(event))
            return EventContext::Type::MouseOrFocus;
#if ENABLE(TOUCH_EVENTS)
        if (is<TouchEvent>(event))
            return EventContext::Type::Touch;
#endif
        return EventContext::Type::Normal;
    }();

    RefPtr node = &originalTarget;
    RefPtr target = eventTargetRespectingTargetRules(*node);
    int closedShadowDepth = 0;
    // Depths are used to decided which nodes are excluded in event.composedPath when the tree is mutated during event dispatching.
    // They could be negative for nodes outside the shadow tree of the target node.
    RefPtr<ShadowRoot> shadowRoot;
    while (node) {
        while (node) {
            m_path.append(EventContext { contextType, *node, eventTargetRespectingTargetRules(*node), target.get(), closedShadowDepth });

            if (RefPtr maybeShadowRoot = dynamicDowncast<ShadowRoot>(*node)) {
                shadowRoot = WTF::move(maybeShadowRoot);
                break;
            }

            RefPtr parent = node->parentNode();
            if (!parent) [[unlikely]] {
                // https://dom.spec.whatwg.org/#interface-document
                if (auto* document = dynamicDowncast<Document>(*node); document && event.type() != eventNames().loadEvent) {
                    ASSERT(target);
                    if (target) {
                        if (RefPtr window = document->window())
                            m_path.append(EventContext { EventContext::Type::Window, node.get(), window.get(), target.get(), closedShadowDepth });
                    }
                }
                return;
            }

            if (RefPtr shadowRootOfParent = parent->shadowRoot(); shadowRootOfParent) [[unlikely]] {
                if (RefPtr assignedSlot = shadowRootOfParent->findAssignedSlot(*node)) {
                    if (shadowRootOfParent->mode() != ShadowRootMode::Open)
                        closedShadowDepth++;
                    // node is assigned to a slot. Continue dispatching the event at this slot.
                    parent = WTF::move(assignedSlot);
                }
            }
            node = WTF::move(parent);
        }

        bool exitingShadowTreeOfTarget = &target->treeScope() == &node->treeScope();
        if (!shouldEventCrossShadowBoundary(event, *shadowRoot, originalTarget))
            return;
        node = shadowRoot->host();
        ASSERT(node);
        if (!node)
            return;
        if (shadowRoot->mode() != ShadowRootMode::Open)
            closedShadowDepth--;
        if (exitingShadowTreeOfTarget)
            target = eventTargetRespectingTargetRules(*node);
    }
}

void EventPath::setRelatedTarget(Node& origin, Node& relatedNode)
{
    RelatedNodeRetargeter retargeter(relatedNode, Ref { *m_path[0].node() });

    bool originIsRelatedTarget = &origin == &relatedNode;
    Ref rootNodeInOriginTreeScope = origin.treeScope().rootNode();
    RefPtr<TreeScope> previousTreeScope;
    size_t originalEventPathSize = m_path.size();
    for (unsigned contextIndex = 0; contextIndex < originalEventPathSize; contextIndex++) {
        auto& context = m_path[contextIndex];
        if (!(context.isMouseOrFocusEventContext() || context.isWindowContext())) {
            ASSERT(context.isTouchEventContext() || context.isNormalEventContext());
            continue;
        }

        Ref currentTarget = *context.node();
        Ref currentTreeScope = currentTarget->treeScope();
        if (previousTreeScope && currentTreeScope.ptr() != previousTreeScope) [[unlikely]]
            retargeter.moveToNewTreeScope(previousTreeScope.get(), currentTreeScope);

        RefPtr currentRelatedNode = retargeter.currentNode(currentTarget);
        if (!originIsRelatedTarget && context.target() == currentRelatedNode) [[unlikely]] {
            m_path.shrink(contextIndex);
            break;
        }

        context.setRelatedTarget(WTF::move(currentRelatedNode));

        if (originIsRelatedTarget && context.node() == rootNodeInOriginTreeScope.ptr()) [[unlikely]] {
            m_path.shrink(contextIndex + 1);
            break;
        }

        previousTreeScope = WTF::move(currentTreeScope);
    }
}

void EventPath::adjustForDisabledFormControl()
{
    for (unsigned i = 0; i < m_path.size(); ++i) {
        RefPtr element = dynamicDowncast<Element>(m_path[i].node());
        if (element && element->isDisabledFormControl()) {
            m_path.shrink(i);
            return;
        }
    }
}

#if ENABLE(TOUCH_EVENTS)

void EventPath::retargetTouch(EventContext::TouchListType type, const Touch& touch)
{
    RefPtr eventTarget = dynamicDowncast<Node>(touch.target());
    if (!eventTarget)
        return;

    RelatedNodeRetargeter retargeter(eventTarget.releaseNonNull(), Ref { *m_path[0].node() });
    RefPtr<TreeScope> previousTreeScope;
    for (auto& context : m_path) {
        Ref currentTarget = *context.node();
        Ref currentTreeScope = currentTarget->treeScope();
        if (previousTreeScope && currentTreeScope.ptr() != previousTreeScope) [[unlikely]]
            retargeter.moveToNewTreeScope(previousTreeScope.get(), currentTreeScope);

        if (context.isTouchEventContext()) {
            RefPtr currentRelatedNode = retargeter.currentNode(currentTarget);
            context.touchList(type).append(touch.cloneWithNewTarget(currentRelatedNode.get()));
        } else
            ASSERT(context.isWindowContext());

        previousTreeScope = WTF::move(currentTreeScope);
    }
}

void EventPath::retargetTouchList(EventContext::TouchListType type, const TouchList* list)
{
    for (unsigned i = 0, length = list ? list->length() : 0; i < length; ++i)
        retargetTouch(type, *list->item(i));
}

void EventPath::retargetTouchLists(const TouchEvent& event)
{
    retargetTouchList(EventContext::TouchListType::Touches, event.touches());
    retargetTouchList(EventContext::TouchListType::TargetTouches, event.targetTouches());
    retargetTouchList(EventContext::TouchListType::ChangedTouches, event.changedTouches());
}

#endif

// https://dom.spec.whatwg.org/#dom-event-composedpath
// Any node whose depth computed in EventPath::buildPath is greater than the context object is excluded.
// Because we can exit out of a closed shadow tree and re-enter another closed shadow tree via a slot,
// we decrease the *allowed depth* whenever we moved to a "shallower" (closer-to-document) tree.
Vector<Ref<EventTarget>> EventPath::computePathUnclosedToTarget(const EventTarget& target) const
{
    Vector<Ref<EventTarget>> path;
    auto pathSize = m_path.size();
    RELEASE_ASSERT(pathSize);
    path.reserveInitialCapacity(pathSize);

    auto currentTargetIndex = m_path.findIf([&target](auto& context) {
        return context.currentTarget() == &target;
    });
    RELEASE_ASSERT(currentTargetIndex != notFound);
    auto currentTargetDepth = m_path[currentTargetIndex].closedShadowDepth();

    auto appendTargetWithLesserDepth = [&path](const EventContext& currentContext, int& currentDepthAllowed) {
        auto depth = currentContext.closedShadowDepth();
        bool contextIsInsideInnerShadowTree = depth > currentDepthAllowed;
        if (contextIsInsideInnerShadowTree)
            return;
        bool movedOutOfShadowTree = depth < currentDepthAllowed;
        if (movedOutOfShadowTree)
            currentDepthAllowed = depth;
        path.append(Ref { *currentContext.currentTarget() });
    };

    auto currentDepthAllowed = currentTargetDepth;
    auto i = currentTargetIndex;
    do {
        appendTargetWithLesserDepth(m_path[i], currentDepthAllowed);
    } while (i--);
    path.reverse();

    currentDepthAllowed = currentTargetDepth;
    for (auto i = currentTargetIndex + 1; i < pathSize; ++i)
        appendTargetWithLesserDepth(m_path[i], currentDepthAllowed);

    return path;
}

EventPath::EventPath(std::span<EventTarget* const> targets)
{
    m_path = WTF::map(targets, [&](auto* target) {
        ASSERT(target);
        ASSERT(!is<Node>(target));
        return EventContext { EventContext::Type::Normal, nullptr, target, *targets.begin(), 0 };
    });
}

EventPath::EventPath(EventTarget& target)
{
    m_path = { EventContext { EventContext::Type::Normal, nullptr, &target, &target, 0 } };
}

static Node* LEGACY_NODELETE moveOutOfAllShadowRoots(Node& startingNode)
{
    auto* node = &startingNode;
    while (node && node->isInShadowTree())
        node = downcast<ShadowRoot>(node->rootNode()).host();
    return node;
}

RelatedNodeRetargeter::RelatedNodeRetargeter(Ref<Node>&& relatedNode, Node& target)
    : m_relatedNode(WTF::move(relatedNode))
    , m_retargetedRelatedNode(m_relatedNode.copyRef())
{
    Ref targetTreeScope = target.treeScope();
    RefPtr currentTreeScope = m_relatedNode->treeScope();
    if (currentTreeScope == targetTreeScope.ptr() && target.isConnected() && m_relatedNode->isConnected()) [[likely]]
        return;

    if (&currentTreeScope->documentScope() != &targetTreeScope->documentScope()
        || (m_relatedNode->hasBeenInUserAgentShadowTree() && !m_relatedNode->isConnected())) {
        m_hasDifferentTreeRoot = true;
        m_retargetedRelatedNode = nullptr;
        return;
    }
    if (m_relatedNode->isConnected() != target.isConnected()) {
        m_hasDifferentTreeRoot = true;
        m_retargetedRelatedNode = moveOutOfAllShadowRoots(m_relatedNode.copyRef());
        return;
    }

    collectTreeScopes();

    // FIXME: We should collect this while constructing the event path.
    Vector<Ref<TreeScope>, 8> targetTreeScopeAncestors;
    for (RefPtr currentTreeScope = targetTreeScope.ptr(); currentTreeScope; currentTreeScope = currentTreeScope->parentTreeScope())
        targetTreeScopeAncestors.append(*currentTreeScope);
    ASSERT_WITH_SECURITY_IMPLICATION(!targetTreeScopeAncestors.isEmpty());

    unsigned i = m_ancestorTreeScopes.size();
    unsigned j = targetTreeScopeAncestors.size();
    ASSERT_WITH_SECURITY_IMPLICATION(m_ancestorTreeScopes.last().ptr() == targetTreeScopeAncestors.last().ptr());
    while (m_ancestorTreeScopes[i - 1].ptr() == targetTreeScopeAncestors[j - 1].ptr()) {
        i--;
        j--;
        if (!i || !j)
            break;
    }

    bool lowestCommonAncestorIsDocumentScope = i + 1 == m_ancestorTreeScopes.size();
    if (lowestCommonAncestorIsDocumentScope && !m_relatedNode->isConnected() && !target.isConnected()) {
        CheckedRef relatedNodeAncestorInDocumentScope = i ? *downcast<ShadowRoot>(m_ancestorTreeScopes[i - 1]->rootNode()).shadowHost() : m_relatedNode.get();
        CheckedRef targetAncestorInDocumentScope = j ? *downcast<ShadowRoot>(targetTreeScopeAncestors[j - 1]->rootNode()).shadowHost() : target;
        if (&targetAncestorInDocumentScope->rootNode() != &relatedNodeAncestorInDocumentScope->rootNode()) {
            m_hasDifferentTreeRoot = true;
            m_retargetedRelatedNode = moveOutOfAllShadowRoots(m_relatedNode);
            return;
        }
    }

    m_lowestCommonAncestorIndex = i;
    m_retargetedRelatedNode = nodeInLowestCommonAncestor();
}

inline Node* LEGACY_NODELETE RelatedNodeRetargeter::currentNode(Node& currentTarget)
{
    checkConsistency(currentTarget);
    return m_retargetedRelatedNode.get();
}

void RelatedNodeRetargeter::moveToNewTreeScope(TreeScope* previousTreeScope, TreeScope& newTreeScope)
{
    if (m_hasDifferentTreeRoot)
        return;

    Ref currentRelatedNodeScope = m_retargetedRelatedNode->treeScope();
    if (previousTreeScope != currentRelatedNodeScope.ptr()) {
        // currentRelatedNode is still outside our shadow tree. New tree scope may contain currentRelatedNode
        // but there is no need to re-target it. Moving into a slot (thereby a deeper shadow tree) doesn't matter.
        return;
    }

    bool enteredSlot = newTreeScope.parentTreeScope() == previousTreeScope;
    if (enteredSlot) {
        if (m_lowestCommonAncestorIndex) {
            if (m_ancestorTreeScopes.isEmpty())
                collectTreeScopes();
            bool relatedNodeIsInSlot = m_ancestorTreeScopes[m_lowestCommonAncestorIndex - 1].ptr() == &newTreeScope;
            if (relatedNodeIsInSlot) {
                m_lowestCommonAncestorIndex--;
                m_retargetedRelatedNode = nodeInLowestCommonAncestor();
                ASSERT(&newTreeScope == &m_retargetedRelatedNode->treeScope());
            }
        } else
            ASSERT(m_retargetedRelatedNode == m_relatedNode.ptr());
    } else {
        ASSERT(previousTreeScope->parentTreeScope() == &newTreeScope);
        m_lowestCommonAncestorIndex++;
        ASSERT_WITH_SECURITY_IMPLICATION(m_ancestorTreeScopes.isEmpty() || m_lowestCommonAncestorIndex < m_ancestorTreeScopes.size());
        m_retargetedRelatedNode = downcast<ShadowRoot>(currentRelatedNodeScope->rootNode()).host();
        ASSERT(&newTreeScope == &m_retargetedRelatedNode->treeScope());
    }
}

inline Node* LEGACY_NODELETE RelatedNodeRetargeter::nodeInLowestCommonAncestor()
{
    if (!m_lowestCommonAncestorIndex)
        return m_relatedNode.ptr();
    auto& rootNode = m_ancestorTreeScopes[m_lowestCommonAncestorIndex - 1]->rootNode();
    return downcast<ShadowRoot>(rootNode).host();
}

void RelatedNodeRetargeter::collectTreeScopes()
{
    ASSERT(m_ancestorTreeScopes.isEmpty());
    for (RefPtr currentTreeScope = &m_relatedNode->treeScope(); currentTreeScope; currentTreeScope = currentTreeScope->parentTreeScope())
        m_ancestorTreeScopes.append(*currentTreeScope);
    ASSERT_WITH_SECURITY_IMPLICATION(!m_ancestorTreeScopes.isEmpty());
}

#if !ASSERT_ENABLED

inline void LEGACY_NODELETE RelatedNodeRetargeter::checkConsistency(Node&)
{
}

#else // ASSERT_ENABLED

void RelatedNodeRetargeter::checkConsistency(Node& currentTarget)
{
    if (!m_retargetedRelatedNode)
        return;
    ASSERT(!currentTarget.isClosedShadowHidden(*m_retargetedRelatedNode));
    ASSERT(m_retargetedRelatedNode == currentTarget.treeScope().retargetToScope(m_relatedNode.get()).ptr());
}

#endif // ASSERT_ENABLED

}
