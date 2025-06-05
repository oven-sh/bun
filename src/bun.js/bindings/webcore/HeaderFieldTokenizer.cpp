/*
 * Copyright 2017 The Chromium Authors. All rights reserved.
 * Copyright (C) 2018 Akamai Technologies Inc. All rights reserved.
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
#include "HeaderFieldTokenizer.h"

#include "RFC7230.h"
#include <wtf/text/StringBuilder.h>

namespace WebCore {

HeaderFieldTokenizer::HeaderFieldTokenizer(const String& headerField)
    : m_input(headerField)
{
    skipSpaces();
}

bool HeaderFieldTokenizer::consume(UChar c)
{
    ASSERT(!isTabOrSpace(c));

    if (isConsumed() || m_input[m_index] != c)
        return false;

    ++m_index;
    skipSpaces();
    return true;
}

String HeaderFieldTokenizer::consumeQuotedString()
{
    StringBuilder builder;

    ASSERT(m_input[m_index] == '"');
    ++m_index;

    while (!isConsumed()) {
        if (m_input[m_index] == '"') {
            String output = builder.toString();
            ++m_index;
            skipSpaces();
            return output;
        }
        if (m_input[m_index] == '\\') {
            ++m_index;
            if (isConsumed())
                return String();
        }
        builder.append(m_input[m_index]);
        ++m_index;
    }
    return String();
}

String HeaderFieldTokenizer::consumeToken()
{
    auto start = m_index;
    while (!isConsumed() && RFC7230::isTokenCharacter(m_input[m_index]))
        ++m_index;

    if (start == m_index)
        return String();

    String output = m_input.substring(start, m_index - start);
    skipSpaces();
    return output;
}

String HeaderFieldTokenizer::consumeTokenOrQuotedString()
{
    if (isConsumed())
        return String();

    if (m_input[m_index] == '"')
        return consumeQuotedString();

    return consumeToken();
}

void HeaderFieldTokenizer::skipSpaces()
{
    while (!isConsumed() && isTabOrSpace(m_input[m_index]))
        ++m_index;
}

void HeaderFieldTokenizer::consumeBeforeAnyCharMatch(const Vector<UChar>& chars)
{
    ASSERT(chars.size() > 0U && chars.size() < 3U);

    while (!isConsumed()) {
        for (const auto& c : chars) {
            if (c == m_input[m_index])
                return;
        }

        ++m_index;
    }
}

} // namespace WebCore
