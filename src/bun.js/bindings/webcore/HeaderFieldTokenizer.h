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

#pragma once

#include <wtf/text/WTFString.h>

namespace WebCore {

// Parses header fields into tokens, quoted strings and separators.
// Commonly used by ParsedContent* classes.
class HeaderFieldTokenizer {

public:
    explicit HeaderFieldTokenizer(const String&);

    // Try to parse a separator character, a token or either a token or a quoted
    // string from the |header_field| input. Return |true| on success. Return
    // |false| if the separator character, the token or the quoted string is
    // missing or invalid.
    bool consume(UChar);
    String consumeToken();
    String consumeTokenOrQuotedString();

    // Consume all characters before (but excluding) any of the characters from
    // the Vector parameter are found.
    // Because we potentially have to iterate through the entire Vector for each
    // character of the base string, the Vector should be small (< 3 members).
    void consumeBeforeAnyCharMatch(const Vector<UChar>&);

    bool isConsumed() const { return m_index >= m_input.length(); }

private:
    String consumeQuotedString();
    void skipSpaces();

    unsigned m_index = 0;
    const String m_input;
};

} // namespace WebCore
