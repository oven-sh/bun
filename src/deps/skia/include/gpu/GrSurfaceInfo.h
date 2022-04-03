/*
 * Copyright 2021 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrSurfaceInfo_DEFINED
#define GrSurfaceInfo_DEFINED

#include "include/gpu/GrTypes.h"

#ifdef SK_GL
#include "include/private/GrGLTypesPriv.h"
#endif
#ifdef SK_VULKAN
#include "include/private/GrVkTypesPriv.h"
#endif
#ifdef SK_DIRECT3D
#include "include/private/GrD3DTypesMinimal.h"
struct GrD3DSurfaceInfo;
#endif
#ifdef SK_METAL
#include "include/private/GrMtlTypesPriv.h"
#endif
#ifdef SK_DAWN
#include "include/private/GrDawnTypesPriv.h"
#endif
#include "include/private/GrMockTypesPriv.h"

class GrSurfaceInfo {
public:
    GrSurfaceInfo() {}
#ifdef SK_GL
    GrSurfaceInfo(const GrGLSurfaceInfo& glInfo)
            : fBackend(GrBackendApi::kOpenGL)
            , fValid(true)
            , fSampleCount(glInfo.fSampleCount)
            , fLevelCount(glInfo.fLevelCount)
            , fProtected(glInfo.fProtected)
            , fGLSpec(glInfo) {}
#endif
#ifdef SK_VULKAN
    GrSurfaceInfo(const GrVkSurfaceInfo& vkInfo)
            : fBackend(GrBackendApi::kVulkan)
            , fValid(true)
            , fSampleCount(vkInfo.fSampleCount)
            , fLevelCount(vkInfo.fLevelCount)
            , fProtected(vkInfo.fProtected)
            , fVkSpec(vkInfo) {}
#endif
#ifdef SK_DIRECT3D
    GrSurfaceInfo(const GrD3DSurfaceInfo& d3dInfo);
#endif
#ifdef SK_METAL
    GrSurfaceInfo(const GrMtlSurfaceInfo& mtlInfo)
            : fBackend(GrBackendApi::kMetal)
            , fValid(true)
            , fSampleCount(mtlInfo.fSampleCount)
            , fLevelCount(mtlInfo.fLevelCount)
            , fProtected(mtlInfo.fProtected)
            , fMtlSpec(mtlInfo) {}
#endif
#ifdef SK_DAWN
    GrSurfaceInfo(const GrDawnSurfaceInfo& dawnInfo)
            : fBackend(GrBackendApi::kDawn)
            , fValid(true)
            , fSampleCount(dawnInfo.fSampleCount)
            , fLevelCount(dawnInfo.fLevelCount)
            , fProtected(dawnInfo.fProtected)
            , fDawnSpec(dawnInfo) {}
#endif
    GrSurfaceInfo(const GrMockSurfaceInfo& mockInfo)
            : fBackend(GrBackendApi::kMock)
            , fValid(true)
            , fSampleCount(mockInfo.fSampleCount)
            , fLevelCount(mockInfo.fLevelCount)
            , fProtected(mockInfo.fProtected)
            , fMockSpec(mockInfo) {}

    ~GrSurfaceInfo();
    GrSurfaceInfo(const GrSurfaceInfo&) = default;

    bool isValid() const { return fValid; }
    GrBackendApi backend() const { return fBackend; }

    uint32_t numSamples() const { return fSampleCount; }
    uint32_t numMipLevels() const { return fLevelCount; }
    GrProtected isProtected() const { return fProtected; }

#ifdef SK_GL
    bool getGLSurfaceInfo(GrGLSurfaceInfo* info) const {
        if (!this->isValid() || fBackend != GrBackendApi::kOpenGL) {
            return false;
        }
        *info = GrGLTextureSpecToSurfaceInfo(fGLSpec, fSampleCount, fLevelCount, fProtected);
        return true;
    }
#endif
#ifdef SK_VULKAN
    bool getVkSurfaceInfo(GrVkSurfaceInfo* info) const {
        if (!this->isValid() || fBackend != GrBackendApi::kVulkan) {
            return false;
        }
        *info = GrVkImageSpecToSurfaceInfo(fVkSpec, fSampleCount, fLevelCount, fProtected);
        return true;
    }
#endif
#ifdef SK_DIRECT3D
    bool getD3DSurfaceInfo(GrD3DSurfaceInfo*) const;
#endif
#ifdef SK_METAL
    bool getMtlSurfaceInfo(GrMtlSurfaceInfo* info) const {
        if (!this->isValid() || fBackend != GrBackendApi::kMetal) {
            return false;
        }
        *info = GrMtlTextureSpecToSurfaceInfo(fMtlSpec, fSampleCount, fLevelCount, fProtected);
        return true;
    }
#endif
#ifdef SK_DAWN
    bool getDawnSurfaceInfo(GrDawnSurfaceInfo* info) const {
        if (!this->isValid() || fBackend != GrBackendApi::kDawn) {
            return false;
        }
        *info = GrDawnTextureSpecToSurfaceInfo(fDawnSpec, fSampleCount, fLevelCount, fProtected);
        return true;
    }
#endif
    bool getMockSurfaceInfo(GrMockSurfaceInfo* info) const {
        if (!this->isValid() || fBackend != GrBackendApi::kMock) {
            return false;
        }
        *info = GrMockTextureSpecToSurfaceInfo(fMockSpec, fSampleCount, fLevelCount, fProtected);
        return true;
    }

private:
    GrBackendApi fBackend = GrBackendApi::kMock;
    bool fValid = false;

    uint32_t fSampleCount = 1;
    uint32_t fLevelCount = 0;
    GrProtected fProtected = GrProtected::kNo;

    union {
#ifdef SK_GL
        GrGLTextureSpec fGLSpec;
#endif
#ifdef SK_VULKAN
        GrVkImageSpec fVkSpec;
#endif
#ifdef SK_DIRECT3D
        GrD3DTextureResourceSpecHolder fD3DSpec;
#endif
#ifdef SK_METAL
        GrMtlTextureSpec fMtlSpec;
#endif
#ifdef SK_DAWN
        GrDawnTextureSpec fDawnSpec;
#endif
        GrMockTextureSpec fMockSpec;
    };
};

#endif
