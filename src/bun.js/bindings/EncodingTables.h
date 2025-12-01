/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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

#include <algorithm>
#include <array>
#include <iterator>
#include <optional>
#include <unicode/umachine.h>
#include <utility>

namespace PAL {

const std::array<std::pair<uint16_t, char16_t>, 7724>& jis0208();
const std::array<std::pair<uint16_t, char16_t>, 6067>& jis0212();
const std::array<std::pair<uint16_t, char32_t>, 18590>& big5();
const std::array<std::pair<uint16_t, char16_t>, 17048>& eucKR();
const std::array<char16_t, 23940>& gb18030();

void checkEncodingTableInvariants();

// Functions for using sorted arrays of pairs as a map.
// FIXME: Consider moving these functions to StdLibExtras.h for uses other than encoding tables.
template<typename CollectionType> void sortByFirst(CollectionType&);
template<typename CollectionType> void stableSortByFirst(CollectionType&);
template<typename CollectionType> bool isSortedByFirst(const CollectionType&);
template<typename CollectionType> bool sortedFirstsAreUnique(const CollectionType&);
template<typename CollectionType, typename KeyType> static auto findFirstInSortedPairs(const CollectionType& sortedPairsCollection, const KeyType&) -> std::optional<decltype(std::begin(sortedPairsCollection)->second)>;
template<typename CollectionType, typename KeyType> static auto findInSortedPairs(const CollectionType& sortedPairsCollection, const KeyType&) -> std::span<std::remove_reference_t<decltype(*std::begin(sortedPairsCollection))>>;

#if !ASSERT_ENABLED
inline void checkEncodingTableInvariants() {}
#endif

struct CompareFirst {
    template<typename TypeA, typename TypeB> bool operator()(const TypeA& a, const TypeB& b)
    {
        return a.first < b.first;
    }
};

struct EqualFirst {
    template<typename TypeA, typename TypeB> bool operator()(const TypeA& a, const TypeB& b)
    {
        return a.first == b.first;
    }
};

struct CompareSecond {
    template<typename TypeA, typename TypeB> bool operator()(const TypeA& a, const TypeB& b)
    {
        return a.second < b.second;
    }
};

template<typename T> struct FirstAdapter {
    const T& first;
};
template<typename T> FirstAdapter<T> makeFirstAdapter(const T& value)
{
    return { value };
}

template<typename T> struct SecondAdapter {
    const T& second;
};
template<typename T> SecondAdapter<T> makeSecondAdapter(const T& value)
{
    return { value };
}

template<typename CollectionType> void sortByFirst(CollectionType& collection)
{
    std::sort(std::begin(collection), std::end(collection), CompareFirst {});
}

template<typename CollectionType> void stableSortByFirst(CollectionType& collection)
{
    std::stable_sort(std::begin(collection), std::end(collection), CompareFirst {});
}

template<typename CollectionType> bool isSortedByFirst(const CollectionType& collection)
{
    return std::is_sorted(std::begin(collection), std::end(collection), CompareFirst {});
}

template<typename CollectionType> bool sortedFirstsAreUnique(const CollectionType& collection)
{
    return std::adjacent_find(std::begin(collection), std::end(collection), EqualFirst {}) == std::end(collection);
}

template<typename CollectionType, typename KeyType> static auto findFirstInSortedPairs(const CollectionType& collection, const KeyType& key) -> std::optional<decltype(std::begin(collection)->second)>
{
    if constexpr (std::is_integral_v<KeyType>) {
        if (key != decltype(std::begin(collection)->first)(key))
            return std::nullopt;
    }
    auto iterator = std::lower_bound(std::begin(collection), std::end(collection), makeFirstAdapter(key), CompareFirst {});
    if (iterator == std::end(collection) || key < iterator->first)
        return std::nullopt;
    return iterator->second;
}

template<typename CollectionType, typename KeyType> static auto findInSortedPairs(const CollectionType& collection, const KeyType& key) -> std::span<std::remove_reference_t<decltype(*std::begin(collection))>>
{
    if constexpr (std::is_integral_v<KeyType>) {
        if (key != decltype(std::begin(collection)->first)(key))
            return {};
    }
    return std::ranges::equal_range(collection, makeFirstAdapter(key), CompareFirst {});
}

}
