/*
 * Copyright 2012 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkSurface_DEFINED
#define SkSurface_DEFINED

#include "include/core/SkImage.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkSurfaceProps.h"

#if SK_SUPPORT_GPU
#include "include/gpu/GrTypes.h"
#endif

#if defined(SK_BUILD_FOR_ANDROID) && __ANDROID_API__ >= 26
#include <android/hardware_buffer.h>
#endif

#ifdef SK_METAL
#include "include/gpu/mtl/GrMtlTypes.h"
#endif

class SkCanvas;
class SkDeferredDisplayList;
class SkPaint;
class SkSurfaceCharacterization;
class GrBackendRenderTarget;
class GrBackendSemaphore;
class GrBackendSurfaceMutableState;
class GrBackendTexture;
class GrDirectContext;
class GrRecordingContext;
class GrRenderTarget;
enum GrSurfaceOrigin: int;

/** \class SkSurface
    SkSurface is responsible for managing the pixels that a canvas draws into. The pixels can be
    allocated either in CPU memory (a raster surface) or on the GPU (a GrRenderTarget surface).
    SkSurface takes care of allocating a SkCanvas that will draw into the surface. Call
    surface->getCanvas() to use that canvas (but don't delete it, it is owned by the surface).
    SkSurface always has non-zero dimensions. If there is a request for a new surface, and either
    of the requested dimensions are zero, then nullptr will be returned.
*/
class SK_API SkSurface : public SkRefCnt {
public:

    /** Allocates raster SkSurface. SkCanvas returned by SkSurface draws directly into pixels.

        SkSurface is returned if all parameters are valid.
        Valid parameters include:
        info dimensions are greater than zero;
        info contains SkColorType and SkAlphaType supported by raster surface;
        pixels is not nullptr;
        rowBytes is large enough to contain info width pixels of SkColorType.

        Pixel buffer size should be info height times computed rowBytes.
        Pixels are not initialized.
        To access pixels after drawing, peekPixels() or readPixels().

        @param imageInfo     width, height, SkColorType, SkAlphaType, SkColorSpace,
                             of raster surface; width and height must be greater than zero
        @param pixels        pointer to destination pixels buffer
        @param rowBytes      interval from one SkSurface row to the next
        @param surfaceProps  LCD striping orientation and setting for device independent fonts;
                             may be nullptr
        @return              SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRasterDirect(const SkImageInfo& imageInfo, void* pixels,
                                             size_t rowBytes,
                                             const SkSurfaceProps* surfaceProps = nullptr);

    static sk_sp<SkSurface> MakeRasterDirect(const SkPixmap& pm,
                                             const SkSurfaceProps* props = nullptr) {
        return MakeRasterDirect(pm.info(), pm.writable_addr(), pm.rowBytes(), props);
    }

    /** Allocates raster SkSurface. SkCanvas returned by SkSurface draws directly into pixels.
        releaseProc is called with pixels and context when SkSurface is deleted.

        SkSurface is returned if all parameters are valid.
        Valid parameters include:
        info dimensions are greater than zero;
        info contains SkColorType and SkAlphaType supported by raster surface;
        pixels is not nullptr;
        rowBytes is large enough to contain info width pixels of SkColorType.

        Pixel buffer size should be info height times computed rowBytes.
        Pixels are not initialized.
        To access pixels after drawing, call flush() or peekPixels().

        @param imageInfo     width, height, SkColorType, SkAlphaType, SkColorSpace,
                             of raster surface; width and height must be greater than zero
        @param pixels        pointer to destination pixels buffer
        @param rowBytes      interval from one SkSurface row to the next
        @param releaseProc   called when SkSurface is deleted; may be nullptr
        @param context       passed to releaseProc; may be nullptr
        @param surfaceProps  LCD striping orientation and setting for device independent fonts;
                             may be nullptr
        @return              SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRasterDirectReleaseProc(const SkImageInfo& imageInfo, void* pixels,
                                    size_t rowBytes,
                                    void (*releaseProc)(void* pixels, void* context),
                                    void* context, const SkSurfaceProps* surfaceProps = nullptr);

    /** Allocates raster SkSurface. SkCanvas returned by SkSurface draws directly into pixels.
        Allocates and zeroes pixel memory. Pixel memory size is imageInfo.height() times
        rowBytes, or times imageInfo.minRowBytes() if rowBytes is zero.
        Pixel memory is deleted when SkSurface is deleted.

        SkSurface is returned if all parameters are valid.
        Valid parameters include:
        info dimensions are greater than zero;
        info contains SkColorType and SkAlphaType supported by raster surface;
        rowBytes is large enough to contain info width pixels of SkColorType, or is zero.

        If rowBytes is zero, a suitable value will be chosen internally.

        @param imageInfo     width, height, SkColorType, SkAlphaType, SkColorSpace,
                             of raster surface; width and height must be greater than zero
        @param rowBytes      interval from one SkSurface row to the next; may be zero
        @param surfaceProps  LCD striping orientation and setting for device independent fonts;
                             may be nullptr
        @return              SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRaster(const SkImageInfo& imageInfo, size_t rowBytes,
                                       const SkSurfaceProps* surfaceProps);

    /** Allocates raster SkSurface. SkCanvas returned by SkSurface draws directly into pixels.
        Allocates and zeroes pixel memory. Pixel memory size is imageInfo.height() times
        imageInfo.minRowBytes().
        Pixel memory is deleted when SkSurface is deleted.

        SkSurface is returned if all parameters are valid.
        Valid parameters include:
        info dimensions are greater than zero;
        info contains SkColorType and SkAlphaType supported by raster surface.

        @param imageInfo  width, height, SkColorType, SkAlphaType, SkColorSpace,
                          of raster surface; width and height must be greater than zero
        @param props      LCD striping orientation and setting for device independent fonts;
                          may be nullptr
        @return           SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRaster(const SkImageInfo& imageInfo,
                                       const SkSurfaceProps* props = nullptr) {
        return MakeRaster(imageInfo, 0, props);
    }

    /** Allocates raster SkSurface. SkCanvas returned by SkSurface draws directly into pixels.
        Allocates and zeroes pixel memory. Pixel memory size is height times width times
        four. Pixel memory is deleted when SkSurface is deleted.

        Internally, sets SkImageInfo to width, height, native color type, and
        kPremul_SkAlphaType.

        SkSurface is returned if width and height are greater than zero.

        Use to create SkSurface that matches SkPMColor, the native pixel arrangement on
        the platform. SkSurface drawn to output device skips converting its pixel format.

        @param width         pixel column count; must be greater than zero
        @param height        pixel row count; must be greater than zero
        @param surfaceProps  LCD striping orientation and setting for device independent
                             fonts; may be nullptr
        @return              SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRasterN32Premul(int width, int height,
                                                const SkSurfaceProps* surfaceProps = nullptr);

    /** Caller data passed to RenderTarget/TextureReleaseProc; may be nullptr. */
    typedef void* ReleaseContext;

    /** User function called when supplied render target may be deleted. */
    typedef void (*RenderTargetReleaseProc)(ReleaseContext releaseContext);

    /** User function called when supplied texture may be deleted. */
    typedef void (*TextureReleaseProc)(ReleaseContext releaseContext);

    /** Wraps a GPU-backed texture into SkSurface. Caller must ensure the texture is
        valid for the lifetime of returned SkSurface. If sampleCnt greater than zero,
        creates an intermediate MSAA SkSurface which is used for drawing backendTexture.

        SkSurface is returned if all parameters are valid. backendTexture is valid if
        its pixel configuration agrees with colorSpace and context; for instance, if
        backendTexture has an sRGB configuration, then context must support sRGB,
        and colorSpace must be present. Further, backendTexture width and height must
        not exceed context capabilities, and the context must be able to support
        back-end textures.

        Upon success textureReleaseProc is called when it is safe to delete the texture in the
        backend API (accounting only for use of the texture by this surface). If SkSurface creation
        fails textureReleaseProc is called before this function returns.

        If SK_SUPPORT_GPU is defined as zero, has no effect and returns nullptr.

        @param context             GPU context
        @param backendTexture      texture residing on GPU
        @param sampleCnt           samples per pixel, or 0 to disable full scene anti-aliasing
        @param colorSpace          range of colors; may be nullptr
        @param surfaceProps        LCD striping orientation and setting for device independent
                                   fonts; may be nullptr
        @param textureReleaseProc  function called when texture can be released
        @param releaseContext      state passed to textureReleaseProc
        @return                    SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeFromBackendTexture(GrRecordingContext* context,
                                                   const GrBackendTexture& backendTexture,
                                                   GrSurfaceOrigin origin, int sampleCnt,
                                                   SkColorType colorType,
                                                   sk_sp<SkColorSpace> colorSpace,
                                                   const SkSurfaceProps* surfaceProps,
                                                   TextureReleaseProc textureReleaseProc = nullptr,
                                                   ReleaseContext releaseContext = nullptr);

    /** Wraps a GPU-backed buffer into SkSurface. Caller must ensure backendRenderTarget
        is valid for the lifetime of returned SkSurface.

        SkSurface is returned if all parameters are valid. backendRenderTarget is valid if
        its pixel configuration agrees with colorSpace and context; for instance, if
        backendRenderTarget has an sRGB configuration, then context must support sRGB,
        and colorSpace must be present. Further, backendRenderTarget width and height must
        not exceed context capabilities, and the context must be able to support
        back-end render targets.

        Upon success releaseProc is called when it is safe to delete the render target in the
        backend API (accounting only for use of the render target by this surface). If SkSurface
        creation fails releaseProc is called before this function returns.

        If SK_SUPPORT_GPU is defined as zero, has no effect and returns nullptr.

        @param context                  GPU context
        @param backendRenderTarget      GPU intermediate memory buffer
        @param colorSpace               range of colors
        @param surfaceProps             LCD striping orientation and setting for device independent
                                        fonts; may be nullptr
        @param releaseProc              function called when backendRenderTarget can be released
        @param releaseContext           state passed to releaseProc
        @return                         SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeFromBackendRenderTarget(GrRecordingContext* context,
                                                const GrBackendRenderTarget& backendRenderTarget,
                                                GrSurfaceOrigin origin,
                                                SkColorType colorType,
                                                sk_sp<SkColorSpace> colorSpace,
                                                const SkSurfaceProps* surfaceProps,
                                                RenderTargetReleaseProc releaseProc = nullptr,
                                                ReleaseContext releaseContext = nullptr);

    /** Returns SkSurface on GPU indicated by context. Allocates memory for
        pixels, based on the width, height, and SkColorType in SkImageInfo.  budgeted
        selects whether allocation for pixels is tracked by context. imageInfo
        describes the pixel format in SkColorType, and transparency in
        SkAlphaType, and color matching in SkColorSpace.

        sampleCount requests the number of samples per pixel.
        Pass zero to disable multi-sample anti-aliasing.  The request is rounded
        up to the next supported count, or rounded down if it is larger than the
        maximum supported count.

        surfaceOrigin pins either the top-left or the bottom-left corner to the origin.

        shouldCreateWithMips hints that SkImage returned by makeImageSnapshot() is mip map.

        If SK_SUPPORT_GPU is defined as zero, has no effect and returns nullptr.

        @param context               GPU context
        @param imageInfo             width, height, SkColorType, SkAlphaType, SkColorSpace;
                                     width, or height, or both, may be zero
        @param sampleCount           samples per pixel, or 0 to disable full scene anti-aliasing
        @param surfaceProps          LCD striping orientation and setting for device independent
                                     fonts; may be nullptr
        @param shouldCreateWithMips  hint that SkSurface will host mip map images
        @return                      SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRenderTarget(GrRecordingContext* context, SkBudgeted budgeted,
                                             const SkImageInfo& imageInfo,
                                             int sampleCount, GrSurfaceOrigin surfaceOrigin,
                                             const SkSurfaceProps* surfaceProps,
                                             bool shouldCreateWithMips = false);

    /** Returns SkSurface on GPU indicated by context. Allocates memory for
        pixels, based on the width, height, and SkColorType in SkImageInfo.  budgeted
        selects whether allocation for pixels is tracked by context. imageInfo
        describes the pixel format in SkColorType, and transparency in
        SkAlphaType, and color matching in SkColorSpace.

        sampleCount requests the number of samples per pixel.
        Pass zero to disable multi-sample anti-aliasing.  The request is rounded
        up to the next supported count, or rounded down if it is larger than the
        maximum supported count.

        SkSurface bottom-left corner is pinned to the origin.

        @param context      GPU context
        @param imageInfo    width, height, SkColorType, SkAlphaType, SkColorSpace,
                            of raster surface; width, or height, or both, may be zero
        @param sampleCount  samples per pixel, or 0 to disable multi-sample anti-aliasing
        @param surfaceProps LCD striping orientation and setting for device independent
                            fonts; may be nullptr
        @return             SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRenderTarget(GrRecordingContext* context, SkBudgeted budgeted,
                                             const SkImageInfo& imageInfo, int sampleCount,
                                             const SkSurfaceProps* surfaceProps) {
#if SK_SUPPORT_GPU
        return MakeRenderTarget(context, budgeted, imageInfo, sampleCount,
                                kBottomLeft_GrSurfaceOrigin, surfaceProps);
#else
        // TODO(kjlubick, scroggo) Remove this once Android is updated.
        return nullptr;
#endif
    }

    /** Returns SkSurface on GPU indicated by context. Allocates memory for
        pixels, based on the width, height, and SkColorType in SkImageInfo.  budgeted
        selects whether allocation for pixels is tracked by context. imageInfo
        describes the pixel format in SkColorType, and transparency in
        SkAlphaType, and color matching in SkColorSpace.

        SkSurface bottom-left corner is pinned to the origin.

        @param context    GPU context
        @param imageInfo  width, height, SkColorType, SkAlphaType, SkColorSpace,
                          of raster surface; width, or height, or both, may be zero
        @return           SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRenderTarget(GrRecordingContext* context, SkBudgeted budgeted,
                                             const SkImageInfo& imageInfo) {
#if SK_SUPPORT_GPU
        if (!imageInfo.width() || !imageInfo.height()) {
            return nullptr;
        }
        return MakeRenderTarget(context, budgeted, imageInfo, 0, kBottomLeft_GrSurfaceOrigin,
                                nullptr);
#else
        // TODO(kjlubick, scroggo) Remove this once Android is updated.
        return nullptr;
#endif
    }

    /** Returns SkSurface on GPU indicated by context that is compatible with the provided
        characterization. budgeted selects whether allocation for pixels is tracked by context.

        @param context           GPU context
        @param characterization  description of the desired SkSurface
        @return                  SkSurface if all parameters are valid; otherwise, nullptr
    */
    static sk_sp<SkSurface> MakeRenderTarget(GrRecordingContext* context,
                                             const SkSurfaceCharacterization& characterization,
                                             SkBudgeted budgeted);


#if defined(SK_BUILD_FOR_ANDROID) && __ANDROID_API__ >= 26
    /** Private.
        Creates SkSurface from Android hardware buffer.
        Returned SkSurface takes a reference on the buffer. The ref on the buffer will be released
        when the SkSurface is destroyed and there is no pending work on the GPU involving the
        buffer.

        Only available on Android, when __ANDROID_API__ is defined to be 26 or greater.

        Currently this is only supported for buffers that can be textured as well as rendered to.
        In other words that must have both AHARDWAREBUFFER_USAGE_GPU_COLOR_OUTPUT and
        AHARDWAREBUFFER_USAGE_GPU_SAMPLED_IMAGE usage bits.

        @param context         GPU context
        @param hardwareBuffer  AHardwareBuffer Android hardware buffer
        @param colorSpace      range of colors; may be nullptr
        @param surfaceProps    LCD striping orientation and setting for device independent
                               fonts; may be nullptr
        @param fromWindow      Whether or not the AHardwareBuffer is part of an Android Window.
                               Currently only used with Vulkan backend.
        @return                created SkSurface, or nullptr
    */
    static sk_sp<SkSurface> MakeFromAHardwareBuffer(GrDirectContext* context,
                                                    AHardwareBuffer* hardwareBuffer,
                                                    GrSurfaceOrigin origin,
                                                    sk_sp<SkColorSpace> colorSpace,
                                                    const SkSurfaceProps* surfaceProps
#ifdef SK_BUILD_FOR_ANDROID_FRAMEWORK
                                                    , bool fromWindow = false
#endif  // SK_BUILD_FOR_ANDROID_FRAMEWORK
                                                    );
#endif

#ifdef SK_METAL
    /** Creates SkSurface from CAMetalLayer.
        Returned SkSurface takes a reference on the CAMetalLayer. The ref on the layer will be
        released when the SkSurface is destroyed.

        Only available when Metal API is enabled.

        Will grab the current drawable from the layer and use its texture as a backendRT to
        create a renderable surface.

        @param context         GPU context
        @param layer           GrMTLHandle (expected to be a CAMetalLayer*)
        @param sampleCnt       samples per pixel, or 0 to disable full scene anti-aliasing
        @param colorSpace      range of colors; may be nullptr
        @param surfaceProps    LCD striping orientation and setting for device independent
                               fonts; may be nullptr
        @param drawable        Pointer to drawable to be filled in when this surface is
                               instantiated; may not be nullptr
        @return                created SkSurface, or nullptr
     */
    static sk_sp<SkSurface> MakeFromCAMetalLayer(GrRecordingContext* context,
                                                 GrMTLHandle layer,
                                                 GrSurfaceOrigin origin,
                                                 int sampleCnt,
                                                 SkColorType colorType,
                                                 sk_sp<SkColorSpace> colorSpace,
                                                 const SkSurfaceProps* surfaceProps,
                                                 GrMTLHandle* drawable)
                                                 SK_API_AVAILABLE_CA_METAL_LAYER;

    /** Creates SkSurface from MTKView.
        Returned SkSurface takes a reference on the MTKView. The ref on the layer will be
        released when the SkSurface is destroyed.

        Only available when Metal API is enabled.

        Will grab the current drawable from the layer and use its texture as a backendRT to
        create a renderable surface.

        @param context         GPU context
        @param layer           GrMTLHandle (expected to be a MTKView*)
        @param sampleCnt       samples per pixel, or 0 to disable full scene anti-aliasing
        @param colorSpace      range of colors; may be nullptr
        @param surfaceProps    LCD striping orientation and setting for device independent
                               fonts; may be nullptr
        @return                created SkSurface, or nullptr
     */
    static sk_sp<SkSurface> MakeFromMTKView(GrRecordingContext* context,
                                            GrMTLHandle mtkView,
                                            GrSurfaceOrigin origin,
                                            int sampleCnt,
                                            SkColorType colorType,
                                            sk_sp<SkColorSpace> colorSpace,
                                            const SkSurfaceProps* surfaceProps)
                                            SK_API_AVAILABLE(macos(10.11), ios(9.0));
#endif

    /** Is this surface compatible with the provided characterization?

        This method can be used to determine if an existing SkSurface is a viable destination
        for an SkDeferredDisplayList.

        @param characterization  The characterization for which a compatibility check is desired
        @return                  true if this surface is compatible with the characterization;
                                 false otherwise
    */
    bool isCompatible(const SkSurfaceCharacterization& characterization) const;

    /** Returns SkSurface without backing pixels. Drawing to SkCanvas returned from SkSurface
        has no effect. Calling makeImageSnapshot() on returned SkSurface returns nullptr.

        @param width   one or greater
        @param height  one or greater
        @return        SkSurface if width and height are positive; otherwise, nullptr

        example: https://fiddle.skia.org/c/@Surface_MakeNull
    */
    static sk_sp<SkSurface> MakeNull(int width, int height);

    /** Returns pixel count in each row; may be zero or greater.

        @return  number of pixel columns
    */
    int width() const { return fWidth; }

    /** Returns pixel row count; may be zero or greater.

        @return  number of pixel rows
    */
    int height() const { return fHeight; }

    /** Returns an ImageInfo describing the surface.
     */
    SkImageInfo imageInfo();

    /** Returns unique value identifying the content of SkSurface. Returned value changes
        each time the content changes. Content is changed by drawing, or by calling
        notifyContentWillChange().

        @return  unique content identifier

        example: https://fiddle.skia.org/c/@Surface_notifyContentWillChange
    */
    uint32_t generationID();

    /** \enum SkSurface::ContentChangeMode
        ContentChangeMode members are parameters to notifyContentWillChange().
    */
    enum ContentChangeMode {
        kDiscard_ContentChangeMode, //!< discards surface on change
        kRetain_ContentChangeMode,  //!< preserves surface on change
    };

    /** Notifies that SkSurface contents will be changed by code outside of Skia.
        Subsequent calls to generationID() return a different value.

        TODO: Can kRetain_ContentChangeMode be deprecated?

        example: https://fiddle.skia.org/c/@Surface_notifyContentWillChange
    */
    void notifyContentWillChange(ContentChangeMode mode);

    /** Returns the recording context being used by the SkSurface.

        @return the recording context, if available; nullptr otherwise
     */
    GrRecordingContext* recordingContext();

#if SK_SUPPORT_GPU
    enum BackendHandleAccess {
        kFlushRead_BackendHandleAccess,    //!< back-end object is readable
        kFlushWrite_BackendHandleAccess,   //!< back-end object is writable
        kDiscardWrite_BackendHandleAccess, //!< back-end object must be overwritten
    };

    /** Deprecated.
    */
    static const BackendHandleAccess kFlushRead_TextureHandleAccess =
            kFlushRead_BackendHandleAccess;

    /** Deprecated.
    */
    static const BackendHandleAccess kFlushWrite_TextureHandleAccess =
            kFlushWrite_BackendHandleAccess;

    /** Deprecated.
    */
    static const BackendHandleAccess kDiscardWrite_TextureHandleAccess =
            kDiscardWrite_BackendHandleAccess;

    /** Retrieves the back-end texture. If SkSurface has no back-end texture, an invalid
        object is returned. Call GrBackendTexture::isValid to determine if the result
        is valid.

        The returned GrBackendTexture should be discarded if the SkSurface is drawn to or deleted.

        @return                     GPU texture reference; invalid on failure
    */
    GrBackendTexture getBackendTexture(BackendHandleAccess backendHandleAccess);

    /** Retrieves the back-end render target. If SkSurface has no back-end render target, an invalid
        object is returned. Call GrBackendRenderTarget::isValid to determine if the result
        is valid.

        The returned GrBackendRenderTarget should be discarded if the SkSurface is drawn to
        or deleted.

        @return                     GPU render target reference; invalid on failure
    */
    GrBackendRenderTarget getBackendRenderTarget(BackendHandleAccess backendHandleAccess);

    /** If the surface was made via MakeFromBackendTexture then it's backing texture may be
        substituted with a different texture. The contents of the previous backing texture are
        copied into the new texture. SkCanvas state is preserved. The original sample count is
        used. The GrBackendFormat and dimensions of replacement texture must match that of
        the original.

        Upon success textureReleaseProc is called when it is safe to delete the texture in the
        backend API (accounting only for use of the texture by this surface). If SkSurface creation
        fails textureReleaseProc is called before this function returns.

        @param backendTexture      the new backing texture for the surface
        @param mode                Retain or discard current Content
        @param textureReleaseProc  function called when texture can be released
        @param releaseContext      state passed to textureReleaseProc
     */
    bool replaceBackendTexture(const GrBackendTexture& backendTexture,
                               GrSurfaceOrigin origin,
                               ContentChangeMode mode = kRetain_ContentChangeMode,
                               TextureReleaseProc textureReleaseProc = nullptr,
                               ReleaseContext releaseContext = nullptr);
#endif

    /** Returns SkCanvas that draws into SkSurface. Subsequent calls return the same SkCanvas.
        SkCanvas returned is managed and owned by SkSurface, and is deleted when SkSurface
        is deleted.

        @return  drawing SkCanvas for SkSurface

        example: https://fiddle.skia.org/c/@Surface_getCanvas
    */
    SkCanvas* getCanvas();

    /** Returns a compatible SkSurface, or nullptr. Returned SkSurface contains
        the same raster, GPU, or null properties as the original. Returned SkSurface
        does not share the same pixels.

        Returns nullptr if imageInfo width or height are zero, or if imageInfo
        is incompatible with SkSurface.

        @param imageInfo  width, height, SkColorType, SkAlphaType, SkColorSpace,
                          of SkSurface; width and height must be greater than zero
        @return           compatible SkSurface or nullptr

        example: https://fiddle.skia.org/c/@Surface_makeSurface
    */
    sk_sp<SkSurface> makeSurface(const SkImageInfo& imageInfo);

    /** Calls makeSurface(ImageInfo) with the same ImageInfo as this surface, but with the
     *  specified width and height.
     */
    sk_sp<SkSurface> makeSurface(int width, int height);

    /** Returns SkImage capturing SkSurface contents. Subsequent drawing to SkSurface contents
        are not captured. SkImage allocation is accounted for if SkSurface was created with
        SkBudgeted::kYes.

        @return  SkImage initialized with SkSurface contents

        example: https://fiddle.skia.org/c/@Surface_makeImageSnapshot
    */
    sk_sp<SkImage> makeImageSnapshot();

    /**
     *  Like the no-parameter version, this returns an image of the current surface contents.
     *  This variant takes a rectangle specifying the subset of the surface that is of interest.
     *  These bounds will be sanitized before being used.
     *  - If bounds extends beyond the surface, it will be trimmed to just the intersection of
     *    it and the surface.
     *  - If bounds does not intersect the surface, then this returns nullptr.
     *  - If bounds == the surface, then this is the same as calling the no-parameter variant.

        example: https://fiddle.skia.org/c/@Surface_makeImageSnapshot_2
     */
    sk_sp<SkImage> makeImageSnapshot(const SkIRect& bounds);

    /** Draws SkSurface contents to canvas, with its top-left corner at (x, y).

        If SkPaint paint is not nullptr, apply SkColorFilter, alpha, SkImageFilter, and SkBlendMode.

        @param canvas  SkCanvas drawn into
        @param x       horizontal offset in SkCanvas
        @param y       vertical offset in SkCanvas
        @param sampling what technique to use when sampling the surface pixels
        @param paint   SkPaint containing SkBlendMode, SkColorFilter, SkImageFilter,
                       and so on; or nullptr

        example: https://fiddle.skia.org/c/@Surface_draw
    */
    void draw(SkCanvas* canvas, SkScalar x, SkScalar y, const SkSamplingOptions& sampling,
              const SkPaint* paint);

    void draw(SkCanvas* canvas, SkScalar x, SkScalar y, const SkPaint* paint = nullptr) {
        this->draw(canvas, x, y, SkSamplingOptions(), paint);
    }

    /** Copies SkSurface pixel address, row bytes, and SkImageInfo to SkPixmap, if address
        is available, and returns true. If pixel address is not available, return
        false and leave SkPixmap unchanged.

        pixmap contents become invalid on any future change to SkSurface.

        @param pixmap  storage for pixel state if pixels are readable; otherwise, ignored
        @return        true if SkSurface has direct access to pixels

        example: https://fiddle.skia.org/c/@Surface_peekPixels
    */
    bool peekPixels(SkPixmap* pixmap);

    /** Copies SkRect of pixels to dst.

        Source SkRect corners are (srcX, srcY) and SkSurface (width(), height()).
        Destination SkRect corners are (0, 0) and (dst.width(), dst.height()).
        Copies each readable pixel intersecting both rectangles, without scaling,
        converting to dst.colorType() and dst.alphaType() if required.

        Pixels are readable when SkSurface is raster, or backed by a GPU.

        The destination pixel storage must be allocated by the caller.

        Pixel values are converted only if SkColorType and SkAlphaType
        do not match. Only pixels within both source and destination rectangles
        are copied. dst contents outside SkRect intersection are unchanged.

        Pass negative values for srcX or srcY to offset pixels across or down destination.

        Does not copy, and returns false if:
        - Source and destination rectangles do not intersect.
        - SkPixmap pixels could not be allocated.
        - dst.rowBytes() is too small to contain one row of pixels.

        @param dst   storage for pixels copied from SkSurface
        @param srcX  offset into readable pixels on x-axis; may be negative
        @param srcY  offset into readable pixels on y-axis; may be negative
        @return      true if pixels were copied

        example: https://fiddle.skia.org/c/@Surface_readPixels
    */
    bool readPixels(const SkPixmap& dst, int srcX, int srcY);

    /** Copies SkRect of pixels from SkCanvas into dstPixels.

        Source SkRect corners are (srcX, srcY) and SkSurface (width(), height()).
        Destination SkRect corners are (0, 0) and (dstInfo.width(), dstInfo.height()).
        Copies each readable pixel intersecting both rectangles, without scaling,
        converting to dstInfo.colorType() and dstInfo.alphaType() if required.

        Pixels are readable when SkSurface is raster, or backed by a GPU.

        The destination pixel storage must be allocated by the caller.

        Pixel values are converted only if SkColorType and SkAlphaType
        do not match. Only pixels within both source and destination rectangles
        are copied. dstPixels contents outside SkRect intersection are unchanged.

        Pass negative values for srcX or srcY to offset pixels across or down destination.

        Does not copy, and returns false if:
        - Source and destination rectangles do not intersect.
        - SkSurface pixels could not be converted to dstInfo.colorType() or dstInfo.alphaType().
        - dstRowBytes is too small to contain one row of pixels.

        @param dstInfo      width, height, SkColorType, and SkAlphaType of dstPixels
        @param dstPixels    storage for pixels; dstInfo.height() times dstRowBytes, or larger
        @param dstRowBytes  size of one destination row; dstInfo.width() times pixel size, or larger
        @param srcX         offset into readable pixels on x-axis; may be negative
        @param srcY         offset into readable pixels on y-axis; may be negative
        @return             true if pixels were copied
    */
    bool readPixels(const SkImageInfo& dstInfo, void* dstPixels, size_t dstRowBytes,
                    int srcX, int srcY);

    /** Copies SkRect of pixels from SkSurface into bitmap.

        Source SkRect corners are (srcX, srcY) and SkSurface (width(), height()).
        Destination SkRect corners are (0, 0) and (bitmap.width(), bitmap.height()).
        Copies each readable pixel intersecting both rectangles, without scaling,
        converting to bitmap.colorType() and bitmap.alphaType() if required.

        Pixels are readable when SkSurface is raster, or backed by a GPU.

        The destination pixel storage must be allocated by the caller.

        Pixel values are converted only if SkColorType and SkAlphaType
        do not match. Only pixels within both source and destination rectangles
        are copied. dst contents outside SkRect intersection are unchanged.

        Pass negative values for srcX or srcY to offset pixels across or down destination.

        Does not copy, and returns false if:
        - Source and destination rectangles do not intersect.
        - SkSurface pixels could not be converted to dst.colorType() or dst.alphaType().
        - dst pixels could not be allocated.
        - dst.rowBytes() is too small to contain one row of pixels.

        @param dst   storage for pixels copied from SkSurface
        @param srcX  offset into readable pixels on x-axis; may be negative
        @param srcY  offset into readable pixels on y-axis; may be negative
        @return      true if pixels were copied

        example: https://fiddle.skia.org/c/@Surface_readPixels_3
    */
    bool readPixels(const SkBitmap& dst, int srcX, int srcY);

    using AsyncReadResult = SkImage::AsyncReadResult;

    /** Client-provided context that is passed to client-provided ReadPixelsContext. */
    using ReadPixelsContext = void*;

    /**  Client-provided callback to asyncRescaleAndReadPixels() or
         asyncRescaleAndReadPixelsYUV420() that is called when read result is ready or on failure.
     */
    using ReadPixelsCallback = void(ReadPixelsContext, std::unique_ptr<const AsyncReadResult>);

    /** Controls the gamma that rescaling occurs in for asyncRescaleAndReadPixels() and
        asyncRescaleAndReadPixelsYUV420().
     */
    using RescaleGamma = SkImage::RescaleGamma;
    using RescaleMode  = SkImage::RescaleMode;

    /** Makes surface pixel data available to caller, possibly asynchronously. It can also rescale
        the surface pixels.

        Currently asynchronous reads are only supported on the GPU backend and only when the
        underlying 3D API supports transfer buffers and CPU/GPU synchronization primitives. In all
        other cases this operates synchronously.

        Data is read from the source sub-rectangle, is optionally converted to a linear gamma, is
        rescaled to the size indicated by 'info', is then converted to the color space, color type,
        and alpha type of 'info'. A 'srcRect' that is not contained by the bounds of the surface
        causes failure.

        When the pixel data is ready the caller's ReadPixelsCallback is called with a
        AsyncReadResult containing pixel data in the requested color type, alpha type, and color
        space. The AsyncReadResult will have count() == 1. Upon failure the callback is called
        with nullptr for AsyncReadResult. For a GPU surface this flushes work but a submit must
        occur to guarantee a finite time before the callback is called.

        The data is valid for the lifetime of AsyncReadResult with the exception that if the
        SkSurface is GPU-backed the data is immediately invalidated if the context is abandoned
        or destroyed.

        @param info            info of the requested pixels
        @param srcRect         subrectangle of surface to read
        @param rescaleGamma    controls whether rescaling is done in the surface's gamma or whether
                               the source data is transformed to a linear gamma before rescaling.
        @param rescaleMode     controls the technique of the rescaling
        @param callback        function to call with result of the read
        @param context         passed to callback
     */
    void asyncRescaleAndReadPixels(const SkImageInfo& info,
                                   const SkIRect& srcRect,
                                   RescaleGamma rescaleGamma,
                                   RescaleMode rescaleMode,
                                   ReadPixelsCallback callback,
                                   ReadPixelsContext context);

    /**
        Similar to asyncRescaleAndReadPixels but performs an additional conversion to YUV. The
        RGB->YUV conversion is controlled by 'yuvColorSpace'. The YUV data is returned as three
        planes ordered y, u, v. The u and v planes are half the width and height of the resized
        rectangle. The y, u, and v values are single bytes. Currently this fails if 'dstSize'
        width and height are not even. A 'srcRect' that is not contained by the bounds of the
        surface causes failure.

        When the pixel data is ready the caller's ReadPixelsCallback is called with a
        AsyncReadResult containing the planar data. The AsyncReadResult will have count() == 3.
        Upon failure the callback is called with nullptr for AsyncReadResult. For a GPU surface this
        flushes work but a submit must occur to guarantee a finite time before the callback is
        called.

        The data is valid for the lifetime of AsyncReadResult with the exception that if the
        SkSurface is GPU-backed the data is immediately invalidated if the context is abandoned
        or destroyed.

        @param yuvColorSpace  The transformation from RGB to YUV. Applied to the resized image
                              after it is converted to dstColorSpace.
        @param dstColorSpace  The color space to convert the resized image to, after rescaling.
        @param srcRect        The portion of the surface to rescale and convert to YUV planes.
        @param dstSize        The size to rescale srcRect to
        @param rescaleGamma   controls whether rescaling is done in the surface's gamma or whether
                              the source data is transformed to a linear gamma before rescaling.
        @param rescaleMode    controls the sampling technique of the rescaling
        @param callback       function to call with the planar read result
        @param context        passed to callback
     */
    void asyncRescaleAndReadPixelsYUV420(SkYUVColorSpace yuvColorSpace,
                                         sk_sp<SkColorSpace> dstColorSpace,
                                         const SkIRect& srcRect,
                                         const SkISize& dstSize,
                                         RescaleGamma rescaleGamma,
                                         RescaleMode rescaleMode,
                                         ReadPixelsCallback callback,
                                         ReadPixelsContext context);

    /** Copies SkRect of pixels from the src SkPixmap to the SkSurface.

        Source SkRect corners are (0, 0) and (src.width(), src.height()).
        Destination SkRect corners are (dstX, dstY) and
        (dstX + Surface width(), dstY + Surface height()).

        Copies each readable pixel intersecting both rectangles, without scaling,
        converting to SkSurface colorType() and SkSurface alphaType() if required.

        @param src   storage for pixels to copy to SkSurface
        @param dstX  x-axis position relative to SkSurface to begin copy; may be negative
        @param dstY  y-axis position relative to SkSurface to begin copy; may be negative

        example: https://fiddle.skia.org/c/@Surface_writePixels
    */
    void writePixels(const SkPixmap& src, int dstX, int dstY);

    /** Copies SkRect of pixels from the src SkBitmap to the SkSurface.

        Source SkRect corners are (0, 0) and (src.width(), src.height()).
        Destination SkRect corners are (dstX, dstY) and
        (dstX + Surface width(), dstY + Surface height()).

        Copies each readable pixel intersecting both rectangles, without scaling,
        converting to SkSurface colorType() and SkSurface alphaType() if required.

        @param src   storage for pixels to copy to SkSurface
        @param dstX  x-axis position relative to SkSurface to begin copy; may be negative
        @param dstY  y-axis position relative to SkSurface to begin copy; may be negative

        example: https://fiddle.skia.org/c/@Surface_writePixels_2
    */
    void writePixels(const SkBitmap& src, int dstX, int dstY);

    /** Returns SkSurfaceProps for surface.

        @return  LCD striping orientation and setting for device independent fonts
    */
    const SkSurfaceProps& props() const { return fProps; }

    /** Call to ensure all reads/writes of the surface have been issued to the underlying 3D API.
        Skia will correctly order its own draws and pixel operations. This must to be used to ensure
        correct ordering when the surface backing store is accessed outside Skia (e.g. direct use of
        the 3D API or a windowing system). GrDirectContext has additional flush and submit methods
        that apply to all surfaces and images created from a GrDirectContext. This is equivalent to
        calling SkSurface::flush with a default GrFlushInfo followed by
        GrDirectContext::submit(syncCpu).
    */
    void flushAndSubmit(bool syncCpu = false);

    enum class BackendSurfaceAccess {
        kNoAccess,  //!< back-end object will not be used by client
        kPresent,   //!< back-end surface will be used for presenting to screen
    };

#if SK_SUPPORT_GPU
    /** Issues pending SkSurface commands to the GPU-backed API objects and resolves any SkSurface
        MSAA. A call to GrDirectContext::submit is always required to ensure work is actually sent
        to the gpu. Some specific API details:
            GL: Commands are actually sent to the driver, but glFlush is never called. Thus some
                sync objects from the flush will not be valid until a submission occurs.

            Vulkan/Metal/D3D/Dawn: Commands are recorded to the backend APIs corresponding command
                buffer or encoder objects. However, these objects are not sent to the gpu until a
                submission occurs.

        The work that is submitted to the GPU will be dependent on the BackendSurfaceAccess that is
        passed in.

        If BackendSurfaceAccess::kNoAccess is passed in all commands will be issued to the GPU.

        If BackendSurfaceAccess::kPresent is passed in and the backend API is not Vulkan, it is
        treated the same as kNoAccess. If the backend API is Vulkan, the VkImage that backs the
        SkSurface will be transferred back to its original queue. If the SkSurface was created by
        wrapping a VkImage, the queue will be set to the queue which was originally passed in on
        the GrVkImageInfo. Additionally, if the original queue was not external or foreign the
        layout of the VkImage will be set to VK_IMAGE_LAYOUT_PRESENT_SRC_KHR.

        The GrFlushInfo describes additional options to flush. Please see documentation at
        GrFlushInfo for more info.

        If the return is GrSemaphoresSubmitted::kYes, only initialized GrBackendSemaphores will be
        submitted to the gpu during the next submit call (it is possible Skia failed to create a
        subset of the semaphores). The client should not wait on these semaphores until after submit
        has been called, but must keep them alive until then. If a submit flag was passed in with
        the flush these valid semaphores can we waited on immediately. If this call returns
        GrSemaphoresSubmitted::kNo, the GPU backend will not submit any semaphores to be signaled on
        the GPU. Thus the client should not have the GPU wait on any of the semaphores passed in
        with the GrFlushInfo. Regardless of whether semaphores were submitted to the GPU or not, the
        client is still responsible for deleting any initialized semaphores.
        Regardless of semaphore submission the context will still be flushed. It should be
        emphasized that a return value of GrSemaphoresSubmitted::kNo does not mean the flush did not
        happen. It simply means there were no semaphores submitted to the GPU. A caller should only
        take this as a failure if they passed in semaphores to be submitted.

        Pending surface commands are flushed regardless of the return result.

        @param access  type of access the call will do on the backend object after flush
        @param info    flush options
    */
    GrSemaphoresSubmitted flush(BackendSurfaceAccess access, const GrFlushInfo& info);

    /** Issues pending SkSurface commands to the GPU-backed API objects and resolves any SkSurface
        MSAA. A call to GrDirectContext::submit is always required to ensure work is actually sent
        to the gpu. Some specific API details:
            GL: Commands are actually sent to the driver, but glFlush is never called. Thus some
                sync objects from the flush will not be valid until a submission occurs.

            Vulkan/Metal/D3D/Dawn: Commands are recorded to the backend APIs corresponding command
                buffer or encoder objects. However, these objects are not sent to the gpu until a
                submission occurs.

        The GrFlushInfo describes additional options to flush. Please see documentation at
        GrFlushInfo for more info.

        If a GrBackendSurfaceMutableState is passed in, at the end of the flush we will transition
        the surface to be in the state requested by the GrBackendSurfaceMutableState. If the surface
        (or SkImage or GrBackendSurface wrapping the same backend object) is used again after this
        flush the state may be changed and no longer match what is requested here. This is often
        used if the surface will be used for presenting or external use and the client wants backend
        object to be prepped for that use. A finishedProc or semaphore on the GrFlushInfo will also
        include the work for any requested state change.

        If the backend API is Vulkan, the caller can set the GrBackendSurfaceMutableState's
        VkImageLayout to VK_IMAGE_LAYOUT_UNDEFINED or queueFamilyIndex to VK_QUEUE_FAMILY_IGNORED to
        tell Skia to not change those respective states.

        If the return is GrSemaphoresSubmitted::kYes, only initialized GrBackendSemaphores will be
        submitted to the gpu during the next submit call (it is possible Skia failed to create a
        subset of the semaphores). The client should not wait on these semaphores until after submit
        has been called, but must keep them alive until then. If a submit flag was passed in with
        the flush these valid semaphores can we waited on immediately. If this call returns
        GrSemaphoresSubmitted::kNo, the GPU backend will not submit any semaphores to be signaled on
        the GPU. Thus the client should not have the GPU wait on any of the semaphores passed in
        with the GrFlushInfo. Regardless of whether semaphores were submitted to the GPU or not, the
        client is still responsible for deleting any initialized semaphores.
        Regardleess of semaphore submission the context will still be flushed. It should be
        emphasized that a return value of GrSemaphoresSubmitted::kNo does not mean the flush did not
        happen. It simply means there were no semaphores submitted to the GPU. A caller should only
        take this as a failure if they passed in semaphores to be submitted.

        Pending surface commands are flushed regardless of the return result.

        @param info    flush options
        @param access  optional state change request after flush
    */
    GrSemaphoresSubmitted flush(const GrFlushInfo& info,
                                const GrBackendSurfaceMutableState* newState = nullptr);
#endif // SK_SUPPORT_GPU

    void flush();

    /** Inserts a list of GPU semaphores that the current GPU-backed API must wait on before
        executing any more commands on the GPU for this surface. If this call returns false, then
        the GPU back-end will not wait on any passed in semaphores, and the client will still own
        the semaphores, regardless of the value of deleteSemaphoresAfterWait.

        If deleteSemaphoresAfterWait is false then Skia will not delete the semaphores. In this case
        it is the client's responsibility to not destroy or attempt to reuse the semaphores until it
        knows that Skia has finished waiting on them. This can be done by using finishedProcs
        on flush calls.

        @param numSemaphores               size of waitSemaphores array
        @param waitSemaphores              array of semaphore containers
        @paramm deleteSemaphoresAfterWait  who owns and should delete the semaphores
        @return                            true if GPU is waiting on semaphores
    */
    bool wait(int numSemaphores, const GrBackendSemaphore* waitSemaphores,
              bool deleteSemaphoresAfterWait = true);

    /** Initializes SkSurfaceCharacterization that can be used to perform GPU back-end
        processing in a separate thread. Typically this is used to divide drawing
        into multiple tiles. SkDeferredDisplayListRecorder records the drawing commands
        for each tile.

        Return true if SkSurface supports characterization. raster surface returns false.

        @param characterization  properties for parallel drawing
        @return                  true if supported

        example: https://fiddle.skia.org/c/@Surface_characterize
    */
    bool characterize(SkSurfaceCharacterization* characterization) const;

    /** Draws the deferred display list created via a SkDeferredDisplayListRecorder.
        If the deferred display list is not compatible with this SkSurface, the draw is skipped
        and false is return.

        The xOffset and yOffset parameters are experimental and, if not both zero, will cause
        the draw to be ignored.
        When implemented, if xOffset or yOffset are non-zero, the DDL will be drawn offset by that
        amount into the surface.

        @param deferredDisplayList  drawing commands
        @param xOffset              x-offset at which to draw the DDL
        @param yOffset              y-offset at which to draw the DDL
        @return                     false if deferredDisplayList is not compatible

        example: https://fiddle.skia.org/c/@Surface_draw_2
    */
    bool draw(sk_sp<const SkDeferredDisplayList> deferredDisplayList,
              int xOffset = 0,
              int yOffset = 0);

protected:
    SkSurface(int width, int height, const SkSurfaceProps* surfaceProps);
    SkSurface(const SkImageInfo& imageInfo, const SkSurfaceProps* surfaceProps);

    // called by subclass if their contents have changed
    void dirtyGenerationID() {
        fGenerationID = 0;
    }

private:
    const SkSurfaceProps fProps;
    const int            fWidth;
    const int            fHeight;
    uint32_t             fGenerationID;

    using INHERITED = SkRefCnt;
};

#endif
