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

#include "config.h"

#include "MutationObserverInterestGroup.h"

#include "MutationObserverRegistration.h"
#include "MutationRecord.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MutationObserverInterestGroup);

inline MutationObserverInterestGroup::MutationObserverInterestGroup(HashMap<Ref<MutationObserver>, MutationRecordDeliveryOptions>&& observers, MutationRecordDeliveryOptions oldValueFlag)
    : m_observers(WTF::move(observers))
    , m_oldValueFlag(oldValueFlag)
{
    ASSERT(!m_observers.isEmpty());
}

std::unique_ptr<MutationObserverInterestGroup> MutationObserverInterestGroup::createIfNeeded(Node& target, MutationObserverOptionType type, MutationRecordDeliveryOptions oldValueFlag, const QualifiedName* attributeName)
{
    ASSERT((type == MutationObserverOptionType::Attributes && attributeName) || !attributeName);
    auto observers = target.registeredMutationObservers(type, attributeName);
    if (observers.isEmpty())
        return nullptr;

    return makeUnique<MutationObserverInterestGroup>(WTF::move(observers), oldValueFlag);
}

bool MutationObserverInterestGroup::isOldValueRequested() const
{
    for (auto options : m_observers.values()) {
        if (hasOldValue(options))
            return true;
    }
    return false;
}

void MutationObserverInterestGroup::enqueueMutationRecord(Ref<MutationRecord>&& mutation)
{
    RefPtr<MutationRecord> mutationWithNullOldValue;
    for (auto& observerOptionsPair : m_observers) {
        Ref observer = observerOptionsPair.key.get();
        if (hasOldValue(observerOptionsPair.value)) {
            observer->enqueueMutationRecord(mutation.copyRef());
            continue;
        }
        if (!mutationWithNullOldValue) {
            if (mutation->oldValue().isNull())
                mutationWithNullOldValue = mutation.ptr();
            else
                mutationWithNullOldValue = MutationRecord::createWithNullOldValue(mutation).ptr();
        }
        observer->enqueueMutationRecord(*mutationWithNullOldValue);
    }
}

} // namespace WebCore
