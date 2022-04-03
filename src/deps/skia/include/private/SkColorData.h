/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkColorData_DEFINED
#define SkColorData_DEFINED

#include "include/core/SkColor.h"
#include "include/core/SkColorPriv.h"
#include "include/private/SkNx.h"
#include "include/private/SkTo.h"

////////////////////////////////////////////////////////////////////////////////////////////
// Convert a 16bit pixel to a 32bit pixel

#define SK_R16_BITS     5
#define SK_G16_BITS     6
#define SK_B16_BITS     5

#define SK_R16_SHIFT    (SK_B16_BITS + SK_G16_BITS)
#define SK_G16_SHIFT    (SK_B16_BITS)
#define SK_B16_SHIFT    0

#define SK_R16_MASK     ((1 << SK_R16_BITS) - 1)
#define SK_G16_MASK     ((1 << SK_G16_BITS) - 1)
#define SK_B16_MASK     ((1 << SK_B16_BITS) - 1)

#define SkGetPackedR16(color)   (((unsigned)(color) >> SK_R16_SHIFT) & SK_R16_MASK)
#define SkGetPackedG16(color)   (((unsigned)(color) >> SK_G16_SHIFT) & SK_G16_MASK)
#define SkGetPackedB16(color)   (((unsigned)(color) >> SK_B16_SHIFT) & SK_B16_MASK)

static inline unsigned SkR16ToR32(unsigned r) {
    return (r << (8 - SK_R16_BITS)) | (r >> (2 * SK_R16_BITS - 8));
}

static inline unsigned SkG16ToG32(unsigned g) {
    return (g << (8 - SK_G16_BITS)) | (g >> (2 * SK_G16_BITS - 8));
}

static inline unsigned SkB16ToB32(unsigned b) {
    return (b << (8 - SK_B16_BITS)) | (b >> (2 * SK_B16_BITS - 8));
}

#define SkPacked16ToR32(c)      SkR16ToR32(SkGetPackedR16(c))
#define SkPacked16ToG32(c)      SkG16ToG32(SkGetPackedG16(c))
#define SkPacked16ToB32(c)      SkB16ToB32(SkGetPackedB16(c))

//////////////////////////////////////////////////////////////////////////////

#define SkASSERT_IS_BYTE(x)     SkASSERT(0 == ((x) & ~0xFFu))

// Reverse the bytes coorsponding to RED and BLUE in a packed pixels. Note the
// pair of them are in the same 2 slots in both RGBA and BGRA, thus there is
// no need to pass in the colortype to this function.
static inline uint32_t SkSwizzle_RB(uint32_t c) {
    static const uint32_t kRBMask = (0xFF << SK_R32_SHIFT) | (0xFF << SK_B32_SHIFT);

    unsigned c0 = (c >> SK_R32_SHIFT) & 0xFF;
    unsigned c1 = (c >> SK_B32_SHIFT) & 0xFF;
    return (c & ~kRBMask) | (c0 << SK_B32_SHIFT) | (c1 << SK_R32_SHIFT);
}

static inline uint32_t SkPackARGB_as_RGBA(U8CPU a, U8CPU r, U8CPU g, U8CPU b) {
    SkASSERT_IS_BYTE(a);
    SkASSERT_IS_BYTE(r);
    SkASSERT_IS_BYTE(g);
    SkASSERT_IS_BYTE(b);
    return (a << SK_RGBA_A32_SHIFT) | (r << SK_RGBA_R32_SHIFT) |
           (g << SK_RGBA_G32_SHIFT) | (b << SK_RGBA_B32_SHIFT);
}

static inline uint32_t SkPackARGB_as_BGRA(U8CPU a, U8CPU r, U8CPU g, U8CPU b) {
    SkASSERT_IS_BYTE(a);
    SkASSERT_IS_BYTE(r);
    SkASSERT_IS_BYTE(g);
    SkASSERT_IS_BYTE(b);
    return (a << SK_BGRA_A32_SHIFT) | (r << SK_BGRA_R32_SHIFT) |
           (g << SK_BGRA_G32_SHIFT) | (b << SK_BGRA_B32_SHIFT);
}

static inline SkPMColor SkSwizzle_RGBA_to_PMColor(uint32_t c) {
#ifdef SK_PMCOLOR_IS_RGBA
    return c;
#else
    return SkSwizzle_RB(c);
#endif
}

static inline SkPMColor SkSwizzle_BGRA_to_PMColor(uint32_t c) {
#ifdef SK_PMCOLOR_IS_BGRA
    return c;
#else
    return SkSwizzle_RB(c);
#endif
}

//////////////////////////////////////////////////////////////////////////////

///@{
/** See ITU-R Recommendation BT.709 at http://www.itu.int/rec/R-REC-BT.709/ .*/
#define SK_ITU_BT709_LUM_COEFF_R (0.2126f)
#define SK_ITU_BT709_LUM_COEFF_G (0.7152f)
#define SK_ITU_BT709_LUM_COEFF_B (0.0722f)
///@}

///@{
/** A float value which specifies this channel's contribution to luminance. */
#define SK_LUM_COEFF_R SK_ITU_BT709_LUM_COEFF_R
#define SK_LUM_COEFF_G SK_ITU_BT709_LUM_COEFF_G
#define SK_LUM_COEFF_B SK_ITU_BT709_LUM_COEFF_B
///@}

/** Computes the luminance from the given r, g, and b in accordance with
    SK_LUM_COEFF_X. For correct results, r, g, and b should be in linear space.
*/
static inline U8CPU SkComputeLuminance(U8CPU r, U8CPU g, U8CPU b) {
    //The following is
    //r * SK_LUM_COEFF_R + g * SK_LUM_COEFF_G + b * SK_LUM_COEFF_B
    //with SK_LUM_COEFF_X in 1.8 fixed point (rounding adjusted to sum to 256).
    return (r * 54 + g * 183 + b * 19) >> 8;
}

/** Calculates 256 - (value * alpha256) / 255 in range [0,256],
 *  for [0,255] value and [0,256] alpha256.
 */
static inline U16CPU SkAlphaMulInv256(U16CPU value, U16CPU alpha256) {
    unsigned prod = 0xFFFF - value * alpha256;
    return (prod + (prod >> 8)) >> 8;
}

//  The caller may want negative values, so keep all params signed (int)
//  so we don't accidentally slip into unsigned math and lose the sign
//  extension when we shift (in SkAlphaMul)
static inline int SkAlphaBlend(int src, int dst, int scale256) {
    SkASSERT((unsigned)scale256 <= 256);
    return dst + SkAlphaMul(src - dst, scale256);
}

static inline uint16_t SkPackRGB16(unsigned r, unsigned g, unsigned b) {
    SkASSERT(r <= SK_R16_MASK);
    SkASSERT(g <= SK_G16_MASK);
    SkASSERT(b <= SK_B16_MASK);

    return SkToU16((r << SK_R16_SHIFT) | (g << SK_G16_SHIFT) | (b << SK_B16_SHIFT));
}

#define SK_R16_MASK_IN_PLACE        (SK_R16_MASK << SK_R16_SHIFT)
#define SK_G16_MASK_IN_PLACE        (SK_G16_MASK << SK_G16_SHIFT)
#define SK_B16_MASK_IN_PLACE        (SK_B16_MASK << SK_B16_SHIFT)

///////////////////////////////////////////////////////////////////////////////

/**
 * Abstract 4-byte interpolation, implemented on top of SkPMColor
 * utility functions. Third parameter controls blending of the first two:
 *   (src, dst, 0) returns dst
 *   (src, dst, 0xFF) returns src
 *   scale is [0..256], unlike SkFourByteInterp which takes [0..255]
 */
static inline SkPMColor SkFourByteInterp256(SkPMColor src, SkPMColor dst, int scale) {
    unsigned a = SkTo<uint8_t>(SkAlphaBlend(SkGetPackedA32(src), SkGetPackedA32(dst), scale));
    unsigned r = SkTo<uint8_t>(SkAlphaBlend(SkGetPackedR32(src), SkGetPackedR32(dst), scale));
    unsigned g = SkTo<uint8_t>(SkAlphaBlend(SkGetPackedG32(src), SkGetPackedG32(dst), scale));
    unsigned b = SkTo<uint8_t>(SkAlphaBlend(SkGetPackedB32(src), SkGetPackedB32(dst), scale));

    return SkPackARGB32(a, r, g, b);
}

/**
 * Abstract 4-byte interpolation, implemented on top of SkPMColor
 * utility functions. Third parameter controls blending of the first two:
 *   (src, dst, 0) returns dst
 *   (src, dst, 0xFF) returns src
 */
static inline SkPMColor SkFourByteInterp(SkPMColor src, SkPMColor dst, U8CPU srcWeight) {
    int scale = (int)SkAlpha255To256(srcWeight);
    return SkFourByteInterp256(src, dst, scale);
}

/**
 * 0xAARRGGBB -> 0x00AA00GG, 0x00RR00BB
 */
static inline void SkSplay(uint32_t color, uint32_t* ag, uint32_t* rb) {
    const uint32_t mask = 0x00FF00FF;
    *ag = (color >> 8) & mask;
    *rb = color & mask;
}

/**
 * 0xAARRGGBB -> 0x00AA00GG00RR00BB
 * (note, ARGB -> AGRB)
 */
static inline uint64_t SkSplay(uint32_t color) {
    const uint32_t mask = 0x00FF00FF;
    uint64_t agrb = (color >> 8) & mask;  // 0x0000000000AA00GG
    agrb <<= 32;                          // 0x00AA00GG00000000
    agrb |= color & mask;                 // 0x00AA00GG00RR00BB
    return agrb;
}

/**
 * 0xAAxxGGxx, 0xRRxxBBxx-> 0xAARRGGBB
 */
static inline uint32_t SkUnsplay(uint32_t ag, uint32_t rb) {
    const uint32_t mask = 0xFF00FF00;
    return (ag & mask) | ((rb & mask) >> 8);
}

/**
 * 0xAAxxGGxxRRxxBBxx -> 0xAARRGGBB
 * (note, AGRB -> ARGB)
 */
static inline uint32_t SkUnsplay(uint64_t agrb) {
    const uint32_t mask = 0xFF00FF00;
    return SkPMColor(
        ((agrb & mask) >> 8) |   // 0x00RR00BB
        ((agrb >> 32) & mask));  // 0xAARRGGBB
}

static inline SkPMColor SkFastFourByteInterp256_32(SkPMColor src, SkPMColor dst, unsigned scale) {
    SkASSERT(scale <= 256);

    // Two 8-bit blends per two 32-bit registers, with space to make sure the math doesn't collide.
    uint32_t src_ag, src_rb, dst_ag, dst_rb;
    SkSplay(src, &src_ag, &src_rb);
    SkSplay(dst, &dst_ag, &dst_rb);

    const uint32_t ret_ag = src_ag * scale + (256 - scale) * dst_ag;
    const uint32_t ret_rb = src_rb * scale + (256 - scale) * dst_rb;

    return SkUnsplay(ret_ag, ret_rb);
}

static inline SkPMColor SkFastFourByteInterp256_64(SkPMColor src, SkPMColor dst, unsigned scale) {
    SkASSERT(scale <= 256);
    // Four 8-bit blends in one 64-bit register, with space to make sure the math doesn't collide.
    return SkUnsplay(SkSplay(src) * scale + (256-scale) * SkSplay(dst));
}

// TODO(mtklein): Replace slow versions with fast versions, using scale + (scale>>7) everywhere.

/**
 * Same as SkFourByteInterp256, but faster.
 */
static inline SkPMColor SkFastFourByteInterp256(SkPMColor src, SkPMColor dst, unsigned scale) {
    // On a 64-bit machine, _64 is about 10% faster than _32, but ~40% slower on a 32-bit machine.
    if (sizeof(void*) == 4) {
        return SkFastFourByteInterp256_32(src, dst, scale);
    } else {
        return SkFastFourByteInterp256_64(src, dst, scale);
    }
}

/**
 * Nearly the same as SkFourByteInterp, but faster and a touch more accurate, due to better
 * srcWeight scaling to [0, 256].
 */
static inline SkPMColor SkFastFourByteInterp(SkPMColor src, SkPMColor dst, U8CPU srcWeight) {
    SkASSERT(srcWeight <= 255);
    // scale = srcWeight + (srcWeight >> 7) is more accurate than
    // scale = srcWeight + 1, but 7% slower
    return SkFastFourByteInterp256(src, dst, srcWeight + (srcWeight >> 7));
}

/**
 * Interpolates between colors src and dst using [0,256] scale.
 */
static inline SkPMColor SkPMLerp(SkPMColor src, SkPMColor dst, unsigned scale) {
    return SkFastFourByteInterp256(src, dst, scale);
}

static inline SkPMColor SkBlendARGB32(SkPMColor src, SkPMColor dst, U8CPU aa) {
    SkASSERT((unsigned)aa <= 255);

    unsigned src_scale = SkAlpha255To256(aa);
    unsigned dst_scale = SkAlphaMulInv256(SkGetPackedA32(src), src_scale);

    const uint32_t mask = 0xFF00FF;

    uint32_t src_rb = (src & mask) * src_scale;
    uint32_t src_ag = ((src >> 8) & mask) * src_scale;

    uint32_t dst_rb = (dst & mask) * dst_scale;
    uint32_t dst_ag = ((dst >> 8) & mask) * dst_scale;

    return (((src_rb + dst_rb) >> 8) & mask) | ((src_ag + dst_ag) & ~mask);
}

////////////////////////////////////////////////////////////////////////////////////////////
// Convert a 32bit pixel to a 16bit pixel (no dither)

#define SkR32ToR16_MACRO(r)   ((unsigned)(r) >> (SK_R32_BITS - SK_R16_BITS))
#define SkG32ToG16_MACRO(g)   ((unsigned)(g) >> (SK_G32_BITS - SK_G16_BITS))
#define SkB32ToB16_MACRO(b)   ((unsigned)(b) >> (SK_B32_BITS - SK_B16_BITS))

#ifdef SK_DEBUG
    static inline unsigned SkR32ToR16(unsigned r) {
        SkR32Assert(r);
        return SkR32ToR16_MACRO(r);
    }
    static inline unsigned SkG32ToG16(unsigned g) {
        SkG32Assert(g);
        return SkG32ToG16_MACRO(g);
    }
    static inline unsigned SkB32ToB16(unsigned b) {
        SkB32Assert(b);
        return SkB32ToB16_MACRO(b);
    }
#else
    #define SkR32ToR16(r)   SkR32ToR16_MACRO(r)
    #define SkG32ToG16(g)   SkG32ToG16_MACRO(g)
    #define SkB32ToB16(b)   SkB32ToB16_MACRO(b)
#endif

static inline U16CPU SkPixel32ToPixel16(SkPMColor c) {
    unsigned r = ((c >> (SK_R32_SHIFT + (8 - SK_R16_BITS))) & SK_R16_MASK) << SK_R16_SHIFT;
    unsigned g = ((c >> (SK_G32_SHIFT + (8 - SK_G16_BITS))) & SK_G16_MASK) << SK_G16_SHIFT;
    unsigned b = ((c >> (SK_B32_SHIFT + (8 - SK_B16_BITS))) & SK_B16_MASK) << SK_B16_SHIFT;
    return r | g | b;
}

static inline U16CPU SkPack888ToRGB16(U8CPU r, U8CPU g, U8CPU b) {
    return  (SkR32ToR16(r) << SK_R16_SHIFT) |
            (SkG32ToG16(g) << SK_G16_SHIFT) |
            (SkB32ToB16(b) << SK_B16_SHIFT);
}

/////////////////////////////////////////////////////////////////////////////////////////

/*  SrcOver the 32bit src color with the 16bit dst, returning a 16bit value
    (with dirt in the high 16bits, so caller beware).
*/
static inline U16CPU SkSrcOver32To16(SkPMColor src, uint16_t dst) {
    unsigned sr = SkGetPackedR32(src);
    unsigned sg = SkGetPackedG32(src);
    unsigned sb = SkGetPackedB32(src);

    unsigned dr = SkGetPackedR16(dst);
    unsigned dg = SkGetPackedG16(dst);
    unsigned db = SkGetPackedB16(dst);

    unsigned isa = 255 - SkGetPackedA32(src);

    dr = (sr + SkMul16ShiftRound(dr, isa, SK_R16_BITS)) >> (8 - SK_R16_BITS);
    dg = (sg + SkMul16ShiftRound(dg, isa, SK_G16_BITS)) >> (8 - SK_G16_BITS);
    db = (sb + SkMul16ShiftRound(db, isa, SK_B16_BITS)) >> (8 - SK_B16_BITS);

    return SkPackRGB16(dr, dg, db);
}

static inline SkColor SkPixel16ToColor(U16CPU src) {
    SkASSERT(src == SkToU16(src));

    unsigned    r = SkPacked16ToR32(src);
    unsigned    g = SkPacked16ToG32(src);
    unsigned    b = SkPacked16ToB32(src);

    SkASSERT((r >> (8 - SK_R16_BITS)) == SkGetPackedR16(src));
    SkASSERT((g >> (8 - SK_G16_BITS)) == SkGetPackedG16(src));
    SkASSERT((b >> (8 - SK_B16_BITS)) == SkGetPackedB16(src));

    return SkColorSetRGB(r, g, b);
}

///////////////////////////////////////////////////////////////////////////////

typedef uint16_t SkPMColor16;

// Put in OpenGL order (r g b a)
#define SK_A4444_SHIFT    0
#define SK_R4444_SHIFT    12
#define SK_G4444_SHIFT    8
#define SK_B4444_SHIFT    4

static inline U8CPU SkReplicateNibble(unsigned nib) {
    SkASSERT(nib <= 0xF);
    return (nib << 4) | nib;
}

#define SkGetPackedA4444(c)     (((unsigned)(c) >> SK_A4444_SHIFT) & 0xF)
#define SkGetPackedR4444(c)     (((unsigned)(c) >> SK_R4444_SHIFT) & 0xF)
#define SkGetPackedG4444(c)     (((unsigned)(c) >> SK_G4444_SHIFT) & 0xF)
#define SkGetPackedB4444(c)     (((unsigned)(c) >> SK_B4444_SHIFT) & 0xF)

#define SkPacked4444ToA32(c)    SkReplicateNibble(SkGetPackedA4444(c))

static inline SkPMColor SkPixel4444ToPixel32(U16CPU c) {
    uint32_t d = (SkGetPackedA4444(c) << SK_A32_SHIFT) |
                 (SkGetPackedR4444(c) << SK_R32_SHIFT) |
                 (SkGetPackedG4444(c) << SK_G32_SHIFT) |
                 (SkGetPackedB4444(c) << SK_B32_SHIFT);
    return d | (d << 4);
}

static inline Sk4f swizzle_rb(const Sk4f& x) {
    return SkNx_shuffle<2, 1, 0, 3>(x);
}

static inline Sk4f swizzle_rb_if_bgra(const Sk4f& x) {
#ifdef SK_PMCOLOR_IS_BGRA
    return swizzle_rb(x);
#else
    return x;
#endif
}

static inline Sk4f Sk4f_fromL32(uint32_t px) {
    return SkNx_cast<float>(Sk4b::Load(&px)) * (1 / 255.0f);
}

static inline uint32_t Sk4f_toL32(const Sk4f& px) {
    Sk4f v = px;

#if !defined(SKNX_NO_SIMD) && SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE2
    // SkNx_cast<uint8_t, int32_t>() pins, and we don't anticipate giant floats
#elif !defined(SKNX_NO_SIMD) && defined(SK_ARM_HAS_NEON)
    // SkNx_cast<uint8_t, int32_t>() pins, and so does Sk4f_round().
#else
    // No guarantee of a pin.
    v = Sk4f::Max(0, Sk4f::Min(v, 1));
#endif

    uint32_t l32;
    SkNx_cast<uint8_t>(Sk4f_round(v * 255.0f)).store(&l32);
    return l32;
}

using SkPMColor4f = SkRGBA4f<kPremul_SkAlphaType>;

constexpr SkPMColor4f SK_PMColor4fTRANSPARENT = { 0, 0, 0, 0 };
constexpr SkPMColor4f SK_PMColor4fBLACK = { 0, 0, 0, 1 };
constexpr SkPMColor4f SK_PMColor4fWHITE = { 1, 1, 1, 1 };
constexpr SkPMColor4f SK_PMColor4fILLEGAL = { SK_FloatNegativeInfinity,
                                              SK_FloatNegativeInfinity,
                                              SK_FloatNegativeInfinity,
                                              SK_FloatNegativeInfinity };

#endif
