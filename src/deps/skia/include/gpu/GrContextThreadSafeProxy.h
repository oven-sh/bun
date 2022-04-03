/*
 * Copyright 2019 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrContextThreadSafeProxy_DEFINED
#define GrContextThreadSafeProxy_DEFINED

#include "include/core/SkRefCnt.h"

#if SK_SUPPORT_GPU

#include "include/core/SkImageInfo.h"
#include "include/gpu/GrContextOptions.h"
#include "include/gpu/GrTypes.h"

#include <atomic>

class GrBackendFormat;
class GrCaps;
class GrContextThreadSafeProxyPriv;
class GrTextBlobRedrawCoordinator;
class GrThreadSafeCache;
class GrThreadSafePipelineBuilder;
class SkSurfaceCharacterization;
class SkSurfaceProps;

/**
 * Can be used to perform actions related to the generating GrContext in a thread safe manner. The
 * proxy does not access the 3D API (e.g. OpenGL) that backs the generating GrContext.
 */
class SK_API GrContextThreadSafeProxy final : public SkNVRefCnt<GrContextThreadSafeProxy> {
public:
    ~GrContextThreadSafeProxy();

    /**
     *  Create a surface characterization for a DDL that will be replayed into the GrContext
     *  that created this proxy. On failure the resulting characterization will be invalid (i.e.,
     *  "!c.isValid()").
     *
     *  @param cacheMaxResourceBytes           The max resource bytes limit that will be in effect
     *                                         when the DDL created with this characterization is
     *                                         replayed.
     *                                         Note: the contract here is that the DDL will be
     *                                         created as if it had a full 'cacheMaxResourceBytes'
     *                                         to use. If replayed into a GrContext that already has
     *                                         locked GPU memory, the replay can exceed the budget.
     *                                         To rephrase, all resource allocation decisions are
     *                                         made at record time and at playback time the budget
     *                                         limits will be ignored.
     *  @param ii                              The image info specifying properties of the SkSurface
     *                                         that the DDL created with this characterization will
     *                                         be replayed into.
     *                                         Note: Ganesh doesn't make use of the SkImageInfo's
     *                                         alphaType
     *  @param backendFormat                   Information about the format of the GPU surface that
     *                                         will back the SkSurface upon replay
     *  @param sampleCount                     The sample count of the SkSurface that the DDL
     *                                         created with this characterization will be replayed
     *                                         into
     *  @param origin                          The origin of the SkSurface that the DDL created with
     *                                         this characterization will be replayed into
     *  @param surfaceProps                    The surface properties of the SkSurface that the DDL
     *                                         created with this characterization will be replayed
     *                                         into
     *  @param isMipMapped                     Will the surface the DDL will be replayed into have
     *                                         space allocated for mipmaps?
     *  @param willUseGLFBO0                   Will the surface the DDL will be replayed into be
     *                                         backed by GL FBO 0. This flag is only valid if using
     *                                         an GL backend.
     *  @param isTextureable                   Will the surface be able to act as a texture?
     *  @param isProtected                     Will the (Vulkan) surface be DRM protected?
     *  @param vkRTSupportsInputAttachment     Can the vulkan surface be used as in input
                                               attachment?
     *  @param forVulkanSecondaryCommandBuffer Will the surface be wrapping a vulkan secondary
     *                                         command buffer via a GrVkSecondaryCBDrawContext? If
     *                                         this is true then the following is required:
     *                                         isTexureable = false
     *                                         isMipMapped = false
     *                                         willUseGLFBO0 = false
     *                                         vkRTSupportsInputAttachment = false
     */
    SkSurfaceCharacterization createCharacterization(
                                  size_t cacheMaxResourceBytes,
                                  const SkImageInfo& ii,
                                  const GrBackendFormat& backendFormat,
                                  int sampleCount,
                                  GrSurfaceOrigin origin,
                                  const SkSurfaceProps& surfaceProps,
                                  bool isMipMapped,
                                  bool willUseGLFBO0 = false,
                                  bool isTextureable = true,
                                  GrProtected isProtected = GrProtected::kNo,
                                  bool vkRTSupportsInputAttachment = false,
                                  bool forVulkanSecondaryCommandBuffer = false);

    /*
     * Retrieve the default GrBackendFormat for a given SkColorType and renderability.
     * It is guaranteed that this backend format will be the one used by the following
     * SkColorType and SkSurfaceCharacterization-based createBackendTexture methods.
     *
     * The caller should check that the returned format is valid.
     */
    GrBackendFormat defaultBackendFormat(SkColorType ct, GrRenderable renderable) const;

    /**
     * Retrieve the GrBackendFormat for a given SkImage::CompressionType. This is
     * guaranteed to match the backend format used by the following
     * createCompressedBackendTexture methods that take a CompressionType.
     *
     * The caller should check that the returned format is valid.
     */
    GrBackendFormat compressedBackendFormat(SkImage::CompressionType c) const;

    bool isValid() const { return nullptr != fCaps; }

    bool operator==(const GrContextThreadSafeProxy& that) const {
        // Each GrContext should only ever have a single thread-safe proxy.
        SkASSERT((this == &that) == (this->fContextID == that.fContextID));
        return this == &that;
    }

    bool operator!=(const GrContextThreadSafeProxy& that) const { return !(*this == that); }

    // Provides access to functions that aren't part of the public API.
    GrContextThreadSafeProxyPriv priv();
    const GrContextThreadSafeProxyPriv priv() const;  // NOLINT(readability-const-return-type)

private:
    friend class GrContextThreadSafeProxyPriv; // for ctor and hidden methods

    // DDL TODO: need to add unit tests for backend & maybe options
    GrContextThreadSafeProxy(GrBackendApi, const GrContextOptions&);

    void abandonContext();
    bool abandoned() const;

    // TODO: This should be part of the constructor but right now we have a chicken-and-egg problem
    // with GrContext where we get the caps by creating a GPU which requires a context (see the
    // `init` method on GrContext_Base).
    void init(sk_sp<const GrCaps>, sk_sp<GrThreadSafePipelineBuilder>);

    const GrBackendApi                           fBackend;
    const GrContextOptions                       fOptions;
    const uint32_t                               fContextID;
    sk_sp<const GrCaps>                          fCaps;
    std::unique_ptr<GrTextBlobRedrawCoordinator> fTextBlobRedrawCoordinator;
    std::unique_ptr<GrThreadSafeCache>           fThreadSafeCache;
    sk_sp<GrThreadSafePipelineBuilder>           fPipelineBuilder;
    std::atomic<bool>                            fAbandoned{false};
};

#else // !SK_SUPPORT_GPU
class SK_API GrContextThreadSafeProxy final : public SkNVRefCnt<GrContextThreadSafeProxy> {};
#endif

#endif
