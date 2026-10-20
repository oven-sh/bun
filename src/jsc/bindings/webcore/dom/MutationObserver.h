/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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

#include "GCReachableRef.h"
#include "MutationObserverOptions.h"
#include "ScriptWrappable.h"
#include <wtf/Forward.h>
#include <wtf/HashSet.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/WeakHashSet.h>

namespace JSC {
class AbstractSlotVisitor;
}

namespace WebCore {

class Document;
class HTMLSlotElement;
class MutationCallback;
class MutationObserverRegistration;
class MutationRecord;
class Node;
template<typename> class ExceptionOr;

class MutationObserver final : public ScriptWrappable, public RefCounted<MutationObserver> {
    WTF_MAKE_TZONE_ALLOCATED(MutationObserver);
public:
    static Ref<MutationObserver> create(Ref<MutationCallback>&&);

    ~MutationObserver();

    struct Init {
        bool childList;
        std::optional<bool> attributes;
        std::optional<bool> characterData;
        bool subtree;
        std::optional<bool> attributeOldValue;
        std::optional<bool> characterDataOldValue;
        std::optional<Vector<AtomString>> attributeFilter;
    };

    ExceptionOr<void> observe(Node&, const Init&);
    
    struct TakenRecords {
        Vector<Ref<MutationRecord>> records;
        HashSet<GCReachableRef<Node>> pendingTargets;
    };
    TakenRecords takeRecords();
    void disconnect();

    void observationStarted(MutationObserverRegistration&);
    void observationEnded(MutationObserverRegistration&);
    void enqueueMutationRecord(Ref<MutationRecord>&&);
    void setHasTransientRegistration(Document&);
    bool canDeliver();

    bool isReachableFromOpaqueRoots(JSC::AbstractSlotVisitor&) const;

    MutationCallback& callback() const { return m_callback.get(); }

    static void enqueueSlotChangeEvent(HTMLSlotElement&);

    static void notifyMutationObservers();

    using OptionType = MutationObserverOptionType;

    static constexpr MutationObserverOptions AllMutationTypes { OptionType::ChildList, OptionType::Attributes, OptionType::CharacterData };
    static constexpr MutationObserverOptions AllDeliveryFlags { OptionType::AttributeOldValue, OptionType::CharacterDataOldValue };

private:
    explicit MutationObserver(Ref<MutationCallback>&&);
    void deliver();

    static void queueCompoundMicrotask(Document&);

    static bool LEGACY_NODELETE validateOptions(MutationObserverOptions);

    const Ref<MutationCallback> m_callback;
    Vector<Ref<MutationRecord>> m_records;
    HashSet<GCReachableRef<Node>> m_pendingTargets;
    WeakHashSet<MutationObserverRegistration> m_registrations;
    unsigned m_priority;
};

// What https://dom.spec.whatwg.org/#mutation-observers keeps per agent.
struct MutationObserverAgentData {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(MutationObserverAgentData);

    HashSet<Ref<MutationObserver>> activeObservers;
    Vector<GCReachableRef<HTMLSlotElement>> signalSlotList;
    unsigned nextPriority { 0 };
    bool compoundMicrotaskQueued { false };
    bool deliveringRecords { false }; // FIXME: This flag doesn't exist in the spec.
};

} // namespace WebCore
