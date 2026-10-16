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

#include "Document.h"
#include "MutationObserver.h"
#include "NodeDocument.h"
#include <memory>
#include <wtf/HashMap.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class QualifiedName;

class MutationObserverInterestGroup {
    WTF_MAKE_TZONE_ALLOCATED(MutationObserverInterestGroup);
public:
    MutationObserverInterestGroup(HashMap<Ref<MutationObserver>, MutationRecordDeliveryOptions>&&, MutationRecordDeliveryOptions);

    static std::unique_ptr<MutationObserverInterestGroup> createForChildListMutation(Node& target)
    {
        if (!target.document().hasMutationObserversOfType(MutationObserverOptionType::ChildList))
            return nullptr;

        MutationRecordDeliveryOptions oldValueFlag;
        return createIfNeeded(target, MutationObserverOptionType::ChildList, oldValueFlag);
    }

    static std::unique_ptr<MutationObserverInterestGroup> createForCharacterDataMutation(Node& target)
    {
        if (!target.document().hasMutationObserversOfType(MutationObserverOptionType::CharacterData))
            return nullptr;

        return createIfNeeded(target, MutationObserverOptionType::CharacterData, MutationObserverOptionType::CharacterDataOldValue);
    }

    static std::unique_ptr<MutationObserverInterestGroup> createForAttributesMutation(Node& target, const QualifiedName& attributeName)
    {
        if (!target.document().hasMutationObserversOfType(MutationObserverOptionType::Attributes))
            return nullptr;

        return createIfNeeded(target, MutationObserverOptionType::Attributes, MutationObserverOptionType::AttributeOldValue, &attributeName);
    }

    bool LEGACY_NODELETE isOldValueRequested() const;
    void enqueueMutationRecord(Ref<MutationRecord>&&);

private:
    static std::unique_ptr<MutationObserverInterestGroup> createIfNeeded(Node& target, MutationObserverOptionType, MutationRecordDeliveryOptions oldValueFlag, const QualifiedName* attributeName = nullptr);

    bool hasOldValue(MutationRecordDeliveryOptions options) const { return options.containsAny(m_oldValueFlag); }

    HashMap<Ref<MutationObserver>, MutationRecordDeliveryOptions> m_observers;
    MutationRecordDeliveryOptions m_oldValueFlag;
};

} // namespace WebCore
