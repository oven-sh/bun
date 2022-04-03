/*
 * Copyright 2019 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTileModes_DEFINED
#define SkTileModes_DEFINED

#include "include/core/SkTypes.h"

enum class SkTileMode {
    /**
     *  Replicate the edge color if the shader draws outside of its
     *  original bounds.
     */
    kClamp,

    /**
     *  Repeat the shader's image horizontally and vertically.
     */
    kRepeat,

    /**
     *  Repeat the shader's image horizontally and vertically, alternating
     *  mirror images so that adjacent images always seam.
     */
    kMirror,

    /**
     *  Only draw within the original domain, return transparent-black everywhere else.
     */
    kDecal,

    kLastTileMode = kDecal,
};

static constexpr int kSkTileModeCount = static_cast<int>(SkTileMode::kLastTileMode) + 1;

#endif
