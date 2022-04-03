/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkEncodedInfo_DEFINED
#define SkEncodedInfo_DEFINED

#include <memory>

#include "include/core/SkData.h"
#include "include/core/SkImageInfo.h"
#include "include/third_party/skcms/skcms.h"

struct SkEncodedInfo {
public:
    class ICCProfile {
    public:
        static std::unique_ptr<ICCProfile> Make(sk_sp<SkData>);
        static std::unique_ptr<ICCProfile> Make(const skcms_ICCProfile&);

        const skcms_ICCProfile* profile() const { return &fProfile; }
    private:
        ICCProfile(const skcms_ICCProfile&, sk_sp<SkData> = nullptr);

        skcms_ICCProfile fProfile;
        sk_sp<SkData>    fData;
    };

    enum Alpha {
        kOpaque_Alpha,
        kUnpremul_Alpha,

        // Each pixel is either fully opaque or fully transparent.
        // There is no difference between requesting kPremul or kUnpremul.
        kBinary_Alpha,
    };

    /*
     * We strive to make the number of components per pixel obvious through
     * our naming conventions.
     * Ex: kRGB has 3 components.  kRGBA has 4 components.
     *
     * This sometimes results in redundant Alpha and Color information.
     * Ex: kRGB images must also be kOpaque.
     */
    enum Color {
        // PNG, WBMP
        kGray_Color,

        // PNG
        kGrayAlpha_Color,

        // PNG with Skia-specific sBIT
        // Like kGrayAlpha, except this expects to be treated as
        // kAlpha_8_SkColorType, which ignores the gray component. If
        // decoded to full color (e.g. kN32), the gray component is respected
        // (so it can share code with kGrayAlpha).
        kXAlpha_Color,

        // PNG
        // 565 images may be encoded to PNG by specifying the number of
        // significant bits for each channel.  This is a strange 565
        // representation because the image is still encoded with 8 bits per
        // component.
        k565_Color,

        // PNG, GIF, BMP
        kPalette_Color,

        // PNG, RAW
        kRGB_Color,
        kRGBA_Color,

        // BMP
        kBGR_Color,
        kBGRX_Color,
        kBGRA_Color,

        // JPEG, WEBP
        kYUV_Color,

        // WEBP
        kYUVA_Color,

        // JPEG
        // Photoshop actually writes inverted CMYK data into JPEGs, where zero
        // represents 100% ink coverage.  For this reason, we treat CMYK JPEGs
        // as having inverted CMYK.  libjpeg-turbo warns that this may break
        // other applications, but the CMYK JPEGs we see on the web expect to
        // be treated as inverted CMYK.
        kInvertedCMYK_Color,
        kYCCK_Color,
    };

    static SkEncodedInfo Make(int width, int height, Color color, Alpha alpha,
            int bitsPerComponent) {
        return Make(width, height, color, alpha, bitsPerComponent, nullptr);
    }

    static SkEncodedInfo Make(int width, int height, Color color, Alpha alpha,
            int bitsPerComponent, std::unique_ptr<ICCProfile> profile) {
        SkASSERT(1 == bitsPerComponent ||
                 2 == bitsPerComponent ||
                 4 == bitsPerComponent ||
                 8 == bitsPerComponent ||
                 16 == bitsPerComponent);

        switch (color) {
            case kGray_Color:
                SkASSERT(kOpaque_Alpha == alpha);
                break;
            case kGrayAlpha_Color:
                SkASSERT(kOpaque_Alpha != alpha);
                break;
            case kPalette_Color:
                SkASSERT(16 != bitsPerComponent);
                break;
            case kRGB_Color:
            case kBGR_Color:
            case kBGRX_Color:
                SkASSERT(kOpaque_Alpha == alpha);
                SkASSERT(bitsPerComponent >= 8);
                break;
            case kYUV_Color:
            case kInvertedCMYK_Color:
            case kYCCK_Color:
                SkASSERT(kOpaque_Alpha == alpha);
                SkASSERT(8 == bitsPerComponent);
                break;
            case kRGBA_Color:
                SkASSERT(bitsPerComponent >= 8);
                break;
            case kBGRA_Color:
            case kYUVA_Color:
                SkASSERT(8 == bitsPerComponent);
                break;
            case kXAlpha_Color:
                SkASSERT(kUnpremul_Alpha == alpha);
                SkASSERT(8 == bitsPerComponent);
                break;
            case k565_Color:
                SkASSERT(kOpaque_Alpha == alpha);
                SkASSERT(8 == bitsPerComponent);
                break;
            default:
                SkASSERT(false);
                break;
        }

        return SkEncodedInfo(width, height, color, alpha, bitsPerComponent, std::move(profile));
    }

    /*
     * Returns a recommended SkImageInfo.
     *
     * TODO: Leave this up to the client.
     */
    SkImageInfo makeImageInfo() const {
        auto ct =  kGray_Color == fColor ? kGray_8_SkColorType   :
                 kXAlpha_Color == fColor ? kAlpha_8_SkColorType  :
                    k565_Color == fColor ? kRGB_565_SkColorType  :
                                           kN32_SkColorType      ;
        auto alpha = kOpaque_Alpha == fAlpha ? kOpaque_SkAlphaType
                                             : kUnpremul_SkAlphaType;
        sk_sp<SkColorSpace> cs = fProfile ? SkColorSpace::Make(*fProfile->profile())
                                          : nullptr;
        if (!cs) {
            cs = SkColorSpace::MakeSRGB();
        }
        return SkImageInfo::Make(fWidth, fHeight, ct, alpha, std::move(cs));
    }

    int   width() const { return fWidth;  }
    int  height() const { return fHeight; }
    Color color() const { return fColor;  }
    Alpha alpha() const { return fAlpha;  }
    bool opaque() const { return fAlpha == kOpaque_Alpha; }
    const skcms_ICCProfile* profile() const {
        if (!fProfile) return nullptr;
        return fProfile->profile();
    }

    uint8_t bitsPerComponent() const { return fBitsPerComponent; }

    uint8_t bitsPerPixel() const {
        switch (fColor) {
            case kGray_Color:
                return fBitsPerComponent;
            case kXAlpha_Color:
            case kGrayAlpha_Color:
                return 2 * fBitsPerComponent;
            case kPalette_Color:
                return fBitsPerComponent;
            case kRGB_Color:
            case kBGR_Color:
            case kYUV_Color:
            case k565_Color:
                return 3 * fBitsPerComponent;
            case kRGBA_Color:
            case kBGRA_Color:
            case kBGRX_Color:
            case kYUVA_Color:
            case kInvertedCMYK_Color:
            case kYCCK_Color:
                return 4 * fBitsPerComponent;
            default:
                SkASSERT(false);
                return 0;
        }
    }

    SkEncodedInfo(const SkEncodedInfo& orig) = delete;
    SkEncodedInfo& operator=(const SkEncodedInfo&) = delete;

    SkEncodedInfo(SkEncodedInfo&& orig) = default;
    SkEncodedInfo& operator=(SkEncodedInfo&&) = default;

    // Explicit copy method, to avoid accidental copying.
    SkEncodedInfo copy() const {
        auto copy = SkEncodedInfo::Make(fWidth, fHeight, fColor, fAlpha, fBitsPerComponent);
        if (fProfile) {
            copy.fProfile = std::make_unique<ICCProfile>(*fProfile);
        }
        return copy;
    }

private:
    SkEncodedInfo(int width, int height, Color color, Alpha alpha,
            uint8_t bitsPerComponent, std::unique_ptr<ICCProfile> profile)
        : fWidth(width)
        , fHeight(height)
        , fColor(color)
        , fAlpha(alpha)
        , fBitsPerComponent(bitsPerComponent)
        , fProfile(std::move(profile))
    {}

    int                         fWidth;
    int                         fHeight;
    Color                       fColor;
    Alpha                       fAlpha;
    uint8_t                     fBitsPerComponent;
    std::unique_ptr<ICCProfile> fProfile;
};

#endif
