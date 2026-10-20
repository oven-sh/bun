/*
 * Copyright (C) 2008 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Torch Mobile, Inc. http://www.torchmobile.com/
 * Copyright (C) 2013 Google, Inc. All rights reserved.
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

#include "SegmentedString.h"
#include <wtf/unicode/CharacterNames.h>

namespace WebCore {

constexpr Latin1Character kEndOfFileMarker = 0;

// https://html.spec.whatwg.org/#preprocessing-the-input-stream
class InputStreamPreprocessor {
public:

    ALWAYS_INLINE char16_t nextInputCharacter() const { return m_nextInputCharacter; }
    ALWAYS_INLINE bool skipNextNewLine() const { return m_skipNextNewLine; }

    // Returns whether we succeeded in peeking at the next character.
    // The only way we can fail to peek is if there are no more
    // characters in |source| (after collapsing \r\n, etc).
    ALWAYS_INLINE bool peek(SegmentedString& source, bool skipNullCharacters = false)
    {
        if (source.isEmpty()) [[unlikely]]
            return false;

        m_nextInputCharacter = source.currentCharacter();

        // Every branch in this function is expensive, so we have a
        // fast-reject branch for characters that don't require special
        // handling. Please run the parser benchmark whenever you touch
        // this function. It's very hot.
        constexpr char16_t specialCharacterMask = '\n' | '\r' | '\0';
        if (m_nextInputCharacter & ~specialCharacterMask) [[likely]] {
            m_skipNextNewLine = false;
            return true;
        }

        return processNextInputCharacter(source, skipNullCharacters);
    }

    // Returns whether there are more characters in |source| after advancing.
    ALWAYS_INLINE bool advance(SegmentedString& source, bool skipNullCharacters = false)
    {
        source.advance();
        return peek(source, skipNullCharacters);
    }
    ALWAYS_INLINE bool advancePastNonNewline(SegmentedString& source, bool skipNullCharacters = false)
    {
        source.advancePastNonNewline();
        return peek(source, skipNullCharacters);
    }

private:
    bool processNextInputCharacter(SegmentedString& source, bool skipNullCharacters)
    {
    ProcessAgain:
        ASSERT(m_nextInputCharacter == source.currentCharacter());
        if (m_nextInputCharacter == '\n' && m_skipNextNewLine) {
            m_skipNextNewLine = false;
            source.advancePastNewline();
            if (source.isEmpty())
                return false;
            m_nextInputCharacter = source.currentCharacter();
        }
        if (m_nextInputCharacter == '\r') {
            m_nextInputCharacter = '\n';
            m_skipNextNewLine = true;
            return true;
        }
        m_skipNextNewLine = false;
        if (m_nextInputCharacter || isAtEndOfFile(source))
            return true;
        if (skipNullCharacters) {
            source.advancePastNonNewline();
            if (source.isEmpty())
                return false;
            m_nextInputCharacter = source.currentCharacter();
            goto ProcessAgain;
        }
        m_nextInputCharacter = replacementCharacter;
        return true;
    }

    static bool isAtEndOfFile(SegmentedString& source)
    {
        return source.isClosed() && source.length() == 1;
    }

    // https://html.spec.whatwg.org/#next-input-character
    char16_t m_nextInputCharacter { 0 };
    bool m_skipNextNewLine { false };
};

} // namespace WebCore
