/*
 * Copyright (C) 2007 David Smith (catfish.man@gmail.com)
 * Copyright (C) 2007, 2008, 2011-2014 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 59 Temple Place - Suite 330,
 * Boston, MA 02111-1307, USA.
 */

#include "config.h"
#include "SpaceSplitString.h"

#include "DOMClientData.h"
#include <wtf/HashMap.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/AtomStringHash.h>
#include <wtf/text/ParsingUtilities.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SpaceSplitStringData);

static_assert(!(sizeof(SpaceSplitStringData) % sizeof(uintptr_t)), "SpaceSplitStringDataTail is aligned to WordSize");

template <typename CharacterType, typename TokenProcessor>
static inline void tokenizeSpaceSplitString(TokenProcessor& tokenProcessor, std::span<const CharacterType> characters)
{
    for (unsigned start = 0; ; ) {
        while (start < characters.size() && isASCIIWhitespace(characters[start]))
            ++start;
        if (start >= characters.size())
            break;
        unsigned end = start + 1;
        while (end < characters.size() && !isASCIIWhitespace(characters[end]))
            ++end;

        if (!tokenProcessor.processToken(characters.subspan(start, end - start)))
            return;

        start = end + 1;
    }
}

template<typename TokenProcessor>
static inline void tokenizeSpaceSplitString(TokenProcessor& tokenProcessor, StringView string)
{
    ASSERT(!string.isNull());

    if (string.is8Bit())
        tokenizeSpaceSplitString(tokenProcessor, string.span8());
    else
        tokenizeSpaceSplitString(tokenProcessor, string.span16());
}

bool SpaceSplitStringData::containsAll(const SpaceSplitStringData& other) const
{
    if (this == &other)
        return true;

    for (auto& token : other) {
        if (!contains(token))
            return false;
    }
    return true;
}

static HashMap<AtomString, SpaceSplitStringData*>& spaceSplitStringTable()
{
    return domClientData().spaceSplitStrings();
}

void SpaceSplitString::set(const AtomString& inputString, ShouldFoldCase shouldFoldCase)
{
    if (inputString.isNull()) {
        clear();
        return;
    }
    m_data = SpaceSplitStringData::create(shouldFoldCase == ShouldFoldCase::Yes ? inputString.convertToASCIILowercase() : inputString);
}

template<typename ReferenceCharacterType>
class TokenIsEqualToCharactersTokenProcessor {
public:
    explicit TokenIsEqualToCharactersTokenProcessor(const ReferenceCharacterType* referenceCharacters, unsigned length)
        : m_referenceCharacters(referenceCharacters)
        , m_referenceLength(length)
    {
    }

    template <typename TokenCharacterType>
    bool LEGACY_NODELETE processToken(std::span<const TokenCharacterType> characters)
    {
        if (characters.size() == m_referenceLength && equal(m_referenceCharacters, characters)) {
            m_referenceStringWasFound = true;
            return false;
        }
        return true;
    }

    bool LEGACY_NODELETE referenceStringWasFound() const { return m_referenceStringWasFound; }

private:
    const ReferenceCharacterType* m_referenceCharacters;
    unsigned m_referenceLength;
    bool m_referenceStringWasFound { false };
};

template <typename ValueCharacterType>
static bool LEGACY_NODELETE spaceSplitStringContainsValueInternal(StringView spaceSplitString, StringView value)
{
    TokenIsEqualToCharactersTokenProcessor<ValueCharacterType> tokenProcessor(value.span<ValueCharacterType>().data(), value.length());
    tokenizeSpaceSplitString(tokenProcessor, spaceSplitString);
    return tokenProcessor.referenceStringWasFound();
}

bool SpaceSplitString::spaceSplitStringContainsValue(StringView spaceSplitString, StringView value, ShouldFoldCase shouldFoldCase)
{
    if (spaceSplitString.isNull())
        return false;

    if (value.is8Bit())
        return spaceSplitStringContainsValueInternal<Latin1Character>(shouldFoldCase == ShouldFoldCase::Yes ? StringView { spaceSplitString.convertToASCIILowercase() } : spaceSplitString, value);
    return spaceSplitStringContainsValueInternal<char16_t>(shouldFoldCase == ShouldFoldCase::Yes ? StringView { spaceSplitString.convertToASCIILowercase() } : spaceSplitString, value);
}

class TokenCounter {
    WTF_MAKE_NONCOPYABLE(TokenCounter);
public:
    TokenCounter() : m_tokenCount(0) { }

    template<typename CharacterType> bool LEGACY_NODELETE processToken(std::span<const CharacterType>)
    {
        ++m_tokenCount;
        return true;
    }

    unsigned LEGACY_NODELETE tokenCount() const { return m_tokenCount; }

private:
    unsigned m_tokenCount;
};

class TokenAtomStringInitializer {
    WTF_MAKE_NONCOPYABLE(TokenAtomStringInitializer);
public:
    TokenAtomStringInitializer(const AtomString& keyString, std::span<AtomString> memory)
        : m_keyString(keyString)
        , m_memoryBucket(memory)
    { }

    template<typename CharacterType> bool processToken(std::span<const CharacterType> characters)
    {
        if (characters.size() == m_keyString.length())
            new (NotNull, m_memoryBucket.data()) AtomString(m_keyString);
        else
            new (NotNull, m_memoryBucket.data()) AtomString(characters);
        skip(m_memoryBucket, 1);
        return true;
    }

    const AtomString* LEGACY_NODELETE nextMemoryBucket() const { return m_memoryBucket.data(); }

private:
    const AtomString& m_keyString;
    std::span<AtomString> m_memoryBucket;
};

inline Ref<SpaceSplitStringData> SpaceSplitStringData::create(const AtomString& keyString, unsigned tokenCount)
{
    ASSERT(tokenCount);

    RELEASE_ASSERT(tokenCount < (std::numeric_limits<unsigned>::max() - sizeof(SpaceSplitStringData)) / sizeof(AtomString));
    size_t sizeToAllocate = sizeof(SpaceSplitStringData) + tokenCount * sizeof(AtomString);
    SUPPRESS_UNCOUNTED_LOCAL auto* rawPointer = static_cast<SpaceSplitStringData*>(fastMalloc(sizeToAllocate));

    new (NotNull, rawPointer) SpaceSplitStringData(keyString, tokenCount);
    Ref spaceSplitStringData = adoptRef(*rawPointer);
    auto tokenArray = spaceSplitStringData->tokenArray();
    TokenAtomStringInitializer tokenInitializer(keyString, tokenArray);
    tokenizeSpaceSplitString(tokenInitializer, keyString);
    ASSERT(static_cast<unsigned>(tokenInitializer.nextMemoryBucket() - tokenArray.data()) == tokenCount);
    ASSERT(reinterpret_cast<const char*>(tokenInitializer.nextMemoryBucket()) - reinterpret_cast<const char*>(spaceSplitStringData.ptr()) == static_cast<ptrdiff_t>(sizeToAllocate));

    return spaceSplitStringData;
}

RefPtr<SpaceSplitStringData> SpaceSplitStringData::create(const AtomString& keyString)
{
    ASSERT(!keyString.isNull());

    auto addResult = spaceSplitStringTable().add(keyString, nullptr);
    if (!addResult.isNewEntry)
        return addResult.iterator->value;

    // Nothing in the cache? Let's create a new SpaceSplitStringData if the input has something useful.
    // 1) We find the number of strings in the input to know how much size we need to allocate.
    TokenCounter tokenCounter;
    tokenizeSpaceSplitString(tokenCounter, keyString);
    unsigned tokenCount = tokenCounter.tokenCount();

    if (!tokenCount) {
        // The input was whitespace-only, so there is nothing to cache. Remove the entry we just
        // added, otherwise the table would retain the key string for the lifetime of the process.
        spaceSplitStringTable().remove(addResult.iterator);
        return nullptr;
    }

    RefPtr<SpaceSplitStringData> spaceSplitStringData = create(keyString, tokenCount);
    addResult.iterator->value = spaceSplitStringData.get();
    return spaceSplitStringData;
}


void SpaceSplitStringData::destroy(SpaceSplitStringData* spaceSplitString)
{

    spaceSplitStringTable().remove(spaceSplitString->m_keyString);

    for (auto& data : spaceSplitString->tokenArray())
        data.~AtomString();

    spaceSplitString->~SpaceSplitStringData();

    fastFree(spaceSplitString);
}

} // namespace WebCore
