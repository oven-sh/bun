/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkBlendMode_DEFINED
#define SkBlendMode_DEFINED

#include "include/core/SkTypes.h"

/**
 *  Blends are operators that take in two colors (source, destination) and return a new color.
 *  Many of these operate the same on all 4 components: red, green, blue, alpha. For these,
 *  we just document what happens to one component, rather than naming each one separately.
 *
 *  Different SkColorTypes have different representations for color components:
 *      8-bit: 0..255
 *      6-bit: 0..63
 *      5-bit: 0..31
 *      4-bit: 0..15
 *     floats: 0...1
 *
 *  The documentation is expressed as if the component values are always 0..1 (floats).
 *
 *  For brevity, the documentation uses the following abbreviations
 *  s  : source
 *  d  : destination
 *  sa : source alpha
 *  da : destination alpha
 *
 *  Results are abbreviated
 *  r  : if all 4 components are computed in the same manner
 *  ra : result alpha component
 *  rc : result "color": red, green, blue components
 */
enum class SkBlendMode {
    kClear,         //!< r = 0
    kSrc,           //!< r = s
    kDst,           //!< r = d
    kSrcOver,       //!< r = s + (1-sa)*d
    kDstOver,       //!< r = d + (1-da)*s
    kSrcIn,         //!< r = s * da
    kDstIn,         //!< r = d * sa
    kSrcOut,        //!< r = s * (1-da)
    kDstOut,        //!< r = d * (1-sa)
    kSrcATop,       //!< r = s*da + d*(1-sa)
    kDstATop,       //!< r = d*sa + s*(1-da)
    kXor,           //!< r = s*(1-da) + d*(1-sa)
    kPlus,          //!< r = min(s + d, 1)
    kModulate,      //!< r = s*d
    kScreen,        //!< r = s + d - s*d

    kOverlay,       //!< multiply or screen, depending on destination
    kDarken,        //!< rc = s + d - max(s*da, d*sa), ra = kSrcOver
    kLighten,       //!< rc = s + d - min(s*da, d*sa), ra = kSrcOver
    kColorDodge,    //!< brighten destination to reflect source
    kColorBurn,     //!< darken destination to reflect source
    kHardLight,     //!< multiply or screen, depending on source
    kSoftLight,     //!< lighten or darken, depending on source
    kDifference,    //!< rc = s + d - 2*(min(s*da, d*sa)), ra = kSrcOver
    kExclusion,     //!< rc = s + d - two(s*d), ra = kSrcOver
    kMultiply,      //!< r = s*(1-da) + d*(1-sa) + s*d

    kHue,           //!< hue of source with saturation and luminosity of destination
    kSaturation,    //!< saturation of source with hue and luminosity of destination
    kColor,         //!< hue and saturation of source with luminosity of destination
    kLuminosity,    //!< luminosity of source with hue and saturation of destination

    kLastCoeffMode     = kScreen,     //!< last porter duff blend mode
    kLastSeparableMode = kMultiply,   //!< last blend mode operating separately on components
    kLastMode          = kLuminosity, //!< last valid value
};

/**
 * For Porter-Duff SkBlendModes (those <= kLastCoeffMode), these coefficients describe the blend
 * equation used. Coefficient-based blend modes specify an equation:
 * ('dstCoeff' * dst + 'srcCoeff' * src), where the coefficient values are constants, functions of
 * the src or dst alpha, or functions of the src or dst color.
 */
enum class SkBlendModeCoeff {
    kZero, /** 0 */
    kOne,  /** 1 */
    kSC,   /** src color */
    kISC,  /** inverse src color (i.e. 1 - sc) */
    kDC,   /** dst color */
    kIDC,  /** inverse dst color (i.e. 1 - dc) */
    kSA,   /** src alpha */
    kISA,  /** inverse src alpha (i.e. 1 - sa) */
    kDA,   /** dst alpha */
    kIDA,  /** inverse dst alpha (i.e. 1 - da) */

    kCoeffCount
};

/**
 * Returns true if 'mode' is a coefficient-based blend mode (<= kLastCoeffMode). If true is
 * returned, the mode's src and dst coefficient functions are set in 'src' and 'dst'.
 */
SK_API bool SkBlendMode_AsCoeff(SkBlendMode mode, SkBlendModeCoeff* src, SkBlendModeCoeff* dst);


/** Returns name of blendMode as null-terminated C string.

    @return           C string
*/
SK_API const char* SkBlendMode_Name(SkBlendMode blendMode);

#endif
