/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrMockOptions_DEFINED
#define GrMockOptions_DEFINED

#include "include/gpu/GrTypes.h"
#include "include/private/GrTypesPriv.h"

class GrBackendFormat;

struct GrMockTextureInfo {
    GrMockTextureInfo()
        : fColorType(GrColorType::kUnknown)
        , fCompressionType(SkImage::CompressionType::kNone)
        , fID(0) {}

    GrMockTextureInfo(GrColorType colorType,
                      SkImage::CompressionType compressionType,
                      int id)
            : fColorType(colorType)
            , fCompressionType(compressionType)
            , fID(id) {
        SkASSERT(fID);
        if (fCompressionType != SkImage::CompressionType::kNone) {
            SkASSERT(colorType == GrColorType::kUnknown);
        }
    }

    bool operator==(const GrMockTextureInfo& that) const {
        return fColorType == that.fColorType &&
               fCompressionType == that.fCompressionType &&
               fID == that.fID;
    }

    GrBackendFormat getBackendFormat() const;

    SkImage::CompressionType compressionType() const { return fCompressionType; }

    GrColorType colorType() const {
        SkASSERT(fCompressionType == SkImage::CompressionType::kNone);
        return fColorType;
    }

    int id() const { return fID; }

private:
    GrColorType              fColorType;
    SkImage::CompressionType fCompressionType;
    int                      fID;
};

struct GrMockRenderTargetInfo {
    GrMockRenderTargetInfo()
            : fColorType(GrColorType::kUnknown)
            , fID(0) {}

    GrMockRenderTargetInfo(GrColorType colorType, int id)
            : fColorType(colorType)
            , fID(id) {
        SkASSERT(fID);
    }

    bool operator==(const GrMockRenderTargetInfo& that) const {
        return fColorType == that.fColorType &&
               fID == that.fID;
    }

    GrBackendFormat getBackendFormat() const;

    GrColorType colorType() const { return fColorType; }

private:
    GrColorType   fColorType;
    int           fID;
};

struct GrMockSurfaceInfo {
    uint32_t fSampleCount = 1;
    uint32_t fLevelCount = 0;
    GrProtected fProtected = GrProtected::kNo;

    GrColorType fColorType = GrColorType::kUnknown;
    SkImage::CompressionType fCompressionType = SkImage::CompressionType::kNone;
};

/**
 * A pointer to this type is used as the GrBackendContext when creating a Mock GrContext. It can be
 * used to specify capability options for the mock context. If nullptr is used a default constructed
 * GrMockOptions is used.
 */
struct GrMockOptions {
    GrMockOptions() {
        using Renderability = ConfigOptions::Renderability;
        // By default RGBA_8888 and BGRA_8888 are textureable and renderable and
        // A8 and RGB565 are texturable.
        fConfigOptions[(int)GrColorType::kRGBA_8888].fRenderability = Renderability::kNonMSAA;
        fConfigOptions[(int)GrColorType::kRGBA_8888].fTexturable = true;
        fConfigOptions[(int)GrColorType::kAlpha_8].fTexturable = true;
        fConfigOptions[(int)GrColorType::kBGR_565].fTexturable = true;

        fConfigOptions[(int)GrColorType::kBGRA_8888] = fConfigOptions[(int)GrColorType::kRGBA_8888];

        fCompressedOptions[(int)SkImage::CompressionType::kETC2_RGB8_UNORM].fTexturable = true;
        fCompressedOptions[(int)SkImage::CompressionType::kBC1_RGB8_UNORM].fTexturable = true;
        fCompressedOptions[(int)SkImage::CompressionType::kBC1_RGBA8_UNORM].fTexturable = true;
    }

    struct ConfigOptions {
        enum Renderability { kNo, kNonMSAA, kMSAA };
        Renderability fRenderability = kNo;
        bool fTexturable = false;
    };

    // GrCaps options.
    bool fMipmapSupport = false;
    bool fDrawInstancedSupport = false;
    bool fHalfFloatVertexAttributeSupport = false;
    uint32_t fMapBufferFlags = 0;
    int fMaxTextureSize = 2048;
    int fMaxRenderTargetSize = 2048;
    int fMaxWindowRectangles = 0;
    int fMaxVertexAttributes = 16;
    int fMaxTessellationSegments = 0;
    ConfigOptions fConfigOptions[kGrColorTypeCnt];
    ConfigOptions fCompressedOptions[SkImage::kCompressionTypeCount];

    // GrShaderCaps options.
    bool fIntegerSupport = false;
    bool fFlatInterpolationSupport = false;
    int fMaxVertexSamplers = 0;
    int fMaxFragmentSamplers = 8;
    bool fShaderDerivativeSupport = true;
    bool fDualSourceBlendingSupport = false;

    // GrMockGpu options.
    bool fFailTextureAllocations = false;
};

#endif
