/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkYUVAInfo_DEFINED
#define SkYUVAInfo_DEFINED

#include "include/codec/SkEncodedOrigin.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkSize.h"

#include <array>
#include <tuple>

/**
 * Specifies the structure of planes for a YUV image with optional alpha. The actual planar data
 * is not part of this structure and depending on usage is in external textures or pixmaps.
 */
class SK_API SkYUVAInfo {
public:
    enum YUVAChannels { kY, kU, kV, kA, kLast = kA };
    static constexpr int kYUVAChannelCount = static_cast<int>(YUVAChannels::kLast + 1);

    struct YUVALocation;  // For internal use.
    using YUVALocations = std::array<YUVALocation, kYUVAChannelCount>;

    /**
     * Specifies how YUV (and optionally A) are divided among planes. Planes are separated by
     * underscores in the enum value names. Within each plane the pixmap/texture channels are
     * mapped to the YUVA channels in the order specified, e.g. for kY_UV Y is in channel 0 of plane
     * 0, U is in channel 0 of plane 1, and V is in channel 1 of plane 1. Channel ordering
     * within a pixmap/texture given the channels it contains:
     * A:                       0:A
     * Luminance/Gray:          0:Gray
     * Luminance/Gray + Alpha:  0:Gray, 1:A
     * RG                       0:R,    1:G
     * RGB                      0:R,    1:G, 2:B
     * RGBA                     0:R,    1:G, 2:B, 3:A
     */
    enum class PlaneConfig {
        kUnknown,

        kY_U_V,    ///< Plane 0: Y, Plane 1: U,  Plane 2: V
        kY_V_U,    ///< Plane 0: Y, Plane 1: V,  Plane 2: U
        kY_UV,     ///< Plane 0: Y, Plane 1: UV
        kY_VU,     ///< Plane 0: Y, Plane 1: VU
        kYUV,      ///< Plane 0: YUV
        kUYV,      ///< Plane 0: UYV

        kY_U_V_A,  ///< Plane 0: Y, Plane 1: U,  Plane 2: V, Plane 3: A
        kY_V_U_A,  ///< Plane 0: Y, Plane 1: V,  Plane 2: U, Plane 3: A
        kY_UV_A,   ///< Plane 0: Y, Plane 1: UV, Plane 2: A
        kY_VU_A,   ///< Plane 0: Y, Plane 1: VU, Plane 2: A
        kYUVA,     ///< Plane 0: YUVA
        kUYVA,     ///< Plane 0: UYVA

        kLast = kUYVA
    };

    /**
     * UV subsampling is also specified in the enum value names using J:a:b notation (e.g. 4:2:0 is
     * 1/2 horizontal and 1/2 vertical resolution for U and V). If alpha is present it is not sub-
     * sampled. Note that Subsampling values other than k444 are only valid with PlaneConfig values
     * that have U and V in different planes than Y (and A, if present).
     */
    enum class Subsampling {
        kUnknown,

        k444,    ///< No subsampling. UV values for each Y.
        k422,    ///< 1 set of UV values for each 2x1 block of Y values.
        k420,    ///< 1 set of UV values for each 2x2 block of Y values.
        k440,    ///< 1 set of UV values for each 1x2 block of Y values.
        k411,    ///< 1 set of UV values for each 4x1 block of Y values.
        k410,    ///< 1 set of UV values for each 4x2 block of Y values.

        kLast = k410
    };

    /**
     * Describes how subsampled chroma values are sited relative to luma values.
     *
     * Currently only centered siting is supported but will expand to support additional sitings.
     */
    enum class Siting {
        /**
         * Subsampled chroma value is sited at the center of the block of corresponding luma values.
         */
        kCentered,
    };

    static constexpr int kMaxPlanes = 4;

    /** ratio of Y/A values to U/V values in x and y. */
    static std::tuple<int, int> SubsamplingFactors(Subsampling);

    /**
     * SubsamplingFactors(Subsampling) if planedIdx refers to a U/V plane and otherwise {1, 1} if
     * inputs are valid. Invalid inputs consist of incompatible PlaneConfig/Subsampling/planeIdx
     * combinations. {0, 0} is returned for invalid inputs.
     */
    static std::tuple<int, int> PlaneSubsamplingFactors(PlaneConfig, Subsampling, int planeIdx);

    /**
     * Given image dimensions, a planer configuration, subsampling, and origin, determine the
     * expected size of each plane. Returns the number of expected planes. planeDimensions[0]
     * through planeDimensions[<ret>] are written. The input image dimensions are as displayed
     * (after the planes have been transformed to the intended display orientation). The plane
     * dimensions are output as the planes are stored in memory (may be rotated from image
     * dimensions).
     */
    static int PlaneDimensions(SkISize imageDimensions,
                               PlaneConfig,
                               Subsampling,
                               SkEncodedOrigin,
                               SkISize planeDimensions[kMaxPlanes]);

    /** Number of planes for a given PlaneConfig. */
    static constexpr int NumPlanes(PlaneConfig);

    /**
     * Number of Y, U, V, A channels in the ith plane for a given PlaneConfig (or 0 if i is
     * invalid).
     */
    static constexpr int NumChannelsInPlane(PlaneConfig, int i);

    /**
     * Given a PlaneConfig and a set of channel flags for each plane, convert to YUVALocations
     * representation. Fails if channel flags aren't valid for the PlaneConfig (i.e. don't have
     * enough channels in a plane) by returning an invalid set of locations (plane indices are -1).
     */
    static YUVALocations GetYUVALocations(PlaneConfig, const uint32_t* planeChannelFlags);

    /** Does the PlaneConfig have alpha values? */
    static bool HasAlpha(PlaneConfig);

    SkYUVAInfo() = default;
    SkYUVAInfo(const SkYUVAInfo&) = default;

    /**
     * 'dimensions' should specify the size of the full resolution image (after planes have been
     * oriented to how the image is displayed as indicated by 'origin').
     */
    SkYUVAInfo(SkISize dimensions,
               PlaneConfig,
               Subsampling,
               SkYUVColorSpace,
               SkEncodedOrigin origin = kTopLeft_SkEncodedOrigin,
               Siting sitingX = Siting::kCentered,
               Siting sitingY = Siting::kCentered);

    SkYUVAInfo& operator=(const SkYUVAInfo& that) = default;

    PlaneConfig planeConfig() const { return fPlaneConfig; }
    Subsampling subsampling() const { return fSubsampling; }

    std::tuple<int, int> planeSubsamplingFactors(int planeIdx) const {
        return PlaneSubsamplingFactors(fPlaneConfig, fSubsampling, planeIdx);
    }

    /**
     * Dimensions of the full resolution image (after planes have been oriented to how the image
     * is displayed as indicated by fOrigin).
     */
    SkISize dimensions() const { return fDimensions; }
    int width() const { return fDimensions.width(); }
    int height() const { return fDimensions.height(); }

    SkYUVColorSpace yuvColorSpace() const { return fYUVColorSpace; }
    Siting sitingX() const { return fSitingX; }
    Siting sitingY() const { return fSitingY; }

    SkEncodedOrigin origin() const { return fOrigin; }

    SkMatrix originMatrix() const {
        return SkEncodedOriginToMatrix(fOrigin, this->width(), this->height());
    }

    bool hasAlpha() const { return HasAlpha(fPlaneConfig); }

    /**
     * Returns the number of planes and initializes planeDimensions[0]..planeDimensions[<ret>] to
     * the expected dimensions for each plane. Dimensions are as stored in memory, before
     * transformation to image display space as indicated by origin().
     */
    int planeDimensions(SkISize planeDimensions[kMaxPlanes]) const {
        return PlaneDimensions(fDimensions, fPlaneConfig, fSubsampling, fOrigin, planeDimensions);
    }

    /**
     * Given a per-plane row bytes, determine size to allocate for all planes. Optionally retrieves
     * the per-plane byte sizes in planeSizes if not null. If total size overflows will return
     * SIZE_MAX and set all planeSizes to SIZE_MAX.
     */
    size_t computeTotalBytes(const size_t rowBytes[kMaxPlanes],
                             size_t planeSizes[kMaxPlanes] = nullptr) const;

    int numPlanes() const { return NumPlanes(fPlaneConfig); }

    int numChannelsInPlane(int i) const { return NumChannelsInPlane(fPlaneConfig, i); }

    /**
     * Given a set of channel flags for each plane, converts this->planeConfig() to YUVALocations
     * representation. Fails if the channel flags aren't valid for the PlaneConfig (i.e. don't have
     * enough channels in a plane) by returning default initialized locations (all plane indices are
     * -1).
     */
    YUVALocations toYUVALocations(const uint32_t* channelFlags) const;

    /**
     * Makes a SkYUVAInfo that is identical to this one but with the passed Subsampling. If the
     * passed Subsampling is not k444 and this info's PlaneConfig is not compatible with chroma
     * subsampling (because Y is in the same plane as UV) then the result will be an invalid
     * SkYUVAInfo.
     */
    SkYUVAInfo makeSubsampling(SkYUVAInfo::Subsampling) const;

    /**
     * Makes a SkYUVAInfo that is identical to this one but with the passed dimensions. If the
     * passed dimensions is empty then the result will be an invalid SkYUVAInfo.
     */
    SkYUVAInfo makeDimensions(SkISize) const;

    bool operator==(const SkYUVAInfo& that) const;
    bool operator!=(const SkYUVAInfo& that) const { return !(*this == that); }

    bool isValid() const { return fPlaneConfig != PlaneConfig::kUnknown; }

private:
    SkISize fDimensions = {0, 0};

    PlaneConfig fPlaneConfig = PlaneConfig::kUnknown;
    Subsampling fSubsampling = Subsampling::kUnknown;

    SkYUVColorSpace fYUVColorSpace = SkYUVColorSpace::kIdentity_SkYUVColorSpace;

    /**
     * YUVA data often comes from formats like JPEG that support EXIF orientation.
     * Code that operates on the raw YUV data often needs to know that orientation.
     */
    SkEncodedOrigin fOrigin = kTopLeft_SkEncodedOrigin;

    Siting fSitingX = Siting::kCentered;
    Siting fSitingY = Siting::kCentered;
};

constexpr int SkYUVAInfo::NumPlanes(PlaneConfig planeConfig) {
    switch (planeConfig) {
        case PlaneConfig::kUnknown: return 0;
        case PlaneConfig::kY_U_V:   return 3;
        case PlaneConfig::kY_V_U:   return 3;
        case PlaneConfig::kY_UV:    return 2;
        case PlaneConfig::kY_VU:    return 2;
        case PlaneConfig::kYUV:     return 1;
        case PlaneConfig::kUYV:     return 1;
        case PlaneConfig::kY_U_V_A: return 4;
        case PlaneConfig::kY_V_U_A: return 4;
        case PlaneConfig::kY_UV_A:  return 3;
        case PlaneConfig::kY_VU_A:  return 3;
        case PlaneConfig::kYUVA:    return 1;
        case PlaneConfig::kUYVA:    return 1;
    }
    SkUNREACHABLE;
}

constexpr int SkYUVAInfo::NumChannelsInPlane(PlaneConfig config, int i) {
    switch (config) {
        case PlaneConfig::kUnknown:
            return 0;

        case SkYUVAInfo::PlaneConfig::kY_U_V:
        case SkYUVAInfo::PlaneConfig::kY_V_U:
            return i >= 0 && i < 3 ? 1 : 0;
        case SkYUVAInfo::PlaneConfig::kY_UV:
        case SkYUVAInfo::PlaneConfig::kY_VU:
            switch (i) {
                case 0:  return 1;
                case 1:  return 2;
                default: return 0;
            }
        case SkYUVAInfo::PlaneConfig::kYUV:
        case SkYUVAInfo::PlaneConfig::kUYV:
            return i == 0 ? 3 : 0;
        case SkYUVAInfo::PlaneConfig::kY_U_V_A:
        case SkYUVAInfo::PlaneConfig::kY_V_U_A:
            return i >= 0 && i < 4 ? 1 : 0;
        case SkYUVAInfo::PlaneConfig::kY_UV_A:
        case SkYUVAInfo::PlaneConfig::kY_VU_A:
            switch (i) {
                case 0:  return 1;
                case 1:  return 2;
                case 2:  return 1;
                default: return 0;
            }
        case SkYUVAInfo::PlaneConfig::kYUVA:
        case SkYUVAInfo::PlaneConfig::kUYVA:
            return i == 0 ? 4 : 0;
    }
    return 0;
}

#endif
