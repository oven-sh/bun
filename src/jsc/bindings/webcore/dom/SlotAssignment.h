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

#include "ShadowRoot.h"
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/WeakHashMap.h>
#include <wtf/WeakHashSet.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/AtomStringHash.h>

namespace WebCore {

class Element;
class HTMLSlotElement;
class Node;

class SlotAssignment {
    WTF_MAKE_TZONE_ALLOCATED(SlotAssignment);
    WTF_MAKE_NONCOPYABLE(SlotAssignment);
public:
    SlotAssignment() = default;
    virtual ~SlotAssignment() = default;

    // These functions are only useful for NamedSlotAssignment but it's here to avoid virtual function calls in perf critical code paths.
    inline void resolveSlotsBeforeNodeInsertionOrRemoval();
    inline void willRemoveAllChildren();

    virtual HTMLSlotElement* LEGACY_NODELETE findAssignedSlot(const Node&) = 0;
    virtual const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* assignedNodesForSlot(const HTMLSlotElement&, ShadowRoot&) = 0;

    virtual void renameSlotElement(HTMLSlotElement&, const AtomString& oldName, const AtomString& newName, ShadowRoot&) = 0;
    virtual void addSlotElementByName(const AtomString&, HTMLSlotElement&, ShadowRoot&) = 0;
    virtual void removeSlotElementByName(const AtomString&, HTMLSlotElement&, ContainerNode* oldParentOfRemovedTreeForRemoval, ShadowRoot&) = 0;
    virtual void slotManualAssignmentDidChange(HTMLSlotElement&, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& previous, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& current, ShadowRoot&) = 0;
    virtual void didRemoveManuallyAssignedNode(HTMLSlotElement&, const Node&, ShadowRoot&) = 0;
    virtual void slotFallbackDidChange(HTMLSlotElement&, ShadowRoot&) = 0;

    virtual void hostChildElementDidChange(const Element&, ShadowRoot&) = 0;
    virtual void hostChildElementDidChangeSlotAttribute(Element&, const AtomString& oldValue, const AtomString& newValue, ShadowRoot&) = 0;

    virtual void willRemoveAssignedNode(Node&, ShadowRoot&) = 0;
    virtual void didRemoveAllChildrenOfShadowHost(ShadowRoot&) = 0;
    virtual void didMutateTextNodesOfShadowHost(ShadowRoot&) = 0;
    virtual void didChangeSlotNamesOfShadowHostChildren(ShadowRoot&) { }

protected:
    // These flags are used by NamedSlotAssignment but it's here to avoid virtual function calls in perf critical code paths.
    bool m_slotAssignmentsIsValid { false };
    bool m_willBeRemovingAllChildren { false };
    unsigned m_slotMutationVersion { 0 };
};

class NamedSlotAssignment : public SlotAssignment {
    WTF_MAKE_TZONE_ALLOCATED(NamedSlotAssignment);
    WTF_MAKE_NONCOPYABLE(NamedSlotAssignment);
public:
    NamedSlotAssignment();
    virtual ~NamedSlotAssignment();

    static const AtomString& defaultSlotName() { return emptyAtom(); }

protected:
    void didChangeSlot(const AtomString&, ShadowRoot&);

private:
    HTMLSlotElement* LEGACY_NODELETE findAssignedSlot(const Node&) final;

    void renameSlotElement(HTMLSlotElement&, const AtomString& oldName, const AtomString& newName, ShadowRoot&) final;
    void addSlotElementByName(const AtomString&, HTMLSlotElement&, ShadowRoot&) final;
    void removeSlotElementByName(const AtomString&, HTMLSlotElement&, ContainerNode* oldParentOfRemovedTreeForRemoval, ShadowRoot&) final;
    void slotManualAssignmentDidChange(HTMLSlotElement&, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& previous, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& current, ShadowRoot&) final;
    void didRemoveManuallyAssignedNode(HTMLSlotElement&, const Node&, ShadowRoot&) final;
    void slotFallbackDidChange(HTMLSlotElement&, ShadowRoot&) final;

    const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* assignedNodesForSlot(const HTMLSlotElement&, ShadowRoot&) final;
    void willRemoveAssignedNode(Node&, ShadowRoot&) final;

    void didRemoveAllChildrenOfShadowHost(ShadowRoot&) final;
    void didMutateTextNodesOfShadowHost(ShadowRoot&) final;
    void hostChildElementDidChange(const Element&, ShadowRoot&) override;
    void hostChildElementDidChangeSlotAttribute(Element&, const AtomString& oldValue, const AtomString& newValue, ShadowRoot&) final;

    struct Slot {
        WTF_MAKE_TZONE_ALLOCATED(Slot);
    public:
        bool hasSlotElements() { return !!elementCount; }
        bool hasDuplicatedSlotElements() { return elementCount > 1; }
        bool shouldResolveSlotElement() { return !element && elementCount; }

        WeakPtr<HTMLSlotElement, WeakPtrImplWithEventTargetData> element;
        WeakPtr<HTMLSlotElement, WeakPtrImplWithEventTargetData> oldElement; // Set by resolveSlotsAfterSlotMutation to dispatch slotchange in tree order.
        unsigned elementCount { 0 };
        bool seenFirstElement { false }; // Used in resolveSlotsAfterSlotMutation.
        Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>> assignedNodes;
    };

    bool hasAssignedNodes(ShadowRoot&, Slot&);
    enum class SlotMutationType { Insertion, Removal };
    void resolveSlotsAfterSlotMutation(ShadowRoot&, SlotMutationType, ContainerNode* oldParentOfRemovedTree = nullptr);

    virtual const AtomString& LEGACY_NODELETE slotNameForHostChild(const Node&) const;

    HTMLSlotElement* LEGACY_NODELETE findFirstSlotElement(Slot&);

    void assignSlots(ShadowRoot&);
    void assignToSlot(Node& child, const AtomString& slotName);

    unsigned m_slotResolutionVersion { 0 };
    unsigned m_slotElementCount { 0 };

    HashMap<AtomString, std::unique_ptr<Slot>> m_slots;

#if ASSERT_ENABLED
    WeakHashSet<HTMLSlotElement, WeakPtrImplWithEventTargetData> m_slotElementsForConsistencyCheck;
#endif
};

class ManualSlotAssignment : public SlotAssignment {
public:
    ManualSlotAssignment() = default;

    HTMLSlotElement* LEGACY_NODELETE findAssignedSlot(const Node&) final;

    const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* assignedNodesForSlot(const HTMLSlotElement&, ShadowRoot&) final;
    void renameSlotElement(HTMLSlotElement&, const AtomString&, const AtomString&, ShadowRoot&) final;
    void addSlotElementByName(const AtomString&, HTMLSlotElement&, ShadowRoot&) final;
    void removeSlotElementByName(const AtomString&, HTMLSlotElement&, ContainerNode*, ShadowRoot&) final;
    void slotManualAssignmentDidChange(HTMLSlotElement&, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& previous, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& current, ShadowRoot&) final;
    void didRemoveManuallyAssignedNode(HTMLSlotElement&, const Node&, ShadowRoot&) final;
    void slotFallbackDidChange(HTMLSlotElement&, ShadowRoot&) final;

    void hostChildElementDidChange(const Element&, ShadowRoot&) final;
    void hostChildElementDidChangeSlotAttribute(Element&, const AtomString&, const AtomString&, ShadowRoot&) final;

    void willRemoveAssignedNode(Node&, ShadowRoot&) final;
    void didRemoveAllChildrenOfShadowHost(ShadowRoot&) final;
    void didMutateTextNodesOfShadowHost(ShadowRoot&) final;

private:
    struct Slot {
        Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>> cachedAssignment;
        uint64_t cachedVersion { 0 };
    };
    WeakHashMap<HTMLSlotElement, Slot, WeakPtrImplWithEventTargetData> m_slots;
    uint64_t m_slottableVersion { 0 };
    unsigned m_slotElementCount { 0 };
};

inline HTMLSlotElement* ShadowRoot::findAssignedSlot(const Node& node)
{
    ASSERT(node.parentNode() == host());
    if (m_slotAssignment) [[unlikely]]
        return m_slotAssignment->findAssignedSlot(node);
    return nullptr;
}

inline void SlotAssignment::resolveSlotsBeforeNodeInsertionOrRemoval()
{
    m_slotMutationVersion++;
    m_willBeRemovingAllChildren = false;
}

inline void SlotAssignment::willRemoveAllChildren()
{
    m_slotMutationVersion++;
    m_willBeRemovingAllChildren = true;
}

inline void ShadowRoot::resolveSlotsBeforeNodeInsertionOrRemoval()
{
    if (m_slotAssignment) [[unlikely]]
        m_slotAssignment->resolveSlotsBeforeNodeInsertionOrRemoval();
}

inline void ShadowRoot::willRemoveAllChildren(ContainerNode&)
{
    if (m_slotAssignment) [[unlikely]]
        m_slotAssignment->willRemoveAllChildren();
}

inline void ShadowRoot::didRemoveAllChildrenOfShadowHost()
{
    if (m_slotAssignment) [[unlikely]]
        m_slotAssignment->didRemoveAllChildrenOfShadowHost(*this);
}

inline void ShadowRoot::didChangeSlotNamesOfShadowHostChildren()
{
    if (m_slotAssignment)
        m_slotAssignment->didChangeSlotNamesOfShadowHostChildren(*this);
}

inline void ShadowRoot::didMutateTextNodesOfShadowHost()
{
    if (m_slotAssignment) [[unlikely]]
        m_slotAssignment->didMutateTextNodesOfShadowHost(*this);
}

inline void ShadowRoot::hostChildElementDidChange(const Element& childElement)
{
    if (m_slotAssignment) [[unlikely]]
        m_slotAssignment->hostChildElementDidChange(childElement, *this);
}

inline void ShadowRoot::hostChildElementDidChangeSlotAttribute(Element& element, const AtomString& oldValue, const AtomString& newValue)
{
    if (!m_slotAssignment)
        return;
    m_slotAssignment->hostChildElementDidChangeSlotAttribute(element, oldValue, newValue, *this);
}

inline void ShadowRoot::willRemoveAssignedNode(Node& node)
{
    if (m_slotAssignment)
        m_slotAssignment->willRemoveAssignedNode(node, *this);
}

} // namespace WebCore
