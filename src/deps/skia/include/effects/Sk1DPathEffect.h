/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef Sk1DPathEffect_DEFINED
#define Sk1DPathEffect_DEFINED

#include "include/core/SkPathEffect.h"

class SK_API SkPath1DPathEffect {
public:
    enum Style {
        kTranslate_Style,   // translate the shape to each position
        kRotate_Style,      // rotate the shape about its center
        kMorph_Style,       // transform each point, and turn lines into curves

        kLastEnum_Style = kMorph_Style,
    };

    /** Dash by replicating the specified path.
        @param path The path to replicate (dash)
        @param advance The space between instances of path
        @param phase distance (mod advance) along path for its initial position
        @param style how to transform path at each point (based on the current
                     position and tangent)
    */
    static sk_sp<SkPathEffect> Make(const SkPath& path, SkScalar advance, SkScalar phase, Style);

    static void RegisterFlattenables();
};

#endif
