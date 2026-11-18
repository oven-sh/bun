#pragma once

#include "engine/support/Vector.h"

namespace WTF {

class BitVector final {
    WTF_MAKE_TZONE_ALLOCATED(BitVector);

public:
    size_t size() const { return m_words.size() * bitsPerWord; }

    // New bits are clear.
    void ensureSize(size_t bitCount)
    {
        size_t oldSize = m_words.size();
        size_t newSize = bitCount / bitsPerWord + !!(bitCount % bitsPerWord);
        if (newSize <= oldSize)
            return;
        m_words.grow(newSize);
        std::fill(m_words.begin() + oldSize, m_words.end(), 0);
    }

    bool quickGet(size_t index) const { return m_words[index / bitsPerWord] & mask(index); }

    // Returns the old value.
    bool quickSet(size_t index)
    {
        auto& word = m_words[index / bitsPerWord];
        return std::exchange(word, word | mask(index)) & mask(index);
    }

private:
    static constexpr size_t bitsPerWord = 64;
    static uint64_t mask(size_t index) { return uint64_t { 1 } << index % bitsPerWord; }

    Vector<uint64_t, 0, CrashOnOverflow, 1> m_words;
};

}

using WTF::BitVector;
