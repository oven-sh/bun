/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
#include "HTTPHeaderField.h"

#include <array>
#include <wtf/SIMDHelpers.h>

namespace WebCore {

namespace RFC7230 {

namespace {

// token  = 1*tchar
// tchar  = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." / "^"
//        / "_" / "`" / "|" / "~" / DIGIT / ALPHA
// tokenCharacterTable[c] is true iff c is a tchar.
constexpr std::array<bool, 256> makeTokenCharacterTable()
{
    std::array<bool, 256> table {};
    for (unsigned c = '0'; c <= '9'; ++c)
        table[c] = true;
    for (unsigned c = 'A'; c <= 'Z'; ++c)
        table[c] = true;
    for (unsigned c = 'a'; c <= 'z'; ++c)
        table[c] = true;
    for (char c : { '!', '#', '$', '%', '&', '\'', '*', '+', '-', '.', '^', '_', '`', '|', '~' })
        table[static_cast<Latin1Character>(c)] = true;
    return table;
}
constexpr auto tokenCharacterTable = makeTokenCharacterTable();

// SIMD nibble-lookup tables for the tchar set. A byte b is a tchar iff
//   (tokenLowNibbleTable[b & 0xF] & tokenHighNibbleTable[b >> 4]) != 0
// Each bit position 0..5 corresponds to a high nibble in 0x2..0x7; the low
// table records, per low nibble, which of those high-nibble groups contains a
// tchar with that low nibble. (See makeTokenCharacterTable for the char set.)
constexpr simde_uint8x16_t tokenLowNibbleTable {
    0x3A, 0x3F, 0x3E, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F,
    0x3E, 0x3E, 0x3D, 0x15, 0x34, 0x15, 0x3D, 0x1C
};
constexpr simde_uint8x16_t tokenHighNibbleTable {
    0x00, 0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

ALWAYS_INLINE bool vectorIsAllTokenCharacters(simde_uint8x16_t input)
{
    auto low = simde_vqtbl1q_u8(tokenLowNibbleTable, simde_vandq_u8(input, simde_vmovq_n_u8(0x0F)));
    auto high = simde_vqtbl1q_u8(tokenHighNibbleTable, simde_vshrq_n_u8(input, 4));
    // matched[i] != 0 iff input[i] is a tchar; a zero lane means a non-tchar byte.
    auto matched = simde_vandq_u8(low, high);
    return !WTF::SIMD::isNonZero(simde_vceqq_u8(matched, simde_vmovq_n_u8(0)));
}

// True iff every byte is a tchar. Empty span returns true; callers handle the
// "must be non-empty" requirement separately.
bool containsOnlyTokenCharacters(std::span<const Latin1Character> span)
{
    size_t length = span.size();
    size_t i = 0;
    for (; i + WTF::SIMD::stride<uint8_t> <= length; i += WTF::SIMD::stride<uint8_t>) {
        if (!vectorIsAllTokenCharacters(WTF::SIMD::load(span.data() + i)))
            return false;
    }
    for (; i < length; ++i) {
        if (!tokenCharacterTable[span[i]])
            return false;
    }
    return true;
}

} // namespace

bool isTokenCharacter(char16_t c)
{
    return c < 0x80 && tokenCharacterTable[c];
}
bool isDelimiter(char16_t c)
{
    return c < 0x80 && isDelimiter(static_cast<Latin1Character>(c));
}

bool isTokenCharacter(Latin1Character c)
{
    return tokenCharacterTable[c];
}

bool isDelimiter(Latin1Character c)
{
    return c == '(' || c == ')' || c == ','
        || c == '/' || c == ':' || c == ';'
        || c == '<' || c == '=' || c == '>'
        || c == '?' || c == '@' || c == '['
        || c == '\\' || c == ']' || c == '{'
        || c == '}' || c == '"';
}

static bool isVisibleCharacter(char16_t c)
{
    return isTokenCharacter(c) || isDelimiter(c);
}

bool isWhitespace(char16_t c)
{
    return c == ' ' || c == '\t';
}

template<size_t min, size_t max>
static bool isInRange(char16_t c)
{
    return c >= min && c <= max;
}

static bool isOBSText(char16_t c)
{
    return isInRange<0x80, 0xFF>(c);
}

static bool isQuotedTextCharacter(char16_t c)
{
    return isWhitespace(c)
        || c == 0x21
        || isInRange<0x23, 0x5B>(c)
        || isInRange<0x5D, 0x7E>(c)
        || isOBSText(c);
}

bool isQuotedPairSecondOctet(char16_t c)
{
    return isWhitespace(c)
        || isVisibleCharacter(c)
        || isOBSText(c);
}

bool isCommentText(char16_t c)
{
    return isWhitespace(c)
        || isInRange<0x21, 0x27>(c)
        || isInRange<0x2A, 0x5B>(c)
        || isInRange<0x5D, 0x7E>(c)
        || isOBSText(c);
}

static bool isValidName(StringView name)
{
    if (!name.length())
        return false;
    if (name.is8Bit())
        return containsOnlyTokenCharacters(name.span8());
    for (size_t i = 0; i < name.length(); ++i) {
        if (!isTokenCharacter(name[i]))
            return false;
    }
    return true;
}

static bool isValidValue(StringView value)
{
    // Fast path: a value made up entirely of token characters (for example a
    // numeric Content-Length, an entity tag without quotes, "gzip", "no-cache",
    // etc.) is always a valid field-value. The caller has already trimmed
    // surrounding whitespace, and token characters are never whitespace, so a
    // non-empty all-token value ends in the Token state with hadNonWhitespace.
    if (value.length() && value.is8Bit() && containsOnlyTokenCharacters(value.span8()))
        return true;

    enum class State {
        OptionalWhitespace,
        Token,
        QuotedString,
        Comment,
    };
    State state = State::OptionalWhitespace;
    size_t commentDepth = 0;
    bool hadNonWhitespace = false;

    for (size_t i = 0; i < value.length(); ++i) {
        char16_t c = value[i];
        switch (state) {
        case State::OptionalWhitespace:
            if (isWhitespace(c))
                continue;
            hadNonWhitespace = true;
            if (isTokenCharacter(c)) {
                state = State::Token;
                continue;
            }
            if (c == '"') {
                state = State::QuotedString;
                continue;
            }
            if (c == '(') {
                ASSERT(!commentDepth);
                ++commentDepth;
                state = State::Comment;
                continue;
            }
            return false;

        case State::Token:
            if (isTokenCharacter(c))
                continue;
            state = State::OptionalWhitespace;
            continue;
        case State::QuotedString:
            if (c == '"') {
                state = State::OptionalWhitespace;
                continue;
            }
            if (c == '\\') {
                ++i;
                if (i == value.length())
                    return false;
                if (!isQuotedPairSecondOctet(value[i]))
                    return false;
                continue;
            }
            if (!isQuotedTextCharacter(c))
                return false;
            continue;
        case State::Comment:
            if (c == '(') {
                ++commentDepth;
                continue;
            }
            if (c == ')') {
                --commentDepth;
                if (!commentDepth)
                    state = State::OptionalWhitespace;
                continue;
            }
            if (c == '\\') {
                ++i;
                if (i == value.length())
                    return false;
                if (!isQuotedPairSecondOctet(value[i]))
                    return false;
                continue;
            }
            if (!isCommentText(c))
                return false;
            continue;
        }
    }

    switch (state) {
    case State::OptionalWhitespace:
    case State::Token:
        return hadNonWhitespace;
    case State::QuotedString:
    case State::Comment:
        // Unclosed comments or quotes are invalid values.
        break;
    }
    return false;
}

} // namespace RFC7230

std::optional<HTTPHeaderField> HTTPHeaderField::create(String&& unparsedName, String&& unparsedValue)
{
    auto trimmedName = StringView(unparsedName).trim(isTabOrSpace<char16_t>);
    auto trimmedValue = StringView(unparsedValue).trim(isTabOrSpace<char16_t>);
    if (!RFC7230::isValidName(trimmedName) || !RFC7230::isValidValue(trimmedValue))
        return std::nullopt;

    auto name = trimmedName.length() == unparsedName.length() ? WTF::move(unparsedName) : trimmedName.toString();
    auto value = trimmedValue.length() == unparsedValue.length() ? WTF::move(unparsedValue) : trimmedValue.toString();
    return { { WTF::move(name), WTF::move(value) } };
}

}
