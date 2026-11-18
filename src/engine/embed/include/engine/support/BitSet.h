#pragma once

#include "engine/support/FastMalloc.h"

#include <array>
#include <bit>

namespace WTF {

template<size_t bitCount>
class BitSet final {
    WTF_MAKE_TZONE_ALLOCATED(BitSet);

public:
    constexpr BitSet() = default;

    static constexpr size_t size() { return bitCount; }

    constexpr bool get(size_t index) const { return m_words[wordIndex(index)] & mask(index); }
    constexpr void set(size_t index) { m_words[wordIndex(index)] |= mask(index); }
    constexpr void clear(size_t index) { m_words[wordIndex(index)] &= ~mask(index); }

    // Returns the old value.
    constexpr bool testAndSet(size_t index)
    {
        bool result = get(index);
        set(index);
        return result;
    }

    // The first bit from `start` on that has the value, or size().
    constexpr size_t findBit(size_t start, bool value) const
    {
        Word flip = value ? 0 : ~Word { 0 };
        Word candidates = ~(mask(start) - 1);
        for (size_t i = start / bitsPerWord; i < m_words.size(); ++i, candidates = ~Word { 0 }) {
            if (Word word = (m_words[i] ^ flip) & candidates)
                return std::min(i * bitsPerWord + std::countr_zero(word), bitCount);
        }
        return bitCount;
    }

    ALWAYS_INLINE constexpr void forEachSetBit(const auto& visit) const
    {
        for (size_t i = 0; i < m_words.size(); ++i) {
            for (Word word = m_words[i]; word; word &= word - 1)
                visit(i * bitsPerWord + std::countr_zero(word));
        }
    }

private:
    using Word = std::conditional_t<bitCount <= 32, uint32_t, uint64_t>;
    static constexpr size_t bitsPerWord = sizeof(Word) * 8;

    static constexpr size_t wordIndex(size_t index)
    {
        ASSERT_WITH_SECURITY_IMPLICATION(index < bitCount);
        return index / bitsPerWord;
    }
    static constexpr Word mask(size_t index) { return Word { 1 } << index % bitsPerWord; }

    std::array<Word, (bitCount + bitsPerWord - 1) / bitsPerWord> m_words {};
};

}
