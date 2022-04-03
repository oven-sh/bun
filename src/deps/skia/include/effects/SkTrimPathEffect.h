/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTrimPathEffect_DEFINED
#define SkTrimPathEffect_DEFINED

#include "include/core/SkPathEffect.h"

class SK_API SkTrimPathEffect {
public:
    enum class Mode {
        kNormal,   // return the subset path [start,stop]
        kInverted, // return the complement/subset paths [0,start] + [stop,1]
    };

    /**
     *  Take start and stop "t" values (values between 0...1), and return a path that is that
     *  subset of the original path.
     *
     *  e.g.
     *      Make(0.5, 1.0) --> return the 2nd half of the path
     *      Make(0.33333, 0.66667) --> return the middle third of the path
     *
     *  The trim values apply to the entire path, so if it contains several contours, all of them
     *  are including in the calculation.
     *
     *  startT and stopT must be 0..1 inclusive. If they are outside of that interval, they will
     *  be pinned to the nearest legal value. If either is NaN, null will be returned.
     *
     *  Note: for Mode::kNormal, this will return one (logical) segment (even if it is spread
     *        across multiple contours). For Mode::kInverted, this will return 2 logical
     *        segments: stopT..1 and 0...startT, in this order.
     */
    static sk_sp<SkPathEffect> Make(SkScalar startT, SkScalar stopT, Mode = Mode::kNormal);
};

#endif
