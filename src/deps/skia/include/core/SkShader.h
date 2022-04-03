/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkShader_DEFINED
#define SkShader_DEFINED

#include "include/core/SkBlendMode.h"
#include "include/core/SkColor.h"
#include "include/core/SkFlattenable.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkTileMode.h"

class SkArenaAlloc;
class SkBitmap;
class SkBlender;
class SkColorFilter;
class SkColorSpace;
class SkImage;
class SkPath;
class SkPicture;
class SkRasterPipeline;
class GrFragmentProcessor;

/** \class SkShader
 *
 *  Shaders specify the source color(s) for what is being drawn. If a paint
 *  has no shader, then the paint's color is used. If the paint has a
 *  shader, then the shader's color(s) are use instead, but they are
 *  modulated by the paint's alpha. This makes it easy to create a shader
 *  once (e.g. bitmap tiling or gradient) and then change its transparency
 *  w/o having to modify the original shader... only the paint's alpha needs
 *  to be modified.
 */
class SK_API SkShader : public SkFlattenable {
public:
    /**
     *  Returns true if the shader is guaranteed to produce only opaque
     *  colors, subject to the SkPaint using the shader to apply an opaque
     *  alpha value. Subclasses should override this to allow some
     *  optimizations.
     */
    virtual bool isOpaque() const { return false; }

    /**
     *  Iff this shader is backed by a single SkImage, return its ptr (the caller must ref this
     *  if they want to keep it longer than the lifetime of the shader). If not, return nullptr.
     */
    SkImage* isAImage(SkMatrix* localMatrix, SkTileMode xy[2]) const;

    bool isAImage() const {
        return this->isAImage(nullptr, (SkTileMode*)nullptr) != nullptr;
    }

    /**
     *  If the shader subclass can be represented as a gradient, asAGradient
     *  returns the matching GradientType enum (or kNone_GradientType if it
     *  cannot). Also, if info is not null, asAGradient populates info with
     *  the relevant (see below) parameters for the gradient.  fColorCount
     *  is both an input and output parameter.  On input, it indicates how
     *  many entries in fColors and fColorOffsets can be used, if they are
     *  non-NULL.  After asAGradient has run, fColorCount indicates how
     *  many color-offset pairs there are in the gradient.  If there is
     *  insufficient space to store all of the color-offset pairs, fColors
     *  and fColorOffsets will not be altered.  fColorOffsets specifies
     *  where on the range of 0 to 1 to transition to the given color.
     *  The meaning of fPoint and fRadius is dependant on the type of gradient.
     *
     *  None:
     *      info is ignored.
     *  Color:
     *      fColorOffsets[0] is meaningless.
     *  Linear:
     *      fPoint[0] and fPoint[1] are the end-points of the gradient
     *  Radial:
     *      fPoint[0] and fRadius[0] are the center and radius
     *  Conical:
     *      fPoint[0] and fRadius[0] are the center and radius of the 1st circle
     *      fPoint[1] and fRadius[1] are the center and radius of the 2nd circle
     *  Sweep:
     *      fPoint[0] is the center of the sweep.
     */

    enum GradientType {
        kNone_GradientType,
        kColor_GradientType,
        kLinear_GradientType,
        kRadial_GradientType,
        kSweep_GradientType,
        kConical_GradientType,
        kLast_GradientType = kConical_GradientType,
    };

    struct GradientInfo {
        int         fColorCount;    //!< In-out parameter, specifies passed size
                                    //   of fColors/fColorOffsets on input, and
                                    //   actual number of colors/offsets on
                                    //   output.
        SkColor*    fColors;        //!< The colors in the gradient.
        SkScalar*   fColorOffsets;  //!< The unit offset for color transitions.
        SkPoint     fPoint[2];      //!< Type specific, see above.
        SkScalar    fRadius[2];     //!< Type specific, see above.
        SkTileMode  fTileMode;
        uint32_t    fGradientFlags; //!< see SkGradientShader::Flags
    };

    // DEPRECATED. skbug.com/8941
    virtual GradientType asAGradient(GradientInfo* info) const;

    //////////////////////////////////////////////////////////////////////////
    //  Methods to create combinations or variants of shaders

    /**
     *  Return a shader that will apply the specified localMatrix to this shader.
     *  The specified matrix will be applied before any matrix associated with this shader.
     */
    sk_sp<SkShader> makeWithLocalMatrix(const SkMatrix&) const;

    /**
     *  Create a new shader that produces the same colors as invoking this shader and then applying
     *  the colorfilter.
     */
    sk_sp<SkShader> makeWithColorFilter(sk_sp<SkColorFilter>) const;

private:
    SkShader() = default;
    friend class SkShaderBase;

    using INHERITED = SkFlattenable;
};

class SK_API SkShaders {
public:
    static sk_sp<SkShader> Empty();
    static sk_sp<SkShader> Color(SkColor);
    static sk_sp<SkShader> Color(const SkColor4f&, sk_sp<SkColorSpace>);
    static sk_sp<SkShader> Blend(SkBlendMode mode, sk_sp<SkShader> dst, sk_sp<SkShader> src);
    static sk_sp<SkShader> Blend(sk_sp<SkBlender>, sk_sp<SkShader> dst, sk_sp<SkShader> src);

private:
    SkShaders() = delete;
};

#endif
