/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
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

#include "HTMLEntityTable.h"
#include <unicode/umachine.h>

namespace WebCore {

class HTMLEntitySearch {
public:
    HTMLEntitySearch();

    void advance(char16_t);

    bool isEntityPrefix() const { return m_entries.data(); }
    unsigned currentLength() const { return m_currentLength; }

    const HTMLEntityTableEntry* match() const { return m_mostRecentMatch; }

private:
    enum CompareResult { Before, Prefix, After };
    CompareResult compare(const HTMLEntityTableEntry*, char16_t) const;
    const HTMLEntityTableEntry* findFirst(char16_t) const;
    const HTMLEntityTableEntry* findLast(char16_t) const;

    void fail() { m_entries = { }; }

    unsigned m_currentLength { 0 };
    const HTMLEntityTableEntry* m_mostRecentMatch { nullptr };
    std::span<const HTMLEntityTableEntry> m_entries;
};

} // namespace WebCore
