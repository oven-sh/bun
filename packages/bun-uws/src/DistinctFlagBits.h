#pragma once

#include <cstddef>

namespace uWS::flagbits {

template <size_t N> struct Values { unsigned long long at[N]; };

/* The index of a bit that two of the values are, or -1. A value of 0 or of more than one bit (a union, a mask) takes no bit. */
template <size_t N> constexpr int sharedBit(const Values<N> &values) {
    unsigned long long taken = 0;
    for (unsigned long long value : values.at) {
        if (value & (value - 1)) continue;
        if (taken & value) return __builtin_ctzll(value);
        taken |= value;
    }
    return -1;
}

constexpr bool noTwoFlagsAre1ShiftedLeftBy(int bit) { return bit < 0; }

/* A template, so that the error prints the bit: "due to requirement 'noTwoFlagsAre1ShiftedLeftBy(23)'". */
template <int sharedBit> struct Distinct {
    static_assert(noTwoFlagsAre1ShiftedLeftBy(sharedBit), "two flags of this enum have the same bit");
};

/* UWS_DISTINCT_FLAG_BITS reads an enumerator list the way these two structs are read. */
struct DistinctExample { unsigned long long a = 1, b = 0 << 3, c = 1 << 3, d = 2 << 3, mask = 3 << 3, both = a | c, end = 0; };
struct SharedExample { unsigned long long a = 1, b = 1 << 3, both = a | b, c = 1 << 3, end = 0; };
static_assert(sharedBit(__builtin_bit_cast(Values<7>, DistinctExample {})) == -1);
static_assert(sharedBit(__builtin_bit_cast(Values<5>, SharedExample {})) == 3);

}

/* Declares `enum : Type { ... }` and fails the build when two of its single-bit values are equal. The bits are
 * numbered by hand, and git merges two branches that each add a flag on one bit without a conflict.
 * The list is pasted a second time as the members of a struct, so it needs its trailing comma and an initializer on
 * every enumerator. Declare an intended second name for a bit in an enum of its own. */
#define UWS_DISTINCT_FLAG_BITS(Type, ...) \
    enum : Type { __VA_ARGS__ }; \
    static_assert([] { \
        struct Flags { unsigned long long __VA_ARGS__ listEndsWithAComma = 0; }; \
        constexpr Flags everyFlagHasAnInitializer; \
        return sizeof(::uWS::flagbits::Distinct<::uWS::flagbits::sharedBit(__builtin_bit_cast( \
            ::uWS::flagbits::Values<sizeof(Flags) / sizeof(unsigned long long)>, everyFlagHasAnInitializer))>) != 0; \
    }())
