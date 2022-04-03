/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkDeferredDisplayListRecorder_DEFINED
#define SkDeferredDisplayListRecorder_DEFINED

#include "include/core/SkDeferredDisplayList.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkSurfaceCharacterization.h"
#include "include/core/SkTypes.h"

class GrBackendFormat;
class GrBackendTexture;
class GrRecordingContext;
class GrYUVABackendTextureInfo;
class SkCanvas;
class SkSurface;

/*
 * This class is intended to be used as:
 *   Get an SkSurfaceCharacterization representing the intended gpu-backed destination SkSurface
 *   Create one of these (an SkDeferredDisplayListRecorder) on the stack
 *   Get the canvas and render into it
 *   Snap off and hold on to an SkDeferredDisplayList
 *   Once your app actually needs the pixels, call SkSurface::draw(SkDeferredDisplayList*)
 *
 * This class never accesses the GPU but performs all the cpu work it can. It
 * is thread-safe (i.e., one can break a scene into tiles and perform their cpu-side
 * work in parallel ahead of time).
 */
class SK_API SkDeferredDisplayListRecorder {
public:
    SkDeferredDisplayListRecorder(const SkSurfaceCharacterization&);
    ~SkDeferredDisplayListRecorder();

    const SkSurfaceCharacterization& characterization() const {
        return fCharacterization;
    }

    // The backing canvas will become invalid (and this entry point will return
    // null) once 'detach' is called.
    // Note: ownership of the SkCanvas is not transferred via this call.
    SkCanvas* getCanvas();

    sk_sp<SkDeferredDisplayList> detach();

#if SK_SUPPORT_GPU
    using PromiseImageTextureContext     = SkImage::PromiseImageTextureContext;
    using PromiseImageTextureFulfillProc = SkImage::PromiseImageTextureFulfillProc;
    using PromiseImageTextureReleaseProc = SkImage::PromiseImageTextureReleaseProc;

#ifndef SK_MAKE_PROMISE_TEXTURE_DISABLE_LEGACY_API
    /** Deprecated: Use SkImage::MakePromiseTexture instead. */
    sk_sp<SkImage> makePromiseTexture(const GrBackendFormat& backendFormat,
                                      int width,
                                      int height,
                                      GrMipmapped mipMapped,
                                      GrSurfaceOrigin origin,
                                      SkColorType colorType,
                                      SkAlphaType alphaType,
                                      sk_sp<SkColorSpace> colorSpace,
                                      PromiseImageTextureFulfillProc textureFulfillProc,
                                      PromiseImageTextureReleaseProc textureReleaseProc,
                                      PromiseImageTextureContext textureContext);

    /** Deprecated: Use SkImage::MakePromiseYUVATexture instead. */
    sk_sp<SkImage> makeYUVAPromiseTexture(const GrYUVABackendTextureInfo& yuvaBackendTextureInfo,
                                          sk_sp<SkColorSpace> imageColorSpace,
                                          PromiseImageTextureFulfillProc textureFulfillProc,
                                          PromiseImageTextureReleaseProc textureReleaseProc,
                                          PromiseImageTextureContext textureContexts[]);
#endif // SK_MAKE_PROMISE_TEXTURE_DISABLE_LEGACY_API
#endif // SK_SUPPORT_GPU

private:
    SkDeferredDisplayListRecorder(const SkDeferredDisplayListRecorder&) = delete;
    SkDeferredDisplayListRecorder& operator=(const SkDeferredDisplayListRecorder&) = delete;

    bool init();

    const SkSurfaceCharacterization             fCharacterization;

#if SK_SUPPORT_GPU
    sk_sp<GrRecordingContext>                   fContext;
    sk_sp<GrRenderTargetProxy>                  fTargetProxy;
    sk_sp<SkDeferredDisplayList::LazyProxyData> fLazyProxyData;
    sk_sp<SkSurface>                            fSurface;
#endif
};

#endif
