#pragma once

#include "engine/text/String.h"

#include <array>

namespace WTF {

struct ComparableASCIILiteral {
    constexpr ComparableASCIILiteral(ASCIILiteral literal)
        : literal(literal)
    {
    }

    ASCIILiteral literal;
};

// A constant map of few entries, each a pair of a literal and a value.
template<typename Entry, size_t size> class SortedArrayMap {
public:
    constexpr SortedArrayMap(std::array<Entry, size>&& entries)
        : m_entries(WTF::move(entries))
    {
    }

    const typename Entry::second_type* tryGet(StringView key) const
    {
        for (auto& entry : m_entries) {
            if (key == entry.first.literal)
                return &entry.second;
        }
        return nullptr;
    }

private:
    std::array<Entry, size> m_entries;
};

}

using WTF::ComparableASCIILiteral;
using WTF::SortedArrayMap;
