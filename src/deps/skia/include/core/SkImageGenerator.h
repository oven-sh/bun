/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkImageGenerator_DEFINED
#define SkImageGenerator_DEFINED

#include "include/core/SkBitmap.h"
#include "include/core/SkColor.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkYUVAPixmaps.h"
#include "include/private/SkTOptional.h"

class GrRecordingContext;
class GrSurfaceProxyView;
class GrSamplerState;
class SkBitmap;
class SkData;
class SkMatrix;
class SkPaint;
class SkPicture;

enum class GrImageTexGenPolicy : int;

class SK_API SkImageGenerator {
public:
    /**
     *  The PixelRef which takes ownership of this SkImageGenerator
     *  will call the image generator's destructor.
     */
    virtual ~SkImageGenerator() { }

    uint32_t uniqueID() const { return fUniqueID; }

    /**
     *  Return a ref to the encoded (i.e. compressed) representation
     *  of this data.
     *
     *  If non-NULL is returned, the caller is responsible for calling
     *  unref() on the data when it is finished.
     */
    sk_sp<SkData> refEncodedData() {
        return this->onRefEncodedData();
    }

    /**
     *  Return the ImageInfo associated with this generator.
     */
    const SkImageInfo& getInfo() const { return fInfo; }

    /**
     *  Can this generator be used to produce images that will be drawable to the specified context
     *  (or to CPU, if context is nullptr)?
     */
    bool isValid(GrRecordingContext* context) const {
        return this->onIsValid(context);
    }

    /**
     *  Decode into the given pixels, a block of memory of size at
     *  least (info.fHeight - 1) * rowBytes + (info.fWidth *
     *  bytesPerPixel)
     *
     *  Repeated calls to this function should give the same results,
     *  allowing the PixelRef to be immutable.
     *
     *  @param info A description of the format
     *         expected by the caller.  This can simply be identical
     *         to the info returned by getInfo().
     *
     *         This contract also allows the caller to specify
     *         different output-configs, which the implementation can
     *         decide to support or not.
     *
     *         A size that does not match getInfo() implies a request
     *         to scale. If the generator cannot perform this scale,
     *         it will return false.
     *
     *  @return true on success.
     */
    bool getPixels(const SkImageInfo& info, void* pixels, size_t rowBytes);

    bool getPixels(const SkPixmap& pm) {
        return this->getPixels(pm.info(), pm.writable_addr(), pm.rowBytes());
    }

    /**
     *  If decoding to YUV is supported, this returns true. Otherwise, this
     *  returns false and the caller will ignore output parameter yuvaPixmapInfo.
     *
     * @param  supportedDataTypes Indicates the data type/planar config combinations that are
     *                            supported by the caller. If the generator supports decoding to
     *                            YUV(A), but not as a type in supportedDataTypes, this method
     *                            returns false.
     *  @param yuvaPixmapInfo Output parameter that specifies the planar configuration, subsampling,
     *                        orientation, chroma siting, plane color types, and row bytes.
     */
    bool queryYUVAInfo(const SkYUVAPixmapInfo::SupportedDataTypes& supportedDataTypes,
                       SkYUVAPixmapInfo* yuvaPixmapInfo) const;

    /**
     *  Returns true on success and false on failure.
     *  This always attempts to perform a full decode. To get the planar
     *  configuration without decoding use queryYUVAInfo().
     *
     *  @param yuvaPixmaps  Contains preallocated pixmaps configured according to a successful call
     *                      to queryYUVAInfo().
     */
    bool getYUVAPlanes(const SkYUVAPixmaps& yuvaPixmaps);

#if SK_SUPPORT_GPU
    /**
     *  If the generator can natively/efficiently return its pixels as a GPU image (backed by a
     *  texture) this will return that image. If not, this will return NULL.
     *
     *  This routine also supports retrieving only a subset of the pixels. That subset is specified
     *  by the following rectangle:
     *
     *      subset = SkIRect::MakeXYWH(origin.x(), origin.y(), info.width(), info.height())
     *
     *  If subset is not contained inside the generator's bounds, this returns false.
     *
     *      whole = SkIRect::MakeWH(getInfo().width(), getInfo().height())
     *      if (!whole.contains(subset)) {
     *          return false;
     *      }
     *
     *  Regarding the GrRecordingContext parameter:
     *
     *  It must be non-NULL. The generator should only succeed if:
     *  - its internal context is the same
     *  - it can somehow convert its texture into one that is valid for the provided context.
     *
     *  If the willNeedMipMaps flag is true, the generator should try to create a TextureProxy that
     *  at least has the mip levels allocated and the base layer filled in. If this is not possible,
     *  the generator is allowed to return a non mipped proxy, but this will have some additional
     *  overhead in later allocating mips and copying of the base layer.
     *
     *  GrImageTexGenPolicy determines whether or not a new texture must be created (and its budget
     *  status) or whether this may (but is not required to) return a pre-existing texture that is
     *  retained by the generator (kDraw).
     */
    GrSurfaceProxyView generateTexture(GrRecordingContext*, const SkImageInfo& info,
                                       const SkIPoint& origin, GrMipmapped, GrImageTexGenPolicy);

#endif

    /**
     *  If the default image decoder system can interpret the specified (encoded) data, then
     *  this returns a new ImageGenerator for it. Otherwise this returns NULL. Either way
     *  the caller is still responsible for managing their ownership of the data.
     *  By default, images will be converted to premultiplied pixels. The alpha type can be
     *  overridden by specifying kPremul_SkAlphaType or kUnpremul_SkAlphaType. Specifying
     *  kOpaque_SkAlphaType is not supported, and will return NULL.
     */
    static std::unique_ptr<SkImageGenerator> MakeFromEncoded(
            sk_sp<SkData>, skstd::optional<SkAlphaType> = skstd::nullopt);

    /** Return a new image generator backed by the specified picture.  If the size is empty or
     *  the picture is NULL, this returns NULL.
     *  The optional matrix and paint arguments are passed to drawPicture() at rasterization
     *  time.
     */
    static std::unique_ptr<SkImageGenerator> MakeFromPicture(const SkISize&, sk_sp<SkPicture>,
                                                             const SkMatrix*, const SkPaint*,
                                                             SkImage::BitDepth,
                                                             sk_sp<SkColorSpace>);

protected:
    static constexpr int kNeedNewImageUniqueID = 0;

    SkImageGenerator(const SkImageInfo& info, uint32_t uniqueId = kNeedNewImageUniqueID);

    virtual sk_sp<SkData> onRefEncodedData() { return nullptr; }
    struct Options {};
    virtual bool onGetPixels(const SkImageInfo&, void*, size_t, const Options&) { return false; }
    virtual bool onIsValid(GrRecordingContext*) const { return true; }
    virtual bool onQueryYUVAInfo(const SkYUVAPixmapInfo::SupportedDataTypes&,
                                 SkYUVAPixmapInfo*) const { return false; }
    virtual bool onGetYUVAPlanes(const SkYUVAPixmaps&) { return false; }
#if SK_SUPPORT_GPU
    // returns nullptr
    virtual GrSurfaceProxyView onGenerateTexture(GrRecordingContext*, const SkImageInfo&,
                                                 const SkIPoint&, GrMipmapped, GrImageTexGenPolicy);

    // Most internal SkImageGenerators produce textures and views that use kTopLeft_GrSurfaceOrigin.
    // If the generator may produce textures with different origins (e.g.
    // GrAHardwareBufferImageGenerator) it should override this function to return the correct
    // origin.
    virtual GrSurfaceOrigin origin() const { return kTopLeft_GrSurfaceOrigin; }
#endif

private:
    const SkImageInfo fInfo;
    const uint32_t fUniqueID;

    friend class SkImage_Lazy;

    // This is our default impl, which may be different on different platforms.
    // It is called from NewFromEncoded() after it has checked for any runtime factory.
    // The SkData will never be NULL, as that will have been checked by NewFromEncoded.
    static std::unique_ptr<SkImageGenerator> MakeFromEncodedImpl(sk_sp<SkData>,
                                                                 skstd::optional<SkAlphaType>);

    SkImageGenerator(SkImageGenerator&&) = delete;
    SkImageGenerator(const SkImageGenerator&) = delete;
    SkImageGenerator& operator=(SkImageGenerator&&) = delete;
    SkImageGenerator& operator=(const SkImageGenerator&) = delete;
};

#endif  // SkImageGenerator_DEFINED
