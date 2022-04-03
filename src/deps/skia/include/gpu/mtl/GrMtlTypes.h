/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrMtlTypes_DEFINED
#define GrMtlTypes_DEFINED

#include "include/gpu/GrTypes.h"
#include "include/ports/SkCFObject.h"

/**
 * Declares typedefs for Metal types used in Ganesh cpp code
 */
using GrMTLPixelFormat = unsigned int;
using GrMTLTextureUsage = unsigned int;
using GrMTLStorageMode = unsigned int;
using GrMTLHandle = const void*;

///////////////////////////////////////////////////////////////////////////////

#ifdef __APPLE__

#include <TargetConditionals.h>

#if TARGET_OS_SIMULATOR
#define SK_API_AVAILABLE_CA_METAL_LAYER SK_API_AVAILABLE(macos(10.11), ios(13.0))
#else  // TARGET_OS_SIMULATOR
#define SK_API_AVAILABLE_CA_METAL_LAYER SK_API_AVAILABLE(macos(10.11), ios(8.0))
#endif  // TARGET_OS_SIMULATOR

/**
 * Types for interacting with Metal resources created externally to Skia.
 * This is used by GrBackendObjects.
 */
struct GrMtlTextureInfo {
public:
    GrMtlTextureInfo() {}

    sk_cfp<GrMTLHandle> fTexture;

    bool operator==(const GrMtlTextureInfo& that) const {
        return fTexture == that.fTexture;
    }
};

struct GrMtlSurfaceInfo {
    uint32_t fSampleCount = 1;
    uint32_t fLevelCount = 0;
    GrProtected fProtected = GrProtected::kNo;

    // Since we aren't in an Obj-C header we can't directly use Mtl types here. Each of these can
    // cast to their mapped Mtl types list below.
    GrMTLPixelFormat fFormat = 0;       // MTLPixelFormat fFormat = MTLPixelFormatInvalid;
    GrMTLTextureUsage fUsage = 0;       // MTLTextureUsage fUsage = MTLTextureUsageUnknown;
    GrMTLStorageMode fStorageMode = 0;  // MTLStorageMode fStorageMode = MTLStorageModeShared;
};

#endif

#endif
