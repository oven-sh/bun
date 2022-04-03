/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkHalf_DEFINED
#define SkHalf_DEFINED

#include "include/core/SkTypes.h"
#include "include/private/SkNx.h"

// 16-bit floating point value
// format is 1 bit sign, 5 bits exponent, 10 bits mantissa
// only used for storage
typedef uint16_t SkHalf;

static constexpr uint16_t SK_HalfMin     = 0x0400; // 2^-14  (minimum positive normal value)
static constexpr uint16_t SK_HalfMax     = 0x7bff; // 65504
static constexpr uint16_t SK_HalfEpsilon = 0x1400; // 2^-10
static constexpr uint16_t SK_Half1       = 0x3C00; // 1

// convert between half and single precision floating point
float SkHalfToFloat(SkHalf h);
SkHalf SkFloatToHalf(float f);

// Convert between half and single precision floating point,
// assuming inputs and outputs are both finite, and may
// flush values which would be denormal half floats to zero.
static inline Sk4f SkHalfToFloat_finite_ftz(uint64_t);
static inline Sk4h SkFloatToHalf_finite_ftz(const Sk4f&);

// ~~~~~~~~~~~ impl ~~~~~~~~~~~~~~ //

// Like the serial versions in SkHalf.cpp, these are based on
// https://fgiesen.wordpress.com/2012/03/28/half-to-float-done-quic/

// GCC 4.9 lacks the intrinsics to use ARMv8 f16<->f32 instructions, so we use inline assembly.

static inline Sk4f SkHalfToFloat_finite_ftz(uint64_t rgba) {
    Sk4h hs = Sk4h::Load(&rgba);
#if !defined(SKNX_NO_SIMD) && defined(SK_CPU_ARM64)
    float32x4_t fs;
    asm ("fcvtl %[fs].4s, %[hs].4h   \n"   // vcvt_f32_f16(...)
        : [fs] "=w" (fs)                   // =w: write-only NEON register
        : [hs] "w" (hs.fVec));             //  w: read-only NEON register
    return fs;
#else
    Sk4i bits     = SkNx_cast<int>(hs),  // Expand to 32 bit.
         sign     = bits & 0x00008000,   // Save the sign bit for later...
         positive = bits ^ sign,         // ...but strip it off for now.
         is_norm  = 0x03ff < positive;   // Exponent > 0?

    // For normal half floats, extend the mantissa by 13 zero bits,
    // then adjust the exponent from 15 bias to 127 bias.
    Sk4i norm = (positive << 13) + ((127 - 15) << 23);

    Sk4i merged = (sign << 16) | (norm & is_norm);
    return Sk4f::Load(&merged);
#endif
}

static inline Sk4h SkFloatToHalf_finite_ftz(const Sk4f& fs) {
#if !defined(SKNX_NO_SIMD) && defined(SK_CPU_ARM64)
    float32x4_t vec = fs.fVec;
    asm ("fcvtn %[vec].4h, %[vec].4s  \n"   // vcvt_f16_f32(vec)
        : [vec] "+w" (vec));                // +w: read-write NEON register
    return vreinterpret_u16_f32(vget_low_f32(vec));
#else
    Sk4i bits         = Sk4i::Load(&fs),
         sign         = bits & 0x80000000,      // Save the sign bit for later...
         positive     = bits ^ sign,            // ...but strip it off for now.
         will_be_norm = 0x387fdfff < positive;  // greater than largest denorm half?

    // For normal half floats, adjust the exponent from 127 bias to 15 bias,
    // then drop the bottom 13 mantissa bits.
    Sk4i norm = (positive - ((127 - 15) << 23)) >> 13;

    Sk4i merged = (sign >> 16) | (will_be_norm & norm);
    return SkNx_cast<uint16_t>(merged);
#endif
}

#endif
