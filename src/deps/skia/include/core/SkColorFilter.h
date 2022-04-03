/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkColorFilter_DEFINED
#define SkColorFilter_DEFINED

#include "include/core/SkBlendMode.h"
#include "include/core/SkColor.h"
#include "include/core/SkFlattenable.h"

class SkColorMatrix;

/**
*  ColorFilters are optional objects in the drawing pipeline. When present in
*  a paint, they are called with the "src" colors, and return new colors, which
*  are then passed onto the next stage (either ImageFilter or Xfermode).
*
*  All subclasses are required to be reentrant-safe : it must be legal to share
*  the same instance between several threads.
*/
class SK_API SkColorFilter : public SkFlattenable {
public:
    /** If the filter can be represented by a source color plus Mode, this
     *  returns true, and sets (if not NULL) the color and mode appropriately.
     *  If not, this returns false and ignores the parameters.
     */
    bool asAColorMode(SkColor* color, SkBlendMode* mode) const;

    /** If the filter can be represented by a 5x4 matrix, this
     *  returns true, and sets the matrix appropriately.
     *  If not, this returns false and ignores the parameter.
     */
    bool asAColorMatrix(float matrix[20]) const;

    // Returns true if the filter is guaranteed to never change the alpha of a color it filters.
    bool isAlphaUnchanged() const;

    SkColor filterColor(SkColor) const;

    /**
     * Converts the src color (in src colorspace), into the dst colorspace,
     * then applies this filter to it, returning the filtered color in the dst colorspace.
     */
    SkColor4f filterColor4f(const SkColor4f& srcColor, SkColorSpace* srcCS,
                            SkColorSpace* dstCS) const;

    /** Construct a colorfilter whose effect is to first apply the inner filter and then apply
     *  this filter, applied to the output of the inner filter.
     *
     *  result = this(inner(...))
     */
    sk_sp<SkColorFilter> makeComposed(sk_sp<SkColorFilter> inner) const;

    static sk_sp<SkColorFilter> Deserialize(const void* data, size_t size,
                                            const SkDeserialProcs* procs = nullptr);

private:
    SkColorFilter() = default;
    friend class SkColorFilterBase;

    using INHERITED = SkFlattenable;
};

class SK_API SkColorFilters {
public:
    static sk_sp<SkColorFilter> Compose(sk_sp<SkColorFilter> outer, sk_sp<SkColorFilter> inner) {
        return outer ? outer->makeComposed(inner) : inner;
    }
    static sk_sp<SkColorFilter> Blend(SkColor c, SkBlendMode mode);
    static sk_sp<SkColorFilter> Matrix(const SkColorMatrix&);
    static sk_sp<SkColorFilter> Matrix(const float rowMajor[20]);

    // A version of Matrix which operates in HSLA space instead of RGBA.
    // I.e. HSLA-to-RGBA(Matrix(RGBA-to-HSLA(input))).
    static sk_sp<SkColorFilter> HSLAMatrix(const SkColorMatrix&);
    static sk_sp<SkColorFilter> HSLAMatrix(const float rowMajor[20]);

    static sk_sp<SkColorFilter> LinearToSRGBGamma();
    static sk_sp<SkColorFilter> SRGBToLinearGamma();
    static sk_sp<SkColorFilter> Lerp(float t, sk_sp<SkColorFilter> dst, sk_sp<SkColorFilter> src);

private:
    SkColorFilters() = delete;
};

#endif
