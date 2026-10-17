/*
    Copyright (C) 2004-2016 Apple Inc. All rights reserved.

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#pragma once

#include <wtf/Deque.h>
#include <wtf/text/ParsingUtilities.h>
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class SegmentedString {
public:
    SegmentedString() = default;
    SegmentedString(String&&);
    SegmentedString(const String&);
    explicit SegmentedString(StringView);

    SegmentedString(SegmentedString&&) = delete;
    SegmentedString(const SegmentedString&) = delete;

    SegmentedString& operator=(SegmentedString&&);
    SegmentedString& operator=(const SegmentedString&) = default;

    void clear();
    void LEGACY_NODELETE close();

    void append(SegmentedString&&);
    void append(const SegmentedString&);

    void append(String&&);
    void append(const String&);

    void pushBack(String&&);

    void LEGACY_NODELETE setExcludeLineNumbers();

    bool isEmpty() const { return !m_currentSubstring.length(); }
    unsigned LEGACY_NODELETE length() const;

    bool isClosed() const { return m_isClosed; }

    void advance();
    void advancePastNonNewline(); // Faster than calling advance when we know the current character is not a newline.
    void advancePastNewline(); // Faster than calling advance when we know the current character is a newline.

    std::span<const Latin1Character> currentSubstringSpan8() const;
    void advancePastMultiple8(unsigned count);

    enum AdvancePastResult { DidNotMatch, DidMatch, NotEnoughCharacters };
    AdvancePastResult advancePast(ASCIILiteral literal) { return advancePast<false>(literal); }
    AdvancePastResult advancePastLettersIgnoringASCIICase(ASCIILiteral literal) { return advancePast<true>(literal); }

    unsigned numberOfCharactersConsumed() const;

    String toString() const;

    char16_t currentCharacter() const { return m_currentCharacter; }

    OrdinalNumber LEGACY_NODELETE currentColumn() const;
    OrdinalNumber LEGACY_NODELETE currentLine() const;

    // Sets value of line/column variables. Column is specified indirectly by a parameter columnAfterProlog
    // which is a value of column that we should get after a prolog (first prologLength characters) has been consumed.
    void LEGACY_NODELETE setCurrentPosition(OrdinalNumber line, OrdinalNumber columnAfterProlog, int prologLength);

private:
    struct Substring {
        Substring() = default;
        Substring(String&&);
        explicit Substring(StringView);

        char16_t currentCharacter() const;
        char16_t currentCharacterPreIncrement();

        unsigned numberOfCharactersConsumed() const;
        void appendTo(StringBuilder&) const;

        unsigned length() const { return s.currentCharacter8.size(); }
        void clear() { s.currentCharacter8 = { }; }

        String underlyingString; // Optional, may be null.
        unsigned originalLength { 0 };
        union CharactersSpan {
            CharactersSpan()
                : currentCharacter8()
            { }
            std::span<const Latin1Character> currentCharacter8;
            std::span<const char16_t> currentCharacter16;
        } s;
        bool is8Bit { true };
        bool doNotExcludeLineNumbers { true };
    };

    enum FastPathFlags {
        NoFastPath = 0,
        Use8BitAdvanceAndUpdateLineNumbers = 1 << 0,
        Use8BitAdvance = 1 << 1,
    };

    void appendSubstring(Substring&&);

    void processPossibleNewline();
    void startNewLine();

    void advanceWithoutUpdatingLineNumber();
    void LEGACY_NODELETE advanceWithoutUpdatingLineNumber16();
    void LEGACY_NODELETE advanceAndUpdateLineNumber16();
    void advancePastSingleCharacterSubstringWithoutUpdatingLineNumber();
    void advancePastSingleCharacterSubstring();
    void LEGACY_NODELETE advanceEmpty();

    void updateAdvanceFunctionPointers();
    void LEGACY_NODELETE updateAdvanceFunctionPointersForEmptyString();
    void LEGACY_NODELETE updateAdvanceFunctionPointersForSingleCharacterSubstring();

    void updateAdvanceFunctionPointersIfNecessary();

    template<typename CharacterType> static bool characterMismatch(CharacterType, char, bool lettersIgnoringASCIICase);
    template<bool lettersIgnoringASCIICase> AdvancePastResult advancePast(ASCIILiteral);
    AdvancePastResult advancePastSlowCase(ASCIILiteral, bool lettersIgnoringASCIICase);

    Substring m_currentSubstring;
    Deque<Substring> m_otherSubstrings;

    bool m_isClosed { false };

    char16_t m_currentCharacter { 0 };

    unsigned m_numberOfCharactersConsumedPriorToCurrentSubstring { 0 };
    unsigned m_numberOfCharactersConsumedPriorToCurrentLine { 0 };
    int m_currentLine { 0 };

    unsigned char m_fastPathFlags { NoFastPath };
    void (SegmentedString::*m_advanceWithoutUpdatingLineNumberFunction)() { &SegmentedString::advanceEmpty };
    void (SegmentedString::*m_advanceAndUpdateLineNumberFunction)() { &SegmentedString::advanceEmpty };
};

inline SegmentedString::Substring::Substring(StringView passedStringView)
    : originalLength(passedStringView.length())
{
    if (!passedStringView.isEmpty()) {
        is8Bit = passedStringView.is8Bit();
        if (is8Bit)
            s.currentCharacter8 = passedStringView.span8();
        else
            s.currentCharacter16 = passedStringView.span16();
    }
}

inline SegmentedString::Substring::Substring(String&& passedString)
    : underlyingString(WTF::move(passedString))
    , originalLength(underlyingString.length())
{
    if (!underlyingString.isEmpty()) {
        is8Bit = underlyingString.impl()->is8Bit();
        if (is8Bit)
            s.currentCharacter8 = underlyingString.impl()->span8();
        else
            s.currentCharacter16 = underlyingString.impl()->span16();
    }
}

inline unsigned SegmentedString::Substring::numberOfCharactersConsumed() const
{
    return originalLength - length();
}

ALWAYS_INLINE char16_t SegmentedString::Substring::currentCharacter() const
{
    ASSERT(length());
    return is8Bit ? char16_t { s.currentCharacter8.front() } : s.currentCharacter16.front();
}

ALWAYS_INLINE char16_t SegmentedString::Substring::currentCharacterPreIncrement()
{
    ASSERT(length());
    if (is8Bit) {
        skip(s.currentCharacter8, 1);
        return s.currentCharacter8[0];
    }
    skip(s.currentCharacter16, 1);
    return s.currentCharacter16[0];
}

inline SegmentedString::SegmentedString(StringView stringView)
    : m_currentSubstring(stringView)
{
    if (m_currentSubstring.length()) {
        m_currentCharacter = m_currentSubstring.currentCharacter();
        updateAdvanceFunctionPointers();
    }
}

inline SegmentedString::SegmentedString(String&& string)
    : m_currentSubstring(WTF::move(string))
{
    if (m_currentSubstring.length()) {
        m_currentCharacter = m_currentSubstring.currentCharacter();
        updateAdvanceFunctionPointers();
    }
}

inline SegmentedString::SegmentedString(const String& string)
    : SegmentedString(String { string })
{
}

ALWAYS_INLINE void SegmentedString::updateAdvanceFunctionPointersIfNecessary()
{
    ASSERT(m_currentSubstring.length() >= 1);
    if (m_currentSubstring.length() == 1) [[unlikely]]
        updateAdvanceFunctionPointersForSingleCharacterSubstring();
}


ALWAYS_INLINE void SegmentedString::advanceWithoutUpdatingLineNumber()
{
    if (m_fastPathFlags & Use8BitAdvance) [[likely]] {
        skip(m_currentSubstring.s.currentCharacter8, 1);
        m_currentCharacter = m_currentSubstring.s.currentCharacter8[0];
        updateAdvanceFunctionPointersIfNecessary();
        return;
    }

    (this->*m_advanceWithoutUpdatingLineNumberFunction)();
}

inline void SegmentedString::startNewLine()
{
    ++m_currentLine;
    m_numberOfCharactersConsumedPriorToCurrentLine = numberOfCharactersConsumed();
}

inline void SegmentedString::processPossibleNewline()
{
    if (m_currentCharacter == '\n')
        startNewLine();
}

inline void SegmentedString::advance()
{
    if (m_fastPathFlags & Use8BitAdvance) [[likely]] {
        ASSERT(m_currentSubstring.length() > 1);
        bool lastCharacterWasNewline = m_currentCharacter == '\n';
        skip(m_currentSubstring.s.currentCharacter8, 1);
        m_currentCharacter = m_currentSubstring.s.currentCharacter8[0];
        bool haveOneCharacterLeft = m_currentSubstring.s.currentCharacter8.size() == 1;
        if (!(lastCharacterWasNewline | haveOneCharacterLeft)) [[likely]]
            return;
        if (lastCharacterWasNewline & !!(m_fastPathFlags & Use8BitAdvanceAndUpdateLineNumbers))
            startNewLine();
        if (haveOneCharacterLeft)
            updateAdvanceFunctionPointersForSingleCharacterSubstring();
        return;
    }

    (this->*m_advanceAndUpdateLineNumberFunction)();
}

ALWAYS_INLINE void SegmentedString::advancePastNonNewline()
{
    ASSERT(m_currentCharacter != '\n');
    advanceWithoutUpdatingLineNumber();
}

inline void SegmentedString::advancePastNewline()
{
    ASSERT(m_currentCharacter == '\n');
    if (m_currentSubstring.length() > 1) {
        m_currentCharacter = m_currentSubstring.currentCharacterPreIncrement();
        updateAdvanceFunctionPointersIfNecessary();
        if (m_currentSubstring.doNotExcludeLineNumbers)
            startNewLine();
        return;
    }

    (this->*m_advanceAndUpdateLineNumberFunction)();
}

// Returns a span over the remaining characters in the current 8-bit substring,
// starting from the current character. Returns an empty span if not 8-bit.
inline std::span<const Latin1Character> SegmentedString::currentSubstringSpan8() const
{
    if (m_fastPathFlags & Use8BitAdvance)
        return m_currentSubstring.s.currentCharacter8;
    return { };
}

// Advances past `count` characters in the current 8-bit substring.
// The caller must ensure at least one character remains after advancing
// (i.e. count < currentSubstringSpan8().size()), as the function sets
// the next remaining character as m_currentCharacter.
inline void SegmentedString::advancePastMultiple8(unsigned count)
{
    ASSERT(m_fastPathFlags & Use8BitAdvance);
    ASSERT(count < m_currentSubstring.s.currentCharacter8.size());

    if (m_currentCharacter == '\n' && (m_fastPathFlags & Use8BitAdvanceAndUpdateLineNumbers)) {
        // Must skip past the newline before calling startNewLine(), so that
        // numberOfCharactersConsumed() reflects the position after the '\n'.
        // This matches the ordering in advance().
        skip(m_currentSubstring.s.currentCharacter8, 1);
        startNewLine();
        if (count > 1)
            skip(m_currentSubstring.s.currentCharacter8, count - 1);
    } else
        skip(m_currentSubstring.s.currentCharacter8, count);

    m_currentCharacter = m_currentSubstring.s.currentCharacter8[0];
    if (m_currentSubstring.s.currentCharacter8.size() == 1) [[unlikely]]
        updateAdvanceFunctionPointersForSingleCharacterSubstring();
}

inline unsigned SegmentedString::numberOfCharactersConsumed() const
{
    return m_numberOfCharactersConsumedPriorToCurrentSubstring + m_currentSubstring.numberOfCharactersConsumed();
}

template<typename CharacterType> ALWAYS_INLINE bool SegmentedString::characterMismatch(CharacterType a, char b, bool lettersIgnoringASCIICase)
{
    return lettersIgnoringASCIICase ? !isASCIIAlphaCaselessEqual(a, b) : a != b;
}

template<bool lettersIgnoringASCIICase> SegmentedString::AdvancePastResult SegmentedString::advancePast(ASCIILiteral literal)
{
    unsigned length = literal.length();
    ASSERT(!literal[length]);
    ASSERT(!WTF::contains(literal.span(), '\n'));
    if (length + 1 < m_currentSubstring.length()) {
        if (m_currentSubstring.is8Bit) {
            for (unsigned i = 0; i < length; ++i) {
                if (characterMismatch(m_currentSubstring.s.currentCharacter8[i], literal[i], lettersIgnoringASCIICase))
                    return DidNotMatch;
            }
            skip(m_currentSubstring.s.currentCharacter8, length);
            m_currentCharacter = m_currentSubstring.s.currentCharacter8[0];
        } else {
            for (unsigned i = 0; i < length; ++i) {
                if (characterMismatch(m_currentSubstring.s.currentCharacter16[i], literal[i], lettersIgnoringASCIICase))
                    return DidNotMatch;
            }
            skip(m_currentSubstring.s.currentCharacter16, length);
            m_currentCharacter = m_currentSubstring.s.currentCharacter16[0];
        }
        return DidMatch;
    }
    return advancePastSlowCase(literal, lettersIgnoringASCIICase);
}

inline void SegmentedString::updateAdvanceFunctionPointers()
{
    if (m_currentSubstring.length() > 1) {
        if (m_currentSubstring.is8Bit) {
            m_fastPathFlags = Use8BitAdvance;
            if (m_currentSubstring.doNotExcludeLineNumbers)
                m_fastPathFlags |= Use8BitAdvanceAndUpdateLineNumbers;
            return;
        }
        m_fastPathFlags = NoFastPath;
        m_advanceWithoutUpdatingLineNumberFunction = &SegmentedString::advanceWithoutUpdatingLineNumber16;
        if (m_currentSubstring.doNotExcludeLineNumbers)
            m_advanceAndUpdateLineNumberFunction = &SegmentedString::advanceAndUpdateLineNumber16;
        else
            m_advanceAndUpdateLineNumberFunction = &SegmentedString::advanceWithoutUpdatingLineNumber16;
        return;
    }

    if (!m_currentSubstring.length()) {
        updateAdvanceFunctionPointersForEmptyString();
        return;
    }

    updateAdvanceFunctionPointersForSingleCharacterSubstring();
}

}
