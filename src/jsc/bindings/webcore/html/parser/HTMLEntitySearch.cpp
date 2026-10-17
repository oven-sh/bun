/*
 * Copyright (C) 2023 Apple, Inc. All rights reserved.
 * Copyright (C) 2010-2014 Google, Inc. All rights reserved.
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

#include "config.h"
#include "HTMLEntitySearch.h"

#include <numeric>


namespace WebCore {

HTMLEntitySearch::HTMLEntitySearch()
    : m_entries(HTMLEntityTable::entries())
{
}

HTMLEntitySearch::CompareResult HTMLEntitySearch::compare(const HTMLEntityTableEntry* entry, char16_t nextCharacter) const
{
    auto name = entry->nameCharacters();
    char16_t entryNextCharacter;
    if (m_currentLength >= name.size()) {
        if (!entry->nameIncludesTrailingSemicolon || m_currentLength > name.size())
            return Before;
        entryNextCharacter = ';';
    } else
        entryNextCharacter = name[m_currentLength];
    if (entryNextCharacter == nextCharacter)
        return Prefix;
    return entryNextCharacter < nextCharacter ? Before : After;
}

const HTMLEntityTableEntry* HTMLEntitySearch::findFirst(char16_t nextCharacter) const
{
    auto span = m_entries;
    if (span.size() == 1)
        return &span.front();
    CompareResult result = compare(&span.front(), nextCharacter);
    if (result == Prefix)
        return &span.front();
    if (result == After)
        return &span.back();
    while (span.size() > 2) {
        auto* probe = std::midpoint(&span.front(), &span.back());
        result = compare(probe, nextCharacter);
        if (result == Before)
            span = span.subspan(probe - span.data());
        else {
            ASSERT(result == After || result == Prefix);
            span = span.first(probe - span.data() + 1);
        }
    }
    ASSERT(span.size() == 2);
    return &span.back();
}

const HTMLEntityTableEntry* HTMLEntitySearch::findLast(char16_t nextCharacter) const
{
    auto span = m_entries;
    if (span.size() == 1)
        return &span.back();
    CompareResult result = compare(&span.back(), nextCharacter);
    if (result == Prefix)
        return &span.back();
    if (result == Before)
        return &span.front();
    while (span.size() > 2) {
        auto* probe = std::midpoint(&span.front(), &span.back());
        result = compare(probe, nextCharacter);
        if (result == After)
            span = span.first(probe - span.data() + 1);
        else {
            ASSERT(result == Before || result == Prefix);
            span = span.subspan(probe - span.data());
        }
    }
    ASSERT(span.size() == 2);
    return &span.front();
}

void HTMLEntitySearch::advance(char16_t nextCharacter)
{
    ASSERT(isEntityPrefix());
    if (!m_currentLength) {
        m_entries = HTMLEntityTable::entriesStartingWith(nextCharacter);
        if (m_entries.empty())
            return;
    } else {
        auto* first = findFirst(nextCharacter);
        m_entries = m_entries.subspan(first - m_entries.data());
        auto* last = findLast(nextCharacter);
        m_entries = m_entries.first(last - m_entries.data() + 1);
        if (first == last && compare(first, nextCharacter) != Prefix)
            return fail();
    }
    ++m_currentLength;
    if (m_entries[0].nameLength() != m_currentLength)
        return;
    m_mostRecentMatch = &m_entries.front();
}

}
