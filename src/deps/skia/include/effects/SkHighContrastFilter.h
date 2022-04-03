/*
* Copyright 2017 Google Inc.
*
* Use of this source code is governed by a BSD-style license that can be
* found in the LICENSE file.
*/

#ifndef SkHighContrastFilter_DEFINED
#define SkHighContrastFilter_DEFINED

#include "include/core/SkColorFilter.h"

/**
 *  Configuration struct for SkHighContrastFilter.
 *
 *  Provides transformations to improve contrast for users with low vision.
 */
struct SkHighContrastConfig {
    enum class InvertStyle {
        kNoInvert,
        kInvertBrightness,
        kInvertLightness,

        kLast = kInvertLightness
    };

    SkHighContrastConfig() {
        fGrayscale = false;
        fInvertStyle = InvertStyle::kNoInvert;
        fContrast = 0.0f;
    }

    SkHighContrastConfig(bool grayscale,
                         InvertStyle invertStyle,
                         SkScalar contrast)
        : fGrayscale(grayscale),
          fInvertStyle(invertStyle),
          fContrast(contrast) {}

    // Returns true if all of the fields are set within the valid range.
    bool isValid() const {
        return fInvertStyle >= InvertStyle::kNoInvert &&
            fInvertStyle <= InvertStyle::kInvertLightness &&
            fContrast >= -1.0 &&
            fContrast <= 1.0;
    }

    // If true, the color will be converted to grayscale.
    bool fGrayscale;

    // Whether to invert brightness, lightness, or neither.
    InvertStyle fInvertStyle;

    // After grayscale and inverting, the contrast can be adjusted linearly.
    // The valid range is -1.0 through 1.0, where 0.0 is no adjustment.
    SkScalar  fContrast;
};

/**
 *  Color filter that provides transformations to improve contrast
 *  for users with low vision.
 *
 *  Applies the following transformations in this order. Each of these
 *  can be configured using SkHighContrastConfig.
 *
 *    - Conversion to grayscale
 *    - Color inversion (either in RGB or HSL space)
 *    - Increasing the resulting contrast.
 *
 * Calling SkHighContrastFilter::Make will return nullptr if the config is
 * not valid, e.g. if you try to call it with a contrast outside the range of
 * -1.0 to 1.0.
 */

struct SK_API SkHighContrastFilter {
    // Returns the filter, or nullptr if the config is invalid.
    static sk_sp<SkColorFilter> Make(const SkHighContrastConfig& config);
};

#endif
