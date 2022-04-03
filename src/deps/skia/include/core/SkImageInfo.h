/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkImageInfo_DEFINED
#define SkImageInfo_DEFINED

#include "include/core/SkColorSpace.h"
#include "include/core/SkMath.h"
#include "include/core/SkRect.h"
#include "include/core/SkSize.h"

#include "include/private/SkTFitsIn.h"
#include "include/private/SkTo.h"

class SkReadBuffer;
class SkWriteBuffer;

/** \enum SkImageInfo::SkAlphaType
    Describes how to interpret the alpha component of a pixel. A pixel may
    be opaque, or alpha, describing multiple levels of transparency.

    In simple blending, alpha weights the draw color and the destination
    color to create a new color. If alpha describes a weight from zero to one:

    new color = draw color * alpha + destination color * (1 - alpha)

    In practice alpha is encoded in two or more bits, where 1.0 equals all bits set.

    RGB may have alpha included in each component value; the stored
    value is the original RGB multiplied by alpha. Premultiplied color
    components improve performance.
*/
enum SkAlphaType : int {
    kUnknown_SkAlphaType,                          //!< uninitialized
    kOpaque_SkAlphaType,                           //!< pixel is opaque
    kPremul_SkAlphaType,                           //!< pixel components are premultiplied by alpha
    kUnpremul_SkAlphaType,                         //!< pixel components are independent of alpha
    kLastEnum_SkAlphaType = kUnpremul_SkAlphaType, //!< last valid value
};

/** Returns true if SkAlphaType equals kOpaque_SkAlphaType.

    kOpaque_SkAlphaType is a hint that the SkColorType is opaque, or that all
    alpha values are set to their 1.0 equivalent. If SkAlphaType is
    kOpaque_SkAlphaType, and SkColorType is not opaque, then the result of
    drawing any pixel with a alpha value less than 1.0 is undefined.
*/
static inline bool SkAlphaTypeIsOpaque(SkAlphaType at) {
    return kOpaque_SkAlphaType == at;
}

///////////////////////////////////////////////////////////////////////////////

/** \enum SkImageInfo::SkColorType
    Describes how pixel bits encode color. A pixel may be an alpha mask, a grayscale, RGB, or ARGB.

    kN32_SkColorType selects the native 32-bit ARGB format for the current configuration. This can
    lead to inconsistent results across platforms, so use with caution.
*/
enum SkColorType : int {
    kUnknown_SkColorType,      //!< uninitialized
    kAlpha_8_SkColorType,      //!< pixel with alpha in 8-bit byte
    kRGB_565_SkColorType,      //!< pixel with 5 bits red, 6 bits green, 5 bits blue, in 16-bit word
    kARGB_4444_SkColorType,    //!< pixel with 4 bits for alpha, red, green, blue; in 16-bit word
    kRGBA_8888_SkColorType,    //!< pixel with 8 bits for red, green, blue, alpha; in 32-bit word
    kRGB_888x_SkColorType,     //!< pixel with 8 bits each for red, green, blue; in 32-bit word
    kBGRA_8888_SkColorType,    //!< pixel with 8 bits for blue, green, red, alpha; in 32-bit word
    kRGBA_1010102_SkColorType, //!< 10 bits for red, green, blue; 2 bits for alpha; in 32-bit word
    kBGRA_1010102_SkColorType, //!< 10 bits for blue, green, red; 2 bits for alpha; in 32-bit word
    kRGB_101010x_SkColorType,  //!< pixel with 10 bits each for red, green, blue; in 32-bit word
    kBGR_101010x_SkColorType,  //!< pixel with 10 bits each for blue, green, red; in 32-bit word
    kGray_8_SkColorType,       //!< pixel with grayscale level in 8-bit byte
    kRGBA_F16Norm_SkColorType, //!< pixel with half floats in [0,1] for red, green, blue, alpha;
                               //   in 64-bit word
    kRGBA_F16_SkColorType,     //!< pixel with half floats for red, green, blue, alpha;
                               //   in 64-bit word
    kRGBA_F32_SkColorType,     //!< pixel using C float for red, green, blue, alpha; in 128-bit word

    // The following 6 colortypes are just for reading from - not for rendering to
    kR8G8_unorm_SkColorType,         //!< pixel with a uint8_t for red and green

    kA16_float_SkColorType,          //!< pixel with a half float for alpha
    kR16G16_float_SkColorType,       //!< pixel with a half float for red and green

    kA16_unorm_SkColorType,          //!< pixel with a little endian uint16_t for alpha
    kR16G16_unorm_SkColorType,       //!< pixel with a little endian uint16_t for red and green
    kR16G16B16A16_unorm_SkColorType, //!< pixel with a little endian uint16_t for red, green, blue
                                     //   and alpha

    kSRGBA_8888_SkColorType,

    kLastEnum_SkColorType     = kSRGBA_8888_SkColorType, //!< last valid value

#if SK_PMCOLOR_BYTE_ORDER(B,G,R,A)
    kN32_SkColorType          = kBGRA_8888_SkColorType,//!< native 32-bit BGRA encoding

#elif SK_PMCOLOR_BYTE_ORDER(R,G,B,A)
    kN32_SkColorType          = kRGBA_8888_SkColorType,//!< native 32-bit RGBA encoding

#else
    #error "SK_*32_SHIFT values must correspond to BGRA or RGBA byte order"
#endif
};

/** Returns the number of bytes required to store a pixel, including unused padding.
    Returns zero if ct is kUnknown_SkColorType or invalid.

    @return    bytes per pixel
*/
SK_API int SkColorTypeBytesPerPixel(SkColorType ct);

/** Returns true if SkColorType always decodes alpha to 1.0, making the pixel
    fully opaque. If true, SkColorType does not reserve bits to encode alpha.

    @return    true if alpha is always set to 1.0
*/
SK_API bool SkColorTypeIsAlwaysOpaque(SkColorType ct);

/** Returns true if canonical can be set to a valid SkAlphaType for colorType. If
    there is more than one valid canonical SkAlphaType, set to alphaType, if valid.
    If true is returned and canonical is not nullptr, store valid SkAlphaType.

    Returns false only if alphaType is kUnknown_SkAlphaType, color type is not
    kUnknown_SkColorType, and SkColorType is not always opaque. If false is returned,
    canonical is ignored.

    @param canonical  storage for SkAlphaType
    @return           true if valid SkAlphaType can be associated with colorType
*/
SK_API bool SkColorTypeValidateAlphaType(SkColorType colorType, SkAlphaType alphaType,
                                         SkAlphaType* canonical = nullptr);

/** \enum SkImageInfo::SkYUVColorSpace
    Describes color range of YUV pixels. The color mapping from YUV to RGB varies
    depending on the source. YUV pixels may be generated by JPEG images, standard
    video streams, or high definition video streams. Each has its own mapping from
    YUV to RGB.

    JPEG YUV values encode the full range of 0 to 255 for all three components.
    Video YUV values often range from 16 to 235 for Y and from 16 to 240 for U and V (limited).
    Details of encoding and conversion to RGB are described in YCbCr color space.

    The identity colorspace exists to provide a utility mapping from Y to R, U to G and V to B.
    It can be used to visualize the YUV planes or to explicitly post process the YUV channels.
*/
enum SkYUVColorSpace : int {
    kJPEG_Full_SkYUVColorSpace,                 //!< describes full range
    kRec601_Limited_SkYUVColorSpace,            //!< describes SDTV range
    kRec709_Full_SkYUVColorSpace,               //!< describes HDTV range
    kRec709_Limited_SkYUVColorSpace,
    kBT2020_8bit_Full_SkYUVColorSpace,          //!< describes UHDTV range, non-constant-luminance
    kBT2020_8bit_Limited_SkYUVColorSpace,
    kBT2020_10bit_Full_SkYUVColorSpace,
    kBT2020_10bit_Limited_SkYUVColorSpace,
    kBT2020_12bit_Full_SkYUVColorSpace,
    kBT2020_12bit_Limited_SkYUVColorSpace,
    kIdentity_SkYUVColorSpace,                  //!< maps Y->R, U->G, V->B

    kLastEnum_SkYUVColorSpace = kIdentity_SkYUVColorSpace, //!< last valid value

    // Legacy (deprecated) names:
    kJPEG_SkYUVColorSpace = kJPEG_Full_SkYUVColorSpace,
    kRec601_SkYUVColorSpace = kRec601_Limited_SkYUVColorSpace,
    kRec709_SkYUVColorSpace = kRec709_Limited_SkYUVColorSpace,
    kBT2020_SkYUVColorSpace = kBT2020_8bit_Limited_SkYUVColorSpace,
};

/** \struct SkColorInfo
    Describes pixel and encoding. SkImageInfo can be created from SkColorInfo by
    providing dimensions.

    It encodes how pixel bits describe alpha, transparency; color components red, blue,
    and green; and SkColorSpace, the range and linearity of colors.
*/
class SK_API SkColorInfo {
public:
    /** Creates an SkColorInfo with kUnknown_SkColorType, kUnknown_SkAlphaType,
        and no SkColorSpace.

        @return  empty SkImageInfo
    */
    SkColorInfo() = default;

    /** Creates SkColorInfo from SkColorType ct, SkAlphaType at, and optionally SkColorSpace cs.

        If SkColorSpace cs is nullptr and SkColorInfo is part of drawing source: SkColorSpace
        defaults to sRGB, mapping into SkSurface SkColorSpace.

        Parameters are not validated to see if their values are legal, or that the
        combination is supported.
        @return        created SkColorInfo
    */
    SkColorInfo(SkColorType ct, SkAlphaType at, sk_sp<SkColorSpace> cs)
            : fColorSpace(std::move(cs)), fColorType(ct), fAlphaType(at) {}

    SkColorInfo(const SkColorInfo&) = default;
    SkColorInfo(SkColorInfo&&) = default;

    SkColorInfo& operator=(const SkColorInfo&) = default;
    SkColorInfo& operator=(SkColorInfo&&) = default;

    SkColorSpace* colorSpace() const { return fColorSpace.get(); }
    sk_sp<SkColorSpace> refColorSpace() const { return fColorSpace; }
    SkColorType colorType() const { return fColorType; }
    SkAlphaType alphaType() const { return fAlphaType; }

    bool isOpaque() const {
        return SkAlphaTypeIsOpaque(fAlphaType)
            || SkColorTypeIsAlwaysOpaque(fColorType);
    }

    bool gammaCloseToSRGB() const { return fColorSpace && fColorSpace->gammaCloseToSRGB(); }

    /** Does other represent the same color type, alpha type, and color space? */
    bool operator==(const SkColorInfo& other) const {
        return fColorType == other.fColorType && fAlphaType == other.fAlphaType &&
               SkColorSpace::Equals(fColorSpace.get(), other.fColorSpace.get());
    }

    /** Does other represent a different color type, alpha type, or color space? */
    bool operator!=(const SkColorInfo& other) const { return !(*this == other); }

    /** Creates SkColorInfo with same SkColorType, SkColorSpace, with SkAlphaType set
        to newAlphaType.

        Created SkColorInfo contains newAlphaType even if it is incompatible with
        SkColorType, in which case SkAlphaType in SkColorInfo is ignored.
    */
    SkColorInfo makeAlphaType(SkAlphaType newAlphaType) const {
        return SkColorInfo(this->colorType(), newAlphaType, this->refColorSpace());
    }

    /** Creates new SkColorInfo with same SkAlphaType, SkColorSpace, with SkColorType
        set to newColorType.
    */
    SkColorInfo makeColorType(SkColorType newColorType) const {
        return SkColorInfo(newColorType, this->alphaType(), this->refColorSpace());
    }

    /** Creates SkColorInfo with same SkAlphaType, SkColorType, with SkColorSpace
        set to cs. cs may be nullptr.
    */
    SkColorInfo makeColorSpace(sk_sp<SkColorSpace> cs) const {
        return SkColorInfo(this->colorType(), this->alphaType(), std::move(cs));
    }

    /** Returns number of bytes per pixel required by SkColorType.
        Returns zero if colorType() is kUnknown_SkColorType.

        @return  bytes in pixel

        example: https://fiddle.skia.org/c/@ImageInfo_bytesPerPixel
    */
    int bytesPerPixel() const;

    /** Returns bit shift converting row bytes to row pixels.
        Returns zero for kUnknown_SkColorType.

        @return  one of: 0, 1, 2, 3, 4; left shift to convert pixels to bytes

        example: https://fiddle.skia.org/c/@ImageInfo_shiftPerPixel
    */
    int shiftPerPixel() const;

private:
    sk_sp<SkColorSpace> fColorSpace;
    SkColorType fColorType = kUnknown_SkColorType;
    SkAlphaType fAlphaType = kUnknown_SkAlphaType;
};

/** \struct SkImageInfo
    Describes pixel dimensions and encoding. SkBitmap, SkImage, PixMap, and SkSurface
    can be created from SkImageInfo. SkImageInfo can be retrieved from SkBitmap and
    SkPixmap, but not from SkImage and SkSurface. For example, SkImage and SkSurface
    implementations may defer pixel depth, so may not completely specify SkImageInfo.

    SkImageInfo contains dimensions, the pixel integral width and height. It encodes
    how pixel bits describe alpha, transparency; color components red, blue,
    and green; and SkColorSpace, the range and linearity of colors.
*/
struct SK_API SkImageInfo {
public:

    /** Creates an empty SkImageInfo with kUnknown_SkColorType, kUnknown_SkAlphaType,
        a width and height of zero, and no SkColorSpace.

        @return  empty SkImageInfo
    */
    SkImageInfo() = default;

    /** Creates SkImageInfo from integral dimensions width and height, SkColorType ct,
        SkAlphaType at, and optionally SkColorSpace cs.

        If SkColorSpace cs is nullptr and SkImageInfo is part of drawing source: SkColorSpace
        defaults to sRGB, mapping into SkSurface SkColorSpace.

        Parameters are not validated to see if their values are legal, or that the
        combination is supported.

        @param width   pixel column count; must be zero or greater
        @param height  pixel row count; must be zero or greater
        @param cs      range of colors; may be nullptr
        @return        created SkImageInfo
    */
    static SkImageInfo Make(int width, int height, SkColorType ct, SkAlphaType at,
                            sk_sp<SkColorSpace> cs = nullptr) {
        return SkImageInfo({width, height}, {ct, at, std::move(cs)});
    }
    static SkImageInfo Make(SkISize dimensions, SkColorType ct, SkAlphaType at,
                            sk_sp<SkColorSpace> cs = nullptr) {
        return SkImageInfo(dimensions, {ct, at, std::move(cs)});
    }

    /** Creates SkImageInfo from integral dimensions and SkColorInfo colorInfo,

        Parameters are not validated to see if their values are legal, or that the
        combination is supported.

        @param dimensions   pixel column and row count; must be zeros or greater
        @param SkColorInfo  the pixel encoding consisting of SkColorType, SkAlphaType, and
                            SkColorSpace (which may be nullptr)
        @return        created SkImageInfo
    */
    static SkImageInfo Make(SkISize dimensions, const SkColorInfo& colorInfo) {
        return SkImageInfo(dimensions, colorInfo);
    }
    static SkImageInfo Make(SkISize dimensions, SkColorInfo&& colorInfo) {
        return SkImageInfo(dimensions, std::move(colorInfo));
    }

    /** Creates SkImageInfo from integral dimensions width and height, kN32_SkColorType,
        SkAlphaType at, and optionally SkColorSpace cs. kN32_SkColorType will equal either
        kBGRA_8888_SkColorType or kRGBA_8888_SkColorType, whichever is optimal.

        If SkColorSpace cs is nullptr and SkImageInfo is part of drawing source: SkColorSpace
        defaults to sRGB, mapping into SkSurface SkColorSpace.

        Parameters are not validated to see if their values are legal, or that the
        combination is supported.

        @param width   pixel column count; must be zero or greater
        @param height  pixel row count; must be zero or greater
        @param cs      range of colors; may be nullptr
        @return        created SkImageInfo
    */
    static SkImageInfo MakeN32(int width, int height, SkAlphaType at,
                               sk_sp<SkColorSpace> cs = nullptr) {
        return Make({width, height}, kN32_SkColorType, at, std::move(cs));
    }

    /** Creates SkImageInfo from integral dimensions width and height, kN32_SkColorType,
        SkAlphaType at, with sRGB SkColorSpace.

        Parameters are not validated to see if their values are legal, or that the
        combination is supported.

        @param width   pixel column count; must be zero or greater
        @param height  pixel row count; must be zero or greater
        @return        created SkImageInfo

        example: https://fiddle.skia.org/c/@ImageInfo_MakeS32
    */
    static SkImageInfo MakeS32(int width, int height, SkAlphaType at);

    /** Creates SkImageInfo from integral dimensions width and height, kN32_SkColorType,
        kPremul_SkAlphaType, with optional SkColorSpace.

        If SkColorSpace cs is nullptr and SkImageInfo is part of drawing source: SkColorSpace
        defaults to sRGB, mapping into SkSurface SkColorSpace.

        Parameters are not validated to see if their values are legal, or that the
        combination is supported.

        @param width   pixel column count; must be zero or greater
        @param height  pixel row count; must be zero or greater
        @param cs      range of colors; may be nullptr
        @return        created SkImageInfo
    */
    static SkImageInfo MakeN32Premul(int width, int height, sk_sp<SkColorSpace> cs = nullptr) {
        return Make({width, height}, kN32_SkColorType, kPremul_SkAlphaType, std::move(cs));
    }

    /** Creates SkImageInfo from integral dimensions width and height, kN32_SkColorType,
        kPremul_SkAlphaType, with SkColorSpace set to nullptr.

        If SkImageInfo is part of drawing source: SkColorSpace defaults to sRGB, mapping
        into SkSurface SkColorSpace.

        Parameters are not validated to see if their values are legal, or that the
        combination is supported.

        @param dimensions  width and height, each must be zero or greater
        @param cs          range of colors; may be nullptr
        @return            created SkImageInfo
    */
    static SkImageInfo MakeN32Premul(SkISize dimensions, sk_sp<SkColorSpace> cs = nullptr) {
        return Make(dimensions, kN32_SkColorType, kPremul_SkAlphaType, std::move(cs));
    }

    /** Creates SkImageInfo from integral dimensions width and height, kAlpha_8_SkColorType,
        kPremul_SkAlphaType, with SkColorSpace set to nullptr.

        @param width   pixel column count; must be zero or greater
        @param height  pixel row count; must be zero or greater
        @return        created SkImageInfo
    */
    static SkImageInfo MakeA8(int width, int height) {
        return Make({width, height}, kAlpha_8_SkColorType, kPremul_SkAlphaType, nullptr);
    }
    /** Creates SkImageInfo from integral dimensions, kAlpha_8_SkColorType,
        kPremul_SkAlphaType, with SkColorSpace set to nullptr.

        @param dimensions   pixel row and column count; must be zero or greater
        @return             created SkImageInfo
    */
    static SkImageInfo MakeA8(SkISize dimensions) {
        return Make(dimensions, kAlpha_8_SkColorType, kPremul_SkAlphaType, nullptr);
    }

    /** Creates SkImageInfo from integral dimensions width and height, kUnknown_SkColorType,
        kUnknown_SkAlphaType, with SkColorSpace set to nullptr.

        Returned SkImageInfo as part of source does not draw, and as part of destination
        can not be drawn to.

        @param width   pixel column count; must be zero or greater
        @param height  pixel row count; must be zero or greater
        @return        created SkImageInfo
    */
    static SkImageInfo MakeUnknown(int width, int height) {
        return Make({width, height}, kUnknown_SkColorType, kUnknown_SkAlphaType, nullptr);
    }

    /** Creates SkImageInfo from integral dimensions width and height set to zero,
        kUnknown_SkColorType, kUnknown_SkAlphaType, with SkColorSpace set to nullptr.

        Returned SkImageInfo as part of source does not draw, and as part of destination
        can not be drawn to.

        @return  created SkImageInfo
    */
    static SkImageInfo MakeUnknown() {
        return MakeUnknown(0, 0);
    }

    /** Returns pixel count in each row.

        @return  pixel width
    */
    int width() const { return fDimensions.width(); }

    /** Returns pixel row count.

        @return  pixel height
    */
    int height() const { return fDimensions.height(); }

    SkColorType colorType() const { return fColorInfo.colorType(); }

    SkAlphaType alphaType() const { return fColorInfo.alphaType(); }

    /** Returns SkColorSpace, the range of colors. The reference count of
        SkColorSpace is unchanged. The returned SkColorSpace is immutable.

        @return  SkColorSpace, or nullptr
    */
    SkColorSpace* colorSpace() const { return fColorInfo.colorSpace(); }

    /** Returns smart pointer to SkColorSpace, the range of colors. The smart pointer
        tracks the number of objects sharing this SkColorSpace reference so the memory
        is released when the owners destruct.

        The returned SkColorSpace is immutable.

        @return  SkColorSpace wrapped in a smart pointer
    */
    sk_sp<SkColorSpace> refColorSpace() const { return fColorInfo.refColorSpace(); }

    /** Returns if SkImageInfo describes an empty area of pixels by checking if either
        width or height is zero or smaller.

        @return  true if either dimension is zero or smaller
    */
    bool isEmpty() const { return fDimensions.isEmpty(); }

    /** Returns the dimensionless SkColorInfo that represents the same color type,
        alpha type, and color space as this SkImageInfo.
     */
    const SkColorInfo& colorInfo() const { return fColorInfo; }

    /** Returns true if SkAlphaType is set to hint that all pixels are opaque; their
        alpha value is implicitly or explicitly 1.0. If true, and all pixels are
        not opaque, Skia may draw incorrectly.

        Does not check if SkColorType allows alpha, or if any pixel value has
        transparency.

        @return  true if SkAlphaType is kOpaque_SkAlphaType
    */
    bool isOpaque() const { return fColorInfo.isOpaque(); }

    /** Returns SkISize { width(), height() }.

        @return  integral size of width() and height()
    */
    SkISize dimensions() const { return fDimensions; }

    /** Returns SkIRect { 0, 0, width(), height() }.

        @return  integral rectangle from origin to width() and height()
    */
    SkIRect bounds() const { return SkIRect::MakeSize(fDimensions); }

    /** Returns true if associated SkColorSpace is not nullptr, and SkColorSpace gamma
        is approximately the same as sRGB.
        This includes the

        @return  true if SkColorSpace gamma is approximately the same as sRGB
    */
    bool gammaCloseToSRGB() const { return fColorInfo.gammaCloseToSRGB(); }

    /** Creates SkImageInfo with the same SkColorType, SkColorSpace, and SkAlphaType,
        with dimensions set to width and height.

        @param newWidth   pixel column count; must be zero or greater
        @param newHeight  pixel row count; must be zero or greater
        @return           created SkImageInfo
    */
    SkImageInfo makeWH(int newWidth, int newHeight) const {
        return Make({newWidth, newHeight}, fColorInfo);
    }

    /** Creates SkImageInfo with the same SkColorType, SkColorSpace, and SkAlphaType,
        with dimensions set to newDimensions.

        @param newSize   pixel column and row count; must be zero or greater
        @return          created SkImageInfo
    */
    SkImageInfo makeDimensions(SkISize newSize) const {
        return Make(newSize, fColorInfo);
    }

    /** Creates SkImageInfo with same SkColorType, SkColorSpace, width, and height,
        with SkAlphaType set to newAlphaType.

        Created SkImageInfo contains newAlphaType even if it is incompatible with
        SkColorType, in which case SkAlphaType in SkImageInfo is ignored.

        @return              created SkImageInfo
    */
    SkImageInfo makeAlphaType(SkAlphaType newAlphaType) const {
        return Make(fDimensions, fColorInfo.makeAlphaType(newAlphaType));
    }

    /** Creates SkImageInfo with same SkAlphaType, SkColorSpace, width, and height,
        with SkColorType set to newColorType.

        @return              created SkImageInfo
    */
    SkImageInfo makeColorType(SkColorType newColorType) const {
        return Make(fDimensions, fColorInfo.makeColorType(newColorType));
    }

    /** Creates SkImageInfo with same SkAlphaType, SkColorType, width, and height,
        with SkColorSpace set to cs.

        @param cs  range of colors; may be nullptr
        @return    created SkImageInfo
    */
    SkImageInfo makeColorSpace(sk_sp<SkColorSpace> cs) const {
        return Make(fDimensions, fColorInfo.makeColorSpace(std::move(cs)));
    }

    /** Returns number of bytes per pixel required by SkColorType.
        Returns zero if colorType( is kUnknown_SkColorType.

        @return  bytes in pixel
    */
    int bytesPerPixel() const { return fColorInfo.bytesPerPixel(); }

    /** Returns bit shift converting row bytes to row pixels.
        Returns zero for kUnknown_SkColorType.

        @return  one of: 0, 1, 2, 3; left shift to convert pixels to bytes
    */
    int shiftPerPixel() const { return fColorInfo.shiftPerPixel(); }

    /** Returns minimum bytes per row, computed from pixel width() and SkColorType, which
        specifies bytesPerPixel(). SkBitmap maximum value for row bytes must fit
        in 31 bits.

        @return  width() times bytesPerPixel() as unsigned 64-bit integer
    */
    uint64_t minRowBytes64() const {
        return (uint64_t)sk_64_mul(this->width(), this->bytesPerPixel());
    }

    /** Returns minimum bytes per row, computed from pixel width() and SkColorType, which
        specifies bytesPerPixel(). SkBitmap maximum value for row bytes must fit
        in 31 bits.

        @return  width() times bytesPerPixel() as size_t
    */
    size_t minRowBytes() const {
        uint64_t minRowBytes = this->minRowBytes64();
        if (!SkTFitsIn<int32_t>(minRowBytes)) {
            return 0;
        }
        return (size_t)minRowBytes;
    }

    /** Returns byte offset of pixel from pixel base address.

        Asserts in debug build if x or y is outside of bounds. Does not assert if
        rowBytes is smaller than minRowBytes(), even though result may be incorrect.

        @param x         column index, zero or greater, and less than width()
        @param y         row index, zero or greater, and less than height()
        @param rowBytes  size of pixel row or larger
        @return          offset within pixel array

        example: https://fiddle.skia.org/c/@ImageInfo_computeOffset
    */
    size_t computeOffset(int x, int y, size_t rowBytes) const;

    /** Compares SkImageInfo with other, and returns true if width, height, SkColorType,
        SkAlphaType, and SkColorSpace are equivalent.

        @param other  SkImageInfo to compare
        @return       true if SkImageInfo equals other
    */
    bool operator==(const SkImageInfo& other) const {
        return fDimensions == other.fDimensions && fColorInfo == other.fColorInfo;
    }

    /** Compares SkImageInfo with other, and returns true if width, height, SkColorType,
        SkAlphaType, and SkColorSpace are not equivalent.

        @param other  SkImageInfo to compare
        @return       true if SkImageInfo is not equal to other
    */
    bool operator!=(const SkImageInfo& other) const {
        return !(*this == other);
    }

    /** Returns storage required by pixel array, given SkImageInfo dimensions, SkColorType,
        and rowBytes. rowBytes is assumed to be at least as large as minRowBytes().

        Returns zero if height is zero.
        Returns SIZE_MAX if answer exceeds the range of size_t.

        @param rowBytes  size of pixel row or larger
        @return          memory required by pixel buffer

        example: https://fiddle.skia.org/c/@ImageInfo_computeByteSize
    */
    size_t computeByteSize(size_t rowBytes) const;

    /** Returns storage required by pixel array, given SkImageInfo dimensions, and
        SkColorType. Uses minRowBytes() to compute bytes for pixel row.

        Returns zero if height is zero.
        Returns SIZE_MAX if answer exceeds the range of size_t.

        @return  least memory required by pixel buffer
    */
    size_t computeMinByteSize() const {
        return this->computeByteSize(this->minRowBytes());
    }

    /** Returns true if byteSize equals SIZE_MAX. computeByteSize() and
        computeMinByteSize() return SIZE_MAX if size_t can not hold buffer size.

        @param byteSize  result of computeByteSize() or computeMinByteSize()
        @return          true if computeByteSize() or computeMinByteSize() result exceeds size_t
    */
    static bool ByteSizeOverflowed(size_t byteSize) {
        return SIZE_MAX == byteSize;
    }

    /** Returns true if rowBytes is valid for this SkImageInfo.

        @param rowBytes  size of pixel row including padding
        @return          true if rowBytes is large enough to contain pixel row and is properly
                         aligned
    */
    bool validRowBytes(size_t rowBytes) const {
        if (rowBytes < this->minRowBytes64()) {
            return false;
        }
        int shift = this->shiftPerPixel();
        size_t alignedRowBytes = rowBytes >> shift << shift;
        return alignedRowBytes == rowBytes;
    }

    /** Creates an empty SkImageInfo with kUnknown_SkColorType, kUnknown_SkAlphaType,
        a width and height of zero, and no SkColorSpace.
    */
    void reset() { *this = {}; }

    /** Asserts if internal values are illegal or inconsistent. Only available if
        SK_DEBUG is defined at compile time.
    */
    SkDEBUGCODE(void validate() const;)

private:
    SkColorInfo fColorInfo;
    SkISize fDimensions = {0, 0};

    SkImageInfo(SkISize dimensions, const SkColorInfo& colorInfo)
            : fColorInfo(colorInfo), fDimensions(dimensions) {}

    SkImageInfo(SkISize dimensions, SkColorInfo&& colorInfo)
            : fColorInfo(std::move(colorInfo)), fDimensions(dimensions) {}
};

#endif
