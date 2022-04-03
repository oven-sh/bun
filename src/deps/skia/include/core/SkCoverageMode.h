/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCoverageMode_DEFINED
#define SkCoverageMode_DEFINED

#include "include/core/SkTypes.h"

/**
 *  Describes geometric operations (ala SkRegion::Op) that can be applied to coverage bytes.
 *  These can be thought of as variants of porter-duff (SkBlendMode) modes, but only applied
 *  to the alpha channel.
 *
 *  See SkMaskFilter for ways to use these when combining two different masks.
 */
enum class SkCoverageMode {
    kUnion,             // A ∪ B    A+B-A*B
    kIntersect,         // A ∩ B    A*B
    kDifference,        // A - B    A*(1-B)
    kReverseDifference, // B - A    B*(1-A)
    kXor,               // A ⊕ B    A+B-2*A*B

    kLast = kXor,
};

#endif
