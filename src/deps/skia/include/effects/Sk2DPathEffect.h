/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef Sk2DPathEffect_DEFINED
#define Sk2DPathEffect_DEFINED

#include "include/core/SkPathEffect.h"

class SkMatrix;
class SkPath;

class SK_API SkLine2DPathEffect {
public:
    static sk_sp<SkPathEffect> Make(SkScalar width, const SkMatrix& matrix);

    static void RegisterFlattenables();
};

class SK_API SkPath2DPathEffect {
public:
    static sk_sp<SkPathEffect> Make(const SkMatrix& matrix, const SkPath& path);

    static void RegisterFlattenables();
};

#endif
