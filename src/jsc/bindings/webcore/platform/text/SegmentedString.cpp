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

#include "config.h"
#include "SegmentedString.h"

#include <wtf/text/ParsingUtilities.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/TextPosition.h>

namespace WebCore {

inline void SegmentedString::Substring::appendTo(StringBuilder& builder) const
{
    if (is8Bit)
        builder.append(s.currentCharacter8);
    else
        builder.append(s.currentCharacter16);
}

SegmentedString& SegmentedString::operator=(SegmentedString&& other)
{
    m_currentSubstring = WTF::move(other.m_currentSubstring);
    m_otherSubstrings = WTF::move(other.m_otherSubstrings);

    m_isClosed = other.m_isClosed;

    m_currentCharacter = other.m_currentCharacter;

    m_numberOfCharactersConsumedPriorToCurrentSubstring = other.m_numberOfCharactersConsumedPriorToCurrentSubstring;
    m_numberOfCharactersConsumedPriorToCurrentLine = other.m_numberOfCharactersConsumedPriorToCurrentLine;
    m_currentLine = other.m_currentLine;

    m_fastPathFlags = other.m_fastPathFlags;
    m_advanceWithoutUpdatingLineNumberFunction = other.m_advanceWithoutUpdatingLineNumberFunction;
    m_advanceAndUpdateLineNumberFunction = other.m_advanceAndUpdateLineNumberFunction;

    other.clear();

    return *this;
}

unsigned SegmentedString::length() const
{
    unsigned length = m_currentSubstring.length();
    for (auto& substring : m_otherSubstrings)
        length += substring.length();
    return length;
}

void SegmentedString::setExcludeLineNumbers()
{
    if (!m_currentSubstring.doNotExcludeLineNumbers)
        return;
    m_currentSubstring.doNotExcludeLineNumbers = false;
    for (auto& substring : m_otherSubstrings)
        substring.doNotExcludeLineNumbers = false;
    updateAdvanceFunctionPointers();
}

void SegmentedString::clear()
{
    m_currentSubstring.clear();
    m_otherSubstrings.clear();

    m_isClosed = false;

    m_currentCharacter = 0;

    m_numberOfCharactersConsumedPriorToCurrentSubstring = 0;
    m_numberOfCharactersConsumedPriorToCurrentLine = 0;
    m_currentLine = 0;

    updateAdvanceFunctionPointersForEmptyString();
}

inline void SegmentedString::appendSubstring(Substring&& substring)
{
    ASSERT(!m_isClosed);
    if (!substring.length())
        return;
    if (m_currentSubstring.length())
        m_otherSubstrings.append(WTF::move(substring));
    else {
        m_numberOfCharactersConsumedPriorToCurrentSubstring += m_currentSubstring.numberOfCharactersConsumed();
        m_currentSubstring = WTF::move(substring);
        m_currentCharacter = m_currentSubstring.currentCharacter();
        updateAdvanceFunctionPointers();
    }
}

void SegmentedString::pushBack(String&& string)
{
    // We never create a substring for an empty string.
    ASSERT(string.length());

    // The new substring we will create won't have the doNotExcludeLineNumbers set appropriately.
    // That was lost when the characters were consumed before pushing them back. But this does
    // not matter, because clients never use this for newlines. Catch that with this assertion.
    ASSERT(!string.contains('\n'));

    // The characters in the string must be previously consumed characters from this segmented string.
    ASSERT(string.length() <= numberOfCharactersConsumed());

    m_numberOfCharactersConsumedPriorToCurrentSubstring += m_currentSubstring.numberOfCharactersConsumed();
    if (m_currentSubstring.length())
        m_otherSubstrings.prepend(WTF::move(m_currentSubstring));
    m_currentSubstring = WTF::move(string);
    m_numberOfCharactersConsumedPriorToCurrentSubstring -= m_currentSubstring.length();
    m_currentCharacter = m_currentSubstring.currentCharacter();
    updateAdvanceFunctionPointers();
}

void SegmentedString::close()
{
    ASSERT(!m_isClosed);
    m_isClosed = true;
}

void SegmentedString::append(const SegmentedString& string)
{
    appendSubstring(Substring { string.m_currentSubstring });
    for (auto& substring : string.m_otherSubstrings)
        m_otherSubstrings.append(substring);
}

void SegmentedString::append(SegmentedString&& string)
{
    appendSubstring(WTF::move(string.m_currentSubstring));
    for (auto& substring : string.m_otherSubstrings)
        m_otherSubstrings.append(WTF::move(substring));
}

void SegmentedString::append(String&& string)
{
    appendSubstring(WTF::move(string));
}

void SegmentedString::append(const String& string)
{
    appendSubstring(String { string });
}

String SegmentedString::toString() const
{
    StringBuilder result;
    m_currentSubstring.appendTo(result);
    for (auto& substring : m_otherSubstrings)
        substring.appendTo(result);
    return result.toString();
}

void SegmentedString::advanceWithoutUpdatingLineNumber16()
{
    skip(m_currentSubstring.s.currentCharacter16, 1);
    m_currentCharacter = m_currentSubstring.s.currentCharacter16.front();
    updateAdvanceFunctionPointersIfNecessary();
}

void SegmentedString::advanceAndUpdateLineNumber16()
{
    ASSERT(m_currentSubstring.doNotExcludeLineNumbers);
    processPossibleNewline();
    skip(m_currentSubstring.s.currentCharacter16, 1);
    m_currentCharacter = m_currentSubstring.s.currentCharacter16.front();
    updateAdvanceFunctionPointersIfNecessary();
}

inline void SegmentedString::advancePastSingleCharacterSubstringWithoutUpdatingLineNumber()
{
    ASSERT(m_currentSubstring.length() == 1);
    m_currentSubstring.clear();
    m_numberOfCharactersConsumedPriorToCurrentSubstring += m_currentSubstring.numberOfCharactersConsumed();
    if (m_otherSubstrings.isEmpty()) {
        m_currentSubstring = { };
        m_currentCharacter = 0;
        updateAdvanceFunctionPointersForEmptyString();
        return;
    }
    m_currentSubstring = m_otherSubstrings.takeFirst();
    // If we've previously consumed some characters of the non-current string, we now account for those
    // characters as part of the current string, not as part of "prior to current string."
    m_numberOfCharactersConsumedPriorToCurrentSubstring -= m_currentSubstring.numberOfCharactersConsumed();
    m_currentCharacter = m_currentSubstring.currentCharacter();
    updateAdvanceFunctionPointers();
}

void SegmentedString::advancePastSingleCharacterSubstring()
{
    ASSERT(m_currentSubstring.length() == 1);
    ASSERT(m_currentSubstring.doNotExcludeLineNumbers);
    processPossibleNewline();
    advancePastSingleCharacterSubstringWithoutUpdatingLineNumber();
}

void SegmentedString::advanceEmpty()
{
    ASSERT(!m_currentSubstring.length());
    ASSERT(m_otherSubstrings.isEmpty());
    ASSERT(!m_currentCharacter);
}

void SegmentedString::updateAdvanceFunctionPointersForSingleCharacterSubstring()
{
    ASSERT(m_currentSubstring.length() == 1);
    m_fastPathFlags = NoFastPath;
    m_advanceWithoutUpdatingLineNumberFunction = &SegmentedString::advancePastSingleCharacterSubstringWithoutUpdatingLineNumber;
    if (m_currentSubstring.doNotExcludeLineNumbers)
        m_advanceAndUpdateLineNumberFunction = &SegmentedString::advancePastSingleCharacterSubstring;
    else
        m_advanceAndUpdateLineNumberFunction = &SegmentedString::advancePastSingleCharacterSubstringWithoutUpdatingLineNumber;
}

OrdinalNumber SegmentedString::currentLine() const
{
    return OrdinalNumber::fromZeroBasedInt(m_currentLine);
}

OrdinalNumber SegmentedString::currentColumn() const
{
    return OrdinalNumber::fromZeroBasedInt(numberOfCharactersConsumed() - m_numberOfCharactersConsumedPriorToCurrentLine);
}

void SegmentedString::setCurrentPosition(OrdinalNumber line, OrdinalNumber columnAftreProlog, int prologLength)
{
    m_currentLine = line.zeroBasedInt();
    m_numberOfCharactersConsumedPriorToCurrentLine = numberOfCharactersConsumed() + prologLength - columnAftreProlog.zeroBasedInt();
}

SegmentedString::AdvancePastResult SegmentedString::advancePastSlowCase(ASCIILiteral literal, bool lettersIgnoringASCIICase)
{
    constexpr unsigned maxLength = 10;
    ASSERT(!WTF::contains(literal.span(), '\n'));
    auto length = literal.length();
    ASSERT(length <= maxLength);
    if (length > this->length())
        return NotEnoughCharacters;
    std::array<char16_t, maxLength> consumedCharacters;
    for (unsigned i = 0; i < length; ++i) {
        auto character = m_currentCharacter;
        if (characterMismatch(character, literal[i], lettersIgnoringASCIICase)) {
            if (i)
                pushBack(String(std::span { consumedCharacters }.first(i)));
            return DidNotMatch;
        }
        advancePastNonNewline();
        consumedCharacters[i] = character;
    }
    return DidMatch;
}

void SegmentedString::updateAdvanceFunctionPointersForEmptyString()
{
    ASSERT(!m_currentSubstring.length());
    ASSERT(m_otherSubstrings.isEmpty());
    ASSERT(!m_currentCharacter);
    m_fastPathFlags = NoFastPath;
    m_advanceWithoutUpdatingLineNumberFunction = &SegmentedString::advanceEmpty;
    m_advanceAndUpdateLineNumberFunction = &SegmentedString::advanceEmpty;
}

}
