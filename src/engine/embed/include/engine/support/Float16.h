#pragma once

#include <bit>
#include <cstdint>

namespace WTF {

// IEEE 754 binary16.
class Float16 {
public:
    constexpr operator double() const
    {
        uint64_t sign = uint64_t { m_bits & 0x8000u } << 48;
        uint64_t magnitude = m_bits & 0x7fffu;
        if (magnitude >= 0x7c00)
            return std::bit_cast<double>(sign | uint64_t { 0x7ff } << 52 | (magnitude & 0x3ff) << 42);
        if (magnitude < 0x400)
            return std::bit_cast<double>(sign | std::bit_cast<uint64_t>(magnitude * 0x1p-24));
        return std::bit_cast<double>(sign | ((magnitude << 42) + (uint64_t { 1023 - 15 } << 52)));
    }

    friend constexpr bool operator==(Float16 a, Float16 b) { return static_cast<double>(a) == static_cast<double>(b); }

private:
    uint16_t m_bits;
};

}

using WTF::Float16;
