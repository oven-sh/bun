/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkColorSpace_DEFINED
#define SkColorSpace_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/private/SkFixed.h"
#include "include/private/SkOnce.h"
#include "include/third_party/skcms/skcms.h"
#include <memory>

class SkData;

/**
 *  Describes a color gamut with primaries and a white point.
 */
struct SK_API SkColorSpacePrimaries {
    float fRX;
    float fRY;
    float fGX;
    float fGY;
    float fBX;
    float fBY;
    float fWX;
    float fWY;

    /**
     *  Convert primaries and a white point to a toXYZD50 matrix, the preferred color gamut
     *  representation of SkColorSpace.
     */
    bool toXYZD50(skcms_Matrix3x3* toXYZD50) const;
};

namespace SkNamedTransferFn {

// Like SkNamedGamut::kSRGB, keeping this bitwise exactly the same as skcms makes things fastest.
static constexpr skcms_TransferFunction kSRGB =
    { 2.4f, (float)(1/1.055), (float)(0.055/1.055), (float)(1/12.92), 0.04045f, 0.0f, 0.0f };

static constexpr skcms_TransferFunction k2Dot2 =
    { 2.2f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };

static constexpr skcms_TransferFunction kLinear =
    { 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };

static constexpr skcms_TransferFunction kRec2020 =
    {2.22222f, 0.909672f, 0.0903276f, 0.222222f, 0.0812429f, 0, 0};

static constexpr skcms_TransferFunction kPQ =
    {-2.0f, -107/128.0f, 1.0f, 32/2523.0f, 2413/128.0f, -2392/128.0f, 8192/1305.0f };

static constexpr skcms_TransferFunction kHLG =
    {-3.0f, 2.0f, 2.0f, 1/0.17883277f, 0.28466892f, 0.55991073f, 0.0f };

}  // namespace SkNamedTransferFn

namespace SkNamedGamut {

static constexpr skcms_Matrix3x3 kSRGB = {{
    // ICC fixed-point (16.16) representation, taken from skcms. Please keep them exactly in sync.
    // 0.436065674f, 0.385147095f, 0.143066406f,
    // 0.222488403f, 0.716873169f, 0.060607910f,
    // 0.013916016f, 0.097076416f, 0.714096069f,
    { SkFixedToFloat(0x6FA2), SkFixedToFloat(0x6299), SkFixedToFloat(0x24A0) },
    { SkFixedToFloat(0x38F5), SkFixedToFloat(0xB785), SkFixedToFloat(0x0F84) },
    { SkFixedToFloat(0x0390), SkFixedToFloat(0x18DA), SkFixedToFloat(0xB6CF) },
}};

static constexpr skcms_Matrix3x3 kAdobeRGB = {{
    // ICC fixed-point (16.16) repesentation of:
    // 0.60974, 0.20528, 0.14919,
    // 0.31111, 0.62567, 0.06322,
    // 0.01947, 0.06087, 0.74457,
    { SkFixedToFloat(0x9c18), SkFixedToFloat(0x348d), SkFixedToFloat(0x2631) },
    { SkFixedToFloat(0x4fa5), SkFixedToFloat(0xa02c), SkFixedToFloat(0x102f) },
    { SkFixedToFloat(0x04fc), SkFixedToFloat(0x0f95), SkFixedToFloat(0xbe9c) },
}};

static constexpr skcms_Matrix3x3 kDisplayP3 = {{
    {  0.515102f,   0.291965f,  0.157153f  },
    {  0.241182f,   0.692236f,  0.0665819f },
    { -0.00104941f, 0.0418818f, 0.784378f  },
}};

static constexpr skcms_Matrix3x3 kRec2020 = {{
    {  0.673459f,   0.165661f,  0.125100f  },
    {  0.279033f,   0.675338f,  0.0456288f },
    { -0.00193139f, 0.0299794f, 0.797162f  },
}};

static constexpr skcms_Matrix3x3 kXYZ = {{
    { 1.0f, 0.0f, 0.0f },
    { 0.0f, 1.0f, 0.0f },
    { 0.0f, 0.0f, 1.0f },
}};

}  // namespace SkNamedGamut

class SK_API SkColorSpace : public SkNVRefCnt<SkColorSpace> {
public:
    /**
     *  Create the sRGB color space.
     */
    static sk_sp<SkColorSpace> MakeSRGB();

    /**
     *  Colorspace with the sRGB primaries, but a linear (1.0) gamma.
     */
    static sk_sp<SkColorSpace> MakeSRGBLinear();

    /**
     *  Create an SkColorSpace from a transfer function and a row-major 3x3 transformation to XYZ.
     */
    static sk_sp<SkColorSpace> MakeRGB(const skcms_TransferFunction& transferFn,
                                       const skcms_Matrix3x3& toXYZ);

    /**
     *  Create an SkColorSpace from a parsed (skcms) ICC profile.
     */
    static sk_sp<SkColorSpace> Make(const skcms_ICCProfile&);

    /**
     *  Convert this color space to an skcms ICC profile struct.
     */
    void toProfile(skcms_ICCProfile*) const;

    /**
     *  Returns true if the color space gamma is near enough to be approximated as sRGB.
     */
    bool gammaCloseToSRGB() const;

    /**
     *  Returns true if the color space gamma is linear.
     */
    bool gammaIsLinear() const;

    /**
     *  Sets |fn| to the transfer function from this color space. Returns true if the transfer
     *  function can be represented as coefficients to the standard ICC 7-parameter equation.
     *  Returns false otherwise (eg, PQ, HLG).
     */
    bool isNumericalTransferFn(skcms_TransferFunction* fn) const;

    /**
     *  Returns true and sets |toXYZD50| if the color gamut can be described as a matrix.
     *  Returns false otherwise.
     */
    bool toXYZD50(skcms_Matrix3x3* toXYZD50) const;

    /**
     *  Returns a hash of the gamut transformation to XYZ D50. Allows for fast equality checking
     *  of gamuts, at the (very small) risk of collision.
     */
    uint32_t toXYZD50Hash() const { return fToXYZD50Hash; }

    /**
     *  Returns a color space with the same gamut as this one, but with a linear gamma.
     *  For color spaces whose gamut can not be described in terms of XYZ D50, returns
     *  linear sRGB.
     */
    sk_sp<SkColorSpace> makeLinearGamma() const;

    /**
     *  Returns a color space with the same gamut as this one, with with the sRGB transfer
     *  function. For color spaces whose gamut can not be described in terms of XYZ D50, returns
     *  sRGB.
     */
    sk_sp<SkColorSpace> makeSRGBGamma() const;

    /**
     *  Returns a color space with the same transfer function as this one, but with the primary
     *  colors rotated. For any XYZ space, this produces a new color space that maps RGB to GBR
     *  (when applied to a source), and maps RGB to BRG (when applied to a destination). For other
     *  types of color spaces, returns nullptr.
     *
     *  This is used for testing, to construct color spaces that have severe and testable behavior.
     */
    sk_sp<SkColorSpace> makeColorSpin() const;

    /**
     *  Returns true if the color space is sRGB.
     *  Returns false otherwise.
     *
     *  This allows a little bit of tolerance, given that we might see small numerical error
     *  in some cases: converting ICC fixed point to float, converting white point to D50,
     *  rounding decisions on transfer function and matrix.
     *
     *  This does not consider a 2.2f exponential transfer function to be sRGB.  While these
     *  functions are similar (and it is sometimes useful to consider them together), this
     *  function checks for logical equality.
     */
    bool isSRGB() const;

    /**
     *  Returns nullptr on failure.  Fails when we fallback to serializing ICC data and
     *  the data is too large to serialize.
     */
    sk_sp<SkData> serialize() const;

    /**
     *  If |memory| is nullptr, returns the size required to serialize.
     *  Otherwise, serializes into |memory| and returns the size.
     */
    size_t writeToMemory(void* memory) const;

    static sk_sp<SkColorSpace> Deserialize(const void* data, size_t length);

    /**
     *  If both are null, we return true.  If one is null and the other is not, we return false.
     *  If both are non-null, we do a deeper compare.
     */
    static bool Equals(const SkColorSpace*, const SkColorSpace*);

    void       transferFn(float gabcdef[7]) const;  // DEPRECATED: Remove when webview usage is gone
    void       transferFn(skcms_TransferFunction* fn) const;
    void    invTransferFn(skcms_TransferFunction* fn) const;
    void gamutTransformTo(const SkColorSpace* dst, skcms_Matrix3x3* src_to_dst) const;

    uint32_t transferFnHash() const { return fTransferFnHash; }
    uint64_t           hash() const { return (uint64_t)fTransferFnHash << 32 | fToXYZD50Hash; }

private:
    friend class SkColorSpaceSingletonFactory;

    SkColorSpace(const skcms_TransferFunction& transferFn, const skcms_Matrix3x3& toXYZ);

    void computeLazyDstFields() const;

    uint32_t                            fTransferFnHash;
    uint32_t                            fToXYZD50Hash;

    skcms_TransferFunction              fTransferFn;
    skcms_Matrix3x3                     fToXYZD50;

    mutable skcms_TransferFunction      fInvTransferFn;
    mutable skcms_Matrix3x3             fFromXYZD50;
    mutable SkOnce                      fLazyDstFieldsOnce;
};

#endif
