/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkAndroidCodec_DEFINED
#define SkAndroidCodec_DEFINED

#include "include/codec/SkCodec.h"
#include "include/core/SkEncodedImageFormat.h"
#include "include/core/SkStream.h"
#include "include/core/SkTypes.h"

/**
 *  Abstract interface defining image codec functionality that is necessary for
 *  Android.
 */
class SK_API SkAndroidCodec : SkNoncopyable {
public:
    /**
     * Deprecated.
     *
     * Now that SkAndroidCodec supports multiframe images, there are multiple
     * ways to handle compositing an oriented frame on top of an oriented frame
     * with different tradeoffs. SkAndroidCodec now ignores the orientation and
     * forces the client to handle it.
     */
    enum class ExifOrientationBehavior {
        kIgnore,
        kRespect,
    };

    /**
     *  Pass ownership of an SkCodec to a newly-created SkAndroidCodec.
     */
    static std::unique_ptr<SkAndroidCodec> MakeFromCodec(std::unique_ptr<SkCodec>);

    /**
     *  If this stream represents an encoded image that we know how to decode,
     *  return an SkAndroidCodec that can decode it. Otherwise return NULL.
     *
     *  The SkPngChunkReader handles unknown chunks in PNGs.
     *  See SkCodec.h for more details.
     *
     *  If NULL is returned, the stream is deleted immediately. Otherwise, the
     *  SkCodec takes ownership of it, and will delete it when done with it.
     */
    static std::unique_ptr<SkAndroidCodec> MakeFromStream(std::unique_ptr<SkStream>,
                                                          SkPngChunkReader* = nullptr);

    /**
     *  If this data represents an encoded image that we know how to decode,
     *  return an SkAndroidCodec that can decode it. Otherwise return NULL.
     *
     *  The SkPngChunkReader handles unknown chunks in PNGs.
     *  See SkCodec.h for more details.
     */
    static std::unique_ptr<SkAndroidCodec> MakeFromData(sk_sp<SkData>, SkPngChunkReader* = nullptr);

    virtual ~SkAndroidCodec();

    // TODO: fInfo is now just a cache of SkCodec's SkImageInfo. No need to
    // cache and return a reference here, once Android call-sites are updated.
    const SkImageInfo& getInfo() const { return fInfo; }

    /**
     * Return the ICC profile of the encoded data.
     */
    const skcms_ICCProfile* getICCProfile() const {
        return fCodec->getEncodedInfo().profile();
    }

    /**
     *  Format of the encoded data.
     */
    SkEncodedImageFormat getEncodedFormat() const { return fCodec->getEncodedFormat(); }

    /**
     *  @param requestedColorType Color type requested by the client
     *
     *  |requestedColorType| may be overriden.  We will default to kF16
     *  for high precision images.
     *
     *  In the general case, if it is possible to decode to
     *  |requestedColorType|, this returns |requestedColorType|.
     *  Otherwise, this returns a color type that is an appropriate
     *  match for the the encoded data.
     */
    SkColorType computeOutputColorType(SkColorType requestedColorType);

    /**
     *  @param requestedUnpremul  Indicates if the client requested
     *                            unpremultiplied output
     *
     *  Returns the appropriate alpha type to decode to.  If the image
     *  has alpha, the value of requestedUnpremul will be honored.
     */
    SkAlphaType computeOutputAlphaType(bool requestedUnpremul);

    /**
     *  @param outputColorType Color type that the client will decode to.
     *  @param prefColorSpace  Preferred color space to decode to.
     *                         This may not return |prefColorSpace| for a couple reasons.
     *                         (1) Android Principles: 565 must be sRGB, F16 must be
     *                             linear sRGB, transfer function must be parametric.
     *                         (2) Codec Limitations: F16 requires a linear color space.
     *
     *  Returns the appropriate color space to decode to.
     */
    sk_sp<SkColorSpace> computeOutputColorSpace(SkColorType outputColorType,
                                                sk_sp<SkColorSpace> prefColorSpace = nullptr);

    /**
     *  Compute the appropriate sample size to get to |size|.
     *
     *  @param size As an input parameter, the desired output size of
     *      the decode. As an output parameter, the smallest sampled size
     *      larger than the input.
     *  @return the sample size to set AndroidOptions::fSampleSize to decode
     *      to the output |size|.
     */
    int computeSampleSize(SkISize* size) const;

    /**
     *  Returns the dimensions of the scaled output image, for an input
     *  sampleSize.
     *
     *  When the sample size divides evenly into the original dimensions, the
     *  scaled output dimensions will simply be equal to the original
     *  dimensions divided by the sample size.
     *
     *  When the sample size does not divide even into the original
     *  dimensions, the codec may round up or down, depending on what is most
     *  efficient to decode.
     *
     *  Finally, the codec will always recommend a non-zero output, so the output
     *  dimension will always be one if the sampleSize is greater than the
     *  original dimension.
     */
    SkISize getSampledDimensions(int sampleSize) const;

    /**
     *  Return (via desiredSubset) a subset which can decoded from this codec,
     *  or false if the input subset is invalid.
     *
     *  @param desiredSubset in/out parameter
     *                       As input, a desired subset of the original bounds
     *                       (as specified by getInfo).
     *                       As output, if true is returned, desiredSubset may
     *                       have been modified to a subset which is
     *                       supported. Although a particular change may have
     *                       been made to desiredSubset to create something
     *                       supported, it is possible other changes could
     *                       result in a valid subset.  If false is returned,
     *                       desiredSubset's value is undefined.
     *  @return true         If the input desiredSubset is valid.
     *                       desiredSubset may be modified to a subset
     *                       supported by the codec.
     *          false        If desiredSubset is invalid (NULL or not fully
     *                       contained within the image).
     */
    bool getSupportedSubset(SkIRect* desiredSubset) const;
    // TODO: Rename SkCodec::getValidSubset() to getSupportedSubset()

    /**
     *  Returns the dimensions of the scaled, partial output image, for an
     *  input sampleSize and subset.
     *
     *  @param sampleSize Factor to scale down by.
     *  @param subset     Must be a valid subset of the original image
     *                    dimensions and a subset supported by SkAndroidCodec.
     *                    getSubset() can be used to obtain a subset supported
     *                    by SkAndroidCodec.
     *  @return           Size of the scaled partial image.  Or zero size
     *                    if either of the inputs is invalid.
     */
    SkISize getSampledSubsetDimensions(int sampleSize, const SkIRect& subset) const;

    /**
     *  Additional options to pass to getAndroidPixels().
     */
    // FIXME: It's a bit redundant to name these AndroidOptions when this class is already
    //        called SkAndroidCodec.  On the other hand, it's may be a bit confusing to call
    //        these Options when SkCodec has a slightly different set of Options.  Maybe these
    //        should be DecodeOptions or SamplingOptions?
    struct AndroidOptions : public SkCodec::Options {
        AndroidOptions()
            : SkCodec::Options()
            , fSampleSize(1)
        {}

        /**
         *  The client may provide an integer downscale factor for the decode.
         *  The codec may implement this downscaling by sampling or another
         *  method if it is more efficient.
         *
         *  The default is 1, representing no downscaling.
         */
        int fSampleSize;
    };

    /**
     *  Decode into the given pixels, a block of memory of size at
     *  least (info.fHeight - 1) * rowBytes + (info.fWidth *
     *  bytesPerPixel)
     *
     *  Repeated calls to this function should give the same results,
     *  allowing the PixelRef to be immutable.
     *
     *  @param info A description of the format (config, size)
     *         expected by the caller.  This can simply be identical
     *         to the info returned by getInfo().
     *
     *         This contract also allows the caller to specify
     *         different output-configs, which the implementation can
     *         decide to support or not.
     *
     *         A size that does not match getInfo() implies a request
     *         to scale or subset. If the codec cannot perform this
     *         scaling or subsetting, it will return an error code.
     *
     *  The AndroidOptions object is also used to specify any requested scaling or subsetting
     *  using options->fSampleSize and options->fSubset. If NULL, the defaults (as specified above
     *  for AndroidOptions) are used.
     *
     *  @return Result kSuccess, or another value explaining the type of failure.
     */
    // FIXME: It's a bit redundant to name this getAndroidPixels() when this class is already
    //        called SkAndroidCodec.  On the other hand, it's may be a bit confusing to call
    //        this getPixels() when it is a slightly different API than SkCodec's getPixels().
    //        Maybe this should be decode() or decodeSubset()?
    SkCodec::Result getAndroidPixels(const SkImageInfo& info, void* pixels, size_t rowBytes,
            const AndroidOptions* options);

    /**
     *  Simplified version of getAndroidPixels() where we supply the default AndroidOptions as
     *  specified above for AndroidOptions. It will not perform any scaling or subsetting.
     */
    SkCodec::Result getAndroidPixels(const SkImageInfo& info, void* pixels, size_t rowBytes);

    SkCodec::Result getPixels(const SkImageInfo& info, void* pixels, size_t rowBytes) {
        return this->getAndroidPixels(info, pixels, rowBytes);
    }

    SkCodec* codec() const { return fCodec.get(); }

protected:
    SkAndroidCodec(SkCodec*);

    virtual SkISize onGetSampledDimensions(int sampleSize) const = 0;

    virtual bool onGetSupportedSubset(SkIRect* desiredSubset) const = 0;

    virtual SkCodec::Result onGetAndroidPixels(const SkImageInfo& info, void* pixels,
            size_t rowBytes, const AndroidOptions& options) = 0;

private:
    const SkImageInfo               fInfo;
    std::unique_ptr<SkCodec>        fCodec;
};
#endif // SkAndroidCodec_DEFINED
