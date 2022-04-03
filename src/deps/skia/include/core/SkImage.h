/*
 * Copyright 2012 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkImage_DEFINED
#define SkImage_DEFINED

#include "include/core/SkImageEncoder.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkScalar.h"
#include "include/core/SkShader.h"
#include "include/core/SkTileMode.h"
#include "include/private/SkTOptional.h"
#if SK_SUPPORT_GPU
#include "include/gpu/GrTypes.h"
#endif
#include <functional>  // std::function

#if defined(SK_BUILD_FOR_ANDROID) && __ANDROID_API__ >= 26
#include <android/hardware_buffer.h>
#endif

class SkData;
class SkCanvas;
class SkImage;
class SkImageFilter;
class SkImageGenerator;
class SkMipmap;
class SkPaint;
class SkPicture;
class SkPromiseImageTexture;
class SkSurface;
class SkYUVAPixmaps;
class GrBackendFormat;
class GrBackendTexture;
class GrDirectContext;
class GrRecordingContext;
class GrContextThreadSafeProxy;
class GrYUVABackendTextureInfo;
class GrYUVABackendTextures;

/** \class SkImage
    SkImage describes a two dimensional array of pixels to draw. The pixels may be
    decoded in a raster bitmap, encoded in a SkPicture or compressed data stream,
    or located in GPU memory as a GPU texture.

    SkImage cannot be modified after it is created. SkImage may allocate additional
    storage as needed; for instance, an encoded SkImage may decode when drawn.

    SkImage width and height are greater than zero. Creating an SkImage with zero width
    or height returns SkImage equal to nullptr.

    SkImage may be created from SkBitmap, SkPixmap, SkSurface, SkPicture, encoded streams,
    GPU texture, YUV_ColorSpace data, or hardware buffer. Encoded streams supported
    include BMP, GIF, HEIF, ICO, JPEG, PNG, WBMP, WebP. Supported encoding details
    vary with platform.
*/
class SK_API SkImage : public SkRefCnt {
public:

    /** Caller data passed to RasterReleaseProc; may be nullptr.
    */
    typedef void* ReleaseContext;

    /** Creates SkImage from SkPixmap and copy of pixels. Since pixels are copied, SkPixmap
        pixels may be modified or deleted without affecting SkImage.

        SkImage is returned if SkPixmap is valid. Valid SkPixmap parameters include:
        dimensions are greater than zero;
        each dimension fits in 29 bits;
        SkColorType and SkAlphaType are valid, and SkColorType is not kUnknown_SkColorType;
        row bytes are large enough to hold one row of pixels;
        pixel address is not nullptr.

        @param pixmap  SkImageInfo, pixel address, and row bytes
        @return        copy of SkPixmap pixels, or nullptr

        example: https://fiddle.skia.org/c/@Image_MakeRasterCopy
    */
    static sk_sp<SkImage> MakeRasterCopy(const SkPixmap& pixmap);

    /** Creates SkImage from SkImageInfo, sharing pixels.

        SkImage is returned if SkImageInfo is valid. Valid SkImageInfo parameters include:
        dimensions are greater than zero;
        each dimension fits in 29 bits;
        SkColorType and SkAlphaType are valid, and SkColorType is not kUnknown_SkColorType;
        rowBytes are large enough to hold one row of pixels;
        pixels is not nullptr, and contains enough data for SkImage.

        @param info      contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param pixels    address or pixel storage
        @param rowBytes  size of pixel row or larger
        @return          SkImage sharing pixels, or nullptr
    */
    static sk_sp<SkImage> MakeRasterData(const SkImageInfo& info, sk_sp<SkData> pixels,
                                         size_t rowBytes);

    /** Function called when SkImage no longer shares pixels. ReleaseContext is
        provided by caller when SkImage is created, and may be nullptr.
    */
    typedef void (*RasterReleaseProc)(const void* pixels, ReleaseContext);

    /** Creates SkImage from pixmap, sharing SkPixmap pixels. Pixels must remain valid and
        unchanged until rasterReleaseProc is called. rasterReleaseProc is passed
        releaseContext when SkImage is deleted or no longer refers to pixmap pixels.

        Pass nullptr for rasterReleaseProc to share SkPixmap without requiring a callback
        when SkImage is released. Pass nullptr for releaseContext if rasterReleaseProc
        does not require state.

        SkImage is returned if pixmap is valid. Valid SkPixmap parameters include:
        dimensions are greater than zero;
        each dimension fits in 29 bits;
        SkColorType and SkAlphaType are valid, and SkColorType is not kUnknown_SkColorType;
        row bytes are large enough to hold one row of pixels;
        pixel address is not nullptr.

        @param pixmap             SkImageInfo, pixel address, and row bytes
        @param rasterReleaseProc  function called when pixels can be released; or nullptr
        @param releaseContext     state passed to rasterReleaseProc; or nullptr
        @return                   SkImage sharing pixmap
    */
    static sk_sp<SkImage> MakeFromRaster(const SkPixmap& pixmap,
                                         RasterReleaseProc rasterReleaseProc,
                                         ReleaseContext releaseContext);

    /** Creates SkImage from bitmap, sharing or copying bitmap pixels. If the bitmap
        is marked immutable, and its pixel memory is shareable, it may be shared
        instead of copied.

        SkImage is returned if bitmap is valid. Valid SkBitmap parameters include:
        dimensions are greater than zero;
        each dimension fits in 29 bits;
        SkColorType and SkAlphaType are valid, and SkColorType is not kUnknown_SkColorType;
        row bytes are large enough to hold one row of pixels;
        pixel address is not nullptr.

        @param bitmap  SkImageInfo, row bytes, and pixels
        @return        created SkImage, or nullptr

        example: https://fiddle.skia.org/c/@Image_MakeFromBitmap
    */
    static sk_sp<SkImage> MakeFromBitmap(const SkBitmap& bitmap);

    /** Creates SkImage from data returned by imageGenerator. Generated data is owned by SkImage and
        may not be shared or accessed.

        SkImage is returned if generator data is valid. Valid data parameters vary by type of data
        and platform.

        imageGenerator may wrap SkPicture data, codec data, or custom data.

        @param imageGenerator  stock or custom routines to retrieve SkImage
        @return                created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromGenerator(std::unique_ptr<SkImageGenerator> imageGenerator);

    /**
     *  Return an image backed by the encoded data, but attempt to defer decoding until the image
     *  is actually used/drawn. This deferral allows the system to cache the result, either on the
     *  CPU or on the GPU, depending on where the image is drawn. If memory is low, the cache may
     *  be purged, causing the next draw of the image to have to re-decode.
     *
     *  If alphaType is nullopt, the image's alpha type will be chosen automatically based on the
     *  image format. Transparent images will default to kPremul_SkAlphaType. If alphaType contains
     *  kPremul_SkAlphaType or kUnpremul_SkAlphaType, that alpha type will be used. Forcing opaque
     *  (passing kOpaque_SkAlphaType) is not allowed, and will return nullptr.
     *
     *  This is similar to DecodeTo[Raster,Texture], but this method will attempt to defer the
     *  actual decode, while the DecodeTo... method explicitly decode and allocate the backend
     *  when the call is made.
     *
     *  If the encoded format is not supported, nullptr is returned.
     *
     *  @param encoded  the encoded data
     *  @return         created SkImage, or nullptr

        example: https://fiddle.skia.org/c/@Image_MakeFromEncoded
    */
    static sk_sp<SkImage> MakeFromEncoded(sk_sp<SkData> encoded,
                                          skstd::optional<SkAlphaType> alphaType = skstd::nullopt);

    /*
     * Experimental:
     *   Skia                | GL_COMPRESSED_*     | MTLPixelFormat*      | VK_FORMAT_*_BLOCK
     *  --------------------------------------------------------------------------------------
     *   kETC2_RGB8_UNORM    | ETC1_RGB8           | ETC2_RGB8 (iOS-only) | ETC2_R8G8B8_UNORM
     *                       | RGB8_ETC2           |                      |
     *  --------------------------------------------------------------------------------------
     *   kBC1_RGB8_UNORM     | RGB_S3TC_DXT1_EXT   | N/A                  | BC1_RGB_UNORM
     *  --------------------------------------------------------------------------------------
     *   kBC1_RGBA8_UNORM    | RGBA_S3TC_DXT1_EXT  | BC1_RGBA (macOS-only)| BC1_RGBA_UNORM
     */
    enum class CompressionType {
        kNone,
        kETC2_RGB8_UNORM, // the same as ETC1

        kBC1_RGB8_UNORM,
        kBC1_RGBA8_UNORM,
        kLast = kBC1_RGBA8_UNORM,
    };

    static constexpr int kCompressionTypeCount = static_cast<int>(CompressionType::kLast) + 1;

    static const CompressionType kETC1_CompressionType = CompressionType::kETC2_RGB8_UNORM;

    /** Creates a CPU-backed SkImage from compressed data.

        This method will decompress the compressed data and create an image wrapping
        it. Any mipmap levels present in the compressed data are discarded.

        @param data     compressed data to store in SkImage
        @param width    width of full SkImage
        @param height   height of full SkImage
        @param type     type of compression used
        @return         created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeRasterFromCompressed(sk_sp<SkData> data,
                                                   int width, int height,
                                                   CompressionType type);

    enum class BitDepth {
        kU8,  //!< uses 8-bit unsigned int per color component
        kF16, //!< uses 16-bit float per color component
    };

    /** Creates SkImage from picture. Returned SkImage width and height are set by dimensions.
        SkImage draws picture with matrix and paint, set to bitDepth and colorSpace.

        If matrix is nullptr, draws with identity SkMatrix. If paint is nullptr, draws
        with default SkPaint. colorSpace may be nullptr.

        @param picture     stream of drawing commands
        @param dimensions  width and height
        @param matrix      SkMatrix to rotate, scale, translate, and so on; may be nullptr
        @param paint       SkPaint to apply transparency, filtering, and so on; may be nullptr
        @param bitDepth    8-bit integer or 16-bit float: per component
        @param colorSpace  range of colors; may be nullptr
        @return            created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromPicture(sk_sp<SkPicture> picture, const SkISize& dimensions,
                                          const SkMatrix* matrix, const SkPaint* paint,
                                          BitDepth bitDepth,
                                          sk_sp<SkColorSpace> colorSpace);

#if SK_SUPPORT_GPU
        /** Creates a GPU-backed SkImage from compressed data.

        This method will return an SkImage representing the compressed data.
        If the GPU doesn't support the specified compression method, the data
        will be decompressed and then wrapped in a GPU-backed image.

        Note: one can query the supported compression formats via
        GrRecordingContext::compressedBackendFormat.

        @param context     GPU context
        @param data        compressed data to store in SkImage
        @param width       width of full SkImage
        @param height      height of full SkImage
        @param type        type of compression used
        @param mipMapped   does 'data' contain data for all the mipmap levels?
        @param isProtected do the contents of 'data' require DRM protection (on Vulkan)?
        @return            created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeTextureFromCompressed(GrDirectContext* direct,
                                                    sk_sp<SkData> data,
                                                    int width, int height,
                                                    CompressionType type,
                                                    GrMipmapped mipMapped = GrMipmapped::kNo,
                                                    GrProtected isProtected = GrProtected::kNo);

    /** User function called when supplied texture may be deleted.
    */
    typedef void (*TextureReleaseProc)(ReleaseContext releaseContext);

    /** Creates SkImage from GPU texture associated with context. GPU texture must stay
        valid and unchanged until textureReleaseProc is called. textureReleaseProc is
        passed releaseContext when SkImage is deleted or no longer refers to texture.

        SkImage is returned if format of backendTexture is recognized and supported.
        Recognized formats vary by GPU back-end.

        @note When using a DDL recording context, textureReleaseProc will be called on the
        GPU thread after the DDL is played back on the direct context.

        @param context             GPU context
        @param backendTexture      texture residing on GPU
        @param colorSpace          This describes the color space of this image's contents, as
                                   seen after sampling. In general, if the format of the backend
                                   texture is SRGB, some linear colorSpace should be supplied
                                   (e.g., SkColorSpace::MakeSRGBLinear()). If the format of the
                                   backend texture is linear, then the colorSpace should include
                                   a description of the transfer function as
                                   well (e.g., SkColorSpace::MakeSRGB()).
        @param textureReleaseProc  function called when texture can be released
        @param releaseContext      state passed to textureReleaseProc
        @return                    created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromTexture(GrRecordingContext* context,
                                          const GrBackendTexture& backendTexture,
                                          GrSurfaceOrigin origin,
                                          SkColorType colorType,
                                          SkAlphaType alphaType,
                                          sk_sp<SkColorSpace> colorSpace,
                                          TextureReleaseProc textureReleaseProc = nullptr,
                                          ReleaseContext releaseContext = nullptr);

    /** Creates an SkImage from a GPU backend texture. The backend texture must stay
        valid and unchanged until textureReleaseProc is called. The textureReleaseProc is
        called when the SkImage is deleted or no longer refers to the texture and will be
        passed the releaseContext.

        An SkImage is returned if the format of backendTexture is recognized and supported.
        Recognized formats vary by GPU back-end.

        @note When using a DDL recording context, textureReleaseProc will be called on the
        GPU thread after the DDL is played back on the direct context.

        @param context             the GPU context
        @param backendTexture      a texture already allocated by the GPU
        @param alphaType           This characterizes the nature of the alpha values in the
                                   backend texture. For opaque compressed formats (e.g., ETC1)
                                   this should usually be set to kOpaque_SkAlphaType.
        @param colorSpace          This describes the color space of this image's contents, as
                                   seen after sampling. In general, if the format of the backend
                                   texture is SRGB, some linear colorSpace should be supplied
                                   (e.g., SkColorSpace::MakeSRGBLinear()). If the format of the
                                   backend texture is linear, then the colorSpace should include
                                   a description of the transfer function as
                                   well (e.g., SkColorSpace::MakeSRGB()).
        @param textureReleaseProc  function called when the backend texture can be released
        @param releaseContext      state passed to textureReleaseProc
        @return                    created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromCompressedTexture(GrRecordingContext* context,
                                                    const GrBackendTexture& backendTexture,
                                                    GrSurfaceOrigin origin,
                                                    SkAlphaType alphaType,
                                                    sk_sp<SkColorSpace> colorSpace,
                                                    TextureReleaseProc textureReleaseProc = nullptr,
                                                    ReleaseContext releaseContext = nullptr);

    /** Creates SkImage from pixmap. SkImage is uploaded to GPU back-end using context.

        Created SkImage is available to other GPU contexts, and is available across thread
        boundaries. All contexts must be in the same GPU share group, or otherwise
        share resources.

        When SkImage is no longer referenced, context releases texture memory
        asynchronously.

        GrBackendTexture created from pixmap is uploaded to match SkSurface created with
        dstColorSpace. SkColorSpace of SkImage is determined by pixmap.colorSpace().

        SkImage is returned referring to GPU back-end if context is not nullptr,
        format of data is recognized and supported, and if context supports moving
        resources between contexts. Otherwise, pixmap pixel data is copied and SkImage
        as returned in raster format if possible; nullptr may be returned.
        Recognized GPU formats vary by platform and GPU back-end.

        @param context                GPU context
        @param pixmap                 SkImageInfo, pixel address, and row bytes
        @param buildMips              create SkImage as mip map if true
        @param dstColorSpace          range of colors of matching SkSurface on GPU
        @param limitToMaxTextureSize  downscale image to GPU maximum texture size, if necessary
        @return                       created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeCrossContextFromPixmap(GrDirectContext* context,
                                                     const SkPixmap& pixmap,
                                                     bool buildMips,
                                                     bool limitToMaxTextureSize = false);

    /** Creates SkImage from backendTexture associated with context. backendTexture and
        returned SkImage are managed internally, and are released when no longer needed.

        SkImage is returned if format of backendTexture is recognized and supported.
        Recognized formats vary by GPU back-end.

        @param context         GPU context
        @param backendTexture  texture residing on GPU
        @param textureOrigin   origin of backendTexture
        @param colorType       color type of the resulting image
        @param alphaType       alpha type of the resulting image
        @param colorSpace      range of colors; may be nullptr
        @return                created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromAdoptedTexture(GrRecordingContext* context,
                                                 const GrBackendTexture& backendTexture,
                                                 GrSurfaceOrigin textureOrigin,
                                                 SkColorType colorType,
                                                 SkAlphaType alphaType = kPremul_SkAlphaType,
                                                 sk_sp<SkColorSpace> colorSpace = nullptr);

    /** Creates an SkImage from YUV[A] planar textures. This requires that the textures stay valid
        for the lifetime of the image. The ReleaseContext can be used to know when it is safe to
        either delete or overwrite the textures. If ReleaseProc is provided it is also called before
        return on failure.

        @param context            GPU context
        @param yuvaTextures       A set of textures containing YUVA data and a description of the
                                  data and transformation to RGBA.
        @param imageColorSpace    range of colors of the resulting image after conversion to RGB;
                                  may be nullptr
        @param textureReleaseProc called when the backend textures can be released
        @param releaseContext     state passed to textureReleaseProc
        @return                   created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromYUVATextures(GrRecordingContext* context,
                                               const GrYUVABackendTextures& yuvaTextures,
                                               sk_sp<SkColorSpace> imageColorSpace = nullptr,
                                               TextureReleaseProc textureReleaseProc = nullptr,
                                               ReleaseContext releaseContext = nullptr);

    /** Creates SkImage from SkYUVAPixmaps.

        The image will remain planar with each plane converted to a texture using the passed
        GrRecordingContext.

        SkYUVAPixmaps has a SkYUVAInfo which specifies the transformation from YUV to RGB.
        The SkColorSpace of the resulting RGB values is specified by imageColorSpace. This will
        be the SkColorSpace reported by the image and when drawn the RGB values will be converted
        from this space into the destination space (if the destination is tagged).

        Currently, this is only supported using the GPU backend and will fail if context is nullptr.

        SkYUVAPixmaps does not need to remain valid after this returns.

        @param context                GPU context
        @param pixmaps                The planes as pixmaps with supported SkYUVAInfo that
                                      specifies conversion to RGB.
        @param buildMips              create internal YUVA textures as mip map if kYes. This is
                                      silently ignored if the context does not support mip maps.
        @param limitToMaxTextureSize  downscale image to GPU maximum texture size, if necessary
        @param imageColorSpace        range of colors of the resulting image; may be nullptr
        @return                       created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromYUVAPixmaps(GrRecordingContext* context,
                                              const SkYUVAPixmaps& pixmaps,
                                              GrMipMapped buildMips = GrMipmapped::kNo,
                                              bool limitToMaxTextureSize = false,
                                              sk_sp<SkColorSpace> imageColorSpace = nullptr);

    using PromiseImageTextureContext = void*;
    using PromiseImageTextureFulfillProc =
            sk_sp<SkPromiseImageTexture> (*)(PromiseImageTextureContext);
    using PromiseImageTextureReleaseProc = void (*)(PromiseImageTextureContext);

    /** Create a new SkImage that is very similar to an SkImage created by MakeFromTexture. The
        difference is that the caller need not have created the texture nor populated it with the
        image pixel data. Moreover, the SkImage may be created on a thread as the creation of the
        image does not require access to the backend API or GrDirectContext. Instead of passing a
        GrBackendTexture the client supplies a description of the texture consisting of
        GrBackendFormat, width, height, and GrMipmapped state. The resulting SkImage can be drawn
        to a SkDeferredDisplayListRecorder or directly to a GPU-backed SkSurface.

        When the actual texture is required to perform a backend API draw, textureFulfillProc will
        be called to receive a GrBackendTexture. The properties of the GrBackendTexture must match
        those set during the SkImage creation, and it must refer to a valid existing texture in the
        backend API context/device, and be populated with the image pixel data. The texture cannot
        be deleted until textureReleaseProc is called.

        There is at most one call to each of textureFulfillProc and textureReleaseProc.
        textureReleaseProc is always called even if image creation fails or if the
        image is never fulfilled (e.g. it is never drawn or all draws are clipped out)

        @param gpuContextProxy     the thread-safe proxy of the gpu context. required.
        @param backendFormat       format of promised gpu texture
        @param dimensions          width & height of promised gpu texture
        @param mipMapped           mip mapped state of promised gpu texture
        @param origin              surface origin of promised gpu texture
        @param colorType           color type of promised gpu texture
        @param alphaType           alpha type of promised gpu texture
        @param colorSpace          range of colors; may be nullptr
        @param textureFulfillProc  function called to get actual gpu texture
        @param textureReleaseProc  function called when texture can be deleted
        @param textureContext      state passed to textureFulfillProc and textureReleaseProc
        @return                    created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakePromiseTexture(sk_sp<GrContextThreadSafeProxy> gpuContextProxy,
                                             const GrBackendFormat& backendFormat,
                                             SkISize dimensions,
                                             GrMipmapped mipMapped,
                                             GrSurfaceOrigin origin,
                                             SkColorType colorType,
                                             SkAlphaType alphaType,
                                             sk_sp<SkColorSpace> colorSpace,
                                             PromiseImageTextureFulfillProc textureFulfillProc,
                                             PromiseImageTextureReleaseProc textureReleaseProc,
                                             PromiseImageTextureContext textureContext);

    /** This entry point operates like 'MakePromiseTexture' but it is used to construct a SkImage
        from YUV[A] data. The source data may be planar (i.e. spread across multiple textures). In
        the extreme Y, U, V, and A are all in different planes and thus the image is specified by
        four textures. 'backendTextureInfo' describes the planar arrangement, texture formats,
        conversion to RGB, and origin of the textures. Separate 'textureFulfillProc' and
        'textureReleaseProc' calls are made for each texture. Each texture has its own
        PromiseImageTextureContext. If 'backendTextureInfo' is not valid then no release proc
        calls are made. Otherwise, the calls will be made even on failure. 'textureContexts' has one
        entry for each of the up to four textures, as indicated by 'backendTextureInfo'.

        Currently the mip mapped property of 'backendTextureInfo' is ignored. However, in the
        near future it will be required that if it is kYes then textureFulfillProc must return
        a mip mapped texture for each plane in order to successfully draw the image.

        @param gpuContextProxy     the thread-safe proxy of the gpu context. required.
        @param backendTextureInfo  info about the promised yuva gpu texture
        @param imageColorSpace     range of colors; may be nullptr
        @param textureFulfillProc  function called to get actual gpu texture
        @param textureReleaseProc  function called when texture can be deleted
        @param textureContexts     state passed to textureFulfillProc and textureReleaseProc
        @return                    created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakePromiseYUVATexture(sk_sp<GrContextThreadSafeProxy> gpuContextProxy,
                                                 const GrYUVABackendTextureInfo& backendTextureInfo,
                                                 sk_sp<SkColorSpace> imageColorSpace,
                                                 PromiseImageTextureFulfillProc textureFulfillProc,
                                                 PromiseImageTextureReleaseProc textureReleaseProc,
                                                 PromiseImageTextureContext textureContexts[]);

#endif // SK_SUPPORT_GPU

#if defined(SK_BUILD_FOR_ANDROID) && __ANDROID_API__ >= 26
    /** (See Skia bug 7447)
        Creates SkImage from Android hardware buffer.
        Returned SkImage takes a reference on the buffer.

        Only available on Android, when __ANDROID_API__ is defined to be 26 or greater.

        @param hardwareBuffer  AHardwareBuffer Android hardware buffer
        @param colorSpace      range of colors; may be nullptr
        @return                created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromAHardwareBuffer(
            AHardwareBuffer* hardwareBuffer,
            SkAlphaType alphaType = kPremul_SkAlphaType,
            sk_sp<SkColorSpace> colorSpace = nullptr,
            GrSurfaceOrigin surfaceOrigin = kTopLeft_GrSurfaceOrigin);

    /** Creates SkImage from Android hardware buffer and uploads the data from the SkPixmap to it.
        Returned SkImage takes a reference on the buffer.

        Only available on Android, when __ANDROID_API__ is defined to be 26 or greater.

        @param context         GPU context
        @param pixmap          SkPixmap that contains data to be uploaded to the AHardwareBuffer
        @param hardwareBuffer  AHardwareBuffer Android hardware buffer
        @param surfaceOrigin   surface origin for resulting image
        @return                created SkImage, or nullptr
    */
    static sk_sp<SkImage> MakeFromAHardwareBufferWithData(
            GrDirectContext* context,
            const SkPixmap& pixmap,
            AHardwareBuffer* hardwareBuffer,
            GrSurfaceOrigin surfaceOrigin = kTopLeft_GrSurfaceOrigin);
#endif

    /** Returns a SkImageInfo describing the width, height, color type, alpha type, and color space
        of the SkImage.

        @return  image info of SkImage.
    */
    const SkImageInfo& imageInfo() const { return fInfo; }

    /** Returns pixel count in each row.

        @return  pixel width in SkImage
    */
    int width() const { return fInfo.width(); }

    /** Returns pixel row count.

        @return  pixel height in SkImage
    */
    int height() const { return fInfo.height(); }

    /** Returns SkISize { width(), height() }.

        @return  integral size of width() and height()
    */
    SkISize dimensions() const { return SkISize::Make(fInfo.width(), fInfo.height()); }

    /** Returns SkIRect { 0, 0, width(), height() }.

        @return  integral rectangle from origin to width() and height()
    */
    SkIRect bounds() const { return SkIRect::MakeWH(fInfo.width(), fInfo.height()); }

    /** Returns value unique to image. SkImage contents cannot change after SkImage is
        created. Any operation to create a new SkImage will receive generate a new
        unique number.

        @return  unique identifier
    */
    uint32_t uniqueID() const { return fUniqueID; }

    /** Returns SkAlphaType.

        SkAlphaType returned was a parameter to an SkImage constructor,
        or was parsed from encoded data.

        @return  SkAlphaType in SkImage

        example: https://fiddle.skia.org/c/@Image_alphaType
    */
    SkAlphaType alphaType() const;

    /** Returns SkColorType if known; otherwise, returns kUnknown_SkColorType.

        @return  SkColorType of SkImage

        example: https://fiddle.skia.org/c/@Image_colorType
    */
    SkColorType colorType() const;

    /** Returns SkColorSpace, the range of colors, associated with SkImage.  The
        reference count of SkColorSpace is unchanged. The returned SkColorSpace is
        immutable.

        SkColorSpace returned was passed to an SkImage constructor,
        or was parsed from encoded data. SkColorSpace returned may be ignored when SkImage
        is drawn, depending on the capabilities of the SkSurface receiving the drawing.

        @return  SkColorSpace in SkImage, or nullptr

        example: https://fiddle.skia.org/c/@Image_colorSpace
    */
    SkColorSpace* colorSpace() const;

    /** Returns a smart pointer to SkColorSpace, the range of colors, associated with
        SkImage.  The smart pointer tracks the number of objects sharing this
        SkColorSpace reference so the memory is released when the owners destruct.

        The returned SkColorSpace is immutable.

        SkColorSpace returned was passed to an SkImage constructor,
        or was parsed from encoded data. SkColorSpace returned may be ignored when SkImage
        is drawn, depending on the capabilities of the SkSurface receiving the drawing.

        @return  SkColorSpace in SkImage, or nullptr, wrapped in a smart pointer

        example: https://fiddle.skia.org/c/@Image_refColorSpace
    */
    sk_sp<SkColorSpace> refColorSpace() const;

    /** Returns true if SkImage pixels represent transparency only. If true, each pixel
        is packed in 8 bits as defined by kAlpha_8_SkColorType.

        @return  true if pixels represent a transparency mask

        example: https://fiddle.skia.org/c/@Image_isAlphaOnly
    */
    bool isAlphaOnly() const;

    /** Returns true if pixels ignore their alpha value and are treated as fully opaque.

        @return  true if SkAlphaType is kOpaque_SkAlphaType
    */
    bool isOpaque() const { return SkAlphaTypeIsOpaque(this->alphaType()); }

    /**
     *  Make a shader with the specified tiling and mipmap sampling.
     */
    sk_sp<SkShader> makeShader(SkTileMode tmx, SkTileMode tmy, const SkSamplingOptions&,
                               const SkMatrix* localMatrix = nullptr) const;

    sk_sp<SkShader> makeShader(SkTileMode tmx, SkTileMode tmy, const SkSamplingOptions& sampling,
                               const SkMatrix& lm) const {
        return this->makeShader(tmx, tmy, sampling, &lm);
    }
    sk_sp<SkShader> makeShader(const SkSamplingOptions& sampling, const SkMatrix& lm) const {
        return this->makeShader(SkTileMode::kClamp, SkTileMode::kClamp, sampling, &lm);
    }
    sk_sp<SkShader> makeShader(const SkSamplingOptions& sampling,
                               const SkMatrix* lm = nullptr) const {
        return this->makeShader(SkTileMode::kClamp, SkTileMode::kClamp, sampling, lm);
    }

    /**
     *  makeRawShader functions like makeShader, but for images that contain non-color data.
     *  This includes images encoding things like normals, material properties (eg, roughness),
     *  heightmaps, or any other purely mathematical data that happens to be stored in an image.
     *  These types of images are useful with some programmable shaders (see: SkRuntimeEffect).
     *
     *  Raw image shaders work like regular image shaders (including filtering and tiling), with
     *  a few major differences:
     *    - No color space transformation is ever applied (the color space of the image is ignored).
     *    - Images with an alpha type of kUnpremul are *not* automatically premultiplied.
     *    - Bicubic filtering is not supported. If SkSamplingOptions::useCubic is true, these
     *      factories will return nullptr.
     */
    sk_sp<SkShader> makeRawShader(SkTileMode tmx, SkTileMode tmy, const SkSamplingOptions&,
                                  const SkMatrix* localMatrix = nullptr) const;

    sk_sp<SkShader> makeRawShader(SkTileMode tmx, SkTileMode tmy, const SkSamplingOptions& sampling,
                                  const SkMatrix& lm) const {
        return this->makeRawShader(tmx, tmy, sampling, &lm);
    }
    sk_sp<SkShader> makeRawShader(const SkSamplingOptions& sampling, const SkMatrix& lm) const {
        return this->makeRawShader(SkTileMode::kClamp, SkTileMode::kClamp, sampling, &lm);
    }
    sk_sp<SkShader> makeRawShader(const SkSamplingOptions& sampling,
                                  const SkMatrix* lm = nullptr) const {
        return this->makeRawShader(SkTileMode::kClamp, SkTileMode::kClamp, sampling, lm);
    }

    using CubicResampler = SkCubicResampler;

    /** Copies SkImage pixel address, row bytes, and SkImageInfo to pixmap, if address
        is available, and returns true. If pixel address is not available, return
        false and leave pixmap unchanged.

        @param pixmap  storage for pixel state if pixels are readable; otherwise, ignored
        @return        true if SkImage has direct access to pixels

        example: https://fiddle.skia.org/c/@Image_peekPixels
    */
    bool peekPixels(SkPixmap* pixmap) const;

    /** Returns true the contents of SkImage was created on or uploaded to GPU memory,
        and is available as a GPU texture.

        @return  true if SkImage is a GPU texture

        example: https://fiddle.skia.org/c/@Image_isTextureBacked
    */
    bool isTextureBacked() const;

    /** Returns an approximation of the amount of texture memory used by the image. Returns
        zero if the image is not texture backed or if the texture has an external format.
     */
    size_t textureSize() const;

    /** Returns true if SkImage can be drawn on either raster surface or GPU surface.
        If context is nullptr, tests if SkImage draws on raster surface;
        otherwise, tests if SkImage draws on GPU surface associated with context.

        SkImage backed by GPU texture may become invalid if associated context is
        invalid. lazy image may be invalid and may not draw to raster surface or
        GPU surface or both.

        @param context  GPU context
        @return         true if SkImage can be drawn

        example: https://fiddle.skia.org/c/@Image_isValid
    */
    bool isValid(GrRecordingContext* context) const;

#if SK_SUPPORT_GPU
    /** Flushes any pending uses of texture-backed images in the GPU backend. If the image is not
        texture-backed (including promise texture images) or if the GrDirectContext does not
        have the same context ID as the context backing the image then this is a no-op.

        If the image was not used in any non-culled draws in the current queue of work for the
        passed GrDirectContext then this is a no-op unless the GrFlushInfo contains semaphores or
        a finish proc. Those are respected even when the image has not been used.

        @param context  the context on which to flush pending usages of the image.
        @param info     flush options
     */
    GrSemaphoresSubmitted flush(GrDirectContext* context, const GrFlushInfo& flushInfo) const;

    void flush(GrDirectContext* context) const { this->flush(context, {}); }

    /** Version of flush() that uses a default GrFlushInfo. Also submits the flushed work to the
        GPU.
    */
    void flushAndSubmit(GrDirectContext*) const;

    /** Retrieves the back-end texture. If SkImage has no back-end texture, an invalid
        object is returned. Call GrBackendTexture::isValid to determine if the result
        is valid.

        If flushPendingGrContextIO is true, completes deferred I/O operations.

        If origin in not nullptr, copies location of content drawn into SkImage.

        @param flushPendingGrContextIO  flag to flush outstanding requests
        @return                         back-end API texture handle; invalid on failure
    */
    GrBackendTexture getBackendTexture(bool flushPendingGrContextIO,
                                       GrSurfaceOrigin* origin = nullptr) const;
#endif // SK_SUPPORT_GPU

    /** \enum SkImage::CachingHint
        CachingHint selects whether Skia may internally cache SkBitmap generated by
        decoding SkImage, or by copying SkImage from GPU to CPU. The default behavior
        allows caching SkBitmap.

        Choose kDisallow_CachingHint if SkImage pixels are to be used only once, or
        if SkImage pixels reside in a cache outside of Skia, or to reduce memory pressure.

        Choosing kAllow_CachingHint does not ensure that pixels will be cached.
        SkImage pixels may not be cached if memory requirements are too large or
        pixels are not accessible.
    */
    enum CachingHint {
        kAllow_CachingHint,    //!< allows internally caching decoded and copied pixels
        kDisallow_CachingHint, //!< disallows internally caching decoded and copied pixels
    };

    /** Copies SkRect of pixels from SkImage to dstPixels. Copy starts at offset (srcX, srcY),
        and does not exceed SkImage (width(), height()).

        dstInfo specifies width, height, SkColorType, SkAlphaType, and SkColorSpace of
        destination. dstRowBytes specifies the gap from one destination row to the next.
        Returns true if pixels are copied. Returns false if:
        - dstInfo.addr() equals nullptr
        - dstRowBytes is less than dstInfo.minRowBytes()
        - SkPixelRef is nullptr

        Pixels are copied only if pixel conversion is possible. If SkImage SkColorType is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dstInfo.colorType() must match.
        If SkImage SkColorType is kGray_8_SkColorType, dstInfo.colorSpace() must match.
        If SkImage SkAlphaType is kOpaque_SkAlphaType, dstInfo.alphaType() must
        match. If SkImage SkColorSpace is nullptr, dstInfo.colorSpace() must match. Returns
        false if pixel conversion is not possible.

        srcX and srcY may be negative to copy only top or left of source. Returns
        false if width() or height() is zero or negative.
        Returns false if abs(srcX) >= Image width(), or if abs(srcY) >= Image height().

        If cachingHint is kAllow_CachingHint, pixels may be retained locally.
        If cachingHint is kDisallow_CachingHint, pixels are not added to the local cache.

        @param context      the GrDirectContext in play, if it exists
        @param dstInfo      destination width, height, SkColorType, SkAlphaType, SkColorSpace
        @param dstPixels    destination pixel storage
        @param dstRowBytes  destination row length
        @param srcX         column index whose absolute value is less than width()
        @param srcY         row index whose absolute value is less than height()
        @param cachingHint  whether the pixels should be cached locally
        @return             true if pixels are copied to dstPixels
    */
    bool readPixels(GrDirectContext* context,
                    const SkImageInfo& dstInfo,
                    void* dstPixels,
                    size_t dstRowBytes,
                    int srcX, int srcY,
                    CachingHint cachingHint = kAllow_CachingHint) const;

    /** Copies a SkRect of pixels from SkImage to dst. Copy starts at (srcX, srcY), and
        does not exceed SkImage (width(), height()).

        dst specifies width, height, SkColorType, SkAlphaType, SkColorSpace, pixel storage,
        and row bytes of destination. dst.rowBytes() specifics the gap from one destination
        row to the next. Returns true if pixels are copied. Returns false if:
        - dst pixel storage equals nullptr
        - dst.rowBytes is less than SkImageInfo::minRowBytes
        - SkPixelRef is nullptr

        Pixels are copied only if pixel conversion is possible. If SkImage SkColorType is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dst.colorType() must match.
        If SkImage SkColorType is kGray_8_SkColorType, dst.colorSpace() must match.
        If SkImage SkAlphaType is kOpaque_SkAlphaType, dst.alphaType() must
        match. If SkImage SkColorSpace is nullptr, dst.colorSpace() must match. Returns
        false if pixel conversion is not possible.

        srcX and srcY may be negative to copy only top or left of source. Returns
        false if width() or height() is zero or negative.
        Returns false if abs(srcX) >= Image width(), or if abs(srcY) >= Image height().

        If cachingHint is kAllow_CachingHint, pixels may be retained locally.
        If cachingHint is kDisallow_CachingHint, pixels are not added to the local cache.

        @param context      the GrDirectContext in play, if it exists
        @param dst          destination SkPixmap: SkImageInfo, pixels, row bytes
        @param srcX         column index whose absolute value is less than width()
        @param srcY         row index whose absolute value is less than height()
        @param cachingHint  whether the pixels should be cached locallyZ
        @return             true if pixels are copied to dst
    */
    bool readPixels(GrDirectContext* context,
                    const SkPixmap& dst,
                    int srcX,
                    int srcY,
                    CachingHint cachingHint = kAllow_CachingHint) const;

#ifndef SK_IMAGE_READ_PIXELS_DISABLE_LEGACY_API
    /** Deprecated. Use the variants that accept a GrDirectContext. */
    bool readPixels(const SkImageInfo& dstInfo, void* dstPixels, size_t dstRowBytes,
                    int srcX, int srcY, CachingHint cachingHint = kAllow_CachingHint) const;
    bool readPixels(const SkPixmap& dst, int srcX, int srcY,
                    CachingHint cachingHint = kAllow_CachingHint) const;
#endif

    /** The result from asyncRescaleAndReadPixels() or asyncRescaleAndReadPixelsYUV420(). */
    class AsyncReadResult {
    public:
        AsyncReadResult(const AsyncReadResult&) = delete;
        AsyncReadResult(AsyncReadResult&&) = delete;
        AsyncReadResult& operator=(const AsyncReadResult&) = delete;
        AsyncReadResult& operator=(AsyncReadResult&&) = delete;

        virtual ~AsyncReadResult() = default;
        virtual int count() const = 0;
        virtual const void* data(int i) const = 0;
        virtual size_t rowBytes(int i) const = 0;

    protected:
        AsyncReadResult() = default;
    };

    /** Client-provided context that is passed to client-provided ReadPixelsContext. */
    using ReadPixelsContext = void*;

    /**  Client-provided callback to asyncRescaleAndReadPixels() or
         asyncRescaleAndReadPixelsYUV420() that is called when read result is ready or on failure.
     */
    using ReadPixelsCallback = void(ReadPixelsContext, std::unique_ptr<const AsyncReadResult>);

    enum class RescaleGamma : bool { kSrc, kLinear };

    enum class RescaleMode {
        kNearest,
        kRepeatedLinear,
        kRepeatedCubic,
    };

    /** Makes image pixel data available to caller, possibly asynchronously. It can also rescale
        the image pixels.

        Currently asynchronous reads are only supported on the GPU backend and only when the
        underlying 3D API supports transfer buffers and CPU/GPU synchronization primitives. In all
        other cases this operates synchronously.

        Data is read from the source sub-rectangle, is optionally converted to a linear gamma, is
        rescaled to the size indicated by 'info', is then converted to the color space, color type,
        and alpha type of 'info'. A 'srcRect' that is not contained by the bounds of the image
        causes failure.

        When the pixel data is ready the caller's ReadPixelsCallback is called with a
        AsyncReadResult containing pixel data in the requested color type, alpha type, and color
        space. The AsyncReadResult will have count() == 1. Upon failure the callback is called with
        nullptr for AsyncReadResult. For a GPU image this flushes work but a submit must occur to
        guarantee a finite time before the callback is called.

        The data is valid for the lifetime of AsyncReadResult with the exception that if the SkImage
        is GPU-backed the data is immediately invalidated if the context is abandoned or
        destroyed.

        @param info            info of the requested pixels
        @param srcRect         subrectangle of image to read
        @param rescaleGamma    controls whether rescaling is done in the image's gamma or whether
                               the source data is transformed to a linear gamma before rescaling.
        @param rescaleMode     controls the technique (and cost) of the rescaling
        @param callback        function to call with result of the read
        @param context         passed to callback
    */
    void asyncRescaleAndReadPixels(const SkImageInfo& info,
                                   const SkIRect& srcRect,
                                   RescaleGamma rescaleGamma,
                                   RescaleMode rescaleMode,
                                   ReadPixelsCallback callback,
                                   ReadPixelsContext context) const;

    /**
        Similar to asyncRescaleAndReadPixels but performs an additional conversion to YUV. The
        RGB->YUV conversion is controlled by 'yuvColorSpace'. The YUV data is returned as three
        planes ordered y, u, v. The u and v planes are half the width and height of the resized
        rectangle. The y, u, and v values are single bytes. Currently this fails if 'dstSize'
        width and height are not even. A 'srcRect' that is not contained by the bounds of the
        image causes failure.

        When the pixel data is ready the caller's ReadPixelsCallback is called with a
        AsyncReadResult containing the planar data. The AsyncReadResult will have count() == 3.
        Upon failure the callback is called with nullptr for AsyncReadResult. For a GPU image this
        flushes work but a submit must occur to guarantee a finite time before the callback is
        called.

        The data is valid for the lifetime of AsyncReadResult with the exception that if the SkImage
        is GPU-backed the data is immediately invalidated if the context is abandoned or
        destroyed.

        @param yuvColorSpace  The transformation from RGB to YUV. Applied to the resized image
                              after it is converted to dstColorSpace.
        @param dstColorSpace  The color space to convert the resized image to, after rescaling.
        @param srcRect        The portion of the image to rescale and convert to YUV planes.
        @param dstSize        The size to rescale srcRect to
        @param rescaleGamma   controls whether rescaling is done in the image's gamma or whether
                              the source data is transformed to a linear gamma before rescaling.
        @param rescaleMode    controls the technique (and cost) of the rescaling
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
                                         ReadPixelsContext context) const;

    /** Copies SkImage to dst, scaling pixels to fit dst.width() and dst.height(), and
        converting pixels to match dst.colorType() and dst.alphaType(). Returns true if
        pixels are copied. Returns false if dst.addr() is nullptr, or dst.rowBytes() is
        less than dst SkImageInfo::minRowBytes.

        Pixels are copied only if pixel conversion is possible. If SkImage SkColorType is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dst.colorType() must match.
        If SkImage SkColorType is kGray_8_SkColorType, dst.colorSpace() must match.
        If SkImage SkAlphaType is kOpaque_SkAlphaType, dst.alphaType() must
        match. If SkImage SkColorSpace is nullptr, dst.colorSpace() must match. Returns
        false if pixel conversion is not possible.

        If cachingHint is kAllow_CachingHint, pixels may be retained locally.
        If cachingHint is kDisallow_CachingHint, pixels are not added to the local cache.

        @param dst            destination SkPixmap: SkImageInfo, pixels, row bytes
        @return               true if pixels are scaled to fit dst
    */
    bool scalePixels(const SkPixmap& dst, const SkSamplingOptions&,
                     CachingHint cachingHint = kAllow_CachingHint) const;

    /** Encodes SkImage pixels, returning result as SkData.

        Returns nullptr if encoding fails, or if encodedImageFormat is not supported.

        SkImage encoding in a format requires both building with one or more of:
        SK_ENCODE_JPEG, SK_ENCODE_PNG, SK_ENCODE_WEBP; and platform support
        for the encoded format.

        If SK_BUILD_FOR_MAC or SK_BUILD_FOR_IOS is defined, encodedImageFormat can
        additionally be one of: SkEncodedImageFormat::kICO, SkEncodedImageFormat::kBMP,
        SkEncodedImageFormat::kGIF.

        quality is a platform and format specific metric trading off size and encoding
        error. When used, quality equaling 100 encodes with the least error. quality may
        be ignored by the encoder.

        @param encodedImageFormat  one of: SkEncodedImageFormat::kJPEG, SkEncodedImageFormat::kPNG,
                                   SkEncodedImageFormat::kWEBP
        @param quality             encoder specific metric with 100 equaling best
        @return                    encoded SkImage, or nullptr

        example: https://fiddle.skia.org/c/@Image_encodeToData
    */
    sk_sp<SkData> encodeToData(SkEncodedImageFormat encodedImageFormat, int quality) const;

    /** Encodes SkImage pixels, returning result as SkData. Returns existing encoded data
        if present; otherwise, SkImage is encoded with SkEncodedImageFormat::kPNG. Skia
        must be built with SK_ENCODE_PNG to encode SkImage.

        Returns nullptr if existing encoded data is missing or invalid, and
        encoding fails.

        @return  encoded SkImage, or nullptr

        example: https://fiddle.skia.org/c/@Image_encodeToData_2
    */
    sk_sp<SkData> encodeToData() const;

    /** Returns encoded SkImage pixels as SkData, if SkImage was created from supported
        encoded stream format. Platform support for formats vary and may require building
        with one or more of: SK_ENCODE_JPEG, SK_ENCODE_PNG, SK_ENCODE_WEBP.

        Returns nullptr if SkImage contents are not encoded.

        @return  encoded SkImage, or nullptr

        example: https://fiddle.skia.org/c/@Image_refEncodedData
    */
    sk_sp<SkData> refEncodedData() const;

    /** Returns subset of this image.

        Returns nullptr if any of the following are true:
          - Subset is empty
          - Subset is not contained inside the image's bounds
          - Pixels in the image could not be read or copied

        If this image is texture-backed, the context parameter is required and must match the
        context of the source image. If the context parameter is provided, and the image is
        raster-backed, the subset will be converted to texture-backed.

        @param subset  bounds of returned SkImage
        @param context the GrDirectContext in play, if it exists
        @return        the subsetted image, or nullptr

        example: https://fiddle.skia.org/c/@Image_makeSubset
    */
    sk_sp<SkImage> makeSubset(const SkIRect& subset, GrDirectContext* direct = nullptr) const;

    /**
     *  Returns true if the image has mipmap levels.
     */
    bool hasMipmaps() const;

    /**
     *  Returns an image with the same "base" pixels as the this image, but with mipmap levels
     *  automatically generated and attached.
     */
    sk_sp<SkImage> withDefaultMipmaps() const;

#if SK_SUPPORT_GPU
    /** Returns SkImage backed by GPU texture associated with context. Returned SkImage is
        compatible with SkSurface created with dstColorSpace. The returned SkImage respects
        mipMapped setting; if mipMapped equals GrMipmapped::kYes, the backing texture
        allocates mip map levels.

        The mipMapped parameter is effectively treated as kNo if MIP maps are not supported by the
        GPU.

        Returns original SkImage if the image is already texture-backed, the context matches, and
        mipMapped is compatible with the backing GPU texture. SkBudgeted is ignored in this case.

        Returns nullptr if context is nullptr, or if SkImage was created with another
        GrDirectContext.

        @param GrDirectContext the GrDirectContext in play, if it exists
        @param GrMipmapped     whether created SkImage texture must allocate mip map levels
        @param SkBudgeted      whether to count a newly created texture for the returned image
                               counts against the context's budget.
        @return                created SkImage, or nullptr
    */
    sk_sp<SkImage> makeTextureImage(GrDirectContext*,
                                    GrMipmapped = GrMipmapped::kNo,
                                    SkBudgeted = SkBudgeted::kYes) const;
#endif

    /** Returns raster image or lazy image. Copies SkImage backed by GPU texture into
        CPU memory if needed. Returns original SkImage if decoded in raster bitmap,
        or if encoded in a stream.

        Returns nullptr if backed by GPU texture and copy fails.

        @return  raster image, lazy image, or nullptr

        example: https://fiddle.skia.org/c/@Image_makeNonTextureImage
    */
    sk_sp<SkImage> makeNonTextureImage() const;

    /** Returns raster image. Copies SkImage backed by GPU texture into CPU memory,
        or decodes SkImage from lazy image. Returns original SkImage if decoded in
        raster bitmap.

        Returns nullptr if copy, decode, or pixel read fails.

        If cachingHint is kAllow_CachingHint, pixels may be retained locally.
        If cachingHint is kDisallow_CachingHint, pixels are not added to the local cache.

        @return  raster image, or nullptr

        example: https://fiddle.skia.org/c/@Image_makeRasterImage
    */
    sk_sp<SkImage> makeRasterImage(CachingHint cachingHint = kDisallow_CachingHint) const;

    /** Creates filtered SkImage. filter processes original SkImage, potentially changing
        color, position, and size. subset is the bounds of original SkImage processed
        by filter. clipBounds is the expected bounds of the filtered SkImage. outSubset
        is required storage for the actual bounds of the filtered SkImage. offset is
        required storage for translation of returned SkImage.

        Returns nullptr if SkImage could not be created or if the recording context provided doesn't
        match the GPU context in which the image was created. If nullptr is returned, outSubset
        and offset are undefined.

        Useful for animation of SkImageFilter that varies size from frame to frame.
        Returned SkImage is created larger than required by filter so that GPU texture
        can be reused with different sized effects. outSubset describes the valid bounds
        of GPU texture returned. offset translates the returned SkImage to keep subsequent
        animation frames aligned with respect to each other.

        @param context     the GrRecordingContext in play - if it exists
        @param filter      how SkImage is sampled when transformed
        @param subset      bounds of SkImage processed by filter
        @param clipBounds  expected bounds of filtered SkImage
        @param outSubset   storage for returned SkImage bounds
        @param offset      storage for returned SkImage translation
        @return            filtered SkImage, or nullptr
    */
    sk_sp<SkImage> makeWithFilter(GrRecordingContext* context,
                                  const SkImageFilter* filter, const SkIRect& subset,
                                  const SkIRect& clipBounds, SkIRect* outSubset,
                                  SkIPoint* offset) const;

    /** Defines a callback function, taking one parameter of type GrBackendTexture with
        no return value. Function is called when back-end texture is to be released.
    */
    typedef std::function<void(GrBackendTexture)> BackendTextureReleaseProc;

#if SK_SUPPORT_GPU
    /** Creates a GrBackendTexture from the provided SkImage. Returns true and
        stores result in backendTexture and backendTextureReleaseProc if
        texture is created; otherwise, returns false and leaves
        backendTexture and backendTextureReleaseProc unmodified.

        Call backendTextureReleaseProc after deleting backendTexture.
        backendTextureReleaseProc cleans up auxiliary data related to returned
        backendTexture. The caller must delete returned backendTexture after use.

        If SkImage is both texture backed and singly referenced, image is returned in
        backendTexture without conversion or making a copy. SkImage is singly referenced
        if its was transferred solely using std::move().

        If SkImage is not texture backed, returns texture with SkImage contents.

        @param context                    GPU context
        @param image                      SkImage used for texture
        @param backendTexture             storage for back-end texture
        @param backendTextureReleaseProc  storage for clean up function
        @return                           true if back-end texture was created
    */
    static bool MakeBackendTextureFromSkImage(GrDirectContext* context,
                                              sk_sp<SkImage> image,
                                              GrBackendTexture* backendTexture,
                                              BackendTextureReleaseProc* backendTextureReleaseProc);
#endif
    /** Deprecated.
     */
    enum LegacyBitmapMode {
        kRO_LegacyBitmapMode, //!< returned bitmap is read-only and immutable
    };

    /** Deprecated.
        Creates raster SkBitmap with same pixels as SkImage. If legacyBitmapMode is
        kRO_LegacyBitmapMode, returned bitmap is read-only and immutable.
        Returns true if SkBitmap is stored in bitmap. Returns false and resets bitmap if
        SkBitmap write did not succeed.

        @param bitmap            storage for legacy SkBitmap
        @param legacyBitmapMode  bitmap is read-only and immutable
        @return                  true if SkBitmap was created
    */
    bool asLegacyBitmap(SkBitmap* bitmap,
                        LegacyBitmapMode legacyBitmapMode = kRO_LegacyBitmapMode) const;

    /** Returns true if SkImage is backed by an image-generator or other service that creates
        and caches its pixels or texture on-demand.

        @return  true if SkImage is created as needed

        example: https://fiddle.skia.org/c/@Image_isLazyGenerated_a
        example: https://fiddle.skia.org/c/@Image_isLazyGenerated_b
    */
    bool isLazyGenerated() const;

    /** Creates SkImage in target SkColorSpace.
        Returns nullptr if SkImage could not be created.

        Returns original SkImage if it is in target SkColorSpace.
        Otherwise, converts pixels from SkImage SkColorSpace to target SkColorSpace.
        If SkImage colorSpace() returns nullptr, SkImage SkColorSpace is assumed to be sRGB.

        If this image is texture-backed, the context parameter is required and must match the
        context of the source image.

        @param target  SkColorSpace describing color range of returned SkImage
        @param direct  The GrDirectContext in play, if it exists
        @return        created SkImage in target SkColorSpace

        example: https://fiddle.skia.org/c/@Image_makeColorSpace
    */
    sk_sp<SkImage> makeColorSpace(sk_sp<SkColorSpace> target,
                                  GrDirectContext* direct = nullptr) const;

    /** Experimental.
        Creates SkImage in target SkColorType and SkColorSpace.
        Returns nullptr if SkImage could not be created.

        Returns original SkImage if it is in target SkColorType and SkColorSpace.

        If this image is texture-backed, the context parameter is required and must match the
        context of the source image.

        @param targetColorType  SkColorType of returned SkImage
        @param targetColorSpace SkColorSpace of returned SkImage
        @param direct           The GrDirectContext in play, if it exists
        @return                 created SkImage in target SkColorType and SkColorSpace
    */
    sk_sp<SkImage> makeColorTypeAndColorSpace(SkColorType targetColorType,
                                              sk_sp<SkColorSpace> targetColorSpace,
                                              GrDirectContext* direct = nullptr) const;

    /** Creates a new SkImage identical to this one, but with a different SkColorSpace.
        This does not convert the underlying pixel data, so the resulting image will draw
        differently.
    */
    sk_sp<SkImage> reinterpretColorSpace(sk_sp<SkColorSpace> newColorSpace) const;

private:
    SkImage(const SkImageInfo& info, uint32_t uniqueID);

    friend class SkBitmap;
    friend class SkImage_Base;
    friend class SkMipmapBuilder;

    SkImageInfo     fInfo;
    const uint32_t  fUniqueID;

    sk_sp<SkImage> withMipmaps(sk_sp<SkMipmap>) const;

    using INHERITED = SkRefCnt;
};

#endif
