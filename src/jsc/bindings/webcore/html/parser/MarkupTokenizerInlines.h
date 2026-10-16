/*
 * Copyright (C) 2008-2016 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Torch Mobile, Inc. http://www.torchmobile.com/
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

namespace WebCore {

inline bool isTokenizerWhitespace(char16_t character)
{
    return character == ' ' || character == '\x0A' || character == '\x09' || character == '\x0C';
}

#define BEGIN_STATE(stateName)                                  \
    case stateName:                                             \
    stateName: {                                                \
        constexpr auto currentState = stateName;                \
        UNUSED_PARAM(currentState);

#define END_STATE()                                             \
        ASSERT_NOT_REACHED();                                   \
        break;                                                  \
    }

#define RETURN_IN_CURRENT_STATE(expression)                     \
    do {                                                        \
        m_state = currentState;                                 \
        return expression;                                      \
    } while (false)

// We use this macro when the HTML spec says "reconsume the current input character in the <mumble> state."
#define RECONSUME_IN(newState)                                  \
    do {                                                        \
        goto newState;                                          \
    } while (false)

// We use this macro when the HTML spec says "consume the next input character ... and switch to the <mumble> state."
#define ADVANCE_TO(newState)                                    \
    do {                                                        \
        if (!m_preprocessor.advance(source, shouldSkipNullCharacters(newState))) { \
            m_state = newState;                                 \
            return haveBufferedCharacterToken();                \
        }                                                       \
        character = m_preprocessor.nextInputCharacter();        \
        goto newState;                                          \
    } while (false)
#define ADVANCE_PAST_NON_NEWLINE_TO(newState)                   \
    do {                                                        \
        if (!m_preprocessor.advancePastNonNewline(source, shouldSkipNullCharacters(newState))) { \
            m_state = newState;                                 \
            return haveBufferedCharacterToken();                \
        }                                                       \
        character = m_preprocessor.nextInputCharacter();        \
        goto newState;                                          \
    } while (false)

// For more complex cases, caller consumes the characters first and then uses this macro.
#define SWITCH_TO(newState)                                     \
    do {                                                        \
        if (!m_preprocessor.peek(source, shouldSkipNullCharacters(newState))) { \
            m_state = newState;                                 \
            return haveBufferedCharacterToken();                \
        }                                                       \
        character = m_preprocessor.nextInputCharacter();        \
        goto newState;                                          \
    } while (false)

} // namespace WebCore
