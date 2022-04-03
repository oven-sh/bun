/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkClipOp_DEFINED
#define SkClipOp_DEFINED

#include "include/core/SkTypes.h"

enum class SkClipOp {
    kDifference    = 0,
    kIntersect     = 1,
    kMax_EnumValue = kIntersect
};

#endif
