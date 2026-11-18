#pragma once

#include "engine/support/OverflowHandler.h"

#include <concepts>
#include <cstdint>

namespace WTF {

// A sum that remembers whether it has ever failed to fit.
template<std::integral T>
class Checked : public RecordOverflow {
public:
    constexpr Checked(std::integral auto value) { *this += value; }

    constexpr T value() const
    {
        RELEASE_ASSERT(!hasOverflowed());
        return m_value;
    }

    constexpr Checked& operator+=(std::integral auto other)
    {
        if (__builtin_add_overflow(m_value, other, &m_value)) [[unlikely]]
            overflowed();
        return *this;
    }

private:
    T m_value { 0 };
};

using CheckedUint32 = Checked<uint32_t>;
using CheckedSize = Checked<size_t>;

}

using WTF::CheckedSize;
using WTF::CheckedUint32;
