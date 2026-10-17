/*
 * Copyright (C) 2015-2024 Apple Inc. All rights reserved.
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
#include "SlotAssignment.h"

#include "ElementInlines.h"
#include "HTMLSlotElement.h"
#include "ShadowRoot.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SlotAssignment);
WTF_MAKE_TZONE_ALLOCATED_IMPL(NamedSlotAssignment);
WTF_MAKE_TZONE_ALLOCATED_IMPL(NamedSlotAssignment::Slot);

using namespace HTMLNames;

struct SameSizeAsNamedSlotAssignment {
    virtual ~SameSizeAsNamedSlotAssignment() = default;
    uint32_t values[4];
    HashMap<void*, void*> pointer;
#if ASSERT_ENABLED
    WeakHashSet<Element> hashSet;
#endif
};

static_assert(sizeof(NamedSlotAssignment) == sizeof(SameSizeAsNamedSlotAssignment), "NamedSlotAssignment should remain small");

static const AtomString& LEGACY_NODELETE slotNameFromAttributeValue(const AtomString& value)
{
    return value == nullAtom() ? NamedSlotAssignment::defaultSlotName() : value;
}

static const AtomString& LEGACY_NODELETE slotNameFromSlotAttribute(const Node& child)
{
    if (is<Text>(child))
        return NamedSlotAssignment::defaultSlotName();

    return slotNameFromAttributeValue(downcast<Element>(child).attributeWithoutSynchronization(slotAttr));
}

#if ASSERT_ENABLED
static HTMLSlotElement* findSlotElement(ShadowRoot& shadowRoot, const AtomString& slotName)
{
    for (auto& slotElement : descendantsOfType<HTMLSlotElement>(shadowRoot)) {
        if (slotNameFromAttributeValue(slotElement.attributeWithoutSynchronization(nameAttr)) == slotName)
            return &slotElement;
    }
    return nullptr;
}
#endif // ASSERT_ENABLED

static HTMLSlotElement* nextSlotElementSkippingSubtree(ContainerNode& startingNode, ContainerNode* skippedSubtree)
{
    auto nextNode = [&](Node& node) {
        if (&node == skippedSubtree) [[unlikely]]
            return NodeTraversal::nextSkippingChildren(node);
        return NodeTraversal::next(node);
    };
    for (auto* node = nextNode(startingNode); node; node = nextNode(*node)) {
        if (auto* slotElement = dynamicDowncast<HTMLSlotElement>(*node))
            return slotElement;
    }
    return nullptr;
}

NamedSlotAssignment::NamedSlotAssignment() = default;

NamedSlotAssignment::~NamedSlotAssignment() = default;

HTMLSlotElement* NamedSlotAssignment::findAssignedSlot(const Node& node)
{
    if (!is<Text>(node) && !is<Element>(node))
        return nullptr;

    auto* slot = m_slots.get(slotNameForHostChild(node));
    if (!slot)
        return nullptr;

    return findFirstSlotElement(*slot);
}

inline bool NamedSlotAssignment::hasAssignedNodes(ShadowRoot& shadowRoot, Slot& slot)
{
    if (!m_slotAssignmentsIsValid)
        assignSlots(shadowRoot);
    return !slot.assignedNodes.isEmpty();
}

void NamedSlotAssignment::renameSlotElement(HTMLSlotElement& slotElement, const AtomString& oldName, const AtomString& newName, ShadowRoot& shadowRoot)
{
    ASSERT(m_slotElementsForConsistencyCheck.contains(slotElement));

    m_slotMutationVersion++;

    removeSlotElementByName(oldName, slotElement, nullptr, shadowRoot);
    addSlotElementByName(newName, slotElement, shadowRoot);
}

void NamedSlotAssignment::addSlotElementByName(const AtomString& name, HTMLSlotElement& slotElement, ShadowRoot& shadowRoot)
{
#if ASSERT_ENABLED
    ASSERT(!m_slotElementsForConsistencyCheck.contains(slotElement));
    m_slotElementsForConsistencyCheck.add(slotElement);
#endif

    ASSERT(shadowRoot.host());
    Ref shadowRootHost = *shadowRoot.host();

    if (!m_slotElementCount)
        shadowRootHost->setHasShadowRootContainingSlots(true);
    m_slotElementCount++;

    auto& slotName = slotNameFromAttributeValue(name);
    auto addResult = m_slots.ensure(slotName, [&] {
        m_slotAssignmentsIsValid = false;
        return makeUnique<Slot>();
    });
    auto& slot = *addResult.iterator->value;

    if (!m_slotAssignmentsIsValid)
        assignSlots(shadowRoot);

    slot.elementCount++;
    if (slot.elementCount == 1) {
        slot.element = slotElement;
        if (shadowRoot.shouldFireSlotchangeEvent() && hasAssignedNodes(shadowRoot, slot))
            slotElement.enqueueSlotChangeEvent();
        return;
    }

    resolveSlotsAfterSlotMutation(shadowRoot, SlotMutationType::Insertion);
}

void NamedSlotAssignment::removeSlotElementByName(const AtomString& name, HTMLSlotElement& slotElement, ContainerNode* oldParentOfRemovedTreeForRemoval, ShadowRoot& shadowRoot)
{
#if ASSERT_ENABLED
    ASSERT(m_slotElementsForConsistencyCheck.contains(slotElement));
    m_slotElementsForConsistencyCheck.remove(slotElement);
#endif

    ASSERT(m_slotElementCount > 0);
    m_slotElementCount--;

    if (RefPtr host = shadowRoot.host()) {
        if (!m_slotElementCount)
            host->setHasShadowRootContainingSlots(false);
    }

    auto* slot = m_slots.get(slotNameFromAttributeValue(name));
    RELEASE_ASSERT(slot && slot->hasSlotElements());

    slot->elementCount--;
    if (!slot->elementCount) {
        slot->element = nullptr;
        bool hasNotResolvedAllSlots = m_slotResolutionVersion != m_slotMutationVersion;
        if (shadowRoot.shouldFireSlotchangeEvent() && hasAssignedNodes(shadowRoot, *slot) && hasNotResolvedAllSlots)
            slotElement.enqueueSlotChangeEvent();
        return;
    }

    bool elementWasRenamed = !oldParentOfRemovedTreeForRemoval;
    if (elementWasRenamed && slot->element == &slotElement)
        slotElement.enqueueSlotChangeEvent();

    if (slot->element) {
        resolveSlotsAfterSlotMutation(shadowRoot, elementWasRenamed ? SlotMutationType::Insertion : SlotMutationType::Removal,
            m_willBeRemovingAllChildren ? oldParentOfRemovedTreeForRemoval : nullptr);
    } else {
        // A previous invocation to resolveSlotsAfterSlotMutation during this removal has updated this slot.
        ASSERT(m_slotResolutionVersion == m_slotMutationVersion && !findSlotElement(shadowRoot, name));
    }

    if (slot->oldElement == &slotElement) {
        ASSERT(shadowRoot.shouldFireSlotchangeEvent());
        slotElement.enqueueSlotChangeEvent();
        slot->oldElement = nullptr;
    }
}

void NamedSlotAssignment::resolveSlotsAfterSlotMutation(ShadowRoot& shadowRoot, SlotMutationType mutationType, ContainerNode* subtreeToSkip)
{
    if (m_slotResolutionVersion == m_slotMutationVersion)
        return;
    m_slotResolutionVersion = m_slotMutationVersion;

    ASSERT(!subtreeToSkip || mutationType == SlotMutationType::Removal);

    for (auto& slot : m_slots.values())
        slot->seenFirstElement = false;

    unsigned slotCount = 0;
    RefPtr currentElement = nextSlotElementSkippingSubtree(shadowRoot, subtreeToSkip);
    for (; currentElement; currentElement = nextSlotElementSkippingSubtree(*currentElement, subtreeToSkip)) {
        auto& currentSlotName = slotNameFromAttributeValue(currentElement->attributeWithoutSynchronization(nameAttr));
        auto* currentSlot = m_slots.get(currentSlotName);
        if (!currentSlot) {
            // A new slot may have been inserted with this node but appears later in the tree order.
            // Such a slot would go through the fast path in addSlotElementByName,
            // and any subsequently inserted slot of the same name would not result in any slotchange or invokation of this function.
            ASSERT(mutationType == SlotMutationType::Insertion);
            continue;
        }
        if (currentSlot->seenFirstElement) {
            if (mutationType == SlotMutationType::Insertion && currentSlot->oldElement == currentElement.get()) {
                ASSERT(shadowRoot.shouldFireSlotchangeEvent());
                currentElement->enqueueSlotChangeEvent();
                currentSlot->oldElement = nullptr;
            }
            continue;
        }
        currentSlot->seenFirstElement = true;
        slotCount++;
        if (currentSlot->element != currentElement.get()) {
            if (shadowRoot.shouldFireSlotchangeEvent() && hasAssignedNodes(shadowRoot, *currentSlot)) {
                currentSlot->oldElement = WTF::move(currentSlot->element);
                currentElement->enqueueSlotChangeEvent();
            }
            currentSlot->element = *currentElement;
        }
    }

    if (slotCount == m_slots.size())
        return;

    if (mutationType == SlotMutationType::Insertion) {
        // This code path is taken only when continue above for !currentSlot is taken.
        // i.e. there is a new slot being inserted into the tree but we have yet to invoke addSlotElementByName on it.
#if ASSERT_ENABLED
        for (auto& entry : m_slots)
            ASSERT(entry.value->seenFirstElement || !findSlotElement(shadowRoot, entry.key));
#endif
        return;
    }

    if (!m_slotAssignmentsIsValid)
        assignSlots(shadowRoot);

    for (auto& slot : m_slots.values()) {
        if (slot->seenFirstElement)
            continue;
        if (!slot->elementCount) {
            // Taken the fast path for removal.
            ASSERT(!slot->element);
            continue;
        }
        // All slot elements have been removed for this slot.
        slot->seenFirstElement = true;
        ASSERT(slot->element);
        if (!slot->assignedNodes.isEmpty())
            slot->oldElement = WTF::move(slot->element);
        slot->element = nullptr;
    }
}

void NamedSlotAssignment::slotManualAssignmentDidChange(HTMLSlotElement&, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>&, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>&, ShadowRoot&)
{
}

void NamedSlotAssignment::didRemoveManuallyAssignedNode(HTMLSlotElement&, const Node&, ShadowRoot&)
{
}

void NamedSlotAssignment::slotFallbackDidChange(HTMLSlotElement& slotElement, ShadowRoot& shadowRoot)
{
    if (shadowRoot.mode() == ShadowRootMode::UserAgent)
        return;

    bool usesFallbackContent = !assignedNodesForSlot(slotElement, shadowRoot);
    if (usesFallbackContent)
        slotElement.enqueueSlotChangeEvent();
}

void NamedSlotAssignment::didChangeSlot(const AtomString& slotAttrValue, ShadowRoot& shadowRoot)
{
    auto& slotName = slotNameFromAttributeValue(slotAttrValue);
    auto* slot = m_slots.get(slotName);
    if (!slot)
        return;

    slot->assignedNodes.clear();
    m_slotAssignmentsIsValid = false;

    if (RefPtr slotElement = findFirstSlotElement(*slot)) {
        if (shadowRoot.shouldFireSlotchangeEvent())
            slotElement->enqueueSlotChangeEvent();

        if (slotElement->selfOrPrecedingNodesAffectDirAuto())
            slotElement->updateEffectiveTextDirection();
    }
}

void NamedSlotAssignment::didRemoveAllChildrenOfShadowHost(ShadowRoot& shadowRoot)
{
    didChangeSlot(nullAtom(), shadowRoot); // FIXME: This is incorrect when there were no elements or text nodes removed.
}

void NamedSlotAssignment::didMutateTextNodesOfShadowHost(ShadowRoot& shadowRoot)
{
    didChangeSlot(nullAtom(), shadowRoot);
}

void NamedSlotAssignment::hostChildElementDidChange(const Element& childElement, ShadowRoot& shadowRoot)
{
    didChangeSlot(childElement.attributeWithoutSynchronization(slotAttr), shadowRoot);
}

void NamedSlotAssignment::hostChildElementDidChangeSlotAttribute(Element&, const AtomString& oldValue, const AtomString& newValue, ShadowRoot& shadowRoot)
{
    didChangeSlot(oldValue, shadowRoot);
    didChangeSlot(newValue, shadowRoot);
}

const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* NamedSlotAssignment::assignedNodesForSlot(const HTMLSlotElement& slotElement, ShadowRoot& shadowRoot)
{
    ASSERT(slotElement.containingShadowRoot() == &shadowRoot);
    const AtomString& slotName = slotNameFromAttributeValue(slotElement.attributeWithoutSynchronization(nameAttr));
    auto* slot = m_slots.get(slotName);

    bool hasNotAddedSlotInInsertedIntoAncestorYet = shadowRoot.isConnected() && (!slotElement.isConnected() || slotElement.isInInsertedIntoAncestor());
    if (hasNotAddedSlotInInsertedIntoAncestorYet)
        return nullptr;
    RELEASE_ASSERT(slot);

    if (!m_slotAssignmentsIsValid)
        assignSlots(shadowRoot);

    if (slot->assignedNodes.isEmpty())
        return nullptr;

    RELEASE_ASSERT(slot->hasSlotElements());
    if (slot->hasDuplicatedSlotElements() && findFirstSlotElement(*slot) != &slotElement)
        return nullptr;

    return &slot->assignedNodes;
}

void NamedSlotAssignment::willRemoveAssignedNode(Node& node, ShadowRoot&)
{
    if (!m_slotAssignmentsIsValid)
        return;

    if (!is<Text>(node) && !is<Element>(node))
        return;

    auto* slot = m_slots.get(slotNameForHostChild(node));
    if (!slot || slot->assignedNodes.isEmpty())
        return;

    slot->assignedNodes.removeFirstMatching([&node](const auto& item) {
        return item.get() == &node;
    });
}

const AtomString& LEGACY_NODELETE NamedSlotAssignment::slotNameForHostChild(const Node& child) const
{
    return slotNameFromSlotAttribute(child);
}

HTMLSlotElement* NamedSlotAssignment::findFirstSlotElement(Slot& slot)
{
    ASSERT(!slot.element || m_slotElementsForConsistencyCheck.contains(*slot.element));

    return slot.element.get();
}

void NamedSlotAssignment::assignSlots(ShadowRoot& shadowRoot)
{
    ASSERT(!m_slotAssignmentsIsValid);
    m_slotAssignmentsIsValid = true;

    for (auto& entry : m_slots)
        entry.value->assignedNodes.clear();

    if (RefPtr host = shadowRoot.host()) {
        for (RefPtr child = host->firstChild(); child; child = child->nextSibling()) {
            if (!is<Text>(*child) && !is<Element>(*child))
                continue;
            auto slotName = slotNameForHostChild(*child);
            assignToSlot(*child, slotName);
        }
    }

    for (auto& entry : m_slots)
        entry.value->assignedNodes.shrinkToFit();
}

void NamedSlotAssignment::assignToSlot(Node& child, const AtomString& slotName)
{
    ASSERT(!slotName.isNull());
    if (slotName == defaultSlotName()) {
        auto defaultSlotEntry = m_slots.find(defaultSlotName());
        if (defaultSlotEntry != m_slots.end())
            defaultSlotEntry->value->assignedNodes.append(child);
    } else {
        auto addResult = m_slots.ensure(slotName, [] {
            return makeUnique<Slot>();
        });
        addResult.iterator->value->assignedNodes.append(child);
    }
}

HTMLSlotElement* ManualSlotAssignment::findAssignedSlot(const Node& node)
{
    auto* slot = node.manuallyAssignedSlot();
    if (!slot)
        return nullptr;
    auto* containingShadowRoot = slot->containingShadowRoot();
    return containingShadowRoot && containingShadowRoot->host() == node.parentNode() ? slot : nullptr;
}

static Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>> effectiveAssignedNodes(ShadowRoot& shadowRoot, const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& manuallyAssingedNodes)
{
    return WTF::compactMap(manuallyAssingedNodes, [&](auto& node) -> std::optional<WeakPtr<Node, WeakPtrImplWithEventTargetData>> {
        if (!node || node->parentNode() != shadowRoot.host())
            return std::nullopt;
        return WeakPtr { node.get() };
    });
}

const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* ManualSlotAssignment::assignedNodesForSlot(const HTMLSlotElement& slot, ShadowRoot& shadowRoot)
{
    auto addResult = m_slots.ensure(slot, []() {
        return Slot { };
    });
    if (addResult.isNewEntry || addResult.iterator->value.cachedVersion != m_slottableVersion) {
        addResult.iterator->value.cachedAssignment = effectiveAssignedNodes(shadowRoot, slot.manuallyAssignedNodes());
        addResult.iterator->value.cachedVersion = m_slottableVersion;
    }
    auto& cachedAssignment = addResult.iterator->value.cachedAssignment;
    return cachedAssignment.size() ? &cachedAssignment : nullptr;
}

void ManualSlotAssignment::renameSlotElement(HTMLSlotElement&, const AtomString&, const AtomString&, ShadowRoot&)
{
}

void ManualSlotAssignment::addSlotElementByName(const AtomString&, HTMLSlotElement& slot, ShadowRoot& shadowRoot)
{
    if (!m_slotElementCount)
        shadowRoot.host()->setHasShadowRootContainingSlots(true);
    ++m_slotElementCount;
    ++m_slottableVersion;

    if (!shadowRoot.shouldFireSlotchangeEvent())
        return;

    if (assignedNodesForSlot(slot, shadowRoot))
        slot.enqueueSlotChangeEvent();
}

void ManualSlotAssignment::removeSlotElementByName(const AtomString&, HTMLSlotElement& slot, ContainerNode*, ShadowRoot& shadowRoot)
{
    RELEASE_ASSERT(m_slotElementCount);
    --m_slotElementCount;
    ++m_slottableVersion;

    if (auto* host = shadowRoot.host()) {
        if (!m_slotElementCount)
            host->setHasShadowRootContainingSlots(false);
    }

    if (!shadowRoot.shouldFireSlotchangeEvent())
        return;

    for (auto& node : slot.manuallyAssignedNodes()) {
        if (node && node->parentNode() == shadowRoot.host()) {
            slot.enqueueSlotChangeEvent();
            break;
        }
    }
}

void ManualSlotAssignment::slotManualAssignmentDidChange(HTMLSlotElement& slot, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& previous, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& current, ShadowRoot& shadowRoot)
{
    auto effectivePrevious = effectiveAssignedNodes(shadowRoot, previous);
    HashSet<Ref<HTMLSlotElement>> affectedSlots;
    for (auto& node : current) {
        RefPtr protectedNode = node.get();
        if (RefPtr previousSlot = protectedNode->manuallyAssignedSlot()) {
            previousSlot->removeManuallyAssignedNode(*protectedNode);
            RefPtr shadowRootOfPreviousSlot = previousSlot->containingShadowRoot();
            // FIXME: It's odd that slotchange event is enqueued in the tree order for other slots in the same shadow tree.
            if (shadowRootOfPreviousSlot == &shadowRoot && protectedNode->parentNode() == shadowRoot.host())
                affectedSlots.add(*previousSlot);
            else if (shadowRootOfPreviousSlot && shadowRootOfPreviousSlot->host() == protectedNode->parentNode())
                shadowRootOfPreviousSlot->didRemoveManuallyAssignedNode(*previousSlot, *protectedNode);
        }
        protectedNode->setManuallyAssignedSlot(&slot);
    }

    ++m_slottableVersion;
    auto effectiveCurrent = effectiveAssignedNodes(shadowRoot, current);

    auto scheduleSlotChangeEventIfNeeded = [&]() {
        if (effectivePrevious.size() != effectiveCurrent.size()) {
            slot.enqueueSlotChangeEvent();
            return;
        }
        for (unsigned i = 0; i < effectivePrevious.size(); ++i) {
            if (effectivePrevious[i] != effectiveCurrent[i]) {
                slot.enqueueSlotChangeEvent();
                return;
            }
        }
    };

    if (!shadowRoot.shouldFireSlotchangeEvent())
        return;

    if (affectedSlots.isEmpty()) {
        scheduleSlotChangeEventIfNeeded();
        return;
    }
    for (Ref currentSlot : descendantsOfType<HTMLSlotElement>(shadowRoot)) {
        if (affectedSlots.contains(currentSlot))
            currentSlot->enqueueSlotChangeEvent();
        else if (currentSlot.ptr() == &slot)
            scheduleSlotChangeEventIfNeeded();
    }
}

void ManualSlotAssignment::didRemoveManuallyAssignedNode(HTMLSlotElement& slot, const Node& node, ShadowRoot& shadowRoot)
{
    ASSERT(slot.containingShadowRoot() == &shadowRoot);
    ASSERT_UNUSED(node, node.parentNode() == shadowRoot.host());
    ++m_slottableVersion;
    if (shadowRoot.shouldFireSlotchangeEvent())
        slot.enqueueSlotChangeEvent();
}

void ManualSlotAssignment::slotFallbackDidChange(HTMLSlotElement&, ShadowRoot&)
{
    ++m_slottableVersion;
}

void ManualSlotAssignment::hostChildElementDidChange(const Element&, ShadowRoot&)
{
    ++m_slottableVersion;
}

void ManualSlotAssignment::hostChildElementDidChangeSlotAttribute(Element&, const AtomString&, const AtomString&, ShadowRoot&)
{
}

void ManualSlotAssignment::willRemoveAssignedNode(Node& node, ShadowRoot& shadowRoot)
{
    ++m_slottableVersion;
    if (RefPtr slot = node.assignedSlot(); slot && slot->containingShadowRoot() == &shadowRoot && shadowRoot.shouldFireSlotchangeEvent())
        slot->enqueueSlotChangeEvent();
}

void ManualSlotAssignment::didRemoveAllChildrenOfShadowHost(ShadowRoot&)
{
    ++m_slottableVersion;
}

void ManualSlotAssignment::didMutateTextNodesOfShadowHost(ShadowRoot&)
{
    ++m_slottableVersion;
}

}


