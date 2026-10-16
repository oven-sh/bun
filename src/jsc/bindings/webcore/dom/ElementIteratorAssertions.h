/*
 * Copyright (C) 2013-2015 Apple Inc. All rights reserved.
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

#include "NodeDocument.h"
#include "ScriptDisallowedScope.h"

namespace WebCore {

class ElementIteratorAssertions {
public:
    ElementIteratorAssertions(const Node* first = nullptr);
    bool domTreeHasMutated() const;
    void dropEventDispatchAssertion();
    void clear();

private:
    WeakPtr<const Document, WeakPtrImplWithEventTargetData> m_document;
    uint64_t m_initialDOMTreeVersion;
    std::optional<ScriptDisallowedScope> m_eventDispatchAssertion;
};

// FIXME: No real point in doing these as inlines; they are for debugging and we usually turn off inlining in debug builds.

inline ElementIteratorAssertions::ElementIteratorAssertions(const Node* first)
    : m_document(first ? &first->document() : nullptr)
    , m_initialDOMTreeVersion(first ? m_document->domTreeVersion() : 0)
{
    if (first)
        m_eventDispatchAssertion = ScriptDisallowedScope();
}

inline bool ElementIteratorAssertions::domTreeHasMutated() const
{
    return m_document && m_document->domTreeVersion() != m_initialDOMTreeVersion;
}

inline void ElementIteratorAssertions::dropEventDispatchAssertion()
{
    m_eventDispatchAssertion = std::nullopt;
}

inline void ElementIteratorAssertions::clear()
{
    m_document = nullptr;
    m_initialDOMTreeVersion = 0;
    m_eventDispatchAssertion = std::nullopt;
}

} // namespace WebCore
