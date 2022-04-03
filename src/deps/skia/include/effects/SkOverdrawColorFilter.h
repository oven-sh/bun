/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#include "include/core/SkColorFilter.h"
#include "include/core/SkFlattenable.h"

#ifndef SkOverdrawColorFilter_DEFINED
#define SkOverdrawColorFilter_DEFINED

/**
 *  Uses the value in the src alpha channel to set the dst pixel.
 *  0             -> colors[0]
 *  1             -> colors[1]
 *  ...
 *  5 (or larger) -> colors[5]
 *
 */
class SK_API SkOverdrawColorFilter {
public:
    static constexpr int kNumColors = 6;

    static sk_sp<SkColorFilter> MakeWithSkColors(const SkColor[kNumColors]);
};

#endif // SkOverdrawColorFilter_DEFINED
