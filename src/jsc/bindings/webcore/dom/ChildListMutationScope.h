/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
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

#include "ContainerNode.h"
#include "Document.h"
#include "MutationObserverOptions.h"
#include "NodeDocument.h"
#include <memory>
#include <wtf/Noncopyable.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class MutationObserverInterestGroup;

// ChildListMutationAccumulator is not meant to be used directly; ChildListMutationScope is the public interface.
class ChildListMutationAccumulator : public RefCounted<ChildListMutationAccumulator>, public CanMakeSingleThreadWeakPtr<ChildListMutationAccumulator> {
public:
    static Ref<ChildListMutationAccumulator> getOrCreate(ContainerNode&);
    ~ChildListMutationAccumulator();

    void childAdded(Node&);
    void willRemoveChild(Node&);

    bool hasObservers() const { return !!m_observers; }

private:
    ChildListMutationAccumulator(ContainerNode&, std::unique_ptr<MutationObserverInterestGroup>);

    void enqueueMutationRecord();
    bool LEGACY_NODELETE isEmpty();
    bool LEGACY_NODELETE isAddedNodeInOrder(Node&);
    bool LEGACY_NODELETE isRemovedNodeInOrder(Node&);

    const Ref<ContainerNode> m_target;

    Vector<Ref<Node>> m_removedNodes;
    Vector<Ref<Node>> m_addedNodes;
    RefPtr<Node> m_previousSibling;
    RefPtr<Node> m_nextSibling;
    WeakPtr<Node, WeakPtrImplWithEventTargetData> m_lastAdded;

    const std::unique_ptr<MutationObserverInterestGroup> m_observers;
};

struct ChildListMutationAccumulators {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(ChildListMutationAccumulators);
    HashMap<WeakRef<ContainerNode, WeakPtrImplWithEventTargetData>, SingleThreadWeakRef<ChildListMutationAccumulator>> map;
};

class ChildListMutationScope {
    WTF_MAKE_NONCOPYABLE(ChildListMutationScope);
public:
    explicit ChildListMutationScope(ContainerNode& target)
    {
        if (target.document().hasMutationObserversOfType(MutationObserverOptionType::ChildList))
            lazyInitialize(m_accumulator, ChildListMutationAccumulator::getOrCreate(target));
    }

    bool canObserve() const { return m_accumulator; }

    void childAdded(Node& child)
    {
        if (m_accumulator && m_accumulator->hasObservers())
            m_accumulator->childAdded(child);
    }

    void willRemoveChild(Node& child)
    {
        if (m_accumulator && m_accumulator->hasObservers())
            m_accumulator->willRemoveChild(child);
    }

private:
    const RefPtr<ChildListMutationAccumulator> m_accumulator;
};

} // namespace WebCore
