/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkDiscretePathEffect_DEFINED
#define SkDiscretePathEffect_DEFINED

#include "include/core/SkPathEffect.h"

/** \class SkDiscretePathEffect

    This path effect chops a path into discrete segments, and randomly displaces them.
*/
class SK_API SkDiscretePathEffect {
public:
    /** Break the path into segments of segLength length, and randomly move the endpoints
        away from the original path by a maximum of deviation.
        Note: works on filled or framed paths

        @param seedAssist This is a caller-supplied seedAssist that modifies
                          the seed value that is used to randomize the path
                          segments' endpoints. If not supplied it defaults to 0,
                          in which case filtering a path multiple times will
                          result in the same set of segments (this is useful for
                          testing). If a caller does not want this behaviour
                          they can pass in a different seedAssist to get a
                          different set of path segments.
    */
    static sk_sp<SkPathEffect> Make(SkScalar segLength, SkScalar dev, uint32_t seedAssist = 0);

    static void RegisterFlattenables();
};

#endif
