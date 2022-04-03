/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrYUVABackendTextures_DEFINED
#define GrYUVABackendTextures_DEFINED

#include "include/core/SkYUVAInfo.h"
#include "include/gpu/GrBackendSurface.h"

#include <tuple>

/**
 * A description of a set GrBackendTextures that hold the planar data described by a SkYUVAInfo.
 */
class SK_API GrYUVABackendTextureInfo {
public:
    static constexpr auto kMaxPlanes = SkYUVAInfo::kMaxPlanes;

    /** Default GrYUVABackendTextureInfo is invalid. */
    GrYUVABackendTextureInfo() = default;

    /**
     * Initializes a GrYUVABackendTextureInfo to describe a set of textures that can store the
     * planes indicated by the SkYUVAInfo. The texture dimensions are taken from the SkYUVAInfo's
     * plane dimensions. All the described textures share a common origin. The planar image this
     * describes will be mip mapped if all the textures are individually mip mapped as indicated
     * by GrMipmapped. This will produce an invalid result (return false from isValid()) if the
     * passed formats' channels don't agree with SkYUVAInfo.
     */
    GrYUVABackendTextureInfo(const SkYUVAInfo&,
                             const GrBackendFormat[kMaxPlanes],
                             GrMipmapped,
                             GrSurfaceOrigin);

    GrYUVABackendTextureInfo(const GrYUVABackendTextureInfo&) = default;

    GrYUVABackendTextureInfo& operator=(const GrYUVABackendTextureInfo&) = default;

    bool operator==(const GrYUVABackendTextureInfo&) const;
    bool operator!=(const GrYUVABackendTextureInfo& that) const { return !(*this == that); }

    const SkYUVAInfo& yuvaInfo() const { return fYUVAInfo; }

    SkYUVColorSpace yuvColorSpace() const { return fYUVAInfo.yuvColorSpace(); }

    GrMipmapped mipmapped() const { return fMipmapped; }

    GrSurfaceOrigin textureOrigin() const { return fTextureOrigin; }

    /** The number of SkPixmap planes, 0 if this GrYUVABackendTextureInfo is invalid. */
    int numPlanes() const { return fYUVAInfo.numPlanes(); }

    /** Format of the ith plane, or invalid format if i >= numPlanes() */
    const GrBackendFormat& planeFormat(int i) const { return fPlaneFormats[i]; }

    /**
     * Returns true if this has been configured with a valid SkYUVAInfo with compatible texture
     * formats.
     */
    bool isValid() const { return fYUVAInfo.isValid(); }

    /**
     * Computes a YUVALocations representation of the planar layout. The result is guaranteed to be
     * valid if this->isValid().
     */
    SkYUVAInfo::YUVALocations toYUVALocations() const;

private:
    SkYUVAInfo fYUVAInfo;
    GrBackendFormat fPlaneFormats[kMaxPlanes];
    GrMipmapped fMipmapped = GrMipmapped::kNo;
    GrSurfaceOrigin fTextureOrigin = kTopLeft_GrSurfaceOrigin;
};

/**
 * A set of GrBackendTextures that hold the planar data for an image described a SkYUVAInfo.
 */
class SK_API GrYUVABackendTextures {
public:
    GrYUVABackendTextures() = default;
    GrYUVABackendTextures(const GrYUVABackendTextures&) = delete;
    GrYUVABackendTextures(GrYUVABackendTextures&&) = default;

    GrYUVABackendTextures& operator=(const GrYUVABackendTextures&) = delete;
    GrYUVABackendTextures& operator=(GrYUVABackendTextures&&) = default;

    GrYUVABackendTextures(const SkYUVAInfo&,
                          const GrBackendTexture[SkYUVAInfo::kMaxPlanes],
                          GrSurfaceOrigin textureOrigin);

    const std::array<GrBackendTexture, SkYUVAInfo::kMaxPlanes>& textures() const {
        return fTextures;
    }

    GrBackendTexture texture(int i) const {
        SkASSERT(i >= 0 && i < SkYUVAInfo::kMaxPlanes);
        return fTextures[static_cast<size_t>(i)];
    }

    const SkYUVAInfo& yuvaInfo() const { return fYUVAInfo; }

    int numPlanes() const { return fYUVAInfo.numPlanes(); }

    GrSurfaceOrigin textureOrigin() const { return fTextureOrigin; }

    bool isValid() const { return fYUVAInfo.isValid(); }

    /**
     * Computes a YUVALocations representation of the planar layout. The result is guaranteed to be
     * valid if this->isValid().
     */
    SkYUVAInfo::YUVALocations toYUVALocations() const;

private:
    SkYUVAInfo fYUVAInfo;
    std::array<GrBackendTexture, SkYUVAInfo::kMaxPlanes> fTextures;
    GrSurfaceOrigin fTextureOrigin = kTopLeft_GrSurfaceOrigin;
};

#endif
