/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkColor_DEFINED
#define SkColor_DEFINED

#include "include/core/SkImageInfo.h"
#include "include/core/SkScalar.h"
#include "include/core/SkTypes.h"

#include <array>

/** \file SkColor.h

    Types, consts, functions, and macros for colors.
*/

/** 8-bit type for an alpha value. 255 is 100% opaque, zero is 100% transparent.
*/
typedef uint8_t SkAlpha;

/** 32-bit ARGB color value, unpremultiplied. Color components are always in
    a known order. This is different from SkPMColor, which has its bytes in a configuration
    dependent order, to match the format of kBGRA_8888_SkColorType bitmaps. SkColor
    is the type used to specify colors in SkPaint and in gradients.

    Color that is premultiplied has the same component values as color
    that is unpremultiplied if alpha is 255, fully opaque, although may have the
    component values in a different order.
*/
typedef uint32_t SkColor;

/** Returns color value from 8-bit component values. Asserts if SK_DEBUG is defined
    if a, r, g, or b exceed 255. Since color is unpremultiplied, a may be smaller
    than the largest of r, g, and b.

    @param a  amount of alpha, from fully transparent (0) to fully opaque (255)
    @param r  amount of red, from no red (0) to full red (255)
    @param g  amount of green, from no green (0) to full green (255)
    @param b  amount of blue, from no blue (0) to full blue (255)
    @return   color and alpha, unpremultiplied
*/
static constexpr inline SkColor SkColorSetARGB(U8CPU a, U8CPU r, U8CPU g, U8CPU b) {
    return SkASSERT(a <= 255 && r <= 255 && g <= 255 && b <= 255),
           (a << 24) | (r << 16) | (g << 8) | (b << 0);
}

/** Returns color value from 8-bit component values, with alpha set
    fully opaque to 255.
*/
#define SkColorSetRGB(r, g, b)  SkColorSetARGB(0xFF, r, g, b)

/** Returns alpha byte from color value.
*/
#define SkColorGetA(color)      (((color) >> 24) & 0xFF)

/** Returns red component of color, from zero to 255.
*/
#define SkColorGetR(color)      (((color) >> 16) & 0xFF)

/** Returns green component of color, from zero to 255.
*/
#define SkColorGetG(color)      (((color) >>  8) & 0xFF)

/** Returns blue component of color, from zero to 255.
*/
#define SkColorGetB(color)      (((color) >>  0) & 0xFF)

/** Returns unpremultiplied color with red, blue, and green set from c; and alpha set
    from a. Alpha component of c is ignored and is replaced by a in result.

    @param c  packed RGB, eight bits per component
    @param a  alpha: transparent at zero, fully opaque at 255
    @return   color with transparency
*/
static constexpr inline SkColor SK_WARN_UNUSED_RESULT SkColorSetA(SkColor c, U8CPU a) {
    return (c & 0x00FFFFFF) | (a << 24);
}

/** Represents fully transparent SkAlpha value. SkAlpha ranges from zero,
    fully transparent; to 255, fully opaque.
*/
constexpr SkAlpha SK_AlphaTRANSPARENT = 0x00;

/** Represents fully opaque SkAlpha value. SkAlpha ranges from zero,
    fully transparent; to 255, fully opaque.
*/
constexpr SkAlpha SK_AlphaOPAQUE      = 0xFF;

/** Represents fully transparent SkColor. May be used to initialize a destination
    containing a mask or a non-rectangular image.
*/
constexpr SkColor SK_ColorTRANSPARENT = SkColorSetARGB(0x00, 0x00, 0x00, 0x00);

/** Represents fully opaque black.
*/
constexpr SkColor SK_ColorBLACK       = SkColorSetARGB(0xFF, 0x00, 0x00, 0x00);

/** Represents fully opaque dark gray.
    Note that SVG dark gray is equivalent to 0xFFA9A9A9.
*/
constexpr SkColor SK_ColorDKGRAY      = SkColorSetARGB(0xFF, 0x44, 0x44, 0x44);

/** Represents fully opaque gray.
    Note that HTML gray is equivalent to 0xFF808080.
*/
constexpr SkColor SK_ColorGRAY        = SkColorSetARGB(0xFF, 0x88, 0x88, 0x88);

/** Represents fully opaque light gray. HTML silver is equivalent to 0xFFC0C0C0.
    Note that SVG light gray is equivalent to 0xFFD3D3D3.
*/
constexpr SkColor SK_ColorLTGRAY      = SkColorSetARGB(0xFF, 0xCC, 0xCC, 0xCC);

/** Represents fully opaque white.
*/
constexpr SkColor SK_ColorWHITE       = SkColorSetARGB(0xFF, 0xFF, 0xFF, 0xFF);

/** Represents fully opaque red.
*/
constexpr SkColor SK_ColorRED         = SkColorSetARGB(0xFF, 0xFF, 0x00, 0x00);

/** Represents fully opaque green. HTML lime is equivalent.
    Note that HTML green is equivalent to 0xFF008000.
*/
constexpr SkColor SK_ColorGREEN       = SkColorSetARGB(0xFF, 0x00, 0xFF, 0x00);

/** Represents fully opaque blue.
*/
constexpr SkColor SK_ColorBLUE        = SkColorSetARGB(0xFF, 0x00, 0x00, 0xFF);

/** Represents fully opaque yellow.
*/
constexpr SkColor SK_ColorYELLOW      = SkColorSetARGB(0xFF, 0xFF, 0xFF, 0x00);

/** Represents fully opaque cyan. HTML aqua is equivalent.
*/
constexpr SkColor SK_ColorCYAN        = SkColorSetARGB(0xFF, 0x00, 0xFF, 0xFF);

/** Represents fully opaque magenta. HTML fuchsia is equivalent.
*/
constexpr SkColor SK_ColorMAGENTA     = SkColorSetARGB(0xFF, 0xFF, 0x00, 0xFF);

/** Converts RGB to its HSV components.
    hsv[0] contains hsv hue, a value from zero to less than 360.
    hsv[1] contains hsv saturation, a value from zero to one.
    hsv[2] contains hsv value, a value from zero to one.

    @param red    red component value from zero to 255
    @param green  green component value from zero to 255
    @param blue   blue component value from zero to 255
    @param hsv    three element array which holds the resulting HSV components
*/
SK_API void SkRGBToHSV(U8CPU red, U8CPU green, U8CPU blue, SkScalar hsv[3]);

/** Converts ARGB to its HSV components. Alpha in ARGB is ignored.
    hsv[0] contains hsv hue, and is assigned a value from zero to less than 360.
    hsv[1] contains hsv saturation, a value from zero to one.
    hsv[2] contains hsv value, a value from zero to one.

    @param color  ARGB color to convert
    @param hsv    three element array which holds the resulting HSV components
*/
static inline void SkColorToHSV(SkColor color, SkScalar hsv[3]) {
    SkRGBToHSV(SkColorGetR(color), SkColorGetG(color), SkColorGetB(color), hsv);
}

/** Converts HSV components to an ARGB color. Alpha is passed through unchanged.
    hsv[0] represents hsv hue, an angle from zero to less than 360.
    hsv[1] represents hsv saturation, and varies from zero to one.
    hsv[2] represents hsv value, and varies from zero to one.

    Out of range hsv values are pinned.

    @param alpha  alpha component of the returned ARGB color
    @param hsv    three element array which holds the input HSV components
    @return       ARGB equivalent to HSV
*/
SK_API SkColor SkHSVToColor(U8CPU alpha, const SkScalar hsv[3]);

/** Converts HSV components to an ARGB color. Alpha is set to 255.
    hsv[0] represents hsv hue, an angle from zero to less than 360.
    hsv[1] represents hsv saturation, and varies from zero to one.
    hsv[2] represents hsv value, and varies from zero to one.

    Out of range hsv values are pinned.

    @param hsv  three element array which holds the input HSV components
    @return     RGB equivalent to HSV
*/
static inline SkColor SkHSVToColor(const SkScalar hsv[3]) {
    return SkHSVToColor(0xFF, hsv);
}

/** 32-bit ARGB color value, premultiplied. The byte order for this value is
    configuration dependent, matching the format of kBGRA_8888_SkColorType bitmaps.
    This is different from SkColor, which is unpremultiplied, and is always in the
    same byte order.
*/
typedef uint32_t SkPMColor;

/** Returns a SkPMColor value from unpremultiplied 8-bit component values.

    @param a  amount of alpha, from fully transparent (0) to fully opaque (255)
    @param r  amount of red, from no red (0) to full red (255)
    @param g  amount of green, from no green (0) to full green (255)
    @param b  amount of blue, from no blue (0) to full blue (255)
    @return   premultiplied color
*/
SK_API SkPMColor SkPreMultiplyARGB(U8CPU a, U8CPU r, U8CPU g, U8CPU b);

/** Returns pmcolor closest to color c. Multiplies c RGB components by the c alpha,
    and arranges the bytes to match the format of kN32_SkColorType.

    @param c  unpremultiplied ARGB color
    @return   premultiplied color
*/
SK_API SkPMColor SkPreMultiplyColor(SkColor c);

/** \enum SkColorChannel
    Describes different color channels one can manipulate
*/
enum class SkColorChannel {
    kR,  // the red channel
    kG,  // the green channel
    kB,  // the blue channel
    kA,  // the alpha channel

    kLastEnum = kA,
};

/** Used to represent the channels available in a color type or texture format as a mask. */
enum SkColorChannelFlag : uint32_t {
    kRed_SkColorChannelFlag    = 1 << static_cast<uint32_t>(SkColorChannel::kR),
    kGreen_SkColorChannelFlag  = 1 << static_cast<uint32_t>(SkColorChannel::kG),
    kBlue_SkColorChannelFlag   = 1 << static_cast<uint32_t>(SkColorChannel::kB),
    kAlpha_SkColorChannelFlag  = 1 << static_cast<uint32_t>(SkColorChannel::kA),
    kGray_SkColorChannelFlag   = 0x10,
    // Convenience values
    kGrayAlpha_SkColorChannelFlags = kGray_SkColorChannelFlag | kAlpha_SkColorChannelFlag,
    kRG_SkColorChannelFlags        = kRed_SkColorChannelFlag | kGreen_SkColorChannelFlag,
    kRGB_SkColorChannelFlags       = kRG_SkColorChannelFlags | kBlue_SkColorChannelFlag,
    kRGBA_SkColorChannelFlags      = kRGB_SkColorChannelFlags | kAlpha_SkColorChannelFlag,
};
static_assert(0 == (kGray_SkColorChannelFlag & kRGBA_SkColorChannelFlags), "bitfield conflict");

/** \struct SkRGBA4f
    RGBA color value, holding four floating point components. Color components are always in
    a known order. kAT determines if the SkRGBA4f's R, G, and B components are premultiplied
    by alpha or not.

    Skia's public API always uses unpremultiplied colors, which can be stored as
    SkRGBA4f<kUnpremul_SkAlphaType>. For convenience, this type can also be referred to
    as SkColor4f.
*/
template <SkAlphaType kAT>
struct SkRGBA4f {
    float fR;  //!< red component
    float fG;  //!< green component
    float fB;  //!< blue component
    float fA;  //!< alpha component

    /** Compares SkRGBA4f with other, and returns true if all components are equal.

        @param other  SkRGBA4f to compare
        @return       true if SkRGBA4f equals other
    */
    bool operator==(const SkRGBA4f& other) const {
        return fA == other.fA && fR == other.fR && fG == other.fG && fB == other.fB;
    }

    /** Compares SkRGBA4f with other, and returns true if not all components are equal.

        @param other  SkRGBA4f to compare
        @return       true if SkRGBA4f is not equal to other
    */
    bool operator!=(const SkRGBA4f& other) const {
        return !(*this == other);
    }

    /** Returns SkRGBA4f multiplied by scale.

        @param scale  value to multiply by
        @return       SkRGBA4f as (fR * scale, fG * scale, fB * scale, fA * scale)
    */
    SkRGBA4f operator*(float scale) const {
        return { fR * scale, fG * scale, fB * scale, fA * scale };
    }

    /** Returns SkRGBA4f multiplied component-wise by scale.

        @param scale  SkRGBA4f to multiply by
        @return       SkRGBA4f as (fR * scale.fR, fG * scale.fG, fB * scale.fB, fA * scale.fA)
    */
    SkRGBA4f operator*(const SkRGBA4f& scale) const {
        return { fR * scale.fR, fG * scale.fG, fB * scale.fB, fA * scale.fA };
    }

    /** Returns a pointer to components of SkRGBA4f, for array access.

        @return       pointer to array [fR, fG, fB, fA]
    */
    const float* vec() const { return &fR; }

    /** Returns a pointer to components of SkRGBA4f, for array access.

        @return       pointer to array [fR, fG, fB, fA]
    */
    float* vec() { return &fR; }

    /** As a std::array<float, 4> */
    std::array<float, 4> array() const { return {fR, fG, fB, fA}; }

    /** Returns one component. Asserts if index is out of range and SK_DEBUG is defined.

        @param index  one of: 0 (fR), 1 (fG), 2 (fB), 3 (fA)
        @return       value corresponding to index
    */
    float operator[](int index) const {
        SkASSERT(index >= 0 && index < 4);
        return this->vec()[index];
    }

    /** Returns one component. Asserts if index is out of range and SK_DEBUG is defined.

        @param index  one of: 0 (fR), 1 (fG), 2 (fB), 3 (fA)
        @return       value corresponding to index
    */
    float& operator[](int index) {
        SkASSERT(index >= 0 && index < 4);
        return this->vec()[index];
    }

    /** Returns true if SkRGBA4f is an opaque color. Asserts if fA is out of range and
        SK_DEBUG is defined.

        @return       true if SkRGBA4f is opaque
    */
    bool isOpaque() const {
        SkASSERT(fA <= 1.0f && fA >= 0.0f);
        return fA == 1.0f;
    }

    /** Returns true if all channels are in [0, 1]. */
    bool fitsInBytes() const {
        SkASSERT(fA >= 0.0f && fA <= 1.0f);
        return fR >= 0.0f && fR <= 1.0f &&
               fG >= 0.0f && fG <= 1.0f &&
               fB >= 0.0f && fB <= 1.0f;
    }

    /** Returns closest SkRGBA4f to SkColor. Only allowed if SkRGBA4f is unpremultiplied.

        @param color   Color with Alpha, red, blue, and green components
        @return        SkColor as SkRGBA4f

        example: https://fiddle.skia.org/c/@RGBA4f_FromColor
    */
    static SkRGBA4f FromColor(SkColor color);  // impl. depends on kAT

    /** Returns closest SkColor to SkRGBA4f. Only allowed if SkRGBA4f is unpremultiplied.

        @return       color as SkColor

        example: https://fiddle.skia.org/c/@RGBA4f_toSkColor
    */
    SkColor toSkColor() const;  // impl. depends on kAT

    /** Returns closest SkRGBA4f to SkPMColor. Only allowed if SkRGBA4f is premultiplied.

        @return        SkPMColor as SkRGBA4f
    */
    static SkRGBA4f FromPMColor(SkPMColor);  // impl. depends on kAT

    /** Returns SkRGBA4f premultiplied by alpha. Asserts at compile time if SkRGBA4f is
        already premultiplied.

        @return       premultiplied color
    */
    SkRGBA4f<kPremul_SkAlphaType> premul() const {
        static_assert(kAT == kUnpremul_SkAlphaType, "");
        return { fR * fA, fG * fA, fB * fA, fA };
    }

    /** Returns SkRGBA4f unpremultiplied by alpha. Asserts at compile time if SkRGBA4f is
        already unpremultiplied.

        @return       unpremultiplied color
    */
    SkRGBA4f<kUnpremul_SkAlphaType> unpremul() const {
        static_assert(kAT == kPremul_SkAlphaType, "");

        if (fA == 0.0f) {
            return { 0, 0, 0, 0 };
        } else {
            float invAlpha = 1 / fA;
            return { fR * invAlpha, fG * invAlpha, fB * invAlpha, fA };
        }
    }

    // This produces bytes in RGBA order (eg GrColor). Impl. is the same, regardless of kAT
    uint32_t toBytes_RGBA() const;
    static SkRGBA4f FromBytes_RGBA(uint32_t color);

    SkRGBA4f makeOpaque() const {
        return { fR, fG, fB, 1.0f };
    }
};

/** \struct SkColor4f
    RGBA color value, holding four floating point components. Color components are always in
    a known order, and are unpremultiplied.

    This is a specialization of SkRGBA4f. For details, @see SkRGBA4f.
*/
using SkColor4f = SkRGBA4f<kUnpremul_SkAlphaType>;

template <> SK_API SkColor4f SkColor4f::FromColor(SkColor);
template <> SK_API SkColor   SkColor4f::toSkColor() const;

namespace SkColors {
constexpr SkColor4f kTransparent = {0, 0, 0, 0};
constexpr SkColor4f kBlack       = {0, 0, 0, 1};
constexpr SkColor4f kDkGray      = {0.25f, 0.25f, 0.25f, 1};
constexpr SkColor4f kGray        = {0.50f, 0.50f, 0.50f, 1};
constexpr SkColor4f kLtGray      = {0.75f, 0.75f, 0.75f, 1};
constexpr SkColor4f kWhite       = {1, 1, 1, 1};
constexpr SkColor4f kRed         = {1, 0, 0, 1};
constexpr SkColor4f kGreen       = {0, 1, 0, 1};
constexpr SkColor4f kBlue        = {0, 0, 1, 1};
constexpr SkColor4f kYellow      = {1, 1, 0, 1};
constexpr SkColor4f kCyan        = {0, 1, 1, 1};
constexpr SkColor4f kMagenta     = {1, 0, 1, 1};
}  // namespace SkColors
#endif
