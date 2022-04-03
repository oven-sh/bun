/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkYUVAPixmaps_DEFINED
#define SkYUVAPixmaps_DEFINED

#include "include/core/SkData.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkYUVAInfo.h"
#include "include/private/SkTo.h"

#include <array>
#include <bitset>

class GrImageContext;

/**
 * SkYUVAInfo combined with per-plane SkColorTypes and row bytes. Fully specifies the SkPixmaps
 * for a YUVA image without the actual pixel memory and data.
 */
class SK_API SkYUVAPixmapInfo {
public:
    static constexpr auto kMaxPlanes = SkYUVAInfo::kMaxPlanes;

    using PlaneConfig  = SkYUVAInfo::PlaneConfig;
    using Subsampling  = SkYUVAInfo::Subsampling;

    /**
     * Data type for Y, U, V, and possibly A channels independent of how values are packed into
     * planes.
     **/
    enum class DataType {
        kUnorm8,          ///< 8 bit unsigned normalized
        kUnorm16,         ///< 16 bit unsigned normalized
        kFloat16,         ///< 16 bit (half) floating point
        kUnorm10_Unorm2,  ///< 10 bit unorm for Y, U, and V. 2 bit unorm for alpha (if present).

        kLast = kUnorm10_Unorm2
    };
    static constexpr int kDataTypeCnt = static_cast<int>(DataType::kLast) + 1;

    class SK_API SupportedDataTypes {
    public:
        /** Defaults to nothing supported. */
        constexpr SupportedDataTypes() = default;

        /** Init based on texture formats supported by the context. */
        SupportedDataTypes(const GrImageContext&);

        /** All legal combinations of PlaneConfig and DataType are supported. */
        static constexpr SupportedDataTypes All();

        /**
         * Checks whether there is a supported combination of color types for planes structured
         * as indicated by PlaneConfig with channel data types as indicated by DataType.
         */
        constexpr bool supported(PlaneConfig, DataType) const;

        /**
         * Update to add support for pixmaps with numChannel channels where each channel is
         * represented as DataType.
         */
        void enableDataType(DataType, int numChannels);

    private:
        // The bit for DataType dt with n channels is at index kDataTypeCnt*(n-1) + dt.
        std::bitset<kDataTypeCnt*4> fDataTypeSupport = {};
    };

    /**
     * Gets the default SkColorType to use with numChannels channels, each represented as DataType.
     * Returns kUnknown_SkColorType if no such color type.
     */
    static constexpr SkColorType DefaultColorTypeForDataType(DataType dataType, int numChannels);

    /**
     * If the SkColorType is supported for YUVA pixmaps this will return the number of YUVA channels
     * that can be stored in a plane of this color type and what the DataType is of those channels.
     * If the SkColorType is not supported as a YUVA plane the number of channels is reported as 0
     * and the DataType returned should be ignored.
     */
    static std::tuple<int, DataType> NumChannelsAndDataType(SkColorType);

    /** Default SkYUVAPixmapInfo is invalid. */
    SkYUVAPixmapInfo() = default;

    /**
     * Initializes the SkYUVAPixmapInfo from a SkYUVAInfo with per-plane color types and row bytes.
     * This will be invalid if the colorTypes aren't compatible with the SkYUVAInfo or if a
     * rowBytes entry is not valid for the plane dimensions and color type. Color type and
     * row byte values beyond the number of planes in SkYUVAInfo are ignored. All SkColorTypes
     * must have the same DataType or this will be invalid.
     *
     * If rowBytes is nullptr then bpp*width is assumed for each plane.
     */
    SkYUVAPixmapInfo(const SkYUVAInfo&,
                     const SkColorType[kMaxPlanes],
                     const size_t rowBytes[kMaxPlanes]);
    /**
     * Like above but uses DefaultColorTypeForDataType to determine each plane's SkColorType. If
     * rowBytes is nullptr then bpp*width is assumed for each plane.
     */
    SkYUVAPixmapInfo(const SkYUVAInfo&, DataType, const size_t rowBytes[kMaxPlanes]);

    SkYUVAPixmapInfo(const SkYUVAPixmapInfo&) = default;

    SkYUVAPixmapInfo& operator=(const SkYUVAPixmapInfo&) = default;

    bool operator==(const SkYUVAPixmapInfo&) const;
    bool operator!=(const SkYUVAPixmapInfo& that) const { return !(*this == that); }

    const SkYUVAInfo& yuvaInfo() const { return fYUVAInfo; }

    SkYUVColorSpace yuvColorSpace() const { return fYUVAInfo.yuvColorSpace(); }

    /** The number of SkPixmap planes, 0 if this SkYUVAPixmapInfo is invalid. */
    int numPlanes() const { return fYUVAInfo.numPlanes(); }

    /** The per-YUV[A] channel data type. */
    DataType dataType() const { return fDataType; }

    /**
     * Row bytes for the ith plane. Returns zero if i >= numPlanes() or this SkYUVAPixmapInfo is
     * invalid.
     */
    size_t rowBytes(int i) const { return fRowBytes[static_cast<size_t>(i)]; }

    /** Image info for the ith plane, or default SkImageInfo if i >= numPlanes() */
    const SkImageInfo& planeInfo(int i) const { return fPlaneInfos[static_cast<size_t>(i)]; }

    /**
     * Determine size to allocate for all planes. Optionally retrieves the per-plane sizes in
     * planeSizes if not null. If total size overflows will return SIZE_MAX and set all planeSizes
     * to SIZE_MAX. Returns 0 and fills planesSizes with 0 if this SkYUVAPixmapInfo is not valid.
     */
    size_t computeTotalBytes(size_t planeSizes[kMaxPlanes] = nullptr) const;

    /**
     * Takes an allocation that is assumed to be at least computeTotalBytes() in size and configures
     * the first numPlanes() entries in pixmaps array to point into that memory. The remaining
     * entries of pixmaps are default initialized. Fails if this SkYUVAPixmapInfo not valid.
     */
    bool initPixmapsFromSingleAllocation(void* memory, SkPixmap pixmaps[kMaxPlanes]) const;

    /**
     * Returns true if this has been configured with a non-empty dimensioned SkYUVAInfo with
     * compatible color types and row bytes.
     */
    bool isValid() const { return fYUVAInfo.isValid(); }

    /** Is this valid and does it use color types allowed by the passed SupportedDataTypes? */
    bool isSupported(const SupportedDataTypes&) const;

private:
    SkYUVAInfo fYUVAInfo;
    std::array<SkImageInfo, kMaxPlanes> fPlaneInfos = {};
    std::array<size_t, kMaxPlanes> fRowBytes = {};
    DataType fDataType = DataType::kUnorm8;
    static_assert(kUnknown_SkColorType == 0, "default init isn't kUnknown");
};

/**
 * Helper to store SkPixmap planes as described by a SkYUVAPixmapInfo. Can be responsible for
 * allocating/freeing memory for pixmaps or use external memory.
 */
class SK_API SkYUVAPixmaps {
public:
    using DataType = SkYUVAPixmapInfo::DataType;
    static constexpr auto kMaxPlanes = SkYUVAPixmapInfo::kMaxPlanes;

    static SkColorType RecommendedRGBAColorType(DataType);

    /** Allocate space for pixmaps' pixels in the SkYUVAPixmaps. */
    static SkYUVAPixmaps Allocate(const SkYUVAPixmapInfo& yuvaPixmapInfo);

    /**
     * Use storage in SkData as backing store for pixmaps' pixels. SkData is retained by the
     * SkYUVAPixmaps.
     */
    static SkYUVAPixmaps FromData(const SkYUVAPixmapInfo&, sk_sp<SkData>);

    /**
     * Makes a deep copy of the src SkYUVAPixmaps. The returned SkYUVAPixmaps owns its planes'
     * backing stores.
     */
    static SkYUVAPixmaps MakeCopy(const SkYUVAPixmaps& src);

    /**
     * Use passed in memory as backing store for pixmaps' pixels. Caller must ensure memory remains
     * allocated while pixmaps are in use. There must be at least
     * SkYUVAPixmapInfo::computeTotalBytes() allocated starting at memory.
     */
    static SkYUVAPixmaps FromExternalMemory(const SkYUVAPixmapInfo&, void* memory);

    /**
     * Wraps existing SkPixmaps. The SkYUVAPixmaps will have no ownership of the SkPixmaps' pixel
     * memory so the caller must ensure it remains valid. Will return an invalid SkYUVAPixmaps if
     * the SkYUVAInfo isn't compatible with the SkPixmap array (number of planes, plane dimensions,
     * sufficient color channels in planes, ...).
     */
    static SkYUVAPixmaps FromExternalPixmaps(const SkYUVAInfo&, const SkPixmap[kMaxPlanes]);

    /** Default SkYUVAPixmaps is invalid. */
    SkYUVAPixmaps() = default;
    ~SkYUVAPixmaps() = default;

    SkYUVAPixmaps(SkYUVAPixmaps&& that) = default;
    SkYUVAPixmaps& operator=(SkYUVAPixmaps&& that) = default;
    SkYUVAPixmaps(const SkYUVAPixmaps&) = default;
    SkYUVAPixmaps& operator=(const SkYUVAPixmaps& that) = default;

    /** Does have initialized pixmaps compatible with its SkYUVAInfo. */
    bool isValid() const { return !fYUVAInfo.dimensions().isEmpty(); }

    const SkYUVAInfo& yuvaInfo() const { return fYUVAInfo; }

    DataType dataType() const { return fDataType; }

    SkYUVAPixmapInfo pixmapsInfo() const;

    /** Number of pixmap planes or 0 if this SkYUVAPixmaps is invalid. */
    int numPlanes() const { return this->isValid() ? fYUVAInfo.numPlanes() : 0; }

    /**
     * Access the SkPixmap planes. They are default initialized if this is not a valid
     * SkYUVAPixmaps.
     */
    const std::array<SkPixmap, kMaxPlanes>& planes() const { return fPlanes; }

    /**
     * Get the ith SkPixmap plane. SkPixmap will be default initialized if i >= numPlanes or this
     * SkYUVAPixmaps is invalid.
     */
    const SkPixmap& plane(int i) const { return fPlanes[SkToSizeT(i)]; }

    /**
     * Computes a YUVALocations representation of the planar layout. The result is guaranteed to be
     * valid if this->isValid().
     */
    SkYUVAInfo::YUVALocations toYUVALocations() const;

    /** Does this SkPixmaps own the backing store of the planes? */
    bool ownsStorage() const { return SkToBool(fData); }

private:
    SkYUVAPixmaps(const SkYUVAPixmapInfo&, sk_sp<SkData>);
    SkYUVAPixmaps(const SkYUVAInfo&, DataType, const SkPixmap[kMaxPlanes]);

    std::array<SkPixmap, kMaxPlanes> fPlanes = {};
    sk_sp<SkData> fData;
    SkYUVAInfo fYUVAInfo;
    DataType fDataType;
};

//////////////////////////////////////////////////////////////////////////////

constexpr SkYUVAPixmapInfo::SupportedDataTypes SkYUVAPixmapInfo::SupportedDataTypes::All() {
    using ULL = unsigned long long; // bitset cons. takes this.
    ULL bits = 0;
    for (ULL c = 1; c <= 4; ++c) {
        for (ULL dt = 0; dt <= ULL(kDataTypeCnt); ++dt) {
            if (DefaultColorTypeForDataType(static_cast<DataType>(dt),
                                            static_cast<int>(c)) != kUnknown_SkColorType) {
                bits |= ULL(1) << (dt + static_cast<ULL>(kDataTypeCnt)*(c - 1));
            }
        }
    }
    SupportedDataTypes combinations;
    combinations.fDataTypeSupport = bits;
    return combinations;
}

constexpr bool SkYUVAPixmapInfo::SupportedDataTypes::supported(PlaneConfig config,
                                                               DataType type) const {
    int n = SkYUVAInfo::NumPlanes(config);
    for (int i = 0; i < n; ++i) {
        auto c = static_cast<size_t>(SkYUVAInfo::NumChannelsInPlane(config, i));
        SkASSERT(c >= 1 && c <= 4);
        if (!fDataTypeSupport[static_cast<size_t>(type) +
                              (c - 1)*static_cast<size_t>(kDataTypeCnt)]) {
            return false;
        }
    }
    return true;
}

constexpr SkColorType SkYUVAPixmapInfo::DefaultColorTypeForDataType(DataType dataType,
                                                                    int numChannels) {
    switch (numChannels) {
        case 1:
            switch (dataType) {
                case DataType::kUnorm8:         return kGray_8_SkColorType;
                case DataType::kUnorm16:        return kA16_unorm_SkColorType;
                case DataType::kFloat16:        return kA16_float_SkColorType;
                case DataType::kUnorm10_Unorm2: return kUnknown_SkColorType;
            }
            break;
        case 2:
            switch (dataType) {
                case DataType::kUnorm8:         return kR8G8_unorm_SkColorType;
                case DataType::kUnorm16:        return kR16G16_unorm_SkColorType;
                case DataType::kFloat16:        return kR16G16_float_SkColorType;
                case DataType::kUnorm10_Unorm2: return kUnknown_SkColorType;
            }
            break;
        case 3:
            // None of these are tightly packed. The intended use case is for interleaved YUVA
            // planes where we're forcing opaqueness by ignoring the alpha values.
            // There are "x" rather than "A" variants for Unorm8 and Unorm10_Unorm2 but we don't
            // choose them because 1) there is no inherent advantage and 2) there is better support
            // in the GPU backend for the "A" versions.
            switch (dataType) {
                case DataType::kUnorm8:         return kRGBA_8888_SkColorType;
                case DataType::kUnorm16:        return kR16G16B16A16_unorm_SkColorType;
                case DataType::kFloat16:        return kRGBA_F16_SkColorType;
                case DataType::kUnorm10_Unorm2: return kRGBA_1010102_SkColorType;
            }
            break;
        case 4:
            switch (dataType) {
                case DataType::kUnorm8:         return kRGBA_8888_SkColorType;
                case DataType::kUnorm16:        return kR16G16B16A16_unorm_SkColorType;
                case DataType::kFloat16:        return kRGBA_F16_SkColorType;
                case DataType::kUnorm10_Unorm2: return kRGBA_1010102_SkColorType;
            }
            break;
    }
    return kUnknown_SkColorType;
}

#endif
