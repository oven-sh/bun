/*
 * Copyright 2021 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkBlenders_DEFINED
#define SkBlenders_DEFINED

#include "include/core/SkBlender.h"

class SK_API SkBlenders {
public:
    /**
     *  Create a blender that implements the following:
     *     k1 * src * dst + k2 * src + k3 * dst + k4
     *  @param k1, k2, k3, k4 The four coefficients.
     *  @param enforcePMColor If true, the RGB channels will be clamped to the calculated alpha.
     */
    static sk_sp<SkBlender> Arithmetic(float k1, float k2, float k3, float k4, bool enforcePremul);

private:
    SkBlenders() = delete;
};

#endif
