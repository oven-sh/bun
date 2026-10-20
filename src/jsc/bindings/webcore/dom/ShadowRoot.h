/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2013-2024 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "DocumentFragment.h"
#include "Element.h"
#include "ShadowRootMode.h"
#include "SlotAssignmentMode.h"
#include "TreeScope.h"
#include <wtf/HashMap.h>

namespace WebCore {

class HTMLSlotElement;
class SlotAssignment;
class StyleSheetList;

enum class ParserContentPolicy : uint8_t;
enum class ShadowRootAvailableToElementInternals : bool { No, Yes };
enum class ShadowRootScopedCustomElementRegistry : bool { No, Yes };

struct GetHTMLOptions;

class ShadowRoot final : public DocumentFragment, public TreeScope {
    WTF_MAKE_TZONE_ALLOCATED(ShadowRoot);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(ShadowRoot);
public:

    enum class Clonable : bool { No, Yes };

    static Ref<ShadowRoot> create(Document& document, ShadowRootMode type, SlotAssignmentMode assignmentMode = SlotAssignmentMode::Named,
        ShadowRootDelegatesFocus delegatesFocus = ShadowRootDelegatesFocus::No, Clonable clonable = Clonable::No, ShadowRootSerializable serializable = ShadowRootSerializable::No, ShadowRootAvailableToElementInternals availableToElementInternals = ShadowRootAvailableToElementInternals::No,
        RefPtr<CustomElementRegistry>&& registry = nullptr, ShadowRootScopedCustomElementRegistry scopedRegistry = ShadowRootScopedCustomElementRegistry::No)
    {
        return adoptRef(*new ShadowRoot(document, type, assignmentMode, delegatesFocus, clonable, serializable, availableToElementInternals, WTF::move(registry), scopedRegistry));
    }

    static Ref<ShadowRoot> create(Document& document, std::unique_ptr<SlotAssignment>&& assignment)
    {
        return adoptRef(*new ShadowRoot(document, WTF::move(assignment)));
    }

    virtual ~ShadowRoot();

    using DocumentFragment::ref;
    using DocumentFragment::deref;

    using TreeScope::getElementById;
    using TreeScope::rootNode;

    bool delegatesFocus() const { return m_delegatesFocus; }
    bool containsFocusedElement() const { return m_containsFocusedElement; }
    void setContainsFocusedElement(bool flag) { m_containsFocusedElement = flag; }

    bool isClonable() const { return m_isClonable; }
    bool serializable() const { return m_serializable; }

    bool isAvailableToElementInternals() const { return m_availableToElementInternals; }
    void setIsAvailableToElementInternals(bool flag) { m_availableToElementInternals = flag; }
    bool isDeclarativeShadowRoot() const { return m_isDeclarativeShadowRoot; }
    void setIsDeclarativeShadowRoot(bool flag) { m_isDeclarativeShadowRoot = flag; }

    Element* host() const { return m_host; }
    inline void setHost(Element*); // Defined and only used in Element.cpp
    void setHost(WeakPtr<Element, WeakPtrImplWithEventTargetData>&& host) { m_host = WTF::move(host); }

    Node* shadowIncludingRoot() const { return m_shadowIncludingRoot; }
    inline void setShadowIncludingRoot(Node* root) { m_shadowIncludingRoot = root; }

    bool hasScopedCustomElementRegistry() const { return m_hasScopedCustomElementRegistry; }
    CustomElementRegistry* registryForBindings() const;

    ExceptionOr<void> setHTMLUnsafe(String&&);
    String getHTML(GetHTMLOptions&&) const;

    String innerHTML() const;
    ExceptionOr<void> setInnerHTML(String&&);

    Ref<Node> cloneNodeInternal(Document&, CloningOperation, CustomElementRegistry*) const override;

    Element* activeElement() const;

    StyleSheetList& styleSheets();

    ShadowRootMode mode() const { return m_mode; }
    bool shouldFireSlotchangeEvent() const { return m_mode != ShadowRootMode::UserAgent && !m_hasBegunDeletingDetachedChildren; }

    void removeAllEventListeners() override;

    SlotAssignmentMode slotAssignmentMode() const { return m_slotAssignmentMode; }
    inline HTMLSlotElement* LEGACY_NODELETE findAssignedSlot(const Node&); // Defined in SlotAssignment.h

    void renameSlotElement(HTMLSlotElement&, const AtomString& oldName, const AtomString& newName);
    void addSlotElementByName(const AtomString&, HTMLSlotElement&);
    void removeSlotElementByName(const AtomString&, HTMLSlotElement&, ContainerNode& oldParentOfRemovedTree);
    void slotManualAssignmentDidChange(HTMLSlotElement&, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& previous, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& current);
    void didRemoveManuallyAssignedNode(HTMLSlotElement&, const Node&);
    void slotFallbackDidChange(HTMLSlotElement&);
    inline void LEGACY_NODELETE resolveSlotsBeforeNodeInsertionOrRemoval(); // Defined in SlotAssignment.h
    inline void LEGACY_NODELETE willRemoveAllChildren(ContainerNode&); // Defined in SlotAssignment.h
    inline void willRemoveAssignedNode(Node&); // Defined in SlotAssignment.h

    inline void didRemoveAllChildrenOfShadowHost(); // Defined in SlotAssignment.h
    inline void didMutateTextNodesOfShadowHost(); // Defined in SlotAssignment.h
    inline void didChangeSlotNamesOfShadowHostChildren(); // Defined in SlotAssignment.h
    inline void hostChildElementDidChange(const Element&); // Defined in SlotAssignment.h
    inline void hostChildElementDidChangeSlotAttribute(Element&, const AtomString& oldValue, const AtomString& newValue); // Defined in SlotAssignment.h

    const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* assignedNodesForSlot(const HTMLSlotElement&);

    void moveShadowRootToNewParentScope(TreeScope&, Document&);
    void moveShadowRootToNewDocument(Document& oldDocument, Document& newDocument);

private:
    ShadowRoot(Document&, ShadowRootMode, SlotAssignmentMode, ShadowRootDelegatesFocus, Clonable, ShadowRootSerializable, ShadowRootAvailableToElementInternals, RefPtr<CustomElementRegistry>&&, ShadowRootScopedCustomElementRegistry);
    ShadowRoot(Document&, std::unique_ptr<SlotAssignment>&&);

    Node::NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) override;
    void removingSteps(RemovalType, ContainerNode& insertionPoint) override;

    ExceptionOr<void> replaceChildrenWithMarkup(const String&, OptionSet<ParserContentPolicy>);

    bool m_hasBegunDeletingDetachedChildren : 1 { false };
    bool m_delegatesFocus : 1 { false };
    bool m_isClonable : 1 { false };
    bool m_serializable : 1 { false };
    bool m_containsFocusedElement : 1 { false };
    bool m_availableToElementInternals : 1 { false };
    bool m_isDeclarativeShadowRoot : 1 { false };
    bool m_hasScopedCustomElementRegistry : 1 { false };
    ShadowRootMode m_mode { ShadowRootMode::UserAgent };
    SlotAssignmentMode m_slotAssignmentMode { SlotAssignmentMode::Named };

    WeakPtr<Element, WeakPtrImplWithEventTargetData> m_host;
    Node* m_shadowIncludingRoot { nullptr };

    const std::unique_ptr<SlotAssignment> m_slotAssignment;
    RefPtr<StyleSheetList> m_styleSheetList;
};

inline Element* ShadowRoot::activeElement() const
{
    return treeScope().focusedElementInScope();
}

inline bool hasShadowRootParent(const Node& node)
{
    return node.parentNode() && node.parentNode()->isShadowRoot();
}

Vector<Ref<ShadowRoot>> assignedShadowRootsIfSlotted(const Node&);

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ShadowRoot)
    static bool isType(const WebCore::Node& node) { return node.isShadowRoot(); }
SPECIALIZE_TYPE_TRAITS_END()
