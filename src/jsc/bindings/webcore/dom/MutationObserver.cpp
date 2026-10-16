/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2018-2022 Apple Inc. All rights reserved.
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

#include "config.h"

#include "MutationObserver.h"

#include "ContextDestructionObserverInlines.h"
#include "DOMClientData.h"
#include "Document.h"
#include "GCReachableRef.h"
#include "HTMLSlotElement.h"
#include "MutationCallback.h"
#include "MutationObserverRegistration.h"
#include "MutationRecord.h"
#include "NodeDocument.h"
#include <algorithm>
#include <ranges>
#include <wtf/RobinHoodHashSet.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MutationObserver);
WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(MutationObserverAgentData);

Ref<MutationObserver> MutationObserver::create(Ref<MutationCallback>&& callback)
{
    return adoptRef(*new MutationObserver(WTF::move(callback)));
}

MutationObserver::MutationObserver(Ref<MutationCallback>&& callback)
    : m_callback(WTF::move(callback))
    , m_priority(domClientData().mutationObserverAgentData().nextPriority++)
{
}

MutationObserver::~MutationObserver()
{
    ASSERT(m_registrations.isEmptyIgnoringNullReferences());
}

bool MutationObserver::validateOptions(MutationObserverOptions options)
{
    return options.containsAny(AllMutationTypes)
        && (options.contains(OptionType::Attributes) || !options.contains(OptionType::AttributeOldValue))
        && (options.contains(OptionType::Attributes) || !options.contains(OptionType::AttributeFilter))
        && (options.contains(OptionType::CharacterData) || !options.contains(OptionType::CharacterDataOldValue));
}

ExceptionOr<void> MutationObserver::observe(Node& node, const Init& init)
{
    MutationObserverOptions options;

    if (init.childList)
        options.add(OptionType::ChildList);
    if (init.subtree)
        options.add(OptionType::Subtree);
    if (init.attributeOldValue.value_or(false))
        options.add(OptionType::AttributeOldValue);
    if (init.characterDataOldValue.value_or(false))
        options.add(OptionType::CharacterDataOldValue);

    MemoryCompactLookupOnlyRobinHoodHashSet<AtomString> attributeFilter;
    if (init.attributeFilter) {
        for (auto& value : init.attributeFilter.value())
            attributeFilter.add(value);
        options.add(OptionType::AttributeFilter);
    }

    if (init.attributes ? init.attributes.value() : (init.attributeOldValue.has_value() || init.attributeFilter.has_value()))
        options.add(OptionType::Attributes);

    if (init.characterData ? init.characterData.value() : init.characterDataOldValue.has_value())
        options.add(OptionType::CharacterData);

    if (!validateOptions(options))
        return Exception { ExceptionCode::TypeError };

    node.registerMutationObserver(*this, options, attributeFilter);

    return { };
}

auto MutationObserver::takeRecords() -> TakenRecords
{
    return { WTF::move(m_records), WTF::move(m_pendingTargets) };
}

void MutationObserver::disconnect()
{
    m_pendingTargets.clear();
    m_records.clear();
    WeakHashSet registrations { m_registrations };
    for (Ref registration : registrations)
        protect(registration->node())->unregisterMutationObserver(registration.get());
}

void MutationObserver::observationStarted(MutationObserverRegistration& registration)
{
    ASSERT(!m_registrations.contains(registration));
    m_registrations.add(registration);
}

void MutationObserver::observationEnded(MutationObserverRegistration& registration)
{
    ASSERT(m_registrations.contains(registration));
    m_registrations.remove(registration);
}

void MutationObserver::enqueueMutationRecord(Ref<MutationRecord>&& mutation)
{
    Ref document = mutation->target().document();

    m_pendingTargets.add(mutation->target());
    m_records.append(WTF::move(mutation));

    domClientData().mutationObserverAgentData().activeObservers.add(*this);
    queueCompoundMicrotask(document);
}

void MutationObserver::enqueueSlotChangeEvent(HTMLSlotElement& slot)
{
    auto& list = domClientData().mutationObserverAgentData().signalSlotList;
    ASSERT(list.findIf([&slot](auto& entry) { return entry.ptr() == &slot; }) == notFound);
    list.append(slot);

    queueCompoundMicrotask(protect(slot.document()));
}

void MutationObserver::setHasTransientRegistration(Document& document)
{
    domClientData().mutationObserverAgentData().activeObservers.add(*this);
    queueCompoundMicrotask(document);
}

void MutationObserver::queueCompoundMicrotask(Document& document)
{
    auto& agentData = domClientData().mutationObserverAgentData();
    if (agentData.compoundMicrotaskQueued)
        return;
    agentData.compoundMicrotaskQueued = true;
    document.queueMicrotask([] {
        auto& agentData = domClientData().mutationObserverAgentData();
        agentData.compoundMicrotaskQueued = false;

        // FIXME: This check doesn't exist in the spec.
        if (agentData.deliveringRecords)
            return;
        agentData.deliveringRecords = true;
        notifyMutationObservers();
        agentData.deliveringRecords = false;
    });
}

bool MutationObserver::isReachableFromOpaqueRoots(JSC::AbstractSlotVisitor& visitor) const
{
    // We cannot use Ref here since this gets called on a GC thread.
    SUPPRESS_UNCOUNTED_LOCAL for (auto& registration : m_registrations) {
        if (registration.isReachableFromOpaqueRoots(visitor))
            return true;
    }
    return false;
}

bool MutationObserver::canDeliver()
{
    return m_callback->canInvokeCallback();
}

void MutationObserver::deliver()
{
    ASSERT(canDeliver());

    // takeTransientRegistrations() below drops each registration's only strong reference to its
    // observed node. Keep those nodes alive, declared first so they outlive the registrations.
    // GCReachableRef keeps their JS wrappers alive too.
    Vector<GCReachableRef<Node>, 1> observedNodesToKeepAlive;

    // Calling takeTransientRegistrations() can modify m_registrations, so it's necessary
    // to make a copy of the transient registrations before operating on them.
    Vector<Ref<MutationObserverRegistration>, 1> transientRegistrations;
    Vector<HashSet<GCReachableRef<Node>>, 1> nodesToKeepAlive;
    HashSet<GCReachableRef<Node>> pendingTargets;
    pendingTargets.swap(m_pendingTargets);
    for (Ref registration : m_registrations) {
        if (registration->hasTransientRegistrations())
            transientRegistrations.append(WTF::move(registration));
    }
    for (auto& registration : transientRegistrations) {
        observedNodesToKeepAlive.append(protect(registration->node()).get());
        nodesToKeepAlive.append(registration->takeTransientRegistrations());
    }

    if (m_records.isEmpty()) {
        ASSERT(m_pendingTargets.isEmpty());
        return;
    }

    Vector<Ref<MutationRecord>> records;
    records.swap(m_records);

    // FIXME: Keep mutation observer callback as long as its observed nodes are alive. See https://webkit.org/b/179224.
    if (m_callback->hasCallback()) {
        RefPtr context = m_callback->scriptExecutionContext();
        if (!context)
            return;

        m_callback->invoke(*this, records, *this);
    }
}

// https://dom.spec.whatwg.org/#notify-mutation-observers
void MutationObserver::notifyMutationObservers()
{
    auto& agentData = domClientData().mutationObserverAgentData();
    while (!agentData.activeObservers.isEmpty() || !agentData.signalSlotList.isEmpty()) {
        // 2. Let notify list be a copy of unit of related similar-origin browsing contexts' list of MutationObserver objects.
        auto notifyList = copyToVector(agentData.activeObservers);
        agentData.activeObservers.clear();
        std::ranges::sort(notifyList, [](auto& lhs, auto& rhs) {
            return lhs->m_priority < rhs->m_priority;
        });

        // 3. Let signalList be a copy of unit of related similar-origin browsing contexts' signal slot list.
        // 4. Empty unit of related similar-origin browsing contexts' signal slot list.
        Vector<GCReachableRef<HTMLSlotElement>> slotList;
        if (!agentData.signalSlotList.isEmpty()) {
            slotList.swap(agentData.signalSlotList);
            for (auto& slot : slotList)
                slot->didRemoveFromSignalSlotList();
        }

        // 5. For each MutationObserver object mo in notify list, execute a compound microtask subtask
        for (auto& observer : notifyList) {
            if (observer->canDeliver())
                observer->deliver();
        }

        // 6. For each slot slot in signalList, in order, fire an event named slotchange, with its bubbles attribute set to true, at slot.
        for (auto& slot : slotList)
            protect(slot.get())->dispatchSlotChangeEvent();
    }
}

} // namespace WebCore
