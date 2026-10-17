/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#include "ContainerNode.h"
#include "TreeScope.h"
#include "TreeScopeOrderedMap.h"
#include <wtf/Lock.h>
#include <wtf/Locker.h>

namespace WebCore {

inline ContainerNode& TreeScope::rootNode() const
{
    return m_rootNode.get();
}

inline IdTargetObserverRegistry& TreeScope::idTargetObserverRegistry()
{
    if (m_idTargetObserverRegistry)
        return *m_idTargetObserverRegistry;
    return ensureIdTargetObserverRegistry();
}

inline bool TreeScope::hasElementWithId(const AtomString& id) const
{
    return m_elementsById && m_elementsById->contains(id);
}

inline bool TreeScope::containsMultipleElementsWithId(const AtomString& id) const
{
    return m_elementsById && !id.isEmpty() && m_elementsById->containsMultiple(id);
}

inline bool TreeScope::hasElementWithName(const AtomString& id) const
{
    return m_elementsByName && m_elementsByName->contains(id);
}

inline bool TreeScope::containsMultipleElementsWithName(const AtomString& name) const
{
    return m_elementsByName && !name.isEmpty() && m_elementsByName->containsMultiple(name);
}

inline void TreeScope::setDocumentScope(Document& document)
{
    Locker locker { treeScopeMutationLock() };
    m_documentScope = document;
}

ALWAYS_INLINE Lock& TreeScope::treeScopeMutationLock()
{
    static Lock s_treeScopeMutationLock;
    return s_treeScopeMutationLock;
}

} // namespace WebCore
