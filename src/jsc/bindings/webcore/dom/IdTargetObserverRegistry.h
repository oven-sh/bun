/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
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

#include <memory>
#include <wtf/CheckedPtr.h>
#include <wtf/Forward.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/AtomStringHash.h>

namespace WebCore {

class Element;
class IdTargetObserver;

class IdTargetObserverRegistry final : public CanMakeCheckedPtr<IdTargetObserverRegistry> {
    WTF_MAKE_TZONE_ALLOCATED(IdTargetObserverRegistry);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(IdTargetObserverRegistry);
    friend class IdTargetObserver;
public:
    IdTargetObserverRegistry();
    ~IdTargetObserverRegistry();

    void notifyObservers(Element&, const AtomString& id);

private:
    void addObserver(const AtomString& id, IdTargetObserver&);
    void removeObserver(const AtomString& id, IdTargetObserver&);
    void notifyObserversInternal(Element&, const AtomString& id);

    struct ObserverSet final : public CanMakeCheckedPtr<ObserverSet> {
        WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(ObserverSet);
        WTF_STRUCT_OVERRIDE_DELETE_FOR_CHECKED_PTR(ObserverSet);

        ObserverSet();
        ~ObserverSet();
        HashSet<CheckedRef<IdTargetObserver>> observers;
    };

    using IdToObserverSetMap = HashMap<AtomString, std::unique_ptr<ObserverSet>>;
    IdToObserverSetMap m_registry;
    CheckedPtr<ObserverSet> m_notifyingObserversInSet;
};

inline void IdTargetObserverRegistry::notifyObservers(Element& element, const AtomString& id)
{
    ASSERT(!id.isEmpty());
    ASSERT(!m_notifyingObserversInSet);
    if (m_registry.isEmpty())
        return;
    IdTargetObserverRegistry::notifyObserversInternal(element, id);
}

} // namespace WebCore
