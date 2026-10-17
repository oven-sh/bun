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

#include "HTMLElement.h"

namespace WebCore {

class HTMLSlotElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLSlotElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLSlotElement);
public:
    using ElementOrText = Variant<Ref<Element>, Ref<Text>>;

    static Ref<HTMLSlotElement> create(const QualifiedName&, Document&);

    const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* assignedNodes() const;
    struct AssignedNodesOptions {
        bool flatten;
    };
    Vector<Ref<Node>> assignedNodes(const AssignedNodesOptions&) const;
    Vector<Ref<Element>> assignedElements(const AssignedNodesOptions&) const;

    void assign(FixedVector<ElementOrText>&&);
    const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& manuallyAssignedNodes() const LIFETIME_BOUND { return m_manuallyAssignedNodes; }
    void removeManuallyAssignedNode(Node&);

    void enqueueSlotChangeEvent();
    void didRemoveFromSignalSlotList() { m_inSignalSlotList = false; }

    void dispatchSlotChangeEvent();

    bool isInInsertedIntoAncestor() const { return m_isInInsertedIntoAncestor; }

private:
    HTMLSlotElement(const QualifiedName&, Document&);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void removingSteps(RemovalType, ContainerNode&) final;
    void childrenChanged(const ChildChange&) final;
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    void postConnectionSteps() final;

    bool m_inSignalSlotList { false };
    bool m_isInInsertedIntoAncestor { false };
    Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>> m_manuallyAssignedNodes;
};

} // namespace WebCore
